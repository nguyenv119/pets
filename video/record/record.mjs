#!/usr/bin/env node
// The recorder CLI (`npm run record`): films the real extension performing
// every shot in a shots.json-shaped document, searching seeds until each
// take satisfies its shot's accept rules, and writes
// build/<run>/<shot-id>/{demo.mp4,events.json}. See the bead (pets-o3p.3)
// for the full spec; this file is the orchestrator, wiring together
// lib/browser.mjs (launch/build/route/seed), observe.js (in-page logging),
// choreo.mjs (action execution), derive.mjs (raw log -> Events), accept.mjs
// (Events -> AcceptResult[]), assemble.mjs (frames -> mp4) and sync.mjs
// (clapper detection).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension, launchWithExtension, routeSet, seedStorage } from '../lib/browser.mjs';
import { evaluateShotRules } from './accept.mjs';
import { assembleFrames, generateSignalStats, probeVideo } from './assemble.mjs';
import { DiscardTake, runActions } from './choreo.mjs';
import { installClap } from './clap.js';
import { deriveEvents } from './derive.mjs';
import { installObservers } from './observe.js';
import { recordPopupTake } from './popup.mjs';
import { startScreencast } from './screencast.mjs';
import { computeSync, demoMsOf, findTrimBeforeMs, HEART_MASK_FILTER, measureVideoLagFromHeart } from './sync.mjs';
import { fallbackVideoLagMs, keptHeartLagsMs, VIDEO_LAG_MAX_MS } from './video-lag.mjs';

const VIDEO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE_TAKES_DIR = join(VIDEO_DIR, '.cache', 'takes');
const BUILD_DIR = join(VIDEO_DIR, 'build');
const SEED_BUDGET = 60;
const CLAP_MS = 160;
const KEPT_RUNS = 2;

function parseArgv(argv) {
  const opts = {
    shots: 'shots.json',
    only: null,
    timezone: undefined,
    noShim: false,
    stripSeedAttr: false,
    homeDays: undefined,
    keepFrames: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shots') opts.shots = argv[++i];
    else if (a === '--only') opts.only = argv[++i];
    else if (a === '--timezone') opts.timezone = argv[++i];
    else if (a === '--no-shim') opts.noShim = true;
    else if (a === '--strip-seed-attr') opts.stripSeedAttr = true;
    else if (a === '--home-days') opts.homeDays = Number(argv[++i]);
    else if (a === '--keep-frames') opts.keepFrames = true;
    else throw new Error(`record.mjs: unknown flag "${a}"`);
  }
  return opts;
}

function loadShotsDoc(shotsPath) {
  const absPath = join(VIDEO_DIR, shotsPath);
  const doc = JSON.parse(readFileSync(absPath, 'utf-8'));
  return { doc, setDir: join(dirname(absPath), 'set') };
}

function seedCandidates(shot) {
  const prng = shot.seed.prng ?? {};
  if (prng.seed !== null && prng.seed !== undefined) {
    // A fixed seed only controls game-logic RNG; real capture timing (the
    // clapper check) is not deterministic even at the same seed, so a
    // transient timing discard still needs a next attempt to retry into
    // (bounded by the caller's own SEED_BUDGET loop) rather than exhausting
    // immediately with nothing left to try.
    const seed = prng.seed;
    return { [Symbol.iterator]: () => ({ next: () => ({ value: seed, done: false }) }) };
  }
  const tried = new Set();
  const candidates = [...(prng.sim_candidates ?? [])];
  let next = 1;
  return {
    [Symbol.iterator]() {
      return {
        next() {
          if (candidates.length) {
            const seed = candidates.shift();
            if (!tried.has(seed)) {
              tried.add(seed);
              return { value: seed, done: false };
            }
          }
          while (tried.has(next)) next++;
          const seed = next++;
          tried.add(seed);
          return { value: seed, done: false };
        },
      };
    },
  };
}

function mergeSeed(shot, aspect, variantDoc, homeDaysOverride) {
  const base = structuredClone(shot.seed);
  const variantShot = variantDoc?.shots?.[shot.id];
  if (aspect === '9:16' && variantShot?.positions) {
    for (const [id, pos] of Object.entries(variantShot.positions)) {
      base.positions[id] = pos;
    }
  }
  if (homeDaysOverride !== undefined) base.homeAnchorDaysAgo = homeDaysOverride;
  return base;
}

/**
 * Maps a shot's `actions[]` onto the aspect's own viewport: a 9:16 re-record
 * uses the variant's `dblclick_css` override when the variant shot declares
 * one (production's own convention), else scales any `dblclick_empty`
 * point by the viewport width ratio, since the base action's point is
 * authored for the 16:9 viewport and would otherwise land off-screen in the
 * narrower one.
 */
function actionsFor(shot, aspect, viewport, variantDoc, baseViewportWidth) {
  if (aspect === '16:9') return shot.actions;
  const variantShot = variantDoc?.shots?.[shot.id];
  const widthRatio = viewport.width / baseViewportWidth;
  return shot.actions.map((action) => {
    if (action.kind !== 'dblclick_empty') return action;
    if (variantShot?.dblclick_css) {
      return { ...action, x: variantShot.dblclick_css.x, y: variantShot.dblclick_css.y };
    }
    return { ...action, x: Math.round(action.x * widthRatio), y: action.y };
  });
}

async function captureOneTake({ shot, aspect, viewport, seedValue, ext, setDir, timezoneId, stripSeedAttr, homeDaysOverride, variantDoc, actions }) {
  const { context, serviceWorker, extensionId } = await launchWithExtension({ ext, viewport, timezoneId });
  const workDir = mkdtempSync(join(tmpdir(), 'pixel-pets-take-'));
  const framesDir = join(workDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  try {
    const seedDoc = mergeSeed(shot, aspect, variantDoc, homeDaysOverride);
    const routeLog = await routeSet(context, setDir, {
      ...(stripSeedAttr ? {} : { seed: seedValue }),
      hour: seedDoc.hour,
    });
    await seedStorage(serviceWorker, seedDoc);

    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const screencast = await startScreencast(cdp, framesDir);

    const setPage = shot.page === 'popup' ? undefined : shot.page;
    const url = `https://pixelpets.demo/${setPage}.html`;
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(installObservers, seedDoc.roster);
    await page.evaluate(installClap);
    // derive.mjs puts t=0 at the start clapper's release (the events.json
    // contract), so anything a shot logs during this 500ms settle (a boot
    // greet, the first tracks) comes out negative.
    await new Promise((r) => setTimeout(r, 500));

    const clapStart = await page.evaluate(([label, ms]) => window.__clap(label, ms), ['start', CLAP_MS]);

    let choreoResult;
    try {
      choreoResult = await runActions(page, actions, { roster: seedDoc.roster, cursorStart: shot.cursor_start });
    } finally {
      // always mark the end clapper, even on discard, so the frames dir stays inspectable
      await page.evaluate(([label, ms]) => window.__clap(label, ms), ['end', CLAP_MS]).catch(() => {});
    }
    const clapEnd = await page.evaluate(() => window.__clapMarks.filter((m) => m.label === 'end').pop());
    const shim = await page.evaluate(() => document.documentElement.dataset.ppShim);

    await new Promise((r) => setTimeout(r, 100));
    await screencast.stop();

    const pp = await page.evaluate(() => window.__pp);

    return {
      workDir,
      frames: screencast.frames,
      raw: {
        clapStart,
        clapEnd,
        src: pp.src,
        hover: pp.hover,
        mouse: pp.mouse,
        cursor: pp.cursor,
        tracks: pp.tracks,
        marks: pp.marks,
        clicks: choreoResult.clicks,
        hourSetT: choreoResult.hourSetMs,
        petsReadyT: choreoResult.petsReadyMs,
        feedMouseupT: choreoResult.feedMouseupMs,
      },
      context: {
        extensionId,
        roster: seedDoc.roster,
      },
      shim,
      routeLog,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function pruneOldRuns() {
  if (!existsSync(BUILD_DIR)) return;
  // Each run is its own build/<runId>/ directory (v916/ lives nested inside
  // it, alongside the 16:9 shot directories), so every top-level entry here
  // is a run.
  const runs = readdirSync(BUILD_DIR)
    .map((name) => ({ name, mtime: statSync(join(BUILD_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const run of runs.slice(KEPT_RUNS)) {
    rmSync(join(BUILD_DIR, run.name), { recursive: true, force: true });
  }
}

async function recordShotAspect({ shot, aspect, doc, setDir, ext, opts, runId }) {
  const viewport = aspect === '16:9' ? doc.viewport : doc.variants.vertical_9x16.viewport;
  const variantDoc = aspect === '9:16' ? doc.variants.vertical_9x16 : undefined;
  const extraRules = aspect === '9:16' ? (variantDoc.shots?.[shot.id]?.extra_accept ?? []) : [];
  const actions = actionsFor(shot, aspect, viewport, variantDoc, doc.viewport.width);

  let takes = 0;
  const rejections = [];

  for (const seedValue of seedCandidates(shot)) {
    if (takes >= SEED_BUDGET) break;
    takes++;

    let take;
    try {
      take = await captureOneTake({
        shot,
        aspect,
        viewport,
        seedValue,
        ext,
        setDir,
        timezoneId: opts.timezone,
        stripSeedAttr: opts.stripSeedAttr,
        homeDaysOverride: opts.homeDays,
        variantDoc,
        actions,
      });
    } catch (err) {
      if (err instanceof DiscardTake) {
        rejections.push(err.message);
        console.log(`[${shot.id}/${aspect}] seed ${seedValue} discarded: ${err.message}`);
        continue;
      }
      throw err;
    }

    const shim = take.shim;
    const events = deriveEvents(take.raw, {
      name: `${shot.id}_${aspect === '16:9' ? '16x9' : '9x16'}`,
      viewport: { width: viewport.width, height: viewport.height },
      capture: { method: 'cdp-screencast', dpr: viewport.device_scale_factor ?? 2, fps: doc.fps ?? 25 },
      extensionId: take.context.extensionId,
      shim,
      roster: take.context.roster,
      videoLagMs: 56,
    });

    const results = evaluateShotRules(shot.accept ?? [], extraRules, events);
    const failed = results.filter((r) => !r.pass);

    if (failed.length > 0) {
      rmSync(take.workDir, { recursive: true, force: true });
      const detail = failed.map((f) => `${f.rule} (${f.detail})`).join('; ');
      rejections.push(detail);
      console.log(`[${shot.id}/${aspect}] seed ${seedValue} discarded: ${detail}`);
      continue;
    }

    // Kept take: assemble, sync, write outputs.
    const outDir = join(BUILD_DIR, runId, aspect === '16:9' ? shot.id : join('v916', shot.id));
    mkdirSync(outDir, { recursive: true });
    const mp4Path = join(outDir, 'demo.mp4');
    assembleFrames({ frames: take.frames, outPath: mp4Path, fps: doc.fps ?? 25, workDir: take.workDir });

    // A screencast frame occasionally arrives at the wrong device-pixel size
    // under heavy system load (observed live: 1920x906, 1080x1286 instead of
    // 1920x1080/1080x1460) — a real, if rare, CDP/compositor race, not a
    // logic bug. Caught here, before the expensive signalstats/heart-mask
    // passes, so a malformed take fails fast rather than shipping the wrong
    // resolution (acceptance 1 requires "the right size").
    const dpr = viewport.device_scale_factor ?? 2;
    const expectedWidth = viewport.width * dpr;
    const expectedHeight = viewport.height * dpr;
    const earlyProbe = probeVideo(mp4Path);
    if (earlyProbe.width !== expectedWidth || earlyProbe.height !== expectedHeight) {
      rmSync(take.workDir, { recursive: true, force: true });
      const detail = `assembled at ${earlyProbe.width}x${earlyProbe.height}, expected ${expectedWidth}x${expectedHeight}`;
      rejections.push(detail);
      console.log(`[${shot.id}/${aspect}] seed ${seedValue} discarded: ${detail}`);
      continue;
    }

    const dumpPath = join(take.workDir, 'sig.txt');
    const sig = generateSignalStats(mp4Path, dumpPath);
    const trimBeforeMs = findTrimBeforeMs(sig);

    // videoLagMs (bead step 9): the gap between a logged catch/eat event and
    // the first video frame that actually shows the heart it produced,
    // measured for real over this take's own assembled mp4 (not borrowed),
    // from the event's demo.mp4 time trimBeforeMs + t: the time the epic
    // eval and the edit place it at, so that time + videoLagMs is the frame
    // that shows the heart.
    const heartAnchor = events.observed.find((e) => e.kind === 'eat') ?? events.observed.find((e) => e.kind === 'catch');
    let videoLagMs;
    let videoLagSource;
    let measuredFromHeart = false;
    if (heartAnchor) {
      const heartDumpPath = join(take.workDir, 'heart.txt');
      const heartSig = generateSignalStats(mp4Path, heartDumpPath, HEART_MASK_FILTER);
      const measured = measureVideoLagFromHeart({ heartMaskSignalStatsText: heartSig, sinceMs: demoMsOf(trimBeforeMs, heartAnchor.t) });
      if (measured !== null) {
        videoLagMs = measured;
        videoLagSource = `measured from the heart after ${heartAnchor.kind}`;
        measuredFromHeart = true;
      }
    }
    if (videoLagMs === undefined) {
      ({ videoLagMs, source: videoLagSource } = fallbackVideoLagMs());
    }

    // "The epic eval requires every shot's videoLagMs to be 0-120ms... a
    // measured lag outside that range is a recorder bug to fix, never a
    // value to write" (bead step 9). A real measurement outside that bound
    // is discarded and retried here rather than shipped — never clamped or
    // silently accepted, even when this take's own clapper check happens to
    // pass (both sides of the check can grow together under heavy system
    // load without the corrected residual crossing 40ms).
    if (measuredFromHeart && (videoLagMs < 0 || videoLagMs > VIDEO_LAG_MAX_MS)) {
      rmSync(take.workDir, { recursive: true, force: true });
      const detail = `videoLagMs ${videoLagMs.toFixed(1)}ms outside the epic eval's 0-120ms bound (${videoLagSource})`;
      rejections.push(detail);
      console.log(`[${shot.id}/${aspect}] seed ${seedValue} discarded: ${detail}`);
      continue;
    }

    const sync = computeSync({
      signalStatsText: sig,
      startClapLoggedMs: take.raw.clapStart.tOff,
      endClapLoggedMs: take.raw.clapEnd.tOff,
      videoLagMs,
    });

    const probe = earlyProbe;
    console.log(`[${shot.id}/${aspect}] KEPT seed ${seedValue} after ${takes} takes; ${mp4Path} ${probe.width}x${probe.height} color_space=${probe.color_space}`);
    console.log(`[${shot.id}/${aspect}] videoLagMs=${videoLagMs.toFixed(1)} (${videoLagSource}; epic eval bound 0-120ms)`);
    console.log(`[${shot.id}/${aspect}] clapper check: |${sync.endClapResidualMs.toFixed(1)} + ${videoLagMs.toFixed(1)}| = ${Math.abs(sync.correctedResidualMs).toFixed(1)} <= 40 -> ${sync.pass}`);
    if (!sync.pass) {
      rmSync(take.workDir, { recursive: true, force: true });
      rejections.push(`clapper sync residual ${sync.correctedResidualMs.toFixed(1)}ms outside +-40ms`);
      continue;
    }

    if (measuredFromHeart) keptHeartLagsMs.push(videoLagMs);

    events.trimBeforeMs = sync.trimBeforeMs;
    events.videoLagMs = videoLagMs;
    events.recordedAt = take.raw.clapStart.tOff;
    events.accept = results;
    writeFileSync(join(outDir, 'events.json'), JSON.stringify(events, null, 1));

    if (!opts.keepFrames) rmSync(join(take.workDir, 'frames'), { recursive: true, force: true });
    console.log(`[${shot.id}/${aspect}] takes-per-shot: ${takes}`);
    return { ok: true, takes };
  }

  throw new Error(`[${shot.id}/${aspect}] exhausted ${takes} takes without a passing seed. Rejections:\n${rejections.join('\n')}`);
}

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  const { doc, setDir } = loadShotsDoc(opts.shots);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  const ext = await buildExtension(opts.noShim ? {} : { shimPath: 'record/shim.js' });

  const shotIds = opts.only ? [opts.only] : doc.edit_order ?? doc.shots.map((s) => s.id);
  const shots = shotIds.map((id) => {
    const shot = doc.shots.find((s) => s.id === id);
    if (!shot) throw new Error(`no shot "${id}" in ${opts.shots}`);
    return shot;
  });

  for (const shot of shots) {
    if (shot.page === 'popup') {
      await recordPopupTake({ shot, doc, ext, opts, runId, buildDir: BUILD_DIR });
      continue;
    }
    await recordShotAspect({ shot, aspect: '16:9', doc, setDir, ext, opts, runId });
    if (doc.variants?.vertical_9x16) {
      await recordShotAspect({ shot, aspect: '9:16', doc, setDir, ext, opts, runId });
    }
  }

  pruneOldRuns();
  console.log('record.mjs: all shots recorded.');
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});

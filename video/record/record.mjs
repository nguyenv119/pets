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
import { evaluateRules } from './accept.mjs';
import { assembleFrames, generateSignalStats, probeVideo } from './assemble.mjs';
import { DiscardTake, runActions } from './choreo.mjs';
import { deriveEvents } from './derive.mjs';
import { installObservers } from './observe.js';
import { computeSync } from './sync.mjs';

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
  if (prng.seed !== null && prng.seed !== undefined) return [prng.seed];
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

async function captureOneTake({ shot, aspect, viewport, seedValue, ext, setDir, timezoneId, stripSeedAttr, homeDaysOverride, variantDoc }) {
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
    const frames = [];
    const pending = [];
    cdp.on('Page.screencastFrame', (f) => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      const file = join(framesDir, `f${String(frames.length).padStart(5, '0')}.png`);
      frames.push({ file, ts: f.metadata.timestamp });
      pending.push(writeFile(file, f.data));
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

    const setPage = shot.page === 'popup' ? undefined : shot.page;
    const url = `https://pixelpets.demo/${setPage}.html`;
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(installObservers, seedDoc.roster);
    await new Promise((r) => setTimeout(r, 500));

    const clapStart = await page.evaluate(([label, ms]) => window.__clap(label, ms), ['start', CLAP_MS]);

    let choreoResult;
    try {
      choreoResult = await runActions(page, shot.actions, { roster: seedDoc.roster, cursorStart: shot.cursor_start });
    } finally {
      // always mark the end clapper, even on discard, so the frames dir stays inspectable
      await page.evaluate(([label, ms]) => window.__clap(label, ms), ['end', CLAP_MS]).catch(() => {});
    }
    const clapEnd = await page.evaluate(() => window.__pp.marks.filter((m) => m.kind === 'clap' && m.label === 'end').pop());
    const shim = await page.evaluate(() => document.documentElement.dataset.ppShim);

    await new Promise((r) => setTimeout(r, 100));
    await cdp.send('Page.stopScreencast');
    await Promise.all(pending);

    const pp = await page.evaluate(() => window.__pp);

    return {
      workDir,
      frames,
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
      },
      context: {
        extensionId,
        roster: seedDoc.roster,
        feedMouseupMs: choreoResult.feedMouseupMs,
        petsReadyMs: choreoResult.petsReadyMs,
      },
      shim,
      routeLog,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function writeFile(path, base64) {
  const { writeFile: wf } = await import('node:fs/promises');
  return wf(path, Buffer.from(base64, 'base64'));
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
  const rules = [...(shot.accept ?? []), ...(aspect === '9:16' ? (variantDoc.shots?.[shot.id]?.extra_accept ?? []) : [])];

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
    const t0 = take.raw.clapStart.tOff;
    const events = deriveEvents(take.raw, {
      name: `${shot.id}_${aspect === '16:9' ? '16x9' : '9x16'}`,
      viewport: { width: viewport.width, height: viewport.height },
      capture: { method: 'cdp-screencast', dpr: viewport.device_scale_factor ?? 2, fps: doc.fps ?? 25 },
      extensionId: take.context.extensionId,
      shim,
      roster: take.context.roster,
      durationMs: take.raw.clapEnd.tOn - t0,
      videoLagMs: 56,
      feedMouseupMs: take.context.feedMouseupMs !== undefined ? take.context.feedMouseupMs - t0 : undefined,
      petsReadyMs: take.context.petsReadyMs !== undefined ? take.context.petsReadyMs - t0 : undefined,
    });

    const results = evaluateRules(rules, events);
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

    const dumpPath = join(take.workDir, 'sig.txt');
    const sig = generateSignalStats(mp4Path, dumpPath);
    const sync = computeSync({
      signalStatsText: sig,
      startClapLoggedMs: take.raw.clapStart.tOff,
      endClapLoggedMs: take.raw.clapEnd.tOff,
      videoLagMs: 56,
    });

    const probe = probeVideo(mp4Path);
    console.log(`[${shot.id}/${aspect}] KEPT seed ${seedValue} after ${takes} takes; ${mp4Path} ${probe.width}x${probe.height} color_space=${probe.color_space}`);
    console.log(`[${shot.id}/${aspect}] clapper check: |${sync.endClapResidualMs.toFixed(1)} + ${56}| = ${Math.abs(sync.correctedResidualMs).toFixed(1)} <= 40 -> ${sync.pass}`);
    if (!sync.pass) {
      rmSync(take.workDir, { recursive: true, force: true });
      rejections.push(`clapper sync residual ${sync.correctedResidualMs.toFixed(1)}ms outside +-40ms`);
      continue;
    }

    events.trimBeforeMs = sync.trimBeforeMs;
    events.videoLagMs = 56;
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
      console.log(`[${shot.id}] skipped: popup take not implemented by this recorder run`);
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

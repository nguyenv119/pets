#!/usr/bin/env node
// render.mjs: the ONE Remotion render entry (epic pets-o3p, bead
// pets-o3p.4; pets-o3p.5 calls it). Plans the edit in Node (timeline,
// per-frame camera, popup card, text layout, audio), runs every
// render-failing check on the plan, writes timeline.json from the same
// plan, stages the media into video/.cache/public/, and renders through
// @remotion/bundler + @remotion/renderer inside the machine-wide lock.
//
// Usage (run with tsx: it imports the .ts planners):
//   npx tsx scripts/render.mjs --run <build/<run>> | --synthetic | --fixture
//        [--variant 16x9|9x16|gif|still] [--no-zoom] [--no-captions] [--at <anchor>]
//
// Outputs, the same names in every mode (verify.mjs and pets-o3p.5 read them):
//   --variant 16x9  out/pixel-pets-16x9.mp4 + out/timeline.json
//   --variant 9x16  out/pixel-pets-9x16.mp4 + out/timeline-9x16.json
//   --variant gif   out/gif-frames/frame-NNNN.png (1920x720, 12.5 fps)
//   --variant still out/still.png (from the 16:9 plan, at --at <anchor>)
//   every variant   out/render-manifest.json {run, variants: {<v>: {run, sources: {<shot>: sha256}, checks?}}}

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderFrames, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { acquireLock } from '../lib/lock.mjs';
import { buildTimeline, resolveAnyAnchor, timelineJson } from '../src/remotion/timeline.ts';
import { STAGE_16X9, STAGE_9X16 } from '../src/remotion/camera.ts';
import { buildPromoPlan } from '../src/remotion/plan.ts';
import { runRenderChecks } from '../src/remotion/renderChecks.ts';
import { enforceRenderChecks, describeViolation } from '../src/remotion/checkGate.ts';
import { buildGifScenes } from '../src/remotion/gifScenes.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoRoot = join(__dirname, '..');
const publicDir = join(videoRoot, '.cache', 'public');
const outDir = join(videoRoot, 'out');
const syntheticRunDir = join(videoRoot, '.cache', 'synthetic-run');
const MUSIC = 'music/cat_caffe.ogg';
const ICON = 'icons/icon-128.png';
const POPUP_SHOT_ID = 's2b_shelter';
const RENDER_OPTS = { imageFormat: 'png', chromiumOptions: { gl: 'angle' } };
const CONCURRENCY = 2;
// Remotion's default (untagged) h264 encode, measured against colorSpace 'bt709' on the BT.709-tagged popup take:
// the default reads back closer to the recording through ffmpeg's default decoder (card mismatch 1.5-2.1 vs 2.4-2.9 mean |RGB|).
const LENGTH_RULE_S = [28.3, 31.0];

export function parseArgs(argv) {
  const args = { variant: '16x9' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixture') args.fixture = true;
    else if (a === '--synthetic') args.synthetic = true;
    else if (a === '--run') args.run = argv[++i];
    else if (a === '--variant') args.variant = argv[++i];
    else if (a === '--no-zoom') args.noZoom = true;
    else if (a === '--no-captions') args.noCaptions = true;
    else if (a === '--at') args.at = argv[++i];
    else if (a === '--plan-only') args.planOnly = true;
    else throw new Error(`render.mjs: unrecognised argument "${a}"`);
  }
  if (!['16x9', '9x16', 'gif', 'still'].includes(args.variant)) throw new Error(`render.mjs: --variant must be 16x9, 9x16, gif or still, not "${args.variant}"`);
  if ([args.fixture, args.synthetic, args.run].filter(Boolean).length !== 1) throw new Error('render.mjs: exactly one of --run <dir>, --synthetic or --fixture');
  return args;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function stageFile(srcAbsPath, publicRelPath) {
  const dest = join(publicDir, publicRelPath);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(srcAbsPath, dest);
  return publicRelPath;
}

function stageCommonAssets() {
  stageFile(join(videoRoot, 'assets', 'fonts', 'VT323-Regular.ttf'), 'fonts/VT323-Regular.ttf');
  stageFile(join(videoRoot, 'assets', 'fonts', 'PressStart2P-Regular.ttf'), 'fonts/PressStart2P-Regular.ttf');
  stageFile(join(videoRoot, '..', 'assets', 'icons', 'icon-128.png'), ICON);
  stageFile(join(videoRoot, 'assets', MUSIC), MUSIC);
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), join(rel, e.name));
      else if (/\.(ogg|wav|mp3)$/.test(e.name)) stageFile(join(dir, e.name), join('sfx', rel, e.name));
    }
  };
  walk(join(videoRoot, 'assets', 'sfx'), '');
}

/** One run's shots for an aspect: build/<run>/<shot>/ (16:9 and the shared popup take) or build/<run>/v916/<shot>/ (9:16 page shots). */
function loadRun(rootDir, shots, port) {
  const eventsByShotId = {};
  const sourceByShotId = {};
  for (const id of shots.edit_order) {
    const dir = port && id !== POPUP_SHOT_ID ? join(rootDir, 'v916', id) : join(rootDir, id);
    const demo = join(dir, 'demo.mp4');
    if (!existsSync(demo)) throw new Error(`render.mjs: missing ${demo}; did the run record every shot?`);
    eventsByShotId[id] = readJson(join(dir, 'events.json'));
    sourceByShotId[id] = resolve(demo);
  }
  return { eventsByShotId, sourceByShotId };
}

function stageShots(sourceByShotId, port) {
  const staged = {};
  for (const [id, src] of Object.entries(sourceByShotId)) staged[id] = stageFile(src, `${port && id !== POPUP_SHOT_ID ? 'v916/' : ''}${id}/demo.mp4`);
  return staged;
}

function updateManifest(variant, run, sources, gate) {
  const p = join(outDir, 'render-manifest.json');
  const m = existsSync(p) ? readJson(p) : { variants: {} };
  m.run = run;
  m.variants[variant] = { run, sources, ...(gate.violations.length ? { checks: { standIn: gate.standIn, status: 'CHECKS FAILED (stand-in data)', violations: gate.violations.map(describeViolation) } } : {}) };
  writeFileSync(p, JSON.stringify(m, null, 1));
}

/** Plans one aspect's master and gates it on the render checks. Throws (non-zero exit) for a real take with any violation. */
export function planMaster({ shots, eventsByShotId, sourceByShotId, stagedByShotId, port, noZoom, noCaptions, mode }) {
  const stage = port ? STAGE_9X16 : STAGE_16X9;
  const aspect = port ? '9x16' : '16x9';
  const edit = buildTimeline({ shots, stage, aspect, eventsByShotId, sourceByShotId, music: join(videoRoot, 'assets', MUSIC), noZoom, allowEmptyBeats: mode === 'fixture', minLengthMs: mode === 'run' ? LENGTH_RULE_S[0] * 1000 : undefined });
  const lengthS = edit.totalFrames / edit.fps;
  console.log(`master length ${lengthS.toFixed(2)} s (${edit.totalFrames} frames)`);
  const plan = buildPromoPlan({ edit, shots, eventsByShotId, stagedByShotId, stage, aspect, outputWidth: stage.width, outputHeight: stage.height, musicSrc: MUSIC, iconPath: ICON, noCaptions });
  const violations = runRenderChecks({ edit, shots, eventsByShotId, stage, aspect, outputWidth: stage.width, items: plan.items });
  const gate = enforceRenderChecks(violations, eventsByShotId);
  for (const line of gate.report) console.log(line);
  // shots.json master.length_rule, applied to --run only (the fixture and synthetic masters run long by construction)
  if (mode === 'run' && (lengthS < LENGTH_RULE_S[0] || lengthS > LENGTH_RULE_S[1])) {
    throw new Error(`render.mjs: the cut runs ${lengthS.toFixed(2)} s, outside the length rule ${LENGTH_RULE_S.join('-')} s (shots.json master.length_rule: re-run s2_review with the next passing seed, or extend the final hold)`);
  }
  return { edit, plan, gate };
}

async function withBundle(id, inputProps, fn) {
  const lock = await acquireLock({ ownerCommand: `render.mjs ${process.argv.slice(2).join(' ')}` });
  try {
    const serveUrl = await bundle({ entryPoint: join(videoRoot, 'src', 'remotion', 'index.ts'), publicDir });
    const composition = await selectComposition({ serveUrl, id, inputProps, chromiumOptions: RENDER_OPTS.chromiumOptions });
    return await fn(serveUrl, composition);
  } finally {
    lock.release();
  }
}

/** The master frame an anchor (e.g. src:rex:swipe+600) shows on, in the 16:9 edit. */
function frameAtAnchor(edit, eventsByShotId, spec) {
  for (const b of edit.beats) {
    const ev = eventsByShotId[b.shotId];
    let d;
    try {
      d = resolveAnyAnchor(spec, { events: ev, beatInMs: b.source_in });
    } catch {
      continue;
    }
    if (d >= b.source_in && d < b.source_out) return Math.round((d + ev.videoLagMs + b.shiftMs) / (1000 / edit.fps));
  }
  throw new Error(`render.mjs --at "${spec}": no beat shows that anchor`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  let shots;
  let rootDir;
  let run;
  let mode;
  if (args.fixture) {
    mode = 'fixture';
    run = 'fixture';
    const sample = readJson(join(videoRoot, 'fixtures', 'shots.sample.json'));
    const shot = sample.shots.find((s) => s.id === sample.edit_order[0]); // the single-shot fixture render
    shots = { ...sample, edit_order: [shot.id], shots: [shot] };
    if (args.variant !== '16x9') throw new Error('render.mjs --fixture renders --variant 16x9 only (the fixture is one 16:9 capture)');
  } else {
    shots = readJson(join(videoRoot, 'shots.json'));
    if (args.synthetic) {
      if (!existsSync(syntheticRunDir)) throw new Error(`render.mjs --synthetic: ${syntheticRunDir} is missing; run "node scripts/make-synthetic-run.mjs" first (it takes the lock itself)`);
      rootDir = syntheticRunDir;
      run = 'synthetic';
      mode = 'synthetic';
    } else {
      rootDir = resolve(args.run);
      run = basename(rootDir);
      mode = 'run';
    }
  }

  const port = args.variant === '9x16';
  let eventsByShotId;
  let sourceByShotId;
  if (mode === 'fixture') {
    const id = shots.edit_order[0];
    eventsByShotId = { [id]: readJson(join(videoRoot, 'fixtures', 'events.sample.json')) };
    sourceByShotId = { [id]: join(videoRoot, 'fixtures', 'demo.sample.mp4') };
  } else {
    ({ eventsByShotId, sourceByShotId } = loadRun(rootDir, shots, port));
  }

  if (args.variant === 'gif') {
    const gifShots = [...new Set(shots.variants.readme_gif.scenes.map((s) => s.shot))];
    const sources = Object.fromEntries(gifShots.map((id) => [id, sourceByShotId[id]]));
    const staged = stageShots(sources, false);
    const { scenes, totalFrames, fps } = buildGifScenes(shots, eventsByShotId, staged);
    console.log(`gif: ${scenes.length} scenes, ${totalFrames} frames at ${fps} fps (${(totalFrames / fps).toFixed(2)} s)`);
    if (args.planOnly) return;
    stageCommonAssets();
    const framesDir = join(outDir, 'gif-frames');
    mkdirSync(framesDir, { recursive: true });
    for (const f of readdirSync(framesDir)) if (f.endsWith('.png')) unlinkSync(join(framesDir, f));
    const t0 = Date.now();
    await withBundle('PromoGif', { scenes }, (serveUrl, composition) =>
      renderFrames({ composition, serveUrl, inputProps: { scenes }, outputDir: framesDir, ...RENDER_OPTS, concurrency: CONCURRENCY, onStart: () => {} }),
    );
    const pngs = readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
    pngs.forEach((f, i) => renameSync(join(framesDir, f), join(framesDir, `frame-${String(i).padStart(4, '0')}.png`)));
    console.log(`wrote ${pngs.length} PNG frames to ${framesDir} in ${((Date.now() - t0) / 1000).toFixed(1)} s (--gl=angle)`);
    updateManifest('gif', run, Object.fromEntries(gifShots.map((id) => [id, sha256(sourceByShotId[id])])), { violations: [], standIn: false });
    return;
  }

  const stagedByShotId = stageShots(sourceByShotId, port);
  const { edit, plan, gate } = planMaster({ shots, eventsByShotId, sourceByShotId, stagedByShotId, port, noZoom: args.noZoom, noCaptions: args.noCaptions, mode });
  if (args.variant !== 'still') {
    const tlName = port ? 'timeline-9x16.json' : 'timeline.json';
    writeFileSync(join(outDir, tlName), JSON.stringify(timelineJson(edit), null, 1));
    console.log(`wrote out/${tlName}`);
  }
  if (args.planOnly) return;
  stageCommonAssets();
  const sources = Object.fromEntries(Object.entries(sourceByShotId).map(([id, p]) => [id, sha256(p)]));

  if (args.variant === 'still') {
    const frame = args.at ? frameAtAnchor(edit, eventsByShotId, args.at) : 0;
    await withBundle('Promo16x9', plan, (serveUrl, composition) => renderStill({ composition, serveUrl, inputProps: plan, frame, output: join(outDir, 'still.png'), ...RENDER_OPTS }));
    console.log(`rendered out/still.png at master frame ${frame}${args.at ? ` (${args.at})` : ''}`);
    updateManifest('still', run, sources, gate);
    return;
  }

  const out = join(outDir, port ? 'pixel-pets-9x16.mp4' : 'pixel-pets-16x9.mp4');
  const t0 = Date.now();
  await withBundle(port ? 'Promo9x16' : 'Promo16x9', plan, (serveUrl, composition) =>
    renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: out, inputProps: plan, crf: 16, concurrency: CONCURRENCY, ...RENDER_OPTS }),
  );
  console.log(`rendered ${basename(out)} in ${((Date.now() - t0) / 1000).toFixed(1)} s (--gl=angle, concurrency ${CONCURRENCY})`);
  updateManifest(args.variant, run, sources, gate);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    if (err?.violations) for (const v of err.violations) console.error(describeViolation(v));
    process.exit(1);
  });
}

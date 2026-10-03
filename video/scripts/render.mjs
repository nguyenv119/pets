#!/usr/bin/env node
// render.mjs: the ONE Remotion render entry (epic pets-o3p, bead
// pets-o3p.4; pets-o3p.5 calls it). Plans the edit in Node (timeline,
// per-frame camera, popup card, text layout, audio), runs every
// render-failing check on the plan and aborts on ANY violation (every
// mode, every variant; --plan-only prints them all and exits non-zero),
// stages the media into video/.cache/public/, renders through
// @remotion/bundler + @remotion/renderer inside the machine-wide lock, and
// only then moves the master and its timeline.json into out/ together.
//
// Usage (run with tsx: it imports the .ts planners):
//   npx tsx scripts/render.mjs --run <build/<run>> | --synthetic | --fixture
//        [--variant 16x9|9x16|gif|still] [--no-zoom] [--no-captions] [--at <anchor>]
//
// Outputs, the same names in every mode (verify.mjs and pets-o3p.5 read them):
//   --variant 16x9  out/pixel-pets-16x9.mp4 + out/timeline.json
//   --variant 9x16  out/pixel-pets-9x16.mp4 + out/timeline-9x16.json
//   --variant gif   out/gif-frames/frame-NNNN.png (1920x720, 12.5 fps)
//   --variant still out/still.png (from the 16:9 plan, at --at <anchor>) + out/still.json (its frame and pet boxes)
//   every variant   out/render-manifest.json {run, variants: {<v>: {run, sources: {<shot>: sha256}}}}

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderFrames, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { acquireLock } from '../lib/lock.mjs';
import { shotDir } from '../record/layout.mjs';
import { findAnchorMasterFrame, timelineJson } from '../src/remotion/timeline.ts';
import { planMaster } from '../src/remotion/planMaster.ts';
import { withSharpFrame } from '../src/remotion/plan.ts';
import { runGifChecks } from '../src/remotion/renderChecks.ts';
import { enforceRenderChecks, describeViolation } from '../src/remotion/checkGate.ts';
import { buildGifScenes } from '../src/remotion/gifScenes.ts';
import { framePets } from '../src/remotion/framePets.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoRoot = join(__dirname, '..');
const publicDir = join(videoRoot, '.cache', 'public');
const outDir = join(videoRoot, 'out');
const syntheticRunDir = join(videoRoot, '.cache', 'synthetic-run');
const MUSIC = 'music/cat_caffe.ogg';
const ICON = 'icons/icon-128.png';
/** PromoGif's frame width (Root.tsx): the native 16:9 capture, 1920x720 band. */
const GIF_WIDTH = 1920;
const RENDER_OPTS = { imageFormat: 'png', chromiumOptions: { gl: 'angle' } };
const CONCURRENCY = 2;
/**
 * The master's encode (16x9 and 9x16). yuv444p, not yuv420p: ffmpeg's default yuv420p -> rgb24 path (what
 * `ffmpeg -i master frame.png` and the eval run) darkens every pixel by about (2, 1, 2) RGB units, so on win
 * attempt 1 a 16:9 page beat's master sat 1.10-2.30 from its own recording (1.69 on b3b_catch) while
 * the unencoded Remotion frame sat 0.06 from it. crf, the scaler and the cursor moved that by <= 0.02.
 * The recordings are yuv444p too. Playback cost: High 4:4:4 h264 has no hardware decode on most phones
 * and Safari/QuickTime will not play it; YouTube, X and the short-form apps re-encode uploads.
 */
export const MASTER_ENCODE = { codec: 'h264', crf: 16, pixelFormat: 'yuv444p' };

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
    const dir = shotDir(rootDir, id, port ? '9:16' : '16:9');
    const demo = join(dir, 'demo.mp4');
    if (!existsSync(demo)) throw new Error(`render.mjs: missing ${demo}; did the run record every shot?`);
    eventsByShotId[id] = readJson(join(dir, 'events.json'));
    sourceByShotId[id] = resolve(demo);
  }
  return { eventsByShotId, sourceByShotId };
}

/** Each shot's demo.mp4 path inside the public dir (where stageShots copies it; the plan names it before anything is copied). */
function stagedPaths(sourceByShotId, port) {
  return Object.fromEntries(Object.keys(sourceByShotId).map((id) => [id, `${shotDir('', id, port ? '9:16' : '16:9')}/demo.mp4`]));
}

function stageShots(sourceByShotId, stagedByShotId) {
  for (const [id, src] of Object.entries(sourceByShotId)) stageFile(src, stagedByShotId[id]);
}

function updateManifest(variant, run, sources) {
  const p = join(outDir, 'render-manifest.json');
  const m = existsSync(p) ? readJson(p) : { variants: {} };
  m.run = run;
  m.variants[variant] = { run, sources };
  writeFileSync(p, JSON.stringify(m, null, 1));
}

/** Writes `path` through a temp file and a rename, so a reader never sees half a file. */
function writeFileAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
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
  const k = findAnchorMasterFrame(edit, eventsByShotId, spec);
  if (k === undefined) throw new Error(`render.mjs --at "${spec}": no beat shows that anchor`);
  return k;
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
    const staged = stagedPaths(sources, false);
    const { scenes, totalFrames, fps } = buildGifScenes(shots, eventsByShotId, staged);
    console.log(`gif: ${scenes.length} scenes, ${totalFrames} frames at ${fps} fps (${(totalFrames / fps).toFixed(2)} s)`);
    console.log(enforceRenderChecks(runGifChecks(scenes, eventsByShotId, fps, GIF_WIDTH)));
    if (args.planOnly) return;
    stageShots(sources, staged);
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
    updateManifest('gif', run, Object.fromEntries(gifShots.map((id) => [id, sha256(sourceByShotId[id])])));
    return;
  }

  const stagedByShotId = stagedPaths(sourceByShotId, port);
  const { edit, plan } = planMaster({ shots, eventsByShotId, sourceByShotId, stagedByShotId, port, noZoom: args.noZoom, noCaptions: args.noCaptions, mode, musicPath: join(videoRoot, 'assets', MUSIC), musicSrc: MUSIC, iconPath: ICON });
  if (args.planOnly) return;
  stageShots(sourceByShotId, stagedByShotId);
  stageCommonAssets();
  const sources = Object.fromEntries(Object.entries(sourceByShotId).map(([id, p]) => [id, sha256(p)]));

  if (args.variant === 'still') {
    const frame = args.at ? frameAtAnchor(edit, eventsByShotId, args.at) : 0;
    const still = withSharpFrame(plan, frame); // the thumbnail frame is never motion-blurred, even mid-move
    await withBundle('Promo16x9', still, (serveUrl, composition) => renderStill({ composition, serveUrl, inputProps: still, frame, output: join(outDir, 'still.png'), ...RENDER_OPTS }));
    // thumbnail.mjs crops and brands around the pets: where they stand on this frame, in output px
    const view = framePets(edit, eventsByShotId, plan.stage, plan.stage.width, frame);
    writeFileAtomic(join(outDir, 'still.json'), JSON.stringify({ run, frame, at: args.at ?? null, pets: (view?.pets ?? []).map(({ id, box }) => ({ id, box })) }, null, 1));
    console.log(`rendered out/still.png + out/still.json at master frame ${frame}${args.at ? ` (${args.at})` : ''}`);
    updateManifest('still', run, sources);
    return;
  }

  const out = join(outDir, port ? 'pixel-pets-9x16.mp4' : 'pixel-pets-16x9.mp4');
  const tlName = port ? 'timeline-9x16.json' : 'timeline.json';
  // Render to a temp name; the master and its timeline reach out/ together, only once the render has succeeded.
  const partial = join(outDir, `.partial-${basename(out)}`);
  const t0 = Date.now();
  try {
    await withBundle(port ? 'Promo9x16' : 'Promo16x9', plan, (serveUrl, composition) =>
      renderMedia({ composition, serveUrl, ...MASTER_ENCODE, outputLocation: partial, inputProps: plan, concurrency: CONCURRENCY, ...RENDER_OPTS }),
    );
  } catch (err) {
    if (existsSync(partial)) unlinkSync(partial);
    throw err;
  }
  renameSync(partial, out);
  writeFileAtomic(join(outDir, tlName), JSON.stringify(timelineJson(edit), null, 1));
  console.log(`rendered ${basename(out)} + out/${tlName} in ${((Date.now() - t0) / 1000).toFixed(1)} s (--gl=angle, concurrency ${CONCURRENCY})`);
  updateManifest(args.variant, run, sources);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    if (err?.violations) for (const v of err.violations) console.error(describeViolation(v));
    process.exit(1);
  });
}

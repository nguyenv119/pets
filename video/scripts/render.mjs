#!/usr/bin/env node
// render.mjs: the ONE Remotion render entry (epic pets-o3p, bead
// pets-o3p.4). Stages media into video/.cache/public/, computes the
// timeline in Node, and renders through @remotion/bundler +
// @remotion/renderer inside the machine-wide Chromium lock.
//
// IMPLEMENTED: `--fixture --variant 16x9|9x16`, against the committed
// fixtures (fixtures/shots.sample.json + events.sample.json), rendering
// ONLY the first shot in edit_order ("single shot" per this bead's Real
// acceptance step 1) — the fixture's one events.sample.json does not
// carry the anchors (e.g. `sleep`) the second fixture shot needs.
//
// NOT IMPLEMENTED (see the coordinator's summary for the full gap list):
// `--run <dir>` (a real recorded run), `--synthetic` (needs
// make-synthetic-run.mjs, itself not implemented), `--variant gif|still`,
// `--no-zoom`/`--no-captions` flags (the Promo component supports them;
// this script does not yet expose them), `--source-offset-ms`.

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { acquireLock } from '../lib/lock.mjs';
import { buildTimeline } from '../src/remotion/timeline.ts';
import { buildRenderBeats } from '../src/remotion/renderBeats.ts';
import { STAGE_16X9, STAGE_9X16 } from '../src/remotion/camera.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoRoot = join(__dirname, '..');
const publicDir = join(videoRoot, '.cache', 'public');
const outDir = join(videoRoot, 'out');

function parseArgs(argv) {
  const args = { variant: '16x9' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixture') args.fixture = true;
    else if (a === '--variant') args.variant = argv[++i];
    else if (a === '--run') args.run = argv[++i];
    else if (a === '--synthetic') args.synthetic = true;
    else throw new Error(`render.mjs: unrecognised argument "${a}" (only --fixture, --variant are implemented in this pass)`);
  }
  return args;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function stageFile(srcAbsPath, publicRelPath) {
  const dest = join(publicDir, publicRelPath);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(srcAbsPath, dest);
  return publicRelPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) {
    throw new Error('render.mjs: only --fixture is implemented in this pass (see the header comment) — --run and --synthetic are not built yet');
  }
  if (args.variant !== '16x9' && args.variant !== '9x16') {
    throw new Error(`render.mjs: --variant "${args.variant}" is not implemented in this pass (only 16x9 and 9x16)`);
  }
  if (args.fixture && args.variant === '9x16') {
    // fixtures/ ships no v916 re-recording (fixtures/shots.sample.json's
    // "variants.vertical_9x16" is only capture METADATA for a real
    // recorder to use — positions/accept rules, not a video). Reusing the
    // 16:9 demo.sample.mp4 as a stand-in for a 1080-stage-wide 9:16 source
    // silently produced a broken render (the 1920-wide video scaled into
    // a 1080-wide container leaves the stage's lower two-thirds solid
    // black) — caught by viewing an extracted frame, not by a check. Fail
    // loudly instead of shipping that.
    throw new Error(
      'render.mjs --fixture --variant 9x16: no 9:16 fixture recording exists (fixtures/ has only the 16:9 demo.sample.mp4). Not implemented in this pass — see the coordinator\'s summary.',
    );
  }

  const fixturesDir = join(videoRoot, 'fixtures');
  const shotsDoc = JSON.parse(readFileSync(join(fixturesDir, 'shots.sample.json'), 'utf8'));
  const events = JSON.parse(readFileSync(join(fixturesDir, 'events.sample.json'), 'utf8'));

  const shotId = shotsDoc.edit_order[0]; // "single shot" — see header comment
  const shot = shotsDoc.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`render.mjs: edit_order names shot "${shotId}", not found in fixtures/shots.sample.json`);

  mkdirSync(publicDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const demoAbsPath = join(fixturesDir, 'demo.sample.mp4');
  const stagedRel = stageFile(demoAbsPath, join(shotId, 'demo.mp4'));
  stageFile(join(videoRoot, 'assets', 'fonts', 'VT323-Regular.ttf'), 'fonts/VT323-Regular.ttf');
  stageFile(join(videoRoot, 'assets', 'fonts', 'PressStart2P-Regular.ttf'), 'fonts/PressStart2P-Regular.ttf');
  const iconAbsPath = join(videoRoot, '..', 'assets', 'icons', 'icon-128.png');
  if (existsSync(iconAbsPath)) stageFile(iconAbsPath, 'icons/icon-128.png');
  const musicAbsPath = join(videoRoot, 'assets', 'music', 'cat_caffe.ogg');
  stageFile(musicAbsPath, 'music/cat_caffe.ogg');

  const stage = args.variant === '16x9' ? STAGE_16X9 : STAGE_9X16;
  const pageTopOffsetNative = args.variant === '16x9' ? 96 : 0;

  // "source" on every TimelineBeat is the ABSOLUTE path under build/<run>/, never
  // the staged public copy (this bead's step 2 spec) — the fixture's stand-in
  // for that is its own absolute fixture path, since --fixture never writes a
  // build/<run>/ dir.
  const timeline = buildTimeline({
    shots: { edit_order: [shotId], shots: [shot] },
    stage,
    eventsByShotId: { [shotId]: events },
    sourceByShotId: { [shotId]: demoAbsPath },
    music: 'music/cat_caffe.ogg',
  });

  const renderBeats = buildRenderBeats(shot.beats, timeline.beats, events).map((rb) => ({ ...rb, stagedSrc: stagedRel }));

  const inputProps = {
    beats: renderBeats,
    stage,
    pageTopOffsetNative,
    musicSrc: 'music/cat_caffe.ogg',
    layout: {
      caption: { left: 1320, top: 400 },
      nameTag: { left: 1320, top: 400 },
      clock: { left: 1600, top: 24 },
      brandLine: { left: 0, right: 0, top: 480, textAlign: 'center' },
      cta: { left: 0, right: 0, top: 560, alignItems: 'center' },
    },
    nameTagIconPath: 'icons/icon-128.png',
  };

  const timelineOutName = args.variant === '9x16' ? 'timeline-9x16.json' : 'timeline.json';
  writeFileSync(join(outDir, timelineOutName), JSON.stringify(timeline, null, 1));

  const lock = await acquireLock({ ownerCommand: `render.mjs --fixture --variant ${args.variant}` });
  let renderMs;
  try {
    const entryPoint = join(videoRoot, 'src', 'remotion', 'index.ts');
    const bundleLocation = await bundle({ entryPoint, publicDir });
    const compositionId = args.variant === '9x16' ? 'Promo9x16' : 'Promo16x9';
    const composition = await selectComposition({ serveUrl: bundleLocation, id: compositionId, inputProps });

    const outputName = args.variant === '9x16' ? 'pixel-pets-9x16.mp4' : 'pixel-pets-16x9.mp4';
    const outputLocation = join(outDir, outputName);

    const start = Date.now();
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation,
      inputProps,
      imageFormat: 'png',
      crf: 16,
      chromiumOptions: { gl: 'angle' },
      concurrency: 2,
    });
    renderMs = Date.now() - start;
    console.log(`rendered ${outputName} in ${renderMs}ms`);
  } finally {
    lock.release();
  }

  const manifestPath = join(outDir, 'render-manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { run: 'fixture', variants: {} };
  manifest.run = 'fixture';
  manifest.variants[args.variant] = { run: 'fixture', sources: { [shotId]: sha256(demoAbsPath) } };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

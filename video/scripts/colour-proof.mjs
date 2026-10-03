#!/usr/bin/env node
// colour-proof.mjs: pets-o3p.4 step 6 / Real acceptance 6. Proves
// OffthreadVideo decodes a BT.709-tagged encode of the lossless proof
// recording within 8 RGB units of the source GIF colours, and that an
// UNTAGGED encode (the FAIL control) does not.
//
// Recipe source: the recorder's record/assemble.mjs (BT709_VF, BT709_TAGS,
// LOSSLESS_H264), the single source for every encode Remotion decodes.
//
// Usage: node scripts/colour-proof.mjs --proof-dir <dir holding frames-lossless-rgb.mkv>

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { acquireLock } from '../lib/lock.mjs';
import { BT709_TAGS, BT709_VF, LOSSLESS_H264 } from '../record/assemble.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoRoot = join(__dirname, '..');
const repoRoot = join(videoRoot, '..');
// The lossless proof capture lives outside the repo (it is never committed): pass its directory.
const proofDirArg = process.argv.indexOf('--proof-dir');
if (proofDirArg < 0 || !process.argv[proofDirArg + 1]) {
  console.error('colour-proof.mjs: pass --proof-dir <dir holding frames-lossless-rgb.mkv>');
  process.exit(2);
}
const proofDir = process.argv[proofDirArg + 1];
const SOURCE_MKV = join(proofDir, 'frames-lossless-rgb.mkv');

const FRAME_START = 700; // review round 4's window
const FRAME_COUNT = 10;
const WIDTH = 1920;
const HEIGHT = 1080;
const MAX_TAGGED_ERROR = 8;

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function ffprobeSize(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path])
    .toString()
    .trim();
  const [w, h] = out.split(/,|\n/).map(Number);
  return { width: w, height: h };
}

function rawRgb24(path, width, height) {
  const out = execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-vframes', '1', '-'], {
    maxBuffer: 1024 * 1024 * 64,
  });
  if (out.length !== width * height * 3) {
    throw new Error(`colour-proof: expected ${width * height * 3} bytes from ${path}, got ${out.length}`);
  }
  return out;
}

function rawRgba(path) {
  return execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

/** Builds the set of every non-transparent colour any dog or panda GIF frame uses. */
function buildSpritePalette() {
  const palette = new Set();
  for (const species of ['dog', 'panda']) {
    const dir = join(repoRoot, 'assets', species);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.gif')) continue;
      const gifPath = join(dir, file);
      const { width, height } = ffprobeSize(gifPath);
      const buf = rawRgba(gifPath);
      const frameBytes = width * height * 4;
      for (let off = 0; off + frameBytes <= buf.length; off += frameBytes) {
        for (let p = off; p < off + frameBytes; p += 4) {
          if (buf[p + 3] === 0) continue; // transparent
          palette.add(`${buf[p]},${buf[p + 1]},${buf[p + 2]}`);
        }
      }
    }
  }
  return palette;
}

/** Worst (max) per-channel distance, over every source pixel whose colour is in `palette`, to that same pixel in `renderedBuf`. */
function worstSpriteError(sourceBuf, renderedBuf, palette) {
  let worst = 0;
  for (let p = 0; p < sourceBuf.length; p += 3) {
    const key = `${sourceBuf[p]},${sourceBuf[p + 1]},${sourceBuf[p + 2]}`;
    if (!palette.has(key)) continue;
    const dr = Math.abs(sourceBuf[p] - renderedBuf[p]);
    const dg = Math.abs(sourceBuf[p + 1] - renderedBuf[p + 1]);
    const db = Math.abs(sourceBuf[p + 2] - renderedBuf[p + 2]);
    const d = Math.max(dr, dg, db);
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Renders every frame (0..FRAME_COUNT-1) of `videoAbsPath` through the
 * bare ColourProof composition and returns each still's path, reusing one
 * bundle for speed. Checking every frame of the 10-frame window (not just
 * one arbitrary index) is what this proof script does beyond the bead's
 * literal "render one frame" — the worst pixel across the whole window is
 * a stricter, more representative number than any single arbitrarily-picked
 * frame, and it is what actually reproduced the bead's own measured
 * untagged value (round 4 evidence: 13 units) rather than landing just
 * under the 8-unit threshold on a less-affected frame.
 */
async function renderAllFramesThrough(videoAbsPath, tmpDir, label) {
  const publicDir = join(tmpDir, 'public');
  const stagedRel = `${label}.mp4`;
  copyFileSync(videoAbsPath, join(publicDir, stagedRel));
  const entryPoint = join(videoRoot, 'src', 'remotion', 'index.ts');
  const bundleLocation = await bundle({ entryPoint, publicDir });

  const stillPaths = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const inputProps = { videoSrc: stagedRel, trimBeforeFrames: i };
    const composition = await selectComposition({ serveUrl: bundleLocation, id: 'ColourProof', inputProps });
    const stillPath = join(tmpDir, `${label}_${i}.png`);
    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: stillPath,
      inputProps,
      imageFormat: 'png',
      chromiumOptions: { gl: 'angle' },
    });
    stillPaths.push(stillPath);
  }
  return stillPaths;
}

async function main() {
  const { width, height } = ffprobeSize(SOURCE_MKV);
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`colour-proof: expected the proof recording at ${WIDTH}x${HEIGHT}, got ${width}x${height}`);
  }

  // Under video/.cache/ (gitignored), matching render.mjs's own publicDir
  // pattern — an OS tmpdir publicDir 404'd every staticFile() lookup,
  // which @remotion/bundler's publicDir handling does not reliably
  // support outside the project tree.
  const tmpDir = join(videoRoot, '.cache', 'colour-proof');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(join(tmpDir, 'public'), { recursive: true });

  const start = FRAME_START;
  const end = FRAME_START + FRAME_COUNT - 1;
  const selectExpr = `select='between(n\\,${start}\\,${end})'`;

  const taggedPath = join(tmpDir, 'tagged.mp4');
  ffmpeg([
    '-i', SOURCE_MKV,
    '-vf', `${selectExpr},setpts=N/FRAME_RATE/TB,${BT709_VF}`,
    ...LOSSLESS_H264,
    ...BT709_TAGS,
    taggedPath,
  ]);

  const untaggedPath = join(tmpDir, 'untagged.mp4');
  ffmpeg([
    '-i', SOURCE_MKV,
    '-vf', `${selectExpr},setpts=N/FRAME_RATE/TB,format=yuv444p`,
    ...LOSSLESS_H264,
    untaggedPath,
  ]);

  // Every one of the 10 absolute source frames the window covers, as raw RGB24.
  const sourceBufs = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const checkFramePath = join(tmpDir, `source_${i}.png`);
    ffmpeg(['-i', SOURCE_MKV, '-vf', `select='eq(n\\,${start + i})'`, '-vframes', '1', checkFramePath]);
    sourceBufs.push(rawRgb24(checkFramePath, WIDTH, HEIGHT));
  }

  console.log('Building the dog+panda GIF colour palette...');
  const palette = buildSpritePalette();
  console.log(`Palette size: ${palette.size} distinct colours`);

  const lock = await acquireLock({ ownerCommand: 'colour-proof.mjs' });
  let taggedError = 0;
  let untaggedError = 0;
  try {
    const taggedStills = await renderAllFramesThrough(taggedPath, tmpDir, 'tagged');
    for (let i = 0; i < FRAME_COUNT; i++) {
      const err = worstSpriteError(sourceBufs[i], rawRgb24(taggedStills[i], WIDTH, HEIGHT), palette);
      if (err > taggedError) taggedError = err;
    }

    const untaggedStills = await renderAllFramesThrough(untaggedPath, tmpDir, 'untagged');
    for (let i = 0; i < FRAME_COUNT; i++) {
      const err = worstSpriteError(sourceBufs[i], rawRgb24(untaggedStills[i], WIDTH, HEIGHT), palette);
      if (err > untaggedError) untaggedError = err;
    }
  } finally {
    lock.release();
  }

  console.log(`Tagged BT.709 encode: worst sprite-pixel error = ${taggedError} RGB units (want <= ${MAX_TAGGED_ERROR})`);
  console.log(`Untagged FAIL control: worst sprite-pixel error = ${untaggedError} RGB units (want > ${MAX_TAGGED_ERROR})`);

  rmSync(tmpDir, { recursive: true, force: true });

  if (taggedError > MAX_TAGGED_ERROR) {
    console.error('COLOUR PROOF FAILED: tagged encode exceeds the threshold');
    process.exit(1);
  }
  if (untaggedError <= MAX_TAGGED_ERROR) {
    console.error('COLOUR PROOF FAILED: untagged FAIL control did not fail (expected it to exceed the threshold)');
    process.exit(1);
  }
  console.log('COLOUR PROOF PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Assembles CDP screencast PNG frames into a lossless, BT.709-tagged CFR
// mp4 — the same encode recipe pets-o3p.3's recorder uses (re-derived here,
// not imported: this bead's worktree stands alone, see scripts/colour-proof.mjs's
// header for why an untagged encode is a real colour bug, not a style
// choice — Remotion's OffthreadVideo shifted a sprite colour 13 RGB units
// on an untagged yuv444p clip).
//
// Standalone from lib/browser.mjs's Chromium plumbing: this module only
// shells out to ffmpeg/ffprobe, so it is cheap to unit-test without a
// browser.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Writes an ffmpeg concat-demuxer list from CDP screencast frames.
 * `frames` is `[{ file, ts }]` (ts = the CDP frame's own metadata
 * timestamp, epoch seconds). Frame N's on-screen duration is
 * ts[N+1] - ts[N]; concat requires every entry but the last to declare a
 * duration, so the last real frame is listed twice (once with its own
 * duration, once bare) to give it screen time too.
 */
export function buildConcatList(frames) {
  if (frames.length < 2) {
    throw new Error(`buildConcatList needs at least 2 frames, got ${frames.length}`);
  }
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${frames[i].file}'`);
    const duration = i < frames.length - 1 ? frames[i + 1].ts - frames[i].ts : frames[i].ts - frames[i - 1].ts;
    lines.push(`duration ${Math.max(duration, 1 / 120).toFixed(6)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  return lines.join('\n') + '\n';
}

/**
 * Assembles `frames` (screencast PNGs with their CDP timestamps) into a
 * lossless, BT.709-tagged CFR mp4 at `fps`, with pets-o3p.3's exact
 * step-3 colour flags (colorspace/primaries/trc/range all tagged bt709,
 * scaled through out_color_matrix=bt709 first) so Remotion's
 * OffthreadVideo decodes it without a colour shift.
 */
export function assembleFrames({ frames, outPath, fps = 25, workDir }) {
  const listPath = join(workDir, 'concat.txt');
  writeFileSync(listPath, buildConcatList(frames));

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-vf',
      `scale=out_color_matrix=bt709:out_range=tv,format=yuv444p,fps=${fps}`,
      '-c:v',
      'libx264',
      '-qp',
      '0',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      outPath,
    ],
    { stdio: 'inherit' },
  );

  return outPath;
}

/** ffprobe's `width`/`height`/`color_space`/`r_frame_rate` for evidence and sanity checks. */
export function probeVideo(path) {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,color_space,r_frame_rate',
    '-of',
    'json',
    path,
  ]).toString();
  return JSON.parse(out).streams[0];
}

/**
 * Crops the source video to `crop` (device px) and pads it to
 * `padW`x`padH` with `padColor`, `padY` px from the top — the 9:16
 * page-shot stand-in (bead step 6): crop device x 840-1920 out of the
 * 1920x1080 fixture, then pad 380 device px of #faf6ef on top so the
 * result is 1080x1460 with the pets sitting at canvas y 1332-1460.
 */
export function buildPortraitStandin({ srcPath, outPath, crop, padW, padH, padY, padColor }) {
  execFileSync('ffmpeg', [
    '-y',
    '-i',
    srcPath,
    '-vf',
    `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},pad=${padW}:${padH}:0:${padY}:${padColor}`,
    '-c:v',
    'libx264',
    '-crf',
    '12',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
    outPath,
  ]);
  return outPath;
}

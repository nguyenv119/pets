#!/usr/bin/env node
// Stage 3: loudness (pets-o3p.5 step 2). Two-pass EBU R128 normalisation of
// each rendered cut's audio to -16 LUFS integrated, -1 dBTP, LRA 11: pass 1
// measures, pass 2 applies the measured values linearly. The video stream is
// copied untouched; audio becomes AAC 192 kbps, 48 kHz stereo. Each file is
// re-measured afterwards and the stage fails outside the eval's -20..-12 LUFS
// (the proof render measured -32.4 LUFS before normalisation).
//
// Usage: npx tsx scripts/loudness.mjs [files...]   (default: both cuts in out/)

import { renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, isMain, OUT_DIR } from './stage-io.mjs';

export const TARGET = { I: -16, TP: -1, LRA: 11 };
/** The epic eval's integrated-loudness window (verify.mjs LUFS). */
export const LUFS_WINDOW = [-20, -12];
export const CUTS = ['pixel-pets-16x9.mp4', 'pixel-pets-9x16.mp4'];

/** loudnorm's print_format=json block (the last {...} in its stderr) as numbers. */
export function parseLoudnormJson(stderr) {
  const all = [...stderr.matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)];
  if (!all.length) throw new Error('loudness: no loudnorm JSON in the ffmpeg output');
  const j = JSON.parse(all[all.length - 1][0]);
  const out = {};
  for (const k of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) {
    const v = Number(j[k]);
    if (!Number.isFinite(v)) throw new Error(`loudness: loudnorm reported ${k}=${j[k]} (silent audio?)`);
    out[k] = v;
  }
  return out;
}

/** The second-pass loudnorm filter that applies pass 1's measurement linearly. */
export function secondPassFilter(m, target = TARGET) {
  return `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
}

/** ebur128's final integrated loudness ("I: -16.1 LUFS" in its summary), the value verify.mjs reads. */
export function parseIntegratedLufs(stderr) {
  const all = [...stderr.matchAll(/I:\s+(-?[0-9.]+) LUFS/g)];
  if (!all.length) throw new Error('loudness: no ebur128 integrated loudness in the ffmpeg output');
  return Number(all[all.length - 1][1]);
}

export function measureLufs(file) {
  return parseIntegratedLufs(ffmpeg(['-nostats', '-i', file, '-filter_complex', 'ebur128', '-f', 'null', '-']));
}

/** Normalises one file in place; returns { before, after } integrated LUFS. Throws when the result is outside LUFS_WINDOW. */
export function normalise(file) {
  const m = parseLoudnormJson(ffmpeg(['-nostats', '-i', file, '-af', `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`, '-f', 'null', '-']));
  const tmp = join(OUT_DIR, `.loudness-${file.split('/').pop()}`);
  try {
    ffmpeg(['-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', secondPassFilter(m), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', tmp]);
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
  const after = measureLufs(file);
  if (!(after >= LUFS_WINDOW[0] && after <= LUFS_WINDOW[1])) throw new Error(`loudness: ${file} measures ${after} LUFS after normalising, outside ${LUFS_WINDOW.join('..')}`);
  return { before: m.input_i, after };
}

export function main(argv) {
  const files = argv.length ? argv : CUTS.map((f) => join(OUT_DIR, f));
  for (const f of files) {
    const { before, after } = normalise(f);
    console.log(`loudness: ${f.split('/').pop()} ${before} -> ${after} LUFS integrated`);
  }
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

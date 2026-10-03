// Shared plumbing for the pipeline's stage scripts (pets-o3p.5): paths, JSON,
// ffmpeg/ffprobe calls and the "run as a script" guard. Every stage reads
// and writes only files under build/<run>/ and out/, so each one also runs
// on its own: `npx tsx scripts/<stage>.mjs --run build/<run>`.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(VIDEO_DIR, 'out');
export const BUILD_DIR = join(VIDEO_DIR, 'build');
export const REPO_DIR = join(VIDEO_DIR, '..');

/** The two rendered cuts in out/ (render.mjs writes them; loudness and qa read them). */
export const CUT_FILES = { '16x9': 'pixel-pets-16x9.mp4', '9x16': 'pixel-pets-9x16.mp4' };

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** True when `metaUrl`'s module is the script node was started with. */
export const isMain = (metaUrl) => !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl);

/** `--run <dir>` from argv, resolved; throws when absent (every stage that reads recordings needs it). */
export function runArg(argv) {
  const i = argv.indexOf('--run');
  if (i < 0 || !argv[i + 1]) throw new Error('pass --run build/<run> (the recording this stage works from)');
  return resolve(argv[i + 1]);
}

/** Runs ffmpeg quietly; throws with its stderr tail on a non-zero exit. Returns stderr (filters such as loudnorm and ebur128 report there). */
export function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', ...args], { maxBuffer: 1 << 30 });
  const err = r.stderr?.toString() ?? '';
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} exited ${r.status}:\n${err.split('\n').slice(-12).join('\n')}`);
  return err;
}

/** ffprobe's streams (codec, size) and format duration, as JSON. */
export function probe(path) {
  return JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels,bit_rate:format=duration,size', '-of', 'json', path]).toString(),
  );
}

/** One frame (or still image) as raw RGB24: `{ width, height, data }`. `seconds` seeks a video. */
export function rgbFrame(path, seconds) {
  const p = probe(path).streams.find((s) => s.codec_type === 'video');
  const args = ['-nostdin', '-v', 'error'];
  if (seconds !== undefined) args.push('-ss', String(Math.max(0, seconds)));
  args.push('-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
  const data = execFileSync('ffmpeg', args, { maxBuffer: 1 << 28 });
  if (data.length !== p.width * p.height * 3) throw new Error(`rgbFrame ${path}: expected ${p.width * p.height * 3} bytes, got ${data.length}`);
  return { width: p.width, height: p.height, data };
}

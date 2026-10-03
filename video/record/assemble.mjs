// Assembles CDP screencast PNG frames into the master lossless, colour-
// tagged BT.709 mp4 the bead's step 3 specifies. ffmpeg's concat demuxer
// consumes the frames at their own (variable, ~59fps) cadence, one entry
// per frame with that frame's own on-screen duration, and re-times the
// result to a constant 25fps. See the bead's plan-review round 4 fix for
// why the encode must be colour-tagged (an untagged yuv444p clip shifted a
// pet colour 13 RGB units through Remotion's OffthreadVideo decode).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN_FRAME_S = 1 / 120;

/**
 * Writes an ffmpeg concat-demuxer list from CDP screencast frames.
 * `frames` is `[{ file, ts }]` (ts = the CDP frame's own metadata.timestamp,
 * epoch seconds). Each frame lasts until the next frame's own timestamp, so
 * frame N starts at ts[N] - ts[0] on the assembled timeline. A frame stamped
 * less than 1/120 s after the previous one (CDP sends bursts, and now and
 * then a frame stamped earlier than its predecessor) still needs a positive
 * duration, so it gets 1/120 s and the next frame's duration absorbs the
 * overshoot. Padding each of those without taking the time back made the
 * assembled clip drift late (215.7 ms by the end clapper on the proof's
 * frames), which the clapper check read as a residual no capture lag caused.
 * The last frame repeats the previous gap (concat requires every entry but
 * the last to declare one).
 */
export function buildConcatList(frames) {
  if (frames.length < 2) throw new Error(`buildConcatList needs at least 2 frames, got ${frames.length}`);
  const ts0 = frames[0].ts;
  const lines = [];
  let at = 0; // seconds of the assembled timeline already written
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${frames[i].file}'`);
    const isLast = i === frames.length - 1;
    const nextStart = isLast ? at + Math.max(frames[i].ts - frames[i - 1].ts, MIN_FRAME_S) : frames[i + 1].ts - ts0;
    const duration = Number(Math.max(nextStart - at, MIN_FRAME_S).toFixed(6));
    lines.push(`duration ${duration.toFixed(6)}`);
    at += duration;
  }
  // The concat demuxer ignores the final entry's duration; repeat the last
  // file once more so the true last frame gets its own screen time.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  return lines.join('\n') + '\n';
}

/**
 * Assembles `frames` (screencast PNGs with their CDP timestamps) into a
 * lossless, BT.709-tagged CFR mp4 at `fps`. Writes the concat list beside
 * the output so it survives for debugging; returns the output path.
 */
export function assembleFrames({ frames, outPath, fps = 25, workDir }) {
  const listPath = join(workDir, 'concat.txt');
  writeFileSync(listPath, buildConcatList(frames));

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-vf', `scale=out_color_matrix=bt709:out_range=tv,format=yuv444p,fps=${fps}`,
      '-c:v', 'libx264',
      '-qp', '0',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-color_range', 'tv',
      outPath,
    ],
    { stdio: 'inherit' },
  );

  return outPath;
}

/**
 * Runs ffmpeg's signalstats+metadata=print filter over the assembled mp4
 * and returns its text output — the format record/sync.mjs's
 * parseSignalStats reads (one `frame:N pts:P pts_time:T` header per frame
 * plus its `lavfi.signalstats.*` lines), matching proof/analyze.mjs's
 * proven command.
 */
export function generateSignalStats(mp4Path, dumpPath, filter = 'signalstats') {
  execFileSync('ffmpeg', [
    '-nostdin', '-v', 'error', '-y',
    '-i', mp4Path,
    '-vf', `${filter},metadata=print:file=${dumpPath}`,
    '-an', '-f', 'null', '-',
  ]);
  return readFileSync(dumpPath, 'utf-8');
}

/**
 * Reads one rectangle (device px, `{ x, y, w, h }`) of every frame of an mp4
 * as 8-bit grey, w*h bytes per frame, for sync.mjs's splitGrayFrames.
 */
export function extractGrayCrop(mp4Path, { x, y, w, h }) {
  return execFileSync(
    'ffmpeg',
    ['-nostdin', '-v', 'error', '-i', mp4Path, '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-an', '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 30 },
  );
}

/** ffprobe's `color_space`/`width`/`height` for the acceptance check's `color_space=bt709` assertion. */
export function probeVideo(path) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,color_space',
    '-of', 'json',
    path,
  ]).toString();
  return JSON.parse(out).streams[0];
}

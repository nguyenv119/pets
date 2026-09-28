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

/**
 * Writes an ffmpeg concat-demuxer list from CDP screencast frames.
 * `frames` is `[{ file, ts }]` (ts = the CDP frame's own metadata.timestamp,
 * epoch seconds). Frame N's duration is ts[N+1] - ts[N]; the last frame
 * repeats the previous duration (concat requires every entry but the last
 * to declare one).
 */
export function buildConcatList(frames) {
  if (frames.length < 2) throw new Error(`buildConcatList needs at least 2 frames, got ${frames.length}`);
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${frames[i].file}'`);
    const duration = i < frames.length - 1 ? frames[i + 1].ts - frames[i].ts : frames[i].ts - frames[i - 1].ts;
    lines.push(`duration ${Math.max(duration, 1 / 120).toFixed(6)}`);
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
export function generateSignalStats(mp4Path, dumpPath) {
  execFileSync('ffmpeg', [
    '-nostdin', '-v', 'error', '-y',
    '-i', mp4Path,
    '-vf', `signalstats,metadata=print:file=${dumpPath}`,
    '-an', '-f', 'null', '-',
  ]);
  return readFileSync(dumpPath, 'utf-8');
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

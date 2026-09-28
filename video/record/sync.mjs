// Pure clapper-sync logic: parses ffmpeg's `signalstats` filter output
// (one `frame:N pts:P pts_time:T` header per frame, followed by its
// `lavfi.signalstats.*` key=value lines) and locates the two 160ms magenta
// clapper flashes record.mjs's clapperboard (record/observe.js's
// window.__clap) inserts at the start and end of every page capture. See
// the bead's step 9 ("Sync").

const SATMIN_THRESHOLD = 60;
const RESIDUAL_TOLERANCE_MS = 40;

/** Parses `ffmpeg -f lavfi -i "movie=...,signalstats" -f ... -` metadata output into one row per frame. */
export function parseSignalStats(text) {
  const frames = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^frame:(\d+)\s+pts:(\d+)\s+pts_time:([\d.]+)/.exec(line);
    if (header) {
      if (current) frames.push(current);
      current = { n: Number(header[1]), t: Number(header[3]), satmin: undefined };
      continue;
    }
    const satmin = /lavfi\.signalstats\.SATMIN=([\d.]+)/.exec(line);
    if (satmin && current) current.satmin = Number(satmin[1]);
  }
  if (current) frames.push(current);
  return frames;
}

/**
 * Finds runs of consecutive frames whose SATMIN is at or above the
 * threshold (the magenta clapper is fully saturated; SATMIN >= 60 never
 * happens over ordinary page content). `releaseT` is the release edge — the
 * pts_time of the first frame AFTER the run ends, where the board visually
 * opens back onto the page. A run with no following frame (the clip ends
 * mid-clap) falls back to its own last frame's time.
 */
export function findMagentaRuns(frames, threshold = SATMIN_THRESHOLD) {
  const runs = [];
  let runStart = null;
  for (let i = 0; i < frames.length; i++) {
    const isMagenta = frames[i].satmin >= threshold;
    if (isMagenta && runStart === null) runStart = i;
    if (!isMagenta && runStart !== null) {
      runs.push({ startT: frames[runStart].t, endT: frames[i - 1].t, releaseT: frames[i].t });
      runStart = null;
    }
  }
  if (runStart !== null) {
    runs.push({ startT: frames[runStart].t, endT: frames[frames.length - 1].t, releaseT: frames[frames.length - 1].t });
  }
  return runs;
}

/**
 * Computes trimBeforeMs (how much of the assembled mp4's front to trim so
 * playback starts at the start clapper's release edge) and the clapper
 * check: |endClapResidualMs + videoLagMs| <= 40ms (one frame at 25fps).
 * `startClapLoggedMs`/`endClapLoggedMs` are the page-logged epoch ms of
 * each clap's release (raw capture's clapStart.tOff/clapEnd.tOff).
 */
export function computeSync({ signalStatsText, startClapLoggedMs, endClapLoggedMs, videoLagMs }) {
  const frames = parseSignalStats(signalStatsText);
  const runs = findMagentaRuns(frames);
  if (runs.length < 2) {
    throw new Error(`expected 2 magenta clapper runs (start, end), found ${runs.length}`);
  }
  const startRun = runs[0];
  const endRun = runs[runs.length - 1];

  const trimBeforeMs = startRun.releaseT * 1000;
  const videoDurationMs = endRun.releaseT * 1000 - startRun.releaseT * 1000;
  const loggedDurationMs = endClapLoggedMs - startClapLoggedMs;
  // Positive means the logged (page-clock) gap between the two claps is
  // wider than the video's own gap between their release edges — i.e. the
  // video render lagged the page clock, which videoLagMs (measured
  // separately from a heart's on-screen delay) is expected to explain.
  const endClapResidualMs = loggedDurationMs - videoDurationMs;
  const correctedResidualMs = endClapResidualMs + videoLagMs;

  return {
    trimBeforeMs,
    endClapResidualMs,
    correctedResidualMs,
    pass: Math.abs(correctedResidualMs) <= RESIDUAL_TOLERANCE_MS,
  };
}

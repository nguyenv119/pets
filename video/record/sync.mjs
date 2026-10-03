// Pure clapper-sync logic: parses ffmpeg's `signalstats` filter output
// (one `frame:N pts:P pts_time:T` header per frame, followed by its
// `lavfi.signalstats.*` key=value lines) and locates the two 160ms magenta
// clapper flashes record.mjs's clapperboard (record/observe.js's
// window.__clap) inserts at the start and end of every page capture. See
// the bead's step 9 ("Sync").

const SATMIN_THRESHOLD = 60;
const RESIDUAL_TOLERANCE_MS = 40;
const HEART_YMAX_THRESHOLD = 30; // a masked all-black frame reads Y=16 (tv-range black); a visible heart pixel reads Y~63+

/** Parses `ffmpeg -f lavfi -i "movie=...,signalstats" -f ... -` metadata output into one row per frame (SATMIN and YMAX, the two metrics this module reads). */
export function parseSignalStats(text) {
  const frames = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^frame:(\d+)\s+pts:(\d+)\s+pts_time:([\d.]+)/.exec(line);
    if (header) {
      if (current) frames.push(current);
      current = { n: Number(header[1]), t: Number(header[3]), satmin: undefined, ymax: undefined };
      continue;
    }
    const satmin = /lavfi\.signalstats\.SATMIN=([\d.]+)/.exec(line);
    if (satmin && current) current.satmin = Number(satmin[1]);
    const ymax = /lavfi\.signalstats\.YMAX=([\d.]+)/.exec(line);
    if (ymax && current) current.ymax = Number(ymax[1]);
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
 * The ffmpeg filter chain that masks every frame down to only its
 * heart-coloured pixels (the same threshold as record/observe.js's canvas
 * scan: r>180, g<70, b<90), full red where matched and black everywhere
 * else, so signalstats' YMAX becomes a clean per-frame "heart visible"
 * signal (~16 = no match, tv-range black; ~63+ = a match). Exported so
 * record.mjs/popup.mjs can build the exact ffmpeg command.
 */
export const HEART_MASK_FILTER =
  "geq=r='if(gt(r(X\\,Y)\\,180)*lt(g(X\\,Y)\\,70)*lt(b(X\\,Y)\\,90)\\,255\\,0)':g=0:b=0,signalstats";

/**
 * Finds the first frame at or after `sinceMs` whose masked YMAX crosses the
 * heart threshold — the first frame, after a logged catch/eat, that
 * actually shows the heart on screen.
 */
export function findFirstHeartFrame(frames, sinceMs, threshold = HEART_YMAX_THRESHOLD) {
  const sinceS = sinceMs / 1000;
  const hit = frames.find((f) => f.t >= sinceS && f.ymax >= threshold);
  return hit ? hit.t * 1000 : null;
}

/**
 * Measures videoLagMs (bead step 9): the gap between a logged catch/eat
 * event and the first video frame that actually shows the heart it
 * produced. `heartMaskSignalStatsText` is ffmpeg signalstats output over
 * HEART_MASK_FILTER; `sinceMs` is the logged catch/eat event's demo.mp4 time
 * (demoMsOf(trimBeforeMs, t)). Returns null if no heart frame is found after `sinceMs`
 * (a heart-less take, or a take whose heart never rendered).
 */
export function measureVideoLagFromHeart({ heartMaskSignalStatsText, sinceMs }) {
  const frames = parseSignalStats(heartMaskSignalStatsText);
  const heartFrameMs = findFirstHeartFrame(frames, sinceMs);
  if (heartFrameMs === null) return null;
  return heartFrameMs - sinceMs;
}

// A visible-change detector for takes with no heart (the popup take): a
// pixel counts as changed when its grey level moves by more than
// CHANGE_PIXEL_DELTA, and a frame shows the event when at least
// CHANGE_MIN_PX pixels changed. Measured live on the popup's #pet-name crop:
// the first keystroke ("P" replacing the grey "Rex" placeholder) changed 333
// device pixels, the text caret about 60.
const CHANGE_PIXEL_DELTA = 40;
const CHANGE_MIN_PX = 150;

/**
 * Splits ffmpeg `-f rawvideo -pix_fmt gray` output into one `{ t, gray }`
 * per frame, frame n at n * 1000 / fps ms: the same axis signalstats'
 * pts_time puts demo.mp4's frames on, so a lag read here and a heart lag
 * read from signalstats are comparable.
 */
export function splitGrayFrames(buffer, { width, height, fps }) {
  const size = width * height;
  if (buffer.length % size !== 0) {
    throw new Error(`grey buffer of ${buffer.length} bytes is not a whole number of frames of ${width}x${height}`);
  }
  const frames = [];
  for (let n = 0; n * size < buffer.length; n++) {
    frames.push({ t: (n * 1000) / fps, gray: buffer.subarray(n * size, (n + 1) * size) });
  }
  return frames;
}

function changedPixels(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > CHANGE_PIXEL_DELTA) count++;
  return count;
}

/**
 * Measures videoLagMs from a visible change instead of a heart (bead step
 * 9's rule, applied to the popup take's own typed text): the first frame at
 * or after `sinceMs` (the logged event's demo.mp4 time, demoMsOf) whose crop
 * differs from the comparison frame in at least CHANGE_MIN_PX pixels, minus
 * `sinceMs`. The comparison frame is the last one a full frame period before
 * `sinceMs`, because the 25 fps resample can already show the change in the
 * grid frame just before the log; a state comparison against an earlier
 * frame still finds it at the first frame at or after the log, as the heart
 * search does. Returns null when there is no comparison frame or the crop
 * never changes.
 */
export function measureVideoLagFromChange({ frames, sinceMs }) {
  if (frames.length < 2) return null;
  const framePeriodMs = frames[1].t - frames[0].t;
  const reference = frames.findLast((f) => f.t <= sinceMs - framePeriodMs);
  if (!reference) return null;
  const shown = frames.find((f) => f.t >= sinceMs && changedPixels(f.gray, reference.gray) >= CHANGE_MIN_PX);
  return shown ? shown.t - sinceMs : null;
}

/**
 * The demo.mp4 time (ms) of an events.json time `t`: events are ms after the
 * start clapper's release, and trimBeforeMs is that release's own time in
 * demo.mp4. The epic eval and the edit place every event here (plus
 * videoLagMs), so the recorders measure videoLagMs from here too: then
 * demoMsOf(trimBeforeMs, t) + videoLagMs is the frame that shows the event.
 */
export function demoMsOf(trimBeforeMs, t) {
  return trimBeforeMs + t;
}

function clapperRuns(signalStatsText) {
  const runs = findMagentaRuns(parseSignalStats(signalStatsText));
  if (runs.length < 2) {
    throw new Error(`expected 2 magenta clapper runs (start, end), found ${runs.length}`);
  }
  return { startRun: runs[0], endRun: runs[runs.length - 1] };
}

/**
 * trimBeforeMs on its own: the demo.mp4 time of the start clapper's release
 * edge, where playback starts and events.json's t=0 sits. Needs no lag, so a
 * recorder reads it first and measures videoLagMs at demoMsOf(trimBeforeMs, t).
 */
export function findTrimBeforeMs(signalStatsText) {
  return clapperRuns(signalStatsText).startRun.releaseT * 1000;
}

/**
 * Computes trimBeforeMs (how much of the assembled mp4's front to trim so
 * playback starts at the start clapper's release edge) and the clapper
 * check: |endClapResidualMs + videoLagMs| <= 40ms (one frame at 25fps).
 * `startClapLoggedMs`/`endClapLoggedMs` are the page-logged epoch ms of
 * each clap's release (raw capture's clapStart.tOff/clapEnd.tOff).
 */
export function computeSync({ signalStatsText, startClapLoggedMs, endClapLoggedMs, videoLagMs }) {
  const { startRun, endRun } = clapperRuns(signalStatsText);

  const trimBeforeMs = startRun.releaseT * 1000;
  const videoDurationMs = endRun.releaseT * 1000 - startRun.releaseT * 1000;
  const loggedDurationMs = endClapLoggedMs - startClapLoggedMs;
  // Positive means the logged (page-clock) gap between the two claps is
  // wider than the video's own gap between their release edges. videoLagMs
  // is measured on demo.mp4's axis (trimBeforeMs + t) from a heart or the
  // typed "P", so the start clap cancels out of the corrected residual:
  // what the 40 ms gate really tests is that the lag event and the end clap
  // render with the same delay.
  const endClapResidualMs = loggedDurationMs - videoDurationMs;
  const correctedResidualMs = endClapResidualMs + videoLagMs;

  return {
    trimBeforeMs,
    endClapResidualMs,
    correctedResidualMs,
    pass: Math.abs(correctedResidualMs) <= RESIDUAL_TOLERANCE_MS,
  };
}

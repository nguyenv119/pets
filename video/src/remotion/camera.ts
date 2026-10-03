// Floor-anchored camera math for the Remotion edit (epic pets-o3p, bead
// pets-o3p.4). Pure — no Remotion/React imports — so it is unit-testable
// without a render.
//
// Source of truth: video/shots.json (master.motion) and
// .claude/marketing-video/design/storyboard-final.md "Stage and camera" /
// "Floor-anchored crops". See that section for the prose this file turns
// into numbers.

import type { Rect } from '../schema';

/** Holds only exist at these two zoom levels, so pixels stay clean (native 1x/2x). */
export const HOLD_ZOOMS = [1, 2] as const;
export type HoldZoom = (typeof HOLD_ZOOMS)[number];

/** Stage geometry for one aspect ratio. Stage px == output px (crop is captured at 1:1 stage scale, then the camera magnifies it to the fixed output size). */
export interface StageConfig {
  /** Stage width in stage px (== output width, since z=1 crop fills the frame). */
  width: number;
  /** Stage height in stage px (== output height); the pets stand on its bottom edge. */
  height: number;
  /** Stage y of page CSS y 0: the browser chrome PNG fills stage y 0-pageY and the capture sits 1:1 below it (stage y = pageY + 2 x CSS y). */
  pageY: number;
}

/** 16:9 (shots.json master.stage): chrome at stage y 0-208, the 1920x872 capture at y 208-1080. */
export const STAGE_16X9: StageConfig = { width: 1920, height: 1080, pageY: 208 };

/** 9:16 (variants.vertical_9x16): chrome at canvas y 0-208, the 1080x1712 capture at y 208-1920. */
export const STAGE_9X16: StageConfig = { width: 1080, height: 1920, pageY: 208 };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The floor-anchored crop rectangle at zoom `z`, horizontally centred on
 * `focusX` (stage px) and clamped to the page edges.
 *
 * shots.json master.stage: there is no floor band, "pets stand on the
 * frame bottom at every zoom", so at zoom z the crop is width/z x height/z
 * stage px with its bottom edge on the stage bottom (16:9 2.0x: 960x540 at
 * y 540; 9:16 2.0x: 540x960 at y 960).
 *
 * Crop rectangles are rounded to whole stage px (storyboard: "Crop
 * rectangles are rounded to whole stage px").
 */
export function floorAnchoredCrop(stage: StageConfig, z: number, focusX: number): Rect {
  if (z <= 0) {
    throw new Error(`floorAnchoredCrop: zoom must be > 0, got ${z}`);
  }
  const w = Math.round(stage.width / z);
  const h = Math.round(stage.height / z);
  return {
    x: Math.round(clamp(focusX - w / 2, 0, stage.width - w)),
    y: stage.height - h,
    w,
    h,
  };
}

// --- Eased pushes (bead pets-o3p.4, "Smooth eased push moves") ---------
//
// master.motion.pushes (shots.json): "Every short push is 450 ms with an
// ease-out-expo curve, cubic-bezier(0.16, 1, 0.3, 1). The night push stays
// a 3000 ms ease-in-out: the film's one slow move." This section turns
// those two named curves into a per-frame progress function, and combines
// it with floorAnchoredCrop to interpolate zoom+focus smoothly across a
// push window; cameraPath.ts samples it once per master frame of a push.

/** cubic-bezier(0.16, 1, 0.3, 1) — ease-out-expo, per master.motion.pushes. Solved by bisection on x(t), since the curve is monotonic in x for these control points. */
export function easeOutExpoBezier(u: number): number {
  return cubicBezierY(0.16, 1, 0.3, 1, clamp(u, 0, 1));
}

/** A gentle symmetric ease-in-out, for the one 3000 ms night push (shots.json: "easing in and out"). */
export function easeInOutCubic(u: number): number {
  const t = clamp(u, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Standard CSS-style cubic-bezier(x1,y1,x2,y2) evaluated at parametric u via bisection on x(s) = u, returning y(s). */
function cubicBezierY(x1: number, y1: number, x2: number, y2: number, u: number): number {
  const cx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const cy = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (cx(mid) < u) lo = mid;
    else hi = mid;
  }
  return cy((lo + hi) / 2);
}

export type PushEasing = 'ease-out-expo' | 'ease-in-out';

export function pushEase(easing: PushEasing, u: number): number {
  return easing === 'ease-in-out' ? easeInOutCubic(u) : easeOutExpoBezier(u);
}

/**
 * The floor-anchored crop at time `atMs` while easing from
 * `(fromZoom, fromFocusX)` at `startMs` to `(toZoom, toFocusX)` at
 * `endMs`. Before `startMs` this is exactly the "from" crop; at/after
 * `endMs` it is exactly the "to" crop (so a caller can safely call this
 * for the whole beat span without a separate steady-state branch).
 * Zoom and focus are eased independently on the same progress curve,
 * which is what "floor-anchored" pushes look like in the reference
 * (programatic-demo): the crop's bottom stays on the frame bottom while its
 * size and horizontal centre move together.
 */
export function easedFloorAnchoredCrop(
  stage: StageConfig,
  fromZoom: number,
  fromFocusX: number,
  toZoom: number,
  toFocusX: number,
  startMs: number,
  endMs: number,
  atMs: number,
  easing: PushEasing = 'ease-out-expo',
): Rect {
  if (atMs <= startMs || endMs <= startMs) return floorAnchoredCrop(stage, fromZoom, fromFocusX);
  if (atMs >= endMs) return floorAnchoredCrop(stage, toZoom, toFocusX);
  const u = pushEase(easing, (atMs - startMs) / (endMs - startMs));
  const zoom = fromZoom + (toZoom - fromZoom) * u;
  const focusX = fromFocusX + (toFocusX - fromFocusX) * u;
  return floorAnchoredCrop(stage, zoom, focusX);
}

export interface FocusSample {
  /** ms, source-time on the same clock as the requested t. */
  t: number;
  /** centre-x of the focus box, stage px. */
  x: number;
}

/**
 * 400 ms-smoothed focus x at time `t`: the mean of every sample whose
 * timestamp falls in [t - windowMs/2, t + windowMs/2], per the storyboard's
 * "follows that pet's per-frame box from events.tracks with 400 ms
 * smoothing." Falls back to the nearest sample when the window is empty
 * (e.g. `t` before the first or after the last sample), and to 0 for an
 * empty track (callers are expected to have already handled the "no
 * tracks" case via the click-rect fallback the storyboard also names).
 */
export function smoothedFocusX(samples: readonly FocusSample[], t: number, windowMs = 400): number {
  if (samples.length === 0) return 0;
  const half = windowMs / 2;
  const inWindow = samples.filter((s) => s.t >= t - half && s.t <= t + half);
  if (inWindow.length > 0) {
    return inWindow.reduce((sum, s) => sum + s.x, 0) / inWindow.length;
  }
  // No sample in the window: hold the nearest sample rather than snapping to 0.
  let nearest = samples[0];
  let nearestDist = Math.abs(samples[0].t - t);
  for (const s of samples) {
    const d = Math.abs(s.t - t);
    if (d < nearestDist) {
      nearest = s;
      nearestDist = d;
    }
  }
  return nearest.x;
}

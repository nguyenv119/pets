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

/** How far above the frame bottom the floor line sits at output resolution. */
export const FLOOR_MARGIN_OUTPUT_PX = 96;

/** Stage geometry for one aspect ratio. Stage px == output px (crop is captured at 1:1 stage scale, then the camera magnifies it to the fixed output size). */
export interface StageConfig {
  /** Stage width in stage px (== output width, since z=1 crop fills the frame). */
  width: number;
  /** Stage height in stage px (== output height). */
  height: number;
  /** Stage y where the pets' feet line sits (top of the cream floor band). */
  floorLine: number;
}

/** 16:9: page 1:1, top 48 CSS px hidden; stage y 0-984 is page, 984-1080 is the cream floor band. */
export const STAGE_16X9: StageConfig = { width: 1920, height: 1080, floorLine: 984 };

/** 9:16: the 540x730 re-record shown 1:1 at canvas y 0-1460, cream band to 1920. */
export const STAGE_9X16: StageConfig = { width: 1080, height: 1920, floorLine: 1460 };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The floor-anchored crop rectangle at zoom `z`, horizontally centred on
 * `focusX` (stage px) and clamped to the page edges.
 *
 * Per the storyboard: "at zoom z the crop is 1920/z x 1080/z stage px with
 * its bottom edge at stage y 984 + 96/z, so the floor line stays 96 output
 * px above the frame bottom at every zoom." Generalised here over
 * `StageConfig` so the same function serves both 16:9 and 9:16, whose
 * floor line and stage size differ.
 *
 * Crop rectangles are rounded to whole stage px (storyboard: "Crop
 * rectangles are rounded to whole stage px").
 */
export function floorAnchoredCrop(stage: StageConfig, z: number, focusX: number): Rect {
  if (z <= 0) {
    throw new Error(`floorAnchoredCrop: zoom must be > 0, got ${z}`);
  }
  const w = stage.width / z;
  const h = stage.height / z;
  const bottom = stage.floorLine + FLOOR_MARGIN_OUTPUT_PX / z;
  const top = bottom - h;
  const rawX = focusX - w / 2;
  const x = clamp(rawX, 0, stage.width - w);
  return {
    x: Math.round(x),
    y: Math.round(top),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/** The stage-px distance from the frame bottom to the floor line at zoom z, for the "96 output px" invariant test. */
export function floorMarginAtZoom(crop: Rect, stage: StageConfig): number {
  return crop.y + crop.h - stage.floorLine;
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

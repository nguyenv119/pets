// motionBlur.ts: which master frames get motion blur, and what each blur
// sample draws (epic pets-o3p, bead pets-o3p.4). Pure. Promo.tsx wraps
// those frames in @remotion/motion-blur's CameraMotionBlur, the group the
// reference app (spike/remotion-app PetsDemo.tsx) uses.
//
// The bead: "a motion-blur group applied only to the cursor and to camera
// moves, never during holds, so held sprite frames are not blended".
// - Camera: a page frame is blurred only when its crop differs from BOTH
//   neighbours (a frame inside a move). Every frame of a run of equal crops
//   is a hold and stays pixel-exact at 1.0x/2.0x, including the first and
//   last frames of a hold and a beat's first frame (a cut).
// - Cursor: on a held frame only the cursor layer is blurred, and only when
//   the cursor actually moved into this frame.
// - Card beats are never blurred: the eval runs SSIM on every card frame.
// - A frame the eval samples is never blurred (sampledFrames): on a follow
//   beat the longest run of equal crops can be one frame long, so master_t,
//   caption_t or a hold-end sample can land inside a camera move.
//
// A blur sample sits at u in [0.5, 1): CameraMotionBlur at shutterAngle 180
// renders its children at frames L + 1 - 0.5 * s / n (s = 1..n); u = that
// minus L, the second half of the interval from the previous frame (u 0) to
// this one (u 1). The recording itself is pinned to frame L in every sample
// (Freeze), so only the camera and the cursor move within the exposure,
// never the page's own frames.

import type { CursorSample, Rect } from '../schema';
import { sampleCursor } from './Cursor';

export const BLUR_SHUTTER_ANGLE = 180;
/** 8 samples: the bead's measured setting (45.5 s for 16 s at 1080p with --gl=angle). */
export const BLUR_SAMPLES = 8;

/** The page-beat fields sampledFrames reads (an EditBeat, in master ms). */
export interface SampledBeat {
  k0: number;
  k1: number;
  master_t: number;
  hold_in?: number;
  hold_out?: number;
  caption_t?: number;
}

/** verify.mjs MOTION_FRACS: the points across each hold its motion check reads. */
const MOTION_FRACS = [0.1, 0.5, 0.9];

/**
 * Every master frame of a page beat that verify.mjs reads off the master,
 * sorted: master_t (aim, zoom and 1.0x SSIM), caption_t (caption pixels),
 * hold_in + 1 frame and hold_out - 1 frame (the hold-end aim test), and
 * the motion points at MOTION_FRACS of the hold (both neighbours of a
 * fractional point, so a rounding difference between ms here and seconds
 * there cannot miss one). Frames outside [k0, k1) are left out.
 */
export function sampledFrames(beat: SampledBeat, frameMs: number): number[] {
  const at = (ms: number) => ms / frameMs;
  const ks = [Math.round(at(beat.master_t))];
  if (beat.caption_t !== undefined) ks.push(Math.round(at(beat.caption_t)));
  if (beat.hold_in !== undefined && beat.hold_out !== undefined) {
    const hin = Math.round(at(beat.hold_in));
    const hout = Math.round(at(beat.hold_out));
    ks.push(hin + 1, hout - 1);
    for (const x of MOTION_FRACS) {
      const v = hin + (hout - hin) * x;
      ks.push(Math.floor(v + 1e-6), Math.ceil(v - 1e-6));
    }
  }
  return [...new Set(ks)].filter((k) => k >= beat.k0 && k < beat.k1).sort((a, b) => a - b);
}

/** Whether page frame `i` of a beat may be blurred at all (camera or cursor): never on a frame the eval samples. */
export function blurAllowed(beat: { k0: number; sharpFrames: readonly number[] }, i: number): boolean {
  return !beat.sharpFrames.includes(beat.k0 + i);
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Whether page frame `i` of a beat is inside a camera move (its crop differs from the frame before AND the frame after). */
export function cameraMovesInto(crops: readonly Rect[], i: number): boolean {
  if (i <= 0 || i >= crops.length) return false;
  if (sameRect(crops[i], crops[i - 1])) return false;
  return i === crops.length - 1 || !sameRect(crops[i], crops[i + 1]);
}

/** The crop a blur sample at exposure position u (0 = the previous frame, 1 = this one) draws: a straight interpolation. */
export function subframeCrop(crops: readonly Rect[], i: number, u: number): Rect {
  const a = crops[Math.max(0, i - 1)];
  const b = crops[i];
  const mix = (p: number, q: number) => p + (q - p) * u;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) };
}

/** Whether the cursor moved between the start of this frame's exposure (u 0.5) and the frame itself (logged ms). */
export function cursorMovesInto(track: readonly CursorSample[], loggedMs: number, frameMs: number): boolean {
  const a = sampleCursor(track, loggedMs - frameMs / 2);
  const b = sampleCursor(track, loggedMs);
  return !!a && !!b && (a.x !== b.x || a.y !== b.y);
}

/** CameraMotionBlur's sample frame `sampleFrame` (fractional) -> exposure position u within master frame `frame`. */
export function exposureOf(sampleFrame: number, frame: number): number {
  return Math.min(1, Math.max(0, sampleFrame - frame));
}

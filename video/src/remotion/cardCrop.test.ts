import { describe, expect, it } from 'vitest';
import type { TrackFrame } from '../schema';
import { cropRule, nearestTrack } from './cardCrop';

// Real DOMRect samples from the shipped popup at 500x960 DPR2 (measured
// 2026-09-27, .claude/loop-evals/pets-o3p/cal/card/real/states.json,
// read-only reference — never imported at runtime). These are the exact
// numbers video/shots.json's crops.measured_native_500x960 documents as
// what the per-frame rule gives on the real popup, so testing against
// them (rather than synthetic numbers) proves this port of verify.mjs's
// cropRule matches the eval's own arithmetic, not just its prose.
const VIEWPORT_CSS = 500;

const READY_FRAME: TrackFrame = {
  t: 0,
  cells: [],
  els: {
    pets_list: { x: 20, y: 193.8, w: 460, h: 137 },
    btn_add_toggle: { x: 20, y: 344.8, w: 460, h: 35.5 },
    add_pet_form: { x: 20, y: 388.3, w: 460, h: 0 },
    pet_name: { x: 108, y: 388.3, w: 356, h: 35.5 },
    pet_color_label: { x: 36, y: 696.3, w: 60, h: 24 },
    btn_add: { x: 36, y: 794.3, w: 428, h: 39 },
  },
};

const EXPANDED_FRAME: TrackFrame = {
  t: 600,
  cells: [
    { type: 'crab', x: 108.3, y: 493.8, w: 66.3, h: 63.5 },
    { type: 'panda', x: 36, y: 563.3, w: 66.3, h: 63.5 },
  ],
  els: {
    pets_list: { x: 20, y: 193.8, w: 460, h: 137 },
    btn_add_toggle: { x: 20, y: 344.8, w: 460, h: 35.5 },
    add_pet_form: { x: 20, y: 388.3, w: 460, h: 477 },
    pet_name: { x: 108, y: 404.3, w: 356, h: 35.5 },
    pet_color_label: { x: 36, y: 712.3, w: 60, h: 24 },
    btn_add: { x: 36, y: 810.3, w: 428, h: 39 },
  },
};

describe('cropRule', () => {
  it('computes A_list exactly as measured on the shipped popup (x0 y372 w1000 h397)', () => {
    /**
     * Verifies this is a faithful port of verify.mjs's own cropRule/nat
     * arithmetic (round each doubled EDGE, then derive w/h), not just an
     * approximation of the prose. video/shots.json documents this exact
     * result as "measured_native_500x960" on the real popup capture — if
     * this drifts even by the CROP_RULE_TOL=1 native px the eval enforces,
     * every card-beat frame declared from it fails the eval's own
     * recomputation.
     */
    const rect = cropRule('A_list', READY_FRAME, VIEWPORT_CSS);
    expect(rect).toEqual({ x: 0, y: 372, w: 1000, h: 397 });
  });

  it('computes B_pick exactly as measured on the shipped popup (x40 y793 w315 h467)', () => {
    /**
     * B_pick is the one crop whose x/x1 edges come from two DIFFERENT
     * elements (the form's left edge, the crab cell's right edge) rather
     * than a fixed 0/vw span — the crop most likely to break if a future
     * edit swaps which cell/element a bound reads from.
     */
    const rect = cropRule('B_pick', EXPANDED_FRAME, VIEWPORT_CSS);
    expect(rect).toEqual({ x: 40, y: 793, w: 315, h: 467 });
  });

  it('computes C_add exactly as measured on the shipped popup (x0 y1417 w1000 h298)', () => {
    /** C_add's y0 comes from the colour label, not a type-grid cell — the crop least tested by the A/B cases above. */
    const rect = cropRule('C_add', EXPANDED_FRAME, VIEWPORT_CSS);
    expect(rect).toEqual({ x: 0, y: 1417, w: 1000, h: 298 });
  });

  it('returns null for B_pick when the form has not expanded yet (no add_pet_form/pet_name/crab/panda logged)', () => {
    /**
     * Verifies the "disjoint from every forbidden cell" / "exactly one
     * declared crop" guarantee degrades safely: a frame missing the
     * elements a crop needs must signal "can't compute this crop" (null)
     * rather than silently returning a zeroed or stale rect that a caller
     * could mistake for a real (if tiny) crop.
     */
    const rect = cropRule('B_pick', READY_FRAME, VIEWPORT_CSS);
    expect(rect).toBeNull();
  });

  it('returns null for an unrecognised crop name', () => {
    /** Defensive: a typo'd crop name must not silently fall through to one of the three real rules. */
    // @ts-expect-error deliberately passing an invalid crop name
    expect(cropRule('D_bogus', EXPANDED_FRAME, VIEWPORT_CSS)).toBeNull();
  });
});

describe('nearestTrack', () => {
  it('picks the logged frame with the smallest |t - target| among several candidates', () => {
    /**
     * The card-frame builder looks up a track sample once per master
     * frame (25/s); the recorder logs at its own rAF rate (about 60Hz),
     * so this nearest-match is what keeps every declared card frame tied
     * to real, close-in-time DOMRects rather than an arbitrary one.
     */
    const frames: TrackFrame[] = [READY_FRAME, { ...EXPANDED_FRAME, t: 600 }, { ...EXPANDED_FRAME, t: 1200 }];
    const nearest = nearestTrack(frames, 650);
    expect(nearest?.t).toBe(600);
  });

  it('returns undefined for an empty or missing track list', () => {
    /** A shot with no tracks[] at all (as the sample fixture has) must not throw here — the caller decides how to fail. */
    expect(nearestTrack(undefined, 100)).toBeUndefined();
    expect(nearestTrack([], 100)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { STAGE_16X9 } from './camera';
import { blurAllowed, cameraMovesInto, cursorMovesInto, exposureOf, sampledFrames, subframeCrop } from './motionBlur';
import { makeEvents } from './testEvents';
import { buildTimeline } from './timeline';

const FULL = { x: 0, y: 0, w: 1920, h: 1080 };
const Z = { x: 400, y: 492, w: 960, h: 540 };
const MID1 = { x: 160, y: 197, w: 1536, h: 864 };
const MID2 = { x: 300, y: 365, w: 1210, h: 681 };

describe('cameraMovesInto', () => {
  // two hold frames at 1.0x, a two-frame push, three hold frames at 2.0x
  const crops = [FULL, FULL, MID1, MID2, Z, Z, Z];

  it('blurs only the frames inside a push', () => {
    /**
     * What: frames whose crop differs from both neighbours (the push) are blurred; every frame of a run
     * of equal crops is not, including the last 1.0x frame before the push and the first 2.0x frame after it.
     * Why: "never during holds, so held sprite frames are not blended": holds must stay pixel-exact at
     * 1.0x/2.0x, and the declared hold starts on the first frame of the steady crop.
     * What breaks: the first hold frame blends the push into it and the eval's hold check sees a soft frame.
     */
    // GIVEN — the crops above
    // WHEN
    const moving = crops.map((_, i) => cameraMovesInto(crops, i));
    // THEN
    expect(moving).toEqual([false, false, true, true, false, false, false]);
  });

  it("never blurs a beat's first frame (a hard cut has no previous crop to blur from)", () => {
    /**
     * What: frame 0 of a beat is sharp even when frame 1 differs.
     * Why: a cut lands on an action frame; blending it with the outgoing shot would smear the cut.
     * What breaks: every beat opens on a ghosted frame.
     */
    // GIVEN
    const following = [MID1, MID2, Z];
    // WHEN / THEN
    expect(cameraMovesInto(following, 0)).toBe(false);
  });
});

describe('subframeCrop', () => {
  it('interpolates from the previous crop (u 0) to this one (u 1)', () => {
    /**
     * What: a blur sample at u draws the straight mix of the two crops.
     * Why: the blur is the camera's path across the exposure; u 1 must be exactly this frame's crop.
     * What breaks: the blurred frame is centred somewhere the camera never was.
     */
    // GIVEN
    const crops = [FULL, Z];
    // WHEN
    const half = subframeCrop(crops, 1, 0.5);
    const end = subframeCrop(crops, 1, 1);
    // THEN
    expect(half).toEqual({ x: 200, y: 246, w: 1440, h: 810 });
    expect(end).toEqual(Z);
  });
});

describe('cursorMovesInto', () => {
  const track = [
    { t: 0, x: 100, y: 100 },
    { t: 1000, x: 100, y: 100 },
    { t: 1400, x: 300, y: 200 },
  ];

  it('is true only while the cursor glides', () => {
    /**
     * What: a frame whose cursor moved during its exposure gets cursor blur; a resting cursor does not.
     * Why: blurring a resting cursor composites 8 identical layers and can shift its pixels by rounding.
     * What breaks: a still cursor on a hold renders slightly off every frame.
     */
    // GIVEN / WHEN / THEN
    expect(cursorMovesInto(track, 600, 40)).toBe(false);
    expect(cursorMovesInto(track, 1200, 40)).toBe(true);
    expect(cursorMovesInto(track, 2000, 40)).toBe(false);
  });
});

describe('exposureOf', () => {
  it("maps CameraMotionBlur's 180-degree samples onto u in [0.5, 1)", () => {
    /**
     * What: at shutterAngle 180 with 8 samples, CameraMotionBlur renders frames L + 1 - 0.5 * s / 8; those
     * are exposure positions 0.9375 down to 0.5 of master frame L.
     * Why: the sample frame is fractional; the crop and cursor time are read from u, while the recording
     * stays pinned to L.
     * What breaks: the blur trails the wrong way or reaches past this frame's own crop.
     */
    // GIVEN
    const L = 120;
    const samples = Array.from({ length: 8 }, (_, i) => L + 1 - 0.5 * ((i + 1) / 8));
    // WHEN
    const us = samples.map((f) => exposureOf(f, L));
    // THEN
    expect(us[0]).toBeCloseTo(0.9375, 9);
    expect(us[7]).toBeCloseTo(0.5, 9);
  });
});

describe('sampledFrames / blurAllowed: a frame the eval samples is never blurred', () => {
  it("keeps a follow beat's master_t and caption_t sharp when its longest steady run is one frame", () => {
    /**
     * What: a 2 s push-then-follow (b1b_not_helping's move) on a pet walking every frame has no 2.0x run of
     * equal crops longer than one frame, so timeline.ts puts master_t on a frame inside the camera move. That frame, and caption_t, must render
     * without motion blur, while the moving frames next to them keep it.
     * Why: verify.mjs scores the master at master_t against the declared crop (aim and zoom SSIM) and counts
     * caption pixels at caption_t; a smeared frame scores the blur, not the crop (b1b_not_helping, synthetic 16:9).
     * What breaks: the aim check fails or passes by luck on an honest follow beat.
     */
    // GIVEN — Rex walks 1 CSS px per 10 ms, clear of the stage edges (no clamped, steady crop); push then follow at 2.0x, with a caption window
    const tracks = [];
    for (let t = 0; t <= 3000; t += 40) tracks.push({ t, pets: [{ id: 'rex', x: 400 + t / 10, y: 372, w: 64, h: 64, src: 'walk' }] });
    const events = makeEvents({ tracks, observed: [{ t: 0, kind: 'pets_ready' }, { t: 2000, kind: 'sleep' }] });
    const beat = { name: 'f', in: 'pets_ready', out: 'sleep', caption: 'x', caption_at: 'pets_ready+400', caption_out: 'pets_ready+1000', camera: { zoom: 2, focus: 'pet:rex', move: 'At pets_ready+200, push from 1.0x to 2.0x over 450 ms (ease-out-expo, master.motion.pushes), floor-anchored, then follow the box track with 400 ms smoothing.', sample: 2 } };
    const edit = buildTimeline({ shots: { fps: 25, edit_order: ['s'], shots: [{ id: 's', beats: [beat] }] }, stage: STAGE_16X9, eventsByShotId: { s: events }, sourceByShotId: { s: '/abs/demo.mp4' }, music: 'm' });
    const b = edit.beats[0];
    const kT = Math.round(b.master_t / 40);
    const kC = Math.round(b.caption_t! / 40);
    // the precondition the bug needs: master_t and caption_t sit on frames inside a camera move
    expect(cameraMovesInto(b.frameCrops!, kT - b.k0)).toBe(true);
    expect(cameraMovesInto(b.frameCrops!, kC - b.k0)).toBe(true);
    // WHEN
    const sharp = sampledFrames(b, 40);
    const planBeat = { k0: b.k0, sharpFrames: sharp };
    // THEN — both sample frames are sharp; a moving frame the eval never samples keeps its blur
    expect(blurAllowed(planBeat, kT - b.k0)).toBe(false);
    expect(blurAllowed(planBeat, kC - b.k0)).toBe(false);
    const other = b.frameCrops!.findIndex((_, i) => cameraMovesInto(b.frameCrops!, i) && !sharp.includes(b.k0 + i));
    expect(other).toBeGreaterThan(0);
    expect(blurAllowed(planBeat, other)).toBe(true);
  });

  it('names master_t, caption_t, both hold-end frames and the motion points of a one-frame hold', () => {
    /**
     * What: hold 110-111 (one frame), master_t 110, caption_t 120: verify.mjs reads frames 110 (master_t and
     * hold_out - 1), 111 (hold_in + 1, and round(110.5..110.9) of the motion points) and 120 (caption).
     * Why: each of those is compared against the declared crop; any one blurred lowers its SSIM.
     * What breaks: a hold-end or motion sample lands on a blurred neighbour of a short hold.
     */
    // GIVEN
    const b = { k0: 100, k1: 150, master_t: 110 * 40, hold_in: 110 * 40, hold_out: 111 * 40, caption_t: 120 * 40 };
    // WHEN / THEN
    expect(sampledFrames(b, 40)).toEqual([110, 111, 120]);
  });

  it('names the 10/50/90 % motion points and the frames one inside each end of a long hold', () => {
    /**
     * What: hold 100-150: motion points at frames 105, 125, 145; hold ends at 101 and 149; master_t 125.
     * Why: verify.mjs's MOTION_FRACS and its hold-end aim test read exactly these master frames.
     * What breaks: a sample frame falls outside the set and could be blurred.
     */
    // GIVEN
    const b = { k0: 90, k1: 160, master_t: 125 * 40, hold_in: 100 * 40, hold_out: 150 * 40 };
    // WHEN / THEN
    expect(sampledFrames(b, 40)).toEqual([101, 105, 125, 145, 149]);
  });

  it('leaves out frames outside the beat', () => {
    /**
     * What: a hold that ends on the beat's last frame names hold_out - 1 but nothing at or past k1.
     * Why: a frame of the next beat belongs to that beat's own sample set.
     * What breaks: nothing visible, but the set would claim frames this beat never draws.
     */
    // GIVEN
    const b = { k0: 0, k1: 1, master_t: 0, hold_in: 0, hold_out: 1 * 40 };
    // WHEN / THEN — hold_in + 1 and the rounded-up motion points are frame 1, the next beat's
    expect(sampledFrames(b, 40)).toEqual([0]);
  });
});

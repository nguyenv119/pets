import { describe, expect, it } from 'vitest';
import { cameraMovesInto, cursorMovesInto, exposureOf, subframeCrop } from './motionBlur';

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

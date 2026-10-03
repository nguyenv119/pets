import { describe, expect, it } from 'vitest';
import { STAGE_16X9, STAGE_9X16, floorAnchoredCrop, floorMarginAtZoom, smoothedFocusX } from './camera';

describe('floorAnchoredCrop', () => {
  it('keeps the floor line 96 output px above the frame bottom at 1.0x', () => {
    /**
     * Verifies the storyboard's core invariant: "the floor line stays 96
     * output px above the frame bottom at every zoom." This is the whole
     * reason the floor band exists (proof/compare-catch-fullbleed-vs-window.png
     * showed a full-bleed punch-in pinning the pets' feet to the frame edge).
     * If this breaks, every push-in render mis-frames the pets' feet.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 1, 960);
    expect(floorMarginAtZoom(crop, STAGE_16X9)).toBe(96);
  });

  it('keeps the floor line 96 output px above the frame bottom at 2.0x', () => {
    /**
     * Same invariant at 2.0x, where the margin in STAGE px is 96/2 = 48, but
     * the OUTPUT margin (after the 2x camera scale) must still read as 96.
     * A camera that forgot to divide the margin by z would pin the pets'
     * feet to the frame edge at every zoomed-in hold.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 2, 960);
    expect(floorMarginAtZoom(crop, STAGE_16X9)).toBe(48); // 96/2 stage px == 96 output px once scaled 2x
  });

  it('sizes the crop as stage-width/z by stage-height/z', () => {
    /**
     * Verifies the crop dimensions match "1920/z x 1080/z stage px" from
     * the storyboard. If this drifts, the render either shows too much or
     * too little of the page relative to the declared zoom level.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 2, 960);
    expect(crop.w).toBe(960);
    expect(crop.h).toBe(540);
  });

  it('centres the crop horizontally on the focus point when clear of the edges', () => {
    /**
     * Verifies the crop is centred on the pet's focus x, not left- or
     * right-anchored. If this breaks, the camera would consistently crop
     * the pet toward one edge instead of centring it.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 2, 500);
    expect(crop.x).toBe(500 - 960 / 2);
  });

  it('clamps the crop to the left page edge when the focus is near x=0', () => {
    /**
     * Verifies the "clamp to the page edges" rule: a focus point near the
     * left edge must not pull the crop off-stage (negative x). If this
     * breaks, the render would show empty/undefined content past the
     * page's left edge.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 2, 10);
    expect(crop.x).toBe(0);
  });

  it('clamps the crop to the right page edge when the focus is near the stage width', () => {
    /**
     * Mirror of the left-edge clamp test. If this breaks, a pet near the
     * right edge of the page would produce a crop that runs off-stage.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 2, 1910);
    expect(crop.x).toBe(STAGE_16X9.width - crop.w);
  });

  it('rounds the crop rectangle to whole stage px', () => {
    /**
     * The storyboard requires "Crop rectangles are rounded to whole stage
     * px" — the master is yuv420p, and a crop on a fractional/odd pixel
     * spot straddles chroma blocks (the same class of bug measured for the
     * popup card: B at (325, 73) scored 0.918 SSIM against 0.994 at the
     * even (324, 72)). An unrounded crop would carry that same defect into
     * every zoomed hold.
     */
    const crop = floorAnchoredCrop(STAGE_16X9, 1.3333, 777.777);
    expect(Number.isInteger(crop.x)).toBe(true);
    expect(Number.isInteger(crop.y)).toBe(true);
    expect(Number.isInteger(crop.w)).toBe(true);
    expect(Number.isInteger(crop.h)).toBe(true);
  });

  it('throws for a non-positive zoom', () => {
    /**
     * A zoom of 0 or negative would divide by zero / invert the crop
     * silently. Throwing loudly here matches the harness's "never silently
     * work around problems" rule and turns an authoring typo in shots.json
     * into an immediate, attributable failure instead of a corrupted frame.
     */
    expect(() => floorAnchoredCrop(STAGE_16X9, 0, 960)).toThrow();
    expect(() => floorAnchoredCrop(STAGE_16X9, -1, 960)).toThrow();
  });

  it('keeps the 9:16 floor line at stage y 1460', () => {
    /**
     * Verifies the same floor-anchoring invariant generalises to the 9:16
     * stage config, whose floor line (1460) and width (1080) differ from
     * 16:9. If this breaks, the 9:16 cut would mis-frame the pets' feet
     * even though the 16:9 cut is correct — the bug the generic StageConfig
     * parameter exists to prevent.
     */
    const full = floorAnchoredCrop(STAGE_9X16, 1, 540);
    expect(full).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    // shots.json variants.vertical_9x16.camera.crop: "1460 + 460/z" -> the 2.0x crop is 540x960 at canvas y 730.
    const zoomed = floorAnchoredCrop(STAGE_9X16, 2, 540);
    expect(zoomed).toEqual({ x: 270, y: 730, w: 540, h: 960 });
    expect(floorMarginAtZoom(zoomed, STAGE_9X16) * 2).toBe(460);
  });
});

describe('smoothedFocusX', () => {
  it('averages every sample inside a 400ms window centred on t', () => {
    /**
     * Verifies the storyboard's "400 ms smoothing" rule: the focus at a
     * given instant is the mean of nearby samples, not the instantaneous
     * (jittery) box centre. If this breaks, the camera would jitter with
     * every per-frame detection noise instead of following smoothly.
     */
    const samples = [
      { t: 0, x: 100 },
      { t: 100, x: 120 },
      { t: 200, x: 140 },
    ];
    // window [−200, 200] at t=200 includes all three samples (t=0 is exactly at the boundary).
    expect(smoothedFocusX(samples, 200, 400)).toBeCloseTo((100 + 120 + 140) / 3);
  });

  it('falls back to the nearest sample when the window is empty', () => {
    /**
     * At the very start or end of a track, a fixed window can miss every
     * sample. Falling back to the nearest sample (rather than 0 or NaN)
     * keeps the camera locked onto the pet instead of snapping toward the
     * stage origin.
     */
    const samples = [{ t: 5000, x: 800 }];
    expect(smoothedFocusX(samples, 0, 400)).toBe(800);
  });

  it('returns 0 for an empty track', () => {
    /**
     * Documents the caller contract: an empty samples array (tracks
     * entirely absent) returns 0 rather than throwing, because the
     * storyboard says the caller falls back to the click rect in that
     * case — this function is not responsible for that fallback.
     */
    expect(smoothedFocusX([], 100)).toBe(0);
  });
});

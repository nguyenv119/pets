import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGE_16X9, STAGE_9X16, floorAnchoredCrop, smoothedFocusX } from './camera';
import { GIF_SOURCE_STAGE } from './renderChecks';
import { loadFixtureEventsV2, V1_FIXTURE_TOP_CUT_CSS, VIDEO_ROOT } from './testEvents';

/** The slice of shots.json the stage constants copy. */
interface StageSpec {
  viewport: { width: number; height: number };
  master: { width: number; height: number; stage: { page_stage_y: [number, number]; chrome: { css_h: number; out_h: number } } };
  variants: { vertical_9x16: { canvas: { width: number; height: number } } };
}

describe('floorAnchoredCrop', () => {
  it('shows the whole stage, chrome included, at 1.0x', () => {
    /**
     * What: the 1.0x crop is the full 1920x1080 stage.
     * Why: shots.json master.stage puts the chrome at stage y 0-208 and the page under it with no band, so a
     * 1.0x frame is the whole drawn window.
     * Breaks: a 1.0x crop that started below y 0 would cut the chrome off every wide shot.
     */
    // GIVEN / WHEN
    const crop = floorAnchoredCrop(STAGE_16X9, 1, 960);
    // THEN
    expect(crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('puts the 2.0x crop bottom on the frame bottom (960x540 at stage y 540)', () => {
    /**
     * What: the 16:9 2.0x crop is 960x540 with its bottom edge at stage y 1080.
     * Why: v2 has no floor band; the pets' feet are on the frame bottom at every zoom (shots.json
     * master.stage.note), and the eval's STAGE.land 2.0x crop is {w 960, h 540, y 540}.
     * Breaks: the v1 rule (bottom at 984 + 96/z) would crop the pets' feet off at 2.0x.
     */
    // GIVEN / WHEN
    const crop = floorAnchoredCrop(STAGE_16X9, 2, 960);
    // THEN
    expect(crop.y).toBe(540);
    expect(crop.y + crop.h).toBe(1080);
  });

  it('keeps the crop bottom on the frame bottom mid-push, at a fractional zoom', () => {
    /**
     * What: a push frame at zoom 1.37 still ends exactly on the stage bottom.
     * Why: an eased push interpolates the zoom; the feet must not lift or drop during it.
     * Breaks: a rounding drift would bob the pets up and down by a pixel during every push.
     */
    // GIVEN / WHEN
    const crop = floorAnchoredCrop(STAGE_16X9, 1.37, 700);
    // THEN
    expect(crop.y + crop.h).toBe(STAGE_16X9.height);
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

  it('puts the 9:16 2.0x crop at canvas y 960-1920', () => {
    /**
     * What: the 9:16 crop is the full canvas at 1.0x and 540x960 at canvas y 960 at 2.0x.
     * Why: variants.vertical_9x16.camera.crop: "a 2.0x crop is canvas y 960-1920, page CSS y 376-856"; the
     * eval's STAGE.port crop is {w 540, h 960, y 960}.
     * Breaks: the 9:16 would frame the pets' feet differently from the 16:9 and fail the eval's crop check.
     */
    // GIVEN / WHEN
    const full = floorAnchoredCrop(STAGE_9X16, 1, 540);
    const zoomed = floorAnchoredCrop(STAGE_9X16, 2, 540);
    // THEN
    expect(full).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(zoomed).toEqual({ x: 270, y: 960, w: 540, h: 960 });
    expect((zoomed.y - STAGE_9X16.pageY) / 2).toBe(376);
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

describe('the stage constants against shots.json', () => {
  it('pins STAGE_16X9, STAGE_9X16, the GIF source stage and the v1 fixture cut to the approved spec', () => {
    /**
     * What: both stages are the master / 9:16 canvas size with the page at master.stage.page_stage_y[0]
     * (== chrome.out_h); the GIF source stage is the 16:9 capture (viewport height x 2); the v1 fixture cut is
     * chrome.css_h and its v2 viewport is shots.json's.
     * Why: these constants are hand-copied numbers; shots.json is the approved contract the eval reads.
     * What breaks: an edit to shots.json (a taller chrome, a new viewport) leaves the camera, overlays and
     * checks framing the old geometry with every other test still green.
     */
    // GIVEN
    const shots: StageSpec = JSON.parse(readFileSync(join(VIDEO_ROOT, 'shots.json'), 'utf8'));
    const { master } = shots;
    // WHEN
    const v2 = loadFixtureEventsV2();
    // THEN
    expect(master.stage.page_stage_y[0]).toBe(master.stage.chrome.out_h);
    expect(STAGE_16X9).toEqual({ width: master.width, height: master.height, pageY: master.stage.page_stage_y[0] });
    expect(STAGE_9X16).toEqual({ ...shots.variants.vertical_9x16.canvas, pageY: master.stage.page_stage_y[0] });
    expect(GIF_SOURCE_STAGE).toEqual({ width: shots.viewport.width * 2, height: shots.viewport.height * 2, pageY: 0 });
    expect(V1_FIXTURE_TOP_CUT_CSS).toBe(master.stage.chrome.css_h);
    expect(v2.viewport).toEqual({ width: shots.viewport.width, height: shots.viewport.height });
  });
});

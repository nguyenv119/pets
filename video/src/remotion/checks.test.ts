import { describe, expect, it } from 'vitest';
import {
  CHECK_THRESHOLDS,
  checkCardCaptionGap,
  checkCardEndsAfterMousedown,
  checkCardSteadyAnchor,
  checkCropPetMargin,
  checkOverlayPetDistance,
  checkParticleColumnOverlap,
  checkUniformContentScale,
  particleColumn,
  rectsIntersect,
} from './checks';

describe('rectsIntersect', () => {
  it('reports overlap for two rectangles that share interior area', () => {
    /**
     * Basic sanity check for the primitive every other check in this file
     * is built on. If this is wrong, every downstream framing check is
     * wrong silently.
     */
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('does not report overlap for two rectangles that only touch at an edge', () => {
    /**
     * Touching-but-not-overlapping must read as no-intersection, or the
     * particle-column check would fail an overlay that is merely adjacent
     * to a pet's column rather than actually inside it.
     */
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('checkCropPetMargin', () => {
  const pageBounds = { x: 0, y: 0, w: 1920, h: 1080 };

  it('fails a crop whose edge sits within the margin of a visible pet box', () => {
    /**
     * Verifies the storyboard's render-failing rule: "a crop edge within
     * 16 stage px of a visible pet box (unless it is the page edge)."
     * This matters because a crop edge that nearly clips a pet reads as an
     * accidental, ugly framing choice in the final render.
     */
    const crop = { x: 100, y: 0, w: 500, h: 500 };
    const pet = { x: 105, y: 200, w: 40, h: 40 }; // left edge only 5px inside the crop's left edge
    const violations = checkCropPetMargin(crop, [pet], pageBounds);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('passes a crop whose edges clear every pet box by the margin', () => {
    /**
     * The inverse of the failing case: a comfortably-clear crop must not
     * be flagged, or the check would be too strict to ever pass a real
     * render.
     */
    const crop = { x: 100, y: 0, w: 500, h: 500 };
    const pet = { x: 300, y: 200, w: 40, h: 40 };
    expect(checkCropPetMargin(crop, [pet], pageBounds)).toEqual([]);
  });

  it('exempts a crop edge that coincides with the page edge', () => {
    /**
     * Verifies the "unless it is the page edge" carve-out: a pet standing
     * near the page's own boundary (e.g. clamped by floorAnchoredCrop)
     * must not fail the check merely because the crop's edge is pinned to
     * the page edge rather than floating near the pet by choice.
     */
    const crop = { x: 0, y: 0, w: 500, h: 500 }; // left edge == page's left edge
    const pet = { x: 2, y: 200, w: 40, h: 40 }; // 2px from crop's left edge, which is the page edge
    expect(checkCropPetMargin(crop, [pet], pageBounds)).toEqual([]);
  });
});

describe('checkOverlayPetDistance', () => {
  it('fails an overlay within CAPTION_TO_PET_OUTPUT_PX of a pet box', () => {
    /**
     * Verifies: "any caption, name tag, clock, brand line or CTA within
     * 80 output px of a pet box" fails the render — the rule that keeps
     * text from crowding or clipping through a pet sprite.
     */
    const overlay = { x: 0, y: 0, w: 200, h: 60 };
    const pet = { x: 210, y: 0, w: 40, h: 40 }; // 10px away, under the 80px min
    expect(checkOverlayPetDistance(overlay, [pet], CHECK_THRESHOLDS).length).toBe(1);
  });

  it('passes an overlay comfortably clear of every pet box', () => {
    const overlay = { x: 0, y: 0, w: 200, h: 60 };
    const pet = { x: 2000, y: 2000, w: 40, h: 40 };
    expect(checkOverlayPetDistance(overlay, [pet], CHECK_THRESHOLDS)).toEqual([]);
  });
});

describe('particleColumn / checkParticleColumnOverlap', () => {
  it('widens the pet box by PARTICLE_COLUMN_WIDEN_CSS_PX and extends it up by PARTICLE_COLUMN_UP_CSS_PX', () => {
    /**
     * Verifies the exact column geometry named in the storyboard: "box x
     * widened by 24 CSS px, extended 80 CSS px up." A wrong column shape
     * either lets an overlay sit in a feed/catch particle burst (visual
     * bug) or over-restricts overlay placement (the s4 end card would
     * become impossible, which the storyboard calls out explicitly).
     */
    const pet = { x: 100, y: 100, w: 40, h: 40 };
    const column = particleColumn(pet);
    expect(column).toEqual({ x: 76, y: 20, w: 88, h: 120 });
  });

  it('fails an overlay inside an emitting pet\'s particle column', () => {
    const pet = { x: 100, y: 100, w: 40, h: 40 };
    const overlay = { x: 80, y: 30, w: 20, h: 20 }; // inside the widened/extended column
    expect(checkParticleColumnOverlap(overlay, [pet]).length).toBe(1);
  });

  it('passes an overlay clear of the particle column even when close to the pet box itself', () => {
    /**
     * Distinguishes the particle-column check from the plain pet-distance
     * check: an overlay can be near the pet's box yet still outside its
     * (asymmetric) particle column, and must not be double-flagged by
     * this check.
     */
    const pet = { x: 100, y: 100, w: 40, h: 40 };
    const overlay = { x: 300, y: 100, w: 20, h: 20 }; // far to the right, outside the widened column
    expect(checkParticleColumnOverlap(overlay, [pet])).toEqual([]);
  });
});

describe('checkCardCaptionGap', () => {
  it('fails a caption placed below the card without the minimum gap', () => {
    /**
     * Verifies: "B is 934 px tall, so a caption below it cannot fit the
     * 1080 px frame" — more generally, any caption below the card must
     * clear it by CARD_CAPTION_GAP_PX (40px).
     */
    const card = { x: 100, y: 0, w: 200, h: 500 };
    const caption = { x: 100, y: 520, w: 200, h: 60 }; // only 20px below the card
    expect(checkCardCaptionGap(card, caption).length).toBe(1);
  });

  it('passes a caption placed beside the card (not below it)', () => {
    /**
     * The 16:9 layout puts the caption BESIDE the card, not below — the
     * gap rule must not fire for that layout, since it addresses only the
     * below-the-card overlap risk.
     */
    const card = { x: 100, y: 100, w: 200, h: 500 };
    const caption = { x: 400, y: 300, w: 200, h: 60 }; // beside, same y-range as the card
    expect(checkCardCaptionGap(card, caption)).toEqual([]);
  });
});

describe('checkCardSteadyAnchor', () => {
  it('fails a steady card on an odd pixel even when within the distance tolerance', () => {
    /**
     * Verifies the round-7 measured defect: card B at the odd (325, 73) —
     * only 1.41px from the even (324, 72), inside the 2px distance
     * tolerance — scored 0.918 SSIM against 0.994 at the even spot,
     * because the yuv420p master's 2x2 chroma blocks make odd-pixel
     * placement visibly worse. A check that only measured distance from
     * steady_at would have missed this regression entirely.
     */
    expect(checkCardSteadyAnchor({ x: 325, y: 73 }, { x: 324, y: 72 }).length).toBeGreaterThan(0);
  });

  it('fails a steady card far outside the distance tolerance', () => {
    expect(checkCardSteadyAnchor({ x: 340, y: 90 }, { x: 324, y: 72 }).length).toBeGreaterThan(0);
  });

  it('passes a card exactly on its even steady_at spot', () => {
    expect(checkCardSteadyAnchor({ x: 324, y: 72 }, { x: 324, y: 72 })).toEqual([]);
  });
});

describe('checkUniformContentScale', () => {
  it('fails a morph frame whose content is stretched (non-uniform scale)', () => {
    /**
     * Verifies: "never stretched... the eval fails a stretched morph."
     * A content box whose x/y scale factors differ means the crop was
     * drawn at two different magnifications per axis, which visibly
     * distorts the popup take.
     */
    const cropRect = { x: 0, y: 0, w: 100, h: 50 };
    const contentBox = { w: 200, h: 80 }; // scaleX=2, scaleY=1.6
    expect(checkUniformContentScale(cropRect, contentBox).length).toBe(1);
  });

  it('passes a content box scaled uniformly from its crop rect', () => {
    const cropRect = { x: 0, y: 0, w: 100, h: 50 };
    const contentBox = { w: 200, h: 100 }; // both axes 2x
    expect(checkUniformContentScale(cropRect, contentBox)).toEqual([]);
  });
});

describe('checkCardEndsAfterMousedown', () => {
  it('fails a b3e frame later than CARD_END_MOUSEDOWN_OFFSET_MS after add_mousedown', () => {
    /**
     * Verifies: "b3e ends at add_mousedown+160 with a hard cut to
     * s3_sheet" — a card that lingers past +160ms would show the mouseup
     * (which grows the roster) leaking into the adoption card beat.
     */
    expect(checkCardEndsAfterMousedown(1000 + 161, 1000).length).toBe(1);
  });

  it('passes a b3e frame at or before add_mousedown+160', () => {
    expect(checkCardEndsAfterMousedown(1000 + 160, 1000)).toEqual([]);
  });
});

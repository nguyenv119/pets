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
  checkCardFrameContent,
  checkInsideRect,
  particleColumn,
  rectsIntersect,
} from './checks';
import { CTA_GAP_PX, PILL, textWidth } from './overlays';

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

  it('fails a crop whose edge cuts through Rex\'s box (a clipped pet)', () => {
    /**
     * A crop edge THROUGH a pet is the worst case of the margin rule: half a dog on screen. The box
     * reaches into the crop, so it is visible, and its distance to the edge is negative.
     */
    const crop = { x: 480, y: 492, w: 960, h: 540 };
    const rex = { x: 440, y: 856, w: 128, h: 128 }; // straddles the crop's left edge at x 480
    expect(checkCropPetMargin(crop, [rex], pageBounds).some((v) => v.detail.startsWith('left'))).toBe(true);
  });

  it('ignores a pet wholly outside the crop (not on screen)', () => {
    const crop = { x: 480, y: 492, w: 960, h: 540 };
    expect(checkCropPetMargin(crop, [{ x: 100, y: 856, w: 128, h: 128 }], pageBounds)).toEqual([]);
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

describe('acceptance 4: the s4 end card', () => {
  it('passes with all three pets asleep at 2.0x and the brand line plus the CTA (two credit lines) above them', () => {
    /**
     * The approved end card must be renderable: sleeping pets emit no particles, so only the 80 px box
     * rule applies, and the brand line + CTA block (laid out exactly as overlays.ts does: brand 84 px,
     * 24 px gap, CTA lines with 12 px gaps) fits above the pets. If this failed, the film could not end.
     */
    // GIVEN — Rex, Pip, Bao at CSS x 340/400/460 at 2.0x, crop x 640: 128x128 output boxes standing on y 984
    const pets = [340, 400, 460].map((x) => ({ x: (x * 2 - 640) * 2, y: 984 - 256, w: 256, h: 256 }));
    const cta = [128, 64, 52, 28, 28];
    const ctaH = cta.reduce((a, b) => a + b, 0) + CTA_GAP_PX * (cta.length - 1);
    const blockH = 84 + 24 + ctaH;
    const top = Math.min(...pets.map((p) => p.y)) - 80 - blockH;
    const brand = { x: 160, y: top, w: textWidth("They're not much, but they're yours.", 'VT323', 84), h: 84 };
    const ctaRect = { x: 160, y: top + 84 + 24, w: 940, h: ctaH };
    // WHEN / THEN
    expect(top).toBeGreaterThanOrEqual(48);
    expect(checkOverlayPetDistance(brand, pets)).toEqual([]);
    expect(checkOverlayPetDistance(ctaRect, pets)).toEqual([]);
  });
});

describe('acceptance 4: popup card frames', () => {
  const B = { x: 40, y: 793, w: 315, h: 467 }; // the measured B_pick, native px
  const steady16 = { x: 324, y: 72, w: 630, h: 934 };
  const steady916 = { x: 224, y: 250, w: 630, h: 934 };
  const pill = { w: textWidth('adopt: pick one.', 'VT323', 72) + 2 * (PILL.padX + PILL.border), h: 2 * 72 + 2 * (PILL.padY + PILL.border) };

  it('fails a card frame whose crop touches the fox cell\'s DOMRect', () => {
    /** A crop that meets a forbidden cell shows an uncast species; the render must fail on that frame. */
    const fox = { type: 'fox', rect: { x: 506, y: 975, w: 133, h: 127 } };
    const wide = { x: 40, y: 793, w: 470, h: 467 };
    expect(checkCardFrameContent(wide, wide, [fox], { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }).some((v) => v.check === 'card-forbidden-cell')).toBe(true);
  });

  it('passes the measured B at 2x on its 16:9 and 9:16 steady spots with the caption in its fixed rect', () => {
    /** overlays.popup_card.placement: B 630x934 fits both frames and the caption keeps 40 px from it in each. */
    const cap16 = { x: 1320, y: Math.round(540 - pill.h / 2), ...pill };
    const cap916 = { x: Math.round(60 + (840 - pill.w) / 2), y: Math.round(1224 + (236 - pill.h) / 2), ...pill };
    expect(steady16.x + steady16.w <= 1920 && steady16.y + steady16.h <= 1080).toBe(true);
    expect(steady916.x + steady916.w <= 1080 && steady916.y + steady916.h <= 1920).toBe(true);
    expect(checkCardCaptionGap(steady16, cap16)).toEqual([]);
    expect(checkInsideRect(cap16, { x: 1320, y: 380, w: 560, h: 320 }, 'caption')).toEqual([]);
    expect(checkCardCaptionGap(steady916, cap916)).toEqual([]);
    expect(checkInsideRect(cap916, { x: 60, y: 1224, w: 840, h: 236 }, 'caption')).toEqual([]);
  });

  it('fails a caption placed below B in 16:9 (it cannot clear the card inside the frame)', () => {
    const below = { x: 324, y: steady16.y + steady16.h + 10, ...pill };
    expect(checkCardCaptionGap(steady16, below).length + checkInsideRect(below, { x: 0, y: 0, w: 1920, h: 1080 }, 'caption').length).toBeGreaterThan(0);
  });

  it('fails a morph frame whose drawn region is wider than the incoming crop scaled to the frame', () => {
    /** A mask over a wider popup region shows cells outside the crop; the content box must sit inside the card frame. */
    const envelope = { x: 324, y: 72, w: 630, h: 934 };
    const content = { x: 300, y: 72, w: 700, h: 934 }; // spills past the frame
    expect(checkCardFrameContent(B, B, [], content, envelope).some((v) => v.check === 'card-content-in-frame')).toBe(true);
  });

  it('passes a pop-in frame whose integer box rounds one uniform scale', () => {
    /** 0.94 x 1000x397 = 940x373.18: an integer box can only round, and must not be called stretched. */
    expect(checkUniformContentScale({ x: 0, y: 372, w: 1000, h: 397 }, { w: 940, h: 373 })).toEqual([]);
  });
});

describe('CHECK_THRESHOLDS', () => {
  it('is the one source of every render-check number', () => {
    /** The epic freezes these for pets-o3p.5; this pins the specified values so a silent loosening fails here. */
    expect(CHECK_THRESHOLDS).toEqual({
      CROP_EDGE_MARGIN_STAGE_PX: 16,
      CAPTION_TO_PET_OUTPUT_PX: 80,
      PARTICLE_COLUMN_WIDEN_CSS_PX: 24,
      PARTICLE_COLUMN_UP_CSS_PX: 80,
      CARD_CAPTION_GAP_PX: 40,
      CARD_ANCHOR_TOLERANCE_PX: 2,
      CARD_END_MOUSEDOWN_OFFSET_MS: 160,
      CARD_CONTENT_ROUNDING_PX: 0.5,
      PARTICLE_LIFETIME_MS: 1500,
    });
  });
});

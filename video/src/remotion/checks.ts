// Render-failing framing checks (epic pets-o3p, bead pets-o3p.4). Every
// threshold lives in the single exported CHECK_THRESHOLDS constant, frozen
// for pets-o3p.5 by the epic ("Freeze" in the epic description) — a real
// take that trips one of these is fixed by a new take or a follow-up bead,
// never by relaxing a threshold here.
//
// Pure — no Remotion/React/Node imports — so it is unit-testable without a
// render. render.mjs (pets-o3p.4 implementation step 4) is responsible for
// calling these per-frame during a render and aborting, naming the frame
// and the element, on any failure; that wiring is NOT part of this file.

import type { Rect } from '../schema';

export const CHECK_THRESHOLDS = {
  /** A crop edge must not sit within this many stage px of a visible pet box, unless it is the page edge. */
  CROP_EDGE_MARGIN_STAGE_PX: 16,
  /** A caption, name tag, clock, brand line or CTA must not sit within this many output px of a pet box. */
  CAPTION_TO_PET_OUTPUT_PX: 80,
  /** The particle column is a pet's box widened by this many CSS px on each side... */
  PARTICLE_COLUMN_WIDEN_CSS_PX: 24,
  /** ...and extended this many CSS px upward from the box's top. */
  PARTICLE_COLUMN_UP_CSS_PX: 80,
  /** A caption below the popup card must clear the card by at least this many output px. */
  CARD_CAPTION_GAP_PX: 40,
  /** A steady card must sit within this many output px of its declared `steady_at` anchor. */
  CARD_ANCHOR_TOLERANCE_PX: 2,
  /** b3e's last frame must be no later than this many ms after the logged add_mousedown. */
  CARD_END_MOUSEDOWN_OFFSET_MS: 160,
} as const;

export type CheckThresholds = typeof CHECK_THRESHOLDS;

export interface CheckViolation {
  check: string;
  detail: string;
}

const rectRight = (r: Rect) => r.x + r.w;
const rectBottom = (r: Rect) => r.y + r.h;

/** Whether two rectangles overlap (touching edges do not count as overlap). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

/**
 * The particle column for a pet box: the box widened by
 * `PARTICLE_COLUMN_WIDEN_CSS_PX` on each side and extended
 * `PARTICLE_COLUMN_UP_CSS_PX` upward from its top (storyboard: "the
 * particle column (box x widened by 24 CSS px, extended 80 CSS px up) of a
 * pet that can emit particles").
 */
export function particleColumn(petBox: Rect, thresholds: CheckThresholds = CHECK_THRESHOLDS): Rect {
  const widen = thresholds.PARTICLE_COLUMN_WIDEN_CSS_PX;
  const up = thresholds.PARTICLE_COLUMN_UP_CSS_PX;
  return {
    x: petBox.x - widen,
    y: petBox.y - up,
    w: petBox.w + widen * 2,
    h: petBox.h + up,
  };
}

/**
 * A crop edge (not the page edge) within `CROP_EDGE_MARGIN_STAGE_PX` of a
 * visible pet box fails the render. `pageBounds` names the full page so an
 * edge that coincides with it is exempted (storyboard: "unless it is the
 * page edge").
 */
export function checkCropPetMargin(
  crop: Rect,
  petBoxes: readonly Rect[],
  pageBounds: Rect,
  thresholds: CheckThresholds = CHECK_THRESHOLDS,
): CheckViolation[] {
  const margin = thresholds.CROP_EDGE_MARGIN_STAGE_PX;
  const violations: CheckViolation[] = [];
  const atLeftEdge = crop.x <= pageBounds.x;
  const atRightEdge = rectRight(crop) >= rectRight(pageBounds);
  const atTopEdge = crop.y <= pageBounds.y;
  const atBottomEdge = rectBottom(crop) >= rectBottom(pageBounds);

  for (const pet of petBoxes) {
    const distLeft = pet.x - crop.x;
    const distRight = rectRight(crop) - rectRight(pet);
    const distTop = pet.y - crop.y;
    const distBottom = rectBottom(crop) - rectBottom(pet);

    if (!atLeftEdge && distLeft >= 0 && distLeft < margin) {
      violations.push({ check: 'crop-pet-margin', detail: `left crop edge ${distLeft}px from pet box (margin ${margin})` });
    }
    if (!atRightEdge && distRight >= 0 && distRight < margin) {
      violations.push({ check: 'crop-pet-margin', detail: `right crop edge ${distRight}px from pet box (margin ${margin})` });
    }
    if (!atTopEdge && distTop >= 0 && distTop < margin) {
      violations.push({ check: 'crop-pet-margin', detail: `top crop edge ${distTop}px from pet box (margin ${margin})` });
    }
    if (!atBottomEdge && distBottom >= 0 && distBottom < margin) {
      violations.push({ check: 'crop-pet-margin', detail: `bottom crop edge ${distBottom}px from pet box (margin ${margin})` });
    }
  }
  return violations;
}

/** Distance between two rectangles' nearest edges, 0 when they overlap. */
function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - rectRight(b), b.x - rectRight(a), 0);
  const dy = Math.max(a.y - rectBottom(b), b.y - rectBottom(a), 0);
  return Math.hypot(dx, dy);
}

/**
 * Any text overlay (caption, name tag, clock, brand line, CTA) within
 * `CAPTION_TO_PET_OUTPUT_PX` of a pet box fails the render.
 */
export function checkOverlayPetDistance(
  overlayRect: Rect,
  petBoxes: readonly Rect[],
  thresholds: CheckThresholds = CHECK_THRESHOLDS,
): CheckViolation[] {
  const min = thresholds.CAPTION_TO_PET_OUTPUT_PX;
  const violations: CheckViolation[] = [];
  for (const pet of petBoxes) {
    const d = rectDistance(overlayRect, pet);
    if (d < min) {
      violations.push({ check: 'overlay-pet-distance', detail: `overlay ${d}px from pet box (min ${min})` });
    }
  }
  return violations;
}

/**
 * An overlay inside a particle-emitting pet's particle column fails the
 * render (storyboard: "sleeping pets emit none; applying the column to
 * every pet makes the approved s4 end card impossible").
 */
export function checkParticleColumnOverlap(
  overlayRect: Rect,
  emittingPetBoxes: readonly Rect[],
  thresholds: CheckThresholds = CHECK_THRESHOLDS,
): CheckViolation[] {
  const violations: CheckViolation[] = [];
  for (const pet of emittingPetBoxes) {
    const column = particleColumn(pet, thresholds);
    if (rectsIntersect(overlayRect, column)) {
      violations.push({ check: 'particle-column-overlap', detail: 'overlay intersects an emitting pet\'s particle column' });
    }
  }
  return violations;
}

/**
 * A caption below the popup card in 16:9 must clear it by
 * `CARD_CAPTION_GAP_PX` (storyboard: "B is 934 px tall, so a caption below
 * it cannot fit the 1080 px frame" — the gap check applies wherever the
 * caption sits below rather than beside the card).
 */
export function checkCardCaptionGap(cardRect: Rect, captionRect: Rect, thresholds: CheckThresholds = CHECK_THRESHOLDS): CheckViolation[] {
  if (captionRect.y < rectBottom(cardRect)) {
    // Caption is beside (or overlapping) the card, not below it — the gap rule doesn't apply.
    return [];
  }
  const gap = captionRect.y - rectBottom(cardRect);
  if (gap < thresholds.CARD_CAPTION_GAP_PX) {
    return [{ check: 'card-caption-gap', detail: `caption ${gap}px below card (min ${thresholds.CARD_CAPTION_GAP_PX})` }];
  }
  return [];
}

/**
 * A steady card must sit within CARD_ANCHOR_TOLERANCE_PX of its declared
 * `steady_at` anchor, AND land on an EVEN output pixel on both axes.
 *
 * The even-pixel requirement is separate from (and independent of) the
 * distance tolerance: round 7 measured card B at (325, 73) — only 1.41px
 * from the even (324, 72), well inside a 2px distance tolerance — scoring
 * 0.918 SSIM against 0.994 at the even spot, because the master is
 * yuv420p and an odd-pixel placement straddles the 2x2 chroma blocks. A
 * distance-only check would have let that regression through.
 */
export function checkCardSteadyAnchor(
  cardAt: { x: number; y: number },
  steadyAt: { x: number; y: number },
  thresholds: CheckThresholds = CHECK_THRESHOLDS,
): CheckViolation[] {
  const violations: CheckViolation[] = [];
  const dist = Math.hypot(cardAt.x - steadyAt.x, cardAt.y - steadyAt.y);
  if (dist > thresholds.CARD_ANCHOR_TOLERANCE_PX) {
    violations.push({ check: 'card-steady-anchor', detail: `steady card ${dist.toFixed(2)}px from steady_at (tol ${thresholds.CARD_ANCHOR_TOLERANCE_PX})` });
  }
  if (!Number.isInteger(cardAt.x / 2) || !Number.isInteger(cardAt.y / 2)) {
    violations.push({ check: 'card-steady-anchor', detail: `steady card at (${cardAt.x}, ${cardAt.y}) is not on an even output pixel` });
  }
  return violations;
}

/**
 * The card's content box must scale its source crop UNIFORMLY (one
 * factor for both axes). A stretched morph fails (storyboard: "never
 * stretched... the eval fails a stretched morph").
 */
export function checkUniformContentScale(cropRect: Rect, contentBox: { w: number; h: number }): CheckViolation[] {
  if (cropRect.w <= 0 || cropRect.h <= 0) {
    return [{ check: 'uniform-content-scale', detail: 'crop rect has non-positive dimension' }];
  }
  const scaleX = contentBox.w / cropRect.w;
  const scaleY = contentBox.h / cropRect.h;
  // Compare within floating-point tolerance; content boxes are computed from
  // integer scales in practice, so a real mismatch is far larger than this.
  if (Math.abs(scaleX - scaleY) > 1e-6) {
    return [{ check: 'uniform-content-scale', detail: `non-uniform scale: x=${scaleX}, y=${scaleY}` }];
  }
  return [];
}

/**
 * A b3e (Add Pet) card frame must not extend past
 * `CARD_END_MOUSEDOWN_OFFSET_MS` after the logged `add_mousedown` (so the
 * pressed button stays on screen for 2-3 frames and the card cuts away
 * before the mouseup that grows the roster).
 */
export function checkCardEndsAfterMousedown(
  frameSourceT: number,
  addMousedownT: number,
  thresholds: CheckThresholds = CHECK_THRESHOLDS,
): CheckViolation[] {
  const offset = frameSourceT - addMousedownT;
  if (offset > thresholds.CARD_END_MOUSEDOWN_OFFSET_MS) {
    return [{ check: 'card-end-mousedown', detail: `card frame ${offset}ms after add_mousedown (max ${thresholds.CARD_END_MOUSEDOWN_OFFSET_MS})` }];
  }
  return [];
}

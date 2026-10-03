import { describe, expect, it } from 'vitest';
import type { Rect } from '../schema';
import { STAGE_16X9 } from './camera';
import {
  checkCropOnFrameBottom,
  CHECK_THRESHOLDS,
  checkCardCaptionGap,
  checkCardEndsAfterMousedown,
  checkCardFrameContent,
  checkCardSteadyAnchor,
  checkCropPetMargin,
  checkInsideRect,
  checkOverlayPetDistance,
  checkParticleColumnOverlap,
  checkSteadyAtOnAnchor,
  checkUniformContentScale,
  particleColumn,
  rectsIntersect,
} from './checks';
import { buildOverlays } from './overlays';
import { runRenderChecks } from './renderChecks';
import { loadShots, makeEvents, stillPets, syntheticCardEdit } from './testEvents';
import { buildTimeline, type PopupCardPlacement } from './timeline';

describe('rectsIntersect', () => {
  it('reports overlap for two rectangles that share interior area', () => {
    /**
     * What: two rectangles sharing interior area intersect.
     * Why: every framing check in this file is built on this primitive.
     * What breaks: every downstream check is wrong silently.
     */
    // GIVEN
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    // WHEN
    const hit = rectsIntersect(a, b);
    // THEN
    expect(hit).toBe(true);
  });

  it('does not report overlap for two rectangles that only touch at an edge', () => {
    /**
     * What: touching edges are not an intersection.
     * Why: an overlay merely adjacent to a particle column is not inside it.
     * What breaks: the particle check fails captions that never overlap the particles.
     */
    // GIVEN
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 10, y: 0, w: 10, h: 10 };
    // WHEN
    const hit = rectsIntersect(a, b);
    // THEN
    expect(hit).toBe(false);
  });
});

describe('checkCropPetMargin', () => {
  const pageBounds = { x: 0, y: 0, w: 1920, h: 1080 };

  it('fails a crop whose edge sits within the margin of a visible pet box', () => {
    /**
     * What: "a crop edge within 16 stage px of a visible pet box (unless it is the page edge)" fails.
     * Why: a crop edge that nearly clips a pet reads as an accidental framing.
     * What breaks: near-clipped pets ship in the master.
     */
    // GIVEN — the pet's left edge 5 px inside the crop's left edge
    const crop = { x: 100, y: 0, w: 500, h: 500 };
    const pet = { x: 105, y: 200, w: 40, h: 40 };
    // WHEN
    const violations = checkCropPetMargin(crop, [pet], pageBounds);
    // THEN
    expect(violations.length).toBeGreaterThan(0);
  });

  it('passes a crop whose edges clear every pet box by the margin', () => {
    /**
     * What: a comfortably clear crop passes.
     * Why: the check must be passable by an honest render.
     * What breaks: every zoomed beat aborts.
     */
    // GIVEN
    const crop = { x: 100, y: 0, w: 500, h: 500 };
    const pet = { x: 300, y: 200, w: 40, h: 40 };
    // WHEN
    const violations = checkCropPetMargin(crop, [pet], pageBounds);
    // THEN
    expect(violations).toEqual([]);
  });

  it("fails a crop whose edge cuts through Rex's box (a clipped pet)", () => {
    /**
     * What: a crop edge THROUGH a pet (negative distance) fails on that edge.
     * Why: half a dog on screen is the worst case of the margin rule.
     * What breaks: clipped pets pass because their distance is negative, not small.
     */
    // GIVEN — Rex straddles the crop's left edge at x 480
    const crop = { x: 480, y: 492, w: 960, h: 540 };
    const rex = { x: 440, y: 856, w: 128, h: 128 };
    // WHEN
    const violations = checkCropPetMargin(crop, [rex], pageBounds);
    // THEN
    expect(violations.some((v) => v.detail.startsWith('left'))).toBe(true);
  });

  it('ignores a pet wholly outside the crop (not on screen)', () => {
    /**
     * What: a pet the crop does not show cannot be clipped by it.
     * Why: a 2.0x crop on one pet always leaves the others off screen.
     * What breaks: every focused beat fails for pets nobody can see.
     */
    // GIVEN
    const crop = { x: 480, y: 492, w: 960, h: 540 };
    const elsewhere = { x: 100, y: 856, w: 128, h: 128 };
    // WHEN
    const violations = checkCropPetMargin(crop, [elsewhere], pageBounds);
    // THEN
    expect(violations).toEqual([]);
  });

  it('exempts a crop edge that coincides with the page edge', () => {
    /**
     * What: "unless it is the page edge": a crop clamped to the page edge may sit next to a pet.
     * Why: floorAnchoredCrop clamps to the page; that edge is the page's, not a framing choice.
     * What breaks: a pet near the page edge can never be zoomed on.
     */
    // GIVEN — the pet 2 px from the crop's left edge, which is the page edge
    const crop = { x: 0, y: 0, w: 500, h: 500 };
    const pet = { x: 2, y: 200, w: 40, h: 40 };
    // WHEN
    const violations = checkCropPetMargin(crop, [pet], pageBounds);
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('checkOverlayPetDistance', () => {
  it('fails an overlay within CAPTION_TO_PET_OUTPUT_PX of a pet box', () => {
    /**
     * What: any caption, name tag, clock, brand line or CTA within 80 output px of a pet box fails.
     * Why: text crowding a sprite reads as a layout bug and hides the action.
     * What breaks: captions sit on the pets.
     */
    // GIVEN — the pet 10 px from the overlay
    const overlay = { x: 0, y: 0, w: 200, h: 60 };
    const pet = { x: 210, y: 0, w: 40, h: 40 };
    // WHEN
    const violations = checkOverlayPetDistance(overlay, [pet], CHECK_THRESHOLDS);
    // THEN
    expect(violations.length).toBe(1);
  });

  it('passes an overlay comfortably clear of every pet box', () => {
    /**
     * What: an overlay far from every pet passes.
     * Why: the honest layout must pass.
     * What breaks: every captioned beat aborts.
     */
    // GIVEN
    const overlay = { x: 0, y: 0, w: 200, h: 60 };
    const pet = { x: 2000, y: 2000, w: 40, h: 40 };
    // WHEN
    const violations = checkOverlayPetDistance(overlay, [pet], CHECK_THRESHOLDS);
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('particleColumn / checkParticleColumnOverlap', () => {
  it('widens a CSS box by 24 CSS px and extends it 80 CSS px up', () => {
    /**
     * What: the column geometry the storyboard names: "box x widened by 24 CSS px, extended 80 CSS px up".
     * Why: a wrong column either lets text sit in a particle burst or makes the s4 end card impossible.
     * What breaks: captions collide with hearts, or layouts that should fit are rejected.
     */
    // GIVEN — a box in CSS px
    const pet = { x: 100, y: 100, w: 40, h: 40 };
    // WHEN
    const column = particleColumn(pet);
    // THEN
    expect(column).toEqual({ x: 76, y: 20, w: 88, h: 120 });
  });

  it('scales the column to output px with the camera (4 output px per CSS px at 2.0x)', () => {
    /**
     * What: at a 2.0x hold one CSS px is 4 output px, so the column widens by 96 and rises 320 output px.
     * Why: framePets and the render checks call this with output-px boxes; the column must stay the
     * same CSS size at every zoom.
     * What breaks: at 2.0x the column shrinks to a quarter and captions land in the particles.
     */
    // GIVEN — an output-px box at 2.0x
    const box = { x: 800, y: 728, w: 256, h: 256 };
    // WHEN
    const column = particleColumn(box, 4);
    // THEN
    expect(column).toEqual({ x: 704, y: 408, w: 448, h: 576 });
  });

  it("fails an overlay inside an emitting pet's particle column", () => {
    /**
     * What: an overlay inside the widened, raised column fails.
     * Why: feed and catch particles rise through that column.
     * What breaks: text covers the particle burst the beat is about.
     */
    // GIVEN
    const pet = { x: 100, y: 100, w: 40, h: 40 };
    const overlay = { x: 80, y: 30, w: 20, h: 20 };
    // WHEN
    const violations = checkParticleColumnOverlap(overlay, [pet]);
    // THEN
    expect(violations.length).toBe(1);
  });

  it('passes an overlay clear of the particle column even when close to the pet box itself', () => {
    /**
     * What: an overlay outside the column passes this check (the box-distance check is separate).
     * Why: the two checks judge different things and must not double-report.
     * What breaks: one overlay is reported twice, hiding which rule it broke.
     */
    // GIVEN
    const pet = { x: 100, y: 100, w: 40, h: 40 };
    const overlay = { x: 300, y: 100, w: 20, h: 20 };
    // WHEN
    const violations = checkParticleColumnOverlap(overlay, [pet]);
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('checkCardCaptionGap', () => {
  it('fails a caption placed below the card without the minimum gap', () => {
    /**
     * What: a caption 20 px below the card fails the 40 px card-caption gap.
     * Why: the popup caption must read as a label beside the card, never as part of it.
     * What breaks: the caption butts against the card frame.
     */
    // GIVEN
    const card = { x: 100, y: 0, w: 200, h: 500 };
    const caption = { x: 100, y: 520, w: 200, h: 60 };
    // WHEN
    const violations = checkCardCaptionGap(card, caption);
    // THEN
    expect(violations.length).toBe(1);
  });

  it('passes a caption placed beside the card (not below it)', () => {
    /**
     * What: the 16:9 layout's caption beside the card passes.
     * Why: that is the approved layout.
     * What breaks: the adoption beats abort.
     */
    // GIVEN
    const card = { x: 100, y: 100, w: 200, h: 500 };
    const caption = { x: 400, y: 300, w: 200, h: 60 };
    // WHEN
    const violations = checkCardCaptionGap(card, caption);
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('checkCardSteadyAnchor', () => {
  it('fails a steady B frame at (326, 72), 2 px from steady_at (324, 72)', () => {
    /**
     * What: every steady card frame must sit on steady_at EXACTLY (verify.mjs v10: f.at === c.at).
     * Why: the old check allowed 2 px between the frame and steady_at, so (326, 72) passed here and
     * failed the eval's card declaration.
     * What breaks: a render passes its own checks and fails the epic eval.
     */
    // GIVEN
    const frameAt = { x: 326, y: 72 };
    // WHEN
    const violations = checkCardSteadyAnchor(frameAt, { x: 324, y: 72 });
    // THEN
    expect(violations.map((v) => v.check)).toEqual(['card-steady-anchor']);
  });

  it('fails a steady card on an odd pixel', () => {
    /**
     * What: (325, 73) fails both the exact-spot rule and the even-pixel rule.
     * Why: round 7 measured B at (325, 73) at 0.918 SSIM against 0.994 at (324, 72): yuv420p chroma.
     * What breaks: the card blurs in the master and the eval's card SSIM fails.
     */
    // GIVEN
    const frameAt = { x: 325, y: 73 };
    // WHEN
    const violations = checkCardSteadyAnchor(frameAt, { x: 324, y: 72 });
    // THEN
    expect(violations).toHaveLength(2);
  });

  it('passes a card exactly on its even steady_at spot', () => {
    /**
     * What: the steady card on steady_at passes.
     * Why: the honest card must pass.
     * What breaks: every card beat aborts.
     */
    // GIVEN
    const frameAt = { x: 324, y: 72 };
    // WHEN
    const violations = checkCardSteadyAnchor(frameAt, { x: 324, y: 72 });
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('checkSteadyAtOnAnchor', () => {
  const shots = loadShots();
  const placement = shots.overlays!.popup_card!.placement!;
  const sizes = { A_list: { w: 1000, h: 397 }, B_pick: { w: 630, h: 934 }, C_add: { w: 1000, h: 298 } } as const;

  // v2: updated by pets-3it.5 (the 16:9 card now hangs from the toolbar icon, anchor {icon_cx, top, margin_x}; v1 code reads anchor.cx/cy until .5 rewrites it)
  it.skip("passes every approved steady_at in shots.json against its aspect's anchor rule", () => {
    /**
     * What: each steady_at spot is the anchor rule (16:9 centred on (640, 540); 9:16 centred on x 540,
     * top at 250) rounded to even, within 2 output px, for the measured card sizes.
     * Why: the 2 px tolerance lives here, between steady_at and the rule, not between frame and steady_at.
     * What breaks: an approved spot would be rejected, or a wrong spot accepted.
     */
    for (const aspect of ['16x9', '9x16'] as const) {
      for (const crop of ['A_list', 'B_pick', 'C_add'] as const) {
        // GIVEN
        const at = placement.steady_at![aspect]![crop];
        const anchor = (placement[aspect] as PopupCardPlacement).anchor;
        // WHEN
        const violations = checkSteadyAtOnAnchor(at, sizes[crop], anchor);
        // THEN
        expect(violations, `${aspect} ${crop}`).toEqual([]);
      }
    }
  });

  it('fails a steady_at 4 px off the 16:9 anchor', () => {
    /**
     * What: a B spot at (328, 72) centres the card 4 px right of x 640 and fails.
     * Why: the spec allows only the rounding to even, not a moved card.
     * What breaks: a mistyped steady_at moves the card off the approved placement.
     */
    // GIVEN
    const anchor = (placement['16x9'] as PopupCardPlacement).anchor;
    // WHEN
    const violations = checkSteadyAtOnAnchor({ x: 328, y: 72 }, sizes.B_pick, anchor);
    // THEN
    expect(violations.map((v) => v.check)).toEqual(['card-anchor-rule']);
  });
});

describe('checkUniformContentScale', () => {
  it('fails a morph frame whose content is stretched (non-uniform scale)', () => {
    /**
     * What: a content box scaled 2x across and 1.6x down fails.
     * Why: "never stretched... the eval fails a stretched morph".
     * What breaks: the popup's sprites and text distort mid-morph.
     */
    // GIVEN
    const cropRect = { x: 0, y: 0, w: 100, h: 50 };
    const contentBox = { w: 200, h: 80 };
    // WHEN
    const violations = checkUniformContentScale(cropRect, contentBox);
    // THEN
    expect(violations.length).toBe(1);
  });

  it('passes a content box scaled uniformly from its crop rect', () => {
    /**
     * What: a 2x box of its crop passes.
     * Why: the honest steady B card is exactly this.
     * What breaks: B could never render.
     */
    // GIVEN
    const cropRect = { x: 0, y: 0, w: 100, h: 50 };
    const contentBox = { w: 200, h: 100 };
    // WHEN
    const violations = checkUniformContentScale(cropRect, contentBox);
    // THEN
    expect(violations).toEqual([]);
  });

  it('passes a pop-in frame whose integer box rounds one uniform scale', () => {
    /**
     * What: 0.94 x 1000x397 = 940x373.18 rounds to 940x373 and is not "stretched".
     * Why: integer boxes can only round; the eval allows that.
     * What breaks: every pop-in frame aborts.
     */
    // GIVEN
    const cropRect = { x: 0, y: 372, w: 1000, h: 397 };
    // WHEN
    const violations = checkUniformContentScale(cropRect, { w: 940, h: 373 });
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('checkCardFrameContent', () => {
  const B = { x: 40, y: 793, w: 315, h: 467 }; // the measured B_pick, native px

  it("fails a card frame whose crop touches the fox cell's DOMRect", () => {
    /**
     * What: a crop meeting a forbidden cell fails card-forbidden-cell.
     * Why: an uncast species on the adoption card breaks the story.
     * What breaks: a fox appears on the card.
     */
    // GIVEN — B widened to reach the fox cell
    const fox = { type: 'fox', rect: { x: 506, y: 975, w: 133, h: 127 } };
    const wide = { x: 40, y: 793, w: 470, h: 467 };
    // WHEN
    const violations = checkCardFrameContent(wide, wide, [fox], { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 });
    // THEN
    expect(violations.some((v) => v.check === 'card-forbidden-cell')).toBe(true);
  });

  it('fails a morph frame whose drawn region is wider than the incoming crop scaled to the frame', () => {
    /**
     * What: content spilling past the card's visible frame fails card-content-in-frame.
     * Why: a mask over a wider region shows popup cells outside the crop.
     * What breaks: a mask morph flashes the dog or Totoro cells for a few frames.
     */
    // GIVEN
    const envelope = { x: 324, y: 72, w: 630, h: 934 };
    const content = { x: 300, y: 72, w: 700, h: 934 };
    // WHEN
    const violations = checkCardFrameContent(B, B, [], content, envelope);
    // THEN
    expect(violations.some((v) => v.check === 'card-content-in-frame')).toBe(true);
  });
});

describe('checkCardEndsAfterMousedown', () => {
  it('fails a b3e frame later than CARD_END_MOUSEDOWN_OFFSET_MS after add_mousedown', () => {
    /**
     * What: a b3e frame 161 ms after add_mousedown fails.
     * Why: "b3e ends at add_mousedown+160"; later frames show the mouseup that grows the roster.
     * What breaks: the card shows a roster change the take never made honestly.
     */
    // GIVEN / WHEN
    const violations = checkCardEndsAfterMousedown(1000 + 161, 1000);
    // THEN
    expect(violations.length).toBe(1);
  });

  it('passes a b3e frame at or before add_mousedown+160', () => {
    /**
     * What: a frame exactly at +160 passes.
     * Why: the pressed Add Pet must stay on screen for its 2-3 frames.
     * What breaks: the press is cut before it shows.
     */
    // GIVEN / WHEN
    const violations = checkCardEndsAfterMousedown(1000 + 160, 1000);
    // THEN
    expect(violations).toEqual([]);
  });
});

describe('acceptance 4: the s4 end card (real buildOverlays)', () => {
  it('places the brand line and the CTA (two credit lines) clear of three sleeping pets at 2.0x', () => {
    /**
     * What: the real s4_article_night beats, planned with Rex, Pip and Bao asleep, give a brand line and a
     * CTA that buildOverlays places without a layout problem and that pass every overlay check on every
     * frame they show.
     * Why: sleeping pets emit no particles, so only the 80 px box rule applies; applying the column to
     * every pet would make the approved end card impossible.
     * What breaks: the film cannot end.
     */
    // GIVEN — three pets lying still at CSS x 340/400/460 from sleep on
    const shots = { ...loadShots(), edit_order: ['s4_article_night'] };
    const lie = (pet: string) => ({ t: 3000, kind: 'src' as const, pet, to: `media/${pet}/lie.gif` });
    const events = makeEvents({
      roster: [
        { id: 'rex', name: 'Rex', type: 'dog', color: 'brown' },
        { id: 'pip', name: 'Pip', type: 'chicken', color: 'white' },
        { id: 'bao', name: 'Bao', type: 'panda', color: 'black' },
      ],
      durationMs: 13000,
      tracks: stillPets({ rex: 340, pip: 400, bao: 460 }, 13000),
      observed: [{ t: 0, kind: 'first_paint' }, { t: 500, kind: 'pets_ready' }, { t: 3000, kind: 'sleep' }, lie('rex'), lie('pip'), lie('bao')],
    });
    const eventsByShotId = { s4_article_night: events };
    const edit = buildTimeline({ shots, stage: STAGE_16X9, aspect: '16x9', eventsByShotId, sourceByShotId: { s4_article_night: '/run/s4/demo.mp4' }, music: 'm' });
    // WHEN
    const items = buildOverlays({ edit, shots, eventsByShotId, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, outputHeight: 1080 });
    const endCard = items.filter((i) => i.kind === 'brand_line' || i.kind === 'cta');
    const violations = runRenderChecks({ edit, shots, eventsByShotId, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: endCard });
    // THEN
    const b7 = edit.beats.find((b) => b.name === 'b7_cta')!;
    expect(b7.crop!.w).toBe(960); // the 2.0x hold
    expect(endCard.map((i) => i.kind)).toEqual(['brand_line', 'cta']);
    expect(endCard.every((i) => i.layoutProblem === undefined)).toBe(true);
    expect(endCard[1].cta!.length).toBe(5); // icon line, two VT323 lines, two credit lines
    expect(violations.filter((v) => v.element.includes('brand_line') || v.element.includes('cta'))).toEqual([]);
  });
});

describe('acceptance 4: B on its placement (shots.json placement, buildOverlays caption)', () => {
  const shots = loadShots();

  for (const aspect of ['16x9', '9x16'] as const) {
    // v2: updated by pets-3it.5 (the 16:9 card now hangs from the toolbar icon, anchor {icon_cx, top, margin_x}; v1 code reads anchor.cx/cy until .5 rewrites it)
    (aspect === '16x9' ? it.skip : it)(`passes the gap and in-frame rules for the measured B at 2x in ${aspect}`, () => {
      /**
       * What: B (315x467 native at 2x = 630x934) on its shots.json steady_at keeps the 40 px gap from the
       * popup caption buildOverlays places, the caption sits in placement.caption_rect, and the card fits
       * the frame.
       * Why: the layout is read from shots.json and drawn by overlays.ts; hand-copied numbers would test
       * neither.
       * What breaks: the tallest card collides with its caption or leaves the frame.
       */
      // GIVEN
      const placement = shots.overlays!.popup_card!.placement![aspect] as PopupCardPlacement;
      const f = syntheticCardEdit(aspect);
      const b3d = f.edit.beats.find((b) => b.name === 'b3d_pick')!;
      const card: Rect = { ...b3d.card!.at, w: b3d.card!.rect.w * 2, h: b3d.card!.rect.h * 2 };
      // WHEN
      const caption = f.items.find((i) => i.kind === 'card_caption')!;
      // THEN
      const [W, H] = aspect === '16x9' ? [1920, 1080] : [1080, 1920];
      expect(b3d.card!.rect).toMatchObject({ w: 315, h: 467 });
      expect(card.x + card.w <= W && card.y + card.h <= H).toBe(true);
      expect(checkCardCaptionGap(card, caption.rect)).toEqual([]);
      expect(checkInsideRect(caption.rect, placement.caption_rect, 'caption')).toEqual([]);
    });
  }

  // v2: updated by pets-3it.5 (the 16:9 card now hangs from the toolbar icon, anchor {icon_cx, top, margin_x}; v1 code reads anchor.cx/cy until .5 rewrites it)
  it.skip('fails a caption placed below B in 16:9 (it cannot clear the card inside the frame)', () => {
    /**
     * What: buildOverlays' pill moved under B either touches the card or leaves the 1080 px frame.
     * Why: "B is 934 px tall, so a caption below it cannot fit the 1080 px frame".
     * What breaks: a 16:9 layout with the caption below would ship cut off.
     */
    // GIVEN
    const f = syntheticCardEdit('16x9');
    const b3d = f.edit.beats.find((b) => b.name === 'b3d_pick')!;
    const card: Rect = { ...b3d.card!.at, w: b3d.card!.rect.w * 2, h: b3d.card!.rect.h * 2 };
    const pill = f.items.find((i) => i.kind === 'card_caption')!.rect;
    const below = { ...pill, x: card.x, y: card.y + card.h + 10 };
    // WHEN
    const violations = [...checkCardCaptionGap(card, below), ...checkInsideRect(below, { x: 0, y: 0, w: 1920, h: 1080 }, 'caption')];
    // THEN
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('CHECK_THRESHOLDS', () => {
  it('is the one source of every render-check number', () => {
    /**
     * What: pins the specified values.
     * Why: the epic freezes these for pets-o3p.5.
     * What breaks: a silent loosening would let worse framing through every later render.
     */
    // GIVEN / WHEN / THEN
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

describe('checkCropOnFrameBottom', () => {
  it('passes a crop that ends on the frame bottom and fails one that ends above it', () => {
    /**
     * What: {y 540, h 540} on a 1080 stage passes; {y 492, h 540} (the v1 band-era 2.0x crop) fails, naming
     * both bottoms.
     * Why: shots.json master.stage: no floor band, pets stand on the frame bottom at every zoom.
     * What breaks: a crop above the frame bottom shows the pets floating, or cuts their feet off.
     */
    // GIVEN / WHEN
    const ok = checkCropOnFrameBottom({ x: 0, y: 540, w: 960, h: 540 }, 1080);
    const bad = checkCropOnFrameBottom({ x: 0, y: 492, w: 960, h: 540 }, 1080);
    // THEN
    expect(ok).toEqual([]);
    expect(bad).toEqual([{ check: 'crop-frame-bottom', detail: 'crop bottom at stage y 1032, not the frame bottom 1080' }]);
  });
});

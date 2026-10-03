import { describe, expect, it } from 'vitest';
import type { Events, TrackFrame } from '../schema';
import { buildCardTimeline, cardBeatFrameIndices, cardSteadyOf } from './cardTimeline';

const FPS = 25;

// Same real DOMRect samples as cardCrop.test.ts (shipped popup, 500x960 DPR2).
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
  t: 0,
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

function makeEvents(track: TrackFrame, spanMs: number): Events {
  // Constant DOMRects across the whole span — the popup layout is static within one card beat's crop.
  const tracks: TrackFrame[] = [];
  for (let t = 0; t <= spanMs; t += 20) tracks.push({ ...track, t });
  return {
    name: 'test',
    viewport: { width: 500, height: 960 },
    capture: { method: 'cdp-screencast', dpr: 2, fps: 25 },
    recordedAt: 0,
    extensionId: 'x',
    shim: 'fixture',
    roster: [],
    durationMs: spanMs,
    offsetMs: 0,
    trimBeforeMs: 0,
    videoLagMs: 0,
    cursorTrack: [],
    clicks: [],
    observed: [],
    tracks,
  };
}

describe('cardBeatFrameIndices', () => {
  it('lists exactly the master frames whose start falls in [masterIn, masterOut)', () => {
    /**
     * Mirrors verify.mjs's own frameIdx — the eval requires card.frames[]
     * to declare EVERY master frame the beat spans, no more and no fewer.
     * At 25fps a 1000ms beat spans exactly 25 frames (k=0..24); an
     * off-by-one here (25 or 26 frames) would leave a real frame
     * undeclared, which the eval's `missK` check fails outright.
     */
    const ks = cardBeatFrameIndices(0, 1000, FPS);
    expect(ks).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('offsets correctly when masterIn is not frame-aligned to 0', () => {
    /** A later card beat's masterIn is itself a rounded-to-frame value from timeline.ts, but this function must not assume masterIn===0. */
    const ks = cardBeatFrameIndices(2000, 4000, FPS);
    expect(ks[0]).toBe(50); // 2000ms / 40ms-per-frame
    expect(ks[ks.length - 1]).toBe(99);
  });
});

describe('buildCardTimeline — pop-in (no previous card beat)', () => {
  const events = makeEvents(READY_FRAME, 2000);
  const card = buildCardTimeline({
    cropName: 'A_list',
    scale: 1,
    steadyAt: { x: 140, y: 342 },
    viewportWidthCss: 500,
    events,
    fps: FPS,
    k0: 0,
    k1: 50,
    shiftMs: 0,
    transitionMs: 200,
    prevSteady: undefined,
  }).card;

  it('declares one frame for every master frame the beat spans', () => {
    /** verify.mjs judges "every master frame" (pop-in included) — a beat that skips frames during its own pop-in fails `missK` on exactly the frames a viewer would see it animating. */
    expect(card.frames).toHaveLength(50); // 2000ms / 40ms
  });

  it('lands exactly on the steady placement anchor once the 200ms pop-in ends', () => {
    /**
     * verify.mjs's offSteady check requires every frame from
     * master_in+0.25s onward to sit exactly on the declared steady `at`
     * with an exact scale*rect size — no interpolation residue. This is
     * the geometric contract PopupCard.tsx's rendering depends on: if the
     * pop-in "leaked" past 200ms, the card would visibly drift after
     * settling instead of holding still.
     */
    const settled = card.frames.filter((f) => f.t >= 200);
    expect(settled.length).toBeGreaterThan(0);
    for (const f of settled) {
      expect(f.at).toEqual({ x: 140, y: 342 });
      expect(f.w).toBe(1000); // A_list rect.w(1000) * scale(1)
      expect(f.h).toBe(397);
    }
  });

  it('starts smaller than steady size and rises into place, never starting already-steady', () => {
    /**
     * Verifies the pop-in actually animates (scale 0.94->1.0, y+24->0)
     * rather than being a no-op that happens to satisfy the settled-frame
     * check above. A pop-in that renders steady from frame 0 would still
     * pass every per-frame geometry check but would not be the "punchy
     * motion graphics" pop the storyboard asks for.
     */
    const first = card.frames[0];
    expect(first.w).toBeLessThan(1000);
    expect(first.h).toBeLessThan(397);
    expect(first.at.y).toBeGreaterThan(342); // "+24 to 0": starts offset downward from the steady y
  });

  it("keeps the content box's aspect uniform to the declared crop on every frame, transition included", () => {
    /**
     * The eval's ASPECT_TOL check (w/rect.w === h/rect.h within 2%) fails
     * a stretched sprite/text on ANY frame, not just steady ones — a
     * pop-in that scales x and y independently would fail this on every
     * transition frame even though the final steady frames are perfect.
     */
    for (const f of card.frames) {
      const sx = f.w / f.rect.w;
      const sy = f.h / f.rect.h;
      expect(Math.abs(sx / sy - 1)).toBeLessThanOrEqual(0.02);
    }
  });

  it('samples master_t in the middle of the steady frames, after the pop-in', () => {
    /**
     * master_t must sit inside the steady card (verify.mjs samples the
     * declared rect there), never on a pop-in frame, so the beat's sample
     * frame is the middle of frames 5..49 (200 ms = 5 frames of pop-in).
     */
    const built = buildCardTimeline({ cropName: 'A_list', scale: 1, steadyAt: { x: 140, y: 342 }, viewportWidthCss: 500, events, fps: FPS, k0: 0, k1: 50, shiftMs: 0, transitionMs: 200 });
    expect(built.sampleK).toBe(27);
    expect(built.envelopes).toHaveLength(50);
  });

  it("exposes this beat's steady box for the next card beat's morph envelope", () => {
    /** timeline.ts chains prevSteady across consecutive card beats from this helper's return value — if it disagreed with the frames actually declared, the next beat's morph would depart from the wrong size/position. */
    expect(cardSteadyOf(card)).toEqual({ at: { x: 140, y: 342 }, w: 1000, h: 397 });
  });
});

describe('buildCardTimeline — morph (following a card beat)', () => {
  const events = makeEvents(EXPANDED_FRAME, 2000);
  const prevSteady = { at: { x: 140, y: 342 }, w: 1000, h: 397 }; // A_list's steady box
  const card = buildCardTimeline({
    cropName: 'B_pick',
    scale: 2,
    steadyAt: { x: 324, y: 72 },
    viewportWidthCss: 500,
    events,
    fps: FPS,
    k0: 50,
    k1: 100,
    shiftMs: 0,
    transitionMs: 160,
    prevSteady,
  }).card;

  it('hard-cuts the content to the new crop at the morph start, never showing the previous crop', () => {
    /**
     * Storyboard: "the content hard-cuts to the next crop at the morph
     * start" — the FIRST morph frame's declared rect must already be
     * B_pick, not a lingering A_list. If the crop lagged even one frame
     * behind the size/position animation, the card would briefly show
     * stretched or mismatched content mid-morph.
     */
    expect(card.frames[0].rect).toEqual({ x: 40, y: 793, w: 315, h: 467 });
  });

  it('lands exactly on the new steady placement anchor once the 160ms morph ends', () => {
    /** Same contract as the pop-in case, for the morph's landing point — this is what lets timeline.ts treat every card beat's "settled" region uniformly. */
    const settled = card.frames.filter((f) => f.t - 2000 >= 160);
    expect(settled.length).toBeGreaterThan(0);
    for (const f of settled) {
      expect(f.at).toEqual({ x: 324, y: 72 });
      expect(f.w).toBe(630); // B_pick rect.w(315) * scale(2)
      expect(f.h).toBe(934);
    }
  });

  it("fits the new crop inside an envelope shrinking from the previous crop's steady footprint, never larger than either", () => {
    /**
     * Storyboard: "the largest [uniform factor] that fits inside the
     * frame's current size" — the very first morph frame's content box
     * must be bounded by whichever of the previous (A_list, 1000x397) or
     * next (B_pick, 630x934) steady box is the limiting dimension, never
     * exceeding both (which would mean the morph overshoots before
     * settling, a visible pop the storyboard doesn't ask for).
     */
    const first = card.frames[0];
    expect(first.w).toBeLessThanOrEqual(1000);
    expect(first.h).toBeLessThanOrEqual(934);
  });

  it("keeps the content box's aspect uniform to the declared crop on every frame, morph included", () => {
    for (const f of card.frames) {
      const sx = f.w / f.rect.w;
      const sy = f.h / f.rect.h;
      expect(Math.abs(sx / sy - 1)).toBeLessThanOrEqual(0.02);
    }
  });
});

describe('buildCardTimeline — steady rect is recomputed per frame, never frozen', () => {
  it('reflects a DOMRect change mid-beat rather than reusing the first frame\'s rect', () => {
    /**
     * Storyboard: "Rects are computed per frame from the logged
     * DOMRects, never hard-coded." A steady card beat whose form settles
     * into a slightly different position partway through (a real
     * recording's DOMRects are never bit-identical frame to frame) must
     * track that, not freeze on whatever the pop-in's first sample saw.
     */
    const shiftedLater: TrackFrame = { ...READY_FRAME, t: 1000, els: { ...READY_FRAME.els!, btn_add_toggle: { x: 20, y: 346.8, w: 460, h: 35.5 } } };
    const events = makeEvents(READY_FRAME, 900);
    events.tracks!.push(shiftedLater);
    const card = buildCardTimeline({
      cropName: 'A_list',
      scale: 1,
      steadyAt: { x: 140, y: 342 },
      viewportWidthCss: 500,
      events,
      fps: FPS,
      k0: 0,
    k1: 50,
    shiftMs: 0,
      transitionMs: 200,
      prevSteady: undefined,
    }).card;
    const late = card.frames.find((f) => Math.abs(f.t - 1000) < 1);
    expect(late?.rect.h).not.toBe(397); // the shifted btn_add_toggle moves the bottom edge, so the rect's height changes
  });
});

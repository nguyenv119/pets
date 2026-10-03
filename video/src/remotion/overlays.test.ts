import { describe, expect, it } from 'vitest';
import { rectDistance, rectsIntersect } from './checks';
import type { FrameView } from './framePets';
import { STAGE_16X9, STAGE_9X16 } from './camera';
import { buildOverlays, placeBesidePets, textWidth, wrapCaption } from './overlays';
import { runRenderChecks } from './renderChecks';
import { loadShots, loadSyntheticPopupEvents, makeEvents, stillPets } from './testEvents';
import { buildTimeline } from './timeline';

const AREA = { x: 48, y: 48, w: 1824, h: 936 };
const view = (pets: FrameView['pets']): FrameView => ({ beat: {} as FrameView['beat'], k: 0, unitsPerCss: 2, pets });

describe('wrapCaption', () => {
  it('wraps a 9:16 caption at 18 characters a line, on word boundaries', () => {
    /** vertical_9x16.captions: at most 18 characters a line, two lines. */
    expect(wrapCaption("there's a dog in my inbox.", 18)).toEqual(["there's a dog in", 'my inbox.']);
    expect(wrapCaption('hover: he waves.', 18)).toEqual(['hover: he waves.']);
  });
});

describe('textWidth', () => {
  it('matches the storyboard measurement of VT323 at 72 px', () => {
    /** shots.json measured "adopt: pick one." at 461 px; the layout and checks size pills from this. */
    expect(textWidth('adopt: pick one.', 'VT323', 72)).toBe(461);
  });
});

describe('placeBesidePets', () => {
  it('puts the caption beside the acting pet, 80 px clear of its box', () => {
    /** "beside the acting pet ... at least 80 px from the sprite box": the first choice is to its right. */
    const rex = { x: 600, y: 728, w: 256, h: 256 };
    const { rect, problem } = placeBesidePets(500, 102, [view([{ id: 'rex', box: rex }])], ['rex'], AREA, 'caption');
    expect(problem).toBeUndefined();
    expect(rect.x).toBe(600 + 256 + 80);
    expect(rectDistance(rect, rex)).toBeGreaterThanOrEqual(80);
  });

  it('keeps out of an emitting pet\'s particle column across every frame of the window', () => {
    /** A feed or catch throws particles up a column; a caption inside it would collide with the hearts. */
    const box = { x: 900, y: 728, w: 256, h: 256 };
    const column = { x: 708, y: 88, w: 640, h: 896 };
    const views = [view([{ id: 'rex', box, column }]), view([{ id: 'rex', box: { ...box, x: 300 } }])];
    const { rect, problem } = placeBesidePets(500, 102, views, ['rex'], AREA, 'caption');
    expect(problem).toBeUndefined();
    expect(rectsIntersect(rect, column)).toBe(false);
    expect(rectDistance(rect, { ...box, x: 300 })).toBeGreaterThanOrEqual(80);
  });

  it('reports a problem (a render-failing layout) when no spot clears the pets', () => {
    /** Nothing may silently overlap a pet: an impossible layout fails the render instead. */
    const wall = { x: 0, y: 0, w: 1920, h: 1080 };
    const { problem } = placeBesidePets(500, 102, [view([{ id: 'rex', box: wall }])], ['rex'], AREA, 'b1a caption');
    expect(problem).toMatch(/no spot for b1a caption/);
  });
});

describe('buildOverlays: the popup caption', () => {
  for (const aspect of ['16x9', '9x16'] as const) {
    it(`ends with the last card beat when a page shot follows, whatever the take's video lag (${aspect})`, () => {
      /**
       * What: the card caption (one layer across b3c-b3e) is on screen only on card frames, even when its
       * caption_out anchor ("add_mousedown+160", shifted by the take's videoLagMs and rounded) lands after
       * the last card beat's own end (the same anchor on the beat clock, which carries no lag).
       * Why: the caption sits in screen space where the card was; one frame later the next page shot's
       * pets stand there. Win attempt 1 (9:16) drew it on b4a_hi's first frame, 0 px from Rex's box, and
       * the render aborted.
       * What breaks: the 9:16 render aborts on overlay-pet-distance, or (unchecked) the pill flashes over
       * the pets for a frame after the hard cut.
       */
      // GIVEN — the synthetic popup take shown 100 ms late (VIDEO_LAG_MAX is 120), then s3_sheet with three pets on the floor
      const full = loadShots();
      const shots = { ...full, edit_order: ['s2b_shelter', 's3_sheet'] };
      const stage = aspect === '16x9' ? STAGE_16X9 : STAGE_9X16;
      const sheet = makeEvents({
        roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }, { id: 'pip', name: 'Pip', type: 'chicken', color: 'white' }, { id: 'bao', name: 'Bao', type: 'panda', color: 'black' }],
        durationMs: 5000,
        tracks: stillPets({ rex: 200, pip: 260, bao: 320 }, 5000),
        observed: [{ t: 0, kind: 'first_paint' }, { t: 500, kind: 'pets_ready' }],
      });
      const eventsByShotId = { s2b_shelter: { ...loadSyntheticPopupEvents(), videoLagMs: 100 }, s3_sheet: sheet };
      const edit = buildTimeline({ shots, stage, aspect, eventsByShotId, sourceByShotId: { s2b_shelter: '/r/s2b.mp4', s3_sheet: '/r/s3.mp4' }, music: 'm' });
      // WHEN
      const items = buildOverlays({ edit, shots, eventsByShotId, stage, aspect, outputWidth: stage.width, outputHeight: stage.height });
      // THEN
      const cards = edit.beats.filter((b) => b.card);
      const caption = items.find((i) => i.kind === 'card_caption')!;
      expect(caption.fromFrame).toBeGreaterThanOrEqual(cards[0].k0);
      expect(caption.toFrame).toBe(cards[cards.length - 1].k1);
      expect(runRenderChecks({ edit, shots, eventsByShotId, stage, aspect, outputWidth: stage.width, items: [caption] })).toEqual([]);
    });
  }
});

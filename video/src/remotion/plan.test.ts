import { describe, expect, it } from 'vitest';
import { sampleCursor } from './Cursor';
import { STAGE_16X9, STAGE_9X16 } from './camera';
import { buildPromoPlan, popupCursor, withSharpFrame, type PlanBeat } from './plan';
import { loadShots, loadSyntheticPopupEvents, makeEvents, reviewThenCardEdit, stillPets } from './testEvents';
import { buildTimeline, type ShotsDoc } from './timeline';

describe('popupCursor', () => {
  // GIVEN — a popup take that logs its clicks but no cursor path (the synthetic stand-in)
  const events = makeEvents({
    observed: [
      { t: 0, kind: 'popup_ready' },
      { t: 1000, kind: 'shelter_click', x: 250, y: 362 },
      { t: 1750, kind: 'name_click', x: 132, y: 422 },
      { t: 2010, kind: 'name_typed', x: 132, y: 422 },
      { t: 4300, kind: 'add_mousedown', x: 250, y: 830 },
    ],
  });
  const cursor = popupCursor(events, 250);

  it('puts the cursor tip exactly on every logged click point at its click time', () => {
    /**
     * Every popup click is aimed inside the crop on screen; a cursor elsewhere at the click would show
     * a ring away from the arrow, and the tip off the card.
     */
    for (const o of events.observed.filter((x) => x.kind !== 'popup_ready' && x.kind !== 'name_typed')) {
      expect(sampleCursor(cursor.track, o.t)).toMatchObject({ x: o.x, y: o.y });
    }
  });

  it('draws one ring per click, the Add Pet press included, and none for typing', () => {
    expect(cursor.clicks.map((c) => c.label)).toEqual(['shelter_click', 'name_click', 'add_mousedown']);
  });

  it('uses a take\'s own logged cursor path when it has one', () => {
    const own = makeEvents({ cursorTrack: [{ t: 0, x: 1, y: 2 }] });
    expect(popupCursor(own, 250).track).toEqual([{ t: 0, x: 1, y: 2 }]);
  });
});

describe('withSharpFrame', () => {
  it("adds a still's frame to the sharp frames of the beat that draws it, and only that beat", () => {
    /**
     * What: render.mjs --variant still renders one master frame (the thumbnail); that frame joins its beat's
     * sharpFrames, so Promo draws it without motion blur even when --at lands mid-move.
     * Why: a thumbnail is a single frame people see full size; a smeared one reads as a broken render.
     * What breaks: the README/store thumbnail is blurred whenever its anchor falls inside a push or follow.
     */
    // GIVEN — two beats, the second already sharp at 12
    const cursor = { track: [], clicks: [], trimBeforeMs: 0, videoLagMs: 0 };
    const beat = (name: string, k0: number, k1: number, sharpFrames: number[]): PlanBeat => ({ name, k0, k1, shiftFrames: 0, stagedSrc: 's', sharpFrames, cursor });
    const plan = { beats: [beat('a', 0, 10, [3]), beat('b', 10, 20, [12])] };
    // WHEN
    const out = withSharpFrame(plan, 15);
    // THEN
    expect(out.beats.map((b) => b.sharpFrames)).toEqual([[3], [12, 15]]);
    expect(plan.beats[1].sharpFrames).toEqual([12]); // the input plan is not mutated
  });
});

describe('buildPromoPlan: the chrome strip per page beat', () => {
  const roster = [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }];
  const shotsWith = (page?: string): ShotsDoc => ({
    fps: 25,
    edit_order: ['s1'],
    shots: [{ id: 's1', page, beats: [{ name: 'b_hold', in: 'pets_ready', out: 'pets_ready+800', camera: { zoom: 1, focus: 'page', move: 'hold', sample: 1 } }] }],
  });
  const plan = (shots: ShotsDoc, aspect: '16x9' | '9x16') => {
    const stage = aspect === '16x9' ? STAGE_16X9 : STAGE_9X16;
    const eventsByShotId = { s1: makeEvents({ roster, tracks: stillPets({ rex: 100 }, 20000, aspect === '16x9' ? 372 : 792), observed: [{ t: 500, kind: 'pets_ready' }] }) };
    const edit = buildTimeline({ shots, stage, aspect, eventsByShotId, sourceByShotId: { s1: '/r/s1.mp4' }, music: 'm' });
    return buildPromoPlan({ edit, shots, eventsByShotId, stagedByShotId: { s1: 's1/demo.mp4' }, stage, aspect, outputWidth: stage.width, outputHeight: stage.height, musicSrc: 'm', iconPath: 'i' });
  };

  it("names the shot page's chrome PNG, wide in the 16:9 and narrow in the 9:16", () => {
    /**
     * What: a review shot's page beat draws set/chrome/review.png in the 16:9 and set/chrome/review-narrow.png in
     * the 9:16 (shots.json master.stage.chrome.png and variants.vertical_9x16.chrome.png).
     * Why: the active tab and the URL in the chrome name the page being filmed.
     * What breaks: the review shot shows the inbox's tab and address, or the 9:16 shows a 1920-wide strip squeezed.
     */
    // GIVEN / WHEN
    const land = plan(shotsWith('review'), '16x9');
    const port = plan(shotsWith('review'), '9x16');
    // THEN
    expect(land.beats.map((b) => b.chromeSrc)).toEqual(['set/chrome/review.png']);
    expect(port.beats.map((b) => b.chromeSrc)).toEqual(['set/chrome/review-narrow.png']);
  });

  it('gives a card beat (the popup take, no frameCrops) no chrome strip', () => {
    /**
     * What: every beat of the real s2b_shelter popup take plans with chromeSrc undefined.
     * Why: a card beat draws the popup card on its own, not a page under the browser chrome; only page beats
     * (frameCrops) name a chrome PNG.
     * What breaks: the popup card renders with a page's tab strip stacked above it.
     */
    // GIVEN — the real popup shot and its synthetic take, in the 16:9
    const shots = { ...loadShots(), edit_order: ['s2b_shelter'] };
    const eventsByShotId = { s2b_shelter: loadSyntheticPopupEvents() };
    const edit = buildTimeline({ shots, stage: STAGE_16X9, aspect: '16x9', eventsByShotId, sourceByShotId: { s2b_shelter: '/r/s2b.mp4' }, music: 'm' });
    // WHEN
    const out = buildPromoPlan({ edit, shots, eventsByShotId, stagedByShotId: { s2b_shelter: 's2b/demo.mp4' }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, outputHeight: 1080, musicSrc: 'm', iconPath: 'i' });
    // THEN
    expect(out.beats.length).toBeGreaterThan(0);
    expect(out.beats.every((b) => b.frameCrops === undefined)).toBe(true);
    expect(out.beats.map((b) => b.chromeSrc)).toEqual(out.beats.map(() => undefined));
  });

  it('gives every card beat the review backdrop: its chrome over its last shown frame', () => {
    /**
     * What: each card beat plans backdrop = {chromeSrc: the review chrome, stagedSrc: the staged review
     * recording, frame: the source frame of the last review frame shown}, in both aspects.
     * Why: shots.json overlays.popup_card.backdrop: during s2b the chrome stays on screen and the card
     * hangs over the dimmed last review frame, a still (no cream field).
     * What breaks: the card floats on cream or on a moving page, and the eval's backdrop check fails.
     */
    for (const [aspect, stage, png] of [['16x9', STAGE_16X9, 'set/chrome/review.png'], ['9x16', STAGE_9X16, 'set/chrome/review-narrow.png']] as const) {
      // GIVEN
      const { shots, eventsByShotId, edit } = reviewThenCardEdit(aspect);
      const hold = edit.beats.find((b) => b.name === 'b_hold')!;
      // WHEN
      const out = buildPromoPlan({ edit, shots, eventsByShotId, stagedByShotId: { s2_review: 's2/demo.mp4', s2b_shelter: 's2b/demo.mp4' }, stage, aspect, outputWidth: stage.width, outputHeight: stage.height, musicSrc: 'm', iconPath: 'i' });
      // THEN
      const cards = out.beats.filter((b) => b.card);
      expect(cards.length).toBe(3);
      for (const c of cards) expect(c.backdrop).toEqual({ chromeSrc: png, stagedSrc: 's2/demo.mp4', frame: hold.k1 - 1 - Math.round(hold.shiftMs / 40) });
      expect(out.beats.find((b) => b.name === 'b_hold')!.backdrop).toBeUndefined();
    }
  });

  it('refuses a page shot that names no page', () => {
    /**
     * What: planning a page shot with no `page` throws, naming the shot.
     * Why: the stage has no chrome to draw without it; an empty strip would pass every plan check.
     * What breaks: a master renders with a blank strip over the page.
     */
    // GIVEN / WHEN / THEN
    expect(() => plan(shotsWith(undefined), '16x9')).toThrow(/page shot s1 declares no page/);
  });
});

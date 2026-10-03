import { describe, expect, it } from 'vitest';
import { sampleCursor } from './Cursor';
import { popupCursor, withSharpFrame, type PlanBeat } from './plan';
import { makeEvents } from './testEvents';

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

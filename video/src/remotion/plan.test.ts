import { describe, expect, it } from 'vitest';
import { sampleCursor } from './Cursor';
import { popupCursor } from './plan';
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

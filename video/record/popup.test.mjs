import { describe, expect, it } from 'vitest';
import { buildPopupEvents } from './popup.mjs';

/**
 * A popup take shaped like the real one that exposed the old origin: capture
 * started at epoch 10000, the start clapper releases at 10690.8, the first
 * keystroke lands at 12683.5 (2683.5 ms after capture start) and the end
 * clapper paints at 15000.
 */
function realShapedTake() {
  return {
    extensionId: 'ext',
    clapStart: { tOn: 10530, tOff: 10690.8 },
    clapEnd: { tOn: 15000, tOff: 15160 },
    popupReadyT: 10700,
    observed: [
      { t: 12683.5, kind: 'name_typed', x: 1, y: 2 },
      { t: 13500, kind: 'add_mousedown', x: 3, y: 4 },
    ],
    tracks: [
      { t: 10100, cells: [], els: {} },
      { t: 12000, cells: [], els: {} },
    ],
  };
}
const shot = { viewport: { width: 400, height: 600, device_scale_factor: 2 }, seed: { roster: [] } };
const doc = { fps: 25 };

describe('buildPopupEvents', () => {
  it('puts the start clapper release at t=0', () => {
    /**
     * Verifies the popup take uses the events.json contract's origin (the
     * start clapper's release), like the page recorder. The eval and the edit
     * place every popup event at demo.mp4 time trimBeforeMs + t; with capture
     * start as t=0, the typed "P" was looked for ~690 ms after it showed.
     */
    // GIVEN — the real-shaped popup take
    const take = realShapedTake();

    // WHEN — its events document is built
    const events = buildPopupEvents({ take, shot, doc });

    // THEN — the start clap is at 0, the end clap at its own offset, and durationMs ends on the end clap
    expect(events.observed.filter((e) => e.kind === 'clap').map((e) => e.t)).toEqual([0, 15000 - 10690.8]);
    expect(events.durationMs).toBeCloseTo(15000 - 10690.8, 6);
  });

  it('measures every action and track from the start clapper', () => {
    /**
     * Verifies observed[] and tracks[] share the one origin: the eval matches
     * a card crop to tracks[] at the same t it reads an action from
     * observed[]. A track logged before the clapper is negative, never moved.
     */
    // GIVEN — the real-shaped popup take
    const take = realShapedTake();

    // WHEN — its events document is built
    const events = buildPopupEvents({ take, shot, doc });

    // THEN — each time is its epoch minus 10690.8
    const at = (kind) => events.observed.find((e) => e.kind === kind)?.t;
    expect(at('name_typed')).toBeCloseTo(1992.7, 6);
    expect(at('add_mousedown')).toBeCloseTo(2809.2, 6);
    expect(at('popup_ready')).toBeCloseTo(9.2, 6);
    expect(events.tracks[0].t).toBeCloseTo(-590.8, 6);
    expect(events.tracks[1].t).toBeCloseTo(1309.2, 6);
  });
});

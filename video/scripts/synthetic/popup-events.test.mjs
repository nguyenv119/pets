// Pure-logic tests for the popup-take -> Events transform. No Chromium
// here (see make-synthetic-run.mjs's own run for the real capture
// evidence) — this only checks the time-shifting and shape logic against
// a hand-built capture() result.

import { describe, expect, it } from 'vitest';
import { buildPopupEvents } from './popup-events.mjs';

function fakeCapture(overrides = {}) {
  return {
    extensionId: 'abc123',
    recordStartT: 1_000_000,
    popupReadyT: 1_000_050,
    observed: [
      { t: 1_000_300, kind: 'shelter_click', x: 100, y: 200 },
      { t: 1_000_900, kind: 'add_mousedown', x: 50, y: 60 },
    ],
    tracks: [
      { t: 1_000_100, cells: [{ type: 'chicken', x: 1, y: 2, w: 3, h: 4 }], els: {} },
      { t: 1_000_020, cells: [], els: {} },
    ],
    ...overrides,
  };
}

describe('buildPopupEvents', () => {
  it('shifts every timestamp relative to recordStartT and sorts observed/tracks by time', () => {
    /**
     * Verifies every logged time (popup_ready, each observed event, each
     * track sample) is re-based to 0 at recordStartT, and that both lists
     * come out time-sorted even when the raw capture wasn't (tracks are
     * pushed here out of order to prove the sort, not just assumed).
     *
     * This matters because every downstream consumer (timeline.ts's
     * anchor resolution, the eval's per-frame track lookups) assumes
     * events.json's times are relative to the take's own start and
     * monotonically ordered — schema.ts's validateEvents checks exactly
     * this for cursorTrack, and the same assumption holds for tracks.
     *
     * If this breaks, every anchor this take resolves would be off by
     * recordStartT (huge — an absolute epoch, not a small offset), and an
     * out-of-order track list could make the "nearest sample" lookup pick
     * the wrong frame.
     */
    // GIVEN — a capture with recordStartT=1_000_000 and an out-of-order tracks list
    const capture = fakeCapture();

    // WHEN — building the events document
    const events = buildPopupEvents({ capture, roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }], viewport: { width: 500, height: 960 }, durationMs: 3000 });

    // THEN — every time is relative to recordStartT, and both lists are sorted
    expect(events.observed[0]).toEqual({ t: 50, kind: 'popup_ready' });
    expect(events.observed.map((e) => e.t)).toEqual([50, 300, 900]);
    expect(events.tracks.map((f) => f.t)).toEqual([20, 100]);
  });

  it('never emits add_mouseup or roster_saved, since the take never releases the press', () => {
    /**
     * Verifies the events document reflects that the synthetic take holds
     * the Add Pet press and never releases it — this bead's explicit
     * constraint against writing real storage beyond the seed.
     *
     * This matters because a downstream consumer that saw add_mouseup or
     * roster_saved would assume storage was actually written, which for
     * this take is never true.
     *
     * If this breaks (an add_mouseup or roster_saved appears from
     * upstream capture code by mistake), a reviewer or the eval could
     * wrongly treat this synthetic run as evidence the real adoption flow
     * was exercised.
     */
    // GIVEN — a capture whose observed[] (correctly) has no add_mouseup/roster_saved
    const capture = fakeCapture();

    // WHEN — building the events document
    const events = buildPopupEvents({ capture, roster: [], viewport: { width: 500, height: 960 }, durationMs: 3000 });

    // THEN — neither kind appears
    expect(events.observed.some((e) => e.kind === 'add_mouseup')).toBe(false);
    expect(events.observed.some((e) => e.kind === 'roster_saved')).toBe(false);
  });

  it('marks the run shim: "fixture" so it can never pass the epic eval', () => {
    // GIVEN / WHEN
    const events = buildPopupEvents({ capture: fakeCapture(), roster: [], viewport: { width: 500, height: 960 }, durationMs: 1000 });
    // THEN
    expect(events.shim).toBe('fixture');
  });
});

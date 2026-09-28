// Pure transform: turns a capturePopupTake() result (popup-take.mjs) into
// an Events-shaped document (schema.ts) for s2b_shelter. Kept separate from
// popup-take.mjs's Chromium/CDP plumbing so the time-shifting and shape
// logic can be unit-tested without a browser.

/**
 * Shifts every timestamp in `capture` to be relative to `recordStartT`
 * (the moment popup_ready's wait resolved) and assembles the Events
 * document schema.ts expects: `shim: "fixture"` (so this take can never
 * pass the epic eval), no `add_mouseup`/`roster_saved` (the take never
 * releases the press — see popup-take.mjs's header), and `durationMs` set
 * from the caller's measured capture length so it covers every logged
 * track/observed time.
 */
export function buildPopupEvents({ capture, roster, viewport, durationMs }) {
  const { extensionId, recordStartT, popupReadyT, observed, tracks } = capture;
  const shift = (t) => t - recordStartT;

  const shiftedObserved = [{ t: shift(popupReadyT), kind: 'popup_ready' }, ...observed.map((e) => ({ ...e, t: shift(e.t) }))].sort(
    (a, b) => a.t - b.t,
  );
  const shiftedTracks = tracks.map((f) => ({ t: shift(f.t), cells: f.cells, els: f.els })).sort((a, b) => a.t - b.t);

  return {
    name: 's2b_shelter',
    viewport,
    capture: { method: 'cdp-screencast', dpr: 2, fps: 25 },
    recordedAt: Date.now(),
    extensionId,
    url: `chrome-extension://${extensionId}/popup/popup.html`,
    shim: 'fixture',
    roster,
    durationMs,
    offsetMs: 0,
    trimBeforeMs: 0,
    videoLagMs: 0,
    cursorTrack: [],
    clicks: [],
    observed: shiftedObserved,
    tracks: shiftedTracks,
  };
}

// testEvents.ts: a minimal Events builder shared by the unit tests (test-only helper).

import type { Events, ObservedEvent, TrackFrame } from '../schema';

export function makeEvents(over: Partial<Events> & { observed?: ObservedEvent[]; tracks?: TrackFrame[] } = {}): Events {
  return {
    name: 'test',
    viewport: { width: 960, height: 540 },
    capture: { method: 'cdp-screencast', dpr: 2, fps: 25 },
    recordedAt: 0,
    extensionId: 'x',
    shim: 'fixture',
    roster: [],
    durationMs: 20000,
    offsetMs: 0,
    trimBeforeMs: 0,
    videoLagMs: 0,
    cursorTrack: [],
    clicks: [],
    observed: [],
    ...over,
  };
}

/** Pets standing still at fixed CSS x (y 476, 64x64 boxes, as the content script draws them), one track frame every 40 ms. */
export function stillPets(xs: Record<string, number>, untilMs = 20000): TrackFrame[] {
  const frames: TrackFrame[] = [];
  for (let t = 0; t <= untilMs; t += 40) frames.push({ t, pets: Object.entries(xs).map(([id, x]) => ({ id, x, y: 476, w: 64, h: 64, src: 'idle' })) });
  return frames;
}

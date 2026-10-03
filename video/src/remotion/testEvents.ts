// testEvents.ts: a minimal Events builder shared by the unit tests (test-only helper).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_16X9, STAGE_9X16 } from './camera';
import { buildOverlays, type TextItem } from './overlays';
import { buildTimeline, type EditTimeline, type ShotsDoc } from './timeline';
import type { Events, ObservedEvent, TrackFrame } from '../schema';

export function makeEvents(over: Partial<Events> & { observed?: ObservedEvent[]; tracks?: TrackFrame[] } = {}): Events {
  return {
    name: 'test',
    viewport: { width: 960, height: 436 },
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

/** Pets standing still at fixed CSS x, one track frame every 40 ms: 64x64 boxes at y innerHeight - 64, as the content script draws them (372 in the 960x436 viewport; pass 792 for the 9:16's 540x856). */
export function stillPets(xs: Record<string, number>, untilMs = 20000, y = 372): TrackFrame[] {
  const frames: TrackFrame[] = [];
  for (let t = 0; t <= untilMs; t += 40) frames.push({ t, pets: Object.entries(xs).map(([id, x]) => ({ id, x, y, w: 64, h: 64, src: 'idle' })) });
  return frames;
}

// --- Real spec and the committed synthetic popup take (test-only) -------


export const VIDEO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** video/shots.json, the approved spec, as the planners read it. */
export function loadShots(): ShotsDoc & { overlays?: Record<string, unknown>; variants?: Record<string, unknown> } {
  return JSON.parse(readFileSync(join(VIDEO_ROOT, 'shots.json'), 'utf8'));
}

/**
 * The synthetic run's s2b_shelter events (fixtures/s2b_shelter.synthetic.events.json):
 * tracks[] expanded back from its distinct states, exactly as make-synthetic-run.mjs wrote them.
 */
export function loadSyntheticPopupEvents(): Events {
  const raw = JSON.parse(readFileSync(join(VIDEO_ROOT, 'fixtures', 's2b_shelter.synthetic.events.json'), 'utf8')) as {
    events: Events;
    track_states: Pick<TrackFrame, 'cells' | 'els'>[];
    track_index: [number, number][];
  };
  return { ...raw.events, tracks: raw.track_index.map(([t, i]) => ({ t, ...raw.track_states[i] })) };
}

export interface CardEditFixture {
  shots: ShotsDoc;
  events: Events;
  edit: EditTimeline;
  items: TextItem[];
}

/** The three real card beats (b3c-b3e) planned on the synthetic popup take, with their text layers, for one aspect. */
export function syntheticCardEdit(aspect: '16x9' | '9x16', events: Events = loadSyntheticPopupEvents()): CardEditFixture {
  const full = loadShots();
  const shots = { ...full, edit_order: ['s2b_shelter'] };
  const stage = aspect === '16x9' ? STAGE_16X9 : STAGE_9X16;
  const edit = buildTimeline({ shots, stage, aspect, eventsByShotId: { s2b_shelter: events }, sourceByShotId: { s2b_shelter: '/run/s2b_shelter/demo.mp4' }, music: 'm' });
  const items = buildOverlays({ edit, shots, eventsByShotId: { s2b_shelter: events }, stage, aspect, outputWidth: stage.width, outputHeight: stage.height });
  return { shots, events, edit, items };
}

/** CSS px the v2 viewport loses at its top against the v1 fixture's 960x540: the chrome's 104 (shots.json master.stage.chrome.css_h). */
export const V1_FIXTURE_TOP_CUT_CSS = 104;

/**
 * fixtures/events.sample.json (a v1 960x540 take) as a v2 960x436 take: every
 * y moved up 104 CSS px, the same cut make-synthetic-run.mjs makes when it
 * crops the fixture video to 1920x872, so Rex stands at y 372 again.
 */
export function loadFixtureEventsV2(): Events {
  const e = JSON.parse(readFileSync(join(VIDEO_ROOT, 'fixtures', 'events.sample.json'), 'utf8')) as Events;
  const dy = -V1_FIXTURE_TOP_CUT_CSS;
  return {
    ...e,
    viewport: { width: 960, height: 436 },
    cursorTrack: e.cursorTrack.map((s) => ({ ...s, y: s.y + dy })),
    clicks: e.clicks.map((c) => ({ ...c, y: c.y + dy, rect: c.rect && { ...c.rect, y: c.rect.y + dy } })),
    observed: e.observed.map((o) => (typeof o.y === 'number' ? { ...o, y: o.y + dy } : o)),
  };
}

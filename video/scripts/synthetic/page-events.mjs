// Pure transforms that turn the committed fixture's observed events
// (fixtures/events.sample.json, a hover+treat+catch two-pet capture) into
// each synthetic page shot's events.json: renamed, re-rostered, missing
// anchors synthesized at plausible times, and a per-pet tracks[] array
// derived from the logged `src` (pet, from, to, x) transitions — never
// hand-invented positions, per the bead's step 6.
//
// No Node/browser APIs here (pure data in, data out), so this module is
// cheap to unit-test without Chromium or ffmpeg.

const BOX_W = 64;
const BOX_H = 64;
const BOX_Y = 476; // conventions.units: boxes sit at y 476-540 (innerHeight - 64)

/**
 * Returns every `src` event for `petId` that carries a numeric `x`, sorted
 * by time. `src` events are the only ones the recorder logs a pet's
 * position on (conventions.tracks), so they are the sole source of truth
 * for where a pet actually was at a given moment.
 */
function petSrcEvents(observed, petId) {
  return observed
    .filter((e) => e.kind === 'src' && e.pet === petId && typeof e.x === 'number')
    .sort((a, b) => a.t - b.t);
}

/**
 * Linearly interpolates pet `petId`'s x position at `tMs` between the two
 * bracketing logged `src` events, clamping to the first/last known x
 * outside the logged range. Never invents a position the fixture didn't
 * log (the bead's explicit rule): the result is always a convex
 * combination of two real observed x values, or one of them verbatim.
 */
export function interpolatePetX(observed, petId, tMs) {
  const events = petSrcEvents(observed, petId);
  if (events.length === 0) {
    throw new Error(`interpolatePetX: no src events with x for pet "${petId}"`);
  }
  if (tMs <= events[0].t) return events[0].x;
  if (tMs >= events[events.length - 1].t) return events[events.length - 1].x;

  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (tMs >= a.t && tMs <= b.t) {
      const u = b.t === a.t ? 0 : (tMs - a.t) / (b.t - a.t);
      return a.x + (b.x - a.x) * u;
    }
  }
  // unreachable given the bounds checks above
  return events[events.length - 1].x;
}

/** The pet's animation state (`src.to`) most recently logged at or before `tMs`; 'idle' before the first transition. */
export function currentPetState(observed, petId, tMs) {
  const events = observed
    .filter((e) => e.kind === 'src' && e.pet === petId && typeof e.to === 'string')
    .sort((a, b) => a.t - b.t);
  let state = 'idle';
  for (const e of events) {
    if (e.t > tMs) break;
    state = e.to;
  }
  return state;
}

/**
 * Builds a page shot's `tracks[]` (schema.ts TrackFrame[]) by sampling
 * every pet's interpolated x/state every `stepMs` across [0, durationMs].
 * y/w/h are the fixed sprite-box constants every page shot seeds with
 * (conventions.units, lib/browser.mjs seedStorage): only x and the
 * animation state vary, because that is all the recorder ever logs.
 */
export function buildPageTrackFrames({ observed, petIds, durationMs, stepMs = 40 }) {
  const frames = [];
  for (let t = 0; t <= durationMs; t += stepMs) {
    frames.push({
      t,
      pets: petIds.map((id) => ({
        id,
        x: interpolatePetX(observed, id, t),
        y: BOX_Y,
        w: BOX_W,
        h: BOX_H,
        src: currentPetState(observed, id, t),
      })),
    });
  }
  return frames;
}

/**
 * s1_inbox's synthesized observed[]: drops Rex's two EARLY `src`
 * transitions to "swipe" (the 3772 hover wave and the 5086 greet swipe),
 * so the anchor `src:rex:swipe` (b2a_hover's caption_at) resolves to the
 * fixture's SECOND wave at t=14403 instead of the first — the bead's
 * explicit remedy so b2a/b2b cover the real wave-and-treat frames
 * (mouseup:rex at 14729, heart_on at 14755) rather than the earlier greet.
 * Also drops the fixture's catch-only events (heart_on, catch, ball_on,
 * ball_off, ball_floor) before that wave: anchors resolve to the FIRST
 * match, so the fetch's heart_on at 12104 would otherwise make
 * `heart_on` land before the wave and give b2a/b2b empty spans.
 */
const S1_SECOND_WAVE_T = 14403;
/** The fixture's fetch (s2_review's action) logs these; an inbox take never does, and the first heart_on must be the treat's. */
const S1_CATCH_ONLY_KINDS = new Set(['heart_on', 'catch', 'ball_on', 'ball_off', 'ball_floor']);

export function buildS1InboxObserved(templateObserved) {
  return templateObserved.filter(
    (e) =>
      !(e.kind === 'src' && e.pet === 'rex' && e.to === 'swipe' && e.t < S1_SECOND_WAVE_T) &&
      !(S1_CATCH_ONLY_KINDS.has(e.kind) && e.t < S1_SECOND_WAVE_T),
  );
}

/**
 * s3_sheet needs `greet_start`/`greet_end` (b4a_hi/b4b_too's anchors),
 * which the two-pet hover/treat/catch fixture never logs (a three-pet
 * greet needs a third pet). Synthesizes both at plausible times inside
 * the accept-rule windows named in shots.json's s3_sheet.accept
 * ("greet_start arrives within 150 ms of pets_ready" / beats.actions'
 * `wait_state greet_end timeout_ms 1500`).
 */
export function buildS3SheetObserved(templateObserved, petsReadyT) {
  return [...templateObserved, { t: petsReadyT + 50, kind: 'greet_start' }, { t: petsReadyT + 1200, kind: 'greet_end' }].sort(
    (a, b) => a.t - b.t,
  );
}

/**
 * s4_article_night needs `hour_set`/`sleep` (b5_lights_out's overlay
 * clock and camera-push anchors), which the fixture never logs. Synthesizes
 * both at the times shots.json's s4_article_night.actions themselves name
 * (hold 1700 ms after pets_ready, then set_hour, then lie within 300 ms).
 */
export function buildS4ArticleNightObserved(templateObserved, petsReadyT) {
  const hourSetT = petsReadyT + 1700;
  const sleepT = hourSetT + 100;
  return [...templateObserved, { t: hourSetT, kind: 'hour_set' }, { t: sleepT, kind: 'sleep' }].sort((a, b) => a.t - b.t);
}

/**
 * Shifts every x/y-bearing field of an Events document by (dx, dy) CSS px,
 * for the 9:16 (v916) stand-in: the fixture is cropped to device x
 * 840-1920 and padded 380 px on top (dx=-420, dy=+190 in CSS px), so
 * every logged coordinate has to move with it or the camera and captions
 * would aim at the old, unpadded frame.
 */
export function shiftPortraitEvents(events, { dx, dy }) {
  const shiftXY = (obj) => (obj && typeof obj.x === 'number' && typeof obj.y === 'number' ? { ...obj, x: obj.x + dx, y: obj.y + dy } : obj);
  const shiftRect = (rect) => (rect ? { ...rect, x: rect.x + dx, y: rect.y + dy } : rect);

  return {
    ...events,
    cursorTrack: (events.cursorTrack ?? []).map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    clicks: (events.clicks ?? []).map((c) => ({ ...c, x: c.x + dx, y: c.y + dy, rect: shiftRect(c.rect) })),
    observed: (events.observed ?? []).map((e) => (typeof e.x === 'number' && typeof e.y === 'number' ? { ...e, x: e.x + dx, y: e.y + dy } : e)),
    tracks: (events.tracks ?? []).map((frame) => ({
      ...frame,
      pets: frame.pets ? frame.pets.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) : frame.pets,
      ball: frame.ball ? shiftXY(frame.ball) : frame.ball,
    })),
  };
}

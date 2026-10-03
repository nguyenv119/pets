// Pure event derivation: turns a raw capture log (page-side observations
// plus the choreography's own click log) into an Events document matching
// src/schema.ts. No browser, no filesystem — record.mjs supplies the raw
// log, this module only transforms it. See the bead's step 6 ("Event
// rules") for the derivation each function implements.

import { findPetsReady, isHoveredAt } from './timeline.mjs';

const CATCH_WINDOW_MS = 60;
const CATCH_X_TOLERANCE = 40;
const CATCH_Y_ABOVE_BOX_TOP = 48;
const EAT_WINDOW_MS = 400;

/**
 * The heart/ball emoji's own fade animation can dip its pixels below the
 * canvas-scan threshold for a frame or two mid-fade, producing a spurious
 * off/on flicker around a single real appearance. Collapses any
 * `<base>_off` immediately followed (within `windowMs`) by a `<base>_on` —
 * a real second appearance is always much further apart than one frame.
 */
function debounceOnOff(marks, base, windowMs) {
  let current = marks;
  for (let pass = 0; pass < 5; pass++) {
    const relevant = current.filter((m) => m.kind === `${base}_on` || m.kind === `${base}_off`).sort((a, b) => a.t - b.t);
    const drop = new Set();
    for (let i = 0; i < relevant.length - 1; i++) {
      if (relevant[i].kind === `${base}_off` && relevant[i + 1].kind === `${base}_on` && relevant[i + 1].t - relevant[i].t <= windowMs) {
        drop.add(relevant[i]);
        drop.add(relevant[i + 1]);
      }
    }
    if (drop.size === 0) return current;
    current = current.filter((m) => !drop.has(m));
  }
  return current;
}

/**
 * Rebases every `t` in a raw capture onto the start clapper's release edge
 * (`raw.clapStart.tOff`): the events.json contract's t=0, so demo.mp4 time =
 * trimBeforeMs + t, where trimBeforeMs is the video's own clapper release.
 * record.mjs flashes the start clapper on the pre-roll about:blank before
 * the set page loads, so a recorded take has nothing before it; a log that
 * does (an older capture) comes out negative, which validateEvents allows
 * down to -trimBeforeMs. Every epoch time the raw log
 * carries (hourSetT, petsReadyT, feedMouseupT, firstPaintT) is shifted here,
 * so nothing downstream picks its own origin.
 */
function rebase(raw) {
  const t0 = raw.clapStart.tOff;
  const shift = (t) => t - t0;
  return {
    ...raw,
    src: raw.src.map((e) => ({ ...e, t: shift(e.t) })),
    hover: raw.hover.map((e) => ({ ...e, t: shift(e.t) })),
    mouse: raw.mouse.map((e) => ({ ...e, t: shift(e.t) })),
    cursor: raw.cursor.map((e) => ({ ...e, t: shift(e.t) })),
    tracks: (raw.tracks ?? []).map((e) => ({ ...e, t: shift(e.t) })),
    marks: debounceOnOff(debounceOnOff(raw.marks.map((e) => ({ ...e, t: shift(e.t) })), 'heart', 150), 'ball', 150),
    clicks: (raw.clicks ?? []).map((e) => ({ ...e, tMs: shift(e.tMs), tDepartMs: shift(e.tDepartMs), tDownMs: shift(e.tDownMs) })),
    clapStartMs: shift(raw.clapStart.tOff),
    clapEndMs: raw.clapEnd ? shift(raw.clapEnd.tOn) : undefined,
    hourSetMs: raw.hourSetT !== undefined ? shift(raw.hourSetT) : undefined,
    petsReadyMs: raw.petsReadyT !== undefined ? shift(raw.petsReadyT) : undefined,
    feedMouseupMs: raw.feedMouseupT !== undefined ? shift(raw.feedMouseupT) : undefined,
    firstPaintMs: raw.firstPaintT !== undefined ? shift(raw.firstPaintT) : undefined,
  };
}

/**
 * wave = a swipe transition while the pet is hovered; greet = a swipe
 * transition while not hovered, where a SECOND pet also transitions to
 * swipe within 20ms (a real greet pair) — anything else is discarded (a
 * spurious swipe with no partner is not a greet).
 */
function deriveWaveGreet(srcEvents, hoverEvents) {
  const observed = [];
  const swipeStarts = srcEvents.filter((e) => e.to === 'swipe' && e.from !== 'swipe');

  for (const e of swipeStarts) {
    if (isHoveredAt(hoverEvents, e.pet, e.t)) {
      observed.push({ t: e.t, kind: 'wave', pet: e.pet });
    }
  }

  const unhoveredSwipes = swipeStarts.filter((e) => !isHoveredAt(hoverEvents, e.pet, e.t));
  const paired = new Set();
  for (let i = 0; i < unhoveredSwipes.length; i++) {
    if (paired.has(i)) continue;
    for (let j = i + 1; j < unhoveredSwipes.length; j++) {
      if (paired.has(j)) continue;
      if (Math.abs(unhoveredSwipes[j].t - unhoveredSwipes[i].t) <= 20) {
        paired.add(i);
        paired.add(j);
        observed.push({ t: unhoveredSwipes[i].t, kind: 'greet_start', pet: unhoveredSwipes[i].pet });
        observed.push({ t: unhoveredSwipes[j].t, kind: 'greet_start', pet: unhoveredSwipes[j].pet });
        break;
      }
    }
  }

  // greet_end: the paired pets' next transition away from swipe.
  for (const idx of paired) {
    const start = unhoveredSwipes[idx];
    const end = srcEvents.find((e) => e.pet === start.pet && e.t > start.t && e.from === 'swipe' && e.to !== 'swipe');
    if (end) observed.push({ t: end.t, kind: 'greet_end', pet: start.pet });
  }

  if (paired.size > 0) {
    const startTs = [...paired].map((i) => unhoveredSwipes[i].t);
    const endTs = observed.filter((o) => o.kind === 'greet_end').map((o) => o.t);
    observed.push({ t: Math.min(...startTs), kind: 'greet' });
    if (endTs.length) observed.push({ t: Math.max(...endTs), kind: 'greet' });
  }

  return observed;
}

/** chase_start = a src transition that gains `_run_` (from !== 'run', to === 'run'). */
function deriveChaseStarts(srcEvents) {
  return srcEvents.filter((e) => e.to === 'run' && e.from !== 'run').map((e) => ({ t: e.t, kind: 'chase_start', pet: e.pet }));
}

/**
 * catch = ball_off and heart_on within CATCH_WINDOW_MS of each other. The
 * catcher is the visible pet whose box centre x is nearest heart.x, counted
 * only if it satisfies the x/y proximity rule. catch.x/y = the ball's last
 * tracked position at or before catch.t (never the heart centroid). Never
 * infer a catch from run->idle.
 */
function deriveCatches(marks, tracks) {
  const ballOffs = marks.filter((m) => m.kind === 'ball_off');
  const heartOns = marks.filter((m) => m.kind === 'heart_on');
  const catches = [];

  for (const off of ballOffs) {
    const heart = heartOns.find((h) => Math.abs(h.t - off.t) <= CATCH_WINDOW_MS);
    if (!heart) continue;

    const frame = [...tracks].reverse().find((f) => f.t <= heart.t && f.pets.some((p) => p.id));
    if (!frame) continue;

    let catcher;
    let bestDist = Infinity;
    for (const pet of frame.pets) {
      if (!pet.id) continue;
      const centreX = pet.x + 32;
      const dist = Math.abs(heart.x - centreX);
      if (dist <= CATCH_X_TOLERANCE && heart.y >= pet.y - CATCH_Y_ABOVE_BOX_TOP && heart.y <= pet.y && dist < bestDist) {
        bestDist = dist;
        catcher = pet.id;
      }
    }
    if (!catcher) continue;

    const ballFrame = [...tracks].reverse().find((f) => f.t <= heart.t && f.ball);
    catches.push({ t: heart.t, kind: 'catch', pet: catcher, x: ballFrame?.ball?.x, y: ballFrame?.ball?.y });
  }

  return catches;
}

/** eat = the first heart_on within EAT_WINDOW_MS of the feed mouseup; discard (return null) if none arrives. */
function deriveEat(marks, feedMouseupMs) {
  if (feedMouseupMs === undefined) return null;
  const heart = marks.find((m) => m.kind === 'heart_on' && m.t >= feedMouseupMs && m.t - feedMouseupMs <= EAT_WINDOW_MS);
  return heart ? { t: heart.t, kind: 'eat' } : null;
}

/**
 * pets_ready = the first tracked frame on which every visible roster pet is
 * drawn (timeline.mjs findPetsReady): observe.js tracks from the moment the
 * content script creates its host, so this is when the pets appeared, not
 * when the choreography noticed. A raw log tracked from later than that
 * (the legacy proof log) falls back to the choreography's own petsReadyT.
 */
function derivePetsReady(r, roster) {
  const visibleIds = roster.filter((p) => !p.hidden).map((p) => p.id);
  const firstTrackHasPets = (r.tracks[0]?.pets ?? []).some((p) => p.id);
  if (r.tracks.length > 0 && !firstTrackHasPets) {
    const t = findPetsReady(r.tracks, visibleIds);
    if (t !== undefined) return t;
  }
  return r.petsReadyMs;
}

/** sleep = the first frame after the hour flip on which every visible roster pet shows the lie sprite. */
function deriveSleep(tracks, hourSetMs, roster) {
  if (hourSetMs === undefined) return null;
  const visibleIds = roster.filter((p) => !p.hidden).map((p) => p.id);
  const frame = tracks.find((f) => {
    if (f.t < hourSetMs) return false;
    return visibleIds.every((id) => f.pets.some((p) => p.id === id && p.src && p.src.includes('_lie_')));
  });
  return frame ? { t: frame.t, kind: 'sleep' } : null;
}

/**
 * Derives an Events document (src/schema.ts) from one shot's raw capture
 * log. `context` supplies the fields the raw log itself does not carry:
 * name, viewport, capture, roster, shim, extensionId, url, offsetMs,
 * trimBeforeMs, videoLagMs, and durationMs for a raw log with no end clapper
 * (otherwise durationMs is the end clapper's onset, ms after the start one).
 */
export function deriveEvents(raw, context) {
  const r = rebase(raw);

  const observedSrc = r.src.map((e) => ({ t: e.t, kind: 'src', pet: e.pet, from: e.from, to: e.to }));
  const observedMouse = r.mouse.map((e) => ({ t: e.t, kind: e.kind, x: e.x, y: e.y }));
  // heart_off is internal-only (feeds debounce, never a schema
  // ObservedKind). Clap events are synthesized below from
  // clapStartMs/clapEndMs; clap.js keeps its marks out of window.__pp.
  const observedMarks = r.marks
    .filter((m) => m.kind !== 'heart_off')
    .map((m) => ({ t: m.t, kind: m.kind, ...(m.x !== undefined ? { x: m.x, y: m.y } : {}) }));

  const waveGreet = deriveWaveGreet(r.src, r.hover);
  const chaseStarts = deriveChaseStarts(r.src);
  const catches = deriveCatches(r.marks, r.tracks);
  const eat = deriveEat(r.marks, r.feedMouseupMs);
  const sleep = deriveSleep(r.tracks, r.hourSetMs, context.roster);
  const petsReadyMs = derivePetsReady(r, context.roster);
  const firstPaintMs = r.firstPaintMs ?? context.firstPaintMs;

  const observed = [
    { t: r.clapStartMs, kind: 'clap' },
    ...(r.clapEndMs !== undefined ? [{ t: r.clapEndMs, kind: 'clap' }] : []),
    ...(firstPaintMs !== undefined ? [{ t: firstPaintMs, kind: 'first_paint' }] : []),
    ...(petsReadyMs !== undefined ? [{ t: petsReadyMs, kind: 'pets_ready' }] : []),
    // The shim is in place from page load; it is marked at playback start
    // (t=0), which is always inside demo.mp4. Observation start is not: it
    // can precede the video's first frame, i.e. fall below -trimBeforeMs.
    { t: context.shimMs ?? 0, kind: 'shim' },
    ...observedSrc,
    ...waveGreet,
    ...observedMarks,
    ...catches,
    ...(eat ? [eat] : []),
    ...(r.hourSetMs !== undefined ? [{ t: r.hourSetMs, kind: 'hour_set' }] : []),
    ...(sleep ? [sleep] : []),
    ...chaseStarts,
    ...observedMouse,
  ].sort((a, b) => a.t - b.t);

  const tracks = r.tracks.map((f) => ({
    t: f.t,
    pets: f.pets.filter((p) => p.id).map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, src: p.src })),
    ...(f.ball ? { ball: f.ball } : {}),
  }));

  return {
    name: context.name,
    viewport: context.viewport,
    capture: context.capture,
    recordedAt: raw.clapStart.tOff,
    extensionId: context.extensionId,
    ...(context.url ? { url: context.url } : {}),
    shim: context.shim,
    roster: context.roster,
    durationMs: r.clapEndMs ?? context.durationMs,
    offsetMs: context.offsetMs ?? 0,
    trimBeforeMs: context.trimBeforeMs ?? 0,
    videoLagMs: context.videoLagMs,
    cursorTrack: r.cursor.map((c) => ({ t: c.t, x: c.x, y: c.y })),
    clicks: r.clicks,
    observed,
    ...(tracks.length ? { tracks } : {}),
  };
}

export const _internal = { rebase, isHoveredAt, deriveWaveGreet, deriveChaseStarts, deriveCatches, deriveEat, deriveSleep, debounceOnOff, derivePetsReady };

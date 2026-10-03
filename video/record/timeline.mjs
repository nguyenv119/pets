// Pure predicates over the page's own observation log (observe.js's
// window.__pp: tracks, src, hover, marks), shared by the choreography
// (choreo.mjs, which polls the live log to decide when to act) and the
// event derivation (derive.mjs). No browser, no clock: every function takes
// the log and returns a page-clock time (epoch ms) or undefined, so the
// choreography and events.json can never disagree about when something
// happened.

const STATE_RE = /_(idle_with_ball|idle|walk|run|swipe|lie)_8fps\.gif/;

/** The sprite state an img src shows ('idle', 'walk', 'run', 'swipe', 'lie', 'idle_with_ball'), or null. */
export function spriteState(src) {
  const m = STATE_RE.exec(src ?? '');
  return m ? m[1] : null;
}

/**
 * pets_ready (shots.json conventions.states): the first tracked frame on
 * which every visible roster pet has an img. observe.js starts tracking when
 * #pixel-pets-host appears, before the content script adds any pet, so this
 * is the first frame the pets are drawn, not the moment the recorder got
 * round to asking.
 */
export function findPetsReady(tracks, visibleIds) {
  if (visibleIds.length === 0) return undefined;
  const frame = tracks.find((f) => visibleIds.every((id) => (f.pets ?? []).some((p) => p.id === id)));
  return frame?.t;
}

/** The first tracked frame at or after `sinceT` on which pet `petId` shows sprite `state`. */
export function firstFrameInState(tracks, petId, state, sinceT) {
  const frame = tracks.find((f) => f.t >= sinceT && (f.pets ?? []).some((p) => p.id === petId && spriteState(p.src) === state));
  return frame?.t;
}

/** The first mark of `kind` at or after `sinceT`. */
export function firstMarkT(marks, kind, sinceT) {
  return marks.find((m) => m.kind === kind && m.t >= sinceT)?.t;
}

/** A catch (conventions.states.catch, timing half): a ball_off at or after `sinceT` with a heart_on within 60 ms. */
export function findCatchT(marks, sinceT) {
  for (const off of marks) {
    if (off.kind !== 'ball_off' || off.t < sinceT) continue;
    const heart = marks.find((m) => m.kind === 'heart_on' && Math.abs(m.t - off.t) <= 60);
    if (heart) return heart.t;
  }
  return undefined;
}

/** True if `pet` is under an active (unpaired mouseout) hover at time `t`. */
export function isHoveredAt(hoverEvents, pet, t) {
  let hovered = false;
  for (const e of hoverEvents) {
    if (e.pet !== pet || e.t > t) continue;
    hovered = e.kind === 'mouseover';
  }
  return hovered;
}

/** Swipe starts (a src change into swipe from anything else) with nobody hovering that pet. */
function unhoveredSwipeStarts(src, hover) {
  return src.filter((e) => e.to === 'swipe' && e.from !== 'swipe' && !isHoveredAt(hover, e.pet, e.t));
}

/**
 * greet_start (conventions.states): two pets switch to swipe on the same
 * frame (within 20 ms, derive.mjs's pairing window) with neither hovered, at
 * or after `sinceT`. Returns { t, pets } (t = the later of the two), or
 * undefined.
 */
export function findGreetStart(src, hover, sinceT) {
  const starts = unhoveredSwipeStarts(src, hover).filter((e) => e.t >= sinceT);
  for (let i = 0; i < starts.length; i++) {
    for (let j = i + 1; j < starts.length; j++) {
      if (starts[j].pet !== starts[i].pet && Math.abs(starts[j].t - starts[i].t) <= 20) {
        return { t: Math.max(starts[i].t, starts[j].t), pets: [starts[i].pet, starts[j].pet] };
      }
    }
  }
  return undefined;
}

/** greet_end: the time both greeting pets have left swipe (the later of their first src change out of swipe after `sinceT`). */
export function findGreetEndT(src, pets, sinceT) {
  const ends = pets.map((pet) => src.find((e) => e.pet === pet && e.t >= sinceT && e.from === 'swipe' && e.to !== 'swipe')?.t);
  if (ends.some((t) => t === undefined)) return undefined;
  return Math.max(...ends);
}

/** The first mouseover of `pet` at or after `sinceT` (the hover entry). */
export function firstMouseoverT(hover, pet, sinceT) {
  return hover.find((e) => e.kind === 'mouseover' && e.pet === pet && e.t >= sinceT)?.t;
}

/**
 * The hover point (conventions.hover_point): 5 px inside the live box's
 * upper-right corner, where the drawn arrow covers none of Rex's art pixels.
 */
export function hoverPoint(rect) {
  return { x: rect.x + rect.w - 5, y: rect.y + 5 };
}

/**
 * Which logged moment a `wait_state` step's timeout counts from. The shot
 * notes and accept rules time these from an event, not from whenever the
 * choreography reaches the step: run and the catch from the dblclick (the
 * 400 ms clearing glide runs in between), swipe from the hover entry, lie
 * from hour_set, heart_on from the feed mouseup, greet_start from pets_ready
 * and greet_end from greet_start. Anything else counts from `now`.
 */
export function waitAnchor(action, anchors, now) {
  const pick = (t) => (t === undefined ? now : t);
  if (action.state === 'greet_start') return pick(anchors.petsReady);
  if (action.state === 'greet_end') return pick(anchors.greetStart);
  if (action.state === 'heart_on') return pick(anchors.feedMouseup);
  if (action.state === 'ball_on' || action.state === 'catch' || action.state === 'run') return pick(anchors.dblclick);
  if (action.state === 'swipe') return pick(anchors.hoverEntry);
  if (action.state === 'lie') return pick(anchors.hourSet);
  return now;
}

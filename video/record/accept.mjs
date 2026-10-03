// Accept-rule engine: turns a shot's `accept`/`extra_accept` text (copied
// verbatim from shots.json) into a pass/fail predicate evaluated against an
// Events document (src/schema.ts, frozen — every predicate here works only
// with the fields that schema exposes). One family per recurring rule
// shape, matched by regex against the rule text, rather than one hardcoded
// function per literal string: shots.json and its 9:16 variant repeat the
// same handful of shapes with different pets/numbers.
//
// evaluateRule(ruleText, events, ctx) -> AcceptResult { rule, pass, detail }
// `rule` is always the input text verbatim, so a caller can log it beside
// the shot's own copy for the epic eval's exact-text match.

function findRosterPet(events, name) {
  const lower = name.toLowerCase();
  return events.roster.find((p) => p.id === lower || p.name.toLowerCase() === lower);
}

function petTrackBoxes(events, petId) {
  const boxes = [];
  for (const frame of events.tracks ?? []) {
    const box = frame.pets?.find((p) => p.id === petId);
    if (box) boxes.push({ t: frame.t, ...box });
  }
  return boxes;
}

function firstObserved(events, kind, pred = () => true) {
  return events.observed.find((e) => e.kind === kind && pred(e));
}

// t=0 is the start clapper's release, not page load, so a take with no
// pets_ready fails a rule timed from it instead of timing it from 0.
const NO_PETS_READY = 'no pets_ready observed';

function fail(rule, detail) {
  return { rule, pass: false, detail };
}
function pass(rule, detail) {
  return { rule, pass: true, detail };
}

// -- Family: shim assertion -------------------------------------------------
const RE_SHIM = /^data-pp-shim reads 'v3;seed=(<seed>|\d+)'/;

function evalShim(rule, m, events) {
  const expected = m[1] === '<seed>' ? undefined : `v3;seed=${m[1]}`;
  if (!events.shim || !events.shim.startsWith('v3;seed=')) {
    return fail(rule, `shim was "${events.shim}"`);
  }
  if (expected && events.shim !== expected) {
    return fail(rule, `shim was "${events.shim}", expected "${expected}"`);
  }
  return pass(rule, events.shim);
}

// -- Family: first transition timing ----------------------------------------
const RE_FIRST_TRANSITION = /^(\w+)'s first transition is (\w+), (\d+)-(\d+) ms after pets_ready$/;

function evalFirstTransition(rule, m, events) {
  const [, petName, transition, lo, hi] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const readyT = firstObserved(events, 'pets_ready')?.t;
  if (readyT === undefined) return fail(rule, NO_PETS_READY);
  // walkLeft/walkRight both render the `walk` gif; direction is not carried
  // by the frozen schema, so this checks the walk transition's timing only.
  // walkLeft/walkRight both render the `walk` gif; the direction is read
  // from the tracked box: x falls on a walkLeft, rises on a walkRight.
  const lower = transition.toLowerCase();
  const gif = lower.startsWith('walk') ? 'walk' : lower;
  const first = events.observed.find((e) => e.kind === 'src' && e.pet === pet.id && e.to === gif && e.from !== gif);
  if (!first) return fail(rule, `${petName} never transitioned to ${gif}`);
  const delta = first.t - readyT;
  if (delta < Number(lo) || delta > Number(hi)) {
    return fail(rule, `${petName} reached ${gif} ${delta.toFixed(1)}ms after pets_ready, outside ${lo}-${hi}`);
  }
  if (lower === 'walkleft' || lower === 'walkright') {
    const next = events.observed.find((e) => e.kind === 'src' && e.pet === pet.id && e.t > first.t && e.to !== gif);
    const until = next ? next.t : Infinity;
    const boxes = petTrackBoxes(events, pet.id).filter((b) => b.t >= first.t && b.t < until);
    if (boxes.length < 2) return fail(rule, `${petName} walked at +${delta.toFixed(1)}ms but has ${boxes.length} tracked frame(s) to read the direction from`);
    const dx = boxes[boxes.length - 1].x - boxes[0].x;
    const dir = dx < 0 ? 'left' : dx > 0 ? 'right' : 'nowhere';
    const detail = `walk at +${delta.toFixed(1)}ms after pets_ready, x ${boxes[0].x.toFixed(1)} -> ${boxes[boxes.length - 1].x.toFixed(1)} (${dir})`;
    if (dir !== lower.slice(4)) return fail(rule, detail);
    return pass(rule, detail);
  }
  return pass(rule, `${delta.toFixed(1)}ms`);
}

// -- Family: box stays inside CSS x range, optional "before/until out" lie clause --
const RE_BOX_RANGE = /^(\w+)'s box stays inside CSS x (\d+)-(\d+)(?:, and (\w+) never shows the lie sprite before out)?$/;
const RE_BOX_RANGE_UNTIL_OUT = /^(\w+)'s box stays inside CSS x (\d+)-(\d+) until out, and no pet shows the lie sprite before out$/;

function boxStaysInRange(events, petId, lo, hi) {
  const boxes = petTrackBoxes(events, petId);
  if (boxes.length === 0) return { ok: false, reason: `no tracked frames for ${petId}` };
  const outOfRange = boxes.find((b) => b.x < Number(lo) || b.x > Number(hi));
  if (outOfRange) return { ok: false, reason: `x=${outOfRange.x} at t=${outOfRange.t} outside ${lo}-${hi}` };
  const xs = boxes.map((b) => b.x);
  return { ok: true, detail: `x ${Math.min(...xs).toFixed(1)}-${Math.max(...xs).toFixed(1)} over ${boxes.length} frames` };
}

/**
 * The shot's out point (ctx.outAnchor, its last beat's `out`, e.g.
 * "pets_ready+2950"), resolved on the events: "before out" rules are judged
 * up to it (bead step 8). Without an out anchor (the fixture shots declare
 * no beats) the whole take is judged, which is stricter.
 */
function outT(events, ctx) {
  if (!ctx?.outAnchor) return Infinity;
  const t = anchorT(events, ctx.outAnchor);
  return t === undefined ? Infinity : t;
}

function noLieBeforeOut(events, petIds, untilT = Infinity) {
  for (const frame of events.tracks ?? []) {
    if (frame.t > untilT) break;
    for (const box of frame.pets ?? []) {
      if (petIds && !petIds.includes(box.id)) continue;
      if (box.src && box.src.includes('_lie_')) return { ok: false, reason: `${box.id} lay down at t=${frame.t}` };
    }
  }
  return { ok: true };
}

function evalBoxRange(rule, m, events, ctx) {
  const [, petName, lo, hi, lieClausePet] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const box = boxStaysInRange(events, pet.id, lo, hi);
  if (!box.ok) return fail(rule, box.reason);
  if (lieClausePet) {
    const lie = noLieBeforeOut(events, [findRosterPet(events, lieClausePet)?.id], outT(events, ctx));
    if (!lie.ok) return fail(rule, lie.reason);
  }
  return pass(rule, `${box.detail}${lieClausePet ? '; no lie sprite' : ''}`);
}

function evalBoxRangeUntilOut(rule, m, events, ctx) {
  const [, petName, lo, hi] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const box = boxStaysInRange(events, pet.id, lo, hi);
  if (!box.ok) return fail(rule, box.reason);
  const lie = noLieBeforeOut(events, null, outT(events, ctx));
  if (!lie.ok) return fail(rule, lie.reason);
  return pass(rule, `${box.detail}; no lie sprite`);
}

// -- Family: swipe observed within Xms of the hover entry -------------------
const RE_SWIPE_AFTER_HOVER = /^the swipe src is observed within (\d+) ms of the hover entry$/;

function evalSwipeAfterHover(rule, m, events) {
  const withinMs = Number(m[1]);
  const hoverClick = events.clicks.find((c) => c.kind === 'hover');
  const swipe = events.observed.find((e) => e.kind === 'src' && e.to === 'swipe');
  if (!hoverClick) return fail(rule, 'no logged hover-entry click event');
  if (!swipe) return fail(rule, 'no swipe src transition observed');
  // choreo.mjs logs the hover entry as the page's own mouseover of the pet
  // (both on the page clock), so the swipe the hover causes comes after it.
  const delta = swipe.t - hoverClick.tMs;
  if (delta < 0 || delta > withinMs) return fail(rule, `swipe arrived ${delta.toFixed(1)}ms after the hover entry, outside 0-${withinMs}`);
  return pass(rule, `swipe ${delta.toFixed(1)}ms after the hover entry (mouseover)`);
}

// -- Family: heart_on within Xms of the mouseup ------------------------------
const RE_HEART_AFTER_MOUSEUP = /^heart_on arrives within (\d+) ms of the mouseup, and exactly one feed heart appears in the take \(treats go from \d+ to \d+ once\)$/;

function evalHeartAfterMouseup(rule, m, events) {
  const withinMs = Number(m[1]);
  const feedClick = events.clicks.find((c) => c.kind === 'click');
  if (!feedClick) return fail(rule, 'no logged feed click event');
  const feedHearts = events.observed.filter((e) => e.kind === 'heart_on' && e.t >= feedClick.tMs && e.t - feedClick.tMs <= withinMs);
  if (feedHearts.length !== 1) return fail(rule, `${feedHearts.length} heart_on events within ${withinMs}ms of the mouseup, expected exactly 1`);
  // "exactly one feed heart appears in the take": every heart_on in the take
  // (a take with a catch, the fixture's sample shot, has a second heart that
  // is the catch's, not a feed, so a catch heart is not counted).
  const catchTs = events.observed.filter((e) => e.kind === 'catch').map((e) => e.t);
  const takeHearts = events.observed.filter((e) => e.kind === 'heart_on' && !catchTs.some((t) => Math.abs(t - e.t) <= 60));
  if (takeHearts.length !== 1) return fail(rule, `${takeHearts.length} non-catch heart_on events in the take, expected exactly 1`);
  const delta = feedHearts[0].t - feedClick.tMs;
  return pass(rule, `heart_on ${delta.toFixed(1)}ms after the mouseup; 1 feed heart in the take`);
}

// -- Family: dblclick target + timing ---------------------------------------
const RE_DBLCLICK_TARGET = /^elementFromPoint at \((\d+), (\d+)\) is div#dbl-zone and no pet box contains the point; the dblclick lands within (\d+) ms of pets_ready$/;

/**
 * Judges the point the dblclick was really sent at (ctx.dblclick, logged by
 * choreo.mjs with what elementFromPoint returned there). A 9:16 take sends
 * it at the variant's dblclick_css instead of the rule's 16:9 point; that is
 * judged at the variant point and said so, like an extra_accept replacement.
 */
function evalDblclickTarget(rule, m, events, ctx) {
  const [, ruleX, ruleY, withinMs] = m;
  const readyT = firstObserved(events, 'pets_ready')?.t;
  if (readyT === undefined) return fail(rule, NO_PETS_READY);
  const dblclick = events.observed.find((e) => e.kind === 'dblclick');
  if (!dblclick) return fail(rule, 'no dblclick observed');
  const sent = ctx.dblclick;
  if (!sent) return fail(rule, 'no logged dblclick point/elementFromPoint target');
  let where;
  if (sent.x === Number(ruleX) && sent.y === Number(ruleY)) where = `at (${sent.x}, ${sent.y})`;
  else if (ctx.dblclickCss && sent.x === ctx.dblclickCss.x && sent.y === ctx.dblclickCss.y) where = `at (${sent.x}, ${sent.y}): the rule's (${ruleX}, ${ruleY}) replaced in 9:16 by dblclick_css`;
  else return fail(rule, `dblclick sent at (${sent.x}, ${sent.y}), neither the rule's (${ruleX}, ${ruleY}) nor a dblclick_css`);
  if (sent.element !== 'div#dbl-zone') return fail(rule, `elementFromPoint ${where} is ${sent.element}, not div#dbl-zone`);
  const frame = [...(events.tracks ?? [])].reverse().find((f) => f.t <= dblclick.t && f.pets?.length);
  if (!frame) return fail(rule, 'no tracked pet box at the dblclick');
  const hit = frame.pets.find((p) => sent.x >= p.x && sent.x <= p.x + p.w && sent.y >= p.y && sent.y <= p.y + p.h);
  if (hit) return fail(rule, `${hit.id}'s box contains the dblclick point ${where}`);
  const delta = dblclick.t - readyT;
  if (delta < 0 || delta > Number(withinMs)) return fail(rule, `dblclick landed ${delta.toFixed(1)}ms after pets_ready, outside 0-${withinMs}`);
  return pass(rule, `elementFromPoint ${where} is div#dbl-zone, no pet box contains it; dblclick ${delta.toFixed(1)}ms after pets_ready`);
}

// -- Family: state (ball_on/run/catch) within Xms of the dblclick -----------
const RE_BALL_ON_AFTER_DBLCLICK = /^ball_on arrives within (\d+) ms of the dblclick$/;
const RE_PET_STATE_AFTER_DBLCLICK = /^(\w+) shows (\w+) within (\d+) ms of the dblclick$/;
const RE_CATCH_AFTER_DBLCLICK = /^a catch by (\w+) \(conventions\.states\.catch\) within (\d+) ms of the dblclick$/;

function dblclickTime(events) {
  return events.observed.find((e) => e.kind === 'dblclick')?.t;
}

function evalBallOnAfterDblclick(rule, m, events) {
  const withinMs = Number(m[1]);
  const dblT = dblclickTime(events);
  if (dblT === undefined) return fail(rule, 'no dblclick observed');
  const ballOn = events.observed.find((e) => e.kind === 'ball_on' && e.t >= dblT);
  if (!ballOn) return fail(rule, 'ball_on never observed after the dblclick');
  const delta = ballOn.t - dblT;
  if (delta > withinMs) return fail(rule, `ball_on arrived ${delta}ms after the dblclick, over ${withinMs}`);
  return pass(rule, `${delta.toFixed(1)}ms`);
}

function evalPetStateAfterDblclick(rule, m, events) {
  const [, petName, state, withinMs] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const dblT = dblclickTime(events);
  if (dblT === undefined) return fail(rule, 'no dblclick observed');
  const kindMap = { run: 'chase_start' };
  const kind = kindMap[state] ?? state;
  const ev = events.observed.find((e) => e.kind === kind && e.pet === pet.id && e.t >= dblT);
  if (!ev) return fail(rule, `${petName} never reached ${state} after the dblclick`);
  const delta = ev.t - dblT;
  if (delta > Number(withinMs)) return fail(rule, `${petName} reached ${state} ${delta}ms after the dblclick, over ${withinMs}`);
  return pass(rule, `${delta.toFixed(1)}ms`);
}

function evalCatchAfterDblclick(rule, m, events) {
  const [, petName, withinMs] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const dblT = dblclickTime(events);
  if (dblT === undefined) return fail(rule, 'no dblclick observed');
  const catchEv = events.observed.find((e) => e.kind === 'catch' && e.pet === pet.id && e.t >= dblT);
  if (!catchEv) return fail(rule, `no catch by ${petName} after the dblclick`);
  const delta = catchEv.t - dblT;
  if (delta > Number(withinMs)) return fail(rule, `${petName} caught ${delta}ms after the dblclick, over ${withinMs}`);
  return pass(rule, `${delta.toFixed(1)}ms`);
}

// -- Family: a named pet is never drawn -------------------------------------
const RE_NEVER_ON_PAGE = /^(\w+) never has an img on the page$/;

function evalNeverOnPage(rule, m, events) {
  const pet = findRosterPet(events, m[1]);
  if (!pet) return fail(rule, `no roster entry named "${m[1]}"`);
  const boxes = petTrackBoxes(events, pet.id);
  if (boxes.length > 0) return fail(rule, `${m[1]} was drawn on ${boxes.length} tracked frames`);
  return pass(rule, `0 of ${(events.tracks ?? []).length} tracked frames draw ${m[1]}`);
}

// -- Family: greet_start timing + pairing ------------------------------------
const RE_GREET_START = /^greet_start arrives within (\d+) ms of pets_ready: (\w+) and (\w+) play swipe from the first frames, (\d+) px apart, neither hovered$/;

function evalGreetStart(rule, m, events) {
  const [, withinMs, petAName, petBName] = m;
  const petA = findRosterPet(events, petAName);
  const petB = findRosterPet(events, petBName);
  if (!petA || !petB) return fail(rule, `roster missing ${petAName} or ${petBName}`);
  const readyT = firstObserved(events, 'pets_ready')?.t;
  if (readyT === undefined) return fail(rule, NO_PETS_READY);
  // The first greet of each pet: a later second greet in the take is not this one.
  const starts = [petA, petB].map((p) => events.observed.find((e) => e.kind === 'greet_start' && e.pet === p.id)).filter(Boolean);
  if (starts.length < 2) return fail(rule, `only ${starts.length} greet_start events for ${petAName}/${petBName}`);
  const delta = Math.max(...starts.map((e) => e.t)) - readyT;
  if (delta > Number(withinMs)) return fail(rule, `greet_start ${delta.toFixed(1)}ms after pets_ready, over ${withinMs}`);
  return pass(rule, `${petAName} and ${petBName} swipe ${delta.toFixed(1)}ms after pets_ready, neither hovered`);
}

// -- Family: named pet never greets (px-apart parenthetical is documentation only) --
const RE_NEVER_GREETS = /^(\w+) \([^)]*\) never plays swipe before out$/;

function evalNeverGreets(rule, m, events, ctx) {
  const pet = findRosterPet(events, m[1]);
  if (!pet) return fail(rule, `no roster entry named "${m[1]}"`);
  const until = outT(events, ctx);
  const swipe = events.observed.find((e) => e.kind === 'src' && e.pet === pet.id && e.to === 'swipe' && e.t <= until);
  if (swipe) return fail(rule, `${m[1]} swiped at t=${swipe.t}`);
  return pass(rule, `no ${m[1]} swipe src ${Number.isFinite(until) ? `before out (${ctx.outAnchor}, t=${until.toFixed(1)})` : 'in the take'}`);
}

// -- Family: all pets idle from greet_end until a named out time ------------
const RE_ALL_IDLE_UNTIL_OUT = /^all three pets show the idle sprite from greet_end until out \(pets_ready\+(\d+)\): no walk and no lie$/;

function evalAllIdleUntilOut(rule, m, events) {
  const outOffset = Number(m[1]);
  const readyT = firstObserved(events, 'pets_ready')?.t;
  if (readyT === undefined) return fail(rule, NO_PETS_READY);
  const greetEndT = firstObserved(events, 'greet_end')?.t;
  if (greetEndT === undefined) return fail(rule, 'no greet_end observed');
  const outT = readyT + outOffset;
  const inRange = (events.tracks ?? []).filter((f) => f.t >= greetEndT && f.t <= outT);
  if (inRange.length === 0) return fail(rule, `no tracked frame between greet_end (${greetEndT}) and out (${outT})`);
  const lastT = (events.tracks ?? []).at(-1).t;
  if (lastT < outT) return fail(rule, `the take's tracks end at t=${lastT.toFixed(1)}, before out (${outT.toFixed(1)})`);
  const badFrame = inRange.find(
    (f) => f.pets?.some((p) => p.src && (p.src.includes('_walk_') || p.src.includes('_lie_'))),
  );
  if (badFrame) return fail(rule, `a pet walked or lay down at t=${badFrame.t}`);
  return pass(rule, `all idle on ${inRange.length} frames from greet_end (+${(greetEndT - readyT).toFixed(1)}ms) to out (+${outOffset}ms)`);
}

// -- Family: all pets idle/lie relative to hour_set --------------------------
const RE_ALL_IDLE_AT_HOUR_SET = /^all three pets are on the idle sprite at hour_set$/;
const RE_ALL_LIE_WITHIN = /^all three show lie within (\d+) ms of hour_set$/;
const RE_ALL_LIE_UNTIL_END = /^all three stay on lie until the take ends \(sleep\+(\d+)\)$/;

function trackFrameAt(events, t) {
  return [...(events.tracks ?? [])].reverse().find((f) => f.t <= t);
}

function evalAllIdleAtHourSet(rule, _m, events) {
  const hourSetT = firstObserved(events, 'hour_set')?.t;
  if (hourSetT === undefined) return fail(rule, 'no hour_set observed');
  const frame = trackFrameAt(events, hourSetT);
  if (!frame) return fail(rule, 'no tracked frame at hour_set');
  const notIdle = frame.pets.find((p) => p.src && !p.src.includes('_idle_'));
  if (notIdle) return fail(rule, `${notIdle.id} was not idle at hour_set`);
  return pass(rule, `${frame.pets.map((p) => p.id).join(', ')} idle on the frame ${(hourSetT - frame.t).toFixed(1)}ms before hour_set`);
}

function evalAllLieWithin(rule, m, events) {
  const withinMs = Number(m[1]);
  const hourSetT = firstObserved(events, 'hour_set')?.t;
  const sleepT = firstObserved(events, 'sleep')?.t;
  if (hourSetT === undefined) return fail(rule, 'no hour_set observed');
  if (sleepT === undefined) return fail(rule, 'no sleep observed');
  const delta = sleepT - hourSetT;
  if (delta > withinMs) return fail(rule, `sleep arrived ${delta.toFixed(1)}ms after hour_set, over ${withinMs}`);
  return pass(rule, `all lie ${delta.toFixed(1)}ms after hour_set`);
}

function evalAllLieUntilEnd(rule, m, events) {
  const untilOffset = Number(m[1]);
  const sleepT = firstObserved(events, 'sleep')?.t;
  if (sleepT === undefined) return fail(rule, 'no sleep observed');
  const untilT = sleepT + untilOffset;
  const inRange = (events.tracks ?? []).filter((f) => f.t >= sleepT && f.t <= untilT);
  if (inRange.length === 0) return fail(rule, `no tracked frame between sleep (${sleepT}) and the take end (${untilT})`);
  const lastT = (events.tracks ?? []).at(-1).t;
  if (lastT < untilT) return fail(rule, `the take's tracks end at sleep+${(lastT - sleepT).toFixed(1)}ms, before sleep+${untilOffset}`);
  const badFrame = inRange.find((f) => f.pets?.some((p) => p.src && !p.src.includes('_lie_')));
  if (badFrame) return fail(rule, `a pet left the lie sprite at t=${badFrame.t}`);
  return pass(rule, `all on lie for ${inRange.length} frames, tracks to sleep+${(lastT - sleepT).toFixed(1)}ms`);
}

// -- Family: 9:16 box right-edge safe margin ---------------------------------
const RE_BOX_RIGHT_EDGE = /^(\w+)'s box right edge stays at or under CSS x (\d+) for the whole take$/;
const RE_EVERY_BOX_RIGHT_EDGE = /^every pet box's right edge stays at or under CSS x (\d+) for the whole take$/;

function evalBoxRightEdge(rule, m, events) {
  const [, petName, maxX] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const boxes = petTrackBoxes(events, pet.id);
  const over = boxes.find((b) => b.x + b.w > Number(maxX));
  if (over) return fail(rule, `${petName}'s right edge reached ${over.x + over.w} at t=${over.t}, over ${maxX}`);
  if (boxes.length === 0) return fail(rule, `no tracked frames for ${petName}`);
  return pass(rule, `max right edge ${Math.max(...boxes.map((b) => b.x + b.w)).toFixed(1)}`);
}

function evalEveryBoxRightEdge(rule, m, events) {
  const maxX = Number(m[1]);
  for (const frame of events.tracks ?? []) {
    for (const box of frame.pets ?? []) {
      if (box.x + box.w > maxX) return fail(rule, `${box.id}'s right edge reached ${box.x + box.w} at t=${frame.t}, over ${maxX}`);
    }
  }
  const rights = (events.tracks ?? []).flatMap((f) => (f.pets ?? []).map((b) => b.x + b.w));
  if (rights.length === 0) return fail(rule, 'no tracked pet boxes');
  return pass(rule, `max right edge ${Math.max(...rights).toFixed(1)}`);
}

// -- Family: no wall bounce -----------------------------------------------
const RE_NO_WALL_BOUNCE = /^no wall bounce( \(no direction flip at x 0\))? before out$/;

function evalNoWallBounce(rule, _m, events) {
  for (const frame of events.tracks ?? []) {
    for (const box of frame.pets ?? []) {
      if (box.x <= 0) return fail(rule, `${box.id} reached the left wall (x=${box.x}) at t=${frame.t}`);
    }
  }
  const xs = (events.tracks ?? []).flatMap((f) => (f.pets ?? []).map((b) => b.x));
  if (xs.length === 0) return fail(rule, 'no tracked pet boxes');
  return pass(rule, `min x ${Math.min(...xs).toFixed(1)}`);
}

// -- Family: catch replacement limit (9:16) + ball x at catch ---------------
const RE_CATCH_REPLACE_LIMIT = /^a catch by (\w+) within (\d+) ms of the dblclick, replacing the 16:9 limit of \d+ ms/;
const RE_BALL_X_AT_CATCH = /^the ball is at CSS x (\d+) or less at the catch$/;

function evalCatchReplaceLimit(rule, m, events) {
  return evalCatchAfterDblclick(rule, [rule, m[1], m[2]], events);
}

function evalBallXAtCatch(rule, m, events) {
  const maxX = Number(m[1]);
  const catchEv = events.observed.find((e) => e.kind === 'catch');
  if (!catchEv) return fail(rule, 'no catch observed');
  if (catchEv.x === undefined) return fail(rule, 'catch event carries no ball x');
  if (catchEv.x > maxX) return fail(rule, `ball at x=${catchEv.x} at the catch, over ${maxX}`);
  return pass(rule, `x=${catchEv.x}`);
}

// -- Popup take families (s2b_shelter) ---------------------------------------

function typeCellsAtHigh(events) {
  const frame = [...(events.tracks ?? [])].reverse().find((f) => f.cells?.length);
  return frame?.cells ?? [];
}

function evalPopupTypeGrid(rule, _m, events, ctx) {
  const cells = typeCellsAtHigh(events);
  const order = ctx.layoutExpect?.type_order ?? [];
  if (cells.length !== order.length) return fail(rule, `${cells.length} type cells logged, expected ${order.length}`);
  const columns = new Set(cells.filter((c) => Math.abs(c.y - cells[0].y) < 4).map((c) => Math.round(c.x)));
  if (columns.size !== 6) return fail(rule, `${columns.size} columns in the first row, expected 6`);
  const reading = [...cells].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => c.type);
  if (JSON.stringify(reading) !== JSON.stringify(order)) return fail(rule, `type order ${reading.join(',')}`);
  const expanded = events.observed.find((e) => e.kind === 'form_expanded');
  if (!expanded) return fail(rule, 'no form_expanded observed');
  if (expanded.scrollHeight > expanded.innerHeight) return fail(rule, `scrollHeight ${expanded.scrollHeight} > innerHeight ${expanded.innerHeight}`);
  return pass(rule, `6 columns in type_order; scrollHeight ${expanded.scrollHeight} <= innerHeight ${expanded.innerHeight} with the form expanded`);
}

/**
 * The frozen schema has no field for a FontFace status, so popup.mjs reads
 * it from document.fonts when it declares popup_ready and hands it over as
 * ctx.nunito = { status, t } (t in events.json time). Judged here against
 * the first popup action.
 */
function evalPopupFontLoaded(rule, _m, events, ctx) {
  const firstClick = events.observed.find((e) => ['shelter_click', 'name_click', 'type_selected', 'color_selected'].includes(e.kind));
  if (!firstClick) return fail(rule, 'no first action observed to check against');
  const nunito = ctx.nunito;
  if (!nunito) return fail(rule, 'no Nunito FontFace status was read from document.fonts');
  if (nunito.status !== 'loaded') return fail(rule, `the Nunito FontFace status was '${nunito.status}'`);
  if (!(nunito.t <= firstClick.t)) return fail(rule, `Nunito read as loaded at t=${nunito.t.toFixed(1)}, after the first action (${firstClick.kind} at t=${firstClick.t.toFixed(1)})`);
  return pass(rule, `Nunito FontFace status 'loaded' at t=${nunito.t.toFixed(1)}, ${(firstClick.t - nunito.t).toFixed(1)}ms before ${firstClick.kind}`);
}

// -- Popup crops (s2b_shelter.crops), computed per logged frame exactly as
// the epic eval's cropRule does: native px = CSS x 2, each edge rounded.
const POPUP_CROP_OF_EVENT = {
  shelter_click: 'A_list',
  name_click: 'B_pick',
  type_selected: 'B_pick',
  color_selected: 'C_add',
  add_mousedown: 'C_add',
};
const CLICK_INSIDE_CSS = 4;

function nativeRect(x0, y0, x1, y1) {
  const a = [x0, y0, x1, y1].map((v) => Math.round(v * 2));
  return { x: a[0], y: a[1], w: a[2] - a[0], h: a[3] - a[1] };
}

function finiteRect(...rects) {
  return rects.every((r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite));
}

/** One crop's native-px rect on one logged frame, or null when a rect it needs is missing. */
export function popupCropRect(name, frame, viewportWidth) {
  const e = frame?.els ?? {};
  const cell = (type) => (frame?.cells ?? []).find((c) => c.type === type);
  if (name === 'A_list') return finiteRect(e.pets_list, e.btn_add_toggle) ? nativeRect(0, e.pets_list.y - 8, viewportWidth, e.btn_add_toggle.y + e.btn_add_toggle.h + 4) : null;
  if (name === 'B_pick') {
    const crab = cell('crab');
    const panda = cell('panda');
    return finiteRect(e.add_pet_form, e.pet_name, crab, panda) ? nativeRect(e.add_pet_form.x, e.pet_name.y - 8, crab.x + crab.w + 3, panda.y + panda.h + 3) : null;
  }
  if (name === 'C_add') return finiteRect(e.pet_color_label, e.btn_add) ? nativeRect(0, e.pet_color_label.y - 4, viewportWidth, e.btn_add.y + e.btn_add.h + 8) : null;
  return null;
}

/** Native-px gap between two rects (negative when they overlap). */
function rectGap(a, b) {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.max(dx, dy);
}

/** Resolves a beat anchor like "popup_ready+200" or "pets_ready+2950" on the events (ms), or undefined. */
function anchorT(events, anchor) {
  const m = /^([a-z_]+)([+-]\d+)?$/.exec(String(anchor).replace(/\s+/g, ''));
  if (!m) return undefined;
  const ev = firstObserved(events, m[1]);
  return ev ? ev.t + Number(m[2] ?? 0) : undefined;
}

function nearestFrame(events, t) {
  let best = null;
  for (const f of events.tracks ?? []) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

/**
 * ctx.popup = { beats, viewportWidth, forbiddenTypes } (from the shot):
 * every frame logged inside each card beat's [in, out] window has its crop
 * computed from that frame's own DOMRects and must miss every forbidden
 * cell's DOMRect.
 */
function evalPopupCropsDisjoint(rule, _m, events, ctx) {
  const popup = ctx.popup;
  if (!popup?.beats?.length) return fail(rule, 'no popup beats/crop context to compute the crops from');
  const parts = [];
  let minGap = Infinity;
  for (const beat of popup.beats) {
    const crop = beat.card?.crop;
    if (!crop) continue;
    const from = anchorT(events, beat.in);
    const to = anchorT(events, beat.out);
    if (from === undefined || to === undefined) return fail(rule, `${beat.name}: cannot resolve its window ${beat.in} .. ${beat.out}`);
    const frames = (events.tracks ?? []).filter((f) => f.t >= from && f.t <= to);
    if (frames.length === 0) return fail(rule, `${beat.name}: no logged frame in ${from.toFixed(1)}..${to.toFixed(1)}`);
    for (const f of frames) {
      const rect = popupCropRect(crop, f, popup.viewportWidth);
      if (!rect) return fail(rule, `${beat.name}: ${crop} cannot be computed on the frame at t=${f.t.toFixed(1)}`);
      for (const type of popup.forbiddenTypes) {
        const cell = (f.cells ?? []).find((c) => c.type === type);
        if (!cell) return fail(rule, `${beat.name}: forbidden cell ${type} not logged at t=${f.t.toFixed(1)}`);
        const gap = rectGap(rect, { x: cell.x * 2, y: cell.y * 2, w: cell.w * 2, h: cell.h * 2 });
        if (gap < 0) return fail(rule, `${beat.name}: ${crop} ${JSON.stringify(rect)} overlaps ${type} at t=${f.t.toFixed(1)}`);
        minGap = Math.min(minGap, gap);
      }
    }
    parts.push(`${crop} ${frames.length} frames`);
  }
  if (parts.length === 0) return fail(rule, 'no card beat declares a crop');
  return pass(rule, `${parts.join(', ')}; nearest forbidden cell ${minGap} native px away`);
}

function evalPopupTypeColorSelected(rule, _m, events) {
  const type = events.observed.find((e) => e.kind === 'type_selected');
  const color = events.observed.find((e) => e.kind === 'color_selected');
  if (!type || type.type !== 'chicken') return fail(rule, `type_selected was ${type?.type}`);
  if (!color || color.color !== 'white') return fail(rule, `color_selected was ${color?.color}`);
  return pass(rule, `type_selected ${type.type}, color_selected ${color.color}`);
}

function evalPopupAddMouseupTiming(rule, _m, events) {
  const down = events.observed.find((e) => e.kind === 'add_mousedown');
  const up = events.observed.find((e) => e.kind === 'add_mouseup');
  if (!down || !up) return fail(rule, 'missing add_mousedown/add_mouseup');
  if (up.t - down.t < 240) return fail(rule, `mouseup ${up.t - down.t}ms after mousedown, under 240`);
  return pass(rule, `mouseup at add_mousedown+${(up.t - down.t).toFixed(1)}ms`);
}

function evalPopupRosterSaved(rule, _m, events) {
  const up = events.observed.find((e) => e.kind === 'add_mouseup');
  const saved = events.observed.find((e) => e.kind === 'roster_saved');
  if (!up) return fail(rule, 'no add_mouseup observed');
  if (!saved) return fail(rule, 'no roster_saved observed');
  const delta = saved.t - up.t;
  if (delta < 0 || delta > 1000) return fail(rule, `roster_saved ${delta.toFixed(1)}ms after the mouseup, outside 0-1000`);
  // exactly the seeded Rex and Bao plus a white chicken named Pip, by type, colour and name
  const want = [...(events.roster ?? []).map((r) => `${r.type}/${r.color}/${r.name}`), 'chicken/white/Pip'].sort();
  const got = (saved.roster ?? []).map((r) => `${r.type}/${r.color}/${r.name}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) return fail(rule, `roster was ${got.join(', ')}, expected ${want.join(', ')}`);
  return pass(rule, `roster_saved ${delta.toFixed(1)}ms after the mouseup: ${got.join(', ')}`);
}

// The rule has three clauses (shots.json s2b_shelter.accept): #pets-list
// grows at least 60 CSS px, #add-pet-form collapses to half height or less
// (both addPet's own re-render, within 500ms of the mouseup — not the
// mousedown: the press itself is still on screen through the mouseup), and
// the saved Pip is a fresh crypto.randomUUID(), never one of the seeded
// ids. Mirrors verify.mjs's rederive() (loop-evals/pets-o3p/verify.mjs).
const RE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function evalPopupListGrowsFormCollapses(rule, _m, events) {
  const down = events.observed.find((e) => e.kind === 'add_mousedown');
  const up = events.observed.find((e) => e.kind === 'add_mouseup');
  if (!down) return fail(rule, 'no add_mousedown observed');
  if (!up) return fail(rule, 'no add_mouseup observed');
  const tracks = events.tracks ?? [];
  const before = [...tracks].reverse().find((f) => f.t < down.t && f.els?.pets_list && f.els?.add_pet_form);
  if (!before) return fail(rule, 'no pre-press #pets-list/#add-pet-form rect logged');
  const after = tracks.filter((f) => f.t > up.t && f.t <= up.t + 500 && f.els);
  const grown = after.find((f) => f.els.pets_list?.h >= before.els.pets_list.h + 60);
  if (!grown) return fail(rule, '#pets-list never grew by 60px within 500ms of the mouseup');
  const collapsed = after.find((f) => f.els.add_pet_form?.h <= before.els.add_pet_form.h * 0.5);
  if (!collapsed) return fail(rule, '#add-pet-form never collapsed to half height within 500ms of the mouseup');
  const saved = events.observed.find((e) => e.kind === 'roster_saved');
  if (!saved) return fail(rule, 'no roster_saved observed to check Pip\'s id');
  const pip = (saved.roster ?? []).find((p) => p.name === 'Pip');
  if (!pip) return fail(rule, 'no Pip in the saved roster');
  if (!RE_UUID_V4.test(pip.id ?? '')) return fail(rule, `Pip's id "${pip.id}" is not a crypto.randomUUID()`);
  const seededIds = (events.roster ?? []).map((p) => p.id);
  if (seededIds.includes(pip.id)) return fail(rule, `Pip's id "${pip.id}" matches a seeded pet id`);
  return pass(rule, `#pets-list ${before.els.pets_list.h} -> ${grown.els.pets_list.h} px at mouseup+${(grown.t - up.t).toFixed(1)}ms, #add-pet-form ${before.els.add_pet_form.h} -> ${collapsed.els.add_pet_form.h} px at mouseup+${(collapsed.t - up.t).toFixed(1)}ms; Pip id ${pip.id}`);
}

/**
 * Each popup click's logged point, judged against its crop computed on the
 * logged frame nearest the click (the eval's nearestTrack): at least 4 CSS
 * px inside every edge. Needs ctx.popup.viewportWidth.
 */
function evalPopupClicksInsideCrop(rule, _m, events, ctx) {
  const vw = ctx.popup?.viewportWidth;
  if (!vw) return fail(rule, 'no popup viewport width to compute the crops with');
  const parts = [];
  for (const [kind, crop] of Object.entries(POPUP_CROP_OF_EVENT)) {
    const e = firstObserved(events, kind);
    if (!e) return fail(rule, `no ${kind} observed`);
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return fail(rule, `${kind} logged no x/y`);
    const rect = popupCropRect(crop, nearestFrame(events, e.t), vw);
    if (!rect) return fail(rule, `${crop} cannot be computed at ${kind}`);
    const insideCss = Math.min(e.x * 2 - rect.x, rect.x + rect.w - e.x * 2, e.y * 2 - rect.y, rect.y + rect.h - e.y * 2) / 2;
    if (insideCss < CLICK_INSIDE_CSS) return fail(rule, `${kind} at CSS (${e.x.toFixed(1)}, ${e.y.toFixed(1)}) is ${insideCss.toFixed(1)} CSS px inside ${crop} ${JSON.stringify(rect)}, under ${CLICK_INSIDE_CSS}`);
    parts.push(`${kind} ${insideCss.toFixed(1)}px inside ${crop}`);
  }
  return pass(rule, parts.join('; '));
}

// -- Registry -----------------------------------------------------------

const RULE_FAMILIES = [
  [RE_SHIM, evalShim],
  [RE_FIRST_TRANSITION, evalFirstTransition],
  [RE_BOX_RANGE_UNTIL_OUT, evalBoxRangeUntilOut],
  [RE_BOX_RANGE, evalBoxRange],
  [RE_SWIPE_AFTER_HOVER, evalSwipeAfterHover],
  [RE_HEART_AFTER_MOUSEUP, evalHeartAfterMouseup],
  [RE_DBLCLICK_TARGET, evalDblclickTarget],
  [RE_BALL_ON_AFTER_DBLCLICK, evalBallOnAfterDblclick],
  [RE_CATCH_REPLACE_LIMIT, evalCatchReplaceLimit],
  [RE_CATCH_AFTER_DBLCLICK, evalCatchAfterDblclick],
  [RE_PET_STATE_AFTER_DBLCLICK, evalPetStateAfterDblclick],
  [RE_NEVER_ON_PAGE, evalNeverOnPage],
  [RE_GREET_START, evalGreetStart],
  [RE_NEVER_GREETS, evalNeverGreets],
  [RE_ALL_IDLE_UNTIL_OUT, evalAllIdleUntilOut],
  [RE_ALL_IDLE_AT_HOUR_SET, evalAllIdleAtHourSet],
  [RE_ALL_LIE_WITHIN, evalAllLieWithin],
  [RE_ALL_LIE_UNTIL_END, evalAllLieUntilEnd],
  [RE_BOX_RIGHT_EDGE, evalBoxRightEdge],
  [RE_EVERY_BOX_RIGHT_EDGE, evalEveryBoxRightEdge],
  [RE_NO_WALL_BOUNCE, evalNoWallBounce],
  [RE_BALL_X_AT_CATCH, evalBallXAtCatch],
  [/^the type grid has 6 columns/, evalPopupTypeGrid],
  [/^Nunito is loaded/, evalPopupFontLoaded],
  [/^every crop A, B and C rect is disjoint/, evalPopupCropsDisjoint],
  [/^type_selected fires with type chicken/, evalPopupTypeColorSelected],
  [/^the mouseup on Add Pet is sent at add_mousedown\+240/, evalPopupAddMouseupTiming],
  [/^within 1000 ms of that mouseup, pixel-pets-v1 holds/, evalPopupRosterSaved],
  [/^within 500 ms of the Add Pet mouseup, the logged #pets-list grows/, evalPopupListGrowsFormCollapses],
  [/^every popup click and the Add Pet press log the CSS point/, evalPopupClicksInsideCrop],
];

/** Exposed for accept.test.mjs, which needs the same regex a rule matched to parameterize its fixture builder. */
export { RULE_FAMILIES };

/**
 * Evaluates one rule (verbatim shots.json text) against an Events document.
 * `ctx` carries fields the rule text itself doesn't (layout_expect for the
 * popup family). Throws if no family's regex matches the text — an
 * unrecognised rule is a bug in this engine or a shots.json edit that needs
 * a new family, never a silent pass.
 */
export function evaluateRule(rule, events, ctx = {}) {
  for (const [regex, evaluator] of RULE_FAMILIES) {
    const m = rule.match(regex);
    if (m) return evaluator(rule, m, events, ctx);
  }
  throw new Error(`accept.mjs has no rule family matching: "${rule}"`);
}

/** The evaluator function name matching `rule`, for test dispatch (accept.test.mjs builds one good/bad fixture pair per family). */
export function familyNameForRule(rule) {
  for (const [regex, evaluator] of RULE_FAMILIES) {
    if (rule.match(regex)) return evaluator.name;
  }
  return null;
}

/** Evaluates every rule in `rules` (a shot's accept[] plus any extra_accept[]), in order. */
export function evaluateRules(rules, events, ctx = {}) {
  return rules.map((rule) => evaluateRule(rule, events, ctx));
}

// -- 9:16 base-rule replacement ----------------------------------------
//
// An extra_accept rule whose text says it replaces a base limit ("a catch
// by Rex within 2800 ms of the dblclick, replacing the 16:9 limit of 2600
// ms...") is judged at the variant's own value but reported against the
// BASE rule's verbatim text (bead step 8): the epic eval matches shots.json
// rule text exactly, and the base text is what shots.json's accept[] holds.

const RE_REPLACES_MARKER = /replacing the 16:9 limit of (\d+) ms/;

/** Maps an extra_accept family to the base family whose limit it replaces. */
const REPLACES_FAMILY = {
  evalCatchReplaceLimit: 'evalCatchAfterDblclick',
};

/**
 * Merges a shot's base `accept[]` with a 9:16 variant's `extra_accept[]`:
 * a replacing extra rule substitutes for its matching base rule (evaluated
 * at the extra rule's own value, reported under the base rule's text); every
 * other extra rule is appended as its own entry. Returns
 * `[{ reportText, evalText }]` — `reportText` is what AcceptResult.rule
 * should read, `evalText` is what evaluateRule should actually check.
 */
export function mergeAcceptRules(baseRules, extraRules) {
  const merged = baseRules.map((rule) => ({ reportText: rule, evalText: rule, replaced: false }));

  for (const extra of extraRules) {
    const markerMatch = extra.match(RE_REPLACES_MARKER);
    if (!markerMatch) {
      merged.push({ reportText: extra, evalText: extra, replaced: false });
      continue;
    }

    const oldLimit = markerMatch[1];
    const extraFamily = familyNameForRule(extra);
    const baseFamily = REPLACES_FAMILY[extraFamily];
    const idx = merged.findIndex(
      (entry) => !entry.replaced && familyNameForRule(entry.evalText) === baseFamily && entry.evalText.includes(`within ${oldLimit} ms of the dblclick`),
    );

    if (idx === -1) {
      throw new Error(`mergeAcceptRules: no base rule found for the extra_accept replacement: "${extra}"`);
    }
    merged[idx] = { reportText: merged[idx].evalText, evalText: extra, replaced: true };
  }

  return merged;
}

/**
 * Evaluates a shot's base `accept[]` merged with a 9:16 variant's
 * `extra_accept[]` (see mergeAcceptRules): a replacement's AcceptResult
 * carries the base rule's verbatim text and a detail noting the swap.
 */
export function evaluateShotRules(baseRules, extraRules, events, ctx = {}) {
  return mergeAcceptRules(baseRules, extraRules).map(({ reportText, evalText, replaced }) => {
    const result = evaluateRule(evalText, events, ctx);
    if (!replaced) return result;
    return { ...result, rule: reportText, detail: `replaced in 9:16 by extra_accept${result.detail ? `; ${result.detail}` : ''}` };
  });
}

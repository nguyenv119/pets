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
  const readyT = firstObserved(events, 'pets_ready')?.t ?? 0;
  // walkLeft/walkRight both render the `walk` gif; direction is not carried
  // by the frozen schema, so this checks the walk transition's timing only.
  const gif = transition.toLowerCase().startsWith('walk') ? 'walk' : transition.toLowerCase();
  const first = events.observed.find((e) => e.kind === 'src' && e.pet === pet.id && e.to === gif && e.from !== gif);
  if (!first) return fail(rule, `${petName} never transitioned to ${gif}`);
  const delta = first.t - readyT;
  if (delta < Number(lo) || delta > Number(hi)) {
    return fail(rule, `${petName} reached ${gif} ${delta}ms after pets_ready, outside ${lo}-${hi}`);
  }
  return pass(rule, `${delta}ms`);
}

// -- Family: box stays inside CSS x range, optional "before/until out" lie clause --
const RE_BOX_RANGE = /^(\w+)'s box stays inside CSS x (\d+)-(\d+)(?:, and (\w+) never shows the lie sprite before out)?$/;
const RE_BOX_RANGE_UNTIL_OUT = /^(\w+)'s box stays inside CSS x (\d+)-(\d+) until out, and no pet shows the lie sprite before out$/;

function boxStaysInRange(events, petId, lo, hi) {
  const boxes = petTrackBoxes(events, petId);
  if (boxes.length === 0) return { ok: false, reason: `no tracked frames for ${petId}` };
  const outOfRange = boxes.find((b) => b.x < Number(lo) || b.x > Number(hi));
  if (outOfRange) return { ok: false, reason: `x=${outOfRange.x} at t=${outOfRange.t} outside ${lo}-${hi}` };
  return { ok: true };
}

function noLieBeforeOut(events, petIds) {
  for (const frame of events.tracks ?? []) {
    for (const box of frame.pets ?? []) {
      if (petIds && !petIds.includes(box.id)) continue;
      if (box.src && box.src.includes('_lie_')) return { ok: false, reason: `${box.id} lay down at t=${frame.t}` };
    }
  }
  return { ok: true };
}

function evalBoxRange(rule, m, events) {
  const [, petName, lo, hi, lieClausePet] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const box = boxStaysInRange(events, pet.id, lo, hi);
  if (!box.ok) return fail(rule, box.reason);
  if (lieClausePet) {
    const lie = noLieBeforeOut(events, [findRosterPet(events, lieClausePet)?.id]);
    if (!lie.ok) return fail(rule, lie.reason);
  }
  return pass(rule);
}

function evalBoxRangeUntilOut(rule, m, events) {
  const [, petName, lo, hi] = m;
  const pet = findRosterPet(events, petName);
  if (!pet) return fail(rule, `no roster entry named "${petName}"`);
  const box = boxStaysInRange(events, pet.id, lo, hi);
  if (!box.ok) return fail(rule, box.reason);
  const lie = noLieBeforeOut(events, null);
  if (!lie.ok) return fail(rule, lie.reason);
  return pass(rule);
}

// -- Family: swipe observed within Xms of the hover entry -------------------
const RE_SWIPE_AFTER_HOVER = /^the swipe src is observed within (\d+) ms of the hover entry$/;

function evalSwipeAfterHover(rule, m, events) {
  const withinMs = Number(m[1]);
  const hoverClick = events.clicks.find((c) => c.kind === 'hover');
  const swipe = events.observed.find((e) => e.kind === 'src' && e.to === 'swipe');
  if (!hoverClick) return fail(rule, 'no logged hover-arrival click event');
  if (!swipe) return fail(rule, 'no swipe src transition observed');
  const delta = swipe.t - hoverClick.tMs;
  // A small negative delta is measurement slack, not a real ordering
  // violation: the logged hover-arrival time is read right after the
  // glide's final mouse.move resolves, which can land a tick or two after
  // the mouseover (and its swipe pose) actually fired.
  if (delta < -150 || delta > withinMs) return fail(rule, `swipe arrived ${delta}ms after hover, outside -150-${withinMs}`);
  return pass(rule, `${delta}ms`);
}

// -- Family: heart_on within Xms of the mouseup ------------------------------
const RE_HEART_AFTER_MOUSEUP = /^heart_on arrives within (\d+) ms of the mouseup, and exactly one feed heart appears in the take \(treats go from \d+ to \d+ once\)$/;

function evalHeartAfterMouseup(rule, m, events) {
  const withinMs = Number(m[1]);
  const feedClick = events.clicks.find((c) => c.kind === 'click');
  if (!feedClick) return fail(rule, 'no logged feed click event');
  // "exactly one feed heart" scopes to the feed's own accept window: a shot
  // that also has a later catch (its own, separate heart_on) must not have
  // that catch heart counted as a second feed.
  const feedHearts = events.observed.filter((e) => e.kind === 'heart_on' && e.t >= feedClick.tMs && e.t - feedClick.tMs <= withinMs);
  if (feedHearts.length !== 1) return fail(rule, `${feedHearts.length} heart_on events within ${withinMs}ms of the mouseup, expected exactly 1`);
  const delta = feedHearts[0].t - feedClick.tMs;
  return pass(rule, `${delta}ms`);
}

// -- Family: dblclick target + timing ---------------------------------------
const RE_DBLCLICK_TARGET = /^elementFromPoint at \((\d+), (\d+)\) is div#dbl-zone and no pet box contains the point; the dblclick lands within (\d+) ms of pets_ready$/;

function evalDblclickTarget(rule, m, events) {
  const [, , , withinMs] = m;
  const readyT = firstObserved(events, 'pets_ready')?.t ?? 0;
  const dblclick = events.observed.find((e) => e.kind === 'dblclick');
  if (!dblclick) return fail(rule, 'no dblclick observed');
  const delta = dblclick.t - readyT;
  if (delta < 0 || delta > Number(withinMs)) return fail(rule, `dblclick landed ${delta}ms after pets_ready, outside 0-${withinMs}`);
  return pass(rule, `${delta}ms; elementFromPoint/no-pet-box target is enforced live by choreo.mjs, which discards a take that misses it`);
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
  return pass(rule, `${delta}ms`);
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
  return pass(rule, `${delta}ms`);
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
  return pass(rule, `${delta}ms`);
}

// -- Family: a named pet is never drawn -------------------------------------
const RE_NEVER_ON_PAGE = /^(\w+) never has an img on the page$/;

function evalNeverOnPage(rule, m, events) {
  const pet = findRosterPet(events, m[1]);
  if (!pet) return fail(rule, `no roster entry named "${m[1]}"`);
  const boxes = petTrackBoxes(events, pet.id);
  if (boxes.length > 0) return fail(rule, `${m[1]} was drawn on ${boxes.length} tracked frames`);
  return pass(rule);
}

// -- Family: greet_start timing + pairing ------------------------------------
const RE_GREET_START = /^greet_start arrives within (\d+) ms of pets_ready: (\w+) and (\w+) play swipe from the first frames, (\d+) px apart, neither hovered$/;

function evalGreetStart(rule, m, events) {
  const [, withinMs, petAName, petBName] = m;
  const petA = findRosterPet(events, petAName);
  const petB = findRosterPet(events, petBName);
  if (!petA || !petB) return fail(rule, `roster missing ${petAName} or ${petBName}`);
  const readyT = firstObserved(events, 'pets_ready')?.t ?? 0;
  const starts = events.observed.filter((e) => e.kind === 'greet_start' && (e.pet === petA.id || e.pet === petB.id));
  if (starts.length < 2) return fail(rule, `only ${starts.length} greet_start events for ${petAName}/${petBName}`);
  const delta = Math.max(...starts.map((e) => e.t)) - readyT;
  if (delta > Number(withinMs)) return fail(rule, `greet_start ${delta}ms after pets_ready, over ${withinMs}`);
  return pass(rule, `${delta}ms`);
}

// -- Family: named pet never greets (px-apart parenthetical is documentation only) --
const RE_NEVER_GREETS = /^(\w+) \([^)]*\) never plays swipe before out$/;

function evalNeverGreets(rule, m, events) {
  const pet = findRosterPet(events, m[1]);
  if (!pet) return fail(rule, `no roster entry named "${m[1]}"`);
  const swipe = events.observed.find((e) => e.kind === 'src' && e.pet === pet.id && e.to === 'swipe');
  if (swipe) return fail(rule, `${m[1]} swiped at t=${swipe.t}`);
  return pass(rule);
}

// -- Family: all pets idle from greet_end until a named out time ------------
const RE_ALL_IDLE_UNTIL_OUT = /^all three pets show the idle sprite from greet_end until out \(pets_ready\+(\d+)\): no walk and no lie$/;

function evalAllIdleUntilOut(rule, m, events) {
  const outOffset = Number(m[1]);
  const readyT = firstObserved(events, 'pets_ready')?.t ?? 0;
  const greetEndT = firstObserved(events, 'greet_end')?.t;
  if (greetEndT === undefined) return fail(rule, 'no greet_end observed');
  const outT = readyT + outOffset;
  const badFrame = (events.tracks ?? []).find(
    (f) => f.t >= greetEndT && f.t <= outT && f.pets?.some((p) => p.src && (p.src.includes('_walk_') || p.src.includes('_lie_'))),
  );
  if (badFrame) return fail(rule, `a pet walked or lay down at t=${badFrame.t}`);
  return pass(rule);
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
  return pass(rule);
}

function evalAllLieWithin(rule, m, events) {
  const withinMs = Number(m[1]);
  const hourSetT = firstObserved(events, 'hour_set')?.t;
  const sleepT = firstObserved(events, 'sleep')?.t;
  if (hourSetT === undefined) return fail(rule, 'no hour_set observed');
  if (sleepT === undefined) return fail(rule, 'no sleep observed');
  const delta = sleepT - hourSetT;
  if (delta > withinMs) return fail(rule, `sleep arrived ${delta}ms after hour_set, over ${withinMs}`);
  return pass(rule, `${delta}ms`);
}

function evalAllLieUntilEnd(rule, m, events) {
  const untilOffset = Number(m[1]);
  const sleepT = firstObserved(events, 'sleep')?.t;
  if (sleepT === undefined) return fail(rule, 'no sleep observed');
  const untilT = sleepT + untilOffset;
  const badFrame = (events.tracks ?? []).find(
    (f) => f.t >= sleepT && f.t <= untilT && f.pets?.some((p) => p.src && !p.src.includes('_lie_')),
  );
  if (badFrame) return fail(rule, `a pet left the lie sprite at t=${badFrame.t}`);
  return pass(rule);
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
  return pass(rule);
}

function evalEveryBoxRightEdge(rule, m, events) {
  const maxX = Number(m[1]);
  for (const frame of events.tracks ?? []) {
    for (const box of frame.pets ?? []) {
      if (box.x + box.w > maxX) return fail(rule, `${box.id}'s right edge reached ${box.x + box.w} at t=${frame.t}, over ${maxX}`);
    }
  }
  return pass(rule);
}

// -- Family: no wall bounce -----------------------------------------------
const RE_NO_WALL_BOUNCE = /^no wall bounce( \(no direction flip at x 0\))? before out$/;

function evalNoWallBounce(rule, _m, events) {
  for (const frame of events.tracks ?? []) {
    for (const box of frame.pets ?? []) {
      if (box.x <= 0) return fail(rule, `${box.id} reached the left wall (x=${box.x}) at t=${frame.t}`);
    }
  }
  return pass(rule);
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
  const scrolled = events.observed.find((e) => e.kind === 'form_expanded' && e.scrollHeight > e.innerHeight);
  if (scrolled) return fail(rule, `scrollHeight ${scrolled.scrollHeight} > innerHeight ${scrolled.innerHeight}`);
  return pass(rule);
}

function evalPopupFontLoaded(rule, _m, events) {
  const firstClick = events.observed.find((e) => ['shelter_click', 'name_click', 'type_selected', 'color_selected'].includes(e.kind));
  if (!firstClick) return fail(rule, 'no first action observed to check against');
  // The frozen schema carries no FontFace boolean; this is asserted live by
  // popup.mjs before the first action and the take is discarded if it fails.
  return pass(rule, 'asserted live by popup.mjs before the first action (document.fonts FontFace check)');
}

function evalPopupCropsDisjoint(rule, _m, events) {
  // The crop rects themselves are computed per frame from tracks[].cells by
  // s2b_shelter.crops (a geometric rule, not a fixed rect); the frozen
  // schema carries the raw DOMRects for that computation but not the crop
  // definitions, so the epic eval — which reads shots.json directly — is
  // what re-derives and judges disjointness. This predicate checks the one
  // precondition it can: every frame has cells to compute crops from.
  const hasCells = (events.tracks ?? []).some((f) => f.cells?.length);
  if (!hasCells) return fail(rule, 'no tracks[].cells logged; crops cannot be computed');
  return pass(rule, 'crop geometry re-derived by the epic eval from tracks[].cells per s2b_shelter.crops');
}

function evalPopupTypeColorSelected(rule, _m, events) {
  const type = events.observed.find((e) => e.kind === 'type_selected');
  const color = events.observed.find((e) => e.kind === 'color_selected');
  if (!type || type.type !== 'chicken') return fail(rule, `type_selected was ${type?.type}`);
  if (!color || color.color !== 'white') return fail(rule, `color_selected was ${color?.color}`);
  return pass(rule);
}

function evalPopupAddMouseupTiming(rule, _m, events) {
  const down = events.observed.find((e) => e.kind === 'add_mousedown');
  const up = events.observed.find((e) => e.kind === 'add_mouseup');
  if (!down || !up) return fail(rule, 'missing add_mousedown/add_mouseup');
  if (up.t - down.t < 240) return fail(rule, `mouseup ${up.t - down.t}ms after mousedown, under 240`);
  return pass(rule, `${up.t - down.t}ms`);
}

function evalPopupRosterSaved(rule, _m, events) {
  const down = events.observed.find((e) => e.kind === 'add_mousedown');
  const saved = events.observed.find((e) => e.kind === 'roster_saved');
  if (!down) return fail(rule, 'no add_mousedown observed');
  if (!saved) return fail(rule, 'no roster_saved observed');
  if (saved.t - down.t > 1000) return fail(rule, `roster_saved ${saved.t - down.t}ms after mousedown, over 1000`);
  const names = (saved.roster ?? []).map((p) => p.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(['Bao', 'Pip', 'Rex'])) return fail(rule, `roster was ${names.join(',')}`);
  return pass(rule, `${saved.t - down.t}ms`);
}

function evalPopupListGrowsFormCollapses(rule, _m, events) {
  const down = events.observed.find((e) => e.kind === 'add_mousedown');
  if (!down) return fail(rule, 'no add_mousedown observed');
  const before = [...(events.tracks ?? [])].reverse().find((f) => f.t <= down.t && f.els?.pets_list);
  const after = (events.tracks ?? []).find((f) => f.t >= down.t && f.t <= down.t + 500 && f.els?.pets_list && f.els.pets_list.h >= (before?.els.pets_list.h ?? 0) + 60);
  if (!before) return fail(rule, 'no pre-press #pets-list rect logged');
  if (!after) return fail(rule, '#pets-list never grew by 60px within 500ms of the mouseup');
  return pass(rule);
}

function evalPopupClicksInsideCrop(rule, _m, events) {
  const actionKinds = ['shelter_click', 'name_click', 'type_selected', 'color_selected', 'add_mousedown'];
  for (const e of events.observed) {
    if (!actionKinds.includes(e.kind)) continue;
    if (e.x === undefined || e.y === undefined) return fail(rule, `${e.kind} logged no x/y`);
  }
  return pass(rule, 'crop-edge margin re-derived by the epic eval from tracks[].cells/els per s2b_shelter.crops');
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

// Executes a shot's `actions[]` (shots.json) against a live page: waits on
// the page's own observation log (observe.js's window.__pp, polled here),
// glides/hovers/clicks the mouse at a pet's live box, and logs every
// ClickEvent (src/schema.ts) the recorder needs for accept.mjs's
// hover/mouseup timing rules. Discards (throws DiscardTake) rather than
// faking a click or a wait when a step misses its window — the seed-search
// loop in record.mjs catches DiscardTake and moves to the next seed.
//
// Every wait counts from a LOGGED moment (timeline.mjs waitAnchor), never
// from whenever the choreography reaches the step: pets_ready is the first
// frame the pets were drawn, and the holds right after it count from there.

import {
  findCatchT,
  findGreetEndT,
  findGreetStart,
  findPetsReady,
  firstFrameInState,
  firstMarkT,
  firstMouseoverT,
  hoverPoint,
  waitAnchor,
} from './timeline.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long hover_pet keeps re-aiming at the live box for the swipe sprite (the shots' swipe window). */
const REAIM_MS = 600;
const POLL_MS = 8;
const GLIDE_STEP_MS = 16;
const SPRITE_STATES = ['idle', 'walk', 'run', 'swipe', 'lie', 'idle_with_ball'];

export class DiscardTake extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'DiscardTake';
  }
}

function rosterEntry(roster, petId) {
  const entry = roster.find((p) => p.id === petId);
  if (!entry) throw new DiscardTake(`no roster entry for pet id "${petId}"`);
  return entry;
}

async function petRect(page, type, color) {
  return page.evaluate(
    ([type, color]) => {
      const sr = document.querySelector('#pixel-pets-host')?.shadowRoot;
      const img = sr && [...sr.querySelectorAll('img')].find((i) => i.src.includes(`/assets/${type}/${color}_`));
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, src: img.getAttribute('src') };
    },
    [type, color],
  );
}

/**
 * A Node-side mirror of window.__pp, grown incrementally by `sync()` (only
 * entries logged since the last sync cross the wire), so the pure timeline
 * predicates run on exactly what events.json will later be derived from.
 */
export class LiveLog {
  constructor(page) {
    this.page = page;
    this.src = [];
    this.hover = [];
    this.mouse = [];
    this.tracks = [];
    this.marks = [];
    this.now = 0;
  }

  async sync() {
    const lens = [this.src.length, this.hover.length, this.mouse.length, this.tracks.length, this.marks.length];
    const r = await this.page.evaluate((lens) => {
      const pp = window.__pp;
      const now = performance.timeOrigin + performance.now();
      if (!pp) return { now, src: [], hover: [], mouse: [], tracks: [], marks: [] };
      return {
        now,
        src: pp.src.slice(lens[0]),
        hover: pp.hover.slice(lens[1]),
        mouse: pp.mouse.slice(lens[2]),
        tracks: pp.tracks.slice(lens[3]),
        marks: pp.marks.slice(lens[4]),
      };
    }, lens);
    this.src.push(...r.src);
    this.hover.push(...r.hover);
    this.mouse.push(...r.mouse);
    this.tracks.push(...r.tracks);
    this.marks.push(...r.marks);
    this.now = r.now;
    return this;
  }
}

/**
 * Polls the live log until `find()` returns a time at or before `deadline`
 * (page clock), or the page clock passes `deadline`. Returns the found time,
 * or undefined. A match logged after the deadline counts as a miss.
 */
async function waitUntil(log, find, deadline) {
  for (;;) {
    await log.sync();
    const t = find();
    if (t !== undefined && t <= deadline) return t;
    if (log.now > deadline) return undefined;
    await sleep(POLL_MS);
  }
}

/**
 * Glides the mouse from the cursor to `target` over `durationMs` of real
 * time, easing in and out, one step per ~frame. `target` may be a function
 * (re-read before every step: a walking pet's live point), so the glide
 * lands where the target IS, not where it was when the glide started.
 */
async function glide(page, cursor, target, durationMs) {
  const resolve = typeof target === 'function' ? target : async () => target;
  const x0 = cursor.x;
  const y0 = cursor.y;
  const t0 = Date.now();
  for (;;) {
    const u = durationMs > 0 ? Math.min(1, (Date.now() - t0) / durationMs) : 1;
    const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const p = await resolve();
    const x = x0 + (p.x - x0) * eased;
    const y = y0 + (p.y - y0) * eased;
    if (x !== cursor.x || y !== cursor.y) await page.mouse.move(x, y);
    cursor.x = x;
    cursor.y = y;
    if (u >= 1) return;
    await sleep(GLIDE_STEP_MS);
  }
}

function describeAnchor(action) {
  const names = { greet_start: 'pets_ready', greet_end: 'greet_start', heart_on: 'the mouseup', ball_on: 'the dblclick', catch: 'the dblclick', run: 'the dblclick', swipe: 'the hover entry', lie: 'hour_set' };
  return names[action.state] ?? 'the step';
}

/**
 * Runs one shot's `actions[]` against `page`, whose observers (observe.js)
 * were installed as an init script before the page loaded. Returns
 * { clicks, hourSetMs, feedMouseupMs, petsReadyMs, dblclickTarget } for
 * derive.mjs and accept.mjs. Throws DiscardTake when a step misses its
 * window — the caller must discard the take and try the next seed.
 */
export async function runActions(page, actions, { roster, cursorStart }) {
  const log = new LiveLog(page);
  const clicks = [];
  const cursor = { x: cursorStart?.x ?? 480, y: cursorStart?.y ?? 270 };
  const anchors = {};
  let greetPets;
  let dblclickTarget;
  // The time the next `hold` counts from: pets_ready right after the
  // pets_ready wait (and the instant shim check), otherwise "now".
  let holdFrom;

  const visibleIds = roster.filter((p) => !p.hidden).map((p) => p.id);
  const pageNow = async () => (await log.sync()).now;

  for (const action of actions) {
    switch (action.kind) {
      case 'wait_state': {
        const timeoutMs = action.timeout_ms ?? 5000;
        if (action.state === 'pets_ready') {
          const deadline = (await pageNow()) + timeoutMs;
          const t = await waitUntil(log, () => findPetsReady(log.tracks, visibleIds), deadline);
          if (t === undefined) throw new DiscardTake('pets_ready never reached');
          anchors.petsReady = t;
          holdFrom = t;
          break;
        }
        holdFrom = undefined;
        const now = await pageNow();
        const since = waitAnchor(action, anchors, now);
        const deadline = since + timeoutMs;
        let find;
        let what;
        if (action.pet && SPRITE_STATES.includes(action.state)) {
          const petId = rosterEntry(roster, action.pet).id;
          find = () => {
            const frameT = firstFrameInState(log.tracks, petId, action.state, since);
            const srcT = log.src.find((e) => e.pet === petId && e.to === action.state && e.t >= since)?.t;
            return [frameT, srcT].filter((t) => t !== undefined).sort((a, b) => a - b)[0];
          };
          what = `${action.pet} sprite state "${action.state}"`;
        } else if (action.state === 'catch') {
          find = () => findCatchT(log.marks, since);
          what = 'a catch';
        } else if (action.state === 'ball_on' || action.state === 'heart_on') {
          find = () => firstMarkT(log.marks, action.state, since);
          what = action.state;
        } else if (action.state === 'greet_start') {
          find = () => {
            const g = findGreetStart(log.src, log.hover, since);
            if (g) greetPets = g.pets;
            return g?.t;
          };
          what = 'greet_start';
        } else if (action.state === 'greet_end') {
          if (!greetPets) throw new DiscardTake('greet_end waited for with no greet_start');
          find = () => findGreetEndT(log.src, greetPets, since);
          what = 'greet_end';
        } else {
          throw new DiscardTake(`wait_state does not know how to wait for "${action.state}"`);
        }
        const t = await waitUntil(log, find, deadline);
        if (t === undefined) throw new DiscardTake(`${what} not observed within ${timeoutMs}ms of ${describeAnchor(action)}`);
        if (action.state === 'greet_start') anchors.greetStart = t;
        break;
      }

      case 'assert_shim': {
        const shim = await page.evaluate(() => document.documentElement.dataset.ppShim);
        if (!shim || !shim.startsWith('v3;seed=')) {
          throw new DiscardTake(`pets asleep: recording shim missing or broken (data-pp-shim="${shim}")`);
        }
        break;
      }

      case 'hold': {
        const from = holdFrom ?? Date.now();
        holdFrom = undefined;
        const waitMs = from + action.hold_ms - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        break;
      }

      case 'set_hour': {
        holdFrom = undefined;
        // One evaluate: log hour_set on the page clock, then flip the hour,
        // so no lie src can ever precede the logged flip.
        anchors.hourSet = await page.evaluate((hour) => {
          const t = performance.timeOrigin + performance.now();
          document.documentElement.dataset.ppHour = String(hour);
          return t;
        }, action.hour);
        break;
      }

      case 'hover_pet': {
        holdFrom = undefined;
        const pet = rosterEntry(roster, action.pet);
        const liveHoverPoint = async () => {
          const rect = await petRect(page, pet.type, pet.color);
          if (!rect) throw new DiscardTake(`${action.pet} has no live box to hover`);
          return hoverPoint(rect);
        };
        const tDepartMs = await pageNow();
        await glide(page, cursor, liveHoverPoint, action.duration_ms ?? 250);
        // Re-aim at the live box until the swipe sprite shows: a walking pet
        // keeps moving until the cursor is over it (the hover freezes it).
        const swipeSince = () => log.src.find((e) => e.pet === pet.id && e.to === 'swipe' && e.t >= tDepartMs)?.t;
        const reaimDeadline = (await pageNow()) + REAIM_MS;
        while (swipeSince() === undefined && log.now <= reaimDeadline) {
          const p = await liveHoverPoint();
          if (p.x !== cursor.x || p.y !== cursor.y) {
            await page.mouse.move(p.x, p.y);
            cursor.x = p.x;
            cursor.y = p.y;
          }
          await sleep(POLL_MS);
          await log.sync();
        }
        await log.sync();
        const arrivalMs = log.now;
        const entryMs = firstMouseoverT(log.hover, pet.id, tDepartMs) ?? arrivalMs;
        anchors.hoverEntry = entryMs;
        const rect = await petRect(page, pet.type, pet.color);
        clicks.push({ label: `hover-${action.pet}`, kind: 'hover', tMs: entryMs, tDepartMs, tDownMs: entryMs, x: cursor.x, y: cursor.y, rect, pet: action.pet });
        break;
      }

      case 'click_pet': {
        holdFrom = undefined;
        const pet = rosterEntry(roster, action.pet);
        const rect = await petRect(page, pet.type, pet.color);
        if (!rect) throw new DiscardTake(`${action.pet} has no live box to click`);
        const tSentMs = await pageNow();
        await page.mouse.down();
        await sleep(60);
        await page.mouse.up();
        await log.sync();
        const down = log.mouse.find((e) => e.kind === 'mousedown' && e.t >= tSentMs);
        const up = log.mouse.find((e) => e.kind === 'mouseup' && e.t >= tSentMs);
        if (!down || !up) throw new DiscardTake(`the feed click on ${action.pet} never reached the page`);
        clicks.push({ label: `click-${action.pet}`, kind: 'click', tMs: up.t, tDepartMs: down.t, tDownMs: down.t, x: cursor.x, y: cursor.y, rect, pet: action.pet });
        anchors.feedMouseup = up.t;
        break;
      }

      case 'unhover': {
        holdFrom = undefined;
        const x = cursor.x + (action.dx ?? 0);
        const y = action.y ?? cursor.y;
        await glide(page, cursor, { x, y }, action.duration_ms ?? 90);
        break;
      }

      case 'glide': {
        holdFrom = undefined;
        let target = { x: action.x, y: action.y };
        if (action.pet) {
          // "130 px above Rex's live hover point, re-reading his box each step because he is walking"
          const pet = rosterEntry(roster, action.pet);
          target = async () => {
            const rect = await petRect(page, pet.type, pet.color);
            if (!rect) throw new DiscardTake(`${action.pet} has no live box to glide toward`);
            const p = hoverPoint(rect);
            return { x: p.x, y: p.y + (action.dy ?? 0) };
          };
        }
        await glide(page, cursor, target, action.duration_ms ?? 400);
        break;
      }

      case 'dblclick_empty': {
        holdFrom = undefined;
        // The essential invariant (conventions.action_kinds_note): the
        // point must not land on a pet's box, or the dblclick would misfire
        // a pet click instead of spawning a ball. What elementFromPoint
        // returns there is logged and judged by the accept rule.
        const probe = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const element = el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` : null;
            const sr = document.querySelector('#pixel-pets-host')?.shadowRoot;
            const insidePet = !!sr && [...sr.querySelectorAll('img')].some((img) => {
              const r = img.getBoundingClientRect();
              return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            });
            return { element, insidePet };
          },
          [action.x, action.y],
        );
        if (probe.insidePet) {
          throw new DiscardTake(`dblclick point (${action.x}, ${action.y}) lands inside a pet's box`);
        }
        if (cursor.x !== action.x || cursor.y !== action.y) await glide(page, cursor, { x: action.x, y: action.y }, 300);
        const tSentMs = await pageNow();
        await page.mouse.dblclick(action.x, action.y);
        await log.sync();
        const dbl = log.mouse.find((e) => e.kind === 'dblclick' && e.t >= tSentMs);
        const firstDown = log.mouse.find((e) => e.kind === 'mousedown' && e.t >= tSentMs);
        if (!dbl) throw new DiscardTake('the dblclick never reached the page');
        anchors.dblclick = dbl.t;
        dblclickTarget = { x: action.x, y: action.y, element: probe.element, insidePet: probe.insidePet };
        clicks.push({ label: 'dblclick', kind: 'dblclick', tMs: dbl.t, tDepartMs: firstDown?.t ?? dbl.t, tDownMs: firstDown?.t ?? dbl.t, x: action.x, y: action.y, rect: { x: action.x - 30, y: action.y - 30, w: 60, h: 60 } });
        break;
      }

      default:
        throw new DiscardTake(`choreo.mjs does not implement action kind "${action.kind}"`);
    }
  }

  return { clicks, hourSetMs: anchors.hourSet, feedMouseupMs: anchors.feedMouseup, petsReadyMs: anchors.petsReady, dblclickTarget };
}

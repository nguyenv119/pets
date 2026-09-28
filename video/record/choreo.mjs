// Executes a shot's `actions[]` (shots.json) against a live page: waits on
// state predicates, glides/hovers/clicks the mouse at a pet's live box, and
// logs every ClickEvent (src/schema.ts) the recorder needs for accept.mjs's
// hover/mouseup timing rules. Discards (throws DiscardTake) rather than
// faking a click or a wait when a step misses its window — the seed-search
// loop in record.mjs catches DiscardTake and moves to the next seed.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const sr = document.querySelector('#pixel-pets-host').shadowRoot;
      const img = [...sr.querySelectorAll('img')].find((i) => i.src.includes(`/assets/${type}/${color}_`));
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, src: img.getAttribute('src') };
    },
    [type, color],
  );
}

async function pageNow(page) {
  return page.evaluate(() => performance.timeOrigin + performance.now());
}

async function glide(page, cursor, x, y, durationMs) {
  const steps = Math.max(2, Math.round(durationMs / 10));
  const x0 = cursor.x;
  const y0 = cursor.y;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    await page.mouse.move(x0 + (x - x0) * eased, y0 + (y - y0) * eased);
    await sleep(10);
  }
  cursor.x = x;
  cursor.y = y;
}

async function waitPetsReady(page, visibleCount, timeoutMs) {
  await page
    .waitForFunction(
      (n) => document.querySelector('#pixel-pets-host')?.shadowRoot?.querySelectorAll('img').length >= n,
      visibleCount,
      { timeout: timeoutMs },
    )
    .catch(() => {
      throw new DiscardTake('pets_ready never reached');
    });
}

async function waitPetSpriteState(page, type, color, state, timeoutMs) {
  const gif = state === 'idle_with_ball' ? 'idle_with_ball' : state;
  const ok = await page
    .waitForFunction(
      ([type, color, gif]) => {
        const sr = document.querySelector('#pixel-pets-host')?.shadowRoot;
        if (!sr) return false;
        const img = [...sr.querySelectorAll('img')].find((i) => i.src.includes(`/assets/${type}/${color}_`));
        return !!img && img.src.includes(`_${gif}_`);
      },
      [type, color, gif],
      { timeout: timeoutMs },
    )
    .then(() => true, () => false);
  if (!ok) throw new DiscardTake(`${type}/${color} never reached sprite state "${state}" within ${timeoutMs}ms`);
}

async function waitMark(page, kind, sinceMs, timeoutMs) {
  const ok = await page
    .waitForFunction(
      ([kind, sinceMs]) => (window.__pp?.marks ?? []).some((m) => m.kind === kind && m.t >= sinceMs),
      [kind, sinceMs],
      { timeout: timeoutMs, polling: 'raf' },
    )
    .then(() => true, () => false);
  if (!ok) throw new DiscardTake(`mark "${kind}" never observed within ${timeoutMs}ms`);
}

async function waitCatch(page, sinceMs, timeoutMs) {
  const ok = await page
    .waitForFunction(
      (sinceMs) => {
        const marks = window.__pp?.marks ?? [];
        const off = marks.find((m) => m.kind === 'ball_off' && m.t >= sinceMs);
        if (!off) return false;
        return marks.some((m) => m.kind === 'heart_on' && Math.abs(m.t - off.t) <= 60);
      },
      sinceMs,
      { timeout: timeoutMs, polling: 'raf' },
    )
    .then(() => true, () => false);
  if (!ok) throw new DiscardTake(`no catch observed within ${timeoutMs}ms`);
}

async function waitGreetStart(page, timeoutMs) {
  const ok = await page
    .waitForFunction(
      () => {
        const sr = document.querySelector('#pixel-pets-host')?.shadowRoot;
        if (!sr) return false;
        return [...sr.querySelectorAll('img')].filter((i) => i.src.includes('_swipe_')).length >= 2;
      },
      null,
      { timeout: timeoutMs, polling: 'raf' },
    )
    .then(() => true, () => false);
  if (!ok) throw new DiscardTake(`greet_start never observed within ${timeoutMs}ms`);
}

async function waitGreetEnd(page, timeoutMs) {
  const ok = await page
    .waitForFunction(
      () => {
        const sr = document.querySelector('#pixel-pets-host')?.shadowRoot;
        if (!sr) return false;
        return [...sr.querySelectorAll('img')].filter((i) => i.src.includes('_swipe_')).length === 0;
      },
      null,
      { timeout: timeoutMs, polling: 'raf' },
    )
    .then(() => true, () => false);
  if (!ok) throw new DiscardTake(`greet_end never observed within ${timeoutMs}ms`);
}

/**
 * Runs one shot's `actions[]` against `page`. Returns { clicks, hourSetMs,
 * feedMouseupMs } for derive.mjs. Throws DiscardTake on any timeout — the
 * caller must discard the take and try the next seed.
 */
export async function runActions(page, actions, { roster, cursorStart }) {
  const clicks = [];
  const cursor = { x: cursorStart?.x ?? 480, y: cursorStart?.y ?? 270 };
  let hourSetMs;
  let feedMouseupMs;
  let petsReadyMs;

  const readyAt = () => page.evaluate(() => performance.timeOrigin + performance.now());

  for (const action of actions) {
    switch (action.kind) {
      case 'wait_state': {
        const timeoutMs = action.timeout_ms ?? 5000;
        if (action.state === 'pets_ready') {
          await waitPetsReady(page, roster.filter((p) => !p.hidden).length, timeoutMs);
          petsReadyMs = await readyAt();
        } else if (action.pet && ['idle', 'walk', 'run', 'swipe', 'lie'].includes(action.state)) {
          const pet = rosterEntry(roster, action.pet);
          await waitPetSpriteState(page, pet.type, pet.color, action.state, timeoutMs);
        } else if (action.pet && action.state === 'catch') {
          await waitCatch(page, await readyAt(), timeoutMs);
        } else if (action.state === 'ball_on' || action.state === 'heart_on') {
          await waitMark(page, action.state, await readyAt(), timeoutMs);
        } else if (action.state === 'greet_start') {
          await waitGreetStart(page, timeoutMs);
        } else if (action.state === 'greet_end') {
          await waitGreetEnd(page, timeoutMs);
        } else {
          throw new DiscardTake(`wait_state does not know how to wait for "${action.state}"`);
        }
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
        await sleep(action.hold_ms);
        break;
      }

      case 'set_hour': {
        await page.evaluate((hour) => {
          document.documentElement.dataset.ppHour = String(hour);
        }, action.hour);
        hourSetMs = await readyAt();
        break;
      }

      case 'hover_pet': {
        const pet = rosterEntry(roster, action.pet);
        const tDepartMs = await readyAt();
        let rect = await petRect(page, pet.type, pet.color);
        if (!rect) throw new DiscardTake(`${action.pet} has no live box to hover`);
        await glide(page, cursor, rect.x + rect.w - 5, rect.y + 5, action.duration_ms ?? 250);
        const tMs = await readyAt();
        rect = await petRect(page, pet.type, pet.color);
        clicks.push({ label: `hover-${action.pet}`, kind: 'hover', tMs, tDepartMs, tDownMs: tMs, x: cursor.x, y: cursor.y, rect, pet: action.pet });
        break;
      }

      case 'click_pet': {
        const pet = rosterEntry(roster, action.pet);
        const rect = await petRect(page, pet.type, pet.color);
        if (!rect) throw new DiscardTake(`${action.pet} has no live box to click`);
        const tDownMs = await readyAt();
        await page.mouse.down();
        await sleep(60);
        await page.mouse.up();
        const tMs = await readyAt();
        clicks.push({ label: `click-${action.pet}`, kind: 'click', tMs, tDepartMs: tDownMs, tDownMs, x: cursor.x, y: cursor.y, rect, pet: action.pet });
        feedMouseupMs = tMs;
        break;
      }

      case 'unhover': {
        const x = cursor.x + (action.dx ?? 0);
        const y = action.y ?? cursor.y;
        await glide(page, cursor, x, y, action.duration_ms ?? 90);
        break;
      }

      case 'glide': {
        let targetX = action.x;
        let targetY = action.y;
        if (action.pet) {
          const pet = rosterEntry(roster, action.pet);
          const rect = await petRect(page, pet.type, pet.color);
          if (!rect) throw new DiscardTake(`${action.pet} has no live box to glide toward`);
          targetX = rect.cx;
          targetY = rect.cy + (action.dy ?? 0);
        }
        await glide(page, cursor, targetX, targetY, action.duration_ms ?? 400);
        break;
      }

      case 'dblclick_empty': {
        // The essential invariant (conventions.action_kinds_note): the
        // point must not land on a pet's box, or the dblclick would misfire
        // a pet click instead of spawning a ball. Which non-interactive
        // element it lands on otherwise varies by set page (production's
        // review.html declares #dbl-zone; a set page that doesn't is still
        // a valid "empty" target as long as no pet occupies the point).
        const insidePet = await page.evaluate(
          ([x, y]) => {
            const sr = document.querySelector('#pixel-pets-host')?.shadowRoot;
            if (!sr) return false;
            return [...sr.querySelectorAll('img')].some((img) => {
              const r = img.getBoundingClientRect();
              return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            });
          },
          [action.x, action.y],
        );
        if (insidePet) {
          throw new DiscardTake(`dblclick point (${action.x}, ${action.y}) lands inside a pet's box`);
        }
        await glide(page, cursor, action.x, action.y, 300);
        const tDownMs = await readyAt();
        await page.mouse.dblclick(action.x, action.y);
        const tMs = await readyAt();
        clicks.push({ label: 'dblclick', kind: 'dblclick', tMs, tDepartMs: tDownMs, tDownMs, x: action.x, y: action.y, rect: { x: action.x - 30, y: action.y - 30, w: 60, h: 60 } });
        break;
      }

      default:
        throw new DiscardTake(`choreo.mjs does not implement action kind "${action.kind}"`);
    }
  }

  return { clicks, hourSetMs, feedMouseupMs, petsReadyMs };
}

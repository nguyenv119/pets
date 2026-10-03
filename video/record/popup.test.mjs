import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateRule } from './accept.mjs';
import { buildPopupEvents, runPopupActions } from './popup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const s2bShot = JSON.parse(readFileSync(join(HERE, '..', 'shots.json'), 'utf-8')).shots.find((s) => s.id === 's2b_shelter');

/**
 * A popup take shaped like the real one that exposed the old origin: capture
 * started at epoch 10000, the start clapper releases at 10690.8, the first
 * keystroke lands at 12683.5 (2683.5 ms after capture start) and the end
 * clapper paints at 15000.
 */
function realShapedTake() {
  return {
    extensionId: 'ext',
    clapStart: { tOn: 10530, tOff: 10690.8 },
    clapEnd: { tOn: 15000, tOff: 15160 },
    popupReadyT: 10700,
    observed: [
      { t: 12683.5, kind: 'name_typed', x: 1, y: 2 },
      { t: 13500, kind: 'add_mousedown', x: 3, y: 4 },
    ],
    tracks: [
      { t: 10100, cells: [], els: {} },
      { t: 12000, cells: [], els: {} },
    ],
  };
}
const shot = { viewport: { width: 400, height: 600, device_scale_factor: 2 }, seed: { roster: [] } };
const doc = { fps: 25 };

describe('buildPopupEvents', () => {
  it('puts the start clapper release at t=0', () => {
    /**
     * Verifies the popup take uses the events.json contract's origin (the
     * start clapper's release), like the page recorder. The eval and the edit
     * place every popup event at demo.mp4 time trimBeforeMs + t; with capture
     * start as t=0, the typed "P" was looked for ~690 ms after it showed.
     */
    // GIVEN — the real-shaped popup take
    const take = realShapedTake();

    // WHEN — its events document is built
    const events = buildPopupEvents({ take, shot, doc });

    // THEN — the start clap is at 0, the end clap at its own offset, and durationMs ends on the end clap
    expect(events.observed.filter((e) => e.kind === 'clap').map((e) => e.t)).toEqual([0, 15000 - 10690.8]);
    expect(events.durationMs).toBeCloseTo(15000 - 10690.8, 6);
  });

  it('measures every action and track from the start clapper', () => {
    /**
     * Verifies observed[] and tracks[] share the one origin: the eval matches
     * a card crop to tracks[] at the same t it reads an action from
     * observed[]. A track logged before the clapper is negative, never moved.
     */
    // GIVEN — the real-shaped popup take
    const take = realShapedTake();

    // WHEN — its events document is built
    const events = buildPopupEvents({ take, shot, doc });

    // THEN — each time is its epoch minus 10690.8
    const at = (kind) => events.observed.find((e) => e.kind === kind)?.t;
    expect(at('name_typed')).toBeCloseTo(1992.7, 6);
    expect(at('add_mousedown')).toBeCloseTo(2809.2, 6);
    expect(at('popup_ready')).toBeCloseTo(9.2, 6);
    expect(events.tracks[0].t).toBeCloseTo(-590.8, 6);
    expect(events.tracks[1].t).toBeCloseTo(1309.2, 6);
  });
});

/**
 * A stand-in for the popup's Playwright page (a browser-only API, so no real
 * or in-memory alternative runs here). Its clock is the real one. Like the
 * shipped popup, the mouseup itself runs addPet(), so storage changes while
 * page.mouse.up() is still being awaited, before any later page.evaluate.
 */
function fakePopupPage() {
  const sent = [];
  let rosterSaved = null;
  const now = () => performance.timeOrigin + performance.now();
  const page = {
    evaluate: async (_fn, selector) => (selector === undefined ? now() : { x: 100, y: 100, w: 80, h: 30 }),
    mouse: {
      move: async () => {},
      down: async () => { sent.push({ kind: 'down', t: now() }); },
      up: async () => {
        sent.push({ kind: 'up', t: now() });
        rosterSaved = { t: now(), roster: [{ id: '1b4e28ba-2fa1-4d2e-8b6a-1b4e28ba2fa1', type: 'chicken', color: 'white', name: 'Pip' }] };
        await new Promise((r) => setTimeout(r, 2)); // CDP's reply arrives after the page has handled the event
      },
    },
    waitForFunction: async () => ({ jsonValue: async () => rosterSaved }),
  };
  return { page, sent };
}

describe('runPopupActions: the Add Pet press', () => {
  const press = s2bShot.actions.find((a) => a.kind === 'press');
  const waitSaved = s2bShot.actions.find((a) => a.kind === 'wait_state' && a.state === 'roster_saved');
  const ruleOf = (prefix) => s2bShot.accept.find((r) => r.startsWith(prefix));

  it('logs add_mouseup at the moment the mouseup is sent, before the storage change it causes', () => {
    /**
     * The mouseup runs addPet(), which writes pixel-pets-v1 straight away.
     * Reading the page clock AFTER page.mouse.up() resolved put add_mouseup
     * after roster_saved (-0.4 ms on the real take), so the roster rule
     * (0-1000 ms after the mouseup) discarded good takes. Logged as sent,
     * the mouseup precedes everything it causes.
     */
    // GIVEN — a popup page whose mouseup saves the roster synchronously
    const { page, sent } = fakePopupPage();

    // WHEN — the shot's own press and roster_saved wait run
    return runPopupActions(page, [press, waitSaved], { x: 0, y: 0 }).then((observed) => {
      // THEN — add_mouseup is logged no later than the mouseup was sent, and before roster_saved
      const up = observed.find((o) => o.kind === 'add_mouseup');
      const saved = observed.find((o) => o.kind === 'roster_saved');
      expect(up.t).toBeLessThanOrEqual(sent.find((s) => s.kind === 'up').t);
      expect(saved.t - up.t).toBeGreaterThanOrEqual(0);
    });
  });

  it('passes the eval rules timed from that mouseup (240 ms after the mousedown, roster saved within 1000 ms)', () => {
    /**
     * Logging the mouseup earlier must not break the other side of the
     * window: the mouseup is still at add_mousedown+240 or later, as the
     * shot's rule and the epic eval's rederive both require.
     */
    // GIVEN — the same press on a page whose mouseup saves the roster
    const { page } = fakePopupPage();

    // WHEN — the actions run and the two mouseup rules are judged on their log
    return runPopupActions(page, [press, waitSaved], { x: 0, y: 0 }).then((observed) => {
      const events = { observed, roster: [], tracks: [] };
      const timing = evaluateRule(ruleOf('the mouseup on Add Pet is sent'), events);
      const saved = evaluateRule(ruleOf('within 1000 ms of that mouseup'), events);

      // THEN — both pass
      expect(timing.pass, timing.detail).toBe(true);
      expect(saved.pass, saved.detail).toBe(true);
    });
  });
});

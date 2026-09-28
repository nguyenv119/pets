// The s2b_shelter take: adopts a pet in the SHIPPED popup (no seed search —
// the popup draws no random numbers on camera and no content script runs in
// its tab). See the bead's step 8c. Reuses lib/browser.mjs's openPopup
// (Google Fonts routed to the bundled Nunito) and logPopupRects (per-frame
// .type-cell/named-element DOMRects into events.tracks[]).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchWithExtension, logPopupRects, openPopup, seedStorage } from '../lib/browser.mjs';
import { evaluateRules } from './accept.mjs';
import { assembleFrames, generateSignalStats, probeVideo } from './assemble.mjs';
import { computeSync } from './sync.mjs';
import { fallbackVideoLagMs } from './video-lag.mjs';

const CLAP_MS = 160;
const TAKE_BUDGET = 5; // no seed search; a small retry budget only for transient CDP/layout timing

export class DiscardPopupTake extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'DiscardPopupTake';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function liveRect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

async function pageNow(page) {
  return page.evaluate(() => performance.timeOrigin + performance.now());
}

/** Resolves an action's target point: the selector's live centre, or the action's own `at` point when given. */
async function resolvePoint(page, action) {
  const rect = await liveRect(page, action.selector);
  if (!rect) throw new DiscardPopupTake(`no live rect for ${action.selector}`);
  if (action.at) {
    const { from, dx, dy } = action.at;
    const x = from === 'left' ? rect.x + dx : rect.x + rect.w / 2;
    const y = dy === 'middle' ? rect.y + rect.h / 2 : rect.y + dy;
    return { x, y };
  }
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
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

/**
 * Installs, in the popup page's main world, a chrome.storage.onChanged
 * listener collecting the saved roster (for roster_saved) into
 * window.__ppPopup, so the driver can poll it without its own message loop.
 */
function installPopupObserver() {
  window.__ppPopup = { rosterSaved: null };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['pixel-pets-v1']) {
      window.__ppPopup.rosterSaved = { t: performance.timeOrigin + performance.now(), roster: changes['pixel-pets-v1'].newValue?.roster ?? [] };
    }
  });

  // The same clapperboard record/observe.js installs for page shots
  // (magenta, all:initial so the popup's own CSS can't leak into it), so
  // sync.mjs's signalstats detection works identically for this take.
  window.__clap = (label, holdMs) =>
    new Promise((resolve) => {
      const div = document.createElement('div');
      div.style.cssText =
        'all:initial;position:fixed;inset:0;display:block;background:#ff00ff;opacity:1;z-index:2147483647;pointer-events:none;';
      document.documentElement.appendChild(div);
      requestAnimationFrame(() => {
        setTimeout(() => {
          div.remove();
          requestAnimationFrame(() => {
            const tOff = performance.timeOrigin + performance.now();
            resolve({ label, tOff, tOn: tOff - holdMs });
          });
        }, holdMs);
      });
    });
}

async function waitPopupReady(page, layoutExpect, timeoutMs) {
  const ok = await page
    .waitForFunction(
      (expectedCount) => {
        const rows = document.querySelectorAll('.pet-item').length;
        const cells = document.querySelectorAll('.type-cell').length;
        const nunito = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Nunito' && f.status === 'loaded');
        return rows === 2 && cells === expectedCount && nunito;
      },
      layoutExpect.type_order.length,
      { timeout: timeoutMs },
    )
    .then(() => true, () => false);
  if (!ok) throw new DiscardPopupTake('popup_ready never reached (rows/cells/Nunito)');
}

async function assertLayout(page, layoutExpect) {
  const result = await page.evaluate((columns) => {
    const cells = [...document.querySelectorAll('.type-cell')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const firstRowY = cells[0]?.y;
    const colsInFirstRow = new Set(cells.filter((c) => Math.abs(c.y - firstRowY) < 4).map((c) => Math.round(c.x))).size;
    return {
      colsInFirstRow,
      scrollHeight: document.scrollingElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  }, layoutExpect.columns);
  if (result.colsInFirstRow !== layoutExpect.columns) {
    throw new DiscardPopupTake(`type grid has ${result.colsInFirstRow} columns, expected ${layoutExpect.columns}`);
  }
  if (result.scrollHeight > result.innerHeight) {
    throw new DiscardPopupTake(`page scrolls: scrollHeight ${result.scrollHeight} > innerHeight ${result.innerHeight}`);
  }
  return result;
}

async function runPopupActions(page, actions, cursor) {
  const observed = [];
  let lastNameClickPoint = null;

  for (const action of actions) {
    switch (action.kind) {
      case 'hold':
        await sleep(action.hold_ms);
        break;

      case 'glide_to': {
        const { x, y } = await resolvePoint(page, action);
        await glide(page, cursor, x, y, action.duration_ms ?? 300);
        break;
      }

      case 'click_at': {
        const { x, y } = await resolvePoint(page, action);
        const el = await page.evaluate((sel) => {
          const e = document.querySelector(sel);
          return e ? { type: e.dataset?.type, color: e.dataset?.color } : {};
        }, action.selector);
        await page.mouse.click(x, y);
        const t = await pageNow(page);
        const event = { t, kind: action.event, x, y };
        if (el.type) event.type = el.type;
        if (el.color) event.color = el.color;
        observed.push(event);
        if (action.event === 'name_click') lastNameClickPoint = { x, y };
        if (action.event === 'shelter_click') {
          await sleep(250); // the form's own 200ms max-height transition
          const layout = await page.evaluate(() => ({ scrollHeight: document.scrollingElement.scrollHeight, innerHeight: window.innerHeight }));
          observed.push({ t: await pageNow(page), kind: 'form_expanded', ...layout });
        }
        break;
      }

      case 'type_text': {
        let lastT = await pageNow(page);
        for (const ch of action.text) {
          await page.keyboard.type(ch);
          lastT = await pageNow(page);
          await sleep(action.key_delay_ms ?? 100);
        }
        observed.push({ t: lastT, kind: action.event, ...(lastNameClickPoint ?? {}) });
        break;
      }

      case 'press': {
        const { x, y } = await resolvePoint(page, action);
        await page.mouse.move(x, y);
        await page.mouse.down();
        const downT = await pageNow(page);
        observed.push({ t: downT, kind: action.event, x, y });
        await sleep(action.release_after_ms ?? 240);
        await page.mouse.up();
        const upT = await pageNow(page);
        observed.push({ t: upT, kind: 'add_mouseup', x, y });
        break;
      }

      case 'wait_state': {
        if (action.state === 'roster_saved') {
          const saved = await page
            .waitForFunction(() => window.__ppPopup?.rosterSaved ?? null, null, { timeout: action.timeout_ms ?? 1000, polling: 100 })
            .then((h) => h.jsonValue(), () => null);
          if (!saved) throw new DiscardPopupTake('roster_saved never observed');
          observed.push({ t: saved.t, kind: 'roster_saved', roster: saved.roster });
        }
        break;
      }

      default:
        throw new DiscardPopupTake(`popup.mjs does not implement action kind "${action.kind}"`);
    }
  }

  return observed;
}

async function captureOnePopupTake({ shot, ext, timezoneId, homeDaysOverride, doc }) {
  const { context, serviceWorker, extensionId } = await launchWithExtension({ ext, timezoneId });
  const workDir = mkdtempSync(join(tmpdir(), 'pixel-pets-popup-take-'));
  const framesDir = join(workDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  try {
    const seed = structuredClone(shot.seed);
    if (homeDaysOverride !== undefined) seed.homeAnchorDaysAgo = homeDaysOverride;
    await seedStorage(serviceWorker, seed);

    const { page } = await openPopup(context, extensionId, shot.viewport);
    const cdp = await context.newCDPSession(page);
    const frames = [];
    const pending = [];
    cdp.on('Page.screencastFrame', (f) => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      const file = join(framesDir, `f${String(frames.length).padStart(5, '0')}.png`);
      frames.push({ file, ts: f.metadata.timestamp });
      pending.push(import('node:fs/promises').then(({ writeFile }) => writeFile(file, Buffer.from(f.data, 'base64'))));
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

    await page.evaluate(installPopupObserver);
    const recordStartT = await pageNow(page);

    await waitPopupReady(page, shot.layout_expect, 5000);
    const layout = await assertLayout(page, shot.layout_expect);

    await logPopupRects(page);
    // logPopupRects (lib/browser.mjs, frozen) times each track relative to
    // its own install moment (performance.now() - start), not the absolute
    // epoch every other timestamp here uses — capture that epoch now so
    // tracks can be converted to it below.
    const tracksInstallEpoch = await pageNow(page);
    const clapStart = await page.evaluate(([label, ms]) => window.__clap(label, ms), ['start', CLAP_MS]);
    const popupReadyT = await pageNow(page);

    let observed;
    let clapEnd;
    try {
      observed = await runPopupActions(page, shot.actions.filter((a) => a.kind !== 'open_popup' && a.kind !== 'wait_popup_ready'), { x: shot.cursor_start?.x ?? 250, y: 400 });
    } finally {
      clapEnd = await page.evaluate(([label, ms]) => window.__clap(label, ms), ['end', CLAP_MS]).catch(() => ({ tOn: 0, tOff: 0 }));
    }

    await sleep(100);
    await cdp.send('Page.stopScreencast');
    await Promise.all(pending);

    const rawTracks = await page.evaluate(() => window.__ppTracks ?? []);
    const tracks = rawTracks.map((f) => ({ ...f, t: tracksInstallEpoch + f.t }));

    return {
      workDir,
      frames,
      extensionId,
      recordStartT,
      clapStart,
      clapEnd,
      popupReadyT,
      layout,
      observed,
      tracks,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Records the s2b_shelter take once (no seed search) and writes build/<run>/s2b_shelter/{demo.mp4,events.json}. */
export async function recordPopupTake({ shot, doc, ext, opts, runId, buildDir }) {
  const rejections = [];

  for (let attempt = 1; attempt <= TAKE_BUDGET; attempt++) {
    let take;
    try {
      take = await captureOnePopupTake({ shot, ext, timezoneId: opts.timezone, homeDaysOverride: opts.homeDays, doc });
    } catch (err) {
      if (err instanceof DiscardPopupTake) {
        rejections.push(err.message);
        console.log(`[${shot.id}] attempt ${attempt} discarded: ${err.message}`);
        continue;
      }
      throw err;
    }

    const t0 = take.recordStartT;
    const shift = (t) => t - t0;

    const tracks = take.tracks.map((f) => ({ t: shift(f.t), cells: f.cells, els: f.els }));
    const observed = [
      { t: shift(take.clapStart.tOff), kind: 'clap' },
      { t: shift(take.clapEnd.tOn), kind: 'clap' },
      { t: shift(take.popupReadyT), kind: 'popup_ready' },
      ...take.observed.map((e) => ({ ...e, t: shift(e.t) })),
    ].sort((a, b) => a.t - b.t);

    const events = {
      name: 's2b_shelter',
      viewport: { width: shot.viewport.width, height: shot.viewport.height },
      capture: { method: 'cdp-screencast', dpr: shot.viewport.device_scale_factor ?? 2, fps: doc.fps ?? 25 },
      recordedAt: take.clapStart.tOff,
      extensionId: take.extensionId,
      url: `chrome-extension://${take.extensionId}/popup/popup.html`,
      shim: 'fixture',
      roster: shot.seed.roster,
      durationMs: shift(take.clapEnd.tOn),
      offsetMs: 0,
      trimBeforeMs: 0,
      videoLagMs: 0,
      cursorTrack: [],
      clicks: [],
      observed,
      tracks,
    };

    const ctx = { layoutExpect: shot.layout_expect };
    const results = evaluateRules(shot.accept, events, ctx);
    const failed = results.filter((r) => !r.pass);

    if (failed.length > 0) {
      rmSync(take.workDir, { recursive: true, force: true });
      const detail = failed.map((f) => `${f.rule} (${f.detail})`).join('; ');
      rejections.push(detail);
      console.log(`[${shot.id}] attempt ${attempt} discarded: ${detail}`);
      continue;
    }

    const outDir = join(buildDir, runId, shot.id);
    mkdirSync(outDir, { recursive: true });
    const mp4Path = join(outDir, 'demo.mp4');
    assembleFrames({ frames: take.frames, outPath: mp4Path, fps: doc.fps ?? 25, workDir: take.workDir });

    const dumpPath = join(take.workDir, 'sig.txt');
    const sig = generateSignalStats(mp4Path, dumpPath);
    // s2b_shelter has no heart (bead step 9): borrow the fallback (median of
    // this run's heart-measured kept shots, else the proof's own value).
    const { videoLagMs, source: videoLagSource } = fallbackVideoLagMs();
    const sync = computeSync({ signalStatsText: sig, startClapLoggedMs: take.clapStart.tOff, endClapLoggedMs: take.clapEnd.tOff, videoLagMs });

    const probe = probeVideo(mp4Path);
    console.log(`[${shot.id}] KEPT attempt ${attempt}; ${mp4Path} ${probe.width}x${probe.height} color_space=${probe.color_space}`);
    console.log(`[${shot.id}] videoLagMs=${videoLagMs.toFixed(1)} (${videoLagSource}; epic eval bound 0-120ms)`);
    console.log(`[${shot.id}] clapper check: |${sync.endClapResidualMs.toFixed(1)} + ${videoLagMs.toFixed(1)}| = ${Math.abs(sync.correctedResidualMs).toFixed(1)} <= 40 -> ${sync.pass}`);
    if (!sync.pass) {
      rmSync(take.workDir, { recursive: true, force: true });
      rejections.push(`clapper sync residual ${sync.correctedResidualMs.toFixed(1)}ms outside +-40ms`);
      continue;
    }

    events.trimBeforeMs = sync.trimBeforeMs;
    events.videoLagMs = videoLagMs;
    events.accept = results;
    writeFileSync(join(outDir, 'events.json'), JSON.stringify(events, null, 1));
    if (!opts.keepFrames) rmSync(join(take.workDir, 'frames'), { recursive: true, force: true });

    return { ok: true, results, mp4Path };
  }

  throw new Error(`[${shot.id}] exhausted ${TAKE_BUDGET} attempts without a passing take. Rejections:\n${rejections.join('\n')}`);
}

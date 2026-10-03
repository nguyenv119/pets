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
import { assembleFrames, extractGrayCrop, generateSignalStats, probeVideo } from './assemble.mjs';
import { installClap } from './clap.js';
import { startScreencast } from './screencast.mjs';
import { computeSync, demoMsOf, findTrimBeforeMs, measureVideoLagFromChange, splitGrayFrames } from './sync.mjs';
import { VIDEO_LAG_MAX_MS } from './video-lag.mjs';

const CLAP_MS = 160;
const SETTLE_BEFORE_CLAP_MS = 500;
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
 * It also logs every `input` event on #pet-name with its time and the
 * field's DOMRect: the first one ("P") is the visible change this take
 * measures its own videoLagMs from, since the popup shows no heart.
 */
function installPopupObserver() {
  window.__ppPopup = { rosterSaved: null, nameInputs: [] };
  document.addEventListener(
    'input',
    (e) => {
      if (e.target.id !== 'pet-name') return;
      const r = e.target.getBoundingClientRect();
      window.__ppPopup.nameInputs.push({ t: performance.timeOrigin + performance.now(), value: e.target.value, rect: { x: r.x, y: r.y, w: r.width, h: r.height } });
    },
    true,
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['pixel-pets-v1']) {
      window.__ppPopup.rosterSaved = { t: performance.timeOrigin + performance.now(), roster: changes['pixel-pets-v1'].newValue?.roster ?? [] };
    }
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
    const screencast = await startScreencast(cdp, framesDir);

    await page.evaluate(installPopupObserver);
    await page.evaluate(installClap);

    await waitPopupReady(page, shot.layout_expect, 5000);
    const layout = await assertLayout(page, shot.layout_expect);

    await logPopupRects(page);
    // logPopupRects (lib/browser.mjs, frozen) times each track relative to
    // its own install moment (performance.now() - start), not the absolute
    // epoch every other timestamp here uses — capture that epoch now so
    // tracks can be converted to it below.
    const tracksInstallEpoch = await pageNow(page);
    // Let the screencast settle before the start clapper, as record.mjs does
    // (its 500 ms wait). Clapped straight after logPopupRects, about 190 ms
    // into the capture, the start clapper's release reached the screencast
    // 34-36 ms after its logged time in 10 of 16 live takes (3-19 ms in the
    // rest), against 3-20 ms for the end clapper, so endClapResidualMs ran
    // as high as +59 ms with no drift in the clip at all.
    // After 500 ms it arrived 4-6 ms after the log (4 of 4 takes).
    await sleep(SETTLE_BEFORE_CLAP_MS);
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
    await screencast.stop();

    const rawTracks = await page.evaluate(() => window.__ppTracks ?? []);
    const nameInputs = await page.evaluate(() => window.__ppPopup.nameInputs);
    const tracks = rawTracks.map((f) => ({ ...f, t: tracksInstallEpoch + f.t }));

    return {
      workDir,
      frames: screencast.frames,
      extensionId,
      clapStart,
      clapEnd,
      popupReadyT,
      layout,
      observed,
      tracks,
      nameInputs,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Measures the take's videoLagMs from its first #pet-name keystroke (see
 * sync.mjs measureVideoLagFromChange). Returns `{ videoLagMs, source }`, or
 * `{ reject }` when the keystroke is missing, never shows in the video, or
 * lands outside the epic eval's 0-VIDEO_LAG_MAX_MS bound: a lag out there is
 * a recorder bug to fix, never a value to write (bead step 9).
 */
function measurePopupLag({ take, mp4Path, dpr, fps, trimBeforeMs }) {
  const first = take.nameInputs[0];
  if (!first) return { reject: 'no input event on #pet-name to measure videoLagMs from' };
  // Inset 3 CSS px inside the field so its 1 px border, whose colour
  // transitions on focus, stays out of the crop.
  const inset = 3;
  const crop = {
    x: Math.round((first.rect.x + inset) * dpr),
    y: Math.round((first.rect.y + inset) * dpr),
    w: Math.round((first.rect.w - 2 * inset) * dpr),
    h: Math.round((first.rect.h - 2 * inset) * dpr),
  };
  const frames = splitGrayFrames(extractGrayCrop(mp4Path, crop), { width: crop.w, height: crop.h, fps });
  // The keystroke's demo.mp4 time (trimBeforeMs + its events.json t), where
  // the epic eval and the edit place it, so that time + videoLagMs is the
  // frame that shows the "P".
  const sinceMs = demoMsOf(trimBeforeMs, msAfterStartClap(take, first.t));
  const videoLagMs = measureVideoLagFromChange({ frames, sinceMs });
  const source = `measured from the typed "${first.value}" in #pet-name, logged at demo.mp4 ${sinceMs.toFixed(1)}ms`;
  if (videoLagMs === null) return { reject: `the typed "${first.value}" never showed in #pet-name after demo.mp4 ${sinceMs.toFixed(1)}ms` };
  if (videoLagMs < 0 || videoLagMs > VIDEO_LAG_MAX_MS) {
    return { reject: `videoLagMs ${videoLagMs.toFixed(1)}ms outside the epic eval's 0-${VIDEO_LAG_MAX_MS}ms bound (${source})` };
  }
  return { videoLagMs, source };
}

/** ms after the take's start clapper release (events.json's t=0) of an epoch time logged in the popup. */
function msAfterStartClap(take, epochMs) {
  return epochMs - take.clapStart.tOff;
}

/**
 * Builds the s2b_shelter Events document from one captured take, every time
 * in ms after the start clapper's release (the events.json contract: demo.mp4
 * time = trimBeforeMs + t). Tracks logged before the clapper (logPopupRects
 * starts during the settle) are negative. trimBeforeMs and videoLagMs are
 * placeholders here; recordPopupTake fills them from the assembled video.
 */
export function buildPopupEvents({ take, shot, doc }) {
  const shift = (t) => msAfterStartClap(take, t);
  const tracks = take.tracks.map((f) => ({ t: shift(f.t), cells: f.cells, els: f.els }));
  const observed = [
    { t: shift(take.clapStart.tOff), kind: 'clap' },
    { t: shift(take.clapEnd.tOn), kind: 'clap' },
    { t: shift(take.popupReadyT), kind: 'popup_ready' },
    ...take.observed.map((e) => ({ ...e, t: shift(e.t) })),
  ].sort((a, b) => a.t - b.t);

  return {
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

    const events = buildPopupEvents({ take, shot, doc });

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

    // See record.mjs's matching check: a screencast frame can arrive at the
    // wrong device-pixel size under heavy system load.
    const dpr = shot.viewport.device_scale_factor ?? 2;
    const expectedWidth = shot.viewport.width * dpr;
    const expectedHeight = shot.viewport.height * dpr;
    const earlyProbe = probeVideo(mp4Path);
    if (earlyProbe.width !== expectedWidth || earlyProbe.height !== expectedHeight) {
      rmSync(take.workDir, { recursive: true, force: true });
      const detail = `assembled at ${earlyProbe.width}x${earlyProbe.height}, expected ${expectedWidth}x${expectedHeight}`;
      rejections.push(detail);
      console.log(`[${shot.id}] attempt ${attempt} discarded: ${detail}`);
      continue;
    }

    const dumpPath = join(take.workDir, 'sig.txt');
    const sig = generateSignalStats(mp4Path, dumpPath);
    const trimBeforeMs = findTrimBeforeMs(sig);
    // s2b_shelter has no heart, so it measures its own lag the way record.mjs
    // measures the heart's: the first demo.mp4 frame at or after the logged
    // first keystroke whose #pet-name field shows the typed "P", minus the
    // keystroke's demo.mp4 time. A borrowed page-shot lag does not describe
    // this capture.
    const lag = measurePopupLag({ take, mp4Path, dpr, fps: doc.fps ?? 25, trimBeforeMs });
    if (lag.reject) {
      rmSync(take.workDir, { recursive: true, force: true });
      rejections.push(lag.reject);
      console.log(`[${shot.id}] attempt ${attempt} discarded: ${lag.reject}`);
      continue;
    }
    const { videoLagMs, source: videoLagSource } = lag;
    const sync = computeSync({ signalStatsText: sig, startClapLoggedMs: take.clapStart.tOff, endClapLoggedMs: take.clapEnd.tOff, videoLagMs });

    const probe = earlyProbe;
    console.log(`[${shot.id}] KEPT attempt ${attempt}; ${mp4Path} ${probe.width}x${probe.height} color_space=${probe.color_space}`);
    console.log(`[${shot.id}] videoLagMs=${videoLagMs.toFixed(1)} (${videoLagSource}; epic eval bound 0-${VIDEO_LAG_MAX_MS}ms)`);
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

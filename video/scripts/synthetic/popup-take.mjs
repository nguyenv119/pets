// Drives the REAL, shipped popup (through the built extension, via
// lib/browser.mjs) to produce the s2b_shelter synthetic take: a CDP
// screencast of every adoption UI state shots.json's s2b_shelter.actions
// name, on the same 500x960 DPR2 viewport and the same selectors/timings
// the shot spec declares (crops.rule: "computed per frame from the
// logged DOMRects", never a hard-coded rect).
//
// The screencast capture is the recorder's own (record/screencast.mjs). One
// deliberate difference from the recorder's take (record/popup.mjs): by
// default the Add Pet button is pressed and held, NEVER released, so
// addPet() never runs and chrome.storage.local is never written beyond the
// seed (pets-o3p.4's constraint: "must never write real storage beyond the
// seed"). `releaseAddPet: true` finishes the click, as the real film does.

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchWithExtension, logPopupRects, openPopup, seedStorage } from '../../lib/browser.mjs';
import { startScreencast } from '../../record/screencast.mjs';

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

/** Eases the mouse from its current position to (x, y) over `durationMs`, logging no events (glides never fire one). */
async function glide(page, cursor, x, y, durationMs) {
  const steps = Math.max(2, Math.round(durationMs / 10));
  const x0 = cursor.x;
  const y0 = cursor.y;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    await page.mouse.move(x0 + (x - x0) * eased, y0 + (y - y0) * eased);
    await sleep(10);
  }
  cursor.x = x;
  cursor.y = y;
}

/**
 * Waits for popup_ready: two `.pet-item` rows, `expectedCells` `.type-cell`
 * buttons, and Nunito loaded (shots.json layout_expect / states.popup_ready).
 */
async function waitPopupReady(page, expectedCells, timeoutMs) {
  await page.waitForFunction(
    (n) => {
      const rows = document.querySelectorAll('.pet-item').length;
      const cells = document.querySelectorAll('.type-cell').length;
      const nunito = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Nunito' && f.status === 'loaded');
      return rows === 2 && cells === n && nunito;
    },
    expectedCells,
    { timeout: timeoutMs },
  );
}

/**
 * Drives the s2b_shelter action sequence against the real popup, capturing
 * a CDP screencast throughout (so the card "plays" the take frame by frame,
 * per this bead's step 6, instead of one still per crop) and the same
 * per-frame DOMRect tracks lib/browser.mjs's logPopupRects logs for the
 * real recorder. Returns everything callers need to assemble demo.mp4 and
 * write events.json. Releases Add Pet only when `releaseAddPet` is true
 * (logging add_mouseup); never awaits roster_saved.
 */
export async function capturePopupTake({ shot, ext, expectedTypeCells, releaseAddPet = false }) {
  const { context, serviceWorker, extensionId } = await launchWithExtension({ ext, viewport: shot.viewport });
  const workDir = mkdtempSync(join(tmpdir(), 'pixel-pets-synthetic-popup-'));
  const framesDir = join(workDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  try {
    await seedStorage(serviceWorker, shot.seed);
    const { page } = await openPopup(context, extensionId, shot.viewport);

    const cdp = await context.newCDPSession(page);
    const screencast = await startScreencast(cdp, framesDir);

    await waitPopupReady(page, expectedTypeCells, 5000);
    const recordStartT = await pageNow(page);

    await logPopupRects(page); // starts window.__ppTracks (lib/browser.mjs, frozen)
    const tracksInstallEpoch = await pageNow(page);
    const popupReadyT = await pageNow(page);

    const observed = [];
    const cursor = { x: shot.cursor_start?.x ?? 250, y: 400 };

    await sleep(300);

    await glide(page, cursor, ...(await centreOf(page, '#btn-add-toggle')), 300);
    {
      const { x, y } = { x: cursor.x, y: cursor.y };
      await page.mouse.click(x, y);
      observed.push({ t: await pageNow(page), kind: 'shelter_click', x, y });
    }
    await sleep(250); // the form's own 200 ms max-height transition

    const nameTarget = await leftOffsetOf(page, '#pet-name', 24);
    await glide(page, cursor, nameTarget.x, nameTarget.y, 250);
    {
      const { x, y } = { x: cursor.x, y: cursor.y };
      await page.mouse.click(x, y);
      observed.push({ t: await pageNow(page), kind: 'name_click', x, y });

      let lastT = await pageNow(page);
      for (const ch of 'Pip') {
        await page.keyboard.type(ch);
        lastT = await pageNow(page);
        await sleep(100);
      }
      observed.push({ t: lastT, kind: 'name_typed', x, y });
    }

    await glide(page, cursor, ...(await centreOf(page, ".type-cell[data-type='chicken']")), 300);
    {
      const { x, y } = { x: cursor.x, y: cursor.y };
      await page.mouse.click(x, y);
      observed.push({ t: await pageNow(page), kind: 'type_selected', x, y, type: 'chicken' });
    }
    await sleep(500);

    await glide(page, cursor, ...(await centreOf(page, '.color-cell:nth-child(2)')), 200);
    {
      const { x, y } = { x: cursor.x, y: cursor.y };
      await page.mouse.click(x, y);
      observed.push({ t: await pageNow(page), kind: 'color_selected', x, y, color: 'white' });
    }

    await glide(page, cursor, ...(await centreOf(page, '#btn-add')), 250);
    await sleep(30);
    {
      const { x, y } = { x: cursor.x, y: cursor.y };
      await page.mouse.move(x, y);
      await page.mouse.down();
      observed.push({ t: await pageNow(page), kind: 'add_mousedown', x, y });
    }
    // Hold well past b3e_add's out (add_mousedown+160) so the press is on
    // screen for several frames. By default the mouse is never released, so
    // addPet() (bound to mouseup) never runs; releaseAddPet lets a caller
    // finish the click the way the recorder's real take does.
    await sleep(500);
    if (releaseAddPet) {
      await page.mouse.up();
      observed.push({ t: await pageNow(page), kind: 'add_mouseup', x: cursor.x, y: cursor.y });
      await sleep(500);
    }

    await screencast.stop();
    const frames = screencast.frames;

    const rawTracks = await page.evaluate(() => window.__ppTracks ?? []);
    const tracks = rawTracks.map((f) => ({ t: tracksInstallEpoch + f.t, cells: f.cells, els: f.els }));

    return { frames, extensionId, recordStartT, popupReadyT, observed, tracks };
  } finally {
    await context.close().catch(() => {});
  }
}

async function centreOf(page, selector) {
  const rect = await liveRect(page, selector);
  if (!rect) throw new Error(`capturePopupTake: no live rect for "${selector}"`);
  return [rect.x + rect.w / 2, rect.y + rect.h / 2];
}

async function leftOffsetOf(page, selector, dx) {
  const rect = await liveRect(page, selector);
  if (!rect) throw new Error(`capturePopupTake: no live rect for "${selector}"`);
  return { x: rect.x + dx, y: rect.y + rect.h / 2 };
}

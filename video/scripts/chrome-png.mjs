#!/usr/bin/env node
// chrome-png.mjs: renders the drawn Mac window + dark browser chrome
// (set/chrome/chrome.html) to the committed PNGs the master stacks above
// each page capture (video/shots.json master.stage.chrome):
// set/chrome/<page>.png (1920x208, the 960 px window) and
// set/chrome/<page>-narrow.png (1080x208, the 9:16's 540 px window), at
// DPR 2. Before writing each PNG it measures the pinned Pixel Pets icon and
// fails unless it sits where master.stage.chrome.pinned_icon_css says, since
// the popup card hangs from that spot.
//
// Takes the machine-wide Chromium lock (lib/lock.mjs) for the whole run.
// Usage: npx tsx scripts/chrome-png.mjs

import { join } from 'node:path';
import { chromium } from 'playwright';
import { routeSet } from '../lib/browser.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { isMain, readJson, VIDEO_DIR } from './stage-io.mjs';

const SET_DIR = join(VIDEO_DIR, 'set');
/** The four set pages that get a chrome strip (the popup take has none). */
export const CHROME_PAGES = ['inbox', 'review', 'sheet', 'article'];
/** The 16:9 window and the 9:16 narrow window, in CSS px. */
export const WIDE_W = 960;
export const NARROW_W = 540;
const DETERMINISTIC_ARGS = ['--disable-gpu', '--force-color-profile=srgb', '--disable-partial-raster', '--disable-lcd-text', '--font-render-hinting=none'];

/** Every PNG to render: each page at both window widths, with its repo-relative path (shots.json's set/chrome/<page>[-narrow].png). */
export function chromeTargets(chrome) {
  return CHROME_PAGES.flatMap((page) => [
    { page, width: WIDE_W, path: `set/chrome/${page}.png` },
    { page, width: NARROW_W, path: `set/chrome/${page}-narrow.png` },
  ]).map((t) => ({ ...t, height: chrome.css_h }));
}

/** Where the pinned icon must be at window width `width`: shots.json gives it for 960; the toolbar's right end is fixed-width, so it keeps its distance from the right edge. */
export function expectedIcon(chrome, width) {
  const icon = chrome.pinned_icon_css;
  return { x: width - (WIDE_W - icon.x), y: icon.y, w: icon.w, h: icon.h };
}

/** null when the measured icon box is the expected one to within half a CSS px, else what is wrong. */
export function iconProblem(measured, expected) {
  if (!measured) return 'the pinned icon is not on the page';
  const off = ['x', 'y', 'w', 'h'].filter((k) => Math.abs(measured[k] - expected[k]) > 0.5);
  return off.length ? `pinned icon at ${JSON.stringify(measured)}, expected ${JSON.stringify(expected)}` : null;
}

export async function main() {
  const chrome = readJson(join(VIDEO_DIR, 'shots.json')).master.stage.chrome;
  const lock = await acquireLock({ ownerCommand: 'chrome-png.mjs' });
  // Software raster with fixed text and colour settings: without these flags, two runs differed in a few dozen antialiased pixels.
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: DETERMINISTIC_ARGS });
  try {
    for (const t of chromeTargets(chrome)) {
      const context = await browser.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 2 });
      try {
        const log = await routeSet(context, SET_DIR);
        const page = await context.newPage();
        await page.goto(`https://pixelpets.demo/chrome/chrome.html#${t.page}`);
        await page.evaluate(() => document.fonts.ready);
        const icon = page.locator('img.ext.pets');
        if (!(await icon.evaluate((img) => img.complete && img.naturalWidth === 16))) throw new Error(`chrome-png: ${t.path}: the pinned icon image did not load`);
        const problem = iconProblem(await icon.boundingBox(), expectedIcon(chrome, t.width));
        if (problem) throw new Error(`chrome-png: ${t.path}: ${problem}`);
        if (log.status404.length || log.unrouted.length) throw new Error(`chrome-png: ${t.path}: 404 ${log.status404.join(', ')} unrouted ${log.unrouted.join(', ')}`);
        await page.screenshot({ path: join(VIDEO_DIR, t.path), animations: 'disabled', caret: 'hide' });
        console.log(`chrome-png: ${t.path} ${t.width * 2}x${t.height * 2}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    lock.release();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

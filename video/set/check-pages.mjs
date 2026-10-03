#!/usr/bin/env node
// Real-acceptance check for the set pages: proves every page meets the
// filming rules (video/shots.json page_rules) with the real, built extension
// running, not a mock. Run with `npm run check:pages`.
//
// For each page in shots.json set_pages, at the wide (shots.json viewport,
// 960x436) and narrow (variants.vertical_9x16.viewport, 540x856) layouts:
//   - the page serves with no 404s and no unrouted (aborted) requests
//   - every font the page declares is actually loaded (not just registered)
//   - no text node's computed font-family falls outside the page's list
//   - no text box straddles the 2.0x crop line (y 166 wide, y 376 narrow)
//   - no text and nothing interactive in the bottom 150 px
//   - review's div#dbl-zone is what elementFromPoint returns at the
//     dblclick point shots.json names for that layout
//   - the seeded roster (Rex and Bao) renders as exactly 2 LOADED pet
//     images inside #pixel-pets-host's shadow root
//
// A screenshot is saved per page and layout to video/out/pages-v2/. Exits
// non-zero, listing every failure, if any check fails.
//
// `--control` adds one text row straddling the crop line on every page (a
// FAIL control): the run must then fail with one straddle per page/layout.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension, launchWithExtension, routeSet, seedStorage } from '../lib/browser.mjs';
import {
  deriveRules,
  findBottomZoneViolation,
  findStraddleViolation,
  gridPoints,
  isFontAllowed,
  isInteractiveDescriptor,
} from './check-rules.mjs';

const SET_DIR = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = join(SET_DIR, '..');
const OUT_DIR = join(VIDEO_DIR, 'out', 'pages-v2');
const CONTROL = process.argv.includes('--control');

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const shots = JSON.parse(readFileSync(join(VIDEO_DIR, 'shots.json'), 'utf-8'));
  const pages = shots.set_pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('video/shots.json has no set_pages to check');
  }

  const narrow = shots.variants.vertical_9x16;
  const { straddleY, bottomZone } = deriveRules(shots);
  const layouts = [
    {
      name: 'wide',
      viewport: { width: shots.viewport.width, height: shots.viewport.height },
      dbl: dblclickPoint(shots),
      line: straddleY.wide,
      zone: bottomZone.wide,
    },
    {
      name: 'narrow',
      viewport: { width: narrow.viewport.width, height: narrow.viewport.height },
      dbl: narrow.shots.s2_review.dblclick_css,
      line: straddleY.narrow,
      zone: bottomZone.narrow,
    },
  ];

  const ext = await buildExtension();
  const failures = [];

  for (const pageSpec of pages) {
    for (const layout of layouts) {
      // eslint-disable-next-line no-await-in-loop -- launchWithExtension holds a machine-wide lock; pages must run one at a time
      await checkPage(ext, pageSpec, layout, failures);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(' -', f);
    process.exitCode = 1;
    return;
  }

  console.log(`All ${pages.length} set pages passed at both layouts. Screenshots: ${OUT_DIR}`);
}

// The wide dblclick point: the s2_review take's dblclick_empty action.
function dblclickPoint(shots) {
  const shot = shots.shots.find((s) => s.id === 's2_review');
  const action = shot?.actions.find((a) => a.kind === 'dblclick_empty');
  if (!action) throw new Error('video/shots.json has no s2_review dblclick_empty action');
  return { x: action.x, y: action.y };
}

async function checkPage(ext, pageSpec, layout, failures) {
  const label = `${pageSpec.id} @ ${layout.name}`;
  const pagePath = new URL(pageSpec.url).pathname.replace(/^\//, '');

  const { context, serviceWorker } = await launchWithExtension({ ext, viewport: layout.viewport });
  try {
    const routeLog = await routeSet(context, SET_DIR, { seed: '1', hour: 14 });
    // A deliberately neutral seed (2 visible pets) for page checks, not a shot seed.
    await seedStorage(serviceWorker, {
      roster: [
        { id: 'rex', name: 'Rex', type: 'dog', color: 'brown' },
        { id: 'bao', name: 'Bao', type: 'panda', color: 'black' },
      ],
      positions: { rex: { x: 200 }, bao: { x: 400 } },
      treats: 10,
      theme: 'light',
      visible: true,
      homeAnchorDaysAgo: 3,
    });

    const page = await context.newPage();
    await page.goto(`https://pixelpets.demo/${pagePath}`);
    await page.waitForSelector('#pixel-pets-host', { timeout: 10000 });
    await page.waitForTimeout(300); // let both seeded pets attach and fonts finish painting

    if (routeLog.status404.length > 0) {
      failures.push(`${label}: 404s: ${routeLog.status404.join(', ')}`);
    }
    // routeSet (video/lib/browser.mjs) lets the extension's own
    // chrome-extension:// and data: requests through at the routing layer,
    // so they never reach `route.abort()` and never land in
    // routeLog.unrouted. Anything that DOES show up here was genuinely
    // aborted (a third-party host page_rules and the public-repo grep
    // forbid), so any aborted request is a real failure — no filtering.
    if (routeLog.unrouted.length > 0) {
      failures.push(`${label}: unrouted requests: ${routeLog.unrouted.join(', ')}`);
    }

    if (CONTROL) await addControlRow(page, layout.line);

    checkFonts(await getFontStatus(page, pageSpec.fonts), label, failures);
    checkText(await getTextRects(page), pageSpec.fonts, layout, label, failures);

    await page.evaluate(() => {
      document.getElementById('pixel-pets-host').style.display = 'none';
    });

    checkInteractive(await sweepInteractive(page, layout), label, failures);

    if (pageSpec.id === 'review') {
      await checkDblZone(page, layout, label, failures);
    }

    await page.evaluate(() => {
      document.getElementById('pixel-pets-host').style.display = '';
    });

    const petCount = await countLoadedPetImages(page);
    if (petCount !== 2) {
      failures.push(`${label}: expected 2 LOADED pet images in #pixel-pets-host, found ${petCount}`);
    }

    if (!CONTROL) await page.screenshot({ path: join(OUT_DIR, `${pageSpec.id}-${layout.name}.png`) });
  } finally {
    await context.close();
  }
}

// A broken <img> (bad src, aborted request) still exists in the DOM, so a
// bare querySelectorAll count would pass with every sprite showing as a
// broken-image icon. `complete && naturalWidth > 0` is the only reliable
// "actually decoded a real image" signal; wait for it with a bounded
// timeout instead of racing the pets' own attach animation.
async function countLoadedPetImages(page) {
  try {
    await page.waitForFunction(
      () => {
        const host = document.getElementById('pixel-pets-host');
        const imgs = host ? [...host.shadowRoot.querySelectorAll('#pets-layer img')] : [];
        return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
      },
      { timeout: 5000 },
    );
  } catch {
    // Timed out waiting for every image to load — fall through and count
    // however many actually loaded, so the caller reports the real number.
  }

  return page.evaluate(() => {
    const host = document.getElementById('pixel-pets-host');
    const imgs = host ? [...host.shadowRoot.querySelectorAll('#pets-layer img')] : [];
    return imgs.filter((img) => img.complete && img.naturalWidth > 0).length;
  });
}

async function getFontStatus(page, families) {
  return page.evaluate(async (fams) => {
    await document.fonts.ready;
    return fams.map((family) => ({
      family,
      loaded: Array.from(document.fonts).some((f) => f.family === family && f.status === 'loaded'),
    }));
  }, families);
}

function checkFonts(fontStatus, label, failures) {
  for (const f of fontStatus) {
    if (!f.loaded) failures.push(`${label}: font "${f.family}" is not loaded`);
  }
}

// The FAIL control: one plain Inter text row, 18 px tall, centred on the
// crop line, so its glyph box must straddle it.
async function addControlRow(page, lineY) {
  await page.evaluate((y) => {
    const row = document.createElement('div');
    row.textContent = 'control row shifted onto the crop line';
    row.style.cssText = `position:absolute;left:24px;top:${y - 9}px;height:18px;line-height:18px;font:12px Inter;color:#f0f`;
    document.body.appendChild(row);
  }, lineY);
}

async function getTextRects(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const fontFamily = getComputedStyle(node.parentElement).fontFamily;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        out.push({ top: rect.top, bottom: rect.bottom, fontFamily });
      }
    }
    return out;
  });
}

function checkText(rects, allowedFonts, layout, label, failures) {
  const { line, zone } = layout;
  for (const rect of rects) {
    const at = `(top=${rect.top.toFixed(1)}, bottom=${rect.bottom.toFixed(1)})`;
    if (!isFontAllowed(rect.fontFamily, allowedFonts)) {
      failures.push(`${label}: text uses disallowed font "${rect.fontFamily}" (allowed: ${allowedFonts.join(', ')})`);
    }
    if (findStraddleViolation(rect, line)) {
      failures.push(`${label}: text straddles y ${line} ${at}`);
    }
    if (findBottomZoneViolation(rect, zone)) {
      failures.push(`${label}: text in the bottom-150 zone y ${zone.top}-${zone.bottom} ${at}`);
    }
  }
}

async function sweepInteractive(page, layout) {
  const { zone } = layout;
  const points = gridPoints(layout.viewport.width, zone.top, zone.bottom, 20);
  return page.evaluate((pts) => {
    const found = [];
    for (const { x, y } of pts) {
      const el = document.elementFromPoint(x, y);
      if (!el || el === document.body || el === document.documentElement) continue;
      for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
        const descriptor = {
          tagName: cur.tagName,
          role: cur.getAttribute('role'),
          tabIndex: cur.tabIndex,
          hasOnClick: Boolean(cur.getAttribute('onclick')),
        };
        found.push({ x, y, descriptor });
      }
    }
    return found;
  }, points);
}

function checkInteractive(found, label, failures) {
  const seen = new Set();
  for (const { x, y, descriptor } of found) {
    if (!isInteractiveDescriptor(descriptor)) continue;
    const key = `${descriptor.tagName}@${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push(`${label}: interactive <${descriptor.tagName.toLowerCase()}> in the bottom-150 zone at (${x}, ${y})`);
  }
}

async function checkDblZone(page, layout, label, failures) {
  const { x, y } = layout.dbl;
  const tag = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el ? `${el.tagName}#${el.id}` : null;
  }, [x, y]);
  if (tag !== 'DIV#dbl-zone') {
    failures.push(`${label}: elementFromPoint(${x}, ${y}) is "${tag}", expected DIV#dbl-zone`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

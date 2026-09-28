#!/usr/bin/env node
// Real-acceptance check for pets-o3p.2: proves every original set page meets
// the filming rules (video/shots.json page_rules) with the real, built
// extension running — not a mock. Run with `npm run check:pages`.
//
// For each page in shots.json set_pages, at both the wide (960x540) and
// narrow (540x730) layouts:
//   - the page serves with no 404s and no unrouted (aborted) requests
//   - every font the page declares is actually loaded (not just registered)
//   - no text node's computed font-family falls outside the page's list
//   - no text crosses the wide-layout 286-302 band, or sits in the
//     bottom-200 zone (either layout), or — narrow only — extends below
//     y 357, except the inbox's #end-note
//   - nothing interactive sits in the bottom-200 zone
//   - review's div#dbl-zone is exactly what elementFromPoint returns at its
//     centre, at both layouts
//   - the seeded roster (Rex and Bao) renders as exactly 2 pet images
//     inside #pixel-pets-host's shadow root
//
// A screenshot is saved per page and layout to video/out/pages/. Exits
// non-zero, listing every failure, if any check fails.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension, launchWithExtension, routeSet, seedStorage } from '../lib/browser.mjs';
import {
  findBandViolation,
  findBottomZoneViolation,
  findNarrowTextOverflow,
  gridPoints,
  isFontAllowed,
  isInteractiveDescriptor,
} from './check-rules.mjs';

const SET_DIR = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = join(SET_DIR, '..');
const OUT_DIR = join(VIDEO_DIR, 'out', 'pages');

const LAYOUTS = [
  { name: 'wide', viewport: { width: 960, height: 540 } },
  { name: 'narrow', viewport: { width: 540, height: 730 } },
];

// The exceptions to the band/bottom-zone rules named in video/shots.json
// page_rules: full-height containers whose text may cross y 286-302, plus
// the inbox's one bottom-zone exception.
const EXEMPT_IDS = new Set(['end-note']);
const EXEMPT_CLASSES = new Set(['tree', 'diff', 'empty-rows']);

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const shots = JSON.parse(readFileSync(join(VIDEO_DIR, 'shots.json'), 'utf-8'));
  const pages = shots.set_pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('video/shots.json has no set_pages to check');
  }

  const ext = await buildExtension();
  const failures = [];

  for (const pageSpec of pages) {
    for (const layout of LAYOUTS) {
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

async function checkPage(ext, pageSpec, layout, failures) {
  const label = `${pageSpec.id} @ ${layout.name}`;
  const pagePath = new URL(pageSpec.url).pathname.replace(/^\//, '');

  const { context, serviceWorker } = await launchWithExtension({ ext, viewport: layout.viewport });
  try {
    const routeLog = await routeSet(context, SET_DIR, { seed: '1', hour: 14 });
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
    // routeSet aborts every non-pixelpets.demo request, which also catches
    // the extension's own chrome-extension:// sprite/icon loads (expected:
    // the extension always serves its own bundled assets, route or no
    // route). Only a THIRD-PARTY host on the page itself — the thing
    // page_rules and the public-repo grep actually forbid — counts here.
    const thirdParty = routeLog.unrouted.filter((url) => !url.startsWith('chrome-extension://'));
    if (thirdParty.length > 0) {
      failures.push(`${label}: unrouted third-party requests: ${thirdParty.join(', ')}`);
    }

    checkFonts(await getFontStatus(page, pageSpec.fonts), label, failures);
    checkText(await getTextRects(page), pageSpec.fonts, layout.name, label, failures);

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

    const petCount = await page.evaluate(
      () => document.getElementById('pixel-pets-host').shadowRoot.querySelectorAll('#pets-layer img').length,
    );
    if (petCount !== 2) {
      failures.push(`${label}: expected 2 pet images in #pixel-pets-host, found ${petCount}`);
    }

    await page.screenshot({ path: join(OUT_DIR, `${pageSpec.id}-${layout.name}.png`) });
  } finally {
    await context.close();
  }
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

async function getTextRects(page) {
  return page.evaluate(
    ({ exemptIds, exemptClasses }) => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;

        let exempt = false;
        for (let el = node.parentElement; el; el = el.parentElement) {
          if (exemptIds.includes(el.id)) exempt = true;
          if (el.classList && [...el.classList].some((c) => exemptClasses.includes(c))) exempt = true;
        }

        const fontFamily = getComputedStyle(node.parentElement).fontFamily;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          out.push({ top: rect.top, bottom: rect.bottom, fontFamily, exempt });
        }
      }
      return out;
    },
    { exemptIds: [...EXEMPT_IDS], exemptClasses: [...EXEMPT_CLASSES] },
  );
}

function checkText(rects, allowedFonts, layoutName, label, failures) {
  for (const rect of rects) {
    if (!isFontAllowed(rect.fontFamily, allowedFonts)) {
      failures.push(`${label}: text uses disallowed font "${rect.fontFamily}" (allowed: ${allowedFonts.join(', ')})`);
    }
    if (layoutName === 'wide' && findBandViolation(rect, rect.exempt)) {
      failures.push(`${label}: text crosses the 286-302 band (top=${rect.top.toFixed(1)}, bottom=${rect.bottom.toFixed(1)})`);
    }
    if (findBottomZoneViolation(rect, layoutName, rect.exempt)) {
      failures.push(`${label}: text in the bottom-200 zone (top=${rect.top.toFixed(1)}, bottom=${rect.bottom.toFixed(1)})`);
    }
    if (findNarrowTextOverflow(rect, layoutName, rect.exempt)) {
      failures.push(`${label}: narrow text extends below y357 (bottom=${rect.bottom.toFixed(1)})`);
    }
  }
}

async function sweepInteractive(page, layout) {
  const zone = layout.name === 'narrow' ? { top: 530, bottom: 730 } : { top: 340, bottom: 540 };
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
    failures.push(`${label}: interactive <${descriptor.tagName.toLowerCase()}> in the bottom-200 zone at (${x}, ${y})`);
  }
}

async function checkDblZone(page, layout, label, failures) {
  const centre = layout.name === 'narrow' ? { x: 300, y: 500 } : { x: 800, y: 410 };
  const tag = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}#${el.id}` : null;
  }, centre);
  if (tag !== 'DIV#dbl-zone') {
    failures.push(`${label}: elementFromPoint(${centre.x}, ${centre.y}) is "${tag}", expected DIV#dbl-zone`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

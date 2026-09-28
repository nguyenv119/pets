// The Chromium harness smoke test: really launches the built extension.
// Runs ONLY under `npm run test:smoke` (vitest.smoke.config.ts) — never
// inside the default `npm test`, which every other bead in this epic runs
// as a gate. See vitest.smoke.config.ts for the 100 min timeout: the
// recording lock alone can wait up to 90 min for another holder.
//
// Two separate launches, matching real usage: a page shot calls routeSet
// (which aborts every web host but pixelpets.demo, conventions.routed_html)
// and the popup take calls openPopup, never routeSet, so the two never
// share a context.

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension, launchWithExtension, routeSet, seedStorage, openPopup, logPopupRects } from './browser.mjs';

const VIDEO_DIR = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_SET_DIR = join(VIDEO_DIR, 'fixtures', 'set');

describe('the real browser harness', () => {
  it('launches the built extension and seeds a pet onto the fixture page', async () => {
    /**
     * Verifies the page-shot path end to end against a real, headless
     * Chromium: the built extension loads, routeSet serves the fixture set
     * page with no 404s, and the seeded pet renders inside the extension's
     * shadow host with its sprite actually loaded (routeSet must let the
     * extension's chrome-extension:// sprite requests through).
     *
     * This matters because every unit test in browser.test.mjs mocks
     * nothing about a real launch — this is the one check that the harness
     * every later bead imports (pets-o3p.2/.3) actually drives a real
     * browser, not just well-typed functions.
     *
     * If this contract breaks, every later bead's own smoke/record run
     * fails at the first real launch, far from this focused signal.
     */
    // GIVEN — a built extension, a fresh Chromium context, and the fixture set page routed
    const ext = await buildExtension();
    const { context, serviceWorker } = await launchWithExtension({ ext, viewport: { width: 960, height: 540 } });

    try {
      const routeLog = await routeSet(context, FIXTURE_SET_DIR, { seed: '1', hour: 14 });
      await seedStorage(serviceWorker, {
        roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }],
        positions: { rex: { x: 400 } },
        treats: 10,
        theme: 'light',
        visible: true,
        homeAnchorDaysAgo: 3,
      });

      const page = await context.newPage();
      await page.goto('https://pixelpets.demo/article.html');

      // WHEN — the seeded pet is asked to render inside the extension's host
      const host = await page.waitForSelector('#pixel-pets-host', { timeout: 10000 });
      await page.waitForFunction(() => {
        const imgs = [...(document.querySelector('#pixel-pets-host')?.shadowRoot?.querySelectorAll('img') ?? [])];
        return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
      }, null, { timeout: 10000 });

      // THEN — the fixture page served with no 404s, nothing of the extension's was aborted, and the pet is visible
      expect(routeLog.status404).toEqual([]);
      expect(routeLog.unrouted.filter((u) => u.startsWith('chrome-extension:'))).toEqual([]);
      expect(host).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  it('opens the popup in its own context with Nunito loaded and logs schema-shaped tracks', async () => {
    /**
     * Verifies the popup-take path end to end: a fresh context (no
     * routeSet — the popup take never calls it) opens the real popup,
     * Nunito loads (bundled, or via this harness's routed Google Fonts
     * response if the extension still links Google Fonts directly), and
     * logPopupRects produces Events-schema-shaped tracks[] frames with
     * cells.
     *
     * This matters because the s2b_shelter shot's every accept rule
     * depends on the popup rendering in its real font (layout_expect's
     * measured columns) with tracks logged — a font that silently fails to
     * load would shift every crop by the width of the fallback font with
     * no visible error until the recording's accept check fails, far from
     * this cause.
     *
     * If this contract breaks, logPopupRects's caller (pets-o3p.3's
     * recorder) gets an empty cells array, which the epic eval treats as a
     * hard failure (verify.mjs: "any page shot has an empty tracks array").
     */
    // GIVEN — a built extension and a fresh Chromium context, with no routeSet
    const ext = await buildExtension();
    const { context, extensionId } = await launchWithExtension({ ext, viewport: { width: 500, height: 960 } });

    try {
      // WHEN — the popup opens and its rects are logged
      const { page: popupPage, fontLog } = await openPopup(context, extensionId, { width: 500, height: 960 });
      await logPopupRects(popupPage);
      await popupPage.waitForFunction(
        () => Array.from(document.fonts).some((f) => f.family === 'Nunito' && f.status === 'loaded'),
        { timeout: 10000 },
      );
      await popupPage.waitForTimeout(200); // let a couple of rAF ticks accumulate
      const tracks = await popupPage.evaluate(() => window.__ppTracks);

      // THEN — Nunito loaded, either bundled (no Google Fonts request) or
      // via this harness's routed response, and logPopupRects is producing
      // schema-shaped frames with cells
      const cellCount = tracks.at(-1)?.cells?.length ?? 0;
      expect(cellCount).toBeGreaterThan(0);
      if (fontLog.length > 0) {
        expect(fontLog.some((url) => url.includes('/css2'))).toBe(true);
        expect(fontLog.some((url) => url.endsWith('.ttf'))).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
});

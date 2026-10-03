import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromeTargets, expectedIcon, iconProblem } from './chrome-png.mjs';
import { readJson, REPO_DIR, rgbFrame, VIDEO_DIR } from './stage-io.mjs';

const shots = readJson(join(VIDEO_DIR, 'shots.json'));
const chrome = shots.master.stage.chrome;

/** An image as RGBA bytes, so transparent icon pixels can be skipped. */
function rgba(path, width, height) {
  const data = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
  if (data.length !== width * height * 4) throw new Error(`rgba ${path}: ${data.length} bytes`);
  return data;
}
const px = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3));
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('chromeTargets / expectedIcon / iconProblem', () => {
  it('lists the eight committed PNGs at the paths shots.json names, 104 CSS px tall', () => {
    /**
     * What: each set page at 960 (set/chrome/<page>.png) and 540 (set/chrome/<page>-narrow.png).
     * Why: master.stage.chrome.png and variants.vertical_9x16.chrome.png name exactly these files, and plan.ts
     * draws them by those paths.
     * What breaks: a shot's chrome PNG is missing at render time, or the eval compares against the wrong file.
     */
    // GIVEN / WHEN
    const t = chromeTargets(chrome);
    // THEN
    expect(t.map((x) => x.path)).toEqual(['inbox', 'review', 'sheet', 'article'].flatMap((p) => [`set/chrome/${p}.png`, `set/chrome/${p}-narrow.png`]));
    expect(new Set(t.map((x) => x.height))).toEqual(new Set([104]));
  });

  it('puts the narrow window icon where the 9:16 popup card anchor expects it', () => {
    /**
     * What: at 540 px the icon is at CSS x 401-417; its centre at 2x is pinned_icon_out.cx_9x16 (818).
     * Why: overlays.popup_card.placement.9x16 hangs the card from that centre.
     * What breaks: the 9:16 card hangs from empty toolbar.
     */
    // GIVEN / WHEN
    const wide = expectedIcon(chrome, 960);
    const narrow = expectedIcon(chrome, 540);
    // THEN
    expect(wide).toEqual({ x: 821, y: 51, w: 16, h: 16 });
    expect((wide.x + 8) * 2).toBe(chrome.pinned_icon_out.cx_16x9);
    expect((narrow.x + 8) * 2).toBe(chrome.pinned_icon_out.cx_9x16);
  });

  it('accepts the expected icon box and names a shifted one', () => {
    /**
     * What: a box within half a CSS px passes; one 2 px left fails with both boxes in the message.
     * Why: chrome-png.mjs refuses to write a PNG whose icon moved, since the card placement is computed from it.
     * What breaks: a CSS change silently moves the icon away from the card's anchor.
     */
    // GIVEN
    const want = { x: 821, y: 51, w: 16, h: 16 };
    // WHEN / THEN
    expect(iconProblem({ x: 821.25, y: 51, w: 16, h: 16 }, want)).toBeNull();
    expect(iconProblem({ x: 819, y: 51, w: 16, h: 16 }, want)).toMatch(/pinned icon at .*819.*expected .*821/);
    expect(iconProblem(null, want)).toMatch(/not on the page/);
  });
});

describe('the committed chrome PNGs', () => {
  for (const t of chromeTargets(chrome)) {
    it(`${t.path}: 2x size, the traffic lights, and our icon pixel-exact at the pinned spot`, () => {
      /**
       * What: the PNG is (width x 2) x 208; the red, yellow and green lights are at CSS (20, 20), (40, 20), (60, 20);
       * every opaque pixel of assets/icons/icon-16.png appears as a 2x2 block at the pinned icon's spot.
       * Why: the eval's chrome check compares the master's top 208 rows with these files, and the popup card hangs
       * from the icon; a stale or re-laid-out PNG would pass silently otherwise.
       * What breaks: the master shows a chrome that does not match its spec, or the card hangs off-icon.
       */
      // GIVEN
      const img = rgbFrame(join(VIDEO_DIR, t.path));
      const icon = rgba(join(REPO_DIR, 'assets', 'icons', 'icon-16.png'), 16, 16);
      const at = expectedIcon(chrome, t.width);
      // WHEN
      const lights = [20, 40, 60].map((x) => px(img, x * 2, 40));
      let opaque = 0;
      let mismatched = 0;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const i = (y * 16 + x) * 4;
          if (icon[i + 3] < 255) continue;
          opaque++;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!near(px(img, (at.x + x) * 2 + dx, (at.y + y) * 2 + dy), [icon[i], icon[i + 1], icon[i + 2]], 2)) mismatched++;
        }
      // THEN
      expect([img.width, img.height]).toEqual([t.width * 2, 208]);
      expect(near(lights[0], [255, 95, 87])).toBe(true);
      expect(near(lights[1], [254, 188, 46])).toBe(true);
      expect(near(lights[2], [40, 200, 64])).toBe(true);
      expect(opaque).toBeGreaterThan(100);
      expect(mismatched).toBe(0);
    });
  }
});

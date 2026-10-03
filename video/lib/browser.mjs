// The shared browser harness: every bead that drives Chromium (the page
// checker, the recorder, the render) imports from here instead of writing
// its own launch/build/route plumbing.
//
// Frozen from this bead's commit on (video/README.md).

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from './lock.mjs';

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url)).replace(/\/lib$/, '');
const REPO_ROOT = join(VIDEO_DIR, '..');
const CACHE_EXT_DIR = join(VIDEO_DIR, '.cache', 'ext');

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function contentTypeFor(path) {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot);
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Launches a fresh, headless, persistent Chromium context with the built
 * extension loaded, holding the machine-wide recording lock (lock.mjs) until
 * `context.close()` is called. A held lock makes this wait up to the lock's
 * default timeout, printing the holder's pid and command.
 */
export async function launchWithExtension({ ext, viewport, timezoneId } = {}) {
  if (!ext) {
    throw new Error('launchWithExtension requires `ext`: the built extension directory');
  }

  const lock = await acquireLock({ ownerCommand: `launchWithExtension ${ext}` });
  const userDataDir = mkdtempSync(join(tmpdir(), 'pixel-pets-profile-'));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      viewport,
      deviceScaleFactor: 2,
      timezoneId,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--force-device-scale-factor=2'],
    });
  } catch (err) {
    lock.release();
    throw err;
  }

  const serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(serviceWorker.url()).hostname;

  const originalClose = context.close.bind(context);
  context.close = async (...args) => {
    try {
      return await originalClose(...args);
    } finally {
      lock.release();
    }
  };

  return { context, serviceWorker, extensionId };
}

/**
 * Serves `root` at https://pixelpets.demo/** with explicit content types,
 * filling only EXISTING data-pp-seed/data-pp-hour attributes on the served
 * HTML's root element. The extension's own chrome-extension:// and data:
 * loads (pet sprites) pass through; every other host is aborted. Returns a
 * log of 404s and unrouted (aborted) requests for the caller to assert
 * against.
 */
export async function routeSet(context, root, { seed, hour } = {}) {
  const log = { status404: [], unrouted: [] };

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return route.continue();
    if (url.hostname !== 'pixelpets.demo') {
      log.unrouted.push(url.href);
      return route.abort();
    }

    const relPath = url.pathname.replace(/^\//, '') || 'index.html';
    const filePath = join(root, relPath);
    if (!existsSync(filePath)) {
      log.status404.push(url.href);
      return route.fulfill({ status: 404, body: 'not found' });
    }

    const contentType = contentTypeFor(filePath);
    if (filePath.endsWith('.html')) {
      let html = readFileSync(filePath, 'utf-8');
      if (seed !== undefined && /data-pp-seed="[^"]*"/.test(html)) {
        html = html.replace(/data-pp-seed="[^"]*"/, `data-pp-seed="${seed}"`);
      }
      if (hour !== undefined && /data-pp-hour="[^"]*"/.test(html)) {
        html = html.replace(/data-pp-hour="[^"]*"/, `data-pp-hour="${hour}"`);
      }
      return route.fulfill({ status: 200, contentType, body: html });
    }

    return route.fulfill({ status: 200, contentType, body: readFileSync(filePath) });
  });

  return log;
}

/**
 * The stored positions for a seed: each pet's x with y = innerHeight - 64
 * (conventions: boxes stand on the viewport bottom, so y 372 at 960x436 and
 * 792 at 540x856). Throws when there are positions but no viewport height,
 * rather than writing a y from some other viewport.
 */
export function seedPositions(positions = {}, innerHeight) {
  const entries = Object.entries(positions);
  if (entries.length && !Number.isFinite(innerHeight)) throw new Error('seedPositions: positions need the viewport innerHeight');
  return Object.fromEntries(entries.map(([id, pos]) => [id, { x: pos.x, y: innerHeight - 64 }]));
}

/**
 * Writes the seeded roster/positions/settings/visibility into
 * chrome.storage.local from the service worker, before the page navigates
 * there (so the content script reads it at boot with no reload). Keys match
 * src/store.ts and src/settings.ts (asserted by browser.test.mjs).
 */
export async function seedStorage(serviceWorker, seed, innerHeight) {
  const now = Date.now();
  const roster = { roster: seed.roster };
  const positions = seedPositions(seed.positions, innerHeight);
  const settings = {
    theme: seed.theme ?? 'light',
    treats: seed.treats ?? 10,
    treatsUpdatedAt: now,
    homeAnchorAt: seed.homeAnchorDaysAgo !== undefined ? now - seed.homeAnchorDaysAgo * 86400000 : null,
  };
  const visible = seed.visible ?? true;

  await serviceWorker.evaluate(
    ({ roster, positions, settings, visible }) =>
      chrome.storage.local.set({
        'pixel-pets-v1': roster,
        'pixel-pets-positions-v1': positions,
        'pixel-pets-settings-v1': settings,
        'pixel-pets-visible': visible,
      }),
    { roster, positions, settings, visible },
  );
}

/**
 * Builds the extension (root `npm ci` if `../node_modules` is missing, then
 * the root build), copies `dist` to `video/.cache/ext`, and, only when
 * `shimPath` is given, prepends that file's text to `content.js`. There is
 * one build path: pets-o3p.2/.4 call `buildExtension()`, pets-o3p.3 calls
 * `buildExtension({ shimPath: 'record/shim.js' })`.
 */
export async function buildExtension({ shimPath } = {}) {
  if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
    execFileSync('npm', ['ci'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }
  execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });

  rmSync(CACHE_EXT_DIR, { recursive: true, force: true });
  mkdirSync(CACHE_EXT_DIR, { recursive: true });
  cpSync(join(REPO_ROOT, 'dist'), CACHE_EXT_DIR, { recursive: true });

  if (shimPath) {
    const contentJsPath = join(CACHE_EXT_DIR, 'content.js');
    const shim = readFileSync(join(VIDEO_DIR, shimPath), 'utf-8');
    const original = readFileSync(contentJsPath, 'utf-8');
    writeFileSync(contentJsPath, shim + original);
  }

  return CACHE_EXT_DIR;
}

/**
 * Opens the built popup as a page and routes its Google Fonts requests BY
 * PATH (not by host: nunito.css's relative `src` resolves against whichever
 * host served the CSS): a path ending in `.ttf` gets the bundled Nunito TTF,
 * and a `/css2` path gets nunito.css. Every routed URL is logged.
 */
export async function openPopup(context, extensionId, viewport) {
  const manifest = JSON.parse(readFileSync(join(CACHE_EXT_DIR, 'manifest.json'), 'utf-8'));
  const popupPath = manifest.action.default_popup;

  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);

  const fontLog = [];
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    fontLog.push(url);
    if (url.endsWith('.ttf')) {
      const body = readFileSync(join(VIDEO_DIR, 'assets', 'fonts', 'Nunito[wght].ttf'));
      return route.fulfill({ status: 200, contentType: 'font/ttf', body });
    }
    if (url.includes('/css2')) {
      const body = readFileSync(join(VIDEO_DIR, 'assets', 'fonts', 'nunito.css'), 'utf-8');
      return route.fulfill({ status: 200, contentType: 'text/css', body });
    }
    return route.continue();
  });

  await page.goto(`chrome-extension://${extensionId}/${popupPath}`);
  return { page, fontLog };
}

/**
 * Starts a rAF loop that logs every `.type-cell` DOMRect (by `data-type`)
 * and the six named popup elements, in the Events schema's tracks[] format.
 * Read the log back with `page.evaluate(() => window.__ppTracks)`.
 */
export async function logPopupRects(page) {
  await page.evaluate(() => {
    window.__ppTracks = [];
    const start = performance.now();
    const namedSelectors = {
      pets_list: '#pets-list',
      btn_add_toggle: '#btn-add-toggle',
      add_pet_form: '#add-pet-form',
      pet_name: '#pet-name',
      pet_color_label: '#pet-color-label',
      btn_add: '#btn-add',
    };

    function rectOf(selector) {
      const el = document.querySelector(selector);
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }

    function tick() {
      const cells = Array.from(document.querySelectorAll('.type-cell')).map((cell) => {
        const r = cell.getBoundingClientRect();
        return { type: cell.dataset.type, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const els = {};
      for (const [key, selector] of Object.entries(namedSelectors)) {
        els[key] = rectOf(selector);
      }
      window.__ppTracks.push({ t: performance.now() - start, pets: [], cells, els });
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

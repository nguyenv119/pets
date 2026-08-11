// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SETTINGS_KEY } from '../settings';

// ---------------------------------------------------------------------------
// Chrome API mock — must be set before any module imports that reference chrome
// ---------------------------------------------------------------------------

// REVIEW: mocking core dependency — chrome.storage.onChanged, chrome.storage.local.
// Chrome extension APIs are browser-only and cannot be exercised under Vitest/jsdom.
const chromeMock = {
  runtime: {
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    lastError: undefined as { message: string } | undefined,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (_key: string) => ({})),
      set: vi.fn(async () => {}),
    },
    onChanged: { addListener: vi.fn() },
  },
  tabs: {
    sendMessage: vi.fn((_tabId: number, _msg: unknown, cb: (r?: { alive: boolean }) => void) => cb(undefined)),
    query: vi.fn(async () => []),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

// ---------------------------------------------------------------------------
// jsdom DOM setup — mirrors the structure in popup.html
// ---------------------------------------------------------------------------

function setupDOM(): void {
  document.body.innerHTML = `
    <div id="app">
      <div id="special-page-banner" hidden></div>
      <header>
        <div class="header-row">
          <h1>Pixel Pets</h1>
          <div class="header-actions">
            <button id="btn-theme"></button>
            <button id="btn-toggle"></button>
            <button id="btn-throw-ball"></button>
          </div>
        </div>
        <div class="counters">
          <span id="treat-count"></span>
          <span id="treat-next"></span>
          <span id="capacity-count"></span>
          <span id="capacity-next"></span>
        </div>
      </header>
      <section id="pets-list"></section>
      <button id="btn-add-toggle"></button>
      <section id="add-pet-form">
        <div id="add-pet-body">
          <div class="form-grid">
            <input type="text" id="pet-name" value="" />
            <div id="pet-type-grid"></div>
            <input type="hidden" id="pet-type-value" value="dog" />
            <div id="pet-color-grid"></div>
            <input type="hidden" id="pet-color-value" value="brown" />
          </div>
          <p id="capacity-reason" hidden></p>
          <button id="btn-add"></button>
        </div>
      </section>
      <footer></footer>
      <div id="toast-region" role="status" aria-live="polite"></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Module under test — import after chrome mock is in globalThis
// ---------------------------------------------------------------------------

async function loadPopupModule(): Promise<void> {
  vi.resetModules();
  await import('./popup');
}

/** Grabs the callback popup.ts registered via chrome.storage.onChanged.addListener. */
function getRegisteredListener(): (changes: Record<string, unknown>, area: string) => void {
  const call = chromeMock.storage.onChanged.addListener.mock.calls[0];
  if (!call) throw new Error('popup.ts did not register a chrome.storage.onChanged listener');
  return call[0];
}

const flush = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupDOM();
  vi.clearAllMocks();
  chromeMock.runtime.lastError = undefined;
  chromeMock.storage.local.get.mockImplementation(async () => ({}));
  chromeMock.tabs.query.mockImplementation(async () => []);
});

describe('chrome.storage.onChanged listener — settings-change routing', () => {
  it('a local SETTINGS_KEY change refreshes the treat counter, capacity counter, theme, and add-button state', async () => {
    /**
     * Verifies that when settings change in another context (e.g. the service
     * worker consumes a treat or grants a new capacity slot) and the change
     * lands in local storage, the popup's storage listener re-renders all
     * four settings-derived UI surfaces: the treat counter, the capacity
     * counter, the theme, and the add-button disabled/reason state.
     *
     * This is the only remaining consumer of chrome.storage.onChanged after
     * the cross-tab roster sync feature was removed (popup-cross-tab.ts,
     * which made this routing independently testable, was deleted along
     * with it). Without a test invoking the real registered callback, a
     * regression here — a dropped effect, a flipped area guard, a wrong
     * key — ships green.
     *
     * If this contract breaks, the popup silently goes stale after a
     * background settings write: treat/capacity counts freeze, the theme
     * stops following toggles made elsewhere, and the add button can stay
     * wrongly enabled or disabled until the popup is closed and reopened.
     */
    // GIVEN — popup is initialized and its onChanged listener is registered
    await loadPopupModule();
    await flush();
    const onChanged = getRegisteredListener();

    // Overwrite the four effect-owned DOM surfaces with sentinel values so a
    // later match against the real computed values proves the callback ran.
    const treatCountEl = document.getElementById('treat-count')!;
    const capacityCountEl = document.getElementById('capacity-count')!;
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    treatCountEl.textContent = 'SENTINEL';
    capacityCountEl.textContent = 'SENTINEL';
    document.body.dataset.theme = 'sentinel-theme';
    btnAdd.disabled = true;

    // WHEN — the real registered callback fires for a local SETTINGS_KEY change
    onChanged({ [SETTINGS_KEY]: { newValue: {} } }, 'local');
    await flush();

    // THEN — all four effects ran and overwrote the sentinels with the
    // values derived from the (empty/default) mocked settings: fresh
    // treats (10), a fresh capacity of 1 slot with 0 pets, the default
    // 'light' theme, and an enabled add button (capacity available).
    expect(treatCountEl.textContent).toBe('10');
    expect(capacityCountEl.textContent).toBe('1');
    expect(document.body.dataset.theme).toBe('light');
    expect(btnAdd.disabled).toBe(false);
  });

  it('a sync-area SETTINGS_KEY change is ignored', async () => {
    /**
     * Verifies the `area !== 'local'` guard: a settings change reported in
     * a non-local storage area (sync, managed) must not trigger any of the
     * four popup refresh effects. This extension only ever writes to
     * chrome.storage.local, so a sync-area event is not a change this
     * popup instance produced or should react to.
     *
     * If this guard is dropped or inverted, the popup would react to
     * unrelated storage areas, causing wasted renders at best and, if a
     * different area's value shape ever differs, mis-rendered counters.
     */
    // GIVEN — popup is initialized and its onChanged listener is registered
    await loadPopupModule();
    await flush();
    const onChanged = getRegisteredListener();

    const treatCountEl = document.getElementById('treat-count')!;
    const capacityCountEl = document.getElementById('capacity-count')!;
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    treatCountEl.textContent = 'SENTINEL';
    capacityCountEl.textContent = 'SENTINEL';
    document.body.dataset.theme = 'sentinel-theme';
    btnAdd.disabled = true;

    // WHEN — the same key changes, but reported in the 'sync' area
    onChanged({ [SETTINGS_KEY]: { newValue: {} } }, 'sync');
    await flush();

    // THEN — none of the effects ran; sentinels are untouched
    expect(treatCountEl.textContent).toBe('SENTINEL');
    expect(capacityCountEl.textContent).toBe('SENTINEL');
    expect(document.body.dataset.theme).toBe('sentinel-theme');
    expect(btnAdd.disabled).toBe(true);
  });

  it('a local change to an unrelated key is ignored', async () => {
    /**
     * Verifies the key-discrimination check: a local-area storage change
     * that does not include SETTINGS_KEY (e.g. the roster key or the
     * visibility flag) must not trigger the settings-derived refresh
     * effects.
     *
     * Without this check, every local storage write — including the
     * popup's own roster/position writes — would re-render the treat and
     * capacity counters and re-apply the theme on every keystroke-adjacent
     * write, which is wasted work and, if a write races a render, a
     * source of flicker.
     */
    // GIVEN — popup is initialized and its onChanged listener is registered
    await loadPopupModule();
    await flush();
    const onChanged = getRegisteredListener();

    const treatCountEl = document.getElementById('treat-count')!;
    const capacityCountEl = document.getElementById('capacity-count')!;
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    treatCountEl.textContent = 'SENTINEL';
    capacityCountEl.textContent = 'SENTINEL';
    document.body.dataset.theme = 'sentinel-theme';
    btnAdd.disabled = true;

    // WHEN — a local change fires for an unrelated key
    onChanged({ 'pixel-pets-visible': { newValue: false } }, 'local');
    await flush();

    // THEN — none of the effects ran; sentinels are untouched
    expect(treatCountEl.textContent).toBe('SENTINEL');
    expect(capacityCountEl.textContent).toBe('SENTINEL');
    expect(document.body.dataset.theme).toBe('sentinel-theme');
    expect(btnAdd.disabled).toBe(true);
  });
});

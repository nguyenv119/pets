// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CAPACITY_GROWTH_MS } from '../settings';

// ---------------------------------------------------------------------------
// Chrome API mock — must be set before any module imports that reference chrome
// ---------------------------------------------------------------------------

const sentMessages: unknown[] = [];

// REVIEW: mocking core dependency — chrome.runtime.sendMessage, chrome.storage.local.
// Chrome extension APIs are browser-only and cannot be exercised under Vitest/jsdom.
const chromeMock = {
  runtime: {
    sendMessage: vi.fn((msg: unknown) => { sentMessages.push(msg); }),
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
// (includes #capacity-reason added by this task)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Settings shaped for a migrated user (has 2 pets, no anchor yet). */
function makeSettingsMigrated(now: number) {
  return {
    'pixel-pets-settings-v1': {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: now,
      homeAnchorAt: null,
    },
  };
}

/** Settings with a back-dated anchor that allows 3 pets. */
function makeSettingsAnchoredFor3(now: number) {
  // anchor = now - 3*GROWTH → capacity = 4 (1 + 3 intervals)
  return {
    'pixel-pets-settings-v1': {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: now,
      homeAnchorAt: now - 3 * CAPACITY_GROWTH_MS,
    },
  };
}

function makePetsStorageWith(count: number) {
  const roster = Array.from({ length: count }, (_, i) => ({
    id: `pet-${i + 1}`,
    name: `Pet${i + 1}`,
    type: 'dog',
    color: 'brown',
  }));
  const positions = Object.fromEntries(roster.map(p => [p.id, { x: 100, y: 0 }]));
  return {
    'pixel-pets-v1': { roster },
    'pixel-pets-positions-v1': positions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupDOM();
  vi.clearAllMocks();
  sentMessages.length = 0;
  chromeMock.runtime.lastError = undefined;
  chromeMock.tabs.query.mockImplementation(async () => []);
});

describe('capacity gate — btn-add enabled when capacity available', () => {
  it('leaves btn-add enabled when the user has room under their current capacity', async () => {
    /**
     * Verifies that the Add Pet button is enabled when petCount < capacity,
     * so users with available slots are not incorrectly blocked.
     *
     * The button must be enabled by default whenever capacity is not full.
     * If it is disabled when room exists, users cannot adopt pets they are
     * entitled to, which is the entire value of the extension.
     *
     * If violated, the button appears greyed out even when the roster is not
     * full, blocking the user's primary interaction.
     */
    const now = Date.now();
    // GIVEN — 1 pet, anchor set 3 days ago → capacity = 2 (room for 1 more)
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === 'pixel-pets-settings-v1') return makeSettingsAnchoredFor3(now);
      const allData = { ...makePetsStorageWith(1), ...makeSettingsAnchoredFor3(now) };
      return allData;
    });

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // THEN — btn-add is not disabled
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    expect(btnAdd.disabled).toBe(false);
  });
});

describe('capacity gate — btn-add disabled when full', () => {
  it('disables btn-add and shows reason when petCount equals capacity', async () => {
    /**
     * Verifies that the Add Pet button is disabled and #capacity-reason is
     * visible when the user's roster is at capacity.
     *
     * Without this gate, users could exceed the capacity limit, bypassing
     * the progressive-unlock mechanic and creating an unbounded roster.
     *
     * If violated, at-capacity users can click Add Pet and add more pets,
     * circumventing the growth mechanic entirely.
     */
    const now = Date.now();
    // GIVEN — fresh anchor (now), 1 pet → capacity = 1 → full
    const freshAnchorSettings = {
      'pixel-pets-settings-v1': {
        theme: 'light',
        treats: 10,
        treatsUpdatedAt: now,
        homeAnchorAt: now, // anchor just set → capacity = 1
      },
    };
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === 'pixel-pets-settings-v1') return freshAnchorSettings;
      return { ...makePetsStorageWith(1), ...freshAnchorSettings };
    });

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // THEN — btn-add disabled
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    expect(btnAdd.disabled).toBe(true);

    // AND — #capacity-reason is visible (no hidden attr) with text
    const reason = document.getElementById('capacity-reason')!;
    expect(reason.hasAttribute('hidden')).toBe(false);
    expect(reason.textContent).toContain('next home');
  });
});

describe('capacity gate — migration sets homeAnchorAt for users without anchor', () => {
  it('writes homeAnchorAt to settings on init when it is null and pets exist', async () => {
    /**
     * Verifies that init() back-fills homeAnchorAt for pre-existing users
     * (those who have pets but no anchor). Without migration, these users
     * start at capacity=1, see all their pets but cannot add more, and have
     * no countdown — completely broken UX.
     *
     * The grandfather +1 formula sets anchorAt = now - min(petCount,7)*GROWTH so
     * capacity = petCount + 1 (all pets kept, one free slot waiting on upgrade).
     *
     * If violated, existing users upgrade and immediately see "full" with no
     * countdown, or capacity 1 even though they have 3 pets.
     */
    const now = Date.now();
    // GIVEN — 2 pets, homeAnchorAt = null (upgrader, never had anchor)
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === 'pixel-pets-settings-v1') return makeSettingsMigrated(now);
      return { ...makePetsStorageWith(2), ...makeSettingsMigrated(now) };
    });

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // THEN — chrome.storage.local.set was called (settings saved with anchor)
    const setCalls = chromeMock.storage.local.set.mock.calls;
    const settingsSave = setCalls.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'pixel-pets-settings-v1' in (call[0] as object)
    );
    expect(settingsSave).toBeDefined();
    const saveArg = (settingsSave as unknown[])[0] as Record<string, { homeAnchorAt?: number | null }>;
    const saved = saveArg['pixel-pets-settings-v1'];
    expect(typeof saved.homeAnchorAt).toBe('number');
    expect(saved.homeAnchorAt).not.toBeNull();
  });

  it('does NOT re-stamp homeAnchorAt on a second init when an anchor already exists', async () => {
    /**
     * Verifies migration is idempotent: once homeAnchorAt is a number, init()
     * must never overwrite it. This is the single most dangerous regression in
     * the feature — re-stamping on every popup open would reset the growth clock
     * each time, so a user's capacity could never climb past its starting value.
     *
     * If violated, the time-gating silently never progresses: every popup open
     * restarts the 3-day cadence from zero.
     */
    const now = Date.now();
    // GIVEN — 3 pets with an anchor ALREADY set (back-dated for capacity 4)
    const original = makeSettingsAnchoredFor3(now)['pixel-pets-settings-v1'].homeAnchorAt;
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === 'pixel-pets-settings-v1') return makeSettingsAnchoredFor3(now);
      return { ...makePetsStorageWith(3), ...makeSettingsAnchoredFor3(now) };
    });

    // WHEN — popup initializes
    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // THEN — no settings write changed homeAnchorAt away from its original value
    const settingsSaves = chromeMock.storage.local.set.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'pixel-pets-settings-v1' in (call[0] as object)
    );
    for (const call of settingsSaves) {
      const saveArg = (call as unknown[])[0] as Record<string, { homeAnchorAt?: number | null }>;
      expect(saveArg['pixel-pets-settings-v1'].homeAnchorAt).toBe(original);
    }
  });
});

describe('capacity gate — addPet blocked when at capacity', () => {
  it('does NOT send ADD_PET message when btn-add is clicked while at capacity', async () => {
    /**
     * Verifies that the capacity gate prevents addPet from executing when the
     * Add Pet button is disabled (aria-disabled / .disabled guard in addPet).
     *
     * In HTML, a disabled button does not fire click events, so the guard is
     * in the button's disabled attribute. This test confirms that the button
     * is disabled when full, so the user physically cannot trigger the add.
     *
     * If violated, a user at capacity could programmatically dispatch a click
     * and add a pet, bypassing the capacity system.
     */
    const now = Date.now();
    // GIVEN — fresh anchor, 1 pet = capacity = 1 = full
    const freshAnchorSettings = {
      'pixel-pets-settings-v1': {
        theme: 'light',
        treats: 10,
        treatsUpdatedAt: now,
        homeAnchorAt: now,
      },
    };
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === 'pixel-pets-settings-v1') return freshAnchorSettings;
      return { ...makePetsStorageWith(1), ...freshAnchorSettings };
    });

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // WHEN — attempt to click Add Pet
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    expect(btnAdd.disabled).toBe(true); // confirm gate is set

    // Simulate a click (dispatching manually to bypass browser's disabled check)
    btnAdd.click();
    await new Promise(r => setTimeout(r, 0));

    // THEN — no ADD_PET was sent
    const addMsg = sentMessages.find(
      (m): m is { type: string } =>
        typeof m === 'object' && m !== null && (m as { type: string }).type === 'ADD_PET'
    );
    expect(addMsg).toBeUndefined();
  });
});

describe('capacity gate — fresh install with no anchor, no pets', () => {
  it('leaves btn-add enabled so new users can adopt their first pet', async () => {
    /**
     * Verifies the special fresh-install case: anchor=null and 0 pets.
     * currentCapacity with elapsed=0 yields capacity=1, petCount=0 < 1,
     * so the button must be enabled.
     *
     * This is the most critical case: if a brand new user sees a disabled
     * button, they cannot use the extension at all.
     *
     * If violated, new installs show a permanently disabled Add Pet button
     * with no explanation, making the extension unusable on first open.
     */
    // GIVEN — completely fresh install: no settings, no pets
    chromeMock.storage.local.get.mockImplementation(async () => ({}));

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // THEN — btn-add is enabled
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    expect(btnAdd.disabled).toBe(false);

    // AND — reason element is hidden
    const reason = document.getElementById('capacity-reason')!;
    expect(reason.hasAttribute('hidden')).toBe(true);
  });
});

describe('addPet — leaves a durable roster-exists signal (pets-b8n.2)', () => {
  it('persists a roster key when a pet is adopted from the popup on a tab with no content script', async () => {
    /**
     * addPet() leaves the signal a later content.ts boot uses to tell
     * "first install" apart from "deleted every pet": ROSTER_KEY presence
     * (see store.ts hasStoredRoster). The popup can create the first pet
     * on a tab with no content script (e.g. chrome://), so content.ts's
     * own roster write never runs for that session.
     * If violated, adopting then deleting the only pet via the popup alone
     * respawns Rex on the next normal page load.
     */
    // GIVEN — fresh install: no settings, no pets, no roster key yet
    chromeMock.storage.local.get.mockImplementation(async () => ({}));

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // WHEN — the user adopts a pet from the popup
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    expect(btnAdd.disabled).toBe(false); // confirm capacity allows the add
    btnAdd.click();
    await new Promise(r => setTimeout(r, 0));

    // THEN — a roster was persisted under the roster key
    const setCalls = chromeMock.storage.local.set.mock.calls;
    const rosterSave = setCalls.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>)['pixel-pets-v1'] !== undefined
    );
    expect(rosterSave).toBeDefined();
  });
});

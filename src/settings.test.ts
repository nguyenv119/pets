import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, saveSettings, currentTreats, TREAT_CAP, TREAT_RECHARGE_MS } from './settings';
import type { Settings } from './settings';

// ---------------------------------------------------------------------------
// Mock chrome.storage.local — chrome.* APIs are browser-only and have no Node
// polyfill with matching async semantics in the Vitest runtime. Mirrors the
// in-memory pattern used in store.test.ts.
// REVIEW: mocking core dependency — settings persistence is exercised against
// this in-memory mock; pair with manual extension verification before shipping.
// ---------------------------------------------------------------------------

let mockStorage: Record<string, unknown> = {};

const chromeStorageMock = {
  local: {
    get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
    }),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = { storage: chromeStorageMock };

beforeEach(() => {
  mockStorage = {};
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// loadSettings — defaults on empty storage
// ---------------------------------------------------------------------------

describe('loadSettings — empty storage', () => {
  it('returns defaults when storage key is absent', async () => {
    /**
     * Verifies that loadSettings returns sensible defaults when no stored data
     * exists, so the extension works on first install without crashing or
     * requiring a migration step.
     *
     * If this contract breaks, new installs see undefined treats/theme and
     * the popup crashes or shows NaN.
     */
    // GIVEN — empty storage (no key present)

    // WHEN
    const settings = await loadSettings();

    // THEN
    expect(settings.theme).toBe('light');
    expect(settings.treats).toBe(TREAT_CAP);
    expect(typeof settings.treatsUpdatedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// loadSettings — backfill partial rows
// ---------------------------------------------------------------------------

describe('loadSettings — partial stored data', () => {
  it('backfills missing fields with defaults', async () => {
    /**
     * Verifies that loadSettings adds default values for any fields that are
     * missing from the stored object (forward-compat: future fields land with
     * defaults rather than undefined).
     *
     * If this breaks, adding a new Settings field causes existing installs to
     * get undefined for that field, leading to runtime errors downstream.
     */
    // GIVEN — storage has only the theme field
    mockStorage['pixel-pets-settings-v1'] = { theme: 'dark' };

    // WHEN
    const settings = await loadSettings();

    // THEN
    expect(settings.theme).toBe('dark');
    expect(settings.treats).toBe(TREAT_CAP);
    expect(typeof settings.treatsUpdatedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// saveSettings
// ---------------------------------------------------------------------------

describe('saveSettings', () => {
  it('persists the settings object to storage', async () => {
    /**
     * Verifies that saveSettings writes the provided Settings object to
     * chrome.storage.local so it can be recovered on the next loadSettings.
     *
     * If this breaks, theme and treat count reset on every popup open.
     */
    // GIVEN
    const before = await loadSettings();
    const updated: Settings = { ...before, theme: 'dark', treats: 3 };

    // WHEN
    await saveSettings(updated);
    const loaded = await loadSettings();

    // THEN
    expect(loaded.theme).toBe('dark');
    expect(loaded.treats).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// currentTreats — basic recharge math
// ---------------------------------------------------------------------------

describe('currentTreats — recharge math', () => {
  it('returns full cap when elapsed time exceeds cap × recharge interval', () => {
    /**
     * Verifies that treat count never exceeds TREAT_CAP regardless of how
     * long has passed since the last update.
     *
     * If this breaks, the treat counter shows values above 10, breaking the
     * inventory UI and the feed-gating logic in T10.
     */
    // GIVEN — settings where treats is at 0 but very long ago
    const settings: Settings = {
      theme: 'light',
      treats: 0,
      treatsUpdatedAt: Date.now() - TREAT_RECHARGE_MS * 100,
    };

    // WHEN
    const { count } = currentTreats(settings);

    // THEN
    expect(count).toBe(TREAT_CAP);
  });

  it('computes partial recharge correctly', () => {
    /**
     * Verifies that currentTreats counts only whole completed recharge
     * intervals, not partial ones, so the counter increments discretely
     * rather than continuously.
     *
     * If this breaks, treats appear as fractional values or are over/under-
     * counted, causing incorrect feed-gating in T10.
     */
    // GIVEN — 2.5 intervals elapsed with treats at 1 → 1 + 2 = 3
    const now = Date.now();
    const settings: Settings = {
      theme: 'light',
      treats: 1,
      treatsUpdatedAt: now - Math.floor(TREAT_RECHARGE_MS * 2.5),
    };

    // WHEN
    const { count } = currentTreats(settings, now);

    // THEN
    expect(count).toBe(3);
  });

  it('returns nextRechargeMs = 0 when treats are at cap', () => {
    /**
     * Verifies that when the treat count is already at cap, nextRechargeMs
     * is 0, so the UI does not show a misleading "next in X seconds" when
     * the counter is already full.
     *
     * If this breaks, the popup shows a countdown even when treats = 10,
     * confusing users.
     */
    // GIVEN — treats already at cap
    const settings: Settings = {
      theme: 'light',
      treats: TREAT_CAP,
      treatsUpdatedAt: Date.now(),
    };

    // WHEN
    const { count, nextRechargeMs } = currentTreats(settings);

    // THEN
    expect(count).toBe(TREAT_CAP);
    expect(nextRechargeMs).toBe(0);
  });

  it('computes nextRechargeMs correctly mid-interval', () => {
    /**
     * Verifies that nextRechargeMs reflects the remaining time in the current
     * recharge interval, so the popup countdown ticks accurately to the
     * actual next treat arrival.
     *
     * If this breaks, the countdown shows the wrong duration, causing the
     * counter to jump unexpectedly when a treat arrives early or late.
     */
    // GIVEN — treats at 5, exactly 3 min (180000 ms) into a 10-min interval
    const now = Date.now();
    const elapsed = 3 * 60 * 1000; // 3 minutes
    const settings: Settings = {
      theme: 'light',
      treats: 5,
      treatsUpdatedAt: now - elapsed,
    };

    // WHEN
    const { count, nextRechargeMs } = currentTreats(settings, now);

    // THEN
    expect(count).toBe(5); // no full interval elapsed
    const expected = TREAT_RECHARGE_MS - elapsed;
    expect(nextRechargeMs).toBeCloseTo(expected, -1); // within 10ms
  });

  it('does not subtract treats when treatsUpdatedAt is in the future (clock skew)', () => {
    /**
     * Verifies that a future treatsUpdatedAt (clock skew, DST shift, or a bad
     * write from a buggy caller) does not reduce the user's treat count.
     *
     * Without clamping, `now - treatsUpdatedAt` is negative and `Math.floor`
     * of a negative produces -1 or worse, so `treats + recharged` becomes
     * `treats - 1` — silently stealing treats. Users would see their counter
     * drop without ever feeding.
     */
    // GIVEN — timestamp 5 minutes in the future
    const now = Date.now();
    const settings: Settings = {
      theme: 'light',
      treats: 3,
      treatsUpdatedAt: now + 5 * 60 * 1000,
    };

    // WHEN
    const { count, nextRechargeMs } = currentTreats(settings, now);

    // THEN — count unchanged, next recharge is one full interval away
    expect(count).toBe(3);
    expect(nextRechargeMs).toBe(TREAT_RECHARGE_MS);
  });
});

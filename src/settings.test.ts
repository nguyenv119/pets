import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSettings,
  saveSettings,
  currentTreats,
  currentCapacity,
  formatCapacityCountdown,
  TREAT_CAP,
  TREAT_RECHARGE_MS,
  CAPACITY_CAP,
  CAPACITY_GROWTH_MS,
} from './settings';
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

// ---------------------------------------------------------------------------
// currentCapacity — time-based slot boundaries
// ---------------------------------------------------------------------------

describe('currentCapacity — time-based slot boundaries', () => {
  const ANCHOR = 1_000_000_000_000; // arbitrary fixed anchor timestamp

  it('returns capacity 1 at day 0 (anchor = now)', () => {
    /**
     * Verifies that a brand-new user (anchor just stamped) starts with exactly
     * 1 capacity slot, which matches their first adopted pet.
     *
     * If this breaks, new users see a capacity of 0 or 2, causing either an
     * immediate gate-block on first adoption or an unexpected free slot shown.
     */
    // GIVEN — elapsed = 0 (at anchor)
    const now = ANCHOR;

    // WHEN
    const { capacity, isFull } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(1);
    expect(isFull).toBe(false); // 0 pets < 1 capacity => slot free
  });

  it('returns capacity 2 at day 3 (one interval elapsed)', () => {
    /**
     * Verifies that exactly one CAPACITY_GROWTH_MS interval (3 days) unlocks
     * the second slot, following the 1 + floor(elapsed/interval) formula.
     *
     * If this breaks, the slot schedule drifts and users gain or miss slots
     * at incorrect times.
     */
    // GIVEN — exactly 1 interval (3 days) elapsed
    // CAPACITY_GROWTH_MS = 3 days, so 1 * CAPACITY_GROWTH_MS = day 3
    const now = ANCHOR + 1 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(2);
  });

  it('returns capacity 3 at day 6', () => {
    /**
     * Verifies the third slot unlocks at 2 intervals (6 days), confirming the
     * discrete floor-division schedule is consistent beyond the first interval.
     */
    // GIVEN — 2 intervals (6 days) elapsed
    const now = ANCHOR + 2 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(3);
  });

  it('returns capacity 6 at day 17.9 (just before the 6th interval completes)', () => {
    /**
     * Verifies that capacity stays at 6 until the full 5th interval is
     * completed (day 15 unlocks slot 6; day 18 unlocks slot 7). At day 17.9,
     * only 5 complete intervals have elapsed so capacity is 6.
     *
     * floor(17.9 days / 3 days-per-interval) = floor(5.97) = 5 => capacity 6.
     *
     * If this breaks, slots are granted early and users see incorrect counts.
     */
    // GIVEN — 17.9 days elapsed = 5.966... intervals; floor = 5 => capacity 6
    // 1 day = CAPACITY_GROWTH_MS / 3
    const DAY_MS = CAPACITY_GROWTH_MS / 3;
    const now = ANCHOR + Math.floor(17.9 * DAY_MS);

    // WHEN
    const { capacity } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(6);
  });

  it('returns capacity 7 at day 18 (cap reached)', () => {
    /**
     * Verifies that exactly 6 completed intervals (18 days) yields the maximum
     * capacity of 7, and that the cap is inclusive at exactly day 18.
     */
    // GIVEN — exactly 6 intervals (18 days) elapsed
    const now = ANCHOR + 6 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(CAPACITY_CAP);
  });

  it('returns capacity 7 (cap) at day 21 — does not exceed cap', () => {
    /**
     * Verifies that capacity is clamped to CAPACITY_CAP even after many
     * intervals have elapsed, so the displayed number never exceeds 7.
     *
     * If this breaks, the meter shows "> 7/7" which is nonsensical and breaks
     * the UI layout.
     */
    // GIVEN — 7 intervals (21 days) elapsed (one past cap)
    const now = ANCHOR + 7 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(CAPACITY_CAP);
  });

  it('returns nextSlotMs = 0 when at cap', () => {
    /**
     * Verifies nextSlotMs is 0 when capacity is at CAPACITY_CAP so the
     * countdown UI is suppressed — there is no "next slot" to count to.
     *
     * If this breaks, the popup shows a countdown for a slot that will never
     * arrive, misleading the user.
     */
    // GIVEN — well past cap
    const now = ANCHOR + 100 * CAPACITY_GROWTH_MS;

    // WHEN
    const { nextSlotMs, capacity } = currentCapacity(ANCHOR, 0, now);

    // THEN
    expect(capacity).toBe(CAPACITY_CAP);
    expect(nextSlotMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// currentCapacity — null anchor (fresh install, no pet yet)
// ---------------------------------------------------------------------------

describe('currentCapacity — null anchor', () => {
  it('returns capacity 1, nextSlotMs = CAPACITY_GROWTH_MS when anchorAt is null and petCount is 0', () => {
    /**
     * Verifies that a fresh install (anchor not yet set) starts with capacity 1
     * and a full interval countdown, so the first adoption is allowed and the
     * meter shows the correct initial state.
     *
     * If this breaks, fresh users see capacity 0 and are immediately gate-blocked
     * on their first adoption, making the extension unusable.
     */
    // GIVEN — null anchor, 0 pets
    const now = Date.now();

    // WHEN
    const { capacity, nextSlotMs, isFull } = currentCapacity(null, 0, now);

    // THEN
    expect(capacity).toBe(1);
    expect(nextSlotMs).toBe(CAPACITY_GROWTH_MS);
    expect(isFull).toBe(false); // 0 pets < 1 capacity
  });

  it('returns isFull true when petCount >= 1 and anchor is null', () => {
    /**
     * Verifies that a user who has already adopted 1 pet (filling the only
     * null-anchor slot) sees isFull = true, so the Add button is disabled
     * until the first real interval elapses.
     *
     * If this breaks, users can adopt unlimited pets from a null anchor state.
     */
    // GIVEN — null anchor, 1 pet already adopted (fills the slot)
    const now = Date.now();

    // WHEN
    const { capacity, isFull } = currentCapacity(null, 1, now);

    // THEN
    expect(capacity).toBe(1);
    expect(isFull).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// currentCapacity — petCount clamp + HONEST countdown
// ---------------------------------------------------------------------------

describe('currentCapacity — petCount clamp and honest countdown', () => {
  const ANCHOR = 1_000_000_000_000;

  it('migrated user with 4 pets at day 0: capacity clamped to 4, nextSlotMs = 4 * CAPACITY_GROWTH_MS', () => {
    /**
     * Verifies the honest/clamp-aware countdown: a user with 4 pets whose anchor
     * is day 0 has timeCapacity = 1, which is clamped up to 4 (their pet count).
     * The next free slot is NOT in 1 interval (which would be dishonest) — it is
     * when timeCapacity reaches 5, i.e. after 4 intervals.
     *
     * If this breaks, the countdown shows "3 days" when it should show "12 days",
     * causing the Add button to appear to re-enable long before it actually does.
     */
    // GIVEN — 4 pets, anchor is day 0 (no time elapsed)
    const now = ANCHOR;

    // WHEN
    const { capacity, isFull, nextSlotMs } = currentCapacity(ANCHOR, 4, now);

    // THEN
    expect(capacity).toBe(4);
    expect(isFull).toBe(true);
    expect(nextSlotMs).toBe(4 * CAPACITY_GROWTH_MS);
  });

  it('migrated user with 4 pets at day 12: capacity becomes 5, slot is free', () => {
    /**
     * Verifies that at day 12 (4 complete intervals) the time-based capacity
     * reaches 5, which exceeds the petCount of 4, so a free slot opens.
     *
     * This is the moment the Add button re-enables for a migrated 4-pet user.
     * If this breaks, the gate never opens or opens at the wrong time.
     */
    // GIVEN — 4 pets, 12 days elapsed from anchor (4 * CAPACITY_GROWTH_MS)
    const now = ANCHOR + 4 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity, isFull } = currentCapacity(ANCHOR, 4, now);

    // THEN
    expect(capacity).toBe(5);
    expect(isFull).toBe(false);
  });

  it('clamped user partway through an interval: nextSlotMs subtracts elapsed, not just whole intervals', () => {
    /**
     * Verifies the `needed - elapsed` term of the honest countdown with a NON-ZERO
     * elapsed. The day-0 case reduces to `needed - 0`, so it never proves the
     * subtraction actually uses elapsed. Here a 4-pet user is 2.5 days into the ramp:
     * capacity stays clamped at 4, the next free slot is at 4 intervals, so the
     * remaining time must be (4 * GROWTH) minus the 2.5 days already elapsed.
     *
     * If this breaks, the countdown ignores partial progress and overstates the
     * wait, so the meter/button never reflect time already served.
     */
    // GIVEN — 4 pets, 2.5 days elapsed (mid first interval, still clamped to 4)
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = ANCHOR + 2.5 * DAY_MS;

    // WHEN
    const { capacity, nextSlotMs } = currentCapacity(ANCHOR, 4, now);

    // THEN
    expect(capacity).toBe(4);
    expect(nextSlotMs).toBe(4 * CAPACITY_GROWTH_MS - 2.5 * DAY_MS);
  });

  it('isFull is true when capacity === petCount', () => {
    /**
     * Verifies that isFull is true when the user has filled every available
     * slot (petCount equals capacity), blocking further adoption.
     *
     * If this breaks, the gate lets users adopt into a full home.
     */
    // GIVEN — 3 pets, anchor far enough for exactly 3 capacity (2 intervals = day 6)
    const now = ANCHOR + 2 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity, isFull } = currentCapacity(ANCHOR, 3, now);

    // THEN
    expect(capacity).toBe(3);
    expect(isFull).toBe(true);
  });

  it('isFull is false when capacity > petCount', () => {
    /**
     * Verifies that isFull is false when at least one capacity slot is
     * available, allowing another adoption.
     */
    // GIVEN — 2 pets, 3 intervals elapsed => capacity 4 > petCount 2
    const now = ANCHOR + 3 * CAPACITY_GROWTH_MS;

    // WHEN
    const { capacity, isFull } = currentCapacity(ANCHOR, 2, now);

    // THEN
    expect(capacity).toBe(4);
    expect(isFull).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatCapacityCountdown
// ---------------------------------------------------------------------------

describe('formatCapacityCountdown', () => {
  it('formats days and hours when >= 1 day remaining', () => {
    /**
     * Verifies the "2d 4h" format for countdowns longer than a full day,
     * giving users a clear multi-day horizon without sub-hour noise.
     *
     * If this breaks, long countdowns show confusing minute counts or
     * missing day/hour components.
     */
    // GIVEN — 2 days + 4 hours in ms
    const ms = (2 * 1440 + 4 * 60) * 60000;

    // WHEN
    const result = formatCapacityCountdown(ms);

    // THEN
    expect(result).toBe('next slot in 2d 4h');
  });

  it('formats hours and minutes when >= 1 hour but < 1 day remaining', () => {
    /**
     * Verifies the "5h 30m" format for sub-day countdowns, providing
     * hour-level precision without showing days.
     */
    // GIVEN — 5 hours + 30 minutes in ms
    const ms = (5 * 60 + 30) * 60000;

    // WHEN
    const result = formatCapacityCountdown(ms);

    // THEN
    expect(result).toBe('next slot in 5h 30m');
  });

  it('formats minutes only when < 1 hour remaining', () => {
    /**
     * Verifies the "45m" format for sub-hour countdowns, keeping the
     * message short when hours are not needed.
     */
    // GIVEN — 45 minutes in ms
    const ms = 45 * 60000;

    // WHEN
    const result = formatCapacityCountdown(ms);

    // THEN
    expect(result).toBe('next slot in 45m');
  });

  it('formats exactly 1 day as "1d 0h"', () => {
    /**
     * Verifies that exactly 1440 minutes (1 day, 0 hours) formats as "1d 0h"
     * rather than "0h 0m" or falling through to the minutes branch.
     *
     * If this breaks, the day boundary produces an inconsistent or confusing
     * format.
     */
    // GIVEN — exactly 24 hours in ms
    const ms = 24 * 60 * 60000;

    // WHEN
    const result = formatCapacityCountdown(ms);

    // THEN
    expect(result).toBe('next slot in 1d 0h');
  });

  it('rounds sub-minute ms up to 1m', () => {
    /**
     * Verifies that any ms value less than 1 minute (but > 0) is shown as
     * "1m" rather than "0m", so the countdown never tells a user "0 minutes"
     * while the clock is still running.
     *
     * If this breaks, the UI shows "next slot in 0m" for a brief window,
     * which looks broken even though the slot hasn't opened yet.
     */
    // GIVEN — 30 seconds (half a minute)
    const ms = 30000;

    // WHEN
    const result = formatCapacityCountdown(ms);

    // THEN
    expect(result).toBe('next slot in 1m');
  });
});

// ---------------------------------------------------------------------------
// loadSettings — homeAnchorAt field handling
// ---------------------------------------------------------------------------

describe('loadSettings — homeAnchorAt field handling', () => {
  it('returns homeAnchorAt = null when stored object lacks the key', async () => {
    /**
     * Verifies that a pre-feature upgrade (stored data without homeAnchorAt)
     * returns null rather than undefined or a fabricated timestamp. The null
     * signals "upgrader" to task .3 which then checks petCount to back-date.
     *
     * If this breaks, upgraders get an incorrect anchor (e.g. now) and skip
     * the grandfather migration, losing their entitled free slot.
     */
    // GIVEN — stored data from before the capacity feature (no homeAnchorAt key)
    mockStorage['pixel-pets-settings-v1'] = { theme: 'dark', treats: 5, treatsUpdatedAt: 12345 };

    // WHEN
    const settings = await loadSettings();

    // THEN
    expect(settings.homeAnchorAt).toBe(null);
  });

  it('returns homeAnchorAt = null when stored value is explicitly null', async () => {
    /**
     * Verifies that an explicitly-stored null (a fresh install that saved settings
     * before its first adoption) round-trips to null. Production deliberately
     * collapses absent-key and stored-null to the same null result; this proves
     * the stored-null branch, which the absent-key test does not exercise.
     *
     * If this breaks, a post-feature user who saved settings (e.g. toggled theme)
     * before adopting could read back undefined and fail currentCapacity's null check.
     */
    // GIVEN — stored data with homeAnchorAt explicitly null
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'dark',
      treats: 8,
      treatsUpdatedAt: 999,
      homeAnchorAt: null,
    };

    // WHEN
    const settings = await loadSettings();

    // THEN
    expect(settings.homeAnchorAt).toBe(null);
  });

  it('returns homeAnchorAt with the stored number when present', async () => {
    /**
     * Verifies that a stored homeAnchorAt timestamp survives a loadSettings
     * round-trip unchanged, so the capacity ramp continues from the correct
     * anchor rather than resetting.
     *
     * If this breaks, every loadSettings call resets the ramp to now, making
     * capacity never grow beyond 1 slot.
     */
    // GIVEN — stored data with a specific anchor
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: 0,
      homeAnchorAt: 12345,
    };

    // WHEN
    const settings = await loadSettings();

    // THEN
    expect(settings.homeAnchorAt).toBe(12345);
  });

  it('returns homeAnchorAt = null when no stored data exists (fresh install)', async () => {
    /**
     * Verifies that a fresh install (empty storage) returns homeAnchorAt = null
     * rather than undefined, so downstream consumers always receive a typed
     * value and can distinguish "not yet anchored" from "running".
     *
     * If this breaks, fresh installs get undefined which fails null checks and
     * breaks currentCapacity (undefined != null).
     */
    // GIVEN — empty storage

    // WHEN
    const settings = await loadSettings();

    // THEN
    expect(settings.homeAnchorAt).toBe(null);
  });
});

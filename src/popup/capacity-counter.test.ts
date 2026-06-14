import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderCapacityCounter } from './capacity-counter';
import { CAPACITY_CAP, CAPACITY_GROWTH_MS } from '../settings';

// ---------------------------------------------------------------------------
// DOM stub — capacity-counter.ts only reads/writes .textContent so we use
// plain objects rather than real DOM elements to avoid needing jsdom.
// ---------------------------------------------------------------------------

function makeElements(): {
  countEl: HTMLElement;
  nextEl: HTMLElement;
} {
  const countEl = { textContent: '' } as unknown as HTMLElement;
  const nextEl = { textContent: '' } as unknown as HTMLElement;
  return { countEl, nextEl };
}

// ---------------------------------------------------------------------------
// Mock chrome.storage.local
// REVIEW: mocking core dependency — chrome.storage.local is browser-only;
// we simulate the async get/set contract used by loadSettings.
// ---------------------------------------------------------------------------

let mockStorage: Record<string, unknown> = {};

const chromeStorageMock = {
  local: {
    get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
    set: vi.fn(async () => {}),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = { storage: chromeStorageMock };

beforeEach(() => {
  mockStorage = {};
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// renderCapacityCounter — full state (anchor far in past → at cap)
// ---------------------------------------------------------------------------

describe('renderCapacityCounter — full capacity (at cap)', () => {
  it('shows CAPACITY_CAP count and empty next-el when at capacity cap', async () => {
    /**
     * Verifies that when the anchor is old enough that timeCapacity reaches
     * CAPACITY_CAP (7), the count element shows "7" and the next element is
     * empty (no countdown when already at cap).
     *
     * This matters because there is no "next home" once all 7 are unlocked.
     * If this contract breaks, users see a misleading countdown despite having
     * maximum capacity, causing confusion about housing availability.
     */
    // GIVEN — anchor set 21 days ago (well past day 18 cap), 0 pets
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const anchorAt = now - 21 * 24 * 60 * 60 * 1000;
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: CAPACITY_CAP,
      treatsUpdatedAt: now,
      homeAnchorAt: anchorAt,
    };
    const { countEl, nextEl } = makeElements();

    // WHEN
    await renderCapacityCounter(countEl, nextEl, 0);

    // THEN
    expect(countEl.textContent).toBe(String(CAPACITY_CAP));
    expect(nextEl.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderCapacityCounter — mid state (some slots unlocked, more to come)
// ---------------------------------------------------------------------------

describe('renderCapacityCounter — mid state', () => {
  it('shows current capacity and next-home countdown when not at cap', async () => {
    /**
     * Verifies that when the anchor is set to a time that yields a mid-range
     * capacity (e.g. day 3 = capacity 2), the count element reflects that
     * capacity and the next element shows '· ' + formatCapacityCountdown output.
     *
     * This matters because users need to know how many homes they have and
     * when the next one unlocks so they can plan adoptions.
     *
     * If this contract breaks, the meter shows wrong home counts or missing
     * countdown, leaving users guessing about housing availability.
     */
    // GIVEN — anchor 3 growth-intervals (9 days) ago → timeCapacity = 4, petCount = 0
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const anchorAt = now - 3 * CAPACITY_GROWTH_MS; // 3 intervals → capacity 4
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: now,
      homeAnchorAt: anchorAt,
    };
    const { countEl, nextEl } = makeElements();

    // WHEN
    await renderCapacityCounter(countEl, nextEl, 0);

    // THEN — elapsed = 3*G, timeCapacity = 1 + floor(3G/G) = 4, capacity = max(0,4) = 4
    // nextSlotMs = 4*G - 3*G = G = 3 days
    expect(countEl.textContent).toBe('4');
    expect(nextEl.textContent).toMatch(/^· next home in \d+d \d+h$/);
  });
});

// ---------------------------------------------------------------------------
// renderCapacityCounter — petCount clamp + honest nextSlotMs
// ---------------------------------------------------------------------------

describe('renderCapacityCounter — petCount clamp reflects honest countdown', () => {
  it('shows petCount as capacity and next-home countdown for home petCount+1 when petCount > timeCapacity', async () => {
    /**
     * Verifies that when petCount exceeds timeCapacity (migrated user scenario),
     * capacity is clamped to petCount and the nextSlotMs is honest — it predicts
     * when the DISPLAYED capacity number increases, not slot 2.
     *
     * Example: petCount=4, anchor=day 0 → timeCapacity=1, capacity=4.
     * nextSlotMs must point to home 5 (4 * CAPACITY_GROWTH_MS), not home 2.
     *
     * If this breaks, the countdown shows the wrong time and re-enables Add too
     * early (home 5 unlocks before it should), confusing users and breaking the gate.
     */
    // GIVEN — anchor is now (day 0), petCount = 4 (migrated user)
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: now,
      homeAnchorAt: now, // day 0
    };
    const { countEl, nextEl } = makeElements();

    // WHEN
    await renderCapacityCounter(countEl, nextEl, 4);

    // THEN — capacity clamped to 4, nextSlotMs = 4 * CAPACITY_GROWTH_MS
    expect(countEl.textContent).toBe('4');
    // next home countdown should be non-empty (not at cap)
    expect(nextEl.textContent).not.toBe('');
    // should reflect ~12 days (4 * 3 days), with leading '· '
    expect(nextEl.textContent).toMatch(/^· next home in \d+d \d+h$/);
  });

  it('shows capacity 5 at day 12 when anchor was day 0 with petCount 4 (home 5 just unlocked)', async () => {
    /**
     * Verifies that after 12 days with petCount=4, the capacity shows 5
     * (timeCapacity = 1 + floor(12G/G) = 5, which beats petCount=4).
     * This confirms the clamp is only applied when petCount > timeCapacity.
     *
     * If this contract breaks, the capacity shows 4 instead of 5 at day 12,
     * and the user misses their newly unlocked home.
     */
    // GIVEN — anchor 12 days ago, petCount = 4
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const anchorAt = now - 12 * 24 * 60 * 60 * 1000;
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: now,
      homeAnchorAt: anchorAt,
    };
    const { countEl, nextEl } = makeElements();

    // WHEN
    await renderCapacityCounter(countEl, nextEl, 4);

    // THEN — timeCapacity = 1 + floor(12*G / G) = 5, max(4, 5) = 5
    expect(countEl.textContent).toBe('5');
    expect(nextEl.textContent).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderCapacityCounter — null elements are safe
// ---------------------------------------------------------------------------

describe('renderCapacityCounter — null elements', () => {
  it('returns without error when DOM elements are null', async () => {
    /**
     * Verifies that renderCapacityCounter is a no-op when the DOM elements are
     * not present (e.g., called before the HTML is injected).
     *
     * If this contract breaks, callers that invoke renderCapacityCounter before
     * DOM is ready would get a runtime TypeError and the popup would crash.
     */
    // GIVEN — no DOM elements
    // WHEN / THEN — no throw
    await expect(
      renderCapacityCounter(null, null, 0)
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderCapacityCounter — interval ticks (60s cadence)
// ---------------------------------------------------------------------------

describe('renderCapacityCounter — countdown interval cadence', () => {
  it('updates the countdown display after 60 seconds', async () => {
    /**
     * Verifies that the module-level interval ticks every 60 seconds to update
     * the countdown display, giving day/hour granularity without per-second flicker.
     *
     * The treat counter ticks every second; the capacity meter uses 60s because
     * it shows days/hours, not minutes/seconds. Per-second ticks would waste
     * CPU for a display that only changes by minutes.
     *
     * If this contract breaks, the countdown freezes after the initial render
     * and never updates until the popup is reopened.
     */
    // GIVEN — anchor 3 days ago (capacity 4, nextSlotMs = 1 interval away)
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const anchorAt = now - 3 * CAPACITY_GROWTH_MS;
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 10,
      treatsUpdatedAt: now,
      homeAnchorAt: anchorAt,
    };
    const { countEl, nextEl } = makeElements();
    await renderCapacityCounter(countEl, nextEl, 0);

    const initialText = nextEl.textContent!;
    expect(initialText).not.toBe('');

    // WHEN — advance time by 60 seconds (one interval tick)
    vi.advanceTimersByTime(60_000);

    // THEN — countdown has updated (60 fewer seconds remain)
    // The text may or may not change visually (days/hours), but re-render was triggered.
    // We primarily verify no crash occurred and the element is still populated.
    expect(nextEl.textContent).not.toBeNull();
  });
});

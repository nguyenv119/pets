import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderTreatCounter } from './treat-counter';
import { TREAT_CAP } from '../settings';

// ---------------------------------------------------------------------------
// DOM stub — treat-counter.ts only reads/writes .textContent so we use
// plain objects rather than real DOM elements to avoid needing jsdom.
// ---------------------------------------------------------------------------

function makeElements(): { countEl: HTMLElement; nextEl: HTMLElement } {
  const countEl = { textContent: '' } as unknown as HTMLElement;
  const nextEl = { textContent: '' } as unknown as HTMLElement;
  return { countEl, nextEl };
}

// ---------------------------------------------------------------------------
// Mock chrome.storage.local
// REVIEW: mocking core dependency — chrome.storage.local is browser-only;
// we simulate the async get/set contract used by loadSettings/saveSettings.
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
// renderTreatCounter — full treats
// ---------------------------------------------------------------------------

describe('renderTreatCounter — full treats', () => {
  it('displays TREAT_CAP count and no countdown when treats are full', async () => {
    /**
     * Verifies that when treats = TREAT_CAP, the counter shows "10" and
     * the next-recharge element is empty (no misleading countdown when already full).
     *
     * If this contract breaks, users see a countdown timer even when they have
     * maximum treats, causing confusion about when the next treat arrives.
     */
    // GIVEN — storage has full treats
    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: TREAT_CAP,
      treatsUpdatedAt: Date.now(),
    };
    const { countEl, nextEl } = makeElements();

    // WHEN
    await renderTreatCounter(countEl, nextEl);

    // THEN
    expect(countEl.textContent).toBe(String(TREAT_CAP));
    expect(nextEl.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderTreatCounter — partial treats show countdown
// ---------------------------------------------------------------------------

describe('renderTreatCounter — partial treats show countdown', () => {
  it('displays current count and "next in Xm Ys" when treats < cap', async () => {
    /**
     * Verifies that when treats < TREAT_CAP, the counter shows the correct
     * virtual count (after recharge math) and a human-readable countdown
     * to the next treat recharge.
     *
     * This matters because users need feedback on when their next treat
     * arrives so they know when they can feed their pet again.
     *
     * If this contract breaks, the countdown shows wrong values or is missing,
     * and users don't know when to return.
     */
    // GIVEN — 5 treats, exactly 3 minutes into a 10-minute interval
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 5,
      treatsUpdatedAt: now - 3 * 60 * 1000,
    };
    const { countEl, nextEl } = makeElements();

    // WHEN
    await renderTreatCounter(countEl, nextEl);

    // THEN — count is 5 (no full interval elapsed), countdown shows ~7m remaining
    expect(countEl.textContent).toBe('5');
    const nextText = nextEl.textContent!;
    expect(nextText).toMatch(/next in \d+m \d+s/);
    expect(nextText).toContain('7m');
  });
});

// ---------------------------------------------------------------------------
// renderTreatCounter — countdown ticks
// ---------------------------------------------------------------------------

describe('renderTreatCounter — countdown ticks over time', () => {
  it('updates the countdown display each second', async () => {
    /**
     * Verifies that the interval-based countdown decrements each second so
     * the user sees a live timer rather than a static label that never changes.
     *
     * If this contract breaks, the countdown is shown once on render but never
     * updated, causing confusion when the displayed time doesn't match reality.
     */
    // GIVEN — 5 treats, 3 minutes into a 10-minute interval (7m remaining)
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockStorage['pixel-pets-settings-v1'] = {
      theme: 'light',
      treats: 5,
      treatsUpdatedAt: now - 3 * 60 * 1000,
    };
    const { countEl, nextEl } = makeElements();
    await renderTreatCounter(countEl, nextEl);

    const initialText = nextEl.textContent!;
    expect(initialText).toContain('7m');

    // WHEN — advance 2 seconds
    vi.advanceTimersByTime(2000);

    // THEN — countdown has decremented (now shows 6m 58s)
    expect(nextEl.textContent).not.toBe(initialText);
    expect(nextEl.textContent).toContain('6m');
  });
});

// ---------------------------------------------------------------------------
// renderTreatCounter — null elements are safe
// ---------------------------------------------------------------------------

describe('renderTreatCounter — null elements', () => {
  it('returns without error when DOM elements are null', async () => {
    /**
     * Verifies that renderTreatCounter is a no-op when the DOM elements are
     * not present (e.g., called before the HTML is injected).
     *
     * If this contract breaks, callers that invoke renderTreatCounter before
     * DOM is ready would get a runtime TypeError and the popup would crash.
     */
    // GIVEN — no DOM elements
    // WHEN / THEN — no throw
    await expect(renderTreatCounter(null, null)).resolves.toBeUndefined();
  });
});

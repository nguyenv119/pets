import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Settings } from './settings';

// ---------------------------------------------------------------------------
// Mock chrome.storage.local and chrome.runtime
// chrome.* APIs are browser-only; we replicate the async contract here.
// REVIEW: mocking core dependency — chrome.storage and chrome.runtime.onMessage
// are the entire behavioral surface of the service worker. These tests verify
// the CONSUME_TREAT message handler logic by importing and exercising the
// handler directly. Pair with manual extension testing before shipping.
// ---------------------------------------------------------------------------

let mockStorage: Record<string, unknown> = {};
let messageListener: ((
  msg: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void
) => boolean | void) | null = null;

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
  },
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onMessage: {
      addListener: vi.fn((fn) => {
        messageListener = fn;
      }),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => {}),
  },
  scripting: {
    executeScript: vi.fn(async () => {}),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

// Helper: send a CONSUME_TREAT message through the registered listener.
// Returns the response from sendResponse (awaits the async chain).
async function sendConsumeTreat(): Promise<{ ok: boolean; count?: number }> {
  return new Promise((resolve) => {
    if (!messageListener) throw new Error('no listener registered');
    messageListener({ type: 'CONSUME_TREAT' }, {}, (r) => resolve(r as { ok: boolean; count?: number }));
  });
}

// Helper: seed storage with a settings object
function seedSettings(s: Settings): void {
  mockStorage['pixel-pets-settings-v1'] = s;
}

const TREAT_CAP = 10;
const TREAT_RECHARGE_MS = 10 * 60 * 1000;

beforeEach(async () => {
  mockStorage = {};
  messageListener = null;
  vi.clearAllMocks();
  vi.resetModules();
  // Re-import so module-level state (mutex) is fresh for each test
  await import('./service-worker');
});

// ---------------------------------------------------------------------------
// CONSUME_TREAT — basic cases
// ---------------------------------------------------------------------------

describe('CONSUME_TREAT — treats available', () => {
  it('decrements treats by 1 and responds ok=true when treats > 0', async () => {
    /**
     * Verifies that consuming a treat when treats > 0 produces ok=true and
     * decrements the count by exactly 1, so the content script can safely
     * call pet.feed() on a successful response.
     *
     * If this contract breaks, feeding always fails (ok=false) or
     * treats are double-counted, breaking the treat economy.
     */
    // GIVEN — 10 treats in storage
    seedSettings({ theme: 'light', treats: TREAT_CAP, treatsUpdatedAt: Date.now() });

    // WHEN
    const resp = await sendConsumeTreat();

    // THEN
    expect(resp.ok).toBe(true);
    expect(resp.count).toBe(TREAT_CAP - 1);
  });
});

describe('CONSUME_TREAT — treats at zero', () => {
  it('responds ok=false and count=0 when current treats = 0', async () => {
    /**
     * Verifies that when no treats are available (either stored=0 and not enough
     * time elapsed to recharge), the handler returns ok=false so the content
     * script skips feeding and optionally shows a ❌ particle.
     *
     * If this contract breaks, users can feed infinitely without gating,
     * destroying the treat economy entirely.
     */
    // GIVEN — 0 treats, just now (no recharge yet)
    const now = Date.now();
    seedSettings({ theme: 'light', treats: 0, treatsUpdatedAt: now });

    // WHEN
    const resp = await sendConsumeTreat();

    // THEN
    expect(resp.ok).toBe(false);
    expect(resp.count).toBe(0);
  });
});

describe('CONSUME_TREAT — recharge materialization', () => {
  it('materializes recharged treats before decrement (treats=3, 25min elapsed → 5 recharged → 4 remaining)', async () => {
    /**
     * Verifies that the SW materializes virtual recharge (treats that have
     * recharged since treatsUpdatedAt) before decrementing, so users get the
     * correct count rather than spending from a stale base.
     *
     * Additionally verifies that the sub-interval remainder is preserved in
     * treatsUpdatedAt, so the next recharge still counts the partial interval
     * already elapsed (no "double reset" bug).
     *
     * If this contract breaks, a user with 3 stored treats after 25min is told
     * they have 3 when they should have 5, and the surplus 2 treats are lost.
     */
    // GIVEN — treats=3, 25 minutes elapsed (2 full 10-min intervals + 5 min remainder)
    const now = Date.now();
    const elapsed = 25 * 60 * 1000; // 25 min
    const treatsUpdatedAt = now - elapsed;
    seedSettings({ theme: 'light', treats: 3, treatsUpdatedAt });

    // WHEN — consume 1 treat; the handler materializes to 3+2=5 then subtracts 1
    const resp = await sendConsumeTreat();

    // THEN — count is 4 (5 - 1)
    expect(resp.ok).toBe(true);
    expect(resp.count).toBe(4);

    // AND — the new treatsUpdatedAt preserves the 5-min sub-interval remainder
    // so the next recharge still arrives after ~5 more minutes, not 10.
    const stored = mockStorage['pixel-pets-settings-v1'] as Settings;
    // remainder = elapsed % TREAT_RECHARGE_MS = 5 min
    // newUpdatedAt = now - 5 min  (so next recharge is in 5 min, not 10)
    const remainder = elapsed % TREAT_RECHARGE_MS; // 5 * 60 * 1000
    const expectedUpdatedAt = now - remainder;
    expect(stored.treatsUpdatedAt).toBeCloseTo(expectedUpdatedAt, -2); // within 100ms
  });
});

describe('CONSUME_TREAT — concurrent requests', () => {
  it('serializes 3 simultaneous requests so final count is 7 (no lost updates)', async () => {
    /**
     * Verifies that concurrent CONSUME_TREAT messages are serialized by the
     * Promise-chain mutex, so each decrement reads the result of the previous
     * one rather than racing on the same snapshot.
     *
     * Without the mutex, all three reads happen before any write completes,
     * so treats goes from 10 to 9 three times — final count is 9, not 7.
     * With the mutex, each handler waits for the prior write to finish.
     *
     * If this contract breaks, rapid-clicking (or two tabs feeding at once)
     * burns only 1 treat instead of 3, breaking the economy.
     */
    // GIVEN — 10 treats
    seedSettings({ theme: 'light', treats: TREAT_CAP, treatsUpdatedAt: Date.now() });

    // WHEN — fire 3 simultaneous requests (not awaited individually)
    const [r1, r2, r3] = await Promise.all([
      sendConsumeTreat(),
      sendConsumeTreat(),
      sendConsumeTreat(),
    ]);

    // THEN — all succeed and final count is 7
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    // Counts should be 9, 8, 7 in some order
    const counts = [r1.count!, r2.count!, r3.count!].sort();
    expect(counts).toEqual([7, 8, 9]);
  });
});

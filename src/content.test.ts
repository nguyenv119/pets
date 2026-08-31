// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mock
// REVIEW: mocking core dependency — chrome.storage.local and chrome.runtime
// are browser-only and cannot be exercised under Vitest/jsdom.
// ---------------------------------------------------------------------------

let mockStorage: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          const result: Record<string, unknown> = {};
          for (const k of key) result[k] = mockStorage[k];
          return result;
        }
        return { [key]: mockStorage[key as string] };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    onMessage: { addListener: vi.fn() },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
// content.ts's game loop schedules itself via requestAnimationFrame, which
// jsdom does not implement. It is stubbed to a no-op so init() can complete
// without ever running a tick — tick() is the only place content.ts reads
// the (also-unimplemented-in-jsdom) canvas 2D context.
(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = vi.fn();

// ---------------------------------------------------------------------------
// Module under test — content.ts runs init() as an import side effect, and
// guards against double-injection via a DOM element it creates itself.
// ---------------------------------------------------------------------------

async function loadContentModule(): Promise<void> {
  document.getElementById('pixel-pets-host')?.remove();
  vi.resetModules();
  await import('./content');
  // init() is async and not awaited by the module; flush the microtask
  // queue so its storage reads/writes have settled before assertions run.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mockStorage = {};
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// init() — spawn-vs-backfill decision (pets-b8n.2)
// ---------------------------------------------------------------------------

describe('content init() — default-pet spawn is gated on the initialized flag', () => {
  it('spawns the default pet and sets the flag on a genuine first install', async () => {
    /**
     * Verifies the baseline "new user" path still works: no roster and no
     * initialized flag is a first install, so content.ts mints the
     * welcome pet and marks the flag true.
     *
     * If violated, either new installs see no pet at all, or the flag is
     * left unset and the very next load treats the same fresh roster as
     * "not yet initialized" again.
     */
    // GIVEN — nothing in storage at all

    // WHEN
    await loadContentModule();

    // THEN — a default roster of exactly one pet was persisted
    const roster = mockStorage['pixel-pets-v1'] as { roster: Array<{ name: string }> };
    expect(roster.roster).toHaveLength(1);
    expect(roster.roster[0].name).toBe('Rex');
    // AND — the flag is now set
    expect(mockStorage['pixel-pets-initialized']).toBe(true);
  });

  it('does not spawn the default pet when the roster is empty but already initialized', async () => {
    /**
     * Verifies the actual bug fix: deleting the last pet leaves an empty
     * roster with the initialized flag already true, and reloading must
     * NOT resurrect a default pet.
     *
     * This is the exact scenario that was broken in the published build —
     * an empty roster meant "spawn Rex" unconditionally, with no way to
     * distinguish "never had pets" from "deleted them all."
     *
     * If violated, every user who removes their last pet gets an unwanted
     * dog back the next time they load a page.
     */
    // GIVEN — roster emptied by the user, flag already recorded as true
    mockStorage['pixel-pets-v1'] = { roster: [] };
    mockStorage['pixel-pets-initialized'] = true;

    // WHEN
    await loadContentModule();

    // THEN — no pet was written back into the roster
    const roster = mockStorage['pixel-pets-v1'] as { roster: unknown[] };
    expect(roster.roster).toHaveLength(0);
  });

  it('back-fills the flag when a non-empty roster loads without it set', async () => {
    /**
     * Verifies the migration back-fill: a user who already has pets (e.g.
     * a legacy-storage upgrade that predates this flag) must be marked
     * initialized on their very next load, without content.ts touching
     * their existing roster.
     *
     * If violated, an existing user's flag would stay unset forever (it is
     * only ever set from the spawn branch or here), so deleting their last
     * pet later would incorrectly respawn a default pet.
     */
    // GIVEN — an existing roster, no initialized flag recorded yet
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'p1', name: 'Buddy', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-positions-v1'] = { p1: { x: 10, y: 20 } };

    // WHEN
    await loadContentModule();

    // THEN — the flag is now set
    expect(mockStorage['pixel-pets-initialized']).toBe(true);
    // AND — the existing roster was left untouched (no default pet appended)
    const roster = mockStorage['pixel-pets-v1'] as { roster: Array<{ id: string }> };
    expect(roster.roster).toHaveLength(1);
    expect(roster.roster[0].id).toBe('p1');
  });

  it('does not rewrite the flag when a non-empty roster loads and it is already true', async () => {
    /**
     * Verifies the steady-state case does no unnecessary storage write:
     * once a user is initialized, every subsequent load with pets present
     * should not touch pixel-pets-initialized again.
     *
     * If violated, every normal page load for an established user performs
     * a redundant storage write on top of the roster/positions writes.
     */
    // GIVEN — existing roster, already initialized
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'p1', name: 'Buddy', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-initialized'] = true;

    // WHEN
    await loadContentModule();

    // THEN — set() was never called with the initialized key
    const initializedWrites = chromeMock.storage.local.set.mock.calls.filter(
      (call) => (call[0] as Record<string, unknown>)['pixel-pets-initialized'] !== undefined
    );
    expect(initializedWrites).toHaveLength(0);
  });
});

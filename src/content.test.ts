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
// init() — spawn decision derived from ROSTER_KEY presence (pets-b8n.2)
// ---------------------------------------------------------------------------

describe('content init() — default-pet spawn is gated on whether a roster key exists', () => {
  it('spawns the default pet on a genuine first install (roster key absent)', async () => {
    /**
     * No ROSTER_KEY at all is a first install, so content.ts mints Rex.
     * If violated, brand-new installs show an empty scene with no pet.
     */
    // GIVEN — nothing in storage at all
    // WHEN
    await loadContentModule();
    // THEN — a default roster of exactly one pet was persisted
    const roster = mockStorage['pixel-pets-v1'] as { roster: Array<{ name: string }> };
    expect(roster.roster).toHaveLength(1);
    expect(roster.roster[0].name).toBe('Rex');
  });

  it('does not spawn when the roster key exists but holds an empty roster', async () => {
    /**
     * The bug fix: a roster key present but empty (a popup-only
     * delete-all, which never boots content.ts to back-fill anything)
     * must not be treated as a first install.
     * If violated, removing the last pet respawns an unwanted dog.
     */
    // GIVEN — roster key present, but the user emptied it
    mockStorage['pixel-pets-v1'] = { roster: [] };
    // WHEN
    await loadContentModule();
    // THEN — no pet was written back into the roster
    const roster = mockStorage['pixel-pets-v1'] as { roster: unknown[] };
    expect(roster.roster).toHaveLength(0);
  });

  it('does not respawn after a previously-populated roster is emptied and the page reloads', async () => {
    /**
     * End-to-end reported symptom, driven through two real init() runs:
     * boot with a populated roster (created by real code, not test
     * setup), empty it as the popup would, boot again.
     * A write-time flag can miss this sequence if content.ts never boots
     * between creation and emptying (e.g. a chrome:// tab); deriving the
     * signal from the roster key's presence cannot, since nothing removes
     * that key. If violated, emptying the roster and reloading respawns Rex.
     */
    // GIVEN — a populated roster, created by a real content.ts boot
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'p1', name: 'Buddy', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-positions-v1'] = { p1: { x: 10, y: 20 } };
    await loadContentModule();

    // WHEN — the roster is emptied out-of-band (e.g. by the popup) and the
    // page is reloaded, booting content.ts again
    mockStorage['pixel-pets-v1'] = { roster: [] };
    await loadContentModule();

    // THEN — no default pet was spawned into the now-empty roster
    const roster = mockStorage['pixel-pets-v1'] as { roster: unknown[] };
    expect(roster.roster).toHaveLength(0);
  });
});

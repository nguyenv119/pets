import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savePets, savePositions, loadPetData } from './store';
import type { PetData } from './types';

// ---------------------------------------------------------------------------
// Mock chrome.storage.local
// REVIEW: mocking core dependency — chrome.storage.local is browser-only and
// cannot be exercised under Vitest/jsdom. Mock faithfully replicates the
// get/set contract but cannot catch Chrome-specific quota or serialization bugs.
// ---------------------------------------------------------------------------

let mockStorage: Record<string, unknown> = {};

const chromeStorageMock = {
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
};

// Assign chrome global before tests
(globalThis as unknown as { chrome: unknown }).chrome = { storage: chromeStorageMock };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePetData(overrides: Partial<PetData> = {}): PetData {
  return {
    id: 'pet-1',
    name: 'Rex',
    type: 'dog',
    color: 'brown',
    x: 100,
    y: 300,
    ...overrides,
  };
}

beforeEach(() => {
  mockStorage = {};
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// savePets — writes roster-only shape (no x, y)
// ---------------------------------------------------------------------------

describe('savePets — roster-only shape', () => {
  it('writes to pixel-pets-v1 key (not positions key)', async () => {
    /**
     * Verifies savePets writes to the roster key, not the positions key.
     * This is the split-storage contract: roster and positions must be
     * separate so the frequent (~every 2s) position writes never touch
     * the roster key, keeping write churn low and the boot-path roster
     * read (loadPetData) clean of per-frame position noise.
     *
     * If violated, every position save also rewrites the roster key,
     * multiplying storage writes and bloating the roster payload with
     * position data on every tick.
     */
    // GIVEN — a pet with position
    const pet = makePetData({ id: 'p1', x: 500, y: 200 });

    // WHEN — save to roster
    await savePets([pet]);

    // THEN — only the roster key was written
    expect(chromeStorageMock.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'pixel-pets-v1': expect.any(Object) })
    );
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(callArg)).not.toContain('pixel-pets-positions-v1');
  });

  it('strips x and y from pets before writing roster', async () => {
    /**
     * Verifies that savePets strips positional fields (x, y) and writes
     * only roster fields (id, name, type, color, hidden).
     *
     * This keeps the roster key stable between position saves — position
     * data belongs solely in the positions key, written on its own
     * ~2-second cadence, so roster writes stay small and infrequent.
     *
     * If violated, roster entries contain x/y, bloating every roster
     * write with position data that changes on a much faster cadence.
     */
    // GIVEN — a pet with x/y
    const pet = makePetData({ id: 'p1', x: 123, y: 456 });

    // WHEN — save
    await savePets([pet]);

    // THEN — the written roster entry has no x or y
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    const stored = callArg['pixel-pets-v1'] as { roster: unknown[] };
    const entry = stored.roster[0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty('x');
    expect(entry).not.toHaveProperty('y');
  });

  it('includes id, name, type, color in roster entry', async () => {
    /**
     * Verifies that savePets preserves the identity fields in roster entries
     * so loadPetData can reconstruct a full PetData on the next boot without
     * needing position data.
     *
     * If violated, the roster is missing required identity information and
     * pets fail to reconstruct correctly (or at all) on the next page load.
     */
    // GIVEN — a pet with all fields
    const pet = makePetData({ id: 'p2', name: 'Buddy', type: 'fox', color: 'red', x: 0, y: 0 });

    // WHEN — save
    await savePets([pet]);

    // THEN — roster entry has identity fields
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    const stored = callArg['pixel-pets-v1'] as { roster: unknown[] };
    expect(stored.roster[0]).toMatchObject({ id: 'p2', name: 'Buddy', type: 'fox', color: 'red' });
  });

  it('preserves hidden field in roster entry when set', async () => {
    /**
     * Verifies that the hidden flag survives the roster strip so the next
     * boot-path load restores the pet's shown/hidden state correctly.
     *
     * If violated, all pets appear visible again after a reload regardless
     * of their actual hidden state, silently discarding the user's choice.
     */
    // GIVEN — a hidden pet
    const pet = makePetData({ id: 'h1', hidden: true, x: 0, y: 0 });

    // WHEN — save
    await savePets([pet]);

    // THEN — hidden is preserved
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    const stored = callArg['pixel-pets-v1'] as { roster: unknown[] };
    const entry = stored.roster[0] as Record<string, unknown>;
    expect(entry.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// savePositions — writes to separate key
// ---------------------------------------------------------------------------

describe('savePositions — writes to positions key', () => {
  it('writes to pixel-pets-positions-v1, not the roster key', async () => {
    /**
     * Verifies savePositions targets the positions key so the roster key
     * remains unchanged on every position save.
     *
     * If violated, every debouncedSave (on a ~2s cadence, driven by pet
     * movement) also rewrites the roster key, multiplying storage writes
     * and defeating the purpose of splitting the two keys.
     */
    // GIVEN — some positions
    const positions = { 'p1': { x: 100, y: 200 } };

    // WHEN — save positions
    await savePositions(positions);

    // THEN — positions key written, NOT roster key
    expect(chromeStorageMock.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'pixel-pets-positions-v1': positions })
    );
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(callArg)).not.toContain('pixel-pets-v1');
  });
});

// ---------------------------------------------------------------------------
// loadPetData — merges roster + positions
// ---------------------------------------------------------------------------

describe('loadPetData — merges roster and positions', () => {
  it('merges positions into roster entries on boot', async () => {
    /**
     * Verifies loadPetData reads both storage keys and merges them so that
     * the returned PetData objects include x/y from the positions key.
     *
     * This is the boot path: all callers that need full PetData use
     * loadPetData.
     *
     * If violated, all pets start at (0, 0) on every page load instead
     * of their last-known positions.
     */
    // GIVEN — roster and positions stored separately
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'p1', name: 'Rex', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-positions-v1'] = { 'p1': { x: 300, y: 500 } };

    // WHEN
    const result = await loadPetData();

    // THEN — x/y come from positions
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(300);
    expect(result[0].y).toBe(500);
    expect(result[0].id).toBe('p1');
  });

  it('defaults x/y to 0 when positions key has no entry for a pet', async () => {
    /**
     * Verifies loadPetData handles missing position for a pet gracefully.
     * A newly added pet may not yet have a position record in the positions key.
     *
     * If violated, content.ts throws when accessing undefined x/y or
     * the pet renders at undefined coordinates breaking the scene.
     */
    // GIVEN — roster with a pet but no positions
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'p1', name: 'Rex', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-positions-v1'] = {};

    // WHEN
    const result = await loadPetData();

    // THEN — default position
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
  });

  it('returns empty array when storage is empty', async () => {
    /**
     * Verifies loadPetData returns [] on empty storage (fresh install).
     * This allows content.ts to detect "no pets" and add the default pet.
     *
     * If violated, the default pet is never added on first install.
     */
    // GIVEN — empty storage
    // WHEN
    const result = await loadPetData();

    // THEN
    expect(result).toEqual([]);
  });

  it('returns empty array when chrome.storage.local.get throws', async () => {
    /**
     * Verifies error resilience in loadPetData: if storage read fails,
     * return [] rather than propagating the error.
     *
     * If violated, content.ts init() crashes and no pets ever render.
     */
    // GIVEN — storage throws
    chromeStorageMock.local.get.mockRejectedValueOnce(new Error('quota exceeded'));

    // WHEN
    const result = await loadPetData();

    // THEN
    expect(result).toEqual([]);
  });

  it('handles legacy flat-array storage shape by returning empty array', async () => {
    /**
     * Verifies loadPetData returns [] when encountering the old storage
     * format (plain PetData[] at the roster key). The new format uses
     * { roster: RosterEntry[] }; the old format is unrecognized and
     * we fall back to empty.
     *
     * KNOWN GAP: this is not just "position data is lost" — the entire
     * roster is discarded. An upgrading user with N pets sees all N
     * vanish on first load after the upgrade, because the legacy array
     * is never read into the new shape, only treated as absent. This
     * test documents that current behavior; it does not endorse it. The
     * real fix — reading the legacy array and migrating it into the new
     * split-storage shape — is tracked as the filed release-blocker bead
     * pets-b8n.5 and is intentionally NOT implemented here.
     *
     * If violated in the other direction (legacy data misinterpreted
     * instead of dropped), it could cause type errors or garbled pets —
     * so returning [] is the safe fallback until pets-b8n.5 lands.
     */
    // GIVEN — old-format data
    mockStorage['pixel-pets-v1'] = [{ id: 'old', name: 'OldPet', type: 'dog', color: 'brown', x: 1, y: 2 }];

    // WHEN
    const result = await loadPetData();

    // THEN — treated as empty (new format required)
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// savePets + loadPetData — round-trip (new shape)
// ---------------------------------------------------------------------------

describe('savePets + savePositions + loadPetData — round-trip', () => {
  it('saves roster and positions separately then merges on load', async () => {
    /**
     * Full round-trip: saves roster via savePets and positions via
     * savePositions, then verifies loadPetData returns merged PetData.
     *
     * This is the canonical read-after-write contract for the split
     * storage design. Ensures both halves of the split are written and
     * read consistently.
     *
     * If violated, content.ts boots with wrong pet data after the
     * positions or roster is updated independently.
     */
    // GIVEN — a pet
    const pet = makePetData({ id: 'abc', name: 'Buddy', x: 200, y: 350 });

    // WHEN — save in split format
    await savePets([pet]);
    await savePositions({ 'abc': { x: 200, y: 350 } });

    const result = await loadPetData();

    // THEN — round-trip succeeds
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('abc');
    expect(result[0].x).toBe(200);
    expect(result[0].y).toBe(350);
  });

  it('preserves order of pets from roster', async () => {
    /**
     * Verifies that loadPetData preserves the roster order when merging,
     * so drag-reorder is correctly reflected across page loads.
     *
     * If violated, pets appear in arbitrary order each time the page loads,
     * ignoring user drag-reorder preferences.
     */
    // GIVEN — two pets in order
    const p1 = makePetData({ id: 'p1', name: 'Rex', x: 100, y: 300 });
    const p2 = makePetData({ id: 'p2', name: 'Kitsune', type: 'fox', color: 'red', x: 400, y: 300 });

    await savePets([p1, p2]);
    await savePositions({ 'p1': { x: 100, y: 300 }, 'p2': { x: 400, y: 300 } });

    // WHEN
    const result = await loadPetData();

    // THEN — order preserved
    expect(result[0].id).toBe('p1');
    expect(result[1].id).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// loadPetData — storage key contract (legacy tests updated)
// ---------------------------------------------------------------------------

describe('loadPetData — storage key', () => {
  it('reads from pixel-pets-v1 for roster data', async () => {
    /**
     * Verifies loadPetData reads the roster from the correct key.
     * If the key changes, all pets disappear on load.
     */
    // GIVEN
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'manual', name: 'ManualPet', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-positions-v1'] = { 'manual': { x: 50, y: 100 } };

    // WHEN
    const result = await loadPetData();

    // THEN
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('manual');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savePets, savePositions, loadPetData, loadRoster, dedupeById } from './store';
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
     * separate so cross-tab listeners can watch the roster key without
     * being flooded by per-frame position updates.
     *
     * If violated, cross-tab listeners fire on every position save,
     * causing all content scripts to reconcile dozens of times per second.
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
     * This prevents the cross-tab listener from seeing position data in
     * roster changes, keeping the roster key stable between position saves.
     *
     * If violated, roster entries contain x/y which leak position data
     * to other tabs and bloat the storage event payload.
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
     * so other tabs can reconstruct the pet without position data.
     *
     * If violated, other tabs cannot add/remove/update pets correctly
     * because the roster entries lack required identity information.
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
     * Verifies that the hidden flag survives the roster strip so cross-tab
     * reconciliation can correctly show/hide pets on arrival.
     *
     * If violated, all pets appear visible on other tabs regardless of their
     * actual hidden state.
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
     * remains unchanged and does NOT trigger cross-tab listeners.
     *
     * If violated, every debouncedSave fires the cross-tab reconcile
     * handler causing expensive DOM operations 60 times per second.
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
// loadRoster — reads roster key
// ---------------------------------------------------------------------------

describe('loadRoster — reads roster shape from storage', () => {
  it('returns roster array from pixel-pets-v1 when stored in new shape', async () => {
    /**
     * Verifies loadRoster can parse the new storage shape where the key
     * contains { roster: RosterEntry[] } instead of a plain PetData array.
     *
     * Needed so cross-tab listeners in content.ts can read the current roster.
     *
     * If violated, cross-tab reconciliation receives empty roster and
     * removes all pets from other tabs on first storage change.
     */
    // GIVEN — new-shape data in storage
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'p1', name: 'Rex', type: 'dog', color: 'brown' }],
    };

    // WHEN
    const result = await loadRoster();

    // THEN
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0].id).toBe('p1');
  });

  it('returns empty roster when key is absent', async () => {
    /**
     * Verifies loadRoster gracefully handles missing storage key.
     * On first install or cleared storage, the roster key does not exist.
     *
     * If violated, cross-tab listener crashes trying to iterate undefined.
     */
    // GIVEN — empty storage
    // WHEN
    const result = await loadRoster();

    // THEN
    expect(result.roster).toEqual([]);
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
     * loadPetData. loadRoster is only for the cross-tab listener.
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
     * This is acceptable: the migration path is that content.ts adds
     * the default pet and saves the new format. Users lose position data
     * on first load after the upgrade, which is acceptable.
     *
     * If violated, legacy data might be misinterpreted, causing type
     * errors or garbled pets.
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

// ---------------------------------------------------------------------------
// dedupeById — pure helper
// ---------------------------------------------------------------------------

describe('dedupeById — pure helper', () => {
  it('keeps first occurrence and drops subsequent duplicates', () => {
    /**
     * Verifies dedupeById retains the first item with a given id and
     * discards any later items with the same id.
     *
     * This is the contract that prevents [X,X] roster corruption from
     * persisting or propagating. Keeping FIRST preserves the original
     * item's state rather than an overwritten copy.
     *
     * If violated, savePets / loadPetData could still produce duplicate
     * pets causing two visible sprites to share one id.
     */
    // GIVEN — two items with the same id
    const items = [
      { id: 'a', name: 'First' },
      { id: 'a', name: 'Duplicate' },
    ];

    // WHEN
    const result = dedupeById(items);

    // THEN — only first kept
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('First');
  });

  it('preserves all items when ids are distinct', () => {
    /**
     * Verifies dedupeById does not remove legitimate items that happen
     * to have unique ids. The regression guard for the happy path.
     *
     * If violated, normal multi-pet rosters would silently lose pets
     * each time the roster is saved or loaded.
     */
    // GIVEN — two items with distinct ids
    const items = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ];

    // WHEN
    const result = dedupeById(items);

    // THEN — both preserved in order
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('preserves insertion order of first occurrences', () => {
    /**
     * Verifies dedupeById maintains the original order of items, which
     * matters because roster order is user-controlled (drag-to-reorder).
     *
     * If violated, pets appear in arbitrary order after dedupe, ignoring
     * the order the user set.
     */
    // GIVEN — three items, one duplicate
    const items = [
      { id: 'c', name: 'Charlie' },
      { id: 'a', name: 'Alpha' },
      { id: 'c', name: 'Charlie-dup' },
      { id: 'b', name: 'Beta' },
    ];

    // WHEN
    const result = dedupeById(items);

    // THEN — order of first occurrences preserved
    expect(result.map(i => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns empty array for empty input', () => {
    /**
     * Verifies dedupeById handles empty input gracefully.
     * Prevents crashes when called on an empty roster.
     */
    // GIVEN — empty array
    // WHEN
    const result = dedupeById([]);

    // THEN
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// savePets — dedupe by id on write
// ---------------------------------------------------------------------------

describe('savePets — dedupe duplicate-id pets on write', () => {
  it('writes a single roster entry when given two pets with the same id', async () => {
    /**
     * Verifies savePets deduplicates by id before persisting. When a
     * duplicate-id pet exists in memory (due to the ADD_PET race), only
     * one entry must reach storage so the [X,X] corruption cannot be saved.
     *
     * This is a write-time guard that prevents corruption at the source.
     *
     * If violated, saving after the ADD_PET race writes [X,X] to storage
     * and the duplication survives page reload.
     */
    // GIVEN — two pets with the same id
    const pet = makePetData({ id: 'dup', name: 'Original', x: 0, y: 0 });
    const petDup = makePetData({ id: 'dup', name: 'Duplicate', x: 10, y: 10 });

    // WHEN — save both
    await savePets([pet, petDup]);

    // THEN — only one entry written, first wins
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    const stored = callArg['pixel-pets-v1'] as { roster: Array<{ id: string; name: string }> };
    expect(stored.roster).toHaveLength(1);
    expect(stored.roster[0].id).toBe('dup');
    expect(stored.roster[0].name).toBe('Original');
  });

  it('preserves all distinct-id pets in order when no duplicates', async () => {
    /**
     * Regression: dedupe must not drop legitimate distinct-id pets.
     * Multi-pet users would silently lose pets if this contract breaks.
     *
     * If violated, normal saves strip pets from the roster, making
     * pets disappear permanently on next load.
     */
    // GIVEN — two pets with distinct ids
    const p1 = makePetData({ id: 'p1', name: 'Rex', x: 0, y: 0 });
    const p2 = makePetData({ id: 'p2', name: 'Kitsune', type: 'fox', color: 'red', x: 0, y: 0 });

    // WHEN
    await savePets([p1, p2]);

    // THEN — both preserved
    const callArg = chromeStorageMock.local.set.mock.calls[0][0] as Record<string, unknown>;
    const stored = callArg['pixel-pets-v1'] as { roster: Array<{ id: string }> };
    expect(stored.roster).toHaveLength(2);
    expect(stored.roster[0].id).toBe('p1');
    expect(stored.roster[1].id).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// loadPetData — dedupe by id on read (self-heal corrupted storage)
// ---------------------------------------------------------------------------

describe('loadPetData — dedupe corrupted [X,X] roster on read', () => {
  it('returns one PetData when storage has two roster entries with the same id', async () => {
    /**
     * Verifies loadPetData self-heals an already-corrupted [X,X] roster by
     * deduplicating on read. Users who already have corruption in storage
     * should see a correct single-pet render immediately on next load,
     * without needing to clear storage manually.
     *
     * If violated, corrupted storage continues rendering two overlapping
     * sprites and the next savePets persists the duplication again.
     */
    // GIVEN — corrupted [X,X] storage
    mockStorage['pixel-pets-v1'] = {
      roster: [
        { id: 'x', name: 'Rex', type: 'dog', color: 'brown' },
        { id: 'x', name: 'Rex', type: 'dog', color: 'brown' },
      ],
    };
    mockStorage['pixel-pets-positions-v1'] = { 'x': { x: 100, y: 200 } };

    // WHEN
    const result = await loadPetData();

    // THEN — only one pet returned
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('x');
    expect(result[0].x).toBe(100);
  });

  it('preserves all distinct pets when roster has no duplicates', async () => {
    /**
     * Regression: loadPetData dedupe must not drop legitimate pets.
     * Verifies the happy path is unaffected by the dedupe guard.
     *
     * If violated, every load drops all pets after the first, leaving
     * the user with only one pet regardless of how many they added.
     */
    // GIVEN — two distinct-id entries
    mockStorage['pixel-pets-v1'] = {
      roster: [
        { id: 'a', name: 'Alpha', type: 'dog', color: 'brown' },
        { id: 'b', name: 'Beta', type: 'fox', color: 'red' },
      ],
    };
    mockStorage['pixel-pets-positions-v1'] = {
      'a': { x: 10, y: 20 },
      'b': { x: 30, y: 40 },
    };

    // WHEN
    const result = await loadPetData();

    // THEN — both pets returned
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// loadRoster — dedupe by id on read
// ---------------------------------------------------------------------------

describe('loadRoster — dedupe corrupted [X,X] roster on read', () => {
  it('returns one entry when storage has two roster entries with the same id', async () => {
    /**
     * Verifies loadRoster deduplicates the roster it returns, so cross-tab
     * listeners that call loadRoster cannot receive a corrupted [X,X] roster
     * and trigger duplicate pet reconciliation in other tabs.
     *
     * If violated, cross-tab reconcile receives two entries for the same id
     * and may instantiate two pet sprites in the listening tab.
     */
    // GIVEN — corrupted [X,X] storage
    mockStorage['pixel-pets-v1'] = {
      roster: [
        { id: 'y', name: 'Buddy', type: 'dog', color: 'black' },
        { id: 'y', name: 'Buddy', type: 'dog', color: 'black' },
      ],
    };

    // WHEN
    const result = await loadRoster();

    // THEN — only one entry
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0].id).toBe('y');
  });

  it('preserves all distinct entries when no duplicates', async () => {
    /**
     * Regression: loadRoster dedupe must not drop legitimate distinct entries.
     *
     * If violated, cross-tab listeners receive incomplete rosters, causing
     * pets to be removed from other tabs when a storage event fires.
     */
    // GIVEN — two distinct entries
    mockStorage['pixel-pets-v1'] = {
      roster: [
        { id: 'r1', name: 'Rex', type: 'dog', color: 'brown' },
        { id: 'r2', name: 'Kitsune', type: 'fox', color: 'orange' },
      ],
    };

    // WHEN
    const result = await loadRoster();

    // THEN — both preserved
    expect(result.roster).toHaveLength(2);
    expect(result.roster[0].id).toBe('r1');
    expect(result.roster[1].id).toBe('r2');
  });
});

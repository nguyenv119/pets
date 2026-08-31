import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savePets, savePositions, loadPetData, shouldSpawnDefault } from './store';
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

});

// ---------------------------------------------------------------------------
// loadPetData — legacy 1.0.4 flat-array migration (pets-b8n.5)
// ---------------------------------------------------------------------------

describe('loadPetData — legacy 1.0.4 flat-array migration', () => {
  // Real payload read out of a live 1.0.4 install's chrome.storage.local at
  // pixel-pets-v1. Published 1.0.4 wrote a bare array (no `roster` wrapper,
  // no separate positions key) — this is the exact shape loadPetData must
  // recognize and upgrade in place.
  const legacyFixture = [
    {
      color: 'brown',
      id: '409ab74c-3300-4840-8e30-1da87baa5c0c',
      name: 'Rex',
      type: 'dog',
      x: 310.0079999999654,
      y: 940,
    },
  ];

  it('reads a single-pet legacy array into full PetData', async () => {
    /**
     * Verifies that a bare legacy array with one pet is recognized and
     * converted, rather than being treated as "not new-shape" and dropped.
     *
     * This is the core release-blocker fix: published 1.0.4 stores the
     * roster as a flat array at pixel-pets-v1, and main previously returned
     * [] for anything that wasn't {roster: [...]}. content.ts then reads []
     * as a first install, spawns the default Rex, and overwrites the key —
     * destroying the user's real roster.
     *
     * If violated, every pre-existing 1.0.4 user loses their pets the
     * moment they update to a build that includes this check.
     */
    // GIVEN — legacy flat-array storage, no positions key at all
    mockStorage['pixel-pets-v1'] = legacyFixture;

    // WHEN
    const result = await loadPetData();

    // THEN — the pet survives with its identity intact
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: '409ab74c-3300-4840-8e30-1da87baa5c0c',
      name: 'Rex',
      type: 'dog',
      color: 'brown',
    });
  });

  it('reads a multi-pet legacy array preserving all entries', async () => {
    /**
     * Verifies the migration handles more than one legacy pet, not just
     * the single-fixture case — a user with a full roster must not have
     * entries silently dropped during the upgrade.
     *
     * If violated, upgrading users with multiple pets could lose all but
     * one, which would look like a partial (and confusing) data loss bug
     * rather than the totalizing loss this bead already fixes.
     */
    // GIVEN — two legacy pets
    mockStorage['pixel-pets-v1'] = [
      legacyFixture[0],
      { color: 'red', id: 'second-pet-id', name: 'Kitsune', type: 'fox', x: 50, y: 300 },
    ];

    // WHEN
    const result = await loadPetData();

    // THEN — both pets survive
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(['409ab74c-3300-4840-8e30-1da87baa5c0c', 'second-pet-id']);
  });

  it('preserves the legacy x coordinate instead of defaulting to 0', async () => {
    /**
     * Verifies that x is carried over from the legacy entry (where it was
     * stored inline) rather than defaulted, since there is no positions
     * key yet to read it from.
     *
     * If violated, every migrated pet would stack at x=0 on first render
     * after the upgrade instead of appearing where the user left it.
     */
    // GIVEN — legacy entry with a distinctive x
    mockStorage['pixel-pets-v1'] = legacyFixture;

    // WHEN
    const result = await loadPetData();

    // THEN — x and y are preserved from the legacy entry
    expect(result[0].x).toBe(310.0079999999654);
    expect(result[0].y).toBe(940);
  });

  it('defaults hidden to false when absent from the legacy entry', async () => {
    /**
     * Verifies that a legacy entry without a `hidden` field (it was an
     * optional field in 1.0.4, absent when false) migrates to a visible
     * pet, matching the new-shape roster's existing "absent means false"
     * convention.
     *
     * If violated, migrated pets could be miscategorized as hidden (or the
     * field could be `undefined` instead of a clean boolean), breaking
     * popup visibility toggling for upgraded users.
     */
    // GIVEN — legacy entry with no hidden field
    mockStorage['pixel-pets-v1'] = legacyFixture;

    // WHEN
    const result = await loadPetData();

    // THEN — not marked hidden
    expect(result[0].hidden).toBeUndefined();
  });

  it('leaves already-new-shape roster data untouched', async () => {
    /**
     * Verifies the legacy-array branch does not fire for roster data that
     * is already in the current {roster: [...]} shape — only a bare array
     * should trigger migration.
     *
     * If violated, a post-migration user (or a user who never had legacy
     * data) could have their normal roster misread on every load.
     */
    // GIVEN — current-shape roster, not an array
    mockStorage['pixel-pets-v1'] = {
      roster: [{ id: 'new', name: 'NewPet', type: 'dog', color: 'brown' }],
    };
    mockStorage['pixel-pets-positions-v1'] = { new: { x: 42, y: 7 } };

    // WHEN
    const result = await loadPetData();

    // THEN — read via the normal new-shape path (positions merged in)
    expect(result).toEqual([{ id: 'new', name: 'NewPet', type: 'dog', color: 'brown', x: 42, y: 7 }]);
  });

  it('degrades a malformed legacy array to an empty roster without throwing', async () => {
    /**
     * Verifies that a legacy value which is an array but whose entries are
     * not recognizable pets (missing required identity fields, or not
     * objects at all) is treated as corrupt and produces [] rather than
     * throwing or fabricating garbled PetData.
     *
     * If violated, a corrupt legacy value would crash loadPetData, which
     * propagates into content.ts init() and breaks pet rendering for every
     * user, not just the one with bad data — strictly worse than the bug
     * this migration fixes.
     */
    // GIVEN — an array of junk, not valid legacy roster entries
    mockStorage['pixel-pets-v1'] = [null, 'not-a-pet', { onlyName: 'nope' }, 42];

    // WHEN
    const result = await loadPetData();

    // THEN — safe empty fallback, no throw
    expect(result).toEqual([]);
  });

  it('persists the migrated roster so a second load takes the new-shape path unchanged', async () => {
    /**
     * Verifies the migration is a one-time, idempotent upgrade: after the
     * first load rewrites pixel-pets-v1 into the new {roster: [...]} shape
     * (and positions into pixel-pets-positions-v1), a second load must
     * return the identical roster via the normal new-shape path, not
     * re-enter the legacy branch.
     *
     * If violated, either the upgrade is never persisted (silently
     * re-migrating — and re-writing storage — on every single load), or
     * the second load diverges from the first (e.g. loses x), which would
     * make the pets visibly jump after the very next page refresh.
     */
    // GIVEN — legacy flat-array storage
    mockStorage['pixel-pets-v1'] = legacyFixture;

    // WHEN — load twice, simulating two page loads across the upgrade
    const firstLoad = await loadPetData();
    const secondLoad = await loadPetData();

    // THEN — both loads produce the identical roster
    expect(secondLoad).toEqual(firstLoad);
    // AND — storage now holds the new shape, not the legacy array
    expect(Array.isArray(mockStorage['pixel-pets-v1'])).toBe(false);
    expect(mockStorage['pixel-pets-v1']).toMatchObject({
      roster: [expect.objectContaining({ id: '409ab74c-3300-4840-8e30-1da87baa5c0c' })],
    });
  });

  it('still returns the migrated pets for this session when persisting the upgrade fails', async () => {
    /**
     * Verifies that a storage-write failure during migration (e.g. quota
     * exceeded, or the extension context invalidating mid-write) does not
     * prevent the migrated pets from being returned for the current
     * session — only the persistence of the upgrade is allowed to fail.
     *
     * This is the load-bearing data-safety branch for this bead: if a
     * regression made a persistence failure fall through to the outer
     * catch instead, loadPetData would return [], and content.ts would
     * read that as "no pets" and spawn a default pet over the user's real
     * roster — the exact wipe this migration exists to prevent.
     */
    // GIVEN — legacy flat-array storage, and the persistence write fails
    mockStorage['pixel-pets-v1'] = legacyFixture;
    chromeStorageMock.local.set.mockRejectedValueOnce(new Error('quota exceeded'));

    // WHEN
    const result = await loadPetData();

    // THEN — the migrated pet is still returned for this session
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: '409ab74c-3300-4840-8e30-1da87baa5c0c',
      name: 'Rex',
      type: 'dog',
      color: 'brown',
      x: 310.0079999999654,
      y: 940,
    });
  });

  it('leaves the legacy array in storage unchanged when some entries are filtered out as corrupt', async () => {
    /**
     * Verifies that when the legacy array contains a mix of valid and
     * unrecognizable entries, the filtered (lossy) result is never
     * persisted over the only copy of the legacy data — storage must
     * still hold the original, unfiltered legacy array afterward.
     *
     * The legacy array is the sole record of the dropped entries. If a
     * filtered roster were written back to ROSTER_KEY, that write would
     * both look like a successful upgrade and permanently destroy the
     * entries that failed to parse, with no way to recover them later.
     *
     * If violated, the filtered entries are gone forever the moment this
     * function runs, even though the bead only asked the migration to
     * degrade (drop them for this session), never to persist the loss.
     */
    // GIVEN — one valid legacy entry and one unrecognizable entry
    const partiallyCorrupt = [legacyFixture[0], { id: 'b', name: 'Blue', type: 'fox', x: 30, y: 40 }];
    mockStorage['pixel-pets-v1'] = partiallyCorrupt;

    // WHEN
    const result = await loadPetData();

    // THEN — the valid pet is still returned this session
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('409ab74c-3300-4840-8e30-1da87baa5c0c');
    // AND — storage was left untouched, still the original legacy array
    expect(mockStorage['pixel-pets-v1']).toBe(partiallyCorrupt);
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
// shouldSpawnDefault — pure decision helper (pets-b8n.2)
// ---------------------------------------------------------------------------

describe('shouldSpawnDefault — tells first-install apart from remove-all', () => {
  it('spawns the default pet on a genuine first install (empty roster, never initialized)', () => {
    /**
     * Verifies that an empty roster with no initialized flag is treated as
     * a first install, so the welcome pet is minted.
     *
     * This is the baseline "new user" case the whole flag design exists to
     * preserve — the fix for the respawn bug must not break onboarding.
     *
     * If violated, brand-new installs would show an empty scene with no
     * pet and no way to discover the extension works.
     */
    // GIVEN / WHEN / THEN — pure function, no setup needed
    expect(shouldSpawnDefault(0, false)).toBe(true);
  });

  it('does not spawn the default pet when the roster is empty but already initialized', () => {
    /**
     * Verifies that an empty roster with the initialized flag set is NOT
     * treated as a first install — this is a user who deleted their last
     * pet on purpose.
     *
     * This is the core bug fix: previously an empty roster always meant
     * "spawn Rex," resurrecting a pet the user chose to remove.
     *
     * If violated, deleting the last pet and reloading the page brings
     * back a default dog the user never asked for.
     */
    expect(shouldSpawnDefault(0, true)).toBe(false);
  });

  it('does not spawn the default pet when the roster already has pets and is not initialized', () => {
    /**
     * Verifies that a non-empty roster never triggers a spawn, regardless
     * of the initialized flag's value — there is never a reason to add a
     * default pet on top of an existing roster.
     *
     * If violated, users with pets could see an unwanted extra "Rex"
     * appended alongside their real roster.
     */
    expect(shouldSpawnDefault(2, false)).toBe(false);
  });

  it('does not spawn the default pet when the roster already has pets and is initialized', () => {
    /**
     * Verifies the steady-state case: an established user with pets and
     * the flag already set never spawns a default pet.
     *
     * If violated, every normal page load for an existing user would risk
     * minting an unwanted extra pet.
     */
    expect(shouldSpawnDefault(2, true)).toBe(false);
  });
});

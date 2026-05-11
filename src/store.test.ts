// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { savePets, loadPetData } from './store';
import type { PetData } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PetData fixture */
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

/** Stub object that satisfies the { toData(): PetData } constraint. */
function makePetStub(data: PetData): { toData(): PetData } {
  return { toData: () => data };
}

// Clear localStorage before each test so tests are independent
beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// loadPetData — empty / missing key
// ---------------------------------------------------------------------------

describe('loadPetData — empty storage', () => {
  it('returns empty array when localStorage key is absent', () => {
    /**
     * Verifies that loadPetData() returns [] when no key has been written yet.
     *
     * This matters because on first launch there is no saved data. A crash or
     * exception here would prevent the app from starting.
     *
     * If violated, new users see an error on first load instead of an empty
     * pet list.
     */
    // GIVEN — empty localStorage (cleared in beforeEach)

    // WHEN — load without prior save
    const result = loadPetData();

    // THEN — empty array, not null or undefined
    expect(result).toEqual([]);
  });

  it('returns empty array when stored value is not valid JSON', () => {
    /**
     * Verifies that loadPetData() returns [] rather than throwing when
     * the stored value is corrupted or non-JSON.
     *
     * This matters because localStorage values can be corrupted by third-party
     * extensions, manual edits, or truncated writes. A crash here would
     * permanently brick the app for affected users.
     *
     * If violated, a corrupted key causes an unhandled exception and the app
     * never renders.
     */
    // GIVEN — a corrupted value under the storage key
    localStorage.setItem('pixel-pets-v1', '{not valid json}}}');

    // WHEN — load with corrupted data
    const result = loadPetData();

    // THEN — graceful fallback to empty array
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// savePets / loadPetData — round-trip
// ---------------------------------------------------------------------------

describe('savePets + loadPetData — round-trip', () => {
  it('saves and restores a single pet', () => {
    /**
     * Verifies the basic round-trip: after savePets() writes pet data, a
     * subsequent loadPetData() returns an array containing that data.
     *
     * This is the core persistence contract — without it, pets are lost on
     * every page reload.
     *
     * If violated, pets do not survive reloads, which is the entire point of
     * this feature.
     */
    // GIVEN — a single pet stub
    const data = makePetData({ id: 'abc', name: 'Buddy', x: 200, y: 350 });
    const stub = makePetStub(data);

    // WHEN — save then load
    savePets([stub]);
    const result = loadPetData();

    // THEN — loaded array matches saved data
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(data);
  });

  it('saves and restores multiple pets preserving order', () => {
    /**
     * Verifies that multiple pets are serialized and deserialized in the
     * correct order.
     *
     * This matters because pets are rendered in array order; swapping order
     * on reload would cause pets to "swap" their identities visually even
     * though their data is technically present.
     *
     * If violated, pets may appear in a different order after a reload.
     */
    // GIVEN — two pets with distinct ids and positions
    const data1 = makePetData({ id: 'p1', name: 'Rex', x: 100 });
    const data2 = makePetData({ id: 'p2', name: 'Kitsune', type: 'fox', color: 'red', x: 400 });
    const stubs = [makePetStub(data1), makePetStub(data2)];

    // WHEN — save then load
    savePets(stubs);
    const result = loadPetData();

    // THEN — both pets restored in insertion order
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(data1);
    expect(result[1]).toEqual(data2);
  });

  it('overwrites previously saved pets on a second save', () => {
    /**
     * Verifies that calling savePets() a second time replaces the previous
     * saved state, not appends to it.
     *
     * This matters because pet transitions trigger saves on every FSM state
     * change. If each save appended instead of replacing, the stored list
     * would grow unboundedly and reload would produce dozens of duplicates.
     *
     * If violated, every reload produces more pets than the user created.
     */
    // GIVEN — first save with one pet
    const data1 = makePetData({ id: 'p1', name: 'First' });
    savePets([makePetStub(data1)]);

    // WHEN — second save with different pets
    const data2 = makePetData({ id: 'p2', name: 'Second' });
    savePets([makePetStub(data2)]);
    const result = loadPetData();

    // THEN — only the second save is present
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p2');
  });

  it('saves an empty array when called with no pets', () => {
    /**
     * Verifies that savePets([]) writes an empty array (not a no-op) so that
     * a subsequent load correctly reflects "no pets" rather than stale data.
     *
     * This matters because deleting all pets (future UI feature) should result
     * in an empty state on next load, not the previously saved pets.
     *
     * If violated, deleted pets reappear after a page reload.
     */
    // GIVEN — pre-existing saved pet
    savePets([makePetStub(makePetData())]);

    // WHEN — save empty array
    savePets([]);
    const result = loadPetData();

    // THEN — loaded result is empty
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadPetData — storage key contract
// ---------------------------------------------------------------------------

describe('loadPetData — storage key', () => {
  it('reads from the correct localStorage key pixel-pets-v1', () => {
    /**
     * Verifies that loadPetData() reads specifically from the 'pixel-pets-v1'
     * key, not from any other key.
     *
     * This matters because the key is a versioned contract. If the key name
     * drifts in the implementation, data written under one key is never read
     * back, silently breaking persistence without an error.
     *
     * If violated, all saved pets are invisible to loadPetData() even though
     * they are present in localStorage under a different key.
     */
    // GIVEN — data written under the expected key manually
    const data = makePetData({ id: 'manual', name: 'ManualPet' });
    localStorage.setItem('pixel-pets-v1', JSON.stringify([data]));

    // WHEN — load via the store function
    const result = loadPetData();

    // THEN — the manually written pet is returned
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('manual');
  });
});

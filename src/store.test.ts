import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savePets, loadPetData } from './store';
import type { PetData } from './types';

// ---------------------------------------------------------------------------
// Mock chrome.storage.local
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
// loadPetData — empty / missing key
// ---------------------------------------------------------------------------

describe('loadPetData — empty storage', () => {
  it('returns empty array when storage key is absent', async () => {
    const result = await loadPetData();
    expect(result).toEqual([]);
  });

  it('returns empty array when stored value is not an array', async () => {
    mockStorage['pixel-pets-v1'] = { id: 'oops' };
    const result = await loadPetData();
    expect(result).toEqual([]);
  });

  it('returns empty array when chrome.storage.local.get throws', async () => {
    chromeStorageMock.local.get.mockRejectedValueOnce(new Error('quota exceeded'));
    const result = await loadPetData();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// savePets / loadPetData — round-trip
// ---------------------------------------------------------------------------

describe('savePets + loadPetData — round-trip', () => {
  it('saves and restores a single pet', async () => {
    const data = makePetData({ id: 'abc', name: 'Buddy', x: 200, y: 350 });

    await savePets([data]);
    const result = await loadPetData();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(data);
  });

  it('saves and restores multiple pets preserving order', async () => {
    const data1 = makePetData({ id: 'p1', name: 'Rex', x: 100 });
    const data2 = makePetData({ id: 'p2', name: 'Kitsune', type: 'fox', color: 'red', x: 400 });

    await savePets([data1, data2]);
    const result = await loadPetData();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(data1);
    expect(result[1]).toEqual(data2);
  });

  it('overwrites previously saved pets on a second save', async () => {
    const data1 = makePetData({ id: 'p1', name: 'First' });
    await savePets([data1]);

    const data2 = makePetData({ id: 'p2', name: 'Second' });
    await savePets([data2]);
    const result = await loadPetData();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p2');
  });

  it('saves an empty array when called with no pets', async () => {
    await savePets([makePetData()]);
    await savePets([]);
    const result = await loadPetData();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadPetData — storage key contract
// ---------------------------------------------------------------------------

describe('loadPetData — storage key', () => {
  it('reads from the correct key pixel-pets-v1', async () => {
    mockStorage['pixel-pets-v1'] = [makePetData({ id: 'manual', name: 'ManualPet' })];
    const result = await loadPetData();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('manual');
  });

  it('calls chrome.storage.local.get with correct key', async () => {
    await loadPetData();
    expect(chromeStorageMock.local.get).toHaveBeenCalledWith('pixel-pets-v1');
  });
});

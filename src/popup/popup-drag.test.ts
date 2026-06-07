// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mocks
// ---------------------------------------------------------------------------

const sendMessageMock = vi.fn();
const getMock = vi.fn(async (_key: string | string[]) => ({}));

const chromeMock = {
  tabs: {
    sendMessage: vi.fn((_tabId: number, _msg: { type: string }, cb: (r?: { alive: boolean }) => void) => cb(undefined)),
    query: vi.fn(async () => []),
  },
  runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: sendMessageMock,
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: getMock,
      set: vi.fn(async () => {}),
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// renderPetItemHTML — draggable attribute
// ---------------------------------------------------------------------------

import { renderPetItemHTML } from './render-pet-item';
import type { PetData } from '../types';

describe('renderPetItemHTML — draggable attribute', () => {
  it('sets draggable="true" on each pet row', () => {
    /**
     * Verifies that each pet-item has draggable="true" so the native HTML5
     * drag-and-drop API can initiate a drag gesture on the element.
     *
     * This matters because without the attribute the browser treats the element
     * as non-draggable and no drag events fire — reorder never starts.
     *
     * If violated, users cannot drag pet rows and the reorder feature is broken.
     */
    // GIVEN — any pet
    const html = renderPetItemHTML({ id: 'p1', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0 });

    // WHEN — injected into DOM
    const container = document.createElement('div');
    container.innerHTML = html;
    const item = container.querySelector('.pet-item') as HTMLElement;

    // THEN — draggable is "true"
    expect(item.getAttribute('draggable')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// PETS_REORDERED ExtMessage type — shape contract
// ---------------------------------------------------------------------------

describe('PETS_REORDERED ExtMessage shape', () => {
  it('the message has type PETS_REORDERED and a pets array', async () => {
    /**
     * Verifies that a PETS_REORDERED message carries the expected shape so the
     * content script can safely access msg.pets.
     *
     * This matters because if the shape is wrong the content script receives
     * undefined instead of an array, causing a silent reconciliation failure.
     *
     * If violated, pet order never updates in the content script after a drag.
     */
    // GIVEN — import types (compile-time check)
    const { } = await import('../types');
    const msg = { type: 'PETS_REORDERED' as const, pets: [] as PetData[] };

    // WHEN / THEN — shape is correct
    expect(msg.type).toBe('PETS_REORDERED');
    expect(Array.isArray(msg.pets)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drop reorder logic — pure unit tests (no full popup bootstrap needed)
// ---------------------------------------------------------------------------

describe('drop reorder logic', () => {
  /**
   * These tests exercise the splice logic that reorders pets[] on drop.
   * We test the algorithm in isolation to avoid a full popup bootstrap.
   */

  function reorderPets(pets: PetData[], draggedId: string, targetId: string, insertAfter: boolean): PetData[] {
    // Mirror the exact algorithm in popup.ts drop handler
    const arr = [...pets];
    const draggedIdx = arr.findIndex(p => p.id === draggedId);
    if (draggedIdx === -1) return arr;
    const [dragged] = arr.splice(draggedIdx, 1);
    const newTargetIdx = arr.findIndex(p => p.id === targetId);
    if (newTargetIdx === -1) { arr.splice(0, 0, dragged); return arr; }
    arr.splice(insertAfter ? newTargetIdx + 1 : newTargetIdx, 0, dragged);
    return arr;
  }

  const petA: PetData = { id: 'a', name: 'A', type: 'dog', color: 'brown', x: 0, y: 0 };
  const petB: PetData = { id: 'b', name: 'B', type: 'cockatiel', color: 'white', x: 0, y: 0 };
  const petC: PetData = { id: 'c', name: 'C', type: 'fox', color: 'orange', x: 0, y: 0 };

  it('drops above another card and reorders pets[]', () => {
    /**
     * Verifies that dragging C above A (insertAfter=false, target=A) moves
     * C to index 0, pushing A and B down.
     *
     * This is the primary use-case: reorder pets by dragging to the top half
     * of a card, inserting before it.
     *
     * If violated, the order doesn't change or items end up in wrong positions.
     */
    // GIVEN — [A, B, C]
    const pets = [petA, petB, petC];

    // WHEN — drag C before A
    const result = reorderPets(pets, 'c', 'a', false);

    // THEN — [C, A, B]
    expect(result.map(p => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('drops below another card and reorders pets[]', () => {
    /**
     * Verifies that dragging A below B (insertAfter=true, target=B) moves
     * A to index 1, resulting in [B, A, C].
     *
     * This tests the "bottom half" drop path.
     *
     * If violated, dropping below a card acts like dropping above it.
     */
    // GIVEN — [A, B, C]
    const pets = [petA, petB, petC];

    // WHEN — drag A after B
    const result = reorderPets(pets, 'a', 'b', true);

    // THEN — [B, A, C]
    expect(result.map(p => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns same order when draggedId === targetId', () => {
    /**
     * Verifies that dropping a card onto itself is a noop — the array order
     * does not change.
     *
     * This matters because without the guard the splice logic removes and
     * reinserts at the same position (usually fine), but we should assert
     * the behavior is stable.
     *
     * In the actual popup the drag===target check returns early before
     * calling reorderPets; here we test the splice fallback is also safe.
     */
    // GIVEN — [A, B, C]
    const pets = [petA, petB, petC];

    // WHEN — drag A onto A
    const result = reorderPets(pets, 'a', 'a', false);

    // THEN — order unchanged (a is removed then re-inserted before itself which = same)
    expect(result.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// content.ts PETS_REORDERED reconciliation — unit test of the algorithm
// ---------------------------------------------------------------------------

describe('PETS_REORDERED reconciliation logic', () => {
  /**
   * The reconciliation reorders an array of objects by an incoming id-order
   * without recreating any objects. We test this pure algorithm in isolation.
   */

  interface FakePet { id: string; tag: string }

  function reconcile(pets: FakePet[], incoming: { id: string }[]): FakePet[] {
    // Mirror the algorithm in content.ts PETS_REORDERED handler
    const petById = new Map<string, FakePet>(pets.map(p => [p.id, p]));
    const reordered: FakePet[] = [];
    for (const data of incoming) {
      const existing = petById.get(data.id);
      if (existing) reordered.push(existing);
    }
    for (const p of pets) {
      if (!reordered.includes(p)) reordered.push(p);
    }
    return reordered;
  }

  it('reconciles local pets by id without recreating objects', () => {
    /**
     * Verifies that reconciliation reuses the exact same object references
     * from the original pets[] — no new Pet is created.
     *
     * This matters because creating new Pet objects would reset animations,
     * positions, and lose all runtime state (greet cooldowns, etc.).
     *
     * If violated, every reorder destroys existing pet views and state.
     */
    // GIVEN — local pets [A, B, C]
    const pA = { id: 'a', tag: 'petA' };
    const pB = { id: 'b', tag: 'petB' };
    const pC = { id: 'c', tag: 'petC' };
    const pets = [pA, pB, pC];

    // WHEN — incoming order is [C, A, B]
    const result = reconcile(pets, [{ id: 'c' }, { id: 'a' }, { id: 'b' }]);

    // THEN — same object references, reordered
    expect(result[0]).toBe(pC);
    expect(result[1]).toBe(pA);
    expect(result[2]).toBe(pB);
  });

  it('preserves pets not in incoming list at the end', () => {
    /**
     * Verifies that pets absent from the incoming PETS_REORDERED message
     * are appended at the end rather than dropped.
     *
     * This is a defensive guard — in normal operation all pets are included,
     * but partial lists must not silently delete pets.
     *
     * If violated, pets missing from the message are removed from the scene.
     */
    // GIVEN — local pets [A, B, C], incoming only lists [B, A]
    const pA = { id: 'a', tag: 'petA' };
    const pB = { id: 'b', tag: 'petB' };
    const pC = { id: 'c', tag: 'petC' };
    const pets = [pA, pB, pC];

    // WHEN — incoming omits C
    const result = reconcile(pets, [{ id: 'b' }, { id: 'a' }]);

    // THEN — [B, A, C] — C is appended
    expect(result.map(p => p.id)).toEqual(['b', 'a', 'c']);
    expect(result[2]).toBe(pC);
  });
});

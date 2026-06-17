/**
 * Tests for reconcileRoster — the cross-tab sync handler that runs in content.ts
 * when another tab writes to the pixel-pets-v1 roster key.
 *
 * reconcileRoster is exported from content-reconcile.ts (a pure helper module
 * extracted from content.ts) so it can be unit tested without the full
 * content script environment (Shadow DOM, requestAnimationFrame, etc.).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RosterEntry } from './store';

// ---------------------------------------------------------------------------
// Minimal Pet-like class for testing (mirrors Pet's interface)
// ---------------------------------------------------------------------------

class FakePet {
  id: string;
  name: string;
  type: string;
  color: string;
  hidden: boolean;
  x: number;
  y: number;
  state: string;

  constructor(data: { id: string; name: string; type: string; color: string; hidden?: boolean; x?: number; y?: number }) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.color = data.color;
    this.hidden = data.hidden ?? false;
    this.x = data.x ?? 0;
    this.y = data.y ?? 0;
    this.state = 'sitIdle';
  }

  toData() {
    return { id: this.id, name: this.name, type: this.type as import('./types').PetType, color: this.color, hidden: this.hidden, x: this.x, y: this.y };
  }
}

// ---------------------------------------------------------------------------
// Mock dependencies for reconcileRoster
// REVIEW: mocking core dependencies — createPetView/removePetView/addPetToScene
// are DOM-mutation functions that require a live browser context. They cannot
// be exercised in jsdom without the full Shadow DOM setup from content.ts.
// The integration-level behavior (pets appear/disappear on page) is validated
// by manual QA; these tests cover the data-layer reconciliation logic.
// ---------------------------------------------------------------------------

const mockAddPetToScene = vi.fn();
const mockRemovePetView = vi.fn();
const mockClearGreetCooldownsForPet = vi.fn();
const mockMakePet = vi.fn((data: RosterEntry & { x: number; y: number }) => new FakePet(data));
const mockViews = new Map<FakePet, unknown>();

// We'll import reconcileRoster from content-reconcile.ts
import { reconcileRoster } from './content-reconcile';

// ---------------------------------------------------------------------------
// State shared between tests
// ---------------------------------------------------------------------------

let pets: FakePet[];

beforeEach(() => {
  vi.clearAllMocks();
  mockViews.clear();
  pets = [];
  mockMakePet.mockImplementation((data: RosterEntry & { x: number; y: number }) => new FakePet(data));
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<ConstructorParameters<typeof FakePet>[0]> = {}): FakePet {
  return new FakePet({ id: 'p1', name: 'Rex', type: 'dog', color: 'brown', ...overrides });
}

function makeEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return { id: 'p1', name: 'Rex', type: 'dog', color: 'brown', ...overrides };
}

// ---------------------------------------------------------------------------
// reconcileRoster — add new pet
// ---------------------------------------------------------------------------

describe('reconcileRoster — add new pet from another tab', () => {
  it('creates and adds a new pet to scene when it is absent locally', () => {
    /**
     * Verifies that reconcileRoster calls makePet + addPetToScene when the
     * incoming roster contains a pet id that is not in the local pets array.
     *
     * This is the core cross-tab add flow: when the user adds a pet in the
     * popup on Tab A, Tab B's content script must receive the roster change
     * and add the pet to its scene.
     *
     * If violated, pets added in one tab never appear in other tabs.
     */
    // GIVEN — empty local scene
    pets = [];
    const newEntry: RosterEntry = makeEntry({ id: 'new-pet', name: 'Buddy' });

    // WHEN — roster arrives with the new pet
    reconcileRoster([newEntry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — pet was created and added to scene
    expect(mockMakePet).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-pet' }));
    expect(mockAddPetToScene).toHaveBeenCalledTimes(1);
    expect(pets).toHaveLength(1);
    expect(pets[0].id).toBe('new-pet');
  });

  it('does NOT add a hidden new pet to scene but still adds it to pets[]', () => {
    /**
     * Verifies that a hidden pet arriving via cross-tab sync is tracked in
     * pets[] but not rendered via addPetToScene, matching the existing
     * hidden-pet behavior in init().
     *
     * If violated, hidden pets from other tabs appear visible on this tab.
     */
    // GIVEN — empty local scene
    pets = [];
    const hiddenEntry: RosterEntry = makeEntry({ id: 'hidden', hidden: true });
    mockMakePet.mockReturnValueOnce(new FakePet({ id: 'hidden', name: 'Rex', type: 'dog', color: 'brown', hidden: true }));

    // WHEN
    reconcileRoster([hiddenEntry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — in pets[] but not in scene
    expect(pets).toHaveLength(1);
    expect(mockAddPetToScene).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reconcileRoster — remove pet
// ---------------------------------------------------------------------------

describe('reconcileRoster — remove pet from another tab', () => {
  it('removes a pet from pets[] and scene when it is absent from new roster', () => {
    /**
     * Verifies reconcileRoster removes a local pet when it is missing from
     * the incoming roster. This handles the cross-tab delete flow: user
     * removes a pet in Tab A, Tab B must remove it from its scene.
     *
     * If violated, deleted pets remain visible in other tabs until reload.
     */
    // GIVEN — one local pet
    const pet = makePet({ id: 'to-remove' });
    const view = {};
    pets = [pet];
    (mockViews as Map<FakePet, unknown>).set(pet, view);

    // WHEN — roster arrives without the pet
    reconcileRoster([], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — pet removed from scene and pets[]
    expect(mockRemovePetView).toHaveBeenCalledWith(view);
    expect(mockClearGreetCooldownsForPet).toHaveBeenCalledWith('to-remove', pet);
    expect(pets).toHaveLength(0);
  });

  it('calls clearGreetCooldownsForPet on removal', () => {
    /**
     * Verifies that greet cooldowns are cleaned up on cross-tab removal,
     * preventing dangling cooldown entries for a pet that no longer exists.
     *
     * If violated, re-added pets with the same id will have stale cooldowns
     * preventing them from greeting for up to 30 seconds.
     */
    // GIVEN — local pet with a view
    const pet = makePet({ id: 'cooldown-pet' });
    pets = [pet];
    (mockViews as Map<FakePet, unknown>).set(pet, {});

    // WHEN — roster does not include the pet
    reconcileRoster([], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — cooldowns cleared
    expect(mockClearGreetCooldownsForPet).toHaveBeenCalledWith('cooldown-pet', pet);
  });
});

// ---------------------------------------------------------------------------
// reconcileRoster — preserve position and state
// ---------------------------------------------------------------------------

describe('reconcileRoster — preserve local state for unchanged pets', () => {
  it('preserves x/y and state of a pet that exists in both local and incoming roster', () => {
    /**
     * Verifies that reconcileRoster does NOT reset position or FSM state
     * for pets that are present in both the local scene and the incoming
     * roster (i.e., unchanged pets).
     *
     * Without this, every roster change from any tab (e.g., theme save)
     * would teleport all pets back to their initial positions.
     *
     * If violated, pets jump to (0,0) or reset to sitIdle whenever any
     * other tab triggers a storage event.
     */
    // GIVEN — a pet with known position and state
    const pet = makePet({ id: 'stable', x: 300, y: 400 });
    pet.state = 'sleep';
    pets = [pet];

    const entry: RosterEntry = makeEntry({ id: 'stable', name: 'Rex' });

    // WHEN — same pet arrives in roster (name unchanged)
    reconcileRoster([entry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — position and state preserved
    expect(pet.x).toBe(300);
    expect(pet.y).toBe(400);
    expect(pet.state).toBe('sleep');
    expect(mockMakePet).not.toHaveBeenCalled();
    expect(mockAddPetToScene).not.toHaveBeenCalled();
    expect(mockRemovePetView).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reconcileRoster — type/color change → view recreation
// ---------------------------------------------------------------------------

describe('reconcileRoster — recreate view on type or color change', () => {
  it('removes and re-adds the pet view when type changes', () => {
    /**
     * Verifies reconcileRoster recreates the pet view when the type changes,
     * because the gif src depends on the pet type.
     *
     * Without this, a pet renamed to a different type in another tab would
     * continue displaying the old type's gif indefinitely.
     *
     * If violated, type changes from other tabs are silently ignored and
     * the pet still shows its old sprite.
     */
    // GIVEN — local pet with type 'dog'
    const pet = makePet({ id: 'morph', type: 'dog' });
    const view = {};
    pets = [pet];
    (mockViews as Map<FakePet, unknown>).set(pet, view);

    const entry: RosterEntry = makeEntry({ id: 'morph', type: 'fox' });

    // WHEN — roster arrives with type='fox'
    reconcileRoster([entry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — old view removed, new view added
    expect(mockRemovePetView).toHaveBeenCalledWith(view);
    expect(mockAddPetToScene).toHaveBeenCalledTimes(1);
  });

  it('removes and re-adds the pet view when color changes', () => {
    /**
     * Verifies reconcileRoster recreates the view when color changes.
     * Pet gifs are color-specific (e.g., brown_walk vs black_walk).
     *
     * If violated, color changes from other tabs don't update the sprite,
     * showing the wrong colored pet.
     */
    // GIVEN — local pet with color 'brown'
    const pet = makePet({ id: 'recolor', color: 'brown' });
    const view = {};
    pets = [pet];
    (mockViews as Map<FakePet, unknown>).set(pet, view);

    const entry: RosterEntry = makeEntry({ id: 'recolor', color: 'black' });

    // WHEN — roster arrives with color='black'
    reconcileRoster([entry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — view recreated
    expect(mockRemovePetView).toHaveBeenCalledWith(view);
    expect(mockAddPetToScene).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// reconcileRoster — hidden toggle
// ---------------------------------------------------------------------------

describe('reconcileRoster — hidden toggle', () => {
  it('removes view when pet becomes hidden via cross-tab sync', () => {
    /**
     * Verifies reconcileRoster removes the pet from the scene when the
     * incoming roster marks a previously visible pet as hidden.
     *
     * If violated, hiding a pet in Tab A's popup does not hide it in Tab B.
     */
    // GIVEN — visible pet in scene
    const pet = makePet({ id: 'hide-me', hidden: false });
    const view = {};
    pets = [pet];
    (mockViews as Map<FakePet, unknown>).set(pet, view);

    const entry: RosterEntry = makeEntry({ id: 'hide-me', hidden: true });

    // WHEN
    reconcileRoster([entry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — view removed
    expect(mockRemovePetView).toHaveBeenCalledWith(view);
    expect(mockAddPetToScene).not.toHaveBeenCalled();
    expect(pet.hidden).toBe(true);
  });

  it('adds view when pet becomes visible via cross-tab sync', () => {
    /**
     * Verifies reconcileRoster adds the pet to the scene when the incoming
     * roster marks a previously hidden pet as visible.
     *
     * If violated, showing a pet in Tab A's popup does not show it in Tab B.
     */
    // GIVEN — hidden pet not in scene
    const pet = makePet({ id: 'show-me', hidden: true });
    pets = [pet];
    // No view in map (pet is hidden)

    const entry: RosterEntry = makeEntry({ id: 'show-me', hidden: false });

    // WHEN
    reconcileRoster([entry], pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — pet shown
    expect(mockAddPetToScene).toHaveBeenCalledWith(pet);
    expect(pet.hidden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reconcileRoster — orphaned view sweep
// ---------------------------------------------------------------------------

describe('reconcileRoster — sweep orphaned views after reorder', () => {
  it('removes the view for a duplicate-id Pet object that is dropped from pets[] after reorder', () => {
    /**
     * Verifies that reconcileRoster removes any view whose key Pet object is
     * no longer present in pets[] after the step-3 reorder splice.
     *
     * This prevents "ghost" sprites: when two Pet objects share the same id
     * (e.g., created in different tabs or via a makePet call on a pre-existing
     * id), the reconcile loop keeps one in pets[] and silently drops the other.
     * Without this sweep, the dropped Pet object's DOM <img> view is never
     * cleaned up and remains frozen on screen indefinitely.
     *
     * If violated, orphaned views accumulate in `views` and their frozen
     * sprites remain visible to the user even after the duplicate pet object
     * has been evicted from pets[].
     */
    // GIVEN — two Pet objects with the same id; both have views in the map
    const petA = makePet({ id: 'dup', name: 'Alpha' });
    const petB = makePet({ id: 'dup', name: 'Beta' });
    const viewA = { el: 'viewA' };
    const viewB = { el: 'viewB' };
    // petA is the "winner" already in pets[]; petB is an orphan with a stale view
    pets = [petA];
    (mockViews as Map<FakePet, unknown>).set(petA, viewA);
    (mockViews as Map<FakePet, unknown>).set(petB, viewB);

    const roster: RosterEntry[] = [makeEntry({ id: 'dup', name: 'Alpha' })];

    // WHEN — reconcileRoster runs; petB is not in pets[] so should be swept
    reconcileRoster(roster, pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — orphaned view for petB was removed; petA's view is intact
    expect(mockRemovePetView).toHaveBeenCalledWith(viewB);
    expect(mockRemovePetView).not.toHaveBeenCalledWith(viewA);
    expect(mockViews.has(petB)).toBe(false);
    expect(pets).toHaveLength(1);
    expect(pets[0].id).toBe('dup');
  });
});

// ---------------------------------------------------------------------------
// reconcileRoster — ordering
// ---------------------------------------------------------------------------

describe('reconcileRoster — reorder pets to match roster order', () => {
  it('reorders local pets[] to match incoming roster order', () => {
    /**
     * Verifies reconcileRoster reorders pets[] to match the roster order
     * so chase-spread and greet interactions are consistent across tabs.
     *
     * If violated, drag-reorder in Tab A does not affect the pet ordering
     * in Tab B's content script, causing inconsistent greet pair selection.
     */
    // GIVEN — two pets in opposite order
    const p1 = makePet({ id: 'p1' });
    const p2 = makePet({ id: 'p2', name: 'Kitsune' });
    pets = [p2, p1]; // wrong order

    const roster: RosterEntry[] = [
      makeEntry({ id: 'p1' }),
      makeEntry({ id: 'p2', name: 'Kitsune' }),
    ];

    // WHEN
    reconcileRoster(roster, pets, mockViews as Map<unknown, unknown>, mockMakePet, mockAddPetToScene, mockRemovePetView, mockClearGreetCooldownsForPet);

    // THEN — order matches roster
    expect(pets[0].id).toBe('p1');
    expect(pets[1].id).toBe('p2');
  });
});

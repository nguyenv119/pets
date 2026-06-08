/**
 * reconcileRoster — cross-tab sync handler for content.ts
 *
 * Called when chrome.storage.onChanged fires for the pixel-pets-v1 roster key.
 * Reconciles the local pets[] and views map against the incoming roster from
 * another tab, without resetting position or FSM state of unchanged pets.
 *
 * Self-echo suppression note: content.ts never writes to the roster key
 * (all roster writes go through popup.ts or the service worker), so every
 * roster change event originates from another tab. No nonce needed.
 *
 * Extracted as a pure module so it can be unit-tested without the full
 * content script environment (Shadow DOM, requestAnimationFrame, etc.).
 */

import type { RosterEntry } from './store';

/** Minimal pet interface required by reconcileRoster — matches the real Pet class. */
export interface ReconcilablePet {
  id: string;
  hidden: boolean;
  x: number;
  y: number;
  state: string;
  toData(): { id: string; name: string; type: string; color: string; hidden?: boolean; x: number; y: number };
}

/**
 * Reconcile the local scene against an incoming roster from another tab.
 *
 * @param newRoster   Roster entries received from chrome.storage.onChanged
 * @param pets        The local pets array — MUTATED IN PLACE
 * @param views       Map from Pet → PetView — MUTATED IN PLACE
 * @param makePet     Factory: creates a new Pet from a RosterEntry (with default position)
 * @param addPetToScene  Adds pet element to the DOM
 * @param removePetView  Removes pet element from the DOM and clears its view
 * @param clearGreetCooldownsForPet  Cleans up greet cooldowns on pet removal
 */
export function reconcileRoster(
  newRoster: RosterEntry[],
  pets: ReconcilablePet[],
  views: Map<unknown, unknown>,
  makePet: (data: RosterEntry & { x: number; y: number }) => ReconcilablePet,
  addPetToScene: (pet: ReconcilablePet) => void,
  removePetView: (view: unknown) => void,
  clearGreetCooldownsForPet: (id: string, pet: ReconcilablePet) => void,
): void {
  const rosterById = new Map(newRoster.map(e => [e.id, e]));
  const localById = new Map(pets.map(p => [p.id, p]));

  // 1. Remove pets that are no longer in the roster
  for (const pet of [...pets]) {
    if (!rosterById.has(pet.id)) {
      const view = views.get(pet);
      if (view !== undefined) {
        removePetView(view);
        views.delete(pet);
      }
      clearGreetCooldownsForPet(pet.id, pet);
      const idx = pets.indexOf(pet);
      if (idx !== -1) pets.splice(idx, 1);
    }
  }

  // 2. Update or add pets from the incoming roster
  for (const entry of newRoster) {
    const existing = localById.get(entry.id);
    if (existing) {
      // Use toData() to read current type/color since they may be private fields
      const currentData = existing.toData();
      // Check if type or color changed — requires view recreation
      const typeChanged = currentData.type !== entry.type;
      const colorChanged = currentData.color !== entry.color;
      const hiddenChanged = existing.hidden !== (entry.hidden ?? false);

      if (typeChanged || colorChanged) {
        // Recreate view; preserve position and state
        const view = views.get(existing);
        if (view !== undefined) {
          removePetView(view);
          views.delete(existing);
        }
        // Update the pet's type/color/name fields
        (existing as unknown as Record<string, unknown>)['name'] = entry.name;
        (existing as unknown as Record<string, unknown>)['_type'] = entry.type;
        (existing as unknown as Record<string, unknown>)['_color'] = entry.color;
        (existing as unknown as Record<string, unknown>)['_name'] = entry.name;
        existing.hidden = entry.hidden ?? false;
        if (!existing.hidden) addPetToScene(existing);
      } else if (hiddenChanged) {
        // Toggle visibility only
        existing.hidden = entry.hidden ?? false;
        if (existing.hidden) {
          const view = views.get(existing);
          if (view !== undefined) {
            removePetView(view);
            views.delete(existing);
          }
        } else {
          if (!views.has(existing)) addPetToScene(existing);
        }
      } else {
        // Name change or no change — update name, nothing visual to do
        (existing as unknown as Record<string, unknown>)['_name'] = entry.name;
        (existing as unknown as Record<string, unknown>)['name'] = entry.name;
      }
    } else {
      // New pet — create with default position and add to scene
      const newPet = makePet({ ...entry, x: 0, y: 0 });
      pets.push(newPet);
      if (!newPet.hidden) addPetToScene(newPet);
    }
  }

  // 3. Reorder pets[] to match roster order (for chase-spread consistency)
  const petById = new Map(pets.map(p => [p.id, p]));
  const reordered: ReconcilablePet[] = [];
  for (const entry of newRoster) {
    const p = petById.get(entry.id);
    if (p) reordered.push(p);
  }
  // Replace contents in place
  pets.splice(0, pets.length, ...reordered);
}

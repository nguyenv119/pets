import type { PetData, PetType } from './types';

export const ROSTER_KEY = 'pixel-pets-v1';
export const POSITIONS_KEY = 'pixel-pets-positions-v1';

/**
 * Roster entry — identity fields only, no positional data.
 */
export interface RosterEntry {
  id: string;
  name: string;
  type: PetType;
  color: string;
  hidden?: boolean;
}

/** Shape stored at ROSTER_KEY */
interface RosterStorage {
  roster: RosterEntry[];
}

/** Save pets to the roster key (strips x, y). */
export async function savePets(pets: PetData[]): Promise<void> {
  const roster: RosterEntry[] = pets.map(({ id, name, type, color, hidden }) => {
    const entry: RosterEntry = { id, name, type, color };
    if (hidden) entry.hidden = true;
    return entry;
  });
  await chrome.storage.local.set({ [ROSTER_KEY]: { roster } });
}

/**
 * Save positions to the positions key.
 * Called by content.ts debouncedSave.
 */
export async function savePositions(positions: Record<string, { x: number; y: number }>): Promise<void> {
  await chrome.storage.local.set({ [POSITIONS_KEY]: positions });
}

/**
 * Boot path: reads BOTH keys and merges them into full PetData[].
 * Returns [] on empty/missing/legacy storage so content.ts can add the default pet.
 */
export async function loadPetData(): Promise<PetData[]> {
  try {
    const result = await chrome.storage.local.get([ROSTER_KEY, POSITIONS_KEY]);
    const rosterData = result[ROSTER_KEY] as RosterStorage | undefined;
    const positions = (result[POSITIONS_KEY] ?? {}) as Record<string, { x: number; y: number }>;

    // If not new-shape roster, return empty (legacy flat-array or missing)
    if (!rosterData || typeof rosterData !== 'object' || !Array.isArray(rosterData.roster)) {
      return [];
    }

    return rosterData.roster.map((entry): PetData => {
      const pos = positions[entry.id] ?? { x: 0, y: 0 };
      return {
        id: entry.id,
        name: entry.name,
        type: entry.type,
        color: entry.color,
        x: pos.x,
        y: pos.y,
        ...(entry.hidden ? { hidden: true } : {}),
      };
    });
  } catch {
    return [];
  }
}

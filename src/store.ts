import type { PetData, PetType } from './types';

const ROSTER_KEY = 'pixel-pets-v1';
const POSITIONS_KEY = 'pixel-pets-positions-v1';

/**
 * Roster entry — identity fields only, no positional data.
 * Written to ROSTER_KEY so cross-tab listeners watch a stable key
 * that does NOT change on every position update.
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

/** Save pets to the roster key (strips x, y). Cross-tab listeners watch this key. */
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
 * Called by content.ts debouncedSave — does NOT trigger the cross-tab roster listener.
 */
export async function savePositions(positions: Record<string, { x: number; y: number }>): Promise<void> {
  await chrome.storage.local.set({ [POSITIONS_KEY]: positions });
}

/**
 * Load the roster only (no position data).
 * Used by cross-tab listeners in content.ts and popup.ts to get the current pet list.
 */
export async function loadRoster(): Promise<{ roster: RosterEntry[] }> {
  try {
    const result = await chrome.storage.local.get(ROSTER_KEY);
    const data = result[ROSTER_KEY] as RosterStorage | undefined;
    if (data && typeof data === 'object' && Array.isArray(data.roster)) {
      return { roster: data.roster };
    }
    return { roster: [] };
  } catch {
    return { roster: [] };
  }
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

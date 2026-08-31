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
 * Shape guard for a published-1.0.4 legacy roster entry: a bare object with
 * x/y inline (no separate positions key existed yet). Only the fields we
 * need to reconstruct a PetData are required; anything else on the object
 * is ignored. Used to filter out corrupt entries instead of throwing.
 */
function isLegacyRosterEntry(
  value: unknown
): value is { id: string; name: string; type: string; color: string; x?: unknown; y?: unknown; hidden?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.name === 'string' && typeof e.type === 'string' && typeof e.color === 'string';
}

/**
 * Boot path: reads BOTH keys and merges them into full PetData[].
 * Returns [] on empty/missing storage so content.ts can add the default pet.
 *
 * Also migrates published-1.0.4 storage: that version wrote a bare array of
 * pets (x/y inline) at ROSTER_KEY, with no positions key at all. Treating
 * that shape as "not new-shape roster" (as this function used to) makes
 * every upgrading user look like a first install, spawning the default pet
 * and then overwriting their real roster. Detecting the array and migrating
 * it in place is what keeps their pets alive across the 1.0.4 -> 1.0.5 update.
 */
export async function loadPetData(): Promise<PetData[]> {
  try {
    const result = await chrome.storage.local.get([ROSTER_KEY, POSITIONS_KEY]);
    const rosterData = result[ROSTER_KEY];
    const positions = (result[POSITIONS_KEY] ?? {}) as Record<string, { x: number; y: number }>;

    if (Array.isArray(rosterData)) {
      const migrated: PetData[] = rosterData.filter(isLegacyRosterEntry).map((entry) => ({
        id: entry.id,
        name: entry.name,
        type: entry.type as PetType,
        color: entry.color,
        x: typeof entry.x === 'number' ? entry.x : 0,
        y: typeof entry.y === 'number' ? entry.y : 0,
        ...(entry.hidden ? { hidden: true } : {}),
      }));

      // Only persist the upgrade when nothing was dropped by the filter
      // above. If some legacy entries were unrecognizable and filtered
      // out, `migrated` is a lossy view of the legacy data — writing it
      // over ROSTER_KEY would permanently destroy the filtered entries
      // (the legacy array is their only copy). Leave storage untouched
      // in that case; the session still gets `migrated` below, and a
      // future build can still recover the dropped entries from the
      // legacy array on the next load.
      if (migrated.length === rosterData.length) {
        // Persist the upgrade once so this branch isn't re-entered next
        // load. Write positions BEFORE roster: savePets writes the
        // {roster:[...]} shape to ROSTER_KEY, which is exactly the
        // sentinel that tells the next load "not legacy, don't migrate."
        // Writing positions first means that if the roster write never
        // happens (quota, extension context invalidated, tab closed
        // between the two awaits), ROSTER_KEY still holds the legacy
        // array, so the next load re-enters this branch and retries the
        // identical migration. If the positions write itself fails,
        // nothing has been written at all yet.
        try {
          await savePositions(Object.fromEntries(migrated.map((p) => [p.id, { x: p.x, y: p.y }])));
          await savePets(migrated);
        } catch {
          // Persisting failed. Because positions are written first,
          // ROSTER_KEY still holds the legacy array unless both writes
          // already succeeded — so the next load re-enters this branch
          // and retries the identical migration rather than losing the
          // roster outright.
        }
      }

      return migrated;
    }

    const rosterStorage = rosterData as RosterStorage | undefined;

    // If not new-shape roster, return empty (missing/corrupt)
    if (!rosterStorage || typeof rosterStorage !== 'object' || !Array.isArray(rosterStorage.roster)) {
      return [];
    }

    return rosterStorage.roster.map((entry): PetData => {
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

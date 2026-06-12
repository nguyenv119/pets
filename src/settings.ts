export type Theme = 'light' | 'dark';

export interface Settings {
  theme: Theme;
  treats: number;
  treatsUpdatedAt: number;
  homeAnchorAt?: number | null;
}

export const SETTINGS_KEY = 'pixel-pets-settings-v1';
const KEY = SETTINGS_KEY;

export const TREAT_CAP = 10;
export const TREAT_RECHARGE_MS = 10 * 60 * 1000;

export const CAPACITY_CAP = 7;
export const CAPACITY_GROWTH_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const DEFAULTS: Settings = {
  theme: 'light',
  treats: TREAT_CAP,
  treatsUpdatedAt: 0, // will be overridden to Date.now() on first load
  homeAnchorAt: null,
};

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(KEY);
  const stored = result[KEY] as Partial<Settings> | undefined;

  if (!stored) {
    return { ...DEFAULTS, treatsUpdatedAt: Date.now() };
  }

  // Backfill missing fields with defaults (forward-compat)
  // homeAnchorAt: absent key and stored null both collapse to null (two-state result).
  // The caller (task .3) uses petCount to distinguish upgrader from fresh install.
  return {
    theme: stored.theme ?? DEFAULTS.theme,
    treats: stored.treats ?? TREAT_CAP,
    treatsUpdatedAt: stored.treatsUpdatedAt ?? Date.now(),
    homeAnchorAt: stored.homeAnchorAt ?? null,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

/**
 * Field-merge helper: re-reads the current settings immediately before writing
 * so that only the patched fields change. This minimises the read-modify-write
 * race window: a full-object saveSettings call can clobber fields written by a
 * concurrent writer between the original read and the write; re-reading late
 * ensures the latest persisted state is the merge base.
 */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await loadSettings()), ...patch };
  await saveSettings(merged);
  return merged;
}

export function currentCapacity(
  anchorAt: number | null,
  petCount: number,
  now = Date.now()
): { capacity: number; nextSlotMs: number; isFull: boolean } {
  const elapsed = anchorAt == null ? 0 : Math.max(0, now - anchorAt);
  const timeCapacity = Math.min(CAPACITY_CAP, 1 + Math.floor(elapsed / CAPACITY_GROWTH_MS));
  const capacity = Math.max(petCount, timeCapacity);
  const isFull = capacity <= petCount; // no free slot right now

  // HONEST countdown: ms until the DISPLAYED capacity number increases, i.e. until
  // timeCapacity exceeds the current capacity. This is clamp-aware: a migrated user
  // with 4 pets at day 0 (capacity 4) gets the time to slot 5 (= 4 intervals), NOT 1 interval.
  let nextSlotMs: number;
  if (capacity >= CAPACITY_CAP) {
    nextSlotMs = 0;
  } else {
    // need timeCapacity to reach capacity+1 => 1+floor(e/G) >= capacity+1 => e >= capacity*G
    const needed = capacity * CAPACITY_GROWTH_MS;
    nextSlotMs = Math.max(0, needed - elapsed);
  }

  return { capacity, nextSlotMs, isFull };
}

export function formatCapacityCountdown(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return 'next slot in ' + d + 'd ' + h + 'h';
  if (h > 0) return 'next slot in ' + h + 'h ' + m + 'm';
  return 'next slot in ' + m + 'm';
}

export function currentTreats(
  s: Settings,
  now = Date.now()
): { count: number; nextRechargeMs: number } {
  const elapsed = Math.max(0, now - s.treatsUpdatedAt);
  const recharged = Math.floor(elapsed / TREAT_RECHARGE_MS);
  const count = Math.min(TREAT_CAP, s.treats + recharged);

  const nextRechargeMs =
    count >= TREAT_CAP ? 0 : TREAT_RECHARGE_MS - (elapsed % TREAT_RECHARGE_MS);

  return { count, nextRechargeMs };
}

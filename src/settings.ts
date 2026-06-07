export type Theme = 'light' | 'dark';

export interface Settings {
  theme: Theme;
  treats: number;
  treatsUpdatedAt: number;
}

const KEY = 'pixel-pets-settings-v1';

export const TREAT_CAP = 10;
export const TREAT_RECHARGE_MS = 10 * 60 * 1000;

const DEFAULTS: Settings = {
  theme: 'light',
  treats: TREAT_CAP,
  treatsUpdatedAt: 0, // will be overridden to Date.now() on first load
};

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(KEY);
  const stored = result[KEY] as Partial<Settings> | undefined;

  if (!stored) {
    return { ...DEFAULTS, treatsUpdatedAt: Date.now() };
  }

  // Backfill missing fields with defaults (forward-compat)
  return {
    theme: stored.theme ?? DEFAULTS.theme,
    treats: stored.treats ?? TREAT_CAP,
    treatsUpdatedAt: stored.treatsUpdatedAt ?? Date.now(),
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export function currentTreats(
  s: Settings,
  now = Date.now()
): { count: number; nextRechargeMs: number } {
  const elapsed = now - s.treatsUpdatedAt;
  const recharged = Math.floor(elapsed / TREAT_RECHARGE_MS);
  const count = Math.min(TREAT_CAP, s.treats + recharged);

  const nextRechargeMs =
    count >= TREAT_CAP ? 0 : TREAT_RECHARGE_MS - (elapsed % TREAT_RECHARGE_MS);

  return { count, nextRechargeMs };
}

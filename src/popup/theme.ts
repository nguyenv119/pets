import type { Theme } from '../settings';
import { loadSettings, updateSettings } from '../settings';

/**
 * Applies a theme to document.body by setting the data-theme attribute.
 * CSS uses [data-theme="dark"] to activate dark-mode custom properties.
 */
export function applyTheme(theme: Theme): void {
  document.body.dataset.theme = theme;
}

/**
 * Reads the persisted theme from settings storage.
 * Returns 'light' as the default if no settings are stored.
 */
export async function loadTheme(): Promise<Theme> {
  const settings = await loadSettings();
  return settings.theme;
}

/**
 * Flips the current theme (light → dark or dark → light), applies it to
 * document.body, persists it via updateSettings (field-merge), and returns
 * the new theme. Only the theme field is patched so concurrent writes to
 * treats or homeAnchorAt are not clobbered.
 */
export async function toggleTheme(current: Theme): Promise<Theme> {
  const next: Theme = current === 'light' ? 'dark' : 'light';
  applyTheme(next);

  // Field-merge: only patch the theme field to avoid clobbering treats or
  // homeAnchorAt written by concurrent service-worker or popup writers.
  await updateSettings({ theme: next });

  return next;
}

import type { Theme } from '../settings';
import { loadSettings, saveSettings } from '../settings';

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
 * document.body, persists it via saveSettings, and returns the new theme.
 *
 * Loads the full current settings before writing so that other fields
 * (treats, treatsUpdatedAt) are preserved — only the theme field changes.
 */
export async function toggleTheme(current: Theme): Promise<Theme> {
  const next: Theme = current === 'light' ? 'dark' : 'light';
  applyTheme(next);

  // Load full settings to avoid overwriting treats/treatsUpdatedAt
  const settings = await loadSettings();
  await saveSettings({ ...settings, theme: next });

  return next;
}

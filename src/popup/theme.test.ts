// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Theme } from '../settings';

// ---------------------------------------------------------------------------
// Chrome API mock — storage only.
// REVIEW: mocking core dependency — chrome.storage.local is the only
// persistence layer available in a Chrome extension context. The API is
// browser-only with no Node polyfill, so we stub it with an in-memory
// map. If the storage contract changes, these tests pass while production
// could break; pair with manual extension testing before shipping.
// ---------------------------------------------------------------------------

let mockStorage: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

beforeEach(() => {
  mockStorage = {};
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Import after mock is set up
// ---------------------------------------------------------------------------

import { applyTheme, toggleTheme, loadTheme } from './theme';

// ---------------------------------------------------------------------------
// applyTheme — sets data-theme on body
// ---------------------------------------------------------------------------

describe('applyTheme — applies theme to document.body', () => {
  it('sets data-theme attribute to "dark" on the body element', () => {
    /**
     * Verifies that applyTheme writes the given theme value to
     * document.body.dataset.theme, which CSS uses as the selector
     * [data-theme="dark"] to activate dark-mode custom properties.
     *
     * If this breaks, clicking the toggle updates state in memory but
     * the visual theme never switches — all users see light mode always.
     *
     * If violated, users who switched to dark mode see no visual change
     * despite the setting being persisted.
     */
    // GIVEN — document.body available (jsdom)

    // WHEN
    applyTheme('dark');

    // THEN
    expect(document.body.dataset.theme).toBe('dark');
  });

  it('sets data-theme attribute to "light" on the body element', () => {
    /**
     * Verifies that applyTheme correctly sets the light theme, ensuring
     * toggling back from dark to light restores the original appearance.
     *
     * If violated, users are stuck in dark mode after switching once.
     */
    // GIVEN — body is currently in dark mode
    document.body.dataset.theme = 'dark';

    // WHEN
    applyTheme('light');

    // THEN
    expect(document.body.dataset.theme).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// loadTheme — reads from persisted settings
// ---------------------------------------------------------------------------

describe('loadTheme — reads persisted theme from settings', () => {
  it('returns "light" when no settings are stored', async () => {
    /**
     * Verifies that loadTheme defaults to "light" on a fresh install where
     * no settings key exists in storage. This prevents a blank or broken
     * theme on first run.
     *
     * If violated, new installs display an unstyled or mismatched popup.
     */
    // GIVEN — empty storage

    // WHEN
    const theme = await loadTheme();

    // THEN
    expect(theme).toBe('light');
  });

  it('returns stored theme when settings exist', async () => {
    /**
     * Verifies that loadTheme returns the previously saved theme value so
     * the user's preference persists across popup openings.
     *
     * If violated, the popup always resets to light mode on open, ignoring
     * the user's saved preference.
     */
    // GIVEN — storage contains dark theme preference
    mockStorage['pixel-pets-settings-v1'] = { theme: 'dark', treats: 10, treatsUpdatedAt: 0 };

    // WHEN
    const theme = await loadTheme();

    // THEN
    expect(theme).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// toggleTheme — flips theme and persists
// ---------------------------------------------------------------------------

describe('toggleTheme — flips theme and persists via saveSettings', () => {
  it('flips theme from light to dark and applies it to the body', async () => {
    /**
     * Verifies that toggleTheme transitions the theme from "light" to "dark",
     * which is the primary user action: clicking the sun/moon button to enter
     * dark mode.
     *
     * If violated, clicking the toggle does nothing visible.
     */
    // GIVEN — current theme is light
    document.body.dataset.theme = 'light';
    mockStorage['pixel-pets-settings-v1'] = { theme: 'light', treats: 10, treatsUpdatedAt: 0 };

    // WHEN
    const newTheme = await toggleTheme('light');

    // THEN
    expect(newTheme).toBe('dark');
    expect(document.body.dataset.theme).toBe('dark');
  });

  it('flips theme from dark to light and applies it to the body', async () => {
    /**
     * Verifies that toggleTheme transitions from "dark" back to "light",
     * allowing users to switch back after entering dark mode.
     *
     * If violated, users are trapped in dark mode and cannot return to light.
     */
    // GIVEN — current theme is dark
    document.body.dataset.theme = 'dark';
    mockStorage['pixel-pets-settings-v1'] = { theme: 'dark', treats: 10, treatsUpdatedAt: 0 };

    // WHEN
    const newTheme = await toggleTheme('dark');

    // THEN
    expect(newTheme).toBe('light');
    expect(document.body.dataset.theme).toBe('light');
  });

  it('persists the new theme to storage after toggling', async () => {
    /**
     * Verifies that toggleTheme calls saveSettings with the new theme so
     * the preference survives popup close and reopen.
     *
     * This is the persistence contract: if toggleTheme applies the new
     * theme to the DOM but forgets to persist it, the user sees dark mode
     * while it's open, then reverts to light on next popup open.
     *
     * If violated, users must re-toggle their preference every popup open.
     */
    // GIVEN — current theme is light
    mockStorage['pixel-pets-settings-v1'] = { theme: 'light', treats: 5, treatsUpdatedAt: 123 };

    // WHEN
    await toggleTheme('light');

    // THEN — storage contains the dark theme
    const stored = mockStorage['pixel-pets-settings-v1'] as { theme: Theme };
    expect(stored.theme).toBe('dark');
  });

  it('preserves other settings fields when persisting the new theme', async () => {
    /**
     * Verifies that toggleTheme only updates the theme field, leaving
     * treats and treatsUpdatedAt intact. A naive saveSettings call that
     * only writes { theme } would wipe the treat count.
     *
     * If violated, every theme toggle resets the user's treat count to
     * defaults, which is a silent data-loss bug.
     */
    // GIVEN — user has 3 treats remaining
    mockStorage['pixel-pets-settings-v1'] = { theme: 'light', treats: 3, treatsUpdatedAt: 999 };

    // WHEN
    await toggleTheme('light');

    // THEN — treats and timestamp are preserved
    const stored = mockStorage['pixel-pets-settings-v1'] as { theme: Theme; treats: number; treatsUpdatedAt: number };
    expect(stored.treats).toBe(3);
    expect(stored.treatsUpdatedAt).toBe(999);
  });
});

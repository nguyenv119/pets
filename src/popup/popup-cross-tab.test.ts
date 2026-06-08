/**
 * Tests for the cross-tab storage.onChanged listener wired in popup.ts.
 *
 * The popup registers a chrome.storage.onChanged listener to react to:
 * 1. pixel-pets-v1 changes (another tab modified the roster) → re-render pet list
 * 2. pixel-pets-settings-v1 changes (treat consumed in another tab) → update treat counter
 *
 * These tests verify the listener is registered and calls the expected handlers.
 * We test the listener factory (handleStorageChange) exported from popup-cross-tab.ts,
 * isolating the logic from the DOM setup in popup.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleStorageChange } from './popup-cross-tab';

// ---------------------------------------------------------------------------
// Chrome mock
// REVIEW: mocking core dependency — chrome.storage.onChanged is browser-only.
// Cannot be exercised in jsdom. Tests validate the handler routing logic only.
// ---------------------------------------------------------------------------

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } },
  runtime: { sendMessage: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleStorageChange — roster change triggers re-render
// ---------------------------------------------------------------------------

describe('handleStorageChange — pixel-pets-v1 roster change', () => {
  it('calls onRosterChange when pixel-pets-v1 changes in local area', () => {
    /**
     * Verifies that a storage change to the roster key (pixel-pets-v1)
     * triggers the onRosterChange callback, which in popup.ts re-renders
     * the pet list.
     *
     * This is the cross-tab add/remove/hide sync path for the popup: when
     * another tab updates the roster, the popup must reflect those changes.
     *
     * If violated, the popup shows stale pet list after another tab modifies
     * pets — user must close and reopen the popup to see changes.
     */
    // GIVEN — listener callbacks
    const onRosterChange = vi.fn();
    const onSettingsChange = vi.fn();
    const changes = { 'pixel-pets-v1': { newValue: { roster: [] } } };

    // WHEN — storage change fires for roster key
    handleStorageChange(changes, 'local', onRosterChange, onSettingsChange);

    // THEN — roster callback invoked
    expect(onRosterChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('does NOT call onRosterChange for sync area changes', () => {
    /**
     * Verifies that storage changes in non-local areas (sync, managed) are
     * ignored. The extension uses local storage only.
     *
     * If violated, sync-area changes (from other devices or extensions)
     * would incorrectly trigger popup re-renders.
     */
    // GIVEN — a sync-area change
    const onRosterChange = vi.fn();
    const onSettingsChange = vi.fn();
    const changes = { 'pixel-pets-v1': { newValue: { roster: [] } } };

    // WHEN — non-local area
    handleStorageChange(changes, 'sync', onRosterChange, onSettingsChange);

    // THEN — no callbacks
    expect(onRosterChange).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('does NOT call onRosterChange when an unrelated key changes', () => {
    /**
     * Verifies that changes to unrelated storage keys don't trigger the
     * roster re-render. This prevents spurious re-renders on every storage
     * write (e.g., visibility preference saves).
     *
     * If violated, every storage write causes the popup to re-render its
     * pet list, causing unnecessary work and potential flicker.
     */
    // GIVEN — unrelated key change
    const onRosterChange = vi.fn();
    const onSettingsChange = vi.fn();
    const changes = { 'pixel-pets-visible': { newValue: true } };

    // WHEN
    handleStorageChange(changes, 'local', onRosterChange, onSettingsChange);

    // THEN — no callbacks
    expect(onRosterChange).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleStorageChange — settings change triggers treat counter
// ---------------------------------------------------------------------------

describe('handleStorageChange — pixel-pets-settings-v1 change', () => {
  it('calls onSettingsChange when pixel-pets-settings-v1 changes', () => {
    /**
     * Verifies that a storage change to the settings key triggers the
     * onSettingsChange callback, which in popup.ts refreshes the treat
     * counter display.
     *
     * This ensures the popup's treat counter stays in sync when treats
     * are consumed by content scripts in other tabs.
     *
     * If violated, the popup shows a stale treat count after treats are
     * consumed on a different tab.
     */
    // GIVEN
    const onRosterChange = vi.fn();
    const onSettingsChange = vi.fn();
    const changes = { 'pixel-pets-settings-v1': { newValue: { treatCount: 3 } } };

    // WHEN
    handleStorageChange(changes, 'local', onRosterChange, onSettingsChange);

    // THEN
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onRosterChange).not.toHaveBeenCalled();
  });

  it('calls both callbacks when both keys change simultaneously', () => {
    /**
     * Verifies that if both roster and settings change in the same storage
     * event (unlikely but possible), both callbacks are invoked.
     *
     * If violated, one callback is silently skipped causing stale state
     * in either the pet list or the treat counter.
     */
    // GIVEN
    const onRosterChange = vi.fn();
    const onSettingsChange = vi.fn();
    const changes = {
      'pixel-pets-v1': { newValue: { roster: [] } },
      'pixel-pets-settings-v1': { newValue: { treatCount: 5 } },
    };

    // WHEN
    handleStorageChange(changes, 'local', onRosterChange, onSettingsChange);

    // THEN
    expect(onRosterChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
  });
});

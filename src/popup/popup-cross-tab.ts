/**
 * Cross-tab storage listener for the popup.
 *
 * Extracted so the routing logic can be tested independently of the
 * popup's DOM setup and async init.
 *
 * Handles:
 * - pixel-pets-v1 changes → onRosterChange (re-render pet list)
 * - pixel-pets-settings-v1 changes → onSettingsChange (refresh treat counter + theme)
 */

const ROSTER_KEY = 'pixel-pets-v1';
const SETTINGS_KEY = 'pixel-pets-settings-v1';

/**
 * Route a chrome.storage.onChanged event to the appropriate popup callbacks.
 *
 * Self-echo note: popup.ts writes roster but its own in-memory `pets` state is
 * already current after the write. Re-rendering on our own write is idempotent
 * (same data → same DOM), so we don't suppress self-echoes for simplicity.
 */
export function handleStorageChange(
  changes: Record<string, unknown>,
  area: string,
  onRosterChange: () => void,
  onSettingsChange: () => void,
): void {
  if (area !== 'local') return;
  if (ROSTER_KEY in changes) onRosterChange();
  if (SETTINGS_KEY in changes) onSettingsChange();
}

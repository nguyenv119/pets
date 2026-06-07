// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DOM setup — jsdom provides document; we set up the toast region as
// popup.html would.
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="toast-region" role="status" aria-live="polite"></div></div>`;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Import after DOM is ready
// ---------------------------------------------------------------------------

// Dynamic import to re-execute module in each test suite run is not needed
// since showToast is stateless between calls (state is in module scope).
// We import once at module level — jsdom persists document across tests in
// the same file, which is fine because beforeEach resets the DOM.

import { showToast } from './toast';

// ---------------------------------------------------------------------------
// Toast — action-click resolves true
// ---------------------------------------------------------------------------

describe('showToast — action button clicked', () => {
  it('resolves true when the action button is clicked before timeout', async () => {
    /**
     * Verifies that showToast resolves true when the user clicks the action
     * button (e.g. "Undo") before the duration elapses.
     *
     * This is the success path for undo: the popup must know the user pressed
     * Undo so it can re-insert the pet. A false value would cause the popup
     * to treat an Undo click as a timeout, skipping restoration.
     *
     * If violated, clicking Undo does nothing — the pet is permanently gone
     * even though the user requested recovery.
     */
    // GIVEN — toast region is in the DOM
    const promise = showToast({ message: 'Buddy removed', actionLabel: 'Undo', duration: 5000 });

    // WHEN — user clicks the action button immediately
    const actionBtn = document.querySelector<HTMLButtonElement>('#toast-region .toast-action');
    expect(actionBtn).not.toBeNull();
    actionBtn!.click();

    // THEN — resolves true
    const result = await promise;
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Toast — timeout resolves false
// ---------------------------------------------------------------------------

describe('showToast — timeout without user action', () => {
  it('resolves false when duration elapses without clicking the action', async () => {
    /**
     * Verifies that showToast resolves false when the timer fires without
     * user interaction.
     *
     * This is the non-undo path: after timeout the popup should commit the
     * deletion (i.e., do nothing special — the SW already handled it).
     * A true value here would incorrectly trigger the undo restoration path.
     *
     * If violated, every timeout-based removal triggers a re-insert loop,
     * making pets impossible to delete.
     */
    // GIVEN — toast region in DOM, 5s duration
    const promise = showToast({ message: 'Buddy removed', actionLabel: 'Undo', duration: 5000 });

    // WHEN — 5 seconds pass
    vi.advanceTimersByTime(5000);

    // THEN — resolves false
    const result = await promise;
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Toast — DOM cleanup after action
// ---------------------------------------------------------------------------

describe('showToast — DOM cleanup', () => {
  it('removes the toast from the DOM after the action is clicked', async () => {
    /**
     * Verifies that clicking the action button removes the toast element from
     * the DOM so the region is empty afterwards.
     *
     * Without cleanup the toast lingers visually and can confuse the user about
     * whether their action registered. A stale toast also interferes with
     * aria-live announcements for subsequent toasts.
     *
     * If violated, dismissed toasts pile up in the DOM and the UI shows
     * multiple overlapping toast banners.
     */
    // GIVEN — toast shown
    const promise = showToast({ message: 'Buddy removed', actionLabel: 'Undo', duration: 5000 });
    const toastRegion = document.getElementById('toast-region')!;

    // WHEN — action clicked
    toastRegion.querySelector<HTMLButtonElement>('.toast-action')!.click();
    await promise;

    // THEN — toast region is empty
    expect(toastRegion.innerHTML.trim()).toBe('');
  });

  it('removes the toast from the DOM after timeout', async () => {
    /**
     * Verifies that the toast element is removed from the DOM when the timer
     * fires, even if the user did not interact.
     *
     * Stale toast DOM after timeout would show a dismissed toast that no longer
     * responds to clicks, confusing users who see a "Undo" button that does
     * nothing.
     *
     * If violated, expired toasts remain visible and mislead users into
     * thinking they can still undo.
     */
    // GIVEN — toast shown
    const promise = showToast({ message: 'Buddy removed', actionLabel: 'Undo', duration: 5000 });
    const toastRegion = document.getElementById('toast-region')!;

    // WHEN — timeout fires
    vi.advanceTimersByTime(5000);
    await promise;

    // THEN — toast region is empty
    expect(toastRegion.innerHTML.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Toast — new call replaces old one
// ---------------------------------------------------------------------------

describe('showToast — single toast at a time', () => {
  it('calling showToast a second time resolves the first promise false', async () => {
    /**
     * Verifies that a second showToast call cancels the first, resolving it
     * with false (timeout semantics) and replacing the visible toast.
     *
     * This prevents two simultaneous toasts from stacking in the UI, which
     * would create confusing overlapping "Undo" buttons that refer to
     * different actions.
     *
     * If violated, deleting two pets in quick succession shows two toasts
     * and clicking "Undo" on the new one may restore the wrong pet.
     */
    // GIVEN — first toast is shown
    const promise1 = showToast({ message: 'Pet A removed', actionLabel: 'Undo', duration: 5000 });

    // WHEN — second toast is shown before first times out
    const promise2 = showToast({ message: 'Pet B removed', actionLabel: 'Undo', duration: 5000 });

    // THEN — first resolves false (displaced), second is still pending
    const result1 = await promise1;
    expect(result1).toBe(false);

    // Cleanup: resolve second toast
    vi.advanceTimersByTime(5000);
    await promise2;
  });

  it('calling showToast a second time shows the new message', async () => {
    /**
     * Verifies that the visible toast message updates to the second call's
     * message when a new toast displaces the previous one.
     *
     * Users must see the message relevant to the most recent action. Showing
     * a stale message from the prior action would cause confusion about what
     * "Undo" refers to.
     *
     * If violated, deleting "Pet B" would show "Pet A removed" — misleading
     * the user about which deletion can be undone.
     */
    // GIVEN — first toast is shown
    showToast({ message: 'Pet A removed', actionLabel: 'Undo', duration: 5000 });

    // WHEN — second toast replaces it
    const promise2 = showToast({ message: 'Pet B removed', actionLabel: 'Undo', duration: 5000 });

    // THEN — the toast region shows the new message
    const toastRegion = document.getElementById('toast-region')!;
    expect(toastRegion.textContent).toContain('Pet B removed');

    // Cleanup
    vi.advanceTimersByTime(5000);
    await promise2;
  });
});

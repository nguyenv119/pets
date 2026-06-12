// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mock — must be set before any module imports that reference chrome
// ---------------------------------------------------------------------------

const sentMessages: unknown[] = [];

// REVIEW: mocking core dependency — chrome.runtime.sendMessage, chrome.storage.local.
// Chrome extension APIs are browser-only and cannot be exercised under Vitest/jsdom.
const chromeMock = {
  runtime: {
    sendMessage: vi.fn((msg: unknown) => { sentMessages.push(msg); }),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    lastError: undefined as { message: string } | undefined,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (_key: string) => ({})),
      set: vi.fn(async () => {}),
    },
    onChanged: { addListener: vi.fn() },
  },
  tabs: {
    sendMessage: vi.fn((_tabId: number, _msg: unknown, cb: (r?: { alive: boolean }) => void) => cb(undefined)),
    query: vi.fn(async () => []),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

// ---------------------------------------------------------------------------
// jsdom DOM setup — mirrors the structure in popup.html
// ---------------------------------------------------------------------------

function setupDOM(): void {
  document.body.innerHTML = `
    <div id="app">
      <div id="special-page-banner" hidden></div>
      <header>
        <div class="header-row">
          <h1>Pixel Pets</h1>
          <div class="header-actions">
            <button id="btn-theme"></button>
            <button id="btn-toggle"></button>
            <button id="btn-throw-ball"></button>
          </div>
        </div>
      </header>
      <section id="pets-list"></section>
      <button id="btn-add-toggle"></button>
      <section id="add-pet-form">
        <div id="add-pet-body">
          <div class="form-grid">
            <input type="text" id="pet-name" value="" />
            <div id="pet-type-grid"></div>
            <input type="hidden" id="pet-type-value" value="dog" />
            <div id="pet-color-grid"></div>
            <input type="hidden" id="pet-color-value" value="brown" />
          </div>
          <p id="capacity-reason" hidden></p>
          <button id="btn-add"></button>
        </div>
      </section>
      <footer></footer>
      <div id="toast-region" role="status" aria-live="polite"></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Module under test — import after chrome mock is in globalThis
// ---------------------------------------------------------------------------

// We use a factory approach: re-import the module by resetting the module
// registry between tests so we get fresh state. However, vitest module
// isolation requires vi.resetModules() + dynamic import.

async function loadPopupModule(): Promise<void> {
  vi.resetModules();
  await import('./popup');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStoredPets() {
  return [
    { id: 'pet-1', name: 'Buddy', type: 'dog', color: 'brown', x: 100, y: 0 },
    { id: 'pet-2', name: 'Nemo',  type: 'fish', color: 'orange', x: 200, y: 0 },
  ];
}

/** Returns the new split-storage mock value expected by loadPetData(). */
function makeStorageValue() {
  const pets = makeStoredPets();
  return {
    'pixel-pets-v1': {
      roster: pets.map(({ id, name, type, color }) => ({ id, name, type, color })),
    },
    'pixel-pets-positions-v1': Object.fromEntries(pets.map(p => [p.id, { x: p.x, y: p.y }])),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupDOM();
  vi.clearAllMocks();
  sentMessages.length = 0;
  chromeMock.runtime.lastError = undefined;

  // Default: tabs.query for init's pingTab → no active tab
  chromeMock.tabs.query.mockImplementation(async () => []);
});

describe('removePet — optimistic UI', () => {
  it('removes the pet from the list immediately without waiting for storage', async () => {
    /**
     * Verifies that clicking the remove button removes the pet's row from the
     * DOM immediately (optimistic UI), even before any storage operation
     * completes.
     *
     * Immediate feedback is essential UX: the user should not perceive a delay
     * when removing a pet. A storage-first approach would cause a visible lag
     * proportional to storage latency.
     *
     * If violated, the pet row remains visible after the delete click until
     * the async storage write completes, making the UI feel sluggish.
     */
    // GIVEN — two pets in storage (new split-storage shape)
    chromeMock.storage.local.get.mockResolvedValue(makeStorageValue());
    chromeMock.tabs.query.mockResolvedValue([]);

    await loadPopupModule();
    // wait for init to complete
    await new Promise(r => setTimeout(r, 0));

    const listEl = document.getElementById('pets-list')!;
    expect(listEl.querySelectorAll('.pet-item').length).toBe(2);

    // WHEN — click the remove button for pet-1
    const removeBtn = listEl.querySelector<HTMLButtonElement>('[data-id="pet-1"] .btn-remove')!;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // THEN — the pet-1 row is gone; pet-2 remains
    expect(listEl.querySelector('[data-id="pet-1"]')).toBeNull();
    expect(listEl.querySelector('[data-id="pet-2"]')).not.toBeNull();
  });
});

describe('removePet — sends PENDING_REMOVE_PET message', () => {
  it('sends PENDING_REMOVE_PET to the service worker with id and delayMs', async () => {
    /**
     * Verifies that clicking remove sends a PENDING_REMOVE_PET message (not
     * the old REMOVE_PET message) so the service worker defers the actual
     * deletion during the undo window.
     *
     * Sending REMOVE_PET immediately would delete the pet from all content
     * scripts before the user has a chance to undo, making undo impossible.
     *
     * If violated, the pet disappears from tabs immediately — clicking Undo
     * in the popup re-inserts locally but tabs still have no pet.
     */
    // GIVEN — one pet in storage (new split-storage shape)
    chromeMock.storage.local.get.mockResolvedValue({
      'pixel-pets-v1': { roster: [{ id: 'pet-1', name: 'Buddy', type: 'dog', color: 'brown' }] },
      'pixel-pets-positions-v1': { 'pet-1': { x: 100, y: 0 } },
    });
    chromeMock.tabs.query.mockResolvedValue([]);

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // WHEN — click remove
    const removeBtn = document.querySelector<HTMLButtonElement>('[data-id="pet-1"] .btn-remove')!;
    removeBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // THEN — PENDING_REMOVE_PET was sent (not REMOVE_PET)
    const pendingMsg = sentMessages.find(
      (m): m is { type: string; id: string; delayMs: number } =>
        typeof m === 'object' && m !== null && (m as { type: string }).type === 'PENDING_REMOVE_PET'
    );
    expect(pendingMsg).toBeDefined();
    expect(pendingMsg!.id).toBe('pet-1');
    expect(pendingMsg!.delayMs).toBe(5000);

    // And REMOVE_PET was NOT sent immediately
    const removeMsg = sentMessages.find(
      (m): m is { type: string } =>
        typeof m === 'object' && m !== null && (m as { type: string }).type === 'REMOVE_PET'
    );
    expect(removeMsg).toBeUndefined();
  });
});

describe('removePet — toast shown', () => {
  it('shows a toast with the pet name after deletion', async () => {
    /**
     * Verifies that a toast notification appears with the removed pet's name
     * after the remove button is clicked.
     *
     * Without a toast, the user has no way to undo an accidental deletion.
     * The toast is the entry point for the undo action.
     *
     * If violated, there is no undo mechanism and accidental deletions are
     * permanent with no user feedback.
     */
    // GIVEN — one pet in storage (new split-storage shape)
    chromeMock.storage.local.get.mockResolvedValue({
      'pixel-pets-v1': { roster: [{ id: 'pet-1', name: 'Buddy', type: 'dog', color: 'brown' }] },
      'pixel-pets-positions-v1': { 'pet-1': { x: 100, y: 0 } },
    });
    chromeMock.tabs.query.mockResolvedValue([]);

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    // WHEN — click remove
    document.querySelector<HTMLButtonElement>('[data-id="pet-1"] .btn-remove')!.click();
    await new Promise(r => setTimeout(r, 0));

    // THEN — toast region has the pet name
    const toastRegion = document.getElementById('toast-region')!;
    expect(toastRegion.textContent).toContain('Buddy');
  });
});

describe('removePet — undo clicked', () => {
  it('re-inserts pet at original index and sends CANCEL_PENDING_REMOVE when Undo is clicked', async () => {
    /**
     * Verifies that clicking the Undo button in the toast restores the pet to
     * its original position in the list and tells the service worker to cancel
     * the pending removal.
     *
     * Without this, undo would restore the UI state but the service worker
     * would still delete the pet from storage and broadcast REMOVE_PET to all
     * tabs — leaving the pet in the popup but missing from content scripts.
     *
     * If violated, "Undo" restores the pet visually in the popup but pets on
     * tabs still get removed — an inconsistent state.
     */
    // GIVEN — two pets in storage; we remove the first one (new split-storage shape)
    chromeMock.storage.local.get.mockResolvedValue(makeStorageValue());
    chromeMock.tabs.query.mockResolvedValue([]);

    await loadPopupModule();
    await new Promise(r => setTimeout(r, 0));

    const listEl = document.getElementById('pets-list')!;
    const removeBtn = listEl.querySelector<HTMLButtonElement>('[data-id="pet-1"] .btn-remove')!;
    removeBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Verify pet-1 is gone
    expect(listEl.querySelector('[data-id="pet-1"]')).toBeNull();

    // WHEN — click Undo in the toast
    const undoBtn = document.querySelector<HTMLButtonElement>('#toast-region .toast-action')!;
    expect(undoBtn).not.toBeNull();
    undoBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // THEN — pet-1 is restored at index 0 (before pet-2)
    const items = listEl.querySelectorAll('.pet-item');
    expect(items.length).toBe(2);
    expect((items[0] as HTMLElement).dataset.id).toBe('pet-1');
    expect((items[1] as HTMLElement).dataset.id).toBe('pet-2');

    // AND — CANCEL_PENDING_REMOVE was sent
    const cancelMsg = sentMessages.find(
      (m): m is { type: string; id: string } =>
        typeof m === 'object' && m !== null && (m as { type: string }).type === 'CANCEL_PENDING_REMOVE'
    );
    expect(cancelMsg).toBeDefined();
    expect(cancelMsg!.id).toBe('pet-1');
  });
});

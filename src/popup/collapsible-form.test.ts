// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module under test — imported after DOM setup
// ---------------------------------------------------------------------------

// We test setAddFormExpanded in isolation by setting up the DOM elements
// that popup.ts expects, then importing the function.

// Chrome mock required because popup modules import from store/settings
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
  runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function buildDOM(): void {
  document.body.innerHTML = `
    <div id="app">
      <button id="btn-add-toggle" class="fab" aria-expanded="false">+ Add pet</button>
      <section id="add-pet-form">
        <div id="add-pet-body">
          <div class="form-grid">
            <input type="text" id="pet-name" />
          </div>
          <button id="btn-add" class="btn-primary">Add Pet</button>
        </div>
      </section>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// setAddFormExpanded — collapsible form toggle
// ---------------------------------------------------------------------------

describe('setAddFormExpanded — collapsible add-pet form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildDOM();
  });

  it('removes collapsed class from form when expanding', async () => {
    /**
     * Verifies that setAddFormExpanded(true) removes the `.collapsed` class
     * from `#add-pet-form`, making the form body visible.
     *
     * This matters because the CSS uses `.collapsed` to set max-height: 0
     * on `#add-pet-body`. Without removing it, the form stays hidden even
     * when the user clicks the FAB to open it.
     *
     * If violated, users click "+ Add pet" and the form never appears.
     */
    // GIVEN — form starts collapsed
    const form = document.getElementById('add-pet-form')!;
    form.classList.add('collapsed');

    // WHEN — expand the form
    const { setAddFormExpanded } = await import('./collapsible-form');
    setAddFormExpanded(true);

    // THEN — collapsed class is removed
    expect(form.classList.contains('collapsed')).toBe(false);
  });

  it('adds collapsed class to form when collapsing', async () => {
    /**
     * Verifies that setAddFormExpanded(false) adds the `.collapsed` class
     * to `#add-pet-form`, hiding the form body.
     *
     * This matters because after adding a pet, the form should auto-collapse
     * to give the pet list more visual focus. Without this, the form remains
     * open cluttering the UI after every add.
     *
     * If violated, the form stays expanded after adding a pet.
     */
    // GIVEN — form starts expanded (no collapsed class)
    const form = document.getElementById('add-pet-form')!;
    form.classList.remove('collapsed');

    // WHEN — collapse the form
    const { setAddFormExpanded } = await import('./collapsible-form');
    setAddFormExpanded(false);

    // THEN — collapsed class is added
    expect(form.classList.contains('collapsed')).toBe(true);
  });

  it('sets aria-expanded="true" on FAB when expanding', async () => {
    /**
     * Verifies that setAddFormExpanded(true) sets aria-expanded="true" on
     * `#btn-add-toggle`, communicating the expanded state to screen readers.
     *
     * This matters for accessibility: without the correct aria-expanded value,
     * screen reader users cannot tell whether the form is open or closed,
     * breaking the accessible disclosure pattern.
     *
     * If violated, screen readers announce the button as collapsed even when
     * the form is visible, confusing visually-impaired users.
     */
    // GIVEN — FAB starts with aria-expanded="false"
    const fab = document.getElementById('btn-add-toggle')!;
    fab.setAttribute('aria-expanded', 'false');

    // WHEN — expand the form
    const { setAddFormExpanded } = await import('./collapsible-form');
    setAddFormExpanded(true);

    // THEN — aria-expanded reflects the expanded state
    expect(fab.getAttribute('aria-expanded')).toBe('true');
  });

  it('sets aria-expanded="false" on FAB when collapsing', async () => {
    /**
     * Verifies that setAddFormExpanded(false) sets aria-expanded="false" on
     * `#btn-add-toggle`, communicating the collapsed state to screen readers.
     *
     * Same accessibility contract as the expand case — both directions must
     * be correct for the aria disclosure pattern to work properly.
     *
     * If violated, screen readers announce the form as open when it is hidden.
     */
    // GIVEN — FAB starts with aria-expanded="true"
    const fab = document.getElementById('btn-add-toggle')!;
    fab.setAttribute('aria-expanded', 'true');

    // WHEN — collapse the form
    const { setAddFormExpanded } = await import('./collapsible-form');
    setAddFormExpanded(false);

    // THEN — aria-expanded reflects the collapsed state
    expect(fab.getAttribute('aria-expanded')).toBe('false');
  });

  it('focuses the name input when expanding', async () => {
    /**
     * Verifies that setAddFormExpanded(true) moves keyboard focus to the
     * name input field so users can immediately start typing after opening.
     *
     * This matters for keyboard usability: without auto-focus, a keyboard
     * user must press Tab multiple times to reach the first field after
     * clicking the FAB.
     *
     * If violated, keyboard users have a frustrating extra-tab experience
     * every time they open the add-pet form.
     */
    // GIVEN — name input exists and does not have focus
    const nameInput = document.getElementById('pet-name') as HTMLInputElement;
    nameInput.blur();

    // WHEN — expand the form
    const { setAddFormExpanded } = await import('./collapsible-form');
    setAddFormExpanded(true);

    // THEN — the name input has focus
    expect(document.activeElement).toBe(nameInput);
  });

  it('returns focus to FAB when collapsing', async () => {
    /**
     * Verifies that setAddFormExpanded(false) returns focus to the FAB button
     * so keyboard users can continue navigating from where they opened the form.
     *
     * Without this, closing the form drops keyboard focus to the body or
     * leaves it inside the now-hidden form, which is a keyboard trap.
     *
     * If violated, keyboard users lose their navigation position after closing
     * the form, forcing them to Tab back through the entire popup.
     */
    // GIVEN — FAB exists and does not have focus
    const fab = document.getElementById('btn-add-toggle') as HTMLButtonElement;
    fab.blur();

    // WHEN — collapse the form
    const { setAddFormExpanded } = await import('./collapsible-form');
    setAddFormExpanded(false);

    // THEN — the FAB has focus
    expect(document.activeElement).toBe(fab);
  });
});

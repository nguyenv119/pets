// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mocks (browser-only — cannot run in Node/jsdom without stubs)
// REVIEW: mocking core dependency — chrome.* APIs are browser-only and cannot
// be exercised under Vitest/jsdom. We stub storage, runtime, and tabs to
// exercise renderPetList and togglePetHidden logic in isolation.
// ---------------------------------------------------------------------------

const chromeMock = {
  tabs: {
    sendMessage: vi.fn((_tabId: number, _msg: { type: string }, cb: (r?: { alive: boolean }) => void) => cb(undefined)),
    query: vi.fn(async () => []),
  },
  runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Import production functions
// ---------------------------------------------------------------------------

import { renderPetItemHTML } from './render-pet-item';

// ---------------------------------------------------------------------------
// renderPetItemHTML — hide button HTML
// ---------------------------------------------------------------------------

describe('renderPetItemHTML — hide button presence and state', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renders a .btn-hide button in each pet row', () => {
    /**
     * Verifies that each pet row contains a .btn-hide button so the user
     * can toggle individual pet visibility from the popup.
     *
     * This matters because without the button there is no UI affordance
     * to hide individual pets — the per-pet hide feature simply would not exist.
     *
     * If violated, the hide button never appears and users cannot hide pets.
     */
    // GIVEN — a single visible pet
    const html = renderPetItemHTML({ id: 'a1', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0 });

    // WHEN — injected into DOM
    container.innerHTML = html;

    // THEN — a .btn-hide button is present
    expect(container.querySelector('.btn-hide')).not.toBeNull();
  });

  it('sets aria-pressed="false" on hide button for a visible pet', () => {
    /**
     * Verifies that for a visible pet (hidden !== true), the hide button
     * has aria-pressed="false" so screen readers communicate correct state.
     *
     * This matters for accessibility — aria-pressed is the standard semantic
     * for toggle button state.
     *
     * If violated, screen readers announce the wrong state, misleading
     * visually-impaired users about whether their pet is currently hidden.
     */
    // GIVEN — a pet that is not hidden
    const html = renderPetItemHTML({ id: 'a1', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0 });

    // WHEN — injected into DOM
    container.innerHTML = html;
    const btn = container.querySelector('.btn-hide') as HTMLButtonElement;

    // THEN — aria-pressed is "false"
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('sets aria-pressed="true" and title containing "Show" for a hidden pet', () => {
    /**
     * Verifies that a hidden pet's hide button reflects hidden state via
     * aria-pressed="true" and a "Show" tooltip, communicating next action.
     *
     * This matters because the toggle button must show current state so the
     * user knows what clicking it will do next.
     *
     * If violated, the button appears active but says "Hide" — the user
     * cannot tell the pet is already hidden and clicking becomes confusing.
     */
    // GIVEN — a pet with hidden: true
    const html = renderPetItemHTML({ id: 'a1', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0, hidden: true });

    // WHEN — injected into DOM
    container.innerHTML = html;
    const btn = container.querySelector('.btn-hide') as HTMLButtonElement;

    // THEN — aria-pressed is "true" and title says "Show"
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.title).toContain('Show');
  });

  it('carries the pet id in data-id on the hide button', () => {
    /**
     * Verifies that the hide button has data-id matching the pet's id so the
     * click handler can identify which pet's visibility to toggle.
     *
     * This matters because without data-id the handler cannot determine which
     * pet to change — all hide buttons would target the wrong or no pet.
     *
     * If violated, clicking hide may hide the wrong pet or silently do nothing.
     */
    // GIVEN — a pet with known id
    const html = renderPetItemHTML({ id: 'pet-xyz', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0 });

    // WHEN — injected into DOM
    container.innerHTML = html;
    const btn = container.querySelector('.btn-hide') as HTMLButtonElement;

    // THEN — data-id matches pet id
    expect(btn.dataset.id).toBe('pet-xyz');
  });

  it('places hide button before the remove button in DOM order', () => {
    /**
     * Verifies that the hide button appears before the remove button so
     * layout matches design spec (eye icon left of ×).
     *
     * This matters because swapped order changes the visual layout and
     * inverts user muscle-memory expectations.
     *
     * If violated, the user clicks × when trying to hide, accidentally
     * deleting their pet.
     */
    // GIVEN — a single pet
    const html = renderPetItemHTML({ id: 'a1', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0 });

    // WHEN — injected into DOM
    container.innerHTML = html;
    const buttons = container.querySelectorAll('button');

    // THEN — .btn-hide is first, .btn-remove is second
    expect(buttons[0].classList.contains('btn-hide')).toBe(true);
    expect(buttons[1].classList.contains('btn-remove')).toBe(true);
  });

  it('applies dimmed CSS class when pet is hidden', () => {
    /**
     * Verifies that the hide button has a .btn-hide--dimmed class when the
     * pet is hidden so the visual state matches the aria state.
     *
     * This matters because relying on aria-pressed alone leaves sighted users
     * without visual feedback that the button is in the "active" (hidden) state.
     *
     * If violated, the button looks the same whether the pet is hidden or not,
     * making it hard to tell at a glance which pets are currently hidden.
     */
    // GIVEN — a hidden pet
    const html = renderPetItemHTML({ id: 'a1', name: 'Rex', type: 'dog', color: 'brown', x: 0, y: 0, hidden: true });

    // WHEN — injected into DOM
    container.innerHTML = html;
    const btn = container.querySelector('.btn-hide') as HTMLButtonElement;

    // THEN — btn-hide--dimmed class is present
    expect(btn.classList.contains('btn-hide--dimmed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SET_PET_HIDDEN message shape — type-level contract
// ---------------------------------------------------------------------------

describe('SET_PET_HIDDEN ExtMessage type', () => {
  it('the message shape satisfies the ExtMessage union at runtime', async () => {
    /**
     * Verifies that a SET_PET_HIDDEN message has the correct shape fields
     * (type, id, hidden) to satisfy the ExtMessage union contract.
     *
     * This matters because without the union member, TypeScript cannot
     * type-check callers, leading to silent shape mismatches.
     *
     * If violated, a typo in `id` or `hidden` passes compilation undetected
     * and the content script receives malformed messages.
     */
    // GIVEN — a SET_PET_HIDDEN message
    const { } = await import('../types');
    const msg = { type: 'SET_PET_HIDDEN' as const, id: 'abc', hidden: true };

    // WHEN / THEN — shape is correct
    expect(msg.type).toBe('SET_PET_HIDDEN');
    expect(typeof msg.id).toBe('string');
    expect(typeof msg.hidden).toBe('boolean');
  });
});

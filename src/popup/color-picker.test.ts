// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { COLORS } from './colors';
import type { PetType } from '../types';

// ---------------------------------------------------------------------------
// Chrome API mock (required because jsdom has no chrome global)
// ---------------------------------------------------------------------------

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { getURL: (p: string) => `chrome-extension://fake/${p}` },
};

// ---------------------------------------------------------------------------
// DOM setup helpers
// ---------------------------------------------------------------------------

function buildDOM(): void {
  document.body.innerHTML = `
    <div id="pet-color-grid" role="radiogroup" aria-label="Color"></div>
    <input type="hidden" id="pet-color-value" value="" />
  `;
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

let initColorPicker: (grid: HTMLElement, hiddenInput: HTMLInputElement, getURL: (path: string) => string) => void;
const fakeGetURL = (p: string) => `chrome-extension://fake/${p}`;
let renderColorGrid: (type: PetType, grid: HTMLElement, hiddenInput: HTMLInputElement, getURL: (path: string) => string) => void;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./color-picker');
  initColorPicker = mod.initColorPicker;
  renderColorGrid = mod.renderColorGrid;
  buildDOM();
});

// ---------------------------------------------------------------------------
// renderColorGrid
// ---------------------------------------------------------------------------

describe('renderColorGrid — renders color buttons for a type', () => {
  it('renders one button per color for the given type', () => {
    /**
     * Verifies that renderColorGrid creates one radio button per color variant for
     * the specified pet type.
     *
     * This matters because the color grid is the primary way users select a color.
     * If buttons are missing, users cannot select those color variants.
     *
     * If violated, some colors are inaccessible and adopted pets would always be
     * the default color even if the user wanted a different one.
     */
    // GIVEN — empty color grid, dog type
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;

    // WHEN
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // THEN — one button per dog color
    const buttons = grid.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(COLORS.dog.length);
  });

  it('each button has data-color and an img with the idle gif src', () => {
    /**
     * Verifies that each color button has the correct data-color attribute and
     * an img pointing to the pet's idle gif for that color.
     *
     * This matters because the img is what the user sees to distinguish colors.
     * data-color is read on selection to set the hidden input.
     *
     * If violated, clicking a color button would not set the correct color, or
     * the button would be visually blank.
     */
    // GIVEN — empty grid
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;

    // WHEN
    renderColorGrid('chicken', grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // THEN — check first button
    const btn = grid.querySelector('button[role="radio"]') as HTMLButtonElement;
    expect(btn.dataset.color).toBe(COLORS.chicken[0]);
    const img = btn.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain(`assets/chicken/${COLORS.chicken[0]}_idle_8fps.gif`);
  });

  it('auto-selects the first color and sets the hidden input', () => {
    /**
     * Verifies that the first color is selected by default when the grid renders,
     * and the hidden input is set to that color.
     *
     * This matters because the form needs a valid color when the user clicks
     * "Add Pet" without explicitly choosing one.
     *
     * If violated, adding a pet without touching the color picker would submit
     * an empty color and create a broken pet.
     */
    // GIVEN — empty grid
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;

    // WHEN
    renderColorGrid('fox', grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // THEN — first color selected, hidden input set
    const firstBtn = grid.querySelector('button[role="radio"]') as HTMLButtonElement;
    expect(firstBtn.getAttribute('aria-checked')).toBe('true');
    expect(firstBtn.classList.contains('selected')).toBe(true);
    expect(firstBtn.tabIndex).toBe(0);
    expect(hidden.value).toBe(COLORS.fox[0]);
  });

  it('non-first colors are not selected and have tabindex=-1', () => {
    /**
     * Verifies that only the first button has tabindex=0 (roving tabindex pattern)
     * and aria-checked="true". Others must start unselected.
     *
     * This maintains the ARIA radiogroup invariant: exactly one item is selected.
     *
     * If violated, multiple items appear selected or keyboard navigation breaks.
     */
    // GIVEN
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;

    // WHEN
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // THEN — all buttons except first are unselected
    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];
    const selected = buttons.filter(b => b.getAttribute('aria-checked') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.color).toBe(COLORS.dog[0]);

    const unselected = buttons.slice(1);
    for (const btn of unselected) {
      expect(btn.tabIndex).toBe(-1);
      expect(btn.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('re-renders the grid when called with a new type', () => {
    /**
     * Verifies that calling renderColorGrid replaces the previous content entirely,
     * so switching type from dog to chicken shows only chicken's colors.
     *
     * This matters because the pet-type-changed event triggers a re-render. If the
     * grid is not cleared, old color buttons from the previous type remain.
     *
     * If violated, users see a mix of colors from the old and new type, and the
     * hidden input may hold an invalid color for the current type.
     */
    // GIVEN — grid populated with dog colors
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // WHEN — re-render for chicken
    renderColorGrid('chicken', grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // THEN — only chicken colors present
    const buttons = grid.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(COLORS.chicken.length);
    const colors = [...buttons].map(b => (b as HTMLButtonElement).dataset.color);
    expect(colors).toEqual(COLORS.chicken);
  });
});

// ---------------------------------------------------------------------------
// initColorPicker — click and keyboard
// ---------------------------------------------------------------------------

describe('initColorPicker — click selects a color', () => {
  it('clicking a color button selects it and updates the hidden input', () => {
    /**
     * Verifies that clicking a color button sets aria-checked="true" on that button
     * and updates the hidden color input to the corresponding color value.
     *
     * This is the core selection behavior. Without it, clicking a color has no effect
     * and the form always submits the default (first) color.
     *
     * If violated, user color choices are ignored when adding a pet.
     */
    // GIVEN — grid rendered with dog, second color button targeted
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, fakeGetURL);

    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];
    const secondBtn = buttons[1];

    // WHEN — click second color
    secondBtn.click();

    // THEN — second color selected, hidden input updated
    expect(hidden.value).toBe(secondBtn.dataset.color);
    expect(secondBtn.getAttribute('aria-checked')).toBe('true');
    expect(secondBtn.classList.contains('selected')).toBe(true);

    // AND — first color deselected
    expect(buttons[0].getAttribute('aria-checked')).toBe('false');
    expect(buttons[0].classList.contains('selected')).toBe(false);
  });

  it('clicking a color moves tabindex=0 to that button', () => {
    /**
     * Verifies roving tabindex on click: selected button gets tabindex=0,
     * others get tabindex=-1.
     *
     * Necessary for keyboard accessibility after pointer selection — the user can
     * Tab away and Tab back to the last selected color.
     *
     * If violated, keyboard focus is lost after mouse selection.
     */
    // GIVEN
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, fakeGetURL);

    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];

    // WHEN — click second button
    buttons[1].click();

    // THEN — exactly one button has tabindex=0
    const focusable = buttons.filter(b => b.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toBe(buttons[1]);
  });
});

describe('initColorPicker — keyboard navigation', () => {
  it('ArrowRight moves selection to next color button', () => {
    /**
     * Verifies that pressing ArrowRight on a focused color button moves focus and
     * selection to the next button in DOM order.
     *
     * Required by the ARIA radiogroup keyboard interaction pattern.
     *
     * If violated, keyboard users cannot navigate the color grid forward.
     */
    // GIVEN
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, fakeGetURL);

    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];
    buttons[0].focus();

    // WHEN
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // THEN
    expect(document.activeElement).toBe(buttons[1]);
    expect(hidden.value).toBe(buttons[1].dataset.color);
  });

  it('ArrowLeft moves selection to previous color button', () => {
    /**
     * Verifies ArrowLeft navigation moves focus and selection backward.
     *
     * Symmetric to ArrowRight — both directions required for full accessibility.
     *
     * If violated, users can only move forward through colors.
     */
    // GIVEN
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, fakeGetURL);

    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];
    buttons[1].focus();

    // WHEN
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    // THEN
    expect(document.activeElement).toBe(buttons[0]);
    expect(hidden.value).toBe(buttons[0].dataset.color);
  });

  it('ArrowRight wraps from last to first', () => {
    /**
     * Verifies that ArrowRight from the last color button wraps to the first.
     *
     * Without wrap-around, users reach the last color and cannot continue cycling.
     *
     * If violated, keyboard users get stuck at the last color option.
     */
    // GIVEN
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, fakeGetURL);

    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];
    const lastBtn = buttons[buttons.length - 1];
    lastBtn.focus();

    // WHEN
    lastBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // THEN — wraps to first
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('Space key selects the focused color button', () => {
    /**
     * Verifies that pressing Space on a focused color button selects it.
     *
     * Required by ARIA radio button pattern — Space activates the focused radio.
     *
     * If violated, keyboard users can navigate to a color but pressing Space has
     * no effect, so they cannot select it.
     */
    // GIVEN
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, fakeGetURL);

    const buttons = [...grid.querySelectorAll('button[role="radio"]')] as HTMLButtonElement[];
    buttons[2].focus();

    // WHEN
    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    // THEN
    expect(hidden.value).toBe(buttons[2].dataset.color);
    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
  });
});

describe('initColorPicker — pet-type-changed event', () => {
  it('re-renders the color grid when pet-type-changed is fired', () => {
    /**
     * Verifies that initColorPicker listens for the CustomEvent('pet-type-changed')
     * and re-renders the color grid for the new type.
     *
     * This is the integration point between the type picker (T2) and the color
     * picker (T3). Without this listener, switching types never updates the colors.
     *
     * If violated, the color grid always shows colors for the initial type regardless
     * of what the user selects in the type picker.
     */
    // GIVEN — grid initialized for 'dog'
    const grid = document.getElementById('pet-color-grid') as HTMLElement;
    const hidden = document.getElementById('pet-color-value') as HTMLInputElement;
    renderColorGrid('dog', grid, hidden, (p) => `chrome-extension://fake/${p}`);
    initColorPicker(grid, hidden, (p) => `chrome-extension://fake/${p}`);

    // WHEN — type changes to chicken
    document.dispatchEvent(new CustomEvent('pet-type-changed', { detail: { type: 'chicken' } }));

    // THEN — grid shows chicken colors
    const buttons = grid.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(COLORS.chicken.length);
    const colors = [...buttons].map(b => (b as HTMLButtonElement).dataset.color);
    expect(colors).toEqual(COLORS.chicken);

    // AND — hidden input set to first chicken color
    expect(hidden.value).toBe(COLORS.chicken[0]);
  });
});

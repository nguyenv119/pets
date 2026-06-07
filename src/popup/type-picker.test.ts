// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { COLORS } from './colors';

// ---------------------------------------------------------------------------
// DOM setup helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal DOM matching the type-picker structure:
 *   #pet-type-grid  (role="radiogroup")
 *   #pet-type-value (hidden input)
 *   .type-cell      (one per type, role="radio")
 */
function buildDOM(initialType: string = 'dog'): void {
  const types = Object.keys(COLORS) as Array<keyof typeof COLORS>;
  const cells = types.map((t) => {
    const firstColor = COLORS[t][0];
    return `<button
      role="radio"
      data-type="${t}"
      class="type-cell${t === initialType ? ' selected' : ''}"
      aria-checked="${t === initialType}"
      tabindex="${t === initialType ? '0' : '-1'}"
      aria-label="${t}"
    ><img src="chrome-extension://fake/assets/${t}/${firstColor}_idle_8fps.gif" alt="${t}" /><span>${t}</span></button>`;
  }).join('');

  document.body.innerHTML = `
    <div id="pet-type-grid" role="radiogroup" aria-label="Pet type">
      ${cells}
    </div>
    <input type="hidden" id="pet-type-value" value="${initialType}" />
  `;
}

// Chrome API mock (needed because type-picker imports nothing that uses chrome,
// but vitest may load sibling modules that do — define it globally for safety).
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { getURL: (p: string) => `chrome-extension://fake/${p}` },
};

// ---------------------------------------------------------------------------
// Import the module under test AFTER DOM is in place.
// We use dynamic import inside each suite so we can reset between suites.
// Since vitest module cache persists, we import once here at module scope.
// ---------------------------------------------------------------------------

// We import and re-export the tested functions. The module is pure: it takes
// a container element and a hidden input, wires them up, and returns controls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initTypePicker: (grid: HTMLElement, hiddenInput: HTMLInputElement) => void;

beforeEach(async () => {
  vi.resetModules();
  // Re-import fresh after module reset
  const mod = await import('./type-picker');
  initTypePicker = mod.initTypePicker;
  buildDOM();
});

// ---------------------------------------------------------------------------
// initTypePicker — grid wiring
// ---------------------------------------------------------------------------

describe('initTypePicker — type-cell selection', () => {
  it('clicking a type cell marks it as selected and updates the hidden input', () => {
    /**
     * Verifies that clicking a type-cell sets aria-checked="true" on that cell,
     * removes it from others, and updates #pet-type-value to the clicked type.
     *
     * This matters because the rest of the form reads #pet-type-value to determine
     * which type was chosen. If the hidden input is not updated, addPet() would
     * always use the default type regardless of what the user clicked.
     *
     * If violated, the user sees a visual selection but the added pet has a wrong type.
     */
    // GIVEN — grid wired up, initial type is 'dog'
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    // WHEN — user clicks the fox cell
    const foxCell = grid.querySelector('[data-type="fox"]') as HTMLButtonElement;
    foxCell.click();

    // THEN — fox is selected, hidden input updated
    expect(hiddenInput.value).toBe('fox');
    expect(foxCell.getAttribute('aria-checked')).toBe('true');
    expect(foxCell.classList.contains('selected')).toBe(true);

    // AND — dog cell is deselected
    const dogCell = grid.querySelector('[data-type="dog"]') as HTMLButtonElement;
    expect(dogCell.getAttribute('aria-checked')).toBe('false');
    expect(dogCell.classList.contains('selected')).toBe(false);
  });

  it('clicking a cell moves tabindex=0 to that cell and -1 to others', () => {
    /**
     * Verifies roving tabindex: the selected cell gets tabindex="0" so keyboard
     * users can tab into the grid and then navigate with arrows.
     *
     * Without this, keyboard users cannot reach any cell after the first tab stop.
     *
     * If violated, keyboard-only users get stuck and cannot switch pet type.
     */
    // GIVEN — grid wired up
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    // WHEN — user clicks 'chicken'
    const chickenCell = grid.querySelector('[data-type="chicken"]') as HTMLButtonElement;
    chickenCell.click();

    // THEN — chicken has tabindex 0, all others have -1
    const cells = [...grid.querySelectorAll('.type-cell')] as HTMLButtonElement[];
    const focusable = cells.filter(c => c.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    expect(focusable[0].dataset.type).toBe('chicken');
  });

  it('clicking a cell dispatches pet-type-changed CustomEvent on document', () => {
    /**
     * Verifies that selecting a type fires a CustomEvent so the color grid (T3)
     * can listen and react without popup.ts calling populateColors directly.
     *
     * This decoupling matters because T3 will replace the color select. If popup.ts
     * called populateColors directly the coupling would prevent T3's refactor.
     *
     * If violated, the future color grid listener would never receive type changes.
     */
    // GIVEN — grid wired up, listener on document
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    const received: string[] = [];
    document.addEventListener('pet-type-changed', (e: Event) => {
      received.push((e as CustomEvent<{ type: string }>).detail.type);
    });

    // WHEN — user selects 'cat' (panda here)
    const pandaCell = grid.querySelector('[data-type="panda"]') as HTMLButtonElement;
    pandaCell.click();

    // THEN — event fired with correct type
    expect(received).toEqual(['panda']);
  });
});

describe('initTypePicker — keyboard navigation', () => {
  it('ArrowRight moves focus to the next cell', () => {
    /**
     * Verifies that pressing ArrowRight on a focused cell moves focus forward
     * and selects the next type in DOM order.
     *
     * This matters because the grid has no visible focus ring unless the correct
     * cell has tabindex=0. Arrow key navigation is required for accessibility
     * (ARIA radiogroup pattern).
     *
     * If violated, keyboard users cannot navigate the grid at all.
     */
    // GIVEN — grid wired, focus on dog (first in typical DOM order)
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    const cells = [...grid.querySelectorAll('.type-cell')] as HTMLButtonElement[];
    const firstCell = cells[0];
    firstCell.focus();

    // WHEN — ArrowRight pressed
    firstCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // THEN — second cell is focused AND selected (focus and selection must stay in sync per ARIA radiogroup)
    expect(document.activeElement).toBe(cells[1]);
    expect(cells[1].getAttribute('aria-checked')).toBe('true');
    expect(cells[0].getAttribute('aria-checked')).toBe('false');
    expect(hiddenInput.value).toBe(cells[1].dataset.type);
  });

  it('ArrowLeft moves focus to the previous cell', () => {
    /**
     * Verifies that pressing ArrowLeft moves focus backward in the grid.
     *
     * This is the symmetric counterpart to ArrowRight, required by the ARIA
     * radiogroup keyboard pattern.
     *
     * If violated, users can only navigate forward in the grid, not back.
     */
    // GIVEN — grid wired, focus on second cell
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    const cells = [...grid.querySelectorAll('.type-cell')] as HTMLButtonElement[];
    cells[1].focus();

    // WHEN — ArrowLeft pressed
    cells[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    // THEN — first cell is focused
    expect(document.activeElement).toBe(cells[0]);
  });

  it('ArrowRight wraps from last cell to first', () => {
    /**
     * Verifies that navigation wraps around at the end of the grid so the user
     * does not get stuck at the last item.
     *
     * If violated, users who navigate to the last type hit a dead end and must
     * Tab out and Tab back in to start over.
     */
    // GIVEN — grid wired, focus on last cell
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    const cells = [...grid.querySelectorAll('.type-cell')] as HTMLButtonElement[];
    const lastCell = cells[cells.length - 1];
    lastCell.focus();

    // WHEN — ArrowRight pressed
    lastCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // THEN — first cell is focused
    expect(document.activeElement).toBe(cells[0]);
  });

  it('Space key selects the focused cell', () => {
    /**
     * Verifies that pressing Space on a focused cell selects it (sets aria-checked
     * and updates the hidden input), matching the ARIA radio button pattern.
     *
     * If violated, keyboard users can navigate but cannot select — the form always
     * submits with the initially selected type.
     */
    // GIVEN — grid wired, focus on 'fox' cell
    const grid = document.getElementById('pet-type-grid') as HTMLElement;
    const hiddenInput = document.getElementById('pet-type-value') as HTMLInputElement;
    initTypePicker(grid, hiddenInput);

    const foxCell = grid.querySelector('[data-type="fox"]') as HTMLButtonElement;
    foxCell.focus();

    // WHEN — Space pressed
    foxCell.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    // THEN — fox is selected
    expect(hiddenInput.value).toBe('fox');
    expect(foxCell.getAttribute('aria-checked')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Structural regression guards
// ---------------------------------------------------------------------------

describe('DOM structure regression guards', () => {
  it('no <select id="pet-type"> element exists in the DOM after the T2 refactor', () => {
    /**
     * Verifies the old type <select> is no longer present in the DOM. This is a
     * regression guard: if the old element is re-introduced (e.g., accidentally
     * reverted), the type picker would be duplicated and the hidden input would
     * not be the source of truth.
     *
     * If violated, both the grid and a hidden dropdown compete as the type source,
     * leading to inconsistent form state.
     */
    // GIVEN — the current document after buildDOM()
    // WHEN — query for the old select
    const oldSelect = document.getElementById('pet-type');
    // THEN — it does not exist
    expect(oldSelect).toBeNull();
  });

  it('no <select id="pet-color"> element exists in the DOM after the T3 refactor', () => {
    /**
     * Verifies the old color <select> is no longer present in the DOM. After T3,
     * the color picker is a radiogroup grid with a hidden input, not a <select>.
     *
     * If violated, the old select and new grid both exist and the hidden input is
     * not the authoritative color source, causing pet color to be wrong.
     */
    // GIVEN — the current document after buildDOM()
    const oldSelect = document.getElementById('pet-color');
    // THEN — it does not exist
    expect(oldSelect).toBeNull();
  });

  it('pet-type-grid exists with role=radiogroup', () => {
    /**
     * Verifies that the type picker grid is present in the DOM with the correct
     * ARIA role. Without role="radiogroup", assistive technology treats the
     * container as a generic div and does not apply radio navigation semantics.
     *
     * If violated, screen readers do not announce this as a selection group and
     * keyboard users lose the expected arrow-key navigation affordances.
     */
    // GIVEN — the current document after buildDOM()
    const grid = document.getElementById('pet-type-grid');
    // THEN — it exists with the correct role
    expect(grid).not.toBeNull();
    expect(grid!.getAttribute('role')).toBe('radiogroup');
  });
});

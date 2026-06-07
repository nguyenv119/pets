import type { PetType } from '../types';
import { COLORS } from './colors';

// ---------------------------------------------------------------------------
// Type picker — radiogroup grid of pet-type cells
// ---------------------------------------------------------------------------

/**
 * Wire up the #pet-type-grid radiogroup.
 *
 * - Clicking a cell: updates aria-checked, .selected, tabindex, hidden input,
 *   and dispatches CustomEvent('pet-type-changed', {detail:{type}}) on document.
 * - Arrow keys (Left/Right/Up/Down): roving-tabindex navigation, wraps around.
 * - Space / Enter: selects the currently focused cell.
 *
 * This function is pure side-effect: it adds event listeners to the grid and
 * returns nothing. The hidden input is the authoritative source of the selected
 * type for the rest of the form.
 */
export function initTypePicker(grid: HTMLElement, hiddenInput: HTMLInputElement): void {
  function cells(): HTMLButtonElement[] {
    return [...grid.querySelectorAll<HTMLButtonElement>('.type-cell')];
  }

  function selectCell(cell: HTMLButtonElement): void {
    const allCells = cells();
    for (const c of allCells) {
      c.setAttribute('aria-checked', 'false');
      c.classList.remove('selected');
      c.tabIndex = -1;
    }
    cell.setAttribute('aria-checked', 'true');
    cell.classList.add('selected');
    cell.tabIndex = 0;

    const type = cell.dataset.type;
    if (!type) return;
    hiddenInput.value = type;

    document.dispatchEvent(new CustomEvent<{ type: PetType }>('pet-type-changed', { detail: { type: type as PetType } }));
  }

  grid.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.type-cell');
    if (!target) return;
    selectCell(target);
  });

  grid.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLButtonElement>('.type-cell');
    if (!cell) return;

    const allCells = cells();
    const idx = allCells.indexOf(cell);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = allCells[(idx + 1) % allCells.length];
      selectCell(next);
      next.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = allCells[(idx - 1 + allCells.length) % allCells.length];
      selectCell(prev);
      prev.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      selectCell(cell);
    }
  });
}

// ---------------------------------------------------------------------------
// populateColors — reads type from hidden input (not a <select>)
// ---------------------------------------------------------------------------

/**
 * Populate the color <select> based on the current pet type stored in the
 * hidden input. Called on init and whenever the type changes.
 */
export function populateColors(colorSelect: HTMLSelectElement, hiddenInput: HTMLInputElement): void {
  const type = hiddenInput.value as PetType;
  const colors = COLORS[type] ?? [];
  colorSelect.innerHTML = colors.map(c =>
    `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');
}

// ---------------------------------------------------------------------------
// buildTypePickerHTML — generates the inner HTML for the radiogroup
// ---------------------------------------------------------------------------

const PET_LABELS: Record<PetType, string> = {
  chicken:   '🐔 Chicken',
  cockatiel: '🦜 Cockatiel',
  crab:      '🦀 Crab',
  dog:       '🐕 Dog',
  fox:       '🦊 Fox',
  horse:     '🐴 Horse',
  miffy:     '🐰 Miffy',
  monkey:    '🐒 Monkey',
  panda:     '🐼 Panda',
  rat:       '🐀 Rat',
  snail:     '🐌 Snail',
  snake:     '🐍 Snake',
  totoro:    '🌳 Totoro',
  turtle:    '🐢 Turtle',
};

/**
 * Generate the inner HTML for the type-picker radiogroup.
 * Uses chrome.runtime.getURL for asset paths.
 */
export function buildTypePickerHTML(selectedType: PetType, getURL: (path: string) => string): string {
  const types = Object.keys(COLORS) as PetType[];
  return types.map(t => {
    const firstColor = COLORS[t][0];
    const src = getURL(`assets/${t}/${firstColor}_idle_8fps.gif`);
    const isSelected = t === selectedType;
    const label = PET_LABELS[t] ?? t;
    return `<button
      role="radio"
      data-type="${t}"
      class="type-cell${isSelected ? ' selected' : ''}"
      aria-checked="${isSelected}"
      tabindex="${isSelected ? '0' : '-1'}"
      aria-label="${label}"
    ><img src="${src}" alt="${t}" /><span>${label.replace(/^\S+\s/, '')}</span></button>`;
  }).join('');
}

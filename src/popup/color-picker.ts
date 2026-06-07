import type { PetType } from '../types';
import { COLORS } from './colors';

// ---------------------------------------------------------------------------
// Color picker — radiogroup grid of per-color mini idle gif buttons
// ---------------------------------------------------------------------------

/**
 * Render (or re-render) the color radiogroup grid for the given pet type.
 *
 * - Clears the grid and inserts one <button role="radio"> per color.
 * - Each button shows the pet's idle gif for that color.
 * - The first color is auto-selected; the hidden input is set to it.
 *
 * @param type       Pet type whose color palette to render.
 * @param grid       The <div id="pet-color-grid"> container element.
 * @param hiddenInput The <input type="hidden" id="pet-color-value"> element.
 * @param getURL     chrome.runtime.getURL (or any path resolver).
 */
export function renderColorGrid(
  type: PetType,
  grid: HTMLElement,
  hiddenInput: HTMLInputElement,
  getURL: (path: string) => string,
): void {
  const colors = COLORS[type] ?? [];
  grid.innerHTML = colors.map((color, i) => {
    const src = getURL(`assets/${type}/${color}_idle_8fps.gif`);
    const selected = i === 0;
    return `<button
      role="radio"
      class="color-cell${selected ? ' selected' : ''}"
      data-color="${color}"
      aria-checked="${selected}"
      tabindex="${selected ? '0' : '-1'}"
      title="${color}"
    ><img src="${src}" alt="${color}" /></button>`;
  }).join('');

  // Auto-select first color
  if (colors.length > 0) {
    hiddenInput.value = colors[0];
  }
}

/**
 * Wire up the color radiogroup grid with click + keyboard interaction.
 *
 * - Click / Space / Enter: select the target color cell.
 * - ArrowRight / ArrowDown: move to next cell (wraps).
 * - ArrowLeft / ArrowUp: move to previous cell (wraps).
 * - Listens for CustomEvent('pet-type-changed') on document and re-renders
 *   the grid for the new type.
 *
 * Call this AFTER renderColorGrid so cells are already in the DOM.
 *
 * @param grid       The <div id="pet-color-grid"> container element.
 * @param hiddenInput The <input type="hidden" id="pet-color-value"> element.
 * @param getURL     chrome.runtime.getURL — needed to re-render on type change.
 */
export function initColorPicker(
  grid: HTMLElement,
  hiddenInput: HTMLInputElement,
  getURL: (path: string) => string,
): void {
  function cells(): HTMLButtonElement[] {
    return [...grid.querySelectorAll<HTMLButtonElement>('.color-cell')];
  }

  function selectCell(cell: HTMLButtonElement): void {
    for (const c of cells()) {
      c.setAttribute('aria-checked', 'false');
      c.classList.remove('selected');
      c.tabIndex = -1;
    }
    cell.setAttribute('aria-checked', 'true');
    cell.classList.add('selected');
    cell.tabIndex = 0;

    const color = cell.dataset.color;
    if (color) hiddenInput.value = color;
  }

  grid.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.color-cell');
    if (!target) return;
    selectCell(target);
  });

  grid.addEventListener('keydown', (e: KeyboardEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.color-cell');
    if (!cell) return;

    const all = cells();
    const idx = all.indexOf(cell);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = all[(idx + 1) % all.length];
      selectCell(next);
      next.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = all[(idx - 1 + all.length) % all.length];
      selectCell(prev);
      prev.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      selectCell(cell);
    }
  });

  // Re-render color grid when the type changes
  document.addEventListener('pet-type-changed', (e: Event) => {
    const type = (e as CustomEvent<{ type: PetType }>).detail.type;
    renderColorGrid(type, grid, hiddenInput, getURL);
  });
}

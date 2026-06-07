import type { PetData } from '../types';

/** Eye SVG for visible state */
const EYE_OPEN_SVG = `<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
  <path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z"/>
  <circle cx="8" cy="8" r="2.5"/>
</svg>`;

/** Eye-slash SVG for hidden state */
const EYE_SLASH_SVG = `<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
  <path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z"/>
  <circle cx="8" cy="8" r="2.5"/>
  <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

/**
 * Returns the HTML string for a single pet list row.
 * Pure function — no side effects — so it can be unit-tested without DOM setup.
 */
export function renderPetItemHTML(pet: PetData): string {
  const isHidden = pet.hidden === true;
  const hideTitle = isHidden ? `Show ${pet.name}` : `Hide ${pet.name}`;
  const dimClass = isHidden ? ' btn-hide--dimmed' : '';

  return `
    <div class="pet-item" data-id="${pet.id}">
      <div class="pet-info">
        <img src="${chrome.runtime.getURL(`assets/${pet.type}/${pet.color}_idle_8fps.gif`)}" alt="${pet.name}" />
        <div>
          <div class="pet-name">${pet.name}</div>
          <div class="pet-meta">${pet.color} ${pet.type}</div>
        </div>
      </div>
      <button class="btn-hide${dimClass}" data-id="${pet.id}" aria-pressed="${isHidden}" title="${hideTitle}">
        ${isHidden ? EYE_SLASH_SVG : EYE_OPEN_SVG}
      </button>
      <button class="btn-remove" title="Remove ${pet.name}">&times;</button>
    </div>
  `;
}

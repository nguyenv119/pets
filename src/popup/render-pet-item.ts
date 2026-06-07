import type { PetData } from '../types';

/**
 * Returns the HTML string for a single pet list row.
 * Pure function — no side effects — so it can be unit-tested without DOM setup.
 */
export function renderPetItemHTML(pet: PetData): string {
  const isHidden = pet.hidden === true;
  const hideTitle = isHidden ? `Show ${pet.name}` : `Hide ${pet.name}`;
  const dimClass = isHidden ? ' btn-hide--dimmed' : '';
  const eyeEmoji = isHidden ? '🙈' : '👁️';

  return `
    <div class="pet-item" data-id="${pet.id}">
      <div class="pet-info">
        <img src="${chrome.runtime.getURL(`assets/${pet.type}/${pet.color}_idle_8fps.gif`)}" alt="${pet.name}" />
        <div>
          <div class="pet-name">${pet.name}</div>
          <div class="pet-meta">${pet.color} ${pet.type}</div>
        </div>
      </div>
      <div class="pet-actions">
        <button class="btn-hide${dimClass}" data-id="${pet.id}" aria-pressed="${isHidden}" title="${hideTitle}">
          <span aria-hidden="true">${eyeEmoji}</span>
        </button>
        <button class="btn-remove" title="Remove ${pet.name}">&times;</button>
      </div>
    </div>
  `;
}

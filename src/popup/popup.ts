import type { PetData, PetType, ExtMessage } from '../types';
import { loadPetData, savePets } from '../store';

// ---------------------------------------------------------------------------
// Color options per pet type
// ---------------------------------------------------------------------------

const COLORS: Record<PetType, string[]> = {
  dog: ['brown', 'black'],
  fox: ['red', 'white'],
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const petsList = document.getElementById('pets-list')!;
const nameInput = document.getElementById('pet-name') as HTMLInputElement;
const typeSelect = document.getElementById('pet-type') as HTMLSelectElement;
const colorSelect = document.getElementById('pet-color') as HTMLSelectElement;
const btnAdd = document.getElementById('btn-add')!;
const btnThrowBall = document.getElementById('btn-throw-ball')!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pets: PetData[] = [];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderPetList(): void {
  if (pets.length === 0) {
    petsList.innerHTML = '<div class="empty-state">No pets yet. Add one below!</div>';
    return;
  }

  petsList.innerHTML = pets.map(pet => `
    <div class="pet-item" data-id="${pet.id}">
      <div class="pet-info">
        <img src="${chrome.runtime.getURL(`assets/${pet.type}/${pet.color}_idle_8fps.gif`)}" alt="${pet.name}" />
        <span>${pet.name} <small>(${pet.type})</small></span>
      </div>
      <button class="btn-remove" title="Remove ${pet.name}">&times;</button>
    </div>
  `).join('');

  // Wire remove buttons
  petsList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.pet-item') as HTMLElement;
      const id = item.dataset.id!;
      removePet(id);
    });
  });
}

function populateColors(): void {
  const type = typeSelect.value as PetType;
  const colors = COLORS[type] || [];
  colorSelect.innerHTML = colors.map(c =>
    `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function addPet(): Promise<void> {
  const name = nameInput.value.trim() || 'Pet';
  const type = typeSelect.value as PetType;
  const color = colorSelect.value;

  const pet: PetData = {
    id: crypto.randomUUID(),
    name,
    type,
    color,
    x: Math.random() * 800,
    y: 0, // will be set by content script
  };

  pets.push(pet);
  await savePets(pets);
  renderPetList();

  // Notify content scripts
  const msg: ExtMessage = { type: 'ADD_PET', pet };
  chrome.runtime.sendMessage(msg);

  // Reset form
  nameInput.value = '';
}

async function removePet(id: string): Promise<void> {
  pets = pets.filter(p => p.id !== id);
  await savePets(pets);
  renderPetList();

  // Notify content scripts
  const msg: ExtMessage = { type: 'REMOVE_PET', id };
  chrome.runtime.sendMessage(msg);
}

function throwBall(): void {
  const msg: ExtMessage = { type: 'THROW_BALL' };
  chrome.runtime.sendMessage(msg);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

typeSelect.addEventListener('change', populateColors);
btnAdd.addEventListener('click', addPet);
btnThrowBall.addEventListener('click', throwBall);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  populateColors();
  pets = await loadPetData();
  renderPetList();
}

init();

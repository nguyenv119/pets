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
const btnToggle = document.getElementById('btn-toggle')!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pets: PetData[] = [];
let petsVisible = true;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderPetList(): void {
  if (pets.length === 0) {
    petsList.innerHTML = `
      <div class="empty-state">
        <img src="${chrome.runtime.getURL('assets/dog/brown_walk_8fps.gif')}" class="empty-pet" alt="" />
        <p class="empty-title">It's quiet here...</p>
        <p class="empty-cta">Adopt your first friend below!</p>
      </div>
    `;
    return;
  }

  petsList.innerHTML = pets.map(pet => `
    <div class="pet-item" data-id="${pet.id}">
      <div class="pet-info">
        <img src="${chrome.runtime.getURL(`assets/${pet.type}/${pet.color}_idle_8fps.gif`)}" alt="${pet.name}" />
        <div>
          <div class="pet-name">${pet.name}</div>
          <div class="pet-meta">${pet.color} ${pet.type}</div>
        </div>
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
  const colors = COLORS[type] ?? [];
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

  if (!color) return; // guard against empty color

  const pet: PetData = {
    id: crypto.randomUUID(),
    name,
    type,
    color,
    x: Math.random() * 800,
    y: 0, // set by content script
  };

  pets.push(pet);
  await savePets(pets);
  renderPetList();

  // Notify content scripts via service worker
  const msg: ExtMessage = { type: 'ADD_PET', pet };
  chrome.runtime.sendMessage(msg);

  // Reset form
  nameInput.value = '';
}

async function removePet(id: string): Promise<void> {
  pets = pets.filter(p => p.id !== id);
  await savePets(pets);
  renderPetList();

  const msg: ExtMessage = { type: 'REMOVE_PET', id };
  chrome.runtime.sendMessage(msg);
}

function throwBall(): void {
  const msg: ExtMessage = { type: 'THROW_BALL' };
  chrome.runtime.sendMessage(msg);
}

function toggleVisibility(): void {
  petsVisible = !petsVisible;
  const msg: ExtMessage = { type: 'TOGGLE_VISIBILITY', visible: petsVisible };
  chrome.runtime.sendMessage(msg);

  // Update button appearance
  if (petsVisible) {
    btnToggle.classList.remove('hidden-state');
    btnToggle.title = 'Hide pets';
  } else {
    btnToggle.classList.add('hidden-state');
    btnToggle.title = 'Show pets';
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

typeSelect.addEventListener('change', populateColors);
btnAdd.addEventListener('click', addPet);
btnThrowBall.addEventListener('click', throwBall);
btnToggle.addEventListener('click', toggleVisibility);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  populateColors(); // must run before any await so colors appear immediately

  // Load visibility preference
  const visResult = await chrome.storage.local.get('pixel-pets-visible');
  if (visResult['pixel-pets-visible'] === false) {
    petsVisible = false;
    btnToggle.classList.add('hidden-state');
    btnToggle.title = 'Show pets';
  }

  pets = await loadPetData();
  renderPetList();
}

init();

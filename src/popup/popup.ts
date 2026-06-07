import type { PetData, PetType, ExtMessage } from '../types';
import type { Theme } from '../settings';
import { loadPetData, savePets } from '../store';
import { pingTab } from './tab-probe';
import { renderPetItemHTML } from './render-pet-item';
import { initTypePicker, buildTypePickerHTML } from './type-picker';
import { renderColorGrid, initColorPicker } from './color-picker';
import { applyTheme, loadTheme, toggleTheme } from './theme';
import { setAddFormExpanded, isAddFormExpanded } from './collapsible-form';
import { showToast } from './toast';
import { renderTreatCounter } from './treat-counter';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const petsList = document.getElementById('pets-list')!;
const treatCountEl = document.getElementById('treat-count');
const treatNextEl = document.getElementById('treat-next');
const nameInput = document.getElementById('pet-name') as HTMLInputElement;
const typeGrid = document.getElementById('pet-type-grid') as HTMLElement;
const typeHidden = document.getElementById('pet-type-value') as HTMLInputElement;
const colorGrid = document.getElementById('pet-color-grid') as HTMLElement;
const colorHidden = document.getElementById('pet-color-value') as HTMLInputElement;
const btnAdd = document.getElementById('btn-add')!;
const btnThrowBall = document.getElementById('btn-throw-ball') as HTMLButtonElement;
const btnToggle = document.getElementById('btn-toggle')!;
const btnTheme = document.getElementById('btn-theme')!;
const btnAddToggle = document.getElementById('btn-add-toggle')!;
const specialPageBanner = document.getElementById('special-page-banner')!;

// ---------------------------------------------------------------------------
// Treat counter — wired to DOM elements; logic lives in treat-counter.ts
// ---------------------------------------------------------------------------

function renderTreatCounterInPopup(): Promise<void> {
  return renderTreatCounter(treatCountEl, treatNextEl);
}

// Listen for storage changes so the counter updates when a treat is consumed
// from any content script without requiring a popup close/reopen.
chrome.storage.onChanged.addListener((changes) => {
  if ('pixel-pets-settings-v1' in changes) {
    renderTreatCounterInPopup();
  }
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pets: PetData[] = [];
let petsVisible = true;
let currentTheme: Theme = 'light';

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

  petsList.innerHTML = pets.map(pet => renderPetItemHTML(pet)).join('');

  // Wire hide buttons
  petsList.querySelectorAll('.btn-hide').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.pet-item') as HTMLElement;
      const id = item.dataset.id!;
      togglePetHidden(id);
    });
  });

  // Wire remove buttons
  petsList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.pet-item') as HTMLElement;
      const id = item.dataset.id!;
      removePet(id);
    });
  });

}

// ---------------------------------------------------------------------------
// Drag-and-drop reorder
// ---------------------------------------------------------------------------

function getItemAtY(y: number): HTMLElement | null {
  const items = Array.from(petsList.querySelectorAll<HTMLElement>('.pet-item'));
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) return item;
  }
  return null;
}

function clearDropClasses(): void {
  petsList.querySelectorAll<HTMLElement>('.pet-item').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function initDragAndDrop(): void {
  petsList.addEventListener('dragstart', (e: DragEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.pet-item');
    if (!item) return;
    e.dataTransfer!.setData('text/plain', item.dataset.id!);
    e.dataTransfer!.effectAllowed = 'move';
    // defer so the drag image captures the normal state
    setTimeout(() => item.classList.add('dragging'), 0);
  });

  petsList.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    clearDropClasses();
    const hovered = getItemAtY(e.clientY);
    if (!hovered) return;
    const rect = hovered.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      hovered.classList.add('drop-before');
    } else {
      hovered.classList.add('drop-after');
    }
  });

  petsList.addEventListener('dragleave', (e: DragEvent) => {
    // Only clear if leaving the entire list
    if (!petsList.contains(e.relatedTarget as Node)) {
      clearDropClasses();
    }
  });

  petsList.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    clearDropClasses();
    petsList.querySelectorAll<HTMLElement>('.pet-item').forEach(el => el.classList.remove('dragging'));

    const draggedId = e.dataTransfer!.getData('text/plain');
    const hovered = getItemAtY(e.clientY);
    if (!hovered) return;
    const targetId = hovered.dataset.id!;
    if (draggedId === targetId) return;

    const draggedIdx = pets.findIndex(p => p.id === draggedId);
    const targetIdx = pets.findIndex(p => p.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    // Determine insert position: before or after target
    const rect = hovered.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertAfter = e.clientY >= midY;

    // Splice dragged item out then insert at new position
    const [dragged] = pets.splice(draggedIdx, 1);
    const newTargetIdx = pets.findIndex(p => p.id === targetId);
    pets.splice(insertAfter ? newTargetIdx + 1 : newTargetIdx, 0, dragged);

    await savePets(pets);
    renderPetList();

    const msg: ExtMessage = { type: 'PETS_REORDERED', pets: [...pets] };
    chrome.runtime.sendMessage(msg);
  });

  petsList.addEventListener('dragend', () => {
    clearDropClasses();
    petsList.querySelectorAll<HTMLElement>('.pet-item').forEach(el => el.classList.remove('dragging'));
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function addPet(): Promise<void> {
  const name = nameInput.value.trim() || 'Pet';
  const type = typeHidden.value as PetType;
  const color = colorHidden.value;

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

  // Reset form and collapse
  nameInput.value = '';
  setAddFormExpanded(false);
}

async function togglePetHidden(id: string): Promise<void> {
  const pet = pets.find(p => p.id === id);
  if (!pet) return;
  pet.hidden = !pet.hidden;
  await savePets(pets);
  renderPetList();

  const msg: ExtMessage = { type: 'SET_PET_HIDDEN', id, hidden: pet.hidden };
  chrome.runtime.sendMessage(msg);
}

async function removePet(id: string): Promise<void> {
  const originalIndex = pets.findIndex(p => p.id === id);
  if (originalIndex === -1) return;

  const pet = pets[originalIndex];

  // Optimistically remove from local state and re-render immediately.
  pets = pets.filter(p => p.id !== id);
  renderPetList();

  // Tell SW to schedule the deferred removal (storage write + broadcast).
  const pendingMsg: ExtMessage = { type: 'PENDING_REMOVE_PET', id, delayMs: 5000 };
  chrome.runtime.sendMessage(pendingMsg);

  // Show undo toast; await result to know if user clicked Undo.
  const undone = await showToast({ message: `${pet.name} removed`, actionLabel: 'Undo', duration: 5000 });

  if (undone) {
    // Re-insert at original position and tell SW to cancel.
    pets.splice(originalIndex, 0, pet);
    renderPetList();
    const cancelMsg: ExtMessage = { type: 'CANCEL_PENDING_REMOVE', id };
    chrome.runtime.sendMessage(cancelMsg);
  }
  // If not undone, SW already handles storage + REMOVE_PET broadcast on timeout.
}

function throwBall(): void {
  const msg: ExtMessage = { type: 'THROW_BALL' };
  chrome.runtime.sendMessage(msg);
}

async function handleThemeToggle(): Promise<void> {
  currentTheme = await toggleTheme(currentTheme);
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

btnAdd.addEventListener('click', addPet);
btnAddToggle.addEventListener('click', () => {
  setAddFormExpanded(!isAddFormExpanded());
});
btnThrowBall.addEventListener('click', throwBall);
btnToggle.addEventListener('click', toggleVisibility);
btnTheme.addEventListener('click', handleThemeToggle);

// ---------------------------------------------------------------------------
// Special-page detection
// ---------------------------------------------------------------------------

function showSpecialPageBanner(): void {
  specialPageBanner.removeAttribute('hidden');
  btnThrowBall.disabled = true;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // Render type picker grid before any await so it appears immediately
  typeGrid.innerHTML = buildTypePickerHTML(typeHidden.value as PetType, chrome.runtime.getURL);
  initTypePicker(typeGrid, typeHidden);
  renderColorGrid(typeHidden.value as PetType, colorGrid, colorHidden, chrome.runtime.getURL);
  initColorPicker(colorGrid, colorHidden, chrome.runtime.getURL);

  // Load and apply persisted theme (inline <head> script also does this
  // but may lose the race against the first paint; this ensures correctness)
  currentTheme = await loadTheme();
  applyTheme(currentTheme);

  // Load visibility preference
  const visResult = await chrome.storage.local.get('pixel-pets-visible');
  if (visResult['pixel-pets-visible'] === false) {
    petsVisible = false;
    btnToggle.classList.add('hidden-state');
    btnToggle.title = 'Show pets';
  }

  pets = await loadPetData();
  renderPetList();
  initDragAndDrop();
  setAddFormExpanded(pets.length === 0);

  await renderTreatCounterInPopup();

  // Probe whether the content script is alive on the active tab.
  // If not (special browser page), show the banner and disable Throw Ball.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const alive = tab?.id != null && await pingTab(tab.id);
  if (!alive) showSpecialPageBanner();
}

init();

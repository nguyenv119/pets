import type { PetData } from './types';

const KEY = 'pixel-pets-v1';

export function savePets(pets: { toData(): PetData }[]): void {
  localStorage.setItem(KEY, JSON.stringify(pets.map(p => p.toData())));
}

export function loadPetData(): PetData[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PetData[]) : [];
  } catch { return []; }
}

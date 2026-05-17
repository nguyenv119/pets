import type { PetData } from './types';

const KEY = 'pixel-pets-v1';

/** Save pets to chrome.storage.local */
export async function savePets(pets: PetData[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: pets });
}

/** Load pets from chrome.storage.local */
export async function loadPetData(): Promise<PetData[]> {
  try {
    const result = await chrome.storage.local.get(KEY);
    const data: unknown = result[KEY];
    return Array.isArray(data) ? (data as PetData[]) : [];
  } catch {
    return [];
  }
}

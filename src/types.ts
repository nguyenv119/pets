export type PetState = 'sitIdle' | 'walkLeft' | 'walkRight' | 'sleep' | 'chase' | 'idleWithBall' | 'eat';
export type PetType = 'chicken' | 'crab' | 'dog' | 'fox' | 'miffy' | 'monkey' | 'panda' | 'snail' | 'totoro' | 'turtle';

export interface PetData {
  id: string;
  name: string;
  type: PetType;
  color: string;
  x: number;
  y: number;
}

// Extension messaging types (popup ↔ service worker ↔ content script)
export type ExtMessage =
  | { type: 'ADD_PET'; pet: PetData }
  | { type: 'REMOVE_PET'; id: string }
  | { type: 'THROW_BALL' }
  | { type: 'TOGGLE_VISIBILITY'; visible: boolean }
  | { type: 'PETS_UPDATED'; pets: PetData[] };

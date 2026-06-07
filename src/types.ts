export type PetState = 'sitIdle' | 'walkLeft' | 'walkRight' | 'sleep' | 'chase' | 'idleWithBall' | 'eat';
export type PetType = 'chicken' | 'cockatiel' | 'crab' | 'dog' | 'fox' | 'horse' | 'miffy' | 'monkey' | 'panda' | 'rat' | 'snail' | 'snake' | 'totoro' | 'turtle';

export interface PetData {
  id: string;
  name: string;
  type: PetType;
  color: string;
  x: number;
  y: number;
  hidden?: boolean;
}

// Extension messaging types (popup ↔ service worker ↔ content script)
export type ExtMessage =
  | { type: 'ADD_PET'; pet: PetData }
  | { type: 'REMOVE_PET'; id: string }
  | { type: 'SET_PET_HIDDEN'; id: string; hidden: boolean }
  | { type: 'THROW_BALL' }
  | { type: 'TOGGLE_VISIBILITY'; visible: boolean }
  | { type: 'PETS_UPDATED'; pets: PetData[] }
  | { type: 'PETS_REORDERED'; pets: PetData[] }
  | { type: 'PING' };

import type { PetType } from '../types';

/** Color options per pet type. */
export const COLORS: Record<PetType, string[]> = {
  chicken: ['brown', 'white'],
  crab:    ['red'],
  dog:     ['akita', 'black', 'brown', 'red', 'white'],
  fox:     ['red', 'white'],
  monkey:  ['gray'],
  panda:   ['black', 'brown'],
  rabbit:  ['white'],
  snail:   ['brown'],
  totoro:  ['gray'],
  turtle:  ['green', 'orange'],
};

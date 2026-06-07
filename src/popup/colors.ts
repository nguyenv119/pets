import type { PetType } from '../types';

/** Color options per pet type. */
export const COLORS: Record<PetType, string[]> = {
  chicken:  ['brown', 'white'],
  crab:     ['red'],
  dog:      ['akita', 'black', 'brown', 'red', 'white'],
  fox:      ['red', 'white'],
  miffy:    ['white'],
  monkey:   ['gray'],
  panda:    ['black', 'brown'],
  snail:    ['brown'],
  totoro:   ['gray'],
  turtle:   ['green', 'orange'],
  cockatiel:['brown', 'gray'],
  rat:      ['brown', 'gray', 'white'],
  snake:    ['green'],
  horse:    ['black', 'brown', 'white', 'magical', 'warrior', 'paint_beige', 'paint_black', 'paint_brown', 'socks_beige', 'socks_black', 'socks_brown'],
};

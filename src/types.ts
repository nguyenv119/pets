export type PetState = 'sitIdle' | 'walkLeft' | 'walkRight' | 'sleep' | 'chase' | 'idleWithBall' | 'eat';
export type PetType = 'dog' | 'fox';

export interface PetData {
  id: string;
  name: string;
  type: PetType;
  color: string;
  x: number;
  y: number;
}

import type { Pet } from './pet';
import type { PetState } from './types';

export const DRAW_W = 64;
export const PATH_Y_FRACTION = 0.40;

const STATE_TO_GIF: Record<PetState, string> = {
  sitIdle:     'idle',
  walkLeft:    'walk',
  walkRight:   'walk',
  sleep:       'lie',
  chase:       'run',
  idleWithBall:'with_ball',
};

export interface PetView {
  el: HTMLImageElement;
  _lastState: PetState;
}

export function createPetView(pet: Pet, container: HTMLElement): PetView {
  const d = pet.toData();
  const el = document.createElement('img');
  el.src = `assets/${d.type}/${d.color}_idle_8fps.gif`;
  el.style.cssText = [
    'position:absolute',
    `width:${DRAW_W}px`,
    'height:auto',
    'image-rendering:pixelated',
    'user-select:none',
  ].join(';');
  container.appendChild(el);
  return { el, _lastState: 'sitIdle' };
}

export function updatePetView(view: PetView, pet: Pet): void {
  const d = pet.toData();
  if (pet.state !== view._lastState) {
    view.el.src = `assets/${d.type}/${d.color}_${STATE_TO_GIF[pet.state]}_8fps.gif`;
    view._lastState = pet.state;
  }
  view.el.style.left = `${pet.x}px`;
  view.el.style.top = `${pet.y}px`;
  view.el.style.transform = pet.state === 'walkLeft' ? 'scaleX(-1)' : 'none';
}

export function removePetView(view: PetView): void {
  view.el.remove();
}

export function drawBall(ctx: CanvasRenderingContext2D, ball: { x: number; y: number }): void {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'yellow';
  ctx.fill();
}

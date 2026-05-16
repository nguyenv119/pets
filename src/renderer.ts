import type { Pet } from './pet';
import type { PetState } from './types';

export const DRAW_W = 64;

const STATE_TO_GIF: Record<PetState, string> = {
  sitIdle:     'idle',
  walkLeft:    'walk',
  walkRight:   'walk',
  sleep:       'lie',
  chase:       'run',
  idleWithBall:'idle',
  eat:         'idle',
};

/** Resolve an asset path — uses chrome.runtime.getURL in extension context */
export function getAssetURL(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

export interface PetView {
  el: HTMLImageElement;
  _lastState: PetState;
  _lastNearBall: boolean;
}

export function createPetView(pet: Pet, container: HTMLElement): PetView {
  const d = pet.toData();
  const el = document.createElement('img');
  el.src = getAssetURL(`assets/${d.type}/${d.color}_idle_8fps.gif`);
  el.style.cssText = [
    'position:absolute',
    `width:${DRAW_W}px`,
    'height:auto',
    'image-rendering:pixelated',
    'user-select:none',
  ].join(';');
  container.appendChild(el);
  return { el, _lastState: 'sitIdle', _lastNearBall: false };
}

export function updatePetView(view: PetView, pet: Pet): void {
  const d = pet.toData();

  // When chasing but close to ball, show idle GIF instead of run-in-place
  const effectiveGif = (pet.state === 'chase' && pet.nearBall)
    ? 'idle'
    : STATE_TO_GIF[pet.state];

  if (pet.state !== view._lastState || pet.nearBall !== view._lastNearBall) {
    view.el.src = getAssetURL(`assets/${d.type}/${d.color}_${effectiveGif}_8fps.gif`);
    view._lastState = pet.state;
    view._lastNearBall = pet.nearBall;
  }
  view.el.style.left = `${pet.x}px`;
  view.el.style.top = `${pet.y}px`;
  view.el.style.transform = pet.facingLeft ? 'scaleX(-1)' : 'none';
}

export function removePetView(view: PetView): void {
  view.el.remove();
}

export function drawBall(ctx: CanvasRenderingContext2D, ball: { x: number; y: number }): void {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'yellow';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#cc9900';
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Particle system — emoji burst drawn on the canvas
// ---------------------------------------------------------------------------

export interface Particle { x: number; y: number; vy: number; alpha: number; emoji: string; }

export function spawnFeedParticle(pet: Pet): Particle {
  return { x: pet.x + DRAW_W / 2, y: pet.y, vy: -40, alpha: 1, emoji: '🍖' };
}

export function spawnLoveParticle(pet: Pet): Particle {
  return { x: pet.x + DRAW_W / 2, y: pet.y - 8, vy: -30, alpha: 1, emoji: '❤️' };
}

export function updateParticles(particles: Particle[], dt: number): void {
  for (const p of particles) { p.y += p.vy * dt; p.alpha = Math.max(0, p.alpha - dt / 1.5); }
  particles.splice(0, particles.length, ...particles.filter(p => p.alpha > 0));
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  ctx.save();
  ctx.font = '18px serif';
  ctx.textAlign = 'center';
  for (const p of particles) { ctx.globalAlpha = p.alpha; ctx.fillText(p.emoji, p.x, p.y); }
  ctx.globalAlpha = 1;
  ctx.restore();
}

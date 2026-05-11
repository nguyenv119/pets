import { Pet } from './pet';
import { createPetView, updatePetView, DRAW_W, PATH_Y_FRACTION } from './renderer';
import type { PetView } from './renderer';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const petsLayer = document.getElementById('pets-layer') as HTMLElement;

function groundY(): number { return canvas.height * PATH_Y_FRACTION; }

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 48;
  petsLayer.style.height = `${canvas.height}px`;
  document.documentElement.style.setProperty('--ground-top', `${groundY() + 64}px`);
}
resize();
window.addEventListener('resize', resize);

// Temporary hardcoded pets for visual verification — replaced in T3
const pets: Pet[] = [
  new Pet({ id: '1', name: 'Rex',     type: 'dog', color: 'brown', x: 100, y: groundY() }),
  new Pet({ id: '2', name: 'Kitsune', type: 'fox', color: 'red',   x: 400, y: groundY() }),
];

const views = new Map<Pet, PetView>();
pets.forEach(p => views.set(p, createPetView(p, petsLayer)));

let lastTime = 0;

function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  pets.forEach(p => {
    p.update(dt, null, canvas.width, DRAW_W);
    updatePetView(views.get(p)!, p);
  });

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);

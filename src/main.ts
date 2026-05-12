import { Pet } from './pet';
import { createPetView, updatePetView, DRAW_W, PATH_Y_FRACTION } from './renderer';
import type { PetView } from './renderer';
import { savePets, loadPetData } from './store';
import type { PetData } from './types';

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

function makePet(data: PetData): Pet {
  const p = new Pet(data);
  p.onTransition = () => savePets(pets);
  return p;
}

let pets: Pet[] = loadPetData().map(makePet);
if (pets.length === 0) {
  pets = [makePet({ id: crypto.randomUUID(), name: 'Rex', type: 'dog', color: 'brown', x: 200, y: groundY() })];
}

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

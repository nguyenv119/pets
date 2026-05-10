import { Pet } from './pet';
import { loadAllSprites, drawPet } from './renderer';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight - 48; // leave room for bottom bar

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 48;
});

// Temporary hardcoded pets for visual verification — replaced in T3
const pets: Pet[] = [
  new Pet({ id: '1', name: 'Rex', type: 'dog', color: 'brown', x: 100, y: canvas.height - 80, hunger: 100 }),
  new Pet({ id: '2', name: 'Kitsune', type: 'fox', color: 'red', x: 400, y: canvas.height - 80, hunger: 100 }),
];

let sprites: Awaited<ReturnType<typeof loadAllSprites>>;
let lastTime = 0;

function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pets.forEach(p => p.update(dt, null, canvas.width));
  pets.forEach(p => drawPet(ctx, p, sprites));

  requestAnimationFrame(tick);
}

loadAllSprites().then(s => {
  sprites = s;
  requestAnimationFrame(tick);
}).catch(err => {
  console.error('Failed to load sprites:', err);
});

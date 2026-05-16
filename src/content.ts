import { Pet } from './pet';
import type { Ball } from './pet';
import {
  DRAW_W,
  createPetView,
  updatePetView,
  removePetView,
  spawnFeedParticle,
  updateParticles,
  drawParticles,
  drawBall,
} from './renderer';
import type { PetView, Particle } from './renderer';
import { savePets, loadPetData } from './store';
import type { PetData, ExtMessage } from './types';

// ---------------------------------------------------------------------------
// Shadow DOM setup — isolates pet CSS from host page
// ---------------------------------------------------------------------------

const host = document.createElement('div');
host.id = 'pixel-pets-host';
document.documentElement.appendChild(host);

const shadow = host.attachShadow({ mode: 'open' });

// Inject styles into shadow DOM
const style = document.createElement('style');
style.textContent = `
  :host {
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
  }
  #pets-layer {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  #pets-layer img {
    pointer-events: auto;
    cursor: pointer;
  }
  canvas {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
`;
shadow.appendChild(style);

const petsLayer = document.createElement('div');
petsLayer.id = 'pets-layer';
shadow.appendChild(petsLayer);

const canvas = document.createElement('canvas');
shadow.appendChild(canvas);
const ctx = canvas.getContext('2d')!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pets: Pet[] = [];
const views = new Map<Pet, PetView>();
const particles: Particle[] = [];
const MAX_PARTICLES = 50;

// Ball state (thrown on double-click)
let ball: Ball & { vx: number; vy: number } | null = null;
const BALL_RADIUS = 8;
const GRAVITY = 800;
const BOUNCE_DAMPING = 0.6;

// Persistence debounce
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    savePets(pets.map(p => p.toData()));
  }, 2000);
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Pet Y position — walk along viewport bottom
// ---------------------------------------------------------------------------

function groundY(): number {
  return window.innerHeight - DRAW_W - 16;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function makePet(data: PetData): Pet {
  const p = new Pet({ ...data, y: groundY() });
  p.onTransition = debouncedSave;
  return p;
}

function addPetToScene(pet: Pet): void {
  const view = createPetView(pet, petsLayer);
  views.set(pet, view);

  // Click to feed
  view.el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pet.feed() && particles.length < MAX_PARTICLES) {
      particles.push(spawnFeedParticle(pet));
    }
  });
}

async function init(): Promise<void> {
  const savedData = await loadPetData();

  if (savedData.length === 0) {
    // Default pet on first install
    const defaultPet: PetData = {
      id: crypto.randomUUID(),
      name: 'Rex',
      type: 'dog',
      color: 'brown',
      x: Math.random() * (window.innerWidth - DRAW_W),
      y: groundY(),
    };
    pets = [makePet(defaultPet)];
    await savePets(pets.map(p => p.toData()));
  } else {
    pets = savedData.map(makePet);
  }

  pets.forEach(addPetToScene);
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Update ball physics
  if (ball) {
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Bounce off floor
    if (ball.y >= groundY() + DRAW_W / 2) {
      ball.y = groundY() + DRAW_W / 2;
      ball.vy = -ball.vy * BOUNCE_DAMPING;
      ball.vx *= 0.9;

      // Deactivate when barely moving
      if (Math.abs(ball.vy) < 20 && Math.abs(ball.vx) < 10) {
        ball.active = false;
      }
    }

    // Bounce off walls
    if (ball.x <= BALL_RADIUS) { ball.x = BALL_RADIUS; ball.vx = -ball.vx * BOUNCE_DAMPING; }
    if (ball.x >= canvas.width - BALL_RADIUS) { ball.x = canvas.width - BALL_RADIUS; ball.vx = -ball.vx * BOUNCE_DAMPING; }

    drawBall(ctx, ball);

    // Remove ball after it stops
    if (!ball.active) {
      ball = null;
    }
  }

  // Update particles
  updateParticles(particles, dt);
  drawParticles(ctx, particles);

  // Update pets
  const ballForPet: Ball | null = ball ? { active: ball.active, x: ball.x, y: ball.y } : null;
  for (const pet of pets) {
    pet.y = groundY();
    pet.update(dt, ballForPet, canvas.width, DRAW_W);
    const view = views.get(pet);
    if (view) updatePetView(view, pet);
  }

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Ball throw (double-click)
// ---------------------------------------------------------------------------

document.addEventListener('dblclick', (e) => {
  // Throw ball from click position upward
  ball = {
    active: true,
    x: e.clientX,
    y: e.clientY,
    vx: (Math.random() - 0.5) * 200,
    vy: -400,
  };
});

// ---------------------------------------------------------------------------
// Message handling (from popup via service worker)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: ExtMessage) => {
  switch (msg.type) {
    case 'ADD_PET': {
      const newPet = makePet(msg.pet);
      pets.push(newPet);
      addPetToScene(newPet);
      savePets(pets.map(p => p.toData()));
      break;
    }
    case 'REMOVE_PET': {
      const idx = pets.findIndex(p => p.toData().id === msg.id);
      if (idx !== -1) {
        const [removed] = pets.splice(idx, 1);
        const view = views.get(removed);
        if (view) {
          removePetView(view);
          views.delete(removed);
        }
        savePets(pets.map(p => p.toData()));
      }
      break;
    }
    case 'THROW_BALL': {
      ball = {
        active: true,
        x: window.innerWidth / 2,
        y: window.innerHeight * 0.3,
        vx: (Math.random() - 0.5) * 300,
        vy: -300,
      };
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();

import { Pet, CATCH_DISTANCE, isNightHour } from './pet';
import type { Ball } from './pet';
import {
  DRAW_W,
  createPetView,
  updatePetView,
  removePetView,
  spawnFeedParticle,
  spawnLoveParticle,
  spawnWaveParticle,
  updateParticles,
  drawParticles,
  drawBall,
  HAS_SWIPE,
} from './renderer';
import type { PetView, Particle } from './renderer';
import { savePets, savePositions, loadPetData } from './store';
import type { PetData, ExtMessage } from './types';
import { tryGreetPairs, clearGreetCooldownsForPet } from './greet';

// ---------------------------------------------------------------------------
// Guard against double-injection (manifest + scripting API both inject)
// ---------------------------------------------------------------------------

if (document.getElementById('pixel-pets-host')) {
  // Already injected — bail out silently
  throw new Error('pixel-pets: already injected');
}

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

// Persistence debounce — writes positions only (not roster), keeping the
// roster key clean for reads on the next boot.
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const p of pets) {
      const data = p.toData();
      positions[data.id] = { x: data.x, y: data.y };
    }
    savePositions(positions);
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
  return window.innerHeight - DRAW_W;
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

  // Click to feed — gate on treat availability via service worker
  view.el.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'CONSUME_TREAT' }, (resp: { ok: boolean; count?: number } | undefined) => {
      if (resp?.ok) {
        pet.feed();
        if (particles.length < MAX_PARTICLES) {
          particles.push(...spawnFeedParticle(pet));
        }
      }
      // If ok=false, silently skip — no treats available
    });
  });

  // Prevent double-clicks on pets from dropping a ball
  view.el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
  });

  // Hover: show wave animation and spawn 👋 particle for pets that have a swipe gif.
  // Tying the wave particle to HAS_SWIPE keeps the gif and particle in lockstep —
  // adding a new pet without a swipe asset will correctly suppress both.
  view.el.addEventListener('mouseenter', () => {
    pet.hovered = true;
    if (HAS_SWIPE.has(pet.type) && particles.length < MAX_PARTICLES) {
      particles.push(spawnWaveParticle(pet));
    }
  });

  view.el.addEventListener('mouseleave', () => {
    pet.hovered = false;
  });
}

async function init(): Promise<void> {
  // Restore visibility preference
  const visResult = await chrome.storage.local.get('pixel-pets-visible');
  if (visResult['pixel-pets-visible'] === false) {
    host.style.display = 'none';
  }

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
    // Save initial position too
    const initPos: Record<string, { x: number; y: number }> = {};
    for (const p of pets) { const d = p.toData(); initPos[d.id] = { x: d.x, y: d.y }; }
    await savePositions(initPos);
  } else {
    pets = savedData.map(makePet);
  }

  // Only add visible pets to the scene; hidden pets exist in pets[] but not in views
  pets.forEach(pet => {
    if (!pet.hidden) addPetToScene(pet);
  });
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

  // Contact detection — first chasing pet that reaches the ball catches it.
  // Run BEFORE pet.update() so the catch() transition takes effect this frame
  // rather than being overwritten by the ball-deactivated fallback in update().
  if (ball) {
    const catcher = pets.find(p =>
      !p.hidden &&
      p.state === 'chase' &&
      Math.abs(ball!.x - (p.x + DRAW_W / 2)) <= CATCH_DISTANCE &&
      ball!.y >= groundY()
    );
    if (catcher) {
      catcher.catch();
      if (particles.length < MAX_PARTICLES) particles.push(spawnLoveParticle(catcher));
      for (const p of pets) if (p !== catcher && p.state === 'chase') p.onBallLanded();
      ball = null; // consume the ball
    }
  }

  // Update pets — spread them apart when chasing the same ball
  const ballForPet: Ball | null = ball ? { active: ball.active, x: ball.x, y: ball.y } : null;
  const CHASE_SPREAD = 40; // pixels between each pet near the ball
  const visiblePets = pets.filter(p => !p.hidden);
  const chasingPets = visiblePets.filter(p => p.state === 'chase');
  let chasingIdx = 0;
  for (const pet of visiblePets) {
    pet.y = groundY();
    let offset = 0;
    if (pet.state === 'chase' && chasingPets.length > 1) {
      offset = (chasingIdx - (chasingPets.length - 1) / 2) * CHASE_SPREAD;
      chasingIdx++;
    }
    pet.update(dt, ballForPet, canvas.width, DRAW_W, offset, isNightHour);

    const view = views.get(pet);
    if (view) updatePetView(view, pet);
  }

  // Greet check — must run AFTER pet.update() so states are current
  tryGreetPairs(visiblePets);

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Ball throw (double-click)
// ---------------------------------------------------------------------------

document.addEventListener('dblclick', (e) => {
  // Drop ball from above the screen at the click's X position
  ball = {
    active: true,
    x: e.clientX,
    y: -20,
    vx: (Math.random() - 0.5) * 150,
    vy: 0, // gravity pulls it down
  };
});

// ---------------------------------------------------------------------------
// Message handling (from popup via service worker)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
  switch (msg.type) {
    case 'PING': {
      // Reply so the popup knows the content script is alive on this tab.
      sendResponse({ alive: true });
      break;
    }
    case 'ADD_PET': {
      const newPet = makePet(msg.pet);
      pets.push(newPet);
      addPetToScene(newPet);
      // Save roster (without positions) then save positions separately.
      savePets(pets.map(p => p.toData()));
      const positions: Record<string, { x: number; y: number }> = {};
      for (const p of pets) {
        const d = p.toData();
        positions[d.id] = { x: d.x, y: d.y };
      }
      savePositions(positions);
      break;
    }
    case 'SET_PET_HIDDEN': {
      const target = pets.find(p => p.toData().id === msg.id);
      if (!target) break;
      target.hidden = msg.hidden;
      if (msg.hidden) {
        // Hide: remove from scene but keep in pets[]
        const view = views.get(target);
        if (view) {
          removePetView(view);
          views.delete(target);
        }
      } else {
        // Show: restore to scene
        if (!views.has(target)) addPetToScene(target);
      }
      debouncedSave();
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
        clearGreetCooldownsForPet(removed.id, removed);
        // Roster write only — positions for removed pet can stay stale
        savePets(pets.map(p => p.toData()));
      }
      break;
    }
    case 'THROW_BALL': {
      // Drop ball from above the screen at a random X
      ball = {
        active: true,
        x: Math.random() * (window.innerWidth - 100) + 50,
        y: -20,
        vx: (Math.random() - 0.5) * 200,
        vy: 0,
      };
      break;
    }
    case 'TOGGLE_VISIBILITY': {
      host.style.display = msg.visible ? '' : 'none';
      // Persist visibility preference
      chrome.storage.local.set({ 'pixel-pets-visible': msg.visible });
      break;
    }
    case 'PETS_REORDERED': {
      // Reconcile local pets[] order by id — preserve existing Pet objects,
      // do NOT recreate views. Match by id then rebuild pets[] in incoming order.
      const incoming = msg.pets;
      const petById = new Map<string, Pet>(pets.map(p => [p.toData().id, p]));
      const reordered: Pet[] = [];
      for (const data of incoming) {
        const existing = petById.get(data.id);
        if (existing) reordered.push(existing);
      }
      // Append any pets not in the incoming list (shouldn't normally happen)
      for (const p of pets) {
        if (!reordered.includes(p)) reordered.push(p);
      }
      pets = reordered;
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();

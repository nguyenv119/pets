import type { Pet } from './pet';
import { HAS_SWIPE } from './renderer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GREET_RANGE = 60;        // pixels — horizontal proximity threshold
export const GREET_COOLDOWN_MS = 30_000; // 30s between greets for a given pair
export const GREET_DURATION_MS = 1_000;  // 1s swipe animation

/** States in which a pet is eligible to initiate or receive a greeting. */
const GREET_STATES: ReadonlySet<string> = new Set(['sitIdle', 'walkLeft', 'walkRight']);

// ---------------------------------------------------------------------------
// Module-level cooldown map
// Keys are "<id_a>:<id_b>" where id_a < id_b lexicographically.
// Values are the performance.now() timestamp when the greet fired.
// ---------------------------------------------------------------------------

export const greetCooldowns = new Map<string, number>();

function pairKey(a: Pet, b: Pet): string {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

// ---------------------------------------------------------------------------
// tryGreetPairs
// ---------------------------------------------------------------------------

/**
 * Evaluates all unordered pairs in `pets` and triggers a greeting animation
 * when:
 *   - both pets are visible (not hidden)
 *   - both are HAS_SWIPE types
 *   - neither is currently hovered or greeting
 *   - both are in an eligible state (sitIdle, walkLeft, walkRight)
 *   - horizontal distance < GREET_RANGE
 *   - the pair's cooldown has elapsed (or never fired)
 *
 * Greeting sets greeting=true on both pets for GREET_DURATION_MS, then
 * clears it via setTimeout.
 */
export function tryGreetPairs(pets: Pet[]): void {
  const now = performance.now();

  for (let i = 0; i < pets.length; i++) {
    for (let j = i + 1; j < pets.length; j++) {
      const a = pets[i];
      const b = pets[j];

      // Both must be visible
      if (a.hidden || b.hidden) continue;

      // Both must have a swipe gif
      if (!HAS_SWIPE.has(a.type) || !HAS_SWIPE.has(b.type)) continue;

      // Skip if either is already interacting
      if (a.hovered || b.hovered || a.greeting || b.greeting) continue;

      // Both must be in an eligible state
      if (!GREET_STATES.has(a.state) || !GREET_STATES.has(b.state)) continue;

      // Horizontal proximity
      if (Math.abs(a.x - b.x) >= GREET_RANGE) continue;

      // Cooldown check
      const key = pairKey(a, b);
      const last = greetCooldowns.get(key);
      if (last !== undefined && now - last < GREET_COOLDOWN_MS) continue;

      // --- Trigger greeting ---
      a.greeting = true;
      b.greeting = true;
      greetCooldowns.set(key, now);

      setTimeout(() => {
        a.greeting = false;
        b.greeting = false;
      }, GREET_DURATION_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup helper — called when a pet is removed from the scene
// ---------------------------------------------------------------------------

/**
 * Removes all cooldown entries that involve the given pet id.
 * Call this from content.ts when a pet is deleted so stale entries do not
 * block future pets from greeting the remaining pets.
 */
export function clearGreetCooldownsForPet(id: string): void {
  for (const key of greetCooldowns.keys()) {
    if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) {
      greetCooldowns.delete(key);
    }
  }
}

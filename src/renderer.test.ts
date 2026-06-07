// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { spawnFeedParticle, updateParticles, drawParticles, resolveGifName } from './renderer';
import type { Particle } from './renderer';
import { Pet } from './pet';
import type { PetData } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<PetData> = {}): Pet {
  return new Pet({
    id: 'test-1',
    name: 'TestPet',
    type: 'dog',
    color: 'brown',
    x: 100,
    y: 200,
    ...overrides,
  });
}

/** Minimal CanvasRenderingContext2D stub for drawParticles tests. */
function makeCtxStub(): CanvasRenderingContext2D {
  // REVIEW: mocking core dependency — test may not reflect real behavior
  // Real CanvasRenderingContext2D is browser-only and unavailable in jsdom
  // without a canvas element configured with a real rendering context.
  // jsdom does not implement canvas 2D rendering, so a stub is the only option.
  const calls: string[] = [];
  const stub = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    fillText: (_t: string, _x: number, _y: number) => calls.push('fillText'),
    _calls: calls,
    font: '',
    textAlign: '',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return stub;
}

// ---------------------------------------------------------------------------
// resolveGifName — HAS_LIE fallback
// ---------------------------------------------------------------------------

describe('resolveGifName', () => {
  it('returns "lie" for a legacy type (chicken) in sleep state', () => {
    /**
     * Verifies that pet types from the original roster (which have a lie gif)
     * still map the sleep state to "lie".
     *
     * This matters because those GIF files exist on disk and are the correct
     * animation. Switching to "idle" for these types would play the wrong
     * animation when a pet is sleeping.
     *
     * If violated, legacy pets play the idle animation while sleeping instead
     * of lying down.
     */
    // GIVEN — a legacy type that has a lie gif
    // WHEN — resolving gif name for sleep state
    const result = resolveGifName('chicken', 'sleep', false);

    // THEN — returns "lie"
    expect(result).toBe('lie');
  });

  it('returns "idle" for a new type (cockatiel) in sleep state', () => {
    /**
     * Verifies that new pet types (cockatiel, rat, snake, horse) which do NOT
     * have a lie gif fall back to "idle" when the state is "sleep".
     *
     * This matters because requesting a non-existent lie gif produces a 404,
     * leaving the pet sprite broken. Falling back to idle is the correct
     * visual behavior for these types.
     *
     * If violated, cockatiel/rat/snake/horse pets show a broken image when
     * sleeping instead of the idle animation.
     */
    // GIVEN — a new type that lacks a lie gif
    // WHEN — resolving gif name for sleep state
    const result = resolveGifName('cockatiel', 'sleep', false);

    // THEN — returns "idle" (no lie gif exists for this type)
    expect(result).toBe('idle');
  });

  it('returns "idle" for rat in sleep state', () => {
    /**
     * Verifies the lie fallback applies consistently to all new animal types,
     * specifically rat.
     *
     * Same reasoning as the cockatiel test — rat has no lie gif so idle is used.
     *
     * If violated, rat pets show broken images while sleeping.
     */
    // GIVEN — rat is a new type without a lie gif
    // WHEN — resolving gif name for sleep
    const result = resolveGifName('rat', 'sleep', false);

    // THEN — idle fallback applied
    expect(result).toBe('idle');
  });

  it('returns "idle" for snake in sleep state', () => {
    /**
     * Verifies the lie fallback applies to snake.
     */
    // GIVEN — snake is a new type without a lie gif
    // WHEN — resolving gif name for sleep
    const result = resolveGifName('snake', 'sleep', false);

    // THEN — idle fallback applied
    expect(result).toBe('idle');
  });

  it('returns "idle" for horse in sleep state', () => {
    /**
     * Verifies the lie fallback applies to horse.
     */
    // GIVEN — horse is a new type without a lie gif
    // WHEN — resolving gif name for sleep
    const result = resolveGifName('horse', 'sleep', false);

    // THEN — idle fallback applied
    expect(result).toBe('idle');
  });

  it('returns "run" for cockatiel in chase state (non-sleep states unaffected)', () => {
    /**
     * Verifies that only the sleep state triggers the lie fallback — all other
     * states (including chase) still map normally for new types.
     *
     * This matters because a blanket fallback would break the run animation
     * while chasing a ball, not just the sleep animation.
     *
     * If violated, new pet types never run — they idle even when chasing.
     */
    // GIVEN — a new type in the chase state
    // WHEN — resolving gif name
    const result = resolveGifName('cockatiel', 'chase', false);

    // THEN — returns "run" (normal mapping, no fallback needed)
    expect(result).toBe('run');
  });

  it('returns "idle" for chase state when nearBall is true (existing behavior)', () => {
    /**
     * Verifies that the nearBall override still works for new types: when a
     * pet is chasing but is already at the ball, it should show idle not run.
     *
     * This ensures the HAS_LIE change does not break the nearBall logic.
     *
     * If violated, pets at the ball still play the run animation, which looks
     * wrong (spinning in place).
     */
    // GIVEN — a new type chasing but with nearBall = true
    // WHEN — resolving gif name
    const result = resolveGifName('horse', 'chase', true);

    // THEN — idle (nearBall override takes priority)
    expect(result).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// spawnFeedParticle
// ---------------------------------------------------------------------------

describe('spawnFeedParticle', () => {
  it('returns a particle centered horizontally over the pet', () => {
    /**
     * Verifies that spawnFeedParticle() places the new particle at the
     * horizontal center of the pet sprite (pet.x + DRAW_W / 2 = pet.x + 32).
     *
     * This matters because the emoji burst should appear above the pet's center,
     * not at its left edge. An off-center particle would look misaligned.
     *
     * If violated, the 🍖 emoji appears at the wrong x position relative to the
     * pet, looking visually detached.
     */
    // GIVEN — a pet at a known x position
    const pet = makePet({ x: 100, y: 200 });

    // WHEN — spawn a feed particle
    const [p] = spawnFeedParticle(pet);

    // THEN — x is pet.x + 32 (DRAW_W / 2 = 64 / 2)
    expect(p.x).toBe(132); // 100 + 32
  });

  it('returns a particle at the pet y position', () => {
    /**
     * Verifies that the particle's y coordinate starts at pet.y, so the emoji
     * originates from the top of the pet sprite and floats upward.
     *
     * This matters because if y is set too low, the emoji appears below the pet
     * (into the ground), which looks wrong.
     *
     * If violated, the emoji burst appears below the pet's feet.
     */
    // GIVEN — a pet at a known y position
    const pet = makePet({ x: 100, y: 200 });

    // WHEN — spawn a feed particle
    const [p] = spawnFeedParticle(pet);

    // THEN — y matches pet.y
    expect(p.y).toBe(200);
  });

  it('returns a particle with upward velocity (negative vy)', () => {
    /**
     * Verifies that the spawned particle has a negative vy so it floats upward
     * on each update tick.
     *
     * This matters because a zero or positive vy would make the emoji stay put
     * or fall down, which is the wrong visual effect for a celebration burst.
     *
     * If violated, the 🍖 emoji does not float — it stays still or falls.
     */
    // GIVEN — any pet
    const pet = makePet();

    // WHEN — spawn a feed particle
    const [p] = spawnFeedParticle(pet);

    // THEN — vy is negative (upward)
    expect(p.vy).toBeLessThan(0);
  });

  it('returns a particle with full opacity (alpha = 1)', () => {
    /**
     * Verifies that the spawned particle starts at full opacity so it appears
     * immediately visible on the first frame.
     *
     * This matters because if alpha starts below 1, the emoji could flash in
     * partially or never appear fully visible if it fades quickly.
     *
     * If violated, the emoji burst looks faded or invisible at spawn time.
     */
    // GIVEN — any pet
    const pet = makePet();

    // WHEN — spawn a particle
    const [p] = spawnFeedParticle(pet);

    // THEN — alpha is 1 (fully opaque)
    expect(p.alpha).toBe(1);
  });

  it('returns a particle with the food emoji', () => {
    /**
     * Verifies that spawnFeedParticle() produces a particle with the 🍖 emoji.
     *
     * This matters because the emoji is the only visual indicator that a feeding
     * interaction occurred. An empty or wrong emoji would give the user no
     * feedback.
     *
     * If violated, the wrong emoji (or no emoji) appears on feeding.
     */
    // GIVEN — any pet
    const pet = makePet();

    // WHEN — spawn a particle
    const [p] = spawnFeedParticle(pet);

    // THEN — emoji is the meat/bone
    expect(p.emoji).toBe('🍖');
  });

  it('returns a heart particle as the second element', () => {
    /**
     * Verifies that spawnFeedParticle() returns two particles: a food emoji and
     * a trailing heart emoji, so the feed animation has a two-stage visual effect.
     *
     * This matters because the heart is the affection signal — if it's missing,
     * the interaction feels incomplete.
     *
     * If violated, only the food emoji appears and the heart burst is absent.
     */
    // GIVEN — any pet
    const pet = makePet();

    // WHEN — spawn feed particles
    const particles = spawnFeedParticle(pet);

    // THEN — second particle is the heart
    expect(particles).toHaveLength(2);
    expect(particles[1].emoji).toBe('❤️');
    expect(particles[1].vy).toBeLessThan(0); // also floats upward
  });
});

// ---------------------------------------------------------------------------
// updateParticles
// ---------------------------------------------------------------------------

describe('updateParticles', () => {
  it('moves particle upward (y decreases) after update', () => {
    /**
     * Verifies that updateParticles() applies vy to y so the particle floats
     * up on each frame.
     *
     * This matters because the entire visual effect depends on the particle
     * rising. A static or falling particle breaks the celebration animation.
     *
     * If violated, the emoji stays frozen in place or falls down.
     */
    // GIVEN — a particle with upward velocity
    const p: Particle = { x: 100, y: 200, vy: -40, alpha: 1, emoji: '🍖' };
    const particles = [p];

    // WHEN — update by 0.1 seconds
    updateParticles(particles, 0.1);

    // THEN — y decreased (particle moved up)
    expect(p.y).toBeLessThan(200);
  });

  it('decreases alpha over time', () => {
    /**
     * Verifies that updateParticles() reduces alpha on each tick so the emoji
     * fades out gradually.
     *
     * This matters because a sudden disappearance would look abrupt. The fade
     * makes the visual transition smooth.
     *
     * If violated, the emoji snaps away instead of fading out.
     */
    // GIVEN — a fully opaque particle
    const p: Particle = { x: 100, y: 200, vy: -40, alpha: 1, emoji: '🍖' };
    const particles = [p];

    // WHEN — update by 0.5 seconds
    updateParticles(particles, 0.5);

    // THEN — alpha decreased but is still > 0
    expect(p.alpha).toBeLessThan(1);
    expect(p.alpha).toBeGreaterThan(0);
  });

  it('removes fully faded particles from the array', () => {
    /**
     * Verifies that particles with alpha <= 0 are pruned from the array so they
     * no longer take up memory or draw calls.
     *
     * This matters because without pruning the particle array grows indefinitely
     * with each feeding interaction, causing a memory leak.
     *
     * If violated, invisible particles accumulate in memory and degrade
     * performance after many feedings.
     */
    // GIVEN — a particle that has fully faded
    const p: Particle = { x: 100, y: 200, vy: -40, alpha: 0.01, emoji: '🍖' };
    const particles = [p];

    // WHEN — update by a large dt that drains the remaining alpha
    updateParticles(particles, 1);

    // THEN — particle removed from array
    expect(particles).toHaveLength(0);
  });

  it('keeps particles with remaining alpha', () => {
    /**
     * Verifies that particles which still have alpha > 0 after an update are
     * NOT removed from the array.
     *
     * This matters because premature removal would cut the animation short —
     * the emoji would disappear before fully fading.
     *
     * If violated, the emoji disappears too early, making feeding feel broken.
     */
    // GIVEN — a particle with plenty of alpha remaining
    const p: Particle = { x: 100, y: 200, vy: -40, alpha: 1, emoji: '🍖' };
    const particles = [p];

    // WHEN — update by a small dt
    updateParticles(particles, 0.016);

    // THEN — particle still in array
    expect(particles).toHaveLength(1);
  });

  it('alpha does not go below 0', () => {
    /**
     * Verifies that updateParticles() clamps alpha to a minimum of 0, not a
     * negative value.
     *
     * This matters because a negative alpha passed to ctx.globalAlpha causes a
     * DOMException in real canvas contexts, crashing the render loop.
     *
     * If violated, the game crashes on the first feeding interaction after ~1.5s.
     */
    // GIVEN — a near-zero alpha particle
    const p: Particle = { x: 100, y: 200, vy: -40, alpha: 0.001, emoji: '🍖' };
    const particles = [p];

    // WHEN — update by a large dt
    updateParticles(particles, 100);

    // THEN — particle is pruned AND alpha never went negative
    expect(particles).toHaveLength(0);
    expect(p.alpha).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// drawParticles
// ---------------------------------------------------------------------------

describe('drawParticles', () => {
  it('calls fillText for each visible particle', () => {
    /**
     * Verifies that drawParticles() calls fillText once per particle so each
     * particle is rendered to the canvas.
     *
     * This matters because skipping fillText would make the emoji invisible even
     * though the particle logic runs correctly.
     *
     * If violated, no emoji appears on screen despite the particle being tracked.
     */
    // GIVEN — two particles and a ctx stub
    const ctx = makeCtxStub();
    const particles: Particle[] = [
      { x: 100, y: 200, vy: -40, alpha: 1, emoji: '🍖' },
      { x: 200, y: 150, vy: -40, alpha: 0.5, emoji: '🍖' },
    ];

    // WHEN — draw particles
    drawParticles(ctx, particles);

    // THEN — fillText called twice (once per particle)
    const calls = (ctx as unknown as { _calls: string[] })._calls;
    expect(calls.filter(c => c === 'fillText')).toHaveLength(2);
  });

  it('wraps draw calls in save/restore to isolate canvas state', () => {
    /**
     * Verifies that drawParticles() calls ctx.save() and ctx.restore() around
     * all particle drawing so globalAlpha changes do not bleed into the next
     * draw call (pets, background, ball).
     *
     * This matters because ctx.globalAlpha is persistent. Without save/restore,
     * the last particle's alpha value would be inherited by subsequent draw
     * calls, making pets/background semi-transparent.
     *
     * If violated, the pets layer appears faded or at wrong opacity after
     * any feeding interaction.
     */
    // GIVEN — one particle and a ctx stub
    const ctx = makeCtxStub();
    const particles: Particle[] = [
      { x: 100, y: 200, vy: -40, alpha: 0.5, emoji: '🍖' },
    ];

    // WHEN — draw particles
    drawParticles(ctx, particles);

    // THEN — save called before fillText, restore called after
    const calls = (ctx as unknown as { _calls: string[] })._calls;
    expect(calls[0]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
  });

  it('does nothing when particle array is empty', () => {
    /**
     * Verifies that drawParticles() is a no-op (only save/restore) when there
     * are no particles to draw.
     *
     * This matters because drawParticles() is called every tick even when no
     * feeding has occurred. Any side effects on an empty list would be wasteful
     * or incorrect.
     *
     * If violated, each tick draws invisible garbage to the canvas even when
     * there are no active particles.
     */
    // GIVEN — empty particle array
    const ctx = makeCtxStub();
    const particles: Particle[] = [];

    // WHEN — draw empty list
    drawParticles(ctx, particles);

    // THEN — no fillText calls
    const calls = (ctx as unknown as { _calls: string[] })._calls;
    expect(calls.filter(c => c === 'fillText')).toHaveLength(0);
  });
});

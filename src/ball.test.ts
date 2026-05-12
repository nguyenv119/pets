import { describe, it, expect } from 'vitest';
import { Ball } from './ball';

// ---------------------------------------------------------------------------
// Ball physics
// ---------------------------------------------------------------------------

describe('Ball — construction', () => {
  it('spawns above the viewport (y === -radius)', () => {
    /**
     * Verifies that a newly created Ball places itself above the visible area
     * so it falls into view from above rather than starting at ground level.
     *
     * This matters because the ball should appear to drop from the sky.
     * An incorrect start position would make the ball appear to teleport
     * from the ground level.
     *
     * If violated, the ball spawns at ground level or in the middle of
     * the screen instead of falling in from above.
     */
    // GIVEN — canvas dimensions
    const canvasW = 800;
    const groundY = 400;

    // WHEN — ball is constructed
    const ball = new Ball(canvasW, groundY);

    // THEN — y starts above the viewport
    expect(ball.y).toBe(-ball.radius);
  });

  it('starts with settled = false', () => {
    /**
     * Verifies that a freshly created ball is not settled so physics are
     * applied on the first frame and it falls toward the ground.
     *
     * This matters because settled=false is the prerequisite for the ball
     * to move at all. A ball born settled would never fall or be rendered
     * at the right position.
     *
     * If violated, the ball never moves and pets never start chasing.
     */
    // GIVEN — standard canvas dimensions
    // WHEN — ball constructed
    const ball = new Ball(800, 400);

    // THEN — not settled from the start
    expect(ball.settled).toBe(false);
  });

  it('starts with vy = 0 (falls under gravity, not launched upward)', () => {
    /**
     * Verifies that vy is 0 at construction so the ball falls naturally
     * under gravity rather than being launched upward.
     *
     * This matters because the new behavior is a ball dropping from the sky,
     * not an arc throw. An initial upward velocity would be wrong.
     *
     * If violated, the ball arcs upward before falling.
     */
    // GIVEN — standard canvas
    // WHEN — ball constructed
    const ball = new Ball(800, 400);

    // THEN — vy starts at 0
    expect(ball.vy).toBe(0);
  });

  it('exposes a fixed radius of 8', () => {
    /**
     * Verifies the ball's radius constant is 8, matching the renderer's
     * hard-coded arc radius in drawBall().
     *
     * This matters because drawBall() uses radius 8. If the Ball class
     * reports a different radius, the physics boundary (groundY - radius)
     * and the visual circle would be different sizes, making the ball
     * appear to float above or sink below the ground.
     *
     * If violated, the ball visually appears to bounce at the wrong height.
     */
    // GIVEN / WHEN — ball constructed
    const ball = new Ball(800, 400);

    // THEN — radius is 8
    expect(ball.radius).toBe(8);
  });

  it('x is within canvas bounds', () => {
    /**
     * Verifies that the random spawn x is within [0, canvasW].
     *
     * This matters because a ball spawned outside the canvas would be
     * invisible and pets would chase off-screen.
     */
    const canvasW = 800;
    const ball = new Ball(canvasW, 400);
    expect(ball.x).toBeGreaterThanOrEqual(0);
    expect(ball.x).toBeLessThanOrEqual(canvasW);
  });
});

describe('Ball — update() physics', () => {
  it('falls toward the ground under gravity', () => {
    /**
     * Verifies that repeated calls to update() increase vy (via gravity = 980 px/s²)
     * so the ball accelerates downward.
     *
     * This matters because gravity is what makes the fall look natural.
     * Without it the ball would stay above the viewport forever.
     *
     * If violated, the ball never falls and pets never get to chase it.
     */
    // GIVEN — a ball falling from above
    const ball = new Ball(800, 600);
    const initialVy = ball.vy;

    // WHEN — advance one frame (16ms)
    ball.update(0.016);

    // THEN — vy has increased (gravity applied)
    expect(ball.vy).toBeGreaterThan(initialVy);
  });

  it('bounces when it hits the ground (vy reverses)', () => {
    /**
     * Verifies that when the ball y position reaches the ground boundary
     * (groundY - radius), vy is negated and damped so the ball bounces.
     *
     * This matters because without bouncing the ball would pass through
     * the floor and disappear off-screen, and pets would chase forever.
     *
     * If violated, the ball falls through the floor and settled stays false
     * indefinitely, so pets never stop chasing.
     */
    // GIVEN — a ball artificially placed just above the ground with downward velocity
    const groundY = 600;
    const ball = new Ball(800, groundY);
    // _groundY = groundY + 56 - radius (ball bottom aligns with pets' feet at groundY+64)
    const settleY = groundY + 56 - ball.radius;
    ball.y = settleY - 1; // one pixel above settled position
    ball.vy = 100; // downward

    // WHEN — advance enough to reach the ground
    ball.update(0.1);

    // THEN — ball did not go below ground, vy is now negative (bounced)
    expect(ball.y).toBeLessThanOrEqual(settleY);
    expect(ball.vy).toBeLessThan(0);
  });

  it('becomes settled when bounce energy is below threshold', () => {
    /**
     * Verifies that once the ball's bounce energy drops below 30 px/s (|vy| < 30),
     * settled is set to true, signalling that the ball has come to rest.
     *
     * This matters because settled=true is the signal that causes pets to
     * approach and pick up the ball. Without it, pets chase forever.
     *
     * If violated, the ball keeps bouncing indefinitely and pets never settle.
     */
    // GIVEN — a ball already at the ground with low bounce velocity
    const groundY = 600;
    const ball = new Ball(800, groundY);
    ball.y = groundY + 56 - ball.radius; // exactly at settle boundary (_groundY)
    ball.vy = 10; // below the 30 px/s threshold after damping (* 0.55 = 5.5)

    // WHEN — one physics step (hits ground immediately, |vy * 0.55| = 5.5 < 30)
    ball.update(0.016);

    // THEN — ball becomes settled
    expect(ball.settled).toBe(true);
  });

  it('does not move after settling (further update() calls are no-ops)', () => {
    /**
     * Verifies that once settled=true, subsequent update() calls do not
     * change x or y. The ball stays in place until a pet picks it up.
     *
     * If violated, a settled ball would drift or teleport, making it
     * impossible for pets to reliably reach it.
     */
    // GIVEN — a ball that has just settled
    const groundY = 600;
    const ball = new Ball(800, groundY);
    ball.y = groundY + 56 - ball.radius; // settle boundary
    ball.vy = 10;
    ball.update(0.016); // settle it
    expect(ball.settled).toBe(true);

    const snapX = ball.x;
    const snapY = ball.y;

    // WHEN — more updates
    ball.update(0.1);
    ball.update(0.1);

    // THEN — position unchanged
    expect(ball.x).toBe(snapX);
    expect(ball.y).toBe(snapY);
  });

  it('reflects off the left wall (vx becomes positive when x reaches 0)', () => {
    /**
     * Verifies that the ball reflects horizontally when it reaches the left
     * canvas boundary.
     *
     * This matters because without wall reflection the ball would travel
     * off-screen and pets would chase it into the void.
     *
     * If violated, the ball exits the visible canvas and is lost.
     */
    // GIVEN — a ball near the left wall with leftward velocity
    const ball = new Ball(800, 600);
    ball.x = 1; // close to left wall
    ball.vx = -200; // moving left

    // WHEN — advance enough to cross x=0
    ball.update(0.1);

    // THEN — vx is now positive (reflected)
    expect(ball.vx).toBeGreaterThan(0);
  });

  it('reflects off the right wall (vx becomes negative when x reaches canvasW)', () => {
    /**
     * Verifies that the ball reflects horizontally when it reaches the right
     * canvas boundary.
     *
     * This matters for the same reason as left-wall reflection: the ball must
     * stay visible and pets must remain able to reach it.
     *
     * If violated, the ball exits the right edge and is never caught.
     */
    // GIVEN — a ball near the right wall with rightward velocity
    const canvasW = 800;
    const ball = new Ball(canvasW, 600);
    ball.x = canvasW - 1; // close to right wall
    ball.vx = 200; // moving right

    // WHEN — advance enough to cross right boundary
    ball.update(0.1);

    // THEN — vx is now negative (reflected)
    expect(ball.vx).toBeLessThan(0);
  });

  it('x position changes after update (ball moves horizontally)', () => {
    /**
     * Verifies that the ball's x position changes each frame based on vx.
     *
     * This matters because horizontal movement is what separates the ball
     * landing from where pets start chasing from, creating the chase animation.
     *
     * If violated, the ball only moves vertically and the chase looks wrong.
     */
    // GIVEN — a ball with a known horizontal velocity and far from boundaries
    const ball = new Ball(800, 900); // groundY far below
    ball.vx = 200; // ensure non-zero horizontal velocity
    ball.y = -ball.radius; // above viewport, won't hit ground
    const startX = ball.x;

    // WHEN — advance one frame
    ball.update(0.016);

    // THEN — x changed
    expect(ball.x).not.toBe(startX);
  });
});

import { describe, it, expect } from 'vitest';
import { Ball } from './ball';

// ---------------------------------------------------------------------------
// Ball physics
// ---------------------------------------------------------------------------

describe('Ball — construction', () => {
  it('starts at the provided x, near the bottom of the canvas', () => {
    /**
     * Verifies that a newly created Ball places itself at startX horizontally
     * and near the bottom of the canvas vertically (canvasH - radius).
     *
     * This matters because the throw animation should begin at the player's
     * position on the ground. An incorrect start position would make the ball
     * appear to teleport from the wrong location.
     *
     * If violated, the ball spawns in the middle of the screen or off-screen
     * instead of at the ground level throw point.
     */
    // GIVEN — canvas dimensions and a mid-canvas throw point
    const canvasW = 800;
    const canvasH = 600;

    // WHEN — ball is constructed
    const ball = new Ball(400, canvasW, canvasH);

    // THEN — x is the throw point, y starts 20px above ground (canvasH - 20)
    expect(ball.x).toBe(400);
    expect(ball.y).toBe(canvasH - 20);
  });

  it('starts with active = true', () => {
    /**
     * Verifies that a freshly thrown ball is active so it is rendered and
     * physics are applied on the first frame.
     *
     * This matters because inactive balls are neither drawn nor used to
     * signal chase completion. A ball born inactive would be immediately
     * ignored, making throwBall() appear to do nothing.
     *
     * If violated, the throw has no visible effect and pets never start chasing.
     */
    // GIVEN — standard canvas dimensions
    // WHEN — ball constructed
    const ball = new Ball(400, 800, 600);

    // THEN — active from the start
    expect(ball.active).toBe(true);
  });

  it('starts with an upward initial velocity', () => {
    /**
     * Verifies that vy is negative (upward) at construction so the ball
     * arcs into the air before gravity pulls it back down.
     *
     * This matters because a positive initial vy would make the ball fall
     * straight to the ground without any arc, making the throw look wrong.
     *
     * If violated, the ball immediately drops instead of arcing.
     */
    // GIVEN — standard canvas
    // WHEN — ball constructed
    const ball = new Ball(400, 800, 600);

    // THEN — vy is negative (up)
    expect(ball.vy).toBeLessThan(0);
  });

  it('exposes a fixed radius of 8', () => {
    /**
     * Verifies the ball's radius constant is 8, matching the renderer's
     * hard-coded arc radius in drawBall().
     *
     * This matters because drawBall() uses radius 8. If the Ball class
     * reports a different radius, the physics boundary (groundY = canvasH - radius)
     * and the visual circle would be different sizes, making the ball
     * appear to float above or sink below the ground.
     *
     * If violated, the ball visually appears to bounce at the wrong height.
     */
    // GIVEN / WHEN — ball constructed
    const ball = new Ball(400, 800, 600);

    // THEN — radius is 8
    expect(ball.radius).toBe(8);
  });
});

describe('Ball — update() physics', () => {
  it('falls toward the ground under gravity', () => {
    /**
     * Verifies that repeated calls to update() increase vy (via gravity = 980 px/s²)
     * so the ball accelerates downward.
     *
     * This matters because gravity is what makes the throw arc look natural.
     * Without it the ball would travel in a straight line.
     *
     * If violated, the ball flies horizontally forever instead of arcing down.
     */
    // GIVEN — a ball launched upward from the middle of the canvas
    const ball = new Ball(400, 800, 600);
    const initialVy = ball.vy;

    // WHEN — advance one frame (16ms)
    ball.update(0.016);

    // THEN — vy has increased (less negative / more positive → gravity applied)
    expect(ball.vy).toBeGreaterThan(initialVy);
  });

  it('bounces when it hits the ground (vy reverses)', () => {
    /**
     * Verifies that when the ball y position reaches the ground boundary
     * (canvasH - radius), vy is negated and damped so the ball bounces.
     *
     * This matters because without bouncing the ball would pass through
     * the floor and disappear off-screen, and pets would chase forever.
     *
     * If violated, the ball falls through the floor and active stays true
     * indefinitely, so pets never stop chasing.
     */
    // GIVEN — a ball artificially placed just above the ground with downward velocity
    const canvasH = 600;
    const ball = new Ball(400, 800, canvasH);
    ball.y = canvasH - ball.radius - 1; // one pixel above ground
    ball.vy = 100; // downward

    // WHEN — advance enough to reach the ground
    ball.update(0.1);

    // THEN — ball did not go below ground, vy is now negative (bounced)
    expect(ball.y).toBeLessThanOrEqual(canvasH - ball.radius);
    expect(ball.vy).toBeLessThan(0);
  });

  it('becomes inactive when bounce energy is below threshold', () => {
    /**
     * Verifies that once the ball's bounce energy drops below 30 px/s (|vy| < 30),
     * active is set to false, signalling that the ball has settled.
     *
     * This matters because active=false is the signal that causes pets to
     * transition from chase to idleWithBall. Without it, pets chase forever.
     *
     * If violated, the ball keeps bouncing indefinitely and pets never settle.
     */
    // GIVEN — a ball already at the ground with low bounce velocity
    const canvasH = 600;
    const ball = new Ball(400, 800, canvasH);
    ball.y = canvasH - ball.radius; // exactly at ground
    ball.vy = 10; // below the 30 px/s threshold after damping (* 0.55 = 5.5)

    // WHEN — one physics step (hits ground immediately, |vy * 0.55| = 5.5 < 30)
    ball.update(0.016);

    // THEN — ball becomes inactive
    expect(ball.active).toBe(false);
  });

  it('reflects off the left wall (vx reverses when x < 0)', () => {
    /**
     * Verifies that the ball reflects horizontally when it reaches the left
     * canvas boundary (x < 0).
     *
     * This matters because without wall reflection the ball would travel
     * off-screen and pets would chase it into the void.
     *
     * If violated, the ball exits the visible canvas and is lost.
     */
    // GIVEN — a ball near the left wall with leftward velocity
    const ball = new Ball(400, 800, 600);
    ball.x = 1; // close to left wall
    ball.vx = -200; // moving left

    // WHEN — advance enough to cross x=0
    ball.update(0.1);

    // THEN — vx is now positive (reflected)
    expect(ball.vx).toBeGreaterThan(0);
  });

  it('reflects off the right wall (vx reverses when x > canvasW)', () => {
    /**
     * Verifies that the ball reflects horizontally when it reaches the right
     * canvas boundary (x > canvasW).
     *
     * This matters for the same reason as left-wall reflection: the ball must
     * stay visible and pets must remain able to reach it.
     *
     * If violated, the ball exits the right edge and is never caught.
     */
    // GIVEN — a ball near the right wall with rightward velocity
    const canvasW = 800;
    const ball = new Ball(400, canvasW, 600);
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
    const ball = new Ball(400, 800, 600);
    ball.vx = 200; // ensure non-zero horizontal velocity
    ball.vy = -300; // ensure upward so it doesn't hit ground in one tick
    ball.y = 200; // well above ground
    const startX = ball.x;

    // WHEN — advance one frame
    ball.update(0.016);

    // THEN — x changed
    expect(ball.x).not.toBe(startX);
  });
});

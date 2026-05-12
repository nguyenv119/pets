import { describe, it, expect, vi } from 'vitest';
import { Pet } from './pet';
import type { Ball } from './pet';
import type { PetData } from './types';

// Base test fixture — a pet with deterministic initial state
function makePet(overrides: Partial<PetData> = {}): Pet {
  return new Pet({
    id: 'test-1',
    name: 'TestPet',
    type: 'dog',
    color: 'brown',
    x: 200,
    y: 300,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('Pet FSM — state transitions', () => {
  it('starts in sitIdle state', () => {
    /**
     * Verifies that a newly constructed Pet begins in the sitIdle state.
     *
     * This matters because the FSM timer logic and first transition assume
     * the initial state is sitIdle. If this breaks, pets could start in
     * undefined or unexpected visual states.
     *
     * If violated, the first frame would draw the wrong animation and the
     * FSM branch logic for the initial transition would be wrong.
     */
    // GIVEN — a freshly constructed pet
    const pet = makePet();

    // WHEN — no update applied

    // THEN — state is sitIdle
    expect(pet.state).toBe('sitIdle');
  });

  it('transitions out of sitIdle after timer expires', () => {
    /**
     * Verifies that after the sitIdle timer (2–4s) expires, the FSM picks
     * a new state (walkLeft, walkRight, or sleep).
     *
     * This matters because if the timer never fires, pets would stand still
     * forever — the entire autonomous wandering behavior depends on this.
     *
     * If violated, pets appear frozen on screen.
     */
    // GIVEN — a pet whose FSM timer will expire after we force it
    const pet = makePet();
    vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic: 0 → walkLeft

    // WHEN — advance time past the maximum sitIdle timer (4s + buffer)
    pet.update(5, null);

    // THEN — state changed from sitIdle
    expect(pet.state).not.toBe('sitIdle');

    vi.restoreAllMocks();
  });

  it('sitIdle transitions to walkLeft when random < 0.4', () => {
    /**
     * Verifies the 40% probability branch: sitIdle → walkLeft when
     * Math.random() returns a value below 0.4.
     *
     * This matters because the FSM branching logic determines the distribution
     * of autonomous behaviors. Incorrect thresholds cause pets to over- or
     * under-use certain animations.
     *
     * If violated, pets would never (or always) walk left, breaking visual
     * variety.
     */
    // GIVEN — a pet in sitIdle with forced random output for walkLeft branch
    const pet = makePet();
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // < 0.4 → walkLeft

    // WHEN — advance past timer to trigger transition
    pet.update(5, null);

    // THEN — pet entered walkLeft
    expect(pet.state).toBe('walkLeft');

    vi.restoreAllMocks();
  });

  it('sitIdle transitions to walkRight when 0.4 <= random < 0.8', () => {
    /**
     * Verifies the 40% probability branch: sitIdle → walkRight when
     * Math.random() returns a value in [0.4, 0.8).
     *
     * This matters for the same reason as the walkLeft test — correct
     * distribution keeps the pet behavior feeling natural and varied.
     *
     * If violated, pets would never walk right, always moving in one direction.
     */
    // GIVEN — a pet in sitIdle with forced random output for walkRight branch
    const pet = makePet();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // in [0.4, 0.8) → walkRight

    // WHEN — advance past timer
    pet.update(5, null);

    // THEN — pet entered walkRight
    expect(pet.state).toBe('walkRight');

    vi.restoreAllMocks();
  });

  it('sitIdle transitions to sleep when random >= 0.8', () => {
    /**
     * Verifies the 20% probability branch: sitIdle → sleep when
     * Math.random() returns a value >= 0.8.
     *
     * This matters because sleep is the rest state; without it pets never
     * visually rest and the lie animation never plays.
     *
     * If violated, pets appear to never sleep, removing variety.
     */
    // GIVEN — a pet in sitIdle with forced random output for sleep branch
    const pet = makePet();
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // >= 0.8 → sleep

    // WHEN — advance past timer
    pet.update(5, null);

    // THEN — pet entered sleep
    expect(pet.state).toBe('sleep');

    vi.restoreAllMocks();
  });

  it('walkLeft transitions to sitIdle when random < 0.6', () => {
    /**
     * Verifies the 60% branch: walkLeft → sitIdle. After walking left, a pet
     * should most often return to idle.
     *
     * This matters because if the pet never returns to idle, it would walk
     * off-screen or continuously flip direction without resting.
     *
     * If violated, pets overshoot their intended wandering area and never rest.
     */
    // GIVEN — a pet forced into walkLeft, timer set to expire
    const pet = makePet();
    pet.state = 'walkLeft';
    pet['_timer'] = 0; // force timer to 0 so next update triggers transition
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.6 → sitIdle

    // WHEN — advance with any dt
    pet.update(0.016, null);

    // THEN — pet is now sitIdle
    expect(pet.state).toBe('sitIdle');

    vi.restoreAllMocks();
  });

  it('walkLeft transitions to walkRight when random >= 0.6', () => {
    /**
     * Verifies the 40% branch: walkLeft → walkRight. A pet walking left can
     * reverse direction without stopping.
     *
     * This matters because it models realistic wandering behavior — pets
     * should occasionally reverse direction mid-walk.
     *
     * If violated, pets always stop before reversing, making movement look
     * mechanical and choppy.
     */
    // GIVEN — a pet in walkLeft with timer at 0
    const pet = makePet();
    pet.state = 'walkLeft';
    pet['_timer'] = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.8); // >= 0.6 → walkRight

    // WHEN — advance with any dt
    pet.update(0.016, null);

    // THEN — pet is now walkRight
    expect(pet.state).toBe('walkRight');

    vi.restoreAllMocks();
  });

  it('walkRight transitions to sitIdle when random < 0.6', () => {
    /**
     * Verifies the 60% branch: walkRight → sitIdle, symmetric to walkLeft.
     *
     * Ensures that walking right also returns to rest most of the time,
     * maintaining balanced wandering behavior in both directions.
     *
     * If violated, pets walking right would never rest, biasing movement.
     */
    // GIVEN — a pet in walkRight with timer at 0
    const pet = makePet();
    pet.state = 'walkRight';
    pet['_timer'] = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.3); // < 0.6 → sitIdle

    // WHEN — advance with any dt
    pet.update(0.016, null);

    // THEN — pet is now sitIdle
    expect(pet.state).toBe('sitIdle');

    vi.restoreAllMocks();
  });

  it('walkRight transitions to walkLeft when random >= 0.6', () => {
    /**
     * Verifies the 40% branch: walkRight → walkLeft, symmetric to the
     * walkLeft → walkRight test.
     *
     * Ensures balanced bidirectional wandering — pets should be able to
     * reverse from either walk state.
     *
     * If violated, pets could only reverse from left-walk, making movement
     * asymmetric.
     */
    // GIVEN — a pet in walkRight with timer at 0
    const pet = makePet();
    pet.state = 'walkRight';
    pet['_timer'] = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.7); // >= 0.6 → walkLeft

    // WHEN — advance with any dt
    pet.update(0.016, null);

    // THEN — pet is now walkLeft
    expect(pet.state).toBe('walkLeft');

    vi.restoreAllMocks();
  });

  it('sleep transitions to sitIdle after timer expires', () => {
    /**
     * Verifies that sleep always transitions back to sitIdle (100% probability)
     * after the 4–8s sleep timer expires.
     *
     * This matters because a pet that never wakes up would appear frozen in
     * the sleep animation indefinitely, breaking autonomous behavior.
     *
     * If violated, pets appear to never wake up after sleeping.
     */
    // GIVEN — a pet in sleep state with timer forced to 0
    const pet = makePet();
    pet.state = 'sleep';
    pet['_timer'] = 0;

    // WHEN — advance with any dt (timer at 0 triggers transition immediately)
    pet.update(0.016, null);

    // THEN — pet woke up to sitIdle
    expect(pet.state).toBe('sitIdle');
  });

  it('idleWithBall transitions to sitIdle when timer expires', () => {
    /**
     * Verifies that idleWithBall exits to sitIdle once its timer runs out.
     *
     * This matters because if the idleWithBall state never exits, the pet
     * would be permanently stuck in the ball-holding pose.
     *
     * If violated, pets display the ball sprite indefinitely.
     * Note: the entry timer for this state varies by path (1.5s from chase,
     * randBetween(2,4) from nextState). This test verifies the exit, not the duration.
     */
    // GIVEN — a pet in idleWithBall with timer forced to 0
    const pet = makePet();
    pet.state = 'idleWithBall';
    pet['_timer'] = 0;

    // WHEN — advance with any dt
    pet.update(0.016, null);

    // THEN — pet returned to sitIdle
    expect(pet.state).toBe('sitIdle');
  });

  it('chase transitions to idleWithBall via onBallLanded() when ball deactivates', () => {
    /**
     * Verifies that when the ball deactivates, main.ts calls onBallLanded() on
     * each pet, which transitions it to idleWithBall with a hardcoded 1.5s timer.
     *
     * This matters because it is the only path from chase → idleWithBall. The
     * 1.5s duration is intentionally shorter than the normal idleWithBall timer
     * so the pet returns to idle quickly after picking up the ball. If this
     * transition is broken, the pet would continue chasing a deactivated ball
     * forever or transition to sitIdle without ever entering the ball-holding
     * pose.
     *
     * Design note: main.ts detects ball.active=false, calls onBallLanded(), then
     * sets ball=null — pets always receive ball=null (not an inactive ball) in
     * update() after the ball lands.
     *
     * If violated, the ball-catch animation (idleWithBall) never plays after
     * the ball lands, and the onTransition callback does not fire for
     * persistence.
     */
    // GIVEN — a pet in chase state, an onTransition spy
    const pet = makePet();
    pet.state = 'chase';
    pet['_timer'] = 10; // large timer so only onBallLanded changes state
    const onTransition = vi.fn();
    pet.onTransition = onTransition;

    // WHEN — main.ts detects ball.active=false and calls onBallLanded()
    pet.onBallLanded();

    // THEN — state is idleWithBall, timer is 1.5, callback fired once
    expect(pet.state).toBe('idleWithBall');
    expect(pet['_timer']).toBe(1.5);
    expect(onTransition).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

describe('Pet FSM — movement', () => {
  it('moves left (decreasing x) when in walkLeft state', () => {
    /**
     * Verifies that the walkLeft state causes the pet's x position to decrease
     * over time at the specified rate (~80px/s).
     *
     * This matters because if movement is not applied, pets appear to slide or
     * teleport rather than walk, breaking the visual illusion.
     *
     * If violated, pets in walkLeft play the walk animation but do not move.
     */
    // GIVEN — a pet in walkLeft with a running timer (non-zero, so no transition)
    const pet = makePet({ x: 200 });
    pet.state = 'walkLeft';
    pet['_timer'] = 10; // large timer so no transition fires

    // WHEN — advance 1 second
    const startX = pet.x;
    pet.update(1, null);

    // THEN — x decreased (moved left)
    expect(pet.x).toBeLessThan(startX);
  });

  it('moves right (increasing x) when in walkRight state', () => {
    /**
     * Verifies that the walkRight state causes x to increase over time.
     *
     * Symmetric to the walkLeft movement test — ensures bidirectional movement
     * is correctly applied.
     *
     * If violated, pets in walkRight stand still despite playing the walk
     * animation.
     */
    // GIVEN — a pet in walkRight with a running timer
    const pet = makePet({ x: 200 });
    pet.state = 'walkRight';
    pet['_timer'] = 10;

    // WHEN — advance 1 second
    const startX = pet.x;
    pet.update(1, null);

    // THEN — x increased (moved right)
    expect(pet.x).toBeGreaterThan(startX);
  });

  it('does not move in sitIdle state', () => {
    /**
     * Verifies that a pet in sitIdle does not change its x position.
     *
     * This matters because idle pets should appear stationary. Movement during
     * idle would make the idle animation look like it's floating.
     *
     * If violated, pets drift even when sitting still.
     */
    // GIVEN — a pet in sitIdle with a running timer
    const pet = makePet({ x: 200 });
    pet['_timer'] = 10;

    // WHEN — advance 1 second
    const startX = pet.x;
    pet.update(1, null);

    // THEN — x unchanged
    expect(pet.x).toBe(startX);
  });

  it('clamps x to 0 when walking left past the left edge', () => {
    /**
     * Verifies that a pet walking left is clamped at x=0 and does not go
     * off the left side of the canvas.
     *
     * This matters because allowing negative x would render the pet off-screen
     * or partially clipped, breaking the visual layout.
     *
     * If violated, pets disappear off the left edge of the screen.
     */
    // GIVEN — a pet near the left edge
    const pet = makePet({ x: 5 });
    pet.state = 'walkLeft';
    pet['_timer'] = 10;

    // WHEN — advance enough time to walk past the left edge
    pet.update(1, null);

    // THEN — x is clamped at 0
    expect(pet.x).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// onTransition callback
// ---------------------------------------------------------------------------

describe('Pet FSM — onTransition callback', () => {
  it('calls onTransition after a state change', () => {
    /**
     * Verifies that the onTransition callback fires exactly once after each
     * FSM state change.
     *
     * This matters because main.ts wires onTransition for persistence — if it
     * never fires, pet state is never saved and reloads would lose progress.
     *
     * If violated, pet state changes silently without triggering persistence.
     */
    // GIVEN — a pet with a transition callback attached
    const pet = makePet();
    const callback = vi.fn();
    pet.onTransition = callback;
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // deterministic transition

    // WHEN — advance past timer to trigger transition
    pet.update(5, null);

    // THEN — callback was called
    expect(callback).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
  });

  it('does not call onTransition when no state change occurs', () => {
    /**
     * Verifies that onTransition is NOT called when the timer is still running
     * and no state transition fires.
     *
     * This matters because spurious persistence writes on every tick would
     * cause unnecessary storage I/O and could corrupt state if writes are
     * non-atomic.
     *
     * If violated, persistence is triggered on every frame, degrading
     * performance.
     */
    // GIVEN — a pet with a long-running timer and a callback
    const pet = makePet();
    const callback = vi.fn();
    pet.onTransition = callback;
    pet['_timer'] = 10; // won't expire in the update below

    // WHEN — advance a small dt (timer doesn't expire)
    pet.update(0.016, null);

    // THEN — callback was not called
    expect(callback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// feed() method
// ---------------------------------------------------------------------------

describe('Pet FSM — feed()', () => {
  it('transitions pet from sitIdle to eat state when fed', () => {
    /**
     * Verifies that calling feed() on a pet in sitIdle immediately transitions
     * it to the 'eat' state with a 2-second timer.
     *
     * This matters because the eat state is the only way feeding is communicated
     * visually. If feed() does not transition state, no eat animation or emoji
     * burst would trigger.
     *
     * If violated, clicking a pet does nothing visually and the feeding
     * interaction never plays.
     */
    // GIVEN — a pet in sitIdle state
    const pet = makePet();
    expect(pet.state).toBe('sitIdle');

    // WHEN — feed() is called
    const result = pet.feed();

    // THEN — returns true and pet enters eat state with a 2-second timer
    expect(result).toBe(true);
    expect(pet.state).toBe('eat');
    expect(pet['_timer']).toBe(2);
  });

  it('transitions pet from sleep to eat when fed', () => {
    /**
     * Verifies that feed() works from states other than sitIdle (e.g., sleep).
     *
     * This matters because a user can click a pet at any time, regardless of
     * its current state. Feed should be accepted from all non-chase states.
     *
     * If violated, feeding only works from sitIdle and is ignored in other
     * non-chase states, creating confusing UX.
     */
    // GIVEN — a pet in sleep state
    const pet = makePet();
    pet.state = 'sleep';
    pet['_timer'] = 10;

    // WHEN — feed() is called
    const result = pet.feed();

    // THEN — returns true and pet enters eat state
    expect(result).toBe(true);
    expect(pet.state).toBe('eat');
    expect(pet['_timer']).toBe(2);
  });

  it('does nothing when feed() is called while chasing', () => {
    /**
     * Verifies that feed() is a no-op when the pet is in the 'chase' state.
     *
     * This matters because chase is an autonomous behavior that should not be
     * interrupted by user interaction — interrupting it would leave the ball
     * chasing system in an inconsistent state.
     *
     * If violated, feeding during a chase cancels the ball-chasing behavior and
     * could cause the ball to never be "caught", breaking the game loop.
     */
    // GIVEN — a pet in chase state
    const pet = makePet();
    pet.state = 'chase';
    pet['_timer'] = 5;

    // WHEN — feed() is called
    const result = pet.feed();

    // THEN — returns false and state and timer are unchanged
    expect(result).toBe(false);
    expect(pet.state).toBe('chase');
    expect(pet['_timer']).toBe(5);
  });

  it('calls onTransition after feed() successfully transitions state', () => {
    /**
     * Verifies that the onTransition callback fires when feed() triggers a
     * state change (and does NOT fire when feed() is a no-op in chase).
     *
     * This matters because onTransition drives persistence. If it does not fire
     * on feed, the eat state is never saved and the pet could reload in an
     * inconsistent state.
     *
     * If violated, feeding a pet does not persist and the state is lost on
     * page reload.
     */
    // GIVEN — a pet in sitIdle with a transition spy
    const pet = makePet();
    const onTransition = vi.fn();
    pet.onTransition = onTransition;

    // WHEN — feed() is called
    const result = pet.feed();

    // THEN — returns true and callback fires exactly once
    expect(result).toBe(true);
    expect(onTransition).toHaveBeenCalledOnce();
  });

  it('eat state transitions to sitIdle after its 2-second timer expires', () => {
    /**
     * Verifies that after feed() puts the pet in 'eat', the normal FSM timer
     * eventually returns it to 'sitIdle' (the eat → sitIdle transition).
     *
     * This matters because the eat animation should last exactly 2 seconds and
     * then automatically end. If the pet stays in eat forever, it never resumes
     * normal wandering behavior.
     *
     * If violated, pets get stuck in the eat state permanently after being fed.
     */
    // GIVEN — a pet that has just been fed (eat state, timer=2)
    const pet = makePet();
    pet.feed();
    expect(pet.state).toBe('eat');

    // WHEN — advance time past the 2-second eat timer
    pet.update(2.1, null);

    // THEN — pet returned to sitIdle
    expect(pet.state).toBe('sitIdle');
  });
});

// ---------------------------------------------------------------------------
// startChase() and onBallLanded()
// ---------------------------------------------------------------------------

describe('Pet FSM — startChase()', () => {
  it('immediately transitions any state to chase, bypassing the timer', () => {
    /**
     * Verifies that startChase() forces the pet into the chase state regardless
     * of its current state or timer value.
     *
     * This matters because throwBall() must cause ALL pets to start chasing
     * immediately, even mid-walk or mid-sleep. If the timer is not bypassed,
     * some pets would continue their current behavior until their timer naturally
     * expires, which could take seconds.
     *
     * If violated, some pets ignore the ball throw and only start chasing after
     * their current timer expires.
     */
    // GIVEN — a pet in the middle of a sleep cycle (large timer)
    const pet = makePet();
    pet.state = 'sleep';
    pet['_timer'] = 7;

    // WHEN — startChase() called
    pet.startChase();

    // THEN — state is chase immediately
    expect(pet.state).toBe('chase');
  });

  it('fires onTransition when startChase() is called', () => {
    /**
     * Verifies that the onTransition callback fires when startChase() causes
     * a state change.
     *
     * This matters because onTransition drives persistence; if it does not fire
     * when chasing begins, the transition is not saved and the pet could reload
     * in the wrong state.
     *
     * If violated, the chase start is not persisted and reloading mid-chase
     * could produce incorrect behavior.
     */
    // GIVEN — a pet with an onTransition spy
    const pet = makePet();
    const onTransition = vi.fn();
    pet.onTransition = onTransition;

    // WHEN — startChase() called
    pet.startChase();

    // THEN — callback fired once
    expect(onTransition).toHaveBeenCalledOnce();
  });
});

describe('Pet FSM — onBallLanded()', () => {
  it('transitions a chasing pet to idleWithBall with 1.5s timer', () => {
    /**
     * Verifies that onBallLanded() moves a chasing pet into idleWithBall with
     * the correct 1.5-second timer.
     *
     * This matters because idleWithBall is the "ball caught" visual. Without
     * it, pets never display the with_ball GIF and the interaction has no
     * satisfying conclusion.
     *
     * If violated, pets remain in chase state forever when the ball lands.
     */
    // GIVEN — a pet in chase state
    const pet = makePet();
    pet.state = 'chase';
    pet['_timer'] = 5;

    // WHEN — onBallLanded() called
    pet.onBallLanded();

    // THEN — state is idleWithBall with 1.5s timer
    expect(pet.state).toBe('idleWithBall');
    expect(pet['_timer']).toBe(1.5);
  });

  it('fires onTransition when onBallLanded() is called from chase', () => {
    /**
     * Verifies that the onTransition callback fires when the ball-landed
     * transition occurs, ensuring persistence captures the state change.
     *
     * If violated, the idleWithBall state is not persisted and a reload
     * could miss the transition.
     */
    // GIVEN — a pet in chase with an onTransition spy
    const pet = makePet();
    pet.state = 'chase';
    const onTransition = vi.fn();
    pet.onTransition = onTransition;

    // WHEN — onBallLanded() called
    pet.onBallLanded();

    // THEN — callback fired once
    expect(onTransition).toHaveBeenCalledOnce();
  });
});

describe('Pet FSM — chase movement', () => {
  it('moves toward the ball x position when chasing', () => {
    /**
     * Verifies that a chasing pet moves its x coordinate toward the ball's x
     * on each update tick.
     *
     * This matters because the chase state is only visually meaningful if pets
     * physically move toward the ball. Without movement, pets stand in place
     * playing the run animation but never reaching the ball.
     *
     * If violated, pets display the run GIF but don't move — the chase looks broken.
     */
    // GIVEN — a pet at x=100 chasing a ball at x=400
    const pet = makePet({ x: 100 });
    pet.state = 'chase';
    pet['_timer'] = 10;
    const ball: Ball = { settled: false, x: 400, y: 300 };

    // WHEN — advance 1 second
    pet.update(1, ball, 800);

    // THEN — pet moved toward ball (x increased since ball is to the right)
    expect(pet.x).toBeGreaterThan(100);
  });

  it('moves left when ball is to the left of the pet', () => {
    /**
     * Verifies that a chasing pet decreases x when the ball is to its left.
     *
     * This matters because chase movement must be bidirectional — the ball
     * can land anywhere and pets must converge from either side.
     *
     * If violated, pets only chase balls thrown to the right and ignore balls
     * to their left.
     */
    // GIVEN — a pet at x=400 chasing a ball at x=100 (ball to the left)
    const pet = makePet({ x: 400 });
    pet.state = 'chase';
    pet['_timer'] = 10;
    const ball: Ball = { settled: false, x: 100, y: 300 };

    // WHEN — advance 1 second
    pet.update(1, ball, 800);

    // THEN — pet moved toward ball (x decreased)
    expect(pet.x).toBeLessThan(400);
  });

  it('does not overshoot the ball x when close', () => {
    /**
     * Verifies that a pet chasing a nearby ball does not "jitter" past it on
     * each tick — x is clamped so it does not overshoot.
     *
     * This matters because without clamping the pet would oscillate around the
     * ball's x position, jittering rapidly and looking wrong.
     *
     * If violated, pets alternate left/right rapidly at the ball position instead
     * of settling smoothly.
     */
    // GIVEN — a pet 5px to the left of the ball
    const pet = makePet({ x: 395 });
    pet.state = 'chase';
    pet['_timer'] = 10;
    const ball: Ball = { settled: false, x: 400, y: 300 };

    // WHEN — advance 1 second (would move 120px without clamp)
    pet.update(1, ball, 800);

    // THEN — pet did not overshoot (x <= ball.x + small tolerance)
    expect(pet.x).toBeLessThanOrEqual(ball.x + 1);
  });

  it('does not move when ball is null in chase state (inactive ball handled by transition)', () => {
    /**
     * Verifies that a pet in chase state with a null ball does not crash or
     * update position — the chase-exit transition is driven by ball.active,
     * not by movement code.
     *
     * This matters because main.ts sets ball = null after ball.active becomes
     * false and notifies pets via onBallLanded(). If update() tries to access
     * ball.x when ball is null, it would throw.
     *
     * If violated, the game crashes with a TypeError when the ball is cleaned up.
     */
    // GIVEN — a pet in chase state with no ball
    const pet = makePet({ x: 200 });
    pet.state = 'chase';
    pet['_timer'] = 10;

    // WHEN — update with null ball (should not throw)
    expect(() => pet.update(0.016, null, 800)).not.toThrow();

    // THEN — position unchanged (no ball to chase)
    expect(pet.x).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// toData snapshot
// ---------------------------------------------------------------------------

describe('Pet FSM — toData()', () => {
  it('returns a snapshot matching the current pet state', () => {
    /**
     * Verifies that toData() returns a PetData object whose fields match the
     * pet's current runtime state.
     *
     * This matters because toData() is the serialization contract used by
     * persistence and UI layers. If any field is stale or missing, persisted
     * pets would be restored with incorrect position or identity.
     *
     * If violated, pet saves/loads would silently corrupt x or id.
     */
    // GIVEN — a pet with known initial values
    const pet = makePet({ id: 'abc', name: 'Buddy', x: 150, y: 300 });

    // WHEN — read snapshot without any update
    const data = pet.toData();

    // THEN — all fields match construction values
    expect(data.id).toBe('abc');
    expect(data.name).toBe('Buddy');
    expect(data.type).toBe('dog');
    expect(data.color).toBe('brown');
    expect(data.x).toBe(150);
    expect(data.y).toBe(300);
  });

  it('returns updated x after movement', () => {
    /**
     * Verifies that toData() reflects position changes after update() is called.
     *
     * This matters because toData() is the source of truth for persistence.
     * If it returns stale x, pets would teleport back to their last saved
     * position on reload.
     *
     * If violated, pet position is not saved and pets always respawn at their
     * original location.
     */
    // GIVEN — a pet walking right
    const pet = makePet({ x: 200 });
    pet.state = 'walkRight';
    pet['_timer'] = 10;

    // WHEN — advance time then snapshot
    pet.update(1, null);
    const data = pet.toData();

    // THEN — snapshot x reflects the new position
    expect(data.x).toBeGreaterThan(200);
  });
});

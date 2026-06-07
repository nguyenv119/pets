import type { PetData, PetState, PetType } from './types';

// Horizontal movement speed in pixels per second
const WALK_SPEED = 120;
const CHASE_SPEED = 250;
const CHASE_RANGE = 600; // pixels — how far a pet can "see" the ball
export const CATCH_DISTANCE = 25; // pixels — pet considers itself "at" the ball and stops
const CATCH_RESUME = 40;  // pixels — ball must move this far before pet resumes chasing

// Timer range helpers
function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// FSM transition table — returns [nextState, timerSeconds]
function nextState(current: PetState): [PetState, number] {
  const r = Math.random();
  switch (current) {
    case 'sitIdle':
      if (r < 0.4) return ['walkLeft', randBetween(3, 8)];
      if (r < 0.8) return ['walkRight', randBetween(3, 8)];
      return ['sleep', randBetween(4, 8)];

    case 'walkLeft':
      if (r < 0.6) return ['sitIdle', randBetween(2, 4)];
      return ['walkRight', randBetween(3, 8)];

    case 'walkRight':
      if (r < 0.6) return ['sitIdle', randBetween(2, 4)];
      return ['walkLeft', randBetween(3, 8)];

    case 'sleep':
      return ['sitIdle', randBetween(2, 4)];

    case 'idleWithBall':
      return ['sitIdle', randBetween(2, 4)];

    case 'chase':
      // chase exits via catch() (contact), onBallLanded() (loser), or the ball-null fallback in update() — not via timer
      return ['sitIdle', randBetween(2, 4)];

    case 'eat':
      return ['sitIdle', randBetween(1, 2)];
  }
}

export interface Ball {
  active: boolean;
  x: number;
  y: number;
}

export class Pet {
  // Exposed for tests and serialization
  state: PetState;
  x: number;
  y: number;
  /** Direction the pet is facing — used by renderer for sprite flip. */
  facing: 'left' | 'right' = 'right';

  // Internal FSM timer (seconds until next transition)
  // Exposed with _ prefix so tests can force expiry
  _timer: number;

  /** True when chasing and close enough to the ball to stop running. */
  nearBall = false;

  /** True when the pet is moving or facing left (used for sprite flip). */
  facingLeft = false;

  /** True while the cursor is over the pet's sprite — set by content.ts mouseenter/mouseleave.
   *  Not persisted: ephemeral interaction state only. */
  hovered = false;

  /** True when the pet was put to sleep by the nighttime cycle (not by the FSM).
   *  Used to distinguish night-forced sleep from natural sleep so morning can
   *  selectively wake only night-forced sleepers. */
  private _nightSleep = false;

  // Immutable identity fields
  private readonly _id: string;
  private readonly _name: string;
  private readonly _type: PetType;
  private readonly _color: string;

  /** Called after every state change — wired by main.ts for persistence. */
  onTransition?: () => void;

  constructor(data: PetData) {
    this._id = data.id;
    this._name = data.name;
    this._type = data.type;
    this._color = data.color;
    this.x = data.x;
    this.y = data.y;
    this.state = 'sitIdle';
    this._timer = randBetween(2, 4);
  }

  /** Read-only accessor for the pet's type (used by renderer/content for per-type logic). */
  get type(): import('./types').PetType { return this._type; }

  /**
   * Advance the pet by dt seconds.
   * @param dt  Delta time in seconds (capped by caller to max 0.05 per frame).
   * @param ball  Current ball state, or null if no ball exists.
   * @param canvasW  Canvas width used for x clamping. Defaults to window.innerWidth
   *                 when running in a browser context; 0 disables right clamp in tests.
   * @param imgW  Sprite width used for right-edge clamping. Defaults to 32.
   * @param chaseOffset  Horizontal offset from ball center — spreads pets apart when
   *                     multiple pets chase the same ball.
   * @param nightCheck  Optional callback returning true when it is nighttime.
   *                    When true, idle/walk states are forced into sleep and kept
   *                    there until nightCheck returns false. Chase and eat states
   *                    are never interrupted.
   */
  update(dt: number, ball: Ball | null, canvasW?: number, imgW = 32, chaseOffset = 0, nightCheck?: () => boolean): void {
    // While hovered, freeze FSM and movement so the pet stays in frame
    if (this.hovered) return;

    // --- Night cycle ---
    if (nightCheck) {
      const isNight = nightCheck();
      if (isNight) {
        // Force non-interruptible states to sleep
        if (this.state !== 'chase' && this.state !== 'eat' && this.state !== 'sleep') {
          this._nightSleep = true;
          this._transition('sleep', Infinity);
          return;
        }
        // Already night-sleeping: keep the pet asleep (reset timer to prevent FSM wake)
        if (this.state === 'sleep' && this._nightSleep) {
          this._timer = Infinity;
          return;
        }
      } else {
        // Daytime: wake night-forced sleepers
        if (this.state === 'sleep' && this._nightSleep) {
          this._nightSleep = false;
          this._transition('sitIdle', randBetween(2, 4));
          return;
        }
      }
    }

    const effectiveCanvasW: number | undefined =
      canvasW ?? (typeof window !== 'undefined' ? window.innerWidth : undefined);

    // --- Chase logic ---
    if (ball !== null && ball.active) {
      const targetX = ball.x + chaseOffset;
      const petCenter = this.x + imgW / 2;
      const dist = Math.abs(targetX - petCenter);

      // Enter chase if ball is within range and pet isn't eating
      if (this.state !== 'chase' && this.state !== 'eat' && dist < CHASE_RANGE) {
        this._transition('chase', 999); // timer irrelevant — exits via ball.active
      }

      // Move toward ball while chasing
      if (this.state === 'chase') {
        if (this.nearBall) {
          if (dist > CATCH_RESUME) {
            this.nearBall = false;
          }
        } else if (dist <= CATCH_DISTANCE) {
          this.nearBall = true;
        }

        if (!this.nearBall) {
          if (targetX < petCenter) {
            this.x -= CHASE_SPEED * dt;
            this.facingLeft = true;
          } else {
            this.x += CHASE_SPEED * dt;
            this.facingLeft = false;
          }
        }
        // Clamp
        if (this.x < 0) this.x = 0;
        if (effectiveCanvasW !== undefined && this.x > effectiveCanvasW - imgW) {
          this.x = effectiveCanvasW - imgW;
        }
        return;
      }
    }

    // Ball deactivated while chasing → return to sitIdle (only the catcher
    // gets idleWithBall, via catch() called by content.ts on contact)
    if (this.state === 'chase' && (ball === null || !ball.active)) {
      this.nearBall = false;
      this._transition('sitIdle', 1.5);
      return;
    }

    // --- Normal FSM ---
    this._timer -= dt;

    if (this.state === 'walkLeft') {
      this.facingLeft = true;
      this.x -= WALK_SPEED * dt;
      if (this.x <= 0) {
        this.x = 0;
        this._transition('walkRight', randBetween(3, 8));
      }
    } else if (this.state === 'walkRight') {
      this.facingLeft = false;
      this.x += WALK_SPEED * dt;
      if (effectiveCanvasW !== undefined && this.x >= effectiveCanvasW - imgW) {
        this.x = effectiveCanvasW - imgW;
        this._transition('walkLeft', randBetween(3, 8));
      }
    }

    // Trigger state transition when timer expires
    if (this._timer <= 0) {
      const [ns, t] = nextState(this.state);
      this._transition(ns, t);
    }
  }

  /** Force the pet into chase state immediately, bypassing the FSM timer. */
  startChase(): void {
    this._transition('chase', Infinity);
  }

  /** Called on non-catching chasers when another pet contacts the ball; recipients return to sitIdle. */
  onBallLanded(): void {
    this._transition('sitIdle', 1.5);
  }

  /**
   * Called by content.ts when this pet is the first to physically contact the
   * ball. Clears nearBall and transitions to idleWithBall so the pet holds the
   * ball sprite. All other chasers receive onBallLanded() instead.
   */
  catch(): void {
    this.nearBall = false;
    this._transition('idleWithBall', 1.5);
  }

  /** Feed the pet: transitions to eat for 2s. No-op if currently chasing.
   * Returns true if the transition happened, false if it was a no-op. */
  feed(): boolean {
    if (this.state === 'chase') return false;
    this._transition('eat', 2);
    return true;
  }

  /** Returns a serializable snapshot of this pet's current state. */
  toData(): PetData {
    return {
      id: this._id,
      name: this._name,
      type: this._type,
      color: this._color,
      x: this.x,
      y: this.y,
    };
  }

  private _transition(newState: PetState, timer: number): void {
    this.state = newState;
    this._timer = timer;
    this.onTransition?.();
  }
}

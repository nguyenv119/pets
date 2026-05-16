import type { PetData, PetState, PetType } from './types';

// Horizontal movement speed in pixels per second
const WALK_SPEED = 120;
const CHASE_SPEED = 250;
const CHASE_RANGE = 600; // pixels — how far a pet can "see" the ball
const CATCH_DISTANCE = 25; // pixels — pet considers itself "at" the ball and stops

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
      // chase exits via ball.active check in update(), not via timer
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

  // Internal FSM timer (seconds until next transition)
  // Exposed with _ prefix so tests can force expiry
  _timer: number;

  /** True when chasing and close enough to the ball to stop running. */
  nearBall = false;

  /** True when the pet is moving or facing left (used for sprite flip). */
  facingLeft = false;

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

  /**
   * Advance the pet by dt seconds.
   * @param dt  Delta time in seconds (capped by caller to max 0.05 per frame).
   * @param ball  Current ball state, or null if no ball exists.
   * @param canvasW  Canvas width used for x clamping. Defaults to window.innerWidth
   *                 when running in a browser context; 0 disables right clamp in tests.
   * @param imgW  Sprite width used for right-edge clamping. Defaults to 32.
   * @param chaseOffset  Horizontal offset from ball center — spreads pets apart when
   *                     multiple pets chase the same ball.
   */
  update(dt: number, ball: Ball | null, canvasW?: number, imgW = 32, chaseOffset = 0): void {
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
        if (dist <= CATCH_DISTANCE) {
          // Close enough — stop running, just stand near the ball
          this.nearBall = true;
        } else {
          this.nearBall = false;
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
        return; // skip normal FSM while chasing
      }
    }

    // Ball deactivated while chasing → idle with ball
    if (this.state === 'chase' && (ball === null || !ball.active)) {
      this.nearBall = false;
      this._transition('idleWithBall', 1.5);
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

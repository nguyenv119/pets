import type { PetData, PetState, PetType } from './types';

// Horizontal movement speed in pixels per second
const WALK_SPEED = 120;

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
   */
  update(dt: number, ball: Ball | null, canvasW?: number, imgW = 32): void {
    // Chase logic: check if ball deactivated while chasing
    if (this.state === 'chase' && ball !== null && !ball.active) {
      this._transition('idleWithBall', 1.5);
      return;
    }

    // Decrement timer
    this._timer -= dt;

    const effectiveCanvasW: number | undefined =
      canvasW ?? (typeof window !== 'undefined' ? window.innerWidth : undefined);

    if (this.state === 'walkLeft') {
      this.x -= WALK_SPEED * dt;
      if (this.x <= 0) {
        this.x = 0;
        this._transition('walkRight', randBetween(3, 8));
      }
    } else if (this.state === 'walkRight') {
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

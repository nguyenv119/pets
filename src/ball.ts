export class Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active = true;
  readonly radius = 8;
  private readonly _canvasW: number;
  private readonly _groundY: number;

  constructor(startX: number, canvasW: number, canvasH: number) {
    this.x = startX;
    this.y = canvasH - 20;
    this.vy = -700;
    this.vx = (Math.random() - 0.5) * 500;
    this._canvasW = canvasW;
    this._groundY = canvasH - this.radius;
  }

  update(dt: number): void {
    this.vy += 980 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y >= this._groundY) {
      this.y = this._groundY;
      this.vy *= -0.55;
      this.vx *= 0.85;
      if (Math.abs(this.vy) < 30) this.active = false;
    }
    if (this.x < 0 || this.x > this._canvasW) this.vx *= -1;
  }
}

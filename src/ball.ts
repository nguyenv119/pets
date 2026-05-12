export class Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  settled = false;
  readonly radius = 8;
  private readonly _canvasW: number;
  private readonly _groundY: number;

  constructor(canvasW: number, groundY: number) {
    this.x = Math.random() * canvasW;
    this.y = -this.radius;            // above the viewport
    this.vy = 0;                      // no upward launch — just fall
    this.vx = (Math.random() - 0.5) * 80;  // gentle horizontal drift
    this._canvasW = canvasW;
    // Ball bottom should align with pets' feet (pet tops are at groundY, sprites are DRAW_W tall)
    this._groundY = groundY + 56 - this.radius; // 56 = DRAW_W(64) - some visual margin
  }

  update(dt: number): void {
    if (this.settled) return;  // resting — no physics update
    this.vy += 980 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
    if (this.x > this._canvasW) { this.x = this._canvasW; this.vx = -Math.abs(this.vx); }
    if (this.y >= this._groundY) {
      this.y = this._groundY;
      this.vy *= -0.55;
      this.vx *= 0.85;
      if (Math.abs(this.vy) < 30) {
        this.vy = 0;
        this.vx = 0;
        this.settled = true;
      }
    }
  }
}

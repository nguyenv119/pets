import type { Pet } from './pet';
import type { Ball } from './pet';
import type { PetState, PetType } from './types';

// Fixed draw size — all sprites rendered at this size for visual consistency.
// Exported so main.ts can pass DRAW_W as imgW to pet.update() for correct clamping.
export const DRAW_W = 64;
export const DRAW_H = 64;

// Map from PetState to the filename segment used in the asset path
const STATE_TO_GIF: Record<PetState, string> = {
  sitIdle: 'idle',
  walkLeft: 'walk',
  walkRight: 'walk',
  sleep: 'lie',
  chase: 'run',
  idleWithBall: 'with_ball',
};

const DOG_COLORS = ['brown', 'black'] as const;
const FOX_COLORS = ['red', 'white'] as const;

type SpriteMap = Map<PetType, Map<string, Map<PetState, HTMLImageElement>>>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load sprite: ${src}`));
    img.src = src;
  });
}

/**
 * Pre-loads all GIF sprites for every pet type, color, and state.
 * Returns a nested Map: type → color → state → HTMLImageElement.
 */
export async function loadAllSprites(): Promise<SpriteMap> {
  const map: SpriteMap = new Map();

  const entries: Array<[PetType, string]> = [
    ...DOG_COLORS.map((c): [PetType, string] => ['dog', c]),
    ...FOX_COLORS.map((c): [PetType, string] => ['fox', c]),
  ];

  const states: PetState[] = ['sitIdle', 'walkLeft', 'walkRight', 'sleep', 'chase', 'idleWithBall'];

  for (const [type, color] of entries) {
    if (!map.has(type)) map.set(type, new Map());
    const colorMap = map.get(type)!;
    if (!colorMap.has(color)) colorMap.set(color, new Map());
    const stateMap = colorMap.get(color)!;

    // walkLeft and walkRight share the same GIF — load once and reuse
    const loadedGifs = new Map<string, HTMLImageElement>();

    for (const state of states) {
      const gifName = STATE_TO_GIF[state];
      if (loadedGifs.has(gifName)) {
        stateMap.set(state, loadedGifs.get(gifName)!);
      } else {
        const src = `assets/${type}/${color}_${gifName}_8fps.gif`;
        const img = await loadImage(src);
        loadedGifs.set(gifName, img);
        stateMap.set(state, img);
      }
    }
  }

  return map;
}

/**
 * Draws a single pet on the canvas.
 * Handles horizontal flip for walkLeft direction.
 * Draws a hunger indicator dot above the pet.
 */
export function drawPet(ctx: CanvasRenderingContext2D, pet: Pet, sprites: SpriteMap): void {
  const data = pet.toData();
  const typeMap = sprites.get(data.type);
  if (!typeMap) return;
  const colorMap = typeMap.get(data.color);
  if (!colorMap) return;
  const img = colorMap.get(pet.state);
  if (!img) return;

  if (pet.state === 'walkLeft') {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-(data.x * 2 + DRAW_W), 0);
    ctx.drawImage(img, data.x, data.y, DRAW_W, DRAW_H);
    ctx.restore();
  } else {
    ctx.drawImage(img, data.x, data.y, DRAW_W, DRAW_H);
  }
}

/**
 * Draws the ball on the canvas as a filled yellow circle.
 */
export function drawBall(ctx: CanvasRenderingContext2D, ball: Ball): void {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'yellow';
  ctx.fill();
}

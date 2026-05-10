import type { Pet } from './pet';
import type { Ball } from './pet';
import type { PetState, PetType } from './types';

// Nominal sprite dimensions — updated at runtime from naturalWidth/naturalHeight.
// Exported so main.ts can pass the correct imgW to pet.update().
export const SPRITE_W = 32;
export const SPRITE_H = 32;

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

  const w = img.naturalWidth || SPRITE_W;
  const h = img.naturalHeight || SPRITE_H;

  if (pet.state === 'walkLeft') {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-(data.x * 2 + w), 0);
    ctx.drawImage(img, data.x, data.y, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, data.x, data.y, w, h);
  }

  // Hunger dot
  const dotX = data.x + w / 2;
  const dotY = data.y - 8;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fillStyle =
    data.hunger >= 80 ? 'green' :
    data.hunger >= 40 ? 'yellow' :
    'red';
  ctx.fill();
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

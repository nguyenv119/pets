// thumbnail.mjs's crop and brand placement, and contact-sheet.mjs's grid.

import { describe, expect, it } from 'vitest';
import { grid } from './contact-sheet.mjs';
import { brandSize, cropAround, MIN_GAP, placeBrand, rectGap, THUMB } from './thumbnail.mjs';

describe('cropAround', () => {
  it('centres a 1280x720 crop on Rex', () => {
    /** The thumbnail is about Rex: he must be in it, unscaled. */
    // GIVEN — Rex mid-frame
    // WHEN
    const c = cropAround({ x: 900, y: 500, w: 128, h: 128 }, 1920, 1080);
    // THEN
    expect(c).toEqual({ x: 324, y: 204, w: 1280, h: 720 });
  });

  it('keeps the crop inside the frame when Rex stands near an edge', () => {
    /** A crop past the frame edge would show padding. */
    // GIVEN — Rex at the bottom right
    // WHEN
    const c = cropAround({ x: 1800, y: 950, w: 128, h: 128 }, 1920, 1080);
    // THEN
    expect(c).toEqual({ x: 640, y: 360, w: 1280, h: 720 });
  });
});

describe('placeBrand', () => {
  it('puts the brand top left when Rex stands at the bottom', () => {
    /** The usual frame: pets on the floor, sky above. */
    // GIVEN
    const rex = { x: 576, y: 560, w: 128, h: 128 };
    // WHEN
    const b = placeBrand([rex]);
    // THEN
    expect(b.x).toBe(48);
    expect(b.y).toBe(48);
    expect(rectGap(b, rex)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it('moves to another corner when the first is too close to a pet', () => {
    /** The brand must never crowd a pet (the same 80 px rule as the captions). */
    // GIVEN — a pet in the top-left corner
    const pet = { x: 60, y: 60, w: 128, h: 128 };
    // WHEN
    const b = placeBrand([pet]);
    // THEN
    expect(b.x).toBe(THUMB.w - 48 - brandSize().w);
    expect(rectGap(b, pet)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it('throws when no corner is clear', () => {
    /** Better no thumbnail than a crowded one. */
    // GIVEN — one huge box over the whole frame
    // WHEN / THEN
    expect(() => placeBrand([{ x: 0, y: 0, w: 1280, h: 720 }])).toThrow(/no corner/);
  });
});

describe('contact-sheet grid', () => {
  it('lays one tile per second, six to a row', () => {
    /** 29.4 s of master = 30 tiles = 5 rows. */
    // GIVEN / WHEN / THEN
    expect(grid(29.4)).toEqual({ cols: 6, rows: 5, n: 30 });
    expect(grid(31)).toEqual({ cols: 6, rows: 6, n: 31 });
  });
});

import { describe, expect, it } from 'vitest';
import { rectDistance, rectsIntersect } from './checks';
import type { FrameView } from './framePets';
import { placeBesidePets, textWidth, wrapCaption } from './overlays';

const AREA = { x: 48, y: 48, w: 1824, h: 936 };
const view = (pets: FrameView['pets']): FrameView => ({ beat: {} as FrameView['beat'], k: 0, unitsPerCss: 2, pets });

describe('wrapCaption', () => {
  it('wraps a 9:16 caption at 18 characters a line, on word boundaries', () => {
    /** vertical_9x16.captions: at most 18 characters a line, two lines. */
    expect(wrapCaption("there's a dog in my inbox.", 18)).toEqual(["there's a dog in", 'my inbox.']);
    expect(wrapCaption('hover: he waves.', 18)).toEqual(['hover: he waves.']);
  });
});

describe('textWidth', () => {
  it('matches the storyboard measurement of VT323 at 72 px', () => {
    /** shots.json measured "adopt: pick one." at 461 px; the layout and checks size pills from this. */
    expect(textWidth('adopt: pick one.', 'VT323', 72)).toBe(461);
  });
});

describe('placeBesidePets', () => {
  it('puts the caption beside the acting pet, 80 px clear of its box', () => {
    /** "beside the acting pet ... at least 80 px from the sprite box": the first choice is to its right. */
    const rex = { x: 600, y: 728, w: 256, h: 256 };
    const { rect, problem } = placeBesidePets(500, 102, [view([{ id: 'rex', box: rex }])], ['rex'], AREA, 'caption');
    expect(problem).toBeUndefined();
    expect(rect.x).toBe(600 + 256 + 80);
    expect(rectDistance(rect, rex)).toBeGreaterThanOrEqual(80);
  });

  it('keeps out of an emitting pet\'s particle column across every frame of the window', () => {
    /** A feed or catch throws particles up a column; a caption inside it would collide with the hearts. */
    const box = { x: 900, y: 728, w: 256, h: 256 };
    const column = { x: 708, y: 88, w: 640, h: 896 };
    const views = [view([{ id: 'rex', box, column }]), view([{ id: 'rex', box: { ...box, x: 300 } }])];
    const { rect, problem } = placeBesidePets(500, 102, views, ['rex'], AREA, 'caption');
    expect(problem).toBeUndefined();
    expect(rectsIntersect(rect, column)).toBe(false);
    expect(rectDistance(rect, { ...box, x: 300 })).toBeGreaterThanOrEqual(80);
  });

  it('reports a problem (a render-failing layout) when no spot clears the pets', () => {
    /** Nothing may silently overlap a pet: an impossible layout fails the render instead. */
    const wall = { x: 0, y: 0, w: 1920, h: 1080 };
    const { problem } = placeBesidePets(500, 102, [view([{ id: 'rex', box: wall }])], ['rex'], AREA, 'b1a caption');
    expect(problem).toMatch(/no spot for b1a caption/);
  });
});

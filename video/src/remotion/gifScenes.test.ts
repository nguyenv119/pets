import { describe, expect, it } from 'vitest';
import { buildGifScenes } from './gifScenes';
import { makeEvents } from './testEvents';

describe('buildGifScenes', () => {
  const shots = {
    fps: 25,
    edit_order: ['s1'],
    viewport: { width: 960, height: 436 },
    shots: [{ id: 's1', beats: [{ name: 'b2a', caption: 'hover: he waves.', caption_at: 'heart_on-1000', caption_out: 'heart_on-100', camera: { zoom: 2, focus: 'pet:rex', move: 'hold', sample: 2 } }] }],
    variants: { readme_gif: { fps: 12.5, scenes: [{ shot: 's1', crop_css: { x: 0, y: 76, w: 960, h: 360 }, in: 'pets_ready', out: 'heart_on+1500', captions: ['hover: he waves.'] }] } },
  };
  const events = makeEvents({ trimBeforeMs: 1000, videoLagMs: 56, observed: [{ t: 1000, kind: 'pets_ready' }, { t: 5000, kind: 'heart_on' }] });
  const { scenes, totalFrames } = buildGifScenes(shots, { s1: events }, { s1: 's1/demo.mp4' });

  it('spans each scene from its in to its out anchor at 12.5 fps', () => {
    /** README GIF: 12.5 fps (8 cs a frame); the scene runs pets_ready -> heart_on+1500 = 5.5 s here. */
    expect(totalFrames).toBe(Math.round(5500 / 80));
    expect(scenes[0].trimBeforeFrames).toBe((1000 + 1000) / 80);
  });

  it('shows each caption over its own beat\'s caption window, shifted by videoLagMs', () => {
    /** The caption must appear when the action does, not at an arbitrary half of the scene. */
    const c = scenes[0].captions[0];
    expect(c.fromFrame).toBe(Math.round((5000 - 1000 + 56 - 1000) / 80));
    expect(c.toFrame).toBe(Math.round((5000 - 100 + 56 - 1000) / 80));
    expect(c.fontPx).toBe(32);
  });

  const withCrop = (crop_css: { x: number; y: number; w: number; h: number }) => ({
    ...shots,
    variants: { readme_gif: { ...shots.variants.readme_gif, scenes: [{ ...shots.variants.readme_gif.scenes[0], crop_css }] } },
  });

  it.each([
    ['the v1 crop runs past the bottom (y + h > height)', { x: 0, y: 180, w: 960, h: 360 }],
    ['it starts above the top (y < 0)', { x: 0, y: -1, w: 960, h: 360 }],
    ['it starts left of the edge (x < 0)', { x: -1, y: 76, w: 960, h: 360 }],
    ['it runs past the right edge (x + w > width)', { x: 1, y: 76, w: 960, h: 360 }],
  ])('throws when a scene crop reaches outside the capture: %s', (_label, crop) => {
    /**
     * What: buildGifScenes rejects a crop that is not wholly inside the 960x436 CSS capture, on every side.
     * Why: the raw capture is the only footage under the GIF band. A crop sized for the v1 540 px viewport
     * (CSS y 180-540), or one a pixel off any edge, leaves rows or columns with no footage, which show the
     * composition's background instead of the page.
     * What breaks: the README GIF ships a strip of black backdrop along one edge.
     */
    // GIVEN — a readme_gif scene with this crop against the 960x436 viewport
    const doc = withCrop(crop);
    // WHEN
    const build = () => buildGifScenes(doc, { s1: events }, { s1: 's1/demo.mp4' });
    // THEN
    expect(build).toThrow(/crop .* outside the 960x436 capture/);
  });

  it('accepts a crop that touches every edge of the capture exactly', () => {
    /**
     * What: the bounds are inclusive, so a full 960x436 crop is allowed.
     * Why: an off-by-one in the check would reject the largest valid crop.
     * What breaks: a full-frame GIF scene would fail at plan time for no reason.
     */
    // GIVEN — a crop equal to the whole viewport
    const doc = withCrop({ x: 0, y: 0, w: 960, h: 436 });
    // WHEN
    const build = () => buildGifScenes(doc, { s1: events }, { s1: 's1/demo.mp4' });
    // THEN
    expect(build).not.toThrow();
  });
});

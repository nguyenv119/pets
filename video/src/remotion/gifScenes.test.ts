import { describe, expect, it } from 'vitest';
import { buildGifScenes } from './gifScenes';
import { makeEvents } from './testEvents';

describe('buildGifScenes', () => {
  const shots = {
    edit_order: ['s1'],
    shots: [{ id: 's1', beats: [{ name: 'b2a', caption: 'hover: he waves.', caption_at: 'heart_on-1000', caption_out: 'heart_on-100', camera: { zoom: 2, focus: 'pet:rex', move: 'hold', sample: 2 } }] }],
    variants: { readme_gif: { fps: 12.5, scenes: [{ shot: 's1', crop_css: { x: 0, y: 180, w: 960, h: 360 }, in: 'pets_ready', out: 'heart_on+1500', captions: ['hover: he waves.'] }] } },
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
});

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAND, V916 } from './make-synthetic-run.mjs';
import { readJson, VIDEO_DIR } from './stage-io.mjs';

const shots = readJson(join(VIDEO_DIR, 'shots.json'));
/** The v1 fixture's pets stand at CSS y 476 (innerHeight 540 - 64). */
const FIXTURE_PET_Y = 476;

describe('the synthetic page-shot stand-ins (v2 capture sizes)', () => {
  for (const [name, g, viewport] of [
    ['16:9', LAND, shots.viewport],
    ['9:16', V916, shots.variants.vertical_9x16.viewport],
  ]) {
    it(`${name}: cuts the fixture to the v2 capture and moves its events by the same amount`, () => {
      /**
       * What: the stand-in video is exactly the shot's capture size (viewport x 2), its event shift is the
       * crop/pad offset in CSS px, and the fixture's pets land at innerHeight - 64 of the v2 viewport.
       * Why: the synthetic run is the real-acceptance render's input; a stand-in whose events disagree with its
       * pixels would frame pets that are not there, and the chrome stage assumes 1920x872 / 1080x1712 captures.
       * What breaks: the acceptance stills show pets off the frame bottom, or the camera aims at empty floor.
       */
      // GIVEN / WHEN — the declared geometry
      // THEN
      expect([g.pad.w, g.pad.h]).toEqual([viewport.width * 2, viewport.height * 2]);
      expect(g.viewport).toEqual({ width: viewport.width, height: viewport.height });
      expect(g.shift).toEqual({ dx: -g.crop.x / 2 || 0, dy: (g.pad.y - g.crop.y) / 2 });
      expect(FIXTURE_PET_Y + g.shift.dy).toBe(viewport.height - 64);
    });
  }
});

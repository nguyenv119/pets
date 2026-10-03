import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAND, V916 } from './make-synthetic-run.mjs';
import { shiftStandinEvents } from './synthetic/page-events.mjs';
import { readJson, VIDEO_DIR } from './stage-io.mjs';

const shots = readJson(join(VIDEO_DIR, 'shots.json'));
const fixture = readJson(join(VIDEO_DIR, 'fixtures', 'events.sample.json'));
/** The fixture's pet boxes: its clicks on a pet carry the pet's rect (the fixture logs no tracks). */
const fixturePetRects = fixture.clicks.filter((c) => c.pet).map((c) => c.rect);

describe('the synthetic page-shot stand-ins (v2 capture sizes)', () => {
  it('reads the fixture pets standing on the v1 floor (innerHeight - 64)', () => {
    /**
     * What: every pet click rect in fixtures/events.sample.json sits at CSS y 540 - 64.
     * Why: the stand-in shifts below assume that floor; a re-recorded fixture with another floor would move them.
     * What breaks: the shift tests below would pass against a fixture they no longer describe.
     */
    // GIVEN / WHEN
    const ys = new Set(fixturePetRects.map((r) => r.y));
    // THEN
    expect(fixturePetRects.length).toBeGreaterThan(0);
    expect(ys).toEqual(new Set([fixture.viewport.height - 64]));
  });

  for (const [name, g, viewport] of [
    ['16:9', LAND, shots.viewport],
    ['9:16', V916, shots.variants.vertical_9x16.viewport],
  ]) {
    it(`${name}: cuts the fixture to the v2 capture and moves its events by the same amount`, () => {
      /**
       * What: the stand-in video is exactly the shot's capture size (viewport x 2), and shiftStandinEvents with the
       * stand-in's shift puts the fixture's pet boxes at innerHeight - 64 of the v2 viewport (372 / 792), with x
       * moved by the crop's CSS offset.
       * Why: the synthetic run is the real-acceptance render's input; a stand-in whose events disagree with its
       * pixels would frame pets that are not there, and the chrome stage assumes 1920x872 / 1080x1712 captures.
       * What breaks: the acceptance stills show pets off the frame bottom, or the camera aims at empty floor.
       */
      // GIVEN — the fixture's events and the stand-in's declared geometry
      expect([g.pad.w, g.pad.h]).toEqual([viewport.width * 2, viewport.height * 2]);
      expect(g.viewport).toEqual({ width: viewport.width, height: viewport.height });
      // WHEN
      const shifted = shiftStandinEvents(fixture, g.shift);
      // THEN
      const petRects = shifted.clicks.filter((c) => c.pet).map((c) => c.rect);
      expect(petRects.map((r) => r.y)).toEqual(fixturePetRects.map(() => viewport.height - 64));
      expect(petRects.map((r) => r.x)).toEqual(fixturePetRects.map((r) => r.x - g.crop.x / 2));
    });
  }
});

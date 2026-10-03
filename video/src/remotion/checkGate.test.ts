import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enforceRenderChecks, RenderCheckError } from './checkGate';
import { planMaster } from './planMaster';
import type { FrameViolation } from './renderChecks';
import { makeEvents, stillPets, VIDEO_ROOT } from './testEvents';
import type { ShotsDoc } from './timeline';

const ONE: FrameViolation[] = [{ frame: 900, element: 'b4b_too camera crop', check: 'crop-pet-margin', detail: 'left crop edge -84px from pet box (margin 16)' }];

describe('enforceRenderChecks', () => {
  it('aborts on a single violating frame, naming the frame and the element', () => {
    /**
     * What: one bad frame throws RenderCheckError whose message names the frame, the element and the check.
     * Why: the bead's contract: the render aborts on any violation, naming the frame and the element.
     * What breaks: framing rules become advisory and a clipped pet ships.
     */
    // GIVEN / WHEN / THEN
    expect(() => enforceRenderChecks(ONE)).toThrow(RenderCheckError);
    expect(() => enforceRenderChecks(ONE)).toThrow(/frame 900 b4b_too camera crop: crop-pet-margin/);
  });

  it('passes a clean plan with the one success line', () => {
    /**
     * What: no violations returns the line render.mjs prints.
     * Why: render:fixture's evidence is that line.
     * What breaks: a clean plan could not be told from an unchecked one.
     */
    // GIVEN / WHEN
    const line = enforceRenderChecks([]);
    // THEN
    expect(line).toBe('render checks: every frame passes');
  });
});

describe('planMaster (integration: the planner and checks render.mjs runs, no Remotion)', () => {
  // One shot, one 2.0x hold on Rex (CSS x 400: crop stage x 384-1344) with Bao standing across its right edge (CSS x 650: stage 1300-1428).
  const shots: ShotsDoc = {
    fps: 25,
    edit_order: ['s1'],
    shots: [{ id: 's1', beats: [{ name: 'b_hold', in: 'pets_ready', out: 'pets_ready+2000', camera: { zoom: 2, focus: 'pet:rex', move: 'hold', sample: 2 } }] }],
  };
  const roster = [
    { id: 'rex', name: 'Rex', type: 'dog', color: 'brown' },
    { id: 'bao', name: 'Bao', type: 'panda', color: 'black' },
  ];
  const input = (shim: string) => ({
    shots,
    eventsByShotId: { s1: makeEvents({ shim, roster, tracks: stillPets({ rex: 400, bao: 650 }), observed: [{ t: 500, kind: 'pets_ready' }] }) },
    sourceByShotId: { s1: '/run/s1/demo.mp4' },
    stagedByShotId: { s1: 's1/demo.mp4' },
    port: false,
    mode: 'synthetic' as const,
    musicPath: '/abs/music.ogg',
    musicSrc: 'music/cat_caffe.ogg',
    iconPath: 'icons/icon-128.png',
  });

  for (const shim of ['fixture', 'v3;seed=1']) {
    it(`aborts a plan with a clipped pet whatever the recordings' shim ("${shim}")`, () => {
      /**
       * What: planMaster throws RenderCheckError naming b_hold's camera crop, for stand-in data (shim
       * "fixture") exactly as for a recorded take.
       * Why: the stand-in bypass is gone: no shim, mode or flag lets a violating plan render.
       * What breaks: a synthetic or real run renders past a clipped pet.
       */
      // GIVEN
      const args = input(shim);
      // WHEN / THEN
      expect(() => planMaster(args)).toThrow(RenderCheckError);
      expect(() => planMaster(args)).toThrow(/frame \d+ b_hold camera crop: crop-pet-margin/);
    });
  }
});

describe('render.mjs --fixture --plan-only (integration, subprocess)', () => {
  it('plans the committed fixture with every frame passing, exits 0, and leaves out/timeline.json alone', () => {
    /**
     * What: the real CLI on the committed fixture prints "render checks: every frame passes", exits 0,
     * and does not touch out/timeline.json (no render happened).
     * Why: render:fixture renders before any recording exists, so with the bypass gone it must pass
     * honestly. And timeline.json is written only beside a master that rendered, or verify.mjs pairs a
     * new timeline with an old mp4.
     * What breaks: npm run render:fixture aborts, or the eval judges a master against the wrong timeline.
     */
    // GIVEN — out/timeline.json's state before
    const tl = join(VIDEO_ROOT, 'out', 'timeline.json');
    const before = existsSync(tl) ? statSync(tl).mtimeMs : null;
    // WHEN
    const r = spawnSync('npx', ['tsx', 'scripts/render.mjs', '--fixture', '--plan-only'], { cwd: VIDEO_ROOT, encoding: 'utf8' });
    // THEN
    expect(r.stdout).toMatch(/render checks: every frame passes/);
    expect(r.status).toBe(0);
    expect(existsSync(tl) ? statSync(tl).mtimeMs : null).toBe(before);
  }, 60_000);
});

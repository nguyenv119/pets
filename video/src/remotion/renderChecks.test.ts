import { describe, expect, it } from 'vitest';
import { STAGE_16X9 } from './camera';
import type { TextItem } from './overlays';
import { runRenderChecks } from './renderChecks';
import { makeEvents, stillPets } from './testEvents';
import type { EditBeat, EditTimeline, ShotsDoc } from './timeline';

const FULL = { x: 0, y: 0, w: 1920, h: 1080 };
const shots: ShotsDoc = { edit_order: ['s1'], shots: [{ id: 's1', beats: [] }] };

function pageEdit(crops: { x: number; y: number; w: number; h: number }[]): EditTimeline {
  const beat = { name: 'b2a_hover', shotId: 's1', shiftMs: 0, k0: 0, k1: crops.length, frameCrops: crops, master_t: 0, source_t: 0, source_in: 0, source_out: crops.length * 40, source: '/x', master_in: 0, master_out: crops.length * 40 } as EditBeat;
  return { music: 'm', fps: 25, beats: [beat], totalFrames: crops.length };
}

describe('runRenderChecks', () => {
  // Rex standing at CSS x 400 (stage 800-928, y 856-984): fed at logged t 0, so his particles live 0-1500 ms
  const events = makeEvents({ roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }], tracks: stillPets({ rex: 400 }), observed: [{ t: 0, kind: 'eat', pet: 'rex' }] });

  it('names the frame and the element when a crop edge cuts through a pet', () => {
    /** A 2.0x crop starting at stage x 850 slices Rex (800-928) on every frame; render.mjs must be able to say where. */
    const edit = pageEdit([FULL, { x: 850, y: 492, w: 960, h: 540 }]);
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [] });
    expect(v.map((x) => [x.frame, x.element, x.check])).toEqual([[1, 'b2a_hover camera crop', 'crop-pet-margin']]);
  });

  it('fails a caption placed inside an active feed particle column, and only while the particles live', () => {
    /**
     * conventions.camera.checks: no text inside the particle column of a pet that can emit in that span (from a
     * feed until its particles fade). At 1.0x the column is x 752-976, y 696-984; a caption at (760, 700) sits in it.
     */
    const frames = 50; // 2 s: the particles die at 1.5 s
    const edit = pageEdit(Array.from({ length: frames }, () => FULL));
    const caption: TextItem = { kind: 'caption', beat: 'b2b_treat', lines: ['click: a treat.'], fontPx: 72, fromFrame: 0, toFrame: frames, rect: { x: 760, y: 700, w: 200, h: 60 }, align: 'left' };
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [caption] });
    const column = v.filter((x) => x.check === 'particle-column-overlap').map((x) => x.frame);
    expect(column[0]).toBe(0);
    expect(Math.max(...column)).toBe(37); // 1500 ms / 40 = frame 37.5: the column is gone from frame 38
  });

  it('fails a text layer the layout could not place, at its first frame', () => {
    const edit = pageEdit([FULL]);
    const item: TextItem = { kind: 'brand_line', beat: 'b6_brand_line', lines: ['x'], fontPx: 84, fromFrame: 0, toFrame: 1, rect: { x: 160, y: 48, w: 10, h: 84 }, align: 'left', layoutProblem: 'does not fit' };
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [item] });
    expect(v.some((x) => x.check === 'overlay-layout' && x.frame === 0)).toBe(true);
  });
});

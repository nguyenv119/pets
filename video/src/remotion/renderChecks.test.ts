import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Events } from '../schema';
import { STAGE_16X9 } from './camera';
import type { GifScene } from './gifScenes';
import type { TextItem } from './overlays';
import { runGifChecks, runRenderChecks } from './renderChecks';
import { loadSyntheticPopupEvents, makeEvents, stillPets, syntheticCardEdit, VIDEO_ROOT } from './testEvents';
import { buildTimeline, type EditBeat, type EditTimeline, type ShotsDoc } from './timeline';

const FULL = { x: 0, y: 0, w: 1920, h: 1080 };
const shots: ShotsDoc = { fps: 25, edit_order: ['s1'], shots: [{ id: 's1', beats: [] }] };

function pageEdit(crops: { x: number; y: number; w: number; h: number }[]): EditTimeline {
  const beat = { name: 'b2a_hover', shotId: 's1', shiftMs: 0, k0: 0, k1: crops.length, frameCrops: crops, master_t: 0, source_t: 0, source_in: 0, source_out: crops.length * 40, source: '/x', master_in: 0, master_out: crops.length * 40 } as EditBeat;
  return { music: 'm', fps: 25, beats: [beat], totalFrames: crops.length };
}

describe('runRenderChecks: page frames and text layers', () => {
  // Rex standing at CSS x 400 (stage 800-928, y 856-984): fed at logged t 0, so his particles live 0-1500 ms
  const events = makeEvents({ roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }], tracks: stillPets({ rex: 400 }), observed: [{ t: 0, kind: 'eat', pet: 'rex' }] });

  it('names the frame and the element when a crop edge cuts through a pet', () => {
    /**
     * What: a 2.0x crop whose left edge (stage x 850) slices Rex (800-928) is reported on that frame, as
     * that beat's camera crop.
     * Why: render.mjs aborts naming the frame and the element; without both, nobody can find the bad
     * frame in a 1,200-frame master.
     * What breaks: a clipped pet ships, or the abort message points nowhere.
     */
    // GIVEN — a full frame, then a 2.0x crop through Rex
    const edit = pageEdit([FULL, { x: 850, y: 492, w: 960, h: 540 }]);
    // WHEN
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [] });
    // THEN
    expect(v.map((x) => [x.frame, x.element, x.check])).toEqual([[1, 'b2a_hover camera crop', 'crop-pet-margin']]);
  });

  it('skips a hidden pet when checking crop edges', () => {
    /**
     * What: a pet the roster marks hidden is not on screen, so a crop through its logged box passes.
     * Why: the crop check reads visiblePetBoxesStage, the same pets the camera frames; a hidden pet's
     * stale box would fail honest crops.
     * What breaks: a take with a hidden pet could never render.
     */
    // GIVEN — Rex hidden, the same crop through his box
    const hidden = makeEvents({ roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown', hidden: true }], tracks: stillPets({ rex: 400 }) });
    const edit = pageEdit([{ x: 850, y: 492, w: 960, h: 540 }]);
    // WHEN
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: hidden }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [] });
    // THEN
    expect(v).toEqual([]);
  });

  it('fails a caption placed inside an active feed particle column, and only while the particles live', () => {
    /**
     * What: conventions.camera.checks: no text inside the particle column of a pet that can emit in that
     * span (from a feed until its particles fade, 1500 ms). At 1.0x the column is x 752-976, y 696-984; a
     * caption at (760, 700) sits in it until frame 37.
     * Why: the particle column is checks.ts particleColumn scaled to output px; this pins that the code
     * the render runs is the code the unit tests cover.
     * What breaks: a caption collides with the feed hearts, or is failed after they have faded.
     */
    // GIVEN — 2 s of full frames and a caption inside the column
    const frames = 50;
    const edit = pageEdit(Array.from({ length: frames }, () => FULL));
    const caption: TextItem = { kind: 'caption', beat: 'b2b_treat', lines: ['click: a treat.'], fontPx: 72, fromFrame: 0, toFrame: frames, rect: { x: 760, y: 700, w: 200, h: 60 }, align: 'left' };
    // WHEN
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [caption] });
    // THEN — from frame 0 to 37 (1500 ms / 40 = 37.5), never after
    const column = v.filter((x) => x.check === 'particle-column-overlap').map((x) => x.frame);
    expect(column[0]).toBe(0);
    expect(Math.max(...column)).toBe(37);
  });

  it('fails a text layer the layout could not place, at its first frame', () => {
    /**
     * What: overlays.ts marks an item it could not place clear of the pets (layoutProblem); the checks
     * report it on its first frame.
     * Why: the layout keeps the preferred spot rather than silently overlapping a pet.
     * What breaks: an impossible layout renders over a pet with no error.
     */
    // GIVEN
    const edit = pageEdit([FULL]);
    const item: TextItem = { kind: 'brand_line', beat: 'b6_brand_line', lines: ['x'], fontPx: 84, fromFrame: 0, toFrame: 1, rect: { x: 160, y: 48, w: 10, h: 84 }, align: 'left', layoutProblem: 'does not fit' };
    // WHEN
    const v = runRenderChecks({ edit, shots, eventsByShotId: { s1: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [item] });
    // THEN
    expect(v.some((x) => x.check === 'overlay-layout' && x.frame === 0)).toBe(true);
  });
});

describe('runRenderChecks: the committed fixture take (no tracks: click-rect boxes)', () => {
  const sample = JSON.parse(readFileSync(join(VIDEO_ROOT, 'fixtures', 'shots.sample.json'), 'utf8')) as ShotsDoc;
  const shot = sample.shots[0];
  const fixtureShots: ShotsDoc = { ...sample, edit_order: [shot.id], shots: [shot] };
  const events = JSON.parse(readFileSync(join(VIDEO_ROOT, 'fixtures', 'events.sample.json'), 'utf8')) as Events;
  const plan = () => buildTimeline({ shots: fixtureShots, stage: STAGE_16X9, aspect: '16x9', eventsByShotId: { [shot.id]: events }, sourceByShotId: { [shot.id]: '/x' }, music: 'm', allowEmptyBeats: true });

  it('passes the honest fixture plan, whose camera frames Rex on every frame', () => {
    /**
     * What: render:fixture's 16:9 plan passes every crop check now that the checks see Rex.
     * Why: --fixture must render with every check passing; it is the render that runs before any
     * recording exists.
     * What breaks: render:fixture aborts.
     */
    // GIVEN
    const edit = plan();
    // WHEN
    const v = runRenderChecks({ edit, shots: fixtureShots, eventsByShotId: { [shot.id]: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [] });
    // THEN
    expect(v).toEqual([]);
  });

  it('sees Rex from his click rect, so a crop through him fails', () => {
    /**
     * What: the fixture logs no tracks; the crop check falls back to Rex's click rects (as the camera
     * does) and fails a crop whose edge cuts him.
     * Why: before this fallback the check found no pet boxes on the fixture at all and passed vacuously.
     * What breaks: the fixture render proves nothing about framing.
     */
    // GIVEN — the honest plan with b_hover's crops moved so the right edge cuts Rex's hover rect (CSS x 488-552 = stage 976-1104)
    const edit = plan();
    const hover = edit.beats.find((b) => b.name === 'b_hover')!;
    hover.frameCrops = hover.frameCrops!.map((c) => ({ ...c, x: 1040 - c.w }));
    // WHEN
    const v = runRenderChecks({ edit, shots: fixtureShots, eventsByShotId: { [shot.id]: events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: [] });
    // THEN
    expect(v.some((x) => x.element === 'b_hover camera crop' && x.check === 'crop-pet-margin')).toBe(true);
  });
});

describe('runRenderChecks: the real card beats on the synthetic popup take', () => {
  const check = (f: ReturnType<typeof syntheticCardEdit>) =>
    runRenderChecks({ edit: f.edit, shots: f.shots, eventsByShotId: { s2b_shelter: f.events }, stage: STAGE_16X9, aspect: '16x9', outputWidth: 1920, items: f.items });

  it('passes the honest b3c-b3e card beats', () => {
    /**
     * What: cardTimeline's plan of the three card beats, built from the synthetic run's logged cells and
     * els, passes every card check (crop rule, forbidden cells, uniform scale, steady spot, card end,
     * caption gap and rect).
     * Why: the failing cases below are only meaningful if the honest plan passes.
     * What breaks: every adoption card render aborts.
     */
    // GIVEN
    const f = syntheticCardEdit('16x9');
    // WHEN
    const v = check(f);
    // THEN
    expect(v).toEqual([]);
  });

  it('fails a card frame whose crop meets the fox cell', () => {
    /**
     * What: with the fox cell logged inside crop B's region (CSS x 60-126, y 500-563), every b3d frame
     * fails card-forbidden-cell, naming the fox.
     * Why: an uncast species on the card breaks the adoption story; the eval fails it on every frame.
     * What breaks: a take whose layout shifted renders a fox into the adoption card.
     */
    // GIVEN — the fox moved into B on every logged frame
    const events = loadSyntheticPopupEvents();
    events.tracks = events.tracks!.map((t) => ({ ...t, cells: t.cells?.map((c) => (c.type === 'fox' ? { ...c, x: 60, y: 500 } : c)) }));
    const f = syntheticCardEdit('16x9', events);
    // WHEN
    const v = check(f).filter((x) => x.check === 'card-forbidden-cell');
    // THEN
    const b3d = f.edit.beats.find((b) => b.name === 'b3d_pick')!;
    expect(v.length).toBe(b3d.k1 - b3d.k0);
    expect(v.every((x) => x.element === 'b3d_pick card' && /fox/.test(x.detail))).toBe(true);
  });

  it('fails a b3e frame later than add_mousedown+160', () => {
    /**
     * What: one extra b3e frame (source time add_mousedown+177 ms) fails card-end-mousedown on that
     * frame only.
     * Why: b3e ends on the pressed Add Pet; a later frame shows the mouseup that grows the roster.
     * What breaks: the card lingers into the roster change the take never recorded honestly.
     */
    // GIVEN — the honest plan with b3e one frame longer
    const f = syntheticCardEdit('16x9');
    const b3e = f.edit.beats.find((b) => b.name === 'b3e_add')!;
    const last = b3e.card!.frames[b3e.card!.frames.length - 1];
    b3e.card!.frames.push({ ...last, t: last.t + 40 });
    b3e.cardEnvelopes!.push(b3e.cardEnvelopes![b3e.cardEnvelopes!.length - 1]);
    b3e.k1 += 1;
    // WHEN
    const v = check(f).filter((x) => x.check === 'card-end-mousedown');
    // THEN
    expect(v.map((x) => x.frame)).toEqual([b3e.k1 - 1]);
  });

  it('fails a steady card frame 2 px off steady_at', () => {
    /**
     * What: one steady b3d frame drawn at (326, 72) instead of steady_at (324, 72) fails card-steady-anchor.
     * Why: verify.mjs v10 requires every steady frame on steady_at exactly; the old 2 px allowance let it pass.
     * What breaks: the render passes its own checks and fails the eval's card declaration.
     */
    // GIVEN
    const f = syntheticCardEdit('16x9');
    const b3d = f.edit.beats.find((b) => b.name === 'b3d_pick')!;
    const i = b3d.card!.frames.length - 1;
    b3d.card!.frames[i] = { ...b3d.card!.frames[i], at: { x: 326, y: 72 } };
    // WHEN
    const v = check(f).filter((x) => x.check === 'card-steady-anchor');
    // THEN
    expect(v.map((x) => x.frame)).toEqual([b3d.k0 + i]);
  });
});

describe('runGifChecks', () => {
  // Rex at CSS x 400, y 476-540; the GIF band is CSS y 180-540, so in GIF px he is x 800-928, y 592-720
  const events = makeEvents({ roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }], tracks: stillPets({ rex: 400 }), observed: [{ t: 0, kind: 'eat', pet: 'rex' }] });
  const scene = (rect: { x: number; y: number; w: number; h: number }): GifScene => ({
    shotId: 's1',
    stagedSrc: 's1/demo.mp4',
    sourceInMs: 0,
    fromFrame: 0,
    frames: 50,
    trimBeforeFrames: 0,
    cropCss: { x: 0, y: 180, w: 960, h: 360 },
    captions: [{ kind: 'caption', beat: 'b2b_treat', lines: ['click: a treat.'], fontPx: 32, fromFrame: 0, toFrame: 50, rect, align: 'left' }],
    cursor: { track: [], clicks: [], trimBeforeMs: 0, videoLagMs: 0 },
  });

  it('passes a GIF caption in the band\'s top-left corner, clear of the pets', () => {
    /**
     * What: the README GIF's caption pill at (24, 24) is far from Rex and his particle column.
     * Why: the honest GIF layout must pass, or every --variant gif aborts.
     * What breaks: the README GIF can never be rendered.
     */
    // GIVEN
    const scenes = [scene({ x: 24, y: 24, w: 300, h: 62 })];
    // WHEN
    const v = runGifChecks(scenes, { s1: events }, 12.5, 1920);
    // THEN
    expect(v).toEqual([]);
  });

  it('fails a GIF caption within 80 px of a pet box', () => {
    /**
     * What: a caption ending 40 px left of Rex's GIF box fails overlay-pet-distance.
     * Why: --variant gif ran no checks at all before; text over a pet is the defect the master checks.
     * What breaks: the README GIF ships a caption crowding the dog.
     */
    // GIVEN — a caption at x 460-760, y 600-662
    const scenes = [scene({ x: 460, y: 600, w: 300, h: 62 })];
    // WHEN
    const v = runGifChecks(scenes, { s1: events }, 12.5, 1920);
    // THEN
    expect(v.some((x) => x.check === 'overlay-pet-distance' && x.frame === 0)).toBe(true);
  });

  it('fails a GIF caption inside a fed pet\'s particle column only while the particles live', () => {
    /**
     * What: a caption above Rex inside his particle column (x 752-976, y 432-720 in GIF px) fails until
     * his feed particles fade (1500 ms = GIF frame 18 at 12.5 fps), and passes after.
     * Why: the GIF reuses the master's particle rule; sleeping or idle pets emit nothing.
     * What breaks: the GIF caption sits in the hearts, or a harmless caption is failed forever.
     */
    // GIVEN — a caption at x 760-960, y 440-500: 92 px above his box, inside the column
    const scenes = [scene({ x: 760, y: 440, w: 200, h: 60 })];
    // WHEN
    const v = runGifChecks(scenes, { s1: events }, 12.5, 1920).filter((x) => x.check === 'particle-column-overlap');
    // THEN
    expect(v[0].frame).toBe(0);
    expect(Math.max(...v.map((x) => x.frame))).toBe(18);
  });
});

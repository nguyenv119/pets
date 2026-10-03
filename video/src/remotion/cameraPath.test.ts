import { describe, expect, it } from 'vitest';
import { STAGE_16X9, STAGE_9X16 } from './camera';
import { demoMsShowing, loggedMsAt, shotFrameCrops, type CameraBeatSpan } from './cameraPath';
import { makeEvents, stillPets } from './testEvents';
import type { ShotBeat } from './timeline';

const FULL = { x: 0, y: 0, w: 1920, h: 1080 };
const beat = (name: string, zoom: number, focus: string, move: string, sample: number): ShotBeat => ({ name, camera: { zoom, focus, move, sample } });
/** spans on a 40 ms grid with no shift: master frame k shows demo ms 40k */
const span = (b: ShotBeat, inMs: number, outMs: number): CameraBeatSpan => ({ beat: b, sourceIn: inMs, sourceOut: outMs, k0: inMs / 40, k1: outMs / 40 });

describe('shotFrameCrops: Hold 1.0x until <anchor>, then a 450 ms push', () => {
  // GIVEN — Rex and Bao standing still, pets_ready at 1000, a 56 ms video lag
  const events = makeEvents({ videoLagMs: 56, roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }, { id: 'bao', name: 'Bao', type: 'panda', color: 'black' }], observed: [{ t: 1000, kind: 'pets_ready' }], tracks: stillPets({ rex: 440, bao: 520 }) });
  const b = beat('b4a_hi', 2, 'between:rex,bao', 'Hold 1.0x (page) until pets_ready+400, then push to 2.0x between Rex and Bao (all three pets) over 450 ms, floor-anchored.', 1);
  // WHEN — planning frames 0..2800 ms
  const [crops] = shotFrameCrops({ spans: [span(b, 0, 2800)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25 });

  it('holds exactly 1.0x until the anchor plus videoLagMs', () => {
    /**
     * The hold the eval derives from camera.move ("until pets_ready+400") must be a true still: the
     * full stage on every frame up to the anchor as the recording shows it (log + videoLagMs).
     * A camera that crept early would fail the hold check's end-of-hold aim test.
     */
    expect(crops.slice(0, Math.floor(1456 / 40) + 1).every((c) => c.x === 0 && c.w === 1920)).toBe(true);
  });

  it('eases through fractional zoom only mid-push and lands on an exact 2.0x crop 450 ms later', () => {
    /**
     * master.motion.pushes: holds only at 1.0x and 2.0x, fractional zoom mid-move only. If the push
     * landed off 960x540 the 2.0x hold would draw each pixel at a non-integer size (blurry pixel art).
     */
    const mid = crops[Math.round(1700 / 40)];
    expect(mid.w).toBeLessThan(1920);
    expect(mid.w).toBeGreaterThan(960);
    const after = crops.slice(Math.ceil(1906 / 40) + 1);
    expect(after.every((c) => c.w === 960 && c.h === 540 && c.y === 492)).toBe(true);
    expect(new Set(after.map((c) => c.x)).size).toBe(1);
  });

  it('pushes on ease-out-expo: most of the move happens in the first third', () => {
    /** The punchy snap the brief asks for: a linear push would be only a third of the way at a third of the time. */
    const third = crops[Math.round((1456 + 150) / 40)];
    expect((1920 - third.w) / 960).toBeGreaterThan(0.6);
  });
});

describe('shotFrameCrops: the night push carries into the next beat', () => {
  it('continues the 3000 ms push across the beat cut and holds from its end anchor', () => {
    /**
     * b5_lights_out starts a 3000 ms push at sleep+400 and b6_brand_line ("the push ends at
     * sleep+3400, then hold") cuts in mid-push. The camera must not jump at the cut: b6's first
     * frame continues b5's move, and b6 holds 2.0x from sleep+3400 on.
     */
    // GIVEN — sleep at 1000, three still pets close together
    const events = makeEvents({ observed: [{ t: 1000, kind: 'sleep' }], tracks: stillPets({ rex: 440, bao: 520 }) });
    const b5 = beat('b5', 2, 'between:rex,bao', 'Hold 1.0x until sleep+400, then push to 2.0x between the pets over 3000 ms, easing in and out, floor-anchored.', 1);
    const b6 = beat('b6', 2, 'between:rex,bao', 'the push ends at sleep+3400, then hold', 2);
    // WHEN
    const [c5, c6] = shotFrameCrops({ spans: [span(b5, 0, 3400), span(b6, 3400, 6000)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25 });
    // THEN — the last b5 frame and the first b6 frame are neighbours on one move, and b6 rests at 2.0x after 4400
    const last5 = c5[c5.length - 1];
    const first6 = c6[0];
    expect(first6.w).toBeLessThanOrEqual(last5.w);
    expect(last5.w - first6.w).toBeLessThan(40);
    expect(c6.slice((4400 - 3400) / 40).every((c) => c.w === 960 && c.x === c6[c6.length - 1].x)).toBe(true);
  });
});

describe('shotFrameCrops: holds', () => {
  it('shares one crop across consecutive holds on the same focus, so the cut between them never jitters', () => {
    /** b2a_hover -> b2b_treat both hold 2.0x on Rex: recomputing each beat's own crop would jump a few px at the cut. */
    const events = makeEvents({ tracks: stillPets({ rex: 440 }) });
    const crops = shotFrameCrops({ spans: [span(beat('a', 2, 'pet:rex', 'hold', 2), 0, 800), span(beat('b', 2, 'pet:rex', 'hold', 2), 800, 1600)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25 });
    expect(crops[1][0]).toEqual(crops[0][0]);
  });

  it('renders every frame at the full stage under --no-zoom', () => {
    /** The no-zoom control must truly have no zoom, or the eval's FAIL control would not fail. */
    const events = makeEvents({ tracks: stillPets({ rex: 440 }) });
    const [crops] = shotFrameCrops({ spans: [span(beat('a', 2, 'pet:rex', 'hold', 2), 0, 800)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25, noZoom: true });
    expect(crops.every((c) => JSON.stringify(c) === JSON.stringify(FULL))).toBe(true);
  });

  it('holds the 9:16 2.0x crop at 540x960, canvas y 730', () => {
    /** variants.vertical_9x16.camera.crop: the floor line stays at 1460 at every zoom; verify.mjs expects exactly this rectangle. */
    const events = makeEvents({ tracks: stillPets({ rex: 200 }) });
    const [crops] = shotFrameCrops({ spans: [span(beat('a', 2, 'pet:rex', 'hold', 2), 0, 400)], events, stage: STAGE_9X16, shiftMs: 0, fps: 25 });
    expect(crops[0]).toMatchObject({ w: 540, h: 960, y: 730 });
  });
});

describe('shotFrameCrops: follow', () => {
  it('re-centres on a walking pet frame by frame', () => {
    /** "follow the box track with 400 ms smoothing": the crop moves with the pet, the direction of the walk. */
    const tracks = [];
    for (let t = 0; t <= 4000; t += 40) tracks.push({ t, pets: [{ id: 'rex', x: 200 + t / 10, y: 476, w: 64, h: 64, src: 'walk' }] });
    const events = makeEvents({ tracks });
    const [crops] = shotFrameCrops({ spans: [span(beat('f', 2, 'pet:rex', 'follow', 2), 0, 4000)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25 });
    expect(crops[crops.length - 1].x).toBeGreaterThan(crops[10].x);
    expect(crops.every((c) => c.w === 960)).toBe(true);
  });
});

describe('shotFrameCrops: a hold frames its focus pet on every frame', () => {
  it('centres the held crop on the pet\'s whole span when the pet moves out of the crop picked at the middle', () => {
    /**
     * What: Rex stands at CSS x 200 for most of a 2 s hold at 2.0x, then at x 560 for its last 200 ms. The
     * crop computed at the beat's middle (x 0-960) would lose him; the hold instead centres on his span
     * across the beat and contains his box, 16 stage px clear, on every frame.
     * Why: a hold is one crop for the whole beat; the render checks judge every frame of it, and the
     * fixture's long b_hover (Rex walks between his hover and click rects) aborted on exactly this.
     * What breaks: render:fixture aborts, and a real take whose pet shifts during a hold renders a clipped pet.
     */
    // GIVEN
    const tracks = [];
    for (let t = 0; t <= 2000; t += 40) tracks.push({ t, pets: [{ id: 'rex', x: t < 1800 ? 200 : 560, y: 476, w: 64, h: 64, src: 'idle' }] });
    const events = makeEvents({ tracks });
    // WHEN
    const [crops] = shotFrameCrops({ spans: [span(beat('h', 2, 'pet:rex', 'hold', 2), 0, 2000)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25 });
    // THEN — one crop, and both of Rex's boxes (stage 400-528 and 1120-1248) inside it with the 16 px margin
    expect(new Set(crops.map((c) => JSON.stringify(c))).size).toBe(1);
    const c = crops[0];
    for (const [x0, x1] of [[400, 528], [1120, 1248]]) {
      expect(x0 - c.x).toBeGreaterThanOrEqual(16);
      expect(c.x + c.w - x1).toBeGreaterThanOrEqual(16);
    }
  });

  it('keeps the crop picked at the middle when the pet never leaves it', () => {
    /**
     * What: a still pet gets the same crop as before the span rule (centred on the pet).
     * Why: the span rule only fires when the middle crop would fail the check; honest holds must not move.
     * What breaks: every passing take's framing shifts, and its calibrated eval numbers with it.
     */
    // GIVEN
    const events = makeEvents({ tracks: stillPets({ rex: 440 }) });
    // WHEN
    const [crops] = shotFrameCrops({ spans: [span(beat('h', 2, 'pet:rex', 'hold', 2), 0, 2000)], events, stage: STAGE_16X9, shiftMs: 0, fps: 25 });
    // THEN — centred on Rex's centre (CSS 472 = stage 944): x 464
    expect(crops[0]).toMatchObject({ x: 464, w: 960 });
  });
});

describe('shotFrameCrops: a push lands on the next hold\'s crop', () => {
  const b4a = beat('b4a_hi', 2, 'between:rex,bao', 'Hold 1.0x (page) until pets_ready+400, then push to 2.0x between Rex and Bao (all three pets) over 450 ms, floor-anchored.', 1);
  const b4b = beat('b4b_too', 2, 'between:rex,bao', 'hold', 2);
  /** Rex still at CSS 400; Bao at CSS 480 until 3200 ms (inside b4b, past the 400 ms focus smoothing of b4a's rest), then at `baoLater`. */
  const eventsWith = (baoLater: number) => {
    const tracks = [];
    for (let t = 0; t <= 4000; t += 40) tracks.push({ t, pets: [{ id: 'rex', x: 400, y: 476, w: 64, h: 64, src: 'idle' }, { id: 'bao', x: t < 3200 ? 480 : baoLater, y: 476, w: 64, h: 64, src: 'idle' }] });
    return makeEvents({ observed: [{ t: 1000, kind: 'pets_ready' }], tracks });
  };
  const plan = (baoLater: number) => shotFrameCrops({ spans: [span(b4a, 0, 2800), span(b4b, 2800, 4000)], events: eventsWith(baoLater), stage: STAGE_16X9, shiftMs: 0, fps: 25 });

  it('pushes straight to the re-centred crop of the next same-focus hold when it frames the pets as well', () => {
    /**
     * What: b4a_hi pushes to 2.0x on Rex and Bao; midway through b4b_too Bao steps right, so b4b holds its own
     * re-centred crop. b4a's push lands on that crop (it still frames both pets on b4a's resting frames), so
     * the cut from b4a to b4b moves the camera by 0 px.
     * Why: the sharing rule exists so a hold never jitters a few px at a beat boundary; the synthetic 16:9
     * run jumped 762 -> 758 stage px (8 output px) at exactly this cut.
     * What breaks: a visible nudge of the camera on the b4a -> b4b cut.
     */
    // GIVEN — Bao moves from CSS 480 to 680 inside b4b
    // WHEN
    const [c4a, c4b] = plan(680);
    // THEN — no jump at the cut, and b4a rests on that crop with both pets 16 stage px clear
    expect(c4a[c4a.length - 1]).toEqual(c4b[0]);
    expect(c4b[0].x).not.toBe(464); // not b4a's own crop: the next hold really re-centred
    const rest = c4a[c4a.length - 1];
    for (const [x0, x1] of [[800, 928], [960, 1088]]) {
      expect(x0 - rest.x).toBeGreaterThanOrEqual(16);
      expect(rest.x + rest.w - x1).toBeGreaterThanOrEqual(16);
    }
  });

  it('keeps its own crop when the next hold\'s crop would lose a pet it frames', () => {
    /**
     * What: Bao jumps to CSS 900 inside b4b, so b4b's crop no longer contains Rex where b4a rests; b4a keeps
     * its own crop (x 464, centred between the pets) and the cut stays a cut.
     * Why: a smoother cut never justifies framing a pet out of a held crop the eval checks for containment.
     * What breaks: b4a's declared crop loses Rex and the containment check fails.
     */
    // GIVEN — Bao moves from CSS 480 to 900 inside b4b
    // WHEN
    const [c4a] = plan(900);
    // THEN
    expect(c4a[c4a.length - 1]).toMatchObject({ x: 464, w: 960 });
  });
});

describe('loggedMsAt / demoMsShowing', () => {
  it('are each other\'s inverse: the screen shows a logged event trimBeforeMs + videoLagMs later', () => {
    /**
     * The camera, the GIF gate and qa's provenance frame all convert between
     * the recorder's log clock and demo.mp4's. If the two directions
     * disagreed, qa would compare the GIF with the wrong moment of the
     * recording and fail (or pass) for the wrong reason.
     */
    // GIVEN — a take trimmed at 760 ms whose screen lags the log by 40 ms
    const events = makeEvents({ trimBeforeMs: 760, videoLagMs: 40 });
    // WHEN
    const demo = demoMsShowing(events, 1500);
    // THEN
    expect(demo).toBe(2300);
    expect(loggedMsAt(events, demo)).toBe(1500);
  });
});

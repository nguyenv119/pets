import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findCatchT,
  findGreetEndT,
  findGreetStart,
  findPetsReady,
  firstFrameInState,
  firstMouseoverT,
  hoverPoint,
  spriteState,
  waitAnchor,
} from './timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const s2v916 = JSON.parse(readFileSync(join(HERE, 'testdata', 's2_review_v916.events.json'), 'utf-8'));

const box = (id, src, x = 340) => ({ id, x, y: 476, w: 64, h: 64, src: `chrome-extension://ext/assets/${src}_8fps.gif` });

/**
 * The s3_sheet boot as a real probe observed it (seed 25, 2026-10-03, ms
 * after the start clapper): observe.js attached at 324.5 with no pets yet,
 * all three drawn idle at 355.6, Rex and Pip swiping on the next frame
 * (384.0) and back to idle at 1383.8.
 */
const S3_BOOT_TRACKS = [
  { t: 324.5, pets: [] },
  { t: 355.6, pets: [box('rex', 'dog/brown_idle'), box('bao', 'panda/black_idle', 460), box('pip', 'chicken/white_idle', 399)] },
  { t: 384.0, pets: [box('rex', 'dog/brown_swipe'), box('bao', 'panda/black_idle', 460), box('pip', 'chicken/white_swipe', 399)] },
  { t: 1383.8, pets: [box('rex', 'dog/brown_idle'), box('bao', 'panda/black_idle', 460), box('pip', 'chicken/white_idle', 399)] },
];
const S3_BOOT_SRC = [
  { t: 384.0, pet: 'rex', from: 'idle', to: 'swipe' },
  { t: 384.0, pet: 'pip', from: 'idle', to: 'swipe' },
  { t: 1383.8, pet: 'rex', from: 'swipe', to: 'idle' },
  { t: 1383.8, pet: 'pip', from: 'swipe', to: 'idle' },
];

describe('findPetsReady', () => {
  it('is the first tracked frame with every visible pet drawn, not the first tracked frame', () => {
    /**
     * pets_ready is when the pets appear on film. The shakedown logged it
     * when the choreography got round to checking (690+ ms late), which
     * made the s3 greet window and the s4 night flip impossible to meet.
     */
    // GIVEN — the real s3 boot: an empty first frame, then all three pets
    // WHEN — pets_ready is found for the three visible pets
    const t = findPetsReady(S3_BOOT_TRACKS, ['rex', 'bao', 'pip']);

    // THEN — it is the frame the pets were drawn on
    expect(t).toBe(355.6);
  });

  it('waits for every visible pet, ignoring one drawn alone', () => {
    /** A frame with only some of the pets is not pets_ready (conventions.states.pets_ready: every visible roster pet). */
    // GIVEN — Rex drawn a frame before the others
    const tracks = [{ t: 10, pets: [box('rex', 'dog/brown_idle')] }, ...S3_BOOT_TRACKS.slice(1)];

    // WHEN / THEN — pets_ready waits for the frame with all three
    expect(findPetsReady(tracks, ['rex', 'bao', 'pip'])).toBe(355.6);
  });

  it('is undefined when the pets never appear', () => {
    /** A take whose pets never drew must be discarded, not timed from some other frame. */
    // GIVEN / WHEN / THEN — only the empty frame
    expect(findPetsReady(S3_BOOT_TRACKS.slice(0, 1), ['rex'])).toBeUndefined();
  });
});

describe('greet detection from the logged src history', () => {
  it('finds the boot greet even when the choreography looks only after it started', () => {
    /**
     * The greet starts on the first tick, before any recorder wait runs;
     * the old wait checked the live DOM "now" and could miss or mistime it.
     */
    // GIVEN — the real boot src log, searched from pets_ready
    // WHEN — greet_start is found
    const g = findGreetStart(S3_BOOT_SRC, [], 355.6);

    // THEN — Rex and Pip, 28.4 ms after pets_ready
    expect(g).toEqual({ t: 384.0, pets: ['rex', 'pip'] });
  });

  it('does not count a hovered swipe as a greet', () => {
    /** A swipe under the cursor is a wave (conventions.states.greet_start: neither hovered). */
    // GIVEN — Rex hovered from t=300
    const hover = [{ t: 300, kind: 'mouseover', pet: 'rex' }];

    // WHEN / THEN — no greet pair
    expect(findGreetStart(S3_BOOT_SRC, hover, 355.6)).toBeUndefined();
  });

  it('ends the greet when both pets have left swipe', () => {
    /** greet_end = both leave swipe (the later of the two). */
    // GIVEN / WHEN / THEN — both leave at 1383.8
    expect(findGreetEndT(S3_BOOT_SRC, ['rex', 'pip'], 384.0)).toBe(1383.8);
    expect(findGreetEndT(S3_BOOT_SRC.slice(0, 3), ['rex', 'pip'], 384.0)).toBeUndefined();
  });
});

describe('waitAnchor', () => {
  const anchors = { petsReady: 12.1, dblclick: 1461.6, hoverEntry: 5000, feedMouseup: 7000, hourSet: 9000, greetStart: 384 };

  it("times the run wait from the logged dblclick, not from after the clearing glide", () => {
    /**
     * In the shakedown's real 9:16 s2_review take Rex ran 4.6 ms after the
     * dblclick, but the wait started after the 400 ms glide and counted 400
     * ms from there: 7 of 16 takes were thrown away for a run that was on
     * time. The run wait counts from the dblclick.
     */
    // GIVEN — the real take's dblclick and run src, and "now" after the glide
    const dbl = s2v916.observed.find((e) => e.kind === 'dblclick').t;
    const run = s2v916.observed.find((e) => e.kind === 'src' && e.to === 'run').t;
    const nowAfterGlide = dbl + 430;

    // WHEN — the anchor for "Rex shows run" is chosen
    const since = waitAnchor({ kind: 'wait_state', pet: 'rex', state: 'run', timeout_ms: 400 }, { dblclick: dbl }, nowAfterGlide);

    // THEN — the run falls inside [dblclick, dblclick + 400]
    expect(since).toBe(dbl);
    expect(run - since).toBeCloseTo(4.6, 1);
  });

  it('times each wait from its own logged event', () => {
    /** heart_on from the mouseup, swipe from the hover entry, lie from hour_set, greets from pets_ready / greet_start. */
    // GIVEN / WHEN / THEN
    expect(waitAnchor({ state: 'heart_on' }, anchors, 99999)).toBe(7000);
    expect(waitAnchor({ state: 'swipe', pet: 'rex' }, anchors, 99999)).toBe(5000);
    expect(waitAnchor({ state: 'lie', pet: 'bao' }, anchors, 99999)).toBe(9000);
    expect(waitAnchor({ state: 'greet_start' }, anchors, 99999)).toBe(12.1);
    expect(waitAnchor({ state: 'greet_end' }, anchors, 99999)).toBe(384);
    expect(waitAnchor({ state: 'catch', pet: 'rex' }, anchors, 99999)).toBe(1461.6);
    expect(waitAnchor({ state: 'idle', pet: 'rex' }, anchors, 99999)).toBe(99999);
  });

  it('falls back to now when the anchor event was never logged', () => {
    /** A shot whose choreography has no dblclick still waits sensibly (from the step). */
    // GIVEN / WHEN / THEN
    expect(waitAnchor({ state: 'run', pet: 'rex' }, {}, 42)).toBe(42);
  });
});

describe('catch and sprite-state lookups on the real s2 log', () => {
  const marks = s2v916.observed.filter((e) => ['ball_on', 'ball_off', 'heart_on'].includes(e.kind));

  it('finds the catch as a ball_off with a heart_on within 60 ms', () => {
    /** The live catch wait uses the same pairing as derive.mjs (never run->idle). */
    // GIVEN / WHEN / THEN — the real catch at 2783.9
    expect(findCatchT(marks, 1461.6)).toBeCloseTo(2783.9, 1);
    expect(findCatchT(marks, 2800)).toBeUndefined();
  });

  it('finds the first frame a pet shows a state at or after a time', () => {
    /** Tracks give the state on every frame, so a state already showing is found without a fresh transition. */
    // GIVEN / WHEN
    const runT = firstFrameInState(s2v916.tracks, 'rex', 'run', 1461.6);

    // THEN — Rex is on the run sprite within a frame of the 1466.2 src change
    expect(runT).toBeGreaterThanOrEqual(1461.6);
    expect(runT - 1466.2).toBeLessThan(20);
  });
});

describe('hover helpers', () => {
  it('aims 5 px inside the live box\'s upper-right corner', () => {
    /** conventions.hover_point: the drawn arrow then covers none of Rex's art pixels. */
    // GIVEN / WHEN / THEN — Rex's 64x64 box at (700, 476)
    expect(hoverPoint({ x: 700, y: 476, w: 64, h: 64 })).toEqual({ x: 759, y: 481 });
  });

  it('takes the hover entry as the first mouseover of that pet after the departure', () => {
    /** The swipe rule is timed from the hover entry: the mouseover, not when the glide finished. */
    // GIVEN — an old mouseover before the departure, then the real entry
    const hover = [{ t: 10, kind: 'mouseover', pet: 'rex' }, { t: 20, kind: 'mouseout', pet: 'rex' }, { t: 5012.4, kind: 'mouseover', pet: 'rex' }];

    // WHEN / THEN
    expect(firstMouseoverT(hover, 'rex', 4800)).toBe(5012.4);
  });

  it('reads the sprite state from a src', () => {
    /** idle_with_ball must not be read as idle. */
    // GIVEN / WHEN / THEN — three srcs and their states
    expect(spriteState('chrome-extension://x/assets/dog/brown_idle_with_ball_8fps.gif')).toBe('idle_with_ball');
    expect(spriteState('chrome-extension://x/assets/dog/brown_lie_8fps.gif')).toBe('lie');
    expect(spriteState('nope')).toBeNull();
  });
});

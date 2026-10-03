import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveEvents, _internal } from './derive.mjs';
import { fromLegacyProofRaw } from './fixture-adapter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rawSample = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'raw.sample.json'), 'utf-8'));

function baseContext(overrides = {}) {
  return {
    name: 'derive-test',
    viewport: { width: 960, height: 540 },
    capture: { method: 'cdp-screencast', dpr: 2, fps: 25 },
    extensionId: 'test-ext',
    shim: 'v3;seed=1',
    roster: rawSample.roster,
    durationMs: 20000,
    videoLagMs: 56,
    ...overrides,
  };
}

describe('deriveEvents', () => {
  it('derives a wave from the recorded hover-then-swipe beat', () => {
    // GIVEN — the proof render's real raw log, whose first click beat hovers Rex until he swipes
    const raw = fromLegacyProofRaw(rawSample);

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext());

    // THEN — a wave is recorded for Rex's roster id, because his swipe transition happens while hovered
    const wave = events.observed.find((e) => e.kind === 'wave');
    expect(wave).toBeDefined();
    expect(wave.pet).toBe('a');
  });

  it('derives a catch with the catching pet and the ball position at heart_on', () => {
    // GIVEN — the recorded ball_off/heart_on pair in the proof render (a real catch): the heart is drawn at x=730,
    // the ball's last tracked position before it is (706, 487), and Rex (roster id "a") is the pet under the heart
    const raw = fromLegacyProofRaw(rawSample);

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext());

    // THEN — the catch names Rex and carries the tracked ball position, not the heart centroid (730)
    const catchEvent = events.observed.find((e) => e.kind === 'catch');
    expect(catchEvent).toBeDefined();
    expect(catchEvent.pet).toBe('a');
    expect(catchEvent.x).toBe(706);
    expect(catchEvent.y).toBe(487);
  });

  it('derives the recorded greet: dog/brown and panda/black both go walk to swipe at the same instant', () => {
    // GIVEN — the proof render, where Rex ("a", dog/brown) and Bao ("b", panda/black) both switch walk->swipe at
    // t=1790454917337.5 unhovered, then both switch swipe->walk at t=1790454918388.9 (absolute page ms)
    const raw = fromLegacyProofRaw(rawSample);
    const t0 = raw.clapStart.tOff;

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext());

    // THEN — greet_start and greet_end fire once for each of the two pets, at those two instants, and greet marks both
    const of = (kind) => events.observed.filter((e) => e.kind === kind);
    expect(of('greet_start').map((e) => e.pet).sort()).toEqual(['a', 'b']);
    expect(of('greet_end').map((e) => e.pet).sort()).toEqual(['a', 'b']);
    for (const e of of('greet_start')) expect(e.t).toBeCloseTo(1790454917337.5 - t0, 3);
    for (const e of of('greet_end')) expect(e.t).toBeCloseTo(1790454918388.9 - t0, 3);
    const greets = of('greet').map((e) => e.t);
    expect(greets).toHaveLength(2);
    expect(greets[0]).toBeCloseTo(1790454917337.5 - t0, 3);
    expect(greets[1]).toBeCloseTo(1790454918388.9 - t0, 3);
  });

  it('discards a feed with no heart_on inside the 400ms acceptance window', () => {
    // GIVEN — a raw log whose only heart_on arrives 900ms after the feed mouseup (too late)
    const raw = fromLegacyProofRaw(rawSample);
    const feedMouseupMs = raw.marks.find((m) => m.kind === 'heart_on').t - raw.clapStart.tOff - 900;

    // WHEN — eat is derived against that mouseup time
    const eat = _internal.deriveEat(
      raw.marks.map((m) => ({ ...m, t: m.t - raw.clapStart.tOff })),
      feedMouseupMs,
    );

    // THEN — no eat is derived; a late reply is never faked into an on-time one
    expect(eat).toBeNull();
  });

  it('keeps a cursorTrack that never goes backwards in time', () => {
    // GIVEN — the real recorded cursor samples
    const raw = fromLegacyProofRaw(rawSample);

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext());

    // THEN — every sample's t is >= the previous sample's t (schema.ts validateEvents enforces this)
    let lastT = -Infinity;
    for (const sample of events.cursorTrack) {
      expect(sample.t).toBeGreaterThanOrEqual(lastT);
      lastT = sample.t;
    }
  });

  it('derives no sleep event when the take never sets an hour flip', () => {
    // GIVEN — the proof render, which never calls set_hour
    const raw = fromLegacyProofRaw(rawSample);

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext());

    // THEN — sleep is never fabricated from an absent hour flip
    expect(events.observed.find((e) => e.kind === 'sleep')).toBeUndefined();
  });

  it('derives sleep once every visible roster pet is on the lie sprite after the hour flip', () => {
    // GIVEN — a synthetic raw log (edited from the real shape) with two pets going to lie 40ms apart, after an hour flip at t=1000
    const raw = {
      clapStart: { tOn: 0, tOff: 0 },
      clapEnd: { tOn: 5000, tOff: 5000 },
      src: [],
      hover: [],
      mouse: [],
      cursor: [],
      marks: [],
      clicks: [],
      hourSetT: 1000,
      tracks: [
        { t: 900, pets: [{ id: 'rex', x: 0, y: 0, w: 64, h: 64, src: 'assets/dog/brown_idle_8fps.gif' }, { id: 'bao', x: 0, y: 0, w: 64, h: 64, src: 'assets/panda/black_idle_8fps.gif' }] },
        { t: 1040, pets: [{ id: 'rex', x: 0, y: 0, w: 64, h: 64, src: 'assets/dog/brown_lie_8fps.gif' }, { id: 'bao', x: 0, y: 0, w: 64, h: 64, src: 'assets/panda/black_idle_8fps.gif' }] },
        { t: 1080, pets: [{ id: 'rex', x: 0, y: 0, w: 64, h: 64, src: 'assets/dog/brown_lie_8fps.gif' }, { id: 'bao', x: 0, y: 0, w: 64, h: 64, src: 'assets/panda/black_lie_8fps.gif' }] },
      ],
    };

    // WHEN — events are derived with a 2-pet visible roster
    const events = deriveEvents(raw, baseContext({ roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }, { id: 'bao', name: 'Bao', type: 'panda', color: 'black' }] }));

    // THEN — sleep fires on the first frame where BOTH pets are on the lie sprite (t=1080), not the first pet alone (t=1040)
    const sleep = events.observed.find((e) => e.kind === 'sleep');
    expect(sleep).toBeDefined();
    expect(sleep.t).toBe(1080);
  });
});

describe('_internal.debounceOnOff', () => {
  it('collapses a flickered heart_off/heart_on pair back into a single continuous appearance', () => {
    // GIVEN — a heart that flickers off then on again 20ms later (a fade-animation dip below the scan threshold), then a real second appearance 5s later
    const marks = [
      { kind: 'heart_on', t: 0 },
      { kind: 'heart_off', t: 40 },
      { kind: 'heart_on', t: 60 },
      { kind: 'heart_off', t: 200 },
      { kind: 'heart_on', t: 5000 },
    ];

    // WHEN — the flicker is debounced with a 150ms window
    const result = _internal.debounceOnOff(marks, 'heart', 150);

    // THEN — only the two genuine appearances remain (the flickered pair at 40/60 is dropped)
    const onEvents = result.filter((m) => m.kind === 'heart_on');
    expect(onEvents.map((m) => m.t)).toEqual([0, 5000]);
  });
});

describe('deriveEvents time origin', () => {
  /**
   * Builds a raw capture whose start clapper releases (tOff) at epoch
   * 10700: every expected t below is an epoch time minus 10700.
   */
  function rawWithClapAt10700(overrides = {}) {
    return {
      clapStart: { tOn: 10540, tOff: 10700 },
      clapEnd: { tOn: 14700, tOff: 14860 },
      petsReadyT: 10200,
      feedMouseupT: 12000,
      hourSetT: 13000,
      src: [{ t: 10300, pet: 'rex', from: 'idle', to: 'walk' }],
      hover: [],
      mouse: [{ t: 11500, kind: 'mousedown', x: 5, y: 6 }],
      cursor: [{ t: 10100, x: 1, y: 2 }, { t: 11000, x: 3, y: 4 }],
      tracks: [{ t: 10050, pets: [{ id: 'rex', x: 0, y: 0, w: 64, h: 64, src: 'assets/dog/brown_idle_8fps.gif' }] }],
      marks: [{ t: 12100, kind: 'heart_on', x: 10, y: 10 }],
      clicks: [{ label: 'click-rex', kind: 'click', tMs: 12000, tDepartMs: 11800, tDownMs: 11900, x: 1, y: 1, rect: { x: 0, y: 0, w: 1, h: 1 }, pet: 'rex' }],
      ...overrides,
    };
  }
  const rexRoster = [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }];

  it('puts the start clapper release at t=0', () => {
    /**
     * Verifies that t=0 is the start clapper's release (clapStart.tOff), the
     * origin the events.json contract and the epic eval share: demo.mp4 time
     * = trimBeforeMs + t, and trimBeforeMs is the video's own clapper release.
     * If t=0 were capture start instead, every event would land about
     * trimBeforeMs late in the eval and in the edit.
     */
    // GIVEN — a raw log whose start clapper releases 700 ms after observation began
    const raw = rawWithClapAt10700();

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext({ roster: rexRoster }));

    // THEN — the first clap is at exactly 0
    expect(events.observed.filter((e) => e.kind === 'clap').map((e) => e.t)).toEqual([0, 4000]);
  });

  it('gives an event logged before the start clapper a negative t', () => {
    /**
     * Verifies that pets_ready and a src transition logged during the settle
     * before the clapper come out negative (ms before the clapper), which
     * validateEvents allows down to -trimBeforeMs. Clamping or re-anchoring
     * them would move them off the frame that actually shows them.
     */
    // GIVEN — pets_ready 500 ms and Rex's walk 400 ms before the clapper releases
    const raw = rawWithClapAt10700();

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext({ roster: rexRoster }));

    // THEN — both are negative by exactly those amounts
    const at = (kind) => events.observed.find((e) => e.kind === kind)?.t;
    expect(at('pets_ready')).toBe(-500);
    expect(at('src')).toBe(-400);
  });

  it('measures clicks, cursorTrack, tracks, hour_set, the feed mouseup and durationMs from the start clapper', () => {
    /**
     * Verifies that every recorder-relative time in the document shares the
     * one origin, not just observed[]: the eval places click points, cursor
     * samples and pet boxes on demo.mp4 with the same trimBeforeMs + t rule,
     * and durationMs bounds observed[].t in validateEvents. A field left on
     * the old origin would put its pet box or cursor ~700 ms off.
     */
    // GIVEN — the same raw log
    const raw = rawWithClapAt10700();

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext({ roster: rexRoster }));

    // THEN — each field is its epoch time minus 10700
    expect(events.clicks[0]).toMatchObject({ tMs: 1300, tDepartMs: 1100, tDownMs: 1200 });
    expect(events.cursorTrack.map((c) => c.t)).toEqual([-600, 300]);
    expect(events.tracks.map((f) => f.t)).toEqual([-650]);
    expect(events.observed.find((e) => e.kind === 'hour_set')?.t).toBe(2300);
    expect(events.observed.find((e) => e.kind === 'eat')?.t).toBe(1400);
    expect(events.durationMs).toBe(4000);
  });

  it('marks the shim at playback start, t=0', () => {
    /**
     * Verifies the synthetic shim mark sits at t=0. Observation can start
     * before demo.mp4's first frame (on the real popup take, by about 11 ms),
     * so a mark at observation start could fall below -trimBeforeMs and fail
     * validateEvents on an otherwise good take.
     */
    // GIVEN — the same raw log
    const raw = rawWithClapAt10700();

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext({ roster: rexRoster }));

    // THEN — the shim mark is at 0
    expect(events.observed.find((e) => e.kind === 'shim')?.t).toBe(0);
  });
});

describe('pets_ready and first_paint from the page log', () => {
  const EPOCH = 1791021866672.8; // the real probe's start clapper release (epoch ms)
  const box = (id, gif, x) => ({ id, x, y: 476, w: 64, h: 64, src: `chrome-extension://ext/assets/${gif}_8fps.gif` });
  /** The s3 boot a real probe logged (seed 25), in epoch ms: attached at +324.5, pets drawn at +355.6, page first paint at +353.6. */
  function s3BootRaw(overrides = {}) {
    return {
      clapStart: { tOff: EPOCH },
      clapEnd: { tOn: EPOCH + 4000, tOff: EPOCH + 4160 },
      src: [],
      hover: [],
      mouse: [],
      cursor: [],
      marks: [],
      clicks: [],
      tracks: [
        { t: EPOCH + 324.5, pets: [] },
        { t: EPOCH + 355.6, pets: [box('rex', 'dog/brown_idle', 340), box('bao', 'panda/black_idle', 460), box('pip', 'chicken/white_idle', 399)] },
        { t: EPOCH + 384.0, pets: [box('rex', 'dog/brown_swipe', 340), box('bao', 'panda/black_idle', 460), box('pip', 'chicken/white_swipe', 399)] },
      ],
      firstPaintT: EPOCH + 353.6,
      // what the choreography read: later than the real first draw
      petsReadyT: EPOCH + 1050,
      ...overrides,
    };
  }
  const roster = [
    { id: 'rex', name: 'Rex', type: 'dog', color: 'brown' },
    { id: 'bao', name: 'Bao', type: 'panda', color: 'black' },
    { id: 'pip', name: 'Pip', type: 'chicken', color: 'white' },
  ];

  it('puts pets_ready on the first tracked frame with every visible pet drawn', () => {
    /**
     * pets_ready must be when the pets appear on film. The shakedown logged
     * it at least 690 ms late (when the choreography looked), which made
     * s3's 150 ms greet window and s4's +1700 ms night flip unreachable.
     */
    // GIVEN — the real s3 boot log, tracked from before the pets were drawn
    const raw = s3BootRaw();

    // WHEN — events are derived
    const events = deriveEvents(raw, baseContext({ roster }));

    // THEN — pets_ready is the frame the pets were drawn, 355.6 ms after the clapper
    expect(events.observed.find((e) => e.kind === 'pets_ready').t).toBeCloseTo(355.6, 1);
  });

  it('logs first_paint from the page paint timing', () => {
    /** s2/s3/s4 cut in at first_paint (shots.json beats); the recorder never logged it before. */
    // GIVEN / WHEN
    const events = deriveEvents(s3BootRaw(), baseContext({ roster }));

    // THEN
    expect(events.observed.find((e) => e.kind === 'first_paint').t).toBeCloseTo(353.6, 1);
  });

  it("keeps the choreography's pets_ready for a log tracked only after the pets were drawn", () => {
    /** A log whose first tracked frame already has the pets cannot prove when they appeared (the legacy proof log). */
    // GIVEN — the same log without its pre-pet frames
    const raw = s3BootRaw();
    raw.tracks = raw.tracks.slice(1);

    // WHEN
    const events = deriveEvents(raw, baseContext({ roster }));

    // THEN — the choreography's own time is used
    expect(events.observed.find((e) => e.kind === 'pets_ready').t).toBeCloseTo(1050, 1);
  });
});

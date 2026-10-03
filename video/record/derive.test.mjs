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
    const t0 = raw.recordStartT ?? raw.clapStart.tOff;

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

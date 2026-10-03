// Pure-logic tests for the synthetic page-shot event transforms. No
// Chromium/ffmpeg here — see make-synthetic-run.mjs's own run for the
// real-acceptance evidence (Phase 3 of the implementer skill).

import { describe, expect, it } from 'vitest';
import {
  buildPageTrackFrames,
  buildS1InboxObserved,
  buildS3SheetObserved,
  buildS4ArticleNightObserved,
  currentPetState,
  interpolatePetX,
  shiftStandinEvents,
} from './page-events.mjs';

const SRC_EVENTS = [
  { t: 0, kind: 'src', pet: 'rex', from: 'idle', to: 'walk', x: 100 },
  { t: 1000, kind: 'src', pet: 'rex', from: 'walk', to: 'swipe', x: 200 },
  { t: 2000, kind: 'src', pet: 'rex', from: 'swipe', to: 'idle', x: 200 },
];

describe('interpolatePetX', () => {
  it('linearly interpolates x between the two bracketing src events', () => {
    /**
     * Verifies that a pet's synthetic x at a moment between two logged
     * `src` transitions is a true linear blend of their real x values,
     * never a made-up number.
     *
     * This matters because the bead explicitly forbids inventing
     * positions: "Derive every synthetic track from the fixture's logged
     * positions... never invent positions." A held/rounded x would leave
     * a walking pet visually behind its own track when the camera
     * follows it.
     *
     * If this breaks, camera.ts's focus:pet:<id> would sample either a
     * stale or a future position, snapping the follow-camera instead of
     * tracking smoothly.
     */
    // GIVEN — rex walks from x=100 at t=0 to x=200 at t=1000
    // WHEN — sampled halfway through that span
    const x = interpolatePetX(SRC_EVENTS, 'rex', 500);
    // THEN — exactly halfway between the two logged x values
    expect(x).toBe(150);
  });

  it('clamps to the last known x after the final src event', () => {
    /**
     * Verifies sampling past the last logged transition returns that
     * transition's x rather than extrapolating or throwing.
     *
     * This matters because a page shot's tracks[] spans the whole
     * durationMs, which almost always runs past the pet's last observed
     * move (it then just stands still).
     *
     * If this breaks, a track sample near the end of the clip would throw
     * or extrapolate the pet off-frame.
     */
    // GIVEN — rex's last src event is at t=2000
    // WHEN — sampled well after that
    const x = interpolatePetX(SRC_EVENTS, 'rex', 5000);
    // THEN — clamped to the last logged x
    expect(x).toBe(200);
  });

  it('throws when the pet has no src events with x', () => {
    /**
     * Verifies a pet with no logged position fails loudly instead of
     * silently returning an invented coordinate.
     *
     * This matters because the bead's rule against inventing positions
     * is a correctness rule, not a style preference — a silent fallback
     * (e.g. 0) would place an untracked pet off-frame with no error
     * anywhere in the pipeline.
     */
    // GIVEN — no src events for "pip"
    // WHEN / THEN — interpolatePetX refuses to guess
    expect(() => interpolatePetX(SRC_EVENTS, 'pip', 500)).toThrow(/no src events/);
  });
});

describe('currentPetState', () => {
  it('returns the most recently logged transition target at or before t', () => {
    /**
     * Verifies the animation state reported for a moment matches the
     * last `src.to` logged at or before that moment.
     *
     * This matters because a synthetic tracks[] entry's `src` field
     * stands in for the pet's live sprite state; getting it wrong would
     * misrepresent what the "recording" shows (e.g. claiming "walk" while
     * the fixture is mid-swipe).
     *
     * If this breaks, downstream consumers reading tracks[].pets[].src
     * (if any ever do) would see a state that never matched the video at
     * that timestamp.
     */
    // GIVEN — rex transitions walk -> swipe at t=1000
    // WHEN — sampled just after that transition
    // THEN — the state is "swipe", not the prior "walk"
    expect(currentPetState(SRC_EVENTS, 'rex', 1500)).toBe('swipe');
  });

  it('defaults to idle before the first transition', () => {
    // GIVEN — rex's first src event is at t=0
    // WHEN — sampled before any transition
    // THEN — the default state is idle
    expect(currentPetState(SRC_EVENTS, 'rex', -100)).toBe('idle');
  });
});

describe('buildPageTrackFrames', () => {
  it('samples every pet at the declared step across the full duration', () => {
    /**
     * Verifies the frame count and coverage of the generated tracks[]:
     * one entry every stepMs from 0 through durationMs inclusive, each
     * carrying every requested pet's box.
     *
     * This matters because camera.ts's follow-camera smoothing needs a
     * dense-enough, evenly-spaced track to look like continuous motion,
     * not a sparse handful of keyframes.
     *
     * If this breaks, the synthetic run would ship gaps a real recorder's
     * rAF loop never has, and camera.ts's 400 ms smoothing window could
     * see no samples in a stretch it expects one every frame.
     */
    // GIVEN — a 1000 ms span, sampled every 100 ms
    // WHEN — building the track
    const frames = buildPageTrackFrames({ observed: SRC_EVENTS, petIds: ['rex'], durationMs: 1000, stepMs: 100 });
    // THEN — 11 frames (0, 100, ..., 1000), each with rex's box
    expect(frames).toHaveLength(11);
    expect(frames[0].pets).toEqual([{ id: 'rex', x: 100, y: 476, w: 64, h: 64, src: 'walk' }]);
    expect(frames.at(-1).t).toBe(1000);
  });
});

describe('buildS1InboxObserved', () => {
  it('drops only the two early rex "swipe" transitions, keeping the later one and every non-rex event', () => {
    /**
     * Verifies the s1_inbox anchor fix: dropping the 3772/5086 early
     * waves so `src:rex:swipe` resolves to the fixture's real second
     * wave, without touching anything else in the event stream.
     *
     * This matters because the bead is explicit that this is the ONLY
     * transform s1_inbox needs, and that it must not touch Bao's own
     * events — a broader filter would silently corrupt an unrelated
     * pet's timeline.
     *
     * If this breaks, b2a_hover's caption_at would anchor to the wrong
     * wave (or Bao's swipe events would vanish too), landing captions on
     * frames that don't show the action they describe.
     */
    // GIVEN — rex swipes at 3772 (early) and 14403 (the real one), bao swipes at 5086
    const template = [
      { t: 3772, kind: 'src', pet: 'rex', from: 'walk', to: 'swipe', x: 488 },
      { t: 5086, kind: 'src', pet: 'rex', from: 'walk', to: 'swipe', x: 492 },
      { t: 5086, kind: 'src', pet: 'bao', from: 'walk', to: 'swipe', x: 526 },
      { t: 14403, kind: 'src', pet: 'rex', from: 'idle', to: 'swipe', x: 698 },
    ];
    // WHEN — building s1_inbox's observed[]
    const result = buildS1InboxObserved(template);
    // THEN — only the two early rex swipes are gone
    expect(result).toEqual([
      { t: 5086, kind: 'src', pet: 'bao', from: 'walk', to: 'swipe', x: 526 },
      { t: 14403, kind: 'src', pet: 'rex', from: 'idle', to: 'swipe', x: 698 },
    ]);
  });
  it("drops the fixture's catch-only events before the second wave, so heart_on resolves to the treat's heart", () => {
    /**
     * Verifies that s1_inbox keeps none of the fetch's events (heart_on,
     * catch, ball_on, ball_off, ball_floor) logged before Rex's wave at 14403.
     *
     * This matters because anchors resolve to the FIRST matching event: the
     * fixture's catch heart at 12104 would make b2b_treat's `heart_on` land
     * before b2a_hover's `src:rex:swipe`, giving both beats empty or
     * negative spans.
     *
     * If this breaks, the synthetic master has no hover or treat beat.
     */
    // GIVEN — the fetch's events at 8737-12104, then the treat's at 14729/14755
    const template = [
      { t: 8737, kind: 'ball_on' },
      { t: 9000, kind: 'ball_floor' },
      { t: 12104, kind: 'catch', pet: 'rex', x: 600 },
      { t: 12104, kind: 'heart_on' },
      { t: 12104, kind: 'ball_off' },
      { t: 14403, kind: 'src', pet: 'rex', from: 'idle', to: 'swipe', x: 698 },
      { t: 14729, kind: 'mouseup', pet: 'rex' },
      { t: 14755, kind: 'heart_on' },
    ];
    // WHEN — building s1_inbox's observed[]
    const result = buildS1InboxObserved(template);
    // THEN — only the wave and the treat remain, and the first heart_on is 14755
    expect(result.map((e) => `${e.kind}@${e.t}`)).toEqual(['src@14403', 'mouseup@14729', 'heart_on@14755']);
    expect(result.find((e) => e.kind === 'heart_on').t).toBe(14755);
  });
});

describe('buildS3SheetObserved', () => {
  it('adds greet_start within 150ms of pets_ready and greet_end after it, per the accept rule', () => {
    /**
     * Verifies the synthesized greet_start/greet_end anchors s3_sheet's
     * beats (b4a_hi, b4b_too) need but the two-pet fixture never logs,
     * land inside the window shots.json's own accept rule requires
     * ("greet_start arrives within 150 ms of pets_ready").
     *
     * This matters because a beat resolving its anchor outside that
     * window would place captions on the wrong frames, and nothing else
     * in this synthetic run supplies a three-pet greet.
     *
     * If this breaks, timeline.ts would either throw (anchor not found)
     * or resolve a greet caption to a moment far from any real greet.
     */
    // GIVEN — pets_ready at t=1000
    // WHEN — building s3_sheet's observed[]
    const result = buildS3SheetObserved([{ t: 1000, kind: 'pets_ready' }], 1000);
    // THEN — greet_start within 150ms, greet_end strictly after it
    const start = result.find((e) => e.kind === 'greet_start');
    const end = result.find((e) => e.kind === 'greet_end');
    expect(start.t - 1000).toBeLessThanOrEqual(150);
    expect(end.t).toBeGreaterThan(start.t);
  });
});

describe('buildS4ArticleNightObserved', () => {
  it('adds sleep within 100ms of hour_set, per the accept rule', () => {
    /**
     * Verifies the synthesized hour_set/sleep pair (b5_lights_out's
     * anchors) satisfies s4_article_night's own accept rule ("all three
     * show lie within 100 ms of hour_set"), which the fixture never logs
     * on its own (it has no night flip).
     *
     * If this breaks, the night push and the 22:00 clock overlay would
     * anchor to moments the accept rule itself says are impossible,
     * making this shot's synthetic events internally inconsistent with
     * the very spec it stands in for.
     */
    // GIVEN — pets_ready at t=2000
    // WHEN — building s4_article_night's observed[]
    const result = buildS4ArticleNightObserved([{ t: 2000, kind: 'pets_ready' }], 2000);
    // THEN — sleep lands within 100ms of hour_set
    const hourSet = result.find((e) => e.kind === 'hour_set');
    const sleep = result.find((e) => e.kind === 'sleep');
    expect(sleep.t - hourSet.t).toBeLessThanOrEqual(100);
    expect(sleep.t).toBeGreaterThan(hourSet.t);
  });
});

describe('shiftStandinEvents', () => {
  it('shifts every x/y-bearing field by (dx, dy), leaving other fields untouched', () => {
    /**
     * Verifies the v916 coordinate shift touches cursorTrack, clicks
     * (including their rect), observed x/y pairs and tracks[].pets[]
     * boxes, but never mutates unrelated fields like an event's kind or
     * a track's timestamp.
     *
     * This matters because the 9:16 stand-in crops+pads the same fixture
     * video (bead step 6: crop device x 840-1920, pad 380px on top), so
     * every logged coordinate has to move with it or the camera/captions
     * would aim at the pre-crop frame and land off the visible stage.
     *
     * If this breaks, the 9:16 synthetic render would show captions and
     * a camera aimed at a point outside the actual padded/cropped frame.
     */
    // GIVEN — an events doc with one sample in each coordinate-bearing field
    const events = {
      name: 's1_inbox',
      cursorTrack: [{ t: 0, x: 10, y: 20 }],
      clicks: [{ label: 'a', kind: 'click', tMs: 0, tDepartMs: 0, tDownMs: 0, x: 10, y: 20, rect: { x: 5, y: 5, w: 1, h: 1 } }],
      observed: [{ t: 0, kind: 'heart_on', x: 10, y: 20 }, { t: 1, kind: 'pets_ready' }],
      tracks: [{ t: 0, pets: [{ id: 'rex', x: 10, y: 20, w: 64, h: 64, src: 'idle' }] }],
    };
    // WHEN — shifting by (-420, +190)
    const shifted = shiftStandinEvents(events, { dx: -420, dy: 190 });
    // THEN — every coordinate moved, non-coordinate fields untouched
    expect(shifted.cursorTrack[0]).toEqual({ t: 0, x: -410, y: 210 });
    expect(shifted.clicks[0].x).toBe(-410);
    expect(shifted.clicks[0].rect).toEqual({ x: -415, y: 195, w: 1, h: 1 });
    expect(shifted.observed[0]).toEqual({ t: 0, kind: 'heart_on', x: -410, y: 210 });
    expect(shifted.observed[1]).toEqual({ t: 1, kind: 'pets_ready' });
    expect(shifted.tracks[0].pets[0]).toEqual({ id: 'rex', x: -410, y: 210, w: 64, h: 64, src: 'idle' });
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Events } from '../schema';
import { STAGE_16X9 } from './camera';
import { makeEvents, reviewThenCardEdit } from './testEvents';
import {
  anchorMasterFrame,
  buildTimeline,
  classifyMove,
  findAnchorMasterFrame,
  resolveAnyAnchor,
  resolveEditAnchor,
  resolveFocusX,
  steadyRun,
  timelineJson,
  type EditTimeline,
  type Shot,
  type ShotBeat,
  type ShotsDoc,
} from './timeline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', 'fixtures');

function loadFixtureEvents(): Events {
  return JSON.parse(readFileSync(join(fixturesDir, 'events.sample.json'), 'utf8'));
}

function loadFixtureShots(): ShotsDoc {
  return JSON.parse(readFileSync(join(fixturesDir, 'shots.sample.json'), 'utf8'));
}

describe('classifyMove', () => {
  it('classifies a plain "hold" as a hold with no anchors to parse', () => {
    /**
     * Verifies the simplest and most common move shape: a beat that holds
     * at its declared zoom for its whole span. If this misclassifies,
     * every static beat (most of the film) would fall through to the
     * best-effort "continuous" path instead of the precisely-judged hold
     * check.
     */
    expect(classifyMove('hold')).toEqual({ kind: 'hold' });
  });

  it('classifies "hold; Rex is still while hovered" as a hold', () => {
    /**
     * b2a_hover's exact move text in video/shots.json extends "hold" with
     * a trailing clause. The classifier must still recognise it as a
     * hold, not fall through to "continuous".
     */
    expect(classifyMove('hold; Rex is still while hovered').kind).toBe('hold');
  });

  it('parses the pre-push zoom and until-anchor from a "Hold Z until X, then push" move', () => {
    /**
     * Verifies the exact move text pattern used by b3a_throw in
     * video/shots.json. If the regex is wrong, hold_in/hold_out for
     * these beats (b3a_throw, b4a_hi, b5_lights_out) would be computed
     * from the wrong anchor, and the epic's hold check ("declared hold
     * covers the still window... within one frame") would fail on an
     * otherwise-correct render.
     */
    const move =
      'Hold 1.0x (page) until ball_on+400, then push to 2.0x centred on catch_point (clamped to the page), floor-anchored, ending at the first ball_floor or the catch, whichever comes first.';
    const parsed = classifyMove(move);
    expect(parsed.kind).toBe('hold_until');
    expect(parsed.preZoom).toBe(1.0);
    expect(parsed.untilAnchor).toBe('ball_on+400');
  });

  it('parses the push-end anchor from b6_brand_line\'s "the push ends at X, then hold" move', () => {
    /**
     * b6_brand_line is the one beat whose hold STARTS partway through
     * (its push is the tail of b5's night push). Misparsing this anchor
     * would compute a hold_in of 0 (or fail to compute one at all),
     * failing the epic's rule that b6's hold spans sleep+3400..master_out.
     */
    const parsed = classifyMove('the push ends at sleep+3400, then hold');
    expect(parsed.kind).toBe('push_then_hold');
    expect(parsed.pushEndAnchor).toBe('sleep+3400');
  });

  it('falls back to "continuous" for a follow-style move it does not specially parse', () => {
    /**
     * Follow beats (b1b_not_helping, b1c_name) are explicitly the only
     * beats allowed short/no holds (epic: "reported and does not
     * judge"). Falling through to "continuous" rather than throwing lets
     * the timeline still produce a best-effort crop for them.
     */
    expect(classifyMove('follow').kind).toBe('continuous');
  });
});

describe('resolveEditAnchor', () => {
  const events = loadFixtureEvents();

  it('resolves "in" relative to the beat\'s own supplied start', () => {
    /**
     * "in" (video/shots.json conventions.anchors: an edit-only anchor)
     * must resolve to the beat's own start plus any offset, not to the
     * recording's global t=0 — a beat's overlay window ("from: in") is
     * relative to when THAT beat begins.
     */
    expect(resolveEditAnchor('in+50', { events, beatInMs: 1000 })).toBe(1050);
  });

  it('resolves "end" relative to the supplied total master length', () => {
    expect(resolveEditAnchor('end', { events, totalMs: 29000 })).toBe(29000);
  });

  it('resolves "cursor_depart" from the first logged click\'s tDepartMs', () => {
    /**
     * conventions.anchors: "cursor_depart is the start of s1's first
     * glide." A wrong anchor here would start the cursor's first move
     * too early or too late relative to the actual glide.
     */
    expect(resolveEditAnchor('cursor_depart', { events })).toBe(events.clicks[0].tDepartMs);
  });

  it('resolves "ball_in_frame" as the first dblclick plus the documented 440ms approximation', () => {
    /**
     * conventions.edit_anchors: "ball_in_frame is the first frame the
     * ball's disc is inside the current crop (about dblclick + 440 ms at
     * 1.0x...)". This is a documented approximation (see this module's
     * header), not a re-derivation from the canvas scan.
     */
    const dbl = events.clicks.find((c) => c.kind === 'dblclick')!;
    expect(resolveEditAnchor('ball_in_frame', { events })).toBe(dbl.tMs + 440);
  });

  it('throws for "catch_point", which is a position anchor, not a time anchor', () => {
    /**
     * Verifies the documented split: catch_point ("the logged ball x at
     * the catch") is resolved by resolveFocusX, never by this function.
     * Silently returning a bogus time here would produce a wrong beat
     * boundary with no error.
     */
    expect(() => resolveEditAnchor('catch_point', { events })).toThrow(/position/);
  });
});

describe('resolveAnyAnchor', () => {
  const events = loadFixtureEvents();

  it('shifts a recorder anchor by events.trimBeforeMs to align it with demo.mp4', () => {
    /**
     * Verifies this bead's step 2 spec: "source_in/source_out ... equal
     * trimBeforeMs + the LOGGED anchor time." The recorder's own event
     * clock (observed[].t) is not re-zeroed when the assembled demo.mp4
     * has its leading clapper trimmed, so every recorder anchor sits
     * trimBeforeMs later in the file than its logged timestamp. Missing
     * this shift would make every beat's OffthreadVideo trim point (and
     * every caption/camera anchor inside it) off by trimBeforeMs — 1080ms
     * on this fixture, which is most of a whole beat.
     */
    const petsReady = events.observed.find((e) => e.kind === 'pets_ready')!;
    expect(resolveAnyAnchor('pets_ready', { events })).toBe(petsReady.t + events.trimBeforeMs);
  });

  it('does NOT shift the "in" edit-only anchor, which is already beat-relative', () => {
    /**
     * "in" is defined relative to a beat's own beatInMs (itself already
     * shifted, since it was produced by a prior resolveAnyAnchor call) —
     * shifting it again would double-count trimBeforeMs and push overlay
     * windows further into the beat than the storyboard intends.
     */
    expect(resolveAnyAnchor('in+100', { events, beatInMs: 5000 })).toBe(5100);
  });
});

describe('resolveFocusX', () => {
  const events = loadFixtureEvents();

  it('resolves "page" focus to the stage centre regardless of events', () => {
    expect(resolveFocusX('page', STAGE_16X9, events, 0)).toBe(STAGE_16X9.width / 2);
  });

  it('resolves "pet:<id>" focus from the click rect when tracks are absent', () => {
    /**
     * The fixture events (video/fixtures/events.sample.json) carry no
     * `tracks`, exactly the case the storyboard names: "fall back to the
     * click rect when tracks is absent, as in the fixture." The rect
     * centre must be converted from CSS px (the 960-wide recording
     * viewport) to stage px via the fixed 2x device_scale_factor.
     */
    const x = resolveFocusX('pet:rex', STAGE_16X9, events, 0);
    const rect = events.clicks.find((c) => c.pet === 'rex')!.rect;
    expect(x).toBe((rect.x + rect.w / 2) * 2);
  });

  it('resolves "catch_point" focus from the logged catch event\'s x', () => {
    const catchEvent = events.observed.find((e) => e.kind === 'catch')!;
    expect(resolveFocusX('catch_point', STAGE_16X9, events, 0)).toBe(catchEvent.x! * 2);
  });

  it('throws for an unrecognised focus string', () => {
    expect(() => resolveFocusX('nonsense', STAGE_16X9, events, 0)).toThrow();
  });
});

describe('buildTimeline (integration, real fixture data)', () => {
  const shotsDoc = loadFixtureShots();
  const events = loadFixtureEvents();
  const shot = shotsDoc.shots.find((s) => s.id === 'sample_hover_treat_catch')!;
  const singleShotDoc: ShotsDoc = { fps: 25, edit_order: [shot.id], shots: [shot] };

  it('produces one Timeline beat per shots.json beat, in order', () => {
    const timeline = buildTimeline({
      shots: singleShotDoc,
      stage: STAGE_16X9,
      eventsByShotId: { [shot.id]: events },
      sourceByShotId: { [shot.id]: '/build/fixture/sample_hover_treat_catch/demo.mp4' },
      music: 'assets/music/funny_and_cute_town_theme.ogg',
      allowEmptyBeats: true,
    });
    expect(timeline.beats.map((b) => b.name)).toEqual(shot.beats.map((b: Shot['beats'][number]) => b.name));
  });

  it('never produces a beat with master_out before master_in, even against internally out-of-order fixture events', () => {
    /**
     * video/fixtures/events.sample.json reuses one generic recording
     * across beats whose narrative order (hover -> treat -> throw ->
     * catch) does not match the recording's own chronological event
     * order (the ball-throw/catch sequence is logged BEFORE the later
     * feed click this fixture's "treat" beat anchors to). A naive chain
     * would produce a negative-duration beat here; the monotonic clamp
     * in resolveShotBeatBounds must prevent that.
     */
    const timeline = buildTimeline({
      shots: singleShotDoc,
      stage: STAGE_16X9,
      eventsByShotId: { [shot.id]: events },
      sourceByShotId: { [shot.id]: '/build/fixture/sample_hover_treat_catch/demo.mp4' },
      music: 'assets/music/funny_and_cute_town_theme.ogg',
      allowEmptyBeats: true,
    });
    for (const beat of timeline.beats) {
      expect(beat.master_out).toBeGreaterThanOrEqual(beat.master_in);
    }
  });

  it('chains each beat\'s master_in to the previous beat\'s master_out', () => {
    const timeline = buildTimeline({
      shots: singleShotDoc,
      stage: STAGE_16X9,
      eventsByShotId: { [shot.id]: events },
      sourceByShotId: { [shot.id]: '/build/fixture/sample_hover_treat_catch/demo.mp4' },
      music: 'assets/music/funny_and_cute_town_theme.ogg',
      allowEmptyBeats: true,
    });
    for (let i = 1; i < timeline.beats.length; i++) {
      expect(timeline.beats[i].master_in).toBe(timeline.beats[i - 1].master_out);
    }
  });

  it('gives every drawn non-card beat a crop and a whole-beat hold (every fixture beat is a plain hold)', () => {
    const timeline = buildTimeline({
      shots: singleShotDoc,
      stage: STAGE_16X9,
      eventsByShotId: { [shot.id]: events },
      sourceByShotId: { [shot.id]: '/build/fixture/sample_hover_treat_catch/demo.mp4' },
      music: 'assets/music/funny_and_cute_town_theme.ogg',
      allowEmptyBeats: true,
    });
    const drawn = timeline.beats.filter((b) => b.k1 > b.k0);
    expect(drawn.length).toBeGreaterThan(0);
    for (const beat of drawn) {
      expect(beat.crop).toBeDefined();
      expect(beat.hold_in).toBe(beat.master_in);
      expect(beat.hold_out).toBe(beat.master_out);
    }
  });

  it('carries the supplied absolute source path on every beat, never a staged copy', () => {
    /**
     * The epic rejects any source outside the run ("the eval rejects any
     * source outside the run"). This just verifies buildTimeline passes
     * the caller-supplied path through unchanged rather than deriving
     * some other (potentially staged) path itself.
     */
    const absPath = '/build/fixture/sample_hover_treat_catch/demo.mp4';
    const timeline = buildTimeline({
      shots: singleShotDoc,
      stage: STAGE_16X9,
      eventsByShotId: { [shot.id]: events },
      sourceByShotId: { [shot.id]: absPath },
      music: 'assets/music/funny_and_cute_town_theme.ogg',
      allowEmptyBeats: true,
    });
    for (const beat of timeline.beats) {
      expect(beat.source).toBe(absPath);
    }
  });

  it('throws when edit_order names a shot missing from shots[]', () => {
    const badDoc: ShotsDoc = { fps: 25, edit_order: ['nope'], shots: [] };
    expect(() =>
      buildTimeline({ shots: badDoc, stage: STAGE_16X9, eventsByShotId: {}, sourceByShotId: {}, music: 'x' }),
    ).toThrow(/nope/);
  });
});

describe('buildTimeline: frame grid and declared samples', () => {
  const shotsDoc = loadFixtureShots();
  const events = loadFixtureEvents();
  const shot = shotsDoc.shots.find((s) => s.id === 'sample_hover_treat_catch')!;
  const edit = buildTimeline({
    shots: { fps: 25, edit_order: [shot.id], shots: [shot] },
    stage: STAGE_16X9,
    eventsByShotId: { [shot.id]: events },
    sourceByShotId: { [shot.id]: '/abs/demo.mp4' },
    music: '/abs/funny_and_cute_town_theme.ogg',
    allowEmptyBeats: true,
  });

  it('maps master to source by a whole number of frames, so every master frame shows one whole source frame', () => {
    /**
     * verify.mjs samples the master at t and the recording at source_t + (t - master_t). If that offset
     * were not a multiple of 40 ms, the two would show different frames and every SSIM would sag.
     */
    for (const b of edit.beats) {
      expect(Math.abs(((b.master_t - b.source_t) / 40) % 1)).toBeLessThan(1e-9);
      expect(Math.abs((b.master_in / 40) % 1)).toBeLessThan(1e-9);
    }
  });

  it('puts master_t on a frame inside the declared hold, showing the declared crop', () => {
    /** The eval aims at master_t with the declared crop and requires hold_in <= master_t <= hold_out. */
    for (const b of edit.beats.filter((x) => x.frameCrops)) {
      expect(b.master_t).toBeGreaterThanOrEqual(b.hold_in!);
      expect(b.master_t).toBeLessThanOrEqual(b.hold_out!);
      expect(b.frameCrops![Math.round(b.master_t / 40) - b.k0]).toEqual(b.crop);
    }
  });

  it('throws on a beat that spans no frame unless the caller allows it (fixture only)', () => {
    /** On a real take an empty beat means the anchors resolved out of order; rendering past it would drop a beat silently. */
    expect(() =>
      buildTimeline({ shots: { fps: 25, edit_order: [shot.id], shots: [shot] }, stage: STAGE_16X9, eventsByShotId: { [shot.id]: events }, sourceByShotId: { [shot.id]: '/abs/demo.mp4' }, music: 'm' }),
    ).toThrow(/spans no master frame/);
  });

  it('extends the final hold toward the length rule by at most 1.0 s', () => {
    /** master.length_rule: "Under 27.3 s: extend the final hold by up to 1.0 s." */
    const longer = buildTimeline({ shots: { fps: 25, edit_order: [shot.id], shots: [shot] }, stage: STAGE_16X9, eventsByShotId: { [shot.id]: events }, sourceByShotId: { [shot.id]: '/abs/demo.mp4' }, music: 'm', allowEmptyBeats: true, minLengthMs: 27300 });
    expect(longer.totalFrames - edit.totalFrames).toBe(25);
  });

  it('writes timeline.json in seconds with only the schema fields', () => {
    /** verify.mjs reads seconds; render-only fields (frameCrops, shiftMs) must never leak into the frozen schema. */
    const json = timelineJson(edit, []);
    const last = json.beats[json.beats.length - 1];
    expect(last.master_out).toBeCloseTo(edit.totalFrames / 25, 6);
    expect(Object.keys(last)).not.toContain('frameCrops');
    expect(Object.keys(last)).not.toContain('shiftMs');
  });
});

describe('steadyRun', () => {
  it('picks the longest run of identical crops at the sample zoom', () => {
    /** camera.sample names the zoom master_t samples; a 1.0x-sample beat must not sample its 2.0x tail. */
    const full = { x: 0, y: 0, w: 1920, h: 1080 };
    const z = { x: 400, y: 492, w: 960, h: 540 };
    expect(steadyRun([full, full, full, z, z, z, z, z], 1920, 1)).toEqual({ first: 0, last: 2 });
    expect(steadyRun([full, full, full, z, z, z, z, z], 1920, 2)).toEqual({ first: 3, last: 7 });
  });
});

describe('anchorMasterFrame / findAnchorMasterFrame', () => {
  // a beat whose master frame = demo ms / 40 + 25 (shiftMs 1000), on a take with a 56 ms videoLagMs and trimBeforeMs 1000
  const events = makeEvents({ trimBeforeMs: 1000, videoLagMs: 56, observed: [{ t: 2000, kind: 'pets_ready' }, { t: 4000, kind: 'sleep' }] });
  const beat = { shiftMs: 1000, source_in: 2000 };

  it('shifts a recorder anchor by videoLagMs, and an "in" anchor (with or without an offset) by nothing', () => {
    /**
     * What: "sleep" lands on the frame that SHOWS it (log + trimBeforeMs + videoLagMs + shiftMs);
     * "in+80" is on the edit's own clock and gets no lag, matched by its PARSED name.
     * Why: the old string compare (spec === 'in') gave "in+80" the 56 ms lag, a frame off.
     * What breaks: SFX, captions and the --at still land a frame early or late.
     */
    // GIVEN / WHEN
    const sleep = anchorMasterFrame('sleep', beat, events, 25);
    const inPlus = anchorMasterFrame('in+80', beat, events, 25);
    // THEN
    expect(sleep).toBe(Math.round((4000 + 1000 + 56 + 1000) / 40));
    expect(inPlus).toBe(Math.round((2000 + 80 + 1000) / 40));
  });

  it('puts "end" on the last frame boundary of the master', () => {
    /**
     * What: "end" resolves to totalFrames whatever the beat's shift.
     * Why: the brand line runs to the end of the film.
     * What breaks: the brand line drops off before the last frame.
     */
    // GIVEN / WHEN
    const end = anchorMasterFrame('end', beat, events, 25, 300);
    // THEN
    expect(end).toBe(300);
  });

  it('finds the first beat that shows an anchor, skips shots that never log it, and rejects a malformed one', () => {
    /**
     * What: findAnchorMasterFrame searches beats in order, skipping beats whose shot does not log the
     * anchor, and throws on a spec that is not an anchor at all.
     * Why: audioPlan and render.mjs --at use it; a typo must fail loudly, not resolve to nothing.
     * What breaks: the bed never comes up, or --at renders frame 0 for a typo.
     */
    // GIVEN — beat a on a shot without "sleep", beat b on one with it
    const other = makeEvents({ observed: [{ t: 0, kind: 'pets_ready' }] });
    const edit = {
      music: 'm',
      fps: 25,
      totalFrames: 400,
      beats: [
        { name: 'a', shotId: 'x', shiftMs: 0, k0: 0, k1: 100, source_in: 0, source_out: 4000 },
        { name: 'b', shotId: 'y', shiftMs: 1000, k0: 100, k1: 400, source_in: 2000, source_out: 14000 },
      ],
    } as unknown as EditTimeline;
    // WHEN
    const k = findAnchorMasterFrame(edit, { x: other, y: events }, 'sleep');
    // THEN
    expect(k).toBe(anchorMasterFrame('sleep', beat, events, 25));
    expect(() => findAnchorMasterFrame(edit, { x: other, y: events }, 'not an anchor!')).toThrow(/anchor grammar/);
  });
});

describe('timelineJson: the v2 fields the eval reads', () => {
  it('records the card backdrop as the review recording and the source time of its last shown frame', () => {
    /**
     * What: top-level backdrop = {source: the review shot's recording, source_t: the source time (s) of the
     * last review frame the master shows}.
     * Why: during s2b the card hangs over that frame dimmed; the eval rebuilds the backdrop from exactly
     * this frame and compares it outside the card.
     * What breaks: the eval rebuilds a different frame and fails a correct backdrop, or cannot rebuild it.
     */
    // GIVEN
    const { edit, items } = reviewThenCardEdit('16x9');
    // WHEN
    const json = timelineJson(edit, items);
    // THEN
    // Recording frame 62 at 40 ms a frame, the fixture's last shown review frame.
    expect(json.backdrop).toEqual({ source: '/r/s2.mp4', source_t: 2.48 });
  });

  it('names the chrome PNG on every page beat and on no card beat', () => {
    /**
     * What: beats[].chrome is set/chrome/<page>.png (or -narrow.png in the 9:16) on page beats only.
     * Why: the eval's chrome check compares the master's top 208 rows against this PNG.
     * What breaks: the chrome check has no reference, or compares a card frame against a page's chrome.
     */
    for (const [aspect, png] of [['16x9', 'set/chrome/review.png'], ['9x16', 'set/chrome/review-narrow.png']] as const) {
      // GIVEN
      const { edit, items } = reviewThenCardEdit(aspect);
      // WHEN
      const json = timelineJson(edit, items);
      // THEN
      expect(json.beats.map((b) => [b.name, b.chrome])).toEqual([['b_hold', png], ['b3c_shelter', undefined], ['b3d_pick', undefined], ['b3e_add', undefined]]);
    }
  });

  it('lists every caption pill on screen at a beat\'s caption_t, and no other text', () => {
    /**
     * What: beats[].caption_rects = the rects of the caption, card caption and name tag pills drawn on the
     * master frame at caption_t; a beat with no caption_t has none.
     * Why: the eval counts the clock's cream only outside every pill; the pill is cream too.
     * What breaks: the clock check counts the pill's ~70,000 cream px as the clock and passes a missing clock.
     */
    // GIVEN — the card caption runs across b3c-b3e
    const { edit, items } = reviewThenCardEdit('16x9');
    const caption = items.find((i) => i.kind === 'card_caption')!;
    // WHEN
    const json = timelineJson(edit, [...items, { ...caption, kind: 'clock', rect: { x: 0, y: 0, w: 1, h: 1 } }]);
    // THEN
    const b3c = json.beats.find((b) => b.name === 'b3c_shelter')!;
    expect(b3c.caption_t).toBeDefined();
    expect(b3c.caption_rects).toEqual([caption.rect]);
    expect(json.beats.find((b) => b.name === 'b_hold')!.caption_rects).toBeUndefined();
  });
});

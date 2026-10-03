// Beat-to-master-time resolution (epic pets-o3p, bead pets-o3p.4). Maps
// each beat of a shots.json-shaped document to master time using the
// shot's own recorded Events, producing the Timeline the Remotion
// composition and verify.mjs both read.
//
// Source of truth: video/shots.json's `conventions.anchors`/`camera`
// sections and .claude/marketing-video/design/storyboard-final.md's "Stage
// and camera" section (see camera.ts's header). Card-beat (popup) timeline
// resolution is NOT part of this file — see cardCrop.ts.
//
// Browser-safe: no Node imports (Remotion compositions may need to derive
// per-frame poses using the same crop function this module exposes).
//
// Units: everything here is MILLISECONDS (master ms, and demo.mp4 ms for
// source_*); timelineJson() converts to the seconds timeline.json and
// verify.mjs use. Within a shot, master ms = demo ms + shiftMs, a whole
// number of frames, so every master frame shows one whole source frame and
// the eval's "source_t + (t - master_t)" mapping is exact.

import { resolveAnchor, type EditOnlyAnchor } from '../anchors';
import type { CardCropName, Events, ObservedEvent, Rect, Timeline, TimelineBeat } from '../schema';
import { smoothedFocusX, type StageConfig } from './camera';
import { shotFrameCrops, type CameraBeatSpan } from './cameraPath';
import { buildCardTimeline, cardSteadyOf, type CardSteadySize } from './cardTimeline';

// --- Minimal shots.json shape this module actually reads --------------
//
// The full shots.json document carries far more than this (captions,
// sfx, overlays prose, etc.) — this module only needs the fields that
// drive beat timing and the camera crop.

export interface ShotBeat {
  name: string;
  in?: string;
  out?: string;
  caption?: string;
  caption_at?: string;
  caption_out?: string;
  caption_sample?: string;
  camera: {
    zoom: number;
    focus: string;
    move: string;
    sample: number | 'card';
  };
  overlay?: {
    from?: string;
    to?: string;
    name_tag?: string;
    clock?: { text: string; from: string }[];
    clock_out?: string;
    cta?: string;
    place?: string;
  };
  style?: string;
  card?: { crop: CardCropName; scale_native: 1 | 2 };
  sfx?: { file: string; at: string; peak_dbfs?: number; rate?: number }[];
}

export interface Shot {
  id: string;
  beats: ShotBeat[];
  /** Card beats only (s2b_shelter): the popup take's own capture viewport, for cardCrop.ts's `vw`. */
  viewport?: { width: number };
  /** Card shots: the cells no crop may meet (s2b_shelter.layout_expect.forbidden_types). */
  layout_expect?: { forbidden_types?: string[] };
}

export interface PopupCardPlacement {
  anchor: { cx: number; cy?: number; top?: number };
  caption_rect: Rect;
}

export interface ShotsDoc {
  edit_order: string[];
  shots: Shot[];
  overlays?: {
    popup_card?: {
      placement?: {
        '16x9'?: PopupCardPlacement;
        '9x16'?: PopupCardPlacement;
        steady_at?: {
          '16x9'?: Record<CardCropName, { x: number; y: number }>;
          '9x16'?: Record<CardCropName, { x: number; y: number }>;
        };
      };
    };
  };
}

const DEFAULT_FPS = 25;

// --- Move-text classification -------------------------------------------
//
// camera.move is authored prose (video/shots.json conventions.camera),
// but it is drawn from a small closed vocabulary — see
// conventions.camera.sample and the per-beat text in shots.json. Beats are
// frozen (video/README.md), so classifying by exact phrasing is a
// deliberate, documented simplification rather than a fragile parser: the
// three PRECISELY judged move shapes ("hold", "Hold Z until X, then
// push...", and b6's "the push ends at X, then hold") are matched
// exactly; anything else ("follow", "push ... then follow") is treated as
// CONTINUOUS and only receives a best-effort crop, matching the epic's own
// rule that only 'hold' beats and 'Hold ... until' beats are judged by the
// hold check — follow beats "may declare short holds" and are reported,
// not judged.

export type MoveKind = 'hold' | 'hold_until' | 'push_then_hold' | 'push_then_follow' | 'continuous';

export interface ClassifiedMove {
  kind: MoveKind;
  /** hold_until: the anchor spec at which the hold ends and the push starts. */
  untilAnchor?: string;
  /** hold_until: the zoom held before the push (parsed from "Hold <z>x"). */
  preZoom?: number;
  /** push_then_hold (b6-style): the anchor spec at which the push ends and the hold starts. */
  pushEndAnchor?: string;
  /** push_then_follow (b1b-style): the anchor spec the push starts at. */
  pushStartAnchor?: string;
  /** push_then_follow: the zoom held before the push (parsed from "push from <z>x"). */
  pushFromZoom?: number;
  /** push_then_follow: the push's own duration in ms, parsed from "over <n> ms". */
  pushDurationMs?: number;
}

const HOLD_UNTIL_RE = /^Hold ([\d.]+)x[^]*?until ([\w:+-]+),/;
const PUSH_ENDS_RE = /the push ends at ([\w:+-]+), then hold/;
const AT_PUSH_THEN_FOLLOW_RE = /^At ([\w:+-]+), push from ([\d.]+)x to [\d.]+x over (\d+) ms.*then follow/;

export function classifyMove(moveText: string): ClassifiedMove {
  const trimmed = moveText.trim();
  if (trimmed === 'hold' || trimmed.startsWith('hold;')) {
    return { kind: 'hold' };
  }
  const pushEnds = PUSH_ENDS_RE.exec(trimmed);
  if (pushEnds) {
    return { kind: 'push_then_hold', pushEndAnchor: pushEnds[1] };
  }
  const holdUntil = HOLD_UNTIL_RE.exec(trimmed);
  if (holdUntil) {
    return { kind: 'hold_until', preZoom: parseFloat(holdUntil[1]), untilAnchor: holdUntil[2] };
  }
  const atPushThenFollow = AT_PUSH_THEN_FOLLOW_RE.exec(trimmed);
  if (atPushThenFollow) {
    return { kind: 'push_then_follow', pushStartAnchor: atPushThenFollow[1], pushFromZoom: parseFloat(atPushThenFollow[2]), pushDurationMs: parseInt(atPushThenFollow[3], 10) };
  }
  return { kind: 'continuous' };
}

// --- Anchor resolution, including edit-only anchors ---------------------

export interface AnchorContext {
  events: Events;
  /** This beat's own resolved master_in, for the 'in' edit-only anchor. */
  beatInMs?: number;
  /**
   * The whole edit's total length, for the 'end' edit-only anchor
   * (b6_brand_line's caption_out). Every caption/overlay window this
   * module resolves is clamped to [masterIn, masterOut] of its OWN
   * beat/shot before use (resolveCaptionT), so "end" only needs to
   * resolve to a value at or beyond that bound — its exact magnitude
   * relative to the true whole-edit length doesn't need to be exact, and
   * a beat that never actually reaches "end" (every real film beat but
   * the last) has its window's `to` clamped down to its own masterOut
   * regardless.
   */
  totalMs?: number;
}

/**
 * Resolves an anchor spec against a shot's Events, additionally handling
 * the edit-only anchors that `anchors.ts`'s `resolveAnchor` deliberately
 * refuses (they are "resolved by the edit, not the recorder"): `in` (this
 * beat's own start), `end` (the whole edit's length), `cursor_depart`
 * (the first click's tDepartMs), and `ball_in_frame` (approximated per
 * `conventions.edit_anchors`: "about dblclick + 440 ms at 1.0x" — the
 * first dblclick's tMs + 440). `catch_point` is a POSITION anchor
 * (conventions.edit_anchors: "the logged ball x at the catch"), not a
 * time anchor, and is resolved by `resolveFocusX` instead; calling it
 * here is a caller error.
 */
export function resolveEditAnchor(spec: string, ctx: AnchorContext): number {
  const name = spec.replace(/[+-]\d+$/, '') as EditOnlyAnchor;
  const offsetMatch = /([+-]\d+)$/.exec(spec);
  const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;

  if (name === 'in') {
    if (ctx.beatInMs === undefined) {
      throw new Error(`anchor "${spec}": "in" is not resolvable without this beat's own master_in`);
    }
    return ctx.beatInMs + offset;
  }
  if (name === 'end') {
    if (ctx.totalMs === undefined) {
      throw new Error(`anchor "${spec}": "end" is not resolvable without the edit's total length`);
    }
    return ctx.totalMs + offset;
  }
  if (name === 'cursor_depart') {
    const first = ctx.events.clicks[0];
    if (!first) {
      throw new Error(`anchor "${spec}": no clicks logged to resolve cursor_depart`);
    }
    return first.tDepartMs + offset;
  }
  if (name === 'ball_in_frame') {
    const dbl = ctx.events.clicks.find((c) => c.kind === 'dblclick');
    if (!dbl) {
      throw new Error(`anchor "${spec}": no dblclick logged to approximate ball_in_frame`);
    }
    return dbl.tMs + 440 + offset;
  }
  throw new Error(`anchor "${spec}": "${name}" is not a resolvable edit-only time anchor (catch_point is a position, not a time)`);
}

const SOURCE_CLOCK_SHIFT_NAMES = new Set(['cursor_depart', 'ball_in_frame']);

/**
 * Resolves any anchor spec to a position in the shot's demo.mp4: recorder
 * anchors via anchors.ts, edit-only anchors via resolveEditAnchor. Per
 * this bead's step 2 spec ("source_in/source_out ... equal trimBeforeMs +
 * the LOGGED anchor time"), every anchor whose value comes from the
 * recorder's own logged clock (`observed[]`, `clicks[]`) sits
 * `events.trimBeforeMs` ms earlier in the assembled demo.mp4 than its
 * logged timestamp, because the file was NOT re-zeroed to the recorder's
 * own clock start when its leading clapper was trimmed. `in` and `end`
 * are exempt: they are already defined relative to a beat's own
 * (already-shifted) master_in, or to the whole edit's master length, and
 * adding the shift again would double-count it.
 */
export function resolveAnyAnchor(spec: string, ctx: AnchorContext): number {
  const name = spec.replace(/[+-]\d+$/, '');
  if (name === 'in' || name === 'end') {
    return resolveEditAnchor(spec, ctx);
  }
  if (SOURCE_CLOCK_SHIFT_NAMES.has(name)) {
    return resolveEditAnchor(spec, ctx) + ctx.events.trimBeforeMs;
  }
  return resolveAnchor(spec, ctx.events) + ctx.events.trimBeforeMs;
}

// --- Focus resolution -----------------------------------------------------

const PET_FOCUS_RE = /^pet:(\w+)$/;
const BETWEEN_FOCUS_RE = /^between:(\w+),(\w+)$/;

function findCatchEvent(events: Events): ObservedEvent | undefined {
  return events.observed.find((e) => e.kind === 'catch');
}

/**
 * Resolves one pet's focus x (stage px) at `atMs`: from `events.tracks`
 * when present (400ms-smoothed, per camera.ts), else from the pet's own
 * hover/click rect (storyboard: "fall back to the click rect when tracks
 * is absent, as in the fixture"). Track/click coordinates are CSS px in
 * the 960x540 recording viewport (video/shots.json conventions.units);
 * multiplying by 2 (the recording's fixed device_scale_factor) converts
 * to native/stage px, which is 1:1 with stage x for both aspect ratios
 * (only the vertical axis needs the floor-band offset).
 */
function resolvePetFocusX(events: Events, petId: string, atMs: number): number {
  const CSS_TO_STAGE = 2;
  if (events.tracks && events.tracks.length > 0) {
    const samples = events.tracks
      .flatMap((frame) => (frame.pets ?? []).filter((p) => p.id === petId).map((p) => ({ t: frame.t, x: p.x + p.w / 2 })))
      .filter((s) => Number.isFinite(s.x));
    if (samples.length > 0) {
      return smoothedFocusX(samples, atMs) * CSS_TO_STAGE;
    }
  }
  const click = events.clicks.find((c) => c.pet === petId);
  if (click) {
    return (click.rect.x + click.rect.w / 2) * CSS_TO_STAGE;
  }
  throw new Error(`resolvePetFocusX: no tracks or click rect for pet "${petId}"`);
}

/**
 * Resolves a beat's `camera.focus` string to a stage-px x coordinate at
 * `atMs` (the LOGGED clock of events.tracks/clicks, not demo.mp4 time), per video/shots.json conventions.camera.focus: "page" is the
 * stage centre (irrelevant at z=1, where the crop spans the whole
 * width); "pet:<id>" follows that pet; "between:<a>,<b>" is the mean of
 * both pets' focus x; "catch_point" is the logged ball x at the catch
 * event.
 */
export function resolveFocusX(focus: string, stage: StageConfig, events: Events, atMs: number): number {
  if (focus === 'page') {
    return stage.width / 2;
  }
  const petMatch = PET_FOCUS_RE.exec(focus);
  if (petMatch) {
    return resolvePetFocusX(events, petMatch[1], atMs);
  }
  const betweenMatch = BETWEEN_FOCUS_RE.exec(focus);
  if (betweenMatch) {
    const a = resolvePetFocusX(events, betweenMatch[1], atMs);
    const b = resolvePetFocusX(events, betweenMatch[2], atMs);
    return (a + b) / 2;
  }
  if (focus === 'catch_point') {
    const catchEvent = findCatchEvent(events);
    if (!catchEvent || catchEvent.x === undefined) {
      throw new Error('resolveFocusX: no catch event with x logged for catch_point focus');
    }
    return catchEvent.x * 2;
  }
  throw new Error(`resolveFocusX: unrecognised camera.focus "${focus}"`);
}

// --- Beat in/out chaining -------------------------------------------------

/**
 * Resolves each beat's master_in/master_out for one shot as a chain of
 * n+1 boundary points: beat i spans [boundary[i], boundary[i+1]).
 * video/shots.json's beats mostly omit an explicit `in`/`out` — a beat's
 * start is normally the previous beat's end. Where a beat DOES name its
 * own start marker (`in`, or failing that `caption_at`/`overlay.from` —
 * the narrative beat starts when its caption or overlay does), that
 * marker is used, clamped to never precede the previous boundary: real
 * shots.json data is authored so this clamp is always a no-op, but a
 * generic recording reused across unrelated fixture narratives (as
 * video/fixtures/events.sample.json is, across two different sample
 * shots) is not guaranteed internally chronological, and a beat must
 * never render with a negative duration because of that. The final
 * boundary (the last beat's end) falls back to `events.durationMs` when
 * undeclared.
 */
function resolveShotBeatBounds(beats: readonly ShotBeat[], events: Events): number[] {
  if (beats.length === 0) return [];

  const startMarker = (b: ShotBeat): number | undefined => {
    if (b.in) return resolveAnyAnchor(b.in, { events });
    if (b.caption_at) return resolveAnyAnchor(b.caption_at, { events });
    if (b.overlay?.from) return resolveAnyAnchor(b.overlay.from, { events });
    return undefined;
  };

  const boundary: number[] = new Array(beats.length + 1);
  const first = startMarker(beats[0]);
  if (first === undefined) {
    throw new Error(`beat "${beats[0].name}": the first beat of a shot must resolve an "in", caption_at, or overlay.from`);
  }
  boundary[0] = first;

  for (let i = 1; i < beats.length; i++) {
    const prevExplicitOut = beats[i - 1].out ? resolveAnyAnchor(beats[i - 1].out!, { events }) : undefined;
    if (prevExplicitOut !== undefined) {
      boundary[i] = prevExplicitOut;
      continue;
    }
    const marker = startMarker(beats[i]);
    boundary[i] = marker !== undefined ? Math.max(marker, boundary[i - 1]) : boundary[i - 1];
  }

  const last = beats[beats.length - 1];
  const explicitLastOut = last.out ? resolveAnyAnchor(last.out, { events }) : undefined;
  boundary[beats.length] = explicitLastOut !== undefined ? explicitLastOut : Math.max(events.durationMs, boundary[beats.length - 1]);

  const bounds: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    bounds.push(boundary[i], boundary[i + 1]);
  }
  return bounds;
}

// --- Caption timing -------------------------------------------------------

/**
 * The master time verify.mjs samples this beat's on-screen text at, per
 * "master_t is the middle of the beat's steady hold... caption_t...
 * [is] the master time at the middle of the intersection of the on-screen
 * windows of every text the beat shows... or the beat's caption_sample
 * when the spec names one." This implementation covers the single-text
 * case (caption, name tag, clock or CTA alone) plus the explicit
 * `caption_sample` override; a beat with two independently-windowed texts
 * (b5_lights_out) always sets `caption_sample`, so the general
 * intersection case never needs deriving here.
 */
function resolveCaptionT(beat: ShotBeat, masterIn: number, masterOut: number, ctx: AnchorContext): number | undefined {
  if (beat.caption_sample) {
    return resolveAnyAnchor(beat.caption_sample, ctx);
  }
  if (beat.caption_at && beat.caption_out) {
    const from = Math.max(masterIn, resolveAnyAnchor(beat.caption_at, ctx));
    const to = Math.min(masterOut, resolveAnyAnchor(beat.caption_out, ctx));
    return (from + to) / 2;
  }
  if (beat.overlay?.from && beat.overlay?.to) {
    const from = Math.max(masterIn, resolveAnyAnchor(beat.overlay.from, ctx));
    const to = Math.min(masterOut, resolveAnyAnchor(beat.overlay.to, ctx));
    return (from + to) / 2;
  }
  return undefined;
}

// --- Public entry point ----------------------------------------------

/** Render-only data per beat, beside the frozen TimelineBeat fields. Never written to timeline.json. */
export interface EditBeat extends TimelineBeat {
  shotId: string;
  /** master ms = demo ms + shiftMs for every frame of this beat's shot. */
  shiftMs: number;
  /** The beat's master frames [k0, k1). */
  k0: number;
  k1: number;
  /** Page beats: the crop drawn on each master frame, [k - k0]. */
  frameCrops?: Rect[];
  /** Card beats: the card's visible frame on each master frame, [k - k0]. */
  cardEnvelopes?: Rect[];
}

export interface EditTimeline {
  music: string;
  fps: number;
  beats: EditBeat[];
  /** Whole frames in the master. */
  totalFrames: number;
}

export interface BuildTimelineOptions {
  shots: ShotsDoc;
  stage: StageConfig;
  /** '16x9' or '9x16': selects overlays.popup_card.placement.steady_at for card beats. Required whenever a shot has card beats. */
  aspect?: '16x9' | '9x16';
  /** events.json per shot id, keyed by shot id. */
  eventsByShotId: Record<string, Events>;
  /** absolute path of each shot's demo.mp4 under build/<run>/, keyed by shot id. */
  sourceByShotId: Record<string, string>;
  music: string;
  fps?: number;
  /** --no-zoom: every page frame is the full stage (a control render; its timeline declares the full stage). */
  noZoom?: boolean;
  /**
   * Fixture renders only: keep a beat whose anchors resolve out of order on
   * the take (it spans no frame and is not drawn). fixtures/events.sample.json
   * is one generic capture reused under two unrelated sample narratives, so
   * its beats are not chronological. A real or synthetic run never sets
   * this: there an empty beat is an error.
   */
  allowEmptyBeats?: boolean;
  /**
   * --run only, shots.json master.length_rule: "Under 28.3 s: extend the
   * final hold by up to 1.0 s." The last beat's hold runs on (its crop
   * unchanged) until the master reaches this length, by at most 1000 ms.
   */
  minLengthMs?: number;
}

const CARD_POP_IN_MS = 200;
const CARD_MORPH_MS = 160;

/**
 * The longest run of identical crops among `crops` whose zoom is `sampleZoom`
 * (any zoom when none matches, e.g. under --no-zoom): [first, last] indices.
 */
export function steadyRun(crops: readonly Rect[], stageWidth: number, sampleZoom: number): { first: number; last: number } {
  const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const runs: { first: number; last: number }[] = [];
  for (let i = 0; i < crops.length; i++) {
    if (i > 0 && same(crops[i], crops[i - 1])) runs[runs.length - 1].last = i;
    else runs.push({ first: i, last: i });
  }
  const wantW = Math.round(stageWidth / sampleZoom);
  const atZoom = runs.filter((r) => crops[r.first].w === wantW);
  const pool = atZoom.length ? atZoom : runs;
  return pool.reduce((best, r) => (r.last - r.first > best.last - best.first ? r : best), pool[0]);
}

/**
 * Builds the edit's timeline for every beat of `opts.shots`, in
 * edit_order: beat bounds on master frame starts, the page camera's crop on
 * every frame (cameraPath.ts), each page beat's declared crop / master_t /
 * hold window derived from those frames, and each card beat's per-frame
 * card (cardTimeline.ts). All values in ms; see timelineJson().
 */
export function buildTimeline(opts: BuildTimelineOptions): EditTimeline {
  const fps = opts.fps ?? DEFAULT_FPS;
  const frameMs = 1000 / fps;
  const ceilFrame = (ms: number) => Math.ceil(ms / frameMs - 1e-6);

  const beats: EditBeat[] = [];
  let masterFrame = 0;
  const deferred: { beat: ShotBeat; tb: EditBeat; events: Events; sourceIn: number; sourceOut: number }[] = [];

  for (const shotId of opts.shots.edit_order) {
    const shot = opts.shots.shots.find((s) => s.id === shotId);
    if (!shot) {
      throw new Error(`buildTimeline: edit_order names shot "${shotId}", which is not in shots[]`);
    }
    const events = opts.eventsByShotId[shotId];
    if (!events) {
      throw new Error(`buildTimeline: no Events supplied for shot "${shotId}"`);
    }
    const source = opts.sourceByShotId[shotId];
    if (!source) {
      throw new Error(`buildTimeline: no source path supplied for shot "${shotId}"`);
    }

    const bounds = resolveShotBeatBounds(shot.beats, events);
    const shiftFrames = masterFrame - ceilFrame(bounds[0]);
    const shiftMs = shiftFrames * frameMs;
    const spans: CameraBeatSpan[] = shot.beats.map((beat, i) => ({
      beat,
      sourceIn: bounds[i * 2],
      sourceOut: bounds[i * 2 + 1],
      k0: ceilFrame(bounds[i * 2]) + shiftFrames,
      k1: ceilFrame(bounds[i * 2 + 1]) + shiftFrames,
    }));
    for (const sp of spans) {
      if (sp.k1 <= sp.k0 && !opts.allowEmptyBeats) {
        throw new Error(`buildTimeline: beat "${sp.beat.name}" spans no master frame (demo ${sp.sourceIn.toFixed(0)}-${sp.sourceOut.toFixed(0)} ms): its anchors resolve out of order on this take`);
      }
    }
    const isCardShot = shot.beats.some((b) => b.camera.sample === 'card');
    const pageCrops = isCardShot ? null : shotFrameCrops({ spans, events, stage: opts.stage, shiftMs, fps, noZoom: opts.noZoom });
    let prevCardSteady: CardSteadySize | undefined;

    spans.forEach((sp, i) => {
      const beat = sp.beat;
      const tb: EditBeat = {
        name: beat.name,
        shotId,
        shiftMs,
        k0: sp.k0,
        k1: sp.k1,
        master_t: 0,
        source_t: 0,
        source_in: sp.sourceIn,
        source_out: sp.sourceOut,
        source,
        master_in: sp.k0 * frameMs,
        master_out: sp.k1 * frameMs,
      };

      if (sp.k1 <= sp.k0) {
        tb.master_t = tb.master_in; // allowEmptyBeats: nothing is drawn for this beat
      } else if (beat.camera.sample !== 'card') {
        if (!pageCrops) throw new Error(`buildTimeline: shot "${shotId}" mixes card and page beats`);
        const crops = pageCrops[i];
        const run = steadyRun(crops, opts.stage.width, Number(beat.camera.sample));
        const k = sp.k0 + run.first + Math.floor((run.last - run.first) / 2);
        tb.frameCrops = crops;
        tb.crop = crops[k - sp.k0];
        tb.zoomed = tb.crop.w < opts.stage.width;
        tb.master_t = k * frameMs;
        tb.hold_in = (sp.k0 + run.first) * frameMs;
        tb.hold_out = (sp.k0 + run.last + 1) * frameMs;
      } else {
        if (!beat.card) throw new Error(`buildTimeline: beat "${beat.name}" samples the popup card but declares no card {crop, scale_native}`);
        if (!opts.aspect) throw new Error(`buildTimeline: shot "${shotId}" has card beats but no aspect ('16x9'|'9x16') was supplied`);
        if (!shot.viewport) throw new Error(`buildTimeline: shot "${shotId}" has card beats but declares no viewport (needed for the crop rule's CSS width)`);
        const steadyAt = opts.shots.overlays?.popup_card?.placement?.steady_at?.[opts.aspect]?.[beat.card.crop];
        if (!steadyAt) throw new Error(`buildTimeline: no overlays.popup_card.placement.steady_at.${opts.aspect}.${beat.card.crop} in shots.json`);
        const built = buildCardTimeline({
          cropName: beat.card.crop,
          scale: beat.card.scale_native,
          steadyAt,
          viewportWidthCss: shot.viewport.width,
          events,
          fps,
          k0: sp.k0,
          k1: sp.k1,
          shiftMs,
          transitionMs: prevCardSteady ? CARD_MORPH_MS : CARD_POP_IN_MS,
          prevSteady: prevCardSteady,
        });
        tb.card = built.card;
        tb.cardEnvelopes = built.envelopes;
        tb.master_t = built.sampleK * frameMs;
        prevCardSteady = cardSteadyOf(built.card);
      }
      tb.source_t = tb.master_t - shiftMs;

      if (usesEndAnchor(beat)) deferred.push({ beat, tb, events, sourceIn: sp.sourceIn, sourceOut: sp.sourceOut });
      else setCaptionSample(beat, tb, { events, beatInMs: sp.sourceIn }, sp.sourceIn, sp.sourceOut, frameMs);
      beats.push(tb);
    });

    masterFrame = spans[spans.length - 1].k1;
  }

  if (opts.minLengthMs !== undefined && masterFrame * frameMs < opts.minLengthMs) {
    const last = beats[beats.length - 1];
    const add = Math.min(Math.ceil((opts.minLengthMs - masterFrame * frameMs) / frameMs - 1e-6), Math.floor(1000 / frameMs));
    last.k1 += add;
    last.master_out = last.k1 * frameMs;
    last.source_out += add * frameMs;
    if (last.frameCrops) {
      const end = last.frameCrops[last.frameCrops.length - 1];
      for (let i = 0; i < add; i++) last.frameCrops.push(end);
      if (last.hold_out !== undefined && last.hold_out === last.master_out - add * frameMs) last.hold_out = last.master_out;
    }
    masterFrame += add;
  }

  const totalMs = masterFrame * frameMs;
  for (const d of deferred) {
    setCaptionSample(d.beat, d.tb, { events: d.events, beatInMs: d.sourceIn, totalMs: totalMs - d.tb.shiftMs }, d.sourceIn, d.sourceOut, frameMs);
  }

  return { music: opts.music, fps, beats, totalFrames: masterFrame };
}

/** caption_t (snapped to the master frame that shows it), caption_source_t and caption_crop, on a beat that shows text. */
function setCaptionSample(beat: ShotBeat, tb: EditBeat, ctx: AnchorContext, sourceIn: number, sourceOut: number, frameMs: number): void {
  const c = resolveCaptionT(beat, sourceIn, sourceOut, ctx);
  if (c === undefined) return;
  const k = Math.min(tb.k1 - 1, Math.max(tb.k0, Math.round((c + tb.shiftMs) / frameMs)));
  tb.caption_t = k * frameMs;
  tb.caption_source_t = tb.caption_t - tb.shiftMs;
  if (tb.frameCrops) tb.caption_crop = tb.frameCrops[k - tb.k0];
}

/** Whether resolving this beat's caption window needs the edit-only "end" anchor (deferred to a second pass, once the edit's length is known). */
function usesEndAnchor(beat: ShotBeat): boolean {
  return beat.caption_out === 'end' || beat.overlay?.to === 'end';
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const sec = (ms: number) => round6(ms / 1000);

/**
 * The frozen Timeline shape timeline.json carries, in SECONDS (what
 * verify.mjs reads): only the schema's fields, every time converted.
 */
export function timelineJson(edit: EditTimeline): Timeline {
  return {
    music: edit.music,
    beats: edit.beats.map((b) => {
      const out: TimelineBeat = {
        name: b.name,
        master_t: sec(b.master_t),
        source_t: sec(b.source_t),
        source_in: sec(b.source_in),
        source_out: sec(b.source_out),
        source: b.source,
        master_in: sec(b.master_in),
        master_out: sec(b.master_out),
      };
      if (b.zoomed !== undefined) out.zoomed = b.zoomed;
      if (b.crop) out.crop = b.crop;
      if (b.hold_in !== undefined) out.hold_in = sec(b.hold_in);
      if (b.hold_out !== undefined) out.hold_out = sec(b.hold_out);
      if (b.caption_t !== undefined) out.caption_t = sec(b.caption_t);
      if (b.caption_source_t !== undefined) out.caption_source_t = sec(b.caption_source_t);
      if (b.caption_crop) out.caption_crop = b.caption_crop;
      if (b.card) out.card = { ...b.card, frames: b.card.frames.map((f) => ({ ...f, t: sec(f.t) })) };
      return out;
    }),
  };
}

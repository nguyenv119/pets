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

import { resolveAnchor, type EditOnlyAnchor } from '../anchors';
import type { Events, ObservedEvent, Rect, Timeline, TimelineBeat } from '../schema';
import { floorAnchoredCrop, smoothedFocusX, type StageConfig } from './camera';

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
  card?: unknown;
}

export interface Shot {
  id: string;
  beats: ShotBeat[];
}

export interface ShotsDoc {
  edit_order: string[];
  shots: Shot[];
}

export interface BuildTimelineOptions {
  shots: ShotsDoc;
  stage: StageConfig;
  /** events.json per shot id, keyed by shot id. */
  eventsByShotId: Record<string, Events>;
  /** absolute path of each shot's demo.mp4 under build/<run>/, keyed by shot id. */
  sourceByShotId: Record<string, string>;
  music: string;
  fps?: number;
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

export type MoveKind = 'hold' | 'hold_until' | 'push_then_hold' | 'continuous';

export interface ClassifiedMove {
  kind: MoveKind;
  /** hold_until: the anchor spec at which the hold ends and the push starts. */
  untilAnchor?: string;
  /** hold_until: the zoom held before the push (parsed from "Hold <z>x"). */
  preZoom?: number;
  /** push_then_hold (b6-style): the anchor spec at which the push ends and the hold starts. */
  pushEndAnchor?: string;
}

const HOLD_UNTIL_RE = /^Hold ([\d.]+)x[^]*?until ([\w:+-]+),/;
const PUSH_ENDS_RE = /the push ends at ([\w:+-]+), then hold/;

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
  return { kind: 'continuous' };
}

// --- Anchor resolution, including edit-only anchors ---------------------

export interface AnchorContext {
  events: Events;
  /** This beat's own resolved master_in, for the 'in' edit-only anchor. */
  beatInMs?: number;
  /** The whole edit's total length, for the 'end' edit-only anchor. */
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
 * `atMs`, per video/shots.json conventions.camera.focus: "page" is the
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

// --- Beat crop at an instant ------------------------------------------

/**
 * The floor-anchored crop a beat renders at `atMs`, per its classified
 * move. `hold` and the pre-push portion of `hold_until` render the
 * declared/parsed zoom's crop; the post-until portion of `hold_until`,
 * `push_then_hold` and `continuous` beats render `camera.zoom`'s crop at
 * `atMs`'s own focus (a documented simplification for the mid-push
 * instant — see this module's header comment — since none of the
 * precisely-judged checks sample a beat during its own push).
 */
export function beatCropAt(beat: ShotBeat, stage: StageConfig, events: Events, atMs: number, ctx: AnchorContext): Rect {
  const move = classifyMove(beat.camera.move);
  if (move.kind === 'hold_until') {
    const untilMs = resolveAnyAnchor(move.untilAnchor!, ctx);
    if (atMs <= untilMs) {
      const zoom = move.preZoom ?? 1;
      const focusX = zoom === 1 ? stage.width / 2 : resolveFocusX(beat.camera.focus, stage, events, atMs);
      return floorAnchoredCrop(stage, zoom, focusX);
    }
  }
  const focusX = beat.camera.zoom === 1 ? stage.width / 2 : resolveFocusX(beat.camera.focus, stage, events, atMs);
  return floorAnchoredCrop(stage, beat.camera.zoom, focusX);
}

/** hold_in/hold_out per the epic's classification, or undefined for a continuous (follow) beat. */
export function beatHoldWindow(
  beat: ShotBeat,
  masterIn: number,
  masterOut: number,
  ctx: AnchorContext,
): { hold_in: number; hold_out: number } | undefined {
  const move = classifyMove(beat.camera.move);
  if (move.kind === 'hold') {
    return { hold_in: masterIn, hold_out: masterOut };
  }
  if (move.kind === 'hold_until') {
    return { hold_in: masterIn, hold_out: resolveAnyAnchor(move.untilAnchor!, ctx) };
  }
  if (move.kind === 'push_then_hold') {
    return { hold_in: resolveAnyAnchor(move.pushEndAnchor!, ctx), hold_out: masterOut };
  }
  return undefined;
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

/**
 * Builds the Timeline document for every beat of `opts.shots`, in
 * edit_order, for the given stage config (16:9 or 9:16). Card beats
 * (camera.sample === 'card') are given a crop/master_t but NOT a
 * populated `card` field — that is cardCrop.ts's responsibility; a
 * caller that needs the full popup-card timeline must merge its output
 * in separately. This keeps this module's own test surface to pure
 * beat-timing and camera-crop logic.
 */
export function buildTimeline(opts: BuildTimelineOptions): Timeline {
  const fps = opts.fps ?? DEFAULT_FPS;
  const frameMs = 1000 / fps;
  const roundToFrame = (ms: number) => Math.round(ms / frameMs) * frameMs;

  const beats: TimelineBeat[] = [];
  let masterCursor = 0;

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
    const shotStartSourceMs = bounds[0];
    const shotSpanMs = bounds[bounds.length - 1] - shotStartSourceMs;
    const shotMasterStart = masterCursor;

    for (let i = 0; i < shot.beats.length; i++) {
      const beat = shot.beats[i];
      const sourceIn = bounds[i * 2];
      const sourceOut = bounds[i * 2 + 1];
      const masterIn = roundToFrame(shotMasterStart + (sourceIn - shotStartSourceMs));
      const masterOut = roundToFrame(shotMasterStart + (sourceOut - shotStartSourceMs));
      const ctx: AnchorContext = { events, beatInMs: sourceIn };

      const isCard = beat.camera.sample === 'card';
      const masterT = (masterIn + masterOut) / 2;
      const sourceT = (sourceIn + sourceOut) / 2;

      const timelineBeat: TimelineBeat = {
        name: beat.name,
        master_t: masterT,
        source_t: sourceT,
        source_in: sourceIn,
        source_out: sourceOut,
        source,
        master_in: masterIn,
        master_out: masterOut,
      };

      if (!isCard) {
        timelineBeat.zoomed = beat.camera.zoom > 1;
        timelineBeat.crop = beatCropAt(beat, opts.stage, events, sourceT, ctx);
        const holdWindow = beatHoldWindow(beat, masterIn, masterOut, ctx);
        if (holdWindow) {
          timelineBeat.hold_in = holdWindow.hold_in;
          timelineBeat.hold_out = holdWindow.hold_out;
        }
      }

      const captionSourceT = resolveCaptionT(beat, sourceIn, sourceOut, ctx);
      if (captionSourceT !== undefined) {
        timelineBeat.caption_source_t = captionSourceT;
        timelineBeat.caption_t = roundToFrame(shotMasterStart + (captionSourceT - shotStartSourceMs));
        if (!isCard) {
          timelineBeat.caption_crop = beatCropAt(beat, opts.stage, events, captionSourceT, ctx);
        }
      }

      beats.push(timelineBeat);
    }

    masterCursor = shotMasterStart + shotSpanMs;
  }

  return { music: opts.music, beats };
}

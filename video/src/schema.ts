// Shared contract types + validators for the promo-video pipeline
// (epic pets-o3p). Browser-safe: a Remotion composition may import this
// file, so it must never import Node built-ins or the extension's own
// source. The pet-species allowlist lives in species.node.ts (Node-only)
// and is passed in by callers, never imported here.
//
// Frozen from this bead's commit on (video/README.md) — a needed change is
// a follow-up bead, never an edit inside pets-o3p.2/.3/.4/.5.

/** The closed vocabulary of events the recorder (or the popup take) logs. */
export type ObservedKind =
  // page-shot events
  | 'clap'
  | 'first_paint'
  | 'pets_ready'
  | 'shim'
  | 'src'
  | 'greet_start'
  | 'greet_end'
  | 'ball_on'
  | 'ball_floor'
  | 'ball_off'
  | 'heart_on'
  | 'catch'
  | 'hour_set'
  | 'sleep'
  | 'mousedown'
  | 'mouseup'
  | 'click'
  | 'dblclick'
  // popup-take events
  | 'popup_ready'
  | 'form_expanded'
  | 'shelter_click'
  | 'name_click'
  | 'name_typed'
  | 'type_selected'
  | 'color_selected'
  | 'add_mousedown'
  | 'add_mouseup'
  | 'roster_saved'
  // derived (never logged directly; anchors/edit code may reference them)
  | 'wave'
  | 'chase_start'
  | 'eat'
  | 'greet';

export const OBSERVED_KINDS: readonly ObservedKind[] = [
  'clap',
  'first_paint',
  'pets_ready',
  'shim',
  'src',
  'greet_start',
  'greet_end',
  'ball_on',
  'ball_floor',
  'ball_off',
  'heart_on',
  'catch',
  'hour_set',
  'sleep',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'popup_ready',
  'form_expanded',
  'shelter_click',
  'name_click',
  'name_typed',
  'type_selected',
  'color_selected',
  'add_mousedown',
  'add_mouseup',
  'roster_saved',
  'wave',
  'chase_start',
  'eat',
  'greet',
];

const OBSERVED_KIND_SET: ReadonlySet<string> = new Set(OBSERVED_KINDS);

export function isObservedKind(value: unknown): value is ObservedKind {
  return typeof value === 'string' && OBSERVED_KIND_SET.has(value);
}

/** Identity fields for one seeded/adopted pet. Positional data lives elsewhere. */
export interface RosterEntry {
  id: string;
  name: string;
  type: string;
  color: string;
  hidden?: boolean;
}

export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClickEvent {
  label: string;
  kind: string;
  tMs: number;
  tDepartMs: number;
  tDownMs: number;
  x: number;
  y: number;
  rect: Rect;
  pet?: string;
}

/** One logged observation. Field applicability depends on `kind` (see shots.json conventions.events). */
export interface ObservedEvent {
  t: number;
  kind: ObservedKind;
  pet?: string;
  from?: string;
  to?: string;
  x?: number;
  y?: number;
  type?: string;
  color?: string;
  scrollHeight?: number;
  innerHeight?: number;
  roster?: Array<{ id: string; name: string; type: string; color: string }>;
}

export interface TrackPetBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface TrackBall {
  x: number;
  y: number;
}

export interface TrackCell {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrackEls {
  pets_list: Rect;
  btn_add_toggle: Rect;
  add_pet_form: Rect;
  pet_name: Rect;
  pet_color_label: Rect;
  btn_add: Rect;
}

/** One rAF-loop sample. Page shots carry pets/ball; the popup take carries cells/els. */
export interface TrackFrame {
  t: number;
  pets?: TrackPetBox[];
  ball?: TrackBall;
  cells?: TrackCell[];
  els?: TrackEls;
}

export interface EventsCapture {
  method: 'cdp-screencast';
  dpr: number;
  fps: number;
}

/** events.json: what the recorder (or the popup take) wrote for one shot. */
export interface Events {
  name: string;
  viewport: { width: number; height: number };
  capture: EventsCapture;
  /** epoch ms of the start clapper release. */
  recordedAt: number;
  extensionId: string;
  /** popup take only: exactly chrome-extension://<extensionId>/popup/popup.html */
  url?: string;
  /** 'v3;seed=N', or 'fixture' in fixtures (never passes the epic eval). */
  shim: string;
  roster: RosterEntry[];
  durationMs: number;
  offsetMs: number;
  trimBeforeMs: number;
  videoLagMs: number;
  cursorTrack: CursorSample[];
  clicks: ClickEvent[];
  observed: ObservedEvent[];
  tracks?: TrackFrame[];
}

export type CardCropName = 'A_list' | 'B_pick' | 'C_add';

export interface TimelineCardFrame {
  t: number;
  rect: Rect;
  at: { x: number; y: number };
  w: number;
  h: number;
}

export interface TimelineCard {
  crop: CardCropName;
  rect: Rect;
  scale: 1 | 2;
  at: { x: number; y: number };
  /** Every master frame of the beat (spring/morph frames included). Never empty on a card beat. */
  frames: TimelineCardFrame[];
}

export interface TimelineBeat {
  name: string;
  master_t: number;
  source_t: number;
  source_in: number;
  source_out: number;
  /** Absolute path of the recording under build/<run>/ (or build/<run>/v916/), never a staged copy. */
  source: string;
  zoomed?: boolean;
  crop?: Rect;
  master_in: number;
  master_out: number;
  hold_in?: number;
  hold_out?: number;
  caption_t?: number;
  caption_source_t?: number;
  caption_crop?: Rect;
  card?: TimelineCard;
}

/** timeline.json: the edit's per-beat resolution against the recorded source(s). */
export interface Timeline {
  music: string;
  beats: TimelineBeat[];
}

export interface AcceptResult {
  /** copied verbatim from the shot's `accept[]` text, so the eval can match it. */
  rule: string;
  pass: boolean;
  detail?: string;
}

// --- Validators -------------------------------------------------------
//
// Return an array of human-readable error strings; an empty array means
// valid. No schema library — these are hand-written structural checks.

export interface SpeciesAllowlist {
  /** every PetType the extension ships (src/types.ts), the single source of truth. */
  types: readonly string[];
  /** species kept out of frame for the marketing video (still valid PetTypes). */
  neverCastTypes: readonly string[];
  /** one colour of one species kept out of frame (the dog's Akita colourway). */
  neverCastColor: { type: string; color: string };
}

function isNeverCast(type: string, color: string | undefined, species: SpeciesAllowlist): boolean {
  if (species.neverCastTypes.includes(type)) return true;
  if (color !== undefined && type === species.neverCastColor.type && color === species.neverCastColor.color) {
    return true;
  }
  return false;
}

function validateRosterEntryAgainstSpecies(entry: { id?: unknown; type?: unknown; color?: unknown }, species: SpeciesAllowlist, where: string): string[] {
  const errors: string[] = [];
  const type = typeof entry.type === 'string' ? entry.type : undefined;
  const color = typeof entry.color === 'string' ? entry.color : undefined;
  const id = typeof entry.id === 'string' ? entry.id : '<unknown id>';

  if (type === undefined) {
    errors.push(`${where}: roster entry "${id}" is missing type`);
    return errors;
  }
  if (!species.types.includes(type)) {
    errors.push(`${where}: roster entry "${id}" has unknown species "${type}"`);
    return errors;
  }
  if (isNeverCast(type, color, species)) {
    errors.push(`${where}: roster entry "${id}" casts the never-cast species/colour "${type}${color ? '/' + color : ''}"`);
  }
  return errors;
}

/**
 * Validates a shots.json-shaped document: every seed roster entry names a
 * real, castable species, and every beat whose camera samples the popup
 * card ('card') actually declares one.
 */
export function validateShots(shots: unknown, species: SpeciesAllowlist): string[] {
  const errors: string[] = [];
  if (typeof shots !== 'object' || shots === null) {
    return ['shots document is not an object'];
  }
  const doc = shots as { shots?: unknown };
  if (!Array.isArray(doc.shots)) {
    return ['shots document has no shots[] array'];
  }

  for (const rawShot of doc.shots) {
    const shot = rawShot as { id?: unknown; seed?: { roster?: unknown }; beats?: unknown };
    const shotId = typeof shot.id === 'string' ? shot.id : '<unknown shot>';

    const roster = shot.seed?.roster;
    if (Array.isArray(roster)) {
      for (const entry of roster) {
        errors.push(...validateRosterEntryAgainstSpecies(entry as { id?: unknown; type?: unknown; color?: unknown }, species, shotId));
      }
    }

    const beats = shot.beats;
    if (Array.isArray(beats)) {
      for (const rawBeat of beats) {
        const beat = rawBeat as { name?: unknown; camera?: { sample?: unknown }; card?: unknown };
        const beatName = typeof beat.name === 'string' ? beat.name : '<unknown beat>';
        if (beat.camera?.sample === 'card' && beat.card === undefined) {
          errors.push(`${shotId}/${beatName}: camera.sample is "card" but no card is declared`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validates an Events-shaped document: only known observed kinds, roster
 * entries with both type and colour, a monotonically non-decreasing
 * cursorTrack, and every observed[].t inside [0, durationMs].
 */
export function validateEvents(events: unknown, species: SpeciesAllowlist): string[] {
  const errors: string[] = [];
  if (typeof events !== 'object' || events === null) {
    return ['events document is not an object'];
  }
  const doc = events as Partial<Events>;

  const durationMs = typeof doc.durationMs === 'number' ? doc.durationMs : undefined;

  if (Array.isArray(doc.roster)) {
    for (const entry of doc.roster) {
      const e = entry as { id?: unknown; type?: unknown; color?: unknown };
      if (typeof e.type !== 'string') {
        errors.push(`roster entry "${String(e.id ?? '<unknown id>')}" is missing type`);
        continue;
      }
      if (typeof e.color !== 'string') {
        errors.push(`roster entry "${String(e.id ?? '<unknown id>')}" is missing color`);
        continue;
      }
      errors.push(...validateRosterEntryAgainstSpecies(e, species, 'events.roster'));
    }
  }

  if (Array.isArray(doc.cursorTrack)) {
    let lastT = -Infinity;
    for (const sample of doc.cursorTrack) {
      const t = (sample as { t?: unknown }).t;
      if (typeof t === 'number') {
        if (t < lastT) {
          errors.push(`cursorTrack goes back in time at t=${t} (previous t=${lastT})`);
        }
        lastT = t;
      }
    }
  }

  if (Array.isArray(doc.observed)) {
    for (const rawEvent of doc.observed) {
      const event = rawEvent as { t?: unknown; kind?: unknown };
      if (!isObservedKind(event.kind)) {
        errors.push(`observed event has unknown kind "${String(event.kind)}"`);
      }
      if (typeof event.t === 'number' && durationMs !== undefined) {
        if (event.t < 0 || event.t > durationMs) {
          errors.push(`observed event kind="${String(event.kind)}" has t=${event.t} outside [0, ${durationMs}]`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validates a Timeline-shaped document: every beat that declares a card
 * declares at least one frame for it.
 */
export function validateTimeline(timeline: unknown): string[] {
  const errors: string[] = [];
  if (typeof timeline !== 'object' || timeline === null) {
    return ['timeline document is not an object'];
  }
  const doc = timeline as Partial<Timeline>;
  if (!Array.isArray(doc.beats)) {
    return ['timeline document has no beats[] array'];
  }

  for (const beat of doc.beats) {
    const b = beat as Partial<TimelineBeat>;
    if (b.card !== undefined) {
      if (!Array.isArray(b.card.frames) || b.card.frames.length === 0) {
        errors.push(`${b.name ?? '<unknown beat>'}: card has no frames`);
      }
    }
  }

  return errors;
}

// cameraPath.ts: the page camera, one crop per master frame (epic pets-o3p,
// bead pets-o3p.4). Pure and browser-safe.
//
// Single source of truth for the page camera: render.mjs computes these
// per-frame crops once in Node, timeline.ts derives every declared field
// (crop, master_t, hold_in/hold_out) from them, and Promo.tsx only draws
// them. The declared timeline and the rendered pixels therefore cannot
// disagree (the same split cardTimeline.ts uses for the popup card).
//
// Moves, from video/shots.json camera.move and master.motion.pushes:
// - "hold": one crop for the whole beat, on the focus at the beat's middle;
//   when the focus pet moves out of that crop during the hold, the crop is
//   centred on the pet's whole span across the beat instead (if it fits).
//   Consecutive holds on the same focus and zoom share the previous crop
//   while it still contains the focus pets, so a hold never jitters by a
//   few px at a beat boundary. When the next hold re-centres instead, a
//   push into it (hold_until, push_then_hold) lands on the next hold's crop
//   if that loses none of the focus boxes the push's own crop framed.
// - "Hold 1.0x ... until <anchor>, then push": 1.0x until anchor+videoLagMs,
//   then a 450 ms ease-out-expo push (3000 ms ease-in-out when the text says
//   "easing in and out", the night push) to the beat's resting 2.0x crop.
// - "the push ends at <anchor>, then hold": when the previous beat's push
//   is still running at this beat's start (b5's night push into b6), that
//   push continues onto this beat's resting crop; otherwise a 450 ms push
//   that ends at anchor+videoLagMs. Then a hold. Any other beat after an
//   unfinished push starts on its own crop (a hard cut).
// - "At <anchor>, push from 1.0x to 2.0x over N ms ..., then follow": 1.0x,
//   then an eased push onto the live follow crop, then the follow.
// - "follow": the floor-anchored crop on the focus, 400 ms smoothed, every frame.
// Camera moves are shifted by the shot's videoLagMs (the recording shows an
// event about that long after the log); beat bounds are not.

import type { Events, Rect } from '../schema';
import { easedFloorAnchoredCrop, floorAnchoredCrop, type PushEasing, type StageConfig } from './camera';
import { classifyMove, resolveAnyAnchor, resolveFocusX, type ShotBeat } from './timeline';

export const SHORT_PUSH_MS = 450;
export const NIGHT_PUSH_MS = 3000;
/** cameraPath's own containment margin for sharing a hold crop: the eval's CONTAIN_MARGIN (16 stage px). */
const SHARE_MARGIN_STAGE_PX = 16;

export interface CameraBeatSpan {
  beat: ShotBeat;
  /** demo.mp4 ms (trimBeforeMs included) of the beat's bounds. */
  sourceIn: number;
  sourceOut: number;
  /** master frame indices [k0, k1). */
  k0: number;
  k1: number;
}

export interface ShotCameraInput {
  spans: readonly CameraBeatSpan[];
  events: Events;
  stage: StageConfig;
  /** master ms = demo ms + shiftMs, for every frame of this shot (a whole number of frames). */
  shiftMs: number;
  fps: number;
  noZoom?: boolean;
}

interface Push {
  startMs: number;
  endMs: number;
  easing: PushEasing;
  to: Rect;
}

const fullStage = (stage: StageConfig): Rect => ({ x: 0, y: 0, w: stage.width, h: stage.height });

/** Logged-clock ms the recording shows at demo time `demoMs` (the recording lags the log by videoLagMs). */
export function loggedMsAt(events: Events, demoMs: number): number {
  return demoMs - events.trimBeforeMs - events.videoLagMs;
}

/** The demo time at which the recording shows logged-clock ms `loggedMs`: loggedMsAt's inverse. */
export function demoMsShowing(events: Events, loggedMs: number): number {
  return loggedMs + events.trimBeforeMs + events.videoLagMs;
}

/** The pets a focus string names (pet:<id>, between:<a>,<b>, catch_point -> the catching pet). */
export function focusPets(focus: string, events: Events): string[] {
  if (focus.startsWith('pet:')) return [focus.slice(4)];
  if (focus.startsWith('between:')) return focus.slice(8).split(',');
  if (focus === 'catch_point') {
    const c = events.observed.find((o) => o.kind === 'catch');
    return c?.pet ? [c.pet] : [];
  }
  return [];
}

/**
 * A pet's box in STAGE px at logged time `loggedMs`: the nearest track
 * frame's box, or (no tracks, as in the fixture) the nearest click rect on
 * that pet. CSS -> native (x2) -> stage (plus the chrome above the page, stage.pageY).
 * Mirrors verify.mjs's petBoxStage.
 */
export function petBoxStage(events: Events, petId: string, loggedMs: number, stage: StageConfig): Rect | null {
  let box: Rect | null = null;
  let best = Infinity;
  for (const f of events.tracks ?? []) {
    const d = Math.abs(f.t - loggedMs);
    if (d < best) {
      const p = f.pets?.find((q) => q.id === petId);
      best = d;
      box = p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null;
    }
  }
  if (!box) {
    const clicks = events.clicks.filter((c) => c.pet === petId && c.rect).sort((a, b) => Math.abs(a.tMs - loggedMs) - Math.abs(b.tMs - loggedMs));
    if (clicks[0]) box = clicks[0].rect;
  }
  return box ? { x: box.x * 2, y: stage.pageY + box.y * 2, w: box.w * 2, h: box.h * 2 } : null;
}

/** Every visible pet's box in stage px at logged time (tracks, else the click rects of the roster's visible pets). */
export function visiblePetBoxesStage(events: Events, loggedMs: number, stage: StageConfig): { id: string; box: Rect }[] {
  const ids = new Set<string>();
  for (const r of events.roster) if (!r.hidden) ids.add(r.id);
  const out: { id: string; box: Rect }[] = [];
  for (const id of ids) {
    const box = petBoxStage(events, id, loggedMs, stage);
    if (box) out.push({ id, box });
  }
  return out;
}

/**
 * Whether `box` lies inside `crop` with `m` stage px to spare on every crop edge that is not the page's own
 * edge (the same exemption as checks.ts checkCropPetMargin): the pets stand on the stage bottom, which every
 * crop shares, so no margin is asked for below them.
 */
const contains = (crop: Rect, box: Rect, m: number, page: Rect): boolean =>
  box.x >= crop.x + (crop.x <= page.x ? 0 : m) &&
  box.y >= crop.y + (crop.y <= page.y ? 0 : m) &&
  box.x + box.w <= crop.x + crop.w - (crop.x + crop.w >= page.x + page.w ? 0 : m) &&
  box.y + box.h <= crop.y + crop.h - (crop.y + crop.h >= page.y + page.h ? 0 : m);

/**
 * The crop on every master frame of every beat of one shot (page shots
 * only), indexed [beat][k - k0].
 */
export function shotFrameCrops(input: ShotCameraInput): Rect[][] {
  const { spans, events, stage, shiftMs, fps, noZoom } = input;
  const frameMs = 1000 / fps;
  const lag = events.videoLagMs;
  const full = fullStage(stage);
  const demoAt = (k: number) => k * frameMs - shiftMs;
  const zoomOf = (b: ShotBeat) => (noZoom ? 1 : b.camera.zoom);
  const cropAtFocus = (b: ShotBeat, loggedMs: number): Rect =>
    zoomOf(b) === 1 ? full : floorAnchoredCrop(stage, zoomOf(b), resolveFocusX(b.camera.focus, stage, events, loggedMs));
  const anchor = (spec: string, s: CameraBeatSpan) => resolveAnyAnchor(spec, { events, beatInMs: s.sourceIn });

  /** The focus pets' boxes on every master frame of a beat (stage px), or on those showing demo ms >= fromMs. */
  const focusBoxesOver = (s: CameraBeatSpan, fromMs = -Infinity): Rect[] => {
    const ids = focusPets(s.beat.camera.focus, events);
    const boxes: Rect[] = [];
    for (let k = s.k0; k < s.k1; k++) {
      if (demoAt(k) < fromMs) continue;
      for (const id of ids) {
        const b = petBoxStage(events, id, loggedMsAt(events, demoAt(k)), stage);
        if (b) boxes.push(b);
      }
    }
    return boxes;
  };
  const framesFocus = (crop: Rect, boxes: readonly Rect[]) => boxes.every((b) => contains(crop, b, SHARE_MARGIN_STAGE_PX, full));

  // Pass 1: each beat's resting crop (where it holds), sharing the previous beat's when it still frames the focus.
  const rest: (Rect | null)[] = [];
  spans.forEach((s, i) => {
    const kind = classifyMove(s.beat.camera.move).kind;
    if (kind === 'push_then_follow' || kind === 'continuous') {
      rest.push(null);
      return;
    }
    // hold_until rests after its push, so frame the focus near the beat's end; others at the middle.
    const at = kind === 'hold_until' ? s.sourceOut - frameMs : (s.sourceIn + s.sourceOut) / 2;
    let own = cropAtFocus(s.beat, loggedMsAt(events, at));
    // A held crop frames the focus pets on EVERY frame of the beat, not only at its middle: when the pet moves
    // during the hold (out of the crop computed at the middle), centre the crop on its whole span if that fits.
    const held = kind === 'hold' || kind === 'push_then_hold';
    const boxes = held && zoomOf(s.beat) !== 1 ? focusBoxesOver(s) : [];
    if (boxes.length && !framesFocus(own, boxes)) {
      const left = Math.min(...boxes.map((b) => b.x));
      const right = Math.max(...boxes.map((b) => b.x + b.w));
      const span = floorAnchoredCrop(stage, zoomOf(s.beat), (left + right) / 2);
      if (framesFocus(span, boxes)) own = span;
    }
    const prev = i > 0 ? rest[i - 1] : null;
    const pb = i > 0 ? spans[i - 1].beat : null;
    if (prev && pb && zoomOf(pb) === zoomOf(s.beat) && pb.camera.focus === s.beat.camera.focus) {
      const mid = loggedMsAt(events, (s.sourceIn + s.sourceOut) / 2);
      const midBoxes = focusPets(s.beat.camera.focus, events).map((p) => petBoxStage(events, p, mid, stage));
      if (midBoxes.every((b) => b && contains(prev, b, SHARE_MARGIN_STAGE_PX, full)) && framesFocus(prev, boxes)) {
        rest.push(prev);
        return;
      }
    }
    rest.push(own);
  });

  // Pass 1b: a push that lands on its own crop and then cuts to the next same-focus hold, re-centred a few px
  // away, jitters at the cut (b4a_hi -> b4b_too: 762 -> 758 stage px). Push straight to the next hold's crop
  // instead, when that crop frames every focus box this beat's own crop frames from the push on (so no pet
  // the camera held is lost), and this beat's crop is not already shared with the beat before it.
  spans.forEach((s, i) => {
    const move = classifyMove(s.beat.camera.move);
    const n = spans[i + 1];
    const own = rest[i];
    const next = i + 1 < rest.length ? rest[i + 1] : null;
    if (noZoom || !n || !own || !next || own === next || (i > 0 && rest[i - 1] === own)) return;
    if (move.kind !== 'hold_until' && move.kind !== 'push_then_hold') return;
    if (classifyMove(n.beat.camera.move).kind !== 'hold' || zoomOf(n.beat) === 1 || zoomOf(n.beat) !== zoomOf(s.beat) || n.beat.camera.focus !== s.beat.camera.focus) return;
    const pushFrom = anchor(move.kind === 'hold_until' ? move.untilAnchor! : move.pushEndAnchor!, s) + lag;
    const held = focusBoxesOver(s, pushFrom).filter((b) => contains(own, b, SHARE_MARGIN_STAGE_PX, full));
    if (held.every((b) => contains(next, b, SHARE_MARGIN_STAGE_PX, full))) rest[i] = next;
  });

  // Pass 2: every frame.
  let carried: Push | null = null;
  const eased = (p: Push, demoMs: number): Rect =>
    easedFloorAnchoredCrop(stage, 1, stage.width / 2, stage.width / p.to.w, p.to.x + p.to.w / 2, p.startMs, p.endMs, demoMs, p.easing);
  const ballLeavesPush = (p: Push, s: CameraBeatSpan): boolean => {
    let from: number;
    let to: number;
    try {
      from = anchor('ball_in_frame', s);
      to = anchor('catch', s);
    } catch {
      return false; // no dblclick or catch logged: nothing to fall back from
    }
    for (const f of events.tracks ?? []) {
      if (!f.ball) continue;
      const d = f.t + events.trimBeforeMs + lag; // the demo time the recording shows this ball sample
      if (d < from || d > to) continue;
      const crop = d < p.startMs ? full : d < p.endMs ? eased(p, d) : p.to;
      const bx = f.ball.x * 2;
      const by = stage.pageY + f.ball.y * 2;
      if (bx < crop.x || bx > crop.x + crop.w || by < crop.y || by > crop.y + crop.h) return true;
    }
    return false;
  };

  return spans.map((s, i) => {
    const move = classifyMove(s.beat.camera.move);
    const frames: Rect[] = [];
    const restCrop = rest[i] ?? full;
    let push: Push | null = null;
    if (!noZoom && move.kind === 'hold_until' && zoomOf(s.beat) !== 1) {
      const slow = /easing in and out/i.test(s.beat.camera.move);
      const start = anchor(move.untilAnchor!, s) + lag;
      push = { startMs: start, endMs: start + (slow ? NIGHT_PUSH_MS : SHORT_PUSH_MS), easing: slow ? 'ease-in-out' : 'ease-out-expo', to: restCrop };
      // conventions.camera.checks: if the ball leaves the fetch push's crop between ball_in_frame and the
      // catch, hold 1.0x and hard-cut to 2.0x on the catch frame instead.
      if (s.beat.camera.focus === 'catch_point' && ballLeavesPush(push, s)) {
        const cut = anchor('catch', s) + lag;
        push = { ...push, startMs: cut, endMs: cut };
      }
    }
    if (!noZoom && move.kind === 'push_then_hold' && !(carried && carried.endMs > s.sourceIn)) {
      const end = anchor(move.pushEndAnchor!, s) + lag;
      carried = { startMs: end - SHORT_PUSH_MS, endMs: end, easing: 'ease-out-expo', to: restCrop };
    }
    for (let k = s.k0; k < s.k1; k++) {
      const d = demoAt(k);
      if (noZoom) {
        frames.push(full);
      } else if (move.kind === 'hold') {
        frames.push(zoomOf(s.beat) === 1 ? full : restCrop);
      } else if (move.kind === 'hold_until') {
        frames.push(!push ? full : d < push.startMs ? full : d < push.endMs ? eased(push, d) : push.to);
      } else if (move.kind === 'push_then_hold') {
        frames.push(carried && d < carried.endMs ? (d < carried.startMs ? full : eased({ ...carried, to: restCrop }, d)) : restCrop);
      } else {
        const live = cropAtFocus(s.beat, loggedMsAt(events, d));
        if (move.kind === 'push_then_follow') {
          const start = Math.max(anchor(move.pushStartAnchor!, s) + lag, s.sourceIn);
          const end = start + (move.pushDurationMs ?? SHORT_PUSH_MS);
          frames.push(d < start ? full : d < end ? eased({ startMs: start, endMs: end, easing: 'ease-out-expo', to: live }, d) : live);
        } else {
          frames.push(live);
        }
      }
    }
    if (push) carried = push;
    return frames;
  });
}

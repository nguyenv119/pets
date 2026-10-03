// plan.ts: everything a Promo composition draws, computed once in Node
// (epic pets-o3p, bead pets-o3p.4). Pure. render.mjs builds this plan,
// runs renderChecks.ts over it, writes timeline.json from the same edit,
// and hands the plan to Remotion as inputProps. Promo.tsx does no anchor
// resolution or geometry of its own.

import type { ClickEvent, CursorSample, Events, Rect, TimelineCardFrame } from '../schema';
import { buildMusicPlan, buildSfx, type MusicPlan, type SfxCue } from './audioPlan';
import type { StageConfig } from './camera';
import { buildOverlays, type Aspect, type TextItem } from './overlays';
import type { EditTimeline, ShotsDoc } from './timeline';

export interface CursorData {
  track: CursorSample[];
  clicks: ClickEvent[];
  /** cursor positions are on the LOGGED clock: demo ms - trimBeforeMs - videoLagMs */
  trimBeforeMs: number;
  videoLagMs: number;
}

export interface PlanBeat {
  name: string;
  k0: number;
  k1: number;
  /** source frame shown on master frame k = k - shiftFrames */
  shiftFrames: number;
  /** public-dir path of the shot's staged demo.mp4 */
  stagedSrc: string;
  frameCrops?: Rect[];
  card?: { frames: TimelineCardFrame[]; envelopes: Rect[] };
  cursor: CursorData;
}

export interface PromoPlan {
  beats: PlanBeat[];
  items: TextItem[];
  stage: StageConfig;
  totalFrames: number;
  music: MusicPlan;
  sfx: SfxCue[];
  iconPath: string;
  aspect: Aspect;
}

/** Popup-take clicks the card shows a ring for (the Add Pet press rings on the mousedown). */
const POPUP_CLICKS = ['shelter_click', 'name_click', 'type_selected', 'color_selected', 'add_mousedown'];
const GLIDE_MS = 300;

/**
 * The popup take's cursor. A take that logs its own cursorTrack uses it;
 * otherwise (the synthetic stand-in) the path is rebuilt from the logged
 * click points only: it starts at s2b_shelter.cursor_start (x from the
 * spec; y "the middle of the Bao row", the second of the list's two rows)
 * and eases into each logged click point over the 300 ms before it, so
 * the tip is on the card at every click.
 */
export function popupCursor(events: Events, startX: number): CursorData {
  const base = { trimBeforeMs: events.trimBeforeMs, videoLagMs: events.videoLagMs };
  if (events.cursorTrack.length) return { ...base, track: events.cursorTrack, clicks: events.clicks };
  const clicksObs = events.observed.filter((o) => POPUP_CLICKS.includes(o.kind) && Number.isFinite(o.x) && Number.isFinite(o.y));
  const ready = events.observed.find((o) => o.kind === 'popup_ready')?.t ?? 0;
  const list = events.tracks?.find((f) => f.els?.pets_list)?.els?.pets_list;
  let pos = { x: startX, y: list ? list.y + list.h * 0.75 : 300 };
  const track: CursorSample[] = [{ t: ready, ...pos }];
  const ease = (u: number) => 1 - Math.pow(1 - u, 3);
  for (const o of clicksObs) {
    const end = { x: o.x!, y: o.y! };
    const start = Math.max(track[track.length - 1].t, o.t - GLIDE_MS);
    for (let t = start; t <= o.t; t += 20) {
      const u = ease((t - start) / Math.max(1, o.t - start));
      track.push({ t, x: pos.x + (end.x - pos.x) * u, y: pos.y + (end.y - pos.y) * u });
    }
    track.push({ t: o.t, ...end });
    pos = end;
  }
  const clicks: ClickEvent[] = clicksObs.map((o) => ({ label: o.kind, kind: 'click', tMs: o.t, tDepartMs: o.t - GLIDE_MS, tDownMs: o.t, x: o.x!, y: o.y!, rect: { x: o.x!, y: o.y!, w: 0, h: 0 } }));
  return { ...base, track, clicks };
}

export interface PlanInput {
  edit: EditTimeline;
  shots: ShotsDoc;
  eventsByShotId: Record<string, Events>;
  stagedByShotId: Record<string, string>;
  stage: StageConfig;
  aspect: Aspect;
  outputWidth: number;
  outputHeight: number;
  musicSrc: string;
  iconPath: string;
  noCaptions?: boolean;
}

export function buildPromoPlan(input: PlanInput): PromoPlan {
  const { edit, shots, eventsByShotId, stagedByShotId, stage, aspect } = input;
  const frameMs = 1000 / edit.fps;
  const beats: PlanBeat[] = edit.beats
    .filter((b) => b.k1 > b.k0)
    .map((b) => {
      const ev = eventsByShotId[b.shotId];
      let cursor: CursorData = { track: ev.cursorTrack, clicks: ev.clicks, trimBeforeMs: ev.trimBeforeMs, videoLagMs: ev.videoLagMs };
      if (b.card) {
        const start = shots.shots.find((s) => s.id === b.shotId)?.cursor_start;
        if (!start) throw new Error(`plan: card shot ${b.shotId} declares no cursor_start`);
        cursor = popupCursor(ev, start.x);
      }
      return {
        name: b.name,
        k0: b.k0,
        k1: b.k1,
        shiftFrames: Math.round(b.shiftMs / frameMs),
        stagedSrc: stagedByShotId[b.shotId],
        frameCrops: b.frameCrops,
        card: b.card && b.cardEnvelopes ? { frames: b.card.frames, envelopes: b.cardEnvelopes } : undefined,
        cursor,
      };
    });
  const items = buildOverlays({ edit, shots, eventsByShotId, stage, aspect, outputWidth: input.outputWidth, outputHeight: input.outputHeight, noCaptions: input.noCaptions });
  return {
    beats,
    items,
    stage,
    totalFrames: edit.totalFrames,
    music: buildMusicPlan(edit, eventsByShotId, input.musicSrc),
    sfx: buildSfx(edit, shots, eventsByShotId),
    iconPath: input.iconPath,
    aspect,
  };
}

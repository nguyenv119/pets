// renderChecks.ts: the render-failing checks, run on every master frame of
// the planned edit before Remotion draws a pixel (epic pets-o3p, bead
// pets-o3p.4). Pure. render.mjs aborts on any violation, naming the frame
// and the element. Every number comes from CHECK_THRESHOLDS (checks.ts).
//
// The plan IS what Promo.tsx draws (per-frame crops, card frames, text
// rects), so checking the plan checks the render.

import type { Events, Rect } from '../schema';
import {
  CHECK_THRESHOLDS,
  checkCardCaptionGap,
  checkCardEndsAfterMousedown,
  checkCardFrameContent,
  checkCardSteadyAnchor,
  checkCropPetMargin,
  checkInsideRect,
  checkOverlayPetDistance,
  checkUniformContentScale,
  rectsIntersect,
  type CheckViolation,
} from './checks';
import { cropRule, nearestTrack } from './cardCrop';
import type { StageConfig } from './camera';
import { framePets } from './framePets';
import type { TextItem } from './overlays';
import type { EditTimeline, ShotsDoc } from './timeline';

export interface FrameViolation extends CheckViolation {
  /** master frame index */
  frame: number;
  /** the beat and the element that failed */
  element: string;
}

export interface RenderCheckInput {
  edit: EditTimeline;
  shots: ShotsDoc;
  eventsByShotId: Record<string, Events>;
  stage: StageConfig;
  aspect: '16x9' | '9x16';
  outputWidth: number;
  items: readonly TextItem[];
}

const CARD_TRANSITION_MS = { first: 200, morph: 160 };

export function runRenderChecks(input: RenderCheckInput): FrameViolation[] {
  const { edit, shots, eventsByShotId, stage, aspect, outputWidth, items } = input;
  const out: FrameViolation[] = [];
  const frameMs = 1000 / edit.fps;
  const page: Rect = { x: 0, y: 0, w: stage.width, h: stage.height };
  const add = (frame: number, element: string, vs: CheckViolation[]) => vs.forEach((v) => out.push({ ...v, frame, element }));

  // 1. Page frames: no crop edge within the margin of (or through) a visible pet box, unless it is the page edge.
  for (const b of edit.beats) {
    if (!b.frameCrops) continue;
    const events = eventsByShotId[b.shotId];
    for (let k = b.k0; k < b.k1; k++) {
      const crop = b.frameCrops[k - b.k0];
      const logged = k * frameMs - b.shiftMs - events.trimBeforeMs - events.videoLagMs;
      const boxes: Rect[] = [];
      for (const f of [nearestTrack(events.tracks, logged)]) for (const p of f?.pets ?? []) boxes.push({ x: p.x * 2, y: p.y * 2 - stage.pageTopNative, w: p.w * 2, h: p.h * 2 });
      add(k, `${b.name} camera crop`, checkCropPetMargin(crop, boxes, page));
    }
  }

  // 2. Text layers: 80 output px from every pet box, never inside an emitting pet's particle column.
  for (const it of items) {
    if (it.layoutProblem) add(it.fromFrame, `${it.beat} ${it.kind}`, [{ check: 'overlay-layout', detail: it.layoutProblem }]);
    for (let k = it.fromFrame; k < it.toFrame; k++) {
      const v = framePets(edit, eventsByShotId, stage, outputWidth, k);
      if (!v) continue;
      const el = `${it.beat} ${it.kind}`;
      add(k, el, checkOverlayPetDistance(it.rect, v.pets.map((p) => p.box)));
      for (const p of v.pets) {
        if (p.column && rectsIntersect(it.rect, p.column)) add(k, el, [{ check: 'particle-column-overlap', detail: `inside ${p.id}'s particle column` }]);
      }
    }
  }

  // 3. Popup card frames.
  const placement = (shots as { overlays?: { popup_card?: { placement?: Record<string, { caption_rect: Rect }> } } }).overlays?.popup_card?.placement?.[aspect];
  const cardCaptions = items.filter((i) => i.kind === 'card_caption');
  let firstCard = true;
  for (const b of edit.beats) {
    if (!b.card || !b.cardEnvelopes) continue;
    const shot = shots.shots.find((s) => s.id === b.shotId)!;
    const events = eventsByShotId[b.shotId];
    const forbidden = shot.layout_expect?.forbidden_types ?? [];
    const vw = shot.viewport!.width;
    const transition = firstCard ? CARD_TRANSITION_MS.first : CARD_TRANSITION_MS.morph;
    firstCard = false;
    const steadyAt = b.card.at;
    const dn = events.observed.find((o) => o.kind === 'add_mousedown');
    b.card.frames.forEach((f, i) => {
      const k = b.k0 + i;
      const el = `${b.name} card`;
      const tr = nearestTrack(events.tracks, k * frameMs - b.shiftMs - 1 - events.trimBeforeMs);
      const cells = (tr?.cells ?? []).filter((c) => forbidden.includes(c.type)).map((c) => ({ type: c.type, rect: { x: c.x * 2, y: c.y * 2, w: c.w * 2, h: c.h * 2 } }));
      const missing = forbidden.filter((t) => !(tr?.cells ?? []).some((c) => c.type === t));
      if (missing.length) add(k, el, [{ check: 'card-forbidden-cell', detail: `forbidden cells not logged on this frame: ${missing.join(', ')}` }]);
      const content = { x: f.at.x, y: f.at.y, w: f.w, h: f.h };
      add(k, el, checkCardFrameContent(f.rect, cropRule(b.card!.crop, tr, vw), cells, content, b.cardEnvelopes![i]));
      add(k, el, checkUniformContentScale(f.rect, f));
      if (i * frameMs >= transition) {
        add(k, el, checkCardSteadyAnchor(f.at, steadyAt));
        if (f.w !== f.rect.w * b.card!.scale || f.h !== f.rect.h * b.card!.scale) add(k, el, [{ check: 'card-steady-scale', detail: `steady card ${f.w}x${f.h} is not ${b.card!.scale}x its ${f.rect.w}x${f.rect.h} crop` }]);
      }
      if (b.name === 'b3e_add' && dn) add(k, el, checkCardEndsAfterMousedown(k * frameMs - b.shiftMs - events.trimBeforeMs, dn.t, CHECK_THRESHOLDS));
      for (const c of cardCaptions) {
        if (k < c.fromFrame || k >= c.toFrame) continue;
        add(k, `${c.beat} popup caption`, checkCardCaptionGap(b.cardEnvelopes![i], c.rect));
        if (placement) add(k, `${c.beat} popup caption`, checkInsideRect(c.rect, placement.caption_rect, 'the popup caption'));
      }
    });
  }
  return out;
}

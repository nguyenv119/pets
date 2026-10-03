// renderChecks.ts: the render-failing checks, run on every master frame of
// the planned edit (and every README GIF frame) before Remotion draws a
// pixel (epic pets-o3p, bead pets-o3p.4). Pure. render.mjs aborts on ANY
// violation, in every mode (--run, --synthetic, --fixture) and every
// variant, naming the frame and the element. Every number comes from
// CHECK_THRESHOLDS (checks.ts).
//
// The plan IS what Promo.tsx and PromoGif.tsx draw (per-frame crops, card
// frames, text rects), so checking the plan checks the render.

import type { Events, Rect } from '../schema';
import {
  checkCardCaptionGap,
  checkCardEndsAfterMousedown,
  checkCardFrameContent,
  checkCardSteadyAnchor,
  checkCropPetMargin,
  checkInsideRect,
  checkOverlayPetDistance,
  checkParticleColumnOverlap,
  checkSteadyAtOnAnchor,
  checkUniformContentScale,
  type CheckViolation,
} from './checks';
import { cropRule, nearestTrack } from './cardCrop';
import { trackMsForFrame } from './cardTimeline';
import { loggedMsAt, visiblePetBoxesStage } from './cameraPath';
import type { StageConfig } from './camera';
import { framePets, petsInOutput, type FramePet } from './framePets';
import type { GifScene } from './gifScenes';
import type { TextItem } from './overlays';
import type { EditTimeline, ShotsDoc } from './timeline';

export interface FrameViolation extends CheckViolation {
  /** master frame index (GIF frame index for runGifChecks) */
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

/** A text layer's rect against the pets on one frame: 80 output px from every box, outside every emitting pet's particle column. */
function textClearOfPets(rect: Rect, pets: readonly FramePet[], unitsPerCss: number): CheckViolation[] {
  return [
    ...checkOverlayPetDistance(rect, pets.map((p) => p.box)),
    ...checkParticleColumnOverlap(
      rect,
      pets.filter((p) => p.column).map((p) => p.box),
      unitsPerCss,
    ),
  ];
}

export function runRenderChecks(input: RenderCheckInput): FrameViolation[] {
  const { edit, shots, eventsByShotId, stage, aspect, outputWidth, items } = input;
  const out: FrameViolation[] = [];
  const frameMs = 1000 / edit.fps;
  const page: Rect = { x: 0, y: 0, w: stage.width, h: stage.height };
  const add = (frame: number, element: string, vs: CheckViolation[]) => vs.forEach((v) => out.push({ ...v, frame, element }));

  // 1. Page frames: no crop edge within the margin of (or through) a visible pet box, unless it is the page edge.
  //    The same boxes the camera frames: tracks, else the click rects of the roster's visible pets (the fixture).
  for (const b of edit.beats) {
    if (!b.frameCrops) continue;
    const events = eventsByShotId[b.shotId];
    for (let k = b.k0; k < b.k1; k++) {
      const boxes = visiblePetBoxesStage(events, loggedMsAt(events, k * frameMs - b.shiftMs), stage).map((p) => p.box);
      add(k, `${b.name} camera crop`, checkCropPetMargin(b.frameCrops[k - b.k0], boxes, page));
    }
  }

  // 2. Text layers: 80 output px from every pet box, never inside an emitting pet's particle column.
  for (const it of items) {
    if (it.layoutProblem) add(it.fromFrame, `${it.beat} ${it.kind}`, [{ check: 'overlay-layout', detail: it.layoutProblem }]);
    for (let k = it.fromFrame; k < it.toFrame; k++) {
      const v = framePets(edit, eventsByShotId, stage, outputWidth, k);
      if (v) add(k, `${it.beat} ${it.kind}`, textClearOfPets(it.rect, v.pets, v.unitsPerCss));
    }
  }

  // 3. Popup card frames.
  const placement = shots.overlays?.popup_card?.placement?.[aspect];
  const cardCaptions = items.filter((i) => i.kind === 'card_caption');
  for (const b of edit.beats) {
    if (!b.card || !b.cardEnvelopes) continue;
    const card = b.card;
    const envelopes = b.cardEnvelopes;
    if (!b.cardTransition) throw new Error(`runRenderChecks: card beat ${b.name} declares no cardTransition`);
    const transitionMs = b.cardTransition.ms;
    const shot = shots.shots.find((s) => s.id === b.shotId);
    if (!shot?.viewport) throw new Error(`runRenderChecks: card shot ${b.shotId} declares no viewport`);
    const vw = shot.viewport.width;
    const events = eventsByShotId[b.shotId];
    const forbidden = shot.layout_expect?.forbidden_types ?? [];
    const dn = events.observed.find((o) => o.kind === 'add_mousedown');
    if (placement) add(b.k0, `${b.name} card steady_at`, checkSteadyAtOnAnchor(card.at, { w: card.rect.w * card.scale, h: card.rect.h * card.scale }, placement.anchor));
    card.frames.forEach((f, i) => {
      const k = b.k0 + i;
      const el = `${b.name} card`;
      const tr = nearestTrack(events.tracks, trackMsForFrame(events, k, frameMs, b.shiftMs));
      const cells = (tr?.cells ?? []).filter((c) => forbidden.includes(c.type)).map((c) => ({ type: c.type, rect: { x: c.x * 2, y: c.y * 2, w: c.w * 2, h: c.h * 2 } }));
      const missing = forbidden.filter((t) => !(tr?.cells ?? []).some((c) => c.type === t));
      if (missing.length) add(k, el, [{ check: 'card-forbidden-cell', detail: `forbidden cells not logged on this frame: ${missing.join(', ')}` }]);
      const content = { x: f.at.x, y: f.at.y, w: f.w, h: f.h };
      add(k, el, checkCardFrameContent(f.rect, cropRule(card.crop, tr, vw), cells, content, envelopes[i]));
      add(k, el, checkUniformContentScale(f.rect, f));
      if (i * frameMs >= transitionMs) {
        add(k, el, checkCardSteadyAnchor(f.at, card.at));
        if (f.w !== f.rect.w * card.scale || f.h !== f.rect.h * card.scale) add(k, el, [{ check: 'card-steady-scale', detail: `steady card ${f.w}x${f.h} is not ${card.scale}x its ${f.rect.w}x${f.rect.h} crop` }]);
      }
      if (b.name === 'b3e_add' && dn) add(k, el, checkCardEndsAfterMousedown(k * frameMs - b.shiftMs - events.trimBeforeMs, dn.t));
      for (const c of cardCaptions) {
        if (k < c.fromFrame || k >= c.toFrame) continue;
        add(k, `${c.beat} popup caption`, checkCardCaptionGap(envelopes[i], c.rect));
        if (placement) add(k, `${c.beat} popup caption`, checkInsideRect(c.rect, placement.caption_rect, 'the popup caption'));
      }
    });
  }
  return out;
}

/** The 16:9 capture as the GIF reads it: native px, nothing hidden above the band. */
const GIF_SOURCE_STAGE: StageConfig = { width: 1920, height: 1080, floorLine: 1080, pageTopNative: 0 };

/**
 * The README GIF's text checks (variants.readme_gif): on every GIF frame
 * that shows a caption, the caption stays 80 output px from every pet box
 * and outside every emitting pet's particle column. The GIF is no-zoom:
 * frame px = the native capture's px inside the CSS crop band.
 */
export function runGifChecks(scenes: readonly GifScene[], eventsByShotId: Record<string, Events>, fps: number, outputWidth: number): FrameViolation[] {
  const out: FrameViolation[] = [];
  const frameMs = 1000 / fps;
  for (const sc of scenes) {
    const events = eventsByShotId[sc.shotId];
    const band: Rect = { x: sc.cropCss.x * 2, y: sc.cropCss.y * 2, w: sc.cropCss.w * 2, h: sc.cropCss.h * 2 };
    const s = outputWidth / band.w;
    for (const c of sc.captions) {
      for (let f = c.fromFrame; f < c.toFrame; f++) {
        const logged = loggedMsAt(events, sc.sourceInMs + (f - sc.fromFrame) * frameMs);
        const pets = petsInOutput(events, logged, GIF_SOURCE_STAGE, band, s);
        for (const v of textClearOfPets(c.rect, pets, 2 * s)) out.push({ ...v, frame: f, element: `gif ${sc.shotId} caption "${c.lines.join(' ')}"` });
      }
    }
  }
  return out;
}

// cardTimeline.ts: builds the popup-card TimelineCard (steady rect/scale/
// anchor plus `frames[]` for EVERY master frame of a card beat) — epic
// pets-o3p, bead pets-o3p.4, implementation step 2's card-timeline half.
//
// Single source of truth for card geometry: this module computes the
// declared frames once (at build time, in Node via render.mjs), and
// PopupCard.tsx (render time) does nothing but look up and draw the frame
// the current output frame index selects. That keeps the declared
// `timeline.json` and the rendered pixels from ever disagreeing — the
// alternative (two independent implementations of the same geometry, one
// in Node and one in React) is exactly the kind of drift verify.mjs's
// per-frame crop-rule/aspect/pixel checks are built to catch.
//
// Motion per video/shots.json overlays.popup_card:
// - pop-in (b3c_shelter, no previous card beat): "a scale spring from 0.94
//   to 1.0 and y +24 px to 0 over 200 ms, at FULL opacity" — the crop never
//   changes during a pop-in, only the output box's size and y offset.
// - morph (b3d_pick, b3e_add, following another card beat): "the frame
//   morphs to the next crop's output size... over 160 ms about the same
//   placement anchor; the content hard-cuts to the next crop at the morph
//   start and is that crop scaled UNIFORMLY... the largest that fits inside
//   the frame's current size... centred". Implemented as: the content
//   hard-cuts to the new crop at u=0; an envelope box interpolates
//   linearly (eased) from the previous crop's steady output size to this
//   crop's steady output size; the new crop is scaled by the single
//   largest factor that fits inside that envelope (uniform, so
//   w/rect.w === h/rect.h exactly before rounding); the box is centred on
//   the linear (eased) interpolation between the previous and next steady
//   anchors' centres, so both size and position land exactly on the next
//   steady_at by the time the envelope reaches the steady size. The
//   envelope itself (the card's visible frame: cream, corner mask, shadow)
//   is returned alongside for the renderer; it never enters timeline.json.
// - after the transition window: EXACTLY the steady crop/size/anchor,
//   recomputed per frame from that frame's own logged DOMRects (never
//   frozen to the transition's ending values), per shots.json "Rects are
//   computed per frame... never hard-coded".

import type { CardCropName, Events, Rect, TimelineCard, TimelineCardFrame } from '../schema';
import { cropRule, nearestTrack } from './cardCrop';

/** Ease-out-cubic: fast start, gentle settle, never overshooting (an overshoot would show the content past its steady size). */
function easeOutCubic(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return 1 - Math.pow(1 - t, 3);
}

export interface CardSteadySize {
  at: { x: number; y: number };
  w: number;
  h: number;
}

export interface CardBeatInput {
  cropName: CardCropName;
  /** card_scale_native for this crop (1 for A/C, 2 for B). */
  scale: 1 | 2;
  steadyAt: { x: number; y: number };
  /** CSS px width of the popup's own capture viewport (500): cropRule's `vw`. */
  viewportWidthCss: number;
  events: Events;
  fps: number;
  /** The beat's master frames [k0, k1). */
  k0: number;
  k1: number;
  /** master ms = demo.mp4 ms + shiftMs for this shot (a whole number of frames). */
  shiftMs: number;
  /** 200 for a pop-in (no previous card beat), 160 for a morph (following one). */
  transitionMs: number;
  /** The previous card beat's own steady box, for a morph. Undefined for a pop-in. */
  prevSteady?: CardSteadySize;
}

export interface CardBeatTimeline {
  /** frames[].t in master MS (timeline.ts converts the whole timeline to seconds when it writes timeline.json). */
  card: TimelineCard;
  /** The card's visible frame per master frame (equal to the content box except mid-morph). Render-only. */
  envelopes: Rect[];
  /** The master frame master_t samples: the middle of the steady (post-transition) frames. */
  sampleK: number;
}

/** Every master frame index k with k/fps*1000 in [masterIn, masterOut), matching verify.mjs's frameIdx. */
export function cardBeatFrameIndices(masterIn: number, masterOut: number, fps: number): number[] {
  const ks: number[] = [];
  const frameMs = 1000 / fps;
  // `+ 0` turns the -0 that Math.ceil(-1e-6/frameMs) gives at masterIn 0 into 0.
  let k = Math.ceil(masterIn / frameMs - 1e-6) + 0;
  while (k * frameMs < masterOut - 1e-6) {
    ks.push(k);
    k++;
  }
  return ks;
}

/**
 * The logged-clock ms verify.mjs looks up a card frame's DOMRects at:
 * tMsOf(source_t + (k/fps - master_t) - 0.001), i.e. the frame's demo time
 * minus 1 ms, minus trimBeforeMs. Mirrored exactly so the declared rect is
 * the rect the eval recomputes.
 */
function trackMsForFrame(events: Events, k: number, frameMs: number, shiftMs: number): number {
  return k * frameMs - shiftMs - 1 - events.trimBeforeMs;
}

/**
 * Builds one card beat: a declared frame for every master frame (pop-in
 * or morph included), each frame's rect recomputed from that frame's own
 * logged DOMRects, plus the steady card at the beat's sample frame.
 */
export function buildCardTimeline(input: CardBeatInput): CardBeatTimeline {
  const { cropName, scale, steadyAt, viewportWidthCss, events, fps, k0, k1, shiftMs, transitionMs, prevSteady } = input;
  const frameMs = 1000 / fps;
  const transitionFrames = Math.ceil(transitionMs / frameMs - 1e-9);

  const frames: TimelineCardFrame[] = [];
  const envelopes: Rect[] = [];
  for (let k = k0; k < k1; k++) {
    const elapsedMs = (k - k0) * frameMs;
    const rect = cropRule(cropName, nearestTrack(events.tracks, trackMsForFrame(events, k, frameMs, shiftMs)), viewportWidthCss);
    if (!rect) {
      throw new Error(`buildCardTimeline: no logged cells/els to compute crop "${cropName}" at master frame ${k}; every card-beat frame needs a nearby tracks[] sample`);
    }
    const steadyW = rect.w * scale;
    const steadyH = rect.h * scale;

    let content: Rect;
    let envelope: Rect;
    if (elapsedMs >= transitionMs) {
      content = { x: steadyAt.x, y: steadyAt.y, w: steadyW, h: steadyH };
      envelope = content;
    } else {
      const u = easeOutCubic(elapsedMs / transitionMs);
      const steadyCx = steadyAt.x + steadyW / 2;
      const steadyCy = steadyAt.y + steadyH / 2;
      if (!prevSteady) {
        // Pop-in: this crop throughout, the box scales 0.94 -> 1.0 about its centre and rises 24 px.
        const f = 0.94 + 0.06 * u;
        const w = Math.round(steadyW * f);
        const h = Math.round(steadyH * f);
        content = { x: Math.round(steadyCx - w / 2), y: Math.round(steadyCy - h / 2 + 24 * (1 - u)), w, h };
        envelope = content;
      } else {
        // Morph: the frame eases from the previous steady box to this one; the content hard-cuts to this
        // crop and is scaled by ONE factor, the largest that fits inside the frame, centred in it.
        const envW = Math.round(prevSteady.w + (steadyW - prevSteady.w) * u);
        const envH = Math.round(prevSteady.h + (steadyH - prevSteady.h) * u);
        const cx = prevSteady.at.x + prevSteady.w / 2 + (steadyCx - (prevSteady.at.x + prevSteady.w / 2)) * u;
        const cy = prevSteady.at.y + prevSteady.h / 2 + (steadyCy - (prevSteady.at.y + prevSteady.h / 2)) * u;
        envelope = { x: Math.round(cx - envW / 2), y: Math.round(cy - envH / 2), w: envW, h: envH };
        const fit = Math.min(envW / rect.w, envH / rect.h);
        const w = Math.min(envW, Math.round(rect.w * fit));
        const h = Math.min(envH, Math.round(rect.h * fit));
        content = { x: envelope.x + Math.floor((envW - w) / 2), y: envelope.y + Math.floor((envH - h) / 2), w, h };
      }
    }
    frames.push({ t: k * frameMs, rect, at: { x: content.x, y: content.y }, w: content.w, h: content.h });
    envelopes.push(envelope);
  }

  const steadyK0 = Math.min(k1 - 1, k0 + transitionFrames);
  const sampleK = steadyK0 + Math.floor((k1 - 1 - steadyK0) / 2);
  const steadyRect = cropRule(cropName, nearestTrack(events.tracks, sampleK * frameMs - shiftMs - events.trimBeforeMs), viewportWidthCss);
  if (!steadyRect) {
    throw new Error(`buildCardTimeline: no logged cells/els to compute crop "${cropName}" at its sample frame ${sampleK}`);
  }
  return { card: { crop: cropName, rect: steadyRect, scale, at: { x: steadyAt.x, y: steadyAt.y }, frames }, envelopes, sampleK };
}

/** This beat's own steady box, for the NEXT card beat's morph envelope. */
export function cardSteadyOf(card: TimelineCard): CardSteadySize {
  return { at: card.at, w: card.rect.w * card.scale, h: card.rect.h * card.scale };
}

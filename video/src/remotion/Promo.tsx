// Promo.tsx: the film (epic pets-o3p, bead pets-o3p.4). Draws a
// PromoPlan (plan.ts) and nothing else: each beat's recording at the crop
// the plan names for this master frame under its shot's browser chrome, the popup card frame by frame, the
// cursor, the screen-space text layers and the audio. Every number on
// screen was computed in Node, checked by renderChecks.ts and declared in
// timeline.json before this component ran.
//
// Each beat is one Sequence over its own master frames [k0, k1), so beats
// cut hard on the frame the anchors name (master.motion.cuts: "Hard cuts
// on an action frame only"). Text layers are siblings of the beats, so the
// popup caption can run across b3c-b3e and the brand line into b7.
//
// Motion blur (motionBlur.ts): a page frame inside a camera move renders
// the whole stage through CameraMotionBlur; a held frame blurs only a
// moving cursor; holds, the popup card and every frame the eval samples
// (PlanBeat.sharpFrames) are never blurred.

import React from 'react';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { AudioMap } from './AudioMap';
import { BrandLine, CaptionPill, Clock, Cta, NameTag } from './Captions';
import { Cursor } from './Cursor';
import { PopupCard } from './PopupCard';
import { Stage } from './Stage';
import { BLUR_SAMPLES, BLUR_SHUTTER_ANGLE, blurAllowed, cameraMovesInto, cursorMovesInto, exposureOf, subframeCrop } from './motionBlur';
import type { PlanBeat, PromoPlan } from './plan';

export type PromoProps = PromoPlan;

/** The logged-clock ms master frame `k` (fractional inside a blur sample) shows on this beat's shot. */
const loggedMsOf = (beat: PlanBeat, k: number, fps: number) => ((k - beat.shiftFrames) * 1000) / fps - beat.cursor.trimBeforeMs - beat.cursor.videoLagMs;

/** One exposure sample of a page frame: the camera at subframeCrop(u), the cursor at that instant, the recording pinned to the frame. */
const PageSample: React.FC<{ beat: PlanBeat; plan: PromoPlan; chromeSrc: string; local: number; camera: boolean; cursor: boolean }> = ({ beat, plan, chromeSrc, local, camera, cursor }) => {
  const u = exposureOf(useCurrentFrame(), local);
  const { fps, width } = useVideoConfig();
  const crops = beat.frameCrops ?? [];
  const crop = camera ? subframeCrop(crops, local, u) : crops[local];
  const k = beat.k0 + local - 1 + (cursor ? u : 1);
  return (
    <Stage stage={plan.stage} crop={crop} outputWidth={width} videoSrc={staticFile(beat.stagedSrc)} chromeSrc={chromeSrc} trimBeforeFrames={beat.k0 - beat.shiftFrames} pinFrame={local}>
      <Cursor track={beat.cursor.track} clicks={beat.cursor.clicks} loggedMs={loggedMsOf(beat, k, fps)} cssToLayer={2} offsetY={plan.stage.pageY} />
    </Stage>
  );
};

/** One exposure sample of the cursor alone (a held frame whose cursor moves). */
const CursorSampleLayer: React.FC<{ beat: PlanBeat; plan: PromoPlan; local: number }> = ({ beat, plan, local }) => {
  const u = exposureOf(useCurrentFrame(), local);
  const { fps } = useVideoConfig();
  return <Cursor track={beat.cursor.track} clicks={beat.cursor.clicks} loggedMs={loggedMsOf(beat, beat.k0 + local - 1 + u, fps)} cssToLayer={2} offsetY={plan.stage.pageY} />;
};

const BeatLayer: React.FC<{ beat: PlanBeat; plan: PromoPlan }> = ({ beat, plan }) => {
  const local = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const k = beat.k0 + local;
  const trimBeforeFrames = beat.k0 - beat.shiftFrames; // the source frame on the beat's first master frame
  const loggedMs = loggedMsOf(beat, k, fps);

  if (beat.card) {
    const i = Math.min(local, beat.card.frames.length - 1);
    return <PopupCard frame={beat.card.frames[i]} envelope={beat.card.envelopes[i]} stagedSrc={beat.stagedSrc} trimBeforeFrames={trimBeforeFrames} cursor={beat.cursor} loggedMs={loggedMs} />;
  }
  if (!beat.chromeSrc) throw new Error(`Promo: page beat ${beat.name} has no chrome PNG`);
  const chromeSrc = staticFile(beat.chromeSrc);
  const crops = beat.frameCrops ?? [];
  const i = Math.min(local, crops.length - 1);
  const blur = blurAllowed(beat, i); // a frame the eval samples is drawn sharp, mid-move or not
  const cursorMoving = blur && cursorMovesInto(beat.cursor.track, loggedMs, 1000 / fps);
  if (blur && cameraMovesInto(crops, i)) {
    return (
      <CameraMotionBlur shutterAngle={BLUR_SHUTTER_ANGLE} samples={BLUR_SAMPLES}>
        <PageSample beat={beat} plan={plan} chromeSrc={chromeSrc} local={i} camera cursor={cursorMoving} />
      </CameraMotionBlur>
    );
  }
  const cursor = <Cursor track={beat.cursor.track} clicks={beat.cursor.clicks} loggedMs={loggedMs} cssToLayer={2} offsetY={plan.stage.pageY} />;
  return (
    <Stage stage={plan.stage} crop={crops[i]} outputWidth={width} videoSrc={staticFile(beat.stagedSrc)} chromeSrc={chromeSrc} trimBeforeFrames={trimBeforeFrames}>
      {cursorMoving ? (
        <CameraMotionBlur shutterAngle={BLUR_SHUTTER_ANGLE} samples={BLUR_SAMPLES}>
          <CursorSampleLayer beat={beat} plan={plan} local={i} />
        </CameraMotionBlur>
      ) : (
        cursor
      )}
    </Stage>
  );
};

export const Promo: React.FC<PromoProps> = (plan) => {
  return (
    <AbsoluteFill style={{ background: '#FFE3B0' }}>
      {plan.beats.map((beat) => (
        <Sequence key={beat.name} from={beat.k0} durationInFrames={beat.k1 - beat.k0} layout="none">
          <BeatLayer beat={beat} plan={plan} />
        </Sequence>
      ))}
      {plan.items.map((item, i) => {
        if (item.kind === 'caption' || item.kind === 'card_caption') return <CaptionPill key={i} item={item} />;
        if (item.kind === 'name_tag') return <NameTag key={i} item={item} iconPath={plan.iconPath} />;
        if (item.kind === 'clock') return <Clock key={i} item={item} />;
        if (item.kind === 'brand_line') return <BrandLine key={i} item={item} />;
        return <Cta key={i} item={item} iconPath={plan.iconPath} />;
      })}
      <AudioMap music={plan.music} sfx={plan.sfx} />
    </AbsoluteFill>
  );
};

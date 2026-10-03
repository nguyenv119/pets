// Promo.tsx: the film (epic pets-o3p, bead pets-o3p.4). Draws a
// PromoPlan (plan.ts) and nothing else: each beat's recording at the crop
// the plan names for this master frame, the popup card frame by frame, the
// cursor, the screen-space text layers and the audio. Every number on
// screen was computed in Node, checked by renderChecks.ts and declared in
// timeline.json before this component ran.
//
// Each beat is one Sequence over its own master frames [k0, k1), so beats
// cut hard on the frame the anchors name (master.motion.cuts: "Hard cuts
// on an action frame only"). Text layers are siblings of the beats, so the
// popup caption can run across b3c-b3e and the brand line into b7.

import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { staticFile } from 'remotion';
import { AudioMap } from './AudioMap';
import { BrandLine, CaptionPill, Clock, Cta, NameTag } from './Captions';
import { Cursor } from './Cursor';
import { PopupCard } from './PopupCard';
import { Stage } from './Stage';
import type { PlanBeat, PromoPlan } from './plan';

export type PromoProps = PromoPlan;

const BeatLayer: React.FC<{ beat: PlanBeat; plan: PromoPlan }> = ({ beat, plan }) => {
  const local = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const k = beat.k0 + local;
  const trimBeforeFrames = beat.k0 - beat.shiftFrames; // the source frame on the beat's first master frame
  const loggedMs = ((k - beat.shiftFrames) * 1000) / fps - beat.cursor.trimBeforeMs - beat.cursor.videoLagMs;

  if (beat.card) {
    const i = Math.min(local, beat.card.frames.length - 1);
    return <PopupCard frame={beat.card.frames[i]} envelope={beat.card.envelopes[i]} stagedSrc={beat.stagedSrc} trimBeforeFrames={trimBeforeFrames} cursor={beat.cursor} loggedMs={loggedMs} />;
  }
  const crops = beat.frameCrops ?? [];
  const crop = crops[Math.min(local, crops.length - 1)];
  return (
    <Stage stage={plan.stage} crop={crop} outputWidth={width} videoSrc={staticFile(beat.stagedSrc)} trimBeforeFrames={trimBeforeFrames}>
      <Cursor track={beat.cursor.track} clicks={beat.cursor.clicks} loggedMs={loggedMs} cssToLayer={2} offsetY={-plan.stage.pageTopNative} />
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

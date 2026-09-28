// Promo.tsx: the top-level film composition (epic pets-o3p, bead
// pets-o3p.4). Sequences every beat from a pre-computed RenderBeat[]
// (render.mjs's job — this component does no anchor resolution itself),
// applying the floor-anchored camera crop, the cursor, captions, the name
// tag, the clock, the brand line and the CTA.
//
// KNOWN GAPS (see the coordinator's summary for the full list):
// - Card beats (the popup adoption, s2b_shelter) render a plain cream
//   placeholder, NOT the real PopupCard motion graphic — PopupCard.tsx is
//   not implemented in this pass.
// - Push-type camera moves ("hold_until", "push_then_hold", "continuous")
//   render a hard cut between the pre- and post-push crop rather than a
//   smooth 450ms/3000ms eased push — see timeline.ts's beatCropAt header.
// - Per-event SFX are not wired (AudioMap.tsx plays only the music bed).

import React from 'react';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { StageConfig } from './camera';
import { CaptionPill } from './Captions';
import { Clock } from './Clock';
import { BrandCta, BrandLine, type CtaLine } from './BrandCta';
import { Cursor } from './Cursor';
import { NameTag } from './NameTag';
import { Stage } from './Stage';
import { AudioMap } from './AudioMap';
import type { RenderBeat } from './renderBeats';

export interface PromoBeat extends RenderBeat {
  /** Public-dir-relative path render.mjs staged this beat's shot recording to. */
  stagedSrc: string;
  ctaLines?: readonly CtaLine[];
}

export interface OverlayLayout {
  caption: React.CSSProperties;
  nameTag: React.CSSProperties;
  clock: React.CSSProperties;
  brandLine: React.CSSProperties;
  cta: React.CSSProperties;
}

export interface PromoProps {
  beats: readonly PromoBeat[];
  stage: StageConfig;
  pageTopOffsetNative: number;
  musicSrc: string;
  layout: OverlayLayout;
  nameTagIconPath: string;
  noCaptions?: boolean;
  noZoom?: boolean;
}

const msToFrames = (ms: number, fps: number): number => Math.round((ms / 1000) * fps);

const BeatContent: React.FC<{ beat: PromoBeat; stage: StageConfig; pageTopOffsetNative: number; layout: OverlayLayout; nameTagIconPath: string; noCaptions?: boolean; noZoom?: boolean; beatFromFrame: number }> = ({
  beat,
  stage,
  pageTopOffsetNative,
  layout,
  nameTagIconPath,
  noCaptions,
  noZoom,
  beatFromFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tl = beat.timeline;
  const isCard = tl.crop === undefined;
  const sourceMs = tl.source_in + (frame / fps) * 1000;

  const crop = isCard ? undefined : noZoom ? { x: 0, y: 0, w: stage.width, h: stage.height } : tl.crop!;

  return (
    <>
      {isCard || !crop ? (
        <AbsoluteFill style={{ background: '#FFE3B0' }} />
      ) : (
        <Stage
          stage={stage}
          pageTopOffsetNative={pageTopOffsetNative}
          crop={crop}
          outputWidth={width}
          outputHeight={height}
          videoSrc={staticFile(beat.stagedSrc)}
          trimBeforeFrames={msToFrames(tl.source_in, fps)}
        >
          <Cursor cursorTrack={beat.cursorTrack} clicks={beat.clicks} sourceMs={sourceMs} cssToStage={2} />
        </Stage>
      )}

      {!noCaptions && beat.caption && beat.captionWindow ? (
        <CaptionPill
          text={beat.caption}
          fromFrame={msToFrames(beat.captionWindow.fromMaster, fps) - beatFromFrame}
          toFrame={msToFrames(beat.captionWindow.toMaster, fps) - beatFromFrame}
          fontSizePx={72}
          style={layout.caption}
        />
      ) : null}

      {!noCaptions && beat.nameTag ? (
        <NameTag
          iconPath={nameTagIconPath}
          fromFrame={msToFrames(beat.nameTag.fromMaster, fps) - beatFromFrame}
          toFrame={msToFrames(beat.nameTag.toMaster, fps) - beatFromFrame}
          style={layout.nameTag}
        />
      ) : null}

      {!noCaptions && beat.clock ? (
        <Clock
          ticks={beat.clock.map((c) => ({ text: c.text, fromFrame: msToFrames(c.fromMaster, fps) - beatFromFrame }))}
          outFrame={beat.clockOutMaster !== undefined ? msToFrames(beat.clockOutMaster, fps) - beatFromFrame : Infinity}
          style={layout.clock}
        />
      ) : null}

      {!noCaptions && beat.brandLine && beat.caption ? (
        <BrandLine text={beat.caption} fromFrame={beat.captionWindow ? msToFrames(beat.captionWindow.fromMaster, fps) - beatFromFrame : 0} style={layout.brandLine} />
      ) : null}

      {!noCaptions && beat.ctaFromMaster !== undefined && beat.ctaLines ? (
        <BrandCta lines={beat.ctaLines} fromFrame={msToFrames(beat.ctaFromMaster, fps) - beatFromFrame} style={layout.cta} />
      ) : null}
    </>
  );
};

export const Promo: React.FC<PromoProps> = ({ beats, stage, pageTopOffsetNative, musicSrc, layout, nameTagIconPath, noCaptions, noZoom }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {beats.map((beat, i) => {
        const from = msToFrames(beat.timeline.master_in, fps);
        const durationInFrames = Math.max(1, msToFrames(beat.timeline.master_out, fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <BeatContent
              beat={beat}
              stage={stage}
              pageTopOffsetNative={pageTopOffsetNative}
              layout={layout}
              nameTagIconPath={nameTagIconPath}
              noCaptions={noCaptions}
              noZoom={noZoom}
              beatFromFrame={from}
            />
          </Sequence>
        );
      })}
      <AudioMap musicSrc={musicSrc} />
    </AbsoluteFill>
  );
};

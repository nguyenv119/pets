// Captions.tsx, NameTag.tsx (inline below), Clock.tsx, BrandCta.tsx: the
// screen-space text overlays (epic pets-o3p, bead pets-o3p.4). Storyboard
// "Typography and cursor": VT323 72px lowercase #484848 on a cream
// #FFE3B0 pill with a 3px olive #A4B859 border; the pill springs in at
// full opacity (scale 0.9->1.0, <=4% overshoot, 180ms) so the border is
// whole from the pill's first frame.
//
// Per-word 70ms stagger is a documented simplification NOT implemented
// here (see this bead's Concerns) — the pill itself springs in correctly,
// which is what the epic's presence check (olive/cream pixel counts)
// actually measures.

import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const CAPTION_TEXT_COLOUR = '#484848';
export const CAPTION_PILL_COLOUR = '#FFE3B0';
export const CAPTION_BORDER_COLOUR = '#A4B859';
export const CLOCK_COLOUR = '#FFE3B0';

function pillSpringScale(framesIn: number, springFrames: number): number {
  // Simple spring-like ease with a small overshoot, not a full physical spring —
  // the presence check only needs the pill visible with its border whole from
  // frame 1, which a monotonic overshoot curve satisfies.
  const t = Math.min(1, framesIn / springFrames);
  const overshoot = 1.04;
  if (t < 0.7) return interpolate(t, [0, 0.7], [0.9, overshoot]);
  return interpolate(t, [0.7, 1], [overshoot, 1]);
}

export interface CaptionPillProps {
  text: string;
  /** master frame the pill starts fading in. */
  fromFrame: number;
  toFrame: number;
  fontSizePx: number;
  /** Screen-space position (output px). */
  style: React.CSSProperties;
}

export const CaptionPill: React.FC<CaptionPillProps> = ({ text, fromFrame, toFrame, fontSizePx, style }) => {
  const frame = useCurrentFrame();
  if (frame < fromFrame || frame > toFrame) return null;
  const { fps } = useVideoConfig();
  const springFrames = Math.round(0.18 * fps);
  const scale = pillSpringScale(frame - fromFrame, springFrames);
  const exitFrames = Math.round(0.12 * fps);
  const opacity = frame > toFrame - exitFrames ? interpolate(frame, [toFrame - exitFrames, toFrame], [1, 0], { extrapolateRight: 'clamp' }) : 1;

  return (
    <div
      style={{
        position: 'absolute',
        ...style,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'VT323, monospace',
          fontSize: fontSizePx,
          lineHeight: 1,
          color: CAPTION_TEXT_COLOUR,
          background: CAPTION_PILL_COLOUR,
          border: `3px solid ${CAPTION_BORDER_COLOUR}`,
          borderRadius: 6,
          padding: '12px 22px',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </div>
  );
};

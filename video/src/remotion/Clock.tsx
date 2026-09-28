// Clock.tsx: the top-right 22:00 clock, a screen-space layer never
// scaled or moved by the camera (epic pets-o3p, bead pets-o3p.4).
// Storyboard: "clock VT323 60 px cream #FFE3B0, no pill, top right in
// OUTPUT space (16:9 x 1600-1888, y 24-168)".

import React from 'react';
import { useCurrentFrame } from 'remotion';
import { CLOCK_COLOUR } from './Captions';

export interface ClockTick {
  text: string;
  fromFrame: number;
}

export interface ClockProps {
  ticks: readonly ClockTick[];
  outFrame: number;
  style: React.CSSProperties;
}

export const Clock: React.FC<ClockProps> = ({ ticks, outFrame, style }) => {
  const frame = useCurrentFrame();
  if (frame > outFrame || ticks.length === 0) return null;
  // The tick whose fromFrame is the latest one not after the current frame.
  let current = ticks[0];
  for (const tick of ticks) {
    if (tick.fromFrame <= frame) current = tick;
  }
  if (frame < ticks[0].fromFrame) return null;

  return (
    <div style={{ position: 'absolute', ...style, fontFamily: 'VT323, monospace', fontSize: 60, color: CLOCK_COLOUR }}>
      {current.text}
    </div>
  );
};

// AudioMap.tsx: the music bed (epic pets-o3p, bead pets-o3p.4).
//
// KNOWN GAP: only the music bed is wired here. The storyboard's per-event
// SFX map (video/shots.json beats[].sfx[]) is NOT implemented — see this
// bead's Concerns in the coordinator's summary. Wiring it needs each
// beat's sfx anchors resolved to master time the same way renderBeats.ts
// resolves captions, which ran out of budget in this pass.

import React from 'react';
import { Audio, interpolate, staticFile, useVideoConfig } from 'remotion';

export interface AudioMapProps {
  musicSrc: string;
  /** -2dB relative gain, per this bead's "Proven facts" (never re-derive from a raw dB cut). */
  gainDb?: number;
}

export const AudioMap: React.FC<AudioMapProps> = ({ musicSrc, gainDb = -2 }) => {
  const { durationInFrames, fps } = useVideoConfig();
  const volume = Math.pow(10, gainDb / 20);
  const fadeFrames = Math.round(0.6 * fps);

  return (
    <Audio
      src={staticFile(musicSrc)}
      volume={(frame) =>
        volume *
        interpolate(frame, [0, fadeFrames, durationInFrames - fadeFrames, durationInFrames - 1], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      }
    />
  );
};

// AudioMap.tsx: places the music bed and every SFX cue audioPlan.ts
// computed (epic pets-o3p, bead pets-o3p.4). No timing logic of its own.

import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import { musicGainAt, type MusicPlan, type SfxCue } from './audioPlan';

const dbToGain = (db: number) => Math.pow(10, db / 20);

export const AudioMap: React.FC<{ music: MusicPlan; sfx: readonly SfxCue[] }> = ({ music, sfx }) => (
  <>
    <Audio src={staticFile(music.src)} volume={(frame) => musicGainAt(music, frame)} />
    {sfx.map((cue, i) => (
      <Sequence key={i} from={cue.frame} layout="none">
        <Audio src={staticFile(cue.src)} volume={dbToGain(cue.gainDb)} playbackRate={cue.rate} />
      </Sequence>
    ))}
  </>
);

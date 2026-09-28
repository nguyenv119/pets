// ColourProofStill.tsx: a bare composition for pets-o3p.4's step 6 colour
// proof (see video/scripts/colour-proof.mjs). Renders exactly one frame
// of a given video at native size, nothing else — the proof compares
// this rendered frame's pixels against the lossless source to prove
// OffthreadVideo decodes a BT.709-tagged encode within 8 RGB units of
// the source GIF colours (and a FAIL control on an untagged encode).

import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';

export interface ColourProofStillProps {
  /** Path relative to the bundle's publicDir (e.g. "tagged.mp4") — resolved here via staticFile(). */
  videoSrc: string;
  trimBeforeFrames: number;
}

export const ColourProofStill: React.FC<ColourProofStillProps> = ({ videoSrc, trimBeforeFrames }) => (
  <AbsoluteFill>
    <OffthreadVideo src={staticFile(videoSrc)} trimBefore={trimBeforeFrames} muted style={{ width: '100%', height: '100%' }} />
  </AbsoluteFill>
);

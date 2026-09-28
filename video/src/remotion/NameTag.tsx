// NameTag.tsx: the store icon + "Pixel Pets" wordmark, ON the caption
// pill (epic pets-o3p, bead pets-o3p.4). Storyboard: "name tag = store
// icon ... at 64 px + 'Pixel Pets' in Press Start 2P 40 px, ON the
// caption pill (the same 3 px olive border)".

import React from 'react';
import { staticFile, useCurrentFrame } from 'remotion';
import { CAPTION_BORDER_COLOUR, CAPTION_PILL_COLOUR, CAPTION_TEXT_COLOUR } from './Captions';

export interface NameTagProps {
  fromFrame: number;
  toFrame: number;
  iconPath: string;
  style: React.CSSProperties;
}

export const NameTag: React.FC<NameTagProps> = ({ fromFrame, toFrame, iconPath, style }) => {
  const frame = useCurrentFrame();
  if (frame < fromFrame || frame > toFrame) return null;

  return (
    <div
      style={{
        position: 'absolute',
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: CAPTION_PILL_COLOUR,
        border: `3px solid ${CAPTION_BORDER_COLOUR}`,
        borderRadius: 6,
        padding: '10px 22px',
      }}
    >
      <img src={staticFile(iconPath)} width={64} height={64} style={{ imageRendering: 'pixelated' }} />
      <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 40, color: CAPTION_TEXT_COLOUR }}>Pixel Pets</span>
    </div>
  );
};

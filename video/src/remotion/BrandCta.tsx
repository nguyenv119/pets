// BrandCta.tsx: the brand line and the held call to action (epic
// pets-o3p, bead pets-o3p.4). Storyboard: brand line VT323 84px
// sentence-case cream, rising 8px and fading in over 300ms; CTA icon pops
// (scale 0->1.06->1.0 over 240ms), then each line rises 8px and fades in
// 90ms apart.

import React from 'react';
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CLOCK_COLOUR } from './Captions';

export interface BrandLineProps {
  text: string;
  fromFrame: number;
  style: React.CSSProperties;
}

export const BrandLine: React.FC<BrandLineProps> = ({ text, fromFrame, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < fromFrame) return null;
  const durFrames = Math.round(0.3 * fps);
  const t = frame - fromFrame;
  const opacity = interpolate(t, [0, durFrames], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(t, [0, durFrames], [8, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', ...style, fontFamily: 'VT323, monospace', fontSize: 84, color: CLOCK_COLOUR, opacity, transform: `translateY(${y}px)` }}>
      {text}
    </div>
  );
};

export interface CtaLine {
  text?: string;
  icon?: string;
  iconPx?: number;
  font: string;
  sizePx: number;
  colour: string;
}

export interface BrandCtaProps {
  lines: readonly CtaLine[];
  fromFrame: number;
  style: React.CSSProperties;
}

export const BrandCta: React.FC<BrandCtaProps> = ({ lines, fromFrame, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < fromFrame) return null;
  const staggerFrames = Math.round(0.09 * fps);
  const lineDurFrames = Math.round(0.09 * fps);

  return (
    <div style={{ position: 'absolute', ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {lines.map((line, i) => {
        const lineStart = fromFrame + i * staggerFrames;
        const t = frame - lineStart;
        if (t < 0) return null;
        const opacity = interpolate(t, [0, lineDurFrames], [0, 1], { extrapolateRight: 'clamp' });
        const y = interpolate(t, [0, lineDurFrames], [8, 0], { extrapolateRight: 'clamp' });
        const iconScale = line.icon
          ? interpolate(t, [0, Math.round(0.12 * fps), Math.round(0.24 * fps)], [0, 1.06, 1], { extrapolateRight: 'clamp' })
          : 1;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity, transform: `translateY(${y}px)` }}>
            {line.icon ? (
              <img
                src={staticFile(line.icon)}
                width={line.iconPx ?? 128}
                height={line.iconPx ?? 128}
                style={{ imageRendering: 'pixelated', transform: `scale(${iconScale})` }}
              />
            ) : null}
            {line.text ? <span style={{ fontFamily: line.font === 'Press Start 2P' ? "'Press Start 2P', monospace" : 'VT323, monospace', fontSize: line.sizePx, color: line.colour }}>{line.text}</span> : null}
          </div>
        );
      })}
    </div>
  );
};

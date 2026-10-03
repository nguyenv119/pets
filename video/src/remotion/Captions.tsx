// Captions.tsx: the caption pill and the name tag (epic pets-o3p, bead
// pets-o3p.4). video/shots.json master.motion.captions: "The pill springs
// in at FULL opacity (scale only: 0.9 to 1.0, at most 4% overshoot,
// 180 ms; only the words fade, so the olive border is whole from the
// pill's first frame); words keep the 70 ms stagger (opacity plus a 6 px
// rise); exit is a 120 ms fade." Storyboard: VT323, #484848 on a cream
// #FFE3B0 pill, 3 px olive #A4B859 border, 6 px radius, 12/22 px padding.
// The pill is drawn at exactly the rect overlays.ts planned, so the render
// checks judged the pixels this draws.

import React from 'react';
import { staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { TextItem } from './overlays';
import { NAME_TAG, PILL } from './overlays';

export const CAPTION_TEXT_COLOUR = '#484848';
export const CAPTION_PILL_COLOUR = '#FFE3B0';
export const CAPTION_BORDER_COLOUR = '#A4B859';
export const CREAM = '#FFE3B0';

/** A damped spring from 0.9 to 1.0 settling in ~180 ms, its one overshoot capped at 4 %. */
export function pillScale(ms: number): number {
  if (ms <= 0) return 0.9;
  if (ms >= 180) return 1;
  const u = ms / 180;
  // under-damped response: 1 - e^{-zeta w t}(cos), scaled so the peak overshoot is 0.4 % of a 10 % move (<= 4 % of the travel)
  const v = 1 - Math.exp(-5 * u) * Math.cos(3.2 * u * Math.PI * 0.5);
  return 0.9 + 0.1 * Math.min(1.04, v);
}

/** 0..1 of an ease-out over `dur` ms starting at `start` ms. */
const easeIn = (ms: number, start: number, dur: number) => {
  const u = Math.min(1, Math.max(0, (ms - start) / dur));
  return 1 - Math.pow(1 - u, 3);
};

function exitOpacity(frame: number, item: TextItem, fps: number): number {
  const exitFrames = Math.round(0.12 * fps);
  const left = item.toFrame - frame;
  return left >= exitFrames ? 1 : Math.max(0, left / exitFrames);
}

const pillBox = (item: TextItem): React.CSSProperties => ({
  position: 'absolute',
  left: item.rect.x,
  top: item.rect.y,
  width: item.rect.w,
  height: item.rect.h,
  boxSizing: 'border-box',
  background: CAPTION_PILL_COLOUR,
  border: `${PILL.border}px solid ${CAPTION_BORDER_COLOUR}`,
  borderRadius: 6,
});

/** A caption pill: words stagger in 70 ms apart while the pill itself springs at full opacity. */
export const CaptionPill: React.FC<{ item: TextItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < item.fromFrame || frame >= item.toFrame) return null;
  const ms = ((frame - item.fromFrame) * 1000) / fps;
  let wordIndex = 0;
  return (
    <div style={{ ...pillBox(item), transform: `scale(${pillScale(ms)})`, transformOrigin: 'center', opacity: exitOpacity(frame, item, fps), padding: `${PILL.padY}px ${PILL.padX}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: item.align === 'center' ? 'center' : 'flex-start' }}>
      {item.lines.map((line, li) => (
        <div key={li} style={{ fontFamily: 'VT323, monospace', fontSize: item.fontPx, lineHeight: 1, color: CAPTION_TEXT_COLOUR, whiteSpace: 'pre' }}>
          {line.split(' ').map((word, wi) => {
            const p = easeIn(ms, 70 * wordIndex++, 120);
            return (
              <span key={wi} style={{ display: 'inline-block', opacity: p, transform: `translateY(${6 * (1 - p)}px)` }}>
                {wi > 0 ? ' ' : ''}
                {word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** The name tag: the store icon and "Pixel Pets" in Press Start 2P, on the caption pill, springing like one. */
export const NameTag: React.FC<{ item: TextItem; iconPath: string }> = ({ item, iconPath }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < item.fromFrame || frame >= item.toFrame) return null;
  const ms = ((frame - item.fromFrame) * 1000) / fps;
  const p = easeIn(ms, 0, 120);
  return (
    <div style={{ ...pillBox(item), transform: `scale(${pillScale(ms)})`, transformOrigin: 'center', opacity: exitOpacity(frame, item, fps), padding: `${NAME_TAG.padY}px ${NAME_TAG.padX}px`, display: 'flex', alignItems: 'center', gap: NAME_TAG.gap }}>
      <img src={staticFile(iconPath)} width={NAME_TAG.iconPx} height={NAME_TAG.iconPx} style={{ imageRendering: 'pixelated', opacity: p }} />
      <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: item.fontPx, lineHeight: 1, color: CAPTION_TEXT_COLOUR, whiteSpace: 'pre', opacity: p, transform: `translateY(${6 * (1 - p)}px)` }}>Pixel Pets</span>
    </div>
  );
};

/** The 22:00 clock: cream VT323, no pill, a screen-space layer. */
export const Clock: React.FC<{ item: TextItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  if (frame < item.fromFrame || frame >= item.toFrame || !item.ticks) return null;
  let text = item.ticks[0].text;
  for (const t of item.ticks) if (t.fromFrame <= frame) text = t.text;
  return (
    <div style={{ position: 'absolute', left: item.rect.x, top: item.rect.y, width: item.rect.w, height: item.rect.h, textAlign: 'right', fontFamily: 'VT323, monospace', fontSize: 60, lineHeight: 1, color: CREAM, whiteSpace: 'pre' }}>
      {text}
    </div>
  );
};

/** The brand line: cream VT323, no pill, rises 8 px and fades in over 300 ms, then holds still. */
export const BrandLine: React.FC<{ item: TextItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < item.fromFrame || frame >= item.toFrame) return null;
  const p = easeIn(((frame - item.fromFrame) * 1000) / fps, 0, 300);
  return (
    <div style={{ position: 'absolute', left: item.rect.x, top: item.rect.y, opacity: p, transform: `translateY(${8 * (1 - p)}px)` }}>
      {item.lines.map((l, i) => (
        <div key={i} style={{ fontFamily: 'VT323, monospace', fontSize: item.fontPx, lineHeight: 1, color: CREAM, whiteSpace: 'pre' }}>
          {l}
        </div>
      ))}
    </div>
  );
};

/** The CTA: the icon pops (0 -> 1.06 -> 1.0 over 240 ms), then each line rises 8 px and fades in, 90 ms apart, then holds. */
export const Cta: React.FC<{ item: TextItem; iconPath: string }> = ({ item, iconPath }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < item.fromFrame || frame >= item.toFrame || !item.cta) return null;
  const ms = ((frame - item.fromFrame) * 1000) / fps;
  const pop = ms >= 240 ? 1 : ms < 140 ? 1.06 * easeIn(ms, 0, 140) : 1.06 - 0.06 * easeIn(ms, 140, 100);
  return (
    <div style={{ position: 'absolute', left: item.rect.x, top: item.rect.y, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {item.cta.map((line, i) => {
        const p = easeIn(ms, 90 * i, 180);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, height: Math.max(line.icon ? (line.iconPx ?? 128) : 0, line.sizePx) }}>
            {line.icon ? <img src={staticFile(iconPath)} width={line.iconPx ?? 128} height={line.iconPx ?? 128} style={{ imageRendering: 'pixelated', transform: `scale(${pop})` }} /> : null}
            {line.text ? (
              <span style={{ fontFamily: line.font === 'Press Start 2P' ? "'Press Start 2P', monospace" : 'VT323, monospace', fontSize: line.sizePx, lineHeight: 1, color: line.colour, whiteSpace: 'pre', opacity: p, transform: `translateY(${8 * (1 - p)}px)` }}>
                {line.text}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

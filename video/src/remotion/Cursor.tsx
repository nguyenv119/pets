// Cursor.tsx: the drawn cursor and its click rings (epic pets-o3p, bead
// pets-o3p.4). Drawing vendored from the spike (MIT, github.com/
// ashrafchowdury/programatic-demo, see ../camera/LICENSE-programatic-demo),
// rewritten against this bead's own Events types.
//
// Storyboard: "black arrow with a 2 px white outline, 22 CSS px tall in
// page space, so it scales with the camera... one ring per click (250 ms,
// <= 18 CSS px, #484848 with a 1 px cream inner stroke); two rings 90 ms
// apart for a double-click; no ring on a pet." It is drawn inside the
// layer it belongs to (the page stage, or the popup card's content box),
// in that layer's native px, so it scales with the camera or the card and
// is clipped with it.

import React from 'react';
import type { ClickEvent, CursorSample } from '../schema';

const ARROW_TALL_CSS = 22;
const RING_MS = 250;
const RING_MAX_D_CSS = 18;

/** The cursor at logged time t, eased (ease-in-out) between logged samples. */
export function sampleCursor(track: readonly CursorSample[], tMs: number): CursorSample | undefined {
  if (track.length === 0) return undefined;
  if (tMs <= track[0].t) return track[0];
  const last = track[track.length - 1];
  if (tMs >= last.t) return last;
  let i = 0;
  while (i < track.length - 1 && tMs > track[i + 1].t) i++;
  const a = track[i];
  const b = track[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b;
  const u = (tMs - a.t) / span;
  const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  return { t: tMs, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

export interface CursorProps {
  track: readonly CursorSample[];
  clicks: readonly ClickEvent[];
  /** the logged-clock ms this frame shows */
  loggedMs: number;
  /** CSS px -> the layer's px (2: native) */
  cssToLayer: number;
  /** layer y of CSS y 0 (the 16:9 stage hides the top 96 native px) */
  offsetY: number;
}

export const Cursor: React.FC<CursorProps> = ({ track, clicks, loggedMs, cssToLayer, offsetY }) => {
  const pos = sampleCursor(track, loggedMs);
  if (!pos) return null;
  const rings: number[] = [];
  for (const click of clicks) {
    if (click.pet) continue; // "no ring on a pet"
    const starts = click.kind === 'dblclick' ? [click.tMs, click.tMs + 90] : [click.tMs];
    for (const start of starts) {
      const u = (loggedMs - start) / RING_MS;
      if (u >= 0 && u <= 1) rings.push(u);
    }
  }
  const arrowH = ARROW_TALL_CSS * cssToLayer;
  const arrowW = arrowH * (24 / 32);
  return (
    <div style={{ position: 'absolute', left: pos.x * cssToLayer, top: pos.y * cssToLayer + offsetY, width: 0, height: 0, pointerEvents: 'none' }}>
      {rings.map((p, i) => {
        const d = RING_MAX_D_CSS * cssToLayer * (0.3 + 0.7 * (1 - Math.pow(1 - p, 3)));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: -d / 2,
              top: -d / 2,
              width: d,
              height: d,
              borderRadius: '50%',
              border: `${cssToLayer}px solid #484848`,
              boxShadow: `inset 0 0 0 ${cssToLayer}px #FFE3B0`,
              opacity: 1 - p,
            }}
          />
        );
      })}
      <svg width={arrowW} height={arrowH} viewBox="0 0 24 32" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <path d="M1 1 L1 23 L6.5 17.8 L10.2 26.6 L13.7 25 L9.95 16.5 L17 16.3 Z" fill="#111418" stroke="#ffffff" strokeWidth={1.85} strokeLinejoin="round" paintOrder="stroke" />
      </svg>
    </div>
  );
};

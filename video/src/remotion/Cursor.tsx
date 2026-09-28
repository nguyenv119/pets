// Cursor.tsx: the drawn cursor and its click rings (epic pets-o3p, bead
// pets-o3p.4). Vendored approach from the spike
// (.claude/marketing-video/spike/remotion-app/src/Cursor.tsx, MIT via
// github.com/ashrafchowdury/programatic-demo), rewritten against this
// bead's own Events/anchor types rather than the spike's ClickLog.
//
// Storyboard: "black arrow with a 2 px white outline, 22 CSS px tall in
// page space, so it scales with the camera... one ring per click (250 ms,
// <= 18 CSS px, #484848 with a 1 px cream inner stroke); two rings 90 ms
// apart for a double-click; no ring on a pet."

import React from 'react';
import type { ClickEvent, CursorSample } from '../schema';

const ARROW_TALL_CSS = 22;
const RING_MS = 250;
const RING_MAX_D_CSS = 18;

function sampleCursor(track: readonly CursorSample[], tMs: number): CursorSample | undefined {
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
  return { t: tMs, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** One ring's progress (0..1) at `tMs`, or undefined when it hasn't started or has finished. */
function ringProgress(startMs: number, tMs: number): number | undefined {
  const u = (tMs - startMs) / RING_MS;
  if (u < 0 || u > 1) return undefined;
  return u;
}

export interface CursorProps {
  cursorTrack: readonly CursorSample[];
  clicks: readonly ClickEvent[];
  /** Source-clock ms into this beat's shot recording. */
  sourceMs: number;
  /** CSS-px-to-stage-px scale (2, the fixed device_scale_factor). */
  cssToStage: number;
}

export const Cursor: React.FC<CursorProps> = ({ cursorTrack, clicks, sourceMs, cssToStage }) => {
  const pos = sampleCursor(cursorTrack, sourceMs);
  if (!pos) return null;

  const rings: number[] = [];
  for (const click of clicks) {
    if (click.pet) continue; // "no ring on a pet"
    const starts = click.kind === 'dblclick' ? [click.tMs, click.tMs + 90] : [click.tMs];
    for (const start of starts) {
      const p = ringProgress(start, sourceMs);
      if (p !== undefined) rings.push(p);
    }
  }

  const left = pos.x * cssToStage;
  const top = pos.y * cssToStage;
  const arrowH = ARROW_TALL_CSS * cssToStage;
  const arrowW = arrowH * (24 / 32);

  return (
    <div style={{ position: 'absolute', left, top, width: 0, height: 0, pointerEvents: 'none' }}>
      {rings.map((p, i) => {
        const d = RING_MAX_D_CSS * cssToStage * (0.3 + p * 1.05);
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
              border: `${1 * cssToStage}px solid #484848`,
              boxShadow: `inset 0 0 0 ${1 * cssToStage}px #FFE3B0`,
              opacity: 0.85 * (1 - p),
            }}
          />
        );
      })}
      <svg
        width={arrowW}
        height={arrowH}
        viewBox="0 0 24 32"
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <path
          d="M1 1 L1 23 L6.5 17.8 L10.2 26.6 L13.7 25 L9.95 16.5 L17 16.3 Z"
          fill="#111418"
          stroke="#ffffff"
          strokeWidth={1.85}
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </svg>
    </div>
  );
};

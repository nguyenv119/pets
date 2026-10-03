// PopupCard.tsx: the adoption's motion-graphic container (epic pets-o3p,
// bead pets-o3p.4). Draws exactly the frame cardTimeline.ts declared for
// the current master frame; no geometry is computed here.
//
// video/shots.json overlays.popup_card: a cream #FFE3B0 field fills the
// frame; the card frame (12 px corner mask, soft shadow
// 0 12px 32px rgba(72,72,72,0.18), the popup's own cream) holds exactly
// one declared crop of the popup take, which PLAYS (OffthreadVideo, one
// source frame per master frame), at an integer scale with nearest-
// neighbour at steady state; mid-morph the content is that crop scaled
// uniformly and centred in the frame. The cursor and its rings are drawn
// in the take's native px inside the content box, so they scale with the
// card and are clipped to the crop on screen.

import React from 'react';
import { OffthreadVideo, staticFile } from 'remotion';
import type { Rect, TimelineCardFrame } from '../schema';
import { Cursor } from './Cursor';
import type { CursorData } from './plan';

export const CARD_CREAM = '#FFE3B0';
export const CORNER_RADIUS_PX = 12;
export const CARD_SHADOW = '0 12px 32px rgba(72,72,72,0.18)';
/** The popup take's native frame: 500x960 CSS at device_scale_factor 2. */
export const POPUP_NATIVE_W = 1000;

export interface PopupCardProps {
  frame: TimelineCardFrame;
  envelope: Rect;
  stagedSrc: string;
  /** the source frame shown on the beat's first master frame */
  trimBeforeFrames: number;
  cursor: CursorData;
  /** the logged-clock ms this master frame shows */
  loggedMs: number;
}

export const PopupCard: React.FC<PopupCardProps> = ({ frame: f, envelope: e, stagedSrc, trimBeforeFrames, cursor, loggedMs }) => {
  const s = f.w / f.rect.w;
  const integer = Number.isInteger(s) && f.h === f.rect.h * s;
  return (
    <div style={{ position: 'absolute', inset: 0, background: CARD_CREAM }}>
      <div style={{ position: 'absolute', left: e.x, top: e.y, width: e.w, height: e.h, overflow: 'hidden', borderRadius: CORNER_RADIUS_PX, boxShadow: CARD_SHADOW, background: CARD_CREAM }}>
        <div style={{ position: 'absolute', left: f.at.x - e.x, top: f.at.y - e.y, width: f.w, height: f.h, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: POPUP_NATIVE_W, transform: `translate(${-f.rect.x * s}px, ${-f.rect.y * s}px) scale(${s})`, transformOrigin: '0 0' }}>
            <OffthreadVideo src={staticFile(stagedSrc)} trimBefore={trimBeforeFrames} muted style={{ display: 'block', width: POPUP_NATIVE_W, imageRendering: integer ? 'pixelated' : 'auto' }} />
            <Cursor track={cursor.track} clicks={cursor.clicks} loggedMs={loggedMs} cssToLayer={2} offsetY={0} />
          </div>
        </div>
      </div>
    </div>
  );
};

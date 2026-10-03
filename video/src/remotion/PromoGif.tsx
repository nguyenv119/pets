// PromoGif.tsx: the README GIF frames (epic pets-o3p, bead pets-o3p.4).
// video/shots.json variants.readme_gif: two no-zoom scenes from the raw
// 16:9 captures (no browser chrome), each scene's crop_css (CSS y 76-436,
// native 1920x720, halved later by pets-o3p.5's gif.mjs), VT323 32 px
// captions on the pill, top left of the frame, at their own beats' caption
// windows, and the cursor with the same ring rules. render.mjs resolves every anchor (gifScenes.ts); this only draws.

import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Rect } from '../schema';
import { CaptionPill } from './Captions';
import { Cursor } from './Cursor';
import type { GifScene } from './gifScenes';

export interface PromoGifProps {
  scenes: readonly GifScene[];
}

const SceneLayer: React.FC<{ scene: GifScene }> = ({ scene }) => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const demoMs = scene.sourceInMs + (local * 1000) / fps;
  const band: Rect = { x: scene.cropCss.x * 2, y: scene.cropCss.y * 2, w: scene.cropCss.w * 2, h: scene.cropCss.h * 2 };
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#FFE3B0' }}>
      <div style={{ position: 'absolute', left: -band.x, top: -band.y, width: 1920 }}>
        <OffthreadVideo src={staticFile(scene.stagedSrc)} trimBefore={scene.trimBeforeFrames} muted style={{ display: 'block', width: 1920, imageRendering: 'pixelated' }} />
        <Cursor track={scene.cursor.track} clicks={scene.cursor.clicks} loggedMs={demoMs - scene.cursor.trimBeforeMs - scene.cursor.videoLagMs} cssToLayer={2} offsetY={0} />
      </div>
    </AbsoluteFill>
  );
};

export const PromoGif: React.FC<PromoGifProps> = ({ scenes }) => (
  <AbsoluteFill style={{ background: '#FFE3B0' }}>
    {scenes.map((scene, i) => (
      <Sequence key={i} from={scene.fromFrame} durationInFrames={scene.frames} layout="none">
        <SceneLayer scene={scene} />
      </Sequence>
    ))}
    {scenes.flatMap((scene, i) => scene.captions.map((c, j) => <CaptionPill key={`${i}-${j}`} item={c} />))}
  </AbsoluteFill>
);

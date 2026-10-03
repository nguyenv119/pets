// Root.tsx: registers the Remotion compositions (epic pets-o3p, bead
// pets-o3p.4). render.mjs supplies `beats` (and everything else Promo
// needs) as inputProps at render time; durationInFrames is derived from
// the last beat's master_out via calculateMetadata, since the true film
// length depends on the recorded run and is never known statically.

import React from 'react';
import { Composition, continueRender, delayRender, staticFile } from 'remotion';
import shots from '../../shots.json';
import { STAGE_16X9, STAGE_9X16 } from './camera';
import { ColourProofStill } from './ColourProofStill';
import { Promo, type PromoProps } from './Promo';
import { PromoGif, type PromoGifProps } from './PromoGif';

/** The master's frame rate: shots.json `fps`, the same value timeline.ts plans with. */
const FPS = shots.fps;

// Local OFL pixel fonts, loaded once at module scope (video/README.md:
// "Fonts load from video/assets/fonts via @font-face (no network at
// render)"). Remotion's delayRender/continueRender hold the first frame
// until both faces are registered.
const fontHandle = delayRender('load pixel fonts (VT323, Press Start 2P)');
Promise.all([
  new FontFace('VT323', `url(${staticFile('fonts/VT323-Regular.ttf')})`).load(),
  new FontFace('Press Start 2P', `url(${staticFile('fonts/PressStart2P-Regular.ttf')})`).load(),
])
  .then((faces) => {
    faces.forEach((f) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(f));
    continueRender(fontHandle);
  })
  .catch((err) => {
    console.error('font load failed', err);
    continueRender(fontHandle);
  });

const EMPTY_PLAN = (stage: PromoProps['stage'], aspect: PromoProps['aspect']): PromoProps => ({
  beats: [],
  items: [],
  stage,
  totalFrames: FPS,
  music: { src: 'music/funny_and_cute_town_theme.ogg', quietDb: -10, upDb: -2, upFrom: 0, upFrames: 30, stopAt: FPS, stopFrames: 6 },
  sfx: [],
  iconPath: 'icons/icon-128.png',
  aspect,
});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Promo16x9"
        component={Promo as unknown as React.FC<Record<string, unknown>>}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={FPS}
        defaultProps={EMPTY_PLAN(STAGE_16X9, '16x9')}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: Math.max(1, (props as unknown as PromoProps).totalFrames),
        })}
      />
      <Composition
        id="Promo9x16"
        component={Promo as unknown as React.FC<Record<string, unknown>>}
        fps={FPS}
        width={1080}
        height={1920}
        durationInFrames={FPS}
        defaultProps={EMPTY_PLAN(STAGE_9X16, '9x16')}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: Math.max(1, (props as unknown as PromoProps).totalFrames),
        })}
      />

      <Composition
        id="PromoGif"
        component={PromoGif as unknown as React.FC<Record<string, unknown>>}
        fps={12.5}
        width={1920}
        height={720}
        durationInFrames={1}
        defaultProps={{ scenes: [] } satisfies PromoGifProps}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as PromoGifProps;
          return { durationInFrames: Math.max(1, p.scenes.reduce((sum, s) => sum + s.frames, 0)) };
        }}
      />
      {/*
        fps=60, NOT the shared FPS constant: OffthreadVideo's trimBefore is
        frames at the COMPOSITION's own fps, not the source media's. The
        colour-proof clips are built from the 60fps proof recording
        (frames-lossless-rgb.mkv) — declaring this composition at 25fps
        made trimBefore=5 seek to 5/25 = 0.2s = source frame 12 (60fps),
        not frame 5, showing a different (and wildly different-coloured)
        animation frame. Caught by comparing the rendered still against a
        direct ffmpeg decode of the same nominal frame index, which matched
        exactly, isolating the bug to Remotion's own fps-relative seek.
      */}
      <Composition
        id="ColourProof"
        component={ColourProofStill as unknown as React.FC<Record<string, unknown>>}
        fps={60}
        width={1920}
        height={1080}
        durationInFrames={1}
        defaultProps={{ videoSrc: '', trimBeforeFrames: 0 }}
      />
    </>
  );
};

// Stage.tsx: the shot's browser chrome PNG over the page capture shown 1:1,
// cropped and magnified to the camera's current rect (epic pets-o3p, bead
// pets-o3p.4; v2 chrome stage pets-3it.3). See camera.ts / timeline.ts for
// the pure crop math this component only applies as CSS.

import React from 'react';
import { Freeze, Img, OffthreadVideo } from 'remotion';
import type { Rect } from '../schema';
import type { StageConfig } from './camera';

export interface StageProps {
  stage: StageConfig;
  /** The current camera crop, in stage px. */
  crop: Rect;
  /** Output frame size (1920x1080 or 1080x1920). */
  outputWidth: number;
  videoSrc: string;
  /** The shot's chrome PNG (set/chrome/<page>[-narrow].png, staged), drawn at stage y 0-pageY. */
  chromeSrc: string;
  /** Frames into the video to start playback from (Remotion OffthreadVideo trimBefore). */
  trimBeforeFrames: number;
  /**
   * Inside a motion-blur sample (whose frame is fractional): the beat-local
   * frame the recording must show, so every sample draws the same page
   * frame and only the camera moves within the exposure.
   */
  pinFrame?: number;
  children?: React.ReactNode;
}

/**
 * Renders the chrome PNG at stage 0,0 and the page video below it at stage
 * y pageY (shots.json master.stage: no floor band, the pets stand on the
 * stage bottom), then applies the camera's crop as a CSS translate+scale
 * so the declared crop rect fills the output frame exactly. The chrome is
 * part of the page layer, so the camera scales it with the page. Nearest-neighbour scaling keeps native/2x holds pixel-clean
 * (storyboard: "Holds only at 1.0x and 2.0x... nearest-neighbour").
 */
export const Stage: React.FC<StageProps> = ({ stage, crop, outputWidth, videoSrc, chromeSrc, trimBeforeFrames, pinFrame, children }) => {
  const cameraScale = outputWidth / crop.w;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: stage.width,
          height: stage.height,
          transform: `translate(${-crop.x * cameraScale}px, ${-crop.y * cameraScale}px) scale(${cameraScale})`,
          transformOrigin: '0 0',
          imageRendering: 'pixelated',
        }}
      >
        <Img src={chromeSrc} style={{ position: 'absolute', left: 0, top: 0, width: stage.width, height: stage.pageY, imageRendering: 'pixelated' }} />
        {/* The page video, 1:1 below the chrome down to the stage bottom. */}
        <div style={{ position: 'absolute', left: 0, top: stage.pageY, width: stage.width, height: stage.height - stage.pageY, overflow: 'hidden' }}>
          <Freeze frame={pinFrame ?? 0} active={pinFrame !== undefined}>
            <OffthreadVideo src={videoSrc} trimBefore={trimBeforeFrames} muted style={{ position: 'absolute', left: 0, top: 0, width: stage.width, imageRendering: 'pixelated' }} />
          </Freeze>
        </div>
        {children}
      </div>
    </div>
  );
};

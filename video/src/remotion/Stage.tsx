// Stage.tsx: the page capture 1:1 above the cream floor band, cropped and
// magnified to the camera's current rect (epic pets-o3p, bead
// pets-o3p.4). See camera.ts / timeline.ts for the pure crop math this
// component only applies as CSS.

import React from 'react';
import { OffthreadVideo } from 'remotion';
import type { Rect } from '../schema';
import type { StageConfig } from './camera';

export const FLOOR_COLOUR = '#FFE3B0';

export interface StageProps {
  stage: StageConfig;
  /** Native px the top of the video source maps to stage y=0 (96 for 16:9, 0 for 9:16 — see this bead's "Stage" spec). */
  pageTopOffsetNative: number;
  /** The current camera crop, in stage px. */
  crop: Rect;
  /** Output frame size (1920x1080 or 1080x1920). */
  outputWidth: number;
  outputHeight: number;
  videoSrc: string;
  /** Frames into the video to start playback from (Remotion OffthreadVideo trimBefore). */
  trimBeforeFrames: number;
  children?: React.ReactNode;
}

/**
 * Renders the page video (skipping its hidden top strip) with the cream
 * floor band beneath it, then applies the camera's crop as a CSS
 * translate+scale so the declared crop rect fills the output frame
 * exactly. Nearest-neighbour scaling keeps native/2x holds pixel-clean
 * (storyboard: "Holds only at 1.0x and 2.0x... nearest-neighbour").
 */
export const Stage: React.FC<StageProps> = ({ stage, pageTopOffsetNative, crop, outputWidth, outputHeight, videoSrc, trimBeforeFrames, children }) => {
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
        {/* The page video, its hidden top strip cropped off via a negative offset. */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: stage.width, height: stage.floorLine, overflow: 'hidden' }}>
          <OffthreadVideo
            src={videoSrc}
            trimBefore={trimBeforeFrames}
            muted
            style={{
              position: 'absolute',
              left: 0,
              top: -pageTopOffsetNative,
              width: stage.width,
              imageRendering: 'pixelated',
            }}
          />
        </div>
        {/* The cream floor band beneath the page. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: stage.floorLine,
            width: stage.width,
            height: stage.height - stage.floorLine,
            background: FLOOR_COLOUR,
          }}
        />
        {children}
      </div>
    </div>
  );
};

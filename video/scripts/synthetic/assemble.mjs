// The synthetic run's one ffmpeg recipe of its own: the 9:16 page-shot
// stand-in (crop + pad of the 16:9 fixture). Frame assembly, the BT.709
// colour flags and probing come from the recorder's record/assemble.mjs, the
// single source for every encode Remotion later decodes (see its header for
// why an untagged encode is a real colour bug).

import { execFileSync } from 'node:child_process';
import { BT709_TAGS } from '../../record/assemble.mjs';

/**
 * Crops the source video to `crop` (device px) and pads it to
 * `padW`x`padH` with `padColor`, `padY` px from the top — the 9:16
 * page-shot stand-in (bead step 6): crop device x 840-1920 out of the
 * 1920x1080 fixture, then pad 380 device px of #faf6ef on top so the
 * result is 1080x1460 with the pets sitting at canvas y 1332-1460.
 */
export function buildPortraitStandin({ srcPath, outPath, crop, padW, padH, padY, padColor }) {
  execFileSync('ffmpeg', [
    '-y',
    '-i',
    srcPath,
    '-vf',
    `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},pad=${padW}:${padH}:0:${padY}:${padColor}`,
    '-c:v',
    'libx264',
    '-crf',
    '12',
    ...BT709_TAGS,
    outPath,
  ]);
  return outPath;
}

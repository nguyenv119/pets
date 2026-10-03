// The synthetic run's one ffmpeg recipe of its own: the page-shot stand-ins
// for both aspects (crop + pad of the v1 fixture). Frame assembly, the BT.709
// colour flags and probing come from the recorder's record/assemble.mjs, the
// single source for every encode Remotion later decodes (see its header for
// why an untagged encode is a real colour bug).

import { execFileSync } from 'node:child_process';
import { BT709_TAGS } from '../../record/assemble.mjs';

/**
 * Crops the source video to `crop` (device px) and pads it to
 * `padW`x`padH` with `padColor`, `padY` px from the top: a page-shot
 * stand-in cut from the v1 fixture (make-synthetic-run.mjs LAND and V916:
 * the 16:9's bottom 1920x872, or the 9:16's 1080x1080 padded to 1080x1712
 * so the pets sit at canvas y 1584-1712).
 */
export function buildStandin({ srcPath, outPath, crop, padW, padH, padY, padColor }) {
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

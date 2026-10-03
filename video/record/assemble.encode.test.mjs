// The recorder's frame assembly against REAL ffmpeg/ffprobe (moved here from
// scripts/synthetic/assemble.test.mjs when the synthetic run's copy of the
// recipe was folded into record/assemble.mjs). A mocked ffmpeg would prove
// nothing about whether the encode works or the colour tags survive.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleFrames, BT709_TAGS, BT709_VF, LOSSLESS_H264, probeVideo } from './assemble.mjs';

let workDir;
afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

function writeTinyPng(path, colour) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=4x4`, '-frames:v', '1', path]);
}

describe('assembleFrames (real ffmpeg)', () => {
  it('assembles two PNG frames into a readable, BT.709-tagged 25 fps mp4', () => {
    /**
     * Verifies the shared assembly recipe produces a video ffprobe reads back
     * as bt709 at 25 fps, through the same exported flags every other encode
     * in the pipeline now uses.
     *
     * An untagged encode is a real, previously hit colour bug: Remotion's
     * OffthreadVideo shifted a sprite colour 13 RGB units. If this breaks,
     * every recorded and synthetic demo.mp4 decodes off-colour in the edit.
     */
    // GIVEN — two tiny frames 100 ms apart
    workDir = mkdtempSync(join(tmpdir(), 'assemble-encode-test-'));
    const f0 = join(workDir, 'f0.png');
    const f1 = join(workDir, 'f1.png');
    writeTinyPng(f0, 'red');
    writeTinyPng(f1, 'blue');
    const outPath = join(workDir, 'out.mp4');

    // WHEN — assembling them
    assembleFrames({ frames: [{ file: f0, ts: 0 }, { file: f1, ts: 0.1 }], outPath, fps: 25, workDir });

    // THEN — the file is tagged bt709 at 25 fps
    const probe = probeVideo(outPath);
    expect(probe.color_space).toBe('bt709');
    expect(probe.r_frame_rate).toBe('25/1');
  });
});

describe('the shared BT.709 recipe', () => {
  it('converts through the BT.709 matrix to limited-range yuv444p and tags all four colour fields', () => {
    /**
     * Pins the recipe the fold made the single source: the colour-proof
     * script, the synthetic stand-in and the GIF gate control all spread
     * these constants, so a dropped flag here would silently untag them all.
     */
    // GIVEN / WHEN — the exported recipe
    // THEN — matrix, range, pixel format, the four tags and lossless x264
    expect(BT709_VF).toBe('scale=out_color_matrix=bt709:out_range=tv,format=yuv444p');
    expect(BT709_TAGS).toEqual(['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']);
    expect(LOSSLESS_H264).toEqual(['-c:v', 'libx264', '-qp', '0']);
  });
});

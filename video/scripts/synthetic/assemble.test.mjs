// Tests for the synthetic run's 9:16 stand-in recipe, against REAL
// ffmpeg/ffprobe (mock discipline: a fake ffmpeg call would prove nothing
// about whether the encode works or the output is readable back). Frame
// assembly is the recorder's (record/assemble.encode.test.mjs).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeVideo } from '../../record/assemble.mjs';
import { buildStandin } from './assemble.mjs';

let workDir;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

describe('buildStandin (real ffmpeg)', () => {
  it('crops and pads a source video to the declared output size', () => {
    /**
     * Verifies the v916 crop+pad recipe produces a video at exactly the
     * declared 9:16 stand-in dimensions, which is what every downstream
     * consumer (camera.ts's stage math) assumes without re-checking.
     *
     * If this breaks, the 9:16 synthetic render would stage a
     * wrong-sized source, throwing off every crop/hold check that
     * assumes a 1080-wide canvas.
     */
    // GIVEN — a small synthetic source video
    workDir = mkdtempSync(join(tmpdir(), 'portrait-test-'));
    const srcPath = join(workDir, 'src.mp4');
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=200x100:d=0.2', '-r', '25', srcPath]);
    const outPath = join(workDir, 'out.mp4');

    // WHEN — cropping x 50-150 (100px wide, full height) and padding 40px on top to 100x140
    buildStandin({ srcPath, outPath, crop: { x: 50, y: 0, w: 100, h: 100 }, padW: 100, padH: 140, padY: 40, padColor: '0xfaf6ef' });

    // THEN — the output is exactly the padded size
    const probe = probeVideo(outPath);
    expect(probe.width).toBe(100);
    expect(probe.height).toBe(140);
  });

  it('tags the stand-in BT.709 with the shared recipe flags', () => {
    /**
     * Verifies the 9:16 stand-in carries the BT.709 colour tags it now takes
     * from record/assemble.mjs's BT709_TAGS (the single source after the
     * fold), so Remotion decodes it without the untagged colour shift.
     *
     * If this breaks, every 9:16 synthetic render would decode its page
     * stand-ins about 13 RGB units off (plan review round 4).
     */
    // GIVEN — a small source video
    workDir = mkdtempSync(join(tmpdir(), 'portrait-tag-test-'));
    const srcPath = join(workDir, 'src.mp4');
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=200x100:d=0.2', '-r', '25', srcPath]);
    const outPath = join(workDir, 'out.mp4');

    // WHEN — building the stand-in
    buildStandin({ srcPath, outPath, crop: { x: 0, y: 0, w: 100, h: 100 }, padW: 100, padH: 120, padY: 20, padColor: '0xfaf6ef' });

    // THEN — ffprobe reads back the bt709 colour space
    expect(probeVideo(outPath).color_space).toBe('bt709');
  });
});

// Tests for the synthetic-run ffmpeg assembly helpers. buildConcatList is
// pure; assembleFrames/probeVideo/buildPortraitStandin are exercised
// against REAL ffmpeg/ffprobe (mock discipline: a fake ffmpeg call would
// prove nothing about whether the actual encode recipe works or the
// output is readable back).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleFrames, buildConcatList, buildPortraitStandin, probeVideo } from './assemble.mjs';

let workDir;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

describe('buildConcatList', () => {
  it('gives every frame but the last a duration equal to the gap to the next frame', () => {
    /**
     * Verifies the concat-demuxer list re-times variable-cadence CDP
     * screencast frames by their own logged gaps, not a uniform duration.
     *
     * This matters because CDP screencast frames arrive at an irregular
     * ~59fps: treating them as evenly spaced would desync the assembled
     * clip from the actions it's supposed to show (a card that "plays"
     * off-time fails this bead's own adoption-step check).
     *
     * If this breaks, every assembled synthetic take would run at the
     * wrong local speed wherever frame gaps varied.
     */
    // GIVEN — three frames at t=0, t=0.1s, t=0.3s (a 0.1s gap then a 0.2s gap)
    const frames = [
      { file: 'f0.png', ts: 0 },
      { file: 'f1.png', ts: 0.1 },
      { file: 'f2.png', ts: 0.3 },
    ];
    // WHEN — building the concat list
    const list = buildConcatList(frames);
    // THEN — frame 0's duration is the gap to frame 1, frame 1's is the gap to frame 2
    expect(list).toContain("file 'f0.png'\nduration 0.100000");
    expect(list).toContain("file 'f1.png'\nduration 0.200000");
  });

  it('throws with fewer than 2 frames', () => {
    /**
     * Verifies a single-frame capture (e.g. a popup take that failed
     * mid-recording) fails loudly instead of producing a silently
     * zero-length or malformed concat list.
     */
    // GIVEN / WHEN / THEN
    expect(() => buildConcatList([{ file: 'f0.png', ts: 0 }])).toThrow(/at least 2 frames/);
  });
});

function writeTinyPng(path, rgb) {
  // A 1x1 PNG is fiddly to hand-encode; instead ask ffmpeg (already a hard
  // dependency of this pipeline) to synthesize one from a solid colour.
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${rgb}:s=4x4`, '-frames:v', '1', path]);
}

describe('assembleFrames (real ffmpeg)', () => {
  it('assembles two PNG frames into a readable, BT.709-tagged mp4', () => {
    /**
     * Verifies the actual ffmpeg invocation produces a video file that
     * ffprobe can read back with the expected colour tagging — proving
     * the encode recipe works end to end, not just that buildConcatList's
     * string output looks right.
     *
     * This matters because an untagged encode is a real, previously-hit
     * colour bug (scripts/colour-proof.mjs's header): a mocked ffmpeg call
     * would never catch a wrong or dropped flag.
     *
     * If this breaks, every synthetic demo.mp4 this script writes would
     * either fail to assemble or decode with a colour shift in Remotion.
     */
    // GIVEN — two tiny synthetic frames 100ms apart
    workDir = mkdtempSync(join(tmpdir(), 'assemble-test-'));
    const f0 = join(workDir, 'f0.png');
    const f1 = join(workDir, 'f1.png');
    writeTinyPng(f0, 'red');
    writeTinyPng(f1, 'blue');
    const outPath = join(workDir, 'out.mp4');

    // WHEN — assembling them
    assembleFrames({ frames: [{ file: f0, ts: 0 }, { file: f1, ts: 0.1 }], outPath, fps: 25, workDir });

    // THEN — ffprobe reads back a bt709-tagged video
    const probe = probeVideo(outPath);
    expect(probe.width).toBeGreaterThan(0);
    expect(probe.color_space).toBe('bt709');
  });
});

describe('buildPortraitStandin (real ffmpeg)', () => {
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
    buildPortraitStandin({ srcPath, outPath, crop: { x: 50, y: 0, w: 100, h: 100 }, padW: 100, padH: 140, padY: 40, padColor: '0xfaf6ef' });

    // THEN — the output is exactly the padded size
    const probe = probeVideo(outPath);
    expect(probe.width).toBe(100);
    expect(probe.height).toBe(140);
  });
});

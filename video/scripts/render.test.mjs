import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MASTER_ENCODE } from './render.mjs';

const dir = mkdtempSync(join(tmpdir(), 'render-encode-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ff = (...args) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 24 });

/**
 * A 64x64 frame of the film's two commonest colours (the cream floor band and the dark page), encoded
 * with libx264 at `pixelFormat` and `crf`, then decoded the way the eval and `ffmpeg -i master out.png`
 * do (ffmpeg's default conversion to rgb24). Returns the mean |RGB| difference from the frame drawn.
 */
function encodeRoundTripError(pixelFormat, crf) {
  const src = join(dir, 'src.png');
  ff('-f', 'lavfi', '-i', 'color=c=0xFFE3B0:s=64x32,format=rgb24', '-f', 'lavfi', '-i', 'color=c=0x1D2127:s=64x32,format=rgb24', '-filter_complex', 'vstack', '-frames:v', '1', src);
  const mp4 = join(dir, `${pixelFormat}.mp4`);
  ff('-i', src, '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', pixelFormat, mp4);
  const rgb = (f) => ff('-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
  const a = rgb(src), b = rgb(mp4);
  let t = 0;
  for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]);
  return t / a.length;
}

describe('MASTER_ENCODE', () => {
  it('is h264 (the master stays h264 + AAC)', () => {
    /**
     * What: the master's video codec.
     * Why: README "What lands where" promises an h264 + AAC master; YouTube, X and the qa stage expect it.
     * What breaks: a codec swap made to chase a pixel match would ship a file the platforms re-encode or refuse.
     */
    // GIVEN / WHEN / THEN
    expect(MASTER_ENCODE.codec).toBe('h264');
  });

  it("decodes back to the drawn colours within 0.5 RGB units through ffmpeg's default conversion", () => {
    /**
     * What: a flat cream and dark-page frame, encoded with the master's settings and decoded by plain
     * ffmpeg, comes back within 0.5 mean |RGB| of what Remotion drew.
     * Why: the eval's motion check measures the master against the recording frame by frame; the beat's
     * own render mismatch (its floor) must stay well under the recording's own change, or quiet beats
     * (the catch changes 0.28) are "not judgeable". Win attempt 1 measured the unencoded Remotion frame at
     * 0.06 from the recording, and the yuv420p master at 1.69: ffmpeg's default yuv420p -> rgb24 path
     * darkens every pixel by about (2, 1, 2).
     * What breaks: five honest 16:9 page beats fail the motion check as not judgeable.
     */
    // GIVEN / WHEN
    const err = encodeRoundTripError(MASTER_ENCODE.pixelFormat, MASTER_ENCODE.crf);
    // THEN
    expect(err).toBeLessThan(0.5);
  });

  it('control: the same frame through yuv420p comes back more than 1 RGB unit off', () => {
    /**
     * What: the FAIL control for the test above.
     * Why: without it, a round trip that could never fail would pass for any pixel format.
     * What breaks: nothing ships; a regression back to yuv420p would go unnoticed.
     */
    // GIVEN / WHEN
    const err = encodeRoundTripError('yuv420p', MASTER_ENCODE.crf);
    // THEN
    expect(err).toBeGreaterThan(1);
  });
});

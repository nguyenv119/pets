import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConcatList } from './assemble.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rawSample = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'raw.sample.json'), 'utf-8'));

/** Parses a concat list back into each frame's start time on the assembled timeline (ms). */
function assembledStartsMs(list) {
  const starts = [];
  let at = 0;
  let pendingFile = false;
  for (const line of list.trim().split('\n')) {
    if (line.startsWith('file ')) {
      starts.push(at);
      pendingFile = true;
    } else if (line.startsWith('duration ') && pendingFile) {
      at += Number(line.slice('duration '.length)) * 1000;
      pendingFile = false;
    }
  }
  return starts.slice(0, -1); // the trailing repeat of the last file is not a frame of its own
}

describe('buildConcatList', () => {
  it('keeps every frame of the real proof capture on its own CDP time, with no drift building up by the end clapper', () => {
    /**
     * The assembled mp4's timeline must track the CDP frame timestamps, because
     * the clapper check compares the video's clap-to-clap gap with the page's
     * logged gap. The proof capture has 12 frame pairs under 1/120 s apart and
     * one timestamp that steps back 35.9 ms; padding each of those up to 1/120 s
     * without taking the time back later pushed the end clapper 215.7 ms late,
     * which reads as a large negative endClapResidualMs that no capture lag
     * caused. If this breaks, takes with bursty frames fail the clapper check
     * (or pass it only with a borrowed lag that happens to cancel the drift).
     */
    // GIVEN — the proof render's real screencast frames (CDP timestamps, epoch seconds)
    const frames = rawSample.frames;
    const ts0 = frames[0].ts;
    const endClapIndex = frames.findLastIndex((f) => f.ts * 1000 <= rawSample.clap2.tOff);

    // WHEN — the concat list is built and read back
    const starts = assembledStartsMs(buildConcatList(frames));

    // THEN — the frame on screen at the end clapper's release starts within one 1/120 s pad of its CDP time
    const drift = starts[endClapIndex] - (frames[endClapIndex].ts - ts0) * 1000;
    expect(Math.abs(drift)).toBeLessThanOrEqual(1000 / 120 + 0.01);
  });

  it('gives a frame whose timestamp steps backwards a minimal duration and lets the next frame start back on its own time', () => {
    /**
     * CDP occasionally delivers a frame stamped earlier than the one before it
     * (seen live on the popup take: -33.5 ms). That frame cannot be shown for a
     * negative time, so it gets the 1/120 s minimum, but the frames after it
     * must return to their own timestamps rather than inherit the overshoot.
     * If this breaks, one late frame shifts the whole rest of the take, and the
     * end clapper reads tens of ms late.
     */
    // GIVEN — four frames 16.7 ms apart where the third is stamped 33.5 ms before the second
    const frames = [
      { file: 'a.png', ts: 100.0 },
      { file: 'b.png', ts: 100.0167 },
      { file: 'c.png', ts: 99.9832 },
      { file: 'd.png', ts: 100.0501 },
    ];

    // WHEN — the concat list is built and read back
    const starts = assembledStartsMs(buildConcatList(frames));

    // THEN — the stepped-back frame shows for 1/120 s, and the next frame starts at its own CDP time again
    expect(starts[2] - starts[1]).toBeCloseTo(1000 / 120, 3);
    expect(starts[3]).toBeCloseTo(50.1, 3);
  });

  it('writes each well-spaced frame for exactly the gap to the next timestamp', () => {
    /**
     * The ordinary case: frames arrive at the screencast cadence and each one
     * stays on screen until the next arrives. If this breaks, the variable
     * cadence is lost and every event drifts against the log.
     */
    // GIVEN — three frames 16.7 ms and 33.3 ms apart
    const frames = [
      { file: 'a.png', ts: 10.0 },
      { file: 'b.png', ts: 10.0167 },
      { file: 'c.png', ts: 10.05 },
    ];

    // WHEN — the concat list is built and read back
    const starts = assembledStartsMs(buildConcatList(frames));

    // THEN — each frame starts at its own CDP time relative to the first
    expect(starts[1]).toBeCloseTo(16.7, 3);
    expect(starts[2]).toBeCloseTo(50.0, 3);
  });
});

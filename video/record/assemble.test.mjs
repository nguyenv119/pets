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

  it('places a frame delivered late at its own earlier timestamp, so the frame before it keeps its full screen time', () => {
    /**
     * CDP now and then delivers a frame stamped earlier than the one before
     * it (the proof capture has 7 in 1062 frames, the worst -35.9 ms). The
     * stamp is the true one: in win attempt 2's failed s1_inbox take, the
     * frame delivered after the magenta clapper showed the keep-compositing
     * dot's first shade with no magenta, content from before the clap. Shown
     * in arrival order, the late frame took the newer frame's screen time.
     * If this breaks, the newer frame flickers for 1/120 s and the stale one
     * fills its place.
     */
    // GIVEN — four frames 16.7 ms apart where the third is stamped 33.5 ms before the second
    const frames = [
      { file: 'a.png', ts: 100.0 },
      { file: 'b.png', ts: 100.0167 },
      { file: 'c.png', ts: 99.9832 },
      { file: 'd.png', ts: 100.0501 },
    ];

    // WHEN — the concat list is built and read back
    const list = buildConcatList(frames);
    const starts = assembledStartsMs(list);
    const order = list.trim().split('\n').filter((l) => l.startsWith('file ')).slice(0, -1).map((l) => l.slice(6, -1));

    // THEN — the late frame goes first, at its own time, and b shows from its stamp until d's
    expect(order).toEqual(['c.png', 'a.png', 'b.png', 'd.png']);
    expect(starts[1]).toBeCloseTo(16.8, 3);
    expect(starts[3] - starts[2]).toBeCloseTo(33.4, 3);
  });

  it('keeps the start clapper on screen when the frame delivered after it was stamped before it', () => {
    /**
     * The failure that ended win attempt 2 (s1_inbox/16:9, take dir kept):
     * the 160 ms clapper is a single screencast frame, because nothing moves
     * under it, and the pre-clap frame arrived right after it. Arrival order
     * gave the magenta frame 1/120 s and the stale white frame the 157 ms
     * hold, so the 25 fps video had no start clapper and the sync step threw
     * "found 1". The magenta frame must last from its own stamp to the next
     * newer frame, the release.
     */
    // GIVEN — the failing take's leading frames: white pre-roll, the magenta
    // clap, the stale pre-clap frame (stamped 2 ms before the clap), then the
    // release 165.6 ms after the clap
    const frames = [
      { file: 'preroll.png', ts: 1000.0 },
      { file: 'magenta.png', ts: 1000.530063 },
      { file: 'stale.png', ts: 1000.528 },
      { file: 'release.png', ts: 1000.695703 },
      { file: 'next.png', ts: 1000.710484 },
    ];

    // WHEN — the concat list is built and read back
    const list = buildConcatList(frames);
    const files = list.trim().split('\n').filter((l) => l.startsWith('file ')).map((l) => l.slice(6, -1));
    const starts = assembledStartsMs(list);
    const magenta = files.indexOf('magenta.png');

    // THEN — the magenta frame holds until the release's own CDP time
    // (695.703 ms after the pre-roll frame), for well over the 40 ms a 25 fps
    // frame needs; the stale frame's 1/120 s pad comes out of it
    expect(files[magenta + 1]).toBe('release.png');
    expect(starts[magenta + 1]).toBeCloseTo(695.703, 2);
    expect(starts[magenta + 1] - starts[magenta]).toBeGreaterThan(150);
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

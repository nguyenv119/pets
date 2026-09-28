import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSync, findFirstHeartFrame, findMagentaRuns, measureVideoLagFromHeart, parseSignalStats } from './sync.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sigSample = readFileSync(join(HERE, '..', 'fixtures', 'sig.sample.txt'), 'utf-8');
const rawSample = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'raw.sample.json'), 'utf-8'));

describe('parseSignalStats', () => {
  it('parses one row per frame with its SATMIN value', () => {
    // GIVEN — the committed real ffmpeg signalstats output for the proof render
    // WHEN — it is parsed
    const frames = parseSignalStats(sigSample);

    // THEN — every frame has a pts_time and a SATMIN reading
    expect(frames.length).toBeGreaterThan(100);
    expect(frames[0]).toMatchObject({ n: 0, t: 0 });
    expect(typeof frames[0].satmin).toBe('number');
  });
});

describe('findMagentaRuns', () => {
  it('finds exactly the two clapper flashes in the real signalstats log', () => {
    // GIVEN — the real signalstats log, which has one clapper flash at the start and one at the end of the take
    const frames = parseSignalStats(sigSample);

    // WHEN — magenta runs are located
    const runs = findMagentaRuns(frames);

    // THEN — exactly 2 runs are found (a third would mean a spurious high-saturation frame corrupted the take)
    expect(runs.length).toBe(2);
    expect(runs[0].releaseT).toBeLessThan(runs[1].startT);
  });
});

describe('computeSync', () => {
  it('matches the committed events.sample.json trimBeforeMs on the real fixture pair', () => {
    // GIVEN — the real raw capture log and its paired signalstats output (the proof render)
    // WHEN — sync is computed with the proof's own measured videoLagMs (56ms, per the bead's HANDOFF comment)
    const result = computeSync({
      signalStatsText: sigSample,
      startClapLoggedMs: rawSample.clap1.tOff,
      endClapLoggedMs: rawSample.clap2.tOff,
      videoLagMs: 56,
    });

    // THEN — trimBeforeMs matches the committed events.sample.json (1080ms) exactly, proving the release-edge
    // detection agrees with the proven recipe's own recorded output
    expect(result.trimBeforeMs).toBe(1080);
  });

  it('reproduces the proof render corrected residual (-63.3ms raw, ~-7ms corrected) and passes the 40ms gate', () => {
    // GIVEN — the same real fixture pair
    // WHEN — sync is computed
    const result = computeSync({
      signalStatsText: sigSample,
      startClapLoggedMs: rawSample.clap1.tOff,
      endClapLoggedMs: rawSample.clap2.tOff,
      videoLagMs: 56,
    });

    // THEN — the corrected residual is within ~1ms of the bead's documented measurement, and the 40ms gate passes
    expect(result.correctedResidualMs).toBeCloseTo(-7.3, 0);
    expect(result.pass).toBe(true);
  });

  it('fails the gate when videoLagMs does not explain the residual', () => {
    // GIVEN — the same real fixture pair, but a videoLagMs of 0 (as if lag were never measured/corrected for)
    // WHEN — sync is computed
    const result = computeSync({
      signalStatsText: sigSample,
      startClapLoggedMs: rawSample.clap1.tOff,
      endClapLoggedMs: rawSample.clap2.tOff,
      videoLagMs: 0,
    });

    // THEN — the uncorrected residual (~-63ms) is outside the 40ms tolerance
    expect(result.pass).toBe(false);
  });

  it('throws when the signalstats log does not contain two clapper flashes', () => {
    // GIVEN — a signalstats log edited down to a single frame (no magenta ever appears)
    const oneFrame = 'frame:0    pts:0       pts_time:0\nlavfi.signalstats.SATMIN=5\n';

    // WHEN / THEN — computeSync refuses to guess a sync point from a take with no clapper flashes
    expect(() => computeSync({ signalStatsText: oneFrame, startClapLoggedMs: 0, endClapLoggedMs: 1000, videoLagMs: 0 })).toThrow();
  });
});

describe('findFirstHeartFrame / measureVideoLagFromHeart', () => {
  // Synthetic signalstats output in the same shape ffmpeg's HEART_MASK_FILTER
  // produces (verified live against a real recording: a masked frame with no
  // heart pixel reads YMAX=16, tv-range black; a frame with the heart visible
  // reads YMAX=63).
  function heartFrame(n, tSeconds, ymax) {
    return `frame:${n}    pts:${Math.round(tSeconds * 12800)}       pts_time:${tSeconds}\nlavfi.signalstats.YMAX=${ymax}\n`;
  }

  it('finds the first frame at or after sinceMs whose YMAX crosses the heart threshold', () => {
    // GIVEN — a real-shaped signalstats dump: no heart until frame 3 (t=0.12s)
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.04, 16), heartFrame(2, 0.08, 16), heartFrame(3, 0.12, 63), heartFrame(4, 0.16, 16)].join('');
    const frames = parseSignalStats(text);

    // WHEN — the first heart frame at or after t=0 is located
    const heartMs = findFirstHeartFrame(frames, 0);

    // THEN — it's the frame at t=0.12s (120ms), not an earlier all-black one
    expect(heartMs).toBe(120);
  });

  it('ignores a heart frame before sinceMs (an earlier, unrelated heart)', () => {
    // GIVEN — a heart visible at t=0.08s (an earlier feed heart) and again at t=0.40s (the catch heart)
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.08, 63), heartFrame(2, 0.12, 16), heartFrame(3, 0.4, 63)].join('');
    const frames = parseSignalStats(text);

    // WHEN — searching from sinceMs=200 (after the first heart, before the second)
    const heartMs = findFirstHeartFrame(frames, 200);

    // THEN — the earlier heart at 80ms is skipped; the catch heart at 400ms is found
    expect(heartMs).toBe(400);
  });

  it('returns null when no heart frame appears at or after sinceMs', () => {
    // GIVEN — a signalstats dump with no heart frame at all
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.04, 16)].join('');
    const frames = parseSignalStats(text);

    // WHEN — searching for a heart
    const heartMs = findFirstHeartFrame(frames, 0);

    // THEN — null, not a fabricated 0
    expect(heartMs).toBeNull();
  });

  it('measureVideoLagFromHeart returns the gap between the logged event and the heart actually appearing on screen', () => {
    // GIVEN — a logged catch/eat event at t=350ms, and the heart first visible on screen at t=406ms (a real ~56ms capture lag)
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.35, 16), heartFrame(2, 0.406, 63)].join('');

    // WHEN — the lag is measured
    const lag = measureVideoLagFromHeart({ heartMaskSignalStatsText: text, sinceMs: 350 });

    // THEN — ~56ms, matching the proof render's own documented measurement
    expect(lag).toBeCloseTo(56, 0);
  });

  it('measureVideoLagFromHeart returns null for a take with no heart in the video (a heart-less shot, or one that never rendered)', () => {
    // GIVEN — a signalstats dump with no heart frame after the logged event
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.35, 16)].join('');

    // WHEN — the lag is measured
    const lag = measureVideoLagFromHeart({ heartMaskSignalStatsText: text, sinceMs: 350 });

    // THEN — null, so the caller falls back per the bead's documented rule (median of kept shots, else 56ms) rather than a fabricated value
    expect(lag).toBeNull();
  });
});

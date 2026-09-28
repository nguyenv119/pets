import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSync, findMagentaRuns, parseSignalStats } from './sync.mjs';

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

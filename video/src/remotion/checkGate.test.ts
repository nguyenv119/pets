import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enforceRenderChecks, isStandInRun, RenderCheckError } from './checkGate';
import type { FrameViolation } from './renderChecks';
import { makeEvents } from './testEvents';

const ONE: FrameViolation[] = [{ frame: 900, element: 'b4b_too camera crop', check: 'crop-pet-margin', detail: 'left crop edge -84px from pet box (margin 16)' }];

describe('enforceRenderChecks', () => {
  it('aborts a recorded take (shim v3;seed=N) on a single violating frame', () => {
    /**
     * Verifies the render-failing contract: one bad frame on a real take stops the render, naming the
     * frame and the element. If a real take could render past a violation, the epic's framing rules
     * would be advisory and a clipped pet could ship.
     */
    // GIVEN — every shot recorded by the real recorder
    const events = { s1: makeEvents({ shim: 'v3;seed=7' }), s2: makeEvents({ shim: 'v3;seed=7' }) };
    // WHEN / THEN
    expect(() => enforceRenderChecks(ONE, events)).toThrow(RenderCheckError);
    expect(() => enforceRenderChecks(ONE, events)).toThrow(/frame 900 b4b_too camera crop: crop-pet-margin/);
  });

  it('never lets a run with even one recorded (v3) shot reach the stand-in bypass', () => {
    /**
     * The bypass keys on the recordings' own shim, never a flag: a run that mixes one real shot with
     * stand-ins is real data and must abort. If this broke, a pipeline run could be passed off as a
     * stand-in to skip the checks.
     */
    const events = { s1: makeEvents({ shim: 'fixture' }), s2: makeEvents({ shim: 'v3;seed=1' }) };
    expect(isStandInRun(events)).toBe(false);
    expect(() => enforceRenderChecks(ONE, events)).toThrow(RenderCheckError);
  });

  it('renders stand-in data (every shim "fixture") but reports CHECKS FAILED with every violation', () => {
    /** The synthetic and fixture runs reuse one clip whose pets ignore the shot spec; they render, loudly marked. */
    const events = { s1: makeEvents({ shim: 'fixture' }) };
    const r = enforceRenderChecks(ONE, events);
    expect(r.standIn).toBe(true);
    expect(r.report[0]).toBe('CHECKS FAILED (stand-in data)');
    expect(r.report).toHaveLength(2);
  });

  it('passes a clean plan without a report of failures', () => {
    expect(enforceRenderChecks([], { s1: makeEvents({ shim: 'v3;seed=1' }) }).report).toEqual(['render checks: every frame passes']);
  });
});

const videoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const synthetic = join(videoRoot, '.cache', 'synthetic-run');

describe('render.mjs --run (integration, real planner on the synthetic recordings re-labelled as a recorded take)', () => {
  it.skipIf(!existsSync(synthetic))('exits non-zero, naming the frame, when a --run take has a violating frame', () => {
    /**
     * The synthetic run is known to put Bao through a 2.0x crop edge on b4b_too. Re-labelled with a
     * recorder shim it is, to render.mjs, a real take, so the render must abort before Remotion runs,
     * with a non-zero exit and the frame named. (Skipped when the gitignored synthetic run is absent.)
     */
    // GIVEN — a copy of the synthetic run whose every events.json says v3;seed=1
    const dir = mkdtempSync(join(tmpdir(), 'pp-run-'));
    const run = join(dir, 'run-2026-10-03');
    try {
      cpSync(synthetic, run, { recursive: true });
      const relabel = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) relabel(p);
          else if (e.name === 'events.json') writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), shim: 'v3;seed=1' }));
        }
      };
      relabel(run);
      // WHEN — planning the 16:9 master (--plan-only: no Remotion, no lock)
      const r = spawnSync('npx', ['tsx', 'scripts/render.mjs', '--run', run, '--variant', '16x9', '--plan-only'], { cwd: videoRoot, encoding: 'utf8' });
      // THEN
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/render checks failed/);
      expect(r.stderr).toMatch(/^frame \d+ \S+ camera crop: crop-pet-margin/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

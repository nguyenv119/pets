// pipeline.mjs's pure parts: the node check, the stage plan, run detection.

import { describe, expect, it } from 'vitest';
import { checkNode, parseArgs, pickNewRun, stagePlan, STILL_AT } from './pipeline.mjs';

describe('checkNode', () => {
  it('rejects node below 24 with the version it found', () => {
    /** node 18 is first on this machine's login PATH; the run must stop at once, saying why. */
    // GIVEN / WHEN / THEN
    expect(() => checkNode('18.20.4')).toThrow('node 24 or newer required, found v18.20.4');
    expect(() => checkNode('24.17.0')).not.toThrow();
  });
});

describe('stagePlan', () => {
  it('runs the stages in the bead\'s order', () => {
    /** Each stage reads what the one before wrote; out of order, it reads stale files. */
    // GIVEN / WHEN / THEN
    expect(stagePlan().map((s) => s.name)).toEqual(['prepare', 'record', 'render', 'loudness', 'gif', 'thumbnail', 'describe', 'contact-sheet', 'qa', 'prune']);
  });

  it('installs the root deps only when ../node_modules is missing, and always both browsers', () => {
    /** A fresh checkout has no root node_modules; the extension build needs typescript and esbuild. */
    // GIVEN
    const prepare = stagePlan()[0];
    // WHEN
    const fresh = prepare.steps({ rootModules: false }).map((s) => `${s.cmd} ${s.args.join(' ')}`);
    const warm = prepare.steps({ rootModules: true }).map((s) => `${s.cmd} ${s.args.join(' ')}`);
    // THEN
    expect(fresh[0]).toBe('npm ci');
    expect(warm).not.toContain('npm ci');
    expect(warm).toContain('npx playwright install chromium');
    expect(warm).toContain('npx remotion browser ensure');
  });

  it('renders all four variants from the same run, the still at the wave without captions', () => {
    /** verify.mjs fails a GIF or thumbnail rendered from another run (render-manifest.json). */
    // GIVEN
    const render = stagePlan().find((s) => s.name === 'render');
    // WHEN
    const steps = render.steps({ run: '/v/build/r1' }).map((s) => s.args.join(' '));
    // THEN
    expect(steps).toEqual([
      'tsx scripts/render.mjs --run /v/build/r1 --variant 16x9',
      'tsx scripts/render.mjs --run /v/build/r1 --variant 9x16',
      'tsx scripts/render.mjs --run /v/build/r1 --variant gif',
      `tsx scripts/render.mjs --run /v/build/r1 --variant still --at ${STILL_AT} --no-captions`,
    ]);
  });

  it('skips recording only when a run is reused', () => {
    /** --run re-renders an existing recording without filming again. */
    // GIVEN
    const record = stagePlan().find((s) => s.name === 'record');
    // WHEN / THEN
    expect(record.skip({ reuseRun: true })).toBe(true);
    expect(record.skip({ reuseRun: false })).toBe(false);
  });

  it('never prunes the run the outputs came from', () => {
    /** A reused older run could otherwise be deleted under its own outputs. */
    // GIVEN / WHEN / THEN
    expect(stagePlan().at(-1).steps({ run: '/v/build/r1' })[0].args).toEqual(['tsx', 'scripts/prune.mjs', '--keep', '/v/build/r1']);
  });
});

describe('pickNewRun / parseArgs', () => {
  it('names the one directory the recorder added', () => {
    /** Every later stage works from that run. */
    // GIVEN / WHEN / THEN
    expect(pickNewRun(['a', 'b'], ['a', 'b', 'c'])).toBe('c');
  });

  it('throws when the recorder added none, or several', () => {
    /** Guessing a run would render someone else's footage. */
    // GIVEN / WHEN / THEN
    expect(() => pickNewRun(['a'], ['a'])).toThrow(/found 0/);
    expect(() => pickNewRun([], ['a', 'b'])).toThrow(/found 2/);
  });

  it('rejects unknown flags', () => {
    /** A typo must not run an hour-long pipeline with the wrong options. */
    // GIVEN / WHEN / THEN
    expect(parseArgs(['--run', 'build/x'])).toEqual({ run: 'build/x' });
    expect(() => parseArgs(['--fast'])).toThrow(/unrecognised/);
  });
});

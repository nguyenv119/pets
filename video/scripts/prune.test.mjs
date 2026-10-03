// prune.mjs on a real temp directory tree.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prune, runsToPrune } from './prune.mjs';

let tmp;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('runsToPrune', () => {
  it('keeps the two newest runs by mtime', () => {
    /** A run is about 1 GB of lossless takes; two is enough to compare against. */
    // GIVEN / WHEN / THEN
    expect(runsToPrune([{ name: 'a', mtimeMs: 1 }, { name: 'b', mtimeMs: 3 }, { name: 'c', mtimeMs: 2 }])).toEqual(['a']);
  });

  it('never deletes the protected run', () => {
    /** The run the outputs were rendered from stays, even when older. */
    // GIVEN / WHEN / THEN
    expect(runsToPrune([{ name: 'a', mtimeMs: 1 }, { name: 'b', mtimeMs: 3 }, { name: 'c', mtimeMs: 2 }], 2, 'a')).toEqual([]);
  });
});

describe('prune (real filesystem)', () => {
  it('removes old runs and empties the takes cache', () => {
    /** Discarded takes pile up during the seed search; the stage must clear them. */
    // GIVEN — three runs and a take
    tmp = mkdtempSync(join(tmpdir(), 'prune-test-'));
    const build = join(tmp, 'build');
    const takes = join(tmp, 'takes');
    ['r1', 'r2', 'r3'].forEach((r, i) => {
      mkdirSync(join(build, r), { recursive: true });
      utimesSync(join(build, r), 1000 + i, 1000 + i);
    });
    mkdirSync(takes);
    writeFileSync(join(takes, 'take.mp4'), 'x');
    // WHEN
    const r = prune({ buildDir: build, takesDir: takes });
    // THEN
    expect(r.removed).toEqual(['r1']);
    expect(readdirSync(build).sort()).toEqual(['r2', 'r3']);
    expect(readdirSync(takes)).toEqual([]);
  });
});

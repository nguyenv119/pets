// Pure tests for the shared browser harness: no Chromium launch here (that
// lives in browser.smoke.test.mjs, run only via `npm run test:smoke`).

import { describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, lockPath } from './lock.mjs';
import { seedPositions } from './browser.mjs';

const VIDEO_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = join(VIDEO_DIR, '..');

describe('storage key equality', () => {
  it('seedStorage writes to the same keys the extension reads (src/store.ts, src/settings.ts)', () => {
    /**
     * Verifies that the literal key strings this harness writes
     * (pixel-pets-v1, pixel-pets-positions-v1, pixel-pets-settings-v1) equal
     * the extension's own ROSTER_KEY/POSITIONS_KEY/SETTINGS_KEY constants.
     *
     * This matters because seedStorage (browser.mjs) never imports the
     * extension's source — it hard-codes the key strings. If the extension
     * ever renames a storage key, a hard-coded mismatch would seed data the
     * content script silently never reads, and every recorded take would
     * show an unseeded (or stale) roster with no error anywhere.
     *
     * If this contract breaks, recordings silently show the wrong pets
     * instead of failing loudly.
     */
    // GIVEN — the extension's own source, read directly (never re-declared)
    const storeSource = readFileSync(join(REPO_ROOT, 'src', 'store.ts'), 'utf-8');
    const settingsSource = readFileSync(join(REPO_ROOT, 'src', 'settings.ts'), 'utf-8');

    // WHEN — extract each KEY constant's literal value
    const rosterKey = storeSource.match(/ROSTER_KEY = '([^']+)'/)?.[1];
    const positionsKey = storeSource.match(/POSITIONS_KEY = '([^']+)'/)?.[1];
    const settingsKey = settingsSource.match(/SETTINGS_KEY = '([^']+)'/)?.[1];

    // THEN — they equal what seedStorage (browser.mjs) hard-codes
    expect(rosterKey).toBe('pixel-pets-v1');
    expect(positionsKey).toBe('pixel-pets-positions-v1');
    expect(settingsKey).toBe('pixel-pets-settings-v1');
  });
});

describe('seedPositions', () => {
  it('stands every seeded pet on the viewport bottom: y = innerHeight - 64 (372 wide, 792 narrow)', () => {
    /**
     * Verifies the stored y is derived from the take's own viewport, not a
     * constant from an older one (v1 wrote 476 for a 540 px viewport).
     *
     * This matters because the stored y is what the content script reads on
     * boot; a stale y from another viewport would put the first painted
     * frame's pets off the floor in the 436 px and 856 px takes.
     *
     * If this breaks, the boxes start above or below the page bottom.
     */
    // GIVEN — Rex and Bao's seeded x
    const positions = { rex: { x: 700 }, bao: { x: 16 } };

    // WHEN — positions are built for the wide and narrow viewports
    const wide = seedPositions(positions, 436);
    const narrow = seedPositions(positions, 856);

    // THEN — x is kept and y sits 64 px above the bottom
    expect(wide).toEqual({ rex: { x: 700, y: 372 }, bao: { x: 16, y: 372 } });
    expect(narrow.rex).toEqual({ x: 700, y: 792 });
  });

  it('throws when positions are given without a viewport height', () => {
    /**
     * A caller that forgets the height must fail loudly instead of storing
     * y NaN, which would silently leave the pets wherever the extension
     * defaults them.
     */
    // GIVEN / WHEN / THEN — no innerHeight, one position
    expect(() => seedPositions({ rex: { x: 1 } })).toThrow(/innerHeight/);
    // and the popup's empty positions need none
    expect(seedPositions({})).toEqual({});
  });
});

describe('acquireLock', () => {
  it('fails naming the holder pid and command when a live pid holds the lock past the timeout', async () => {
    /**
     * Verifies that a second acquire, while a live process holds the lock,
     * waits and then fails with a message naming that holder's pid and
     * command rather than hanging forever or failing silently.
     *
     * This matters because a recording job that can never learn who is
     * blocking it is undebuggable: an agent watching a stuck pipeline needs
     * the holder's pid and command to decide whether to wait or intervene.
     *
     * If this contract breaks, a timeout produces an unhelpful generic
     * error, or the caller hangs past any reasonable investigation budget.
     */
    // GIVEN — a lock directory pre-created with THIS process's own (live) pid as holder
    const path = lockPath();
    rmSync(path, { recursive: true, force: true });
    mkdirSync(path);
    writeFileSync(join(path, 'holder.json'), JSON.stringify({ pid: process.pid, command: 'fake-holder-command' }));

    try {
      // WHEN — a second acquire runs with a short timeout
      await expect(acquireLock({ timeoutMs: 1000 })).rejects.toThrow(
        new RegExp(`pid ${process.pid} \\(fake-holder-command\\)`),
      );
      // THEN — assertion is the rejection above
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('reclaims a stale lock whose holder pid is dead', async () => {
    /**
     * Verifies that a lock left behind by a process that no longer exists
     * (a crashed or killed recorder) is reclaimed rather than blocking
     * every future run forever.
     *
     * This matters because the lock directory otherwise never expires on
     * its own: without stale-pid recovery, one crashed job would wedge
     * every subsequent recording job on this machine indefinitely.
     *
     * If this contract breaks, a single crash requires a human to manually
     * delete the lock directory before recording can resume.
     */
    // GIVEN — a lock directory whose holder pid does not exist
    const path = lockPath();
    rmSync(path, { recursive: true, force: true });
    mkdirSync(path);
    const deadPid = 999999; // astronomically unlikely to be a live pid
    writeFileSync(join(path, 'holder.json'), JSON.stringify({ pid: deadPid, command: 'dead-process' }));

    // WHEN — acquireLock runs with room to reclaim and succeed
    const lock = await acquireLock({ timeoutMs: 5000 });

    // THEN — it succeeds (the stale lock was reclaimed, not waited out)
    expect(lock).toHaveProperty('release');
    lock.release();
  });
});

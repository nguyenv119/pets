// A machine-wide exclusive lock for Chromium recording jobs: an `mkdir` of
// $TMPDIR/pixel-pets-chromium.lock holding the owner's pid and command, with
// stale-pid recovery. NOT re-entrant: a process that holds the lock must
// never call acquireLock() again before releasing (pets-o3p.4's
// `render.mjs --synthetic` must build the synthetic run outside its own
// render lock, for example).
//
// Frozen from this bead's commit on (video/README.md).

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_NAME = 'pixel-pets-chromium.lock';
const HOLDER_FILE = 'holder.json';
const POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000; // 90 min — pets-o3p.3's seed search can hold it about an hour

export function lockPath() {
  return join(tmpdir(), LOCK_NAME);
}

function isPidAlive(pid) {
  try {
    // Signal 0 sends nothing; it only checks whether the process exists
    // and is signalable, which is exactly what stale-pid recovery needs.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readHolder(path) {
  try {
    return JSON.parse(readFileSync(join(path, HOLDER_FILE), 'utf-8'));
  } catch {
    return null;
  }
}

function describe(holder) {
  return holder ? `pid ${holder.pid} (${holder.command})` : 'an unknown process';
}

/**
 * Acquires the recording lock, waiting up to `timeoutMs` (default 90 min)
 * while another process holds it — printing the holder's pid and command on
 * every poll — and reclaiming a stale lock whose holder pid is dead.
 *
 * Returns `{ release() }`. Throws, naming the holder's pid and command, if
 * the lock is still held when the timeout elapses.
 */
export async function acquireLock({ timeoutMs = DEFAULT_TIMEOUT_MS, ownerCommand = process.argv.slice(1).join(' ') || 'node' } = {}) {
  const path = lockPath();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(path);
      writeFileSync(join(path, HOLDER_FILE), JSON.stringify({ pid: process.pid, command: ownerCommand }));
      return {
        release() {
          rmSync(path, { recursive: true, force: true });
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const holder = readHolder(path);
      if (holder && !isPidAlive(holder.pid)) {
        rmSync(path, { recursive: true, force: true });
        continue; // stale-pid recovery: try again immediately
      }

      if (Date.now() >= deadline) {
        throw new Error(`timed out after ${timeoutMs}ms waiting for the Chromium recording lock, held by ${describe(holder)}`);
      }

      console.log(`waiting for the Chromium recording lock, held by ${describe(holder)}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
    }
  }
}

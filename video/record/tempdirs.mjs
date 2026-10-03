// Temp-dir bookkeeping for the recorder. lib/browser.mjs (frozen) makes a
// fresh Chromium profile dir in $TMPDIR for every launch and never removes
// it, nor returns its path; one shakedown session left 1.7 GB of them.

import { readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILE_PREFIX = 'pixel-pets-profile-';

/** The Chromium profile dirs lib/browser.mjs has made in $TMPDIR (it never removes them, and is frozen). */
export function profileDirs(root = tmpdir()) {
  return new Set(readdirSync(root).filter((n) => n.startsWith(PROFILE_PREFIX)).map((n) => join(root, n)));
}

/**
 * launchWithExtension (frozen) creates its profile dir right after it takes
 * the machine-wide Chromium lock and never returns its path. While this
 * process holds the lock no other launch can create one, so the newest
 * profile dir that was not there before the launch is this launch's own.
 */
export function ownProfileDir(before, root = tmpdir()) {
  const fresh = [...profileDirs(root)].filter((d) => !before.has(d));
  if (fresh.length === 0) return null;
  return fresh.map((d) => ({ d, t: statSync(d).birthtimeMs })).sort((a, b) => b.t - a.t)[0].d;
}

#!/usr/bin/env node
// Stage 9: disk hygiene (pets-o3p.5 step 8). Keeps only the two newest
// build/<run>/ directories (by mtime; the newest is the run just made) and
// empties .cache/takes/ (the recorder's discarded takes). `--keep <run>`
// never deletes that run (the one the outputs were rendered from, when the
// pipeline reused an older recording).
//
// Usage: npx tsx scripts/prune.mjs [--keep build/<run>]

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BUILD_DIR, isMain, VIDEO_DIR } from './stage-io.mjs';

export const KEEP_RUNS = 2;
export const TAKES_DIR = join(VIDEO_DIR, '.cache', 'takes');

/** The run names to delete: all but the `keep` newest of `runs` ([{ name, mtimeMs }]), never `protect`. */
export function runsToPrune(runs, keep = KEEP_RUNS, protect = null) {
  return [...runs].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(keep).map((r) => r.name).filter((n) => n !== protect);
}

export function prune({ buildDir = BUILD_DIR, takesDir = TAKES_DIR, protect = null } = {}) {
  const runs = existsSync(buildDir)
    ? readdirSync(buildDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ name: e.name, mtimeMs: statSync(join(buildDir, e.name)).mtimeMs }))
    : [];
  const gone = runsToPrune(runs, KEEP_RUNS, protect);
  for (const name of gone) rmSync(join(buildDir, name), { recursive: true, force: true });
  rmSync(takesDir, { recursive: true, force: true });
  mkdirSync(takesDir, { recursive: true });
  return { kept: runs.length - gone.length, removed: gone };
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--keep');
  const r = prune({ protect: i >= 0 && process.argv[i + 1] ? basename(process.argv[i + 1]) : null });
  console.log(`prune: kept ${r.kept} run(s) in build/, removed ${r.removed.length ? r.removed.join(', ') : 'none'}; emptied .cache/takes/`);
}

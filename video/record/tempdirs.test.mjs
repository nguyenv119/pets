import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownProfileDir, profileDirs } from './tempdirs.mjs';

const roots = [];
const freshRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-tempdirs-test-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('ownProfileDir', () => {
  it("picks the profile dir the launch created, leaving older ones alone", () => {
    /**
     * lib/browser.mjs (frozen) never returns or removes its profile dir
     * (1.7 GB leaked in one shakedown session). The recorder removes the
     * dir its own launch made, and must never pick another process's.
     */
    // GIVEN — a $TMPDIR-like root with an older profile dir and an unrelated dir
    const root = freshRoot();
    mkdirSync(join(root, 'pixel-pets-profile-old'));
    mkdirSync(join(root, 'something-else'));
    const before = profileDirs(root);

    // WHEN — a launch creates its profile dir
    mkdirSync(join(root, 'pixel-pets-profile-new'));
    const own = ownProfileDir(before, root);

    // THEN — only the new one is ours
    expect(own).toBe(join(root, 'pixel-pets-profile-new'));
  });

  it('returns null when the launch made no profile dir', () => {
    /** Nothing new means nothing to delete, never a guess. */
    // GIVEN — a root with only an older profile dir
    const root = freshRoot();
    mkdirSync(join(root, 'pixel-pets-profile-old'));
    const before = profileDirs(root);

    // WHEN / THEN
    expect(ownProfileDir(before, root)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'node:url';
import { derivePetTypes, getShippedAssetDirs, assertAssetDirsExist, assertWebAccessibleResourcesMatch } from './asset-dirs.mjs';

describe('derivePetTypes', () => {
  it('extracts every member of the PetType union in declaration order', () => {
    /**
     * What: derivePetTypes must read the exact set of pet types straight out
     * of the PetType union source text.
     * Why: PetType (src/types.ts) is the single source of truth for which
     * pets exist. The build's asset allowlist is derived from this function
     * specifically so it cannot drift from PetType without a code change.
     * What breaks: if parsing silently drops or mis-splits a type, the build
     * would ship an allowlist missing a real pet's sprite directory.
     */
    // GIVEN — a types.ts snippet shaped like the real file
    const source = `export type PetState = 'a' | 'b';\nexport type PetType = 'dog' | 'fox' | 'totoro';\n`;

    // WHEN — parsing out the PetType union
    const result = derivePetTypes(source);

    // THEN — exactly the PetType members, not PetState's
    expect(result).toEqual(['dog', 'fox', 'totoro']);
  });

  it('throws when no PetType union declaration is found', () => {
    /**
     * What: derivePetTypes must fail loudly, not silently return [], when
     * the expected declaration is absent.
     * Why: an empty allowlist would make the build ship zero pet sprites
     * while looking like a successful build.
     * What breaks: without this, a rename of PetType or a reformatted
     * types.ts would silently produce an extension with no pets.
     */
    // GIVEN — source with no PetType declaration
    const source = `export type PetState = 'a' | 'b';\n`;

    // WHEN / THEN — parsing throws instead of returning an empty list
    expect(() => derivePetTypes(source)).toThrow(/PetType/);
  });
});

describe('getShippedAssetDirs', () => {
  it('derives the real repo pet types from src/types.ts plus icons', () => {
    /**
     * What: reading the actual src/types.ts must produce the real 14 pet
     * types plus 'icons'.
     * Why: this is the exact call build.mjs makes; testing it against the
     * real file (not a fixture) catches drift between this test and reality.
     * What breaks: if src/types.ts's PetType format ever changes shape, this
     * integration-style check fails here instead of silently shipping a
     * broken allowlist.
     */
    // GIVEN — the real src/types.ts, resolved relative to this test file
    // WHEN — deriving the shipped asset directories
    const dirs = getShippedAssetDirs(fileURLToPath(new URL('../src/types.ts', import.meta.url)));

    // THEN — exactly the known pet types, in declaration order, plus icons.
    // An exact match (not a subset check) means a future length mismatch
    // names the offending element instead of just a bare count.
    expect(dirs).toEqual([
      'chicken', 'cockatiel', 'crab', 'dog', 'fox', 'horse', 'miffy',
      'monkey', 'panda', 'rat', 'snail', 'snake', 'totoro', 'turtle', 'icons',
    ]);
  });
});

describe('assertWebAccessibleResourcesMatch', () => {
  it('does not throw when every pet type has a matching web_accessible_resources entry', () => {
    /**
     * What: assertWebAccessibleResourcesMatch must pass silently when the
     * manifest already grants every pet type's assets to content scripts.
     * Why: this is the happy path the build takes on every normal run; it
     * must not raise false alarms.
     * What breaks: a false positive here would break every build.
     */
    // GIVEN — a manifest whose web_accessible_resources covers both pet types
    const manifest = {
      web_accessible_resources: [
        { resources: ['assets/dog/*.gif', 'assets/fox/*.gif'], matches: ['<all_urls>'] },
      ],
    };

    // WHEN / THEN — asserting against a manifest that covers every type does not throw
    expect(() => assertWebAccessibleResourcesMatch(['dog', 'fox'], manifest)).not.toThrow();
  });

  it('throws naming the pet type missing from web_accessible_resources', () => {
    /**
     * What: assertWebAccessibleResourcesMatch must fail the build when a
     * pet type's assets aren't listed in manifest.json's
     * web_accessible_resources.
     * Why: web_accessible_resources is a hand-maintained, unchecked third
     * copy of the pet list — a missing entry still builds, still copies
     * sprites, and still renders in the popup, then 404s on every page
     * because MV3 blocks content-script access to unlisted resources.
     * What breaks: without this, a new pet type could ship broken on every
     * real page and only be caught by a user report.
     */
    // GIVEN — a manifest missing an entry for 'fox'
    const manifest = {
      web_accessible_resources: [
        { resources: ['assets/dog/*.gif'], matches: ['<all_urls>'] },
      ],
    };

    // WHEN / THEN — asserting against the incomplete manifest throws, naming 'fox'
    expect(() => assertWebAccessibleResourcesMatch(['dog', 'fox'], manifest)).toThrow(/fox/);
  });
});

describe('assertAssetDirsExist', () => {
  it('does not throw when every listed directory exists on disk', () => {
    /**
     * What: assertAssetDirsExist must pass silently for a fully-present
     * allowlist.
     * Why: this is the happy path the build takes on every normal run; it
     * must not raise false alarms.
     * What breaks: a false positive here would break every build.
     */
    // GIVEN — a real temp directory containing the listed subdirectories
    const root = mkdtempSync(join(tmpdir(), 'asset-dirs-'));
    mkdirSync(join(root, 'dog'));
    mkdirSync(join(root, 'icons'));

    try {
      // WHEN / THEN — asserting against directories that really exist does not throw
      expect(() => assertAssetDirsExist(['dog', 'icons'], root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws naming the missing directory when one is absent', () => {
    /**
     * What: assertAssetDirsExist must fail the build when a directory PetType
     * requires is missing from assets/.
     * Why: shipping without a sprite directory produces a pet the popup can
     * add but the content script cannot render — a silent runtime bug that a
     * build-time check catches for free.
     * What breaks: without this, a missing asset directory would only be
     * discovered by a user seeing a broken pet in production.
     */
    // GIVEN — a real temp directory missing one required subdirectory
    const root = mkdtempSync(join(tmpdir(), 'asset-dirs-'));
    mkdirSync(join(root, 'dog'));

    try {
      // WHEN / THEN — asserting against a missing directory throws, naming it
      expect(() => assertAssetDirsExist(['dog', 'fox'], root)).toThrow(/fox/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

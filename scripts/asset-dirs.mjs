import { readFileSync, existsSync } from 'fs';

// Pulls the PetType union members out of `export type PetType = 'a' | 'b' | ...;`
// in src/types.ts. PetType is the single source of truth for which pets exist,
// so deriving the shipped asset directories from it (rather than hand-maintaining
// a second list) means the two cannot silently drift apart.
export function derivePetTypes(typesSource) {
  const match = typesSource.match(/export type PetType\s*=([^;]+);/);
  if (!match) {
    throw new Error('Could not find "export type PetType = ...;" in src/types.ts');
  }
  return match[1]
    .split('|')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

// The full allowlist of assets/<dir> directories that must ship: every pet
// type, plus icons/ (referenced by manifest.json's "icons" and
// "action.default_icon"). Anything not in this list — reference art, unused
// species, .DS_Store — is excluded by default rather than requiring someone
// to remember to deny it.
export function getShippedAssetDirs(typesTsPath = 'src/types.ts') {
  return [...derivePetTypes(readFileSync(typesTsPath, 'utf-8')), 'icons'];
}

// Fails fast if a directory the build is about to ship doesn't actually exist
// on disk. A missing sprite directory silently shipping an incomplete pet is
// a far worse outcome than a build error, so this throws rather than warns.
export function assertAssetDirsExist(dirs, assetsRoot = 'assets') {
  const missing = dirs.filter((dir) => !existsSync(`${assetsRoot}/${dir}`));
  if (missing.length > 0) {
    throw new Error(`Missing required asset director${missing.length === 1 ? 'y' : 'ies'} under ${assetsRoot}/: ${missing.join(', ')}`);
  }
}

// Fails fast if a pet type's assets aren't also granted to content scripts
// via manifest.json's web_accessible_resources. That list is hand-maintained
// (not derived), so it's the one place a missing pet type is invisible until
// a user reports a 404: MV3 blocks content-script access to any resource not
// listed there, even though the sprites still copy and still render in the
// popup.
export function assertWebAccessibleResourcesMatch(petTypes, manifest) {
  const resources = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []);
  const missing = petTypes.filter((type) => !resources.some((resource) => resource.startsWith(`assets/${type}/`)));
  if (missing.length > 0) {
    throw new Error(`Missing web_accessible_resources entr${missing.length === 1 ? 'y' : 'ies'} for pet type${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
}

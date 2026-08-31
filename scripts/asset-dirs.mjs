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

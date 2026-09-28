// Node-only: the pet-species allowlist for the promo video. Kept out of
// schema.ts / anchors.ts (browser-safe; a Remotion composition may import
// them) because this module reads the extension's own source files.
//
// Frozen from this bead's commit on (video/README.md).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpeciesAllowlist } from './schema';

// Species kept out of frame for the marketing video only — the popup's own
// grid still lists them, the recorder just never seeds or clicks them.
// Source: .claude/marketing-video/research/sprite-licences.md (rights
// review) — totoro and miffy are third-party character IP with no licence
// that covers a promo; fox is CC BY-NC with a no-redistribution clause;
// cockatiel, monkey and horse were never given a cast role by the approved
// storyboard.
const NEVER_CAST_TYPES: readonly string[] = ['totoro', 'miffy', 'fox', 'cockatiel', 'monkey', 'horse'];

// The dog's Akita colourway is a separate, ambiguously-licensed contribution
// (sprite-licences.md: "Ambiguous... skip it. It adds ambiguity for no
// gain.") layered on an otherwise-fine species, so it is excluded by colour
// rather than by type.
const NEVER_CAST_COLOR: { type: string; color: string } = { type: 'dog', color: 'akita' };

/**
 * Loads the full PetType allowlist by deriving it from the extension's own
 * `src/types.ts` (the single source of truth), via the root's
 * `scripts/asset-dirs.mjs:derivePetTypes`. That helper has no type
 * declarations and video/tsconfig.json is strict without `allowJs`, so a
 * static `import` would fail `tsc` with TS7016 — loaded with a computed
 * specifier instead, which `tsc` never tries to resolve statically.
 */
export async function loadSpeciesAllowlist(): Promise<SpeciesAllowlist> {
  const assetDirsUrl = new URL('../../scripts/asset-dirs.mjs', import.meta.url).href;
  const { derivePetTypes } = (await import(assetDirsUrl)) as {
    derivePetTypes(typesSource: string): string[];
  };

  const typesTsPath = fileURLToPath(new URL('../../src/types.ts', import.meta.url));
  const typesSource = readFileSync(typesTsPath, 'utf-8');
  const types = derivePetTypes(typesSource);

  return {
    types,
    neverCastTypes: NEVER_CAST_TYPES,
    neverCastColor: NEVER_CAST_COLOR,
  };
}

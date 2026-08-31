import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { getShippedAssetDirs, assertAssetDirsExist, assertWebAccessibleResourcesMatch } from './scripts/asset-dirs.mjs';

// Clean and create dist
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/popup', { recursive: true });

// 1. Content script — single IIFE, no dynamic imports, no code splitting
await esbuild.build({
  entryPoints: ['src/content.ts'],
  bundle: true,
  outfile: 'dist/content.js',
  format: 'iife',
  target: 'chrome120',
  minify: true,
});

// 2. Service worker — ES module (Chrome MV3 supports type: module)
await esbuild.build({
  entryPoints: ['src/service-worker.ts'],
  bundle: true,
  outfile: 'dist/service-worker.js',
  format: 'esm',
  target: 'chrome120',
  minify: true,
});

// 3. Popup script — IIFE for simplicity (loaded from popup.html)
await esbuild.build({
  entryPoints: ['src/popup/popup.ts'],
  bundle: true,
  outfile: 'dist/popup/popup.js',
  format: 'iife',
  target: 'chrome120',
  minify: true,
});

// 4. Copy static assets — allowlist, not a wholesale copy. Only the
// directories PetType (src/types.ts) actually needs ship, plus icons/
// (used by manifest.json). Unlisted directories (source reference art,
// unused species, .DS_Store) are excluded by default: a new junk directory
// under assets/ never ships unless something adds it to PetType.
const assetDirs = getShippedAssetDirs();
assertAssetDirsExist(assetDirs); // fail the build rather than ship a missing sprite set
mkdirSync('dist/assets', { recursive: true });
for (const dir of assetDirs) {
  cpSync(`assets/${dir}`, `dist/assets/${dir}`, {
    recursive: true,
    filter: (src) => !src.endsWith('.DS_Store'),
  });
}
cpSync('src/popup/popup.css', 'dist/popup/popup.css');
cpSync('LICENSE', 'dist/LICENSE');

// 5. Write popup.html that references built JS (not .ts source)
const popupHtml = readFileSync('src/popup/popup.html', 'utf-8')
  .replace('<script type="module" src="popup.ts"></script>', '<script src="popup.js"></script>');
writeFileSync('dist/popup/popup.html', popupHtml);

// 6. Write manifest pointing to built paths
const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'));
// Paths are already correct in source manifest — content.js, service-worker.js, popup/popup.html
// Guard against a 3rd, unchecked copy of the pet list: web_accessible_resources
// is hand-maintained, so a pet type missing from it would still build, still
// copy its sprites, and still render in the popup — then 404 on every page,
// since MV3 blocks content-script access to resources not listed there.
assertWebAccessibleResourcesMatch(assetDirs.filter((dir) => dir !== 'icons'), manifest);
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));

console.log('✓ Build complete → dist/');

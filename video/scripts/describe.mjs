#!/usr/bin/env node
// Stage 6: the YouTube description (pets-o3p.5 step 5). Fills
// video/description.template.txt's {{CREDITS}} with a credit for exactly the
// species this run filmed (every recorded roster) plus the cells the shelter
// card's crop B shows, and {{MUSIC_CREDIT}} with only the track
// out/timeline.json names. Writes out/description.txt; fails on a leftover
// placeholder, a species with no credit, an unknown track or a missing store
// URL.
//
// Usage: npx tsx scripts/describe.mjs --run build/<run>

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, OUT_DIR, readJson, runArg, VIDEO_DIR } from './stage-io.mjs';

export const STORE_URL = 'https://chromewebstore.google.com/detail/pixel-pets/mgamneidfkkigbniedjohbglcmecjffg';

/**
 * The type-grid cells crop B of the shelter card shows (shots.json
 * s2b_shelter.crops.B_pick.shows: "the chicken, crab, panda and snail
 * cells"). They are on screen at about 128 px, so their artists are credited
 * even though only the chicken is cast.
 */
export const CROP_B_SPECIES = ['chicken', 'crab', 'panda', 'snail'];

/**
 * The music beds (video/assets/LICENSES.md), keyed by the file stem
 * timeline.json's `music` path contains.
 */
export const MUSIC_CREDITS = {
  cat_caffe: 'Music: "Cat caffe" by TAD (opengameart.org/content/lofi-compilation), CC0.',
  forgotten_path: 'Music: "forgotten path" by johndekale (opengameart.org/content/forgotten-path), CC0.',
};

/** Every species in the given rosters plus CROP_B_SPECIES, once each. */
export function creditedSpecies(rosters) {
  const set = new Set(CROP_B_SPECIES);
  for (const roster of rosters) for (const pet of roster) set.add(pet.type);
  return set;
}

const titleCase = (s) => s[0].toUpperCase() + s.slice(1);

/** The {{CREDITS}} block: one line per credited species, in CREDITS.json order. Throws when a species has no public credit. */
export function creditsBlock(credits, species) {
  const known = new Map(credits.cast.map((c) => [c.species, c]));
  const missing = [...species].filter((s) => !known.get(s)?.public_note);
  if (missing.length) throw new Error(`describe: no public credit in assets/CREDITS.json for ${missing.join(', ')}`);
  const lines = credits.cast
    .filter((c) => species.has(c.species))
    .map((c) => `- ${titleCase(c.species)}: sprites by ${c.artist} (${c.url}), ${c.licence} (${c.licence_url}). ${c.public_note}`);
  return ['Credits', 'Pet sprites, shown as Pixel Pets draws them:', ...lines].join('\n');
}

/** The one music credit for timeline.json's `music` value; throws unless exactly one known track matches. */
export function musicCredit(timelineMusic) {
  const hits = Object.keys(MUSIC_CREDITS).filter((stem) => String(timelineMusic ?? '').includes(stem));
  if (hits.length !== 1) throw new Error(`describe: timeline.json music "${timelineMusic}" names ${hits.length} known tracks (${Object.keys(MUSIC_CREDITS).join(', ')})`);
  return MUSIC_CREDITS[hits[0]];
}

/** The filled description; throws on any leftover placeholder or a missing store URL. */
export function fillDescription(template, { credits, music }) {
  const text = template.replace('{{CREDITS}}', credits).replace('{{MUSIC_CREDIT}}', music);
  const left = /\{\{|\[credits page link\]/.exec(text);
  if (left) throw new Error(`describe: "${left[0]}" is still in the description`);
  if (!text.includes(STORE_URL)) throw new Error(`describe: the store URL ${STORE_URL} is missing`);
  return text;
}

/** Every events.json roster under a run dir (16:9 shots, v916/ shots and the popup take's saved roster). */
export function runRosters(runDir) {
  const rosters = [];
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const ev = join(dir, e.name, 'events.json');
      if (existsSync(ev)) {
        const events = readJson(ev);
        rosters.push(events.roster ?? []);
        const saved = (events.observed ?? []).find((o) => o.kind === 'roster_saved');
        if (saved?.roster) rosters.push(saved.roster);
      } else visit(join(dir, e.name));
    }
  };
  visit(runDir);
  if (!rosters.length) throw new Error(`describe: no events.json under ${runDir}`);
  return rosters;
}

export function main(argv) {
  const runDir = runArg(argv);
  const credits = readJson(join(VIDEO_DIR, 'assets', 'CREDITS.json'));
  const timeline = readJson(join(OUT_DIR, 'timeline.json'));
  const template = readFileSync(join(VIDEO_DIR, 'description.template.txt'), 'utf8');
  const species = creditedSpecies(runRosters(runDir));
  const text = fillDescription(template, { credits: creditsBlock(credits, species), music: musicCredit(timeline.music) });
  writeFileSync(join(OUT_DIR, 'description.txt'), text);
  console.log(`describe: out/description.txt credits ${[...species].join(', ')}; ${musicCredit(timeline.music)}`);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

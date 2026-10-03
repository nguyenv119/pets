// describe.mjs's pure parts, on the real CREDITS.json, template and
// shots.json (no mocks: these files ARE the contract the eval reads).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { creditedSpecies, creditsBlock, CROP_B_SPECIES, fillDescription, musicCredit, musicCredits, MUSIC_CREDITS, runRosters, STORE_URL } from './describe.mjs';

const VIDEO = join(import.meta.dirname, '..');
const credits = JSON.parse(readFileSync(join(VIDEO, 'assets', 'CREDITS.json'), 'utf8'));
const template = readFileSync(join(VIDEO, 'description.template.txt'), 'utf8');
const shots = JSON.parse(readFileSync(join(VIDEO, 'shots.json'), 'utf8'));
const FILM_ROSTERS = [
  [{ type: 'dog' }, { type: 'panda' }],
  [{ type: 'dog' }, { type: 'panda' }, { type: 'chicken' }],
];

let tmp;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('creditedSpecies', () => {
  it('credits the filmed species plus every cell crop B shows', () => {
    /**
     * The description must credit exactly what is on screen: the cast from
     * the recorded rosters and the crab and snail the shelter card shows.
     * Missing the crab or snail would publish their art uncredited.
     */
    // GIVEN — the film's rosters (dog, panda, chicken)
    // WHEN
    const species = creditedSpecies(FILM_ROSTERS);
    // THEN
    expect([...species].sort()).toEqual(['chicken', 'crab', 'dog', 'panda', 'snail']);
  });

  it('names the same four cells shots.json says crop B shows', () => {
    /**
     * CROP_B_SPECIES is copied from shots.json's B_pick.shows text; if the
     * approved crop ever changes, this fails before a wrong credit ships.
     */
    // GIVEN — the approved crop B description
    const shows = shots.shots.find((s) => s.id === 's2b_shelter').crops.B_pick.shows;
    // WHEN / THEN — each credited cell is named there
    for (const s of CROP_B_SPECIES) expect(shows).toContain(s);
  });
});

describe('creditsBlock', () => {
  it('writes each artist, licence and licence URL from CREDITS.json', () => {
    /**
     * The eval requires NVPH Studio with CC BY-ND 4.0 and its licence URL,
     * and Jessie Ferris, Gulnur Baimukhambetova, Marc Duiker and Kennet
     * Shin with MIT via vscode-pets.
     */
    // GIVEN
    const species = creditedSpecies(FILM_ROSTERS);
    // WHEN
    const block = creditsBlock(credits, species);
    // THEN
    expect(block).toMatch(/NVPH Studio.*CC BY-ND 4\.0 \(https:\/\/creativecommons\.org\/licenses\/by-nd\/4\.0\/\)/);
    for (const artist of ['Jessie Ferris', 'Gulnur Baimukhambetova', 'Marc Duiker', 'Kennet Shin']) expect(block).toMatch(new RegExp(`${artist}.*MIT.*vscode-pets`));
  });

  it('throws for a filmed species with no credit', () => {
    /**
     * A new species in a roster with no CREDITS.json entry must stop the
     * stage, never publish a description that silently omits an artist.
     */
    // GIVEN — a roster with a horse
    const species = creditedSpecies([[{ type: 'horse' }]]);
    // WHEN / THEN
    expect(() => creditsBlock(credits, species)).toThrow(/horse/);
  });
});

describe('musicCredits', () => {
  it('builds each bed\'s credit from its assets/LICENSES.md row', () => {
    /**
     * LICENSES.md is the one record of each bed's title, author, licence and
     * source; a second hand-typed copy here could credit the wrong author.
     */
    // GIVEN — the committed LICENSES.md, read at import
    // WHEN / THEN
    expect(MUSIC_CREDITS).toEqual({
      funny_and_cute_town_theme: 'Music: "Funny and Cute Town Theme" by ISAo, SOUND AIRYLUVS (https://airyluvs.com/), OGA-BY 3.0 (opengameart.org/content/funny-and-cute-town-theme).',
    });
  });

  it('throws when the licence table lists no music', () => {
    /** A renamed column or path must stop the stage, not ship a description with no music credit. */
    // GIVEN / WHEN / THEN
    expect(() => musicCredits('| `video/assets/fonts/VT323-Regular.ttf` | VT323 | x | OFL | https://x |')).toThrow(/no video\/assets\/music/);
  });
});

describe('musicCredit', () => {
  it('gives the OGA-BY 3.0 track its required credit, word for word', () => {
    /**
     * OGA-BY 3.0 requires the credit; the eval greps the description for ISAo, airyluvs.com and OGA-BY 3.0,
     * and a reworded line could drop the artist's site.
     */
    // GIVEN / WHEN
    const line = musicCredit('/abs/video/assets/music/funny_and_cute_town_theme.ogg');
    // THEN
    expect(line).toContain('"Funny and Cute Town Theme" by ISAo, SOUND AIRYLUVS (https://airyluvs.com/), OGA-BY 3.0');
  });

  it('throws for an unknown track', () => {
    /** An unknown bed would ship uncredited music. */
    // GIVEN / WHEN / THEN
    expect(() => musicCredit('music/other.ogg')).toThrow(/0 known tracks/);
  });
});

describe('fillDescription', () => {
  it('fills both placeholders and keeps the store URL', () => {
    /** The finished description has no {{ left and links the store listing. */
    // GIVEN
    const filled = { credits: creditsBlock(credits, creditedSpecies(FILM_ROSTERS)), music: musicCredit('music/funny_and_cute_town_theme.ogg') };
    // WHEN
    const text = fillDescription(template, filled);
    // THEN
    expect(text).not.toContain('{{');
    expect(text).toContain(STORE_URL);
    expect(text).toMatch(/ISAo.*airyluvs\.com.*OGA-BY 3\.0/);
  });

  it('throws when a placeholder is left', () => {
    /** A template that grows a new placeholder must not ship it raw. */
    // GIVEN — a template with an extra placeholder
    // WHEN / THEN
    expect(() => fillDescription(`${template}\n{{EXTRA}}`, { credits: 'c', music: 'm' })).toThrow(/\{\{/);
  });

  it('throws when the store URL is missing', () => {
    /** The description's main job is the install link. */
    // GIVEN / WHEN / THEN
    expect(() => fillDescription('{{CREDITS}}{{MUSIC_CREDIT}}', { credits: 'c', music: 'm' })).toThrow(/store URL/);
  });
});

describe('runRosters', () => {
  it('reads every shot roster, v916 included, and the popup take\'s saved roster', () => {
    /**
     * The chicken is cast only by the adoption: if the saved roster were
     * skipped, a run whose page shots failed to seed Pip would drop her credit.
     */
    // GIVEN — a run with a page shot, a v916 shot and the popup take
    tmp = mkdtempSync(join(tmpdir(), 'describe-run-'));
    const put = (rel, events) => {
      mkdirSync(join(tmp, rel), { recursive: true });
      writeFileSync(join(tmp, rel, 'events.json'), JSON.stringify(events));
    };
    put('s1_inbox', { roster: [{ type: 'dog' }] });
    put('v916/s1_inbox', { roster: [{ type: 'dog' }] });
    put('s2b_shelter', { roster: [{ type: 'dog' }], observed: [{ kind: 'roster_saved', roster: [{ type: 'dog' }, { type: 'chicken' }] }] });
    // WHEN
    const rosters = runRosters(tmp);
    // THEN
    expect(rosters).toHaveLength(4);
    expect(rosters.flat().map((p) => p.type)).toContain('chicken');
  });
});

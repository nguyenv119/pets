import { describe, it, expect } from 'vitest';
import { COLORS } from './colors';

// ---------------------------------------------------------------------------
// COLORS registry
// ---------------------------------------------------------------------------

describe('COLORS — pet type registry', () => {
  it('contains entries for all 14 expected pet types', () => {
    /**
     * Verifies that the COLORS map has an entry for every PetType in the
     * expanded roster: chicken, crab, dog, fox, miffy, monkey, panda, snail, totoro,
     * turtle, cockatiel, rat, snake, horse.
     *
     * This matters because populateColors() indexes into COLORS by type. A
     * missing entry returns undefined, causing colorSelect to render no options
     * and blocking the Add Pet flow entirely.
     *
     * If violated, selecting a missing animal type shows an empty color dropdown
     * and the Add Pet button silently does nothing.
     */
    // GIVEN — the COLORS registry
    const expectedTypes = [
      'chicken', 'crab', 'dog', 'fox', 'miffy', 'monkey', 'panda', 'snail', 'totoro', 'turtle',
      'cockatiel', 'rat', 'snake', 'horse',
    ] as const;

    // WHEN — check every expected type
    for (const type of expectedTypes) {
      // THEN — each type has at least one color
      expect((COLORS as Record<string, string[] | undefined>)[type], `COLORS['${type}'] should be defined`).toBeDefined();
      expect((COLORS as Record<string, string[] | undefined>)[type]!.length, `COLORS['${type}'] should have at least 1 color`).toBeGreaterThan(0);
    }
  });

  it('contains entries for the 4 new pet types', () => {
    /**
     * Verifies that cockatiel, rat, snake, and horse were added to the COLORS map.
     *
     * This matters because populateColors() indexes into COLORS by type. A
     * missing entry returns undefined, causing an empty color dropdown and
     * blocking the Add Pet flow for the new animals.
     *
     * If violated, users who select a new animal type see no color options and
     * cannot complete the Add Pet form.
     */
    // GIVEN — the COLORS registry
    const newTypes = ['cockatiel', 'rat', 'snake', 'horse'] as const;

    // WHEN — check every new type
    for (const type of newTypes) {
      // THEN — each type has at least one color
      expect((COLORS as Record<string, string[] | undefined>)[type], `COLORS['${type}'] should be defined`).toBeDefined();
    }
  });

  it('cockatiel has colors brown and gray', () => {
    /**
     * Verifies the exact color list for cockatiel matches the available GIF files.
     *
     * The GIF filenames use these exact color strings. An incorrect entry would
     * resolve to a missing file, breaking the sprite for that color variant.
     *
     * If violated, one or both cockatiel colors render with broken images.
     */
    // GIVEN — the static COLORS registry
    // WHEN — look up cockatiel colors
    const colors = (COLORS as Record<string, string[]>)['cockatiel'];
    // THEN — brown and gray are the available variants
    expect(colors).toEqual(['brown', 'gray']);
  });

  it('rat has colors brown, gray, and white', () => {
    /**
     * Verifies the exact color list for rat matches the available GIF files.
     */
    // GIVEN — the static COLORS registry
    // WHEN — look up rat colors
    const colors = (COLORS as Record<string, string[]>)['rat'];
    // THEN — three variants
    expect(colors).toEqual(['brown', 'gray', 'white']);
  });

  it('snake has only color green', () => {
    /**
     * Verifies that snake is limited to its single available color (green).
     */
    // GIVEN — the static COLORS registry
    // WHEN — look up snake colors
    const colors = (COLORS as Record<string, string[]>)['snake'];
    // THEN — green is the only variant
    expect(colors).toEqual(['green']);
  });

  it('horse has all 11 color variants', () => {
    /**
     * Verifies that all 11 horse color variants are registered. Horse has the
     * largest palette in the roster including named patterns (paint_*, socks_*,
     * magical, warrior).
     *
     * Missing any variant would prevent that horse color from being selectable
     * and its GIF would never be requested despite being downloaded.
     *
     * If violated, some horse color variants are inaccessible from the UI.
     */
    // GIVEN — the static COLORS registry
    // WHEN — look up horse colors
    const colors = (COLORS as Record<string, string[]>)['horse'];
    // THEN — all 11 variants
    expect(colors).toEqual([
      'black', 'brown', 'white', 'magical', 'warrior',
      'paint_beige', 'paint_black', 'paint_brown',
      'socks_beige', 'socks_black', 'socks_brown',
    ]);
  });

  it('chicken has colors brown and white', () => {
    /**
     * Verifies the exact color list for chicken.
     *
     * This matters because the color list drives which GIF filenames are resolved.
     * An incorrect color name produces a broken image request (404) and the pet
     * renders with no sprite.
     *
     * If violated, selecting a wrong chicken color causes a missing GIF and an
     * invisible pet on screen.
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up chicken colors
    const chickenColors = COLORS.chicken;

    // THEN — brown and white are the available variants
    expect(chickenColors).toEqual(['brown', 'white']);
  });

  it('crab has only color red', () => {
    /**
     * Verifies that crab is limited to its single available color variant (red).
     *
     * If an extra color is listed, a GIF that does not exist would be requested,
     * breaking the sprite.
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up crab colors
    const crabColors = COLORS.crab;

    // THEN — red is the only variant
    expect(crabColors).toEqual(['red']);
  });

  it('dog has 5 colors: akita, black, brown, red, white', () => {
    /**
     * Verifies that the 3 new dog colors (akita, red, white) were added while
     * the original 2 (black, brown) were preserved.
     *
     * This matters because the dog roster is expanding — we must not drop the
     * existing brown/black GIFs that are already downloaded and referenced in
     * production.
     *
     * If violated, previously adopting users see missing sprites for brown or
     * black dogs on reload.
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up dog colors
    const dogColors = COLORS.dog;

    // THEN — all 5 variants present, including the 3 new ones
    expect(dogColors).toEqual(['akita', 'black', 'brown', 'red', 'white']);
  });

  it('fox retains its original colors: red and white', () => {
    /**
     * Verifies that the fox color list was not changed by this expansion.
     *
     * Fox already had red and white; these must remain intact so existing fox
     * pets do not lose their sprites.
     *
     * If violated, previously adopted fox pets show broken images.
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up fox colors
    const foxColors = COLORS.fox;

    // THEN — original red and white preserved
    expect(foxColors).toEqual(['red', 'white']);
  });

  it('monkey has only color gray', () => {
    /**
     * Verifies that monkey is limited to its single available color (gray).
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up monkey colors
    const monkeyColors = COLORS.monkey;

    // THEN — gray is the only variant
    expect(monkeyColors).toEqual(['gray']);
  });

  it('panda has colors black and brown', () => {
    /**
     * Verifies the exact color list for panda.
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up panda colors
    const pandaColors = COLORS.panda;

    // THEN — black and brown are the available variants
    expect(pandaColors).toEqual(['black', 'brown']);
  });

  it('snail has only color brown', () => {
    /**
     * Verifies that snail is limited to its single available color (brown).
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up snail colors
    const snailColors = COLORS.snail;

    // THEN — brown is the only variant
    expect(snailColors).toEqual(['brown']);
  });

  it('totoro has only color gray', () => {
    /**
     * Verifies that totoro is limited to its single available color (gray).
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up totoro colors
    const totoroColors = COLORS.totoro;

    // THEN — gray is the only variant
    expect(totoroColors).toEqual(['gray']);
  });

  it('turtle has colors green and orange', () => {
    /**
     * Verifies the exact color list for turtle.
     */
    // GIVEN — the static COLORS registry

    // WHEN — look up turtle colors
    const turtleColors = COLORS.turtle;

    // THEN — green and orange are the available variants
    expect(turtleColors).toEqual(['green', 'orange']);
  });
});

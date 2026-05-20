import { describe, it, expect } from 'vitest';
import { COLORS } from './colors';

// ---------------------------------------------------------------------------
// COLORS registry
// ---------------------------------------------------------------------------

describe('COLORS — pet type registry', () => {
  it('contains entries for all 9 expected pet types', () => {
    /**
     * Verifies that the COLORS map has an entry for every PetType in the
     * expanded roster: chicken, crab, dog, fox, monkey, panda, snail, totoro, turtle.
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
      'chicken', 'crab', 'dog', 'fox', 'monkey', 'panda', 'snail', 'totoro', 'turtle',
    ] as const;

    // WHEN — check every expected type
    for (const type of expectedTypes) {
      // THEN — each type has at least one color
      expect(COLORS[type], `COLORS['${type}'] should be defined`).toBeDefined();
      expect(COLORS[type].length, `COLORS['${type}'] should have at least 1 color`).toBeGreaterThan(0);
    }
  });

  it('does NOT contain an entry for horse', () => {
    /**
     * Verifies that horse has been removed from the COLORS map as part of the
     * roster update.
     *
     * This matters because leftover keys for removed animals would cause TypeScript
     * to complain about surplus properties and could confuse future maintainers
     * about which types are canonical.
     *
     * If violated, horse still appears as an option (or as a dead key) in the map,
     * cluttering the codebase with orphaned data.
     */
    // GIVEN — the COLORS registry
    // WHEN — look up horse
    // THEN — horse is not present
    expect((COLORS as Record<string, string[] | undefined>)['horse']).toBeUndefined();
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

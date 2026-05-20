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
    // GIVEN / WHEN / THEN
    expect(COLORS.chicken).toEqual(['brown', 'white']);
  });

  it('crab has only color red', () => {
    /**
     * Verifies that crab is limited to its single available color variant (red).
     *
     * If an extra color is listed, a GIF that does not exist would be requested,
     * breaking the sprite.
     */
    // GIVEN / WHEN / THEN
    expect(COLORS.crab).toEqual(['red']);
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
    // GIVEN / WHEN / THEN
    expect(COLORS.dog).toEqual(['akita', 'black', 'brown', 'red', 'white']);
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
    // GIVEN / WHEN / THEN
    expect(COLORS.fox).toEqual(['red', 'white']);
  });

  it('monkey has only color gray', () => {
    /**
     * Verifies that monkey is limited to its single available color (gray).
     */
    // GIVEN / WHEN / THEN
    expect(COLORS.monkey).toEqual(['gray']);
  });

  it('panda has colors black and brown', () => {
    /**
     * Verifies the exact color list for panda.
     */
    // GIVEN / WHEN / THEN
    expect(COLORS.panda).toEqual(['black', 'brown']);
  });

  it('snail has only color brown', () => {
    /**
     * Verifies that snail is limited to its single available color (brown).
     */
    // GIVEN / WHEN / THEN
    expect(COLORS.snail).toEqual(['brown']);
  });

  it('totoro has only color gray', () => {
    /**
     * Verifies that totoro is limited to its single available color (gray).
     */
    // GIVEN / WHEN / THEN
    expect(COLORS.totoro).toEqual(['gray']);
  });

  it('turtle has colors green and orange', () => {
    /**
     * Verifies the exact color list for turtle.
     */
    // GIVEN / WHEN / THEN
    expect(COLORS.turtle).toEqual(['green', 'orange']);
  });
});

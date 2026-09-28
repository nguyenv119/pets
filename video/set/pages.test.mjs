// Unit tests for check-rules.mjs, the pure geometry/font helpers behind
// check-pages.mjs (the real-acceptance page checker, which needs a real
// browser and is not unit-tested here — see the README for how to run it).

import { describe, expect, it } from 'vitest';
import {
  BAND,
  BOTTOM_ZONE,
  NARROW_TEXT_LIMIT,
  findBandViolation,
  findBottomZoneViolation,
  findNarrowTextOverflow,
  firstFontFamily,
  gridPoints,
  isFontAllowed,
  isInteractiveDescriptor,
  rectsOverlap,
} from './check-rules.mjs';

describe('rectsOverlap', () => {
  it('reports overlap when a rect spans into the zone from above', () => {
    /**
     * Verifies the half-open interval overlap test that every band/zone
     * check in check-pages.mjs is built on.
     *
     * This matters because a text rect that merely touches a forbidden
     * band's edge (e.g. bottom === top) must NOT count as a violation, or
     * every page would false-fail on adjacent, legal text.
     *
     * If this contract breaks, the checker either misses real violations
     * (a rect that truly crosses the band reported as clean) or false-fails
     * innocent pages, blocking every future page edit on the bead's gate.
     */
    // GIVEN — a rect from y 280 to y 290, and a zone 286-302
    // WHEN — checking overlap
    const overlaps = rectsOverlap(280, 290, 286, 302);
    // THEN — they overlap (290 > 286 and 280 < 302)
    expect(overlaps).toBe(true);
  });

  it('reports no overlap when a rect ends exactly at the zone start', () => {
    // GIVEN — a rect ending exactly where the zone begins
    // WHEN — checking overlap
    const overlaps = rectsOverlap(270, 286, 286, 302);
    // THEN — a touching edge is not a crossing
    expect(overlaps).toBe(false);
  });
});

describe('firstFontFamily', () => {
  it('extracts the first family from a quoted CSS font-family stack', () => {
    /**
     * Verifies that only the first, actually-painted font in a computed
     * `font-family` stack is checked against a page's declared font list.
     *
     * This matters because every page inherits a fallback stack like
     * `"Inter", sans-serif` from base.css; checking the whole string
     * against an allow-list of bare names would false-fail every page.
     *
     * If this contract breaks, isFontAllowed rejects legitimate text or
     * silently accepts a real regression (a system-font fallback actually
     * being painted), because it stopped reading the string correctly.
     */
    // GIVEN — a computed font-family stack with quotes and a fallback
    // WHEN — extracting the first family
    const family = firstFontFamily('"Source Serif 4", serif');
    // THEN — quotes are stripped and the fallback is dropped
    expect(family).toBe('Source Serif 4');
  });

  it('returns an empty string for an empty or missing value', () => {
    // GIVEN — no computed value
    // WHEN — extracting the first family
    const family = firstFontFamily('');
    // THEN — no crash, just an empty result
    expect(family).toBe('');
  });
});

describe('isFontAllowed', () => {
  it('accepts a family that is in the page\'s allowed list', () => {
    // GIVEN — the review page's allowed fonts
    // WHEN — checking a JetBrains Mono diff line
    const allowed = isFontAllowed('"JetBrains Mono", monospace', ['Inter', 'JetBrains Mono']);
    // THEN — it is allowed
    expect(allowed).toBe(true);
  });

  it('rejects a family that is outside the page\'s allowed list', () => {
    /**
     * Verifies the checker's core defence against an unbundled or
     * misspelled font slipping onto a page.
     *
     * This matters because a page that silently falls back to a system
     * font would shift every measured layout (the empty double-click
     * zone, the text-free bands) by an unknown, machine-dependent amount.
     *
     * If this contract breaks, check-pages.mjs stops catching the round-2
     * FAIL control (a misspelled @font-face family), and a real font
     * regression ships unnoticed.
     */
    // GIVEN — a family not in the sheet page's allowed list
    // WHEN — checking it
    const allowed = isFontAllowed('Arial, sans-serif', ['Inter']);
    // THEN — it is rejected
    expect(allowed).toBe(false);
  });
});

describe('findBandViolation', () => {
  it('flags ordinary text that crosses the 286-302 band', () => {
    // GIVEN — a rect crossing the band, not exempt
    // WHEN — checking for a violation
    const violation = findBandViolation({ top: 280, bottom: 295 }, false);
    // THEN — it is flagged
    expect(violation).toBe(true);
  });

  it('does not flag an exempt full-height container that crosses the band', () => {
    /**
     * Verifies the page_rules exception: the inbox list, the review tree
     * and diff panels, and the sheet's empty rows may cross y 286-302
     * because they are full-height containers, not lines of copy that a
     * 2.0x crop would cut mid-sentence.
     *
     * This matters because without the exemption, every page with a
     * full-height list (all four set pages) would permanently fail this
     * check, masking real caption/copy violations under noise.
     *
     * If this contract breaks, either a real violation in the tree/diff/
     * empty-rows region goes unnoticed (exemption too broad) or the
     * checker never passes a real page (exemption not applied).
     */
    // GIVEN — the same crossing rect, but marked exempt
    // WHEN — checking for a violation
    const violation = findBandViolation({ top: 280, bottom: 295 }, true);
    // THEN — it is not flagged
    expect(violation).toBe(false);
  });

  it('does not flag text entirely above the band', () => {
    // GIVEN — a rect well above the band
    // WHEN — checking for a violation
    const violation = findBandViolation({ top: 200, bottom: 220 }, false);
    // THEN — no violation
    expect(violation).toBe(false);
  });
});

describe('findBottomZoneViolation', () => {
  it('flags text in the wide-layout bottom-200 zone', () => {
    // GIVEN — a rect at y 400 in the wide layout
    // WHEN — checking for a violation
    const violation = findBottomZoneViolation({ top: 400, bottom: 415 }, 'wide', false);
    // THEN — it is flagged
    expect(violation).toBe(true);
  });

  it('does not flag the exempt inbox end note in the bottom zone', () => {
    // GIVEN — the end note's rect, marked exempt
    // WHEN — checking for a violation
    const violation = findBottomZoneViolation({ top: 318, bottom: 334 }, 'wide', true);
    // THEN — the one named exception holds
    expect(violation).toBe(false);
  });

  it('uses the narrow-layout zone (y 530-730) when the layout is narrow', () => {
    /**
     * Verifies that the bottom-200 check uses a DIFFERENT zone for the
     * narrow 9:16 layout (y 530-730) than the wide 16:9 layout (y 340-540),
     * since the two layouts use different viewport heights.
     *
     * This matters because a rect at y 400 is deep in the wide layout's
     * forbidden zone but well above the narrow layout's — using the wrong
     * zone would either miss real narrow-layout violations or false-fail
     * ordinary wide-layout content re-checked under the narrow rule.
     *
     * If this contract breaks, one of the two layouts stops being checked
     * for its actual filming rule.
     */
    // GIVEN — a rect at y 400, which is clear of the narrow zone
    // WHEN — checking it against the narrow layout
    const violation = findBottomZoneViolation({ top: 400, bottom: 415 }, 'narrow', false);
    // THEN — no violation (y 400 is above narrow's y 530 floor)
    expect(violation).toBe(false);
  });
});

describe('findNarrowTextOverflow', () => {
  it('flags narrow-layout text that extends below y357', () => {
    // GIVEN — a rect ending at y 360 in the narrow layout
    // WHEN — checking for overflow
    const violation = findNarrowTextOverflow({ top: 340, bottom: 360 }, 'narrow', false);
    // THEN — it is flagged
    expect(violation).toBe(true);
  });

  it('never flags the wide layout, regardless of position', () => {
    // GIVEN — the same low rect, but in the wide layout
    // WHEN — checking for overflow
    const violation = findNarrowTextOverflow({ top: 340, bottom: 360 }, 'wide', false);
    // THEN — the y357 rule is narrow-only
    expect(violation).toBe(false);
  });
});

describe('gridPoints', () => {
  it('covers the full width and the whole zone height at the given step', () => {
    /**
     * Verifies the interactive-element sweep's coverage: every 20 px cell
     * of the bottom-200 zone gets a sample point, so a stray control
     * anywhere in the zone is caught, not just at its exact centre.
     *
     * This matters because the round-2 FAIL control places a bare <a> at
     * one specific point (y 500) on the inbox; a sparser or misaligned
     * grid could step over it entirely.
     *
     * If this contract breaks, the sweep silently loses coverage and a
     * real interactive element in the zone ships undetected.
     */
    // GIVEN — a 40 px wide zone from y 340 to y 380, at a 20 px step
    // WHEN — generating the grid
    const points = gridPoints(40, 340, 380, 20);
    // THEN — every combination of x in {0, 20} and y in {340, 360} appears
    expect(points).toEqual([
      { x: 0, y: 340 },
      { x: 20, y: 340 },
      { x: 0, y: 360 },
      { x: 20, y: 360 },
    ]);
  });
});

describe('isInteractiveDescriptor', () => {
  it('flags an anchor tag', () => {
    /**
     * Verifies the checker recognizes a plain <a> as interactive — the
     * exact shape of the round-2 FAIL control (`<a href="#">x</a>` at
     * y 500 on inbox.html).
     *
     * This matters because it is the one class of element the bottom-200
     * zone must never contain; missing it defeats the whole check.
     *
     * If this contract breaks, the FAIL control silently passes, meaning
     * a real stray link in the zone would also pass.
     */
    // GIVEN — an anchor descriptor
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'A', role: null, tabIndex: -1, hasOnClick: false });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it('flags an element with an explicit interactive role', () => {
    // GIVEN — a div acting as a button via ARIA
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: 'button', tabIndex: -1, hasOnClick: false });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it('does not flag a plain, decorative div', () => {
    // GIVEN — an inert div (e.g. the empty double-click zone)
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: null, tabIndex: -1, hasOnClick: false });
    // THEN — it is not interactive
    expect(interactive).toBe(false);
  });
});

describe('constants', () => {
  it('keeps the band, bottom-zone and narrow-text-limit values page_rules names', () => {
    /**
     * Verifies these constants have not drifted from video/shots.json's
     * page_rules, since every check above is only as correct as the
     * numbers it is built on.
     *
     * If this contract breaks, every band/zone test above still passes
     * (they test the logic, not these exact numbers), but check-pages.mjs
     * would enforce the wrong rule against the real approved spec.
     */
    // GIVEN/WHEN — the exported constants
    // THEN — they match video/shots.json's page_rules
    expect(BAND).toEqual({ top: 286, bottom: 302 });
    expect(BOTTOM_ZONE).toEqual({ wide: { top: 340, bottom: 540 }, narrow: { top: 530, bottom: 730 } });
    expect(NARROW_TEXT_LIMIT).toBe(357);
  });
});

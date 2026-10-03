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
    /**
     * Verifies the overlap test's half-open boundary: a rect that ends
     * exactly where a forbidden zone begins is touching, not crossing.
     *
     * This matters because every band/zone check in check-pages.mjs is
     * built on this test; if a touching edge counted as an overlap, text
     * that legally sits right above a band would fail the check.
     *
     * If this contract breaks, innocent text adjacent to a band or zone
     * boundary starts false-failing every page that has any.
     */
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
    /**
     * Verifies firstFontFamily degrades gracefully on empty input instead
     * of throwing.
     *
     * This matters because getComputedStyle can return an empty
     * font-family string for an element with no resolved style; the
     * checker must not crash mid-sweep on that case.
     *
     * If this contract breaks, check-pages.mjs throws on a page with any
     * such element instead of reporting a clean or failed check.
     */
    // GIVEN — no computed value
    // WHEN — extracting the first family
    const family = firstFontFamily('');
    // THEN — no crash, just an empty result
    expect(family).toBe('');
  });
});

describe('isFontAllowed', () => {
  it('accepts a family that is in the page\'s allowed list', () => {
    /**
     * Verifies the happy path: a font the page actually declares (and
     * bundles under video/set/fonts) passes the check.
     *
     * This matters because isFontAllowed gates every text node on every
     * page; if a legitimately declared font were rejected, no real page
     * could ever pass check-pages.mjs.
     *
     * If this contract breaks, every set page permanently fails the font
     * check regardless of what it actually renders.
     */
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
    /**
     * Verifies the base case: non-exempt text that overlaps the crop-line
     * band is flagged.
     *
     * This matters because the band exists precisely to keep the 2.0x
     * crop from cutting a line of copy mid-sentence in the final edit.
     *
     * If this contract breaks, a real caption/copy violation ships
     * unnoticed into the recorded takes.
     */
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
    /**
     * Verifies ordinary, well-clear text is left alone.
     *
     * This matters because most text on every set page sits above the
     * band; if the check were too eager, the false-positive rate would
     * make the gate useless.
     *
     * If this contract breaks, every page fails the band check even with
     * no real violation, hiding genuine failures in noise.
     */
    // GIVEN — a rect well above the band
    // WHEN — checking for a violation
    const violation = findBandViolation({ top: 200, bottom: 220 }, false);
    // THEN — no violation
    expect(violation).toBe(false);
  });
});

describe('findBottomZoneViolation', () => {
  it('flags text in the wide-layout bottom-200 zone', () => {
    /**
     * Verifies the base case: non-exempt text inside the wide layout's
     * bottom-200 zone (y 340-540) is flagged.
     *
     * This matters because that zone is where the pets stand and walk;
     * any text there would visually collide with a pet or get walked
     * over in the recording.
     *
     * If this contract breaks, a real layout regression that puts text
     * under the pets ships unnoticed.
     */
    // GIVEN — a rect at y 400 in the wide layout
    // WHEN — checking for a violation
    const violation = findBottomZoneViolation({ top: 400, bottom: 415 }, 'wide', false);
    // THEN — it is flagged
    expect(violation).toBe(true);
  });

  it('does not flag the exempt inbox end note in the bottom zone', () => {
    /**
     * Verifies the single named exception in page_rules: the inbox's
     * "#end-note" is allowed to sit inside the otherwise-forbidden
     * bottom-200 zone.
     *
     * This matters because storyboard-final.md's inbox design places
     * "That's everything for today." at y 318-334, inside the zone by
     * design; without the exemption the inbox page could never pass.
     *
     * If this contract breaks, either the inbox permanently fails (the
     * exemption is missing) or a real stray element hides behind a too-
     * broad exemption.
     */
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
    /**
     * Verifies the base case: non-exempt narrow-layout text that runs
     * past the y 357 crop line is flagged.
     *
     * This matters because the 9:16 re-record's 2.0x crop begins at
     * y 357; text below it would be cut off mid-line in the vertical
     * cut.
     *
     * If this contract breaks, a real narrow-layout overflow ships
     * unnoticed and shows truncated text in the 9:16 deliverable.
     */
    // GIVEN — a rect ending at y 360 in the narrow layout
    // WHEN — checking for overflow
    const violation = findNarrowTextOverflow({ top: 340, bottom: 360 }, 'narrow', false);
    // THEN — it is flagged
    expect(violation).toBe(true);
  });

  it('never flags the wide layout, regardless of position', () => {
    /**
     * Verifies the y357 overflow rule is scoped to the narrow layout
     * only; the wide layout has no such limit (it uses the band and
     * bottom-zone rules instead).
     *
     * This matters because the wide layout legally has text near the
     * bottom (e.g. inbox rows); applying the narrow rule there would
     * false-fail the wide layout on ordinary content.
     *
     * If this contract breaks, the wide-layout checks start rejecting
     * legitimate pages for a rule that was never meant to apply to them.
     */
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
    /**
     * Verifies a non-native interactive widget (a div with role="button")
     * is caught, not just native tags like <a>/<button>.
     *
     * This matters because a hand-rolled control on a set page (e.g. a
     * div styled to look clickable) is just as disruptive in the
     * bottom-200 zone as a real <a>, but a tag-only check would miss it.
     *
     * If this contract breaks, an ARIA-widget regression in that zone
     * ships undetected.
     */
    // GIVEN — a div acting as a button via ARIA
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: 'button', tabIndex: -1, hasOnClick: false });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it('flags an element with tabindex="0"', () => {
    /**
     * Verifies the tabIndex >= 0 branch: an element made keyboard-focusable
     * (tabindex="0") counts as interactive even with no matching tag or role.
     *
     * This matters because a focusable element is reachable and operable
     * by a keyboard user regardless of its tag, so it is exactly the kind
     * of stray control the bottom-200 sweep exists to catch.
     *
     * If this contract breaks, a keyboard-focusable element planted in the
     * zone (e.g. a styled div with tabindex="0") passes the checker
     * undetected.
     */
    // GIVEN — a div made focusable via tabindex="0"
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: null, tabIndex: 0, hasOnClick: false });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it('flags an element with an inline onclick handler', () => {
    /**
     * Verifies the hasOnClick branch: an element wired up with an inline
     * onclick handler counts as interactive even with no matching tag,
     * role, or tabindex.
     *
     * This matters because an onclick handler makes an element clickable
     * regardless of its semantic tag — a plain div with onclick behaves
     * like a button to the person watching, even though it isn't one.
     *
     * If this contract breaks, a clickable div planted in the bottom-200
     * zone via onclick passes the checker undetected.
     */
    // GIVEN — a div with an inline onclick handler
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: null, tabIndex: -1, hasOnClick: true });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it('does not flag a plain, decorative div', () => {
    /**
     * Verifies the negative case combining all four signals: a tag
     * outside INTERACTIVE_TAGS, no interactive role, a negative tabIndex,
     * and no onclick handler together produce "not interactive".
     *
     * This matters because review's div#dbl-zone is exactly this shape
     * (an empty, transparent, user-select:none box) and must be able to
     * sit inside the bottom-200 zone without failing the sweep.
     *
     * If this contract breaks, every page with a decorative, non-focusable
     * div in that zone (dbl-zone included) permanently fails the check.
     */
    // GIVEN — an inert div (e.g. the empty double-click zone)
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: null, tabIndex: -1, hasOnClick: false });
    // THEN — it is not interactive
    expect(interactive).toBe(false);
  });

  it('does not flag an element at the tabIndex boundary (tabIndex -1)', () => {
    /**
     * Verifies the exact boundary of the tabIndex >= 0 branch: a negative
     * tabIndex (programmatically focusable only, e.g. tabindex="-1") is
     * NOT flagged, isolating this from the "no signals at all" case above.
     *
     * This matters because tabindex="-1" is a common, intentional pattern
     * for elements that must be focusable via script but never part of
     * the normal tab order or a filming hazard; treating it the same as
     * tabindex="0" would false-flag legitimate set-page markup.
     *
     * If this contract breaks, the >= 0 comparison silently becomes >,
     * or the boundary check regresses to > -1, and the checker starts
     * false-failing pages with tabindex="-1" elements in the zone.
     */
    // GIVEN — an element focusable only via script (tabIndex -1), no other signal
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

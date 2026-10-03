// Unit tests for check-rules.mjs, the pure geometry/font helpers behind
// check-pages.mjs (the real-acceptance page checker, which needs a real
// browser and is not unit-tested here — see the README for how to run it).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_ZONE_PX,
  deriveRules,
  findBottomZoneViolation,
  findStraddleViolation,
  firstFontFamily,
  gridPoints,
  isFontAllowed,
  isInteractiveDescriptor,
  rectsOverlap,
} from './check-rules.mjs';

// The real shot contract, so every rule test below runs against the numbers
// check-pages.mjs actually enforces.
const SHOTS = JSON.parse(readFileSync(new URL('../shots.json', import.meta.url), 'utf-8'));
const { straddleY, bottomZone } = deriveRules(SHOTS);

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
    // GIVEN — a rect from y 280 to y 290, and the wide bottom zone 286-436
    // WHEN — checking overlap
    const overlaps = rectsOverlap(280, 290, 286, 436);
    // THEN — they overlap (290 > 286 and 280 < 436)
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
    // GIVEN — a rect ending exactly where the wide bottom zone (286-436) begins
    // WHEN — checking overlap
    const overlaps = rectsOverlap(270, 286, 286, 436);
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
     * If this contract breaks, check-pages.mjs stops catching a misspelled
     * or unbundled @font-face family, and a real font regression ships
     * unnoticed. (Its `--control` run only plants a straddling row, so
     * this test is the font check's FAIL control.)
     */
    // GIVEN — a family not in the sheet page's allowed list
    // WHEN — checking it
    const allowed = isFontAllowed('Arial, sans-serif', ['Inter']);
    // THEN — it is rejected
    expect(allowed).toBe(false);
  });
});

describe('findStraddleViolation', () => {
  it('flags wide-layout text whose box crosses y 166', () => {
    /**
     * Verifies the v2 crop-line rule: the top edge of every 2.0x hold in
     * the master is page CSS y 166, so a text box that straddles it would
     * be cut mid-glyph in the zoomed shot.
     *
     * This matters because the v2 pages put row edges exactly on y 166
     * instead of keeping a guard band, so the check must be exact.
     *
     * If this contract breaks, a half-cut line of copy ships in every
     * 2.0x hold of that page.
     */
    // GIVEN — a wide-layout text box from y 158 to y 172
    // WHEN — checking it against the wide crop line
    const violation = findStraddleViolation({ top: 158, bottom: 172 }, straddleY.wide);
    // THEN — it straddles y 166
    expect(violation).toBe(true);
  });

  it('does not flag text that ends exactly on the crop line', () => {
    /**
     * Verifies the boundary: a box whose bottom edge is y 166 touches the
     * crop line but is not cut by it.
     *
     * This matters because inbox rows, review diff rows and sheet rows all
     * have an edge on y 166; a text box flush with that edge is legal.
     *
     * If this contract breaks, every v2 page false-fails on its row grid.
     */
    // GIVEN — a box from y 150 to exactly y 166
    // WHEN — checking it in the wide layout
    const violation = findStraddleViolation({ top: 150, bottom: 166 }, straddleY.wide);
    // THEN — touching is not straddling
    expect(violation).toBe(false);
  });

  it('uses y 376 for the narrow layout, not y 166', () => {
    /**
     * Verifies the narrow (540x856, 9:16) layout is judged at its own crop
     * line: the 2.0x crop there begins at page CSS y 376.
     *
     * This matters because a box across y 166 is legal in the narrow
     * layout and a box across y 376 is not; using the wrong line would
     * miss real 9:16 cuts and false-fail ordinary narrow content.
     *
     * If this contract breaks, the 9:16 cut can show half-cut text.
     */
    // GIVEN — one box across y 166 and one across y 376
    // WHEN — checking both in the narrow layout
    const at166 = findStraddleViolation({ top: 158, bottom: 172 }, straddleY.narrow);
    const at376 = findStraddleViolation({ top: 370, bottom: 384 }, straddleY.narrow);
    // THEN — only the y 376 box fails
    expect(at166).toBe(false);
    expect(at376).toBe(true);
  });

  it('does not flag boxes that start or end exactly on either crop line', () => {
    /**
     * Verifies both edges of the strict straddle test in both layouts: a
     * box starting on the line (top === line) or ending on it
     * (bottom === line) is flush with the crop, not cut by it.
     *
     * This matters because v2 rows are laid out with edges exactly on
     * y 166 (wide) and y 376 (narrow), so text below the line starts there
     * and text above it ends there.
     *
     * If this contract breaks (a < becomes <=), every page false-fails on
     * the row that sits flush under or over the crop line.
     */
    // GIVEN — a wide box starting on y 166, narrow boxes ending and starting on y 376
    // WHEN — checking each against its layout's line
    // THEN — none straddle
    expect(findStraddleViolation({ top: 166, bottom: 180 }, straddleY.wide)).toBe(false);
    expect(findStraddleViolation({ top: 360, bottom: 376 }, straddleY.narrow)).toBe(false);
    expect(findStraddleViolation({ top: 376, bottom: 390 }, straddleY.narrow)).toBe(false);
  });
});

describe('missing rule', () => {
  it('throws instead of silently passing when a line or zone is missing', () => {
    /**
     * Verifies both rule helpers refuse an undefined line or zone (e.g.
     * a misspelt layout key like straddleY.narow).
     *
     * This matters because `rect.top < undefined` is false, so a missing
     * line would otherwise report every box as clean.
     *
     * If this contract breaks, a typo disables the page rules without
     * any failure.
     */
    // GIVEN — a missing line and a missing zone
    // WHEN/THEN — both helpers throw
    expect(() => findStraddleViolation({ top: 0, bottom: 10 }, straddleY.narow)).toThrow(/crop line/);
    expect(() => findBottomZoneViolation({ top: 0, bottom: 10 }, bottomZone.narow)).toThrow(/bottom zone/);
  });
});

describe('findBottomZoneViolation', () => {
  it('flags text in the wide-layout bottom-150 zone (y 286-436)', () => {
    /**
     * Verifies the base case: text inside the bottom 150 CSS px of the
     * 960x436 viewport is flagged.
     *
     * This matters because that zone is where the pets stand and walk;
     * text there collides with a pet in the recording.
     *
     * If this contract breaks, text under the pets ships unnoticed.
     */
    // GIVEN — a text box at y 300 in the wide layout
    // WHEN — checking it
    const violation = findBottomZoneViolation({ top: 300, bottom: 315 }, bottomZone.wide);
    // THEN — it is flagged
    expect(violation).toBe(true);
  });

  it('does not flag wide text ending exactly at y 286', () => {
    /**
     * Verifies the zone's top boundary is half-open: a box ending at y 286
     * touches the zone without entering it.
     *
     * This matters because the lowest legal content may sit flush with the
     * zone edge.
     *
     * If this contract breaks, legal content at the zone edge false-fails.
     */
    // GIVEN — a box from y 270 to y 286
    // WHEN — checking it in the wide layout
    const violation = findBottomZoneViolation({ top: 270, bottom: 286 }, bottomZone.wide);
    // THEN — no violation
    expect(violation).toBe(false);
  });

  it('uses the narrow-layout zone (y 706-856) when the layout is narrow', () => {
    /**
     * Verifies the narrow 540x856 layout is checked against its own bottom
     * 150 px, not the wide layout's.
     *
     * This matters because y 300 is deep in the wide zone but ordinary
     * content in the narrow layout, and y 720 is the reverse.
     *
     * If this contract breaks, one layout stops being checked for its
     * real filming rule.
     */
    // GIVEN — boxes at y 300 and y 720
    // WHEN — checking both in the narrow layout
    const at300 = findBottomZoneViolation({ top: 300, bottom: 315 }, bottomZone.narrow);
    const at720 = findBottomZoneViolation({ top: 720, bottom: 735 }, bottomZone.narrow);
    // THEN — only y 720 fails
    expect(at300).toBe(false);
    expect(at720).toBe(true);
  });

  it('judges the zone edges exactly in both layouts', () => {
    /**
     * Verifies the zone's top edge at the real derived values: a box that
     * crosses into the zone by any amount is flagged, a box ending on the
     * edge is not.
     *
     * This matters because the lowest legal row on each page sits just
     * above y 286 (wide) or y 706 (narrow); an off-by-one in the zone
     * would either pass text under the pets or fail that row.
     *
     * If this contract breaks, the bottom-150 rule is enforced a few px
     * off from the filming rule.
     */
    // GIVEN — boxes across or flush with y 706 (narrow) and across y 286 (wide)
    // WHEN — checking each against its layout's zone
    // THEN — crossing is flagged, flush is not
    expect(findBottomZoneViolation({ top: 700, bottom: 712 }, bottomZone.narrow)).toBe(true);
    expect(findBottomZoneViolation({ top: 690, bottom: 706 }, bottomZone.narrow)).toBe(false);
    expect(findBottomZoneViolation({ top: 280, bottom: 290 }, bottomZone.wide)).toBe(true);
  });
});

describe('gridPoints', () => {
  it('covers the full width and the whole zone height at the given step', () => {
    /**
     * Verifies the interactive-element sweep's coverage: every 20 px cell
     * of the bottom-150 zone gets a sample point, so a stray control
     * anywhere in the zone is caught, not just at its exact centre.
     *
     * This matters because a stray control can be small and sit anywhere
     * in the zone; a sparser or misaligned grid could step over it.
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

  it('stops before the width when it is not a multiple of the step', () => {
    /**
     * Verifies the x loop is half-open on a width that is not a multiple
     * of the step: width 50 gives x 0, 20, 40 and never x 60.
     *
     * This matters because a point past the right edge makes
     * elementFromPoint return null and silently wastes a sample.
     *
     * If this contract breaks, the sweep samples off-page points.
     */
    // GIVEN — a 50 px wide, one-row zone at a 20 px step
    // WHEN — generating the grid
    const xs = gridPoints(50, 0, 20, 20).map((p) => p.x);
    // THEN — x stops at 40
    expect(xs).toEqual([0, 20, 40]);
  });
});

describe('isInteractiveDescriptor', () => {
  it('flags an anchor tag', () => {
    /**
     * Verifies the checker recognizes a plain <a> as interactive.
     *
     * This matters because a link is the most likely stray control on a
     * set page; missing it defeats the bottom-150 sweep. check-pages.mjs's
     * `--control` run only plants a straddling text row, so this test is
     * the sweep's FAIL control.
     *
     * If this contract breaks, a real stray link in the zone passes.
     */
    // GIVEN — an anchor descriptor
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'A', role: null, tabIndex: -1, hasOnClick: false });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it.each(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])('flags a native <%s>', (tagName) => {
    /**
     * Verifies every native form-control tag in INTERACTIVE_TAGS is
     * caught on the tag alone, with no role, tabindex or handler.
     *
     * This matters because each tag is a separate set entry; a typo in
     * one would leave that control undetected in the bottom-150 zone.
     *
     * If this contract breaks, that kind of control ships under the pets.
     */
    // GIVEN — a bare native control descriptor
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName, role: null, tabIndex: -1, hasOnClick: false });
    // THEN — it is interactive
    expect(interactive).toBe(true);
  });

  it('does not flag role="presentation"', () => {
    /**
     * Verifies a role outside INTERACTIVE_ROLES does not count: having a
     * role is not the same as being a control.
     *
     * This matters because layout markup often carries non-widget roles
     * (presentation, none, img) and must be allowed in the zone.
     *
     * If this contract breaks, any element with a role false-fails.
     */
    // GIVEN — a div with role="presentation" and no other signal
    // WHEN — checking interactivity
    const interactive = isInteractiveDescriptor({ tagName: 'DIV', role: 'presentation', tabIndex: -1, hasOnClick: false });
    // THEN — it is not interactive
    expect(interactive).toBe(false);
  });

  it('flags an element with an explicit interactive role', () => {
    /**
     * Verifies a non-native interactive widget (a div with role="button")
     * is caught, not just native tags like <a>/<button>.
     *
     * This matters because a hand-rolled control on a set page (e.g. a
     * div styled to look clickable) is just as disruptive in the
     * bottom-150 zone as a real <a>, but a tag-only check would miss it.
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
     * of stray control the bottom-150 sweep exists to catch.
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
     * If this contract breaks, a clickable div planted in the bottom-150
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
     * sit inside the bottom-150 zone without failing the sweep.
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
});

describe('deriveRules', () => {
  it('derives the crop lines and bottom zones page_rules names from shots.json', () => {
    /**
     * Verifies the rules check-pages.mjs enforces come out of the real
     * shots.json numbers as page_rules states them (crop line y 166 wide /
     * y 376 narrow; bottom 150 px y 286-436 / y 706-856), and that the
     * page_rules prose still quotes the same crop lines.
     *
     * This matters because the numbers (viewport and canvas heights) and
     * the prose live side by side in shots.json; if one changes without
     * the other, the checker and the written rule disagree.
     *
     * If this contract breaks, check-pages.mjs enforces a rule the spec
     * no longer states (or the spec states one nothing enforces).
     */
    // GIVEN — the real video/shots.json
    // WHEN — deriving the rules
    // THEN — the numbers match page_rules, and the prose names both lines
    expect(straddleY).toEqual({ wide: 166, narrow: 376 });
    expect(bottomZone).toEqual({ wide: { top: 286, bottom: 436 }, narrow: { top: 706, bottom: 856 } });
    expect(BOTTOM_ZONE_PX).toBe(150);
    const prose = SHOTS.page_rules.join('\n');
    expect(prose).toMatch(/\by 166\b/);
    expect(prose).toMatch(/\by 376\b/);
    expect(prose).toMatch(/Bottom 150 CSS px/);
  });

  it('throws when shots.json is missing a height', () => {
    /**
     * Verifies deriveRules refuses a contract with no narrow canvas height
     * instead of producing NaN lines.
     *
     * This matters because a NaN crop line compares false against every
     * box, so the checker would pass everything.
     *
     * If this contract breaks, a shots.json edit can disable the rules.
     */
    // GIVEN — shots.json with the 9:16 canvas removed
    const broken = structuredClone(SHOTS);
    delete broken.variants.vertical_9x16.canvas;
    // WHEN/THEN — deriving throws
    expect(() => deriveRules(broken)).toThrow();
  });
});

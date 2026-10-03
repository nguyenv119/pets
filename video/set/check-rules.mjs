// Pure geometry/font helpers for check-pages.mjs, factored out so they can
// be unit-tested without a real browser (see pages.test.mjs). Every function
// here takes plain data (numbers, strings) and returns plain data — no DOM,
// no Playwright.

// The top edge of a 2.0x hold, in page CSS y: 166 in the wide 960x436
// layout, 376 in the narrow 540x856 layout (video/shots.json page_rules).
// No text box may straddle it.
export const STRADDLE_Y = { wide: 166, narrow: 376 };

// The bottom 150 CSS px of each viewport, where the pets stand: no text and
// nothing interactive (review's empty div#dbl-zone is the one exception).
export const BOTTOM_ZONE = {
  wide: { top: 286, bottom: 436 },
  narrow: { top: 706, bottom: 856 },
};

/**
 * True if the closed interval [rectTop, rectBottom) overlaps
 * [zoneTop, zoneBottom).
 */
export function rectsOverlap(rectTop, rectBottom, zoneTop, zoneBottom) {
  return rectTop < zoneBottom && rectBottom > zoneTop;
}

/**
 * The first font name in a CSS `font-family` value (a comma-separated
 * stack), with surrounding quotes stripped. This is what a page's
 * declared "fonts" list is checked against: the family actually painted,
 * not the whole fallback stack.
 */
export function firstFontFamily(computedFontFamily) {
  const first = (computedFontFamily ?? '').split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

/** True if a computed font-family's first font is in the page's allowed list. */
export function isFontAllowed(computedFontFamily, allowedFamilies) {
  return allowedFamilies.includes(firstFontFamily(computedFontFamily));
}

/** True if a text rect is cut by `layout`'s 2.0x crop line (touching it is fine). */
export function findStraddleViolation(rect, layout) {
  const y = STRADDLE_Y[layout];
  if (y === undefined) throw new Error(`unknown layout "${layout}"`);
  return rect.top < y && rect.bottom > y;
}

/** True if a text rect sits in the bottom-150 zone for `layout`. */
export function findBottomZoneViolation(rect, layout) {
  const zone = BOTTOM_ZONE[layout];
  if (!zone) throw new Error(`unknown layout "${layout}"`);
  return rectsOverlap(rect.top, rect.bottom, zone.top, zone.bottom);
}

/** A 20 px grid of {x, y} points covering [zoneTop, zoneBottom) x [0, width). */
export function gridPoints(width, zoneTop, zoneBottom, step = 20) {
  const points = [];
  for (let y = zoneTop; y < zoneBottom; y += step) {
    for (let x = 0; x < width; x += step) {
      points.push({ x, y });
    }
  }
  return points;
}

// Tags and roles that make an element count as "interactive" for the
// bottom-150 sweep: a link, button, form control, or anything wired up as
// one (role, tabindex, an inline handler).
const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'checkbox', 'switch', 'menuitem']);

/**
 * True if a DOM-derived element descriptor (tagName, role, tabIndex,
 * hasOnClick — collected in-page, since this module never touches the DOM)
 * counts as interactive.
 */
export function isInteractiveDescriptor({ tagName, role, tabIndex, hasOnClick }) {
  if (INTERACTIVE_TAGS.has(tagName)) return true;
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (typeof tabIndex === 'number' && tabIndex >= 0) return true;
  if (hasOnClick) return true;
  return false;
}

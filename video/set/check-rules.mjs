// Pure geometry/font helpers for check-pages.mjs, factored out so they can
// be unit-tested without a real browser (see pages.test.mjs). Every function
// here takes plain data (numbers, strings) and returns plain data — no DOM,
// no Playwright.

// The wide-layout crop line: every 2.0x hold shows CSS y 294-540, so page
// text must end above y 286 (video/shots.json page_rules).
export const BAND = { top: 286, bottom: 302 };

// Nothing interactive and no text for the pets to stand on in the bottom
// 200 CSS px, in either layout (the inbox end note is the one exception).
export const BOTTOM_ZONE = {
  wide: { top: 340, bottom: 540 },
  narrow: { top: 530, bottom: 730 },
};

// Narrow layout (used at 540x730): text ends above CSS y 357, where the
// 9:16's 2.0x crop begins.
export const NARROW_TEXT_LIMIT = 357;

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

/** True if a wide-layout text rect illegally crosses the 286-302 band. */
export function findBandViolation(rect, exempt) {
  if (exempt) return false;
  return rectsOverlap(rect.top, rect.bottom, BAND.top, BAND.bottom);
}

/** True if a text rect illegally sits in the bottom-200 zone for `layout`. */
export function findBottomZoneViolation(rect, layout, exempt) {
  if (exempt) return false;
  const zone = layout === 'narrow' ? BOTTOM_ZONE.narrow : BOTTOM_ZONE.wide;
  return rectsOverlap(rect.top, rect.bottom, zone.top, zone.bottom);
}

/** True if a narrow-layout text rect illegally extends below y 357. */
export function findNarrowTextOverflow(rect, layout, exempt) {
  if (layout !== 'narrow' || exempt) return false;
  return rect.bottom > NARROW_TEXT_LIMIT;
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
// bottom-200 sweep: a link, button, form control, or anything wired up as
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

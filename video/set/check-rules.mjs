// Pure geometry/font helpers for check-pages.mjs, factored out so they can
// be unit-tested without a real browser (see pages.test.mjs). Every function
// here takes plain data (numbers, strings) and returns plain data — no DOM,
// no Playwright.

// The bottom-150 rule: no text and nothing interactive in the bottom 150 CSS
// px of each viewport, where the pets stand.
// ponytail: the 150 is not a number anywhere in shots.json; it comes from
// the page_rules prose ("Bottom 150 CSS px ..."), so it lives here once.
export const BOTTOM_ZONE_PX = 150;

/**
 * The page rules for both layouts, derived from video/shots.json numbers so
 * they cannot drift from the shot contract:
 *   - crop line: the top edge of a 2.0x hold, bottom-anchored. A 2.0x hold
 *     shows canvas.height / 2 output px = canvas.height / 4 page CSS px (at
 *     device_scale_factor 2), so the line is viewport.height - canvas.height / 4
 *     (wide 436 - 1080/4 = 166; narrow 856 - 1920/4 = 376).
 *   - bottom zone: [viewport.height - 150, viewport.height].
 * Returns { straddleY: {wide, narrow}, bottomZone: {wide, narrow} }.
 */
export function deriveRules(shots) {
  const narrow = shots.variants.vertical_9x16;
  const layouts = {
    wide: { viewportH: shots.viewport.height, canvasH: shots.master.height },
    narrow: { viewportH: narrow.viewport.height, canvasH: narrow.canvas.height },
  };
  const straddleY = {};
  const bottomZone = {};
  for (const [name, { viewportH, canvasH }] of Object.entries(layouts)) {
    if (!Number.isFinite(viewportH) || !Number.isFinite(canvasH)) {
      throw new Error(`shots.json is missing the ${name} viewport or canvas height`);
    }
    straddleY[name] = viewportH - canvasH / 4;
    bottomZone[name] = { top: viewportH - BOTTOM_ZONE_PX, bottom: viewportH };
  }
  return { straddleY, bottomZone };
}

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

/** True if a text rect is cut by the crop line at `lineY` (touching it is fine). */
export function findStraddleViolation(rect, lineY) {
  if (!Number.isFinite(lineY)) throw new Error(`crop line must be a number, got ${lineY}`);
  return rect.top < lineY && rect.bottom > lineY;
}

/** True if a text rect overlaps the bottom zone `{top, bottom}`. */
export function findBottomZoneViolation(rect, zone) {
  if (!zone || !Number.isFinite(zone.top) || !Number.isFinite(zone.bottom)) {
    throw new Error(`bottom zone must be {top, bottom} numbers, got ${JSON.stringify(zone)}`);
  }
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

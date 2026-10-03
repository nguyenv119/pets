// record/layout.mjs: the one description of where a run's shots live.

import { describe, expect, it } from 'vitest';
import { POPUP_SHOT_ID, shotDir } from './layout.mjs';

describe('shotDir', () => {
  it('puts 16:9 page shots at the top level and 9:16 page shots under v916/', () => {
    /**
     * The recorder writes, and render, qa and describe read, by this layout.
     * If a reader disagreed with the writer, it would read the wrong aspect's
     * footage, or report a recorded shot as missing.
     */
    // GIVEN / WHEN / THEN
    expect(shotDir('/b/run', 's1_inbox', '16:9')).toBe('/b/run/s1_inbox');
    expect(shotDir('/b/run', 's1_inbox', '9:16')).toBe('/b/run/v916/s1_inbox');
  });

  it('shares the popup take between both aspect ratios', () => {
    /** The popup is filmed once; a 9:16 reader looking under v916/ would find nothing. */
    // GIVEN / WHEN / THEN
    expect(shotDir('/b/run', POPUP_SHOT_ID, '9:16')).toBe(`/b/run/${POPUP_SHOT_ID}`);
  });

  it('rejects an aspect it does not know', () => {
    /** A boolean or a "9x16" typo must not silently fall through to the 16:9 directory. */
    // GIVEN / WHEN / THEN
    expect(() => shotDir('/b/run', 's1_inbox', true)).toThrow(/aspect/);
    expect(() => shotDir('/b/run', 's1_inbox', '9x16')).toThrow(/aspect/);
  });
});

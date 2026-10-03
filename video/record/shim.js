"use strict";
/*
 * Recording-only shim (v3), prepended to the built content.js by
 * buildExtension({ shimPath: 'record/shim.js' }) in lib/browser.mjs. Never
 * shipped: it touches only the recording copy of dist under
 * video/.cache/ext.
 *
 * Replaces Math.random with a seeded mulberry32 PRNG, and
 * Date.prototype.getHours with a value read from the page so the recorder
 * can force the night beat without waiting on the wall clock.
 *
 * v3 fixes v2's one bug: v2 read the seed with an empty-string fallback of
 * 0, which made a MISSING or EMPTY data-pp-seed attribute silently behave
 * like seed 0 instead of failing loudly. v3 treats a missing/empty
 * attribute as NO_SEED and never falls back to a random draw.
 */
(() => {
  const de = document.documentElement;
  const seedRaw = de ? de.dataset.ppSeed : undefined;

  if (seedRaw === undefined || seedRaw === '') {
    de.dataset.ppShim = 'NO_SEED';
    Date.prototype.getHours = function () {
      const h = document.documentElement && document.documentElement.dataset.ppHour;
      return h == null ? 14 : Number(h);
    };
    return;
  }

  let a = Number(seedRaw) >>> 0;

  Math.random = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  Date.prototype.getHours = function () {
    const h = document.documentElement && document.documentElement.dataset.ppHour;
    return h == null ? 14 : Number(h);
  };

  de.dataset.ppShim = `v3;seed=${seedRaw}`;
})();

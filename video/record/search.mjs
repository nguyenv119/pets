// Seed-search bookkeeping for record.mjs (pure, unit-tested): which seed to
// try next, and when a fixed-seed shot should stop burning takes on a
// failure that repeats every time.

/**
 * The seeds a shot tries, in order. prng.seed set = that one seed forever
 * (real capture timing still varies take to take, so a transient discard
 * can pass on a retry; the caller bounds it). prng.seed null = the shot's
 * sim_candidates first, then 1, 2, 3, ... skipping any already tried.
 */
export function seedCandidates(shot) {
  const prng = shot.seed.prng ?? {};
  if (prng.seed !== null && prng.seed !== undefined) {
    const seed = prng.seed;
    return { [Symbol.iterator]: () => ({ next: () => ({ value: seed, done: false }) }) };
  }
  const tried = new Set();
  const candidates = [...(prng.sim_candidates ?? [])];
  let next = 1;
  return {
    [Symbol.iterator]() {
      return {
        next() {
          while (candidates.length) {
            const seed = candidates.shift();
            if (!tried.has(seed)) {
              tried.add(seed);
              return { value: seed, done: false };
            }
          }
          while (tried.has(next)) next++;
          const seed = next++;
          tried.add(seed);
          return { value: seed, done: false };
        },
      };
    },
  };
}

/** True when the shot runs one fixed seed (prng.seed set) rather than a search. */
export function isFixedSeed(shot) {
  const seed = shot.seed.prng?.seed;
  return seed !== null && seed !== undefined;
}

/**
 * A discard's identity, ignoring the measured numbers in it: the failed
 * rule texts for an accept failure (sorted), or the discard message with
 * every number blanked. Two takes that fail "the same way" at slightly
 * different times get the same key.
 */
export function discardKey(discard) {
  if (discard.failedRules) return `rules: ${[...discard.failedRules].sort().join(' | ')}`;
  return `discard: ${String(discard.message).replace(/-?\d+(\.\d+)?/g, '#')}`;
}

export const FIXED_SEED_REPEAT_LIMIT = 3;

/**
 * Counts discards by key for one shot aspect. `record()` returns the key
 * once it has been seen FIXED_SEED_REPEAT_LIMIT times on a fixed seed (the
 * same seed failing the same way again cannot be a seed-search miss: stop
 * and report), else null. A searched shot never stops early here, and a
 * capture-side discard (`capture: true`: the clapper residual, a missing
 * clapper, a frame at the wrong size, a heart lag out of bounds) never
 * counts: the seed fixes the pets' behaviour, not the screencast's
 * timing, so those can pass on a retry of the same seed.
 */
export function createRepeatGuard({ fixedSeed }) {
  const counts = new Map();
  return {
    record(discard) {
      if (discard.capture) return null;
      const key = discardKey(discard);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return fixedSeed && n >= FIXED_SEED_REPEAT_LIMIT ? key : null;
    },
  };
}

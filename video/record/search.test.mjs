import { describe, expect, it } from 'vitest';
import { createRepeatGuard, discardKey, FIXED_SEED_REPEAT_LIMIT, isFixedSeed, seedCandidates } from './search.mjs';

// The shakedown's s4_article_night discards (prng.seed 1), as record.mjs
// logged them: the same two rules failing with different measured details.
const S4_RULES = ['all three pets are on the idle sprite at hour_set', 'all three stay on lie until the take ends (sleep+8800)'];
const S4_TAKE_A = { message: 'all three pets are on the idle sprite at hour_set (bao was not idle at hour_set); all three stay on lie until the take ends (sleep+8800) (a pet left the lie sprite at t=9165.10009765625)', failedRules: S4_RULES };
const S4_TAKE_B = { message: 'all three pets are on the idle sprite at hour_set (rex was not idle at hour_set); all three stay on lie until the take ends (sleep+8800) (a pet left the lie sprite at t=9150.300048828125)', failedRules: [...S4_RULES].reverse() };

describe('discardKey', () => {
  it('gives two takes failing the same rules the same key, whatever the measured details', () => {
    /** The s4 takes differ only in which pet napped and when it woke; they are the same failure. */
    // GIVEN — two real s4 discards
    // WHEN — their keys are computed
    // THEN — they match
    expect(discardKey(S4_TAKE_A)).toBe(discardKey(S4_TAKE_B));
  });

  it('ignores the numbers in a choreography discard message', () => {
    /** A DiscardTake message carries timings; two misses of the same window are the same failure. */
    // GIVEN — two real-shaped choreography discards
    const a = { message: 'rex sprite state "lie" not observed within 300ms of hour_set' };
    const b = { message: 'rex sprite state "lie" not observed within 300ms of hour_set' };
    const c = { message: 'bao sprite state "lie" not observed within 300ms of hour_set' };

    // WHEN / THEN — same pet same window match, a different pet does not
    expect(discardKey(a)).toBe(discardKey(b));
    expect(discardKey(a)).not.toBe(discardKey(c));
  });
});

describe('createRepeatGuard', () => {
  it(`stops a fixed-seed shot on the ${FIXED_SEED_REPEAT_LIMIT}rd identical discard`, () => {
    /**
     * s4 (prng.seed 1) burned all 60 takes on one deterministic failure in
     * the shakedown. A fixed seed failing the same way three times is not a
     * seed-search miss: stop and report it.
     */
    // GIVEN — a guard for a fixed-seed shot
    const guard = createRepeatGuard({ fixedSeed: true });

    // WHEN — the same failure is recorded three times
    const results = [guard.record(S4_TAKE_A), guard.record(S4_TAKE_B), guard.record(S4_TAKE_A)];

    // THEN — only the third says stop, naming the failure
    expect(results.slice(0, 2)).toEqual([null, null]);
    expect(results[2]).toBe(discardKey(S4_TAKE_A));
  });

  it('never stops a searched shot early', () => {
    /** A seed search (prng.seed null) is supposed to see the same failure on many seeds; it keeps its full budget. */
    // GIVEN — a guard for a searched shot
    const guard = createRepeatGuard({ fixedSeed: false });

    // WHEN — the same failure is recorded five times
    const results = Array.from({ length: 5 }, () => guard.record(S4_TAKE_A));

    // THEN — none of them stops the shot
    expect(results.every((r) => r === null)).toBe(true);
  });

  it('never counts capture-side discards toward the stop', () => {
    /**
     * The real s3 9:16 probe (2026-10-03) discarded seeds 10 and 11 on the
     * clapper residual (69.3 and 85.5 ms) after they passed every accept
     * rule: screencast timing, not the seed's behaviour. A fixed seed must
     * keep retrying those.
     */
    // GIVEN — a fixed-seed guard
    const guard = createRepeatGuard({ fixedSeed: true });

    // WHEN — three clapper discards are recorded
    const results = [69.3, 85.5, 52.0].map((r) => guard.record({ message: `clapper sync residual ${r}ms outside +-40ms`, capture: true }));

    // THEN — none stops the shot
    expect(results.every((r) => r === null)).toBe(true);
  });

  it('does not stop a fixed seed whose failures differ', () => {
    /** Transient capture failures (a late frame, a clapper residual) vary; only a repeating one stops the shot. */
    // GIVEN — a fixed-seed guard
    const guard = createRepeatGuard({ fixedSeed: true });

    // WHEN — three different failures are recorded
    const results = [guard.record(S4_TAKE_A), guard.record({ message: 'clapper sync residual 52.1ms outside +-40ms' }), guard.record({ message: 'assembled at 1920x906, expected 1920x1080' })];

    // THEN — none stops it
    expect(results.every((r) => r === null)).toBe(true);
  });
});

describe('seedCandidates', () => {
  const take = (iter, n) => {
    const it = iter[Symbol.iterator]();
    return Array.from({ length: n }, () => it.next().value);
  };

  it('tries the sim candidates first, then 1, 2, 3 skipping ones already tried', () => {
    /** s1_inbox's search order: 7, 19, 23, 51, then 1..6, 8, ... */
    // GIVEN — s1_inbox's prng block
    const shot = { seed: { prng: { seed: null, sim_candidates: [7, 19, 23, 51] } } };

    // WHEN / THEN
    expect(take(seedCandidates(shot), 10)).toEqual([7, 19, 23, 51, 1, 2, 3, 4, 5, 6]);
    expect(isFixedSeed(shot)).toBe(false);
  });

  it('repeats a fixed seed', () => {
    /** s4_article_night (prng.seed 1) retries seed 1; the repeat guard decides when to stop. */
    // GIVEN — a fixed seed
    const shot = { seed: { prng: { seed: 1 } } };

    // WHEN / THEN
    expect(take(seedCandidates(shot), 3)).toEqual([1, 1, 1]);
    expect(isFixedSeed(shot)).toBe(true);
  });
});

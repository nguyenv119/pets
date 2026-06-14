import { describe, it, expect } from 'vitest';
import { CAPACITY_CAP, CAPACITY_GROWTH_MS, currentCapacity } from '../settings';
import {
  canAddPet,
  capacityReason,
  migrationAnchor,
  adoptionAnchor,
} from './capacity-gate';

// ---------------------------------------------------------------------------
// canAddPet
// ---------------------------------------------------------------------------

describe('canAddPet — below capacity', () => {
  it('returns true when pet count is below the unlocked capacity', () => {
    /**
     * Verifies that canAddPet allows adding a pet when the user has room
     * under their current capacity.
     *
     * This is the happy path: user with a fresh or growing roster should
     * always be able to add up to their current capacity limit. If this
     * returns false incorrectly, the Add Pet button is permanently disabled
     * and users cannot adopt new pets.
     */
    // GIVEN — anchor set 10 days ago → capacity ≥ 4 (well above 1 pet)
    const now = Date.now();
    const anchor = now - 10 * CAPACITY_GROWTH_MS;

    // WHEN
    const result = canAddPet(anchor, 1, now);

    // THEN
    expect(result).toBe(true);
  });
});

describe('canAddPet — at capacity', () => {
  it('returns false when pet count equals the unlocked capacity', () => {
    /**
     * Verifies that canAddPet blocks adding a pet when the roster is full.
     *
     * Without this gate, users could adopt unlimited pets, crashing the
     * extension and producing an unmanageable roster.
     *
     * If violated, the Add Pet button stays enabled at the capacity limit
     * and users can exceed CAPACITY_CAP.
     */
    // GIVEN — anchor set 0 days ago → capacity = 1; petCount = 1 = capacity
    const now = Date.now();
    const anchor = now; // elapsed = 0 → timeCapacity = 1

    // WHEN
    const result = canAddPet(anchor, 1, now);

    // THEN
    expect(result).toBe(false);
  });
});

describe('canAddPet — null anchor, no pets', () => {
  it('returns true when anchor is null and pet count is 0 (fresh install)', () => {
    /**
     * Verifies that a brand-new user (null anchor, 0 pets) is allowed to
     * adopt their first pet even before any anchor is set.
     *
     * anchor=null with petCount=0 means the user has never adopted a pet and
     * has no anchor yet. currentCapacity with elapsed=0 yields capacity=1,
     * so petCount=0 < 1 = capacity → room exists.
     *
     * If violated, new users see a disabled Add Pet button and cannot start.
     */
    // GIVEN — fresh install: no anchor, no pets
    const now = Date.now();

    // WHEN
    const result = canAddPet(null, 0, now);

    // THEN
    expect(result).toBe(true);
  });
});

describe('canAddPet — at CAPACITY_CAP', () => {
  it('returns false when pet count equals CAPACITY_CAP regardless of time', () => {
    /**
     * Verifies that the hard cap of CAPACITY_CAP (7) is enforced — adding
     * beyond it is never permitted no matter how much time has passed.
     *
     * This prevents roster bloat and ensures the extension stays performant
     * even for long-time users.
     *
     * If violated, users with 7+ pets can keep adding indefinitely.
     */
    // GIVEN — very old anchor → max capacity unlocked; petCount = CAPACITY_CAP
    const now = Date.now();
    const anchor = now - CAPACITY_CAP * CAPACITY_GROWTH_MS * 2; // way past cap

    // WHEN
    const result = canAddPet(anchor, CAPACITY_CAP, now);

    // THEN
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capacityReason
// ---------------------------------------------------------------------------

describe('capacityReason — at capacity with countdown', () => {
  it('returns a string containing "next home" when capacity is full but not maxed', () => {
    /**
     * Verifies that capacityReason shows a countdown message telling the user
     * when the next home opens, so they understand the gate is time-based, not
     * permanent.
     *
     * Without an honest countdown, users think adoption is permanently broken
     * rather than understanding the growth mechanic.
     *
     * If violated, the reason text would be absent or misleading.
     */
    // GIVEN — anchor just set; 1 pet = capacity 1 = full
    const now = Date.now();
    const anchor = now;

    // WHEN
    const reason = capacityReason(anchor, 1, now);

    // THEN — should mention time (contains "next home")
    expect(reason).toContain('next home');
  });
});

describe('capacityReason — at CAPACITY_CAP', () => {
  it('returns a message indicating max capacity when all slots are exhausted', () => {
    /**
     * Verifies that capacityReason returns an honest "max capacity" message
     * when the roster is at CAPACITY_CAP, rather than showing a countdown
     * (there is no next home to wait for).
     *
     * If violated, the UI shows "next home in 0m" instead of "max capacity
     * reached", confusing users into waiting for a slot that never comes.
     */
    // GIVEN — old anchor, max pets
    const now = Date.now();
    const anchor = now - CAPACITY_CAP * CAPACITY_GROWTH_MS * 2;

    // WHEN
    const reason = capacityReason(anchor, CAPACITY_CAP, now);

    // THEN
    expect(reason).toContain('max');
  });
});

describe('capacityReason — below capacity', () => {
  it('returns empty string when the user can still add a pet', () => {
    /**
     * Verifies that capacityReason returns '' when capacity is not full.
     * The caller uses a non-empty string as the signal to disable the button;
     * returning '' when room exists ensures the button stays enabled.
     *
     * If violated, the Add Pet button would be disabled with a confusing
     * empty reason text even when the user has capacity.
     */
    // GIVEN — anchor is old enough for 2 capacity, only 1 pet
    const now = Date.now();
    const anchor = now - 2 * CAPACITY_GROWTH_MS;

    // WHEN
    const reason = capacityReason(anchor, 1, now);

    // THEN
    expect(reason).toBe('');
  });
});

// ---------------------------------------------------------------------------
// migrationAnchor — grandfather back-date formula
// ---------------------------------------------------------------------------

describe('migrationAnchor — existing user with pets', () => {
  it('back-dates anchor by petCount intervals (grandfather +1)', () => {
    /**
     * Verifies the grandfather +1 formula: migrationAnchor = now - min(petCount,7)*GROWTH_MS.
     * Back-dating by petCount whole intervals places the anchor far enough in the
     * past that timeCapacity = petCount + 1 right now — keeping all existing pets
     * AND leaving one free slot waiting on upgrade.
     *
     * Without this, a user upgrading from v1 with 3 pets would start at capacity 1
     * and see their pets blocked. The chosen design instead welcomes them with one
     * ready slot, then resumes the normal cadence for the slot after that.
     *
     * If violated, upgraders either can't see their pets (under-credit) or jump
     * straight to the cap (over-credit).
     */
    // GIVEN — user has 3 pets, upgrading now
    const now = 1_000_000;
    const petCount = 3;

    // WHEN
    const anchor = migrationAnchor(petCount, now);

    // THEN — anchor is now - 3*GROWTH (so timeCapacity = 4, i.e. petCount+1)
    const expected = now - Math.min(petCount, CAPACITY_CAP) * CAPACITY_GROWTH_MS;
    expect(anchor).toBe(expected);
  });

  it('composed with currentCapacity, leaves exactly one free slot on upgrade', () => {
    /**
     * Locks the END-TO-END grandfather +1 behavior, not just the anchor value:
     * feeding migrationAnchor's result into currentCapacity must yield
     * capacity = petCount + 1 with isFull = false — one slot ready to adopt into.
     *
     * This is the contract the anchor-only test cannot prove (it asserts the
     * timestamp, not the resulting capacity). If migrationAnchor's interval count
     * drifts by one, this test catches it where the anchor-value test would not:
     * an off-by-one would strand pets (capacity = petCount, isFull) or hand out
     * two free slots (capacity = petCount + 2).
     */
    // GIVEN — upgrader with 2 pets, anchor back-dated by the grandfather formula
    const now = 1_000_000;
    const petCount = 2;

    // WHEN — compose migration → capacity
    const { capacity, isFull } = currentCapacity(migrationAnchor(petCount, now), petCount, now);

    // THEN — capacity is petCount+1 and a slot is free right now
    expect(capacity).toBe(petCount + 1);
    expect(isFull).toBe(false);
  });
});

describe('migrationAnchor — user with more pets than CAPACITY_CAP', () => {
  it('clamps the back-date to CAPACITY_CAP intervals to avoid negative or extreme anchors', () => {
    /**
     * Verifies that migrationAnchor clamps at min(petCount, CAPACITY_CAP)
     * when the user somehow has more pets than the cap allows.
     *
     * This prevents an unbounded back-date which could set anchorAt to a
     * time many decades in the past, confusing currentCapacity math.
     *
     * If violated, a user with 20 pets gets an anchor 60+ days in the past,
     * and future capacity calculations become unreliable.
     */
    // GIVEN — user has 10 pets (above CAPACITY_CAP = 7)
    const now = 5_000_000;
    const petCount = 10;

    // WHEN
    const anchor = migrationAnchor(petCount, now);

    // THEN — clamped at CAPACITY_CAP
    const expected = now - CAPACITY_CAP * CAPACITY_GROWTH_MS;
    expect(anchor).toBe(expected);
  });
});

describe('migrationAnchor — user with 0 pets', () => {
  it('returns now (anchor = now - 0) for a user with no pets', () => {
    /**
     * Verifies that migrationAnchor for 0 pets returns `now` (no back-date),
     * so a fresh-install upgrader starts at the same baseline as a new user.
     *
     * If violated, upgraders with 0 pets get an anchor in the past, granting
     * them time-capacity they have not yet earned.
     */
    // GIVEN — upgrader with 0 pets
    const now = 999_999;

    // WHEN
    const anchor = migrationAnchor(0, now);

    // THEN
    expect(anchor).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// adoptionAnchor — first-adoption anchor
// ---------------------------------------------------------------------------

describe('adoptionAnchor — sets anchor on first adopt', () => {
  it('returns now when currentAnchor is null (first pet being adopted)', () => {
    /**
     * Verifies that adoptionAnchor sets the anchor to the adoption timestamp
     * when no anchor exists yet.
     *
     * The anchor establishes t=0 for the capacity growth clock. Without it,
     * currentCapacity treats elapsed=0 and keeps capacity locked at 1 forever.
     *
     * If violated, the capacity counter never grows and users can never get
     * beyond their initial slot count.
     */
    // GIVEN — no anchor yet
    const now = 12345;

    // WHEN
    const result = adoptionAnchor(null, now);

    // THEN
    expect(result).toBe(now);
  });
});

describe('adoptionAnchor — preserves existing anchor', () => {
  it('returns the existing anchor unchanged when one already exists', () => {
    /**
     * Verifies that adoptionAnchor is a no-op when an anchor is already set.
     * Each subsequent pet adoption must NOT reset the clock, or all growth
     * progress would be lost every time a pet is added.
     *
     * If violated, every pet adoption resets the capacity growth timer,
     * making it impossible to ever unlock more than 1 slot per adoption.
     */
    // GIVEN — anchor already set
    const existingAnchor = 100_000;
    const now = 200_000;

    // WHEN
    const result = adoptionAnchor(existingAnchor, now);

    // THEN — existing anchor preserved
    expect(result).toBe(existingAnchor);
  });
});

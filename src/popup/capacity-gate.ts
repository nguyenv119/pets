/**
 * capacity-gate.ts — Pure decision logic for the capacity gate.
 *
 * Intentionally DOM-free so it can be unit-tested without popup.ts
 * (which runs top-level getElementById at import time).
 *
 * All capacity math delegates to currentCapacity / formatCapacityCountdown
 * from settings.ts — do NOT redefine the constants or formulas here.
 */
import {
  CAPACITY_CAP,
  CAPACITY_GROWTH_MS,
  currentCapacity,
  formatCapacityCountdown,
} from '../settings';

/**
 * Returns true if the user can add another pet right now.
 *
 * @param anchorAt  homeAnchorAt from Settings (null = no anchor yet)
 * @param petCount  current number of pets in the roster
 * @param now       current timestamp (injectable for testing)
 */
export function canAddPet(
  anchorAt: number | null,
  petCount: number,
  now = Date.now()
): boolean {
  const { isFull } = currentCapacity(anchorAt, petCount, now);
  return !isFull;
}

/**
 * Returns an honest human-readable reason why the button is disabled,
 * or '' if there is capacity available.
 *
 * @param anchorAt  homeAnchorAt from Settings
 * @param petCount  current number of pets
 * @param now       current timestamp (injectable for testing)
 */
export function capacityReason(
  anchorAt: number | null,
  petCount: number,
  now = Date.now()
): string {
  const { isFull, nextSlotMs, capacity } = currentCapacity(anchorAt, petCount, now);

  if (!isFull) return '';

  if (capacity >= CAPACITY_CAP) {
    return `max capacity reached (${CAPACITY_CAP} pets)`;
  }

  return formatCapacityCountdown(nextSlotMs);
}

/**
 * Grandfather back-date formula for upgrading users who have pets but
 * no homeAnchorAt yet.
 *
 * Sets anchorAt = now - min(petCount, CAPACITY_CAP) * GROWTH_MS so that:
 *   - capacity starts at petCount (they keep all their existing pets)
 *   - the next slot opens exactly one growth interval from now
 *
 * @param petCount  number of existing pets
 * @param now       current timestamp (injectable for testing)
 */
export function migrationAnchor(petCount: number, now = Date.now()): number {
  return now - Math.min(petCount, CAPACITY_CAP) * CAPACITY_GROWTH_MS;
}

/**
 * Returns the anchor to use when a pet is adopted.
 *
 * - If no anchor exists yet (null), sets it to `now` (t=0 for the growth clock).
 * - If an anchor already exists, returns it unchanged (never reset the clock).
 *
 * @param currentAnchor  existing homeAnchorAt value
 * @param now            current timestamp (injectable for testing)
 */
export function adoptionAnchor(
  currentAnchor: number | null,
  now = Date.now()
): number {
  return currentAnchor ?? now;
}

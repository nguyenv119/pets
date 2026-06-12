import { loadSettings, currentCapacity, CAPACITY_CAP, formatCapacityCountdown } from '../settings';

// ---------------------------------------------------------------------------
// Capacity counter rendering
//
// Extracted from popup.ts so it can be tested without a full DOM environment
// (popup.ts has top-level document.getElementById calls that fail in Vitest).
// The caller passes the DOM elements; this module owns only the logic.
// ---------------------------------------------------------------------------

let capacityInterval: ReturnType<typeof setInterval> | null = null;

export async function renderCapacityCounter(
  countEl: HTMLElement | null,
  maxEl: HTMLElement | null,
  nextEl: HTMLElement | null,
  petCount: number
): Promise<void> {
  if (!countEl || !maxEl || !nextEl) return;

  const s = await loadSettings();
  const now = Date.now();
  const { capacity, nextSlotMs } = currentCapacity(s.homeAnchorAt ?? null, petCount, now);

  countEl.textContent = String(capacity);
  maxEl.textContent = String(CAPACITY_CAP);

  // Clear any prior countdown interval before potentially starting a new one.
  if (capacityInterval !== null) {
    clearInterval(capacityInterval);
    capacityInterval = null;
  }

  if (capacity >= CAPACITY_CAP || nextSlotMs <= 0) {
    nextEl.textContent = '';
    return;
  }

  nextEl.textContent = formatCapacityCountdown(nextSlotMs);

  // Tick every 60 seconds to update the countdown display.
  // Days/hours granularity means per-second ticks would waste CPU.
  let remaining = nextSlotMs;
  capacityInterval = setInterval(() => {
    remaining -= 60_000;
    if (remaining <= 0) {
      // A full growth interval has elapsed — re-render from storage.
      clearInterval(capacityInterval!);
      capacityInterval = null;
      renderCapacityCounter(countEl, maxEl, nextEl, petCount);
    } else {
      nextEl!.textContent = formatCapacityCountdown(remaining);
    }
  }, 60_000);
}

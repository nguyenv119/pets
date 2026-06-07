import { loadSettings, currentTreats, TREAT_CAP } from '../settings';

// ---------------------------------------------------------------------------
// Treat counter rendering
//
// Extracted from popup.ts so it can be tested without a full DOM environment
// (popup.ts has top-level document.getElementById calls that fail in Vitest).
// The caller passes the DOM elements; this module owns only the logic.
// ---------------------------------------------------------------------------

let countdownInterval: ReturnType<typeof setInterval> | null = null;

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `next in ${m}m ${s}s`;
}

export async function renderTreatCounter(
  countEl: HTMLElement | null,
  nextEl: HTMLElement | null
): Promise<void> {
  if (!countEl || !nextEl) return;

  const s = await loadSettings();
  const now = Date.now();
  const { count, nextRechargeMs } = currentTreats(s, now);

  countEl.textContent = String(count);

  // Clear any prior countdown interval before potentially starting a new one.
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  if (count >= TREAT_CAP || nextRechargeMs <= 0) {
    nextEl.textContent = '';
    return;
  }

  nextEl.textContent = formatMs(nextRechargeMs);

  // Tick every second to update the countdown display.
  let remaining = nextRechargeMs;
  countdownInterval = setInterval(() => {
    remaining -= 1000;
    if (remaining <= 0) {
      // A full recharge interval has elapsed — re-render from storage.
      clearInterval(countdownInterval!);
      countdownInterval = null;
      renderTreatCounter(countEl, nextEl);
    } else {
      nextEl!.textContent = formatMs(remaining);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Toast — single-toast notification with optional action button.
//
// showToast renders a toast into #toast-region and returns a Promise that:
//   - resolves true  if the action button is clicked before timeout
//   - resolves false if the duration elapses without user action
//
// Only one toast is active at a time. Calling showToast while one is visible
// immediately resolves the previous promise with false and replaces the toast.
// ---------------------------------------------------------------------------

interface ToastOptions {
  message: string;
  actionLabel: string;
  duration: number; // milliseconds
}

// Module-scope state — active toast cleanup handle.
let cancelActiveToast: (() => void) | null = null;

export function showToast(options: ToastOptions): Promise<boolean> {
  const { message, actionLabel, duration } = options;

  // Cancel any in-progress toast (resolves it false).
  if (cancelActiveToast) {
    cancelActiveToast();
    cancelActiveToast = null;
  }

  const toastRegion = document.getElementById('toast-region');
  if (!toastRegion) {
    // Toast region not in DOM — resolve immediately with false.
    return Promise.resolve(false);
  }
  const region = toastRegion; // narrowed non-null reference for inner functions

  return new Promise<boolean>((resolve) => {
    // Build toast element.
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-action" type="button">${escapeHtml(actionLabel)}</button>
    `;
    region.innerHTML = '';
    region.appendChild(toast);

    let settled = false;

    function cleanup(): void {
      if (toast.parentNode === region) {
        region.innerHTML = '';
      }
    }

    function settle(value: boolean): void {
      if (settled) return;
      settled = true;
      cancelActiveToast = null;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    }

    // Action button click → resolve true.
    toast.querySelector('.toast-action')!.addEventListener('click', () => {
      settle(true);
    });

    // Timeout → resolve false.
    const timer = setTimeout(() => {
      settle(false);
    }, duration);

    // Allow external cancellation (new toast displaces this one → false).
    cancelActiveToast = () => settle(false);
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

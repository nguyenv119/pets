/**
 * Probes whether the content script is running on a given tab.
 *
 * Sends a PING message and returns true if the content script responds
 * with `{ alive: true }`. Returns false if the tab is a special browser
 * page (chrome://, about:, etc.) where content scripts cannot run.
 */
export function pingTab(tabId: number): Promise<boolean> {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, (resp?: { alive?: boolean }) => {
      if (chrome.runtime.lastError || !resp?.alive) return resolve(false);
      resolve(true);
    });
  });
}

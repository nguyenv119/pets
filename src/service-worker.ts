import type { ExtMessage } from './types';

// ---------------------------------------------------------------------------
// On install / update — inject content script into all existing tabs.
// Without this, tabs that were already open don't get pets until refreshed.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.id != null) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      }).catch(() => {
        // Tab may not support scripting — ignore
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Message relay — popup → all content scripts
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (msg: ExtMessage, _sender, _sendResponse) => {
    if (msg.type === 'ADD_PET' || msg.type === 'REMOVE_PET' || msg.type === 'THROW_BALL' || msg.type === 'TOGGLE_VISIBILITY') {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id != null) {
            chrome.tabs.sendMessage(tab.id, msg).catch(() => {
              // Tab may not have content script loaded — ignore
            });
          }
        }
      });
    }
    return false; // no async sendResponse needed
  },
);

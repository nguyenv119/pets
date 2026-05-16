import type { ExtMessage } from './types';

// Service worker — relays messages from popup to all content scripts
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

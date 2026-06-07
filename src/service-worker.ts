import type { ExtMessage } from './types';
import { loadPetData, savePets } from './store';
import { loadSettings, saveSettings, currentTreats, TREAT_RECHARGE_MS } from './settings';

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
// Pending removals — map of pet id → timer handle.
// When PENDING_REMOVE_PET arrives the SW waits delayMs, then:
//   1. Reads pets from storage, filters out the id, writes back.
//   2. Broadcasts REMOVE_PET to all content scripts.
// If CANCEL_PENDING_REMOVE arrives before the timer fires, the timer is
// cleared and no storage/broadcast action is taken.
//
// NOTE: If the popup is re-opened before the timer fires, storage still
// contains the pet — the popup will show it again. This is an accepted
// tradeoff: the alternative (blocking UI until the timer fires) is worse UX.
// ---------------------------------------------------------------------------

const pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();

async function broadcastToTabs(msg: ExtMessage): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {
        // Tab may not have content script loaded — ignore
      });
    }
  }
}

async function commitRemoval(id: string): Promise<void> {
  pendingRemovals.delete(id);
  const pets = await loadPetData();
  const updated = pets.filter(p => p.id !== id);
  await savePets(updated);
  await broadcastToTabs({ type: 'REMOVE_PET', id });
}

// ---------------------------------------------------------------------------
// Treat mutex — single-writer Promise chain prevents concurrent-read/write races
// when multiple content scripts (multiple tabs) send CONSUME_TREAT at once.
// ---------------------------------------------------------------------------

let busy: Promise<unknown> | null = null;

// ---------------------------------------------------------------------------
// Message relay
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (msg: ExtMessage, _sender, sendResponse) => {
    if (msg.type === 'ADD_PET' || msg.type === 'THROW_BALL' || msg.type === 'TOGGLE_VISIBILITY' || msg.type === 'SET_PET_HIDDEN' || msg.type === 'REMOVE_PET' || msg.type === 'PETS_REORDERED') {
      broadcastToTabs(msg);
      return false;
    }

    if (msg.type === 'PENDING_REMOVE_PET') {
      // Cancel any existing timer for this id (e.g. double-click edge case).
      const existing = pendingRemovals.get(msg.id);
      if (existing != null) clearTimeout(existing);

      const timer = setTimeout(() => {
        commitRemoval(msg.id).catch(() => {
          // Storage failure — best effort, timer already cleared
        });
      }, msg.delayMs);
      pendingRemovals.set(msg.id, timer);
      return false;
    }

    if (msg.type === 'CANCEL_PENDING_REMOVE') {
      const timer = pendingRemovals.get(msg.id);
      if (timer != null) {
        clearTimeout(timer);
        pendingRemovals.delete(msg.id);
      }
      return false;
    }

    if (msg.type === 'CONSUME_TREAT') {
      // Chain via mutex so concurrent requests are serialized:
      // each handler waits for the prior one to finish before reading storage.
      // `.catch` is required so a single failure (e.g. storage error) doesn't
      // poison `busy` and skip every subsequent CONSUME_TREAT silently.
      busy = (busy ?? Promise.resolve()).then(async () => {
        const now = Date.now();
        const s = await loadSettings();
        const { count } = currentTreats(s, now);

        if (count <= 0) {
          sendResponse({ ok: false, count: 0 });
          return;
        }

        // Materialize: advance treatsUpdatedAt to preserve sub-interval remainder
        // so the next recharge still fires at the right time.
        const remainder = (now - s.treatsUpdatedAt) % TREAT_RECHARGE_MS;
        s.treats = count;
        s.treatsUpdatedAt = now - remainder;
        s.treats -= 1;

        await saveSettings(s);
        sendResponse({ ok: true, count: s.treats });
      }).catch((err) => {
        // Keep the chain alive after a failure; surface as ok:false to the caller
        // so the UI doesn't hang forever waiting for sendResponse.
        console.error('CONSUME_TREAT failed:', err);
        try { sendResponse({ ok: false, count: 0 }); } catch { /* response already sent */ }
      });

      return true; // keep sendResponse callable after async work
    }

    return false;
  },
);

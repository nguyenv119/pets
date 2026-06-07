import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pingTab } from './tab-probe';

// ---------------------------------------------------------------------------
// Chrome API mocks
// ---------------------------------------------------------------------------

type SendMessageCallback = (response?: { alive: boolean }) => void;

let sendMessageImpl: (
  tabId: number,
  msg: { type: string },
  callback: SendMessageCallback
) => void = (_tabId, _msg, cb) => cb(undefined);

// REVIEW: mocking core dependency — chrome.tabs.sendMessage is the entire
// behavioral surface pingTab wraps. The chrome.* APIs are browser-only and
// cannot be exercised under Vitest/jsdom, so we stub the callback contract
// (callback shape, lastError mechanism, response value) by hand. If Chrome's
// MV3 messaging contract changes, these tests can pass while production breaks.
const chromeMock = {
  tabs: {
    sendMessage: vi.fn((tabId: number, msg: { type: string }, cb: SendMessageCallback) => {
      sendMessageImpl(tabId, msg, cb);
    }),
    query: vi.fn(),
  },
  runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

beforeEach(() => {
  vi.clearAllMocks();
  chromeMock.runtime.lastError = undefined;
  sendMessageImpl = (_tabId, _msg, cb) => cb(undefined);
});

// ---------------------------------------------------------------------------
// pingTab — content script probe
// ---------------------------------------------------------------------------

describe('pingTab — PING probe to content script', () => {
  it('returns true when content script responds with alive: true', async () => {
    /**
     * Verifies that pingTab resolves to true when chrome.tabs.sendMessage
     * calls back with a response object containing `alive: true`.
     *
     * This matters because the popup uses this result to determine whether
     * pets are running on the active tab. A false negative would incorrectly
     * show the "special page" banner on normal http(s) pages, blocking the
     * throw-ball feature unnecessarily.
     *
     * If this contract breaks, normal pages appear as special pages and
     * users cannot interact with their pets via the popup controls.
     */
    // GIVEN — content script is alive and responds positively
    sendMessageImpl = (_tabId, _msg, cb) => cb({ alive: true });

    // WHEN — popup probes the tab
    const result = await pingTab(42);

    // THEN — the probe returns true
    expect(result).toBe(true);
  });

  it('returns false when chrome.runtime.lastError is set', async () => {
    /**
     * Verifies that pingTab resolves to false when the message cannot be
     * delivered (e.g., tab has no content script — a special browser page
     * such as chrome://extensions).
     *
     * This matters because chrome.runtime.lastError is the mechanism Chrome
     * uses to signal that sendMessage failed. If pingTab doesn't check it,
     * a chrome:// page with no content script would be treated as a normal
     * page, and the banner would never appear.
     *
     * If violated, users on chrome:// pages see no banner and clicking
     * Throw Ball silently does nothing.
     */
    // GIVEN — message delivery fails (no content script)
    sendMessageImpl = (_tabId, _msg, cb) => {
      chromeMock.runtime.lastError = { message: 'Could not establish connection.' };
      cb(undefined);
    };

    // WHEN — popup probes the tab
    const result = await pingTab(99);

    // THEN — the probe returns false
    expect(result).toBe(false);
  });

  it('returns false when response is null/undefined', async () => {
    /**
     * Verifies that pingTab returns false when the callback receives no
     * response object (e.g., the content script listener returns without
     * calling sendResponse, or the tab is loading).
     *
     * This provides a safe default: missing response → assume not alive →
     * show special page banner. This is the conservative approach that
     * prevents Throw Ball from being active on non-functional tabs.
     *
     * If violated, a tab that did not respond would be treated as alive
     * and the user could click Throw Ball with no pets running.
     */
    // GIVEN — message delivered but content script does not respond
    sendMessageImpl = (_tabId, _msg, cb) => cb(undefined);

    // WHEN — popup probes the tab
    const result = await pingTab(7);

    // THEN — the probe returns false
    expect(result).toBe(false);
  });

  it('returns false when response is truthy but alive is false', async () => {
    /**
     * Verifies that pingTab gates on `resp.alive === true`, not on the mere
     * presence of a response object. If a future content-script version
     * (or an unrelated extension on the same channel) replies with
     * `{ alive: false }` to signal it's shutting down or not ready, pingTab
     * must treat that as not-alive.
     *
     * If violated, a "{ alive: false }" response would still hide the banner
     * and enable Throw Ball, even though pets are not actually running.
     */
    // GIVEN — response received but explicitly not alive
    sendMessageImpl = (_tabId, _msg, cb) => cb({ alive: false });

    // WHEN — popup probes the tab
    const result = await pingTab(11);

    // THEN — the probe returns false
    expect(result).toBe(false);
  });

  it('sends a PING message type to the specified tab', async () => {
    /**
     * Verifies that pingTab sends the correct message type so the content
     * script's PING handler is triggered (not a different message handler).
     *
     * If the wrong type is sent, the content script ignores the message
     * and never calls sendResponse, causing pingTab to resolve false on
     * all pages — banner always shown, Throw Ball always disabled.
     */
    // GIVEN — content script responds alive
    sendMessageImpl = (_tabId, _msg, cb) => cb({ alive: true });

    // WHEN — popup probes tab 5
    await pingTab(5);

    // THEN — chrome.tabs.sendMessage was called with PING and the correct tabId
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      5,
      { type: 'PING' },
      expect.any(Function)
    );
  });
});

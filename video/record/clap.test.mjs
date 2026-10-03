import { afterEach, describe, expect, it } from 'vitest';
import { installClap } from './clap.js';

// installClap runs in the page (page.evaluate serializes it), so these tests
// give it an in-memory stand-in for the four page globals it touches:
// window, document, performance and requestAnimationFrame. Each animation
// frame advances the fake clock by FRAME_MS, the way a slow compositor would.
const FRAME_MS = 50;
const saved = {};

function installFakePage() {
  const clock = { ms: 1000 };
  const removed = [];
  const stubs = {
    window: globalThis,
    performance: { timeOrigin: 0, now: () => clock.ms },
    requestAnimationFrame: (cb) => setTimeout(() => { clock.ms += FRAME_MS; cb(clock.ms); }, 0),
    document: {
      createElement: () => { const el = { style: {}, remove: () => removed.push(el) }; return el; },
      documentElement: { appendChild: () => {} },
    },
  };
  for (const [k, v] of Object.entries(stubs)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  return { clock, removed };
}

afterEach(() => {
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete globalThis[k];
  }
  delete globalThis.__clap;
  delete globalThis.__clapMarks;
});

describe('installClap', () => {
  it('measures tOn at the first animation frame after the insert, not as tOff - holdMs', async () => {
    // GIVEN — a page whose frames each take 50ms, and the clapper installed in it
    const { removed } = installFakePage();
    installClap();

    // WHEN — a 160ms clap runs
    const mark = await globalThis.__clap('start', 160);

    // THEN — tOn is the insert plus one frame (1050), and tOff is the remove plus one frame (1100): the
    // fake clock only moves on frames, so the old tOff - holdMs formula would have said 940
    expect(mark).toMatchObject({ label: 'start', tInsert: 1000, tOn: 1050, tRemove: 1050, tOff: 1100 });
    expect(mark.tOn).not.toBe(mark.tOff - 160);
    // AND the magenta div is gone afterwards
    expect(removed).toHaveLength(1);
  });

  it('keeps every clap in window.__clapMarks, in order, for the recorder to read back', async () => {
    // GIVEN — the clapper installed in a fake page
    installFakePage();
    installClap();

    // WHEN — a start and an end clap run
    await globalThis.__clap('start', 10);
    await globalThis.__clap('end', 10);

    // THEN — both marks are logged, labelled, in the order they ran
    expect(globalThis.__clapMarks.map((m) => m.label)).toEqual(['start', 'end']);
  });
});

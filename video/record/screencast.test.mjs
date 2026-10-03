import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startScreencast } from './screencast.mjs';

/** An in-memory CDP session: records every send(), and lets a test emit Page.screencastFrame events. */
function fakeCdp() {
  const cdp = new EventEmitter();
  cdp.sent = [];
  cdp.send = async (method, params) => { cdp.sent.push({ method, params }); };
  return cdp;
}

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('startScreencast', () => {
  it('starts a PNG screencast, acks each frame, and writes the frames in arrival order', async () => {
    // GIVEN — a fresh frames directory and a fake CDP session
    dir = mkdtempSync(join(tmpdir(), 'screencast-test-'));
    const cdp = fakeCdp();

    // WHEN — the screencast starts, two frames arrive, and it stops
    const cast = await startScreencast(cdp, dir);
    cdp.emit('Page.screencastFrame', { sessionId: 7, data: Buffer.from('one').toString('base64'), metadata: { timestamp: 1.5 } });
    cdp.emit('Page.screencastFrame', { sessionId: 8, data: Buffer.from('two').toString('base64'), metadata: { timestamp: 1.54 } });
    await cast.stop();

    // THEN — CDP got start, both acks and stop, in that order
    expect(cdp.sent.map((s) => s.method)).toEqual(['Page.startScreencast', 'Page.screencastFrameAck', 'Page.screencastFrameAck', 'Page.stopScreencast']);
    expect(cdp.sent[0].params).toEqual({ format: 'png', everyNthFrame: 1 });
    expect(cdp.sent.slice(1, 3).map((s) => s.params.sessionId)).toEqual([7, 8]);
    // AND both frames are on disk, decoded, numbered in arrival order, with their CDP timestamps
    expect(cast.frames.map((f) => f.ts)).toEqual([1.5, 1.54]);
    expect(readdirSync(dir).sort()).toEqual(['f00000.png', 'f00001.png']);
    expect(readFileSync(cast.frames[1].file, 'utf-8')).toBe('two');
  });
});

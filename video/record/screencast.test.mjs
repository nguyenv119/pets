import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dropLeadingMisSizedFrames, pngSize, startScreencast } from './screencast.mjs';

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

describe('dropLeadingMisSizedFrames', () => {
  // A real 9:16 pre-roll (probe 2026-10-03): the first frame 1080x1286, the
  // rest 1080x1460; the start clapper inserted at epoch 1000.5 s.
  const CLAP_INSERT_MS = 1000500;
  const frames = [
    { file: 'f0', ts: 1000.0, width: 1080, height: 1286 },
    { file: 'f1', ts: 1000.022, width: 1080, height: 1460 },
    { file: 'f2', ts: 1000.6, width: 1080, height: 1460 },
  ];

  it('drops a wrong-size first frame from before the start clapper', () => {
    /**
     * ffmpeg sizes the whole clip from its first frame, so one pre-roll
     * frame at 1080x1286 discarded three good s1 takes in a row (seeds 19,
     * 23 and 51) in the probe run. It is pre-roll, never part of the take.
     */
    // GIVEN / WHEN
    const kept = dropLeadingMisSizedFrames(frames, { width: 1080, height: 1460, beforeMs: CLAP_INSERT_MS });

    // THEN
    expect(kept.map((f) => f.file)).toEqual(['f1', 'f2']);
  });

  it('keeps a wrong-size frame from after the start clapper, so the size check still discards the take', () => {
    /** A mis-sized frame inside the take is a real capture fault; it must not be silently dropped. */
    // GIVEN — the only wrong-size frame comes after the clapper insert
    const late = [{ file: 'g0', ts: 1000.6, width: 1080, height: 1286 }, ...frames.slice(1)];

    // WHEN / THEN — nothing is dropped
    expect(dropLeadingMisSizedFrames(late, { width: 1080, height: 1460, beforeMs: CLAP_INSERT_MS }).map((f) => f.file)).toEqual(['g0', 'f1', 'f2']);
  });

  it('reads a PNG size from its IHDR and nothing from a non-PNG', () => {
    /** Frame sizes are read as the frames arrive, from the PNG header. */
    // GIVEN — a minimal PNG header for 1920x906
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(906, 20);

    // WHEN / THEN
    expect(pngSize(png)).toEqual({ width: 1920, height: 906 });
    expect(pngSize(Buffer.from('two'))).toEqual({});
  });
});

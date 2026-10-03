import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSync,
  demoMsOf,
  findFirstHeartFrame,
  findMagentaRuns,
  findTrimBeforeMs,
  findTrimBeforeMsOrDiscard,
  measureVideoLagFromChange,
  measureVideoLagFromHeart,
  parseSignalStats,
  splitGrayFrames,
} from './sync.mjs';
import { createRepeatGuard } from './search.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sigSample = readFileSync(join(HERE, '..', 'fixtures', 'sig.sample.txt'), 'utf-8');
const rawSample = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'raw.sample.json'), 'utf-8'));

describe('parseSignalStats', () => {
  it('parses one row per frame with its SATMIN value', () => {
    // GIVEN — the committed real ffmpeg signalstats output for the proof render
    // WHEN — it is parsed
    const frames = parseSignalStats(sigSample);

    // THEN — every frame has a pts_time and a SATMIN reading
    expect(frames.length).toBeGreaterThan(100);
    expect(frames[0]).toMatchObject({ n: 0, t: 0 });
    expect(typeof frames[0].satmin).toBe('number');
  });
});

describe('findMagentaRuns', () => {
  it('finds exactly the two clapper flashes in the real signalstats log', () => {
    // GIVEN — the real signalstats log, which has one clapper flash at the start and one at the end of the take
    const frames = parseSignalStats(sigSample);

    // WHEN — magenta runs are located
    const runs = findMagentaRuns(frames);

    // THEN — exactly 2 runs are found (a third would mean a spurious high-saturation frame corrupted the take)
    expect(runs.length).toBe(2);
    expect(runs[0].releaseT).toBeLessThan(runs[1].startT);
  });
});

describe('computeSync', () => {
  it('matches the committed events.sample.json trimBeforeMs on the real fixture pair', () => {
    // GIVEN — the real raw capture log and its paired signalstats output (the proof render)
    // WHEN — sync is computed with the proof's own measured videoLagMs (56ms, per the bead's HANDOFF comment)
    const result = computeSync({
      signalStatsText: sigSample,
      startClapLoggedMs: rawSample.clap1.tOff,
      endClapLoggedMs: rawSample.clap2.tOff,
      videoLagMs: 56,
    });

    // THEN — trimBeforeMs matches the committed events.sample.json (1080ms) exactly, proving the release-edge
    // detection agrees with the proven recipe's own recorded output
    expect(result.trimBeforeMs).toBe(1080);
  });

  it('reproduces the proof render corrected residual (-63.3ms raw, ~-7ms corrected) and passes the 40ms gate', () => {
    // GIVEN — the same real fixture pair
    // WHEN — sync is computed
    const result = computeSync({
      signalStatsText: sigSample,
      startClapLoggedMs: rawSample.clap1.tOff,
      endClapLoggedMs: rawSample.clap2.tOff,
      videoLagMs: 56,
    });

    // THEN — the corrected residual is within ~1ms of the bead's documented measurement, and the 40ms gate passes
    expect(result.correctedResidualMs).toBeCloseTo(-7.3, 0);
    expect(result.pass).toBe(true);
  });

  it('fails the gate when videoLagMs does not explain the residual', () => {
    // GIVEN — the same real fixture pair, but a videoLagMs of 0 (as if lag were never measured/corrected for)
    // WHEN — sync is computed
    const result = computeSync({
      signalStatsText: sigSample,
      startClapLoggedMs: rawSample.clap1.tOff,
      endClapLoggedMs: rawSample.clap2.tOff,
      videoLagMs: 0,
    });

    // THEN — the uncorrected residual (~-63ms) is outside the 40ms tolerance
    expect(result.pass).toBe(false);
  });

  it('throws when the signalstats log does not contain two clapper flashes', () => {
    // GIVEN — a signalstats log edited down to a single frame (no magenta ever appears)
    const oneFrame = 'frame:0    pts:0       pts_time:0\nlavfi.signalstats.SATMIN=5\n';

    // WHEN / THEN — computeSync refuses to guess a sync point from a take with no clapper flashes
    expect(() => computeSync({ signalStatsText: oneFrame, startClapLoggedMs: 0, endClapLoggedMs: 1000, videoLagMs: 0 })).toThrow();
  });
});

describe('findFirstHeartFrame / measureVideoLagFromHeart', () => {
  // Synthetic signalstats output in the same shape ffmpeg's HEART_MASK_FILTER
  // produces (verified live against a real recording: a masked frame with no
  // heart pixel reads YMAX=16, tv-range black; a frame with the heart visible
  // reads YMAX=63).
  function heartFrame(n, tSeconds, ymax) {
    return `frame:${n}    pts:${Math.round(tSeconds * 12800)}       pts_time:${tSeconds}\nlavfi.signalstats.YMAX=${ymax}\n`;
  }

  it('finds the first frame at or after sinceMs whose YMAX crosses the heart threshold', () => {
    // GIVEN — a real-shaped signalstats dump: no heart until frame 3 (t=0.12s)
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.04, 16), heartFrame(2, 0.08, 16), heartFrame(3, 0.12, 63), heartFrame(4, 0.16, 16)].join('');
    const frames = parseSignalStats(text);

    // WHEN — the first heart frame at or after t=0 is located
    const heartMs = findFirstHeartFrame(frames, 0);

    // THEN — it's the frame at t=0.12s (120ms), not an earlier all-black one
    expect(heartMs).toBe(120);
  });

  it('ignores a heart frame before sinceMs (an earlier, unrelated heart)', () => {
    // GIVEN — a heart visible at t=0.08s (an earlier feed heart) and again at t=0.40s (the catch heart)
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.08, 63), heartFrame(2, 0.12, 16), heartFrame(3, 0.4, 63)].join('');
    const frames = parseSignalStats(text);

    // WHEN — searching from sinceMs=200 (after the first heart, before the second)
    const heartMs = findFirstHeartFrame(frames, 200);

    // THEN — the earlier heart at 80ms is skipped; the catch heart at 400ms is found
    expect(heartMs).toBe(400);
  });

  it('returns null when no heart frame appears at or after sinceMs', () => {
    // GIVEN — a signalstats dump with no heart frame at all
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.04, 16)].join('');
    const frames = parseSignalStats(text);

    // WHEN — searching for a heart
    const heartMs = findFirstHeartFrame(frames, 0);

    // THEN — null, not a fabricated 0
    expect(heartMs).toBeNull();
  });

  it('measureVideoLagFromHeart returns the gap between the logged event and the heart actually appearing on screen', () => {
    // GIVEN — a logged catch/eat event at t=350ms, and the heart first visible on screen at t=406ms (a real ~56ms capture lag)
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.35, 16), heartFrame(2, 0.406, 63)].join('');

    // WHEN — the lag is measured
    const lag = measureVideoLagFromHeart({ heartMaskSignalStatsText: text, sinceMs: 350 });

    // THEN — ~56ms, matching the proof render's own documented measurement
    expect(lag).toBeCloseTo(56, 0);
  });

  it('measureVideoLagFromHeart returns null for a take with no heart in the video (a heart-less shot, or one that never rendered)', () => {
    // GIVEN — a signalstats dump with no heart frame after the logged event
    const text = [heartFrame(0, 0, 16), heartFrame(1, 0.35, 16)].join('');

    // WHEN — the lag is measured
    const lag = measureVideoLagFromHeart({ heartMaskSignalStatsText: text, sinceMs: 350 });

    // THEN — null, so the caller falls back per the bead's documented rule (median of kept shots, else 56ms) rather than a fabricated value
    expect(lag).toBeNull();
  });
});

describe('splitGrayFrames / measureVideoLagFromChange', () => {
  // Real-shaped: the popup take's #pet-name crop (inset inside its border),
  // read back from the 25 fps demo.mp4 as 8-bit grey. On a live take the
  // first keystroke ("P" replacing the grey "Rex" placeholder) changed 333
  // device pixels by more than 40 grey levels, the text caret about 60, and
  // nothing else in the field moved between keystrokes.
  const W = 40;
  const H = 20;
  const BG = 247; // #FFF8E8 field background in grey

  function field({ glyphPx = 0, caretPx = 0 } = {}) {
    const px = new Uint8Array(W * H).fill(BG);
    for (let i = 0; i < glyphPx; i++) px[i] = 72; // #484848 text
    for (let i = 0; i < caretPx; i++) px[W * H - 1 - i] = 72;
    return px;
  }

  function framesOf(grays, fps = 25) {
    return splitGrayFrames(Buffer.concat(grays.map((g) => Buffer.from(g))), { width: W, height: H, fps });
  }

  it('splits ffmpeg rawvideo grey output into one frame per width*height bytes, timed on the 25 fps grid', () => {
    /**
     * The lag is read from demo.mp4's own frames, timed exactly as
     * signalstats' pts_time times them (frame n at n/fps), so the popup lag
     * and the heart lag sit on the same axis. If this breaks, every popup lag
     * is off by whole frames.
     */
    // GIVEN — three frames of grey bytes
    const buf = Buffer.concat([Buffer.from(field()), Buffer.from(field()), Buffer.from(field({ glyphPx: 300 }))]);

    // WHEN — they are split
    const frames = splitGrayFrames(buf, { width: W, height: H, fps: 25 });

    // THEN — three frames at 0, 40 and 80 ms, each width*height bytes
    expect(frames.map((f) => f.t)).toEqual([0, 40, 80]);
    expect(frames[2].gray.length).toBe(W * H);
  });

  it('rejects a buffer that is not a whole number of frames', () => {
    /**
     * A truncated ffmpeg read must fail loudly, not shift every later frame.
     */
    // GIVEN — one and a half frames of bytes
    const buf = Buffer.alloc(W * H * 1.5);

    // WHEN / THEN — splitting throws
    expect(() => splitGrayFrames(buf, { width: W, height: H, fps: 25 })).toThrow(/not a whole number of frames/);
  });

  it('returns the gap from the logged keystroke to the first frame that shows the typed text', () => {
    /**
     * videoLagMs for the popup take is measured, like the heart lag on page
     * shots, as the first video frame at or after the logged event that shows
     * its visual result, minus the logged time. If this breaks, the popup
     * borrows or invents its lag again and the clapper check tests nothing.
     */
    // GIVEN — the "P" keystroke logged at 1947.3 ms, first shown in the frame at 2000 ms
    const grays = [];
    for (let n = 0; n < 60; n++) grays.push(n * 40 >= 2000 ? field({ glyphPx: 333, caretPx: 60 }) : field({ caretPx: 60 }));
    const frames = framesOf(grays);

    // WHEN — the lag is measured
    const lag = measureVideoLagFromChange({ frames, sinceMs: 1947.3 });

    // THEN — 52.7 ms
    expect(lag).toBeCloseTo(52.7, 1);
  });

  it('measures from the first frame at or after the log even when the frame just before it already shows the text', () => {
    /**
     * The 25 fps resample can show a change in the grid frame just before the
     * logged time (that frame takes the nearest screencast frame, up to 20 ms
     * after it). The comparison frame is therefore taken one full frame
     * earlier, so the state "text visible" is still found at the first frame
     * at or after the log, as for the heart, and the lag is never negative.
     * If this breaks, that take finds no change until the next keystroke and
     * reports a lag about 100 ms too long.
     */
    // GIVEN — the keystroke logged at 1965 ms, and the text already visible in the 1960 ms frame
    const grays = [];
    for (let n = 0; n < 60; n++) grays.push(n * 40 >= 1960 ? field({ glyphPx: 333 }) : field());
    const frames = framesOf(grays);

    // WHEN — the lag is measured
    const lag = measureVideoLagFromChange({ frames, sinceMs: 1965 });

    // THEN — the 2000 ms frame is the first at or after the log: 35 ms
    expect(lag).toBeCloseTo(35, 6);
  });

  it('ignores a caret-sized change and keeps looking for the typed text', () => {
    /**
     * The caret appears when the field takes focus, right around the first
     * keystroke; it is about 60 device pixels, far below a glyph. If it
     * counted, the lag would be read off the caret instead of the text.
     */
    // GIVEN — the caret appears at 1960 ms and the text at 2040 ms, the keystroke logged at 1950 ms
    const grays = [];
    for (let n = 0; n < 60; n++) {
      const t = n * 40;
      grays.push(field({ caretPx: t >= 1960 ? 60 : 0, glyphPx: t >= 2040 ? 333 : 0 }));
    }
    const frames = framesOf(grays);

    // WHEN — the lag is measured
    const lag = measureVideoLagFromChange({ frames, sinceMs: 1950 });

    // THEN — 90 ms, from the text frame, not 10 ms from the caret frame
    expect(lag).toBeCloseTo(90, 6);
  });

  it('returns null when the field never changes after the logged keystroke', () => {
    /**
     * A take whose typed text never reached the video has no honest lag. If
     * this returned a number, the take would ship with a made-up lag.
     */
    // GIVEN — a field that never changes
    const frames = framesOf(Array.from({ length: 60 }, () => field()));

    // WHEN — the lag is measured
    const lag = measureVideoLagFromChange({ frames, sinceMs: 1950 });

    // THEN — null
    expect(lag).toBeNull();
  });

  it('returns null when no frame lies a full frame before the logged keystroke to compare against', () => {
    /**
     * Without a comparison frame from before the event, any frame would look
     * "changed" or "unchanged" arbitrarily.
     */
    // GIVEN — a keystroke logged at 20 ms, before the second frame
    const frames = framesOf([field(), field({ glyphPx: 333 }), field({ glyphPx: 333 })]);

    // WHEN — the lag is measured
    const lag = measureVideoLagFromChange({ frames, sinceMs: 20 });

    // THEN — null
    expect(lag).toBeNull();
  });

  it('demoMsOf: puts a lag measured at trimBeforeMs + t on the frame that shows the event', () => {
    /**
     * Verifies the axis a recorder measures videoLagMs on: the eval and the
     * edit expect an event on screen at demo.mp4 time trimBeforeMs + t +
     * videoLagMs, with t counted from the start clapper. Measuring from
     * capture start instead (the old origin) puts that prediction a few ms
     * away from the real frame, enough to cross a 40 ms frame boundary.
     */
    // GIVEN — the real popup take's numbers: the start clapper released 690.8 ms and the typed "P" 2683.5 ms
    // after capture start, demo.mp4's clapper release at 680 ms, and the "P" first visible in the 2680 ms frame
    const trimBeforeMs = 680;
    const t = 2683.5 - 690.8;
    const grays = [];
    for (let n = 0; n < 80; n++) grays.push(n * 40 >= 2680 ? field({ glyphPx: 333 }) : field());
    const frames = framesOf(grays);

    // WHEN — the lag is measured at demoMsOf(trimBeforeMs, t)
    const lag = measureVideoLagFromChange({ frames, sinceMs: demoMsOf(trimBeforeMs, t) });

    // THEN — trimBeforeMs + t + lag lands exactly on the 2680 ms frame
    expect(trimBeforeMs + t + lag).toBeCloseTo(2680, 6);
  });
});

describe('findTrimBeforeMs', () => {
  it('reads the start clapper release from the video alone, matching computeSync', () => {
    /**
     * Verifies that trimBeforeMs (demo.mp4 time of the start clapper's
     * release, the events.json t=0) can be read before any lag is known. The
     * recorders need it first: a lag is measured at demo.mp4 time
     * trimBeforeMs + t. If the two disagreed, the lag and the edit would sit
     * on different axes.
     */
    // GIVEN — the proof render's real signalstats output
    // WHEN — trimBeforeMs is read on its own
    const trimBeforeMs = findTrimBeforeMs(sigSample);

    // THEN — 1080 ms, the same value computeSync reports for the same video
    expect(trimBeforeMs).toBe(1080);
    expect(trimBeforeMs).toBe(computeSync({ signalStatsText: sigSample, startClapLoggedMs: 0, endClapLoggedMs: 0, videoLagMs: 0 }).trimBeforeMs);
  });

  it('throws when the video has fewer than two clapper runs', () => {
    /**
     * A take with no visible end clapper cannot be synced. Returning the
     * first run's release anyway would hide a broken capture.
     */
    // GIVEN — signalstats with one magenta run only
    const text = [0, 1, 2, 3].map((n) => `frame:${n} pts:${n} pts_time:${n * 0.04}\nlavfi.signalstats.SATMIN=${n === 1 ? 200 : 0}`).join('\n');

    // WHEN / THEN — it throws
    expect(() => findTrimBeforeMs(text)).toThrow(/expected 2 magenta clapper runs/);
  });
});

describe('findTrimBeforeMsOrDiscard', () => {
  // The s1_inbox/16:9 take that ended win attempt 2 (run 2026-10-03T11-31-44-102Z):
  // 249 frames, the start clapper never reached the 25 fps video, the end
  // clapper sat at frames 241-244.
  const oneRunText = Array.from({ length: 249 }, (_, n) => `frame:${n} pts:${n * 512} pts_time:${(n * 0.04).toFixed(2)}\nlavfi.signalstats.SATMIN=${n >= 241 && n <= 244 ? 133 : 0}`).join('\n');

  it('turns a video with one clapper run into a capture-side discard instead of a throw', () => {
    /**
     * Verifies that a take whose video lost a clapper comes back as a
     * discard marked capture: true, carrying the run count in its message.
     *
     * A missing clapper is a screencast problem (a frame delivered late,
     * a dropped flash), not a property of the seed, so the take must be
     * retried like any other capture failure. Before this, the throw escaped
     * recordShotAspect and ended the whole shot after one take: win attempt
     * 2 lost s1_inbox/16:9 that way.
     */
    // GIVEN — the real failing take's shape: only the end clapper is in the video
    // WHEN — trimBeforeMs is read through the discard-aware helper
    const result = findTrimBeforeMsOrDiscard(oneRunText);

    // THEN — no trim, and a capture-side discard naming what was found
    expect(result.trimBeforeMs).toBeUndefined();
    expect(result.discard).toEqual({ message: 'expected 2 magenta clapper runs (start, end), found 1', capture: true });
  });

  it('never stops a fixed-seed shot however often the clapper goes missing', () => {
    /**
     * Verifies that the discard the helper returns does not count toward the
     * fixed-seed repeat guard (FIXED_SEED_REPEAT_LIMIT).
     *
     * The seed fixes the pets, not the screencast's timing, so a lost
     * clapper says nothing about the seed. If it counted, three unlucky
     * captures would end a fixed-seed shot that a fourth take would pass.
     */
    // GIVEN — a fixed-seed repeat guard and the one-run video
    const guard = createRepeatGuard({ fixedSeed: true });

    // WHEN — five takes in a row lose their clapper
    const stops = Array.from({ length: 5 }, () => guard.record(findTrimBeforeMsOrDiscard(oneRunText).discard));

    // THEN — the guard never asks the shot to stop
    expect(stops).toEqual([null, null, null, null, null]);
  });

  it('returns the same trimBeforeMs as findTrimBeforeMs when both clappers are there', () => {
    /**
     * The helper must change nothing for a good take: the proof render's
     * real signalstats still reads 1080 ms, with no discard.
     */
    // GIVEN — the proof render's real signalstats output
    // WHEN — it is read through the helper
    const result = findTrimBeforeMsOrDiscard(sigSample);

    // THEN — the same 1080 ms trim and no discard
    expect(result).toEqual({ trimBeforeMs: 1080 });
  });
});

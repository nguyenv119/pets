// gif.mjs's pure parts: frame timing, sprite geometry and the colour gate,
// on small hand-built images (the gate's real PASS/FAIL controls run through
// Remotion in scripts/gif-gate-control.mjs; these pin the arithmetic).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { controlVerdict, ENCODES, proofFilter } from './gif-gate-control.mjs';
import {
  assertFramesFromRun,
  candidateSprites,
  checkGif,
  colourGate,
  decodeRgba,
  decodeGifRgb,
  encodeGif,
  erodedMask,
  gifFrameAt,
  gifFrameMoment,
  GIF_SPEC,
  makeGif,
  MAX_COLOUR_ERROR,
  mergePalette,
  MIN_JUDGED_FRAMES,
  petSpriteColours,
  rexColourError,
  spriteLayout,
  spritePath,
  unjudgeable,
} from './gif.mjs';
import { REPO_DIR } from './stage-io.mjs';

let tmp;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const FPS = 12.5;
const SCENES = [
  { shotId: 's1_inbox', fromFrame: 0, frames: 50, sourceInMs: 1000, cropCss: { x: 0, y: 180, w: 960, h: 360 }, captions: [] },
  { shotId: 's2_review', fromFrame: 50, frames: 60, sourceInMs: 2000, cropCss: { x: 0, y: 180, w: 960, h: 360 }, captions: [] },
];

/** A w x h RGBA sprite frame: an opaque `fill` rectangle inset by `pad`, transparent around it. */
function spriteFrame(w, h, pad, fill) {
  const a = new Uint8Array(w * h * 4);
  for (let y = pad; y < h - pad; y++) for (let x = pad; x < w - pad; x++) a.set([...fill, 255], (y * w + x) * 4);
  return a;
}

/** A W x H RGB image of `bg` with the rect filled `fill`. */
function image(W, H, bg, rect, fill) {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    data.set(inside ? fill : bg, (y * W + x) * 3);
  }
  return { width: W, height: H, data };
}

const TAN = [197, 128, 86];
const PAGE = [245, 239, 230];
// a 64x64 sprite, opaque 8..55, drawn into a 32x32 box: scale 0.5, so the opaque part covers GIF px 4..27 of the box
const SPRITE = { w: 64, h: 64, frames: [spriteFrame(64, 64, 8, TAN)] };
const BOX = { x: 100, y: 40, w: 32, h: 32 };
const DRAWN = (dx) => ({ x: 104 + dx, y: 44, w: 24, h: 24 });

describe('gifFrameMoment / gifFrameAt', () => {
  it('maps a GIF frame to its scene and the demo.mp4 ms it shows', () => {
    /**
     * Frame k of a scene shows sourceInMs + (k - fromFrame) * 80 ms of its
     * shot's demo.mp4. A wrong mapping would judge Rex at the wrong box and
     * point qa's treat-frame check at the wrong moment.
     */
    // GIVEN — two scenes at 12.5 fps
    // WHEN
    const m = gifFrameMoment(SCENES, FPS, 55);
    // THEN — frame 55 is 5 frames into s2_review
    expect(m.shotId).toBe('s2_review');
    expect(m.demoMs).toBe(2400);
  });

  it('finds the frame that shows a demo.mp4 moment, and none outside the scene', () => {
    /** qa.mjs picks the GIF's first treat frame this way. */
    // GIVEN / WHEN / THEN
    expect(gifFrameAt(SCENES, FPS, 's1_inbox', 1000 + 7 * 80 + 30)).toBe(7);
    expect(gifFrameAt(SCENES, FPS, 's1_inbox', 900)).toBeNull();
  });
});

describe('spritePath / candidateSprites', () => {
  it('maps a tracked extension URL to the repo sprite', () => {
    /** The gate must compare against the exact sprite the page drew. */
    // GIVEN / WHEN
    const p = spritePath('chrome-extension://abc/assets/dog/brown_swipe_8fps.gif');
    // THEN
    expect(p.endsWith('/assets/dog/brown_swipe_8fps.gif')).toBe(true);
  });

  it('resolves a bare state through the roster entry, and rejects anything else', () => {
    /** The synthetic run logs "walk", not a URL; an unknown src must fail loudly. */
    // GIVEN / WHEN / THEN
    expect(spritePath('walk', { type: 'dog', color: 'brown' }).endsWith('/assets/dog/brown_walk_8fps.gif')).toBe(true);
    expect(() => spritePath('mystery')).toThrow(/cannot map/);
  });

  it('tries the tracked sprite first, then every other state of the same pet', () => {
    /** The screen can show the next state a frame before the track logs it. */
    // GIVEN / WHEN
    const paths = candidateSprites(['chrome-extension://abc/assets/dog/brown_walk_8fps.gif'], undefined);
    // THEN
    expect(paths[0].endsWith('brown_walk_8fps.gif')).toBe(true);
    expect(paths.some((p) => p.endsWith('brown_run_8fps.gif'))).toBe(true);
    expect(paths.every((p) => p.includes('/assets/dog/brown_'))).toBe(true);
  });
});

describe('spriteLayout', () => {
  it('fits the sprite inside the box, centred and resting on its bottom', () => {
    /**
     * object-fit:contain + object-position:bottom (src/renderer.ts): the
     * dog's 115x90 idle sprite in a 64x64 box is 64 wide and sits 13.9 px down.
     */
    // GIVEN / WHEN
    const l = spriteLayout({ x: 0, y: 0, w: 64, h: 64 }, 115, 90);
    // THEN
    expect(l.scale).toBeCloseTo(64 / 115);
    expect(l.offX).toBeCloseTo(0);
    expect(l.offY).toBeCloseTo(64 - 90 * (64 / 115));
  });
});

describe('erodedMask', () => {
  it('keeps only opaque pixels at least r px from transparency', () => {
    /** Edge pixels are where two nearest-neighbour scalings disagree; they are never judged. */
    // GIVEN — a 10x10 frame opaque at 2..7
    const f = spriteFrame(10, 10, 2, TAN);
    // WHEN
    const m = erodedMask(f, 10, 10, 2);
    // THEN — only 4..5 survive
    expect(m.reduce((a, b) => a + b, 0)).toBe(4);
    expect(m[4 * 10 + 4]).toBe(1);
    expect(m[3 * 10 + 4]).toBe(0);
  });
});

describe('rexColourError', () => {
  it('scores an exact sprite colour 0 at the tracked box', () => {
    /** The honest GIF: every opaque Rex pixel is a source colour. */
    // GIVEN — the sprite's opaque square drawn at the box (GIF px 104..127) on a page colour
    const img = image(240, 80, PAGE, DRAWN(0), TAN);
    // WHEN
    const r = rexColourError(img, BOX, [SPRITE]);
    // THEN
    expect(r.worst).toBe(0);
  });

  it('finds Rex a few px from his tracked box', () => {
    /** The track sample and the frame are not taken at the same instant. */
    // GIVEN — the square drawn 20 px right of the tracked box
    const img = image(240, 80, PAGE, DRAWN(20), TAN);
    // WHEN
    const r = rexColourError(img, BOX, [SPRITE]);
    // THEN
    expect(r.worst).toBe(0);
    expect(Math.abs(r.dx - 20)).toBeLessThanOrEqual(2); // the eroded mask fits a px or two either way
  });

  it('reports a colour shift in full, whatever the placement', () => {
    /**
     * The FAIL control's failure: an untagged encode shifts sprite colours.
     * The gate must report the shift, not find a placement that hides it.
     */
    // GIVEN — the square drawn 12 units off in red
    const img = image(240, 80, PAGE, DRAWN(0), [TAN[0] + 12, TAN[1], TAN[2]]);
    // WHEN
    const r = rexColourError(img, BOX, [SPRITE]);
    // THEN
    expect(r.worst).toBe(12);
    expect(r.worst).toBeGreaterThan(MAX_COLOUR_ERROR);
  });

  it('returns null when no placement covers enough opaque pixels', () => {
    /** A box at the image's edge cannot be judged and must not count as a pass. */
    // GIVEN — the box entirely below the image
    const img = image(240, 80, PAGE);
    // WHEN / THEN
    expect(rexColourError(img, { x: 100, y: 200, w: 32, h: 32 }, [SPRITE])).toBeNull();
  });
});

describe('unjudgeable', () => {
  const events = { observed: [{ kind: 'eat', t: 1000 }], cursorTrack: [{ t: 0, x: 500, y: 400 }] };
  const box = { x: 100, y: 100, w: 64, h: 64 };
  const crop = { x: 0, y: 180 };

  it('skips frames while the extension\'s particles may cover Rex', () => {
    /** The 🍖 and ❤️ particles are drawn over his box for about 1.5 s. */
    // GIVEN / WHEN / THEN
    expect(unjudgeable({ events, tMs: 1500, box, cropCss: crop })).toMatch(/particles/);
    expect(unjudgeable({ events, tMs: 4000, box, cropCss: crop })).toBeNull();
  });

  it('skips frames where the drawn cursor is over him', () => {
    /** The arrow is not a sprite colour; judging it would fail an honest GIF. */
    // GIVEN — the cursor at CSS (130, 300) = GIF (130, 120)
    const ev = { observed: [], cursorTrack: [{ t: 0, x: 130, y: 300 }] };
    // WHEN / THEN
    expect(unjudgeable({ events: ev, tMs: 4000, box, cropCss: crop })).toMatch(/cursor/);
  });

  it('skips frames where another tracked pet is within reach', () => {
    /** A pet drawn over Rex hides his pixels; the wide search could also land on it. */
    // GIVEN / WHEN / THEN
    expect(unjudgeable({ events: { observed: [] }, tMs: 4000, box, cropCss: crop, others: [{ x: 150, y: 100, w: 64, h: 64 }] })).toMatch(/another pet/);
  });
});

describe('colourGate', () => {
  it('fails when too few frames are judgeable', () => {
    /** A gate that judged nothing must never pass (no vacuous PASS). */
    // GIVEN — one scene whose shot has no Rex track
    const scenes = [{ ...SCENES[0], frames: 3 }];
    const eventsByShotId = { s1_inbox: { trimBeforeMs: 0, videoLagMs: 0, tracks: [], observed: [] } };
    // WHEN
    const g = colourGate({ scenes, fps: FPS, totalFrames: 3, eventsByShotId, frameAt: () => image(10, 10, PAGE), loadSprite: () => SPRITE });
    // THEN
    expect(g.judged).toBe(0);
    expect(g.failures.join()).toMatch(new RegExp(`need ${MIN_JUDGED_FRAMES}`));
  });
});

describe('colourGate on a colour-shifted Rex', () => {
  it('fails every judged frame where his pixels are 12 units off his sprite', () => {
    /**
     * The FAIL control's failure end to end through the gate: an untagged
     * encode shifts Rex's fur 12 RGB units. If the gate passed this, a GIF
     * with visibly wrong sprite colours would ship in the README.
     */
    // GIVEN — 25 frames, Rex tracked at CSS (100, 220) = GIF px (100, 40), drawn 12 units too red
    const scenes = [{ shotId: 's1_inbox', fromFrame: 0, frames: 25, sourceInMs: 0, cropCss: { x: 0, y: 180, w: 960, h: 360 }, captions: [] }];
    const tracks = Array.from({ length: 60 }, (_, i) => ({ t: i * 40, pets: [{ id: 'rex', x: 100, y: 220, w: 32, h: 32, src: 'chrome-extension://x/assets/dog/brown_idle_8fps.gif' }] }));
    const eventsByShotId = { s1_inbox: { trimBeforeMs: 0, videoLagMs: 0, tracks, observed: [], cursorTrack: [], roster: [{ id: 'rex', type: 'dog', color: 'brown' }] } };
    const shifted = image(240, 80, PAGE, DRAWN(0), [TAN[0] + 12, TAN[1], TAN[2]]);
    // WHEN
    const g = colourGate({ scenes, fps: FPS, totalFrames: 25, eventsByShotId, frameAt: () => shifted, loadSprite: () => SPRITE });
    // THEN
    expect(g.judged).toBe(25);
    expect(g.worst).toBe(12);
    expect(g.failures).toHaveLength(25);
    expect(g.failures[0]).toBe('frame 0 (s1_inbox): an opaque Rex pixel is 12 RGB units from his source frame\'s colours');
  });
});

describe('assertFramesFromRun', () => {
  it('accepts frames render-manifest.json says came from this run', () => {
    /** The honest pipeline: stage 2 rendered the gif frames from the run stage 4 encodes. */
    // GIVEN / WHEN / THEN
    expect(() => assertFramesFromRun('/v/build/run-1', { variants: { gif: { run: 'run-1' } } })).not.toThrow();
  });

  it('rejects frames from another run, or with no manifest entry', () => {
    /**
     * out/gif-frames left over from the synthetic run or the gate control
     * would otherwise be encoded and published as this run's GIF.
     */
    // GIVEN / WHEN / THEN
    expect(() => assertFramesFromRun('/v/build/run-1', { variants: { gif: { run: 'synthetic' } } })).toThrow(/rendered from run "synthetic", not run-1/);
    expect(() => assertFramesFromRun('/v/build/run-1', { variants: {} })).toThrow(/rendered from run "undefined"/);
  });
});

describe('proofFilter', () => {
  it.each(['tagged', 'untagged'])('%s: cuts the v1 proof capture to the v2 16:9 capture before its own encode filter', (variant) => {
    /**
     * What: both control encodes crop the 1920x1080 proof frames to the bottom 1920x872 (CSS y 104-540), the
     * same cut make-synthetic-run gives the fixture's 16:9 stand-in, and only then apply the variant's filter.
     * Why: the synthetic run's events put the pets on the v2 floor (CSS y 372); uncropped v1 proof footage has
     * them at y 476, so the gate would compare Rex's tracked box with the wrong pixels.
     * What breaks: the PASS control fails on geometry, not colour, and the control no longer tests the gate.
     */
    // GIVEN — the variant's own encode filter
    const own = ENCODES[variant][1];
    // WHEN
    const vf = proofFilter(variant);
    // THEN
    expect(vf).toBe(`tpad=stop_mode=clone:stop_duration=2,crop=1920:872:0:208,${own}`);
  });
});

describe('controlVerdict', () => {
  const gate = (failures, worst = 1) => ({ ok: !failures.length, report: { gate: { failures, worst } } });
  const shift = ['frame 3 (s1_inbox): an opaque Rex pixel is 11 RGB units from his source frame\'s colours'];

  it('is empty when the tagged encode passes and the untagged one fails on colour', () => {
    /** The gate separates the two encodes: the proof the bead asks for. */
    // GIVEN / WHEN / THEN
    expect(controlVerdict({ tagged: gate([]), untagged: gate(shift, 11) })).toEqual([]);
  });

  it('reports a PASS control that failed the gate', () => {
    /** A gate that fails honest footage would block every real run. */
    // GIVEN / WHEN / THEN
    expect(controlVerdict({ tagged: gate(['only 3 frames judgeable (need 20)']), untagged: gate(shift, 11) }).join()).toMatch(/tagged \(PASS control\) failed the gate/);
  });

  it('reports a FAIL control that passed, or failed only for a reason other than colour', () => {
    /** An untagged GIF that fails on too few judged frames proves nothing about colour. */
    // GIVEN / WHEN / THEN
    expect(controlVerdict({ tagged: gate([]), untagged: gate([], 1) }).join()).toMatch(/untagged \(FAIL control\) passed the gate with worst error 1/);
    expect(controlVerdict({ tagged: gate([]), untagged: gate(['only 3 frames judgeable (need 20)'], 2) }).join()).toMatch(/untagged \(FAIL control\) passed/);
  });

  it('reports a control that never reached the gate', () => {
    /** A render failure is not a gate verdict either way. */
    // GIVEN / WHEN / THEN
    expect(controlVerdict({ tagged: { ok: false, error: 'render failed' }, untagged: gate(shift, 11) }).join()).toMatch(/never reached the gate: render failed/);
  });
});

describe('checkGif', () => {
  const probeOf = (w, h, d) => ({ streams: [{ codec_type: 'video', width: w, height: h }], format: { duration: String(d) } });

  it('passes an 8.6 s 960x360 GIF under the byte limit', () => {
    /** The spec comes from shots.json variants.readme_gif. */
    // GIVEN / WHEN / THEN
    expect(GIF_SPEC.size).toEqual({ width: 960, height: 360 });
    expect(checkGif(1_400_000, probeOf(960, 360, 8.6))).toEqual([]);
  });

  it('fails each of size, dimensions and length', () => {
    /** Each limit on its own must fail the GIF, not only all of them together. */
    // GIVEN / WHEN / THEN
    expect(checkGif(GIF_SPEC.maxBytes, probeOf(960, 360, 8.6))).toEqual([`${GIF_SPEC.maxBytes} bytes, want under ${GIF_SPEC.maxBytes}`]);
    expect(checkGif(1_000, probeOf(1920, 720, 8.6))).toEqual(['1920x720, want 960x360']);
    expect(checkGif(1_000, probeOf(960, 360, 6.9))).toEqual(['6.90 s, want 7-10.5 s']);
  });
});

describe('makeGif (real ffmpeg, a tiny spec)', () => {
  // GIVEN (shared) — a 32x16 GIF spec, so the source frames are 64x32; no Rex track, so the gate judges nothing
  const spec = { maxBytes: 10, size: { width: 32, height: 16 }, seconds: [7, 10.5] };
  const plan = (totalFrames) => ({
    scenes: [{ shotId: 's1_inbox', fromFrame: 0, frames: totalFrames, sourceInMs: 0, cropCss: { x: 0, y: 0, w: 32, h: 16 }, captions: [] }],
    fps: FPS,
    totalFrames,
    eventsByShotId: { s1_inbox: { trimBeforeMs: 0, videoLagMs: 0, tracks: [], observed: [] } },
  });
  function frames(n, size) {
    tmp = mkdtempSync(join(tmpdir(), 'gif-make-'));
    const dir = join(tmp, 'frames');
    mkdirSync(dir);
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=12.5`, '-frames:v', String(n), '-start_number', '0', join(dir, 'frame-%04d.png')]);
    return dir;
  }

  it('fails a GIF over the byte limit and outside the length window, listing both', () => {
    /**
     * makeGif must throw on its spec failures (not just report them), so the
     * pipeline stops at stage 4 rather than shipping an oversized or
     * too-short GIF.
     */
    // GIVEN — 3 frames (0.24 s) against a 10-byte limit
    const dir = frames(3, '64x32');
    // WHEN
    let err;
    try {
      makeGif({ runDir: tmp, framesDir: dir, outPath: join(tmp, 'out.gif'), manifest: null, plan: plan(3), spec });
    } catch (e) {
      err = e;
    }
    // THEN
    expect(err.report.width).toBe(32);
    expect(err.report.specFailures).toEqual([`${err.report.bytes} bytes, want under 10`, '0.24 s, want 7-10.5 s']);
    expect(err.message).toMatch(/want under 10.*0\.24 s.*only 0 frames judgeable/);
  });

  it('refuses frames that are not twice the GIF size', () => {
    /** Non-integer nearest-neighbour scaling breaks text strokes; only an exact halving is allowed. */
    // GIVEN — 48x32 frames for a 32x16 GIF
    const dir = frames(3, '48x32');
    // WHEN / THEN
    expect(() => makeGif({ runDir: tmp, framesDir: dir, outPath: join(tmp, 'out.gif'), manifest: null, plan: plan(3), spec })).toThrow('gif: frames are 48x32, not 64x32');
  });

  it('refuses a frame count that differs from the scene plan', () => {
    /** A partial render would otherwise be encoded as a shorter GIF. */
    // GIVEN — 3 frames where the plan has 4
    const dir = frames(3, '64x32');
    // WHEN / THEN
    expect(() => makeGif({ runDir: tmp, framesDir: dir, outPath: join(tmp, 'out.gif'), manifest: null, plan: plan(4), spec })).toThrow(/holds 3 frames; the scene plan has 4/);
  });
});

describe('rexAt', () => {
  it('returns no box when the nearest track is further than the gap limit', async () => {
    /**
     * Verifies a tracking gap never stands in a stale box: when the nearest
     * track sample is more than 80 ms from the moment asked for, rexAt
     * returns null, so the colour gate and qa's provenance check fail the
     * frame instead of judging a box Rex may have left.
     */
    // GIVEN — one track sample at t=0 with Rex in it
    const { rexAt } = await import('./gif.mjs');
    const events = { tracks: [{ t: 0, pets: [{ id: 'rex', x: 10, y: 10, w: 64, h: 64, src: 'idle' }] }] };
    const crop = { x: 0, y: 0 };

    // WHEN — asked 50 ms and 200 ms later
    const near = rexAt(events, 50, crop);
    const far = rexAt(events, 200, crop);

    // THEN — the near one finds Rex, the far one finds nothing
    expect(near?.box).toEqual({ x: 10, y: 10, w: 64, h: 64 });
    expect(far).toBeNull();
  });
});

describe('mergePalette', () => {
  it('keeps every reserved colour, even when the generated palette is full', () => {
    /**
     * The reserved colours are the pets' exact sprite colours; a palette that
     * dropped one would map that sprite pixel to its nearest neighbour, the
     * drift the colour gate fails (10 units on the dark s2_review scene).
     */
    // GIVEN — a full 256-colour generated palette and 3 reserved colours, one already in it
    const generated = Array.from({ length: 256 }, (_, i) => i * 1000);
    const reserved = [0xc9d2d9, 0xf38b95, 5000];

    // WHEN
    const pal = mergePalette(generated, reserved);

    // THEN — 256 entries, every reserved colour among them, no duplicates
    expect(pal).toHaveLength(256);
    for (const c of reserved) expect(pal).toContain(c);
    expect(new Set(pal).size).toBe(256);
  });

  it('pads a short palette to 256 entries without inventing colours', () => {
    /** paletteuse reads a 16x16 palette image; padding must repeat a real colour, not add black. */
    // GIVEN — 2 generated colours (palettegen repeats its last one), 1 reserved
    // WHEN
    const pal = mergePalette([0x102030, 0x405060, 0x405060], [0xabcdef]);

    // THEN
    expect(pal).toHaveLength(256);
    expect(new Set(pal)).toEqual(new Set([0xabcdef, 0x102030, 0x405060]));
  });

  it('refuses more than 256 reserved colours', () => {
    /** A GIF palette holds 256 colours; silently dropping a reserved one would defeat the reservation. */
    // GIVEN / WHEN / THEN
    expect(() => mergePalette([], Array.from({ length: 257 }, (_, i) => i))).toThrow(/257 reserved colours/);
  });
});

describe('petSpriteColours', () => {
  it('returns every opaque colour of every state of each rostered pet', () => {
    /**
     * The palette reserves these, so each must be exact: Rex's 22 sprite
     * colours (every state shares one palette per pet) and nothing else.
     */
    // GIVEN — the cast roster entry for Rex, and the real sprite files
    const roster = [{ id: 'rex', type: 'dog', color: 'brown' }];

    // WHEN
    const colours = petSpriteColours(roster);

    // THEN — every opaque colour of brown_idle's first frame is in there
    const idle = decodeRgba(join(REPO_DIR, 'assets', 'dog', 'brown_idle_8fps.gif'));
    const want = new Set();
    for (let p = 0; p < idle.frames[0].length; p += 4) if (idle.frames[0][p + 3] === 255) want.add((idle.frames[0][p] << 16) | (idle.frames[0][p + 1] << 8) | idle.frames[0][p + 2]);
    for (const c of want) expect(colours).toContain(c);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('is empty for an empty roster', () => {
    /** The tests' tiny scene plans carry no roster; the encode must still run. */
    expect(petSpriteColours(undefined)).toEqual([]);
  });
});

describe('encodeGif (real ffmpeg)', () => {
  /** Writes GIF-size images (W x H RGB arrays of packed colours) as 2x source PNGs, every GIF px a 2x2 block. */
  function writeFrames(images, W, H) {
    tmp = mkdtempSync(join(tmpdir(), 'gif-enc-'));
    const dir = join(tmp, 'frames');
    mkdirSync(dir);
    const buf = Buffer.alloc(images.length * W * H * 12);
    images.forEach((img, f) => {
      for (let y = 0; y < 2 * H; y++) for (let x = 0; x < 2 * W; x++) {
        const c = img[Math.floor(y / 2) * W + Math.floor(x / 2)];
        buf.set([c >> 16, (c >> 8) & 255, c & 255], f * W * H * 12 + (y * 2 * W + x) * 3);
      }
    });
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${2 * W}x${2 * H}`, '-r', '12.5', '-i', '-', '-start_number', '0', join(dir, 'frame-%04d.png')], { input: buf });
    return dir;
  }
  /** Worst per-channel error of GIF frame `k` against the packed image it was made from. */
  function worstError(gif, img) {
    let worst = 0;
    for (let i = 0; i < img.length; i++) {
      const o = i * 3;
      const c = img[i];
      worst = Math.max(worst, Math.abs(gif.data[o] - (c >> 16)), Math.abs(gif.data[o + 1] - ((c >> 8) & 255)), Math.abs(gif.data[o + 2] - (c & 255)));
    }
    return worst;
  }
  /** Deterministic pseudo-random packed colours. */
  function randomColours(n, seed) {
    let s = seed;
    return Array.from({ length: n }, () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s & 0xffffff;
    });
  }

  it('gives each scene its own palette, so a scene never loses colours to another', () => {
    /**
     * The README GIF has a light page scene and a dark one. One palette over
     * both starved the dark scene: its colours went 10-80 units off (Rex
     * failed the colour gate; green code text came out beige). With one
     * palette per scene, each scene's 200 colours fit and come out exact.
     */
    // GIVEN — two scenes of 2 frames each, 200 distinct colours apiece (400 together, over one palette's 256)
    const W = 20;
    const H = 10;
    const a = randomColours(W * H, 1);
    const b = randomColours(W * H, 2);
    const dir = writeFrames([a, a, b, b], W, H);
    const out = join(tmp, 'out.gif');

    // WHEN
    encodeGif(dir, out, FPS, [{ fromFrame: 0, frames: 2, reserve: [] }, { fromFrame: 2, frames: 2, reserve: [] }]);

    // THEN — every frame decodes to its source colours (within the 1 unit the halving's rounding adds)
    const gif = decodeGifRgb(out);
    expect(gif).toHaveLength(4);
    for (const [k, img] of [a, a, b, b].entries()) expect(worstError(gif[k], img)).toBeLessThanOrEqual(1);
  });

  it("builds the first scene's palette from that scene's frames only, even when a later scene moves", () => {
    /**
     * palettegen's frame limit must bound its input. As an output limit
     * (`-frames:v` after `-i`) it still read every frame to the end of the
     * sequence, so the first scene's palette also counted the next scene's
     * colours once that scene had motion, and starved the first scene. The
     * static-scene test above can't see this: stats_mode=diff counts nothing
     * for a frame identical to the one before it.
     */
    // GIVEN — a static scene of 200 colours, then a moving scene of 200 other colours (the same colours shuffled between its two frames)
    const W = 20;
    const H = 10;
    const a = randomColours(W * H, 1);
    const b1 = randomColours(W * H, 2);
    const b2 = [...b1.slice(1), b1[0]];
    const dir = writeFrames([a, a, b1, b2], W, H);
    const out = join(tmp, 'out.gif');

    // WHEN
    encodeGif(dir, out, FPS, [{ fromFrame: 0, frames: 2, reserve: [] }, { fromFrame: 2, frames: 2, reserve: [] }]);

    // THEN — every frame of both scenes decodes to its source colours (within the halving's 1 unit)
    const gif = decodeGifRgb(out);
    expect(gif).toHaveLength(4);
    for (const [k, img] of [a, a, b1, b2].entries()) expect(worstError(gif[k], img)).toBeLessThanOrEqual(1);
  });

  it('keeps a reserved colour exact in a scene with more colours than a palette holds', () => {
    /**
     * A sprite pixel of a colour the page barely uses gets merged into a
     * neighbour by palettegen. Reserving the pets' sprite colours keeps them
     * exact whatever the page around them does.
     */
    // GIVEN — 800 distinct colours crowded around the reserved one, which fills just 1 GIF px
    const W = 40;
    const H = 20;
    const REX = 0xc9d2d9;
    const img = randomColours(W * H, 7).map((r) => REX + (((r >> 16) % 40) - 20) * 65536 + ((((r >> 8) & 255) % 40) - 20) * 256 + ((r & 255) % 40) - 20);
    img[0] = REX;
    const dir = writeFrames([img], W, H);
    const reserved = join(tmp, 'reserved.gif');
    const plain = join(tmp, 'plain.gif');

    // WHEN — encoded with and without the reservation
    encodeGif(dir, reserved, FPS, [{ fromFrame: 0, frames: 1, reserve: [REX] }]);
    encodeGif(dir, plain, FPS, [{ fromFrame: 0, frames: 1, reserve: [] }]);

    // THEN — reserved, that pixel is within the halving's 1 unit; unreserved (the control), it drifts further
    const drift = (path) => Math.max(...[...decodeGifRgb(path)[0].data.subarray(0, 3)].map((v, i) => Math.abs(v - [0xc9, 0xd2, 0xd9][i])));
    expect(drift(reserved)).toBeLessThanOrEqual(1);
    expect(drift(plain)).toBeGreaterThan(1);
  });
});

// qa.mjs: the pure checks on probe-shaped and events-shaped inputs, and the
// GIF provenance check on real ffmpeg (made-up footage, plus the real
// footage's controls when a run is on disk).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSpeciesAllowlist } from '../src/species.node.ts';
import { checkGif, FRAMES_DIR, planScenes } from './gif.mjs';
import {
  checkAdoption,
  checkCut,
  checkGifProvenance,
  checkLufs,
  checkManifest,
  CUTS,
  FORBIDDEN,
  forbiddenInRosters,
  missingKinds,
  PROVENANCE_SSIM_MIN,
  regionSsim,
  rexRegion,
  treatMoment,
} from './qa.mjs';
import { BUILD_DIR, OUT_DIR, VIDEO_DIR } from './stage-io.mjs';

let tmp;
/** Test footage filter: stripes that move 29 px every 40 ms frame, so no two neighbouring frames look alike over Rex's box. */
const STRIPES = "geq=lum='mod(X+Y+N*29\\,64)*4':cb=128:cr=128";
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const probeOf = ({ w, h, vcodec = 'h264', acodec = 'aac', d }) => ({
  streams: [{ codec_type: 'video', codec_name: vcodec, width: w, height: h }, ...(acodec ? [{ codec_type: 'audio', codec_name: acodec }] : [])],
  format: { duration: String(d) },
});

describe('checkCut', () => {
  it('passes a 29.4 s 1920x1080 h264 + aac master', () => {
    /** The store, YouTube and the eval all need exactly this shape. */
    // GIVEN / WHEN / THEN
    expect(checkCut('16x9', probeOf({ w: 1920, h: 1080, d: 29.4 }), CUTS['16x9'])).toEqual([]);
  });

  it('fails a silent master and one past 30.0 s', () => {
    /** A render that lost its music, or a fetch that ran long, must stop the run. */
    // GIVEN / WHEN
    const bad = checkCut('16x9', probeOf({ w: 1920, h: 1080, acodec: null, d: 30.2 }), CUTS['16x9']);
    // THEN
    expect(bad.join()).toMatch(/audio missing/);
    expect(bad.join()).toMatch(/30.20 s/);
  });

  it('fails a master at the wrong size', () => {
    /** A 1280x720 render would upload, but the store and the eval want 1920x1080. */
    // GIVEN / WHEN
    const bad = checkCut('16x9', probeOf({ w: 1280, h: 720, d: 29.4 }), CUTS['16x9']);
    // THEN
    expect(bad).toEqual(['16x9: video h264 1280x720, want h264 1920x1080']);
  });

  it('fails a master in the wrong codecs', () => {
    /** A VP9 or Opus master would not play everywhere the cuts are posted. */
    // GIVEN / WHEN
    const bad = checkCut('16x9', probeOf({ w: 1920, h: 1080, vcodec: 'vp9', acodec: 'opus', d: 29.4 }), CUTS['16x9']);
    // THEN
    expect(bad).toEqual(['16x9: video vp9 1920x1080, want h264 1920x1080', '16x9: audio opus, want aac']);
  });

  it('allows the 9:16 cut up to 30.5 s', () => {
    /** The vertical cut's window (variants.vertical_9x16.expected_length_s) is wider than the master's. */
    // GIVEN / WHEN / THEN
    expect(checkCut('9x16', probeOf({ w: 1080, h: 1920, d: 30.4 }), CUTS['9x16'])).toEqual([]);
  });

  it('fails a v2 cut under 27.3 s', () => {
    /** With b1b cut the film runs about 28 s; a shorter cut lost a beat, and the eval fails it. */
    // GIVEN / WHEN
    const bad = checkCut('16x9', probeOf({ w: 1920, h: 1080, d: 27.2 }), CUTS['16x9']);
    // THEN
    expect(bad.join()).toMatch(/27.20 s/);
  });
});

describe('checkLufs / checkGif', () => {
  it('holds loudness to -18..-14 LUFS', () => {
    /** Tighter than the eval's -20..-12, so a pass here leaves margin there. */
    // GIVEN / WHEN / THEN
    expect(checkLufs('16x9', -16.1)).toEqual([]);
    expect(checkLufs('16x9', -19)).toHaveLength(1);
  });

  it('fails a cut louder than -14 LUFS', () => {
    /** A cut left too loud would be turned down by YouTube and clip on phones. */
    // GIVEN / WHEN / THEN
    expect(checkLufs('9x16', -13)).toEqual(['9x16: -13 LUFS integrated, want -18..-14']);
  });

  it('fails a 5 MB GIF and one outside 7-10.5 s, using gif.mjs\'s check', () => {
    /** The README GIF must load fast and loop at about 8.6 s; qa and the gif stage judge it the same way. */
    // GIVEN / WHEN
    const bad = checkGif(5_000_000, probeOf({ w: 960, h: 360, acodec: null, d: 28 }));
    // THEN
    expect(bad).toEqual(['5000000 bytes, want under 5000000', '28.00 s, want 7-10.5 s']);
  });
});

describe('checkManifest', () => {
  const sources = { s1_inbox: 'aa', s2_review: 'bb' };
  const manifest = (run) => ({ variants: Object.fromEntries(['16x9', '9x16', 'gif', 'still'].map((v) => [v, { run, sources }])) });
  const hashOf = (_v, id) => sources[id];

  it('passes when every variant names this run and hashes to its recordings', () => {
    /** The GIF and thumbnail must come from this run, not the synthetic one. */
    // GIVEN / WHEN / THEN
    expect(checkManifest(manifest('run-1'), 'run-1', hashOf)).toEqual([]);
  });

  it('fails a variant rendered from another run', () => {
    /** A GIF left over from the synthetic run names "synthetic". */
    // GIVEN
    const m = manifest('run-1');
    m.variants.gif.run = 'synthetic';
    // WHEN / THEN
    expect(checkManifest(m, 'run-1', hashOf).join()).toMatch(/gif was rendered from run synthetic/);
  });

  it('fails a source whose recording changed', () => {
    /** Same run id, different footage (a re-recorded shot) must not pass. */
    // GIVEN / WHEN / THEN
    expect(checkManifest(manifest('run-1'), 'run-1', (v, id) => (id === 's2_review' ? 'zz' : sources[id])).join()).toMatch(/s2_review is not this run's recording/);
  });
});

describe('recorder checks', () => {
  it('lists the kinds no shot observed', () => {
    /** The film promises waving, chasing, catching, eating, greeting and sleeping. */
    // GIVEN
    const evs = [{ observed: [{ kind: 'wave' }, { kind: 'eat' }] }, { observed: [{ kind: 'chase_start' }, { kind: 'catch' }, { kind: 'greet' }] }, null];
    // WHEN / THEN
    expect(missingKinds(evs)).toEqual(['sleep']);
  });

  it('checks the adoption: a white chicken named Pip joins Rex and Bao', () => {
    /** The adoption beat is the epic's proof that the popup really adds a pet. */
    // GIVEN
    const ok = { observed: [{ kind: 'type_selected', type: 'chicken' }, { kind: 'color_selected', color: 'white' }, { kind: 'roster_saved', roster: [{ name: 'Rex' }, { name: 'Bao' }, { name: 'Pip' }] }] };
    const wrong = { observed: [{ kind: 'type_selected', type: 'fox' }, { kind: 'color_selected', color: 'white' }] };
    // WHEN / THEN
    expect(checkAdoption(ok)).toEqual([]);
    expect(checkAdoption(wrong)).toHaveLength(2);
  });

  it('forbids exactly the species src/species.node.ts never casts', async () => {
    /**
     * FORBIDDEN is a copy (the frozen source is only reachable through an
     * async loader). If the two drifted, qa would pass a roster the
     * recorder was told never to seed.
     */
    // GIVEN / WHEN
    const { neverCastTypes } = await loadSpeciesAllowlist();
    // THEN
    expect(FORBIDDEN).toEqual([...neverCastTypes]);
  });

  it('finds an uncast species in a roster or the saved roster', () => {
    /** Totoro, Miffy, fox, cockatiel, monkey and horse are never cast. */
    // GIVEN
    const evs = [{ roster: [{ type: 'dog' }] }, { roster: [], observed: [{ kind: 'roster_saved', roster: [{ type: 'fox' }] }] }];
    // WHEN / THEN
    expect(forbiddenInRosters(evs)).toEqual(['fox']);
  });
});

describe('treatMoment', () => {
  it('finds the GIF frame showing the inbox heart_on, and the moment that frame shows', () => {
    /**
     * qa compares this frame with this run's recording at the moment the
     * frame itself shows, not the heart's own moment: GIF frames sit on an
     * 80 ms grid, so the heart can fall up to 40 ms (one recording frame)
     * either side of the frame that shows it.
     */
    // GIVEN — the scene starts at demo 2000 ms; the heart is logged at 1500, trim 760, lag 40 -> demo 2300
    const scenes = [{ shotId: 's1_inbox', fromFrame: 0, frames: 60, sourceInMs: 2000 }];
    const events = { trimBeforeMs: 760, videoLagMs: 40, observed: [{ kind: 'heart_on', t: 1500 }] };
    // WHEN
    const t = treatMoment(scenes, 12.5, events);
    // THEN — 300 ms in = frame 4 (3.75 rounded), which shows 2000 + 4 x 80 = 2320
    expect(t).toEqual({ k: 4, demoMs: 2320, heartMs: 2300 });
  });

  it('puts a heart halfway between two GIF frames on the later frame\'s own moment (the win4 shape)', () => {
    /**
     * Win attempt 4: the heart showed at demo 7480 ms, halfway between GIF
     * frames showing 7440 and 7520. Frame 35 (7520) was rendered, but qa
     * compared it with the recording at 7480, one recording frame early,
     * and an honest run failed at SSIM 0.75.
     */
    // GIVEN — scene from demo 4720 ms (frame 0); heart logged at 6782.9 with trim 680 and lag 17.1 -> demo 7480
    const scenes = [{ shotId: 's1_inbox', fromFrame: 0, frames: 60, sourceInMs: 4720 }];
    const events = { trimBeforeMs: 680, videoLagMs: 17.1, observed: [{ kind: 'heart_on', t: 6782.9 }] };
    // WHEN
    const t = treatMoment(scenes, 12.5, events);
    // THEN — 2760 ms in = 34.5 frames -> frame 35, which shows 4720 + 35 x 80 = 7520
    expect(t.k).toBe(35);
    expect(t.demoMs).toBeCloseTo(7520, 6);
    expect(t.heartMs).toBeCloseTo(7480, 6);
  });

  it('returns null when the scene shows no heart', () => {
    /** No treat on screen means the provenance check cannot run: qa fails it. */
    // GIVEN / WHEN / THEN
    expect(treatMoment([{ shotId: 's1_inbox', fromFrame: 0, frames: 5, sourceInMs: 0 }], 12.5, { trimBeforeMs: 0, videoLagMs: 0, observed: [{ kind: 'heart_on', t: 9000 }] })).toBeNull();
  });
});

describe('regionSsim', () => {
  it('compares the still with the one recording frame at `seconds`, not an average with the next', () => {
    /**
     * ffmpeg's ssim filter repeats a still input against every video frame
     * it decodes before -frames:v stops it, and its "All:" summary is the
     * mean. Unbounded, a frame at t scored mean(t, t + 40 ms): win attempt
     * 4's 0.748 was mean(0.496, 1.000).
     */
    // GIVEN — footage that changes every frame, and a still of the frame at 1.04 s
    tmp = mkdtempSync(join(tmpdir(), 'qa-ssim-'));
    const demo = join(tmp, 'demo.mp4');
    const ff = (...args) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args]);
    ff('-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=25:d=2,${STRIPES}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', demo);
    const png = join(tmp, 'still.png');
    ff('-ss', '1.04', '-i', demo, '-frames:v', '1', '-vf', 'crop=1920:720:0:360', png);
    const band = { x: 0, y: 180, w: 960, h: 360 };
    const region = { x: 400, y: 220, w: 64, h: 64 };
    // WHEN
    const same = regionSsim(png, demo, 1.04, band, region);
    const before = regionSsim(png, demo, 1.0, band, region);
    // THEN
    expect(same).toBeGreaterThan(0.99);
    expect(before).toBeLessThan(PROVENANCE_SSIM_MIN);
  });
});

describe('checkGifProvenance (real ffmpeg, made-up footage)', () => {
  // GIVEN (shared) — the inbox scene starts at demo 0 ms; the heart is logged at 1000 ms with no trim or lag,
  // so GIF frame 13 (12.5 rounded up) shows demo 1.040 s; Rex is tracked at CSS (400, 400), band px (400, 220)
  const BAND = { x: 0, y: 180, w: 960, h: 360 };
  const scenes = [{ shotId: 's1_inbox', fromFrame: 0, frames: 25, sourceInMs: 0, cropCss: BAND, captions: [] }];
  const events = { trimBeforeMs: 0, videoLagMs: 0, observed: [{ kind: 'heart_on', t: 1000 }], tracks: [{ t: 1000, pets: [{ id: 'rex', x: 400, y: 400, w: 64, h: 64 }] }] };
  const ff = (...args) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args]);
  /**
   * A 2 s 1920x1080 25 fps recording of moving test footage, and a GIF source
   * frame (the band at DPR 2) cut from `source` at `atS` (default 1.04 s, the
   * moment frame 13 shows).
   */
  function footage(source, { atS = 1.04, stripes = false } = {}) {
    tmp = mkdtempSync(join(tmpdir(), 'qa-provenance-'));
    const demo = join(tmp, 'demo.mp4');
    ff('-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=25:d=2${stripes ? `,${STRIPES}` : ''}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', demo);
    const src = source === 'other' ? join(tmp, 'other.mp4') : demo;
    if (source === 'other') ff('-f', 'lavfi', '-i', 'mandelbrot=s=1920x1080:r=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src);
    ff('-ss', String(atS), '-i', src, '-frames:v', '1', '-vf', `crop=1920:720:0:${BAND.y * 2}`, join(tmp, 'frame-0013.png'));
    return demo;
  }

  it('passes a GIF frame cut from this recording at the treat moment', () => {
    /**
     * The honest case: the GIF was rendered from this run, so its treat frame
     * is this recording at that moment. A false failure here would block
     * every real pipeline run at stage 8.
     */
    // GIVEN
    const demo = footage('same');
    // WHEN
    const r = checkGifProvenance({ scenes, fps: 12.5, events, framesDir: tmp, demoMp4: demo });
    // THEN
    expect(r.bad).toEqual([]);
    expect(r.info).toMatch(/SSIM (0\.9|1)/);
  });

  it('fails a GIF frame cut from other footage', () => {
    /**
     * A GIF rendered from the synthetic run or the fixture shows other
     * footage at that moment. If this passed, the README could ship a GIF
     * that was never filmed from the real extension.
     */
    // GIVEN
    const demo = footage('other');
    // WHEN
    const r = checkGifProvenance({ scenes, fps: 12.5, events, framesDir: tmp, demoMp4: demo });
    // THEN
    expect(r.bad.join()).toMatch(new RegExp(`treat frame 13 matches this run's s1_inbox at SSIM 0\\.\\d+, want >= ${PROVENANCE_SSIM_MIN}`));
  });

  it('passes the honest frame when the heart falls between two GIF frames (the win4 shape)', () => {
    /**
     * Win attempt 4's honest run failed here: the heart showed 20 ms before
     * the frame that shows it, qa compared the frame with the recording at
     * the heart's moment (the wrong recording frame) and footage that changes
     * every frame scored far below 0.8. Comparing at the frame's own moment
     * finds the very pixels the frame was rendered from.
     */
    // GIVEN — footage that changes every frame; the heart at 1020 ms, so frame 13 (12.75 rounded) shows 1.040 s
    const demo = footage('same', { stripes: true });
    const heartBetween = { ...events, observed: [{ kind: 'heart_on', t: 1020 }], tracks: [{ t: 1020, pets: [{ id: 'rex', x: 400, y: 400, w: 64, h: 64 }] }] };
    // WHEN
    const r = checkGifProvenance({ scenes, fps: 12.5, events: heartBetween, framesDir: tmp, demoMp4: demo });
    // THEN
    expect(r.bad).toEqual([]);
    expect(r.info).toMatch(/@ 1\.040 s .*SSIM (0\.99|1)/);
  });

  it('fails a GIF frame one recording frame off, so the check still resolves single frames', () => {
    /**
     * The honest frame scores ~1 only on its own recording frame. A GIF drawn
     * 40 ms early (a stale or mistimed render) must not pass: comparing one
     * frame against one frame keeps the check sharp to a single frame.
     */
    // GIVEN — frame 13 cut at 1.00 s, one 25 fps frame before the 1.04 s it should show
    const demo = footage('same', { atS: 1.0, stripes: true });
    // WHEN
    const r = checkGifProvenance({ scenes, fps: 12.5, events, framesDir: tmp, demoMp4: demo });
    // THEN
    expect(r.bad.join()).toMatch(/treat frame 13 matches this run's s1_inbox at SSIM 0\.[0-7]/);
  });

  it('fails when the treat frame is missing, never passing on nothing', () => {
    /** An empty or stale out/gif-frames must not score NaN and slip through. */
    // GIVEN — the recording, but no frame-0013.png
    const demo = footage('same');
    rmSync(join(tmp, 'frame-0013.png'));
    // WHEN
    const r = checkGifProvenance({ scenes, fps: 12.5, events, framesDir: tmp, demoMp4: demo });
    // THEN
    expect(r.bad).toEqual([`GIF provenance: ${join(tmp, 'frame-0013.png')} is missing`]);
  });

  it('fails when Rex is not tracked at the treat', () => {
    /** Without his box there is no region to compare; that is a failure, not a skip. */
    // GIVEN
    const demo = footage('same');
    // WHEN
    const r = checkGifProvenance({ scenes, fps: 12.5, events: { ...events, tracks: [] }, framesDir: tmp, demoMp4: demo });
    // THEN
    expect(r.bad.join()).toMatch(/Rex is not tracked/);
  });
});

// The provenance controls on real footage: the run out/gif-frames was rendered
// from (render-manifest.json), the synthetic run and the fixture. build/,
// out/ and .cache/ are gitignored, so this runs only where a run is on disk.
const manifestPath = join(OUT_DIR, 'render-manifest.json');
const gifRun = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).variants?.gif : null;
const runDir = gifRun ? join(BUILD_DIR, gifRun.run) : null;
const runDemo = runDir ? join(runDir, 's1_inbox', 'demo.mp4') : null;
const syntheticDemo = join(VIDEO_DIR, '.cache', 'synthetic-run', 's1_inbox', 'demo.mp4');
const fixtureDemo = join(VIDEO_DIR, 'fixtures', 'demo.sample.mp4');
const realFootage =
  !!runDemo && existsSync(runDemo) && existsSync(syntheticDemo) && existsSync(FRAMES_DIR) &&
  createHash('sha256').update(readFileSync(runDemo)).digest('hex') === gifRun.sources?.s1_inbox;

describe.skipIf(!realFootage)('provenance controls (real footage on disk)', () => {
  it('separates this run from the synthetic run, the fixture and its own neighbouring recording frames over Rex\'s box', () => {
    /**
     * The check must accept only this run's footage at the frame's own
     * moment. v2 run 2026-10-03T15-20-57-905Z, treat frame 35 at 6.320 s,
     * Rex's box 64x64 at band px (552, 296): this run 1.000; the synthetic
     * run's and the fixture's footage 0.208 and 0.200; this run -80, -40,
     * +40 and +80 ms 0.474, 1.000, 0.506, 0.499.
     * One neighbouring frame can match: the sprites animate at 8 fps (125 ms
     * a sprite frame), so a 40 ms step can land on the same sprite frame
     * (v1 measured 0.539 there, v2 1.000). The time control is therefore the
     * worst of the four neighbours: at least one must fail, or the check
     * could not tell the right moment from the wrong one. (v1's band-wide
     * synthetic control scored 0.839; the v2 dark inbox no longer looks like
     * the fixture's page, so that blind spot is gone and is not asserted.)
     */
    // GIVEN — the treat frame of the GIF out/gif-frames holds, and Rex's box at that moment
    const { scenes, fps, eventsByShotId } = planScenes(runDir);
    const ev = eventsByShotId.s1_inbox;
    const t = treatMoment(scenes, fps, ev);
    const band = scenes.find((s) => s.shotId === 's1_inbox').cropCss;
    const rex = rexRegion(ev, t.demoMs, band);
    const png = join(FRAMES_DIR, `frame-${String(t.k).padStart(4, '0')}.png`);
    const at = (demo, offsetS = 0) => regionSsim(png, demo, t.demoMs / 1000 + offsetS, band, rex);
    // WHEN
    const match = at(runDemo);
    const synthetic = at(syntheticDemo);
    const fixture = at(fixtureDemo);
    const neighbours = [-0.08, -0.04, 0.04, 0.08].map((o) => at(runDemo, o));
    // THEN
    expect(match).toBeGreaterThanOrEqual(PROVENANCE_SSIM_MIN);
    expect(synthetic).toBeLessThan(PROVENANCE_SSIM_MIN);
    expect(fixture).toBeLessThan(PROVENANCE_SSIM_MIN);
    expect(Math.min(...neighbours)).toBeLessThan(PROVENANCE_SSIM_MIN);
  });
});

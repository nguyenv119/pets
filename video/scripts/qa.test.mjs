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

  it('fails a silent master and one past 31.0 s', () => {
    /** A render that lost its music, or a fetch that ran long, must stop the run. */
    // GIVEN / WHEN
    const bad = checkCut('16x9', probeOf({ w: 1920, h: 1080, acodec: null, d: 31.2 }), CUTS['16x9']);
    // THEN
    expect(bad.join()).toMatch(/audio missing/);
    expect(bad.join()).toMatch(/31.20 s/);
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

  it('allows the 9:16 cut up to 31.5 s', () => {
    /** The vertical cut's window is wider than the master's. */
    // GIVEN / WHEN / THEN
    expect(checkCut('9x16', probeOf({ w: 1080, h: 1920, d: 31.4 }), CUTS['9x16'])).toEqual([]);
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
  it('finds the GIF frame showing the inbox heart_on, shifted by the lag', () => {
    /**
     * qa compares this frame with this run's recording at the same moment:
     * a GIF rendered from other footage scores far lower there.
     */
    // GIVEN — the scene starts at demo 2000 ms; the heart is logged at 1500, trim 760, lag 40 -> demo 2300
    const scenes = [{ shotId: 's1_inbox', fromFrame: 0, frames: 60, sourceInMs: 2000 }];
    const events = { trimBeforeMs: 760, videoLagMs: 40, observed: [{ kind: 'heart_on', t: 1500 }] };
    // WHEN
    const t = treatMoment(scenes, 12.5, events);
    // THEN — 300 ms in = frame 4 (3.75 rounded)
    expect(t).toEqual({ k: 4, demoMs: 2300 });
  });

  it('returns null when the scene shows no heart', () => {
    /** No treat on screen means the provenance check cannot run: qa fails it. */
    // GIVEN / WHEN / THEN
    expect(treatMoment([{ shotId: 's1_inbox', fromFrame: 0, frames: 5, sourceInMs: 0 }], 12.5, { trimBeforeMs: 0, videoLagMs: 0, observed: [{ kind: 'heart_on', t: 9000 }] })).toBeNull();
  });
});

describe('checkGifProvenance (real ffmpeg, made-up footage)', () => {
  // GIVEN (shared) — the inbox scene starts at demo 0 ms; the heart is logged at 1000 ms with no trim or lag,
  // so GIF frame 13 (12.5 rounded up) shows demo 1.000 s; Rex is tracked at CSS (400, 400), band px (400, 220)
  const BAND = { x: 0, y: 180, w: 960, h: 360 };
  const scenes = [{ shotId: 's1_inbox', fromFrame: 0, frames: 25, sourceInMs: 0, cropCss: BAND, captions: [] }];
  const events = { trimBeforeMs: 0, videoLagMs: 0, observed: [{ kind: 'heart_on', t: 1000 }], tracks: [{ t: 1000, pets: [{ id: 'rex', x: 400, y: 400, w: 64, h: 64 }] }] };
  const ff = (...args) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args]);
  /** A 2 s 1920x1080 recording of moving test footage, and a GIF source frame cut from `source` at 1.0 s (the band at DPR 2). */
  function footage(source) {
    tmp = mkdtempSync(join(tmpdir(), 'qa-provenance-'));
    const demo = join(tmp, 'demo.mp4');
    ff('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', demo);
    const src = source === 'other' ? join(tmp, 'other.mp4') : demo;
    if (source === 'other') ff('-f', 'lavfi', '-i', 'mandelbrot=s=1920x1080:r=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src);
    ff('-ss', '1', '-i', src, '-frames:v', '1', '-vf', `crop=1920:720:0:${BAND.y * 2}`, join(tmp, 'frame-0013.png'));
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
  it('separates this run from the synthetic run and the fixture over Rex\'s box, where the whole band could not', () => {
    /**
     * Why the check crops to Rex: measured on the dry run
     * (build/2026-10-03T12-00-00-000Z-dry, proof footage), treat frame 169
     * at demo 15.891 s, Rex's box 64x64 at band px (698, 296):
     *   over Rex's box     this run 0.952   synthetic = fixture 0.450   this run 80 ms early 0.455
     *   over the whole band this run 0.994   synthetic = fixture 0.977
     * The synthetic run's s1_inbox IS the fixture's demo.sample.mp4 (same
     * sha256). The page background fills the band, so a band-wide 0.8 passed
     * any footage of the inbox page; over Rex's box 0.8 sits 0.15 below the
     * match and 0.35 above the wrong footage.
     */
    // GIVEN — the treat frame of the GIF out/gif-frames holds, and Rex's box at that moment
    const { scenes, fps, eventsByShotId } = planScenes(runDir);
    const ev = eventsByShotId.s1_inbox;
    const t = treatMoment(scenes, fps, ev);
    const band = scenes.find((s) => s.shotId === 's1_inbox').cropCss;
    const rex = rexRegion(ev, t.demoMs, band);
    const png = join(FRAMES_DIR, `frame-${String(t.k).padStart(4, '0')}.png`);
    const at = (demo, offsetS = 0, region = rex) => regionSsim(png, demo, t.demoMs / 1000 + offsetS, band, region);
    // WHEN
    const match = at(runDemo);
    const synthetic = at(syntheticDemo);
    const fixture = at(fixtureDemo);
    const early = at(runDemo, -0.08);
    const wholeBandSynthetic = at(syntheticDemo, 0, { x: 0, y: 0, w: band.w, h: band.h });
    // THEN
    expect(match).toBeGreaterThanOrEqual(PROVENANCE_SSIM_MIN);
    expect(synthetic).toBeLessThan(PROVENANCE_SSIM_MIN);
    expect(fixture).toBeLessThan(PROVENANCE_SSIM_MIN);
    expect(early).toBeLessThan(PROVENANCE_SSIM_MIN);
    expect(wholeBandSynthetic).toBeGreaterThanOrEqual(PROVENANCE_SSIM_MIN); // the old crop's blind spot
  });
});

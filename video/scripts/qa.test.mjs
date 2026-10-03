// qa.mjs's pure checks, on probe-shaped and events-shaped inputs.

import { describe, expect, it } from 'vitest';
import { checkAdoption, checkCut, checkGif, checkLufs, checkManifest, CUTS, forbiddenInRosters, missingKinds, treatMoment } from './qa.mjs';

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

  it('fails a 5 MB GIF and one outside 7-10.5 s', () => {
    /** The README GIF must load fast and loop at about 8.6 s. */
    // GIVEN / WHEN
    const bad = checkGif(5_000_000, probeOf({ w: 960, h: 360, acodec: null, d: 28 }));
    // THEN
    expect(bad).toHaveLength(2);
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

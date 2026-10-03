import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShots, validateEvents, validateTimeline, type SpeciesAllowlist } from './schema';
import { loadSpeciesAllowlist } from './species.node';
import { parseAnchor } from './anchors';

const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(VIDEO_DIR, relPath), 'utf-8'));
}

let species: SpeciesAllowlist;

beforeAll(async () => {
  species = await loadSpeciesAllowlist();
});

describe('validateShots — PASS controls', () => {
  it('accepts the real video/shots.json', () => {
    /**
     * Verifies that the approved shot list (copied verbatim from
     * .claude/loop-evals/pets-o3p/approved-shots.json) validates against
     * this bead's own schema.
     *
     * This matters because shots.json is the contract pets-o3p.2/.3/.4 all
     * build against; if the schema this bead ships can't even validate the
     * file it was written to describe, every later bead inherits a broken
     * contract with no signal.
     *
     * If this contract breaks, a later bead's own validation silently
     * passes malformed data because the checker itself was never proven
     * against the real file.
     */
    // GIVEN — the real, frozen shots.json and the extension's real species list
    const shots = readJson('shots.json');

    // WHEN — validated
    const errors = validateShots(shots, species);

    // THEN — no errors
    expect(errors).toEqual([]);
  });

  it('accepts fixtures/shots.sample.json', () => {
    /**
     * Verifies the fixture shot file used by later beads' own tests also
     * validates, so a broken fixture never masquerades as a working sample.
     *
     * If this contract breaks, pets-o3p.3's accept.mjs tests (which read
     * this fixture) exercise a shape the schema itself rejects.
     */
    // GIVEN — the fixture shots file
    const shots = readJson('fixtures/shots.sample.json');

    // WHEN — validated
    const errors = validateShots(shots, species);

    // THEN — no errors
    expect(errors).toEqual([]);
  });
});

describe('validateEvents — PASS controls', () => {
  it('accepts fixtures/events.sample.json', () => {
    /**
     * Verifies the normalised recording fixture (from the 2026-09-27 proof
     * render) validates: known kinds only, roster entries carry type and
     * colour, a monotonic cursorTrack, and every observed[].t inside
     * [0, durationMs].
     *
     * If this contract breaks, every consumer of this fixture (anchor
     * resolution tests, later beads' own recorder tests) builds on data the
     * schema itself considers malformed.
     */
    // GIVEN — the normalised events fixture
    const events = readJson('fixtures/events.sample.json');

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — no errors
    expect(errors).toEqual([]);
  });
});

describe('every sfx/font/icon path named in video/shots.json exists', () => {
  it('resolves every referenced asset path relative to video/', () => {
    /**
     * Verifies every `sfx/...`, `fonts/...` and `assets/icons/...` path
     * shots.json names under conventions.sfx_root actually exists on disk.
     *
     * This matters because shots.json is frozen after this bead (README.md)
     * — pets-o3p.3/.4 read these paths at render time with no fallback, so
     * a missing file fails a real render hours into a recording session
     * instead of at scaffold time.
     *
     * If this contract breaks, pets-o3p.4's render crashes on a missing sfx
     * file deep into a pipeline run instead of failing this fast test.
     */
    // GIVEN — the real shots.json, walked for every sfx `file` and overlay `icon` path
    const shots = readJson('shots.json') as Record<string, unknown>;
    const paths = new Set<string>();

    function walk(node: unknown): void {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if ((key === 'file' || key === 'icon') && typeof value === 'string') {
            paths.add(value);
          }
          walk(value);
        }
      }
    }
    walk(shots);

    // WHEN — each path is checked, rooted at conventions.sfx_root ("video/assets")
    // for sfx/font files and at the repo root for the overlay icon
    const sfxRoot = join(VIDEO_DIR, 'assets');
    const repoRoot = join(VIDEO_DIR, '..');
    const missing = [...paths].filter((p) => {
      if (p.startsWith('sfx/') || p.startsWith('fonts/')) {
        return !existsSync(join(sfxRoot, p));
      }
      // e.g. "assets/icons/icon-128.png" is rooted at the repo root
      return !existsSync(join(repoRoot, p));
    });

    // THEN — nothing missing
    expect(missing).toEqual([]);
    expect(paths.size).toBeGreaterThan(0);
  });
});

describe('sample accept[] strings are verbatim from video/shots.json', () => {
  it('every fixture accept rule text occurs in the real shots.json', () => {
    /**
     * Verifies fixtures/shots.sample.json never invents accept-rule prose:
     * every string in its accept[] arrays is copied character-for-character
     * from video/shots.json's own accept[] arrays.
     *
     * This matters because pets-o3p.3's accept.mjs is one predicate per
     * rule TEXT — if a fixture's rule text drifts from the real file even
     * by one character, that predicate silently never matches the fixture,
     * so the fixture's PASS/FAIL controls test nothing.
     *
     * If this contract breaks, a fixture accept string with a typo passes
     * schema validation but is invisible to the real accept-rule matcher.
     */
    // GIVEN — every accept[] string in the real shots.json
    const realShots = readJson('shots.json') as { shots: Array<{ accept: string[] }> };
    const realRules = new Set(realShots.shots.flatMap((shot) => shot.accept));

    // WHEN — every accept[] string in the sample fixture is checked for membership
    const sampleShots = readJson('fixtures/shots.sample.json') as { shots: Array<{ accept: string[] }> };
    const sampleRules = sampleShots.shots.flatMap((shot) => shot.accept);

    // THEN — every sample rule is a verbatim real rule
    for (const rule of sampleRules) {
      expect(realRules.has(rule)).toBe(true);
    }
    expect(sampleRules.length).toBeGreaterThan(0);
  });
});

describe('validateShots — FAIL controls', () => {
  it('rejects a roster entry casting the never-cast species totoro', () => {
    /**
     * Verifies a seed roster naming totoro (third-party Ghibli character IP
     * with no licence covering a promo, per
     * .claude/marketing-video/research/sprite-licences.md) is rejected.
     *
     * If this contract breaks, a shots.json edit could cast Totoro on
     * camera with no test catching it before a real recording runs.
     */
    // GIVEN — a shots document whose roster casts totoro
    const shots = {
      shots: [{ id: 'bad', seed: { roster: [{ id: 'x', name: 'X', type: 'totoro', color: 'default' }] } }],
    };

    // WHEN — validated
    const errors = validateShots(shots, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('totoro'))).toBe(true);
  });

  it('rejects a roster entry casting the never-cast species fox', () => {
    /**
     * Verifies a seed roster naming fox (CC BY-NC with a no-redistribution
     * clause, per sprite-licences.md) is rejected.
     *
     * If this contract breaks, a rights-encumbered sprite could ship in the
     * public promo video with no test catching it.
     */
    // GIVEN — a shots document whose roster casts fox
    const shots = { shots: [{ id: 'bad', seed: { roster: [{ id: 'x', name: 'X', type: 'fox', color: 'red' }] } }] };

    // WHEN — validated
    const errors = validateShots(shots, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('fox'))).toBe(true);
  });

  it('rejects an unknown species', () => {
    /**
     * Verifies a roster entry naming a type the extension does not ship
     * (not in src/types.ts's PetType union) is rejected, rather than
     * silently passed through to a recorder that has no sprite for it.
     *
     * If this contract breaks, a typo'd species name fails only at record
     * time, far from where the mistake was made.
     */
    // GIVEN — a shots document whose roster names a nonexistent species
    const shots = {
      shots: [{ id: 'bad', seed: { roster: [{ id: 'x', name: 'X', type: 'dragon', color: 'green' }] } }],
    };

    // WHEN — validated
    const errors = validateShots(shots, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('unknown species'))).toBe(true);
  });

  it('rejects a beat whose camera.sample is "card" with no card declared', () => {
    /**
     * Verifies a shots.json beat that claims to sample the popup card
     * (camera.sample: "card") but declares no `card` object is rejected.
     *
     * This matters because the edit (pets-o3p.4) branches its whole
     * rendering path on camera.sample === 'card' vs a page zoom; a beat
     * that claims 'card' with nothing to render would silently fall
     * through to undefined behaviour in the edit.
     *
     * If this contract breaks, the edit crashes (or worse, silently
     * renders a blank frame) on a beat this validator should have caught
     * at scaffold time.
     */
    // GIVEN — a shots document with a card-sampled beat but no card
    const shots = {
      shots: [
        {
          id: 'bad',
          seed: { roster: [] },
          beats: [{ name: 'b_bad', camera: { sample: 'card' } }],
        },
      ],
    };

    // WHEN — validated
    const errors = validateShots(shots, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('camera.sample is "card"'))).toBe(true);
  });
});

describe('validateEvents — FAIL controls', () => {
  it('rejects an observed event with an unknown kind', () => {
    /**
     * Verifies an observed[] entry whose kind is outside the closed
     * ObservedKind vocabulary is rejected, rather than silently accepted
     * and later mismatched by every consumer's exhaustive switch.
     *
     * If this contract breaks, a typo'd kind string (e.g. "ball_ON") from a
     * recorder bug reaches the edit as an unrecognised event with no error.
     */
    // GIVEN — an events document with an unrecognised observed kind
    const events = { durationMs: 1000, observed: [{ t: 10, kind: 'not_a_real_kind' }] };

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('unknown kind'))).toBe(true);
  });

  it('rejects a cursorTrack that goes back in time', () => {
    /**
     * Verifies a cursorTrack whose t values are not monotonically
     * non-decreasing is rejected.
     *
     * This matters because the edit's cursor-drawing code assumes a
     * forward-only timeline to interpolate positions; a track that jumps
     * backward would make the drawn cursor visibly teleport.
     *
     * If this contract breaks, a corrupted recording (e.g. a merged/
     * reordered log) produces a visibly broken cursor with no test having
     * caught the bad input.
     */
    // GIVEN — an events document with a cursorTrack that goes backward
    const events = {
      durationMs: 1000,
      cursorTrack: [
        { t: 100, x: 1, y: 1 },
        { t: 50, x: 2, y: 2 },
      ],
    };

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('back in time'))).toBe(true);
  });

  it('rejects an observed event after durationMs', () => {
    /**
     * Verifies an observed[] entry whose t exceeds durationMs (it follows
     * the end clapper, per shots.json's clapperboard convention) is
     * rejected.
     *
     * If this contract breaks, a post-clapper artifact could leak into the
     * edit's anchor resolution and land a caption or sfx after the take
     * actually ends.
     */
    // GIVEN — an events document with a kind observed after durationMs
    const events = { durationMs: 1000, observed: [{ t: 1500, kind: 'sleep' }] };

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('outside [0'))).toBe(true);
  });

  it('accepts an event before the start clapper that is still inside demo.mp4', () => {
    /**
     * Verifies event times are measured from the start clapper's release:
     * an event logged before it (pets_ready, a boot greet) has a negative t
     * and is valid while trimBeforeMs + t >= 0, i.e. still inside demo.mp4.
     *
     * The eval and the edit both place an event at demo.mp4 time
     * trimBeforeMs + t. Forcing t >= 0 pushed recorders to measure t from
     * capture start instead, which put every event ~trimBeforeMs late.
     */
    // GIVEN — a take whose clapper releases 680 ms into demo.mp4
    const events = { durationMs: 4000, trimBeforeMs: 680, observed: [{ t: -600, kind: 'pets_ready' }] };

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — accepted
    expect(errors).toEqual([]);
  });

  it('rejects an event earlier than the start of demo.mp4', () => {
    /**
     * Verifies the lower bound is -trimBeforeMs: an event before demo.mp4's
     * first frame cannot be shown, so a t that far back is a time-base bug.
     */
    // GIVEN — an event 700 ms before a clapper that releases 680 ms in
    const events = { durationMs: 4000, trimBeforeMs: 680, observed: [{ t: -700, kind: 'pets_ready' }] };

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('outside [-680'))).toBe(true);
  });

  it('rejects a roster entry with no type or color', () => {
    /**
     * Verifies an events.roster entry missing `type` or `color` is
     * rejected, rather than silently producing a roster the edit cannot
     * resolve to a sprite.
     *
     * If this contract breaks, a recorder bug that drops a roster field
     * only surfaces as a blank sprite render, far from the actual cause.
     */
    // GIVEN — an events document whose roster entry has no type
    const events = { durationMs: 1000, roster: [{ id: 'x', name: 'X', color: 'brown' }] };

    // WHEN — validated
    const errors = validateEvents(events, species);

    // THEN — rejected
    expect(errors.some((e) => e.includes('missing type'))).toBe(true);
  });
});

describe('validateTimeline — FAIL controls', () => {
  it('rejects a card with no frames', () => {
    /**
     * Verifies a Timeline beat whose card declares no frames[] is rejected.
     *
     * This matters because the edit renders the popup card frame-by-frame
     * from card.frames; an empty or missing frames array means nothing to
     * render for that beat's whole duration, silently producing a blank
     * (or crashing) output rather than a caught scaffold-time error.
     *
     * If this contract breaks, the edit produces a blank card beat with no
     * error pointing back to the missing frames.
     */
    // GIVEN — a timeline with a card that declares no frames
    const timeline = {
      beats: [
        {
          name: 'b3c_shelter',
          card: { crop: 'A_list', rect: { x: 0, y: 0, w: 1, h: 1 }, scale: 1, at: { x: 0, y: 0 }, frames: [] },
        },
      ],
    };

    // WHEN — validated
    const errors = validateTimeline(timeline);

    // THEN — rejected
    expect(errors.some((e) => e.includes('no frames'))).toBe(true);
  });
});

// v2 contract (pets-3it.1): the approved v2 shot list every later v2 bead and the eval read.
describe('video/shots.json is the v2 contract', () => {
  type V2Shots = {
    viewport: { width: number; height: number; device_scale_factor: number };
    master: { stage: Record<string, unknown>; music: { bed: string; credit: string }; expected_length_s: [number, number] };
    shots: Array<{ id: string; beats: Array<{ name: string; caption_out?: string; overlay?: { from?: string } }>; crops?: Record<string, { card_scale_native?: number; measured_native_500x960?: { w: number; h: number } }> }>;
    overlays: { popup_card: { placement: Record<string, unknown> & { steady_at: Record<string, Record<string, { x: number; y: number }>> } } };
    variants: { vertical_9x16: Record<string, unknown> & { viewport: { width: number; height: number; device_scale_factor: number } } };
  };
  const shots = () => readJson('shots.json') as V2Shots;

  it('has no b1b beat', () => {
    /**
     * Verifies the cut beat b1b ("he's not helping.") is gone from every shot.
     * The edit renders every declared beat, so a leftover b1b puts the cut caption back on screen.
     */
    // GIVEN — every beat name in the real shots.json
    const names = shots().shots.flatMap((s) => s.beats.map((b) => b.name));

    // WHEN — the b1b names are picked out
    const b1b = names.filter((n) => n.startsWith('b1b'));

    // THEN — none, while the other beats are still there
    expect(b1b).toEqual([]);
    expect(names).toContain('b1c_name');
  });

  it('starts the name tag as b1a\'s caption leaves', () => {
    /**
     * Verifies the name tag takes over b1b's slot: it starts on the same anchor as b1a's
     * caption_out, at most 200 ms later. A later start leaves a dead gap where b1b used to be.
     */
    // GIVEN — s1's b1a and b1c beats
    const s1 = shots().shots.find((s) => s.id === 's1_inbox')!;
    const b1a = s1.beats.find((b) => b.name === 'b1a_open')!;
    const b1c = s1.beats.find((b) => b.name === 'b1c_name')!;

    expect(b1a.caption_out).toBeDefined();
    expect(b1c.overlay?.from).toBeDefined();

    // WHEN — both anchors are parsed
    const out = parseAnchor(b1a.caption_out!);
    const from = parseAnchor(b1c.overlay!.from!);

    // THEN — same event, 0-200 ms after the caption leaves
    expect(out.kind).toBe('event');
    expect(from.kind).toBe('event');
    if (from.kind !== 'event' || out.kind !== 'event') return;
    expect(from.event).toBe(out.event);
    expect(from.offsetMs - out.offsetMs).toBeGreaterThanOrEqual(0);
    expect(from.offsetMs - out.offsetMs).toBeLessThanOrEqual(200);
  });

  it('declares no floor band in the master stage or the 9:16', () => {
    /**
     * Verifies the cream floor band is gone: the pets stand on the frame bottom.
     * A leftover band key or cream colour would make the stage draw the band again.
     */
    // GIVEN — the master stage and the 9:16 variant
    const doc = shots();

    // WHEN — both are serialised
    const text = JSON.stringify([doc.master.stage, doc.variants.vertical_9x16]);

    // THEN — no band key, no band cream, and the floor line is the frame bottom
    expect(text).not.toMatch(/floor_band|"band"|FFE3B0/i);
    expect(doc.master.stage.floor_line_stage_y).toBe(1080);
    expect(doc.master.stage.page_stage_y).toEqual([208, 1080]);
  });

  it('records the 16:9 at 960x436, DPR 2', () => {
    /**
     * Verifies the 16:9 viewport under the 104 CSS px chrome: 104 + 436 = 540 CSS px,
     * so chrome plus page fill 1920x1080 at DPR 2.
     */
    // GIVEN / WHEN — the declared 16:9 viewport
    const { viewport } = shots();

    // THEN — exactly the v2 size
    expect(viewport).toEqual({ width: 960, height: 436, device_scale_factor: 2 });
  });

  it('records the 9:16 at 540x856, DPR 2', () => {
    /**
     * Verifies the 9:16 viewport under the 104 CSS px chrome: 104 + 856 = 960 CSS px,
     * so chrome plus page fill 1080x1920 at DPR 2.
     */
    // GIVEN / WHEN — the declared 9:16 viewport
    const { viewport } = shots().variants.vertical_9x16;

    // THEN — exactly the v2 size
    expect(viewport).toEqual({ width: 540, height: 856, device_scale_factor: 2 });
  });

  it('names music 03 and its credit', () => {
    /**
     * Verifies the bed is "Funny and Cute Town Theme" and the credit carries the artist, site and licence;
     * OGA-BY 3.0 requires attribution, so the credit must be complete.
     */
    // GIVEN / WHEN — the master's music block
    const { music } = shots().master;

    // THEN — the track file and every credit element
    expect(music.bed).toMatch(/funny_and_cute_town_theme\.ogg$/);
    for (const part of ['Funny and Cute Town Theme', 'ISAo', 'SOUND AIRYLUVS', 'https://airyluvs.com/', 'OGA-BY 3.0']) {
      expect(music.credit).toContain(part);
    }
  });

  it('keeps the expected master length inside the 27.3-30.0 s window', () => {
    /** With b1b cut the film runs about 28 s; an expected range outside the window fails the eval. */
    // GIVEN / WHEN — the declared expected length
    const [lo, hi] = shots().master.expected_length_s;

    // THEN — inside the window
    expect(lo).toBeGreaterThanOrEqual(27.3);
    expect(hi).toBeLessThanOrEqual(30.0);
  });

  it('hangs every steady card from the toolbar icon, clamped inside the frame', () => {
    /**
     * Verifies each steady_at spot follows the placement rule: x = min(icon centre x, frame w - 40 - card w),
     * y = min(top, frame h - card h), even pixels. Card sizes come from s2b's measured crops at their
     * integer scales, so a typo'd spot (or a card that leaves the frame) fails here, not in a render.
     */
    // GIVEN — the measured crops and both aspects' placements
    const doc = shots();
    const crops = doc.shots.find((s) => s.id === 's2b_shelter')!.crops!;
    const frames: Record<string, { w: number; h: number }> = { '16x9': { w: 1920, h: 1080 }, '9x16': { w: 1080, h: 1920 } };

    for (const aspect of ['16x9', '9x16']) {
      const anchor = (doc.overlays.popup_card.placement[aspect] as { anchor: { icon_cx: number; top: number; margin_x: number } }).anchor;
      for (const crop of ['A_list', 'B_pick', 'C_add']) {
        const c = crops[crop];
        const w = c.measured_native_500x960!.w * c.card_scale_native!;
        const h = c.measured_native_500x960!.h * c.card_scale_native!;

        // WHEN — the rule is applied
        const x = Math.min(anchor.icon_cx, frames[aspect].w - anchor.margin_x - w);
        const y = Math.min(anchor.top, frames[aspect].h - h);

        // THEN — steady_at is that spot, on even pixels, inside the frame
        expect(doc.overlays.popup_card.placement.steady_at[aspect][crop], `${aspect} ${crop}`).toEqual({ x, y });
        expect(x % 2 === 0 && y % 2 === 0 && x >= 0 && y + h <= frames[aspect].h).toBe(true);
      }
    }
  });
  it('ties the chrome, pinned icon, card anchors and card scales together', () => {
    /**
     * Verifies the derived numbers agree with the ones they come from: chrome output height is 2x its
     * CSS height and is where the page starts, the icon's output centre and bottom are 2x its CSS box,
     * each card anchor uses that icon centre and sits 8 px below the toolbar, and every card scale is an
     * integer. If one drifts, the card hangs from a spot that is not the icon, or the page overlaps the chrome.
     */
    // GIVEN — the master stage, both placements, both viewports and every declared card scale
    const raw = readJson('shots.json') as {
      viewport: { width: number };
      master: { stage: { chrome: { css_h: number; out_h: number; pinned_icon_css: { x: number; y: number; w: number; h: number }; pinned_icon_out: { cx_16x9: number; cx_9x16: number; cy: number; bottom: number }; toolbar_bottom_out: number }; page_stage_y: [number, number] } };
      overlays: { popup_card: { placement: Record<string, { anchor?: { icon_cx: number; top: number } }> } };
      shots: Array<{ id: string; crops?: Record<string, { card_scale_native?: number }> }>;
      variants: { vertical_9x16: { viewport: { width: number }; shots: { s2b_shelter: { card_scale_native: Record<string, number> } } } };
    };
    const { chrome, page_stage_y } = raw.master.stage;
    const css = chrome.pinned_icon_css;
    const out = chrome.pinned_icon_out;
    // the icon is right-anchored in the toolbar, so the narrow window moves it left by the width difference
    const narrowShift = raw.viewport.width - raw.variants.vertical_9x16.viewport.width;

    // WHEN / THEN — chrome height and page start
    expect(chrome.css_h * 2).toBe(chrome.out_h);
    expect(page_stage_y[0]).toBe(chrome.out_h);

    // THEN — the icon's output point is its CSS box at 2x
    expect(out.cx_16x9).toBe((css.x + css.w / 2) * 2);
    expect(out.cx_9x16).toBe((css.x - narrowShift + css.w / 2) * 2);
    expect(out.cy).toBe((css.y + css.h / 2) * 2);
    expect(out.bottom).toBe((css.y + css.h) * 2);

    // THEN — each aspect's anchor uses that icon and the toolbar's bottom + 8
    for (const [aspect, cx] of [['16x9', out.cx_16x9], ['9x16', out.cx_9x16]] as const) {
      const anchor = raw.overlays.popup_card.placement[aspect].anchor;
      expect(anchor, aspect).toBeDefined();
      expect(anchor!.icon_cx, aspect).toBe(cx);
      expect(anchor!.top, aspect).toBe(chrome.toolbar_bottom_out + 8);
    }

    // THEN — every card scale is a whole number
    const crops = raw.shots.find((s) => s.id === 's2b_shelter')!.crops!;
    const scales = [
      ...['A_list', 'B_pick', 'C_add'].map((name) => crops[name].card_scale_native),
      ...Object.values(raw.variants.vertical_9x16.shots.s2b_shelter.card_scale_native),
    ];
    expect(scales).toHaveLength(6);
    for (const scale of scales) expect(Number.isInteger(scale), String(scale)).toBe(true);
  });

  it('aims the 16:9 dblclick inside the declared #dbl-zone', () => {
    /**
     * Verifies the glide and dblclick point (800, 306) lies inside div#dbl-zone as the review page
     * description declares it. A point outside the zone lands on page text or a pet, and the take fails accept.
     */
    // GIVEN — the zone rect from the page description and the s2_review actions aimed at it
    const text = readFileSync(join(VIDEO_DIR, 'shots.json'), 'utf-8');
    const m = text.match(/div#dbl-zone, an empty[^.]*? box at x (\d+)-(\d+), y (\d+)-(\d+)/);
    expect(m).not.toBeNull();
    const [x0, x1, y0, y1] = m!.slice(1).map(Number);
    const raw = readJson('shots.json') as { shots: Array<{ id: string; actions?: Array<{ kind: string; x?: number; y?: number; target?: string }> }> };
    const aimed = raw.shots.find((s) => s.id === 's2_review')!.actions!.filter((a) => a.target === '#dbl-zone');

    // WHEN — the dblclick action is picked out
    expect(aimed.map((a) => a.kind)).toContain('dblclick_empty');

    // THEN — every point aimed at the zone is inside it
    expect([x0, x1, y0, y1]).toEqual([700, 900, 276, 336]);
    for (const a of aimed) {
      expect(a.x!, a.kind).toBeGreaterThanOrEqual(x0);
      expect(a.x!, a.kind).toBeLessThanOrEqual(x1);
      expect(a.y!, a.kind).toBeGreaterThanOrEqual(y0);
      expect(a.y!, a.kind).toBeLessThanOrEqual(y1);
    }
  });

  it('keeps each adoption caption rect in the page area, above the pets and clear of every card', () => {
    /**
     * Verifies the fixed caption rect for b3c-b3e sits below the chrome (y 208), ends above the pets
     * (the 128 output px pet strip at the frame bottom), and overlaps none of the three steady cards.
     * A rect that breaks this draws the caption over the chrome, a pet or the card.
     */
    // GIVEN — both placements, the steady card spots and the measured card sizes
    const doc = shots();
    const raw = readJson('shots.json') as { variants: { vertical_9x16: { safe: { pets_canvas_y: [number, number] } } } };
    const [petsTop9x16, frameH9x16] = raw.variants.vertical_9x16.safe.pets_canvas_y;
    const petStripH = frameH9x16 - petsTop9x16;
    const crops = doc.shots.find((s) => s.id === 's2b_shelter')!.crops!;
    const frames: Record<string, { h: number }> = { '16x9': { h: 1080 }, '9x16': { h: 1920 } };
    const pageTop = (doc.master.stage.page_stage_y as [number, number])[0];

    for (const aspect of ['16x9', '9x16']) {
      const rect = (doc.overlays.popup_card.placement[aspect] as { caption_rect: { x: number; y: number; w: number; h: number } }).caption_rect;

      // WHEN / THEN — inside the page area and above the pets
      expect(rect.y, aspect).toBeGreaterThanOrEqual(pageTop);
      expect(rect.y + rect.h, aspect).toBeLessThanOrEqual(frames[aspect].h - petStripH);

      // THEN — no overlap with any steady card
      for (const crop of ['A_list', 'B_pick', 'C_add']) {
        const c = crops[crop];
        const at = doc.overlays.popup_card.placement.steady_at[aspect][crop];
        const w = c.measured_native_500x960!.w * c.card_scale_native!;
        const h = c.measured_native_500x960!.h * c.card_scale_native!;
        const overlaps = rect.x < at.x + w && at.x < rect.x + rect.w && rect.y < at.y + h && at.y < rect.y + rect.h;
        expect(overlaps, `${aspect} ${crop}`).toBe(false);
      }
    }
  });

  it('declares the 9:16 length window 27.3-30.5 s', () => {
    /** The 9:16 cut runs a little longer than the master; without a window the eval has nothing to judge it by. */
    // GIVEN / WHEN — the 9:16 expected length
    const v = readJson('shots.json') as { variants: { vertical_9x16: { expected_length_s?: [number, number]; nominal_length_s: number } } };

    // THEN — the agreed window, with the nominal length inside it
    expect(v.variants.vertical_9x16.expected_length_s).toEqual([27.3, 30.5]);
    expect(v.variants.vertical_9x16.nominal_length_s).toBeGreaterThanOrEqual(27.3);
    expect(v.variants.vertical_9x16.nominal_length_s).toBeLessThanOrEqual(30.5);
  });
});

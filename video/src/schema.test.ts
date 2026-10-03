import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShots, validateEvents, validateTimeline, type SpeciesAllowlist } from './schema';
import { loadSpeciesAllowlist } from './species.node';

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

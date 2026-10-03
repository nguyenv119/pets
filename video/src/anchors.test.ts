import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnchor, resolveAnchor, EDIT_ONLY_ANCHORS } from './anchors';
import type { Events } from './schema';

const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(VIDEO_DIR, relPath), 'utf-8'));
}

/**
 * Collects only the fields shots.json's own shape documents as anchors
 * (conventions.anchors: "Every in, out, caption, camera move and sfx time
 * is an anchor"). A blind walk over every "in"/"out"/"from" key would also
 * catch unrelated same-named fields that are NOT anchors — the glide_to
 * `at: {from: 'left', ...}` positioning descriptor, and
 * overlays.popup_card's prose "in"/"out" fields — so this walks each
 * known shape explicitly instead.
 */
function collectAnchorStrings(shots: { shots: Array<{ beats?: unknown[] }> }): string[] {
  const out: string[] = [];

  function pushIfString(v: unknown): void {
    if (typeof v === 'string') out.push(v);
  }

  for (const shot of shots.shots) {
    for (const beat of shot.beats ?? []) {
      const b = beat as {
        in?: unknown;
        out?: unknown;
        caption_at?: unknown;
        caption_out?: unknown;
        caption_sample?: unknown;
        overlay?: { from?: unknown; to?: unknown; clock?: Array<{ from?: unknown }> };
      };
      pushIfString(b.in);
      pushIfString(b.out);
      pushIfString(b.caption_at);
      pushIfString(b.caption_out);
      pushIfString(b.caption_sample);
      if (b.overlay) {
        pushIfString(b.overlay.from);
        pushIfString(b.overlay.to);
        for (const clockEntry of b.overlay.clock ?? []) {
          pushIfString(clockEntry.from);
        }
      }
    }
  }

  return out;
}

describe('parseAnchor — every anchor in video/shots.json parses', () => {
  it('parses every in/out/caption_at/caption_out anchor in the real shots.json', () => {
    /**
     * Verifies every anchor string shots.json's beats declare (in, out,
     * caption_at, caption_out, caption_sample) matches the anchor grammar:
     * event[:pet[:gif]][+-ms], the mouse: alias, or an edit-only anchor.
     *
     * This matters because a malformed anchor is a silent no-op until the
     * edit tries to resolve it — a typo'd anchor should fail at scaffold
     * time, not deep into a render.
     *
     * If this contract breaks, a typo'd anchor string ships in the frozen
     * shots.json and only surfaces as a crash in pets-o3p.4's edit.
     */
    // GIVEN — every anchor-shaped string in the real shots.json
    const shots = readJson('shots.json') as { shots: Array<{ beats?: unknown[] }> };
    const anchors = collectAnchorStrings(shots);

    // WHEN/THEN — every one parses without throwing
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(() => parseAnchor(anchor), `anchor "${anchor}" failed to parse`).not.toThrow();
    }
  });

  it('parses every popup anchor in s2b_shelter', () => {
    /**
     * Verifies the popup take's own anchors (popup_ready+200,
     * shelter_click+300, type_selected+500, add_mousedown+160, ...) parse —
     * these use plain <event>±ms with no pet segment, unlike the page
     * shots' pet-qualified anchors.
     *
     * If this contract breaks, the popup edit (b3c/b3d/b3e) can't resolve
     * its own card timing.
     */
    // GIVEN — s2b_shelter's beats
    const shots = readJson('shots.json') as { shots: Array<{ id: string; beats?: unknown[] }> };
    const s2b = shots.shots.find((s) => s.id === 's2b_shelter');
    expect(s2b).toBeDefined();
    const anchors = collectAnchorStrings({ shots: [s2b!] });

    // WHEN/THEN — every one parses
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(() => parseAnchor(anchor), `anchor "${anchor}" failed to parse`).not.toThrow();
    }
  });

  it('parses every anchor in the fixture shots file', () => {
    /**
     * Verifies the fixture shots file's own anchors parse, so the fixture
     * itself is never the thing that's broken when a later bead's test
     * fails.
     */
    // GIVEN — the fixture shots file
    const shots = readJson('fixtures/shots.sample.json') as { shots: Array<{ beats?: unknown[] }> };
    const anchors = collectAnchorStrings(shots);

    // WHEN/THEN — every one parses
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(() => parseAnchor(anchor), `anchor "${anchor}" failed to parse`).not.toThrow();
    }
  });

  it('parses every edit-only anchor name (in, end, cursor_depart, ball_in_frame, catch_point)', () => {
    /**
     * Verifies each documented edit-only anchor name parses to kind
     * "edit" and is never mistaken for an observed-event anchor.
     *
     * If this contract breaks, an edit-only anchor could be silently
     * resolved against Events (returning undefined/garbage) instead of
     * being handled by the edit's own logic.
     */
    // GIVEN — every documented edit-only anchor name
    // WHEN/THEN — each parses to kind "edit"
    for (const name of EDIT_ONLY_ANCHORS) {
      const parsed = parseAnchor(name);
      expect(parsed.kind).toBe('edit');
    }
  });
});

describe('resolveAnchor — sample shot (a) resolves against fixtures/events.sample.json', () => {
  it('resolves every anchor kind sample shot (a) is documented to use', () => {
    /**
     * Verifies every recorder anchor listed as usable by sample shot (a)
     * (pets_ready, src:rex:swipe, mouseup:rex, heart_on, mouse:dblclick,
     * ball_on, ball_off, catch) resolves to a real timestamp against the
     * normalised proof-render fixture.
     *
     * This matters because it proves the fixture and the anchor resolver
     * actually agree on the Events shape end to end — a fixture that
     * "validates" per schema.test.ts but that no anchor can resolve against
     * would be a useless fixture for pets-o3p.3/.4's own tests.
     *
     * If this contract breaks, later beads inherit a fixture that looks
     * valid but that their own anchor-driven code cannot actually use.
     */
    // GIVEN — the normalised events fixture and sample shot (a)'s documented anchors
    const events = readJson('fixtures/events.sample.json') as Events;
    const anchors = ['pets_ready', 'src:rex:swipe', 'mouseup:rex', 'heart_on', 'mouse:dblclick', 'ball_on', 'ball_off', 'catch'];

    // WHEN/THEN — each resolves to a finite number
    for (const anchor of anchors) {
      const resolved = resolveAnchor(anchor, events);
      expect(Number.isFinite(resolved), `anchor "${anchor}" did not resolve`).toBe(true);
    }
  });

  it('throws for an edit-only anchor, since the edit resolves it, not the recorder', () => {
    /**
     * Verifies resolveAnchor refuses to resolve an edit-only anchor
     * (cursor_depart) against Events, per conventions.anchors: "Edit-only
     * anchors, resolved by the edit, not the recorder."
     *
     * If this contract breaks, a caller could silently get `undefined` (or
     * a wrong number) for an anchor the recorder was never meant to know
     * about, instead of a loud failure pointing at the real owner.
     */
    // GIVEN — a normalised events fixture
    const events = readJson('fixtures/events.sample.json') as Events;

    // WHEN/THEN — resolving an edit-only anchor throws
    expect(() => resolveAnchor('cursor_depart', events)).toThrow();
  });
});

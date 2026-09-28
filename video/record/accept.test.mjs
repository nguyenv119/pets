import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRule, familyNameForRule, RULE_FAMILIES } from './accept.mjs';

const FAMILY_REGEX_BY_NAME = Object.fromEntries(RULE_FAMILIES.map(([regex, evaluator]) => [evaluator.name, regex]));

// evalPopupTypeGrid is the only family that reads ctx (layout_expect from shots.json, not carried by the rule text itself).
const CTX = { layoutExpect: { type_order: Array.from({ length: 14 }, (_, i) => `t${i}`) } };

const HERE = dirname(fileURLToPath(import.meta.url));
const shots = JSON.parse(readFileSync(join(HERE, '..', 'shots.json'), 'utf-8'));
const fixtureShots = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'shots.sample.json'), 'utf-8'));

/** Every rule text shots.json (or its 9:16 variant / popup take) can hand to the recorder — the ones accept.mjs must recognise. */
function collectRuleTexts(doc) {
  const rules = new Set();
  for (const shot of doc.shots) {
    for (const rule of shot.accept ?? []) rules.add(rule);
  }
  const variant = doc.variants?.vertical_9x16;
  if (variant) {
    for (const shot of Object.values(variant.shots ?? {})) {
      for (const rule of shot.extra_accept ?? []) rules.add(rule);
    }
  }
  return rules;
}

const allRuleTexts = new Set([...collectRuleTexts(shots), ...collectRuleTexts(fixtureShots)]);

function wrap(partial) {
  return {
    name: 'fixture',
    viewport: { width: 960, height: 540 },
    capture: { method: 'cdp-screencast', dpr: 2, fps: 25 },
    recordedAt: 0,
    extensionId: 'ext',
    shim: 'v3;seed=1',
    roster: [],
    durationMs: 100000,
    offsetMs: 0,
    trimBeforeMs: 0,
    videoLagMs: 56,
    cursorTrack: [],
    clicks: [],
    observed: [],
    tracks: [],
    ...partial,
  };
}

function rosterOf(...names) {
  return names.map((n) => ({ id: n.toLowerCase(), name: n, type: 'dog', color: 'brown' }));
}

const CLICK = { label: 'x', tDepartMs: 0, tDownMs: 0, x: 0, y: 0, rect: { x: 0, y: 0, w: 1, h: 1 } };

// One {good, bad} events-document builder per accept.mjs evaluator (its
// function name, from familyNameForRule). Each builder reads the rule's own
// regex captures so the fixture matches the literal rule's numbers/pets.
const BUILDERS = {
  evalShim: {
    good: (m) => wrap({ shim: m[1] === '<seed>' ? 'v3;seed=5' : `v3;seed=${m[1]}` }),
    bad: () => wrap({ shim: 'NO_SEED' }),
  },
  evalFirstTransition: {
    good: (m) => wrap({
      roster: rosterOf(m[1]),
      observed: [{ t: 0, kind: 'pets_ready' }, { t: (Number(m[3]) + Number(m[4])) / 2, kind: 'src', pet: m[1].toLowerCase(), from: 'idle', to: 'walk' }],
    }),
    bad: (m) => wrap({
      roster: rosterOf(m[1]),
      observed: [{ t: 0, kind: 'pets_ready' }, { t: Number(m[4]) + 5000, kind: 'src', pet: m[1].toLowerCase(), from: 'idle', to: 'walk' }],
    }),
  },
  evalBoxRangeUntilOut: {
    good: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: (Number(m[2]) + Number(m[3])) / 2, y: 0, w: 10, h: 10, src: 'x_idle_y' }] }] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: Number(m[3]) + 1000, y: 0, w: 10, h: 10, src: 'x_idle_y' }] }] }),
  },
  evalBoxRange: {
    good: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: (Number(m[2]) + Number(m[3])) / 2, y: 0, w: 10, h: 10, src: 'x_idle_y' }] }] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: Number(m[3]) + 1000, y: 0, w: 10, h: 10, src: 'x_idle_y' }] }] }),
  },
  evalSwipeAfterHover: {
    good: (m) => wrap({ clicks: [{ ...CLICK, kind: 'hover', tMs: 0 }], observed: [{ t: Number(m[1]) - 10, kind: 'src', to: 'swipe' }] }),
    bad: (m) => wrap({ clicks: [{ ...CLICK, kind: 'hover', tMs: 0 }], observed: [{ t: Number(m[1]) + 500, kind: 'src', to: 'swipe' }] }),
  },
  evalHeartAfterMouseup: {
    good: (m) => wrap({ clicks: [{ ...CLICK, kind: 'click', tMs: 0 }], observed: [{ t: Number(m[1]) - 10, kind: 'heart_on' }] }),
    bad: (m) => wrap({ clicks: [{ ...CLICK, kind: 'click', tMs: 0 }], observed: [{ t: Number(m[1]) - 10, kind: 'heart_on' }, { t: Number(m[1]) - 5, kind: 'heart_on' }] }),
  },
  evalDblclickTarget: {
    good: (m) => wrap({ observed: [{ t: 0, kind: 'pets_ready' }, { t: Number(m[3]) - 10, kind: 'dblclick' }] }),
    bad: (m) => wrap({ observed: [{ t: 0, kind: 'pets_ready' }, { t: Number(m[3]) + 5000, kind: 'dblclick' }] }),
  },
  evalBallOnAfterDblclick: {
    good: (m) => wrap({ observed: [{ t: 0, kind: 'dblclick' }, { t: Number(m[1]) - 10, kind: 'ball_on' }] }),
    bad: () => wrap({ observed: [{ t: 0, kind: 'dblclick' }] }),
  },
  evalCatchReplaceLimit: {
    good: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'dblclick' }, { t: Number(m[2]) - 10, kind: 'catch', pet: m[1].toLowerCase() }] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'dblclick' }, { t: Number(m[2]) + 5000, kind: 'catch', pet: m[1].toLowerCase() }] }),
  },
  evalCatchAfterDblclick: {
    good: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'dblclick' }, { t: Number(m[2]) - 10, kind: 'catch', pet: m[1].toLowerCase() }] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'dblclick' }, { t: Number(m[2]) + 5000, kind: 'catch', pet: m[1].toLowerCase() }] }),
  },
  evalPetStateAfterDblclick: {
    good: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'dblclick' }, { t: Number(m[3]) - 10, kind: m[2] === 'run' ? 'chase_start' : m[2], pet: m[1].toLowerCase() }] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'dblclick' }] }),
  },
  evalNeverOnPage: {
    good: (m) => wrap({ roster: rosterOf(m[1]), tracks: [] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: 0, y: 0, w: 1, h: 1, src: 'x' }] }] }),
  },
  evalGreetStart: {
    good: (m) => wrap({
      roster: rosterOf(m[2], m[3]),
      observed: [{ t: 0, kind: 'pets_ready' }, { t: Number(m[1]) - 10, kind: 'greet_start', pet: m[2].toLowerCase() }, { t: Number(m[1]) - 10, kind: 'greet_start', pet: m[3].toLowerCase() }],
    }),
    bad: (m) => wrap({ roster: rosterOf(m[2], m[3]), observed: [{ t: 0, kind: 'pets_ready' }, { t: 10, kind: 'greet_start', pet: m[2].toLowerCase() }] }),
  },
  evalNeverGreets: {
    good: (m) => wrap({ roster: rosterOf(m[1]), observed: [] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), observed: [{ t: 0, kind: 'src', pet: m[1].toLowerCase(), from: 'idle', to: 'swipe' }] }),
  },
  evalAllIdleUntilOut: {
    good: (m) => wrap({ observed: [{ t: 0, kind: 'pets_ready' }, { t: 50, kind: 'greet_end' }], tracks: [{ t: 100, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_idle_y' }] }] }),
    bad: (m) => wrap({ observed: [{ t: 0, kind: 'pets_ready' }, { t: 50, kind: 'greet_end' }], tracks: [{ t: 100, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_walk_y' }] }] }),
  },
  evalAllIdleAtHourSet: {
    good: () => wrap({ observed: [{ t: 100, kind: 'hour_set' }], tracks: [{ t: 90, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_idle_y' }] }] }),
    bad: () => wrap({ observed: [{ t: 100, kind: 'hour_set' }], tracks: [{ t: 90, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_walk_y' }] }] }),
  },
  evalAllLieWithin: {
    good: (m) => wrap({ observed: [{ t: 0, kind: 'hour_set' }, { t: Number(m[1]) - 10, kind: 'sleep' }] }),
    bad: (m) => wrap({ observed: [{ t: 0, kind: 'hour_set' }, { t: Number(m[1]) + 5000, kind: 'sleep' }] }),
  },
  evalAllLieUntilEnd: {
    good: (m) => wrap({ observed: [{ t: 0, kind: 'sleep' }], tracks: [{ t: 10, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_lie_y' }] }] }),
    bad: (m) => wrap({ observed: [{ t: 0, kind: 'sleep' }], tracks: [{ t: 10, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_idle_y' }] }] }),
  },
  evalBoxRightEdge: {
    good: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: 0, y: 0, w: 10, h: 10, src: 'x' }] }] }),
    bad: (m) => wrap({ roster: rosterOf(m[1]), tracks: [{ t: 0, pets: [{ id: m[1].toLowerCase(), x: Number(m[2]) + 100, y: 0, w: 10, h: 10, src: 'x' }] }] }),
  },
  evalEveryBoxRightEdge: {
    good: (m) => wrap({ tracks: [{ t: 0, pets: [{ id: 'a', x: 0, y: 0, w: 10, h: 10, src: 'x' }] }] }),
    bad: (m) => wrap({ tracks: [{ t: 0, pets: [{ id: 'a', x: Number(m[1]) + 100, y: 0, w: 10, h: 10, src: 'x' }] }] }),
  },
  evalNoWallBounce: {
    good: () => wrap({ tracks: [{ t: 0, pets: [{ id: 'a', x: 10, y: 0, w: 10, h: 10, src: 'x' }] }] }),
    bad: () => wrap({ tracks: [{ t: 0, pets: [{ id: 'a', x: 0, y: 0, w: 10, h: 10, src: 'x' }] }] }),
  },
  evalBallXAtCatch: {
    good: (m) => wrap({ observed: [{ t: 0, kind: 'catch', x: Number(m[1]) - 10 }] }),
    bad: (m) => wrap({ observed: [{ t: 0, kind: 'catch', x: Number(m[1]) + 100 }] }),
  },
  evalPopupTypeGrid: {
    good: () => wrap({
      observed: [{ t: 0, kind: 'form_expanded', scrollHeight: 900, innerHeight: 960 }],
      tracks: [{ t: 0, cells: Array.from({ length: 14 }, (_, i) => ({ type: `t${i}`, x: (i % 6) * 70, y: Math.floor(i / 6) * 70, w: 60, h: 60 })) }],
    }),
    bad: () => wrap({
      observed: [{ t: 0, kind: 'form_expanded', scrollHeight: 1200, innerHeight: 960 }],
      tracks: [{ t: 0, cells: Array.from({ length: 14 }, (_, i) => ({ type: `t${i}`, x: (i % 6) * 70, y: Math.floor(i / 6) * 70, w: 60, h: 60 })) }],
    }),
  },
  evalPopupFontLoaded: {
    good: () => wrap({ observed: [{ t: 0, kind: 'shelter_click' }] }),
    bad: () => wrap({ observed: [] }),
  },
  evalPopupCropsDisjoint: {
    good: () => wrap({ tracks: [{ t: 0, cells: [{ type: 'chicken', x: 0, y: 0, w: 1, h: 1 }] }] }),
    bad: () => wrap({ tracks: [{ t: 0 }] }),
  },
  evalPopupTypeColorSelected: {
    good: () => wrap({ observed: [{ t: 0, kind: 'type_selected', type: 'chicken' }, { t: 0, kind: 'color_selected', color: 'white' }] }),
    bad: () => wrap({ observed: [{ t: 0, kind: 'type_selected', type: 'dog' }, { t: 0, kind: 'color_selected', color: 'white' }] }),
  },
  evalPopupAddMouseupTiming: {
    good: () => wrap({ observed: [{ t: 0, kind: 'add_mousedown' }, { t: 250, kind: 'add_mouseup' }] }),
    bad: () => wrap({ observed: [{ t: 0, kind: 'add_mousedown' }, { t: 100, kind: 'add_mouseup' }] }),
  },
  evalPopupRosterSaved: {
    good: () => wrap({ observed: [{ t: 0, kind: 'add_mousedown' }, { t: 500, kind: 'roster_saved', roster: [{ name: 'Rex' }, { name: 'Bao' }, { name: 'Pip' }] }] }),
    bad: () => wrap({ observed: [{ t: 0, kind: 'add_mousedown' }, { t: 1500, kind: 'roster_saved', roster: [{ name: 'Rex' }, { name: 'Bao' }, { name: 'Pip' }] }] }),
  },
  evalPopupListGrowsFormCollapses: {
    good: () => wrap({ observed: [{ t: 200, kind: 'add_mousedown' }], tracks: [{ t: 100, els: { pets_list: { x: 0, y: 0, w: 1, h: 137 } } }, { t: 300, els: { pets_list: { x: 0, y: 0, w: 1, h: 210 } } }] }),
    bad: () => wrap({ observed: [{ t: 200, kind: 'add_mousedown' }], tracks: [{ t: 100, els: { pets_list: { x: 0, y: 0, w: 1, h: 137 } } }, { t: 300, els: { pets_list: { x: 0, y: 0, w: 1, h: 150 } } }] }),
  },
  evalPopupClicksInsideCrop: {
    good: () => wrap({ observed: [{ t: 0, kind: 'shelter_click', x: 10, y: 10 }, { t: 0, kind: 'name_click', x: 10, y: 10 }, { t: 0, kind: 'type_selected', x: 10, y: 10 }, { t: 0, kind: 'color_selected', x: 10, y: 10 }, { t: 0, kind: 'add_mousedown', x: 10, y: 10 }] }),
    bad: () => wrap({ observed: [{ t: 0, kind: 'shelter_click' }] }),
  },
};

describe('accept.mjs rule coverage', () => {
  for (const rule of allRuleTexts) {
    it(`recognises and evaluates: "${rule}"`, () => {
      // GIVEN — a rule text copied verbatim from shots.json (or its 9:16 variant / fixture)
      const family = familyNameForRule(rule);

      // WHEN — the engine is asked which family handles it
      // THEN — every real rule text is recognised by some family (an unmatched text is a coverage gap, not a silent pass)
      expect(family, `no accept.mjs family matches: "${rule}"`).not.toBeNull();
      expect(BUILDERS[family], `no test fixture builder registered for family "${family}"`).toBeDefined();
    });

    it(`passes a log built to satisfy it: "${rule}"`, () => {
      // GIVEN — a fixture events document constructed to satisfy this exact rule's parameters
      const family = familyNameForRule(rule);
      const builder = BUILDERS[family];
      const match = rule.match(FAMILY_REGEX_BY_NAME[family]);

      // WHEN — evaluateRule checks it
      const events = builder.good(match);
      const result = evaluateRule(rule, events, CTX);

      // THEN — the predicate passes, proving it is not always-false
      expect(result.pass, result.detail).toBe(true);
    });

    it(`fails a log edited to violate it: "${rule}"`, () => {
      // GIVEN — the same fixture, edited to violate this rule's condition
      const family = familyNameForRule(rule);
      const match = rule.match(FAMILY_REGEX_BY_NAME[family]);
      const builder = BUILDERS[family];
      const events = builder.bad(match);

      // WHEN — evaluateRule checks it
      const result = evaluateRule(rule, events, CTX);

      // THEN — the predicate fails, proving it is not always-true
      expect(result.pass, 'predicate is always-true: it passed a log edited to violate it').toBe(false);
    });
  }
});

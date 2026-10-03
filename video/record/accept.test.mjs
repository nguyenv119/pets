import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRule, evaluateShotRules, familyNameForRule, mergeAcceptRules, RULE_FAMILIES } from './accept.mjs';

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

const SEEDED_ROSTER = [
  { id: '6f1c2a4e-1b2c-4d3e-8f40-0a1b2c3d4e5f', name: 'Rex', type: 'dog', color: 'brown' },
  { id: '7a2d3b5f-2c3d-4e4f-9051-1b2c3d4e5f60', name: 'Bao', type: 'panda', color: 'black' },
];
const FRESH_PIP_ID = '3c9e1d2a-5b6c-4d7e-a8f9-0a1b2c3d4e5f';

/**
 * An s2b_shelter Add Pet log: the press at t=200, the mouseup at t=450, the
 * list 137px tall and the form 300px tall before the press, and (by default)
 * addPet's re-render 100ms after the mouseup: the list 210px, the form 40px,
 * and a saved Pip with a fresh v4 UUID. Each option edits one clause.
 */
function addPetLog({ grownListH = 210, collapsedFormH = 40, pipId = FRESH_PIP_ID, reRenderAt = 550 } = {}) {
  const rect = (h) => ({ x: 0, y: 0, w: 1, h });
  return wrap({
    roster: SEEDED_ROSTER,
    observed: [
      { t: 200, kind: 'add_mousedown' },
      { t: 450, kind: 'add_mouseup' },
      { t: 600, kind: 'roster_saved', roster: [...SEEDED_ROSTER, { id: pipId, name: 'Pip', type: 'chicken', color: 'white' }] },
    ],
    tracks: [
      { t: 100, els: { pets_list: rect(137), add_pet_form: rect(300) } },
      { t: reRenderAt, els: { pets_list: rect(grownListH), add_pet_form: rect(collapsedFormH) } },
    ],
  });
}

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
    good: () => addPetLog(),
    bad: () => addPetLog({ grownListH: 150 }),
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

describe('evalPopupListGrowsFormCollapses: one violating log per clause', () => {
  const rule = "within 500 ms of the Add Pet mouseup, the logged #pets-list grows by at least 60 CSS px and #add-pet-form collapses (addPet's own re-render), and the saved Pip's id is a crypto.randomUUID() that is not a seeded id";

  it('passes the unedited Add Pet log (control for the cases below)', () => {
    // GIVEN — a log where all three clauses hold
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, addPetLog());
    // THEN — it passes, so each failure below is caused by its one edit
    expect(result.pass, result.detail).toBe(true);
  });

  it('fails when #add-pet-form never collapses to half height', () => {
    // GIVEN — the list grows but the form stays at 200px (over half of 300px)
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, addPetLog({ collapsedFormH: 200 }));
    // THEN — it fails on the form clause
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/#add-pet-form never collapsed/);
  });

  it('fails when the list and form change only after the 500ms window', () => {
    // GIVEN — the re-render lands 600ms after the mouseup
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, addPetLog({ reRenderAt: 1050 }));
    // THEN — it fails: a late change is not addPet's own re-render
    expect(result.pass).toBe(false);
  });

  it("fails when the saved Pip's id is not a crypto.randomUUID()", () => {
    // GIVEN — Pip saved with a hand-written id (a roster written straight into storage)
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, addPetLog({ pipId: 'pip' }));
    // THEN — it fails on the UUID clause
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/not a crypto\.randomUUID\(\)/);
  });

  it("fails when the saved Pip's id is one of the seeded ids", () => {
    // GIVEN — Pip saved under Rex's seeded v4 id
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, addPetLog({ pipId: SEEDED_ROSTER[0].id }));
    // THEN — it fails on the not-seeded clause
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/matches a seeded pet id/);
  });
});

describe('frame-window rules fail when no tracked frame falls in the window', () => {
  it('evalAllIdleUntilOut fails with no tracked frame between greet_end and out', () => {
    // GIVEN — greet_end at 50, out at pets_ready+2950, and the only tracked frame after out
    const rule = 'all three pets show the idle sprite from greet_end until out (pets_ready+2950): no walk and no lie';
    const events = wrap({ observed: [{ t: 0, kind: 'pets_ready' }, { t: 50, kind: 'greet_end' }], tracks: [{ t: 4000, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_idle_y' }] }] });
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, events);
    // THEN — it fails instead of passing on zero frames
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/no tracked frame/);
  });

  it('evalAllLieUntilEnd fails with no tracked frame between sleep and the take end', () => {
    // GIVEN — sleep at 0 and no tracked frame at all
    const rule = 'all three stay on lie until the take ends (sleep+8800)';
    const events = wrap({ observed: [{ t: 0, kind: 'sleep' }], tracks: [] });
    // WHEN — the rule is evaluated
    const result = evaluateRule(rule, events);
    // THEN — it fails instead of passing on zero frames
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/no tracked frame/);
  });
});

describe('9:16 base-rule replacement (mergeAcceptRules / evaluateShotRules)', () => {
  const s2 = shots.shots.find((s) => s.id === 's2_review');
  const variant = shots.variants.vertical_9x16.shots.s2_review;
  const baseCatchRule = 'a catch by Rex (conventions.states.catch) within 2600 ms of the dblclick';
  const replacingExtraRule = 'a catch by Rex within 2800 ms of the dblclick, replacing the 16:9 limit of 2600 ms (the 730 px page gives a 1.34 s fall)';

  it('substitutes the replacing extra rule for its matching base rule, keyed by the base text', () => {
    // GIVEN — s2_review's real base accept[] and its 9:16 extra_accept[] (both copied from shots.json)
    // WHEN — they are merged
    const merged = mergeAcceptRules(s2.accept, variant.extra_accept);

    // THEN — exactly one merged entry reports under the base catch rule's verbatim text but evaluates the extra rule's 2800ms limit
    const entry = merged.find((e) => e.reportText === baseCatchRule);
    expect(entry).toBeDefined();
    expect(entry.evalText).toBe(replacingExtraRule);
    expect(entry.replaced).toBe(true);
    // AND the base rule's own text does not additionally appear as its own separately-evaluated entry
    expect(merged.filter((e) => e.evalText === baseCatchRule)).toHaveLength(0);
  });

  it('judges a replaced rule at the extra value: a catch inside 2800ms but outside 2600ms passes, reported under the base text', () => {
    // GIVEN — a catch 2700ms after the dblclick (fails the base 16:9 limit of 2600ms, passes the 9:16 limit of 2800ms)
    const events = {
      roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }],
      observed: [{ t: 0, kind: 'dblclick' }, { t: 2700, kind: 'catch', pet: 'rex' }],
      tracks: [],
    };

    // WHEN — the shot's rules are evaluated with the 9:16 extra_accept merged in
    const results = evaluateShotRules(s2.accept, variant.extra_accept, events);

    // THEN — the catch rule passes (judged at 2800ms) and is reported under the BASE rule's verbatim text, with a detail noting the swap
    const catchResult = results.find((r) => r.rule === baseCatchRule);
    expect(catchResult).toBeDefined();
    expect(catchResult.pass).toBe(true);
    expect(catchResult.detail).toMatch(/^replaced in 9:16 by extra_accept/);
  });

  it('still fails a replaced rule when the catch misses even the wider 9:16 limit', () => {
    // GIVEN — a catch 3000ms after the dblclick (outside both the 2600ms base and the 2800ms 9:16 limit)
    const events = {
      roster: [{ id: 'rex', name: 'Rex', type: 'dog', color: 'brown' }],
      observed: [{ t: 0, kind: 'dblclick' }, { t: 3000, kind: 'catch', pet: 'rex' }],
      tracks: [],
    };

    // WHEN — the shot's rules are evaluated with the 9:16 extra_accept merged in
    const results = evaluateShotRules(s2.accept, variant.extra_accept, events);

    // THEN — the (replaced) catch rule fails
    const catchResult = results.find((r) => r.rule === baseCatchRule);
    expect(catchResult.pass).toBe(false);
  });

  it('keeps a non-replacing extra_accept rule as its own separate entry, reported under its own text', () => {
    // GIVEN — s2_review's extra_accept list, which also has non-replacing rules (e.g. the box right-edge margin)
    // WHEN — merged
    const merged = mergeAcceptRules(s2.accept, variant.extra_accept);

    // THEN — a non-replacing extra rule appears verbatim, evaluated as itself
    const edgeRule = variant.extra_accept.find((r) => r.includes('right edge stays'));
    const entry = merged.find((e) => e.reportText === edgeRule);
    expect(entry).toBeDefined();
    expect(entry.evalText).toBe(edgeRule);
    expect(entry.replaced).toBe(false);
  });

  it('throws when a replacing extra rule names a limit no base rule has', () => {
    // GIVEN — a replacing rule whose "16:9 limit" doesn't match any base rule's own limit (an authoring mismatch)
    const badExtra = 'a catch by Rex within 2800 ms of the dblclick, replacing the 16:9 limit of 9999 ms (bogus)';

    // WHEN / THEN — mergeAcceptRules refuses to guess which base rule it meant
    expect(() => mergeAcceptRules(s2.accept, [badExtra])).toThrow();
  });
});

describe('rules timed from pets_ready', () => {
  /** The families that time something from pets_ready, and every rule text the recorder can see in them. */
  const READY_FAMILIES = ['evalAllIdleUntilOut', 'evalDblclickTarget', 'evalFirstTransition', 'evalGreetStart'];
  const readyRules = [...allRuleTexts].filter((r) => READY_FAMILIES.includes(familyNameForRule(r)));

  it('covers at least one rule of each pets_ready family', () => {
    /**
     * Guards the test below against passing vacuously: if shots.json ever
     * dropped every pets_ready rule, the next test would check nothing.
     */
    // GIVEN / WHEN — the pets_ready rules' evaluator names
    const families = new Set(readyRules.map((r) => familyNameForRule(r)));

    // THEN — all four pets_ready families are present
    expect([...families].sort()).toEqual(READY_FAMILIES);
  });

  it('fails a rule timed from pets_ready when the take logged no pets_ready', () => {
    /**
     * Verifies that a missing pets_ready fails the rule instead of falling
     * back to t=0. t=0 is the start clapper's release, about 500 ms after the
     * page is ready, so a silent fallback would time the rule from the wrong
     * moment and could pass or fail a take for no real reason.
     */
    // GIVEN — an events document with a greet, a walk, a dblclick and tracks, but no pets_ready
    const events = wrap({
      roster: rosterOf('Rex', 'Pip', 'Bao'),
      observed: [
        { t: 10, kind: 'greet_start', pet: 'rex' },
        { t: 10, kind: 'greet_start', pet: 'pip' },
        { t: 50, kind: 'greet_end' },
        { t: 60, kind: 'src', pet: 'rex', from: 'idle', to: 'walk' },
        { t: 70, kind: 'dblclick' },
      ],
      tracks: [{ t: 100, pets: [{ id: 'rex', x: 0, y: 0, w: 1, h: 1, src: 'x_idle_y' }] }],
    });

    // WHEN — every pets_ready rule is evaluated
    const results = readyRules.map((r) => evaluateRule(r, events, CTX));

    // THEN — each one fails and says pets_ready is missing
    for (const r of results) {
      expect(r.pass, r.rule).toBe(false);
      expect(r.detail, r.rule).toMatch(/no pets_ready observed/);
    }
  });
});

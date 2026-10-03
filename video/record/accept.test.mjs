import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptRulesFor, evaluateRule, evaluateRules, familyNameForRule, RULE_FAMILIES } from './accept.mjs';

const FAMILY_REGEX_BY_NAME = Object.fromEntries(RULE_FAMILIES.map(([regex, evaluator]) => [evaluator.name, regex]));

const HERE = dirname(fileURLToPath(import.meta.url));
const shots = JSON.parse(readFileSync(join(HERE, '..', 'shots.json'), 'utf-8'));
const fixtureShots = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'shots.sample.json'), 'utf-8'));
const s2bShot = shots.shots.find((s) => s.id === 's2b_shelter');

/**
 * Real logs from the 2026-10-03 shakedown run (trimmed: every 4th popup
 * frame plus the frame nearest each event): the kept s2b_shelter take, and
 * the kept 9:16 s2_review take, whose dblclick was sent at (300, 500).
 */
const realPopup = () => JSON.parse(readFileSync(join(HERE, 'testdata', 's2b_shelter.events.json'), 'utf-8'));
const realS2v916 = () => JSON.parse(readFileSync(join(HERE, 'testdata', 's2_review_v916.events.json'), 'utf-8'));

/** The popup take's rule context as popup.mjs builds it (popupAcceptCtx), from the shot in shots.json. */
const POPUP_CTX = {
  layoutExpect: s2bShot.layout_expect,
  nunito: { status: 'loaded', t: 3.6 },
  popup: { beats: s2bShot.beats, viewportWidth: s2bShot.viewport.width, forbiddenTypes: s2bShot.layout_expect.forbidden_types },
};

// ctx carries what events.json has no field for: layout_expect, the
// dblclick's logged point and elementFromPoint target (choreo.mjs), the
// Nunito FontFace status and the popup crop context (popup.mjs).
const CTX = {
  ...POPUP_CTX,
  layoutExpect: { type_order: Array.from({ length: 14 }, (_, i) => `t${i}`) },
  // v2: updated by pets-3it.1 (shots.json's dblclick rule moved to (800, 306) on the 436 px page)
  dblclick: { x: 800, y: 306, element: 'div#dbl-zone' },
};

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

/** The real popup log with one forbidden cell's logged rect moved on every frame (an edited copy of a real log). */
function popupWithCellMoved(type, patch) {
  const ev = realPopup();
  for (const f of ev.tracks) for (const c of f.cells ?? []) if (c.type === type) Object.assign(c, patch);
  return ev;
}

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
    good: (m) => {
      const walkT = (Number(m[3]) + Number(m[4])) / 2;
      const step = m[2] === 'walkRight' ? 2 : -2;
      return wrap({
        roster: rosterOf(m[1]),
        observed: [{ t: 0, kind: 'pets_ready' }, { t: walkT, kind: 'src', pet: m[1].toLowerCase(), from: 'idle', to: 'walk' }],
        tracks: [0, 1, 2, 3].map((i) => ({ t: walkT + i * 16.7, pets: [{ id: m[1].toLowerCase(), x: 700 + i * step, y: 476, w: 64, h: 64, src: 'dog/brown_walk_8fps.gif' }] })),
      });
    },
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
    good: (m) => wrap({
      observed: [{ t: 0, kind: 'pets_ready' }, { t: Number(m[3]) - 10, kind: 'dblclick' }],
      tracks: [{ t: 0, pets: [{ id: 'rex', x: 520, y: 476, w: 64, h: 64, src: 'dog/brown_idle_8fps.gif' }] }],
    }),
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
    good: (m) => wrap({
      observed: [{ t: 0, kind: 'pets_ready' }, { t: 50, kind: 'greet_end' }],
      tracks: [100, Number(m[1]) + 20].map((t) => ({ t, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_idle_y' }] })),
    }),
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
    good: (m) => wrap({ observed: [{ t: 0, kind: 'sleep' }], tracks: [10, Number(m[1]) + 20].map((t) => ({ t, pets: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, src: 'x_lie_y' }] })) }),
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
    good: () => wrap({ observed: [{ t: 10, kind: 'shelter_click' }] }),
    // the first action fires before the logged loaded status (CTX.nunito.t)
    bad: () => wrap({ observed: [{ t: 0, kind: 'shelter_click' }] }),
  },
  evalPopupCropsDisjoint: {
    good: () => realPopup(),
    bad: () => popupWithCellMoved('dog', { y: 200 }),
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
    good: () => realPopup(),
    bad: () => {
      const ev = realPopup();
      ev.observed.find((e) => e.kind === 'roster_saved').t += 1100;
      return ev;
    },
  },
  evalPopupListGrowsFormCollapses: {
    good: () => addPetLog(),
    bad: () => addPetLog({ grownListH: 150 }),
  },
  evalPopupClicksInsideCrop: {
    good: () => realPopup(),
    // the Name click sent at the field's live centre (x 286), outside crop B (x 20-177.6)
    bad: () => {
      const ev = realPopup();
      ev.observed.find((e) => e.kind === 'name_click').x = 286;
      return ev;
    },
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

describe('9:16 accept rules: every base and extra text is judged on its own (acceptRulesFor)', () => {
  const s2 = shots.shots.find((s) => s.id === 's2_review');
  const baseCatchRule = 'a catch by Rex (conventions.states.catch) within 2600 ms of the dblclick';
  // the 9:16 extra catch rule, read from shots.json so a re-measured limit (pets-3it.4) needs no edit here
  const extraCatchRule = shots.variants.vertical_9x16.shots.s2_review.extra_accept.find((r) => r.startsWith('a catch by Rex within'));

  it('finds the 9:16 extra catch rule in shots.json', () => {
    // GIVEN / WHEN — the rule looked up above; THEN — it exists, so the tests below never compare against undefined
    expect(typeof extraCatchRule).toBe('string');
    expect(extraCatchRule).toMatch(/replacing the 16:9 limit/);
  });

  /** verify.mjs's own rule list for one shot and aspect (loop-evals/pets-o3p/verify.mjs, section 4), restated here. */
  const verifyRules = (doc, id, port) => {
    const sh = doc.shots.find((s) => s.id === id);
    const reused = port && !!doc.variants?.vertical_9x16?.shots?.[id]?.reuse;
    return [...(sh.accept || []), ...(port && !reused ? doc.variants?.vertical_9x16?.shots?.[id]?.extra_accept || [] : [])].map(String);
  };

  it('records exactly the rule texts the epic eval looks for, each once, for every shot and aspect', () => {
    /**
     * The epic eval requires every base accept text and every 9:16
     * extra_accept text to appear exactly once in events.accept[] (by rule
     * text). The old recorder swapped a "replacing" extra rule in for its base
     * rule, so the 9:16 extra text was never recorded and the eval failed the
     * whole run. If this breaks, a kept take is missing (or doubles) a rule
     * the eval reads, and the run fails after hours of recording.
     */
    for (const id of shots.edit_order) {
      for (const port of [false, true]) {
        if (port && shots.variants.vertical_9x16.shots[id]?.reuse) continue; // the 9:16 cut reuses the 16:9 popup take
        // GIVEN — the texts the recorder judges for this shot and aspect, and the list verify.mjs builds
        const shot = shots.shots.find((s) => s.id === id);
        const texts = acceptRulesFor(shots, shot, port ? '9:16' : '16:9');
        const want = verifyRules(shots, id, port);

        // WHEN — the recorder evaluates them (as record.mjs does) on an empty log
        const recorded = evaluateRules(texts, wrap({}), CTX).map((r) => r.rule);

        // THEN — the recorded texts are exactly the eval's list, each verify text found once
        expect([...recorded].sort(), `${id} ${port ? '9:16' : '16:9'}`).toEqual([...want].sort());
        for (const rule of want) expect(recorded.filter((r) => r === rule), `${id}: ${rule}`).toHaveLength(1);
      }
    }
  });

  it('judges both catch rules in 9:16: a catch at 2700 ms passes the 2800 ms rule and fails the base 2600 ms rule', () => {
    /**
     * Each text is judged on its own terms: the 9:16 extra rule's 2800 ms
     * limit never stands in for the base rule's 2600 ms. A take whose catch
     * lands at 2700 ms fails the base rule, so the recorder discards it
     * instead of keeping a take the epic eval would fail.
     */
    // GIVEN — s2_review's 9:16 rules and a catch 2700 ms after the dblclick
    const texts = acceptRulesFor(shots, s2, '9:16');
    const events = wrap({ roster: rosterOf('Rex'), observed: [{ t: 0, kind: 'dblclick' }, { t: 2700, kind: 'catch', pet: 'rex', x: 300 }] });

    // WHEN — the recorder evaluates them
    const results = evaluateRules(texts, events, CTX);

    // THEN — both catch texts are recorded under their own text: the base fails, the 9:16 extra passes
    const byText = (rule) => results.filter((r) => r.rule === rule);
    expect(byText(baseCatchRule)).toHaveLength(1);
    expect(byText(extraCatchRule)).toHaveLength(1);
    expect(byText(baseCatchRule)[0].pass).toBe(false);
    expect(byText(extraCatchRule)[0].pass, byText(extraCatchRule)[0].detail).toBe(true);
  });

  it('passes both catch rules in 9:16 when the catch lands inside 2600 ms', () => {
    /**
     * The control for the test above: a catch inside both limits passes both
     * texts, so the base rule failing at 2700 ms is the limit at work, not a
     * rule that always fails in 9:16.
     */
    // GIVEN — s2_review's 9:16 rules and a catch 2500 ms after the dblclick
    const texts = acceptRulesFor(shots, s2, '9:16');
    const events = wrap({ roster: rosterOf('Rex'), observed: [{ t: 0, kind: 'dblclick' }, { t: 2500, kind: 'catch', pet: 'rex', x: 300 }] });

    // WHEN — the recorder evaluates them
    const results = evaluateRules(texts, events, CTX);

    // THEN — both catch texts pass
    for (const rule of [baseCatchRule, extraCatchRule]) {
      const hit = results.find((r) => r.rule === rule);
      expect(hit.pass, hit.detail).toBe(true);
    }
  });

  it('judges only the base rules in 16:9', () => {
    /**
     * extra_accept belongs to the 9:16 re-record only. A 16:9 take judged
     * against the 9:16 rules (the 444 px box edge, say) would be discarded
     * for a limit its own page never had.
     */
    // GIVEN — s2_review in 16:9
    // WHEN — its rule texts are listed
    const texts = acceptRulesFor(shots, s2, '16:9');

    // THEN — they are exactly the base accept[]
    expect(texts).toEqual(s2.accept);
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

describe('accept details carry the measured value (no rubber stamps)', () => {
  const dblRule = 'elementFromPoint at (800, 410) is div#dbl-zone and no pet box contains the point; the dblclick lands within 1600 ms of pets_ready';

  it('judges a 9:16 dblclick at the dblclick_css point it was really sent at, and says so', () => {
    /**
     * The 9:16 s2_review take sends its dblclick at the variant's
     * dblclick_css (300, 500), not the rule's 16:9 (800, 410). The shakedown
     * recorded the (800, 410) rule as PASS for a click it never judged; the
     * result must judge the real point and name the replacement.
     */
    // GIVEN — the real kept 9:16 s2_review log and the point choreo.mjs logged for it
    const events = realS2v916();
    const ctx = { dblclick: { x: 300, y: 500, element: 'div#dbl-zone' }, dblclickCss: { x: 300, y: 500 } };

    // WHEN — the dblclick-target rule is evaluated
    const result = evaluateRule(dblRule, events, ctx);

    // THEN — it passes on the real point and the detail names the replacement and the measured timing
    expect(result.pass, result.detail).toBe(true);
    expect(result.detail).toMatch(/at \(300, 500\): the rule's \(800, 410\) replaced in 9:16 by dblclick_css/);
    expect(result.detail).toMatch(/dblclick 1449\.5ms after pets_ready/);
  });

  it('fails a dblclick sent somewhere that is neither the rule point nor a dblclick_css', () => {
    /** Without a variant override, a click at (300, 500) is not the rule's (800, 410) click and must not pass as one. */
    // GIVEN — the same real log, with no dblclick_css in the context
    const events = realS2v916();

    // WHEN — evaluated with only the logged point
    const result = evaluateRule(dblRule, events, { dblclick: { x: 300, y: 500, element: 'div#dbl-zone' } });

    // THEN — it fails naming both points
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/neither the rule's \(800, 410\)/);
  });

  it('fails when elementFromPoint returned something other than div#dbl-zone', () => {
    /** The rule's first clause is what elementFromPoint returned at the point; it was never checked before. */
    // GIVEN — the real log, with the logged element being the page body
    const events = realS2v916();
    const ctx = { dblclick: { x: 300, y: 500, element: 'body' }, dblclickCss: { x: 300, y: 500 } };

    // WHEN — evaluated
    const result = evaluateRule(dblRule, events, ctx);

    // THEN — it fails naming the element
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/is body, not div#dbl-zone/);
  });

  it("fails when the tracked pet box at the dblclick contains the point", () => {
    /** "no pet box contains the point", judged on the logged boxes, not on choreo.mjs's word. */
    // GIVEN — the real log with Rex's box moved under (300, 500) on every frame
    const events = realS2v916();
    for (const f of events.tracks) for (const p of f.pets) Object.assign(p, { x: 280, y: 476 });
    const ctx = { dblclick: { x: 300, y: 500, element: 'div#dbl-zone' }, dblclickCss: { x: 300, y: 500 } };

    // WHEN — evaluated
    const result = evaluateRule(dblRule, events, ctx);

    // THEN — it fails naming the pet
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/rex's box contains the dblclick point/);
  });

  it('fails a walkLeft rule when the tracked box moves right', () => {
    /** "first transition is walkLeft": the direction is read from the tracked x, so a walkRight at the right time fails. */
    // GIVEN — a walk at pets_ready+2300 whose box x rises
    const rule = "Rex's first transition is walkLeft, 2000-2600 ms after pets_ready";
    const events = wrap({
      roster: rosterOf('Rex'),
      observed: [{ t: 0, kind: 'pets_ready' }, { t: 2300, kind: 'src', pet: 'rex', from: 'idle', to: 'walk' }],
      tracks: [0, 1, 2].map((i) => ({ t: 2300 + i * 16.7, pets: [{ id: 'rex', x: 700 + i * 2, y: 476, w: 64, h: 64, src: 'dog/brown_walk_8fps.gif' }] })),
    });

    // WHEN — evaluated
    const result = evaluateRule(rule, events);

    // THEN — it fails and reports the measured direction
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/x 700\.0 -> 704\.0 \(right\)/);
  });

  it('reports roster_saved against the mouseup, as the rule text says, with the saved roster', () => {
    /** The shakedown reported the time since the mousedown (242.8 ms) under a rule timed from the mouseup. */
    // GIVEN — the real kept s2b_shelter log (mouseup 4159.6, roster_saved 4159.9)
    const rule = 'within 1000 ms of that mouseup, pixel-pets-v1 holds exactly Rex, Bao and a white chicken named Pip (chrome.storage.onChanged, src/store.ts:3, 43-49)';

    // WHEN — evaluated
    const result = evaluateRule(rule, realPopup(), POPUP_CTX);

    // THEN — the detail is the time since the mouseup and names the three pets
    expect(result.pass, result.detail).toBe(true);
    expect(result.detail).toBe('roster_saved 0.3ms after the mouseup: chicken/white/Pip, dog/brown/Rex, panda/black/Bao');
  });

  it('fails the Nunito rule when the FontFace status read was not loaded', () => {
    /** The font rule judges the status popup.mjs read from document.fonts, not "asserted live". */
    // GIVEN — the real popup log and a status of 'loading'
    const rule = "Nunito is loaded (a FontFace with family Nunito has status 'loaded' in document.fonts) before the first action";

    // WHEN — evaluated
    const result = evaluateRule(rule, realPopup(), { ...POPUP_CTX, nunito: { status: 'loading', t: 3.6 } });

    // THEN — it fails naming the status
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/status was 'loading'/);
  });

  it('measures the real popup crops and click margins', () => {
    /** The crop and click rules compute each crop from the logged DOMRects; the detail carries the frame counts and margins. */
    // GIVEN — the real kept s2b_shelter log
    const crops = "every crop A, B and C rect is disjoint from every forbidden cell's DOMRect on every frame in its beat";
    const clicks = 'every popup click and the Add Pet press log the CSS point they were sent at (x, y), and each point lies inside the crop on screen at that moment (A for shelter_click, B for name_click and type_selected, C for color_selected and add_mousedown), at least 4 CSS px inside its edges';

    // WHEN — both are evaluated
    const c = evaluateRule(crops, realPopup(), POPUP_CTX);
    const k = evaluateRule(clicks, realPopup(), POPUP_CTX);

    // THEN — both pass with measured details: frame counts per crop, and each click's margin inside its crop
    expect(c.pass, c.detail).toBe(true);
    expect(c.detail).toMatch(/^A_list \d+ frames, B_pick \d+ frames, C_add \d+ frames; nearest forbidden cell [\d.]+ native px away$/);
    expect(k.pass, k.detail).toBe(true);
    expect(k.detail).toMatch(/name_click [\d.]+px inside B_pick/);
  });

  it('fails the feed-heart rule when a second, non-catch heart appears in the take', () => {
    /** "exactly one feed heart appears in the take": the whole take, as the epic eval counts it, not only the 400 ms window. */
    // GIVEN — one heart 200 ms after the mouseup and another 3 s later with no catch
    const rule = 'heart_on arrives within 400 ms of the mouseup, and exactly one feed heart appears in the take (treats go from 10 to 9 once)';
    const events = wrap({ clicks: [{ ...CLICK, kind: 'click', tMs: 0 }], observed: [{ t: 200, kind: 'heart_on' }, { t: 3200, kind: 'heart_on' }] });

    // WHEN — evaluated
    const result = evaluateRule(rule, events);

    // THEN — it fails on the take-wide count
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/2 non-catch heart_on events in the take/);
  });
});

describe('"before out" rules are judged up to the shot\'s out anchor', () => {
  const rule = 'Bao (61 px from Pip, 120 px from Rex) never plays swipe before out';
  const events = () => wrap({
    roster: rosterOf('Bao'),
    observed: [{ t: 350, kind: 'pets_ready' }, { t: 3600, kind: 'src', pet: 'bao', from: 'idle', to: 'swipe' }],
  });

  it('passes a swipe after out (pets_ready+2950) and fails one before it', () => {
    /**
     * s3's out is pets_ready+2950 (bead step 8: "before out" rules are
     * evaluated up to the shot's out anchor). A Bao greet after the cut is
     * never on film; one before it is.
     */
    // GIVEN — Bao swipes at t=3600, out at 350+2950=3300
    const ctx = { outAnchor: 'pets_ready+2950' };

    // WHEN — evaluated with that out, and with the swipe moved before it
    const after = evaluateRule(rule, events(), ctx);
    const early = events();
    early.observed[1].t = 3000;
    const before = evaluateRule(rule, early, ctx);

    // THEN
    expect(after.pass, after.detail).toBe(true);
    expect(after.detail).toMatch(/before out \(pets_ready\+2950, t=3300\.0\)/);
    expect(before.pass).toBe(false);
  });

  it('judges the first greet, not a later second one, for the greet_start rule', () => {
    /** A second greet later in the take must not replace the boot greet's timing (seed 2's shakedown read 2584 ms). */
    // GIVEN — Rex and Pip greet at pets_ready+30, and again 2.5 s later
    const greet = 'greet_start arrives within 150 ms of pets_ready: Rex and Pip play swipe from the first frames, 59 px apart, neither hovered';
    const ev = wrap({
      roster: rosterOf('Rex', 'Pip'),
      observed: [
        { t: 0, kind: 'pets_ready' },
        { t: 30, kind: 'greet_start', pet: 'rex' },
        { t: 30, kind: 'greet_start', pet: 'pip' },
        { t: 2530, kind: 'greet_start', pet: 'rex' },
        { t: 2530, kind: 'greet_start', pet: 'pip' },
      ],
    });

    // WHEN / THEN
    const result = evaluateRule(greet, ev);
    expect(result.pass, result.detail).toBe(true);
    expect(result.detail).toMatch(/swipe 30\.0ms after pets_ready/);
  });
});

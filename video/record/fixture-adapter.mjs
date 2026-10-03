// Shared test scaffolding (quality.md §I, greenfield rule): converts the
// committed real capture log `fixtures/raw.sample.json` (the proof render's
// raw log, shape: proof/rec.mjs's `result`) into the canonical RawCapture
// shape derive.mjs and accept.mjs's tests expect. Used by derive.test.mjs
// and accept.test.mjs so both exercise the same real recorded data instead
// of each re-declaring their own conversion.
//
// raw.sample.json predates this bead's per-frame tracks[] requirement (that
// capability is new in record/observe.js), so this adapter reconstructs an
// approximate tracks[] from the legacy log's per-mutation pet rects and
// per-frame ball/heart canvas samples — real recorded positions, sampled at
// coarser intervals than the new observer's rAF loop.

function parseLegacyRect(rect) {
  return rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : undefined;
}

/** raw.sample.json (legacy) identifies pets as "<type>/<color>" (proof/rec.mjs's parse()); resolve to the roster id. */
function resolveLegacyPetId(roster, typeSlashColor) {
  if (!typeSlashColor) return null;
  const [type, color] = typeSlashColor.split('/');
  const entry = roster.find((p) => p.type === type && p.color === color);
  return entry ? entry.id : null;
}

export function fromLegacyProofRaw(raw) {
  const resolve = (p) => resolveLegacyPetId(raw.roster, p);
  const src = raw.ev.src.map((e) => ({ t: e.t, pet: resolve(e.pet), from: e.from, to: e.to, rect: parseLegacyRect(e.rect) }));
  const hover = raw.ev.hover.map((e) => ({ t: e.t, kind: e.k, pet: resolve(e.pet) }));
  const mouse = raw.ev.mouse.map((e) => ({ t: e.t, kind: e.k, x: e.x, y: e.y }));
  const cursor = raw.ev.cursor.map((e) => ({ t: e.t, x: e.x, y: e.y }));

  const marks = [];
  for (const c of raw.ev.canvas) {
    if (c.kind === 'ball_on' || c.kind === 'ball_off' || c.kind === 'heart_on' || c.kind === 'heart_off') {
      marks.push({ kind: c.kind, t: c.t, x: c.x, y: c.y });
    }
  }

  // Reconstruct an approximate per-frame tracks[] at each canvas sample
  // time: the latest known rect per pet (from src mutations up to that
  // time) plus the ball position, when present, from the same canvas row.
  const petIds = [...new Set(src.map((e) => e.pet).filter(Boolean))];
  const lastState = {};
  const tracks = [];
  const events = [...raw.ev.canvas].sort((a, b) => a.t - b.t);
  let srcIdx = 0;
  for (const c of events) {
    while (srcIdx < src.length && src[srcIdx].t <= c.t) {
      if (src[srcIdx].pet) lastState[src[srcIdx].pet] = { rect: src[srcIdx].rect, gif: src[srcIdx].to };
      srcIdx++;
    }
    const pets = petIds
      .filter((id) => lastState[id])
      .map((id) => ({ id, ...lastState[id].rect, src: `assets/${id}_${lastState[id].gif}_8fps.gif` }));
    const ball = c.kind === 'ball_on' || c.kind === 'ball' ? { x: c.x, y: c.y } : undefined;
    tracks.push({ t: c.t, pets, ball });
  }

  return {
    clapStart: { tOn: raw.clap1.tOn, tOff: raw.clap1.tOff },
    clapEnd: { tOn: raw.clap2.tOn, tOff: raw.clap2.tOff },
    src,
    hover,
    mouse,
    cursor,
    tracks,
    marks,
    clicks: [],
  };
}

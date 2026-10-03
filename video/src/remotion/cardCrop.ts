// cardCrop.ts: the approved per-frame popup-card crop rule (epic
// pets-o3p, bead pets-o3p.4). Source of truth: video/shots.json
// `shots[s2b_shelter].crops` ("Rects are computed per frame from the
// DOMRects the recorder logs, never hard-coded... native px = CSS x 2,
// each edge rounded"). This is a DELIBERATE line-for-line port of
// verify.mjs v10's own `cropRule`/`nat`/`fin` helpers (the eval
// "recomputes each frame's crop from the logged DOMRects by these rules
// ... and requires the declared rect to equal it within 1 native px") —
// matching the eval's own arithmetic, not just the prose, is the only way
// to land inside CROP_RULE_TOL=1.
//
// Browser-safe: no Node imports (see timeline.ts's header) — PopupCard.tsx
// and timeline.ts's card-frame builder both need this at render/build time
// off the same logged TrackFrame data.

import type { CardCropName, Rect, TrackCell, TrackEls, TrackFrame } from '../schema';

// Not a type predicate: TS1229 disallows narrowing a rest parameter's
// element type this way. Callers still narrow with `as Rect` right after
// calling this, same as verify.mjs's own `fin(...)` does implicitly in JS.
function finite(...rects: (Rect | undefined)[]): boolean {
  return rects.every((r) => r !== undefined && [r.x, r.y, r.w, r.h].every(Number.isFinite));
}

/** verify.mjs's `nat(x0,y0,x1,y1)`: round each EDGE (not each dimension) after doubling CSS px to native px, then derive w/h from the rounded edges. */
function nativeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  const [rx0, ry0, rx1, ry1] = [x0, y0, x1, y1].map((v) => Math.round(v * 2));
  return { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
}

function findCell(cells: readonly TrackCell[] | undefined, type: string): TrackCell | undefined {
  return cells?.find((c) => c.type === type);
}

/**
 * The crop rule for one named card crop (A_list, B_pick, C_add) on one
 * logged frame, in native px. Returns null when the frame doesn't carry
 * the elements/cells that crop needs (e.g. before popup_ready, or a
 * frame whose track sample predates the form expanding for B/C).
 *
 * video/shots.json `crops`:
 * - A_list: "x 0-500; y from #pets-list top - 8 to #btn-add-toggle bottom + 4"
 * - B_pick: "x from #add-pet-form left edge to the crab cell's right edge + 3
 *   ... y from #pet-name top - 8 to the panda cell's bottom + 3"
 * - C_add: "x 0-500; y from #pet-color-label top - 4 to #btn-add bottom + 8"
 */
export function cropRule(name: CardCropName, frame: TrackFrame | undefined, viewportWidthCss: number): Rect | null {
  const els: Partial<TrackEls> = frame?.els ?? {};
  const cells = frame?.cells;

  if (name === 'A_list') {
    if (!finite(els.pets_list, els.btn_add_toggle)) return null;
    const petsList = els.pets_list as Rect;
    const toggle = els.btn_add_toggle as Rect;
    return nativeRect(0, petsList.y - 8, viewportWidthCss, toggle.y + toggle.h + 4);
  }

  if (name === 'B_pick') {
    const crab = findCell(cells, 'crab');
    const panda = findCell(cells, 'panda');
    if (!finite(els.add_pet_form, els.pet_name, crab, panda)) return null;
    const form = els.add_pet_form as Rect;
    const petName = els.pet_name as Rect;
    return nativeRect(form.x, petName.y - 8, crab!.x + crab!.w + 3, panda!.y + panda!.h + 3);
  }

  if (name === 'C_add') {
    if (!finite(els.pet_color_label, els.btn_add)) return null;
    const colourLabel = els.pet_color_label as Rect;
    const addBtn = els.btn_add as Rect;
    return nativeRect(0, colourLabel.y - 4, viewportWidthCss, addBtn.y + addBtn.h + 8);
  }

  return null;
}

/** The logged TrackFrame nearest `tMs` (events.tracks clock — see timeline.ts's `resolveAnyAnchor` header for the trimBeforeMs shift this expects the caller to have already applied). Mirrors verify.mjs's `nearestTrack`. */
export function nearestTrack(tracks: readonly TrackFrame[] | undefined, tMs: number): TrackFrame | undefined {
  let best: TrackFrame | undefined;
  for (const f of tracks ?? []) {
    if (!best || Math.abs(f.t - tMs) < Math.abs(best.t - tMs)) best = f;
  }
  return best;
}

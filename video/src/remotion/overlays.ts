// overlays.ts: every screen-space text layer of the master, with its
// on-screen frames and its rectangle in output px (epic pets-o3p, bead
// pets-o3p.4). Pure. Computed once in Node by render.mjs, drawn as-is by
// Promo.tsx, and checked frame by frame by renderChecks.ts, so the layout
// the checks pass is the layout the film shows.
//
// Source: video/shots.json (beats, overlays, variants.vertical_9x16) and
// the storyboard's "Typography and cursor": captions beside the acting
// pet, at least 80 px from every sprite box and particle column, else
// above the column; never a frame corner by default; the name tag alone in
// the caption slot; clock top right; brand line left-aligned (x 160 in
// 16:9) with the CTA under it, both clear of the sleeping pets. Text times
// are anchors shifted by the shot's videoLagMs, as the camera and SFX are.

import type { Events, Rect } from '../schema';
import { rectDistance, rectsIntersect } from './checks';
import { focusPets } from './cameraPath';
import type { StageConfig } from './camera';
import { framePets, type FrameView } from './framePets';
import { resolveAnyAnchor, type EditTimeline, type ShotBeat, type ShotsDoc } from './timeline';

export type Aspect = '16x9' | '9x16';
export type TextKind = 'caption' | 'name_tag' | 'clock' | 'brand_line' | 'cta' | 'card_caption';

export interface CtaLineSpec {
  text?: string;
  icon?: boolean;
  iconPx?: number;
  font: 'VT323' | 'Press Start 2P';
  sizePx: number;
  colour: string;
}

export interface TextItem {
  kind: TextKind;
  /** The beat that declares it. */
  beat: string;
  lines: string[];
  fontPx: number;
  /** On-screen master frames [fromFrame, toFrame). */
  fromFrame: number;
  toFrame: number;
  /** Output px. */
  rect: Rect;
  align: 'left' | 'center';
  /** clock: the text from each frame on. */
  ticks?: { text: string; fromFrame: number }[];
  /** cta: its lines, top to bottom. */
  cta?: CtaLineSpec[];
  /** Set when no spot clears the pets: the item keeps its preferred spot and renderChecks.ts fails it. */
  layoutProblem?: string;
}

export interface OverlayInput {
  edit: EditTimeline;
  shots: ShotsDoc & { overlays?: Record<string, unknown>; variants?: Record<string, unknown> };
  eventsByShotId: Record<string, Events>;
  stage: StageConfig;
  aspect: Aspect;
  outputWidth: number;
  outputHeight: number;
  noCaptions?: boolean;
}

/** VT323 advances 0.4 em a glyph (measured: "adopt: pick one." is 461 px at 72 px); Press Start 2P 1 em. */
export const textWidth = (text: string, font: 'VT323' | 'Press Start 2P', px: number): number => Math.ceil(text.length * px * (font === 'VT323' ? 0.4 : 1));
/** The caption pill: 12/22 px padding and a 3 px border around lines of line-height 1. */
export const PILL = { padX: 22, padY: 12, border: 3 } as const;
const pillSize = (lines: string[], px: number) => ({
  w: Math.max(...lines.map((l) => textWidth(l, 'VT323', px))) + 2 * (PILL.padX + PILL.border),
  h: lines.length * px + 2 * (PILL.padY + PILL.border),
});
export const NAME_TAG = { iconPx: 64, gap: 16, padX: 22, padY: 10 } as const;
export const CTA_GAP_PX = 12;
const GAP_PX = 80;

/** Wraps lowercase caption text to at most `max` characters a line (9:16: 18). */
export function wrapCaption(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

function bounds(aspect: Aspect, stage: StageConfig): Rect {
  // 16:9: inside a 48 px margin, above the floor band. 9:16: shots.json safe zones (below y 250, left of x 900, above the band).
  return aspect === '16x9' ? { x: 48, y: 48, w: 1920 - 96, h: stage.floorLine - 48 } : { x: 60, y: 250, w: 840, h: stage.floorLine - 250 };
}

/** Whether a text rect keeps clear of every pet on every frame (80 px from boxes; outside particle columns, `strict`: 80 px from them too). */
function clearOfPets(r: Rect, views: readonly FrameView[], strict: boolean): boolean {
  for (const v of views) {
    for (const p of v.pets) {
      if (rectDistance(r, p.box) < GAP_PX) return false;
      if (p.column && (strict ? rectDistance(r, p.column) < GAP_PX : rectsIntersect(r, p.column))) return false;
    }
  }
  return true;
}

/**
 * Places a w x h text block clear of the pets across its whole window:
 * beside the acting pet (right, then left), then above its particle
 * column, then the nearest clear spot to it. When nothing fits it returns
 * the preferred spot with a `problem` (renderChecks.ts fails the render).
 */
export function placeBesidePets(w: number, h: number, views: readonly FrameView[], acting: readonly string[], area: Rect, what: string): { rect: Rect; problem?: string } {
  const first = views.find((v) => v.pets.some((p) => acting.includes(p.id))) ?? views[0];
  const ap = first?.pets.filter((p) => acting.includes(p.id)) ?? [];
  const ref = ap.length
    ? ap.map((p) => p.column ?? p.box).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }))
    : { x: area.x + area.w / 2, y: area.y + area.h / 2, w: 0, h: 0 };
  const box = ap.length ? ap.map((p) => p.box).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) })) : ref;
  const clampX = (x: number) => Math.round(Math.min(area.x + area.w - w, Math.max(area.x, x)));
  const clampY = (y: number) => Math.round(Math.min(area.y + area.h - h, Math.max(area.y, y)));
  const midY = clampY(box.y + box.h / 2 - h / 2);
  const candidates: Rect[] = [
    { x: Math.round(ref.x + ref.w + GAP_PX), y: midY, w, h },
    { x: Math.round(ref.x - GAP_PX - w), y: midY, w, h },
    { x: clampX(box.x + box.w / 2 - w / 2), y: Math.round(ref.y - GAP_PX - h), w, h },
  ].filter((r) => r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const grid: Rect[] = [];
  for (let y = area.y; y + h <= area.y + area.h; y += 16) for (let x = area.x; x + w <= area.x + area.w; x += 16) grid.push({ x, y, w, h });
  grid.sort((a, b) => Math.hypot(a.x + w / 2 - cx, a.y + h / 2 - cy) - Math.hypot(b.x + w / 2 - cx, b.y + h / 2 - cy));
  for (const strict of [true, false]) {
    for (const r of [...candidates, ...grid]) if (clearOfPets(r, views, strict)) return { rect: r };
  }
  return { rect: candidates[0] ?? grid[0], problem: `no spot for ${what} (${w}x${h}) clears every pet by 80 px across its frames` };
}

/** Builds every text layer of the master. `noCaptions` keeps only the CTA (the control and thumbnail renders). */
export function buildOverlays(input: OverlayInput): TextItem[] {
  const { edit, shots, eventsByShotId, stage, aspect, outputWidth, noCaptions } = input;
  const fps = edit.fps;
  const frameMs = 1000 / fps;
  const port = aspect === '9x16';
  const area = bounds(aspect, stage);
  const items: TextItem[] = [];
  const beatSpec = (name: string): { beat: ShotBeat; shotId: string } => {
    for (const s of shots.shots) {
      const b = s.beats.find((x) => x.name === name);
      if (b) return { beat: b, shotId: s.id };
    }
    throw new Error(`overlays: no beat ${name}`);
  };
  /** A text anchor -> the master frame that first shows it (shifted by videoLagMs, as SFX and the camera are). */
  const frameOf = (spec: string, eb: (typeof edit.beats)[number]): number => {
    const ev = eventsByShotId[eb.shotId];
    if (spec === 'end') return edit.totalFrames;
    const demo = resolveAnyAnchor(spec, { events: ev, beatInMs: eb.source_in });
    const lag = spec === 'in' ? 0 : ev.videoLagMs;
    return Math.min(edit.totalFrames, Math.max(0, Math.round((demo + lag + eb.shiftMs) / frameMs)));
  };
  const views = (from: number, to: number): FrameView[] => {
    const out: FrameView[] = [];
    for (let k = from; k < to; k++) {
      const v = framePets(edit, eventsByShotId, stage, outputWidth, k);
      if (v) out.push(v);
    }
    return out;
  };
  const placement = (shots.overlays as { popup_card?: { placement?: Record<string, { caption_rect: Rect }> } } | undefined)?.popup_card?.placement?.[aspect];

  let brandItem: TextItem | null = null;
  let ctaItem: TextItem | null = null;

  for (const eb of edit.beats) {
    const { beat, shotId } = beatSpec(eb.name);
    const isCard = beat.camera.sample === 'card';
    const acting = focusPets(beat.camera.focus, eventsByShotId[shotId]);

    if (beat.caption && beat.caption_at && beat.caption_out && beat.style !== 'brand_line') {
      const from = frameOf(beat.caption_at, eb);
      const to = frameOf(beat.caption_out, eb);
      if (isCard) {
        if (!placement) throw new Error(`overlays: no overlays.popup_card.placement.${aspect}`);
        const cr = placement.caption_rect;
        const lines = beat.caption.split(/(?<=\.) /);
        const px = port ? 80 : 72;
        const { w, h } = pillSize(lines, px);
        // 16:9: left-aligned in caption_rect, centred on y 540; 9:16: centred in caption_rect.
        const rect = port ? { x: Math.round(cr.x + (cr.w - w) / 2), y: Math.round(cr.y + (cr.h - h) / 2), w, h } : { x: cr.x, y: Math.round(540 - h / 2), w, h };
        items.push({ kind: 'card_caption', beat: beat.name, lines, fontPx: px, fromFrame: from, toFrame: to, rect, align: port ? 'center' : 'left' });
      } else {
        const px = port ? 80 : 72;
        const lines = port ? wrapCaption(beat.caption, 18) : [beat.caption];
        const { w, h } = pillSize(lines, px);
        const { rect, problem } = placeBesidePets(w, h, views(from, to), acting, area, `${beat.name} caption`);
        items.push({ kind: 'caption', beat: beat.name, lines, fontPx: px, fromFrame: from, toFrame: to, rect, align: 'left', layoutProblem: problem });
      }
    }

    const ov = beat.overlay;
    if (ov?.name_tag && ov.from && ov.to) {
      const from = frameOf(ov.from, eb);
      const to = frameOf(ov.to, eb);
      const px = port ? 36 : 40;
      const w = NAME_TAG.iconPx + NAME_TAG.gap + textWidth('Pixel Pets', 'Press Start 2P', px) + 2 * (NAME_TAG.padX + PILL.border);
      const h = NAME_TAG.iconPx + 2 * (NAME_TAG.padY + PILL.border);
      const { rect, problem } = placeBesidePets(w, h, views(from, to), acting, area, `${beat.name} name tag`);
      items.push({ kind: 'name_tag', beat: beat.name, lines: ['Pixel Pets'], fontPx: px, fromFrame: from, toFrame: to, rect, align: 'left', layoutProblem: problem });
    }

    if (ov?.clock && ov.clock_out) {
      const ticks = ov.clock.map((c) => ({ text: c.text, fromFrame: frameOf(c.from, eb) }));
      const w = textWidth('22:00:00', 'VT323', 60);
      // 16:9: inside x 1600-1888, y 24-168, right-aligned; 9:16: top right below y 250, left of x 900.
      const rect = port ? { x: 880 - w, y: 270, w, h: 60 } : { x: 1888 - w, y: 66, w, h: 60 };
      items.push({ kind: 'clock', beat: beat.name, lines: [ticks[0].text], fontPx: 60, fromFrame: ticks[0].fromFrame, toFrame: frameOf(ov.clock_out, eb), rect, align: 'left', ticks });
    }

    if (beat.style === 'brand_line' && beat.caption && beat.caption_at) {
      const brandLines = port ? ((shots.variants as { vertical_9x16?: { brand_line?: string[] } } | undefined)?.vertical_9x16?.brand_line ?? [beat.caption]) : [beat.caption];
      const px = port ? 80 : 84;
      brandItem = { kind: 'brand_line', beat: beat.name, lines: brandLines, fontPx: px, fromFrame: frameOf(beat.caption_at, eb), toFrame: edit.totalFrames, rect: { x: 0, y: 0, w: Math.max(...brandLines.map((l) => textWidth(l, 'VT323', px))), h: brandLines.length * px }, align: 'left' };
    }

    if (ov?.cta && ov.from) {
      const cta = ctaLines(shots, aspect);
      const w = Math.max(...cta.map((l) => (l.icon ? (l.iconPx ?? 128) + CTA_GAP_PX : 0) + (l.text ? textWidth(l.text, l.font, l.sizePx) : 0)));
      const h = cta.reduce((sum, l) => sum + Math.max(l.icon ? (l.iconPx ?? 128) : 0, l.sizePx), 0) + CTA_GAP_PX * (cta.length - 1);
      ctaItem = { kind: 'cta', beat: beat.name, lines: [], fontPx: 0, fromFrame: frameOf(ov.from, eb), toFrame: edit.totalFrames, rect: { x: 0, y: 0, w, h }, align: 'left', cta };
    }
  }

  // The brand line and the CTA under it, as one block placed once (it never moves when the CTA arrives):
  // left-aligned (x 160 in 16:9, the 9:16 text column's x 60), its bottom 80 px above the highest pet.
  if (brandItem || ctaItem) {
    const from = Math.min(brandItem?.fromFrame ?? Infinity, ctaItem?.fromFrame ?? Infinity);
    const top = Math.min(...views(from, edit.totalFrames).flatMap((v) => v.pets.map((p) => (p.column ?? p.box).y)), area.y + area.h);
    const x = port ? 60 : 160;
    const gap = 24;
    const blockH = (brandItem?.rect.h ?? 0) + (brandItem && ctaItem ? gap : 0) + (ctaItem?.rect.h ?? 0);
    let y0 = Math.round(top - GAP_PX - blockH);
    const problem = y0 < area.y ? `the brand line and CTA (${blockH} px) do not fit 80 px above the pets (highest pet or particle column at y ${Math.round(top)})` : undefined;
    if (problem) {
      y0 = area.y;
      if (brandItem) brandItem.layoutProblem = problem;
      if (ctaItem) ctaItem.layoutProblem = problem;
    }
    if (brandItem) brandItem.rect = { ...brandItem.rect, x, y: y0 };
    if (ctaItem) ctaItem.rect = { ...ctaItem.rect, x, y: y0 + (brandItem ? brandItem.rect.h + gap : 0) };
    if (brandItem) items.push(brandItem);
    if (ctaItem) items.push(ctaItem);
  }

  return noCaptions ? items.filter((i) => i.kind === 'cta') : items;
}

/** The CTA's lines for the aspect: overlays.cta_16x9, or variants.vertical_9x16.cta. */
export function ctaLines(shots: OverlayInput['shots'], aspect: Aspect): CtaLineSpec[] {
  type Raw = { icon?: string; icon_px?: number; text?: string; font: string; size_px: number; colour?: string };
  const raw: Raw[] =
    aspect === '9x16'
      ? ((shots.variants as { vertical_9x16?: { cta?: Raw[] } } | undefined)?.vertical_9x16?.cta ?? [])
      : ((shots.overlays as { cta_16x9?: { lines?: Raw[] } } | undefined)?.cta_16x9?.lines ?? []);
  if (!raw.length) throw new Error(`overlays: no CTA lines for ${aspect} in shots.json`);
  return raw.map((l) => ({
    text: l.text,
    icon: !!l.icon || l.icon_px !== undefined,
    iconPx: l.icon_px,
    font: l.font === 'Press Start 2P' ? 'Press Start 2P' : 'VT323',
    sizePx: l.size_px,
    colour: l.colour ?? '#FFE3B0',
  }));
}

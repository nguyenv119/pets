// Render-only beat data (epic pets-o3p, bead pets-o3p.4): merges each
// shots.json beat's TEXT/overlay fields (never part of the frozen Timeline
// schema, which verify.mjs reads) with its already-resolved TimelineBeat
// timing, and converts every on/off window (caption, name tag, clock,
// CTA) to MASTER ms so the Remotion composition can fade things in/out
// without re-deriving anchors itself.
//
// Browser-safe (see timeline.ts's header) — a Remotion composition may
// import this directly rather than only consuming pre-computed JSON.

import { resolveAnyAnchor, type AnchorContext } from './timeline';
import type { ClickEvent, CursorSample, Events, TimelineBeat } from '../schema';
import type { Shot, ShotBeat, ShotsDoc } from './timeline';

export interface TextWindow {
  fromMaster: number;
  toMaster: number;
}

export interface RenderBeat {
  timeline: TimelineBeat;
  caption?: string;
  captionWindow?: TextWindow;
  nameTag?: TextWindow;
  clock?: { text: string; fromMaster: number }[];
  clockOutMaster?: number;
  ctaFromMaster?: number;
  brandLine?: boolean;
  /** This beat's shot's own cursor track/clicks, in source (CSS) coordinates, for Cursor.tsx. */
  cursorTrack: readonly CursorSample[];
  clicks: readonly ClickEvent[];
}

/**
 * Converts a source-clock ms value to master-clock ms using the beat's own
 * affine mapping (master_in <-> source_in; the edit never changes speed
 * within a beat, so this is exact, not an approximation).
 */
function toMaster(sourceMs: number, timelineBeat: TimelineBeat): number {
  return timelineBeat.master_in + (sourceMs - timelineBeat.source_in);
}

/**
 * Builds the render-only data for one shot's beats, given that shot's
 * already-computed TimelineBeat[] (in the same order as `beats`) — the
 * caller (render.mjs, or a test) is expected to have produced those via
 * `buildTimeline` first, since this function reuses their master_in/
 * source_in to convert every text anchor to master time without
 * re-deriving shot boundaries itself.
 */
export function buildRenderBeats(beats: readonly ShotBeat[], timelineBeats: readonly TimelineBeat[], events: Events): RenderBeat[] {
  if (beats.length !== timelineBeats.length) {
    throw new Error(`buildRenderBeats: ${beats.length} shot beats but ${timelineBeats.length} timeline beats`);
  }

  return beats.map((beat, i) => {
    const tl = timelineBeats[i];
    const ctx: AnchorContext = { events, beatInMs: tl.source_in };
    const render: RenderBeat = { timeline: tl, cursorTrack: events.cursorTrack, clicks: events.clicks };

    if (beat.caption) {
      render.caption = beat.caption;
      if (beat.caption_at && beat.caption_out) {
        render.captionWindow = {
          fromMaster: toMaster(resolveAnyAnchor(beat.caption_at, ctx), tl),
          toMaster: toMaster(resolveAnyAnchor(beat.caption_out, ctx), tl),
        };
      }
    }

    const overlay = beat.overlay;
    if (overlay?.name_tag && overlay.from && overlay.to) {
      render.nameTag = {
        fromMaster: toMaster(resolveAnyAnchor(overlay.from, ctx), tl),
        toMaster: toMaster(resolveAnyAnchor(overlay.to, ctx), tl),
      };
    }
    if (overlay?.clock) {
      render.clock = overlay.clock.map((c) => ({ text: c.text, fromMaster: toMaster(resolveAnyAnchor(c.from, ctx), tl) }));
      if (overlay.clock_out) {
        render.clockOutMaster = toMaster(resolveAnyAnchor(overlay.clock_out, ctx), tl);
      }
    }
    if (overlay?.cta && overlay.from) {
      render.ctaFromMaster = toMaster(resolveAnyAnchor(overlay.from, ctx), tl);
    }
    if (beat.style === 'brand_line') {
      render.brandLine = true;
    }

    return render;
  });
}

export type { Shot, ShotBeat, ShotsDoc };

// framePets.ts: where the pets are on each master frame (and each README
// GIF frame), in OUTPUT px (epic pets-o3p, bead pets-o3p.4). Pure. The
// overlay layout (overlays.ts) places text clear of them and the render
// checks (renderChecks.ts) verify every frame against them. The particle
// column is checks.ts's `particleColumn`, scaled to output px.

import type { Events, Rect } from '../schema';
import { CHECK_THRESHOLDS, particleColumn } from './checks';
import { loggedMsAt, visiblePetBoxesStage } from './cameraPath';
import type { StageConfig } from './camera';
import type { EditBeat, EditTimeline } from './timeline';

export interface FramePet {
  id: string;
  /** The pet's box in output px. */
  box: Rect;
  /** Its particle column in output px (checks.ts particleColumn), when it can emit particles on this frame. */
  column?: Rect;
}

export interface FrameView {
  beat: EditBeat;
  k: number;
  /** Page beats: the stage crop on this frame. Card beats: undefined. */
  crop?: Rect;
  /** Output px per CSS px on this frame (2 x the camera scale): the particle column's scale. */
  unitsPerCss: number;
  pets: FramePet[];
}

/** demo-clock ms -> the src state ("lie", "swipe", ...) a pet shows, from the logged src transitions. */
function stateAt(events: Events, petId: string, loggedMs: number): string {
  let last = '';
  for (const o of events.observed) if (o.kind === 'src' && o.pet === petId && o.t <= loggedMs) last = String(o.to ?? '');
  const m = /(idle|walk|run|swipe|lie)/.exec(last.split('/').pop() ?? '');
  return m ? m[1] : last;
}

/**
 * The logged times a pet spawns particles: a hover or greet wave (src ->
 * swipe), a feed (eat, or the heart_on beside it) and a catch. A heart_on
 * with no pet is credited to the pet whose eat or catch is within 200 ms,
 * else to every pet.
 */
export function emissionTimes(events: Events, petId: string): number[] {
  const ts: number[] = [];
  for (const o of events.observed) {
    if (o.kind === 'src' && o.pet === petId && /swipe/.test(String(o.to ?? ''))) ts.push(o.t);
    else if ((o.kind === 'eat' || o.kind === 'catch' || o.kind === 'greet') && o.pet === petId) ts.push(o.t);
    else if (o.kind === 'heart_on') {
      const owner = events.observed.find((x) => (x.kind === 'eat' || x.kind === 'catch') && x.pet && Math.abs(x.t - o.t) <= 200);
      if (!owner || owner.pet === petId) ts.push(o.t);
    }
  }
  return ts;
}

const toOutput = (b: Rect, crop: Rect, s: number): Rect => ({ x: (b.x - crop.x) * s, y: (b.y - crop.y) * s, w: b.w * s, h: b.h * s });

/**
 * The visible pets at logged time `loggedMs`, in output px of a frame that
 * shows `crop` (stage px) magnified by `s` output px per stage px: each
 * box, and the particle column of every pet that can emit then (a hover,
 * greet, feed or catch less than PARTICLE_LIFETIME_MS ago, unless it lies
 * asleep).
 */
export function petsInOutput(events: Events, loggedMs: number, stage: StageConfig, crop: Rect, s: number): FramePet[] {
  const unitsPerCss = 2 * s;
  const life = CHECK_THRESHOLDS.PARTICLE_LIFETIME_MS;
  return visiblePetBoxesStage(events, loggedMs, stage).map(({ id, box }) => {
    const out: FramePet = { id, box: toOutput(box, crop, s) };
    const emitting = stateAt(events, id, loggedMs) !== 'lie' && emissionTimes(events, id).some((t) => loggedMs >= t && loggedMs <= t + life);
    if (emitting) out.column = particleColumn(out.box, unitsPerCss);
    return out;
  });
}

/** The pets on master frame k, in output px (none on a card frame). */
export function framePets(edit: EditTimeline, eventsByShotId: Record<string, Events>, stage: StageConfig, outputWidth: number, k: number): FrameView | null {
  const beat = edit.beats.find((b) => k >= b.k0 && k < b.k1);
  if (!beat) return null;
  if (!beat.frameCrops) return { beat, k, unitsPerCss: 0, pets: [] };
  const crop = beat.frameCrops[k - beat.k0];
  const events = eventsByShotId[beat.shotId];
  const frameMs = 1000 / edit.fps;
  const s = outputWidth / crop.w;
  return { beat, k, crop, unitsPerCss: 2 * s, pets: petsInOutput(events, loggedMsAt(events, k * frameMs - beat.shiftMs), stage, crop, s) };
}

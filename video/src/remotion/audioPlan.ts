// audioPlan.ts: the music bed's level changes and every per-event SFX,
// in master frames (epic pets-o3p, bead pets-o3p.4). Pure. AudioMap.tsx
// only places what this returns.
//
// Source: video/shots.json beats[].sfx (one sound per event, file paths
// under video/assets/) and the storyboard's "Music and SFX": the bed is
// quiet from frame 0, comes up over 1.2 s on the first wave
// (src:rex:swipe), and stops with a 250 ms fade on the lights-out switch
// (sleep); Kenney files peak near -1 dBFS, so they play about 11 dB down
// unless a cue names its own peak (about -24 dBFS: 23 dB down); each
// ball_floor before the catch is 3 dB quieter than the last. Every cue is
// shifted by its shot's videoLagMs so it lands on the frame that shows
// the event.

import type { Events } from '../schema';
import { anchorMasterFrame, demoMasterFrame, findAnchorMasterFrame, type EditTimeline, type ShotsDoc } from './timeline';

export interface SfxCue {
  /** public-dir path, e.g. "sfx/kenney_interface/Audio/click_001.ogg". */
  src: string;
  /** master frame the sound starts on. */
  frame: number;
  gainDb: number;
  rate: number;
  /** what fired it, for the render log */
  at: string;
}

export interface MusicPlan {
  src: string;
  /** dB relative to the file, on [0, upFrom) */
  quietDb: number;
  /** dB once up (the proof's -2 dB relative bed; the pipeline bead normalises the master) */
  upDb: number;
  /** first wave: the ramp from quiet to up starts here and lasts upFrames */
  upFrom: number;
  upFrames: number;
  /** lights out: a fade to silence over stopFrames, starting here */
  stopAt: number;
  stopFrames: number;
}

export const KENNEY_PEAK_DBFS = -1;
export const SFX_DEFAULT_DB = -11;
export const BED_UP_DB = -2;
/** about -30 LUFS short-term against about -22 once up: 8 dB under the up level */
export const BED_QUIET_DB = BED_UP_DB - 8;

type SfxSpec = { file: string; at: string; peak_dbfs?: number; rate?: number; rule?: string };

/** Every SFX cue of the edit. A cue whose anchor this take never logs is skipped (e.g. no ball_floor before the catch). */
export function buildSfx(edit: EditTimeline, shots: ShotsDoc, eventsByShotId: Record<string, Events>): SfxCue[] {
  const cues: SfxCue[] = [];
  for (const eb of edit.beats) {
    const spec = shots.shots.find((s) => s.id === eb.shotId)?.beats.find((b) => b.name === eb.name) as { sfx?: SfxSpec[] } | undefined;
    const ev = eventsByShotId[eb.shotId];
    for (const cue of spec?.sfx ?? []) {
      const gain = cue.peak_dbfs !== undefined ? cue.peak_dbfs - KENNEY_PEAK_DBFS : SFX_DEFAULT_DB;
      // the master frame of each sound: ball_floor plays once per floor contact before the catch, every other cue once
      const frames: number[] = [];
      if (cue.at === 'ball_floor') {
        // "each floor contact before the catch, 3 dB quieter each time"
        const caught = ev.observed.find((o) => o.kind === 'catch')?.t ?? Infinity;
        ev.observed.filter((o) => o.kind === 'ball_floor' && o.t < caught).forEach((o) => frames.push(demoMasterFrame(o.t + ev.trimBeforeMs, eb, ev, edit.fps)));
      } else {
        try {
          frames.push(anchorMasterFrame(cue.at, eb, ev, edit.fps));
        } catch {
          continue;
        }
      }
      frames.forEach((frame, i) => {
        if (frame < 0 || frame >= edit.totalFrames) return;
        cues.push({ src: cue.file, frame, gainDb: gain - 3 * i, rate: cue.rate ?? 1, at: cue.at });
      });
    }
  }
  return cues.sort((a, b) => a.frame - b.frame);
}

/** The bed's level plan: up on the first wave in s1_inbox, out on the lights-out switch in s4_article_night. */
export function buildMusicPlan(edit: EditTimeline, eventsByShotId: Record<string, Events>, src: string): MusicPlan {
  const frameMs = 1000 / edit.fps;
  const up = findAnchorMasterFrame(edit, eventsByShotId, 'src:rex:swipe') ?? 0;
  const stop = findAnchorMasterFrame(edit, eventsByShotId, 'sleep') ?? edit.totalFrames;
  return { src, quietDb: BED_QUIET_DB, upDb: BED_UP_DB, upFrom: up, upFrames: Math.round(1200 / frameMs), stopAt: stop, stopFrames: Math.round(250 / frameMs) };
}

/** The bed's gain (linear) on a master frame. */
export function musicGainAt(plan: MusicPlan, frame: number): number {
  const db = (x: number) => Math.pow(10, x / 20);
  if (frame >= plan.stopAt + plan.stopFrames) return 0;
  const u = Math.min(1, Math.max(0, (frame - plan.upFrom) / plan.upFrames));
  const level = db(plan.quietDb + (plan.upDb - plan.quietDb) * u);
  if (frame < plan.stopAt) return level;
  return level * (1 - (frame - plan.stopAt) / plan.stopFrames);
}

import { describe, expect, it } from 'vitest';
import { BED_QUIET_DB, BED_UP_DB, buildSfx, musicGainAt, SFX_DEFAULT_DB, type MusicPlan } from './audioPlan';
import { makeEvents } from './testEvents';
import type { EditTimeline, ShotsDoc } from './timeline';

const db = (x: number) => Math.pow(10, x / 20);

describe('musicGainAt', () => {
  const plan: MusicPlan = { src: 'm', quietDb: BED_QUIET_DB, upDb: BED_UP_DB, upFrom: 100, upFrames: 30, stopAt: 500, stopFrames: 6 };

  it('plays quietly from frame 0, comes up over 1.2 s on the first wave, and stops with a 250 ms fade on lights out', () => {
    /** The storyboard's bed: an embed is audibly a video from frame 0, the wave lifts it, the switch ends it. */
    expect(musicGainAt(plan, 0)).toBeCloseTo(db(BED_QUIET_DB), 6);
    expect(musicGainAt(plan, 115)).toBeGreaterThan(db(BED_QUIET_DB));
    expect(musicGainAt(plan, 115)).toBeLessThan(db(BED_UP_DB));
    expect(musicGainAt(plan, 200)).toBeCloseTo(db(BED_UP_DB), 6);
    expect(musicGainAt(plan, 503)).toBeCloseTo(db(BED_UP_DB) / 2, 6);
    expect(musicGainAt(plan, 506)).toBe(0);
  });
});

describe('buildSfx', () => {
  const shots: ShotsDoc = {
    edit_order: ['s'],
    shots: [
      {
        id: 's',
        beats: [
          {
            name: 'b',
            camera: { zoom: 1, focus: 'page', move: 'hold', sample: 1 },
            sfx: [
              { file: 'sfx/a.ogg', at: 'catch' },
              { file: 'sfx/b.ogg', at: 'catch', peak_dbfs: -24 },
              { file: 'sfx/bounce.ogg', at: 'ball_floor' },
              { file: 'sfx/never.ogg', at: 'greet_start' },
            ],
          },
        ],
      },
    ],
  };
  const events = makeEvents({ trimBeforeMs: 1000, videoLagMs: 56, observed: [{ t: 2000, kind: 'ball_floor' }, { t: 2400, kind: 'ball_floor' }, { t: 3000, kind: 'catch', pet: 'rex' }, { t: 3500, kind: 'ball_floor' }] });
  const edit = { music: 'm', fps: 25, totalFrames: 500, beats: [{ name: 'b', shotId: 's', shiftMs: -1000, k0: 0, k1: 500, source_in: 1000, source_out: 21000 }] } as unknown as EditTimeline;

  it('lands each cue on the frame that shows its event (log + trimBeforeMs + videoLagMs, in master time)', () => {
    /** Captions and SFX must be shifted by videoLagMs or they land a frame early (bead "Proven facts"). */
    const sfx = buildSfx(edit, shots, { s: events });
    expect(sfx.find((c) => c.src === 'sfx/a.ogg')!.frame).toBe(Math.round((3000 + 56) / 40));
  });

  it('plays Kenney files about 11 dB down, and a cue with its own peak at that peak', () => {
    const sfx = buildSfx(edit, shots, { s: events });
    expect(sfx.find((c) => c.src === 'sfx/a.ogg')!.gainDb).toBe(SFX_DEFAULT_DB);
    expect(sfx.find((c) => c.src === 'sfx/b.ogg')!.gainDb).toBe(-23);
  });

  it('plays one bounce per floor contact before the catch, each 3 dB quieter, and skips anchors the take never logs', () => {
    /** "each floor contact before the catch, 3 dB quieter each time"; a missing anchor is no sound, not a crash. */
    const bounces = buildSfx(edit, shots, { s: events }).filter((c) => c.src === 'sfx/bounce.ogg');
    expect(bounces.map((c) => c.gainDb)).toEqual([SFX_DEFAULT_DB, SFX_DEFAULT_DB - 3]);
    expect(buildSfx(edit, shots, { s: events }).some((c) => c.src === 'sfx/never.ogg')).toBe(false);
  });
});

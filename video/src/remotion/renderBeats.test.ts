import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Events } from '../schema';
import { STAGE_16X9 } from './camera';
import { buildRenderBeats } from './renderBeats';
import { buildTimeline, type ShotsDoc } from './timeline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', 'fixtures');

function loadFixtureEvents(): Events {
  return JSON.parse(readFileSync(join(fixturesDir, 'events.sample.json'), 'utf8'));
}

function loadFixtureShots(): ShotsDoc {
  return JSON.parse(readFileSync(join(fixturesDir, 'shots.sample.json'), 'utf8'));
}

describe('buildRenderBeats', () => {
  const shotsDoc = loadFixtureShots();
  const events = loadFixtureEvents();
  const shot = shotsDoc.shots.find((s) => s.id === 'sample_hover_treat_catch')!;

  function buildTimelineBeats() {
    const timeline = buildTimeline({
      shots: { edit_order: [shot.id], shots: [shot] },
      stage: STAGE_16X9,
      eventsByShotId: { [shot.id]: events },
      sourceByShotId: { [shot.id]: '/build/fixture/sample_hover_treat_catch/demo.mp4' },
      music: 'assets/music/cat_caffe.ogg',
    });
    return timeline.beats;
  }

  it('carries each beat\'s caption text through unchanged', () => {
    /**
     * The frozen Timeline schema never carries caption text (verify.mjs
     * doesn't need it — it only samples pixels). This is the render-only
     * bridge that gives the composition the text to draw; if the text
     * doesn't survive the merge, the render would show an empty caption
     * pill instead of the authored line.
     */
    const renderBeats = buildRenderBeats(shot.beats, buildTimelineBeats(), events);
    expect(renderBeats[0].caption).toBe('hover: he waves.');
  });

  it('converts a caption\'s on/off window from source ms to master ms via the beat\'s own affine offset', () => {
    /**
     * Verifies the core arithmetic this module exists for: master_t =
     * master_in + (source_t - source_in). A caption window left in
     * source time would fade in/out at the wrong point in the final
     * video whenever a beat's master_in differs from its source_in
     * (true for every beat after the first, since the master is a
     * concatenation of independently-timed source clips).
     */
    const timelineBeats = buildTimelineBeats();
    const renderBeats = buildRenderBeats(shot.beats, timelineBeats, events);
    const beat0 = timelineBeats[0];
    const window = renderBeats[0].captionWindow!;
    // caption_at is "src:rex:swipe" for b_hover; recompute its expected master time
    // via the same demo.mp4-alignment shift (trimBeforeMs) production code applies.
    const swipe = events.observed.find((e) => e.kind === 'src' && e.pet === 'rex' && e.to === 'swipe')!;
    const expectedSourceT = swipe.t + events.trimBeforeMs;
    const expectedFromMaster = beat0.master_in + (expectedSourceT - beat0.source_in);
    expect(window.fromMaster).toBe(expectedFromMaster);
  });

  it('throws when the beats and timelineBeats arrays have mismatched lengths', () => {
    /**
     * A length mismatch means the caller passed timeline beats from a
     * different (or partially-filtered) shot — silently zipping mismatched
     * arrays would attach the wrong timing to the wrong caption text.
     */
    const timelineBeats = buildTimelineBeats();
    expect(() => buildRenderBeats(shot.beats.slice(0, 2), timelineBeats, events)).toThrow(/beats but/);
  });

  it('leaves captionWindow undefined for a beat with no caption', () => {
    /**
     * A beat that carries no `caption` field (e.g. b1c_name, which shows
     * only the name tag) must not get a captionWindow — a stray window
     * would make the composition try to render undefined caption text.
     */
    const timelineBeats = buildTimelineBeats();
    const noCaptionBeat = { ...shot.beats[0], caption: undefined, caption_at: undefined, caption_out: undefined };
    const renderBeats = buildRenderBeats([noCaptionBeat], [timelineBeats[0]], events);
    expect(renderBeats[0].caption).toBeUndefined();
    expect(renderBeats[0].captionWindow).toBeUndefined();
  });
});

// gifScenes.ts: the README GIF's scenes resolved to frames (epic pets-o3p,
// bead pets-o3p.4). Pure. Each scene's crop must lie inside the capture viewport. video/shots.json variants.readme_gif: scene
// in/out anchors on each shot's own events, 12.5 fps, and each scene's two
// captions shown over their own beats' caption windows (the beat in that
// shot whose caption is that text), shifted by videoLagMs like the master.

import type { Events } from '../schema';
import { PILL, textWidth, type TextItem } from './overlays';
import type { CursorData } from './plan';
import { resolveAnyAnchor, type ShotsDoc } from './timeline';

export interface GifScene {
  shotId: string;
  stagedSrc: string;
  sourceInMs: number;
  /** first GIF frame of the scene, and its length in frames */
  fromFrame: number;
  frames: number;
  /** the source frame (at the GIF's fps) on the scene's first frame */
  trimBeforeFrames: number;
  cropCss: { x: number; y: number; w: number; h: number };
  captions: TextItem[];
  cursor: CursorData;
}

interface GifSpec {
  fps: number;
  scenes: { shot: string; crop_css: { x: number; y: number; w: number; h: number }; in: string; out: string; captions: string[] }[];
}

export function buildGifScenes(shots: ShotsDoc & { viewport: { width: number; height: number }; variants?: { readme_gif?: GifSpec } }, eventsByShotId: Record<string, Events>, stagedByShotId: Record<string, string>): { scenes: GifScene[]; fps: number; totalFrames: number } {
  const spec = shots.variants?.readme_gif;
  if (!spec) throw new Error('gif: shots.json has no variants.readme_gif');
  const fps = spec.fps;
  const frameMs = 1000 / fps;
  let cursor = 0;
  const vp = shots.viewport;
  const scenes = spec.scenes.map((sc) => {
    const c = sc.crop_css;
    // the raw capture is the only footage under the band: a crop past it would show the composition's background
    if (c.x < 0 || c.y < 0 || c.x + c.w > vp.width || c.y + c.h > vp.height) throw new Error(`gif: scene ${sc.shot} crop ${JSON.stringify(c)} reaches outside the ${vp.width}x${vp.height} capture`);
    const ev = eventsByShotId[sc.shot];
    const inMs = resolveAnyAnchor(sc.in, { events: ev });
    const outMs = resolveAnyAnchor(sc.out, { events: ev });
    if (!(outMs > inMs)) throw new Error(`gif: scene ${sc.shot} ends (${sc.out}) before it starts (${sc.in})`);
    // the scene starts on a whole source frame at the GIF's own fps, so master frame k shows source time exactly
    const trim = Math.ceil(inMs / frameMs);
    const frames = Math.round((outMs - trim * frameMs) / frameMs);
    const from = cursor;
    cursor += frames;
    const shot = shots.shots.find((s) => s.id === sc.shot);
    const captions: TextItem[] = sc.captions.map((text) => {
      const beat = shot?.beats.find((b) => b.caption === text);
      if (!beat?.caption_at || !beat.caption_out) throw new Error(`gif: no beat in ${sc.shot} captions "${text}"`);
      const at = (spec: string) => resolveAnyAnchor(spec, { events: ev }) + ev.videoLagMs;
      const f0 = Math.max(from, from + Math.round((at(beat.caption_at) - trim * frameMs) / frameMs));
      const f1 = Math.min(from + frames, from + Math.round((at(beat.caption_out) - trim * frameMs) / frameMs));
      const w = textWidth(text, 'VT323', 32) + 2 * (PILL.padX + PILL.border);
      const h = 32 + 2 * (PILL.padY + PILL.border);
      return { kind: 'caption', beat: beat.name, lines: [text], fontPx: 32, fromFrame: f0, toFrame: Math.max(f0, f1), rect: { x: 24, y: 24, w, h }, align: 'left' };
    });
    return {
      shotId: sc.shot,
      stagedSrc: stagedByShotId[sc.shot],
      sourceInMs: trim * frameMs,
      fromFrame: from,
      frames,
      trimBeforeFrames: trim,
      cropCss: sc.crop_css,
      captions,
      cursor: { track: ev.cursorTrack, clicks: ev.clicks, trimBeforeMs: ev.trimBeforeMs, videoLagMs: ev.videoLagMs },
    };
  });
  return { scenes, fps, totalFrames: cursor };
}

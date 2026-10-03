#!/usr/bin/env node
// Stage 4: the README GIF (pets-o3p.5 step 3, storyboard "README GIF").
// Encodes render.mjs --variant gif's frames (out/gif-frames/, 1920x720 PNGs
// at 12.5 fps, two no-zoom scenes) into out/pixel-pets.gif: halved
// nearest-neighbour to 960x360 (an integer factor, so text strokes and sprite
// pixels survive), one palette per scene (palettegen stats_mode=diff, plus
// every rostered pet's exact sprite colours reserved), paletteuse dither=none
// (bayer crosshatches text), loop forever.
//
// Then the colour gate: on every judgeable GIF frame, each opaque Rex pixel
// (his source sprite frame's alpha, placed at his tracked box the way the
// extension draws him, and halved like the GIF) must be within 8 RGB units of
// a colour in that source frame. It catches a colour shift anywhere between
// the screen and the GIF: an untagged encode decoded by Remotion (13 units
// off when measured) or a starved palette. The stage also fails at 5 MB
// or more, or outside 960x360 and 7-10.5 s (the size and byte limit come from
// shots.json variants.readme_gif).
//
// Usage: npx tsx scripts/gif.mjs --run build/<run>

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { shotDir } from '../record/layout.mjs';
import { loggedMsAt } from '../src/remotion/cameraPath.ts';
import { nearestTrack } from '../src/remotion/cardCrop.ts';
import { buildGifScenes } from '../src/remotion/gifScenes.ts';
import { sampleCursor } from '../src/remotion/Cursor.tsx';
import { CHECK_THRESHOLDS } from '../src/remotion/checks.ts';
import { ffmpeg, isMain, OUT_DIR, probe, readJson, REPO_DIR, runArg, VIDEO_DIR } from './stage-io.mjs';

export const GIF_PATH = join(OUT_DIR, 'pixel-pets.gif');
export const FRAMES_DIR = join(OUT_DIR, 'gif-frames');
const README_GIF = readJson(join(VIDEO_DIR, 'shots.json')).variants.readme_gif;
export const MAX_BYTES = README_GIF.max_bytes;
export const SIZE = { width: README_GIF.size.width, height: README_GIF.size.height };
/** About shots.json's nominal_length_s (8.6 s), with room for the scene anchors to land a little either way. */
export const LENGTH_S = [7.0, 10.5];
/** Everything the finished GIF file is held to; makeGif and qa.mjs both check it with checkGif. */
export const GIF_SPEC = { maxBytes: MAX_BYTES, size: SIZE, seconds: LENGTH_S };
/** The colour gate: max per-channel distance from a source-frame colour (storyboard colour_check). */
export const MAX_COLOUR_ERROR = 8;
/**
 * GIF px searched either side of the tracked box. Real recorder tracks are
 * the img's own DOMRect, but the track sample and the frame are not taken at
 * the same instant and a running Rex covers 6-12 px per 40 ms source frame;
 * the synthetic run's tracks (interpolated from src events, which the PASS
 * control uses) sit up to about 35 px off the footage. Vertically he only
 * bobs. A wide search cannot hide a colour shift: every placement of 100+
 * opaque pixels lands on shifted sprite pixels or on page colours, which are
 * 10+ units from his palette (the untagged FAIL control fails at every shift).
 */
export const SEARCH_X = 96;
export const SEARCH_Y = 3;
/** Shifts nearest the tracked box first, so the honest placement is found early and the rest stop at its error. */
const SHIFTS_X = Array.from({ length: 2 * SEARCH_X + 1 }, (_, i) => i - SEARCH_X).sort((a, b) => Math.abs(a) - Math.abs(b));
/** Sprite px an opaque pixel must sit from any transparent one to be judged (the sampling phase of two nearest-neighbour scalings). */
export const ERODE_SPRITE_PX = 2;
/** Fewer opaque pixels than this under a candidate placement is not a placement of Rex. */
export const MIN_MASK_PX = 100;
/** Fewer judged frames than this FAILS: the gate must never pass vacuously. */
export const MIN_JUDGED_FRAMES = 20;
/** ms after an eat, catch or heart_on during which the extension's 🍖/❤️ particles may cover Rex. */
export const PARTICLE_MS = CHECK_THRESHOLDS.PARTICLE_LIFETIME_MS + 100;
/** The pet the gate judges: Rex, the cast dog, on screen in both GIF scenes. */
const PET_ID = 'rex';

// ---------- pure: time and geometry ----------

/** GIF frame k -> its scene, shot and the demo.mp4 ms it shows. */
export function gifFrameMoment(scenes, fps, k) {
  const scene = scenes.find((s) => k >= s.fromFrame && k < s.fromFrame + s.frames);
  if (!scene) return null;
  return { scene, shotId: scene.shotId, demoMs: scene.sourceInMs + ((k - scene.fromFrame) * 1000) / fps };
}

/** The GIF frame that shows demo.mp4 ms `demoMs` of `shotId` (rounded to the nearest frame), or null outside its scene. */
export function gifFrameAt(scenes, fps, shotId, demoMs) {
  const scene = scenes.find((s) => s.shotId === shotId);
  if (!scene) return null;
  const k = scene.fromFrame + Math.round(((demoMs - scene.sourceInMs) * fps) / 1000);
  return k >= scene.fromFrame && k < scene.fromFrame + scene.frames ? k : null;
}

/**
 * A tracked src -> the repo sprite it shows: a full URL
 * (`chrome-extension://<id>/assets/dog/brown_idle_8fps.gif` ->
 * `<repo>/assets/dog/brown_idle_8fps.gif`), or a bare state (`walk`, as the
 * synthetic run logs it) resolved through the pet's roster entry.
 */
export function spritePath(src, pet) {
  const m = /\/assets\/([a-z]+\/[a-z]+_[a-z]+_8fps\.gif)$/.exec(String(src));
  if (m) return join(REPO_DIR, 'assets', m[1]);
  if (pet && /^(idle|walk|run|swipe|lie|with_ball)$/.test(String(src))) return join(REPO_DIR, 'assets', pet.type, `${pet.color}_${src}_8fps.gif`);
  throw new Error(`gif: cannot map sprite src "${src}" to a repo asset`);
}

/**
 * Rex at logged ms `tMs`, in GIF px of a scene cropped at `cropCss`: his box
 * (from the nearest track, or null when that track is more than `maxGapMs`
 * away, so a tracking gap never stands in a stale box) and every sprite src
 * logged within `srcWindowMs` (the src can change between a track sample and
 * the frame).
 */
export function rexAt(events, tMs, cropCss, srcWindowMs = 60, maxGapMs = 80) {
  const f = nearestTrack(events.tracks, tMs);
  if (!f || Math.abs(f.t - tMs) > maxGapMs) return null;
  const box = f.pets?.find((p) => p.id === PET_ID);
  if (!box) return null;
  const srcs = new Set();
  for (const t of events.tracks) if (Math.abs(t.t - tMs) <= srcWindowMs) for (const p of t.pets ?? []) if (p.id === PET_ID && p.src) srcs.add(p.src);
  if (box.src) srcs.add(box.src);
  const toGif = (b) => ({ x: b.x - cropCss.x, y: b.y - cropCss.y, w: b.w, h: b.h });
  const others = (f.pets ?? []).filter((p) => p.id !== PET_ID).map(toGif);
  return { box: toGif(box), srcs: [...srcs], others };
}

/** Rex's sprite states (src/renderer.ts resolveGifName): every file his type and colour can show. */
export const STATES = ['idle', 'walk', 'run', 'swipe', 'lie', 'with_ball'];

/**
 * The sprite files to try on a frame: the tracked srcs first, then every
 * other state of the same pet. The screen can show the next state a frame
 * before the track logs it (and the synthetic run logs states only at its
 * own src events), and every state shares one palette per pet, so trying
 * them all cannot excuse a colour shift.
 */
export function candidateSprites(srcs, pet) {
  const paths = srcs.map((src) => spritePath(src, pet));
  const m = /\/assets\/([a-z]+)\/([a-z]+)_[a-z_]+_8fps\.gif$/.exec(paths[0] ?? '');
  const type = m?.[1] ?? pet?.type;
  const color = m?.[2] ?? pet?.color;
  if (type && color) for (const st of STATES) paths.push(join(REPO_DIR, 'assets', type, `${color}_${st}_8fps.gif`));
  return [...new Set(paths)].filter((p) => existsSync(p));
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Why a GIF frame cannot be judged (a reason string), or null when it can:
 * the extension's particles may cover Rex, or the drawn cursor and its rings,
 * a caption pill or another tracked pet come within the search reach of his
 * box. `box` and `others` are in GIF px.
 */
export function unjudgeable({ events, tMs, box, cropCss, captionRects = [], others = [] }) {
  for (const o of events.observed ?? []) {
    if (['eat', 'catch', 'heart_on'].includes(o.kind) && tMs >= o.t - 100 && tMs <= o.t + PARTICLE_MS) return `particles (${o.kind}@${Math.round(o.t)})`;
  }
  const near = { x: box.x - SEARCH_X - 2, y: box.y - SEARCH_Y - 2, w: box.w + 2 * SEARCH_X + 4, h: box.h + 2 * SEARCH_Y + 4 };
  const c = sampleCursor(events.cursorTrack ?? [], tMs);
  if (c && overlaps({ x: c.x - cropCss.x - 10, y: c.y - cropCss.y - 10, w: 30, h: 35 }, near)) return 'cursor over Rex';
  if (captionRects.some((r) => overlaps(r, near))) return 'caption over Rex';
  // another pet can be drawn over him; the search reaches SEARCH_X either side, so a pet anywhere in that reach could stand in for him
  if (others.some((o) => overlaps(o, near))) return 'another pet near Rex';
  return null;
}

/** Where object-fit:contain + object-position:bottom puts an sw x sh sprite in a w x h box: offset and px per sprite px. */
export function spriteLayout(box, sw, sh) {
  const scale = Math.min(box.w / sw, box.h / sh);
  return { offX: (box.w - sw * scale) / 2, offY: box.h - sh * scale, scale };
}

/** The sprite frame's opaque pixels at least `r` sprite px from any transparent or out-of-frame pixel. */
export function erodedMask(rgba, sw, sh, r = ERODE_SPRITE_PX) {
  const mask = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r && ok; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= sw || yy >= sh || rgba[(yy * sw + xx) * 4 + 3] < 255) ok = false;
        }
      }
      mask[y * sw + x] = ok ? 1 : 0;
    }
  }
  return mask;
}

/** Every opaque colour of one sprite frame, as packed RGB ints. */
export function framePalette(rgba) {
  const set = new Set();
  for (let p = 0; p < rgba.length; p += 4) if (rgba[p + 3] === 255) set.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
  return [...set];
}

/** Max per-channel distance from (r,g,b) to the nearest palette colour. */
export function paletteDistance(r, g, b, palette) {
  let best = 255;
  for (const c of palette) {
    const d = Math.max(Math.abs(r - (c >> 16)), Math.abs(g - ((c >> 8) & 255)), Math.abs(b - (c & 255)));
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

const spriteCache = new WeakMap();
/** A sprite frame's eroded mask and palette, computed once per decoded frame. */
function spriteFrameInfo(rgba, w, h) {
  let info = spriteCache.get(rgba);
  if (!info) {
    const pal = framePalette(rgba);
    info = { mask: erodedMask(rgba, w, h), pal, key: pal.join(',') };
    spriteCache.set(rgba, info);
  }
  return info;
}

/**
 * The opaque, eroded sprite pixels of one frame and facing, as image offsets
 * from (floor(box.x), floor(box.y)): where the extension draws them in GIF px
 * (object-fit contain, bottom-centred, halved like the GIF).
 */
function placedMask(box, sprite, mask, flip) {
  const { offX, offY, scale } = spriteLayout(box, sprite.w, sprite.h);
  const fx = box.x - Math.floor(box.x);
  const fy = box.y - Math.floor(box.y);
  const out = [];
  for (let ry = 0; ry <= Math.ceil(box.h) + 1; ry++) {
    const sy = Math.floor((ry + 0.5 - fy - offY) / scale);
    if (sy < 0 || sy >= sprite.h) continue;
    for (let rx = 0; rx <= Math.ceil(box.w) + 1; rx++) {
      let sx = Math.floor((rx + 0.5 - fx - offX) / scale);
      if (sx < 0 || sx >= sprite.w) continue;
      if (flip) sx = sprite.w - 1 - sx;
      if (mask[sy * sprite.w + sx]) out.push(rx, ry);
    }
  }
  return out;
}

/**
 * The colour gate on one GIF frame. `img` = { width, height, data: RGB24 },
 * `box` = Rex's box in GIF px, `sprites` = [{ w, h, frames: [RGBA] }], the
 * candidate sprite files. Tries every sprite frame, both facings and every
 * shift within SEARCH_X/SEARCH_Y (nearest first), and returns the placement
 * whose worst opaque pixel is closest to its frame's palette:
 * { worst, n, sprite, frame, flip, dx, dy }, or null when no placement puts
 * MIN_MASK_PX opaque pixels in the image. The best placement is the honest
 * one: a shifted colour is shifted under every placement.
 */
export function rexColourError(img, box, sprites) {
  let best = null;
  const bx = Math.floor(box.x);
  const by = Math.floor(box.y);
  const dists = new Map(); // palette key -> lazily filled distance per image pixel
  const distFor = (pal, key) => {
    let d = dists.get(key);
    if (!d) {
      d = new Int16Array(img.width * img.height).fill(-1);
      dists.set(key, d);
    }
    return (x, y) => {
      const i = y * img.width + x;
      if (d[i] < 0) {
        const o = i * 3;
        d[i] = paletteDistance(img.data[o], img.data[o + 1], img.data[o + 2], pal);
      }
      return d[i];
    };
  };
  sprites.forEach((sprite, si) => {
    for (let fi = 0; fi < sprite.frames.length; fi++) {
      const { mask, pal, key } = spriteFrameInfo(sprite.frames[fi], sprite.w, sprite.h);
      const at = distFor(pal, key);
      for (const flip of [false, true]) {
        const pts = placedMask(box, sprite, mask, flip);
        if (pts.length / 2 < MIN_MASK_PX) continue;
        for (let dy = -SEARCH_Y; dy <= SEARCH_Y; dy++) {
          for (const dx of SHIFTS_X) {
            let worst = 0;
            let n = 0;
            const ox = bx + dx;
            const oy = by + dy;
            for (let i = 0; i < pts.length; i += 2) {
              const x = ox + pts[i];
              const y = oy + pts[i + 1];
              if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
              n++;
              const d = at(x, y);
              if (d > worst) {
                worst = d;
                if (best && worst >= best.worst) break;
              }
            }
            if (n >= MIN_MASK_PX && (!best || worst < best.worst)) best = { worst, n, sprite: si, frame: fi, flip, dx, dy };
          }
        }
      }
    }
  });
  return best;
}

/**
 * The gate over a whole GIF: `frameAt(k)` returns GIF frame k's RGB image,
 * `loadSprite(path)` a decoded sprite (see spritePath). Returns { judged, skipped, worst,
 * worstAt, failures } (failures: frames whose best placement is over
 * MAX_COLOUR_ERROR, or that Rex cannot be placed on).
 */
export function colourGate({ scenes, fps, totalFrames, eventsByShotId, frameAt, loadSprite }) {
  const out = { judged: 0, skipped: {}, worst: 0, worstAt: null, failures: [] };
  for (let k = 0; k < totalFrames; k++) {
    const m = gifFrameMoment(scenes, fps, k);
    const events = eventsByShotId[m.shotId];
    const tMs = loggedMsAt(events, m.demoMs);
    const rex = rexAt(events, tMs, m.scene.cropCss);
    const skip = (why) => (out.skipped[why.replace(/@.*$/, '')] = (out.skipped[why.replace(/@.*$/, '')] ?? 0) + 1);
    if (!rex) { skip('no Rex track'); continue; }
    if (rex.box.y + rex.box.h <= 0 || rex.box.y >= SIZE.height || rex.box.x + rex.box.w <= 0 || rex.box.x >= SIZE.width) { skip('Rex outside the band'); continue; }
    const captionRects = m.scene.captions.filter((c) => k >= c.fromFrame && k < c.toFrame).map((c) => ({ x: c.rect.x / 2, y: c.rect.y / 2, w: c.rect.w / 2, h: c.rect.h / 2 }));
    const why = unjudgeable({ events, tMs, box: rex.box, cropCss: m.scene.cropCss, captionRects, others: rex.others });
    if (why) { skip(why); continue; }
    const pet = (events.roster ?? []).find((p) => p.id === PET_ID);
    const r = rexColourError(frameAt(k), rex.box, candidateSprites(rex.srcs, pet).map(loadSprite));
    if (!r) { out.failures.push(`frame ${k} (${m.shotId}): Rex cannot be placed at his tracked box`); continue; }
    out.judged++;
    if (r.worst > out.worst) { out.worst = r.worst; out.worstAt = { k, shotId: m.shotId, ...r }; }
    if (r.worst > MAX_COLOUR_ERROR) out.failures.push(`frame ${k} (${m.shotId}): an opaque Rex pixel is ${r.worst} RGB units from his source frame's colours`);
  }
  if (out.judged < MIN_JUDGED_FRAMES) out.failures.push(`only ${out.judged} frames judgeable (need ${MIN_JUDGED_FRAMES})`);
  return out;
}

// ---------- I/O ----------

/** Every frame of a GIF (or any image sequence) as RGBA, with its size. */
export function decodeRgba(path) {
  const v = probe(path).streams.find((s) => s.codec_type === 'video');
  const buf = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  const n = v.width * v.height * 4;
  const frames = [];
  for (let o = 0; o + n <= buf.length; o += n) frames.push(buf.subarray(o, o + n));
  return { w: v.width, h: v.height, frames };
}

/** Every frame of the encoded GIF as RGB24 images. */
export function decodeGifRgb(path) {
  const v = probe(path).streams.find((s) => s.codec_type === 'video');
  const buf = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const n = v.width * v.height * 3;
  const frames = [];
  for (let o = 0; o + n <= buf.length; o += n) frames.push({ width: v.width, height: v.height, data: buf.subarray(o, o + n) });
  return frames;
}

/** The scene plan render.mjs --variant gif drew, re-derived from the same run (buildGifScenes is pure). */
export function planScenes(runDir) {
  const shots = readJson(join(VIDEO_DIR, 'shots.json'));
  const ids = [...new Set(shots.variants.readme_gif.scenes.map((s) => s.shot))];
  const eventsByShotId = Object.fromEntries(ids.map((id) => [id, readJson(join(shotDir(runDir, id, '16:9'), 'events.json'))]));
  const staged = Object.fromEntries(ids.map((id) => [id, `${shotDir('', id, '16:9')}/demo.mp4`]));
  return { ...buildGifScenes(shots, eventsByShotId, staged), eventsByShotId };
}

/** Throws unless render-manifest.json says the gif frames came from `runDir`. */
export function assertFramesFromRun(runDir, manifest) {
  const run = manifest?.variants?.gif?.run;
  if (run !== basename(runDir)) throw new Error(`gif: out/gif-frames were rendered from run "${run}", not ${basename(runDir)} (render-manifest.json)`);
}

/**
 * Nearest-neighbour halving that keeps every pixel a source colour. Plain
 * `flags=neighbor` scales RGB through swscale's subsampled internal chroma,
 * which blends a 1 px column at every colour edge (a black outline beside
 * tan fur came out #b08d74, 28 units off any sprite colour); the full-chroma
 * flags keep the chroma at full resolution, so the edge stays crisp.
 */
export const HALVE = 'scale=iw/2:ih/2:flags=neighbor+full_chroma_inp+full_chroma_int';

/** Every opaque colour any sprite state of each rostered pet can show, as packed RGB ints (the colours the GIF keeps exact). */
export function petSpriteColours(roster) {
  const set = new Set();
  for (const pet of roster ?? []) {
    for (const st of STATES) {
      const path = join(REPO_DIR, 'assets', pet.type, `${pet.color}_${st}_8fps.gif`);
      if (existsSync(path)) for (const frame of decodeRgba(path).frames) for (const c of framePalette(frame)) set.add(c);
    }
  }
  return [...set];
}

/**
 * A 256-entry palette: every `reserved` colour, then the `generated` ones
 * (palettegen's, which repeats its last colour to fill 16x16) until full,
 * padded by repeating a real colour.
 */
export function mergePalette(generated, reserved) {
  if (reserved.length > 256) throw new Error(`gif: ${reserved.length} reserved colours do not fit a 256-colour palette`);
  const pal = [...new Set([...reserved, ...generated])].slice(0, 256);
  while (pal.length < 256) pal.push(pal[pal.length - 1] ?? 0);
  return pal;
}

/**
 * Encodes the halved frames with one palette per scene. A single palette over
 * a light and a dark page scene starves one of them: on a real run the dark
 * code-review scene's colours went 10-80 units off. `palettes` =
 * [{ fromFrame, frames, reserve }]: each scene's frame range and the packed
 * colours its palette must hold exactly (its pets' sprite colours).
 */
export function encodeGif(framesDir, outPath, fps, palettes) {
  const tmp = mkdtempSync(join(tmpdir(), 'gif-pal-'));
  try {
    const input = ['-framerate', String(fps), '-i', join(framesDir, 'frame-%04d.png')];
    const palPaths = palettes.map((p, i) => {
      const gen = join(tmp, `gen-${i}.png`);
      ffmpeg([
        '-y', '-v', 'error', '-framerate', String(fps), '-start_number', String(p.fromFrame), '-i', join(framesDir, 'frame-%04d.png'),
        // trim bounds palettegen's INPUT to this scene; `-frames:v` after `-i` limits only output, and palettegen still read every later scene's frames
        '-vf', `trim=end_frame=${p.frames},${HALVE},palettegen=max_colors=${256 - p.reserve.length}:reserve_transparent=0:stats_mode=diff`,
        '-update', '1', gen,
      ]);
      const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', gen, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
      const generated = [];
      for (let o = 0; o + 3 <= raw.length; o += 3) generated.push((raw[o] << 16) | (raw[o + 1] << 8) | raw[o + 2]);
      const merged = mergePalette(generated, p.reserve);
      const out = join(tmp, `pal-${i}.png`);
      const buf = Buffer.alloc(256 * 3);
      merged.forEach((c, j) => buf.set([c >> 16, (c >> 8) & 255, c & 255], j * 3));
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '16x16', '-i', '-', '-frames:v', '1', '-update', '1', out], { input: buf });
      return out;
    });
    const n = palettes.length;
    const graph = [
      `[0:v]${HALVE},split=${n}${palettes.map((_, i) => `[s${i}]`).join('')}`,
      ...palettes.map((p, i) => `[s${i}]trim=start_frame=${p.fromFrame}:end_frame=${p.fromFrame + p.frames},setpts=PTS-STARTPTS[t${i}];[t${i}][${i + 1}:v]paletteuse=dither=none[u${i}]`),
      `${palettes.map((_, i) => `[u${i}]`).join('')}concat=n=${n}:v=1:a=0[out]`,
    ].join(';');
    ffmpeg(['-y', '-v', 'error', ...input, ...palPaths.flatMap((pp) => ['-i', pp]), '-filter_complex', graph, '-map', '[out]', '-loop', '0', outPath]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The encoded GIF's size, length and byte count against `spec` (from its ffprobe result): failure strings. */
export function checkGif(bytes, p, spec = GIF_SPEC) {
  const v = p?.streams?.find((s) => s.codec_type === 'video');
  const d = Number(p?.format?.duration);
  const bad = [];
  if (!(bytes < spec.maxBytes)) bad.push(`${bytes} bytes, want under ${spec.maxBytes}`);
  if (v?.width !== spec.size.width || v?.height !== spec.size.height) bad.push(`${v?.width}x${v?.height}, want ${spec.size.width}x${spec.size.height}`);
  if (!(d >= spec.seconds[0] && d <= spec.seconds[1])) bad.push(`${Number.isFinite(d) ? d.toFixed(2) : '?'} s, want ${spec.seconds.join('-')} s`);
  return bad;
}

/**
 * Encodes and gates the GIF; returns a report; throws listing every failure.
 * `plan` (planScenes' result) and `spec` default to this run's scene plan and
 * GIF_SPEC; tests pass small ones.
 */
export function makeGif({ runDir, framesDir = FRAMES_DIR, outPath = GIF_PATH, manifest, plan, spec = GIF_SPEC }) {
  if (manifest !== null) assertFramesFromRun(runDir, manifest ?? readJson(join(OUT_DIR, 'render-manifest.json')));
  const { scenes, fps, totalFrames, eventsByShotId } = plan ?? planScenes(runDir);
  const pngs = existsSync(framesDir) ? readdirSync(framesDir).filter((f) => /^frame-\d{4}\.png$/.test(f)) : [];
  if (pngs.length !== totalFrames) throw new Error(`gif: ${framesDir} holds ${pngs.length} frames; the scene plan has ${totalFrames}`);
  const first = probe(join(framesDir, 'frame-0000.png')).streams[0];
  const source = { width: spec.size.width * 2, height: spec.size.height * 2 }; // render.mjs --variant gif draws at 2x; the GIF halves it
  if (first.width !== source.width || first.height !== source.height) throw new Error(`gif: frames are ${first.width}x${first.height}, not ${source.width}x${source.height}`);
  encodeGif(framesDir, outPath, fps, scenes.map((sc) => ({ fromFrame: sc.fromFrame, frames: sc.frames, reserve: petSpriteColours(eventsByShotId[sc.shotId]?.roster) })));

  const p = probe(outPath);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const bytes = statSync(outPath).size;
  const seconds = Number(p.format.duration);
  const failures = checkGif(bytes, p, spec);

  const gifFrames = decodeGifRgb(outPath);
  if (gifFrames.length !== totalFrames) failures.push(`the GIF decodes to ${gifFrames.length} frames, not ${totalFrames}`);
  const sprites = new Map();
  const loadSprite = (path) => {
    if (!sprites.has(path)) sprites.set(path, decodeRgba(path));
    return sprites.get(path);
  };
  const gate = colourGate({ scenes, fps, totalFrames: Math.min(totalFrames, gifFrames.length), eventsByShotId, frameAt: (k) => gifFrames[k], loadSprite });
  const report = { path: outPath, bytes, seconds, width: v.width, height: v.height, frames: gifFrames.length, specFailures: failures, gate };
  const all = [...failures, ...gate.failures];
  if (all.length) {
    const err = new Error(`gif: ${all.slice(0, 8).join('; ')}${all.length > 8 ? `; and ${all.length - 8} more` : ''}`);
    err.report = report;
    throw err;
  }
  return report;
}

export function describeReport(r) {
  const g = r.gate;
  const skipped = Object.entries(g.skipped).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  const at = g.worstAt ? ` at frame ${g.worstAt.k} (${g.worstAt.shotId}, sprite frame ${g.worstAt.frame}${g.worstAt.flip ? ' flipped' : ''}, shift ${g.worstAt.dx},${g.worstAt.dy}, ${g.worstAt.n} px)` : '';
  return `gif: ${relative(VIDEO_DIR, r.path)} ${r.width}x${r.height} ${r.seconds.toFixed(2)} s ${r.frames} frames ${(r.bytes / 1e6).toFixed(2)} MB; colour gate: ${g.judged} frames judged, worst Rex error ${g.worst} RGB units${at} (limit ${MAX_COLOUR_ERROR}); skipped: ${skipped}`;
}

if (isMain(import.meta.url)) {
  try {
    console.log(describeReport(makeGif({ runDir: runArg(process.argv.slice(2)) })));
  } catch (err) {
    if (err.report) console.error(describeReport(err.report));
    console.error(err.message);
    process.exit(1);
  }
}

#!/usr/bin/env node
// Stage 5: the YouTube thumbnail and the X poster frame (pets-o3p.5 step 4).
// render.mjs --variant still --at src:rex:swipe+600 --no-captions wrote the
// 1920x1080 master frame out/still.png and out/still.json (its pets' boxes in
// output px). This cuts a 1:1 (unscaled) 1280x720 crop around Rex and draws
// the store icon (integer scale, nearest-neighbour) and "Pixel Pets" in
// Press Start 2P onto it, at least 80 px from his box -> out/thumbnail.png.
// out/x-poster.png is the same frame, uncropped.
//
// Usage: npx tsx scripts/thumbnail.mjs

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, isMain, OUT_DIR, probe, readJson, REPO_DIR, VIDEO_DIR } from './stage-io.mjs';

export const THUMB = { w: 1280, h: 720 };
export const MIN_GAP = 80; // px between the brand block and Rex's box
export const MARGIN = 48; // px from the thumbnail's edges
export const ICON_PX = 128; // assets/icons/icon-128.png, drawn at ICON_SCALE
export const ICON_SCALE = 1;
export const FONT_PX = 48; // Press Start 2P: every glyph is one em wide
export const TITLE = 'Pixel Pets';
export const TEXT_PAD = 16; // the cream box around the title
export const GAP = 24; // icon to title

/** The 1:1 crop of a W x H frame, `crop` big, centred on `box` and kept inside the frame (integer px). */
export function cropAround(box, W, H, crop = THUMB) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.round(Math.min(W - crop.w, Math.max(0, cx - crop.w / 2)));
  const y = Math.round(Math.min(H - crop.h, Math.max(0, cy - crop.h / 2)));
  return { x, y, w: crop.w, h: crop.h };
}

/** The gap between two rects (0 when they touch or overlap). */
export function rectGap(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** The brand block's size: the icon, then the title in its padded box. */
export function brandSize() {
  const textW = TITLE.length * FONT_PX + 2 * TEXT_PAD;
  const textH = FONT_PX + 2 * TEXT_PAD;
  return { w: ICON_PX * ICON_SCALE + GAP + textW, h: Math.max(ICON_PX * ICON_SCALE, textH), textW, textH };
}

/**
 * Where the brand block goes: the first corner (top-left, top-right,
 * bottom-left, bottom-right) at MARGIN from the edges whose block clears
 * every pet box by MIN_GAP. Throws when no corner does.
 */
export function placeBrand(petBoxes, size = brandSize(), canvas = THUMB) {
  const corners = [
    { x: MARGIN, y: MARGIN },
    { x: canvas.w - MARGIN - size.w, y: MARGIN },
    { x: MARGIN, y: canvas.h - MARGIN - size.h },
    { x: canvas.w - MARGIN - size.w, y: canvas.h - MARGIN - size.h },
  ];
  for (const c of corners) {
    const block = { ...c, w: size.w, h: size.h };
    if (petBoxes.every((b) => rectGap(block, b) >= MIN_GAP)) return block;
  }
  throw new Error(`thumbnail: no corner keeps the brand block ${MIN_GAP} px from the pets`);
}

export function main() {
  const still = join(OUT_DIR, 'still.png');
  const meta = readJson(join(OUT_DIR, 'still.json'));
  const v = probe(still).streams[0];
  if (v.width !== 1920 || v.height !== 1080) throw new Error(`thumbnail: out/still.png is ${v.width}x${v.height}, not 1920x1080`);
  const rex = meta.pets.find((p) => p.id === 'rex');
  if (!rex) throw new Error(`thumbnail: Rex is not on the still's frame ${meta.frame} (out/still.json)`);
  const crop = cropAround(rex.box, v.width, v.height);
  const inCrop = (b) => ({ x: b.x - crop.x, y: b.y - crop.y, w: b.w, h: b.h });
  const size = brandSize();
  const block = placeBrand(meta.pets.map((p) => inCrop(p.box)), size);
  const iconY = block.y + (size.h - ICON_PX * ICON_SCALE) / 2;
  const textX = block.x + ICON_PX * ICON_SCALE + GAP + TEXT_PAD;
  const textY = block.y + (size.h - size.textH) / 2 + TEXT_PAD;
  const font = join(VIDEO_DIR, 'assets', 'fonts', 'PressStart2P-Regular.ttf');
  ffmpeg([
    '-y', '-v', 'error', '-i', still, '-i', join(REPO_DIR, 'assets', 'icons', 'icon-128.png'),
    '-filter_complex',
    `[0:v]crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}[bg];[1:v]scale=iw*${ICON_SCALE}:ih*${ICON_SCALE}:flags=neighbor[ic];[bg][ic]overlay=${block.x}:${iconY},` +
      `drawtext=fontfile='${font}':text='${TITLE}':fontsize=${FONT_PX}:fontcolor=0x3B2F2A:box=1:boxcolor=0xFFE3B0:boxborderw=${TEXT_PAD}:x=${textX}:y=${textY}`,
    '-frames:v', '1', join(OUT_DIR, 'thumbnail.png'),
  ]);
  copyFileSync(still, join(OUT_DIR, 'x-poster.png'));
  const rexIn = inCrop(rex.box);
  console.log(`thumbnail: out/thumbnail.png 1280x720 = still crop at (${crop.x}, ${crop.y}); Rex at (${Math.round(rexIn.x)}, ${Math.round(rexIn.y)}) ${Math.round(rexIn.w)}x${Math.round(rexIn.h)}; brand block at (${block.x}, ${block.y}) ${size.w}x${size.h}, ${Math.round(rectGap(block, rexIn))} px from Rex; out/x-poster.png = master frame ${meta.frame}`);
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

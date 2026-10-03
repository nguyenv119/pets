#!/usr/bin/env node
// Stage 7: a contact sheet of the 16:9 master for the human taste check (not
// a gate): one frame per second, 480 px wide, six to a row, each stamped
// with its time -> out/contact-sheet.png.
//
// Usage: npx tsx scripts/contact-sheet.mjs

import { join } from 'node:path';
import { ffmpeg, isMain, OUT_DIR, probe } from './stage-io.mjs';

export const COLS = 6;
export const TILE_W = 480;

/** Columns and rows for one tile per whole second of a `seconds`-long clip. */
export function grid(seconds) {
  const n = Math.max(1, Math.ceil(seconds));
  return { cols: COLS, rows: Math.ceil(n / COLS), n };
}

export function main() {
  const master = join(OUT_DIR, 'pixel-pets-16x9.mp4');
  const { cols, rows, n } = grid(Number(probe(master).format.duration));
  ffmpeg([
    '-y', '-v', 'error', '-i', master,
    '-vf', `fps=1,scale=${TILE_W}:-2,drawtext=text='%{eif\\:t\\:d} s':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,tile=${cols}x${rows}:padding=4:color=0x222222`,
    '-frames:v', '1', join(OUT_DIR, 'contact-sheet.png'),
  ]);
  console.log(`contact-sheet: out/contact-sheet.png, ${n} tiles (${cols}x${rows})`);
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

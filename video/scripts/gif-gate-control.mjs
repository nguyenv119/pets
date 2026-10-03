#!/usr/bin/env node
// The GIF colour gate's PASS and FAIL controls (pets-o3p.5 step 3), run
// through Remotion, the path the real GIF takes, not ffmpeg decoding alone.
//
// The proof capture's 1,062 lossless RGB frames are re-timed with
// fixtures/raw.sample.json frames[].ts and trimmed to demo.sample.mp4's
// length (the clip the synthetic run's page-shot events are synced to), then
// encoded twice:
//   tagged    the recorder's BT.709 recipe (record/assemble.mjs)   -> the gate must PASS
//   untagged  libx264 -qp 0 -pix_fmt yuv444p, no colour tags        -> the gate must FAIL
// Each encode replaces every 16:9 page shot's demo.mp4 in a copy of the
// synthetic run (.cache/gif-control/<variant>/), is rendered with
// `render.mjs --run <copy> --variant gif`, and is gated by gif.mjs into
// .cache/gif-control/<variant>.gif.
//
// render.mjs writes into out/: this overwrites out/gif-frames/ and the gif
// entry of out/render-manifest.json. Run it before a pipeline run, never
// between the pipeline's render and gif stages.
//
// Usage: npx tsx scripts/gif-gate-control.mjs --proof <frames-lossless-rgb.mkv>
//        (needs .cache/synthetic-run: node scripts/make-synthetic-run.mjs)

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConcatList, BT709_TAGS, BT709_VF, LOSSLESS_H264 } from '../record/assemble.mjs';
import { describeReport, makeGif, MAX_COLOUR_ERROR } from './gif.mjs';
import { buildPageTrackFrames } from './synthetic/page-events.mjs';
import { ffmpeg, isMain, probe, readJson, VIDEO_DIR } from './stage-io.mjs';

const CACHE = join(VIDEO_DIR, '.cache', 'gif-control');
const SYNTHETIC = join(VIDEO_DIR, '.cache', 'synthetic-run');
const PAGE_SHOTS = ['s1_inbox', 's2_review', 's3_sheet', 's4_article_night'];

/** The two encodes: identical frames and timing, only the colour handling differs. */
export const ENCODES = {
  tagged: ['-vf', `${BT709_VF},fps=25`, ...LOSSLESS_H264, ...BT709_TAGS],
  untagged: ['-vf', 'fps=25', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p'],
};

/**
 * The control's verdict, on the colour gate alone (the synthetic run's GIF
 * scenes are not the real GIF's length, so the size and length checks are
 * not what this control measures): tagged must pass the gate, untagged must
 * fail it on colour. Returns the problems; empty means the gate separates them.
 */
export function controlVerdict(results) {
  const bad = [];
  const gate = (v) => results[v].report?.gate;
  if (!gate('tagged')) bad.push(`tagged (PASS control) never reached the gate: ${results.tagged.error}`);
  else if (gate('tagged').failures.length) bad.push(`tagged (PASS control) failed the gate: ${gate('tagged').failures.slice(0, 3).join('; ')}`);
  if (!gate('untagged')) bad.push(`untagged (FAIL control) never reached the gate: ${results.untagged.error}`);
  else if (!gate('untagged').failures.some((f) => /RGB units from his source frame/.test(f))) bad.push(`untagged (FAIL control) passed the gate with worst error ${gate('untagged').worst}`);
  return bad;
}

/**
 * The synthetic s1_inbox seeds Rex alone, but the proof footage it stands on
 * also shows Bao walking past (and in front of) him. Track Bao too, so the
 * gate sees what this footage really shows; nothing else in the events changes.
 */
function trackEveryFilmedPet(eventsPath) {
  const events = readJson(eventsPath);
  events.tracks = buildPageTrackFrames({ observed: events.observed, petIds: ['rex', 'bao'], durationMs: events.durationMs, stepMs: 40 });
  writeFileSync(eventsPath, JSON.stringify(events, null, 1));
}

function encode(proofMkv, variant, frameCount) {
  const framesDir = join(CACHE, 'proof-frames');
  if (!existsSync(join(framesDir, 'f00000.png'))) {
    mkdirSync(framesDir, { recursive: true });
    ffmpeg(['-v', 'error', '-y', '-i', proofMkv, '-start_number', '0', join(framesDir, 'f%05d.png')]);
  }
  const raw = readJson(join(VIDEO_DIR, 'fixtures', 'raw.sample.json'));
  const n = readdirSync(framesDir).filter((f) => f.endsWith('.png')).length;
  if (n !== raw.frames.length) throw new Error(`gif-gate-control: ${n} proof frames, raw.sample.json lists ${raw.frames.length}`);
  const list = join(CACHE, 'concat.txt');
  writeFileSync(list, buildConcatList(raw.frames.map((f, i) => ({ file: join(framesDir, `f${String(i).padStart(5, '0')}.png`), ts: f.ts }))));
  const out = join(CACHE, `${variant}.mp4`);
  // tpad holds the last frame so the clip reaches demo.sample.mp4's length; -frames:v trims to it exactly
  const [vfFlag, vf, ...rest] = ENCODES[variant];
  ffmpeg(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, vfFlag, `tpad=stop_mode=clone:stop_duration=2,${vf}`, ...rest, '-frames:v', String(frameCount), out]);
  return out;
}

function runControl(proofMkv, variant) {
  const sample = probe(join(VIDEO_DIR, 'fixtures', 'demo.sample.mp4'));
  const frameCount = Math.round(Number(sample.format.duration) * 25);
  const mp4 = encode(proofMkv, variant, frameCount);
  const runDir = join(CACHE, variant);
  rmSync(runDir, { recursive: true, force: true });
  cpSync(SYNTHETIC, runDir, { recursive: true });
  for (const id of PAGE_SHOTS) cpSync(mp4, join(runDir, id, 'demo.mp4'));
  trackEveryFilmedPet(join(runDir, 's1_inbox', 'events.json'));
  const r = spawnSync('npx', ['tsx', 'scripts/render.mjs', '--run', runDir, '--variant', 'gif'], { cwd: VIDEO_DIR, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`gif-gate-control: render.mjs --variant gif failed for ${variant}`);
  try {
    const report = makeGif({ runDir, outPath: join(CACHE, `${variant}.gif`) });
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: err.message, report: err.report };
  }
}

function main(argv) {
  const i = argv.indexOf('--proof');
  if (i < 0 || !argv[i + 1]) throw new Error('pass --proof <frames-lossless-rgb.mkv>');
  if (!existsSync(SYNTHETIC)) throw new Error(`${SYNTHETIC} is missing; run node scripts/make-synthetic-run.mjs first`);
  mkdirSync(CACHE, { recursive: true });
  const results = {};
  for (const variant of ['tagged', 'untagged']) {
    results[variant] = runControl(argv[i + 1], variant);
    const r = results[variant];
    const g = r.report?.gate;
    console.log(`\n[${variant}] colour gate ${!g ? 'not reached' : g.failures.length ? 'FAILED' : 'PASSED'} (limit ${MAX_COLOUR_ERROR} RGB units)`);
    if (r.report) console.log(`[${variant}] ${describeReport(r.report)}`);
    if (!r.ok) console.log(`[${variant}] ${r.error}`);
  }
  const bad = controlVerdict(results);
  if (bad.length) throw new Error(`gif-gate-control: ${bad.join('; ')}`);
  console.log('\ngif-gate-control: PASS control passed and FAIL control failed: the gate separates them');
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

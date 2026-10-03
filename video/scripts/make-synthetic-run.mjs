#!/usr/bin/env node
// make-synthetic-run.mjs: pets-o3p.4 step 6. Builds the synthetic
// five-shot run so every beat, overlay and composition can render before
// a real recording exists: four page-shot stand-ins from the committed
// fixture (fixtures/demo.sample.mp4 + fixtures/events.sample.json) plus a
// real s2b_shelter popup take driven through the built extension
// (video/lib/browser.mjs). Writes into the gitignored
// video/.cache/synthetic-run/ — never committed. Every events.json is
// `shim: "fixture"`, so this run can never pass the epic eval.
//
// It never writes real storage beyond the seed: the popup take never
// releases the Add Pet press (see scripts/synthetic/popup-take.mjs).
//
// Usage: node scripts/make-synthetic-run.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../lib/browser.mjs';
import { assembleFrames, probeVideo } from '../record/assemble.mjs';
import { buildStandin } from './synthetic/assemble.mjs';
import {
  buildPageTrackFrames,
  buildS1InboxObserved,
  buildS3SheetObserved,
  buildS4ArticleNightObserved,
  shiftStandinEvents,
} from './synthetic/page-events.mjs';
import { buildPopupEvents } from './synthetic/popup-events.mjs';
import { capturePopupTake } from './synthetic/popup-take.mjs';
import { isMain } from './stage-io.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = join(__dirname, '..');
const FIXTURES_DIR = join(VIDEO_DIR, 'fixtures');
const OUT_DIR = join(VIDEO_DIR, '.cache', 'synthetic-run');

// The four page shots, in edit order (shots.json's edit_order minus the
// popup take s2b_shelter, which gets its own real capture below).
const PAGE_SHOT_IDS = ['s1_inbox', 's2_review', 's3_sheet', 's4_article_night'];

// Page-shot stand-in geometry. The fixture is a v1 960x540 take (1920x1080
// device px, pets at CSS y 476-540); the v2 captures are shorter, so each
// stand-in is a real crop (+ pad) of it, and its events move by the matching
// CSS shift (device px / 2, the fixture's DPR is 2) so Rex stands at
// innerHeight - 64 again. Exported for the test that pins them to shots.json.
// 16:9: the bottom 1920x872 (CSS y 104-540) -> the 960x436 viewport.
export const LAND = { crop: { x: 0, y: 208, w: 1920, h: 872 }, pad: { w: 1920, h: 872, y: 0, color: '0xfaf6ef' }, shift: { dx: 0, dy: -104 }, viewport: { width: 960, height: 436 } };
// 9:16: device x 840-1920, full height, padded with 632 device px of the page
// colour on top -> the 540x856 narrow viewport (1080x1712).
export const V916 = { crop: { x: 840, y: 0, w: 1080, h: 1080 }, pad: { w: 1080, h: 1712, y: 632, color: '0xfaf6ef' }, shift: { dx: -420, dy: 316 }, viewport: { width: 540, height: 856 } };

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function findShot(shotsDoc, id) {
  const shot = shotsDoc.shots.find((s) => s.id === id);
  if (!shot) throw new Error(`make-synthetic-run: shots.json has no shot "${id}"`);
  return shot;
}

/** Builds one page shot's synthetic events.json from the fixture template, applying the shot's own missing-anchor synthesis. */
function buildPageEvents(shotId, shot, template) {
  const petsReadyT = template.observed.find((e) => e.kind === 'pets_ready')?.t ?? 1020;

  let observed;
  if (shotId === 's1_inbox') observed = buildS1InboxObserved(template.observed);
  else if (shotId === 's3_sheet') observed = buildS3SheetObserved(template.observed, petsReadyT);
  else if (shotId === 's4_article_night') observed = buildS4ArticleNightObserved(template.observed, petsReadyT);
  else observed = template.observed; // s2_review: every anchor it needs (first_paint, mouse:dblclick, ball_on, catch) is already in the template.

  // Only pets that are BOTH in this shot's own seeded roster AND actually
  // logged a src/x in the template fixture get a track: s1_inbox seeds
  // Rex alone (no Bao), and the fixture never logs Pip at all (s3/s4's
  // third pet), so a track for either would invent a position the bead's
  // rule forbids.
  const trackedIds = ['rex', 'bao'];
  const petIds = shot.seed.roster.map((r) => r.id).filter((id) => trackedIds.includes(id));
  // Built in the fixture's own (v1, 960x540) coordinates: buildPageShots then
  // moves them onto each v2 viewport with shiftStandinEvents.
  const tracks = buildPageTrackFrames({ observed, petIds, durationMs: template.durationMs, innerHeight: template.viewport.height, stepMs: 40 });

  return {
    ...template,
    name: shotId,
    roster: shot.seed.roster,
    observed,
    tracks,
  };
}

function writeEvents(dir, events) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.json'), JSON.stringify(events, null, 1));
}

async function buildPageShots(shotsDoc) {
  const template = loadJson(join(FIXTURES_DIR, 'events.sample.json'));
  const fixtureMp4 = join(FIXTURES_DIR, 'demo.sample.mp4');
  const written = [];

  for (const shotId of PAGE_SHOT_IDS) {
    const shot = findShot(shotsDoc, shotId);
    const events = buildPageEvents(shotId, shot, template);

    for (const [g, dir] of [[LAND, join(OUT_DIR, shotId)], [V916, join(OUT_DIR, 'v916', shotId)]]) {
      mkdirSync(dir, { recursive: true });
      const demoPath = join(dir, 'demo.mp4');
      buildStandin({ srcPath: fixtureMp4, outPath: demoPath, crop: g.crop, padW: g.pad.w, padH: g.pad.h, padY: g.pad.y, padColor: g.pad.color });
      writeEvents(dir, { ...shiftStandinEvents(events, g.shift), viewport: g.viewport });
      written.push({ label: g === LAND ? shotId : `v916/${shotId}`, path: demoPath });
    }
  }

  return written;
}

async function buildPopupShot(shotsDoc) {
  const shot = findShot(shotsDoc, 's2b_shelter');
  const expectedTypeCells = shot.layout_expect.type_order.length;

  console.log('make-synthetic-run: building the extension (buildExtension)...');
  const ext = await buildExtension();

  console.log('make-synthetic-run: driving the real popup (s2b_shelter)...');
  const captureStart = Date.now();
  const capture = await capturePopupTake({ shot, ext, expectedTypeCells });
  const durationMs = Date.now() - captureStart;

  const shotDir = join(OUT_DIR, 's2b_shelter');
  mkdirSync(shotDir, { recursive: true });
  const demoPath = join(shotDir, 'demo.mp4');
  const workDir = mkdtempSync(join(tmpdir(), 'pixel-pets-synthetic-assemble-'));
  try {
    assembleFrames({ frames: capture.frames, outPath: demoPath, fps: 25, workDir });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const events = buildPopupEvents({ capture, roster: shot.seed.roster, viewport: { width: shot.viewport.width, height: shot.viewport.height }, durationMs });
  writeEvents(shotDir, events);

  return { label: 's2b_shelter', path: demoPath };
}

async function main() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const shotsDoc = loadJson(join(VIDEO_DIR, 'shots.json'));

  const pageWritten = await buildPageShots(shotsDoc);
  const popupWritten = await buildPopupShot(shotsDoc);
  const written = [...pageWritten, popupWritten];

  console.log(`\nmake-synthetic-run: wrote ${written.length} videos under ${OUT_DIR}\n`);
  for (const { label, path } of written) {
    const probe = probeVideo(path);
    console.log(`${label.padEnd(16)} ${path}  ${probe.width}x${probe.height} ${probe.r_frame_rate}fps color_space=${probe.color_space ?? 'n/a'}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

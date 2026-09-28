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

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../lib/browser.mjs';
import { assembleFrames, buildPortraitStandin, probeVideo } from './synthetic/assemble.mjs';
import {
  buildPageTrackFrames,
  buildS1InboxObserved,
  buildS3SheetObserved,
  buildS4ArticleNightObserved,
  shiftPortraitEvents,
} from './synthetic/page-events.mjs';
import { buildPopupEvents } from './synthetic/popup-events.mjs';
import { capturePopupTake } from './synthetic/popup-take.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = join(__dirname, '..');
const FIXTURES_DIR = join(VIDEO_DIR, 'fixtures');
const OUT_DIR = join(VIDEO_DIR, '.cache', 'synthetic-run');

// The four page shots, in edit order (shots.json's edit_order minus the
// popup take s2b_shelter, which gets its own real capture below).
const PAGE_SHOT_IDS = ['s1_inbox', 's2_review', 's3_sheet', 's4_article_night'];

// v916 (9:16) page-shot stand-in geometry (bead step 6): crop the fixture
// to device x 840-1920 (full height), pad 380 device px of the page
// colour #faf6ef on top. dx/dy are the matching CSS-px shift for events
// (device px / 2, since the fixture's DPR is 2).
const V916_CROP = { x: 840, y: 0, w: 1080, h: 1080 };
const V916_PAD = { w: 1080, h: 1460, y: 380, color: '0xfaf6ef' };
const V916_SHIFT = { dx: -420, dy: 190 };

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
  const tracks = buildPageTrackFrames({ observed, petIds, durationMs: template.durationMs, stepMs: 40 });

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

    const shotDir = join(OUT_DIR, shotId);
    mkdirSync(shotDir, { recursive: true });
    const demoPath = join(shotDir, 'demo.mp4');
    cpSync(fixtureMp4, demoPath);
    writeEvents(shotDir, events);
    written.push({ label: shotId, path: demoPath });

    // v916 stand-in: real crop+pad of the same fixture (bead step 6), not a reused 16:9 copy.
    const v916Dir = join(OUT_DIR, 'v916', shotId);
    mkdirSync(v916Dir, { recursive: true });
    const v916Path = join(v916Dir, 'demo.mp4');
    buildPortraitStandin({
      srcPath: fixtureMp4,
      outPath: v916Path,
      crop: V916_CROP,
      padW: V916_PAD.w,
      padH: V916_PAD.h,
      padY: V916_PAD.y,
      padColor: V916_PAD.color,
    });
    writeEvents(v916Dir, shiftPortraitEvents(events, V916_SHIFT));
    written.push({ label: `v916/${shotId}`, path: v916Path });
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

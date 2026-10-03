#!/usr/bin/env node
// Stage 8: the pipeline's own guard (pets-o3p.5 step 7). The epic eval
// (verify.mjs) checks independently; this catches a bad run before anyone
// looks at it. Non-zero exit listing every failure.
//
//   cuts       16:9 1920x1080 h264 + aac, 28.3-31.0 s; 9:16 1080x1920, 28.3-31.5 s
//   loudness   both cuts -18..-14 LUFS integrated
//   GIF        out/pixel-pets.gif under 5 MB, 960x360, 7-10.5 s
//   provenance out/render-manifest.json names this run for 16x9, 9x16, gif and
//              still, with each source's sha256 = this run's demo.mp4; and the
//              GIF's first treat frame (out/gif-frames/ at the inbox scene's
//              heart_on) matches THIS run's s1_inbox recording at the same
//              moment over Rex's tracked box, SSIM >= 0.8
//   recorder   wave, chase_start, catch, eat, greet and sleep observed across
//              the 16:9 shots and, separately, the 9:16 shots; the popup take
//              logs type_selected (chicken), color_selected (white) and
//              roster_saved with Rex, Bao and Pip; no uncast species in any roster
//
// Usage: npx tsx scripts/qa.mjs --run build/<run>

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { POPUP_SHOT_ID, shotDir } from '../record/layout.mjs';
import { demoMsShowing, loggedMsAt } from '../src/remotion/cameraPath.ts';
import { checkGif, FRAMES_DIR, GIF_PATH, gifFrameAt, planScenes, rexAt } from './gif.mjs';
import { measureLufs } from './loudness.mjs';
import { CUT_FILES, isMain, OUT_DIR, probe, readJson, runArg, VIDEO_DIR } from './stage-io.mjs';

export const CUTS = {
  '16x9': { file: CUT_FILES['16x9'], width: 1920, height: 1080, seconds: [28.3, 31.0] },
  '9x16': { file: CUT_FILES['9x16'], width: 1080, height: 1920, seconds: [28.3, 31.5] },
};
export const LUFS = [-18, -14];
/**
 * The GIF's treat frame against this run's recording, over Rex's tracked box
 * at that moment. Measured on the dry run (qa.test.mjs "provenance
 * controls"): this run 0.952; the synthetic run's and the fixture's footage
 * (the same file) 0.450; this run 80 ms early 0.455. Over the whole GIF band
 * the same footage scored 0.994 and 0.977, so a band-wide 0.8 passed
 * anything filmed on the inbox page.
 */
export const PROVENANCE_SSIM_MIN = 0.8;
/** A region smaller than this (CSS px, either side) is too small for SSIM to mean anything. */
export const MIN_REGION_PX = 16;
export const REQUIRED_KINDS = ['wave', 'chase_start', 'catch', 'eat', 'greet', 'sleep'];
/**
 * A copy of NEVER_CAST_TYPES in src/species.node.ts (frozen, and only
 * reachable through the async loadSpeciesAllowlist); qa.test.mjs fails if the
 * two ever differ.
 */
export const FORBIDDEN = ['totoro', 'miffy', 'fox', 'cockatiel', 'monkey', 'horse'];
export const VARIANTS = ['16x9', '9x16', 'gif', 'still'];

/** A cut's ffprobe result against its spec: failure strings. */
export function checkCut(tag, p, spec) {
  const v = p?.streams?.find((s) => s.codec_type === 'video');
  const a = p?.streams?.find((s) => s.codec_type === 'audio');
  const d = Number(p?.format?.duration);
  const bad = [];
  if (!v || v.width !== spec.width || v.height !== spec.height || v.codec_name !== 'h264') bad.push(`${tag}: video ${v ? `${v.codec_name} ${v.width}x${v.height}` : 'missing'}, want h264 ${spec.width}x${spec.height}`);
  if (a?.codec_name !== 'aac') bad.push(`${tag}: audio ${a?.codec_name ?? 'missing'}, want aac`);
  if (!(d >= spec.seconds[0] && d <= spec.seconds[1])) bad.push(`${tag}: ${Number.isFinite(d) ? d.toFixed(2) : '?'} s, want ${spec.seconds.join('-')} s`);
  return bad;
}

export function checkLufs(tag, lufs) {
  return lufs >= LUFS[0] && lufs <= LUFS[1] ? [] : [`${tag}: ${lufs} LUFS integrated, want ${LUFS.join('..')}`];
}

/**
 * render-manifest.json against this run: every variant names `runId`, and
 * every source hash equals the run's own demo.mp4 (`hashOf(variant, shotId)`
 * returns that file's sha256, or null when it is missing).
 */
export function checkManifest(manifest, runId, hashOf) {
  const bad = [];
  for (const v of VARIANTS) {
    const e = manifest?.variants?.[v];
    if (!e) { bad.push(`render-manifest: no ${v} entry`); continue; }
    if (e.run !== runId) { bad.push(`render-manifest: ${v} was rendered from run ${e.run}, not ${runId}`); continue; }
    const srcs = Object.entries(e.sources ?? {});
    if (!srcs.length) bad.push(`render-manifest: ${v} lists no sources`);
    for (const [id, h] of srcs) if (hashOf(v, id) !== h) bad.push(`render-manifest: ${v} source ${id} is not this run's recording`);
  }
  return bad;
}

/** The observed kinds REQUIRED_KINDS needs, missing across one aspect ratio's shots. */
export function missingKinds(eventsList) {
  const kinds = new Set(eventsList.flatMap((e) => (e?.observed ?? []).map((o) => o.kind)));
  return REQUIRED_KINDS.filter((k) => !kinds.has(k));
}

/** The popup take's adoption: failure strings. */
export function checkAdoption(e) {
  const bad = [];
  const first = (k) => (e?.observed ?? []).find((o) => o.kind === k);
  if (first('type_selected')?.type !== 'chicken') bad.push(`popup: type_selected ${first('type_selected')?.type ?? 'missing'}, want chicken`);
  if (first('color_selected')?.color !== 'white') bad.push(`popup: color_selected ${first('color_selected')?.color ?? 'missing'}, want white`);
  const names = (first('roster_saved')?.roster ?? []).map((r) => r.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(['Bao', 'Pip', 'Rex'])) bad.push(`popup: roster_saved holds ${names.join(', ') || 'nothing'}, want Rex, Bao and Pip`);
  return bad;
}

export function forbiddenInRosters(eventsList) {
  const rosters = eventsList.flatMap((e) => [e?.roster ?? [], (e?.observed ?? []).find((o) => o.kind === 'roster_saved')?.roster ?? []]).flat();
  return [...new Set(rosters.map((r) => r.type).filter((t) => FORBIDDEN.includes(t)))];
}

/**
 * The GIF frame and the recording moment of the inbox scene's first
 * heart_on (the treat): { k, demoMs }, or null when the scene shows none.
 * The screen shows a logged event videoLagMs after the log.
 */
export function treatMoment(scenes, fps, events, shotId = 's1_inbox') {
  for (const o of events?.observed ?? []) {
    if (o.kind !== 'heart_on') continue;
    const demoMs = demoMsShowing(events, o.t);
    const k = gifFrameAt(scenes, fps, shotId, demoMs);
    if (k !== null) return { k, demoMs };
  }
  return null;
}

/**
 * SSIM of `region` (CSS px inside the GIF band) between a GIF source frame
 * (the band drawn at DPR 2) and demo.mp4 at `seconds`, where the band sits at
 * `band` (CSS px of the page). NaN when ffmpeg cannot compare them.
 */
export function regionSsim(png, demoMp4, seconds, band, region) {
  const [x, y, w, h] = [region.x, region.y, region.w, region.h].map((n) => Math.round(n * 2));
  const r = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-i', png, '-ss', String(seconds), '-i', demoMp4,
    '-lavfi', `[0:v]crop=${w}:${h}:${x}:${y},format=rgb24[a];[1:v]crop=${w}:${h}:${x + band.x * 2}:${y + band.y * 2},format=rgb24[b];[a][b]ssim`,
    '-frames:v', '1', '-f', 'null', '-',
  ]);
  const m = /All:([0-9.]+)/.exec(r.stderr.toString());
  return m ? Number(m[1]) : NaN;
}

/** Rex's tracked box at demo ms `demoMs`, in band px, clipped to the band; null when he is untracked or under MIN_REGION_PX inside it. */
export function rexRegion(events, demoMs, band) {
  const rex = rexAt(events, loggedMsAt(events, demoMs), band);
  if (!rex) return null;
  const x0 = Math.max(0, Math.floor(rex.box.x));
  const y0 = Math.max(0, Math.floor(rex.box.y));
  const x1 = Math.min(band.w, Math.ceil(rex.box.x + rex.box.w));
  const y1 = Math.min(band.h, Math.ceil(rex.box.y + rex.box.h));
  if (x1 - x0 < MIN_REGION_PX || y1 - y0 < MIN_REGION_PX) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The GIF is this run's footage: its first treat frame (in `framesDir`)
 * against `demoMp4` (this run's s1_inbox recording) at the same moment, over
 * Rex's box. Returns { bad, info }; every missing input is a failure, never a
 * pass.
 */
export function checkGifProvenance({ scenes, fps, events, framesDir, demoMp4 }) {
  const t = treatMoment(scenes, fps, events);
  if (!t) return { bad: ['GIF provenance: the inbox scene shows no heart_on'], info: null };
  const png = join(framesDir, `frame-${String(t.k).padStart(4, '0')}.png`);
  if (!existsSync(png)) return { bad: [`GIF provenance: ${png} is missing`], info: null };
  if (!existsSync(demoMp4)) return { bad: [`GIF provenance: ${demoMp4} is missing`], info: null };
  const band = scenes.find((sc) => sc.shotId === 's1_inbox').cropCss;
  const region = rexRegion(events, t.demoMs, band);
  if (!region) return { bad: [`GIF provenance: Rex is not tracked inside the GIF band at the treat (${(t.demoMs / 1000).toFixed(3)} s)`], info: null };
  const s = regionSsim(png, demoMp4, t.demoMs / 1000, band, region);
  const info = `GIF treat frame ${t.k} vs s1_inbox/demo.mp4 @ ${(t.demoMs / 1000).toFixed(3)} s over Rex (${region.w}x${region.h} at ${region.x},${region.y}): SSIM ${s}`;
  const bad = s >= PROVENANCE_SSIM_MIN ? [] : [`GIF provenance: treat frame ${t.k} matches this run's s1_inbox at SSIM ${s}, want >= ${PROVENANCE_SSIM_MIN}`];
  return { bad, info };
}

const sha256 = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null);

export function main(argv) {
  const runDir = runArg(argv);
  const runId = basename(runDir);
  const shots = readJson(join(VIDEO_DIR, 'shots.json'));
  const bad = [];
  const info = [];
  const dirOf = (id, port) => shotDir(runDir, id, port ? '9:16' : '16:9');
  const eventsOf = (id, port) => {
    const f = join(dirOf(id, port), 'events.json');
    return existsSync(f) ? readJson(f) : null;
  };

  for (const [tag, spec] of Object.entries(CUTS)) {
    const f = join(OUT_DIR, spec.file);
    if (!existsSync(f)) { bad.push(`${tag}: out/${spec.file} missing`); continue; }
    const p = probe(f);
    bad.push(...checkCut(tag, p, spec));
    const lufs = measureLufs(f);
    bad.push(...checkLufs(tag, lufs));
    info.push(`${tag} ${Number(p.format.duration).toFixed(2)} s ${lufs} LUFS`);
  }

  if (!existsSync(GIF_PATH)) bad.push('GIF: out/pixel-pets.gif missing');
  else {
    const p = probe(GIF_PATH);
    bad.push(...checkGif(statSync(GIF_PATH).size, p).map((b) => `GIF: ${b}`));
    info.push(`GIF ${(statSync(GIF_PATH).size / 1e6).toFixed(2)} MB ${Number(p.format.duration).toFixed(2)} s`);
  }

  const mf = join(OUT_DIR, 'render-manifest.json');
  const manifest = existsSync(mf) ? readJson(mf) : null;
  bad.push(...checkManifest(manifest, runId, (v, id) => sha256(join(dirOf(id, v === '9x16'), 'demo.mp4'))));

  try {
    const { scenes, fps, eventsByShotId } = planScenes(runDir);
    const p = checkGifProvenance({ scenes, fps, events: eventsByShotId.s1_inbox, framesDir: FRAMES_DIR, demoMp4: join(dirOf('s1_inbox', false), 'demo.mp4') });
    bad.push(...p.bad);
    if (p.info) info.push(p.info);
  } catch (err) {
    bad.push(`GIF provenance: ${err.message}`);
  }

  for (const port of [false, true]) {
    const tag = port ? '9:16' : '16:9';
    const evs = shots.edit_order.map((id) => eventsOf(id, port));
    const missingShots = shots.edit_order.filter((_, i) => !evs[i]);
    if (missingShots.length) bad.push(`${tag}: no events.json for ${missingShots.join(', ')}`);
    const miss = missingKinds(evs);
    if (miss.length) bad.push(`${tag}: never observed ${miss.join(', ')}`);
    const forb = forbiddenInRosters(evs);
    if (forb.length) bad.push(`${tag}: uncast species in a roster: ${forb.join(', ')}`);
  }
  bad.push(...checkAdoption(eventsOf(POPUP_SHOT_ID, false)));

  for (const line of info) console.log(`qa: ${line}`);
  if (bad.length) {
    for (const b of bad) console.error(`qa FAIL  ${b}`);
    throw new Error(`qa: ${bad.length} failure${bad.length === 1 ? '' : 's'}`);
  }
  console.log('qa: all checks pass');
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

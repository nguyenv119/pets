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
//              moment, cropped to the GIF band, SSIM >= 0.8
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
import { FRAMES_DIR, gifFrameAt, planScenes } from './gif.mjs';
import { measureLufs } from './loudness.mjs';
import { isMain, OUT_DIR, probe, readJson, runArg, VIDEO_DIR } from './stage-io.mjs';

export const CUTS = {
  '16x9': { file: 'pixel-pets-16x9.mp4', width: 1920, height: 1080, seconds: [28.3, 31.0] },
  '9x16': { file: 'pixel-pets-9x16.mp4', width: 1080, height: 1920, seconds: [28.3, 31.5] },
};
export const LUFS = [-18, -14];
export const GIF = { maxBytes: 5_000_000, width: 960, height: 360, seconds: [7.0, 10.5] };
export const PROVENANCE_SSIM_MIN = 0.8;
export const REQUIRED_KINDS = ['wave', 'chase_start', 'catch', 'eat', 'greet', 'sleep'];
export const FORBIDDEN = ['totoro', 'miffy', 'fox', 'cockatiel', 'monkey', 'horse'];
export const VARIANTS = ['16x9', '9x16', 'gif', 'still'];
const POPUP = 's2b_shelter';

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

export function checkGif(bytes, p) {
  const v = p?.streams?.find((s) => s.codec_type === 'video');
  const d = Number(p?.format?.duration);
  const bad = [];
  if (!(bytes < GIF.maxBytes)) bad.push(`GIF: ${bytes} bytes, want under ${GIF.maxBytes}`);
  if (v?.width !== GIF.width || v?.height !== GIF.height) bad.push(`GIF: ${v?.width}x${v?.height}, want ${GIF.width}x${GIF.height}`);
  if (!(d >= GIF.seconds[0] && d <= GIF.seconds[1])) bad.push(`GIF: ${Number.isFinite(d) ? d.toFixed(2) : '?'} s, want ${GIF.seconds.join('-')} s`);
  return bad;
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
    const demoMs = events.trimBeforeMs + o.t + events.videoLagMs;
    const k = gifFrameAt(scenes, fps, shotId, demoMs);
    if (k !== null) return { k, demoMs };
  }
  return null;
}

/** SSIM of a GIF source frame (1920x720 PNG) against demo.mp4 at `seconds`, cropped to the band `crop` (CSS px, DPR 2). */
export function bandSsim(png, demoMp4, seconds, crop) {
  const r = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-i', png, '-ss', String(seconds), '-i', demoMp4,
    '-lavfi', `[1:v]crop=${crop.w * 2}:${crop.h * 2}:${crop.x * 2}:${crop.y * 2},format=rgb24[b];[0:v]format=rgb24[a];[a][b]ssim`,
    '-frames:v', '1', '-f', 'null', '-',
  ]);
  const m = /All:([0-9.]+)/.exec(r.stderr.toString());
  return m ? Number(m[1]) : NaN;
}

const sha256 = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null);

export function main(argv) {
  const runDir = runArg(argv);
  const runId = basename(runDir);
  const shots = readJson(join(VIDEO_DIR, 'shots.json'));
  const bad = [];
  const info = [];
  const shotDir = (id, port) => join(runDir, port && id !== POPUP ? 'v916' : '', id);
  const eventsOf = (id, port) => {
    const f = join(shotDir(id, port), 'events.json');
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

  const gif = join(OUT_DIR, 'pixel-pets.gif');
  if (!existsSync(gif)) bad.push('GIF: out/pixel-pets.gif missing');
  else {
    const p = probe(gif);
    bad.push(...checkGif(statSync(gif).size, p));
    info.push(`GIF ${(statSync(gif).size / 1e6).toFixed(2)} MB ${Number(p.format.duration).toFixed(2)} s`);
  }

  const mf = join(OUT_DIR, 'render-manifest.json');
  const manifest = existsSync(mf) ? readJson(mf) : null;
  bad.push(...checkManifest(manifest, runId, (v, id) => sha256(join(shotDir(id, v === '9x16'), 'demo.mp4'))));

  // the GIF is this run's footage: its first treat frame against this run's s1_inbox recording at the same moment
  try {
    const { scenes, fps } = planScenes(runDir);
    const inbox = eventsOf('s1_inbox', false);
    const t = treatMoment(scenes, fps, inbox);
    if (!t) bad.push('GIF provenance: the inbox scene shows no heart_on');
    else {
      const png = join(FRAMES_DIR, `frame-${String(t.k).padStart(4, '0')}.png`);
      const crop = scenes.find((s) => s.shotId === 's1_inbox').cropCss;
      const s = bandSsim(png, join(shotDir('s1_inbox', false), 'demo.mp4'), t.demoMs / 1000, crop);
      info.push(`GIF treat frame ${t.k} vs s1_inbox/demo.mp4 @ ${(t.demoMs / 1000).toFixed(3)} s: SSIM ${s}`);
      if (!(s >= PROVENANCE_SSIM_MIN)) bad.push(`GIF provenance: treat frame ${t.k} matches this run's s1_inbox at SSIM ${s}, want >= ${PROVENANCE_SSIM_MIN}`);
    }
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
  bad.push(...checkAdoption(eventsOf(POPUP, false)));

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

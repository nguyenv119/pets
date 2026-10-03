#!/usr/bin/env node
// `npm run video`: the whole promo from a fresh checkout (pets-o3p.5). Runs
// the stages in order and stops at the first failure, naming the stage:
//
//   0 prepare        node >= 24; npm ci at the repo root if ../node_modules is
//                    missing (the extension build needs typescript and esbuild);
//                    Playwright's Chromium; Remotion's headless shell. All no-ops
//                    when already present.
//   1 record         record/record.mjs: every shot of shots.json, 16:9 and 9:16
//                    (the popup take once), into build/<timestamp>/
//   2 render         render.mjs --run build/<timestamp>: --variant 16x9, 9x16, gif,
//                    and still at src:rex:swipe+600 without captions (each updates
//                    out/render-manifest.json with this run's id and source hashes)
//   3 loudness       4 gif   5 thumbnail   6 describe   7 contact-sheet   8 qa   9 prune
//
// Stages talk only through files in build/<run>/ and out/. Every line of
// output is also written to out/pipeline.log. Stages run one after another,
// so a render never overlaps a recording (and both take video/lib/lock.mjs's
// machine-wide lock, so another job on the machine is waited for).
//
// Usage: npm run video [-- --run build/<run>]
//   --run  reuse an existing recording and skip stage 1 (re-render, re-check)

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { BUILD_DIR, isMain, OUT_DIR, REPO_DIR, VIDEO_DIR } from './stage-io.mjs';

export const MIN_NODE_MAJOR = 24;
export const STILL_AT = 'src:rex:swipe+600';

/** Throws the bead's message unless `version` (process.versions.node) is 24 or newer. */
export function checkNode(version) {
  const major = Number(String(version).split('.')[0]);
  if (!(major >= MIN_NODE_MAJOR)) throw new Error(`node ${MIN_NODE_MAJOR} or newer required, found v${version}`);
}

/** The one run directory a recording added to build/: `before` and `after` are its entry names. */
export function pickNewRun(before, after) {
  const added = after.filter((n) => !before.includes(n));
  if (added.length !== 1) throw new Error(`expected the recorder to add one build/<run>/ directory, found ${added.length} (${added.join(', ') || 'none'})`);
  return added[0];
}

export function parseArgs(argv) {
  const opts = { run: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') opts.run = argv[++i];
    else throw new Error(`pipeline: unrecognised argument "${argv[i]}"`);
  }
  if (opts.run !== null && !opts.run) throw new Error('pipeline: --run needs a directory');
  return opts;
}

const tsx = (script, ...args) => ({ cmd: 'npx', args: ['tsx', script, ...args], cwd: VIDEO_DIR });

/**
 * The stages, in order. `ctx` = { rootModules (../node_modules exists),
 * run (build/<run>, once known), reuseRun }. Each stage's `steps(ctx)` lists
 * the commands it runs; `record` instead records and sets ctx.run.
 */
export function stagePlan() {
  return [
    {
      name: 'prepare',
      steps: (ctx) => [
        ...(ctx.rootModules ? [] : [{ cmd: 'npm', args: ['ci'], cwd: REPO_DIR }]),
        { cmd: 'npx', args: ['playwright', 'install', 'chromium'], cwd: VIDEO_DIR },
        { cmd: 'npx', args: ['remotion', 'browser', 'ensure'], cwd: VIDEO_DIR },
        { cmd: 'ffmpeg', args: ['-hide_banner', '-version'], cwd: VIDEO_DIR, quiet: true },
        { cmd: 'ffprobe', args: ['-hide_banner', '-version'], cwd: VIDEO_DIR, quiet: true },
      ],
    },
    { name: 'record', skip: (ctx) => ctx.reuseRun, steps: () => [tsx('record/record.mjs')], recordsRun: true },
    {
      name: 'render',
      steps: (ctx) => [
        tsx('scripts/render.mjs', '--run', ctx.run, '--variant', '16x9'),
        tsx('scripts/render.mjs', '--run', ctx.run, '--variant', '9x16'),
        tsx('scripts/render.mjs', '--run', ctx.run, '--variant', 'gif'),
        tsx('scripts/render.mjs', '--run', ctx.run, '--variant', 'still', '--at', STILL_AT, '--no-captions'),
      ],
    },
    { name: 'loudness', steps: () => [tsx('scripts/loudness.mjs')] },
    { name: 'gif', steps: (ctx) => [tsx('scripts/gif.mjs', '--run', ctx.run)] },
    { name: 'thumbnail', steps: () => [tsx('scripts/thumbnail.mjs')] },
    { name: 'describe', steps: (ctx) => [tsx('scripts/describe.mjs', '--run', ctx.run)] },
    { name: 'contact-sheet', steps: () => [tsx('scripts/contact-sheet.mjs')] },
    { name: 'qa', steps: (ctx) => [tsx('scripts/qa.mjs', '--run', ctx.run)] },
    { name: 'prune', steps: (ctx) => [tsx('scripts/prune.mjs', '--keep', ctx.run)] },
  ];
}

function runStep({ cmd, args, cwd, quiet }, log) {
  return new Promise((resolveStep, reject) => {
    log.write(`$ (${relative(REPO_DIR, cwd) || '.'}) ${cmd} ${args.join(' ')}\n`);
    const child = spawn(cmd, args, { cwd, env: process.env });
    const tee = (stream) => (chunk) => {
      log.write(chunk);
      if (!quiet) stream.write(chunk);
    };
    child.stdout.on('data', tee(process.stdout));
    child.stderr.on('data', tee(process.stderr));
    child.on('error', (err) => reject(new Error(`${cmd}: ${err.message}`)));
    child.on('close', (code) => (code === 0 ? resolveStep() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

/**
 * Runs `plan` (stagePlan() by default) in order; returns the exit code.
 * `buildDir` is where the record stage adds its run and `logPath` the tee'd
 * log; tests pass their own.
 */
export async function runPipeline(argv, { plan = stagePlan(), buildDir = BUILD_DIR, logPath = join(OUT_DIR, 'pipeline.log') } = {}) {
  const opts = parseArgs(argv);
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath);
  const say = (line) => {
    console.log(line);
    log.write(`${line}\n`);
  };
  const ctx = { rootModules: existsSync(join(REPO_DIR, 'node_modules')), reuseRun: !!opts.run, run: opts.run ? resolve(opts.run) : null };
  const t0 = Date.now();
  try {
    if (ctx.run && !existsSync(ctx.run)) throw Object.assign(new Error(`--run ${ctx.run} does not exist`), { stage: 'prepare' });
    for (const [i, stage] of plan.entries()) {
      if (stage.skip?.(ctx)) {
        say(`== stage ${i} ${stage.name}: skipped (reusing ${relative(VIDEO_DIR, ctx.run)})`);
        continue;
      }
      const ts = Date.now();
      say(`== stage ${i} ${stage.name}`);
      try {
        if (stage.name === 'prepare') checkNode(process.versions.node);
        const before = stage.recordsRun ? (existsSync(buildDir) ? readdirSync(buildDir) : []) : null;
        for (const step of stage.steps(ctx)) await runStep(step, log);
        if (stage.recordsRun) ctx.run = join(buildDir, pickNewRun(before, existsSync(buildDir) ? readdirSync(buildDir) : []));
      } catch (err) {
        err.stage = stage.name;
        throw err;
      }
      say(`== stage ${i} ${stage.name} done in ${((Date.now() - ts) / 1000).toFixed(1)} s${stage.recordsRun ? ` -> ${relative(VIDEO_DIR, ctx.run)}` : ''}`);
    }
    say(`pipeline: done in ${((Date.now() - t0) / 60000).toFixed(1)} min from ${ctx.run ? relative(VIDEO_DIR, ctx.run) : 'no run'}; outputs in out/`);
  } catch (err) {
    say(`pipeline: FAILED at stage "${err.stage ?? '?'}": ${err.message}`);
    await new Promise((r) => log.end(r));
    return 1;
  }
  await new Promise((r) => log.end(r));
  return 0;
}

if (isMain(import.meta.url)) {
  runPipeline(process.argv.slice(2)).then((code) => process.exit(code));
}

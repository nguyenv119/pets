// planMaster.ts: plans one aspect's master and gates it on the render
// checks (epic pets-o3p, bead pets-o3p.4). Pure apart from its log lines;
// scripts/render.mjs calls it for --variant 16x9, 9x16 and still, and the
// tests call it directly, so the abort path the tests cover is the one the
// CLI runs.

import type { Events } from '../schema';
import { STAGE_16X9, STAGE_9X16 } from './camera';
import { enforceRenderChecks } from './checkGate';
import { buildPromoPlan, type PromoPlan } from './plan';
import { runRenderChecks } from './renderChecks';
import { buildTimeline, type EditTimeline, type ShotsDoc } from './timeline';

/** shots.json master.length_rule (16:9) and variants.vertical_9x16.expected_length_s (9:16), in seconds, applied to --run only (the fixture and synthetic masters run long by construction). */
export const LENGTH_RULE_S = { '16x9': [27.3, 30.0], '9x16': [27.3, 30.5] } as const;

export interface PlanMasterInput {
  shots: ShotsDoc;
  eventsByShotId: Record<string, Events>;
  /** absolute demo.mp4 per shot (timeline.json's `source`) */
  sourceByShotId: Record<string, string>;
  /** public-dir demo.mp4 per shot (what the composition plays) */
  stagedByShotId: Record<string, string>;
  port: boolean;
  noZoom?: boolean;
  noCaptions?: boolean;
  mode: 'run' | 'synthetic' | 'fixture';
  /** timeline.json's `music`: the bed file's absolute path */
  musicPath: string;
  /** the bed and the icon inside the public dir */
  musicSrc: string;
  iconPath: string;
}

/** Plans one aspect's master. Throws RenderCheckError (every violation named) on any violation, in every mode. */
export function planMaster(input: PlanMasterInput): { edit: EditTimeline; plan: PromoPlan } {
  const { shots, eventsByShotId, sourceByShotId, stagedByShotId, port, noZoom, noCaptions, mode } = input;
  const stage = port ? STAGE_9X16 : STAGE_16X9;
  const aspect = port ? '9x16' : '16x9';
  const edit = buildTimeline({ shots, stage, aspect, eventsByShotId, sourceByShotId, music: input.musicPath, noZoom, allowEmptyBeats: mode === 'fixture', minLengthMs: mode === 'run' ? LENGTH_RULE_S[aspect][0] * 1000 : undefined });
  const lengthS = edit.totalFrames / edit.fps;
  console.log(`master length ${lengthS.toFixed(2)} s (${edit.totalFrames} frames)`);
  const plan = buildPromoPlan({ edit, shots, eventsByShotId, stagedByShotId, stage, aspect, outputWidth: stage.width, outputHeight: stage.height, musicSrc: input.musicSrc, iconPath: input.iconPath, noCaptions });
  console.log(enforceRenderChecks(runRenderChecks({ edit, shots, eventsByShotId, stage, aspect, outputWidth: stage.width, items: plan.items })));
  const [minS, maxS] = LENGTH_RULE_S[aspect];
  if (mode === 'run' && (lengthS < minS || lengthS > maxS)) {
    throw new Error(`render.mjs: the cut runs ${lengthS.toFixed(2)} s, outside the length rule ${minS}-${maxS} s (shots.json master.length_rule: re-run s2_review with the next passing seed, or extend the final hold)`);
  }
  return { edit, plan };
}

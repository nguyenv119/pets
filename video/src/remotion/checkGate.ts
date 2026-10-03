// checkGate.ts: what a render does with render-check violations (epic
// pets-o3p, bead pets-o3p.4). Pure.
//
// A real take aborts on ANY violation, naming the frame and the element.
// The one exception is stand-in data: a run whose every shot's own
// events.json says shim "fixture" (fixtures/, and the synthetic run built
// from the committed fixture clip, which the epic eval can never pass).
// Its pets stand where the reused clip put them, not where the shot spec
// puts them, so honest checks trip on it; such a run renders anyway, prints
// "CHECKS FAILED (stand-in data)" with every violation, and records them in
// out/render-manifest.json. The bypass reads only the recordings' own
// shim, never a CLI flag, so a recorded take (shim "v3;seed=N") can never
// reach it.

import type { Events } from '../schema';
import type { FrameViolation } from './renderChecks';

export const STAND_IN_SHIM = 'fixture';

export class RenderCheckError extends Error {
  constructor(readonly violations: readonly FrameViolation[]) {
    super(`render checks failed on ${violations.length} frame check(s); first: ${describeViolation(violations[0])}`);
    this.name = 'RenderCheckError';
  }
}

export const describeViolation = (v: FrameViolation): string => `frame ${v.frame} ${v.element}: ${v.check} (${v.detail})`;

/** True only when EVERY shot's own events say shim "fixture". */
export function isStandInRun(eventsByShotId: Record<string, Events>): boolean {
  const all = Object.values(eventsByShotId);
  return all.length > 0 && all.every((e) => e.shim === STAND_IN_SHIM);
}

export interface GateResult {
  standIn: boolean;
  violations: readonly FrameViolation[];
  /** the lines to print */
  report: string[];
}

/** Throws RenderCheckError on any violation unless the run is stand-in data (see the header). */
export function enforceRenderChecks(violations: readonly FrameViolation[], eventsByShotId: Record<string, Events>): GateResult {
  if (violations.length === 0) return { standIn: isStandInRun(eventsByShotId), violations, report: ['render checks: every frame passes'] };
  if (!isStandInRun(eventsByShotId)) throw new RenderCheckError(violations);
  return { standIn: true, violations, report: ['CHECKS FAILED (stand-in data)', ...violations.map(describeViolation)] };
}

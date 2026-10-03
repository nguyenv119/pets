// checkGate.ts: what a render does with render-check violations (epic
// pets-o3p, bead pets-o3p.4). Pure.
//
// ANY violation aborts the render, naming the frame and the element: in
// every mode (--run, --synthetic, --fixture) and every variant (16x9,
// 9x16, gif, still), whatever the recordings' shim says. Stand-in data
// gets no exemption: the synthetic run reuses one fixture clip whose pets
// stand where that clip put them, so some of its beats fail honestly, and
// the render stops there. `--plan-only` still prints every violation
// before it exits non-zero.

import type { FrameViolation } from './renderChecks';

export class RenderCheckError extends Error {
  constructor(readonly violations: readonly FrameViolation[]) {
    super(`render checks failed on ${violations.length} frame check(s); first: ${describeViolation(violations[0])}`);
    this.name = 'RenderCheckError';
  }
}

export const describeViolation = (v: FrameViolation): string => `frame ${v.frame} ${v.element}: ${v.check} (${v.detail})`;

/** Throws RenderCheckError on any violation; otherwise returns the line to print. */
export function enforceRenderChecks(violations: readonly FrameViolation[]): string {
  if (violations.length > 0) throw new RenderCheckError(violations);
  return 'render checks: every frame passes';
}

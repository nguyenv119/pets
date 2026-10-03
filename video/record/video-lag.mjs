// Shared run-scoped state for videoLagMs's fallback rule (bead step 9): a
// heart-less take (s3_sheet, s4_article_night, s2b_shelter) uses the
// median of this run's own heart-measured kept shots, or the proof
// render's own measured value if none have been kept yet. Both record.mjs
// (page shots) and popup.mjs (the heart-less s2b_shelter take) read and
// contribute to the same list, so it must live outside either file to
// avoid a circular import between them.

/** The proof render's own measured heart-appearance lag (bead step 9's ultimate fallback). */
export const PROOF_VIDEO_LAG_MS = 56;

/** videoLagMs values measured from a real heart in this run's own kept shots so far. */
export const keptHeartLagsMs = [];

export function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Resolves videoLagMs for a heart-less take: the median of this run's kept heart-measured shots, else the proof's value. */
export function fallbackVideoLagMs() {
  if (keptHeartLagsMs.length > 0) {
    return { videoLagMs: medianOf(keptHeartLagsMs), source: `median of ${keptHeartLagsMs.length} heart-measured shot(s) kept this run` };
  }
  return { videoLagMs: PROOF_VIDEO_LAG_MS, source: "no heart-measured shot kept yet this run; the proof render's own measured value" };
}

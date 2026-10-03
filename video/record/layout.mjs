// The build/<run>/ layout the recorder writes and every later stage reads:
//
//   build/<run>/<shot>/          16:9 page shots, and the popup take (filmed once, shared by both cuts)
//   build/<run>/v916/<shot>/     9:16 page shots
//
// Each holds demo.mp4 and events.json.

import { join } from 'node:path';

/** The popup adoption take: recorded once, at the top level, for both aspect ratios. */
export const POPUP_SHOT_ID = 's2b_shelter';

/** A shot's directory in a run: `aspect` is '16:9' or '9:16'. */
export function shotDir(runDir, id, aspect) {
  if (aspect !== '16:9' && aspect !== '9:16') throw new Error(`shotDir: aspect must be '16:9' or '9:16', not "${aspect}"`);
  return aspect === '9:16' && id !== POPUP_SHOT_ID ? join(runDir, 'v916', id) : join(runDir, id);
}

/** The page shots of a shots.json document, in edit order: every shot but the popup take. */
export function pageShotIds(shotsDoc) {
  return shotsDoc.edit_order.filter((id) => shotsDoc.shots.find((s) => s.id === id)?.page !== 'popup');
}

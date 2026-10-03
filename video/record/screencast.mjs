// CDP screencast capture shared by record.mjs (page shots) and popup.mjs
// (the s2b_shelter take): every frame is acked at once, so Chrome keeps
// sending, and written to <framesDir>/fNNNNN.png in arrival order.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Starts a PNG screencast on `cdp`. Returns `frames` ({ file, ts }[], filled
 * as frames arrive; ts is CDP's own frame timestamp in seconds) and
 * `stop()`, which ends the screencast and resolves once every frame is on
 * disk.
 */
export async function startScreencast(cdp, framesDir) {
  const frames = [];
  const pending = [];
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const file = join(framesDir, `f${String(frames.length).padStart(5, '0')}.png`);
    frames.push({ file, ts: f.metadata.timestamp });
    pending.push(writeFile(file, Buffer.from(f.data, 'base64')));
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast');
      await Promise.all(pending);
    },
  };
}

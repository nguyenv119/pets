// CDP screencast capture shared by record.mjs (page shots) and popup.mjs
// (the s2b_shelter take): every frame is acked at once, so Chrome keeps
// sending, and written to <framesDir>/fNNNNN.png in arrival order.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** { width, height } from a PNG's IHDR, or {} for anything that is not a PNG. */
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return {};
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Drops the screencast's leading frames that arrived at the wrong size
 * before the start clapper went up. A fresh page's first frame now and then
 * comes before the viewport is applied (probed: 1080x1286 then 1080x1460
 * 22 ms later, 1 run in 4; the same 87 CSS px short in 16:9, 1920x906),
 * and ffmpeg's concat sizes the whole clip from its first frame, so one
 * such pre-roll frame discarded whole takes. Only frames stamped before
 * `beforeMs` (the start clapper's insert, epoch ms) are ever dropped: a
 * wrong-size frame inside the take is kept, and the size check discards it.
 */
export function dropLeadingMisSizedFrames(frames, { width, height, beforeMs }) {
  let i = 0;
  while (i < frames.length && frames[i].ts * 1000 < beforeMs && frames[i].width !== undefined && (frames[i].width !== width || frames[i].height !== height)) i++;
  return frames.slice(i);
}

/**
 * Starts a PNG screencast on `cdp`. Returns `frames` ({ file, ts, width, height }[],
 * filled as frames arrive; ts is CDP's own frame timestamp in seconds) and
 * `stop()`, which ends the screencast and resolves once every frame is on
 * disk.
 */
export async function startScreencast(cdp, framesDir) {
  const frames = [];
  const pending = [];
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const file = join(framesDir, `f${String(frames.length).padStart(5, '0')}.png`);
    const png = Buffer.from(f.data, 'base64');
    frames.push({ file, ts: f.metadata.timestamp, ...pngSize(png) });
    pending.push(writeFile(file, png));
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

// The clapperboard both recorders flash at the start and end of a take: a
// full-viewport magenta div that sync.mjs finds in the video with
// signalstats. Page shots (record.mjs) and the popup take (popup.mjs) each
// inject it with `page.evaluate(installClap)`, so it must stay
// self-contained: Playwright serializes only this function's source, with
// no imports or outer-scope references.

/**
 * Installs window.__clap(label, holdMs) -> Promise<{ label, tInsert, tOn,
 * tRemove, tOff }> (absolute epoch ms). tOn and tOff are each read in the
 * first animation frame after the insert and the removal, so they track
 * when the paint actually happened, not when it was requested. Every mark
 * is also kept in window.__clapMarks for a later read-back.
 */
export function installClap() {
  const now = () => performance.timeOrigin + performance.now();
  const marks = (window.__clapMarks = []);
  window.__clap = (label, holdMs) =>
    new Promise((resolve) => {
      const div = document.createElement('div');
      div.style.cssText =
        'all:initial;position:fixed;inset:0;display:block;background:#ff00ff;opacity:1;z-index:2147483647;pointer-events:none;';
      const tInsert = now();
      document.documentElement.appendChild(div);
      requestAnimationFrame(() => {
        const tOn = now();
        setTimeout(() => {
          const tRemove = now();
          div.remove();
          requestAnimationFrame(() => {
            const mark = { label, tInsert, tOn, tRemove, tOff: now() };
            marks.push(mark);
            resolve(mark);
          });
        }, holdMs);
      });
    });
}

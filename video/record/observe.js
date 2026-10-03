// Main-world observation of #pixel-pets-host's open shadow root. Installed
// with `page.addInitScript(installObservers, roster)` BEFORE the page loads:
// it waits for the content script to create the host and attaches at once,
// so the first tracked frame is the first frame a pet is drawn (pets_ready)
// rather than whenever the recorder got round to installing it. The function
// is serialized by Playwright, so it has no outer-scope references.
//
// The installed window.__pp collector is polled by choreo.mjs while a take
// runs and read back at the end with `page.evaluate(() => window.__pp)` for
// derive.mjs, which turns it (plus the choreography's own clicks[]) into an
// Events document matching src/schema.ts.

/**
 * Installs the MutationObserver, hover listeners, mouse listeners and the
 * rAF canvas-scan/track loop described in the bead's step 5, plus a paint
 * observer for first_paint. Runs inside the page as an init script (on
 * every document of the page, so it skips about:blank and child frames).
 * `roster` (RosterEntry[]) resolves a sprite's type/colour path segment back
 * to the shot's roster id, so every logged `pet` is a roster id, never a
 * species/colour string.
 */
export function installObservers(roster) {
  if (window.top !== window || location.protocol === 'about:') return;
  const now = () => performance.timeOrigin + performance.now();

  const pp = (window.__pp = {
    src: [],
    hover: [],
    mouse: [],
    cursor: [],
    tracks: [],
    marks: [],
    firstPaintT: null,
    canvasErr: null,
  });

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-paint' && pp.firstPaintT === null) pp.firstPaintT = performance.timeOrigin + e.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch (err) {
    pp.canvasErr = `paint observer: ${String(err)}`;
  }

  // -- page-level mouse events, capture phase (window exists before <html>) --
  window.addEventListener(
    'mousemove',
    (e) => pp.cursor.push({ t: performance.timeOrigin + e.timeStamp, x: e.clientX, y: e.clientY }),
    true,
  );
  for (const kind of ['mousedown', 'mouseup', 'click', 'dblclick']) {
    window.addEventListener(
      kind,
      (e) => pp.mouse.push({ t: performance.timeOrigin + e.timeStamp, kind, x: e.clientX, y: e.clientY }),
      true,
    );
  }

  // The content script (document_idle) appends #pixel-pets-host to <html>
  // and attaches its open shadow root, style, layer and canvas in the same
  // task, so the microtask this observer runs in sees all of them, before
  // any pet img exists.
  const attach = () => {
    const host = document.getElementById('pixel-pets-host');
    if (!host || !host.shadowRoot || !host.shadowRoot.querySelector('canvas')) return false;
    observeShadow(host.shadowRoot);
    return true;
  };
  let attached = attach();
  if (!attached) {
    const docObserver = new MutationObserver(() => {
      if (!attached && attach()) {
        attached = true;
        docObserver.disconnect();
      }
    });
    docObserver.observe(document, { childList: true, subtree: true });
    // Fallback: the host can appear before its canvas (a shadow-tree change
    // the document observer never sees), so keep checking once a frame.
    const poll = () => {
      if (attached) return;
      if (attach()) {
        attached = true;
        docObserver.disconnect();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  function observeShadow(sr) {
    function petIdFor(type, color) {
      const entry = roster.find((p) => p.type === type && p.color === color);
      return entry ? entry.id : null;
    }

    function parseSrc(u) {
      const m = /assets\/([^/]+)\/([a-z]+)_(idle|walk|run|swipe|lie|idle_with_ball)_8fps\.gif/.exec(u || '');
      if (!m) return { pet: null, gif: null };
      return { pet: petIdFor(m[1], m[2]), gif: m[3] };
    }

    function rectOf(el) {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }

    // -- src mutations (KEEP same-value rewrites: eat/idleWithBall both render
    // the idle GIF, and an idle->idle rewrite is their only DOM trace) --
    new MutationObserver((records) => {
      const t = now();
      for (const r of records) {
        if (r.type !== 'attributes' || r.attributeName !== 'src') continue;
        const from = parseSrc(r.oldValue);
        const to = parseSrc(r.target.getAttribute('src'));
        pp.src.push({
          t,
          pet: to.pet ?? from.pet,
          from: from.gif,
          to: to.gif,
          rect: rectOf(r.target),
        });
      }
    }).observe(sr, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'], attributeOldValue: true });

    // -- hover truth, capture phase --
    for (const kind of ['mouseover', 'mouseout']) {
      sr.addEventListener(
        kind,
        (e) => {
          if (e.target.tagName !== 'IMG') return;
          pp.hover.push({ t: now(), kind, pet: parseSrc(e.target.getAttribute('src')).pet });
        },
        true,
      );
    }

    // -- rAF canvas scan + per-frame track log --
    const canvas = sr.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let prevBall = false;
    let prevHeart = false;

    function scanFrame(t) {
      const w = canvas.width;
      const h = canvas.height;
      const scaleX = canvas.width / canvas.clientWidth || 1;
      const scaleY = canvas.height / canvas.clientHeight || 1;

      let ballFound = false;
      let ballSumX = 0;
      let ballSumY = 0;
      let ballN = 0;
      let heartFound = false;
      let heartSumX = 0;
      let heartSumY = 0;
      let heartN = 0;

      try {
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (data[i + 3] < 120) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (g > 170 && b < 100 && g > r + 15) {
              ballN++;
              ballSumX += x;
              ballSumY += y;
            } else if (r > 180 && g < 70 && b < 90) {
              heartN++;
              heartSumX += x;
              heartSumY += y;
            }
          }
        }
        ballFound = ballN >= 5;
        heartFound = heartN >= 5;
      } catch (err) {
        pp.canvasErr = String(err);
      }

      const ballCss = ballFound ? { x: ballSumX / ballN / scaleX, y: ballSumY / ballN / scaleY } : undefined;
      const heartCss = heartFound ? { x: heartSumX / heartN / scaleX, y: heartSumY / heartN / scaleY } : undefined;

      if (ballFound && !prevBall) pp.marks.push({ kind: 'ball_on', t, x: ballCss.x, y: ballCss.y });
      if (!ballFound && prevBall) pp.marks.push({ kind: 'ball_off', t });
      if (heartFound && !prevHeart) pp.marks.push({ kind: 'heart_on', t, x: heartCss.x, y: heartCss.y });
      if (!heartFound && prevHeart) pp.marks.push({ kind: 'heart_off', t });
      prevBall = ballFound;
      prevHeart = heartFound;

      const pets = Array.from(sr.querySelectorAll('img')).map((img) => {
        const r = img.getBoundingClientRect();
        const parsed = parseSrc(img.getAttribute('src'));
        return { id: parsed.pet, x: r.x, y: r.y, w: r.width, h: r.height, src: img.getAttribute('src') };
      });

      pp.tracks.push({ t, pets, ball: ballCss });

    }

    // The scan must see each frame as it is painted: after the content
    // script's own rAF render, not before it. Installed ahead of the content
    // script, a plain rAF loop runs first in every frame and logs the
    // previous frame's boxes (the first s1 probe tracked Rex's new img at
    // x=0, before his first render placed it at 700). ResizeObserver
    // callbacks run in the same rendering update after every rAF callback
    // and layout, just before paint, so a 1 px probe resized on every frame
    // triggers the scan at exactly that point. t stays the frame's rAF time.
    const probe = document.createElement('div');
    probe.style.cssText = 'all:initial;position:fixed;left:-10px;top:-10px;width:1px;height:1px;visibility:hidden;pointer-events:none;';
    document.documentElement.appendChild(probe);
    let frameT = null;
    let flip = 0;
    new ResizeObserver(() => {
      if (frameT !== null) scanFrame(frameT);
    }).observe(probe);
    function tick() {
      frameT = now();
      probe.style.width = `${(flip++ % 2) + 1}px`;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
}

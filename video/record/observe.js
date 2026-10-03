// Main-world observation, installed on the open shadow root of
// #pixel-pets-host. Injected via `page.evaluate(installObservers)` — this
// module exports plain functions with no outer-scope references so
// Playwright can serialize them and run them in the page.
//
// The installed window.__pp collector is read back at the end of a take
// with `page.evaluate(() => window.__pp)` and handed to derive.mjs, which
// turns it (plus the choreography's own clicks[]) into an Events document
// matching src/schema.ts.

/**
 * Installs the MutationObserver, hover listeners, mouse listeners and the
 * rAF canvas-scan/track loop described in the bead's step 5. Runs inside
 * the page (no closures over outer scope — everything it needs is created
 * inside the function body). `roster` (RosterEntry[]) resolves a sprite's
 * type/colour path segment back to the shot's roster id, so every logged
 * `pet` is a roster id, never a species/colour string.
 */
export function installObservers(roster) {
  const now = () => performance.timeOrigin + performance.now();
  const host = document.querySelector('#pixel-pets-host');
  const sr = host.shadowRoot;

  const pp = (window.__pp = {
    src: [],
    hover: [],
    mouse: [],
    cursor: [],
    tracks: [],
    marks: [],
    canvasErr: null,
  });

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

  // -- page-level mouse events, capture phase --
  document.addEventListener(
    'mousemove',
    (e) => pp.cursor.push({ t: performance.timeOrigin + e.timeStamp, x: e.clientX, y: e.clientY }),
    true,
  );
  for (const kind of ['mousedown', 'mouseup', 'click', 'dblclick']) {
    document.addEventListener(
      kind,
      (e) => pp.mouse.push({ t: performance.timeOrigin + e.timeStamp, kind, x: e.clientX, y: e.clientY }),
      true,
    );
  }

  // -- rAF canvas scan + per-frame track log --
  const canvas = sr.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let prevBall = false;
  let prevHeart = false;

  function scanFrame() {
    const t = now();
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

    requestAnimationFrame(scanFrame);
  }

  requestAnimationFrame(scanFrame);
}

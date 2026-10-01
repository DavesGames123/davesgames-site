// render-scale.js — size a ray-march canvas by a pixel budget and the frame rate.
//
// A classic script (not a module), for the full-screen ray-march pages
// (blackhole, ellis-wormhole). Those pages trace one geodesic per canvas
// pixel, so the frame cost is the pixel count times the steps per ray. They
// used to set the canvas to a fixed fraction of window x devicePixelRatio.
// A 4K screen then got 1536x864, four times the pixels of a 1080p screen.
//
// The render size comes from three limits, in this order:
//   1. base     window x min(dpr, 2) x frac  (frac is lower on phones)
//   2. budget   at most maxPixels, with the window aspect kept
//   3. level    a pixel factor q in [qMin, 1] that the frame rate sets
//
// tick() counts frames in 1 s windows. Below lowFps, q falls by DROP and the
// ceiling for q goes to just below the failed level. After GOOD_WINDOWS
// windows at highFps or more, q rises by RISE, but never above the ceiling.
// Each failure lowers the ceiling, so q does not swing between two levels.
// reset() puts the ceiling back to 1 when the page makes each pixel cheaper
// (a quality preset, for example). A resize also resets the ceiling.
//
// The first WARM_WINDOWS windows are not used: shader compile and the first
// frames are slow on every device. A frame gap over STALL_MS (a hidden tab)
// starts a new window.
//
// Limit: rAF cannot tell a slow GPU from a capped refresh rate. With Safari
// Low Power Mode (30 fps cap), q goes down to qMin.
//
//   const RS = RenderScale.create({ canvas, gl, label });
//   RS.resize();            // on load and on window resize
//   RS.tick(now);           // once per frame, with the rAF timestamp
//   RS.reset();             // after a change makes each pixel cheaper
//
//   grep -n 'MAX_PIXELS\|Q_MIN\|LOW_FPS\|HIGH_FPS'   the tuning constants
//   grep -n 'function size'                          the three limits
//   grep -n 'function tick'                          the frame-rate control
(function () {
  'use strict';

  const MAX_PIXELS = 1.0e6;   // about 1333x750 at 16:9
  const Q_MIN = 0.3;          // lowest pixel factor, about 55% of each axis
  const LOW_FPS = 45, HIGH_FPS = 55;
  const DROP = 0.7, RISE = 1.2, CEIL_MARGIN = 0.9;
  const WINDOW_MS = 1000, STALL_MS = 250;
  const WARM_WINDOWS = 2, GOOD_WINDOWS = 3;

  function create(opts) {
    const canvas = opts.canvas, gl = opts.gl, label = opts.label || null;
    const fracDesktop = opts.fracDesktop || 0.4, fracMobile = opts.fracMobile || 0.25;
    const mobileWidth = opts.mobileWidth || 600;
    const maxPixels = opts.maxPixels || MAX_PIXELS;

    let q = 1, ceil = 1;
    let last = -1, winStart = -1, frames = 0, warm = 0, good = 0;

    // The three limits: base fraction of the device pixels, the pixel
    // budget, then the frame-rate factor q. Each of the last two scales
    // both axes by the square root, so the aspect stays the same.
    function size() {
      const w = window.innerWidth, h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const frac = w < mobileWidth ? fracMobile : fracDesktop;
      let pw = w * dpr * frac, ph = h * dpr * frac;
      const cap = Math.min(1, Math.sqrt(maxPixels / Math.max(1, pw * ph)));
      const s = cap * Math.sqrt(q);
      return [Math.max(1, Math.floor(pw * s)), Math.max(1, Math.floor(ph * s))];
    }

    function apply() {
      const wh = size();
      if (canvas.width === wh[0] && canvas.height === wh[1]) return;
      canvas.width = wh[0]; canvas.height = wh[1];
      gl.viewport(0, 0, wh[0], wh[1]);
      if (label) label.textContent = wh[0] + '×' + wh[1];
    }

    function restart() { winStart = -1; frames = 0; good = 0; }

    function resize() { ceil = 1; restart(); apply(); }

    function reset() { ceil = 1; good = 0; }

    // Frame-rate control. A window that ends below LOW_FPS lowers q at once.
    // A rise needs GOOD_WINDOWS windows in a row at HIGH_FPS or more.
    function tick(now) {
      const dt = last < 0 ? 0 : now - last;
      last = now;
      if (dt > STALL_MS) { restart(); return; }
      if (winStart < 0) { winStart = now; frames = 0; return; }
      frames++;
      if (now - winStart < WINDOW_MS) return;
      const fps = frames * 1000 / (now - winStart);
      winStart = now; frames = 0;
      if (warm < WARM_WINDOWS) { warm++; return; }
      if (fps < LOW_FPS) {
        good = 0;
        if (q > Q_MIN) { ceil = q * CEIL_MARGIN; q = Math.max(Q_MIN, q * DROP); apply(); }
      } else if (fps >= HIGH_FPS && q < ceil) {
        if (++good >= GOOD_WINDOWS) { good = 0; q = Math.min(ceil, q * RISE); apply(); }
      } else {
        good = 0;
      }
    }

    return { resize: resize, tick: tick, reset: reset, level: function () { return q; } };
  }

  window.RenderScale = { create: create };
})();

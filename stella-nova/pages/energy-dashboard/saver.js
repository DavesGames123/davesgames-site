// Energy Dashboard · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only uses its globals (mycanvas,
// Ball, G, TIME_STEP, WIDTH, HEIGHT, CHART_WIDTH, update_data, coords_x,
// coords_y, energy_p, energy_k, energy, enableCoords_x, enableCoords_y,
// enableEnergy_p, enableEnergy_k, enableEnergy).
//
// Saver view. The page has two canvases: the sim (800 x 800) and the
// dashboard (400 x 400). The saver shows both, side by side, in one canvas
// of its own at the band size: the sim canvas is drawn in (scaled down),
// with a trail from coords_x / coords_y; the dashboard is drawn again as
// lines from the same data arrays, so it is sharp at any size (the 400 px
// raster is not scaled up). The enable flags that the upstream checkboxes
// set choose the curves, as on the page.
TMP.page({ n: null, title: 'Energy Dashboard', file: 'contribs/energyVisualization.html', video: null, year: 2021, licence: null, by: 'Shengzhe Hou', from: 'China' });

(function () {
  let view = null, vctx = null, dpr = 1;
  const PANEL = '#f6f4ee', INK = '#5b6270';
  function canvasEl() {
    if (!view) {
      view = document.createElement('canvas'); view.id = 'energy-saver-view';
      document.body.appendChild(view); vctx = view.getContext('2d');
    }
    return view;
  }
  // The upstream sim step, for the warm-up only (simulation() itself also
  // draws and asks for the next frame, so the saver cannot call it).
  function step() {
    Ball.vy += TIME_STEP * G;
    Ball.x += TIME_STEP * Ball.vx; Ball.y += TIME_STEP * Ball.vy;
    if (Ball.y > mycanvas.height || Ball.y < 0) Ball.vy = -Ball.vy;
    if (Ball.x > mycanvas.width || Ball.x < 0) Ball.vx = -Ball.vx;
  }
  // Each frame runs one sim step and two update_data() calls (main.js
  // starts the dashboard loop twice). Warm up the same way, so the chart
  // opens full.
  function warm(n) { for (let i = 0; i < n; i++) { step(); update_data(); update_data(); } }
  function show(o) {
    enableCoords_x = !!o.x; enableCoords_y = !!o.y;
    enableEnergy_p = !!o.p; enableEnergy_k = !!o.k; enableEnergy = !!o.e;
  }
  function start(r, o) {
    Ball.x = o.x0 != null ? o.x0 : 60 + r() * 680;
    Ball.y = o.y0 != null ? o.y0 : r() * 300;
    Ball.vx = o.vx != null ? o.vx : (r() < 0.5 ? -1 : 1) * (6 + 14 * r());
    Ball.vy = 0;
    warm(o.warm || 220);
  }

  // ---- the composite view ----
  const SER = {
    p: { arr: () => energy_p, on: () => enableEnergy_p, col: 'green', name: 'potential  m g (H − y)' },
    k: { arr: () => energy_k, on: () => enableEnergy_k, col: 'blue', name: 'kinetic  ½ m v²' },
    e: { arr: () => energy, on: () => enableEnergy, col: 'red', name: 'total  E = Eₚ + Eₖ' },
    x: { arr: () => coords_x, on: () => enableCoords_x, col: 'blue', name: 'x (px)', range: 1000 },
    y: { arr: () => coords_y, on: () => enableCoords_y, col: 'red', name: 'y (px, down)', range: 800 },
  };
  function draw() {
    if (!vctx) return;
    const W = view.width / dpr, H = view.height / dpr, c = vctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const gap = Math.max(16, W * 0.025), wide = W > 1.6 * H;
    const s = wide ? Math.min(H * 0.96, (W * 0.92 - gap) / 2) : Math.min(W * 0.92, (H * 0.96 - gap) / 2);
    const ax = wide ? (W - 2 * s - gap) / 2 : (W - s) / 2, ay = wide ? (H - s) / 2 : (H - 2 * s - gap) / 2;
    const bx = wide ? ax + s + gap : ax, by = wide ? ay : ay + s + gap;
    // sim panel: the upstream canvas, and a trail from the coords arrays
    c.fillStyle = PANEL; c.fillRect(ax, ay, s, s);
    const k = s / WIDTH;
    c.save(); c.beginPath(); c.rect(ax, ay, s, s); c.clip();
    for (let i = CHART_WIDTH - 1; i > 0; i -= 3) {
      if (coords_x[i] === -100) continue;
      c.fillStyle = `rgba(40, 70, 200, ${(0.7 * (1 - i / CHART_WIDTH)).toFixed(3)})`;
      c.fillRect(ax + coords_x[i] * k - 1, ay + coords_y[i] * k - 1, 2, 2);
    }
    c.drawImage(mycanvas, ax, ay, s, s);
    // a ring round the ball: at this scale the 10 px disc is small
    c.strokeStyle = 'rgba(40, 70, 200, 0.6)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(ax + Ball.x * k, ay + Ball.y * k, Math.max(6, 22 * k), 0, 2 * Math.PI); c.stroke();
    c.restore();
    // dashboard panel: the same mapping as draw_dashboard, as lines
    c.fillStyle = PANEL; c.fillRect(bx, by, s, s);
    c.strokeStyle = '#d8d4c8'; c.lineWidth = 1;
    const maxE = Ball.mass * G * HEIGHT, f = s / CHART_WIDTH;
    // The curves use the lower 76 % of the panel; the legend sits above.
    // With only the total on, the scale zooms to its own range, so the
    // small steps at the bounces show.
    const top = 0.2 * s, span = 0.76 * s;
    let lo = 0, hi = maxE, zoom = false;
    if (enableEnergy && !enableEnergy_p && !enableEnergy_k) {
      lo = Infinity; hi = -Infinity;
      for (const v of energy) if (v !== -100) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const pad = Math.max(0.004 * maxE, 0.15 * (hi - lo)); lo -= pad; hi += pad; zoom = true;
    }
    for (let g = 0; g <= 4; g++) { const gy = by + top + g * span / 4; c.beginPath(); c.moveTo(bx, gy); c.lineTo(bx + s, gy); c.stroke(); }
    let ly = by + 16;
    c.font = `${Math.max(11, Math.round(s / 34))}px system-ui, sans-serif`; c.textBaseline = 'middle';
    for (const key of Object.keys(SER)) {
      const S = SER[key]; if (!S.on()) continue;
      const a = S.arr();
      c.save(); c.beginPath(); c.rect(bx, by, s, s); c.clip();
      c.strokeStyle = S.col; c.lineWidth = 2; c.beginPath();
      let pen = false;
      for (let i = 0; i < CHART_WIDTH; i++) {
        if (a[i] === -100) { pen = false; continue; }
        // energies: lo at the base, hi at the top (upstream: 0 and m g H);
        // coords: down from the top, value / range (as upstream)
        const y = S.range ? top + span * a[i] / S.range : top + span * (1 - (a[i] - lo) / (hi - lo));
        if (pen) c.lineTo(bx + i * f, by + y); else c.moveTo(bx + i * f, by + y);
        pen = true;
      }
      c.stroke(); c.restore();
      c.fillStyle = S.col; c.fillRect(bx + 10, ly - 1, 14, 3);
      c.fillStyle = INK; c.fillText(S.name, bx + 30, ly); ly += Math.max(15, s / 24);
    }
    c.fillStyle = INK; c.textAlign = 'right'; c.fillText('now ← time', bx + s - 10, by + s - 12);
    c.textAlign = 'left';
    if (zoom) c.fillText(`scale ${(100 * lo / maxE).toFixed(1)} … ${(100 * hi / maxE).toFixed(1)} % of m g H`, bx + 10, by + s - 12);
  }

  const CODE_E = { lang: 'js', name: 'update_data', text:
    'var curr_energy_p = Ball.mass * G * (HEIGHT - Ball.y);\nenergy_p.unshift(curr_energy_p);\n\nvar curr_energy_k = 0.5 * Ball.mass * (Ball.vx * Ball.vx + Ball.vy * Ball.vy);\nenergy_k.unshift(curr_energy_k);\n\nenergy.unshift(curr_energy_p + curr_energy_k);' };
  const CODE_S = { lang: 'js', name: 'simulation', text:
    '// semi-Euler integration\nBall.vy += TIME_STEP * G;\n\nBall.x += TIME_STEP * Ball.vx;\nBall.y += TIME_STEP * Ball.vy;\n\nif (Ball.y > mycanvas.height || Ball.y < 0) {\n\tBall.vy = -Ball.vy;' };

  TMP.saver({
    canvas: canvasEl,
    bg: '#10131a',
    fit(w, h) {
      canvasEl(); dpr = Math.min(2, window.devicePixelRatio || 1);
      view.width = Math.round(w * dpr); view.height = Math.round(h * dpr);
      draw();
      return false;
    },
    shots: [
      { key: 'exchange', label: { title: 'Potential and Kinetic Energy', lines: ['The ball trades height for speed and back.', 'Green: potential. Blue: kinetic. Red: their sum.'], eq: ['Eₚ = m g (H − y)', 'Eₖ = ½ m v²', 'E = Eₚ + Eₖ'], code: CODE_E },
        run(k) { show({ p: 1, k: 1, e: 1 }); start(k.rng, {}); } },
      { key: 'drop', label: { title: 'A Straight Drop', lines: ['No side speed: the ball falls and bounces in place.', 'All of the energy goes from Eₚ to Eₖ and back.'], eq: ['Eₖ = m g h  at the floor', 'v = √(2 g h)'], code: CODE_E },
        run(k) { show({ p: 1, k: 1, e: 1 }); start(k.rng, { vx: 0, x0: 200 + 400 * k.rng(), y0: 40 * k.rng() }); } },
      { key: 'total', label: { title: 'Is Energy Conserved?', lines: ['Only the total is shown, on a zoomed scale.', 'The Euler step loses a little energy each frame: E drifts.'], eq: ['ΔE = −½ m g² Δt²  per step in free fall', 'Δt = 0.1'], code: CODE_S },
        run(k) { show({ e: 1 }); start(k.rng, { warm: 400 }); } },
      { key: 'coords', label: { title: 'Position over Time', lines: ['Blue: x, a zigzag at constant speed.', 'Red: y, parabolas between the bounces.'], eq: ['x = x₀ + vₓ t', 'y = y₀ + ½ g t²'], code: CODE_S },
        run(k) { show({ x: 1, y: 1 }); start(k.rng, {}); } },
    ],
    tick() { draw(); },
  });
})();

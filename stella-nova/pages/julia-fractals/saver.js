// Julia Fractals · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only sets its globals (canvas,
// centerX, centerY, scale, juliaX, juliaY, maxIters, drawMandelbrot,
// drawMono, redraw). draw() of main.js computes the image again when
// redraw is true.
TMP.page({ n: '19', title: 'Julia Fractals', file: '19-julia.html', video: 'asiFbvRKgRk', year: 2023, licence: 'MIT' });

(function () {
  // Shot state: a function of time that sets the view and c.
  let anim = null;
  // The view height in the complex plane at the start of a shot.
  const VIEW = 3.0;
  function set(o) {
    drawMandelbrot = !!o.mandel; drawMono = !!o.mono;
    if (o.iters) maxIters = o.iters;
  }
  const EQ = ['z ← z² + c', '|z| > 2 ⇒ escape'];
  const CODE = { lang: 'js', name: 'getNumIters', text: [
    'if (x1 * x1 + x2 * x2 > 4.0)',
    '\treturn iters;',
    'var x = x1;',
    'x1 = x1 * x1 - x2 * x2;',
    'x2 = 2.0 * x * x2;',
    'x1 += c1;',
    'x2 += c2;'].join('\n') };
  // A Mandelbrot zoom into a named point. Each run starts at a random
  // depth on the way down, so no two runs show the same frames.
  function zoom(key, name, x, y, to) {
    return { key, label: { title: name, lines: ['Mandelbrot set: c = the pixel, z₀ = 0.', 'Centre ' + x.toFixed(6) + (y < 0 ? ' − ' : ' + ') + Math.abs(y).toFixed(6) + 'i'], eq: ['z ← z² + c, z₀ = 0', 'c ∈ M ⇔ |z| stays ≤ 2'], code: CODE },
      run(c) {
        set({ mandel: true }); centerX = x; centerY = y; redraw = true;
        const s0 = VIEW / canvas.height, s1 = to * VIEW / canvas.height, u0 = 0.45 * c.rng();
        anim = (t, k) => {
          const u = Math.min(1, u0 + k * t / 50);
          scale = s0 * Math.pow(s1 / s0, u);
          maxIters = Math.round(150 + 60 * Math.log10(s0 / scale));
        };
      } };
  }
  // A slow zoom into a named Julia set, towards its repelling fixed point
  // beta = (1 + sqrt(1 - 4c)) / 2 (or -beta), which is on the set.
  function julia(key, name, cx, cy) {
    return { key, label: { title: name, lines: ['Julia set for c = ' + cx + (cy < 0 ? ' − ' : ' + ') + Math.abs(cy) + 'i.', 'A zoom towards the fixed point β, which is on the set.'], eq: ['z ← z² + c', 'β = (1 + √(1 − 4c)) / 2'], code: CODE },
      run(c) {
        set({ mono: c.rng() < 0.35, iters: 250 }); juliaX = cx; juliaY = cy; redraw = true;
        // sqrt(1 - 4c) in polar form.
        const ax = 1 - 4 * cx, ay = -4 * cy, r = Math.sqrt(Math.hypot(ax, ay)), ph = 0.5 * Math.atan2(ay, ax);
        const sg = c.rng() < 0.5 ? -1 : 1, bx = sg * 0.5 * (1 + r * Math.cos(ph)), by = sg * 0.5 * r * Math.sin(ph);
        const s0 = VIEW / canvas.height, deep = 0.01 + 0.03 * c.rng();
        anim = (t, k) => {
          const u = Math.min(1, k * t / 25), e = u * u * (3 - 2 * u);
          scale = s0 * Math.pow(deep, e);
          centerX = bx * e; centerY = by * e;
        };
      } };
  }
  TMP.saver({
    canvas: () => canvas,
    bg: '#000',
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h; redraw = true;
      return true;
    },
    // Bare text nodes of the upstream GUI ('Iterations') are not elements,
    // so the kit CSS does not hide them: make the body text transparent.
    enter() { document.body.style.color = 'transparent'; },
    shots: [
      { key: 'circle', label: { title: 'Julia Walk', lines: ['c moves on the circle |c| = 0.7885; each frame is a new Julia set.', 'Colour: the number of steps to escape; black stays bounded.'], eq: ['c = 0.7885 · e^{iθ}', 'z ← z² + c'], code: CODE },
        run(c) {
          set({ iters: 120 }); centerX = 0; centerY = 0; redraw = true;
          const th0 = c.rng() * 6.28, dir = c.rng() < 0.5 ? -1 : 1;
          anim = (t, k) => { const th = th0 + dir * 0.12 * k * t; juliaX = 0.7885 * Math.cos(th); juliaY = 0.7885 * Math.sin(th); scale = VIEW / canvas.height; };
        } },
      { key: 'cardioid', label: { title: 'Along the Cardioid', lines: ['c follows the edge of the main Mandelbrot cardioid.', 'Colour: the number of steps to escape.'], eq: ['c = e^{iθ}/2 − e^{2iθ}/4', 'z ← z² + c'], code: CODE },
        run(c) {
          set({ iters: 200 }); centerX = 0; centerY = 0; redraw = true;
          const th0 = c.rng() * 6.28, dir = c.rng() < 0.5 ? -1 : 1;
          anim = (t, k) => {
            const th = th0 + dir * 0.1 * k * t, r = 0.985;
            juliaX = r * (0.5 * Math.cos(th) - 0.25 * Math.cos(2 * th));
            juliaY = r * (0.5 * Math.sin(th) - 0.25 * Math.sin(2 * th));
            scale = VIEW / canvas.height;
          };
        } },
      zoom('seahorse', 'Seahorse Valley', -0.743643887037151, 0.131825904205330, 2e-9),
      zoom('bookmark', 'The Tutorial Bookmark', -0.8115734686602871, -0.20143013094290876, 3e-8),
      julia('rabbit', 'Douady Rabbit', -0.123, 0.745),
      julia('siegel', 'Siegel Disk', -0.390540870218, -0.586787907346),
    ],
    tick(dt, c) {
      if (!anim) return;
      anim(c.t, 1.15 - 0.6 * c.calm);
      redraw = true;
    },
  });
})();

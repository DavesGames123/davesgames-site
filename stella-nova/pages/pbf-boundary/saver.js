// PBF Boundaries · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals
// (physicsScene, setupScene, canvas, c, cScale, simMinWidth, simWidth,
// simHeight, mu_s, mu_k, e, use_velocity_pass).
TMP.page({ n: null, title: 'PBF Boundaries', file: 'contribs/PBFBoundary.html', video: null, year: 2021, licence: 'MIT', by: 'Sergii Biloshytskyi', from: 'Ukraine', holder: 'Matthias Müller' });

(function () {
  const S = physicsScene;
  // Shot state: container motion. shake = horizontal shake of the whole
  // container; tilt = a turning gravity vector (a rotating drum).
  let shake = null, tilt = null, off = 0;
  // The draw() of main.js strokes the container with the default stroke
  // colour (black). On the dark saver background it gets a light grey.
  // A canvas resize resets the context, so set it after each resize.
  function ink() { c.strokeStyle = '#c8ccd4'; }
  function start(o) {
    mu_s = o.mus; mu_k = o.muk; e = o.e != null ? o.e : 0.2;
    use_velocity_pass = !!o.vel;
    S.numColumns = o.cols || 25; S.numRows = o.rows || 25;
    S.gravity.x = 0; S.gravity.y = -9.81;
    shake = null; tilt = null; off = 0;
    setupScene();
    S.paused = false;
    ink();
  }
  // Move the container and its disks together by dx (sim units).
  function shift(dx) {
    S.boundaryCenter.x += dx;
    for (const b of S.boundaries) b.pos.x += dx;
  }
  function warm(n) { for (let k = 0; k < n; k++) simulate(); }
  const EQ = ['C = |x − c| − r ≥ 0', '|Δx_t| < μ_s d ⇒ stick', 'Δx_t ← min(μ_k d / |Δx_t|, 1)·Δx_t'];
  const CODE_FRICT = { lang: 'js', name: 'calcFriction', text: [
    'if (dp_t_len < mu_s * dist) {',
    '    frict.x = dp_t.x;',
    '    frict.y = dp_t.y;',
    '}',
    'else {',
    '    var k = mu_k == 0 ? 0 : Math.min(mu_k * dist / dp_t_len, 1);'].join('\n') };
  const CODE_REST = { lang: 'js', name: 'velocityUpdate', text: [
    'var v_prev_n = vprev.dot(n);',
    'var restitution_x = n.x * (-vn + Math.max(-e * v_prev_n, 0.0));',
    'var restitution_y = n.y * (-vn + Math.max(-e * v_prev_n, 0.0));'].join('\n') };
  TMP.saver({
    canvas: () => canvas,
    bg: '#0b0d12',
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      // setupGlobals of main.js, for a w x h canvas.
      canvas.width = w; canvas.height = h; simMinWidth = 2.0;
      cScale = Math.min(w, h) / simMinWidth; simWidth = w / cScale; simHeight = h / cScale;
      ink();
      return true;
    },
    // Bare text nodes of the upstream GUI ('mu_s:', 'Columns:') are not
    // elements, so the kit CSS does not hide them: make the body text
    // transparent.
    enter() { document.body.style.color = 'transparent'; },
    shots: [
      { key: 'mixer', label: { title: 'Rotating Boundaries', lines: ['625 particles in a round container; five disks turn at 120°/s.'], eq: EQ, code: CODE_FRICT },
        run(c) { start({ mus: 0.2, muk: 0.2 }); warm(20); } },
      { key: 'slip', label: { title: 'No Friction', lines: ['μ_s = μ_k = 0: the particles slide like a liquid.'], eq: ['μ_s = 0, μ_k = 0', 'Δx_t = 0'], code: CODE_FRICT },
        run(c) { start({ mus: 0, muk: 0, cols: 30, rows: 30 }); warm(20); } },
      { key: 'sticky', label: { title: 'High Friction', lines: ['μ_s = μ_k = 0.9: the pile sticks to the disks and avalanches.'], eq: ['μ_s = 0.9, μ_k = 0.9', '|Δx_t| < μ_s d ⇒ stick'], code: CODE_FRICT },
        run(c) { start({ mus: 0.9, muk: 0.9 }); warm(20); } },
      { key: 'bounce', label: { title: 'Restitution', lines: ['Velocity pass on, e = 0.9: contacts give energy back.'], eq: ['v_n ← −e · v_n,prev', 'Δv_t = −min(h μ_k f_n, |v_t|)'], code: CODE_REST },
        run(c) { start({ mus: 0.1, muk: 0.1, e: 0.9, vel: true, cols: 18, rows: 18 }); warm(10); } },
      { key: 'drum', label: { title: 'Rotating Drum', lines: ['Gravity turns slowly; the particles roll over like a tumbler.'], eq: ['g(t) = 9.81 (sin ωt, −cos ωt)'], code: CODE_FRICT },
        run(c) { start({ mus: 0.4 + 0.4 * c.rng(), muk: 0.4 }); tilt = { w: (c.rng() < 0.5 ? -1 : 1) * (0.5 + 0.3 * c.rng()) }; warm(20); } },
      { key: 'shake', label: { title: 'Shaken Container', lines: ['The container and its disks shake side to side.'], eq: ['x_c(t) = A sin 2πft'], code: CODE_FRICT },
        run(c) { start({ mus: 0.1 + 0.3 * c.rng(), muk: 0.1 }); shake = { a: 0.06 + 0.04 * c.rng(), f: 1.2 + 0.6 * c.rng() }; warm(10); } },
    ],
    tick(dt, c) {
      const k = 1.15 - 0.6 * c.calm;
      if (tilt) { const a = tilt.w * k * c.t; S.gravity.x = 9.81 * Math.sin(a); S.gravity.y = -9.81 * Math.cos(a); }
      if (shake) { const x = shake.a * Math.sin(2 * Math.PI * shake.f * k * c.t); shift(x - off); off = x; }
    },
  });
})();

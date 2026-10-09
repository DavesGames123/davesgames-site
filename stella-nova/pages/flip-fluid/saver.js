// FLIP Water · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (scene,
// setupScene, setObstacle, canvas, cScale, simWidth, simHeight,
// gridVertBuffer).
TMP.page({ n: '18', title: 'FLIP Water', file: '18-flip.html', video: 'XmzBREkK8kY', year: 2022, licence: 'MIT' });

(function () {
  // Shot state: the obstacle path. Positions are fractions of the tank
  // (0..1 in x and y); tick converts them to sim units.
  let path = null;
  // Upstream defaults for the switches that a shot can change.
  function reset(o) {
    scene.flipRatio = o.flip != null ? o.flip : 0.9;
    scene.showGrid = !!o.grid; scene.showParticles = !o.noParticles;
    scene.compensateDrift = true; scene.separateParticles = true;
    scene.paused = false;
  }
  // Particle cap. setupScene fills 60% of the tank width at 100 cells per
  // tank height, so a wide saver band gives 60k particles and 20 fps.
  // A cut at a whole column keeps a narrower water block of the same height.
  const CAP = 24000;
  let depth = 0.4;   // rest water depth as a fraction of the tank height
  function start(o) {
    reset(o);
    setupScene();
    // The grid buffer holds the cell centres of the first tank: a new
    // tank size needs a new buffer.
    gridVertBuffer = null;
    const f = scene.fluid, r = f.particleRadius, x0 = f.particlePos[0];
    let ny = 1; while (ny < f.numParticles && Math.abs(f.particlePos[2 * ny] - x0) < 1.5 * r) ny++;
    if (f.numParticles > CAP) f.numParticles = Math.floor(CAP / ny) * ny;
    // Hexagonal packing: one particle per 2r x sqrt(3) r.
    depth = Math.min(0.8, f.numParticles * 2 * r * Math.sqrt(3) * r / (simWidth - 2 * f.h) / simHeight);
  }
  // Run the sim ahead with the obstacle on its path, so a shot opens on
  // moving water and not on the initial block.
  function warm(n, c) { for (let k = 0; k < n; k++) { c.t += scene.dt; place(c); simulate(); } c.t = 0; }
  function place(c) {
    if (!path || !scene.fluid) return;
    const s = (1.15 - 0.6 * c.calm) * path.speed, t = Math.max(0, c.t - (path.delay || 0)) * s * 2 * Math.PI;
    const r = scene.obstacleRadius / simWidth, ry = scene.obstacleRadius / simHeight;
    let x = path.cx + path.ax * Math.sin(path.fx * t + path.ph);
    let y = path.cy * (path.rel ? depth : 1) + path.ay * (path.rel ? depth : 1) * Math.sin(path.fy * t + path.py);
    x = Math.min(1 - 2 * r, Math.max(2 * r, x)); y = Math.min(1 - 2 * ry, Math.max(2 * ry, y));
    setObstacle(x * simWidth, y * simHeight, false);
  }
  const EQ = ['∇·u = 0', 'v ← (1−α)·v_PIC + α·v_FLIP'];
  const CODE_PIC = { lang: 'js', name: 'transferVelocities', text: 'this.particleVel[2 * i + component] = (1.0 - flipRatio) * picV + flipRatio * flipV;' };
  const CODE_DIV = { lang: 'js', name: 'solveIncompressibility', text: [
    'var div = this.u[right] - this.u[center] + ',
    '\tthis.v[top] - this.v[center];',
    'var p = -div / s;',
    'p *= overRelaxation;',
    'this.u[center] -= sx0 * p;',
    'this.u[right] += sx1 * p;'].join('\n') };
  TMP.saver({
    canvas: () => canvas,
    bg: '#000',
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h; simHeight = 3.0;
      cScale = canvas.height / simHeight; simWidth = canvas.width / cScale;
      return true;
    },
    // Bare text nodes of the upstream GUI are not elements, so the kit
    // CSS does not hide them: make the body text transparent.
    enter() { document.body.style.color = 'transparent'; },
    shots: [
      { key: 'dam', label: { title: 'Dam Break', lines: ['A block of water falls; then the red disc dives in.'], eq: EQ, code: CODE_DIV },
        run(c) { start({}); path = { cx: 0.8, cy: 0.75, ax: 0.12, ay: 0.4, fx: 0.15, fy: 0.21, ph: c.rng() * 6, py: Math.PI / 2, speed: 1, delay: 2.5 }; } },
      { key: 'stir', label: { title: 'Stirring the Pool', lines: ['Particles carry the water; a grid enforces zero divergence.'], eq: EQ, code: CODE_DIV },
        run(c) { start({}); path = { cx: 0.5, cy: 0.55, rel: 1, ax: 0.3 + 0.1 * c.rng(), ay: 0.35, fx: 0.17, fy: 0.34, ph: c.rng() * 6, py: 0, speed: 1 }; warm(30, c); } },
      { key: 'paddle', label: { title: 'Wave Paddle', lines: ['The disc sweeps through the surface and raises waves.'], eq: EQ },
        run(c) { start({}); path = { cx: 0.5, cy: 0.95, rel: 1, ax: 0.42, ay: 0.12, fx: 0.22 + 0.06 * c.rng(), fy: 0.44, ph: c.rng() * 6, py: 0, speed: 1 }; warm(30, c); } },
      { key: 'pic', label: { title: 'PIC: Damped Water', lines: ['FLIP ratio 0: pure grid velocities.', 'Numerical viscosity makes the water thick.'], eq: ['α = 0', 'v ← v_PIC'], code: CODE_PIC },
        run(c) { start({ flip: 0 }); path = { cx: 0.5, cy: 0.6, rel: 1, ax: 0.35, ay: 0.4, fx: 0.2, fy: 0.3, ph: c.rng() * 6, py: 0, speed: 1 }; warm(30, c); } },
      { key: 'grid', label: { title: 'The Grid View', lines: ['Cells coloured by particle density; grey cells are solid.'], eq: ['ρ_cell / ρ₀', '∇·u = k (ρ − ρ₀)'] },
        run(c) { start({ grid: true, noParticles: true }); path = { cx: 0.5, cy: 0.6, rel: 1, ax: 0.32, ay: 0.4, fx: 0.18, fy: 0.27, ph: c.rng() * 6, py: 0, speed: 1 }; warm(30, c); } },
    ],
    tick(dt, c) { place(c); },
  });
})();

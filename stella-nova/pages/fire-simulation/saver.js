// Fire Simulation · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (scene,
// Fluid, setObstacle, canvas, cScale).
TMP.page({ n: '21', title: 'Fire Simulation', file: '21-fire.html', video: 'RsgmS3ZxDtc', year: 2022, licence: 'MIT' });

(function () {
  // Shot state: the burner path. Positions are fractions of the domain
  // (0..1 in x and y); tick converts them to sim units.
  let path = null;
  // The setupScene of main.js reads the window size. This is the same
  // code for a w x h canvas: 100000 cells, a 1.0-high domain.
  function build(w, h) {
    canvas.width = w; canvas.height = h;
    const simHeight = 1.0;
    cScale = canvas.height / simHeight;
    const simWidth = canvas.width / cScale;
    const numCells = 100000;
    const ch = Math.sqrt(simWidth * simHeight / numCells);
    const numX = Math.floor(simWidth / ch), numY = Math.floor(simHeight / ch);
    if (numX < numY) { scene.swirlProbability = 80.0; scene.swirlMaxRadius = 0.04; }
    else { scene.swirlMaxRadius = 0.05; }
    scene.obstacleX = 0.5 * numX * ch; scene.obstacleY = 0.3 * numY * ch;
    scene.fluid = new Fluid(numX, numY, ch);
  }
  const dom = () => ({ w: (scene.fluid.numX - 1) * scene.fluid.h, h: (scene.fluid.numY - 1) * scene.fluid.h });
  // A new, cold domain with the switches of one shot.
  function start(o) {
    build(canvas.width, canvas.height);
    scene.burningObstacle = o.ring !== false; scene.burningFloor = !!o.floor;
    scene.showSwirls = !!o.swirls; scene.swirlProbability = o.prob != null ? o.prob : 50;
    scene.obstacleRadius = o.r || 0.13; scene.paused = false;
  }
  function place(c) {
    if (!path || !scene.fluid) return;
    const s = (1.15 - 0.6 * c.calm) * path.speed, t = c.t * s * 2 * Math.PI, d = dom();
    const x = path.cx + path.ax * Math.sin(path.fx * t + path.ph);
    const y = path.cy + path.ay * Math.sin(path.fy * t + path.py);
    setObstacle(x * d.w, y * d.h, false);
    scene.showObstacle = path.show !== false;
  }
  // Run the sim ahead so a shot opens on flames, not on a cold domain.
  function warm(n, c) { for (let k = 0; k < n; k++) { c.t += scene.dt; place(c); scene.fluid.simulate(scene.dt, scene.gravity, scene.numIters); } c.t = 0; }
  const EQ = ['∂T/∂t + (u·∇)T = −k', 'Δv = (T·lift − v)·a', '∇·u = 0'];
  const CODE_BURN = { lang: 'js', name: 'updateFire', text: [
    'let cooling = t < 0.3 ? smokeCooling : fireCooling;',
    'this.t[i*n + j] = Math.max(t - cooling, 0.0);',
    'let u = this.u[i*n + j];',
    'let v = this.v[i*n + j];',
    'let targetV = t * lift;',
    'this.v[i*n + j] += (targetV - v) * acceleration;'].join('\n') };
  const CODE_SWIRL = { lang: 'js', name: 'updateFire', text: [
    'let nr = this.numSwirls;',
    'this.swirlX[nr] = i * h;',
    'this.swirlY[nr] = j * h;',
    'this.swirlOmega[nr] = (-1.0 + 2.0 * Math.random()) * swirlOmega;',
    'this.swirlTime[nr] = swirlTimeSpan;',
    'this.numSwirls++;'].join('\n') };
  TMP.saver({
    canvas: () => canvas,
    bg: '#000',
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      build(w, h);
      return true;
    },
    // Bare text nodes of the upstream GUI are not elements, so the kit
    // CSS does not hide them: make the body text transparent.
    enter() { document.body.style.color = 'transparent'; },
    shots: [
      { key: 'ring', label: { title: 'Burning Ring', lines: ['Hot cells rise with buoyancy, cool and turn to smoke.'], eq: EQ, code: CODE_BURN },
        run(c) { start({}); path = { cx: 0.5, cy: 0.3, ax: 0.3, ay: 0.06, fx: 0.11 + 0.04 * c.rng(), fy: 0.19, ph: c.rng() * 6, py: 0, speed: 1 }; warm(70, c); } },
      { key: 'floor', label: { title: 'Burning Floor', lines: ['The whole floor burns; an unlit ring stirs the air.'], eq: EQ, code: CODE_BURN },
        run(c) { start({ ring: false, floor: true }); path = { cx: 0.5, cy: 0.35, ax: 0.38, ay: 0.15, fx: 0.15, fy: 0.27, ph: c.rng() * 6, py: 0, speed: 1.2 }; warm(70, c); } },
      { key: 'swirls', label: { title: 'Swirls', lines: ['Random vortices start in the flame and decay in one second.', 'Circles show each swirl.'], eq: ['ω ∈ [−20, 20] rad/s', 'τ = 1 s'], code: CODE_SWIRL },
        run(c) { start({ swirls: true, prob: 100 }); path = { cx: 0.5, cy: 0.3, ax: 0.15, ay: 0.04, fx: 0.08, fy: 0.13, ph: c.rng() * 6, py: 0, speed: 1 }; warm(70, c); } },
      { key: 'laminar', label: { title: 'No Swirls', lines: ['Swirl probability 0: a smooth, laminar plume.'], eq: ['p_swirl = 0', 'Δv = (T·lift − v)·a'], code: CODE_BURN },
        run(c) { start({ prob: 0 }); path = { cx: 0.5, cy: 0.3, ax: 0.25, ay: 0.05, fx: 0.07, fy: 0.11, ph: c.rng() * 6, py: 0, speed: 1 }; warm(70, c); } },
      { key: 'blaze', label: { title: 'Ring over Fire', lines: ['The floor and a fast ring both burn.'], eq: EQ, code: CODE_BURN },
        run(c) { start({ floor: true, r: 0.1 }); path = { cx: 0.5, cy: 0.45, ax: 0.38, ay: 0.2, fx: 0.23, fy: 0.37, ph: c.rng() * 6, py: 0, speed: 1 }; warm(70, c); } },
    ],
    tick(dt, c) { place(c); },
  });
})();

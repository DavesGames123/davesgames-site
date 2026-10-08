// Euler Fluid · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (scene,
// setupScene, setObstacle, canvas, cScale, simWidth, simHeight).
TMP.page({ n: '17', title: 'Euler Fluid', file: '17-fluidSim.html', video: 'iKAVRgIrUOU', year: 2022, licence: 'MIT' });

(function () {
  // Shot state: the obstacle path. x0..x1 and y0..y1 in sim units.
  let path = null;
  function view(o) {
    scene.showPressure = !!o.pressure; scene.showSmoke = !!o.smoke;
    scene.showStreamlines = !!o.stream; scene.showVelocities = false;
  }
  // Run the sim ahead so a shot opens on a developed flow, not on an empty
  // tunnel. setObstacle each step keeps the disc on its path.
  function warm(n) { for (let k = 0; k < n; k++) { scene.fluid.simulate(scene.dt, scene.gravity, scene.numIters); scene.frameNr++; } }
  const domainW = () => 1.0 / simHeight * simWidth;
  const EQ = ['∇·u = 0', '∂u/∂t + (u·∇)u = −∇p/ρ + g'];
  TMP.saver({
    canvas: () => canvas,
    bg: '#000',
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      // simHeight 1.0: the 1.0-high domain fills the band (upstream 1.1
      // leaves a strip for the text line).
      canvas.width = w; canvas.height = h; simHeight = 1.0;
      cScale = canvas.height / simHeight; simWidth = canvas.width / cScale;
      return true;
    },
    shots: [
      { key: 'tunnel', label: { title: 'Wind Tunnel', lines: ['Smoke shows vortex shedding behind a moving disc.'], eq: EQ },
        run(c) { setupScene(1); view({ smoke: true, stream: c.rng() < 0.4 }); path = { ax: 0.12, ay: 0.18, fx: 0.11, fy: 0.23, cx: 0.35 + 0.15 * c.rng(), ph: c.rng() * 6 }; warm(90); } },
      // Upstream "Hires Tunnel" (200 cells high, 100 iterations) is too slow
      // at band width for a saver: frames took seconds in headless Chrome.
      // The pressure view of the 100-cell tunnel shows the same field.
      { key: 'pressure', label: { title: 'Pressure Around a Moving Disc', lines: ['Red is high pressure, blue is low, behind a disc in a wind tunnel.'], eq: EQ },
        run(c) { setupScene(1); view({ pressure: true, stream: c.rng() < 0.5 }); path = { ax: 0.1, ay: 0.16, fx: 0.09, fy: 0.19, cx: 0.4 + 0.1 * c.rng(), ph: c.rng() * 6 }; warm(60); } },
      { key: 'tank', label: { title: 'Pressure in a Tank', lines: ['Gravity on: hydrostatic pressure rises with depth.'], eq: ['p = ρ g h', '∇·u = 0'] },
        run(c) { setupScene(0); view({ pressure: true }); path = { ax: 0.3 * domainW(), ay: 0.25, fx: 0.13, fy: 0.21, cx: 0.5 * domainW(), cy: 0.45, ph: c.rng() * 6 }; } },
      { key: 'paint', label: { title: 'Paint', lines: ['A moving disc stirs coloured smoke; overrelaxation off.'], eq: EQ },
        run(c) { setupScene(2); view({ smoke: true }); path = { ax: 0.38 * domainW(), ay: 0.32, fx: 0.17 + 0.05 * c.rng(), fy: 0.29, cx: 0.5 * domainW(), cy: 0.5, ph: c.rng() * 6 }; } },
    ],
    tick(dt, c) {
      if (!path || !scene.fluid) return;
      const s = 1.15 - 0.6 * c.calm, t = c.t * s * 2 * Math.PI;
      const x = path.cx + path.ax * Math.sin(path.fx * t + path.ph);
      const y = (path.cy || 0.5) + path.ay * Math.sin(path.fy * t);
      setObstacle(x, y, false);
    },
  });
})();

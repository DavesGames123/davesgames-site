// Pendulum in 100 Lines · site layer: the credit record and the screensaver
// shots. main.js is the upstream demo; this file only calls its globals
// (canvas, cScale, cY, scene, Pendulum).
TMP.page({ n: '06', title: 'Pendulum in 100 Lines', file: '06-pendulumShort.html', video: 'XPZEeS70zzU', year: 2021, licence: 'MIT' });

(function () {
  // Each shot starts a new pendulum from a seeded random state: link count,
  // lengths, masses and start angles. So each run is a new chaotic path.
  let reach = 0.6;   // sum of the link lengths of the current pendulum
  // straight: the links start near one line (a chain held out to the side),
  // not folded back over the pivot.
  function build(c, masses, lengths, straight) {
    const s = c.rng() < 0.5 ? -1 : 1, a0 = s * (0.35 + 0.55 * c.rng()) * Math.PI;
    const angles = lengths.map((l, i) => i === 0 ? a0 : straight ? a0 + (c.rng() - 0.5) * 0.5 : Math.PI + (c.rng() - 0.5) * 0.7);
    scene.pendulum = new Pendulum(masses, lengths, angles);
    scene.dt = 0.01 * (1.3 - 0.6 * c.calm);
    reach = lengths.reduce((a, b) => a + b, 0) + 0.05 * Math.sqrt(Math.max(...masses));
    fitScale();
  }
  // The pendulum circle (radius = reach) fills 92 % of the shorter side.
  function fitScale() { cScale = 0.46 * Math.min(canvas.width, canvas.height) / reach; }
  const U = (c, a, b) => a + (b - a) * c.rng();
  const many = (c, n, a, b) => Array.from({ length: n }, () => U(c, a, b));
  const EQ = ['v ← v + Δt g,  x_prev ← x,  x ← x + Δt v', 'x ← x + w C n / Σw  (each link)', 'v ← (x − x_prev) / Δt'];
  const CODE = { lang: 'js', name: 'simulate', text: [
    'var dx = p.pos[i].x - p.pos[i-1].x;',
    'var dy = p.pos[i].y - p.pos[i-1].y;',
    'var d = Math.sqrt(dx * dx + dy * dy);',
    'var w0 = p.masses[i - 1] > 0.0 ? 1.0 / p.masses[i - 1] : 0.0;',
    'var w1 = p.masses[i] > 0.0 ? 1.0 / p.masses[i] : 0.0;',
    'var corr = (p.lengths[i] - d) / d / (w0 + w1);'].join('\n') };

  TMP.saver({
    canvas: () => canvas,
    bg: '#000',
    enter() {
      // Put the pivot at the centre of the band (upstream: 0.4 of the
      // height), so the pendulum can swing up without leaving the frame.
      cY = function (pos) { return 0.5 * canvas.height - pos.y * cScale; };
    },
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      fitScale();
      return false;
    },
    shots: [
      { key: 'triple', label: { title: 'Triple Pendulum', lines: ['The complete simulation in about a hundred lines:', 'predict, correct each link, update the velocity.'], eq: EQ, code: CODE },
        run(c) { build(c, [1.0, 0.5, 0.3].map(m => m * U(c, 0.7, 1.3)), [0.2, 0.2, 0.2]); } },
      { key: 'double', label: { title: 'Double Pendulum', lines: ['Two links are enough for chaos.'], eq: EQ },
        run(c) { build(c, many(c, 2, 0.3, 1.0), many(c, 2, 0.2, 0.3)); } },
      { key: 'chain', label: { title: 'A Chain', lines: ['The same loop with more links: a heavy chain.', 'PBD keeps every link at its length.'], eq: EQ, code: CODE },
        run(c) { const n = 5 + Math.floor(c.rng() * 5); build(c, many(c, n, 0.2, 0.5), many(c, n, 0.07, 0.11), true); } },
      { key: 'ratio', label: { title: 'Light and Heavy', lines: ['Masses from 0.05 to 1: a light bob whips', 'around its heavy neighbours.'], eq: ['w = 1 / m', 'Δx₀ : Δx₁ = w₀ : w₁'] },
        run(c) { build(c, many(c, 3, 0, 1).map(u => Math.pow(20, -u)), many(c, 3, 0.15, 0.25)); } },
    ],
  });
})();

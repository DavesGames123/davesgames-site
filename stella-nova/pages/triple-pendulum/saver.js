// Triple Pendulum · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (canvas,
// cScale, cY, scene, sceneNr, setupScene, Pendulum).
TMP.page({ n: '06', title: 'Triple Pendulum', file: '06-pendulum.html', video: 'XPZEeS70zzU', year: 2021, licence: 'MIT' });

(function () {
  // Each shot starts a new pendulum from a seeded random state: a preset of
  // the demo (lengths and masses), masses scaled by 0.7..1.3 and start
  // angles near the upright position. So each run is a new chaotic path.
  let reach = 0.5;   // sum of the link lengths of the current pendulum
  function build(c, o) {
    sceneNr = o.preset; setupScene();
    const P = scene.pendulumPBD;
    const lengths = P.lengths.slice(1);
    const masses = P.masses.slice(1).map(m => m * (o.jitter === false ? 1 : 0.7 + 0.6 * c.rng()));
    const s = c.rng() < 0.5 ? -1 : 1;
    const angles = lengths.map((l, i) => i === 0 ? s * (0.35 + 0.55 * c.rng()) * Math.PI : Math.PI + (c.rng() - 0.5) * 0.6);
    scene.pendulumPBD = new Pendulum(true, '#FF3030', masses, lengths, angles);
    scene.pendulumAnalytic = null;
    if (o.twin) {
      // A second PBD pendulum, the first angle 10⁻⁴ rad off. It uses the
      // analytic slot, so draw() and simulate() handle it.
      const a2 = angles.slice(); a2[0] += 1e-4;
      scene.pendulumAnalytic = new Pendulum(true, '#30A0FF', masses, lengths, a2);
    } else if (masses.length <= 3) {
      scene.pendulumAnalytic = new Pendulum(false, '#00FF00', masses, lengths, angles);
    }
    scene.numSubSteps = o.steps || 10000;
    scene.dt = 0.01 * (1.3 - 0.6 * c.calm);
    reach = lengths.reduce((a, b) => a + b, 0) + 0.03 * Math.sqrt(Math.max(...masses));
    fitScale();
    scene.paused = false;
  }
  // The pendulum circle (radius = reach) fills 92 % of the shorter side.
  function fitScale() { cScale = 0.46 * Math.min(canvas.width, canvas.height) / reach; }
  const pick = (c, a) => a[Math.floor(c.rng() * a.length)];
  const EQ = ['C = |x₁ − x₀| − l', 'Δxᵢ = ∓ wᵢ C n / (w₀ + w₁),  w = 1/m', 'v = (x − x_prev) / Δt'];
  const CODE = { lang: 'js', name: 'simulatePBD', text: [
    'var w0 = p.masses[i - 1] > 0.0 ? 1.0 / p.masses[i - 1] : 0.0;',
    'var w1 = p.masses[i] > 0.0 ? 1.0 / p.masses[i] : 0.0;',
    'var corr = (p.lengths[i] - d) / d / (w0 + w1);',
    'p.pos[i - 1].x -= w0 * corr * dx; ',
    'p.pos[i - 1].y -= w0 * corr * dy; ',
    'p.pos[i].x += w1 * corr * dx; ',
    'p.pos[i].y += w1 * corr * dy; '].join('\n') };

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
      // The trails hold canvas px: clear them at the new scale. The shot
      // goes on with no restart.
      for (const P of [scene.pendulumPBD, scene.pendulumAnalytic]) if (P) P.trailFirst = P.trailLast;
      return false;
    },
    shots: [
      { key: 'analytic', label: { title: 'PBD against the Analytic Solution', lines: ['Red: position based dynamics, 10 000 substeps. Green: the analytic triple pendulum.', 'They agree until the chaos makes them part.'], eq: EQ, code: CODE },
        run(c) { build(c, { preset: pick(c, [0, 1, 2, 3, 4]) }); } },
      { key: 'butterfly', label: { title: 'Two Pendulums, 10⁻⁴ rad Apart', lines: ['Red and blue: the same PBD pendulum, the start angles 0.0001 rad apart.', 'The small difference grows until the paths are not related.'], eq: ['|δθ(t)| ≈ |δθ₀| e^{λ t}', 'λ > 0: chaos'] },
        run(c) { build(c, { preset: pick(c, [0, 1, 4]), twin: true }); } },
      { key: 'five', label: { title: 'Five Links', lines: ['No analytic solution here: PBD only.', 'The same code solves a chain of any length.'], eq: EQ, code: CODE },
        run(c) { build(c, { preset: 5 }); } },
      { key: 'substeps', label: { title: 'Few Substeps', lines: ['1, 5 or 10 substeps per frame. PBD stays stable with large steps.', 'The analytic solver is hidden below 100 substeps.'], eq: ['Δt_sub = Δt / n'] },
        run(c) { build(c, { preset: pick(c, [0, 1, 2, 3, 4]), steps: pick(c, [1, 5, 10]) }); } },
      { key: 'masses', label: { title: 'Uneven Masses', lines: ['A light middle mass or light ends: the demo presets.', 'The mass ratio changes the motion completely.'], eq: EQ },
        run(c) { build(c, { preset: pick(c, [2, 3]) }); } },
    ],
  });
})();

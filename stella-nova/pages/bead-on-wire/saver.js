// Bead on a Wire · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (canvas, c,
// cScale, simMinWidth, simWidth, simHeight, physicsScene, Vector2,
// setupScene, run).
TMP.page({ n: '05', title: 'Bead on a Wire', file: '05-bead.html', video: 'qISgdDhdCro', year: 2021, licence: 'MIT' });

(function () {
  const ps = physicsScene;
  // The demo clears its canvas to transparent and strokes the wire in the
  // default black. The saver puts the canvas on a dark page and strokes the
  // wire in light grey, so the plate text stays readable.
  const WIRE = '#c8ccd6';
  // Start the bead at angle a (0 = bottom of the wire) with tangential
  // speed v. The PBD bead and the analytic bead get the same state.
  function place(a, v) {
    const R = ps.wireRadius, o = ps.wireCenter, b = ps.bead, ab = ps.analyticBead;
    b.pos = new Vector2(o.x + R * Math.sin(a), o.y - R * Math.cos(a));
    b.prevPos = b.pos.clone();
    b.vel = new Vector2(v * Math.cos(a), v * Math.sin(a));
    ab.angle = a; ab.omega = v / R;
  }
  // A new scene: wire radius R (sim units, the shorter side is 2.0), the
  // substep count n, gravity g.
  function scene(c, o) {
    setupScene();
    ps.wireRadius = o.R; ps.analyticBead.radius = o.R;
    ps.numSteps = o.n; ps.gravity.y = -o.g;
    ps.dt = (1 / 60) * (1.25 - 0.6 * c.calm);
    place(o.a, o.v || 0);
    run();
  }
  const sign = c => (c.rng() < 0.5 ? -1 : 1);
  const EQ = ['x ← x + Δt·v,  x ← c + R·(x − c)/|x − c|', 'v = (x − x_prev)/Δt'];
  const CODE = { lang: 'js', name: 'keepOnWire', text: [
    'dir.subtractVectors(this.pos, center);',
    'var len = dir.length();',
    'if (len == 0.0)',
    '\treturn;',
    'dir.scale(1.0 / len);',
    'var lambda = physicsScene.wireRadius - len;',
    'this.pos.add(dir, lambda);',
    'return lambda;'].join('\n') };

  TMP.saver({
    canvas: () => canvas,
    bg: '#0b0e14',
    enter() {
      // The PBD and analytic force read-outs are bare text in <body>, which
      // kit.css does not hide. Make the body text transparent.
      document.body.style.color = 'transparent';
    },
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      cScale = Math.min(w, h) / simMinWidth;
      simWidth = w / cScale; simHeight = h / cScale;
      // Move the wire to the new centre and the bead with it: the shot goes
      // on with no restart. The analytic bead is relative to the centre.
      const o = ps.wireCenter, dx = simWidth / 2 - o.x, dy = simHeight / 2 - o.y;
      o.x += dx; o.y += dy;
      if (ps.bead) { const d = new Vector2(dx, dy); ps.bead.pos.add(d); ps.bead.prevPos.add(d); }
      return false;
    },
    shots: [
      { key: 'drop', label: { title: 'Released from Rest', lines: ['Red: PBD bead, 1000 substeps. Green: the analytic solution.', 'The two beads stay on top of each other.'], eq: EQ, code: CODE },
        run(c) { scene(c, { R: 0.8, n: 1000, g: 10, a: sign(c) * (0.35 + 0.6 * c.rng()) * Math.PI }); } },
      { key: 'loop', label: { title: 'Looping the Wire', lines: ['A start speed above 2√(gR) carries the bead over the top.', 'The wire pushes in or pulls out: the force changes sign.'], eq: ['v₀ > 2√(g R)', 'F = m ω² R + m g cos θ'] },
        run(c) { const R = 0.6 + 0.2 * c.rng(); scene(c, { R, n: 1000, g: 10, a: c.rng() * 2 * Math.PI, v: sign(c) * (2.15 + 0.5 * c.rng()) * Math.sqrt(10 * R) }); } },
      { key: 'small', label: { title: 'Small Swings', lines: ['Near the bottom the bead is a simple pendulum.'], eq: ['T = 2π √(R / g)', 'θ̈ = −(g / R) sin θ'] },
        run(c) { scene(c, { R: 0.5 + 0.35 * c.rng(), n: 1000, g: 10, a: sign(c) * (0.15 + 0.15 * c.rng()) * Math.PI }); } },
      { key: 'substeps', label: { title: 'One Step per Frame', lines: ['With one PBD step per frame the red bead loses energy.', 'The analytic green bead keeps its swing.'], eq: EQ, code: CODE },
        run(c) { scene(c, { R: 0.8, n: 1, g: 10, a: sign(c) * (0.45 + 0.35 * c.rng()) * Math.PI }); } },
    ],
    tick() { c.strokeStyle = WIRE; },
  });
})();

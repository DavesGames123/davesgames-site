// Many Beads · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (canvas, c,
// cScale, simMinWidth, simWidth, simHeight, physicsScene, Vector2, Bead).
TMP.page({ n: '05', title: 'Many Beads', file: '05-manyBeads.html', video: 'qISgdDhdCro', year: 2021, licence: 'MIT' });

(function () {
  const ps = physicsScene;
  // The demo clears its canvas to transparent and strokes the wire in the
  // default black. The saver puts the canvas on a dark page and strokes the
  // wire in light grey, so the plate text stays readable.
  const WIRE = '#c8ccd6';
  // A new ring of beads. radii: the bead radii in sim units; a0: the angle
  // of the first bead (0 = right, counter-clockwise); kick: the largest
  // random tangential speed. Mass = π r², as in setupScene. The beads are
  // put side by side along the wire with a small gap, so none overlap.
  function ring(c, o) {
    ps.wireCenter.x = simWidth / 2; ps.wireCenter.y = simHeight / 2;
    ps.wireRadius = simMinWidth * 0.4;
    ps.gravity.y = -o.g;
    ps.dt = (1 / 60) * (1.25 - 0.6 * c.calm);
    const R = ps.wireRadius, o2 = ps.wireCenter;
    ps.beads = [];
    let a = o.a0;
    for (let i = 0; i < o.radii.length; i++) {
      const r = o.radii[i];
      if (i > 0) a += (o.radii[i - 1] + r) / R + (o.gap || 0.01);
      const b = new Bead(r, Math.PI * r * r, new Vector2(o2.x + R * Math.cos(a), o2.y + R * Math.sin(a)));
      const v = (o.kick || 0) * (2 * c.rng() - 1);
      b.vel = new Vector2(-v * Math.sin(a), v * Math.cos(a));
      ps.beads.push(b);
    }
  }
  const radii = (c, n, r0, r1) => Array.from({ length: n }, () => r0 + (r1 - r0) * c.rng());
  const EQ = ['v₁′ = (m₁v₁ + m₂v₂ − m₂(v₁ − v₂)e) / (m₁ + m₂)', 'm = π r²'];
  const CODE = { lang: 'js', name: 'handleBeadBeadCollision', text: [
    'var corr = (bead1.radius + bead2.radius - d) / 2.0;',
    'bead1.pos.add(dir, -corr);',
    'bead2.pos.add(dir, corr);',
    'var v1 = bead1.vel.dot(dir);',
    'var v2 = bead2.vel.dot(dir);',
    'var newV1 = (m1 * v1 + m2 * v2 - m2 * (v1 - v2) * restitution) / (m1 + m2);',
    'var newV2 = (m1 * v1 + m2 * v2 - m1 * (v2 - v1) * restitution) / (m1 + m2);'].join('\n') };

  TMP.saver({
    canvas: () => canvas,
    bg: '#0b0e14',
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      cScale = Math.min(w, h) / simMinWidth;
      simWidth = w / cScale; simHeight = h / cScale;
      // Move the wire to the new centre and the beads with it: the shot goes
      // on with no restart.
      const o = ps.wireCenter, d = new Vector2(simWidth / 2 - o.x, simHeight / 2 - o.y);
      o.add(d);
      for (const b of ps.beads) { b.pos.add(d); b.prevPos.add(d); }
      return false;
    },
    shots: [
      { key: 'five', label: { title: 'Five Beads', lines: ['Beads of random size fall along one wire and collide.', 'Elastic collisions, restitution 1.'], eq: EQ, code: CODE },
        run(c) { ring(c, { g: 10, a0: c.rng() * 0.5, radii: radii(c, 5, 0.05, 0.15), gap: 0.25 }); } },
      { key: 'crowd', label: { title: 'A Crowded Wire', lines: ['Many small beads: momentum passes down the row', 'like a Newton’s cradle.'], eq: EQ },
        run(c) { const n = 10 + Math.floor(c.rng() * 9); ring(c, { g: 10, a0: c.rng() * 0.6, radii: radii(c, n, 0.045, 0.075), gap: 0.02 }); } },
      { key: 'heavy', label: { title: 'Heavy and Light', lines: ['One large bead against a row of small ones.', 'The mass ratio sets how much speed passes on.'], eq: EQ, code: CODE },
        run(c) { const r = radii(c, 4 + Math.floor(c.rng() * 4), 0.04, 0.06); r.unshift(0.17); if (c.rng() < 0.5) r.reverse(); ring(c, { g: 10, a0: c.rng() * 0.8, radii: r, gap: 0.12 }); } },
      { key: 'zero-g', label: { title: 'No Gravity', lines: ['Gravity off, random start speeds:', 'the beads trade momentum around the ring.'], eq: ['L = Σ m R v_t = const', 'E = Σ ½ m v²'] },
        run(c) { const n = 6 + Math.floor(c.rng() * 6); ring(c, { g: 0, a0: c.rng() * 6.3, radii: radii(c, n, 0.05, 0.12), gap: 0.2, kick: 2.5 }); } },
    ],
    tick() { c.strokeStyle = WIRE; },
  });
})();

// Billiard · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only uses its globals (canvas, c,
// cScale, simWidth, simHeight, physicsScene, Ball, Vector2).
TMP.page({ n: '03', title: 'Billiard', file: '03-billiard.html', video: 'ThhdlMbGT5g', year: 2021, licence: 'MIT' });

(function () {
  // Saver look: the upstream draw() starts with c.clearRect; in saver mode
  // that call also fills the table, so the balls sit on a dark box and the
  // light plate text reads. Ball colours stay the upstream red; the break
  // shot marks its cue ball with a white ring through the same hook.
  const TABLE = '#0f2a22', RIM = '#1d4a3c';
  let cue = null, hooked = false;  // cue: the cue ball of the break shot
  function hook() {
    if (hooked) return; hooked = true;
    const clear = c.clearRect.bind(c);
    c.clearRect = function (x, y, w, h) {
      clear(x, y, w, h);
      c.save();
      c.fillStyle = TABLE; c.fillRect(0, 0, canvas.width, canvas.height);
      c.strokeStyle = RIM; c.lineWidth = 4; c.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
      // the cue ball: a white ring under its red disc
      const b = cue && physicsScene.balls[0] === cue ? cue : null;
      if (b) { c.fillStyle = '#f4f1e8'; c.beginPath(); c.arc(cX(b.pos), cY(b.pos), 1.45 * b.radius * cScale, 0, 2 * Math.PI); c.fill(); }
      c.restore();
    };
  }
  // Seeded scene in place of setupScene() (that uses Math.random).
  function scene(r, n, rMin, rMax, vMax) {
    physicsScene.balls = [];
    for (let i = 0; i < n; i++) {
      const rad = rMin + r() * (rMax - rMin);
      const pos = new Vector2(rad + r() * (simWidth - 2 * rad), rad + r() * (simHeight - 2 * rad));
      const vel = new Vector2((2 * r() - 1) * vMax, (2 * r() - 1) * vMax);
      physicsScene.balls.push(new Ball(rad, Math.PI * rad * rad, pos, vel));
    }
  }
  // A rack of equal balls in a triangle and one fast ball aimed at it.
  function rack(r) {
    physicsScene.balls = [];
    const rad = Math.min(0.06, simHeight / 26), rows = 5, cx = simWidth * 0.68, cy = simHeight / 2;
    for (let i = 0; i < rows; i++)
      for (let j = 0; j <= i; j++)
        physicsScene.balls.push(new Ball(rad, Math.PI * rad * rad, new Vector2(cx + i * rad * 1.75, cy + (j - i / 2) * rad * 2.02), new Vector2(0, 0)));
    const sp = 3.5 + 1.5 * r(), dy = (r() - 0.5) * rad * 0.8;
    const cueBall = new Ball(rad, Math.PI * rad * rad, new Vector2(simWidth * 0.18, cy + dy), new Vector2(sp, 0));
    physicsScene.balls.unshift(cueBall); cue = cueBall;
  }
  function relax(n) { for (let k = 0; k < n; k++) simulate(); }
  function set(k, o) {
    physicsScene.dt = (1.0 / 60.0) * (1.2 - 0.5 * k.calm);
    physicsScene.gravity = new Vector2(0, o.g || 0);
    physicsScene.restitution = o.e;
    physicsScene.worldSize = new Vector2(simWidth, simHeight);
  }
  const CODE = { lang: 'js', name: 'handleBallCollision', text:
    'var v1 = ball1.vel.dot(dir);\nvar v2 = ball2.vel.dot(dir);\n\nvar newV1 = (m1 * v1 + m2 * v2 - m2 * (v1 - v2) * restitution) / (m1 + m2);\nvar newV2 = (m1 * v1 + m2 * v2 - m1 * (v2 - v1) * restitution) / (m1 + m2);\n\nball1.vel.add(dir, newV1 - v1);\nball2.vel.add(dir, newV2 - v2);' };
  const EQ = ['m₁v₁ + m₂v₂ = m₁v₁′ + m₂v₂′', 'v₂′ − v₁′ = −e (v₂ − v₁)'];

  TMP.saver({
    canvas: () => canvas,
    bg: '#081510',
    // 'Restitution' is a bare text node in body: kit.css hides only the
    // elements, so the text colour goes transparent here.
    enter() { hook(); document.body.style.color = 'transparent'; },
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      cScale = Math.min(w, h) / simMinWidth; simWidth = w / cScale; simHeight = h / cScale;
      physicsScene.worldSize = new Vector2(simWidth, simHeight);
      return true;
    },
    shots: [
      { key: 'elastic', label: { title: 'Elastic Collisions', lines: ['Restitution e = 1: no energy is lost.', 'Mass grows with the disc area.'], eq: EQ, code: CODE },
        run(k) { set(k, { e: 1.0 }); scene(k.rng, 20 + Math.floor(k.rng() * 8), 0.05, 0.15, 1.0); } },
      { key: 'inelastic', label: { title: 'Inelastic Collisions', lines: ['Restitution e = 0.2: each hit removes relative speed.', 'The walls stay elastic, so the balls keep moving together.'], eq: EQ, code: CODE },
        run(k) { set(k, { e: 0.2 }); scene(k.rng, 26, 0.05, 0.12, 1.4); } },
      { key: 'break', label: { title: 'The Break', lines: ['One fast ball into a rack of fifteen equal balls.', 'Equal masses and e = 1: the momentum moves through the rack.'], eq: ['m₁ = m₂, e = 1  ⇒  v₁′ = v₂, v₂′ = v₁'], code: CODE },
        run(k) { set(k, { e: 1.0 }); rack(k.rng); } },
      { key: 'gas', label: { title: 'A Hard-Disc Gas', lines: ['Many small elastic discs: the speeds spread into a distribution.'], eq: ['½ m ⟨v²⟩ = k T  (2D)', 'e = 1'], code: CODE },
        run(k) { set(k, { e: 1.0 }); scene(k.rng, 90, 0.025, 0.035, 0.9); relax(60); } },
      { key: 'settle', label: { title: 'Under Gravity', lines: ['Gravity on and e = 0.6: the balls fall and pile up.', 'The walls stay elastic; only the ball-ball hits remove energy.'], eq: ['v ← v + g Δt', 'e = 0.6'], code: CODE },
        run(k) { set(k, { e: 0.6, g: -2.0 }); scene(k.rng, 22, 0.05, 0.12, 1.2); } },
    ],
  });
})();

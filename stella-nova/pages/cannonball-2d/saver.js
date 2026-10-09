// Cannonball 2D · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only uses its globals (canvas, c,
// simMinWidth, cScale, simWidth, simHeight, gravity, timeStep, ball).
TMP.page({ n: '01', title: 'Cannonball 2D', file: '01-cannonball2d.html', video: 'oPuSvdBGrpE', year: 2021, licence: 'MIT' });

(function () {
  // Saver look: a dark page and a dark box, so the light plate text reads.
  // The upstream draw() starts with c.clearRect; in saver mode that call
  // also fills the box and draws the trail of the ball under the ball.
  const BOX = '#141a26', TRAIL = 'rgba(255, 120, 90, ', FLOOR = '#3a4660';
  let trail = [], hooked = false;
  function hook() {
    if (hooked) return; hooked = true;
    const clear = c.clearRect.bind(c);
    c.clearRect = function (x, y, w, h) {
      clear(x, y, w, h);
      c.save();
      c.fillStyle = BOX; c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = FLOOR; c.fillRect(0, canvas.height - 2, canvas.width, 2);
      trail.push({ x: cX(ball.pos), y: cY(ball.pos) });
      if (trail.length > 260) trail.shift();
      for (let i = 0; i < trail.length; i += 2) {
        const a = i / trail.length;
        c.fillStyle = TRAIL + (0.15 + 0.65 * a).toFixed(3) + ')';
        c.beginPath(); c.arc(trail[i].x, trail[i].y, 1.5 + 2 * a, 0, 2 * Math.PI); c.fill();
      }
      // a soft halo under the upstream ball, so the small disc reads
      const p = trail[trail.length - 1], g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7 * ball.radius * cScale);
      g.addColorStop(0, 'rgba(255, 90, 60, 0.45)'); g.addColorStop(1, 'rgba(255, 90, 60, 0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 7 * ball.radius * cScale, 0, 2 * Math.PI); c.fill();
      c.restore();
    };
  }
  // Start the ball at the lower left corner. vy is capped so the top of the
  // arc stays in the box (upstream has no ceiling).
  function launch(r, gx, gy, angMin, angMax) {
    gravity.x = gx; gravity.y = gy;
    const ang = (angMin + (angMax - angMin) * r()) * Math.PI / 180;
    const vMax = Math.sqrt(2 * -gy * 0.85 * simHeight) / Math.sin(ang);
    const v = vMax * (0.8 + 0.2 * r());
    ball.pos.x = 0.2 + (gx < 0 ? simWidth - 0.4 : 0); ball.pos.y = 0.2;
    ball.vel.x = v * Math.cos(ang) * (gx < 0 ? -1 : 1); ball.vel.y = v * Math.sin(ang);
    trail = [];
  }
  const speed = k => { timeStep = (1.0 / 60.0) * (1.2 - 0.5 * k.calm); };
  const CODE = { lang: 'js', name: 'simulate', text:
    'ball.vel.x += gravity.x * timeStep;\nball.vel.y += gravity.y * timeStep;\nball.pos.x += ball.vel.x * timeStep;\nball.pos.y += ball.vel.y * timeStep;\n\nif (ball.pos.y < 0.0) {\n\tball.pos.y = 0.0;\n\tball.vel.y = -ball.vel.y;' };
  const EQ = ['v ← v + g Δt', 'x ← x + v Δt'];

  TMP.saver({
    canvas: () => canvas,
    bg: '#0b0e14',
    enter() { hook(); },
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      // A box 8 units on its short side: the 0.2 ball is easier to see
      // than in the upstream 20-unit box.
      canvas.width = w; canvas.height = h; simMinWidth = 8.0;
      cScale = Math.min(w, h) / simMinWidth; simWidth = w / cScale; simHeight = h / cScale;
      return true;
    },
    shots: [
      { key: 'launch', label: { title: 'Cannonball', lines: ['Gravity and one explicit Euler step per frame.', 'The ball bounces off the floor and the walls.'], eq: EQ, code: CODE },
        run(k) { speed(k); launch(k.rng, 0, -10, 40, 70); } },
      { key: 'moon', label: { title: 'Cannonball on the Moon', lines: ['The same code with g = 1.62 m/s².', 'The arcs are wider and much slower.'], eq: ['g = 1.62 m/s²', 'h = v_y² / 2g'], code: CODE },
        run(k) { speed(k); launch(k.rng, 0, -1.62, 55, 80); } },
      { key: 'wind', label: { title: 'A Side Wind', lines: ['Gravity gets an x part too.', 'Each arc leans into the wind.'], eq: ['g = (gₓ, −10)', 'v ← v + g Δt'], code: CODE },
        run(k) { speed(k); launch(k.rng, (k.rng() < 0.5 ? -1 : 1) * (1.5 + 2 * k.rng()), -10, 60, 80); } },
      { key: 'heavy', label: { title: 'Strong Gravity', lines: ['g = 25 m/s², close to the value at the top of Jupiter’s clouds.', 'Short, fast hops.'], eq: ['g = 25 m/s²', 'T = 2 v_y / g'], code: CODE },
        run(k) { speed(k); launch(k.rng, 0, -25, 30, 60); } },
    ],
  });
})();

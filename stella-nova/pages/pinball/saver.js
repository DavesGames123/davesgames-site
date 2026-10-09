// Pinball · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only uses its globals (canvas, c,
// cScale, simWidth, simHeight, flipperHeight, physicsScene, setupScene,
// Ball, Vector2, cX, cY).
//
// Autopilot. tick() presses a flipper the way onMouseDown does (it sets
// flipper.touchIdentifier >= 0) when a ball comes down near it, holds it a
// short time, and lets it go. A ball that falls into the pit under the
// flippers, or stays still too long, is launched again from the right
// lane. The autopilot misses some balls on purpose (seeded).
TMP.page({ n: '04', title: 'Pinball', file: '04-pinball.html', video: 'NhVUCsXp-Uo', year: 2021, licence: 'MIT' });

(function () {
  // Saver look: draw() starts with c.clearRect; in saver mode that call also
  // fills the page dark and the table inside the border light, so the black
  // upstream border reads and the light plate text reads on the dark sides.
  const PAGE = '#0d0f14', FELT = '#efe9dc';
  let hooked = false, dx = 0, base = 1.0 / 60.0, slow = 1;
  function hook() {
    if (hooked) return; hooked = true;
    const clear = c.clearRect.bind(c);
    c.clearRect = function (x, y, w, h) {
      clear(x, y, w, h);
      c.save();
      c.fillStyle = PAGE; c.fillRect(0, 0, canvas.width, canvas.height);
      const B = physicsScene.border;
      if (B.length > 2) {
        c.fillStyle = FELT; c.beginPath(); c.moveTo(cX(B[0]), cY(B[0]));
        for (let i = 1; i < B.length; i++) c.lineTo(cX(B[i]), cY(B[i]));
        c.closePath(); c.fill();
      }
      c.restore();
    };
  }
  // Rebuild the table. Upstream setupScene() pushes the border and the
  // flippers onto the old lists, so empty them first. Then move the whole
  // table (1.0 wide in sim units) to the middle of the canvas.
  function build() {
    physicsScene.border = []; physicsScene.flippers = [];
    setupScene();
    dx = Math.max(0, (simWidth - 1.0) / 2);
    const shift = v => { v.x += dx; };
    physicsScene.border.forEach(shift);
    physicsScene.balls.forEach(b => shift(b.pos));
    physicsScene.obstacles.forEach(o => shift(o.pos));
    physicsScene.flippers.forEach(f => shift(f.pos));
    pilot.length = 0;
    physicsScene.flippers.forEach(() => pilot.push({ hold: 0, wait: 0 }));
    still = physicsScene.balls.map(() => 0);
  }
  function launch(b, r) {
    const left = r() < 0.3;
    b.pos.x = dx + (left ? 0.08 : 0.92); b.pos.y = 0.5;
    b.vel.x = (left ? 1 : -1) * (0.1 + 0.3 * r()); b.vel.y = 3.2 + 0.6 * r();
  }
  function addBalls(n, r) {
    for (let i = 0; i < n; i++) {
      const b = physicsScene.balls[0];
      const nb = new Ball(b.radius, b.mass, new Vector2(0, 0), new Vector2(0, 0), b.restitution);
      launch(nb, r); nb.pos.y += 0.08 * i;
      physicsScene.balls.push(nb); still.push(0);
    }
  }
  const pilot = [];
  let still = [], rngRef = Math.random, missP = 0.1;
  function shot(k, o) {
    rngRef = k.rng; missP = o.miss != null ? o.miss : 0.1;
    build();
    slow = o.slow || 1;
    base = (1.0 / 60.0) * (1.2 - 0.5 * k.calm);
    physicsScene.dt = base * slow;
    physicsScene.gravity = new Vector2(0, o.g || -3.0);
    if (o.push) physicsScene.obstacles.forEach(ob => { ob.pushVel = o.push; });
    physicsScene.balls.forEach(b => launch(b, k.rng));
    if (o.extra) addBalls(o.extra, k.rng);
  }
  function autopilot(dt) {
    const F = physicsScene.flippers, r = rngRef;
    for (let i = 0; i < F.length; i++) {
      const f = F[i], p = pilot[i];
      if (p.hold > 0) { p.hold -= dt; if (p.hold <= 0) { f.touchIdentifier = -1; p.wait = 0.18; } continue; }
      if (p.wait > 0) { p.wait -= dt; continue; }
      const tip = f.getTip();
      for (const b of physicsScene.balls) {
        // near: inside a circle around the flipper, above its line, and
        // not moving up fast (the ball comes down onto the flipper)
        const mx = (f.pos.x + tip.x) / 2, my = (f.pos.y + tip.y) / 2;
        const d = Math.hypot(b.pos.x - mx, b.pos.y - my);
        if (d < f.length * 0.75 && b.pos.y > tip.y - 0.02 && b.vel.y < 0.4) {
          if (r() < missP) { p.wait = 0.5; break; }
          f.touchIdentifier = 9; p.hold = 0.16 + 0.14 * r(); break;
        }
      }
    }
    // lost or stuck balls go back to the launch lane
    physicsScene.balls.forEach((b, i) => {
      const v = Math.hypot(b.vel.x, b.vel.y);
      still[i] = v < 0.08 ? still[i] + dt : 0;
      if (b.pos.y < 0.12 || still[i] > 2.5) { launch(b, r); still[i] = 0; }
    });
  }
  const FLIP = { lang: 'js', name: 'handleBallFlipperCollision', text:
    'var radius = closest.clone();\nradius.add(dir, flipper.radius);\nradius.subtract(flipper.pos);\nvar surfaceVel = radius.perp();\nsurfaceVel.scale(flipper.currentAngularVelocity);\n\nvar v = ball.vel.dot(dir);\nvar vnew = surfaceVel.dot(dir);' };
  const BUMP = { lang: 'js', name: 'handleBallObstacleCollision', text:
    'var corr = ball.radius + obstacle.radius - d;\nball.pos.add(dir, corr);\n\nvar v = ball.vel.dot(dir);\nball.vel.add(dir, obstacle.pushVel - v);\n\nphysicsScene.score++;' };
  const WALL = { lang: 'js', name: 'handleBallBorderCollision', text:
    'if (d.dot(normal) >= 0.0) {\n\tif (dist > ball.radius) \n\t\treturn;\n\tball.pos.add(d, ball.radius - dist);\n}\nelse\n\tball.pos.add(d, -(dist + ball.radius));' };

  TMP.saver({
    canvas: () => canvas,
    bg: PAGE,
    // 'Score' is a bare text node in body: kit.css hides only elements.
    enter() { hook(); document.body.style.color = 'transparent'; },
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      cScale = h / flipperHeight; simWidth = w / cScale; simHeight = h / cScale;
      return true;
    },
    shots: [
      { key: 'play', label: { title: 'Pinball', lines: ['Two balls, four bumpers and two flippers.', 'An autopilot presses the flippers.'], eq: ['v_n′ = (ω × r) · n', 'g = 3 m/s² (a tilted table)'], code: FLIP },
        run(k) { shot(k, {}); } },
      { key: 'multiball', label: { title: 'Multiball', lines: ['Five balls: ball-ball hits with restitution 0.2.'], eq: ['v₁′ − v₂′ = −e (v₁ − v₂)', 'e = 0.2'], code: FLIP },
        run(k) { shot(k, { extra: 3, miss: 0.05 }); } },
      { key: 'bumpers', label: { title: 'Hot Bumpers', lines: ['A bumper sets the normal speed of the ball to pushVel.', 'Here pushVel = 3 in place of 2.'], eq: ['v ← v + (v_push − v · n) n'], code: BUMP },
        run(k) { shot(k, { push: 3.0 }); } },
      { key: 'slowmo', label: { title: 'Flipper Contact, Slow Motion', lines: ['The flipper surface moves at ω × r.', 'The ball takes that normal speed.'], eq: ['v_surface = ω × r', 'ω = 10 rad/s'], code: FLIP },
        run(k) { shot(k, { slow: 0.35, miss: 0.03 }); } },
      { key: 'border', label: { title: 'The Border', lines: ['The closest border segment pushes the ball back in.', 'Restitution 0.2 on the walls.'], eq: ['v_n′ = e |v_n|', 'e = 0.2'], code: WALL },
        run(k) { shot(k, { g: -1.6, extra: 1 }); } },
    ],
    // the autopilot runs on sim time: real dt times the sim step per frame
    tick(dt) { if (physicsScene.flippers.length && pilot.length) autopilot(dt * physicsScene.dt * 60); },
  });
})();

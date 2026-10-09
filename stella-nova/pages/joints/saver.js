// Joint Simulation · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (gSimulator,
// gRenderScene, loadScene, onStart, gPaused). It drives the motors and the
// servo through the touch control state of the simulator (controlVector),
// and pulls bodies with the upstream drag joint.
TMP.page({ n: '25', title: 'Joint Simulation', file: '25-joints.html', video: 'YVaQxeWGlJA', year: 2024, licence: 'MIT' });

(function () {
  let move = null, hand = null, stick = null, wantFrames = false;

  // Load one of the three scene files (0 basic joints, 1 steering, 2
  // pendulums). loadScene fetches the JSON; the bodies come a moment later.
  function setup(nr, frames) {
    hand = null; stick = null;
    gSimulator.isDragging = false; gSimulator.controlVector.set(0, 0);
    document.getElementById('sceneSelect').value = String(nr);
    load(nr);
    // The importer always ends in the visual view; the frames view is one
    // toggle after the load (see tick).
    wantFrames = !!frames;
    if (gPaused) onStart();
  }
  const dynamic = () => gSimulator.rigidBodies.filter(b => b.invMass > 0);
  // loadScene clears the scene, then adds the bodies when its fetch ends. A
  // second call before that end adds both scenes, so a new load waits for
  // the one in flight (loadTick).
  let loading = false, queued = null;
  function load(nr) { if (loading) { queued = nr; return; } loading = true; loadScene(nr); }
  function loadTick() {
    if (!loading || !gSimulator.rigidBodies.length) return;
    loading = false;
    if (queued != null) { const q = queued; queued = null; load(q); }
  }

  // ---- autopilot hand ----------------------------------------------------------
  // Grab a body at its centre with the upstream drag joint, move the grab
  // point along a path, let go, rest, then grab again.
  function handOn(c, pick, path, wait) { hand = { c, pick, path, phase: 'rest', t: 0, dur: wait || 0.8 }; }
  function handTick(dt) {
    if (!hand) return;
    hand.t += dt;
    if (hand.phase === 'rest' && hand.t > hand.dur) {
      const b = hand.pick(hand.c); if (!b) return;
      hand.p0 = b.pos.clone(); hand.g = hand.path(hand.c, b);
      gSimulator.startDrag(b, hand.p0.clone()); hand.phase = 'pull'; hand.t = 0;
    } else if (hand.phase === 'pull') {
      const u = Math.min(1, hand.t / hand.g.dur);
      gSimulator.drag(hand.g.at(u, hand.p0));
      if (u >= 1) { gSimulator.endDrag(); hand.phase = 'rest'; hand.t = 0; hand.dur = hand.g.rest; }
    }
  }
  const ease = u => u * u * (3 - 2 * u);
  // Pull out to an offset in the x-y plane (the plane of the scenes), let go.
  function yank(c, len, slow) {
    const a = (0.15 + 0.7 * c.rng()) * Math.PI * (c.rng() < 0.5 ? 1 : -1) * 0.5, d = new THREE.Vector3(Math.cos(a) * len * (c.rng() < 0.5 ? -1 : 1), Math.sin(a) * len, 0.25 * len * (c.rng() - 0.5));
    return { dur: (1.0 + 0.6 * c.rng()) * slow, rest: (1.5 + 1.5 * c.rng()) * slow, at: (u, p0) => p0.clone().addScaledVector(d, ease(Math.min(1, u * 1.5))) };
  }
  // Joystick: x steers the servos, y drives the motors and the cylinder
  // target. Each axis is a slow sine with a seeded rate and phase.
  function stickOn(c, ax, ay, bias) {
    gSimulator.isDragging = true;
    stick = { ax, ay, bias: bias || 0, wx: 0.35 + 0.3 * c.rng(), wy: 0.2 + 0.25 * c.rng(), px: 6.28 * c.rng(), py: 6.28 * c.rng() };
  }

  // ---- camera: one move per shot (orbit, push in, pull out, truck) -----------
  // Distance at which a w x h subject (world units) just fills the view at
  // the current aspect (the band can be wide or a 9:16 column).
  function fitR(w, h) { const t = Math.tan(gRenderScene.camera.fov * Math.PI / 360); return Math.max(h / 2 / t, w / 2 / (t * gRenderScene.camera.aspect)); }
  function pose(t, r, az, el) { return { t, r, az, el }; }
  function plan(c, p) {
    const q = { t: p.t.slice(), r: p.r, az: p.az, el: p.el }, k = c.rng(), sg = c.rng() < 0.5 ? -1 : 1;
    if (k < 0.35) q.az += sg * (0.7 + 0.6 * c.rng());
    else if (k < 0.6) { q.r *= 0.65 + 0.1 * c.rng(); q.el += 0.12 * (c.rng() - 0.5); }
    else if (k < 0.75) { p.r *= 0.7; }
    else { const s = sg * p.r * 0.3; q.t[0] += Math.cos(p.az) * s; q.t[2] -= Math.sin(p.az) * s; q.az += 0.3 * sg; }
    move = { a: p, b: q, T: 10 * (0.8 + 0.4 * c.calm) };
  }
  function camTick(t) {
    if (!move) return;
    let u = Math.min(1, t / move.T); u = ease(u);
    const a = move.a, b = move.b, m = (x, y) => x + (y - x) * u, cam = gRenderScene.camera;
    const tx = m(a.t[0], b.t[0]), ty = m(a.t[1], b.t[1]), tz = m(a.t[2], b.t[2]), r = m(a.r, b.r), az = m(a.az, b.az), el = m(a.el, b.el), ce = Math.cos(el);
    cam.position.set(tx + r * ce * Math.sin(az), ty + r * Math.sin(el), tz + r * ce * Math.cos(az));
    gRenderScene.cameraControl.target.set(tx, ty, tz);
    cam.lookAt(tx, ty, tz);
  }

  // Scene centres from the JSON files: basic joints x -1.26..1.15, y 0.4..0.75;
  // steering x -0.38..0.38, y 0.27..0.36; pendulums x -0.64..0.62, y 0.4..1.16.
  const BASIC = [-0.05, 0.55, 0], CAR = [0, 0.32, 0.03], PEND = [0, 0.72, 0];
  const EQ = ['Δλ = −C / (w₀ + w₁ + α / Δt²)', 'Δx = ±Δλ n / m'];
  const CODE_HINGE = { lang: 'js', name: 'solveOrientation', text: '// align axes\nthis.updateGlobalFrames();\na0.copy(axis0);\na0.applyQuaternion(this.globalRot0);\na1.copy(axis0);\na1.applyQuaternion(this.globalRot1);\ncorr.crossVectors(a0, a1);\nthis.body0.applyCorrection(hardCompliance, corr, null, this.body1, null);' };
  const CODE_MOTOR = { lang: 'js', name: 'updateControl', text: 'if (joint.type === Joint.TYPES.MOTOR) {\n  joint.velocity = this.controlVector.y * 5.0;\n}\nelse if (joint.type === Joint.TYPES.SERVO) {\n  joint.targetAngle = this.controlVector.x * Math.PI / 4;\n}' };
  const CODE_LIMIT = { lang: 'js', name: 'limitAngle', text: 'let phi = this.getAngle(n, a, b);\nif (minAngle <= phi && phi <= maxAngle)\n  return;\nphi = Math.max(minAngle, Math.min(phi, maxAngle));\nlet ra = a.clone();\nra.applyAxisAngle(n, phi);\nlet corr = new THREE.Vector3().crossVectors(ra, b);\nthis.body0.applyCorrection(compliance, corr, null, this.body1, null);' };
  const CODE_PRISM = { lang: 'js', name: 'solvePosition', text: 'corr.subVectors(this.globalPos1, this.globalPos0);\ncorr.applyQuaternion(this.globalRot0.clone().conjugate());\nif (this.type == Joint.TYPES.CYLINDER)\n  corr.x -= this.targetDistance;\nelse if (corr.x > this.distanceMax)\n  corr.x -= this.distanceMax;\nelse if (corr.x < this.distanceMin)\n  corr.x -= this.distanceMin;' };
  const slowOf = c => 0.8 + 0.5 * c.calm;
  const pickAny = c => { const d = dynamic(); return d.length ? d[Math.floor(c.rng() * d.length)] : null; };
  const shots = [
    { key: 'basic', label: { title: 'Basic Joints', lines: ['Ball, hinge, prismatic, motor, servo and cylinder joints, and two damped copies.', 'A hand pulls one body after another; each joint leaves only its own freedom.'], eq: EQ, code: CODE_PRISM },
      run(c) {
        setup(0);
        stickOn(c, 0.8, 0.8);
        handOn(c, pickAny, () => yank(c, 0.15 + 0.15 * c.rng(), slowOf(c)));
        plan(c, pose(BASIC.slice(), fitR(2.8, 1.0) * (1.4 + 0.2 * c.rng()), 0.5 * (c.rng() - 0.5), 0.12 + 0.2 * c.rng()));
      } },
    { key: 'motors', label: { title: 'Motor, Servo, Cylinder', lines: ['The joystick axis y drives the motor and the cylinder; x turns the servo.', 'A motor joint moves its target angle by ω Δt in each substep.'], eq: ['θ_target ← θ_target + ω Δt', 'θ_servo = x · π/4'], code: CODE_MOTOR },
      run(c) {
        setup(0);
        stickOn(c, 1, 1);
        // Truck along the row, close in.
        const sg = c.rng() < 0.5 ? -1 : 1;
        const r = fitR(1.2, 0.8) * 1.3;
        move = { a: pose([-0.9 * sg, 0.55, 0], r, 0.35 * sg, 0.2), b: pose([0.9 * sg, 0.55, 0], r, -0.35 * sg, 0.25), T: 11 * (0.8 + 0.4 * c.calm) };
      } },
    { key: 'steering', label: { title: 'Steering', lines: ['Two motor joints turn the wheels; a servo joint moves the steering bar.', 'Hinge joints link the steering bar to the two wheel arms.'], eq: ['θ_servo = x · π/4', 'ω_wheel = 5 y'], code: CODE_MOTOR },
      run(c) {
        setup(1);
        stickOn(c, 0.9 + 0.1 * c.rng(), 0.7, 0.3);
        plan(c, pose(CAR.slice(), fitR(1.1, 1.1) * (1.4 + 0.25 * c.rng()), c.rng() * 6.28, 0.35 + 0.35 * c.rng()));
      } },
    { key: 'pendulum', label: { title: 'Pendulums', lines: ['A double and a triple hinge pendulum, and a chain of ball joints.', 'Twist limits of zero stop the ball joints from turning about the chain.'], eq: EQ, code: CODE_LIMIT },
      run(c) {
        setup(2);
        handOn(c, () => { const d = dynamic(); return d.length ? d.filter(b => b.pos.y < 0.85)[Math.floor(c.rng() * 4)] || d[0] : null; }, () => yank(c, 0.35 + 0.2 * c.rng(), slowOf(c)), 0.3);
        plan(c, pose(PEND.slice(), fitR(1.6, 1.3) * (1.3 + 0.2 * c.rng()), 0.6 * (c.rng() - 0.5), 0.05 + 0.2 * c.rng()));
      } },
    { key: 'frames', label: { title: 'Joint Frames', lines: ['The simulation view: the boxes the solver sees, and each joint frame.', 'A joint aligns one frame on body 0 with one frame on body 1.'], eq: ['hinge: a₀ × a₁ = 0', 'limit: φ ← clamp(φ, φmin, φmax)'], code: CODE_HINGE },
      run(c) {
        const nr = [0, 2, 1][Math.floor(3 * c.rng())];
        setup(nr, true);
        if (nr === 1) stickOn(c, 1, 0.6, 0.3); else { stickOn(c, 0.8, 0.8); handOn(c, pickAny, () => yank(c, 0.2 + 0.2 * c.rng(), slowOf(c))); }
        plan(c, pose((nr === 0 ? BASIC : nr === 1 ? CAR : PEND).slice(), nr === 0 ? fitR(2.8, 1.0) * 1.4 : nr === 1 ? fitR(1.1, 1.1) * 1.4 : fitR(1.6, 1.3) * 1.3, 0.8 * (c.rng() - 0.5), 0.2 + 0.2 * c.rng()));
      } },
  ];

  TMP.saver({
    canvas: () => gRenderScene.renderer.domElement,
    bg: '#000',
    enter() { gRenderScene.cameraControl.enabled = false; },
    fit(w, h) {
      const r = gRenderScene.renderer, cam = gRenderScene.camera;
      r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
      return false;
    },
    shots,
    tick(dt, c) {
      loadTick();
      if (wantFrames && !loading && gSimulator.rigidBodies.length && gSimulator.simulationView) { gSimulator.toggleView(); wantFrames = false; }
      if (stick) {
        const s = 1.15 - 0.6 * c.calm, t = c.t * s;
        gSimulator.controlVector.set(stick.ax * Math.sin(stick.wx * 6.28 * t / 4 + stick.px), Math.max(-1, Math.min(1, stick.bias + stick.ay * Math.sin(stick.wy * 6.28 * t / 4 + stick.py))));
      }
      camTick(c.t);
      handTick(dt);
    },
  });
})();

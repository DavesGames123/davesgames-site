// Rigid Bodies · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (gSimulator,
// gCamera, gCameraControl, gRenderer, onRestart, onStart, gPaused) and the
// scene and time step selects.
TMP.page({ n: '22', title: 'Rigid Bodies', file: '22-rigidBodies.html', video: 'euypZDssYxE', year: 2024, licence: 'MIT' });

(function () {
  let move = null, hand = null;

  // Build an upstream scene: 0 = crib mobile, 1 = chain. dt = time step.
  function setup(nr, dt) {
    hand = null;
    document.getElementById('sceneNumber').value = String(nr);
    document.getElementById('timeStep').value = dt;
    onRestart();
    // A stiffer drag spring than the mouse one (0.001), so the autopilot
    // hand moves the heavy bodies within a shot.
    gSimulator.dragCompliance = 0.0001;
    if (gPaused) onStart();
  }
  const dynamic = () => gSimulator.rigidBodies.filter(b => b.invMass > 0);

  // ---- autopilot hand ----------------------------------------------------------
  // Grab a body at its centre with the upstream drag constraint, move the
  // grab point along a path, let go, rest, then grab again.
  // pick(c) returns a body; path(c, b) returns { dur, rest, at(u, p0) }.
  function handOn(c, pick, path, wait) { hand = { c, pick, path, phase: 'rest', t: 0, dur: wait || 0.4 }; }
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
  // Pull out to an offset, hold, let go. len: offset size.
  function yank(c, len, up, slow) {
    const a = c.rng() * 6.28, d = new THREE.Vector3(Math.cos(a) * len, up * len, Math.sin(a) * len);
    return { dur: (1.2 + 0.6 * c.rng()) * slow, rest: (1.8 + 1.5 * c.rng()) * slow, at: (u, p0) => p0.clone().addScaledVector(d, ease(Math.min(1, u * 1.6))) };
  }
  // Move the grab point on a horizontal circle: the body twists the chain
  // or the mobile above it.
  function swirl(c, rad, turns, slow) {
    const sg = c.rng() < 0.5 ? -1 : 1, a0 = c.rng() * 6.28;
    return { dur: (2.5 + 1.5 * c.rng()) * slow, rest: (2.5 + 1.5 * c.rng()) * slow, at(u, p0) {
      const a = a0 + sg * turns * 6.28 * u, r = rad * Math.min(1, 4 * u);
      return new THREE.Vector3(p0.x + r * (Math.cos(a) - Math.cos(a0)), p0.y, p0.z + r * (Math.sin(a) - Math.sin(a0)));
    } };
  }

  // ---- camera: one move per shot (orbit, push in, pull out, truck) -----------
  // Distance at which a w x h subject (world units) just fills the view at
  // the current aspect (the band can be wide or a 9:16 column).
  function fitR(w, h) { const t = Math.tan(gCamera.fov * Math.PI / 360); return Math.max(h / 2 / t, w / 2 / (t * gCamera.aspect)); }
  function pose(t, r, az, el) { return { t, r, az, el }; }
  function plan(c, p) {
    const q = { t: p.t.slice(), r: p.r, az: p.az, el: p.el }, k = c.rng(), sg = c.rng() < 0.5 ? -1 : 1;
    if (k < 0.35) q.az += sg * (0.9 + 0.8 * c.rng());
    else if (k < 0.6) { q.r *= 0.72 + 0.1 * c.rng(); q.el += 0.15 * (c.rng() - 0.5); }
    else if (k < 0.75) { p.r *= 0.75; }
    else { const s = sg * p.r * 0.25; q.t[0] += Math.cos(p.az) * s; q.t[2] -= Math.sin(p.az) * s; q.az += 0.35 * sg; }
    move = { a: p, b: q, T: 10 * (0.8 + 0.4 * c.calm) };
  }
  function camTick(t) {
    if (!move) return;
    let u = Math.min(1, t / move.T); u = ease(u);
    const a = move.a, b = move.b, m = (x, y) => x + (y - x) * u;
    const tx = m(a.t[0], b.t[0]), ty = m(a.t[1], b.t[1]), tz = m(a.t[2], b.t[2]), r = m(a.r, b.r), az = m(a.az, b.az), el = m(a.el, b.el), ce = Math.cos(el);
    gCamera.position.set(tx + r * ce * Math.sin(az), ty + r * Math.sin(el), tz + r * ce * Math.cos(az));
    gCameraControl.target.set(tx, ty, tz);
    gCamera.lookAt(tx, ty, tz);
  }

  // The mobile hangs between x = -2.05 and 0.41, y = 0.9 and 2.8, and
  // turns about its top rope at x = 0; the chain hangs between y = 1.0 and
  // 2.5 at x = 0.
  const MOBILE = [-0.5, 1.85, 0], CHAIN = [0.05, 1.75, 0];
  const EQ = ['Δλ = −C / (w₀ + w₁ + α / Δt²)', 'wᵢ = 1/mᵢ + (rᵢ × n)ᵀ Iᵢ⁻¹ (rᵢ × n)'];
  const CODE_XPBD = { lang: 'js', name: 'applyCorrection', text: 'let w = this.getInverseMass(normal, pos);\nif (otherBody != undefined)\n  w += otherBody.getInverseMass(normal, otherPos);\n// XPBD\nlet alpha = compliance / this.dt / this.dt;\nlet lambda = -C / (w + alpha);\nnormal.multiplyScalar(-lambda);' };
  const CODE_STEP = { lang: 'js', name: 'simulate', text: 'let sdt = this.dt / this.numSubSteps;\nfor (let subStep = 0; subStep < this.numSubSteps; subStep++)\n{\n  for (let i = 0; i < this.rigidBodies.length; i++)\n    this.rigidBodies[i].integrate(sdt, this.gravity);\n  for (let i = 0; i < this.distanceConstraints.length; i++)\n    this.distanceConstraints[i].solve();' };
  const CODE_ROT = { lang: 'js', name: 'integrate', text: 'this.dRot.set(this.omega.x, this.omega.y, this.omega.z, 0.0);\nthis.dRot.multiply(this.rot);\nthis.rot.x += 0.5 * dt * this.dRot.x;\nthis.rot.y += 0.5 * dt * this.dRot.y;\nthis.rot.z += 0.5 * dt * this.dRot.z;\nthis.rot.w += 0.5 * dt * this.dRot.w;\nthis.rot.normalize();' };
  const slowOf = c => 0.8 + 0.5 * c.calm;
  const shots = [
    { key: 'mobile', label: { title: 'Crib Mobile', lines: ['Five bars and six spheres on rope constraints; a hand pulls one body, then lets go.', 'Rope: a one-sided distance constraint, slack when shorter.'], eq: EQ, code: CODE_XPBD },
      run(c) {
        setup(0, '0.02');
        handOn(c, () => { const d = dynamic(); return d[Math.floor(c.rng() * d.length)]; }, () => yank(c, 0.25 + 0.25 * c.rng(), 0.3 * c.rng(), slowOf(c)));
        plan(c, pose(MOBILE.slice(), fitR(2.6, 2.4) * (1.5 + 0.2 * c.rng()), 0.6 * (c.rng() - 0.5), 0.15 + 0.2 * c.rng()));
      } },
    { key: 'twist', label: { title: 'Twisting the Mobile', lines: ['The hand swings the lowest sphere round; each bar turns on its rope.', 'Rotation is a quaternion, integrated with the angular velocity.'], eq: ['q ← q + ½ Δt [ω, 0] q', 'q ← q / |q|'], code: CODE_ROT },
      run(c) {
        setup(0, '0.02');
        handOn(c, () => { const d = dynamic(); return d[d.length - 1 - Math.floor(2 * c.rng())]; }, () => swirl(c, 0.25 + 0.15 * c.rng(), 1 + c.rng(), slowOf(c)), 0.2);
        plan(c, pose([-0.3, 1.8, 0], fitR(3.2, 2.4) * (1.5 + 0.2 * c.rng()), c.rng() * 6.28, 0.25 + 0.2 * c.rng()));
      } },
    { key: 'chain', label: { title: 'Chain of Boxes', lines: ['Each box doubles the mass of the box above; the links show force and stretch.', 'Links: soft distance constraints, compliance 0.001.'], eq: EQ, code: CODE_XPBD },
      run(c) {
        setup(1, '0.02');
        handOn(c, () => { const d = dynamic(); return d[d.length - 1 - (c.rng() < 0.3 ? 1 : 0)]; }, () => yank(c, 0.3 + 0.2 * c.rng(), 0.6 * c.rng(), slowOf(c)));
        plan(c, pose(CHAIN.slice(), fitR(0.9, 1.8) * (1.35 + 0.2 * c.rng()), 0.8 * (c.rng() - 0.5), 0.1 + 0.2 * c.rng()));
      } },
    { key: 'coarse', label: { title: 'Large Time Steps', lines: ['Δt = 0.05 s, cut into 10 substeps: the bodies stay stable.', 'Small substeps keep the constraints stiff with one iteration each.'], eq: ['Δt_sub = Δt / n', 'α̃ = α / Δt_sub²'], code: CODE_STEP },
      run(c) {
        const mob = c.rng() < 0.4;
        setup(mob ? 0 : 1, '0.05');
        handOn(c, () => { const d = dynamic(); return d[d.length - 1]; }, () => mob ? yank(c, 0.4, 0.2, slowOf(c)) : swirl(c, 0.3, 1.5, slowOf(c)));
        plan(c, pose((mob ? MOBILE : CHAIN).slice(), mob ? fitR(2.6, 2.4) * 1.6 : fitR(0.9, 1.8) * 1.45, c.rng() * 6.28, 0.15 + 0.2 * c.rng()));
      } },
  ];

  TMP.saver({
    canvas: () => gRenderer.domElement,
    bg: '#000',
    enter() { gCameraControl.enabled = false; },
    fit(w, h) {
      gRenderer.setSize(w, h); gCamera.aspect = w / h; gCamera.updateProjectionMatrix();
      return false;
    },
    shots,
    tick(dt, c) { camTick(c.t); handTick(dt); },
  });
})();

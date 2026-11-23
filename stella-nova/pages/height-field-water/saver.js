// Height-Field Water · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals
// (gPhysicsScene, gRenderer, gRenderTarget, gCamera, gCameraControl, Ball)
// and the Ball methods startGrab, moveGrabbed and endGrab that the upstream
// grabber uses.
TMP.page({ n: '20', title: 'Height-Field Water', file: '20-heightFieldWater.html', video: 'hswBi5wcqAA', year: 2023, licence: null });

(function () {
  const P = gPhysicsScene;
  const BASE = P.objects.slice();          // the three upstream balls
  let extra = [];                          // balls a shot adds
  let events = [], cam = null, wave = null;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Flat water and the three upstream balls held at rest above the tank.
  function resetWater() {
    const w = P.waterSurface;
    w.heights.fill(P.waterHeight); w.velocities.fill(0); w.bodyHeights.fill(0); w.prevHeights.fill(0);
    w.updateVisMesh();
  }
  function clearExtra() {
    for (const b of extra) { gThreeScene.remove(b.visMesh); const i = P.objects.indexOf(b); if (i >= 0) P.objects.splice(i, 1); }
    extra = [];
  }
  function park() {
    // Upstream balls wait under the floor (out of view, no water contact)
    // until a shot uses them.
    BASE.forEach((b, i) => { b.startGrab(V(-0.6 + 0.6 * i, -3, 0)); });
  }
  function release(b, pos, vel) { b.startGrab(pos); b.endGrab(pos, vel); }
  function addBall(pos, r, density, color) { const b = new Ball(pos, r, density, color); P.objects.push(b); extra.push(b); return b; }
  function begin() {
    events = []; wave = null; clearExtra(); park(); resetWater();
    P.paused = false;
  }
  // Camera move: from A to B in T seconds with an ease. A and B are
  // { p: [x, y, z] camera, t: [x, y, z] target }.
  function move(A, B, T) { cam = { A, B, T }; }
  function at(t, fn) { events.push({ t, fn }); }
  const rnd = (c, a, b) => a + (b - a) * c.rng();
  const COLORS = [0xffff00, 0xff8000, 0xff0000, 0x30c0ff, 0x60ff60, 0xff40c0, 0xffffff];
  const EQ = ['∂²h/∂t² = c² ∇²h', 'F = ρ g V_sub'];
  const CODE_WAVE = { lang: 'js', name: 'simulateSurface', text: [
    'sumH += i > 0 ? this.heights[id - this.numZ] : h;',
    'sumH += i < this.numX - 1 ? this.heights[id + this.numZ] : h;',
    'sumH += j > 0 ? this.heights[id - 1] : h;',
    'sumH += j < this.numZ - 1 ? this.heights[id + 1] : h;',
    'this.velocities[id] += gPhysicsScene.dt * c * (sumH - 4.0 * h)'].join('\n') };
  const CODE_BUOY = { lang: 'js', name: 'simulateCoupling', text: [
    'let bodyHalfHeight = Math.sqrt(br * br - r2);',
    'let waterHeight = this.heights[xi * this.numZ + zi];',
    'let bodyMin = Math.max(pos.y - bodyHalfHeight, 0.0);',
    'let bodyMax = Math.min(pos.y + bodyHalfHeight, waterHeight);',
    'var bodyHeight = Math.max(bodyMax - bodyMin, 0.0);',
    'ball.applyForce(-bodyHeight * h2 * gPhysicsScene.gravity.y);'].join('\n') };

  TMP.saver({
    canvas: () => gRenderer.domElement,
    bg: '#000',
    fit(w, h) {
      // A 3D view: resize the renderer and the refraction target, no rebuild.
      gRenderer.setSize(w, h); gRenderTarget.setSize(w, h);
      gCamera.aspect = w / h; gCamera.updateProjectionMatrix();
      return false;
    },
    enter() {
      // The saver drives the camera. update() still calls
      // gCameraControl.update(), which keeps the camera and its target.
      gCameraControl.enabled = false;
      for (const b of BASE) b.visMesh.visible = true;
    },
    shots: [
      { key: 'drop', label: { title: 'Drop', lines: ['Three balls fall in; each one pushes water aside and makes a ring wave.'], eq: EQ, code: CODE_WAVE },
        run(c) {
          begin();
          const order = [0, 1, 2].sort(() => c.rng() - 0.5);
          order.forEach((k, i) => at(0.4 + 1.3 * i, () => release(BASE[k], V(rnd(c, -0.8, 0.8), rnd(c, 1.6, 2.2), rnd(c, -1.0, 1.0)), V(0, 0, 0))));
          const s = c.rng() < 0.5 ? -1 : 1;
          move({ p: [s * 1.2, 3.0, 3.4], t: [0, 0.7, 0] }, { p: [s * 0.3, 1.9, 2.0], t: [0, 0.75, 0] }, 9);
        } },
      { key: 'throw', label: { title: 'Throw', lines: ['Balls thrown across the pool skip, splash and float.'], eq: EQ, code: CODE_BUOY },
        run(c) {
          begin();
          [0, 1, 2].forEach((k, i) => at(0.3 + 1.6 * i, () => {
            const sx = c.rng() < 0.5 ? -1 : 1;
            release(BASE[k], V(sx * 1.0, 1.3, rnd(c, -1.2, 1.2)), V(-sx * rnd(c, 1.5, 3.0), rnd(c, 0.5, 2.0), rnd(c, -1, 1)));
          }));
          move({ p: [-2.6, 1.4, 2.4], t: [-0.4, 0.8, 0] }, { p: [2.6, 1.6, 2.4], t: [0.4, 0.8, 0] }, 10);
        } },
      { key: 'rain', label: { title: 'Rain of Balls', lines: ['Light balls float, heavy balls sink.', 'Each one is coupled two-way to the height field.'], eq: ['F_up = ρ_w g V_sub', 'ρ_ball > ρ_w ⇒ sink'], code: CODE_BUOY },
        run(c) {
          begin();
          const n = 7 + Math.floor(c.rng() * 5);
          for (let i = 0; i < n; i++) at(0.2 + 0.6 * i, () => {
            const r = rnd(c, 0.08, 0.2), d = c.rng() < 0.3 ? rnd(c, 1.5, 3) : rnd(c, 0.15, 0.7);
            addBall({ x: rnd(c, -1.0, 1.0), y: rnd(c, 1.8, 2.4), z: rnd(c, -1.2, 1.2) }, r, d, COLORS[Math.floor(c.rng() * COLORS.length)]);
          });
          const a = rnd(c, 0, 6.28);
          move({ p: [3.2 * Math.sin(a), 3.4, 3.2 * Math.cos(a)], t: [0, 0.6, 0] }, { p: [3.0 * Math.sin(a + 1.3), 1.6, 3.0 * Math.cos(a + 1.3)], t: [0, 0.8, 0] }, 11);
        } },
      { key: 'wavemaker', label: { title: 'Wave Maker', lines: ['A held ball dips up and down; rings spread and reflect off the walls.'], eq: ['c = √(g h)', '∂²h/∂t² = c² ∇²h'], code: CODE_WAVE },
        run(c) {
          begin();
          const b = BASE[1];
          wave = { b, x: rnd(c, -0.5, 0.5), z: rnd(c, -0.7, 0.7), f: rnd(c, 0.8, 1.3) };
          move({ p: [0.0, 3.6, 0.4], t: [0, 0.7, 0] }, { p: [1.8, 1.5, 2.0], t: [wave.x, 0.8, wave.z] }, 10);
          return () => { b.endGrab(b.pos.clone(), V(0, 0, 0)); };
        } },
    ],
    tick(dt, c) {
      for (let i = events.length - 1; i >= 0; i--) if (c.t >= events[i].t) { const e = events[i]; events.splice(i, 1); e.fn(); }
      if (wave) {
        const y = P.waterHeight + 0.05 + 0.22 * Math.sin(2 * Math.PI * wave.f * c.t * (1.1 - 0.4 * c.calm));
        if (!wave.b.grabbed) wave.b.startGrab(V(wave.x, y, wave.z)); else wave.b.moveGrabbed(V(wave.x, y, wave.z));
      }
      if (cam) {
        const u = Math.min(1, c.t / (cam.T * (0.8 + 0.4 * c.calm))), e = u * u * (3 - 2 * u);
        const L = (a, b) => a + (b - a) * e;
        gCamera.position.set(L(cam.A.p[0], cam.B.p[0]), L(cam.A.p[1], cam.B.p[1]), L(cam.A.p[2], cam.B.p[2]));
        gCameraControl.target.set(L(cam.A.t[0], cam.B.t[0]), L(cam.A.t[1], cam.B.t[1]), L(cam.A.t[2], cam.B.t[2]));
        gCamera.lookAt(gCameraControl.target);
      }
    },
  });
})();

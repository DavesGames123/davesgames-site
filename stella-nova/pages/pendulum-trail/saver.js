// Pendulum Trail · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (THREE,
// renderer, camera, cameraControl, pendulum, Pendulum, dt, paused,
// trailNum).
TMP.page({ n: null, title: 'Pendulum Trail', file: 'contribs/pendulumTrail.html', video: null, year: 2021, licence: null, by: 'Shengzhe Hou', from: 'China' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // A new start state from the seeded rng: each link points in a random
  // direction, mostly up, so the pendulum falls through a new path. ws are
  // the inverse masses (pivot 0, fixed), link length 0.8..1.15.
  function restart(c) {
    const p = pendulum;
    p.length = 0.8 + 0.35 * c.rng();
    p.ws = [0, 1, 1, 1].map((w, i) => i ? Math.pow(2, 2 * c.rng() - 1) : 0);
    for (let i = 1; i <= 3; i++) {
      const az = c.rng() * 2 * Math.PI, el = -0.3 + 1.5 * c.rng(), a = p.pos[i - 1];
      p.pos[i] = { x: a.x + p.length * Math.cos(el) * Math.sin(az), y: a.y + p.length * Math.sin(el), z: a.z + p.length * Math.cos(el) * Math.cos(az) };
      p.prevPos[i] = { x: p.pos[i].x, y: p.pos[i].y, z: p.pos[i].z };
      p.vel[i] = { x: 0, y: 0, z: 0 };
    }
    dt = (1 / 60) * (1.3 - 0.6 * c.calm);
    // A new trail from the new tip; its length (in frames) varies per shot.
    p.trailPoints = [V(p.pos[3].x, p.pos[3].y, p.pos[3].z)];
    trailNum = 120 + Math.floor(c.rng() * 180);
    paused = false;
  }
  // Camera path of the current shot: path(t) returns { pos, look }; t is
  // the shot time in s, scaled by calm.
  let path = null;
  const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const orbit = (az, el, r, look) => V(look.x + r * Math.cos(el) * Math.sin(az), look.y + r * Math.sin(el), look.z + r * Math.cos(el) * Math.cos(az));
  const tip = () => pendulum.pos[3];
  const EQ = ['C = |xᵢ − xᵢ₋₁| − l', 'Δx = −C n wᵢ / (wᵢ₋₁ + wᵢ)', 'Δt_sub = (1/60 s) / 100 000'];
  const CODE = { lang: 'js', name: 'simulate', text: [
    'let d = Math.sqrt(dx * dx + dy * dy + dz * dz);',
    'let w0 = this.ws[i - 1];',
    'let w1 = this.ws[i];',
    'let corr = (this.length - d) / d / (w0 + w1);',
    'this.pos[i - 1].x -= w0 * corr * dx;',
    'this.pos[i].x += w1 * corr * dx;'].join('\n') };

  TMP.saver({
    canvas: () => renderer.domElement,
    bg: '#000',
    enter() {
      // The camera is the autopilot's: OrbitControls takes no input, and
      // its target follows the shot's look point (update() still runs).
      cameraControl.enabled = false;
      // The band is short and wide: a narrower lens (upstream 70°) makes
      // the pendulum larger in it.
      camera.fov = 40; camera.updateProjectionMatrix();
      // Upstream fog runs from 0 to 15 for a camera 4 units out. The saver
      // camera is 6-10 units out: move the fog back with it.
      threeScene.fog.near = 5; threeScene.fog.far = 24;
      // Upstream draw() makes a new link line and a new trail line each
      // frame and does not free the old ones. Free their geometry (GPU
      // buffers), so a long saver run holds no leak. Do not dispose the
      // materials: that releases the shared shader program, and three.js
      // then compiles it again each frame. draw() also logs the trail length
      // each frame; the saver mutes that log while draw() runs.
      const draw = Pendulum.prototype.draw, mute = () => {};
      Pendulum.prototype.draw = function () {
        const old = [this.link, this.trail], log = console.log;
        console.log = mute;
        try { draw.call(this); } finally { console.log = log; }
        for (const o of old) if (o && o !== this.link && o !== this.trail) o.geometry.dispose();
      };
    },
    fit(w, h) {
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      return false;
    },
    shots: [
      { key: 'push', label: { title: 'Release', lines: ['Three links start in random directions and fall.', 'The red trail draws the path of the tip.'], eq: EQ, code: CODE },
        run(c) { restart(c); const az = c.rng() * 6.28, el = 0.15 + 0.2 * c.rng(), L = V(0, -0.8, 0);
          path = t => ({ pos: orbit(az + 0.03 * t, el, 10 - 4 * ease(t / 9), L), look: L }); } },
      { key: 'orbit', label: { title: 'Around the Pivot', lines: ['The camera goes around to a new side.', 'Chaos: no two runs take the same path.'], eq: EQ },
        run(c) { restart(c); const az = c.rng() * 6.28, d = (c.rng() < 0.5 ? -1 : 1) * (1.4 + 0.6 * c.rng()), L = V(0, -0.8, 0);
          path = t => ({ pos: orbit(az + d * ease(t / 10), 0.2 + 0.15 * Math.sin(0.3 * t), 7, L), look: L }); } },
      { key: 'top', label: { title: 'From Above', lines: ['Seen from above, the trail shows the tip moving through all three axes.'], eq: EQ, code: CODE },
        run(c) { restart(c); const az = c.rng() * 6.28, L = V(0, -0.5, 0);
          path = t => ({ pos: orbit(az + 0.08 * t, 0.75 + 0.6 * ease(t / 8), 7.5, L), look: L }); } },
      { key: 'truck', label: { title: 'Along the Grid', lines: ['A low camera moves side to side past the pendulum.'], eq: EQ },
        run(c) { restart(c); const az = c.rng() * 6.28, s = c.rng() < 0.5 ? -1 : 1;
          path = t => { const u = s * (3 - 6 * ease(t / 10)), fx = Math.cos(az), fz = -Math.sin(az), L = V(u * fx * 0.6, -1.0, u * fz * 0.6);
            return { pos: V(L.x + 6.8 * Math.sin(az), -0.6, L.z + 6.8 * Math.cos(az)), look: L }; }; } },
      { key: 'chase', label: { title: 'Follow the Tip', lines: ['The camera holds its place and turns to follow the tip and its trail.'], eq: ['x₃(t): the chaotic path of the tip', 'trail: the last 120..300 frames'] },
        run(c) { restart(c); const P = orbit(c.rng() * 6.28, 0.1 + 0.2 * c.rng(), 6.5, V(0, -1, 0)), L = V(0, -1, 0);
          path = (t, dt) => { const k = 1 - Math.exp(-2 * dt), q = tip(); L.x += (q.x * 0.6 - L.x) * k; L.y += (q.y * 0.6 - 0.4 - L.y) * k; L.z += (q.z * 0.6 - L.z) * k; return { pos: P, look: L }; }; } },
    ],
    tick(dt, c) {
      if (!path) return;
      const s = 1.15 - 0.5 * c.calm;
      const v = path(c.t * s, dt);
      camera.position.copy(v.pos);
      cameraControl.target.copy(v.look);
      camera.lookAt(v.look);
    },
  });
})();

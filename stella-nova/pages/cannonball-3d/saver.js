// Cannonball 3D · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only uses its globals (THREE,
// threeScene, renderer, camera, cameraControl, physicsScene, Ball).
//
// Camera. The saver turns OrbitControls off (enabled = false, and update()
// does nothing, because main.js update() calls it each frame and it would
// aim the camera back at its own target). tick() then moves the camera on a
// path per shot: a push-in, a truck, an orbit to a new side, or a chase.
TMP.page({ n: '02', title: 'Cannonball 3D', file: '02-cannonball3d.html', video: 'j84zJ06wnVA', year: 2021, licence: 'MIT' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let path = null, edges = null;
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
  // Keep ball 0 (the upstream ball), take the other meshes out, add n balls.
  function balls(r, n, vy) {
    const O = physicsScene.objects;
    for (let i = 1; i < O.length; i++) threeScene.remove(O[i].visMesh);
    O.length = 1;
    for (let i = 0; i < n; i++) {
      const rad = i === 0 ? 0.2 : 0.08 + 0.12 * r();
      const pos = V((2 * r() - 1) * 1.3, rad + r() * 1.2, (2 * r() - 1) * 2.3);
      const vel = V((2 * r() - 1) * 3, vy[0] + r() * (vy[1] - vy[0]), (2 * r() - 1) * 3);
      if (i === 0) { O[0].pos.copy(pos); O[0].vel.copy(vel); continue; }
      const b = new Ball(pos, rad, vel, threeScene);
      b.visMesh.material.color.setHSL(r(), 0.75, 0.55); b.visMesh.castShadow = true;
      O.push(b);
    }
    O[0].visMesh.castShadow = true;
  }
  function set(k, g) {
    physicsScene.paused = false;
    physicsScene.gravity.set(0, g, 0);
    physicsScene.dt = (1.0 / 60.0) * (1.2 - 0.5 * k.calm);
  }
  // A camera path: from pose a to pose b over T seconds (longer when calm).
  function move(k, a, b, T) { path = { a, b, T: T * (0.8 + 0.6 * k.calm) }; }
  const side = r => (r() < 0.5 ? -1 : 1);
  const CODE = { lang: 'js', name: 'Ball.simulate', text:
    'this.vel.addScaledVector(physicsScene.gravity, physicsScene.dt);\nthis.pos.addScaledVector(this.vel, physicsScene.dt);\n\nif (this.pos.y < this.radius) {\n\tthis.pos.y = this.radius; this.vel.y = -this.vel.y;\n}' };
  const EQ = ['v ← v + g Δt', 'x ← x + v Δt'];

  TMP.saver({
    canvas: () => renderer.domElement,
    bg: '#000',
    enter() {
      cameraControl.enabled = false; cameraControl.update = function () {};
      camera.fov = 40; camera.updateProjectionMatrix();
      // the walls of the box (worldSize), so the bounces off them read
      const W = physicsScene.worldSize, g = new THREE.BoxGeometry(2 * W.x, 1.6, 2 * W.z);
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x8fa4c0, transparent: true, opacity: 0.45 }));
      edges.position.set(0, 0.8, 0); threeScene.add(edges);
    },
    fit(w, h) {
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      return false;
    },
    shots: [
      { key: 'push', label: { title: 'Cannonball in 3D', lines: ['One ball, gravity, and a box of walls.', 'The same Euler step as in 2D, with THREE.Vector3.'], eq: EQ, code: CODE },
        run(k) { set(k, -10); balls(k.rng, 1, [4, 6]); const s = side(k.rng);
          move(k, { p: V(3.5 * s, 2.6, 7.5), t: V(0, 0.5, 0) }, { p: V(1.2 * s, 1.0, 3.6), t: V(0, 0.5, 0) }, 10); } },
      { key: 'chase', label: { title: 'Chase Camera', lines: ['The camera follows the ball through its bounces.'], eq: ['v_y′ = −v_y  (floor)', 'v_x′ = −v_x  (wall)'], code: CODE },
        run(k) { set(k, -10); balls(k.rng, 1, [5, 6.5]); path = { chase: true, az: k.rng() * 6.28, T: 1 }; } },
      { key: 'many', label: { title: 'A Box of Balls', lines: ['Twelve balls; they do not collide with each other.', 'Each one is the same three lines of physics.'], eq: EQ, code: CODE },
        run(k) { set(k, -10); balls(k.rng, 12, [2, 6]); const s = side(k.rng);
          move(k, { p: V(-3.2 * s, 1.5, 4.6), t: V(-0.8 * s, 0.4, 0) }, { p: V(3.2 * s, 1.5, 4.6), t: V(0.8 * s, 0.4, 0) }, 11); } },
      { key: 'top', label: { title: 'From Above', lines: ['Seen from the top, the path is a billiard in the x-z plane.'], eq: ['x ∈ [−1.5, 1.5]', 'z ∈ [−2.5, 2.5]'], code: CODE },
        run(k) { set(k, -10); balls(k.rng, 6, [3, 5]); path = { top: true, T: 10 * (0.8 + 0.6 * k.calm) }; } },
      { key: 'orbit', label: { title: 'Low Orbit', lines: ['The camera goes round the box at floor height.'], eq: EQ, code: CODE },
        run(k) { set(k, -10); balls(k.rng, 5, [3, 6]); const a0 = k.rng() * 6.28, s = side(k.rng);
          path = { orbit: true, a0, da: s * 1.6, R: 6, y: 0.35, T: 10 * (0.8 + 0.6 * k.calm) }; } },
      { key: 'moon', label: { title: 'Moon Gravity', lines: ['g = 1.62 m/s²: slow, high arcs.'], eq: ['g = 1.62 m/s²', 'h = v_y² / 2g'], code: CODE },
        run(k) { set(k, -1.62); balls(k.rng, 8, [1, 2.2]); const s = side(k.rng);
          move(k, { p: V(5 * s, 0.6, 5), t: V(0, 0.6, 0) }, { p: V(2.5 * s, 2.2, 6), t: V(0, 0.4, 0) }, 11); } },
    ],
    tick(dt, k) {
      if (!path) return;
      const u = ease(k.t / path.T);
      // up is +x only in the top view: the long side of the box (z) then
      // runs across the wide band
      camera.up.set(path.top ? 1 : 0, path.top ? 0 : 1, 0);
      if (path.top) {
        camera.position.set(0, 6.2 - 1.4 * u, 0); camera.lookAt(0, 0, 0);
      } else if (path.chase) {
        const b = physicsScene.objects[0].pos, a = path.az + 0.15 * k.t;
        const want = V(b.x + Math.sin(a) * 3, 0.7 + 0.5 * b.y, b.z + Math.cos(a) * 3);
        camera.position.lerp(want, Math.min(1, dt * 2)); camera.lookAt(b.x, 0.3 + 0.7 * b.y, b.z);
      } else if (path.orbit) {
        const a = path.a0 + path.da * u;
        camera.position.set(Math.sin(a) * path.R, path.y, Math.cos(a) * path.R); camera.lookAt(0, 0.5, 0);
      } else {
        camera.position.lerpVectors(path.a.p, path.b.p, u);
        const t = V().lerpVectors(path.a.t, path.b.t, u); camera.lookAt(t);
      }
    },
  });
})();

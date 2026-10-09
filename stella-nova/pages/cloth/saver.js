// Cloth · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals
// (initPhysics, gGrabber, gPhysicsScene, gThreeScene, gCamera, gRenderer,
// gCameraControl, run, onShowEdges). The autopilot picks the cloth with
// the upstream raycast (gGrabber.start at the screen point of a particle),
// drags it with Cloth.moveGrabbed and lets go with Cloth.endGrab, as the
// mouse does. Restart rebuilds the cloth with initPhysics() in place of the
// page reload. "Drop a corner" gives a pinned particle its mass back.
TMP.page({ n: '14', title: 'Cloth', file: '14-cloth.html', video: 'z5oWopN39OU', year: 2022, licence: 'MIT' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ease = u => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const cloth = () => gPhysicsScene.objects[0];

  // ---- cloth ----
  function centerOf(b, out) {
    out.set(0, 0, 0);
    for (let i = 0; i < b.numParticles; i++) { out.x += b.pos[3 * i]; out.y += b.pos[3 * i + 1]; out.z += b.pos[3 * i + 2]; }
    return out.divideScalar(b.numParticles);
  }
  const P = (b, i) => V(b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]);
  // The pinned corners (invMass 0 after Cloth.initPhysics) and the mass
  // they get back when dropped: the largest particle invMass of the cloth.
  let pins = [], pinMass = 1;
  // The Restart button reloads the page; here the old cloth leaves the
  // scene and initPhysics() makes a new one, pinned at the top corners.
  function restartCloth(bending, edges) {
    for (const b of gPhysicsScene.objects) {
      gThreeScene.remove(b.triMesh); gThreeScene.remove(b.edgeMesh);
      b.triMesh.geometry.dispose(); b.edgeMesh.geometry.dispose();
    }
    gPhysicsScene.objects = [];
    initPhysics();
    const b = cloth();
    b.bendingCompliance = bending;
    pins = []; pinMass = 0;
    for (let i = 0; i < b.numParticles; i++) { if (b.invMass[i] === 0) pins.push(i); else pinMass = Math.max(pinMass, b.invMass[i]); }
    // onShowEdges() flips the flag and sets every mesh to it.
    if (gPhysicsScene.showEdges !== edges) onShowEdges();
    else { b.edgeMesh.visible = edges; b.triMesh.visible = !edges; }
  }
  // side -1 drops the pins left of the centre, +1 those to the right.
  function dropPins(side) {
    const b = cloth();
    for (const i of pins) if (Math.sign(b.pos[3 * i]) === side && b.invMass[i] === 0 && b.grabId !== i) b.invMass[i] = pinMass;
  }
  // A random particle of the cloth; low = from the lower half.
  function someParticle(c, low) {
    const b = cloth();
    let best = 0, by = 1e9;
    for (let k = 0; k < (low ? 8 : 1); k++) { const i = Math.floor(c.rng() * b.numParticles), y = b.pos[3 * i + 1]; if (y < by) { by = y; best = i; } }
    return P(b, best);
  }

  // ---- camera: a spherical pose around a target, eased from a to b ----
  // pose = { az, el, r, tx, ty, tz }. follow (0..1) pulls the target
  // toward a smoothed copy of the cloth centre.
  const cam = { a: null, b: null, t: 0, dur: 1, follow: 0, fp: V(0, 0.7, 0), f: V(0, 0, 0) };
  function setPose(p) {
    const ce = Math.cos(p.el);
    gCamera.position.set(p.tx + p.r * ce * Math.sin(p.az), p.ty + p.r * Math.sin(p.el), p.tz + p.r * ce * Math.cos(p.az));
    gCamera.lookAt(p.tx, p.ty, p.tz);
    gCamera.updateMatrixWorld();
  }
  function camMove(a, b, dur, follow) {
    cam.a = a; cam.b = b; cam.t = 0; cam.dur = dur; cam.follow = follow || 0;
    centerOf(cloth(), cam.fp); camTick(0);
  }
  function camTick(dt) {
    if (!cam.a) return;
    cam.t += dt;
    cam.fp.lerp(centerOf(cloth(), cam.f), Math.min(1, dt * 1.5));
    const u = ease(Math.min(1, cam.t / cam.dur)), p = {}, f = cam.follow;
    for (const k in cam.a) p[k] = lerp(cam.a[k], cam.b[k], u);
    p.tx = lerp(p.tx, cam.fp.x, f); p.ty = lerp(p.ty, cam.fp.y, f); p.tz = lerp(p.tz, cam.fp.z, f);
    setPose(p);
  }

  // ---- hand: the autopilot mouse ----
  // grab() picks with the upstream raycast; path() moves the grabbed
  // particle along straight segments [x, y, z, seconds]; release() lets go
  // with the velocity of the last segment.
  const hand = { obj: null, pos: V(0, 0, 0), prev: V(0, 0, 0), vel: V(0, 0, 0), keys: [], from: V(0, 0, 0), k: 0, t: 0 };
  function screenOf(p) {
    const v = p.clone().project(gCamera), r = gRenderer.domElement.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }
  function grab(p) {
    const [x, y] = screenOf(p);
    gGrabber.start(x, y);
    const obj = gGrabber.physicsObject;
    gGrabber.physicsObject = null;
    if (!obj) return false;
    const ray = gGrabber.raycaster.ray;
    hand.obj = obj; hand.pos.copy(ray.origin).addScaledVector(ray.direction, gGrabber.distance);
    hand.prev.copy(hand.pos); hand.vel.set(0, 0, 0); hand.keys = []; hand.k = 0;
    return true;
  }
  function path(keys) { hand.keys = keys; hand.k = 0; hand.t = 0; hand.from.copy(hand.pos); }
  function release() {
    if (hand.obj) hand.obj.endGrab(hand.pos, hand.vel);
    hand.obj = null; hand.keys = [];
  }
  function handTick(dt) {
    if (!hand.obj || dt <= 0) return;
    hand.prev.copy(hand.pos);
    const key = hand.keys[hand.k];
    if (key) {
      hand.t += dt;
      const u = Math.min(1, hand.t / key[3]);
      hand.pos.set(lerp(hand.from.x, key[0], u), lerp(hand.from.y, key[1], u), lerp(hand.from.z, key[2], u));
      if (u >= 1) { hand.k++; hand.t = 0; hand.from.copy(hand.pos); }
      hand.vel.copy(hand.pos).sub(hand.prev).divideScalar(dt);
    }
    hand.obj.moveGrabbed(hand.pos, hand.vel);
  }
  const handBusy = () => hand.obj && hand.k < hand.keys.length;
  // Move the grabbed particle by offsets from where it was picked.
  function pathRel(rel) { const o = hand.pos.clone(); path(rel.map(k => [o.x + k[0], Math.max(0.02, o.y + k[1]), o.z + k[2], k[3]])); }

  // ---- script: a generator per shot; it yields seconds to wait ----
  // A yield of 0 waits one frame.
  let script = null, wait = 0, slow = 1;
  function play() { if (gPhysicsScene.paused) run(); }
  // A new shot lets go of the old grab, drops the old script and hangs a
  // new cloth.
  function begin(c, bending, edges) {
    release(); script = null; wait = 0; slow = 0.8 + 0.5 * c.calm;
    restartCloth(bending, edges);
    play();
  }
  // A drag: pick a particle, move it through offsets, let go.
  function* drag(c, low, rel, still) {
    if (!grab(someParticle(c, low))) { yield 0.4; return; }
    pathRel(rel.map(k => [k[0], k[1], k[2], k[3] * slow]));
    while (handBusy()) yield 0;
    if (still) hand.vel.set(0, 0, 0);
    release();
  }
  const sgn = c => (c.rng() < 0.5 ? -1 : 1);

  const EQ = ['C = |x₁ − x₂| − l₀', 'α̃ = α / Δt²', 'Δx₁ = −w₁ C / (w₁ + w₂ + α̃) · n'];
  const CODE_STRETCH = { lang: 'js', name: 'solveStretching', text: 'vecSetDiff(this.grads,0, this.pos,id0, this.pos,id1);\nvar len = Math.sqrt(vecLengthSquared(this.grads,0));\nvecScale(this.grads,0, 1.0 / len);\nvar C = len - restLen;\nvar s = -C / (w + alpha);\nvecAdd(this.pos,id0, this.grads,0, s * w0);\nvecAdd(this.pos,id1, this.grads,0, -s * w1);' };
  const CODE_BEND = { lang: 'js', name: 'solveBending', text: 'var id0 = this.bendingIds[4 * i + 2];\nvar id1 = this.bendingIds[4 * i + 3];\nvar alpha = compliance / dt /dt;\nvar C = len - restLen;\nvar s = -C / (w + alpha);' };

  TMP.saver({
    canvas: () => gRenderer.domElement,
    bg: '#000',
    fit(w, h) {
      // The band is wide and low: a 40° lens (upstream 70°) keeps the
      // subject large in it.
      gRenderer.setSize(w, h);
      gCamera.fov = 40; gCamera.aspect = w / h; gCamera.updateProjectionMatrix();
      return false;
    },
    enter() { gCameraControl.enabled = false; play(); },
    shots: [
      { key: 'pull', label: { title: 'Pull and Let Go', lines: ['Pinned at two corners; a pull and a release start the swing.'], eq: EQ, code: CODE_STRETCH },
        run(c) {
          begin(c, 1, false);
          const az = sgn(c) * (0.2 + 0.6 * c.rng());
          camMove({ az, el: 0.15, r: 1.9, tx: 0, ty: 0.7, tz: 0 }, { az: -az * 0.8, el: 0.3, r: 1.45, tx: 0, ty: 0.65, tz: 0 }, 11, 0.4);
          script = (function* () {
            yield 0.4;
            for (;;) {
              const s = sgn(c), d = 0.25 + 0.2 * c.rng();
              yield* drag(c, true, [[0.1 * s, 0.1, d, 0.9], [0.25 * s, 0.25, d + 0.1, 0.5], [0.1 * s, 0.15, d - 0.2, 0.2]], false);
              yield (1.6 + c.rng()) * slow;
            }
          })();
        } },
      { key: 'drop', label: { title: 'Drop a Corner', lines: ['One pin goes, then the other: the cloth swings and falls to the ground.'], eq: ['v ← v + g Δt', 'x ← x + v Δt', 'y < 0 ⇒ y ← 0'], code: CODE_STRETCH },
        run(c) {
          begin(c, 1 + 2 * c.rng(), false);
          const s = sgn(c);
          camMove({ az: s * 0.9, el: 0.1, r: 1.9, tx: -s * 0.15, ty: 0.65, tz: 0 }, { az: s * 0.3, el: 0.5, r: 1.5, tx: s * 0.1, ty: 0.3, tz: 0 }, 11, 0.45);
          script = (function* () {
            const first = sgn(c);
            yield 0.8 * slow; dropPins(first);
            yield (2.2 + c.rng()) * slow; dropPins(-first);
            yield 2.2 * slow;
            for (;;) {
              yield* drag(c, false, [[0, 0.5, 0, 1.2], [0, 0.5, 0, 0.5], [0.2 * sgn(c), 0.45, 0.1, 0.6]], true);
              yield (2.0 + c.rng()) * slow;
            }
          })();
        } },
      { key: 'bend', label: { title: 'Bending Compliance', lines: ['Bending is a distance constraint across each pair of triangles.', 'Zero compliance is stiff; high compliance is silk.'], eq: ['C = |x₃ − x₄| − l₀', 'α̃ = α / Δt²'], code: CODE_BEND },
        run(c) {
          const soft = c.rng() < 0.5;
          begin(c, soft ? 6 + 4 * c.rng() : 0, false);
          const az = sgn(c) * (0.5 + 0.5 * c.rng());
          camMove({ az, el: 0.2, r: 1.7, tx: 0, ty: 0.6, tz: 0 }, { az: az * 0.2, el: 0.1, r: 1.3, tx: 0, ty: 0.7, tz: 0 }, 10, 0.35);
          script = (function* () {
            yield 0.4;
            for (;;) {
              const s = sgn(c);
              yield* drag(c, true, [[0, 0.3, 0.2, 0.8], [-0.3 * s, 0.6, 0.15, 0.8], [-0.3 * s, 0.6, 0.15, 0.6]], true);
              yield (1.4 + c.rng()) * slow;
            }
          })();
        } },
      { key: 'edges', label: { title: 'Show Edges', lines: ['The triangle mesh: each edge is a stretching constraint.'], eq: EQ },
        run(c) {
          begin(c, 1, true);
          const az = sgn(c) * (0.3 + 0.4 * c.rng());
          camMove({ az, el: 0.05, r: 1.3, tx: 0, ty: 0.75, tz: 0 }, { az: az + sgn(c) * 0.6, el: 0.25, r: 1.1, tx: 0, ty: 0.7, tz: 0 }, 10, 0.3);
          script = (function* () {
            yield 0.4;
            for (;;) {
              const s = sgn(c);
              yield* drag(c, c.rng() < 0.5, [[0.15 * s, 0.05, 0.3, 0.9], [-0.15 * s, 0.1, 0.25, 0.7], [0, 0, 0.1, 0.25]], false);
              yield (1.5 + c.rng()) * slow;
            }
          })();
        } },
    ],
    tick(dt, c) {
      camTick(dt);
      handTick(dt);
      if (script) {
        wait -= dt;
        while (script && wait <= 0) {
          const r = script.next();
          if (r.done) script = null; else if (r.value === 0) { wait = 0; break; } else wait += r.value;
        }
      }
    },
  });
})();

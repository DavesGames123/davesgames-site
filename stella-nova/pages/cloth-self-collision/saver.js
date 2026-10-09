// Cloth Self-Collision · site layer: the credit record and the screensaver
// shots. main.js is the upstream demo; this file only calls its globals
// (initPhysics, onCollision, gGrabber, gPhysicsScene, gThreeScene, gCamera,
// gRenderer, gCameraControl, run). The autopilot picks the cloth with the
// upstream raycast (gGrabber.start at the screen point of a particle),
// drags it with Cloth.moveGrabbed and lets go with Cloth.endGrab, as the
// mouse does. Restart rebuilds the strip with initPhysics() in place of the
// page reload; each shot opens on the strip as it falls.
TMP.page({ n: '15', title: 'Cloth Self-Collision', file: '15-selfCollision.html', video: 'XY3dLpgOk4Q', year: 2022, licence: 'MIT' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ease = u => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const cloth = () => gPhysicsScene.cloth;

  // ---- cloth ----
  const P = (b, i) => V(b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]);
  // The Restart button reloads the page; here the old strip leaves the
  // scene and initPhysics() makes a new one, standing on its lower end.
  function restartCloth(collide) {
    const b = cloth();
    if (b) {
      gThreeScene.remove(b.triMesh); gThreeScene.remove(b.backMesh); gThreeScene.remove(b.edgeMesh);
      b.triMesh.geometry.dispose(); b.edgeMesh.geometry.dispose();
    }
    initPhysics();
    // onCollision() is the "Handle collisions" check box.
    if (cloth().handleCollisions !== collide) onCollision();
  }
  // The highest of a few random particles below 0.3 m: the top of the pile.
  function topParticle(c) {
    const b = cloth();
    let best = 0, by = -1e9;
    for (let k = 0; k < 60; k++) { const i = Math.floor(c.rng() * b.numParticles), y = b.pos[3 * i + 1]; if (y > by && y < 0.3) { by = y; best = i; } }
    return P(b, best);
  }
  // Wait until the strip lies on the ground (top end below 0.25 m), at
  // most 9 s.
  function* settle() {
    const b = cloth();
    for (let t = 0; t < 9; t += 0.25) {
      let top = 0;
      for (let i = 0; i < b.numParticles; i += 7) top = Math.max(top, b.pos[3 * i + 1]);
      if (top < 0.25) return;
      yield 0.25;
    }
  }
  // The centre of the particles below 0.6 m: the pile, not the falling end.
  function pileCenter(out) {
    const b = cloth();
    let n = 0; out.set(0, 0, 0);
    for (let i = 0; i < b.numParticles; i += 3) { const y = b.pos[3 * i + 1]; if (y < 0.6) { out.x += b.pos[3 * i]; out.y += y; out.z += b.pos[3 * i + 2]; n++; } }
    return n ? out.divideScalar(n) : out.set(0, 0.3, 0);
  }

  // ---- camera: a spherical pose around a target, eased from a to b ----
  // pose = { az, el, r, tx, ty, tz }. follow (0..1) pulls the target
  // toward a smoothed copy of the pile centre.
  const cam = { a: null, b: null, t: 0, dur: 1, follow: 0, fp: V(0, 0.1, 0), f: V(0, 0, 0) };
  function setPose(p) {
    const ce = Math.cos(p.el);
    gCamera.position.set(p.tx + p.r * ce * Math.sin(p.az), p.ty + p.r * Math.sin(p.el), p.tz + p.r * ce * Math.cos(p.az));
    gCamera.lookAt(p.tx, p.ty, p.tz);
    gCamera.updateMatrixWorld();
  }
  function camMove(a, b, dur, follow) {
    cam.a = a; cam.b = b; cam.t = 0; cam.dur = dur; cam.follow = follow || 0;
    pileCenter(cam.fp); camTick(0);
  }
  function camTick(dt) {
    if (!cam.a) return;
    cam.t += dt;
    cam.fp.lerp(pileCenter(cam.f), Math.min(1, dt * 1.5));
    const u = ease(Math.min(1, cam.t / cam.dur)), p = {}, f = cam.follow;
    for (const k in cam.a) p[k] = lerp(cam.a[k], cam.b[k], u);
    p.tx = lerp(p.tx, cam.fp.x, f); p.tz = lerp(p.tz, cam.fp.z, f);
    setPose(p);
  }

  // ---- hand: the autopilot mouse ----
  // grab() picks with the upstream raycast; path() moves the grabbed
  // particle along straight segments [x, y, z, seconds]; release() lets go
  // with the velocity of the last segment. The sim clamps particle speed to
  // 0.2 thickness per substep (1.2 m/s), so the hand moves slowly.
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
    if (hand.obj) { hand.vel.clampLength(0, 1); hand.obj.endGrab(hand.pos, hand.vel); }
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

  // ---- script: a generator per shot; it yields seconds to wait ----
  // A yield of 0 waits one frame.
  let script = null, wait = 0, slow = 1;
  function play() { if (gPhysicsScene.paused) run(); }
  // keep: a shot that works on the pile keeps the strip of the last shot
  // when it had collisions on, so it does not wait for a new fall.
  function begin(c, collide, keep) {
    release(); script = null; wait = 0; slow = 0.8 + 0.5 * c.calm;
    if (!(keep && cloth().handleCollisions === collide)) restartCloth(collide);
    play();
  }
  const sgn = c => (c.rng() < 0.5 ? -1 : 1);
  // After the fall: pick the top of the pile and drag it round a circle
  // on the floor, again and again.
  function* dragLoop(c) {
    yield* settle();
    for (;;) {
      if (grab(topParticle(c))) {
        const o = hand.pos.clone(), a0 = c.rng() * 6.28, s = sgn(c), R = 0.12 + 0.06 * c.rng(), keys = [[o.x, 0.08, o.z, 0.5 * slow]];
        for (let k = 1; k <= 6; k++) { const a = a0 + s * k * 1.05; keys.push([o.x + R * Math.cos(a), 0.06, o.z + R * Math.sin(a), 0.6 * slow]); }
        path(keys);
        while (handBusy()) yield 0;
        hand.vel.set(0, 0, 0); release();
      }
      yield (1.5 + c.rng()) * slow;
    }
  }

  const EQ = ['|xᵢ − xⱼ| < h ⇒ push apart to h', 'h = 0.01 m (thickness)', 'v ≤ 0.2 h / Δt'];
  const CODE_COLL = { lang: 'js', name: 'solveCollisions', text: 'var restDist2 = vecDistSquared(this.restPos,id0, this.restPos,id1);\nvar minDist = this.thickness;\nif (dist2 > restDist2)\n\tcontinue;\nif (restDist2 < thickness2)\n\tminDist = Math.sqrt(restDist2);\nvecScale(this.vecs,0, (minDist - dist) / dist);' };
  const CODE_CLAMP = { lang: 'js', name: 'Cloth.simulate', text: 'var v = Math.sqrt(vecLengthSquared(this.vel,i));\nvar maxV = 0.2 * this.thickness / dt;\nif (v > maxV) {\n\tvecScale(this.vel,i, maxV / v);\n}' };
  const CODE_HASH = { lang: 'js', name: 'Cloth.simulate', text: 'if (this.handleCollisions) {\n\tthis.hash.create(this.pos);\n\tvar maxTravelDist = maxVelocity * frameDt;\n\tthis.hash.queryAll(this.pos, maxTravelDist);\n}' };

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
      { key: 'pile', label: { title: 'Folding Pile', lines: ['A 2 m strip of 6000 particles falls and folds onto itself.', 'Particles keep one thickness apart.'], eq: EQ, code: CODE_COLL },
        run(c) {
          begin(c, true);
          const az = sgn(c) * (0.3 + 0.6 * c.rng());
          camMove({ az, el: 0.1, r: 1.0, tx: 0, ty: 0.35, tz: 0 }, { az: -az * 0.5, el: 0.35, r: 0.5, tx: 0, ty: 0.06, tz: 0 }, 9, 0.5);
        } },
      { key: 'off', label: { title: 'Collisions Off', lines: ['Handle collisions unchecked: the layers fall through each other,', 'and a drag pulls one layer through the rest.'], eq: ['no hash query', 'no particle–particle constraint'] },
        run(c) {
          begin(c, false);
          // The strip lies in the x-y plane: look at its face, not its edge.
          const az = (c.rng() < 0.5 ? 0 : Math.PI) + sgn(c) * (0.2 + 0.4 * c.rng());
          camMove({ az, el: 0.2, r: 0.9, tx: 0, ty: 0.3, tz: 0 }, { az: az + sgn(c) * 0.5, el: 0.6, r: 0.6, tx: 0, ty: 0.04, tz: 0 }, 9, 0.5);
          script = dragLoop(c);
        } },
      { key: 'lift', label: { title: 'Lift the Pile', lines: ['Pick the top of the pile and lift: the folds come apart without a snag.'], eq: EQ, code: CODE_CLAMP },
        run(c) {
          begin(c, true, true);
          const az = sgn(c) * (0.4 + 0.5 * c.rng());
          camMove({ az, el: 0.25, r: 0.8, tx: 0, ty: 0.12, tz: 0 }, { az: az * 0.3, el: 0.2, r: 0.85, tx: 0, ty: 0.2, tz: 0 }, 10, 0.5);
          script = (function* () {
            yield* settle();
            for (;;) {
              if (grab(topParticle(c))) {
                const o = hand.pos.clone(), s = sgn(c);
                path([[o.x, o.y + 0.25, o.z, 0.8 * slow], [o.x + 0.08 * s, o.y + 0.45, o.z + 0.05, 1.0 * slow], [o.x - 0.08 * s, o.y + 0.4, o.z, 0.9 * slow], [o.x, o.y + 0.4, o.z, 0.6 * slow]]);
                while (handBusy()) yield 0;
                hand.vel.set(0, 0, 0); release();
              }
              yield (2.5 + c.rng()) * slow;
            }
          })();
        } },
      { key: 'drag', label: { title: 'Drag Across the Floor', lines: ['The spatial hash finds each particle\'s neighbours once per frame.'], eq: ['cell = ⌊x / h⌋', 'query radius = v_max · Δt_frame'], code: CODE_HASH },
        run(c) {
          begin(c, true, true);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.55, r: 0.9, tx: 0, ty: 0.1, tz: 0 }, { az: az + sgn(c) * 0.8, el: 0.8, r: 0.75, tx: 0, ty: 0.02, tz: 0 }, 10, 0.6);
          script = dragLoop(c);
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

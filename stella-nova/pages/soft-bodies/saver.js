// Soft Bodies · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (SoftBody,
// bunnyMesh, gGrabber, gPhysicsScene, gCamera, gRenderer, gCameraControl,
// run, squash). The autopilot picks a bunny with the upstream raycast
// (gGrabber.start at the screen point of a particle), moves it with
// SoftBody.moveGrabbed and throws it with SoftBody.endGrab, as the mouse
// does. "Bodies++" is newBody() with the seeded random of the shot.
TMP.page({ n: '10', title: 'Soft Bodies', file: '10-softBodies.html', video: 'uCaHXkS2cUg', year: 2021, licence: 'MIT' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ease = u => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const bodies = () => gPhysicsScene.objects;

  // ---- bodies ----
  function centerOf(b, out) {
    out.set(0, 0, 0);
    for (let i = 0; i < b.numParticles; i++) { out.x += b.pos[3 * i]; out.y += b.pos[3 * i + 1]; out.z += b.pos[3 * i + 2]; }
    return out.divideScalar(b.numParticles);
  }
  const tmp = V(0, 0, 0);
  function focus(out) {
    if (hand.obj) return centerOf(hand.obj, out);
    out.set(0, 0, 0);
    for (const b of bodies()) out.add(centerOf(b, tmp));
    return out.divideScalar(Math.max(1, bodies().length));
  }
  // newBody() of the page, with a seeded position.
  function addBody(x, y, z) {
    const b = new SoftBody(bunnyMesh, gThreeScene);
    b.translate(x, y, z);
    b.edgeCompliance = compliance;
    gPhysicsScene.objects.push(b);
    return b;
  }
  function clearBodies() {
    for (const b of bodies()) { gThreeScene.remove(b.surfaceMesh); b.surfaceMesh.geometry.dispose(); }
    gPhysicsScene.objects = [];
  }
  let compliance = 0;
  function setCompliance(v) { compliance = v; for (const b of bodies()) b.edgeCompliance = v; }
  // A random particle in the top part of a body: an ear or the back.
  function topParticle(b, c) {
    let best = 0, by = -1e9;
    for (let k = 0; k < 12; k++) { const i = Math.floor(c.rng() * b.numParticles), y = b.pos[3 * i + 1]; if (y > by) { by = y; best = i; } }
    return V(b.pos[3 * best], b.pos[3 * best + 1], b.pos[3 * best + 2]);
  }

  // ---- camera: a spherical pose around a target, eased from a to b ----
  // pose = { az, el, r, tx, ty, tz }. follow (0..1) pulls the target
  // toward a smoothed copy of the body centre.
  const cam = { a: null, b: null, t: 0, dur: 1, follow: 0, fp: V(0, 0.4, 0), f: V(0, 0, 0) };
  function setPose(p) {
    const ce = Math.cos(p.el);
    gCamera.position.set(p.tx + p.r * ce * Math.sin(p.az), p.ty + p.r * Math.sin(p.el), p.tz + p.r * ce * Math.cos(p.az));
    gCamera.lookAt(p.tx, p.ty, p.tz);
    gCamera.updateMatrixWorld();
  }
  function camMove(a, b, dur, follow) {
    cam.a = a; cam.b = b; cam.t = 0; cam.dur = dur; cam.follow = follow || 0;
    focus(cam.fp); camTick(0);
  }
  function camTick(dt) {
    if (!cam.a) return;
    cam.t += dt;
    cam.fp.lerp(focus(cam.f), Math.min(1, dt * 2));
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

  // ---- script: a generator per shot; it yields seconds to wait ----
  // A yield of 0 waits one frame.
  let script = null, wait = 0, slow = 1;
  function play() { if (gPhysicsScene.paused) run(); }
  // A new shot lets go of the old grab and drops the old script.
  function begin(c, n, comp) {
    release(); script = null; wait = 0; slow = 0.8 + 0.5 * c.calm;
    setCompliance(comp);
    if (n) { clearBodies(); addBody(0, 0, 0); }
    play();
  }

  // A throw: lift a top particle, swing back, swing through, let go.
  function* throwBody(c, b, speed, up) {
    if (!grab(topParticle(b, c))) { yield 0.4; return; }
    const a = c.rng() * Math.PI * 2, dir = V(Math.cos(a), 0, Math.sin(a));
    const h = V(lerp(-0.3, 0.3, c.rng()), 1.3 + 0.3 * c.rng(), lerp(-0.3, 0.3, c.rng()));
    const back = h.clone().addScaledVector(dir, -0.5); back.y -= 0.2;
    const sw = 0.2, fwd = back.clone().addScaledVector(dir, speed * sw); fwd.y += up * sw;
    path([[h.x, h.y, h.z, 0.9 * slow], [h.x, h.y, h.z, 0.4 * slow], [back.x, back.y, back.z, 0.5 * slow], [fwd.x, fwd.y, fwd.z, sw]]);
    while (handBusy()) yield 0;
    release();
  }

  const EQ = ['α̃ = α / Δt²', 'Δλ = −C / (w₁ + w₂ + α̃)', 'C_vol = 6(V − V₀)'];
  const CODE_EDGE = { lang: 'js', name: 'solveEdges', text: 'var alpha = compliance / dt /dt;\nvecSetDiff(this.grads,0, this.pos,id0, this.pos,id1);\nvar len = Math.sqrt(vecLengthSquared(this.grads,0));\nvar C = len - restLen;\nvar s = -C / (w + alpha);\nvecAdd(this.pos,id0, this.grads,0, s * w0);\nvecAdd(this.pos,id1, this.grads,0, -s * w1);' };
  const CODE_SQUASH = { lang: 'js', name: 'squash', text: 'squash() {\n\tfor (var i = 0; i < this.numParticles; i++) {\n\t\tthis.pos[3 * i + 1] = 0.5;\n\t}\n\tthis.updateMeshes();\n}' };
  const CODE_VOL = { lang: 'js', name: 'solveVolumes', text: 'var vol = this.getTetVolume(i);\nvar restVol = this.restVol[i];\nvar C = vol - restVol;\nvar s = -C / (w + alpha);\nfor (var j = 0; j < 4; j++) {\n\tvar id = this.tetIds[4 * i + j];\n\tvecAdd(this.pos,id, this.grads,j, s * this.invMass[id])\n}' };

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
      { key: 'throw', label: { title: 'Grab and Throw', lines: ['The hand moves one particle; edge and volume constraints carry the rest.'], eq: EQ, code: CODE_EDGE },
        run(c) {
          begin(c, true, 0);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.3, r: 2.6, tx: 0, ty: 0.5, tz: 0 }, { az: az + (c.rng() < 0.5 ? -1 : 1) * (1 + c.rng()), el: 0.4, r: 2.1, tx: 0, ty: 0.5, tz: 0 }, 11, 0.9);
          script = (function* () { yield 0.5; for (;;) { const bs = bodies(); yield* throwBody(c, bs[Math.floor(c.rng() * bs.length)], 2.5 + 2 * c.rng(), 2 + 2 * c.rng()); yield (1.8 + c.rng()) * slow; } })();
        } },
      { key: 'squash', label: { title: 'Squash', lines: ['All particles flattened to one plane; the rest volume of each tet pushes the bunny back into shape.'], eq: ['C = V − V₀', '∇C₁ = ⅙ (x₄ − x₂) × (x₃ − x₂)'], code: CODE_SQUASH },
        run(c) {
          begin(c, true, 0);
          const az = (c.rng() < 0.5 ? -1 : 1) * (0.6 + 0.6 * c.rng());
          camMove({ az, el: 0.15, r: 2.4, tx: 0, ty: 0.4, tz: 0 }, { az: az * 0.4, el: 0.3, r: 1.6, tx: 0, ty: 0.35, tz: 0 }, 10, 0.3);
          script = (function* () { yield 0.6; for (;;) { squash(); play(); yield (2.6 + 1.2 * c.rng()) * slow; } })();
        } },
      { key: 'bodies', label: { title: 'Bodies++', lines: ['New bunnies fall in; each one is its own tet mesh.', 'The bodies collide with the ground only.'], eq: ['v ← v + g Δt', 'x ← x + v Δt', 'y < 0 ⇒ x ← x_prev, y ← 0'], code: CODE_VOL },
        run(c) {
          begin(c, true, 0);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.55, r: 4.2, tx: 0, ty: 0.3, tz: 0 }, { az: az + 0.8, el: 0.35, r: 3.3, tx: 0, ty: 0.4, tz: 0 }, 11, 0.3);
          const n = 3 + Math.floor(c.rng() * 3);
          script = (function* () {
            for (let k = 0; k < n; k++) { addBody(-0.9 + 1.8 * c.rng(), 0.6 + 0.8 * c.rng(), -0.9 + 1.8 * c.rng()); yield (0.6 + 0.5 * c.rng()) * slow; }
            for (;;) { const bs = bodies(); yield* throwBody(c, bs[Math.floor(c.rng() * bs.length)], 1.5 + 1.5 * c.rng(), 2 + 1.5 * c.rng()); yield (1.4 + c.rng()) * slow; }
          })();
        } },
      { key: 'soft', label: { title: 'Compliance', lines: ['Edge compliance up: the bunny turns to jelly and stretches when pulled by an ear.'], eq: ['α̃ = α / Δt²', 'Δλ = −C / (w + α̃)'] },
        run(c) {
          const comp = 50 * (3 + Math.floor(c.rng() * 8));
          begin(c, true, comp);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.2, r: 2.4, tx: 0, ty: 0.7, tz: 0 }, { az: az + 0.7, el: 0.1, r: 2.0, tx: 0, ty: 0.8, tz: 0 }, 10, 0.7);
          script = (function* () {
            yield 0.6;
            for (;;) {
              if (grab(topParticle(bodies()[0], c))) {
                const x = lerp(-0.3, 0.3, c.rng()), z = lerp(-0.3, 0.3, c.rng()), y = 1.5 + 0.3 * c.rng();
                const keys = [[x, y, z, 1.2 * slow], [x, y, z, 0.8 * slow]];
                for (let k = 0; k < 3; k++) { const d = (k % 2 ? -1 : 1) * (0.25 + 0.2 * c.rng()); keys.push([x + d, y - 0.1, z, 0.35 * slow]); }
                keys.push([x, y, z, 0.4 * slow], [x, y, z, 0.8 * slow]);
                path(keys);
                while (handBusy()) yield 0;
                hand.vel.set(0, 0, 0); release();
              }
              yield (2.2 + c.rng()) * slow;
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

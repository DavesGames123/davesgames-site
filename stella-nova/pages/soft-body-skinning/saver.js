// Soft Body Skinning · site layer: the credit record and the screensaver
// shots. main.js is the upstream demo; this file only calls its globals
// (initPhysics, gGrabber, gPhysicsScene, gThreeScene, gCamera, gRenderer,
// gCameraControl, run, squash, onShowTets). The autopilot picks the dragon
// with the upstream raycast (gGrabber.start at the screen point of a tet
// particle), moves it with SoftBody.moveGrabbed and throws it with
// SoftBody.endGrab, as the mouse does. Restart rebuilds the body with
// initPhysics() in place of the page reload.
TMP.page({ n: '12', title: 'Soft Body Skinning', file: '12-softBodySkinning.html', video: 'Noo5sfGGWe0', year: 2022, licence: 'MIT' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ease = u => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const body = () => gPhysicsScene.objects[0];

  // ---- body ----
  function centerOf(b, out) {
    out.set(0, 0, 0);
    for (let i = 0; i < b.numParticles; i++) { out.x += b.pos[3 * i]; out.y += b.pos[3 * i + 1]; out.z += b.pos[3 * i + 2]; }
    return out.divideScalar(b.numParticles);
  }
  // The Restart button reloads the page; here the old body leaves the
  // scene and initPhysics() makes a new one at the start pose (in the air).
  function restartBody(comp, tets) {
    for (const b of gPhysicsScene.objects) {
      gThreeScene.remove(b.visMesh); gThreeScene.remove(b.tetMesh);
      b.visMesh.geometry.dispose(); b.tetMesh.geometry.dispose();
    }
    gPhysicsScene.objects = [];
    initPhysics();
    body().edgeCompliance = comp;
    // onShowTets() flips the flag and sets every tet mesh to it.
    if (!!gPhysicsScene.showTetMesh !== tets) onShowTets(); else body().tetMesh.visible = tets;
  }
  // A random particle in the top part of the body: head, back or tail.
  function topParticle(b, c) {
    let best = 0, by = -1e9;
    for (let k = 0; k < 12; k++) { const i = Math.floor(c.rng() * b.numParticles), y = b.pos[3 * i + 1]; if (y > by) { by = y; best = i; } }
    return V(b.pos[3 * best], b.pos[3 * best + 1], b.pos[3 * best + 2]);
  }

  // ---- camera: a spherical pose around a target, eased from a to b ----
  // pose = { az, el, r, tx, ty, tz }. follow (0..1) pulls the target
  // toward a smoothed copy of the body centre.
  const cam = { a: null, b: null, t: 0, dur: 1, follow: 0, fp: V(0, 0.8, 0), f: V(0, 0, 0) };
  function setPose(p) {
    const ce = Math.cos(p.el);
    gCamera.position.set(p.tx + p.r * ce * Math.sin(p.az), p.ty + p.r * Math.sin(p.el), p.tz + p.r * ce * Math.cos(p.az));
    gCamera.lookAt(p.tx, p.ty, p.tz);
    gCamera.updateMatrixWorld();
  }
  function camMove(a, b, dur, follow) {
    cam.a = a; cam.b = b; cam.t = 0; cam.dur = dur; cam.follow = follow || 0;
    centerOf(body(), cam.fp); camTick(0);
  }
  function camTick(dt) {
    if (!cam.a) return;
    cam.t += dt;
    cam.fp.lerp(centerOf(body(), cam.f), Math.min(1, dt * 2));
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
  // A new shot lets go of the old grab, drops the old script and restarts
  // the dragon in the air, so the shot opens on a fall.
  function begin(c, comp, tets) {
    release(); script = null; wait = 0; slow = 0.8 + 0.5 * c.calm;
    restartBody(comp, tets);
    play();
  }

  // A throw: lift a top particle, swing back, swing through, let go.
  function* throwBody(c, speed, up) {
    if (!grab(topParticle(body(), c))) { yield 0.4; return; }
    const a = c.rng() * Math.PI * 2, dir = V(Math.cos(a), 0, Math.sin(a));
    const h = V(lerp(-0.3, 0.3, c.rng()), 1.9 + 0.3 * c.rng(), lerp(-0.3, 0.3, c.rng()));
    const back = h.clone().addScaledVector(dir, -0.6); back.y -= 0.2;
    const sw = 0.22, fwd = back.clone().addScaledVector(dir, speed * sw); fwd.y += up * sw;
    path([[h.x, h.y, h.z, 1.0 * slow], [h.x, h.y, h.z, 0.4 * slow], [back.x, back.y, back.z, 0.5 * slow], [fwd.x, fwd.y, fwd.z, sw]]);
    while (handBusy()) yield 0;
    release();
  }
  // A pull: lift a top particle, shake it side to side, set it down at rest.
  function* pull(c, height, shakes) {
    if (!grab(topParticle(body(), c))) { yield 0.4; return; }
    const x = lerp(-0.4, 0.4, c.rng()), z = lerp(-0.3, 0.3, c.rng()), y = height;
    const keys = [[x, y, z, 1.3 * slow], [x, y, z, 0.6 * slow]];
    for (let k = 0; k < shakes; k++) { const d = (k % 2 ? -1 : 1) * (0.3 + 0.3 * c.rng()); keys.push([x + d, y - 0.1, z + 0.2 * d, 0.4 * slow]); }
    keys.push([x, y, z, 0.4 * slow], [x, y, z, 0.8 * slow]);
    path(keys);
    while (handBusy()) yield 0;
    hand.vel.set(0, 0, 0); release();
  }

  const CODE_SKIN = { lang: 'js', name: 'updateVisMesh', text: 'var b3 = 1.0 - b0 - b1 - b2;\nvecSetZero(positions,i);\nvecAdd(positions,i, this.pos,id0, b0);\nvecAdd(positions,i, this.pos,id1, b1);\nvecAdd(positions,i, this.pos,id2, b2);\nvecAdd(positions,i, this.pos,id3, b3);' };
  const CODE_SQUASH = { lang: 'js', name: 'squash', text: 'squash() {\n\tfor (var i = 0; i < this.numParticles; i++) {\n\t\tthis.pos[3 * i + 1] = 0.5;\n\t}\n\tthis.endFrame();\n}' };
  const EQ_SKIN = ['x = b₀x₀ + b₁x₁ + b₂x₂ + b₃x₃', 'b₃ = 1 − b₀ − b₁ − b₂'];
  const EQ_XPBD = ['α̃ = α / Δt²', 'Δλ = −C / (w + α̃)', 'C = V − V₀'];

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
      { key: 'drop', label: { title: 'Fall and Settle', lines: ['3840 tets carry a 59 657-triangle dragon.', 'Each visual vertex follows the tet that holds it.'], eq: EQ_SKIN, code: CODE_SKIN },
        run(c) {
          begin(c, 0, false);
          const s = c.rng() < 0.5 ? -1 : 1;
          camMove({ az: s * 1.1, el: 0.05, r: 3.6, tx: -s * 0.6, ty: 0.9, tz: 0 }, { az: s * 0.3, el: 0.2, r: 3.1, tx: s * 0.3, ty: 0.9, tz: 0 }, 10, 0.7);
          script = (function* () { yield 2.5 * slow; for (;;) { yield* pull(c, 2.1 + 0.2 * c.rng(), 0); yield (2.4 + c.rng()) * slow; } })();
        } },
      { key: 'throw', label: { title: 'Grab and Throw', lines: ['The hand moves one tet particle; the skin follows the tets.'], eq: EQ_XPBD },
        run(c) {
          begin(c, 0, false);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.3, r: 4.4, tx: 0, ty: 0.8, tz: 0 }, { az: az + (c.rng() < 0.5 ? -1 : 1) * (1 + c.rng()), el: 0.4, r: 3.6, tx: 0, ty: 0.8, tz: 0 }, 11, 0.9);
          script = (function* () { yield 1.6 * slow; for (;;) { yield* throwBody(c, 2.5 + 2 * c.rng(), 2 + 2 * c.rng()); yield (2 + c.rng()) * slow; } })();
        } },
      { key: 'squash', label: { title: 'Squash', lines: ['Every tet particle set to one height: volume constraints restore the dragon.'], eq: ['C = V − V₀', '∇C₁ = ⅙ (x₄ − x₂) × (x₃ − x₂)'], code: CODE_SQUASH },
        run(c) {
          begin(c, 0, false);
          const az = (c.rng() < 0.5 ? -1 : 1) * (0.5 + 0.7 * c.rng());
          camMove({ az, el: 0.2, r: 3.4, tx: 0, ty: 0.6, tz: 0 }, { az: az * 0.3, el: 0.45, r: 2.6, tx: 0, ty: 0.5, tz: 0 }, 10, 0.3);
          script = (function* () { yield 1.8 * slow; for (;;) { squash(); play(); yield (2.6 + 1.2 * c.rng()) * slow; } })();
        } },
      { key: 'tets', label: { title: 'The Tet Cage', lines: ['Show tets: the coarse simulation mesh inside the fine visual mesh.'], eq: EQ_SKIN, code: CODE_SKIN },
        run(c) {
          begin(c, 10 * (1 + Math.floor(c.rng() * 3)), true);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.25, r: 2.2, tx: 0, ty: 1.0, tz: 0 }, { az: az + 0.9, el: 0.35, r: 1.8, tx: 0, ty: 0.9, tz: 0 }, 11, 0.7);
          script = (function* () { yield 2.0 * slow; for (;;) { yield* pull(c, 2.1 + 0.3 * c.rng(), 2); yield (1.6 + c.rng()) * slow; } })();
        } },
      { key: 'soft', label: { title: 'Compliance', lines: ['Edge compliance up: the dragon goes soft and stretches when pulled.'], eq: EQ_XPBD },
        run(c) {
          begin(c, 10 * (5 + Math.floor(c.rng() * 6)), false);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.15, r: 3.6, tx: 0, ty: 1.1, tz: 0 }, { az: az - 0.7, el: 0.25, r: 2.9, tx: 0, ty: 1.1, tz: 0 }, 10, 0.7);
          script = (function* () { yield 2.0 * slow; for (;;) { yield* pull(c, 2.6 + 0.3 * c.rng(), 3); yield (1.8 + c.rng()) * slow; } })();
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

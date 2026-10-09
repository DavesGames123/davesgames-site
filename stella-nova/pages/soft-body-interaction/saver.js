// Grab Interaction · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (gGrabber,
// gPhysicsScene, gCamera, gRenderer, gCameraControl, run). The autopilot
// picks the ball with the upstream raycast (gGrabber.start at the screen
// point of the ball), then moves it with Ball.moveGrabbed and throws it
// with Ball.endGrab, as the mouse does.
TMP.page({ n: '08', title: 'Grab Interaction', file: '08-interaction.html', video: 'iH_UgUb-LYM', year: 2021, licence: 'MIT' });

(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ease = u => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;

  // ---- camera: a spherical pose around a target, eased from a to b ----
  // pose = { az, el, r, tx, ty, tz }. follow (0..1) pulls the target
  // toward a smoothed copy of the ball position.
  const cam = { a: null, b: null, t: 0, dur: 1, follow: 0, fp: V(0, 0.5, 0) };
  function setPose(p) {
    const ce = Math.cos(p.el);
    gCamera.position.set(p.tx + p.r * ce * Math.sin(p.az), p.ty + p.r * Math.sin(p.el), p.tz + p.r * ce * Math.cos(p.az));
    gCamera.lookAt(p.tx, p.ty, p.tz);
    gCamera.updateMatrixWorld();
  }
  function camMove(a, b, dur, follow) {
    cam.a = a; cam.b = b; cam.t = 0; cam.dur = dur; cam.follow = follow || 0;
    cam.fp.copy(ball().pos); camTick(0);
  }
  function camTick(dt) {
    if (!cam.a) return;
    cam.t += dt;
    cam.fp.lerp(ball().pos, Math.min(1, dt * 2.5));
    const u = ease(Math.min(1, cam.t / cam.dur)), p = {}, f = cam.follow;
    for (const k in cam.a) p[k] = lerp(cam.a[k], cam.b[k], u);
    p.tx = lerp(p.tx, cam.fp.x, f); p.ty = lerp(p.ty, cam.fp.y, f); p.tz = lerp(p.tz, cam.fp.z, f);
    setPose(p);
  }

  // ---- hand: the autopilot mouse ----
  // grab() picks with the upstream raycast; path() moves the grabbed
  // object along straight segments [x, y, z, seconds]; release() throws it
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
  let script = null, wait = 0, slow = 1;
  function play() { if (gPhysicsScene.paused) run(); }
  // A new shot lets go of the old grab and drops the old script.
  function begin(c) { release(); script = null; wait = 0; slow = 0.8 + 0.5 * c.calm; play(); }
  const ball = () => gPhysicsScene.objects[0];

  // A throw: lift to a hold point, swing back, swing through, let go.
  function* throwBall(c, dir, speed, up) {
    if (!grab(ball().pos)) { yield 0.4; return; }
    const h = V(lerp(-0.4, 0.4, c.rng()), 1.0 + 0.5 * c.rng(), lerp(-0.3, 0.6, c.rng()));
    const back = h.clone().addScaledVector(dir, -0.45); back.y -= 0.15;
    const sw = 0.18, fwd = back.clone().addScaledVector(dir, speed * sw); fwd.y += up * sw;
    path([[h.x, h.y, h.z, 0.7 * slow], [h.x, h.y, h.z, 0.3 * slow], [back.x, back.y, back.z, 0.45 * slow], [fwd.x, fwd.y, fwd.z, sw]]);
    while (handBusy()) yield 0;
    release();
  }
  function randDir(c) { const a = c.rng() * Math.PI * 2; return V(Math.cos(a), 0, Math.sin(a)); }

  const EQ = ['v = Δx / Δt', 'v ← v + g Δt', 'x ← x + v Δt'];
  const CODE_GRAB = { lang: 'js', name: 'Grabber.move', text: 'this.vel.copy(pos);\nthis.vel.sub(this.prevPos);\nif (this.time > 0.0)\n\tthis.vel.divideScalar(this.time);\nthis.prevPos.copy(pos);\nthis.time = 0.0;\nthis.physicsObject.moveGrabbed(pos, this.vel);' };
  const CODE_SIM = { lang: 'js', name: 'Ball.simulate', text: 'this.vel.addScaledVector(gPhysicsScene.gravity, gPhysicsScene.dt);\nthis.pos.addScaledVector(this.vel, gPhysicsScene.dt);\nif (this.pos.y < this.radius) {\n\tthis.pos.y = this.radius; this.vel.y = -this.vel.y;\n}' };
  const CODE_PICK = { lang: 'js', name: 'Grabber.start', text: 'var intersects = this.raycaster.intersectObjects( gThreeScene.children );\nif (intersects.length > 0) {\n\tvar obj = intersects[0].object.userData;\n\tthis.distance = intersects[0].distance;\n\tthis.physicsObject.startGrab(pos);' };

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
      { key: 'throw', label: { title: 'Pick Up and Throw', lines: ['The grabber measures the hand velocity and gives it to the ball on release.'], eq: EQ, code: CODE_GRAB },
        run(c) {
          begin(c);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.25, r: 3.2, tx: 0, ty: 0.8, tz: 0 }, { az: az + (c.rng() < 0.5 ? -1 : 1) * (1.2 + c.rng()), el: 0.35, r: 2.4, tx: 0, ty: 0.7, tz: 0 }, 11, 0.8);
          script = (function* () { for (;;) { yield* throwBall(c, randDir(c), 3 + 3 * c.rng(), 2 + 2 * c.rng()); yield (1.8 + c.rng()) * slow; } })();
        } },
      { key: 'juggle', label: { title: 'Toss Straight Up', lines: ['A fast upward swing; gravity brings the ball back down.'], eq: ['v_y ← v_y − g Δt', 'h = v² / 2g'], code: CODE_SIM },
        run(c) {
          begin(c);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.1, r: 3.6, tx: 0, ty: 1.4, tz: 0 }, { az: az + 0.4, el: 0.15, r: 2.4, tx: 0, ty: 1.2, tz: 0 }, 10, 0.8);
          script = (function* () { for (;;) { yield* throwBall(c, V(0, 0, 0), 0, 4.5 + 2 * c.rng()); yield (1.2 + 0.8 * c.rng()) * slow; } })();
        } },
      { key: 'walls', label: { title: 'Bounce in the Box', lines: ['A hard throw: the ball reflects from the walls of a 3 × 5 m box.', 'The bounces lose no energy.'], eq: ['v_x ← −v_x at |x| = 1.5', 'v_z ← −v_z at |z| = 2.5'] },
        run(c) {
          begin(c);
          const az = c.rng() * 6.28;
          camMove({ az, el: 0.95, r: 5.6, tx: 0, ty: 0.3, tz: 0 }, { az: az + 0.9, el: 0.7, r: 4.6, tx: 0, ty: 0.3, tz: 0 }, 11, 0.5);
          script = (function* () { yield 0.3; for (;;) { yield* throwBall(c, randDir(c), 7 + 4 * c.rng(), 1 + 2 * c.rng()); yield (3.5 + c.rng()) * slow; } })();
        } },
      { key: 'drop', label: { title: 'Ray Pick and Drop', lines: ['A ray from the camera picks the ball; let go at rest, it falls.'], eq: ['y(t) = y₀ − ½ g t²', 'v_y ← −v_y at y = r'], code: CODE_PICK },
        run(c) {
          begin(c);
          const s = c.rng() < 0.5 ? -1 : 1;
          camMove({ az: s * 1.2, el: 0.05, r: 3.0, tx: -s * 0.6, ty: 1.1, tz: 0 }, { az: s * 0.5, el: 0.12, r: 2.6, tx: s * 0.5, ty: 1.1, tz: 0 }, 10, 0.6);
          script = (function* () {
            for (;;) {
              if (grab(ball().pos)) {
                const x = lerp(-0.8, 0.8, c.rng()), z = lerp(-0.4, 0.4, c.rng()), y = 1.8 + 0.6 * c.rng();
                path([[x, y, z, 1.1 * slow], [x, y, z, 0.6 * slow]]);
                while (handBusy()) yield 0;
                hand.vel.set(0, 0, 0); release();
              }
              yield (2.6 + c.rng()) * slow;
            }
          })();
        } },
    ],
    tick(dt, c) {
      camTick(dt);
      handTick(dt);
      // A yield of 0 waits one frame.
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

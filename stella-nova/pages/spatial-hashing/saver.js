// Spatial Hashing · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (Balls,
// physicsScene, threeScene, renderer, camera, cameraControl, run).
TMP.page({ n: '11', title: 'Spatial Hashing', file: '11-hashing.html', video: 'D2M8jTtKi44', year: 2022, licence: 'MIT' });

(function () {
  const TITLE = 'Spatial Hashing';
  // The ball box of the upstream scene: worldBounds [-1,0,-1] .. [1,2,1].
  const MID = [0, 1, 0];
  let opts = null, shotLabel = null, liveT = 0, move = null, gfun = null;

  // Replace the balls. pos and vel are flat xyz arrays; the hash table of
  // Balls has 2 N cells of size 2 r.
  function build(r, pos, vel, coll) {
    const old = physicsScene.balls;
    if (old) { threeScene.remove(old.visMesh); old.visMesh.geometry.dispose(); old.visMesh.material.dispose(); }
    physicsScene.balls = new Balls(r, pos, vel, threeScene);
    physicsScene.balls.showCollisions = !!coll;
    document.getElementById('particleCount').innerHTML = pos.length / 3;
    physicsScene.gravity = [0, 0, 0];
    if (physicsScene.paused) run();
  }
  // A grid of n^3 balls with a gap of 3 r (as upstream), random velocities.
  function gas(c, r, v, coll) {
    const s = physicsScene.worldBounds, sp = 3 * r;
    const n = Math.floor((s[3] - s[0] - 2 * sp) / sp), ny = Math.floor((s[4] - s[1] - 2 * sp) / sp);
    const N = n * ny * n, pos = new Float32Array(3 * N), vel = new Float32Array(3 * N);
    let k = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < ny; j++) for (let l = 0; l < n; l++, k += 3) {
      pos[k] = s[0] + sp + i * sp; pos[k + 1] = s[1] + sp + j * sp; pos[k + 2] = s[2] + sp + l * sp;
      for (let d = 0; d < 3; d++) vel[k + d] = v * (2 * c.rng() - 1);
    }
    build(r, pos, vel, coll);
  }
  // A dense cube of n^3 balls at the box centre that flies apart.
  function burst(c, r, n, v) {
    const N = n * n * n, sp = 2.15 * r, pos = new Float32Array(3 * N), vel = new Float32Array(3 * N);
    const h = 0.5 * (n - 1) * sp;
    let k = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++, k += 3) {
      const p = [i * sp - h, j * sp - h, l * sp - h], d = Math.hypot(p[0], p[1], p[2]) || 1;
      for (let a = 0; a < 3; a++) { pos[k + a] = MID[a] + p[a]; vel[k + a] = v * (p[a] / d) * (0.6 + 0.4 * c.rng()) + 0.05 * (c.rng() - 0.5); }
    }
    build(r, pos, vel, true);
  }

  // ---- camera: one move per shot (orbit, push in, pull out, truck) -----------
  // Distance at which a w x h subject (world units) just fills the view at
  // the current aspect (the band can be wide or a 9:16 column).
  function fitR(w, h) { const t = Math.tan(camera.fov * Math.PI / 360); return Math.max(h / 2 / t, w / 2 / (t * camera.aspect)); }
  function pose(r, az, el) { return { t: MID.slice(), r, az, el }; }
  function plan(c, p) {
    const q = { t: p.t.slice(), r: p.r, az: p.az, el: p.el }, k = c.rng(), sg = c.rng() < 0.5 ? -1 : 1;
    if (k < 0.35) q.az += sg * (0.9 + 0.8 * c.rng());
    else if (k < 0.6) { q.r *= 0.5 + 0.15 * c.rng(); q.el += 0.15 * (c.rng() - 0.5); }
    else if (k < 0.75) { p.r *= 0.55; }
    else { const s = sg * p.r * 0.3; q.t[0] += Math.cos(p.az) * s; q.t[2] -= Math.sin(p.az) * s; q.az += 0.3 * sg; }
    move = { a: p, b: q, T: 10 * (0.8 + 0.4 * c.calm) };
  }
  function place(p) {
    const ce = Math.cos(p.el);
    camera.position.set(p.t[0] + p.r * ce * Math.sin(p.az), p.t[1] + p.r * Math.sin(p.el), p.t[2] + p.r * ce * Math.cos(p.az));
    cameraControl.target.set(p.t[0], p.t[1], p.t[2]);
    camera.lookAt(cameraControl.target);
  }
  function camTick(t) {
    if (!move) return;
    let u = Math.min(1, t / move.T); u = u * u * (3 - 2 * u);
    const a = move.a, b = move.b, m = (x, y) => x + (y - x) * u;
    place({ t: [m(a.t[0], b.t[0]), m(a.t[1], b.t[1]), m(a.t[2], b.t[2])], r: m(a.r, b.r), az: m(a.az, b.az), el: m(a.el, b.el) });
  }

  // Live value line: the ms per step from the upstream counter.
  function live() {
    if (!opts || typeof opts.label !== 'function' || !shotLabel) return;
    const L = Object.assign({}, shotLabel);
    const n = physicsScene.balls ? physicsScene.balls.numBalls : 0;
    L.sub = L.sub || TITLE;
    L.lines = [L.lines[0], `${n.toLocaleString('en-US')} balls · ${document.getElementById('ms').textContent} ms per step`].concat(TMP.creditLines());
    opts.label(L);
  }

  const EQ = ['(xᵢ, yᵢ, zᵢ) = ⌊p / 2r⌋', 'h = |xᵢ·92837111 ⊕ yᵢ·689287499 ⊕ zᵢ·283923481| mod 2N'];
  // The second line is the live value; live() writes it once per second.
  const shot = (key, label, fn) => (label.lines.push('Timing the hash step…'), { key, label, run(c) { shotLabel = label; gfun = null; fn(c); liveT = 0; } });
  const shots = [
    shot('gas', { title: 'A Hashed Gas', lines: ['Each ball finds its neighbours in the 27 cells around it, not in all N.'], eq: EQ,
      code: { lang: 'js', name: 'hashCoords', text: 'hashCoords(xi, yi, zi) {\n  var h = (xi * 92837111) ^ (yi * 689287499) ^ (zi * 283923481);\t// fantasy function\n  return Math.abs(h) % this.tableSize;\n}' } },
      c => { gas(c, 0.025, 0.2 + 0.3 * c.rng(), false); plan(c, pose(fitR(2.8, 2.4) * (1.6 + 0.3 * c.rng()), c.rng() * 6.28, 0.25 + 0.25 * c.rng())); }),
    shot('contacts', { title: 'Contacts in Orange', lines: ['Orange balls touched a wall or another ball in this step.'], eq: ['d < 2r  →  separate by (2r − d)/2 each', 'vᵢ ← vᵢ + (vⱼ·n − vᵢ·n) n'],
      code: { lang: 'js', name: 'simulate', text: 'var corr = (minDist - d) * 0.5;\nvecAdd(this.pos, i, this.normal, 0, corr);\nvecAdd(this.pos, j, this.normal, 0, -corr);\nvar vi = vecDot(this.vel, i, this.normal, 0);\nvar vj = vecDot(this.vel, j, this.normal, 0);\nvecAdd(this.vel, i, this.normal, 0, vj - vi);\nvecAdd(this.vel, j, this.normal, 0, vi - vj);' } },
      c => { gas(c, 0.025, 0.35 + 0.3 * c.rng(), true); const p = pose(fitR(2.8, 2.4) * (1.1 + 0.2 * c.rng()), c.rng() * 6.28, 0.2 + 0.3 * c.rng()); plan(c, p); }),
    shot('burst', { title: 'Burst', lines: ['A packed cube flies apart; the hash is built again every step.'], eq: ['cost per step = O(N)', 'table size = 2N'],
      code: { lang: 'js', name: 'create', text: 'for (var i = 0; i < numObjects; i++) {\n  var h = this.hashPos(pos, i);\n  this.cellStart[h]++;\n}\nvar start = 0;\nfor (var i = 0; i < this.tableSize; i++) {\n  start += this.cellStart[i];\n  this.cellStart[i] = start;' } },
      c => { burst(c, 0.025 + 0.01 * c.rng(), 14 + Math.floor(5 * c.rng()), (0.3 + 0.25 * c.rng()) * (1.3 - 0.6 * c.calm)); plan(c, pose(fitR(2.8, 2.4) * (1.6 + 0.3 * c.rng()), c.rng() * 6.28, 0.3 + 0.2 * c.rng())); }),
    shot('gravity', { title: 'Gravity On', lines: ['Elastic balls form a dense lower layer that never comes to rest.'], eq: ['v ← v + g Δt', 'p ← p + v Δt'],
      code: { lang: 'js', name: 'query', text: 'for (var zi = z0; zi <= z1; zi++) {\n  var h = this.hashCoords(xi, yi, zi);\n  var start = this.cellStart[h];\n  var end = this.cellStart[h + 1];\n  for (var i = start; i < end; i++) {\n    this.queryIds[this.querySize] = this.cellEntries[i];\n    this.querySize++;\n  }' } },
      c => { gas(c, 0.025, 0.3, c.rng() < 0.5); const g = 2 + 3 * c.rng(); gfun = () => [0, -g, 0]; plan(c, pose(fitR(2.8, 2.4) * (1.4 + 0.2 * c.rng()), c.rng() * 6.28, 0.15 + 0.2 * c.rng())); }),
    shot('slosh', { title: 'Tilting Gravity', lines: ['Gravity swings from side to side; the elastic balls keep their energy, so the gas tilts but never settles.'], eq: ['g(t) = |g| (sin φ(t), −cos φ(t), 0)', 'φ(t) = φ₀ sin ωt'],
      code: { lang: 'js', name: 'simulate', text: 'for (var i = 0; i < this.numBalls; i++) {\n  vecAdd(this.vel, i, gravity, 0, dt);\n  vecCopy(this.prevPos, i, this.pos, i);\n  vecAdd(this.pos, i, this.vel, i, dt);\n}\nthis.hash.create(this.pos);' } },
      c => {
        gas(c, 0.025, 0.2, c.rng() < 0.4); const g = 3 + 2 * c.rng(), f0 = 0.6 + 0.4 * c.rng(), w = 0.6 + 0.3 * c.rng(), ax = c.rng() < 0.5 ? 0 : 2;
        gfun = t => { const f = f0 * Math.sin(w * t), v = [0, -g * Math.cos(f), 0]; v[ax] = g * Math.sin(f); return v; };
        plan(c, pose(fitR(2.8, 2.4) * (1.4 + 0.2 * c.rng()), (ax ? Math.PI / 2 : 0) + 0.5 * (c.rng() - 0.5), 0.2 + 0.15 * c.rng()));
      }),
  ];

  TMP.saver({
    canvas: () => renderer.domElement,
    bg: '#000',
    enter(o) { opts = o; cameraControl.enabled = false; },
    fit(w, h) {
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      return false;
    },
    shots,
    tick(dt, c) {
      const s = 1.15 - 0.6 * c.calm;
      if (gfun) physicsScene.gravity = gfun(c.t * s);
      camTick(c.t);
      liveT += dt; if (liveT > 1.2) { liveT = 0; live(); }
    },
  });
})();

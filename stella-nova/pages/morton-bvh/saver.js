// Morton BVH · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only uses its globals (boxes,
// scene, camera, renderer, calculateMortonCode, WORLD_SIZE, MAX_SPEED) and
// replaces the global updateCamera, which animate() calls each frame.
TMP.page({ n: '24', title: 'Morton BVH', file: '24-morton.html', video: 'LAxHQZ8RjQ4', year: 2025, licence: null });

(function () {
  const TITLE = 'Morton BVH';
  const H = WORLD_SIZE / 2;
  let faded = false, opts = null, shotLabel = null, liveT = 0, move = null, curve = null, curveT = 0, pull = null;

  // ---- boxes ------------------------------------------------------------------
  // Give each box a new seeded position and velocity. spread: fraction of
  // the world cube that the boxes fill; speed: multiple of MAX_SPEED.
  function scatter(c, spread, speed) {
    for (const b of boxes) {
      b.position.set((c.rng() - 0.5) * WORLD_SIZE * spread, (c.rng() - 0.5) * WORLD_SIZE * spread, (c.rng() - 0.5) * WORLD_SIZE * spread);
      b.velocity.set(c.rng() - 0.5, c.rng() - 0.5, c.rng() - 0.5).multiplyScalar(MAX_SPEED * speed);
      b.mesh.position.copy(b.position);
    }
  }
  function setSpeed(c, speed) { for (const b of boxes) b.velocity.set(c.rng() - 0.5, c.rng() - 0.5, c.rng() - 0.5).multiplyScalar(MAX_SPEED * speed); }

  // ---- Z-order curve: a line through the box centres in Morton order ---------
  function curveOn(on) {
    if (on && !curve) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(boxes.length * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(boxes.length * 3), 3));
      curve = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
      curve.frustumCulled = false;
      scene.add(curve);
    }
    if (curve) curve.visible = !!on;
    // The boxes fade while the curve shows, so the line reads through them.
    if (!!on !== faded) {
      faded = !!on;
      for (const b of boxes) { const m = b.mesh.material; m.transparent = faded; m.opacity = faded ? 0.18 : 1; m.depthWrite = !faded; m.needsUpdate = true; }
    }
  }
  const curveColor = new THREE.Color();
  function curveUpdate() {
    if (!curve || !curve.visible) return;
    const n = boxes.length, list = new Array(n);
    for (let i = 0; i < n; i++) { const p = boxes[i].position; list[i] = { i, m: calculateMortonCode(p.x, p.y, p.z) }; }
    list.sort((a, b) => a.m - b.m);
    const pos = curve.geometry.attributes.position.array, col = curve.geometry.attributes.color.array, cc = curveColor;
    for (let k = 0; k < n; k++) {
      const p = boxes[list[k].i].position;
      pos[3 * k] = p.x; pos[3 * k + 1] = p.y; pos[3 * k + 2] = p.z;
      cc.setHSL(0.8 * k / n, 1, 0.6); col[3 * k] = cc.r; col[3 * k + 1] = cc.g; col[3 * k + 2] = cc.b;
    }
    curve.geometry.attributes.position.needsUpdate = true; curve.geometry.attributes.color.needsUpdate = true;
  }

  // ---- camera: one move per shot (orbit, push in, pull out, truck) -----------
  // Distance at which a w x h subject (world units) just fills the view at
  // the current aspect (the band can be wide or a 9:16 column).
  function fitR(w, h) { const t = Math.tan(camera.fov * Math.PI / 360); return Math.max(h / 2 / t, w / 2 / (t * camera.aspect)); }
  const WIDE = () => fitR(141, 110);
  function pose(t, r, az, el, min) { return { t, r, az, el, min }; }
  function plan(c, p, kind) {
    const q = { t: p.t.slice(), r: p.r, az: p.az, el: p.el }, k = kind != null ? kind : c.rng(), sg = c.rng() < 0.5 ? -1 : 1;
    if (k < 0.35) q.az += sg * (0.8 + 0.8 * c.rng());
    else if (k < 0.6) { q.r *= 0.45 + 0.15 * c.rng(); q.el += 0.15 * (c.rng() - 0.5); }
    else if (k < 0.75) { p.r *= 0.5; }
    else { const s = sg * p.r * 0.3; q.t[0] += Math.cos(p.az) * s; q.t[2] -= Math.sin(p.az) * s; q.az += 0.3 * sg; }
    // p.min: the closest distance for this shot (outside the cloud).
    if (p.min) { q.r = Math.max(q.r, p.min); p.r = Math.max(p.r, p.min); }
    move = { a: p, b: q, T: 10 * (0.8 + 0.4 * c.calm) };
  }
  function camTick(t) {
    if (!move) return;
    let u = Math.min(1, t / move.T); u = u * u * (3 - 2 * u);
    const a = move.a, b = move.b, m = (x, y) => x + (y - x) * u;
    const tx = m(a.t[0], b.t[0]), ty = m(a.t[1], b.t[1]), tz = m(a.t[2], b.t[2]), r = m(a.r, b.r), az = m(a.az, b.az), el = m(a.el, b.el), ce = Math.cos(el);
    camera.position.set(tx + r * ce * Math.sin(az), ty + r * Math.sin(el), tz + r * ce * Math.cos(az));
    camera.lookAt(tx, ty, tz);
  }

  // Live line: the upstream stats (build time, query time, checks).
  function live() {
    if (!opts || typeof opts.label !== 'function' || !shotLabel) return;
    const v = id => document.getElementById(id).textContent;
    const n = boxes.length, naive = n * (n - 1) / 2;
    const L = Object.assign({}, shotLabel);
    L.sub = L.sub || TITLE;
    L.lines = [shotLabel.lines[0], `${n.toLocaleString('en-US')} boxes · build ${v('buildTime')} ms · query ${v('checkTime')} ms · ${(+v('bvhChecks')).toLocaleString('en-US')} node tests, not ${naive.toLocaleString('en-US')} pairs`].concat(TMP.creditLines());
    opts.label(L);
  }

  const EQ = ['m = … z₁y₁x₁ z₀y₀x₀ (bits interleaved)', 'sort by m  →  split in the middle'];
  const CODE_MORTON = { lang: 'js', name: 'expandBits', text: 'function expandBits(v) {\n  v = (v * 0x00010001) & 0xFF0000FF;\n  v = (v * 0x00000101) & 0x0F00F00F;\n  v = (v * 0x00000011) & 0xC30C30C3;\n  v = (v * 0x00000005) & 0x49249249;\n  return v;\n}' };
  const CODE_TREE = { lang: 'js', name: 'createSubTree', text: 'if (begin === end) {\n  return createLeaf(list[begin].id, boxes[list[begin].id]);\n} else {\n  const m = getSplitPos(list, begin, end);\n  const node = createNode();\n  node.left = createSubTree(list, begin, m, boxes);\n  node.right = createSubTree(list, m + 1, end, boxes);' };
  const CODE_QUERY = { lang: 'js', name: 'findCollisions', text: 'checkCount.value++;\nif (!aabbIntersect(box.getAABB(), node.aabb)) {\n  return;\n}\nif (node.isLeaf()) {\n  if (node.boxId !== boxId) {\n    if (box.checkCollision(boxes[node.boxId])) {\n      collisions.push({ a: boxId, b: node.boxId });' };
  // The second line of each label is the live value.
  const shot = (key, label, fn) => (label.lines.push('Timing the tree…'), { key, label, run(c) { shotLabel = label; curveOn(false); pull = null; fn(c); liveT = 0.8; } });
  const shots = [
    shot('cloud', { title: 'Ten Thousand Boxes', lines: ['The tree is built again from scratch in every frame; red boxes overlap.'], eq: EQ, code: CODE_TREE },
      c => { setSpeed(c, 1); plan(c, pose([0, 0, 0], WIDE() * (1.15 + 0.15 * c.rng()), c.rng() * 6.28, 0.3 + 0.2 * c.rng(), WIDE() * 0.9)); }),
    shot('inside', { title: 'Inside the Cloud', lines: ['Each box walks the tree and skips every node whose bounds it misses.'], eq: ['test node:  min₁ ≤ max₂  and  max₁ ≥ min₂  (x, y, z)'], code: CODE_QUERY },
      c => { setSpeed(c, 1 + c.rng()); plan(c, pose([(c.rng() - 0.5) * 20, (c.rng() - 0.5) * 20, (c.rng() - 0.5) * 20], 80, c.rng() * 6.28, 0.1 + 0.3 * c.rng(), 48), 0.4); }),
    shot('zorder', { title: 'Z-Order Curve', lines: ['The line joins the box centres in Morton order: near in the list, near in space.'], eq: EQ, code: CODE_MORTON },
      c => { setSpeed(c, 0.6); curveOn(true); curveT = 0; plan(c, pose([0, 0, 0], WIDE() * (1.15 + 0.1 * c.rng()), c.rng() * 6.28, 0.3 + 0.3 * c.rng(), WIDE() * 0.8)); }),
    shot('crowd', { title: 'Crowding', lines: ['The boxes pack into a small cube: many overlaps, deeper traversals.'], eq: ['tests per box ≈ O(log n + k)'], code: CODE_QUERY },
      c => { scatter(c, 0.45 + 0.1 * c.rng(), 0.6); pull = 0.35 + 0.15 * c.rng(); plan(c, pose([0, 0, 0], WIDE() * (0.75 + 0.1 * c.rng()), c.rng() * 6.28, 0.25 + 0.3 * c.rng(), WIDE() * 0.55)); }),
    shot('storm', { title: 'Fast Boxes', lines: ['Four times the upstream speed; the tree still rebuilds each frame.'], eq: EQ, code: CODE_MORTON },
      c => { scatter(c, 1, 4); plan(c, pose([0, 0, 0], WIDE() * 1.2, c.rng() * 6.28, 0.3 + 0.25 * c.rng(), WIDE() * 0.9)); }),
  ];

  TMP.saver({
    canvas: () => renderer.domElement,
    bg: '#111',
    enter(o) {
      opts = o;
      // The saver drives the camera; animate() still calls updateCamera.
      window.updateCamera = function () {};
    },
    fit(w, h) {
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      return false;
    },
    shots,
    tick(dt, c) {
      camTick(c.t);
      // Crowding: a weak pull to the centre keeps the boxes packed.
      if (pull) for (const b of boxes) { const p = b.position; if (Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) > H * pull) b.velocity.addScaledVector(p, -0.0004); }
      curveT -= dt; if (curveT <= 0) { curveT = 0.1; curveUpdate(); }
      liveT -= dt; if (liveT <= 0) { liveT = 1; live(); }
    },
  });
})();

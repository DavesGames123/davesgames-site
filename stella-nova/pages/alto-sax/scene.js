// ============================================================================
//  ALTO SAX MECHANISM  ·  scene.js — the three.js model (no DOM)
// ----------------------------------------------------------------------------
//  buildSax(THREE, M) makes the whole instrument from the data in model.js
//  (M). It does not import three itself, so tests.mjs can build the scene
//  in node with the vendored copy. It uses no canvas and no texture.
//
//  STRUCTURE
//    root
//      body ............ body tube, bow, bell, bands, guards, rests (static)
//      neck ............ neck tube, cork, mouthpiece, reed, ligature (static)
//      static.<group> .. chimneys, hole discs, posts, rods, screws: merged,
//                        one mesh for each group and material
//      holder.<key> .... explode offset of one key
//        pivot ......... turns about the hinge axis (key.angle)
//          geom ........ the key parts, built in world space at the
//                        closed pose and moved by -origin
//  A link has two halves. The driver half is a child of the driver key and
//  the driven half is a child of the driven key. The contact (felt, cork or
//  screw) is at the middle, so the halves part when the keys move apart.
//  A needle spring has a fixed end on a post and a tip on the key cradle;
//  tick() moves it each frame.
//
//  ANGLES. Each key turns between restAngle and actAngle. For a cup key the
//  sign is the one that lifts the first cup off its hole. For a key with
//  touches only, the sign is the one that moves the first touch in.
//
//  API  (S = buildSax(THREE, M))
//    S.root, S.keys (Map id -> key view), S.touchMeshes (pick list)
//    S.setState(solveResult) ... set the target angle of each key
//    S.tick(dt) -> true while a key still moves
//    S.setExplode(groupId | null, amount 0..1)
//    S.setGhost(groupId | null)   all other groups go transparent
//    S.setTint(on)                key metal in the group colours
//    S.setGlow(keyIds, linkIds)   moved keys glow; contacts glow
//    S.tracePoints(path) -> [[Vector3, Vector3, Vector3]]  for the path line
//    S.keyPoint(id), S.touchPoint(id), S.groupBox(groupId) -> world values
//    S.stats ...................  counts of pads, felts, corks, springs, and so on
//
//  GREP MAP
//    function makeMats ...... brass, steel, blued spring, pad, pearl, felt, cork
//    function tubeGeo ....... the conical tube along the centre line
//    function buildKey ...... tube, arms, cups, pads, touches, stops, spring
//    function buildLink ..... the two halves and the contact
//    function buildHole ..... chimney and dark hole disc
//    function buildRod ...... posts, base plates, hinge rod, screws
//    function buildNeck ..... neck, cork, mouthpiece, reed, ligature
//    function merge ......... small geometry merge (no addon import)
// ============================================================================

export function buildSax(THREE, M, opts = {}) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const Y = new THREE.Vector3(0, 1, 0);
  const root = new THREE.Group(); root.name = 'alto-sax';
  const stats = { meshes: 0, pads: 0, resonators: 0, felts: 0, corks: 0, needle: 0, flat: 0, screws: 0, posts: 0, plates: 0, pearls: 0, chimneys: 0, arms: 0, contacts: 0 };
  const groupMats = new Map();      // group id -> Set of materials (for ghost)
  const gm = g => { if (!groupMats.has(g)) groupMats.set(g, new Set()); return groupMats.get(g); };

  // ---- materials ---------------------------------------------------------------
  function makeMats(g) {
    const P = THREE.MeshPhysicalMaterial, S = THREE.MeshStandardMaterial;
    const m = {
      brass: new P({ color: 0xe2b45c, metalness: 1, roughness: 0.27, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
      steel: new S({ color: 0xc3cad2, metalness: 1, roughness: 0.32 }),
      spring: new S({ color: 0x3d5590, metalness: 0.9, roughness: 0.3 }),
      pad: new S({ color: 0xc69a62, metalness: 0, roughness: 0.78 }),
      reso: new S({ color: 0xd6dadc, metalness: 1, roughness: 0.22 }),
      pearl: new P({ color: 0xf5efe4, metalness: 0, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.7, iridescenceIOR: 1.6, sheen: 0.3 }),
      felt: new S({ color: 0x5a2630, metalness: 0, roughness: 1 }),
      cork: new S({ color: 0xc89a62, metalness: 0, roughness: 0.95 }),
    };
    for (const k in m) { m[k].userData.base = { opacity: 1, color: m[k].color.getHex() }; gm(g).add(m[k]); }
    return m;
  }
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd9aa52, metalness: 1, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
  const rubber = new THREE.MeshPhysicalMaterial({ color: 0x0d0d0f, metalness: 0, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const cane = new THREE.MeshStandardMaterial({ color: 0xdcc57e, metalness: 0, roughness: 0.62 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0, roughness: 0.5 });
  for (const m of [bodyMat, holeMat]) { m.userData.base = { opacity: 1, color: m.color.getHex() }; gm('body').add(m); }
  const neckBrass = bodyMat.clone(), restPlastic = plastic.clone();
  for (const m of [rubber, cane, plastic, neckBrass]) { m.userData.base = { opacity: 1, color: m.color.getHex() }; gm('neck').add(m); }
  restPlastic.userData.base = { opacity: 1, color: restPlastic.color.getHex() }; gm('body').add(restPlastic);
  const neckMats = makeMats('neck'), bodyParts = makeMats('body');

  // ---- small geometry helpers ------------------------------------------------------
  const tmpQ = new THREE.Quaternion();
  function orient(mesh, p, dir) { mesh.position.copy(p); tmpQ.setFromUnitVectors(Y, dir.clone().normalize()); mesh.quaternion.copy(tmpQ); return mesh; }
  function mesh(geo, mat, role) { const o = new THREE.Mesh(geo, mat); o.userData.role = role || ''; stats.meshes++; return o; }
  // a cylinder from p0 to p1
  function cyl(p0, p1, r0, r1, mat, role, seg = 14) {
    const d = p1.clone().sub(p0), L = Math.max(0.01, d.length());
    const o = mesh(new THREE.CylinderGeometry(r1, r0, L, seg, 1), mat, role);
    return orient(o, p0.clone().addScaledVector(d, 0.5), d);
  }
  // a disc of thickness h, centred at p, with its axis along n
  function disc(p, n, r, h, mat, role, seg = 24) { return orient(mesh(new THREE.CylinderGeometry(r, r, h, seg, 1), mat, role), p, n); }
  // a box with its long side along `along` and its thin side along n
  function plate(p, n, along, L, W, H, mat, role) {
    const o = mesh(new THREE.BoxGeometry(W, H, L), mat, role);
    const z = along.clone().normalize(), y = n.clone().normalize(), x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); o.position.copy(p); return o;
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const dphi = (a, b) => ((b - a + 540) % 360) - 180;
  const section = s => (s < M.S_BOW ? 'up' : s > M.S_BELL ? 'bell' : 'bow');
  // points along the tube surface from (s0, phi0, dr0) to (s1, phi1, dr1)
  function surfPts(a, b, n = 10) {
    if (section(a[0]) !== section(b[0])) return [V(M.surf(...a)), V(M.surf(...b))];
    const out = [], dp = dphi(a[1], b[1]);
    for (let i = 0; i <= n; i++) { const k = i / n; out.push(V(M.surf(lerp(a[0], b[0], k), a[1] + dp * k, lerp(a[2], b[2], k)))); }
    return out;
  }
  function tubeAlong(pts, r, mat, role, seg = 24) {
    const c = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts);
    return mesh(new THREE.TubeGeometry(c, pts.length === 2 ? 2 : seg, r, 8, false), mat, role);
  }

  // ---- static merge ---------------------------------------------------------------
  const statics = new Map();   // key "group|matName" -> { geos, mat }
  function addStatic(group, matName, mat, o) {
    o.updateMatrix();
    const g = o.geometry.clone().applyMatrix4(o.matrix);
    const k = group + '|' + matName;
    if (!statics.has(k)) statics.set(k, { group, mat, geos: [] });
    statics.get(k).geos.push(g);
    o.geometry.dispose();
  }
  function merge(geos) {
    let nv = 0, ni = 0;
    const list = geos.map(g => (g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()])));
    for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = p.count;
      pos.set(p.array.subarray ? p.array.subarray(0, c * 3) : p.array, ov * 3);
      if (n) nor.set(n.array.subarray(0, c * 3), ov * 3);
      if (u) uv.set(u.array.subarray(0, c * 2), ov * 2);
      const I = g.index.array; for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + ov;
      ov += c; oi += I.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  // ---- body tube -------------------------------------------------------------------
  function tubeGeo(s0, s1, step, radial, rf = M.radius) {
    const rings = Math.max(2, Math.ceil((s1 - s0) / step) + 1), pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i < rings; i++) {
      const s = lerp(s0, s1, i / (rings - 1)), c = M.center(s), r = rf(s);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2, n = [c.f[0] * Math.cos(a) + c.b[0] * Math.sin(a), c.f[1] * Math.cos(a) + c.b[1] * Math.sin(a), c.f[2] * Math.cos(a) + c.b[2] * Math.sin(a)];
        pos.push(c.p[0] + n[0] * r, c.p[1] + n[1] * r, c.p[2] + n[2] * r); nor.push(...n); uv.push(j / radial, i / (rings - 1));
      }
    }
    for (let i = 0; i < rings - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const body = new THREE.Group(); body.name = 'body'; root.add(body);
  body.add(mesh(tubeGeo(M.S_BODY, M.S_END, 5, 56), bodyMat, 'tube'));
  // bands: socket, bow joint, bell joint, and the bell rim
  const band = (s0, s1, dr, role) => mesh(tubeGeo(s0, s1, 2, 56, s => M.radius(s) + dr), bodyMat, role);
  body.add(band(M.S_BODY, M.S_BODY + 18, 1.3, 'socket'));
  body.add(band(M.S_BOW - 6, M.S_BOW + 6, 0.9, 'band'));
  body.add(band(M.S_BELL - 6, M.S_BELL + 6, 0.9, 'band'));
  {
    const c = M.center(M.S_END), rim = mesh(new THREE.TorusGeometry(M.radius(M.S_END), 1.8, 10, 72), bodyMat, 'rim');
    orient(rim, V(c.p), V(c.t)); rim.rotateX(Math.PI / 2); body.add(rim);
  }
  // guards: wire loops over the bell cups and over the right pinky keys
  body.add(tubeAlong(surfPts([1092, -30, 24], [1214, 120, 24], 16), 1.3, bodyParts.brass, 'guard'));
  body.add(cyl(V(M.surf(1092, -30, 0)), V(M.surf(1092, -30, 24)), 1.3, 1.3, bodyParts.brass, 'guard'));
  body.add(cyl(V(M.surf(1214, 120, 0)), V(M.surf(1214, 120, 24)), 1.3, 1.3, bodyParts.brass, 'guard'));
  body.add(tubeAlong(surfPts([866, -128, 26], [946, 40, 26], 16), 1.3, bodyParts.brass, 'guard'));
  body.add(cyl(V(M.surf(866, -128, 0)), V(M.surf(866, -128, 26)), 1.3, 1.3, bodyParts.brass, 'guard'));
  body.add(cyl(V(M.surf(946, 40, 0)), V(M.surf(946, 40, 26)), 1.3, 1.3, bodyParts.brass, 'guard'));
  // right thumb hook, left thumb rest, strap ring
  {
    const n = V(M.normalAt(830, 180)), p = V(M.surf(830, 180, 6)), t = V(M.center(830).t);
    body.add(cyl(V(M.surf(822, 180, 0)), V(M.surf(822, 180, 7)), 2.2, 2.2, bodyParts.brass, 'thumb hook'));
    body.add(plate(p.clone().addScaledVector(n, 1.5), n, t, 22, 16, 2.2, bodyParts.brass, 'thumb hook'));
    body.add(disc(V(M.surf(636, 170, 2)), V(M.normalAt(636, 170)), 7, 4, restPlastic, 'thumb rest'));
    const sr = mesh(new THREE.TorusGeometry(5, 1.2, 8, 24), bodyParts.steel, 'strap ring');
    orient(sr, V(M.surf(560, 180, 7)), V(M.center(560).t)); body.add(sr);
    body.add(cyl(V(M.surf(560, 180, 0)), V(M.surf(560, 180, 3)), 2, 2, bodyParts.brass, 'strap ring'));
  }

  // ---- tone holes ------------------------------------------------------------------
  const holeGroup = id => { const k = M.KEY[M.HOLE_CUP[id]]; return k ? k.group : 'body'; };
  const chimH = h => (h.kind === 'register' ? 4.5 : 2.6);
  function buildHole(h) {
    const g = holeGroup(h.id), n = V(M.normalAt(h.s, h.phi)), H = chimH(h), r = h.rh;
    const prof = [[r, -1.6], [r + 1.1, -1.6], [r + 1.1, H - 0.6], [r + 0.75, H], [r + 0.2, H], [r, H - 0.4], [r, -1.6]].map(q => new THREE.Vector2(q[0], q[1]));
    const ch = mesh(new THREE.LatheGeometry(prof, 32), bodyMat, 'chimney');
    orient(ch, V(M.surf(h.s, h.phi, 0)), n);
    addStatic(g, 'chimney', bodyMat, ch); stats.chimneys++;
    const d = mesh(new THREE.CircleGeometry(r, 28), holeMat, 'hole');
    orient(d, V(M.surf(h.s, h.phi, 0.35)), n); d.rotateX(-Math.PI / 2);
    addStatic(g, 'hole', holeMat, d);
  }
  for (const h of M.HOLES) buildHole(h);

  // ---- rods and posts --------------------------------------------------------------
  const rodGroup = {};
  for (const k of M.KEYS) if (!rodGroup[k.rod]) rodGroup[k.rod] = k.group;
  const steelS = makeMats('static-steel').steel, brassS = makeMats('static-brass').brass;
  gm('static-steel').clear(); gm('static-brass').clear();
  function buildRod(rod) {
    const g = rodGroup[rod.id] || 'body', [a, b] = M.rodEnds(rod).map(V), u = b.clone().sub(a).normalize();
    for (const [p, out] of [[a, u.clone().negate()], [b, u]]) {
      // the post stands on the nearest point of the tube surface
      const s = rod.neckAxis ? rod.neckAxis.s : (p === a ? rod.s0 : rod.s1), c = V(M.center(s).p);
      const nrm = p.clone().sub(c).normalize(), base = c.clone().addScaledVector(nrm, M.radius(s));
      addStatic(g, 'brass', brassS, cyl(base.clone().addScaledVector(nrm, -0.6), p, 2.6, 2.1, brassS, 'post')); stats.posts++;
      addStatic(g, 'brass', brassS, disc(base.clone().addScaledVector(nrm, 0.25), nrm, 4.2, 0.9, brassS, 'plate')); stats.plates++;
      const cap = mesh(new THREE.SphereGeometry(2.5, 14, 10), brassS, 'post cap'); cap.position.copy(p);
      addStatic(g, 'brass', brassS, cap);
      if (rod.kind === 'points' || p === a) {
        // pivot screw (points) or the rod screw head (rod, end a only)
        const e = p.clone().addScaledVector(out, 2.6);
        addStatic(g, 'steel', steelS, cyl(p, e, 1.25, 1.25, steelS, 'screw'));
        addStatic(g, 'steel', steelS, disc(e.clone().addScaledVector(out, 0.6), out, 2.1, 1.2, steelS, 'screw head')); stats.screws++;
      }
    }
    if (rod.kind === 'rod') addStatic(g, 'steel', steelS, cyl(a, b, 1.05, 1.05, steelS, 'hinge rod', 10));
  }
  for (const r of M.RODS) buildRod(r);

  // ---- keys ------------------------------------------------------------------------
  // A part made for the rest pose: undo the rest turn, so that the pivot
  // puts it back at its design place when the key is at rest.
  function invRest(v) {
    const T1 = new THREE.Matrix4().makeTranslation(v.origin.x, v.origin.y, v.origin.z);
    const Rm = new THREE.Matrix4().makeRotationAxis(v.axis, -v.restAngle);
    const T0 = new THREE.Matrix4().makeTranslation(-v.origin.x, -v.origin.y, -v.origin.z);
    return T1.multiply(Rm).multiply(T0);
  }
  const keys = new Map(), touchMeshes = [], cradles = [];
  const clampS = (s, sp) => Math.min(Math.max(s, Math.min(sp[0], sp[1])), Math.max(sp[0], sp[1]));
  function rodPoint(rod, s) {
    if (rod.neckAxis) return [rod.neckAxis.s, rod.phi, rod.dr];
    return [s, rod.phi, rod.dr];
  }
  function buildKey(k) {
    const rod = M.ROD[k.rod], mats = makeMats(k.group);
    const holder = new THREE.Group(); holder.name = 'holder.' + k.id;
    const pivot = new THREE.Group(); pivot.name = 'pivot.' + k.id;
    const geom = new THREE.Group(); geom.name = 'geom.' + k.id;
    holder.add(pivot); pivot.add(geom); root.add(holder);
    const [ea, eb] = rod.neckAxis ? M.rodEnds(rod).map(V) : M.rodEnds(rod, k.span[0], k.span[1]).map(V);
    const origin = rod.neckAxis ? ea.clone().lerp(eb, 0.5) : ea.clone(), axis = (rod.neckAxis ? M.rodEnds(rod).map(V) : M.rodEnds(rod).map(V)).reduce((a, b) => b.clone().sub(a)).normalize();
    pivot.position.copy(origin); geom.position.copy(origin).negate();
    const add = o => { geom.add(o); return o; };
    const fix = [], addR = o => { geom.add(o); fix.push(o); return o; };
    // hinge tube
    add(cyl(ea, eb, 2.15, 2.15, mats.brass, 'key tube', 16));
    const mark = new THREE.Object3D(); mark.name = 'mark.' + k.id; add(mark);
    const outs = [];
    // cups
    for (const hid of k.cups) {
      const h = M.HOLE[hid], n = V(M.normalAt(h.s, h.phi)), H = chimH(h), rc = h.rh + 2.4, c0 = V(M.surf(h.s, h.phi, H));
      const prof = [[0, 3.6], [rc - 0.8, 3.6], [rc, 3.0], [rc, -0.4], [rc - 0.5, -0.4], [rc - 0.5, 3.0], [0, 3.0]].map(q => new THREE.Vector2(q[0], q[1]));
      add(orient(mesh(new THREE.LatheGeometry(prof, 36), mats.brass, 'cup'), c0, n));
      add(disc(c0.clone().addScaledVector(n, 1.45), n, rc - 0.6, 2.6, mats.pad, 'pad', 36)); stats.pads++;
      if (h.rh > 3) { add(disc(c0.clone().addScaledVector(n, 0.12), n, Math.min(h.rh - 1, 0.45 * rc), 0.3, mats.reso, 'resonator', 24)); stats.resonators++; }
      const rp = rodPoint(rod, clampS(h.s, k.span));
      add(tubeAlong(surfPts(rp, [h.s, h.phi, H + 3.6], 10), 1.6, mats.brass, 'arm')); stats.arms++;
      if (!mark.userData.set) { mark.position.copy(c0.clone().addScaledVector(n, 3.6)); mark.userData.set = 1; }
      outs.push(n);
    }
    // the neck key ring (CONTRACT F10, F14)
    if (k.id === 'k_oneck') {
      const s = 300, c = M.center(s), ring = mesh(new THREE.TorusGeometry(M.radius(s) + 2.6, 1.15, 8, 40), mats.brass, 'ring');
      orient(ring, V(c.p), V(c.t)); ring.rotateX(Math.PI / 2); add(ring);
      add(tubeAlong(surfPts([246, 90, 7], [s, 90, 2.6], 10), 1.6, mats.brass, 'arm')); stats.arms++;
    }
    // touches
    const touchViews = [];
    for (const t of k.touches) {
      const onCup = t.kind === 'pearl' && t.dr === 0;
      const n = V(M.normalAt(t.s, t.phi)), tan = V(M.center(t.s).t);
      let p;
      if (onCup) {
        const h = M.HOLE[k.cups[0]], c0 = V(M.surf(h.s, h.phi, chimH(h)));
        p = c0.clone().addScaledVector(n, 3.6 + 1.1);
        add(disc(p, n, 7.3, 1.6, mats.brass, 'bezel', 28));
        p = p.clone().addScaledVector(n, 1.2);
        const pe = add(disc(p, n, 6.4, 1.6, mats.pearl, 'pearl', 28)); pe.userData.touch = t.id; touchMeshes.push(pe); stats.pearls++;
      } else {
        p = V(M.surf(t.s, t.phi, t.dr));
        const rp = rodPoint(rod, clampS(t.s, k.span));
        addR(tubeAlong(surfPts(rp, [t.s, t.phi, t.dr - 1.2], 10), 1.7, mats.brass, 'arm')); stats.arms++;
        let tm;
        if (t.kind === 'pearl-small') {
          addR(disc(p, n, 5, 1.6, mats.brass, 'bezel', 20));
          tm = addR(disc(p.clone().addScaledVector(n, 1.2), n, 4.2, 1.4, mats.pearl, 'pearl', 20)); stats.pearls++;
        } else if (t.kind === 'thumb') {
          addR(disc(p, n, 8.6, 2.2, mats.brass, 'bezel', 28));
          tm = addR(disc(p.clone().addScaledVector(n, 1.5), n, 7.4, 1.4, mats.pearl, 'pearl', 28)); stats.pearls++;
        } else if (t.kind === 'palm') {
          tm = addR(plate(p, n, tan, 20, 13, 2.6, mats.brass, 'palm touch'));
          const pe = addR(disc(p.clone().addScaledVector(n, 1.6), n, 5, 1.2, mats.pearl, 'pearl', 20)); pe.scale.set(1.25, 1, 0.8); stats.pearls++;
          pe.userData.touch = t.id; touchMeshes.push(pe);
        } else if (t.kind === 'spatula') {
          tm = addR(plate(p, n, tan, 19, 12, 2.4, mats.brass, 'spatula'));
        } else {
          tm = addR(mesh(new THREE.CapsuleGeometry(3.4, 16, 4, 10), mats.brass, 'lever'));
          tm.position.copy(p); tmpQ.setFromUnitVectors(Y, tan); tm.quaternion.copy(tmpQ); tm.scale.set(1, 1, 0.62);
          // flatten the lever across the normal
          const look = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(tan, n).normalize(), tan, n);
          tm.quaternion.setFromRotationMatrix(look);
        }
        tm.userData.touch = t.id; touchMeshes.push(tm);
      }
      // a larger hidden target for touch screens
      const proxy = new THREE.Mesh(new THREE.SphereGeometry(t.kind === 'pearl-small' ? 7 : 11, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
      const put = onCup ? add : addR;
      proxy.position.copy(p); proxy.userData.touch = t.id; proxy.userData.proxy = true; put(proxy); touchMeshes.push(proxy);
      const tmark = new THREE.Object3D(); tmark.position.copy(p); put(tmark);
      touchViews.push({ id: t.id, mark: tmark, n0: n.clone(), p0: p.clone() });
      if (!mark.userData.set) { mark.position.copy(p); mark.userData.set = 1; }
      outs.push(n);
      // cork under the touch (normally closed keys and levers)
      if (k.stops.some(s => s.where === 'touch')) {
        put(disc(V(M.surf(t.s, t.phi, Math.max(0.9, (onCup ? 0 : t.dr) - 2.6))), n, 3.1, 1.5, mats.cork, 'cork')); stats.corks++;
      }
    }
    if (!mark.userData.set) {
      const sm = rod.neckAxis ? rod.neckAxis.s : (k.span[0] + k.span[1]) / 2;
      mark.position.copy(V(M.surf(sm, rod.phi, rod.dr + 2)));
      outs.push(V(M.normalAt(sm, rod.phi)));
    }
    // open stop or foot felt: a short foot off the tube, felt toward the body
    for (const st of k.stops) {
      if (st.where === 'touch') continue;
      const sm = rod.neckAxis ? rod.neckAxis.s - 8 : lerp(k.span[0], k.span[1], 0.5), ph = rod.phi + (k.cups.length ? -Math.sign(dphi(rod.phi, M.HOLE[k.cups[0]].phi) || 1) * 16 : 16);
      const f0 = rodPoint(rod, sm), f1 = [sm, ph, 2.4];
      addR(tubeAlong(surfPts(f0, f1, 6), 1.3, mats.brass, 'foot'));
      addR(disc(V(M.surf(sm, ph, 1.3)), V(M.normalAt(sm, ph)), 2.6, 1.3, st.kind === 'cork' ? mats.cork : mats.felt, st.kind)); st.kind === 'cork' ? stats.corks++ : stats.felts++;
    }
    // spring
    let spring = null;
    if (k.spring === 'needle') {
      const s0 = rod.neckAxis ? rod.neckAxis.s - 12 : k.span[0] - 1, s1 = rod.neckAxis ? rod.neckAxis.s - 1 : lerp(k.span[0], k.span[1], 0.6);
      const side = rod.phi + 22, fixed = V(M.surf(s0, side, Math.max(2.2, rod.dr - 1.5)));
      const tip = V(M.surf(s1, side - 8, rod.dr + 0.5));
      const cr = addR(disc(tip, V(M.normalAt(s1, side)), 1.2, 3, mats.brass, 'cradle', 10));
      const sp = cyl(fixed, tip, 0.45, 0.4, mats.spring, 'needle spring', 6); root.add(sp); stats.needle++;
      const tipMark = new THREE.Object3D(); tipMark.position.copy(tip); addR(tipMark);
      spring = { mesh: sp, fixed, tipMark };
      cradles.push(spring);
    } else if (k.spring === 'flat') {
      const t = k.touches[0], sm = t ? clampS(t.s, k.span) : lerp(k.span[0], k.span[1], 0.5);
      const ph = t ? lerp(rod.phi, rod.phi + dphi(rod.phi, t.phi), 0.55) : rod.phi + 12;
      const p = V(M.surf(sm, ph, 1.6)), n = V(M.normalAt(sm, ph)), along = V(M.surf(sm, ph + 6, 1.6)).sub(p);
      addR(plate(p, n, along, 12, 3, 0.55, mats.spring, 'flat spring')); stats.flat++;
    }
    // sign of the turn
    const c = k.cups.length ? M.HOLE[k.cups[0]] : null;
    let sign = 1;
    if (c) {
      const cc = V(M.surf(c.s, c.phi, chimH(c))), d = cc.sub(origin), disp = new THREE.Vector3().crossVectors(axis, d);
      sign = disp.dot(V(M.normalAt(c.s, c.phi))) > 0 ? 1 : -1;
    } else if (k.touches.length) {
      const t = k.touches[0], d = V(M.surf(t.s, t.phi, t.dr)).sub(origin), disp = new THREE.Vector3().crossVectors(axis, d);
      sign = disp.dot(V(M.normalAt(t.s, t.phi))) < 0 ? 1 : -1;
    }
    const tr = (k.travel * Math.PI) / 180;
    let restAngle = 0, actAngle = 0;
    if (c) { const open = sign * tr; restAngle = k.restOpen ? open : 0; actAngle = k.restOpen ? 0 : open; }
    else actAngle = sign * tr;
    const out = outs.reduce((a, b) => a.add(b), new THREE.Vector3()).normalize();
    const view = { id: k.id, k, group: k.group, holder, pivot, geom, origin, axis, restAngle, actAngle, angle: restAngle, target: restAngle, mats, mark, touches: touchViews, out, spring, links: [] };
    pivot.quaternion.setFromAxisAngle(axis, restAngle);
    if (restAngle) { const m = invRest(view); for (const o of fix) o.applyMatrix4(m); }
    keys.set(k.id, view);
  }
  for (const k of M.KEYS) buildKey(k);

  // ---- links -----------------------------------------------------------------------
  // auto anchors: the nearest pair of points on the two key tubes
  function spanPts(k) {
    const rod = M.ROD[k.rod];
    if (rod.neckAxis) return [[rod.neckAxis.s, rod.phi, rod.dr]];
    const out = []; for (let i = 0; i <= 24; i++) out.push([lerp(k.span[0], k.span[1], i / 24), rod.phi, rod.dr]);
    return out;
  }
  function nearest(A, B) {
    let best = null, bd = Infinity;
    const mb = B[Math.floor(B.length / 2)], pb = V(M.surf(...mb));
    for (const a of A) { const d = V(M.surf(...a)).distanceTo(pb); if (d < bd) { bd = d; best = a; } }
    const pa = V(M.surf(...best)); bd = Infinity; let bb = null;
    for (const b of B) { const d = V(M.surf(...b)).distanceTo(pa); if (d < bd) { bd = d; bb = b; } }
    return [best, bb];
  }
  const linkViews = [];
  let lane = new Map();
  function buildLink(l, from, to, tag) {
    const kf = M.KEY[from], kt = M.KEY[to], vf = keys.get(from), vt = keys.get(to);
    let a, b, via = [];
    if (l.at && tag !== 'a2') { a = l.at.a; b = l.at.b; via = l.at.via || []; }
    else { [a, b] = nearest(spanPts(kf), spanPts(kt)); }
    // lift the bar above the tubes, and give each bar on one rod its own lane
    const lk = kf.rod + '>' + kt.rod, n = lane.get(lk) || 0; lane.set(lk, n + 1);
    const lift = 3.6 + n * 2.2;
    a = [a[0], a[1] + (l.at ? 0 : 4 + n * 5), a[2] + (l.at ? 0 : lift)];
    b = [b[0], b[1] + (l.at ? 0 : 4 + n * 5), b[2] + (l.at ? 0 : lift)];
    const chain = [a, ...via, b];
    let pts = [];
    for (let i = 0; i < chain.length - 1; i++) { const seg = surfPts(chain[i], chain[i + 1], 8); pts.push(...(i ? seg.slice(1) : seg)); }
    if (pts.length < 2) pts = [V(M.surf(...a)), V(M.surf(...b))];
    // split at the middle of the length
    const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const L = lens[lens.length - 1], half = L / 2;
    let im = 1; while (im < pts.length - 1 && lens[im] < half) im++;
    const k0 = (half - lens[im - 1]) / Math.max(1e-6, lens[im] - lens[im - 1]), mid = pts[im - 1].clone().lerp(pts[im], k0);
    const dir = pts[im].clone().sub(pts[im - 1]).normalize();
    const gap = Math.min(1.4, L * 0.1);
    const p1 = [...pts.slice(0, im), mid.clone().addScaledVector(dir, -gap)], p2 = [mid.clone().addScaledVector(dir, gap), ...pts.slice(im)];
    const r = l.part === 'bar' ? 1.3 : l.part === 'fork' ? 1.5 : 1.4;
    // geom children are in world space (geom sits at -origin under the pivot)
    const sideF = [], sideT = [];
    const onF = o => { vf.geom.add(o); sideF.push(o); return o; }, onT = o => { vt.geom.add(o); sideT.push(o); return o; };
    const h1 = onF(tubeAlong(p1.length >= 2 ? p1 : [pts[0], mid], r, vf.mats.brass, 'link'));
    const h2 = onT(tubeAlong(p2.length >= 2 ? p2 : [mid, pts[pts.length - 1]], r, vt.mats.brass, 'link'));
    // contact
    let contact;
    if (l.adjust === 'screw') {
      contact = new THREE.Group();
      const sc = cyl(mid.clone().addScaledVector(dir, -gap - 2.6), mid.clone().addScaledVector(dir, -0.2), 1.0, 1.0, vf.mats.steel, 'adjust screw', 10);
      const hd = disc(mid.clone().addScaledVector(dir, -gap - 3.2), dir, 1.8, 1.2, vf.mats.steel, 'adjust screw', 14);
      onF(sc); onF(hd); stats.screws++;
      const fe = onT(disc(mid.clone().addScaledVector(dir, 0.6), dir, 2.4, 1.1, vt.mats.felt, 'felt', 16)); stats.felts++;
      contact = fe;
    } else {
      contact = disc(mid.clone().addScaledVector(dir, 0.5), dir, l.part === 'fork' ? 2.8 : 2.4, 1.2, l.adjust === 'cork' ? vt.mats.cork : vt.mats.felt, l.adjust, 16);
      onT(contact); l.adjust === 'cork' ? stats.corks++ : stats.felts++;
    }
    if (l.part === 'fork') { // two prongs round the pin
      const side = new THREE.Vector3().crossVectors(dir, V(M.normalAt(a[0], a[1]))).normalize();
      for (const sg of [-1, 1]) onF(cyl(mid.clone().addScaledVector(dir, -gap - 3).addScaledVector(side, sg * 2.2), mid.clone().addScaledVector(dir, -0.3).addScaledVector(side, sg * 2.2), 0.8, 0.8, vf.mats.brass, 'fork', 8));
      onT(cyl(mid.clone().addScaledVector(side, -3), mid.clone().addScaledVector(side, 3), 0.9, 0.9, vt.mats.steel, 'pin', 8));
    }
    stats.contacts++;
    const cm = new THREE.Object3D(); cm.position.copy(mid); onF(cm);
    // the link is drawn for the rest pose of both keys
    for (const o of sideF) o.applyMatrix4(invRest(vf));
    for (const o of sideT) o.applyMatrix4(invRest(vt));
    const v = { id: l.id + (tag ? ':' + tag : ''), link: l, from, to, h1, h2, contact, mark: cm };
    vf.links.push(v); vt.links.push(v); linkViews.push(v);
    return v;
  }
  for (const l of M.LINKS) {
    if (l.kind === 'drive') buildLink(l, l.from, l.to);
    else if (l.kind === 'hold') buildLink(l, l.by, l.to);
    else { buildLink(l, l.from, l.a, 'a'); buildLink(l, l.from, l.b, 'a2'); }
  }

  // ---- neck, mouthpiece, reed, ligature --------------------------------------------
  const neck = new THREE.Group(); neck.name = 'neck'; root.add(neck);
  function buildNeck() {
    neck.add(mesh(tubeGeo(M.S_NECK, M.S_BODY + 14, 4, 40), neckBrass, 'neck tube'));
    neck.add(mesh(tubeGeo(M.S_NECK - 2, M.S_NECK + 26, 2, 40, s => M.radius(Math.max(s, M.S_NECK)) + 1.4), neckMats.cork, 'neck cork')); stats.corks++;
    // neck screw at the socket
    const n = V(M.normalAt(M.S_BODY + 9, 90)), p0 = V(M.surf(M.S_BODY + 9, 90, 1.3));
    neck.add(cyl(p0, p0.clone().addScaledVector(n, 8), 2.2, 2.2, neckMats.steel, 'neck screw')); stats.screws++;
    neck.add(disc(p0.clone().addScaledVector(n, 9.5), n, 4.6, 3, neckMats.brass, 'neck screw knob'));
    // mouthpiece: lathe along its axis, flattened on the reed side to a table
    const c80 = M.center(M.S_NECK), dir = V(c80.t).negate(), nReed = new THREE.Vector3(0.423, -0.906, 0).normalize();
    const zt = y => (y < 60 ? 9 : 9 - Math.pow((y - 60) / 20, 2) * 2.4);
    const prof = [[0.1, -22], [13.6, -22], [13.6, 44], [13.2, 56], [12.2, 66], [10.8, 74], [9.6, 80], [6, 81.2], [0.1, 81.4]].map(q => new THREE.Vector2(q[0], q[1]));
    const mg = new THREE.LatheGeometry(prof, 48), pa = mg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i), z = pa.getZ(i), lim = zt(Math.max(-22, y)); if (z < -lim) pa.setZ(i, -lim); }
    mg.computeVertexNormals();
    const mp = mesh(mg, rubber, 'mouthpiece');
    const zAxis = nReed.clone().negate(), xAxis = new THREE.Vector3().crossVectors(dir, zAxis).normalize();
    zAxis.crossVectors(xAxis, dir).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, dir, zAxis);
    mp.quaternion.setFromRotationMatrix(basis); mp.position.copy(V(c80.p)); neck.add(mp);
    const local = (x, y, z) => V(c80.p).addScaledVector(xAxis, x).addScaledVector(dir, y).addScaledVector(zAxis, z);
    // reed: thins toward the tip
    const rg = new THREE.BoxGeometry(13, 70, 1.6, 2, 12, 1), ra = rg.attributes.position;
    for (let i = 0; i < ra.count; i++) { const y = ra.getY(i) + 35, k = Math.max(0, (y - 30) / 40); if (ra.getZ(i) < 0) ra.setZ(i, -0.8 + k * 0.62); }
    rg.computeVertexNormals();
    const reed = mesh(rg, cane, 'reed'); reed.quaternion.copy(mp.quaternion); reed.position.copy(local(0, 81.2 - 35, -9 - 0.95)); neck.add(reed);
    // ligature: two bands, a plate on the reed, two screws
    for (const y of [20, 33]) {
      const tg = new THREE.TorusGeometry(14.2, 1.0, 8, 40), ring = mesh(tg, neckMats.reso, 'ligature');
      ring.quaternion.copy(mp.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      ring.position.copy(local(0, y, 0)); ring.scale.set(1, 1, 1); neck.add(ring);
      const sc = cyl(local(-9, y, 14.6), local(9, y, 14.6), 1.1, 1.1, neckMats.steel, 'ligature screw', 10); neck.add(sc); stats.screws++;
      neck.add(disc(local(10.5, y, 14.6), xAxis, 3.2, 2.6, neckMats.reso, 'ligature screw knob'));
    }
    neck.add(plate(local(0, 26.5, -11.4), zAxis.clone().negate(), dir, 18, 11, 1.2, neckMats.reso, 'ligature plate'));
  }
  buildNeck();

  // ---- statics -----------------------------------------------------------------------
  const staticByGroup = new Map();
  for (const [, st] of statics) {
    const m = mesh(merge(st.geos), st.mat, 'static');
    // a ghost needs its own material per group
    if (st.mat !== bodyMat && st.mat !== holeMat) { m.material = st.mat.clone(); m.material.userData.base = { opacity: 1, color: st.mat.color.getHex() }; gm(st.group).add(m.material); }
    else { m.material = st.mat.clone(); m.material.userData.base = { opacity: 1, color: st.mat.color.getHex() }; gm(st.group).add(m.material); }
    m.name = 'static.' + st.group; root.add(m);
    if (!staticByGroup.has(st.group)) staticByGroup.set(st.group, []);
    staticByGroup.get(st.group).push(m);
    for (const g of st.geos) g.dispose();
  }

  // ---- state and animation -----------------------------------------------------------
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
  function setState(r) { for (const [id, v] of keys) v.target = r.act.has(id) ? v.actAngle : v.restAngle; }
  function updateSpring(v) {
    const sp = v.spring; if (!sp) return;
    v.pivot.updateMatrixWorld(true);
    sp.tipMark.getWorldPosition(tmpV);
    const d = tmpW.copy(tmpV).sub(sp.fixed), L = d.length();
    sp.mesh.position.copy(sp.fixed).addScaledVector(d, 0.5);
    sp.mesh.quaternion.setFromUnitVectors(Y, d.normalize());
    sp.mesh.scale.set(1, L / sp.mesh.geometry.parameters.height, 1);
  }
  function tick(dt) {
    let moving = false;
    const k = 1 - Math.exp(-Math.max(0, dt) * 16);
    for (const [, v] of keys) {
      const e = v.target - v.angle;
      if (Math.abs(e) < 1e-4) { if (v.angle !== v.target) { v.angle = v.target; v.pivot.quaternion.setFromAxisAngle(v.axis, v.angle); updateSpring(v); } continue; }
      v.angle += e * k; moving = true;
      v.pivot.quaternion.setFromAxisAngle(v.axis, v.angle);
      updateSpring(v);
    }
    // explode easing
    for (const [, v] of keys) {
      const goal = explode.group === v.group ? explode.amount : 0, cur = v.holder.userData.ex || 0, nx = cur + (goal - cur) * k;
      if (Math.abs(nx - cur) > 1e-4) { moving = true; v.holder.userData.ex = nx; v.holder.position.copy(v.out).multiplyScalar(nx * 26); if (v.spring) v.spring.mesh.visible = nx < 0.05; updateSpring(v); }
    }
    return moving;
  }
  const explode = { group: null, amount: 0 };
  function setExplode(g, a) { explode.group = g; explode.amount = g ? Math.max(0, Math.min(1, a)) : 0; }
  function setGhost(g) {
    for (const [gid, set] of groupMats) {
      const ghost = g && gid !== g && gid !== 'static-steel' && gid !== 'static-brass';
      for (const m of set) {
        const op = ghost ? (gid === 'body' ? 0.16 : 0.1) : 1;
        m.transparent = op < 1; m.opacity = op; m.depthWrite = op >= 1; m.needsUpdate = true;
      }
    }
  }
  let tint = false;
  function setTint(on) {
    tint = !!on;
    for (const [, v] of keys) {
      const g = M.GROUP[v.group];
      v.mats.brass.color.setHex(v.mats.brass.userData.base.color);
      if (tint && g) v.mats.brass.color.lerp(new THREE.Color(g.color), 0.72);
    }
  }
  function setGlow(ids = [], linkIds = []) {
    const on = new Set(ids), lk = new Set(linkIds);
    for (const [id, v] of keys) {
      const g = M.GROUP[v.group], c = new THREE.Color(g ? g.color : '#ffffff');
      for (const m of [v.mats.brass, v.mats.pearl]) { m.emissive.copy(on.has(id) ? c : new THREE.Color(0)); m.emissiveIntensity = on.has(id) ? 0.55 : 0; }
    }
    for (const lv of linkViews) {
      const m = lv.contact.material, c = lk.has(lv.link.id) ? new THREE.Color('#ffffff') : new THREE.Color(0);
      if (m.emissive) { m.emissive.copy(c); m.emissiveIntensity = lk.has(lv.link.id) ? 0.9 : 0; }
    }
  }
  const keyPoint = id => { const v = keys.get(id); return v ? v.mark.getWorldPosition(new THREE.Vector3()) : null; };
  function touchPoint(id) {
    const t = M.TOUCH[id]; if (!t) return null;
    const v = keys.get(t.key), tv = v.touches.find(x => x.id === id);
    return tv.mark.getWorldPosition(new THREE.Vector3());
  }
  // path: [[fromKey, linkId, toKey]] -> polylines in world space
  function tracePoints(path, touchId) {
    const out = [];
    for (const [f, lid, t] of path) {
      const lv = linkViews.find(x => x.link.id === lid && x.to === t) || linkViews.find(x => x.link.id === lid);
      if (!lv) continue;
      const a = (touchId && M.TOUCH[touchId] && M.TOUCH[touchId].key === f) ? touchPoint(touchId) : keyPoint(f);
      out.push([a, lv.mark.getWorldPosition(new THREE.Vector3()), keyPoint(t)]);
    }
    return out;
  }
  function groupBox(g) {
    const box = new THREE.Box3();
    root.updateMatrixWorld(true);
    for (const [, v] of keys) if (!g || v.group === g) box.expandByObject(v.holder);
    if (g === 'neck' || !g) box.expandByObject(neck);
    if (!g) box.expandByObject(body);
    return box;
  }
  root.updateMatrixWorld(true);
  for (const [, v] of keys) updateSpring(v);
  return { root, body, neck, keys, links: linkViews, touchMeshes, statics: staticByGroup, groupMats, stats,
    setState, tick, setExplode, setGhost, setTint, setGlow, keyPoint, touchPoint, tracePoints, groupBox, get tint() { return tint; } };
}

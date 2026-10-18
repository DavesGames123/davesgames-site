// ============================================================================
//  CORAL REEF  ·  ROV  ·  the vehicle model (three r160, no DOM)
// ----------------------------------------------------------------------------
//  buildVehicle(THREE, o) makes one original work-class ROV from three.js
//  primitives, lathes, extrusions and small generated textures. Vehicle
//  frame: x forward, y up, z to starboard, metres. The default size is
//  2.2 x 1.4 x 1.5 m (scale with o.scale).
//
//  The user (2026-10-18): "it's rendered very low res and very dark".
//  The model has smooth round parts (32-sided ducts, lathed pods, rounded
//  boxes with smooth normals), and real detail: bolt heads, gussets, the
//  thruster guards, twisted blades, cable runs, grab handles, anodes,
//  labels and hazard stripes (small DataTextures), syntactic foam with a
//  grain and scuffs, a black frame with edge wear.
//
//  PARTS
//    frame ........ anodised tubes with corner nodes, posts and braces,
//                   two skids with turned-up noses, a tool basket below
//    buoyancy ..... the yellow foam block (an extruded rounded slab, two
//                   holes for the vertical thrusters), a dark band, the
//                   number plates, tie-down straps
//    thrusters .... 4 vectored horizontal thrusters at 45 degrees and 2
//                   vertical thrusters: a lathed duct, guard bars, a motor
//                   pod, stator vanes, a spinner and 4 twisted blades in a
//                   group that spins
//    front ........ a pan-tilt camera pod with a domed lens (the feed
//                   camera sits at the lens), a light bar with 4 finned
//                   lamp heads and 1 or 2 SpotLights, a forward sonar
//    manipulator .. a 5-joint arm on the starboard side, a grabber to port
//    systems ...... pressure housings with bolted end caps, a hydraulic
//                   unit with a grille, a DVL, the tether termination
//                   with a ribbed bend restrictor, a flasher mast, LEDs
//
//  LOD. The small parts (bolts, gussets, cables, handles, labels, anodes,
//  straps) are in a THREE.LOD (parts.detail): three shows them nearer
//  than o.detailFar (14 m; 9 m on low quality) to the camera that draws
//  (the main view and the feed camera; three updates a LOD in render).
//  quality 'low' (phones): fewer segments and fewer small parts.
//  The static meshes are merged per material (one draw call each), the
//  moving parts (props, camera pod, arm, lamp faces, LEDs) stay separate.
//  rovTris(parts) gives the triangles near and far.
//
//  RETURNS { group, body, detail, props: [{ spin, kind, side, group,
//  rpm }], leds: [{ mesh, colour, phase, rate }], lights, lightTargets,
//  lamps, camera, cameraPod, cameraTilt, arm: { shoulder, up, elbow,
//  wrist, jawL, jawR }, tetherPoint, sonar, materials, textures,
//  dispose() }
//
//  grep -n targets
//    "function roundBox"        a box with round edges and smooth normals
//    "function wear"            the vertex-colour wear and edge wear
//    "function makeTextures"    foam grain, plate number, hazard stripes
//    "function thruster"        duct, guard, pod and spinning prop
//    "function buoyancy"        the foam block
//    "function manipulator"     the arm
//    "function bake"            the merge of the static meshes
//    "export function rovTris"  the triangle count near and far
//    "export function buildVehicle"
// ============================================================================

const TAU = Math.PI * 2;

function vnoise(x, y, z, seed) {
  const h = (i, j, k) => {
    let n = (i * 374761393 + j * 668265263 + k * 1440670441 + seed * 2246822519) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

// The triangles of a model: near (every part) and far (no detail LOD).
export function rovTris(parts) {
  let near = 0, far = 0;
  const count = (m) => {
    const g = m.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return n * (m.isInstancedMesh ? m.count : 1);
  };
  let inDetail = (m) => { for (let p = m; p; p = p.parent) if (p === parts.detail) return true; return false; };
  parts.group.traverse((m) => {
    if (!m.isMesh) return;
    const n = count(m);
    near += n;
    if (!inDetail(m)) far += n;
  });
  return { near, far };
}

// 3 x 5 pixel glyphs for the plates (rows top to bottom, 3 bits each).
const GLYPH = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 2, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7],
  R: [6, 5, 6, 5, 5], O: [7, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], '-': [0, 0, 7, 0, 0], ' ': [0, 0, 0, 0, 0],
};

export function buildVehicle(THREE, o = {}) {
  const seed = o.seed ?? 1, low = o.quality === 'low', q = low ? 0.5 : 1;
  const seg = (n) => Math.max(6, Math.round(n * q));
  const rs = low ? 1 : 2;                   // the round-edge segments of roundBox
  const group = new THREE.Group();
  group.name = 'rov-' + (o.id ?? 0);
  const body = new THREE.Group();          // everything but the lights
  group.add(body);
  const own = [];                          // geometries to dispose
  const G = (g) => { own.push(g); return g; };
  const Y = new THREE.Vector3(0, 1, 0);

  // ── textures ─────────────────────────────────────────────────────────────
  const textures = makeTextures(THREE, seed, o.id ?? 0);

  // ── materials ────────────────────────────────────────────────────────────
  // frame and black parts: the vertex colours carry the anodise (dark) and
  // the edge wear (light), see wear()
  const M = {
    foam: new THREE.MeshStandardMaterial({ color: o.foam ?? 0xf2b705, roughness: 0.78, metalness: 0, vertexColors: true, map: textures.foam, bumpMap: textures.foamBump, bumpScale: 1.2 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x8f959b, roughness: 0.45, metalness: 0.7, vertexColors: true }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.9, vertexColors: true }),
    black: new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.05, vertexColors: true }),
    orange: new THREE.MeshStandardMaterial({ color: 0xe0561b, roughness: 0.5, metalness: 0.05, vertexColors: true }),
    housing: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.32, metalness: 0.85, vertexColors: true }),
    prop: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.38, metalness: 0.3, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.04, metalness: 0.3 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 3, roughness: 0.2 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0, vertexColors: true }),
    plate: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, map: textures.plate }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, map: textures.hazard }),
    cable: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0 }),
    anode: new THREE.MeshStandardMaterial({ color: 0x8e9294, roughness: 0.75, metalness: 0.5, vertexColors: true }),
  };
  const WEAR = { foam: 'foam', frame: 'edge', black: 'edge', steel: 'tint', housing: 'tint', orange: 'tint', stripe: 'tint', anode: 'tint' };
  for (const k in M) { M[k].userData.wear = WEAR[k] || null; M[k].userData.rov = k; }
  const ledMat = (c) => { const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.5, roughness: 0.3 }); m.userData.rov = 'led'; return m; };

  const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(G(geo), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  // a tube between two points
  function tube(a, b, r, mat, parent = body, radial = 16) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    const m = add(new THREE.CylinderGeometry(r, r, L, seg(radial), 1), mat, 0, 0, 0, parent);
    m.position.copy(A).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(Y, d.normalize());
    return m;
  }
  // a smooth tube along points (cables, handles, the bail)
  function pipe(pts, r, mat, parent, radial = 8, n = 24) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    return add(new THREE.TubeGeometry(curve, Math.max(4, Math.round(n * q)), r, Math.max(4, Math.round(radial * (low ? 0.75 : 1))), false), mat, 0, 0, 0, parent);
  }
  // a box with round edges: the edge bands get rs segments each, the
  // normals point from the inner box (smooth on the rounds, flat faces)
  function roundBox(w, h, d, r, rs1 = rs) {
    r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const rs = rs1, N = 2 * rs + 1;
    const g = new THREE.BoxGeometry(w, h, d, N, N, N);
    const p = g.attributes.position, nr = g.attributes.normal, H = [w / 2, h / 2, d / 2];
    const v = [0, 0, 0], inner = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      v[0] = p.getX(i); v[1] = p.getY(i); v[2] = p.getZ(i);
      for (let a = 0; a < 3; a++) {
        const hh = H[a], t = (v[a] + hh) / (2 * hh) * N;
        let u;
        if (t <= rs) u = -hh + r * t / rs; else if (t >= N - rs) u = hh - r * (N - t) / rs; else u = -hh + r + (t - rs) * (2 * hh - 2 * r);
        v[a] = u;
        inner[a] = Math.max(-hh + r, Math.min(hh - r, u));
      }
      let nx = v[0] - inner[0], ny = v[1] - inner[1], nz = v[2] - inner[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      p.setXYZ(i, inner[0] + nx * r, inner[1] + ny * r, inner[2] + nz * r);
      nr.setXYZ(i, nx, ny, nz);
    }
    return g;
  }
  const rbox = (w, h, d, r, mat, x, y, z, parent = body, k = rs) => add(roundBox(w, h, d, r, k), mat, x, y, z, parent);
  // small parts: one segment on each round edge (108 triangles)
  const sbox = (w, h, d, r, mat, x, y, z, parent = body) => rbox(w, h, d, r, mat, x, y, z, parent, 1);
  // a hex bolt head on a face with normal n (unit, vehicle axes)
  // (no bottom cap: it sits on the face; three builds the side, the top
  // cap, then the bottom cap, so the first 18 triangles are kept)
  const boltGeo = G(new THREE.CylinderGeometry(0.0085, 0.0085, 0.007, 6, 1));
  boltGeo.setIndex(new THREE.BufferAttribute(boltGeo.index.array.slice(0, 18 * 3), 1));
  const boltQ = new THREE.Quaternion();
  function bolt(pos, n, parent) {
    const m = new THREE.Mesh(boltGeo, M.steel);
    m.position.set(pos[0] + n[0] * 0.0035, pos[1] + n[1] * 0.0035, pos[2] + n[2] * 0.0035);
    m.quaternion.copy(boltQ.setFromUnitVectors(Y, new THREE.Vector3(...n)));
    parent.add(m);
    return m;
  }

  // ── the detail LOD ───────────────────────────────────────────────────────
  const detailFar = o.detailFar ?? (low ? 9 : 14);
  const detail = new THREE.LOD();
  detail.name = 'rov-detail';
  const detailNear = new THREE.Group(), detailNone = new THREE.Object3D();
  detail.addLevel(detailNear, 0);
  detail.addLevel(detailNone, detailFar);
  body.add(detail);
  const D = detailNear;

  // ── frame ────────────────────────────────────────────────────────────────
  const fx = 1.02, fz = 0.62, yb = -0.68, yt = 0.22, tr = 0.032;
  const posts = [-fx, -0.35, 0.35, fx];
  for (const z of [-fz, fz]) {
    tube([-fx, yb, z], [fx, yb, z], tr, M.frame);          // bottom rails
    tube([-fx, yt, z], [fx, yt, z], tr, M.frame);          // top rails
    for (const x of posts) tube([x, yb, z], [x, yt, z], tr, M.frame);   // posts
    tube([-fx, yb, z], [-0.35, yt, z], tr * 0.8, M.frame);  // braces
    tube([0.35, yt, z], [fx, yb, z], tr * 0.8, M.frame);
  }
  for (const x of [-fx, fx]) { tube([x, yb, -fz], [x, yb, fz], tr, M.frame); tube([x, yt, -fz], [x, yt, fz], tr, M.frame); }
  tube([-0.35, yb, -fz], [-0.35, yb, fz], tr, M.frame); tube([0.35, yb, -fz], [0.35, yb, fz], tr, M.frame);
  // welded corner nodes: smooth joints, no open tube ends
  const nodeGeo = G(new THREE.SphereGeometry(tr * 1.18, seg(14), seg(10)));
  for (const x of [-fx, fx]) for (const y of [yb, yt]) for (const z of [-fz, fz]) { const m = new THREE.Mesh(nodeGeo, M.frame); m.position.set(x, y, z); m.castShadow = true; body.add(m); }
  // gussets with 4 bolts where the posts meet the rails (outer faces)
  for (const z of [-fz, fz]) for (const x of posts.slice(1, 3)) for (const y of [yb + 0.05, yt - 0.05]) {
    const s = Math.sign(z), zz = z + s * (tr + 0.006);
    const gm = sbox(0.1, 0.1, 0.012, 0.004, M.frame, x, y, zz, D);
    gm.castShadow = false;
    if (!low) for (const [bx, by] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) bolt([x + bx, y + by, zz + s * 0.006], [0, 0, s], D);
  }
  // skids: rounded runners with a turned-up nose, anodes on the sides
  for (const z of [-0.5, 0.5]) {
    rbox(1.9, 0.07, 0.09, 0.02, M.black, -0.05, yb - 0.08, z);
    const nose = rbox(0.34, 0.07, 0.09, 0.02, M.black, 1.0, yb - 0.02, z);
    nose.rotation.z = 0.45;
    tube([-0.6, yb - 0.05, z], [-0.6, yb, z], 0.025, M.frame); tube([0.5, yb - 0.05, z], [0.5, yb, z], 0.025, M.frame);
    for (const x of [-0.7, 0.2]) sbox(0.12, 0.04, 0.03, 0.008, M.anode, x, yb - 0.08, z + Math.sign(z) * 0.06, D);
  }
  // tool basket under the front
  const bk = new THREE.Group(); bk.position.set(0.55, yb - 0.02, 0); body.add(bk);
  for (const z of [-0.32, 0.32]) tube([-0.3, 0, z], [0.3, 0, z], 0.014, M.steel, bk, 10);
  for (const x of [-0.3, -0.1, 0.1, 0.3]) tube([x, 0, -0.32], [x, 0, 0.32], 0.012, M.steel, bk, 10);
  for (const x of [-0.3, 0.3]) for (const z of [-0.32, 0.32]) tube([x, 0, z], [x, 0.16, z], 0.012, M.steel, bk, 10);

  // ── buoyancy block ───────────────────────────────────────────────────────
  const w = 2.06, d = 1.32, rr = 0.16;
  function outline(W, Dd, R) {
    const hx = W / 2 - R, hz = Dd / 2 - R, s = new THREE.Shape();
    s.moveTo(-hx, -Dd / 2); s.lineTo(hx, -Dd / 2); s.absarc(hx, -hz, R, -Math.PI / 2, 0); s.lineTo(W / 2, hz);
    s.absarc(hx, hz, R, 0, Math.PI / 2); s.lineTo(-hx, Dd / 2); s.absarc(-hx, hz, R, Math.PI / 2, Math.PI);
    s.lineTo(-W / 2, -hz); s.absarc(-hx, -hz, R, Math.PI, Math.PI * 1.5);
    return s;
  }
  function buoyancy() {
    const s = outline(w, d, rr);
    for (const x of [-0.42, 0.42]) { const h = new THREE.Path(); h.absarc(x, 0, 0.2, 0, TAU, true); s.holes.push(h); }
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: low ? 2 : 4, curveSegments: seg(14) });
    geo.rotateX(-Math.PI / 2);             // the shape plane (x, y) -> (x, -z); extrude along +y
    smoothNormals(geo, 50);
    const m = add(geo, M.foam, 0, yt + 0.06, 0);
    // the dark band round the block
    const band = new THREE.ExtrudeGeometry(outline(w + 0.12, d + 0.12, rr + 0.06), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: seg(12) });
    band.rotateX(-Math.PI / 2);
    smoothNormals(band, 50);
    add(band, M.stripe, 0, yt + 0.27, 0);
    // number plates (decal texture), port and starboard
    for (const z of [-1, 1]) {
      const p = add(new THREE.PlaneGeometry(0.4, 0.2), M.plate, -0.3, yt + 0.16, z * (d / 2 + 0.1035));
      p.castShadow = false;
      if (z < 0) p.rotation.y = Math.PI;
    }
    // hazard stripes on the front face, the thruster warning
    const hz = add(new THREE.PlaneGeometry(0.5, 0.07), M.hazard, w / 2 + 0.1035 - 0.0, yt + 0.16, 0, D);
    hz.rotation.y = Math.PI / 2; hz.castShadow = false;
    // tie-down straps over the foam with bolts at the ends, grab handles
    for (const x of [-0.78, 0.0, 0.78]) {
      const top = yt + 0.06 + 0.42 + 0.052;
      add(new THREE.BoxGeometry(0.06, 0.006, d + 0.14), M.steel, x, top, 0, D);
      for (const z of [-1, 1]) {
        add(new THREE.BoxGeometry(0.06, 0.5, 0.006), M.steel, x, top - 0.25, z * (d / 2 + 0.106), D);
        if (!low) for (const yy of [top - 0.04, top - 0.46]) bolt([x, yy, z * (d / 2 + 0.109)], [0, 0, z], D);
      }
    }
    for (const z of [-0.45, 0.45]) {
      const y0 = yt + 0.06 + 0.42 + 0.05;
      pipe([[-0.25, y0, z], [-0.22, y0 + 0.08, z], [0, y0 + 0.1, z], [0.22, y0 + 0.08, z], [0.25, y0, z]], 0.014, M.orange, D, 8, 20);
    }
    return m;
  }
  buoyancy();

  // ── thrusters ────────────────────────────────────────────────────────────
  const props = [];
  // a duct: a lathed ring with rounded lips and a flared intake; axis y
  const ductGeo = (() => {
    const R = 0.15, L = 0.2, t = 0.032, cr = 0.012, p = [];
    const corner = (cx, cy, a0) => { const n = Math.max(2, Math.round(3 * q)); for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; p.push(new THREE.Vector2(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr)); } };
    // counter-clockwise in (r, y): up the outer wall (normals out, three
    // LatheGeometry n = (dy, -dx)), the top lip, down the inner wall, the
    // bottom lip; the outer wall bulges a little (a flared intake)
    corner(R + t + 0.006 - cr, -L / 2 + cr, -Math.PI / 2);   // outer bottom
    p.push(new THREE.Vector2(R + t + 0.004, 0));
    corner(R + t - cr, L / 2 - cr, 0);                       // outer top
    corner(R + cr, L / 2 - cr, Math.PI / 2);                 // inner top
    corner(R + cr, -L / 2 + cr, Math.PI);                    // inner bottom
    p.push(p[0].clone());
    return G(new THREE.LatheGeometry(p, seg(28)));
  })();
  const podGeo = (() => {
    const pts = [[0, -0.2], [0.022, -0.196], [0.04, -0.183], [0.053, -0.16], [0.06, -0.13], [0.061, 0.0], [0.058, 0.025], [0.04, 0.032], [0, 0.034]];
    return G(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(20)));
  })();
  const hubGeo = (() => {
    const pts = [[0, -0.02], [0.045, -0.02], [0.045, 0.0], [0.042, 0.022], [0.032, 0.048], [0.016, 0.068], [0, 0.075]];
    return G(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(16)));
  })();
  // a blade: an outline in (radius, chord), extruded thin and twisted
  // from 0.95 rad at the root to 0.4 at the tip
  const bladeGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(0.035, -0.02); s.quadraticCurveTo(0.09, -0.042, 0.13, -0.014); s.quadraticCurveTo(0.14, 0.0, 0.13, 0.016);
    s.quadraticCurveTo(0.085, 0.036, 0.035, 0.018); s.lineTo(0.035, -0.02);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false, curveSegments: seg(8) });
    g.translate(0, 0, -0.0025);
    g.rotateX(Math.PI / 2);                // chord -> z, thickness -> y
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = 0.95 - (x - 0.035) / 0.105 * 0.55;
      p.setXYZ(i, x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a));
    }
    g.computeVertexNormals();
    return G(g);
  })();
  const vaneGeo = G(new THREE.BoxGeometry(0.1, 0.012, 0.014));
  function thruster(pos, dir, kind, side) {
    const t = new THREE.Group(); t.position.set(...pos);
    t.quaternion.setFromUnitVectors(Y, new THREE.Vector3(...dir).normalize());
    body.add(t);
    const duct = new THREE.Mesh(ductGeo, M.black); duct.castShadow = true; duct.receiveShadow = true; t.add(duct);
    const pod = new THREE.Mesh(podGeo, M.housing); pod.position.y = -0.03; pod.castShadow = true; t.add(pod);
    for (const a of [0, TAU / 3, 2 * TAU / 3]) {                                              // stator vanes
      const v = new THREE.Mesh(vaneGeo, M.black); v.position.set(Math.cos(a) * 0.105, -0.08, Math.sin(a) * 0.105); v.rotation.y = -a; t.add(v);
    }
    // guard bars across the outlet
    for (const a of [0, Math.PI / 2]) {
      const b = add(new THREE.CylinderGeometry(0.005, 0.005, 0.32, 6, 1), M.black, 0, -0.1, 0, t);
      b.rotation.set(Math.PI / 2, a, 0);
    }
    const spin = new THREE.Group(); spin.position.y = 0.04; t.add(spin);
    spin.userData.keep = true;
    const hub = new THREE.Mesh(hubGeo, M.prop); hub.castShadow = true; spin.add(hub);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(bladeGeo, M.prop); b.rotation.y = i * TAU / 4; b.castShadow = true; spin.add(b);
    }
    // the power cable from the pod to the frame
    pipe([[0, -0.2, 0], [0, -0.26, 0.0], [0.06, -0.3, 0.02]], 0.01, M.cable, (() => { const g = new THREE.Group(); g.position.copy(t.position); g.quaternion.copy(t.quaternion); D.add(g); return g; })(), 6, 8);
    props.push({ spin, kind, side, group: t, rpm: 0 });
    return t;
  }
  const s2 = Math.SQRT1_2;
  // horizontal: at the corners, axes 45 degrees to the hull; side and end
  // let the update mix surge, sway and yaw
  thruster([0.82, -0.3, 0.46], [s2, 0, -s2], 'h', [1, 1]);
  thruster([0.82, -0.3, -0.46], [s2, 0, s2], 'h', [1, -1]);
  thruster([-0.82, -0.3, 0.46], [s2, 0, s2], 'h', [-1, 1]);
  thruster([-0.82, -0.3, -0.46], [s2, 0, -s2], 'h', [-1, -1]);
  // vertical: through the foam holes
  thruster([0.42, yt + 0.3, 0], [0, 1, 0], 'v', [1, 0]);
  thruster([-0.42, yt + 0.3, 0], [0, 1, 0], 'v', [-1, 0]);

  // ── systems inside the frame ─────────────────────────────────────────────
  const housingGeo = (l) => {
    const r = 0.1, c = 0.118, e = 0.035, pts = [[0, -l / 2 - 0.012], [c - 0.01, -l / 2 - 0.012], [c, -l / 2 - 0.004], [c, -l / 2 + e - 0.004], [c - 0.006, -l / 2 + e], [r, -l / 2 + e + 0.004],
      [r, l / 2 - e - 0.004], [c - 0.006, l / 2 - e], [c, l / 2 - e + 0.004], [c, l / 2 + 0.004], [c - 0.01, l / 2 + 0.012], [0, l / 2 + 0.012]];
    return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(24));
  };
  for (const [x, z, l] of [[-0.1, 0.25, 0.9], [-0.1, -0.25, 0.9], [0.2, 0, 0.6]]) {
    const h = add(housingGeo(l), M.housing, x, -0.18, z); h.rotation.z = Math.PI / 2;
    // the bolt circles of the end caps, the connectors on the aft cap
    if (!low) for (const e of [-1, 1]) for (let i = 0; i < 6; i++) {
      const a = (i + 0.5) * TAU / 6;
      bolt([x + e * (l / 2 + 0.012), -0.18 + Math.cos(a) * 0.085, z + Math.sin(a) * 0.085], [e, 0, 0], D);
    }
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.4, cy = -0.18 + Math.cos(a) * 0.05, cz = z + Math.sin(a) * 0.05;
      const c = add(new THREE.CylinderGeometry(0.014, 0.016, 0.04, seg(10)), M.orange, x - l / 2 - 0.03, cy, cz); c.rotation.z = Math.PI / 2;
      pipe([[x - l / 2 - 0.05, cy, cz], [x - l / 2 - 0.12, cy - 0.05, cz], [-0.7, -0.36 + i * 0.03, cz * 0.6], [-0.78, -0.42, cz * 0.3]], 0.009, i === 1 ? M.orange : M.cable, D, 6, 14);
    }
  }
  // hydraulic unit: a rounded case, a grille of slats, two hoses
  rbox(0.42, 0.3, 0.5, 0.03, M.black, -0.72, -0.48, 0);
  const slat = G(new THREE.BoxGeometry(0.014, 0.018, 0.4));
  for (let i = 0; i < (low ? 4 : 7); i++) { const sl = new THREE.Mesh(slat, M.stripe); sl.position.set(-0.935, -0.57 + i * (low ? 0.05 : 0.03), 0); sl.rotation.z = 0.5; D.add(sl); }
  tube([-0.72, -0.3, -0.25], [-0.72, -0.3, 0.25], 0.03, M.orange, body, 12);
  pipe([[-0.6, -0.36, 0.2], [-0.4, -0.3, 0.3], [0.2, -0.45, 0.35], [0.85, -0.48, 0.42]], 0.012, M.black, D, 6, 20);
  pipe([[-0.6, -0.38, 0.16], [-0.38, -0.33, 0.27], [0.2, -0.48, 0.32], [0.85, -0.5, 0.38]], 0.012, M.black, D, 6, 20);
  // DVL: a lathed head with 4 transducer faces
  {
    const pts = [[0, -0.08], [0.085, -0.08], [0.1, -0.065], [0.11, 0.0], [0.09, 0.05], [0, 0.05]];
    add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(20)), M.housing, 0.15, yb - 0.02, 0);
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + TAU / 8; const f = add(new THREE.CylinderGeometry(0.03, 0.03, 0.012, seg(14)), M.black, 0.15 + Math.cos(a) * 0.055, yb - 0.1, Math.sin(a) * 0.055); f.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); }
  }
  // tether termination: a ribbed bend restrictor at the top rear
  const tetherPoint = new THREE.Object3D(); tetherPoint.position.set(-0.75, yt + 0.95, 0); body.add(tetherPoint);
  {
    const pts = [];
    const n = low ? 6 : 10;
    for (let i = 0; i <= n; i++) { const y = -0.18 + (i / n) * 0.36, r = 0.08 - (i / n) * 0.045; pts.push([r, y], [r + (i < n ? 0.01 : 0), y + 0.012]); }
    pts.unshift([0, -0.19]); pts.push([0, 0.2]);
    add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(16)), M.orange, -0.75, yt + 0.72, 0);
  }
  add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, seg(20)), M.steel, -0.75, yt + 0.53, 0);
  // lifting bail: a smooth steel arch over the foam
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; pts.push([0.15, yt + 0.62 + Math.sin(a) * 0.22, Math.cos(a) * 0.3]); }
    pipe(pts, 0.022, M.steel, body, 12, 28);
    for (const z of [-0.3, 0.3]) sbox(0.08, 0.04, 0.08, 0.01, M.steel, 0.15, yt + 0.6, z);
  }
  // flasher mast
  tube([-0.95, yt + 0.5, -0.45], [-0.95, yt + 0.85, -0.45], 0.012, M.steel, body, 8);
  // forward sonar: a head with a domed window
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.14, seg(20)), M.black, 0.78, yt + 0.6, 0);
  const sonar = new THREE.Object3D(); sonar.position.set(0.78, yt + 0.6, 0); body.add(sonar);
  add(new THREE.SphereGeometry(0.07, seg(20), seg(8), 0, TAU, 0, Math.PI / 2), M.glass, 0.78, yt + 0.67, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, seg(8)), M.steel, 0.78, yt + 0.48, 0);

  // ── camera pod, light bar, lights ────────────────────────────────────────
  const cameraPod = new THREE.Group(); cameraPod.position.set(1.08, -0.1, 0); body.add(cameraPod);
  cameraPod.userData.keep = true;
  rbox(0.14, 0.06, 0.2, 0.015, M.frame, -0.04, -0.13, 0, cameraPod);            // pan base
  const cameraTilt = new THREE.Group(); cameraPod.add(cameraTilt);
  {
    const pts = [[0, -0.13], [0.06, -0.13], [0.075, -0.115], [0.075, 0.09], [0.08, 0.095], [0.08, 0.12], [0.068, 0.125], [0.062, 0.12]];
    const hous = add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(24)), M.housing, 0, 0, 0, cameraTilt); hous.rotation.z = -Math.PI / 2;
    const lens = add(new THREE.SphereGeometry(0.062, seg(20), seg(8), 0, TAU, 0, Math.PI / 2), M.glass, 0.12, 0, 0, cameraTilt); lens.rotation.z = -Math.PI / 2; lens.scale.y = 0.45;
  }
  for (const z of [-0.09, 0.09]) sbox(0.05, 0.12, 0.012, 0.005, M.frame, 0, -0.05, z, cameraPod);   // yoke
  const camera = new THREE.PerspectiveCamera(o.fov ?? 55, 320 / 256, 0.12, 60);
  camera.position.set(0.14, 0, 0);
  camera.rotation.set(0, -Math.PI / 2, 0);  // a three camera looks down -z: turn it to +x
  cameraTilt.add(camera);
  // light bar across the front top; finned lamp heads with a bezel
  tube([1.1, yt - 0.02, -0.6], [1.1, yt - 0.02, 0.6], 0.03, M.frame);
  const lamps = [];
  const lampGeo = (() => {
    const pts = [[0, -0.07], [0.04, -0.07], [0.05, -0.06]];
    const fins = low ? 2 : 3;
    for (let i = 0; i < fins; i++) { const y = -0.055 + i * 0.022; pts.push([0.052, y], [0.064, y + 0.004], [0.064, y + 0.01], [0.052, y + 0.014]); }
    pts.push([0.056, 0.03], [0.07, 0.035], [0.07, 0.05], [0.058, 0.056], [0.05, 0.05]);
    return G(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(16)));
  })();
  const lampFace = G(new THREE.CircleGeometry(0.05, seg(20)));
  for (const z of [-0.56, -0.2, 0.2, 0.56]) {
    const g = new THREE.Group(); g.position.set(1.14, yt - 0.02, z); body.add(g);
    const c = new THREE.Mesh(lampGeo, M.black); c.rotation.z = -Math.PI / 2; c.castShadow = true; g.add(c);
    const f = new THREE.Mesh(lampFace, M.lamp); f.position.x = 0.051; f.rotation.y = Math.PI / 2; f.userData.keep = true; g.add(f);
    g.rotation.z = -0.18; g.rotation.y = z * -0.12;
    lamps.push(f);
  }
  const lights = [], lightTargets = [];
  const nL = o.lights ?? 2;
  for (let i = 0; i < nL; i++) {
    const z = nL === 1 ? 0 : (i === 0 ? 0.56 : -0.56);
    const L = new THREE.SpotLight(o.lightColour ?? 0xfff0dc, o.lightIntensity ?? 420, o.lightRange ?? 42, o.lightAngle ?? 0.44, 0.55, 2);
    L.position.set(1.2, yt - 0.02, z);
    const T = new THREE.Object3D(); T.position.set(8, -2.6, -z * 0.6); group.add(T);
    L.target = T;
    if (i === 0 && o.shadows !== false) {
      L.castShadow = true;
      L.shadow.mapSize.set(o.shadowSize ?? 1024, o.shadowSize ?? 1024);
      L.shadow.camera.near = 0.3; L.shadow.camera.far = 40;
      L.shadow.bias = -0.0004; L.shadow.normalBias = 0.03;
    }
    L.userData.base = L.intensity;
    group.add(L);
    lights.push(L); lightTargets.push(T);
  }

  // ── manipulator (starboard) and grabber (port) ───────────────────────────
  function manipulator() {
    const shoulder = new THREE.Group(); shoulder.position.set(0.9, -0.48, 0.42); body.add(shoulder);
    shoulder.userData.keep = true;
    rbox(0.14, 0.14, 0.14, 0.025, M.frame, 0, 0, 0, shoulder);
    const up = new THREE.Group(); shoulder.add(up);
    const ua = add(new THREE.CylinderGeometry(0.045, 0.05, 0.5, seg(16)), M.steel, 0.25, 0, 0, up); ua.rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.24, seg(10)), M.black, 0.16, 0.065, 0, up).rotation.z = Math.PI / 2;     // ram body
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.2, seg(8)), M.steel, 0.36, 0.065, 0, up).rotation.z = Math.PI / 2;     // ram rod
    const elbow = new THREE.Group(); elbow.position.x = 0.5; up.add(elbow);
    add(new THREE.SphereGeometry(0.065, seg(16), seg(12)), M.frame, 0, 0, 0, elbow);
    const fa = add(new THREE.CylinderGeometry(0.035, 0.042, 0.42, seg(16)), M.steel, 0.21, 0, 0, elbow); fa.rotation.z = Math.PI / 2;
    const wrist = new THREE.Group(); wrist.position.x = 0.42; elbow.add(wrist);
    const wr = add(new THREE.CylinderGeometry(0.045, 0.045, 0.1, seg(16)), M.frame, 0.03, 0, 0, wrist); wr.rotation.z = Math.PI / 2;
    const jawL = new THREE.Group(), jawR = new THREE.Group(); jawL.position.set(0.08, 0, -0.025); jawR.position.set(0.08, 0, 0.025);
    wrist.add(jawL, jawR);
    // curved jaws: an extruded claw outline
    const claw = new THREE.Shape();
    claw.moveTo(0, -0.015); claw.lineTo(0.08, -0.012); claw.quadraticCurveTo(0.13, -0.008, 0.135, 0.012); claw.lineTo(0.12, 0.014); claw.quadraticCurveTo(0.1, 0.004, 0.06, 0.012); claw.lineTo(0, 0.015);
    const cg = new THREE.ExtrudeGeometry(claw, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: seg(6) });
    cg.translate(0, 0, -0.009); cg.rotateX(Math.PI / 2);
    smoothNormals(cg, 50);
    add(cg, M.steel, 0, 0, 0, jawL).rotation.y = 0.0;
    const cr = add(cg.clone(), M.steel, 0, 0, 0, jawR); cr.scale.z = -1;
    // stowed pose: folded back under the front
    up.rotation.z = -0.22; up.rotation.y = 0.2; elbow.rotation.z = 2.55; wrist.rotation.z = -0.9;
    return { shoulder, up, elbow, wrist, jawL, jawR };
  }
  const arm = manipulator();
  {
    const g = new THREE.Group(); g.position.set(0.95, -0.52, -0.42); body.add(g);
    rbox(0.1, 0.1, 0.1, 0.02, M.frame, 0, 0, 0, g);
    const a = add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, seg(12)), M.steel, 0.15, -0.02, 0, g); a.rotation.z = Math.PI / 2 + 0.2;
    sbox(0.08, 0.02, 0.07, 0.006, M.steel, 0.32, -0.06, 0, g);
  }
  // the lamp cables along the light bar
  for (const z of [-0.56, -0.2, 0.2, 0.56]) pipe([[1.1, yt - 0.06, z], [1.0, yt - 0.1, z * 0.9], [0.5, -0.1, z * 0.5], [0.3, -0.16, z * 0.2]], 0.008, M.cable, D, 6, 12);

  // ── status LEDs ──────────────────────────────────────────────────────────
  const leds = [];
  const ledGeo = G(new THREE.SphereGeometry(0.018, seg(12), seg(8)));
  const led = (c, x, y, z, rate, phase) => { const m = new THREE.Mesh(ledGeo, ledMat(c)); m.position.set(x, y, z); m.userData.keep = true; body.add(m); leds.push({ mesh: m, colour: c, rate, phase }); };
  led(0x30ff60, -1.0, yt + 0.32, 0.5, 1.0, 0);            // power, slow pulse
  led(0xffb020, -1.0, yt + 0.32, 0.4, 3.1, 0.3);          // telemetry, fast blink
  led(0xff3020, -1.0, yt + 0.32, -0.5, 0.5, 0.6);         // fault (dim) / strobe
  led(0x40a0ff, -0.95, yt + 0.88, -0.45, 0.8, 0.1);       // the flasher on the mast
  led(0x30ff60, 1.02, -0.02, 0.12, 2.0, 0.5);             // camera ready

  // ── wear (vertex colours) ────────────────────────────────────────────────
  // foam: grime low on the vehicle and darker scuffs; edge (frame, black
  // parts): the anodise or paint is dark, and scuffs show the bare metal
  // (the colour of the material) on the ends, the low parts and in noise
  // patches; tint: a slight brown-green cast.
  function wear() {
    group.updateMatrixWorld(true);
    const v = new THREE.Vector3(), done = new Set();
    const kw = o.wear ?? 0.22;
    group.traverse((m) => {
      if (!m.isMesh || !m.material.userData.wear) return;
      if (done.has(m.geometry)) { m.geometry = G(m.geometry.clone()); }
      done.add(m.geometry);
      const kind = m.material.userData.wear;
      const pos = m.geometry.attributes.position, n = pos.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const big = vnoise(v.x * 2.1, v.y * 2.1, v.z * 2.1, seed), fine = vnoise(v.x * 9, v.y * 9, v.z * 9, seed + 3);
        const low = Math.min(1, Math.max(0, (-v.y - 0.1) * 0.9));          // grime low on the vehicle
        let r, g, b;
        if (kind === 'edge') {
          // the ends of the vehicle and the skids get knocks; noise patches
          const ends = Math.min(1, Math.max(0, (Math.abs(v.x) - 0.85) * 5)) + Math.min(1, Math.max(0, (-v.y - 0.62) * 8));
          const scuff = Math.min(1, Math.max(0, (fine - 0.66) * 5) * (0.4 + 0.8 * big) + ends * Math.max(0, fine - 0.5) * 1.4);
          const base = m.material === M.frame ? 0.15 : 0.85;              // anodise: dark on the light aluminium
          const k = base + (1 - base) * scuff * (m.material === M.frame ? 0.6 : 0.35);
          r = k * (1 - 0.05 * low); g = k * (1 - 0.03 * low); b = k * (1 - 0.08 * low);
        } else if (kind === 'foam') {
          const pits = Math.max(0, fine - 0.7) * 2.2;
          const k = 1 - kw * (0.45 * big + 0.4 * low + pits);
          r = k * (1 - 0.05 * big); g = k * (1 - 0.04 * low - 0.03 * big); b = k * (1 - 0.14 * low - 0.06 * big);
        } else {
          const k = 1 - kw * (0.5 * big + 0.35 * low + 0.3 * Math.max(0, fine - 0.6) * 2.5);
          r = k * (1 - 0.04 * big); g = k * (1 - 0.02 * low); b = k * (1 - 0.1 * low - 0.05 * big);
        }
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
      m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    });
  }
  wear();

  // unit normals everywhere: three LatheGeometry leaves a short normal at
  // a profile point on the axis (the tip of a spinner or a cap); there the
  // normal is the axis direction, away from the middle of the part
  {
    const done = new Set();
    group.traverse((m) => {
      if (!m.isMesh || done.has(m.geometry)) return;
      done.add(m.geometry);
      const g = m.geometry, a = g.attributes.normal, p = g.attributes.position;
      if (!g.boundingBox) g.computeBoundingBox();
      const cy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;
      for (let i = 0; i < a.count; i++) {
        const x = a.getX(i), y = a.getY(i), z = a.getZ(i), l = Math.hypot(x, y, z);
        if (l < 0.5) a.setXYZ(i, 0, p.getY(i) >= cy ? 1 : -1, 0);
        else if (Math.abs(l - 1) > 1e-4) a.setXYZ(i, x / l, y / l, z / l);
      }
    });
  }

  // ── merge the static meshes per material ─────────────────────────────────
  function inside(m, a) { for (let p = m; p; p = p.parent) if (p === a) return true; return false; }
  function kept(m, root) { for (let p = m; p && p !== root; p = p.parent) if (p.userData.keep) return true; return false; }
  function bake(root, shadow) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), rel = new THREE.Matrix4(), nm = new THREE.Matrix3();
    const buckets = new Map(), dead = [];
    root.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || kept(m, root)) return;
      if (root === body && inside(m, detail)) return;          // baked on its own (bake(D))
      if (!buckets.has(m.material)) buckets.set(m.material, []);
      buckets.get(m.material).push(m);
      dead.push(m);
    });
    for (const [mat, list] of buckets) {
      let nv = 0, ni = 0;
      for (const m of list) { const g = m.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), C = new Float32Array(nv * 3).fill(1);
      const I = new Uint32Array(ni);
      let vo = 0, io = 0;
      const v = new THREE.Vector3();
      for (const m of list) {
        const g = m.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ca = g.attributes.color;
        rel.multiplyMatrices(inv, m.matrixWorld); nm.getNormalMatrix(rel);
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(rel); P[(vo + i) * 3] = v.x; P[(vo + i) * 3 + 1] = v.y; P[(vo + i) * 3 + 2] = v.z;
          if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N[(vo + i) * 3] = v.x; N[(vo + i) * 3 + 1] = v.y; N[(vo + i) * 3 + 2] = v.z; }
          if (ua) { UV[(vo + i) * 2] = ua.getX(i); UV[(vo + i) * 2 + 1] = ua.getY(i); }
          if (ca) { C[(vo + i) * 3] = ca.getX(i); C[(vo + i) * 3 + 1] = ca.getY(i); C[(vo + i) * 3 + 2] = ca.getZ(i); }
        }
        // a mirrored transform (scale -1) turns the triangles over
        const flip = rel.determinant() < 0;
        if (g.index) for (let i = 0; i < g.index.count; i += 3) { const a = g.index.getX(i), b = g.index.getX(i + 1), c = g.index.getX(i + 2); I[io++] = vo + a; I[io++] = vo + (flip ? c : b); I[io++] = vo + (flip ? b : c); }
        else for (let i = 0; i < pa.count; i += 3) { I[io++] = vo + i; I[io++] = vo + (flip ? i + 2 : i + 1); I[io++] = vo + (flip ? i + 1 : i + 2); }
        vo += pa.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
      if (mat.vertexColors) geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.setIndex(new THREE.BufferAttribute(I, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(G(geo), mat);
      mesh.name = 'rov-' + (mat.userData.rov || 'part');
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.userData.merged = list.length;
      root.add(mesh);
    }
    const used = new Set();
    for (const m of dead) { m.parent.remove(m); used.add(m.geometry); }
    // the merged parts' own geometries are no longer drawn: free them
    for (const g of used) { const i = own.indexOf(g); if (i >= 0) own.splice(i, 1); g.dispose(); }
  }
  bake(D, false);
  bake(body, true);

  const s = o.scale ?? 1;
  group.scale.setScalar(s);
  return {
    group, body, detail, props, leds, lights, lightTargets, lamps, camera, cameraPod, cameraTilt, arm, tetherPoint, sonar,
    materials: M, textures, detailFar,
    dispose() {
      for (const g of own) g.dispose();
      for (const k in M) M[k].dispose();
      for (const k in textures) textures[k].dispose();
      for (const l of leds) l.mesh.material.dispose();
      for (const L of lights) if (L.shadow && L.shadow.map) L.shadow.map.dispose();
    },
  };
}

// Smooth normals on a non-indexed geometry (three ExtrudeGeometry): each
// corner gets the area-weighted mean of the face normals at its position
// that are within maxDeg of its own face. Hard edges past maxDeg stay.
function smoothNormals(g, maxDeg = 50) {
  const p = g.attributes.position, n = p.count, cosT = Math.cos(maxDeg * Math.PI / 180);
  const key = new Array(n), map = new Map();
  const F = new Float32Array(n);
  for (let t = 0; t < n; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const ux = p.getX(t + 1) - ax, uy = p.getY(t + 1) - ay, uz = p.getZ(t + 1) - az;
    const vx = p.getX(t + 2) - ax, vy = p.getY(t + 2) - ay, vz = p.getZ(t + 2) - az;
    F[t] = uy * vz - uz * vy; F[t + 1] = uz * vx - ux * vz; F[t + 2] = ux * vy - uy * vx;    // area x 2, not unit
  }
  for (let i = 0; i < n; i++) {
    const k = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4) + ',' + Math.round(p.getZ(i) * 1e4);
    key[i] = k;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i - (i % 3), fx = F[t], fy = F[t + 1], fz = F[t + 2], fl = Math.hypot(fx, fy, fz) || 1;
    let sx = 0, sy = 0, sz = 0;
    for (const j of map.get(key[i])) {
      const u = j - (j % 3), gx = F[u], gy = F[u + 1], gz = F[u + 2], gl = Math.hypot(gx, gy, gz) || 1;
      if ((fx * gx + fy * gy + fz * gz) / (fl * gl) >= cosT) { sx += gx; sy += gy; sz += gz; }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
  }
  g.setAttribute('normal', new p.constructor(out, 3));   // the class of the position attribute (Float32BufferAttribute)
  return g;
}

// ── textures (DataTexture, no DOM) ──────────────────────────────────────────
// foam: a grey grain (the micro-spheres of syntactic foam) with pits and
// pale scuffs, as a map (times the foam colour) and a bump map; plate:
// "ROV-0n" in black on white with a red rule; hazard: yellow and black
// stripes at 45 degrees.
function makeTextures(THREE, seed, id) {
  const tex = (data, w, h, srgb) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const N = 128, foam = new Uint8Array(N * N * 4), bump = new Uint8Array(N * N * 4);
  // tileable noise: periodic value noise on a 16-cell and a 64-cell lattice
  const per = (x, y, p, sd) => {
    const h = (i, j) => { let n = (((i % p) + p) % p) * 374761393 + (((j % p) + p) % p) * 668265263 + sd * 1442695041; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const grain = per(x / 2, y / 2, 64, seed), mid = per(x / 8, y / 8, 16, seed + 1), big = per(x / 32, y / 32, 4, seed + 2);
    const pit = grain > 0.86 ? (grain - 0.86) * 4 : 0;
    const scuff = Math.max(0, (mid - 0.7) * 2.5) * (big > 0.5 ? 1 : 0.3);
    const k = 0.88 + 0.1 * grain - 0.35 * pit + 0.1 * scuff;
    const c = Math.max(0, Math.min(255, Math.round(k * 255)));
    foam[i] = c; foam[i + 1] = c; foam[i + 2] = Math.max(0, c - 6); foam[i + 3] = 255;
    const b = Math.max(0, Math.min(255, Math.round((0.5 + 0.25 * grain - 0.6 * pit - 0.2 * scuff) * 255)));
    bump[i] = bump[i + 1] = bump[i + 2] = b; bump[i + 3] = 255;
  }
  const foamT = tex(foam, N, N, true), bumpT = tex(bump, N, N, false);
  foamT.repeat.set(1.6, 1.6); bumpT.repeat.set(1.6, 1.6);
  // the plate: 64 x 32, 3 x 5 glyphs at 2 px a pixel
  const PW = 64, PH = 32, plate = new Uint8Array(PW * PH * 4).fill(255);
  const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= PW || y >= PH) return; const i = ((PH - 1 - y) * PW + x) * 4; plate[i] = r; plate[i + 1] = g; plate[i + 2] = b; };
  const text = 'ROV-' + String(id).padStart(2, '0');
  let cx = 4;
  for (const ch of text) {
    const gl = GLYPH[ch] || GLYPH[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (gl[r] & (4 >> c)) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(cx + c * 2 + dx, 8 + r * 2 + dy, 18, 18, 20);
    cx += 8;
  }
  for (let x = 3; x < PW - 3; x++) for (let y = 22; y < 24; y++) put(x, y, 200, 40, 30);
  for (let x = 0; x < PW; x++) { put(x, 0, 30, 30, 30); put(x, PH - 1, 30, 30, 30); }
  for (let y = 0; y < PH; y++) { put(0, y, 30, 30, 30); put(PW - 1, y, 30, 30, 30); }
  const plateT = tex(plate, PW, PH, true);
  plateT.wrapS = plateT.wrapT = THREE.ClampToEdgeWrapping;
  // hazard stripes
  const HW = 64, HH = 16, hz = new Uint8Array(HW * HH * 4);
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
    const i = (y * HW + x) * 4, on = Math.floor((x + y) / 8) % 2 === 0;
    hz[i] = on ? 240 : 20; hz[i + 1] = on ? 190 : 20; hz[i + 2] = on ? 10 : 22; hz[i + 3] = 255;
  }
  const hazT = tex(hz, HW, HH, true);
  hazT.repeat.set(4, 1);
  return { foam: foamT, foamBump: bumpT, plate: plateT, hazard: hazT };
}

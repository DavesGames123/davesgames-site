// ============================================================================
//  CORAL REEF  ·  ROV  ·  the vehicle model (three r160, no DOM)
// ----------------------------------------------------------------------------
//  buildVehicle(THREE, o) makes one original work-class ROV from three.js
//  primitives. Vehicle frame: x forward, y up, z to starboard, metres. The
//  default size is 2.2 x 1.4 x 1.5 m (scale with o.scale).
//
//  PARTS
//    frame ........ an open frame of anodised tubes, posts and braces,
//                   two skids with turned-up noses, a tool basket below
//    buoyancy ..... a yellow foam block on top (an extruded rounded slab
//                   with bevels and two holes for the vertical thrusters),
//                   a dark stripe and the vehicle number plate
//    thrusters .... 4 vectored horizontal thrusters at 45 degrees and 2
//                   vertical thrusters: a lathed duct, a motor pod, a hub
//                   and 4 pitched blades in a group that spins
//    front ........ a pan-tilt camera pod with a glass lens (the feed
//                   camera sits at the lens), a light bar with 4 lamps
//                   and 1 or 2 SpotLights, a forward sonar head
//    manipulator .. a 5-joint arm (shoulder, upper arm, elbow, forearm,
//                   wrist, jaws) on the starboard side, a small grabber
//                   to port
//    systems ...... pressure housings, a hydraulic unit, a DVL, the
//                   tether termination with a bend restrictor, a flasher
//                   mast and small status LEDs
//  Every surface is MeshStandardMaterial (PBR). wear() writes vertex
//  colours from 3D value noise and height, so the foam and the frame show
//  grime low down and scuffs: a slight wear tint, different per seed.
//
//  RETURNS { group, props: [{ spin, axis, kind, side }], leds: [{ mesh,
//  colour, phase, rate }], lights, lightTargets, lamps, camera, cameraPod,
//  cameraTilt, arm: { shoulder, elbow, wrist, jawL, jawR }, tetherPoint,
//  sonar, materials, dispose() }
//
//  grep -n targets
//    "function wear"            the vertex-colour wear tint
//    "function thruster"        duct, pod and spinning prop
//    "function buoyancy"        the foam block
//    "function manipulator"     the arm
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

export function buildVehicle(THREE, o = {}) {
  const seed = o.seed ?? 1, q = o.quality === 'low' ? 0.6 : 1;
  const seg = (n) => Math.max(6, Math.round(n * q));
  const group = new THREE.Group();
  group.name = 'rov-' + (o.id ?? 0);
  const body = new THREE.Group();          // everything but the lights
  group.add(body);
  const own = [];                          // geometries to dispose
  const G = (g) => { own.push(g); return g; };

  // ── materials ────────────────────────────────────────────────────────────
  const M = {
    foam: new THREE.MeshStandardMaterial({ color: o.foam ?? 0xf2b705, roughness: 0.62, metalness: 0, vertexColors: true }),
    frame: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.42, metalness: 0.65, vertexColors: true }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.9, vertexColors: true }),
    black: new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.55, metalness: 0.1, vertexColors: true }),
    orange: new THREE.MeshStandardMaterial({ color: 0xe0561b, roughness: 0.5, metalness: 0.05, vertexColors: true }),
    housing: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.8, vertexColors: true }),
    prop: new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.05, metalness: 0.2 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 3, roughness: 0.2 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0, vertexColors: true }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.5, metalness: 0 }),
  };
  for (const k in M) M[k].userData.wear = M[k].vertexColors;
  const ledMat = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.5, roughness: 0.3 });

  const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(G(geo), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  // a tube between two points
  const Y = new THREE.Vector3(0, 1, 0);
  function tube(a, b, r, mat, parent = body) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    const m = add(new THREE.CylinderGeometry(r, r, L, seg(10), 1), mat, 0, 0, 0, parent);
    m.position.copy(A).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(Y, d.normalize());
    return m;
  }

  // ── frame ────────────────────────────────────────────────────────────────
  const fx = 1.02, fz = 0.62, yb = -0.68, yt = 0.22, tr = 0.032;
  for (const z of [-fz, fz]) {
    tube([-fx, yb, z], [fx, yb, z], tr, M.frame);          // bottom rails
    tube([-fx, yt, z], [fx, yt, z], tr, M.frame);          // top rails
    for (const x of [-fx, -0.35, 0.35, fx]) tube([x, yb, z], [x, yt, z], tr, M.frame);   // posts
    tube([-fx, yb, z], [-0.35, yt, z], tr * 0.8, M.frame);  // braces
    tube([0.35, yt, z], [fx, yb, z], tr * 0.8, M.frame);
  }
  for (const x of [-fx, fx]) { tube([x, yb, -fz], [x, yb, fz], tr, M.frame); tube([x, yt, -fz], [x, yt, fz], tr, M.frame); }
  tube([-0.35, yb, -fz], [-0.35, yb, fz], tr, M.frame); tube([0.35, yb, -fz], [0.35, yb, fz], tr, M.frame);
  // skids: a box runner with a turned-up nose
  for (const z of [-0.5, 0.5]) {
    add(new THREE.BoxGeometry(1.9, 0.07, 0.09), M.black, -0.05, yb - 0.08, z);
    const nose = add(new THREE.BoxGeometry(0.32, 0.07, 0.09), M.black, 1.0, yb - 0.02, z);
    nose.rotation.z = 0.45;
    tube([-0.6, yb - 0.05, z], [-0.6, yb, z], 0.025, M.frame); tube([0.5, yb - 0.05, z], [0.5, yb, z], 0.025, M.frame);
  }
  // tool basket under the front
  const bk = new THREE.Group(); bk.position.set(0.55, yb - 0.02, 0); body.add(bk);
  for (const z of [-0.32, 0.32]) tube([-0.3, 0, z], [0.3, 0, z], 0.014, M.steel, bk);
  for (const x of [-0.3, -0.1, 0.1, 0.3]) tube([x, 0, -0.32], [x, 0, 0.32], 0.012, M.steel, bk);
  for (const x of [-0.3, 0.3]) for (const z of [-0.32, 0.32]) tube([x, 0, z], [x, 0.16, z], 0.012, M.steel, bk);

  // ── buoyancy block ───────────────────────────────────────────────────────
  function buoyancy() {
    const w = 2.06, d = 1.32, r = 0.16, hx = w / 2 - r, hz = d / 2 - r;
    const s = new THREE.Shape();
    s.moveTo(-hx, -d / 2); s.lineTo(hx, -d / 2); s.absarc(hx, -hz, r, -Math.PI / 2, 0); s.lineTo(w / 2, hz);
    s.absarc(hx, hz, r, 0, Math.PI / 2); s.lineTo(-hx, d / 2); s.absarc(-hx, hz, r, Math.PI / 2, Math.PI);
    s.lineTo(-w / 2, -hz); s.absarc(-hx, -hz, r, Math.PI, Math.PI * 1.5);
    for (const x of [-0.42, 0.42]) { const h = new THREE.Path(); h.absarc(x, 0, 0.2, 0, TAU, true); s.holes.push(h); }
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: Math.round(3 * q) + 1, curveSegments: seg(14) });
    geo.rotateX(-Math.PI / 2);             // the shape plane (x, y) -> (x, -z); extrude along +y
    const m = add(geo, M.foam, 0, yt + 0.06, 0);
    // dark stripe round the block and the number plates
    add(new THREE.BoxGeometry(w + 0.12, 0.06, d + 0.12), M.stripe, 0, yt + 0.3, 0);
    for (const z of [-1, 1]) {
      const p = add(new THREE.PlaneGeometry(0.34, 0.16), M.plate, -0.3, yt + 0.2, z * (d / 2 + 0.103));
      if (z < 0) p.rotation.y = Math.PI;
      for (let i = 0; i < 2; i++) {        // the number, as dark bars (no text)
        const b = add(new THREE.PlaneGeometry(0.035, 0.11), M.stripe, -0.38 + i * 0.07 + (o.id ?? 0) * 0.01, yt + 0.2, z * (d / 2 + 0.105));
        if (z < 0) b.rotation.y = Math.PI;
      }
    }
    return m;
  }
  buoyancy();

  // ── thrusters ────────────────────────────────────────────────────────────
  const props = [];
  // a duct: a lathed ring with a flared lip; its axis is local y
  const ductGeo = (() => {
    const p = [];
    const R = 0.15, L = 0.2;
    p.push(new THREE.Vector2(R + 0.012, -L / 2), new THREE.Vector2(R + 0.03, -L / 2 + 0.02), new THREE.Vector2(R + 0.026, L / 2 - 0.03),
      new THREE.Vector2(R + 0.012, L / 2), new THREE.Vector2(R, L / 2 - 0.01), new THREE.Vector2(R, -L / 2 + 0.01), new THREE.Vector2(R + 0.012, -L / 2));
    return G(new THREE.LatheGeometry(p, seg(20)));
  })();
  const bladeGeo = (() => { const g = new THREE.BoxGeometry(0.11, 0.008, 0.05); g.translate(0.075, 0, 0); return G(g); })();
  function thruster(pos, dir, kind, side) {
    const t = new THREE.Group(); t.position.set(...pos);
    t.quaternion.setFromUnitVectors(Y, new THREE.Vector3(...dir).normalize());
    body.add(t);
    const duct = new THREE.Mesh(ductGeo, M.black); duct.castShadow = true; t.add(duct);
    add(new THREE.CylinderGeometry(0.055, 0.06, 0.2, seg(12)), M.housing, 0, -0.07, 0, t);      // motor pod
    for (const a of [0, TAU / 3, 2 * TAU / 3]) {                                              // stator vanes
      const v = add(new THREE.BoxGeometry(0.1, 0.01, 0.012), M.black, Math.cos(a) * 0.1, -0.07, Math.sin(a) * 0.1, t);
      v.rotation.y = -a;
    }
    const spin = new THREE.Group(); spin.position.y = 0.04; t.add(spin);
    add(new THREE.SphereGeometry(0.045, seg(10), 6), M.prop, 0, 0, 0, spin);                // hub
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(bladeGeo, M.prop); b.rotation.order = 'YXZ';
      b.rotation.y = i * TAU / 4; b.rotation.x = 0.55; spin.add(b);
    }
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
  for (const [x, z, l] of [[-0.1, 0.25, 0.9], [-0.1, -0.25, 0.9], [0.2, 0, 0.6]]) {
    const h = add(new THREE.CylinderGeometry(0.1, 0.1, l, seg(14)), M.housing, x, -0.18, z); h.rotation.z = Math.PI / 2;
    for (const e of [-1, 1]) { const c = add(new THREE.CylinderGeometry(0.115, 0.115, 0.04, seg(14)), M.steel, x + e * l / 2, -0.18, z); c.rotation.z = Math.PI / 2; }
  }
  add(new THREE.BoxGeometry(0.42, 0.3, 0.5), M.black, -0.72, -0.48, 0);            // hydraulic unit
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), M.orange, -0.72, -0.3, 0).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.09, 0.11, 0.12, seg(12)), M.housing, 0.15, yb - 0.02, 0);   // DVL
  // tether termination: a bend restrictor cone at the top rear
  const tetherPoint = new THREE.Object3D(); tetherPoint.position.set(-0.75, yt + 0.95, 0); body.add(tetherPoint);
  add(new THREE.CylinderGeometry(0.035, 0.08, 0.36, seg(10)), M.orange, -0.75, yt + 0.72, 0);
  add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, seg(12)), M.steel, -0.75, yt + 0.53, 0);
  // flasher mast
  tube([-0.95, yt + 0.5, -0.45], [-0.95, yt + 0.85, -0.45], 0.012, M.steel);
  // forward sonar
  const sonar = add(new THREE.CylinderGeometry(0.07, 0.07, 0.14, seg(12)), M.black, 0.78, yt + 0.6, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), M.steel, 0.78, yt + 0.48, 0);

  // ── camera pod, light bar, lights ────────────────────────────────────────
  const cameraPod = new THREE.Group(); cameraPod.position.set(1.08, -0.1, 0); body.add(cameraPod);
  add(new THREE.BoxGeometry(0.14, 0.06, 0.2), M.frame, -0.04, -0.13, 0, cameraPod);            // pan base
  const cameraTilt = new THREE.Group(); cameraPod.add(cameraTilt);
  const hous = add(new THREE.CylinderGeometry(0.075, 0.075, 0.24, seg(16)), M.housing, 0, 0, 0, cameraTilt); hous.rotation.z = Math.PI / 2;
  const lens = add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, seg(16)), M.glass, 0.125, 0, 0, cameraTilt); lens.rotation.z = Math.PI / 2;
  for (const z of [-0.09, 0.09]) add(new THREE.BoxGeometry(0.05, 0.12, 0.012), M.frame, 0, -0.05, z, cameraPod);   // yoke
  const camera = new THREE.PerspectiveCamera(o.fov ?? 55, 320 / 256, 0.12, 60);
  camera.position.set(0.14, 0, 0);
  camera.rotation.set(0, -Math.PI / 2, 0);  // a three camera looks down -z: turn it to +x
  cameraTilt.add(camera);
  // light bar across the front top
  tube([1.1, yt - 0.02, -0.6], [1.1, yt - 0.02, 0.6], 0.03, M.frame);
  const lamps = [];
  for (const z of [-0.56, -0.2, 0.2, 0.56]) {
    const g = new THREE.Group(); g.position.set(1.14, yt - 0.02, z); body.add(g);
    const c = add(new THREE.CylinderGeometry(0.055, 0.065, 0.1, seg(12)), M.black, 0, 0, 0, g); c.rotation.z = Math.PI / 2;
    const f = add(new THREE.CircleGeometry(0.048, seg(12)), M.lamp, 0.051, 0, 0, g); f.rotation.y = Math.PI / 2; f.castShadow = false;
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
    add(new THREE.BoxGeometry(0.14, 0.14, 0.14), M.frame, 0, 0, 0, shoulder);
    const up = new THREE.Group(); shoulder.add(up);
    const ua = add(new THREE.CylinderGeometry(0.045, 0.05, 0.5, seg(10)), M.steel, 0.25, 0, 0, up); ua.rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), M.black, 0.22, 0.06, 0, up).rotation.z = Math.PI / 2;     // hydraulic ram
    const elbow = new THREE.Group(); elbow.position.x = 0.5; up.add(elbow);
    add(new THREE.SphereGeometry(0.065, seg(10), 8), M.frame, 0, 0, 0, elbow);
    const fa = add(new THREE.CylinderGeometry(0.035, 0.042, 0.42, seg(10)), M.steel, 0.21, 0, 0, elbow); fa.rotation.z = Math.PI / 2;
    const wrist = new THREE.Group(); wrist.position.x = 0.42; elbow.add(wrist);
    const wr = add(new THREE.CylinderGeometry(0.045, 0.045, 0.1, seg(10)), M.frame, 0.03, 0, 0, wrist); wr.rotation.z = Math.PI / 2;
    const jawL = new THREE.Group(), jawR = new THREE.Group(); jawL.position.set(0.08, 0, -0.025); jawR.position.set(0.08, 0, 0.025);
    wrist.add(jawL, jawR);
    add(new THREE.BoxGeometry(0.12, 0.03, 0.018), M.steel, 0.06, 0, 0, jawL);
    add(new THREE.BoxGeometry(0.12, 0.03, 0.018), M.steel, 0.06, 0, 0, jawR);
    // stowed pose: folded back under the front
    up.rotation.z = -0.5; up.rotation.y = 0.35; elbow.rotation.z = 1.9; wrist.rotation.z = 0.4;
    return { shoulder, up, elbow, wrist, jawL, jawR };
  }
  const arm = manipulator();
  {
    const g = new THREE.Group(); g.position.set(0.95, -0.52, -0.42); body.add(g);
    add(new THREE.BoxGeometry(0.1, 0.1, 0.1), M.frame, 0, 0, 0, g);
    const a = add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), M.steel, 0.15, -0.02, 0, g); a.rotation.z = Math.PI / 2 + 0.2;
    add(new THREE.BoxGeometry(0.08, 0.02, 0.07), M.steel, 0.32, -0.06, 0, g);
  }

  // ── status LEDs ──────────────────────────────────────────────────────────
  const leds = [];
  const led = (c, x, y, z, rate, phase) => { const m = new THREE.Mesh(G(new THREE.SphereGeometry(0.018, 8, 6)), ledMat(c)); m.position.set(x, y, z); body.add(m); leds.push({ mesh: m, colour: c, rate, phase }); };
  led(0x30ff60, -1.0, yt + 0.32, 0.5, 1.0, 0);            // power, slow pulse
  led(0xffb020, -1.0, yt + 0.32, 0.4, 3.1, 0.3);          // telemetry, fast blink
  led(0xff3020, -1.0, yt + 0.32, -0.5, 0.5, 0.6);         // fault (dim) / strobe
  led(0x40a0ff, -0.95, yt + 0.88, -0.45, 0.8, 0.1);       // the flasher on the mast
  led(0x30ff60, 1.02, -0.02, 0.12, 2.0, 0.5);             // camera ready

  // ── wear tint (vertex colours) ───────────────────────────────────────────
  function wear() {
    group.updateMatrixWorld(true);
    const v = new THREE.Vector3(), done = new Set();
    group.traverse((m) => {
      if (!m.isMesh || !m.material.userData.wear) return;
      if (done.has(m.geometry)) { m.geometry = G(m.geometry.clone()); }
      done.add(m.geometry);
      const pos = m.geometry.attributes.position, n = pos.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const big = vnoise(v.x * 2.1, v.y * 2.1, v.z * 2.1, seed), fine = vnoise(v.x * 9, v.y * 9, v.z * 9, seed + 3);
        const low = Math.min(1, Math.max(0, (-v.y - 0.1) * 0.9));          // grime low on the vehicle
        let k = 1 - (o.wear ?? 0.22) * (0.5 * big + 0.35 * low + 0.3 * Math.max(0, fine - 0.6) * 2.5);
        const r = k * (1 - 0.04 * big), g = k * (1 - 0.02 * low), b = k * (1 - 0.1 * low - 0.05 * big);   // a brown-green cast
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
      m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    });
  }
  wear();

  const s = o.scale ?? 1;
  group.scale.setScalar(s);
  return {
    group, body, props, leds, lights, lightTargets, lamps, camera, cameraPod, cameraTilt, arm, tetherPoint, sonar,
    materials: M,
    dispose() {
      for (const g of own) g.dispose();
      for (const k in M) M[k].dispose();
      for (const l of leds) l.mesh.material.dispose();
      for (const L of lights) if (L.shadow && L.shadow.map) L.shadow.map.dispose();
    },
  };
}

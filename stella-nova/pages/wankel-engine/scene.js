// ============================================================================
//  WANKEL ENGINE  ·  scene.js — the parts of one engine in three.js
// ────────────────────────────────────────────────────────────────────────────
//  build(B, V) makes every part of the layout V (engine.js VARIANTS) with
//  the builder B (kit.js) and returns the scene handle sc:
//    sc.pose(t) ........ shaft angle t: turns the shaft and the flywheel,
//                        moves each rotor on its lobe, reshapes the gas in
//                        the chambers, and fires the plugs
//    sc.box ............ { c, R } for the camera fit
//    sc.cover .......... ids of the parts the "Front housing" toggle hides
//
//  FRAMES. z is the shaft axis, +z the front. Each rotor lives in a unit
//  group at z = zc. A rear rotor of a twin is mirrored (scale.z = -1), so
//  its stationary gear and its side housing face the rear, and every
//  explode offset under it points to the rear too.
//
//  EXPLODE ORDER (windows of the explode value, see kit.js)
//    bolts out to the front ......... 0.00 - 0.32
//    plugs and port pipes out ....... 0.00 - 0.30  (along the housing normal)
//    flywheel off the back .......... 0.00 - 0.36
//    side housings off .............. 0.04 - 0.42
//    stationary gear out ............ 0.16 - 0.56  (only after its housing)
//    rotor out of the housing ....... 0.30 - 0.72  (only after its gear)
//    rotor housings apart (twin) .... 0.50 - 0.80
//    eccentric shaft forward ........ 0.55 - 0.95
//    seals and ring gear off rotor .. 0.75 - 1.00
//  Each part moves only along a path that the parts before it have
//  cleared, so no two parts pass through each other. The distances are in
//  const X: the twin, which is longer, spreads further in the same order.
//
//  GREP MAP
//    function notched ......... a closed outline with rectangular notches
//    function buildHousing .... rotor housing, running face, plugs, ports
//    function buildRotor ...... rotor, bearing, ring gear, seals
//    function buildPlate ...... a side housing, with or without its gear
//    function buildShaft ...... eccentric shaft and flywheel
//    function makeGas ......... the three chamber volumes of one rotor
//    sc.pose .................. the pose of every moving part
// ============================================================================
import * as THREE from 'three';
import * as E from './engine.js';
import { extrudeZ, circle, lathe, tube, rod, merge } from './kit.js';

const { GEO, TAU, D } = E;
const OUT = GEO.housingOff;                      // housing wall thickness
const BOLTS = [0, 30, 56, 124, 150, 180, 210, 225, 315, 330].map(d => d * D);
const PLUGS = [{ a: 102 * D, id: 'lead' }, { a: 78 * D, id: 'trail' }];   // the rotor runs from +x over the top: 102° is ahead
const PORTS = [{ a: 246 * D, id: 'exhaust' }, { a: 294 * D, id: 'intake' }];
const PLUG_W = 7.4, PORT_W = 14, MID = 15;       // notch half widths, half height of the middle slab
const SEAL_W = 1.5, SLOT_D = 8.6;                // apex seal half thickness and slot depth

// a closed CCW outline with rectangular notches cut outward along n.
// notch: { c, t (CCW tangent), n (into the cut), w (half width), d (depth) }
function notched(pts, notches) {
  const inN = p => notches.find(q => { const dx = p[0] - q.c[0], dy = p[1] - q.c[1]; const dn = dx * q.n[0] + dy * q.n[1]; return Math.abs(dx * q.t[0] + dy * q.t[1]) < q.w && dn > -12 && dn < q.d + 12; });
  let start = pts.findIndex(p => !inN(p));
  const out = [], N = pts.length;
  for (let i = 0; i < N; i++) {
    const p = pts[(start + i) % N], q = inN(p);
    if (!q) { out.push(p); continue; }
    // the run of points inside this notch
    const prev = pts[(start + i - 1 + N) % N];
    let j = i; while (j < N && inN(pts[(start + j) % N]) === q) j++;
    const next = pts[(start + j) % N];
    const dn = p2 => (p2[0] - q.c[0]) * q.n[0] + (p2[1] - q.c[1]) * q.n[1];
    const at = (s, d) => [q.c[0] + q.t[0] * s + q.n[0] * d, q.c[1] + q.t[1] * s + q.n[1] * d];
    out.push(at(-q.w, dn(prev)), at(-q.w, q.d), at(q.w, q.d), at(q.w, dn(next)));
    i = j - 1;
  }
  return out;
}
const housingNotch = (a, w, d) => { const n = E.housingNormal(a); return { c: E.housingPt(a), n, t: [-n[1], n[0]], w, d }; };
const turnZ = (g, a) => { g.rotateZ(a); return g; };
// the housing parameters where a notch of half width w at a meets the curve
function notchSpan(a, w) {
  const q = housingNotch(a, w, 0), s = b => { const p = E.housingPt(b); return (p[0] - q.c[0]) * q.t[0] + (p[1] - q.c[1]) * q.t[1]; };
  const find = dir => { let lo = a, hi = a + dir * 0.6; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Math.abs(s(m)) < w) lo = m; else hi = m; } return lo; };
  return [find(-1), find(1)];
}

// a ribbon on the housing running face from z0 to z1, over the parameter
// ranges given (radians); drawn with a polygon offset over the wall
function runningFace(ranges, z0, z1) {
  const pos = [], idx = [];
  for (const [a0, a1] of ranges) {
    const n = Math.max(2, Math.ceil((a1 - a0) / TAU * 720)), base = pos.length / 3;
    for (let i = 0; i <= n; i++) { const p = E.housingPt(a0 + (a1 - a0) * i / n); pos.push(p[0], p[1], z0, p[0], p[1], z1); }
    for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the normals face the cavity (inward): flip them
  const nn = g.attributes.normal.array; for (let i = 0; i < nn.length; i++) nn[i] = -nn[i];
  return g;
}

// radial glow for the spark
let GLOW = null;
function glowTex() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,214,150,0.9)'); r.addColorStop(0.5, 'rgba(255,120,40,0.28)'); r.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  GLOW = new THREE.CanvasTexture(c); GLOW.colorSpace = THREE.SRGBColorSpace;
  return GLOW;
}

// an axis-z part placed at point p with its +z along the 2D direction n
function orientTo(obj, p, n) {
  obj.position.set(p[0], p[1], 0);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], 0));
}

export function build(B, V) {
  const { R, e, W } = GEO, hw = W / 2;
  const outer = E.housingPoly(360, OUT);
  const boltAt = BOLTS.map(a => { const p = E.housingPt(a), n = E.housingNormal(a); return [p[0] + n[0] * 15, p[1] + n[1] * 15]; });
  const boltHoles = () => boltAt.map(c => circle(5.4, 28, c));
  const twin = V.rotors.length > 1;
  // explode distances (mm along z, outward from each rotor's gear side).
  // The twin is longer, so its parts spread further; the order holds.
  const X = twin
    ? { bolt: 440, plate: 390, pinion: 280, rotor: 165, ring: 30, housing: 45, shaft: 100, fly: 480, rearPlate: 0 }
    : { bolt: 340, plate: 300, pinion: 215, rotor: 130, ring: 30, housing: 0, shaft: 75, fly: 300, rearPlate: 220 };
  const units = [], gasSets = [], sparks = [];
  const cover = [], coverMeshes = [];

  // ── a rotor housing (unit frame) ─────────────────────────────────────────
  function buildHousing(u, ui) {
    const ex = [0, 0, X.housing];
    const H = B.part(`housing${ui}`, { info: 'rotorHousing', parent: u.g, label: ui === 0 ? 'Rotor housing' : null, labelAt: [R + 18, -48, hw], explode: ex, win: [0.5, 0.8] });
    const hole = E.housingPoly(720);
    const notches = [...PLUGS.map(q => housingNotch(q.a, PLUG_W, OUT - 1)), ...PORTS.map(q => housingNotch(q.a, PORT_W, OUT - 1))];
    B.mesh(H, extrudeZ(outer, [hole, ...boltHoles()], -hw, -MID), 'alu');
    B.mesh(H, extrudeZ(outer, [notched(hole, notches), ...boltHoles()], -MID, MID, 0), 'alu');
    B.mesh(H, extrudeZ(outer, [hole, ...boltHoles()], MID, hw), 'alu');
    // the chrome running face; open over the notches in the middle slab
    const cuts = [...PLUGS.map(q => [q.a, PLUG_W]), ...PORTS.map(q => [q.a, PORT_W])].map(([a, w]) => notchSpan(a, w)).sort((p, q) => p[0] - q[0]);
    const ranges = []; let a0 = 0;
    for (const [c0, c1] of cuts) { ranges.push([a0, c0]); a0 = c1; }
    ranges.push([a0, TAU]);
    B.mesh(H, runningFace([[0, TAU]], -hw + 0.8, -MID), 'running', { shadow: false });
    B.mesh(H, runningFace([[0, TAU]], MID, hw - 0.8), 'running', { shadow: false });
    B.mesh(H, runningFace(ranges, -MID, MID), 'running', { shadow: false });

    // spark plugs: thread, washer, hex, ribbed insulator, terminal
    for (const pl of PLUGS) {
      const n = E.housingNormal(pl.a), c = E.housingPt(pl.a), tip = [c[0] + n[0] * 2.2, c[1] + n[1] * 2.2];
      const P = B.part(`plug${ui}${pl.id}`, { info: 'plug', parent: H, label: ui === 0 && pl.id === 'lead' ? 'Spark plugs' : null, labelAt: [0, 0, 70], explode: [n[0] * 70, n[1] * 70, 0], win: [0, 0.3] });
      orientTo(P.root, tip, n);
      B.mesh(P, merge([rod(0.9, -1.6, 0.2, 12), tube(4.2, 7, 0.2, 27.8, 40)]), 'steel');
      B.mesh(P, merge([tube(1.4, 4.2, 0.2, 2.2, 24)]), 'ceramic');
      B.mesh(P, tube(4.4, 9, 27.8, 28.8, 40), 'steel');
      B.mesh(P, rod(10.5, 28.8, 37.4, 6), 'hex');
      const rib = [], z0 = 37.4;
      rib.push([5.8, z0]);
      for (let k = 0; k < 5; k++) { rib.push([5.8, z0 + 4 + k * 4], [6.6, z0 + 5 + k * 4], [6.6, z0 + 6.5 + k * 4], [5.8, z0 + 7.5 + k * 4]); }
      rib.push([5.8, z0 + 27], [4.2, z0 + 29]);
      B.mesh(P, lathe([rib, [[0, z0 + 29]], [[0, z0]]], 40), 'ceramic');
      B.mesh(P, merge([rod(2.6, z0 + 29, z0 + 35, 20), rod(3.4, z0 + 35, z0 + 38, 20)]), 'steel');
      // the spark: a glow just inside the running face
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, opacity: 0 }));
      // on the front face plane of the chamber, so the rotor face does not hide
      // it; the front housing does when it is shown
      sp.position.set(c[0] - n[0] * 5, c[1] - n[1] * 5, hw + 0.5); sp.scale.setScalar(1);
      sp.renderOrder = 4;
      u.g.add(sp);
      B.own(sp.material);
      sparks.push({ sp, u, lead: pl.id === 'lead', part: P });
    }
    // ports: a pipe through the notch, a flange on the outside
    for (const po of PORTS) {
      const n = E.housingNormal(po.a), c = E.housingPt(po.a), at = [c[0] + n[0] * 6, c[1] + n[1] * 6];
      const isIn = po.id === 'intake';
      const P = B.part(`${po.id}${ui}`, { info: po.id, parent: H, label: ui === 0 ? (isIn ? 'Intake port' : 'Exhaust port') : null, labelAt: [0, 0, 92], explode: [n[0] * 85, n[1] * 85, 0], win: [0, 0.3] });
      orientTo(P.root, at, n);
      const len = isIn ? 92 : 80;
      B.mesh(P, tube(11, 13.4, 0, len, 48), isIn ? 'alu' : 'soot');
      B.mesh(P, merge([tube(11, 22, OUT - 6 + 0.4, OUT - 6 + 6, 48)]), isIn ? 'alu' : 'iron');
      for (let k = 0; k < 4; k++) { const g = rod(2.8, OUT - 6 + 6, OUT - 6 + 9, 6); g.translate(17 * Math.cos(k * TAU / 4 + 0.785), 17 * Math.sin(k * TAU / 4 + 0.785), 0); B.mesh(P, g, 'hex', { shadow: false }); }
      if (isIn) B.mesh(P, lathe([[[13.4, len], [17, len + 6], [22, len + 9]], [[20.5, len + 9.5]], [[15, len + 6], [11, len]]], 48), 'alu');
      else B.mesh(P, tube(11, 15, len, len + 5, 48), 'soot');
    }
    return H;
  }

  // ── a rotor and what rides in it (unit frame) ────────────────────────────
  function rotorOutlineSlots(pocket) {
    const n = 1440, raw = E.rotorOutline(n, { pocket });
    const pts = raw.slice(n / 6).concat(raw.slice(0, n / 6));   // start at a flank middle
    const slots = [0, 1, 2].map(k => { const ps = k * TAU / 3, u = [Math.cos(ps), Math.sin(ps)]; return { c: [u[0] * R, u[1] * R], n: [-u[0], -u[1]], t: [-u[1], u[0]], w: SEAL_W + 0.1, d: SLOT_D }; });
    return notched(pts, slots);
  }
  function buildRotor(u, ui) {
    const P = B.part(`rotor${ui}`, { info: 'rotor', parent: u.g, label: ui === 0 ? 'Rotor' : null, labelAt: [0, 80, -10], explode: [0, 0, X.rotor], win: [0.3, 0.72] });
    const full = rotorOutlineSlots(false), pock = rotorOutlineSlots(true), zA = -hw + 0.4, zP0 = -25, zP1 = 23, zB = hw - 0.4;
    B.mesh(P, extrudeZ(full, [circle(GEO.bore, 96)], zA, zP0), 'rotor');
    B.mesh(P, extrudeZ(pock, [circle(GEO.bore, 96)], zP0, zP1, 0), 'rotor');
    B.mesh(P, extrudeZ(full, [circle(52.5, 128)], zP1, zB), 'rotor');
    // the pockets: a darker skin on the recess floors (pick them as their own part)
    const pk = B.part(`pocket${ui}`, { info: 'pocket', parent: P });
    {
      const pos = [], idx = [];
      for (let k = 0; k < 3; k++) {
        const mid = Math.PI / 3 + k * TAU / 3, span = GEO.pocket.half * 0.98, m = 40, base = pos.length / 3;
        for (let i = 0; i <= m; i++) {
          const psi = mid - span + 2 * span * i / m, r = E.flankR(psi) - GEO.clr - E.pocketDepth(psi) + 0.05;
          pos.push(r * Math.cos(psi), r * Math.sin(psi), zP0 + 0.3, r * Math.cos(psi), r * Math.sin(psi), zP1 - 0.3);
        }
        for (let i = 0; i < m; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      B.mesh(pk, g, 'soot', { shadow: false });
    }
    // bearing
    const Bg = B.part(`bearing${ui}`, { info: 'bearing', parent: P });
    B.mesh(Bg, tube(GEO.lobe + 0.05, GEO.bore - 0.05, -hw + 2, zP1 - 2, 96), 'bronze');
    // ring gear in the front recess
    const G = B.part(`ring${ui}`, { info: 'ringGear', parent: P, label: ui === 0 ? 'Ring gear' : null, labelAt: [0, -50, zB], explode: [0, 0, X.ring], win: [0.78, 1] });
    B.mesh(G, extrudeZ(circle(52.3, 128), [E.gearOutline(GEO.gear.ring, GEO.gear.m, true, E.RING_PH, 14)], zP1 + 0.4, zB - 0.2, 0.4), 'gear');
    // apex seals: a blade with a round crown, in the slot at each apex
    for (let k = 0; k < 3; k++) {
      const ps = k * TAU / 3;
      const S = B.part(`apex${ui}${k}`, { info: 'apexSeal', parent: P, label: ui === 0 && k === 0 ? 'Apex seal' : null, labelAt: [R * Math.cos(ps), R * Math.sin(ps), zB], explode: [Math.cos(ps) * 22, Math.sin(ps) * 22, 0], win: [0.75, 1] });
      const blade = [[R - SLOT_D + 0.2, -SEAL_W], [R - SEAL_W - 0.05, -SEAL_W]];
      for (let i = 1; i < 12; i++) { const a = -Math.PI / 2 + Math.PI * i / 12; blade.push([R - SEAL_W - 0.05 + SEAL_W * Math.cos(a), SEAL_W * Math.sin(a)]); }
      blade.push([R - SEAL_W - 0.05, SEAL_W], [R - SLOT_D + 0.2, SEAL_W]);
      B.mesh(S, turnZ(extrudeZ(blade, [], -hw + 0.6, hw - 0.6, 0.2), ps), 'seal');
    }
    // corner seals, side seals and oil seal rings on both faces
    for (const f of [1, -1]) {
      const zf0 = f > 0 ? hw - 3.4 : -hw + 0.1, zf1 = f > 0 ? hw - 0.1 : -hw + 3.4;
      const C = B.part(`corner${ui}${f}`, { info: 'cornerSeal', parent: P, explode: [0, 0, 18 * f], win: [0.8, 1] });
      B.mesh(C, merge([0, 1, 2].map(k => { const ps = k * TAU / 3, g = rod(3, zf0, zf1, 24); g.translate((R - SLOT_D - 3.1) * Math.cos(ps), (R - SLOT_D - 3.1) * Math.sin(ps), 0); return g; })), 'seal');
      const Sd = B.part(`side${ui}${f}`, { info: 'sideSeal', parent: P, label: ui === 0 && f > 0 ? 'Side seals' : null, labelAt: [0, 72, zB], explode: [0, 0, 12 * f], win: [0.76, 1] });
      const bands = [];
      for (let k = 0; k < 3; k++) {
        const p0 = k * TAU / 3 + 10.5 * D, p1 = (k + 1) * TAU / 3 - 10.5 * D, m = 80, o = [], ii = [];
        for (let i = 0; i <= m; i++) { const ps = p0 + (p1 - p0) * i / m, r = E.flankR(ps) - GEO.clr - 3.6; o.push([r * Math.cos(ps), r * Math.sin(ps)]); ii.push([(r - 1.4) * Math.cos(ps), (r - 1.4) * Math.sin(ps)]); }
        bands.push(extrudeZ(o.concat(ii.reverse()), [], f > 0 ? hw - 1.6 : -hw + 0.1, f > 0 ? hw - 0.1 : -hw + 1.6, 0.2));
      }
      B.mesh(Sd, merge(bands), 'seal');
      const O = B.part(`oil${ui}${f}`, { info: 'oilSeal', parent: P, explode: [0, 0, 7 * f], win: [0.76, 1] });
      B.mesh(O, tube(55, 57, f > 0 ? hw - 1.4 : -hw + 0.1, f > 0 ? hw - 0.1 : -hw + 1.4, 120), 'seal');
    }
    return P;
  }

  // ── side housings ─────────────────────────────────────────────────────────
  // withGear: the plate on the gear side of a unit (unit frame, z from hw).
  // Otherwise a plain plate at global z0..z1 with a main bearing.
  function buildPlate(id, parent, z0, z1, withGear, o) {
    const P = B.part(id, { info: o.info, parent, label: o.label, labelAt: o.labelAt, explode: o.explode, win: o.win });
    if (withGear) {
      B.mesh(P, extrudeZ(outer, [circle(42.4, 128), ...boltHoles()], z0, z0 + 6), 'iron');
      B.mesh(P, extrudeZ(outer, [circle(27.2, 96), ...boltHoles()], z0 + 6, z1), 'iron');
    } else {
      B.mesh(P, extrudeZ(outer, [circle(27.2, 96), ...boltHoles()], z0, z1), 'iron');
      const M = B.part(id + 'Bearing', { info: 'mainBearing', parent: P });
      B.mesh(M, tube(GEO.journal + 0.15, 27.1, z0 + 0.5, z1 - 0.5, 72), 'bronze');
    }
    return P;
  }
  function buildPinion(u, ui) {
    const G = B.part(`pinion${ui}`, { info: 'pinion', parent: u.g, label: ui === 0 ? 'Stationary gear' : null, labelAt: [0, 36, hw + 2], explode: [0, 0, X.pinion], win: [0.16, 0.56] });
    const rIn = GEO.journal + 0.3;
    B.mesh(G, extrudeZ(E.gearOutline(GEO.gear.fixed, GEO.gear.m, false, E.FIXED_PH, 14), [circle(rIn, 72)], 25, hw, 0.4), 'gear');
    // the flange and the sleeve: hidden with the front housing, so the
    // mesh shows from the front
    const fl = B.mesh(G, merge([tube(rIn, 42, hw + 0.02, hw + 6, 96), tube(rIn, 27, hw + 6, hw + 30, 72)]), 'gear');
    if (ui === 0) coverMeshes.push(fl);
    return G;
  }

  // ── units ────────────────────────────────────────────────────────────────
  V.rotors.forEach((r, ui) => {
    const g = new THREE.Group(); g.position.z = r.zc; g.scale.z = r.s; B.root.add(g);
    const u = { g, ...r, ui };
    u.housing = buildHousing(u, ui);
    u.rotor = buildRotor(u, ui);
    u.pinion = buildPinion(u, ui);
    const plateId = ui === 0 ? 'frontPlate' : 'rearPlate';
    u.plate = buildPlate(`${plateId}${ui}`, g, hw, hw + 30, true, { info: plateId, label: ui === 0 ? 'Front side housing' : 'Rear side housing', labelAt: [-R - 30, 40, hw + 30], explode: [0, 0, X.plate], win: [0.04, 0.42] });
    if (ui === 0) cover.push(u.plate.id);
    u.gas = makeGas(u);
    units.push(u);
  });
  const zFrontFace = V.rotors[0].zc + hw + 30;
  const zBackFace = twin ? V.rotors[1].zc - hw - 30 : -hw - 30;
  if (!twin) buildPlate('rearPlate', null, -hw - 30, -hw, false, { info: 'rearPlate', label: 'Rear side housing', labelAt: [-R - 30, 40, -hw - 30], explode: [0, 0, -X.rearPlate], win: [0.04, 0.42] });
  else {
    const M = B.part('midPlate', { info: 'midPlate', label: 'Intermediate housing', labelAt: [-R - 30, -40, 0] });
    B.mesh(M, extrudeZ(outer, [circle(54, 128), ...boltHoles()], -20, 20), 'iron');
  }

  // ── tension bolts ────────────────────────────────────────────────────────
  {
    const Bt = B.part('bolts', { info: 'bolt', label: 'Tension bolts', labelAt: [...boltAt[0], zFrontFace + 7], explode: [0, 0, X.bolt], win: [0, 0.32] });
    const gs = [];
    for (const c of boltAt) {
      const s = rod(5, zBackFace + 6, zFrontFace, 16); s.translate(c[0], c[1], 0); gs.push(s);
      const h = rod(8.6, zFrontFace, zFrontFace + 7, 6); h.translate(c[0], c[1], 0); gs.push(h);
    }
    B.mesh(Bt, merge(gs), 'blued');
    cover.push('bolts');
  }

  // ── eccentric shaft and flywheel ─────────────────────────────────────────
  const zNose = zFrontFace + 24, zTail = zBackFace - 30;
  const shaft = B.part('shaft', { info: 'shaft', label: 'Eccentric shaft', labelAt: [0, 0, zNose], explode: [0, 0, X.shaft], win: [0.55, 0.95] });
  {
    const gs = [rod(GEO.journal, zTail, zNose - 6, 48), rod(GEO.journal - 3, zNose - 6, zNose, 40)];
    for (const r of V.rotors) {
      const lz0 = r.s > 0 ? r.zc - hw + 2 : r.zc - 21, lz1 = r.s > 0 ? r.zc + 21 : r.zc + hw - 2;
      const g = rod(GEO.lobe, lz0, lz1, 96); g.translate(e * Math.cos(r.off), e * Math.sin(r.off), 0); gs.push(g);
    }
    B.mesh(shaft, merge(gs), 'steel');
    // a key on the nose, so the turning reads
    const key = new THREE.BoxGeometry(5, 4, 14); key.translate(0, GEO.journal - 3 + 1.2, zNose - 8);
    B.mesh(shaft, key, 'iron');
  }
  const fly = B.part('flywheel', { info: 'flywheel', label: 'Flywheel', labelAt: [0, 80, zBackFace - 26], explode: [0, 0, -X.fly], win: [0, 0.36] });
  {
    const z1 = zBackFace - 8, z0 = z1 - 14;
    const holes = [circle(GEO.journal + 0.2, 64)];
    for (let k = 0; k < 6; k++) holes.push(circle(10, 36, [48 * Math.cos(k * TAU / 6), 48 * Math.sin(k * TAU / 6)]));
    B.mesh(fly, extrudeZ(E.gearOutline(96, 1.6, false, 0, 6), holes, z0, z1, 0.5), 'steel');
    B.mesh(fly, tube(GEO.journal + 0.2, 32, z0 - 8, z0, 72), 'steel');
    B.mesh(fly, merge([0, 1, 2, 3, 4, 5].map(k => { const g = rod(3.4, z1, z1 + 3, 6); g.translate(27 * Math.cos(k * TAU / 6 + 0.5), 27 * Math.sin(k * TAU / 6 + 0.5), 0); return g; })), 'blued', { shadow: false });
  }

  // ── the gas in the chambers ──────────────────────────────────────────────
  // One mesh per chamber: two caps and two walls between the housing arc and
  // the flank, rebuilt each frame. Unlit and see-through, coloured by stroke.
  function makeGas(u) {
    const n = 40, NP = 2 * (n + 1), z0 = -hw + 1, z1 = hw - 1, out = [];
    for (let k = 0; k < 3; k++) {
      const pos = new Float32Array(NP * 2 * 3), idx = [];
      const A = i => i, F = i => 2 * n + 1 - i, top = NP;   // arc i, flank i; +NP for the front cap
      for (let i = 0; i < n; i++) {
        for (const off of [0, top]) idx.push(A(i) + off, A(i + 1) + off, F(i + 1) + off, A(i) + off, F(i + 1) + off, F(i) + off);
        idx.push(A(i), A(i + 1), A(i + 1) + top, A(i), A(i + 1) + top, A(i) + top);
        idx.push(F(i), F(i + 1), F(i + 1) + top, F(i), F(i + 1) + top, F(i) + top);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.userData.ownAlpha = true; mesh.castShadow = false; mesh.renderOrder = 2; mesh.frustumCulled = false;
      u.g.add(mesh);
      B.own(g); B.own(m);
      out.push({ mesh, pos, n, z0, z1, col: new THREE.Color() });
    }
    return out;
  }
  const strokeCol = E.STROKES.map(s => new THREE.Color(s.col));
  const flameCol = new THREE.Color(0xffd27a);
  function poseGas(u, a, ch, op) {
    for (let k = 0; k < 3; k++) {
      const G = u.gas[k], c = ch[k];
      G.mesh.visible = op > 0.01;
      if (!G.mesh.visible) continue;
      const pts = E.chamberPoly(a + k * TAU / 3, G.n), NP = pts.length;
      for (let i = 0; i < NP; i++) {
        const p = pts[i];
        G.pos.set([p[0], p[1], G.z0], i * 3);
        G.pos.set([p[0], p[1], G.z1], (i + NP) * 3);
      }
      G.mesh.geometry.attributes.position.needsUpdate = true;
      // colour: the stroke; the power stroke starts as flame and cools
      G.col.copy(strokeCol[c.stroke]);
      let o = 0.26;
      if (c.stroke === 2) { const f = Math.max(0, 1 - (c.w - Math.PI) / (Math.PI / 2)); G.col.lerp(flameCol, f * f); o = 0.26 + 0.22 * f * f; }
      if (c.stroke === 1) o = 0.22 + 0.1 * (c.w - Math.PI / 2) / (Math.PI / 2);
      G.mesh.material.color.copy(G.col);
      G.mesh.material.opacity = o * op;
    }
  }

  // ── the pose ─────────────────────────────────────────────────────────────
  const sc = { units, cover, coverMeshes, twin };
  let gasOp = 1, sparkOn = true;
  sc.setGas = op => { gasOp = op; };
  sc.setSpark = on => { sparkOn = on; };
  sc.pose = t => {
    shaft.root.rotation.z = t;
    fly.root.rotation.z = t;
    for (const u of units) {
      const k = E.kin(t, u.off);
      u.rotor.root.position.set(k.c[0], k.c[1], 0);
      u.rotor.root.rotation.z = k.a;
      u.k = k;
      u.ch = E.chambers(t, u.off);
      poseGas(u, k.a, u.ch, gasOp);
    }
    // the plugs fire as a chamber's phase passes the spark point; the
    // trailing plug a little later. The glow lives in the phase, not in
    // time, so it shows at any speed.
    for (const s of sparks) {
      let f = 0;
      for (const c of s.u.ch) {
        const d = c.w - (Math.PI - GEO.spark) - (s.lead ? 0 : 3 * D);
        if (d >= 0 && d < 0.5) f = Math.max(f, Math.exp(-d / 0.07));
      }
      f *= sparkOn ? 1 : 0;
      s.sp.material.opacity = Math.min(1, f * 1.2) * B.alpha;
      s.sp.scale.setScalar(6 + 30 * f);
      s.sp.visible = f > 0.01;
      s.f = f;
    }
  };
  sc.sparks = sparks;
  const zMid = (zFrontFace + zBackFace) / 2;
  sc.box = { c: [0, 0, zMid], R: twin ? 230 : 175 };
  sc.zFront = zFrontFace; sc.zBack = zBackFace;
  // the middle of the exploded spread, for the camera (along z)
  sc.explodeCentre = ex => zMid + (twin ? -30 : 8) * ex;
  sc.spreadK = twin ? 1.12 : 1;
  return sc;
}

// ============================================================================
//  GEAR TYPES  ·  scene.js — the parts of each gear pair and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one pair with kit.js and gears.js and returns sc:
//  { pose(th), box, keys, D }. Angles, travel and contact points come from
//  mech.js, so the teeth that turn on screen are the ones tests.mjs checks.
//
//  LAYOUT (mm, y up; every part made about its local Y, see kit.js)
//    spur, helical ... gear 1 at (-r1, 0, 0), gear 2 at (r2, 0, 0), axes +z.
//                      The pitch point is the origin. Gear 1 is 2 mm wider
//                      than gear 2, so their end faces are not in one plane
//    bevel ........... apex at the origin. Pinion axis +z, wheel axis -y;
//                      they touch on (0, -R1, A cos g1)
//    worm ............ worm axis on x at y = 0, wheel at (0, r1 + r2, 0)
//    rack ............ pinion at the origin, rack pitch line y = -r1
//  Each layout has a base plate and bearing blocks. A labelAt is in the
//  part frame: local X = e0, local Y = the axis, local Z = e0 x axis.
//
//  Z-FIGHTING RULES. No two faces lie in one plane where they overlap:
//    - hubs and blocks sink 0.5 mm into the face they stand on
//    - a bearing boss is 2 mm longer than its block on each side
//    - bores are 1 mm larger than their shafts
//    - the rack runs 0.5 mm clear of its guide cheeks and floor
//    - decals (line of action, base circles, contact dots, arrows) float
//      2 mm or more off the faces and use the polygonOffset decal materials
//    - a bevel blank cone sits 0.4 mm inside the tooth ring, under the roots
//
//  GREP MAP
//    function arrow ........... a force arrow along a direction
//    function block ........... a bearing block from a base up to an axis
//    function actionLine ...... line of action, base circles, contact dots
//    function parallel ........ spur and helical pairs
//    function bevel ........... the bevel pair and its pitch cones
//    function worm ............ worm, thread sweep, wheel
//    function rack ............ pinion, rack, guides, speed arrow
//    export function build .... the pair for a unit id
// ============================================================================
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { slab, rod, tube, lathe, poly, merge } from './kit.js';
import { helicalTeeth, bevelTeeth } from './gears.js';
import { unit, derive, plane, pose, contacts, helixNormal, TAU, T_TH } from './mech.js';

const YV = new THREE.Vector3(0, 1, 0);
const LIFT = 4;              // decal height over the front face, mm

// an arrow from the origin along dir, len long, with radius r
function arrow(dir, len, r = 1.4) {
  const head = Math.min(len * 0.4, 9), shaft = new THREE.CylinderGeometry(r, r, Math.max(0.5, len - head), 12);
  shaft.translate(0, (len - head) / 2, 0);
  const cone = new THREE.ConeGeometry(r * 2.6, head, 16); cone.translate(0, len - head / 2, 0);
  const g = merge([shaft, cone]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(YV, new THREE.Vector3(...dir).normalize()));
  return g;
}

// A bearing block: part frame with local Y on the shaft axis and local +Z
// pointing down (e0 chosen so). Boss tube round the shaft, a box down to
// the base top yBase (world), w the block thickness along the shaft.
function block(B, id, at, u, e0, yBase, o = {}) {
  const w = o.w || 16, rI = o.rI || 8.5, rO = o.rO || 16, H = at[1] - yBase + 0.5;
  const p = B.part(id, { info: 'block', u, e0, at, explode: o.explode || [0, -30, -30], st: 0, en: 0.5, label: o.label || null, labelAt: [0, 0, 0] });
  // the box ends 1 mm above the foot's base face
  const box = new THREE.BoxGeometry(2 * rO - 10, w - 4, H - 12);
  box.translate(0, 0, 11 + (H - 12) / 2);
  B.mesh(p, merge([tube(rI, rO, -w / 2 - 2, w / 2 + 2, 40), box, (() => { const f = new THREE.BoxGeometry(2 * rO + 14, w + 8, 6); f.translate(0, 0, H - 3); return f; })()]), 'cast');
  return p;
}

function basePlate(B, x0, x1, z0, z1, yTop, explode = [0, -60, 0]) {
  const p = B.part('base', { info: 'base', explode, st: 0, en: 0.5 });
  const s = new THREE.Shape([[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]].map(q => new THREE.Vector2(...q)));
  B.mesh(p, slab(s, yTop - 12, 12, 1.2), 'paint');
  return p;
}

// Line of action in the transverse plane z = zF (world), mapped from the
// mech.js test plane by toW(X, Y). Base circles of the gears, the action
// segment sMin..sMax along d, and up to 3 contact dots. update(Q) moves
// the dots and mirrors the line when the drive runs backward (rack).
function actionLine(B, D, toW, zF, circles, explode) {
  const p = B.part('loa', { info: 'loa', label: 'Line of action', labelAt: [...toW(...plane(D).P.map((v, i) => v + plane(D).d[i] * D.sMax)), zF], explode, st: 0.3, en: 1 });
  const L = D.sMax - D.sMin;
  const seg = new THREE.CylinderGeometry(0.7, 0.7, L + 16, 10); seg.translate(0, (D.sMin + D.sMax) / 2, 0);
  const segM = B.mesh(p, seg, 'gold', { shadow: false });
  const act = new THREE.CylinderGeometry(1.25, 1.25, L, 12); act.translate(0, (D.sMin + D.sMax) / 2, 0);
  const actM = B.mesh(p, act, 'gold', { shadow: false });
  for (const [cx, cy, r] of circles) {
    const t = new THREE.TorusGeometry(r, 0.45, 6, 160); const w = toW(cx, cy); t.translate(w[0], w[1], zF);
    B.mesh(p, t, 'blue', { shadow: false });
  }
  const dots = [0, 1, 2].map(() => B.mesh(p, new THREE.SphereGeometry(2.6, 18, 12), 'ink', { shadow: false }));
  const q = new THREE.Quaternion(), dv = new THREE.Vector3();
  return Q => {
    const Lp = plane(D, Q.dir), P = toW(...Lp.P);
    dv.set(Lp.d[0], Lp.d[1], 0); q.setFromUnitVectors(YV, dv);
    for (const m of [segM, actM]) { m.position.set(P[0], P[1], zF); m.quaternion.copy(q); }
    const ss = contacts(D, Q.arc, Q.dir);
    dots.forEach((m, i) => {
      m.visible = i < ss.length;
      if (m.visible) { const w = toW(Lp.P[0] + ss[i] * Lp.d[0], Lp.P[1] + ss[i] * Lp.d[1]); m.position.set(w[0], w[1], zF); }
    });
    return ss.length;
  };
}

// ── spur and helical ────────────────────────────────────────────────────────
function parallel(B, u, D) {
  const hel = !!D.beta, b2 = D.b, b1 = D.b + 2, k = Math.tan(D.beta);
  const o = { ha: D.ha / D.mt, hf: D.hf / D.mt, t: T_TH, alpha: D.at, rin: 0, slices: hel ? 18 : 2 };
  const g1 = B.part('g1', { info: 'pinion', u: [0, 0, 1], e0: [1, 0, 0], at: [-D.r1, 0, 0], label: hel ? 'Helical pinion' : 'Spur pinion', labelAt: [0, 0, -(D.r1 + 10)], explode: [-30, 0, 80], st: 0.15, en: 0.8 });
  B.mesh(g1, helicalTeeth({ ...o, N: u.N1, m: D.mt, y0: -b1 / 2, y1: b1 / 2, twist: y => y * k / D.r1 }).geom, 'steel');
  B.mesh(g1, merge([rod(14, b1 / 2 - 0.5, b1 / 2 + 5, 40), rod(14, -b1 / 2 - 5, -b1 / 2 + 0.5, 40), rod(7.5, -66, b1 / 2 + 9, 24)]), 'shaft');
  const g2 = B.part('g2', { info: 'gear', u: [0, 0, 1], e0: [-1, 0, 0], at: [D.r2, 0, 0], label: hel ? 'Helical gear' : 'Spur gear', labelAt: [0, 0, D.r2 + 10], explode: [30, 0, 120], st: 0.2, en: 0.9 });
  B.mesh(g2, helicalTeeth({ ...o, N: u.N2, m: D.mt, y0: -b2 / 2, y1: b2 / 2, twist: y => -y * k / D.r2 }).geom, 'satin');
  B.mesh(g2, merge([rod(18, b2 / 2 - 0.5, b2 / 2 + 4, 48), rod(18, -b2 / 2 - 5, -b2 / 2 + 0.5, 48), rod(7.5, -66, b2 / 2 + 8, 24)]), 'shaft');
  const yB = -(D.r2 + D.ha + 16);
  basePlate(B, -2 * D.r1 - 36, 2 * D.r2 + 30, -78, 46, yB);
  block(B, 'blk1', [-D.r1, 0, -48], [0, 0, 1], [1, 0, 0], yB, { label: 'Bearing block' });
  block(B, 'blk2', [D.r2, 0, -48], [0, 0, 1], [1, 0, 0], yB);

  const zF = b1 / 2 + LIFT, toW = (X, Y) => [X - D.r1, Y];
  const loa = actionLine(B, D, toW, zF, [[0, 0, D.r1 * Math.cos(D.at)], [D.r1 + D.r2, 0, D.r2 * Math.cos(D.at)]], [0, 0, 170]);

  // forces on gear 2 at the pitch point: Ft (gold), Fr (blue); Fa (ink) on
  // both shaft ends, opposite ways. 0.07 mm per N.
  const K = 0.07, n = helixNormal(D), sFa = Math.sign(n[2]) || 1;
  const fz = B.part('forces', { info: 'forces', label: 'Tooth forces', labelAt: [0, D.Ft * K + 8, zF + 4], explode: [0, 0, 190], st: 0.3, en: 1 });
  B.mesh(fz, arrow([0, 1, 0], D.Ft * K).translate(0, 0, zF + 3), 'gold', { shadow: false });
  B.mesh(fz, arrow([1, 0, 0], D.Fr * K).translate(0, 0, zF + 3), 'blue', { shadow: false });
  B.mesh(fz, new THREE.SphereGeometry(3, 16, 10).translate(0, 0, zF + 3), 'gold', { shadow: false });
  if (hel) {
    B.mesh(fz, arrow([0, 0, sFa], D.Fa * K, 2).translate(D.r2, 0, sFa > 0 ? b2 / 2 + 10 : -b2 / 2 - 6), 'ink', { shadow: false });
    B.mesh(fz, arrow([0, 0, -sFa], D.Fa * K, 2).translate(-D.r1, 0, -sFa > 0 ? b1 / 2 + 11 : -b1 / 2 - 6), 'ink', { shadow: false });
  }
  return {
    pose(th) {
      const Q = pose(D, th);
      g1.spin(Q.a1); g2.spin(Q.a2);
      Q.inContact = loa(Q);
      return Q;
    },
    box: { c: [D.r2 / 2 - D.r1 / 2, -6, 0], R: 0.62 * (2 * D.r1 + 2 * D.r2 + 40) },
    keys: { mesh: [0, 0, zF], g1: [-D.r1, 0, 0], g2: [D.r2, 0, 0] },
    D, sFa,
  };
}

// ── bevel ───────────────────────────────────────────────────────────────────
// blank under a bevel tooth ring: the inner cone of the ring (pushed 0.4 mm
// out, inside the teeth) and a back face, a hub and a shaft along local Y
function bevelBlank(T, A, F, hubR, y1) {
  const h = T.map(T.rin + 0.4, 0, A), t = T.map(T.rin + 0.4, 0, A - F);
  const hR = Math.hypot(h[0], h[2]), tR = Math.hypot(t[0], t[2]);
  return poly([[0.01, t[1] - 1], [tR, t[1]], [hR, h[1]], [hR, h[1] + 3], [hubR, h[1] + 7], [hubR, y1], [0.01, y1]], 72);
}
function bevel(B, u, D) {
  const A = D.A, F = D.F, o = { ha: 1, hf: 1.25, t: T_TH, alpha: D.at, slices: 2, depth: 0.8 };
  const g1 = B.part('g1', { info: 'pinion', u: [0, 0, 1], e0: [0, -1, 0], label: 'Bevel pinion', labelAt: [0, A * Math.cos(D.g1) + 10, 0], explode: [0, 0, 80], st: 0.15, en: 0.8 });
  const T1 = bevelTeeth({ ...o, N: u.N1, m: u.m, gam: D.g1, A, F });
  B.mesh(g1, T1.geom, 'steel');
  B.mesh(g1, bevelBlank(T1, A, F, 14, 84), 'steel');
  B.mesh(g1, rod(7.5, 80, 152, 24), 'shaft');
  const g2 = B.part('g2', { info: 'gear', u: [0, -1, 0], e0: [0, 0, 1], label: 'Bevel gear', labelAt: [D.R2 + 10, A * Math.cos(D.g2), 0], explode: [0, -60, -20], st: 0.2, en: 0.9 });
  const T2 = bevelTeeth({ ...o, N: u.N2, m: u.m, gam: D.g2, A, F });
  B.mesh(g2, T2.geom, 'brass');
  B.mesh(g2, bevelBlank(T2, A, F, 20, 52), 'brass');
  B.mesh(g2, rod(7.5, 48, 100, 24), 'shaft');
  const yB = -104;
  basePlate(B, -100, 100, -90, 170, yB, [0, -90, 0]);
  block(B, 'blk1', [0, 0, 132], [0, 0, 1], [1, 0, 0], yB, { label: 'Bearing block', explode: [0, -40, 40] });
  // a vertical bearing housing for the wheel shaft, on the base
  const hs = B.part('blk2', { info: 'block', explode: [0, -70, 0], st: 0, en: 0.5 });
  B.mesh(hs, merge([tube(8.5, 17, -92, -64, 40), tube(9, 30, yB - 0.5, -86, 48)]), 'cast');
  // pitch cones, 0.3 % short of the pitch radius, so the two never touch
  const cones = [[g1, D.g1, [0, 0, 1], [0, -1, 0]], [g2, D.g2, [0, -1, 0], [0, 0, 1]]].map(([, g, uu, e], i) => {
    const p = B.part('cone' + i, { info: 'cones', u: uu, e0: e, label: i ? null : 'Pitch cones', labelAt: [0, A * Math.cos(g) * 0.5, A * Math.sin(g) * 0.5], explode: i ? [0, -60, -20] : [0, 0, 80], st: 0.2, en: 0.9 });
    const cg = new THREE.LatheGeometry([new THREE.Vector2(0.01, 0), new THREE.Vector2(0.997 * A * Math.sin(g), A * Math.cos(g))], 96);
    B.mesh(p, cg, 'glass', { shadow: false, pick: false });
    return p;
  });
  // axial thrust: each gear is pushed away from the apex (0.07 mm per N)
  const K = 0.1, fz = B.part('forces', { info: 'forces', label: 'Axial thrust', labelAt: [0, 20, 158 + D.Fa1 * K], explode: [0, 40, 0], st: 0.3, en: 1 });
  B.mesh(fz, arrow([0, 0, 1], D.Fa1 * K, 2).translate(0, 0, 156), 'ink', { shadow: false });
  B.mesh(fz, arrow([0, -1, 0], D.Fa2 * K, 2).translate(0, 2, 0), 'ink', { shadow: false });
  void cones;
  const cl = [0, -Math.cos(D.g2), Math.sin(D.g2)], sm = A - F / 2;
  return {
    pose(th) {
      const Q = pose(D, th);
      g1.spin(Q.a1); g2.spin(Q.a2);
      Q.inContact = contacts(D, Q.arc, 1).length;
      return Q;
    },
    box: { c: [0, -30, 40], R: 135 },
    keys: { mesh: cl.map(v => v * sm), g1: [0, 0, A * Math.cos(D.g1)], g2: [0, -A * Math.cos(D.g2), 0] },
    D,
  };
}

// ── worm ────────────────────────────────────────────────────────────────────
// The thread: the axial rack tooth (flanks at alpha_x) swept along a helix
// of lead L about local Y. Its base sinks 0.6 mm into the core.
function threadGeom(D, turns, y0) {
  const hw = h => T_TH / 2 * D.p - h * Math.tan(D.at);
  const prof = [[-D.hf - 0.6, -hw(-D.hf - 0.6)], [D.ha, -hw(D.ha)], [D.ha, hw(D.ha)], [-D.hf - 0.6, hw(-D.hf - 0.6)]];   // [h, axial]
  const hc = prof.reduce((q, v) => q + v[0], 0) / 4, nS = Math.round(turns * 96), P = [];
  const fOf = j => TAU * turns * j / nS;
  const at = (j, i) => { const f = fOf(j), r = D.r1 + prof[i][0], y = y0 + D.L * f / TAU + prof[i][1]; return [r * Math.cos(f), y, -r * Math.sin(f)]; };
  const mid = j => { const f = fOf(j), r = D.r1 + hc; return [r * Math.cos(f), y0 + D.L * f / TAU, -r * Math.sin(f)]; };
  const tan = j => { const f = fOf(j); return [-Math.sin(f), D.L / TAU / (D.r1 + hc), -Math.cos(f)]; };
  // each quad faces the way want points (from the profile centre out, or
  // along the sweep at the two end caps)
  const quad = (a, b, c, d, want) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0) P.push(...a, ...b, ...c, ...a, ...c, ...d);
    else P.push(...a, ...c, ...b, ...a, ...d, ...c);
  };
  for (let j = 0; j < nS; j++) for (let i = 0; i < 4; i++) {
    const i1 = (i + 1) % 4, A = at(j, i), m = mid(j + 0.5);
    quad(A, at(j + 1, i), at(j + 1, i1), at(j, i1), [A[0] - m[0], A[1] - m[1], A[2] - m[2]].map((v, k) => v + (at(j + 1, i1)[k] - m[k])));
  }
  for (const [j, sg] of [[0, -1], [nS, 1]]) { const q = [0, 1, 2, 3].map(i => at(j, i)); quad(q[0], q[1], q[2], q[3], tan(j).map(v => v * sg)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const out = toCreasedNormals(g, 0.6); g.dispose();
  return out;
}
function worm(B, u, D) {
  const a = D.r1 + D.r2, len = 92, turns = 6;
  const w = B.part('g1', { info: 'worm', u: [1, 0, 0], e0: [0, 1, 0], label: 'Worm (1 start)', labelAt: [D.r1 + 12, -len / 2 + 8, 0], explode: [0, -10, 90], st: 0.15, en: 0.8 });
  B.mesh(w, rod(D.r1 - D.hf, -len / 2, len / 2, 48), 'steel');
  // y0 a whole number of pitches, so a crest sits at Y = L phi / 2 pi + k p
  const th = threadGeom(D, turns, -D.L * turns / 2);
  B.mesh(w, th, 'steel');
  B.mesh(w, rod(7.5, -102, 102, 24), 'shaft');
  const g2 = B.part('g2', { info: 'wheel', u: [0, 0, 1], e0: [0, -1, 0], at: [0, a, 0], label: 'Worm wheel (30 teeth)', labelAt: [-(D.r2 + 12), 0, 0], explode: [0, 70, 30], st: 0.2, en: 0.9 });
  B.mesh(g2, helicalTeeth({ N: u.N2, m: D.mt, y0: -D.b / 2, y1: D.b / 2, ha: 1, hf: 1.25, t: T_TH, alpha: D.at, rin: 0, slices: 8, twist: y => y * Math.tan(D.lambda) / D.r2 }).geom, 'satinb');
  B.mesh(g2, merge([rod(18, D.b / 2 - 0.5, D.b / 2 + 4, 48), rod(18, -D.b / 2 - 5, -D.b / 2 + 0.5, 48), rod(7.5, -66, D.b / 2 + 9, 24)]), 'shaft');
  const yB = -42;
  basePlate(B, -120, 120, -80, 46, yB, [0, -70, 0]);
  block(B, 'blk1', [-74, 0, 0], [1, 0, 0], [0, 0, -1], yB, { label: 'Bearing block', explode: [-30, -30, 0] });
  block(B, 'blk2', [74, 0, 0], [1, 0, 0], [0, 0, -1], yB, { explode: [30, -30, 0] });
  block(B, 'blk3', [0, a, -48], [0, 0, 1], [1, 0, 0], yB, { explode: [0, -30, -40] });
  return {
    pose(t) {
      const Q = pose(D, t);
      w.spin(Q.a1); g2.spin(Q.a2);
      Q.inContact = contacts(D, Q.arc, 1).length;
      return Q;
    },
    box: { c: [0, 35, 0], R: 130 },
    keys: { mesh: [0, D.r1, 0], g1: [0, 0, 0], g2: [0, a, 0] },
    D,
  };
}
// ── rack and pinion ─────────────────────────────────────────────────────────
function rack(B, u, D) {
  const b1 = D.b + 2, b2 = D.b, half = 172, nT = Math.floor(2 * half / D.p);
  const g1 = B.part('g1', { info: 'pinion', u: [0, 0, 1], e0: [0, -1, 0], label: 'Pinion', labelAt: [-(D.r1 + 14), 0, 0], explode: [0, 70, 50], st: 0.15, en: 0.8 });
  B.mesh(g1, helicalTeeth({ N: u.N1, m: D.mt, y0: -b1 / 2, y1: b1 / 2, ha: 1, hf: 1.25, t: T_TH, alpha: D.at, rin: 0, slices: 2 }).geom, 'steel');
  B.mesh(g1, merge([rod(14, b1 / 2 - 0.5, b1 / 2 + 5, 40), rod(14, -b1 / 2 - 5, -b1 / 2 + 0.5, 40), rod(7.5, -66, b1 / 2 + 9, 24)]), 'shaft');
  // the rack outline in the (x, y) plane, teeth up at x = (k + 1/2) p
  const yP = -D.r1, yBot = yP - D.hf - 13, hw = h => T_TH / 2 * D.p - h * Math.tan(D.at);
  const pts = [[-half, yBot], [half, yBot], [half, yP - D.hf]];
  for (let k = Math.floor(nT / 2) - 1; k >= -Math.floor(nT / 2); k--) {
    const xc = (k + 0.5) * D.p;
    pts.push([xc + hw(-D.hf), yP - D.hf], [xc + hw(D.ha), yP + D.ha], [xc - hw(D.ha), yP + D.ha], [xc - hw(-D.hf), yP - D.hf]);
  }
  pts.push([-half, yP - D.hf]);
  const rk = B.part('rack', { info: 'rack', u: [0, 0, 1], e0: [1, 0, 0], label: 'Rack', labelAt: [half - 30, 0, -(yP + 10)], explode: [0, -10, 90], st: 0.1, en: 0.8 });
  B.mesh(rk, slab(new THREE.Shape(pts.map(q => new THREE.Vector2(...q))), -b2 / 2, b2, 0.5), 'gear');
  // guides: a floor 0.5 mm under the rack and cheeks 0.5 mm off its sides
  const yB = yBot - 12;
  const gd = B.part('guide', { info: 'guide', label: 'Rack guide', labelAt: [-70, yBot + 6, b2 / 2 + 10], explode: [0, -40, 0], st: 0, en: 0.6 });
  const gs = [];
  for (const x of [-72, 72]) {
    // floor 4 mm shorter and 2 mm narrower than the cheek pair: no shared faces
    const fl = new THREE.BoxGeometry(40, yBot - 0.5 - yB + 0.8, b2 + 12); fl.translate(x, (yBot - 0.5 + yB - 0.8) / 2, 0); gs.push(fl);
    for (const s of [-1, 1]) { const c = new THREE.BoxGeometry(44, yP - D.hf - 3 - yB + 0.5, 6.5); c.translate(x, (yP - D.hf - 3 + yB - 0.5) / 2, s * (b2 / 2 + 0.5 + 3.25)); gs.push(c); }
  }
  B.mesh(gd, merge(gs), 'cast');
  basePlate(B, -150, 150, -80, 46, yB, [0, -70, 0]);
  block(B, 'blk1', [0, 0, -48], [0, 0, 1], [1, 0, 0], yB, { label: 'Bearing block' });
  const zF = b1 / 2 + LIFT, toW = (X, Y) => [X, Y];
  const loa = actionLine(B, D, toW, zF, [[0, 0, D.r1 * Math.cos(D.at)]], [0, 30, 150]);
  // the rack speed arrow, above the rack's right end, scaled with |v|
  const va = B.part('vel', { info: 'vel', label: 'Rack speed', labelAt: [0, 10, 0], explode: [0, 20, 90], st: 0.2, en: 1 });
  const vm = B.mesh(va, arrow([1, 0, 0], 40, 2), 'gold', { shadow: false });
  return {
    pose(th) {
      const Q = pose(D, th);
      g1.spin(Q.a1); rk.root.position.set(Q.x, 0, 0);
      va.root.position.set(Q.x + half - 60, yP + D.ha + 14, 0);
      const v = Q.w * D.r1, s = Math.max(0.05, Math.min(1.6, Math.abs(Q.w) / (D.swing / D.slow)));
      vm.scale.set(Math.sign(v) * s || 0.05, 1, 1);
      Q.inContact = loa(Q);
      return Q;
    },
    box: { c: [0, -30, 0], R: 150 },
    keys: { mesh: [0, -D.r1, zF], g1: [0, 0, 0], g2: [0, yP, 0] },
    D,
  };
}

export function build(B, id) {
  const u = unit(id), D = derive(u);
  if (id === 'bevel') return bevel(B, u, D);
  if (id === 'worm') return worm(B, u, D);
  if (id === 'rack') return rack(B, u, D);
  return parallel(B, u, D);
}

// ============================================================================
//  UNIVERSAL & CV JOINTS  ·  scene.js — the parts of each joint and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one joint with kit.js and returns sc: { pose(th, beta,
//  phase), box, keys }. Every frame comes from mech.js solve(), so the forks,
//  crosses, balls and cage that main.js moves are the ones tests.mjs checks.
//
//  LAYOUT  (world mm, y up)
//    The input shaft lies on +x at height 0. Bends turn about +y, so every
//    shaft stays in the plane y = 0. A base plate (top at y -70) carries a
//    pillow block 150 mm out on the input and on the output shaft; the
//    blocks slide on the plate as beta changes.
//    A part frame has local Y on its shaft (or the cage normal) and local X
//    on its fork pin (or groove 0). pose() sets each frame from mech.js with
//    setFrame(); B.part's q0 follows it, so labels on the axis stay put.
//
//  Z-FIGHTING RULES
//    No two faces share a plane: a cap ends inside its boss, the fork web
//    stops 0.4 mm short of the ear faces, a shaft ends
//    inside its collar, a foot floats 0.4 mm over the plate, a bolt head
//    sinks 0.4 mm into the foot, and each bore is 0.6 mm over its shaft.
//    Rzeppa: inner race sphere 33.5, cage 36.5 .. 40, bell 42.5 .. 50, so
//    no two spheres are equal.
//
//  GREP MAP
//    function fork ............ a yoke: collar, web, two ears, pin bosses
//    function crossGeom ....... the cross (spider) with four bearing caps
//    function pedestal ........ a pillow block in its own group
//    function cardanParts ..... single and double Cardan parts; the second
//                               middle fork is a mesh of midShaft (P.yoke2)
//    function rzeppaParts ..... bell, inner race, cage, six balls
//    export function build .... base plate, parts, pose
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, poly, shell, hex, merge } from './kit.js';
import { unit, solve, axes, shaftFrame, SIZE, V, TAU, DEG } from './mech.js';

const H = 70;                 // shaft height over the base plate top
const PED = 150;              // pillow block distance from the joint
const along = (g, axis) => { if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); return g; };
const box = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };
const wrap = a => a - TAU * Math.round(a / TAU);

// ── part frames ───────────────────────────────────────────────────────────
const M4 = new THREE.Matrix4(), VX = new THREE.Vector3(), VY = new THREE.Vector3(), VZ = new THREE.Vector3();
// local X on X, local Y on Y (unit, normal), local Z = X x Y
function setFrame(p, X, Y, at) {
  VX.set(...X); VY.set(...Y); VZ.crossVectors(VX, VY);
  M4.makeBasis(VX, VY, VZ);
  p.root.quaternion.setFromRotationMatrix(M4);
  p.q0.copy(p.root.quaternion);
  p.root.position.set(...at);
}
const setExplode = (p, v) => { p.explode[0] = v[0]; p.explode[1] = v[1]; p.explode[2] = v[2]; };

// ── geometry ──────────────────────────────────────────────────────────────
// A fork in its part frame: the pin on local X at y = 0, the body toward
// sg * y (sg -1: the shaft comes from -y). y0 shifts it along the axis.
function fork(sg, y0 = 0) {
  const Y = y => y0 + sg * y, yy = (a, b) => [Math.min(Y(a), Y(b)), Math.max(Y(a), Y(b))];
  const [c0, c1] = yy(30, 46), [w0, w1] = yy(26, 32), [e0, e1] = yy(-4, 29);
  const gs = [rod(19, c0, c1, 40), box(-34.6, 34.6, w0, w1, -10, 10), box(27, 35, e0, e1, -9, 9), box(-35, -27, e0, e1, -9, 9)];
  for (const s of [1, -1]) { const g = along(rod(10, 26, 36.5, 28), 'x'); if (s < 0) g.rotateY(Math.PI); g.translate(0, y0, 0); gs.push(g); }
  return merge(gs);
}
// the cross: a hub on local Y, arms on local X and Z, a bearing cap on each
// arm. A cap (r 8) ends at 30.3, inside the fork boss (r 10, 26 .. 36.5).
function crossGeom() {
  const hub = rod(11, -11, 11, 32), arms = [], caps = [];
  // each arm pair is one rod through the hub: no end discs meet at the centre
  arms.push(along(rod(5, -SIZE.arm, SIZE.arm, 20), 'x'), along(rod(4.4, -SIZE.arm + 0.4, SIZE.arm - 0.4, 20), 'z'));
  for (const ax of ['x', 'z']) for (const s of [1, -1]) {
    const c = along(tube(5.6, 8, 18, 30.3, 28), ax);
    if (s < 0) c.rotateY(Math.PI);
    caps.push(c);
  }
  return { body: merge([hub, ...arms]), caps: merge(caps) };
}
// a pillow block in a group: local X along the shaft, the shaft at y = 0
function pedestal(B, base) {
  const g = new THREE.Group();
  base.root.add(g);
  B.mesh(base, along(tube(10.6, 21, -13, 13, 40), 'x'), 'cast', { parent: g });
  B.mesh(base, box(-10, 10, -H + 11.4, -12, -15, 15), 'cast', { parent: g });
  B.mesh(base, box(-24, 24, -H + 0.4, -H + 12, -30, 30), 'cast', { parent: g });
  for (const z of [-21, 21]) { const h = hex(5, -H + 11.6, 4.4); h.translate(0, 0, z); B.mesh(base, h, 'bolt', { parent: g }); }
  return g;
}
const placePed = (g, at, s) => { g.position.set(at[0], 0, at[2]); g.rotation.set(0, Math.atan2(-s[2], s[0]), 0); };

// ── Cardan ────────────────────────────────────────────────────────────────
function cardanParts(B, id) {
  const P = {}, dbl = id !== 'cardan', L = SIZE.L;
  P.inYoke = B.part('inYoke', { info: 'inYoke', label: 'Input shaft and yoke', labelAt: [0, -120, 0], explode: [0, 0, 0], st: 0, en: 0.7 });
  B.mesh(P.inYoke, fork(-1), 'brass'); B.mesh(P.inYoke, rod(10, -L, -40, 32), 'shaft');
  const X = crossGeom();
  P.cross1 = B.part('cross1', { info: 'cross', label: 'Cross (spider)', labelAt: [0, 0, 0], explode: [0, 70, 0], st: 0.2, en: 0.9 });
  B.mesh(P.cross1, X.body, 'gear'); B.mesh(P.cross1, X.caps, 'bolt');
  if (dbl) {
    const Lm = SIZE.Lm;
    P.midShaft = B.part('midShaft', { info: 'midShaft', label: 'Intermediate shaft', labelAt: [0, Lm / 2, 0], explode: [0, 0, 0], st: 0, en: 0.6 });
    B.mesh(P.midShaft, fork(1), 'bronze'); B.mesh(P.midShaft, rod(10, 40, Lm - 40, 32), 'shaft');
    // The second fork is welded to the intermediate shaft, so it is a mesh
    // of the same part. A group turns it 90 deg about the shaft when the
    // forks are out of phase (mech.js: a2 = sm x b1 = -Z in this frame).
    P.yoke2 = new THREE.Group();
    P.midShaft.root.add(P.yoke2);
    B.mesh(P.midShaft, fork(-1, Lm), 'bronze', { parent: P.yoke2 });
    const X2 = crossGeom();
    P.cross2 = B.part('cross2', { info: 'cross', label: null, labelAt: [0, 0, 0], explode: [0, 70, 0], st: 0.25, en: 0.95 });
    B.mesh(P.cross2, X2.body, 'gear'); B.mesh(P.cross2, X2.caps, 'bolt');
  }
  P.outYoke = B.part('outYoke', { info: 'outYoke', label: 'Output shaft and yoke', labelAt: [0, 120, 0], explode: [0, 0, 0], st: 0.1, en: 0.8 });
  B.mesh(P.outYoke, fork(1), 'steel'); B.mesh(P.outYoke, rod(10, 40, L, 32), 'shaft');
  return P;
}

// ── Rzeppa ────────────────────────────────────────────────────────────────
const WIN = Math.asin(7.4 / SIZE.rp) + 3 * DEG;   // cage window half width
function sphereZone(R, y0, y1, n = 24) {
  const pts = []; for (let i = 0; i < n; i++) { const y = y0 + (y1 - y0) * i / n; pts.push([Math.sqrt(R * R - y * y), y]); }
  return lathe([pts, [[Math.sqrt(R * R - y1 * y1), y1], [0, y1]], [[0, y0]]], 72);
}
function rzeppaParts(B) {
  const P = {}, L = SIZE.L;
  P.bell = B.part('bell', { info: 'bell', label: 'Outer race (bell)', labelAt: [0, -110, 0], explode: [0, 0, 0], st: 0, en: 0.7 });
  const rows = [];
  for (let i = 0; i <= 26; i++) { const y = -28 + 52 * i / 26; rows.push({ y, ro: Math.sqrt(50 * 50 - y * y), ri: Math.sqrt(42.5 * 42.5 - y * y) }); }
  // six cut-away windows over the grooves, so the balls show
  const bellHole = (y, f) => y > -21 && y < 20 && Math.abs(wrap(f - Math.round(f / (TAU / 6)) * TAU / 6)) < 12 * DEG;
  B.mesh(P.bell, shell(rows, 180, bellHole), 'gear');
  B.mesh(P.bell, poly([[14, -60], [34, -46], [34, -27.4], [0, -27.4], [0, -60]], 64), 'gear');
  B.mesh(P.bell, rod(12, -L, -58, 32), 'shaft');
  P.inner = B.part('inner', { info: 'inner', label: 'Inner race and output shaft', labelAt: [0, 110, 0], explode: [0, 0, 0], st: 0.1, en: 0.8 });
  B.mesh(P.inner, sphereZone(33.5, -15, 15), 'steel');
  B.mesh(P.inner, rod(12, 10, L, 32), 'shaft');
  P.cage = B.part('cage', { info: 'cage', label: 'Ball cage', labelAt: [0, 0, 0], explode: [0, 80, 0], st: 0.2, en: 0.9 });
  const cr = [];
  for (let i = 0; i <= 14; i++) { const y = -10.5 + 21 * i / 14; cr.push({ y, ro: Math.sqrt(40 * 40 - y * y), ri: Math.sqrt(36.5 * 36.5 - y * y) }); }
  const cageHole = (y, f) => Math.abs(y) < 7.4 && Math.abs(wrap(f - Math.round(f / (TAU / 6)) * TAU / 6)) < WIN;
  B.mesh(P.cage, shell(cr, 240, cageHole), 'brass');
  P.balls = [];
  for (let k = 0; k < 6; k++) {
    const b = B.part('ball' + k, { info: 'ball', label: k ? null : 'Balls', labelAt: [0, 0, 0], explode: [0, 80, 0], st: 0.25, en: 0.95 });
    B.mesh(b, new THREE.SphereGeometry(SIZE.rb, 28, 18), 'ring');
    P.balls.push(b);
  }
  return P;
}

// ── build ─────────────────────────────────────────────────────────────────
export function build(B, id) {
  const u = unit(id), rz = id === 'rzeppa', L = SIZE.L;
  // plate bounds over beta 0 .. betaMax: shaft ends and pillow blocks
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let b = 0; b <= SIZE.betaMax + 1e-9; b += SIZE.betaMax / 8) {
    const A = axes(id, b);
    for (const p of [V.mul(A.s1, -L), V.add(A.Jout, V.mul(A.sOut, L)), A.J1, A.Jout]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  }
  const m = 40;
  const base = B.part('base', { info: 'base', label: 'Base plate', labelAt: [x1 - 20, -H, z1 + m - 10], explode: [0, -70, 0], st: 0, en: 0.5 });
  const bs = new THREE.Shape([[x0 - m, z0 - m], [x1 + m, z0 - m], [x1 + m, z1 + m], [x0 - m, z1 + m]].map(p => new THREE.Vector2(p[0], -p[1])));
  B.mesh(base, slab(bs, -H - 12, 12, 1.2), 'paint');
  const pIn = pedestal(B, base), pOut = pedestal(B, base);

  const P = rz ? rzeppaParts(B) : cardanParts(B, id);
  // index fins: one on the input shaft, one on the output shaft
  const fin = (key, sg) => { const p = B.part(key, { info: 'fin', label: sg < 0 ? 'Index fins' : null, labelAt: [0, sg * 100, 0], explode: [0, 0, 0], st: 0.3, en: 1 }); B.mesh(p, box(9.4, 17, sg * 100 - 7, sg * 100 + 7, -1.6, 1.6), 'red'); return p; };
  const fIn = fin('finIn', -1), fOut = fin('finOut', 1);

  let last = null;
  const sc = {
    pose(th, beta = 25 * DEG, phase = 0) {
      const Q = solve(id, th, beta, phase), A = Q.A, F = Q.frames;
      const Fi = shaftFrame(A.s1), Fo = shaftFrame(A.sOut);
      const dir = (Fr, a) => V.add(V.mul(Fr.e, Math.cos(a)), V.mul(Fr.f, Math.sin(a)));
      if (rz) {
        setFrame(P.bell, F.bell.X, F.bell.Y, F.bell.at);
        setFrame(P.inner, F.inner.X, F.inner.Y, F.inner.at);
        setFrame(P.cage, F.cage.X, F.cage.Y, F.cage.at);
        Q.balls.forEach((p, k) => { P.balls[k].root.position.set(...p); const d = V.norm(p); setExplode(P.balls[k], [d[0] * 30, 80 + d[1] * 30, d[2] * 30]); });
        setExplode(P.bell, V.mul(A.s1, -70)); setExplode(P.inner, V.mul(A.sOut, 80));
      } else {
        setFrame(P.inYoke, F.inYoke.X, F.inYoke.Y, F.inYoke.at);
        setFrame(P.cross1, F.cross1.X, V.cross(F.cross1.Z, F.cross1.X), F.cross1.at);
        setFrame(P.outYoke, F.outYoke.X, F.outYoke.Y, F.outYoke.at);
        setExplode(P.inYoke, V.mul(A.s1, -90)); setExplode(P.outYoke, V.mul(A.sOut, 90));
        if (P.midShaft) {
          setFrame(P.midShaft, F.midShaft.X, F.midShaft.Y, F.midShaft.at);
          P.yoke2.rotation.set(0, phase ? Math.PI / 2 : 0, 0);
          setFrame(P.cross2, F.cross2.X, V.cross(F.cross2.Z, F.cross2.X), F.cross2.at);
        }
      }
      setFrame(fIn, dir(Fi, th), A.s1, A.J1);
      setFrame(fOut, dir(Fo, Q.out), A.sOut, A.Jout);
      setExplode(fIn, V.mul(A.s1, -90)); setExplode(fOut, V.mul(A.sOut, 90));
      placePed(pIn, V.mul(A.s1, -PED), A.s1);
      placePed(pOut, V.add(A.Jout, V.mul(A.sOut, PED)), A.sOut);
      last = Q;
      return Q;
    },
    // the camera frames the shafts at beta 25 deg; the plate covers 0 .. 40
    box: (() => { const A = axes(id, 25 * DEG), a = V.mul(A.s1, -L), b = V.add(A.Jout, V.mul(A.sOut, L)); return { c: [(a[0] + b[0]) / 2, -18, (a[2] + b[2]) / 2], R: 0.55 * Math.hypot(b[0] - a[0] + 2 * m, b[2] - a[2] + 2 * m, 2 * H) }; })(),
    keys: { joint: [0, 0, 0], out: [0, 0, 0] },
    last: () => last,
    u,
  };
  // the close view looks at the working joint(s): the centre between them
  if (!rz && id !== 'cardan') { const A = axes(id, 25 * DEG); sc.keys.joint = V.mul(A.J2, 0.5); }
  return sc;
}

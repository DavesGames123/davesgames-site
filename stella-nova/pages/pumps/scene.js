// ============================================================================
//  PUMPS  ·  scene.js — the parts of one pump and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one pump with kit.js and returns sc: { pose(th), box,
//  keys }. The gear teeth, the Roots lobes, the vane reach, the casing arcs
//  and the pocket states come from mech.js, so the parts that main.js
//  moves are the ones that tests.mjs checks.
//
//  LAYOUT. Parts are made in the pump plane: the mech.js point (X, Y) at
//  height h is (X, h, -Y) in the B.root frame. B.root turns +90 deg about
//  x, so the pump stands upright: Y is up and h comes toward the viewer
//  (world z). The face of the pump is open, so the pockets show.
//    floor ............ a plate under everything; the back plate stands on it
//    back plate ....... h -12 .. 0 (vane pump: two kidney ports cut in it)
//    casing / ring .... h 0 .. b + 0.6, bores 0.3 mm over the tip radius
//    rotors ........... h 0.3 .. b + 0.3 (vanes 0.6 .. b, 0.3 mm in their slots)
//    pockets .......... flat fluid decals at h 0.45 (rotor B: 0.8), polygon
//                       offset
//    drive shaft ...... from inside the drive rotor to h b + 50, coupling
//    pipes ............ inlet down into the floor, outlet up; a flange 0.4 mm
//                       off the casing; a dark disc closes each bore
//  BEVELS. kit.js slab() pushes the side walls out by the bevel. Each slab
//  here draws its outline the bevel smaller (offsetIn) and its holes the
//  bevel larger, so the walls are at the mech.js sizes.
//  No two faces of different parts lie in one plane and face the same way:
//  each stack has a 0.3 mm or larger step. node tools/zfight-check.mjs
//  pumps checks it (the pocket decals have a polygon offset and are not
//  counted).
//
//  GREP MAP
//    function offsetIn ........ move a closed outline inward by d
//    function casingHalves .... the two halves of a figure-8 casing
//    function pipes ........... inlet and outlet pipes with flanges
//    function gearPump / vanePump / rootsPump   the three builds
//    export function build .... floor, back plate, the pump, pose
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, hex } from './kit.js';
import { unit, TAU, gearDims, gearOutline, rho, vanePorts, rootsOutline, dims, pumpPose } from './mech.js';

// a mech.js point list as a THREE.Shape / THREE.Path
const shapeOf = (pts, holes = []) => { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); for (const h of holes) s.holes.push(h); return s; };
const pathOf = pts => new THREE.Path(pts.map(p => new THREE.Vector2(p[0], p[1])));
const ring = (r, cx = 0, cy = 0, n = 128) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(TAU * i / n), cy + r * Math.sin(TAU * i / n)]);
const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// the point (X, Y, h) of the pump plane in the B.root frame
const L = (x, y, h) => [x, h, -y];
// a box from world ranges: x, y (up), h (toward the viewer)
const box = (x0, x1, y0, y1, h0, h1) => { const g = new THREE.BoxGeometry(x1 - x0, h1 - h0, y1 - y0); g.translate((x0 + x1) / 2, (h0 + h1) / 2, -(y0 + y1) / 2); return g; };
// a geometry made about local Y, turned to run on world y (up)
const upY = g => { g.rotateX(-Math.PI / 2); return g; };

// move a closed counter-clockwise outline inward by d (vertex normals)
function offsetIn(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(...m) || 1; m = [m[0] / ml, m[1] / ml];
    const k = d / Math.max(0.5, m[0] * n2[0] + m[1] * n2[1]);
    out.push([p[0] + m[0] * k, p[1] + m[1] * k]);
  }
  return out;
}

// the two halves of a figure-8 casing: bores of drawn radius Rd at (+-cx,
// 0), a port channel |x| < w at the top and the bottom, outer half sizes
// X, Y. Each half runs round its own bore.
function casingHalves(cx, Rd, w, X, Y) {
  const yc = Math.sqrt(Rd * Rd - (cx - w) ** 2), a0 = Math.atan2(yc, cx - w), left = [[-w, Y], [-X, Y], [-X, -Y], [-w, -Y]];
  // the bore arc round the outer side, from (-w, -yc) to (-w, yc)
  for (let i = 0; i <= 96; i++) { const a = -a0 - (TAU - 2 * a0) * i / 96; left.push([-cx + Rd * Math.cos(a), Rd * Math.sin(a)]); }
  const right = left.map(p => [-p[0], p[1]]).reverse();
  return [left, right];
}

// pipes: inlet down from y0 to the floor, outlet up from y1 by len. ri,
// ro: the bore and the wall; x, h: the pipe axis; flange at the casing
// face fy (0.4 mm off it), a dark disc in each bore.
function pipes(B, o) {
  const { x, h, ri, ro, yIn, yOut, floor, len, sink } = o;
  const inlet = B.part('inlet', { info: 'inlet', label: 'Inlet', labelAt: L(x + ro + 8, (yIn + floor) / 2, h), explode: L(0, -40, 0), st: 0.3, en: 0.9 });
  let g = upY(tube(ri, ro, floor - 6, yIn + sink, 48)); g.translate(x, h, 0); B.mesh(inlet, g, 'spring');
  g = upY(tube(ro - 0.5, ro + 7, yIn - 6, yIn - 0.4, 48)); g.translate(x, h, 0); B.mesh(inlet, g, 'spring');
  g = upY(rod(ri - 0.3, yIn - 14, yIn - 12, 32)); g.translate(x, h, 0); B.mesh(inlet, g, 'ink');
  const outlet = B.part('outlet', { info: 'outlet', label: 'Outlet', labelAt: L(x + ro + 8, yOut + len - 6, h), explode: L(0, 40, 0), st: 0.3, en: 0.9 });
  g = upY(tube(ri, ro, yOut - sink, yOut + len, 48)); g.translate(x, h, 0); B.mesh(outlet, g, 'red');
  g = upY(tube(ro - 0.5, ro + 7, yOut + 0.4, yOut + 6, 48)); g.translate(x, h, 0); B.mesh(outlet, g, 'red');
  g = upY(tube(ro - 0.5, ro + 6, yOut + len - 5, yOut + len + 0.6, 48)); g.translate(x, h, 0); B.mesh(outlet, g, 'red');
  g = upY(rod(ri - 0.3, yOut + 12, yOut + 14, 32)); g.translate(x, h, 0); B.mesh(outlet, g, 'ink');
  return { inlet, outlet };
}

// a drive shaft on the drive rotor, from h0 to h1, with a coupling disc
function driveShaft(B, at, r, h0, h1) {
  const s = B.part('shaft', { info: 'shaft', label: 'Drive shaft', labelAt: [0, h1 + 4, 0], at, explode: [0, 90, 0], st: 0.1, en: 0.7 });
  B.mesh(s, rod(r, h0, h1 - 4, 40), 'shaft');
  B.mesh(s, rod(r + 7, h1 - 8, h1, 64), 'bronze');
  for (let k = 0; k < 4; k++) { const a = TAU * k / 4 + Math.PI / 4, g = hex(2.6, h1 - 0.3, 3); g.translate((r + 3.8) * Math.cos(a), 0, -(r + 3.8) * Math.sin(a)); B.mesh(s, g, 'bolt'); }
  return s;
}

// a flat pocket decal (mech points) at h 0.45
// a pocket decal takes no shadow: it lies at the base of a deep cavity.
// The decals of rotor A lie at h 0.45, those of rotor B at h 0.8: near the
// mesh a pocket of each rotor reaches into the other bore, and two decals
// in one plane would fight.
const flat = m => { m.receiveShadow = false; return m.material; };
function decal(pts, h = 0.45) {
  const g = new THREE.ShapeGeometry(shapeOf(pts));
  g.rotateX(-Math.PI / 2); g.translate(0, h, 0);
  return g;
}
const POCKET = { inlet: 0x3d7fd9, sealed: 0xe2a63a, outlet: 0xd8553a };
function paint(m, state) {
  if (m.userData.state === state) return;
  m.userData.state = state;
  const c = new THREE.Color(POCKET[state]);
  m.color.copy(c); m.emissive.copy(c).multiplyScalar(0.55);
  m.userData.baseEmissive = m.emissive.clone();
}

// ── external gear pump ──────────────────────────────────────────────────────
function gearPump(B, u) {
  const G = gearDims(u), b = u.b, X = 62, Y = 42, w = u.port;
  const casing = B.part('casing', { info: 'casing', label: 'Casing', labelAt: L(-X + 8, Y + 4, b), explode: L(0, 0, 18), st: 0, en: 0.6 });
  for (const half of casingHalves(G.r, G.Rc + 0.4, w, X - 0.4, Y - 0.4)) B.mesh(casing, slab(shapeOf(half), 0, b + 0.6, 0.4), 'cast');
  for (const [x, y] of [[-54, 34], [54, 34], [-54, -34], [54, -34]]) { const g = hex(4.5, b + 0.6, 4); g.translate(x, 0, -y); B.mesh(casing, g, 'bolt'); }
  // gears: the tooth outline 0.15 mm in, a 0.15 mm bevel back out
  const NI = 14, NA = 4, per = 2 * NA + 2 * NI + 6, ol = gearOutline(u, NI, NA);
  const gearGeo = () => slab(shapeOf(offsetIn(ol, 0.15)), 0.3, b, 0.15);
  const A = B.part('gearA', { info: 'driveGear', label: 'Drive gear', labelAt: [0, b + 4, 0], at: L(G.r, 0, 0), explode: [0, 45, 0], st: 0.15, en: 0.75 });
  const Bg = B.part('gearB', { info: 'idlerGear', label: 'Idler gear', labelAt: [0, b + 4, 0], at: L(-G.r, 0, 0), explode: [0, 45, 0], st: 0.15, en: 0.75 });
  B.mesh(A, gearGeo(), 'steel'); B.mesh(Bg, gearGeo(), 'steel');
  const boss = B.part('boss', { info: 'idlerGear', at: L(-G.r, 0, 0), explode: [0, 60, 0], st: 0.15, en: 0.75 });
  B.mesh(boss, rod(9, b - 2, b + 8, 40), 'shaft'); B.mesh(boss, rod(10.5, b + 8, b + 10.5, 40), 'bolt');
  const shaft = driveShaft(B, L(G.r, 0, 0), 9, b - 2, b + 40);
  // pockets: tooth tip k to tip k + 1, out to Ra + 0.15
  const pockets = {};
  for (const [side, part] of [['A', A], ['B', Bg]]) for (let k = 0; k < u.Z; k++) {
    const i0 = per * k + NA + 1 + NI + NA / 2, inner = [];
    for (let i = 0; i <= per; i++) inner.push(ol[(i0 + i) % ol.length]);
    const a0 = TAU * k / u.Z, a1 = a0 + TAU / u.Z, outer = [];
    for (let i = 0; i <= 8; i++) { const a = a1 - (a1 - a0) * i / 8; outer.push([(G.Ra + 0.15) * Math.cos(a), (G.Ra + 0.15) * Math.sin(a)]); }
    const p = B.part('pocket' + side + k, { info: 'pocket', label: side === 'A' && k === 0 ? 'Fluid pocket' : null, labelAt: [G.Ra * Math.cos(a0 + 0.26), 1, -G.Ra * Math.sin(a0 + 0.26)], parent: part.root, explode: [0, 0, 0], st: 0, en: 1 });
    pockets[side + k] = flat(B.mesh(p, decal([...inner, ...outer], side === 'A' ? 0.45 : 0.8), 'fluid', { shadow: false }));
  }
  pipes(B, { x: 0, h: (b + 0.6) / 2, ri: 9, ro: 11.5, yIn: -Y, yOut: Y, floor: -Y - 40, len: 40, sink: 6 });
  return {
    X: X + 10, yTop: Y + 10, floor: -Y - 40, b,
    pose(th) {
      const P = pumpPose(u, th);
      A.spin(th + G.phA); Bg.spin(-th + G.phB); shaft.spin(th + G.phA); boss.spin(-th + G.phB);
      for (const q of P.pockets) paint(pockets[q.side + q.k], q.state);
      return P;
    },
    keys: { mesh: [0, 0, b], pocket: [G.r + G.Ra, 0, b] },
  };
}

// ── sliding-vane pump ───────────────────────────────────────────────────────
function vanePump(B, u) {
  const b = u.b, n = u.n, be = TAU / n, Rout = u.R + 10, VB = 0.2;
  const cam = B.part('ring', { info: 'ring', label: 'Cam ring', labelAt: L(u.e - Rout + 6, Rout - 4, b + 0.6), explode: L(0, 0, 18), st: 0, en: 0.6 });
  B.mesh(cam, slab(shapeOf(ring(Rout - 0.4, u.e, 0), [pathOf(ring(u.R + 0.4, u.e, 0, 192))]), 0, b + 0.6, 0.4), 'cast');
  for (let k = 0; k < 6; k++) { const a = TAU * k / 6 + Math.PI / 6, g = hex(4.5, b + 0.6, 4); g.translate(u.e + (u.R + 5) * Math.cos(a), 0, -(u.R + 5) * Math.sin(a)); B.mesh(cam, g, 'bolt'); }
  // rotor: a disc with n radial slots t + 0.6 wide (0.3 mm each side)
  const rotor = B.part('rotor', { info: 'rotor', label: 'Rotor', labelAt: [0, b + 4, 0], at: L(0, 0, 0), explode: [0, 40, 0], st: 0.15, en: 0.75 });
  const bev = 0.3, ro = u.r - bev, w = (u.t + 0.6) / 2 + bev, din = u.r - u.vaneL - 1 + bev, out = [];
  for (let i = 0; i < n; i++) {
    const a = be * i, ca = Math.cos(a), sa = Math.sin(a), P = (d, s) => [d * ca - s * w * sa, d * sa + s * w * ca], dOut = Math.sqrt(ro * ro - w * w);
    out.push(P(dOut, -1), P(din, -1), P(din, 1), P(dOut, 1));
    const aN = be * (i + 1) - Math.asin(w / ro), a1 = a + Math.asin(w / ro);
    for (let k = 1; k < 10; k++) { const f = a1 + (aN - a1) * k / 10; out.push([ro * Math.cos(f), ro * Math.sin(f)]); }
  }
  B.mesh(rotor, slab(shapeOf(out), 0.3, b, bev), 'gear');
  const vanes = [];
  for (let i = 0; i < n; i++) {
    const p = B.part('vane' + i, { info: 'vane', label: i === 0 ? 'Vane' : null, labelAt: [u.R, b, 0], at: L(0, 0, 0), explode: [0, 70, 0], st: 0.25, en: 0.85 });
    const m = B.mesh(p, slab(shapeOf(rect(VB, u.vaneL - VB, -u.t / 2 + VB, u.t / 2 - VB)), 0.6, b - 0.6, VB), 'bronze');
    vanes.push({ p, m });
  }
  const shaft = driveShaft(B, L(0, 0, 0), 10, b - 2, b + 40);
  // chamber decals: n strips from the rotor (r) to the ring (rho), rebuilt
  // each frame from the vane angles
  const M = 18, chambers = [];
  for (let i = 0; i < n; i++) {
    const p = B.part('chamber' + i, { info: 'pocket', label: i === 0 ? 'Fluid pocket' : null, labelAt: L(0, u.R, 1), explode: [0, 0, 0], st: 0, en: 1 });
    const g = new THREE.BufferGeometry(), pos = new Float32Array((M + 1) * 2 * 3), idx = [];
    for (let k = 0; k < M; k++) { const a = 2 * k, c = 2 * k + 1, d = 2 * k + 2, e = 2 * k + 3; idx.push(a, d, c, c, d, e); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const nrm = new Float32Array(pos.length); for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const m = B.mesh(p, g, 'fluid', { shadow: false }); m.receiveShadow = false;
    chambers.push({ g, pos, m, p });
  }
  // back plate kidney ports from r - 8 (under the rotor) to rho - 1, drawn
  // 0.6 out for the bevel; near the lands rho - r is under 1 mm
  const P = vanePorts(u), kid = (a0, a1) => {
    const pts = [], r0 = u.r - 8 - 0.6;
    for (let i = 0; i <= 40; i++) { const f = a0 + (a1 - a0) * i / 40, rr = Math.max(rho(u, f) - 1 + 0.6, r0 + 3); pts.push([rr * Math.cos(f), rr * Math.sin(f)]); }
    for (let i = 40; i >= 0; i--) { const f = a0 + (a1 - a0) * i / 40; pts.push([r0 * Math.cos(f), r0 * Math.sin(f)]); }
    return pathOf(pts);
  };
  // the manifold behind the back plate, seen through the kidneys
  const block = B.part('block', { info: 'block', label: 'Port manifold', labelAt: L(48, -30, -28), explode: L(0, 0, -40), st: 0.3, en: 0.9 });
  B.mesh(block, box(-36, 48, -48, 48, -44, -12.4), 'cast');
  pipes(B, { x: 6, h: -28, ri: 9, ro: 12, yIn: -48, yOut: 48, floor: -u.R - 10 - 30, len: 34, sink: 8 });
  return {
    X: 70, xL: -60, yTop: Rout + 10, floor: -u.R - 10 - 30, b, holes: [kid(P.out[0], P.out[1]), kid(P.in[0], P.in[1])],
    pose(th) {
      const Q = pumpPose(u, th);
      rotor.spin(th); shaft.spin(th);
      for (let i = 0; i < n; i++) { const v = Q.vanes[i]; vanes[i].p.spin(v.f); vanes[i].m.position.x = v.rho - 0.3 - u.vaneL; }
      for (let i = 0; i < n; i++) {
        const C = chambers[i], f0 = Q.vanes[i].f;
        for (let k = 0; k <= M; k++) {
          const f = f0 + be * k / M, c = Math.cos(f), s = Math.sin(f), R1 = rho(u, f);
          C.pos.set([u.r * c, 0.45, -u.r * s, R1 * c, 0.45, -R1 * s], 6 * k);
        }
        C.g.attributes.position.needsUpdate = true; C.g.computeBoundingSphere(); C.g.computeBoundingBox();
        paint(C.m.material, Q.chambers[i].state === 'both' ? 'outlet' : Q.chambers[i].state);
      }
      return Q;
    },
    keys: { mesh: [0, 0, b], pocket: [0, u.R, b] },
  };
}

// ── Roots blower ────────────────────────────────────────────────────────────
function rootsPump(B, u) {
  const d = dims(u), b = u.b, X = 84, Y = 56, w = u.port, NA = 64, ol = rootsOutline(u, NA);
  const casing = B.part('casing', { info: 'casing', label: 'Casing', labelAt: L(-X + 8, Y + 4, b), explode: L(0, 0, 18), st: 0, en: 0.6 });
  for (const half of casingHalves(u.r, d.Rc + 0.4, w, X - 0.4, Y - 0.4)) B.mesh(casing, slab(shapeOf(half), 0, b + 0.6, 0.4), 'cast');
  for (const [x, y] of [[-76, 48], [76, 48], [-76, -48], [76, -48], [-76, 0], [76, 0]]) { const g = hex(5, b + 0.6, 4.5); g.translate(x, 0, -y); B.mesh(casing, g, 'bolt'); }
  const rotorGeo = () => slab(shapeOf(offsetIn(ol, 0.2)), 0.3, b, 0.2);
  const A = B.part('rotorA', { info: 'rotorA', label: 'Drive rotor', labelAt: [0, b + 4, 0], at: L(u.r, 0, 0), explode: [0, 55, 0], st: 0.15, en: 0.75 });
  const Bg = B.part('rotorB', { info: 'rotorB', label: 'Driven rotor', labelAt: [0, b + 4, 0], at: L(-u.r, 0, 0), explode: [0, 55, 0], st: 0.15, en: 0.75 });
  B.mesh(A, rotorGeo(), 'alu'); B.mesh(Bg, rotorGeo(), 'alu');
  const boss = B.part('boss', { info: 'rotorB', at: L(-u.r, 0, 0), explode: [0, 70, 0], st: 0.15, en: 0.75 });
  B.mesh(boss, rod(10, b - 2, b + 8, 40), 'shaft'); B.mesh(boss, rod(11.5, b + 8, b + 10.5, 40), 'bolt');
  const shaft = driveShaft(B, L(u.r, 0, 0), 11, b - 2, b + 44);
  const pockets = {};
  for (const [side, part] of [['A', A], ['B', Bg]]) for (let k = 0; k < 2; k++) {
    const inner = [];
    for (let i = 0; i <= 2 * NA; i++) inner.push(ol[(2 * NA * k + i) % ol.length]);
    const a0 = Math.PI * k, outer = [];
    for (let i = 1; i < 32; i++) { const a = a0 + Math.PI - Math.PI * i / 32; outer.push([(d.Ra + 0.15) * Math.cos(a), (d.Ra + 0.15) * Math.sin(a)]); }
    const p = B.part('pocket' + side + k, { info: 'pocket', label: side === 'A' && k === 0 ? 'Fluid pocket' : null, labelAt: [0, 1, -d.Ra], parent: part.root, explode: [0, 0, 0], st: 0, en: 1 });
    pockets[side + k] = flat(B.mesh(p, decal([...inner, ...outer], side === 'A' ? 0.45 : 0.8), 'fluid', { shadow: false }));
  }
  pipes(B, { x: 0, h: (b + 0.6) / 2, ri: 15, ro: 18.5, yIn: -Y, yOut: Y, floor: -Y - 40, len: 40, sink: 6 });
  return {
    X: X + 10, yTop: Y + 10, floor: -Y - 40, b,
    pose(th) {
      const P = pumpPose(u, th);
      A.spin(Math.PI + th); Bg.spin(-Math.PI / 2 - th); shaft.spin(Math.PI + th); boss.spin(-Math.PI / 2 - th);
      for (const q of P.pockets) paint(pockets[q.side + q.k], q.state);
      return P;
    },
    keys: { mesh: [0, 0, b], pocket: [u.r + d.Ra, 0, b] },
  };
}

export function build(B, id) {
  const u = unit(id);
  B.root.rotation.x = Math.PI / 2;
  const pump = id === 'gear' ? gearPump(B, u) : id === 'vane' ? vanePump(B, u) : rootsPump(B, u);
  const x0 = pump.xL ?? -pump.X, x1 = pump.X, yF = pump.floor, yT = pump.yTop;
  // back plate and floor: the plate stands on the floor, 1.2 mm into it
  const base = B.part('base', { info: 'base', label: 'Back plate', labelAt: L(x1 - 20, yT - 6, 0), explode: L(0, 0, -30), st: 0, en: 0.5 });
  B.mesh(base, slab(shapeOf(rect(x0 + 0.6, x1 - 0.6, yF - 1.2, yT - 0.6), pump.holes || []), -12, 12, 0.6), 'paint');
  B.mesh(base, box(x0 - 16, x1 + 16, yF - 12, yF, -56, pump.b + 44), 'cast');
  const h1 = pump.b + 44;
  return {
    pose: th => pump.pose(th),
    box: { c: [(x0 + x1) / 2, (yF + yT + 30) / 2, pump.b / 2], R: 0.46 * Math.hypot(x1 - x0 + 32, yT + 40 - yF, h1 + 56) },
    keys: pump.keys,
  };
}

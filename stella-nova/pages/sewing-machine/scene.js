// ============================================================================
//  LOCKSTITCH SEWING MACHINE  ·  scene.js — the 3D parts and their pose
// ----------------------------------------------------------------------------
//  build(B) makes the machine with kit.js and returns sc: { pose(th, L,
//  travel), box, keys }. Every moving point comes from mech.js, so the
//  parts that main.js moves are the ones that tests.mjs checks.
//
//  LAYOUT  (world mm, the mech.js frame: x along the arm, y up, z to the
//  operator, y = 0 the top of the needle plate, the needle at x = XN)
//    casting ......... a cutaway: the bed, one back wall, the top cover and
//                      the pillar wall. The front is open.
//    head ............ the crank disc, the needle bar link, the take-up
//                      lever and its link, the needle bar and the presser
//                      bar, all in planes x = XN .. XN + 19
//    upper drive ..... the main shaft at y = H, the handwheel, a 1:1 belt
//                      in the pillar to the lower shaft at y = -38
//    under the bed ... a 2:1 gear pair to the hook shaft at y = HY; the
//                      rotary hook and the bobbin case; two eccentrics and
//                      the feed bar with the feed dog
//    thread .......... cylinders between the mech.js thread points; the
//                      stitches are marks on the cloth
//
//  Z-FIGHTING. No two faces of different parts share a plane where they
//  overlap: the plate sits 0.4 mm above the bed, the cloth 0.35 mm above
//  the plate, the foot sole 1.05 mm above the cloth. The cover overhangs
//  the walls by 1 mm. The hook cup starts 0.4 mm behind its beak, the
//  small gear is 1 mm thinner than the big gear. The stitch marks lie
//  0.3 mm above the cloth with a decal material (kit.js). The thread
//  passes 0.95 mm in front of and behind the needle axis (needle r 0.5,
//  thread r 0.4), and the bobbin thread ends 0.85 mm from the needle
//  thread. Check: node tools/zfight-check.mjs sewing-machine.
//
//  GREP MAP
//    function bar ............. a link: a slot-ended bar with two holes
//    function gearShape ....... a spur gear outline
//    function casting ......... bed, walls, cover, bushings, studs
//    export function build .... every part, then pose()
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, poly, circle, merge } from './kit.js';
import { M, pose as mpose, thC } from './mech.js';

const XN = M.XN, H = M.H, LOW = -38;
// the eccentric straps: eccentric centre to the feed bar pin (about)
const STRAP = Math.hypot(-5.2 - LOW, 11);
const XAX = { u: [1, 0, 0], e0: [0, 1, 0] };   // parts that turn about x
const Yv = new THREE.Vector3(0, 1, 0);

// a bar along local X from 0 to len, width w, two holes; made in the (y, z)
// plane of an x-axis part, x from x0 to x0 + h
function bar(len, w, x0, h, holes = [[0, 0], [len, 0]], hr = 3.6) {
  const r = w / 2, s = new THREE.Shape();
  s.moveTo(0, -r); s.lineTo(len, -r); s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false); s.lineTo(0, r); s.absarc(0, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);
  for (const [x, y] of holes) s.holes.push(circle(hr, x, y));
  return slab(s, x0, h, 0.4);
}
// a box from two corners
function box(x0, x1, y0, y1, z0, z1) { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; }
// a flat outline in (x, y) extruded along z from z0 to z0 + h
function wallZ(pts, z0, h, holes = []) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(...p)));
  for (const h0 of holes) s.holes.push(h0);
  return slab(s, z0, h, 0.6).rotateX(Math.PI / 2);
}
// spur gear outline, pitch radius R, N teeth, a tooth at local angle 0
export function gearShape(R, N, hub = 3.2, phase = 0) {
  const s = new THREE.Shape(), m = 2 * R / N, ra = R + 0.8 * m, rf = R - 1.0 * m, P = [];
  for (let k = 0; k < N; k++) {
    const c = k / N * Math.PI * 2 + phase, w = Math.PI / N;
    for (const [a, r] of [[-0.5 * w - 0.25 * w, rf], [-0.25 * w, ra], [0.25 * w, ra], [0.5 * w + 0.25 * w, rf]]) P.push([r * Math.cos(c + a), r * Math.sin(c + a)]);
  }
  P.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  s.holes.push(circle(hub));
  return s;
}
// a cylinder of length 1 along +Y from 0, for the thread segments
const unitRod = (r, seg = 8) => { const g = new THREE.CylinderGeometry(r, r, 1, seg, 1, true); g.translate(0, 0.5, 0); return g; };

function casting(B) {
  const p = B.part('base', { info: 'base', label: 'Cast iron frame', labelAt: [130, 160, -20], explode: [0, 0, -40], st: 0, en: 0.4 });
  // bed: a top slab with a window under the needle plate and the hook
  const bed = new THREE.Shape([[-150, 70], [150, 70], [150, -60], [-150, -60]].map(q => new THREE.Vector2(...q)));
  const win = new THREE.Path([[XN - 22, 24], [XN + 68, 24], [XN + 68, -24], [XN - 22, -24]].map(q => new THREE.Vector2(...q)));
  bed.holes.push(win);
  B.mesh(p, slab(bed, -12, 9.6, 0.8), 'enamel');
  // bed skirt at the back and the pillar end (the front and the head end
  // are open, so the hook shows from the front and from the left)
  B.mesh(p, box(-150, 150, -60, -12.4, -70, -64), 'enamel');
  B.mesh(p, box(144, 150, -60, -12.4, -64, 50), 'enamel');
  // one back wall: head, arm and pillar (sinks 0.6 mm into the bed)
  B.mesh(p, wallZ([[-130, 40], [-80, 40], [-80, 116], [112, 116], [112, -3], [150, -3], [150, 202], [-130, 202]], -34, 6), 'enamel');
  // top cover overhangs the walls by 1 mm
  B.mesh(p, box(-131, 151, 202, 208, -35, 31), 'enamel');
  // arm floor and pillar end wall
  B.mesh(p, box(-80, 112, 116, 122, -28, 30), 'enamel');
  B.mesh(p, box(144, 150, -3, 202, -28, 30), 'enamel');
  // needle bar bushings, each on a bracket from the back wall
  // outer radius 5.4: the needle bar link passes 0.6 mm clear at x XN + 6
  for (const [y0, y1] of [[66, 72], [116, 126]]) {
    const g = tube(3.9, 5.4, y0, y1, 32); g.translate(XN, 0, 0); B.mesh(p, g, 'cast');
    B.mesh(p, box(XN - 4, XN + 3, y0 + 0.5, y1 - 0.5, -28, -4.8), 'cast');
  }
  // presser bar bushing
  { const g = tube(3.4, 6, 140, 148, 32); g.translate(XN - 10, 0, -12); B.mesh(p, g, 'cast'); B.mesh(p, box(XN - 14, XN - 6, 140, 148, -28, -17.6), 'cast'); }
  // take-up link stud at C, from the lever plane to a block under the cover
  const Cy = H + M.TU.C[1], Cz = M.TU.C[0];
  { const g = rod(2.5, XN + 11.3, XN + 39, 24); g.rotateZ(-Math.PI / 2); g.translate(0, Cy, Cz); B.mesh(p, g, 'shaft'); }
  B.mesh(p, box(XN + 33, XN + 40, Cy, 202.5, Cz - 4, Cz + 4), 'cast');
  // main shaft bearings in the arm floor and the pillar
  for (const x of [-60, 100]) { const g = tube(4.4, 8, x - 4, x + 4, 32); g.rotateZ(-Math.PI / 2); g.translate(0, H, 0); B.mesh(p, g, 'cast'); B.mesh(p, box(x - 4, x + 4, 122.5, H - 7.8, -6, 6), 'cast'); }
  // lower shaft and hook shaft hangers from the bed
  for (const x of [XN + 72, 104]) { const g = tube(4.4, 8, x - 4, x + 4, 32); g.rotateZ(-Math.PI / 2); g.translate(0, LOW, 0); B.mesh(p, g, 'cast'); B.mesh(p, box(x - 4, x + 4, LOW + 7.8, -12.4, -6, 6), 'cast'); }
  { const x = XN + 18, g = tube(3.4, 6.5, x - 3, x + 3, 32); g.rotateZ(-Math.PI / 2); g.translate(0, M.HY, 0); B.mesh(p, g, 'cast'); B.mesh(p, box(x - 2.6, x + 2.6, M.HY - 3, M.HY + 3, -24.5, -5), 'cast'); }
  // tension stud from the back wall
  { const g = rod(2, -28, 47.5, 20); g.rotateX(Math.PI / 2); g.translate(-70, 157 - 4, 0); B.mesh(p, g, 'shaft'); }
  // top thread guide and spool pin
  { const g = rod(1.2, 208, 220, 12); g.translate(-20, 0, 10); B.mesh(p, g, 'shaft'); }
  { const g = rod(2, 208, 252, 16); g.translate(40, 0, 0); B.mesh(p, g, 'shaft'); }
  // lower thread guide G1 on a bracket from the back wall
  // (an arm to the presser bar bushing side: the needle bar link sweeps the
  // space between G1 and the back wall)
  { const [gx, gy, gz] = M.G1, g = tube(1.0, 2.4, gx - 1.2, gx + 1.2, 20); g.rotateZ(-Math.PI / 2); g.translate(0, gy, gz); B.mesh(p, g, 'steel');
    B.mesh(p, box(XN - 12, gx - 1.6, gy - 1.2, gy + 1.2, gz - 1.2, gz + 1.2), 'steel'); B.mesh(p, box(XN - 12.4, XN - 8.4, gy - 1.5, gy + 1.5, -28, gz + 1.6), 'steel'); }
  return p;
}

export function build(B) {
  const base = casting(B);
  const parts = {};
  const P0 = mpose(0);

  // ── needle plate, fixed ─────────────────────────────────────────────────
  {
    const p = B.part('plate', { info: 'plate', label: 'Needle plate', labelAt: [XN - 24, 0, 22], explode: [0, 18, 0], st: 0.1, en: 0.6 });
    const s = new THREE.Shape([[XN - 30, 25], [XN + 30, 25], [XN + 30, -25], [XN - 30, -25]].map(q => new THREE.Vector2(...q)));
    s.holes.push(circle(1.4, XN, 0));
    for (const x0 of [XN - 5.6, XN + 1.6]) s.holes.push(new THREE.Path([[x0, 9.2], [x0 + 4, 9.2], [x0 + 4, -9.2], [x0, -9.2]].map(q => new THREE.Vector2(...q))));
    B.mesh(p, slab(s, -2, 2, 0.3), 'plate');
    parts.plate = p;
  }

  // ── main shaft, handwheel, upper pulley ─────────────────────────────────
  const shaft = B.part('shaft', { info: 'shaft', label: 'Main shaft', labelAt: [20, 0, 0], ...XAX, at: [0, H, 0], explode: [0, 30, 0], st: 0.2, en: 0.7 });
  B.mesh(shaft, rod(4, XN + 19.4, 172, 24), 'shaft');
  B.mesh(shaft, lathe([[[12, 123], [12, 133], [0, 133], [0, 123]]], 48), 'steel');
  B.mesh(shaft, lathe([[[13.5, 122.4], [13.5, 123.6], [12, 123.6], [12, 122.4]]], 48), 'steel');
  B.mesh(shaft, lathe([[[13.5, 132.4], [13.5, 133.6], [12, 133.6], [12, 132.4]]], 48), 'steel');
  const wheel = B.part('wheel', { info: 'wheel', label: 'Handwheel', labelAt: [0, 160, 0], ...XAX, at: [0, H, 0], explode: [40, 0, 0], st: 0.1, en: 0.6 });
  B.mesh(wheel, poly([[36, 154], [36, 168], [31, 168], [31, 165], [8, 165], [8, 168], [5, 168], [5, 152.4], [8, 152.4], [8, 157], [31, 157], [31, 154]], 72), 'steel');
  // a white index mark on the rim, 0.3 mm proud, to read the turn
  B.mesh(wheel, new THREE.BoxGeometry(0.6, 10, 2.4).translate(36.6, 161, 0), 'plate');

  // ── crank disc and pin (the needle bar crank) ───────────────────────────
  const crank = B.part('crank', { info: 'crank', label: 'Needle bar crank', labelAt: [24, XN + 16, 0], ...XAX, at: [0, H, 0], explode: [0, 0, 26], st: 0.2, en: 0.7 });
  B.mesh(crank, poly([[19, XN + 14], [19, XN + 19], [5, XN + 19], [5, XN + 24], [0, XN + 24], [0, XN + 14]], 64), 'gear');
  { const g = rod(2.5, XN + 4, XN + 14, 20); g.translate(M.a, 0, 0); B.mesh(crank, g, 'steel'); }

  // ── needle bar link (crank pin to the needle bar stud) ──────────────────
  const link = B.part('link', { info: 'link', label: 'Needle bar link', labelAt: [-24, XN + 6, 0], ...XAX, explode: [0, 0, 34], st: 0.25, en: 0.75 });
  B.mesh(link, bar(M.l, 8, XN + 6, 2), 'steel');

  // ── needle bar, clamp stud, needle ──────────────────────────────────────
  // made with the needle point at y = 0 of the part; pose moves it to N.point
  const nbar = B.part('needlebar', { info: 'needlebar', label: 'Needle bar', labelAt: [0, 120, 0], explode: [0, 0, 44], st: 0.25, en: 0.75 });
  B.mesh(nbar, rod(3.5, 38, M.LP + 50, 24), 'steel');
  B.mesh(nbar, box(-5, 5, M.LP - 4, M.LP + 4, -5, 5), 'cast');
  { const g = rod(2.4, 4.4, 9, 16); g.rotateZ(-Math.PI / 2); g.translate(0, M.LP, 0); B.mesh(nbar, g, 'steel'); }
  B.mesh(nbar, box(-4.2, 4.2, 38.4, 44, -4.2, 4.2), 'cast');
  // the thread guide G2 on the clamp, a small eyelet in front
  { const e = tube(0.7, 1.5, M.G2UP - 0.8, M.G2UP + 0.8, 16); e.translate(0, 0, M.G2Z); B.mesh(nbar, e, 'steel'); B.mesh(nbar, box(-0.7, 0.7, M.G2UP - 0.6, M.G2UP + 0.6, 3, M.G2Z - 1.2), 'steel'); }
  const ndl = B.part('needle', { info: 'needle', label: 'Needle', labelAt: [0, 20, 0], parent: nbar.root, explode: [0, -20, 0], st: 0.3, en: 0.8 });
  B.mesh(ndl, lathe([[[0.01, 0], [0.5, 2.4], [0.5, 30], [0.8, 31], [0.8, 43.6], [0.01, 43.6]]], 16), 'steel');

  // ── take-up lever and its link ──────────────────────────────────────────
  const { b, c, u, v } = M.TU;
  const tl = B.part('takeup', { info: 'takeup', label: 'Take-up lever', labelAt: [30, XN + 10, -20], ...XAX, explode: [0, 0, 56], st: 0.3, en: 0.8 });
  {
    const s = new THREE.Shape(), r = 4.5;
    s.moveTo(0, -r); s.lineTo(b, -r); s.lineTo(u, -v - 3); s.absarc(u, -v, 3, -Math.PI / 2, Math.PI / 2, false); s.lineTo(b, r); s.lineTo(0, r); s.absarc(0, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);
    s.holes.push(circle(3.6, 0, 0), circle(3.6, b, 0), circle(1.3, u, -v));
    B.mesh(tl, slab(s, XN + 9, 2, 0.4), 'brass');
  }
  const tk = B.part('tulink', { info: 'tulink', label: null, ...XAX, at: [0, H + M.TU.C[1], M.TU.C[0]], explode: [0, 0, 48], st: 0.3, en: 0.8 });
  B.mesh(tk, bar(c, 9, XN + 11.6, 1.8), 'steel');
  { const g = rod(2.5, XN + 8.6, XN + 13.8, 16); g.translate(c, 0, 0); B.mesh(tk, g, 'bolt'); }

  // ── presser bar and foot, fixed ─────────────────────────────────────────
  const pf = B.part('presser', { info: 'presser', label: 'Presser foot', labelAt: [XN - 12, 6, 6], explode: [0, 30, 20], st: 0.1, en: 0.6 });
  { const g = rod(3, 30, 201.5, 20); g.translate(XN - 10, 0, -12); B.mesh(pf, g, 'steel'); }
  B.mesh(pf, box(XN - 13, XN - 7, 6, 30.4, -15, -9), 'steel');
  {
    const s = new THREE.Shape([[XN - 8, 10], [XN + 8, 10], [XN + 8, -16], [XN - 8, -16]].map(q => new THREE.Vector2(...q)));
    s.holes.push(new THREE.Path([[XN - 1.6, 4], [XN + 1.6, 4], [XN + 1.6, -4], [XN - 1.6, -4]].map(q => new THREE.Vector2(...q))));
    B.mesh(pf, slab(s, M.FABRIC + 0.35 + 1.05, 1.6, 0.3), 'plate');
    B.mesh(pf, box(XN - 12.6, XN - 3, M.FABRIC + 2.4, 7, -14.6, -9.4), 'steel');
  }

  // ── tension discs and guides ────────────────────────────────────────────
  const tn = B.part('tension', { info: 'tension', label: 'Tension discs', labelAt: [-70, 168, 40], explode: [30, 16, 20], st: 0.2, en: 0.7 });
  for (const [z0, z1] of [[36.4, 39.4], [40.6, 43.6]]) { const g = lathe([[[7, z0 + 0.6], [7, z1 - 0.6], [2.1, z1], [2.1, z0]]], 40); g.rotateX(Math.PI / 2); g.translate(-70, 153, 0); B.mesh(tn, g, 'steel'); }
  { const g = lathe([[[4, 44], [4, 47], [2.1, 48], [2.1, 44]]], 6); g.rotateX(Math.PI / 2); g.translate(-70, 153, 0); B.mesh(tn, g, 'brass'); }
  { const g = tube(1.2, 2.6, -1, 1, 20); g.rotateX(Math.PI / 2); g.translate(-20, 222, 10); B.mesh(tn, g, 'steel'); }

  // ── spool ───────────────────────────────────────────────────────────────
  const sp = B.part('spool', { info: 'spool', label: 'Spool', labelAt: [40, 250, 0], explode: [0, 30, 0], st: 0.1, en: 0.5 });
  B.mesh(sp, poly([[12, 209], [12, 212], [10, 212], [10, 244], [12, 244], [12, 247], [2.4, 247], [2.4, 209]], 48), 'cast');
  B.mesh(sp, poly([[10.6, 212.4], [10.6, 243.6], [9, 243.6], [9, 212.4]], 48), 'thread');

  // ── belt, lower shaft, gears, eccentrics ────────────────────────────────
  const belt = B.part('belt', { info: 'belt', label: 'Timing belt', labelAt: [128, 50, 16], explode: [30, 0, 30], st: 0.2, en: 0.7 });
  {
    const ring = (rO, rI) => { const s = new THREE.Shape(); s.absarc(H, 0, rO, -Math.PI / 2, Math.PI / 2, false); s.absarc(LOW, 0, rO, Math.PI / 2, 3 * Math.PI / 2, false);
      const h = new THREE.Path(); h.absarc(H, 0, rI, -Math.PI / 2, Math.PI / 2, false); h.absarc(LOW, 0, rI, Math.PI / 2, 3 * Math.PI / 2, false); s.holes.push(h); return s; };
    // shape (sx, sy) -> world (x, y, z) = (h, sx, sy) after the turn to x
    const g = slab(ring(14.2, 12.6), 124, 8, 0.4); g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)));
    B.mesh(belt, g, 'rubber');
  }
  const lower = B.part('lower', { info: 'lower', label: 'Lower shaft', labelAt: [-12, 40, 0], ...XAX, at: [0, LOW, 0], explode: [0, -34, 0], st: 0.2, en: 0.7 });
  B.mesh(lower, rod(4, XN + 27, 134, 24), 'shaft');
  B.mesh(lower, lathe([[[12, 123], [12, 133], [0, 133], [0, 123]]], 48), 'steel');
  B.mesh(lower, slab(gearShape(14, 32), XN + 26, 6, 0.3), 'gear');
  const ecc = [];
  for (const [x, e, nm] of [[XN + 45, M.LIFT, 'lift'], [XN + 58, 2.1, 'feed']]) {
    const g = rod(7, x - 3, x + 3, 40); g.translate(e, 0, 0); B.mesh(lower, g, 'bronze');
    ecc.push({ x, nm });
  }
  // hook, hook shaft, small gear: one part that turns at twice the speed
  const hk = B.part('hook', { info: 'hook', label: 'Rotary hook', labelAt: [-16, XN + 6, -8], ...XAX, at: [0, M.HY, 0], explode: [0, -26, 30], st: 0.3, en: 0.8 });
  B.mesh(hk, poly([[10, XN + 1], [11, XN + 1], [11, XN + 12], [0.01, XN + 12], [0.01, XN + 10.5], [10, XN + 10.5]], 64), 'steel');
  B.mesh(hk, rod(3, XN + 11.5, XN + 32, 20), 'shaft');
  // the hook spins at -2 (th - thC): a tooth gap of the small gear faces
  // the big gear's tooth at the top of the big gear (see mesh phase below)
  B.mesh(hk, slab(gearShape(7, 16, 2, Math.PI + Math.PI / 16 - 2 * thC), XN + 26.5, 5, 0.3), 'brass');
  {
    // the beak: tip at local angle 0 (radius 11.2), body trailing to -z
    const s = new THREE.Shape([[9.8, 8], [11.4, 8], [11.5, 2], [11.2, 0], [10.2, 2.5]].map(q => new THREE.Vector2(...q)));
    B.mesh(hk, slab(s, XN + M.BEAK_X, 1.4, 0.2), 'steel');
  }
  const bc = B.part('bobbin', { info: 'bobbin', label: 'Bobbin case', labelAt: [XN + 2, M.HY - 12, 8], explode: [-28, -20, 30], st: 0.35, en: 0.85 });
  { const g = poly([[M.RB, M.CASE[0] + 0.4], [M.RB, M.CASE[1]], [0.01, M.CASE[1]], [0.01, M.CASE[0]], [M.RB - 0.4, M.CASE[0]]], 48); g.rotateZ(-Math.PI / 2); g.translate(XN, M.HY, 0); B.mesh(bc, g, 'alu'); }
  { const g = poly([[2.2, M.CASE[0] + 0.4 - 1.6], [2.2, M.CASE[0] - 0.1], [0.01, M.CASE[0] - 0.1], [0.01, M.CASE[0] + 0.4 - 1.6]], 20); g.rotateZ(-Math.PI / 2); g.translate(XN, M.HY, 0); B.mesh(bc, g, 'brass'); }

  // ── feed dog and feed bar ───────────────────────────────────────────────
  // made with the tooth tops at y = 0 and the dog centre at z = 0
  const fd = B.part('feeddog', { info: 'feeddog', label: 'Feed dog', labelAt: [XN + 10, -2, 10], explode: [0, -16, 0], st: 0.25, en: 0.75 });
  {
    const teeth = (x0) => { const s = new THREE.Shape(); s.moveTo(-6, -2); for (let k = 0; k < 8; k++) { const z = -6 + k * 1.5; s.lineTo(z, 0); s.lineTo(z + 1.5, -0.7); } s.lineTo(6, -2); s.closePath();
      // (sx, sy) in (z, y), extruded along x: a turn to the x-axis frame
      const g = slab(s, x0, 3.2, 0.1); g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0))); return g; };
    // the matrix above maps (sx, h, -sy) -> (h, -(-sy), sx): x = h, y = sy, z = sx
    B.mesh(fd, teeth(XN - 5.2), 'steel');
    B.mesh(fd, teeth(XN + 2), 'steel');
    // the cross bar stays under the plate: its top is 3.2 below the teeth
    B.mesh(fd, box(XN - 5.4, XN + 5.4, -4.6, -3.2, -7, -5.2), 'steel');
    B.mesh(fd, box(XN - 2, XN + 2, -4.4, -3.4, -13.6, -6.6), 'steel');
    B.mesh(fd, box(XN - 6, XN + 62, -6, -4.4, -14, -8), 'cast');
    for (const x of [XN + 45, XN + 58]) { const g = rod(1, x - 3, x + 3, 12); g.rotateZ(-Math.PI / 2); g.translate(0, -5.2, -11); B.mesh(fd, g, 'bolt'); }
  }
  const straps = ecc.map(({ x, nm }) => {
    const p = B.part('strap_' + nm, { info: 'eccentric', label: nm === 'lift' ? 'Lift eccentric' : 'Feed eccentric', labelAt: [-12, x, -8], ...XAX, explode: [0, -40, 0], st: 0.25, en: 0.75 });
    B.mesh(p, poly([[8.4, x - 2.6], [8.4, x + 2.6], [7.2, x + 2.6], [7.2, x - 2.6]], 40), 'bronze');
    B.mesh(p, bar(STRAP, 4, x - 1.4, 2.8, [[STRAP, 0]], 1.2), 'bronze');
    return { p, x, nm };
  });

  // ── cloth and stitches ──────────────────────────────────────────────────
  const cl = B.part('cloth', { info: 'cloth', label: 'Cloth', labelAt: [XN - 10, 2, 50], explode: [0, 24, 0], st: 0.1, en: 0.6 });
  {
    const s = new THREE.Shape([[XN - 16, 80], [XN + 12, 80], [XN + 12, -80], [XN - 16, -80]].map(q => new THREE.Vector2(...q)));
    B.mesh(cl, slab(s, 0.35, M.FABRIC, 0.2), 'cloth', { shadow: false });
  }
  const NST = 16, marks = [];
  for (let i = 0; i < NST; i++) {
    const g = new THREE.CylinderGeometry(0.25, 0.25, 1, 8); g.rotateX(Math.PI / 2);
    marks.push(B.mesh(cl, g, 'mark', { pick: false, shadow: false }));
  }
  const clothMat = cl.mats.cloth;

  // ── thread: segments that main.js lays along the mech.js points ─────────
  const th = B.part('thread', { info: 'thread', label: null, explode: [0, 0, 0], st: 0, en: 1 });
  const NSEG = 14, segs = [];
  for (let i = 0; i < NSEG; i++) segs.push(B.mesh(th, unitRod(0.4), 'thread', { shadow: false }));
  const bseg = [0, 1].map(() => B.mesh(th, unitRod(0.4), 'bthread', { shadow: false }));
  const SPOOL = [[40 + 10.6, 230, 0], [-20, 222, 10], M.T];
  const BOB = [[XN + 0.7, M.HY + M.RB - 2, 2], [XN + 0.75, -2.2, -0.55], [XN + 0.75, 0.2, -0.55]];
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), dir = new THREE.Vector3();
  const lay = (m, p, q) => {
    A.set(...p); Bv.set(...q); dir.subVectors(Bv, A); const L = dir.length();
    if (L < 1e-3) { m.visible = false; return; }
    m.visible = true; m.position.copy(A); m.quaternion.setFromUnitVectors(Yv, dir.multiplyScalar(1 / L)); m.scale.set(1, L, 1);
  };

  const box3 = { c: [10, 96, 0], R: 0.62 * Math.hypot(325, 312) };
  return {
    // th: main shaft angle (unwrapped), L: stitch length, travel: fabric
    // travel (mm), threadOn: show the thread
    pose(t, L = 2.5, travel = 0, threadOn = true) {
      const Q = mpose(t, L), N = Q.N, T = Q.T, K = Q.K, F = Q.F;
      shaft.spin(t); wheel.spin(t); crank.spin(t); lower.spin(t);
      // needle bar link from the crank pin to the stud on the bar
      const Ay = H + T.A[1], Az = T.A[0];
      link.root.position.set(0, Ay, Az); link.spin(Math.atan2(0 - Az, N.clamp - Ay));
      nbar.root.position.set(XN, N.point, 0);
      tl.root.position.set(0, Ay, Az); tl.spin(Math.atan2(T.B[0] - T.A[0], T.B[1] - T.A[1]));
      tk.spin(Math.atan2(T.B[0] - M.TU.C[0], T.B[1] - M.TU.C[1]));
      hk.spin(K.ang);
      fd.root.position.set(0, F.top, F.z);
      // straps from each eccentric centre to its pin on the feed bar
      for (const s of straps) {
        const e = s.nm === 'lift' ? M.LIFT : 2.1, cy = LOW + e * Math.cos(t), cz = e * Math.sin(t);
        const py = F.top - 5.2, pz = F.z - 11;
        s.p.root.position.set(0, cy, cz); s.p.spin(Math.atan2(pz - cz, py - cy));
      }
      // cloth: the weave and the stitch marks move with the feed
      clothMat.map.offset.y = -travel * 0.25;
      const turn = Math.floor((t - Math.PI) / (Math.PI * 2)), sk = (turn + 1) * L;
      for (let i = 0; i < NST; i++) {
        const z0 = -(travel - (sk - i * L)), z1 = z0 - L, m = marks[i];
        const zc = (z0 + z1) / 2, show = Math.abs(L) > 0.1 && Math.abs(zc) < 76;
        m.visible = show; if (!show) continue;
        m.position.set(XN, 0.35 + M.FABRIC + 0.55, zc); m.scale.set(1, 1, 0.72 * Math.abs(L));
      }
      // thread
      th.holder.visible = threadOn;
      if (threadOn) {
        // the thread passes the eye front to back: a point 0.95 mm in front of
        // the needle axis and one 0.95 mm behind it, so no segment runs along
        // the needle surface (r 0.5, thread r 0.4); the plate hole point sits behind too
        const e = Q.P.eye, eF = [e[0], e[1], 0.95], eB = [e[0], e[1], -0.95];
        const below = Q.P.below.slice(1).map((p, i, a) => (i === a.length - 1 ? [p[0], p[1], -0.95] : p));
        const pts = [...SPOOL, ...Q.P.up.slice(1, -1), eF, eB, ...below];
        let i = 0;
        for (; i < pts.length - 1 && i < NSEG; i++) lay(segs[i], pts[i], pts[i + 1]);
        for (; i < NSEG; i++) segs[i].visible = false;
        lay(bseg[0], BOB[0], BOB[1]); lay(bseg[1], BOB[1], BOB[2]);
      }
      return Q;
    },
    box: box3,
    keys: { needle: [XN, 4, 0], hook: [XN + 6, M.HY, 0], takeup: [XN + 10, H + 24, 26], feed: [XN, 0, 0] },
    parts: { shaft, crank, link, nbar, tl, tk, hk, fd, cl, th },
  };
}
export { thC };

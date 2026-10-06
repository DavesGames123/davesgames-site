// ============================================================================
//  PENDULUM CLOCK  ·  scene.js — the parts of the clock and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes the clock with one escapement and returns sc:
//  { pose(Q), setLength(mm), box, keys }. The pallet faces and the wheel
//  teeth come from mech.js design(), so the tooth that main.js turns sits
//  on the face that the tests check.
//
//  LAYOUT. Parts are made in the clock plane: the point (X, Y) at depth z
//  (toward the viewer) is (X, z, -Y) in the B.root frame. B.root turns +90
//  deg about x, so Y is up and z comes toward the viewer. The escape wheel
//  centre is the origin; the pallet arbor is a mm above it.
//    backboard ......... z -95 .. -83
//    back plate ........ z -50 .. -46      front frame .. z -6 .. -2
//    front bridges ..... z -5 .. -1.6, each 0.4 mm in front of the last
//    barrel ............ z -44 .. -26      great wheel .. z -24 .. -21.5
//    centre wheel ...... z -16 .. -13.5    third wheel .. z -10 .. -8
//    escape wheel ...... z 6 .. 8.5 (in front of the front plate)
//    pallets ........... z 4.5 .. 10, the pallet arms z 9.5 .. 12 (+0.4)
//    grasshopper ....... arms z 9 .. 11.5, nibs z 4.5 .. 11, frame z 12 .. 14.5 (+0.4)
//    seconds hand ...... z 12.6 .. 13.4
//    pendulum .......... rod at z 18, the bob z 4 .. 32
//    weight ............ behind the pendulum, z -57 .. -13
//  Every pinion is longer than the wheel it drives, every collet starts
//  inside its wheel and every hole is 0.4 mm larger than its arbor, so no
//  two faces of different parts lie in one plane.
//
//  GREP MAP
//    function gear ............ a toothed outline with crossings (spokes)
//    function escapeOutline ... the escape wheel teeth for one escapement
//    function palletShapes .... the pallet bodies behind the design faces
//    export function build .... all parts, pose and setLength
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, circle, merge } from './kit.js';
import { unit, design, contact, makeSim, CLOCK, TAU, P_TOOTH } from './mech.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const rotv = (v, t) => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];

// a wheel or a pinion: n teeth on pitch radius rp, module m, with spokes
function gear(n, rp, m, o = {}) {
  const rt = rp + 0.95 * m, rr = rp - 1.25 * m, s = new THREE.Shape(), pts = [];
  for (let k = 0; k < n; k++) {
    const a = TAU * k / n, h = Math.PI / n;
    // gap at a - h, then the flank, a round tip and the other flank
    pts.push(pol(rr, a - h), pol(rr, a - 0.55 * h), pol(rp, a - 0.48 * h), pol(rt * 0.985, a - 0.3 * h), pol(rt, a), pol(rt * 0.985, a + 0.3 * h), pol(rp, a + 0.48 * h), pol(rr, a + 0.55 * h));
  }
  pts.forEach((p, i) => (i ? s.lineTo(...p) : s.moveTo(...p)));
  s.closePath();
  s.holes.push(circle(o.bore ?? 2.4));
  if (o.spokes) addCrossings(s, o.spokes, o.hub ?? 7, rr - 3.5);
  return s;
}
// n sector windows between ri and ro, spokes 3 mm wide
function addCrossings(s, n, ri, ro) {
  if (ro - ri < 4) return;
  for (let k = 0; k < n; k++) {
    const a0 = TAU * k / n, a1 = TAU * (k + 1) / n, wo = 1.6 / ro, wi = 1.6 / ri;
    const h = new THREE.Path();
    h.absarc(0, 0, ro, a0 + wo, a1 - wo, false);
    h.absarc(0, 0, ri, a1 - wi, a0 + wi, true);
    h.closePath();
    s.holes.push(h);
  }
}
// The escape wheel at phi = 0: tooth k has its tip (anchor, deadbeat) or
// its radial front face (grasshopper) at angle pi/2 - k p. It turns
// clockwise, so the front of a tooth is its low-angle side.
function escapeOutline(id) {
  // The drawn tips stop 0.5 mm inside Rw (the nib 1.2 mm ahead of the
  // grasshopper face), so a tooth never shares a plane with a pallet face.
  const Rw = CLOCK.Rw - 0.5, Rr = CLOCK.Rw - 6, p = P_TOOTH, N = CLOCK.N, s = new THREE.Shape(), pts = [];
  for (let k = N - 1; k >= 0; k--) {
    const a = Math.PI / 2 - k * p;
    if (id === 'grasshopper') pts.push(pol(Rr, a), pol(Rw, a), pol(Rw - 0.6, a + 0.12 * p), pol(Rr + 2.2, a + 0.42 * p), pol(Rr, a + 0.58 * p));
    else pts.push(pol(Rr, a - 0.08 * p), pol(Rw - 2.5, a - 0.035 * p), pol(Rw, a), pol(Rr + 0.62 * (Rw - Rr), a + 0.16 * p), pol(Rr + 0.2 * (Rw - Rr), a + 0.34 * p), pol(Rr, a + 0.44 * p));
  }
  pts.forEach((q, i) => (i ? s.lineTo(...q) : s.moveTo(...q)));
  s.closePath();
  s.holes.push(circle(2.4));
  addCrossings(s, 5, 8, Rr - 4);
  return s;
}
// the body of each pallet: the design face and a strip behind it (on the
// side the tooth pushes into), in the pallet frame (arbor at the origin)
function palletShapes(D) {
  const out = [];
  for (const pal of D.pallets) {
    if (pal.faces[0].type === 'nib') continue;
    // W: the pallet fits the space ahead of a tooth (0.56 of a pitch)
    const idx = D.pallets.indexOf(pal), W = 3.2, f0 = pal.faces[0];
    if (pal.faces.length > 1) {
      // deadbeat: the tip, the corner K, then the locking arc; the back is
      // the arc moved W along its radius into the pallet, so the short
      // impulse face is the slanted end of a curved bar
      const f1 = pal.faces[1], n = 16, arc = [];
      for (let i = 0; i <= n; i++) arc.push(pal.sgn > 0 ? f1.a0 + (f1.a1 - f1.a0) * i / n : f1.a1 - (f1.a1 - f1.a0) * i / n);
      const th = -pal.sgn * (unit(D.id).thl + 2 * Math.PI / 180), c = contact(D, idx, th), nl = rotv(c.n, -th);
      const sr = Math.sign(nl[0] * Math.cos(arc[0]) + nl[1] * Math.sin(arc[0])), front = [f0.p0, ...arc.map(a => pol(f1.r, a))];
      const back = arc.map(a => pol(f1.r + sr * W, a));
      const s = new THREE.Shape([...front, ...back.reverse()].map(q => V2(...q)));
      out.push({ s, root: back[0], tip: f0.p0, sgn: pal.sgn });
      continue;
    }
    // anchor: a strip behind the face, on the side the tooth pushes into
    const pts = [f0.p0, f0.p1], nW = contact(D, idx, 0).n;
    const t0 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], l = Math.hypot(...t0), side = Math.sign(t0[0] * nW[1] - t0[1] * nW[0]);
    const nn = [-t0[1] / l * side * W, t0[0] / l * side * W], back = pts.map(q => [q[0] + nn[0], q[1] + nn[1]]);
    const s = new THREE.Shape([...pts, ...[...back].reverse()].map(q => V2(...q)));
    out.push({ s, root: back[back.length - 1], tip: pts[0], sgn: pal.sgn });
  }
  return out;
}
// a flat bar from a to b (width w), as a shape
function barShape(a, b, w) {
  const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d), n = [-d[1] / l * w / 2, d[0] / l * w / 2];
  return new THREE.Shape([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]].map(q => V2(...q)));
}

// the train: [arbor, pinion leaves, wheel teeth, wheel pitch radius]
const MOD = 0.8;
export function trainLayout() {
  const rp = n => n * MOD / 2;
  const E = [0, 0], dir = (p, d, a) => [p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)];
  const third = dir(E, rp(8) + rp(60), -120 * Math.PI / 180);
  const centre = dir(third, rp(8) + rp(64), -60 * Math.PI / 180);
  const great = dir(centre, rp(8) + rp(96), -120 * Math.PI / 180);
  return { E, third, centre, great, rp };
}

export function build(B, id) {
  const u = unit(id), D = design(u), A = D.A, Rw = CLOCK.Rw;
  B.root.rotation.x = Math.PI / 2;
  const at = (X, Y, z = 0) => [X, z, -Y];
  const T = trainLayout(), Lmm = CLOCK.L * 1000;

  // ── frame ────────────────────────────────────────────────────────────────
  const top = A[1] + 80, bottom = A[1] - Lmm - 110;
  const board = B.part('base', { info: 'base', label: 'Backboard', labelAt: at(150, top - 60, -83), explode: [0, -60, 0], st: 0, en: 0.4 });
  B.mesh(board, slab(new THREE.Shape([V2(-210, bottom), V2(210, bottom), V2(210, top), V2(-210, top)]), -95, 12, 1.5), 'wood');
  const plates = B.part('plates', { info: 'plates', label: 'Plates', labelAt: at(58, -140, -2), explode: [0, -30, 0], st: 0, en: 0.5 });
  const px0 = -72, px1 = 58, py0 = -140, py1 = A[1] + 18;
  // a rounded rectangle path, counter-clockwise (or clockwise as a hole)
  const rrect = (x0, y0, x1, y1, r, P) => {
    P.moveTo(x0 + r, y0); P.lineTo(x1 - r, y0); P.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0); P.lineTo(x1, y1 - r); P.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
    P.lineTo(x0 + r, y1); P.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI); P.lineTo(x0, y0 + r); P.absarc(x0 + r, y0 + r, r, Math.PI, 1.5 * Math.PI);
    return P;
  };
  // back plate: solid, with a pivot hole for each arbor
  const back = rrect(px0, py0, px1, py1, 10, new THREE.Shape());
  for (const q of [T.E, T.third, T.centre, T.great, A]) back.holes.push(circle(2.4, q[0], q[1]));
  B.mesh(plates, slab(back, -50, 4, 0.5), 'paint');
  // front plate: a skeleton frame, so the train shows. Bridges carry the
  // front pivots; each bridge lies 0.4 mm further forward than the last,
  // so no two of them (or a bridge and the frame) share a face plane.
  const frame = rrect(px0, py0, px1, py1, 10, new THREE.Shape()), win = new THREE.Path();
  const ins = 10, ri = 4;
  win.moveTo(px0 + ins, py0 + ins + ri); win.absarc(px0 + ins + ri, py0 + ins + ri, ri, Math.PI, 1.5 * Math.PI); win.lineTo(px1 - ins - ri, py0 + ins);
  win.absarc(px1 - ins - ri, py0 + ins + ri, ri, -Math.PI / 2, 0); win.lineTo(px1 - ins, py1 - ins - ri); win.absarc(px1 - ins - ri, py1 - ins - ri, ri, 0, Math.PI / 2);
  win.lineTo(px0 + ins + ri, py1 - ins); win.absarc(px0 + ins + ri, py1 - ins - ri, ri, Math.PI / 2, Math.PI); win.closePath();
  frame.holes.push(win);
  B.mesh(plates, slab(frame, -6, 4, 0.5), 'plate');
  const bridge = (a, b, k, holes) => {
    // the round ends of two bridges meet on one arbor: their radii differ by 0.7 mm
    const d = [b[0] - a[0], b[1] - a[1]], ang = Math.atan2(d[1], d[0]), w = 4 + 0.7 * k, s = new THREE.Shape();
    s.absarc(a[0], a[1], w, ang + Math.PI / 2, ang + 1.5 * Math.PI, false); s.absarc(b[0], b[1], w, ang - Math.PI / 2, ang + Math.PI / 2, false);
    for (const q of holes) s.holes.push(circle(2.4, q[0], q[1]));
    B.mesh(plates, slab(s, -5 + 0.4 * k, 3.4, 0.4), 'plate');
  };
  bridge([0, py1 - 6], T.E, 0, [A, T.E]);
  bridge(T.E, T.third, 1, [T.third]);
  bridge(T.third, T.centre, 2, [T.centre]);
  bridge(T.centre, T.great, 3, [T.great]);
  bridge(T.great, [px0 + 4, py0 + 4], 4, []);
  bridge(T.centre, [px1 - 4, T.centre[1]], 5, []);
  const pil = [[px0 + 9, py0 + 9], [px1 - 9, py0 + 9], [px0 + 9, py1 - 9], [px1 - 9, py1 - 9]];
  for (const [x, y] of pil) {
    // pillar ends sit inside the plates; the standoffs reach into the board
    const g = lathe([[[4.5, -47], [4.5, -5]], [[0, -5], [0, -47]]], 32); g.translate(x, 0, -y); B.mesh(plates, g, 'brass');
    const s = rod(3.5, -86, -49, 24); s.translate(x, 0, -y); B.mesh(plates, s, 'bolt');
  }

  // ── escape wheel, arbor, pinion, seconds hand ────────────────────────────
  const esc = B.part('escape', { info: 'escape', label: 'Escape wheel', labelAt: [0, 9, -Rw - 6], at: at(0, 0), explode: [0, 70, 0], st: 0.25, en: 0.85 });
  B.mesh(esc, slab(escapeOutline(id), 6, 2.5, 0.25), 'brass');
  B.mesh(esc, rod(2, -52, 14, 20), 'shaft');
  B.mesh(esc, tube(2, 4.6, 4.5, 12.3, 24), 'brass');
  B.mesh(esc, slab(gear(8, T.rp(8), MOD, { bore: 1.6 }), -12, 5.5, 0.15), 'steel');
  const hand = new THREE.Shape([V2(-1.2, -7), V2(1.2, -7), V2(0.5, 27), V2(-0.5, 27)]);
  B.mesh(esc, slab(hand, 12.6, 0.8, 0.15), 'bolt');

  // ── train ────────────────────────────────────────────────────────────────
  const arbor = (id2, info, label, q, wheelN, wz, pinZ, explode, st) => {
    const p = B.part(id2, { info, label, labelAt: [T.rp(wheelN) * 0.7, wz + 3, -T.rp(wheelN) * 0.7], at: at(q[0], q[1]), explode: [0, explode, 0], st, en: Math.min(1, st + 0.55) });
    B.mesh(p, slab(gear(wheelN, T.rp(wheelN), MOD, { spokes: 4, hub: 6 }), wz, 2.5, 0.2), 'brass');
    B.mesh(p, tube(2, 5, wz + 1, wz + 4.5, 24), 'brass');
    if (pinZ) B.mesh(p, slab(gear(8, T.rp(8), MOD, { bore: 1.6 }), pinZ[0], pinZ[1] - pinZ[0], 0.15), 'steel');
    // the front pivot stands 2 mm proud of the last bridge (z 0.4)
    B.mesh(p, rod(2, -52, 2.4, 20), 'shaft');
    return p;
  };
  const third = arbor('third', 'third', 'Third wheel', T.third, 60, -10, [-18, -11], 40, 0.15);
  const centre = arbor('centre', 'centre', 'Centre wheel', T.centre, 64, -16, [-26, -19], 25, 0.1);
  const great = arbor('great', 'barrel', 'Great wheel', T.great, 96, -24, null, 12, 0.05);
  // the barrel and a few turns of cord
  B.mesh(great, lathe([[[21.5, -44], [21.5, -42.5], [20, -42.5], [20, -27.5], [21.5, -27.5], [21.5, -26]], [[2.4, -26], [2.4, -44]]], 64), 'cast');
  for (let i = 0; i < 6; i++) { const t = new THREE.TorusGeometry(20.6, 0.65, 8, 64); t.rotateX(Math.PI / 2); t.translate(0, -41 + i * 1.4, 0); B.mesh(great, t, 'rubber'); }

  // ── weight and cord ──────────────────────────────────────────────────────
  const cx = T.great[0] - 20.6, cz = -35, wTop = -380;
  const weight = B.part('weight', { info: 'weight', label: 'Drive weight', labelAt: [cx + 30, cz, -(wTop - 40)], explode: [0, -20, 0], st: 0, en: 0.5 });
  const cord = new THREE.CylinderGeometry(0.65, 0.65, T.great[1] - wTop, 8); cord.rotateX(Math.PI / 2); cord.translate(cx, cz, -(T.great[1] + wTop) / 2);
  B.mesh(weight, cord, 'rubber', { shadow: false });
  const wb = lathe([[[23, 0], [23, 150]], [[19, 156], [4, 160]], [[0, 160], [0, 0]]], 48); wb.rotateX(Math.PI / 2); wb.translate(cx, cz, -(wTop - 160));
  B.mesh(weight, wb, 'brass');
  const hook = new THREE.TorusGeometry(4, 0.9, 8, 24); hook.translate(cx, cz, -(wTop + 3)); B.mesh(weight, hook, 'bolt');

  // ── pallets ──────────────────────────────────────────────────────────────
  const pal = B.part('pallets', { info: 'pallets', label: id === 'anchor' ? 'Anchor' : id === 'deadbeat' ? 'Deadbeat pallets' : 'Pallet frame', labelAt: [0, 13, -30], at: at(A[0], A[1]), explode: [0, 110, 0], st: 0.3, en: 0.95 });
  B.mesh(pal, rod(2, -52, 24, 20), 'shaft');
  B.mesh(pal, tube(2, 8, 4, 13, 32), 'steel');
  const legs = [];
  if (id === 'grasshopper') {
    for (const [j, pl] of D.pallets.entries()) {
      const q = pl.faces[0].q, toA = Math.hypot(...q), piv = [q[0] - q[0] / toA * 16, q[1] - q[1] / toA * 16];
      // the two arms cross at the hub: 0.4 mm apart in depth
      B.mesh(pal, slab(barShape([0, 0], piv, 5), 12 + 0.4 * j, 2.5, 0.3), 'steel');
      B.mesh(pal, (() => { const g = rod(1.3, 8.5, 15.6, 16); g.translate(piv[0], 0, -piv[1]); return g; })(), 'bolt');
      // the arm hinges on piv; its nib sits on the design nib point
      const leg = B.part('leg' + j, { info: 'legs', label: j ? null : 'Pallet arm', labelAt: [q[0] - piv[0], 11, -(q[1] - piv[1])], parent: pal.root, at: [piv[0], 0, -piv[1]], explode: [0, 25, 0], st: 0.5, en: 1 });
      const lq = [q[0] - piv[0], q[1] - piv[1]];
      // the nib pin stands 1.4 mm ahead of the design point (clear of the
      // tooth face). The arm runs 3 mm past it and is wide enough to hold
      // the whole pin, so no pin facet meets an arm wall.
      const av = [(A[1] + q[1]) / Math.hypot(A[0] + q[0], A[1] + q[1]), -(A[0] + q[0]) / Math.hypot(A[0] + q[0], A[1] + q[1])];
      const lL = Math.hypot(...lq), ux = [lq[0] / lL, lq[1] / lL], pc = [lq[0] + 1.4 * av[0], lq[1] + 1.4 * av[1]];
      const along = (pc[0] * ux[0] + pc[1] * ux[1]) + 3, lat = Math.abs(ux[0] * av[1] - ux[1] * av[0]) * 1.4;
      B.mesh(leg, slab(barShape([0, 0], [ux[0] * along, ux[1] * along], 2 * (lat + 1.25)), 9, 2.5, 0.25), 'bronze');
      const nib = rod(0.9, 4.5, 11, 16); nib.translate(pc[0], 0, -pc[1]); B.mesh(leg, nib, 'red');
      // the free arm swings out from the wheel (centre at -A), about its hinge
      const wq = [q[0] - (-A[0]), q[1] - (-A[1])];
      legs.push({ leg, out: Math.sign(-lq[1] * wq[0] + lq[0] * wq[1]) || 1 });
    }
  } else {
    for (const [k, ps] of palletShapes(D).entries()) {
      // pallet stones: red, as on jewelled regulators, so they read on the wheel
      B.mesh(pal, slab(ps.s, 4.5, 5.5, 0.3), 'red');
      // the arm from the hub to the back of the pallet, in front of the
      // wheel; the two arms cross at the hub, 0.4 mm apart in depth
      B.mesh(pal, slab(barShape([0, 0], ps.root, 6), 9.5 + 0.4 * k, 2.5, 0.3), 'steel');
    }
  }

  // ── pendulum ─────────────────────────────────────────────────────────────
  const pend = B.part('pendulum', { info: 'pendulum', label: 'Pendulum', labelAt: [14, 18, 300], at: at(A[0], A[1]), explode: [0, 150, 0], st: 0.35, en: 1 });
  const blk = new THREE.BoxGeometry(9, 6, 14); blk.translate(0, 18, 1); B.mesh(pend, blk, 'steel');
  const rodG = new THREE.CylinderGeometry(2, 2, 1, 16); rodG.translate(0, -0.5, 0); rodG.rotateX(-Math.PI / 2);
  const rodM = B.mesh(pend, rodG, 'shaft');
  rodM.position.set(0, 18, 7);
  const bob = B.part('bob', { info: 'bob', label: 'Bob', labelAt: [75, 18, 0], parent: pend.root, at: [0, 0, Lmm], explode: [0, 40, 0], st: 0.5, en: 1 });
  const lens = lathe([[[0.01, 4], [30, 7], [55, 13]], [[70, 18], [55, 23], [30, 29], [0.01, 32]]], 72);
  B.mesh(bob, lens, 'brass');
  const nut = new THREE.CylinderGeometry(6, 6, 9, 6); nut.rotateX(Math.PI / 2); nut.translate(0, 18, 84); B.mesh(bob, nut, 'bolt');
  const tail = new THREE.CylinderGeometry(2.5, 2.5, 18, 12); tail.rotateX(Math.PI / 2); tail.translate(0, 18, 76); B.mesh(bob, tail, 'shaft');
  const setLength = mm => { rodM.scale.set(1, 1, mm - 7); bob.root.position.z = mm; };
  setLength(Lmm);

  // ── pose ─────────────────────────────────────────────────────────────────
  // gear phases: a wheel of n2 teeth driven by a pinion of n1 leaves on the
  // line at angle dl: a pinion leaf on the line meets a wheel gap
  const mesh = (a1, n1, n2, dl) => dl + Math.PI - Math.PI / n2 - (n1 / n2) * (a1 - dl);
  const ang = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  let legK = [0, 0];
  return {
    pose(Q, dt = 0) {
      // a number a (tools/zfight-check): the pose of a running clock at 0.37 a s
      if (typeof Q === 'number') { const S = makeSim(u, { amp: 3.2 * Math.PI / 180 * (id === 'grasshopper' ? 1.3 : 1) }); S.run(Q * 0.37); Q = S; }
      const aE = -Q.phi;
      esc.spin(aE);
      const a3 = mesh(aE, 8, 60, ang(T.E, T.third)); third.spin(a3);
      const aC = mesh(a3, 8, 64, ang(T.third, T.centre)); centre.spin(aC);
      const aG = mesh(aC, 8, 96, ang(T.centre, T.great)); great.spin(aG);
      pal.spin(Q.th); pend.spin(Q.th);
      if (legs.length) for (let j = 0; j < 2; j++) {
        const want = Q.j === j && Q.mode !== 'drop' ? 0 : 1;
        legK[j] += (want - legK[j]) * Math.min(1, dt * 14 || 1);
        legs[j].leg.spin(legs[j].out * 0.16 * legK[j]);
      }
      return Q;
    },
    setLength,
    // world: (X, Y, z) after the turn of B.root
    box: { c: [0, (top + bottom) / 2, -30], R: 0.5 * Math.hypot(420, top - bottom) },
    keys: { escape: [0, 20, 8], pallets: [A[0], A[1], 8], train: [T.third[0], (T.third[1] + T.great[1]) / 2, -20], bob: [0, A[1] - Lmm, 18] },
    D, T, top, bottom,
  };
}

// ============================================================================
//  DIFFERENTIAL  ·  scene.js — the parts of each differential and their pose
// ────────────────────────────────────────────────────────────────────────────
//  build(B, variant) makes one differential with kit.js and gears.js and
//  returns sc: { carrier, pose(P), box, labels }. Every size comes from
//  diff.js, so the teeth that main.js turns with diff.pose() are the teeth
//  that meet in the picture.
//
//  LAYOUT (mm; the axle on x, y up, the drive pinion in from +z)
//    ring gear ......... spiral bevel, 41 teeth, heel at x = −29, bolted to
//                        the left case flange (x −56 … −48)
//    drive pinion ...... 11 teeth on +z, stem to the companion flange
//    carrier ........... two case halves split at x = 0; it turns about x
//      open / clutch ... 2 spiders on a cross-shaft (y), 2 side gears (x)
//      clutch .......... a plate pack and a Belleville spring behind each
//                        side gear (steel plates keyed to the case, lined
//                        plates splined to the side gear)
//      torsen .......... helical side gears and 3 pairs of element gears
//    housing ........... banjo shell and pinion nose, cut at y = 0
//    half-shafts ....... from the side gear splines to the wheel flanges
//
//  GREP MAP
//    function bearing ......... a tapered roller bearing
//    function caseRows ........ the carrier case profile of each variant
//    function bevelSet ........ ring and pinion (all variants)
//    function bevelInside ..... side gears, spiders, cross-shaft, clutches
//    function helicalInside ... Torsen side gears and element pairs
//    function axles ........... half-shafts and wheels
//    sc.pose .................. every part from one diff.pose() result
// ============================================================================
import * as THREE from 'three';
import { lathe, poly, tube, rod, merge, shell, slab, circle, hex } from './kit.js';
import { bevelTeeth, helicalTeeth } from './gears.js';
import { BEV, HEL, SPEC, spiral } from './diff.js';

const TAU = Math.PI * 2;
const X = [1, 0, 0], NX = [-1, 0, 0], Yv = [0, 1, 0], NY = [0, -1, 0], Z = [0, 0, 1];
const place = (g, x, z) => { g.translate(x, 0, z); return g; };

// a tapered roller bearing about local Y: cone (inner race), cup (outer
// race) and rollers. The big end of the taper is at y0.
function bearing(rIn, rOut, y0, y1, n = 16) {
  const w = y1 - y0, t = (rOut - rIn) * 0.26;
  const cone = poly([[rIn + t * 1.2, y0], [rIn + t * 1.2, y0 + 1.6], [rIn + t * 0.75, y0 + 2.2], [rIn + t * 0.75, y1 - 0.8], [rIn + t * 0.55, y1], [rIn, y1], [rIn, y0]], 48);
  const cup = poly([[rOut, y0 + 0.6], [rOut, y1], [rOut - t * 0.9, y1], [rOut - t * 1.25, y0 + 0.6]], 48);
  const rm = (rIn + rOut) / 2, rr = (rOut - rIn) * 0.2, L = w * 0.78, tilt = Math.atan2(t * 0.45, L);
  const rollers = [];
  for (let i = 0; i < n; i++) {
    const g = poly([[rr * 1.12, -L / 2], [rr * 0.88, L / 2], [0, L / 2], [0, -L / 2]], 14);
    g.rotateZ(tilt); g.translate(rm, (y0 + y1) / 2, 0); g.rotateY(i / n * TAU);
    rollers.push(g);
  }
  return { cone, cup, rollers: merge(rollers) };
}

// carrier case rows { y, ro, ri } for one half (y = |x|); the left half
// carries the ring gear flange (x −56 … −48). Straight runs are cut into
// 3 mm rows so the windows and the cross-shaft holes resolve.
const CASE = {
  open: { R: [[0, 60, 52], [37.5, 60, 52], [38, 60, 21], [46, 57, 21], [49, 34, 21]],
    L: [[0, 60, 52], [37.5, 60, 52], [38, 60, 21], [46, 59, 21], [48, 60, 21], [48, 86, 21], [56, 86, 21], [56, 34, 21]] },
  clutch: { R: [[0, 60, 52], [58, 60, 52], [58.5, 60, 21], [66, 57, 21], [69, 34, 21]],
    L: [[0, 60, 52], [48, 60, 52], [48, 86, 52], [56, 86, 52], [56, 60, 52], [58, 60, 52], [58.5, 60, 21], [66, 57, 21], [69, 34, 21]] },
  torsen: { R: [[0, 64, 58], [52, 64, 58], [52.5, 64, 21], [60, 61, 21], [63, 34, 21]],
    L: [[0, 64, 58], [48, 64, 58], [48, 86, 58], [52, 86, 58], [52.5, 86, 21], [56, 86, 21], [56, 64, 21], [60, 61, 21], [63, 34, 21]] },
};
function caseRows(variant, left) {
  const src = [...CASE[variant][left ? 'L' : 'R'], [88, 30, 21], [90, 28, 21], [112, 28, 21]], rows = [];
  for (let i = 0; i < src.length; i++) {
    const [y, ro, ri] = src[i];
    rows.push({ y, ro, ri });
    const n = src[i + 1];
    if (n && n[1] === ro && n[2] === ri && n[0] - y > 3) for (let k = 1, c = Math.ceil((n[0] - y) / 3); k < c; k++) rows.push({ y: y + (n[0] - y) * k / c, ro, ri });
  }
  return rows;
}

export function build(B, variant) {
  const sc = { variant, labels: [] };
  const carrier = new THREE.Group(); B.root.add(carrier);
  sc.carrier = carrier;
  const P = {};   // the parts that pose() turns
  const caseX = { open: 150, clutch: 230, torsen: 165 }[variant];

  // ── housing (world, cut) ─────────────────────────────────────────────────
  {
    const housing = B.part('housing', { u: X, e0: Yv, cut: true, explode: [0, 330, 0], st: 0, en: 0.45, label: 'Axle housing', labelAt: [-150, 128, 0], labelWorld: true });
    const ro = x => {
      const ax = Math.abs(x);
      const bowl = Math.sqrt(Math.max(0, 138 * 138 - ((x + 12) * 1.15) ** 2));
      const brg = ax < 118 ? 64 : ax < 128 ? 64 - (ax - 118) * 2.6 : 38;
      return Math.max(bowl, brg);
    };
    const rows = [];
    for (let i = 0; i <= 120; i++) { const x = -290 + 580 * i / 120, r = ro(x); rows.push({ y: x, ro: r, ri: r > 40 ? r - 7 : 30 }); }
    // the nose opening (toward +z) and the cut-away top are holes in the wall
    const hole = (x, phi) => { const r = ro(x), yw = r * Math.cos(phi), zw = r * Math.sin(phi); return zw > 0 && x * x + yw * yw < 56 * 56; };
    B.mesh(housing, shell(rows, 128, hole), 'paint');
    // bearing saddles (machined faces inside the bearing bores)
    for (const s of [-1, 1]) B.mesh(housing, tube(46.5, 57, s > 0 ? 88 : -118, s > 0 ? 118 : -88, 64), 'cast');
    const nose = B.part('nose', { info: 'housing', u: Z, e0: X, cut: true, explode: [0, 330, 0], st: 0, en: 0.45 });
    const nrows = [];
    for (let i = 0; i <= 24; i++) { const z = 112 + 100 * i / 24; let r = 60 - (z - 112) * 0.07; if (z > 200) r = 68; nrows.push({ y: z, ro: r, ri: z > 200 ? 46 : 50 }); }
    B.mesh(nose, shell(nrows, 64), 'paint');
    B.mesh(nose, tube(26, 46, 208, 212, 48), 'rubber');   // the pinion seal
    P.housing = housing; P.nose = nose;
  }

  // ── ring and pinion ─────────────────────────────────────────────────────
  {
    const A = BEV.A, F = SPEC.ring.F, m = SPEC.ring.m;
    const ring = B.part('ring', { u: NX, e0: Yv, parent: carrier, explode: [-caseX - 95, 0, 0], st: 0.18, label: 'Ring gear', labelAt: [-34, 124, 0], labelWorld: true });
    const T = bevelTeeth({ ...SPEC.ring, m, gam: BEV.gR, A, F, slices: 8, spiral: s => spiral(s, BEV.gR, 1), depth: 0.9 });
    B.mesh(ring, T.geom, 'ring');
    const h = T.map(T.rin, 0, A), t = T.map(T.rin, 0, A - F);
    const hR = Math.hypot(h[0], h[2]), tR = Math.hypot(t[0], t[2]);
    B.mesh(ring, poly([[66, t[1] + 1.2], [tR, t[1]], [hR, h[1]], [hR + 2.2, h[1] + 1.4], [hR + 2.2, 48], [66, 48]], 128), 'ring');
    const bolts = [];
    for (let i = 0; i < 10; i++) { const a = (i + 0.5) / 10 * TAU; bolts.push(place(hex(6.5, 56, 6), 77 * Math.cos(a), 77 * Math.sin(a))); bolts.push(place(rod(5.2, 40, 56, 12), 77 * Math.cos(a), 77 * Math.sin(a))); }
    B.mesh(ring, merge(bolts), 'bolt');
    P.ring = ring;

    const pin = B.part('pinion', { u: Z, e0: X, explode: [0, 0, 130], st: 0.1, label: 'Drive pinion', labelAt: [0, 96, -40] });
    const Tp = bevelTeeth({ ...SPEC.pinion, m, gam: BEV.gP, A, F, slices: 8, spiral: s => spiral(s, BEV.gP, BEV.sgnP), depth: 0.6 });
    B.mesh(pin, Tp.geom, 'gear');
    const ph = Tp.map(Tp.rin, 0, A), pt = Tp.map(Tp.rin, 0, A - F);
    const phR = Math.hypot(ph[0], ph[2]), ptR = Math.hypot(pt[0], pt[2]);
    B.mesh(pin, poly([[0.01, pt[1] - 2], [ptR, pt[1]], [phR, ph[1]], [phR, ph[1] + 3], [24, ph[1] + 6], [24, 134], [21, 136], [21, 247], [0.01, 247]], 48), 'shaft');
    P.pinion = pin;

    const yoke = B.part('yoke', { u: Z, e0: X, explode: [0, 0, 330], st: 0.05, label: 'Companion flange', labelAt: [0, 232, -64] });
    const fl = new THREE.Shape(); fl.absarc(0, 0, 58, 0, TAU, false);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; fl.holes.push(circle(6, 44 * Math.cos(a), 44 * Math.sin(a))); }
    fl.holes.push(circle(21.2));
    B.mesh(yoke, slab(fl, 224, 12, 0.8), 'cast');
    B.mesh(yoke, poly([[21.2, 200], [31, 202], [33, 224], [21.2, 224]], 48), 'shaft');
    B.mesh(yoke, merge([hex(17, 236, 9), tube(21, 24, 245, 248, 24)]), 'bolt');
    P.yoke = yoke;

    const b1 = bearing(24, 42, 118, 134), b2 = bearing(21, 36, 182, 194);
    const pb1 = B.part('pinionBrg1', { info: 'pinionBrg', u: Z, e0: X, explode: [0, 0, 210], st: 0.08, label: 'Pinion bearings', labelAt: [0, 126, -48] });
    const pb2 = B.part('pinionBrg2', { info: 'pinionBrg', u: Z, e0: X, explode: [0, 0, 270], st: 0.06 });
    for (const [p, b] of [[pb1, b1], [pb2, b2]]) { B.mesh(p, b.cone, 'steel'); B.mesh(p, b.cup, 'steel'); B.mesh(p, b.rollers, 'steel'); }
    // carrier bearings on the case trunnions
    for (const s of [1, -1]) {
      const p = B.part(s > 0 ? 'cBrgR' : 'cBrgL', { info: 'carrierBrg', u: s > 0 ? X : NX, e0: Yv, explode: [0, 150, 0], st: 0.12, label: s > 0 ? 'Carrier bearing' : null, labelAt: [100, 58, 0], labelWorld: true });
      const b = bearing(28, 46, 92, 112);
      B.mesh(p, b.cone, 'steel'); B.mesh(p, b.cup, 'steel'); B.mesh(p, b.rollers, 'steel');
    }
  }

  // ── carrier case halves ──────────────────────────────────────────────────
  for (const s of [1, -1]) {
    const left = s < 0;
    const half = B.part(left ? 'caseL' : 'caseR', { info: 'case', u: left ? NX : X, e0: Yv, parent: carrier, cut: true, explode: [s * caseX, 0, 0], st: 0.2, label: left ? null : 'Carrier case', labelAt: [42, 66, 0], labelWorld: true });
    // beta: the carrier angle from +y toward +z (left half: mirrored)
    const win = {
      open: b => [Math.PI / 2, 1.5 * Math.PI].some(c => Math.abs(Math.atan2(Math.sin(b - c), Math.cos(b - c))) < 40 * Math.PI / 180),
      clutch: b => [Math.PI / 2, 1.5 * Math.PI].some(c => Math.abs(Math.atan2(Math.sin(b - c), Math.cos(b - c))) < 24 * Math.PI / 180),
      torsen: b => [30, 150, 270].some(c => Math.abs(Math.atan2(Math.sin(b - c * Math.PI / 180), Math.cos(b - c * Math.PI / 180))) < 17 * Math.PI / 180),
    }[variant];
    const wLen = { open: 31, clutch: 24, torsen: 36 }[variant];
    const hole = (y, phi) => {
      const b = left ? -phi : phi;
      if (y < wLen && win(b)) return true;
      if (variant !== 'torsen' && y < 8.6) return [0, Math.PI].some(c => Math.abs(Math.atan2(Math.sin(b - c), Math.cos(b - c))) * 56 < 8.6);
      return false;
    };
    B.mesh(half, shell(caseRows(variant, left), 112, hole), 'cast');
    // the bolts that join the halves, on a ring outside the windows
    if (variant !== 'open') {
      const bolts = [], ro = variant === 'torsen' ? 64 : 60;
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; bolts.push(place(hex(4.6, wLen + 2, 3.5), (ro - 6) * Math.cos(a), (ro - 6) * Math.sin(a))); }
      if (!left) B.mesh(half, merge(bolts), 'bolt');
    }
    P[left ? 'caseL' : 'caseR'] = half;
  }

  if (variant === 'torsen') helicalInside(B, sc, P, carrier);
  else bevelInside(B, sc, P, carrier, variant);
  axles(B, P, variant);

  sc.box = { c: [0, 0, 40], R: 390 };
  sc.P = P;
  sc.pose = Q => {
    carrier.rotation.x = Q.phiC;
    P.pinion.spin(Q.pinion); P.yoke.spin(Q.pinion);
    if (variant === 'torsen') {
      P.sideL.spin(Q.sideL); P.sideR.spin(Q.sideR);
      for (let i = 0; i < P.A.length; i++) { P.A[i].spin(Q.A[i]); P.B[i].spin(Q.B[i]); }
    } else {
      P.sideR.spin(Q.sideR); P.sideL.spin(Q.sideL);
      P.spiderT.spin(Q.spiderT); P.spiderB.spin(Q.spiderB);
      for (const p of P.platesR || []) p.spin(Q.sideR);
      for (const p of P.platesL || []) p.spin(Q.sideL);
    }
    P.axleR.spin(Q.wheelR); P.wheelR.spin(Q.wheelR);
    P.axleL.spin(-Q.wheelL); P.wheelL.spin(-Q.wheelL);
  };
  return sc;
}

// ── bevel gear set inside the carrier (open and clutch) ────────────────────
function bevelInside(B, sc, P, carrier, variant) {
  const A2 = BEV.A2, F2 = SPEC.side.F, m = SPEC.side.m, clutch = variant === 'clutch';
  const sideX = clutch ? 70 : 62;
  for (const s of [1, -1]) {
    const id = s > 0 ? 'sideR' : 'sideL';
    const p = B.part(id, { info: 'side', u: s > 0 ? X : NX, e0: Yv, parent: carrier, explode: [s * sideX, 0, 0], st: 0.34, label: s > 0 ? 'Side gear' : null, labelAt: [30, 50, 0], labelWorld: true });
    const T = bevelTeeth({ ...SPEC.side, m, gam: BEV.gS, A: A2, F: F2, slices: 2 });
    B.mesh(p, T.geom, 'gear');
    const h = T.map(T.rin, 0, A2), t = T.map(T.rin, 0, A2 - F2);
    const hR = Math.hypot(h[0], h[2]), tR = Math.hypot(t[0], t[2]);
    const backR = hR + (36 - h[1]) * Math.tan(BEV.gS);
    if (clutch) {
      B.mesh(p, poly([[14, t[1] - 1], [tR, t[1]], [hR, h[1]], [backR, 36], [17, 36], [17, 57], [20, 58], [20, 74], [14, 74]], 64), 'gear');
      B.mesh(p, helicalTeeth({ N: 24, m: 1.5, y0: 36.5, y1: 57, ha: 0.8, hf: 1.0, t: 0.5, rin: 16.5, slices: 2 }).geom, 'gear');
    } else B.mesh(p, poly([[14, t[1] - 1], [tR, t[1]], [hR, h[1]], [backR, 36], [20, 36], [20, 74], [14, 74]], 64), 'gear');
    P[id] = p;
    if (!clutch) {
      const w = B.part(s > 0 ? 'washerR' : 'washerL', { info: 'washer', u: s > 0 ? X : NX, e0: Yv, parent: carrier, explode: [s * (sideX + 22), 0, 0], st: 0.3 });
      B.mesh(w, tube(20.6, 40, 36.1, 37.8, 64), 'bronze');
    }
  }
  // spiders and the cross-shaft
  for (const [id, u] of [['spiderT', Yv], ['spiderB', NY]]) {
    const p = B.part(id, { info: 'spider', u, e0: X, parent: carrier, explode: u[1] > 0 ? [0, 78, 0] : [0, -78, 0], st: 0.4, label: u[1] > 0 ? 'Spider gear' : null, labelAt: [0, 54, 0] });
    const T = bevelTeeth({ ...SPEC.spider, m, gam: BEV.gQ, A: A2, F: F2, slices: 2 });
    B.mesh(p, T.geom, 'gear');
    const h = T.map(T.rin, 0, A2), t = T.map(T.rin, 0, A2 - F2);
    const hR = Math.hypot(h[0], h[2]), tR = Math.hypot(t[0], t[2]);
    const arc = []; const r0 = hR + 1.2;
    for (let i = 0; i <= 8; i++) { const r = r0 + (9.8 - r0) * i / 8; arc.push([r, Math.sqrt(50 * 50 - r * r)]); }
    B.mesh(p, lathe([[[8.6, t[1] - 1]], [[tR, t[1]]], [[hR, h[1]]], arc, [[8.6, Math.sqrt(50 * 50 - 8.6 * 8.6)]]], 48), 'gear');
    P[id] = p;
  }
  const cs = B.part('crossShaft', { u: Yv, e0: X, parent: carrier, explode: [0, 0, 160], st: 0.36, label: 'Cross-shaft', labelAt: [0, 30, 0] });
  B.mesh(cs, rod(8, -57, 57, 24), 'shaft');
  // lock bolt through the case, across the shaft end
  const lb = rod(2.4, -6, 6, 12); lb.rotateZ(Math.PI / 2); lb.translate(0, 50, 0);
  B.mesh(cs, lb, 'bolt');

  if (!clutch) return;
  // plate packs: S F S F S F S, then the Belleville spring
  for (const s of [1, -1]) {
    const key = s > 0 ? 'platesR' : 'platesL';
    P[key] = [];
    let y = 36.4;
    for (let i = 0; i < 7; i++) {
      const steel = i % 2 === 0, w = steel ? 2.0 : 2.4;
      const p = B.part(`${key}${i}`, { info: steel ? 'steelPlate' : 'frictionPlate', u: s > 0 ? X : NX, e0: Yv, parent: carrier, explode: [s * (sideX + 20 + 15 * i), 0, 0], st: 0.3 + 0.012 * i, label: s > 0 && i === 3 ? 'Clutch pack' : null, labelAt: [44 + 5 * i, 58, 0], labelWorld: true });
      if (steel) {
        const sh = new THREE.Shape(); const R = 47, L = 51, a = Math.asin(5 / R);
        for (let k = 0; k < 4; k++) {
          const c = k / 4 * TAU + Math.PI / 4;
          if (k === 0) sh.moveTo(R * Math.cos(c - Math.PI / 4 + a), R * Math.sin(c - Math.PI / 4 + a));
          sh.absarc(0, 0, R, c - Math.PI / 4 + a, c - a, false);
          sh.lineTo(L * Math.cos(c - a * R / L), L * Math.sin(c - a * R / L));
          sh.lineTo(L * Math.cos(c + a * R / L), L * Math.sin(c + a * R / L));
          sh.lineTo(R * Math.cos(c + a), R * Math.sin(c + a));
        }
        sh.holes.push(circle(21.5));
        B.mesh(p, slab(sh, y, w, 0.25), 'plate');
      } else {
        B.mesh(p, merge([tube(24, 45.5, y + 0.05, y + w - 0.05, 72)]), 'lining');
        B.mesh(p, tube(19.6, 24.2, y + 0.3, y + w - 0.3, 48), 'plate');
        P[key].push(p);
      }
      y += w + 0.3;
    }
    const sp = B.part(s > 0 ? 'springR' : 'springL', { info: 'spring', u: s > 0 ? X : NX, e0: Yv, parent: carrier, explode: [s * (sideX + 135), 0, 0], st: 0.26, label: s > 0 ? 'Preload spring' : null, labelAt: [140, 40, 0], labelWorld: true });
    B.mesh(sp, poly([[23, 57.0], [47, 54.0], [47, 55.4], [23, 58.4]], 72), 'spring');
  }
}

// ── Torsen type 2 (helical) inside the carrier ─────────────────────────────
function helicalInside(B, sc, P, carrier) {
  const h = SPEC.hel;
  for (const s of [1, -1]) {
    const id = s > 0 ? 'sideR' : 'sideL';
    const p = B.part(id, { info: 'hside', u: X, e0: Yv, parent: carrier, explode: [s * 80, 0, 0], st: 0.34, label: s > 0 ? 'Helical side gear' : null, labelAt: [30, 36, 0], labelWorld: true });
    const y0 = s > 0 ? h.side[0] : -h.side[1], y1 = s > 0 ? h.side[1] : -h.side[0];
    B.mesh(p, helicalTeeth({ N: h.NS, m: h.m, y0, y1, ...h.sideT, alpha: HEL.alpha, rin: 14, slices: 16, twist: s > 0 ? HEL.twist.R : HEL.twist.L }).geom, 'gear');
    const hub = s > 0 ? tube(14, 20, 50, 74, 48) : tube(14, 20, -74, -50, 48);
    B.mesh(p, hub, 'gear');
    P[id] = p;
    const w = B.part(s > 0 ? 'washerR' : 'washerL', { info: 'washer', u: X, e0: Yv, parent: carrier, explode: [s * 100, 0, 0], st: 0.3 });
    B.mesh(w, s > 0 ? tube(20.6, 33, 50.2, 52, 64) : tube(20.6, 33, -52, -50.2, 64), 'bronze');
  }
  const sp = B.part('spacer', { u: X, e0: Yv, parent: carrier, explode: [0, 0, 0], st: 0.3 });
  B.mesh(sp, tube(6, 21, -8.5, 8.5, 48), 'steel');
  P.A = []; P.B = [];
  HEL.pairs.forEach((c, i) => {
    for (const [k, cen, rng, tw, list] of [['A', c.cA, h.pinA, HEL.twist.A, P.A], ['B', c.cB, h.pinB, HEL.twist.B, P.B]]) {
      const dir = [0, cen[1] / HEL.Rc, cen[2] / HEL.Rc];
      const p = B.part(`elem${k}${i}`, { info: 'elem' + k, u: X, e0: Yv, parent: carrier, at: cen, explode: dir.map(v => v * 80), st: 0.38, label: i === 0 ? (k === 'A' ? 'Element gear (left)' : 'Element gear (right)') : null, labelAt: [0, k === 'A' ? -30 : 30, 0] });
      B.mesh(p, helicalTeeth({ N: h.NP, m: h.m, y0: rng[0], y1: rng[1], ...h.pinT, alpha: HEL.alpha, rin: 0, slices: 18, twist: tw }).geom, 'gear');
      list.push(p);
    }
  });
}

// ── half-shafts and wheels ─────────────────────────────────────────────────
function axles(B, P, variant) {
  const inner = variant === 'torsen' ? 12 : 24;
  for (const s of [1, -1]) {
    const R = s > 0;
    const ax = B.part(R ? 'axleR' : 'axleL', { info: 'axle', u: R ? X : NX, e0: Yv, explode: [s * 150, 0, 0], st: 0.1, label: R ? 'Half-shaft' : null, labelAt: [200, 30, 0], labelWorld: true });
    B.mesh(ax, helicalTeeth({ N: 20, m: 1.3, y0: inner, y1: 70, ha: 0.7, hf: 1.0, t: 0.5, rin: 10, slices: 2 }).geom, 'shaft');
    B.mesh(ax, poly([[10.2, inner], [10.2, 70], [13, 72], [13, 336], [17, 342], [17, 348], [0.01, 348], [0.01, inner]], 32), 'shaft');
    const fl = new THREE.Shape(); fl.absarc(0, 0, 62, 0, TAU, false);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; fl.holes.push(circle(4.6, 48 * Math.cos(a), 48 * Math.sin(a))); }
    B.mesh(ax, slab(fl, 348, 8, 0.8), 'shaft');
    const studs = []; for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; studs.push(place(rod(4.4, 350, 378, 12), 48 * Math.cos(a), -48 * Math.sin(a))); }
    B.mesh(ax, merge(studs), 'bolt');
    P[R ? 'axleR' : 'axleL'] = ax;

    // the wheel: tyre, rim barrel, an outboard 5-spoke disc on the hub flange
    const wh = B.part(R ? 'wheelR' : 'wheelL', { info: R ? 'wheelR' : 'wheelL', u: R ? X : NX, e0: Yv, explode: [s * 165, 0, 0], st: 0.06, label: R ? 'Right wheel' : 'Left wheel', labelAt: [s * 336, 168, 0], labelWorld: true });
    B.mesh(wh, lathe([[[108, 303], [124, 301], [140, 304], [149, 312], [151, 324], [151, 344], [149, 356], [140, 364], [124, 367]], [[108, 365]]], 96), 'rubber');
    // tread blocks on the crown, so the turn of each wheel is easy to see
    const tread = []; for (let i = 0; i <= 20; i++) { const y = 315 + 38 * i / 20; tread.push({ y, ro: 153.2, ri: 149 }); }
    B.mesh(wh, shell(tread, 144, (y, f) => Math.abs(y - 334) < 2.2 || Math.floor(f / TAU * 48 + (y > 334 ? 0.5 : 0)) % 2 === 0 && Math.abs(Math.sin(f * 24)) < 0.35), 'rubber');
    B.mesh(wh, poly([[110, 300], [110, 303], [104, 305], [104, 363], [110, 365], [110, 368], [101, 368], [101, 300]], 96), 'alu');
    const disc = new THREE.Shape(); disc.absarc(0, 0, 102, 0, TAU, false);
    for (let i = 0; i < 5; i++) { const a = (i + 0.5) / 5 * TAU; disc.holes.push(circle(26, 70 * Math.cos(a), 70 * Math.sin(a))); }
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; disc.holes.push(circle(5, 48 * Math.cos(a), 48 * Math.sin(a))); }
    disc.holes.push(circle(28));
    B.mesh(wh, slab(disc, 356, 9, 1.2), 'alu');
    const nuts = []; for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; nuts.push(place(hex(7, 365, 8), 48 * Math.cos(a), -48 * Math.sin(a))); }
    B.mesh(wh, merge(nuts), 'steel');
    const valve = rod(3, 0, 16, 10); valve.rotateZ(Math.PI / 2); valve.translate(101, 356, 0);
    B.mesh(wh, valve, 'red');
    P[R ? 'wheelR' : 'wheelL'] = wh;
  }
}

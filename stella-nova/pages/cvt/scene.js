// ============================================================================
//  CVT  ·  scene.js — the parts of each CVT and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one unit with kit.js and returns sc: { pose(th, x),
//  box, keys, section }. Radii, sheave gaps, belt loop and roller tilt come
//  from model.js, so what moves on screen is what the tests check.
//  pose(th, x) keeps state: it adds the input step th - last th to the
//  belt travel, the output angle and the roller spin, so the ratio can
//  change while the unit runs. x is the ratio control, 0..1.
//
//  PUSH BELT (shafts on world z, belt in the x-y plane, view from +z)
//    pulley 1 (input) ... centre x = -C/2. Fixed sheave on the -z side, a
//                         part of the input shaft; movable sheave on +z with
//                         a servo skirt in a cylinder (its own part, cyl1)
//    pulley 2 (output) .. x = +C/2, the same parts turned 180 deg about x:
//                         the movable sheave is on -z (diagonal layout)
//    belt ............... N steel elements (InstancedMesh) on the pitch loop,
//                         two steel band packs in their saddles (parts bands
//                         and bands2, ribbons made again when the ratio
//                         changes)
//    case ............... a back plate with two bearing bosses, z -102..-90
//    Section: the pulleys are cut at y = 0, so the belt shows in the V.
//  TOROIDAL (main axis on world x, input disc at x < 0)
//    discs .............. turned profiles: back, rim, the cavity arc, the
//                         flat face at |x| = GAP/2. Cut at y = 0 (section)
//    rollers ............ 2, at z = +E and z = -E. Each roller rides in a
//                         carrier that tilts about the core tangent (world y)
//    frame .............. one part per roller (frame0, frame1): pin holders,
//                         posts, a beam over the roller and columns beside
//                         the discs; the base
//  EXPLODE: see the EXPLODE ORDER notes in belt() and toroidal(). Run the
//  part-crossing sweep after you change an explode vector or span.
//
//  NO Z-FIGHTING. Faces of two parts never share a plane where they
//  overlap. Gaps: element flanks 0.5 mm off the sheave faces; sleeve and
//  skirt 0.4 mm off shaft and cylinder; bands 0.3 mm off the element
//  saddle and head; roller rim 0.4 mm (the oil film) off the discs; boss
//  and leg ends sink 0.3 mm into the faces they stand on.
//
//  GREP MAP
//    function hexa ............ a convex 8-corner solid (belt elements)
//    function elementGeo ...... one push-belt element
//    function bandGeo ......... the band pack ribbon, filled by fillBand
//    function belt ............ push-belt parts and pose
//    function discGeo ......... a toroidal disc profile
//    function toroidal ........ toroidal parts and pose
// ============================================================================
import * as THREE from 'three';
import { rod, tube, poly, lathe, slab, merge } from './kit.js';
import { unit, beltState, beltPoint, sheaveS, rMid, L0, toroState, arcEnd, TAU } from './model.js';

// a convex solid from 8 corners: c[0..3] one end, c[4..7] the other, in
// the same order round. Flat normals; each face turned to face outward.
function hexa(c) {
  const P = [], N = [], m = c.reduce((a, p) => [a[0] + p[0] / 8, a[1] + p[1] / 8, a[2] + p[2] / 8], [0, 0, 0]);
  const F = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const v = new THREE.Vector3(), w = new THREE.Vector3(), n = new THREE.Vector3();
  for (let [a, b, cc, d] of F) {
    v.set(c[b][0] - c[a][0], c[b][1] - c[a][1], c[b][2] - c[a][2]);
    w.set(c[cc][0] - c[a][0], c[cc][1] - c[a][1], c[cc][2] - c[a][2]);
    n.crossVectors(v, w).normalize();
    const fc = [0, 1, 2].map(k => (c[a][k] + c[b][k] + c[cc][k] + c[d][k]) / 4);
    if (n.x * (fc[0] - m[0]) + n.y * (fc[1] - m[1]) + n.z * (fc[2] - m[2]) < 0) { [b, d] = [d, b]; n.negate(); }
    for (const k of [a, b, cc, a, cc, d]) { P.push(...c[k]); N.push(n.x, n.y, n.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}
const box = (x0, x1, y0, y1, z0, z1) => hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]);

// One element in its own frame: x along the belt (thickness), y out from
// the pulley (0 = pitch line), z across. The body tapers below the rocking
// line so neighbours clear on the smallest arc; its flanks follow the
// sheave angle, CLEAR inside the sheave faces. A neck and a head above
// hold the two band packs.
function elementGeo(u) {
  const tb = Math.tan(u.BETA), w0 = u.BW / 2 - u.CLEAR, d = u.DEPTH;
  const t0 = u.T_TOP / 2, t1 = u.T_LOW / 2, w1 = w0 - d * tb;
  const body = hexa([[-t1, -d, -w1], [t1, -d, -w1], [t1, -d, w1], [-t1, -d, w1], [-t0, 0, -w0], [t0, 0, -w0], [t0, 0, w0], [-t0, 0, w0]]);
  const neck = box(-0.8, 0.8, -0.2, 2.6, -2, 2);
  const head = hexa([[-1, 2.4, -13], [1, 2.4, -13], [1, 2.4, 13], [-1, 2.4, 13], [-1, u.HEAD, -9], [1, u.HEAD, -9], [1, u.HEAD, 9], [-1, u.HEAD, 9]]);
  return merge([body, neck, head]);
}

// The band packs: two closed ribbons, cross-section h 0.3..2.1 above the
// pitch line, |z| 2.4..13.6. Each pack is its own geometry (b = 0: +z side,
// b = 1: -z side), so each can slide out to its own side in the exploded
// view. M samples, 4 sides, 2 vertices per side per sample (flat sides).
// fillBand writes the positions and normals.
const BAND = { h0: 0.3, h1: 2.1, z0: 2.4, z1: 13.6, M: 480 };
function bandGeo() {
  const M = BAND.M, nv = 4 * 2 * M, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let s = 0; s < 4; s++) {
    const base = s * 2 * M;
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M, a0 = base + 2 * k, b0 = a0 + 1, a1 = base + 2 * k1, b1 = a1 + 1;
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  }
  g.setIndex(idx);
  return g;
}
// each side: two corners (h, z) in order so that (a1 - a0) x (b0 - a0)
// points out of the side, along the loop
function fillBand(g, u, st, zAt, b) {
  const pos = g.attributes.position, nor = g.attributes.normal, M = BAND.M, { h0, h1, z0, z1 } = BAND;
  for (let k = 0; k < M; k++) {
    const q = beltPoint(u, st, st.L * k / M), zc = zAt(q);
    {
      const sg = b ? -1 : 1, za = sg * z0, zb = sg * z1;
      // sides: out (h1), in (h0), far z (zb), near z (za). Corner pairs are
      // listed in the travel-right-hand order for a counter-clockwise loop.
      const S = [
        [[h1, zb], [h1, za], [q.n[0], q.n[1], 0]],
        [[h0, za], [h0, zb], [-q.n[0], -q.n[1], 0]],
        [[h0, zb], [h1, zb], [0, 0, sg]],
        [[h1, za], [h0, za], [0, 0, -sg]],
      ];
      for (let s = 0; s < 4; s++) {
        let [c0, c1, nn] = S[s];
        if (sg < 0) [c0, c1] = [c1, c0];
        const i0 = (s * 2 * M) + 2 * k;
        pos.setXYZ(i0, q.p[0] + q.n[0] * c0[0], q.p[1] + q.n[1] * c0[0], zc + c0[1]);
        pos.setXYZ(i0 + 1, q.p[0] + q.n[0] * c1[0], q.p[1] + q.n[1] * c1[0], zc + c1[1]);
        nor.setXYZ(i0, ...nn); nor.setXYZ(i0 + 1, ...nn);
      }
    }
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
  g.computeBoundingBox(); g.computeBoundingSphere();
}

// ── push belt ───────────────────────────────────────────────────────────────
function belt(B, u) {
  const tb = Math.tan(u.BETA), RO = u.R_OUT, c1 = -u.C / 2, c2 = u.C / 2;
  const sm = sheaveS(u, rMid(u)), Z1 = -sm / 2, Z2 = sm / 2;   // fixed face planes at r = 0
  const aF = -RO * tb, aB = aF - 4;                              // fixed sheave rim face, back
  const PLATE = -90;

  // case: back plate with two bearing bosses
  const cs = B.part('case', { info: 'base', label: 'Case', labelAt: [c2 + 70, -70, 0], u: [0, 0, 1], explode: [0, 0, -150], st: 0, en: 0.5 });
  const outline = new THREE.Shape(), W = u.C / 2 + RO + 16, H = RO + 16, rr = 40;
  outline.moveTo(-W + rr, -H); outline.lineTo(W - rr, -H); outline.absarc(W - rr, -H + rr, rr, -Math.PI / 2, 0, false); outline.lineTo(W, H - rr);
  outline.absarc(W - rr, H - rr, rr, 0, Math.PI / 2, false); outline.lineTo(-W + rr, H); outline.absarc(-W + rr, H - rr, rr, Math.PI / 2, Math.PI, false);
  outline.lineTo(-W, -H + rr); outline.absarc(-W + rr, -H + rr, rr, Math.PI, 1.5 * Math.PI, false);
  // the shape (x, y) lands on world (x, y): local x = x, local -z = -y
  B.mesh(cs, slab(outline, PLATE - 12, 12, 1.2), 'paint');
  for (const cx of [c1, c2]) { const g = tube(u.SHAFT + 0.4, 26, PLATE - 0.3, PLATE + 14, 64); g.translate(cx, 0, 0); B.mesh(cs, g, 'cast'); }

  // a pulley: shaft + fixed sheave (one part), movable sheave + skirt
  // (another), servo cylinder (a third). dir +1: local a = world z,
  // dir -1: a = -z.
  // EXPLODE ORDER. The belt loop goes round both shafts, and the servo
  // cylinder is wider than the skirt but narrower than the sheave rim. So
  // the cylinder leaves first, out along the shaft past the movable sheave;
  // the movable sheave follows it a shorter way; then the shaft pulls its
  // fixed sheave out of the belt plane the other way (the case is already
  // gone). The belt stays where it runs, and last each band pack slides
  // out of the element saddles to its own side. No two parts cross on the
  // way or at the end.
  const pulley = (k, cx, Z, dir, nameIn) => {
    const u3 = [0, 0, dir], back = dir > 0 ? PLATE - 6 - Z : Z - (PLATE - 6), front = k === 1 ? 100 : -50;
    const sh = B.part('shaft' + k, { info: k === 1 ? 'in' : 'out', label: nameIn, labelAt: [0, k === 1 ? front - 6 : back + 10, -16], u: u3, at: [cx, 0, Z], cut: true, explode: [0, 0, -dir * 130], st: 0.15, en: 0.65 });
    B.mesh(sh, rod(u.SHAFT, Math.min(back, front), Math.max(back, front), 32), 'shaft');
    B.mesh(sh, poly([[RO, aB], [RO, aF], [u.SHAFT - 0.4, -(u.SHAFT - 0.4) * tb], [u.SHAFT - 0.4, aB]], 128), 'plate');
    B.mesh(sh, tube(u.SHAFT - 0.4, 26, aB - 14, aB + 0.3, 64), 'steel');
    // servo cylinder on the movable side: wall r 60.4..64, a 44..80, cap
    // with a bore 0.4 mm off the shaft
    const cy = B.part('cyl' + k, { info: 'servo', label: k === 1 ? 'Servo cylinder' : null, labelAt: [0, 80, -66], u: u3, at: [cx, 0, Z], cut: true, explode: [0, 0, dir * 130], st: 0, en: 0.5 });
    B.mesh(cy, poly([[64, 44], [64, 80], [u.SHAFT + 0.4, 80], [u.SHAFT + 0.4, 76], [60.4, 76], [60.4, 44]], 96), 'alu');
    const mv = B.part('move' + k, { info: 'move', label: k === 1 ? 'Movable sheave' : null, labelAt: [0, 30, -RO + 6], u: u3, at: [cx, 0, Z], cut: true, explode: [0, 0, dir * 70], st: 0.1, en: 0.6 });
    const fa = RO * tb, fb = fa + 4;
    B.mesh(mv, poly([[RO, fa], [RO, fb], [22, fb], [22, 34], [u.SHAFT + 0.4, 34], [u.SHAFT + 0.4, (u.SHAFT + 0.4) * tb]], 128), 'plate');
    B.mesh(mv, tube(56, 60, fb - 0.3, fb + 24, 96), 'alu');
    return { sh, mv, cy };
  };
  const p1 = pulley(1, c1, Z1, 1, 'Input pulley'), p2 = pulley(2, c2, Z2, -1, 'Output pulley');

  // belt: elements and band packs
  const bp = B.part('belt', { info: 'belt', label: 'Push belt', labelAt: [0, -RO + 2, 24] });
  const m0 = B.mesh(bp, elementGeo(u), 'steel');
  const els = new THREE.InstancedMesh(m0.geometry, m0.material, u.N);
  els.castShadow = true; els.receiveShadow = true; els.userData.part = 'belt';
  bp.root.remove(m0); bp.root.add(els); B.pickables[B.pickables.indexOf(m0)] = els;
  const bands = [
    B.part('bands', { info: 'band', label: 'Band packs', labelAt: [0, RO + 2, 24], explode: [0, 0, 36], st: 0.6, en: 1 }),
    B.part('bands2', { info: 'band', explode: [0, 0, -36], st: 0.6, en: 1 }),
  ];
  const bg = bands.map(q => B.mesh(q, bandGeo(), 'ring').geometry);

  const pitch = L0(u) / u.N, M4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Zv = new THREE.Vector3();
  let st = null, lastX = null, lastTh = null, travel = 0, th2 = 0;
  // the belt centre plane: each pulley's own on its arc, a blend on a strand
  const zAt = q => q.on === 1 ? st.z1 : q.on === 2 ? st.z2 : q.strand === 'top' ? st.z2 + (st.z1 - st.z2) * q.f : st.z1 + (st.z2 - st.z1) * q.f;
  return {
    pose(th, x = 0.5) {
      if (x !== lastX) { st = beltState(u, x); lastX = x; bg.forEach((g, b) => fillBand(g, u, st, zAt, b)); }
      const d = lastTh === null ? 0 : th - lastTh; lastTh = th;
      travel += st.r1 * d; th2 += d * st.r1 / st.r2;
      p1.sh.spin(th); p1.mv.spin(th); p1.cy.spin(th); p1.mv.root.position.set(c1, 0, Z1 + st.s1);
      p2.sh.spin(-th2); p2.mv.spin(-th2); p2.cy.spin(-th2); p2.mv.root.position.set(c2, 0, Z2 - st.s2);
      for (let k = 0; k < u.N; k++) {
        const q = beltPoint(u, st, travel + k * pitch);
        X.set(q.t[0], q.t[1], 0); Y.set(q.n[0], q.n[1], 0); Zv.crossVectors(X, Y);
        M4.makeBasis(X, Y, Zv).setPosition(q.p[0], q.p[1], zAt(q));
        els.setMatrixAt(k, M4);
      }
      els.instanceMatrix.needsUpdate = true;
      if (!els.boundingBox || d === 0) { els.computeBoundingBox(); els.computeBoundingSphere(); }
      return { th, x, i: st.i, out: th2, st, travel };
    },
    box: { c: [0, 0, 0], R: 240 },
    keys: { close: [c1 - rMid(u), 0, 0], ratio: [c1, 0, 0] },
    section: true,
  };
}

// ── toroidal ────────────────────────────────────────────────────────────────
// A disc profile (r, a) with the cavity on a < 0: back at -(R0 + 14),
// rim at r = RD, flat face at a = -GAP/2, the arc, the flat inner face
// down to the bore. Each corner is sharp; the arc shades smooth.
function discGeo(u, bore, RD) {
  const g2 = -u.GAP / 2, aB = -(u.R0 + 14), d = arcEnd(u), N = 72, arc = [];
  for (let k = 0; k < N; k++) { const al = -d - (Math.PI - 2 * d) * k / N; arc.push([u.E + u.R0 * Math.cos(al), u.R0 * Math.sin(al)]); }
  const end = [u.E + u.R0 * Math.cos(-Math.PI + d), u.R0 * Math.sin(-Math.PI + d)];
  return lathe([[[RD, aB]], [[RD, g2]], arc, [end], [[bore, g2]], [[bore, aB]]], 160);
}
function toroidal(B, u) {
  const RD = u.E + u.R0 + 6, BASE = -140;
  // input: disc + shaft + back boss, cut at y = 0
  // EXPLODE ORDER. Each frame side lifts off the base and moves out along
  // z first, past where the carriers end, so the discs can pass its columns.
  // The discs then part along the shaft, as far as the bearing pedestals let
  // them (the shafts run through the pedestals, so the base stays). Last,
  // with the cavity open, the carriers take the rollers out radially.
  const inp = B.part('inDisc', { info: 'in', label: 'Input disc', labelAt: [-RD + 10, -60, 0], u: [1, 0, 0], e0: [0, 1, 0], cut: true, explode: [-58, 0, 0], st: 0.2, en: 0.7 });
  B.mesh(inp, discGeo(u, u.SHAFT - 0.4, RD), 'steel');
  B.mesh(inp, tube(u.SHAFT - 0.4, 30, -(u.R0 + 14) - 18, -(u.R0 + 14) + 0.3, 64), 'steel');
  B.mesh(inp, rod(u.SHAFT, -200, 20, 32), 'shaft');
  const out = B.part('outDisc', { info: 'out', label: 'Output disc', labelAt: [-RD + 10, -60, 0], u: [-1, 0, 0], e0: [0, 1, 0], cut: true, explode: [58, 0, 0], st: 0.2, en: 0.7 });
  B.mesh(out, discGeo(u, u.SHAFT + 0.4, RD), 'steel');
  B.mesh(out, tube(u.SHAFT + 0.4, 18, -200, -(u.R0 + 14) + 0.3, 64), 'shaft');

  // rollers in tilting carriers
  const rho = u.R0 - u.FILM, yc = Math.sqrt(u.CROWN * u.CROWN - 49), rim = rho - u.CROWN + yc, crown = [];
  for (let k = 0; k < 16; k++) { const y = -7 + 14 * k / 16; crown.push([rho - u.CROWN + Math.sqrt(u.CROWN * u.CROWN - y * y), y]); }
  const H = u.R0 + 8;
  const rollers = [1, -1].map((sg, k) => {
    const rh = [0, 0, sg], t = [0, -sg, 0], c = [0, 0, sg * u.E];
    const car = B.part('car' + k, { info: 'carrier', label: k ? null : 'Roller carrier', labelAt: [14, H - 4, 8], u: t, e0: rh, at: c, explode: [0, 0, sg * 90], st: 0.5, en: 0.95 });
    // carrier frame: x = roller axis, y = tilt axis, z = main axis at g = 0
    const parts = [box(10, 13, -H, H, -6, 6), box(-13, -10, -H, H, -6, 6), box(-12.6, 12.6, 42, H - 0.4, -5.6, 5.6), box(-12.6, 12.6, -H + 0.4, -42, -5.6, 5.6)];
    B.mesh(car, merge(parts), 'cast');
    const axle = rod(5.5, -13.4, 13.4, 24); axle.rotateZ(Math.PI / 2); B.mesh(car, axle, 'bolt');
    B.mesh(car, merge([rod(4, 47, 66, 20), rod(4, -66, -47, 20)]), 'bolt');
    const rl = B.part('roll' + k, { info: 'roller', label: k ? null : 'Power roller', labelAt: [0, 0, rho + 4], parent: car.root, u: [1, 0, 0], e0: [0, 1, 0], explode: [0, 0, 0] });
    B.mesh(rl, lathe([crown, [[rim, 7]], [[14, 9]], [[5.9, 9]], [[5.9, -9]], [[14, -9]]], 96), 'ring');
    return { car, rl, sg };
  });

  // fixed frame, one per roller (z = sg E): two pin holders, a post from
  // each (up to a beam over the discs, down to the base), the beam, and two
  // columns at x = +-96 beside the discs. Nothing crosses the face-on view
  // of a roller: the columns stand outside it and the beam above it.
  [1, -1].forEach((sg, k) => {
    const fr = B.part('frame' + k, { info: 'frame', label: k ? null : 'Reaction frame', labelAt: [96, 140, u.E], explode: [0, 8, sg * 150], st: 0, en: 0.45 });
    const fg = [], z = sg * u.E;
    fg.push(box(-7, 7, 58.4, 70, z - 7, z + 7), box(-7, 7, -70, -58.4, z - 7, z + 7));
    fg.push(box(-5, 5, 69.7, 128.3, z - 5, z + 5), box(-5, 5, BASE - 0.3, -69.7, z - 5, z + 5));
    fg.push(box(-102.4, 102.4, 128, 136, z - 6, z + 6));
    for (const sx of [1, -1]) fg.push(box(sx > 0 ? 90 : -102, sx > 0 ? 102 : -90, BASE - 0.3, 135.7, z - 5.6, z + 5.6));
    B.mesh(fr, merge(fg), 'cast');
  });
  const base = B.part('base', { info: 'base', label: 'Base', labelAt: [150, BASE, 90] });
  B.mesh(base, box(-185, 185, BASE - 12, BASE, -135, 135), 'paint');
  for (const [x, ri] of [[-150, u.SHAFT + 0.4], [150, 18.4]]) {
    const b = tube(ri, 34, -12, 12, 64); b.rotateZ(Math.PI / 2); b.translate(x, 0, 0); B.mesh(base, b, 'cast');
    B.mesh(base, box(x - 10, x + 10, BASE - 0.3, -22, -18, 18), 'cast');
  }

  let lastTh = null, phiOut = 0, phiRoll = 0;
  return {
    pose(th, x = 0.5) {
      const T = toroState(u, x), d = lastTh === null ? 0 : th - lastTh; lastTh = th;
      phiOut += d * -T.kOut; phiRoll += d * T.kRoll;
      inp.spin(th); out.spin(phiOut);
      for (const R of rollers) { R.car.spin(T.g); R.rl.spin(phiRoll); }
      return { th, x, i: T.i, out: -phiOut, T };
    },
    box: { c: [0, -10, 0], R: 230 },
    keys: { close: [0, 0, u.E], ratio: [0, 0, u.E] },
    section: true,
  };
}

export function build(B, id) {
  const u = unit(id);
  return id === 'belt' ? belt(B, u) : toroidal(B, u);
}

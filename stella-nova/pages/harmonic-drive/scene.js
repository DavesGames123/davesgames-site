// ============================================================================
//  HARMONIC & CYCLOIDAL DRIVES  ·  scene.js — the parts of each drive
// ----------------------------------------------------------------------------
//  build(B, id) makes one drive with kit.js and returns sc: { pose(th), box,
//  keys }. Outlines come from drive.js and teeth.js, so what turns on screen
//  is what the tests check. The drive axis is world y; the outline plane
//  (x, -z) is the drive.js plane, angles counter-clockwise from above.
//
//  STRAIN WAVE (y up)
//    circular spline ... a ring with Nc internal teeth, y 0 .. 14, on a flange
//    flexspline ........ Nf teeth at y 0 .. 14 on a thin cup that runs up to
//                        a diaphragm at y 60 and the output shaft. It is a
//                        flexible mesh: function flex moves every vertex
//                        each frame (turn by out, push out by the wave,
//                        less up the cup) and turns its normals by out
//    wave generator .... the input: an oval plug r = 37 + d cos 2 phi, a
//                        flexible bearing ring on it, and the input shaft
//  CYCLOIDAL (y up)
//    housing ........... a ring holding Np pins at R 60
//    discs ............. disc 0 at y 2 .. 12, disc 1 at y 14 .. 24
//    eccentric shaft ... the input, with two cams at 0 and 180 degrees
//    output flange ..... y 28 .. 34, six pins down through the disc holes
//
//  MARKS. Red marks show the slow motion against the fast one: a red cap
//  on flexspline tooth 0 (it bends with the wave) and a red dot at circular
//  spline gap 0, red dots on the wave generator at the major axis, and on
//  the output. In the cycloidal drive: a red dot on the top disc at a lobe
//  tip, one red pin cap, and a red dot on the output flange.
//  The circular spline is cast iron, so the bright flexspline teeth stand
//  out where they mesh. Both were near-white steel before.
//
//  GREP MAP
//    function flexMesh ........ a mesh that deforms with the wave
//    function harmonic ........ strain wave parts and pose
//    function cycloidal ....... cycloidal parts and pose
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, circle, merge } from './kit.js';
import { outline, toothPoly } from './teeth.js';
import { unit, wave, cycloPose, discProfile, holeAngles, TAU } from './drive.js';

const shapeOf = (pts, holes = []) => { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); for (const h of holes) s.holes.push(h); return s; };
// a red dot: a short rod at radius r, angle a (drive plane), y0 .. y1
const dot = (r, a, y0, y1, rr = 1.6) => { const g = rod(rr, y0, y1, 20); g.translate(r * Math.cos(a), 0, -r * Math.sin(a)); return g; };
const ring = (r, n = 96) => Array.from({ length: n }, (_, i) => [r * Math.cos(TAU * i / n), r * Math.sin(TAU * i / n)]);

// A geometry that the wave deforms. Base positions are kept in polar form;
// taper(y) scales the push along the cup.
function flexMesh(geom, taper) {
  const pos = geom.attributes.position, nor = geom.attributes.normal, N = pos.count;
  const r0 = new Float32Array(N), a0 = new Float32Array(N), y0 = new Float32Array(N), n0 = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    r0[i] = Math.hypot(x, z); a0[i] = Math.atan2(-z, x); y0[i] = pos.getY(i);
    n0[i * 3] = nor.getX(i); n0[i * 3 + 1] = nor.getY(i); n0[i * 3 + 2] = nor.getZ(i);
  }
  pos.setUsage(THREE.DynamicDrawUsage); nor.setUsage(THREE.DynamicDrawUsage);
  return (out, th, d) => {
    const c = Math.cos(out), s = Math.sin(out);
    for (let i = 0; i < N; i++) {
      const a = a0[i] + out, r = r0[i] + d * Math.cos(2 * (a - th)) * taper(y0[i]) * (r0[i] > 1 ? 1 : 0);
      pos.setXYZ(i, r * Math.cos(a), y0[i], -r * Math.sin(a));
      // a turn about +y by out: (x, z) -> (x c + z s, -x s + z c)
      const nx = n0[i * 3], nz = n0[i * 3 + 2];
      nor.setXYZ(i, nx * c + nz * s, n0[i * 3 + 1], -nx * s + nz * c);
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
    geom.computeBoundingSphere();
  };
}

function harmonic(B, u) {
  const m = u.m, Rf = u.Nf * m / 2, Rc = u.Nc * m / 2;
  // circular spline: an internal gear, its teeth the outline reflected
  // about the pitch circle, gap k at 2 pi k / Nc
  const cs = B.part('cs', { info: 'cs', label: 'Circular spline (fixed)', labelAt: [Rc + 12, 16, 0], explode: [0, -50, 0], st: 0, en: 0.6 });
  const inner = outline(u.Nc, u.Nc, m, { ha: 1, hf: 1.25 }).map(([r, p]) => { const q = 2 * Rc - r, a = p + Math.PI / u.Nc; return [q * Math.cos(a), q * Math.sin(a)]; });
  const hole = new THREE.Path(inner.map(p => new THREE.Vector2(p[0], p[1])).reverse());
  // the ring and the flexspline tooth ring are not flush: their end faces
  // would z-fight where the teeth mesh. The ring top stands 0.4 mm proud
  // (y 14.4) and the tooth ring bottom hangs 0.4 mm below (y -0.4).
  B.mesh(cs, slab(shapeOf(ring(Rc + 14), [hole]), 0, 14.4, 0.5), 'cast');
  B.mesh(cs, dot(Rc + 7, 0, 14.45, 15.3, 1.8), 'red');
  B.mesh(cs, lathe([[[Rc + 30, -8], [Rc + 30, 0], [Rc + 6, 0], [Rc + 6, -8]]], 96), 'cast');
  for (let i = 0; i < 8; i++) { const a = TAU * i / 8 + 0.2, g = rod(3.5, 0, 4, 16); g.translate((Rc + 22) * Math.cos(a), 0, -(Rc + 22) * Math.sin(a)); B.mesh(cs, g, 'bolt'); }

  // flexspline: tooth ring and cup, deformed each frame
  const fs = B.part('fs', { info: 'fs', label: 'Flexspline', labelAt: [Rf + 8, 40, 0], explode: [0, 70, 0], st: 0.2, en: 0.8 });
  const teeth = outline(u.Nf, u.Nf, m, { ha: 1, hf: 1.25 }).map(([r, p]) => [r * Math.cos(p), r * Math.sin(p)]);
  // the rim under the teeth: rIn .. root. The cup wall (rIn + 0.1 .. rOut)
  // starts 0.5 mm down inside the tooth ring, so its bottom face and its
  // inner wall are not coplanar with the faces of the tooth ring.
  const rf = Rf - 1.25 * m, rOut = rf - 0.3, rIn = rf - 1.5;
  const tg = slab(shapeOf(teeth, [circle(rIn)]), -0.4, 14.4, 0.3);
  const cup = lathe([[[rOut, 13.5], [rOut, 56], [16, 60], [16, 63], [rIn + 0.1, 59], [rIn + 0.1, 13.5]]], 120);
  const tgN = tg.index ? tg.toNonIndexed() : tg; tgN.computeVertexNormals();
  // tooth 0 (on phi = 0) gets a red cap 0.45 mm over its top, inset from
  // its flanks, so its faces are not coplanar with the tooth. Only the flank
  // points 1.2 mm above the root are used: the root and undercut points
  // fold back on one arc, and the cap outline crossed itself there.
  const capPts = toothPoly(u.Nf, m, { ha: 1, hf: 1.25 }).filter(([r]) => r > rf + 1.2).map(([r, p]) => [(r - 0.25) * Math.cos(p * 0.8), (r - 0.25) * Math.sin(p * 0.8)]);
  const cap = slab(shapeOf(capPts), 14.45, 0.85, 0.15), capN = cap.index ? cap.toNonIndexed() : cap; capN.computeVertexNormals();
  const flexT = flexMesh(tgN, () => 1), flexC = flexMesh(cup, y => Math.max(0, 1 - (y - 14) / 46)), flexM = flexMesh(capN, () => 1);
  B.mesh(fs, tgN, 'gear'); B.mesh(fs, cup, 'plate'); B.mesh(fs, capN, 'red');
  const outp = B.part('outShaft', { info: 'out', label: 'Output shaft', labelAt: [0, 92, 0], explode: [0, 110, 0], st: 0.3, en: 0.9 });
  B.mesh(outp, lathe([[[24, 60], [24, 68], [10, 68], [10, 96], [0, 96], [0, 60]]], 48), 'steel');
  for (let i = 0; i < 6; i++) { const a = TAU * i / 6, g = rod(2.5, 66, 70, 12); g.translate(18 * Math.cos(a), 0, -18 * Math.sin(a)); B.mesh(outp, g, 'bolt'); }
  B.mesh(outp, dot(6, 0, 96.05, 96.9, 1.5), 'red');

  // wave generator: oval plug, flexible bearing ring (deformed), shaft
  const wg = B.part('wg', { info: 'wg', label: 'Wave generator', labelAt: [0, -10, 0], explode: [0, -110, 0], st: 0.2, en: 0.9 });
  const oval = Array.from({ length: 160 }, (_, i) => { const p = TAU * i / 160, r = 33 + u.d * Math.cos(2 * p); return [r * Math.cos(p), r * Math.sin(p)]; });
  B.mesh(wg, slab(shapeOf(oval, [circle(8)]), 1, 12, 0.5), 'alu');
  B.mesh(wg, rod(8, -40, 12, 24), 'shaft');
  for (const a of [0, Math.PI]) B.mesh(wg, dot(24, a, 12.05, 12.9, 1.8), 'red');
  const brg = B.part('bearing', { info: 'bearing', label: 'Flexible bearing', labelAt: [0, 16, 0], explode: [0, -80, 0], st: 0.25, en: 0.9 });
  const race = lathe([[[rIn - 0.2, 2], [rIn - 0.2, 12], [33.2, 12], [33.2, 2]]], 160);
  const flexB = flexMesh(race, () => 1);
  B.mesh(brg, race, 'steel');

  return {
    pose(th) {
      const W = wave(u, th);
      flexT(W.out, th, u.d); flexC(W.out, th, u.d); flexM(W.out, th, u.d); flexB(0, th, u.d);
      outp.spin(W.out); wg.spin(th);
      return { th, out: W.out, ratio: W.ratio };
    },
    box: { c: [0, 25, 0], R: 120 },
    keys: { teeth: [Rf, 7, 0] },
  };
}

function cycloidal(B, u) {
  const prof = discProfile(u, 1080), h = B.part('housing', { info: 'housing', label: 'Pin housing (fixed)', labelAt: [u.R + 22, 26, 0], explode: [0, -60, 0], st: 0, en: 0.6 });
  B.mesh(h, lathe([[[u.R + 22, -6], [u.R + 22, 26], [u.R + 2, 26], [u.R + 2, 0], [20, 0], [20, -6]]], 120), 'cast');
  const pins = B.part('pins', { info: 'pins', label: 'Ring pins', labelAt: [u.R, 30, 0], explode: [0, -30, 0], st: 0.1, en: 0.6 });
  // the pins stand 0.4 mm proud of the housing top (y 26): flush caps z-fight
  for (let j = 0; j < u.Np; j++) { const a = TAU * j / u.Np, g = rod(u.Rr, 0, 26.4, 24); g.translate(u.R * Math.cos(a), 0, -u.R * Math.sin(a)); B.mesh(pins, g, 'steel'); }
  B.mesh(pins, dot(u.R, 0, 26.45, 27.2, u.Rr * 0.6), 'red');
  // the lobe tip of the disc outline: the profile point furthest out
  const tip = prof.reduce((b, p) => Math.hypot(p[0], p[1]) > Math.hypot(b[0], b[1]) ? p : b);
  const discs = [0, 1].map(k => {
    const holes = [circle(16), ...holeAngles(u, k).map(a => circle(u.rp + u.E, u.rOut * Math.cos(a), u.rOut * Math.sin(a)))];
    const p = B.part('disc' + k, { info: 'disc', label: k ? null : 'Cycloid disc', labelAt: [0, 14, 0], explode: [0, 40 + 40 * k, 0], st: 0.2, en: 0.8 });
    B.mesh(p, slab(shapeOf(prof, holes), k ? 14 : 2, 10, 0.5), k ? 'brass' : 'bronze');
    if (k) B.mesh(p, dot(Math.hypot(tip[0], tip[1]) - 5, Math.atan2(tip[1], tip[0]), 24.05, 24.8, 1.8), 'red');
    return p;
  });
  const ecc = B.part('ecc', { info: 'ecc', label: 'Eccentric input shaft', labelAt: [0, -30, 0], explode: [0, -120, 0], st: 0.2, en: 0.9 });
  B.mesh(ecc, rod(8, -40, 40, 24), 'shaft');
  for (const k of [0, 1]) { const g = rod(15.5, k ? 14 : 2, k ? 24 : 12, 40); g.translate(k ? -u.E : u.E, 0, 0); B.mesh(ecc, g, 'steel'); }
  const fl = B.part('flange', { info: 'flange', label: 'Output flange', labelAt: [0, 40, 0], explode: [0, 150, 0], st: 0.3, en: 1 });
  B.mesh(fl, merge([lathe([[[50, 28], [50, 34], [9, 34], [9, 28]]], 96), lathe([[[14, 34], [14, 60], [9, 60], [9, 34]]], 48)]), 'alu');
  for (let j = 0; j < u.nOut; j++) { const a = TAU * j / u.nOut, g = rod(u.rp, 0, 28, 20); g.translate(u.rOut * Math.cos(a), 0, -u.rOut * Math.sin(a)); B.mesh(fl, g, 'steel'); }
  B.mesh(fl, dot(44, TAU / (2 * u.nOut), 34.05, 34.8, 1.8), 'red');

  return {
    pose(th) {
      for (const k of [0, 1]) { const P = cycloPose(u, th, k); discs[k].root.position.set(P.cx, 0, -P.cy); discs[k].spin(P.rot); }
      const out = cycloPose(u, th, 0).rot;
      ecc.spin(th); fl.spin(out);
      return { th, out, ratio: u.Np - 1 };
    },
    box: { c: [0, 15, 0], R: 120 },
    keys: { teeth: [u.R, 13, 0] },
    prof,
  };
}

export function build(B, id) {
  const u = unit(id);
  return id === 'harmonic' ? harmonic(B, u) : cycloidal(B, u);
}

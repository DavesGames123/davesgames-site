// ============================================================================
//  RATCHETS & FREEWHEELS  ·  scene.js — the parts of each unit and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one unit with kit.js and returns sc: { pose(tau), box,
//  keys, C }. sc keeps its own one-way clutch (mech.js makeClutch): pose
//  steps it to the program input at tau, then places every part. The
//  outlines (teeth, pawls, sprags) come from mech.js, so the parts that
//  turn are the ones the tests check.
//
//  LAYOUT (mm; y up, the units lie flat on a base plate at y = 0). A mech.js
//  point (X, Y) is (X, h, -Y) here, so a spin about +y is CCW in mech.js.
//    Ratchet .. shaft r 10 (output); wheel y 20 .. 32 under a hub y 31.5
//               .. 40; lever (input) under the wheel: a handle arm y 11 ..
//               18 and a slim bracket y 11.4 .. 17.6 out to the pawl pin;
//               pawl y 21 .. 31 on the pin; a coil spring at y 26 from a
//               lug on the bracket to the back of the pawl
//    Sprag .... inner race y 12 .. 37.5 (input) on the shaft; outer race
//               with gear teeth y 12.5 .. 38 (output); 14 sprags y 16 .. 36; cage
//               ring y 14 .. 15.4 under the sprags; a garter spring at y 26
//    Freehub .. axle (fixed); hub shell, an open cup y 4 .. 36, and the
//               drive ring y 14 .. 34 (output); freehub body: flange y
//               14 .. 17, pawl carrier y 17 .. 32, splined core y 32 .. 98,
//               three cogs (input); pawls y 18.5 .. 30.5 on pins
//
//  Z-FIGHTING. No two same-facing faces share a plane where they overlap:
//  bores are 0.4 mm over their shafts, hubs sink 0.5 mm into the part they
//  carry, stacked parts keep gaps of 0.4 mm or more, the pawl tip stops
//  0.35 mm short of the face (mech.js FACE_GAP), and the sprags are 0.3
//  mm inside both races. Toothed outlines have no bevel: a bevel grows the
//  side walls and would close those gaps.
//
//  GREP MAP
//    function hull ............ convex hull of sampled circles (the lever)
//    function coil ............ a unit helix, stretched between two points
//    function ratchetUnit ..... wheel, lever, pawl, spring
//    function spragUnit ....... races, sprags, cage, garter spring
//    function freehubUnit ..... shell, ring, body, pawls, cassette
//    export function build .... the unit and sc.pose
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, circle, hex, merge } from './kit.js';
import { unit, wheelOutline, pawlGeo, pawlPose, pawlOutline, spragGeo, makeClutch, inputAt, TAU } from './mech.js';

const D = Math.PI / 180;
const pol = (a, r) => [r * Math.cos(a), r * Math.sin(a)];
function shapeOf(pts, holes = []) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(h);
  return s;
}
const ring = (n, f) => Array.from({ length: n }, (_, i) => f(TAU * i / n, i));
const boxGeo = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };
// a hole path from points (for a slab)
function holePath(pts) { const p = new THREE.Path(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; }

// convex hull of circles [[x, y, r]] (monotone chain on samples)
function hull(circles) {
  const pts = [];
  for (const [x, y, r] of circles) for (let i = 0; i < 48; i++) pts.push([x + r * Math.cos(TAU * i / 48), y + r * Math.sin(TAU * i / 48)]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// a helix of wire along +y, L0 long; stretch() scales it to each length.
// It is made at its working length, so the wire stays round (a unit
// helix scaled by L would flatten the wire into ribbons that overlap).
function coil(R, wire, turns, L0) {
  const pts = [];
  for (let i = 0; i <= turns * 24; i++) { const t = i / 24 * TAU; pts.push(new THREE.Vector3(R * Math.cos(t), L0 * i / (turns * 24), -R * Math.sin(t))); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 32, wire, 6, false);
  g.userData.L0 = L0;
  return g;
}
const UP = new THREE.Vector3(0, 1, 0), TV = new THREE.Vector3();
// place a unit coil mesh from a to b (THREE vectors in the parent frame)
function stretch(m, a, b, back = 0) {
  TV.subVectors(b, a); const L = TV.length() - back;
  TV.normalize();
  m.position.copy(a).addScaledVector(TV, back); m.quaternion.setFromUnitVectors(UP, TV); m.scale.set(1, L / m.geometry.userData.L0, 1);
}
const v3 = ([x, y], h) => new THREE.Vector3(x, h, -y);

// the base plate, a boss at the centre
function basePlate(B, hw, hd) {
  const p = B.part('base', { info: 'base', label: 'Base plate', labelAt: [hw - 30, 0, hd - 20], explode: [0, -60, 0], st: 0, en: 0.5 });
  B.mesh(p, slab(shapeOf([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], [circle(11)]), -12, 12, 1.2), 'paint');
  B.mesh(p, tube(11, 20, 0, 10, 48), 'cast');
  return p;
}

// ── ratchet ─────────────────────────────────────────────────────────────────
function ratchetUnit(B, u) {
  const G = pawlGeo(u), PO = pawlOutline(u, G);
  basePlate(B, 125, 125);
  const shaft = B.part('shaft', { info: 'shaft', label: 'Output shaft', labelAt: [0, 50, 0], explode: [0, 40, 0], st: 0.1, en: 0.7 });
  B.mesh(shaft, rod(10, -12, 41, 32), 'shaft');
  B.mesh(shaft, hex(9, 40.5, 5), 'bolt');
  const wheel = B.part('wheel', { info: 'wheel', label: `Ratchet wheel, ${u.N} teeth`, labelAt: [-40, 32, 40], explode: [0, 40, 0], st: 0.1, en: 0.7 });
  B.mesh(wheel, slab(shapeOf(wheelOutline(u, 12), [circle(10.4)]), 20, 12, 0), 'steel');
  B.mesh(wheel, lathe([[[20, 31.5], [20, 40], [10.8, 40], [10.8, 31.5]]], 48), 'steel');   // bore 0.4 over the wheel bore
  // lever, under the wheel so the pawl stays in view from above: a handle
  // arm on the far side, and a slim bracket out to the pawl pin and the
  // spring lug. Where the two overlap at the hub, the bracket is 0.4 mm
  // thinner on each face and its bore is 0.4 mm wider.
  const lev = B.part('lever', { info: 'lever', label: 'Lever (input)', labelAt: [-95, 18, 66], explode: [0, -36, 0], st: 0.2, en: 0.9 });
  const aP = Math.atan2(G.P[1], G.P[0]), H = pol(aP + Math.PI, 106), L = pol(aP, 94);
  B.mesh(lev, slab(shapeOf(hull([[0, 0, 23], [H[0], H[1], 12]]), [circle(10.4)]), 11, 7, 0.8), 'cast');
  B.mesh(lev, slab(shapeOf(hull([[0, 0, 20], [G.P[0], G.P[1], 10], [L[0], L[1], 8]]), [circle(10.8), circle(u.pawlHole, G.P[0], G.P[1])]), 11.4, 6.2, 0.6), 'cast');
  const grip = lathe([[[11, 17.5], [11, 52], [9, 56], [0, 56], [0, 17.5]]], 32); grip.translate(H[0], 0, -H[1]); B.mesh(lev, grip, 'rubber');
  // the lug on the bracket that holds the spring
  B.mesh(lev, boxGeo(L[0] - 5, L[0] + 5, 17.2, 30, -L[1] - 5, -L[1] + 5), 'cast');
  // pin: through the lever and the pawl, a collar under the pawl
  const pin = B.part('pin', { info: 'pin', parent: lev.root, at: [G.P[0], 0, -G.P[1]], explode: [0, 120, 0], st: 0.4, en: 1 });
  B.mesh(pin, rod(u.pinR, 11.5, 34, 24), 'bolt');
  B.mesh(pin, lathe([[[6.5, 31.4], [6.5, 34], [u.pinR, 34], [u.pinR, 31.4]]], 24), 'bolt');
  B.mesh(pin, tube(u.pinR, 6.5, 17.2, 20.6, 24), 'bolt');
  // pawl, in the lever frame, turns about the pin
  const pawl = B.part('pawl', { info: 'pawl', label: 'Pawl', labelAt: [G.l * 0.6, 31, 8], parent: lev.root, at: [G.P[0], 0, -G.P[1]], explode: [0, 70, 0], st: 0.3, en: 0.9 });
  B.mesh(pawl, slab(shapeOf(PO, [circle(u.pawlHole)]), 21, 10, 0), 'brass');
  // spring: from the lug to a point on the back of the pawl
  const sp = B.part('spring', { info: 'spring', label: 'Pawl spring', labelAt: [L[0], 26, -L[1]], parent: lev.root, explode: [0, 90, 0], st: 0.3, en: 0.9 });
  const sm = B.mesh(sp, coil(3.6, 0.7, 6, 30), 'spring');
  // the spring seat on the pawl: its back edge at -16 deg, r 75 (pawl frame)
  const S0 = pol(-16 * D, 75), Sl = (() => { const dx = S0[0] - G.P[0], dy = S0[1] - G.P[1], c = Math.cos(-G.alpha0), s = Math.sin(-G.alpha0); return [dx * c - dy * s, dx * s + dy * c]; })();
  const LA = v3(L, 26), SB = new THREE.Vector3();
  return {
    place(C) {
      lev.spin(C.in); shaft.spin(C.out); wheel.spin(C.out);
      const a = pawlPose(u, C.g, G);
      pawl.spin(a);
      const c = Math.cos(a), s = Math.sin(a);
      SB.set(G.P[0] + Sl[0] * c - Sl[1] * s, 26, -(G.P[1] + Sl[0] * s + Sl[1] * c));
      stretch(sm, LA, SB, 7.5);   // from the lug face
      return a;
    },
    box: { c: [0, 26, 0], R: 0.62 * 250 },
    keys: { pair: [u.rRoot, 26, 0], wheel: [0, 26, 0] },
  };
}

// ── sprag ───────────────────────────────────────────────────────────────────
function spragUnit(B, u) {
  const S = spragGeo(u);
  basePlate(B, 115, 115);
  const shaft = B.part('shaft', { info: 'shaft', label: 'Input shaft', labelAt: [0, 74, 0], explode: [0, 20, 0], st: 0, en: 0.6 });
  B.mesh(shaft, rod(10, -12, 70, 32), 'shaft');
  B.mesh(shaft, hex(9, 69.5, 5), 'bolt');
  const inner = B.part('inner', { info: 'inner', label: 'Inner race (input)', labelAt: [0, 37.5, -30], explode: [0, 20, 0], st: 0, en: 0.6 });
  const holes = [circle(10.4), ...ring(6, t => circle(7, 28 * Math.cos(t), 28 * Math.sin(t)))];
  B.mesh(inner, slab(shapeOf(ring(128, t => pol(t, u.ri)), holes), 12, 25.5, 0), 'gear');
  B.mesh(inner, boxGeo(9.6, 13.2, 12.5, 37, -2.5, 2.5), 'bolt');   // key in the bore
  const outer = B.part('outer', { info: 'outer', label: 'Outer race (output)', labelAt: [62, 38, 40], explode: [0, -30, 0], st: 0.2, en: 0.8 });
  const nT = 48, rT = u.ro + 18, gear = [];
  for (let i = 0; i < nT; i++) for (let k = 0; k < 4; k++) {
    const t = TAU * (i + k / 4) / nT, r = k === 1 || k === 2 ? rT : rT - 6;
    gear.push(pol(t + (k === 1 ? 0.18 : k === 2 ? -0.18 : 0) * TAU / nT, r));
  }
  B.mesh(outer, slab(shapeOf(gear, [circle(u.ro)]), 12.5, 25.5, 0), 'steel');
  // sprags: outline about the midpoint M, on a part at M turned with the cage
  const local = S.outline.map(([x, y]) => [x - S.M[0], y - S.M[1]]), rM = Math.hypot(...S.M), aM = Math.atan2(S.M[1], S.M[0]);
  const sprags = ring(u.Z, (t, k) => {
    const p = B.part('sprag' + k, { info: 'sprag', label: k === 0 ? 'Sprag' : null, labelAt: [0, 36, 0], explode: [0, 60 + 4 * (k % 2), 0], st: 0.3, en: 0.9 });
    B.mesh(p, slab(shapeOf(local), 16, 20, 0), 'bronze');
    return { p, t };
  });
  const cage = B.part('cage', { info: 'cage', label: 'Cage', labelAt: [0, 38, -52], explode: [0, 100, 0], st: 0.3, en: 1 });
  // one cage ring under the sprags (a ring on top would hide them)
  B.mesh(cage, tube(47, 58, 14, 15.4, 96), 'brass');
  const garter = B.part('garter', { info: 'garter', label: 'Garter spring', labelAt: [-52, 26, 0], explode: [0, 80, 0], st: 0.3, en: 1 });
  const tg = new THREE.TorusGeometry((u.ri + u.ro) / 2, 1.1, 8, 160); tg.rotateX(Math.PI / 2); tg.translate(0, 26, 0); B.mesh(garter, tg, 'spring');
  return {
    place(C) {
      shaft.spin(C.in); inner.spin(C.in); outer.spin(C.out); cage.spin(C.out); garter.spin(C.out);
      // the sprags ride with the cage; in a free stroke they slide on the
      // inner race
      for (const { p, t } of sprags) { const a = t + aM + C.out; p.root.position.set(rM * Math.cos(a), 0, -rM * Math.sin(a)); p.spin(t + C.out); }
      return 0;
    },
    box: { c: [0, 26, 0], R: 0.62 * 210 },
    keys: { pair: [S.M[0], 26, -S.M[1]], wheel: [0, 26, 0] },
  };
}

// ── freehub ─────────────────────────────────────────────────────────────────
// a chain cog of z teeth for 1/2 in chain: roller seats on the pitch
// circle, rounded tips between them
function cog(z) {
  const pc = 12.7, rp = pc / (2 * Math.sin(Math.PI / z)), rr = 3.97, pts = [], n = 10;
  for (let i = 0; i < z * n; i++) {
    const f = i / n, w = f - Math.floor(f);             // 0 at a seat, 0.5 at a tip
    const k = Math.pow((1 - Math.cos(TAU * w)) / 2, 0.7);
    pts.push(pol(TAU * f / z, rp - rr + (rr + 2.6) * k));
  }
  return { pts, rp };
}
function freehubUnit(B, u) {
  const G = pawlGeo(u), PO = pawlOutline(u, G);
  basePlate(B, 125, 125);
  const axle = B.part('axle', { info: 'axle', label: 'Axle (fixed)', labelAt: [0, 112, 0], explode: [0, 30, 0], st: 0, en: 0.5 });
  B.mesh(axle, rod(8, -12, 108, 24), 'bolt');
  B.mesh(axle, lathe([[[14, 104], [14, 110], [8, 110], [8, 104]]], 32), 'bolt');
  // hub shell: an open cup round the ring, a spoke flange at its foot
  const shell = B.part('shell', { info: 'shell', label: 'Hub shell (output)', labelAt: [70, 36, 40], explode: [0, -40, 0], st: 0, en: 0.6 });
  B.mesh(shell, lathe([[[66, 4], [66, 36]], [[56.4, 36], [56.4, 12.5]], [[8.4, 12.5], [8.4, 4]]], 128), 'alu');
  B.mesh(shell, slab(shapeOf(ring(128, t => pol(t, 92)), [circle(65.6), ...ring(20, t => circle(1.8, 84 * Math.cos(t + 0.07), 84 * Math.sin(t + 0.07)))]), 6, 6, 0.6), 'alu');
  const drv = B.part('ring', { info: 'ring', label: `Drive ring, ${u.N} teeth`, labelAt: [-50, 34, -30], explode: [0, 20, 0], st: 0.1, en: 0.7 });
  B.mesh(drv, slab(shapeOf(ring(128, t => pol(t, 56)), [holePath(wheelOutline(u, 8))]), 13, 21, 0), 'steel');
  // freehub body: flange, pawl carrier, splined core
  const body = B.part('body', { info: 'body', label: 'Freehub body (input)', labelAt: [-30, 60, 30], explode: [0, 70, 0], st: 0.2, en: 0.9 });
  B.mesh(body, lathe([[[41, 14], [41, 17]], [[33, 17], [33, 32.5]], [[22, 32.5], [22, 98]], [[8.4, 98], [8.4, 14]]], 96), 'gear');
  for (let i = 0; i < 9; i++) { const t = TAU * i / 9, g = boxGeo(21.6, 23.4, 33, 97.5, -2, 2); g.rotateY(t); B.mesh(body, g, 'gear'); }
  // cassette: three cogs on the core with spacers. The largest cog
  // (18 teeth, tip r 39.2) stays inside the pawl hooks (r 40.4 .. 50), so the
  // pawls and the ring show from above. A 26-tooth cog (tip r 55.3)
  // covered all of them in the whole, close and top views.
  const cas = B.part('cassette', { info: 'cassette', label: 'Cassette', labelAt: [40, 90, 0], parent: body.root, explode: [0, 50, 0], st: 0.4, en: 1 });
  [[18, 52], [16, 66], [14, 80]].forEach(([z, y]) => {
    const c = cog(z);
    B.mesh(cas, slab(shapeOf(c.pts, [circle(23.8)]), y, 2.6, 0), 'steel');
    B.mesh(cas, tube(24.2, 25.4, y + 2.4, y + 14.2, 48), 'bolt');   // under the 14-tooth root, r 24.6
  });
  // pawls, pins and springs: three, in phase, on the body
  const pawls = [];
  for (let k = 0; k < u.pawls; k++) {
    const t = TAU * k / u.pawls, c = Math.cos(t), s = Math.sin(t);
    const Pk = [G.P[0] * c - G.P[1] * s, G.P[0] * s + G.P[1] * c];
    const pw = B.part('pawl' + k, { info: 'pawl', label: k === 0 ? 'Pawl' : null, labelAt: [G.l * 0.6, 31, 0], parent: body.root, at: [Pk[0], 0, -Pk[1]], explode: [0, 46, 0], st: 0.3, en: 0.9 });
    B.mesh(pw, slab(shapeOf(PO, [circle(u.pawlHole)]), 18.5, 12, 0), 'brass');
    const pin = B.part('pin' + k, { info: 'pin', parent: body.root, at: [Pk[0], 0, -Pk[1]], explode: [0, 56, 0], st: 0.4, en: 1 });
    B.mesh(pin, rod(u.pinR, 16.5, 31.5, 16), 'bolt');
    B.mesh(pin, lathe([[[4, 31], [4, 32.2], [u.pinR, 32.2], [u.pinR, 31]]], 16), 'bolt');
    const sp = B.part('spring' + k, { info: 'spring', label: k === 0 ? 'Pawl spring' : null, labelAt: [0, 24, 0], parent: body.root, explode: [0, 36, 0], st: 0.3, en: 0.9 });
    const sm = B.mesh(sp, coil(1.5, 0.45, 4, 9), 'spring');
    pawls.push({ pw, sm, t, Pk });
  }
  // spring seat on the carrier (r 33.4) and on the pawl (inner edge, -6 deg)
  const S0 = pol(-6 * D, 42.6), Sl = (() => { const dx = S0[0] - G.P[0], dy = S0[1] - G.P[1], c = Math.cos(-G.alpha0), s = Math.sin(-G.alpha0); return [dx * c - dy * s, dx * s + dy * c]; })();
  const A0 = pol(-6 * D, 32.6), SA = new THREE.Vector3(), SB = new THREE.Vector3();
  return {
    place(C) {
      body.spin(C.in); shell.spin(C.out); drv.spin(C.out);
      const a = pawlPose(u, C.g, G);
      for (const { pw, sm, t } of pawls) {
        pw.spin(a + t);
        const c = Math.cos(a), s = Math.sin(a), q = [G.P[0] + Sl[0] * c - Sl[1] * s, G.P[1] + Sl[0] * s + Sl[1] * c];
        const ct = Math.cos(t), st = Math.sin(t);
        SA.set(A0[0] * ct - A0[1] * st, 24.5, -(A0[0] * st + A0[1] * ct));
        SB.set(q[0] * ct - q[1] * st, 24.5, -(q[0] * st + q[1] * ct));
        stretch(sm, SA, SB);
      }
      return a;
    },
    box: { c: [0, 45, 0], R: 0.62 * 240 },
    keys: { pair: [u.rRoot, 24, 0], wheel: [0, 24, 0] },
  };
}

export function build(B, id) {
  const u = unit(id), U = u.id === 'ratchet' ? ratchetUnit(B, u) : u.id === 'sprag' ? spragUnit(B, u) : freehubUnit(B, u);
  const C = makeClutch(u, inputAt(0), 0);
  return {
    ...U, C, u,
    // tau: the program time (rad, one cycle per 2 pi). The clutch steps to
    // the input there; a long jump is fine, the state machine takes any step.
    pose(tau) {
      C.step(inputAt(tau));
      const a = U.place(C);
      return { in: C.in, out: C.out, g: C.g, driving: C.driving, taken: C.taken, clicks: C.clicks, pawl: a };
    },
  };
}

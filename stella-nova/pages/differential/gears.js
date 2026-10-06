// ============================================================================
//  DIFFERENTIAL  ·  gears.js — involute teeth for bevel and helical gears
// ────────────────────────────────────────────────────────────────────────────
//  All gears are made about local +Y, tooth 0 on local +X, and the tooth
//  angle phi runs from +X toward −Z (the right-hand sense about +Y, the
//  sense diff.js uses). Only the toothed ring is made here; scene.js turns
//  the blank (hub, web, bore) with kit.lathe.
//
//  BEVEL (Tredgold)
//    At cone distance s the tooth section is the involute tooth of the
//    virtual spur gear on the back cone: Nv = N / cos γ teeth of module
//    m·s/A. A point at virtual radius rv and virtual angle θv lies at
//      (s/A)·[ rv cos γ · ρ(φ),  A/cos γ − rv sin γ ]   with φ = θv / cos γ
//    so every flank line runs through the apex (a straight bevel). The
//    spiral bevel adds diff.spiral(s) to φ in each slice.
//
//  HELICAL
//    The plain spur tooth outline, turned by twist(y) in each slice.
//
//  GREP MAP
//    teeth.js ................ the involute outline (shared with tests.mjs)
//    export function bevelTeeth
//    export function helicalTeeth
//    function Surf ........... triangle lists that check their own facing
//    function cap ............ an end face: root ring plus one polygon a tooth
//    function skin ........... the bore under the teeth, on the root angles
// ============================================================================
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

import { outline } from './teeth.js';

// triangles in groups; each group checks one sample normal and flips itself
// to face the way it should
class Surf {
  constructor() { this.P = []; this.groups = []; }
  begin() { this.g0 = this.P.length; }
  quad(a, b, c, d) { this.P.push(...a, ...b, ...c, ...a, ...c, ...d); }
  // want(p): the outward direction at point p of the sample triangle
  end(want) {
    const P = this.P, i = this.g0;
    if (i >= P.length) return;
    // sample the triangle with the largest area in the first few
    let best = i, bestA = -1;
    for (let t = i; t < Math.min(P.length, i + 9 * 40); t += 9) {
      const n = triN(P, t), a = Math.hypot(...n);
      if (a > bestA) { bestA = a; best = t; }
    }
    const n = triN(P, best), c = [(P[best] + P[best + 3] + P[best + 6]) / 3, (P[best + 1] + P[best + 4] + P[best + 7]) / 3, (P[best + 2] + P[best + 5] + P[best + 8]) / 3];
    const w = want(c);
    if (n[0] * w[0] + n[1] * w[1] + n[2] * w[2] < 0) for (let t = i; t < P.length; t += 9) for (let k = 0; k < 3; k++) { const x = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = x; }
  }
  geometry(crease = 0.55) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    const out = toCreasedNormals(g, crease);
    if (out !== g) g.dispose();
    return out;
  }
}
function triN(P, t) {
  const ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2];
  const bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}
// the outline points on the root circle: their angles only run forward
function rootIds(O) {
  const rf = Math.min(...O.map(p => p[0])), tol = 1e-9 * Math.max(1, rf), out = [];
  for (let i = 0; i < O.length; i++) if (O[i][0] - rf < tol) out.push(i);
  return out;
}
// the bore skin under the teeth, on the root angles for the same reason;
// quad(i, i1) makes the strip between two of them
function skin(O, quad) {
  const roots = rootIds(O);
  for (let k = 0; k < roots.length; k++) quad(roots[k], roots[(k + 1) % roots.length]);
}
// an end cap of the toothed ring: a ring from the bore rin up to the root
// circle, then each tooth above the root as its own polygon. A fan from
// every outline point down to rin is wrong: on an undercut flank the angle
// runs back, the fan folds over itself, and the folded and unfolded
// triangles lie in one plane and z-fight. pt(i, r) is outline point i at
// radius r (its own radius when r is undefined).
function cap(su, O, rin, pt, want) {
  const n = O.length, roots = rootIds(O);
  su.begin();
  for (let k = 0; k < roots.length; k++) { const i = roots[k], i1 = roots[(k + 1) % roots.length]; su.quad(pt(i), pt(i1), pt(i1, rin), pt(i, rin)); }
  su.end(want);
  su.begin();
  for (let k = 0; k < roots.length; k++) {
    const i0 = roots[k], i1 = roots[(k + 1) % roots.length], m = (i1 - i0 + n) % n;
    if (m < 2) continue;
    const ids = []; for (let q = 0; q <= m; q++) ids.push((i0 + q) % n);
    const xy = ids.map(i => new THREE.Vector2(O[i][0] * Math.cos(O[i][1]), O[i][0] * Math.sin(O[i][1])));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(xy, [])) {
      const A = xy[a], B = xy[b], C = xy[c], ccw = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0;
      su.P.push(...pt(ids[a]), ...(ccw ? pt(ids[b]) : pt(ids[c])), ...(ccw ? pt(ids[c]) : pt(ids[b])));
    }
  }
  su.end(want);
}
const tipIndex = (O, N) => { let best = 0; for (let i = 0; i < O.length / N; i++) if (O[i][0] > O[best][0]) best = i; return best; };

// o: { N, m, gam, A, F, ha, hf, t, slices, spiral(s) -> dphi, depth (m below root for the inner ring) }
// returns { geom, root (rv of root), rin (rv of inner ring), map(rv, phi, s) }
export function bevelTeeth(o) {
  const cg = Math.cos(o.gam), sg = Math.sin(o.gam), Nv = o.N / cg, A = o.A;
  const O = outline(o.N, Nv, o.m, o, 1 / cg);
  const Rv = A * Math.tan(o.gam), rin = Rv - (o.hf + (o.depth ?? 0.8)) * o.m;
  const map = (rv, phi, s) => { const k = s / A; return [k * rv * cg * Math.cos(phi), k * (A / cg - rv * sg), -k * rv * cg * Math.sin(phi)]; };
  const S = Math.max(2, o.slices || 2), sp = o.spiral || (() => 0);
  const ss = []; for (let j = 0; j < S; j++) ss.push(A - o.F + o.F * j / (S - 1));
  const at = (i, j, rv) => map(rv ?? O[i][0], O[i][1] + sp(ss[j]), ss[j]);
  const n = O.length, su = new Surf();
  const ndir = p => { const r = Math.hypot(p[0], p[2]) || 1; return [cg * p[0] / r, -sg, cg * p[2] / r]; };
  const ldir = p => { const r = Math.hypot(p[0], p[2]) || 1; return [sg * p[0] / r, cg, sg * p[2] / r]; };
  // flanks: start the group on a tooth tip so the sample faces outward
  su.begin();
  const t0 = tipIndex(O, o.N);
  for (let jj = 0; jj < n; jj++) { const i = (t0 + jj) % n, i1 = (i + 1) % n; for (let j = 0; j < S - 1; j++) su.quad(at(i, j), at(i1, j), at(i1, j + 1), at(i, j + 1)); }
  su.end(ndir);
  // heel cap (away from the apex) and toe cap (toward it)
  for (const [j, sgn] of [[S - 1, 1], [0, -1]]) cap(su, O, rin, (i, r) => at(i, j, r), p => ldir(p).map(v => v * sgn));
  // inner skin under the teeth
  su.begin();
  skin(O, (i, i1) => { for (let j = 0; j < S - 1; j++) su.quad(at(i, j, rin), at(i1, j, rin), at(i1, j + 1, rin), at(i, j + 1, rin)); });
  su.end(p => ndir(p).map(v => -v));
  return { geom: su.geometry(), Rv, rin, map, root: Rv - o.hf * o.m };
}

// o: { N, m, y0, y1, ha, hf, t, slices, twist(y) -> dphi, rin (bore radius, 0 = solid) }
export function helicalTeeth(o) {
  const O = outline(o.N, o.N, o.m, o, 1), n = O.length, S = Math.max(2, o.slices || 2), tw = o.twist || (() => 0);
  const ys = []; for (let j = 0; j < S; j++) ys.push(o.y0 + (o.y1 - o.y0) * j / (S - 1));
  const at = (i, j, r) => { const f = O[i][1] + tw(ys[j]), rr = r ?? O[i][0]; return [rr * Math.cos(f), ys[j], -rr * Math.sin(f)]; };
  const su = new Surf(), rin = o.rin || 0;
  const rad = p => { const r = Math.hypot(p[0], p[2]) || 1; return [p[0] / r, 0, p[2] / r]; };
  su.begin();
  const t0 = tipIndex(O, o.N);
  for (let jj = 0; jj < n; jj++) { const i = (t0 + jj) % n, i1 = (i + 1) % n; for (let j = 0; j < S - 1; j++) su.quad(at(i, j), at(i1, j), at(i1, j + 1), at(i, j + 1)); }
  su.end(rad);
  for (const [j, sgn] of [[S - 1, 1], [0, -1]]) cap(su, O, rin, (i, r) => at(i, j, r), () => [0, sgn, 0]);
  if (rin > 0) {
    su.begin();
    skin(O, (i, i1) => { for (let j = 0; j < S - 1; j++) su.quad(at(i, j, rin), at(i1, j, rin), at(i1, j + 1, rin), at(i, j + 1, rin)); });
    su.end(p => rad(p).map(v => -v));
  }
  return { geom: su.geometry(0.6), R: o.N * o.m / 2 };
}

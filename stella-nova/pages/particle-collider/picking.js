// ============================================================================
//  PARTICLE COLLIDER  ·  picking.js — the products of a collision as objects
// ----------------------------------------------------------------------------
//  No DOM. buildObjects(R, O, info) turns the transport result, the
//  reconstruction and the generator info into a list of selectable
//  objects. Every view (r-phi, r-z, the tower map, the optional 3D view)
//  projects the same 3D geometry, so a hover or a selection is linked
//  across the views by the object key.
//
//  OBJECT  { key, kind, name, cls, k, pts (polyline [x, y, z, t] in mm,
//            ns), t0 (time it appears), eta, phi, pT, E, q, hard, soft }
//    kind: 'track' (any registered particle: charged track, photon,
//          neutral hadron, a decayed K0S ...), 'jet', 'tower', 'muhit',
//          'vertex' (a decay or conversion), 'met', 'collision' (the
//          hard vertex: the root of the decay chain)
//
//  HIT TEST (grep -n 'export function hitTest')
//    The distance from the pointer to each visible object in screen
//    space: to the polyline segments of a track (thin tracks stay
//    precise), to a point for a hit or a vertex. The nearest object
//    within the tolerance wins; a hard-process object wins a tie by
//    1.5 px. Projected polylines are cached per view version, so a
//    hover costs one distance pass.
//
//  GREP MAP  function buildObjects · function hitTest · function distSeg
// ============================================================================
import { PART } from './particles.js';
import { CLS } from './transport.js';

const dirOf = (eta, phi) => { const th = 2 * Math.atan(Math.exp(-eta)); return [Math.sin(th) * Math.cos(phi), Math.sin(th) * Math.sin(phi), Math.cos(th)]; };
const etaOf = (x, y, z) => { const r = Math.hypot(x, y); return -Math.log(Math.tan(Math.max(1e-9, Math.atan2(r, z)) / 2)); };
// a point on the line from the origin along (eta, phi), at cylinder radius r or plane |z| = zc
export function atRadius(eta, phi, r = 1290, zc = 3000) {
  const d = dirOf(eta, phi), rr = Math.hypot(d[0], d[1]);
  let s = rr > 1e-6 ? r / rr : Infinity; if (Math.abs(d[2]) * s > zc) s = zc / Math.abs(d[2]);
  return [d[0] * s, d[1] * s, d[2] * s];
}

export function buildObjects(R, O, info = {}) {
  const objs = [];
  // the own segments of each registered track, in time order
  const own = new Map();
  for (let i = 0; i < R.nSeg; i++) {
    if (!R.segOwn || !R.segOwn[i]) continue;
    const k = R.segTrk[i]; if (k < 0) continue;
    let a = own.get(k); if (!a) own.set(k, a = []); a.push(i);
  }
  const recoByK = new Map(); if (O) for (const t of O.tracks) recoByK.set(t.k, t);
  const cand = [];
  R.tracks.forEach((T, k) => {
    const segs = own.get(k); if (!segs || !segs.length) return;
    const hard = T.primary === 'hard' || T.primary === 'isr', jet = T.primary === 'jet' || T.primary === 'bjet', pu = T.primary === 'pu' || T.primary === 'ue';
    const P = PART[T.name] || { m: 0, q: 0, cls: 'had' };
    const p = Math.sqrt(Math.max(0, T.E0 * T.E0 - P.m * P.m)), pT = p * Math.hypot(T.u0[0], T.u0[1]);
    if (!hard && !(jet && T.E0 > 600) && !(T.E0 > (pu ? 3000 : 1500))) return;
    cand.push({ k, T, P, p, pT, hard, jet, pu, segs });
  });
  cand.sort((a, b) => (b.hard - a.hard) || b.T.E0 - a.T.E0);
  for (const c of cand.slice(0, 600)) {
    const { k, T, P, segs } = c, S = R.seg;
    segs.sort((a, b) => S[a * 9 + 3] - S[b * 9 + 3]);
    const pts = [[S[segs[0] * 9], S[segs[0] * 9 + 1], S[segs[0] * 9 + 2], S[segs[0] * 9 + 3]]];
    for (const i of segs) pts.push([S[i * 9 + 4], S[i * 9 + 5], S[i * 9 + 6], S[i * 9 + 7]]);
    const cls = CLS[R.segCls[segs[0]]];
    const u = T.u0, eta = etaOf(u[0], u[1], u[2]), phi = Math.atan2(u[1], u[0]);
    objs.push({ key: 't' + k, kind: 'track', name: T.name, cls, k, pts, t0: pts[0][3], eta, phi, pT: c.pT, p: c.p, E: T.E0, q: P.q, hard: c.hard, soft: c.pT < 2000 && !c.hard, reco: recoByK.get(k) || null, T });
  }
  // jets (with their towers as constituents)
  if (O) O.jets.slice(0, 12).forEach((j, i) => {
    const a = atRadius(j.eta, j.phi, 2950, 4900);
    const towers = O.towers.filter(t => Math.hypot(t.eta - j.eta, Math.atan2(Math.sin(t.phi - j.phi), Math.cos(t.phi - j.phi))) < 0.4);
    objs.push({ key: 'j' + i, kind: 'jet', name: 'jet', cls: 'jet', k: -1, pts: [[0, 0, 0, 0.2], [a[0], a[1], a[2], 10]], t0: 0.5, eta: j.eta, phi: j.phi, pT: j.pT, E: j.E, q: 0, hard: true, jet: j, towers });
  });
  // towers above 1 GeV: a radial bar at the calorimeter face
  if (O) O.towers.filter(t => t.ET > 1000).sort((a, b) => b.ET - a.ET).slice(0, 300).forEach((t, i) => {
    const a = atRadius(t.eta, t.phi, 1520, 3230), L = 1 + Math.min(1.6, 0.18 * Math.log2(1 + t.ET / 1000)), b = a.map(v => v * L);
    const T0 = 4.5 + Math.abs(t.eta) * 1.2;   // about when light reaches the calorimeter face
    objs.push({ key: 'w' + t.c, kind: 'tower', name: 'tower', cls: 'tower', k: -1, pts: [[a[0], a[1], a[2], T0], [b[0], b[1], b[2], T0]], t0: T0, eta: t.eta, phi: t.phi, pT: t.ET, E: t.E, em: t.em, q: 0, tower: t, rank: i });
  });
  // muon-chamber hits
  for (let i = 0; i < R.mhits.n && i < 600; i++) {
    const f = R.mhits.f;
    objs.push({ key: 'm' + i, kind: 'muhit', name: 'muon hit', cls: 'mu', k: R.mhits.trk[i], pts: [[f[i * 6], f[i * 6 + 1], f[i * 6 + 2], f[i * 6 + 3]]], t0: f[i * 6 + 3], layer: f[i * 6 + 5] });
  }
  // decay and conversion vertices inside the tracker
  R.vtx.forEach((v, i) => {
    if (v[4] === 2 || Math.hypot(v[0], v[1]) > 1200 || objs.length > 2400) return;
    objs.push({ key: 'v' + i, kind: 'vertex', name: v[4] === 1 ? 'decay vertex' : 'conversion', cls: 'vertex', k: -1, pts: [[v[0], v[1], v[2], v[3]]], t0: v[3], vkind: v[4] });
  });
  // missing transverse energy
  if (O && O.met.et > 8000) {
    const L = Math.min(5200, 1400 + O.met.et / 100000 * 2600);
    objs.push({ key: 'met', kind: 'met', name: 'MET', cls: 'nu', k: -1, pts: [[0, 0, 0, 8], [L * Math.cos(O.met.phi), L * Math.sin(O.met.phi), 0, 8]], t0: 8, phi: O.met.phi, pT: O.met.et, E: O.met.et, met: O.met, eta: 0 });
  }
  // the collision itself: the root of the decay chain
  const v = info.vertex || [0, 0, 0, 0];
  objs.push({ key: 'vx', kind: 'collision', name: 'collision', cls: 'collision', k: -1, pts: [[v[0], v[1], v[2], 0]], t0: 0, hard: true });
  const byKey = new Map(objs.map(o => [o.key, o]));
  const byTrack = new Map(objs.filter(o => o.kind === 'track').map(o => [o.k, o]));
  return { objs, byKey, byTrack };
}

// distance from p to the segment ab, all in screen px
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// project(x, y, z) -> [sx, sy] or null. cache: a Map the view keeps and
// clears when its projection or size changes. Returns { obj, d } or null.
export function hitTest(objs, project, x, y, tol, time = Infinity, cache = null, accept = null) {
  let best = null, bd = tol;
  for (const o of objs) {
    if (o.t0 > time || (accept && !accept(o))) continue;
    let P = cache && cache.get(o.key);
    if (!P) {
      P = new Float32Array(o.pts.length * 3);
      o.pts.forEach((q, i) => { const s = project(q[0], q[1], q[2]); P[i * 3] = s ? s[0] : NaN; P[i * 3 + 1] = s ? s[1] : NaN; P[i * 3 + 2] = q[3]; });
      if (cache) cache.set(o.key, P);
    }
    const n = o.pts.length, bias = o.hard ? 1.5 : 0;
    let d = Infinity;
    if (n === 1) { if (P[0] === P[0]) d = Math.hypot(x - P[0], y - P[1]) - (o.kind === 'collision' ? 4 : 0); }
    else {
      // quick reject on the bounding box
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) { const a = P[i * 3], b = P[i * 3 + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; }
      if (x < x0 - bd - 2 || x > x1 + bd + 2 || y < y0 - bd - 2 || y > y1 + bd + 2) continue;
      for (let i = 0; i + 1 < n; i++) {
        if (P[i * 3 + 2] > time) break;   // the part not yet drawn
        const ax = P[i * 3], ay = P[i * 3 + 1], bx = P[i * 3 + 3], by = P[i * 3 + 4];
        if (ax !== ax || bx !== bx) continue;
        const q = distSeg(x, y, ax, ay, bx, by); if (q < d) d = q;
      }
    }
    d -= bias;
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { obj: best, d: bd } : null;
}

// the registered ancestors of a track, nearest first
export function ancestors(R, k) {
  const out = []; let a = k >= 0 && R.tracks[k] ? R.tracks[k].anc : -1, n = 0;
  while (a >= 0 && n++ < 60) { out.push(a); a = R.tracks[a].anc; }
  return out;
}

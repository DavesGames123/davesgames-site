// ============================================================================
//  PLANET FORGE  ·  geology.js — large landforms of dry rocky worlds (no DOM)
// ----------------------------------------------------------------------------
//  rocky.js calls buildGeology once per planet and geologyHeight and
//  geologyColour per texel. All parts are off when P.features is 0, so
//  other worlds do not change. Heights are in km, times G.upk (height units
//  per km, rocky.js craterUPK).
//
//  BASINS    (features.basins, count) old impact basins, 0.12-0.4 rad:
//            a flat, filled floor, a wall up to a raised rim, a second
//            outer ring scarp. The floor damps the erosion detail
//            (smooth plains) and takes a lighter plains colour.
//  SHIELDS   (features.shields, count) broad volcanic domes, 0.03-0.13 rad
//            and 6-26 km high: a flat top, gentle flanks, a basal scarp,
//            nested summit caldera pits, radial lava flows on the flanks,
//            a flow apron past the base. Half of the sets line up along
//            a great circle (a volcanic chain). Dark basalt flanks, a
//            dusty summit.
//  CANYON    (features.canyon, 0..1) one rift: a wobbling great-circle
//            trough with a flat floor and layered, spurred walls, wider
//            in the middle; one or two parallel troughs; 8-24 branching
//            tributary canyons at acute angles, heads upstream, rounded
//            (some branch again);
//            a pit chain past the head. Segments are capsules; the depth
//            is the deepest capsule at the point.
//  STREAKS   (features.streaks, 0..1) wind streaks: up to 400 small
//            craters lay a bright (or dark) tail 3-8 radii downwind.
//            The wind is zonal (east in mid-latitudes, west in the
//            tropics), turned by a seeded angle.
//  PROVINCES (features.provinces, 0..1) dust albedo provinces: a warped
//            fBm, a soft threshold with fractal edges; dark grey-brown
//            basalt sand in the low parts, bright dust in the high parts.
//  CAPS      (features.caps, 0..1) polar caps of layered ice: each pole
//            has its own size and a small offset, an irregular edge,
//            3-6 spiral troughs that expose dusty layers, a low dome.
//  LAYERS    (features.layers, 0..1) strata: risers of terraces and
//            canyon walls show alternate light and dark beds.
//
//  grep -n targets: "export function buildGeology", "function buildCanyon",
//  "export function geologyHeight", "export function geologyColour",
//  "function canyonDepth", "function streakField", "function capField",
//  "export function geologyProbes"
// ============================================================================
import { simplex3, fbm, mulberry, onSphere, clamp, mix, smooth } from './noise.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function frame(c) {
  const up = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e = norm(cross(up, c)), n = cross(c, e);
  return { e, n };
}
// c turned by angle t toward the unit tangent d (a great circle)
const along = (c, d, t) => norm([c[0] * Math.cos(t) + d[0] * Math.sin(t), c[1] * Math.cos(t) + d[1] * Math.sin(t), c[2] * Math.cos(t) + d[2] * Math.sin(t)]);
// The zonal wind at c: east in mid-latitudes, west in the tropics, turned by rot.
function windAt(c, rot) {
  let east = cross([0, 1, 0], c);
  east = Math.hypot(east[0], east[1], east[2]) < 1e-6 ? [1, 0, 0] : norm(east);
  const north = cross(c, east);
  const lat = Math.asin(clamp(c[1], -1, 1)), s = Math.abs(lat) < 0.5 ? -1 : 1;
  const a = rot + 0.35 * Math.sin(2 * lat), ca = Math.cos(a), sa = Math.sin(a);
  return norm([s * (east[0] * ca + north[0] * sa), s * (east[1] * ca + north[1] * sa), s * (east[2] * ca + north[2] * sa)]);
}

export function buildGeology(P, seed, craters, upk) {
  const F = P.features || {}, rnd = mulberry(seed);
  const G = {
    upk, on: false,
    basins: [], shields: [], canyon: null, streaks: null,
    prov: +F.provinces || 0, caps: null, layers: +F.layers || 0, sV: seed,
  };
  // basins
  for (let i = 0; i < (F.basins | 0); i++) {
    const c = onSphere(rnd), r = 0.12 + 0.28 * rnd() ** 1.5;
    G.basins.push({ c, r, depth: 3 + 4 * rnd(), ring: 1.45 + 0.35 * rnd(), cosR: Math.cos(Math.min(Math.PI, r * 2.3)) });
  }
  // shields: the first is the largest; half of the sets form a chain
  const ns = F.shields | 0;
  if (ns > 0) {
    const c0 = onSphere(rnd), chain = rnd() < 0.5, fr = frame(c0), ca = rnd() * Math.PI * 2;
    const d = norm([fr.e[0] * Math.cos(ca) + fr.n[0] * Math.sin(ca), fr.e[1] * Math.cos(ca) + fr.n[1] * Math.sin(ca), fr.e[2] * Math.cos(ca) + fr.n[2] * Math.sin(ca)]);
    for (let i = 0; i < ns; i++) {
      const big = i === 0;
      const r = big ? 0.07 + 0.06 * rnd() : 0.03 + 0.05 * rnd();
      const c = i === 0 ? c0 : chain && i < 4 ? along(c0, d, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (0.13 + 0.06 * rnd()) + 0.02 * (rnd() - 0.5)) : onSphere(rnd);
      const H = clamp((10 + 14 * rnd()) * (r / 0.08), 6, 26);
      const pits = [], np = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < np; k++) pits.push({ ox: (rnd() - 0.5) * 0.12, oy: (rnd() - 0.5) * 0.12, r: 0.06 + 0.08 * rnd(), d: 0.05 + 0.06 * rnd() });
      G.shields.push({ c, r, H, pits, ...frame(c), nRad: 36 + Math.floor(rnd() * 36), id: i * 17 + 3, cosR: Math.cos(Math.min(Math.PI, r * 1.9)) });
    }
  }
  if (F.canyon > 0) G.canyon = buildCanyon(rnd, +F.canyon);
  if (F.streaks > 0 && craters && craters.list.length) G.streaks = buildStreaks(rnd, craters.list, +F.streaks);
  if (F.caps > 0) {
    G.caps = [1, -1].map(s => {
      const off = 0.07 * rnd(), oa = rnd() * Math.PI * 2;
      const ax = norm([Math.sin(off) * Math.cos(oa), s * Math.cos(off), Math.sin(off) * Math.sin(oa)]);
      return { ax, ...frame(ax), r: (0.05 + 0.17 * rnd()) * Math.min(1, +F.caps * 1.4), arms: 3 + Math.floor(rnd() * 4), twist: (rnd() < 0.5 ? -1 : 1) * (1.2 + 1.6 * rnd()), ph: rnd() * 6.28, s };
    });
  }
  G.on = G.basins.length > 0 || G.shields.length > 0 || !!G.canyon || !!G.streaks || G.prov > 0 || !!G.caps || G.layers > 0;
  return G;
}

// Points where the landforms reach their extremes (shield summits and
// flanks, canyon floors), for the height range of rocky.js prepareRocky.
export function geologyProbes(G) {
  const out = [];
  for (const S of G.shields) {
    out.push(S.c);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = S.r * 0.15; out.push(norm([S.c[0] + r * (S.e[0] * Math.cos(a) + S.n[0] * Math.sin(a)), S.c[1] + r * (S.e[1] * Math.cos(a) + S.n[1] * Math.sin(a)), S.c[2] + r * (S.e[2] * Math.cos(a) + S.n[2] * Math.sin(a))])); }
  }
  if (G.canyon) for (let i = 0; i < G.canyon.segs.length; i += 2) out.push(G.canyon.segs[i].m);
  for (const B of G.basins) out.push(B.c);
  return out;
}

// ── canyon ─────────────────────────────────────────────────────────────
// Segments { a, b, wa, wb, da, db } (unit vectors, width rad, depth km).
function buildCanyon(rnd, amt) {
  const lat = (rnd() - 0.5) * 1.1, lon = rnd() * Math.PI * 2;
  const c0 = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  const fr = frame(c0), ang = (rnd() - 0.5) * 0.9;   // mostly east-west
  const dir = norm([fr.e[0] * Math.cos(ang) + fr.n[0] * Math.sin(ang), fr.e[1] * Math.cos(ang) + fr.n[1] * Math.sin(ang), fr.e[2] * Math.cos(ang) + fr.n[2] * Math.sin(ang)]);
  const side = cross(c0, dir);
  const Lh = 0.28 + 0.35 * rnd(), w0 = (0.018 + 0.017 * rnd()) * (0.6 + 0.4 * amt), D = (4 + 4 * rnd()) * Math.min(1, 0.4 + amt);
  const seed = Math.floor(rnd() * 1e6);
  const K = 44, pts = [], wid = [], dep = [];
  const point = (t, off) => {
    const q = along(c0, dir, t);
    return norm([q[0] + side[0] * off, q[1] + side[1] * off, q[2] + side[2] * off]);
  };
  for (let k = 0; k <= K; k++) {
    const u = k / K, t = -Lh + 2 * Lh * u;
    const wob = 0.035 * simplex3(t * 2.5, 0.3, 0.7, seed) + 0.012 * simplex3(t * 9, 1.3, 0.2, seed + 1);
    pts.push(point(t, wob));
    const bulge = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92)), 0.6);
    wid.push(w0 * (0.35 + 0.9 * bulge) * (0.85 + 0.3 * simplex3(u * 6, 2.1, 0.4, seed + 2)));
    dep.push(D * (0.45 + 0.55 * bulge));
  }
  const segs = [];
  const add = (a, b, wa, wb, da, db) => {
    const m = norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
    const half = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2;
    segs.push({ a, b, wa, wb, da, db, m, reach: half + Math.max(wa, wb) * 1.4 });
  };
  for (let k = 0; k < K; k++) add(pts[k], pts[k + 1], wid[k], wid[k + 1], dep[k], dep[k + 1]);
  // parallel troughs
  const npar = 1 + (rnd() < 0.5 ? 1 : 0);
  for (let j = 0; j < npar; j++) {
    const sgn = j ? -1 : (rnd() < 0.5 ? -1 : 1), u0 = 0.2 + 0.2 * rnd(), u1 = u0 + 0.25 + 0.25 * rnd();
    const k0 = Math.floor(u0 * K), k1 = Math.min(K - 1, Math.floor(u1 * K)), offK = sgn * (2.4 + rnd()) ;
    let prev = null;
    for (let k = k0; k <= k1; k++) {
      const u = k / K, t = -Lh + 2 * Lh * u, taper = Math.sin(Math.PI * (k - k0) / Math.max(1, k1 - k0));
      const wob = 0.035 * simplex3(t * 2.5, 0.3, 0.7, seed) + 0.012 * simplex3(t * 9, 1.3, 0.2, seed + 1);
      const q = point(t, wob + offK * wid[k]);
      const w = wid[k] * (0.25 + 0.4 * taper), d = dep[k] * (0.4 + 0.45 * taper);
      if (prev) add(prev.q, q, prev.w, w, prev.d, d);
      prev = { q, w, d };
    }
  }
  // tributaries with rounded heads; some branch again
  const nt = 8 + Math.floor(16 * rnd() * (0.5 + 0.5 * amt));
  const trib = (start, d0, len, w, d, depth) => {
    let p = start, dd = d0;
    const n = 4, step = len / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n;
      const turn = (rnd() - 0.5) * 0.9;
      const nn = cross(p, dd);
      dd = norm([dd[0] * Math.cos(turn) + nn[0] * Math.sin(turn), dd[1] * Math.cos(turn) + nn[1] * Math.sin(turn), dd[2] * Math.cos(turn) + nn[2] * Math.sin(turn)]);
      const q = along(p, dd, step);
      add(p, q, w * (1 - 0.35 * (u - 1 / n)), w * (1 - 0.35 * u), d * (1 - 0.6 * (u - 1 / n)), d * (1 - 0.6 * u));
      if (depth === 0 && (i === 1 || i === 2) && rnd() < 0.4) {
        const bt = (rnd() < 0.5 ? 1 : -1) * (0.5 + 0.5 * rnd()), bn = cross(q, dd);
        const bd = norm([dd[0] * Math.cos(bt) + bn[0] * Math.sin(bt), dd[1] * Math.cos(bt) + bn[1] * Math.sin(bt), dd[2] * Math.cos(bt) + bn[2] * Math.sin(bt)]);
        trib(q, bd, len * 0.5, w * 0.7, d * 0.75, 1);
      }
      // re-project dd to the tangent plane at q
      const r = dot(dd, q); dd = norm([dd[0] - r * q[0], dd[1] - r * q[1], dd[2] - r * q[2]]);
      p = q;
    }
  };
  // tributaries join at acute angles and point their heads upstream
  // (toward the head of the rift); spacing, length and width vary
  for (let i = 0; i < nt; i++) {
    const k = 2 + Math.floor(rnd() * (K - 4)), q = pts[k], sgn = rnd() < 0.5 ? -1 : 1;
    const tdir = norm([pts[k + 1][0] - pts[k - 1][0], pts[k + 1][1] - pts[k - 1][1], pts[k + 1][2] - pts[k - 1][2]]);
    const lat2 = cross(q, tdir), be = 0.5 + 0.6 * rnd();
    const dd = norm([sgn * lat2[0] * Math.sin(be) - tdir[0] * Math.cos(be), sgn * lat2[1] * Math.sin(be) - tdir[1] * Math.cos(be), sgn * lat2[2] * Math.sin(be) - tdir[2] * Math.cos(be)]);
    const start = along(q, dd, wid[k] * 0.35);
    trib(start, dd, wid[k] * (1.2 + 3.3 * rnd() ** 1.5), wid[k] * (0.25 + 0.25 * rnd()), dep[k] * (0.5 + 0.3 * rnd()), 0);
  }
  // a pit chain past the head
  const npit = 5 + Math.floor(rnd() * 6);
  for (let i = 0; i < npit; i++) {
    const t = -Lh - wid[0] * (2.5 + i * 2.6), q = point(t, 0.035 * simplex3(t * 2.5, 0.3, 0.7, seed));
    const w = wid[0] * (0.7 - 0.05 * i) * (0.7 + 0.5 * rnd());
    add(q, q, w, w, dep[0] * (0.7 - 0.05 * i), dep[0] * (0.7 - 0.05 * i));
  }
  let reach = 0; for (const s of segs) reach = Math.max(reach, Math.acos(clamp(dot(s.m, c0), -1, 1)) + s.reach);
  return { segs, c0, cosReach: Math.cos(Math.min(Math.PI, reach + 0.01)), seed };
}

const _cd = { depth: 0, floor: 0, wall: 0, rim: 0 };
function canyonDepth(Cn, p) {
  _cd.depth = 0; _cd.floor = 0; _cd.wall = 0; _cd.rim = 0;
  if (dot(p, Cn.c0) < Cn.cosReach) return _cd;
  // spur-and-gully walls: the distance is pushed in and out by a fine noise
  const jag = 0.16 * simplex3(p[0] * 90, p[1] * 90, p[2] * 90, Cn.seed + 5) + 0.08 * simplex3(p[0] * 210, p[1] * 210, p[2] * 210, Cn.seed + 6);
  for (const s of Cn.segs) {
    const mx = p[0] - s.m[0], my = p[1] - s.m[1], mz = p[2] - s.m[2];
    if (mx * mx + my * my + mz * mz > s.reach * s.reach) continue;
    const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2], L2 = bx * bx + by * by + bz * bz;
    const ax = p[0] - s.a[0], ay = p[1] - s.a[1], az = p[2] - s.a[2];
    const u = L2 > 0 ? clamp((ax * bx + ay * by + az * bz) / L2) : 0;
    const d = Math.hypot(ax - u * bx, ay - u * by, az - u * bz);
    const W = s.wa + (s.wb - s.wa) * u, Dk = s.da + (s.db - s.da) * u;
    const x = d / W + jag * smooth(0.3, 0.8, d / W);
    if (x > 1.35) continue;
    let prof;
    if (x < 0.5) prof = 1;
    else if (x < 1) {
      // layered walls: four benches, steep risers
      const sx = (x - 0.5) / 0.5, f = sx * 4, st = (Math.floor(f) + smooth(0.35, 1, f - Math.floor(f))) / 4;
      prof = 1 - mix(sx, st, 0.6);
      _cd.wall = Math.max(_cd.wall, 1 - Math.abs(sx - 0.5) * 2 > 0 ? smooth(0, 0.25, sx) * smooth(1, 0.8, sx) : 0);
    } else prof = -0.05 * smooth(1.35, 1.05, x);   // a low raised rim
    const dep = Dk * prof;
    if (dep > _cd.depth) _cd.depth = dep;
    if (x < 0.55) _cd.floor = Math.max(_cd.floor, smooth(0.55, 0.4, x));
    if (x > 1) _cd.rim = Math.max(_cd.rim, smooth(1.35, 1.05, x));
  }
  return _cd;
}

// ── wind streaks ───────────────────────────────────────────────────────
const SG = 12, SCS = 2 / SG;
function buildStreaks(rnd, list, amt) {
  const rot = (rnd() - 0.5) * 0.8, cells = new Map(), pick = [];
  for (const cr of list) if (cr.r < 0.02 && cr.age < 0.8) pick.push(cr);
  // keep at most 400, spread over the list
  const keep = Math.min(pick.length, Math.round(400 * amt) + 20), stride = pick.length / Math.max(keep, 1);
  for (let i = 0; i < keep; i++) {
    const cr = pick[Math.floor(i * stride)];
    const w = windAt(cr.c, rot), s = cross(cr.c, w);
    const len = Math.min(3 + 5 * rnd(), SCS / cr.r - 1.2);
    if (len < 2) continue;
    const st = { c: cr.c, r: cr.r, w, s, len, sign: rnd() < 0.7 ? 1 : -1 };
    const ix = Math.floor((cr.c[0] + 1) / SCS), iy = Math.floor((cr.c[1] + 1) / SCS), iz = Math.floor((cr.c[2] + 1) / SCS);
    const key = (ix * SG + iy) * SG + iz;
    let a = cells.get(key); if (!a) cells.set(key, a = []);
    a.push(st);
  }
  return { cells, amt };
}
function streakField(S, p) {
  const ix = Math.floor((p[0] + 1) / SCS), iy = Math.floor((p[1] + 1) / SCS), iz = Math.floor((p[2] + 1) / SCS);
  let v = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const arr = S.cells.get(((ix + a) * SG + iy + b) * SG + iz + c);
    if (!arr) continue;
    for (const st of arr) {
      const dx = p[0] - st.c[0], dy = p[1] - st.c[1], dz = p[2] - st.c[2];
      const al = (dx * st.w[0] + dy * st.w[1] + dz * st.w[2]) / st.r;
      if (al < 0.6 || al > st.len) continue;
      const la = (dx * st.s[0] + dy * st.s[1] + dz * st.s[2]) / st.r;
      const wd = 0.75 + 0.07 * al;
      if (Math.abs(la) > 2.5 * wd) continue;
      const t = smooth(0.6, 1.3, al) * smooth(st.len, st.len * 0.35, al) * Math.exp(-((la / wd) ** 2));
      if (t > Math.abs(v)) v = st.sign * t;
    }
  }
  return v * S.amt;
}

// ── polar caps ─────────────────────────────────────────────────────────
const _cap = { ice: 0, trough: 0, dome: 0 };
function capField(G, p) {
  _cap.ice = 0; _cap.trough = 0; _cap.dome = 0;
  for (const C of G.caps) {
    const cz = dot(p, C.ax);
    if (cz < Math.cos(Math.min(1.4, C.r * 1.6))) continue;
    const th = Math.acos(clamp(cz, -1, 1));
    const ph = Math.atan2(dot(p, C.n), dot(p, C.e));
    const edge = C.r * (1 + 0.18 * simplex3(p[0] * 7, p[1] * 7, p[2] * 7, G.sV + 31) + 0.07 * simplex3(p[0] * 22, p[1] * 22, p[2] * 22, G.sV + 32));
    const ice = smooth(edge + 0.012, edge - 0.012, th);
    // outer seasonal frost, thin and patchy
    const frost = 0.35 * smooth(edge * 1.3, edge, th) * smooth(-0.2, 0.4, simplex3(p[0] * 14, p[1] * 14, p[2] * 14, G.sV + 33));
    const spiral = Math.sin(C.arms * ph + C.twist * C.s * (th / Math.max(C.r, 1e-3)) * 6.28 + C.ph + 0.6 * simplex3(p[0] * 9, p[1] * 9, p[2] * 9, G.sV + 34));
    const trough = smooth(0.7, 0.95, spiral) * smooth(0.12 * C.r, 0.3 * C.r, th) * ice;
    _cap.ice = Math.max(_cap.ice, Math.max(ice * (1 - 0.8 * trough), frost));
    _cap.trough = Math.max(_cap.trough, trough);
    _cap.dome = Math.max(_cap.dome, ice * (1 - (th / Math.max(edge, 1e-3)) ** 2));
  }
  return _cap;
}

// Height (km) of the large landforms at p, and the masks the colour pass
// needs, into st: geoH, basinFloor, shield, summit, flows, cFloor, cWall,
// streak, capIce, capTrough.
const PROV_O = { freq: 1.1, octaves: 4, lacunarity: 2.2, gain: 0.55 };
export function geologyHeight(G, p, st) {
  let h = 0;
  st.basinFloor = 0; st.shield = 0; st.summit = 0; st.flows = 0; st.cFloor = 0; st.cWall = 0; st.streak = 0; st.capIce = 0; st.capTrough = 0;
  for (const B of G.basins) {
    const cz = dot(p, B.c);
    if (cz < B.cosR) continue;
    const x = Math.acos(clamp(cz, -1, 1)) / B.r * (1 + 0.07 * simplex3(p[0] * 5, p[1] * 5, p[2] * 5, G.sV + 1));
    const D = B.depth;
    let b;
    if (x < 0.72) b = -D;
    else if (x < 1) b = -D + (D * 1.12) * smooth(0.72, 1, x);
    else b = 0.12 * D * Math.exp(-(x - 1) / 0.18);
    b += 0.05 * D * Math.exp(-(((x - B.ring) / 0.06) ** 2)) - 0.03 * D * smooth(B.ring, B.ring + 0.1, x) * smooth(B.ring + 0.5, B.ring + 0.1, x);
    h += b;
    st.basinFloor = Math.max(st.basinFloor, smooth(0.8, 0.6, x));
  }
  for (const S of G.shields) {
    const cz = dot(p, S.c);
    if (cz < S.cosR) continue;
    const dx = p[0] - S.c[0], dy = p[1] - S.c[1], dz = p[2] - S.c[2];
    const u = (dx * S.e[0] + dy * S.e[1] + dz * S.e[2]) / S.r, v = (dx * S.n[0] + dy * S.n[1] + dz * S.n[2]) / S.r;
    const x = Math.hypot(u, v) * (1 + 0.05 * simplex3(p[0] * 12, p[1] * 12, p[2] * 12, G.sV + S.id));
    let s = 0;
    if (x < 1) s = S.H * Math.pow(1 - Math.pow(x, 1.8), 1.4);
    // basal scarp and the apron of flows past it
    s += 0.1 * S.H * smooth(1.04, 0.94, x) + 0.04 * S.H * smooth(1.8, 1.0, x) * (0.6 + 0.4 * simplex3(p[0] * 30, p[1] * 30, p[2] * 30, G.sV + S.id + 1));
    // lava flows: ridges of a noise stretched along the radius (narrow in
    // angle, long in x), each set ending in a lobate front at its own x
    const ang = Math.atan2(v, u), ca = Math.cos(ang), sa = Math.sin(ang);
    const front = 1.2 + 0.45 * simplex3(ca * 2.5, sa * 2.5, S.id, G.sV + 3);
    const fn = 1 - Math.abs(simplex3(ca * 13, sa * 13, x * 2.4 + S.id, G.sV + 2));
    const flows = smooth(0.55, 0.92, fn) * smooth(0.1, 0.35, x) * smooth(front, front - 0.3, x);
    s += 0.02 * S.H * flows + 0.03 * S.H * smooth(front + 0.05, front - 0.15, x) * smooth(0.9, 1.05, x);
    // nested caldera pits
    for (const k of S.pits) {
      const px = Math.hypot(u - k.ox, v - k.oy) / k.r;
      if (px < 1.2) s -= k.d * S.H * smooth(1.05, 0.85, px);
    }
    h += s;
    st.shield = Math.max(st.shield, smooth(front, 0.75, x) * (0.75 + 0.25 * fn));
    st.summit = Math.max(st.summit, smooth(0.35, 0.1, x));
    st.flows = Math.max(st.flows, flows);
  }
  if (G.canyon) {
    const c = canyonDepth(G.canyon, p);
    h -= c.depth; st.cFloor = c.floor; st.cWall = c.wall;
  }
  if (G.streaks) st.streak = streakField(G.streaks, p);
  if (G.caps) {
    const c = capField(G, p);
    h += 1.6 * c.dome - 0.5 * c.trough;
    st.capIce = c.ice; st.capTrough = c.trough;
  }
  st.geoH = h;
  return h * G.upk;
}

// Colour of the landforms over the base colour col (sRGB triple, in place).
const mixIn = (o, b, t) => { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t; };
const _pw = [0, 0, 0], _tmp = [0, 0, 0];
export function geologyColour(G, p, st, pal, col, hn) {
  if (G.prov > 0) {
    // provinces: a warped fBm stretched east-west (the zonal winds lay the
    // dust in long belts), a soft threshold; near the edge a fine streaky
    // noise along the wind frays the border into tongues and streaks
    const w = 0.22;
    _pw[0] = p[0] + w * simplex3(p[0] * 1.7, p[1] * 1.7, p[2] * 1.7, G.sV + 41);
    _pw[1] = (p[1] + w * simplex3(p[0] * 1.7, p[1] * 1.7, p[2] * 1.7, G.sV + 42)) * 1.8;
    _pw[2] = p[2] + w * simplex3(p[0] * 1.7, p[1] * 1.7, p[2] * 1.7, G.sV + 43);
    let n = fbm(_pw, PROV_O, G.sV + 44) - 0.3 * (hn - 0.5);
    const edge = smooth(0.22, 0.0, Math.abs(n - 0.1));
    if (edge > 0) n += edge * 0.09 * simplex3(p[0] * 7, p[1] * 46, p[2] * 7, G.sV + 45);
    const dark = smooth(0.04, 0.2, n) * G.prov, bright = smooth(-0.1, -0.3, n) * G.prov;
    // basalt sand: grey-brown, less red than the dust
    const g = (pal.dark[0] + pal.dark[1] + pal.dark[2]) / 3;
    _tmp[0] = mix(pal.dark[0], g, 0.45) * 1.25; _tmp[1] = mix(pal.dark[1], g, 0.45) * 1.25; _tmp[2] = mix(pal.dark[2], g, 0.45) * 1.3;
    mixIn(col, _tmp, dark * 0.55);
    mixIn(col, pal.bright, bright * 0.3);
  }
  if (st.basinFloor > 0) { _tmp[0] = pal.low[0] * 1.08; _tmp[1] = pal.low[1] * 1.1; _tmp[2] = pal.low[2] * 1.1; mixIn(col, _tmp, st.basinFloor * 0.35); }
  if (st.shield > 0) {
    const g = (pal.rock[0] + pal.rock[1] + pal.rock[2]) / 3;
    _tmp[0] = mix(pal.rock[0], g, 0.5) * 0.85; _tmp[1] = mix(pal.rock[1], g, 0.5) * 0.85; _tmp[2] = mix(pal.rock[2], g, 0.5) * 0.9;
    mixIn(col, _tmp, st.shield * (0.22 + 0.3 * st.flows));
    mixIn(col, pal.bright, st.summit * 0.45);
  }
  if (st.cFloor > 0) {
    mixIn(col, pal.dark, st.cFloor * 0.45);
    // light layered deposits on the floor
    const ld = smooth(0.25, 0.55, simplex3(p[0] * 40, p[1] * 40, p[2] * 40, G.sV + 51));
    mixIn(col, pal.bright, st.cFloor * ld * 0.4);
  }
  if (G.layers > 0 || st.cWall > 0) {
    // strata on walls and terrace risers: beds by height
    const bed = Math.sin(hn * 220 + 2 * simplex3(p[0] * 12, p[1] * 12, p[2] * 12, G.sV + 52));
    const k = Math.max(st.cWall, (st.riser || 0) * G.layers);
    if (k > 0) { const f = 1 + 0.22 * bed * k; col[0] *= f; col[1] *= f; col[2] *= f * 0.98; }
  }
  if (st.streak > 0) mixIn(col, pal.bright, st.streak * 0.45);
  else if (st.streak < 0) mixIn(col, pal.dark, -st.streak * 0.4);
  if (st.capTrough > 0) mixIn(col, pal.rock, st.capTrough * 0.5);
}

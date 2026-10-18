// ============================================================================
//  CORAL REEF  ·  rock/geology.js  ·  the seeded reef rock field (DOM-free)
// ----------------------------------------------------------------------------
//  makeGeology({ seed, radius, detail }) makes the plan of one reef plot and
//  returns its signed distance field. Units are metres, y is up, the plot
//  is a circle of radius R at the origin and the sand is near y = 0.
//
//  THE PLAN (made once, from the seed)
//    1. Canyons: 2 or 3 winding paths across the plot (two sine meanders
//       plus noise). The first one passes near the centre. Each has a
//       half width along its length (slots and wide bends).
//    2. Massif: a warped fbm mask, cut at the quantile that gives the rock
//       share of this seed, then forced to rock along the canyon banks, so
//       every canyon has walls. A signed distance transform of the mask
//       gives the footprint distance F(x, z) (negative in rock).
//    3. Top height H(x, z): fbm and ridges, soft terraces at the strata
//       period, higher rims along the canyons.
//    4. Sand S(x, z): a low swell and broad ripples. Past R the sand dips.
//    5. Features: bridges over the canyons, free arches (tori) at the
//       massif edge, pinnacles and hoodoos in the sand, caves into thick
//       walls, boulders and scree at the wall bases.
//  All 2D fields live on grids of 0.25 m (bilinear samples).
//
//  THE FIELD   sdf(x, y, z), negative inside rock
//    base: mass = smax(F + strata(y) + notch(y) - cap(y) + thin(r), y - H)
//          minus the canyon voids (wider at the base: undercut, flared
//          at the top, strata ledges) except the bridge slabs, minus the
//          caves, plus the arches, pinnacles and boulders (smooth min).
//    crag detail in a band near the surface only: domain-warped ridged
//          noise and Worley joints (grooves on the cell borders), so the
//          far field stays cheap.
//    Past R the footprint thins and the top drops; past 1.32 R there is
//    no rock. Under y = Y_BOTTOM there is no rock, so the mesh is closed.
//
//  grep -n targets
//    constants ............... "export const Y_BOTTOM"
//    plan entry .............. "export function makeGeology"
//    canyon paths ............ "function makeCanyons"
//    distance transform ...... "function edt2"
//    strata profile .......... "function strataProfile"
//    features ................ "function placeArches"
//    base field .............. "function base("
//    crag detail ............. "function crag("
// ============================================================================
import { makeNoise, mulberry32 } from './noise.js';

export const Y_BOTTOM = -2.5;     // rock floor under the sand (closes the mesh)
const G = 0.25;                   // 2D grid step (m)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// Strata: hard beds stand out, soft beds recede. u is the bed coordinate
// (0..1 in one period). 0 = flush, 1 = full recess.
function strataProfile(u) {
  return sstep(0.22, 0.42, u) - sstep(0.78, 0.96, u);
}

// 1D squared distance transform (Felzenszwalb and Huttenlocher 2012).
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
}
// Euclidean distance (in cells) from every cell to the nearest cell with mask = 1.
function edt2(mask, n) {
  const INF = 1e12, out = new Float64Array(n * n);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < n * n; i++) out[i] = mask[i] ? 0 : INF;
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) f[y] = out[y * n + x]; dt1(f, n, d, v, z); for (let y = 0; y < n; y++) out[y * n + x] = d[y]; }
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) f[x] = out[y * n + x]; dt1(f, n, d, v, z); for (let x = 0; x < n; x++) out[y * n + x] = Math.sqrt(d[x]); }
  return out;
}

function boxBlur2(a, n, r) {
  const t = new Float32Array(n * n), o = new Float32Array(n * n), w = 2 * r + 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let k = -r; k <= r; k++) s += a[y * n + clamp(x + k, 0, n - 1)]; t[y * n + x] = s / w; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[clamp(y + k, 0, n - 1) * n + x]; o[y * n + x] = s / w; }
  return o;
}

// Canyon paths. The trunk crosses the whole plot near the centre. The
// others are tributaries: from the rim to a point on the trunk, so the
// network branches (it is not a star of cuts through one point).
function makeCanyons(rng, R, nz) {
  const count = 2 + (rng() < 0.3 ? 1 : 0);
  const out = [];
  const a0 = rng() * Math.PI * 2;
  const M = 160;
  function build(id, ax, az, bx, bz, A1, A2) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), per = [-dz / L, dx / L];
    const f1 = 0.8 + rng() * 0.8, p1 = rng() * 6.283, f2 = 2.5 + rng() * 2, p2 = rng() * 6.283;
    const w0 = 1.3 + rng() * 0.6, wa = 0.45 + rng() * 0.5, wf = 1.5 + rng() * 2, wp = rng() * 6.283;
    const pts = [], hw = [], cs = [];
    let s = 0;
    for (let i = 0; i <= M; i++) {
      const t = i / M, env = Math.sin(Math.PI * t);         // ends stay on the anchors
      const lat = env * (A1 * Math.sin(6.283 * f1 * t + p1) + A2 * Math.sin(6.283 * f2 * t + p2)) + env * nz.g2(t * 7 + id * 11, 3.3) * 0.035 * R;
      const x = ax + dx * t + per[0] * lat, z = az + dz * t + per[1] * lat;
      if (i) s += Math.hypot(x - pts[pts.length - 2], z - pts[pts.length - 1]);
      pts.push(x, z); cs.push(s);
      hw.push(Math.max(0.85, w0 + wa * Math.sin(6.283 * wf * t + wp) + 0.3 * nz.g2(t * 13 + id * 5, 8.1)));
    }
    return { id, pts, hw, cs, length: s, bridges: [] };
  }
  // trunk
  {
    const off = (rng() - 0.5) * 0.25 * R, d = [Math.cos(a0), Math.sin(a0)], pr = [-d[1], d[0]];
    const a1 = 0.1 * (rng() - 0.5);
    const ex = 1.45 * R;
    out.push(build(0, -d[0] * ex + pr[0] * off, -d[1] * ex + pr[1] * off, d[0] * ex + pr[0] * (off + a1 * R), d[1] * ex + pr[1] * (off + a1 * R), (0.1 + rng() * 0.07) * R, (0.03 + rng() * 0.03) * R));
  }
  for (let c = 1; c < count; c++) {
    const tr = out[0], k = Math.floor((0.28 + rng() * 0.44) * M);
    const jx = tr.pts[2 * k], jz = tr.pts[2 * k + 1];
    // start on the rim, on one side of the trunk, away from its ends
    const side = c === 1 ? 1 : -1;
    const tdx = tr.pts[2 * k + 2] - tr.pts[2 * k - 2], tdz = tr.pts[2 * k + 3] - tr.pts[2 * k - 1], tl = Math.hypot(tdx, tdz);
    const pa = Math.atan2(tdx / tl * side, -tdz / tl * side) + (rng() - 0.5) * 1.1;
    const sx = Math.cos(pa) * 1.45 * R, sz = Math.sin(pa) * 1.45 * R;
    out.push(build(c, sx, sz, jx, jz, (0.06 + rng() * 0.06) * R, (0.02 + rng() * 0.03) * R));
  }
  return out;
}

export function makeGeology(opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const R = clamp(opts.radius ?? 30, 12, 60);
  const detail = clamp(opts.detail ?? 1, 0, 2);
  // Fine crag octaves follow the mesh cell, so the mesh can follow the field.
  const fine = { high: 1, medium: 0.65, low: 0.3 }[opts.quality || 'high'] ?? 1;
  const rng = mulberry32(seed * 2654435761 + 17);
  const nz = makeNoise(seed);
  const E = Math.ceil(1.36 * R / G) * G;               // grid half extent
  const n = Math.round(2 * E / G) + 1;
  const gx = i => -E + i * G;
  const N2 = n * n;

  // Seed-level geology numbers.
  const P = 1.05 + rng() * 0.55;                        // strata period (m)
  const strA = 0.22 + rng() * 0.2;                      // strata recess (m)
  const dipX = (rng() - 0.5) * 0.12, dipZ = (rng() - 0.5) * 0.12;
  const rockShare = 0.34 + rng() * 0.1;
  const hMean = 4.6 + rng() * 1.6;

  // ── canyons: distance, half width, arc length, id ──────────────────────
  const canyons = makeCanyons(rng, R, nz);
  // Per canyon grids (distance, half width, arc length) and their union
  // (C, CW of the nearest canyon) for the plan. The field uses the per
  // canyon grids, so it has no seam where the nearest canyon changes.
  const C = new Float32Array(N2).fill(99), CW = new Float32Array(N2);
  const CK = [];
  {
    const CAP = 16;
    for (const cn of canyons) {
      const Ck = new Float32Array(N2).fill(99), CWk = new Float32Array(N2), CSk = new Float32Array(N2);
      const p = cn.pts, M = p.length / 2 - 1;
      for (let k = 0; k < M; k++) {
        const ax = p[2 * k], az = p[2 * k + 1], bx = p[2 * k + 2], bz = p[2 * k + 3];
        const i0 = clamp(Math.floor((Math.min(ax, bx) - CAP + E) / G), 0, n - 1), i1 = clamp(Math.ceil((Math.max(ax, bx) + CAP + E) / G), 0, n - 1);
        const j0 = clamp(Math.floor((Math.min(az, bz) - CAP + E) / G), 0, n - 1), j1 = clamp(Math.ceil((Math.max(az, bz) + CAP + E) / G), 0, n - 1);
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = gx(i), z = gx(j);
          const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const ex = x - ax - dx * t, ez = z - az - dz * t;
          const d = Math.sqrt(ex * ex + ez * ez), q = j * n + i;
          if (d < Ck[q]) { Ck[q] = d; CWk[q] = cn.hw[k] + (cn.hw[k + 1] - cn.hw[k]) * t; CSk[q] = cn.cs[k] + (cn.cs[k + 1] - cn.cs[k]) * t; }
        }
      }
      for (let q = 0; q < N2; q++) if (Ck[q] - CWk[q] < C[q] - CW[q] || C[q] === 99) { C[q] = Ck[q]; CW[q] = CWk[q]; }
      CK.push({ C: Ck, CW: CWk, CS: CSk, bridges: cn.bridges });
    }
  }

  // ── massif mask and footprint distance ─────────────────────────────────
  const O = new Float32Array(N2);
  const sc = 1 / (0.4 * R);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = gx(i), z = gx(j);
    const wx = nz.g2(x * sc * 0.7 + 3.1, z * sc * 0.7) * 0.35 * R, wz = nz.g2(x * sc * 0.7 - 7.7, z * sc * 0.7 + 1.3) * 0.35 * R;
    O[j * n + i] = nz.fbm2((x + wx) * sc, (z + wz) * sc, 4) + 0.25 * (1 - Math.hypot(x, z) / R);
  }
  // The threshold that gives the rock share of this seed inside R.
  let thr;
  {
    const vals = [];
    for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) if (Math.hypot(gx(i), gx(j)) < R) vals.push(O[j * n + i]);
    vals.sort((a, b) => a - b);
    thr = vals[Math.floor((1 - rockShare) * vals.length)];
  }
  const mask = new Uint8Array(N2), inv = new Uint8Array(N2);
  for (let q = 0; q < N2; q++) {
    let rock = O[q] > thr;
    const bank = CW[q] + 2.2 + 3.6 * Math.max(0, 0.5 + 0.7 * nz.g2(gx(q % n) * 0.09, gx((q / n) | 0) * 0.09));
    if (C[q] < bank) rock = true;                         // canyon banks are always rock
    mask[q] = rock ? 1 : 0; inv[q] = rock ? 0 : 1;
  }
  const dOut = edt2(mask, n), dIn = edt2(inv, n);
  let F = new Float32Array(N2);
  for (let q = 0; q < N2; q++) F[q] = (mask[q] ? -(dIn[q] - 0.5) : dOut[q] - 0.5) * G;
  F = boxBlur2(F, n, 2);

  // ── top height, sand, strata phase, notch depth, cap overhang ─────────
  const H = new Float32Array(N2), S = new Float32Array(N2), PH = new Float32Array(N2), U = new Float32Array(N2), OV = new Float32Array(N2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = gx(i), z = gx(j), q = j * n + i, r = Math.hypot(x, z);
    const fade = sstep(R, 1.3 * R, r);
    // sand: swell + broad ripples (crest across x) + dip past R
    const sw = nz.fbm2(x * 0.05 + 40, z * 0.05, 3) * 0.35;
    const rp = Math.sin(x * 3.6 + z * 0.9 + nz.g2(x * 0.08, z * 0.08) * 4) * 0.035;
    S[q] = sw + rp - 1.6 * fade * fade;
    // strata phase: a gentle dip plus warps
    PH[q] = dipX * x + dipZ * z + nz.fbm2(x * 0.04 - 9, z * 0.04 + 4, 2) * 0.8;
    // top height
    let h = hMean + 1.8 * nz.fbm2(x * 0.045 + 5, z * 0.045 - 3, 4) + 1.4 * (1 - Math.abs(nz.g2(x * 0.09 + 2, z * 0.09))) - 0.7;
    const rim = sstep(CW[q] + 9, CW[q] + 2, C[q]);
    h += 1.4 * rim;
    // soft terraces at the strata period
    const tq = (h + PH[q]) / P, tf = Math.floor(tq), tr = tq - tf;
    h = 0.75 * ((tf + sstep(0.5, 0.95, tr)) * P - PH[q]) + 0.25 * h;
    h = clamp(h, 2.4, 11.5);
    H[q] = S[q] + h * (1 - 0.75 * fade);
    U[q] = clamp(0.95 + 0.8 * nz.fbm2(x * 0.11 + 13, z * 0.11, 2), 0.3, 1.8);
    OV[q] = clamp(0.15 + 1.0 * nz.fbm2(x * 0.08 - 21, z * 0.08 + 6, 2), 0, 1.1);
  }

  // Grid sampler (bilinear). It writes the shared weights first.
  let si = 0, sw00 = 0, sw10 = 0, sw01 = 0, sw11 = 0;
  function at(x, z) {
    const u = clamp((x + E) / G, 0, n - 1.0001), v = clamp((z + E) / G, 0, n - 1.0001);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    si = j * n + i;
    sw00 = (1 - fu) * (1 - fv); sw10 = fu * (1 - fv); sw01 = (1 - fu) * fv; sw11 = fu * fv;
  }
  const lerp = a => a[si] * sw00 + a[si + 1] * sw10 + a[si + n] * sw01 + a[si + n + 1] * sw11;
  const sample = (a, x, z) => { at(x, z); return lerp(a); };
  const gradF = (x, z, out) => { const e = 0.5; out[0] = sample(F, x + e, z) - sample(F, x - e, z); out[1] = sample(F, x, z + e) - sample(F, x, z - e); const l = Math.hypot(out[0], out[1]) || 1; out[0] /= l; out[1] /= l; return out; };
  const sandAt = (x, z) => sample(S, x, z);

  // Points on the massif edge (F about 0), inside rMax, with the outward normal.
  function edgePoints(count, rMax, tries = count * 60) {
    const pts = [], g2 = [0, 0];
    for (let t = 0; t < tries && pts.length < count; t++) {
      const a = rng() * 6.283, r = Math.sqrt(rng()) * rMax;
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      for (let it = 0; it < 4; it++) { const f = sample(F, x, z); gradF(x, z, g2); x -= g2[0] * f; z -= g2[1] * f; }
      if (Math.abs(sample(F, x, z)) > 0.15 || Math.hypot(x, z) > rMax) continue;
      gradF(x, z, g2);
      pts.push({ x, z, nx: g2[0], nz: g2[1] });
    }
    return pts;
  }

  // ── bridges over the canyons ───────────────────────────────────────────
  const bridges = [];
  for (const cn of canyons) {
    const want = cn.id === 0 ? 2 : 1;
    const p = cn.pts, M = p.length / 2;
    const cand = [];
    for (let k = 4; k < M - 4; k++) { const r = Math.hypot(p[2 * k], p[2 * k + 1]); if (r < 0.72 * R) cand.push(k); }
    for (let b = 0, guard = 0; b < want && cand.length && guard < 40; guard++) {
      const k = cand[Math.floor(rng() * cand.length)];
      const s0 = cn.cs[k];
      if (cn.bridges.some(o => Math.abs(o.s0 - s0) < 9)) continue;
      // keep the bridge on a straight piece (the arc parameter is clean there)
      const ax = p[2 * k + 2] - p[2 * k - 2], az = p[2 * k + 3] - p[2 * k - 1], bx = p[2 * k + 8] - p[2 * k], bz = p[2 * k + 9] - p[2 * k + 1];
      const cosT = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));
      if (cosT < 0.9) continue;
      const x = p[2 * k], z = p[2 * k + 1];
      const hw = cn.hw[k];
      const br = { canyon: cn.id, s0, x, z, Tb: 0.9 + rng() * 0.7, rise: 2.3 + rng() * 1.5, thick: 1.1 + rng() * 0.8, wf: hw * 1.25 + 0.4, dir: [ax, az] };
      cn.bridges.push(br); bridges.push(br); b++;
    }
  }
  // Raise the massif top near each bridge so that the slab has rock.
  for (const br of bridges) {
    const need = br.rise + br.thick + 1.2, rr = br.wf + 7;
    const i0 = clamp(Math.floor((br.x - rr + E) / G), 0, n - 1), i1 = clamp(Math.ceil((br.x + rr + E) / G), 0, n - 1);
    const j0 = clamp(Math.floor((br.z - rr + E) / G), 0, n - 1), j1 = clamp(Math.ceil((br.z + rr + E) / G), 0, n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = j * n + i, d = Math.hypot(gx(i) - br.x, gx(j) - br.z), w = sstep(rr, rr * 0.5, d);
      H[q] = Math.max(H[q], S[q] + need * w + (H[q] - S[q]) * (1 - w));
    }
  }

  // ── free arches at the massif edge ─────────────────────────────────────
  const arches = [];
  function canyonClear(x, z, m) { return sample(C, x, z) > sample(CW, x, z) + m; }
  function placeArches(want, relax) {
    const cands = edgePoints(160, 0.8 * R);
    for (const e of cands) {
      if (arches.length >= want) break;
      const Ra = (3.2 + rng() * 2.4) * relax, rt = 0.75 + rng() * 0.45, vs = 1.05 + rng() * 0.35;
      // the arch stands on the edge and springs out into the sand
      const cx = e.x + e.nx * Ra * 0.95, cz = e.z + e.nz * Ra * 0.95;
      if (Math.hypot(cx, cz) > 0.82 * R) continue;
      if (sample(F, cx, cz) < rt + 1.2 * relax) continue;               // the gap is open sand
      if (!canyonClear(cx, cz, 2)) continue;
      const ox = cx + e.nx * Ra, oz = cz + e.nz * Ra;                     // far foot
      if (!canyonClear(ox, oz, 1.5)) continue;
      if (arches.some(a => Math.hypot(a.x - cx, a.z - cz) < a.Ra + Ra + 3)) continue;
      const sy = sandAt(cx, cz);
      arches.push({ x: cx, z: cz, yc: sy - Ra * 0.22, Ra, rt, vs, ax: e.nx, az: e.nz, R2: (Ra + rt * 2.2 + 1) ** 2 });
    }
  }
  const wantArches = 2 + (rng() < 0.5 ? 1 : 0);
  placeArches(wantArches, 1);
  if (arches.length < 2) placeArches(2, 0.7);
  if (arches.length < 2) {
    // Last resort: a free arch in the widest sand inside 0.75 R.
    let best = -1, bx = 0, bz = 0;
    for (let j = 0; j < n; j += 4) for (let i = 0; i < n; i += 4) {
      const x = gx(i), z = gx(j);
      if (Math.hypot(x, z) > 0.75 * R || !canyonClear(x, z, 3)) continue;
      const f = F[j * n + i] - (arches.some(a => Math.hypot(a.x - x, a.z - z) < a.Ra + 8) ? 99 : 0);
      if (f > best) { best = f; bx = x; bz = z; }
    }
    while (arches.length < 2) {
      const Ra = clamp(best * 0.9, 2.2, 4.5), a = rng() * 6.283;
      const x = bx + (arches.length ? 0 : 0), z = bz;
      arches.push({ x, z, yc: sandAt(x, z) - Ra * 0.22, Ra, rt: 0.7, vs: 1.2, ax: Math.cos(a), az: Math.sin(a), R2: (Ra + 2.6) ** 2 });
      if (arches.length < 2) { bx = -bx * 0.6 + 4; bz = -bz * 0.6 - 3; }
    }
  }

  // ── pinnacles and hoodoos in the sand ──────────────────────────────────
  const pinnacles = [];
  {
    const want = 3 + Math.floor(rng() * 4);
    for (let t = 0; t < 600 && pinnacles.length < want; t++) {
      const a = rng() * 6.283, r = Math.sqrt(rng()) * 0.85 * R;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const r0 = 0.9 + rng() * 1.0;
      if (sample(F, x, z) < r0 + 1.4 || !canyonClear(x, z, r0 + 2)) continue;
      if (arches.some(q => Math.hypot(q.x - x, q.z - z) < q.Ra + r0 + 2.5)) continue;
      if (pinnacles.some(q => Math.hypot(q.x - x, q.z - z) < q.r0 + r0 + 4)) continue;
      const hgt = 4 + rng() * 6, cap = rng() < 0.55;
      pinnacles.push({ x, z, y0: sandAt(x, z), r0, h: hgt, lx: (rng() - 0.5) * 0.16, lz: (rng() - 0.5) * 0.16, cap, capR: r0 * (1.35 + rng() * 0.35), capT: 0.7 + rng() * 0.5, R2: (r0 * 2 + 2 + hgt * 0.1) ** 2 });
    }
  }

  // ── caves into thick walls ─────────────────────────────────────────────
  const caves = [];
  {
    const want = 2 + Math.floor(rng() * 3);
    for (const e of edgePoints(80, 0.85 * R)) {
      if (caves.length >= want) break;
      const L = 3 + rng() * 2.5;
      if (sample(F, e.x - e.nx * (L + 1.5), e.z - e.nz * (L + 1.5)) > -2.5) continue;
      if (!canyonClear(e.x, e.z, 1)) continue;
      if (sample(H, e.x - e.nx * 2, e.z - e.nz * 2) - sandAt(e.x, e.z) < 3.6) continue;
      if (caves.some(c => Math.hypot(c.ax - e.x, c.az - e.z) < 10)) continue;
      if (arches.some(a => Math.hypot(a.x - e.x, a.z - e.z) < a.Ra + 4)) continue;
      const y = sandAt(e.x, e.z) + 1.1 + rng() * 0.5, rad = 1.25 + rng() * 0.5;
      caves.push({ ax: e.x + e.nx * 0.6, az: e.z + e.nz * 0.6, ay: y, bx: e.x - e.nx * L, bz: e.z - e.nz * L, by: y + (rng() - 0.3) * 0.8, rad, sq: 0.68 + rng() * 0.15, nx: e.nx, nz: e.nz });
    }
  }

  // ── boulders and scree at the wall bases ───────────────────────────────
  const boulders = [];
  {
    const big = 26 + Math.floor(rng() * 16);
    const edges = edgePoints(big * 2, 1.02 * R);
    const addB = (x, z, r, sunk) => {
      if (Math.hypot(x, z) > 1.06 * R) return;
      if (caves.some(c => Math.hypot(c.ax - x, c.az - z) < c.rad + r + 1.2)) return;
      if (arches.some(a => Math.hypot(a.x - x, a.z - z) < a.Ra * 0.55)) return;
      const rot = rng() * 3.1416;
      boulders.push({ x, z, y: sandAt(x, z) + r * (0.55 - sunk), rx: r * (0.8 + rng() * 0.4), ry: r * (0.55 + rng() * 0.3), rz: r * (0.8 + rng() * 0.4), c: Math.cos(rot), s: Math.sin(rot) });
    };
    let k = 0;
    for (const e of edges) {
      if (k++ >= big) break;
      const r = 0.5 + rng() * 0.9, out = r * (0.2 + rng() * 0.9);
      const x = e.x + e.nx * out, z = e.z + e.nz * out;
      addB(x, z, r, 0.25);
      // scree: a few small stones around each boulder
      const m = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < m; i++) {
        const a = rng() * 6.283, d = r + 0.3 + rng() * 1.6, rs = 0.22 + rng() * 0.25;
        addB(x + Math.cos(a) * d + e.nx * 0.4, z + Math.sin(a) * d + e.nz * 0.4, rs, 0.2);
      }
    }
    // rock fall on the canyon floors, against the walls
    for (const cn of canyons) {
      const p = cn.pts, M = p.length / 2;
      for (let t = 0; t < 10; t++) {
        const k2 = 2 + Math.floor(rng() * (M - 4));
        const x0 = p[2 * k2], z0 = p[2 * k2 + 1];
        if (Math.hypot(x0, z0) > 0.95 * R) continue;
        if (cn.bridges.some(b => Math.hypot(b.x - x0, b.z - z0) < 4)) continue;
        const dx = p[2 * k2 + 2] - p[2 * k2 - 2], dz = p[2 * k2 + 3] - p[2 * k2 - 1], l = Math.hypot(dx, dz);
        const side = rng() < 0.5 ? -1 : 1, px = -dz / l * side, pz = dx / l * side;
        const r = 0.35 + rng() * 0.55, w = cn.hw[k2];
        addB(x0 + px * (w - r * 0.3), z0 + pz * (w - r * 0.3), r, 0.2);
      }
    }
  }
  // Bins for the boulders (4 m cells).
  const BIN = 4, nb = Math.ceil(2 * E / BIN) + 1;
  const bins = Array.from({ length: nb * nb }, () => []);
  for (let i = 0; i < boulders.length; i++) {
    const b = boulders[i], rr = Math.max(b.rx, b.rz) + 1.6;
    const i0 = clamp(Math.floor((b.x - rr + E) / BIN), 0, nb - 1), i1 = clamp(Math.floor((b.x + rr + E) / BIN), 0, nb - 1);
    const j0 = clamp(Math.floor((b.z - rr + E) / BIN), 0, nb - 1), j1 = clamp(Math.floor((b.z + rr + E) / BIN), 0, nb - 1);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) bins[j * nb + ii].push(i);
  }

  // Highest point (for the mesh bounds).
  let yMax = 0;
  for (let q = 0; q < N2; q++) if (F[q] < 0.5 && H[q] > yMax) yMax = H[q];
  for (const p of pinnacles) yMax = Math.max(yMax, p.y0 + p.h + 1);
  for (const a of arches) yMax = Math.max(yMax, a.yc + a.Ra * a.vs + a.rt * 2);
  yMax += 0.6 + 0.6 * detail;

  const R13 = 1.3 * R, R132 = 1.32 * R;
  // Beds of uneven thickness, and an uneven recess per bed (some beds are
  // flush, some stand out as ledges).
  const bp1 = rng() * 6.283, bp2 = rng() * 6.283, bseed = Math.floor(rng() * 1e6);
  function bedCoord(y, ph) { const u = (y + ph) / P; return u + 0.2 * Math.sin(u * 2.31 + bp1) + 0.1 * Math.sin(u * 5.13 + bp2); }
  function bedAmp(b) { let h = Math.imul(b + bseed, 0x2c1b3c6d) ^ 0x297a2d39; h = Math.imul(h ^ (h >>> 12), 0x297a2d39); const r = ((h ^ (h >>> 15)) >>> 0) / 4294967296; return r < 0.25 ? 0.15 : 0.45 + 0.75 * r; }
  const BAND = 0.9 + 0.5 * detail;

  // ── the base field (no crag detail) ────────────────────────────────────
  function base(x, y, z) {
    const r = Math.sqrt(x * x + z * z);
    if (r > R132 + 0.5) return r - R132;
    if (y < Y_BOTTOM - 0.5) return Y_BOTTOM - y;
    at(x, z);
    const f0 = lerp(F), h = lerp(H), s = lerp(S);
    const fade = r <= R ? 0 : sstep(R, R13, r);
    const yr = y - s;
    const ub = bedCoord(y, lerp(PH)), bi = Math.floor(ub), st = strataProfile(ub - bi) * bedAmp(bi);
    const un = lerp(U), ov = lerp(OV);
    const nb2 = (yr - 0.85) / 0.75, notch = un * Math.exp(-nb2 * nb2);
    const capT = ov * sstep(h - 2.8, h - 1.3, y);
    // massif
    const f = f0 + strA * st + notch - capT + fade * 8;
    let d = smax(f, y - h, 0.7);
    // canyon voids (with bridge slabs left in), one per canyon, joined
    let cvAll = 99;
    for (let ck = 0; ck < CK.length; ck++) {
      const K = CK[ck];
      const c = lerp(K.C);
      if (c > 12) continue;
      const cw = lerp(K.CW);
      const yf = Math.max(0, yr - 2.6);
      const w = cw + 0.18 * yf + 0.05 * yf * yf + notch * 1.15 + strA * st * 0.8;
      let cv = c - w;
      if (cv < 2.5 && K.bridges.length) {
        const cs = lerp(K.CS);
        for (let b = 0; b < K.bridges.length; b++) {
          const br = K.bridges[b], ds = Math.abs(cs - br.s0);
          if (ds > br.Tb + 3) continue;
          const lat = Math.min(1, c / br.wf);
          const yb = s + br.rise * Math.sqrt(Math.max(0, 1 - lat * lat)) - 0.4;
          const yt = s + br.rise + br.thick + 0.35 * lat;
          const tb = br.Tb * (1 + 0.25 * Math.sin(y * 1.7 + c));
          const slab = Math.max(ds - tb, yb - y, y - yt);
          cv = smax(cv, -slab, 0.5);
        }
      }
      cvAll = ck === 0 ? cv : smin(cvAll, cv, 0.6);
    }
    if (cvAll < 3) d = smax(d, -cvAll, 0.45);
    // caves
    for (let k = 0; k < caves.length; k++) {
      const cv = caves[k];
      const bax = cv.bx - cv.ax, bay = cv.by - cv.ay, baz = cv.bz - cv.az;
      const pax = x - cv.ax, pay = y - cv.ay, paz = z - cv.az;
      const t = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
      const ex = pax - bax * t, ey = (pay - bay * t) / cv.sq, ez = paz - baz * t;
      const rr = cv.rad * (1 - 0.35 * t);
      const dc = (Math.sqrt(ex * ex + ey * ey + ez * ez) - rr) * cv.sq;
      if (dc < 2) d = smax(d, -dc, 0.6);
    }
    // arches: half tori in a vertical plane
    for (let k = 0; k < arches.length; k++) {
      const a = arches[k];
      const dx = x - a.x, dz = z - a.z;
      if (dx * dx + dz * dz > a.R2) continue;
      const uu = dx * a.ax + dz * a.az, ww = -dx * a.az + dz * a.ax, vv = (y - a.yc) / a.vs;
      const rho = Math.sqrt(uu * uu + vv * vv);
      const sinT = vv / (rho || 1);
      const rt = a.rt * (1 + 0.55 * (1 - Math.max(0, sinT)) + 0.15 * Math.sin(uu * 1.3));
      const qx = (rho - a.Ra) * Math.min(1, a.vs), qy = ww / 1.35;
      const da = (Math.sqrt(qx * qx + qy * qy) - rt) * 1.0;
      d = smin(d, da, 0.9);
    }
    // pinnacles
    for (let k = 0; k < pinnacles.length; k++) {
      const p = pinnacles[k];
      const yy = y - p.y0;
      const dx = x - p.x - p.lx * yy, dz = z - p.z - p.lz * yy;
      if (dx * dx + dz * dz > p.R2) continue;
      const tH = clamp(yy / p.h, 0, 1);
      let rad = p.r0 * (1 - 0.38 * tH) + 0.8 * Math.exp(-Math.max(0, yy) / 0.8) - strA * 0.8 * st - notch * 0.25;
      let dp = smax(Math.sqrt(dx * dx + dz * dz) - rad, yy - p.h, 0.5);
      if (p.cap) {
        const cy = yy - (p.h - p.capT * 0.5);
        const dcap = Math.max(Math.sqrt(dx * dx + dz * dz) - p.capR, Math.abs(cy) - p.capT * 0.5);
        dp = smin(dp, dcap, 0.5);
      }
      d = smin(d, dp, 0.8);
    }
    // boulders and scree
    if (y < 4) {
      const bi = clamp(Math.floor((x + E) / BIN), 0, nb - 1), bj = clamp(Math.floor((z + E) / BIN), 0, nb - 1);
      const list = bins[bj * nb + bi];
      for (let k = 0; k < list.length; k++) {
        const b = boulders[list[k]];
        const dx = x - b.x, dy = y - b.y, dz = z - b.z;
        const lx = (dx * b.c - dz * b.s) / b.rx, lz = (dx * b.s + dz * b.c) / b.rz, ly = dy / b.ry;
        const mr = Math.min(b.rx, b.ry, b.rz);
        const db = (Math.sqrt(lx * lx + ly * ly + lz * lz) - 1) * mr;
        if (db < 1.2) d = smin(d, db, 0.25);
      }
    }
    if (y < Y_BOTTOM + 0.6) d = smax(d, Y_BOTTOM - y, 0.25);
    if (r > R13 - 1) d = Math.max(d, r - R132);
    return d;
  }

  // ── crag detail (near the surface only) ────────────────────────────────
  const W2 = [0, 0];
  const ampR = 0.34 * detail, ampR2 = 0.15 * detail * fine, ampW = 0.2 * detail * (0.4 + 0.6 * fine), ampP = 0.05 * detail * (fine > 0.9 ? 1 : 0);
  function crag(x, y, z) {
    // domain warp
    const wx = nz.g3(x * 0.21, y * 0.21, z * 0.21 + 5.2) * 1.3;
    const wy = nz.g3(x * 0.21 + 9.7, y * 0.21, z * 0.21) * 0.6;
    const wz = nz.g3(x * 0.21, y * 0.21 - 3.3, z * 0.21) * 1.3;
    const qx = x + wx, qy = y + wy, qz = z + wz;
    // ridged crests (stand out) at about 2.2 m and 0.9 m
    const r1 = nz.ridged3(qx * 0.45, qy * 0.6, qz * 0.45);
    const r2 = nz.ridged3(qx * 1.1 + 3, qy * 1.3, qz * 1.1);
    let disp = -ampR * (r1 * r1 - 0.45) - ampR2 * (r2 * r2 - 0.45);
    // Worley joints: grooves on the cell borders, blocks bulge
    nz.worley3(qx * 0.62, qy * 0.75, qz * 0.62, W2);
    const e = W2[1] - W2[0];
    disp += ampW * (1 - sstep(0.0, 0.28, e)) - ampW * 0.45 * sstep(0.3, 0.9, e);
    // fine pits
    if (ampP > 0) disp += ampP * nz.g3(x * 2.3, y * 2.3, z * 2.3);
    // limit the outward relief (no thin fins or loose flakes in the water)
    if (disp < -0.16 * detail) disp = -0.16 * detail + (disp + 0.16 * detail) * 0.35;
    return disp;
  }

  function sdf(x, y, z) {
    const b = base(x, y, z);
    const ab = b < 0 ? -b : b;
    if (ab >= BAND || detail <= 0) return b;
    const w = 1 - sstep(BAND * 0.55, BAND, ab);
    return b + crag(x, y, z) * w;
  }

  // Features for the ROV survey paths and the tests.
  const features = [];
  for (const cn of canyons) {
    // the part of the path inside the plot
    const path = [];
    for (let k = 0; k < cn.pts.length / 2; k += 4) {
      const x = cn.pts[2 * k], z = cn.pts[2 * k + 1];
      if (Math.hypot(x, z) < 0.98 * R) path.push([x, sandAt(x, z), z]);
    }
    if (path.length < 2) continue;
    const mid = path[Math.floor(path.length / 2)];
    let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
    const hw = cn.hw.reduce((a, b) => a + b, 0) / cn.hw.length;
    features.push({ kind: 'canyon', id: cn.id, center: mid, size: len, width: 2 * hw, path });
  }
  for (const br of bridges) {
    const s = sandAt(br.x, br.z), l = Math.hypot(br.dir[0], br.dir[1]);
    features.push({ kind: 'arch', type: 'bridge', canyon: br.canyon, center: [br.x, s + br.rise * 0.5, br.z], size: 2 * br.wf, gap: [s, s + br.rise - 0.4], top: s + br.rise + br.thick, axis: [br.dir[0] / l, 0, br.dir[1] / l] });
  }
  for (const a of arches) {
    const s = sandAt(a.x, a.z);
    const inner = a.yc + (a.Ra - a.rt * 1.05) * a.vs;
    features.push({ kind: 'arch', type: 'free', center: [a.x, (s + inner) / 2, a.z], size: 2 * a.Ra, gap: [s, inner], top: a.yc + (a.Ra + a.rt) * a.vs, axis: [-a.az, 0, a.ax] });
  }
  for (const p of pinnacles) features.push({ kind: 'pinnacle', center: [p.x, p.y0 + p.h / 2, p.z], size: p.h, radius: p.r0, hoodoo: p.cap });
  for (const p of pinnacles) if (p.cap) features.push({ kind: 'overhang', type: 'hoodoo cap', center: [p.x, p.y0 + p.h - p.capT, p.z], size: 2 * p.capR });
  for (const c of caves) features.push({ kind: 'cave', center: [(c.ax + c.bx) / 2, c.ay, (c.az + c.bz) / 2], size: Math.hypot(c.bx - c.ax, c.bz - c.az), mouth: [c.ax, c.ay, c.az], axis: [-c.nx, 0, -c.nz], radius: c.rad });
  {
    // cap overhangs and strata ledges on the massif walls
    const ov = [], le = [];
    for (const e of edgePoints(120, 0.85 * R)) {
      const o = sample(OV, e.x, e.z), h = sample(H, e.x, e.z), s = sandAt(e.x, e.z);
      if (o > 0.75 && h - s > 3.5 && ov.length < 5 && !ov.some(q => Math.hypot(q[0] - e.x, q[2] - e.z) < 8)) ov.push([e.x, h - 1, e.z, o]);
      else if (h - s > 4 && le.length < 5 && !le.some(q => Math.hypot(q[0] - e.x, q[2] - e.z) < 8)) le.push([e.x, s + P * Math.ceil(2 / P), e.z]);
    }
    for (const o of ov) features.push({ kind: 'overhang', type: 'cap', center: [o[0], o[1], o[2]], size: o[3] });
    for (const l of le) features.push({ kind: 'ledge', center: l, size: P });
  }

  return {
    seed, R, E, detail, sdf, base, crag, sandAt, band: BAND,
    strata: { period: P, recess: strA, dip: [dipX, dipZ], phaseAt: (x, z) => sample(PH, x, z), bedAt: (x, y, z) => bedCoord(y, sample(PH, x, z)) },
    yMax, features,
    plan: { canyons, bridges, arches, pinnacles, caves, boulders, rockShare },
    grids: { n, G, F, H, S, C, CW, CK },
  };
}

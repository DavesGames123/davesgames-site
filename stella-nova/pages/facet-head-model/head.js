// ============================================================================
//  FACET HEAD MODEL  ·  head.js — the toy head population
// ----------------------------------------------------------------------------
//  A head here is a 2D side profile: an open polyline of N_V vertices in mm,
//  from the nape over the crown and down the face to the throat. A seeded
//  generator makes identities. Each identity is the template plus:
//    - 4 local bumps along the normal in each of the 8 regions (independent
//      random sizes, so a held-out head is a new mix of known parts),
//    - 2 global terms (scale and face length) that move every region,
//    - small per-vertex noise, which stands in for scan noise.
//  So the population has 8 * 4 + 2 = 34 latent dimensions. A global PCA on
//  N heads has at most N - 1 modes; below N = 35 it cannot span them.
//  This is our own toy. FACET uses 3D scans, 16 regions and 8,447 vertices.
//
//  grep -n: "export const REGIONS"  "export function template"
//           "export function population"  "export function regionWeights"
// ============================================================================

export const N_V = 180;           // vertices on the profile
export const NOISE_MM = 0.15;     // per-vertex noise (sd, mm)

// Control points of the template profile (mm, face to +x, y up).
const CP = [
  [-58, -130], [-62, -82], [-86, -22], [-78, 40], [-22, 86], [32, 80],
  [74, 44], [86, 18], [80, 6], [108, -16], [88, -26], [93, -35],
  [86, -42], [91, -50], [82, -60], [87, -76], [70, -91], [36, -96],
  [30, -112], [33, -136],
];
// Regions as control-point spans, sd (mm) of the local bumps.
export const REGIONS = [
  { key: 'neck', name: 'Back of neck', cp: [0, 2], sd: 2.6 },
  { key: 'cranium', name: 'Cranium', cp: [2, 4], sd: 3.6 },
  { key: 'forehead', name: 'Forehead', cp: [4, 6], sd: 2.8 },
  { key: 'brow', name: 'Brow', cp: [6, 8], sd: 2.2 },
  { key: 'nose', name: 'Nose', cp: [8, 10], sd: 3.8 },
  { key: 'lips', name: 'Lips', cp: [10, 14], sd: 2.6 },
  { key: 'chin', name: 'Chin', cp: [14, 17], sd: 3.2 },
  { key: 'throat', name: 'Throat', cp: [17, 19], sd: 2.6 },
];
export const OVERLAP = 4;         // vertices of blend on each side of a cut
const BUMPS = 4;

// ── seeded random numbers ──
export function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = () => { let x = 0; while (x === 0) x = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u()); };
  return { u, g };
}

// ── template: Catmull-Rom through CP, resampled by arc length ──
let T = null;
export function template() {
  if (T) return T;
  const dense = [], cpAt = [0];
  const P = [CP[0], ...CP, CP.at(-1)];
  for (let s = 1; s < P.length - 2; s++) {
    const [p0, p1, p2, p3] = [P[s - 1], P[s], P[s + 1], P[s + 2]];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      dense.push([0, 1].map(d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
    cpAt.push(dense.length);
  }
  dense.push(CP.at(-1));
  const arc = [0];
  for (let i = 1; i < dense.length; i++) arc.push(arc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = arc.at(-1), pts = new Float64Array(2 * N_V), cpV = cpAt.map(i => Math.round(arc[Math.min(i, arc.length - 1)] / total * (N_V - 1)));
  for (let v = 0, j = 0; v < N_V; v++) {
    const s = v / (N_V - 1) * total;
    while (j < arc.length - 2 && arc[j + 1] < s) j++;
    const f = (s - arc[j]) / Math.max(1e-9, arc[j + 1] - arc[j]);
    pts[2 * v] = dense[j][0] + f * (dense[j + 1][0] - dense[j][0]);
    pts[2 * v + 1] = dense[j][1] + f * (dense[j + 1][1] - dense[j][1]);
  }
  const nrm = new Float64Array(2 * N_V);
  for (let v = 0; v < N_V; v++) {
    const a = Math.max(0, v - 1), b = Math.min(N_V - 1, v + 1);
    const tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1], l = Math.hypot(tx, ty) || 1;
    nrm[2 * v] = -ty / l; nrm[2 * v + 1] = tx / l;     // outward: the curve runs clockwise
  }
  const span = REGIONS.map(r => [cpV[r.cp[0]], cpV[r.cp[1]]]);
  span[span.length - 1][1] = N_V;                      // last region to the end
  span[0][0] = 0;
  T = { pts, nrm, span, centre: [10, -10] };
  return T;
}

// Region of each vertex (by the cuts, no overlap).
export function regionOf(v) {
  const { span } = template();
  for (let r = 0; r < span.length; r++) if (v >= span[r][0] && v < span[r][1]) return r;
  return span.length - 1;
}

// Blend weights w[r][v]: 1 inside region r, a linear ramp over
// 2 * OVERLAP vertices at each cut, sum over r = 1 at every vertex.
let W = null;
export function regionWeights() {
  if (W) return W;
  const { span } = template(), R = span.length;
  W = REGIONS.map(() => new Float64Array(N_V));
  for (let v = 0; v < N_V; v++) {
    for (let r = 0; r < R; r++) {
      const [a, b] = span[r];
      const lo = r === 0 ? 1 : clamp01((v - a + OVERLAP + 0.5) / (2 * OVERLAP));
      const hi = r === R - 1 ? 1 : clamp01((b + OVERLAP - 0.5 - v) / (2 * OVERLAP));
      W[r][v] = Math.min(lo, hi);
    }
    let s = 0; for (let r = 0; r < R; r++) s += W[r][v];
    for (let r = 0; r < R; r++) W[r][v] /= s;
  }
  return W;
}
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

// Support of region r: the vertices with weight > 0.
export function support(r) {
  const w = regionWeights()[r], out = [];
  for (let v = 0; v < N_V; v++) if (w[v] > 0) out.push(v);
  return out;
}

// One identity from latent draws. lat = { bumps: [R][BUMPS], scale, length }.
export function makeHead(lat, noise = null) {
  const { pts, nrm, span, centre } = template();
  const p = new Float64Array(pts);
  for (let r = 0; r < span.length; r++) {
    const [a, b] = span[r], w = (b - a) / BUMPS;
    for (let j = 0; j < BUMPS; j++) {
      const c = a + (j + 0.5) * w, amp = lat.bumps[r][j];
      for (let v = Math.max(0, Math.floor(c - 4 * w)); v < Math.min(N_V, Math.ceil(c + 4 * w)); v++) {
        const g = amp * Math.exp(-0.5 * ((v - c) / (0.9 * w)) ** 2);
        p[2 * v] += g * nrm[2 * v]; p[2 * v + 1] += g * nrm[2 * v + 1];
      }
    }
  }
  for (let v = 0; v < N_V; v++) {
    const dx = p[2 * v] - centre[0], dy = p[2 * v + 1] - centre[1];
    p[2 * v] = centre[0] + dx * lat.scale;
    p[2 * v + 1] = centre[1] + dy * lat.scale * lat.length;
  }
  if (noise) for (let i = 0; i < p.length; i++) p[i] += NOISE_MM * noise.g();
  return p;
}

// The population: a training pool and a held-out test pool from one seed.
// The test pool is drawn from its own stream, so it does not change with n.
export function population(n, nTest = 30, seed = 7) {
  const draw = R => ({
    bumps: REGIONS.map(rg => Array.from({ length: BUMPS }, () => rg.sd * R.g())),
    scale: 1 + 0.045 * R.g(), length: 1 + 0.035 * R.g(),
  });
  const Rt = rng(seed), Rh = rng(seed ^ 0x9e3779b9);
  const train = [], test = [];
  for (let i = 0; i < n; i++) { const l = draw(Rt); train.push(makeHead(l, Rt)); }
  for (let i = 0; i < nTest; i++) { const l = draw(Rh); test.push(makeHead(l, Rh)); }
  return { train, test };
}
export const LATENT_DIMS = REGIONS.length * BUMPS + 2;

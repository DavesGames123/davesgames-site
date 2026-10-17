// ============================================================================
//  DLA TERRAIN  ·  render/water.js — the WATER package: ocean, rivers, lakes,
//  waterfalls and their mist. Shaders: ../shaders/water.wgsl.
//
//  createWater(gpu) follows the module interface in ../CONTRACT.md:
//    setTerrain(t)   builds the river ribbons, the lake meshes, the waterfall
//                    list and the ocean grid from the LIB Terrain (t.cpu).
//    update(frame)   smooths G.wind, picks the wave spectrum, wraps phases,
//                    writes the uniforms.
//    compute(enc)    sums the three wave cascades into two texture arrays.
//    drawWater(pass, frame, ctx)  ocean, then rivers and lakes, then mist.
//                    ctx.sceneColorView: copy of opaque + sky (sampled).
//                    ctx.depthView: depth32float, sampled with textureLoad.
//                    By default the water does not write depth, so the pass
//                    can attach the depth read-only and sample it at once.
//                    With ctx.depthIsCopy = true (depthView is a copy) the
//                    surfaces write depth for the volumetric pass after them.
//    resize, dispose.
//
//  DOM-free builders (node tests in ../tests/water.test.mjs reach them):
//    waveModes(opts)            lattice wave vectors and Phillips amplitudes
//    wavePhases(modes, t, out)  phases wrapped in double precision
//    buildRiverRibbons(t, o)    ribbons from Terrain.rivers: smoothed centre
//                               line, width monotone with flow, no folds at
//                               bends, surface follows the bed and falls
//                               downstream, speed from slope (Manning),
//                               rapids, waterfalls, confluence foam
//    buildLakeMeshes(t, o)      flood fill of each lake basin below its level
//    buildOceanGrid(rMin, rMax, nr, na)  polar grid to the horizon
//    sampleHeight(t, x, z)      bilinear height at texel centres
//
//  Ideas reused from our pages (credit): pages/coral-reef caustics,
//  pages/city-atlas sky, pages/forge Mie phase, pages/tidal-currents and
//  pages/fluidlab (flow advection, two-phase cross-fade of advected
//  textures). The wave model is Tessendorf 2001 (Phillips spectrum, choppy
//  displacement) with direct summation of lattice modes in place of an FFT.
//
//  grep -n targets: "export function waveModes", "export function
//  wavePhases", "export function buildRiverRibbons", "export function
//  buildLakeMeshes", "export function buildOceanGrid", "export function
//  sampleHeight", "export async function createWater", "SURF_STRIDE",
//  "function writeUniforms"
// ============================================================================

export const WAVE_N = 256;
export const CASCADES = [
  { L: 600, lmin: 42, lmax: 600 },
  { L: 83, lmin: 6, lmax: 42 },
  { L: 13, lmin: 0.5, lmax: 6 },
];
export const SURF_STRIDE = 12; // floats per river / lake vertex
const GRAV = 9.81;
const TAU = Math.PI * 2;

// ------------------------------------------------------------ small utils ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ----------------------------------------------------------- wave spectrum ----
// Fixed lattice wave vectors per cascade (tileable on the cascade tile), so a
// wind change only changes amplitudes, never the wave pattern itself.
export function waveLattice(count = 80, seed = 7) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let c = 0; c < 3; c++) {
    const { L, lmin, lmax } = CASCADES[c];
    const k0 = TAU / lmax, k1 = TAU / lmin;
    const nAng = 10, nMag = Math.max(1, Math.floor(count / nAng));
    const seen = new Set();
    const modes = [];
    for (let im = 0; im < nMag; im++) {
      const ka = k0 * Math.pow(k1 / k0, im / nMag), kb = k0 * Math.pow(k1 / k0, (im + 1) / nMag);
      for (let ia = 0; ia < nAng; ia++) {
        const kk = ka * Math.pow(kb / ka, rnd());
        const th = (ia + rnd()) / nAng * TAU;
        const m = Math.round(kk * Math.cos(th) * L / TAU), n = Math.round(kk * Math.sin(th) * L / TAU);
        const key = m + ',' + n;
        if ((m === 0 && n === 0) || seen.has(key)) continue;
        seen.add(key);
        const area = (TAU / nAng) * (kb * kb - ka * ka) / 2;
        modes.push({ kx: m * TAU / L, kz: n * TAU / L, area, phase: rnd() * TAU });
      }
    }
    out.push(modes.slice(0, count));
  }
  return out;
}

function phillips(kx, kz, wx, wz, V) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const Lw = (V * V) / GRAV;
  const kd = (kx * wx + kz * wz) / k;
  let dir = kd * kd;
  if (kd < 0) dir *= 0.12;
  const small = 0.02;
  return Math.exp(-1 / ((k * Lw) * (k * Lw))) / (k * k * k * k) * dir * Math.exp(-(k * small) * (k * small));
}

// Significant wave height of a fully developed sea (Pierson-Moskowitz).
export function seaHs(V) { return clamp(0.21 * V * V / GRAV, 0.08, 12); }

// -> { data: Float32Array (3 * count * 4: kx, kz, amp, phase0), omega:
//      Float32Array, count, hs, slopeVar: [3] }
export function waveModes({ wind = [6, 2], storm = 0, count = 80, seed = 7, scale = 1, lattice } = {}) {
  const lat = lattice || waveLattice(count, seed);
  const V = Math.max(Math.hypot(wind[0], wind[1]), 3);
  const wx = Math.hypot(wind[0], wind[1]) > 1e-3 ? wind[0] / Math.hypot(wind[0], wind[1]) : 0.8;
  const wz = Math.hypot(wind[0], wind[1]) > 1e-3 ? wind[1] / Math.hypot(wind[0], wind[1]) : 0.6;
  const data = new Float32Array(3 * count * 4);
  const omega = new Float32Array(3 * count);
  let varSum = 0;
  const amps = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < count; i++) {
      const md = lat[c][i];
      let a = 0;
      if (md) a = Math.sqrt(2 * phillips(md.kx, md.kz, wx, wz, V) * md.area);
      amps.push(a);
      varSum += a * a / 2;
    }
  }
  const hs = seaHs(V) * scale * (1 + storm * 0.6);
  const norm = varSum > 0 ? (hs / 4) / Math.sqrt(varSum) : 0;
  const slopeVar = [0, 0, 0];
  // swell: three long crests from a steady quarter, in cascade 0 (last slots)
  const swell = [[4, 1, 0.22], [3, 2, 0.16], [5, -1, 0.12]];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < count; i++) {
      const j = c * count + i;
      const md = lat[c][i];
      let kx = 0, kz = 0, a = 0, ph = 0;
      if (md) { kx = md.kx; kz = md.kz; a = amps[j] * norm; ph = md.phase; }
      if (c === 0 && i >= count - swell.length) {
        const [m, n, s] = swell[i - (count - swell.length)];
        kx = m * TAU / CASCADES[0].L; kz = n * TAU / CASCADES[0].L;
        a = s * (0.6 + storm * 1.4) * scale; ph = i * 1.7;
      }
      data[j * 4] = kx; data[j * 4 + 1] = kz; data[j * 4 + 2] = a; data[j * 4 + 3] = ph;
      const k = Math.hypot(kx, kz);
      omega[j] = Math.sqrt(GRAV * k);
      slopeVar[c] += a * a * k * k / 2;
    }
  }
  return { data, omega, count, hs, slopeVar };
}

// Phases at time t, wrapped to [0, 2pi) in double precision.
export function wavePhases(modes, t, out) {
  const { data, omega } = modes;
  const o = out || new Float32Array(data.length);
  for (let j = 0; j < omega.length; j++) {
    o[j * 4] = data[j * 4]; o[j * 4 + 1] = data[j * 4 + 1]; o[j * 4 + 2] = data[j * 4 + 2];
    let p = (data[j * 4 + 3] - omega[j] * t) % TAU;
    if (p < 0) p += TAU;
    o[j * 4 + 3] = p;
  }
  return o;
}

// --------------------------------------------------------------- terrain ----
// Height samples sit at texel centres: x = origin + (i + 0.5) * worldSize / n.
export function sampleHeight(t, x, z) {
  const n = t.n, ws = t.worldSize, o = -ws / 2;
  const fx = clamp((x - o) / ws * n - 0.5, 0, n - 1), fz = clamp((z - o) / ws * n - 0.5, 0, n - 1);
  const ix = Math.min(Math.floor(fx), n - 2), iz = Math.min(Math.floor(fz), n - 2);
  const ax = fx - ix, az = fz - iz, h = t.height;
  const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
  return (a + (b - a) * ax) * (1 - az) + (c + (d - c) * ax) * az;
}

// River points may come in world metres (the contract) or in grid cells.
function riverPoints(t, pts) {
  const m = pts.length >> 1;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pts.length; i++) { mn = Math.min(mn, pts[i]); mx = Math.max(mx, pts[i]); }
  const grid = mn >= -1 && mx <= t.n + 1 && t.worldSize > 2 * t.n;
  const out = [];
  for (let i = 0; i < m; i++) {
    let x = pts[i * 2], z = pts[i * 2 + 1];
    if (grid) { x = -t.worldSize / 2 + (x + 0.5) * t.worldSize / t.n; z = -t.worldSize / 2 + (z + 0.5) * t.worldSize / t.n; }
    out.push([x, z]);
  }
  return out;
}

function resample(P, vals, step) {
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L[L.length - 1];
  const cnt = Math.max(2, Math.round(total / step) + 1);
  const outP = [], outV = vals.map(() => []);
  let j = 0;
  for (let k = 0; k < cnt; k++) {
    const s = total * k / (cnt - 1);
    while (j < P.length - 2 && L[j + 1] < s) j++;
    const seg = Math.max(L[j + 1] - L[j], 1e-9), f = clamp((s - L[j]) / seg, 0, 1);
    outP.push([P[j][0] + (P[j + 1][0] - P[j][0]) * f, P[j][1] + (P[j + 1][1] - P[j][1]) * f]);
    vals.forEach((v, q) => outV[q].push(v[j] + (v[j + 1] - v[j]) * f));
  }
  return { P: outP, V: outV, total };
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function circumR(a, b, c) {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(cr) < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * Math.abs(cr));
}

// -> { vertices: Float32Array (SURF_STRIDE per vertex), indices: Uint32Array,
//      falls: [{ x, y, z, drop, width, dx, dz }], rivers: [{ rows: [...] }] }
// Row = { x, z, y, bed, s, width, flow, speed, foam, depth, kind, dx, dz, hl, hr }
export function buildRiverRibbons(t, o = {}) {
  const heightAt = o.heightAt || ((x, z) => sampleHeight(t, x, z));
  const texel = t.worldSize / t.n;
  const step = clamp(o.step ?? texel * 0.5, 1, 60);
  const widthScale = o.widthScale ?? 1;
  const bankOverlap = o.bankOverlap ?? 1.3;
  const minWidth = o.minWidth ?? 2;
  const fallMin = o.fallMin ?? 6;
  const fallSlope = o.fallSlope ?? 1.0;
  const seaLevel = o.oceanOn ? (t.seaLevel ?? 0) : null;
  const rivers = [];
  const all = t.rivers || [];
  // mouths, for the confluence test
  const mouths = [];
  for (const r of all) {
    if (!r || !r.pts || r.pts.length < 4) { rivers.push(null); continue; }
    let P = riverPoints(t, r.pts);
    const m = P.length;
    let W = r.width ? Array.from(r.width) : null;
    let F = r.flow ? Array.from(r.flow) : new Array(m).fill(1);
    if (W && W.length !== m) W = null;
    if (F.length !== m) F = new Array(m).fill(1);
    // orient downstream: flow grows toward the mouth, else the bed falls
    const hFirst = heightAt(P[0][0], P[0][1]), hLast = heightAt(P[m - 1][0], P[m - 1][1]);
    const rev = F[m - 1] < F[0] || (F[m - 1] === F[0] && hLast > hFirst);
    if (rev) { P.reverse(); F.reverse(); if (W) W.reverse(); }
    if (!W) W = F.map((f) => 3 * Math.sqrt(Math.max(f, 0)));
    // cumulative maxima: flow and width never shrink downstream
    for (let i = 1; i < m; i++) { F[i] = Math.max(F[i], F[i - 1]); W[i] = Math.max(W[i], W[i - 1]); }
    const rs = resample(P, [W, F], step);
    P = rs.P; W = rs.V[0].map((w) => Math.max(w * widthScale, minWidth)); F = rs.V[1];
    const n = P.length;
    for (let i = 1; i < n; i++) { F[i] = Math.max(F[i], F[i - 1]); W[i] = Math.max(W[i], W[i - 1]); }
    // equal flow, equal width: a run of one flow takes the widest width of the run
    for (let i = 0; i < n;) {
      let j = i;
      while (j + 1 < n && F[j + 1] === F[i]) j++;
      for (let k = i; k <= j; k++) W[k] = W[j];
      i = j + 1;
    }
    // smooth the centre line (D8 stair steps), ends fixed
    const relax = (idx) => {
      const a = P[idx - 1], b = P[idx], c = P[idx + 1];
      P[idx] = [0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1]];
    };
    for (let pass = 0; pass < (o.smoothPasses ?? 4); pass++) for (let i = 1; i < n - 1; i++) relax(i);
    // relax only the bends that are tighter than the half width
    for (let it = 0; it < 24; it++) {
      let bad = 0;
      for (let i = 1; i < n - 1; i++) {
        if (circumR(P[i - 1], P[i], P[i + 1]) < W[i] * 0.5 * bankOverlap * 1.05) { relax(i); bad++; }
      }
      if (!bad) break;
    }
    rivers.push({ P, W, F, total: rs.total });
    mouths.push({ x: P[n - 1][0], z: P[n - 1][1], idx: rivers.length - 1 });
  }

  const verts = [], idx = [], falls = [], outRivers = [];
  let base = 0;
  for (let ri = 0; ri < rivers.length; ri++) {
    const R = rivers[ri];
    if (!R) { outRivers.push(null); continue; }
    const { P, W, F } = R;
    const n = P.length;
    // tangents and normals
    const T = [], Nn = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      T.push([dx / l, dz / l]); Nn.push([-dz / l, dx / l]);
    }
    // bed (lowest of the centre and two inner points) and surface
    const bed = [], surf = [], depth = [];
    for (let i = 0; i < n; i++) {
      const hw = W[i] * 0.3;
      const [x, z] = P[i], [nx, nz] = Nn[i];
      const b = Math.min(heightAt(x, z), heightAt(x + nx * hw, z + nz * hw), heightAt(x - nx * hw, z - nz * hw));
      bed.push(b);
      depth.push(clamp(0.25 + 0.05 * W[i], 0.3, 3));
    }
    for (let i = 0; i < n; i++) {
      let s = bed[i] + depth[i];
      if (i > 0) s = Math.min(s, surf[i - 1]);
      surf.push(Math.max(s, bed[i] + 0.1));
    }
    // falls: a big drop over one step
    const fall = new Array(n).fill(false);
    for (let i = 1; i < n; i++) {
      const dist = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) || 1;
      const drop = surf[i - 1] - surf[i];
      if (drop > fallMin && drop / dist > fallSlope) fall[i] = true;
    }
    // gentle smoothing of the surface between falls, kept monotone and above the bed
    for (let pass = 0; pass < 2; pass++) {
      const s2 = surf.slice();
      for (let i = 1; i < n - 1; i++) if (!fall[i] && !fall[i + 1]) s2[i] = (surf[i - 1] + surf[i] * 2 + surf[i + 1]) / 4;
      for (let i = 0; i < n; i++) {
        let s = Math.min(s2[i], bed[i] + depth[i]);
        if (i > 0) s = Math.min(s, s2[i - 1]);
        s2[i] = Math.max(s, bed[i] + 0.05);
        surf[i] = s2[i];
      }
    }
    // offsets: the inner bank of a bend is held inside the radius of curvature
    const hl = [], hr = [];
    for (let i = 0; i < n; i++) {
      const hw = W[i] * 0.5 * bankOverlap;
      let l = hw, r = hw;
      if (i > 0 && i < n - 1) {
        const a = P[i - 1], b = P[i], c = P[i + 1];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        const Rc = circumR(a, b, c);
        const lim = 0.85 * Rc;
        if (cr > 0) l = Math.min(l, lim); else if (cr < 0) r = Math.min(r, lim);
      }
      hl.push(l); hr.push(r);
    }
    // local fold check: each bank must move forward along the river
    for (let it = 0; it < 12; it++) {
      let bad = 0;
      for (let i = 0; i < n - 1; i++) {
        const tm = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]];
        const len = Math.hypot(tm[0], tm[1]) || 1;
        for (const side of [1, -1]) {
          const H = side > 0 ? hl : hr;
          const ax = P[i][0] + Nn[i][0] * H[i] * side, az = P[i][1] + Nn[i][1] * H[i] * side;
          const bx = P[i + 1][0] + Nn[i + 1][0] * H[i + 1] * side, bz = P[i + 1][1] + Nn[i + 1][1] * H[i + 1] * side;
          if (((bx - ax) * tm[0] + (bz - az) * tm[1]) / len < 0.05 * len) { H[i] *= 0.7; H[i + 1] *= 0.7; bad++; }
        }
      }
      if (!bad) break;
    }
    // crossings: a bank that loops over itself in a hairpin, or the inner
    // banks of two legs of a tight meander that overlap. A segment hash
    // finds them; the offsets shrink near both ends until none cross.
    const bankPt = (H, side, i) => [P[i][0] + Nn[i][0] * H[i] * side, P[i][1] + Nn[i][1] * H[i] * side];
    let cellSz = 1;
    for (let i = 0; i < n; i++) cellSz = Math.max(cellSz, W[i] * bankOverlap);
    for (const side of [1, -1]) {
      const H = side > 0 ? hl : hr;
      for (let it = 0; it < 40; it++) {
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(bankPt(H, side, i));
        const grid = new Map();
        for (let i = 0; i < n - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const x0 = Math.floor(Math.min(a[0], b[0]) / cellSz), x1 = Math.floor(Math.max(a[0], b[0]) / cellSz);
          const z0 = Math.floor(Math.min(a[1], b[1]) / cellSz), z1 = Math.floor(Math.max(a[1], b[1]) / cellSz);
          for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
            const k = gx + ',' + gz;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(i);
          }
        }
        const hits = new Set();
        for (const list of grid.values()) {
          for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
            const i = Math.min(list[p], list[q]), j = Math.max(list[p], list[q]);
            if (j - i < 2) continue;
            if (segCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) hits.add(i * 1e6 + j);
          }
        }
        if (!hits.size) break;
        const shrink = new Uint8Array(n);
        for (const h of hits) {
          const i = Math.floor(h / 1e6), j = h % 1e6;
          if (j - i < 24) { for (let k = Math.max(i - 1, 0); k <= Math.min(j + 2, n - 1); k++) shrink[k] = 1; }
          else for (const c of [i, j]) for (let k = Math.max(c - 2, 0); k <= Math.min(c + 3, n - 1); k++) shrink[k] = 1;
        }
        for (let k = 0; k < n; k++) if (shrink[k]) H[k] *= 0.8;
      }
    }
    // confluence: does this mouth end inside another river?
    let joinFoam = all[ri] && all[ri].end === 'join';
    const mx = P[n - 1][0], mz = P[n - 1][1];
    for (let rj = 0; rj < rivers.length && !joinFoam; rj++) {
      if (rj === ri || !rivers[rj]) continue;
      const Q = rivers[rj];
      for (let k = 0; k < Q.P.length; k++) {
        if (Math.hypot(Q.P[k][0] - mx, Q.P[k][1] - mz) < Q.W[k] * 0.8 + step) { joinFoam = true; break; }
      }
    }
    // rows
    const rows = [];
    let s = 0;
    let fallRun = null;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
      const run = Math.max(Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]), 1e-3);
      const slope = Math.max((surf[a] - surf[b]) / run, 0);
      const hyd = depth[i];
      // Manning: v = R^(2/3) S^(1/2) / n, with a rough mountain bed (n = 0.06)
      let speed = clamp((1 / 0.06) * Math.pow(hyd, 2 / 3) * Math.sqrt(slope), 0.2, 5);
      let foam = smooth(0.05, 0.25, slope);
      for (let k = 1; k <= 3; k++) if (i - k >= 0 && fall[i - k + 1]) foam = Math.max(foam, 1 - (k - 1) / 3);
      if (joinFoam && i >= n - 4) foam = Math.max(foam, 0.6);
      const row = { x: P[i][0], z: P[i][1], y: surf[i], bed: bed[i], s, width: W[i], flow: F[i], speed, foam, depth: hyd, kind: 0, dx: T[i][0], dz: T[i][1], hl: hl[i], hr: hr[i], nx: Nn[i][0], nz: Nn[i][1] };
      if (fall[i]) {
        // the sheet: its own strip (the lip row is duplicated), uv.y counts
        // metres along the fall so that the streaks fall
        let last = rows[rows.length - 1];
        if (last.kind !== 1) { last = { ...last, kind: 1, speed: 9 }; rows.push(last); }
        const drop = last.y - row.y;
        rows.push({ ...row, kind: 1, s: last.s + Math.hypot(drop, Math.hypot(row.x - last.x, row.z - last.z)), speed: Math.min(Math.sqrt(2 * GRAV * Math.max(drop, 0)), 14), foam: 1 });
        if (!(i + 1 < n && fall[i + 1])) rows.push({ ...row, foam: 1 });
        if (fallRun && fallRun.end === i - 1) { fallRun.drop += drop; fallRun.end = i; fallRun.x = row.x; fallRun.z = row.z; fallRun.y = row.y; }
        else { fallRun = { x: row.x, y: row.y, z: row.z, drop, width: row.width, dx: row.dx, dz: row.dz, end: i }; falls.push(fallRun); }
        continue;
      }
      rows.push(row);
    }
    for (const f of falls) delete f.end;
    // the mouth: stop one row after the surface goes under the sea
    if (seaLevel != null) {
      const k = rows.findIndex((r) => r.y < seaLevel - 0.5);
      if (k > 0) rows.length = Math.min(rows.length, k + 1);
    }
    // vertices: two per row
    for (const r of rows) {
      for (const side of [1, -1]) {
        const H = side > 0 ? r.hl : r.hr;
        const across = side * H / Math.max(r.width * 0.5, 1e-3);
        verts.push(r.x + r.nx * H * side, r.y, r.z + r.nz * H * side, across, r.s, r.dx, r.dz, r.speed, r.width, r.foam, r.depth, r.kind);
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    base += rows.length * 2;
    outRivers.push({ rows, joinFoam });
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx), falls, rivers: outRivers, stride: SURF_STRIDE };
}

// ------------------------------------------------------------------ lakes ----
// Each lake: flood fill of the cells below its level from the cell nearest
// to (x, z); a grid mesh over the filled cells plus a one-cell rim (the rim
// goes under the shore). Lakes at sea level are left to the ocean.
export function buildLakeMeshes(t, o = {}) {
  const n = t.n, ws = t.worldSize, org = -ws / 2, cs = ws / n, H = t.height;
  const maxCells = o.maxCells ?? 250000;
  const maxVerts = o.maxVerts ?? 600000;
  const verts = [], idx = [], lakes = [];
  let base = 0, totalVerts = 0, skipped = 0;
  const inside = (t.lakes && t.lakes.length) ? new Uint8Array(n * n) : null;
  for (const lk of t.lakes || []) {
    if (!lk || !(lk.level > -1e9)) continue;
    if (o.oceanOn && lk.level <= (t.seaLevel ?? -Infinity) + 0.2) continue;
    let ci = clamp(Math.round((lk.x - org) / cs - 0.5), 0, n - 1), cj = clamp(Math.round((lk.z - org) / cs - 0.5), 0, n - 1);
    // the seed may sit on the rim: look for the lowest cell nearby
    if (H[cj * n + ci] >= lk.level) {
      let best = -1, bh = Infinity;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        if (H[j * n + i] < bh) { bh = H[j * n + i]; best = j * n + i; }
      }
      if (bh >= lk.level) continue;
      ci = best % n; cj = (best / n) | 0;
    }
    const q = [cj * n + ci];
    const filled = [q[0]];
    inside[q[0]] = 1;
    let i0 = ci, i1 = ci, j0 = cj, j1 = cj, cells = 0;
    while (q.length && cells < maxCells) {
      const c = q.pop(); cells++;
      const i = c % n, j = (c / n) | 0;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [a, b] of nb) {
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const k = b * n + a;
        if (!inside[k] && H[k] < lk.level) { inside[k] = 1; q.push(k); filled.push(k); }
      }
    }
    // a fill that hits the cap spilled out of its basin: the level is wrong
    if (q.length) { for (const k of filled) inside[k] = 0; skipped++; continue; }
    // big lakes get a coarser grid (st cells per quad)
    const st = Math.max(1, Math.ceil(Math.sqrt(cells / (o.cellsPerLake ?? 40000))));
    i0 = Math.max(i0 - st, 0); j0 = Math.max(j0 - st, 0); i1 = Math.min(i1 + st, n - 1); j1 = Math.min(j1 + st, n - 1);
    const W = Math.floor((i1 - i0) / st) + 1, Hh = Math.floor((j1 - j0) / st) + 1;
    const near = (i, j) => {
      for (let dj = -st; dj <= st; dj++) for (let di = -st; di <= st; di++) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < n && b < n && inside[b * n + a]) return true;
      }
      return false;
    };
    if (totalVerts + W * Hh > maxVerts) { for (const k of filled) inside[k] = 0; skipped++; continue; }
    const vid = new Int32Array(W * Hh).fill(-1);
    let count = 0;
    for (let gj = 0; gj < Hh; gj++) for (let gi = 0; gi < W; gi++) {
      const i = i0 + gi * st, j = j0 + gj * st;
      if (!near(i, j)) continue;
      const x = org + (i + 0.5) * cs, z = org + (j + 0.5) * cs;
      vid[gj * W + gi] = count++;
      verts.push(x, lk.level, z, inside[j * n + i] ? 1 : 0, 0, 1, 0, 0, 0, 0, lk.level - H[j * n + i], 2);
    }
    totalVerts += count;
    let tris = 0;
    for (let j = 0; j < Hh - 1; j++) for (let i = 0; i < W - 1; i++) {
      const a = vid[j * W + i], b = vid[j * W + i + 1], c = vid[(j + 1) * W + i], d = vid[(j + 1) * W + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(base + a, base + c, base + b, base + b, base + c, base + d);
      tris += 2;
    }
    base += count;
    for (const k of filled) inside[k] = 0;
    lakes.push({ level: lk.level, cells, step: st, verts: count, tris, bbox: [org + i0 * cs, org + j0 * cs, org + (i1 + 1) * cs, org + (j1 + 1) * cs] });
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx), lakes, skipped, stride: SURF_STRIDE };
}

// ------------------------------------------------------------- ocean grid ----
// Rings of geometric radius around the camera; vertex = (radius m, angle).
export function buildOceanGrid(rMin = 0.6, rMax = 60000, nr = 200, na = 160) {
  const v = new Float32Array((nr * na + 1) * 2);
  v[0] = 0; v[1] = 0;
  for (let j = 0; j < nr; j++) {
    const r = rMin * Math.pow(rMax / rMin, j / (nr - 1));
    for (let i = 0; i < na; i++) {
      const k = 1 + j * na + i;
      v[k * 2] = r; v[k * 2 + 1] = (i + (j & 1) * 0.5) / na * TAU;
    }
  }
  const idx = [];
  for (let i = 0; i < na; i++) idx.push(0, 1 + ((i + 1) % na), 1 + i);
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < na; i++) {
      const a = 1 + j * na + i, b = 1 + j * na + ((i + 1) % na);
      const c = 1 + (j + 1) * na + i, d = 1 + (j + 1) * na + ((i + 1) % na);
      idx.push(a, b, c, b, d, c);
    }
  }
  return { vertices: v, indices: new Uint32Array(idx) };
}

// ------------------------------------------------------------------- GPU ----
const U_FLOATS = 52; // 13 vec4

export async function createWater(gpu) {
  const { device, queue } = gpu;
  const hdrFormat = gpu.hdrFormat || 'rgba16float';
  const depthFormat = gpu.depthFormat || 'depth32float';
  let quality = gpu.quality ?? 1;
  const code = await gpu.loadWGSL(new URL('../shaders/water.wgsl', import.meta.url).href);
  const module = device.createShaderModule({ code, label: 'water.wgsl' });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new Error('water.wgsl: ' + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  }
  let detailHeight = null;
  try { ({ detailHeight } = await import('../../../lib/dla-terrain.js')); } catch (e) { detailHeight = null; }

  const COUNT = 80;
  const lattice = waveLattice(COUNT, 7);
  const usageTex = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  const waveA = device.createTexture({ label: 'water waveA', size: [WAVE_N, WAVE_N, 3], format: 'rgba16float', usage: usageTex });
  const waveB = device.createTexture({ label: 'water waveB', size: [WAVE_N, WAVE_N, 3], format: 'rgba16float', usage: usageTex });
  const waveAView = waveA.createView({ dimension: '2d-array' });
  const waveBView = waveB.createView({ dimension: '2d-array' });
  const ubuf = device.createBuffer({ label: 'water uniforms', size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const modeBuf = device.createBuffer({ label: 'water modes', size: 3 * COUNT * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const repeat = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' });
  const U = new Float32Array(U_FLOATS);
  const phases = new Float32Array(3 * COUNT * 4);

  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const layout1 = device.createBindGroupLayout({
    label: 'water group 1',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: VF, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  // group 2: CORE's shadow sample layout; a host with no shadows gets a
  // dummy group (no cascades: sunShadow returns 1)
  let shadowLayout = gpu.shadowSampleLayout, ownShadow = null;
  if (!shadowLayout) {
    shadowLayout = device.createBindGroupLayout({ label: 'water shadow stub', entries: [
      { binding: 0, visibility: VF, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 1, visibility: VF, sampler: { type: 'comparison' } },
      { binding: 2, visibility: VF, buffer: { type: 'uniform' } },
    ] });
    const tex = device.createTexture({ size: [1, 1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    const buf = device.createBuffer({ size: 4 * 16 * 4 + 48, usage: GPUBufferUsage.UNIFORM });
    ownShadow = device.createBindGroup({ layout: shadowLayout, entries: [
      { binding: 0, resource: tex.createView({ dimension: '2d-array' }) },
      { binding: 1, resource: device.createSampler({ compare: 'greater-equal' }) },
      { binding: 2, resource: { buffer: buf } },
    ] });
  }
  const playout = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, layout1, shadowLayout] });
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  // write = false: the pass attaches the depth read-only and samples it.
  // write = true: ctx.depthView is a copy (ctx.depthIsCopy), so the water
  // surface goes into the attached depth for the volumetric pass after it.
  const mk = (label, vs, fs, buffers, write = false) => device.createRenderPipelineAsync({
    label, layout: playout,
    vertex: { module, entryPoint: vs, buffers },
    fragment: { module, entryPoint: fs, targets: [{ format: hdrFormat, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: depthFormat, depthWriteEnabled: write, depthCompare: 'greater' },
  });
  const surfBuffers = [{
    arrayStride: SURF_STRIDE * 4,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x2' },
      { shaderLocation: 2, offset: 20, format: 'float32x2' },
      { shaderLocation: 3, offset: 28, format: 'float32x4' },
      { shaderLocation: 4, offset: 44, format: 'float32' },
    ],
  }];
  const oceanBuffers = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }];
  const [oceanPipe, surfPipe, oceanPipeW, surfPipeW, mistPipe, wavePipe] = await Promise.all([
    mk('water ocean', 'vsOcean', 'fsOcean', oceanBuffers),
    mk('water surface', 'vsSurface', 'fsSurface', surfBuffers),
    mk('water ocean (depth write)', 'vsOcean', 'fsOcean', oceanBuffers, true),
    mk('water surface (depth write)', 'vsSurface', 'fsSurface', surfBuffers, true),
    mk('water mist', 'vsMist', 'fsMist', [{ arrayStride: 28, stepMode: 'instance', attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x4' }] }]),
    device.createComputePipelineAsync({ label: 'water waves', layout: 'auto', compute: { module, entryPoint: 'csWaves' } }),
  ]);
  const waveGroup = device.createBindGroup({
    layout: wavePipe.getBindGroupLayout(3),
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      { binding: 1, resource: { buffer: modeBuf } },
      { binding: 2, resource: waveAView },
      { binding: 3, resource: waveBView },
    ],
  });

  let terrain = null;
  let builtKey = null;
  let ocean = null, surf = null, mist = null;
  let oceanOn = false;
  let group1 = null, groupKey = [null, null];
  let wind = [6, 2], windInit = false;
  let modes = null, modesAge = 1e9;
  const stats = { rivers: 0, riverVerts: 0, lakes: 0, lakeTris: 0, falls: 0, ocean: false };

  const destroyAll = (o) => { if (o) for (const b of Object.values(o)) if (b && b.destroy) b.destroy(); };
  const upload = (data, usage) => {
    const size = Math.max(16, Math.ceil(data.byteLength / 4) * 4);
    const b = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
    queue.writeBuffer(b, 0, data);
    return b;
  };

  function setTerrain(tg) {
    const t = tg && (tg.cpu || tg);
    if (!t || !t.height) return;
    terrain = { tg, t };
    const sea = tg.seaLevel ?? t.seaLevel ?? 0;
    let mn = Infinity;
    for (let i = 0; i < t.height.length; i += 7) mn = Math.min(mn, t.height[i]);
    oceanOn = mn < sea;
    stats.ocean = oceanOn;
    // ocean grid out to the horizon (beyond the world for island maps)
    destroyAll(ocean); ocean = null;
    if (oceanOn) {
      const og = buildOceanGrid(0.6, Math.max(30000, t.worldSize * 3), Math.round(150 + 70 * quality), Math.round(112 + 64 * quality));
      ocean = { vb: upload(og.vertices, GPUBufferUsage.VERTEX), ib: upload(og.indices, GPUBufferUsage.INDEX), count: og.indices.length };
    }
    // rivers and lakes: rebuild only when the LIB arrays change
    const key = [t.rivers, t.lakes, t.height, oceanOn];
    if (builtKey && key.every((v, i) => v === builtKey[i])) return;
    builtKey = key;
    let heightAt = null;
    if (detailHeight) {
      heightAt = (x, z) => {
        const h = sampleHeight(t, x, z);
        try { const d = detailHeight(x, z, t); return Number.isFinite(d) ? h + d : h; } catch (e) { return h; }
      };
    }
    const rb = buildRiverRibbons(t, { heightAt: heightAt || undefined, oceanOn });
    const lb = buildLakeMeshes(t, { oceanOn });
    const nv = rb.vertices.length / SURF_STRIDE;
    const verts = new Float32Array(rb.vertices.length + lb.vertices.length);
    verts.set(rb.vertices, 0); verts.set(lb.vertices, rb.vertices.length);
    const inds = new Uint32Array(rb.indices.length + lb.indices.length);
    inds.set(rb.indices, 0);
    for (let i = 0; i < lb.indices.length; i++) inds[rb.indices.length + i] = lb.indices[i] + nv;
    destroyAll(surf); surf = null;
    if (inds.length) surf = { vb: upload(verts, GPUBufferUsage.VERTEX), ib: upload(inds, GPUBufferUsage.INDEX), count: inds.length };
    destroyAll(mist); mist = null;
    if (rb.falls.length) {
      // mist for the biggest falls only
      const fl = rb.falls.slice().sort((a, b) => b.drop * b.width - a.drop * a.width).slice(0, 48);
      const fd = new Float32Array(fl.length * 7);
      fl.forEach((f, i) => fd.set([f.x, f.y, f.z, f.width, f.drop, f.dx, f.dz], i * 7));
      mist = { vb: upload(fd, GPUBufferUsage.VERTEX), count: fl.length };
    }
    stats.rivers = rb.rivers.filter(Boolean).length; stats.riverVerts = nv;
    stats.lakes = lb.lakes.length; stats.lakeTris = lb.indices.length / 3; stats.falls = rb.falls.length;
    api.last = { rivers: rb, lakes: lb };
  }

  function writeUniforms(frame) {
    const g = frame.globals;
    const time = frame.time ?? g[83];
    const dt = Math.min(Math.max(frame.dt ?? 0.016, 0), 0.25);
    const wx = g[104], wz = g[105];
    if (!windInit) { wind = [wx, wz]; windInit = true; }
    const k = 1 - Math.exp(-dt / 6);
    wind[0] += (wx - wind[0]) * k; wind[1] += (wz - wind[1]) * k;
    const storm = clamp(g[114] || 0, 0, 1);
    modesAge += dt;
    if (!modes || modesAge > 0.25) {
      modes = waveModes({ wind, storm, count: COUNT, lattice });
      modesAge = 0;
    }
    wavePhases(modes, time, phases);
    queue.writeBuffer(modeBuf, 0, phases);
    const cam = [g[80], g[81], g[82]];
    const sea = terrain ? (terrain.tg.seaLevel ?? terrain.t.seaLevel ?? 0) : 0;
    const snapS = 2;
    const screenH = g[125] || 720;
    const p11 = g[48 + 5] || 1;
    const ws = Math.hypot(wind[0], wind[1]);
    U.set([time % 3600, sea, oceanOn ? 1 : 0, quality], 0);
    U.set([CASCADES[0].L, CASCADES[1].L, CASCADES[2].L, 1.0 + storm * 0.35], 4);
    U.set([Math.floor(cam[0] / snapS) * snapS, Math.floor(cam[2] / snapS) * snapS, 30000, 2 / (p11 * screenH)], 8);
    U.set([modes.slopeVar[0], modes.slopeVar[1], modes.slopeVar[2], modes.hs], 12);
    U.set([0.32, 0.075, 0.048, clamp((ws - 5) * 0.08 + storm * 0.6, 0, 1.4)], 16);    // ocean absorption, whitecaps
    U.set([0.03, 0.085, 0.125, 1.0], 20);                                                     // ocean scatter, shore foam
    U.set([0.42, 0.26, 0.21, 0.5], 24);                                                       // river absorption
    U.set([0.05, 0.065, 0.035, 1.6], 28);                                                      // river scatter, flow period
    U.set([0.36, 0.11, 0.075, 1.0], 32);                                                      // lake absorption, ripple scale
    U.set([0.028, 0.06, 0.06, 0], 36);                                                        // lake scatter
    U.set([ws > 1e-3 ? wind[0] / ws : 1, ws > 1e-3 ? wind[1] / ws : 0, ws, storm], 40);
    const night = 1 - smooth(-0.15, 0.05, g[85]);
    U.set([quality > 0.25 ? 1 : 0, quality > 0.15 ? 1 : 0, clamp(g[109] || 0, 0, 1), night], 44);
    U.set([COUNT, WAVE_N, Math.round(24 + 40 * quality), 0], 48);
    queue.writeBuffer(ubuf, 0, U);
  }

  function bindFor(ctx) {
    if (!group1 || groupKey[0] !== ctx.sceneColorView || groupKey[1] !== ctx.depthView) {
      group1 = device.createBindGroup({
        layout: layout1,
        entries: [
          { binding: 0, resource: { buffer: ubuf } },
          { binding: 1, resource: ctx.sceneColorView },
          { binding: 2, resource: ctx.depthView },
          { binding: 3, resource: waveAView },
          { binding: 4, resource: waveBView },
          { binding: 5, resource: repeat },
        ],
      });
      groupKey = [ctx.sceneColorView, ctx.depthView];
    }
    return group1;
  }

  const api = {
    stats,
    last: null,
    setTerrain,
    update(frame) { if (frame.quality != null) quality = frame.quality; writeUniforms(frame); },
    compute(encoder) {
      const p = encoder.beginComputePass({ label: 'water waves' });
      p.setPipeline(wavePipe);
      p.setBindGroup(3, waveGroup);
      p.dispatchWorkgroups(WAVE_N / 8, WAVE_N / 8, 3);
      p.end();
    },
    drawWater(pass, frame, ctx) {
      if (!terrain || !ctx || !ctx.sceneColorView || !ctx.depthView) return;
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(1, bindFor(ctx));
      if (ownShadow) pass.setBindGroup(2, ownShadow);
      // CORE gives the depth copy (sceneDepth) and attaches the live depth:
      // then the water writes its surface depth for the volumetric pass
      const w = ctx.depthIsCopy ?? (ctx.sceneDepthView != null && ctx.depthView === ctx.sceneDepthView);
      if (ocean) {
        pass.setPipeline(w ? oceanPipeW : oceanPipe);
        pass.setVertexBuffer(0, ocean.vb);
        pass.setIndexBuffer(ocean.ib, 'uint32');
        pass.drawIndexed(ocean.count);
      }
      if (surf) {
        pass.setPipeline(w ? surfPipeW : surfPipe);
        pass.setVertexBuffer(0, surf.vb);
        pass.setIndexBuffer(surf.ib, 'uint32');
        pass.drawIndexed(surf.count);
      }
      if (mist) {
        pass.setPipeline(mistPipe);
        pass.setVertexBuffer(0, mist.vb);
        pass.draw(6 * U[50], mist.count);
      }
    },
    resize() { group1 = null; groupKey = [null, null]; },
    dispose() {
      destroyAll(ocean); destroyAll(surf); destroyAll(mist);
      waveA.destroy(); waveB.destroy(); ubuf.destroy(); modeBuf.destroy();
      ocean = surf = mist = null; terrain = null; group1 = null;
    },
  };
  return api;
}

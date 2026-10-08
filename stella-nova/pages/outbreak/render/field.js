// ============================================================================
//  OUTBREAK  ·  render/field.js — the land mask and the prevalence field
// ----------------------------------------------------------------------------
//  Two DataTextures in the equirectangular layout of THREE.SphereGeometry:
//  u = (lon + 180) / 360, v = (lat + 90) / 180, row 0 = the south edge.
//    landMask  2048 x 1024 RGBA8. R = G = B = 255 on land, else 0.
//    texture   1024 x 512 RGBA8. R = prevalence glow 0..1 (land only),
//              G = deaths share 0..1 (land only), B = the infection front
//              now, A = the front at the update before (render/infect.js
//              blends A -> B between two updates with uFieldMix).
//
//  The land mask is a scanline fill of the Natural Earth land rings in
//  ../../map-projections/data/world.json (`land`, lon and lat in 1/100
//  degree). Each ring fills on its own (even-odd inside the ring, OR
//  across rings), so two rings that overlap do not cut a hole.
//
//  The field is a point source with a falloff for each node, not a fill of
//  the full country. Each land texel keeps the K nearest nodes inside the
//  cutoff, with the weight w = exp(-(d / sigma_j)^4): a flat top and a
//  short edge, so each city reads as a sharp patch and not a soft blur.
//  sigma_j grows with the fourth root of the node population. The cutoff
//  is CUT sigma. The texel value is
//  sum(w g_j) / max(1, sum w), so land near a node shows its full value and
//  land far from all nodes stays dark. g_j is glowFor(I/N) for R and
//  deadFor(D/N) for G, both on the node.
//
//  The front (B): each infected node has a reach R_j in its own sigma
//  units. R_j crawls toward reachTarget(g_j) at REACH_RATE sigma per wall
//  second and never shrinks in a run, so infected land stays marked
//  after the epidemic passes. A texel takes f = max_j (R_j - r_j) over its
//  K nodes (r_j = distance / sigma_j), and B = 0.5 + f / (2 FRONT_SPAN),
//  clamped: B = 0.5 on the front, 1 deep inside, 0 far out. A node with
//  no infection adds nothing, so healthy land keeps B = 0. reset() clears
//  the reach for a new run.
//
//  Until setWorld() gets the land rings, both textures stay black (the
//  styles then show the globe without land). setWorld() fills the same
//  texture objects, so a style never has to swap a texture.
//
//  No DOM. THREE comes from the caller, so node can test the helpers.
//
//  grep -n targets: "export function rasterLand", "export function landFraction",
//                   "export function downMask", "export function buildWeights",
//                   "export function glowFor", "export function deadFor",
//                   "export function fillField", "export function reachTarget",
//                   "export function reachStep", "export function createField"
// ============================================================================

export const MASK_W = 2048, MASK_H = 1024, FIELD_W = 1024, FIELD_H = 512;
export const CUT = 2;                    // cutoff in sigma
export const K = 4;                      // nodes per texel
export const SIGMA_KM = 450;             // falloff of a node of SIGMA_POP people
export const SIGMA_POP = 5e6;
export const EARTH_KM = 6371;
export const GLOW_LO = 1e-7, GLOW_HI = 0.05;   // I/N at glow 0 and 1 (log scale)
export const DEAD_HI = 0.05;                   // D/N at dead 1 (square-root scale)
export const REACH_SEED = 0.35;   // sigma, the reach of a node at its first infection
export const REACH_MAX = 1.6;     // sigma, the largest reach (cutoff CUT = 2)
export const REACH_G = 0.8;       // glow at which the reach is full
export const REACH_RATE = 0.45;   // sigma per wall second: the crawl of the front
export const FRONT_SPAN = 0.8;    // sigma from B = 0.5 to B = 1

export const SOURCES = [
  { ref: 'Natural Earth 1:50m land', url: 'https://www.naturalearthdata.com/', note: 'land rings, public domain, via map-projections/data/world.json' },
];

const DEG = Math.PI / 180;

// ── pure helpers (tested in tests/render.test.mjs) ──────────────────────
// Land rings ([lon100, lat100, ...] flat arrays) -> Uint8Array(W*H), 1 on land.
export function rasterLand(rings, W = MASK_W, H = MASK_H) {
  const m = new Uint8Array(W * H);
  const xs = [];
  for (const ring of rings || []) {
    const n = ring.length >> 1;
    if (n < 3) continue;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const la = ring[i * 2 + 1] / 100; if (la < lo) lo = la; if (la > hi) hi = la; }
    const j0 = Math.max(0, Math.floor((lo + 90) / 180 * H - 0.5)), j1 = Math.min(H - 1, Math.ceil((hi + 90) / 180 * H - 0.5));
    for (let j = j0; j <= j1; j++) {
      const lat = -90 + (j + 0.5) * 180 / H;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        const la0 = ring[i * 2 + 1] / 100, la1 = ring[k * 2 + 1] / 100;
        if ((la0 <= lat) === (la1 <= lat)) continue;
        const lo0 = ring[i * 2] / 100, lo1 = ring[k * 2] / 100;
        xs.push(lo0 + (lat - la0) / (la1 - la0) * (lo1 - lo0));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        // texel centres lon = -180 + (i + 0.5) * 360 / W inside [xs[q], xs[q+1]]
        const i0 = Math.max(0, Math.ceil((xs[q] + 180) / 360 * W - 0.5));
        const i1 = Math.min(W - 1, Math.floor((xs[q + 1] + 180) / 360 * W - 0.5));
        for (let i = i0; i <= i1; i++) m[j * W + i] = 1;
      }
    }
  }
  return m;
}

// Area-weighted land fraction of a mask (Earth: about 0.29).
export function landFraction(m, W = MASK_W, H = MASK_H) {
  let a = 0, s = 0;
  for (let j = 0; j < H; j++) {
    const c = Math.cos((-90 + (j + 0.5) * 180 / H) * DEG);
    let row = 0;
    for (let i = 0; i < W; i++) row += m[j * W + i];
    a += c * row; s += c * W;
  }
  return a / s;
}

// Mask W x H -> mask (W/f) x (H/f): a texel is land when any source texel is.
export function downMask(m, W, H, f = 2) {
  const w = W / f, h = H / f, o = new Uint8Array(w * h);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (m[j * W + i]) o[((j / f) | 0) * w + ((i / f) | 0)] = 1;
  return o;
}

export function sigmaKm(pop) {
  return SIGMA_KM * Math.min(2, Math.max(0.6, Math.pow(Math.max(1, pop) / SIGMA_POP, 0.25)));
}

// Node-to-texel weights for the land texels of a w x h mask.
//   nodes: [{ lat, lon, pop }]
//   -> { texel: Int32Array(T), node: Int32Array(T*K) (-1 = none), w: Float32Array(T*K),
//        r: Float32Array(T*K) (distance in the node's sigma), T }
export function buildWeights(nodes, mask, w = FIELD_W, h = FIELD_H, k = K) {
  const N = nodes.length, nx = new Float64Array(N), ny = new Float64Array(N), nz = new Float64Array(N), sg = new Float64Array(N), nl = new Float64Array(N);
  let sgMax = 0;
  for (let i = 0; i < N; i++) {
    const a = nodes[i].lat * DEG, b = nodes[i].lon * DEG, c = Math.cos(a);
    nx[i] = c * Math.cos(b); ny[i] = Math.sin(a); nz[i] = -c * Math.sin(b);
    nl[i] = a;
    sg[i] = sigmaKm(nodes[i].pop) / EARTH_KM;
    if (sg[i] > sgMax) sgMax = sg[i];
  }
  const cosCut = Math.cos(CUT * sgMax);
  const latCut = CUT * sgMax;   // a node further in latitude than this is out of range
  const tex = [], nd = [], wt = [];
  const bi = new Int32Array(k), bw = new Float64Array(k), br = new Float64Array(k), rr = [];
  for (let j = 0; j < h; j++) {
    const a = (-90 + (j + 0.5) * 180 / h) * DEG, ca = Math.cos(a), y = Math.sin(a);
    for (let i = 0; i < w; i++) {
      if (!mask[j * w + i]) continue;
      const b = (-180 + (i + 0.5) * 360 / w) * DEG, x = ca * Math.cos(b), z = -ca * Math.sin(b);
      bi.fill(-1); bw.fill(0); br.fill(0);
      for (let n = 0; n < N; n++) {
        if (Math.abs(a - nl[n]) > latCut) continue;
        const d = x * nx[n] + y * ny[n] + z * nz[n];
        if (d < cosCut) continue;
        const ang = Math.acos(Math.min(1, d)), r = ang / sg[n];
        if (r > CUT) continue;
        const wv = Math.exp(-(r * r) * (r * r));
        if (wv <= bw[k - 1]) continue;
        let q = k - 1;
        while (q > 0 && bw[q - 1] < wv) { bw[q] = bw[q - 1]; bi[q] = bi[q - 1]; br[q] = br[q - 1]; q--; }
        bw[q] = wv; bi[q] = n; br[q] = r;
      }
      if (bi[0] < 0) continue;
      tex.push(j * w + i);
      for (let q = 0; q < k; q++) { nd.push(bi[q]); wt.push(bw[q]); rr.push(br[q]); }
    }
  }
  return { texel: Int32Array.from(tex), node: Int32Array.from(nd), w: Float32Array.from(wt), r: Float32Array.from(rr), T: tex.length, k };
}

// I/N -> glow 0..1 on a log scale (GLOW_LO .. GLOW_HI), so a few cases show.
export function glowFor(p) {
  if (!(p > GLOW_LO)) return 0;
  return Math.min(1, Math.log(p / GLOW_LO) / Math.log(GLOW_HI / GLOW_LO));
}

// D/N -> 0..1 on a square-root scale, 1 at DEAD_HI.
export function deadFor(s) {
  if (!(s > 0)) return 0;
  return Math.min(1, Math.sqrt(s / DEAD_HI));
}

// The reach a node heads for: 0 before its first infection, then from
// REACH_SEED up to REACH_MAX as its glow rises to REACH_G.
export function reachTarget(g, infected) {
  if (!infected) return 0;
  return REACH_SEED + (REACH_MAX - REACH_SEED) * Math.min(1, Math.max(0, g) / REACH_G);
}
// One crawl step of a shown reach toward its target (never back).
export function reachStep(cur, target, dt, rate = REACH_RATE) {
  if (!(target > cur)) return cur;
  return Math.min(target, cur + rate * Math.max(0, dt));
}
// Front value of a texel distance f (sigma units, R - r) -> 0..1.
export function frontByte(f) { return Math.round(255 * Math.min(1, Math.max(0, 0.5 + f / (2 * FRONT_SPAN)))); }

// Per node g (R), d (G) and reach (B; the old B goes to A) -> RGBA8 data
// of the field. Ocean texels stay 0. reach null leaves B and A alone.
export function fillField(data, W, g, d, wts, reach = null) {
  const { texel, node, w, T, k } = wts, rr = wts.r;
  for (let t = 0; t < T; t++) {
    let sw = 0, sg = 0, sd = 0, fm = -Infinity;
    for (let q = 0; q < k; q++) {
      const n = node[t * k + q];
      if (n < 0) break;
      const wv = w[t * k + q];
      sw += wv; sg += wv * (g ? g[n] : 0); sd += wv * (d ? d[n] : 0);
      if (reach && rr && reach[n] > 0) { const fv = reach[n] - rr[t * k + q]; if (fv > fm) fm = fv; }
    }
    const norm = sw > 1 ? 1 / sw : 1, o = texel[t] * 4;
    data[o] = Math.round(255 * Math.min(1, sg * norm));
    data[o + 1] = Math.round(255 * Math.min(1, sd * norm));
    if (reach) { data[o + 3] = data[o + 2]; data[o + 2] = fm === -Infinity ? 0 : frontByte(fm); }
  }
  return data;
}

// ── the field ────────────────────────────────────────────────────────────
// createField(D, THREE, worldJson?) -> { texture, landMask, setWorld(json),
//   update(prev, dead?, first?, dt?), reset(), reach, ready, dispose() }
//   prev: per node I/N. dead: optional per node D/N. first: optional per
//   node day of the first infection (sim.firstDay, -1 = none); dt: wall
//   seconds since the update before (the crawl of the front).
export function createField(D, THREE, worldJson = null) {
  const nodes = D && D.nodes ? D.nodes : [];
  const N = nodes.length;
  const mData = new Uint8Array(MASK_W * MASK_H * 4), fData = new Uint8Array(FIELD_W * FIELD_H * 4);
  for (let i = 3; i < mData.length; i += 4) mData[i] = 255;
  const mk = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  const landMask = mk(mData, MASK_W, MASK_H), texture = mk(fData, FIELD_W, FIELD_H);
  const g = new Float32Array(N), d = new Float32Array(N);
  const reach = new Float32Array(N), goal = new Float32Array(N);
  let wts = null, disposed = false;

  const field = {
    texture, landMask, ready: false,
    setWorld(json) {
      if (disposed || !json || !json.land) return;
      const m = rasterLand(json.land, MASK_W, MASK_H);
      for (let i = 0; i < m.length; i++) { const v = m[i] ? 255 : 0; mData[i * 4] = v; mData[i * 4 + 1] = v; mData[i * 4 + 2] = v; }
      landMask.needsUpdate = true;
      wts = buildWeights(nodes, downMask(m, MASK_W, MASK_H, MASK_W / FIELD_W), FIELD_W, FIELD_H);
      field.ready = true;
    },
    reach,
    update(prev, dead, first, dt = 0) {
      if (disposed || !wts) return;
      for (let i = 0; i < N; i++) {
        g[i] = glowFor(prev ? prev[i] : 0); d[i] = deadFor(dead ? dead[i] : 0);
        const tg = reachTarget(g[i], (first ? first[i] >= 0 : g[i] > 0));
        if (tg > goal[i]) goal[i] = tg;
        reach[i] = reachStep(reach[i], goal[i], dt);
      }
      fillField(fData, FIELD_W, g, d, wts, reach);
      texture.needsUpdate = true;
    },
    reset() { reach.fill(0); goal.fill(0); for (let i = 2; i < fData.length; i += 4) { fData[i] = 0; fData[i + 1] = 0; } texture.needsUpdate = true; },
    dispose() {
      if (disposed) return;
      disposed = true;
      landMask.dispose(); texture.dispose();
    },
  };
  if (worldJson) field.setWorld(worldJson);
  return field;
}

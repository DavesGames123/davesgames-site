// ============================================================================
//  DLA TERRAIN  ·  gpu/stub-terrain.js — stand-in for lib/dla-terrain.js (no DOM)
// ----------------------------------------------------------------------------
//  main.js and ui.js use this only while LIB has not committed
//  lib/dla-terrain.js (or when it fails to load). The exports have the
//  names and shapes of the LIB API in CONTRACT.md, so the page code is the
//  same for both. The terrain is ridged fractal noise with a D8 flow
//  routing, a river mask and simple climate bands: enough for CORE to test
//  the stage-by-stage upload, the camera and the map. It is NOT the DLA +
//  branched-flow terrain; LIB writes that.
//  grep -n targets: "export const OPTIONS", "export const PRESETS", "export const BIOMES",
//  "export async function generateTerrain", "function flowRoute"
// ============================================================================

export const BIOMES = [
  ['ocean', 'Ocean', '#1b3a5c'], ['beach', 'Beach', '#d8c99a'], ['desert', 'Desert', '#d6a86a'],
  ['savanna', 'Savanna', '#a89a52'], ['grassland', 'Grassland', '#6f9a44'], ['temperate-forest', 'Temperate forest', '#3e6e2e'],
  ['rainforest', 'Rainforest', '#245e2a'], ['boreal-forest', 'Boreal forest', '#33573f'], ['tundra', 'Tundra', '#8f907a'],
  ['bare-rock', 'Bare rock', '#77706a'], ['snow', 'Snow', '#eef2f6'], ['wetland', 'Wetland', '#4d6b3e'],
  ['river', 'River', '#3c6f86'], ['lake', 'Lake', '#2f5f80'], ['scree', 'Scree', '#8d877e'], ['alpine-meadow', 'Alpine meadow', '#7f9c55'],
].map(([key, name, color], id) => ({ id, key, name, color }));

const R = (key, label, group, min, max, step, def) => ({ key, label, group, type: 'range', min, max, step, def });
export const OPTIONS = [
  R('seed', 'Seed', 'World', 1, 999999, 1, 1337),
  { key: 'size', label: 'Grid', group: 'World', type: 'select', choices: [256, 512, 1024], def: 512 },
  R('worldKm', 'World size km', 'World', 2, 64, 1, 12),
  R('heightScale', 'Height scale m', 'World', 200, 4000, 50, 1600),
  R('seaLevel', 'Sea level', 'World', 0, 0.6, 0.01, 0.18),
  { key: 'seedLayout', label: 'Seed layout', group: 'DLA ridges', type: 'select', choices: ['point', 'line', 'ring', 'scatter', 'coast'], def: 'line' },
  R('branchDensity', 'Branch density', 'DLA ridges', 0.1, 1, 0.01, 0.55),
  R('stickiness', 'Stickiness', 'DLA ridges', 0.05, 1, 0.01, 0.6),
  R('ridgeSharpness', 'Ridge sharpness', 'DLA ridges', 0, 1, 0.01, 0.6),
  R('levels', 'Levels', 'DLA ridges', 2, 8, 1, 5),
  R('warp', 'Domain warp', 'Shape', 0, 1, 0.01, 0.35),
  R('noiseBlend', 'Noise blend', 'Shape', 0, 1, 0.01, 0.3),
  R('terrace', 'Terracing', 'Shape', 0, 1, 0.01, 0),
  { key: 'mask', label: 'Mask', group: 'Shape', type: 'select', choices: ['none', 'island', 'continent'], def: 'continent' },
  R('rays', 'Flow rays', 'Branched flow', 100, 4000, 50, 1200),
  R('channelDepth', 'Channel depth', 'Branched flow', 0, 1, 0.01, 0.4),
  R('erosion', 'Hydraulic erosion', 'Erosion', 0, 1, 0.01, 0.5),
  R('thermal', 'Thermal erosion', 'Erosion', 0, 1, 0.01, 0.3),
  R('temperature', 'Temperature', 'Climate', -1, 1, 0.01, 0),
  R('moisture', 'Moisture', 'Climate', 0, 1, 0.01, 0.55),
  R('detail', 'Detail relief', 'Detail', 0, 1, 0.01, 0.5),
];

export const PRESETS = {
  alpine: { label: 'Alpine', opts: { heightScale: 2800, seaLevel: 0.02, mask: 'none', ridgeSharpness: 0.8, temperature: -0.3 } },
  archipelago: { label: 'Archipelago', opts: { seaLevel: 0.45, mask: 'island', seedLayout: 'scatter', heightScale: 900 } },
  canyonlands: { label: 'Canyonlands', opts: { terrace: 0.7, moisture: 0.1, temperature: 0.6, channelDepth: 0.8 } },
  'river-delta': { label: 'River delta', opts: { seaLevel: 0.3, heightScale: 500, mask: 'continent', channelDepth: 0.7, moisture: 0.8 } },
  fjords: { label: 'Fjords', opts: { seaLevel: 0.3, heightScale: 1800, seedLayout: 'coast', temperature: -0.5 } },
  'volcanic-isles': { label: 'Volcanic isles', opts: { seaLevel: 0.4, mask: 'island', seedLayout: 'point', heightScale: 2200 } },
  highlands: { label: 'Highlands', opts: { heightScale: 1100, moisture: 0.7, ridgeSharpness: 0.3 } },
  'mesa-desert': { label: 'Mesa desert', opts: { terrace: 0.85, moisture: 0.05, temperature: 0.8, seaLevel: 0 } },
  'rift-valley': { label: 'Rift valley', opts: { seedLayout: 'ring', heightScale: 1900, moisture: 0.4 } },
};

export function defaults() { const o = {}; for (const d of OPTIONS) o[d.key] = d.def; return o; }

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function randomOptions(seed, base) {
  const r = rng(seed * 7919 + 13), o = { ...(base || defaults()) };
  for (const d of OPTIONS) {
    if (d.key === 'seed') { o.seed = 1 + Math.floor(r() * 999998); continue; }
    if (d.key === 'size') continue;
    if (d.type === 'range') o[d.key] = +(d.min + (d.max - d.min) * r()).toFixed(3);
    else if (d.type === 'select') o[d.key] = d.choices[Math.floor(r() * d.choices.length)];
    else if (d.type === 'bool') o[d.key] = r() < 0.5;
  }
  return o;
}

// value noise + fbm
function makeNoise(seed) {
  const r = rng(seed), P = new Uint8Array(512), G = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const v = (x, y) => G[P[P[x & 255] + (y & 255)]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    return (v(xi, yi) * (1 - u) + v(xi + 1, yi) * u) * (1 - w) + (v(xi, yi + 1) * (1 - u) + v(xi + 1, yi + 1) * u) * w;
  };
}

function flowRoute(h, n) {
  const N = n * n, order = new Uint32Array(N), flow = new Float32Array(N), down = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => h[b] - h[a]);
  for (let k = 0; k < N; k++) {
    const i = order[k], x = i % n, y = (i / n) | 0;
    let best = -1, bd = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
      const j = Y * n + X, d = (h[i] - h[j]) / Math.hypot(dx, dy);
      if (d > bd) { bd = d; best = j; }
    }
    down[i] = best;
  }
  for (let k = 0; k < N; k++) { const i = order[k]; flow[i] += 1; if (down[i] >= 0) flow[down[i]] += flow[i]; }
  return { flow, down };
}

const yieldTick = () => new Promise(r => setTimeout(r, 0));

export async function generateTerrain(opts = {}, onProgress = () => {}) {
  const o = { ...defaults(), ...opts };
  const n = +o.size || 512, ws = o.worldKm * 1000, hs = o.heightScale;
  const noise = makeNoise(o.seed), noise2 = makeNoise(o.seed + 99);
  const stages = [];
  let t0 = Date.now();
  const emit = async (stage, label, frac, snapshot) => {
    stages.push({ id: stage, label, ms: Date.now() - t0 }); t0 = Date.now();
    onProgress({ stage, label, frac, snapshot });
    await yieldTick();
  };
  const field = (m, f) => { const a = new Float32Array(m * m); for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) a[j * m + i] = f((i + 0.5) / m, (j + 0.5) / m); return a; };
  const ridged = (u, v, oct) => {
    let s = 0, a = 0.5, f = 3, w = 1;
    for (let k = 0; k < oct; k++) {
      const wx = o.warp * noise2(u * 2 + 5, v * 2) * 0.3, wy = o.warp * noise2(u * 2, v * 2 + 9) * 0.3;
      let r = 1 - Math.abs(noise((u + wx) * f, (v + wy) * f));
      r = Math.pow(r, 1 + o.ridgeSharpness * 2) * w;
      s += r * a; w = Math.min(1, r * 2); a *= 0.5; f *= 2.03;
    }
    return s;
  };
  const maskF = (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (o.mask === 'island') return Math.max(0, 1 - d * d * 1.1);
    if (o.mask === 'continent') return Math.max(0, Math.min(1, 1.25 - d * 0.75 + noise2(u * 3, v * 3) * 0.25));
    return 1;
  };
  // dla stage: a coarse view, levels 1..3
  for (let L = 0; L < 3; L++) {
    const m = 32 << L;
    const h = field(m, (u, v) => ridged(u, v, 2 + L) * maskF(u, v) * hs);
    await emit(L === 0 ? 'dla' : 'upscale', L === 0 ? 'DLA ridges' : 'Upscale level ' + L, (L + 1) / 8, { n: m, height: h });
  }
  const h = field(n, (u, v) => {
    let e = ridged(u, v, Math.min(9, 3 + o.levels)) * maskF(u, v);
    e = e * (1 - o.noiseBlend * 0.4) + o.noiseBlend * 0.4 * (noise(u * 9, v * 9) * 0.5 + 0.5) * maskF(u, v);
    if (o.terrace > 0) { const k = 12, q = Math.floor(e * k) / k; e = e + (q - e) * o.terrace * 0.8; }
    return e * hs;
  });
  await emit('shape', 'Shape', 4 / 8, { n, height: h.slice() });
  const sea = o.seaLevel * hs;
  let { flow } = flowRoute(h, n);
  await emit('flow', 'Branched flow', 5 / 8, { n, height: h.slice(), flow: flow.slice(), seaLevel: sea });
  // carve: depth ~ sqrt(flow)
  const river = new Float32Array(n * n);
  const thr = n * 0.6;
  for (let i = 0; i < n * n; i++) {
    const f = flow[i];
    river[i] = Math.max(0, Math.min(1, (Math.log(f) - Math.log(thr)) / 3));
    h[i] -= Math.min(hs * 0.05, Math.sqrt(f) * 0.12 * o.channelDepth * (hs / 1000));
  }
  await emit('rivers', 'Rivers', 6 / 8, { n, height: h.slice(), flow: flow.slice(), river: river.slice(), seaLevel: sea });
  // erosion: a few blur passes weighted by slope
  const tmp = new Float32Array(n * n);
  const passes = Math.round(1 + o.erosion * 3 + o.thermal * 2);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, l = h[y * n + Math.max(0, x - 1)], r = h[y * n + Math.min(n - 1, x + 1)];
      const d = h[Math.max(0, y - 1) * n + x], u = h[Math.min(n - 1, y + 1) * n + x];
      tmp[i] = h[i] * 0.6 + (l + r + d + u) * 0.1;
    }
    h.set(tmp);
  }
  ({ flow } = flowRoute(h, n));
  await emit('erosion', 'Erosion', 7 / 8, { n, height: h.slice(), flow: flow.slice(), river: river.slice(), seaLevel: sea });
  // climate + biomes
  const moisture = new Float32Array(n * n), temperature = new Float32Array(n * n), biome = new Uint8Array(n * n), water = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0, u = (x + 0.5) / n, v = (y + 0.5) / n;
    const e = (h[i] - sea) / Math.max(1, hs - sea);
    temperature[i] = o.temperature * 0.5 + 0.55 - e * 0.9 + noise2(u * 4, v * 4) * 0.1;
    moisture[i] = Math.max(0, Math.min(1, o.moisture + noise2(u * 5 + 3, v * 5) * 0.3 + river[i] * 0.4));
    water[i] = Math.max(0, sea - h[i]);
    let b;
    if (h[i] < sea) b = 0;
    else if (river[i] > 0.6) b = 12;
    else if (h[i] < sea + hs * 0.01) b = 1;
    else if (temperature[i] < 0.05) b = 10;
    else if (temperature[i] < 0.18) b = e > 0.5 ? 14 : 8;
    else if (temperature[i] < 0.3) b = moisture[i] > 0.45 ? 7 : 15;
    else if (temperature[i] > 0.75) b = moisture[i] < 0.25 ? 2 : moisture[i] < 0.5 ? 3 : 6;
    else b = moisture[i] < 0.3 ? 4 : moisture[i] < 0.7 ? 5 : 11;
    biome[i] = b;
  }
  await emit('climate', 'Climate', 7.5 / 8, { n, height: h.slice(), flow: flow.slice(), river: river.slice(), moisture: moisture.slice(), water: water.slice(), seaLevel: sea });
  // polylines for the drone: rivers downhill from the strongest sources, ridges along local maxima
  const rivers = [], ridges = [];
  const t = ws / n, X = i => -ws / 2 + ((i % n) + 0.5) * t, Z = i => -ws / 2 + (((i / n) | 0) + 0.5) * t;
  const { down } = flowRoute(h, n);
  const srcs = [];
  for (let i = 0; i < n * n; i++) if (river[i] > 0.05 && river[i] < 0.2 && h[i] > sea) srcs.push(i);
  srcs.sort((a, b) => h[b] - h[a]);
  for (const s0 of srcs.slice(0, 40).filter((_, k) => k % 5 === 0)) {
    const pts = [], width = [], fl = [];
    let i = s0, guard = 0;
    while (i >= 0 && guard++ < n * 2 && h[i] > sea - 1) { pts.push(X(i), Z(i)); width.push(2 + Math.sqrt(flow[i]) * 0.2); fl.push(flow[i]); i = down[i]; }
    if (pts.length > 40) rivers.push({ pts: new Float32Array(pts), width: new Float32Array(width), flow: new Float32Array(fl) });
  }
  for (let k = 0; k < 6; k++) {
    const r = rng(o.seed + k * 31);
    let x = Math.floor(r() * n), y = Math.floor(r() * n);
    const pts = [];
    let dir = r() * Math.PI * 2;
    for (let s = 0; s < 120; s++) {
      // climb toward the highest neighbour ahead
      let best = -Infinity, bx = x, by = y, bdir = dir;
      for (let a = -2; a <= 2; a++) {
        const d = dir + a * 0.35, X2 = Math.round(x + Math.cos(d) * 3), Y2 = Math.round(y + Math.sin(d) * 3);
        if (X2 < 1 || Y2 < 1 || X2 >= n - 1 || Y2 >= n - 1) continue;
        const v = h[Y2 * n + X2] - Math.abs(a) * hs * 0.002;
        if (v > best) { best = v; bx = X2; by = Y2; bdir = d; }
      }
      if (bx === x && by === y) break;
      x = bx; y = by; dir = bdir;
      pts.push(X(y * n + x), Z(y * n + x));
    }
    if (pts.length > 20) ridges.push({ pts: new Float32Array(pts) });
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const terrain = {
    n, worldSize: ws, heightScale: hs, seaLevel: sea, height: h, flow, river, water, moisture, temperature,
    sediment: new Float32Array(n * n), biome, rivers, lakes: [], ridges, dla: { pos: new Float64Array(0), parent: new Int32Array(0), count: 0 },
    stats: { minH: lo, maxH: hi, stub: true }, stages,
  };
  await emit('biomes', 'Biomes', 1, { n, height: h.slice(), flow: flow.slice(), river: river.slice(), moisture: moisture.slice(), water: water.slice(), biome: biome.slice(), seaLevel: sea });
  return terrain;
}

export function detailHeight() { return 0; }

// ============================================================================
//  DLA TERRAIN  ·  gpu/budget.js — device profiles and a GPU memory model
// ----------------------------------------------------------------------------
//  A phone tab that asks for too much GPU memory is killed by the system
//  (iOS gives no warning). This file picks a device profile and gives the
//  size caps that each module reads from gpu.profile. DOM-free: node tests
//  import it.
//
//  PROFILES        desktop, phone, phone-min. A profile is a set of caps; a
//                  module takes min(its quality size, the cap). desktop has
//                  no caps (null fields), so desktop sizes do not change.
//  detectProfile(env) -> id
//                  env = { w, h, coarse, deviceMemory, ua, maxTouchPoints,
//                  platform }. Phone: a coarse pointer, a short side under
//                  600 px, iOS, or deviceMemory <= 4. phone-min: a phone
//                  with deviceMemory <= 2 or a short side under 360 px.
//  profileFor(id)  a copy of the profile (unknown id: desktop)
//  stepDown(id)    the next lower profile id, or null at the bottom
//  resolveSizes(profile, view) -> the sizes in use (view = { cssW, cssH,
//                  dpr, qualityIndex, n })
//  estimate(profile, view) -> { parts: { name: bytes }, total, peak,
//                  budget } the GPU bytes of every allocation (the model
//                  follows the module code; see the comments per part)
//  lostPolicy(state, info) -> { restart, profile }: a device loss restarts
//                  one time, one profile lower; a second loss stops
//  pressureStep(state) -> the profile id after an out-of-memory error
//
//  MEASURED (Deno, gpu/mem-tally.mjs, 2026-10-17): phone 390 x 844 at Low:
//  409 MB live, 592 MB peak before the profile; 117 MB live, 118 MB peak
//  with it. Desktop 1280 x 800 at High: 700 MB live, 883 MB peak (no
//  change). The largest parts on the phone before: the vegetation
//  impostor atlases (2 x 101 MB) and the asset vertex and index buffers
//  (88 MB).
//
//  grep -n targets: "export const PROFILES", "export function detectProfile",
//  "export function estimate", "export function resolveSizes",
//  "export function lostPolicy", "ASSET_MB", "GROUND_SETS"
// ============================================================================

export const MB = 1048576;

// the quality presets of gpu/device.js (copied: device.js imports this
// file, and node imports both)
const Q = [
  { q: 0.25, scale: 0.6, shadow: 1024, cascades: 3, taa: false, dpr: 1 },
  { q: 0.5, scale: 0.8, shadow: 2048, cascades: 3, taa: true, dpr: 1.25 },
  { q: 0.75, scale: 1.0, shadow: 2048, cascades: 4, taa: true, dpr: 1.5 },
  { q: 1.0, scale: 1.0, shadow: 4096, cascades: 4, taa: true, dpr: 2 },
];

export const PROFILES = {
  desktop: {
    id: 'desktop', label: 'Desktop', budgetMB: 1200, raiseLimits: true, budgetMs: 1000 / 58,
    dprCap: null, maxN: 2048, shadowSize: null, cascades: null, taa: null,
    froxel: null, cloudK: null, cloudNoise: null, groundRes: null, groundLayers: null,
    veg: null, startDelayMs: 0,
  },
  phone: {
    id: 'phone', label: 'Phone', budgetMB: 280, raiseLimits: false, budgetMs: 1000 / 30,
    dprCap: 1.5, maxN: 512, shadowSize: 1024, cascades: 2, taa: false,
    froxel: [64, 36, 32], cloudK: 0.34, cloudNoise: { base: 64, detail: 32, n2d: 256, shadow: 256 },
    groundRes: 256, groundLayers: 8,
    // impFrame: impostor frame px (atlas 4 x 2 frames); maxImpostors: atlas
    // layers; variants: asset models per species; firstLod: the finest
    // asset LOD loaded; grassCap: blades; farK: the layer distance factor;
    // texSize: the material layer size; assets: 'all', 'small' or 'none'
    veg: { impFrame: 128, maxImpostors: 16, variants: 1, firstLod: 1, grassCap: 40000, farK: 0.7, texSize: 256, assets: 'small' },
    // the vegetation assets wait this long after the first finished terrain
    startDelayMs: 2500,
  },
  'phone-min': {
    id: 'phone-min', label: 'Phone (low memory)', budgetMB: 180, raiseLimits: false, budgetMs: 1000 / 30,
    dprCap: 1, maxN: 256, shadowSize: 1024, cascades: 1, taa: false,
    froxel: [48, 27, 24], cloudK: 0.25, cloudNoise: { base: 48, detail: 24, n2d: 256, shadow: 256 },
    groundRes: 256, groundLayers: 6,
    veg: { impFrame: 64, maxImpostors: 8, variants: 1, firstLod: 2, grassCap: 20000, farK: 0.5, texSize: 256, assets: 'none' },
    startDelayMs: 4000,
  },
};
export const PROFILE_ORDER = ['desktop', 'phone', 'phone-min'];

export function isIOS(env) {
  const ua = String(env.ua || '');
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints || 0) > 1);
}

export function detectProfile(env = {}) {
  const w = env.w || 1280, h = env.h || 800, short = Math.min(w, h);
  const mem = Number.isFinite(env.deviceMemory) && env.deviceMemory > 0 ? env.deviceMemory : null;
  const phone = !!env.coarse || short < 600 || isIOS(env) || (mem !== null && mem <= 4);
  if (!phone) return 'desktop';
  if ((mem !== null && mem <= 2) || short < 360) return 'phone-min';
  return 'phone';
}

// the env of this page (browser), for detectProfile
export function pageEnv() {
  const g = globalThis, nav = g.navigator || {};
  let coarse = false;
  try { coarse = !!(g.matchMedia && g.matchMedia('(pointer:coarse)').matches); } catch { /* no media queries */ }
  return {
    w: g.innerWidth || 1280, h: g.innerHeight || 800, coarse,
    deviceMemory: nav.deviceMemory, ua: nav.userAgent || '', maxTouchPoints: nav.maxTouchPoints || 0,
    platform: nav.platform || '',
  };
}

const clone = o => JSON.parse(JSON.stringify(o));
export function profileFor(id) { return clone(PROFILES[id] || PROFILES.desktop); }
export function stepDown(id) {
  const i = PROFILE_ORDER.indexOf(id);
  return i >= 0 && i < PROFILE_ORDER.length - 1 ? PROFILE_ORDER[i + 1] : null;
}
const capMin = (a, cap) => (cap == null ? a : Math.min(a, cap));

// the sizes in use for a profile and a view; the module formulas are the
// ones in render/*.js on 2026-10-17 (a change there makes the model drift:
// tests/phone.test.mjs checks the model, the Deno tally checks the truth)
export function resolveSizes(profile, view = {}) {
  const p = profile || PROFILES.desktop;
  const qi = Math.max(0, Math.min(3, view.qualityIndex ?? 2)), qp = Q[qi], q = qp.q;
  const coarse = p.id !== 'desktop';
  const dpr = Math.min(view.dpr || 1, qp.dpr, p.dprCap ?? 99);
  let outW = Math.max(16, Math.round((view.cssW || 1280) * dpr)), outH = Math.max(16, Math.round((view.cssH || 800) * dpr));
  if (outW * outH > 8.3e6) { const k = Math.sqrt(8.3e6 / (outW * outH)); outW = Math.round(outW * k); outH = Math.round(outH * k); }
  const w = Math.max(16, Math.round(outW * qp.scale)), h = Math.max(16, Math.round(outH * qp.scale));
  const gridFor = qq => (qq >= 0.75 ? [160, 90, 64] : qq >= 0.4 ? [128, 72, 48] : [96, 54, 32]);
  const veg = p.veg || {};
  // vegetation (render/vegetation.js createVegetation)
  const maxPages = Math.round((384 + 3200 * q) * (coarse ? 0.6 : 1));
  const grassD = (0.075 - 0.035 * q) * (coarse ? 1.3 : 1), grassR0 = q < 0.4 || coarse ? 7 : 10;
  const grassN = Math.ceil((2 * grassR0) / grassD / 8) * 8 + 8;
  return {
    qi, q, dpr, outW, outH, w, h, coarse,
    n: Math.min(view.n || 1024, p.maxN ?? 2048),
    shadowSize: capMin(qp.shadow, p.shadowSize), cascades: capMin(qp.cascades, p.cascades),
    taa: qp.taa && p.taa !== false,
    froxel: p.froxel || gridFor(q),
    cloudK: capMin(q >= 0.5 ? 0.5 : 0.34, p.cloudK),
    cloudNoise: p.cloudNoise || { base: 128, detail: 32, n2d: 512, shadow: 512 },
    groundRes: capMin(q >= 0.95 ? 1024 : q >= 0.45 ? 512 : 256, p.groundRes), groundLayers: capMin(GROUND_SETS, p.groundLayers),
    // render/surface-sim.js surfRes: the field grid (min(n, 1024), 512 on Low and phones)
    groundSurface: Math.min(Math.min(view.n || 1024, p.maxN ?? 2048), coarse || q < 0.45 ? 512 : 1024),
    veg: {
      texSize: capMin(q >= 0.5 ? 512 : 256, veg.texSize), maxInst: maxPages * 128, maxPages,
      grassCap: capMin(Math.round(grassN * grassN * 1.6), veg.grassCap),
      impFrame: veg.impFrame || 256, impostors: capMin(36, veg.maxImpostors),
      assets: veg.assets || 'all', variants: veg.variants || 0, firstLod: veg.firstLod || 0,
    },
  };
}

// ASSET_MB: the vertex + index buffers of the vegetation assets, measured
// in Deno (default-view set). 'all' (3 variants, LOD 0 to 2, 118
// prototypes): 88 MB. 'small' (1 variant, LOD 1 and 2, 41 prototypes):
// 7.7 MB. ASSET_LAYERS: the material layers the asset albedos add (Deno:
// 109 layers in all with 'all', 59 with 'small', 22 procedural).
export const ASSET_MB = { all: 88, small: 8, none: 0 };
export const ASSET_LAYERS = { all: 87, small: 37, none: 0 };
const texMip = (w, h, layers, bpp, mips = true) => w * h * layers * bpp * (mips ? 4 / 3 : 1);
// GROUND_SETS: the ground texture sets render/ground.js loads on desktop
// (the 17 manifest sets less the skipped mud set, at most MAX_SETS 16)
export const GROUND_SETS = 16;

export function estimate(profile, view = {}) {
  const p = profile || PROFILES.desktop;
  const s = resolveSizes(p, view);
  const px = s.w * s.h, opx = s.outW * s.outH, n2 = s.n * s.n;
  const [fx, fy, fz] = s.froxel, cn = s.cloudNoise;
  const ck = s.cloudK, cw = Math.round(s.w * ck), ch = Math.round(s.h * ck);
  const v = s.veg;
  // the procedural vegetation layers: 22 layers of texSize, + 1 per asset albedo
  const matLayers = 22 + (ASSET_LAYERS[v.assets] ?? ASSET_LAYERS.all);
  const parts = {
    // gpu/terrain-gpu.js: height, height prev (r32f), normal, aux, aux prev
    // (rgba16f), biome (r8) + snapshot buffers (4 + 16 B per cell)
    terrain: n2 * (4 + 4 + 8 + 8 + 8 + 1) + n2 * 20,
    // gpu/shadows.js: one depth32 layer per cascade
    shadows: s.shadowSize * s.shadowSize * 4 * s.cascades,
    // gpu/frame.js: hdr, scene colour (rgba16f), depth, scene depth (d32)
    frame: px * (8 + 8 + 4 + 4),
    // render/post.js: 2 TAA history (rgba16f), bloom chain, ldr (output)
    post: px * 16 + px * 8 * (1 / 4) * (4 / 3) + opx * 4,
    // the swap chain (3 buffers of the output size)
    swap: opx * 4 * 3,
    // render/sky.js: LUTs, cloud noise volumes, cloud shadow, 4 cloud targets
    sky: 256 * 64 * 8 + 32 * 32 * 8 + 192 * 108 * 8 + cn.shadow * cn.shadow * 8
      + cn.base ** 3 * 4 + cn.detail ** 3 * 4 + cn.n2d * cn.n2d * 4 + cw * ch * 8 * 4,
    // render/weather.js: 5 froxel volumes (rgba16f) + the sky loss plane
    froxels: fx * fy * fz * 8 * 5 + fx * fy * 8,
    // render/ground.js: albedo, normal, ORM arrays (rgba8, mips)
    ground: texMip(s.groundRes, s.groundRes, s.groundLayers, 4) * 3 + 2 * 6144 * 32,
    // render/ground.js: the surface fields (4 layers rgba8, no mips)
    groundSurface: s.groundSurface * s.groundSurface * 4 * 4,
    // render/vegetation.js: instances (32 B), visible (24 B), blades (48 B)
    vegBuffers: v.maxInst * 32 + v.maxInst * 24 + v.grassCap * 48,
    vegMaterials: texMip(v.texSize, v.texSize, matLayers, 4),
    vegImpostors: texMip(v.impFrame * 4, v.impFrame * 2, v.impostors, 4) * 2,
    vegAssets: (ASSET_MB[v.assets] ?? ASSET_MB.all) * MB,
    // render/water.js: two wave cascades 256 x 256 x 3 (rgba16f)
    water: 256 * 256 * 3 * 8 * 2,
  };
  let total = 0;
  for (const k in parts) { parts[k] = Math.round(parts[k]); total += parts[k]; }
  // a library rebuild (assets in) holds the old and the new vegetation
  // library at one time; a phone profile frees the old one first
  // (render/vegetation.js installLibrary), so only the new materials and
  // the impostor bake depth target come on top
  const bake = v.impFrame * 4 * v.impFrame * 2 * 4;
  const peak = total + bake + parts.vegMaterials + (p.veg && p.veg.assets ? 0 : parts.vegAssets + parts.vegImpostors);
  return { parts, total, peak, budget: p.budgetMB * MB, sizes: s };
}

// device.lost: restart one time, one profile lower; never loop
export function lostPolicy(state, info, profileId) {
  if (info && info.reason === 'destroyed') return { restart: false, profile: profileId, why: 'destroyed' };
  state.losses = (state.losses || 0) + 1;
  if (state.losses > 1) return { restart: false, profile: profileId, why: 'lost again' };
  return { restart: true, profile: stepDown(profileId) || profileId, why: 'lost' };
}
// an out-of-memory error: one profile lower, at most one step per 2 s
export function pressureStep(state, profileId, now = 0) {
  if (state.lastOOM !== undefined && now - state.lastOOM < 2000) return profileId;
  state.lastOOM = now;
  state.oom = (state.oom || 0) + 1;
  return stepDown(profileId) || profileId;
}

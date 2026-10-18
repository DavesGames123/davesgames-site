// ============================================================================
//  CORAL REEF  ·  budget.js  ·  device profiles and a memory model (DOM-free)
// ----------------------------------------------------------------------------
//  The user reported (2026-10-17): "https://davesgames.io/stella-nova/
//  #coral-reef crashed when i tried to load it". A tab that asks for too
//  much memory is killed by the system (iOS and Safari give no warning).
//  This file picks a device profile, and the profile sets every load of
//  the page: the reef size, the rock quality, the workers, the render
//  targets and the ROV feed. Node tests import it (tests/budget.test.mjs).
//  The approach is the one of pages/dla-terrain/gpu/budget.js.
//
//  PROFILES        desktop, laptop-low, phone, phone-min. Fields:
//                  reef: the reef.js QUALITY id of the default reef, and
//                  reefMax: the largest one the colonies chips offer.
//                  cap: { particles, colonies, tris, polyps } the reef
//                  worker budget (init message 'budget'), on top of QUALITY.
//                  rock: rock quality; rockWorkers: at most this many rock
//                  module workers. shadow: the lead lamp map size (0 off).
//                  shadowExtra: the map size of the main lamp of each
//                  other ROV (0: only the lead lamp has a map; phones: one
//                  shadow map, CONTRACT-V4.md).
//                  polypShadow: the polyps cast into the maps (desktop).
//                  vol: { scale, steps } the volume pass. dprCap and maxPx:
//                  the pixel ratio cap and the drawing buffer pixel cap.
//                  caustic: { res, grid }. snow: flakes (lib/marine-snow.js
//                  SNOW_PROFILES: many faint motes, the depth mix draws
//                  0.3 to 0.9 of them). polypDraw: the
//                  polyps drawn at most (scene.js uKeep). rovs: vehicles.
//                  feed: { w, h, fps } the ROV camera feed (rov/ reads it).
//                  stagger: { reefMs, rovMs } the delays of the start.
//                  frameMs: the frame time the governor holds.
//  detectProfile(env) -> id
//                  env = { w, h, coarse, deviceMemory, cores, ua,
//                  maxTouchPoints, gpu }. Phone: a coarse pointer, a short
//                  side under 600 px, or iOS. phone-min: a phone with
//                  deviceMemory <= 2, or a short side under 360 px.
//                  laptop-low: not a phone, and 4 cores or less, or
//                  deviceMemory <= 4, or a software or integrated GPU name.
//  pageEnv()       the env of this page (browser)
//  profileFor(id)  a copy (an unknown id gives desktop); stepDown(id)
//  rockWorkers(profile, cores) the rock worker count (1 .. 4)
//  reefBudget(profile, quality) the reef worker budget for a quality id
//  estimate(profile, view) -> { gpu: {part: bytes}, js: {part: bytes},
//                  gpuTotal, jsTotal, budget } (view = { cssW, cssH, dpr,
//                  quality }). The parts follow scene.js, rock/, the reef
//                  worker and rov/ (see the comment per part).
//  lostPolicy(state, id) -> { action: 'reload' | 'stop', profile, state }
//                  a WebGL context loss reloads one time, one profile
//                  lower; a second loss in 10 min stops
//  frameGovernor(o) the frame governor: on slow frames it steps down the
//                  volume pass, the polyps, the shadow maps of the other
//                  ROVs, the lead shadow map and the pixel ratio
//
//  MEASURED (node, 2026-10-17, seed 1, R 30): rock tris high 728 476,
//  medium 360 992, low 171 248; sand tris medium 56 448, low 29 282; one
//  rock geology (one worker) 7 MB. The reef worker at desktop quality
//  after 150 s at full rate: 83 829 particles, 2.24 M coral tris, 415 k
//  polyps, 133 MB array buffers, 428 MB rss, and 878 MB of brick arrays
//  posted to the page in 485 k bricks (the page drops the old ones).
//  MEASURED (node, 2026-10-18, seed 1, R 30, rate Infinity, the larger
//  corals of reef.js SPECIES_SCALE, grown to the end): desktop default
//  (mid) 66 colonies, 121 k particles, 2.48 M coral tris, 788 k polyps,
//  231 MB array buffers, 116 s; desktop Most 199 k particles, 4.64 M
//  tris, 406 MB; phone 23.9 k particles, 479 k tris, 116 k polyps, 65 MB;
//  phone-min 13.4 k particles, 237 k tris, 42 MB. The bricks posted fell
//  from 278 k (431 MB) to 39 k (174 MB) on desktop (coral-sdf.js gapMs).
//
//  grep -n targets: "export const PROFILES", "export function detectProfile",
//  "export function estimate", "export function lostPolicy",
//  "export function frameGovernor", "const ROCK_TRIS"
// ============================================================================

export const MB = 1048576;

export const PROFILES = {
  desktop: {
    id: 'desktop', label: 'Desktop', budgetMB: 700, reef: 'mid', reefMax: 'desktop',
    cap: {}, rock: 'high', rockWorkers: 4, shadow: 2048, shadowExtra: 1024, polypShadow: true, vol: { scale: 0.42, steps: 30 },
    dprCap: 2, maxPx: 6.0e6, caustic: { res: 1024, grid: 360 }, snow: 9000, polypDraw: 160000,
    rovs: 3, feed: { w: 320, h: 256, fps: 30 }, stagger: { rovMs: 300, reefMs: 900 }, frameMs: 1000 / 50,
  },
  'laptop-low': {
    id: 'laptop-low', label: 'Laptop', budgetMB: 450, reef: 'phone', reefMax: 'mid',
    cap: { particles: 40000, tris: 900000 }, rock: 'medium', rockWorkers: 3, shadow: 1024, shadowExtra: 512, polypShadow: false, vol: { scale: 0.36, steps: 20 },
    dprCap: 1.5, maxPx: 3.0e6, caustic: { res: 512, grid: 240 }, snow: 5000, polypDraw: 80000,
    rovs: 3, feed: { w: 256, h: 204, fps: 20 }, stagger: { rovMs: 500, reefMs: 1500 }, frameMs: 1000 / 40,
  },
  phone: {
    id: 'phone', label: 'Phone', budgetMB: 250, reef: 'phone', reefMax: 'phone',
    cap: { particles: 25000, tris: 500000, polyps: 0.45 }, rock: 'low', rockWorkers: 2, shadow: 1024, shadowExtra: 0, polypShadow: false, vol: { scale: 0.35, steps: 14 },
    dprCap: 1.5, maxPx: 1.3e6, caustic: { res: 512, grid: 200 }, snow: 2600, polypDraw: 30000,
    rovs: 2, feed: { w: 224, h: 180, fps: 15 }, stagger: { rovMs: 800, reefMs: 2500 }, frameMs: 1000 / 30,
  },
  'phone-min': {
    id: 'phone-min', label: 'Phone (low memory)', budgetMB: 160, reef: 'phone', reefMax: 'phone',
    cap: { particles: 14000, colonies: 20, tris: 280000, polyps: 0.3 }, rock: 'low', rockWorkers: 1, shadow: 512, shadowExtra: 0, polypShadow: false, vol: { scale: 0.3, steps: 10 },
    dprCap: 1, maxPx: 0.8e6, caustic: { res: 256, grid: 128 }, snow: 1400, polypDraw: 15000,
    rovs: 2, feed: { w: 160, h: 128, fps: 10 }, stagger: { rovMs: 1200, reefMs: 4000 }, frameMs: 1000 / 30,
  },
};
export const PROFILE_ORDER = ['desktop', 'laptop-low', 'phone', 'phone-min'];
// reef.js QUALITY (copied, so this file has no imports; tests check the copy)
export const REEF_Q = {
  desktop: { particles: 240000, colonies: 96, polyps: 1, tris: 4000000 },
  mid: { particles: 140000, colonies: 66, polyps: 0.7, tris: 2600000 },
  phone: { particles: 30000, colonies: 34, polyps: 0.45, tris: 650000 },
};
const Q_ORDER = ['phone', 'mid', 'desktop'];

export function isIOS(env) {
  const ua = String(env.ua || '');
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints || 0) > 1);
}
const LOW_GPU = /SwiftShader|llvmpipe|Software|Intel\(R\) (HD|UHD)|Intel HD|Intel UHD|Mali-[GT][0-9]{2}\b|Adreno \(TM\) [3-5]\d\d|PowerVR/i;

export function detectProfile(env = {}) {
  const w = env.w || 1280, h = env.h || 800, short = Math.min(w, h);
  const mem = Number.isFinite(env.deviceMemory) && env.deviceMemory > 0 ? env.deviceMemory : null;
  const phone = !!env.coarse || short < 600 || isIOS(env);
  if (phone) return (mem !== null && mem <= 2) || short < 360 ? 'phone-min' : 'phone';
  const cores = env.cores || 8;
  if (cores <= 4 || (mem !== null && mem <= 4) || LOW_GPU.test(String(env.gpu || ''))) return 'laptop-low';
  return 'desktop';
}

export function pageEnv() {
  const g = globalThis, nav = g.navigator || {};
  let coarse = false;
  try { coarse = !!(g.matchMedia && g.matchMedia('(pointer:coarse)').matches); } catch (e) { /* no media queries */ }
  return {
    w: g.innerWidth || 1280, h: g.innerHeight || 800, coarse, deviceMemory: nav.deviceMemory,
    cores: nav.hardwareConcurrency, ua: nav.userAgent || '', maxTouchPoints: nav.maxTouchPoints || 0,
  };
}

const clone = o => JSON.parse(JSON.stringify(o));
export function profileFor(id) { return clone(PROFILES[id] || PROFILES.desktop); }
export function stepDown(id) {
  const i = PROFILE_ORDER.indexOf(id);
  return i >= 0 && i < PROFILE_ORDER.length - 1 ? PROFILE_ORDER[i + 1] : null;
}
export function rockWorkers(p, cores = 4) { return Math.max(1, Math.min(p.rockWorkers || 4, 4, (cores || 4) - 1)); }
// a quality id no larger than the profile allows
export function clampQuality(p, q) {
  const qi = Q_ORDER.indexOf(q), mi = Q_ORDER.indexOf(p.reefMax);
  return qi < 0 ? p.reef : Q_ORDER[Math.min(qi, mi)];
}
// The budget for the reef worker init message: QUALITY[q] capped by the profile.
export function reefBudget(p, q) {
  const Q = REEF_Q[q] || REEF_Q.mid, c = p.cap || {}, m = (a, b) => (b == null ? a : Math.min(a, b));
  return { particles: m(Q.particles, c.particles), colonies: m(Q.colonies, c.colonies), tris: m(Q.tris, c.tris), polyps: m(Q.polyps, c.polyps) };
}
// The pixel ratio for a canvas of w x h CSS px.
export function pixelRatioFor(p, dpr, w, h) {
  const r = Math.min(dpr || 1, p.dprCap, Math.sqrt(p.maxPx / Math.max(1, w * h)));
  return Math.max(0.5, Math.round(r * 100) / 100);
}

// ── the memory model ────────────────────────────────────────────────────────
const ROCK_TRIS = { high: 728476, medium: 360992, low: 171248 };   // measured, seed 1
const SAND_TRIS = { high: 115000, medium: 56448, low: 29282 };      // high: from the 0.35 m grid
const B_ROCK_TRI = 0.53 * 32 + 12;     // verts per tri x (pos, nrm, cavity, band) + 3 Uint32
const B_CORAL_TRI = 0.55 * 28 + 12;    // verts per tri x (pos, nrm, gid) + 3 Uint32
const TEX_MIP = 4 / 3;

export function estimate(profile, view = {}) {
  const p = profile || PROFILES.desktop;
  const cssW = view.cssW || 1280, cssH = view.cssH || 800;
  const pr = pixelRatioFor(p, view.dpr || 1, cssW, cssH);
  const px = Math.round(cssW * pr) * Math.round(cssH * pr);
  const q = clampQuality(p, view.quality || p.reef), B = reefBudget(p, q);
  const NP = Math.ceil((B.particles + 8192) / 512) * 512;
  // polyps: about 9.5 per particle at density 1 (measured, 2026-10-18);
  // scene.js uploads all of them (uKeep only skips some in the vertex shader)
  const coralTris = B.tris, polyps = Math.round(B.particles * 9.5 * B.polyps);
  const cr = p.caustic.res, cg = p.caustic.grid, sh = p.shadow, vs = p.vol.scale;
  const gpu = {
    // the canvas: colour front and back (RGBA8) and depth24-stencil8
    canvas: px * (4 + 4 + 4),
    // scene.js makePasses: rtScene RGBA16F + depth texture (u32), rtVol RGBA16F, rtLum
    sceneTarget: px * (8 + 4),
    volTarget: Math.round(px * vs * vs) * 8 + 32 * 32 * 4,
    // scene.js makeCaustics: RGBA16F map, the grid (aUv) and its Uint32 index
    caustics: cr * cr * 8 + (cg + 1) * (cg + 1) * 8 + cg * cg * 24,
    // the shadow maps, RGBA8 packed depth + a depth buffer each: the lead
    // lamp, and the main lamp of each other ROV (scene.js setLights, at
    // most 4 spots)
    shadow: sh * sh * 8 + Math.max(0, Math.min(p.rovs || 1, 4) - 1) * (p.shadowExtra || 0) ** 2 * 8,
    // scene.js mkPart: two RGBA32F particle textures
    particles: 2 * NP * 16,
    rock: ROCK_TRIS[p.rock] * B_ROCK_TRI + SAND_TRIS[p.rock] * (0.5 * 40 + 12),
    // three textures of 1024 (rock) and two of 512 (sand), RGBA8 with mips
    textures: (3 * 1024 * 1024 + 2 * 512 * 512) * 4 * TEX_MIP,
    coral: coralTris * B_CORAL_TRI,
    // instanced polyps: 8 floats each (scene.js rebuildChunk)
    polyps: polyps * 32,
    // lib/marine-snow.js: 32 bytes an instance, the RGBA8 atlas with mips
    // (512 px, phones 256 px)
    snow: p.snow * 32 + (p.snow > 3000 ? 512 * 512 : 256 * 256) * 4 * 4 / 3,
    // rov/feed.js: the camera target (RGBA16F + depth), the RGBA8 copy
    feed: p.feed.w * p.feed.h * (8 + 4 + 4),
    // the vehicles, tethers and wash (an estimate: about 2 MB a vehicle)
    rovs: p.rovs * 2 * MB,
  };
  const js = {
    // three keeps the arrays of each geometry: the rock and sand copies
    rockArrays: gpu.rock,
    // scene.js keeps the bricks per chunk and the merged chunk arrays
    coralArrays: 2 * gpu.coral + 2 * gpu.polyps,
    // the page mirror of the particles (reef.js createReefMirror: 8 floats)
    mirror: B.particles * 8 * 4 + NP * 4 * 5,
    // the reef worker: 231 MB array buffers at 121 k particles (measured)
    reefWorker: B.particles * 2000 + 7 * MB,
    // rock workers live only while the rock builds (7 MB each, measured)
    rockWorkers: rockWorkers(p, view.cores || 8) * 7 * MB,
  };
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  for (const o of [gpu, js]) for (const k in o) o[k] = Math.round(o[k]);
  return { profile: p.id, quality: q, pr, px, gpu, js, gpuTotal: sum(gpu), jsTotal: sum(js), budget: p.budgetMB * MB };
}

// ── context loss ───────────────────────────────────────────────────────────
// state: { losses, at } (sessionStorage). A loss reloads one time, at one
// profile lower; a second loss in 10 minutes stops (no reload loop).
export function lostPolicy(state, id, now = Date.now()) {
  const s = state && now - (state.at || 0) < 600000 ? { losses: state.losses || 0, at: state.at } : { losses: 0, at: 0 };
  s.losses++; s.at = now;
  const down = stepDown(id);
  if (s.losses > 1) return { action: 'stop', profile: id, state: s };
  return { action: 'reload', profile: down || id, state: s };
}

// ── the frame governor ─────────────────────────────────────────────────────
// o: { frameMs, slowK (1.35), slowS (3 s), fastK (0.7), fastS (12 s),
// levels: [{ name, apply(on) }] }. tick(dtMs) eases the frame time; after
// slowS of frames over frameMs x slowK it applies the next level (on =
// true); after fastS of frames under the fast line it undoes the last
// one. At most one change per 4 s. level: the levels in use.
// The fast line is frameMs x fastK, or 1.15 x the display frame time when
// that is more. The display frame time (vsync) is the 10th percentile of
// the last 120 frame times: requestAnimationFrame gives a multiple of it.
// Before 2026-10-18 the line was frameMs x fastK only: 14 ms for desktop,
// so on a 60 Hz display (16.7 ms frames) a level never came back (the
// page stayed at 0.75 of the pixel ratio and the small volume buffer).
// A level that the governor applies again less than 30 s after it undid
// it doubles its fastS (at most 16 x): no fast swing between two levels.
export function frameGovernor(o = {}) {
  const frameMs = o.frameMs || 1000 / 50, slowK = o.slowK ?? 1.35, fastK = o.fastK ?? 0.7;
  const slowS = o.slowS ?? 3, fastS = o.fastS ?? 12, levels = o.levels || [];
  let ema = frameMs, slow = 0, fast = 0, level = 0, since = 0, n = 0, clock = 0;
  const ring = new Float32Array(120), hold = levels.map(() => 1), undoneAt = levels.map(() => -1e9);
  let ringN = 0, vsync = 0;
  function vsyncOf() {
    const k = Math.min(ringN, ring.length);
    if (k < 20) return 0;
    const a = Array.from(ring.subarray(0, k)).sort((x, y) => x - y);
    return a[Math.floor(k * 0.1)];
  }
  return {
    get level() { return level; }, get ema() { return ema; }, get vsync() { return vsync; }, get hold() { return hold.slice(); }, levels,
    fastLine() { return Math.max(frameMs * fastK, vsync * 1.15); },
    tick(dtMs) {
      if (!(dtMs > 0) || dtMs > 1000) return level;      // a tab that comes back
      n++;
      clock += dtMs / 1000;
      ring[ringN++ % ring.length] = dtMs;
      if ((n & 15) === 0) vsync = vsyncOf();
      ema += (dtMs - ema) * 0.05;
      since += dtMs / 1000;
      if (n < 30) return level;                           // the first frames compile shaders
      const fastAt = this.fastLine();
      if (ema > frameMs * slowK) { slow += dtMs / 1000; fast = 0; } else if (ema < fastAt) { fast += dtMs / 1000; slow = 0; } else { slow = 0; fast = 0; }
      if (since < 4) return level;
      if (slow > slowS && level < levels.length) {
        if (clock - undoneAt[level] < 30) hold[level] = Math.min(16, hold[level] * 2);
        levels[level].apply(true); level++; slow = 0; since = 0; ema = frameMs;
      } else if (level > 0 && fast > fastS * hold[level - 1]) {
        level--; levels[level].apply(false); undoneAt[level] = clock; fast = 0; since = 0;
      }
      return level;
    },
  };
}

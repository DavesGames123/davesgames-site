// ============================================================================
//  DLA TERRAIN  ·  main.js — boot, generation, the frame loop, input, saver
// ----------------------------------------------------------------------------
//  The page integrator (package CORE). It joins:
//    lib/dla-terrain.js (LIB; else gpu/stub-terrain.js) for OPTIONS,
//      PRESETS, BIOMES, randomOptions, and its worker for generateTerrain
//    sky-state.js (SKY; else gpu/sky-stub.js) for the sun and the weather
//    render/ground.js, vegetation.js, sky.js, water.js: package modules,
//      each with import() and a try/catch, so a missing or broken module
//      never blanks the page (a small notice names it). sky.js makes the
//      weather part (render/weather.js) itself.
//    lib/glb-lite.js loadNatureManifest -> gpu.assets (ASSETS), may be null
//    gpu/* the frame graph, render/post.js the post chain, camera.js, ui.js,
//      saver.js (the shot plan)
//
//  GENERATION  app.generate() posts { type: 'generate', id, opts } to the
//  worker. Each progress snapshot goes to gpu/terrain-gpu.js (a 0.6 s blend
//  from the state on screen), to every module (setTerrain), to the map and
//  to the stage bar. At most one snapshot per SNAP_MS is uploaded; the
//  newest waits. So the 3D view shows the terrain FORM stage by stage.
//
//  FRAME ORDER  saver tick or clock -> input -> camera -> pending snapshot
//  -> sky state -> matrices (TAA jitter, saver band shift) -> Globals ->
//  cascades -> module.update -> frame graph (compute, shadow, opaque, sky,
//  water, volumetric, post) -> map and status.
//
//  frame (to the modules): { globals, g (named views), camera, time, dt,
//  tod, weather (skyState result), sky, quality, coarse, layers, terrain,
//  frameIndex, cascade, shadowInfo, shadowBindGroup, shadowDistance,
//  cloudShadow, skyView (SKY exports), veg { density, conifer, flowers },
//  waterLook { tint, waves }, season }
//
//  WIRING (NOTES.md)  after the modules load: gpu.cloudShadow and
//  gpu.skyView from the sky module; setAerial(false) on ground and
//  vegetation when the sky has drawVolumetric (one haze, not two); a
//  quality change calls module.setQuality(q) on each module.
//
//  SAVER  window.snSaver = { enter(opts), exit() } (see "── SAVER"). The
//  shot plan is saver.js. P toggles the in-page saver.
//
//  URL: ?seed=<int> ?preset=<id> ?q=0..3 ?tod=0..1 ?wx=<weather id> ?cam=orbit|fly|drone
//  HASH (world-state.js): #s=..&p=..&o=..&t=..&w=..&se=..&v=..&wa=..&c=.. holds
//  the full world (options diff, time, weather, season, plants, water,
//  camera), so a link reloads the same world; it wins over the query.
//  "Randomise everything" and each group dice push a new hash (history
//  back and forward work); edits replace it (debounced).
//
//  DEFAULT OPENING  a strong preset at golden hour: the camera turns round
//  the terrain while it forms from DLA, then a drone flies a ridge.
//
//  grep -n targets: "── APP", "── BOOT", "── MODULES", "── GENERATE",
//  "── LOOP", "── INPUT", "── SAVER", "── LOSS", "── WORLD", "function frameGlobals"
// ============================================================================
import { createGPU, QUALITY } from './gpu/device.js';
import { createTerrainGPU } from './gpu/terrain-gpu.js';
import { createShadowMaps, computeCascades } from './gpu/shadows.js';
import { createFrameGraph } from './gpu/frame.js';
import { createFallbackGround, createFallbackSky } from './gpu/fallback.js';
import { packGlobals, GLOBALS, GLOBALS_FLOATS, globalsView, applyWxOver, wxFromGlobals } from './gpu/globals.js';
import * as SkyStub from './gpu/sky-stub.js';
import * as TerrainStub from './gpu/stub-terrain.js';
import { createPost } from './render/post.js';
import { createCamera, dronePath } from './camera.js';
import { createUI, todRate } from './ui.js';
import { buildShotPlan, framing, shotLabel, shotTod, extractFn, SHOT_CODE, mulberry } from './saver.js';
import { plateBand } from '../../lib/saver-clear.js';
import { rollGroup, rollWorld, encodeHash, decodeHash, createHistory, newSeed, VEG0, WATER0, todForElevation } from './world-state.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const root = document.documentElement;
const Q = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer:coarse)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SNAP_MS = 140;
const FRAME_K = 0.55, FRAME_PITCH = -0.36;   // the first view of a new terrain

export const MODULES = [
  { role: 'ground', url: './render/ground.js', fn: 'createGround', label: 'Ground' },
  { role: 'vegetation', url: './render/vegetation.js', fn: 'createVegetation', label: 'Vegetation' },
  { role: 'sky', url: './render/sky.js', fn: 'createSky', label: 'Sky and weather' },
  { role: 'water', url: './render/water.js', fn: 'createWater', label: 'Water' },
];

// ── APP ─────────────────────────────────────────────────────────────────
const app = {
  lib: TerrainStub, libKind: 'stub', skyLib: null, sky: null,
  opts: {}, preset: null,
  tod: clamp(+(Q.get('tod') ?? 0.27), 0, 1), todSpeed: 0.07, playing: true,
  season: 0.35, latitude: 46, weatherId: Q.get('wx') || 'fair', wxOver: {},
  qualityIndex: clamp(+(Q.get('q') ?? (coarse ? 0 : 2)), 0, 3),   // phones start on Low
  layers: { grass: true, trees: true, props: true, water: true, clouds: true, rain: true },
  camMode: 'orbit', look: { ev: 0, bloom: 0.045, fov: 50 },
  terrain: null, gen: null, skyT: 0, skySpeed: 1, lastInput: -1e9,
  saverRun: null, drones: { ridge: 0, river: 0 },
  veg: { ...VEG0 }, water: { ...WATER0 }, locks: loadLocks(), hist: createHistory(30),
  camShot: null, pendingCam: null, lastHash: '', genOpts: null, opening: true,
};
function loadLocks() {
  try { const a = JSON.parse(localStorage.getItem('dla-terrain-locks') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
}
window.__dlaTerrain = app;   // for the console

let gpu = null, tg = null, sh = null, post = null, fg = null, ui = null;
const cam = createCamera({ fovY: 50 * Math.PI / 180 });
app.cam = cam;   // for the console and the Deno harness
const G = new Float32Array(GLOBALS_FLOATS), GV = globalsView(G);
let prevVP = null, frameNo = 0, lastT = 0, fpsAcc = 0, fpsN = 0, fps = 0, pendingSnap = null, lastSnapAt = 0;
let skyState = null, worker = null, workerKind = null, genId = 0, booted = false;

const world = {
  heightAt: (x, z) => (tg ? tg.heightAt(x, z) : 0),
  get size() { return tg ? tg.worldSize : 8000; },
  get seaLevel() { return tg ? tg.seaLevel + 0.4 : 0; },
  get midH() { return tg ? (Math.max(tg.minH, tg.seaLevel) + tg.maxH) / 2 : 0; },
};

// ── methods the UI calls ──
app.setOpt = (k, v) => { app.opts[k] = v; app.preset = app.preset && k !== 'seed' ? null : app.preset; ui && ui.syncOptions(); hashSoon(); };
app.applyPreset = id => {
  const p = app.lib.PRESETS[id];
  if (!p) return;
  app.preset = id;
  const seed = app.opts.seed;
  app.opts = { ...app.lib.defaults(), ...p.opts, seed, ...(coarse ? { n: Math.min(p.opts.n || 1024, 1024) } : {}) };
  ui.syncOptions();
  app.generate();
  writeHash(true);
};
app.nextPreset = () => {
  const ids = Object.keys(app.lib.PRESETS);
  app.applyPreset(ids[(ids.indexOf(app.preset) + 1) % ids.length]);
};
// the dice: one group (world-state.js rollGroup), or every unlocked group
app.randomise = group => {
  if (!group) { app.randomiseAll(); return; }
  applyWorld(rollGroup(worldNow(), group, newSeed(), app.lib, rollCtx()), { push: true });
};
app.randomiseAll = seed => {
  const w = rollWorld(worldNow(), app.locks, seed || newSeed(), app.lib, rollCtx());
  applyWorld(w, { push: true });
  const wx = weatherList().find(x => x.id === w.weather);
  ui.toast(`New world · ${ui.todText(w.tod)} · ${wx ? wx.label : w.weather}`);
};
app.toggleLock = group => {
  if (app.locks.has(group)) app.locks.delete(group); else app.locks.add(group);
  try { localStorage.setItem('dla-terrain-locks', JSON.stringify([...app.locks])); } catch { /* private mode */ }
  ui.syncLocks();
};
app.setMix = (part, key, v) => { app[part] = { ...app[part], [key]: v }; hashSoon(); };
app.setSeason = v => { app.season = v; hashSoon(); };
app.historyStep = d => {
  const h = d < 0 ? app.hist.back() : app.hist.forward();
  if (!h) return;
  const w = decodeHash(h, app.lib);
  if (w) applyWorld({ ...worldNow(), ...w }, { push: false, hash: h });
};
app.copyLink = () => {
  app.camShot = camNow();
  writeHash(false);
  const url = location.href;
  const done = () => ui.toast('The link to this world is copied');
  try { navigator.clipboard.writeText(url).then(done, () => ui.toast('Copy the address bar: it holds this world')); }
  catch { ui.toast('Copy the address bar: it holds this world'); }
};
app.setTod = v => { app.tod = ((v % 1) + 1) % 1; ui.syncSky(); hashSoon(); };
// golden hour: the sun 5 degrees up (morning before noon, else evening)
app.goldenHour = () => {
  const sp = app.skyLib && app.skyLib.solarPosition;
  const t = sp ? todForElevation(5, app.tod < 0.5, app.season, app.latitude, sp) : null;
  app.setTod(t ?? (app.tod < 0.5 ? 0.275 : 0.715));
};
app.setPlaying = p => { app.playing = p; ui.syncSky(); hashSoon(); };
app.setWeather = (id, reset) => {
  app.weatherId = id;
  if (reset && app.sky && app.sky.reset) app.sky.reset();
  ui && ui.syncSky();
  if (!app.saverRun) hashSoon();
};
app.setWxOver = (k, v) => { app.wxOver[k] = v; };
app.clearWxOver = () => { app.wxOver = {}; };
app.setQuality = i => { app.qualityIndex = i; applyQuality(); ui.syncView(); };
app.setLayer = (k, on) => { app.layers[k] = on; ui.syncView(); };
app.setLook = (k, v) => {
  app.look[k] = v;
  if (post && k === 'ev') post.settings.ev = v;
  if (post && k === 'bloom') post.settings.bloom = v;
  if (k === 'fov') cam.fovY = v * Math.PI / 180;
};
app.setCam = mode => {
  if (mode === 'drone') { app.drone('ridge'); return; }
  cam.setMode(mode, world); app.camMode = mode; ui.syncView();
};
app.drone = (kind, pickIndex) => {
  const t = app.terrain || (tg && tg.view && tg.view.cpu);
  const list = t && (kind === 'river' ? t.rivers : t.ridges);
  if (!list || !list.length) { ui.toast(app.gen && app.gen.running ? 'The flight paths come when the terrain is done' : 'This terrain has no ' + kind + 's to follow'); return; }
  // the longest paths first, then the next one each time
  const sorted = list.slice().sort((a, b) => b.pts.length - a.pts.length);
  const k = pickIndex ?? app.drones[kind]++;
  const pick = sorted[k % Math.min(sorted.length, 8)];
  app.dronePick = { path: kind, pick: k % Math.min(sorted.length, 8) };
  cam.drone = dronePath(pick.pts, world, kind === 'river'
    ? { clearance: 45, lookAhead: 520, lookDown: 80, spacing: 70, window: 400, side: 420, sideK: 0.8 }
    : { clearance: 110, lookAhead: 520, lookDown: 90, spacing: 90, window: 320 });
  cam.droneS = 0; cam.droneSpeed = kind === 'river' ? 45 : 85;
  cam.droneKind = kind;
  cam.mode = 'drone'; app.camMode = 'drone';
  if (post) post.resetHistory();
  ui.syncView();
};
app.flyTo = (x, z) => { cam.flyTo(x, z, world); app.camMode = cam.mode; app.lastInput = performance.now(); ui.syncView(); };
app.onLayout = () => {};
app.loadCredits = () => {
  fetch(new URL('../../assets/nature/CREDITS.txt', location.href)).then(r => (r.ok ? r.text() : Promise.reject(r.status)))
    .then(t => { $('creditsAssets').textContent = t; })
    .catch(() => { $('creditsAssets').textContent = 'assets/nature/CREDITS.txt is not there yet.'; });
};

function applyQuality() {
  const qp = QUALITY[app.qualityIndex];
  if (!gpu) return;
  gpu.qualityIndex = app.qualityIndex; gpu.qualityPreset = qp; gpu.quality = qp.q;
  gpu.shadowSize = Math.min(qp.shadow, gpu.device.limits.maxTextureDimension2D); gpu.shadowCascades = qp.cascades;
  sh.resize(gpu.shadowSize, gpu.shadowCascades);
  post.settings.taa = qp.taa; post.resetHistory();
  fg.maxScale = qp.scale; fg.setScale(qp.scale);
  for (const m of fg.modules) if (m.setQuality) try { m.setQuality(qp.q); } catch (e) { console.warn(e); }
  resize();   // the pixel ratio cap follows the quality
}

// ── BOOT ────────────────────────────────────────────────────────────────
async function loadLib() {
  try {
    const m = await import('../../lib/dla-terrain.js');
    if (m.OPTIONS && m.generateTerrain) { app.lib = m; app.libKind = 'lib'; }
  } catch (e) { console.warn('dla-terrain: lib/dla-terrain.js did not load, using the stub', e); }
  try {
    const s = await import('./sky-state.js');
    if (s.skyState && s.WEATHER) { app.skyLib = s; app.sky = s.createSky ? s.createSky() : null; }
  } catch (e) { console.warn('dla-terrain: sky-state.js did not load, using the stub', e); }
}

function initialOptions() {
  const lib = app.lib;
  app.opts = lib.defaults();
  const fromHash = decodeHash(location.hash, lib);
  if (fromHash) {
    applyWorld({ ...worldNow(), ...fromHash }, { push: false, generate: false, hash: location.hash });
    if (coarse && app.opts.n > 1024) app.opts.n = 1024;
    app.opening = !fromHash.cam;
    return;
  }
  const pid = Q.get('preset');
  if (pid && lib.PRESETS[pid]) { app.preset = pid; Object.assign(app.opts, lib.PRESETS[pid].opts); }
  else if (!pid) {
    // the first visit opens on a strong preset
    const first = ['alpine', 'highlands', 'fjords'].find(k => lib.PRESETS[k]);
    if (first) { app.preset = first; Object.assign(app.opts, lib.PRESETS[first].opts); }
  }
  if (Q.get('seed')) app.opts.seed = Math.max(1, Math.round(+Q.get('seed')) || 1);
  if (coarse && app.opts.n > 1024) app.opts.n = 1024;
}

async function makeWorker() {
  const libURL = new URL('../../lib/dla-terrain-worker.js', import.meta.url);
  let ok = false;
  if (app.libKind === 'lib') {
    // a 404 skips the worker; a server that does not answer HEAD still tries it
    try { const r = await fetch(libURL, { method: 'HEAD' }); ok = r.ok || (r.status !== 404 && r.status !== 410); } catch { ok = true; }
  }
  const url = ok ? libURL : new URL('./gpu/stub-worker.js', import.meta.url);
  workerKind = ok ? 'lib' : 'stub';
  if (!ok && app.libKind === 'lib') {
    // LIB has no worker yet: run its generator here, between frames
    worker = null; workerKind = 'inline';
    return;
  }
  worker = new Worker(url, { type: 'module' });
  worker.onmessage = e => onWorker(e.data);
  worker.onerror = e => {
    console.warn('dla-terrain: the worker failed', e);
    ui.notice('The terrain worker failed; the terrain is made on the page');
    worker = null; workerKind = 'inline';
    if (app.gen && app.gen.running) app.generate();
  };
}

async function bootGPU() {
  let assets = null;
  try {
    const gl = await import('../../lib/glb-lite.js');
    if (gl.loadNatureManifest) assets = await gl.loadNatureManifest(new URL('../../assets/nature/', import.meta.url).href);
  } catch (e) { console.warn('dla-terrain: no nature assets', e); }
  gpu = await createGPU(canvas, { qualityIndex: app.qualityIndex, assets, coarse });
  app.gpu = gpu;
  gpu.device.lost.then(info => onLost(info));
  gpu.device.addEventListener && gpu.device.addEventListener('uncapturederror', e => console.warn('dla-terrain GPU:', e.error && e.error.message));
  tg = await createTerrainGPU(gpu);
  sh = createShadowMaps(gpu);
  gpu.shadows = sh;
  post = await createPost(gpu);
  post.settings.taa = QUALITY[app.qualityIndex].taa;
  post.settings.ev = app.look.ev; post.settings.bloom = app.look.bloom;
  fg = createFrameGraph(gpu, { terrain: tg, post, shadows: sh });
  app.fg = fg;
  fg.onModuleError = (m, what) => { ui.notice(`${m.label || m.name || m.role}: ${what} failed, the page goes on without it`); wireModules(); };
  fg.fallbacks.ground = await createFallbackGround(gpu);
  fg.fallbacks.sky = await createFallbackSky(gpu);
  resize();
  await loadModules();
}

// ── MODULES ─────────────────────────────────────────────────────────────
async function loadModules() {
  const results = await Promise.all(MODULES.map(async d => {
    try {
      const m = await import(d.url);
      const f = m[d.fn] || Object.values(m).find(v => typeof v === 'function' && /^create/.test(v.name));
      if (!f) throw new Error('no ' + d.fn);
      const mod = await f(gpu);
      if (!mod) throw new Error(d.fn + ' returned nothing');
      mod.role = d.role; mod.label = d.label; mod.name = mod.name || d.role;
      return mod;
    } catch (e) {
      // a module that is not there yet (404) is quiet; a broken one is named
      const missing = /Failed to fetch|Importing a module script failed|error loading dynamically imported module|Cannot find module|404/i.test(String(e && e.message));
      console.warn(`dla-terrain: ${d.url} ${missing ? 'is missing' : 'failed'}`, e);
      if (!missing) ui.notice(`${d.label} did not load: ${String(e && e.message || e).slice(0, 80)}`);
      return null;
    }
  }));
  fg.modules = results.filter(Boolean);
  wireModules();
  const ctx = fg.ctx();
  for (const m of fg.modules) {
    try { if (m.resize) m.resize(fg.w, fg.h, ctx); } catch (e) { console.warn(e); }
    try { if (tg.view && m.setTerrain) m.setTerrain(tg.view); } catch (e) { console.warn(e); }
  }
}

// cross-package wiring (NOTES.md): the sky haze replaces the ground's own
// aerial perspective, and the cloud shadow of the sky reaches the ground
function wireModules() {
  const sky = fg.modules.find(m => m.role === 'sky' && !m.failed);
  gpu.cloudShadow = sky && sky.cloudShadow ? sky.cloudShadow : null;
  gpu.skyView = sky && sky.skyView ? sky.skyView : null;
  // the sky haze replaces the own aerial perspective of ground and plants
  const aerial = !(sky && sky.drawVolumetric);
  for (const m of fg.modules) {
    if ((m.role === 'ground' || m.role === 'vegetation') && !m.failed && m.setAerial) {
      try { m.setAerial(aerial); } catch (e) { console.warn(e); }
    }
  }
}

function setTerrainAll(view) {
  for (const m of fg ? fg.modules : []) {
    if (m.failed || !m.setTerrain) continue;
    try { m.setTerrain(view); } catch (e) {
      console.warn(`dla-terrain: ${m.role} setTerrain failed`, e);
      m.failed = true; ui.notice(`${m.label}: setTerrain failed, the page goes on without it`);
    }
  }
}

// ── GENERATE ────────────────────────────────────────────────────────────
app.generate = () => {
  const id = ++genId;
  const o = { ...app.opts };
  const ws = o.worldSize || (o.worldKm ? o.worldKm * 1000 : 16000);
  const n = +(o.n || o.size || 1024);
  const firstOrNewSize = !app.gen || Math.abs((app.gen.ws || 0) - ws) > 1;
  app.gen = { id, running: true, t0: performance.now(), ws, n, stage: null, label: 'Starting' };
  app.terrain = null;
  app.genOpts = JSON.stringify(app.opts);
  // the sun follows the climate latitude of the terrain
  if (Number.isFinite(+o.latitude)) { app.latitude = clamp(Math.round(+o.latitude), -70, 70); ui.syncSky(); }
  if (tg) { const v = tg.begin({ n, worldSize: ws, heightScale: o.heightScale, seaLevel: 0 }); setTerrainAll(v); }
  ui.setProgress({ stage: 'dla', label: 'Growing DLA ridges', frac: 0 });
  if (firstOrNewSize && !app.saverRun) {
    // a three-quarter view into the range: close enough that the land
    // fills the frame and the haze, not the world edge, is the horizon
    cam.setMode('orbit', world); app.camMode = 'orbit';
    cam.frameWorld({ size: ws, midH: 0 }, FRAME_K);
    cam.orbit.pitch = FRAME_PITCH;
    ui.syncView();
  }
  if (worker) worker.postMessage({ type: 'generate', id, opts: o });
  else runInline(id, o);
};

async function runInline(id, o) {
  try {
    const t = await app.lib.generateTerrain(o, p => { if (id === genId) onWorker({ type: 'progress', id, ...p }); });
    if (id === genId) onWorker({ type: 'done', id, terrain: t });
  } catch (e) { onWorker({ type: 'error', id, message: String(e && e.message || e) }); }
}

function onWorker(m) {
  if (!m || m.id !== genId) return;
  if (m.type === 'progress') {
    app.gen.stage = m.stage; app.gen.label = m.label;
    ui.setProgress(m);
    if (m.snapshot) pendingSnap = { snap: m.snapshot, stage: m.stage, label: m.label };
    if (app.saverRun && m.stage !== app.saverRun.labelStage) { app.saverRun.labelStage = m.stage; saverLabel(); }
  } else if (m.type === 'done') {
    pendingSnap = null;
    const t = m.terrain;
    app.terrain = t;
    if (tg) setTerrainAll(tg.finish(t));
    app.gen.running = false;
    const ms = performance.now() - app.gen.t0;
    ui.progressDone(`Done in ${(ms / 1000).toFixed(1)} s`);
    ui.setTerrainMap({ ...t, worldSize: t.worldSize, stage: 'done' }, app.lib.BIOMES, t);
    app.drones = { ridge: 0, river: 0 };
    if (app.saverRun) { /* the saver owns the camera */ }
    else if (app.pendingCam) { applyCam(app.pendingCam); app.pendingCam = null; }
    else if (app.opening && performance.now() - app.lastInput > 4000) {
      // the first terrain of a visit: a golden-hour drone flight on a ridge
      app.drone('ridge', 0);
    } else if (app.camMode === 'drone' && cam.droneKind) app.drone(cam.droneKind);
    app.opening = false;
  } else if (m.type === 'error') {
    app.gen.running = false;
    ui.progressDone('Generation failed');
    ui.notice('The terrain generator failed: ' + m.message);
  }
}

function applySnapshot(now) {
  if (!pendingSnap || now - lastSnapAt < SNAP_MS) return;
  const p = pendingSnap; pendingSnap = null; lastSnapAt = now;
  if (tg) setTerrainAll(tg.snapshot(p.snap, p.stage));
  ui.setTerrainMap({ ...p.snap, worldSize: p.snap.worldSize || (tg ? tg.worldSize : 1), seaLevel: p.snap.seaLevel ?? (tg ? tg.seaLevel : 0), stage: p.label }, app.lib.BIOMES, null);
}

// ── sky state + Globals ─────────────────────────────────────────────────
function skyNow(dt) {
  app.skyT += dt * app.skySpeed;
  if (app.skyLib) {
    skyState = app.sky ? app.sky.update(app.tod, app.weatherId, app.season, app.latitude, app.skyT)
      : app.skyLib.skyState(app.tod, app.weatherId, app.season, app.latitude, app.skyT, skyState);
  } else {
    skyState = SkyStub.skyState(app.tod, app.weatherId, app.season, app.latitude, app.skyT);
  }
  return skyState;
}
function frameGlobals(m, st, dt) {
  const t = tg;
  packGlobals(G, {
    ...m, prevViewProj: prevVP || m.viewProjNoJitter, camPos: m.pos, time: performance.now() / 1000,
    sky: app.skyLib ? {} : st, exposure: post ? post.exposure : 1,
    terrain: t ? { worldSize: t.worldSize, heightScale: t.heightScale, seaLevel: t.seaLevel, n: t.n, minH: t.minH, maxH: t.maxH } : {},
    width: fg.w, height: fg.h, frame: frameNo, dt, quality: gpu.quality, coarse,
  });
  if (app.skyLib) app.skyLib.writeSkyGlobals(G, st);
  applyWxOver(G, app.wxOver);
}

// ── LOOP ────────────────────────────────────────────────────────────────
function resize() {
  if (!fg) return;
  const dpr = window.devicePixelRatio || 1;
  fg.resize(innerWidth, innerHeight, dpr);
  canvas.width = fg.outW; canvas.height = fg.outH;
}
addEventListener('resize', resize);

function loop(now) {
  requestAnimationFrame(loop);
  const dt = lastT ? clamp((now - lastT) / 1000, 0, 0.1) : 1 / 60;
  const ms = lastT ? now - lastT : 16;
  lastT = now;
  fpsAcc += ms; fpsN++;
  if (fpsAcc > 500) { fps = 1000 * fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const saving = saverTick(dt);
  if (!saving && app.playing) app.tod = (app.tod + todRate(app.todSpeed) * dt / 1440) % 1;
  // camera
  const inp = takeInput(dt);
  if (!saving && app.camMode === 'orbit' && app.gen && app.gen.running && now - app.lastInput > 2500) cam.orbit.yaw += dt * 0.035;
  cam.update(dt, inp, world);
  applySnapshot(now);
  if (!gpu) return;
  const st = skyNow(dt);
  // SKY's exposure hint caps the auto exposure, so a night stays dark
  if (post && st && Number.isFinite(st.exposureHint)) post.settings.maxExp = clamp(st.exposureHint * 1.5, 0.05, 40);
  // the lens and the saver band
  let shift = 0;
  if (app.saverRun) {
    const r = app.saverRun;
    let band = null;
    if (r.shell) {
      // the clear band of the shell plate (the last good one while it fades)
      let pb = null;
      try { pb = plateBand(innerHeight); } catch { pb = null; }
      if (pb) r.band = pb;
      band = r.band || { t: innerHeight * 0.24, b: innerHeight * 0.3 };
    }
    const fr = framing(innerWidth, innerHeight, band);
    cam.fovY = fr.fovY; shift = fr.shift;
  } else cam.fovY = app.look.fov * Math.PI / 180;
  const m = cam.matrices(fg.w, fg.h, { jitter: post.jitter(frameNo), shift: [0, shift] });
  frameGlobals(m, st, dt);
  // cascades: the sun (no shadows at night)
  const sd = [G[GLOBALS.sunDir.offset], G[GLOBALS.sunDir.offset + 1], G[GLOBALS.sunDir.offset + 2]];
  const far = Math.min(tg.worldSize * 0.8, [2500, 5000, 9000, 14000][app.qualityIndex]);
  if (sd[1] > -0.02) {
    let d = sd;
    if (d[1] < 0.035) { const h = Math.hypot(d[0], d[2]) || 1, k = Math.sqrt(1 - 0.035 * 0.035); d = [d[0] / h * k, 0.035, d[2] / h * k]; }
    const ws = tg.worldSize;
    sh.update(computeCascades(m, d, { count: sh.count, size: sh.size, far, bounds: { min: [-ws / 2, Math.min(tg.minH, tg.seaLevel) - 10, -ws / 2], max: [ws / 2, tg.maxH + 60, ws / 2] } }));
  } else sh.disable();
  gpu.queue.writeBuffer(gpu.globalsBuffer, 0, G);
  // layers: a whole module off when all its layers are off
  for (const md of fg.modules) {
    if (md.role === 'water') md.off = !app.layers.water;
    if (md.role === 'vegetation') md.off = !(app.layers.grass || app.layers.trees || app.layers.props);
  }
  const frame = {
    globals: G, g: GV, camera: m, time: now / 1000, dt, tod: app.tod, weather: st, sky: st,
    quality: gpu.quality, coarse, layers: app.layers, terrain: tg.view, frameIndex: frameNo,
    cascade: -1, shadowDistance: far, cloudShadow: gpu.cloudShadow || null, skyView: gpu.skyView || null,
    veg: app.veg, waterLook: app.water, season: app.season,
  };
  for (const md of fg.active()) if (md.update) {
    try { md.update(frame); } catch (e) { console.warn(`dla-terrain: ${md.role} update failed`, e); md.failed = true; ui.notice(`${md.label || md.role}: update failed`); }
  }
  try { fg.render(frame); } catch (e) { console.warn('dla-terrain: frame failed', e); }
  prevVP = m.viewProjNoJitter;
  frameNo++;
  if (!saving) fg.tick(ms);
  if (frameNo % 3 === 0) ui.drawMap(cam);
  if (frameNo % 15 === 0) statusLine(st);
}

function statusLine(st) {
  const t = tg;
  const stage = app.gen && app.gen.running ? ' · ' + (app.gen.label || app.gen.stage || '') : '';
  ui.status(
    `${fps.toFixed(0)} fps · ${fg.w}×${fg.h} · ${(t.worldSize / 1000).toFixed(0)} km · ${t.n}² · peak ${Math.round(t.maxH - Math.max(0, t.seaLevel))} m${stage}`,
    `${ui.todText(app.tod)} · ${(st && (st.label || st.weather)) || app.weatherId} · ${app.camMode}${app.libKind === 'stub' ? ' · stub terrain' : ''}`,
  );
  if (frameNo % 30 === 0) ui.syncSky(wxFromGlobals(G));
}

// ── INPUT ───────────────────────────────────────────────────────────────
const keys = new Set();
const ptrs = new Map();
let look = [0, 0], pan = [0, 0], zoom = 0, pinch = null, touchMove = [0, 0, 0];
function takeInput() {
  const k = c => (keys.has(c) ? 1 : 0);
  const move = [
    k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + touchMove[0],
    k('KeyE') + k('Space') - k('KeyQ') - k('KeyC') + touchMove[1],
    k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + touchMove[2],
  ].map(v => clamp(v, -1, 1));
  const out = { look, pan, zoom, move, boost: keys.has('ShiftLeft') || keys.has('ShiftRight') };
  look = [0, 0]; pan = [0, 0]; zoom = 0;
  if (move.some(v => v)) app.lastInput = performance.now();
  return out;
}
function leaveDrone() {
  if (app.camMode === 'drone') { cam.setMode('fly', world); app.camMode = 'fly'; ui.syncView(); }
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (app.saverRun) return;
  canvas.focus({ preventScroll: true });
  try { canvas.setPointerCapture(e.pointerId); } catch { /* old browser */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, x0: e.clientX, y0: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d0: Math.hypot(a.x - b.x, a.y - b.y), cx0: (a.x + b.x) / 2, cy0: (a.y + b.y) / 2 };
  }
  app.lastInput = performance.now();
  $('hint').classList.add('gone');
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  app.lastInput = performance.now();
  if (ptrs.size === 1) {
    if (Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) > 6) leaveDrone();
    if (app.camMode === 'orbit' && (p.b === 2 || p.shift)) { pan[0] += dx; pan[1] += dy; }
    else { look[0] += dx; look[1] += dy; }
  } else if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    leaveDrone();
    if (app.camMode === 'orbit') {
      zoom += Math.log(d / Math.max(1, pinch.d)) / Math.log(1 / 0.88);
      pan[0] += cx - pinch.cx; pan[1] += cy - pinch.cy;
    } else {
      // fly: a two-finger joystick (drag = strafe and climb, pinch = forward)
      touchMove = [clamp((cx - pinch.cx0) / 90, -1, 1), clamp(-(cy - pinch.cy0) / 90, -1, 1), clamp((d - pinch.d0) / 90, -1, 1)];
    }
    pinch.d = d; pinch.cx = cx; pinch.cy = cy;
  }
});
const endPtr = e => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) { pinch = null; touchMove = [0, 0, 0]; }
};
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (app.saverRun) return;
  const s = -e.deltaY / (e.deltaMode === 1 ? 3 : 100);
  if (app.camMode === 'orbit') zoom += s;
  else if (app.camMode === 'fly') { const f = cam.forward, k = s * 40 * Math.max(1, (cam.pos[1] - world.heightAt(cam.pos[0], cam.pos[2])) / 50); cam.fly.pos = cam.fly.pos.map((v, i) => v + f[i] * k); }
  app.lastInput = performance.now();
}, { passive: false });
addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (app.saverRun) { if (!app.saverRun.shell && (e.key === 'Escape' || e.code === 'KeyP')) { e.preventDefault(); saverExit(); } return; }
  keys.add(e.code);
  if (e.code === 'KeyF') app.setCam('fly');
  else if (e.code === 'KeyO') app.setCam('orbit');
  else if (e.code === 'KeyG') app.drone(cam.droneKind === 'ridge' ? 'river' : 'ridge');
  else if (e.code === 'KeyP') saverEnter({});
  else if (e.code === 'KeyT') app.setPlaying(!app.playing);
  else if (e.code === 'KeyN') app.generate();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) && app.camMode === 'drone') leaveDrone();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ── SAVER ───────────────────────────────────────────────────────────────
const codeCache = new Map();
function loadCode(kind) {
  const [file, fn, lang] = SHOT_CODE[kind] || SHOT_CODE.vista;
  const key = file + '#' + fn;
  if (codeCache.has(key)) return codeCache.get(key);
  codeCache.set(key, null);
  fetch(new URL(file, import.meta.url)).then(r => (r.ok ? r.text() : null)).then(src => {
    const text = extractFn(src, fn);
    if (text) codeCache.set(key, { lang, name: file, text });
    if (app.saverRun) saverLabel();
  }).catch(() => {});
  return null;
}
function saverLabel() {
  const r = app.saverRun;
  if (!r || !r.label) return;
  const wx = (app.skyLib ? app.skyLib.WEATHER : SkyStub.WEATHER).find(w => w.id === app.weatherId);
  const st = {
    preset: app.preset ? (app.lib.PRESETS[app.preset] || {}).label : 'random', seed: app.opts.seed,
    worldSize: tg ? tg.worldSize : 0, n: tg ? tg.n : 0, tod: app.tod, weather: wx ? wx.label : app.weatherId,
    stage: app.gen && app.gen.running ? app.gen.label : null,
  };
  try { r.label(shotLabel(r.shot, st, loadCode(r.shot.kind))); } catch (e) { console.warn(e); }
}
// a point on land for an orbit shot: high, low or any
function pickTarget(r, want) {
  const ws = tg.worldSize;
  let best = null, bh = want === 'low' ? Infinity : -Infinity;
  for (let i = 0; i < 40; i++) {
    const x = (r() - 0.5) * ws * 0.6, z = (r() - 0.5) * ws * 0.6, h = tg.heightAt(x, z);
    if (h < tg.seaLevel + 5) continue;
    if (!best || (want === 'high' ? h > bh : want === 'low' ? h < bh : true)) { best = [x, h, z]; bh = h; if (want === 'any') break; }
  }
  return best || [0, world.midH, 0];
}
function startShot(i) {
  const r0 = app.saverRun;
  const shot = r0.plan[i % r0.plan.length];
  r0.i = i; r0.shot = shot; r0.t = 0; r0.stormed = false;
  app.tod = shot.tod; app.season = shot.season; app.wxOver = {};
  app.skySpeed = 1;
  app.setWeather(shot.weather, true);
  const r = mulberry(shot.seed);
  if (shot.regen || !tg.view || !tg.cpuHeight) {
    const ids = Object.keys(app.lib.PRESETS);
    const pid = ids[Math.floor(r() * ids.length)];
    app.preset = pid;
    app.opts = { ...app.lib.defaults(), ...app.lib.PRESETS[pid].opts, seed: shot.seed, n: coarse ? 512 : 1024 };
    app.generate();
  }
  const fr = framing(innerWidth, innerHeight, null);
  const ws = tg.worldSize;
  const c = shot.cam;
  let done = false;
  if (c.type === 'drone' && app.terrain) {
    const list = c.path === 'river' ? app.terrain.rivers : app.terrain.ridges;
    if (list && list.length) {
      const sorted = list.slice().sort((a, b) => b.pts.length - a.pts.length).slice(0, 6);
      const pick = sorted[Math.floor(c.pick * sorted.length)];
      // a river flight looks over the banks: a wide window for the height
      cam.drone = dronePath(pick.pts, world, { clearance: c.clearance + (c.path === 'river' ? 35 : 0), reverse: c.reverse, lookAhead: 520, lookDown: c.path === 'river' ? 70 : 80, spacing: 70, window: c.path === 'river' ? 400 : 300, side: c.path === 'river' ? 420 : 0, sideK: 0.8 });
      cam.droneS = Math.min(cam.drone.len * 0.15, cam.drone.len * 0.5 * r());
      cam.droneSpeed = c.speed; cam.mode = 'drone'; app.camMode = 'drone';
      done = true;
    }
  }
  if (!done) {
    cam.mode = 'orbit'; app.camMode = 'orbit'; cam.orbitGoal = null;
    const want = shot.kind === 'snow' ? 'high' : shot.kind === 'sunrise' ? 'low' : 'any';
    const tgt = shot.regen ? [0, world.midH, 0] : pickTarget(r, want);
    const cc = c.type === 'orbit' ? c : { distK: 0.4, pitch: -0.3, yaw: r() * 6.28, yawRate: 0.02 };
    cam.orbit = { target: tgt, yaw: cc.yaw, pitch: cc.pitch, dist: cc.distK * ws * fr.distK * (shot.regen ? 1 : 0.6) };
    r0.yawRate = cc.yawRate;
  } else r0.yawRate = 0;
  cam.update(1, {}, world);
  if (post) post.resetHistory();
  saverLabel();
}
function saverTick(dt) {
  const r = app.saverRun;
  if (!r) return false;
  r.t += dt;
  const shot = r.shot;
  app.tod = shotTod(shot, r.t) % 1;
  if (shot.weatherEnd && !r.stormed && r.t > 1.2) { r.stormed = true; app.skySpeed = shot.skySpeed || 1; app.weatherId = shot.weatherEnd; }
  if (r.yawRate && cam.mode === 'orbit') cam.orbit.yaw += r.yawRate * dt * (r.calm ? 0.7 : 1);
  let dur = shot.dur;
  if (shot.regen && app.gen && app.gen.running) dur = Math.max(dur, Math.min(r.t + 1, 12));
  if (r.t >= dur) startShot(r.i + 1);
  return true;
}
function saverEnter(opts = {}) {
  if (app.saverRun) saverExit();
  const shell = typeof opts.label === 'function';
  const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
  app.saverRun = {
    shell, label: shell ? opts.label : null, seed, calm: opts.calm ?? 0.7, plan: buildShotPlan(seed, 24), i: 0, t: 0, band: null,
    saved: {
      tod: app.tod, playing: app.playing, weatherId: app.weatherId, season: app.season, wxOver: { ...app.wxOver },
      camMode: app.camMode, orbit: JSON.parse(JSON.stringify(cam.orbit)), fly: JSON.parse(JSON.stringify(cam.fly)),
      opts: { ...app.opts }, preset: app.preset, fov: cam.fovY,
    },
  };
  root.classList.add(shell ? 'sn-saver' : 'dt-saver');
  if (!shell && document.fullscreenEnabled && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
  if (!shell) addEventListener('pointerdown', saverPointer, true);
  startShot(0);
  return { canvas, warmupMs: 3500 };
}
function saverPointer(e) {
  if (!app.saverRun || app.saverRun.shell) return;
  e.preventDefault(); e.stopPropagation();
  saverExit();
}
function saverExit() {
  const r = app.saverRun;
  if (!r) return;
  app.saverRun = null;
  root.classList.remove('sn-saver', 'dt-saver');
  removeEventListener('pointerdown', saverPointer, true);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (r.label) try { r.label(null); } catch { /* the shell is gone */ }
  const s = r.saved;
  Object.assign(app, { tod: s.tod, playing: s.playing, season: s.season, wxOver: s.wxOver, skySpeed: 1 });
  app.setWeather(s.weatherId, true);
  cam.orbit = s.orbit; cam.fly = s.fly; cam.mode = s.camMode === 'drone' ? 'orbit' : s.camMode; app.camMode = cam.mode;
  cam.fovY = s.fov;
  if (JSON.stringify(s.opts) !== JSON.stringify(app.opts)) { app.opts = s.opts; app.preset = s.preset; ui.syncOptions(); app.generate(); }
  if (post) post.resetHistory();
  ui.syncView(); ui.syncSky();
}
window.snSaver = { enter: opts => saverEnter(opts || {}), exit: () => saverExit() };
$('saverBtn').addEventListener('click', () => saverEnter({}));
$('dockSaver').addEventListener('click', () => saverEnter({}));

// ── WORLD: the state of world-state.js, the hash, the camera shots ───────
function weatherList() { return app.skyLib ? app.skyLib.WEATHER : SkyStub.WEATHER; }
function rollCtx() {
  return {
    solarPosition: app.skyLib && app.skyLib.solarPosition, latitude: app.latitude,
    weatherIds: weatherList().map(w => w.id), coarse,
  };
}
function worldNow() {
  return {
    opts: { ...app.opts }, preset: app.preset, tod: app.tod, playing: app.playing, weather: app.weatherId,
    season: app.season, veg: { ...app.veg }, water: { ...app.water }, cam: app.camShot,
  };
}
// the camera as a shot of world-state.js
function camNow() {
  const ws = world.size;
  if (app.camMode === 'drone' && app.dronePick) return { kind: 'drone', ...app.dronePick };
  if (app.camMode === 'fly') {
    const f = cam.fly;
    return { kind: 'fly', x: Math.round(f.pos[0]), y: Math.round(f.pos[1]), z: Math.round(f.pos[2]), yaw: +f.yaw.toFixed(3), pitch: +f.pitch.toFixed(3) };
  }
  const o = cam.orbit;
  return { kind: 'orbit', yaw: +(((o.yaw % 6.2832) + 6.2832) % 6.2832).toFixed(3), pitch: +o.pitch.toFixed(3), distK: +(o.dist / ws).toFixed(3), tx: +(o.target[0] / ws).toFixed(3), tz: +(o.target[2] / ws).toFixed(3) };
}
function applyCam(c) {
  if (!c || !tg) return;
  const ws = world.size;
  if (c.kind === 'drone') { app.drone(c.path, c.pick); return; }
  if (c.kind === 'fly') {
    cam.setMode('fly', world); app.camMode = 'fly';
    cam.fly.pos = [c.x, c.y, c.z]; cam.fly.yaw = c.yaw; cam.fly.pitch = c.pitch;
  } else {
    cam.setMode('orbit', world); app.camMode = 'orbit'; cam.orbitGoal = null;
    const x = c.tx * ws, z = c.tz * ws;
    cam.orbit = { target: [x, Math.max(world.heightAt(x, z), world.seaLevel), z], yaw: c.yaw, pitch: c.pitch, dist: c.distK * ws };
  }
  if (post) post.resetHistory();
  ui.syncView();
}
// apply a world: regenerate only when the terrain options changed
function applyWorld(w, o = {}) {
  const regen = o.generate !== false && JSON.stringify(w.opts) !== app.genOpts;
  app.opts = { ...w.opts }; app.preset = w.preset ?? null;
  if (coarse && app.opts.n > 1024) app.opts.n = 1024;
  app.tod = w.tod; app.playing = w.playing !== false; app.season = w.season;
  app.veg = { ...VEG0, ...(w.veg || {}) }; app.water = { ...WATER0, ...(w.water || {}) };
  app.wxOver = {};
  if (weatherList().some(x => x.id === w.weather)) app.weatherId = w.weather;
  app.camShot = w.cam || null;
  if (ui) { ui.syncOptions(); ui.syncSky(); ui.syncMix(); }
  if (w.cam) app.pendingCam = w.cam;
  if (regen && booted) app.generate();
  else if (w.cam && app.terrain) { applyCam(w.cam); app.pendingCam = null; }
  if (o.hash !== undefined) { app.lastHash = o.hash; try { history.replaceState(null, '', o.hash); } catch { /* file: url */ } ui && ui.syncHistory(); }
  else writeHash(!!o.push);
}
let hashT = 0;
function writeHash(push) {
  if (app.saverRun) return;
  clearTimeout(hashT);
  const h = encodeHash(worldNow(), app.lib);
  if (h === app.lastHash && !push) return;
  app.lastHash = h;
  try { history[push ? 'pushState' : 'replaceState'](null, '', h); } catch { /* file: url or sandbox */ }
  if (push) app.hist.push(h); else if (booted) app.hist.replace(h);
  ui && ui.syncHistory();
}
function hashSoon() { clearTimeout(hashT); hashT = setTimeout(() => writeHash(false), 450); }
function onHash() {
  if (location.hash === app.lastHash) return;
  const w = decodeHash(location.hash, app.lib);
  if (!w) return;
  app.hist.push(location.hash);
  applyWorld({ ...worldNow(), ...w }, { push: false, hash: location.hash });
}

// ── LOSS ────────────────────────────────────────────────────────────────
let losses = 0;
async function onLost(info) {
  if (!info || info.reason === 'destroyed') return;   // lib/gpu-guard.js release
  console.warn('dla-terrain: device lost', info.message);
  if (++losses > 3) { ui.notice('The GPU stopped too often; reload the page'); return; }
  gpu = null;
  try {
    await bootGPU();
    if (app.terrain) setTerrainAll(tg.finish(app.terrain));
    ui.toast('The GPU restarted');
  } catch (e) { console.warn(e); }
}

// ── start ──
async function main() {
  ui = createUI(app);
  await loadLib();
  initialOptions();
  if (!location.hash && !Q.has('tod') && app.skyLib && app.skyLib.solarPosition) {
    // golden hour: the sun 3 degrees over the horizon in the morning, so the
    // valley fog is still there and the light warms the ridges
    const lat = Number.isFinite(+app.opts.latitude) ? clamp(Math.round(+app.opts.latitude), -70, 70) : app.latitude;
    const t = todForElevation(3, true, app.season, lat, app.skyLib.solarPosition);
    if (t !== null) app.tod = t;
  }
  ui.buildOptions(app.lib);
  ui.buildWeather(app.skyLib ? app.skyLib.WEATHER : SkyStub.WEATHER);
  if (!(app.skyLib ? app.skyLib.WEATHER : SkyStub.WEATHER).some(w => w.id === app.weatherId)) app.weatherId = 'fair';
  ui.buildQuality(QUALITY);
  if (Q.get('cam') === 'fly') { cam.setMode('fly', world); app.camMode = 'fly'; }
  ui.syncSky(); ui.syncView(); ui.syncMix(); ui.syncLocks();
  addEventListener('hashchange', onHash);
  if (app.libKind === 'stub') ui.notice('lib/dla-terrain.js is not there yet: a plain noise terrain stands in');
  try {
    await bootGPU();
  } catch (e) {
    console.warn('dla-terrain: no WebGPU', e);
    $('nogpu').hidden = false;
  }
  await makeWorker();
  booted = true;
  app.generate();
  writeHash(false);
  app.hist.push(app.lastHash);
  ui.syncHistory();
  if (Q.get('cam') === 'drone') setTimeout(() => app.drone('ridge'), 4000);
  requestAnimationFrame(loop);
}
main();

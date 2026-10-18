// ============================================================================
//  CORAL REEF  ·  main script, v4: the infinite seafloor and the ROV squad
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "i want to reimagine the coral reef
//  exploration region with the ROV's as an infinite procedurally generated
//  seafloor/seamount terrain that is explored constantly by the ROV squad.
//  we shouldn't grow corals, they should just grow once adn be there".
//  CONTRACT-V4.md is the spec. This script binds:
//    world .... world/field.js (the seeded field, also the solid for the
//               ROVs and the camera on this thread), world/stream.js (the
//               chunks round the eye: rock and sand by LOD, corals grown to
//               the end in workers, fine meshes for the focus colonies),
//               world/pool.js (module workers of world/worker.js)
//    view ..... the streamer view (grep 'const view = {'): chunks into
//               scene.js (worldRoot), coral data texels (world/coral-data.js)
//    squad .... rov/squad.js explores for ever; rov/index.js draws the
//               vehicles, lamps, wash and the SSTV feed from its states
//    camera ... camera.js (follow the lead ROV by default; orbit, swim,
//               tours) and input.js; lib/tilt.js turns the render eye with
//               the phone tilt (the camera state does not change)
//  and the controls (shell.js, layout.js).
//
//  FLOATING ORIGIN. All logic is in world metres. three.js gets render
//  space = world - O: scene.js worldRoot and rovRoot sit at -O, and the
//  camera at eye - O. O moves (1024 m steps) when the eye is 4 km from it.
//
//  NO GROWTH. The corals of a chunk show only when the chunk result has
//  every colony grown; every texel has a birth far in the past (world/
//  coral-data.js BIRTH_PAST), so the shaders draw no grow-in.
//
//  PROFILE. budget.js picks a device profile; WORLD_BUDGET (world/stream.js)
//  has the rings, coral budgets and workers of each. "World detail" picks
//  a lower one. With no module worker the world runs on this thread with
//  the phone-min budget.
//
//  GREP MAP
//    grep -n 'function buildWorld'    the streamer, the squad and the ROVs
//    grep -n 'const view = {'         the streamer view
//    grep -n 'function buildROVs'     the vehicles, lamps and the feed card
//    grep -n 'function presentFeed'   the live feed into the canvas at the card
//    grep -n 'function camUI'         the camera bar, the tours, the feed card taps
//    grep -n 'function followDefault' the default camera: follow the lead ROV
//    grep -n 'function setMode'       colour by
//    grep -n 'function applyCamera'   the render eye (origin, tilt)
//    grep -n 'function frame'         the loop
//    grep -n 'window.snSaver'         the screensaver: the squad explores
// ============================================================================
import { createScene } from './scene.js';
import { SPECIES, bleachLevel } from './reef.js';
import { MODES } from './colour.js';
import { SHAPES } from './coral-sdf.js';
import { createROVs } from './rov/index.js';
import { createSquad, frontierScore } from './rov/squad.js';
import { squadPlan, squadShotPose, safeCamera, cardRect, frameFit } from './saver.js';
import { lut, cssGradient, mountGradientPicker } from '../../lib/growth-gradients.js';
import { mountDiagram } from './diagram.js';
import { PHONE_QUERY, clearFromRects, pixelRatio } from './layout.js';
import { createPanel } from '../../lib/sn-panel.js';
import { mountShell } from './shell.js';
import { createExploreCamera } from './camera.js';
import { createInput } from './input.js';
import { PROFILES, PROFILE_ORDER, detectProfile, pageEnv, profileFor, pixelRatioFor, lostPolicy, frameGovernor } from './budget.js';
import { mountErrorBox, installErrorHandlers } from './crash.js';
import { createWorld } from './world/field.js';
import { createStreamer, WORLD_BUDGET, fineFor } from './world/stream.js';
import { createPool } from './world/pool.js';
import { worldPhysics } from './world/physics.js';
import { chunkMirror, chunkColours, writeChunk, writeHidden } from './world/coral-data.js';
import { tiltEye } from '../../lib/tilt.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia(PHONE_QUERY);
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const T0 = performance.now();
const SQUAD_CLEAR = 0.62;             // the ROV clearance (field units: about 1.5 m true)
const DEPTH_BASE = 320;               // HUD depth = DEPTH_BASE - y (m)
const ORIGIN_STEP = 1024, ORIGIN_MOVE = 4096;
const DETAIL_LABEL = { desktop: 'High', 'laptop-low': 'Medium', phone: 'Low', 'phone-min': 'Lowest' };

const box = mountErrorBox(document);
installErrorHandlers(window, box);
const SS = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* no storage */ } return null; };
const URLQ = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
const BASE_PROFILE = PROFILES[URLQ.get('profile')] ? URLQ.get('profile') : detectProfile(pageEnv());
const LOWERED = SS('coral-reef-profile');
const PROFILE_ID = PROFILES[LOWERED] && PROFILE_ORDER.indexOf(LOWERED) > PROFILE_ORDER.indexOf(BASE_PROFILE) ? LOWERED : BASE_PROFILE;
const PROF = profileFor(PROFILE_ID);
const reloadPage = () => (window.__coralReload || (() => location.reload()))();
const HAS_WORKER = typeof Worker === 'function';
let workersFailed = false, fallbackWhy = '';   // a world worker failed once: the main thread from then on

const G = {
  seed: 1, rovs: Math.min(4, Math.max(2, PROF.rovs)), sstv: 'r36', detail: HAS_WORKER ? PROFILE_ID : 'phone-min',
  mode: 'natural', gradient: 'reef', rev: false, dir: 20, cur: 0.5, temp: 27,
  caust: 0.5, beam: true, snow: true, feed: true, orbit: false, polyps: true, surface: !COARSE,
  feedMode: 'live',
};
let shell = null, saverOn = false, saver = null;

// ── scene ───────────────────────────────────────────────────────────────────
const canvas = $('view');
const WB_MAX = WORLD_BUDGET[PROFILE_ID] || WORLD_BUDGET.desktop;
const S = createScene({
  canvas, coarse: COARSE, R: 30, profile: PROF, maxParticles: WB_MAX.maxCoral * WB_MAX.coral.particles + 512,
  onNoGL: () => { $('nogl').hidden = false; },
  onShaderError: text => box.show({ title: 'A shader did not compile on this GPU', text: `${text}\n\nPlease report this text (the Copy button).` }),
});
let rovRoot = null;
if (S) {
  S.setWorldMode(true);
  S.setPolypSizes(SHAPES);
  rovRoot = new S.THREE.Group(); rovRoot.name = 'rovs'; S.scene.add(rovRoot);
  // the camera hangs in a rig out of the scene: lib/tilt.js then leaves it
  // alone (the page turns the render eye itself, applyCamera)
  const rig = new S.THREE.Group(); rig.add(S.camera);
  S.controls.enabled = false; S.controls.autoRotate = false;
}
let lostNow = false;
if (S) canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); onContextLost(); }, false);
function onContextLost() {
  if (lostNow) return;
  lostNow = true;
  let st = null; try { st = JSON.parse(SS('coral-reef-lost') || 'null'); } catch (e) { st = null; }
  const pol = lostPolicy(st, PROFILE_ID);
  SS('coral-reef-lost', JSON.stringify(pol.state));
  if (pool) pool.dispose();
  if (pol.action === 'reload') {
    SS('coral-reef-profile', pol.profile);
    box.show({ title: 'The GPU context was lost', text: `The page restarts with the ${PROFILES[pol.profile].label} profile (less memory).`, level: 'note' });
    setTimeout(reloadPage, 1500);
  } else {
    box.show({ title: 'The GPU context was lost again', text: 'The dive stopped, so the page does not restart in a loop. Reload the page to try again.' });
  }
}
const nowMs = () => performance.now() - T0;
const cam = S ? createExploreCamera({ R: Infinity, maxDist: 120, fov: S.camera.fov, eye: [0, 10, 12], look: [0, 0, 0] }) : null;
let input = null, camChoice = null;

// ── the world ───────────────────────────────────────────────────────────────
let W = null, pool = null, streamer = null, P = null, squad = null, rovs = null, WB = null;
let origin = [0, 0], worldGen = 0, worldReady = false;
const coral = new Map();           // chunk key -> { co, M, T, hidden: Set of k }
const fineK = new Map();           // fine key -> { chunk, k }

// The streamer view: the finished chunk results into scene.js, and the
// data texels of the coral slabs. Each add returns its bytes.
const view = {
  addRock(key, pos, r) { return S ? S.addWorldRock(key, pos, r) : 0; },
  removeRock(key) { if (S) S.removeWorldRock(key); },
  addCoral(key, co) {
    const M = chunkMirror(co), T = chunkColours(co, M, G.mode);
    const rec = { co, M, T, hidden: new Set() };
    coral.set(key, rec);
    if (!S) return 0;
    writeChunk(S.setParticles, co, M, T, rec.hidden);
    S.uploadParticles(nowMs(), true);           // the texels and the meshes in one frame
    const b = S.addWorldCoral(key, co);
    return b + M.count * 40;
  },
  removeCoral(key) { coral.delete(key); if (S) S.removeWorldCoral(key); },
  addFine(fkey, chunk, k, m) {
    const rec = coral.get(chunk); if (!rec || !S) return 0;
    const b = S.addWorldFine(fkey, rec.co, m);
    // the fine mesh shows and the coarse part of colony k hides in one frame
    rec.hidden.add(k);
    writeHidden(S.setParticles, rec.co, rec.M, rec.T, k, true);
    S.uploadParticles(nowMs(), true);
    fineK.set(fkey, { chunk, k });
    return b;
  },
  removeFine(fkey, chunk, k) {
    const rec = coral.get(chunk);
    // the coarse part shows first; the fine group goes after one more render
    if (rec && S) { rec.hidden.delete(k); writeHidden(S.setParticles, rec.co, rec.M, rec.T, k, false); S.uploadParticles(nowMs(), true); }
    if (S) S.removeWorldFine(fkey);
    fineK.delete(fkey);
  },
};

// A start with corals: the richest habitat on a grid round the origin of
// this seed (the same seed, the same start).
function findStart(Wd) {
  let best = null;
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
    const x = i * 64 + 16, z = j * 64 + 16, g = Wd.ground(x, z);
    if (g < -40) continue;
    const s = Wd.habitat(x, z) - Math.hypot(i, j) * 0.02;
    if (!best || s > best.s) best = { s, x, z, g };
  }
  if (!best) best = { x: 16, z: 16, g: Wd.ground(16, 16) };
  return [best.x, best.g + 3.5, best.z];
}
function setOrigin(x, z) {
  origin = [Math.round(x / ORIGIN_STEP) * ORIGIN_STEP, Math.round(z / ORIGIN_STEP) * ORIGIN_STEP];
  if (S) S.setOrigin(origin[0], origin[1]);
  if (rovRoot) { rovRoot.position.set(-origin[0], 0, -origin[1]); rovRoot.updateMatrixWorld(true); }
}
function stopWorld() {
  if (rovs) { try { rovs.dispose(); } catch (e) { /* half built */ } rovs = null; }
  if (streamer) streamer.dispose();
  if (pool) pool.dispose();
  streamer = null; pool = null; squad = null;
  coral.clear(); fineK.clear();
  if (S) { S.clearWorld(); S.setLights([]); }
}
function makePool(budget) {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return createPool({
    size: Math.max(1, Math.min(budget.workers, hc - 1)),
    makeWorker: HAS_WORKER && !workersFailed ? () => new Worker(new URL('./world/worker.js', import.meta.url), { type: 'module' }) : null,
    onFallback: why => {
      console.warn('coral-reef: ' + why);
      workersFailed = true; fallbackWhy = why;
      if (G.detail === 'phone-min') return;
      box.show({ title: 'The world runs on the main thread', text: `${why}. The page builds a smaller world (the lowest detail).`, level: 'note' });
      G.detail = 'phone-min';
      setTimeout(() => buildWorld({ keepSquad: true }), 0);
    },
  });
}
async function buildWorld({ seed = G.seed, keepSquad = false } = {}) {
  const my = ++worldGen;
  worldReady = false;
  const lead = keepSquad && squad ? squad.vehicles[0].state.p.slice() : null;
  stopWorld();
  if (!keepSquad) camChoice = null;
  G.seed = seed;
  WB = WORLD_BUDGET[G.detail] || WORLD_BUDGET['phone-min'];
  setState('Building the seafloor…');
  W = createWorld({ seed, fine: fineFor(WB.c0) });
  const start = lead || findStart(W);
  setOrigin(start[0], start[2]);
  pool = makePool(WB);
  streamer = createStreamer({ seed, budget: WB, pool, view, now: nowMs });
  P = worldPhysics(W, streamer, { clear: SQUAD_CLEAR, eye: () => (cam ? cam.eye : start) });
  squad = createSquad({ field: P, seed, count: G.rovs, clear: SQUAD_CLEAR, start });
  if (cam) {
    cam.setRock(P, Infinity);
    const L = squad.vehicles[0].state;
    cam.setMode('orbit', { force: true });
    cam.frame({ target: L.p.slice(), dist: 6, yaw: L.yaw + Math.PI, pitch: 0.35, snap: true });
  }
  streamer.update(start, [start]);
  buildTourUI();
  await new Promise(r => setTimeout(r, PROF.stagger.rovMs));
  if (my !== worldGen) return;
  buildROVs();
  worldReady = true;
}
function setState(msg) { const el = $('rState'); if (el) el.textContent = msg; }
let flashT = 0;
function flash(msg) { setState(msg); flashT = performance.now() + 2600; }

// ── the ROVs ────────────────────────────────────────────────────────────────
// The squad states drive the models (rov/index.js pilots). The main lamps
// get the shadow maps: the lead lamp first (scene.js setLights).
function buildROVs() {
  if (!S || !squad) return;
  if (rovs) { try { rovs.dispose(); } catch (e) { /* a half-built set */ } rovs = null; }
  try {
    rovs = createROVs(S.THREE, {
      scene: S.scene, root: rovRoot, renderer: S.renderer, rock: P, sdf: P.sdf, reef: null, tether: false,
      pilots: squad.vehicles.map(v => v.state), seed: G.seed, quality: PROFILE_ID === 'desktop' ? 'high' : 'low', profile: PROF,
      origin: () => origin, depthBase: DEPTH_BASE,
      feed: { mode: G.sstv, document, dpr: Math.min(2, devicePixelRatio || 1), size: PROF.feed },
    });
  } catch (e) { console.error('coral-reef: no ROVs', e); rovs = null; }
  if (!rovs) { S.setLights([]); return; }
  const V = rovs.vehicles || [];
  const first = V.map(v => v.lights && v.lights[0]).filter(Boolean);
  const rest = V.flatMap(v => (v.lights || []).slice(1));
  S.setLights([...first, ...rest], first.length);
  const slot = $('feedSlot');
  if (slot && rovs.feed && rovs.feed.canvas) { slot.innerHTML = ''; slot.appendChild(rovs.feed.canvas); }
  applyFeedMode();
  showFeed();
  followDefault();
}
// The default view: the chase camera behind the lead ROV.
function followDefault() {
  if (!cam || saverOn || camChoice || !rovs || !rovs.vehicles || !rovs.vehicles.length) return false;
  const id = rovs.vehicles[0].id;
  if (cam.mode !== 'follow' || cam.followId !== id) cam.follow(id, { snap: true });
  camUI();
  return true;
}
function showFeed() {
  const f = $('feed'); if (!f) return;
  f.hidden = !(G.feed && rovs && rovs.feed && rovs.feed.canvas);
  feedT = 0;
}
const feedModeId = () => (G.feedMode === 'sstv' ? G.sstv : G.feedMode);
function applyFeedMode() {
  syncFeedUI();
  if (rovs && rovs.feed && rovs.feed.setMode) rovs.feed.setMode(feedModeId());
  feedT = 0;
}
let feedRect = null, feedOp = 0, feedT = 0;
function presentFeed() {
  const fd = rovs && rovs.feed;
  if (!fd || !fd.present) return;
  if ((feedT++ % 10) === 0) {
    const f = $('feed'), c = fd.canvas;
    const vis = !!(G.feed && f && !f.hidden && c && c.isConnected);
    feedRect = null; feedOp = 0;
    if (vis) {
      feedOp = parseFloat(getComputedStyle(f).opacity);
      if (!(feedOp >= 0)) feedOp = 1;
      const r = c.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      feedRect = fd.pictureRect({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height });
    }
    fd.setActive(vis && feedOp > 0.01);
    if (f) f.classList.toggle('live', !!fd.live);
  }
  if (fd.live && feedRect) fd.present(feedRect, feedOp);
}
function nextFeed() {
  if (!rovs || !rovs.feed || !rovs.vehicles.length) return;
  const V = rovs.vehicles, v = V[(V.findIndex(x => x.id === rovs.feed.vehicle) + 1) % V.length];
  rovs.feed.setVehicle(v.id);
  flash(`Camera feed: ROV ${v.id}`);
  if (shell) shell.setDock({ feed: `ROV ${v.id}` });
}

// ── colour ──────────────────────────────────────────────────────────────────
const LEG = {
  age: ['Age (order of joining)', 'old', 'new'], depth: ['Depth (hops to the seed)', 'seed', 'tips'], height: ['Height over the base', 'low', 'high'],
  flow: ['Flow (subtree size)', 'tips', 'trunk'], light: ['Light and nutrient exposure', 'shaded', 'open'],
};
const MODE_NOTE = {
  natural: '',
  age: 'The order in which the particles joined, in each chunk: the old core at the cold end, the last tips at the hot end.',
  depth: 'Hops from the seed, per colony.',
  height: 'Height over the colony base (the same scale everywhere).',
  flow: 'The size of the subtree that a particle feeds: the trunks carry the most.',
  light: 'An estimate: high particles with few close neighbours get the most light and food.',
  colony: 'One colour per colony, from the gradient.',
};
function setGradient(id, rev) {
  G.gradient = id; G.rev = !!rev;
  if (S) S.setLut(lut(id, 256, G.rev));
  drawLegend();
}
function recolour() {
  if (!S) return;
  for (const rec of coral.values()) { rec.T = chunkColours(rec.co, rec.M, G.mode, rec.T.F); writeChunk(S.setParticles, rec.co, rec.M, rec.T, rec.hidden); }
  S.uploadParticles(nowMs(), true);
}
function setMode(m) {
  G.mode = m;
  // every mode but natural reads t from the texels (age too: the order in the chunk)
  if (S) S.U.uMode.value = m === 'natural' ? 0 : 2;
  recolour();
  syncLookUI();
  $('modeNote').textContent = MODE_NOTE[m] || '';
  if (shell) shell.setDock({ mode: (MODES.find(q => q.id === m) || MODES[0]).label });
  drawLegend();
}
function drawLegend() {
  const L = LEG[G.mode];
  $('legend').classList.toggle('off', !L);
  if (!L) return;
  $('lgTitle').textContent = L[0]; $('lgLo').textContent = L[1]; $('lgHi').textContent = L[2];
  $('lgBar').style.background = cssGradient(G.gradient, G.rev);
}

// ── water ───────────────────────────────────────────────────────────────────
function setCurrent() { if (S) S.U.uCur.value.set(Math.cos(G.dir * Math.PI / 180) * G.cur, Math.sin(G.dir * Math.PI / 180) * G.cur); }
function setTemp(t) { G.temp = t; if (S) S.U.uBleach.value = bleachLevel(t); }

// ── framing ─────────────────────────────────────────────────────────────────
function clearArea(w, h) {
  const rects = [];
  for (const el of [$('panel'), $('dock')]) {
    if (!el || el.hidden || getComputedStyle(el).display === 'none') continue;
    const q = el.getBoundingClientRect();
    rects.push({ x0: q.left, y0: q.top, x1: q.right, y1: q.bottom });
  }
  const o = clearFromRects(rects, w, h);
  if (saverOn && saver && saver.band) { o.t = Math.max(o.t, saver.band.t); o.b = Math.max(o.b, saver.band.b); }
  if (saverOn && saver && saver.card) { if (w >= h) o.r = Math.max(o.r, saver.card.w + 24); else o.b = Math.max(o.b, saver.card.h + 16 + (saver.band ? saver.band.b : 0)); }
  return o;
}
function fitNow(radius = 1) {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  return frameFit({ w, h, clear: clearArea(w, h), fov: S ? S.camera.fov : 50, radius });
}

// ── UI ──────────────────────────────────────────────────────────────────────
// lib/sn-panel.js makes every control (one look, labels tied to inputs,
// collapsible sections that remember their state). The other packages add
// their controls here through the panel API, not by hand (NOTES.md).
//   Explore ... region, squad size, follow the lead
//   View ...... the camera feed (show, signal, slow-scan mode), slow orbit
//   Look ...... colour by, gradient, lamps, snow, polyps, detail, caustics
//   World ..... detail level, new world, the water (current, temperature)
//   About ..... a short text, How it works, the credit
// The camera modes are the #camBar toolbar over the view (not in the panel).
function hideHint() { $('hint').classList.add('gone'); }
const fmt = (v, d = 2) => (+v).toFixed(d);
let panel = null;
const FEED_MODES = [
  { id: 'live', label: 'Live', title: 'Live video' },
  { id: 'r8', label: 'Fast scan', title: 'Slow-scan TV, Robot 8, black and white' },
  { id: 'sstv', label: 'Slow scan', title: 'Slow-scan TV in colour' },
];
// The feed rows follow the feed state; the slow-scan mode shows only for slow scan.
function syncFeedUI() {
  if (!panel) return;
  const fm = panel.find('feedMode'), ss = panel.find('sstvMode'), tf = panel.find('tFeed');
  if (tf) tf.set(G.feed);
  if (fm) { fm.set(G.feedMode); fm.el.hidden = !G.feed; }
  if (ss) { ss.set(G.sstv); ss.el.hidden = !G.feed || G.feedMode !== 'sstv'; }
}
// The gradient applies to every mode but Natural, so it hides for Natural.
function syncLookUI() {
  if (!panel) return;
  const m = panel.find('modes'), g = panel.find('gradPick');
  if (m) m.set(G.mode);
  if (g) g.el.hidden = G.mode === 'natural';
}
function bleachMsg(t) {
  const b = bleachLevel(t);
  return b > 0.98 ? 'Bleached: the corals lost their colour. Cool the water to see it again.' : b > 0.02 ? `Bleaching: the colour fades (${Math.round(b * 100)} %).` : '';
}
function newWorld() { buildWorld({ seed: 1 + Math.floor(Math.random() * 1e6) }).catch(worldError); flash('A new world: the squad starts a new dive.'); }
function cycleCam() {
  if (!cam) return;
  const order = ['follow', 'orbit', 'swim'], i = order.indexOf(cam.mode), next = order[(i + 1) % order.length];
  pickCam(next);
}
function buildUI() {
  panel = createPanel($('panelBody'), { store: 'coral-reef' });

  const ex = panel.section({ id: 'explore', title: 'Explore', open: true });
  ex.segmented({
    id: 'rovCount', label: 'ROVs in the squad', value: G.rovs,
    items: [2, 3, 4].map(n => ({ id: n, label: String(n) })),
    onChange: n => { G.rovs = +n; if (squad) { squad.setCount(G.rovs); buildROVs(); } },
  });
  ex.button({ id: 'bLead', label: 'Follow the lead ROV', kind: 'primary', icon: 'target', onClick: () => { camChoice = null; $('tourList').hidden = true; if (hud && rovs && rovs.vehicles[0]) hud.select(rovs.vehicles[0].id, { source: 'api' }); followDefault(); flash('Following the lead ROV.'); } });

  const vw = panel.section({ id: 'view', title: 'View', open: true });
  vw.toggle({ id: 'tFeed', label: 'Camera feed', value: G.feed, onChange: v => { G.feed = v; showFeed(); syncFeedUI(); } });
  vw.segmented({
    id: 'feedMode', label: 'Feed signal', items: FEED_MODES, value: G.feedMode,
    onChange: id => { G.feedMode = id; applyFeedMode(); },
    hint: 'The ROVs send their pictures over a slow acoustic link. Slow scan builds each picture line by line, with noise and a little slant.',
  });
  vw.segmented({
    id: 'sstvMode', label: 'Slow-scan mode', value: G.sstv,
    items: [{ id: 'r36', label: 'Robot 36' }, { id: 'm1', label: 'Martin M1' }],
    onChange: id => { G.sstv = id; G.feedMode = 'sstv'; applyFeedMode(); },
  });
  vw.toggle({ id: 'tOrbit', label: 'Slow orbit', value: G.orbit, onChange: v => { G.orbit = v; if (cam) cam.setAutoRotate(v); }, hint: 'The camera turns slowly round what it looks at.' });

  const lk = panel.section({ id: 'look', title: 'Look', open: true });
  lk.chips({ id: 'modes', label: 'Colour by', columns: 3, items: MODES, value: G.mode, onChange: id => setMode(id) });
  lk.note({ id: 'modeNote' });
  const gp = lk.slot({ id: 'gradPick' });
  mountGradientPicker(gp.input, { value: G.gradient, reversed: G.rev, label: 'Gradient', onChange: (id, rev) => setGradient(id, rev) });
  lk.label('Light and water');
  lk.toggle({ id: 'tBeam', label: 'Lamp beams', value: G.beam, onChange: v => { G.beam = v; if (S) S.opts.volume = v; } });
  lk.toggle({ id: 'tSnow', label: 'Marine snow', value: G.snow, onChange: v => { G.snow = v; if (S) S.opts.snow = v; } });
  lk.toggle({ id: 'tPolyps', label: 'Polyps', value: G.polyps, onChange: v => { G.polyps = v; if (S) { S.setPolypsVisible(v); S.setWorldPolyps(v); } } });
  lk.toggle({ id: 'tDetail', label: 'Surface detail', value: G.surface, onChange: v => { G.surface = v; if (S) S.U.uDetail.value = v ? 1 : 0; }, hint: 'Fine bumps on the rock and the coral skin. Off is faster on a small device.' });
  lk.slider({ id: 'sCaust', valueId: 'vCaust', label: 'Caustics', min: 0, max: 1.5, step: 0.05, value: G.caust, format: v => (v ? fmt(v) : 'Off'), onInput: v => { G.caust = v; if (S) S.U.uCaust.value = v; } });

  const wd = panel.section({ id: 'world', title: 'World', open: false });
  const det = PROFILE_ORDER.slice(PROFILE_ORDER.indexOf(PROFILE_ID));
  wd.segmented({
    id: 'quality', label: 'Detail', value: G.detail,
    items: PROFILE_ORDER.map(id => ({ id, label: DETAIL_LABEL[id], disabled: !det.includes(id) || (!HAS_WORKER && id !== 'phone-min'), title: !det.includes(id) ? 'Too large for this device' : null })),
    onChange: id => { G.detail = id; buildWorld({ keepSquad: true }).catch(worldError); },
    hint: 'The world streams in round the camera in 32 m chunks. Lower detail is faster. The larger levels are off on a small device.',
  });
  wd.button({ id: 'bSeed', label: 'New world', icon: 'dice', onClick: newWorld });
  wd.label('Water');
  wd.slider({ id: 'sDir', valueId: 'vDir', label: 'Current direction', min: 0, max: 359, step: 1, value: G.dir, format: v => `${v.toFixed(0)}°`, onInput: v => { G.dir = v; setCurrent(); } });
  wd.slider({ id: 'sCur', valueId: 'vCur', label: 'Current strength', min: 0, max: 1.5, step: 0.01, value: G.cur, format: v => fmt(v), onInput: v => { G.cur = v; setCurrent(); } });
  const bn = { set() {} };
  wd.slider({
    id: 'sTemp', valueId: 'vTemp', label: 'Temperature', unit: '°C', min: 24, max: 33, step: 0.1, value: G.temp, format: v => v.toFixed(1),
    onInput: v => { setTemp(v); const t = bleachMsg(v); bn.set(t); bn.el.classList.toggle('snp-warn', !!t); },
    hint: 'Above about 30 °C the corals bleach: they lose their colour.',
  });
  Object.assign(bn, wd.note({ id: 'bleachNote', live: true }));

  panel.section({ id: 'about', title: 'About', open: false }).slot({ el: $('aboutBlurb') });
  syncFeedUI(); syncLookUI();

  let diag = null;
  shell = mountShell({
    phoneQ: PHONE_Q,
    on: {
      cam: cycleCam, feedNext: nextFeed, seed: newWorld,
      mode: () => { const i = MODES.findIndex(m => m.id === G.mode); setMode(MODES[(i + 1) % MODES.length].id); },
      about: open => {
        if (!open) { if (diag) diag.stop(); return; }
        if (!diag) diag = mountDiagram($('diag'), { gradient: () => G.gradient });
        requestAnimationFrame(() => diag.start());
      },
      open: () => { fitTick = 0; },
      feed: () => { feedT = 0; },
    },
  });
  if (cam) input = createInput({ canvas, cam, hint: $('hint'), onTap: () => {}, onMode: m => { if (!saverOn) camChoice = m; camUI(); }, flyOk: () => true });
  bindCamBar();
  setTimeout(hideHint, 9000);
}

// ── the camera bar, the tours and the feed card taps ──────────────────────
function camUI() {
  const m = cam ? cam.mode : 'orbit', open = !$('tourList').hidden;
  document.querySelectorAll('#camBar button').forEach(b => {
    const on = b.dataset.cam === 'tour' ? open || m === 'tour' : b.dataset.cam === m;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    if (b.dataset.cam === 'tour') b.setAttribute('aria-expanded', String(open));
  });
  const fl = $('camFollowLbl'); if (fl) fl.textContent = m === 'follow' && cam ? `ROV ${cam.followId}` : 'Follow ROV';
  const cur = cam && m === 'tour' && cam.tour.T ? cam.tour.T.id : null;
  document.querySelectorAll('#tourList button').forEach(b => b.classList.toggle('on', b.dataset.id === cur));
  if (shell) shell.setDock({ cam: m === 'follow' ? 'Follow' : m === 'orbit' ? 'Orbit' : m === 'swim' ? 'Swim' : m === 'tour' ? 'Tour' : 'Saver' });
}
function buildTourUI() {
  const bx = $('tourList'); if (!bx || !cam) return;
  bx.innerHTML = '';
  if (cam.refreshTours) cam.refreshTours();
  for (const t of cam.tourList()) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = t.id; b.setAttribute('role', 'menuitem'); b.textContent = t.label;
    b.addEventListener('click', () => {
      const T = cam.startTour(t.id);
      if (T) camChoice = 'tour';
      flash(T ? `${T.label}: a drag, a key or the wheel takes over.` : `${t.label}: no free path for the camera.`);
      bx.hidden = true; camUI();
    });
    bx.appendChild(b);
  }
  const p = document.createElement('p'); p.textContent = bx.children.length ? 'Canyons and arches near you. The camera flies the path; a drag, a key or the wheel takes over.' : 'No canyon or arch near here. Swim on, or follow the squad.'; bx.appendChild(p);
}
function pickCam(want) {
  if (!cam) return;
  if (want !== 'tour') { $('tourList').hidden = true; camChoice = want; }
  if (want === 'orbit') cam.setMode('orbit');
  else if (want === 'swim') {
    cam.setMode('swim');
    flash(COARSE ? 'Swim: the left side moves, a drag on the right looks.' : 'Swim: WASD to move, E and Q up and down, Shift fast. Click to look with the mouse, Esc frees it.');
  } else if (want === 'follow') {
    const V = rovs ? rovs.vehicles : [];
    if (!V.length) { flash('The ROVs are not in the water yet.'); return; }
    const i = cam.mode === 'follow' ? (V.findIndex(v => v.id === cam.followId) + 1) % V.length : 0;
    cam.follow(V[i].id);
    if (i === 0) camChoice = null;           // following the lead is the default again
    flash(`Following ROV ${V[i].id}: drag to look round it.`);
  } else if (want === 'tour') { const t = $('tourList'); t.hidden = !t.hidden; if (!t.hidden) buildTourUI(); }
  camUI();
}
function bindCamBar() {
  document.querySelectorAll('#camBar button').forEach(b => b.addEventListener('click', () => pickCam(b.dataset.cam)));
  const fc = $('feedCycle');
  if (fc) {
    let hold = 0, long = false;
    fc.addEventListener('pointerdown', () => { long = false; clearTimeout(hold); hold = setTimeout(() => { long = true; const s = $('feedSize'); if (s) s.click(); }, 550); });
    const end = () => clearTimeout(hold);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) fc.addEventListener(ev, end);
    fc.addEventListener('contextmenu', e => e.preventDefault());
    fc.addEventListener('click', () => { if (long) { long = false; return; } nextFeed(); });
  }
  camUI();
}
// The chase camera reads the vehicle pose (squad state, world metres).
const camCtx = { getVehicle: id => { const v = squad && squad.vehicles.find(x => x.id === id); return v ? { pos: v.state.p, yaw: v.state.yaw } : null; } };
let camShown = '';

// ── readout ─────────────────────────────────────────────────────────────────
let readT = 0;
const metres = d => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(0)} m`);
function readout(dt) {
  readT += dt; if (readT < 0.4 || !squad) return;
  readT = 0;
  const st = squad.stats;
  $('rDist').textContent = metres(st.distance);
  $('rDepth').textContent = `${(DEPTH_BASE - squad.vehicles[0].state.p[1]).toFixed(0)} m`;
  $('rCol').textContent = String(st.colonies);
  $('rTask').textContent = squad.task.label;
  if (performance.now() > flashT && streamer) {
    const s = streamer.stats;
    setState(!streamer.ready(cam ? cam.eye : squad.vehicles[0].state.p) ? 'Building the seafloor…' : s.pending > 0 && s.coral === 0 ? 'Growing the corals of the first chunks…' : '');
  }
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), fitTick = 0, streamT = 0, tourT = 0, prK = 1;
const gov = frameGovernor({
  frameMs: PROF.frameMs,
  levels: [
    { name: 'volume', apply: on => S && S.setLoads(on ? { volScale: PROF.vol.scale * 0.6, volSteps: PROF.vol.steps * 0.6 } : { volScale: PROF.vol.scale, volSteps: PROF.vol.steps }) },
    { name: 'polyps', apply: on => S && S.setLoads({ polypDraw: on ? Math.round(PROF.polypDraw / 3) : PROF.polypDraw }) },
    { name: 'shadow-extra', apply: on => S && S.setLoads(on ? { shadowExtra: 0, polypShadow: false } : { shadowExtra: PROF.shadowExtra || 0, polypShadow: !!PROF.polypShadow }) },
    { name: 'shadow', apply: on => S && S.setLoads({ shadow: on ? 0 : PROF.shadow }) },
    { name: 'pixels', apply: on => { prK = on ? 0.75 : 1; onResize(); } },
  ],
});
// The render eye: render space (minus the origin), with the phone tilt.
function applyCamera() {
  const e = cam.eye, l = cam.look;
  const te = tiltEye(e, l, [0, 1, 0]);
  const c = S.camera;
  c.position.set(te[0] - origin[0], te[1], te[2] - origin[1]);
  c.up.set(0, 1, 0);
  c.lookAt(l[0] - origin[0], l[1], l[2] - origin[1]);
  c.updateMatrixWorld(true);
}
function frame(t) {
  if (lostNow) return;
  requestAnimationFrame(frame);
  gov.tick(t - last);
  const dtMs = Math.min(100, t - last); last = t; const dt = dtMs / 1000;
  const now = nowMs();
  if (squad) { try { squad.step(dt); } catch (e) { console.error('coral-reef: squad', e); squad = null; } }
  if (saverOn && saver) saver.tick(dt, now);
  if (rovs) { try { rovs.update(dt, now / 1000); } catch (e) { console.error('coral-reef: ROV update', e); rovs = null; } }
  readout(dt);
  if (!S) return;
  if (cam) {
    if (!saverOn && input) input.take(dt);
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    cam.setProjection({ fov: S.camera.fov, aspect: w / h, shift: [2 * S.view.ox / w, -2 * S.view.oy / h] });
    if (P) cam.update(dt, camCtx);
    if (cam.mode !== camShown) { camShown = cam.mode; camUI(); }
    // the floating origin follows the eye in big steps
    if (Math.hypot(cam.eye[0] - origin[0], cam.eye[2] - origin[1]) > ORIGIN_MOVE) setOrigin(cam.eye[0], cam.eye[2]);
    applyCamera();
    if ((tourT += dt) > 6 && !$('tourList').hidden) { tourT = 0; buildTourUI(); }
  }
  // the world streams round the eye; the focus points are the main camera
  // and the lead ROV camera
  if (streamer && (streamT += dt) > 0.25) {
    streamT = 0;
    const pts = [cam ? cam.eye.slice() : squad.vehicles[0].state.p.slice()];
    if (squad) pts.push(squad.vehicles[0].state.look.slice());
    try { streamer.update(pts[0], pts); } catch (e) { console.error('coral-reef: stream', e); }
  }
  S.U.uTime.value = now / 1000;
  S.U.uCount.value = 1;
  S.U.uSwayK.value = REDUCED ? 0.3 : 1;
  if (!saverOn && (fitTick++ & 7) === 0) { const f = fitNow(); S.view.tox = f.ox; S.view.toy = f.oy; }
  if (cam) S.setCausticCentre(cam.eye[0] - origin[0], cam.eye[2] - origin[1], 96);
  S.flushChunks(COARSE ? 2.5 : 3.5, now);
  S.render(dt, now);
  presentFeed();
}

function onResize() {
  if (!S) return;
  const r = Math.max(0.5, Math.min(pixelRatio(devicePixelRatio, canvas.clientWidth || 1, canvas.clientHeight || 1, COARSE), pixelRatioFor(PROF, devicePixelRatio, canvas.clientWidth || 1, canvas.clientHeight || 1)) * prK);
  if (Math.abs(S.renderer.getPixelRatio() - r) > 0.01) S.renderer.setPixelRatio(r);
  S.resize();
}
addEventListener('resize', onResize);

// The youngest birth that the shaders see (s): no texel of a shown coral
// is young (tests/robust.test.mjs, tests/saver-page.test.mjs).
function youngestAge() {
  let b = -Infinity;
  for (const rec of coral.values()) {
    const n = rec.M.count;
    if (n) b = Math.max(b, -1e5);               // every texel: BIRTH_PAST (world/coral-data.js)
  }
  return b === -Infinity ? null : nowMs() / 1000 - b;
}
const worldError = e => { console.error('coral-reef: world', e); setState('The world could not be built.'); box.show({ title: 'The world could not be built', text: String((e && e.stack) || e).split('\n').slice(0, 6).join('\n') }); };
window.__coralDebug = () => ({
  profile: PROFILE_ID, detail: G.detail, worldReady, lostNow, cam: cam ? { mode: cam.mode, followId: cam.followId, choice: camChoice, eye: cam.eye.slice(), clearance: cam.clearance() } : null,
  camOn: [...document.querySelectorAll('#camBar button.on')].map(b => b.dataset.cam), rovs: rovs ? rovs.vehicles.length : 0,
  origin: origin.slice(), seed: G.seed,
  world: S ? S.world : null, stream: streamer ? streamer.stats : null, pool: pool ? pool.stats : null, fallback: fallbackWhy,
  squad: squad ? { task: squad.task.kind, label: squad.task.label, stats: Object.assign({}, squad.stats), p: squad.vehicles.map(v => v.state.p.slice()) } : null,
  coralChunks: coral.size, fine: fineK.size, ageMin: youngestAge(),
  solid: P ? (x, y, z) => P.sdf(x, y, z) / P.sdfScale : null,
  post: S ? Object.assign({}, S.post) : null, loads: S ? S.loads : null, gov: gov.level, box: box.count, boxLast: box.last,
});
// ── start ───────────────────────────────────────────────────────────────────
buildUI();
setGradient(G.gradient, G.rev);
setMode(G.mode);
setCurrent(); setTemp(G.temp);
if (S) {
  S.opts.volume = G.beam; S.opts.snow = G.snow; S.U.uCaust.value = G.caust; S.U.uDetail.value = G.surface ? 1 : 0;
  onResize();
  requestAnimationFrame(frame);
  buildWorld().catch(worldError);
}

// ── screensaver ─────────────────────────────────────────────────────────────
// The squad explores (it always does); the saver films it: calm shots of 8
// to 14 s on a seeded plan (saver.js squadPlan), a slow orbit round the
// colony that the lead inspects, framed in the clear band of the plate
// (plateBand) in 16:9 and 9:16. safeCamera keeps rock out of the line of
// sight. The plate has live stats and the real frontier score code.
window.snSaver = {
  enter(o = {}) {
    if (!S) return { canvas, warmupMs: 0 };
    saverOn = true;
    document.documentElement.classList.add('sn-saver');
    if (shell) { shell.setOpen(false); shell.closeAbout(); }
    const label = typeof o.label === 'function' ? o.label : () => {};
    const seed = (o.seed >>> 0) || 1;
    const plan = squadPlan(seed, 60);
    if (cam) { cam.setMode('saver'); $('tourList').hidden = true; }
    const st = { i: -1, shot: null, t: 0, cut: true, labT: 0, bandFn: null, bandT: 0, pose: null };
    saver = { band: null, card: null, tick, st, saved: { feed: G.feed, mode: G.mode, gradient: G.gradient, rev: G.rev }, next: () => next() };
    import('../../lib/saver-clear.js').then(m => { st.bandFn = m.plateBand; }).catch(() => { /* no plate */ });
    G.feed = true; showFeed();
    if (rovs && rovs.feed && rovs.vehicles[0]) rovs.feed.setVehicle(rovs.vehicles[0].id);
    function makeLabel() {
      if (!squad) return null;
      const s = squad.stats, L = squad.vehicles[0].state;
      const src = frontierScore.toString();
      return {
        title: 'ROV squad',
        sub: `${squad.vehicles.length} ROVs · ${squad.task.label} · seed ${G.seed}`,
        params: [
          { sym: 'd', name: 'explored', value: metres(s.distance), cls: 'm1' },
          { sym: 'z', name: 'depth', value: `${(DEPTH_BASE - L.p[1]).toFixed(0)} m`, cls: 'm2' },
          { sym: 'C', name: 'colonies seen', value: String(s.colonies), cls: 'm3' },
          { sym: 'N', name: 'chunks explored', value: String(s.chunks), cls: 'm4' },
          { sym: 't', name: 'dive time', value: `${Math.floor(s.t / 60)} min`, cls: 'm5' },
        ],
        tex: [String.raw`s = 3\,n + 0.9\cos\Delta\psi + 1.2\cos\Delta\psi_e + 1.4\,h + 0.8\,r`],
        eq: ['s = 3 n + 0.9 cos Δψ + 1.2 cos Δψe + 1.4 h + 0.8 r'],
        rules: [['d', 'm1'], ['z', 'm2'], ['C', 'm3'], ['N', 'm4'], ['t', 'm5']],
        lines: ['The lead ROV scores the ground round it: unseen cells first, then the heading, the coral habitat, ridges and drop-offs. The corals grew once, long ago.'],
        code: src.split('\n').length <= 14 ? { lang: 'js', name: 'rov/squad.js · frontierScore', text: src } : undefined,
      };
    }
    function next() {
      st.i = (st.i + 1) % plan.length;
      st.shot = Object.assign({}, plan[st.i]);
      // the lead inspects a colony: film the colony
      if (squad && squad.task.kind === 'inspect' && squad.task.target) st.shot.kind = 'colony';
      st.t = 0; st.cut = true;
      label(makeLabel());
    }
    function placeCard() {
      const f = $('feed'); if (!f || f.hidden) { saver.card = null; return; }
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      const R = cardRect(w, h, saver.band);
      f.style.width = `${R.w}px`;
      f.style.left = 'auto'; f.style.right = `${w - R.left - R.w}px`;
      f.style.top = `${R.top}px`; f.style.bottom = 'auto';
      saver.card = R;
    }
    function tick(dt) {
      if (st.bandFn && (st.bandT += dt) > 0.4) { st.bandT = 0; try { saver.band = st.bandFn(canvas.clientHeight); } catch (e) { saver.band = null; } placeCard(); }
      if (!squad || !P) return;
      if (!st.shot || st.t > st.shot.hold) next();
      st.t += dt;
      if ((st.labT += dt) > 1) { st.labT = 0; label(makeLabel()); }
      const V = squad.vehicles, L = V[0].state;
      const c = [0, 0, 0];
      for (const v of V) for (let k = 0; k < 3; k++) c[k] += v.state.p[k] / V.length;
      let r = 0; for (const v of V) r = Math.max(r, Math.hypot(v.state.p[0] - c[0], v.state.p[1] - c[1], v.state.p[2] - c[2]));
      const colony = squad.task.kind === 'inspect' && squad.task.target ? squad.task.target : null;
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, clear = clearArea(w, h);
      const fit = rr => frameFit({ w, h, clear, radius: rr, fov: S.camera.fov }).dist;
      const f0 = frameFit({ w, h, clear, radius: 1, fov: S.camera.fov });
      S.view.tox = f0.ox; S.view.toy = f0.oy;
      const shot = st.shot.kind === 'colony' && !colony ? Object.assign({}, st.shot, { kind: 'chase' }) : st.shot;
      const pose = squadShotPose(shot, st.t, { lead: L.p, yaw: L.yaw, c, r, colony }, fit);
      const safe = safeCamera(P.sdf, P.sdfScale, pose.tgt, pose.pos, Math.max(0.3, Math.min(pose.r, 2)));
      st.pose = { pos: safe.pos, tgt: pose.tgt, r: pose.r, kind: shot.kind, how: safe.how };
      if (cam) cam.saverGoal(safe.pos, pose.tgt, st.cut);
      st.cut = false;
    }
    next();
    return { canvas, warmupMs: 2500 };
  },
  skip() { if (saverOn && saver && saver.next) saver.next(); },
  debug() {
    const sv = saver, st = sv && sv.st;
    const Pc = S ? S.camera.position : null;
    return {
      on: saverOn, shot: st && st.shot ? { kind: st.shot.kind, i: st.i, t: st.t, hold: st.shot.hold } : null, pose: st ? st.pose : null,
      cam: cam ? cam.eye.slice() : null, look: cam ? cam.look.slice() : null, fov: S ? S.camera.fov : 50, camRender: Pc ? [Pc.x, Pc.y, Pc.z] : null, origin: origin.slice(),
      squad: squad ? squad.vehicles.map(v => v.state.p.slice()) : null, task: squad ? squad.task.kind : null,
      card: sv ? sv.card : null, band: sv ? sv.band : null, solid: P ? (x, y, z) => P.sdf(x, y, z) / P.sdfScale : null, sdfScale: P ? P.sdfScale : 1,
    };
  },
  exit() {
    if (!saverOn) return;
    saverOn = false;
    document.documentElement.classList.remove('sn-saver');
    canvas.style.opacity = '';
    const f = $('feed'); if (f) f.removeAttribute('style');
    const sv = saver && saver.saved; saver = null;
    if (sv) { G.feed = sv.feed; showFeed(); }
    if (cam) {
      cam.setAutoRotate(G.orbit);
      if (!followDefault()) cam.setMode(camChoice === 'swim' ? 'swim' : 'orbit');
      camUI();
    }
    if (shell) shell.setOpen(!PHONE_Q.matches);
  },
};

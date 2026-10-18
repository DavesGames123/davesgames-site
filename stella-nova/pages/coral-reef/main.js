// ============================================================================
//  CORAL REEF GROWTH  ·  main script, v3: the ROV dive (ES module, three r160)
// ----------------------------------------------------------------------------
//  One circular reef plot of radius R in dark deep water. This script makes
//  the world and runs the loop:
//    rock ..... rock/index.js createRock (ROCK): the SDF, the meshes, the
//               sand, the features (arches, canyons, ...), the textures
//    coral .... the reef worker (mesh-worker.js, CORAL) grows all colonies
//               in one DLA model on the rock SDF and meshes them (fine
//               LOD near the cameras, coarse for the rest). The page keeps
//               a mirror of the particles (reef.js createReefMirror) for
//               the colours and the data textures. With no module worker
//               the same runner works here (createReefRunner).
//    ROVs ..... rov/index.js createROVs (ROV): the vehicles, their lamps
//               (scene.js setLights) and the SSTV feed canvas (#feedSlot)
//    scene .... scene.js: water, caustics, lamp beams, snow, the passes
//  and it binds the controls (shell.js, layout.js).
//
//  CLOCK. nowMs = performance.now() - T0. The reef stamps each particle
//  with nowMs (reef.birth), and the shader gets nowMs / 1000 as uTime, so
//  a new particle grows in and glows from the frame where it joined.
//
//  PHONE. shell.js binds the dock, the sheet, the explainer and the feed
//  card. layout.js (no DOM) has the breakpoints, the tap test, the sheet
//  snap and the pixel ratio cap. A tap plants a colony on the rock only in
//  plant mode. A double tap out of plant mode flies the camera there.
//
//  CAMERA. The main view is always the user's own camera: camera.js
//  (orbit round the rock under the pointer, zoom to the cursor, grab pan,
//  fly to a point; swim with collision; tours through the canyons and
//  under the arches; a chase camera behind one ROV; the saver goals) and
//  input.js (pointer, touch, wheel, keys, pointer lock, the swim stick).
//  #camBar picks the mode. By default the camera follows the feed ROV
//  (followDefault, from buildROVs and the saver exit); a mode that the
//  user picks (camChoice) holds until the next new world (buildWorld).
//  scene.js still makes OrbitControls; main.js turns them off. The ROV
//  feed card (rov/feed.js) is live video by
//  default: presentFeed() draws it into the canvas at the card after the
//  main render; a tap on the card shows the next ROV.
//
//  PROFILE. budget.js picks a device profile (desktop, laptop-low, phone,
//  phone-min; ?profile= in the URL overrides it, and a context loss
//  lowers it for the session). It sets the default reef, the reef worker
//  budget, the rock quality and workers, the render loads and the feed.
//  START. The water draws from the first frame. buildWorld makes the rock
//  (at most 4 workers), then after stagger.reefMs the reef worker, then
//  after stagger.rovMs the ROVs and their feed worker. frameGovernor
//  steps the volume, the polyps, the shadow maps (the other ROVs first,
//  then the lead) and the pixels down on slow frames. ERRORS. crash.js
//  shows window errors, shader errors and a context loss in a box
//  (#errBox). coral-link.js runs the reef on this thread when the worker
//  fails.
//
//  FRAMING. clearArea() measures the panel, the dock and the plant bar.
//  The camera view offset (setViewOffset) puts the reef in the middle of
//  the clear part. The saver uses the clear band of the label plate and
//  the feed card.
//
//  GREP MAP
//    grep -n 'function buildWorld'    rock, reef, ROVs for a plot radius
//    grep -n 'function makeCoral'     the coral driver (the reef worker protocol)
//    grep -n 'function onCoral'       the worker messages
//    grep -n 'function syncCoral'     new particles to the mesher and the GPU
//    grep -n 'const fineView'         fine or coarse mesh per colony (fine-view.js)
//    grep -n 'function buildROVs'     the vehicles, lamps and the feed card
//    grep -n 'function presentFeed'   the live feed into the canvas at the card
//    grep -n 'function camUI'         the camera bar, the tours, the feed card taps
//    grep -n 'function followDefault' the default camera: follow the feed ROV
//    grep -n 'function refresh'       radii, natural colours and t
//    grep -n 'function setMode'       colour by
//    grep -n 'function clearArea'     the parts of the canvas under overlays
//    grep -n 'function plantAt'       tap the rock to plant a colony
//    grep -n 'function buildUI'       the controls
//    grep -n 'function frame'         the loop
//    grep -n 'window.snSaver'         the screensaver hook (one colony grows once a session)
//    grep -n 'function restoreReef'   the saver exit: the grown main reef comes back
// ============================================================================
import { createScene } from './scene.js';
import { SPECIES, SPECIES_IDS, PRESETS, PRESET_IDS, QUALITY, polypRadius, speciesHook, bleachLevel, createReefMirror } from './reef.js';
import { MODES, colourT, naturalRGB, radiiOf, fieldsOf } from './colour.js';
import { SHAPES } from './coral-sdf.js';
import { createReefRunner } from './mesh-worker.js';
import { createRock, createRockAsync } from './rock/index.js';
import { createROVs, colonyBounds } from './rov/index.js';
import { divePlan, shotAt, shotPose, pickSite, safeCamera, cardRect, frameFit, createGovernor } from './saver.js';
import { lut, cssGradient, mountGradientPicker, GRADIENTS } from '../../lib/growth-gradients.js';
import { PARAM_INFO } from '../../lib/dla-engine.js';
import { mountDiagram } from './diagram.js';
import { PHONE_QUERY, clearFromRects, tapGesture, pixelRatio, nextPreset } from './layout.js';
import { mountShell } from './shell.js';
import { createExploreCamera } from './camera.js';
import { createInput } from './input.js';
import { PROFILES, PROFILE_ORDER, detectProfile, pageEnv, profileFor, reefBudget, rockWorkers, clampQuality, pixelRatioFor, lostPolicy, frameGovernor } from './budget.js';
import { mountErrorBox, installErrorHandlers } from './crash.js';
import { createCoralLink } from './coral-link.js';
import { createFineView } from './fine-view.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia(PHONE_QUERY);
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PAGE_FILL_S = 420;                    // s to grow the whole reef at speed 1
const T0 = performance.now();
const QUAL_IDS = ['phone', 'mid', 'desktop'];
const QUAL_LABEL = { phone: 'Few', mid: 'Many', desktop: 'Most' };

// the error box first: an error in the start shows on the page
const box = mountErrorBox(document);
installErrorHandlers(window, box);
const SS = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* no storage */ } return null; };
const URLQ = new URLSearchParams((typeof location !== 'undefined' && location.search) || (window.location && window.location.search) || '');
// the profile: ?profile= or the device; a profile that a context loss
// lowered for this session (sessionStorage) wins when it is lower
const BASE_PROFILE = PROFILES[URLQ.get('profile')] ? URLQ.get('profile') : detectProfile(pageEnv());
const LOWERED = SS('coral-reef-profile');
const PROFILE_ID = PROFILES[LOWERED] && PROFILE_ORDER.indexOf(LOWERED) > PROFILE_ORDER.indexOf(BASE_PROFILE) ? LOWERED : BASE_PROFILE;
const PROF = profileFor(PROFILE_ID);
const reloadPage = () => (window.__coralReload || (() => location.reload()))();
const delay = ms => new Promise(r => setTimeout(r, ms));

const G = {
  preset: 'mixed', seed: 1, R: 30, quality: PROF.reef, rovs: PROF.rovs, sstv: 'r36',
  mode: 'natural', gradient: 'reef', rev: false,
  playing: true, speed: 1, dir: 20, cur: 0.5, nutrient: 1, temp: 27,
  caust: 0.7, beam: true, snow: true, feed: true, orbit: false, polyps: true, detail: !COARSE,
  plant: 'staghorn', spSel: 'staghorn', plantMode: !COARSE,
  feedMode: 'live',                         // 'live' | 'r8' | 'sstv' (then G.sstv)
};
let shell = null;
let saverOn = false, saver = null;

// ── scene ───────────────────────────────────────────────────────────────────
const canvas = $('view');
const S = createScene({
  canvas, coarse: COARSE, R: G.R, profile: PROF, maxParticles: reefBudget(PROF, PROF.reefMax).particles + 8192,
  onNoGL: () => { $('nogl').hidden = false; },
  onShaderError: text => box.show({ title: 'A shader did not compile on this GPU', text: `${text}\n\nPlease report this text (the Copy button).` }),
});
// a fine colony mesh shows only when it is complete (scene.js fineGroups)
if (S) S.setFineGate(true);
// WebGL context loss: one reload at one profile lower, then stop
let lostNow = false;
if (S) canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); onContextLost(); }, false);
function onContextLost() {
  if (lostNow) return;
  lostNow = true;
  let st = null; try { st = JSON.parse(SS('coral-reef-lost') || 'null'); } catch (e) { st = null; }
  const pol = lostPolicy(st, PROFILE_ID);
  SS('coral-reef-lost', JSON.stringify(pol.state));
  if (coral) coral.kill();
  if (pol.action === 'reload') {
    SS('coral-reef-profile', pol.profile);
    box.show({ title: 'The GPU context was lost', text: `The page restarts with the ${PROFILES[pol.profile].label} profile (less memory).`, level: 'note' });
    setTimeout(reloadPage, 1500);
  } else {
    box.show({ title: 'The GPU context was lost again', text: 'The reef stopped, so the page does not restart in a loop. Reload the page to try again.' });
  }
}
const nowMs = () => performance.now() - T0;
// The explore camera (camera.js). OrbitControls of scene.js stay off.
const cam = S ? createExploreCamera({ R: G.R, fov: S.camera.fov, eye: S.camera.position.toArray(), look: S.controls.target.toArray() }) : null;
if (S) { S.controls.enabled = false; S.controls.autoRotate = false; }
let input = null, camRock = null;
// camChoice: the camera mode that the user picked (the camera bar, a key,
// a tour take-over), or null. With no choice the camera follows the feed
// ROV (followDefault). A new world (seed, radius, quality) clears it.
let camChoice = null;

let rock = null, coral = null, rovs = null;
let radBuf = new Float32Array(1), tBuf = new Float32Array(1), natBuf = new Float32Array(3);
let synced = 0, refreshAt = 0, hMax = 0, dirty = true;

// ── the coral driver ────────────────────────────────────────────────────────
// The reef worker protocol (mesh-worker.js header, NOTES.md). coral.reef
// is the mirror of the particles plus per-colony top and ext (height and
// spread, from the particles), so the ROV package can read the bounds.
// gen: messages of an older reef are dropped; the first message of a new
// gen clears the mirror and the coral meshes.
function makeCoral(rk, quality, seed) {
  const Q = QUALITY[quality] || QUALITY.desktop;
  const mirror = createReefMirror(4096);
  const params = {};
  for (const id of SPECIES_IDS) { const p = SPECIES[id].params; params[id] = { particleSpacing: p.particleSpacing * Q.fine, attractionDistance: p.attractionDistance * Q.fine, minMoveDistance: p.minMoveDistance * Q.fine, stubbornness: p.stubbornness, stickiness: p.stickiness }; }
  const D = {
    reef: mirror, params, quality, fine: Q.fine, limit: Q.particles, prog: null, gen: -1, want: 0, joined: 0,
    colTop: [], colExt: [], post: null, kill: null, local: null, off: Infinity,
    // mainReal: the worker has the real main reef (not the one-colony init
    // of a saver start). parked: the saver posted a 'single', so the worker
    // parked the main reef (mesh-worker.js 'restore' brings it back).
    mainReal: !saverOn, parked: false,
  };
  mirror.env = { temp: G.temp };
  // the reef worker, or the same runner on this thread when it fails
  // (coral-link.js: a lower budget, small slices, the state replayed)
  const link = createCoralLink({
    makeWorker: () => new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' }),
    makeRunner: post => createReefRunner({ post, makeRock: () => rk }),
    onMessage: m => onCoral(D, m),
    onFallback: why => {
      D.gen = -1; D.want = 0; D.ready = false;
      console.warn('coral-reef: ' + why);
      box.show({ title: 'The reef runs on the main thread', text: `${why}. The reef is smaller and grows slower.`, level: 'note' });
    },
  });
  D.post = (m, tr) => link.post(m, tr);
  D.kill = () => link.kill();
  D.link = link;
  D.budget = reefBudget(PROF, quality);
  D.limit = D.budget.particles;
  const sites = rk.sampleSurface ? rk.sampleSurface(D.budget.colonies * 24) : [];
  D.want = 1;
  D.post({
    type: 'init', seed, quality, radius: G.R, detail: rk.detail ?? 1, rockSeed: rk.seed ?? seed, rockQuality: rk.quality || 'high',
    sites, preset: G.preset, env: { speed: G.speed, nutrient: G.nutrient, temp: G.temp }, rate: Math.max(20, Math.round(D.budget.particles / PAGE_FILL_S)),
    budget: D.budget, colonies: saverOn ? 1 : undefined,
  });
  D.post({ type: 'current', deg: G.dir, strength: G.cur });
  return D;
}
// A new reef in the worker (reset, single): newer messages only.
function coralNewGen(m) { if (!coral) return; coral.want = Math.max(coral.want, coral.gen + 1); coral.post(m); }
// fineView: the colonies whose fine mesh shows (their coarse mesh hides:
// a negative radius in the data texture). fine-view.js keeps one full
// mesh on screen for each colony (the worker 'fine' events and scene.js
// showFine / takeShown / dropFine).
const fineView = createFineView({ scene: S, reef: () => coral && coral.reef, now: () => nowMs() });
let focusDirty = false;
function onCoral(D, m) {
  if (D !== coral) return;
  if (m.type === 'error') { console.error('coral-reef: reef worker', m.message); box.show({ title: 'The reef worker reported an error', text: String(m.message || '').split('\n').slice(0, 6).join('\n') }); return; }
  if (m.type === 'ready') D.ready = true;
  if (m.gen === undefined) return;
  if (m.gen < D.want) return;
  if (m.gen !== D.gen) {
    D.gen = m.gen;
    D.reef.reset(); D.colTop = []; D.colExt = []; fineView.reset();
    synced = 0; hMax = 0; refreshAt = 0;
    if (S) S.clearColonies();
    // a restored reef (the saver exit) shows in one frame when every
    // coarse brick is there (the 'coarse' event), not brick by brick
    if (S) S.coralRoot.visible = !D.restoring;   // (a reset or an init shows its growth)
    D.hideAt = nowMs();
  }
  if (m.type === 'colonies') {
    D.reef.setColonies(m.list);
    for (const c of D.reef.colonies) if (c) { c.top = D.colTop[c.k] ?? c.base[1]; c.ext = D.colExt[c.k] ?? 0; }
  } else if (m.type === 'particles') {
    // the clock offset: page ms - worker ms of the newest birth (the least
    // over the messages, so the message delay drops out)
    let mb = -Infinity; for (let o = 5; o < m.data.length; o += 8) if (m.data[o] > mb) mb = m.data[o];
    if (mb > -Infinity) D.off = Math.min(D.off, nowMs() - mb);
    if (D.reef.addParticles(m.from, m.data)) { syncCoral(); dirty = true; }
  } else if (m.type === 'bricks') {
    if (S) S.applyBricks(m.list);
  } else if (m.type === 'fine') {
    fineView.onFine(m.list);
    if (m.list.some(e => e.state === 'coarse')) showCoral(D);
  } else if (m.type === 'progress') {
    D.prog = m;
  }
}
function showCoral(D) { D.restoring = false; if (S) S.coralRoot.visible = true; }
function sizeBuffers(n) {
  if (radBuf.length >= n) return;
  let c = Math.max(1024, radBuf.length); while (c < n) c *= 2;
  const r = new Float32Array(c), t = new Float32Array(c), q = new Float32Array(c * 3);
  r.set(radBuf); t.set(tBuf); q.set(natBuf);
  radBuf = r; tBuf = t; natBuf = q;
}

// ── the world: rock, reef, ROVs ────────────────────────────────────────────
// A new plot radius or seed makes a new rock; the reef and the ROVs follow.
// Start light: the rock first (the water draws already), then the reef
// worker, then the ROVs and their feed worker (PROF.stagger).
let worldGen = 0, worldReady = false;
async function buildWorld({ seed = G.seed, R = G.R, keepRock = false } = {}) {
  const my = ++worldGen;
  worldReady = false;
  camChoice = null;                 // a new world follows an ROV again
  G.seed = seed; G.R = R;
  setState('Building the reef rock…');
  if (!keepRock || !rock) {
    const ro = { seed, radius: R, detail: 1, quality: PROF.rock };
    try {
      rock = await createRockAsync(ro, { workers: rockWorkers(PROF, navigator.hardwareConcurrency || 4) });
    } catch (e) {
      // the rock workers failed: the low rock on this thread (about 1 s)
      console.error('coral-reef: rock workers', e);
      box.show({ title: 'The rock workers failed', text: `${(e && e.message) || e}. The page builds a low detail rock on the main thread.`, level: 'note' });
      rock = createRock(Object.assign({}, ro, { quality: 'low' }));
    }
    if (my !== worldGen) return;
    if (S) { S.setPlot(R); S.setRock(rock); }
  }
  if (coral) coral.kill();
  coral = null;
  synced = 0; hMax = 0;
  if (S) { S.clearColonies(); S.setPolypSizes(SHAPES); }
  fitCamera(true);
  setState('Seeding the corals…');
  await delay(PROF.stagger.reefMs);
  if (my !== worldGen) return;
  coral = makeCoral(rock, G.quality, seed);
  setTemp(G.temp);
  setCurrent();
  await delay(PROF.stagger.rovMs);
  if (my !== worldGen) return;
  buildROVs();
  worldReady = true;
  setState('');
}
function presetUI() {
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.id === G.preset));
  if (shell && PRESETS[G.preset]) shell.setPresetLabel(presetShort(G.preset));
}
function loadPreset(pid = G.preset, seed = G.seed, fit = false) {
  G.preset = pid;
  presetUI();
  if (!coral) return;
  // colonies: the profile count (the init of a saver start asked for 1)
  coral.restoring = false;
  coralNewGen({ type: 'reset', seed, preset: pid, colonies: coral.budget ? coral.budget.colonies : undefined });
  coral.mainReal = true; coral.parked = false;
  if (fit) fitCamera(true);
}
// The saver exit: the main reef comes back already grown (the worker
// kept it: mesh-worker.js 'restore'), with no grow-in. Only a reef that
// never grew (the page started in the saver) grows now, one time.
function restoreReef(pid = G.preset) {
  G.preset = pid;
  presetUI();
  if (!coral) return;
  if (coral.parked && coral.mainReal) {
    coral.parked = false;
    coral.restoring = true;           // onCoral: the reef shows when its coarse mesh is all there
    coralNewGen({ type: 'restore', seed: G.seed, preset: pid, colonies: coral.budget ? coral.budget.colonies : undefined });
  } else if (!coral.mainReal) loadPreset(pid, G.seed);
  else coral.parked = false;
}

// ── the ROVs ────────────────────────────────────────────────────────────────
// The lamps go to the scene, lead lamp first (vehicle 1, lamp 0), then
// lamp 0 of each other vehicle, then the rest (the scene takes 4). The
// main lamps (lamp 0 of each vehicle) get the shadow maps.
function buildROVs() {
  if (!S || !rock) return;
  if (rovs) { try { rovs.dispose(); } catch (e) { /* a half-built set */ } rovs = null; }
  try {
    rovs = createROVs(S.THREE, {
      scene: S.scene, renderer: S.renderer, rock, reef: coral ? coral.reef : null,
      count: G.rovs, seed: G.seed, quality: PROFILE_ID === 'desktop' ? 'high' : 'low', radius: G.R, profile: PROF,
      feed: { mode: G.sstv, document, dpr: Math.min(2, devicePixelRatio || 1), size: PROF.feed },
    });
  } catch (e) { console.error('coral-reef: no ROVs', e); rovs = null; }
  if (!rovs) { S.setLights([]); return; }
  const V = rovs.vehicles || [];
  const first = V.map(v => v.lights && v.lights[0]).filter(Boolean);
  const rest = V.flatMap(v => (v.lights || []).slice(1));
  S.setLights([...first, ...rest], first.length);       // a shadow map for each main lamp
  const slot = $('feedSlot');
  if (slot && rovs.feed && rovs.feed.canvas) { slot.innerHTML = ''; slot.appendChild(rovs.feed.canvas); }
  applyFeedMode();
  showFeed();
  followDefault();
}
// The default view: the chase camera behind the feed ROV (camera.js
// 'follow'), unless the user picked a camera mode in this world, or the
// saver runs.
function followDefault() {
  if (!cam || saverOn || camChoice || !rovs || !rovs.vehicles || !rovs.vehicles.length) return false;
  const V = rovs.vehicles, id = rovs.feed && V.some(v => v.id === rovs.feed.vehicle) ? rovs.feed.vehicle : V[0].id;
  if (cam.mode !== 'follow' || cam.followId !== id) cam.follow(id, { snap: true });   // a cut: a glide from the overview can stop on rock
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
  document.querySelectorAll('#feedMode button').forEach(b => b.classList.toggle('on', b.dataset.id === G.feedMode));
  if (rovs && rovs.feed && rovs.feed.setMode) rovs.feed.setMode(feedModeId());
  feedT = 0;
}
// The live feed into the canvas at the picture box of the card, after the
// main render (rov/feed.js present). The card rect and opacity are read
// every 10 frames; a hidden card stops the live renders.
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

// New particles (synced..count): to the mesher, and into the data
// textures with a radius, a t and a natural colour that the next refresh
// corrects.
const SWAY = id => Math.round(((SPECIES[id] && SPECIES[id].sway) || 0) * 4);
function syncCoral() {
  if (!coral) return;
  const reef = coral.reef;
  const n = reef.count; if (n <= synced) return;
  sizeBuffers(n);
  for (let g = synced; g < n; g++) {
    const k = reef.col[g], c = reef.colonies[k];
    if (!c) { radBuf[g] = 0.01; tBuf[g] = 1; natBuf[g * 3] = natBuf[g * 3 + 1] = natBuf[g * 3 + 2] = 0.8; dirty = true; continue; }
    const top = Math.max(coral.colTop[k] ?? -1e9, reef.py[g]), ext = Math.max(coral.colExt[k] ?? 0, Math.hypot(reef.px[g] - c.base[0], reef.pz[g] - c.base[2]));
    coral.colTop[k] = top; coral.colExt[k] = ext; c.top = top; c.ext = ext;
    radBuf[g] = polypRadius(c.sp, 1);
    const h = reef.py[g] - reef.gy[g]; if (h > hMax) hMax = h;
    tBuf[g] = G.mode === 'flow' ? 0 : G.mode === 'colony' ? (reef.col[g] * 0.618034 + 0.12) % 1 : G.mode === 'height' ? h / Math.max(0.1, hMax) : 1;
    const q = c.sp.tip; natBuf[g * 3] = q[0]; natBuf[g * 3 + 1] = q[1]; natBuf[g * 3 + 2] = q[2];
  }
  writeParticles(synced, n, null);
  synced = n;
}
function writeParticles(from, to, F) {
  if (!S || !coral) return;
  const reef = coral.reef;
  S.setParticles(from, to, (g, A, B, o) => {
    const k = reef.col[g], c = reef.colonies[k];
    A[o] = natBuf[g * 3]; A[o + 1] = natBuf[g * 3 + 1]; A[o + 2] = natBuf[g * 3 + 2]; A[o + 3] = tBuf[g];
    const tip = F && F.sub ? Math.max(0, Math.min(0.999, 1 - Math.log2(F.sub[g]) / 5)) : 0.999;
    // the birth is in the worker clock: coral.off moves it to the page clock
    B[o] = (reef.birth[g] + coral.off) / 1000; B[o + 1] = fineView.has(k) ? -radBuf[g] : radBuf[g]; B[o + 2] = (c ? SWAY(c.id) : 0) * 2 + tip; B[o + 3] = reef.py[g] - reef.gy[g];
  });
}
function refresh() {
  if (!S || !coral) return;
  const reef = coral.reef;
  sizeBuffers(reef.count);
  // a particle of a planted colony can come one message before its colony
  for (let g = 0; g < reef.count; g += 97) if (!reef.colonies[reef.col[g]]) return;
  if (reef.count && !reef.colonies[reef.col[reef.count - 1]]) return;
  const F = fieldsOf(reef);
  radiiOf(reef, radBuf, F); naturalRGB(reef, natBuf, F); colourT(reef, G.mode, tBuf, F);
  writeParticles(0, reef.count, F);
  dirty = false; focusDirty = false;
}

// ── colour ──────────────────────────────────────────────────────────────────
const LEG = {
  age: ['Age', 'old', 'new'], depth: ['Depth (hops to the seed)', 'seed', 'tips'], height: ['Height over the base', 'low', 'high'],
  flow: ['Flow (subtree size)', 'tips', 'trunk'], light: ['Light and nutrient exposure', 'shaded', 'open'],
};
const MODE_NOTE = {
  natural: 'The colours of the species. New growth glows a little as it joins.',
  age: 'The order of joining. The growing front is at the hot end of the gradient, so the colours move while the reef grows.',
  depth: 'Hops from the seed, per colony.',
  height: 'Height over the colony base.',
  flow: 'The size of the subtree that a particle feeds: the trunks carry the most.',
  light: 'An estimate: high particles with few close neighbours get the most light and food.',
  colony: 'One colour per colony, from the gradient.',
};
function setGradient(id, rev) {
  G.gradient = id; G.rev = !!rev;
  if (S) S.setLut(lut(id, 256, G.rev));
  drawLegend();
}
function setMode(m) {
  G.mode = m;
  if (S && coral) { S.U.uMode.value = m === 'natural' ? 0 : m === 'age' ? 1 : 2; colourT(coral.reef, m, tBuf); S.writeT(tBuf, coral.reef.count); }
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.id === m));
  $('modeNote').textContent = MODE_NOTE[m] || '';
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
function setCurrent() {
  if (coral) coral.post({ type: 'current', deg: G.dir, strength: G.cur });
  if (S) S.U.uCur.value.set(Math.cos(G.dir * Math.PI / 180) * G.cur, Math.sin(G.dir * Math.PI / 180) * G.cur);
}
function setTemp(t) {
  G.temp = t;
  if (coral) { coral.reef.env.temp = t; coral.post({ type: 'env', env: { temp: t } }); }
  if (S) S.U.uBleach.value = bleachLevel(t);
}

// ── framing ─────────────────────────────────────────────────────────────────
// Px of the canvas under the panel and the dock at each edge. Small corner
// boxes (readout, legend, the feed card) do not count, except in the saver.
function clearArea(w, h) {
  const rects = [];
  for (const el of [$('panel'), $('dock'), $('plantBar')]) {
    if (!el || el.hidden || getComputedStyle(el).display === 'none') continue;
    const q = el.getBoundingClientRect();
    rects.push({ x0: q.left, y0: q.top, x1: q.right, y1: q.bottom });
  }
  const o = clearFromRects(rects, w, h);
  if (saverOn && saver && saver.band) { o.t = Math.max(o.t, saver.band.t); o.b = Math.max(o.b, saver.band.b); }
  if (saverOn && saver && saver.card) { if (w >= h) o.r = Math.max(o.r, saver.card.w + 24); else o.b = Math.max(o.b, saver.card.h + 16 + (saver.band ? saver.band.b : 0)); }
  return o;
}
const center = { x: 0, y: 2, z: 0 };
function fitNow() {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  return frameFit({ w, h, clear: clearArea(w, h), fov: S ? S.camera.fov : 50, rx: G.R * 0.82, ry: G.R * 0.42 });
}
function fitCamera(dist) {
  if (!S) return;
  const f = fitNow();
  S.view.tox = f.ox; S.view.toy = f.oy;
  // re-frame the orbit (not a swim, tour or chase of the user)
  if (dist && !saverOn && cam && cam.mode === 'orbit') {
    const top = rock && rock.bounds ? rock.bounds.max[1] : 6;
    center.y = Math.max(0, top * 0.3);
    cam.frame({ target: [center.x, center.y, center.z], dist: Math.min(90, f.dist * 0.72) });
  }
}

// ── tap to plant, double tap to fly there ──────────────────────────────────
// input.js finds the taps (and flies the camera on a double tap).
function onTap(x, y, kind) {
  if (saverOn) return;
  if (G.plantMode) { if (kind === 'tap') plantAt(x, y); }
  else if (kind === 'double') tapFeedback(x, y, true, '');
}
let ray = null;
function plantAt(cx, cy) {
  if (!S || !coral) return;
  const THREE = S.THREE, reef = coral.reef;
  ray = ray || new THREE.Raycaster();
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), S.camera);
  const targets = [...S.rockGroup.children]; if (S.sand) targets.push(S.sand);
  const hit = ray.intersectObjects(targets, false)[0];
  const bad = msg => { tapFeedback(cx, cy, false, msg); };
  if (!hit) return bad('Tap the rock, not the water.');
  const p = [hit.point.x, hit.point.y, hit.point.z];
  if (Math.hypot(p[0], p[2]) > G.R * 0.95) return bad('Plant inside the reef plot.');
  if (reef.colonies.some(c => Math.hypot(c.base[0] - p[0], c.base[1] - p[1], c.base[2] - p[2]) < Math.max(0.6, c.size * 0.4))) return bad('Too near a colony: tap open rock.');
  if (reef.count >= coral.limit - 200) return bad('The reef is at its particle budget. Regrow to plant again.');
  const n = rock && rock.normal ? rock.normal(p[0], p[1], p[2]) : [0, 1, 0];
  if (rock && rock.sdf(p[0] + n[0] * 0.05, p[1] + n[1] * 0.05, p[2] + n[2] * 0.05) < 0) return bad('No room for a colony there.');
  coral.post({ type: 'plant', id: G.plant, site: { p, n } });
  tapFeedback(cx, cy, true, `Planted: ${SPECIES[G.plant].label}`);
}
let flashT = 0;
function flash(msg) { $('rState').textContent = msg; flashT = performance.now() + 2600; }
function setState(msg) { const el = $('rState'); if (el) el.textContent = msg; }
let markT = 0;
function tapFeedback(cx, cy, good, msg) {
  const m = $('tapMark');
  m.style.left = `${cx}px`; m.style.top = `${cy}px`;
  m.classList.remove('go'); m.classList.toggle('bad', !good);
  void m.offsetWidth;
  m.classList.add('go');
  clearTimeout(markT); markT = setTimeout(() => m.classList.remove('go'), 1300);
  if (!msg) return;
  flash(msg);
  const pm = $('plantMsg'); pm.textContent = msg; pm.classList.toggle('warn', !good);
}

// ── UI ──────────────────────────────────────────────────────────────────────
function hideHint() { $('hint').classList.add('gone'); }
const fmt = (v, d = 2) => (+v).toFixed(d);
function bindRange(id, vid, key, show, on, ev = 'input') {
  const el = $(id), vl = $(vid);
  const shown = () => { vl.textContent = show(+el.value); };
  el.value = G[key];
  el.addEventListener('input', shown);
  el.addEventListener(ev, () => { G[key] = +el.value; shown(); on && on(G[key]); });
  shown();
}
function chips(el, items, cur, on) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = it.id;
    if (it.sw) { const s = document.createElement('span'); s.className = 'sw'; s.style.background = it.sw; b.appendChild(s); }
    b.appendChild(document.createTextNode(it.label));
    b.classList.toggle('on', String(it.id) === String(cur));
    b.addEventListener('click', () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); on(it.id); });
    el.appendChild(b);
  }
}
const rgbCss = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
function setPlaying(p) { G.playing = p; if (shell) shell.setPlaying(p); if (coral) coral.post({ type: 'play', on: !!p }); }
const presetShort = id => PRESETS[id].label.split(' ')[0];

function buildSpeciesParams() {
  const id = G.spSel, box = $('spParams'), sp = SPECIES[id];
  $('spNote').textContent = `${sp.label} (${sp.latin}): ${sp.form.toLowerCase()}.`;
  box.innerHTML = '';
  for (const P of PARAM_INFO) {
    const row = document.createElement('div'); row.className = 'row';
    const inId = `p_${P.key}`;
    row.innerHTML = `<label for="${inId}">${P.text.replace(/\.$/, '')}<code>${P.dlaf}</code></label><input type="range" id="${inId}"><span class="val"></span>`;
    const inp = row.querySelector('input'), val = row.querySelector('.val');
    const metres = /Spacing|Distance/.test(P.key) || /distance|spacing/i.test(P.key);
    const cur = coral ? coral.params[id][P.key] : SPECIES[id].params[P.key];
    // the dlaf distances are in metres here: a range round the species value
    const lo = metres ? cur * 0.4 : P.min, hi = metres ? cur * 2.5 : P.max, st = metres ? cur / 50 : P.step;
    inp.min = lo; inp.max = hi; inp.step = st; inp.value = cur;
    const show = () => { val.textContent = metres ? `${(+inp.value * 1000).toFixed(1)} mm` : (+inp.value).toFixed(P.step < 1 ? 2 : 0); };
    inp.addEventListener('input', () => { if (coral) { coral.params[id][P.key] = +inp.value; coral.post({ type: 'params', id, p: { [P.key]: +inp.value } }); } show(); });
    show();
    box.appendChild(row);
  }
}

function buildUI() {
  chips($('presets'), PRESET_IDS.map(id => ({ id, label: PRESETS[id].label })), G.preset, id => { loadPreset(id, G.seed); setPlaying(true); });
  const spItems = SPECIES_IDS.map(id => ({ id, label: SPECIES[id].label, sw: rgbCss(SPECIES[id].base) }));
  const pickPlant = (id) => {
    G.plant = id;
    for (const box of ['plant', 'plantQuick']) $(box).querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.id === id));
    $('plantMsg').textContent = `Plant mode: tap open rock for ${SPECIES[id].label.toLowerCase()}`; $('plantMsg').classList.remove('warn');
  };
  chips($('plant'), spItems, G.plant, pickPlant);
  chips($('plantQuick'), SPECIES_IDS.map(id => ({ id, label: SPECIES[id].label.replace(' coral', '').replace('Finger leather', 'Finger'), sw: rgbCss(SPECIES[id].base) })), G.plant, pickPlant);
  chips($('spPick'), spItems, G.spSel, id => { G.spSel = id; buildSpeciesParams(); });
  chips($('modes'), MODES, G.mode, id => setMode(id));
  chips($('quality'), QUAL_IDS.map(id => ({ id, label: `${QUAL_LABEL[id]} (${reefBudget(PROF, id).colonies})` })), G.quality, id => { G.quality = clampQuality(PROF, id); buildWorld({ keepRock: true }); setPlaying(true); });
  // a reef larger than the profile allows is off (budget.js reefMax)
  $('quality').querySelectorAll('button').forEach(b => { if (clampQuality(PROF, b.dataset.id) !== b.dataset.id) { b.disabled = true; b.title = 'Too large for this device'; } });
  chips($('rovCount'), [2, 3].map(n => ({ id: n, label: `${n} ROVs` })), G.rovs, n => { G.rovs = +n; buildROVs(); });
  chips($('feedMode'), [{ id: 'live', label: 'Live video' }, { id: 'r8', label: 'SSTV fast (Robot 8 B&W)' }, { id: 'sstv', label: 'SSTV slow-scan' }], G.feedMode, id => { G.feedMode = id; applyFeedMode(); });
  chips($('sstvMode'), [{ id: 'r36', label: 'Robot 36' }, { id: 'm1', label: 'Martin M1' }], G.sstv, id => { G.sstv = id; G.feedMode = 'sstv'; applyFeedMode(); });
  mountGradientPicker($('gradPick'), { value: G.gradient, reversed: G.rev, onChange: (id, rev) => setGradient(id, rev) });
  buildSpeciesParams();
  $('spReset').addEventListener('click', () => {
    if (coral) { const p = SPECIES[G.spSel].params, f = coral.fine, q = { particleSpacing: p.particleSpacing * f, attractionDistance: p.attractionDistance * f, minMoveDistance: p.minMoveDistance * f, stubbornness: p.stubbornness, stickiness: p.stickiness }; coral.params[G.spSel] = q; coral.post({ type: 'params', id: G.spSel, p: q }); }
    buildSpeciesParams();
  });

  bindRange('sR', 'vR', 'R', v => `${v.toFixed(0)} m`, v => { buildWorld({ R: v }); setPlaying(true); }, 'change');
  bindRange('sSpeed', 'vSpeed', 'speed', v => `${fmt(v)}×`, v => { if (coral) coral.post({ type: 'env', env: { speed: v } }); });
  bindRange('sDir', 'vDir', 'dir', v => `${v.toFixed(0)}°`, setCurrent);
  bindRange('sCur', 'vCur', 'cur', v => fmt(v), setCurrent);
  bindRange('sNut', 'vNut', 'nutrient', v => `${fmt(v)}×`, v => { if (coral) coral.post({ type: 'env', env: { nutrient: v } }); });
  bindRange('sCaust', 'vCaust', 'caust', v => (v ? fmt(v) : 'off'), v => { if (S) S.U.uCaust.value = v; });
  bindRange('sTemp', 'vTemp', 'temp', v => `${v.toFixed(1)} °C`, v => {
    setTemp(v);
    const b = bleachLevel(v);
    $('bleachNote').classList.toggle('warn', b > 0.02);
    $('bleachNote').textContent = b > 0.98 ? 'Bleached: the corals have lost their algae and do not grow. Cool the water to recover.'
      : b > 0.02 ? `Bleaching: growth is down ${Math.round(b * 100)}% and the colour fades.` : 'Above about 30 °C the corals bleach: they lose their colour and stop growing.';
  });

  const tog = (id, key, on) => { const b = $(id); b.classList.toggle('on', G[key]); b.addEventListener('click', () => { G[key] = !G[key]; b.classList.toggle('on', G[key]); on(G[key]); }); };
  tog('tBeam', 'beam', v => { if (S) S.opts.volume = v; });
  tog('tSnow', 'snow', v => { if (S) S.opts.snow = v; });
  tog('tFeed', 'feed', showFeed);
  tog('tOrbit', 'orbit', v => { if (cam) cam.setAutoRotate(v); });
  tog('tPolyps', 'polyps', v => { if (S) S.setPolypsVisible(v); });
  tog('tDetail', 'detail', v => { if (S) S.U.uDetail.value = v ? 1 : 0; });

  $('bPlay').addEventListener('click', () => setPlaying(!G.playing));
  const regrow = () => { loadPreset(G.preset, G.seed); setPlaying(true); };
  $('bRegrow').addEventListener('click', regrow);
  $('bSeed').addEventListener('click', () => { buildWorld({ seed: 1 + Math.floor(Math.random() * 1e6) }); setPlaying(true); });

  let diag = null;
  shell = mountShell({
    phoneQ: PHONE_Q, plant: G.plantMode,
    on: {
      play: () => setPlaying(!G.playing),
      regrow,
      preset: () => { const id = nextPreset(PRESET_IDS, G.preset); loadPreset(id, G.seed); setPlaying(true); },
      plant: v => { G.plantMode = v; },
      about: open => {
        if (!open) { if (diag) diag.stop(); return; }
        if (!diag) diag = mountDiagram($('diag'), { gradient: () => G.gradient });
        requestAnimationFrame(() => diag.start());
      },
      open: () => { fitTick = 0; },
      feed: () => { feedT = 0; },
    },
  });
  setPlaying(G.playing);

  if (cam) input = createInput({ canvas, cam, hint: $('hint'), onTap, onMode: m => { if (!saverOn) camChoice = m; camUI(); }, flyOk: () => !G.plantMode });
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
}
function buildTourUI() {
  const box = $('tourList'); if (!box || !cam) return;
  box.innerHTML = '';
  for (const t of cam.tourList()) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = t.id; b.setAttribute('role', 'menuitem'); b.textContent = t.label;
    b.addEventListener('click', () => {
      const T = cam.startTour(t.id);
      if (T) camChoice = 'tour';
      flash(T ? `${T.label}: a drag, a key or the wheel takes over.` : `${t.label}: no free path for the camera.`);
      box.hidden = true; camUI();
    });
    box.appendChild(b);
  }
  const p = document.createElement('p'); p.textContent = box.children.length ? 'The camera flies the path. A drag, a key or the wheel takes over.' : 'This rock has no canyon or arch.'; box.appendChild(p);
}
function bindCamBar() {
  document.querySelectorAll('#camBar button').forEach(b => b.addEventListener('click', () => {
    if (!cam) return;
    const want = b.dataset.cam;
    if (want !== 'tour') { $('tourList').hidden = true; camChoice = want; }
    if (want === 'orbit') { if (cam.mode === 'orbit') fitCamera(true); else cam.setMode('orbit'); }
    else if (want === 'swim') {
      cam.setMode('swim');
      flash(COARSE ? 'Swim: the left side moves, a drag on the right looks.' : 'Swim: WASD to move, E and Q up and down, Shift fast. Click to look with the mouse, Esc frees it.');
    } else if (want === 'follow') {
      const V = rovs ? rovs.vehicles : [];
      if (!V.length) { flash('The ROVs are not in the water yet.'); return; }
      const i = cam.mode === 'follow' ? (V.findIndex(v => v.id === cam.followId) + 1) % V.length : Math.max(0, V.findIndex(v => v.id === (rovs.feed ? rovs.feed.vehicle : 1)));
      cam.follow(V[i].id);
      flash(`Following ROV ${V[i].id}: drag to look round it.`);
    } else if (want === 'tour') { $('tourList').hidden = !$('tourList').hidden; }
    camUI();
  }));
  // the feed card: a tap shows the next ROV, a long press makes it large
  const fc = $('feedCycle');
  if (fc) {
    let hold = 0, long = false;
    fc.addEventListener('pointerdown', () => { long = false; clearTimeout(hold); hold = setTimeout(() => { long = true; const s = $('feedSize'); if (s) s.click(); }, 550); });
    const end = () => clearTimeout(hold);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) fc.addEventListener(ev, end);
    fc.addEventListener('contextmenu', e => e.preventDefault());
    fc.addEventListener('click', () => {
      if (long) { long = false; return; }
      if (!rovs || !rovs.feed || !rovs.vehicles.length) return;
      const V = rovs.vehicles, v = V[(V.findIndex(x => x.id === rovs.feed.vehicle) + 1) % V.length];
      rovs.feed.setVehicle(v.id);
      flash(`Camera feed: ROV ${v.id}`);
    });
  }
  camUI();
}
// The chase camera reads the vehicle pose (pilot yaw: from +x to +z).
const camCtx = { getVehicle: id => { const v = rovs && rovs.vehicles.find(x => x.id === id); return v ? { pos: v.group.position.toArray(), yaw: v.pilot ? v.pilot.state.yaw : -v.group.rotation.y } : null; } };
let camShown = 'orbit';

// ── readout ─────────────────────────────────────────────────────────────────
let rate = 0, lastCount = 0, readT = 0;
function readout(dt) {
  readT += dt; if (readT < 0.25 || !coral) return;
  const reef = coral.reef, pr = coral.prog || {};
  const dj = Math.max(0, reef.count - lastCount); lastCount = reef.count;
  rate += (dj / readT - rate) * 0.5; readT = 0;
  $('rPolyps').textContent = reef.count.toLocaleString();
  $('rCol').textContent = String(reef.colonies.filter(Boolean).length);
  let top = 0; for (const c of reef.colonies) if (c) top = Math.max(top, (c.top ?? c.base[1]) - c.base[1]);
  $('rH').textContent = `${top.toFixed(2)} m`;
  $('rContact').textContent = `${pr.fusions || 0} fused · ${pr.overgrowths || 0} over`;
  $('rRate').textContent = Math.round(rate).toLocaleString();
  if (performance.now() > flashT && rock) {
    const b = bleachLevel(G.temp);
    setState(b > 0.98 ? 'Bleached: no growth' : b > 0.02 ? `Bleaching: growth −${Math.round(b * 100)}%` : !G.playing ? 'Paused' : pr.done ? 'Grown to the particle budget' : '');
  }
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), fitTick = 0, viewT = 0, prK = 1;
// slow frames: the volume pass, then the polyps, the shadow maps of the
// other ROVs, the lead shadow map and the pixels
const gov = frameGovernor({
  frameMs: PROF.frameMs,
  levels: [
    { name: 'volume', apply: on => S && S.setLoads(on ? { volScale: PROF.vol.scale * 0.6, volSteps: PROF.vol.steps * 0.6 } : { volScale: PROF.vol.scale, volSteps: PROF.vol.steps }) },
    { name: 'polyps', apply: on => S && S.setLoads({ polypDraw: on ? Math.round(PROF.polypDraw / 3) : PROF.polypDraw }) },
    // the maps of the other ROVs (and the polyp casts) go first, then the lead map
    { name: 'shadow-extra', apply: on => S && S.setLoads(on ? { shadowExtra: 0, polypShadow: false } : { shadowExtra: PROF.shadowExtra || 0, polypShadow: !!PROF.polypShadow }) },
    { name: 'shadow', apply: on => S && S.setLoads({ shadow: on ? 0 : PROF.shadow }) },
    { name: 'pixels', apply: on => { prK = on ? 0.75 : 1; onResize(); } },
  ],
});
// The view points (main camera, ROV cameras): the worker gives the fine
// mesh to the colonies nearest to them.
function sendView() {
  if (!coral || !S || saverOn) return;
  const P = new S.THREE.Vector3(), pts = [S.camera.position.toArray()];
  if (rovs) for (const v of rovs.vehicles) if (v.camera) pts.push(v.camera.getWorldPosition(P).toArray());
  coral.post({ type: 'view', points: pts });
}
function frame(t) {
  if (lostNow) return;
  requestAnimationFrame(frame);
  gov.tick(t - last);
  const dtMs = Math.min(100, t - last); last = t; const dt = dtMs / 1000;
  const now = nowMs();
  if (coral) {
    const reef = coral.reef;
    if (dirty && now > refreshAt) { refresh(); refreshAt = now + (reef.count > 40000 ? 1200 : reef.count > 10000 ? 700 : 350); }
    if ((viewT += dt) > 0.4 && S) { viewT = 0; sendView(); }
  }
  if (S) { S.flushChunks(COARSE ? 2.5 : 3.5, now); fineView.afterFlush(); }
  if (coral && coral.restoring && now - (coral.hideAt || now) > 12000) showCoral(coral);   // no 'coarse' event: show anyway
  if (saverOn && saver) saver.tick(dt, now);
  if (rovs) { try { rovs.update(dt, now / 1000); } catch (e) { console.error('coral-reef: ROV update', e); rovs = null; } }
  readout(dt);
  if (!S) return;
  S.U.uTime.value = now / 1000;
  S.U.uCount.value = coral ? Math.max(1, coral.reef.count) : 1;
  S.U.uSwayK.value = REDUCED ? 0.3 : 1;
  if (!saverOn && (fitTick++ & 7) === 0) { const f = fitNow(); S.view.tox = f.ox; S.view.toy = f.oy; }
  if (cam) {
    if (rock && camRock !== rock) { camRock = rock; cam.setRock(rock, G.R); buildTourUI(); }
    if (!saverOn && input) input.take(dt);
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    cam.setProjection({ fov: S.camera.fov, aspect: w / h, shift: [2 * S.view.ox / w, -2 * S.view.oy / h] });
    cam.update(dt, camCtx);
    cam.apply(S.camera);
    if (cam.mode !== camShown) { camShown = cam.mode; camUI(); }
  }
  S.render(dt, now);
  presentFeed();
}

function onResize() {
  if (!S) return;
  const r = Math.max(0.5, Math.min(pixelRatio(devicePixelRatio, canvas.clientWidth || 1, canvas.clientHeight || 1, COARSE), pixelRatioFor(PROF, devicePixelRatio, canvas.clientWidth || 1, canvas.clientHeight || 1)) * prK);
  if (Math.abs(S.renderer.getPixelRatio() - r) > 0.01) S.renderer.setPixelRatio(r);
  S.resize(); fitCamera(false);
}
addEventListener('resize', onResize);

// The age (s) of the youngest of the first n particles, as the shaders
// see it (uTime - birth).
function youngestAge(n = Infinity) {
  if (!coral || !coral.reef.count || !Number.isFinite(coral.off)) return null;
  let b = -Infinity; const B = coral.reef.birth, m = Math.min(n, coral.reef.count);
  for (let g = 0; g < m; g++) if (B[g] > b) b = B[g];
  return (nowMs() - (b + coral.off)) / 1000;
}
// The state for the node checks (tests/robust.test.mjs, tests/saver-page.test.mjs).
window.__coralDebug = () => ({
  profile: PROFILE_ID, worldReady, lostNow, cam: cam ? { mode: cam.mode, followId: cam.followId, choice: camChoice } : null,
  camOn: [...document.querySelectorAll('#camBar button.on')].map(b => b.dataset.cam), quality: G.quality, rockQuality: rock ? rock.quality : null, rovs: rovs ? rovs.vehicles.length : 0,
  coral: coral ? { local: !!(coral.link && coral.link.local), why: coral.link ? coral.link.why : '', ready: !!coral.ready, count: coral.reef.count, colonies: coral.reef.colonies.filter(Boolean).length, budget: coral.budget, gen: coral.gen, parked: coral.parked, mainReal: coral.mainReal, ageMin: youngestAge(), restoring: !!coral.restoring, fine: fineView.shown.size } : null, youngest: n => youngestAge(n),
  coralShown: S ? S.coralRoot.visible : null,
  post: S ? Object.assign({}, S.post) : null, loads: S ? S.loads : null, gov: gov.level, box: box.count, boxLast: box.last,
});
// ── start ───────────────────────────────────────────────────────────────────
buildUI();
setGradient(G.gradient, G.rev);
setMode(G.mode);
if (S) {
  S.opts.volume = G.beam; S.opts.snow = G.snow; S.U.uCaust.value = G.caust; S.U.uDetail.value = G.detail ? 1 : 0;
  onResize();
  requestAnimationFrame(frame);          // the water draws while the rock builds
  buildWorld().catch(e => { console.error('coral-reef: world', e); setState('The reef could not be built.'); box.show({ title: 'The reef could not be built', text: String((e && e.stack) || e).split('\n').slice(0, 6).join('\n') }); });
}

// ── screensaver ─────────────────────────────────────────────────────────────
// One ROV analyses ONE coral colony while it grows (saver.js divePlan).
// The first dive: a site with a view (pickSite: an arch top, a canyon
// wall, ...) and reef.growColony there from a seed, ONE time a session
// (the worker parks the main reef). Each dive: rovs.focusOn that colony with the
// feed vehicle, the other vehicles hidden, and calm camera shots that cut
// every 7 to 14 s (shotPose; clearPath keeps rock out of the line). The
// feed card shows the ROV camera. The plate has live colony stats.
const EXT_RATE = { staghorn: 0.12, fan: 0.03, table: 0.08, boulder: 0.008, finger: 0.025 };   // m/year, typical linear extension
window.snSaver = {
  enter(o = {}) {
    if (!S) return { canvas, warmupMs: 0 };
    saverOn = true;
    document.documentElement.classList.add('sn-saver');
    if (shell) { shell.setOpen(false); shell.closeAbout(); }
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const label = typeof o.label === 'function' ? o.label : () => {};
    const seed = (o.seed >>> 0) || 1;
    const dives = divePlan(seed, { n: 12, species: SPECIES_IDS, calm, seconds: o.seconds });
    const saved = { mode: G.mode, gradient: G.gradient, rev: G.rev, dir: G.dir, cur: G.cur, temp: G.temp, preset: G.preset, playing: G.playing, speed: G.speed, nutrient: G.nutrient, feed: G.feed };
    if (cam) { cam.setMode('saver'); $('tourList').hidden = true; }
    setPlaying(true);
    const st = { i: -1, dive: null, t: 0, colony: null, fading: false, bandFn: null, bandT: 0, labT: 0, pos: null, tgt: null, shotI: -1, cut: true };
    saver = { band: null, card: null, gov: null, tick, st, saved, obs: 0, obsN: 0, obsH: 0, hRate: 0, next: () => next() };
    import('../../lib/saver-clear.js').then(m => { st.bandFn = m.plateBand; }).catch(() => { /* no plate */ });
    let rr = seed; const rand = () => { rr = (rr * 16807) % 2147483647; return rr / 2147483647; };
    // a dive starts only on a built world: the rock, the ROVs and a reef
    // worker that said 'ready' (a 'single' before 'ready' is dropped by
    // the worker, and the saver then waited on no colony)
    const worldOk = () => !!(worldReady && rock && coral && coral.ready);

    // the dive colony, once the worker has started the new reef
    function colonyNow() { const reef = coral && coral.reef; return reef && st.colony && coral.gen > st.gen0 ? reef.colonies[st.colony.k] || null : null; }
    function makeLabel() {
      const d = st.dive, c = colonyNow(); if (!d || !c) return null;
      const spId = st.species || d.species;
      const sp = SPECIES[spId], h = Math.max(0, c.top - c.base[1]);
      const years = h / (EXT_RATE[spId] || 0.05);
      const H = speciesHook(spId), src = H.fn.toString();
      const modeLbl = (MODES.find(m => m.id === d.mode) || MODES[0]).label;
      const site = st.site && st.site.feature ? st.site.feature.kind : 'rock';
      return {
        title: sp.label,
        sub: `${sp.latin} · grows on the ${site === 'canyon' ? 'canyon wall' : site === 'arch' ? 'arch top' : site} · ROV ${rovs && rovs.vehicles[0] ? rovs.vehicles[0].id : 1} inspects it`,
        params: [
          { sym: 'N', name: 'particles', value: coral.reef.count.toLocaleString(), cls: 'm1' },
          { sym: 'h', name: 'height', value: `${(h * 100).toFixed(1)} cm`, cls: 'm2' },
          { sym: 'P', name: 'polyps', value: S.polypTotal.toLocaleString(), cls: 'm3' },
          { sym: 't', name: 'age (from a typical extension rate)', value: years < 1 ? `${Math.round(years * 12)} months` : `${years.toFixed(1)} years`, cls: 'm4' },
          { sym: '\\dot N', name: 'growth rate', value: `${saver.obs.toFixed(1)} particles/s · ${(saver.hRate * 60000).toFixed(1)} mm/min`, cls: 'm5' },
        ],
        tex: [String.raw`\mathbf{v} = \boldsymbol{\xi} + d\,\mathbf{u} - f\,\hat{\mathbf{y}}`],
        eq: ['v = ξ + d u − f ŷ'],
        rules: [['N', 'm1'], ['h', 'm2'], ['P', 'm3'], ['t', 'm4'], ['\\dot N', 'm5']],
        lines: [`Colour by ${modeLbl.toLowerCase()}. Marine snow drifts down with the current and sticks to the tips that it meets first.`],
        code: src.split('\n').length <= 14 ? { lang: 'js', name: `reef.js · ${sp.label.toLowerCase()} · ${H.name}`, text: src } : undefined,
      };
    }

    // GROW ONCE. The first dive grows ONE colony from its seed (a 'single'
    // to the worker). The later dives keep that colony, grown or still
    // growing, and change only the shots, the gradient, the colour mode
    // and the ROV inspection: no second 'single' in a saver session.
    function start(d) {
      const first = !st.colony;
      st.dive = d; st.t = 0; st.shotI = -1; st.cut = true; st.rateSent = -1;
      G.dir = d.current; G.cur = 0.3 + 0.3 * (1 - calm); setCurrent();
      setGradient(d.gradient, d.reversed);
      if (first) {
        st.site = pickSite(rock, d.siteKind, d.siteR, rand, G.R) || { p: [0, rock && rock.bounds ? rock.bounds.max[1] * 0.5 : 2, 0], n: [0, 1, 0], feature: null };
        st.species = d.species; st.singles = (st.singles || 0) + 1;
        st.colony = { k: 0 }; st.gen0 = coral.gen; st.capSet = false;
        // one colony takes the first dive: cap / grow particles per second
        // (the cap comes with the colony list); the worker gets the eased
        // rate of the meter (saver.js createGovernor) twice a second
        saver.gov = createGovernor(20, { ramp: 10 });
        coral.parked = true;
        coralNewGen({ type: 'single', site: { p: st.site.p, n: st.site.n }, species: d.species, rate: 0, seed: d.seed });
        coral.post({ type: 'env', env: { speed: 1, nutrient: 1 } });
        coral.post({ type: 'play', on: true });
      }
      saver.obs = 0; saver.obsN = coral.reef.count; saver.obsH = 0; saver.hRate = 0;
      setMode(d.mode);
      if (rovs) {
        // the ROV starts beside the site (under the fade), not across the
        // plot: at 0.9 m/s it took more than 30 s to come, and the feed
        // showed open water
        placeRov(rovs.vehicles[0], st.site);
        const tgt = { get: () => { const c = colonyNow(); return (c && colonyBounds(coral.reef, c)) || { center: st.site.p, radius: 0.3 }; } };
        rovs.focusOn(tgt, 'inspect', { vehicle: rovs.vehicles[0] && rovs.vehicles[0].id });
        rovs.vehicles.forEach((v, i) => { v.group.visible = i === 0; for (const l of v.lights) l.visible = i === 0; });
        if (rovs.feed && rovs.feed.setVehicle && rovs.vehicles[0]) rovs.feed.setVehicle(rovs.vehicles[0].id);
      }
      G.feed = true; showFeed();
      label(makeLabel());
    }
    // A free point 2.5 to 4 m out from the site (rovs.sdf and its clear
    // shell), for the pilot state and the vehicle group.
    function placeRov(v, site) {
      if (!v || !v.pilot || !v.pilot.state || !site) return false;
      const sd = rovs.sdf || (rock && (rock.sdfAll || rock.sdf));
      if (typeof sd !== 'function') return false;
      const p = site.p, n = site.n;
      for (const kc of [1.2, 1]) for (const d of [2.5, 3, 3.5, 4]) for (const h of [0.6, 1.2, 1.8]) for (const a of [0, 0.7, -0.7, 1.4, -1.4]) {
        const cl = (rovs.clear || 1) * kc;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = n[0] * ca - n[2] * sa, nz = n[0] * sa + n[2] * ca;
        const q = [p[0] + nx * d, p[1] + n[1] * d + h, p[2] + nz * d];
        if (sd(q[0], q[1], q[2]) > cl) {
          const P = v.pilot.state;
          P.p[0] = q[0]; P.p[1] = q[1]; P.p[2] = q[2];
          if (P.v) P.v[0] = P.v[1] = P.v[2] = 0;
          if (P.look) { P.look[0] = p[0]; P.look[1] = p[1]; P.look[2] = p[2]; }
          v.group.position.set(q[0], q[1], q[2]);
          return true;
        }
      }
      return false;
    }
    function next() {
      st.i = (st.i + 1) % dives.length;
      const d = dives[st.i];
      st.fading = true; canvas.style.opacity = '0';
      setTimeout(() => { if (!saverOn) return; if (worldOk()) start(d); else st.i--; canvas.style.opacity = '1'; st.fading = false; }, 900);
    }
    // The feed card in the saver: right of the clear band (16:9) or under it (9:16).
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
      const d = st.dive;
      if (!d) { if (!st.fading && worldOk()) next(); if (!st.cardSet) { st.cardSet = true; placeCard(); } return; }
      st.t += dt; st.labT += dt;
      if (st.t > d.grow + 12 && !st.fading) { next(); return; }
      if (st.labT > 1) {
        // the observed rate: particles and height per second over the last second
        const cc = colonyNow();
        if (cc) {
          const h = cc.top - cc.base[1];
          saver.obs += ((coral.reef.count - saver.obsN) / st.labT - saver.obs) * 0.5; saver.obsN = coral.reef.count;
          saver.hRate += ((h - saver.obsH) / st.labT - saver.hRate) * 0.5; saver.obsH = h;
        }
        st.labT = 0; label(makeLabel());
      }
      // the growth meter: the cap of the colony sets the rate, the worker
      // gets the eased rate
      const c0 = colonyNow();
      if (c0 && !st.capSet && c0.cap) { st.capSet = true; saver.gov.setRate(Math.max(2, c0.cap / d.grow)); }
      saver.gov.used(saver.gov.take(dt));
      const rNow = saver.gov.current;
      if (Math.abs(rNow - st.rateSent) > Math.max(0.2, 0.03 * rNow)) { st.rateSent = rNow; coral.post({ type: 'rate', value: rNow }); }
      // before the first particles the subject is the site (a seed)
      const c = c0;
      const reef = coral.reef;
      const b = (c && colonyBounds(reef, c)) || { center: c ? c.base : st.site.p, radius: 0.3 };
      // the growth front: the mean of the newest particles of the colony
      const n = reef.count, k = Math.min(n, 120);
      let fx = 0, fy = 0, fz = 0;
      for (let g = n - k; g < n; g++) { fx += reef.px[g]; fy += reef.py[g]; fz += reef.pz[g]; }
      const front = c && k ? [fx / k, fy / k, fz / k] : b.center;
      const v0 = rovs && rovs.vehicles[0];
      const rp = v0 ? [v0.group.position.x, v0.group.position.y, v0.group.position.z] : null;
      const { shot, i, u } = shotAt(d, st.t);
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, clear = clearArea(w, h);
      const fit = r => frameFit({ w, h, clear, radius: r, fov: S.camera.fov }).dist;
      const f0 = frameFit({ w, h, clear, radius: 1, fov: S.camera.fov });
      S.view.tox = f0.ox; S.view.toy = f0.oy;
      const P = shotPose(shot, u, st.t - shot.t0, { c: b.center, r: Math.max(0.25, b.radius), front, rov: rp }, fit);
      // open water and a clear line to the colony (rock and sand)
      const safe = safeCamera(rock && (rock.sdfAll || rock.sdf), rock ? rock.sdfScale || 1 : 1, P.tgt, P.pos, Math.max(0.25, b.radius));
      const pos = safe.pos;
      st.pose = { pos, tgt: P.tgt, how: safe.how, kind: shot.kind, c: b.center, r: Math.max(0.25, b.radius) };
      if (i !== st.shotI) { st.shotI = i; st.cut = true; }
      // the springs of camera.js take the camera to the shot; a cut snaps
      if (cam) cam.saverGoal(pos, P.tgt, st.cut);
      st.cut = false;
    }

    if (worldOk()) next();
    return { canvas, warmupMs: 1800 };
  },
  // the next dive now (node checks: tests/grow-once.test.mjs)
  skip() { if (saverOn && saver && saver.next) saver.next(); },
  // the state for the node checks (tests/saver-page.test.mjs)
  debug() {
    const sv = saver, st = sv && sv.st;
    const v0 = rovs && rovs.vehicles[0];
    const P = S ? S.camera.position : null;
    return {
      on: saverOn, dive: st && st.dive ? { i: st.i, species: st.dive.species, kind: st.dive.siteKind } : null,
      singles: st ? st.singles || 0 : 0, species: st ? st.species || null : null, gen0: st ? st.gen0 : null,
      site: st && st.site ? { p: st.site.p, n: st.site.n, feature: st.site.feature ? st.site.feature.kind : null } : null,
      colony: st && st.colony && coral && coral.gen > st.gen0 ? (coral.reef.colonies[st.colony.k] ? { count: coral.reef.count, cap: coral.reef.colonies[st.colony.k].cap } : null) : null,
      pose: st ? st.pose || null : null, cam: P ? [P.x, P.y, P.z] : null,
      rov: v0 ? { pos: v0.group.position.toArray(), visible: v0.group.visible, cam: v0.camera ? v0.camera.getWorldPosition(new S.THREE.Vector3()).toArray() : null, target: v0.target ? v0.target.toArray() : null, fov: v0.camera ? v0.camera.fov : null } : null,
      hidden: rovs ? rovs.vehicles.slice(1).every(v => !v.group.visible) : null,
      card: sv ? sv.card : null, band: sv ? sv.band : null, rock: rock ? { sdfScale: rock.sdfScale } : null,
      sdfAll: rock ? (x, y, z) => (rock.sdfAll || rock.sdf)(x, y, z) : null,
    };
  },
  exit() {
    if (!saverOn) return;
    saverOn = false;
    document.documentElement.classList.remove('sn-saver');
    canvas.style.opacity = '';
    const f = $('feed'); if (f) f.removeAttribute('style');
    const sv = saver && saver.saved; saver = null;
    if (rovs) {
      rovs.focusOn(null, 'survey');
      rovs.vehicles.forEach(v => { v.group.visible = true; for (const l of v.lights) l.visible = true; });
    }
    // back to the user's camera choice, else follow the feed ROV (orbit
    // when there are no ROVs)
    if (cam) {
      cam.setAutoRotate(G.orbit);
      if (!followDefault()) cam.setMode(camChoice === 'swim' ? 'swim' : 'orbit');
      camUI();
    }
    if (sv) {
      G.dir = sv.dir; G.cur = sv.cur; setCurrent(); setTemp(sv.temp);
      G.speed = sv.speed; G.nutrient = sv.nutrient; G.feed = sv.feed;
      setGradient(sv.gradient, sv.rev);
      restoreReef(sv.preset);
      fitCamera(true);
      if (coral) { coral.post({ type: 'env', env: { speed: sv.speed, nutrient: sv.nutrient } }); coral.post({ type: 'rate', value: Math.max(20, Math.round(coral.limit / PAGE_FILL_S)) }); }
      setMode(sv.mode); setPlaying(sv.playing); showFeed();
    }
    if (shell) shell.setOpen(!PHONE_Q.matches);
  },
};

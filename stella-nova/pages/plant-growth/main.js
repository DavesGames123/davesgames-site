// ============================================================================
//  PLANT GROWTH  ·  the time-lapse, the controls and the screensaver hook
// ----------------------------------------------------------------------------
//  A seed is sown and grows year by year. sim-worker.js runs the model
//  (grow.js) ahead of the display and posts one snapshot per year. Each
//  snapshot goes into the history (radius, light, resource, tips per year),
//  and the display packs the year it shows (pose.js packYear) into the GPU
//  rows of render.js. The shaders do the rest each frame from the clock.
//
//  CLOCK. clock is in years from the sowing; S.spy is the seconds one year
//  takes on screen. The clock never runs past the last year the model has
//  done. Bud break and leaf fall run a little slower, so they read. At the
//  end of the life the clock stops in the last summer.
//
//  CAMERA. With "follow" on, the camera glides to fit the plant (its box in
//  the pack), so a seedling fills the frame and a tree does too, as the
//  crown grows. A one-finger (or left button) drag orbits and keeps follow
//  on. A pinch, a two-finger pan, a wheel or a right drag turns follow off.
//  A double tap or the Follow button turns it on (layout.js
//  createGestures). occlusion() measures the panel, dock, status bar and
//  drawer, and camera.setViewOffset puts the plant in the clear part of
//  the canvas, above an open sheet.
//
//  GROUND. Once per sowing, placeEco() builds the ground ecosystem
//  (eco.js buildEco: the meadow, the woodland edge, stones, forbs, litter)
//  with the caps of layout.js ecoLimits, and sets flat pads at the plant
//  bases and the cut-away. Each simulated year adds the crown radius of
//  each plant to crownHist, and growSeedlings() runs the seedling model.
//  The litter amount and its decay follow eco.js litterSeason.
//
//  LEAVES. Over the leaf budget (130 000, or 40 000 on a phone) a share of
//  the leaves is left out and the rest drawn larger (pose.js packYear).
//  PHONES. A coarse pointer caps the live metamers (24 000), uses fewer
//  grass blades, a 2048 shadow map and a pixel ratio of 1.6 or less. Slow
//  frames lower the pixel ratio to 1 by steps (layout.js pixelRatioStep).
//  The dock shows the species, the clock (year, month, season) and the
//  main actions (function dockReadout).
//
//  grep -n targets
//    state ................. "const S = "
//    sow a new plant ....... "function sow"
//    snapshots ............. "function onYear"
//    pack the shown year ... "function repack"
//    ground ecosystem ...... "function placeEco"
//    seedlings ............. "function growSeedlings"
//    roots ................. "function growRoots"
//    frame loop ............ "function frame"
//    camera ................ "function frameTarget"
//    overlays .............. "function occlusion"
//    readout ............... "function readout"
//    dock species, clock ... "function dockReadout"
//    controls .............. "function buildUI"
//    screensaver ........... "window.snSaver"
// ============================================================================
import { SPECIES, SPECIES_IDS, createSim } from './grow.js';
import { createRoots, packRoots } from './roots.js';
import { COLOUR_MODES, createHistory, addToHistory, packYear, nodeFrames, cellIndex } from './pose.js';
import { buildEco, seedlings, litterSeason } from './eco.js';
import { LOOK } from './look.js';
import { ATLAS_CELLS } from './atlas.js';
import { seasonOf, snowCover, smoothstep } from './season.js';
import { fitDistance, bandFrame, makeShots, codeExtract, shotPlan, meadowCamera } from './saver.js';
import { groundY } from './ground.js';
import { createRender } from './render.js';
import { createDiagram } from './diagram.js';
import { PHONE_QUERY, occlusion as occlude, clearFractions, createGestures, dockClock, nextId, pixelRatioStep, ecoLimits } from './layout.js';
import { GRADIENTS, cssGradient, mountGradientPicker } from '../../lib/growth-gradients.js';
import { rng } from '../../lib/dla-engine.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia(PHONE_QUERY);
const COARSE = matchMedia('(pointer:coarse)').matches;
const MAX_NODES = COARSE ? 24000 : 60000, LEAF_BUDGET = COARSE ? 40000 : 130000, ROOTS_MAX = COARSE ? 1200 : 2400;
const FOV = 40;
const ECO = ecoLimits(COARSE);

const S = {
  species: 'oak', stand: 'single', seed: 7, spy: 8, paused: false, follow: true,
  leaves: true, roots: false, snow: true, wind: 0.35, mode: 'natural', grad: 'forest', rev: false,
  lambda: 1, alpha: 1, xi: 1,
};

// ------------------------------------------------------------ model state
let worker = null, token = 0, fallback = null;
let snap = null, hist = createHistory(), frames = null, framesFor = null;
let pack = null, packKey = '', clock = 0, time = 0, simDone = false, lastStats = null;
let roots = null, rootsInfo = null, rootsAt = -1, rootsN = -1;
let plantsInfo = [];
let eco = null, crownHist = [];

const R = createRender({ canvas: $('gl'), coarse: COARSE, limits: ECO });
if (!R || R.failed) $('nogl').hidden = false;
const ok = R && !R.failed;

// ---------------------------------------------------------- sow a new plant
// the model sliders: multipliers on the presets of each species
function speciesOpts() { return { lambda: S.lambda, alpha: S.alpha, xi: S.xi }; }
function sow() {
  token++;
  snap = null; hist = createHistory(); frames = null; pack = null; packKey = ''; clock = 0; simDone = false; lastStats = null;
  crownHist = []; eco = null;
  const opts = { species: S.species, stand: S.stand, seed: S.seed, maxNodes: MAX_NODES, tune: speciesOpts() };
  if (!worker && !fallback) {
    try {
      worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => onMessage(e.data);
      worker.onerror = () => { worker = null; startFallback(opts); };
    } catch (e) { worker = null; }
  }
  if (worker) worker.postMessage({ cmd: 'start', token, opts });
  else startFallback(opts);
  // roots: one DLA system for the plant at the origin
  const sp = SPECIES[S.species];
  const Rc = Math.max(0.6, Math.min(3.6, sp.size.r * 0.55)), Dc = Math.max(0.5, Rc * 0.78);
  rootsInfo = { R: Rc, D: Dc, sp };
  roots = createRoots({ seed: (S.seed * 2654435761) >>> 0 || 1, max: ROOTS_MAX, scale: Rc * 0.82 / Math.pow(ROOTS_MAX, 1 / 2.45), r0: 0.002, rTop: 0.2, lean: [1, 1], deep: 0.8 });
  rootsAt = -1; rootsN = -1;
  if (ok) R.setRootsOn(S.roots, Rc, Dc);
  readout(true);
}
// no worker (an old browser or a file URL): the same loop on this thread
function startFallback(opts) {
  const my = token;
  fallback = createSim(opts);
  const run = () => {
    if (my !== token || !fallback) return;
    if (fallback.done) { onMessage({ type: 'done', token: my }); return; }
    fallback.stepYear();
    onMessage({ type: 'year', token: my, snap: fallback.snapshot() });
    setTimeout(run, 0);
  };
  run();
}
function onMessage(m) {
  if (!m || m.token !== token) return;
  if (m.type === 'year') onYear(m.snap);
  else if (m.type === 'done') simDone = true;
}
function onYear(s) {
  snap = s; frames = null;
  addToHistory(hist, s);
  lastStats = s.stats;
  if (plantsInfo.length !== s.plants.length || plantsInfo.token !== token) {
    plantsInfo = s.plants.map(p => ({ x: p.x, z: p.z, germ: p.germ, r: SPECIES[p.species].size.r * 0.3, form: SPECIES[p.species].form, species: p.species }));
    plantsInfo.token = token;
    if (ok) { R.setPlants(plantsInfo); placeEco(); }
  }
  // the crown radius of each plant at the end of this year (seedling model)
  const cr = plantsInfo.map(() => 0);
  for (let i = 0; i < s.count; i++) {
    if (s.died[i] < s.year + 1) continue;
    const k = s.plant[i], p = plantsInfo[k]; if (!p) continue;
    const d = Math.hypot(s.px[i] - p.x, s.pz[i] - p.z); if (d > cr[k]) cr[k] = d;
  }
  crownHist[s.year] = cr;
  growSeedlings();
}

// ------------------------------------------------- the ground ecosystem
// eco.js: the meadow, the woodland edge and the floor under the crowns,
// placed once per sowing; render.js and meadow.js draw it and make it
// answer the live crowns. Pads keep the ground level at each plant base
// and over the soil cut-away.
const DISPERSE = { oak: 'gravity', cherry: 'gravity', maple: 'wind', birch: 'wind', conifer: 'wind', willow: 'wind' };
function ecoPlants() {
  return plantsInfo.map(p => ({ x: p.x, z: p.z, species: p.species, form: p.form, rMature: SPECIES[p.species].size.r * 0.9, disperse: DISPERSE[p.species] || 'gravity' }));
}
function placeEco() {
  if (!ok || !plantsInfo.length) return;
  const cut = S.roots && rootsInfo ? rootsInfo.R : 0;
  const pads = plantsInfo.map(p => ({ x: p.x, z: p.z, r: p.form === 'tree' ? 0.5 : 0.3 }));
  if (cut) pads.unshift({ x: 0, z: 0, r: cut + 0.15 });
  R.setPads(pads);
  eco = buildEco({ seed: S.seed, plants: ecoPlants(), cut, limits: ECO, R: ECO.R });
  // the leaf litter of each plant: its species and atlas cells
  const leafInfo = plantsInfo.map(p => {
    const sp = SPECIES_IDS.indexOf(p.species), L = LOOK[p.species] || LOOK.oak;
    return [sp, cellIndex(sp, 0, 0), ATLAS_CELLS[L.leaf].length, SPECIES[p.species].leaf.fall && p.form === 'tree' ? 1 : 0];
  });
  R.setEco(eco, leafInfo);
  growSeedlings();
}
function growSeedlings() {
  if (!ok || !eco || !crownHist.length) return;
  const stones = eco.stones.filter(st => st.s > 0.12);
  const list = seedlings({ seed: S.seed, plants: ecoPlants(), crowns: crownHist, years: crownHist.length, fields: eco.fields, cap: ECO.seedlings,
    blocked: (x, z) => stones.some(st => Math.abs(st.x - x) < st.s * 0.5 && Math.abs(st.z - z) < st.s * 0.5) || plantsInfo.some(p => Math.hypot(p.x - x, p.z - z) < 0.6) });
  for (const sl of list) sl.spIndex = SPECIES_IDS.indexOf(sl.species);
  R.setSeedlings(list, sp => {
    const id = SPECIES_IDS[sp], L = LOOK[id] || LOOK.oak;
    return [cellIndex(sp, 0, 0), ATLAS_CELLS[L.leaf].length, SPECIES[id].leaf.ever ? 1 : 0];
  });
}

// ------------------------------------------------------- pack the shown year
function repack(force) {
  if (!snap || !ok || saver.waiting) return;
  const Y = Math.min(Math.floor(clock), hist.last);
  const key = Y + '|' + S.mode + '|' + snap.year;
  if (!force && key === packKey) return;
  // a new snapshot only matters for the year on screen when it is that year
  if (!force && pack && pack.year === Y && packKey.split('|')[1] === S.mode && Y < snap.year - 1) return;
  if (framesFor !== snap) { frames = nodeFrames(snap); framesFor = snap; }
  pack = packYear(snap, hist, Y, { mode: S.mode, frames, leafBudget: LEAF_BUDGET, out: pack && pack.T, leafOut: pack && pack.leaves });
  packKey = key;
  R.setPack(pack);
  // crown radius per plant, for the leaf litter on the ground
  const rr = plantsInfo.map(() => 0.3);
  for (const i of pack.list) {
    const k = snap.plant[i], p = plantsInfo[k]; if (!p) continue;
    const d = Math.hypot(snap.px[i] - p.x, snap.pz[i] - p.z); if (d > rr[k]) rr[k] = d;
  }
  R.setCrowns(plantsInfo.map((p, k) => ({ x: p.x, z: p.z, r: rr[k], w: p.form === 'fern' ? 0.3 : 1 })));
}

// ------------------------------------------------------------------- roots
function growRoots() {
  if (!S.roots || !roots || !pack || !ok) return;
  const sp = rootsInfo.sp, h = Math.max(0.05, pack.box[4]);
  const target = Math.round(ROOTS_MAX * Math.pow(Math.min(1, h / sp.size.h), 0.9));
  if (roots.count < Math.max(4, target)) { roots.growFor(COARSE ? 2 : 3.5); roots.stamp(clock); }
  if (roots.count !== rootsN || Math.abs(clock - rootsAt) > 0.25) {
    // the root collar matches the trunk
    const trunk = trunkRadius();
    const rs = Math.max(0.15, Math.min(4, trunk / Math.max(1e-4, roots.radius[0])));
    const p0 = plantsInfo[0] || { x: 0, z: 0 };
    R.setRootPack(packRoots(roots, { x: p0.x, z: p0.z, spIndex: SPECIES_IDS.indexOf(S.species), mode: S.mode, rScale: rs }));
    rootsN = roots.count; rootsAt = clock;
  }
}
function trunkRadius() {
  if (!snap || !pack) return 0.005;
  const Y = pack.year, r = hist.rad[Y];
  let best = 0;
  // the thickest node of the first plant near the ground
  for (let k = 0; k < Math.min(snap.count, 40); k++) if (snap.plant[k] === 0 && r[k] > best) best = r[k];
  return best || 0.005;
}

// ------------------------------------------------------------------ frame
let last = performance.now(), frameNo = 0;
const occ = { l: 0, r: 0, t: 0, b: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  time += dt;
  if (!ok) return;
  if (!S.paused && snap && !saver.waiting) {
    const ph = clock - Math.floor(clock);
    const pace = 1 - 0.35 * smoothstep(0.7, 0.76, ph) * (1 - smoothstep(0.88, 0.94, ph)) - 0.25 * smoothstep(0.16, 0.2, ph) * (1 - smoothstep(0.3, 0.34, ph));
    const rate = (saver.on ? saver.rate : 1 / S.spy) * pace;
    clock += dt * rate;
    const cap = hist.last + 0.9999;
    if (clock > cap) clock = cap;
    const end = snap.years - 1 + 0.55;
    if (simDone && clock >= end && !saver.on) { clock = end; setPaused(true); }
  }
  repack(false);
  growRoots();
  if (saver.on && saver.tick) saver.tick(dt);
  const p = clock - Math.floor(clock);
  const snow = S.snow ? snowCover(clock) : 0;
  const ls = litterSeason(p);
  const top = pack ? Math.max(0.3, pack.box[4]) : 1;
  R.frame({ clock: saver.waiting ? saver.hold : clock, time, wind: S.wind, snow, litter: ls.k, decay: ls.decay, range: [S.roots && rootsInfo ? -rootsInfo.D : 0, top] });
  if (S.follow && !saver.on) followStep(dt);
  R.controls.update();
  const w = $('gl').clientWidth, h = $('gl').clientHeight, o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.18;
  R.camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
  R.render();
  if (++frameNo % 8 === 0) readout();
  if (COARSE && !saver.on && pixelRatioStep(dpr, dt)) { R.renderer.setPixelRatio(dpr.ratio); R.resize(); }
}
const dpr = { ratio: ok ? R.renderer.getPixelRatio() : 1, min: 1, slow: 0 };

// ----------------------------------------------------------------- camera
// The sphere round what the camera frames: the plants, and the cut-away.
function frameTarget() {
  const b = pack ? pack.box : [-0.2, 0, -0.2, 0.2, 0.25, 0.2];
  const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
  const top = Math.max(0.12, b[4]);
  const bot = S.roots && rootsInfo ? -Math.min(rootsInfo.D, top * 0.9 + 0.1) : 0;
  const w = Math.max(b[3] - b[0], b[5] - b[2], 0.15) / 2;
  const r = Math.hypot(w, (top - bot) / 2) * 1.02 + 0.03;
  return { c: [cx, (top + bot) / 2, cz], r };
}
function followStep(dt) {
  const s = frameTarget(), cam = R.camera, ctl = R.controls;
  const w = innerWidth, h = innerHeight, o = occlusion(w, h);
  const { hF, wF } = clearFractions(o, w, h);
  const d = fitDistance(s.r, FOV, w / h, hF, wF, 0.86);
  const dir = cam.position.clone().sub(ctl.target);
  if (dir.lengthSq() < 1e-8) dir.set(1, 0.3, 1);
  dir.normalize();
  if (dir.y < 0.08) { dir.y = 0.08; dir.normalize(); }
  const k = Math.min(1, dt * 1.6);
  ctl.target.x += (s.c[0] - ctl.target.x) * k; ctl.target.y += (s.c[1] - ctl.target.y) * k; ctl.target.z += (s.c[2] - ctl.target.z) * k;
  const cur = cam.position.distanceTo(ctl.target), nd = cur + (d - cur) * k;
  cam.position.copy(ctl.target).addScaledVector(dir, nd);
}
function setFollow(on) {
  S.follow = on;
  const b = $('followBtn'); if (b) { b.classList.toggle('on', on); b.textContent = on ? 'Follow on' : 'Follow off'; }
}

// ---------------------------------------------------------------- overlays
// Margins in CSS px that the overlays cover. An overlay wider than tall
// covers the top or the base; any other covers a side. It counts only when
// it spans half of that edge or more. In the saver, the plate band counts.
const OVERLAYS = ['panel', 'dock', 'status', 'explain', 'legend'].map($).concat([document.querySelector('.topbar')]).filter(Boolean);
function occlusion(w, h) {
  if (saver.on) { const f = bandFrame(saver.band, w, h); return { l: 0, r: 0, t: f.t, b: f.b }; }
  return occlude(OVERLAYS.filter(el => !el.hidden).map(el => el.getBoundingClientRect()), w, h);
}

// ----------------------------------------------------------------- readout
function readout(force) {
  const se = seasonOf(clock);
  const sp = SPECIES[S.species];
  const st = lastStats;
  const h = pack ? pack.box[4] : 0;
  $('rdYear').textContent = `Year ${se.year + 1} · ${se.month}`;
  $('rdSeason').textContent = se.season[0].toUpperCase() + se.season.slice(1);
  $('rdHeight').textContent = h < 1 ? (h * 100).toFixed(0) + ' cm' : h.toFixed(1) + ' m';
  $('rdTrunk').textContent = (trunkRadius() * 200).toFixed(1) + ' cm';
  $('rdNodes').textContent = st ? st.live.toLocaleString() : '0';
  $('rdBuds').textContent = st ? st.buds.toLocaleString() : '0';
  $('rdLeaves').textContent = ok ? R.stats().leaves.toLocaleString() : '0';
  $('rdShed').textContent = st ? st.shed.toLocaleString() : '0';
  $('rdSim').textContent = snap ? `${hist.last + 1} of ${snap.years}${simDone ? '' : ' …'}` : 'starting';
  $('rdRoots').textContent = S.roots && roots ? roots.count.toLocaleString() : 'off';
  const state = S.paused ? 'paused' : simDone && clock >= snap.years - 1 + 0.5 ? 'grown' : 'growing';
  $('stMain').textContent = `${sp.label} · ${state}`;
  $('stRight').textContent = `year ${se.year + 1} · ${se.month} · ${h < 1 ? (h * 100).toFixed(0) + ' cm' : h.toFixed(1) + ' m'}`;
  const tl = $('timeline');
  if (tl && !tl.matches(':active')) { tl.max = snap ? String(snap.years) : '40'; tl.value = String(clock); }
  dockReadout();
  if (force) legend();
}
// the dock: the species name and the clock
let dockKey = '';
function dockReadout() {
  const c = dockClock(clock, seasonOf), name = SPECIES[S.species].label;
  const key = c.label + '|' + S.species + '|' + Math.round(c.frac * 100);
  if (key === dockKey) return;
  dockKey = key;
  $('dkYear').textContent = c.year; $('dkSub').textContent = c.sub;
  $('dkFill').style.width = (c.frac * 100).toFixed(0) + '%';
  $('dkFill').dataset.season = c.season;
  $('dockClock').setAttribute('aria-label', c.label);
  $('dockSpeciesName').textContent = name.split(' ').pop().replace(/^./, ch => ch.toUpperCase());
  $('dockSpecies').setAttribute('aria-label', `Species: ${name}. Tap for the next species`);
}
function legend() {
  const m = COLOUR_MODES.find(c => c.id === S.mode);
  $('legend').hidden = S.mode === 'natural' || saver.on;
  $('lgTitle').textContent = m.label;
  $('lgBar').style.background = cssGradient(S.grad, S.rev);
  const ends = { age: ['old wood', 'new shoots'], order: ['trunk', 'outer'], flow: ['few tips', 'all tips'], vigour: ['little', 'most'], height: ['deep', 'top'], light: ['shade', 'sun'] }[S.mode] || ['', ''];
  $('lgLo').textContent = ends[0]; $('lgHi').textContent = ends[1];
  $('colourHint').textContent = m.text;
}

// ---------------------------------------------------------------- controls
let picker = null;
function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('#colourBtns button, #dockColours button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  if (ok) R.setMode(mode);
  repack(true); rootsN = -1;
  legend();
}
function setGradient(id, rev) {
  S.grad = id; S.rev = !!rev;
  if (ok) R.setGradient(id, S.rev);
  if (picker && (picker.value !== id || picker.reversed !== S.rev)) picker.set(id, S.rev);
  legend();
}
function setPaused(p) {
  S.paused = p;
  $('playBtn').textContent = p ? 'Play' : 'Pause';
  const d = $('dockPlay'); d.textContent = p ? '▶' : '❚❚'; d.classList.toggle('on', p); d.setAttribute('aria-label', p ? 'Play' : 'Pause');
}
function setToggle(id, key, on, label) {
  S[key] = on; const b = $(id); b.textContent = label + (on ? ' on' : ' off'); b.classList.toggle('on', on);
}
function setRootsOn(on) {
  setToggle('rootsBtn', 'roots', on, 'Roots');
  if (ok && rootsInfo) R.setRootsOn(on, rootsInfo.R, rootsInfo.D);
  rootsN = -1; placeEco();
}
function setLeavesOn(on) { setToggle('leavesBtn', 'leaves', on, 'Leaves'); if (ok) R.setLeavesOn(on); }
const fmt = { spy: v => v.toFixed(0) + ' s', wind: v => Math.round(v * 100) + '%', lam: v => '×' + v.toFixed(2), alp: v => '×' + v.toFixed(2), xi: v => '×' + v.toFixed(2) };
function syncSliders() {
  for (const [id, key] of [['spy', 'spy'], ['wind', 'wind'], ['lam', 'lambda'], ['alp', 'alpha'], ['xi', 'xi']]) { $(id).value = S[key]; $(id + 'V').textContent = fmt[id](S[key]); }
  $('seed').value = S.seed;
}
function setSpecies(id) {
  S.species = id; syncSliders();
  document.querySelectorAll('#speciesBtns button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  const sp = SPECIES[id];
  $('speciesHint').textContent = `${sp.latin}: ${sp.kind}. ${sp.years} years.`;
  setPaused(false); setFollow(true); sow();
}
function setStand(st) {
  S.stand = st;
  document.querySelectorAll('#standBtns button').forEach(b => b.classList.toggle('on', b.dataset.stand === st));
  setPaused(false); setFollow(true); sow();
}

const panel = $('panel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open); $('dockPanel').setAttribute('aria-expanded', String(open));
}
const diagram = createDiagram($('diagram'));
function setExplain(open) {
  $('explain').hidden = !open; diagram.setOn(open);
  if (open && PHONE_Q.matches) setOpen(false);
}

function buildUI() {
  const sb = $('speciesBtns');
  for (const id of SPECIES_IDS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id; b.textContent = SPECIES[id].label.split(' ').pop().replace(/^./, c => c.toUpperCase());
    b.title = SPECIES[id].label;
    b.addEventListener('click', () => setSpecies(id)); sb.appendChild(b);
  }
  document.querySelectorAll('#standBtns button').forEach(b => b.addEventListener('click', () => setStand(b.dataset.stand)));
  const cb = $('colourBtns');
  for (const m of COLOUR_MODES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = m.id; b.textContent = m.label;
    b.addEventListener('click', () => setMode(m.id)); cb.appendChild(b);
  }
  document.querySelectorAll('#dockColours button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  picker = mountGradientPicker($('gradPick'), { value: S.grad, reversed: S.rev, onChange: (id, rev) => setGradient(id, rev) });

  $('playBtn').addEventListener('click', () => setPaused(!S.paused));
  $('dockPlay').addEventListener('click', () => setPaused(!S.paused));
  $('dockSpecies').addEventListener('click', () => setSpecies(nextId(SPECIES_IDS, S.species)));
  const again = () => { setPaused(false); setFollow(true); sow(); };
  $('sowBtn').addEventListener('click', again);
  $('dockSow').addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 999998); syncSliders(); again(); });
  $('seedBtn').addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 999998); syncSliders(); again(); });
  $('seed').addEventListener('change', () => { S.seed = Math.max(1, Math.min(999999, Math.round(+$('seed').value) || 1)); syncSliders(); again(); });
  for (const [id, key] of [['spy', 'spy'], ['wind', 'wind']]) $(id).addEventListener('input', () => { S[key] = +$(id).value; $(id + 'V').textContent = fmt[id](S[key]); });
  for (const [id, key] of [['lam', 'lambda'], ['alp', 'alpha'], ['xi', 'xi']]) {
    $(id).addEventListener('input', () => { S[key] = +$(id).value; $(id + 'V').textContent = fmt[id](S[key]); });
    $(id).addEventListener('change', () => { S[key] = +$(id).value; again(); });
  }
  const tl = $('timeline');
  tl.addEventListener('input', () => { clock = Math.min(+tl.value, hist.last + 0.9999); setFollow(true); });
  $('leavesBtn').addEventListener('click', () => setLeavesOn(!S.leaves));
  $('rootsBtn').addEventListener('click', () => setRootsOn(!S.roots));
  $('snowBtn').addEventListener('click', () => setToggle('snowBtn', 'snow', !S.snow, 'Snow'));
  $('followBtn').addEventListener('click', () => setFollow(!S.follow));
  $('explainBtn').addEventListener('click', () => setExplain(true));
  $('explainClose').addEventListener('click', () => setExplain(false));

  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // the sheet grip: a tap toggles half and full height, a drag down closes
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // the canvas: one finger orbits and keeps the follow; a pinch, a pan or a
  // wheel stops it; a double tap restores it (layout.js createGestures)
  const gl = $('gl'), G = createGestures();
  const ev = e => ({ id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: e.timeStamp, button: e.button, mod: e.ctrlKey || e.metaKey || e.shiftKey });
  const act = r => { if (r) setFollow(r.follow); };
  gl.addEventListener('pointerdown', e => { $('hint').classList.add('gone'); act(G.down(ev(e))); });
  gl.addEventListener('pointermove', e => act(G.move(ev(e))));
  gl.addEventListener('pointerup', e => act(G.up(ev(e))));
  gl.addEventListener('pointercancel', e => act(G.cancel(ev(e))));
  gl.addEventListener('dblclick', () => setFollow(true));
  gl.addEventListener('wheel', () => act(G.wheel()), { passive: true });
  setTimeout(() => $('hint').classList.add('gone'), 8000);
  addEventListener('resize', () => ok && R.resize());
}

// ------------------------------------------------------------------- boot
const saver = { on: false, rate: 1, band: null, tick: null, waiting: false, hold: 0 };
buildUI();
syncSliders();
document.querySelectorAll('#speciesBtns button').forEach(b => b.classList.toggle('on', b.dataset.id === S.species));
document.querySelectorAll('#standBtns button').forEach(b => b.classList.toggle('on', b.dataset.stand === S.stand));
$('speciesHint').textContent = `${SPECIES[S.species].latin}: ${SPECIES[S.species].kind}. ${SPECIES[S.species].years} years.`;
if (ok) { R.resize(); R.setGradient(S.grad, S.rev); }
setMode(S.mode);
setRootsOn(false);
sow();
requestAnimationFrame(frame);

// ============================================================ screensaver
// window.snSaver (protocol: lib/screensaver.js). enter() plays a seeded
// shuffle of shots (saver.js makeShots and shotPlan): a whole life in a
// fast time-lapse, a slow autumn, a spring, a winter, a grove that
// competes for light, the age heatmap of a young tree, the June meadow
// from eye height (saver.js meadowCamera). Each shot sows its
// own seed; a shot that needs a mature plant waits (on the last frame of
// the previous shot) until the model has reached its first year. The
// camera fits the plants in the clear band of the plate, aims a little
// above the crown centre, and orbits slowly.
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const rnd = rng((o.seed >>> 0) || 1);
    const label = typeof o.label === 'function' ? o.label : () => {};
    saver.on = true; saver.band = null;
    const html = document.documentElement, added = !html.classList.contains('sn-saver');
    html.classList.add('sn-saver');
    setOpen(false); setExplain(false); $('legend').hidden = true;
    let bandFn = null, bandAt = -1e9;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no plate */ });
    const shots = makeShots(rnd, 24, calm);
    const CODE = { lang: 'js', name: 'grow.js · Borchert-Honda allocation', text: codeExtract(createSim.toString(), '// apical dominance eases', 13) };
    let k = -1, shot = null, plan = null, t = 0, az = 0;
    const plate = () => {
      if (!shot) return;
      const sp = SPECIES[shot.species], se = seasonOf(clock), st = lastStats;
      const mode = COLOUR_MODES.find(c => c.id === shot.mode);
      label({
        title: shot.stand === 'mixed' ? 'Woodland edge' : sp.label,
        sub: `${plan.caption} · year ${se.year + 1}, ${se.month}` + (shot.mode === 'natural' ? '' : ' · coloured by ' + mode.label.toLowerCase() + ' · ' + GRADIENTS[shot.gradient].label),
        params: [
          { sym: 'h', name: 'height', value: (pack ? pack.box[4] : 0).toFixed(1) + ' m', cls: 'm1' },
          { sym: 'N', name: 'live metamers', value: st ? st.live.toLocaleString() : '0', cls: 'm2' },
          { sym: 'B', name: 'buds', value: st ? st.buds.toLocaleString() : '0', cls: 'm3' },
          { sym: 'L', name: 'leaves', value: ok ? R.stats().leaves.toLocaleString() : '0', cls: 'm4' },
        ],
        tex: [String.raw`v_m = v\,\frac{\lambda Q_m}{\lambda Q_m + (1-\lambda)\,Q_l},\qquad v_l = v - v_m`,
          String.raw`Q = \max\!\Bigl(0,\ \frac{C - s + a}{C}\Bigr),\qquad s \mathrel{+}= a\,b^{-k}`],
        rules: [['λ', 'm2'], ['b', 'm3']],
        eq: ['v_m = v λQ_m / (λQ_m + (1 − λ)Q_l)', 'Q = (C − s + a) / C', 'r^n = Σ r_child^n'],
        lines: shot.kind === 'meadow'
          ? ['Grass tussocks in Thomas clusters, flowers in drifts by species, stones by a power law.', `${sp.latin}. Self-organising growth after Palubicki et al. 2009.`]
          : [`${sp.latin}. Self-organising growth after Palubicki et al. 2009.`],
        code: CODE,
      });
    };
    const begin = () => {
      saver.waiting = false; t = 0;
      S.paused = false; S.follow = false;
      S.wind = shot.wind * (1 - 0.5 * calm);
      if (ok) { R.setLeavesOn(true); }
      setMode(shot.mode); setGradient(shot.gradient, shot.reversed);
      clock = plan.t0; saver.rate = plan.rate;
      az = shot.az0;
      plate();
    };
    const next = () => {
      k = (k + 1) % shots.length; shot = shots[k]; plan = shotPlan(shot);
      S.species = shot.species; S.stand = shot.stand; S.seed = shot.seed; S.lambda = S.alpha = S.xi = 1;
      S.roots = false; if (ok) R.setRootsOn(false, 1, 1);
      // keep the last frame of the old shot on screen while the model runs
      saver.hold = clock; saver.waiting = !!pack;
      const keepPack = pack;
      sow();
      pack = keepPack;
    };
    saver.tick = dt => {
      const now = performance.now();
      if (bandFn && now - bandAt > 400) { bandAt = now; const b = bandFn(innerHeight); if (b) saver.band = b; }
      if (saver.waiting || !snap || hist.last < Math.floor(plan.t0)) {
        if (snap && hist.last >= Math.floor(plan.t0)) begin();
        else { saver.waiting = !!pack; if (!pack) return; }
        if (saver.waiting) return;
      }
      t += dt;
      if (t > shot.dur || clock >= plan.t1) next();
      // framing: the plants in the plate band, calm and wide
      const s = frameTarget(), w = innerWidth, h = innerHeight, f = bandFrame(saver.band, w, h);
      const d = fitDistance(s.r, FOV, w / h, f.hFrac, f.wFrac, 0.8);
      az += shot.orbit * dt;
      if (shot.kind === 'meadow') {   // eye height in the grass, the tree over it
        const mc = meadowCamera(s, d, az, groundY, eco ? eco.params.edge : null);
        R.controls.target.set(...mc.target); R.camera.position.set(...mc.pos);
        return;
      }
      const ce = Math.cos(shot.el);
      const ty = s.c[1] + s.r * 0.08;
      R.controls.target.set(s.c[0], ty, s.c[2]);
      R.camera.position.set(s.c[0] + Math.sin(az) * ce * d, ty + Math.sin(shot.el) * d, s.c[2] + Math.cos(az) * ce * d);
    };
    next();
    this._plate = setInterval(plate, 1000);
    this._added = added;
    return { canvas: $('gl'), warmupMs: 1500 };
  },
  exit() {
    saver.on = false; saver.tick = null; saver.band = null;
    clearInterval(this._plate);
    if (this._added) document.documentElement.classList.remove('sn-saver');
    S.wind = 0.35; syncSliders(); legend(); setLeavesOn(true); setPaused(false); setFollow(true);
    setOpen(!PHONE_Q.matches);
  },
};

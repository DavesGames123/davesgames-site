// ============================================================================
//  CORAL REEF GROWTH  ·  main script (ES module, three r160)
// ----------------------------------------------------------------------------
//  reef.js grows the colonies in a time budget each frame. This script
//  sends each new particle to the mesh worker (mesh-worker.js: the coral
//  SDF of coral-sdf.js and lib/dla-sdf.js), puts the brick meshes that
//  come back into the scene (scene.js applyBricks), writes the
//  per-particle data textures (colour, birth, radius), refreshes the
//  colours a few times a second, and binds the controls. With no module
//  worker, the same mesher runs here in a small time budget.
//
//  CLOCK. nowMs = performance.now() - T0. The reef stamps each polyp with
//  nowMs (reef.birth), and the shader gets nowMs / 1000 as uTime, so a new
//  polyp scales in and glows from the frame where it joined.
//
//  FRAMING. clearArea() measures the panel and the dock. The camera view
//  offset (setViewOffset) puts the reef in the middle of the clear part.
//  A preset load also sets the camera distance with frameFit (saver.js).
//  The saver uses the same fit with the clear band of the label plate.
//
//  GREP MAP
//    grep -n 'function loadPreset'   regrow a preset
//    grep -n 'function syncPolyps'   new particles to the mesher and the data textures
//    grep -n 'function startMesher'  the mesh worker (or the main-thread mesher)
//    grep -n 'function loadDecor'    the scanned models (assets.js)
//    grep -n 'function refresh'      radii, natural colours and t of all polyps
//    grep -n 'function setMode'      colour by
//    grep -n 'function clearArea'    the parts of the canvas under overlays
//    grep -n 'function plantAt'      tap the seabed to plant a colony
//    grep -n 'function buildUI'      the controls
//    grep -n 'function setOpen'      the panel, the phone sheet and the dock
//    grep -n 'function frame'        the loop
//    grep -n 'window.snSaver'        the screensaver hook
// ============================================================================
import { createScene } from './scene.js';
import { createReef, SPECIES, SPECIES_IDS, PRESETS, PRESET_IDS, polypRadius, speciesHook } from './reef.js';
import { MODES, colourT, naturalRGB, radiiOf, fieldsOf } from './colour.js';
import { createCoralMesher, groove } from './coral-sdf.js';
import { meshRock } from './terrain.js';
import { DECOR, parseCRM, scatterDecor } from './assets.js';
import { shotList, frameFit } from './saver.js';
import { lut, cssGradient, mountGradientPicker, GRADIENTS } from '../../lib/growth-gradients.js';
import { PARAM_INFO } from '../../lib/dla-engine.js';
import { mountDiagram } from './diagram.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CAP = COARSE ? 6000 : 16000;          // particles (polyps) on the whole reef
const BUDGET = COARSE ? 4 : 6;              // ms of growth per frame
const RATE = COARSE ? 260 : 520;            // particles per second at speed 1
const FOV = 40;
const T0 = performance.now();

const G = {
  preset: 'mixed', seed: 1, mode: 'natural', gradient: 'reef', rev: false,
  playing: true, speed: 1, dir: 20, cur: 0.5, nutrient: 1, temp: 27,
  caust: true, snow: true, shaft: true, orbit: false, plant: 'staghorn', spSel: 'staghorn',
  polyps: true, detail: !COARSE,
};
let saverOn = false, saver = null;

// ── scene and reef ──────────────────────────────────────────────────────────
const canvas = $('view');
const S = createScene({ canvas, cap: CAP, coarse: COARSE, onNoGL: () => { $('nogl').hidden = false; } });
const reef = createReef({ seed: G.seed, capTotal: CAP });
const radBuf = new Float32Array(CAP), tBuf = new Float32Array(CAP), natBuf = new Float32Array(CAP * 3);
let synced = 0, refreshAt = 0, hMax = 0, dirty = true, registered = 0;

const nowMs = () => performance.now() - T0;

// ── the mesher: a module worker, or the same code here ─────────────────────
let worker = null, local = null, gen = 0, rockId = 0;
const rockWait = new Map();
function startMesher() {
  try {
    worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'bricks') { if (m.gen === gen && S) S.applyBricks(m.list); }
      else if (m.type === 'rock') { const f = rockWait.get(m.id); rockWait.delete(m.id); if (f) f(m); }
    };
    worker.onerror = () => { worker = null; useLocal(); };
    worker.postMessage({ type: 'budget', ms: COARSE ? 9 : 12 });
  } catch (e) { worker = null; useLocal(); }
}
function useLocal() {
  if (local) return;
  local = createCoralMesher({ polyps: COARSE ? 0.35 : 1 });
  for (const f of rockWait.values()) f(null);
  rockWait.clear();
  registered = 0; synced = 0;           // send the reef again to the local mesher
  if (S) { S.clearColonies(); }
}
// A rock mesh, in the worker when there is one.
function meshRockAsync(rk) {
  if (!worker) return Promise.resolve(meshRock(rk, COARSE ? 0.5 : 0.4));
  const id = ++rockId;
  return new Promise((res) => {
    rockWait.set(id, m => res(m || meshRock(rk, COARSE ? 0.5 : 0.4)));
    worker.postMessage({ type: 'rock', id, rock: rk, cell: COARSE ? 0.5 : 0.4 });
  });
}
function mesherReset() {
  gen++;
  if (worker) worker.postMessage({ type: 'reset', polyps: COARSE ? 0.35 : 1 });
  if (local) local = createCoralMesher({ polyps: COARSE ? 0.35 : 1 });
  registered = 0;
}
function registerColonies() {
  for (; registered < reef.colonies.length; registered++) {
    const c = reef.colonies[registered], u = c.user;
    const d = { type: 'colony', k: c.k, id: c.id, normal: u.normal.slice(), stalk: c.sp.stalk };
    if (worker) worker.postMessage(d); else if (local) local.addColony(d);
    if (S) S.addColonyGroup(c.k, c.id, [u.bx, u.by, u.bz]);
  }
}

// The reef as a wide, low ellipse: half sizes across (rx) and up (ry) the
// screen, for frameFit.
function subjectSize() {
  if (reef.colonies.length === 1 && !PRESETS[reef.preset]) { const r = reef.colonies[0].id === 'fan' ? 30 : 24; return { rx: r, ry: r }; }
  const R = (PRESETS[reef.preset] || PRESETS.mixed).R + 18;
  return { rx: R, ry: 0.62 * R };
}

// Regrow a preset from the seed: rocks, colony seeds, camera fit.
function loadPreset(pid = G.preset, seed = G.seed, fit = true) {
  G.preset = pid; G.seed = seed;
  reef.reset(seed);
  reef.loadPreset(pid);
  afterReset(fit);
}
function afterReset(fit) {
  synced = 0; hMax = 0; refreshAt = 0;
  mesherReset();
  if (!S) return;
  S.clearColonies();
  S.setRocks(reef.rocks, meshRockAsync);
  placeDecor();
  syncPolyps(); refresh();
  if (fit) fitCamera(true);
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.id === reef.preset));
}

// New particles (synced..count): to the mesher (local frame of the
// colony), and into the data textures with a radius, a t and a natural
// colour that the next refresh corrects.
const SWAY = id => Math.round((SPECIES[id].sway || 0) * 4);
function syncPolyps() {
  registerColonies();
  const n = reef.count; if (n <= synced) return;
  const data = new Float32Array((n - synced) * 7);
  for (let g = synced, o = 0; g < n; g++, o += 7) {
    const c = reef.colonies[reef.col[g]], i = reef.loc[g], P = c.model.pos;
    data[o] = c.k; data[o + 1] = i; data[o + 2] = c.model.parent[i];
    data[o + 3] = P[i * 3]; data[o + 4] = P[i * 3 + 1]; data[o + 5] = P[i * 3 + 2]; data[o + 6] = g;
    radBuf[g] = polypRadius(c.sp, 1);
    const h = reef.py[g] - reef.gy[g]; if (h > hMax) hMax = h;
    tBuf[g] = G.mode === 'flow' ? 0 : G.mode === 'colony' ? (reef.col[g] * 0.618034 + 0.12) % 1 : G.mode === 'height' ? h / Math.max(1, hMax) : 1;
    const q = c.sp.tip; natBuf[g * 3] = q[0]; natBuf[g * 3 + 1] = q[1]; natBuf[g * 3 + 2] = q[2];
  }
  if (worker) worker.postMessage({ type: 'add', data }, [data.buffer]);
  else if (local) for (let o = 0; o < data.length; o += 7) local.add(data[o], data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5], data[o + 6]);
  writeParticles(synced, n, null);
  synced = n;
}

// Data textures of particles from..to (sub: subtree sizes or null).
function writeParticles(from, to, F) {
  if (!S) return;
  S.setParticles(from, to, (g, A, B, o) => {
    const c = reef.colonies[reef.col[g]];
    A[o] = natBuf[g * 3]; A[o + 1] = natBuf[g * 3 + 1]; A[o + 2] = natBuf[g * 3 + 2]; A[o + 3] = tBuf[g];
    const tip = F ? Math.max(0, Math.min(0.999, 1 - Math.log2(F.sub[g]) / 5)) : 0.999;
    B[o] = reef.birth[g] / 1000; B[o + 1] = radBuf[g]; B[o + 2] = SWAY(c.id) * 2 + tip; B[o + 3] = reef.py[g] - c.user.by;
  });
}

// All particles: radii from subtree sizes, natural colours, t of the mode.
function refresh() {
  if (!S) return;
  const F = fieldsOf(reef);
  radiiOf(reef, radBuf, F); naturalRGB(reef, natBuf, F); colourT(reef, G.mode, tBuf, F);
  writeParticles(0, reef.count, F);
  dirty = false;
}

// ── scanned models ──────────────────────────────────────────────────────────
let models = null;
async function loadDecor() {
  const out = {};
  await Promise.all(DECOR.map(async d => {
    try { const r = await fetch(`assets/models/${d.id}.bin`); if (r.ok) out[d.id] = parseCRM(await r.arrayBuffer()); } catch (e) { /* skip this model */ }
  }));
  models = out;
  placeDecor();
}
function placeDecor() {
  if (!S || !models) return;
  const keep = (x, z, r) => !reef.rocks.some(q => Math.hypot(q.x - x, q.z - z) < Math.max(q.rx, q.rz) + r + 1.5)
    && !reef.colonies.some(c => Math.hypot(c.user.bx - x, c.user.bz - z) < 16 + r);
  const kinds = {}; for (const d of DECOR) kinds[d.id] = d.kind;
  S.setDecor(models, scatterDecor(G.seed, keep, COARSE ? 0.5 : 1), kinds);
}

// ── colour ──────────────────────────────────────────────────────────────────
const LEG = {
  age: ['Age', 'old', 'new'], depth: ['Depth (hops to the seed)', 'seed', 'tips'], height: ['Height over the sand', 'low', 'high'],
  flow: ['Flow (subtree size)', 'tips', 'trunk'], light: ['Light and nutrient exposure', 'shaded', 'open'],
};
const MODE_NOTE = {
  natural: 'The colours of the species. New polyps glow a little as they join.',
  age: 'The order of joining. The growing front is at the hot end of the gradient, so the colours move while the reef grows.',
  depth: 'Hops from the seed, per colony.',
  height: 'Height over the sand, over the whole reef.',
  flow: 'The size of the subtree that a polyp feeds: the trunks carry the most.',
  light: 'An estimate: high polyps with few close neighbours get the most light and food.',
  colony: 'One colour per colony, from the gradient.',
};
function setGradient(id, rev) {
  G.gradient = id; G.rev = !!rev;
  if (S) S.setLut(lut(id, 256, G.rev));
  drawLegend();
}
function setMode(m) {
  G.mode = m;
  if (S) { S.U.uMode.value = m === 'natural' ? 0 : m === 'age' ? 1 : 2; colourT(reef, m, tBuf); S.writeT(tBuf, reef.count); }
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
  reef.setCurrent(G.dir, G.cur);
  if (S) S.U.uCur.value.set(Math.cos(G.dir * Math.PI / 180) * G.cur, Math.sin(G.dir * Math.PI / 180) * G.cur);
}
function setTemp(t) {
  G.temp = t; reef.env.temp = t;
  if (S) S.U.uBleach.value = reef.bleach;
}

// ── framing ─────────────────────────────────────────────────────────────────
// Px of the canvas under the panel and the dock at each edge. An overlay
// wider than tall (in canvas terms) covers the top or the base; any other
// covers a side. Small corner boxes (readout, legend) do not count.
function clearArea(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const el of [$('panel'), $('dock')]) {
    if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  if (saverOn && saver && saver.band) { o.t = Math.max(o.t, saver.band.t); o.b = Math.max(o.b, saver.band.b); }
  return o;
}
const center = { x: 0, y: 14, z: 0 };
function fitNow() {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  return frameFit(Object.assign({ w, h, clear: clearArea(w, h), fov: FOV }, subjectSize()));
}
// Set the camera distance (on a load) and the view offset target.
function fitCamera(dist) {
  if (!S) return;
  const f = fitNow();
  S.view.tox = f.ox; S.view.toy = f.oy;
  if (dist && !saverOn) {
    const c = S.controls, cam = S.camera;
    c.target.set(center.x, center.y, center.z);
    const d = cam.position.clone().sub(c.target); if (d.lengthSq() < 1) d.set(1, 0.6, 1);
    d.normalize().multiplyScalar(Math.min(c.maxDistance, f.dist));
    cam.position.copy(c.target).add(d);
    c.update();
  }
}

// ── tap to plant ────────────────────────────────────────────────────────────
let downs = new Map(), tap = null;
function onDown(e) {
  downs.set(e.pointerId, true);
  tap = downs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
  hideHint();
}
function onUp(e) {
  downs.delete(e.pointerId);
  if (!tap || tap.id !== e.pointerId || saverOn) return;
  const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y), dt = performance.now() - tap.t;
  tap = null;
  if (moved < 7 && dt < 450 && e.button === 0) plantAt(e.clientX, e.clientY);
}
let ray = null;
async function plantAt(cx, cy) {
  if (!S) return;
  const THREE = S.THREE;
  ray = ray || new THREE.Raycaster();
  const r = canvas.getBoundingClientRect();
  const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, S.camera);
  // the nearest hit on a rock or the seabed: a rock hit plants on that rock
  const hit = ray.intersectObjects([S.ground, ...S.rocks.children], false)[0];
  if (!hit) return;
  const x = hit.point.x, z = hit.point.z, onRock = hit.object.userData.rock || null;
  if (Math.hypot(x, z) > 140) return flash('Plant nearer to the reef.');
  if (reef.colonies.some(c => Math.hypot(c.user.bx - x, c.user.bz - z) < 10)) return flash('Too near a colony: tap open rock or sand.');
  if (reef.count >= reef.limit - 60) return flash('The reef is at its polyp cap. Regrow to plant again.');
  const c = reef.addColony(G.plant, x, z, onRock ? { share: Math.max(6, reef.colonies.length + 1), rock: onRock, at: [x, hit.point.y, z] } : { share: Math.max(6, reef.colonies.length + 1) });
  if (!c) return;
  if (!onRock) S.addRock(c.user.rock, meshRockAsync);
  syncPolyps();
  flash(`Planted: ${SPECIES[G.plant].label}`);
}
let flashT = 0;
function flash(msg) { const el = $('rState'); el.textContent = msg; flashT = performance.now() + 2600; }

// ── UI ──────────────────────────────────────────────────────────────────────
function hideHint() { $('hint').classList.add('gone'); }
const fmt = (v, d = 2) => (+v).toFixed(d);
function bindRange(id, vid, key, show, on) {
  const el = $(id), vl = $(vid);
  const up = () => { const v = +el.value; G[key] = v; vl.textContent = show(v); on && on(v); };
  el.value = G[key]; el.addEventListener('input', up); up();
}
function chips(el, items, cur, on) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = it.id;
    if (it.sw) { const s = document.createElement('span'); s.className = 'sw'; s.style.background = it.sw; b.appendChild(s); }
    b.appendChild(document.createTextNode(it.label));
    b.classList.toggle('on', it.id === cur);
    b.addEventListener('click', () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); on(it.id); });
    el.appendChild(b);
  }
}
const rgbCss = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

function setPlaying(p) {
  G.playing = p;
  const t = p ? '❚❚ Pause' : '▶ Grow';
  $('bPlay').textContent = t; $('bPlay').classList.toggle('on', p);
  $('dockPlay').innerHTML = p ? '<i>❚❚</i><span>Pause</span>' : '<i>▶</i><span>Grow</span>';
  $('dockPlay').setAttribute('aria-label', p ? 'Pause' : 'Grow');
}

function buildSpeciesParams() {
  const id = G.spSel, box = $('spParams'), sp = SPECIES[id];
  $('spNote').textContent = `${sp.label} (${sp.latin}): ${sp.form.toLowerCase()}.`;
  box.innerHTML = '';
  for (const P of PARAM_INFO) {
    const row = document.createElement('div'); row.className = 'row';
    const inId = `p_${P.key}`;
    row.innerHTML = `<label for="${inId}">${P.text.replace(/\.$/, '')}<code>${P.dlaf}</code></label><input type="range" id="${inId}" min="${P.min}" max="${P.max}" step="${P.step}"><span class="val"></span>`;
    const inp = row.querySelector('input'), val = row.querySelector('.val');
    inp.value = reef.params[id][P.key];
    const show = () => { val.textContent = (+inp.value).toFixed(P.step < 1 ? 2 : 0); };
    inp.addEventListener('input', () => { reef.setParams(id, { [P.key]: +inp.value }); show(); });
    show();
    box.appendChild(row);
  }
}

function buildUI() {
  chips($('presets'), PRESET_IDS.map(id => ({ id, label: PRESETS[id].label })), G.preset, id => { loadPreset(id, G.seed); });
  const spItems = SPECIES_IDS.map(id => ({ id, label: SPECIES[id].label, sw: rgbCss(SPECIES[id].base) }));
  chips($('plant'), spItems, G.plant, id => { G.plant = id; });
  chips($('spPick'), spItems, G.spSel, id => { G.spSel = id; buildSpeciesParams(); });
  chips($('modes'), MODES, G.mode, id => setMode(id));
  mountGradientPicker($('gradPick'), { value: G.gradient, reversed: G.rev, onChange: (id, rev) => setGradient(id, rev) });
  buildSpeciesParams();
  $('spReset').addEventListener('click', () => { reef.setParams(G.spSel, SPECIES[G.spSel].params); buildSpeciesParams(); });

  bindRange('sSpeed', 'vSpeed', 'speed', v => `${fmt(v)}×`, v => { reef.env.speed = v; });
  bindRange('sDir', 'vDir', 'dir', v => `${v.toFixed(0)}°`, setCurrent);
  bindRange('sCur', 'vCur', 'cur', v => fmt(v), setCurrent);
  bindRange('sNut', 'vNut', 'nutrient', v => `${fmt(v)}×`, v => { reef.env.nutrient = v; });
  bindRange('sTemp', 'vTemp', 'temp', v => `${v.toFixed(1)} °C`, v => {
    setTemp(v);
    const b = reef.bleach;
    $('bleachNote').classList.toggle('warn', b > 0.02);
    $('bleachNote').textContent = b > 0.98 ? 'Bleached: the corals have lost their algae and do not grow. Cool the water to recover.'
      : b > 0.02 ? `Bleaching: growth is down ${Math.round(b * 100)}% and the colour fades.` : 'Above about 30 °C the corals bleach: they lose their colour and stop growing.';
  });

  const tog = (id, key, on) => { const b = $(id); b.classList.toggle('on', G[key]); b.addEventListener('click', () => { G[key] = !G[key]; b.classList.toggle('on', G[key]); on(G[key]); }); };
  tog('tCaust', 'caust', v => { if (S) S.U.uCaust.value = v ? 1 : 0; });
  tog('tSnow', 'snow', () => {});
  tog('tShaft', 'shaft', v => { if (S) S.U.uShaft.value = v ? 1 : 0; });
  tog('tOrbit', 'orbit', v => { if (S) S.controls.autoRotate = v; });
  tog('tPolyps', 'polyps', () => {});
  tog('tDetail', 'detail', () => {});

  $('bPlay').addEventListener('click', () => setPlaying(!G.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!G.playing));
  const regrow = () => { loadPreset(G.preset, G.seed, false); setPlaying(true); };
  $('bRegrow').addEventListener('click', regrow);
  $('dockRegrow').addEventListener('click', regrow);
  $('bSeed').addEventListener('click', () => { loadPreset(G.preset, 1 + Math.floor(Math.random() * 1e6), false); setPlaying(true); });

  // explainer
  const about = $('about'); let diag = null;
  $('aboutOpen').addEventListener('click', () => {
    about.hidden = false;
    if (!diag) diag = mountDiagram($('diag'), { gradient: () => G.gradient });
    requestAnimationFrame(() => diag.start());
    if (PHONE_Q.matches) setOpen(false);
  });
  $('aboutClose').addEventListener('click', () => { about.hidden = true; if (diag) diag.stop(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !about.hidden) { about.hidden = true; if (diag) diag.stop(); } });

  // panel, phone sheet and dock
  const panel = $('panel');
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  document.querySelectorAll('#dock .tab').forEach(t => t.addEventListener('click', () => {
    const same = panel.dataset.grp === t.dataset.grp && panel.classList.contains('open');
    panel.dataset.grp = t.dataset.grp;
    setOpen(!same);
  }));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', e => { downs.delete(e.pointerId); tap = null; });
  setTimeout(hideHint, 9000);
}

function setOpen(open) {
  const panel = $('panel');
  if (!panel.dataset.grp) panel.dataset.grp = 'reef';
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.querySelectorAll('#dock .tab').forEach(t => t.classList.toggle('on', open && t.dataset.grp === panel.dataset.grp));
}

// ── readout ─────────────────────────────────────────────────────────────────
let rate = 0, walkRate = 0, lastWalks = 0, lastJoined = 0, readT = 0;
function readout(dt) {
  readT += dt; if (readT < 0.25) return;
  const dj = reef.joined - lastJoined, dw = reef.walks - lastWalks;
  lastJoined = reef.joined; lastWalks = reef.walks;
  rate += (dj / readT - rate) * 0.5; walkRate += (dw / readT - walkRate) * 0.5; readT = 0;
  $('rPolyps').textContent = reef.count.toLocaleString();
  $('rCol').textContent = String(reef.colonies.length);
  $('rH').textContent = hMax.toFixed(0);
  $('rRate').textContent = Math.round(rate).toLocaleString();
  $('rWalk').textContent = walkRate >= 1e5 ? `${(walkRate / 1e6).toFixed(2)} M` : Math.round(walkRate).toLocaleString();
  if (performance.now() > flashT) {
    const b = reef.bleach;
    $('rState').textContent = b > 0.98 ? 'Bleached: no growth' : b > 0.02 ? `Bleaching: growth −${Math.round(b * 100)}%` : !G.playing ? 'Paused' : reef.done() ? 'Grown to the polyp cap' : '';
  }
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), frameN = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, t - last); last = t; const dt = dtMs / 1000;
  const now = nowMs();
  if (G.playing && !reef.done()) {
    const n = saverOn && saver ? reef.step(dtMs, BUDGET, now, saver.base) : reef.step(dtMs, BUDGET, now, RATE);
    if (n) { syncPolyps(); dirty = true; }
  }
  if (dirty && now > refreshAt) { refresh(); refreshAt = now + (reef.count > 8000 ? 600 : 350); }
  if (S) {
    if (local) S.applyBricks(local.update(COARSE ? 3 : 4));
    S.flushChunks(COARSE ? 2.5 : 3.5, now);
  }
  if (saverOn && saver) saver.tick(dt, now);
  readout(dt);
  if (!S) return;
  S.U.uTime.value = now / 1000;
  S.U.uCount.value = reef.count;
  S.U.uSwayK.value = REDUCED ? 0.3 : 1;
  S.U.uCaust.value = G.caust ? 1 : 0;
  S.U.uDetail.value = G.detail ? 1 : 0;
  S.scene.traverse && polypVis(S, G.polyps);
  // fog follows the camera distance, so the reef reads at any zoom
  const camD = S.camera.position.distanceTo(saverOn && saver ? S.camera.userData.tgt || S.controls.target : S.controls.target);
  S.U.uFogDen.value = Math.min(0.006, Math.max(0.0011, 0.45 / Math.max(60, camD)));
  const a = G.dir * Math.PI / 180, sn = S.U.uSnowOff.value;
  if (G.snow || saverOn) { sn.x += Math.cos(a) * G.cur * 7 * dt; sn.y -= 2.4 * dt; sn.z += Math.sin(a) * G.cur * 7 * dt; }
  S.scene.children.forEach(o => { if (o.isPoints) o.visible = G.snow || saverOn; });
  if (!saverOn) {
    if ((frameN++ & 7) === 0) { const f = fitNow(); S.view.tox = f.ox; S.view.toy = f.oy; }
    S.controls.update();
  }
  S.render(dt, now);
}

// Show or hide the polyp meshes (cheap: the flag only changes on a toggle).
let polypShown = true;
function polypVis(S, on) {
  if (on === polypShown && !S.dirtyChunks) return;
  polypShown = on;
  S.scene.traverse(o => { if (o.isMesh && o.geometry && o.geometry.isInstancedBufferGeometry && o.geometry.attributes.iPos) o.visible = on; });
}

function onResize() { if (S) { S.resize(); fitCamera(false); } }
addEventListener('resize', onResize);

// ── start ───────────────────────────────────────────────────────────────────
buildUI();
setGradient(G.gradient, G.rev);
setMode(G.mode);
setCurrent();
setTemp(G.temp);
startMesher();
if (S) { S.resize(); loadPreset(G.preset, G.seed, true); loadDecor(); requestAnimationFrame(frame); }

// ── screensaver ─────────────────────────────────────────────────────────────
// A seeded shuffle of shots (saver.js shotList). Each shot regrows a reef
// preset or one colony from its own seed, with its own gradient and colour
// mode, for 5 to 12 s. A quarter of the growth is done while the canvas is
// faded out, so the shot opens on a young reef that grows on screen. The
// camera turns slowly round the reef and aims between the reef centre and
// the growth front (the mean of the newest polyps). The distance comes
// from frameFit with the clear band of the plate (plateBand).
window.snSaver = {
  enter(o = {}) {
    if (!S) return { canvas, warmupMs: 0 };
    saverOn = true;
    document.documentElement.classList.add('sn-saver');
    setOpen(false); $('about').hidden = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const label = typeof o.label === 'function' ? o.label : () => {};
    const shots = shotList((o.seed >>> 0) || 1, 40);
    const saved = { mode: G.mode, gradient: G.gradient, rev: G.rev, dir: G.dir, cur: G.cur, temp: G.temp, preset: G.preset, seed: G.seed, playing: G.playing, speed: reef.env.speed, nutrient: reef.env.nutrient };
    S.controls.enabled = false; S.controls.autoRotate = false;
    setTemp(27.5); setPlaying(true);
    const st = { i: -1, shot: null, t: 0, az: 0, tgt: { x: 0, y: 12, z: 0 }, dist: 200, fading: false, bandFn: null, bandT: 0, labT: 0 };
    saver = { band: null, base: 900, tick, st, saved };
    import('../../lib/saver-clear.js').then(m => { st.bandFn = m.plateBand; }).catch(() => { /* no plate */ });

    function makeLabel() {
      const s = st.shot; if (!s) return null;
      const P = PRESETS[s.preset], sp = SPECIES[s.species];
      const mix = s.kind === 'reef' ? P.mix : [s.species];
      const hookSp = s.kind === 'reef' ? mix[(s.seed >>> 3) % mix.length] : s.species;
      const H = speciesHook(hookSp);
      const brain = s.kind === 'colony' && s.species === 'boulder';
      const modeLbl = (MODES.find(m => m.id === s.mode) || MODES[0]).label;
      return {
        title: s.kind === 'reef' ? P.label : sp.label,
        sub: s.kind === 'reef' ? `Diffusion-limited aggregation · colour by ${modeLbl.toLowerCase()}${s.mode === 'natural' ? '' : ' · ' + GRADIENTS[s.gradient].label.toLowerCase() + ' gradient'}`
          : `${sp.latin} · ${sp.form.toLowerCase()} · colour by ${modeLbl.toLowerCase()}`,
        params: [
          { sym: 'N', name: 'live polyps', value: reef.count.toLocaleString(), cls: 'm1' },
          { sym: '\\mathbf{u}', name: 'current', value: `${G.cur.toFixed(2)} toward ${G.dir}°`, cls: 'm2' },
          { sym: '\\Phi', name: 'nutrient rate', value: `${Math.round(rate || saver.base)} polyps/s`, cls: 'm3' },
        ],
        tex: [String.raw`\mathbf{v} = \boldsymbol{\xi} + d\,\mathbf{u} - f\,\hat{\mathbf{y}}`],
        eq: ['v = ξ + d u − f ŷ'],
        rules: [['\\mathbf{u}', 'm2'], ['\\Phi', 'm3'], ['N', 'm1']],
        lines: ['Marine snow falls with the current and joins the coral it touches: the tips catch the most.',
          'Each particle is a round cone to its parent; a smooth minimum joins them into one surface.'],
        code: brain ? { lang: 'js', name: 'coral-sdf.js · brain coral valleys · groove', text: groove.toString() }
          : { lang: 'js', name: `reef.js · ${SPECIES[hookSp].label.toLowerCase()} · ${H.name}`, text: H.fn.toString() },
      };
    }

    function start(s) {
      st.shot = s; st.t = 0;
      G.dir = s.current; G.cur = 0.35 + 0.4 * (1 - calm) + 0.2 * ((s.seed % 7) / 7); setCurrent();
      setGradient(s.gradient, s.reversed);
      // smaller reefs than the page, so the mesher keeps up with a 5 to 12 s shot
      reef.limit = COARSE ? 3600 : 9000;
      if (s.kind === 'reef') { reef.reset(s.seed); reef.loadPreset(s.preset); }
      else { reef.reset(s.seed); reef.preset = null; reef.addColony(s.species, 0, 0, { cap: Math.min(reef.limit, SPECIES[s.species].cap) }); }
      // a quarter of the growth while the canvas is dark
      const total = reef.colonies.reduce((a, c) => a + c.cap, 0);
      reef.now = nowMs() - 8000;
      reef.growAll(Math.floor(total * 0.3));
      saver.base = Math.min(COARSE ? 450 : 950, Math.max(200, (total - reef.count) / (s.hold * 1.05)));
      reef.env.speed = 1; reef.env.nutrient = 1;
      center.y = s.kind === 'reef' ? 12 : 10;
      st.tgt = { x: 0, y: center.y, z: 0 };
      st.az = s.az;
      afterReset(false);
      setMode(s.mode);
      label(makeLabel());
    }

    function next() {
      st.i = (st.i + 1) % shots.length;
      const s = shots[st.i];
      st.fading = true; canvas.style.opacity = '0';
      setTimeout(() => { if (!saverOn) return; start(s); canvas.style.opacity = '1'; st.fading = false; }, 800);
    }

    function tick(dt, now) {
      if (st.bandFn && (st.bandT += dt) > 0.4) { st.bandT = 0; try { saver.band = st.bandFn(canvas.clientHeight); } catch (e) { saver.band = null; } }
      const s = st.shot;
      if (!s) { if (!st.fading) next(); return; }
      st.t += dt; st.labT += dt;
      if (st.t > s.hold && !st.fading) { next(); return; }
      if (st.labT > 1) { st.labT = 0; label(makeLabel()); }
      // the growth front: the mean of the newest polyps
      const n = reef.count, k = Math.min(n, 160);
      let fx = 0, fy = 0, fz = 0;
      for (let g = n - k; g < n; g++) { fx += reef.px[g]; fy += reef.py[g]; fz += reef.pz[g]; }
      if (k) { fx /= k; fy /= k; fz /= k; }
      const e = 1 - Math.exp(-dt * 0.5);
      const wf = s.kind === 'colony' ? 0.5 : 0.35;      // a close shot aims more at the growth front
      const gx = (1 - wf) * center.x + wf * fx, gy = (1 - wf) * center.y + wf * fy, gz = (1 - wf) * center.z + wf * fz;
      st.tgt.x += (gx - st.tgt.x) * e; st.tgt.y += (gy - st.tgt.y) * e; st.tgt.z += (gz - st.tgt.z) * e;
      st.az += s.spin * dt * (1 - 0.5 * calm);
      const f = fitNow();
      st.dist += (f.dist * (s.zoom || 1) - st.dist) * (1 - Math.exp(-dt * 2));
      S.view.tox = f.ox; S.view.toy = f.oy;
      const ce = Math.cos(s.elev), cam = S.camera;
      cam.position.set(st.tgt.x + Math.sin(st.az) * ce * st.dist, st.tgt.y + Math.sin(s.elev) * st.dist, st.tgt.z + Math.cos(st.az) * ce * st.dist);
      cam.lookAt(st.tgt.x, st.tgt.y, st.tgt.z);
      cam.userData.tgt = cam.userData.tgt || new S.THREE.Vector3(); cam.userData.tgt.set(st.tgt.x, st.tgt.y, st.tgt.z);
    }

    next();
    return { canvas, warmupMs: 1600 };
  },
  exit() {
    if (!saverOn) return;
    saverOn = false;
    document.documentElement.classList.remove('sn-saver');
    canvas.style.opacity = '';
    const sv = saver && saver.saved; saver = null;
    if (S) { S.controls.enabled = true; S.controls.autoRotate = G.orbit; }
    if (sv) {
      reef.limit = CAP;
      G.dir = sv.dir; G.cur = sv.cur; setCurrent(); setTemp(sv.temp);
      reef.env.speed = sv.speed; reef.env.nutrient = sv.nutrient;
      setGradient(sv.gradient, sv.rev);
      center.y = 14;
      loadPreset(sv.preset, sv.seed, true);
      setMode(sv.mode); setPlaying(sv.playing);
    }
    setOpen(!PHONE_Q.matches);
  },
};

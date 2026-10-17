// ============================================================================
//  CORAL REEF GROWTH  ·  main script (ES module, three r160)
// ----------------------------------------------------------------------------
//  reef.js grows the colonies in a time budget each frame. This script
//  sends the new polyps to the GPU buffers of scene.js, refreshes the radii
//  and the colours a few times a second, and binds the controls.
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
//    grep -n 'function syncPolyps'   new polyps to the GPU buffers
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
import { createReef, SPECIES, SPECIES_IDS, PRESETS, PRESET_IDS, polypRadius, sandY, speciesHook } from './reef.js';
import { MODES, colourT, naturalRGB, radiiOf, fieldsOf } from './colour.js';
import { shotList, frameFit } from './saver.js';
import { lut, cssGradient, mountGradientPicker, GRADIENTS } from '../../lib/growth-gradients.js';
import { PARAM_INFO } from '../../lib/dla-engine.js';
import { mountDiagram } from './diagram.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CAP = COARSE ? 6000 : 16000;          // polyps on the whole reef
const BUDGET = COARSE ? 5 : 8;              // ms of growth per frame
const FOV = 40;
const T0 = performance.now();

const G = {
  preset: 'mixed', seed: 1, mode: 'natural', gradient: 'reef', rev: false,
  playing: true, speed: 1, dir: 20, cur: 0.5, nutrient: 1, temp: 27,
  caust: true, snow: true, shaft: true, orbit: false, plant: 'staghorn', spSel: 'staghorn',
};
let saverOn = false, saver = null;

// ── scene and reef ──────────────────────────────────────────────────────────
const canvas = $('view');
const S = createScene({ canvas, cap: CAP, coarse: COARSE, onNoGL: () => { $('nogl').hidden = false; } });
const reef = createReef({ seed: G.seed, capTotal: CAP });
const radBuf = new Float32Array(CAP), tBuf = new Float32Array(CAP), natBuf = new Float32Array(CAP * 3);
let synced = 0, refreshAt = 0, hMax = 0, dirty = true;

const nowMs = () => performance.now() - T0;

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
  if (!S) return;
  S.mesh.count = 0;
  S.setRocks(reef.rocks);
  syncPolyps(); refresh();
  if (fit) fitCamera(true);
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.id === reef.preset));
}

// A natural colour for a polyp before the next refresh: the tip colour.
const natGuess = c => c.sp.tip;

// New polyps (synced..count) to the GPU buffers, with a radius and a t
// that the next refresh corrects.
function syncPolyps() {
  const n = reef.count; if (n <= synced) return;
  for (let g = synced; g < n; g++) {
    const c = reef.colonies[reef.col[g]];
    radBuf[g] = polypRadius(c.sp, 1);
    const h = reef.py[g] - sandY(reef.px[g], reef.pz[g]); if (h > hMax) hMax = h;
    tBuf[g] = G.mode === 'flow' ? 0 : G.mode === 'colony' ? (reef.col[g] * 0.618034 + 0.12) % 1 : G.mode === 'height' ? h / Math.max(1, hMax) : 1;
    const q = c.sp.tip; natBuf[g * 3] = q[0]; natBuf[g * 3 + 1] = q[1]; natBuf[g * 3 + 2] = q[2];
  }
  S.writePolyps(reef, synced, n, radBuf, natBuf, tBuf, natGuess);
  synced = n;
}

// All polyps: radii from subtree sizes, natural colours, t of the mode.
function refresh() {
  if (!S) return;
  const F = fieldsOf(reef);
  radiiOf(reef, radBuf, F); naturalRGB(reef, natBuf, F); colourT(reef, G.mode, tBuf, F);
  S.writePolyps(reef, 0, reef.count, radBuf, natBuf, tBuf, natGuess);
  synced = reef.count; dirty = false;
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
  const hit = ray.intersectObject(S.sand, false)[0];
  if (!hit) return;
  const x = hit.point.x, z = hit.point.z;
  if (Math.hypot(x, z) > 140) return flash('Plant nearer to the reef.');
  if (reef.colonies.some(c => Math.hypot(c.user.bx - x, c.user.bz - z) < 10)) return flash('Too near a colony: tap open sand.');
  if (reef.count >= CAP - 60) return flash('The reef is at its polyp cap. Regrow to plant again.');
  const c = reef.addColony(G.plant, x, z, { share: Math.max(6, reef.colonies.length + 1) });
  if (!c) return;
  S.addRock(c.user.rock);
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
    const n = saverOn && saver ? reef.step(dtMs, BUDGET, now, saver.base) : reef.step(dtMs, BUDGET, now);
    if (n) { syncPolyps(); dirty = true; }
  }
  if (dirty && now > refreshAt) { refresh(); refreshAt = now + (reef.count > 8000 ? 600 : 350); }
  if (saverOn && saver) saver.tick(dt, now);
  readout(dt);
  if (!S) return;
  S.U.uTime.value = now / 1000;
  S.U.uCount.value = reef.count;
  S.U.uSwayK.value = REDUCED ? 0.3 : 1;
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
  S.render(dt);
}

function onResize() { if (S) { S.resize(); fitCamera(false); } }
addEventListener('resize', onResize);

// ── start ───────────────────────────────────────────────────────────────────
buildUI();
setGradient(G.gradient, G.rev);
setMode(G.mode);
setCurrent();
setTemp(G.temp);
if (S) { S.resize(); loadPreset(G.preset, G.seed, true); requestAnimationFrame(frame); }

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
        lines: ['Marine snow falls with the current and joins the coral it touches: the tips catch the most.'],
        code: { lang: 'js', name: `reef.js · ${SPECIES[hookSp].label.toLowerCase()} · ${H.name}`, text: H.fn.toString() },
      };
    }

    function start(s) {
      st.shot = s; st.t = 0;
      G.dir = s.current; G.cur = 0.35 + 0.4 * (1 - calm) + 0.2 * ((s.seed % 7) / 7); setCurrent();
      setGradient(s.gradient, s.reversed);
      if (s.kind === 'reef') { reef.reset(s.seed); reef.loadPreset(s.preset); }
      else { reef.reset(s.seed); reef.preset = null; reef.addColony(s.species, 0, 0, { cap: Math.min(CAP, SPECIES[s.species].cap) }); }
      // a quarter of the growth while the canvas is dark
      const total = reef.colonies.reduce((a, c) => a + c.cap, 0);
      reef.now = nowMs() - 8000;
      reef.growAll(Math.floor(total * 0.25));
      saver.base = Math.max(200, (total - reef.count) / (s.hold * 0.9));
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
      const gx = 0.65 * center.x + 0.35 * fx, gy = 0.65 * center.y + 0.35 * fy, gz = 0.65 * center.z + 0.35 * fz;
      st.tgt.x += (gx - st.tgt.x) * e; st.tgt.y += (gy - st.tgt.y) * e; st.tgt.z += (gz - st.tgt.z) * e;
      st.az += s.spin * dt * (1 - 0.5 * calm);
      const f = fitNow();
      st.dist += (f.dist - st.dist) * (1 - Math.exp(-dt * 2));
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

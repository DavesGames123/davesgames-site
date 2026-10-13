// ============================================================================
//  DIAMOND LAB  ·  main.js — UI, camera, WebGPU passes and the frame loop
// ────────────────────────────────────────────────────────────────────────────
//  cuts.js turns the chosen cut and its proportions into facet planes.
//  optics.js gives the stone's index at each traced wavelength. This module
//  packs both into GPU buffers and runs the four passes of
//  shaders/gem.wgsl every frame:
//      fs_gem    -> hdr     (render size: window x dpr x q)
//      fs_bright -> small1  (1/4 of render size)
//      fs_streak -> small2  (1/4)
//      fs_final  -> canvas  (window x dpr)
//  q is an adaptive pixel factor: it falls when the frame rate drops.
//
//  The stone always sits in the clear part of the window: right of the
//  desktop panel, above the phone sheet and dock, or in the band between
//  the screensaver plate texts (clearRect). The centre glides there.
//
//  pagehide stops the loop and destroys the device, so the tab shell can
//  swap pages (lib/gpu-guard.js does the same as a backstop).
//
//  GREP MAP
//    const S ...................... the live state (cut, stone, light, camera)
//    const live ................... the eased optics of the stone on screen
//    function setCut / setMaterial  change the stone (the saver uses both)
//    function camera .............. orbit camera vectors
//    function clearRect ........... where the stone can sit on screen
//    function packUniforms ........ S to the uniform block (struct U)
//    function drawDiagram ......... crown, pavilion and profile drawings
//    function buildUI ............. buttons, sliders, sheet and dock
//    function setView / setLoupe .. grading views and the loupe (inspect.js)
//    function initGPU / function resizeTargets / function frame
//    window.snSaver ............... saver.js makeSaver(app)
// ============================================================================
import { buildCut, CUTS, CUT_KEYS, RANGES, packPlanes, MAX_PLANES } from './cuts.js';
import { MATERIALS, MATERIAL_KEYS, spectralSamples, indexAt, materialStats } from './optics.js';
import { typesetAll } from '../../lib/sci-math.js';
import { plateBand } from '../../lib/saver-clear.js';
import { makeSaver } from './saver.js';
import { LOUPE_MAGS, VIEWS, VIEW_KEYS, loupeRadius, clampPitch } from './inspect.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const SAMPLE_STEPS = [1, 3, 6, 9, 12];
const ENVS = ['Studio', 'Spots', 'Daylight', 'Ring'];
const MODES = ['render', 'ASET', 'bounces'];
const MODE_NOTE = [
  'The stone in the light rig, with every traced wavelength.',
  'ASET: red is light from 45° to 80° above, green from the side, blue from above the viewer\'s head, black is light that leaks out below.',
  'Mean internal bounces of the light that leaves each pixel: blue few, cream about 3, red 6 or more.',
];
const SHORT = { round: 'Round', oval: 'Oval', cushion: 'Cushion', pear: 'Pear', marquise: 'Marquise', trillion: 'Trillion', princess: 'Princess', emerald: 'Emerald', asscher: 'Asscher' };

// ── state ───────────────────────────────────────────────────────────────────
const S = {
  cut: 'round', prop: { table: CUTS.round.p.table, crown: CUTS.round.p.crown, pav: CUTS.round.p.pav, girdle: CUTS.round.p.girdle }, mat: 'diamond', fire: 1, bounces: 8, samples: COARSE ? 1 : 2,
  env: 0, rig: 0.4, sweep: false, sweepAz: 0, exposure: 1, spark: 1, mode: 0, spin: true,
  cam: { yaw: 0.5, pitch: 0.55, zoom: 1 }, fade: 0, matEase: 0.35, saver: false, band: null,
  loupe: 0, loupeAt: null, view: 'free',
};
// the pitch a grading view eases to; a drag cancels it
let pitchGoal = null;
const live = { nd: MATERIALS.diamond.nd, abbe: MATERIALS.diamond.abbe, absorb: [0, 0, 0] };
let geom = null, planesDirty = true, spinHold = 0;

function setCut(key, prop) {
  S.cut = key;
  const P = CUTS[key].p;
  S.prop = prop || { table: P.table, crown: P.crown, pav: P.pav, girdle: P.girdle };
  rebuild();
}
function rebuild() {
  geom = buildCut(S.cut, S.prop);
  planesDirty = true;
  syncControls(); drawDiagram(); refreshReadouts();
}
function setMaterial(key, ease = 0.35) { S.mat = key; S.matEase = ease; syncControls(); refreshReadouts(); }

// ── camera ──────────────────────────────────────────────────────────────────
const FOV = 30 * Math.PI / 180, TH = Math.tan(FOV / 2), FILL = 0.74;
function camera() {
  const r = geom ? geom.stats.radius : 1;
  const dist = r / (FILL * TH) / S.cam.zoom;
  const { yaw, pitch } = S.cam;
  const eye = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
  const L = Math.hypot(...eye), fwd = eye.map(v => -v / L);
  // right = fwd x world up; up = right x fwd
  let right = [-fwd[2], 0, fwd[0]]; const rl = Math.hypot(...right) || 1; right = right.map(v => v / rl);
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  return { eye, fwd, right, up, dist };
}

// The clear part of the window (CSS px), the part no panel, sheet, dock or
// saver text covers. The stone is centred in it and sized from its short
// side.
function clearRect() {
  const W = innerWidth, H = innerHeight;
  let x0 = 0, x1 = W, y0 = 0, y1 = H;
  if (S.saver) {
    const b = S.band; if (b) { y0 = b.t; y1 = H - b.b; }
    return { x0, x1, y0, y1 };
  }
  const tb = document.querySelector('.topbar');
  if (tb && getComputedStyle(tb).display !== 'none') y0 = Math.max(y0, tb.getBoundingClientRect().bottom);
  const dock = $('dock');
  if (dock && getComputedStyle(dock).display !== 'none') {
    const r = dock.getBoundingClientRect();
    if (r.width > W * 0.7) y1 = Math.min(y1, r.top);
  }
  const p = $('panel');
  if (p && p.classList.contains('open')) {
    const r = p.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < W && r.top < H) {
      if (r.left <= 1 && r.width < W * 0.6) x0 = Math.max(x0, r.right);
      else if (r.right >= W - 1 && r.left > W * 0.35) x1 = Math.min(x1, r.left);
      else if (r.top > H * 0.25) y1 = Math.min(y1, r.top);
    }
  }
  if (y1 - y0 < 80) y1 = y0 + 80;
  return { x0, x1, y0, y1 };
}
const ctr = { x: 0, y: 0, s: 0, init: false };
function updateCentre(dt) {
  const r = clearRect();
  const tx = (r.x0 + r.x1) / 2, ty = (r.y0 + r.y1) / 2, ts = Math.min(r.x1 - r.x0, r.y1 - r.y0) / 2;
  if (!ctr.init) { Object.assign(ctr, { x: tx, y: ty, s: ts, init: true }); return; }
  const k = 1 - Math.exp(-dt / 0.18);
  ctr.x += (tx - ctr.x) * k; ctr.y += (ty - ctr.y) * k; ctr.s += (ts - ctr.s) * k;
}
// The stone on screen in CSS px, for the saver plate.
function anchor() {
  return { x: ctr.x, y: ctr.y, r: ctr.s * FILL * S.cam.zoom };
}

// ── uniform block (24 vec4 = 384 bytes; matches struct U) ──────────────────
const U = new Float32Array(96);
let rw = 1, rh = 1, dprNow = 1, q = 1, samplesCache = { n: -1, s: null };
function packUniforms(time) {
  const C = camera();
  const k = rw / Math.max(1, innerWidth);
  const ns = SAMPLE_STEPS[S.samples];
  if (samplesCache.n !== ns) samplesCache = { n: ns, s: spectralSamples(ns) };
  U.set([rw, rh, time, S.mode], 0);
  U.set([...C.eye, TH], 4);
  U.set([...C.fwd, geom.planes.length], 8);
  U.set([...C.right, S.bounces], 12);
  U.set([...C.up, ns], 16);
  U.set([ctr.x * k, ctr.y * k, ctr.s * k, S.fade], 20);
  // the loupe in render px; off in the saver
  const lOn = S.loupe > 0 && !S.saver, la = S.loupeAt || [ctr.x, ctr.y];
  U.set([live.nd, geom.stats.radius, lOn ? loupeRadius(innerWidth, innerHeight) * k : 0, S.loupe || 1], 24);
  U.set([...live.absorb, 0], 28);
  U.set([S.rig, S.env, S.exposure, S.spark], 32);
  U.set([S.sweepAz, S.sweep ? 1 : 0, 1, 0], 36);
  U.set([3.0, S.spark, 0.62 + 0.15 * Math.sin(time * 0.05), 1], 40);
  const cv = $('view');
  U.set([cv.width, cv.height, la[0] * k, la[1] * k], 44);
  samplesCache.s.forEach((sm, i) => {
    const n = ns === 1 ? live.nd : indexAt(live.nd, live.abbe, sm.lambda, S.fire);
    U.set([n, sm.w[0], sm.w[1], sm.w[2]], 48 + i * 4);
  });
}

// ── panel drawings and readouts ─────────────────────────────────────────────
const KIND_COL = { table: '#ffd9a0', 'crown main': '#9fd4ff', star: '#c7b6ff', 'upper girdle': '#7fb0e0', 'crown step': '#9fd4ff',
  'pavilion main': '#ff9fb4', 'lower girdle': '#d98aa0', 'pavilion step': '#ff9fb4', culet: '#ffd9a0', girdle: '#5d6480' };
function drawDiagram() {
  const cv = $('diagram'); if (!cv || !geom) return;
  const r = cv.getBoundingClientRect(); if (r.width < 2) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, cell = W / 3, R = geom.stats.radius;
  const sc = Math.min(cell, H - 22) / 2 / R * 0.92;
  g.lineWidth = 0.8; g.lineJoin = 'round';
  const views = [['crown', f => f.plane >= 0 && geom.planes[f.plane].n[1] > 0.02, (v) => [v[0], v[2]]],
    ['pavilion', f => f.plane >= 0 && geom.planes[f.plane].n[1] < -0.02, (v) => [v[0], -v[2]]]];
  views.forEach(([name, keep, proj], i) => {
    const cx = cell * (i + 0.5), cy = (H - 14) / 2;
    for (const f of geom.faces) {
      if (!keep(f)) continue;
      g.beginPath();
      f.verts.forEach((v, j) => { const [a, b] = proj(v); j ? g.lineTo(cx + a * sc, cy + b * sc) : g.moveTo(cx + a * sc, cy + b * sc); });
      g.closePath();
      g.fillStyle = (KIND_COL[f.kind] || '#888') + '22'; g.fill();
      g.strokeStyle = (KIND_COL[f.kind] || '#888') + 'cc'; g.stroke();
    }
    g.fillStyle = '#8c91a8'; g.font = '10px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'center';
    g.fillText(name, cx, H - 4);
  });
  // profile: the outline of the solid seen from the side (x, y)
  const pts = []; for (const f of geom.faces) for (const v of f.verts) pts.push([v[0], -v[1]]);
  const hull = hull2(pts), cx = cell * 2.5, cy = (H - 14) / 2;
  g.beginPath(); hull.forEach(([a, b], j) => j ? g.lineTo(cx + a * sc, cy + b * sc) : g.moveTo(cx + a * sc, cy + b * sc)); g.closePath();
  g.fillStyle = '#9fd4ff18'; g.fill(); g.strokeStyle = '#9fd4ffcc'; g.stroke();
  const gy = -(geom.faces.find(f => f.kind === 'girdle') || { verts: [[0, 0, 0]] }).verts.reduce((a, v) => a + v[1], 0) / ((geom.faces.find(f => f.kind === 'girdle') || { verts: [1] }).verts.length);
  g.setLineDash([3, 3]); g.strokeStyle = '#ffd9a088'; g.beginPath(); g.moveTo(cx - R * sc, cy + gy * sc); g.lineTo(cx + R * sc, cy + gy * sc); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#8c91a8'; g.fillText('profile', cx, H - 4);
}
function hull2(P) {
  const A = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of A) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = A.length - 1; i >= 0; i--) { const p = A[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2), f3 = v => v.toFixed(3), pct = v => (100 * v).toFixed(1) + '%';
function rows(id, list) { $(id).innerHTML = list.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join(''); }
function refreshReadouts() {
  if (!geom) return;
  const st = geom.stats, w = st.width;
  rows('cutRead', [['facets', String(st.facets)], ['planes traced', String(st.planes)],
    ['table / width', st.tableW ? pct(st.tableW / w) : '—'], ['crown height', pct(st.crownH / w)],
    ['pavilion depth', pct(st.pavD / w)], ['total depth', pct(st.height / w)]]);
  const m = MATERIALS[S.mat], ms = materialStats(m);
  rows('matRead', [['index n<sub>d</sub>', f3(ms.nd)], ['Abbe number ν<sub>d</sub>', String(ms.abbe)],
    ['dispersion B–G', f3(ms.bg)], ['critical angle θ<sub>c</sub>', f1(ms.critDeg) + '°'], ['reflectance R<sub>0</sub>', pct(ms.r0)]]);
  $('cutNote').textContent = CUTS[S.cut].note;
  $('matNote').textContent = m.note;
  $('modeNote').textContent = MODE_NOTE[S.mode];
  $('capCut').textContent = CUTS[S.cut].name;
  $('capMat').textContent = m.name + (S.mode ? ' · ' + MODES[S.mode] : '');
  $('dockMat').querySelector('i').style.background = m.dot;
  $('dockMat').style.color = m.dot;
}

// ── UI ──────────────────────────────────────────────────────────────────────
const sliders = {};
function bindRange(id, get, set, fmt, after) {
  const el = $(id), out = $(id + 'V');
  const sync = () => { el.value = get(); out.textContent = fmt(get()); };
  el.addEventListener('input', () => { set(parseFloat(el.value)); out.textContent = fmt(get()); if (after) after(); });
  sliders[id] = sync; sync();
}
function syncControls() {
  for (const s of Object.values(sliders)) s();
  document.querySelectorAll('[data-cut]').forEach(b => b.classList.toggle('on', b.dataset.cut === S.cut));
  document.querySelectorAll('[data-mat]').forEach(b => b.classList.toggle('on', b.dataset.mat === S.mat));
  document.querySelectorAll('[data-env]').forEach(b => b.classList.toggle('on', +b.dataset.env === S.env));
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', +b.dataset.mode === S.mode));
  $('sweepBtn').classList.toggle('on', S.sweep); $('sweepBtn').textContent = 'Light sweep · ' + (S.sweep ? 'on' : 'off');
  $('spinBtn').classList.toggle('on', S.spin); $('spinBtn').textContent = 'Turntable · ' + (S.spin ? 'on' : 'off');
  document.querySelectorAll('[data-loupe]').forEach(b => b.classList.toggle('on', +b.dataset.loupe === S.loupe));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  $('viewNote').textContent = S.loupe ? 'Loupe ' + S.loupe + '×: ' + (COARSE ? 'drag' : 'move the pointer') + ' to look through it. The turntable stops while the loupe is out.' : VIEWS[S.view].note;
  $('dockLoupe').classList.toggle('on', S.loupe > 0);
  const act = document.querySelector('#dockCuts .on'); if (act && act.scrollIntoView && PHONE_Q.matches) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function button(host, label, data, on) {
  const b = document.createElement('button'); b.type = 'button';
  if (typeof label === 'string') b.textContent = label; else b.append(...label);
  Object.assign(b.dataset, data); b.addEventListener('click', on); host.appendChild(b); return b;
}
function buildUI() {
  for (const k of CUT_KEYS) {
    button($('cuts'), SHORT[k], { cut: k }, () => setCut(k));
    button($('dockCuts'), SHORT[k], { cut: k }, () => setCut(k));
  }
  for (const k of MATERIAL_KEYS) {
    const i = document.createElement('i'); i.style.background = MATERIALS[k].dot; i.style.color = MATERIALS[k].dot;
    button($('mats'), [i, MATERIALS[k].name.replace('Blue sapphire', 'Sapphire').replace('Cubic zirconia', 'Zirconia').replace('Yellow diamond', 'Yellow')], { mat: k }, () => setMaterial(k));
  }
  $('dockMat').addEventListener('click', () => setMaterial(MATERIAL_KEYS[(MATERIAL_KEYS.indexOf(S.mat) + 1) % MATERIAL_KEYS.length]));
  ENVS.forEach((e, i) => button($('envs'), e, { env: i }, () => { S.env = i; syncControls(); }));
  MODES.forEach((m, i) => button($('modes'), m, { mode: i }, () => { S.mode = i; syncControls(); refreshReadouts(); }));
  $('sweepBtn').addEventListener('click', () => { S.sweep = !S.sweep; syncControls(); });
  $('spinBtn').addEventListener('click', () => { S.spin = !S.spin; syncControls(); });
  LOUPE_MAGS.forEach(m => button($('loupes'), m ? m + '×' : 'Off', { loupe: m }, () => setLoupe(m)));
  VIEW_KEYS.forEach(k => button($('views'), VIEWS[k].name, { view: k }, () => setView(k)));
  $('dockLoupe').addEventListener('click', () => setLoupe(S.loupe ? 0 : 10));
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'l' || e.key === 'L') setLoupe(S.loupe ? 0 : 10);
  });
  for (const k of Object.keys(RANGES)) { $(k).min = RANGES[k][0]; $(k).max = RANGES[k][1]; }
  const prop = (k, fmt) => bindRange(k, () => S.prop[k], v => { S.prop[k] = v; }, fmt, rebuild);
  prop('table', v => (100 * v).toFixed(1) + '%');
  prop('crown', v => v.toFixed(2) + '°');
  prop('pav', v => v.toFixed(2) + '°');
  prop('girdle', v => (50 * v).toFixed(1) + '%');
  bindRange('rig', () => S.rig, v => S.rig = v, v => (v * 180 / Math.PI).toFixed(0) + '°');
  bindRange('exposure', () => S.exposure, v => S.exposure = v, f2);
  bindRange('spark', () => S.spark, v => S.spark = v, f2);
  bindRange('fire', () => S.fire, v => S.fire = v, f2);
  bindRange('bounces', () => S.bounces, v => S.bounces = v, v => String(v));
  bindRange('samples', () => S.samples, v => S.samples = v, v => SAMPLE_STEPS[v] === 1 ? '1 (no fire)' : String(SAMPLE_STEPS[v]));

  // panel: left column on a desktop, sheet or drawer on a phone
  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open); if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
    setTimeout(drawDiagram, 330);
  }
  $('gear').addEventListener('click', () => setOpen(true));
  dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // the sheet grip: tap toggles half and full height, a drag up opens full,
  // a drag down shrinks, then closes
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (_) {} });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
  addEventListener('resize', () => setTimeout(drawDiagram, 50));
}

// A grading view eases the pitch and sets the turntable. The loupe stays
// where it was put; it starts on the stone.
function setView(k) {
  const v = VIEWS[k]; S.view = k; pitchGoal = v.pitch;
  if (v.spin !== null) S.spin = v.spin;
  syncControls();
}
function setLoupe(m) {
  S.loupe = m; if (m && !S.loupeAt) S.loupeAt = [ctr.x, ctr.y];
  syncControls();
}

// ── pointer: orbit, pinch, wheel, double tap, loupe ─────────────────────────
// With the loupe out, a mouse moves it by hover and turns the stone by a
// drag. A finger moves the loupe; two fingers still pinch.
function bindView() {
  const cv = $('view'), pts = new Map(); let pinch = null, last = null, lastTap = 0;
  const hide = () => $('hint').classList.add('gone');
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    pts.set(e.pointerId, [e.clientX, e.clientY]); hide(); spinHold = 2.5;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: S.cam.zoom }; return; }
    last = [e.clientX, e.clientY]; pitchGoal = null;
    if (S.loupe && e.pointerType !== 'mouse') S.loupeAt = [e.clientX, e.clientY];
    const now = performance.now(); if (now - lastTap < 300) { S.cam = { yaw: 0.5, pitch: 0.55, zoom: 1 }; S.view = 'free'; syncControls(); } lastTap = now;
  });
  cv.addEventListener('pointermove', e => {
    if (S.loupe && e.pointerType === 'mouse' && !pts.has(e.pointerId)) { S.loupeAt = [e.clientX, e.clientY]; return; }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]); spinHold = 2.5;
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; S.cam.zoom = clampZoom(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(pinch.d, 1)); return; }
    if (!last) return;
    const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
    if (S.loupe) { S.loupeAt = [e.clientX, e.clientY]; if (e.pointerType !== 'mouse') return; }
    S.cam.yaw -= dx * 0.008; S.cam.pitch = clampPitch(S.cam.pitch + dy * 0.008);
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) last = null; else last = [...pts.values()][0]; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => { e.preventDefault(); hide(); S.cam.zoom = clampZoom(S.cam.zoom * Math.exp(-e.deltaY * 0.001)); }, { passive: false });
  setTimeout(hide, 9000);
}
const clampZoom = z => Math.min(4, Math.max(0.5, z));

// ── GPU ─────────────────────────────────────────────────────────────────────
let device, ctx, format, pipes = {}, ubuf, pbuf, sampler, tex = {}, groups = {}, raf = 0, torn = false;
const planeData = new Float32Array(MAX_PLANES * 4);
async function initGPU() {
  if (!navigator.gpu) throw new Error('no WebGPU');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!adapter) throw new Error('no adapter');
  device = await adapter.requestDevice();
  const code = await (await fetch(new URL('shaders/gem.wgsl', import.meta.url))).text();
  format = navigator.gpu.getPreferredCanvasFormat();
  ctx = $('view').getContext('webgpu');
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  for (const m of info.messages) if (m.type === 'error') console.error('WGSL', m.lineNum + ':' + m.linePos, m.message);
  ubuf = device.createBuffer({ size: U.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  pbuf = device.createBuffer({ size: planeData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const mk = (entry, fmt) => device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: entry, targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' } });
  [pipes.gem, pipes.bright, pipes.streak, pipes.final] = await Promise.all([mk('fs_gem', 'rgba16float'), mk('fs_bright', 'rgba16float'), mk('fs_streak', 'rgba16float'), mk('fs_final', format)]);
  groups.gem = device.createBindGroup({ layout: pipes.gem.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: pbuf } }] });
  device.lost.then(i => { if (!torn) console.warn('GPU device lost:', i.message); });
}
// Render targets at the render size; the bind groups that read them.
function resizeTargets() {
  const cv = $('view');
  dprNow = Math.min(devicePixelRatio || 1, 2);
  const cw = Math.max(1, Math.round(innerWidth * dprNow)), ch = Math.max(1, Math.round(innerHeight * dprNow));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const budget = (PHONE_Q.matches ? 0.55e6 : 1.4e6);
  const base = Math.min(1, Math.sqrt(budget / (cw * ch)));
  const s = base * Math.sqrt(q);
  const w = Math.max(16, Math.round(cw * s)), h = Math.max(16, Math.round(ch * s));
  if (tex.hdr && w === rw && h === rh) return;
  rw = w; rh = h;
  for (const t of Object.values(tex)) t.destroy();
  const mkT = (W, H) => device.createTexture({ size: [W, H], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  tex.hdr = mkT(rw, rh);
  tex.s1 = mkT(Math.ceil(rw / 4), Math.ceil(rh / 4));
  tex.s2 = mkT(Math.ceil(rw / 4), Math.ceil(rh / 4));
  const ub = { binding: 0, resource: { buffer: ubuf } }, sb = { binding: 3, resource: sampler };
  groups.bright = device.createBindGroup({ layout: pipes.bright.getBindGroupLayout(0), entries: [ub, { binding: 2, resource: tex.hdr.createView() }, sb] });
  groups.streak = device.createBindGroup({ layout: pipes.streak.getBindGroupLayout(0), entries: [ub, { binding: 2, resource: tex.s1.createView() }, sb] });
  groups.final = device.createBindGroup({ layout: pipes.final.getBindGroupLayout(0), entries: [ub, { binding: 2, resource: tex.hdr.createView() }, sb, { binding: 4, resource: tex.s2.createView() }] });
}
function pass(enc, view, pipe, group) {
  const p = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
  p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end();
}

// Adaptive pixel factor q: 1 s windows; below 42 fps q drops by (fps/50)^2
// (at most x0.72), after three windows above 56 fps it rises (never past
// the last failed level).
const perf = { t0: 0, n: 0, good: 0, ceil: 1, warm: 1, fps: 0 };
function tickPerf(now) {
  if (!perf.t0) { perf.t0 = now; return; }
  perf.n++;
  if (now - perf.t0 < 1000) return;
  const fps = perf.n * 1000 / (now - perf.t0); perf.fps = fps; perf.t0 = now; perf.n = 0;
  if (perf.warm > 0) { perf.warm--; return; }
  if (fps < 42 && q > 0.12) { perf.ceil = q * 0.95; q = Math.max(0.12, q * Math.min(0.72, (fps / 50) ** 2)); perf.good = 0; }
  else if (fps > 56) { if (++perf.good >= 3 && q < perf.ceil) { q = Math.min(perf.ceil, q * 1.18); perf.good = 0; } }
  else perf.good = 0;
  $('rdFps').textContent = fps.toFixed(0) + ' fps';
}

const tickers = new Set();
let lastNow = 0, t0 = 0, frames = 0;
function frame(now) {
  if (torn) return;
  raf = requestAnimationFrame(frame);
  if (!t0) t0 = now;
  const dt = Math.min(0.1, lastNow ? (now - lastNow) / 1000 : 0.016); lastNow = now;
  for (const f of tickers) f(dt, now);
  // ease the optics toward the chosen stone
  const m = MATERIALS[S.mat], k = 1 - Math.exp(-dt / Math.max(0.01, S.matEase));
  live.nd += (m.nd - live.nd) * k; live.abbe += (m.abbe - live.abbe) * k;
  live.absorb = live.absorb.map((v, i) => v + (m.absorb[i] - v) * k);
  if (spinHold > 0) spinHold -= dt; else if (S.spin && !S.saver && !S.loupe) S.cam.yaw += dt * 0.16;
  if (pitchGoal !== null && !S.saver) {
    S.cam.pitch += (pitchGoal - S.cam.pitch) * (1 - Math.exp(-dt / 0.25));
    if (Math.abs(pitchGoal - S.cam.pitch) < 1e-3) pitchGoal = null;
  }
  if (S.sweep && !S.saver) S.sweepAz += dt * 0.5;
  updateCentre(dt);
  if (!device || !geom) return;
  resizeTargets();
  if (planesDirty) { device.queue.writeBuffer(pbuf, 0, packPlanes(geom.planes, planeData)); planesDirty = false; }
  packUniforms((now - t0) / 1000);
  device.queue.writeBuffer(ubuf, 0, U);
  const enc = device.createCommandEncoder();
  pass(enc, tex.hdr.createView(), pipes.gem, groups.gem);
  pass(enc, tex.s1.createView(), pipes.bright, groups.bright);
  pass(enc, tex.s2.createView(), pipes.streak, groups.streak);
  pass(enc, ctx.getCurrentTexture().createView(), pipes.final, groups.final);
  device.queue.submit([enc.finish()]);
  frames++;
  tickPerf(now);
  if (frames % 30 === 1) $('rdRender').textContent = rw + ' × ' + rh + ' px';
}
function teardown() { if (torn) return; torn = true; cancelAnimationFrame(raf); try { device && device.destroy(); } catch (_) {} }
addEventListener('pagehide', teardown);

// ── boot ────────────────────────────────────────────────────────────────────
buildUI();
setCut('round');
setMaterial('diamond');
bindView();
typesetAll(document);
window.__gem = { S, live, geom: () => geom, setCut, setMaterial, frames: () => frames, q: () => q, ready: false };

// Screensaver hook (saver.js). The app object is the whole interface the
// director uses; it does not touch the DOM itself.
const app = {
  S, live, canvas: $('view'),
  cuts: CUT_KEYS, materials: MATERIAL_KEYS,
  setCut, setMaterial, anchor, geom: () => geom,
  onTick: f => { tickers.add(f); return () => tickers.delete(f); },
  band: () => plateBand(innerHeight),
  hideUI() {
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#dock,#gear,#caption,#hint,#nogpu{display:none!important}#view{cursor:none}';
    document.head.appendChild(st);
    $('panel').classList.remove('open', 'full');
  },
};
window.snSaver = makeSaver(app);

try { await initGPU(); window.__gem.ready = true; } catch (e) { $('nogpu').hidden = false; console.error(e); }
raf = requestAnimationFrame(frame);

// ============================================================================
//  CORRUPTION  ·  main.js — the DOM: panel, stage bar, dock, input, the
//  click pick, the frame loop and the resolution governor
// ----------------------------------------------------------------------------
//  State: P (the look parameters, params.js), the stage model, the orbit
//  camera and heal (Purge eases the spread to 0, Infect back to 1). The page
//  has no screen-space effect. The URL keeps ?seed= and ?model= so a shuffled
//  variant can be shared; slider edits after a shuffle stay local. The
//  default model is the torus knot (grep -n 'DEFAULT_MODEL').
//
//  GREP MAP
//    grep -n 'async function boot'      device, shaders, renderer
//    grep -n 'function selectModel'     mesh build or SDF id, samples, camera
//    grep -n 'function doShuffle'       a new seed -> a new P
//    grep -n 'function buildUI'         the sn-panel sections
//    grep -n 'function pickAt'          click: GPU ray (SDF) + CPU triangles
//    grep -n 'function frame'           the loop, frames-in-flight cap
//    grep -n 'function govern'          render scale from GPU time
//    grep -n 'installSaver'             the screensaver hook
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { createPanel, mountSheet, fillIcons } from '../../lib/sn-panel.js';
import { parseGLB } from '../../lib/glb-lite.js';
import { PARAMS, MODES, defaults, shuffle, spreadAt, packUniforms, readQuery, fitSrc, UNIFORM_OFFSET, rng } from './params.js';
import { MODELS, MODEL, torusKnot, hullPod, bench, fitMesh, meshFromGLB, sampleSurface } from './models.js';
import { orbitCamera } from './camera.js';
import { buildModule, createRenderer, MAX_SAMPLES } from './gpu.js';
import { installSaver, codeExtract } from './saver.js';
import { plateBand } from '../../lib/saver-clear.js';

const PHONE_QUERY = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
const $ = id => document.getElementById(id);
const canvas = $('view');
const SECTIONS = [
  ['infect', 'Infection'], ['surface', 'Surface'], ['glow', 'Glow'], ['particles', 'Particles'],
  ['sdf', 'SDF set pieces'], ['scene', 'Scene'],
];
const BUILDERS = { knot: () => fitMesh(torusKnot(), 1.9), pod: () => fitMesh(hullPod(), 2.0), bench: () => fitMesh(bench(), 1.9) };

// The page opens on the torus knot. S.bound starts at the trooper bound
// because defaults().src is set for the trooper, and selectModel maps it.
const DEFAULT_MODEL = 'knot';
const S = {
  R: null, ctx: null, device: null,
  P: defaults(), seed: 0, model: DEFAULT_MODEL, bound: MODEL.trooper.bound,
  meshCache: new Map(), custom: null, cpuMesh: null,
  cam: orbitCamera({ target: [0, 1, 0], dist: 4.4 }),
  time: 0, last: performance.now(), freeze: false, autoOrbit: true, idleAt: 0,
  heal: 1, healTarget: 1,
  inFlight: 0, scale: 0.8, gpuMs: [], goodSince: 0, w: 0, h: 0,
  saver: false, panel: null, sheet: null,
};
window.__corruption = S;

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  if (!navigator.gpu) throw new Error('nogpu');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('nogpu');
  S.device = await adapter.requestDevice();
  const SH = await loadShaders(import.meta.url, ['shaders/corruption.wgsl', '../sdf-solids-table/shaders/pack.wgsl']);
  S.shaderText = SH['shaders/corruption.wgsl'];
  const code = buildModule(SH['../sdf-solids-table/shaders/pack.wgsl'], S.shaderText);
  const format = navigator.gpu.getPreferredCanvasFormat();
  S.ctx = canvas.getContext('webgpu');
  S.ctx.configure({ device: S.device, format, alphaMode: 'opaque' });
  S.R = await createRenderer(S.device, { code, format });
  S.device.lost.then(info => { if (info.reason !== 'destroyed') console.warn('corruption: device lost', info.message); });

  const q = readQuery(location.search);
  if (q.model && MODEL[q.model] && !MODEL[q.model].custom) S.model = q.model;
  selectModel(S.model, { keepCam: false });
  if (q.seed !== null) applySeed(q.seed); else { S.seed = 0; S.P.src = fitSrc(defaults().src, MODEL.trooper.bound, S.bound); }
  buildUI();
  bindInput();
  installSaver({ canvas, applyShot, tick: saverTick, setSaver, describe });
  requestAnimationFrame(frame);
}

// ── models ──────────────────────────────────────────────────────────────────
function selectModel(id, { keepCam = true } = {}) {
  const m = MODEL[id];
  if (!m || (m.custom && !S.custom)) return;
  const from = S.bound;
  S.model = id;
  if (m.kind === 'mesh') {
    let fm = m.custom ? S.custom : S.meshCache.get(id);
    if (!fm) { fm = BUILDERS[id](); S.meshCache.set(id, fm); }
    S.bound = fm.bound; S.cpuMesh = fm.mesh;
    S.R.setMesh(fm.mesh);
    S.R.setSamples(sampleSurface(fm.mesh, MAX_SAMPLES, rng(7)));
  } else {
    S.bound = m.bound; S.cpuMesh = null;
    S.R.setMesh(null);
    S.R.requestSdfSamples();
  }
  S.P.src = fitSrc(S.P.src, from, S.bound);
  S.cam.target = [...S.bound.c];
  if (!keepCam) S.cam.dist = S.bound.r * 3.9;
  else S.cam.dist = Math.min(S.cam.maxDist, Math.max(S.bound.r * 2.4, Math.min(S.cam.dist, S.bound.r * 5)));
  syncModelUI();
  writeURL();
}
function stepModel(d) {
  const list = MODELS.filter(m => !m.custom || S.custom);
  const i = list.findIndex(m => m.id === S.model);
  selectModel(list[(i + d + list.length) % list.length].id);
}
async function loadGLB(file) {
  try {
    if (file.size > 80 * 1024 * 1024) throw new Error('the file is larger than 80 MB');
    const scene = parseGLB(await file.arrayBuffer(), { bake: true, merge: true });
    const mesh = meshFromGLB(scene);
    if (mesh.indices.length / 3 > 1.5e6) throw new Error('more than 1.5 million triangles');
    S.custom = fitMesh(mesh, 2.0);
    MODEL.custom.label = file.name.replace(/\.glb$/i, '').slice(0, 18) || 'Your model';
    buildChips();
    selectModel('custom');
    note(`${MODEL.custom.label}: ${(mesh.indices.length / 3).toLocaleString()} triangles`);
  } catch (e) {
    note(`Could not load the file: ${e.message}`, true);
  }
}

// ── shuffle ─────────────────────────────────────────────────────────────────
function applySeed(seed) {
  S.seed = seed >>> 0;
  S.P = shuffle(S.seed, S.bound);
  syncPanel();
  writeURL();
}
function doShuffle() {
  applySeed((Math.random() * 4294967296) >>> 0);
  const b = $('btnShuffle'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
}
function writeURL() {
  if (S.saver) return;
  try {
    const q = new URLSearchParams(location.search);
    if (S.seed) q.set('seed', String(S.seed)); else q.delete('seed');
    if (S.model !== DEFAULT_MODEL && S.model !== 'custom') q.set('model', S.model); else q.delete('model');
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  } catch (e) { /* sandboxed frame */ }
  const lbl = $('seedLbl');
  if (lbl) lbl.textContent = S.seed ? `#${S.seed.toString(36)}` : 'default';
}

// ── UI ──────────────────────────────────────────────────────────────────────
const fmt = p => v => {
  if (p.id === 'hue') return v === 0 ? 'red' : (v < 0 ? 'crimson ' : 'orange ') + Math.abs(v).toFixed(2);
  if (p.step >= 1) return String(Math.round(v));
  return v.toFixed(p.step < 0.01 ? 3 : 2);
};
let noteCtl = null;
function note(t, warn = false) { if (noteCtl) { noteCtl.set(t); noteCtl.el.classList.toggle('snp-warn', warn); } }

function buildChips() {
  const box = $('modelChips');
  box.innerHTML = '';
  for (const m of MODELS) {
    if (m.custom && !S.custom) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.model = m.id; b.textContent = m.label;
    b.title = m.kind === 'sdf' ? `${m.label}: a signed distance field, ray marched` : `${m.label}: a triangle mesh, rasterised`;
    b.addEventListener('click', () => selectModel(m.id));
    box.appendChild(b);
  }
  const ch = S.panel && S.panel.find('model');
  if (ch) ch.setItems(MODELS.filter(m => !m.custom || S.custom).map(m => ({ id: m.id, label: m.label })), S.model);
  syncModelUI();
}
function syncModelUI() {
  for (const b of document.querySelectorAll('#modelChips button')) b.setAttribute('aria-pressed', String(b.dataset.model === S.model));
  const ch = S.panel && S.panel.find('model');
  if (ch) ch.set(S.model);
  const m = MODEL[S.model];
  if ($('dkModelLbl')) $('dkModelLbl').textContent = m ? m.label : 'Model';
  const kn = S.panel && S.panel.find('modelKind');
  if (kn) kn.set(m.kind === 'sdf' ? 'Signed distance field, ray marched. The crust is voxels of the same field.' : 'Triangle mesh, rasterised. Vertices snap to voxels inside the infection.');
}
function syncPanel() {
  if (!S.panel) return;
  for (const p of PARAMS) { const c = S.panel.find('p-' + p.id); if (c) c.set(S.P[p.id]); }
  const md = S.panel.find('mode'); if (md) md.set(S.P.mode);
  const bd = S.panel.find('backdrop'); if (bd) bd.set(S.P.backdrop);
}

function buildUI() {
  fillIcons(document.body);
  const panel = createPanel($('panelBody'), { store: 'corruption' });
  S.panel = panel;
  const v = panel.section({ id: 'variant', title: 'Variant', open: true });
  v.button({ id: 'shuffleBig', label: 'Shuffle', kind: 'primary', icon: 'dice', title: 'A new variant with completely different parameters (R)', onClick: doShuffle });
  v.actions([
    { id: 'btnPurge', label: 'Purge', title: 'Ease the infection back to clean (P)', onClick: togglePurge },
    { id: 'btnCopy', label: 'Copy link', title: 'Copy a link to this seed and model', onClick: copyLink },
    { id: 'btnDefaults', label: 'Defaults', title: 'The hand-tuned default set', onClick: () => { S.seed = 0; S.P = defaults(); S.P.src = fitSrc(S.P.src, MODEL.trooper.bound, S.bound); syncPanel(); writeURL(); } },
  ]);
  noteCtl = v.note({ id: 'status', text: 'Click the model to move the origin of the infection.', live: true });

  const st = panel.section({ id: 'stage', title: 'Stage', open: true });
  st.chips({ id: 'model', label: 'Model', items: MODELS.filter(m => !m.custom).map(m => ({ id: m.id, label: m.label })), value: S.model, onChange: id => selectModel(id) });
  st.note({ id: 'modelKind', text: '' });
  st.button({ id: 'btnGlb', label: 'Load a .glb model', icon: 'expand', title: 'Corrupt your own model (or drop a .glb on the page)', onClick: () => $('glbFile').click() });
  st.segmented({ id: 'backdrop', label: 'Backdrop', items: [{ id: 'void', label: 'Void' }, { id: 'studio', label: 'Studio' }], value: S.P.backdrop, onChange: id => { S.P.backdrop = id; } });
  st.toggle({ id: 'autoOrbit', label: 'Turn the camera', value: S.autoOrbit, onChange: on => { S.autoOrbit = on; } });
  st.toggle({ id: 'freeze', label: 'Freeze time', value: S.freeze, onChange: on => { S.freeze = on; } });

  for (const [sid, title] of SECTIONS) {
    const sec = panel.section({ id: sid, title, open: sid === 'infect' });
    if (sid === 'infect') sec.segmented({ id: 'mode', label: 'Spread over time', items: MODES, value: S.P.mode, onChange: id => { S.P.mode = id; } });
    for (const p of PARAMS.filter(x => x.section === sid)) {
      sec.slider({ id: 'p-' + p.id, label: p.label, min: p.min, max: p.max, step: p.step, value: S.P[p.id], format: fmt(p), unit: p.unit,
        onInput: val => { S.P[p.id] = +val; } });
    }
  }
  const ab = panel.section({ id: 'about', title: 'About', open: false });
  ab.note({ text: 'One WGSL material shades both kinds of geometry. It reads only a world point and a normal: a noisy sphere grows from the origin, the surface inside turns to a voxel crust, a red front burns at the edge and cracks run ahead of it.' });
  ab.note({ text: 'The SDF models, tendrils and shards are ray marched with the primitives of the SDF Solids Table library. The meshes are rasterised, and their vertices snap to the same voxel grid. The polyhedra and the digits are instanced and need no CPU work per frame.' });

  S.sheet = mountSheet({ panel: $('panel'), grip: $('sheetGrip'), menu: $('dkPanel'), close: $('panelClose'), gear: $('gear'), phoneQ: matchMedia(PHONE_QUERY) });
  buildChips();
  writeURL();
}
function togglePurge() {
  S.healTarget = S.healTarget > 0.5 ? 0 : 1;
  const b = S.panel && S.panel.find('btnPurge');
  if (b) b.setLabel(S.healTarget > 0.5 ? 'Purge' : 'Infect');
}
async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); note('Link copied.'); }
  catch (e) { note('Copy is blocked here. The address bar has the link.'); }
}

// ── input ───────────────────────────────────────────────────────────────────
function bindInput() {
  const ptrs = new Map();
  let down = null, pinch0 = 0;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    S.idleAt = performance.now();
  });
  canvas.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) S.cam.zoom(pinch0 / d);
      pinch0 = d; if (down) down.moved = 99;
      return;
    }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    if (down && down.moved > 4) { canvas.classList.add('drag'); S.cam.orbit(dx * 0.006, dy * 0.005); }
    S.idleAt = performance.now();
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    canvas.classList.remove('drag');
    if (down && down.moved <= 4 && ptrs.size === 0 && e.type === 'pointerup') pickAt(e.clientX, e.clientY);
    if (ptrs.size === 0) down = null;
    pinch0 = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.cam.zoom(Math.exp(e.deltaY * 0.0012)); S.idleAt = performance.now(); }, { passive: false });

  $('btnShuffle').addEventListener('click', doShuffle);
  $('dkShuffle').addEventListener('click', doShuffle);
  $('dkPrev').addEventListener('click', () => stepModel(-1));
  $('dkNext').addEventListener('click', () => stepModel(1));
  $('dkModel').addEventListener('click', () => stepModel(1));
  $('glbFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) loadGLB(f); e.target.value = ''; });
  addEventListener('dragover', e => { e.preventDefault(); $('drop').hidden = false; });
  addEventListener('dragleave', e => { if (!e.relatedTarget) $('drop').hidden = true; });
  addEventListener('drop', e => {
    e.preventDefault(); $('drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadGLB(f);
  });
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') doShuffle();
    else if (e.key === 'p' || e.key === 'P') togglePurge();
    else if (e.key === '[') stepModel(-1);
    else if (e.key === ']') stepModel(1);
    else if (e.key === 'o' || e.key === 'O') { S.autoOrbit = !S.autoOrbit; const c = S.panel.find('autoOrbit'); if (c) c.set(S.autoOrbit); }
  });
  setTimeout(() => $('hint').classList.add('gone'), 9000);
}

// ── the click: move the origin to the surface under the pointer ───────────
function rayTri(o, d, P, I) {
  let best = Infinity;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det, s = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
    const uu = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
    if (uu < 0 || uu > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const vv = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (vv < 0 || uu + vv > 1) continue;
    const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    if (tt > 1e-4 && tt < best) best = tt;
  }
  return best;
}
async function pickAt(x, y) {
  const r = canvas.getBoundingClientRect();
  const ray = S.cam.rayAt(x - r.left, y - r.top, r.width, r.height);
  let best = Infinity;
  if (S.cpuMesh) best = rayTri(ray.o, ray.d, S.cpuMesh.positions, S.cpuMesh.indices);
  const U = uniforms(r.width, r.height);
  U.set([...ray.o, 0], UNIFORM_OFFSET.pick); U.set([...ray.d, 0], UNIFORM_OFFSET.pickD);
  const g = await S.R.pick(U);
  if (g && g[3] > 0 && g[3] < best) best = g[3];
  if (!Number.isFinite(best)) return;
  const p = [0, 1, 2].map(i => ray.o[i] + ray.d[i] * best);
  S.P.src = [p[0], Math.max(0.03, p[1]), p[2]];
  note('Infection origin moved.');
}

// ── the loop ────────────────────────────────────────────────────────────────
function uniforms(w, h) {
  const m = MODEL[S.model];
  return packUniforms(S.P, S.cam.viewState(w, h), {
    time: S.time, amount: spreadAt(S.P, S.time) * S.heal, kind: m.kind === 'mesh' ? 1 : 0, sdfId: m.sdf ?? 0,
    samples: 0, bound: S.bound, mat: m.mat, mat2: m.mat2, seed: S.seed || 1,
  });
}
function govern(ms) {
  S.gpuMs.push(ms); if (S.gpuMs.length > 12) S.gpuMs.shift();
  if (S.gpuMs.length < 6) return;
  const avg = S.gpuMs.reduce((a, b) => a + b, 0) / S.gpuMs.length;
  const now = performance.now();
  if (avg > 26 && S.scale > 0.35) { S.scale = Math.max(0.35, S.scale * 0.85); S.gpuMs.length = 0; S.goodSince = now; }
  else if (avg < 12) { if (now - S.goodSince > 2000 && S.scale < 1) { S.scale = Math.min(1, S.scale * 1.08); S.gpuMs.length = 0; S.goodSince = now; } }
  else S.goodSince = now;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - S.last) / 1000); S.last = now;
  if (S.inFlight >= 2 || document.hidden) return;
  if (!S.freeze) S.time += dt;
  S.heal += (S.healTarget - S.heal) * Math.min(1, dt * 1.6);
  if (S.autoOrbit && !S.saver && now - S.idleAt > 3500) S.cam.yaw += dt * 0.12;

  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = cw * dpr * S.scale, h = ch * dpr * S.scale;
  const cap = 2.4e6;
  if (w * h > cap) { const k = Math.sqrt(cap / (w * h)); w *= k; h *= k; }
  w = Math.max(64, Math.round(w)); h = Math.max(64, Math.round(h));
  if (w !== S.w || h !== S.h) { canvas.width = w; canvas.height = h; S.w = w; S.h = h; S.R.resize(w, h); }

  const t0 = performance.now();
  S.R.frame(uniforms(w, h), S.ctx.getCurrentTexture().createView());
  S.inFlight++;
  S.device.queue.onSubmittedWorkDone().then(() => { S.inFlight--; govern(performance.now() - t0); });
}

// ── screensaver ─────────────────────────────────────────────────────────────
S.saverCalm = 0.6;
function setSaver(on) {
  S.saver = on;
  document.body.classList.toggle('saver', on);
  if (!on) { S.cam.shiftY = 0; writeURL(); }
}
function applyShot(shot, calm) {
  S.saverCalm = calm;
  selectModel(shot.model, { keepCam: false });
  S.seed = shot.seed; S.P = shuffle(shot.seed, S.bound); S.P.mode = 'sweep';
  S.time = 0; S.heal = 1; S.healTarget = 1;
  S.cam.yaw = shot.yaw; S.cam.pitch = shot.pitch;
  S.cam.dist = S.bound.r * shot.dist[0];
  S.cam.shiftY = bandFrame().shift;
}
// the clear band of the shell label plate: the principal point moves to its
// centre and the camera backs off by h / band so the subject fits it
function bandFrame() {
  const h = innerHeight, b = plateBand(h);
  if (!b) return { shift: 0, back: 1 };
  const yc = (b.t + (h - b.b)) / 2, band = Math.max(1, h - b.t - b.b);
  return { shift: (2 * yc) / h - 1, back: Math.min(2, h / band) };
}
function describe() {
  const m = MODEL[S.model];
  return {
    title: 'Corruption Shader',
    sub: `${m.label} · ${m.kind === 'sdf' ? 'signed distance field' : 'triangle mesh'} · strain #${S.seed.toString(36)}`,
    params: [
      { sym: 'v', name: 'voxel', value: `${(S.P.voxel * 100).toFixed(1)} cm` },
      { sym: 'N', name: 'polyhedra', value: String(S.P.parts) },
      { sym: 'b', name: 'zeros and ones', value: String(S.P.glyphs) },
    ],
    lines: ['One WGSL material for any geometry: it reads only a world point and a normal.'],
    code: { lang: 'wgsl', name: 'corruption.wgsl · the infection field', text: codeExtract(S.shaderText || '') },
  };
}
function saverTick(shot, k, calm) {
  const e = k * k * (3 - 2 * k);
  const bf = bandFrame();
  S.cam.shiftY = bf.shift;
  S.cam.dist = S.bound.r * (shot.dist[0] + (shot.dist[1] - shot.dist[0]) * e) * bf.back;
  S.cam.yaw += shot.dir * 0.0016 * (1 - 0.5 * calm) * (shot.move === 'low' ? 1.6 : 1);
  if (shot.move === 'low') S.cam.target = [S.bound.c[0], S.bound.c[1] * 0.7, S.bound.c[2]];
  else S.cam.target = [...S.bound.c];
}

boot().catch(err => {
  console.error(err);
  const m = $('nogpu');
  if (err && err.message !== 'nogpu') m.textContent = 'The corruption shader could not start: ' + (err.message || err);
  m.hidden = false;
});

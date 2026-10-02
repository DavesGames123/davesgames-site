// ============================================================================
//  SPHERE TRACING LAB  ·  main.js — UI, WebGPU and the overlays
// ────────────────────────────────────────────────────────────────────────────
//  One scene (scene.js) drives two views. shaders/lab.wgsl traces the 3D
//  view (fs_view) and paints the slice (fs_slice). This module traces the one
//  probe ray on the CPU with the same field and draws it as the classic
//  sphere-tracing diagram on the slice: a circle of radius |d| at each step.
//  It also projects the same steps into the 3D view.
//
//  Both views render on demand: an edit, a drag or a resize sets the dirty
//  flags and the next frame redraws. pagehide stops the frame loop and
//  releases the GPU device, so the tab shell can swap pages safely.
//
//  GREP MAP
//    const S ...................... the live state (scene, tracer, slice, camera)
//    function loadPreset .......... copy a preset into S
//    function packUniforms ........ S to the uniform block (matches struct LabU)
//    function traceProbe .......... the probe ray, in plane and world space
//    function drawSliceOverlay .... circles, steps, touch points, handles
//    function draw3dOverlay ....... plane outline, plane handle, probe path
//    function stats ............... average steps over a grid, plain and relaxed
//    function layout .............. pane geometry around the panel and the dock
//    function buildEditor ......... chips and the editor of one primitive
//    function initGPU / function frame
//    window.snSaver ............... screensaver hook: 3D view, slow orbit, faded presets
// ============================================================================
import * as SC from './scene.js';
import { mountEquations } from './equations.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const MODES = ['shaded', 'steps', 'normals', 'distance at hit', 'AO', 'soft shadow', 'plain | relaxed'];
const MODE_SHORT = ['shaded', 'steps', 'normals', 'dist', 'AO', 'shadow', 'compare'];
const MODE_NOTE = [
  'key light with soft shadows and ambient occlusion',
  'steps per pixel, log scale: dark is few, cream is many, red is the cap',
  'the gradient of d, as color',
  'depth bands; red where the ray stopped inside (d < 0)',
  'ambient occlusion from five samples along the normal',
  'the soft shadow term alone: blue marks the penumbra',
  'steps per pixel: left plain, right over-relaxed (ω from the slider)',
];

// ── state ───────────────────────────────────────────────────────────────────
const S = {
  prims: [], twist: 0, rep: 0, period: 1.6, stepScale: 1, maxSteps: 128,
  relax: false, omega: 1.3, axis: 'xy', offset: 0, extent: 2.6, showPlane: true,
  ray: { o: [-2.3, 0.7], a: 0 }, cam: { yaw: 0.5, pitch: 0.3, dist: 5.6 }, mode: 0, sel: 0, preset: '',
};
let gpuDirty = true, ovDirty = true, statsTimer = 0, lastStats = null, lastTrace = null, frames = 0;
const dirty = (stats = true) => { gpuDirty = true; ovDirty = true; if (stats) scheduleStats(); };

function loadPreset(name) {
  const p = SC.clonePreset(name);
  Object.assign(S, { prims: p.prims, twist: p.twist, rep: p.rep, period: p.period, stepScale: p.stepScale, axis: p.axis, offset: p.offset, extent: p.extent, ray: p.ray, cam: p.cam, sel: 0, preset: name });
  $('presetNote').textContent = p.note;
  syncControls(); buildEditor(); dirty();
}

// ── geometry helpers ────────────────────────────────────────────────────────
const plane = () => SC.plane(S.axis, S.offset);
const cam = () => SC.camera(S.cam);
function rayDir(Pl) { const c = Math.cos(S.ray.a), s = Math.sin(S.ray.a); return [0, 1, 2].map(i => Pl.u[i] * c + Pl.v[i] * s); }
function traceProbe() {
  const Pl = plane();
  const o = SC.onPlane(Pl, S.ray.o[0], S.ray.o[1]);
  const r = rayDir(Pl);
  const tr = SC.march(S, o, r, { relax: S.relax, omega: S.omega, maxSteps: S.maxSteps, stepScale: S.stepScale });
  tr.o = o; tr.r = r; tr.Pl = Pl;
  return tr;
}

// ── uniform block (35 vec4 = 560 bytes; matches struct LabU) ────────────────
const U = new Float32Array(140);
function packUniforms(now) {
  const C = cam(), Pl = plane();
  const v = $('view'), sl = $('slice');
  U.set([v.width, v.height, now, S.mode], 0);
  U.set([sl.width, sl.height, S.extent, S.prims.length], 4);
  U.set([...C.eye, SC.FOCAL], 8);
  U.set([...C.fwd, S.stepScale], 12);
  U.set([...C.right, S.relax ? S.omega : 1], 16);
  U.set([...C.up, S.maxSteps], 20);
  U.set([...Pl.n, Pl.off], 24);
  U.set([...Pl.u, S.showPlane ? 1 : 0], 28);
  U.set([...Pl.v, S.omega], 32);
  U.set([S.twist, S.period, S.rep, S.fade || 0], 36);
  S.prims.forEach((p, i) => U.set([...p.pos, p.type, ...p.size, p.op, p.k, p.color, p.rot, 0], 40 + i * 12));
}

// ── overlays ────────────────────────────────────────────────────────────────
const CREAM = '#ffd49a', TONE = '#5a8dff', CORAL = '#ff8a6a';
function ctxFor(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  return { g, W: r.width, H: r.height };
}
function sliceXf(W, H) { const sc = Math.min(W, H) / (2 * S.extent); return { sc, X: a => W / 2 + a * sc, Y: b => H / 2 - b * sc }; }
const lerpCol = (a, b, t) => { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };

function drawSliceOverlay() {
  const { g, W, H } = ctxFor($('sliceOv'));
  const { sc, X, Y } = sliceXf(W, H);
  const tr = lastTrace, Pl = tr.Pl;
  const o2 = S.ray.o, d2 = [Math.cos(S.ray.a), Math.sin(S.ray.a)];
  const at = t => [o2[0] + d2[0] * t, o2[1] + d2[1] * t];
  // the ray beyond the march, faint
  g.setLineDash([4, 5]); g.strokeStyle = 'rgba(255,212,154,0.28)'; g.lineWidth = 1;
  const far = at(SC.TMAX); g.beginPath(); g.moveTo(X(o2[0]), Y(o2[1])); g.lineTo(X(far[0]), Y(far[1])); g.stroke(); g.setLineDash([]);
  const n = tr.steps.length;
  // circles: the sphere at each step, cut by the plane
  tr.steps.forEach((st, i) => {
    if (i > 90) return;
    const [a, b] = at(st.t), r = Math.abs(st.d) * sc;
    const k = n > 1 ? i / (n - 1) : 0;
    const col = st.fail ? CORAL : st.d < 0 ? CORAL : lerpCol(TONE, CREAM, k);
    g.globalAlpha = st.fail ? 0.9 : 0.85;
    if (st.fail) g.setLineDash([3, 4]);
    g.strokeStyle = col; g.lineWidth = i === n - 1 ? 1.6 : 1.15;
    g.beginPath(); g.arc(X(a), Y(b), Math.max(r, 0.5), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 0.07; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
  });
  // touch points: the nearest surface point, when it lies in the plane
  tr.steps.forEach((st, i) => {
    if (i > 90 || st.fail || st.d <= 2e-3) return;
    const P = [0, 1, 2].map(j => tr.o[j] + tr.r[j] * st.t);
    const gr = SC.grad(S, ...P), gl = Math.hypot(...gr) || 1;
    const N = P.map((v, j) => v - st.d * gr[j] / gl);
    const q = SC.toPlane(Pl, N);
    if (Math.abs(q[2]) > 0.03) return;
    const [a, b] = at(st.t);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(a), Y(b)); g.lineTo(X(q[0]), Y(q[1])); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(q[0]), Y(q[1]), 2.4, 0, Math.PI * 2); g.fill();
  });
  // the marched segment and the step points
  const end = at(tr.t);
  g.strokeStyle = CREAM; g.lineWidth = 1.6; g.beginPath(); g.moveTo(X(o2[0]), Y(o2[1])); g.lineTo(X(end[0]), Y(end[1])); g.stroke();
  tr.steps.forEach((st, i) => {
    if (i > 90) return;
    const [a, b] = at(st.t);
    g.fillStyle = st.fail ? CORAL : '#fff';
    g.beginPath(); g.arc(X(a), Y(b), st.fail ? 3.2 : 2.6, 0, Math.PI * 2); g.fill();
  });
  if (tr.hit) {
    g.strokeStyle = CORAL; g.lineWidth = 2; g.beginPath(); g.arc(X(end[0]), Y(end[1]), 6, 0, Math.PI * 2); g.stroke();
  }
  // origin handle and aim arrow
  const ox = X(o2[0]), oy = Y(o2[1]), hr = COARSE ? 11 : 8;
  const ax = ox + d2[0] * (hr + 26), ay = oy - d2[1] * (hr + 26);
  g.strokeStyle = CREAM; g.lineWidth = 2; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ax, ay); g.stroke();
  const ang = Math.atan2(-(d2[1]), d2[0]);
  g.fillStyle = CREAM; g.beginPath(); g.moveTo(ax + Math.cos(ang) * 8, ay + Math.sin(ang) * 8);
  g.lineTo(ax + Math.cos(ang + 2.5) * 8, ay + Math.sin(ang + 2.5) * 8); g.lineTo(ax + Math.cos(ang - 2.5) * 8, ay + Math.sin(ang - 2.5) * 8); g.fill();
  g.fillStyle = '#0b0d18'; g.strokeStyle = CREAM; g.lineWidth = 2.5; g.beginPath(); g.arc(ox, oy, hr, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = CREAM; g.beginPath(); g.arc(ox, oy, hr * 0.4, 0, Math.PI * 2); g.fill();
  // axis key
  const names = { xy: ['x', 'y'], xz: ['x', '−z'], yz: ['−z', 'y'] }[S.axis];
  g.font = '11px ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(200,205,230,0.7)';
  const key = `→ ${names[0]}   ↑ ${names[1]}   grid 1 unit`;
  if (W > 480) { g.textAlign = 'right'; g.fillText(key, W - 12, H - 14); } else { g.textAlign = 'left'; g.fillText(key, 14, 54); }
}

function draw3dOverlay() {
  const { g, W, H } = ctxFor($('viewOv'));
  const C = cam(), Pl = plane(), E = S.extent;
  const pr = X => SC.project(C, X, W, H);
  if (S.showPlane) {
    const cs = [[-E, -E], [E, -E], [E, E], [-E, E]].map(([a, b]) => pr(SC.onPlane(Pl, a, b)));
    if (cs.every(Boolean)) {
      g.setLineDash([5, 5]); g.strokeStyle = 'rgba(90,141,255,0.75)'; g.lineWidth = 1.2;
      g.beginPath(); cs.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.stroke(); g.setLineDash([]);
    }
  }
  // the probe path
  const tr = lastTrace;
  const pts = tr.steps.filter(s => !s.fail).map(s => pr([0, 1, 2].map(j => tr.o[j] + tr.r[j] * s.t)));
  const endP = pr([0, 1, 2].map(j => tr.o[j] + tr.r[j] * tr.t));
  if (pts.every(Boolean) && endP) {
    g.strokeStyle = CREAM; g.lineWidth = 1.6; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.lineTo(...endP); g.stroke();
    pts.forEach((p, i) => { g.fillStyle = i === 0 ? CREAM : '#fff'; g.beginPath(); g.arc(p[0], p[1], i === 0 ? 4.5 : 2.2, 0, Math.PI * 2); g.fill(); });
    if (tr.hit) { g.strokeStyle = CORAL; g.lineWidth = 2; g.beginPath(); g.arc(endP[0], endP[1], 5.5, 0, Math.PI * 2); g.stroke(); }
  }
  // the plane handle: a diamond at the plane center and an arrow along its normal
  const c0 = pr(SC.onPlane(Pl, 0, 0)), c1 = pr(SC.onPlane({ ...Pl, off: Pl.off + 0.6 }, 0, 0));
  handle.at = c0; handle.dir = c0 && c1 ? [c1[0] - c0[0], c1[1] - c0[1]] : null;
  if (c0) {
    if (c1) { g.strokeStyle = TONE; g.lineWidth = 2; g.beginPath(); g.moveTo(...c0); g.lineTo(...c1); g.stroke(); g.fillStyle = TONE; g.beginPath(); g.arc(c1[0], c1[1], 3, 0, Math.PI * 2); g.fill(); }
    const s = COARSE ? 12 : 9;
    g.fillStyle = handle.drag ? CREAM : TONE; g.strokeStyle = '#0b0d18'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(c0[0], c0[1] - s); g.lineTo(c0[0] + s, c0[1]); g.lineTo(c0[0], c0[1] + s); g.lineTo(c0[0] - s, c0[1]); g.closePath(); g.fill(); g.stroke();
  }
}
const handle = { at: null, dir: null, drag: false };

// ── readouts ────────────────────────────────────────────────────────────────
function refreshReadouts() {
  const tr = lastTrace;
  if (!tr) return;
  const fails = tr.steps.filter(s => s.fail).length, over = tr.steps.filter(s => s.d < 0 && !s.fail).length;
  $('rdSteps').textContent = String(tr.n);
  $('rdHit').textContent = tr.hit ? `hit at t = ${tr.t.toFixed(3)}` : (tr.n >= S.maxSteps ? 'out of steps' : 'miss');
  $('rdFails').textContent = String(fails);
  $('rdOver').textContent = String(over);
  const narrow = $('slice').clientWidth < 420;
  const res = tr.hit ? 'hit at t = ' + tr.t.toFixed(2) : tr.n >= S.maxSteps ? '<span class="bad">out of steps</span>' : 'miss';
  $('readSlice').innerHTML = `<span class="hi">${tr.n} steps</span> · ${res}` +
    (fails ? ` · <span class="bad">${fails} relax fail${fails > 1 ? 's' : ''}</span>` : '') + (over ? ` · <span class="bad">${over} inside</span>` : '') +
    (narrow ? '' : `<br><span class="lo">circle radius = d at the step point</span>`);
  $('sliceLbl').textContent = `${plane().name} = ${S.offset.toFixed(2)}`;
  $('modeLbl').textContent = MODES[S.mode];
  const narrow3 = $('view').clientWidth < 420;
  let s = narrow3 ? '' : `<span class="lo">${MODE_NOTE[S.mode]}</span>`;
  if (lastStats) {
    const save = 100 * (1 - lastStats.relaxed / Math.max(lastStats.plain, 1e-6));
    const pct = `<span class="${save >= 0 ? 'hi' : 'bad'}">(${save >= 0 ? '−' : '+'}${Math.abs(save).toFixed(0)}%)</span>`;
    s += narrow3 ? `avg steps <span class="hi">${lastStats.plain.toFixed(1)}</span> · ω <span class="hi">${lastStats.relaxed.toFixed(1)}</span> ${pct}`
      : `<br>avg steps · plain <span class="hi">${lastStats.plain.toFixed(1)}</span> · relaxed (ω ${S.omega.toFixed(2)}) <span class="hi">${lastStats.relaxed.toFixed(1)}</span> ${pct}`;
  }
  $('read3d').innerHTML = s;
}

// ── average steps on a grid of rays, plain and over-relaxed ─────────────────
function stats() {
  const cv = $('view'), W = cv.clientWidth || 400, H = cv.clientHeight || 300;
  const C = cam(), NX = 44, NY = Math.max(8, Math.round(NX * H / W));
  let a = 0, b = 0;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const px = (i + 0.5) / NX * W, py = (j + 0.5) / NY * H;
    const M = Math.min(W, H), rd = SC.rayFor(C, (2 * px - W) / M, -(2 * py - H) / M);
    a += SC.march(S, C.eye, rd, { relax: false, maxSteps: S.maxSteps, stepScale: S.stepScale }).n;
    b += SC.march(S, C.eye, rd, { relax: true, omega: Math.max(S.omega, 1.05), maxSteps: S.maxSteps, stepScale: S.stepScale }).n;
  }
  return { plain: a / (NX * NY), relaxed: b / (NX * NY) };
}
function scheduleStats() { clearTimeout(statsTimer); statsTimer = setTimeout(() => { lastStats = stats(); refreshReadouts(); }, 160); }

// ── layout: keep both panes clear of the panel, the dock and the topbar ─────
function layout() {
  const panes = $('panes'), panel = $('panel'), vw = innerWidth, vh = innerHeight;
  const tb = document.querySelector('.topbar').getBoundingClientRect();
  let top = tb.height > 0 && getComputedStyle(document.querySelector('.topbar')).display !== 'none' ? tb.bottom : 0, left = 0, right = 0, bottom = 0;
  const dock = $('dock'); if (getComputedStyle(dock).display !== 'none') bottom = vh - dock.getBoundingClientRect().top;
  if (panel.classList.contains('open')) {
    // measure the open panel without its transform
    const tf = panel.style.transform; panel.style.transition = 'none'; panel.style.transform = 'none';
    const r = panel.getBoundingClientRect();
    panel.style.transform = tf; void panel.offsetWidth; panel.style.transition = '';
    if (r.left <= 1 && r.height > vh * 0.5) left = r.right;
    else if (r.right >= vw - 1 && r.height > vh * 0.5) right = vw - r.left;
    else if (r.width > vw * 0.5) bottom = Math.max(bottom, vh - r.top);
  }
  Object.assign(panes.style, { top: top + 'px', left: left + 'px', right: right + 'px', bottom: bottom + 'px' });
  const w = vw - left - right, h = vh - top - bottom;
  panes.className = w > h * 1.05 ? 'side' : 'stack';
  sizeCanvases();
  // a narrow pane has no room for the hint beside its label
  for (const [p, hId] of [['pane3d', 'hint3d'], ['paneSlice', 'hintSlice']]) $(hId).hidden = $(p).clientWidth < 440;
  refreshReadouts();
}
function sizeCanvases() {
  const d3 = Math.min(devicePixelRatio || 1, COARSE ? 1.25 : 1.5), ds = Math.min(devicePixelRatio || 1, 2);
  for (const [id, d] of [['view', d3], ['slice', ds]]) {
    const cv = $(id), w = Math.max(1, Math.round(cv.clientWidth * d)), h = Math.max(1, Math.round(cv.clientHeight * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  dirty();
}

// ── controls ────────────────────────────────────────────────────────────────
function bindRange(id, get, set, fmt, rebuild) {
  const el = $(id), out = $(id + 'V');
  el.addEventListener('input', () => { set(+el.value); out.textContent = fmt(+el.value); if (rebuild) rebuild(); dirty(); });
  el._sync = () => { el.value = get(); out.textContent = fmt(get()); };
}
function syncControls() {
  for (const id of ['omega', 'stepScale', 'maxSteps', 'twist', 'rep', 'period', 'offset', 'extent']) $(id)._sync();
  document.querySelectorAll('#axes button').forEach(b => b.classList.toggle('on', b.dataset.axis === S.axis));
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.textContent === S.preset));
  document.querySelectorAll('#modes button, #dockModes button').forEach(b => b.classList.toggle('on', +b.dataset.mode === S.mode));
  $('relaxBtn').classList.toggle('on', S.relax); $('relaxBtn').textContent = 'Over-relaxation · ' + (S.relax ? 'on' : 'off');
  $('dockRelax').classList.toggle('on', S.relax); $('dockRelax').setAttribute('aria-pressed', String(S.relax));
  $('planeBtn').classList.toggle('on', S.showPlane); $('planeBtn').textContent = 'Plane in 3D · ' + (S.showPlane ? 'on' : 'off');
}
function setMode(m) { S.mode = m; syncControls(); dirty(false); refreshReadouts(); }
function setRelax(on) { S.relax = on; syncControls(); dirty(); }

const f2 = v => v.toFixed(2);
function buildEditor() {
  const chips = $('chips'); chips.innerHTML = '';
  S.prims.forEach((p, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = i === S.sel ? 'on' : '';
    b.innerHTML = `<i style="background:${SC.COLORS[p.color]}"></i>${i ? SC.OPS[p.op].replace('smooth ', '~') + ' ' : ''}${SC.TYPES[p.type]}`;
    b.addEventListener('click', () => { S.sel = i; buildEditor(); });
    chips.appendChild(b);
  });
  if (S.prims.length < SC.MAX_PRIMS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'add'; b.textContent = '+ add';
    b.addEventListener('click', () => {
      S.prims.push({ type: 0, op: 3, k: 0.4, pos: [0.6 * Math.cos(S.prims.length * 2.1), 0.6 * Math.sin(S.prims.length * 1.3), 0], size: [0.45, 0.45, 0.45], rot: 0, color: S.prims.length % SC.COLORS.length });
      S.sel = S.prims.length - 1; buildEditor(); dirty();
    });
    chips.appendChild(b);
  }
  const p = S.prims[S.sel], ed = $('editor'), i = S.sel;
  const opt = (arr, v) => arr.map((n, k) => `<option value="${k}"${k === v ? ' selected' : ''}>${n}</option>`).join('');
  const slider = (key, lbl, v, min, max, step) => `<div class="row"><label for="ed-${key}">${lbl}</label><input type="range" id="ed-${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val" id="ed-${key}V">${f2(v)}</span></div>`;
  let h = `<div class="ed-head"><i style="background:${SC.COLORS[p.color]}"></i>primitive ${i + 1} of ${S.prims.length}${S.prims.length > 1 ? '<button type="button" class="ed-btn" id="ed-del">remove</button>' : ''}</div>`;
  h += `<div class="row"><label for="ed-type">shape</label><select id="ed-type">${opt(SC.TYPES, p.type)}</select></div>`;
  if (i > 0) h += `<div class="row"><label for="ed-op">operator</label><select id="ed-op">${opt(SC.OPS, p.op)}</select></div>`;
  if (i > 0 && p.op >= 3) h += slider('k', 'smooth k', p.k, 0.02, 1.2, 0.01);
  ['x', 'y', 'z'].forEach((a, j) => { h += slider('p' + j, 'pos ' + a, p.pos[j], -2.5, 2.5, 0.01); });
  SC.SIZE_LABELS[p.type].forEach((l, j) => { h += slider('s' + j, l, p.size[j], 0.05, 2, 0.01); });
  if (p.type !== 0) h += slider('rot', 'turn y', p.rot, -3.14, 3.14, 0.01);
  h += `<div class="colors">${SC.COLORS.map((c, k) => `<button type="button" data-c="${k}" class="${k === p.color ? 'on' : ''}" style="background:${c}" aria-label="color ${k + 1}"></button>`).join('')}</div>`;
  ed.innerHTML = h;
  const on = (id, f) => { const el = $(id); if (el) el.addEventListener('input', () => { f(+el.value); const o = $(id + 'V'); if (o) o.textContent = f2(+el.value); dirty(); }); };
  on('ed-k', v => p.k = v);
  [0, 1, 2].forEach(j => { on('ed-p' + j, v => p.pos[j] = v); on('ed-s' + j, v => p.size[j] = v); });
  on('ed-rot', v => p.rot = v);
  $('ed-type').addEventListener('change', e => { p.type = +e.target.value; buildEditor(); dirty(); });
  if ($('ed-op')) $('ed-op').addEventListener('change', e => { p.op = +e.target.value; buildEditor(); dirty(); });
  if ($('ed-del')) $('ed-del').addEventListener('click', () => { S.prims.splice(i, 1); S.sel = Math.max(0, i - 1); buildEditor(); dirty(); });
  ed.querySelectorAll('.colors button').forEach(b => b.addEventListener('click', () => { p.color = +b.dataset.c; buildEditor(); dirty(false); }));
}

function buildUI() {
  const pre = $('presets');
  for (const name of Object.keys(SC.PRESETS)) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
    b.addEventListener('click', () => loadPreset(name)); pre.appendChild(b);
  }
  MODES.forEach((m, i) => {
    for (const [host, label] of [[$('modes'), m], [$('dockModes'), MODE_SHORT[i]]]) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = i; b.textContent = label;
      b.addEventListener('click', () => setMode(i)); host.appendChild(b);
    }
  });
  $('relaxBtn').addEventListener('click', () => setRelax(!S.relax));
  $('dockRelax').addEventListener('click', () => setRelax(!S.relax));
  $('planeBtn').addEventListener('click', () => { S.showPlane = !S.showPlane; syncControls(); dirty(false); });
  document.querySelectorAll('#axes button').forEach(b => b.addEventListener('click', () => { S.axis = b.dataset.axis; syncControls(); dirty(); }));
  bindRange('omega', () => S.omega, v => S.omega = v, f2);
  bindRange('stepScale', () => S.stepScale, v => S.stepScale = v, f2);
  bindRange('maxSteps', () => S.maxSteps, v => S.maxSteps = v, v => String(v));
  bindRange('twist', () => S.twist, v => S.twist = v, f2);
  bindRange('rep', () => S.rep, v => S.rep = v, v => v ? `${2 * v + 1}×${2 * v + 1}` : 'off');
  bindRange('period', () => S.period, v => S.period = v, f2);
  bindRange('offset', () => S.offset, v => S.offset = v, f2);
  bindRange('extent', () => S.extent, v => S.extent = v, f2);

  // panel: left column on a desktop, sheet or drawer on a phone
  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open); if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
    layout(); setTimeout(layout, 330);
  }
  $('gear').addEventListener('click', () => setOpen(true));
  dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // the sheet grip: tap toggles half and full height, a drag up opens full, a drag down shrinks then closes
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (_) {} });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else { setOpen(false); return; } }
    setTimeout(layout, 330);
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
  addEventListener('resize', layout);
}

// ── pointer input ───────────────────────────────────────────────────────────
function hideHint(id) { $(id).classList.add('gone'); }
function bind3d() {
  const cv = $('view'), pts = new Map(); let pinch = null, mode = null, last = null, lastTap = 0;
  const rel = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    const p = rel(e); pts.set(e.pointerId, p); hideHint('hint3d');
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: S.cam.dist }; mode = 'pinch'; return; }
    const reach = COARSE ? 30 : 16;
    if (handle.at && Math.hypot(p[0] - handle.at[0], p[1] - handle.at[1]) < reach) { mode = 'plane'; handle.drag = true; ovDirty = true; }
    else mode = 'orbit';
    last = p;
    const now = performance.now(); if (now - lastTap < 300 && mode === 'orbit') { S.cam = Object.assign({}, SC.PRESETS[S.preset].cam); dirty(); } lastTap = now;
  });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const p = rel(e); pts.set(e.pointerId, p);
    if (mode === 'pinch' && pts.size >= 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); S.cam.dist = Math.min(20, Math.max(2.2, pinch.dist * pinch.d / Math.max(d, 1))); dirty(); return; }
    if (!last) return;
    const dx = p[0] - last[0], dy = p[1] - last[1]; last = p;
    if (mode === 'orbit') { S.cam.yaw -= dx * 0.008; S.cam.pitch = Math.min(1.45, Math.max(-0.35, S.cam.pitch + dy * 0.008)); dirty(); }
    else if (mode === 'plane') {
      const d = handle.dir, L2 = d ? d[0] * d[0] + d[1] * d[1] : 0;
      const delta = L2 > 64 ? (dx * d[0] + dy * d[1]) / L2 * 0.6 : -dy * 0.01;
      S.offset = Math.min(2, Math.max(-2, S.offset + delta)); $('offset')._sync(); dirty();
    }
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { mode = null; last = null; if (handle.drag) { handle.drag = false; ovDirty = true; } } else { mode = 'orbit'; last = [...pts.values()][0]; } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => { e.preventDefault(); S.cam.dist = Math.min(20, Math.max(2.2, S.cam.dist * Math.exp(e.deltaY * 0.001))); dirty(); }, { passive: false });
}
function bindSlice() {
  const cv = $('slice'); let mode = null, id = null;
  const toAB = e => { const r = cv.getBoundingClientRect(); const { sc } = sliceXf(r.width, r.height); return [(e.clientX - r.left - r.width / 2) / sc, -(e.clientY - r.top - r.height / 2) / sc, sc]; };
  const aim = ab => { S.ray.a = Math.atan2(ab[1] - S.ray.o[1], ab[0] - S.ray.o[0]); };
  cv.addEventListener('pointerdown', e => {
    if (id !== null) return; id = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    hideHint('hintSlice');
    const ab = toAB(e), dpx = Math.hypot(ab[0] - S.ray.o[0], ab[1] - S.ray.o[1]) * ab[2];
    mode = dpx < (COARSE ? 30 : 18) ? 'origin' : 'aim';
    if (mode === 'aim') aim(ab);
    dirty(false);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const ab = toAB(e);
    if (mode === 'origin') { const E = S.extent; S.ray.o = [Math.min(E, Math.max(-E, ab[0])), Math.min(E, Math.max(-E, ab[1]))]; }
    else aim(ab);
    dirty(false);
  });
  const end = e => { if (e.pointerId === id) { id = null; mode = null; } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

// ── GPU ─────────────────────────────────────────────────────────────────────
let device, ctxV, ctxS, pipeV, pipeS, ubuf, bind, raf = 0, torn = false;
async function initGPU() {
  if (!navigator.gpu) throw new Error('no WebGPU');
  const adapter = await navigator.gpu.requestAdapter(); if (!adapter) throw new Error('no adapter');
  device = await adapter.requestDevice();
  const code = await (await fetch(new URL('shaders/lab.wgsl', import.meta.url))).text();
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctxV = $('view').getContext('webgpu'); ctxS = $('slice').getContext('webgpu');
  for (const c of [ctxV, ctxS]) c.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  for (const m of info.messages) if (m.type === 'error') console.error('WGSL', m.lineNum + ':' + m.linePos, m.message);
  ubuf = device.createBuffer({ size: U.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const mk = entry => device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: entry, targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  [pipeV, pipeS] = await Promise.all([mk('fs_view'), mk('fs_slice')]);
  bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  device.lost.then(i => { if (!torn) console.warn('GPU device lost:', i.message); });
}
function pass(enc, ctx, pipe) {
  const p = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
  p.setPipeline(pipe); p.setBindGroup(0, bind); p.draw(3); p.end();
}
function frame(now) {
  if (torn) return;
  raf = requestAnimationFrame(frame);
  if (ovDirty || gpuDirty) { lastTrace = traceProbe(); }
  if (gpuDirty && device) {
    packUniforms(now / 1000);
    device.queue.writeBuffer(ubuf, 0, U);
    const enc = device.createCommandEncoder();
    if ($('view').width > 1) pass(enc, ctxV, pipeV);
    if ($('slice').width > 1) pass(enc, ctxS, pipeS);
    device.queue.submit([enc.finish()]);
    frames++;
  }
  if (ovDirty) { drawSliceOverlay(); draw3dOverlay(); refreshReadouts(); }
  gpuDirty = false; ovDirty = false;
}
function teardown() { if (torn) return; torn = true; cancelAnimationFrame(raf); clearTimeout(statsTimer); try { device && device.destroy(); } catch (_) {} }
addEventListener('pagehide', teardown);

// ── boot ────────────────────────────────────────────────────────────────────
mountEquations();
buildUI();
loadPreset('one sphere');
bind3d(); bindSlice();
new ResizeObserver(sizeCanvases).observe($('panes'));
layout();
window.__lab = { S, loadPreset, setMode, setRelax, layout, stats: () => lastStats, trace: () => lastTrace, frames: () => frames, handle: () => handle.at, dirty, ready: false };

// Screensaver hook for the shell (lib/screensaver.js). enter() hides the GUI,
// the slice pane and the 2D overlays, so the 3D view (with the slice plane
// painted in it) fills the window. The camera orbits slowly and the plane
// drifts. Every seconds/4 (at least 8 s) the next preset and a calm mode
// (shaded, AO, soft shadow) come in behind a fade to black in the shader
// (S.fade, uniform scene.w). calm (1 = slowest) sets the speeds; opts.seed
// sets the preset order. Each preset sends opts.label a plate (saverPlate),
// refreshed once a second. No exit(): the shell reloads the page on stop.
// The saver plate: the tracer step of SC.march and lab.wgsl, the field of the
// current preset written from S.prims (scene.js sdPrim / combine / domain),
// the shading term of the current mode, and the live step counts.
const SUBS = '₁₂₃₄₅₆';
function primText(pr, i) {
  const [a, b, c] = pr.size, d = 'd' + SUBS[i] + ' ' + SC.TYPES[pr.type] + ': ';
  switch (pr.type) {
    case 0: return d + '|p − c| − r, r = ' + f2(a);
    case 1: return d + '|max(q, 0)| + min(max qᵢ, 0), q = |p − c| − b, b = (' + [a, b, c].map(f2).join(', ') + ')';
    case 2: return d + 'box of b − ρ, minus ρ = ' + f2(0.25 * Math.min(a, b, c)) + ', b = (' + [a, b, c].map(f2).join(', ') + ')';
    case 3: return d + '|(|p.xz| − R, y)| − r, R = ' + f2(a) + ', r = ' + f2(b);
    case 4: return d + '2D box of (|p.xz| − r, |y| − h), r = ' + f2(a) + ', h = ' + f2(b);
    case 5: return d + '|p − clamp(y, −h, h)·ŷ| − r, r = ' + f2(a) + ', h = ' + f2(b);
    default: return d + '(|x| + |y| + |z| − s)/√3, s = ' + f2(a);
  }
}
function opText(op, x, di, k) {
  const kk = '_' + f2(k);
  return ['min(' + x + ', ' + di + ')', 'max(' + x + ', −' + di + ')', 'max(' + x + ', ' + di + ')',
    'smin' + kk + '(' + x + ', ' + di + ')', '−smin' + kk + '(−' + x + ', ' + di + ')', '−smin' + kk + '(−' + x + ', −' + di + ')'][op];
}
// TeX of the field: the same fold as opText, with d_i for each primitive.
function opTeX(op, x, di) {
  const sm = '\\operatorname{smin}_k';
  return ['\\min(' + x + ', ' + di + ')', '\\max(' + x + ', -' + di + ')', '\\max(' + x + ', ' + di + ')',
    sm + '(' + x + ', ' + di + ')', '-' + sm + '(-' + x + ', ' + di + ')', '-' + sm + '(-' + x + ', -' + di + ')'][op];
}
// Colours of the plate: the ray (o, r, p, t) m1, the field d m2, the
// normal n m3, the smooth-min width k m4, the tracer settings (s, epsilon,
// N) m6.
const PLATE_RULES = [['\\mathbf{o}', 'm1'], ['\\mathbf{r}', 'm1'], ['\\mathbf{p}', 'm1'], ['\\mathbf{l}', 'm3'], ['\\mathbf{n}', 'm3'], ['t', 'm1'],
  ['d', 'm2'], ['k', 'm4'], ['s', 'm6'], ['\\varepsilon', 'm6'], ['N', 'm6']];
function saverPlate() {
  let field = 'd' + SUBS[0], ftex = 'd_1';
  S.prims.forEach((pr, i) => { if (i) { field = opText(pr.op, field, 'd' + SUBS[i], Math.max(pr.k, 1e-3)); ftex = opTeX(pr.op, ftex, 'd_' + (i + 1)); } });
  const eq = ['t ← t + s·d(o + t·r̂)', 'stop: d < ε, or t > ' + SC.TMAX + ', or ' + S.maxSteps + ' steps', 'd(p) = ' + field];
  if (S.rep > 0) eq.push('p.xz ← p.xz − c·clamp(round(p.xz/c), −n, n)');
  if (S.twist) eq.push('p.xz ← R(' + S.twist + '·y)·p.xz   (twist about y)');
  const smooth = S.prims.some((pr, i) => i && pr.op >= 3);
  if (smooth) eq.push('smin_k(a, b) = min(a, b) − h²k/4', 'h = max(k − |a − b|, 0)/k');
  if (S.mode === 4) eq.push('AO = 1 − 2.4 Σᵢ 0.9ⁱ (hᵢ − d(p + hᵢn))');
  else if (S.mode === 5) eq.push('shadow = min over t of 12·d(p + t·l)/t', 't += clamp(d, 0.01, 0.3)');
  else eq.push('col ∝ (0.1 + 0.9·max(n·l, 0)·shadow)', '      × (0.4 + 0.6·AO) + specular');
  // TeX: the step (equations.js "step", with the step scale s), the field
  // of this preset, then the smooth min or the shading term of the mode,
  // then the stop test. The shell shows the first two on a phone.
  const tex = ['t_{n+1} = t_n + s\\, d(\\mathbf{o} + t_n\\,\\mathbf{r})', 'd(\\mathbf{p}) = ' + ftex];
  if (smooth) tex.push('\\operatorname{smin}_k(a,b) = \\min(a,b) - \\tfrac{k}{4}\\,h^{2}, \\quad h = \\frac{\\max(k - |a-b|,\\,0)}{k}');
  if (S.mode === 4) tex.push('\\text{AO} = 1 - 2.4 \\sum_{i=1}^{5} 0.9^{i}\\,\\bigl(h_i - d(\\mathbf{p} + h_i\\,\\mathbf{n})\\bigr)');
  else if (S.mode === 5) tex.push('\\text{shadow} = \\min_t \\frac{12\\, d(\\mathbf{p} + t\\,\\mathbf{l})}{t}');
  else tex.push('\\text{col} \\propto \\bigl(0.1 + 0.9 \\max(\\mathbf{n}\\cdot\\mathbf{l}, 0)\\,\\text{shadow}\\bigr)(0.4 + 0.6\\,\\text{AO})');
  tex.push('\\text{stop if } d < \\varepsilon \\text{ or } t > ' + SC.TMAX + ' \\text{ or } n = N');
  const params = [{ sym: 's', name: 'step scale', value: f2(S.stepScale), cls: 'm6' },
    { sym: '\\varepsilon', name: 'hit threshold', value: String(SC.EPS), cls: 'm6' },
    { sym: 'N', name: 'step cap', value: String(S.maxSteps), cls: 'm6' }];
  if (smooth) params.push({ sym: 'k', name: 'blend width', value: f2(Math.max(...S.prims.filter((pr, i) => i && pr.op >= 3).map(pr => pr.k))), cls: 'm4' });
  if (lastStats) params.push({ sym: '\\bar n', name: 'mean steps per pixel', value: lastStats.plain.toFixed(1), cls: '' });
  const note = SC.PRESETS[S.preset] ? SC.PRESETS[S.preset].note : '', dot = note.indexOf('. ');
  const lines = [MODES[S.mode] + ': ' + MODE_NOTE[S.mode], dot > 0 ? note.slice(0, dot + 1) : note].filter(Boolean);
  return { title: 'Sphere tracing · ' + S.preset, sub: 'Ray march by the distance bound d(p)', params, lines, tex, rules: PLATE_RULES, eq, anchor: sceneAnchor };
}
// The solid on screen, for the shell's label plate. Each visible primitive
// (the first one, and each union or smooth union after it; a cut or an
// intersection only removes) gives a centre and a bounding radius from its
// size. With repetition there is one copy per grid cell. SC.project, the
// overlay projection, gives view px; the view rect adds the page offset.
// x, y is the centre of the box round the projected discs, r the radius
// that holds them all. pts are the primitive centres when there are 2 to 8.
function primBound(pr) {
  const [a, b, c] = pr.size;
  return [a, Math.hypot(a, b, c), Math.hypot(a, b, c), a + b, Math.hypot(a, b), a + b, a][pr.type] || a;
}
function sceneAnchor() {
  const v = $('view'); if (!v) return null;
  const R = v.getBoundingClientRect(); if (R.width < 2) return null;
  const C = cam(), m = Math.min(R.width, R.height), discs = [];
  const offs = [];
  if (S.rep > 0) { for (let i = -S.rep; i <= S.rep; i++) for (let j = -S.rep; j <= S.rep; j++) offs.push([i * S.period, j * S.period]); }
  else offs.push([0, 0]);
  S.prims.forEach((pr, i) => {
    if (i && pr.op !== 0 && pr.op !== 3) return;
    for (const [ox, oz] of offs) {
      const X = [pr.pos[0] + ox, pr.pos[1], pr.pos[2] + oz];
      const q = SC.project(C, X, R.width, R.height); if (!q) continue;
      const z = (X[0] - C.eye[0]) * C.fwd[0] + (X[1] - C.eye[1]) * C.fwd[1] + (X[2] - C.eye[2]) * C.fwd[2];
      discs.push({ x: q[0] + R.left, y: q[1] + R.top, r: primBound(pr) * SC.FOCAL / z * m / 2 });
    }
  });
  if (!discs.length) return null;
  const x0 = Math.min(...discs.map(d => d.x - d.r)), x1 = Math.max(...discs.map(d => d.x + d.r));
  const y0 = Math.min(...discs.map(d => d.y - d.r)), y1 = Math.max(...discs.map(d => d.y + d.r));
  const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
  const r = Math.max(...discs.map(d => Math.hypot(d.x - x, d.y - y) + d.r));
  const out = { x, y, r };
  if (S.rep === 0 && discs.length >= 2) out.pts = discs.slice(0, 8).map(d => ({ x: d.x, y: d.y }));
  return out;
}
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let sd = (o.seed >>> 0) || 1;
    const rnd = () => { sd = (sd + 0x6D2B79F5) >>> 0; let t = sd; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#dock,#gear,.plabel,.pread,.phint,#paneSlice,.ov,#nogpu{display:none!important}'
      + '#panes{grid-template-columns:1fr!important;grid-template-rows:1fr!important;gap:0!important}#view{cursor:none}';
    document.head.appendChild(st);
    $('panel').classList.remove('open', 'full'); document.body.classList.add('panel-closed');
    layout();
    const names = Object.keys(SC.PRESETS);
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    const MODES_CALM = [0, 4, 0, 5];
    const hold = Math.max(8, (o.seconds || 60) / 4) * 1000, FADE = 0.9;
    const spin = 0.12 * (1 - 0.6 * calm), drift = 0.2 * (1 - 0.5 * calm);
    let n = 0, yaw = 0.5, base = 0, dist = 5.6, phase = 'in', since = performance.now(), last = since, t = 0;
    const next = () => {
      loadPreset(names[n % names.length]);
      dist = S.cam.dist; base = S.offset;
      S.mode = MODES_CALM[n % MODES_CALM.length]; S.relax = false; n++;
      plate();
    };
    const label = typeof o.label === 'function' ? o.label : null;
    const plate = () => { if (label) label(saverPlate()); };
    next(); S.fade = 1;
    // The mean steps per pixel arrive 160 ms after a preset loads (scheduleStats),
    // so the plate refreshes in place once a second.
    setInterval(plate, 1000);
    const tick = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      yaw += dt * spin;
      S.cam = { yaw, pitch: 0.32 + 0.1 * Math.sin(t * 0.07), dist };
      S.offset = base + 0.45 * Math.sin(t * drift);
      if (phase === 'show' && now - since > hold) phase = 'out';
      else if (phase === 'out') { S.fade = Math.min(1, S.fade + dt / FADE); if (S.fade >= 1) { next(); phase = 'in'; } }
      else if (phase === 'in') { S.fade = Math.max(0, S.fade - dt / FADE); if (S.fade <= 0) { phase = 'show'; since = now; } }
      dirty(false);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { canvas: $('view'), warmupMs: 1500 };
  },
};
try { await initGPU(); window.__lab.ready = true; } catch (e) { $('nogpu').hidden = false; console.error(e); }
dirty();
raf = requestAnimationFrame(frame);

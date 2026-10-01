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
  U.set([S.twist, S.period, S.rep, 0], 36);
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
try { await initGPU(); window.__lab.ready = true; } catch (e) { $('nogpu').hidden = false; console.error(e); }
dirty();
raf = requestAnimationFrame(frame);

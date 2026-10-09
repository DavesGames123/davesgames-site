// ============================================================================
//  NEURON LAB  ·  main.js  ·  page logic
// ----------------------------------------------------------------------------
//  Binds index.html. Builds one procedural cell (engine/morph.js) as a
//  NEURON-style cable (engine/cell.js), draws it as glowing tubes
//  (shared/neuron-mesh.js) and steps the solver in slow motion: the speed
//  slider sets the simulated ms per real second.
//
//  Tools: a click or tap picks the nearest node on screen (within 30 px,
//  44 px on touch) and places an IClamp, an Exp2Syn with its NetStim and
//  NetCon, or a voltage probe, or erases the nearest marker. Fire starts
//  every clamp and every synapse burst at the same time.
//
//  grep -n targets
//    "function loadCell"    build the cell, mesh and markers
//    "function densFor"     channel densities by section kind
//    "function place"       add or erase a marker at a node
//    "function fire"        start the stimuli
//    "function drawTraces"  probe traces, phase plane, gates
//    "function layout"      desktop columns or phone sheet; clear area
//    "function frame"       the loop
// ============================================================================
import * as THREE from 'three';
import { Cell } from './engine/cell.js';
import { HH, rates } from './engine/hh.js';
import { makeCell, CELLS, bounds } from './engine/morph.js';
import { createStage } from './shared/stage.js';
import { buildNeuronMesh } from './shared/neuron-mesh.js';
import { typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const PROBE_COL = ['#ffd27a', '#5fd4ff', '#ff6f9c', '#7de0a6'];
const DLAMBDA = 0.03; // finer than the usual 0.1, so the colour runs smoothly

const P = {
  type: 'pyramidal', seed: 1, gna: 0.12, gk: 0.036, dfrac: 0.3, gl: 0.0003, ttx: false, tea: false,
  celsius: 6.3, Ra: 35.4, diam: 1, speed: 8, paused: false, tool: 'iclamp', amp: 1, dur: 2,
  wsyn: 0.02, nsyn: 3, auto: true, hold: false, orbit: true,
};
try { const h = location.hash.slice(1); if (CELLS.some(c => c.id === h)) P.type = h; } catch (e) { /* file: */ }

const stage = createStage({ canvas: $('view'), coarse: COARSE, onNoGL: () => { $('nogl').hidden = false; } });
const L = {
  cell: null, mesh: null, B: null, markers: [], probes: [], group: new THREE.Group(),
  hist: null, lastAuto: -1e9, lastSpike: NaN, saver: false, prevSoma: -65,
};
if (stage) stage.scene.add(L.group);

// ── cell ────────────────────────────────────────────────────────────────
function densFor(s) {
  const k = s.kind;
  let f = k === 'soma' || k === 'axon' ? 1 : k === 'ais' ? 2 : P.dfrac;
  return { gnabar: P.ttx ? 0 : P.gna * f, gkbar: P.tea ? 0 : P.gk * Math.min(1, f), gl: P.gl, el: HH.el };
}
function nodeAt(cell, si, x) { const s = cell.sections[si]; return s.first + Math.min(s.nseg - 1, Math.floor(x * s.nseg)); }

function loadCell(o = {}) {
  const keep = o.keep !== false && L.cell;
  const old = keep ? { markers: L.markers.map(m => ({ kind: m.kind, sec: m.sec, x: m.x })), probes: L.probes.map(p => ({ sec: p.sec, x: p.x })) } : null;
  const S = o.sections || makeCell(P.type, P.seed);
  clearMarkers(true); // with the old cell, before it goes
  const cell = new Cell(S, { Ra: P.Ra, celsius: P.celsius, diamScale: P.diam, dlambda: DLAMBDA, dens: densFor });
  cell.useTable(true);
  L.cell = cell; L.B = bounds(S);
  if (stage) {
    if (L.mesh) { L.group.remove(L.mesh.mesh); L.mesh.dispose(); }
    L.mesh = buildNeuronMesh(THREE, cell, { thick: 1.6, minR: L.B.R * 0.0022 });
    L.group.add(L.mesh.mesh);
  }
  if (old) {
    for (const m of old.markers) place(m.kind, nodeAt(cell, m.sec, m.x), true);
    for (const p of old.probes) place('probe', nodeAt(cell, p.sec, p.x), true);
  } else if (o.defaults !== false) defaults();
  resetHistory();
  fillCellInfo();
  if (o.fit !== false && stage && !L.saver) fitCamera(true);
}

// A clamp on the soma, probes on the soma, the farthest dendrite tip and the axon end.
function defaults() {
  const c = L.cell;
  place('iclamp', 0, true);
  place('probe', 0, true);
  const far = farNode(k => k !== 'axon' && k !== 'ais' && k !== 'soma', 0.85);
  if (far >= 0) place('probe', far, true);
  const ax = farNode(k => k === 'axon', 0.9);
  if (ax >= 0) place('probe', ax, true);
  P.amp = P.type === 'motor' ? 6 : P.type === 'granule' ? 0.15 : P.type === 'purkinje' ? 2.5 : 1.5;
  $('amp').value = P.amp; showVals();
  return c;
}
// the node with the greatest path distance among sections of kinds that pass test, scaled by q
function farNode(test, q = 1) {
  const c = L.cell; let best = -1, bd = -1;
  for (let i = 0; i < c.n; i++) if (test(c.sections[c.sec[i]].kind) && c.dist[i] > bd) { bd = c.dist[i]; best = i; }
  if (best < 0 || q >= 1) return best;
  // walk back toward the soma until the distance is q of the max
  let i = best; while (i > 0 && c.dist[i] > q * bd) i = c.parent[i];
  return i;
}

function applyDensities() {
  const c = L.cell; if (!c) return;
  for (let i = 0; i < c.n; i++) { const D = densFor(c.sections[c.sec[i]]); c.gnabar[i] = D.gnabar; c.gkbar[i] = D.gkbar; c.gl[i] = D.gl; }
}

// ── markers ─────────────────────────────────────────────────────────────
const geoSphere = new THREE.SphereGeometry(1, 16, 12);
function markerMesh(color, s) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geoSphere, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const halo = new THREE.Mesh(geoSphere, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
  core.scale.setScalar(s); halo.scale.setScalar(s * 2.2);
  g.add(core, halo); g.userData = { core, halo, base: s };
  return g;
}
function place(kind, node, quiet) {
  const c = L.cell; if (!c || node < 0) return null;
  const R = L.B.R, x = c.xc[node], sec = c.sec[node];
  const p = [c.pos[node * 3], c.pos[node * 3 + 1], c.pos[node * 3 + 2]];
  if (kind === 'erase') {
    let best = null, bd = Infinity;
    for (const m of [...L.markers, ...L.probes]) { const q = m.p, d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); if (d < bd) { bd = d; best = m; } }
    if (best && bd < R * 0.12) removeMarker(best);
    return null;
  }
  if (kind === 'probe') {
    if (L.probes.length >= 4) removeMarker(L.probes[0]);
    const used = new Set(L.probes.map(q => q.col));
    const col = PROBE_COL.find(cc => !used.has(cc)) || PROBE_COL[0];
    const m = { kind, node, sec, x, p, col, obj: markerMesh(col, R * 0.007) };
    m.obj.position.set(...p); L.group.add(m.obj); L.probes.push(m);
    m.label = mkLabel('', col);
    relabel(); resetHistory();
    return m;
  }
  const m = { kind, node, sec, x, p, flash: 0 };
  if (kind === 'iclamp') { m.pp = c.iclamp(node, { del: 1e9, dur: 0, amp: 0 }); m.col = '#ffb347'; }
  else {
    m.pp = c.exp2Syn(node, { tau1: 0.3, tau2: 3, e: 0 });
    m.ns = c.netstim({ interval: 6, number: 0, start: -1, noise: 0 });
    const nc = c.netcon(m.ns, m.pp, { delay: 1, weight: P.wsyn }); m.nc = nc;
    m.col = '#7de0a6';
  }
  m.obj = markerMesh(m.col, R * 0.009); m.obj.position.set(...p); L.group.add(m.obj);
  m.label = mkLabel(kind === 'iclamp' ? 'IClamp' : 'Exp2Syn', m.col);
  L.markers.push(m);
  if (!quiet && !L.saver) fire([m]);
  return m;
}
function removeMarker(m) {
  const c = L.cell;
  L.group.remove(m.obj); m.obj.traverse(o => { if (o.material) o.material.dispose(); });
  if (m.label) m.label.remove();
  if (m.kind === 'probe') { L.probes.splice(L.probes.indexOf(m), 1); relabel(); }
  else {
    L.markers.splice(L.markers.indexOf(m), 1);
    c.remove(m.pp);
    if (m.ns) { const k = c.stims.indexOf(m.ns); if (k >= 0) c.stims.splice(k, 1); m.ns.number = 0; }
  }
}
function clearMarkers(all) { for (const m of [...L.markers, ...L.probes]) if (all || m.kind !== 'probe') removeMarker(m); }
function mkLabel(text, col) { const d = document.createElement('div'); d.className = 'mk'; d.style.color = col; d.textContent = text; $('marks').appendChild(d); return d; }
function relabel() {
  if (!L.cell) return;
  L.probes.forEach((p, i) => { p.label.textContent = 'P' + (i + 1); });
  $('legend').innerHTML = L.probes.map((p, i) => `<span><i style="background:${p.col}"></i>P${i + 1} · ${esc(L.cell.sections[p.sec].name)} · ${Math.round(L.cell.dist[p.node])} µm</span>`).join('');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ── stimuli ─────────────────────────────────────────────────────────────
function fire(list = L.markers) {
  const c = L.cell, t0 = c.t + 0.2;
  for (const m of list) {
    if (m.kind === 'iclamp') { m.pp.del = t0; m.pp.dur = P.hold ? 1e9 : P.dur; m.pp.amp = P.amp; }
    else if (m.kind === 'syn') { m.nc.weight = P.wsyn; m.ns.number = P.nsyn; m.ns.interval = 6; m.ns.burst(c, t0); }
    m.flash = 1;
  }
  L.lastAuto = c.t;
}
function holdOff() { for (const m of L.markers) if (m.kind === 'iclamp' && m.pp.dur > 1e8) { m.pp.dur = 0; m.pp.amp = 0; } }

// ── history for plots ───────────────────────────────────────────────────
const HN = 700, HDT = 0.1; // samples, ms per sample: a 70 ms window
function resetHistory() {
  L.hist = { n: 0, k: 0, t: new Float32Array(HN), v: L.probes.map(() => new Float32Array(HN)), soma: new Float32Array(HN), m: new Float32Array(HN), h: new Float32Array(HN), nn: new Float32Array(HN), next: L.cell ? L.cell.t : 0 };
}
function sample() {
  const c = L.cell, H = L.hist;
  if (c.t + 1e-9 < H.next) return;
  H.next = c.t + HDT;
  const k = H.k;
  H.t[k] = c.t; H.soma[k] = c.v[0]; H.m[k] = c.m[0]; H.h[k] = c.h[0]; H.nn[k] = c.nn[0];
  L.probes.forEach((p, i) => { if (H.v[i]) H.v[i][k] = c.v[p.node]; });
  H.k = (k + 1) % HN; H.n = Math.min(HN, H.n + 1);
}

// ── plots ───────────────────────────────────────────────────────────────
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
}
function axes(g, w, h, ys, fy) {
  g.fillStyle = '#060a13'; g.fillRect(0, 0, w, h);
  g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
  for (const [y, lab] of ys) { const py = fy(y); g.strokeStyle = 'rgba(95,212,255,0.10)'; g.beginPath(); g.moveTo(30, py); g.lineTo(w, py); g.stroke(); g.fillStyle = '#56627a'; g.fillText(lab, 2, py); }
}
function series(g, H, arr, fx, fy, col, lw = 1.6) {
  g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
  for (let j = 0; j < H.n; j++) { const k = (H.k - H.n + j + HN) % HN, x = fx(j), y = fy(arr[k]); if (j) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
}
function drawTraces(target) {
  const H = L.hist; if (!H) return;
  const tv = target || $('traces');
  if (tv.offsetParent !== null || target) {
    const { g, w, h } = fitCanvas(tv);
    const fy = v => 8 + (h - 16) * (1 - (v + 85) / 135), fx = j => 30 + (w - 34) * (j + HN - H.n) / (HN - 1);
    axes(g, w, h, [[40, '+40'], [0, '0'], [-65, '-65']], fy);
    L.probes.forEach((p, i) => { if (H.v[i]) series(g, H, H.v[i], fx, fy, p.col); });
    g.fillStyle = '#56627a'; g.textAlign = 'right'; g.fillText('70 ms', w - 4, h - 8); g.textAlign = 'left';
  }
  const pv = $('phase');
  if (pv.offsetParent !== null) drawPhase(pv);
  const gv = $('gates');
  if (gv.offsetParent !== null) drawGates(gv);
}
const NINF = (() => { const r = new Float64Array(6), out = []; for (let v = -85; v <= 50; v += 1) { rates(v, 6.3, r); out.push([v, r[4]]); } return out; })();
export function drawPhase(cv, opts = {}) {
  const H = L.hist, { g, w, h } = fitCanvas(cv);
  const fx = v => 34 + (w - 42) * (v + 85) / 135, fy = n => h - 22 - (h - 34) * (n - 0.25) / 0.6;
  g.fillStyle = opts.bg || '#060a13'; g.fillRect(0, 0, w, h);
  g.font = '10px ui-monospace, Menlo, monospace'; g.fillStyle = '#56627a';
  g.fillText('V (mV) →', w - 70, h - 8); g.fillText('n', 6, 14);
  for (const v of [-65, 0, 40]) { g.strokeStyle = 'rgba(95,212,255,0.10)'; g.beginPath(); g.moveTo(fx(v), 8); g.lineTo(fx(v), h - 22); g.stroke(); g.fillText(String(v), fx(v) - 8, h - 8); }
  // n = ninf(V): where dn/dt = 0
  g.setLineDash([4, 4]); g.strokeStyle = 'rgba(232,137,220,0.45)'; g.beginPath();
  NINF.forEach(([v, n], i) => { const x = fx(v), y = fy(n); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(232,137,220,0.7)'; g.fillText('n∞(V)', fx(10), fy(0.8) + 2);
  if (!H || H.n < 2) return;
  for (let j = 1; j < H.n; j++) {
    const k0 = (H.k - H.n + j - 1 + HN) % HN, k1 = (H.k - H.n + j + HN) % HN, a = j / H.n;
    g.strokeStyle = `rgba(95,212,255,${(0.08 + 0.92 * a * a).toFixed(3)})`; g.lineWidth = opts.lw || 1.8;
    g.beginPath(); g.moveTo(fx(H.soma[k0]), fy(H.nn[k0])); g.lineTo(fx(H.soma[k1]), fy(H.nn[k1])); g.stroke();
  }
  const k = (H.k - 1 + HN) % HN;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(fx(H.soma[k]), fy(H.nn[k]), 3.5, 0, 7); g.fill();
}
export function drawGates(cv, opts = {}) {
  const H = L.hist, { g, w, h } = fitCanvas(cv);
  const fy = v => 8 + (h - 16) * (1 - v), fx = j => 30 + (w - 34) * (j + HN - H.n) / (HN - 1);
  g.fillStyle = opts.bg || '#060a13'; g.fillRect(0, 0, w, h);
  axes(g, w, h, [[1, '1'], [0.5, '.5'], [0, '0']], fy);
  if (opts.bg) { g.fillStyle = opts.bg; }
  const cs = getComputedStyle(document.documentElement);
  series(g, H, H.m, fx, fy, cs.getPropertyValue('--m2').trim() || '#ff9a62', opts.lw);
  series(g, H, H.h, fx, fy, cs.getPropertyValue('--m3').trim() || '#86dc7c', opts.lw);
  series(g, H, H.nn, fx, fy, cs.getPropertyValue('--m4').trim() || '#e889dc', opts.lw);
}

// ── UI ──────────────────────────────────────────────────────────────────
function fillCellInfo() {
  const C = CELLS.find(c => c.id === P.type), c = L.cell;
  $('cellNote').textContent = C.note + ' Procedural shape, seed ' + P.seed + '.';
  $('cellStats').textContent = `${c.sections.length} sections · ${c.n} compartments (d_lambda ${DLAMBDA}) · dt ${c.dt} ms`;
  document.querySelectorAll('#cells button').forEach(b => b.classList.toggle('on', b.dataset.id === P.type));
  relabel();
}
function buildCards() {
  $('cells').innerHTML = CELLS.map(c => `<button type="button" data-id="${c.id}"><b>${esc(c.short)}</b><span>${esc(c.name)}</span></button>`).join('');
  $('cells').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (P.type === b.dataset.id) return;
    P.type = b.dataset.id; holdOff(); loadCell({ keep: false });
    try { history.replaceState(null, '', '#' + P.type); } catch (e) { /* file: */ }
  }));
}
const fmt = {
  speed: v => v + ' ms', amp: v => (+v).toFixed(2) + ' nA', dur: v => v + ' ms', wsyn: v => (+v).toFixed(3) + ' µS', nsyn: v => v,
  gna: v => (+v).toFixed(3), gk: v => (+v).toFixed(3), dfrac: v => Math.round(v * 100) + '%', gl: v => (+v).toFixed(4),
  celsius: v => (+v).toFixed(1) + ' °C', ra: v => Math.round(v) + ' Ωcm', diam: v => (+v).toFixed(2) + '×',
};
function showVals() { for (const k in fmt) { const e = $(k), o = $(k + 'V'); if (e && o) o.textContent = fmt[k](e.value); } }
function bindRange(id, fn) { $(id).addEventListener('input', () => { fn(+$(id).value); showVals(); }); }
let rebuildT = 0;
const rebuildSoon = () => { clearTimeout(rebuildT); rebuildT = setTimeout(() => loadCell({ fit: false }), 120); };
function bindUI() {
  buildCards();
  bindRange('speed', v => { P.speed = v; });
  bindRange('amp', v => { P.amp = v; });
  bindRange('dur', v => { P.dur = v; });
  bindRange('wsyn', v => { P.wsyn = v; });
  bindRange('nsyn', v => { P.nsyn = v; });
  bindRange('gna', v => { P.gna = v; applyDensities(); });
  bindRange('gk', v => { P.gk = v; applyDensities(); });
  bindRange('dfrac', v => { P.dfrac = v; applyDensities(); });
  bindRange('gl', v => { P.gl = v; applyDensities(); });
  bindRange('celsius', v => { P.celsius = v; L.cell.celsius = v; });
  bindRange('ra', v => { P.Ra = v; rebuildSoon(); });
  bindRange('diam', v => { P.diam = v; rebuildSoon(); });
  const tog = (id, key, after) => $(id).addEventListener('click', () => { P[key] = !P[key]; $(id).classList.toggle('on', P[key]); if (after) after(); });
  tog('ttx', 'ttx', applyDensities); tog('tea', 'tea', applyDensities);
  tog('auto', 'auto'); tog('autoOrbit', 'orbit');
  tog('hold', 'hold', () => { if (P.hold) fire(L.markers.filter(m => m.kind === 'iclamp')); else holdOff(); });
  tog('pause', 'paused');
  $('auto').classList.toggle('on', P.auto);
  document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => { P.tool = b.dataset.tool; document.querySelectorAll('#tools button').forEach(q => q.classList.toggle('on', q === b)); }));
  $('fire').addEventListener('click', () => fire());
  $('dockFire').addEventListener('click', () => fire());
  $('clearAll').addEventListener('click', () => clearMarkers(false));
  $('reshape').addEventListener('click', () => { P.seed = (P.seed % 9973) + 1; loadCell({ keep: false }); });
  $('resetSim').addEventListener('click', () => { holdOff(); L.cell.init(); for (const m of L.markers) if (m.ns) m.ns.number = 0; resetHistory(); });
  // dock and sheet
  document.querySelectorAll('#dock button[data-grp]').forEach(b => b.addEventListener('click', () => openGroup(b.dataset.grp === openG ? null : b.dataset.grp)));
  $('panelClose').addEventListener('click', () => openGroup(null));
  showVals();
}
let openG = null;
function openGroup(g) {
  openG = g;
  $('panel').classList.toggle('open', !!g);
  document.querySelectorAll('#panel .grp').forEach(s => s.classList.toggle('show', s.dataset.grp === g));
  document.querySelectorAll('#dock button[data-grp]').forEach(b => b.classList.toggle('on', b.dataset.grp === g));
  setTimeout(layout, 320);
}
function layout() {
  const phone = PHONE_Q.matches, ana = $('anaPanel'), panel = $('panel');
  document.querySelectorAll('.grp.ana').forEach(s => { const host = phone ? panel : ana; if (s.parentNode !== host) host.appendChild(s); });
  if (!stage) return;
  stage.resize();
  if (L.saver) return;
  const v = $('view').getBoundingClientRect();
  let x0 = 0, x1 = v.width, y0 = 0, y1 = v.height;
  if (!phone) { x0 = panel.getBoundingClientRect().right - v.left; x1 = ana.getBoundingClientRect().left - v.left; }
  else {
    const dk = $('dock').getBoundingClientRect();
    if (dk.width > dk.height) y1 = dk.top - v.top; else x0 = dk.right - v.left;
    if (panel.classList.contains('open')) { const pr = panel.getBoundingClientRect(); if (pr.width > v.width * 0.8) y1 = Math.min(y1, pr.top - v.top); else x1 = Math.min(x1, pr.left - v.left); }
  }
  stage.frame({ x0, y0, x1, y1 });
}
function fitCamera(soft) {
  const B = L.B, fov = stage.camera.fov * Math.PI / 180;
  const r = B.R / Math.tan(fov / 2) * 1.05 / stage.fit;
  const o = { az: 0.5, el: 0.12, r, target: B.c };
  if (soft) stage.flyTo(o, 2.2); else stage.jump(o);
}

// ── picking ─────────────────────────────────────────────────────────────
const _v = new THREE.Vector3();
function pickNode(cx, cy) {
  const c = L.cell, rect = $('view').getBoundingClientRect(), cam = stage.camera;
  const x = cx - rect.left, y = cy - rect.top, lim = COARSE ? 44 : 30;
  let best = -1, bd = lim * lim, bz = Infinity;
  for (let i = 0; i < c.n; i++) {
    _v.set(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]).project(cam);
    if (_v.z > 1) continue;
    const sx = (_v.x + 1) / 2 * rect.width, sy = (1 - _v.y) / 2 * rect.height, d = (sx - x) ** 2 + (sy - y) ** 2;
    if (d < bd - 4 || (d < bd + 4 && _v.z < bz)) { bd = d; best = i; bz = _v.z; }
  }
  return best;
}
function bindPick() {
  let down = null;
  $('view').addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  $('view').addEventListener('pointerup', e => {
    if (!down) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (d < 8 && performance.now() - down.t < 600) { const n = pickNode(e.clientX, e.clientY); if (n >= 0) { place(P.tool, n); $('hint').classList.add('gone'); } }
    down = null;
  });
}

// ── loop ────────────────────────────────────────────────────────────────
const AUTO_MS = 40;
let last = 0, plotT = 0;
function stepSim(simMs) {
  const c = L.cell, n = Math.min(400, Math.round(simMs / c.dt));
  for (let i = 0; i < n; i++) {
    c.step(); sample();
    if (L.prevSoma < 0 && c.v[0] >= 0) L.lastSpike = c.t;
    L.prevSoma = c.v[0];
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
  if (!L.cell) return;
  if (L.saver) { if (L.saverTick) L.saverTick(dt, now); }
  else {
    if (!P.paused) {
      if (P.auto && !P.hold && L.markers.length && L.cell.t - L.lastAuto > AUTO_MS) fire();
      stepSim(P.speed * dt);
    }
    stage.controls.autoRotate = P.orbit && !stage.springOn; stage.controls.autoRotateSpeed = 0.35;
  }
  if (!stage) return;
  L.mesh.update(L.cell.v);
  for (const m of L.markers) { if (m.flash > 0) m.flash = Math.max(0, m.flash - dt * 1.5); const s = m.obj.userData.base * (1 + 1.4 * m.flash); m.obj.userData.halo.scale.setScalar(s * 2.2); }
  stage.update(dt);
  stage.render();
  if (!L.saver) {
    updateLabels();
    if (now - plotT > 50) { plotT = now; drawTraces(); readout(); }
  }
}
function updateLabels() {
  const rect = $('view').getBoundingClientRect();
  for (const m of [...L.markers, ...L.probes]) {
    _v.set(...m.p).project(stage.camera);
    const on = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    m.label.style.display = on ? '' : 'none';
    if (on) m.label.style.transform = `translate(${((_v.x + 1) / 2 * rect.width).toFixed(1)}px,${((1 - _v.y) / 2 * rect.height).toFixed(1)}px) translate(-50%,-150%)`;
  }
}
function readout() {
  const c = L.cell, C = CELLS.find(q => q.id === P.type);
  $('read').innerHTML = `${esc(C.short)} · t <span class="hi">${c.t.toFixed(1)}</span> ms<br>soma <span class="hi">${c.v[0].toFixed(1)}</span> mV · ${P.celsius.toFixed(1)} °C<br><span class="lo">${isNaN(L.lastSpike) ? 'no spike yet' : 'last soma spike ' + (c.t - L.lastSpike).toFixed(1) + ' ms ago'}</span>`;
}

// ── boot ────────────────────────────────────────────────────────────────
bindUI();
if (stage) {
  bindPick();
  layout();
  loadCell({ keep: false });
  fitCamera(false);
  addEventListener('resize', () => { layout(); });
  PHONE_Q.addEventListener('change', () => { openGroup(null); layout(); });
  requestAnimationFrame(frame);
}
typesetAll(document, [['V', 'm1'], ['m^3', 'm2'], ['n^4', 'm4'], ['R_a', 'm5']]);
window.__neuronLab = { L, P };

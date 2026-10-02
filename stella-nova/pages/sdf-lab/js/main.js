// ============================================================================
//  SDF FORGE  ·  main.js — the app: state, edits, the frame loop
// ----------------------------------------------------------------------------
//  One object, app, holds the document, the selection, the tools, the panes
//  and the GPU. ui.js and input.js receive it; neither imports this module.
//
//  EVERY EDIT GOES THROUGH TWO DOORS
//    app.commit(label, fn)    a structure edit: fn changes the document and a
//                             'doc' record (before and after JSON) is pushed
//    app.setValues(changes)   a value edit: a 'set' record; a drag brackets a
//                             run of them with hist.begin and hist.end
//  Then app.touch() decides what changed: a new structure signature compiles
//  a new shader (in the background) and a new CPU field; otherwise only the
//  parameter buffer is written, which is what keeps a drag at frame rate.
//
//  RENDER SCHEDULE (performance)
//    a pane renders only when it is dirty;
//    the HOT pane (under the pointer, else the active one) renders every
//    frame while the user interacts, at a scale that adapts to the measured
//    GPU time (0.45 to 1);
//    the other panes render at INACTIVE scale, at most every 100 ms, while the
//    user interacts, then all panes refine to full resolution when input
//    stops; the device pixel ratio is capped at 2.
//    pagehide stops the loop and destroys the device; a hidden tab pauses.
//
//  GREP MAP
//    const app ............ the state
//    app.touch / commit / setValues / select / undo / redo
//    app.addPrimitive / deleteSel / duplicateSel / boolean / ungroupSel
//    app.frameSelected / app.loadDoc / ghostOrd
//    function packPane .... one pane's uniform block (matches struct U)
//    function frame ....... the scheduler
//    function drawOverlays  brackets, gizmo, readouts, cube, slice diagram
//    function probeTrace .. the SLICE probe and its touch points
//    boot ................. renderer, autosave, panes, ui, input
// ============================================================================
import * as D from './doc.js';
import * as V from './math.js';
import { History, isStructuralRecord } from './history.js';
import { buildLayout, packParams, lipschitz, nodeBound } from './codegen.js';
import { compileField, traceProbe, grad } from './field.js';
import { createRenderer, UNIFORM_FLOATS } from './render.js';
import { projection, frameBounds, ORTHO_BACK } from './camera.js';
import * as PN from './panes.js';
import { SLICE_AX } from './panes.js';
import * as GZ from './gizmo.js';
import * as VC from './viewcube.js';
import * as OV from './overlay.js';
import { EXAMPLES } from './examples.js';
import { initUI } from './ui.js';
import { initInput } from './input.js';
import * as FL from './files.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)');
const COARSE_Q = matchMedia('(pointer: coarse)');
const MODE_INDEX = { clay: 0, lit: 1, normals: 2, steps: 3, bands: 4, slice: 5 };

const app = {
  doc: D.newDoc(), hist: new History(), sel: [], hoverId: null,
  tool: 'move', coord: 'world', snap: false, arm: null, pick: null,
  panes: PN.newPanes(), phone: false, coarse: COARSE_Q.matches,
  disp: { grid: true, axes: true, bounds: 'sel', cube: true, ghost: true, shadows: true },
  quality: { maxSteps: 160, inactive: 0.5 },
  slice: { axis: 'xy', off: 0, cu: 0, cv: 1, ext: 3.2, ray: { o: [-2.6, 1.0], a: -0.05 }, relax: false, omega: 1.5, stepScale: 1, maxSteps: 96 },
  F: null, gpuL: null, gpuP: new Float32Array(1024), R: null,
  readout: null, preview: null, gizHover: null, gizActive: null, cubeHover: null, hotSlot: null,
  rects: [], lastInput: 0, hotScale: 1, ovDirty: true,
  stats: { frames: 0, gpuMs: 0, compileMs: 0, lines: 0, draws: 0 },
  listeners: new Set(),
};
window.__sdf = app;   // the CDP check drives the page through this

// ── change propagation ──────────────────────────────────────────────────────
app.on = fn => app.listeners.add(fn);
app.emit = what => { for (const fn of app.listeners) fn(what); };
app.dirtyAll = () => { for (const p of paneState) p.dirty = true; app.ovDirty = true; };
app.dirtyPane = slot => { if (paneState[slot]) paneState[slot].dirty = true; app.ovDirty = true; };
app.poke = () => { app.lastInput = performance.now(); };

// Decide what an edit changed and propagate it.
app.touch = () => {
  const L = buildLayout(app.doc);
  if (!app.F || L.sig !== app.F.L.sig) {
    app.F = compileField(app.doc);
    if (app.R) {
      const want = app.F.L;
      app.R.setStructure(app.doc, want).then(ok => {
        if (!ok) return;
        app.gpuL = want;
        app.stats.compileMs = app.R.pipe.ms; app.stats.lines = app.R.pipe.lines;
        writeGPU(); app.dirtyAll(); app.emit('compiled');
      }).catch(e => { console.error(e); app.toast('Shader error: ' + e.message.slice(0, 160)); });
    }
  } else app.F.update(app.doc);
  writeGPU();
  app.dirtyAll();
  app.sel = app.sel.filter(id => app.doc.nodes[id]);
  if (app.hoverId && !app.doc.nodes[app.hoverId]) app.hoverId = null;
  FL.scheduleAutosave(app);
  app.emit('doc');
};
// The world sphere that holds every visible shape, for the shader early outs
// (struct U scene). [0, 0, 0, -1] when there is none: a plane primitive has
// no bound (a plane under a hidden group also turns the tests off, which is
// only slower), and an empty scene needs no test.
function sceneSphere(doc) {
  if (Object.values(doc.nodes).some(n => n.kind === 'prim' && n.type === 'plane' && !n.hidden)) return [0, 0, 0, -1];
  const b = D.docBounds(doc);
  if (!b || !b.lo.every(Number.isFinite) || !b.hi.every(Number.isFinite)) return [0, 0, 0, -1];
  const c = [0, 1, 2].map(j => (b.lo[j] + b.hi[j]) / 2);
  const r = Math.hypot(b.hi[0] - c[0], b.hi[1] - c[1], b.hi[2] - c[2]);
  return [c[0], c[1], c[2], r * 1.01 + 0.02];
}
function writeGPU() {
  if (!app.R || !app.gpuL) return;
  const L = app.gpuL;
  if (app.gpuP.length < L.size * 4) app.gpuP = new Float32Array(L.size * 8);
  // nodes deleted since the pipeline was built keep their old numbers
  const live = { ...L, order: L.order.filter(id => app.doc.nodes[id] && !app.doc.nodes[id].hidden) };
  packParams(app.doc, live, app.gpuP);
  app.stepK = 1 / lipschitz(app.doc);
  app.sceneSphere = sceneSphere(app.doc);
  // the smallest field ratio of the roots (codegen nodeBound), for the tests
  app.sceneRho = Math.min(1, ...app.doc.roots.map(r => (nodeBound(app.doc, r) || [0, 0, 0, 0, 1])[4]));
  app.R.writeParams(app.gpuP.subarray(0, L.size * 4));
}

app.commit = (label, fn) => {
  const before = D.toJSON(app.doc);
  const out = fn(app.doc);
  const after = D.toJSON(app.doc);
  if (before !== after) app.hist.push({ kind: 'doc', label, before, after });
  app.touch();
  return out;
};
// changes: [{ id, path, value }]
app.setValues = (changes, opt = {}) => {
  const rec = { kind: 'set', label: opt.label || 'Edit', changes: [] };
  for (const c of changes) {
    const before = D.getPath(app.doc, c.id, c.path);
    if (before === undefined) continue;
    D.setPath(app.doc, c.id, c.path, c.value);
    rec.changes.push({ id: c.id, path: c.path, before, after: D.getPath(app.doc, c.id, c.path) });
  }
  if (rec.changes.length) app.hist.push(rec, { merge: !!opt.merge });
  app.touch();
};
app.undo = () => { const r = app.hist.undo(app.doc); if (r) { app.doc = r.doc; app.touch(); app.toast('Undo ' + r.rec.label); } };
app.redo = () => { const r = app.hist.redo(app.doc); if (r) { app.doc = r.doc; app.touch(); app.toast('Redo ' + r.rec.label); } };

// ── selection ───────────────────────────────────────────────────────────────
app.primary = () => app.sel.length ? app.doc.nodes[app.sel[app.sel.length - 1]] : null;
app.select = (ids, mode = 'set') => {
  ids = ids.filter(id => app.doc.nodes[id]);
  if (mode === 'set') app.sel = ids.slice();
  else if (mode === 'add') app.sel = [...app.sel.filter(i => !ids.includes(i)), ...ids];
  else if (mode === 'toggle') for (const id of ids) app.sel = app.sel.includes(id) ? app.sel.filter(i => i !== id) : [...app.sel, id];
  app.dirtyAll(); app.emit('sel');
};
// The top-most selected nodes: a node whose ancestor is also selected moves with it.
app.selRoots = () => app.sel.filter(id => !app.sel.some(o => o !== id && D.isDescendant(app.doc, id, o)));

// ── operations ──────────────────────────────────────────────────────────────
app.deleteSel = () => {
  const ids = app.selRoots();
  if (!ids.length) return;
  app.commit('Delete', d => ids.forEach(id => D.removeNode(d, id)));
  app.select([]);
};
app.duplicateSel = () => {
  const ids = app.selRoots();
  if (!ids.length) return;
  const made = app.commit('Clone', d => ids.map(id => {
    const b = D.worldBounds(d, id), w = b ? b.hi[0] - b.lo[0] : 1;
    return D.duplicate(d, id, [Math.max(0.25, Math.round(w * 4 + 1) / 4), 0, 0]).id;
  }));
  app.select(made);
};
app.boolean = (op, smooth, k, ids = app.selRoots()) => {
  if (ids.length < 2) return null;
  const g = app.commit((smooth ? 'Smooth ' : '') + D.OPS[op], d => D.groupNodes(d, ids, op, smooth, k));
  if (g) app.select([g.id]);
  return g;
};
app.ungroupSel = () => {
  const p = app.primary();
  if (!p || p.kind !== 'group') return;
  const kids = app.commit('Ungroup', d => D.ungroup(d, p.id));
  app.select(kids);
};
app.toggleHide = (ids = app.sel) => {
  if (!ids.length) return;
  const to = !app.doc.nodes[ids[0]].hidden;
  app.setValues(ids.map(id => ({ id, path: 'hidden', value: to })), { label: to ? 'Hide' : 'Unhide' });
};
app.loadDoc = (doc, label = 'Load') => {
  const before = D.toJSON(app.doc);
  app.doc = doc;
  app.hist.push({ kind: 'doc', label, before, after: D.toJSON(doc) });
  app.sel = [];
  app.touch();
  app.frameAll();
  app.emit('sel');
};
app.frameAll = () => {
  const b = D.docBounds(app.doc);
  const vp = $('viewport'), asp = vp.clientWidth / Math.max(1, vp.clientHeight);
  app.panes.slots.forEach((s, i) => { const r = app.rectOf(i); frameBounds(s.cam, b || { lo: [-3, 0, -3], hi: [3, 2, 3] }, s.view === 'persp' ? 1.0 : 0.95, r ? r.w / r.h : asp); });
  app.dirtyAll();
};
app.frameSelected = (slotIdx = app.panes.active) => {
  let b = null;
  for (const id of app.sel) {
    const w = D.worldBounds(app.doc, id);
    if (w) b = b ? { lo: b.lo.map((v, j) => Math.min(v, w.lo[j])), hi: b.hi.map((v, j) => Math.max(v, w.hi[j])) } : w;
  }
  b = b || D.docBounds(app.doc);
  if (!b) return;
  const r = app.rectOf(slotIdx);
  frameBounds(app.panes.slots[slotIdx].cam, b, 1.2, r ? r.w / r.h : 1);
  app.dirtyAll();
};
// A selected node that a boolean hides gets drawn as a ghost.
app.ghostOrd = () => {
  const p = app.primary();
  if (!p || !app.gpuL || app.gpuL.ord[p.id] === undefined) return -1;
  let c = p, par = D.parentOf(app.doc, c.id);
  while (par) {
    if ((par.op === 'subtract' && par.children.indexOf(c.id) > 0) || par.op === 'intersect') return app.gpuL.ord[p.id];
    c = par; par = D.parentOf(app.doc, c.id);
  }
  return -1;
};
app.setTool = t => { app.tool = t; app.arm = null; app.pick = null; app.preview = null; app.ovDirty = true; app.emit('tool'); };
// Fit the SLICE view to the scene cut by the slice plane, and put the probe
// at its left edge aimed across it.
app.fitSlice = (aspect = 1.6) => {
  const S = app.slice, A = SLICE_AX[S.axis], b = D.docBounds(app.doc);
  if (!b) return;
  const c = V.scale(V.add(b.lo, b.hi), 0.5), half = V.scale(V.sub(b.hi, b.lo), 0.5);
  const ext = (ax) => Math.abs(ax[0]) * half[0] + Math.abs(ax[1]) * half[1] + Math.abs(ax[2]) * half[2];
  S.cu = +V.dot(c, A.u).toFixed(3); S.cv = +V.dot(c, A.v).toFixed(3);
  S.off = +V.dot(c, A.n).toFixed(3);
  S.ext = Math.max(1, Math.max(ext(A.v), ext(A.u) / aspect) * 1.35);
  S.ray.o = [+(S.cu - S.ext * aspect * 0.85).toFixed(3), +(S.cv + S.ext * 0.12).toFixed(3)];
  S.ray.a = -0.06;
  app.dirtyAll();
};
app.toast = (msg, ms = 1600) => {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(app.toastT); app.toastT = setTimeout(() => t.classList.remove('on'), ms);
};

// ── panes ───────────────────────────────────────────────────────────────────
const paneDom = [], paneState = [], paneU = [];
function buildPanes() {
  const vp = $('viewport');
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('section');
    el.className = 'pane'; el.dataset.slot = i; el.hidden = true;
    el.innerHTML = '<canvas class="gl"></canvas><canvas class="ov"></canvas><div class="plabel"><button type="button" class="v"></button><button type="button" class="m"></button></div>';
    vp.appendChild(el);
    paneDom.push({ el, gl: el.querySelector('.gl'), ov: el.querySelector('.ov'), v: el.querySelector('.v'), m: el.querySelector('.m') });
    paneState.push({ dirty: true, scale: 0, last: 0, gpu: null });
    paneU.push(new Float32Array(UNIFORM_FLOATS));
  }
  const cube = document.createElement('div');
  cube.className = 'pcube';
  cube.innerHTML = '<button type="button" data-proj="persp" title="Perspective">&#9701;</button><button type="button" data-proj="ortho" title="Orthographic">&#9633;</button>';
  app.cubeBtns = cube;
}
app.paneDom = paneDom;
const barH = () => (app.phone ? 0 : 52);
app.cubeBox = r => {
  const size = app.phone ? 92 : 112;
  const top = r.y < barH() ? barH() - r.y : 0;
  return { x: r.w - size - 16, y: top + 8, size };
};
app.projOf = r => { const s = app.panes.slots[r.slot]; return projection(s.cam, r.w, r.h, s.ortho); };
app.rectOf = slot => app.rects.find(r => r.slot === slot);

function layoutPanes() {
  const vp = $('viewport'), W = vp.clientWidth, H = vp.clientHeight;
  const R = PN.rects(app.panes, W, H, app.phone);
  const key = JSON.stringify(R) + app.panes.active;
  app.rects = R;
  if (key === app.layoutKey) return;
  app.layoutKey = key;
  const vis = new Set(R.map(r => r.slot));
  paneDom.forEach((p, i) => {
    p.el.hidden = !vis.has(i);
    p.el.classList.toggle('active', i === app.panes.active && R.length > 1);
    paneState[i].dirty = true;
  });
  for (const r of R) {
    Object.assign(paneDom[r.slot].el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    // a pane on the bottom edge lifts its label clear of the status strip
    paneDom[r.slot].el.style.setProperty('--lift', r.y + r.h >= H - 1 ? (app.phone ? '58px' : '50px') : '0px');
  }
  const act = paneDom[app.panes.active];
  if (act && app.cubeBtns.parentNode !== act.el) act.el.appendChild(app.cubeBtns);
  const ar = app.rectOf(app.panes.active);
  if (ar) {
    const b = app.cubeBox(ar);
    Object.assign(app.cubeBtns.style, { top: (b.y + b.size + 4) + 'px', right: (ar.w - b.x - b.size + Math.round(b.size / 2) - 26) + 'px' });
  }
  app.ovDirty = true;
  app.emit('panes');
}

// ── uniforms ────────────────────────────────────────────────────────────────
function packPane(r, cw, ch, scale, now) {
  const s = app.panes.slots[r.slot], P = app.projOf(r), u = paneU[r.slot];
  u.set([cw, ch, scale, now / 1000], 0);
  u.set([...P.eye, s.ortho ? P.H : 0], 4);
  u.set([...P.right, P.tan], 8);
  u.set([...P.up, MODE_INDEX[s.mode] ?? 0], 12);
  u.set([...P.fwd, app.quality.maxSteps], 16);
  u.set([PN.planeOf(s), app.disp.grid ? 1 : 0, app.disp.axes ? 1 : 0, 0], 20);
  u.set([...PN.gates(s), app.disp.shadows ? 1 : 0], 24);
  const L = app.gpuL, p = app.primary();
  const rg = p && L && L.range[p.id] ? L.range[p.id] : [-9, -9];
  const hv = app.hoverId && L && L.ord[app.hoverId] !== undefined ? L.ord[app.hoverId] : -9;
  u.set([rg[0], rg[1], hv, app.disp.ghost ? app.ghostOrd() : -1], 28);
  const tmax = (s.ortho ? ORTHO_BACK : 0) + s.cam.dist * 3 + 80;
  u.set([app.stepK || 1, tmax, app.disp.ghost ? 1 : 0, app.sceneRho || 1], 32);
  const S = app.slice, A = SLICE_AX[S.axis];
  u.set([...A.n, S.off], 36); u.set([...A.u, S.cu], 40); u.set([...A.v, S.cv], 44); u.set([S.ext, 0, 0, 0], 48);
  u.set(app.sceneSphere || [0, 0, 0, -1], 52);
  return u;
}

// ── the frame loop ──────────────────────────────────────────────────────────
let raf = 0, waiting = false;
function frame(now) {
  raf = requestAnimationFrame(frame);
  if (document.hidden || !app.R) return;
  layoutPanes();
  const interacting = now - app.lastInput < 220;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hot = app.hotSlot ?? app.panes.active;
  const jobs = [];
  for (const r of app.rects) {
    const st = paneState[r.slot];
    if (!st.gpu) st.gpu = app.R.addPane(paneDom[r.slot].gl);
    const isHot = r.slot === hot || app.rects.length === 1;
    const target = !interacting ? 1 : isHot ? app.hotScale : app.quality.inactive;
    if (!st.dirty && st.scale >= target - 1e-3 && !(!interacting && st.scale < 1)) continue;
    if (!isHot && interacting && now - st.last < 100) continue;
    const cw = Math.max(1, Math.round(r.w * dpr * target)), ch = Math.max(1, Math.round(r.h * dpr * target));
    const cv = paneDom[r.slot].gl;
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    jobs.push({ pane: st.gpu, u: packPane(r, cw, ch, target, now), kind: app.panes.slots[r.slot].mode === 'slice' ? 'slice' : 'view' });
    st.dirty = false; st.scale = target; st.last = now;
  }
  if (jobs.length && app.R.drawPanes(jobs)) {
    app.stats.frames++; app.stats.draws += jobs.length;
    if (!waiting) {
      waiting = true;
      const t0 = performance.now();
      app.R.done().then(() => {
        waiting = false;
        const ms = performance.now() - t0;
        app.stats.gpuMs = app.stats.gpuMs * 0.8 + ms * 0.2;
        if (performance.now() - app.lastInput < 220) {
          if (ms > 22) app.hotScale = Math.max(0.45, app.hotScale * 0.86);
          else if (ms < 11) app.hotScale = Math.min(1, app.hotScale * 1.08);
        }
      });
    }
  }
  drawOverlays();
}

// ── overlays ────────────────────────────────────────────────────────────────
app.gizmoFor = r => {
  const p = app.primary(), s = app.panes.slots[r.slot];
  if (!p || app.tool === 'select' || app.arm || s.mode === 'slice' || p.hidden) return null;
  const W = D.worldMatrix(app.doc, p.id), c = [W[12], W[13], W[14]];
  let axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (app.coord === 'local' || app.tool === 'scale') axes = [0, 1, 2].map(i => V.norm([W[i * 4], W[i * 4 + 1], W[i * 4 + 2]]));
  return GZ.build(app.projOf(r), c, axes, app.tool, app.coarse ? 1.35 : 1);
};
app.cubeLayout = r => VC.layout(app.cubeBox(r), projection(app.panes.slots[r.slot].cam, r.w, r.h, false));

function drawOverlays() {
  if (!app.ovDirty) return;
  app.ovDirty = false;
  const anySlice = app.rects.some(r => app.panes.slots[r.slot].mode === 'slice');
  const tr = anySlice ? probeTrace() : null;
  for (const r of app.rects) {
    const pd = paneDom[r.slot], s = app.panes.slots[r.slot];
    pd.v.textContent = s.mode === 'slice' ? 'SLICE ' + SLICE_AX[app.slice.axis].label : PN.VIEW_LABEL[s.view] || 'ORBIT';
    pd.m.textContent = PN.MODE_LABEL[s.mode];
    const g = OV.ctxFor(pd.ov, r.w, r.h);
    if (s.mode === 'slice') {
      app.sliceGeo = OV.drawSliceDiagram(g, r.w, r.h, app.slice, tr.tr, tr.touch, app.coarse);
      app.sliceGeo.slot = r.slot;
      drawSliceKey(g, r);
      continue;
    }
    const P = app.projOf(r);
    // bounds: thin boxes for every root when asked, brackets on the selection
    if (app.disp.bounds === 'all') for (const id of app.doc.roots) {
      const b = D.localBounds(app.doc, id);
      if (b && !app.sel.includes(id)) OV.drawBox(g, P, OV.boxCorners(b, D.worldMatrix(app.doc, id)), { color: 'rgba(156,195,255,0.35)' });
    }
    if (app.disp.bounds !== 'off') for (const id of app.sel) {
      const n = app.doc.nodes[id], b = n && D.localBounds(app.doc, id);
      if (b && !b.infinite) OV.drawBox(g, P, OV.boxCorners(b, D.worldMatrix(app.doc, id)), { color: id === app.sel[app.sel.length - 1] ? '#ffffff' : 'rgba(255,255,255,0.6)', brackets: true, width: 1.3 });
      else if (b) OV.drawBox(g, P, OV.boxCorners(b, D.worldMatrix(app.doc, id)), { color: 'rgba(255,255,255,0.7)', width: 1 });
    }
    if (app.preview) drawPreview(g, P, app.preview);
    if (anySlice && tr) OV.drawProbe3D(g, P, { ...SLICE_AX[app.slice.axis], ...app.slice }, tr.tr3);
    const G = app.gizmoFor(r);
    if (G) OV.drawGizmo(g, G, app.gizHover && app.gizHover.slot === r.slot ? app.gizHover.id : null, app.gizActive && app.gizActive.slot === r.slot ? app.gizActive.id : null);
    if (app.readout && app.readout.at) {
      const q = P.project(app.readout.at);
      if (q && (app.readout.slot == null || app.readout.slot === r.slot || app.rects.length === 1)) OV.drawReadout(g, q[0] + 16, q[1] - 12, app.readout.lines, r.w, r.h);
    }
    if (r.slot === app.panes.active && app.disp.cube) OV.drawCube(g, app.cubeLayout(r), app.cubeHover);
  }
}
function drawPreview(g, P, pv) {
  g.strokeStyle = OV.BLUE; g.lineWidth = 1.1;
  for (const line of pv.lines || []) {
    const q = line.map(p => P.project(p));
    if (q.some(v => !v)) continue;
    g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
  }
}
function drawSliceKey(g, r) {
  const A = SLICE_AX[app.slice.axis], nm = v => (v[0] ? 'x' : v[1] ? 'y' : 'z');
  const sgn = v => (v[0] + v[1] + v[2] < 0 ? '-' : '');
  g.font = '11px ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(200,205,230,0.75)'; g.textAlign = 'right';
  const tr = app.probe;
  const k = `SLICE ${A.label} ${nm(A.n)} = ${app.slice.off.toFixed(2)}   right ${sgn(A.u)}${nm(A.u)}  up ${sgn(A.v)}${nm(A.v)}`;
  const y0 = r.y < barH() ? barH() - r.y + 22 : 22;
  g.fillText(k, r.w - 14, y0);
  if (tr) g.fillText(`${tr.tr.n} steps  ${tr.tr.hit ? 'hit' : 'miss'}  ${tr.fails} relax fails`, r.w - 14, y0 + 16);
  g.textAlign = 'left';
}

// The probe in plane coordinates and in world space, and the touch points:
// where the nearest surface point of a step lies in the plane.
function probeTrace() {
  const S = app.slice, A = SLICE_AX[S.axis], F = app.F;
  const on = (a, b) => V.add(V.scale(A.n, S.off), V.add(V.scale(A.u, a), V.scale(A.v, b)));
  const o = on(S.ray.o[0], S.ray.o[1]);
  const r = V.add(V.scale(A.u, Math.cos(S.ray.a)), V.scale(A.v, Math.sin(S.ray.a)));
  const tr = traceProbe(F, o, r, { relax: S.relax, omega: S.omega, stepScale: S.stepScale, maxSteps: S.maxSteps, tmax: 60 });
  const touch = [];
  tr.steps.forEach((st, i) => {
    if (i > 90 || st.fail || st.d <= 2e-3) return;
    const p = V.add(o, V.scale(r, st.t));
    const gr = grad(F, p[0], p[1], p[2]), gl = Math.hypot(...gr) || 1;
    const N = p.map((v, j) => v - st.d * gr[j] / gl);
    const rel = V.sub(N, V.scale(A.n, S.off));
    if (Math.abs(V.dot(rel, A.n)) > 0.03) return;
    touch.push({ from: [S.ray.o[0] + Math.cos(S.ray.a) * st.t, S.ray.o[1] + Math.sin(S.ray.a) * st.t], to: [V.dot(rel, A.u), V.dot(rel, A.v)] });
  });
  const out = { tr, touch, tr3: { ...tr, o, r }, fails: tr.steps.filter(s => s.fail).length };
  app.probe = out;
  return out;
}
app.probeTrace = probeTrace;

// ── boot ────────────────────────────────────────────────────────────────────
function applyPhone() {
  app.phone = PHONE_Q.matches;
  document.body.classList.toggle('phone', app.phone);
  app.coarse = COARSE_Q.matches;
  app.layoutKey = null;
  app.emit('phone');
}
async function boot() {
  buildPanes();
  applyPhone();
  PHONE_Q.addEventListener('change', applyPhone);
  const saved = FL.loadAutosave();
  app.doc = saved || EXAMPLES.primitives.build();
  app.F = compileField(app.doc);
  initUI(app);
  initInput(app);
  app.frameAll();
  try {
    app.R = await createRenderer(info => { app.toast('GPU device lost: ' + info.message, 6000); });
  } catch (e) {
    $('nogpu').hidden = false;
    console.warn('WebGPU unavailable', e);
    app.emit('doc');
    return;
  }
  try {
    await app.R.setStructure(app.doc, app.F.L);
    app.gpuL = app.F.L;
    app.stats.compileMs = app.R.pipe.ms; app.stats.lines = app.R.pipe.lines;
  } catch (e) { console.error(e); app.toast('Shader error: ' + e.message.slice(0, 200), 8000); }
  writeGPU();
  app.dirtyAll();
  app.emit('doc'); app.emit('compiled');
  raf = requestAnimationFrame(frame);
  app.ready = true;
}
addEventListener('pagehide', () => {
  cancelAnimationFrame(raf); raf = 0;
  FL.flushAutosave(app);
  if (app.R) app.R.destroy();
  app.R = null;
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) app.dirtyAll(); });
boot();

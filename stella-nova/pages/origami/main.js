// main.js -- the app: two panes, one crease pattern, one live fold.
//
// Port of origami src/app.rs and src/main.rs. The DIAGRAM pane is the editor.
// The FOLDED pane is the same pattern folded by the simulator, one sim step per
// frame. The panes sit side by side when the stage is wider than tall, and
// stack when it is taller, as app.rs layout does. The topbar toggle (AUTO,
// HORIZONTAL, VERTICAL) can force either; sessionStorage keeps the choice for
// this tab session only, so a forced layout does not stay after the visit.
//
// One structure drives everything. `S.pattern` is what the person edits. Any
// edit rebuilds `S.planar` (planarize) and `S.mesh` (sim.build), so the folded
// pane always shows the current pattern. The fold fraction drives how far it
// folds.
//
// The native forge quad GUI (gui.rs, font.rs) is replaced by DOM controls.
// Every control carries data-act; `apply` is the one dispatcher, as app.rs
// apply is. Copies of one control (bar, sheet, dock) stay in step via syncUI.
//
// Web additions, not in the native app: 2D pan and zoom, a 3D pan offset,
// crease hover, the foldability marks, FOLD import and export, a snap preview,
// tool and transport keys, touch gestures, and the layout toggle.
//
// grep map:
//   S              -- all state: pattern, planar, mesh, fold, views, flags
//   rebuild        -- pattern -> planarized -> fold mesh -> foldability report
//   frame          -- step the sim, draw both panes, update the readouts
//   draw2d / draw3d -- the two panes' fills and lines   [app.rs draw_2d, draw_3d]
//   updateHover    -- face, crease, vertex under the pointer
//   onDown / onMove / onUp / onWheel -- pointer input, mouse and touch
//   apply          -- every control action             [app.rs apply]
//   onKey          -- every keyboard shortcut          [main.rs window_event]
//   savePng / exportFold / importFold -- the file actions
//   window.__origami -- the test hook the headless check drives

import { Assignment, CreasePattern } from './model.js';
import { reportOk } from './foldability.js';
import { toJson, fromJson } from './foldio.js';
import * as patterns from './patterns.js';
import { Orbit, snap } from './view.js';
import { initGpu } from './gpu.js';
import { pointInPoly, pointInTri2, pointSegDist, findIndex } from './app/geom.js';
import { stage, canvas, pane2dEl, pane3dEl, dpr, applyLayout, measure, geom2d, geom3d, view2d, region3d, phys, paneAt, snapPx, resize } from './app/layout.js';
import { buildLibrary, toggleLibSource } from './app/libpanel.js';
import { defaultStatus, setStatus, syncFold, syncUI } from './app/readouts.js';
import { rebuild, pushUndo, undo, redo, loadPreset, eraseNear, eraseTarget, planarEdgesOf, creaseOfPlanar } from './app/edit.js';
import { render } from './app/draw.js';
import { COARSE, $, TOOLS, TOOL_KEYS, SPEEDS, S, gpu, setGpu, load, save, isPhone } from './app/state.js';

let last = performance.now();

// ── hover (app.rs update_hover, plus creases and vertices) ──────────────────
function updateHover() {
  S.hoveredFace = null; S.hoveredCrease = null; S.hoveredEdges = null; S.hoveredVertex = null;
  if (!S.cursor || S.libraryOpen || !geom2d) return;
  const pane = paneAt(S.cursor);
  const p = phys(S.cursor);
  if (pane === '2d') {
    const v = view2d();
    const world = v.toWorld(p);
    S.hoveredFace = findIndex(S.planar.faces, (face) => pointInPoly(world, face.map((i) => S.planar.vertices[i])));
    if (S.tool === 'erase') {
      S.hoveredCrease = eraseTarget(snap(world, S.pattern, S.gridN, v, snapPx()));
    } else {
      let best = null, bestD = (COARSE ? 12 : 6) * dpr / v.scale;
      for (let i = 0; i < S.pattern.edges.length; i++) {
        const [a, b] = S.pattern.segment(i);
        const d = pointSegDist(world, a, b);
        if (d < bestD) { bestD = d; best = i; }
      }
      S.hoveredCrease = best;
    }
    let bv = null, bd = 10 * dpr / v.scale;
    for (const r of S.report) {
      const d = Math.hypot(S.planar.vertices[r.vertex][0] - world[0], S.planar.vertices[r.vertex][1] - world[1]);
      if (d < bd) { bd = d; bv = r; }
    }
    S.hoveredVertex = bv;
    if (S.hoveredCrease !== null) S.hoveredEdges = planarEdgesOf(S.hoveredCrease);
  } else if (pane === '3d') {
    const r = region3d();
    const m = S.orbit.matrix((r[2] - r[0]) / Math.max(r[3] - r[1], 1));
    const eye = S.orbit.eye();
    const N = S.mesh.nodes;
    const pr = (i) => S.orbit.project(N[3 * i], N[3 * i + 1], N[3 * i + 2], m, r);
    let bestDepth = Infinity, hit = null;
    S.mesh.tris.forEach((t, ti) => {
      const q = t.v.map(pr);
      if (q.some((x) => !x)) return;
      if (pointInTri2(p, q[0], q[1], q[2])) {
        const g = [0, 1, 2].map((k) => (N[3 * t.v[0] + k] + N[3 * t.v[1] + k] + N[3 * t.v[2] + k]) / 3);
        const depth = Math.hypot(eye[0] - g[0], eye[1] - g[1], eye[2] - g[2]);
        if (depth < bestDepth) { bestDepth = depth; hit = S.mesh.faceOf[ti] ?? null; }
      }
    });
    S.hoveredFace = hit;
    // The nearest projected crease edge within a few pixels (web addition).
    let be = null, bd = (COARSE ? 12 : 6) * dpr;
    S.planar.edges.forEach((e, i) => {
      if (S.planar.assignment[i] === Assignment.Border && S.tool === 'erase') return;
      const a = pr(e[0]), b = pr(e[1]);
      if (!a || !b) return;
      const d = pointSegDist(p, a, b);
      if (d < bd) { bd = d; be = i; }
    });
    if (be !== null) {
      S.hoveredCrease = creaseOfPlanar(be);
      S.hoveredEdges = S.hoveredCrease !== null ? planarEdgesOf(S.hoveredCrease) : [be];
    }
  }
  statusHover();
}

const KIND_NAME = { M: 'mountain', V: 'valley', B: 'border', F: 'aux', U: 'unassigned' };
function statusHover() {
  const parts = [];
  if (S.hoveredVertex) {
    const r = S.hoveredVertex;
    const mk = (ok) => (ok ? '✓' : '✕');
    parts.push(`vertex ${r.vertex} · degree ${r.degree} · Kawasaki ${r.kawasakiResidual.toFixed(2)}° ${mk(r.kawasakiOk)}` +
      ` · Maekawa ${r.maekawa === null ? 'undecided' : (r.maekawa > 0 ? '+' : '') + r.maekawa + ' ' + mk(r.maekawaOk)}` +
      ` · BLB ${r.blbOk === null ? 'undecided' : mk(r.blbOk)}`);
  }
  if (S.hoveredCrease !== null) {
    const k = S.pattern.assignment[S.hoveredCrease];
    parts.push(`crease ${S.hoveredCrease} · ${KIND_NAME[k]}${S.tool === 'erase' && k !== Assignment.Border ? ' · click to erase' : ''}`);
  }
  if (S.hoveredFace !== null) parts.push(`face ${S.hoveredFace}`);
  setStatus(parts.length ? parts.join('   ') : defaultStatus());
}
// ── frame (app.rs frame) ────────────────────────────────────────────────────
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Drive the fold. Auto mode sweeps it; otherwise it holds.
  if (!S.frozen) {
    if (S.auto) {
      S.fraction += S.autoDir * dt * S.foldSpeed;
      if (S.fraction >= 0.95) { S.fraction = 0.95; S.autoDir = -1; }
      else if (S.fraction <= 0) {
        S.fraction = 0; S.autoDir = 1;
        // A clean flat sheet at the bottom of the sweep drops any knot.
        S.mesh.resetFlat();
      }
    }
    S.mesh.setFraction(S.fraction);
    S.mesh.step();
    S.mesh.recenter();
  }
  render();
  syncFold();
  requestAnimationFrame(frame);
}

// ── the control dispatcher (app.rs apply) ───────────────────────────────────
function apply(act, el) {
  const [verb, arg] = act.split(':');
  switch (verb) {
    case 'tool': S.tool = arg; break;
    case 'grid': S.showGrid = !S.showGrid; break;
    case 'library': S.libraryOpen = !S.libraryOpen; if (S.libraryOpen && isPhone()) S.panelOpen = false; break;
    case 'library-close': S.libraryOpen = false; break;
    case 'preset': { const p = patterns.byId(arg); if (p) loadPreset(p); if (isPhone()) S.panelOpen = false; break; }
    case 'libsrc': toggleLibSource(arg); return;
    case 'play': S.auto = !S.auto; break;
    case 'flat': S.auto = false; S.fraction = 0; S.mesh.resetFlat(); break;
    case 'speed': {
      const i = SPEEDS.findIndex((s) => Math.abs(s - S.foldSpeed) < 1e-3);
      S.foldSpeed = SPEEDS[((i < 0 ? 1 : i) + 1) % SPEEDS.length];
      S.auto = true;
      break;
    }
    case 'fraction': S.auto = false; S.fraction = Math.min(Math.max(Number(el.value), 0), 1); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'layout': S.layoutMode = arg; try { sessionStorage.setItem('origami.layout', arg); } catch { /* storage blocked */ } applyLayout(); break;
    case 'panel': S.panelOpen = !S.panelOpen; break;
    case 'fit': resetView('2d'); resetView('3d'); break;
    case 'png': savePng(); break;
    case 'fold-export': exportFold(); break;
    case 'fold-import': $('foldFile').click(); break;
    default: return;
  }
  syncUI();
}

function resetView(pane) {
  if (pane === '2d') { S.zoom2d = 1; S.pan2d = [0, 0]; }
  else { S.orbit = new Orbit(); S.pan3d = [0, 0]; }
}


// ── interface zoom (main.rs: Command plus, minus, zero) ─────────────────────
function uiZoom(f) {
  S.ui = f === 0 ? 1 : Math.min(Math.max(S.ui * f, 0.7), 2.0);
  document.documentElement.style.fontSize = (16 * S.ui).toFixed(2) + 'px';
  save('origami.ui', S.ui);
  requestAnimationFrame(applyLayout);
}

// ── keyboard (main.rs window_event, plus web keys) ──────────────────────────
function onKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (mod) {
    if (k === '+' || k === '=') { e.preventDefault(); uiZoom(1.12); }
    else if (k === '-' || k === '_') { e.preventDefault(); uiZoom(1 / 1.12); }
    else if (k === '0') { e.preventDefault(); uiZoom(0); }
    else if (k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); redo(); }
    return;
  }
  if (e.altKey) return;
  const lk = k.toLowerCase();
  if (lk === 's') { e.preventDefault(); savePng(); return; }
  if (TOOL_KEYS[lk]) { apply('tool:' + TOOL_KEYS[lk]); return; }
  if (k === ' ') { e.preventDefault(); apply('play'); return; }
  if (lk === 'f') { apply('flat'); return; }
  if (lk === 'g') { apply('grid'); return; }
  if (lk === 'l') { apply('library'); return; }
  if (k === 'Escape') { S.libraryOpen = false; S.panelOpen = false; syncUI(); }
}

// ── pointer input (app.rs on_press, on_release, on_move, on_scroll) ─────────
const ptrs = new Map();   // pointerId -> { x, y }
let gesture = null;       // { kind: 'draw'|'orbit'|'pan'|'pinch', pane, ... }
let spaceDown = false;

function cssPoint(e) {
  const c = canvas.getBoundingClientRect();
  return [e.clientX - c.left, e.clientY - c.top];
}

function onDown(e) {
  if (!gpu) return;
  // The library has no scrim. A press on the canvas closes it and does no more.
  if (S.libraryOpen) { S.libraryOpen = false; syncUI(); return; }
  const p = cssPoint(e);
  const pane = paneAt(p);
  if (!pane) return;
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, p);
  S.cursor = p;
  if (ptrs.size === 2) {
    // A second finger: drop the one-finger action and start a pinch.
    const [a, b] = [...ptrs.values()];
    gesture = { kind: 'pinch', pane: gesture ? gesture.pane : pane, d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom0: S.zoom2d, dist0: S.orbit.dist };
    S.drawing = null;
    return;
  }
  if (ptrs.size > 2) return;
  const panBtn = e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown);
  if (panBtn) { gesture = { kind: 'pan', pane, last: p }; return; }
  if (e.button !== 0) return;
  if (pane === '2d') {
    const v = view2d();
    S.drawing = snap(v.toWorld(phys(p)), S.pattern, S.gridN, v, snapPx());
    gesture = { kind: 'draw', pane };
  } else {
    gesture = { kind: 'orbit', pane, last: p };
  }
}

function onMove(e) {
  const p = cssPoint(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
  S.cursor = p;
  if (gesture && gesture.kind === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = d / gesture.d0;
    if (gesture.pane === '2d') zoom2dAbout(gesture.mid, (gesture.zoom0 * s) / S.zoom2d);
    else S.orbit.dist = Math.min(Math.max(gesture.dist0 / s, 0.7), 9.0);
    panBy(gesture.pane, mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
    gesture.mid = mid;
    gesture.zoom0 = S.zoom2d / 1; gesture.d0 = d; gesture.dist0 = S.orbit.dist;
  } else if (gesture && gesture.kind === 'orbit') {
    // The native deltas are physical pixels at 2x; scale CSS px to match.
    const dx = (p[0] - gesture.last[0]) * 2, dy = (p[1] - gesture.last[1]) * 2;
    S.orbit.yaw += dx * 0.01;
    S.orbit.pitch = Math.min(Math.max(S.orbit.pitch + dy * 0.01, -1.45), 1.45);
    gesture.last = p;
  } else if (gesture && gesture.kind === 'pan') {
    panBy(gesture.pane, p[0] - gesture.last[0], p[1] - gesture.last[1]);
    gesture.last = p;
  }
  updateHover();
}

function onUp(e) {
  const p = cssPoint(e);
  const had = ptrs.delete(e.pointerId);
  if (!had) return;
  if (gesture && gesture.kind === 'pinch') {
    if (ptrs.size === 0) gesture = null;
    return;
  }
  if (gesture && gesture.kind === 'draw' && S.drawing && e.type === 'pointerup' && paneAt(p) === '2d') {
    const v = view2d();
    const end = snap(v.toWorld(phys(p)), S.pattern, S.gridN, v, snapPx());
    if (S.tool === 'erase') eraseNear(end);
    else if (Math.hypot(S.drawing[0] - end[0], S.drawing[1] - end[1]) > 1e-3) {
      pushUndo();
      S.pattern.addCrease(S.drawing, end, TOOLS[S.tool].kind);
      rebuild();
    }
    syncUI();
  }
  S.drawing = null;
  gesture = null;
  if (e.pointerType !== 'mouse') S.cursor = null;
  updateHover();
}

function panBy(pane, dx, dy) {
  if (pane === '2d') { S.pan2d[0] += dx; S.pan2d[1] += dy; }
  else { S.pan3d[0] += dx; S.pan3d[1] += dy; }
}

// Zoom the diagram by factor f about a CSS point, keeping that point fixed.
function zoom2dAbout(cssP, f) {
  const z = Math.min(Math.max(S.zoom2d * f, 0.4), 12);
  const v0 = view2d();
  const w = v0.toWorld(phys(cssP));
  S.zoom2d = z;
  const v1 = view2d();
  const q = v1.toPx(w);
  S.pan2d[0] += (cssP[0] * dpr - q[0]) / dpr;
  S.pan2d[1] += (cssP[1] * dpr - q[1]) / dpr;
}

function onWheel(e) {
  const p = cssPoint(e);
  const pane = paneAt(p);
  if (!pane) return;
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const f = Math.exp(-dy * 0.0015);
  if (pane === '2d') zoom2dAbout(p, f);
  else S.orbit.dist = Math.min(Math.max(S.orbit.dist / f, 0.7), 9.0);
  updateHover();
}

// ── files ───────────────────────────────────────────────────────────────────
function stamp() { return Math.floor(Date.now() / 1000); }

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Save the current view as a PNG (main.rs: S). The GPU canvas is copied into a
// 2D canvas in the same task as its frame, and the pane frames and labels are
// drawn over it, so the file shows what the native capture shows.
function savePng() {
  if (!gpu) return;
  render();
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0);
  const c = canvas.getBoundingClientRect();
  g.font = `600 ${11 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
  g.textBaseline = 'top';
  const pct = Math.round(S.fraction * 100);
  for (const [el, label] of [[pane2dEl, 'DIAGRAM  crease pattern'], [pane3dEl, `FOLDED  ${pct}%`]]) {
    const r = el.getBoundingClientRect();
    const x = (r.left - c.left) * dpr, y = (r.top - c.top) * dpr, w = r.width * dpr, h = r.height * dpr;
    g.strokeStyle = '#2a3040'; g.lineWidth = dpr;
    g.beginPath(); g.roundRect(x + 0.5 * dpr, y + 0.5 * dpr, w - dpr, h - dpr, 14 * dpr); g.stroke();
    g.fillStyle = 'rgba(18,21,29,0.85)';
    const tw = g.measureText(label).width;
    g.beginPath(); g.roundRect(x + 10 * dpr, y + 9 * dpr, tw + 20 * dpr, 24 * dpr, 7 * dpr); g.fill();
    g.fillStyle = '#ece4d4'; g.fillText(label, x + 20 * dpr, y + 15 * dpr);
  }
  out.toBlob((b) => { if (b) { download(b, `origami-${stamp()}.png`); fileMsg(`Saved origami-${stamp()}.png`); } }, 'image/png');
}

function exportFold() {
  const name = `origami-${stamp()}.fold`;
  download(new Blob([toJson(S.pattern)], { type: 'application/json' }), name);
  fileMsg(`Exported ${name}: ${S.pattern.vertices.length} vertices, ${S.pattern.edges.length} creases.`);
}

// Read a FOLD file. A pattern already inside the centred unit square stays as
// it is (a file this page wrote). Anything else is fit like a preset.
async function importFold(file) {
  try {
    const text = await file.text();
    let cp = fromJson(text);
    if (!cp.vertices.length || !cp.edges.length) throw new Error('the file has no crease pattern');
    const [lo, hi] = cp.bounds();
    const inside = lo[0] >= -0.5001 && lo[1] >= -0.5001 && hi[0] <= 0.5001 && hi[1] <= 0.5001;
    if (!inside) cp = patterns.fromFoldText(text);
    pushUndo();
    S.pattern = cp; S.preset = null;
    S.fraction = 0; S.auto = false;
    rebuild(); syncUI();
    fileMsg(`Loaded ${file.name}: ${cp.vertices.length} vertices, ${cp.edges.length} creases.`);
  } catch (err) {
    fileMsg(`Could not read ${file.name}: ${err.message}`);
  }
}
function fileMsg(t) { $('fileMsg').textContent = t; setStatus(t); }

// ── the phone sheet grip (as in wave-membrane) ──────────────────────────────
function wireSheet() {
  const grip = $('sheetGrip'), panel = $('panel');
  let y0 = null, moved = false;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = false; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => { if (y0 !== null && Math.abs(e.clientY - y0) > 8) moved = true; });
  grip.addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null;
    if (!moved) panel.classList.toggle('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else { S.panelOpen = false; syncUI(); } }
    else if (dy < -40) panel.classList.add('full');
  });
}

// ── wiring ──────────────────────────────────────────────────────────────────
function wire() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    apply(el.dataset.act, el);
  });
  document.querySelectorAll('input[data-act="fraction"]').forEach((el) => {
    el.addEventListener('input', () => { S.dragFraction = true; apply('fraction', el); });
    el.addEventListener('change', () => { S.dragFraction = false; });
    el.addEventListener('pointerup', () => { S.dragFraction = false; });
  });
  $('foldFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importFold(f);
    e.target.value = '';
  });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (!ptrs.size && e.pointerType === 'mouse') { S.cursor = null; updateHover(); } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', (e) => { const pane = paneAt(cssPoint(e)); if (pane) resetView(pane); });
  window.addEventListener('keydown', (e) => { if (e.key === ' ' && !(e.target && e.target.tagName === 'BUTTON')) spaceDown = true; onKey(e); });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  window.addEventListener('resize', () => { applyLayout(); resize(); });
  new ResizeObserver(() => { applyLayout(); resize(); }).observe(stage);
  wireSheet();
}

// ── the test hook (the headless check drives the page through this) ─────────
window.__origami = {
  presets: () => patterns.ALL.map((p) => p.id),
  // Returns a promise: a file preset is fetched on first use.
  loadPreset: (id) => loadPreset(patterns.byId(id)),
  // Fold to `fraction` and run `steps` sim steps now, then hold.
  foldTo: (fraction, steps) => {
    S.auto = false; S.fraction = fraction; S.mesh.setFraction(fraction);
    for (let i = 0; i < steps; i++) S.mesh.step();
    S.mesh.recenter(); syncUI();
  },
  freeze: (on) => { S.frozen = !!on; },
  // Replace the live node positions (a native dump), then recenter.
  setNodes: (nodes) => {
    nodes.forEach((n, i) => { S.mesh.nodes[3 * i] = n[0]; S.mesh.nodes[3 * i + 1] = n[1]; S.mesh.nodes[3 * i + 2] = n[2]; });
    S.mesh.recenter();
  },
  nodes: () => Array.from({ length: S.mesh.nodeCount }, (_, i) => S.mesh.node(i)),
  state: () => ({
    preset: S.preset && S.preset.id, tool: S.tool, fraction: S.fraction, auto: S.auto,
    creases: S.pattern.edges.length, vertices: S.pattern.vertices.length, faces: S.planar.faces.length,
    undo: S.undo.length, redo: S.redo.length, layout: stage.className, gpu: !!gpu,
    srgbView: gpu ? !gpu.encode : null, report: S.report.length, bad: S.report.filter((r) => !reportOk(r)).length,
    hoveredFace: S.hoveredFace, hoveredCrease: S.hoveredCrease,
    finite: S.mesh.nodes.every(Number.isFinite),
  }),
  pane: (name) => { measure(); const g = name === '2d' ? geom2d : geom3d; return { rect: g.rect.map((x) => x / dpr), fit: g.fit.map((x) => x / dpr) }; },
  // World point of the diagram to a CSS point relative to the canvas.
  worldToCss: (x, y) => { measure(); const p = view2d().toPx([x, y]); return [p[0] / dpr, p[1] / dpr]; },
  apply: (act) => apply(act),
};

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  // The layout choice lives for one tab session. An old localStorage value
  // (kept before this change) forced a stacked layout on wide screens, so it
  // is deleted. A new visit starts in AUTO.
  try { localStorage.removeItem('origami.layout'); } catch { /* storage blocked */ }
  let lay = null; try { lay = sessionStorage.getItem('origami.layout'); } catch { /* storage blocked */ }
  S.layoutMode = ['auto', 'h', 'v'].includes(lay) ? lay : 'auto';
  const ui = Number(load('origami.ui', 1));
  if (Number.isFinite(ui) && ui !== 1) uiZoom(ui);
  buildLibrary();
  wire();
  applyLayout();
  setStatus(defaultStatus());

  const base = new URL('.', import.meta.url);
  const text = (p) => fetch(new URL(p, base)).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.text(); });
  patterns.setReader((n) => text('patterns/' + n));
  await patterns.prepare(S.preset);
  S.pattern = patterns.build(S.preset);
  rebuild();
  syncUI();

  const shaders = { tris: await text('shaders/tris.wgsl'), lines: await text('shaders/lines.wgsl') };
  const res = await initGpu(canvas, shaders);
  if (res.error) {
    $('nogpu').hidden = false;
    $('nogpuMsg').textContent = res.error + ' The crease pattern editor and the simulator need it to draw.';
    return;
  }
  setGpu(res.gpu);
  gpu.device.lost.then((info) => {
    $('nogpu').hidden = false;
    $('nogpuMsg').textContent = `The GPU device was lost: ${info.message || info.reason}. Reload the page.`;
  });
  gpu.device.addEventListener('uncapturederror', (e) => console.error('[origami]', e.error.message));
  resize();
  last = performance.now();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  $('nogpu').hidden = false;
  $('nogpuMsg').textContent = 'The page failed to start: ' + err.message;
});

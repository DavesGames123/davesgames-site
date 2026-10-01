// main.js -- the app: two panes, one crease pattern, one live fold.
//
// Port of origami src/app.rs and src/main.rs. The DIAGRAM pane is the editor.
// The FOLDED pane is the same pattern folded by the simulator, one sim step per
// frame. The panes sit side by side when the stage is wider than tall, and
// stack when it is taller, as app.rs layout does. The topbar toggle (AUTO,
// HORIZONTAL, VERTICAL) can force either; localStorage keeps the choice.
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
import { planarize } from './planarize.js';
import { report as foldReport, reportOk } from './foldability.js';
import { toJson, fromJson } from './foldio.js';
import * as sim from './sim.js';
import * as patterns from './patterns.js';
import { View2D, Orbit, snap } from './view.js';
import * as theme from './theme.js';
import { tri } from './tris.js';
import { seg } from './lines.js';
import { initGpu } from './gpu.js';

const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
const COARSE = matchMedia('(pointer:coarse)').matches;
const th = theme.site();
const $ = (id) => document.getElementById(id);

// The five tools (app.rs Tool), with the crease kind each one draws.
const TOOLS = {
  mountain: { kind: Assignment.Mountain, color: th.mountain, label: 'MOUNTAIN' },
  valley: { kind: Assignment.Valley, color: th.valley, label: 'VALLEY' },
  border: { kind: Assignment.Border, color: th.border, label: 'BORDER' },
  aux: { kind: Assignment.Flat, color: th.aux, label: 'AUX' },
  erase: { kind: null, color: th.textDim, label: 'ERASE' },
};
const TOOL_KEYS = { m: 'mountain', v: 'valley', b: 'border', a: 'aux', e: 'erase' };
// The auto-play speeds, in fold fraction per second (app.rs CycleSpeed).
const SPEEDS = [0.15, 0.3, 0.6, 1.1];

const S = {
  tool: 'valley',
  preset: patterns.Preset.Waterbomb,
  pattern: null, planar: null, mesh: null, report: [],
  fraction: 0, auto: true, autoDir: 1, foldSpeed: 0.3,
  orbit: new Orbit(), pan3d: [0, 0],
  zoom2d: 1, pan2d: [0, 0],
  gridN: 8, showGrid: true,
  cursor: null,          // pointer in CSS px, relative to the canvas
  drawing: null,         // the snapped world start of a crease drag
  hoveredFace: null,     // planar face index
  hoveredCrease: null,   // pattern crease index
  hoveredEdges: null,    // planar edge indices on the hovered crease
  hoveredVertex: null,   // a foldability report
  undo: [], redo: [],
  libraryOpen: false, panelOpen: false,
  layoutMode: 'auto', ui: 1,
  frozen: false,         // the test hook stops the sim with this
  dragFraction: false,
};

let gpu = null;
let dpr = 1;
let last = performance.now();
let lastPct = -1;

// ── persistence (try/catch: storage can be blocked) ─────────────────────────
function load(key, dflt) { try { const v = localStorage.getItem(key); return v === null ? dflt : v; } catch { return dflt; } }
function save(key, v) { try { localStorage.setItem(key, String(v)); } catch { /* storage blocked */ } }

// ── model plumbing ──────────────────────────────────────────────────────────

// Rebuild the folded mesh from the current pattern. Called after any edit.
function rebuild() {
  S.planar = planarize(S.pattern);
  S.mesh = sim.build(S.planar);
  S.mesh.setFraction(S.fraction);
  S.report = foldReport(S.planar);
  S.hoveredFace = null; S.hoveredCrease = null; S.hoveredEdges = null; S.hoveredVertex = null;
  syncCheck();
}

// Record the current pattern before an edit. A new edit clears the redo stack.
function pushUndo() {
  S.undo.push(S.pattern.clone());
  if (S.undo.length > 100) S.undo.shift();
  S.redo.length = 0;
}

function undo() {
  const prev = S.undo.pop();
  if (!prev) return;
  S.redo.push(S.pattern);
  S.pattern = prev;
  S.fraction = 0; S.auto = false;
  rebuild(); syncUI();
}

function redo() {
  const next = S.redo.pop();
  if (!next) return;
  S.undo.push(S.pattern);
  S.pattern = next;
  S.fraction = 0; S.auto = false;
  rebuild(); syncUI();
}

function loadPreset(p) {
  pushUndo();
  S.preset = p;
  S.pattern = patterns.build(p);
  // Every loaded pattern starts flat and paused, as in the native app.
  S.fraction = 0; S.auto = false;
  rebuild();
  S.libraryOpen = false;
  syncUI();
}

// Remove the nearest folding crease to a world point. A boundary stays.
function eraseNear(w) {
  const i = eraseTarget(w);
  if (i === null) return;
  pushUndo();
  S.pattern.removeCrease(i);
  rebuild();
}

function eraseTarget(w) {
  let best = null, bestD = 0.04;
  for (let i = 0; i < S.pattern.edges.length; i++) {
    if (S.pattern.assignment[i] === Assignment.Border) continue;
    const [a, b] = S.pattern.segment(i);
    const d = pointSegDist(w, a, b);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── geometry helpers (app.rs point_in_poly, point_in_tri2, point_seg_dist) ──
function pointInPoly(p, poly) {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function pointInTri2(p, a, b, c) {
  const cr = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = cr(p, a, b), d2 = cr(p, b, c), d3 = cr(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function pointSegDist(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = Math.max(abx * abx + aby * aby, 1e-12);
  const t = Math.min(Math.max(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2, 0), 1);
  return Math.hypot(a[0] + abx * t - p[0], a[1] + aby * t - p[1]);
}

// The planar edges that lie on one pattern crease.
function planarEdgesOf(crease) {
  const [a, b] = S.pattern.segment(crease);
  const out = [];
  S.planar.edges.forEach((e, i) => {
    if (pointSegDist(S.planar.vertices[e[0]], a, b) < 1e-4 && pointSegDist(S.planar.vertices[e[1]], a, b) < 1e-4) out.push(i);
  });
  return out;
}
// The pattern crease that holds one planar edge.
function creaseOfPlanar(edge) {
  const [ia, ib] = S.planar.edges[edge];
  const pa = S.planar.vertices[ia], pb = S.planar.vertices[ib];
  for (let i = 0; i < S.pattern.edges.length; i++) {
    const [a, b] = S.pattern.segment(i);
    if (pointSegDist(pa, a, b) < 1e-4 && pointSegDist(pb, a, b) < 1e-4) return i;
  }
  return null;
}

// ── layout and regions ──────────────────────────────────────────────────────
const stage = $('stage');
const canvas = $('gl');
const pane2dEl = $('pane2d'), pane3dEl = $('pane3d');

// The layout by aspect ratio (app.rs layout), or the forced mode.
function applyLayout() {
  const r = stage.getBoundingClientRect();
  const horiz = S.layoutMode === 'h' || (S.layoutMode === 'auto' && r.width >= r.height);
  stage.classList.toggle('horiz', horiz);
  stage.classList.toggle('vert', !horiz);
}

// Pane geometry in physical pixels: the scissor rect, and the fit region that
// leaves room for the label at the top and the bar at the base.
function paneGeom(el, labelEl, barEl) {
  const c = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const rect = [(r.left - c.left) * dpr, (r.top - c.top) * dpr, (r.right - c.left) * dpr, (r.bottom - c.top) * dpr];
  let top = r.top, bottom = r.bottom;
  const lb = labelEl.getBoundingClientRect();
  if (lb.height) top = Math.max(top, lb.bottom);
  if (barEl) {
    const bb = barEl.getBoundingClientRect();
    if (bb.height && getComputedStyle(barEl).display !== 'none') bottom = Math.min(bottom, bb.top);
  }
  if (bottom - top < 60) { top = r.top; bottom = r.bottom; }
  const fit = [(r.left - c.left) * dpr, (top - c.top) * dpr, (r.right - c.left) * dpr, (bottom - c.top) * dpr];
  return { rect, fit };
}

let geom2d = null, geom3d = null;
function measure() {
  geom2d = paneGeom(pane2dEl, $('label2d'), $('editBar'));
  geom3d = paneGeom(pane3dEl, $('label3d'), $('foldBar'));
}

function view2d() {
  return View2D.fit(geom2d.fit, 14 * dpr, S.zoom2d, [S.pan2d[0] * dpr, S.pan2d[1] * dpr]);
}
function region3d() {
  const f = geom3d.fit;
  return [f[0] + S.pan3d[0] * dpr, f[1] + S.pan3d[1] * dpr, f[2] + S.pan3d[0] * dpr, f[3] + S.pan3d[1] * dpr];
}
const inRect = (r, p) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
const phys = (p) => [p[0] * dpr, p[1] * dpr];
function paneAt(cssP) {
  if (!geom2d) return null;
  const p = phys(cssP);
  if (inRect(geom2d.rect, p)) return '2d';
  if (inRect(geom3d.rect, p)) return '3d';
  return null;
}
const snapPx = () => (COARSE ? 16 : 8) * dpr;

// ── drawing (app.rs draw_2d, draw_3d) ───────────────────────────────────────

// The fill for a face: its pastel, moved toward the accent when hovered.
function faceFill(face) {
  const base = theme.facePastel(face);
  return S.hoveredFace === face ? theme.mix(base, th.accent, 0.4) : base;
}

// A disc as a triangle fan, for the vertex dots the native quad pass drew.
function disc(out, c, r, color) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    tri(out, c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], color);
  }
}
// A ring as a closed polyline of segments.
function ring(out, c, r, w, color) {
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    seg(out, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], w, color);
  }
}

// Crease style by kind, in the diagram (app.rs draw_2d).
function style2d(kind) {
  switch (kind) {
    case Assignment.Mountain: return [th.mountain, 2.4];
    case Assignment.Valley: return [th.valley, 2.4];
    case Assignment.Border: return [th.border, 3.0];
    case Assignment.Flat: return [theme.dim(th.aux, 0.9), 1.6];
    default: return [th.textDim, 1.8];
  }
}

function draw2d() {
  const v = view2d();
  const tris = [], lines = [], over = [];
  // Line widths are the native physical widths at a 2x display. At 1x they
  // keep 80% of the native width, so a crease stays legible.
  const lw = Math.max(dpr * 0.5, 0.8);
  const planar = S.planar, mesh = S.mesh;

  // Each face in its pastel. The triangles come from the sim mesh, whose
  // indices match the planarized pattern.
  for (let t = 0; t < mesh.tris.length; t++) {
    const tv = mesh.tris[t].v;
    const f = mesh.faceOf[t] ?? 0;
    tri(tris, v.toPx(planar.vertices[tv[0]]), v.toPx(planar.vertices[tv[1]]), v.toPx(planar.vertices[tv[2]]), faceFill(f));
  }

  // The reference grid, faint, over the fills.
  if (S.showGrid) {
    const gc = theme.dim(th.grid, 0.6);
    for (let i = 0; i <= S.gridN; i++) {
      const t = -0.5 + i / S.gridN;
      seg(lines, v.toPx([t, -0.5]), v.toPx([t, 0.5]), 1.0 * lw, gc);
      seg(lines, v.toPx([-0.5, t]), v.toPx([0.5, t]), 1.0 * lw, gc);
    }
  }

  // Creases by kind. Boundaries thicker.
  for (let i = 0; i < S.pattern.edges.length; i++) {
    const [a, b] = S.pattern.segment(i);
    const [color, w] = style2d(S.pattern.assignment[i]);
    seg(lines, v.toPx(a), v.toPx(b), w * lw, color);
  }
  // The hovered crease, widened (web addition). With ERASE it shows the
  // crease a click removes, in the accent.
  if (S.hoveredCrease !== null && S.hoveredCrease < S.pattern.edges.length) {
    const [a, b] = S.pattern.segment(S.hoveredCrease);
    const [color, w] = style2d(S.pattern.assignment[S.hoveredCrease]);
    const c = S.tool === 'erase' ? th.accent : theme.mix(color, [1, 1, 1, 1], 0.3);
    seg(lines, v.toPx(a), v.toPx(b), (w + 2.6) * lw, c);
  }

  // Foldability: an amber ring on each interior vertex that fails a check.
  for (const r of S.report) {
    if (reportOk(r)) continue;
    ring(lines, v.toPx(planar.vertices[r.vertex]), 7 * dpr, 1.8 * dpr, th.bad);
  }
  if (S.hoveredVertex) {
    const r = S.hoveredVertex;
    ring(lines, v.toPx(planar.vertices[r.vertex]), 10 * dpr, 1.4 * dpr, reportOk(r) ? th.good : th.bad);
  }

  // Vertex dots above the creases.
  for (const p of S.pattern.vertices) disc(over, v.toPx(p), 2.6 * lw, th.textDim);

  // The rubber band while drawing, and the snap target under the pointer.
  if (S.cursor && paneAt(S.cursor) === '2d') {
    const end = snap(v.toWorld(phys(S.cursor)), S.pattern, S.gridN, v, snapPx());
    if (S.drawing && S.tool !== 'erase') seg(lines, v.toPx(S.drawing), v.toPx(end), 2.0 * lw, th.accent);
    if (S.tool !== 'erase') ring(lines, v.toPx(end), 4.5 * dpr, 1.2 * dpr, theme.dim(th.accent, 0.9));
  }
  return { rect: geom2d.rect, tris, lines, over };
}

function draw3d() {
  const r = region3d();
  const aspect = (r[2] - r[0]) / Math.max(r[3] - r[1], 1);
  const m = S.orbit.matrix(aspect);
  const eye = S.orbit.eye();
  const L = [0.3, 0.7, 0.6]; const ll = Math.hypot(...L); const light = L.map((x) => x / ll);
  const N = S.mesh.nodes;
  const lw = Math.max(dpr * 0.5, 0.8);
  const tris = [], lines = [];

  // Faces, shaded, back to front. The side facing away is darker.
  const faces = [];
  for (let t = 0; t < S.mesh.tris.length; t++) {
    const [ia, ib, ic] = S.mesh.tris[t].v;
    const ax = N[3 * ia], ay = N[3 * ia + 1], az = N[3 * ia + 2];
    const bx = N[3 * ib], by = N[3 * ib + 1], bz = N[3 * ib + 2];
    const cx = N[3 * ic], cy = N[3 * ic + 1], cz = N[3 * ic + 2];
    const pa = S.orbit.project(ax, ay, az, m, r), pb = S.orbit.project(bx, by, bz, m, r), pc = S.orbit.project(cx, cy, cz, m, r);
    if (!pa || !pb || !pc) continue;
    const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3, gz = (az + bz + cz) / 3;
    const depth = Math.hypot(eye[0] - gx, eye[1] - gy, eye[2] - gz);
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 0 && Number.isFinite(nl)) { nx /= nl; ny /= nl; nz /= nl; } else { nx = ny = nz = 0; }
    let vx = eye[0] - gx, vy = eye[1] - gy, vz = eye[2] - gz;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    const facing = nx * vx + ny * vy + nz * vz;
    const side = facing >= 0 ? 1.0 : 0.66;
    const lambert = 0.74 + 0.26 * Math.abs(nx * light[0] + ny * light[1] + nz * light[2]);
    const base = faceFill(S.mesh.faceOf[t] ?? 0);
    const shade = Math.min(Math.max(side * lambert, 0), 1.2);
    faces.push([depth, pa, pb, pc, [base[0] * shade, base[1] * shade, base[2] * shade, 1]]);
  }
  faces.sort((x, y) => y[0] - x[0]);
  for (const f of faces) tri(tris, f[1], f[2], f[3], f[4]);

  // The planar creases on the folded sheet.
  const hot = S.hoveredEdges ? new Set(S.hoveredEdges) : null;
  const drawEdge = (i, boost) => {
    const [ia, ib] = S.planar.edges[i];
    const pa = S.orbit.project(N[3 * ia], N[3 * ia + 1], N[3 * ia + 2], m, r);
    const pb = S.orbit.project(N[3 * ib], N[3 * ib + 1], N[3 * ib + 2], m, r);
    if (!pa || !pb) return;
    let color, w;
    switch (S.planar.assignment[i]) {
      case Assignment.Mountain: color = th.mountain; w = 2.2; break;
      case Assignment.Valley: color = th.valley; w = 2.2; break;
      case Assignment.Border: color = th.border; w = 2.6; break;
      default: color = theme.dim(th.aux, 0.8); w = 1.4;
    }
    if (boost) { color = S.tool === 'erase' ? th.accent : theme.mix(color, [1, 1, 1, 1], 0.3); w += 2.6; }
    seg(lines, pa, pb, w * lw, color);
  };
  for (let i = 0; i < S.planar.edges.length; i++) drawEdge(i, false);
  if (hot) for (const i of hot) drawEdge(i, true);
  return { rect: geom3d.rect, tris, lines, over: [] };
}

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
function findIndex(list, fn) { for (let i = 0; i < list.length; i++) if (fn(list[i])) return i; return null; }

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
function defaultStatus() {
  return COARSE ? 'One finger draws in the diagram and orbits the fold. Two fingers zoom and pan.'
    : 'Drag in the diagram to draw a crease. Drag the fold to orbit. Wheel zooms, right drag pans.';
}
let statusText = '';
function setStatus(t) { if (t !== statusText) { statusText = t; $('stMain').textContent = t; } }

// ── frame (app.rs frame) ────────────────────────────────────────────────────
function resize() {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, COARSE ? 2 : 3);
  if (gpu) gpu.resize(r.width * dpr, r.height * dpr);
}

function render() {
  measure();
  const p2 = draw2d(), p3 = draw3d();
  gpu.frame(th.canvas, [p2, p3]);
}

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

// ── the readouts and control state ──────────────────────────────────────────
function syncFold() {
  const pct = Math.round(S.fraction * 100);
  if (pct !== lastPct) {
    lastPct = pct;
    document.querySelectorAll('[data-out="pct"]').forEach((el) => { el.textContent = pct + '%'; });
  }
  if (!S.dragFraction) document.querySelectorAll('input[data-act="fraction"]').forEach((el) => { el.value = S.fraction; });
}

function syncUI() {
  const on = (sel, v) => document.querySelectorAll(sel).forEach((el) => el.classList.toggle('on', v));
  for (const t of Object.keys(TOOLS)) on(`[data-act="tool:${t}"]`, S.tool === t);
  on('[data-act="grid"]', S.showGrid);
  on('[data-act="library"]', S.libraryOpen);
  on('[data-act="play"]', S.auto);
  document.querySelectorAll('[data-act="play"]').forEach((el) => {
    if (el.id === 'dockPlay') { el.textContent = S.auto ? '❚❚' : '▶'; el.setAttribute('aria-label', S.auto ? 'Pause' : 'Play'); }
    else el.textContent = S.auto ? 'PAUSE' : 'PLAY';
  });
  document.querySelectorAll('[data-act="speed"]').forEach((el) => { el.textContent = (S.foldSpeed / 0.3).toFixed(1) + 'x'; });
  for (const m of ['auto', 'h', 'v']) on(`[data-act="layout:${m}"]`, S.layoutMode === m);
  document.querySelectorAll('[data-act="undo"]').forEach((el) => { el.disabled = S.undo.length === 0; });
  document.querySelectorAll('[data-act="redo"]').forEach((el) => { el.disabled = S.redo.length === 0; });
  for (const p of patterns.ALL) on(`[data-act="preset:${p.id}"]`, S.preset === p);
  $('library').hidden = !S.libraryOpen;
  $('panel').classList.toggle('open', S.panelOpen);
  document.querySelectorAll('[data-act="panel"]').forEach((el) => el.setAttribute('aria-expanded', String(S.panelOpen)));
  on('#dockPanel', S.panelOpen);
}

function syncCheck() {
  const badge = $('checkBadge'), text = $('checkText');
  const n = S.report.length;
  const bad = S.report.filter((r) => !reportOk(r));
  if (n === 0) {
    badge.className = 'check'; badge.textContent = 'no interior vertices';
    text.innerHTML = 'No interior fold vertex to check yet.';
  } else if (bad.length === 0) {
    badge.className = 'check ok'; badge.textContent = `✓ flat-foldable (local, ${n})`;
    text.innerHTML = `<span class="ok">${n === 1 ? 'The one interior vertex passes' : `All ${n} interior vertices pass`}</span> Maekawa, Kawasaki and Big-Little-Big. These checks are local: they are necessary, not sufficient.`;
  } else {
    badge.className = 'check bad'; badge.textContent = `✕ ${bad.length} of ${n} vertices fail`;
    const rows = bad.slice(0, 8).map((r) => {
      const why = [];
      if (!r.kawasakiOk) why.push(`Kawasaki ${r.kawasakiResidual.toFixed(1)}°`);
      if (r.maekawa !== null && !r.maekawaOk) why.push(`Maekawa ${r.maekawa}`);
      if (r.blbOk === false) why.push('Big-Little-Big');
      return `vertex ${r.vertex}: ${why.join(', ')}`;
    });
    text.innerHTML = `<span class="bad">${bad.length} of ${n} interior vertices fail.</span> Amber rings mark them.<br>` +
      rows.join('<br>') + (bad.length > 8 ? '<br>and more' : '');
  }
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
    case 'layout': S.layoutMode = arg; save('origami.layout', arg); applyLayout(); break;
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

function isPhone() { return matchMedia(PHONE_Q).matches; }

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

// ── the preset library (app.rs draw_library) ────────────────────────────────
function buildLibrary() {
  const groups = [['BASES', patterns.bases], ['TESSELLATIONS', patterns.tessellations], ['MODELS', patterns.models]];
  const html = groups.map(([name, list]) => `<div class="lib-cat">${name}</div><div class="lib-grid">` +
    list.map((p) => `<button class="chip" data-act="preset:${p.id}">${p.label}</button>`).join('') + '</div>').join('');
  document.querySelectorAll('[data-lib]').forEach((el) => { el.innerHTML = html; });
}

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
  loadPreset: (id) => { loadPreset(patterns.byId(id)); },
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
  S.layoutMode = ['auto', 'h', 'v'].includes(load('origami.layout', 'auto')) ? load('origami.layout', 'auto') : 'auto';
  const ui = Number(load('origami.ui', 1));
  if (Number.isFinite(ui) && ui !== 1) uiZoom(ui);
  buildLibrary();
  wire();
  applyLayout();
  setStatus(defaultStatus());

  const base = new URL('.', import.meta.url);
  const text = (p) => fetch(new URL(p, base)).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.text(); });
  await patterns.preloadFolds((n) => text('patterns/' + n));
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
  gpu = res.gpu;
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

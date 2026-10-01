// app/edit.js -- the model plumbing: rebuild after an edit, undo and redo,
// preset load, crease erase, and the map between pattern creases and planar edges.
//
// S.pattern is what the person edits. Any edit rebuilds S.planar (planarize),
// S.mesh (sim.build) and S.report (foldability), so the folded pane always
// shows the current pattern.
//
// grep map:
//   rebuild          -- pattern -> planarized -> fold mesh -> foldability report
//   pushUndo / undo / redo -- the edit history, 100 deep
//   loadPreset       -- fetch on first use, newest pick wins
//   eraseNear / eraseTarget -- the nearest folding crease to a world point
//   planarEdgesOf / creaseOfPlanar -- pattern crease <-> planar edges

import { Assignment } from '../model.js';
import { planarize } from '../planarize.js';
import { report as foldReport } from '../foldability.js';
import * as sim from '../sim.js';
import * as patterns from '../patterns.js';
import { pointSegDist } from './geom.js';
import { S, isPhone } from './state.js';
import { setStatus, syncUI, syncCheck } from './readouts.js';

// Rebuild the folded mesh from the current pattern. Called after any edit.
export function rebuild() {
  S.planar = planarize(S.pattern);
  S.mesh = sim.build(S.planar);
  S.mesh.setFraction(S.fraction);
  S.report = foldReport(S.planar);
  S.hoveredFace = null; S.hoveredCrease = null; S.hoveredEdges = null; S.hoveredVertex = null;
  syncCheck();
}

// Record the current pattern before an edit. A new edit clears the redo stack.
export function pushUndo() {
  S.undo.push(S.pattern.clone());
  if (S.undo.length > 100) S.undo.shift();
  S.redo.length = 0;
}

export function undo() {
  const prev = S.undo.pop();
  if (!prev) return;
  S.redo.push(S.pattern);
  S.pattern = prev;
  S.fraction = 0; S.auto = false;
  rebuild(); syncUI();
}

export function redo() {
  const next = S.redo.pop();
  if (!next) return;
  S.undo.push(S.pattern);
  S.pattern = next;
  S.fraction = 0; S.auto = false;
  rebuild(); syncUI();
}

// Load a preset. A file preset is fetched the first time it is picked, so the
// call is async. A newer pick wins over a slower older one.
let loadSeq = 0;
export async function loadPreset(p) {
  if (!p) return;
  const seq = ++loadSeq;
  if (p.file) {
    setStatus(`Loading ${p.label}...`);
    try { await patterns.prepare(p); } catch (err) { setStatus(`Could not load ${p.label}: ${err.message}`); return; }
    if (seq !== loadSeq) return;
  }
  pushUndo();
  S.preset = p;
  S.pattern = patterns.build(p);
  // Every loaded pattern starts flat and paused, as in the native app.
  S.fraction = 0; S.auto = false;
  rebuild();
  // The desktop library stays open, so a person can step through presets and
  // watch each fold. The phone sheet covers the panes, so it closes.
  if (isPhone()) S.libraryOpen = false;
  setStatus(`${p.label} · ${S.pattern.edges.length} creases`);
  syncUI();
}

// Remove the nearest folding crease to a world point. A boundary stays.
export function eraseNear(w) {
  const i = eraseTarget(w);
  if (i === null) return;
  pushUndo();
  S.pattern.removeCrease(i);
  rebuild();
}

export function eraseTarget(w) {
  let best = null, bestD = 0.04;
  for (let i = 0; i < S.pattern.edges.length; i++) {
    if (S.pattern.assignment[i] === Assignment.Border) continue;
    const [a, b] = S.pattern.segment(i);
    const d = pointSegDist(w, a, b);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The planar edges that lie on one pattern crease.
export function planarEdgesOf(crease) {
  const [a, b] = S.pattern.segment(crease);
  const out = [];
  S.planar.edges.forEach((e, i) => {
    if (pointSegDist(S.planar.vertices[e[0]], a, b) < 1e-4 && pointSegDist(S.planar.vertices[e[1]], a, b) < 1e-4) out.push(i);
  });
  return out;
}
// The pattern crease that holds one planar edge.
export function creaseOfPlanar(edge) {
  const [ia, ib] = S.planar.edges[edge];
  const pa = S.planar.vertices[ia], pb = S.planar.vertices[ib];
  for (let i = 0; i < S.pattern.edges.length; i++) {
    const [a, b] = S.pattern.segment(i);
    if (pointSegDist(pa, a, b) < 1e-4 && pointSegDist(pb, a, b) < 1e-4) return i;
  }
  return null;
}

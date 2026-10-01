// ============================================================================
//  PROTEIN VIEWER  ·  app/labels.js — HTML labels for measurements and the selection
// ────────────────────────────────────────────────────────────────────────────
//  buildLabels() makes one element per measurement and one for the
//  selected residue. placeLabels() projects them after each render.
//
//  GREP MAP
//    function buildLabels                  make the label elements
//    function placeLabels                  move them to the projected points
// ============================================================================
import * as THREE from 'three';
import { $ } from './env.js';
import { S, atomPos, resLabel } from './state.js';
import { camera, canvas } from './stage.js';
import { fmtMeasure } from './measure.js';

// HTML labels: measurement values and the selected residue
const labelsEl = $('labels');
let labelEls = [];
export function buildLabels() {
  labelsEl.innerHTML = '';
  labelEls = [];
  for (const m of S.measures) {
    const el = document.createElement('div');
    el.className = 'ml' + (m.kind === 'angle' ? ' ang' : m.kind === 'dihedral' ? ' dih' : '');
    el.textContent = fmtMeasure(m);
    labelsEl.appendChild(el);
    const pts = m.atoms.map(atomPos);
    const at = m.atoms.length === 3 ? pts[1] : pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    labelEls.push({ el, at });
  }
  if (S.sel) {
    const el = document.createElement('div');
    el.className = 'rl';
    const r = S.s.residues[S.sel.res];
    el.textContent = `${r.chainId}:${resLabel(r)}`;
    labelsEl.appendChild(el);
    labelEls.push({ el, at: atomPos(S.sel.atom) });
  }
}
const _p = new THREE.Vector3();
export function placeLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const L of labelEls) {
    _p.copy(L.at).project(camera);
    const vis = _p.z < 1 && _p.z > -1;
    L.el.style.display = vis ? '' : 'none';
    if (vis) L.el.style.transform = `translate(${((_p.x + 1) / 2 * w).toFixed(1)}px,${((1 - _p.y) / 2 * h).toFixed(1)}px) translate(-50%,${L.el.className === 'rl' ? '-150%' : '-50%'})`;
  }
}

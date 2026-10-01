// ============================================================================
//  PROTEIN VIEWER  ·  app/measure.js — distance, angle and dihedral measurements
// ────────────────────────────────────────────────────────────────────────────
//  In a measure mode each pick adds an atom to S.pending. When the count
//  is full, the value goes to S.measures. The lines and the pending marks
//  go in the overlay scene, which loop.js draws on top.
//
//  GREP MAP
//    function measureValue                 2, 3 or 4 atoms to Å or degrees
//    function addMeasureAtom / setMeasure  picking for a measurement
//    function rebuildMarks                 the overlay lines and marks
//    function syncMeasure                  the mode buttons, bar and list
// ============================================================================
import * as THREE from 'three';
import * as R from '../reps.js';
import { $, COARSE, cap, esc } from './env.js';
import { S, atomPos, dirty, resLabel } from './state.js';
import { clearGroup, matLine, matMark, overlay } from './stage.js';
import { toast } from './feedback.js';
import { buildLabels } from './labels.js';

// ── measuring ─────────────────────────────────────────────────────────────
const MKIND = { 2: 'distance', 3: 'angle', 4: 'dihedral' };
function measureValue(atoms) {
  const p = atoms.map(i => new THREE.Vector3(S.s.pos[3 * i], S.s.pos[3 * i + 1], S.s.pos[3 * i + 2]));
  if (p.length === 2) return p[0].distanceTo(p[1]);
  if (p.length === 3) return THREE.MathUtils.radToDeg(p[0].clone().sub(p[1]).angleTo(p[2].clone().sub(p[1])));
  const b1 = p[1].clone().sub(p[0]), b2 = p[2].clone().sub(p[1]), b3 = p[3].clone().sub(p[2]);
  const n1 = b1.clone().cross(b2), n2 = b2.clone().cross(b3);
  const y = b2.length() * b1.dot(n2), x = n1.dot(n2);
  return THREE.MathUtils.radToDeg(Math.atan2(y, x));
}
export const fmtMeasure = m => (m.atoms.length === 2 ? `${m.value.toFixed(2)} Å` : `${m.value.toFixed(1)}°`);
function atomTag(i) { const a = S.s.atoms[i], r = S.s.residues[a.res]; return `${r.chainId}:${resLabel(r)} ${a.name}`; }
export function addMeasureAtom(i) {
  if (i < 0) return;
  if (S.pending.length && S.pending[S.pending.length - 1] === i) return;
  S.pending.push(i);
  if (S.pending.length >= S.measure) {
    const atoms = S.pending.slice(0, S.measure);
    S.measures.push({ atoms, value: measureValue(atoms), kind: MKIND[S.measure] });
    S.pending = [];
    const m = S.measures[S.measures.length - 1];
    toast(`${cap(m.kind)} ${fmtMeasure(m)}`);
  }
  rebuildMarks(); syncMeasure();
}
export function rebuildMarks() {
  clearGroup(overlay);
  for (const m of S.measures) {
    const pts = m.atoms.map(atomPos);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, matLine[m.kind].clone());
    line.computeLineDistances();
    line.renderOrder = 10;
    overlay.add(line);
  }
  if (S.pending.length) {
    const geo = R.sphereGeo(2);
    for (const i of S.pending) {
      const mk = new THREE.Mesh(geo, matMark);
      mk.scale.setScalar(0.5); mk.position.copy(atomPos(i)); mk.renderOrder = 11;
      mk.userData.sharedGeo = true;
      overlay.add(mk);
    }
  }
  buildLabels();
  dirty();
}
export function syncMeasure() {
  document.querySelectorAll('#measureModes button').forEach(b => b.classList.toggle('on', +b.dataset.m === S.measure));
  $('dockMeasure').classList.toggle('on', S.measure > 0);
  const bar = $('measureBar');
  if (S.measure) {
    bar.hidden = false;
    bar.textContent = `${cap(MKIND[S.measure])}: ${COARSE ? 'tap' : 'click'} ${S.measure} atoms · ${S.pending.length} picked`;
  } else bar.hidden = true;
  $('measureList').innerHTML = S.measures.map((m, k) => `<div class="mrow"><b>${fmtMeasure(m)}</b><span>${m.atoms.map(i => esc(atomTag(i))).join(' – ')}</span><button type="button" data-k="${k}" aria-label="Remove">✕</button></div>`).join('') +
    (S.measures.length ? '<button type="button" class="tog wide" id="mClear">Clear all measurements</button>' : '');
}
$('measureList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'mClear') S.measures = [];
  else S.measures.splice(+b.dataset.k, 1);
  rebuildMarks(); syncMeasure();
});
export function setMeasure(m) {
  S.measure = m; S.pending = [];
  rebuildMarks(); syncMeasure();
  if (m) toast(`${cap(MKIND[m])}: ${COARSE ? 'tap' : 'click'} ${m} atoms in order`);
}

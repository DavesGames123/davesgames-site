// ============================================================================
//  PROTEIN VIEWER  ·  app/structure.js — put a parsed model in the view
// ────────────────────────────────────────────────────────────────────────────
//  setStructure() sets the defaults from the preset, centres the model,
//  turns its principal axes to the screen, and builds the layers, the strip
//  and the panel. computeFrame() writes the turned positions to S.wpos.
//
//  GREP MAP
//    function eig3                         3x3 symmetric eigenvectors
//    function resolveSel                   preset selection to residue indices
//    function setStructure                 a model to the view
//    function computeFrame                 S.wpos from the principal axes
// ============================================================================
import { makeGrid } from '../parse.js';
import { REDUCED } from './env.js';
import { S, anchorAtom, dirty, isPolymer } from './state.js';
import { canvas } from './stage.js';
import { rebuild } from './layers.js';
import { select } from './select.js';
import { hideCard } from './card.js';
import { buildStrip } from './strip.js';
import { focusResidues, resetView } from './camera.js';
import { syncUI } from './ui.js';

// symmetric 3x3 eigen-decomposition (Jacobi rotations)
function eig3(A) {
  const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 40; sweep++) {
    if (a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2 < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  return [0, 1, 2].map(i => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] })).sort((x, y) => y.val - x.val);
}

// ── structure setup ───────────────────────────────────────────────────────
export function resolveSel(sel) {
  const s = S.s, out = [];
  if (!sel) return out;
  if (sel.startsWith('lig:')) { const nm = sel.slice(4); for (const r of s.residues) if (r.name === nm) out.push(r.index); return out; }
  const [ch, rng] = sel.split(':');
  let a = -Infinity, b = Infinity;
  if (rng !== undefined) { const m = rng.split('-'); a = +m[0]; b = m.length > 1 ? +m[1] : a; }
  for (const r of s.residues) if (r.chainId === ch && r.seq >= a && r.seq <= b && r.kind !== 'water') out.push(r.index);
  return out;
}

export function setStructure(s, preset) {
  S.s = s; S.preset = preset;
  const polyChains = s.chains.filter(c => c.residues.some(i => isPolymer(s.residues[i])));
  S.rep = preset?.rep || (s.residues.some(isPolymer) ? 'cartoon' : 'ballstick');
  S.color = preset?.color || (s.meta.af ? 'plddt' : polyChains.length > 1 ? 'chain' : 'rainbow');
  S.chainOn = new Uint8Array(s.chains.length).fill(1);
  if (preset?.chains) {
    // the named chains and the het groups that sit on them
    const keep = new Set(preset.chains);
    s.chains.forEach((c, i) => { S.chainOn[i] = keep.has(c.id) || !c.residues.some(ri => isPolymer(s.residues[ri])) ? 1 : 0; });
  }
  S.opacity = preset?.surface ?? 1;
  S.sticks = (preset?.sticks || []).flatMap(resolveSel);
  S.stickSet = new Set(S.sticks);
  S.sel = null; S.hood = new Map(); S.hoverRes = -1;
  S.pending = []; S.measures = []; S.surfCache = null;
  S.fly = null;
  computeFrame();
  const heavy = [];
  for (let i = 0; i < s.atoms.length; i++) if (s.atoms[i].el !== 'H') heavy.push(i);
  S.grid = makeGrid(s.pos, heavy, 5);
  rebuild();
  buildStrip();
  syncUI();
  hideCard();
  resetView(true);
  if (preset?.focus) {
    const rs = resolveSel(preset.focus).filter(ri => S.chainOn[s.residues[ri].chain]);
    if (rs.length) setTimeout(() => {
      if (S.s !== s) return;
      if (rs.length <= 12) {
        select(anchorAtom(s.residues[rs[0]]), { fly: false, scroll: true, ensure: false });
        focusResidues([...rs, ...[...S.hood.keys()].slice(0, 30)], S.rep === 'surface' ? 12 : 5);
      } else focusResidues(rs, 6);
    }, REDUCED ? 0 : 450);
  }
  S.ready = true;
  dirty();
}

// centre on the visible polymer, long axis across (or up on a portrait view)
function computeFrame() {
  const s = S.s;
  const pts = [];
  s.residues.forEach(r => { if (isPolymer(r) && r.ca >= 0 && S.chainOn[r.chain]) pts.push(r.ca); });
  if (pts.length < 3) for (let i = 0; i < s.atoms.length; i++) if (S.chainOn[s.residues[s.atoms[i].res].chain]) pts.push(i);
  const p = s.pos;
  let cx = 0, cy = 0, cz = 0;
  for (const i of pts) { cx += p[3 * i]; cy += p[3 * i + 1]; cz += p[3 * i + 2]; }
  cx /= pts.length; cy /= pts.length; cz /= pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of pts) {
    const d = [p[3 * i] - cx, p[3 * i + 1] - cy, p[3 * i + 2] - cz];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
  }
  let ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (pts.length >= 3) {
    const e = eig3(C);
    let e1 = e[0].vec, e2 = e[1].vec;
    const portrait = canvas.clientHeight > canvas.clientWidth * 1.15;
    if (portrait) [e1, e2] = [e2, e1];
    const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    ax = [e1, e2, e3];
  }
  const n = s.atoms.length, w = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const x = p[3 * i] - cx, y = p[3 * i + 1] - cy, z = p[3 * i + 2] - cz;
    w[3 * i] = ax[0][0] * x + ax[0][1] * y + ax[0][2] * z;
    w[3 * i + 1] = ax[1][0] * x + ax[1][1] * y + ax[1][2] * z;
    w[3 * i + 2] = ax[2][0] * x + ax[2][1] * y + ax[2][2] * z;
  }
  S.wpos = w;
}

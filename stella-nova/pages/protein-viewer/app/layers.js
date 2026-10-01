// ============================================================================
//  PROTEIN VIEWER  ·  app/layers.js — build the mesh layers of the current rep
// ────────────────────────────────────────────────────────────────────────────
//  rebuild() clears the mol group and makes the layers for S.rep from the
//  visible residues. It also fills S.pick with the pickable atoms and sets
//  S.bound. rebuildOverlay() makes the side-chain sticks in the over group.
//
//  GREP MAP
//    const ATOM_REPS                       reps that draw every atom
//    function visibility                  residue mask from chains and toggles
//    function detailFor / ballRadius / bondsWithin   layer parameters
//    function rebuild                     the mol group and S.pick
//    function rebuildOverlay              the over group and S.pickOver
// ============================================================================
import * as THREE from 'three';
import { cartoonGeometry } from '../cartoon.js';
import { gaussianSurface, vdw } from '../surface.js';
import * as R from '../reps.js';
import { COARSE } from './env.js';
import { ADDITIVES, S, isPolymer } from './state.js';
import { clearGroup, matAtom, matCartoon, matSurface, mol, over, post } from './stage.js';
import { applyOpacity, paint } from './paint.js';
import { rebuildMarks } from './measure.js';

const ATOM_REPS = new Set(['ballstick', 'licorice', 'spacefill']);

// ── layers ────────────────────────────────────────────────────────────────
function visibility() {
  const s = S.s, vis = new Uint8Array(s.residues.length);
  for (const r of s.residues) {
    let v = S.chainOn[r.chain];
    if (r.kind === 'water') v = v && S.show.waters;
    else if (r.kind === 'ion') v = v && S.show.ions;
    else if (r.kind === 'ligand') v = v && S.show.ligands && (S.show.additives || !ADDITIVES.has(r.name));
    vis[r.index] = v ? 1 : 0;
  }
  // sticks named by the preset stay visible even if their class is hidden
  for (const ri of S.sticks) if (S.chainOn[s.residues[ri].chain] && s.residues[ri].kind !== 'water') vis[ri] = 1;
  return vis;
}
function detailFor(n, extra = 0) {
  let d = n < 3000 ? 3 : n < 12000 ? 2 : n < 40000 ? 1 : 0;
  if (COARSE) d -= 1;
  return Math.max(0, Math.min(3, d + extra));
}
function ballRadius(rep, a, r) {
  const single = isPolymer(r) && r.atoms.length === 1;
  if (rep === 'spacefill') return single ? 2.4 : vdw(a.el);
  if (rep === 'licorice') return single ? 0.55 : a.el === 'H' ? 0.13 : 0.24;
  return single ? 0.85 : a.el === 'H' ? 0.18 : 0.24 * vdw(a.el);
}
function bondsWithin(set) {
  const b = S.s.bonds, out = [];
  for (let k = 0; k < b.length; k += 2) if (set.has(b[k]) && set.has(b[k + 1])) out.push(b[k], b[k + 1]);
  return out;
}

export function rebuild() {
  const s = S.s;
  if (!s) return;
  clearGroup(mol);
  const vis = S.vis = visibility();
  const wpos = S.wpos;
  const atomOK = i => vis[s.atoms[i].res] && (S.show.hydrogens || s.atoms[i].el !== 'H');
  S.pick = [];
  const rep = S.rep;
  const nRes = s.residues.reduce((k, r) => k + (isPolymer(r) && vis[r.index]), 0);
  if (ATOM_REPS.has(rep)) {
    const idx = [];
    for (let i = 0; i < s.atoms.length; i++) { const r = s.residues[s.atoms[i].res]; if (r.kind !== 'water' && r.kind !== 'ion' && atomOK(i)) idx.push(i); }
    const rad = i => ballRadius(rep, s.atoms[i], s.residues[s.atoms[i].res]);
    const L = R.atomLayer(idx, wpos, rad, detailFor(idx.length, rep === 'spacefill' ? 1 : 0), matAtom);
    mol.add(L);
    S.pick.push({ idx: L.userData.idx, rad: L.userData.rad });
    if (rep !== 'spacefill') {
      const set = new Set(idx);
      const pairs = bondsWithin(set);
      const br = rep === 'licorice' ? 0.24 : 0.13;
      if (pairs.length) mol.add(R.bondLayer(pairs, wpos, br, idx.length < 12000 ? (COARSE ? 8 : 10) : 6, matAtom));
    }
  } else {
    const showRes = ri => vis[ri] && isPolymer(s.residues[ri]);
    if (rep === 'cartoon') {
      const sub = nRes < 1500 ? (COARSE ? 6 : 8) : nRes < 4000 ? (COARSE ? 5 : 6) : 4;
      const ring = nRes < 1500 ? (COARSE ? 10 : 12) : nRes < 4000 ? 10 : 8;
      const g = cartoonGeometry(s, wpos, { sub, ring, show: showRes });
      if (g.position.length) mol.add(R.cartoonLayer(g, matCartoon));
      if (g.rungs.length) {
        mol.add(R.segmentLayer(g.rungs, 0.42, 8, matAtom));
        const ends = g.rungs.map(q => ({ from: q.to, to: q.to, res: q.res }));
        const L = R.atomLayer(ends.map((q, k) => k), new Float32Array(ends.flatMap(q => q.to)), () => 0.42, 1, matAtom);
        L.paintResidues = lin => { const c = L.instanceColor.array; ends.forEach((q, k) => { c[3 * k] = lin[3 * q.res]; c[3 * k + 1] = lin[3 * q.res + 1]; c[3 * k + 2] = lin[3 * q.res + 2]; }); L.instanceColor.needsUpdate = true; };
        L.paintAtoms = null;
        mol.add(L);
      }
    } else if (rep === 'trace') {
      const segs = [], cas = [];
      for (const sg of s.segments) {
        if (!showRes(sg.residues[0])) continue;
        for (let k = 0; k < sg.residues.length; k++) {
          const r = s.residues[sg.residues[k]];
          cas.push(r.ca);
          if (k + 1 < sg.residues.length) {
            const q = s.residues[sg.residues[k + 1]];
            const half = [0, 1, 2].map(a => (wpos[3 * r.ca + a] + wpos[3 * q.ca + a]) / 2);
            segs.push({ from: [wpos[3 * r.ca], wpos[3 * r.ca + 1], wpos[3 * r.ca + 2]], to: half, res: r.index });
            segs.push({ from: half, to: [wpos[3 * q.ca], wpos[3 * q.ca + 1], wpos[3 * q.ca + 2]], res: q.index });
          }
        }
      }
      if (segs.length) mol.add(R.segmentLayer(segs, 0.32, 8, matAtom));
      if (cas.length) {
        const L = R.atomLayer(cas, wpos, () => 0.5, detailFor(cas.length), matAtom);
        L.paintResidues = lin => { const c = L.instanceColor.array; cas.forEach((i, k) => { const ri = s.atoms[i].res; c[3 * k] = lin[3 * ri]; c[3 * k + 1] = lin[3 * ri + 1]; c[3 * k + 2] = lin[3 * ri + 2]; }); L.instanceColor.needsUpdate = true; };
        L.paintAtoms = null;
        mol.add(L);
      }
    } else if (rep === 'surface') {
      const atoms = [];
      for (let i = 0; i < s.atoms.length; i++) { const r = s.residues[s.atoms[i].res]; if (isPolymer(r) && vis[r.index] && s.atoms[i].el !== 'H') atoms.push(i); }
      const key = Array.from(S.chainOn).join('');
      let g = S.surfCache && S.surfCache.key === key ? S.surfCache.g : null;
      if (!g && atoms.length) {
        g = gaussianSurface(wpos, atoms, { radius: a => (s.residues[s.atoms[a].res].atoms.length === 1 ? 2.9 : vdw(s.atoms[a].el)), maxCells: COARSE ? 1.1e6 : 2.6e6 });
        S.surfCache = { key, g };
      }
      if (g) { const L = R.surfaceLayer(g, matSurface); L.userData.surface = true; mol.add(L); }
      applyOpacity();
      const rad = new Float32Array(atoms.length);
      atoms.forEach((i, k) => { rad[k] = (s.residues[s.atoms[i].res].atoms.length === 1 ? 2.9 : vdw(s.atoms[i].el)) + 0.4; });
      S.pick.push({ idx: atoms, rad });
    }
    if (rep !== 'surface') {
      const cas = [];
      s.residues.forEach(r => { if (showRes(r.index) && r.ca >= 0) cas.push(r.ca); });
      S.pick.push({ idx: cas, rad: new Float32Array(cas.length).fill(rep === 'cartoon' ? 1.9 : 1.2) });
    }
    // ligands in ball-and-stick
    const lig = [];
    for (let i = 0; i < s.atoms.length; i++) { const r = s.residues[s.atoms[i].res]; if (r.kind === 'ligand' && atomOK(i)) lig.push(i); }
    if (lig.length) {
      const L = R.atomLayer(lig, wpos, i => (s.atoms[i].el === 'H' ? 0.16 : 0.27 * vdw(s.atoms[i].el)), detailFor(lig.length), matAtom);
      mol.add(L);
      S.pick.push({ idx: L.userData.idx, rad: L.userData.rad });
      const pairs = bondsWithin(new Set(lig));
      if (pairs.length) mol.add(R.bondLayer(pairs, wpos, 0.15, 10, matAtom));
    }
  }
  // ions and waters
  const ions = [], waters = [];
  for (let i = 0; i < s.atoms.length; i++) {
    const r = s.residues[s.atoms[i].res];
    if (!vis[r.index]) continue;
    if (r.kind === 'ion') ions.push(i);
    else if (r.kind === 'water' && s.atoms[i].el === 'O') waters.push(i);
  }
  if (ions.length) {
    const L = R.atomLayer(ions, wpos, i => (rep === 'spacefill' ? vdw(s.atoms[i].el) : Math.min(1.05, 0.62 * vdw(s.atoms[i].el))), 2, matAtom);
    mol.add(L); S.pick.push({ idx: L.userData.idx, rad: L.userData.rad });
  }
  if (waters.length) {
    const L = R.atomLayer(waters, wpos, () => (rep === 'spacefill' ? 1.0 : 0.3), 1, matAtom);
    mol.add(L); S.pick.push({ idx: L.userData.idx, rad: new Float32Array(waters.length).fill(0.6) });
  }
  // the bounding sphere of what is drawn
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let any = false;
  for (const r of s.residues) if (vis[r.index] && (isPolymer(r) || nRes === 0)) for (const i of r.atoms) { box.expandByPoint(v.set(wpos[3 * i], wpos[3 * i + 1], wpos[3 * i + 2])); any = true; }
  if (any) {
    box.getCenter(S.bound.c);
    let r2 = 0;
    for (const r of s.residues) if (vis[r.index] && (isPolymer(r) || nRes === 0)) for (const i of r.atoms) r2 = Math.max(r2, v.set(wpos[3 * i], wpos[3 * i + 1], wpos[3 * i + 2]).distanceToSquared(S.bound.c));
    S.bound.r = Math.sqrt(r2) + 2;
  }
  post.aoRadius = rep === 'spacefill' || rep === 'surface' ? 5.5 : rep === 'cartoon' ? 4.0 : 2.8;
  rebuildOverlay();
  paint();
}

// side chains as sticks: the preset's residues and the selection's 5 Å
export function rebuildOverlay() {
  const s = S.s;
  clearGroup(over);
  S.pickOver = [];
  if (!s) return;
  const set = new Set(S.sticks);
  if (S.sel) { set.add(S.sel.res); for (const ri of S.hood.keys()) set.add(ri); }
  if (ATOM_REPS.has(S.rep) || !set.size) { rebuildMarks(); return; }
  const polyRep = S.rep !== 'surface' || S.opacity < 1;
  const atoms = [];
  for (const ri of set) {
    const r = s.residues[ri];
    if (!S.chainOn[r.chain]) continue;
    if (r.kind === 'water' && !S.show.waters) continue;
    if (r.kind === 'ligand' && S.vis[ri]) continue; // drawn already
    if (r.kind === 'ion') continue;
    if (isPolymer(r) && r.atoms.length === 1) continue;
    for (const i of r.atoms) {
      const a = s.atoms[i];
      if (a.el === 'H' && !S.show.hydrogens) continue;
      if (r.kind === 'protein' && polyRep && (a.name === 'N' || a.name === 'C' || a.name === 'O' || a.name === 'OXT')) continue;
      atoms.push(i);
    }
  }
  if (atoms.length) {
    const L = R.atomLayer(atoms, S.wpos, i => (s.atoms[i].el === 'H' ? 0.13 : 0.25), detailFor(atoms.length), matAtom);
    over.add(L);
    S.pickOver.push({ idx: L.userData.idx, rad: new Float32Array(atoms.length).fill(0.55) });
    const pairs = bondsWithin(new Set(atoms));
    if (pairs.length) over.add(R.bondLayer(pairs, S.wpos, 0.21, 10, matAtom));
  }
  rebuildMarks();
}

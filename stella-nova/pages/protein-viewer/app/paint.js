// ============================================================================
//  PROTEIN VIEWER  ·  app/paint.js — colours on the layers, surface opacity
// ────────────────────────────────────────────────────────────────────────────
//  paint() gets the scheme colours from colors.js, tints the selection,
//  its 5 Å neighbours and the hover residue, dims the residues outside
//  S.hl (the saver feature) when it is set, and gives linear colours
//  to each layer through paintResidues or paintAtoms.
//
//  GREP MAP
//    function srgbToLin                  sRGB to linear, per channel
//    function paint                      repaint every layer
//    function applyOpacity               surface opacity and depth write
// ============================================================================
import { residueColors, atomColors } from '../colors.js';
import { S, dirty } from './state.js';
import { matSurface, mol, over } from './stage.js';

function srgbToLin(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) { const c = arr[i]; out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  return out;
}

// ── colour ────────────────────────────────────────────────────────────────
const GOLD = [1, 0.8, 0.42];
export function paint() {
  const s = S.s;
  if (!s) return;
  const resCol = residueColors(s, S.color);
  const atomCol = atomColors(s, S.color, resCol, { hetero: true });
  S.resColSRGB = resCol;
  const hasSel = !!S.sel;
  const resF = new Float32Array(resCol), atomF = new Float32Array(atomCol);
  if (S.hl) for (let ri = 0; ri < s.residues.length; ri++) {
    if (S.hl.has(ri)) continue;
    for (let c = 0; c < 3; c++) resF[3 * ri + c] *= 0.22;
    for (const i of s.residues[ri].atoms) for (let c = 0; c < 3; c++) atomF[3 * i + c] *= 0.22;
  }
  if (hasSel || S.hoverRes >= 0) {
    const dim = hasSel ? 0.7 : 1;
    for (let ri = 0; ri < s.residues.length; ri++) {
      const sel = hasSel && ri === S.sel.res, hood = S.hood.has(ri), hov = ri === S.hoverRes;
      let k = 1, g = 0, w = 0;
      if (sel) g = 0.6; else if (!hood && !S.stickSet.has(ri)) k = dim;
      if (hov) w = 0.35;
      const tint = (arr, j) => {
        for (let c = 0; c < 3; c++) {
          let v = arr[3 * j + c] * k;
          v = v + (GOLD[c] - v) * g;
          v = v + (1 - v) * w;
          arr[3 * j + c] = v;
        }
      };
      tint(resF, ri);
      if (k !== 1 || g || w) for (const i of s.residues[ri].atoms) {
        if (sel && s.atoms[i].el !== 'C') { for (let c = 0; c < 3; c++) atomF[3 * i + c] += (1 - atomF[3 * i + c]) * 0.15; continue; }
        tint(atomF, i);
      }
    }
  }
  const resLin = srgbToLin(resF), atomLin = srgbToLin(atomF);
  // the surface takes the residue colour, except in the per-atom schemes
  let surfLin = atomLin;
  if (S.color !== 'element' && S.color !== 'bfactor') {
    surfLin = new Float32Array(atomLin.length);
    for (let i = 0; i < s.atoms.length; i++) { const r = s.atoms[i].res; surfLin[3 * i] = resLin[3 * r]; surfLin[3 * i + 1] = resLin[3 * r + 1]; surfLin[3 * i + 2] = resLin[3 * r + 2]; }
  }
  for (const g of [mol, over]) for (const L of g.children) {
    if (L.paintResidues) L.paintResidues(resLin);
    else if (L.paintAtoms) L.paintAtoms(L.userData.surface ? surfLin : atomLin);
  }
  dirty();
}
export function applyOpacity() {
  const o = S.opacity;
  matSurface.transparent = o < 0.999;
  matSurface.opacity = o;
  matSurface.depthWrite = o >= 0.999;
  matSurface.needsUpdate = true;
  dirty();
}

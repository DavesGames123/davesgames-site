// ============================================================================
//  PROTEIN VIEWER  ·  app/state.js — the viewer state S and the residue helpers
// ────────────────────────────────────────────────────────────────────────────
//  S holds the loaded structure, the view options, the selection and the
//  measurements. All modules read and write S. dirty() marks the frame
//  for a new render, and loop.js clears the mark when it draws.
//
//  GREP MAP
//    const ADDITIVES                                   hidden het groups
//    const S / dirty                                   state, render flag
//    const isPolymer / resLabel / atomPos / anchorAtom  residue helpers
// ============================================================================
import * as THREE from 'three';
import { cap } from './env.js';

// crystallisation and detergent molecules: hidden unless "Additives" is on
export const ADDITIVES = new Set(['SO4', 'PO4', 'ACT', 'ACY', 'GOL', 'EDO', 'PEG', 'PG4', 'PGE', '1PE', 'P6G', 'BOG', 'HTG', 'HTO', 'DMS',
  'FMT', 'MPD', 'TRS', 'BME', 'IPA', 'EOH', 'MES', 'EPE', 'CIT', 'NO3', 'IMD', 'LDA', 'C8E', 'OLC', 'BU3', 'MRD', 'PE4', 'SCN', 'AZI', 'NH4', 'UNX', 'UNL']);

// ── state ─────────────────────────────────────────────────────────────────
export const S = {
  s: null, preset: null, token: 0, rep: 'cartoon', color: 'chain',
  show: { ligands: true, ions: true, waters: false, hydrogens: false, additives: false },
  opacity: 1, chainOn: null, sticks: [], stickSet: new Set(), sel: null, hood: new Map(), hoverRes: -1,
  measure: 0, pending: [], measures: [], spin: false, dirty: true, fly: null,
  wpos: null, bound: { c: new THREE.Vector3(), r: 20 }, grid: null, pick: [], pickOver: [],
  vis: null, cells: null, surfCache: null, look: { ao: true, outline: true, fog: true }, frames: 0, ready: false,
  xr: false,   // true while a VR or AR session runs (app/xr.js)
  saver: false,   // true in the shell screensaver (main.js window.snSaver)
};
export const dirty = () => { S.dirty = true; };

// ── helpers ───────────────────────────────────────────────────────────────
export const isPolymer = r => r.kind === 'protein' || r.kind === 'nucleic';
export const resLabel = r => (isPolymer(r) && r.kind === 'protein' ? cap(r.name) : r.name) + ' ' + r.seq + (r.icode || '');
export const atomPos = i => new THREE.Vector3(S.wpos[3 * i], S.wpos[3 * i + 1], S.wpos[3 * i + 2]);
export const anchorAtom = r => (r.ca >= 0 ? r.ca : r.atoms[0]);

// ============================================================================
//  MATERIAL STUDIO  ·  viewport/prefs.js — per-viewer view settings in localStorage
// ────────────────────────────────────────────────────────────────────────────
//  Keeps the view settings and the camera angles of this viewer in
//  localStorage. init() reads them once. A view change or a camera move
//  saves them 400 ms later. A custom mesh is saved as the sphere, because
//  the .obj data is not saved.
//
//  GREP TARGETS
//      PREF_KEY ............... localStorage key
//      PREF_VIEW_KEYS ......... the state.view keys that are saved
//      readPrefs .............. {view, camera} or {}
//      savePrefsSoon .......... save after 400 ms of no change
// ============================================================================
import { state, cam } from './state.js';

const PREF_KEY = 'material-studio.viewport';
export const PREF_VIEW_KEYS = ['mesh', 'debug', 'tonemap', 'exposure', 'fov', 'background', 'aa', 'ground', 'grid', 'shadows', 'shadowStrength',
  'uvScale', 'uvOffset', 'parallax', 'parallaxScale', 'pomSteps', 'displacement', 'subdiv', 'normalStrength', 'flipGreen',
  'anisoRotation', 'sheenRoughness', 'specOcclusion', 'autoRotate', 'wireframe'];

export function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; }
}
let prefTimer = 0;
export function savePrefsSoon() {
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    try {
      const view = {};
      for (const k of PREF_VIEW_KEYS) if (state.view[k] !== undefined) view[k] = state.view[k];
      if (view.mesh === 'custom') view.mesh = 'sphere';
      localStorage.setItem(PREF_KEY, JSON.stringify({ view, camera: cam ? cam.getState() : null }));
    } catch (e) {}
  }, 400);
}

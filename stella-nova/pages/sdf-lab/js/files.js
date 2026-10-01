// ============================================================================
//  SDF FORGE  ·  files.js — save, load, autosave, export
// ----------------------------------------------------------------------------
//  The document is JSON (doc.toJSON / doc.fromJSON, which validates). The
//  autosave writes it to localStorage after each edit; every storage access
//  sits in try/catch, because a private window or a blocked origin throws.
//
//  EXPORTS
//    WGSL  fn mapD(p: vec3f) -> f32 with every number written in
//    GLSL  float mapD(vec3 p), the same field
//    OBJ   marching cubes in a module worker (mc-worker.js), so the page stays
//          live; the progress comes back as messages
//
//  GREP MAP
//    loadAutosave / scheduleAutosave / flushAutosave
//    download / saveJSON / openJSON / copyText
//    exportWGSL / exportGLSL / exportOBJ / meshBounds
// ============================================================================
import * as D from './doc.js';
import { genWGSLBaked, genGLSL, buildLayout, packParams } from './codegen.js';

const KEY = 'sdf-forge-doc-v1';
export function loadAutosave() {
  try { const t = localStorage.getItem(KEY); return t ? D.fromJSON(t) : null; } catch (e) { return null; }
}
let timer = 0;
export function scheduleAutosave(app) { clearTimeout(timer); timer = setTimeout(() => flushAutosave(app), 500); }
export function flushAutosave(app) { try { localStorage.setItem(KEY, D.toJSON(app.doc)); } catch (e) { /* storage blocked */ } }

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export const saveJSON = app => download('scene.sdf.json', JSON.stringify(app.doc, null, 1), 'application/json');
export async function openJSON(app, file) { app.loadDoc(D.fromJSON(await file.text()), 'Open'); }
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e2) { return false; }
  }
}
function baked(app) { const L = buildLayout(app.doc); return { L, P: packParams(app.doc, L) }; }
export function exportWGSL(app) { const { L, P } = baked(app); return genWGSLBaked(app.doc, L, P); }
export function exportGLSL(app) { const { L, P } = baked(app); return genGLSL(app.doc, L, P); }

// The scene bounds for meshing, with a margin. An infinite plane is clipped
// to its display size, so a cut through it meshes as a slab.
export function meshBounds(doc) {
  const b = D.docBounds(doc);
  if (!b) return null;
  const pad = 0.04 * Math.max(...b.hi.map((v, j) => v - b.lo[j])) + 0.05;
  return { lo: b.lo.map(v => v - pad), hi: b.hi.map(v => v + pad) };
}
export function exportOBJ(app, res, onProgress) {
  return new Promise((resolve, reject) => {
    const bounds = meshBounds(app.doc);
    if (!bounds) { reject(new Error('the scene is empty')); return; }
    const w = new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => {
      if (e.data.progress !== undefined) { onProgress && onProgress(e.data.progress); return; }
      w.terminate();
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data);
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || 'worker error')); };
    w.postMessage({ doc: D.toJSON(app.doc), res, bounds, name: 'sdf_forge' });
  });
}

// ============================================================================
//  MATERIAL STUDIO  ·  editor/clipboard.js — copy and paste of nodes
// ────────────────────────────────────────────────────────────────────────────
//  Copy writes the clip JSON to localStorage (other tabs read it) and to the
//  system clipboard. Paste prefers the window paste event. Ctrl+V also
//  starts a 60 ms fallback that reads localStorage when no paste event came.
//  The clip lands at the pointer (or the view center), snapped to the grid.
//
//  GREP TARGETS
//      copySel .... selection -> clip JSON (localStorage + clipboard)
//      pasteSoon .. Ctrl+V fallback timer
//      onPaste .... window paste event
//      pasteText .. clip JSON or Graph JSON -> graph, select the result
// ============================================================================
import * as G from '../graph.js';
import { toast } from '../store.js';
import { toG, CLIP_KEY, SNAP } from './state.js';
import { sel, selFrames, setSel, setSelFrames } from './selection.js';
import { mouse } from './pointer.js';
import { viewCenterG } from './view.js';
import { editorActive } from './keys.js';

export function copySel() {
  if (!sel.size && !selFrames.size) return false;
  const clip = G.actions.copy([...sel], [...selFrames]);
  if (!clip.nodes.length && !clip.frames.length) return false;
  const json = JSON.stringify(clip);
  try { localStorage.setItem(CLIP_KEY, json); } catch (e) { /* storage off */ }
  try { navigator.clipboard?.writeText(json).catch(() => {}); } catch (e) { /* no clipboard */ }
  toast(`Copied ${clip.nodes.length} node${clip.nodes.length === 1 ? '' : 's'}`, 'info', 1200);
  return true;
}
let pasteTimer = 0, pasteHandled = false;
export function pasteSoon() {
  pasteHandled = false;
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => { if (!pasteHandled) { let json = null; try { json = localStorage.getItem(CLIP_KEY); } catch (e) {} pasteText(json); } }, 60);
}
export function onPaste(e) {
  if (!editorActive()) return;
  const text = e.clipboardData?.getData('text/plain');
  let ok = false;
  if (text && /^\s*\{/.test(text)) ok = pasteText(text, true);
  if (ok) { pasteHandled = true; e.preventDefault(); }
}
/** Paste clip JSON (or full Graph JSON) at the pointer. @returns {boolean} */
export function pasteText(json, quiet) {
  if (!json) return false;
  let data; try { data = JSON.parse(json); } catch (e) { return false; }
  const clip = G.toClip(data);
  if (!clip || (!clip.nodes.length && !clip.frames?.length)) { if (!quiet) toast('Nothing to paste', 'warn', 1500); return false; }
  const [gx, gy] = mouse.inside ? toG(mouse.sx, mouse.sy) : viewCenterG();
  const r = G.actions.paste(clip, Math.round(gx / SNAP) * SNAP, Math.round(gy / SNAP) * SNAP);
  if (r) { setSelFrames(new Set(r.frameIds)); setSel(r.nodeIds, { keepFrames: true }); }
  return !!r;
}

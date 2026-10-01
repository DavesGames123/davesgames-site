// ============================================================================
//  MATERIAL STUDIO  ·  export/ui/keys.js — the export keyboard shortcuts
// ────────────────────────────────────────────────────────────────────────────
//  bindKeys adds one keydown listener on window in the capture phase.
//  Ctrl+S saves the full project (graph plus the embedded images). Ctrl+O
//  opens any file kind. Ctrl+E shows the Export tab in full mode only.
//  Ctrl+S and Ctrl+O are supersets of the panels.js graph-JSON shortcuts,
//  which skip a defaultPrevented event. Alt or Shift turns them off.
//
//  GREP TARGETS
//      bindKeys  keydown
// ============================================================================
import * as IMP from '../../import.js';
import { UI, err } from '../ctx.js';
import { saveProject } from '../project.js';
import { showExportTab } from './place.js';

/** Capture Ctrl+S, Ctrl+O and Ctrl+E on window. init() calls it once. */
export function bindKeys() {
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject().catch(err); }
    else if (k === 'o') { e.preventDefault(); IMP.pickFiles(); }
    else if (k === 'e' && UI.mode === 'full') { e.preventDefault(); showExportTab(); }
  }, true);
}

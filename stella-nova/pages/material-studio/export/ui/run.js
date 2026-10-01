// ============================================================================
//  MATERIAL STUDIO  ·  export/ui/run.js — the active target and the Export run
// ────────────────────────────────────────────────────────────────────────────
//  activeTarget gives the target of the panel: in extra mode the panels.js
//  card that is on, else OPTS.target. runExport exports with the panel
//  options, downloads the result and shows it. busy stops a second run
//  while one is open, and body.io-busy marks the run.
//
//  GREP TARGETS
//      activeTarget  runExport  busy  io-busy
// ============================================================================
import { EXPORT_TARGETS } from '../../contract.js';
import { C, UI, err } from '../ctx.js';
import { fmtSize } from '../format.js';
import { OPTS } from '../options.js';
import { exportPackage } from '../package.js';
import { download } from './dom.js';
import { setProgress, showResult } from './progress.js';

let busy = false;

/** The active target: the panels card that is on (extra mode) or OPTS.target. */
export function activeTarget() {
  if (UI.mode === 'extra') {
    const cards = [...document.querySelectorAll('#export-panel .ex-card')];
    const i = cards.findIndex(c => c.classList.contains('on'));
    if (i >= 0 && EXPORT_TARGETS[i]) return EXPORT_TARGETS[i].id;
  }
  return OPTS.target;
}

/** Export with the panel options and download the result. */
export async function runExport(target = activeTarget()) {
  if (busy) return;
  busy = true;
  document.body.classList.add('io-busy');
  if (UI.go) UI.go.disabled = true;
  const t0 = performance.now();
  try {
    const blob = await exportPackage(target, { onProgress: setProgress });
    download(blob, blob.fileName);
    const ms = performance.now() - t0;
    C.store.toast(`Exported ${blob.fileName} · ${fmtSize(blob.size)} · ${(ms / 1000).toFixed(1)} s`, 'ok');
    showResult(blob, ms);
  } catch (e) { err(e); setProgress('failed: ' + (e.message || e), 0); }
  finally { busy = false; document.body.classList.remove('io-busy'); if (UI.go) UI.go.disabled = false; }
}

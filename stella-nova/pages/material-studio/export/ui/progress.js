// ============================================================================
//  MATERIAL STUDIO  ·  export/ui/progress.js — export progress and result
// ────────────────────────────────────────────────────────────────────────────
//  setProgress moves the .io-bar fill and writes the stage text.
//  showResult lists the file name, size, res and time of the last export,
//  and one line per package entry. Both do nothing before the UI mounts.
//
//  GREP TARGETS
//      setProgress  showResult  io-res-head
// ============================================================================
import { UI, last } from '../ctx.js';
import { fmtSize } from '../format.js';
import { h } from './dom.js';

export function setProgress(stage, frac) {
  if (!UI.bar) return;
  UI.bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  UI.stage.textContent = stage;
}
export function showResult(blob, ms) {
  if (!UI.result) return;
  UI.result.textContent = '';
  UI.result.append(h('div', { class: 'io-res-head' }, h('b', {}, blob.fileName), ` ${fmtSize(blob.size)} · ${last.res}²${ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}`),
    h('ul', {}, blob.entries.map(e => h('li', {}, h('span', {}, e.name), h('i', {}, fmtSize(e.size))))));
}

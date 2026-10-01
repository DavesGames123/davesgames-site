// ui/keys.js — Mandelbulber page: the keyboard shortcuts and the Panel button.
//
// Esc closes an open full-screen sheet. Outside a text field: P shows or hides the panel,
// F turns fly mode on or off, V frames the view. In fly mode the W A S D Q E keys and
// Shift go into the held-key set that flyStep reads. A window blur clears that set.
//
// grep: function initKeys

import { $, picker, exSheet } from './dom.js';
import { refreshAll } from './controls.js';
import { frameView } from './camera.js';
import { closePicker } from './picker.js';
import { closeExamples } from './preset-sheet.js';
import { togglePanel } from './layout.js';
import { flying, keys, toggleFly } from './fly.js';

export function initKeys() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape' && !picker.classList.contains('hidden')) { closePicker(); return; }
    if (e.key === 'Escape' && !exSheet.classList.contains('hidden')) { closeExamples(); return; }
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (flying && 'wasdqe'.includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); return; }
    if (k === 'shift') { keys.add('shift'); return; }
    if (k === 'p') togglePanel();
    else if (k === 'f') toggleFly();
    else if (k === 'v') frameView(false);
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (!keys.size) refreshAll(); });
  window.addEventListener('blur', () => keys.clear());
  $('toggle').addEventListener('click', togglePanel);
}

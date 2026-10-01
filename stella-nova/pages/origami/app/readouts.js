// app/readouts.js -- the DOM readouts: the status line, the fold percent, the
// control states and the foldability panel.
//
// Copies of one control (bar, sheet, dock) carry the same data-act, so syncUI
// sets every copy from S. syncFold runs each frame and writes only on a change.
// syncCheck writes the badge and the text of the foldability report.
//
// grep map:
//   defaultStatus / setStatus -- the hint text, and the status line write
//   syncFold  -- the fold percent and the fraction sliders, each frame
//   syncUI    -- every control state from S
//   syncCheck -- the foldability badge and report text

import { reportOk } from '../foldability.js';
import { COARSE, $, TOOLS, S } from './state.js';
import { fillThumbs } from './libpanel.js';

// The status line: the hint when nothing is hovered, and a write that skips
// an unchanged text.
export function defaultStatus() {
  return COARSE ? 'One finger draws in the diagram and orbits the fold. Two fingers zoom and pan.'
    : 'Drag in the diagram to draw a crease. Drag the fold to orbit. Wheel zooms, right drag pans.';
}
let statusText = '';
export function setStatus(t) { if (t !== statusText) { statusText = t; $('stMain').textContent = t; } }

// The fold percent last written, so syncFold writes the DOM only on a change.
let lastPct = -1;

export function syncFold() {
  const pct = Math.round(S.fraction * 100);
  if (pct !== lastPct) {
    lastPct = pct;
    document.querySelectorAll('[data-out="pct"]').forEach((el) => { el.textContent = pct + '%'; });
  }
  if (!S.dragFraction) document.querySelectorAll('input[data-act="fraction"]').forEach((el) => { el.value = S.fraction; });
}

export function syncUI() {
  const on = (sel, v) => document.querySelectorAll(sel).forEach((el) => el.classList.toggle('on', v));
  for (const t of Object.keys(TOOLS)) on(`[data-act="tool:${t}"]`, S.tool === t);
  on('[data-act="grid"]', S.showGrid);
  on('[data-act="library"]', S.libraryOpen);
  on('[data-act="play"]', S.auto);
  document.querySelectorAll('[data-act="play"]').forEach((el) => {
    if (el.id === 'dockPlay') { el.textContent = S.auto ? '❚❚' : '▶'; el.setAttribute('aria-label', S.auto ? 'Pause' : 'Play'); }
    else el.textContent = S.auto ? 'PAUSE' : 'PLAY';
  });
  document.querySelectorAll('[data-act="speed"]').forEach((el) => { el.textContent = (S.foldSpeed / 0.3).toFixed(1) + 'x'; });
  for (const m of ['auto', 'h', 'v']) on(`[data-act="layout:${m}"]`, S.layoutMode === m);
  document.querySelectorAll('[data-act="undo"]').forEach((el) => { el.disabled = S.undo.length === 0; });
  document.querySelectorAll('[data-act="redo"]').forEach((el) => { el.disabled = S.redo.length === 0; });
  const cur = S.preset ? 'preset:' + S.preset.id : '';
  document.querySelectorAll('[data-act^="preset:"]').forEach((el) => {
    const v = el.dataset.act === cur;
    el.classList.toggle('on', v);
    if (v) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
  });
  $('library').hidden = !S.libraryOpen;
  if (S.libraryOpen) fillThumbs();
  $('panel').classList.toggle('open', S.panelOpen);
  document.querySelectorAll('[data-act="panel"]').forEach((el) => el.setAttribute('aria-expanded', String(S.panelOpen)));
  on('#dockPanel', S.panelOpen);
}

export function syncCheck() {
  const badge = $('checkBadge'), text = $('checkText');
  const n = S.report.length;
  const bad = S.report.filter((r) => !reportOk(r));
  if (n === 0) {
    badge.className = 'check'; badge.textContent = 'no interior vertices';
    text.innerHTML = 'No interior fold vertex to check yet.';
  } else if (bad.length === 0) {
    badge.className = 'check ok'; badge.textContent = `✓ flat-foldable (local, ${n})`;
    text.innerHTML = `<span class="ok">${n === 1 ? 'The one interior vertex passes' : `All ${n} interior vertices pass`}</span> Maekawa, Kawasaki and Big-Little-Big. These checks are local: they are necessary, not sufficient.`;
  } else {
    badge.className = 'check bad'; badge.textContent = `✕ ${bad.length} of ${n} vertices fail`;
    const rows = bad.slice(0, 8).map((r) => {
      const why = [];
      if (!r.kawasakiOk) why.push(`Kawasaki ${r.kawasakiResidual.toFixed(1)}°`);
      if (r.maekawa !== null && !r.maekawaOk) why.push(`Maekawa ${r.maekawa}`);
      if (r.blbOk === false) why.push('Big-Little-Big');
      return `vertex ${r.vertex}: ${why.join(', ')}`;
    });
    text.innerHTML = `<span class="bad">${bad.length} of ${n} interior vertices fail.</span> Amber rings mark them.<br>` +
      rows.join('<br>') + (bad.length > 8 ? '<br>and more' : '');
  }
}

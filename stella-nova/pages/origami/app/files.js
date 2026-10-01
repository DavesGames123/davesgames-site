// app/files.js -- the file actions: PNG save, FOLD export, FOLD import.
//
// Each action reports its result in the file panel and the status line
// (fileMsg). A download is a temporary object URL on a clicked anchor.
//
// grep map:
//   stamp / download -- the file name time stamp and the download anchor
//   savePng          -- the canvas plus pane frames and labels (main.rs: S)
//   exportFold       -- the pattern as a FOLD file
//   importFold       -- read a FOLD file, fit it when it is outside the unit square
//   fileMsg          -- the file panel and status line message

import { toJson, fromJson } from '../foldio.js';
import * as patterns from '../patterns.js';
import { $, S, gpu } from './state.js';
import { canvas, pane2dEl, pane3dEl, dpr } from './layout.js';
import { render } from './draw.js';
import { pushUndo, rebuild } from './edit.js';
import { setStatus, syncUI } from './readouts.js';

function stamp() { return Math.floor(Date.now() / 1000); }

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Save the current view as a PNG (main.rs: S). The GPU canvas is copied into a
// 2D canvas in the same task as its frame, and the pane frames and labels are
// drawn over it, so the file shows what the native capture shows.
export function savePng() {
  if (!gpu) return;
  render();
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0);
  const c = canvas.getBoundingClientRect();
  g.font = `600 ${11 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
  g.textBaseline = 'top';
  const pct = Math.round(S.fraction * 100);
  for (const [el, label] of [[pane2dEl, 'DIAGRAM  crease pattern'], [pane3dEl, `FOLDED  ${pct}%`]]) {
    const r = el.getBoundingClientRect();
    const x = (r.left - c.left) * dpr, y = (r.top - c.top) * dpr, w = r.width * dpr, h = r.height * dpr;
    g.strokeStyle = '#2a3040'; g.lineWidth = dpr;
    g.beginPath(); g.roundRect(x + 0.5 * dpr, y + 0.5 * dpr, w - dpr, h - dpr, 14 * dpr); g.stroke();
    g.fillStyle = 'rgba(18,21,29,0.85)';
    const tw = g.measureText(label).width;
    g.beginPath(); g.roundRect(x + 10 * dpr, y + 9 * dpr, tw + 20 * dpr, 24 * dpr, 7 * dpr); g.fill();
    g.fillStyle = '#ece4d4'; g.fillText(label, x + 20 * dpr, y + 15 * dpr);
  }
  out.toBlob((b) => { if (b) { download(b, `origami-${stamp()}.png`); fileMsg(`Saved origami-${stamp()}.png`); } }, 'image/png');
}

export function exportFold() {
  const name = `origami-${stamp()}.fold`;
  download(new Blob([toJson(S.pattern)], { type: 'application/json' }), name);
  fileMsg(`Exported ${name}: ${S.pattern.vertices.length} vertices, ${S.pattern.edges.length} creases.`);
}

// Read a FOLD file. A pattern already inside the centred unit square stays as
// it is (a file this page wrote). Anything else is fit like a preset.
export async function importFold(file) {
  try {
    const text = await file.text();
    let cp = fromJson(text);
    if (!cp.vertices.length || !cp.edges.length) throw new Error('the file has no crease pattern');
    const [lo, hi] = cp.bounds();
    const inside = lo[0] >= -0.5001 && lo[1] >= -0.5001 && hi[0] <= 0.5001 && hi[1] <= 0.5001;
    if (!inside) cp = patterns.fromFoldText(text);
    pushUndo();
    S.pattern = cp; S.preset = null;
    S.fraction = 0; S.auto = false;
    rebuild(); syncUI();
    fileMsg(`Loaded ${file.name}: ${cp.vertices.length} vertices, ${cp.edges.length} creases.`);
  } catch (err) {
    fileMsg(`Could not read ${file.name}: ${err.message}`);
  }
}
function fileMsg(t) { $('fileMsg').textContent = t; setStatus(t); }

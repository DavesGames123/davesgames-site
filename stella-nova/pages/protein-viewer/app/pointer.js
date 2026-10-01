// ============================================================================
//  PROTEIN VIEWER  ·  app/pointer.js — canvas pointer: tap, double tap, hover
// ────────────────────────────────────────────────────────────────────────────
//  A short, still pointer press is a tap. A second tap on the same
//  residue in 350 ms focuses it. loop.js calls hoverTick() one time per
//  frame, so the hover pick runs at most one time per frame.
//
//  GREP MAP
//    function onTap                        pick, select or measure
//    function setHover                     the tip and the hover residue
//    function hoverTick                    hover pick from the last mouse move
// ============================================================================
import { $, COARSE, HOVER, esc } from './env.js';
import { S, resLabel } from './state.js';
import { canvas } from './stage.js';
import { paint } from './paint.js';
import { pickAt } from './pick.js';
import { clearSelection, select } from './select.js';
import { addMeasureAtom } from './measure.js';
import { markHoverCell } from './strip.js';
import { focusSelection } from './camera.js';

// ── canvas pointer: tap, double tap, hover ────────────────────────────────
const tip = $('tip');
const downs = new Map();
let multi = false, lastTap = { t: 0, res: -1 };
canvas.addEventListener('pointerdown', e => {
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (downs.size > 1) multi = true;
});
const endPointer = e => {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  if (!d) return;
  const wasMulti = multi;
  if (!downs.size) multi = false;
  if (e.type === 'pointercancel' || wasMulti) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (COARSE ? 10 : 6) || performance.now() - d.t > 600) return;
  onTap(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
function onTap(x, y) {
  const i = pickAt(x, y);
  if (S.measure) { if (i >= 0) addMeasureAtom(i); return; }
  const now = performance.now();
  if (i >= 0) {
    const ri = S.s.atoms[i].res;
    if (now - lastTap.t < 350 && lastTap.res === ri) { focusSelection(); lastTap = { t: 0, res: -1 }; return; }
    lastTap = { t: now, res: ri };
    select(i);
  } else {
    lastTap = { t: 0, res: -1 };
    clearSelection();
  }
}
let mouse = null;
if (HOVER) {
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY, buttons: e.buttons }; } });
  canvas.addEventListener('pointerleave', () => { mouse = null; setHover(-1); });
}
function setHover(atom, x, y) {
  if (atom < 0) { tip.classList.remove('show'); if (S.hoverRes >= 0) { S.hoverRes = -1; paint(); markHoverCell(); } return; }
  const s = S.s, a = s.atoms[atom], r = s.residues[a.res];
  tip.innerHTML = `${esc(r.chainId)}:${esc(resLabel(r))} <i>· ${esc(a.name)}${s.meta.af ? ' · pLDDT ' + a.b.toFixed(0) : ''}</i>`;
  const cr = canvas.getBoundingClientRect();
  tip.style.transform = `translate(${x - cr.left + 14}px,${y - cr.top + 14}px)`;
  tip.classList.add('show');
  if (r.index !== S.hoverRes) { S.hoverRes = r.index; paint(); markHoverCell(); }
}

// hover pick, once a frame, when the mouse is still
export function hoverTick() {
  if (mouse && !mouse.buttons && S.s && !S.measure) {
    const m = mouse; mouse = null;
    const i = pickAt(m.x, m.y, 4);
    setHover(i, m.x, m.y);
  }
}

// ============================================================================
//  PROTEIN VIEWER  ·  app/panel.js — the panel, the phone sheet and its grip
// ────────────────────────────────────────────────────────────────────────────
//  setOpen() opens or closes the panel. On a phone the panel is a bottom
//  sheet, and a drag on the grip makes it full height or closes it.
//
//  GREP MAP
//    function setOpen                      open or close the panel
//    const grip                            the sheet grip gestures
// ============================================================================
import { $, PHONE_Q } from './env.js';
import { dirty } from './state.js';

// ── panel, sheet, dock ────────────────────────────────────────────────────
export const panel = $('panel'), dockPanel = $('dockPanel');
export function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  dockPanel.classList.toggle('on', open);
  dockPanel.setAttribute('aria-expanded', String(open));
  dirty();
}
$('gear').addEventListener('click', () => setOpen(true));
dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  dirty();
});
grip.addEventListener('pointercancel', () => { gripY = null; });

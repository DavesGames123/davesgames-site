// ============================================================================
//  HUMAN SKELETON  ·  app/panel.js — the panel, the phone sheet, the dock
// ────────────────────────────────────────────────────────────────────────────
//  On a wide screen the panel is a side column. On a phone it is a bottom
//  sheet: the grip toggles full height, a drag up opens it to full height,
//  and a drag down closes it. The dock list button opens the panel and
//  scrolls to the selected row. The panel starts open on a wide screen.
//
//  GREP MAP
//    const panel / dockList                          the elements
//    function setOpen                                open or close the panel
//    $('gear') / $('panelClose') / dockList          open and close buttons
//    PHONE_Q.addEventListener                        width changes
//    const grip / let gripY                          the sheet grip
// ============================================================================
import { $, PHONE_Q } from './env.js';
import { S, dirty } from './state.js';
import { rowEls } from './list.js';

export const panel = $('panel');
const dockList = $('dockList');
export function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  dockList.classList.toggle('on', open);
  dockList.setAttribute('aria-expanded', String(open));
  dirty();
}
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
dockList.addEventListener('click', () => {
  const open = !panel.classList.contains('open');
  setOpen(open);
  if (open) requestAnimationFrame(() => {
    const el = S.sel >= 0 ? rowEls.get(S.sel) : $('bonesLabel');
    if (el) el.scrollIntoView({ block: S.sel >= 0 ? 'center' : 'start' });
  });
});
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

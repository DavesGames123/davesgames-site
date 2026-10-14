// ============================================================================
//  STEM SPLITTER  ·  ui/sheet.js — phone test and the settings bottom sheet
// ----------------------------------------------------------------------------
//  The phone layout (CONTRACT 6.3) is the wave-membrane dock/sheet pattern.
//  The CSS media query in style.css (PHONE) moves the settings section into
//  a bottom sheet over the dock. This module only opens and closes it:
//    - the dock button toggles the class "open" and aria-expanded,
//    - a drag down on the grip of more than 60 px closes it,
//    - Escape closes it.
//  On a desktop the sheet classes have no effect, because the settings
//  section is an inline column there.
//
//  GREP MAP
//    PHONE_Q ........... the media query (same as style.css PHONE)
//    isPhoneLayout ..... true when PHONE_Q matches
//    createSheet ....... { open, close, toggle, isOpen, destroy }
// ============================================================================

export const PHONE_Q = '(max-width: 699px), (pointer: coarse)';

export function isPhoneLayout(win = globalThis) {
  try { return !!(win.matchMedia && win.matchMedia(PHONE_Q).matches); } catch (e) { return false; }
}

export function createSheet(sheet, { button = null, grip = null, doc = globalThis.document, onChange = null } = {}) {
  let open = false;
  function set(v) {
    open = !!v;
    sheet.classList.toggle('open', open);
    if (button) { button.setAttribute('aria-expanded', String(open)); button.classList.toggle('on', open); }
    if (onChange) onChange(open);
  }
  const onBtn = () => set(!open);
  const onKey = e => { if (open && e.key === 'Escape') set(false); };
  let y0 = null;
  const onDown = e => { y0 = e.clientY; if (grip.setPointerCapture && e.pointerId !== undefined) try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } };
  const onMove = e => { if (y0 !== null && e.clientY - y0 > 60) { y0 = null; set(false); } };
  const onUp = () => { y0 = null; };
  if (button) button.addEventListener('click', onBtn);
  if (grip) { grip.addEventListener('pointerdown', onDown); grip.addEventListener('pointermove', onMove); grip.addEventListener('pointerup', onUp); grip.addEventListener('pointercancel', onUp); grip.addEventListener('click', () => set(false)); }
  if (doc) doc.addEventListener('keydown', onKey);
  set(false);
  return {
    open: () => set(true), close: () => set(false), toggle: onBtn,
    isOpen: () => open,
    destroy() {
      if (button) button.removeEventListener('click', onBtn);
      if (doc) doc.removeEventListener('keydown', onKey);
    },
  };
}

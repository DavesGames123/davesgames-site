// ============================================================================
//  EM EXPLORER  ·  ui/sheet.js — the panel: side card, bottom sheet, drawer
// ----------------------------------------------------------------------------
//  One element (#panel) has three forms. style.css picks the form, and this
//  file only sets classes, so the forms stay in one place:
//    desktop          a card on the left; #panelClose and #panelOpen
//    phone portrait   a bottom sheet above #dock (the wave-membrane pattern):
//                     .open shows it at half height, .full at full height;
//                     #sheetGrip: a tap toggles half and full, a drag down
//                     closes it or goes from full to half, a drag up goes full
//    phone landscape  a drawer on the right edge
//  The panel has tabs (places, data, image). A dock button opens the sheet on
//  its tab. A second tap on the button of the open tab closes the sheet.
//
//  createPanel(els, { onChange }) -> { open(tab), close(), toggle(tab),
//  showTab(tab), get tab, get isOpen }. onChange({ open, full, tab }) runs
//  after each change (main.js gives the viewer new insets then).
//
//  grep -n targets
//    tabs ............ "function showTab"
//    open and close .. "function setOpen"
//    grip drag ....... "function bindGrip"
// ============================================================================

export const TABS = ['places', 'data', 'image'];

export function createPanel(els, { onChange = () => {} } = {}) {
  const { panel, grip, closeBtn, openBtn, dock } = els;
  let tab = 'places', isOpen = panel.classList.contains('open'), full = false;

  const emit = () => { try { onChange({ open: isOpen, full, tab }); } catch (e) { /* page handler */ } };

  function syncButtons() {
    panel.querySelectorAll('[role=tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (dock) dock.querySelectorAll('[data-tab]').forEach((b) => {
      const on = isOpen && b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-expanded', String(on));
    });
    if (openBtn) openBtn.hidden = isOpen;
    document.body.classList.toggle('panel-closed', !isOpen);
  }

  function showTab(t) {
    if (!TABS.includes(t)) return;
    tab = t;
    for (const name of TABS) {
      const sec = panel.querySelector('#tab-' + name);
      if (sec) sec.hidden = name !== t;
    }
    syncButtons();
  }

  function setOpen(open, nextFull = false) {
    isOpen = !!open;
    full = isOpen && !!nextFull;
    panel.classList.toggle('open', isOpen);
    panel.classList.toggle('full', full);
    panel.setAttribute('aria-hidden', String(!isOpen));
    if ('inert' in panel) panel.inert = !isOpen;
    syncButtons();
    emit();
  }

  function bindGrip() {
    if (!grip) return;
    let y0 = null, moved = 0;
    grip.addEventListener('pointerdown', (e) => {
      y0 = e.clientY; moved = 0;
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
      panel.classList.add('dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      moved = e.clientY - y0;
      // follow the finger down only; up is a snap to full
      panel.style.transform = moved > 0 ? `translateY(${moved}px)` : '';
    });
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      panel.classList.remove('dragging');
      panel.style.transform = '';
      if (Math.abs(moved) < 8) setOpen(true, !full);
      else if (moved > 60) { if (full) setOpen(true, false); else setOpen(false); }
      else if (moved < -40) setOpen(true, true);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true, !full); }
    });
  }

  panel.querySelectorAll('[role=tab]').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(b.dataset.tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        showTab(n);
        const nb = panel.querySelector(`[role=tab][data-tab="${n}"]`);
        if (nb) nb.focus();
      }
    });
  });
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
  if (openBtn) openBtn.addEventListener('click', () => setOpen(true));
  if (dock) dock.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => api.toggle(b.dataset.tab)));
  bindGrip();

  const api = {
    open(t) { if (t) showTab(t); setOpen(true, full); },
    close() { setOpen(false); },
    toggle(t) { if (isOpen && (!t || t === tab)) setOpen(false); else api.open(t); },
    showTab,
    get tab() { return tab; },
    get isOpen() { return isOpen; },
    get isFull() { return full; },
  };
  showTab(tab);
  setOpen(isOpen);
  return api;
}

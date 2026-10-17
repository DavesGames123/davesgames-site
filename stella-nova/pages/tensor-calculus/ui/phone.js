// ============================================================================
//  TENSOR CALCULUS  ·  ui/phone.js  ·  dock, sheet and view swipe  (CORE)
// ----------------------------------------------------------------------------
//  The pattern of pages/wave-membrane. PHONE_QUERY matches the CSS block
//  "PHONE" in style.css.
//    #panel   portrait: a bottom sheet over the dock. A tap on #sheetGrip
//             switches half and full height; a drag up gives full height;
//             a drag down gives half height, then closes. Landscape: a
//             drawer at the right edge.
//    #stage   the views on screen sit in one row, each one screen wide,
//             with CSS scroll snap, so a swipe moves to the next view. The
//             3D canvas keeps its own drags (touch-action: none), so the
//             reader swipes on the pane header or uses the dock buttons.
//    #swipeDots  one dot for each view on screen; the dot of the view in
//             sight is on.
//  On a desktop none of this runs: the panel is a column and the stage a
//  grid (ui/layout.js).
//
//  EXPORTS   (grep -n "export" ui/phone.js)
//      PHONE_QUERY, createPhone(els, deps) -> { isPhone(), setOpen(open),
//        isOpen(), scrollToView(v, smooth), currentView(), syncDots() }
// ============================================================================

export const PHONE_QUERY = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';

// els: { panel, dockPanel, grip, stage, dots, panes: { tex, viz, diagram } }
// deps: { onView(view), onOpen(open), views() -> [view ids on screen] }
export function createPhone(els, deps) {
  const win = els.stage.ownerDocument.defaultView;
  const mq = win.matchMedia ? win.matchMedia(PHONE_QUERY) : { matches: false, addEventListener() {} };
  let current = null;

  function setOpen(open) {
    els.panel.classList.toggle('open', open);
    if (!open) els.panel.classList.remove('full');
    els.panel.ownerDocument.body.classList.toggle('panel-closed', !open);
    if (els.dockPanel) { els.dockPanel.classList.toggle('on', open); els.dockPanel.setAttribute('aria-expanded', String(open)); }
    if (deps.onOpen) deps.onOpen(open);
  }

  // ---- sheet grip
  if (els.grip) {
    let y0 = null;
    els.grip.addEventListener('pointerdown', e => { y0 = e.clientY; try { els.grip.setPointerCapture(e.pointerId); } catch (x) { /* old engines */ } });
    els.grip.addEventListener('pointerup', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      if (Math.abs(dy) < 8) els.panel.classList.toggle('full');
      else if (dy < -40) els.panel.classList.add('full');
      else if (dy > 40) { if (els.panel.classList.contains('full')) els.panel.classList.remove('full'); else setOpen(false); }
    });
    els.grip.addEventListener('pointercancel', () => { y0 = null; });
  }
  if (els.dockPanel) els.dockPanel.addEventListener('click', () => setOpen(!els.panel.classList.contains('open')));

  // ---- swipe between views (scroll snap) and the dots
  function onScreen() { return deps.views(); }
  function syncDots() {
    if (!els.dots) return;
    const views = onScreen();
    const doc = els.dots.ownerDocument;
    if (els.dots.childElementCount !== views.length) {
      els.dots.replaceChildren(...views.map(() => doc.createElement('span')));
    }
    [...els.dots.children].forEach((d, k) => d.classList.toggle('on', views[k] === current));
    els.dots.hidden = !mq.matches || views.length < 2;
  }
  function measure() {
    if (!mq.matches) return;
    const views = onScreen();
    const w = els.stage.clientWidth || 1;
    const k = Math.min(views.length - 1, Math.max(0, Math.round(els.stage.scrollLeft / w)));
    const v = views[k];
    if (v !== current) { current = v; syncDots(); if (deps.onView) deps.onView(v); }
  }
  let raf = 0;
  els.stage.addEventListener('scroll', () => { if (!raf) raf = win.requestAnimationFrame(() => { raf = 0; measure(); }); }, { passive: true });

  function scrollToView(v, smooth = true) {
    const views = onScreen();
    const k = views.indexOf(v);
    if (k < 0) return false;
    current = v;
    if (mq.matches) {
      const left = k * els.stage.clientWidth;
      try { els.stage.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { els.stage.scrollLeft = left; }
    }
    syncDots();
    return true;
  }

  const api = {
    isPhone: () => !!mq.matches,
    setOpen,
    isOpen: () => els.panel.classList.contains('open'),
    scrollToView,
    currentView: () => current || onScreen()[0],
    syncDots,
  };
  setOpen(!mq.matches);
  const onChange = e => { setOpen(!e.matches); syncDots(); if (deps.onPhone) deps.onPhone(e.matches); };
  if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  syncDots();
  return api;
}

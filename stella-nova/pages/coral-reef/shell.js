// ============================================================================
//  CORAL REEF  ·  the page shell: dock, sheet, drawer, explainer (DOM only)
// ----------------------------------------------------------------------------
//  No three.js and no world here, so mobile-check.mjs runs this module in
//  jsdom at each phone viewport. main.js gives the callbacks.
//
//  DOCK (phone). Five one-tap buttons: #dockCam (the camera: follow, orbit,
//  swim), #dockFeed (the next ROV on the camera feed), #dockMode (the next
//  colour mode), #dockSeed (a new world) and #dockMenu (the sheet with all
//  the other controls). There is no growth control: the corals grew once
//  and are just there (CONTRACT-V4.md).
//
//  SHEET. In portrait the panel is a bottom sheet above the dock. The grip
//  (#sheetGrip) drags it between half height, full height and closed
//  (layout.js sheetSnap). In landscape the panel is a drawer at the right
//  edge with a close button. On a desktop the panel is at the left.
//
//  FEED. #feed is the SSTV camera card of the lead ROV (the ROV package
//  draws its canvas into #feedSlot). A tap on the card (#feedSize, a
//  button over it) makes it large or small again: on a phone the card is
//  small above the dock, so a tap shows the picture at full width.
//
//  GREP MAP
//    grep -n 'function setFeedBig'  the feed card size
//    grep -n 'function setOpen'     open or close the panel, sheet state
//    grep -n 'function setDock'     the dock labels
//    grep -n 'function bindGrip'    the sheet grip drag
//    grep -n 'function openAbout'   the explainer sheet
// ============================================================================
import { sheetSnap } from './layout.js';

export function mountShell({ doc = document, phoneQ, on = {} }) {
  const $ = id => doc.getElementById(id);
  const panel = $('panel'), body = doc.body, about = $('about');
  const st = { open: false, sheet: 'closed', about: false, feedBig: false };
  const call = (k, ...a) => { if (typeof on[k] === 'function') on[k](...a); };

  // sheet: 'half' | 'full' (phone portrait). A closed panel is 'closed'.
  function setOpen(open, sheet) {
    st.open = !!open;
    st.sheet = !st.open ? 'closed' : sheet || (st.sheet === 'closed' ? 'half' : st.sheet);
    panel.classList.toggle('open', st.open);
    panel.classList.toggle('full', st.sheet === 'full');
    panel.style.transform = '';
    body.classList.toggle('panel-closed', !st.open);
    const m = $('dockMenu');
    if (m) { m.classList.toggle('on', st.open); m.setAttribute('aria-expanded', String(st.open)); }
    call('open', st.open);
  }

  // The dock labels: { cam, feed, mode } (text of each button)
  function setDock(o = {}) {
    const put = (id, t) => { const e = $(id); if (e && t != null) e.textContent = t; };
    put('dockCamName', o.cam); put('dockFeedName', o.feed); put('dockModeName', o.mode);
  }

  function setFeedBig(v) {
    st.feedBig = !!v;
    const f = $('feed'), b = $('feedSize');
    if (f) f.classList.toggle('big', st.feedBig);
    if (b) { b.setAttribute('aria-pressed', String(st.feedBig)); b.setAttribute('aria-label', st.feedBig ? 'Make the camera feed smaller' : 'Make the camera feed larger'); }
    call('feed', st.feedBig);
  }

  // The grip: the sheet follows the finger down, then snaps on release.
  function bindGrip() {
    const grip = $('sheetGrip'); if (!grip) return;
    let y0 = null;
    grip.addEventListener('pointerdown', e => {
      y0 = e.clientY;
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    });
    grip.addEventListener('pointermove', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      panel.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    });
    grip.addEventListener('pointerup', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      const next = sheetSnap(st.sheet, dy);
      if (next === 'closed') setOpen(false); else setOpen(true, next);
    });
    grip.addEventListener('pointercancel', () => { y0 = null; panel.style.transform = ''; });
  }

  function openAbout() {
    about.hidden = false; st.about = true;
    if (phoneQ.matches) setOpen(false);
    about.scrollTop = 0;
    call('about', true);
    const c = $('aboutClose'); if (c && c.focus) c.focus();
  }
  function closeAbout() {
    if (!st.about) return;
    about.hidden = true; st.about = false;
    call('about', false);
  }

  // ── bind ────────────────────────────────────────────────────────────────
  const click = (id, f) => { const el = $(id); if (el) el.addEventListener('click', f); };
  click('gear', () => setOpen(true));
  click('panelClose', () => setOpen(false));
  click('dockMenu', () => setOpen(!st.open));
  click('dockCam', () => call('cam'));
  click('dockFeed', () => call('feedNext'));
  click('dockMode', () => call('mode'));
  click('dockSeed', () => call('seed'));
  click('feedSize', () => setFeedBig(!st.feedBig));
  click('aboutOpen', openAbout);
  click('aboutClose', closeAbout);
  doc.defaultView.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (st.about) closeAbout(); else if (st.feedBig) setFeedBig(false); else if (phoneQ.matches && st.open) setOpen(false);
  });
  bindGrip();

  setOpen(!phoneQ.matches);
  const onQ = e => { setOpen(!e.matches); };
  if (phoneQ.addEventListener) phoneQ.addEventListener('change', onQ);
  else if (phoneQ.addListener) phoneQ.addListener(onQ);

  return {
    st, setOpen, setDock, setFeedBig, openAbout, closeAbout,
    get open() { return st.open; }, get sheet() { return st.sheet; },
  };
}

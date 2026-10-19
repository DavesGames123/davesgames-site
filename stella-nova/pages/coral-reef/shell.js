// ============================================================================
//  CORAL REEF  ·  the page shell: dock, sheet, drawer, explainer (DOM only)
// ----------------------------------------------------------------------------
//  No three.js and no world here, so mobile-check.mjs runs this module in
//  jsdom at each phone viewport. main.js gives the callbacks.
//
//  DOCK (phone). Five one-tap buttons: #dockCam (the camera: follow, orbit,
//  swim), #dockFeed (the next ROV on the camera feed), #dockMode (the next
//  colour mode), #dockPlant (plant mode on or off: a tap on the rock plants
//  a colony, world/plant.js; the species is in the Explore section) and
//  #dockMenu (the sheet with all the other controls). New world is in the
//  World section of the sheet. The world corals grew once and are just
//  there (CONTRACT-V4.md); only a planted colony grows in.
//
//  SHEET. lib/sn-panel.js mountSheet opens and closes the panel. In
//  portrait the panel is a bottom sheet above the dock. The grip
//  (#sheetGrip) drags it between half height, full height and closed
//  (sheetSnap). In landscape the panel is a drawer at the right edge with
//  a close button. On a desktop the panel is at the left; #gear opens it
//  again. The sections and controls come from main.js buildUI (sn-panel).
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
//    grep -n 'mountSheet'           the panel open state, the grip drag
//    grep -n 'function openAbout'   the explainer sheet
// ============================================================================
import { mountSheet, fillIcons } from '../../lib/sn-panel.js';

export function mountShell({ doc = document, phoneQ, on = {} }) {
  const $ = id => doc.getElementById(id);
  const panel = $('panel'), body = doc.body, about = $('about');
  const st = { open: false, sheet: 'closed', about: false, feedBig: false };
  const call = (k, ...a) => { if (typeof on[k] === 'function') on[k](...a); };

  fillIcons(doc);
  // sheet: 'half' | 'full' (phone portrait). A closed panel is 'closed'.
  const sheet = mountSheet({
    panel, grip: $('sheetGrip'), menu: $('dockMenu'), close: $('panelClose'), gear: $('gear'), phoneQ, doc,
    onOpen: (open, s) => { st.open = open; st.sheet = s; call('open', open); },
  });
  const setOpen = (open, s) => sheet.setOpen(open, s);

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
  click('dockCam', () => call('cam'));
  click('dockFeed', () => call('feedNext'));
  click('dockMode', () => call('mode'));
  click('dockPlant', () => call('plant'));
  click('feedSize', () => setFeedBig(!st.feedBig));
  click('aboutOpen', openAbout);
  click('aboutClose', closeAbout);
  doc.defaultView.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (st.about) closeAbout(); else if (st.feedBig) setFeedBig(false); else if (phoneQ.matches && st.open) setOpen(false);
  });

  return {
    st, setOpen, setDock, setFeedBig, openAbout, closeAbout,
    get open() { return sheet.open; }, get sheet() { return sheet.sheet; },
  };
}

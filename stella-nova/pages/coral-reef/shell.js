// ============================================================================
//  CORAL REEF  ·  the page shell: dock, sheet, drawer, explainer (DOM only)
// ----------------------------------------------------------------------------
//  No three.js and no reef here, so mobile-check.mjs runs this module in
//  jsdom at each phone viewport. main.js gives the callbacks.
//
//  DOCK (phone). Five one-tap buttons: #dockPreset (the next reef preset),
//  #dockPlay (grow or pause), #dockRegrow, #dockPlant (plant mode) and
//  #dockMenu (the sheet with all the other controls).
//
//  SHEET. In portrait the panel is a bottom sheet above the dock. The grip
//  (#sheetGrip) drags it between half height, full height and closed
//  (layout.js sheetSnap). In landscape the panel is a drawer at the right
//  edge with a close button. On a desktop the panel is at the left.
//
//  PLANT MODE. A tap on the seabed plants a colony only in plant mode, so
//  a tap does not fight the orbit. body.planting shows #plantBar (phone:
//  the species chips and the last result) and a crosshair cursor.
//
//  GREP MAP
//    grep -n 'function setOpen'     open or close the panel, sheet state
//    grep -n 'function setPlant'    plant mode on or off
//    grep -n 'function setPlaying'  the grow and pause labels
//    grep -n 'function bindGrip'    the sheet grip drag
//    grep -n 'function openAbout'   the explainer sheet
// ============================================================================
import { sheetSnap } from './layout.js';

export function mountShell({ doc = document, phoneQ, plant = false, on = {} }) {
  const $ = id => doc.getElementById(id);
  const panel = $('panel'), body = doc.body, about = $('about');
  const st = { open: false, sheet: 'closed', plant: false, playing: true, about: false };
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

  function setPlant(v) {
    st.plant = !!v;
    body.classList.toggle('planting', st.plant);
    for (const id of ['dockPlant', 'tPlant']) {
      const b = $(id); if (!b) continue;
      b.classList.toggle('on', st.plant); b.setAttribute('aria-pressed', String(st.plant));
    }
    const bar = $('plantBar'); if (bar) bar.hidden = !st.plant;
    call('plant', st.plant);
  }

  function setPlaying(p) {
    st.playing = !!p;
    const b = $('bPlay'), d = $('dockPlay');
    if (b) { b.textContent = p ? '❚❚ Pause' : '▶ Grow'; b.classList.toggle('on', st.playing); }
    if (d) {
      d.innerHTML = p ? '<i>❚❚</i><span>Pause</span>' : '<i>▶</i><span>Grow</span>';
      d.setAttribute('aria-label', p ? 'Pause the growth' : 'Grow');
      d.classList.toggle('on', !st.playing);
    }
  }

  function setPresetLabel(text) { const s = $('dockPresetName'); if (s) s.textContent = text; }

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
  click('dockPreset', () => call('preset'));
  click('dockPlay', () => call('play'));
  click('dockRegrow', () => call('regrow'));
  click('dockPlant', () => { setPlant(!st.plant); if (st.plant && phoneQ.matches) setOpen(false); });
  click('tPlant', () => setPlant(!st.plant));
  click('plantDone', () => setPlant(false));
  click('aboutOpen', openAbout);
  click('aboutClose', closeAbout);
  doc.defaultView.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (st.about) closeAbout(); else if (phoneQ.matches && st.open) setOpen(false);
  });
  bindGrip();

  // The dlaf parameters: an advanced section, closed on a phone.
  const adv = $('adv'); if (adv) adv.open = !phoneQ.matches;
  setOpen(!phoneQ.matches);
  setPlant(plant);
  const onQ = e => { setOpen(!e.matches); if (adv) adv.open = !e.matches; };
  if (phoneQ.addEventListener) phoneQ.addEventListener('change', onQ);
  else if (phoneQ.addListener) phoneQ.addListener(onQ);

  return {
    st, setOpen, setPlant, setPlaying, setPresetLabel, openAbout, closeAbout,
    get open() { return st.open; }, get plant() { return st.plant; }, get sheet() { return st.sheet; },
  };
}

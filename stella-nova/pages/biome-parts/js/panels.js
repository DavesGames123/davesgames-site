// ============================================================================
//  BIOME PARTS  ·  panels.js — the workspace: rail, panels, menu, sheets
// ----------------------------------------------------------------------------
//  The layout of a modelling tool, after Forge in Warp and SDF Forge: the 3D
//  view fills the page and squircle panels float over it. Each panel unfolds
//  from the button that opened it (lib/forge-ui.js unfold), and a close runs
//  the same move back into the button.
//
//  DESKTOP. The left rail opens the library and the goal (left column) and
//  the inspector (right column). The timeline at the base holds the transport
//  and the scrubber; the log is a console drawer above it. The export button
//  grows into its menu.
//
//  PHONE (narrow, or a short touch screen). The dock (#tabs) opens one panel
//  at a time as a bottom sheet. The stage shrinks to the clear area above the
//  sheet, so the part stays in view while a control changes it; onLayout
//  lets main.js frame the part again.
//
//  GREP MAP
//    PANELS / TAB ........ the panel ids and the dock names
//    open / close / toggle the unfold, one panel
//    tab ................. a dock button; 'how' scrolls to the explainer
//    menu ................ the export menu
//    setMode ............. phone or desktop, from the media query
//    keys ................ L G I C E H Escape
// ============================================================================
import { unfold, reducedMotion } from '../../../lib/forge-ui.js';

export const PANELS = ['libPanel', 'goalPanel', 'brainPanel', 'console'];
const SHEETS = ['libPanel', 'goalPanel', 'brainPanel'];
const TAB = { lib: 'libPanel', goal: 'goalPanel', brain: 'brainPanel', tree: 'brainPanel', log: 'console' };
const DESK_DEFAULT = { libPanel: true, goalPanel: true, brainPanel: true, console: false };
export const PHONE_QUERY = '(max-width: 760px), (max-height: 520px) and (pointer: coarse)';

export function createWorkspace({ $, onLayout = () => {} }) {
  const app = $('app');
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;
  let phone = false, tabName = 'goal';
  const openers = id => [...document.querySelectorAll(`[data-open="${id}"]`)];
  const visible = e => !!(e && e.getClientRects && e.getClientRects().length);
  const isOpen = id => !$(id).hidden && !$(id)._closing;
  const dockBtn = () => (phone ? [...$('tabs').children].find(b => b.dataset.tab === tabName) : null);

  function measure() {
    const tl = $('timeline'), top = $('top');
    if (tl) app.style.setProperty('--tl-h', (tl.offsetHeight || 64) + 'px');
    if (top && !phone) app.style.setProperty('--col-top', ((top.offsetHeight || 60) + 26) + 'px');
  }
  function sync() {
    for (const id of PANELS) for (const b of openers(id)) { b.classList.toggle('on', isOpen(id)); b.setAttribute('aria-expanded', String(isOpen(id))); }
    const sheet = phone && SHEETS.some(isOpen);
    app.classList.toggle('sheet-open', sheet);
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tabName && (TAB[tabName] ? isOpen(TAB[tabName]) : false));
    app.dataset.tab = tabName;
    measure();
  }
  function after(p) { sync(); onLayout(); return p.then(() => { measure(); onLayout(); }); }

  function open(id, from = null) {
    const e = $(id);
    if (phone) {
      if (SHEETS.includes(id)) for (const o of SHEETS) if (o !== id && isOpen(o)) { $(o).hidden = true; $(o).classList.remove('is-open'); }
    }
    const src = from || openers(id).find(visible) || dockBtn() || null;
    return after(unfold(e, { open: true, from: src, radius: 14 }));
  }
  function close(id, from = null) {
    const src = from || openers(id).find(visible) || dockBtn() || null;
    return after(unfold($(id), { open: false, from: src, radius: 14 }));
  }
  function toggle(id, from = null) { return isOpen(id) ? close(id, from) : open(id, from); }

  function how() {
    menu(false);
    const ex = $('explain');
    if (ex && ex.scrollIntoView) ex.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  function tab(name) {
    if (name === 'how') { how(); return; }
    const id = TAB[name];
    if (!id) return;
    const same = tabName === name && isOpen(id);
    tabName = name;
    if (same) { close(id); return; }
    if (name === 'tree') { const f = $('foldTree'); if (f) f.open = true; }
    open(id, dockBtn()).then(() => {
      if (name === 'tree' || name === 'brain') {
        const t = $(name === 'tree' ? 'foldTree' : 'foldScores');
        if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    });
  }

  // the export button grows into its menu
  function menu(want) {
    const m = $('expMenu'), b = $('expBtn');
    const o = want ?? (m.hidden || m._closing);
    if (o === (!m.hidden && !m._closing)) return Promise.resolve();
    b.setAttribute('aria-expanded', String(o)); b.classList.toggle('on', o);
    return unfold(m, { open: o, from: b, radius: 12 });
  }

  function setMode() {
    const was = phone;
    phone = !!(mq && mq.matches);
    app.classList.toggle('phone', phone);
    document.body.classList.toggle('phone', phone);
    if (phone && !was) for (const id of SHEETS) { $(id).hidden = true; $(id).classList.remove('is-open'); }
    if (!phone && (was || !setMode.done)) for (const id of PANELS) { $(id).hidden = !DESK_DEFAULT[id]; $(id).classList.toggle('is-open', DESK_DEFAULT[id]); }
    setMode.done = true;
    sync(); onLayout();
  }

  // wiring
  for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => { if (b.dataset.open === 'console') tabName = 'log'; toggle(b.dataset.open, b); });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => close(b.dataset.close));
  for (const b of $('tabs').children) b.addEventListener('click', () => tab(b.dataset.tab));
  $('howBtn').addEventListener('click', how);
  $('expBtn').addEventListener('click', e => { e.stopPropagation(); menu(); });
  document.addEventListener('pointerdown', e => {
    const m = $('expMenu');
    if (!m.hidden && !m.contains(e.target) && !$('expBtn').contains(e.target)) menu(false);
  });
  $('tuneBtn').addEventListener('click', () => {
    const t = $('transport'), o = !t.classList.contains('more');
    t.classList.toggle('more', o); $('tuneBtn').setAttribute('aria-expanded', String(o)); measure(); onLayout();
  });
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', setMode); else if (mq.addListener) mq.addListener(setMode); }
  window.addEventListener('resize', measure);
  setMode();

  function keys(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') {
      if (!$('expMenu').hidden) { menu(false); return true; }
      const top = phone ? SHEETS.find(isOpen) : null;
      if (top) { close(top); return true; }
      if (isOpen('console')) { close('console'); return true; }
      return false;
    }
    const map = { l: 'lib', g: 'goal', i: 'brain', c: 'log' };
    if (map[k]) { if (phone) tab(map[k]); else { tabName = map[k]; toggle(TAB[map[k]]); } return true; }
    if (k === 'e') { menu(); return true; }
    if (k === 'h' || k === '?') { how(); return true; }
    return false;
  }

  return { open, close, toggle, isOpen, tab, menu, keys, measure, setMode, get phone() { return phone; } };
}

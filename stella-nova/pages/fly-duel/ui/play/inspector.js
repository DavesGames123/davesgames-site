// ============================================================================
//  FLY DUEL  ·  play mode, the card inspector  (ES module, DOM)
// ----------------------------------------------------------------------------
//  The user (2026-10-12, verbatim): "wehen i focus on a card it sholdnt
//  be the only thing availabe in the iterface".
//
//  A NON-MODAL side panel for one card: the card face (layout.zoom at
//  most, focusPlace of ui/cardzoom.js), then the keyword reminders, the
//  state of the permanent (damage, pump, tapped, entered this turn) and
//  the picture credit. The panel has no veil, no full-screen box and no
//  click-catcher. It takes no pointer events, except its Close button
//  (44 px). The board, the hand, the buttons, the menu, the brain panels
//  and the camera stay usable under and around it. Focus stays where it
//  is. A left click on the board goes to the board.
//
//  WHERE  The side of the play box away from the pointer that focused
//  the card (the last pointer on the page), under the scorecards
//  (.pl-cards) and above the phase bar, the buttons and the hand
//  (.pl-bar, .pl-actions, .pl-handbox). A phone gets a compact card
//  docked at the top (data-dock).
//
//  CLOSE  The Close button. Escape (ui/play/play.js onKey). A mouse
//  right-click anywhere that does not focus a card (a right-click on a
//  card changes the panel to that card). Another card focused: open()
//  changes the panel.
//
//  CSS  style.css FOCUS (.pl-insp.pl-focus): it overrides the old modal
//  .pl-insp rule of play.css. The inline style of the element keeps the
//  non-modal parts (no veil, no inset box, pointer-events none) also on a
//  page without style.css (ui/play/dev.html).
//
//  GREP MAP
//      grep -n 'export function createInspector'
//      grep -n 'function permLines'   state lines of a permanent
//      grep -n 'function bandsOf'     the bands to keep clear
//      grep -n 'function place'       focusPlace in the play box
//      grep -n 'const onMenu'         right-click elsewhere closes
// ============================================================================
import { paintCard } from './canvas.js';
import * as CF from '../cardface.js';
import { focusPlace } from '../cardzoom.js';

function permLines(x) {
  if (!x) return [];
  const out = [];
  if (x.tapped) out.push('Tapped.');
  if (x.sick) out.push('Entered this turn: it cannot attack yet (unless swift).');
  if (x.dmg) out.push(`${x.dmg} damage marked this turn.`);
  if (x.pp || x.pt) out.push(`+${x.pp | 0}/+${x.pt | 0} until end of turn.`);
  if (x.pc) out.push(`+${x.pc}/+${x.pc} from growth (lasting).`);
  return out;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The inline style that keeps the panel non-modal whatever the CSS says.
const BASE = 'position:absolute;inset:auto;right:auto;bottom:auto;padding:0;background:transparent;overflow:visible;pointer-events:none;z-index:125';

export function createInspector(host, { KEYWORDS = {}, top = ['.pl-cards'], bottom = ['.pl-bar', '.pl-actions', '.pl-handbox'] } = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView || globalThis;
  const el = doc.createElement('div');
  el.className = 'pl-insp pl-focus';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Focused card');
  el.style.cssText = BASE;
  el.innerHTML = `<div class="pl-insp-in"><canvas class="pl-cv"></canvas><div class="pl-insp-txt"></div><button type="button" class="pl-btn pl-insp-x" aria-label="Close the focused card">Close</button></div>`;
  host.appendChild(el);
  const cv = el.querySelector('canvas');
  const txt = el.querySelector('.pl-insp-txt');
  const x = el.querySelector('.pl-insp-x');
  x.style.pointerEvents = 'auto';
  let ptr = null, ptrType = '', last = null;
  const close = () => { if (el.hidden) return; el.hidden = true; last = null; delete el.dataset.id; };
  x.addEventListener('click', e => { e.stopPropagation?.(); close(); });

  // the last pointer on the page: the panel goes on the other side
  const onPtr = e => { if (el.isConnected === false) { off(); return; } if (Number.isFinite(e.clientX)) ptr = { x: e.clientX, y: e.clientY }; if (e.type === 'pointerdown') ptrType = e.pointerType || ''; };
  // a right-click that comes up to the page with no card focused on the
  // way closes the panel. A card handler that focuses a card calls open()
  // in the same event: open() sets fresh until the next task, so that
  // right-click keeps the panel. A touch hold (Android contextmenu) does
  // not close.
  let fresh = false, freshT = 0;
  const onMenu = e => {
    onPtr(e);
    if (el.hidden || fresh) return;
    if (ptrType === 'touch' || e.pointerType === 'touch') return;
    e.preventDefault();
    close();
  };
  // play.js removes the play root on destroy: the listeners then go too
  function off() {
    doc.removeEventListener('pointerdown', onPtr, true);
    doc.removeEventListener('pointermove', onPtr, { capture: true, passive: true });
    doc.removeEventListener('contextmenu', onMenu);
  }
  doc.addEventListener('pointerdown', onPtr, true);
  doc.addEventListener('pointermove', onPtr, { capture: true, passive: true });
  doc.addEventListener('contextmenu', onMenu);

  const boxOf = n => { try { return n?.getBoundingClientRect?.() || null; } catch { return null; } };
  // the bands of the play box to keep clear (px from its top and bottom)
  function bandsOf(o) {
    let t = 0, b = 0;
    if (!o) return { top: 0, bottom: 0 };
    for (const s of top) for (const n of host.querySelectorAll?.(s) || []) {
      const r = boxOf(n);
      if (!n.hidden && r && r.height > 0 && r.top - o.top < o.height / 2) t = Math.max(t, r.bottom - o.top);
    }
    for (const s of bottom) for (const n of host.querySelectorAll?.(s) || []) {
      const r = boxOf(n);
      if (!n.hidden && r && r.height > 0 && r.bottom - o.top > o.height / 2) b = Math.max(b, o.bottom - r.top);
    }
    return { top: t, bottom: b };
  }
  function place(L) {
    const o = boxOf(host);
    const has = o && o.width > 0 && o.height > 0;
    const vw = has ? o.width : (host.clientWidth || win.innerWidth || 390);
    const vh = has ? o.height : (host.clientHeight || win.innerHeight || 844);
    const p = ptr ? { x: ptr.x - (has ? o.left : 0), y: ptr.y - (has ? o.top : 0) } : null;
    const bands = bandsOf(has ? o : null);
    const fit = P => {
      // never larger than layout.zoom
      const zw = L?.zoom?.w || 400;
      if (P.w > zw) { P.w = zw; P.h = Math.round(zw * 7 / 5); if (P.side === 'right') P.x = Math.max(10, vw - 10 - zw); }
      return P;
    };
    let P = fit(focusPlace([vw, vh], p, bands));
    el.style.width = `${P.w}px`;
    // the text under the card takes room too (0 without layout)
    const th = txt.offsetHeight || 0;
    if (th && !P.dock) { P = fit(focusPlace([vw, vh], p, { ...bands, extra: th + 8 })); el.style.width = `${P.w}px`; }
    el.style.left = `${P.x}px`; el.style.top = `${P.y}px`;
    el.dataset.side = P.side;
    if (P.dock) el.dataset.dock = ''; else delete el.dataset.dock;
    return P;
  }

  function open(card, { L, perm = null, owner = '' } = {}) {
    if (!card) return;
    fresh = true; clearTimeout(freshT);
    freshT = setTimeout(() => { fresh = false; }, 0);
    last = { card, L, perm, owner };
    el.dataset.id = card.id;
    el.setAttribute('aria-label', `Focused card: ${card.name || card.id}`);
    const kws = (card.keywords || []).map(k => KEYWORDS[k]).filter(Boolean);
    const credit = CF.artCredit?.(card.id) || '';
    txt.innerHTML = [
      owner ? `<p class="pl-insp-own">${esc(owner)}</p>` : '',
      kws.length ? `<ul>${kws.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : '',
      permLines(perm).map(l => `<p>${esc(l)}</p>`).join(''),
      credit ? `<p class="pl-insp-cr">${esc(credit)}</p>` : '',
    ].join('');
    el.hidden = false;
    const P = place(L);
    paintCard(cv, card, { w: P.w, h: P.h, mode: 'full', state: perm ? { tapped: !!perm.tapped, damage: perm.dmg | 0, pp: perm.pp | 0, pt: perm.pt | 0 } : {} });
  }

  return {
    el, open, close, isOpen: () => !el.hidden,
    resize(L) { if (last && !el.hidden) open(last.card, { ...last, L: L || last.L }); },
    dispose() {
      close(); off(); el.remove();
    },
  };
}

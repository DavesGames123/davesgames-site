// ============================================================================
//  FLY DUEL  ·  play mode, your hand and the opposing hand  (ES module, DOM)
// ----------------------------------------------------------------------------
//  Your hand is a fan at the bottom edge (ui/play/layout.js fanLayout).
//  Gestures on a card (pointer events, so mouse, pen and touch are one):
//      tap                 select: the card rises, its paid lands light
//      tap again           play it (or choose its target next)
//      drag up and drop    play it (drop above the top line of the hand)
//      right-click, or a long press of a mouse    the full-screen inspector
//      (a double-click is two taps: select, then play)
//      hover (mouse or pen)   the card rises and grows in place, and the
//                          hovered version shows above it (onHover,
//                          ui/play/peek.js, after 120 ms)
//      touch: press and hold (380 ms)   the same: the card rises, the
//                          hovered version shows (onHold) until the
//                          finger lifts (onHoldEnd). A drag up to play
//                          or a sideways scroll stops the hold first.
//  A horizontal move does not start a drag: the fan scrolls sideways when
//  it is wider than the screen (touch-action: pan-x).
//  Playable cards have a crisp 2 px outline. A dark card cannot be played
//  now; tap it to read why in the prompt line.
//
//  The opposing hand is a row of card backs with the count.
//
//  GREP MAP
//      grep -n 'export function createHand'      your fan
//      grep -n 'export function createOppHand'   the backs
//      grep -n 'function gesture'                pointer logic per card
// ============================================================================
import { fanLayout } from './layout.js';
import { paintCard, paintBack } from './canvas.js';

const LONG_MS = 450;
export const HOLD_MS = 380;
const DRAG_PX = 18;

// host: the hand box. cb: { onSelect(i), onPlay(i), onInspect(id),
// onHover(id | null, el), onHold(id, el), onHoldEnd() }
export function createHand(host, cb = {}) {
  const doc = host.ownerDocument;
  const box = doc.createElement('div');
  box.className = 'pl-fan';
  host.appendChild(box);
  const nodes = [];      // per hand index: { el, cv }
  let last = { ids: [], view: null, L: null };
  let drag = null;

  function node(i) {
    if (nodes[i]) return nodes[i];
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'pl-hc';
    const cv = doc.createElement('canvas');
    cv.className = 'pl-cv';
    el.appendChild(cv);
    box.appendChild(el);
    const n = { el, cv, i };
    gesture(n);
    nodes[i] = n;
    return n;
  }

  function gesture(n) {
    const el = n.el;
    let t0 = null, timer = 0, moved = false, long = false, held = false, lastType = '';
    const clear = () => { clearTimeout(timer); timer = 0; };
    // the end of a touch hold: the hovered version goes
    const unhold = () => { if (!held) return; held = false; el.classList.remove('is-peek'); cb.onHoldEnd?.(); };
    el.addEventListener('pointerdown', e => {
      lastType = e.pointerType || '';
      if (e.button > 0) return;
      t0 = { x: e.clientX, y: e.clientY, id: e.pointerId };
      moved = false; long = false;
      clear();
      // touch or pen: a hold shows the hovered version; a mouse: the inspector
      const hold = e.pointerType !== 'mouse' && typeof cb.onHold === 'function';
      timer = setTimeout(() => {
        long = true;
        if (hold) { held = true; el.classList.add('is-peek'); cb.onHold(last.ids[n.i], el); } else cb.onInspect?.(last.ids[n.i]);
      }, hold ? HOLD_MS : LONG_MS);
    });
    el.addEventListener('pointermove', e => {
      if (!t0 || e.pointerId !== t0.id) return;
      const dx = e.clientX - t0.x, dy = e.clientY - t0.y;
      if (!drag && Math.hypot(dx, dy) > 8) { moved = true; clear(); }
      if (!drag && dy < -DRAG_PX && Math.abs(dy) > Math.abs(dx)) {
        unhold();
        cb.onHover?.(null, el);
        drag = { n, x0: t0.x, y0: t0.y };
        try { el.setPointerCapture(e.pointerId); } catch { /* old browser */ }
        el.classList.add('is-drag');
        // the hand box scrolls (overflow-x), which would clip a card that
        // leaves it: show overflow while dragging and keep the fan still
        box.style.transform = `translateX(${-host.scrollLeft}px)`;
        host.classList.add('is-dragging');
      }
      if (drag && drag.n === n) {
        el.style.setProperty('--dx', `${dx}px`);
        el.style.setProperty('--dy', `${dy}px`);
        const top = host.getBoundingClientRect().top;
        el.classList.toggle('is-armed', e.clientY < top - 8);
      }
    });
    const end = e => {
      if (!t0) return;
      clear();
      unhold();
      const wasDrag = drag && drag.n === n;
      if (wasDrag) {
        const top = host.getBoundingClientRect().top;
        el.classList.remove('is-drag', 'is-armed');
        host.classList.remove('is-dragging');
        box.style.transform = '';
        el.style.removeProperty('--dx'); el.style.removeProperty('--dy');
        drag = null;
        if (e.type === 'pointerup' && e.clientY < top - 8) cb.onPlay?.(n.i);
      } else if (e.type === 'pointerup' && !moved && !long) {
        if (last.view?.selected === n.i) cb.onPlay?.(n.i); else cb.onSelect?.(n.i);
      }
      t0 = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // a touch hold also fires contextmenu (Android): the hold has the
    // job, so only a mouse or pen right-click opens the inspector
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (lastType === 'touch' && (held || t0)) return;
      clear(); cb.onInspect?.(last.ids[n.i]);
    });
    el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch' && !drag) cb.onHover?.(last.ids[n.i], el); });
    el.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') cb.onHover?.(null, el); });
    // keyboard: the button gets Enter / Space from the browser as a click
    el.addEventListener('click', e => { if (e.detail === 0) { if (last.view?.selected === n.i) cb.onPlay?.(n.i); else cb.onSelect?.(n.i); } });
  }

  // ids: hand card ids. view: ui/play/model.js view(). L: layoutFor().
  function render(ids, view, L, CARD) {
    last = { ids, view, L };
    const W = host.clientWidth || L.w;
    const f = fanLayout(ids.length, { width: W, cardW: L.hand.w, cardH: L.hand.h, selected: view?.selected ?? -1 });
    box.style.width = `${f.scroll ? f.total : W}px`;
    host.classList.toggle('is-scroll', f.scroll);
    for (let i = 0; i < ids.length; i++) {
      const n = node(i);
      const h = view?.hand?.[i];
      const c = CARD[ids[i]];
      const p = f.cards[i];
      n.el.hidden = false;
      n.el.style.setProperty('--x', `${p.x}px`);
      n.el.style.setProperty('--y', `${p.y}px`);
      n.el.style.setProperty('--r', `${p.rot}deg`);
      n.el.style.zIndex = String(h?.selected ? 50 : 10 + i);
      n.el.classList.toggle('is-play', !!h?.playable);
      n.el.classList.toggle('is-sel', !!h?.selected);
      n.el.classList.toggle('is-dark', view?.mode === 'main' && !h?.playable);
      n.el.setAttribute('aria-label', `${c?.name || ids[i]}${h?.playable ? ', playable' : ''}`);
      n.el.setAttribute('aria-pressed', h?.selected ? 'true' : 'false');
      paintCard(n.cv, c, { w: L.hand.w, h: L.hand.h, mode: 'auto' });
    }
    for (let i = ids.length; i < nodes.length; i++) if (nodes[i]) nodes[i].el.hidden = true;
    if (view?.selected != null && f.scroll) {
      const x = f.cards[view.selected]?.x ?? 0;
      if (x < host.scrollLeft || x + L.hand.w > host.scrollLeft + W) host.scrollLeft = Math.max(0, x - (W - L.hand.w) / 2);
    }
  }

  return { el: box, render, get dragging() { return !!drag; } };
}

// The opposing hand: n card backs, overlapped, and the count.
export function createOppHand(host) {
  const doc = host.ownerDocument;
  const row = doc.createElement('div');
  row.className = 'pl-opphand';
  const backs = doc.createElement('div');
  backs.className = 'pl-backs';
  const label = doc.createElement('span');
  label.className = 'pl-oppn';
  row.append(backs, label);
  host.appendChild(row);
  const cvs = [];
  function render(n, { w = 26, name = 'Opponent' } = {}) {
    const h = Math.round(w * 1.4);
    const show = Math.min(n, 10);
    for (let i = 0; i < show; i++) {
      if (!cvs[i]) { const c = doc.createElement('canvas'); c.className = 'pl-back'; backs.appendChild(c); cvs[i] = c; }
      cvs[i].hidden = false;
      paintBack(cvs[i], { w, h });
    }
    for (let i = show; i < cvs.length; i++) cvs[i].hidden = true;
    label.textContent = `${n} in hand`;
    row.setAttribute('aria-label', `${name}: ${n} cards in hand`);
  }
  return { el: row, render };
}

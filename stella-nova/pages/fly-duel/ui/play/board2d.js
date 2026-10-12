// ============================================================================
//  FLY DUEL  ·  play mode, the flat table  (ES module, DOM)
// ----------------------------------------------------------------------------
//  The table when the 3D scene gives no pick functions (or no WebGL). The
//  human seat is always at the bottom, the fly at the top.
//
//      ┌──────────────────────────────────────┐
//      │ fly lands: one stack per land kind    │
//      │ fly creatures                         │
//      │ ─────────── centre line ──────────── │  the last action (stack)
//      │ your creatures                        │
//      │ your lands: one stack per land kind   │
//      └──────────────────────────────────────┘
//
//  Lands stack by kind (MTGA-like clusters): one card with "untapped /
//  total", and a second plate under it when the stack holds two or more.
//  The lands that a selected card would tap show "-n" on their stack.
//  When a cast taps lands, each stack that paid lifts for 450 ms with a
//  2 px outline (is-paid): the auto-tap is shown, not hidden. Creatures are
//  cards drawn by ui/cardface.js drawCard with the tapped / sick /
//  attacking / blocking / damage / pump flags. A tapped creature turns 90
//  degrees. Arrows (SVG, 2 px, no glow): attacker to blocker, or attacker
//  to the defending player's edge when not blocked.
//
//  Gestures: tap a creature (attack, block, target); in block mode drag
//  your creature onto an attacker; tap the empty table to play the
//  selected hand card (phone: tap the card, then tap the table).
//
//  GREP MAP
//      grep -n 'export function createBoard2d'
//      grep -n 'function renderSide'      lands and creatures of one seat
//      grep -n 'function drawArrows'      SVG attack and block lines
//      grep -n 'function permState'       drawCard flags of a permanent
// ============================================================================
import { paintCard } from './canvas.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function permState(x, view, isAttacking, isBlocking) {
  return {
    tapped: !!x.tapped, sick: !!x.sick, damage: x.dmg | 0, pp: x.pp | 0, pt: x.pt | 0,
    attacking: !!isAttacking, blocking: !!isBlocking,
  };
}

// cb: { onPerm(uid), onPlayer(seat), onBoard(), onAssign(blocker, attacker), onInspect(perm) }
export function createBoard2d(host, cb = {}) {
  const doc = host.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'pl-board';
  root.innerHTML = `
    <div class="pl-side pl-top"><div class="pl-lands"></div><div class="pl-crs"></div></div>
    <div class="pl-mid"><span class="pl-midline"></span></div>
    <div class="pl-side pl-bot"><div class="pl-crs"></div><div class="pl-lands"></div></div>
    <svg class="pl-arrows" aria-hidden="true"></svg>`;
  host.appendChild(root);
  const top = root.querySelector('.pl-top'), bot = root.querySelector('.pl-bot');
  const svg = root.querySelector('.pl-arrows');
  const els = new Map();        // uid -> { el, cv }
  const stacks = new Map();     // key -> { el, cv }
  let seatBottom = 0;
  let cur = { state: null, view: null, CARD: null, L: null };
  let drag = null;

  root.addEventListener('click', e => {
    if (e.target === root || e.target.classList?.contains('pl-side') || e.target.classList?.contains('pl-mid') || e.target.classList?.contains('pl-crs')) cb.onBoard?.();
  });

  function permEl(uid) {
    let n = els.get(uid);
    if (n) return n;
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'pl-perm is-new';
    el.dataset.uid = String(uid);
    const cv = doc.createElement('canvas');
    cv.className = 'pl-cv';
    el.appendChild(cv);
    n = { el, cv, uid };
    let t0 = null, timer = 0, long = false;
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      t0 = { x: e.clientX, y: e.clientY, id: e.pointerId }; long = false;
      clearTimeout(timer);
      timer = setTimeout(() => { long = true; cb.onInspect?.(uid); }, 450);
      const v = cur.view;
      if (v?.mode === 'block' && v.eligibleBlockers.includes(uid)) drag = { uid, x0: e.clientX, y0: e.clientY, on: false, pid: e.pointerId };
    });
    el.addEventListener('pointermove', e => {
      if (!t0) return;
      const d = Math.hypot(e.clientX - t0.x, e.clientY - t0.y);
      if (d > 8) clearTimeout(timer);
      if (drag && drag.uid === uid && d > 14) {
        if (!drag.on) { drag.on = true; try { el.setPointerCapture(e.pointerId); } catch { /* old */ } }
        drawArrows(drag, e.clientX, e.clientY);
      }
    });
    const end = e => {
      clearTimeout(timer);
      if (drag && drag.uid === uid && drag.on) {
        const under = doc.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('.pl-perm');
        const a = under ? +under.dataset.uid : NaN;
        drag = null;
        if (e.type === 'pointerup' && Number.isFinite(a)) cb.onAssign?.(uid, a);
        drawArrows();
      } else if (e.type === 'pointerup' && t0 && !long && Math.hypot(e.clientX - t0.x, e.clientY - t0.y) < 10) cb.onPerm?.(uid);
      drag = drag && drag.uid === uid ? null : drag;
      t0 = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', e => { e.preventDefault(); cb.onInspect?.(uid); });
    el.addEventListener('click', e => { if (e.detail === 0) cb.onPerm?.(uid); });
    els.set(uid, n);
    setTimeout(() => el.classList.remove('is-new'), 30);
    return n;
  }

  function stackEl(key) {
    let n = stacks.get(key);
    if (n) return n;
    const el = doc.createElement('div');
    el.className = 'pl-stack';
    el.innerHTML = '<span class="pl-edges"></span><canvas class="pl-cv"></canvas><b class="pl-cnt"></b><i class="pl-pay" hidden></i>';
    n = { el, cv: el.querySelector('canvas'), key };
    el.addEventListener('click', () => cb.onInspect?.(n.uid));
    stacks.set(key, n);
    return n;
  }

  function renderSide(side, seat) {
    const { state, view, CARD, L } = cur;
    const p = state.players[seat];
    const crRow = side.querySelector('.pl-crs'), landRow = side.querySelector('.pl-lands');
    const attackers = new Set(state.combat?.attackers || []);
    const blocks = new Map((view?.blocks || []).map(([a, b]) => [b, a]));
    const declared = new Set(view?.attackers || []);
    const wantCr = [];
    const landKinds = new Map();
    for (const x of p.battlefield) {
      const c = CARD[x.id];
      if (!c) continue;
      if (c.type === 'land') {
        let k = landKinds.get(x.id);
        if (!k) { k = { id: x.id, up: 0, total: 0, uids: [] }; landKinds.set(x.id, k); }
        k.total++; if (!x.tapped) k.up++; k.uids.push(x.uid);
      } else wantCr.push(x);
    }
    // creatures
    const bw = L.board.w, bh = L.board.h;
    const keep = new Set();
    for (const x of wantCr) {
      const n = permEl(x.uid);
      keep.add(x.uid);
      if (n.el.parentNode !== crRow) crRow.appendChild(n.el);
      const atk = attackers.has(x.uid) || declared.has(x.uid);
      const blk = blocks.has(x.uid);
      paintCard(n.cv, CARD[x.id], { w: bw, h: bh, state: permState(x, view, atk, blk), mode: 'auto' });
      const el = n.el;
      el.style.setProperty('--w', `${x.tapped ? bh : bw}px`);
      el.style.setProperty('--h', `${x.tapped ? bw : bh}px`);
      el.classList.toggle('is-tapped', !!x.tapped);
      el.classList.toggle('is-elig', !!(view && (view.eligibleAttackers.includes(x.uid) || view.eligibleBlockers.includes(x.uid))));
      el.classList.toggle('is-atk', atk);
      el.classList.toggle('is-blk', blk);
      el.classList.toggle('is-target', !!view?.targetUids.includes(x.uid));
      el.classList.toggle('is-pend', view?.pendingBlocker === x.uid || view?.pendingAttacker === x.uid);
      el.classList.toggle('is-incoming', !!view && view.mode === 'block' && view.incoming.includes(x.uid));
      el.setAttribute('aria-label', `${CARD[x.id].name}${x.tapped ? ', tapped' : ''}${atk ? ', attacking' : ''}${blk ? ', blocking' : ''}`);
    }
    // lands: one stack per land card id
    const preview = new Set(view?.preview || []);
    const keepS = new Set();
    for (const k of landKinds.values()) {
      const key = `${seat}:${k.id}`;
      const n = stackEl(key);
      n.uid = k.uids[0];
      keepS.add(key);
      if (n.el.parentNode !== landRow) landRow.appendChild(n.el);
      const lw = Math.round(bw * 0.72), lh = Math.round(lw * 1.4);
      paintCard(n.cv, CARD[k.id], { w: lw, h: lh, state: { tapped: k.up === 0 }, mode: 'thumb' });
      n.el.classList.toggle('is-single', k.total === 1);
      if (n.up !== undefined && k.up < n.up && k.total >= (n.total || 0)) {
        n.el.classList.add('is-paid');
        clearTimeout(n.t);
        n.t = setTimeout(() => n.el.classList.remove('is-paid'), 450);
      }
      n.up = k.up; n.total = k.total;
      n.el.querySelector('.pl-cnt').textContent = `${k.up}/${k.total}`;
      const pay = k.uids.filter(u => preview.has(u)).length;
      const pe = n.el.querySelector('.pl-pay');
      pe.hidden = !pay; pe.textContent = `−${pay}`;
      n.el.classList.toggle('is-spent', k.up === 0);
      n.el.setAttribute('aria-label', `${CARD[k.id].name}: ${k.up} of ${k.total} untapped`);
    }
    return { keep, keepS };
  }

  function center(el) {
    const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
    return [r.left - o.left + r.width / 2, r.top - o.top + r.height / 2];
  }

  // Attack and block lines. dragFrom: a blocker drag in progress.
  function drawArrows(dragFrom = null, px = 0, py = 0) {
    const { state, view } = cur;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!state) return;
    const o = root.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.round(o.width)} ${Math.round(o.height)}`);
    const line = (a, b, cls) => {
      const l = doc.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', a[0].toFixed(1)); l.setAttribute('y1', a[1].toFixed(1));
      l.setAttribute('x2', b[0].toFixed(1)); l.setAttribute('y2', b[1].toFixed(1));
      l.setAttribute('class', cls);
      svg.appendChild(l);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 9;
      const head = doc.createElementNS(SVGNS, 'polygon');
      const p1 = [b[0] - s * Math.cos(ang - 0.45), b[1] - s * Math.sin(ang - 0.45)];
      const p2 = [b[0] - s * Math.cos(ang + 0.45), b[1] - s * Math.sin(ang + 0.45)];
      head.setAttribute('points', `${b[0].toFixed(1)},${b[1].toFixed(1)} ${p1.map(v => v.toFixed(1)).join(',')} ${p2.map(v => v.toFixed(1)).join(',')}`);
      head.setAttribute('class', cls + ' head');
      svg.appendChild(head);
    };
    const attackers = state.combat?.attackers?.length ? state.combat.attackers : (view?.attackers || []);
    const blockOf = new Map(view?.blocks || []);
    const atkSeat = state.active;
    const edgeY = atkSeat === seatBottom ? 4 : o.height - 4;
    for (const a of attackers) {
      const ae = els.get(a)?.el;
      if (!ae || !ae.isConnected) continue;
      const ca = center(ae);
      const b = blockOf.get(a);
      const be = b !== undefined ? els.get(b)?.el : null;
      if (be) line(center(be), ca, 'blk');
      else line(ca, [ca[0], edgeY], `atk s${atkSeat}`);
    }
    if (dragFrom) {
      const be = els.get(dragFrom.uid)?.el;
      if (be) line(center(be), [px - o.left, py - o.top], 'blk drag');
    }
  }

  // state: game state. view: model view. CARD. L: layoutFor(). seat: the
  // human seat (drawn at the bottom).
  function render(state, view, CARD, L, seat) {
    seatBottom = seat;
    cur = { state, view, CARD, L };
    root.dataset.mode = view?.mode || 'wait';
    const a = renderSide(top, 1 - seat), b = renderSide(bot, seat);
    for (const [uid, n] of els) {
      if (a.keep.has(uid) || b.keep.has(uid)) continue;
      // a creature that left: grey it, then take it off
      els.delete(uid);
      n.el.classList.add('is-gone');
      setTimeout(() => n.el.remove(), 320);
    }
    for (const [key, n] of stacks) if (!a.keepS.has(key) && !b.keepS.has(key)) { n.el.remove(); stacks.delete(key); }
    const raf = globalThis.requestAnimationFrame || (f => setTimeout(f, 16));
    raf(() => drawArrows());
  }

  return { el: root, render, redrawArrows: () => drawArrows(), elOf: uid => els.get(uid)?.el || null };
}

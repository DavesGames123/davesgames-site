// ============================================================================
//  FLY DUEL  ·  play mode, the opening hand  (ES module, DOM part optional)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "show mny opening hand as me actually
//  drawing cards, the mulligan row is bad interface design. i want to see
//  each card getting drawn then choose". As in MTG Arena:
//      draw      each card of the opening hand comes off your library (a
//                card back at the lower left) one at a time and goes to
//                its place in a large row over the table
//      choose    then, and only then, Keep N / Mulligan to N-1 show under
//                the row, with the land count and the fly's mulligan line
//      shuffle   a mulligan sends the cards back into the library, the
//                library shuffles, and the new hand is drawn again
//      keep      the cards go down into your hand and the game starts
//  A tap on the row (or Space, Enter) during the draw shows the rest of the
//  hand at once. The game rules stay in ui/play/controller.js (mulligan,
//  keep); this file shows them.
//
//  PURE (node tests): OPENING (times), openingTimeline (when each card
//  is drawn), createOpeningSeq (the state machine: idle -> draw -> choose
//  -> shuffle -> draw ... -> kept), openingLayout (card size and places
//  in a view, every card in the view).
//
//  GREP MAP
//      grep -n 'export const OPENING'           times, ms
//      grep -n 'export function openingTimeline'
//      grep -n 'export function createOpeningSeq'
//      grep -n 'export function openingLayout'
//      grep -n 'export function mountOpening'   the DOM overlay
// ============================================================================

// lead: wait before the first card; gap: from one draw to the next; fly:
// the flight of one card; shuffle: cards back and the shuffle; settle:
// after the last card lands, before the choice shows; down: keep, the
// cards go down to the hand.
export const OPENING = Object.freeze({ lead: 260, gap: 260, fly: 360, shuffle: 700, settle: 140, down: 260 });

// When each of n cards is drawn: { draws: [{ i, at, dur }], choose, total }.
// reduced (prefers-reduced-motion): no flight (dur 0), the cards still
// come one at a time.
export function openingTimeline(n, { reduced = false, T = OPENING } = {}) {
  const dur = reduced ? 0 : T.fly;
  const draws = [];
  for (let i = 0; i < n; i++) draws.push({ i, at: T.lead + i * T.gap, dur });
  const lastEnd = n ? draws[n - 1].at + dur : T.lead;
  const choose = lastEnd + T.settle;
  return { draws, choose, total: choose };
}

// The state machine of the opening hand. Phases:
//   idle     nothing dealt
//   draw     drawn of ids.length cards are in view
//   choose   all cards in view, Keep / Mulligan show
//   shuffle  a mulligan: the cards go back, then deal(newIds)
//   kept     done
// Every method returns false (and changes nothing) when its phase is wrong.
export function createOpeningSeq() {
  let phase = 'idle', ids = [], drawn = 0, deals = 0;
  const seq = {
    get phase() { return phase; },
    get drawn() { return drawn; },
    get ids() { return ids.slice(); },
    get shown() { return ids.slice(0, drawn); },
    get deals() { return deals; },
    // a new hand to draw (the first one, or after a mulligan shuffle)
    deal(hand) {
      if (phase !== 'idle' && phase !== 'shuffle') return false;
      ids = hand.slice(); drawn = 0; deals++;
      phase = ids.length ? 'draw' : 'choose';
      return true;
    },
    // one more card comes off the library; the last one opens the choice
    step() {
      if (phase !== 'draw') return false;
      drawn++;
      if (drawn >= ids.length) phase = 'choose';
      return true;
    },
    // show the rest of the hand at once (a tap during the draw)
    skip() {
      if (phase !== 'draw') return false;
      drawn = ids.length; phase = 'choose';
      return true;
    },
    keep() {
      if (phase !== 'choose') return false;
      phase = 'kept';
      return true;
    },
    mulligan() {
      if (phase !== 'choose') return false;
      phase = 'shuffle'; drawn = 0;
      return true;
    },
  };
  return seq;
}

// Sizes and places for n cards in a view vw x vh (CSS px). The row is in
// the middle, the library at the lower left, the choice bar under the
// row. Every card stays in the view with margin m. Returns { w, h,
// cards: [{ x, y, rot }], deck: { x, y, w, h }, bar: { y, h } }.
export function openingLayout(n, vw, vh, { m = 12, barH = 170 } = {}) {
  n = Math.max(1, n | 0);
  const room = vw - 2 * m;
  // as large as the height allows, then fit the row (overlap down to 55 %)
  let h = Math.min(340, (vh - barH - 3 * m) * 0.62);
  let w = h / 1.4;
  const natural = w * 1.06;
  if (w + (n - 1) * natural > room) {
    if (w + (n - 1) * w * 0.55 > room) { w = room / (1 + 0.55 * (n - 1)); h = w * 1.4; }
  }
  w = Math.max(40, Math.floor(w)); h = Math.round(w * 1.4);
  const step = n > 1 ? Math.min(natural, (room - w) / (n - 1)) : 0;
  const total = w + step * (n - 1);
  const x0 = m + (room - total) / 2;
  const top = Math.max(m, Math.round((vh - barH - h) / 2 - m));
  const mid = (n - 1) / 2;
  const cards = [];
  for (let i = 0; i < n; i++) cards.push({ x: Math.round(x0 + i * step), y: top, rot: Math.round((i - mid) * 1.2 * 10) / 10 });
  const dw = Math.max(40, Math.round(w * 0.6)), dh = Math.round(dw * 1.4);
  return { w, h, cards, deck: { x: m, y: vh - m - dh, w: dw, h: dh }, bar: { y: top + h + m, h: barH } };
}

// ------------------------------------------------------------------ DOM
// mountOpening(root, opts) shows the overlay and runs the draw. opts:
//   ids          the hand (card ids) of the first deal
//   info()       { n, lands, mulls, canMull, flyLine }: the text of the bar
//   paint(cv, id, w, h)   paint a face; back(cv, w, h): paint a back
//   label(id)    the card name (aria-label)
//   view()       [vw, vh] of root
//   onInspect(id)         a tap on a card in the choice
//   onKeep()     the game starts (call controller keep)
//   onMulligan() -> ids   the controller mulligan; the new hand or null
//   reduced      prefers-reduced-motion
//   wait(fn, ms), unwait(t)   timers (default setTimeout, clearTimeout)
// Returns { el, seq, skip(), keep(), mulligan(), dispose() }.
export function mountOpening(root, opts) {
  const doc = root.ownerDocument;
  const wait = opts.wait || ((f, ms) => setTimeout(f, ms));
  const unwait = opts.unwait || (t => clearTimeout(t));
  const seq = createOpeningSeq();
  let timers = [], alive = true, L = null, cardEls = [];
  const later = (f, ms) => { const t = wait(() => { if (alive) f(); }, ms); timers.push(t); return t; };
  const stopTimers = () => { for (const t of timers) unwait(t); timers = []; };

  const el = doc.createElement('div');
  el.className = 'pl-open';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Your opening hand');
  el.innerHTML = `
    <div class="pl-open-deck"><canvas class="pl-cv"></canvas><span class="pl-open-n"></span></div>
    <div class="pl-open-row"></div>
    <div class="pl-open-bar" hidden>
      <p class="pl-open-t" aria-live="polite"></p>
      <p class="pl-fine pl-open-fly"></p>
      <div class="pl-row"><button type="button" class="pl-btn pl-keep" data-keep></button><button type="button" class="pl-btn" data-mull></button></div>
    </div>`;
  root.appendChild(el);
  const deckEl = el.querySelector('.pl-open-deck'), deckN = el.querySelector('.pl-open-n');
  const row = el.querySelector('.pl-open-row'), bar = el.querySelector('.pl-open-bar');
  const keepBtn = el.querySelector('[data-keep]'), mullBtn = el.querySelector('[data-mull]');

  function measure(n) {
    const [vw, vh] = opts.view();
    L = openingLayout(n, vw, vh);
    Object.assign(deckEl.style, { left: `${L.deck.x}px`, top: `${L.deck.y}px`, width: `${L.deck.w}px`, height: `${L.deck.h}px` });
    opts.back?.(deckEl.querySelector('canvas'), L.deck.w, L.deck.h);
    bar.style.top = `${L.bar.y}px`;
  }
  // a card at the library (scaled to the deck) or at its place in the row
  const atDeck = c => `translate(${L.deck.x}px, ${L.deck.y}px) scale(${(L.deck.w / L.w).toFixed(3)})`;
  const atRow = (c, i) => `translate(${L.cards[i].x}px, ${L.cards[i].y}px) rotate(${L.cards[i].rot}deg)`;

  function drawOne(i) {
    if (!seq.step()) return;
    const id = seq.ids[i];
    const c = doc.createElement('button');
    c.type = 'button'; c.className = 'pl-oh';
    c.dataset.i = String(i);
    c.setAttribute('aria-label', `${opts.label?.(id) || id}: inspect`);
    const cv = doc.createElement('canvas'); cv.className = 'pl-cv';
    c.appendChild(cv);
    opts.paint?.(cv, id, L.w, L.h);
    c.style.width = `${L.w}px`; c.style.height = `${L.h}px`;
    c.style.transform = atDeck(c);
    c.style.transitionDuration = `${opts.reduced ? 0 : OPENING.fly}ms`;
    c.addEventListener('click', e => { e.stopPropagation(); if (seq.phase === 'choose') opts.onInspect?.(id); else skip(); });
    row.appendChild(c);
    cardEls[i] = c;
    // the next frame: fly to the row (CSS transition on transform)
    later(() => { c.style.transform = atRow(c, i); c.classList.add('is-in'); }, 16);
    deckN.textContent = String(Math.max(0, (deckN._n = (deckN._n ?? 0) - 1)));
    if (seq.phase === 'choose') later(choose, OPENING.settle + (opts.reduced ? 0 : OPENING.fly));
  }

  function deal(ids) {
    stopTimers();
    if (!seq.deal(ids)) return;
    row.innerHTML = ''; cardEls = [];
    bar.hidden = true;
    measure(ids.length);
    const info = opts.info();
    deckN._n = info.library ?? 0;
    deckN.textContent = String(info.library ?? '');
    el.dataset.phase = 'draw';
    const tl = openingTimeline(ids.length, { reduced: opts.reduced });
    for (const d of tl.draws) later(() => drawOne(d.i), d.at);
  }

  function choose() {
    if (seq.phase !== 'choose' || !alive) return;
    const info = opts.info();
    el.dataset.phase = 'choose';
    el.querySelector('.pl-open-t').textContent = `${info.n} cards, ${info.lands} land${info.lands === 1 ? '' : 's'}.${info.mulls ? ` Mulligans: ${info.mulls}.` : ''}`;
    el.querySelector('.pl-open-fly').textContent = info.flyLine || '';
    keepBtn.textContent = `Keep ${info.n}`;
    mullBtn.textContent = `Mulligan to ${Math.max(4, info.n - 1)}`;
    mullBtn.disabled = !info.canMull;
    bar.hidden = false;
    keepBtn.focus?.();
  }

  function skip() {
    if (seq.phase !== 'draw') return;
    stopTimers();
    const n = seq.ids.length;
    for (let i = seq.drawn; i < n; i++) drawOne(i);
    for (const c of cardEls) if (c) { c.style.transitionDuration = '0ms'; c.style.transform = atRow(c, +c.dataset.i); c.classList.add('is-in'); }
    stopTimers();
    choose();
  }

  // Keep. During the draw (a key or a test) the rest of the hand shows
  // first, so the hand that is kept is always the hand that was seen.
  function keep() {
    if (seq.phase === 'draw') skip();
    if (!seq.keep()) return false;
    stopTimers();
    el.dataset.phase = 'kept';
    bar.hidden = true;
    for (const c of cardEls) if (c) { c.style.transitionDuration = `${opts.reduced ? 0 : OPENING.down}ms`; c.style.transform = `${atRow(c, +c.dataset.i)} translateY(${Math.round(opts.view()[1])}px)`; }
    opts.onKeep?.();
    wait(() => dispose(), opts.reduced ? 0 : OPENING.down + 40);
    return true;
  }

  function mulligan() {
    if (!seq.mulligan()) return false;
    stopTimers();
    el.dataset.phase = 'shuffle';
    bar.hidden = true;
    for (const c of cardEls) if (c) { c.style.transitionDuration = `${opts.reduced ? 0 : OPENING.fly}ms`; c.style.transform = atDeck(c); c.classList.remove('is-in'); }
    deckEl.classList.add('is-shuffle');
    later(() => {
      deckEl.classList.remove('is-shuffle');
      const ids = opts.onMulligan?.();
      if (Array.isArray(ids)) deal(ids);
    }, opts.reduced ? 120 : OPENING.shuffle);
    return true;
  }

  keepBtn.addEventListener('click', e => { e.stopPropagation(); keep(); });
  mullBtn.addEventListener('click', e => { e.stopPropagation(); if (!mullBtn.disabled) mulligan(); });
  el.addEventListener('click', () => skip());
  const onKey = e => {
    if (e.key === ' ' || e.key === 'Enter') { if (seq.phase === 'draw') { e.preventDefault(); skip(); } }
  };
  doc.addEventListener('keydown', onKey);

  function dispose() {
    alive = false;
    stopTimers();
    doc.removeEventListener('keydown', onKey);
    el.remove();
  }

  deal(opts.ids || []);
  return { el, seq, skip, keep, mulligan, dispose, get layout() { return L; } };
}

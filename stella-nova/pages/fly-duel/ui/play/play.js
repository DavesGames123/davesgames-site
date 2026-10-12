// ============================================================================
//  FLY DUEL  ·  play mode, you against a model fly  (ES module, DOM)
// ----------------------------------------------------------------------------
//  mountPlay(root, opts) builds the whole play screen in root and runs one
//  match after another. The game logic is in pure modules:
//      ui/play/controller.js   coin, mulligan, turn flow, fly decisions
//      ui/play/model.js        gestures -> actions, the view model
//      ui/play/layout.js       phone / phone-land / tablet / desktop
//  The DOM parts:
//      ui/hud/scorecard.js     the two seat cards (life d20, mana, brain)
//      ui/play/hand.js         your fan and the opposing card backs
//      ui/play/board2d.js      the flat table (when there is no 3D picking)
//      ui/play/inspector.js    the focused card: a non-modal side panel
//      ui/play/peek.js         the hovered version of a card (MTG Arena
//                              style): a mouse hover on a hand card or a
//                              face-up table card, or a touch hold
//
//  SCREEN (phone, upright; the other layouts move the same boxes)
//      ┌ [A scorecard] [B scorecard] ┐   Fly A left, Fly B right; you take
//      │ opposing hand: card backs    │   the seat of the other fly
//      │                              │
//      │      table (2D or 3D)        │   last action chip in the middle
//      │                              │
//      │ Main · Attack · Block · End  │   phase bar + prompt line
//      │                 [All][BUTTON]│   big button at the right thumb
//      └ your hand, fanned            ┘
//
//  FLOW  setup sheet (opponent, decks, timer) -> coin -> opening hand
//        (drawn card by card, then keep or mulligan) -> play
//        -> result sheet (rematch, change decks).
//  PACING  The fly thinks for a set time (its top-3 moves show in its
//        scorecard), then its move plays. Between turns the table holds
//        still. ONE VOICE (CONTRACT.md): the turn line of the phase bar
//        (.pl-turn, "Turn 6 · Fly B · combat") is the one turn indicator;
//        it changes in place and its edge takes the seat colour for the
//        pause. No banner, no "is thinking" line. A message for the
//        player ("wait for your turn", a move that is not legal) shows
//        next to the control used (.pl-hint at the hand, the table or the
//        big button). Speed: calm, normal, fast.
//
//  FULL BLEED  With the 3D table (.pl-3d) the canvas fills the whole play
//        box, and the HUD lies over it: the scorecards are slim corner
//        strips (ui/hud/scorecard.js slim, the neural panel behind a tap),
//        the phase bar is a small strip over the hand, the opposing
//        card backs go (the 3D table shows them, the scorecard counts
//        them). The big brain of the fly is the side panel of the page
//        (opts.onFlyTrace, ui/fly3d/brainpanels.js); without the page,
//        the 3D scene shows it behind the chair of the fly.
//
//  3D TABLE  When opts.scene gives pickPermanent(clientX, clientY), play
//        mode uses it: setFirstPerson(seat) puts the camera behind you,
//        highlight(spec) marks playable / eligible / target cards, and
//        play(record) animates each decision. A tap on a fly or its life
//        die (pickPermanent gives { uid: null, player }) targets that
//        player. To read a card on the table: hover it (mouse) or hold
//        it (touch) for its hovered version (pickFace, peek.js); right-
//        click it, long-press it with a mouse, or tap it when a tap has
//        no other job (your main phase with no target to choose, the
//        fly's turn) for the inspector. Without pickPermanent the flat
//        table is used and the scene is not touched.
//
//  ORBIT  Drag on the table turns your camera, pinch or the wheel zooms
//        (ui/play/orbit.js; clamps in ui/fly3d/director.js ORBIT). A drag
//        picks nothing; a tap still picks. "Back to seat" or C goes back.
//        The hand of the fly stays hidden from every angle (scene.js).
//
//  KEYS (desktop)  Space / Enter: the big button. Esc: cancel or close.
//        Z or Backspace: undo. A: all attack. 1-9: select a hand card.
//        I: inspect the selected card. L: the log. ?: the key list.
//
//  Honest labels: the fly's deck pick is random and its mulligan is a
//  fixed rule (ui/play/controller.js flyKeeps); its moves come from its
//  mushroom body model with pretrained weights (learning off).
//
//  GREP MAP
//      grep -n 'export function mountPlay'
//      grep -n 'function setupSheet'     opponent, decks, timer
//      grep -n 'function coinSheet'      call the coin
//      grep -n 'function mulliganSheet'  the opening hand: drawn card by
//                                        card, then keep or mulligan
//                                        (ui/play/opening.js)
//      grep -n 'function overSheet'      the result
//      grep -n 'async function loop'     need() -> fly or wait for you
//      grep -n 'async function flyTurn'  think pause, top-3, the move
//      grep -n 'async function animate'  one record on the table
//      grep -n 'function castTarget'     where a cast preview lands
//                                        (ui/play/castview.js: a cast card
//                                        shows large at the left, then
//                                        flies down onto the mat)
//      grep -n 'function render'         every box from the state
//      grep -n 'function onKey'          keyboard shortcuts
//      grep -n 'function startTimer'     optional turn timer
//      grep -n 'export function playTurnText'  the one turn line
//      grep -n 'function flash'          a message at the control used
// ============================================================================
import { createPlayController, deckColours } from './controller.js';
import { createInteraction } from './model.js';
import { layoutFor } from './layout.js';
import { createHand, createOppHand } from './hand.js';
import { createBoard2d } from './board2d.js';
import { createInspector } from './inspector.js';
import { attachOrbit } from './orbit.js';
import { paintCard, paintBack, colourHex } from './canvas.js';
import { mountOpening } from './opening.js';
import { castPlan, createCastView, fallbackTarget, projectTarget } from './castview.js';
import { createPeek, PEEK } from './peek.js';
import * as CF from '../cardface.js';
import { createScorecard, scorecardModel } from '../hud/scorecard.js';
import { agentFromFly, agentFromBot } from '../match.js';

const SPEED = {
  calm: { think: 1500, top: 900, beat: 900, pause: 1500 },
  normal: { think: 950, top: 650, beat: 600, pause: 1100 },
  fast: { think: 350, top: 250, beat: 220, pause: 500 },
};
const NOT_AFFILIATED = 'Not affiliated with or endorsed by Wizards of the Coast.';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The turn line of play mode: "Turn 6 · You · main", "Turn 7 · Fly B ·
// combat", or the result. Pure, for the tests.
const STEP_WORD = { main: 'main', attack: 'combat', block: 'blocks' };
export function playTurnText(state, humanSeat, names) {
  const r = state.result;
  if (r) return `Turn ${state.turn} · ${r.winner < 0 ? 'Draw' : r.winner === humanSeat ? 'You win' : `${names[r.winner]} wins`}`;
  const who = state.active === humanSeat ? 'You' : names[state.active];
  const step = STEP_WORD[state.phase];
  return `Turn ${state.turn} · ${who}${step ? ` · ${step}` : ''}`;
}

// opts:
//   rules, cards, bots        game/rules.js, game/cards.js, game/bots.js namespaces
//   flies     { A: Fly | null, B: Fly | null }   brain/fly.js objects
//   connectomes { A, B }      wiring of each fly (for the brain panel)
//   sources   { A: 'hemibrain v1.2', B: 'FlyWire 783' }   wiring labels
//   brainMod  ui/fly3d/brain3d.js namespace (optional, createBrainCard)
//   cardBrain false: the fly scorecard has no neural canvas (the page
//             shows the fly's brain in its side panel)
//   onGame({ opp, flySide, flySeat, humanSeat })  a new game is set up
//   onFlyTrace(side, trace, delta)  each decision of the fly ('A'|'B')
//   scene     a createDuelScene() object (optional, 3D table)
//   sceneEl   the element that holds the scene canvas (put in the table box)
//   trainedDecks  deck ids the flies trained with (optional, for a note)
//   customDecks   { id: deck } your decks from the deck builder (optional;
//             ui/deckbuilder/deckstore.js customDeckOf). They show first
//             under "Your deck". The fly plays a preset deck.
//   onExit()  shows an Exit item in the menu
//   seed      base seed (game n uses seed + n); default: from the clock
export function mountPlay(root, opts) {
  const { rules, cards, bots } = opts;
  const CARD = cards.CARD;
  const doc = root.ownerDocument;
  const win = doc.defaultView || globalThis;
  const coarse = !!win.matchMedia?.('(pointer: coarse)').matches;
  const reduced = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const deckIds = (cards.DECK_ORDER && cards.DECK_ORDER.length ? cards.DECK_ORDER : Object.keys(cards.DECKS)).filter(k => cards.DECKS[k]);
  const customDecks = opts.customDecks || {};
  const myDeckIds = [...Object.keys(customDecks).filter(k => Array.isArray(customDecks[k]?.list)), ...deckIds];
  const deckOf = id => customDecks[id] || cards.DECKS[id];
  const colourTable = cards.COLOURS || null;
  const has3d = !!(opts.scene && typeof opts.scene.pickPermanent === 'function');

  // choices that last between games
  const pref = {
    opp: opts.flies?.B ? 'B' : opts.flies?.A ? 'A' : 'bot',
    myDeck: deckIds[0], flyDeck: 'random', timer: 0, speed: 'normal',
  };

  root.classList.add('pl');
  // 3D table: full bleed, the HUD lies over it (play.css .pl-3d)
  root.classList.toggle('pl-3d', has3d);
  root.innerHTML = `
    <div class="pl-cards"><div class="pl-sc pl-sc0"></div><div class="pl-sc pl-sc1"></div></div>
    <div class="pl-opp"></div>
    <div class="pl-table"><button type="button" class="pl-btn pl-seatbtn" hidden aria-label="Back to seat (C)">Back to seat</button></div>
    <div class="pl-last" hidden><canvas class="pl-cv"></canvas><span class="pl-last-t"></span></div>
    <div class="pl-bar"><ol class="pl-steps"></ol><span class="pl-turn"></span><p class="pl-prompt" aria-live="polite"></p></div>
    <div class="pl-handbox"></div>
    <div class="pl-actions">
      <button type="button" class="pl-btn pl-sec" hidden></button>
      <button type="button" class="pl-btn pl-pri"><span class="pl-pri-t"></span><i class="pl-timer" hidden></i></button>
    </div>
    <p class="pl-hint" role="status" hidden></p>
    <button type="button" class="pl-btn pl-menubtn" aria-haspopup="true" aria-expanded="false">Menu</button>
    <div class="pl-menu" hidden role="menu"></div>
    <section class="pl-log" hidden aria-label="game log"><header><b>Log</b><button type="button" class="pl-btn pl-logx">Close</button></header><ol></ol></section>
    <div class="pl-sheet" hidden><div class="pl-sheet-in"></div></div>`;
  const $ = s => root.querySelector(s);
  const tableBox = $('.pl-table');
  const sheet = $('.pl-sheet'), sheetIn = $('.pl-sheet-in');
  const pri = $('.pl-pri'), priT = $('.pl-pri-t'), sec = $('.pl-sec'), timerEl = $('.pl-timer');
  const menu = $('.pl-menu'), menuBtn = $('.pl-menubtn');
  const logBox = $('.pl-log');
  const hint = $('.pl-hint');
  // where the last gesture came from: the hint shows next to it
  let hintAt = 'button';
  const from = (at, f) => (...a) => { hintAt = at; return f(...a); };
  const lastBox = $('.pl-last');

  let L = layoutFor(root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight, { coarse });
  // CSS sizes from the layout numbers
  function applyVars() {
    root.dataset.layout = L.kind;
    const st = root.style;
    st.setProperty('--hand-w', `${L.hand.w}px`);
    st.setProperty('--hand-h', `${L.hand.h}px`);
    st.setProperty('--peek', `${L.hand.peek}px`);
    st.setProperty('--btn-h', `${L.button.h}px`);
    st.setProperty('--btn-w', `${L.button.minW}px`);
    st.setProperty('--zoom-w', `${L.zoom.w}px`);
  }
  applyVars();

  const inspector = createInspector(root, { KEYWORDS: cards.KEYWORDS || {} });
  // The hovered version of a card (ui/play/peek.js): a mouse hover on a
  // hand card or a face-up table card, or a touch hold. A hand card has
  // its copy above it; a table card beside the pointer.
  const peek = createPeek(root, { CARD, CF, KEYWORDS: cards.KEYWORDS || {}, view: () => [root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight] });
  const rectOfEl = el => () => el?.getBoundingClientRect?.() || null;
  // The cast preview (ui/play/castview.js), MTG Arena style: a creature or
  // spell cast (yours or the fly's) shows large at the left for a beat,
  // then flies down onto its spot on the mat (castTarget). animate waits
  // for it and the 3D clip together.
  const castView = createCastView(root, {
    paint: (cv, id, w, h) => paintCard(cv, CARD[id], { w, h, mode: 'auto' }),
    view: () => [root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight],
    insets: () => ({ peek: L.hand.peek, top: has3d ? 64 : 0 }),
  });
  const hand = createHand($('.pl-handbox'), {
    onSelect: from('hand', i => apply(ix?.select(i))),
    onPlay: from('hand', i => apply(ix?.play(i))),
    onInspect: id => { peek.hide(); inspectCard(id); },
    onHover: (id, el) => { if (id == null) peek.hide(); else peek.schedule(id, rectOfEl(el), 'above'); },
    onHold: (id, el) => peek.show(id, rectOfEl(el), 'above'),
    onHoldEnd: () => peek.hide(),
  });
  const opp = createOppHand($('.pl-opp'));
  let board = null, orbit = null;
  if (has3d) {
    if (opts.sceneEl) tableBox.insertBefore(opts.sceneEl, tableBox.firstChild);
    tableBox.classList.add('is-3d');
    // Orbit (ui/play/orbit.js): drag turns the seat camera, pinch and the
    // wheel zoom. A drag eats its click, so it picks nothing. "Back to
    // seat" (or C) puts the camera back.
    const seatBtn = $('.pl-seatbtn');
    if (typeof opts.scene.orbitBy === 'function') {
      orbit = attachOrbit(tableBox, opts.scene, { blocked: () => hand.dragging, onChange: on => { seatBtn.hidden = !on; } });
      seatBtn.addEventListener('pointerdown', e => e.stopPropagation());
      seatBtn.addEventListener('click', e => { e.stopPropagation(); orbit.seat(); });
    }
    const pickAt = (x, y) => {
      let hit = null;
      try { hit = opts.scene.pickPermanent(x, y); } catch { hit = null; }
      const uid = hit && typeof hit === 'object' ? hit.uid : hit;
      // a tap on a fly or its life die: { uid: null, player: seat }
      const who = hit && typeof hit === 'object' ? hit.player : undefined;
      return { uid: uid != null && uid !== -1 ? uid : null, who };
    };
    // Read a card on the table: a long press (touch), a right-click, or
    // a tap when a tap has no other job (your main phase with no target
    // to choose, the fly's turn, the end of the game).
    // The face-up card under a point for the hovered version: pickFace
    // (any card: hand, table, the card being cast, graveyard) or, on an
    // older scene, the permanent. A hidden card gives id null: no copy.
    const faceAt = (x, y) => {
      if (typeof opts.scene.pickFace === 'function') {
        let h = null;
        try { h = opts.scene.pickFace(x, y); } catch { h = null; }
        return h && h.id != null ? h.id : null;
      }
      const { uid } = pickAt(x, y);
      return uid === null ? null : permCard(uid);
    };
    const near = (x, y) => () => ({ left: x - 16, top: y - 16, right: x + 16, bottom: y + 16 });
    // mouse or pen hover: one pick per frame at most, the copy follows
    let hov = { x: 0, y: 0, raf: 0 };
    const hoverPick = () => {
      hov.raf = 0;
      const id = faceAt(hov.x, hov.y);
      if (id == null) { peek.hide(); return; }
      if (peek.id() === id || peek.waiting()) peek.move(near(hov.x, hov.y));
      if (peek.id() !== id) peek.schedule(id, near(hov.x, hov.y), 'side');
    };
    tableBox.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      if (e.buttons || hand.dragging) { peek.hide(); return; }
      hov.x = e.clientX; hov.y = e.clientY;
      if (!hov.raf) hov.raf = (win.requestAnimationFrame || (f => setTimeout(f, 16)))(hoverPick);
    });
    tableBox.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') peek.hide(); });
    // Read a card: touch: press and hold shows its hovered version until
    // the finger lifts (a move first is an orbit: no copy); a long press
    // of a mouse opens the inspector.
    let press = { t: 0, x: 0, y: 0, long: false, peek: false, type: '' };
    tableBox.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      clearTimeout(press.t);
      const touch = e.pointerType !== 'mouse';
      press = { x: e.clientX, y: e.clientY, long: false, peek: false, type: e.pointerType || '', t: setTimeout(() => {
        if (touch) {
          const id = faceAt(press.x, press.y);
          if (id != null) { press.long = true; press.peek = true; peek.show(id, near(press.x, press.y), 'side'); }
          return;
        }
        const { uid } = pickAt(press.x, press.y);
        if (uid !== null) { press.long = true; inspectPerm(uid); }
      }, touch ? PEEK.holdMs : 450) };
    });
    const unpress = e => {
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10;
      if (e.type !== 'pointermove' || far) clearTimeout(press.t);
      // the finger lifts, or the hold turns into an orbit: the copy goes
      if (press.peek && (e.type !== 'pointermove' || far)) { press.peek = false; peek.hide(); }
    };
    for (const t of ['pointerup', 'pointercancel', 'pointermove']) tableBox.addEventListener(t, unpress);
    tableBox.addEventListener('contextmenu', e => {
      // a touch hold fires contextmenu too (Android): the hold has the job
      if (press.type === 'touch') { e.preventDefault(); return; }
      const { uid } = pickAt(e.clientX, e.clientY);
      if (uid !== null) { e.preventDefault(); clearTimeout(press.t); peek.hide(); inspectPerm(uid); }
    });
    tableBox.addEventListener('click', e => {
      hintAt = 'table';
      if (orbit?.consumeDrag()) { press.long = false; return; }
      if (!ix) return;
      if (press.long) { press.long = false; return; }
      const { uid, who } = pickAt(e.clientX, e.clientY);
      const m = ix.mode();
      if (uid !== null) {
        if (m === 'wait' || m === 'over' || m === 'main') inspectPerm(uid);
        else apply(ix.perm(uid));
      } else if ((who === 0 || who === 1) && m === 'target') apply(ix.player(who));
      else if (ix.view().selected !== null) apply(ix.confirm());
    });
  } else {
    board = createBoard2d(tableBox, {
      onPerm: from('table', uid => apply(ix?.perm(uid))),
      onAssign: from('table', (b, a) => apply(ix?.assign(b, a))),
      onBoard: () => { if (ix && ix.view().selected !== null) apply(ix.confirm()); },
      onInspect: uid => { peek.hide(); inspectPerm(uid); },
    });
    // mouse or pen hover on a card of the flat table: its hovered version
    tableBox.addEventListener('pointerover', e => {
      if (e.pointerType === 'touch') return;
      const el = e.target?.closest?.('[data-uid]');
      const id = el ? permCard(+el.dataset.uid) : null;
      if (id == null) peek.hide(); else peek.schedule(id, rectOfEl(el), 'side');
    });
    tableBox.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') peek.hide(); });
  }

  let pc = null, ix = null, scs = [null, null];
  let alive = true, busy = false, wake = null;
  let flyTop = [], thinking = -1;
  let timer = { id: 0, end: 0 };
  let gameNo = 0;
  let curOpp = pref.opp;      // the opponent of the game on the table

  // ------------------------------------------------------------ helpers
  const humanSeat = () => (pc ? pc.humanSeat : 0);
  const sp = () => SPEED[pref.speed] || SPEED.normal;
  const nameOf = seat => (pc ? pc.names[seat] : '');

  function flyAgent(side) {
    if (side === 'bot' || !opts.flies?.[side]) {
      return agentFromBot(bots.greedyBot(), 'Greedy bot');
    }
    return agentFromFly(opts.flies[side], `Fly ${side}`, { explore: 0 });
  }

  function deckName(id) { if (Array.isArray(id)) return Object.values(customDecks).find(d => d.list === id)?.name || 'Your deck'; return deckOf(id)?.name || id; }
  function deckPips(id) {
    return deckColours(CARD, deckOf(id)).map(k => `<i style="background:${colourHex(k)}" title="${esc(colourTable?.[k]?.name || k)}"></i>`).join('');
  }

  // ------------------------------------------------------------ sheets
  function showSheet(html, cls) {
    sheetIn.innerHTML = html;
    sheet.className = `pl-sheet ${cls || ''}`;
    sheet.hidden = false;
    const f = sheetIn.querySelector('[data-focus]') || sheetIn.querySelector('button');
    f?.focus?.();
  }
  const hideSheet = () => { sheet.hidden = true; sheetIn.innerHTML = ''; };

  function setupSheet() {
    closeOpening();
    const opps = [];
    if (opts.flies?.A) opps.push(['A', 'Fly A', opts.sources?.A || 'hemibrain']);
    if (opts.flies?.B) opps.push(['B', 'Fly B', opts.sources?.B || 'FlyWire']);
    opps.push(['bot', 'Greedy bot', 'practice: a fixed rule, no brain']);
    if (!opps.some(o => o[0] === pref.opp)) pref.opp = opps[0][0];
    const tile = (id, on) => `<button type="button" class="pl-deck${on ? ' on' : ''}" data-deck="${esc(id)}" aria-pressed="${on}"><span class="pl-pips">${deckPips(id)}</span><b>${esc(deckName(id))}</b><em>${esc(deckOf(id)?.blurb || deckOf(id)?.theme || (customDecks[id] ? 'Your deck' : ''))}</em></button>`;
    showSheet(`
      <h2>Play against a model fly</h2>
      <p class="pl-fine">The opponent is a model of a fruit fly's mushroom body on real connectome wiring, with pretrained weights. It does not learn during your game.</p>
      <h3>Opponent</h3>
      <div class="pl-seg" data-k="opp">${opps.map(([k, n, s]) => `<button type="button" data-v="${k}" aria-pressed="${pref.opp === k}"><b>${n}</b><em>${esc(s)}</em></button>`).join('')}</div>
      <h3>Your deck</h3>
      <div class="pl-decks" data-k="myDeck">${myDeckIds.map(id => tile(id, id === pref.myDeck)).join('')}</div>
      <h3>The fly's deck</h3>
      <label class="pl-sel"><select data-k="flyDeck"><option value="random">Random (the fly does not choose)</option>${deckIds.map(id => `<option value="${esc(id)}"${pref.flyDeck === id ? ' selected' : ''}>${esc(deckName(id))}</option>`).join('')}</select></label>
      <p class="pl-fine pl-trained" hidden></p>
      <h3>Turn timer</h3>
      <div class="pl-seg" data-k="timer">${[[0, 'Off'], [30, '30 s'], [60, '60 s']].map(([v, n]) => `<button type="button" data-v="${v}" aria-pressed="${pref.timer === v}">${n}</button>`).join('')}</div>
      <button type="button" class="pl-btn pl-go" data-focus>Start</button>
      <p class="pl-fine">Plays like digital card games such as MTG Arena. Our own cards, rules text, art choice and symbols. ${NOT_AFFILIATED}</p>`, 'pl-setup');
    const note = sheetIn.querySelector('.pl-trained');
    const trainedNote = () => {
      const t = opts.trainedDecks;
      const pick = [pref.myDeck, pref.flyDeck].filter(d => d && d !== 'random');
      const off = t && pick.filter(d => !t.includes(d));
      note.hidden = !(off && off.length && pref.opp !== 'bot');
      if (!note.hidden) note.textContent = `The flies trained with ${t.map(deckName).join(' and ')}. With ${off.map(deckName).join(' and ')} they use the same learned values on boards they did not see in training.`;
    };
    trainedNote();
    sheetIn.querySelectorAll('.pl-seg').forEach(seg => seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const k = seg.dataset.k;
      pref[k] = k === 'timer' ? +b.dataset.v : b.dataset.v;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      trainedNote();
    }));
    sheetIn.querySelector('.pl-decks').addEventListener('click', e => {
      const b = e.target.closest('.pl-deck'); if (!b) return;
      pref.myDeck = b.dataset.deck;
      sheetIn.querySelectorAll('.pl-deck').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      trainedNote();
    });
    sheetIn.querySelector('select').addEventListener('change', e => { pref.flyDeck = e.target.value; trainedNote(); });
    sheetIn.querySelector('.pl-go').addEventListener('click', () => newGame());
  }

  function coinSheet() {
    showSheet(`
      <h2>Call the coin</h2>
      <p>The winner goes first.</p>
      <div class="pl-row"><button type="button" class="pl-btn pl-go" data-call="heads" data-focus>Heads</button><button type="button" class="pl-btn" data-call="tails">Tails</button></div>`, 'pl-coin');
    sheetIn.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', async () => {
      const r = pc.coin(b.dataset.call);
      const me = r.first === humanSeat();
      showSheet(`
        <div class="pl-coinface" data-side="${r.side}">${r.side === 'heads' ? 'H' : 'T'}</div>
        <h2>${r.side === 'heads' ? 'Heads' : 'Tails'}. ${me ? 'You go first.' : `${esc(nameOf(r.first))} goes first.`}</h2>
        <button type="button" class="pl-btn pl-go" data-focus>Continue</button>`, 'pl-coin');
      opts.scene?.setState?.(pc.state);
      sheetIn.querySelector('.pl-go').addEventListener('click', () => mulliganSheet());
    }));
  }

  // The opening hand (ui/play/opening.js): each card comes off your
  // library into a large row, one at a time, then Keep / Mulligan. A
  // mulligan shuffles the cards back and draws again. The fan under it
  // stays hidden until you keep (.pl[data-opening]).
  let opening = null;
  function closeOpening() { opening?.dispose(); opening = null; delete root.dataset.opening; }
  function mulliganSheet() {
    hideSheet();
    closeOpening();
    const hs = humanSeat();
    const handOf = () => pc.state.players[hs].hand;
    root.dataset.opening = '1';
    opening = mountOpening(root, {
      ids: handOf(), reduced,
      view: () => [root.clientWidth || win.innerWidth || 390, root.clientHeight || win.innerHeight || 760],
      label: id => CARD[id]?.name || id,
      paint: (cv, id, w, h) => paintCard(cv, CARD[id], { w, h, mode: 'auto' }),
      back: (cv, w, h) => paintBack(cv, { w, h }),
      info: () => {
        const p = pc.state.players[hs], m = pc.mulligans, flyM = m[pc.flySeat];
        return {
          n: p.hand.length, lands: p.hand.filter(id => CARD[id]?.type === 'land').length, mulls: m[hs], canMull: m[hs] < 3, library: p.library.length,
          flyLine: `${nameOf(pc.flySeat)} ${flyM ? `took ${flyM} mulligan${flyM > 1 ? 's' : ''}` : 'keeps its hand'} (a fixed rule: keep 2 to 5 lands, not the brain).`,
        };
      },
      onInspect: id => inspectCard(id),
      onMulligan: () => { if (!pc.mulligan()) return null; opts.scene?.setState?.(pc.state); return handOf().slice(); },
      onKeep: () => { opening = null; delete root.dataset.opening; pc.keep(); opts.scene?.setState?.(pc.state); start(); },
    });
  }

  function overSheet() {
    const res = pc.result || {};
    const hs = humanSeat();
    const head = res.winner < 0 ? 'Draw' : res.winner === hs ? 'You win' : `${esc(nameOf(res.winner))} wins`;
    const why = { life: 'life reached 0', decked: 'a draw from an empty library', 'turn cap': 'the turn cap', 'both at 0 life': 'both at 0 life' }[res.reason] || res.reason || '';
    const P = pc.state.players;
    showSheet(`
      <h2>${head}</h2>
      <p>${esc(why)}. Turn ${pc.state.turn}. Life ${P[hs].life} to ${P[1 - hs].life}.</p>
      <div class="pl-row"><button type="button" class="pl-btn pl-go" data-again data-focus>Rematch</button><button type="button" class="pl-btn" data-setup>Change decks</button></div>`, 'pl-over');
    sheetIn.querySelector('[data-again]').addEventListener('click', () => newGame());
    sheetIn.querySelector('[data-setup]').addEventListener('click', () => setupSheet());
  }

  // ------------------------------------------------------------ a game
  function newGame() {
    stopTimer();
    closeOpening();
    gameNo++;
    const seed = opts.seed != null ? (opts.seed + gameNo) >>> 0 : ((Date.now() & 0xfffffff) ^ (gameNo * 2654435761)) >>> 0;
    const flySide = pref.opp === 'bot' ? 'B' : pref.opp;
    const humanSeatNo = flySide === 'A' ? 1 : 0;
    let flyDeck = pref.flyDeck;
    if (flyDeck === 'random') flyDeck = deckIds[seed % deckIds.length];
    const mine = customDecks[pref.myDeck]?.list || pref.myDeck;
    const decks = humanSeatNo === 0 ? [mine, flyDeck] : [flyDeck, mine];
    const agent = flyAgent(pref.opp);
    curOpp = pref.opp;
    pc = createPlayController({ rules, CARD, opponent: agent, humanSeat: humanSeatNo, humanName: 'You', seed, decks });
    ix = createInteraction({ rules, CARD, seat: humanSeatNo, names: pc.names });
    flyTop = []; thinking = -1;
    // scorecards: seat 0 left, seat 1 right
    for (let s = 0; s < 2; s++) {
      scs[s]?.dispose();
      const host = $(`.pl-sc${s}`);
      host.innerHTML = '';
      const isFly = s === pc.flySeat && pref.opp !== 'bot';
      scs[s] = createScorecard(host, {
        seat: s, side: s ? 'right' : 'left', kind: s === humanSeatNo ? 'human' : isFly ? 'fly' : 'bot',
        connectome: isFly ? opts.connectomes?.[flySide] : null, brainMod: opts.brainMod, brain: opts.cardBrain !== false,
        compact: L.score === 'compact', slim: has3d, quiet: true, onPlayer: from('table', seat => apply(ix?.player(seat))),
      });
      scs[s].setCompact(L.score === 'compact');
    }
    root.dataset.human = String(humanSeatNo);
    try { opts.onGame?.({ opp: curOpp, flySide, flySeat: pc.flySeat, humanSeat: humanSeatNo }); } catch (e) { console.info('fly-duel play: onGame', e); }
    opts.scene?.setFirstPerson?.(humanSeatNo);
    orbit?.seat();
    lastBox.hidden = true;
    render();
    coinSheet();
  }

  function start() {
    render();
    loop();
  }

  async function loop() {
    const my = gameNo;
    while (alive && pc && my === gameNo) {
      const need = pc.need();
      if (need === 'fly') { await flyTurn(); continue; }
      if (need === 'over') { stopTimer(); render(); overSheet(); return; }
      if (need !== 'human') return;
      render();
      startTimer();
      await new Promise(r => { wake = r; });
      wake = null;
    }
  }

  async function flyTurn() {
    const my = gameNo;
    const fs = pc.flySeat;
    thinking = fs; flyTop = [];
    render();
    await sleep(sp().think);
    if (my !== gameNo || !alive) return;
    const rec = pc.flyStep();
    thinking = -1;
    if (!rec) return;
    flyTop = rec.top || [];
    // the TD error of ui/match.js (gamma V(now) - V(before)): learning is
    // off, so the trace's own learning delta stays 0
    if (rec.trace) {
      scs[fs]?.fire(rec.delta != null ? { ...rec.trace, delta: rec.delta } : rec.trace);
      if (curOpp !== 'bot') try { opts.onFlyTrace?.(curOpp, rec.trace, rec.delta); } catch (e) { console.info('fly-duel play: onFlyTrace', e); }
    }
    render();
    if (flyTop.length) await sleep(sp().top);
    await animate(rec);
  }

  async function act(action) {
    if (busy || !pc) return;
    const my = gameNo;
    busy = true;
    stopTimer();
    const r = pc.submit(action);
    if (!r.ok) { busy = false; flash(r.error); return; }
    await animate(r.rec);
    busy = false;
    if (my === gameNo) wake?.();
  }

  // One decision on the table: the last-action chip, the 3D clip or the
  // flat redraw, and the pause between turns.
  async function animate(rec) {
    if (!rec) return;
    showLast(rec);
    const cast = castView.play(castPlan(rec, CARD, { speed: pref.speed, reduced }), castTarget);
    if (has3d) {
      render();
      try { await Promise.race([Promise.all([opts.scene.play(rec), cast]), sleep(8000)]); } catch (e) { console.info('fly-duel play: scene.play', e); }
    } else {
      render();
      await Promise.all([sleep(reduced ? Math.max(sp().beat, 400) : sp().beat), cast]);
    }
    // the pause between turns: the turn line has the new turn already;
    // it is marked for the pause (no banner)
    const a = rec.before, b = rec.after;
    if (!b.result && b.turn !== a.turn) {
      const tl = $('.pl-turn');
      render();
      tl.classList.add('is-new');
      await sleep(sp().pause);
      tl.classList.remove('is-new');
    }
  }

  // Where a cast preview lands (client px): the new permanent on the 3D
  // table (its place, projected with the scene camera) or on the flat
  // table, else the creature row of the caster (castview.js
  // fallbackTarget). A spell lands at the middle of the table.
  function castTarget(plan) {
    if (plan.uid != null && has3d) {
      const o = opts.scene.world?.Z?.perms?.get?.(plan.uid);
      const cv = opts.sceneEl || tableBox.querySelector('canvas');
      const p = projectTarget(o?.toP || o?.mesh?.position, opts.scene.camera, cv?.getBoundingClientRect?.());
      if (p) return p;
    } else if (plan.uid != null) {
      const r = tableBox.querySelector(`[data-uid="${plan.uid}"]`)?.getBoundingClientRect?.();
      if (r && r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const b = tableBox.getBoundingClientRect?.();
    const box = b && b.width > 0 ? b : { left: 0, top: 0, width: root.clientWidth || win.innerWidth || 0, height: root.clientHeight || win.innerHeight || 0 };
    return fallbackTarget(box, plan.seat === humanSeat(), plan.kind);
  }

  function showLast(rec) {
    const id = rec.action.card;
    const cv = lastBox.querySelector('canvas');
    cv.hidden = !id;
    if (id && CARD[id]) paintCard(cv, CARD[id], { w: L.kind === 'desktop' ? 96 : 64, h: L.kind === 'desktop' ? 134 : 90, mode: 'thumb' });
    lastBox.querySelector('.pl-last-t').textContent = rec.text || rec.action.type;
    lastBox.dataset.seat = String(rec.who);
    lastBox.hidden = false;
    clearTimeout(lastBox._t);
    lastBox._t = setTimeout(() => { lastBox.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------ gestures
  function apply(r) {
    if (!r || !pc) return;
    if (r.commit) {
      if (busy) { flash('Wait: the last move is still on the table.'); return; }
      act(r.commit);
      return;
    }
    render();
    if (r.error) flash(r.error);
  }

  // A message for the player, next to the control used (hintAt: hand,
  // table or button). It goes after 1.8 s or at the next gesture.
  function flash(msg, at = hintAt) {
    if (!msg) return;
    hint.textContent = msg;
    hint.dataset.at = at;
    hint.hidden = false;
    clearTimeout(hint._t);
    hint._t = setTimeout(() => { hint.hidden = true; }, 1800);
  }

  function inspectCard(id) { if (CARD[id]) { peek.hide(); inspector.open(CARD[id], { L }); } }
  function inspectPerm(uid) {
    if (!pc) return;
    for (let s = 0; s < 2; s++) {
      const x = pc.state.players[s].battlefield.find(y => y.uid === uid);
      if (x) { inspector.open(CARD[x.id], { L, perm: x, owner: s === humanSeat() ? 'Yours' : nameOf(s) }); return; }
    }
  }
  // the card id of a permanent on the table (null: none)
  function permCard(uid) {
    if (!pc) return null;
    for (let s = 0; s < 2; s++) {
      const x = pc.state.players[s].battlefield.find(y => y.uid === uid);
      if (x) return x.id;
    }
    return null;
  }

  pri.addEventListener('click', () => {
    hintAt = 'button';
    if (!ix) return;
    if (ix.mode() === 'over') { newGame(); return; }
    if (busy) return;
    apply(ix.primary());
  });
  sec.addEventListener('click', () => { hintAt = 'button'; if (!busy) apply(ix?.secondary()); });

  // ------------------------------------------------------------ the timer
  function startTimer() {
    stopTimer();
    if (!pref.timer || !pc) return;
    timer.end = Date.now() + pref.timer * 1000;
    timerEl.hidden = false;
    timer.id = setInterval(() => {
      const left = timer.end - Date.now();
      timerEl.style.width = `${Math.max(0, left / (pref.timer * 1000)) * 100}%`;
      timerEl.classList.toggle('low', left < 8000);
      if (left > 0) return;
      stopTimer();
      // time is up: the empty choice (pass, no attack, no blocks)
      const m = ix.mode();
      const a = m === 'attack' ? { type: 'attack', attackers: [] } : m === 'block' ? { type: 'block', blocks: [] } : { type: 'pass' };
      flash('Time is up.', 'button');
      act(a);
    }, 250);
  }
  function stopTimer() { clearInterval(timer.id); timer.id = 0; timerEl.hidden = true; }

  // ------------------------------------------------------------ the menu
  function menuItems() {
    menu.innerHTML = `
      <div class="pl-seg" data-k="speed">${['calm', 'normal', 'fast'].map(k => `<button type="button" data-v="${k}" aria-pressed="${pref.speed === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <button type="button" class="pl-btn" data-m="log">Game log</button>
      <button type="button" class="pl-btn" data-m="keys">Keys</button>
      <button type="button" class="pl-btn" data-m="concede">Concede and restart</button>
      <button type="button" class="pl-btn" data-m="setup">Change decks</button>
      ${opts.onExit ? '<button type="button" class="pl-btn" data-m="exit">Exit play mode</button>' : ''}
      <p class="pl-keys" hidden>Space or Enter: the big button. Esc: cancel or close. Z or Backspace: undo. A: all attack. 1 to 9: select a hand card. I: inspect it. L: the log. Drag the table to look around, pinch or wheel to zoom, C: back to your seat.</p>`;
    menu.querySelector('.pl-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      pref.speed = b.dataset.v;
      menu.querySelectorAll('.pl-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      opts.scene?.setSpeed?.(pref.speed === 'fast' ? 3 : pref.speed === 'calm' ? 0.6 : 1);
    });
  }
  menu.addEventListener('click', e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    if (m === 'keys') { menu.querySelector('.pl-keys').hidden = false; return; }
    toggleMenu(false);
    if (m === 'log') toggleLog(true);
    if (m === 'concede') newGame();
    if (m === 'setup') { gameNo++; stopTimer(); setupSheet(); }
    if (m === 'exit') opts.onExit?.();
  });
  function toggleMenu(on = menu.hidden) {
    if (on) menuItems();
    menu.hidden = !on;
    menuBtn.setAttribute('aria-expanded', String(on));
  }
  menuBtn.addEventListener('click', () => toggleMenu());
  function toggleLog(on = logBox.hidden) { logBox.hidden = !on; if (on) renderLog(); }
  $('.pl-logx').addEventListener('click', () => toggleLog(false));

  function renderLog() {
    if (logBox.hidden || !pc) return;
    const lines = pc.state.log.slice(-60);
    logBox.querySelector('ol').innerHTML = lines.map(l => {
      const seat = pc.names.findIndex(n => l.startsWith(n));
      return `<li${seat >= 0 ? ` data-seat="${seat}"` : ''}>${esc(l)}</li>`;
    }).join('');
    const ol = logBox.querySelector('ol');
    ol.scrollTop = ol.scrollHeight;
  }

  // ------------------------------------------------------------ keys
  function onKey(e) {
    if (!alive || !root.isConnected) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    hintAt = 'button';
    if ((e.key === 'c' || e.key === 'C') && orbit?.orbiting) { orbit.seat(); return; }
    if (e.key === 'Escape') {
      if (inspector.isOpen()) { inspector.close(); return; }
      if (!menu.hidden) { toggleMenu(false); return; }
      if (!logBox.hidden) { toggleLog(false); return; }
      apply(ix?.cancel());
      return;
    }
    // a focused card is non-modal: the keys still work (inspector.js)
    if (!sheet.hidden || !ix || opening) return;
    const k = e.key;
    const onButton = t && t.tagName === 'BUTTON' && t !== doc.body;
    if ((k === ' ' || k === 'Enter') && !onButton) { e.preventDefault(); pri.click(); return; }
    if ((k === 'z' || k === 'Z' || k === 'Backspace') && !e.metaKey) { e.preventDefault(); if (!busy) apply(ix.undo()); return; }
    if ((k === 'z' || k === 'Z') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy) apply(ix.undo()); return; }
    if (k === 'a' || k === 'A') { if (!busy) apply(ix.allAttack()); return; }
    if (k === 'l' || k === 'L') { toggleLog(); return; }
    if (k === 'i' || k === 'I') { const v = ix.view(); if (v.selected !== null) inspectCard(pc.state.players[humanSeat()].hand[v.selected]); return; }
    if (k === '?') { toggleMenu(true); menu.querySelector('.pl-keys').hidden = false; return; }
    if (/^[1-9]$/.test(k)) { if (!busy) apply(ix.select(+k - 1)); }
  }
  doc.addEventListener('keydown', onKey);

  // ------------------------------------------------------------ render
  function render() {
    if (!pc || !ix) return;
    const s = pc.state;
    ix.sync(s);
    const v = ix.view();
    const hs = humanSeat();
    for (let seat = 0; seat < 2; seat++) {
      const isFly = seat !== hs;
      const kind = seat === hs ? 'human' : (curOpp === 'bot' ? 'bot' : 'fly');
      const m = scorecardModel({
        state: s, seat, CARD, kind, name: pc.names[seat], letter: seat ? 'B' : 'A',
        source: isFly ? (opts.sources?.[curOpp] || '') : '', deckName: deckName(pc.decks[seat]),
        top: isFly ? flyTop : [], thinking: thinking === seat || (seat === hs && v.mine), colours: colourTable,
        paying: seat === hs ? v.preview : null,
      });
      scs[seat]?.update(m);
      scs[seat]?.setTarget(v.targetPlayers.includes(seat));
    }
    opp.render(s.players[1 - hs].hand.length, { w: L.kind === 'desktop' ? 30 : 22, name: pc.names[1 - hs] });
    if (board) board.render(s, v, CARD, L, hs);
    if (has3d) {
      try {
        opts.scene.highlight?.({
          seat: hs, mode: v.mode, eligible: v.eligibleAttackers.concat(v.eligibleBlockers), attackers: v.attackers,
          blocks: v.blocks, targets: v.targetUids, preview: v.preview,
          pending: [v.pendingBlocker, v.pendingAttacker].filter(u => u !== null),
        });
      } catch (e) { console.info('fly-duel play: scene.highlight', e); }
    }
    hand.render(s.players[hs].hand, v, L, CARD);
    // phase bar
    const ph = v.phase;
    $('.pl-steps').innerHTML = ph.steps.map(st => `<li class="${st.now ? 'now' : st.done ? 'done' : ''}">${st.label}</li>`).join('');
    // the one turn indicator of play mode, changed in place
    $('.pl-turn').textContent = playTurnText(s, hs, pc.names);
    $('.pl-turn').dataset.seat = String(s.active);
    $('.pl-bar').dataset.seat = String(s.active);
    // the prompt says what you can do; on the fly's turn it is empty
    $('.pl-prompt').textContent = thinking >= 0 || v.mode === 'wait' ? '' : v.prompt;
    // buttons
    priT.textContent = v.primary.label;
    pri.disabled = !v.primary.enabled || busy;
    pri.dataset.tone = v.primary.tone || '';
    if (v.secondary) { sec.hidden = false; sec.textContent = v.secondary.label; sec.disabled = !v.secondary.enabled || busy; } else sec.hidden = true;
    root.dataset.mode = v.mode;
    renderLog();
  }

  // ------------------------------------------------------------ resize
  function relayout() {
    const nl = layoutFor(root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight, { coarse });
    const changed = nl.kind !== L.kind || nl.hand.w !== L.hand.w || nl.board.w !== L.board.w;
    L = nl;
    applyVars();
    for (const sc of scs) { sc?.setCompact(L.score === 'compact'); sc?.resize(); }
    opts.scene?.resize?.();
    peek.resize();
    inspector.resize(L);
    if (changed) render();
    else board?.redrawArrows();
  }
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => relayout()) : null;
  if (ro) ro.observe(root); else win.addEventListener('resize', relayout);

  setupSheet();

  return {
    newGame, setupSheet,
    get controller() { return pc; },
    get busy() { return busy; },
    get layout() { return L; },
    destroy() {
      alive = false; gameNo++;
      stopTimer();
      closeOpening();
      doc.removeEventListener('keydown', onKey);
      orbit?.dispose();
      peek.dispose();
      ro?.disconnect(); win.removeEventListener('resize', relayout);
      for (const sc of scs) sc?.dispose();
      root.innerHTML = '';
      root.classList.remove('pl', 'pl-3d');
    },
  };
}

// ============================================================================
//  FLY DUEL  ·  play mode, the dock: turn plate, phase ladder, big button
//  (ES module; the pure parts have no DOM, paintDock writes the elements)
// ----------------------------------------------------------------------------
//  The user (2026-10-12, verbatim): "the interface for ending my tern of
//  moving along, as well as what's tracking the current [hase, look
//  really really bad." The dock replaces the old phase bar and the long
//  turn line. It sits at the lower right, above the hand (thumb reach):
//
//      ┌ ◆ Your turn        Main ┐   turn plate: the ONE turn indicator
//      │ (↻)─(▣)─(⚔)─(⛨)─(☾)  T6 │   phase ladder, the current step lit
//      │        [Undo][ TO COMBAT ]│   small and big button (Space/Enter)
//      └───────────────────────────┘
//
//  PHASES  The rules engine (game/rules.js step) has three phases that
//        wait for a choice: main, attack, block. Two steps run with no
//        choice: the start of a turn (untap, upkeep triggers, draw;
//        endTurn) and the end (hand limit, damage and pumps wear off;
//        endTurn). The ladder shows all five, in that order. state.phase
//        is main, attack or block while a game runs, so 'start' is done
//        and 'end' is to come. An attack with no attackers ends the turn
//        at once: the ladder skips block. At the result, every step is
//        done and none is lit.
//  COLOUR  The lit step, the plate rim and the phase word take the colour
//        of whose turn it is (state.active): you = parchment, Fly A =
//        cyan, Fly B = magenta (FLY in ui/tokens.js). data-who on the
//        dock is 'you', 'A' or 'B' (play.css .pl-dock).
//  BUTTON  view().primary of ui/play/model.js gives label, tone, enabled.
//        buttonState() turns it into data-state: 'go' (your press moves
//        the game on: the parchment and bronze face), 'quiet' (Cancel of
//        a target choice) or 'wait' (the fly acts, or the last move is
//        still on the table: muted). On the fly's turn the label is
//        "Waiting", so the button does not say whose turn it is a second
//        time.
//
//  GREP MAP
//      grep -n 'export const PHASES'        the five steps, their icons
//      grep -n 'export function phaseLadder' the steps of a state
//      grep -n 'export function turnText'    "Your turn", "Fly B's turn"
//      grep -n 'export function buttonState' go / quiet / wait, the label
//      grep -n 'export function ladderHtml'  the <li> of the ladder
//      grep -n 'export function paintDock'   write a ladder into the DOM
//      grep -n 'export const DOCK'           sizes (play.css .pl-dock)
//      grep -n 'export function dockRect'    the dock in the view (tests)
// ============================================================================

const svg = d => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

// The steps of one turn. auto: the engine runs it with no choice.
export const PHASES = Object.freeze([
  { key: 'start', label: 'Start', title: 'Start: untap, upkeep, draw', auto: true,
    icon: svg('M13 8.5a5 5 0 1 1-1.6-3.7M12.2 1.8v3.4H8.8') },
  { key: 'main', label: 'Main', title: 'Main: play a land, cast cards', auto: false,
    icon: svg('M2.5 4.5h6.5v9.5H2.5zM6 2h7.5v9.5H11') },
  { key: 'attack', label: 'Attack', title: 'Attack: declare attackers', auto: false,
    icon: svg('M13.5 2.5 6.2 9.8M13.5 2.5H10M13.5 2.5V6M3.8 8.4l3.8 3.8M5.4 10.6l-2.9 2.9') },
  { key: 'block', label: 'Block', title: 'Block: declare blockers, then damage', auto: false,
    icon: svg('M8 1.8 13 3.6v4c0 3.2-2.2 5.4-5 6.6-2.8-1.2-5-3.4-5-6.6v-4z') },
  { key: 'end', label: 'End', title: 'End: hand limit, damage wears off', auto: true,
    icon: svg('M4 2h8M4 14h8M5 2c0 3 3 4 3 6s-3 3-3 6M11 2c0 3-3 4-3 6s3 3 3 6') },
]);

const whoOf = (seat, humanSeat) => (seat === humanSeat ? 'you' : seat === 0 ? 'A' : 'B');

// The one turn indicator: "Your turn", "Fly B's turn", or the result.
export function turnText(state, humanSeat, names = []) {
  const r = state.result;
  if (r) return r.winner < 0 ? 'Draw' : r.winner === humanSeat ? 'You win' : `${names[r.winner] || 'Opponent'} wins`;
  return state.active === humanSeat ? 'Your turn' : `${names[state.active] || 'Opponent'}'s turn`;
}

// The ladder of a state. { steps: [{ key, label, title, now, done }],
// now: key | null, label: the word of the lit step, who, seat, turn,
// text: turnText(), yours: the turn is yours, act: you choose now }.
export function phaseLadder(state, humanSeat, names = []) {
  const over = !!state.result;
  const at = over ? PHASES.length : PHASES.findIndex(p => p.key === state.phase);
  const steps = PHASES.map((p, i) => ({ key: p.key, label: p.label, title: p.title, now: !over && i === at, done: over || (at >= 0 && i < at) }));
  const lit = steps.find(s => s.now) || null;
  const seat = over ? state.result.winner : state.active;
  return {
    steps, now: lit ? lit.key : null, label: lit ? lit.label : '',
    who: seat < 0 ? 'none' : whoOf(seat, humanSeat), seat,
    turn: state.turn, text: turnText(state, humanSeat, names),
    yours: !over && state.active === humanSeat, act: !over && state.toAct === humanSeat,
  };
}

// The big button from view().primary. busy: the last move is still on
// the table. { state: 'go' | 'quiet' | 'wait', label, disabled, tone }.
export function buttonState(primary, { busy = false } = {}) {
  const p = primary || { label: '', enabled: false, tone: 'wait' };
  const tone = p.tone || 'wait';
  const label = tone === 'wait' ? 'Waiting' : p.label;
  const disabled = !p.enabled || busy;
  const state = disabled || tone === 'wait' ? 'wait' : tone === 'quiet' ? 'quiet' : 'go';
  return { state, label, disabled, tone };
}

// The <li> of the ladder, in PHASES order (paintDock marks them).
export function ladderHtml() {
  return PHASES.map(p => `<li data-k="${p.key}" title="${p.title}" aria-label="${p.label}">${p.icon}</li>`).join('');
}

// Write a ladder into the dock. els: { dock, turn, phase, steps, turnNo }.
export function paintDock(els, lad) {
  const { dock, turn, phase, steps, turnNo } = els;
  if (dock) { dock.dataset.who = lad.who; dock.dataset.phase = lad.now || 'over'; dock.dataset.act = lad.act ? '1' : '0'; }
  if (turn && turn.textContent !== lad.text) turn.textContent = lad.text;
  if (phase) phase.textContent = lad.label;
  if (turnNo) { turnNo.textContent = `T${lad.turn}`; turnNo.title = `Turn ${lad.turn}`; }
  if (!steps) return;
  const lis = steps.querySelectorAll('li');
  lad.steps.forEach((s, i) => {
    const li = lis[i];
    if (!li) return;
    li.classList.toggle('now', s.now);
    li.classList.toggle('done', s.done);
    if (s.now) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

// Sizes of the dock in CSS px (play.css .pl-dock uses the same numbers;
// tests/play-dock.test.mjs reads both). edge: gap to the right edge and
// above the hand line (--base). plate, rung: the plate and ladder rows.
// gap: between rows. width: the smallest dock width (plate and ladder).
export const DOCK = Object.freeze({ edge: 8, plate: 22, rung: 26, gap: 5, width: 176 });

// The dock in the view (client px) for layout L (ui/play/layout.js) at
// vw x vh: right edge at DOCK.edge + sar, bottom DOCK.edge above the
// hand line (vh - sab - L.hand.peek). sec: the small button shows
// (secW wide). For the tests: no overlap with the resting hand.
export function dockRect(L, { vw, vh, sab = 0, sar = 0, sec = false, secW = 96 } = {}) {
  const right = vw - sar - DOCK.edge;
  const bottom = vh - sab - L.hand.peek - DOCK.edge;
  const actions = L.button.minW + (sec ? secW + 8 : 0);
  const w = Math.max(DOCK.width, actions);
  const h = DOCK.plate + DOCK.gap + DOCK.rung + DOCK.gap + L.button.h + 2 * 4;
  return { left: right - w, right, top: bottom - h, bottom, w, h };
}

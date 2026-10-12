// ============================================================================
//  FLY DUEL  ·  node tests for the play dock  (node tests/play-dock.test.mjs)
// ----------------------------------------------------------------------------
//  The user (2026-10-12, verbatim): "the interface for ending my tern of
//  moving along, as well as what's tracking the current [hase, look
//  really really bad." ui/play/turnbar.js and the .pl-dock of play.js:
//
//    phases     the ladder has the steps of the rules engine: every
//               phase that game/rules.js sets is a step (or 'over')
//    ladder     in a real game (greedy bots), the lit step is the state
//               phase, the steps before it are done, the steps after it
//               are not; the result lights none
//    turn text  "Your turn" / "Fly B's turn" / the result; who: you, A, B
//    button     view().primary of each mode in a real game: go, quiet,
//               wait; the fly's turn reads "Waiting", busy is muted
//    css        44 px buttons, the dock at the safe area and above the
//               hand line, the ladder sizes of DOCK
//    geometry   at 390x760 and 844x390 (coarse, with safe areas) the
//               dock does not cover a resting hand card or the menu
//    DOM        mountPlay: one turn indicator, the ladder marks, the
//               button state, Space and Enter press the big button
//               (skipped without linkedom)
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const { greedyBot } = await import('../game/bots.js');
const { createInteraction } = await import('../ui/play/model.js');
const LAY = await import('../ui/play/layout.js');
let TB = {};
try { TB = await import('../ui/play/turnbar.js'); } catch (e) { ok(false, `ui/play/turnbar.js loads (${e.message})`); }
const { PHASES = [], phaseLadder, turnText, buttonState, dockRect, DOCK } = TB;

// ------------------------------------------------------------- phases
{
  const src = readFileSync(join(ROOT, 'game/rules.js'), 'utf8');
  const set = new Set([...src.matchAll(/\.phase = '(\w+)'/g)].map(m => m[1]).concat([...src.matchAll(/phase: '(\w+)'/g)].map(m => m[1])));
  const keys = PHASES.map(p => p.key);
  ok(keys.join(' ') === 'start main attack block end', `the ladder: start main attack block end (${keys.join(' ')})`);
  const miss = [...set].filter(k => k !== 'over' && !keys.includes(k));
  ok(set.size >= 3 && miss.length === 0, `every phase of the rules engine is a step (${[...set].join(', ')}; missing ${miss.join(', ') || 'none'})`);
  ok(PHASES.every(p => /<svg[^>]*aria-hidden="true"/.test(p.icon) && p.label && p.title), 'each step has an icon (aria-hidden), a label and a title');
  ok(PHASES.filter(p => p.auto).map(p => p.key).join(' ') === 'start end', 'start and end are the steps with no choice');
}

// ------------------------------------------------- ladder in a real game
if (phaseLadder) {
  const names = ['Fly A', 'Fly B'];
  const bot = greedyBot();
  const seen = new Set();
  let bad = '';
  for (const seed of [3, 7, 11]) {
    let s = rules.newGame({ seed, first: seed % 2 });
    for (let k = 0; k < 600 && !bad; k++) {
      for (const hs of [0, 1]) {
        const L = phaseLadder(s, hs, names);
        const at = PHASES.findIndex(p => p.key === s.phase);
        if (s.result) {
          if (L.now !== null || !L.steps.every(x => x.done && !x.now)) bad = `seed ${seed}: the result lights a step`;
          continue;
        }
        seen.add(s.phase);
        const lit = L.steps.filter(x => x.now);
        if (lit.length !== 1 || lit[0].key !== s.phase) bad = `seed ${seed} turn ${s.turn}: lit ${lit.map(x => x.key)} in phase ${s.phase}`;
        else if (!L.steps.every((x, i) => x.done === i < at)) bad = `seed ${seed} turn ${s.turn}: done marks ${L.steps.map(x => +x.done).join('')} in ${s.phase}`;
        else if (!L.steps[0].done) bad = 'start is not done in a running turn';
        else if (L.label !== PHASES[at].label) bad = `label ${L.label} in ${s.phase}`;
        else if (L.who !== (s.active === hs ? 'you' : s.active === 0 ? 'A' : 'B')) bad = `who ${L.who} for active ${s.active}, you ${hs}`;
        else if (L.text !== (s.active === hs ? 'Your turn' : `${names[s.active]}'s turn`)) bad = `text ${L.text}`;
      }
      if (s.result) break;
      s = rules.step(s, bot(s, rules.legalActions(s)));
    }
  }
  ok(!bad, `real games: the lit step is the phase, the steps before it are done (${bad || 'ok'})`);
  ok(['main', 'attack', 'block'].every(p => seen.has(p)), `real games reach main, attack and block (${[...seen].join(', ')})`);
  const over = { turn: 9, active: 0, phase: 'over', toAct: 0, result: { winner: 1, reason: 'life' } };
  ok(turnText(over, 1, names) === 'You win' && turnText(over, 0, names) === 'Fly B wins' && turnText({ ...over, result: { winner: -1 } }, 0, names) === 'Draw', 'turn text at the result');
  ok(phaseLadder(over, 0, names).who === 'B' && phaseLadder(over, 1, names).who === 'you', 'the result takes the colour of the winner');
}

// ------------------------------------------------------------- button
if (buttonState) {
  const CARD = cards.CARD;
  const bot = greedyBot();
  const tones = new Map();
  let bad = '';
  let s = rules.newGame({ seed: 5, first: 0 });
  const ix = createInteraction({ rules, CARD, seat: 0, names: ['You', 'Fly B'] });
  for (let k = 0; k < 400 && !s.result; k++) {
    ix.sync(s);
    const look = () => {
      const v = ix.view(), b = buttonState(v.primary);
      tones.set(v.primary.tone, b.state);
      const want = v.primary.tone === 'wait' ? 'wait' : v.primary.tone === 'quiet' ? 'quiet' : 'go';
      if (b.state !== want) bad = `tone ${v.primary.tone} -> ${b.state}`;
      if (v.primary.tone === 'wait' && (b.label !== 'Waiting' || /turn|thinking/i.test(b.label))) bad = `wait label ${b.label}`;
      if (v.primary.tone !== 'wait' && b.label !== v.primary.label) bad = `label ${b.label} for ${v.primary.label}`;
      if (buttonState(v.primary, { busy: true }).state !== 'wait' || !buttonState(v.primary, { busy: true }).disabled) bad = 'busy is not muted';
    };
    look();
    // a target choice gives the quiet Cancel
    if (ix.mode() === 'main') {
      const i = ix.view().hand.findIndex(h => h.targeted);
      if (i >= 0) { ix.play(i); look(); ix.cancel(); }
    }
    if (ix.mode() === 'attack' && ix.view().eligibleAttackers.length) { ix.toggleAttacker(ix.view().eligibleAttackers[0]); look(); ix.undo(); }
    s = rules.step(s, bot(s, rules.legalActions(s)));
  }
  ix.sync(s);
  if (s.result) { tones.set(ix.view().primary.tone, buttonState(ix.view().primary).state); }
  ok(!bad, `button state per view().primary tone (${bad || [...tones].map(([t, st]) => `${t}:${st}`).join(' ')})`);
  ok(['go', 'next', 'wait'].every(t => tones.has(t)), `a real game shows the go, next and wait tones (${[...tones.keys()].join(', ')})`);
  ok(buttonState({ label: 'Cancel', enabled: true, tone: 'quiet' }).state === 'quiet' && buttonState({ label: 'Attack with 2', enabled: true, tone: 'attack' }).state === 'go', 'Cancel is quiet, an attack is go');
  ok(buttonState(null).state === 'wait', 'no primary: wait');
}

// --------------------------------------------------------------- css
const play = readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8');
// a rule at the start of a line (not a longer selector that ends in sel)
const rule = sel => { const i = play.indexOf('\n' + sel + ' {'); return i < 0 ? '' : play.slice(i, play.indexOf('}', i)); };
ok(/min-height: 44px/.test(rule('.pl-btn')), 'css: every play button is 44 px high or more');
ok(/min-height: var\(--btn-h\)/.test(rule('.pl-pri')) && /min-width: var\(--btn-w\)/.test(rule('.pl-pri')) && /min-height: var\(--btn-h\)/.test(rule('.pl-sec')), 'css: the big and small buttons take --btn-h (52 px on touch)');
ok([[390, 760], [844, 390]].every(([w, h]) => LAY.layoutFor(w, h, { coarse: true }).button.h >= 52), 'layout: the big button is 52 px on a touch screen');
const d3 = rule('.pl.pl-3d .pl-dock');
ok(/right: calc\(8px \+ var\(--sar\)\)/.test(d3) && /bottom: calc\(var\(--base\) \+ 8px\)/.test(d3), `css: the 3D dock keeps clear of the safe area and sits above the hand line (${d3.slice(0, 160)})`);
ok(DOCK && new RegExp(`--dock-rung: ${DOCK.rung}px`).test(play) && new RegExp(`--dock-plate: ${DOCK.plate}px`).test(play) && new RegExp(`--dock-w: ${DOCK.width}px`).test(play), 'css: the dock sizes are the DOCK numbers of turnbar.js');
ok(/\.pl-dock\[data-who="you"\]/.test(play) && /\.pl-dock\[data-who="A"\]/.test(play) && /\.pl-dock\[data-who="B"\]/.test(play), 'css: the dock has a colour for you, Fly A and Fly B');
ok(/\.pl-steps li\.now \{/.test(play) && /\.pl-steps li\.done \{/.test(play), 'css: the ladder marks now and done');
ok(/\.pl-pri\[data-state="go"\]/.test(play) && /\.pl-pri\[data-state="wait"\]/.test(play) && /\.pl-pri\[data-state="quiet"\]/.test(play), 'css: the big button has the go, quiet and wait faces');
ok(/\.pl-hint\[data-at="button"\] \{[^}]*var\(--dock-h\)/.test(play) && /\.pl\.pl-3d \.pl-seatbtn \{[^}]*var\(--dock-h\)/.test(play), 'css: the button hint and "Back to seat" stand above the dock');
ok(!/\.pl-bar\[data-seat/.test(play) && !/\.pl-steps li:first-child/.test(play), 'css: the old phase bar rules are gone');

// ----------------------------------------------------------- geometry
if (dockRect) {
  const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const [vw, vh, sab, sar, sal] of [[390, 760, 34, 0, 0], [844, 390, 21, 47, 47]]) {
    const L = LAY.layoutFor(vw, vh, { coarse: true });
    for (const sec of [false, true]) {
      const d = dockRect(L, { vw, vh, sab, sar, sec });
      let hit = '';
      for (let n = 1; n <= 10 && !hit; n++) {
        const f = LAY.fanLayout(n, { width: vw - sal - sar, cardW: L.hand.w, cardH: L.hand.h, peek: L.hand.peek });
        for (let i = 0; i < n; i++) {
          const r0 = LAY.handCardRect(L, f, i, { vh, sab });
          const r = { left: r0.left + sal, right: r0.right + sal, top: r0.top, bottom: r0.bottom };
          if (meet(r, d)) { hit = `${n} cards, card ${i}`; break; }
        }
      }
      const menu = { left: 8 + sal, right: 8 + sal + 80, top: vh - sab - L.hand.peek - 6 - 44, bottom: vh - sab - L.hand.peek - 6 };
      ok(!hit, `${vw}x${vh}${sec ? ' with the small button' : ''}: the dock covers no resting hand card (${hit || 'clear'})`);
      ok(!meet(d, menu) && d.left >= 0 && d.top > 0 && d.right <= vw - sar, `${vw}x${vh}${sec ? ' with the small button' : ''}: the dock is in the view, clear of the menu button (${d.left | 0}..${d.right | 0} x ${d.top | 0}..${d.bottom | 0})`);
    }
  }
}

// ---------------------------------------------------------------- DOM
let parseHTML = null;
for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
  try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
}
if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
else {
  const { window, document } = parseHTML('<!doctype html><html><body><main id="play"></main></body></html>');
  globalThis.window = window; globalThis.document = document;
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = f => realST(f, 0);
  const wait = ms => new Promise(r => realST(r, ms));
  const ev = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const key = k => { const e = new window.Event('keydown', { bubbles: true, cancelable: true }); Object.assign(e, { key: k }); document.dispatchEvent(e); };
  const bots = await import('../game/bots.js');
  const { mountPlay } = await import('../ui/play/play.js');
  const root = document.getElementById('play');
  const P = mountPlay(root, { rules, cards, bots, flies: {}, connectomes: {}, seed: 21 });
  const q = s => root.querySelector(s);
  ev(q('.pl-seg[data-k="opp"] button[data-v="bot"]'), 'click');
  ev(q('.pl-go'), 'click');
  ev(q('[data-call="heads"]'), 'click');
  await wait(2);
  ev(q('.pl-go'), 'click');
  for (let i = 0; i < 200 && !q('[data-keep]'); i++) await wait(2);
  ev(q('[data-keep]'), 'click');
  const pc = P.controller, hs = pc.humanSeat;
  const shown = el => { for (let x = el; x && x !== root.parentNode; x = x.parentNode) if (x.hidden) return false; return true; };
  // own text of each shown element that names whose turn it is (the
  // button label "End turn" names an action, not a seat)
  const turnWords = () => [...root.querySelectorAll('*')].filter(e => shown(e) && !e.closest('.pl-log') && !e.closest('.pl-menu')
    && [...e.childNodes].some(n => n.nodeType === 3 && /(your turn|'s turn|turn \d|thinking|to act|your move)/i.test(n.textContent)));
  let checked = 0, bad = '', keys = 0, phases = new Set();
  for (let k = 0; k < 4000 && pc.need() !== 'over' && checked < 40 && !bad; k++) {
    await wait(1);
    if (P.busy) continue;
    const s = pc.state;
    const dock = q('.pl-dock'), lis = [...root.querySelectorAll('.pl-steps li')];
    if (!dock || lis.length !== 5) { bad = `dock ${!!dock}, ${lis.length} steps`; break; }
    const now = lis.filter(li => li.classList.contains('now'));
    const at = ['start', 'main', 'attack', 'block', 'end'].indexOf(s.phase);
    if (now.length !== 1 || now[0].dataset.k !== s.phase) bad = `turn ${s.turn} ${s.phase}: lit ${now.map(li => li.dataset.k)}`;
    else if (!lis.every((li, i) => li.classList.contains('done') === i < at)) bad = `done marks in ${s.phase}`;
    else if (now[0].getAttribute('aria-current') !== 'step') bad = 'the lit step has no aria-current';
    else if (dock.dataset.who !== (s.active === hs ? 'you' : s.active === 0 ? 'A' : 'B')) bad = `data-who ${dock.dataset.who}`;
    else if (q('.pl-phase').textContent !== lis[at].getAttribute('aria-label')) bad = `phase word ${q('.pl-phase').textContent}`;
    const tw = turnWords();
    if (!bad && (root.querySelectorAll('.pl-turn').length !== 1 || tw.length !== 1 || !tw[0].classList.contains('pl-turn'))) bad = `turn words in ${tw.map(e => e.className).join(', ')}`;
    const pri = q('.pl-pri');
    const want = pc.need() === 'human' ? (pri.dataset.tone === 'quiet' ? 'quiet' : 'go') : 'wait';
    if (!bad && pri.dataset.state !== want) bad = `button ${pri.dataset.state} when ${pc.need()} (${q('.pl-pri-t').textContent})`;
    if (!bad && pc.need() !== 'human' && q('.pl-pri-t').textContent !== 'Waiting') bad = `fly's turn: the button reads ${q('.pl-pri-t').textContent}`;
    phases.add(s.phase); checked++;
    if (pc.need() !== 'human') continue;
    const n0 = pc.history.length;
    key(keys++ % 2 ? 'Enter' : ' ');
    for (let j = 0; j < 200 && pc.history.length === n0; j++) await wait(1);
    if (pc.history.length === n0 && !bad) bad = `${keys % 2 ? 'Space' : 'Enter'} did not press the big button (${q('.pl-pri-t').textContent})`;
  }
  ok(!bad && checked > 5, `DOM: ladder marks, one turn indicator, button state, Space/Enter in a real game (${bad || `${checked} states, ${keys} key presses, phases ${[...phases].join(' ')}`})`);
  ok(q('.pl-pri').getAttribute('aria-keyshortcuts') === 'Space Enter', 'DOM: the big button names its keys (aria-keyshortcuts)');
  ok(!q('.pl-bar .pl-steps') && !!q('.pl-dock .pl-steps') && !!q('.pl-dock .pl-pri') && !!q('.pl-dock .pl-sec') && !!q('.pl-dock .pl-timer'), 'DOM: the ladder, both buttons and the timer are in the dock');
  P.destroy();
  globalThis.setTimeout = realST;
}

console.log(`play-dock: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

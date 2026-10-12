// ============================================================================
//  FLY DUEL  ·  tests for the title screen chooser  (node tests/chooser.test.mjs)
// ----------------------------------------------------------------------------
//  ui/chooser/chooser.js in node. The pure helpers run on the real decks
//  and data/training-curve.json. The drawing functions run on a stub 2D
//  context that counts bad numbers. mountChooser() runs in a linkedom DOM
//  (skipped, with a message, when linkedom is not found).
//
//  GREP MAP
//      grep -n 'KEY CARDS'   keyCardsOf agrees with main.js keyCardOf
//      grep -n 'STATS'       deckStat = the numbers in the curve file
//      grep -n 'BLURB'       description without the colour sentence
//      grep -n 'FILTER'      colour and mono / mixed filter
//      grep -n 'LABEL'       start button label
//      grep -n 'MEMORY'      localStorage, and a storage that throws
//      grep -n 'DRAW'        fan and mode pictures on a stub context
//      grep -n 'DOM'         mount, pick, start, keys, destroy
//      grep -n 'CSS'         hidden rule, no blur or glow, phone rules
//      grep -n 'TEXT'        honesty line, not-affiliated line, no WotC words
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const C = await import('../game/cards.js');
const cf = await import('../ui/cardface.js');
const X = await import('../ui/chooser/chooser.js');
const curve = JSON.parse(readFileSync(join(ROOT, 'data/training-curve.json'), 'utf8'));
const IDS = C.DECK_ORDER;

// ------------------------------------------------------------ KEY CARDS
// The same rule as main.js keyCardOf (copied here: main.js has DOM work).
function keyCardOf(deck, CARD) {
  let best = null, bestKey = null;
  for (const [id, n] of deck?.list || []) {
    const c = CARD?.[id];
    if (!c || c.type === 'land') continue;
    const k = [cf.manaValueOf(c), c.type === 'creature' ? 1 : 0, n];
    if (!bestKey || k[0] > bestKey[0] || (k[0] === bestKey[0] && (k[1] > bestKey[1] || (k[1] === bestKey[1] && k[2] > bestKey[2])))) { best = c; bestKey = k; }
  }
  return best;
}
for (const id of IDS) {
  const k = X.keyCardsOf(C.DECKS[id], C.CARD, 3);
  ok(k.length === 3, `key cards: ${id} has 3`);
  ok(k[0]?.id === keyCardOf(C.DECKS[id], C.CARD)?.id, `key cards: ${id} first = keyCardOf (${k[0]?.id})`);
  ok(new Set(k.map(c => c.id)).size === 3 && k.every(c => c.type !== 'land'), `key cards: ${id} three different non-land cards`);
}

// ------------------------------------------------------------ STATS
const perDeck = curve.meta.final.perDeck;
for (const id of IDS) {
  const s = X.deckStat(curve, id);
  ok(s && s.a === perDeck[id].A.rate && s.b === perDeck[id].B.rate && s.n === perDeck[id].A.n, `stats: ${id} rates from the curve file`);
}
ok(X.deckStat(curve, 'no-such-deck') === null, 'stats: unknown deck -> null');
ok(X.deckStat(null, 'amber') === null, 'stats: no curve -> null');
ok(X.deckStat({ meta: { final: JSON.stringify(curve.meta.final) } }, 'moss')?.a === perDeck.moss.A.rate, 'stats: final as a JSON string');

// ------------------------------------------------------------ BLURB
ok(X.deckBlurb(C.DECKS['amber-dew'], C.COLOURS).startsWith('Fast wings'), 'blurb: "Amber and dew." goes');
ok(X.deckBlurb(C.DECKS['amber-moss-rot'], C.COLOURS).startsWith('Burn and decay'), 'blurb: three colour words go');
ok(X.deckBlurb(C.DECKS.amber, C.COLOURS) === C.DECKS.amber.desc, 'blurb: a mono deck keeps its text');
for (const id of IDS) ok(X.deckBlurb(C.DECKS[id], C.COLOURS).length > 20, `blurb: ${id} not empty`);

// ------------------------------------------------------------ FILTER
const mono = X.filterDecks(IDS, C.DECKS, { kind: 'mono' });
const mixed = X.filterDecks(IDS, C.DECKS, { kind: 'mixed' });
ok(mono.length === 5 && mixed.length === IDS.length - 5, `filter: 5 mono, ${IDS.length - 5} mixed (${mono.length}, ${mixed.length})`);
ok(X.filterDecks(IDS, C.DECKS, { cols: ['amber', 'dew'] }).join() === 'amber-dew', 'filter: amber + dew -> Steam Front');
ok(X.filterDecks(IDS, C.DECKS, { cols: new Set(['pollen']), kind: 'mixed' }).every(id => C.DECKS[id].colours.includes('pollen') && C.DECKS[id].colours.length > 1), 'filter: a Set of colours works');
ok(X.filterDecks(IDS, C.DECKS, { cols: ['amber', 'dew', 'pollen'] }).length === 0, 'filter: no deck has amber, dew and pollen');

// ------------------------------------------------------------ LABEL
ok(X.startLabel({ mode: 'play', humanDeck: 'pollen', opponent: 'B', flyDeck: 'amber-moss-rot' }, C.DECKS) === 'Play Pollen Hive vs Fly B · Wildfire Compost', 'label: the play example of the brief');
ok(X.startLabel({ mode: 'watch', deckA: 'amber', deckB: 'random' }, C.DECKS) === 'Watch Fly A · Amber Swarm vs Fly B · a random deck', 'label: watch with a random deck');
ok(X.startLabel({ mode: 'play', humanDeck: 'random', opponent: 'bot', flyDeck: 'moss' }, C.DECKS) === 'Play a random deck vs the greedy bot · Moss Grove', 'label: the bot');
const n0 = X.normalise({ mode: 'x', deckA: 'nope', deckB: 'moss', opponent: 'Z' }, IDS);
ok(n0.mode === 'watch' && n0.deckA === 'random' && n0.deckB === 'moss' && n0.opponent === 'B' && n0.humanDeck === 'random' && n0.flyDeck === 'random', 'normalise: unknown values');

// ------------------------------------------------------------ MEMORY
{
  const mem = new Map();
  const st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  ok(X.saveChoice({ mode: 'play', humanDeck: 'moss' }, st) && X.loadChoice(st)?.humanDeck === 'moss', 'memory: save and load');
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  ok(X.saveChoice({ mode: 'watch' }, bad) === false && X.loadChoice(bad) === null, 'memory: a storage that throws gives false and null');
  mem.set(X.STORE_KEY, '{not json');
  ok(X.loadChoice(st) === null, 'memory: bad JSON -> null');
}

// ------------------------------------------------------------ DRAW
function stubCtx() {
  const calls = { n: 0, bad: 0, cards: 0 };
  const grad = { addColorStop() {} };
  const t = { calls, font: '10px serif', canvas: { width: 100, height: 100 } };
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return s => ({ width: String(s).length * (parseFloat(o.font.match(/(\d+(\.\d+)?)px/)?.[1]) || 10) * 0.55 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) calls.bad++; };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
{
  for (const id of IDS) {
    const g = stubCtx();
    X.drawFan(g, 440, 275, X.keyCardsOf(C.DECKS[id], C.CARD, 3), 2);
    ok(g.calls.n > 50 && g.calls.bad === 0, `draw: fan of ${id} (${g.calls.n} calls, ${g.calls.bad} bad)`);
  }
  const g0 = stubCtx(); X.drawFan(g0, 220, 130, [], 1);
  ok(g0.calls.n > 20 && g0.calls.bad === 0, 'draw: random fan of card backs');
  // the mode pictures are screen captures of the real page, not drawn
  ok(!('drawWatchArt' in X) && !('drawPlayArt' in X), 'art: no drawn mode pictures');
  for (const m of ['watch', 'play']) {
    const f = fileURLToPath(X.MODE_ART[m]);
    let ok2 = false, size = 0, w = 0, h = 0;
    try {
      const b = readFileSync(f); size = b.length;
      // JPEG SOF0/SOF2 marker gives the size
      for (let i = 2; i < b.length - 9; i++) if (b[i] === 0xFF && (b[i + 1] === 0xC0 || b[i + 1] === 0xC2)) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
      ok2 = b[0] === 0xFF && b[1] === 0xD8;
    } catch { /* missing */ }
    ok(ok2 && w === 2 * h && w >= 1200 && size < 400000, `art: ${m} capture is a 2:1 JPEG (${w}x${h}, ${size} bytes)`);
  }
}

// ------------------------------------------------------------ DOM
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* the next one */ }
}
if (!linkedom) console.log('chooser.test: DOM part skipped (linkedom not found)');
else {
  const W = linkedom.parseHTML('<!doctype html><html><body><div id="host"></div><button id="out">x</button></body></html>');
  globalThis.document = W.document;
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const host = W.document.getElementById('host');
  const started = [], how = [], closed = [];
  const click = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));
  const key = k => W.document.dispatchEvent(Object.assign(new W.Event('keydown', { bubbles: true }), { key: k }));
  const make = (extra = {}) => X.mountChooser(host, {
    decks: C.DECKS, deckOrder: IDS, colours: C.COLOURS, cards: C.CARD, curve,
    onStart: c => started.push(c), onHow: () => how.push(1), onClose: () => closed.push(1), ...extra,
  });
  let ch = make();
  ok(host.hidden === true && host.classList.contains('fdc'), 'dom: mounted, hidden until open');
  ch.open();
  ok(host.hidden === false && host.dataset.step === 'mode', 'dom: open() with no mode starts on the mode step');
  const tiles = [...host.querySelectorAll('.fdc-tile')];
  ok(tiles.length === IDS.length + 1, `dom: one tile per deck and Random (${tiles.length})`);
  for (const id of IDS) {
    const t = host.querySelector(`.fdc-tile[data-deck="${id}"]`);
    ok(t?.querySelector('.fdc-name')?.textContent === C.DECKS[id].name, `dom: ${id} tile has the full name`);
    ok(/Fly A \d+%/.test(t?.textContent || '') && /measured/.test(t?.textContent || ''), `dom: ${id} tile has the measured stat`);
    ok(t.querySelectorAll('canvas.fdc-glyph').length === C.DECKS[id].colours.length, `dom: ${id} one glyph per colour`);
  }
  ok(host.querySelectorAll('.fdc-fpip').length === 5, 'dom: five colour filter glyphs');
  // watch: pick A then B (the seat moves to B after the first pick)
  click(host.querySelector('.fdc-mode[data-mode="watch"]'));
  ok(host.dataset.step === 'decks' && host.dataset.mode === 'watch', 'dom: a mode card goes to the deck step');
  click(host.querySelector('.fdc-tile[data-deck="amber"]'));
  click(host.querySelector('.fdc-tile[data-deck="moss-rot"]'));
  ok(ch.choice().deckA === 'amber' && ch.choice().deckB === 'moss-rot', `dom: watch picks A then B (${ch.choice().deckA}, ${ch.choice().deckB})`);
  ok(host.querySelector('.fdc-go-l').textContent === 'Watch Fly A · Amber Swarm vs Fly B · Compost Heap', 'dom: start label for watch');
  ok(host.querySelector('.fdc-tile[data-deck="amber"] .fdc-marks')?.textContent === 'A', 'dom: the Fly A mark on its deck');
  click(host.querySelector('.fdc-go'));
  ok(started.length === 1 && started[0].mode === 'watch' && started[0].deckA === 'amber' && started[0].deckB === 'moss-rot', 'dom: onStart gets the watch choice');
  ok(JSON.parse(mem.get(X.STORE_KEY) || '{}').deckB === 'moss-rot', 'dom: the choice is in localStorage');
  // play
  click(host.querySelector('.fdc-mode[data-mode="play"]'));
  ok(!host.querySelector('.fdc-opp').hidden, 'dom: play shows the opponent switch');
  click(host.querySelector('.fdc-tile[data-deck="pollen"]'));
  click(host.querySelector('.fdc-opp button[data-opp="A"]'));
  click(host.querySelector('.fdc-tile[data-deck="amber-moss-rot"]'));
  ok(host.querySelector('.fdc-go-l').textContent === 'Play Pollen Hive vs Fly A · Wildfire Compost', `dom: play label (${host.querySelector('.fdc-go-l').textContent})`);
  click(host.querySelector('.fdc-go'));
  const p = started[1];
  ok(p && p.mode === 'play' && p.humanDeck === 'pollen' && p.opponent === 'A' && p.flyDeck === 'amber-moss-rot', 'dom: onStart gets the play choice');
  // filter
  click(host.querySelector('.fdc-kind button[data-kind="mono"]'));
  const vis = () => [...host.querySelectorAll('.fdc-tile')].filter(t => !t.hidden).map(t => t.dataset.deck);
  ok(vis().length === 6 && vis().includes('random'), `dom: mono filter shows 5 decks and Random (${vis().length})`);
  click(host.querySelector('.fdc-kind button[data-kind="all"]'));
  click(host.querySelector('.fdc-fpip[data-col="amber"]'));
  click(host.querySelector('.fdc-fpip[data-col="dew"]'));
  ok(vis().join() === 'random,amber-dew', `dom: amber + dew glyphs (${vis().join()})`);
  click(host.querySelector('.fdc-fpip[data-col="pollen"]'));
  ok(!host.querySelector('.fdc-none').hidden, 'dom: "no deck" line when nothing matches');
  // keys
  key('w');
  ok(ch.choice().mode === 'watch', 'dom: W picks watch');
  // linkedom has no focus: a stub activeElement and focus() on the buttons
  let act = null;
  Object.defineProperty(W.document, 'activeElement', { get: () => act, configurable: true });
  for (const b of host.querySelectorAll('button')) b.focus = function () { act = this; };
  host.querySelector('.fdc-kind button[data-kind="all"]').dispatchEvent(new W.Event('click', { bubbles: true }));
  for (const c of ['amber', 'dew', 'pollen']) click(host.querySelector(`.fdc-fpip[data-col="${c}"]`));
  const t0 = host.querySelector('.fdc-tile[data-deck="random"]');
  t0.focus();
  key('ArrowRight');
  ok(act?.dataset?.deck === IDS[0], `dom: ArrowRight moves the focus to the next tile (${act?.dataset?.deck})`);
  key('End');
  ok(act?.dataset?.deck === IDS[IDS.length - 1], 'dom: End goes to the last tile');
  key('ArrowRight');
  ok(act?.dataset?.deck === 'random', 'dom: ArrowRight wraps to the first tile');
  host.querySelector('.fdc-seat-b[data-seat="0"]').focus();
  key('ArrowRight');
  ok(act?.dataset?.seat === '1' && ch._state.seat === 1, 'dom: ArrowRight on a seat picks the other seat');
  key('Enter');
  // How, closable, Escape
  click(host.querySelector('.fdc-how'));
  ok(how.length === 1, 'dom: How it works calls onHow');
  ch.close(); ch.open({ mode: 'play', closable: true });
  ok(host.dataset.step === 'decks' && !host.querySelector('.fdc-x').hidden, 'dom: open({mode, closable}) shows decks and Close');
  key('Escape');
  ok(closed.length === 1 && host.hidden, 'dom: Escape closes a closable chooser');
  ch.destroy();
  ok(host.innerHTML === '' && !host.classList.contains('fdc'), 'dom: destroy empties the root');
  // memory feeds the next mount; initial wins over it
  ch = make();
  ok(ch.choice().mode === 'play' && ch.choice().humanDeck === 'pollen', 'dom: the remembered choice comes back');
  ch.destroy();
  ch = make({ initial: { mode: 'watch', deckA: 'dew' } });
  ok(ch.choice().mode === 'watch' && ch.choice().deckA === 'dew' && ch.choice().humanDeck === 'pollen', 'dom: initial wins, memory fills the rest');
  ch.destroy();
  ch = make({ flies: { A: false, B: true }, initial: { opponent: 'A' } });
  ok(ch.choice().opponent === 'B' && host.querySelector('.fdc-opp button[data-opp="A"]').disabled, 'dom: a fly that did not load is not an opponent');
  ch.destroy();
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  ch = make();
  ch.open(); click(host.querySelector('.fdc-go'));
  ok(started.length === 3, 'dom: start works when localStorage throws');
  ch.destroy();
}

// ------------------------------------------------------------ CSS
const css = readFileSync(join(ROOT, 'ui/chooser/chooser.css'), 'utf8');
ok(/\[hidden\]\{display:none!important\}/.test(css), 'css: [hidden] display none !important');
ok(!/blur\(|text-shadow|drop-shadow|radial-gradient|linear-gradient/.test(css), 'css: no blur, glow or gradient');
ok(/\.fdc-phone \.fdc-grid\{[^}]*scroll-snap-type:x mandatory/.test(css), 'css: phone carousel snaps');
ok(/\.fdc-phone \.fdc-fpip\{width:44px;height:44px\}/.test(css), 'css: 44 px touch targets on a phone');
for (const m of css.matchAll(/:hover\{/g)) {
  const before = css.slice(Math.max(0, m.index - 200), m.index);
  ok(/@media \(hover:hover\)\{[^}]*$/.test(before), 'css: every :hover rule is inside @media (hover:hover)');
}

// ------------------------------------------------------------ TEXT
const src = readFileSync(join(ROOT, 'ui/chooser/chooser.js'), 'utf8');
ok(/We do not train a real fly/.test(src) && /Not affiliated with or endorsed by Wizards of the Coast/.test(src), 'text: honesty and not-affiliated lines');
ok(!/\bMTG\b|planeswalker|\bmana symbols?\b/i.test(src), 'text: no WotC terms');
ok((src.match(/Magic: The Gathering/g) || []).length === 1, 'text: the trademark once, in the disclaimer');

console.log(`chooser: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

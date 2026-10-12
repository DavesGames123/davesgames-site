// ============================================================================
//  FLY DUEL  ·  tests for the deck builder  (node tests/deckbuilder.test.mjs)
// ----------------------------------------------------------------------------
//  ui/deckbuilder/deckstore.js (pure) on the real card pool, the builder
//  DOM (ui/deckbuilder/deckbuilder.js) in a linkedom document, and whole
//  games of a scripted human with a custom deck against the pretrained
//  flies, on the real play controller (ui/play/controller.js). The DOM
//  part is skipped, with a message, when linkedom is not found.
//
//  GREP MAP
//      grep -n 'LISTS'      add, remove, copy limit, sort
//      grep -n 'STATS'      counts, curve, sources, messages
//      grep -n 'LANDS'      Fill lands on every preset and odd decks
//      grep -n 'FILTERS'    matchCard
//      grep -n 'CODES'      share code round trip, damage, hash
//      grep -n 'STORAGE'    save, load, a storage that throws
//      grep -n 'GAMES'      5 random custom decks vs the pretrained fly
//      grep -n 'DOM'        mount, add, preset, fill, play, import
//      grep -n 'CSS'        hidden rule, no blur or glow, 44 px, hover
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const C = await import('../game/cards.js');
const DS = await import('../ui/deckbuilder/deckstore.js');
const rules = await import('../game/rules.js');
const { mulberry32 } = await import('../data/rng.js');
const { CARD, CARDS, DECKS, DECK_ORDER } = C;
const landsOf = l => l.filter(([id]) => CARD[id].type === 'land');
const othersOf = l => l.filter(([id]) => CARD[id].type !== 'land');

// ------------------------------------------------------------ LISTS
{
  let l = [];
  for (let i = 0; i < 4; i++) l = DS.addCard(l, 'ember-gnat');
  ok(DS.countOf(l, 'ember-gnat') === 4, 'lists: four copies');
  ok(DS.addCard(l, 'ember-gnat') === null, 'lists: a fifth copy is refused');
  let b = [];
  for (let i = 0; i < 20; i++) b = DS.addCard(b, 'dew-pond');
  ok(DS.countOf(b, 'dew-pond') === 20, 'lists: a basic land has no copy limit');
  ok(DS.addCard(l, 'no-such-card') === null, 'lists: an unknown id is refused');
  const tok = C.TOKENS[0];
  ok(!tok || DS.addCard([], tok.id) === null, 'lists: a token is refused');
  const l2 = DS.removeCard(l, 'ember-gnat');
  ok(DS.countOf(l2, 'ember-gnat') === 3 && DS.countOf(l, 'ember-gnat') === 4, 'lists: remove gives a new list, the input does not change');
  ok(DS.removeCard([['ember-gnat', 1]], 'ember-gnat').length === 0, 'lists: the last copy removes the row');
  const s = DS.sortList([['amber-ridge', 3], ['torch-queen', 1], ['flare-spit', 1], ['ember-gnat', 2]]);
  ok(s.map(r => CARD[r[0]].type).join() === 'creature,creature,spell,land', `lists: creatures, spells, lands (${s.map(r => r[0]).join()})`);
  ok(C.manaValue(s[0][0]) <= C.manaValue(s[1][0]), 'lists: cost goes up in a type');
  const pool = DS.poolOrder();
  ok(pool.length === CARDS.filter(c => !c.token).length && new Set(pool).size === pool.length, `lists: the pool has every card once (${pool.length})`);
  ok(CARD[pool[pool.length - 1]].type === 'land' && CARD[pool[0]].type !== 'land', 'lists: lands at the end of the pool');
}

// ------------------------------------------------------------ STATS
for (const id of DECK_ORDER) {
  const v = DS.deckMessages(DECKS[id].list);
  ok(v.ok && v.messages.length === 0, `stats: preset ${id} is legal with no message`);
  const s = v.stats;
  ok(s.cards === 40 && s.curve.reduce((a, b) => a + b, 0) === s.others, `stats: ${id} curve counts every non-land card`);
  ok(s.colours.join() === C.deckColours(id).join(), `stats: ${id} colours = deckColours`);
}
{
  const m = DS.deckMessages([['ember-gnat', 2]]);
  const kinds = m.messages.map(x => x.kind).sort().join();
  ok(!m.ok && kinds === 'count,lands,sources', `stats: a small deck has count, lands and sources messages (${kinds})`);
  ok(/Add 38 cards/.test(m.messages[0].text), 'stats: the count message says how many to add');
  const big = DS.deckMessages([['amber-ridge', 17], ['ember-gnat', 4], ['cinder-ant', 4], ['ash-cricket', 4], ['dune-wasp', 4], ['hive-soldier', 4], ['sting-hopper', 4]]);
  ok(big.messages.some(x => /Take out 1 card/.test(x.text)), 'stats: 41 cards asks to take one out');
  const five = DS.deckMessages([['amber-ridge', 17], ['ember-gnat', 23]]);
  ok(five.messages.some(x => x.kind === 'copies' && /23 copies, at most 4/.test(x.text)), 'stats: the copy limit message');
  ok(DS.deckMessages([]).messages.length === 2, 'stats: an empty deck: count and lands');
}

// ------------------------------------------------------------ LANDS
for (const id of DECK_ORDER) {
  const l = DS.suggestLands(othersOf(DECKS[id].list));
  const v = DS.deckMessages(l);
  ok(v.ok, `lands: Fill lands on the cards of ${id} gives a legal deck (${v.messages.map(m => m.text).join('; ')})`);
  ok(JSON.stringify(othersOf(l)) === JSON.stringify(DS.sortList(othersOf(DECKS[id].list))), `lands: ${id} keeps the cards that are not lands`);
  const cols = C.deckColours(id);
  const duals = landsOf(l).filter(([i]) => !CARD[i].basic);
  if (cols.length === 2) ok(duals.length === 1 && duals[0][1] === 4, `lands: ${id} gets 4 duals of its pair`);
  if (cols.length === 1) ok(landsOf(l).length === 1 && landsOf(l)[0][1] === 17, `lands: ${id} gets 17 basics`);
}
{
  // all five colours: the repair pass must reach 6 lands of each
  const r = mulberry32(7);
  for (let t = 0; t < 30; t++) {
    const nonLand = CARDS.filter(c => c.type !== 'land' && c.colours.length === 1);
    let l = [];
    for (const k of C.COLOUR_IDS) l = DS.addCard(l, nonLand.filter(c => c.colours[0] === k)[Math.floor(r() * 5)].id);
    while (DS.totalOf(l) < 23) { const c = nonLand[Math.floor(r() * nonLand.length)]; l = DS.addCard(l, c.id) || l; }
    const v = DS.deckMessages(DS.suggestLands(l));
    if (!v.ok) { ok(false, `lands: five colours, try ${t}: ${v.messages.map(m => m.text).join('; ')}`); break; }
    if (t === 29) ok(true, 'lands: 30 five-colour decks get 6 lands of each colour');
  }
  const n20 = DS.suggestLands([['ember-gnat', 4], ['cinder-ant', 4], ['ash-cricket', 4], ['dune-wasp', 4], ['hive-soldier', 4]]);
  ok(landsOf(n20).reduce((a, [, n]) => a + n, 0) === 18, 'lands: 20 other cards -> 18 lands (the most)');
  const n26 = DS.suggestLands([...othersOf(DECKS.amber.list), ['ember-gnat', 3]]);
  ok(landsOf(n26).reduce((a, [, n]) => a + n, 0) === 16, 'lands: 26 other cards -> 16 lands (the least)');
  const cl = DS.suggestLands([['pill-bug', 4]]);
  ok(landsOf(cl).reduce((a, [, n]) => a + n, 0) === 18, 'lands: colourless cards only still get lands');
  ok(JSON.stringify(DS.suggestLands([...DECKS['amber-dew'].list])) === JSON.stringify(DS.suggestLands(othersOf(DECKS['amber-dew'].list))), 'lands: old lands are replaced, not added to');
}

// ------------------------------------------------------------ FILTERS
{
  const f = (o, pred, msg) => { const got = CARDS.filter(c => DS.matchCard(c, o)); ok(got.length > 0 && got.every(pred), `filters: ${msg} (${got.length})`); return got; };
  f({ cols: new Set(['dew']) }, c => (c.type === 'land' ? c.mana : c.colours).includes('dew'), 'dew');
  f({ cols: new Set(['multi']) }, c => (c.type === 'land' ? c.mana : c.colours).length > 1, 'two or more colours');
  f({ cols: new Set(['none']) }, c => c.type !== 'land' && c.colours.length === 0, 'colourless');
  f({ type: 'spell' }, c => c.type === 'spell', 'spells');
  f({ mv: new Set([6]) }, c => c.type !== 'land' && C.manaValue(c) >= 6, 'mana value 6+');
  f({ kw: 'wings' }, c => c.keywords.includes('wings'), 'wings');
  f({ kw: 'dice' }, c => C.cardRolls(c), 'rolls dice');
  f({ q: 'ember gnat' }, c => /ember gnat/i.test(c.name), 'search two words');
  const both = CARDS.filter(c => DS.matchCard(c, { cols: new Set(['amber', 'rot']), type: 'creature', kw: 'sting' }));
  ok(both.every(c => c.type === 'creature' && c.keywords.includes('sting')), 'filters: colour, type and keyword together');
  ok(CARDS.filter(c => DS.matchCard(c, {})).length === CARDS.length, 'filters: no filter shows every card');
}

// ------------------------------------------------------------ CODES
{
  const ids = CARDS.map(c => c.id);
  ok(new Set(ids.map(DS.hash16)).size === ids.length, `codes: no two cards share a hash (${ids.length} cards)`);
  for (const id of DECK_ORDER) {
    const code = DS.encodeDeck({ list: DECKS[id].list, name: DECKS[id].name });
    const r = DS.decodeDeck(code);
    ok(r.ok && JSON.stringify(r.list) === JSON.stringify(DS.sortList(DECKS[id].list)) && r.name === DECKS[id].name, `codes: ${id} round trip`);
    ok(/^[A-Za-z0-9_.-]+$/.test(code) && code.length < 140, `codes: ${id} code is URL-safe and short (${code.length})`);
  }
  const code = DS.encodeDeck({ list: DECKS.moss.list, name: 'Mösß — ü 🐝' });
  ok(DS.decodeDeck(code).name === 'Mösß — ü 🐝', 'codes: a name with any letters');
  ok(DS.decodeDeck(` ${code.slice(0, 10)}\n${code.slice(10)} `).ok, 'codes: spaces and line breaks are ignored');
  const bad = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A') + code.slice(6);
  ok(!DS.decodeDeck(bad).ok, 'codes: one changed character fails the checksum');
  ok(!DS.decodeDeck('').ok && !DS.decodeDeck('xyz').ok && !DS.decodeDeck('1@@@').ok, 'codes: junk is refused with a message');
  ok(/not a deck code/.test(DS.decodeDeck('9AAAA').error), 'codes: the error says what is wrong');
  const c2 = DS.customFromCode(code), c3 = DS.customFromCode(code);
  ok(c2 && c2.id === c3.id && c2.id.startsWith(DS.CUSTOM_PREFIX) && c2.ok && c2.custom, 'codes: customFromCode gives a stable id');
  ok(DS.customFromCode('junk') === null, 'codes: customFromCode of junk is null');
}

// ------------------------------------------------------------ STORAGE
{
  const mem = new Map();
  const st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  let ds = DS.loadDecks(st);
  ok(Array.isArray(ds) && ds.length === 0, 'storage: empty at first');
  ds = DS.upsertDeck(ds, { id: 'a1', name: 'One', list: DECKS.amber.list });
  ds = DS.upsertDeck(ds, { id: 'b2', name: 'Two', list: [['ember-gnat', 2], ['nope', 3]] });
  ok(DS.saveDecks(ds, st) && DS.loadDecks(st).length === 2, 'storage: save and load');
  ok(DS.loadDecks(st)[0].id === 'b2' && DS.loadDecks(st)[0].list.length === 1, 'storage: newest first, unknown ids dropped');
  ds = DS.upsertDeck(ds, { id: 'a1', name: 'One again', list: [] });
  ok(ds.length === 2 && ds[0].name === 'One again', 'storage: upsert replaces by id');
  ok(DS.deleteDeck(ds, 'a1').length === 1, 'storage: delete');
  mem.set(DS.DECKS_KEY, '{not json');
  ok(DS.loadDecks(st).length === 0, 'storage: bad JSON gives an empty list');
  mem.set(DS.DECKS_KEY, JSON.stringify([{ id: '../x', name: 'bad' }, { id: 'ok1', name: 'x'.repeat(99), list: 'no' }]));
  const ld = DS.loadDecks(st);
  ok(ld.length === 1 && ld[0].name.length === DS.NAME_MAX && ld[0].list.length === 0, 'storage: bad ids and fields are cleaned');
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  ok(DS.loadDecks(thrower).length === 0 && DS.saveDecks(ds, thrower) === false, 'storage: a storage that throws gives [] and false');
  ok(DS.freeName([{ name: 'My deck' }, { name: 'My deck 2' }]) === 'My deck 3', 'storage: free name');
  const cd = DS.customDeckOf({ id: 'a1', name: 'One', list: DECKS['moss-rot'].list });
  ok(cd.id === 'my-a1' && cd.colours.join() === 'moss,rot' && cd.colour === 'multi' && cd.ok && DS.decodeDeck(cd.code).ok, 'storage: customDeckOf');
  ok(/creature/.test(cd.desc), 'storage: custom deck description counts the types');
}

// ------------------------------------------------------------ GAMES
// 5 random legal custom decks. A scripted human (the greedy bot, or a
// random legal move every fourth game) plays each one on the real play
// controller against a pretrained fly with a preset deck.
{
  const { Fly } = await import('../brain/fly.js');
  const { createPlayController } = await import('../ui/play/controller.js');
  const { agentFromFly } = await import('../ui/match.js');
  const { greedyBot, randomBot } = await import('../game/bots.js');
  const pre = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8'));
  const flies = {};
  for (const side of ['A', 'B']) {
    const con = JSON.parse(readFileSync(join(ROOT, pre.wiring?.[side]?.file || 'data/connectome.json'), 'utf8'));
    flies[side] = Fly.fromJSON(con, pre[side]);
  }
  const r = mulberry32(20261012);
  function randomDeck() {
    const k = 1 + Math.floor(r() * 3);
    const cols = C.COLOUR_IDS.slice().sort(() => r() - 0.5).slice(0, k);
    const pool = CARDS.filter(c => c.type !== 'land' && c.colours.every(x => cols.includes(x)));
    let l = [];
    for (let g = 0; DS.totalOf(l) < 23 && g < 500; g++) l = DS.addCard(l, pool[Math.floor(r() * pool.length)].id) || l;
    return DS.suggestLands(l);
  }
  const results = [];
  for (let i = 0; i < 5; i++) {
    const list = randomDeck();
    const v = C.validateDeck(list);
    ok(v.ok, `games: random custom deck ${i} is legal (${v.errors.join('; ')})`);
    const side = i % 2 ? 'B' : 'A';
    const humanSeat = i % 2;
    const flyDeck = DECK_ORDER[(i * 5) % DECK_ORDER.length];
    const decks = humanSeat === 0 ? [list, flyDeck] : [flyDeck, list];
    const pc = createPlayController({ rules, CARD, opponent: agentFromFly(flies[side], `Fly ${side}`), humanSeat, humanName: 'You', seed: 900 + i, decks });
    pc.coin(i % 2 ? 'heads' : 'tails');
    pc.keep();
    const human = i === 3 ? randomBot(mulberry32(5)) : greedyBot();
    let guard = 0, err = '', flyMoves = 0;
    try {
      while (pc.need() !== 'over' && guard++ < 20000) {
        if (pc.need() === 'human') {
          const s = pc.state;
          const res = pc.submit(human(s, rules.legalActions(s)));
          if (!res.ok) { err = res.error; break; }
        } else { const rec = pc.flyStep(); if (rec) flyMoves++; }
      }
    } catch (e) { err = e.message; }
    const res = pc.result;
    ok(!err && res && [0, 1, -1].includes(res.winner), `games: custom deck ${i} vs fly ${side} ends (${err || JSON.stringify(res)})`);
    ok(JSON.stringify(pc.state.decks[humanSeat]) === JSON.stringify(list), `games: deck ${i} is the custom list in the state`);
    const ids = new Set(list.map(([id]) => id));
    const p = pc.state.players[humanSeat];
    ok([...p.hand, ...p.library, ...p.graveyard, ...p.battlefield.map(x => x.id)].every(id => ids.has(id) || CARD[id]?.token), `games: deck ${i}: every card of your side comes from your list`);
    ok(flyMoves > 5, `games: fly ${side} made its moves (${flyMoves})`);
    results.push(`${side}:${res?.winner === humanSeat ? 'you' : res?.winner === -1 ? 'draw' : 'fly'} t${pc.state.turn}`);
  }
  console.log(`  info: 5 custom decks vs the pretrained flies: ${results.join(', ')}`);
}

// ------------------------------------------------------------ DOM
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* the next one */ }
}
if (!linkedom) console.log('deckbuilder.test: DOM part skipped (linkedom not found)');
else {
  const W = linkedom.parseHTML('<!doctype html><html><head></head><body><div id="host"></div></body></html>');
  globalThis.document = W.document; globalThis.window = W.window;
  const mem = new Map();
  const st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const B = await import('../ui/deckbuilder/deckbuilder.js');
  const host = W.document.getElementById('host');
  const played = [], closed = [], savedCalls = [];
  const click = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));
  const pick = (sel, v) => {
    for (const o of sel.querySelectorAll('option')) { if (o.value === v) o.setAttribute('selected', 'selected'); else o.removeAttribute('selected'); }
    sel.dispatchEvent(new W.Event('change', { bubbles: true }));
  };
  const key = (k, extra = {}) => W.document.dispatchEvent(Object.assign(new W.Event('keydown', { bubbles: true }), { key: k }, extra));
  const b = B.mountDeckBuilder(host, { storage: st, onPlay: d => played.push(d), onClose: () => closed.push(1), onSaved: d => savedCalls.push(d.length) });
  ok(host.hidden && host.classList.contains('fdb'), 'dom: mounted, hidden until open');
  ok(!!W.document.getElementById('fdb-css') && /deckbuilder\.css$/.test(W.document.getElementById('fdb-css').href), 'dom: the stylesheet link is added once');
  ok(B.ensureStyles(W.document) === false, 'dom: ensureStyles a second time adds nothing');
  b.open();
  ok(!host.hidden, 'dom: open shows the layer');
  const tiles = host.querySelectorAll('.fdb-pc');
  ok(tiles.length === CARDS.length, `dom: one pool tile per card (${tiles.length})`);
  ok([...tiles].every(t => t.querySelector('.fdb-add .fcard.cv canvas')), 'dom: each tile is a real card (cardEl canvas), not a CSS frame');
  ok(host.querySelectorAll('.fdb-pips button').length === 7, 'dom: 5 colour glyphs, two-or-more and colourless');
  // filters
  click(host.querySelector('.fdb-pips button[data-col="dew"]'));
  const vis = () => [...tiles].filter(t => !t.hidden).map(t => t.dataset.id);
  ok(vis().length > 10 && vis().every(id => (CARD[id].type === 'land' ? CARD[id].mana : CARD[id].colours).includes('dew')), `dom: dew glyph filters the pool (${vis().length})`);
  click(host.querySelector('.fdb-seg button[data-type="creature"]'));
  click(host.querySelector('.fdb-mvs button[data-mv="2"]'));
  ok(vis().every(id => CARD[id].type === 'creature' && C.manaValue(id) === 2), 'dom: type and mana value filters');
  ok(/of \d+ cards/.test(host.querySelector('.fdb-poolcount').textContent), 'dom: the pool count line');
  const q = host.querySelector('.fdb-q'); q.value = 'zzzz no card'; q.dispatchEvent(new W.Event('input', { bubbles: true }));
  ok(vis().length === 0 && !host.querySelector('.fdb-empty').hidden, 'dom: search with no hit shows the empty line');
  click(host.querySelector('[data-act="clearf"]'));
  ok(vis().length === CARDS.length, 'dom: Clear filters shows every card');
  // add and remove
  const add = id => click(host.querySelector(`.fdb-add[data-id="${id}"]`));
  for (let i = 0; i < 5; i++) add('ember-gnat');
  ok(DS.countOf(b.state().list, 'ember-gnat') === 4, 'dom: a tap adds a copy, 4 is the limit');
  ok(host.querySelector('.fdb-pc[data-id="ember-gnat"]').dataset.full === 'true' && host.querySelector('.fdb-pc[data-id="ember-gnat"] .fdb-pcn').textContent === '4/4', 'dom: the tile shows 4/4 at the limit');
  ok(host.querySelector('.fdb-count').textContent === '4/40', 'dom: the count');
  ok(host.querySelectorAll('.fdb-msgs li').length === 3 && host.dataset.valid === 'no', 'dom: three messages for a deck of 4');
  click(host.querySelector('.fdb-row[data-id="ember-gnat"] .fdb-rm'));
  click(host.querySelector('.fdb-row[data-id="ember-gnat"] .fdb-rmain'));
  ok(DS.countOf(b.state().list, 'ember-gnat') === 2, 'dom: minus and a tap on the row each take one out');
  click(host.querySelector('[data-act="undo"]'));
  ok(DS.countOf(b.state().list, 'ember-gnat') === 3, 'dom: Undo');
  ok(DS.loadDecks(st).length === 1 && savedCalls.length > 0, 'dom: each change saves the deck');
  // play is refused while the deck is not legal, with the reason
  click(host.querySelector('.fdb-play'));
  ok(played.length === 0 && /Fix the deck first/.test(host.querySelector('.fdb-why').textContent), 'dom: Play on an illegal deck says why at the button');
  ok(host.querySelector('.fdb-play').getAttribute('aria-disabled') === 'true', 'dom: Play is aria-disabled');
  // fill lands, then 40 cards
  const amber = othersOf(DECKS.amber.list);
  for (const [id, n] of amber) for (let i = DS.countOf(b.state().list, id); i < n; i++) add(id);
  while (DS.totalOf(othersOf(b.state().list)) > 23) click(host.querySelector('.fdb-row[data-id="ember-gnat"] .fdb-rm'));
  click(host.querySelector('[data-act="lands"]'));
  ok(host.dataset.valid === 'yes' && host.querySelector('.fdb-msgs li.ok'), `dom: Fill lands makes the deck legal (${host.querySelector('.fdb-msgs').textContent})`);
  ok(host.querySelectorAll('.fdb-curve.fdb-cmain .fdb-cb').length === 7 && host.querySelectorAll('.fdb-bar-curve .fdb-cb').length === 7, 'dom: curve and mini curve have 7 bars');
  ok(host.querySelectorAll('.fdb-src').length === 1 && /17/.test(host.querySelector('.fdb-src').textContent), 'dom: one colour, 17 lands make it');
  ok([...host.querySelectorAll('.fdb-grp h3')].map(h => h.textContent.split(' ')[0]).join() === 'Creatures,Spells,Lands', 'dom: the list groups by type');
  // name
  const nm = host.querySelector('.fdb-name'); nm.value = 'Hot Wings'; nm.dispatchEvent(new W.Event('input', { bubbles: true }));
  ok(DS.loadDecks(st)[0].name === 'Hot Wings', 'dom: the name saves');
  click(host.querySelector('.fdb-bar-play'));
  ok(played.length === 1 && played[0].name === 'Hot Wings' && played[0].ok && C.validateDeck(played[0].list).ok && played[0].id.startsWith('my-'), 'dom: Play gives onPlay a legal custom deck');
  // presets and saved decks
  pick(host.querySelector('.fdb-preset'), 'moss-rot');
  ok(b.state().name === 'Compost Heap (copy)' && C.validateDeck(b.state().list).ok, 'dom: a preset copy is a new legal deck');
  ok(DS.loadDecks(st).length === 2, 'dom: the copy is saved as a second deck');
  const firstId = DS.loadDecks(st).find(d => d.name === 'Hot Wings').id;
  pick(host.querySelector('.fdb-pick'), firstId);
  ok(b.state().name === 'Hot Wings', 'dom: My decks switches to a saved deck');
  // share and import
  click(host.querySelector('[data-act="share"]'));
  const code = host.querySelector('.fdb-code').value;
  ok(!host.querySelector('.fdb-share').hidden && DS.decodeDeck(code).name === 'Hot Wings', 'dom: Share shows the code of the deck');
  ok(b._import('junk') === false && /not a deck code/.test(host.querySelector('.fdb-share-msg').textContent), 'dom: a bad code shows an error');
  ok(b._import(code) === true && b.state().name === 'Hot Wings 2' && DS.loadDecks(st).length === 3, 'dom: import makes a new deck with a free name');
  // delete needs two taps
  const del = host.querySelector('[data-act="delete"]');
  click(del);
  ok(DS.loadDecks(st).length === 3 && /again/.test(host.querySelector('[data-act="delete"]').textContent), 'dom: the first tap on Delete only arms it');
  click(host.querySelector('[data-act="delete"]'));
  ok(DS.loadDecks(st).length === 2, 'dom: the second tap deletes');
  // sheet and keys: Escape closes the share panel, then the sheet, then the builder
  key('Escape');
  ok(host.querySelector('.fdb-share').hidden && !host.hidden, 'dom: Escape closes the share panel first');
  click(host.querySelector('.fdb-bar-open'));
  ok(host.dataset.sheet === 'on' && !host.querySelector('.fdb-scrim').hidden, 'dom: the deck bar opens the sheet');
  key('Escape');
  ok(host.dataset.sheet === 'off' && !host.hidden, 'dom: then Escape closes the sheet');
  key('Escape');
  ok(host.hidden && closed.length === 1, 'dom: then Escape closes the builder');
  b.open();
  const before = DS.totalOf(b.state().list);
  add('cinder-ant');
  key('z', { ctrlKey: true });
  ok(DS.totalOf(b.state().list) === before, 'dom: Ctrl+Z undoes');
  // inspector: right-click
  const ev = new W.Event('contextmenu', { bubbles: true, cancelable: true });
  host.querySelector('.fdb-add[data-id="torch-queen"]').dispatchEvent(ev);
  const insp = W.document.querySelector('.cv-inspect');
  ok(ev.defaultPrevented && insp && !insp.hidden && insp.textContent.includes(CARD['torch-queen'].name), 'dom: right-click opens the inspector');
  key('Escape');
  ok(!host.hidden, 'dom: Escape with the inspector open does not close the builder');
  // a storage that throws: the builder still works and says so
  b.destroy();
  ok(host.innerHTML === '' && !host.classList.contains('fdb'), 'dom: destroy empties the root');
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const b2 = B.mountDeckBuilder(host, { storage: thrower, onPlay: d => played.push(d) });
  b2.open();
  click(host.querySelector('.fdb-add[data-id="ember-gnat"]'));
  ok(DS.countOf(b2.state().list, 'ember-gnat') === 1 && /Not saved/.test(host.querySelector('.fdb-saved').textContent), 'dom: with no storage the deck works and the panel says it is not saved');
  b2.destroy();
}

// ------------------------------------------------------------ CSS
{
  const css = readFileSync(join(ROOT, 'ui/deckbuilder/deckbuilder.css'), 'utf8');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'css: [hidden] display none !important');
  ok(!/blur\(|text-shadow|drop-shadow|gradient\(/.test(css), 'css: no blur, glow or gradient');
  ok(/@media \(max-width:899px\)\{[\s\S]*\.fdb-pool\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(css), 'css: three columns on a phone');
  ok(/\.fdb-pips button\{width:44px;height:44px\}/.test(css) && /\.fdb-rm,\.fdb-ad\{width:44px;min-height:44px\}/.test(css), 'css: 44 px targets on a phone');
  ok(/\.fdb\[data-sheet="on"\] \.fdb-deck\{display:flex\}/.test(css), 'css: the deck panel is a bottom sheet on a phone');
  for (const m of css.matchAll(/:hover\{/g)) {
    const before = css.slice(Math.max(0, m.index - 200), m.index);
    ok(/@media \(hover:hover\)\{[^}]*$/.test(before), 'css: every :hover rule is inside @media (hover:hover)');
  }
  const src = readFileSync(join(ROOT, 'ui/deckbuilder/deckbuilder.js'), 'utf8') + readFileSync(join(ROOT, 'ui/deckbuilder/deckstore.js'), 'utf8');
  ok(!/\bMTGA?\b|planeswalker|Wizards/i.test(src), 'text: no WotC words in the builder');
  ok(/try \{ st\?\.setItem/.test(src) && /try \{\s*const j = JSON\.parse\(st\?\.getItem/.test(src), 'text: storage in try/catch');
}

console.log(`deckbuilder: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

// ============================================================================
//  FLY DUEL  ·  custom decks on the title screen
//  (node tests/chooser-custom.test.mjs)
// ----------------------------------------------------------------------------
//  ui/chooser/chooser.js with saved decks of the deck builder, in a
//  linkedom DOM: the Your decks strip, picking a custom deck, the start
//  choice (humanDeck 'my-<id>' and customDeck), the builder over the
//  chooser (Build, Edit, Play this deck), a ?mydeck= code, and memory.
//  Skipped, with a message, when linkedom is not found.
// ============================================================================
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* the next one */ }
}
if (!linkedom) { console.log('chooser-custom.test: skipped (linkedom not found)'); process.exit(0); }

const W = linkedom.parseHTML('<!doctype html><html><head></head><body><div id="host"></div></body></html>');
globalThis.document = W.document; globalThis.window = W.window;
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const C = await import('../game/cards.js');
const DS = await import('../ui/deckbuilder/deckstore.js');
const X = await import('../ui/chooser/chooser.js');
const BM = await import('../ui/deckbuilder/deckbuilder.js');
const IDS = C.DECK_ORDER;
const wait = () => new Promise(r => setTimeout(r, 5));

DS.saveDecks([
  { id: 'good1', name: 'Bee Line', list: C.DECKS['amber-pollen'].list, updated: 2 },
  { id: 'half1', name: 'Half Done', list: [['ember-gnat', 3]], updated: 1 },
]);
const host = W.document.getElementById('host');
const started = [];
const click = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));
const key = k => W.document.dispatchEvent(Object.assign(new W.Event('keydown', { bubbles: true }), { key: k }));
const make = (extra = {}) => X.mountChooser(host, {
  decks: C.DECKS, deckOrder: IDS, colours: C.COLOURS, cards: C.CARD, curve: null, builderModule: BM,
  onStart: c => started.push(c), ...extra,
});

let ch = make();
ok(!!W.document.getElementById('fdb-css'), 'mount: the builder stylesheet is linked early');
ch.open({ mode: 'watch' });
ok(host.querySelector('.fdc-custom').hidden, 'watch: no Your decks strip');
ch.close(); ch.open({ mode: 'play', closable: true });
const strip = host.querySelector('.fdc-custom');
ok(!strip.hidden, 'play, your seat: the Your decks strip shows');
const ct = [...host.querySelectorAll('.fdc-ctile')];
ok(ct.length === 3 && ct[2].dataset.act === 'build', `strip: two saved decks and Build (${ct.length})`);
ok(ct[0].querySelector('.fdc-name').textContent === 'Bee Line' && /Legal/.test(ct[0].textContent), 'strip: the legal deck tile');
ok(/Not legal yet/.test(ct[1].textContent), 'strip: the deck that is not legal says so');
ok(ct[0].querySelectorAll('canvas.fdc-glyph').length === 2, 'strip: one glyph per colour of the deck');
ok(host.querySelectorAll('.fdc-tile').length === IDS.length + 1, 'strip: the preset tiles do not change');
// pick the legal deck
click(ct[0]);
ok(ch.choice().humanDeck === 'my-good1', `pick: humanDeck is my-good1 (${ch.choice().humanDeck})`);
ok(host.querySelector('.fdc-seat[data-seat="0"] .fdc-seat-n').textContent === 'Bee Line', 'pick: your seat shows the deck name');
ok(host.querySelector('.fdc-custom').hidden, 'pick: the seat moves to the opponent, the strip goes');
ok(/^Play Bee Line vs Fly B/.test(host.querySelector('.fdc-go-l').textContent), `pick: start label (${host.querySelector('.fdc-go-l').textContent})`);
click(host.querySelector('.fdc-tile[data-deck="moss"]'));
click(host.querySelector('.fdc-go'));
const s0 = started[0];
ok(s0 && s0.mode === 'play' && s0.humanDeck === 'my-good1' && s0.flyDeck === 'moss', 'start: the play choice');
ok(s0?.customDeck && s0.customDeck.id === 'my-good1' && C.validateDeck(s0.customDeck.list).ok && s0.customDeck.name === 'Bee Line', 'start: customDeck has the legal list');
const g = s0 && (await import('../game/rules.js')).newGame({ seed: 3, decks: [s0.customDeck.list, s0.flyDeck] });
ok(g && g.players[0].hand.length === 7 && g.players[0].library.length === 33, 'start: newGame takes customDeck.list as it is');
// the seat button back to your seat; Edit
click(host.querySelector('.fdc-seat-b[data-seat="0"]'));
ok(!host.querySelector('.fdc-edit').hidden, 'edit: Edit this deck shows for a custom deck');
click(host.querySelector('.fdc-edit'));
await wait();
const bEl = host.querySelector('.fdc-builder');
ok(bEl && !bEl.hidden && bEl.classList.contains('fdb') && bEl.querySelector('.fdb-name').value === 'Bee Line', 'edit: the builder opens over the chooser with the deck');
key('Escape');
ok(bEl.hidden && !host.hidden, 'builder: Escape closes the builder, not the chooser');
// a deck that is not legal opens the builder
click(host.querySelector('.fdc-ctile[data-cdeck="my-half1"]'));
await wait();
ok(!bEl.hidden && bEl.querySelector('.fdb-name').value === 'Half Done' && ch.choice().humanDeck === 'my-good1', 'half: a deck that is not legal opens in the builder, not picked');
// make it legal in the builder and play it
const pick = (sel, v) => { for (const o of sel.querySelectorAll('option')) { if (o.value === v) o.setAttribute('selected', 'selected'); else o.removeAttribute('selected'); } sel.dispatchEvent(new W.Event('change', { bubbles: true })); };
pick(bEl.querySelector('.fdb-preset'), 'dew');
click(bEl.querySelector('.fdb-play'));
const s1 = started[1];
ok(s1 && s1.mode === 'play' && s1.customDeck && s1.customDeck.name === 'Dew Mirror (copy)' && s1.humanDeck === s1.customDeck.id, 'builder Play: onStart with the new custom deck');
ok(bEl.hidden && !ch._state.building, 'builder Play: the builder closes');
ok(DS.loadDecks().length === 3, 'builder Play: the deck is saved');
// Build a new deck
click(host.querySelector('.fdc-seat-b[data-seat="0"]'));
click(host.querySelector('.fdc-build'));
await wait();
ok(!bEl.hidden && bEl.querySelector('.fdb-count').textContent === '0/40', 'build: an empty new deck');
key('Escape');
ch.destroy();
ok(!host.querySelector('.fdc-builder'), 'destroy: the builder goes too');
// memory: the remembered custom deck comes back; a deleted one does not
ch = make();
ok(ch.choice().humanDeck === s1.humanDeck, 'memory: the remembered custom deck comes back');
ch.destroy();
DS.saveDecks(DS.loadDecks().filter(d => DS.CUSTOM_PREFIX + d.id !== s1.humanDeck));
ch = make();
ok(ch.choice().humanDeck === 'random', 'memory: a deleted custom deck reads as random');
ch.destroy();
// a ?mydeck= code
const code = DS.encodeDeck({ list: C.DECKS['moss-dew'].list, name: 'Shared Fen' });
ch = make({ initial: { myCode: code } });
const cd = ch.customs()[ch.choice().humanDeck];
ok(ch.choice().mode === 'play' && cd && cd.name === 'Shared Fen', 'code: the shared deck is picked');
ok(DS.loadDecks().some(d => d.name === 'Shared Fen'), 'code: the shared deck is saved');
ch.destroy();
ch = make({ initial: { myCode: code } });
ok(DS.loadDecks().filter(d => d.name === 'Shared Fen').length === 1, 'code: the same code a second time does not save a copy');
ch.destroy();
ch = make({ initial: { myCode: 'junk' } });
ok(ch.choice().humanDeck !== undefined && !String(ch.choice().humanDeck).startsWith('my-u'), 'code: a bad code is ignored');
ch.destroy();
// normalise: a custom id is allowed for your deck only
const n = X.normalise({ mode: 'play', humanDeck: 'my-x', deckA: 'my-x', flyDeck: 'my-x' }, IDS, ['my-x']);
ok(n.humanDeck === 'my-x' && n.deckA === 'random' && n.flyDeck === 'random', 'normalise: custom ids for your deck only');

console.log(`chooser-custom: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

// ============================================================================
//  FLY DUEL  ·  card art and card frame tests  (node tests/cards-art.test.mjs)
// ----------------------------------------------------------------------------
//  Checks the public-domain card pictures (art/: art.json, CREDITS-ART.md,
//  credits.js and the JPEG files) for every card and token of the pool,
//  the canvas card frame (ui/cardface.js) and the DOM card frame
//  (ui/board.js cardHTML, ui/card.css). No browser: drawCard and cardBack
//  run on a stub 2D context. The DOM checks cover the ids that the UI
//  knows to have a plate (cardface ART_IDS or hasPlate with art.json).
//
//  GREP MAP
//      grep -n 'ART FILES'     every card id has a picture, credits, licence
//      grep -n 'JPEG SIZE'     pixel size from the JPEG header, byte budget
//      grep -n 'CANVAS'        drawCard / cardBack on a stub context
//      grep -n 'TEXT'          type line and rules runs
//      grep -n 'DOM'           cardHTML markup
//      grep -n 'IP WORDS'      no trademark words outside the disclaimer
// ============================================================================
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const { CARDS, TOKENS, CARD } = await import('../game/cards.js');
const AC = await import('../art/credits.js');
const cf = await import('../ui/cardface.js');
const board = await import('../ui/board.js');
const ART = JSON.parse(readFileSync(join(ROOT, 'art/art.json'), 'utf8'));
const CREDITS = readFileSync(join(ROOT, 'art/CREDITS-ART.md'), 'utf8');
const ids = [...CARDS, ...TOKENS].map(c => c.id);

// --------------------------------------------------------------- ART FILES
ok(ids.length >= 110 && ids.length === CARDS.length + TOKENS.length, `every card and token id (${ids.length})`);
if (cf.setArtIndex) cf.setArtIndex(ART);
const plate = id => (cf.hasPlate ? cf.hasPlate(id) : cf.ART_IDS.includes(id));
for (const id of ids) {
  const e = ART[id];
  ok(!!e, `art.json has ${id}`);
  if (!e) continue;
  ok(/^(Public domain|CC0)$/.test(e.licence), `${id}: licence is Public domain or CC0 (${e.licence})`);
  ok(Array.isArray(e.templates) && e.templates.some(t => /^(PD-|CC0)/.test(t)), `${id}: a PD or CC0 licence template is named`);
  ok(e.title && e.author && e.artist && e.year, `${id}: title, author, artist and year`);
  ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(e.url), `${id}: Commons file page URL`);
  ok(e.crop && [e.crop.x, e.crop.y, e.crop.w, e.crop.h].every(v => v >= 0 && v <= 1), `${id}: crop box as fractions`);
  ok(CREDITS.includes(`| ${id} |`) && CREDITS.includes(e.url), `${id}: CREDITS-ART.md has the row and the URL`);
  ok(AC.ART_CREDIT[id] === `${e.artist}, ${e.year}`, `${id}: ART_CREDIT in art/credits.js matches art.json`);
  if (cf.ART_CREDIT[id]) ok(cf.ART_CREDIT[id] === AC.ART_CREDIT[id], `${id}: ART_CREDIT in cardface.js matches art/credits.js`);
  ok(e.subject && e.subject.length > 3, `${id}: subject named`);
}
ok(Object.keys(ART).sort().join() === [...AC.ART_IDS].sort().join(), 'art/credits.js ART_IDS lists the art.json ids');
ok(new Set(Object.values(ART).map(e => e.commons + '|' + JSON.stringify(e.crop))).size === Object.keys(ART).length, 'no two cards share the same crop of the same file');
// Plain public domain or CC0 only: no Commons page of a picture carries a
// CC BY tag (2026-10-11: moss-snail and hollow-husk changed for this).
for (const id of ids) {
  const e = ART[id];
  if (!e) continue;
  ok(!(e.templates || []).some(t => /^cc-by/i.test(t)) && !/CC BY/i.test(JSON.stringify(e)), `${id}: no CC BY tag on the picture`);
}
ok(!/\| CC BY|CC-BY/i.test(CREDITS), 'CREDITS-ART.md names no CC BY licence in the table');
ok(Object.keys(ART).every(k => ids.includes(k)), 'art.json has no id that is not a card');

// --------------------------------------------------------------- JPEG SIZE
// Width and height from the first SOFn marker of a JPEG.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
let total = 0;
for (const id of ids) {
  const e = ART[id];
  if (!e) continue;
  for (const [f, w, h, max] of [[e.file, 480, 360, 140000], [e.small, 240, 180, 45000]]) {
    const p = join(ROOT, 'art', f);
    ok(existsSync(p), `${id}: ${f} exists`);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p), sz = jpegSize(buf);
    total += buf.length;
    ok(sz && sz.w === w && sz.h === h, `${id}: ${f} is ${w}x${h} (got ${sz?.w}x${sz?.h})`);
    ok(buf.length <= max, `${id}: ${f} is ${buf.length} B, budget ${max}`);
  }
}
ok(total < 8 * 1024 * 1024, `all card art is under 8 MB (${total} B)`);
console.log(`card art: ${ids.length} ids, ${(total / 1048576).toFixed(2)} MB of JPEG`);

// --------------------------------------------------------------- CANVAS
// A 2D context that accepts every call, counts calls and non-finite numbers.
function stubCtx() {
  const calls = { n: 0, bad: 0, text: [] };
  const grad = { addColorStop() {} };
  return new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k === 'createLinearGradient') return (...a) => { calls.n++; if (a.some(x => !Number.isFinite(x))) calls.bad++; return grad; };
      if (k === 'fillText') return (s, ...a) => { calls.n++; calls.text.push(String(s)); if (a.some(x => !Number.isFinite(x))) calls.bad++; };
      return (...a) => { calls.n++; if (a.some(x => typeof x === 'number' && !Number.isFinite(x))) calls.bad++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const STATES = [{}, { tapped: true }, { sick: true }, { attacking: true }, { blocking: true }, { hot: true }, { dead: true }, { damage: 2 }, { pp: 2, pt: 2 }, { tapped: true, damage: 1, attacking: true }];
const SIZES = [[300, 420], [128, 180], [256, 256], [64, 90]];
let canvasErr = 0, canvasBad = 0;
const fakeArt = { width: 480, height: 360 };
for (const id of ids) {
  for (const st of STATES) for (const [w, h] of SIZES) for (const art of [null, fakeArt]) {
    const g = stubCtx();
    try { cf.drawCard(g, CARD[id], { w, h, state: st, art }); } catch (e) { canvasErr++; if (canvasErr < 4) console.error(id, st, e); }
    if (g.calls.bad) canvasBad++;
  }
  const g = stubCtx();
  cf.drawCard(g, CARD[id], { w: 300, h: 420 });
  ok(g.calls.text.some(t => t === CARD[id].name), `${id}: the name is drawn`);
  ok(g.calls.text.some(t => t === cf.typeLine(CARD[id])), `${id}: the type line is drawn`);
  if (CARD[id].type === 'creature') ok(g.calls.text.includes(`${CARD[id].power}/${CARD[id].toughness}`), `${id}: power/toughness drawn`);
}
ok(canvasErr === 0, `drawCard does not throw for any card, state and size (${canvasErr} errors)`);
ok(canvasBad === 0, `drawCard passes only finite numbers (${canvasBad} bad runs)`);
{
  const g = stubCtx();
  cf.drawCard(g, null, { w: 200, h: 280 });
  cf.drawCard(g, { id: 'not-a-card', name: 'X', type: 'spell', cost: { generic: 3 } }, { w: 200, h: 280 });
  ok(g.calls.bad === 0, 'drawCard copes with null and an unknown card');
  const b = stubCtx();
  cf.cardBack(b, { w: 300, h: 420 }); cf.cardBack(b, { w: 64, h: 90 });
  ok(b.calls.n > 50 && b.calls.bad === 0, 'cardBack draws with finite numbers');
  const m = stubCtx();
  for (const k of ['amber', 'moss', 'generic']) cf.drawManaGlyph(m, k, 0, 0, 20, 3);
  ok(m.calls.bad === 0 && m.calls.text.includes('3'), 'mana glyphs draw, generic shows its number');
  const pumped = stubCtx();
  cf.drawCard(pumped, CARD['moss-snail'], { w: 300, h: 420, state: { pp: 2, pt: 2, damage: 1 } });
  ok(pumped.calls.text.includes('3/5') && pumped.calls.text.includes('−1'), 'pump and damage show on the stat plate');
}
const loaded = await cf.loadCardArt('dew-moth', { small: true });
ok(loaded === null || typeof loaded === 'object', 'loadCardArt resolves without a DOM (placeholder or null)');
ok((await cf.loadCardArt('dew-moth', { small: true })) === loaded, 'loadCardArt caches by id and size');
ok(cf.artURL('dew-moth', { small: true }).endsWith('/art/cards/dew-moth@sm.jpg'), 'artURL points into art/cards');

// --------------------------------------------------------------- TEXT
ok(cf.typeLine(CARD['dew-moth']) === 'Creature — Moth', 'type line of a creature');
ok(cf.typeLine(CARD['spore']) === 'Token Creature — Fungus', 'type line of a token');
ok(cf.typeLine(CARD['amber-ridge']) === 'Land — Ridge', 'type line of a land');
ok(ids.every(id => CARD[id].subtype && cf.typeLine(CARD[id]).endsWith(' — ' + CARD[id].subtype)), 'every card has a subtype word on its type line');
{
  const r = cf.rulesRuns(CARD['ember-gnat']);
  ok(r[0].s === 'b' && r[0].t === 'Swift' && r[1].s === 'i' && /attack/.test(r[1].t), 'a keyword-only card: bold keyword, italic reminder');
  const d = cf.rulesRuns(CARD['dew-moth']);
  ok(d[0].s === 'b' && d[0].t === 'Wings.' && d.some(x => x.s === 'r' && /draw a card/.test(x.t)), 'keyword then effect text');
  ok(cf.rulesRuns(CARD['cinder-ant']).length === 0, 'no rules text gives no runs');
  // dice text gets its own 'd' run (drawn in a die outline)
  const sd = cf.rulesRuns(CARD['spark-scatter']);
  ok(sd.some(x => x.s === 'd' && x.t === '2d4') && sd.map(x => x.t).join('') === CARD['spark-scatter'].text, 'dice run: 2d4, and the runs still spell the text');
  const sb = cf.rulesRuns(CARD['scout-bee']);
  ok(sb[0].s === 'b' && sb.some(x => x.s === 'd' && x.t === 'd6'), 'dice run after a keyword: d6');
  ok(!cf.rulesRuns(CARD['dew-moth']).some(x => x.s === 'd'), 'no dice run on a card without dice');
  const gd = stubCtx();
  cf.drawCard(gd, CARD['spark-scatter'], { w: 300, h: 420, mode: 'full' });
  ok(gd.calls.text.includes('2d4') && gd.calls.bad === 0, 'drawCard draws the dice text 2d4 as its own run');
  for (const id of ids.filter(i => /\bd(4|6|8|10|12|20)\b/.test(CARD[i].text || ''))) {
    ok(cf.rulesRuns(CARD[id]).some(x => x.s === 'd'), `${id}: dice text has a dice run`);
  }
}

// --------------------------------------------------------------- DOM
{
  const full = ids.map(id => board.cardHTML(CARD[id])).join('');
  const mini = ids.map(id => board.cardHTML(CARD[id], { mini: true, tapped: true, damage: 1, info: { pp: 1, pt: 1 } })).join('');
  const known = ids.filter(plate);
  ok((full.match(/class="fcard fx /g) || []).length === ids.length, 'cardHTML: one framed card per id');
  ok(known.length >= 35 && known.every(id => full.includes(`/art/cards/${id}.jpg"`)), `cardHTML: full cards use the 480 px picture (${known.length} ids with a plate known to the UI)`);
  ok(known.every(id => mini.includes(`/art/cards/${id}@sm.jpg"`)), 'cardHTML: mini cards use the 240 px picture');
  ok(!/NaN|undefined/.test(full + mini), 'cardHTML: no NaN or undefined');
  ok(full.includes('Creature — Moth') && full.includes('<b>Wings.</b>') && full.includes('class="fx-pt'), 'cardHTML: type line, bold keyword, stat plate');
  ok(full.includes('Art: Dru Drury, 1770'), 'cardHTML: credit line');
  ok(mini.includes('fx-dmg') && mini.includes('tapped') && mini.includes('pumped'), 'cardHTML mini: damage, tapped, pump');
  ok(board.cardHTML(null).includes('unknown'), 'cardHTML: null card');
  const { DECKS } = await import('../game/cards.js');
  const deckRoot = { innerHTML: '' };
  board.renderDecks(deckRoot, CARDS, DECKS);
  const rows = (deckRoot.innerHTML.match(/<li /g) || []).length;
  ok(rows > 10 && (deckRoot.innerHTML.match(/class="dl-art/g) || []).length === rows, `renderDecks: every deck row has a plate slot (${rows} rows)`);
  ok(/@sm\.jpg/.test(deckRoot.innerHTML) && !/NaN|undefined/.test(deckRoot.innerHTML), 'renderDecks: thumbnails use the 240 px files');
  const unk = board.cardHTML({ id: 'zz', name: 'Zz', colour: 'moss', type: 'spell', cost: { generic: 1 }, text: 'x' });
  ok(unk.includes('<svg class="art"'), 'cardHTML: an id with no picture falls back to procedural art');
  const css = readFileSync(join(ROOT, 'ui/card.css'), 'utf8');
  ok(!/filter:\s*(saturate|blur|drop-shadow)|text-shadow|shadowBlur/.test(css), 'card.css: no blur, glow or text shadow');
  ok(!/box-shadow:[^;}]*\d+px\s+\d+px\s+[1-9]/.test(css), 'card.css: box-shadow only as hard rings');
  for (const cls of ['fx-name', 'fx-art', 'fx-type', 'fx-text', 'fx-pt', 'fx-credit', 'mini', 'tapped']) ok(css.includes(`.${cls}`), `card.css styles .${cls}`);
}

// --------------------------------------------------------------- IP WORDS
{
  const ip = /magic|gathering|wizards|planeswalker|mana symbol|\bwotc\b/i;
  const files = ['ui/cardface.js', 'ui/card.css', 'art/art.json', 'art/CREDITS-ART.md', 'art/credits.js'];
  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').filter(l => !/Not affiliated with or endorsed by Wizards of the Coast/.test(l));
    ok(!lines.some(l => ip.test(l)), `${f}: no trademark words outside the disclaimer`);
  }
  ok(CREDITS.includes('Not affiliated with or endorsed by Wizards of the Coast'), 'CREDITS-ART.md carries the disclaimer');
}

console.log(`cards-art: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

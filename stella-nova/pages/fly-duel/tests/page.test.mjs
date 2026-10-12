// ============================================================================
//  FLY DUEL  ·  node tests for the page  (node tests/page.test.mjs)
// ----------------------------------------------------------------------------
//  Package E. No browser: the user does not allow headless Chrome. Two
//  parts.
//
//  1. Pure ui/ modules against the real packages: card art is the same
//     for the same id and different between ids, the art and glyphs hold
//     no trademark words, the board adapter reads the real permanent
//     shape, a Match plays a full game between two real Fly objects, the
//     brain view draws on a fake 2D context, the chart reader handles
//     nested rows, and the toy three-factor rule has the right sign.
//
//  2. A fake DOM boot of main.js. A small stand-in for document, canvas,
//     IntersectionObserver, rAF and fetch lets main.js run its whole boot
//     in node. The test then runs frames, clicks the section 07 buttons
//     and checks the markup. Any console.error fails the test.
//
//  Parts that need a module that is not there yet are skipped, with a
//  line that says so. Exit code 1 on any failure.
//
//  GREP MAP   (grep -n "^// ---" tests/page.test.mjs)
// ============================================================================
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = p => existsSync(join(ROOT, p));
let fail = 0, pass = 0, skip = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const skipped = msg => { skip++; console.log('skip', msg); };

const art = await import('../ui/art.js');
const board = await import('../ui/board.js');
const brain = await import('../ui/brain.js');
const charts = await import('../ui/charts.js');
const explain = await import('../ui/explain.js');
const matchMod = await import('../ui/match.js');

// A 2D context that accepts every call and counts them.
function fakeCtx() {
  const calls = { n: 0, bad: 0 };
  const g = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      return (...a) => { calls.n++; if (a.some(x => typeof x === 'number' && !Number.isFinite(x))) calls.bad++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return g;
}

// --------------------------------------------------------------- art
{
  const c1 = { id: 'ember-gnat', colour: 'amber', type: 'creature', keywords: ['swift'] };
  const c2 = { id: 'dew-moth', colour: 'moss', type: 'creature', keywords: ['wings'] };
  const a1 = art.cardArt(c1), a1b = art.cardArt({ ...c1 }), a2 = art.cardArt(c2);
  ok(a1 === a1b, 'art: same id gives the same picture');
  ok(a1 !== a2, 'art: two ids give two pictures');
  ok(/^<svg[^>]*viewBox="0 0 100 70"/.test(a1) && a1.endsWith('</svg>'), 'art: an svg element');
  ok(!/NaN|undefined|Infinity/.test(a1 + a2), 'art: no NaN or undefined in the svg');
  for (const t of ['land', 'spell']) for (const k of ['damage', 'draw', 'pump', 'heal', 'destroy', 'token', undefined]) {
    const s = art.cardArt({ id: `x-${t}-${k || "plain"}`, colour: 'moss', type: t, effect: k ? { kind: k } : undefined });
    ok(!/NaN|undefined/.test(s), `art: ${t} ${k} has no NaN`);
  }
  const glyphs = art.manaGlyph('amber') + art.manaGlyph('moss') + art.manaGlyph('generic', 3) + art.costGlyphs({ generic: 2, amber: 1, moss: 1 });
  ok((glyphs.match(/<svg/g) || []).length === 3 + 3, 'art: cost {2,1,1} gives three glyphs');
  const ip = /magic|gathering|wizards|planeswalker|mana symbol|\bwotc\b/i;
  const src = ['ui/art.js', 'ui/board.js'].map(p => readFileSync(join(ROOT, p), 'utf8')).join('\n');
  ok(!ip.test(src.replace(/^\/\/.*$/gm, '')), 'art/board: no trademark words outside comments');
}

// --------------------------------------------------------------- charts
{
  const rows = [{ games: 0, A: { vsRandom: 0.5, vsGreedy: 0.2, wins: 100 }, AvsB: 0.5 }, { games: 1000, A: { vsRandom: 0.8, vsGreedy: 0.4, wins: 160 }, AvsB: 0.55 }];
  ok(charts.curveRows({ meta: {}, checkpoints: rows }).length === 2, 'charts: rows found under checkpoints');
  const { xKey, series } = charts.toSeries(rows);
  ok(xKey === 'games', 'charts: x key is games');
  const keys = series.map(s => s.key).sort();
  ok(JSON.stringify(keys) === JSON.stringify(['A.vsGreedy', 'A.vsRandom', 'AvsB']), `charts: rate series only (${keys})`);
  ok(charts.seriesLabel('A.vsRandom') === 'Fly A · vs random bot', `charts: label (${charts.seriesLabel('A.vsRandom')})`);
  const g = fakeCtx(); charts.drawChart(g, 300, 200, series, { chance: 0.5 });
  ok(g.calls.n > 10 && g.calls.bad === 0, 'charts: draws with finite numbers');
}

// --------------------------------------------------------------- toy rule
{
  const t = new explain.ToyMB();
  const v0 = t.value(0);
  const d = t.trial(0, 1);
  ok(d > 0 && t.value(0) > v0, 'toy: reward gives delta > 0 and raises the value');
  ok(t.lastDan === 1, 'toy: delta > 0 is a PAM burst');
  const v1 = t.value(1);
  for (let i = 0; i < 6; i++) t.trial(1, -1);
  ok(t.value(1) < v1, 'toy: punishment lowers the value');
  ok(t.w.every(w => w.every(x => x >= 0 && x <= t.wmax)), 'toy: weights stay in [0, wmax]');
  ok(Math.abs(explain.jaccard([1, 2, 3], [2, 3, 4]) - 0.5) < 1e-9, 'jaccard of {1,2,3} and {2,3,4} is 0.5');
  ok(Math.abs(explain.cosine([1, 0], [1, 0]) - 1) < 1e-9, 'cosine of equal vectors is 1');
  const g = fakeCtx(); explain.drawToy(g, 400, 220, t, 0, 0.5); explain.drawSparse(g, 300, 160, 2000, [1, 2, 3], [3, 4]);
  explain.drawGlomeruli(g, 300, 200, new Float32Array(108).fill(0.3));
  ok(g.calls.bad === 0, 'toy, sparse, glomeruli draw with finite numbers');
}

// --------------------------------------------------------------- board
if (has('game/rules.js') && has('game/cards.js')) {
  const rules = await import('../game/rules.js');
  const cards = await import('../game/cards.js');
  const byId = new Map(Object.entries(cards.CARD));
  let s = rules.newGame({ seed: 5 });
  s = rules.withPermanent(s, 0, 'ember-gnat', { tapped: true, dmg: 1 });
  const perm = s.players[0].battlefield.at(-1);
  const info = board.permInfo(perm);
  ok(info.cardId === 'ember-gnat' && info.tapped && info.damage === 1, 'board: permInfo reads { id, tapped, dmg }');
  const root = { innerHTML: '' };
  board.renderBoard(root, s, { byId, names: ['Fly A', 'Fly B'], hands: 'open' });
  ok(root.innerHTML.includes('side-0') && root.innerHTML.includes('Ember Gnat') && root.innerHTML.includes('tapped'), 'board: table shows a tapped creature');
  const counts = board.deckCounts(cards.DECKS.amber);
  ok([...counts.values()].reduce((a, b) => a + b, 0) === 40, 'board: the amber deck counts 40');
  const dl = { innerHTML: '' }; board.renderDecks(dl, [...cards.CARDS, ...cards.TOKENS], cards.DECKS, { order: cards.DECK_ORDER });
  const nLists = (dl.innerHTML.match(/class="decklist/g) || []).length;
  ok(nLists === cards.DECK_ORDER.length && nLists >= 10, `board: one deck list per deck of DECK_ORDER (${nLists} of ${cards.DECK_ORDER.length})`);
  ok((dl.innerHTML.match(/40 cards/g) || []).length === cards.DECK_ORDER.length, 'board: every deck list counts 40 cards');
  const gal = { innerHTML: '' }; board.renderGallery(gal, cards.CARDS, 'all');
  ok((gal.innerHTML.match(/class="fcard /g) || []).length === cards.CARDS.length, 'board: gallery shows every card');
  ok(!/NaN|undefined/.test(gal.innerHTML + dl.innerHTML + root.innerHTML), 'board: no NaN or undefined in the markup');
} else skipped('board: game/ not there');

// --------------------------------------------------------------- match + brain view
if (has('game/rules.js') && has('brain/fly.js') && has('data/connectome.json')) {
  const rules = await import('../game/rules.js');
  const { Fly } = await import('../brain/fly.js');
  const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));
  const t0 = Date.now();
  const A = new Fly(C, { name: 'Fly A', hemisphere: 'A', seed: 1 }), B = new Fly(C, { name: 'Fly B', hemisphere: 'B', seed: 2 });
  const m = new matchMod.Match(rules, [matchMod.agentFromFly(A, 'Fly A'), matchMod.agentFromFly(B, 'Fly B')], { seed: 9 });
  let n = 0;
  while (m.next()) n++;
  const end = m.over();
  ok(!!end && [0, 1, -1].includes(end.winner), `match: a full game ends (${n} decisions, winner ${end && end.winner})`);
  const recs = m.history.filter(r => r.values);
  ok(recs.length === n && recs.every(r => r.values.length === r.legal.length && r.idx >= 0), 'match: every decision has one value per legal action');
  ok(m.history.some(r => r.delta != null && Number.isFinite(r.delta)), 'match: TD errors are computed');
  ok(m.finalDelta.some(d => d != null && Number.isFinite(d)), 'match: final TD errors are computed');
  const tr = brain.normTrace(recs.at(-1).trace);
  ok(tr.pn && tr.kc && tr.mbon && tr.pn.length === C.pn.n && tr.mbon.length === C.mbon.n, 'brain: trace adapter reads pn, kc, mbon');
  const bv = new brain.BrainView(C, { side: 'A', label: 'Fly A' });
  ok(bv.ok, 'brain: view accepts the connectome');
  bv.setTrace(recs.at(-1).trace, recs.at(-1).value); bv.burst(0.3);
  const g = fakeCtx(); bv.draw(g, 360, 300, 0.016);
  ok(g.calls.n > C.kc.n && g.calls.bad === 0, `brain: one frame draws every KC with finite numbers (${g.calls.n} calls)`);
  let inside = 0, total = 0;
  for (const yaw of [0, 1, 2, 3, 4, 5]) for (const k of ['pn', 'kc', 'mbon', 'dan']) {
    const pr = brain.project(bv.pts[k], bv.centre, bv.unit, yaw, bv.pitch, 0, 0);
    for (let i = 0; i < bv.pts[k].length; i++) { total++; if (Math.abs(pr[i * 3]) * brain.FILL <= 0.5 && Math.abs(pr[i * 3 + 1]) * brain.FILL <= 0.5) inside++; }
  }
  ok(inside / total > 0.99, `brain: ${(100 * inside / total).toFixed(2)}% of points stay inside the view at six turns`);
  if (has('data/connectome-flywire.json')) {
    const CB = JSON.parse(readFileSync(join(ROOT, 'data/connectome-flywire.json'), 'utf8'));
    const bvB = new brain.BrainView(CB, { side: 'B', label: 'Fly B' });
    const gB = fakeCtx(); bvB.draw(gB, 360, 300, 0.016);
    ok(bvB.ok && bvB.pts.kc.length === CB.kc.n && gB.calls.bad === 0, `brain: the FlyWire file (Fly B, ${CB.kc.n} KCs) draws with finite numbers`);
  }
  const empty = new brain.BrainView(null, { label: 'x' }); empty.draw(fakeCtx(), 100, 100);
  ok(!empty.ok, 'brain: no connectome gives a waiting view');
  const out = brain.project([[0, 0, 0], [1, 0, 0]], [0, 0, 0], 1, 0, 0, 0, 0);
  ok(Math.abs(out[3] - 1) < 1e-9 && out[0] === 0, 'brain: project with no turn keeps x');
  console.log(`  match + brain: ${n} decisions in ${Date.now() - t0} ms`);
} else skipped('match + brain: game/, brain/fly.js or the connectome not there');

// --------------------------------------------------------------- markup
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'markup: [hidden] guard in style.css');
  // The user asked for the neural panel of each fly in its scorecard. No
  // layout of the watch HUD (a phone on its side too) hides it.
  ok(!/\.whud[^{]*\.hd-brain\s*\{[^}]*display:\s*none/.test(css), 'markup: no watch layout hides the neural panel of a scorecard');
  const head = html.slice(0, html.indexOf('</head>'));
  const order = ['gpu-guard.js', 'wishlist.js', 'stats-beacon.js', 'style.css'].map(x => head.indexOf(x));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'markup: head order gpu-guard, wishlist, stats-beacon, css');
  ok(/Not affiliated with or endorsed by Wizards of the Coast\./.test(html), 'markup: the disclaimer line');
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  ok(!/magic|gathering/i.test(title), 'markup: the title has no trademark');
  ok(/We do not train a real fly/.test(html), 'markup: the plain-words line');
  const sci = head.indexOf('../../lib/sci.css'), cardCss = head.indexOf('href="ui/card.css"');
  ok(sci > 0 && cardCss > sci && cardCss < head.indexOf('importmap'), 'markup: ui/card.css loads after sci.css, before the import map');
  ok(/wired from two different animals/.test(html), 'markup: says Fly A and Fly B are wired from two different animals');
  ok(/detect synapses by different methods/.test(html), 'markup: the synapse-method caveat');
  ok(/Two computer models <span data-wiring>wired from the connectomes<\/span> of two flies: not real flies\./.test(html), 'markup: the honesty line of the bar names two models and two connectomes');
  // research content lives behind "How it works" only (CONTRACT.md):
  // no kicker, chip bar, stage tag or section text outside the drawer
  {
    const game = html.slice(html.indexOf('<body>'), html.indexOf('<aside class="how"'));
    ok(!/class="(kicker|stage-tag|sec|sec-head)\b/.test(game) && !/id="chips"/.test(game) && !/id="s\d"/.test(game), 'markup: no kicker, chips, stage tag or section outside the drawer');
    const how = html.slice(html.indexOf('<aside class="how"'));
    ok(/We do not train a real fly/.test(how) && /Not affiliated with or endorsed by Wizards of the Coast\./.test(how) && /id="srcList"/.test(how) && /id="credits"/.test(how), 'markup: the drawer has the honesty line, the not-affiliated line, the sources and the credits');
    ok(/<ol class="short">/.test(how) && (how.match(/<ol class="short">([\s\S]*?)<\/ol>/)[1].match(/<li>/g) || []).length === 5, 'markup: the drawer opens on a short explainer of five steps');
    ok(/id="btnHow"/.test(game) && (game.match(/How it works/g) || []).length === 1, 'markup: one "How it works" button on the game view');
    ok(!/kicker/.test(readFileSync(join(ROOT, 'ui/chooser/chooser.js'), 'utf8')), 'markup: the title screen has no kicker either');
  }
  ok(/art\/CREDITS-ART\.md/.test(html) && /public-domain/.test(html), 'markup: the card art credit');
  // the fullscreen game: two modes, the chooser, the drawer
  ok(!html.includes('id="turnBanner"') && (html.match(/data-turn-indicator/g) || []).length === 1, 'markup: one turn indicator, no turn banner');
  for (const id of ['app', 'watchHud', 'scA', 'scB', 'heroTurn', 'playRoot', 'chooser', 'how', 'howClose', 'btnHow', 'btnPlay', 'btnDecks'])
    ok(html.includes(`id="${id}"`), `markup: #${id}`);
  ok(html.indexOf('id="scA"') < html.indexOf('id="scB"'), 'markup: Fly A scorecard first (top-left), Fly B second (top-right)');
  const how = html.slice(html.indexOf('id="how"'));
  ok(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'refs'].every(id => how.includes(`id="${id}"`)), 'markup: the explainer sections are in the drawer');
  ok(/href="ui\/hud\/hud\.css"/.test(head) && /href="ui\/play\/play\.css"/.test(head), 'markup: the head loads hud.css and play.css');
  const chooserJs = readFileSync(join(ROOT, 'ui/chooser/chooser.js'), 'utf8');
  ok(/not train a real fly/.test(chooserJs) && /Not affiliated with or endorsed by Wizards of the Coast\./.test(chooserJs), 'markup: the title screen (ui/chooser/chooser.js) has the honesty line and the not-affiliated line');
  ok(/href="ui\/chooser\/chooser\.css"/.test(head) && /<div id="chooser" hidden/.test(html), 'markup: the head loads chooser.css and #chooser is an empty host');
  const plain0 = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  ok(plain0.split(/(?<=\.)\s/).every(x => !/MTG Arena/.test(x) || /such as MTG Arena/.test(x)), 'markup: MTG Arena only as "plays like ... such as MTG Arena"');
  ok(html.replace(/<!--[\s\S]*?-->/g, '').split('\n').every(l => !/MTG Arena/.test(l) || /Not affiliated/.test(l)), 'markup: the MTG Arena line carries the not-affiliated line');
  ok(/\.app\{[^}]*100dvh/.test(css), 'markup: the app fills 100dvh');
  ok(!/<div class="topbar"/.test(html), 'markup: no page top bar over the game');
  // Text that the old page had and the shipped state no longer holds.
  const plain = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  for (const re of [/(?<!binary code at )\b5 ?%/, /88 active KCs/, /\b21 ?%/, /96\.3/, /both flies use the hemibrain/i, /same wiring/i, /share the same PN-to-KC claws/i, /procedural art/i, /picture and mana glyph here is our own/i, /two decks/i, /Fly A plays Amber/i, /The two decks/i])
    ok(!re.test(plain), `markup: no stale text ${re}`);
  const js = readFileSync(join(ROOT, 'main.js'), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const used = [...new Set([...js.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]))];
  const missing = used.filter(id => !ids.includes(id));
  ok(missing.length === 0, `markup: every $('id') of main.js is in index.html (missing: ${missing})`);
  ok(new Set(ids).size === ids.length, 'markup: ids are unique');
  if (has('data/facts.js')) {
    const { FACTS, SOURCES } = await import('../data/facts.js');
    const facts = [...html.matchAll(/data-fact="([^"]+)"/g)].map(m => m[1]);
    const cites = [...html.matchAll(/data-cite="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/));
    ok(facts.length > 0 && facts.every(f => FACTS[f]), `markup: every data-fact id is in FACTS (${facts.filter(f => !FACTS[f])})`);
    ok(cites.length > 0 && cites.every(c => SOURCES[c]), `markup: every data-cite id is in SOURCES (${cites.filter(c => !SOURCES[c])})`);
  } else skipped('markup: data/facts.js not there');
}

// --------------------------------------------------------------- fake DOM boot
{
  const errors = [];
  const origErr = console.error, origWarn = console.warn;
  console.error = (...a) => { errors.push(a.map(x => x && x.stack || String(x)).join(' ')); };
  console.warn = () => {};
  const els = new Map();
  const defaults = { wSeed: '7', spIn: '0.1', featIn: '0.5', featPick: '0' };
  const fakeEl = (id = '') => {
    const L = {};
    const el = {
      id, innerHTML: '', textContent: '', value: defaults[id] ?? '', dataset: {}, style: {}, disabled: false, className: '',
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      addEventListener(t, f) { (L[t] ||= []).push(f); }, fire(t, e = {}) { for (const f of L[t] || []) f({ target: { closest: () => null }, ...e }); },
      setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => fakeEl('q'), closest: () => null, contains: () => true,
      getBoundingClientRect: () => ({ width: 360, height: 260, top: 1000 }), getContext: () => fakeCtx(),
      setPointerCapture() {}, scrollTo() {}, appendChild() {}, remove() {}, offsetLeft: 0, width: 0, height: 0,
    };
    return el;
  };
  const doc = {
    getElementById: id => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); },
    querySelector: () => fakeEl('q'), querySelectorAll: () => [], createElement: () => fakeEl('c'),
    addEventListener() {}, head: fakeEl('head'), body: fakeEl('body'), documentElement: fakeEl('html'), hidden: false,
  };
  // data/pretrained.json and data/training-curve.json: the real files
  // when they are in the tree, else a tiny real run of tools/train.mjs
  // into a temp folder (same format, a few seconds).
  const fixture = {};
  let tmp = null;
  if (has('tools/train.mjs') && !(has('data/pretrained.json') && has('data/training-curve.json'))) {
    tmp = mkdtempSync(join(tmpdir(), 'fly-duel-page-'));
    const { run } = await import('../tools/train.mjs');
    run({ games: 20, every: 10, eval: 4, final: 6, curriculum: 10, seed: 3, out: tmp, quiet: true });
    for (const f of ['pretrained.json', 'training-curve.json']) fixture[`data/${f}`] = readFileSync(join(tmp, f), 'utf8');
    rmSync(tmp, { recursive: true, force: true });
    console.log('  dom: pretrained and curve from a 20-game tools/train.mjs run (fixture)');
  }
  const frames = [];
  // A worker stand-in. With train/worker.js in the tree, init, train and
  // pause go to its real createTrainer (the same code the worker runs).
  // Without it, a fake follows the contract. eval is always the fake: the
  // real one takes about 25 s for 100 games per match-up.
  const sent = [];
  const realTrainer = has('train/worker.js') ? (await import('../train/worker.js')).createTrainer : null;
  class FakeWorker {
    constructor(url, opts) {
      this.url = String(url); this.opts = opts; this.games = 0;
      if (realTrainer) this.t = realTrainer(m => setTimeout(() => this.onmessage && this.onmessage({ data: m }), 0));
    }
    postMessage(m) {
      sent.push(m.cmd);
      const out = r => setTimeout(() => this.onmessage && this.onmessage({ data: r }), 0);
      if (m.cmd === 'eval') { out({ type: 'eval', game: this.games, n: m.n, vsRandom: { A: 0.7, B: 0.6 }, vsGreedy: { A: 0.2, B: 0.1 }, AvsB: 0.5 }); return; }
      if (this.t) { setTimeout(() => this.t.handle(m), 0); return; }
      if (m.cmd === 'train') {
        for (let i = 0; i < 2; i++) { this.games += m.games / 2; out({ type: 'progress', game: this.games, winRateA: 0.5, vsRandom: { A: 0.6, B: 0.55 }, vsGreedy: { A: 0.3, B: 0.25 } }); }
        out({ type: 'weights', game: this.games, A: { format: 'x' }, B: { format: 'x' } });
      }
      if (m.cmd === 'pause') out({ type: 'paused', game: this.games });
    }
    terminate() {}
  }
  Object.assign(globalThis, {
    Worker: FakeWorker,
    window: globalThis, document: doc, innerHeight: 800, devicePixelRatio: 2,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(t) { this.cb([{ target: t, isIntersecting: true }]); } },
    requestAnimationFrame: f => frames.push(f), addEventListener() {},
    fetch: async p => {
      const rel = String(p).replace(/^\.\//, ''), f = join(ROOT, rel);
      if (!existsSync(f) && !fixture[rel]) return { ok: false, status: 404 };
      const txt = existsSync(f) ? readFileSync(f, 'utf8') : fixture[rel];
      return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
    },
  });
  let bootErr = null;
  try { await import(pathToFileURL(join(ROOT, 'main.js')).href); } catch (e) { bootErr = e; }
  ok(!bootErr, `dom: main.js imports (${bootErr && bootErr.message})`);
  const fd = globalThis.flyDuel;
  ok(!!fd && !!fd.ready, 'dom: window.flyDuel is set');
  if (fd) await fd.ready;
  // let boot() finish its sync init after ready
  await new Promise(r => setTimeout(r, 50));
  let t = 0;
  const pump = n => { for (let i = 0; i < n; i++) { const fs = frames.splice(0); t += 50; for (const f of fs) f(t); } };
  pump(400);
  const E = id => els.get(id) || fakeEl(id);
  if (has('game/rules.js')) {
    ok(E('heroBoard').innerHTML.includes('side-0') && E('heroBoard').innerHTML.includes('side-1'), 'dom: hero table has both sides');
    ok(/<li class="p[01]">/.test(E('heroLog').innerHTML), 'dom: hero log has moves after 20 s of frames');
    ok(E('deckLists').innerHTML.includes('decklist'), 'dom: section 01 deck lists');
    ok(E('gallery').innerHTML.includes('fcard'), 'dom: section 01 gallery');
    for (let i = 0; i < 25; i++) E('wNext').fire('click');
    ok(E('wCands').innerHTML.includes('chosen'), 'dom: section 07 lists candidates with the chosen one');
    ok(/Decision \d+/.test(E('wInfo').textContent), `dom: section 07 info line (${E('wInfo').textContent.slice(0, 80)})`);
    E('wPrev').fire('click');
    ok(/Decision \d+/.test(E('wInfo').textContent), 'dom: section 07 back works');
  } else skipped('dom: game/ not there');
  if (has('brain/fly.js') && has('game/features.js')) {
    ok(/PN channels/.test(E('smellRead').textContent), `dom: section 03 reads PN channels (${E('smellRead').textContent.slice(0, 60)})`);
    E('spNext').fire('click');
    ok(/KC overlap/.test(E('spRead').innerHTML), 'dom: section 04 overlap readout');
  } else skipped('dom: brain/fly.js not there');
  if (has('data/connectome.json')) ok(/PN \d+/.test(E('mbLegend').innerHTML), 'dom: section 02 legend counts');
  if (has('data/facts.js')) {
    const t = E('flyCompare').innerHTML;
    ok(/hemibrain v1\.2/.test(t) && /FlyWire 783/.test(t) && /1,927/.test(t) && /2,597/.test(t), 'dom: section 02 Fly A / Fly B table has both flies');
    ok((t.match(/<tr>/g) || []).length >= 8, 'dom: section 02 table has a row per COMPARE entry');
  }
  if (has('brain/fly.js')) {
    const F = globalThis.flyDuel.heroFlies();
    const mm = await import(pathToFileURL(join(ROOT, 'main.js')).href);
    const kt = mm.kcCodeText(F.A.mb, F.B.mb);
    ok(kt.share === `${+(100 * F.A.mb.sparsity).toFixed(1)}%` && kt.count.includes(`${F.A.mb.k} of ${F.A.mb.nLive}`) && kt.count.includes(`${F.B.mb.k} of ${F.B.mb.nLive}`), `dom: KC code text from the loaded model (${kt.share}; ${kt.count})`);
    ok(F.A.mb.nLive !== F.B.mb.nLive, 'dom: Fly A and Fly B have different live KC counts (two wiring files)');
    ok(E('spIn').value === String(F.A.mb.sparsity), `dom: section 04 slider starts at the model share (${E('spIn').value})`);
    ok(globalThis.flyDuel.hero.bvs[1].pts.kc.length === globalThis.flyDuel.conOf('B').kc.n, 'dom: the 2D brain of Fly B uses the FlyWire file');
    ok(/Fly A \(hemibrain\) \/ Fly B \(FlyWire\)/.test(E('heroStats').innerHTML), 'dom: hero numbers name both flies');
  }
  ok(/zenodo\.10676866/.test(E('credits').innerHTML) && /zenodo\.23037340/.test(E('credits').innerHTML) && /CREDITS-ART\.md/.test(E('credits').innerHTML), 'dom: credits name the FlyWire records and the card art');
  if (has('data/facts.js')) ok(E('srcList').innerHTML.includes('ref-'), 'dom: sources list');
  if (has('data/facts.js')) {
    const mm = await import(pathToFileURL(join(ROOT, 'main.js')).href);
    ok(mm.fmtFact({ value: [0.05, 0.1], unit: 'fraction active' }) === '5–10%', 'dom: fmtFact gives 5–10% for a fraction range');
    ok(mm.fmtFact({ value: 139255, unit: 'neurons' }) === '139,255', 'dom: fmtFact puts commas in big numbers');
    ok(mm.fmtFact({ value: null }) === '', 'dom: fmtFact of a claim is empty');
    ok(/\[\d+\]/.test(E('factList').innerHTML) && E('ourList').innerHTML.includes('<li>'), 'dom: two fact lists with citations');
  }
  E('trainStart').fire('click');
  // wait for the second train batch (real trainer: about 1.5 s per batch)
  for (let i = 0; i < 400 && sent.filter(c => c === 'train').length < 2; i++) await new Promise(r => setTimeout(r, 25));
  E('trainPause').fire('click');
  await new Promise(r => setTimeout(r, 60));
  ok(sent[0] === 'init' && sent.filter(c => c === 'train').length >= 2, `dom: worker gets init, then a new train batch after each weights message (${sent.join(',')})`);
  ok(/vs random bot/.test(E('trainLegend').innerHTML), 'dom: live legend has the vs-random series');
  ok(/Paused at game \d+/.test(E('trainRead').textContent), `dom: pause reads the game count (${E('trainRead').textContent})`);
  E('wNew').fire('click');
  if (realTrainer) ok(/weights from your training run/.test(E('wInfo').textContent), `dom: section 07 uses the trained weights (${E('wInfo').textContent.slice(0, 90)})`);
  E('wNext').fire('click');
  ok(/Decision 1/.test(E('wInfo').textContent), 'dom: a trained fly plays a decision in section 07');
  E('trainEval').fire('click');
  await new Promise(r => setTimeout(r, 10));
  ok(/Evaluation at game \d+, 100 games each/.test(E('trainRead').textContent), `dom: eval result line (${E('trainRead').textContent.slice(0, 80)})`);
  ok(/eval · vs random bot/.test(E('trainLegend').innerHTML), 'dom: eval rates get their own series');
  if (has('tools/train.mjs')) {
    ok(/held-out games/.test(E('evalTable').innerHTML) && /Fly A vs random bot/.test(E('evalTable').innerHTML) && /95% CI/.test(E('evalTable').innerHTML), 'dom: section 08 shows the held-out table');
    ok(/node tools\/train\.mjs/.test(E('curveMeta').innerHTML), 'dom: section 08 shows the command that made the numbers');
    ok(/vs random bot/.test(E('curveLegend').innerHTML), 'dom: section 08 legend has the checkpoint series');
    ok(/held-out games Fly A won/.test(E('heroStats').innerHTML), 'dom: hero stat from the held-out numbers');
    ok(/pretrained weights/.test(E('heroStatus').textContent) || /wins|Draw/.test(E('heroStatus').textContent), `dom: hero plays the pretrained flies (${E('heroStatus').textContent.slice(0, 70)})`);
  } else skipped('dom: tools/train.mjs not there');
  E('toyRew').fire('click');
  ok(/PAM burst/.test(E('toyRead').innerHTML), 'dom: section 05 reward gives a PAM burst line');
  ok(!/NaN|undefined/.test([...els.values()].map(e => e.innerHTML + e.textContent).join('')), 'dom: no NaN or undefined in any markup');
  console.error = origErr; console.warn = origWarn;
  ok(errors.length === 0, `dom: no console.error (${errors.length}): ${errors.slice(0, 3).join(' | ')}`);
}

// --------------------------------------------------------------- modes (pure helpers of main.js)
// parseQuery / queryOf: the URL keeps the mode and the decks. pickDecks:
// 'random' gives a deck by the seed, the same seed the same decks.
// keyCardsOf of ui/chooser/chooser.js: the first key card of a deck has
// the top mana value. turnPauseMs: the pause between turns.
if (has('game/cards.js')) {
  const cards = await import('../game/cards.js');
  // main.js is in the module cache from the fake DOM boot above
  const mm = await import(pathToFileURL(join(ROOT, 'main.js')).href).catch(e => ({ err: e }));
  if (mm.err) skipped(`modes: main.js did not import in node (${mm.err.message})`);
  else {
    const ids = cards.DECK_ORDER;
    ok(ids.length >= 13 && ['amber', 'moss', 'dew', 'rot', 'pollen'].every(c => ids.includes(c)), `modes: five mono decks in DECK_ORDER (${ids.length} decks)`);
    ok(ids.filter(id => cards.DECKS[id].colours.length > 1).length >= 7, 'modes: several mixed decks');
    const q0 = mm.parseQuery('', ids);
    ok(q0.mode === null && q0.decks.join() === 'random,random', 'modes: no mode in the URL opens the chooser, random decks');
    const qw = mm.parseQuery('?mode=watch&deck=amber-dew,rot', ids);
    ok(qw.mode === 'watch' && qw.decks.join() === 'amber-dew,rot', `modes: watch decks from the URL (${qw.decks})`);
    ok(mm.parseQuery('?mode=watch&deck=nope', ids).decks.join() === 'random,random', 'modes: an unknown deck id reads as random');
    ok(mm.parseQuery('?mode=WATCH', ids).mode === 'watch' && mm.parseQuery('?mode=x', ids).mode === null, 'modes: the mode word, any case; other words open the chooser');
    const qp = mm.parseQuery('?mode=play&deck=moss-rot&opp=A&fly=dew', ids);
    ok(qp.mode === 'play' && qp.myDeck === 'moss-rot' && qp.opp === 'A' && qp.flyDeck === 'dew', 'modes: play deck, opponent and its deck from the URL');
    ok(mm.parseQuery('?mode=play&opp=Z', ids).opp === 'B' && mm.parseQuery('?mode=play', ids).myDeck === ids[0], 'modes: play defaults: Fly B, the first deck');
    for (const st of [{ mode: 'watch', decks: ['dew', 'random'] }, { mode: 'play', myDeck: 'pollen', opp: 'bot', flyDeck: 'amber-rot' }, { mode: 'play', myDeck: 'rot', opp: 'A', flyDeck: 'random' }]) {
      const back = mm.parseQuery(mm.queryOf(st), ids);
      const same = st.mode === 'watch' ? back.decks.join() === st.decks.join() : back.myDeck === st.myDeck && back.opp === st.opp && back.flyDeck === st.flyDeck;
      ok(back.mode === st.mode && same, `modes: URL round trip ${mm.queryOf(st)}`);
    }
    ok(mm.queryOf({ mode: 'watch', decks: ['random', 'random'] }) === '?mode=watch', 'modes: random decks keep the URL short');
    const p1 = mm.pickDecks(['random', 'random'], 77, ids), p2 = mm.pickDecks(['random', 'random'], 77, ids);
    ok(p1.join() === p2.join() && p1.every(d => ids.includes(d)) && p1[0] !== p1[1], `modes: random decks by seed, two different decks (${p1})`);
    ok(mm.pickDecks(['dew', 'random'], 5, ids)[0] === 'dew', 'modes: a chosen deck stays');
    const seen = new Set(); for (let sd = 1; sd < 400; sd++) mm.pickDecks(['random', 'random'], sd, ids).forEach(d => seen.add(d));
    ok(seen.size === ids.length, `modes: random reaches every deck (${seen.size} of ${ids.length})`);
    const X = await import('../ui/chooser/chooser.js');
    for (const id of ids) {
      const k = X.keyCardsOf(cards.DECKS[id], cards.CARD, 1)[0];
      const inDeck = cards.DECKS[id].list.some(([c]) => c === k?.id);
      const mvMax = Math.max(...cards.DECKS[id].list.map(([c]) => cards.CARD[c]).filter(c => c.type !== 'land').map(c => Object.values(c.cost || {}).reduce((a, b) => a + b, 0)));
      ok(!!k && k.type !== 'land' && inDeck && Object.values(k.cost).reduce((a, b) => a + b, 0) === mvMax, `modes: key card of ${id} is ${k?.name}, the top mana value ${mvMax}`);
    }
    ok(mm.turnPauseMs(1) >= 1000 && mm.turnPauseMs(3) < mm.turnPauseMs(1) && mm.turnPauseMs(0.5) > mm.turnPauseMs(1), 'modes: the pause between turns follows the speed');
  }
} else skipped('modes: game/cards.js not there');

console.log(`page tests: ${pass} pass, ${fail} fail, ${skip} skipped`);
process.exit(fail ? 1 : 0);

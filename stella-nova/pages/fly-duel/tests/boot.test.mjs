// ============================================================================
//  FLY DUEL  ·  integration boot test  (node tests/boot.test.mjs)
// ----------------------------------------------------------------------------
//  Boots the real index.html and main.js in node with linkedom (a DOM in
//  plain JS, no browser: the user does not allow headless Chrome). Real
//  modules and real data files load through a fetch from disk. The 2D
//  canvas context is a Proxy stub that accepts every call. The training
//  worker is the real createTrainer of train/worker.js behind a fake
//  Worker that copies each message by structuredClone.
//
//  tests/page.test.mjs boots main.js on a small fake DOM where
//  querySelectorAll gives an empty list. This file uses a full DOM, so it
//  also checks the [data-fact], [data-mix] and segment button paths, and
//  it compares the page text against the data files.
//
//  Two modes. The first run boots with no mode in the URL: the chooser
//  opens over the watch table, and the test drives the chooser (decks of
//  each fly, then play mode, then back). Then the test starts itself
//  again with FD_BOOT=play (a new node process, so main.js boots again)
//  and a URL of ?mode=play&deck=moss&opp=A: play mode opens at once, the
//  test plays a few moves through the play screen, and exits to watch.
//
//  linkedom is not a dependency of the site. The test looks for it in
//  node_modules and in the global openclaw install. Without it, the test
//  prints "skipped" and exits 0.
//
//  GREP MAP   (grep -n "^// ---" tests/boot.test.mjs)
// ============================================================================
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAY = process.env.FD_BOOT === 'play';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`  FAIL ${m}`); } };

// --------------------------------------------------------------- linkedom
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* try the next one */ }
}
if (!linkedom) { console.log('boot.test: skipped (linkedom not found)'); process.exit(0); }

// --------------------------------------------------------------- data files
const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));
const curve = JSON.parse(readFileSync(join(ROOT, 'data/training-curve.json'), 'utf8'));
const kb = p => statSync(join(ROOT, p)).size / 1024;
ok(kb('data/connectome.json') < 1536, `data: connectome.json under 1.5 MB (${kb('data/connectome.json').toFixed(0)} KB)`);
ok(kb('data/pretrained.json') < 2048, `data: pretrained.json under 2 MB (${kb('data/pretrained.json').toFixed(0)} KB)`);

// --------------------------------------------------------------- globals
const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, '');
const W = linkedom.parseHTML(html);
const { document } = W;
const errors = [];
const oe = console.error, ow = console.warn;
console.error = (...a) => errors.push(a.map(x => x && x.stack || String(x)).join(' '));
console.warn = (...a) => errors.push('warn: ' + a.map(x => x && x.stack || String(x)).join(' '));

// A context stub: any property is a callable stub, numbers read as 0,
// assigned properties read back.
const stub = () => {
  const store = {};
  return new Proxy(function () {}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p in store) return store[p];
      if (p === 'width' || p === 'height' || p === 'length') return 0;
      return stub();
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return stub(); },
  });
};
const proto = W.HTMLElement.prototype;
proto.getBoundingClientRect = () => ({ width: 360, height: 260, top: 1000, left: 0, right: 360, bottom: 1260 });
proto.setPointerCapture = () => {}; proto.scrollTo = () => {}; proto.scrollIntoView = () => {};
(W.HTMLCanvasElement || W.HTMLElement).prototype.getContext = function () { return this.__g ||= stub(); };
class Img { set src(v) { this._s = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._s; } decode() { return Promise.resolve(); } }
const sent = [];
const { createTrainer } = await import(pathToFileURL(join(ROOT, 'train/worker.js')).href);
class FakeWorker {
  constructor(url) { this.url = String(url); this.t = createTrainer(m => setTimeout(() => this.onmessage?.({ data: structuredClone(m) }), 0)); }
  postMessage(m) { sent.push(m.cmd); const c = structuredClone(m); setTimeout(() => this.t.handle(c), 0); }
  terminate() {}
}
const frames = [], winL = {};
const urls = [];
const realST = globalThis.setTimeout;
// play mode: the pauses of play.js are for people, not for the test
if (PLAY) globalThis.setTimeout = (f, ms, ...a) => realST(f, Math.min(ms || 0, 1), ...a);
Object.assign(globalThis, {
  location: { search: PLAY ? '?mode=play&deck=moss&opp=A' : '', hash: '' },
  history: { replaceState: (a, b, u) => urls.push(String(u)) },
  window: globalThis, document, Node: W.Node, HTMLElement: W.HTMLElement, Event: W.Event,
  innerWidth: 390, innerHeight: 800, devicePixelRatio: 2, Image: Img, Worker: FakeWorker,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(t) { this.cb([{ target: t, isIntersecting: true }]); } unobserve() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: f => frames.push(f), cancelAnimationFrame() {},
  addEventListener: (t, f) => (winL[t] ||= []).push(f), removeEventListener() {},
  dispatchEvent: e => { (winL[e.type] || []).forEach(f => f(e)); return true; },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  fetch: async p => {
    const f = join(ROOT, String(p).replace(/^\.\//, ''));
    if (!existsSync(f)) return { ok: false, status: 404 };
    const txt = readFileSync(f, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  },
});
Object.defineProperty(document, 'hidden', { value: false, configurable: true });

// --------------------------------------------------------------- boot
const t0 = Date.now();
let bootErr = null;
try { await import(pathToFileURL(join(ROOT, 'main.js')).href); } catch (e) { bootErr = e; }
ok(!bootErr, `boot: main.js imports (${bootErr && bootErr.message})`);
await globalThis.flyDuel?.ready;
await new Promise(r => setTimeout(r, 100));
let T = 0;
const pump = n => { for (let i = 0; i < n; i++) { const fs = frames.splice(0); T += 50; for (const f of fs) f(T); } };
pump(600);
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));
const pct = v => `${(100 * v).toFixed(1)}%`;
const fd = globalThis.flyDuel;
const wait = ms => new Promise(r => realST(r, ms));

// --------------------------------------------------------------- play mode (FD_BOOT=play)
if (PLAY) {
  for (let i = 0; i < 200 && !fd.app.play; i++) await wait(10);
  const root = $('playRoot'), q = sel => root.querySelector(sel);
  ok(fd.app.mode === 'play' && !!fd.app.play && root.hidden === false, `play: ?mode=play opens play mode at once (mode ${fd.app.mode})`);
  ok($('app').dataset.mode === 'play' && $('chooser').hidden === true, 'play: the app is in play mode, the chooser is closed');
  ok(/Call the coin/.test(q('.pl-sheet')?.textContent || ''), `play: the URL choices passed the setup sheet: the coin is next (${(q('.pl-sheet h2')?.textContent || '').slice(0, 40)})`);
  const pc = () => fd.app.play.controller;
  ok(pc()?.decks?.[pc().humanSeat] === 'moss', `play: your deck is moss from the URL (${pc()?.decks})`);
  ok(pc()?.humanSeat === 1 && pc()?.names?.[0] === 'Fly A', `play: against Fly A you sit right, seat 1 (${pc()?.names})`);
  click(q('[data-call="heads"]')); await wait(5);
  click(q('.pl-go')); await wait(5);
  click(q('[data-keep]')); await wait(5);
  ok(q('.pl-sheet').hidden === true, 'play: coin, keep: the table is open');
  ok(root.querySelectorAll('.hd-card').length === 2, 'play: two scorecards in the play screen');
  // a few human moves through the big button (pass, no attack, no block)
  const rules = await import(pathToFileURL(join(ROOT, 'game/rules.js')).href);
  let mine = 0;
  for (let k = 0; k < 4000 && mine < 6 && pc().need() !== 'over'; k++) {
    await wait(1);
    if (pc().need() !== 'human' || fd.app.play.busy) continue;
    const n0 = pc().history.length;
    click(q('.pl-pri'));
    for (let j = 0; j < 200 && pc().history.length === n0; j++) await wait(1);
    if (pc().history.length > n0) mine++;
  }
  ok(mine >= 3 && pc().history.some(r => r.who !== pc().humanSeat), `play: human moves go through the screen and the fly answers (${mine} moves, ${pc().history.length} records)`);
  ok(rules.isOver(pc().state) || pc().state.turn >= 2, `play: the game goes on (turn ${pc().state.turn})`);
  ok(urls.some(u => u === '?mode=play&deck=moss&opp=A'), `play: the URL keeps the mode, the deck and the opponent (${urls.slice(-1)})`);
  const n0 = fd.hero.match.history.length;
  fd.exitPlay();
  ok(fd.app.mode === 'watch' && root.hidden === true && $('heroCv').parentNode === $('heroStage'), 'play: exit gives the watch table back');
  ok(urls.at(-1)?.startsWith('?mode=watch'), `play: the URL says watch after exit (${urls.at(-1)})`);
  pump(400);
  ok(fd.hero.match.history.length > 0 && $('heroLog').children.length > 0, `play: the watch match plays again after exit (${n0} -> ${fd.hero.match.history.length})`);
  const text = document.body.textContent;
  ok(!/NaN|undefined|\[object/.test(text), 'play: no NaN, undefined or [object in the text');
  console.error = oe; console.warn = ow;
  globalThis.setTimeout = realST;
  ok(errors.length === 0, `play: no console.error or console.warn (${errors.length}): ${errors.slice(0, 3).join(' | ').slice(0, 600)}`);
  console.log(`boot.test (play): ${pass} pass, ${fail} fail (${Date.now() - t0} ms)`);
  process.exit(fail ? 1 : 0);
}

// --------------------------------------------------------------- watch mode: chooser, decks, scorecards
{
  const cards = await import(pathToFileURL(join(ROOT, 'game/cards.js')).href);
  const ids = cards.DECK_ORDER;
  ok($('chooser').hidden === false && fd.app.sheet, 'watch: no mode in the URL opens the chooser');
  ok(fd.hero.match.history.length > 0, 'watch: the match plays behind the chooser');
  const ch = $('chooser'), cq = sel => ch.querySelector(sel);
  const tiles = [...ch.querySelectorAll('.fdc-tile')];
  ok(tiles.length === ids.length + 1 && tiles[0].dataset.deck === 'random', `watch: a Random tile and one tile per deck (${tiles.length} tiles, ${ids.length} decks)`);
  ok(tiles.slice(1).every((b, i) => b.dataset.deck === ids[i] && b.querySelector('.fdc-name').textContent === cards.DECKS[ids[i]].name && b.querySelector('canvas.fdc-fan')), 'watch: each tile has its deck name and a fan canvas');
  ok(/not train a real fly/.test(ch.textContent) && /Not affiliated with or endorsed by Wizards of the Coast\./.test(ch.textContent), 'watch: the title screen has the honesty line and the not-affiliated line');
  ok($('deckTag').textContent === `${ids.length} decks: ${ids.filter(i => cards.DECKS[i].colours.length === 1).length} of one colour, ${ids.filter(i => cards.DECKS[i].colours.length > 1).length} mixed`, `01: the deck tag counts the decks (${$('deckTag').textContent})`);
  ok(['amber', 'moss', 'dew', 'rot', 'pollen'].every(k => $('manaLegGlyphs').innerHTML.includes(`mana-${k}`)), '01: the mana legend has the five colours');
  // Fly A: dew, Fly B: rot (a pick on seat A moves the choice to seat B)
  click(cq('.fdc-mode[data-mode="watch"]'));
  click(cq('.fdc-tile[data-deck="dew"]'));
  click(cq('.fdc-tile[data-deck="rot"]'));
  const seatN = [...ch.querySelectorAll('.fdc-seat-n')].map(e => e.textContent);
  ok(seatN[0] === cards.DECKS.dew.name && seatN[1] === cards.DECKS.rot.name, `watch: the seats name the chosen decks (${seatN.join(' / ')})`);
  ok(cq('.fdc-tile[data-deck="rot"]').getAttribute('aria-pressed') === 'true', 'watch: the chosen tile is pressed');
  click(cq('.fdc-go'));
  ok($('chooser').hidden === true && fd.hero.match.decks.join() === 'dew,rot', `watch: Start plays the chosen decks (${fd.hero.match.decks})`);
  ok(urls.at(-1) === '?mode=watch&deck=dew%2Crot' || urls.at(-1) === '?mode=watch&deck=dew,rot', `watch: the URL keeps the decks (${urls.at(-1)})`);
  pump(300);
  ok($('scA').querySelector('.hd-card') && $('scB').querySelector('.hd-card'), 'watch: Fly A scorecard in #scA (top-left), Fly B in #scB (top-right)');
  ok($('hudBar').hidden === true, 'watch: the fallback strip hides when the scorecards load');
  ok(/Dew Mirror/.test($('scA').textContent) && /Carrion Court/.test($('scB').textContent), 'watch: each scorecard names the deck of its fly');
  const life = fd.hero.match.state.players.map(p => p.life);
  ok($('scA').querySelector('.hd-life').getAttribute('aria-label') === `life ${life[0]}` || fd.hero.busy, `watch: the d20 of Fly A shows life ${life[0]}`);
  ok(/^V [+−]/.test($('scA').querySelector('.hd-vd').textContent + $('scB').querySelector('.hd-vd').textContent), 'watch: the neural panel shows the value of a decision');
  // the pause between turns: the banner shows at a turn change
  let seenBanner = false;
  for (let i = 0; i < 600 && !seenBanner; i++) { pump(1); if (!$('turnBanner').hidden && /Turn \d+/.test($('turnBanner').textContent)) seenBanner = true; }
  ok(seenBanner, `watch: a turn change holds the table with a turn banner (${$('turnBanner').textContent})`);
  const nB = fd.hero.match.history.length;
  pump(4);
  ok(fd.hero.match.history.length === nB || $('turnBanner').hidden, 'watch: no new move while the banner holds');
  // play from the chooser, then back
  click($('btnPlay'));
  ok($('chooser').hidden === false && ch.dataset.mode === 'play' && cq('.fdc-opp').hidden === false, 'watch: "Play a fly" opens the title screen on play, with the opponent switch');
  click(cq('.fdc-tile[data-deck="amber-pollen"]'));
  click(cq('.fdc-go'));
  for (let i = 0; i < 200 && !fd.app.play; i++) await wait(10);
  ok(fd.app.mode === 'play' && /Call the coin/.test($('playRoot').textContent), 'watch -> play: the chooser starts a play game at the coin');
  ok(fd.app.play?.controller?.decks?.includes('amber-pollen'), `watch -> play: your deck from the box (${fd.app.play?.controller?.decks})`);
  fd.exitPlay();
  ok(fd.app.mode === 'watch' && $('playRoot').hidden === true, 'play -> watch: back to the table');
  // the drawer
  click($('btnHow'));
  ok($('how').hidden === false && fd.app.how, 'how: the drawer opens');
  click($('howClose'));
  ok($('how').hidden === true, 'how: the drawer closes');
  pump(200);
}

// --------------------------------------------------------------- hero, 02
ok(/pretrained weights/.test($('heroStatus').textContent), `hero: plays the pretrained flies (${$('heroStatus').textContent.slice(0, 60)})`);
ok($('heroLog').children.length > 0, 'hero: the log has moves after 30 s of frames');
const fin = curve.meta.final;
ok($('heroStats').textContent.includes(pct(fin.vsRandom.A.rate)), `hero: stat ${pct(fin.vsRandom.A.rate)} from meta.final of training-curve.json`);
ok($('heroStats').textContent.includes(String(C.kc.n)), `hero: stat ${C.kc.n} KCs from connectome.json`);
const tag = $('wiringTag');
ok(C.meta.synthetic ? /synth/.test(tag.className) : /real/.test(tag.className) && !/sampled/.test(tag.textContent),
  `02: the wiring tag matches meta.synthetic = ${C.meta.synthetic} (${tag.className}: ${tag.textContent})`);
const wiringSpans = [...document.querySelectorAll('[data-wiring]')].map(e => e.textContent);
ok(wiringSpans.length >= 2 && wiringSpans.every(t => C.meta.synthetic ? /sampled/.test(t) : /connectome/.test(t)), `02: [data-wiring] text matches meta.synthetic (${wiringSpans.join(' | ')})`);
ok($('mbLegend').textContent.includes(`PN ${C.pn.n}`), `02: legend counts PN ${C.pn.n}`);
ok($('cxMeta').textContent.includes(C.edges.pn_kc.length.toLocaleString('en-US')), '02: the PN->KC edge count of the file');
ok(!/sampled from published/.test($('cxMeta').textContent) || C.meta.synthetic, '02: no "sampled" line for real wiring');

// --------------------------------------------------------------- facts, mix
const facts = [...document.querySelectorAll('[data-fact]')];
ok(facts.length > 0 && facts.every(e => /\d/.test(e.textContent)), `facts: every [data-fact] has a number (${facts.map(e => `${e.dataset.fact}=${e.textContent}`).join(', ')})`);
const mix = [...document.querySelectorAll('[data-mix]')];
ok(mix.length === 4 && mix.every(e => /^\d/.test(e.textContent)), `facts: every [data-mix] from train/selfplay.js (${mix.map(e => `${e.dataset.mix}=${e.textContent}`).join(', ')})`);
ok([...document.querySelectorAll('[data-cite]')].every(e => /\[\d+\]/.test(e.innerHTML)), 'facts: every [data-cite] has a [n] link');

// --------------------------------------------------------------- 01, 03, 04
ok($('deckLists').textContent.includes('40 cards'), '01: deck lists');
const nAll = $('gallery').children.length;
const segBtns = [...document.querySelectorAll('#galSeg button')];
click(segBtns[1]);
ok(segBtns.length > 1 && $('gallery').children.length > 0 && $('gallery').children.length < nAll, `01: the gallery filter (${nAll} -> ${$('gallery').children.length})`);
// The section 03 prose must name the encoding that the shipped fly uses.
const enc = globalThis.flyDuel.heroFlies().A?.mb?.opts?.encoding;
const h03 = [...document.querySelectorAll('.sec-head h2')].find(h => /smell of a board/i.test(h.textContent));
const p03 = h03?.parentNode?.querySelector('p')?.textContent || '';
ok(enc === 'receptor' ? /receptor/.test(p03) && !/tuning curve/.test(p03) : /tuning curve/.test(p03), `03: the prose names the '${enc}' encoding (${p03.slice(60, 140)})`);
ok(new RegExp(`${C.pn.n} PN channels`).test($('smellRead').textContent), `03: ${C.pn.n} PN channels (${$('smellRead').textContent.slice(0, 40)})`);
// A new hero game empties the hero history. "Another pair" must still
// find two boards (the old scripted fallback found none).
click($('heroNew'));
click($('spNext'));
ok(/KC overlap/.test($('spRead').textContent), `04: a pair after a new hero game (${$('spRead').textContent.slice(0, 50)})`);
$('spIn').value = '0.1'; $('spIn').dispatchEvent(new W.Event('change'));
ok(/\(10\.0%\)/.test($('spRead').textContent), `04: 10% sparsity gives 10% active (${$('spRead').textContent.slice(-30)})`);

// --------------------------------------------------------------- 07, 08
for (let i = 0; i < 30; i++) click($('wNext'));
ok(/^Decision 30/.test($('wInfo').textContent) && !/\.\./.test($('wInfo').textContent), `07: info line, no double stop (${$('wInfo').textContent.slice(0, 80)})`);
for (const b of document.querySelectorAll('#wOpp button')) { click(b); click($('wNext')); }
ok(/Decision 1/.test($('wInfo').textContent), '07: each opponent button starts a match');
const et = $('evalTable').textContent;
for (const [k, r] of [['vsRandom A', fin.vsRandom.A], ['vsGreedy B', fin.vsGreedy.B], ['AvsB', fin.AvsB]])
  ok(et.includes(pct(r.rate)) && et.includes(`${r.wins}-${r.losses}-${r.draws}`), `08: held-out ${k} ${pct(r.rate)} ${r.wins}-${r.losses}-${r.draws}`);
ok($('curveMeta').textContent.includes(curve.meta.command), '08: the command that made the numbers');

// --------------------------------------------------------------- 06 worker
click($('trainLoad'));
await new Promise(r => setTimeout(r, 20));
click($('trainStart'));
for (let i = 0; i < 400 && sent.filter(c => c === 'train').length < 2; i++) await new Promise(r => setTimeout(r, 25));
click($('trainPause'));
await new Promise(r => setTimeout(r, 50));
const games = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8')).meta.games;
const m = $('trainRead').textContent.match(/Paused at game (\d+)/);
ok(sent.join(',').startsWith('init,train,train') && m && +m[1] > games, `06: pretrained load, two batches, pause after game ${games} (${sent.join(',')}; ${$('trainRead').textContent})`);

// --------------------------------------------------------------- saver
const sv = globalThis.snSaver;
ok(!!sv, 'saver: window.snSaver installed');
if (sv) {
  const r = await sv.enter({ seconds: 20, seed: 3 });
  ok(r?.canvas?.id === 'fdSaverCv' && document.getElementById('fdSaverCv') === r.canvas, 'saver: enter gives a canvas in the document');
  pump(200);
  sv.exit();
  pump(10);
}

// --------------------------------------------------------------- end
const text = document.body.textContent;
ok(!/NaN|undefined|\[object/.test(text), `page: no NaN, undefined or [object in the text (${(text.match(/.{20}(NaN|undefined|\[object).{20}/) || [''])[0]})`);
console.error = oe; console.warn = ow;
ok(errors.length === 0, `page: no console.error or console.warn (${errors.length}): ${errors.slice(0, 3).join(' | ').slice(0, 600)}`);
console.log(`boot.test: ${pass} pass, ${fail} fail (${Date.now() - t0} ms)`);
// play mode boots in its own process (a new main.js)
const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, FD_BOOT: 'play' }, encoding: 'utf8' });
process.stdout.write(child.stdout || '');
if (child.status !== 0) { console.log(`  FAIL play-mode boot exited ${child.status} ${(child.stderr || '').slice(0, 400)}`); fail++; }
process.exit(fail ? 1 : 0);

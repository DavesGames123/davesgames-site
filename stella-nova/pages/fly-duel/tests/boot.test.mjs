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
//  linkedom is not a dependency of the site. The test looks for it in
//  node_modules and in the global openclaw install. Without it, the test
//  prints "skipped" and exits 0.
//
//  GREP MAP   (grep -n "^// ---" tests/boot.test.mjs)
// ============================================================================
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
Object.assign(globalThis, {
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
process.exit(fail ? 1 : 0);

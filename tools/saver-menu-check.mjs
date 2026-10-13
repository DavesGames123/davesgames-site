// ============================================================================
//  tools/saver-menu-check.mjs — node check of the screensaver page picker
// ----------------------------------------------------------------------------
//  Loads lib/nav-data.js, lib/screensaver-catalog.js and lib/screensaver.js
//  into a jsdom window, opens the menu and drives the picker: tiles, search,
//  the filter chips, the quick buttons, a region toggle and the counts. No
//  browser, no network.
//
//  Usage (from the repo root; jsdom must resolve, for example with NODE_PATH):
//    NODE_PATH=<dir with jsdom> node tools/saver-menu-check.mjs
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('SKIP: jsdom not found (set NODE_PATH)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('  FAIL', m, d); } };
const root = new URL('../stella-nova/', import.meta.url);
const src = f => readFileSync(new URL(f, root), 'utf8');

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/stella-nova/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.HTMLElement.prototype.scrollIntoView = function () { w.__jumped = this.dataset.pane; };
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
for (const f of ['lib/nav-data.js', 'lib/screensaver-catalog.js', 'lib/screensaver.js']) {
  try { w.eval(src(f)); } catch (e) { ok(false, 'load ' + f, e.message); }
}
const ss = w.snScreensaver;
ok(ss && typeof ss.open === 'function', 'snScreensaver.open exists');
ss.open();
const m = w.document.getElementById('sn-saver-menu');
ok(m && !m.hidden, 'the menu opens');
const $$ = q => [...m.querySelectorAll(q)];
const vis = () => $$('.pg').filter(t => !t.hidden);
const playable = ss.pages().filter(p => p.state !== 'no');
ok($$('.pg').length === playable.length, 'one tile per playable page', $$('.pg').length + ' vs ' + playable.length);
ok($$('.tab').length === 0 && $$('.card-h').length === 0, 'no region tabs or card lists remain');
ok($$('.pg img').every(i => /\/stella-nova\/pages\/home\/thumbs\/[\w-]+\.jpg$/.test(i.src)), 'each tile points at its home thumbnail');
ok($$('.reg').length === $$('[data-jump]').length && $$('.reg').length >= 3, 'a section and a jump chip per region', String($$('.reg').length));
ok($$('.reg').every(r => !r.hidden), 'every region shows at once (no tabs)');

const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
// search
const q = m.querySelector('.q');
const first = playable[0];
q.value = first.label.toLowerCase(); fire(q, 'input');
ok(vis().some(t => t.dataset.key === first.key), 'search finds a page by its name', first.label);
ok(vis().length < playable.length, 'search hides the others', String(vis().length));
q.value = 'zzzz-no-page'; fire(q, 'input');
ok(vis().length === 0 && !m.querySelector('.empty').hidden, 'no match shows the empty note');
q.value = ''; fire(q, 'input');
ok(vis().length === playable.length, 'a clear search shows every tile');
// none, then add one tile
click(m.querySelector('[data-q="none"]'));
ok($$('.pg input').every(b => !b.checked) && m.querySelector('.go').disabled, 'Remove shown clears every tile and disables Start');
const t0 = $$('.pg input')[0]; t0.checked = true; fire(t0, 'input');
ok(ss.settings().pages.length === 1 && ss.settings().pages[0] === t0.value, 'a tile click adds its page');
ok(/^1 pages?/.test(m.querySelector('.sum').textContent), 'the summary counts it', m.querySelector('.sum').textContent);
ok(m.querySelector('.n-on').textContent === '1', 'the Selected chip counts it');
// Selected chip
click(m.querySelector('[data-f="on"]'));
ok(vis().length === 1 && vis()[0].dataset.key === t0.value, 'Selected shows only the chosen pages');
click(m.querySelector('[data-f="all"]'));
// Own screensaver chip
click(m.querySelector('[data-f="own"]'));
ok(vis().every(t => !t.hasAttribute('data-basic')) && vis().length === playable.filter(p => p.state === 'ready').length, 'Own screensaver hides the Basic pages');
click(m.querySelector('[data-f="all"]'));
// quick buttons act on the shown tiles only
const reg0 = $$('.reg')[0], name0 = reg0.querySelector('h4').textContent;
q.value = name0.toLowerCase(); fire(q, 'input');
const shownKeys = vis().map(t => t.dataset.key);
click(m.querySelector('[data-q="all"]'));
const chosen = new Set(ss.settings().pages);
ok(shownKeys.every(k => chosen.has(k)) && chosen.size <= shownKeys.length + 1, 'Add shown adds only the tiles that show', chosen.size + ' / ' + shownKeys.length);
q.value = ''; fire(q, 'input');
// region toggle
click(m.querySelector('[data-q="none"]'));
const r1 = $$('.reg')[1];
click(r1.querySelector('[data-reg]'));
const inR1 = [...r1.querySelectorAll('.pg input')];
ok(inR1.every(b => b.checked) && ss.settings().pages.length === inR1.length, 'Add all on a region adds its pages only');
ok(r1.querySelector('.reg-t').textContent === 'Remove all' && r1.querySelector('.reg-h small').textContent === `${inR1.length} of ${inR1.length}`, 'the region head shows the count and flips to Remove all');
click(r1.querySelector('[data-reg]'));
ok(ss.settings().pages.length === 0, 'Remove all clears the region');
// jump chip
click(m.querySelector(`[data-jump="${r1.dataset.pane}"]`));
ok(w.__jumped === r1.dataset.pane, 'a region chip scrolls to its section');
// defaults and reset
click(m.querySelector('[data-act="reset"]'));
const defs = ss.pages().filter(p => p.state !== 'no').length;
ok(ss.settings().pages.length > 0 && ss.settings().pages.length <= defs, 'Reset to defaults ticks the default list', String(ss.settings().pages.length));
// a thumbnail that fails leaves the letter plate
const img = m.querySelector('.pg img'), th = img.parentElement;
img.dispatchEvent(new w.Event('error'));
ok(!th.querySelector('img') && th.dataset.ch.length === 1, 'a missing thumbnail leaves the letter plate');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

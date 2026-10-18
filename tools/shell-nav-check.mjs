#!/usr/bin/env node
// ============================================================================
//  tools/shell-nav-check.mjs — node checks of the shell page swap
// ----------------------------------------------------------------------------
//  Takes functions out of the inline script of stella-nova/index.html and
//  runs them in a node vm with fake frames. No browser runs.
//
//  The checks:
//    release   releaseFrame on a page with lib/gpu-guard.js calls
//              __snRelease and makes no new canvas context; on a page with
//              no guard it still loses each WebGL context
//    random    (jsdom, skipped when jsdom does not resolve) the #tb-random
//              button: it is a button in the top bar left, before the
//              title, with a label for screen readers; 44 px at each
//              viewport, the label hides under 520 px; 60 fast clicks
//              each call switchTab with a registered key that is not
//              home, not the current page and not one of the last 8
//              picks, and leave one page frame (click coalescing);
//              sessionStorage that throws still gives valid picks; a
//              page with a WIP badge is never picked
//
//  Usage (repo root; jsdom must resolve, for example with NODE_PATH):
//    node tools/shell-nav-check.mjs            check stella-nova/index.html
//    node tools/shell-nav-check.mjs --old REV  the same checks on
//                                              git show REV:stella-nova/index.html
//  Exit 1 on any failure.
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'stella-nova/index.html';
const io = process.argv.indexOf('--old');
const OLD = io > 0 ? process.argv[io + 1] : null;
const html = OLD
  ? execFileSync('git', ['show', OLD + ':' + REL], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, REL), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('ok    ' + m); } else { fail++; console.log('FAIL  ' + m + (d ? '\n      ' + d : '')); } };

// One top-level function of the inline shell script, by name.
function fnSource(name) {
  const m = html.match(new RegExp('^function ' + name + '\\(.*$', 'm'));
  if (!m) throw new Error('no function ' + name + ' in ' + REL);
  return m[0];
}

// ── release ─────────────────────────────────────────────────────────────────
// A fake canvas: ctx is its context type ('2d', 'webgl2' or null). A
// getContext call on a canvas with no context makes one (as browsers do).
function canvas(ctx) {
  const c = { type: ctx, made: 0, lost: 0 };
  c.getContext = t => {
    if (c.type === null) { c.type = t; c.made++; }
    if (c.type !== t) return null;
    if (t === 'webgpu') return { unconfigure() {}, getConfiguration: () => null };
    if (t === '2d') return {};
    return { getExtension: () => ({ loseContext: () => { c.lost++; } }) };
  };
  return c;
}
function frame(canvases, guard) {
  let released = 0;
  const w = guard ? { __snRelease: () => { released++; } } : {};
  return {
    f: { contentWindow: w, contentDocument: { querySelectorAll: () => canvases } },
    get released() { return released; },
  };
}
{
  const ctx = vm.createContext({});
  vm.runInContext(fnSource('releaseFrame'), ctx);
  // A guarded page with one WebGL canvas, one 2d canvas and four unused canvases.
  const cs = [canvas('webgl2'), canvas('2d'), canvas(null), canvas(null), canvas(null), canvas(null)];
  const g = frame(cs, true);
  ctx.releaseFrame(g.f);
  const made = cs.reduce((a, c) => a + c.made, 0);
  ok(g.released === 1, 'release: a guarded page gets __snRelease', `calls ${g.released}`);
  ok(made === 0, 'release: a guarded page gets no new canvas context', `new contexts ${made}`);
  // A page with no guard: the sweep still loses its WebGL context.
  const cs2 = [canvas('webgl2'), canvas('2d')];
  const n = frame(cs2, false);
  ctx.releaseFrame(n.f);
  ok(cs2[0].lost === 1, 'release: a page with no guard still loses its WebGL context', `lost ${cs2[0].lost}`);
}

// ── random ──────────────────────────────────────────────────────────────────
await (async () => {
  const { createRequire } = await import('node:module');
  let JSDOM, VirtualConsole;
  try { ({ JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom')); } catch (e) { console.log('skip  random: jsdom not found (set NODE_PATH)'); return; }
  const { parseCss, styleOf, px, makeMatchMedia } = await import('./css-viewport.mjs');
  const scripts = [];
  const bare = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, body) => { const s = attrs.match(/src="([^"]+)"/); scripts.push(s ? { src: s[1] } : { body }); return ''; });
  const css = parseCss([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'));
  const lib = f => fs.readFileSync(path.join(ROOT, 'stella-nova', f), 'utf8');
  function boot(vp, badStorage = false) {
    // jsdom cannot load a frame: drop its "navigation" note, keep other errors.
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/navigation/.test(e.message)) console.log('jsdom: ' + e.message); });
    const dom = new JSDOM(bare, { url: 'http://localhost/stella-nova/index.html#orbital', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
    const w = dom.window;
    w.matchMedia = makeMatchMedia(vp);
    w.Element.prototype.scrollIntoView = function () {};
    if (badStorage) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('denied'); } });
    const errs = [];
    for (const s of scripts) {
      if (s.src && !['lib/nav-data.js', 'lib/wishlist.js'].includes(s.src)) continue;
      try { w.eval(s.src ? lib(s.src) : s.body); } catch (e) { errs.push((s.src || 'inline') + ': ' + e.message); }
    }
    return { w, d: w.document, errs };
  }
  const { w, d, errs } = boot({ w: 1440, h: 900, coarse: false });
  ok(!errs.length, 'random: the shell scripts run with no error', errs.join(' | '));
  const b = d.getElementById('tb-random'), bar = d.getElementById('topbar');
  const kids = bar ? [...bar.children] : [];
  ok(!!b && b.tagName === 'BUTTON' && b.type === 'button' && b.parentElement === bar, 'random: #tb-random is a button in the top bar');
  ok(b && kids.indexOf(b) > kids.indexOf(d.getElementById('collapse-btn')) && kids.indexOf(b) < kids.indexOf(d.getElementById('topbar-title')), 'random: it sits left, after the menu and collapse buttons, before the title');
  ok(b && /random page/i.test(b.getAttribute('aria-label') || '') && !!b.querySelector('svg[aria-hidden="true"]'), 'random: it has an aria-label and a dice icon');
  for (const [W, H, coarse] of [[360, 740, true], [390, 844, true], [844, 390, true], [1024, 768, true], [1440, 900, false]]) {
    const vp = { w: W, h: H, coarse };
    const st = styleOf(b, css, vp), lab = styleOf(b.querySelector('.tb-random-label'), css, vp);
    const hide = W <= 520;
    ok(px(st['min-height'], vp) >= 44 && px(st['min-width'], vp) >= 44 && st.display !== 'none' && (lab.display === 'none') === hide,
      `random: ${W}x${H}: shows, 44 px target, label ${hide ? 'hidden (icon only)' : 'shown'}`, JSON.stringify({ mh: st['min-height'], mw: st['min-width'], d: st.display, l: lab.display }));
  }
  const keys = new Set(w.snPages().map(p => p.key));
  // The shell's let bindings are not visible from here: the current page
  // is the one the active sidebar row names (markTab sets it).
  const current = () => { const a = d.querySelector('#sb-nav .active'); return a && a.dataset.tab; };
  const calls = [];
  const real = w.switchTab;
  w.switchTab = function (id) { calls.push({ id, from: current() }); return real.apply(this, arguments); };
  const bad = [];
  const picks = [];
  for (let n = 0; n < 60; n++) {
    b.click();
    const c = calls[calls.length - 1];
    if (!c || c.id === 'home' || c.id === c.from || !keys.has(c.id)) bad.push(JSON.stringify(c));
    if (c && picks.slice(-8).includes(c.id)) bad.push('repeat ' + c.id);
    if (c) picks.push(c.id);
  }
  ok(calls.length === 60 && !bad.length, `random: 60 clicks give 60 switchTab calls to registered pages, never home, the current page or the last 8 picks`, `${calls.length} calls; ${bad.slice(0, 3).join(' | ')}`);
  let recent = null;
  try { recent = JSON.parse(w.sessionStorage.getItem('sn-random-recent')); } catch (e) {}
  ok(Array.isArray(recent) && recent.length === 8 && recent[0] === picks[picks.length - 1], 'random: sessionStorage keeps the last 8 picks, newest first', JSON.stringify(recent));
  await new Promise(r => setTimeout(r, 1200));
  const frames = d.querySelectorAll('#frame-wrap iframe').length;
  ok(frames === 1 && current() === picks[picks.length - 1], `random: after 60 fast clicks one page frame stays (${frames}), on the last pick`);
  // Not ready: a WIP badge keeps a page out of the pool.
  const wip = w.SN_NAV[1].constellations[0].groups[0].p[0];
  wip[2] = 'WIP';
  let seenWip = false;
  for (let n = 0; n < 400; n++) if (w.pickRandom('orbital') === wip[0]) seenWip = true;
  ok(!seenWip && !w.randomPool('orbital').includes(wip[0]) && !w.randomPool('orbital').includes('orbital'), `random: a WIP page (${wip[0]}) and the current page are never picked`);
  // All but one page in the history: that one is picked.
  const pool = w.randomPool('home');
  w.sessionStorage.setItem('sn-random-recent', JSON.stringify(pool.slice(1)));
  ok(w.pickRandom('home', () => 0.99) === pool[0], 'random: with the rest in the history, the one fresh page is picked');
  w.close();
  // sessionStorage that throws.
  const t = boot({ w: 390, h: 844, coarse: true }, true);
  const got = [];
  const real2 = t.w.switchTab;
  t.w.switchTab = function (id) { got.push(id); return real2.apply(this, arguments); };
  let terr = null;
  try { for (let n = 0; n < 10; n++) t.d.getElementById('tb-random').click(); } catch (e) { terr = e.message; }
  ok(!terr && !t.errs.length && got.length === 10 && got.every(k => k !== 'home' && keys.has(k)), 'random: sessionStorage that throws still gives valid picks', terr || t.errs.join(' | ') || got.join(','));
  t.w.close();

  // saver button: the user said (2026-10-18) "add a screensaver button in
  // the top right button much like the share or random page buttons".
  // lib/screensaver.js adds #sn-saver-touch on every device, before Share.
  for (const coarse of [false, true]) {
    const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
    const dom = new JSDOM(bare, { url: 'http://localhost/stella-nova/index.html#orbital', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
    const sw = dom.window; sw.matchMedia = makeMatchMedia({ w: coarse ? 390 : 1440, h: coarse ? 844 : 900, coarse });
    sw.Element.prototype.scrollIntoView = function () {};
    const serr = [];
    for (const f of ['lib/nav-data.js', 'lib/share-url.js', 'lib/screensaver.js']) { try { sw.eval(lib(f)); } catch (e) { serr.push(f + ': ' + e.message); } }
    sw.document.dispatchEvent(new sw.Event('DOMContentLoaded'));
    const sd = sw.document, sb = sd.getElementById('sn-saver-touch'), sbar = sd.getElementById('topbar'), share = sd.getElementById('tb-share');
    const kids2 = sbar ? [...sbar.children] : [];
    const tag = coarse ? 'phone' : 'desktop';
    ok(!serr.length && !!sb && sb.parentElement === sbar, `saver button: ${tag}: #sn-saver-touch is in the top bar`, serr.join(' | '));
    ok(sb && share && kids2.indexOf(sb) === kids2.indexOf(share) - 1 && kids2.indexOf(sb) > kids2.indexOf(sd.getElementById('topbar-title')), `saver button: ${tag}: it sits right, just before Share`, kids2.map(k => k.id).join(','));
    ok(sb && /screensaver/i.test(sb.getAttribute('aria-label') || '') && sb.querySelector('.sn-saver-lab') && /Screensaver/.test(sb.textContent), `saver button: ${tag}: an aria-label and the label "Screensaver"`);
    if (sb) { sb.click(); const m = sd.getElementById('sn-saver-menu'); ok(!!m && !m.hidden, `saver button: ${tag}: on the home page a click opens the screensaver menu`); }
    sw.close();
  }
  // On a page with a saver, the button starts the screensaver for that page
  // only, with no menu (the user, 2026-10-18: "the screensaver button should
  // start the screensaver for only this page automatically, not open the menu").
  {
    const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
    const dom = new JSDOM(bare, { url: 'http://localhost/stella-nova/index.html#orbital', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
    const sw = dom.window; sw.matchMedia = makeMatchMedia({ w: 1440, h: 900, coarse: false });
    sw.Element.prototype.scrollIntoView = function () {};
    const switched = [];
    sw.eval('var activeTab = "orbital";');
    sw.switchTab = (k) => { switched.push(k); };
    const serr = [];
    for (const f of ['lib/nav-data.js', 'lib/share-url.js', 'lib/screensaver.js']) { try { sw.eval(lib(f)); } catch (e) { serr.push(f + ': ' + e.message); } }
    sw.document.dispatchEvent(new sw.Event('DOMContentLoaded'));
    const sd = sw.document, sb = sd.getElementById('sn-saver-touch');
    if (sb) sb.click();
    await new Promise(r => setTimeout(r, 2500));
    const m = sd.getElementById('sn-saver-menu');
    ok(!serr.length && sw.snScreensaver && sw.snScreensaver.running && (!m || m.hidden), 'saver button: on a page (orbital) a click starts the screensaver with no menu', serr.join(' | ') || `running ${sw.snScreensaver && sw.snScreensaver.running}, menu ${m ? (m.hidden ? 'hidden' : 'open') : 'none'}`);
    ok(switched.length >= 1 && switched.every(k => k === 'orbital'), 'saver button: the run shows only this page', JSON.stringify(switched));
    if (sw.snScreensaver && sw.snScreensaver.running) sw.snScreensaver.stop('test');
    sw.close();
  }
  ok(/min-height: 44px/.test(lib('lib/screensaver.js')) && /\.sn-saver-lab \{ display: none; \}/.test(lib('lib/screensaver.js')), 'saver button: 44 px target; under 520 px only the icon shows');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

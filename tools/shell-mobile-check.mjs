// ============================================================================
//  tools/shell-mobile-check.mjs — phone and tablet checks of the shell nav
// ----------------------------------------------------------------------------
//  Loads stella-nova/index.html into jsdom at each viewport below, with a
//  matchMedia for that viewport, and runs lib/nav-data.js, lib/wishlist.js
//  and the inline shell scripts. Other scripts and the page frame do not
//  load. The CSS checks use tools/css-viewport.mjs (no layout engine).
//
//  At each viewport:
//    - drawer mode is on for phones and portrait tablets, off at 1024x768
//    - the controls are there: menu button, close button, search, 6 region
//      tabs, 26 constellations
//    - the drawer is closed at load, so it does not cover the page
//    - no declared width or min-width is wider than the viewport, and the
//      drawer width fits
//    - in drawer mode the targets are 44 px or more
//    - the current page (#orbital) is highlighted and its cluster is open
//    - the drawer opens and closes (close button, Esc, overlay, page choice)
//    - in drawer mode one cluster is open at a time
//    - search filters the list and shows the empty note
//    - a region tab jump marks the tab
//
//  No browser runs. Usage (jsdom must resolve, for example with NODE_PATH):
//    NODE_PATH=<dir>/node_modules node tools/shell-mobile-check.mjs
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mediaMatches, parseCss, styleOf, px, makeMatchMedia } from './css-viewport.mjs';
const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('SKIP: jsdom not found (set NODE_PATH)'); process.exit(0); }

const root = new URL('../stella-nova/', import.meta.url);
const src = f => readFileSync(new URL(f, root), 'utf8');
const html = src('index.html');
const DRAWER = '(max-width:768px),(max-height:500px) and (pointer:coarse)';
const VPS = [[360, 740, true], [390, 844, true], [430, 932, true], [768, 1024, true], [844, 390, true], [1024, 768, true], [1440, 900, false]];

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('ok    ' + m); } else { fail++; console.log('FAIL  ' + m + (d ? '\n      ' + d : '')); } };

// The page without its scripts; the scripts in page order.
const scripts = [];
const bare = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, body) => { const s = attrs.match(/src="([^"]+)"/); scripts.push(s ? { src: s[1] } : { body }); return ''; });
const RUN = new Set(['lib/nav-data.js', 'lib/wishlist.js']);
const css = parseCss([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'));

function boot(vp) {
  const dom = new JSDOM(bare, { url: 'http://localhost/stella-nova/index.html#orbital', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = makeMatchMedia(vp);
  w.innerWidth = vp.w; w.innerHeight = vp.h;
  w.__seen = [];
  w.Element.prototype.scrollIntoView = function () { w.__seen.push(this); };
  const errs = [];
  for (const s of scripts) {
    if (s.src && !RUN.has(s.src)) continue;
    try { w.eval(s.src ? src(s.src) : s.body); } catch (e) { errs.push((s.src || 'inline') + ': ' + e.message); }
  }
  return { w, d: w.document, errs };
}

const label = vp => `${vp.w}x${vp.h}`;
for (const [W, H, coarse] of VPS) {
  const vp = { w: W, h: H, coarse };
  const tag = label(vp);
  const { w, d, errs } = boot(vp);
  const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  const drawer = mediaMatches(DRAWER, vp);
  const st = el => styleOf(el, css, vp);
  ok(!errs.length, `${tag}: the shell scripts run with no error`, errs.join(' | '));
  ok(drawer === (W <= 844 && coarse), `${tag}: drawer mode is ${drawer ? 'on' : 'off'}`);
  ok(!!$('#menu-btn') && !!$('#sb-close') && !!$('#sb-q') && $$('#sb-regions .rg-tab').length === 6 && $$('#sb-nav .cluster').length === 26,
    `${tag}: menu, close, search, 6 region tabs and 26 constellations are there`, `${$$('#sb-regions .rg-tab').length} tabs, ${$$('#sb-nav .cluster').length} clusters`);

  // Widths: no declared width or min-width is wider than the viewport.
  const wide = [];
  for (const el of $$('body *')) {
    const s = st(el);
    for (const p of ['width', 'min-width']) { const v = px(s[p], vp); if (v > W + 0.5) wide.push(`${el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + el.className} ${p}:${s[p]}`); }
  }
  ok(!wide.length, `${tag}: no declared width is wider than ${W} px`, wide.slice(0, 4).join(' | '));
  const sb = $('#sidebar'), sbs = st(sb);
  if (drawer) {
    ok(st($('#menu-btn')).display !== 'none' && st($('#sb-regions')).display === 'flex' && st($('#sb-close')).display !== 'none', `${tag}: the menu button, region tabs and close button show`);
    ok(sbs.position === 'fixed' && /translateX\(-100%\)/.test(sbs.transform || '') && sbs.visibility === 'hidden' && !sb.classList.contains('open') && !$('#overlay').classList.contains('show'),
      `${tag}: the drawer is closed at load and does not cover the page`, JSON.stringify({ p: sbs.position, t: sbs.transform, v: sbs.visibility }));
    const dw = px(sbs.width, vp);
    ok(dw <= W * 0.9 && dw >= 260, `${tag}: the drawer is ${Math.round(dw)} px wide, so the page shows beside it`);
    // Collapsed on a desktop (localStorage) must not empty the drawer.
    d.body.classList.add('sb-collapsed');
    const cs = st(sb);
    ok(px(cs.width, vp) === dw && cs.opacity === '1', `${tag}: a collapsed desktop state does not empty the drawer`, JSON.stringify({ w: cs.width, o: cs.opacity }));
    d.body.classList.remove('sb-collapsed');
    const small = [];
    for (const s of ['#menu-btn', '#sb-close', '#sb-find', '.rg-tab', '.cluster-head', '.nav-item']) {
      const el = $(s), z = st(el);
      const h = Math.max(px(z['min-height'], vp) || 0, px(z.height, vp) || 0);
      if (!(h >= 44)) small.push(`${s} ${h}`);
    }
    ok(!small.length, `${tag}: menu, close, search, tabs, constellations and pages are 44 px targets`, small.join(', '));
    ok(/env\(safe-area-inset-top/.test(st($('#topbar'))['padding-top'] || '') && /env\(safe-area-inset-bottom/.test(st($('#sb-footer'))['padding'] || '') && /env\(safe-area-inset-left/.test(sbs['padding-left'] || ''),
      `${tag}: the top bar, drawer and footer take the safe-area insets`);
    const nr = st($('.nav-region'));
    ok(nr.position === 'sticky' && nr.top === '0', `${tag}: the region heading is sticky`);
  } else {
    ok(st($('#menu-btn')).display === 'none' && sbs.position !== 'fixed', `${tag}: the sidebar sits beside the page, no menu button`);
  }

  // The current page is highlighted, and its cluster is open.
  const act = $$('#sb-nav .active');
  ok(act.length === 1 && act[0].dataset.tab === 'orbital' && act[0].closest('.cluster').classList.contains('open'), `${tag}: the current page (orbital) is highlighted and its constellation open`, act.map(a => a.dataset.tab).join(','));
  ok($('#topbar-active').textContent.length > 0, `${tag}: the top bar names the current page ("${$('#topbar-active').textContent}")`);

  // Open and close.
  if (drawer) {
    $('#menu-btn').click();
    ok(sb.classList.contains('open') && $('#overlay').classList.contains('show') && $('#menu-btn').getAttribute('aria-expanded') === 'true', `${tag}: the menu button opens the drawer`);
    ok(w.__seen.some(e => e.dataset.tab === 'orbital'), `${tag}: opening scrolls the current page into view`);
    ok(d.activeElement === $('#sb-close'), `${tag}: the focus goes to the close button`);
    $('#sb-close').click();
    ok(!sb.classList.contains('open') && !$('#overlay').classList.contains('show') && $('#menu-btn').getAttribute('aria-expanded') === 'false', `${tag}: the close button closes the drawer`);
    w.openSidebar();
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(!sb.classList.contains('open'), `${tag}: Esc closes the drawer`);
    w.openSidebar();
    $('#overlay').click();
    ok(!sb.classList.contains('open'), `${tag}: a tap on the page beside the drawer closes it`);
  }

  // One constellation open at a time in drawer mode.
  const heads = $$('#sb-nav .cluster-head:not(.solo)');
  heads[2].click(); heads[5].click();
  const open = $$('#sb-nav .cluster.open');
  if (drawer) ok(open.length === 1 && open[0].contains(heads[5]) && heads[5].getAttribute('aria-expanded') === 'true' && heads[2].getAttribute('aria-expanded') === 'false', `${tag}: one constellation is open at a time`, open.length + ' open');
  else ok(open.length >= 2, `${tag}: on a desktop several constellations can be open`);

  // Search.
  const q = $('#sb-q'), all = $$('#sb-nav [data-q]').length;
  q.value = 'orbit'; q.dispatchEvent(new w.Event('input', { bubbles: true }));
  const vis = $$('#sb-nav [data-q]:not([hidden])');
  ok(vis.length > 0 && vis.length < all && vis.every(e => e.dataset.q.includes('orbit')), `${tag}: search "orbit" shows ${vis.length} of ${all} rows`);
  ok($$('#sb-nav .nav-reg').some(r => r.hidden) || $$('#sb-nav .cluster').some(c => c.hidden), `${tag}: search hides the constellations with no hit`);
  q.value = 'zzzz-none'; q.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok(!$('#sb-empty').hidden, `${tag}: a search with no hit shows the empty note`);
  q.value = 'orbit'; q.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.openSidebar();
  const pick = $('#sb-nav .nav-item:not([hidden]):not(.active)');
  const key = pick.dataset.tab;
  pick.click();
  ok(q.value === '' && $$('#sb-nav [data-q][hidden]').length === 0, `${tag}: a page choice clears the search`);
  ok($('#sb-nav .active') && $('#sb-nav .active').dataset.tab === key && w.document.title.includes(w.LABELS[key]), `${tag}: a page choice marks the new page (${key})`);
  if (drawer) ok(!sb.classList.contains('open'), `${tag}: a page choice closes the drawer and shows the page`);

  // Region tabs.
  w.jumpRegion('graphics');
  ok($('#sb-regions .rg-tab[data-region="graphics"]').getAttribute('aria-selected') === 'true' && $$('#sb-regions [aria-selected="true"]').length === 1, `${tag}: a region tab jump marks that tab`);
  w.close();
}

// The viewport meta lets the safe-area insets work.
ok(/viewport-fit=cover/.test(html), 'index.html: the viewport meta has viewport-fit=cover');

console.log(`\nshell-mobile-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

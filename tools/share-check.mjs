#!/usr/bin/env node
// ============================================================================
//  tools/share-check.mjs — node checks of the share URLs
// ----------------------------------------------------------------------------
//  The share URL of a page is https://davesgames.io/stella-nova/<key>/. The
//  deploy writes a preview page there (tools/share-pages.mjs). This file
//  checks the parts. No browser runs, and nothing goes to the live site.
//
//    1. generator: a stub for each registered page except home, in a temp
//       folder; meta tags present, escaped and absolute; og:image is a
//       thumbnail file that exists or the site card; redirect target; size;
//       no key takes the name of a real folder; a collision is skipped;
//       --clean deletes only stubs
//    2. lib/share-url.js: hash -> share URL (vm)
//    3. sw.js: a stub path goes to the network and is not stored; with no
//       network the worker answers with the redirect (vm, fake caches)
//    4. jsdom: the inline script of a stub calls location.replace with the
//       shell hash URL (query and route kept); the Share button of the shell
//       copies the share URL
//
//  Usage (repo root; jsdom must resolve for part 4, for example NODE_PATH):
//    NODE_PATH=<dir>/node_modules node tools/share-check.mjs
//  Exit 1 on any failure.
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { sharePages, writeStubs, stubHtml, cleanStubs, esc, ROOT, SITE } from './share-pages.mjs';
import { jpegSize } from './thumbs-small.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('ok    ' + m); } else { fail++; console.log('FAIL  ' + m + (d ? '\n      ' + d : '')); } };
const unesc = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const metaOf = (html, attr, name) => { const m = html.match(new RegExp(`<meta ${attr}="${name.replace(/[:.]/g, '\\$&')}" content="([^"]*)">`)); return m ? m[1] : null; };

// The registry, as the shell sees it.
const nav = { window: null };
nav.window = nav;
vm.createContext(nav);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'stella-nova/lib/nav-data.js'), 'utf8'), nav);
const PAGES = nav.snPages();

// ── 1. generator ────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'share-check-'));
const recs = sharePages({ out: tmp });
const n = writeStubs(tmp, recs);
const want = PAGES.filter(p => p.key !== 'home');
ok(recs.length === want.length && n === want.length, `a stub for each registered page except home (${n} of ${want.length})`);
ok(!recs.some(r => r.key === 'home') && !fs.existsSync(path.join(tmp, 'stella-nova/home')), 'no stub for home (its share URL is the shell)');
const realNames = new Set(fs.readdirSync(path.join(ROOT, 'stella-nova')));
const clash = want.filter(p => realNames.has(p.key)).map(p => p.key);
ok(clash.length === 0 && recs.every(r => !r.skip), 'no key takes the name of a folder or file in stella-nova/', clash.join(', '));

const bad = { meta: [], url: [], img: [], redirect: [], size: [] };
let plates = 0, biggest = 0;
const sizes = {};
for (const p of want) {
  const f = path.join(tmp, 'stella-nova', p.key, 'index.html');
  if (!fs.existsSync(f)) { bad.meta.push(p.key + ' (no file)'); continue; }
  const html = fs.readFileSync(f, 'utf8');
  biggest = Math.max(biggest, html.length);
  if (html.length > 4096) bad.size.push(p.key);
  const url = `${SITE}/stella-nova/${p.key}/`;
  const title = metaOf(html, 'property', 'og:title');
  const need = ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt'];
  const miss = need.filter(k => !metaOf(html, 'property', k)).concat(['description', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'theme-color'].filter(k => !metaOf(html, 'name', k)));
  if (miss.length || !title || unesc(title) !== p.label + ' · Stella Nova' || !html.includes(`<title>${esc(p.label + ' · Stella Nova')}</title>`)) bad.meta.push(p.key + (miss.length ? ' missing ' + miss.join(' ') : ' title'));
  if (metaOf(html, 'property', 'og:url') !== url || !html.includes(`<link rel="canonical" href="${url}">`) || metaOf(html, 'name', 'twitter:card') !== 'summary_large_image') bad.url.push(p.key);
  const img = metaOf(html, 'property', 'og:image');
  const thumb = `${SITE}/stella-nova/pages/home/thumbs/${p.key}.jpg?v=`;
  if (img && img.startsWith(thumb)) {
    const tf = path.join(ROOT, 'stella-nova/pages/home/thumbs', p.key + '.jpg');
    const sz = fs.existsSync(tf) && jpegSize(tf);
    if (!sz || metaOf(html, 'property', 'og:image:width') !== String(sz.w) || metaOf(html, 'property', 'og:image:height') !== String(sz.h)) bad.img.push(p.key);
    else sizes[sz.w + 'x' + sz.h] = (sizes[sz.w + 'x' + sz.h] || 0) + 1;
  } else if (img === `${SITE}/stella-nova/icons/og-image.jpg?v=2`) {
    plates++;
    if (!fs.existsSync(path.join(ROOT, 'stella-nova/icons/og-image.jpg'))) bad.img.push(p.key + ' (no og-image.jpg)');
  } else bad.img.push(p.key + ' ' + img);
  if (!html.includes(`'#${p.key}'+`) || !html.includes(`content="0; url=/stella-nova/#${p.key}"`) || !html.includes(`<a href="/stella-nova/#${p.key}">`)) bad.redirect.push(p.key);
}
ok(!bad.meta.length, 'each stub has the title, description, Open Graph and Twitter tags', bad.meta.slice(0, 5).join('; '));
ok(!bad.url.length, 'og:url and canonical are the absolute share URL of the page', bad.url.slice(0, 5).join(', '));
ok(!bad.img.length, `og:image is an absolute URL of a file that exists, with its real size (thumbnails ${JSON.stringify(sizes)}, ${plates} site card 1200x630)`, bad.img.slice(0, 5).join(', '));
ok(!bad.redirect.length, 'each stub sends the browser to /stella-nova/#<key> (script, noscript refresh, link)', bad.redirect.slice(0, 5).join(', '));
ok(!bad.size.length, `each stub is 4 KB or less (largest ${biggest} bytes)`, bad.size.join(', '));

// Escaping, with a hostile record.
const evil = stubHtml({ key: 'x', title: '<b>"A&B"</b> \'q\'', description: '</title><script>alert(1)</script> & "d"', url: SITE + '/stella-nova/x/', image: { url: SITE + '/a.jpg?a=1&b=2', w: 640, h: 400, fallback: false }, rel: 'stella-nova/x/index.html' });
ok(!/<b>|<\/title><script>alert/.test(evil) && evil.includes('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt; &#39;q&#39; · Stella Nova') && evil.includes('a.jpg?a=1&amp;b=2'), 'title, description and image URL are escaped');

// A collision: a real folder with the name of a key is not overwritten.
const col = fs.mkdtempSync(path.join(os.tmpdir(), 'share-col-'));
fs.mkdirSync(path.join(col, 'stella-nova', 'plant-growth'), { recursive: true });
fs.writeFileSync(path.join(col, 'stella-nova', 'plant-growth', 'index.html'), 'a real page');
const colRecs = sharePages({ out: col });
writeStubs(col, colRecs);
const pg = colRecs.find(r => r.key === 'plant-growth');
ok(pg && pg.skip && fs.readFileSync(path.join(col, 'stella-nova/plant-growth/index.html'), 'utf8') === 'a real page', 'a key that matches a real folder is skipped and the folder is kept');
const removed = cleanStubs(col);
ok(removed === want.length - 1 && fs.existsSync(path.join(col, 'stella-nova/plant-growth/index.html')), `--clean deletes only stub folders (${removed})`);
// A second run over its own stubs is not a collision.
ok(sharePages({ out: tmp }).every(r => !r.skip), 'a second run over its own stubs writes them again');
fs.rmSync(col, { recursive: true });

// ── 2. lib/share-url.js ─────────────────────────────────────────────────────
const sctx = { document: { readyState: 'complete', getElementById: () => null }, setTimeout, clearTimeout, Promise };
sctx.window = sctx;
vm.createContext(sctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'stella-nova/lib/nav-data.js'), 'utf8'), sctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'stella-nova/lib/share-url.js'), 'utf8'), sctx);
const U = sctx.snShare.url;
const cases = [
  ['#plant-growth', SITE + '/stella-nova/plant-growth/'],
  ['plant-growth', SITE + '/stella-nova/plant-growth/'],
  ['#wiki/e/resources/iron-ingot', SITE + '/stella-nova/wiki/#e/resources/iron-ingot'],
  ['#home', SITE + '/stella-nova/'],
  ['', SITE + '/stella-nova/'],
  ['#stats', SITE + '/stella-nova/#stats'],
  ['#no-such-page', SITE + '/stella-nova/#no-such-page'],
];
for (const [h, u] of cases) ok(U(h) === u, `share URL of "${h}" is ${u}`, 'got ' + U(h));
ok(want.every(p => U('#' + p.key) === `${SITE}/stella-nova/${p.key}/`), 'share URL of every stub page is its stub URL');

// ── 3. sw.js ────────────────────────────────────────────────────────────────
{
  const store = new Map();
  const cacheApi = {
    async open(nm) { if (!store.has(nm)) store.set(nm, new Map()); const m = store.get(nm); return { async match(r) { return m.get(typeof r === 'string' ? r : r.url); }, async put(r, res) { m.set(typeof r === 'string' ? r : r.url, await res.text()); }, async keys() { return [...m.keys()].map(u => new Request(u)); }, async delete(r) { return m.delete(r.url || r); } }; },
    async keys() { return [...store.keys()]; },
    async delete(nm) { return store.delete(nm); },
  };
  let online = true, fetched = [];
  const fakeFetch = async (req) => { const u = typeof req === 'string' ? req : req.url; fetched.push(u); if (!online) throw new TypeError('offline'); return new Response('stub', { status: 200, headers: { 'content-type': 'text/html' } }); };
  const listeners = {};
  const self = { location: new URL(SITE + '/sw.js'), addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: { unregister: async () => true } };
  const ctx = vm.createContext({ self, caches: cacheApi, fetch: fakeFetch, Response, Request, Headers, URL, console, Map, Set, Promise, importScripts: () => { self.SN_OFFLINE = { version: 'x', core: [['stella-nova/index.html', 'h1']], lazy: [] }; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
  const get = async (u) => { let r = null; const ev = { request: new Request(u), waitUntil() {}, respondWith(p) { r = p; } }; listeners.fetch.forEach(f => f(ev)); return r ? await r : null; };
  const res = await get(SITE + '/stella-nova/plant-growth/?utm_source=x');
  const stored = [...store.values()].reduce((a, m) => a + m.size, 0);
  ok(res && res.status === 200 && fetched.length === 1 && stored === 0, 'sw: a stub path goes to the network and nothing is stored', `status ${res && res.status}, fetches ${fetched.length}, stored ${stored}`);
  online = false;
  const off = await get(SITE + '/stella-nova/plant-growth/?utm_source=x');
  ok(off && off.status === 302 && off.headers.get('location') === SITE + '/stella-nova/?utm_source=x#plant-growth', 'sw: with no network a stub path redirects to the shell hash URL', off ? off.status + ' ' + off.headers.get('location') : 'no answer');
  online = true; fetched = [];
  await get(SITE + '/stella-nova/lib/nav-data.js');
  ok(fetched.length === 1 && store.has('sn-runtime'), 'sw: other same-origin files still go to the runtime cache path');
}

// ── 4. jsdom ────────────────────────────────────────────────────────────────
let JSDOM = null;
try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { ok(false, 'jsdom resolves (set NODE_PATH)', e.message); }
if (JSDOM) {
  // The stub is parsed by jsdom with its real URL. jsdom cannot replace
  // location.replace (it is unforgeable) and does not navigate, so the
  // inline script runs with a "location" that reads the real one and
  // records the replace call.
  const html = fs.readFileSync(path.join(tmp, 'stella-nova/plant-growth/index.html'), 'utf8');
  const run = (url) => {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const w = dom.window, calls = [];
    const code = w.document.querySelector('head script').textContent;
    const loc = { search: w.location.search, hash: w.location.hash, replace: (u) => calls.push(u) };
    w.eval(`(function(location){${code}})`)(loc);
    const title = w.document.title, refresh = w.document.querySelector('noscript') && w.document.querySelector('noscript').textContent;
    w.close();
    return { calls, title, refresh };
  };
  const a = run(SITE + '/stella-nova/plant-growth/');
  ok(a.calls.length === 1 && a.calls[0] === '/stella-nova/#plant-growth', 'jsdom: the stub calls location.replace("/stella-nova/#plant-growth")', JSON.stringify(a.calls));
  ok(a.title === 'Plant Growth · Stella Nova', 'jsdom: the stub title is "Plant Growth · Stella Nova"', a.title);
  const b = run(SITE + '/stella-nova/plant-growth/?utm_source=discord#seed=4');
  ok(b.calls[0] === '/stella-nova/?utm_source=discord#plant-growth/seed=4', 'jsdom: the query and the hash go on to the shell', JSON.stringify(b.calls));

  // The Share button of the shell.
  const shell = new JSDOM('<!doctype html><html><head></head><body><div id="topbar"><span id="topbar-active">x</span><a id="tb-wishlist" href="#">W</a></div></body></html>', { url: SITE + '/stella-nova/#wiki/e/resources/iron-ingot', runScripts: 'outside-only', pretendToBeVisual: true });
  const sw = shell.window;
  const copied = [];
  Object.defineProperty(sw.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
  sw.matchMedia = () => ({ matches: false });
  sw.eval(fs.readFileSync(path.join(ROOT, 'stella-nova/lib/nav-data.js'), 'utf8'));
  sw.eval(fs.readFileSync(path.join(ROOT, 'stella-nova/lib/share-url.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 10));
  const btn = sw.document.getElementById('tb-share');
  ok(btn && btn.nextElementSibling && btn.nextElementSibling.id === 'tb-wishlist', 'jsdom: the Share button is in the top bar, before the wishlist chip');
  btn.click();
  await new Promise(r => setTimeout(r, 10));
  ok(copied[0] === SITE + '/stella-nova/wiki/#e/resources/iron-ingot', 'jsdom: the Share button copies the share URL', JSON.stringify(copied));
  ok(btn.textContent.includes('Link copied'), 'jsdom: the button says "Link copied"');
  // Phone: the system share sheet gets the same URL.
  const shared = [];
  sw.matchMedia = () => ({ matches: true });
  Object.defineProperty(sw.navigator, 'share', { value: async (d) => { shared.push(d.url); }, configurable: true });
  sw.history.replaceState(null, '', '#plant-growth');
  btn.click();
  await new Promise(r => setTimeout(r, 10));
  ok(shared[0] === SITE + '/stella-nova/plant-growth/', 'jsdom: on a touch screen navigator.share gets the share URL', JSON.stringify(shared));
  sw.close();
}

fs.rmSync(tmp, { recursive: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

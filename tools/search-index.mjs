#!/usr/bin/env node
// ============================================================================
//  tools/search-index.mjs — write the site search index
// ----------------------------------------------------------------------------
//  Writes stella-nova/lib/search-index.js (window.SN_SEARCH_INDEX), which
//  lib/site-search.js ranks. One row per registered page, all fields as
//  plain text:
//    k  key                     l  label
//    p  region > constellation > group
//    s  home blurb + SEARCH_WORDS (pages/home/sectors.js) + port credit
//    d  <meta name="description"> of the page
//    h  <title>, h1-h4, figcaption, button and aria-label text
//    b  the most useful body words of the page (tf-idf, top BODY_WORDS)
//  Body text is the HTML with script, style, svg, template and comments
//  removed. Text that a page writes with JS is not in it.
//
//  Usage (repo root):
//    node tools/search-index.mjs           write the index
//    node tools/search-index.mjs --check   change nothing, exit 1 if the
//                                          index is out of date
//  nav-sync does not call this tool. Run it after you add a page or edit
//  BLURBS, SEARCH_WORDS or a page's text.
//
//  grep -n targets: "function pageText", "function bodyWords", "BODY_WORDS"
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SN = path.join(ROOT, 'stella-nova');
const HOME = path.join(SN, 'pages', 'home');
const OUT = path.join(SN, 'lib', 'search-index.js');
const BODY_WORDS = 50;
const CHECK = process.argv.includes('--check');

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of [path.join(HOME, 'thumbs', 'list.js'), path.join(SN, 'lib', 'nav-data.js'), path.join(HOME, 'sectors.js'), path.join(SN, 'lib', 'site-search.js')]) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { BLURBS = {}, SEARCH_WORDS = {}, CREDITS = {}, DIRECTORY_ONLY = new Set() } = ctx.Observatory;
const S = ctx.snSearch;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '-', ndash: '-', middot: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: ' ', times: 'x', deg: ' degrees ' };
const unent = t => t.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10) || 32) : (ENT[e.toLowerCase()] ?? ' '));
const clean = t => unent(t.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// The text fields of one page: description, heading-like text, body.
function pageText(file) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch { return { d: '', h: '', body: '' }; }
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const d = (/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html) || [])[1] || '';
  const heads = [];
  for (const re of [/<title>([\s\S]*?)<\/title>/gi, /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, /<summary[^>]*>([\s\S]*?)<\/summary>/gi, /\saria-label=["']([^"']{3,80})["']/gi]) {
    for (const m of html.matchAll(re)) heads.push(clean(m[1]));
  }
  const h = heads.join(' · ').replace(/\s*[—-]\s*Stella Nova\s*·\s*davesgames\.io/g, '').slice(0, 1500);
  const body = clean(html.replace(/<(script|style|svg|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<head\b[\s\S]*?<\/head>/i, ' '));
  return { d: unent(d), h, body };
}

const pages = ctx.snPages().filter(p => !DIRECTORY_ONLY.has(p.key));
const raw = pages.map(p => ({ p, t: pageText(path.join(SN, p.path)) }));

// Body words: stems that the page uses often and few pages use (tf-idf).
const df = new Map();
const tfs = raw.map(({ t }) => {
  const tf = new Map();
  for (const w of S.tokens(t.body)) {
    if (w.length < 3 || /^\d+$/.test(w)) continue;
    const st = S.stem(w);
    tf.set(st, (tf.get(st) || 0) + 1);
  }
  for (const st of tf.keys()) df.set(st, (df.get(st) || 0) + 1);
  return tf;
});
const STOP = new Set('the and for with you your are this that from into its can how what why when where which who will not but all any each more most one two our was has have use used uses using than then there these those over under about also only just like very such some other them they their been being would could should here page stella nova davesgames'.split(' '));
function bodyWords(tf) {
  const N = raw.length;
  return [...tf].filter(([s]) => !STOP.has(s) && df.get(s) < N * 0.4)
    .map(([s, n]) => [s, (1 + Math.log(n)) * Math.log(N / df.get(s))])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, BODY_WORDS).map(x => x[0]).sort().join(' ');
}

const rows = raw.map(({ p, t }, i) => {
  const group = p.group.h ? ' > ' + p.group.h : '';
  return {
    k: p.key, l: p.label,
    p: p.region.label + ' > ' + p.con.label + group,
    s: [BLURBS[p.key], SEARCH_WORDS[p.key], CREDITS[p.key], p.badge].filter(Boolean).join(' · '),
    d: t.d, h: t.h, b: bodyWords(tfs[i]),
  };
});

const text = `// ============================================================================
//  SEARCH INDEX  ·  written by tools/search-index.mjs — do not edit by hand
// ----------------------------------------------------------------------------
//  One row per registered page, read by lib/site-search.js. Fields:
//  k key, l label, p place in the nav, s home blurb and search words,
//  d page description, h title and headings, b top body words.
//  ${rows.length} pages.
// ============================================================================
window.SN_SEARCH_INDEX = { pages: [
${rows.map(r => JSON.stringify(r)).join(',\n')}
] };
`;

const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (CHECK) {
  if (old !== text) { console.log('search-index: lib/search-index.js is out of date; run node tools/search-index.mjs'); process.exit(1); }
  console.log(`search-index: up to date (${rows.length} pages, ${(text.length / 1024).toFixed(1)} KB)`);
} else {
  fs.writeFileSync(OUT, text);
  const empty = rows.filter(r => !r.d).map(r => r.k);
  console.log(`search-index: wrote ${path.relative(ROOT, OUT)} (${rows.length} pages, ${(text.length / 1024).toFixed(1)} KB)`);
  if (empty.length) console.log(`  ${empty.length} page(s) have no meta description: ${empty.join(' ')}`);
}

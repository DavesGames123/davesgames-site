#!/usr/bin/env node
// ============================================================================
//  SHARE PAGES  ·  one static link-preview page per Stella Nova page
// ----------------------------------------------------------------------------
//  The shell routes pages by the URL hash (/stella-nova/#plant-growth).
//  Link-preview bots (Discord, Slack, iMessage, X, Facebook, LinkedIn) do
//  not send the hash and do not run JS. So each hash URL got the card of
//  the shell. The user reported: "the metadata that gets sent over discord
//  is not pointing directly to the page i linked, instead going to the
//  site's homepage".
//
//  This tool writes one small HTML file per registered page (snPages() of
//  lib/nav-data.js, less "home"):
//
//    <out>/stella-nova/<key>/index.html   ->  https://davesgames.io/stella-nova/<key>/
//
//  Each file has the title, the description, the Open Graph and Twitter
//  card tags, a canonical link to its own URL, and a redirect to the shell:
//  location.replace to /stella-nova/<search>#<key>[/<hash>], a noscript
//  meta refresh, and a visible link. A hash on the share URL goes on as the
//  page route, so /stella-nova/wiki/#e/x opens #wiki/e/x.
//
//  Text: the title is the nav label. The description is the BLURBS line of
//  pages/home/sectors.js, else the meta description of the page, else the
//  site line. All text is escaped.
//  Image: pages/home/thumbs/<key>.jpg (640x400) with its real size, and
//  ?v=<sha1 of the file> so a new capture gets a new card. A page with no
//  thumbnail gets icons/og-image.jpg (1200x630), the site card.
//
//  The files are not in git. The pages workflow runs this tool before the
//  upload. The offline manifest reads the git index, so the service worker
//  does not precache them (sw.js "SHARE_PATH" passes them through).
//
//  A key that has the name of a real folder in stella-nova/ (lib, pages,
//  and so on) gets no file. The tool tells, and --strict exits 1.
//
//  Usage (from the repo root):
//    node tools/share-pages.mjs --out .         write the files (deploy)
//    node tools/share-pages.mjs --out DIR       write them under DIR (dry run)
//    node tools/share-pages.mjs --out DIR --clean   delete the files it wrote
//    add --strict to exit 1 on a collision
//  tools/share-check.mjs tests it.
//
//  grep -n targets
//    site origin .......... "const SITE"
//    page list ............ "export function sharePages"
//    one stub ............. "export function stubHtml"
//    collision check ...... "function reservedNames"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jpegSize } from './thumbs-small.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = 'https://davesgames.io';
export const MARK = '<!-- share stub: tools/share-pages.mjs -->';
const SN = path.join(ROOT, 'stella-nova');
const HOME = path.join(SN, 'pages', 'home');
const SITE_LINE = 'Stella Nova, a space colony builder by Dave, with its interactive wiki and an open lab of physics simulations and live WebGPU shaders you can play in your browser.';
const FALLBACK_IMAGE = { url: SITE + '/stella-nova/icons/og-image.jpg?v=2', w: 1200, h: 630 };
const KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Plain text from a meta content value or a blurb: decode, drop tags, fold space.
function plain(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function loadRegistry() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of [path.join(HOME, 'thumbs', 'list.js'), path.join(SN, 'lib', 'nav-data.js'), path.join(HOME, 'sectors.js')]) {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  }
  return { pages: ctx.snPages(), blurbs: (ctx.Observatory && ctx.Observatory.BLURBS) || {} };
}

function metaDescription(file) {
  if (!fs.existsSync(file)) return '';
  const t = fs.readFileSync(file, 'utf8');
  const m = t.match(/<meta\s+name=["']description["']\s+content=("([^"]*)"|'([^']*)')/i);
  return m ? plain(m[2] != null ? m[2] : m[3]) : '';
}

function imageFor(key) {
  const f = path.join(HOME, 'thumbs', key + '.jpg');
  if (!fs.existsSync(f)) return { ...FALLBACK_IMAGE, fallback: true };
  const size = jpegSize(f);
  if (!size) return { ...FALLBACK_IMAGE, fallback: true };
  const v = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
  return { url: `${SITE}/stella-nova/pages/home/thumbs/${key}.jpg?v=${v}`, w: size.w, h: size.h, fallback: false };
}

// Names in stella-nova/ that a stub must not take: every folder and file
// that is not a stub this tool wrote.
function reservedNames(dir) {
  const out = new Set();
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const own = d.isDirectory() && isStub(path.join(dir, d.name, 'index.html'));
    if (!own) out.add(d.name);
  }
  return out;
}

function isStub(file) {
  try { return fs.readFileSync(file, 'utf8').includes(MARK); } catch (e) { return false; }
}

// The share records: one per registered page except home.
// Each: { key, title, description, url, image, rel, skip }.
export function sharePages({ out = ROOT } = {}) {
  const { pages, blurbs } = loadRegistry();
  const taken = new Set([...reservedNames(SN), ...reservedNames(path.join(out, 'stella-nova'))]);
  return pages.filter(p => p.key !== 'home').map(p => {
    const rec = {
      key: p.key,
      title: plain(p.label),
      description: plain(blurbs[p.key]) || metaDescription(path.join(SN, p.path)) || SITE_LINE,
      url: `${SITE}/stella-nova/${p.key}/`,
      image: imageFor(p.key),
      rel: `stella-nova/${p.key}/index.html`,
      skip: null,
    };
    if (!KEY_RE.test(p.key)) rec.skip = 'key is not [a-z0-9-]';
    else if (taken.has(p.key)) rec.skip = `stella-nova/${p.key} is a real folder or file`;
    return rec;
  });
}

export function stubHtml(r) {
  const t = esc(r.title + ' · Stella Nova');
  const d = esc(r.description);
  const u = esc(r.url);
  const target = '/stella-nova/#' + r.key;
  const alt = esc(r.image.fallback ? 'The Stella Nova logo and title beside a gallery of the site\'s physics simulations and WebGPU shaders.' : 'A still of ' + r.title + ', a page of Stella Nova.');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${MARK}
<title>${t}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${d}">
<link rel="canonical" href="${u}">
<meta name="theme-color" content="#0a162c">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Stella Nova">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
<meta property="og:image" content="${esc(r.image.url)}">
<meta property="og:image:width" content="${r.image.w}">
<meta property="og:image:height" content="${r.image.h}">
<meta property="og:image:alt" content="${alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${esc(r.image.url)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<script>location.replace('/stella-nova/'+location.search+'#${r.key}'+(location.hash.length>1?'/'+location.hash.slice(1):''))</script>
<noscript><meta http-equiv="refresh" content="0; url=${target}"></noscript>
<style>html{background:#0a0c12;color:#c0cfe0;font:16px/1.5 system-ui,sans-serif}body{max-width:40em;margin:15vh auto;padding:0 16px}a{color:#96c8ff}</style>
</head>
<body>
<h1>${esc(r.title)}</h1>
<p>${d}</p>
<p><a href="${target}">Open ${esc(r.title)} on Stella Nova</a></p>
</body>
</html>
`;
}

export function writeStubs(out, recs) {
  let n = 0;
  for (const r of recs) {
    if (r.skip) continue;
    const f = path.join(out, r.rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, stubHtml(r));
    n++;
  }
  return n;
}

// Delete the stub folders under out/stella-nova that hold only a stub.
export function cleanStubs(out) {
  const dir = path.join(out, 'stella-nova');
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, d.name, 'index.html');
    if (d.isDirectory() && isStub(f) && fs.readdirSync(path.join(dir, d.name)).length === 1) {
      fs.rmSync(path.join(dir, d.name), { recursive: true });
      n++;
    }
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.indexOf('--out');
  if (a < 0 || !process.argv[a + 1]) {
    console.log('usage: node tools/share-pages.mjs --out DIR [--clean] [--strict]');
    process.exit(2);
  }
  const out = path.resolve(process.argv[a + 1]);
  if (process.argv.includes('--clean')) {
    console.log(`deleted ${cleanStubs(out)} share stub folder(s) under ${out}`);
    process.exit(0);
  }
  const recs = sharePages({ out });
  const n = writeStubs(out, recs);
  const skipped = recs.filter(r => r.skip);
  const plates = recs.filter(r => !r.skip && r.image.fallback).map(r => r.key);
  skipped.forEach(r => console.log(`skip ${r.key}: ${r.skip}`));
  console.log(`wrote ${n} share stubs under ${path.join(out, 'stella-nova')}/<key>/index.html`);
  console.log(`${plates.length} use the site card (no thumbnail): ${plates.join(', ') || 'none'}`);
  process.exit(skipped.length && process.argv.includes('--strict') ? 1 : 0);
}

#!/usr/bin/env node
// ============================================================================
//  tools/seo.mjs — crawler files for davesgames.io
// ----------------------------------------------------------------------------
//  Writes, from the page registry (stella-nova/lib/nav-data.js):
//    sitemap.xml   the site root, the shell and every registered page at
//                  its own URL (stella-nova/pages/<dir>/), with lastmod
//                  from the last git commit of the page folder
//    robots.txt    allows all, names the sitemap
//  The shell routes with #<key>, and crawlers drop the hash, so each page
//  is listed at its own folder URL. A page opened alone does not redirect
//  to the shell, so a crawler reads its real text.
//
//  --descriptions also gives each registered page that has no
//  <meta name="description"> one, from its home blurb (BLURBS in
//  pages/home/sectors.js), on the line after <title>. It never changes a
//  description that is there.
//
//  Usage (repo root):
//    node tools/seo.mjs                 write sitemap.xml and robots.txt
//    node tools/seo.mjs --descriptions  also add the missing descriptions
//    node tools/seo.mjs --check         change nothing; exit 1 when a file
//                                       is out of date (lastmod ignored)
//
//  grep -n targets: "function sitemap", "function addDescription", "ORIGIN"
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SN = path.join(ROOT, 'stella-nova');
const HOME = path.join(SN, 'pages', 'home');
const ORIGIN = 'https://' + fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim();
const CHECK = process.argv.includes('--check');
const DESC = process.argv.includes('--descriptions');

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of [path.join(HOME, 'thumbs', 'list.js'), path.join(SN, 'lib', 'nav-data.js'), path.join(HOME, 'sectors.js')]) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { BLURBS = {} } = ctx.Observatory;
const pages = ctx.snPages().filter(p => p.key !== 'home');
const xmlEsc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lastmod(rel) {
  try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], { cwd: ROOT, encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}

function sitemap() {
  const seen = new Set(), urls = [['', 'index.html', '1.0'], ['stella-nova/', 'stella-nova/index.html', '0.9']];
  for (const p of pages) {
    const dir = p.path.replace(/index\.html$/, '');
    if (seen.has(dir)) continue;
    seen.add(dir);
    urls.push(['stella-nova/' + dir, 'stella-nova/' + dir, '0.6']);
  }
  const body = urls.map(([u, rel, pr]) => {
    const lm = CHECK ? null : lastmod(rel);
    return `  <url><loc>${xmlEsc(ORIGIN + '/' + u)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}<priority>${pr}</priority></url>`;
  }).join('\n');
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Written by tools/seo.mjs from stella-nova/lib/nav-data.js. Do not edit by hand. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, n: urls.length };
}

const robots = `# Written by tools/seo.mjs. Do not edit by hand.\nUser-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;

function addDescription(p) {
  const file = path.join(SN, p.path);
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch { return 'no file'; }
  if (/<meta\s+name=["']description["']/i.test(html)) return null;
  const blurb = BLURBS[p.key];
  if (!blurb) return 'no blurb';
  const m = /<title>[^<]*<\/title>[^\n]*\n/i.exec(html);
  if (!m) return 'no <title>';
  if (!DESC) return 'missing';
  const tag = `<meta name="description" content="${xmlEsc(blurb)}">\n`;
  fs.writeFileSync(file, html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length));
  return 'added';
}

const strip = t => t.replace(/<lastmod>[^<]*<\/lastmod>/g, '');
const sm = sitemap();
const SM = path.join(ROOT, 'sitemap.xml'), RB = path.join(ROOT, 'robots.txt');
if (CHECK) {
  const bad = [];
  if (!fs.existsSync(SM) || strip(fs.readFileSync(SM, 'utf8')) !== sm.text) bad.push('sitemap.xml');
  if (!fs.existsSync(RB) || fs.readFileSync(RB, 'utf8') !== robots) bad.push('robots.txt');
  const miss = pages.filter(p => addDescription(p) === 'missing').map(p => p.key);
  console.log(`seo: ${sm.n} URLs; ${miss.length} page(s) with a blurb but no description${miss.length ? ': ' + miss.join(' ') : ''}`);
  if (bad.length) { console.log('seo: out of date: ' + bad.join(', ') + '; run node tools/seo.mjs'); process.exit(1); }
  console.log('seo: up to date');
} else {
  fs.writeFileSync(SM, sm.text);
  fs.writeFileSync(RB, robots);
  console.log(`seo: wrote sitemap.xml (${sm.n} URLs) and robots.txt`);
  const out = {};
  for (const p of pages) { const r = addDescription(p); if (r) (out[r] ||= []).push(p.key); }
  for (const [r, ks] of Object.entries(out)) console.log(`  ${r}: ${ks.length}${r === 'added' ? '' : ' (' + ks.join(' ') + ')'}`);
}

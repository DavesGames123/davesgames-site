#!/usr/bin/env node
// ============================================================================
//  NAV SYNC  ·  writes the home page blocks from lib/nav-data.js
// ----------------------------------------------------------------------------
//  stella-nova/lib/nav-data.js (SN_NAV) is the one page registry. The shell
//  reads it at run time. The home page keeps three static blocks for
//  no-JS readers and crawlers. This tool writes those blocks from SN_NAV,
//  between their BEGIN and END markers:
//    SECTOR-COLOURS  pages/home/style.css   [data-sector] --c and --c2
//    CHIPS           pages/home/index.html  one dock chip per sector
//    DIRECTORY       pages/home/index.html  every page as a real anchor,
//                                           one column per region
//    PAGES           stella-nova/PAGES.md   the page index: one row per
//                                           page, with place, badge,
//                                           blurb, credit, saver, thumb
//  It also checks the registry (errors, exit 1):
//    - no key is registered twice
//    - each registered page has pages/<dir>/index.html
//    - each folder in pages/ is registered, or is in UNLISTED
//    - each SN_XR, SN_CRAFT and SN_HIDDEN key is valid
//  and the home data (warnings only, exit code unchanged):
//    - each registered page has a BLURBS line in pages/home/sectors.js
//    - each page the home shows has thumbs/<key>.jpg, and list.js names
//      every thumbnail file (rebuild list.js after you add a JPEG)
//
//  Usage (from the repo root):
//    node tools/nav-sync.js           write the blocks, then check
//    node tools/nav-sync.js --check   change nothing, exit 1 if a block
//                                     is out of date or a check fails
//
//  The directory leaves out the EXCLUDED pages of pages/home/sectors.js
//  (ports of code we did not write). The tool loads sectors.js to read
//  that set, BLURBS and CREDITS, so each list stays in one place. It
//  loads lib/screensaver-catalog.js for the saver column of PAGES.md.
//
//  grep -n targets
//    unlisted folders ..... "const UNLISTED"
//    pages with no thumb .. "const NO_THUMB"
//    colour block ......... "function coloursBlock"
//    chip block ........... "function chipsBlock"
//    directory block ...... "function directoryBlock"
//    page index block ..... "function pagesBlock"
//    registry checks ...... "function checkRegistry"
//    blurb/thumb warnings . "function checkHome"
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SN = path.resolve(__dirname, '..', 'stella-nova');
const HOME = path.join(SN, 'pages', 'home');
const CHECK = process.argv.includes('--check');

// Folders in pages/ that are not in the nav, and why.
const UNLISTED = {
  'material-lab': 'the old Material Lab; the matlab key routes to material-studio',
  // Untracked folders on one machine. The six upstream files have no
  // licence, so the pages are not published. Delete the folders, or
  // register them when the author grants a licence.
  'energy-dashboard': 'Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed',
  'height-field-water': 'Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed',
  'morton-bvh': 'Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed',
  'pendulum-3d': 'Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed',
  'pendulum-trail': 'Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed',
  'sweep-and-prune': 'Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed',
};

// Shown pages that keep the generated letter plate on purpose, and why.
const NO_THUMB = {
  home: 'the home card uses media/game-6.jpg',
  translate: 'a text tool; a screenshot shows nothing of use',
  'flight-board': 'a capture shows the feed error until the proxy is live',
  'gravitational-imaging': 'the figures are mostly black at thumbnail size',
  photocraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
  lightcraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
  vectorcraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
  designcraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
  filmcraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
  effectcraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
  printcraft: 'Craft Suite: an unchanged upstream app; no capture of its UI',
};
// A JPEG for one of these keys still shows on the home; the entry only
// stops the warning.

// Load nav-data.js and sectors.js in one sandbox, as the home page does.
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of [path.join(HOME, 'thumbs', 'list.js'), path.join(SN, 'lib', 'nav-data.js'), path.join(HOME, 'sectors.js'), path.join(SN, 'lib', 'screensaver-catalog.js')]) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const NAV = ctx.SN_NAV;
const PAGES = ctx.snPages();
const { EXCLUDED, DIRECTORY_ONLY, SECTORS, BLURBS, CREDITS } = ctx.Observatory;
const THUMB_KEYS = new Set(ctx.Observatory.THUMB_KEYS || []);
const SAVER = (ctx.SN_SAVER_CATALOG || { pages: {} }).pages;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function coloursBlock() {
  const w = Math.max(...SECTORS.map(s => s.id.length)) + 2;
  const lines = [];
  NAV.forEach(r => r.constellations.forEach(c => {
    lines.push(`[data-sector="${c.id}"]`.padEnd(w + 16) + `{ --c: ${c.color}; --c2: ${c.color2}; }`);
  }));
  return lines.join('\n');
}

function chipsBlock() {
  return SECTORS.map(s => s.id === 'game'
    ? `    <a class="chip" data-sector="game" href="#features">${esc(s.short)}</a>`
    : `    <a class="chip" data-sector="${s.id}" href="#chart" data-goto="${s.id}">${esc(s.short)}</a>`).join('\n');
}

function directoryBlock() {
  const out = [];
  NAV.forEach(r => {
    out.push(`      <div class="dir-col" data-region="${r.id}">`);
    out.push(`        <p class="dir-region">${esc(r.label)}</p>`);
    r.constellations.forEach(c => {
      const groups = c.groups.map(g => ({ h: g.h, p: g.p.filter(p => !EXCLUDED.has(p[0])) })).filter(g => g.p.length);
      const n = groups.reduce((a, g) => a + g.p.length, 0);
      if (!n) return;
      out.push(`        <details class="dir-group" data-sector="${c.id}" open>`);
      out.push(`          <summary><span class="dir-dot"></span><span class="dir-name">${esc(c.label)}</span><span class="dir-count">${n}</span></summary>`);
      out.push('          <div class="dir-body">');
      groups.forEach(g => {
        if (g.h) out.push(`            <h4 class="dir-h">${esc(g.h)}</h4>`);
        out.push('            <ul>');
        g.p.forEach(([key, label, badge]) => {
          out.push(`              <li><a href="/stella-nova/#${key}" target="_top" data-key="${key}">${esc(label)}${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</a></li>`);
        });
        out.push('            </ul>');
      });
      out.push('          </div>');
      out.push('        </details>');
    });
    out.push('      </div>');
  });
  return out.join('\n');
}

// The page index of stella-nova/PAGES.md: one table per region, one row
// per page, in nav order. Then the hidden pages and the UNLISTED folders.
// Thumb is "yes" when thumbs/list.js names the key (what the home shows).
function pagesBlock() {
  const md = s => String(s == null ? '' : s).replace(/\|/g, '\\|');
  const home = key => DIRECTORY_ONLY.has(key) ? 'directory only' : EXCLUDED.has(key) ? 'search only' : 'shown';
  const saver = key => {
    const c = SAVER[key];
    if (!c || c.tier === 'excluded') return 'no';
    return (c.hook ? 'hook' : 'generic') + ', tier ' + c.tier + (c.default ? ', default' : '');
  };
  const out = [];
  out.push(`${PAGES.length} registered pages in ${NAV.length} regions and ${SECTORS.length} constellations.`);
  out.push(`Columns: Home = how the home page uses the page (shown; search only for the EXCLUDED ports; directory only).`);
  out.push(`Saver = lib/screensaver-catalog.js (hook or generic, tier, default list). Thumb = thumbs/list.js names the key.`);
  NAV.forEach(r => {
    out.push('', `### ${md(r.label)}`, '');
    out.push('| Key | Title | Constellation > group | Badge | Blurb | Credit | Home | Saver | Thumb |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    r.constellations.forEach(c => c.groups.forEach(g => g.p.forEach(([key, label, badge, dir]) => {
      const where = md(c.label) + (g.h ? ' > ' + md(g.h) : '');
      const k = '`' + key + '`' + (dir && dir !== key ? ' (pages/' + dir + ')' : '');
      out.push(`| ${k} | ${md(label)} | ${where} | ${md(badge || '')} | ${md(BLURBS[key] || '')} | ${md(CREDITS[key] || '')} | ${home(key)} | ${saver(key)} | ${THUMB_KEYS.has(key) ? 'yes' : 'no'} |`);
    })));
  });
  out.push('', '### Hidden pages', '', 'Open at `/stella-nova/#<key>`. Not in the nav, home, search or saver (SN_HIDDEN in lib/nav-data.js).', '');
  (ctx.SN_HIDDEN || []).forEach(([k, label, dir]) => out.push(`- \`${k}\` ${md(label)} (pages/${dir || k})`));
  out.push('', '### Folders not in the nav', '', 'UNLISTED in tools/nav-sync.js. A folder here is not a page of the site.', '');
  Object.entries(UNLISTED).forEach(([k, why]) => out.push(`- \`pages/${k}\`: ${md(why)}`));
  return out.join('\n');
}

// Replace the text between the BEGIN and END marker lines. Returns
// [newText, changed].
function splice(text, begin, end, body, file) {
  const a = text.indexOf(begin), b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`${file}: markers ${begin} / ${end} not found`);
  const head = text.slice(0, text.indexOf('\n', a) + 1);
  const tail = text.slice(text.lastIndexOf('\n', b) + 1);
  const next = head + body + '\n' + tail;
  return [next, next !== text];
}

function checkRegistry() {
  const errs = [];
  const seen = new Set();
  PAGES.forEach(p => {
    if (seen.has(p.key)) errs.push(`key registered twice: ${p.key}`);
    seen.add(p.key);
    if (!fs.existsSync(path.join(SN, p.path))) errs.push(`no file for ${p.key}: ${p.path}`);
  });
  for (const k of ctx.SN_XR || []) if (!seen.has(k)) errs.push(`SN_XR key is not a registered page: ${k}`);
  for (const k of ctx.SN_CRAFT || []) if (!seen.has(k)) errs.push(`SN_CRAFT key is not a registered page: ${k}`);
  for (const [k, , dir] of ctx.SN_HIDDEN || []) {
    if (seen.has(k)) errs.push(`SN_HIDDEN key is also in SN_NAV: ${k}`);
    if (!fs.existsSync(path.join(SN, 'pages', dir || k, 'index.html'))) errs.push(`no file for hidden page ${k}: pages/${dir || k}/index.html`);
  }
  const dirs = new Set(PAGES.map(p => p.path.split('/')[1]).concat((ctx.SN_HIDDEN || []).map(([k, , dir]) => dir || k)));
  fs.readdirSync(path.join(SN, 'pages'), { withFileTypes: true })
    .filter(d => d.isDirectory() && !dirs.has(d.name) && !UNLISTED[d.name])
    .forEach(d => errs.push(`pages/${d.name} is not in lib/nav-data.js (add it, or list it in UNLISTED)`));
  return errs;
}

// Warnings, not errors: a missing blurb or thumbnail does not break a
// page. The thumbnail agents and page authors fill them.
function checkHome() {
  const warns = [];
  const noBlurb = PAGES.filter(p => !BLURBS[p.key]).map(p => p.key);
  if (noBlurb.length) warns.push(`${noBlurb.length} page(s) with no BLURBS line in pages/home/sectors.js: ${noBlurb.join(', ')}`);
  const shown = PAGES.filter(p => !EXCLUDED.has(p.key) && !DIRECTORY_ONLY.has(p.key));
  const noFile = shown.filter(p => !NO_THUMB[p.key] && !fs.existsSync(path.join(HOME, 'thumbs', p.key + '.jpg'))).map(p => p.key);
  if (noFile.length) warns.push(`${noFile.length} shown page(s) with no thumbs/<key>.jpg: ${noFile.join(', ')}`);
  const files = fs.readdirSync(path.join(HOME, 'thumbs')).filter(n => n.endsWith('.jpg')).map(n => n.slice(0, -4));
  const notListed = files.filter(k => !THUMB_KEYS.has(k));
  if (notListed.length) warns.push(`${notListed.length} thumbnail(s) not in thumbs/list.js (rebuild it): ${notListed.join(', ')}`);
  const gone = [...THUMB_KEYS].filter(k => !files.includes(k));
  if (gone.length) warns.push(`thumbs/list.js names missing file(s): ${gone.join(', ')}`);
  return warns;
}

const jobs = [
  [path.join(HOME, 'style.css'), '/* SECTOR-COLOURS:BEGIN', '/* SECTOR-COLOURS:END', coloursBlock()],
  [path.join(HOME, 'index.html'), '<!-- CHIPS:BEGIN', '<!-- CHIPS:END', chipsBlock()],
  [path.join(HOME, 'index.html'), '<!-- DIRECTORY:BEGIN', '<!-- DIRECTORY:END', directoryBlock()],
  [path.join(SN, 'PAGES.md'), '<!-- PAGES:BEGIN', '<!-- PAGES:END', pagesBlock()],
];
let stale = 0;
const texts = {};
for (const [file, begin, end, body] of jobs) {
  const rel = path.relative(process.cwd(), file);
  const [next, changed] = splice(texts[file] ?? fs.readFileSync(file, 'utf8'), begin, end, body, rel);
  texts[file] = next;
  const name = begin.replace(/^\W+/, '').replace(/:BEGIN$/, '');
  if (changed) { stale++; console.log(`${CHECK ? 'out of date' : 'written    '}  ${name.padEnd(14)} ${rel}`); }
  else console.log(`up to date   ${name.padEnd(14)} ${rel}`);
}
if (!CHECK) for (const f in texts) fs.writeFileSync(f, texts[f]);

const errs = checkRegistry();
errs.forEach(e => console.log('error: ' + e));
checkHome().forEach(w => console.log('warning: ' + w));
console.log(`registry: ${PAGES.length} pages, ${NAV.length} regions, ${SECTORS.length} constellations, ${errs.length} errors`);
process.exit(errs.length || (CHECK && stale) ? 1 : 0);

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
//  It also checks the registry:
//    - no key is registered twice
//    - each registered page has pages/<dir>/index.html
//    - each folder in pages/ is registered, or is in UNLISTED
//
//  Usage (from the repo root):
//    node tools/nav-sync.js           write the blocks, then check
//    node tools/nav-sync.js --check   change nothing, exit 1 if a block
//                                     is out of date or a check fails
//
//  The directory leaves out the EXCLUDED pages of pages/home/sectors.js
//  (ports of code we did not write). The tool loads sectors.js to read
//  that set, so the list stays in one place.
//
//  grep -n targets
//    unlisted folders ..... "const UNLISTED"
//    colour block ......... "function coloursBlock"
//    chip block ........... "function chipsBlock"
//    directory block ...... "function directoryBlock"
//    registry checks ...... "function checkRegistry"
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
};

// Load nav-data.js and sectors.js in one sandbox, as the home page does.
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of [path.join(SN, 'lib', 'nav-data.js'), path.join(HOME, 'sectors.js')]) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const NAV = ctx.SN_NAV;
const PAGES = ctx.snPages();
const { EXCLUDED, SECTORS } = ctx.Observatory;

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
  const dirs = new Set(PAGES.map(p => p.path.split('/')[1]));
  fs.readdirSync(path.join(SN, 'pages'), { withFileTypes: true })
    .filter(d => d.isDirectory() && !dirs.has(d.name) && !UNLISTED[d.name])
    .forEach(d => errs.push(`pages/${d.name} is not in lib/nav-data.js (add it, or list it in UNLISTED)`));
  return errs;
}

const jobs = [
  [path.join(HOME, 'style.css'), '/* SECTOR-COLOURS:BEGIN', '/* SECTOR-COLOURS:END', coloursBlock()],
  [path.join(HOME, 'index.html'), '<!-- CHIPS:BEGIN', '<!-- CHIPS:END', chipsBlock()],
  [path.join(HOME, 'index.html'), '<!-- DIRECTORY:BEGIN', '<!-- DIRECTORY:END', directoryBlock()],
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
console.log(`registry: ${PAGES.length} pages, ${NAV.length} regions, ${SECTORS.length} constellations, ${errs.length} errors`);
process.exit(errs.length || (CHECK && stale) ? 1 : 0);

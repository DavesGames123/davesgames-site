#!/usr/bin/env node
// ============================================================================
//  tools/credits-check.mjs  ·  real-artwork credits and size budgets
// ----------------------------------------------------------------------------
//  The site puts human-made artwork (photographs, paintings, engravings,
//  drawings, scans) that comes from outside sources in one folder per page:
//
//    stella-nova/pages/<key>/artwork/<file>
//
//  This tool checks each file in each artwork folder:
//    1. The page has a credits file (CREDITS.md, CREDITS.txt or
//       LICENSES.md) with one line that names "artwork/<file>".
//    2. That line has an https source URL and a licence that this site
//       accepts: Public domain, PD Mark, CC0, CC BY or CC BY-SA.
//    3. That line has no NC or ND licence.
//    4. The file is a JPEG, PNG, WebP or GIF, is at most MAX_BYTES, and its
//       long side is at most MAX_SIDE pixels (read from the file header).
//  Also: each "artwork/<file>" that a credits file names must exist.
//
//  Usage
//    node tools/credits-check.mjs            every page with an artwork folder
//    node tools/credits-check.mjs <key> ...  only these pages
//    node tools/credits-check.mjs --selftest the header and line rules only
//  Exit code 1 on any failure.
//
//  grep -n targets
//    "const MAX_BYTES"      the size budget
//    "function imageSize"   JPEG, PNG, WebP and GIF header readers
//    "function lineProblems" the licence and URL rules for one line
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = path.join(ROOT, 'stella-nova', 'pages');
export const MAX_BYTES = 400 * 1024, MAX_SIDE = 2048;
const CREDIT_FILES = ['CREDITS.md', 'CREDITS.txt', 'LICENSES.md'];
const OK_LICENCE = /\b(public domain|pd mark|cc0|cc by(?:-sa)? \d(?:\.\d)?)\b/i;
const BAD_LICENCE = /\b(?:cc[ -]by[ -](?:sa[ -])?)?(?:nc|nd)(?:[ -]\d|\b)|by-nc|by-nd|noncommercial|noderivs|no derivatives/i;

/** Width and height from the header bytes, or null for an unknown format. */
export function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('latin1', 0, 4) === 'GIF8') return { type: 'gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const k = b.toString('latin1', 12, 16);
    if (k === 'VP8 ') return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L') { const n = b.readUInt32LE(21); return { type: 'webp', w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
    if (k === 'VP8X') return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** The problems of one credits line for one artwork file ([] when it passes). */
export function lineProblems(line) {
  const p = [];
  if (!/https:\/\/\S+/.test(line)) p.push('no https source URL on the credits line');
  if (!OK_LICENCE.test(line)) p.push('no accepted licence (Public domain, PD Mark, CC0, CC BY, CC BY-SA) on the credits line');
  if (BAD_LICENCE.test(line)) p.push('an NC or ND licence is on the credits line');
  return p;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

function checkPage(key) {
  const dir = path.join(PAGES, key), art = path.join(dir, 'artwork'), errs = [];
  const files = fs.existsSync(art) ? walk(art) : [];
  const credits = CREDIT_FILES.map(n => path.join(dir, n)).filter(f => fs.existsSync(f));
  const lines = credits.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map(text => ({ f: path.basename(f), text })));
  if (files.length && !credits.length) errs.push(`${key}: has artwork/ but no ${CREDIT_FILES.join(' or ')}`);
  for (const f of files) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    const b = fs.readFileSync(f), sz = imageSize(b);
    if (!sz) errs.push(`${key}/${rel}: not a JPEG, PNG, WebP or GIF`);
    else if (Math.max(sz.w, sz.h) > MAX_SIDE) errs.push(`${key}/${rel}: ${sz.w}x${sz.h} is over ${MAX_SIDE} px on the long side`);
    if (b.length > MAX_BYTES) errs.push(`${key}/${rel}: ${b.length} bytes is over the ${MAX_BYTES} byte budget`);
    const hit = lines.filter(l => l.text.includes(rel));
    if (!hit.length) { errs.push(`${key}/${rel}: no credits line names it`); continue; }
    for (const l of hit) for (const p of lineProblems(l.text)) errs.push(`${key}/${rel} (${l.f}): ${p}`);
    if (sz) console.log(`  ok ${key}/${rel}  ${sz.type} ${sz.w}x${sz.h}  ${(b.length / 1024).toFixed(0)} KB`);
  }
  for (const l of lines) for (const m of l.text.matchAll(/\bartwork\/[A-Za-z0-9._/-]+\.(?:jpe?g|png|webp|gif)\b/g)) {
    if (!fs.existsSync(path.join(dir, m[0]))) errs.push(`${key} (${l.f}): names ${m[0]}, which does not exist`);
  }
  return errs;
}

function selftest() {
  let bad = 0;
  const t = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
  const png = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  t(JSON.stringify(imageSize(png)) === '{"type":"png","w":640,"h":480}', 'png header');
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0]);
  t(JSON.stringify(imageSize(jpg)) === '{"type":"jpeg","w":640,"h":480}', 'jpeg SOF0 after APP0');
  t(imageSize(Buffer.from('not an image at all, no')) === null, 'unknown format is null');
  t(lineProblems('| `artwork/a.jpg` | Chladni | https://archive.org/details/b22017604 | Public domain |').length === 0, 'PD line passes');
  t(lineProblems('| `artwork/a.jpg` | ESO/S. Brunier | https://www.eso.org/x | CC BY 4.0 |').length === 0, 'CC BY line passes');
  t(lineProblems('| `artwork/a.jpg` | X | https://x.org | CC BY-NC 4.0 |').length > 0, 'NC line fails');
  t(lineProblems('| `artwork/a.jpg` | X | https://x.org | CC BY-ND 4.0 |').length > 0, 'ND line fails');
  t(lineProblems('| `artwork/a.jpg` | X | no url | CC BY 4.0 |').length > 0, 'missing URL fails');
  t(lineProblems('| `artwork/a.jpg` | X | https://x.org | all rights reserved |').length > 0, 'unknown licence fails');
  console.log(bad ? `selftest: ${bad} failed` : 'selftest: 9 passed');
  return bad;
}

const args = process.argv.slice(2);
let fails = selftest();
if (!args.includes('--selftest')) {
  const keys = args.length ? args : fs.readdirSync(PAGES).filter(k => fs.existsSync(path.join(PAGES, k, 'artwork')));
  console.log(`credits-check: ${keys.length} page(s): ${keys.join(', ')}`);
  for (const k of keys) {
    if (!fs.existsSync(path.join(PAGES, k))) { console.log(`FAIL ${k}: no such page`); fails++; continue; }
    for (const e of checkPage(k)) { console.log('FAIL', e); fails++; }
  }
}
console.log(fails ? `credits-check: ${fails} failure(s)` : 'credits-check: all passed');
process.exit(fails ? 1 : 0);

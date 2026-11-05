// ============================================================================
//  SPECTRAL LINES  ·  tools/build-lines.mjs — NIST ASD tables -> data/lines.js
// ----------------------------------------------------------------------------
//  Input: one NIST ASD "Lines" ASCII table per spectrum (X I and X II,
//  200-1100 nm air wavelengths), fetched one request at a time by the
//  fetch script in the session scratchpad. Output: data/lines.js, a
//  classic script that sets window.SPECTRA (and module.exports in node).
//
//  Selection rule (ours): per spectrum, keep lines with a wavelength and
//  an upper energy, or an unclassified line (no levels) with a NIST
//  intensity. Rank by NIST relative intensity when at least 30 % of
//  the lines have one, else by gk*Aki/lambda. Keep the top N_I = 160 (X I)
//  and N_II = 100 (X II). Levels are the distinct (energy, label) pairs
//  of the kept lines, so the page can draw an energy-level diagram.
//
//  Data: NIST Atomic Spectra Database (SRD 78), Kramida, Ralchenko,
//  Reader and NIST ASD Team. (c) U.S. Secretary of Commerce on behalf of
//  the United States of America. All rights reserved. We ship a selection
//  of measured values with credit; see ../CREDITS.md.
//
//  Usage: node tools/build-lines.mjs <raw dir> <syms.txt>
//
//  grep -n targets
//    table row parse ...... "function parseRow"
//    ranking .............. "function rank"
//    output shape ......... "const out ="
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const [RAW, SYMS] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const N = { I: 160, II: 100 };

const num = s => { const m = String(s || '').match(/-?\d+(\.\d+)?(e[+-]?\d+)?/i); return m ? +m[0] : NaN; };
const clean = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function parseRow(line) {
  // Columns differ between spectra (an unclassified table has no level
  // columns), so the row is read by content, not by a fixed index.
  const c = line.split('|').map(clean);
  if (c.length < 4) return null;
  const obs = num(c[0]), ritz = num(c[1]);
  const wl = Number.isFinite(obs) ? obs : ritz;
  if (!Number.isFinite(wl)) return null;
  const rel = num(c[2]);
  const A = /^\d.*e[+-]\d+$/i.test(c[3]) ? num(c[3]) : 0;
  const ei = c.findIndex((x, i) => i > 3 && /^[\[(]?-?\d+\.\d*[\])]?\s*[+a-z]*\s+-\s+[\[(]?-?\d/i.test(x));
  const r = { wl, rel: Number.isFinite(rel) && rel > 0 ? rel : 0, A, Ei: NaN, Ek: NaN, gk: 1, lo: '', up: '', forb: false };
  if (ei < 0) return r;                       // unclassified line: no levels
  const en = c[ei].split(/\s-\s/);
  r.Ei = num(en[0]); r.Ek = num(en[1]);
  const gi = c.findIndex((x, i) => i > ei && /^\d+\s*-\s*\d+$/.test(x));
  const labs = c.slice(ei + 1, gi < 0 ? ei + 1 : gi);
  const h = Math.floor(labs.length / 2);
  r.lo = labs.slice(0, h).filter(Boolean).join(' ');
  r.up = labs.slice(h).filter(Boolean).join(' ');
  if (gi >= 0) { r.gk = num(c[gi].split('-')[1]) || 1; r.forb = /M1|M2|E2|E3/.test(c[gi + 1] || ''); }
  return r;
}

function rank(rows) {
  const withRel = rows.filter(r => r.rel > 0).length / Math.max(rows.length, 1);
  const byRel = withRel >= 0.3;
  const key = r => byRel ? (r.rel || 1e-9 * r.gk * r.A) : r.gk * r.A / r.wl;
  return { byRel, rows: [...rows].sort((a, b) => key(b) - key(a)), key };
}

function spectrum(file, ion) {
  if (!fs.existsSync(file)) return null;
  const txt = fs.readFileSync(file, 'utf8');
  if (/Error Message|No lines are available/i.test(txt)) return null;
  const rows = [];
  for (const line of txt.split('\n')) {
    if (!/^\s*[\d\s.()\[\]+?a-z]*\|/i.test(clean(line))) continue;
    const r = parseRow(line);
    if (r && r.wl >= 200 && r.wl <= 1100 && (Number.isFinite(r.Ek) || r.rel > 0)) rows.push(r);
  }
  // NIST lists some lines twice (fine-structure blends): keep one per 0.001 nm.
  const seen = new Set(), uniq = [];
  for (const r of rows) { const k = Math.round(r.wl * 1000); if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
  if (!uniq.length) return null;
  const R = rank(uniq), keep = R.rows.slice(0, N[ion]);
  const top = Math.max(...keep.map(R.key));
  const levels = [], li = new Map();
  const lev = (E, label) => { const k = E.toFixed(5) + '|' + label; if (!li.has(k)) { li.set(k, levels.length); levels.push([+E.toFixed(5), label]); } return li.get(k); };
  const lines = keep.sort((a, b) => a.wl - b.wl).map(r => [
    +r.wl.toFixed(4),
    +Math.max(0.001, Math.log10(1 + 999 * R.key(r) / top) / 3).toFixed(3),   // 0..1, log scale
    +r.A.toPrecision(3), r.gk,
    Number.isFinite(r.Ei) ? lev(r.Ei, r.lo) : -1, Number.isFinite(r.Ek) ? lev(r.Ek, r.up) : -1, r.forb ? 1 : 0,
  ]);
  return { by: R.byRel ? 'rel' : 'gA', total: uniq.length, lines, levels };
}

const syms = fs.readFileSync(SYMS, 'utf8').split(/\s+/).filter(Boolean).slice(0, 103);
const out = { version: 1, source: 'NIST ASD (SRD 78), lines 200-1100 nm in air', fetched: '2026-11-04', elements: [] };
syms.forEach((sym, i) => {
  const I = spectrum(path.join(RAW, `${sym}_I.txt`), 'I'), II = spectrum(path.join(RAW, `${sym}_II.txt`), 'II');
  if (I || II) out.elements.push({ z: i + 1, sym, I, II });
});
const js = `// Generated by tools/build-lines.mjs from the NIST Atomic Spectra Database
// (SRD 78). (c) U.S. Secretary of Commerce on behalf of the United States
// of America. All rights reserved. A selection of measured values, shipped
// with credit: see ../CREDITS.md. Line row: [wavelength nm (air), strength
// 0..1 (log), Aki s^-1 (0 if none), gk, lower level index, upper level
// index (-1 for an unclassified line, which has no levels), forbidden].
// Level row: [energy eV, configuration term J].
(function (d) { if (typeof module !== 'undefined') module.exports = d; else window.SPECTRA = d; })(${JSON.stringify(out)});
`;
fs.writeFileSync(path.join(HERE, '..', 'data', 'lines.js'), js);
const n = out.elements.reduce((a, e) => a + (e.I ? e.I.lines.length : 0) + (e.II ? e.II.lines.length : 0), 0);
console.log(`elements ${out.elements.length}, lines ${n}, bytes ${js.length}`);

// ============================================================================
//  SCIENCE TOOLKIT  ·  core/csv.js  ·  delimited text
// ----------------------------------------------------------------------------
//  parseCsv() reads RFC 4180 text: quoted fields, "" inside quotes, and new
//  lines inside quotes. The delimiter (comma, tab, semicolon or bar) is the
//  one that gives the most rows with the same field count. clean() trims
//  cells, drops empty rows, finds the header and the numeric columns, and
//  can read a decimal comma. toCsv() writes RFC 4180 text back.
//
//  GREP MAP
//    grep -n "export function parseCsv"
//    grep -n "export function sniff"
//    grep -n "export function clean"
//    grep -n "export function toCsv"
// ============================================================================

export function parseCsv(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false, i = 0;
  const s = String(text).replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === '') { q = true; cell = ''; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
      if (ch === '\r' && s[i + 1] === '\n') i++;
      i++; continue;
    }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function sniff(text) {
  const sample = String(text).split(/\r?\n/).slice(0, 30).join('\n');
  let best = ',', bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const rows = parseCsv(sample, d).filter(r => r.join('').trim() !== '');
    if (!rows.length) continue;
    const counts = {};
    for (const r of rows) counts[r.length] = (counts[r.length] || 0) + 1;
    const [n, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const score = Number(n) > 1 ? c * 10 + Number(n) : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  // Runs of spaces when no other delimiter splits the lines.
  if (bestScore <= 0) return /\S\s+\S/.test(sample) ? ' ' : ',';
  return best;
}

const numRe = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
export function toNum(s, decimalComma = false) {
  let t = String(s).trim().replace(/−/g, '-');
  if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
  if (!numRe.test(t)) return null;
  return Number(t);
}

// Rows of cells -> { header, rows, numeric: [bool per column], bad: count }.
export function clean(text, { header = 'auto', decimalComma = false, delim } = {}) {
  const d = delim || sniff(text);
  let rows = d === ' ' ? String(text).split(/\r?\n/).map(l => l.trim().split(/\s+/)) : parseCsv(text, d);
  rows = rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== '') && !/^#/.test(r[0]));
  if (!rows.length) throw new Error('No data rows.');
  const width = Math.max(...rows.map(r => r.length));
  rows = rows.map(r => r.concat(Array(width - r.length).fill('')));
  let hasHeader = header === 'yes';
  if (header === 'auto') hasHeader = rows.length > 1 && rows[0].some(c => c !== '' && toNum(c, decimalComma) === null) && rows[1].some(c => toNum(c, decimalComma) !== null);
  const head = hasHeader ? rows[0].map((h, i) => h || `col${i + 1}`) : rows[0].map((_, i) => `col${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const numeric = head.map((_, j) => { const vals = body.map(r => r[j]).filter(c => c !== ''); return vals.length > 0 && vals.filter(c => toNum(c, decimalComma) !== null).length >= 0.8 * vals.length; });
  let bad = 0;
  const cols = head.map((_, j) => body.map(r => {
    if (!numeric[j]) return r[j];
    const v = toNum(r[j], decimalComma);
    if (v === null && r[j] !== '') bad++;
    return v;
  }));
  return { delim: d, header: head, hasHeader, body, cols, numeric, bad, width };
}

export function toCsv(header, body, d = ',') {
  const q = (c) => { const s = String(c ?? ''); return /[",\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [header, ...body].map(r => r.map(q).join(d)).join('\n');
}

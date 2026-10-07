// ============================================================================
//  CONTEXT FREE  ·  variation.js — the variation codes, in JavaScript
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING). The same mapping as
//  Variation::toString and Variation::fromString in the upstream
//  src-common/variation.cpp, so the page can show codes without the
//  engine. tests.mjs checks the two against each other.
//
//  1 = A, 26 = Z, 27 = AA, 702 = ZZ, 703 = AAA, 18278 = ZZZ. The code is
//  the seed of every random choice in the design.
// ============================================================================
export const VAR_MAX3 = 18278;

export function varToString(v) {
  v = Math.floor(v);
  if (!(v >= 1)) return '';
  let len = 0, range = 1;
  while (v >= range && range < 2147483647) { len++; v -= range; range *= 26; }
  let s = '';
  for (let i = 0; i < len; i++) { s = String.fromCharCode(65 + (v % 26)) + s; v = Math.floor(v / 26); }
  return s;
}

export function varFromString(str) {
  const t = String(str).trim();
  if (/^\d+$/.test(t)) { const n = parseInt(t, 10); return n > 0 && n <= 2147483647 ? n : -1; }
  if (!/^[A-Za-z]+$/.test(t)) return -1;
  let value = 0, offset = 0, range = 1;
  for (const c of t.toUpperCase()) {
    if (range > 2147483647) return -1;
    offset += range;
    value = value * 26 + (c.charCodeAt(0) - 65);
    range *= 26;
  }
  return offset + value > 2147483647 ? -1 : offset + value;
}

// A random code of one to three letters, as the Context Free app picks.
export function randomVariation(rnd = Math.random, max = VAR_MAX3) {
  return 1 + Math.floor(rnd() * max);
}

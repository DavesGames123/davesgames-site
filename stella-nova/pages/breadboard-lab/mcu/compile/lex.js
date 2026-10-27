// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/lex.js — source text -> tokens
// ----------------------------------------------------------------------------
//  Each token is { k, v, line, col, ll, bol, sp }: k is id, num, str, chr,
//  op or eof. ll is the logical line (after backslash-newline joins), bol
//  marks the first token of a line, sp marks a space before the token.
//
//  grep -n targets
//    PUNCTS ............... the operators, longest first
//    ESC .................. the escape letters
//    lex .................. the tokenizer
//    readEsc .............. an escape after a backslash
//    tok.k = 'num' ........ number literals and their suffixes
// ============================================================================
import { CErr } from './errors.js';

const PUNCTS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '##',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '?', ':', '=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '#'];
const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

export function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1, ll = 1, bol = true, sp = false;
  const n = src.length;
  const adv = k => { for (let q = 0; q < k; q++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const readEsc = () => {          // at the char after the backslash
    const c = src[i];
    if (c === 'x') { adv(1); let h = ''; while (/[0-9a-fA-F]/.test(src[i] || '')) { h += src[i]; adv(1); } return parseInt(h || '0', 16) & 255; }
    if (/[0-7]/.test(c)) { let o = ''; while (o.length < 3 && /[0-7]/.test(src[i] || '')) { o += src[i]; adv(1); } return parseInt(o, 8) & 255; }
    adv(1);
    return c in ESC ? ESC[c] : c.charCodeAt(0);
  };
  while (i < n) {
    const c = src[i];
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { adv(src[i + 1] === '\r' ? 3 : 2); sp = true; continue; }
    if (c === '\n') { adv(1); ll++; bol = true; sp = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { adv(1); sp = true; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(1); sp = true; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const at = { line, col };
      adv(2);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') ll++; adv(1); }
      if (i >= n) throw new CErr('unterminated comment', at);
      adv(2); sp = true; continue;
    }
    const tok = { k: '', v: null, line, col, ll, bol, sp };
    bol = false; sp = false;
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) { s += src[i]; adv(1); }
      tok.k = 'id'; tok.v = s; toks.push(tok); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:[0-9][0-9']*\.?[0-9']*|\.[0-9][0-9']*)(?:[eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i, i + 80));
      const body = m[1].replace(/'/g, ''), suf = m[2].toLowerCase();
      adv(m[0].length);
      let v, radix = 10, isFloat = false;
      if (/^0[xX]/.test(body)) { v = parseInt(body.slice(2), 16); radix = 16; }
      else if (/^0[bB]/.test(body)) { v = parseInt(body.slice(2), 2); radix = 2; }
      else if (/[.eE]/.test(body) || (suf.includes('f') && !/^0[xX]/.test(body))) { v = parseFloat(body); isFloat = true; }
      else if (body.length > 1 && body[0] === '0') { if (/[89]/.test(body)) throw new CErr(`invalid digit in octal constant ${body}`, tok); v = parseInt(body, 8); radix = 8; }
      else v = parseInt(body, 10);
      if (/[A-Za-z_]/.test(src[i] || '')) throw new CErr(`invalid suffix on number ${m[0]}${src[i]}`, tok);
      tok.k = 'num'; tok.v = v; tok.num = { isFloat, radix, u: suf.includes('u'), l: (suf.match(/l/g) || []).length, f: suf.includes('f') && isFloat };
      if (tok.num.l >= 2) throw new CErr('long long is not supported', tok);
      toks.push(tok); continue;
    }
    if (c === '"') {
      adv(1); let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') throw new CErr('missing terminating " character', tok);
        if (src[i] === '\\') { adv(1); s += String.fromCharCode(readEsc()); } else { s += src[i]; adv(1); }
      }
      if (i >= n) throw new CErr('missing terminating " character', tok);
      adv(1);
      tok.k = 'str'; tok.v = s; toks.push(tok); continue;
    }
    if (c === "'") {
      adv(1); let v;
      if (src[i] === '\\') { adv(1); v = readEsc(); } else { v = src.charCodeAt(i); adv(1); }
      if (src[i] !== "'") throw new CErr('a character constant holds one character; use "double quotes" for text', tok);
      adv(1);
      tok.k = 'chr'; tok.v = v > 127 ? v - 256 : v; toks.push(tok); continue;
    }
    const p = PUNCTS.find(q => src.startsWith(q, i));
    if (!p) throw new CErr(`stray '${c}' in program`, tok);
    adv(p.length);
    tok.k = 'op'; tok.v = p; toks.push(tok);
  }
  toks.push({ k: 'eof', v: null, line, col, ll: ll + 1, bol: true, sp: true });
  return toks;
}

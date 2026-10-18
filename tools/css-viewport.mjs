// ============================================================================
//  tools/css-viewport.mjs — a small CSS cascade for node viewport checks
// ----------------------------------------------------------------------------
//  jsdom has no layout and does not apply @media rules by viewport. This
//  module gives the phone layout checks what they need, with no browser:
//    mediaMatches(q, vp)   evaluates a media query list for a viewport
//                          vp = { w, h, coarse } (coarse: touch screen)
//    parseCss(text)        flat rule list [{ sel, decls, media: [q...] }]
//    styleOf(el, rules, vp)  the winning declarations for one element:
//                          active @media only, specificity, then order,
//                          !important first. Inline style is not read.
//    px(value, vp)         a length in CSS px, or NaN: px, rem, vw, vh,
//                          svh, dvh, %, min(), max(), clamp(), calc() with
//                          + - * /, and env() (its fallback, else 0)
//    makeMatchMedia(vp)    a window.matchMedia for jsdom at that viewport
//
//  Limits: no layout, no inheritance, no :is()/:where() specificity rules,
//  no container queries. A check on these numbers shows that no declared
//  size is wider than the viewport. It does not show the rendered width.
//
//  Readers: tools/shell-mobile-check.mjs, stella-nova/pages/home/tests.mjs
//
//  grep -n targets: "export function mediaMatches", "export function parseCss",
//    "export function styleOf", "export function px"
// ============================================================================

// One media query list. Comma = or. "and" joins features. Types: all,
// screen (true), print (false). "not" before a query inverts it.
export function mediaMatches(q, vp) {
  return String(q).split(',').some(part => {
    let s = part.trim().toLowerCase();
    let neg = false;
    if (s.startsWith('not ')) { neg = true; s = s.slice(4); }
    s = s.replace(/^only\s+/, '');
    const terms = s.split(/\s+and\s+/).map(t => t.trim()).filter(Boolean);
    const ok = terms.every(t => {
      if (t === 'all' || t === 'screen') return true;
      if (t === 'print') return false;
      const m = t.match(/^\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)$/);
      if (!m) return false;
      const [, f, raw] = m, v = (raw || '').trim();
      const n = parseFloat(v);
      switch (f) {
        case 'max-width': return vp.w <= n;
        case 'min-width': return vp.w >= n;
        case 'max-height': return vp.h <= n;
        case 'min-height': return vp.h >= n;
        case 'orientation': return v === (vp.w > vp.h ? 'landscape' : 'portrait');
        case 'pointer': case 'any-pointer': return v === (vp.coarse ? 'coarse' : 'fine');
        case 'hover': case 'any-hover': return v === (vp.coarse ? 'none' : 'hover');
        case 'prefers-reduced-motion': return v === 'no-preference';
        case 'prefers-color-scheme': return v === 'dark';
        default: return false;
      }
    });
    return neg ? !ok : ok;
  });
}

// Flat rules from a style sheet. @media nests; other at-rules (@keyframes,
// @font-face, @supports) are dropped with their bodies.
export function parseCss(text) {
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0, order = 0;
  function block(media) {
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '}') { i++; return; }
      const open = src.indexOf('{', i);
      if (open < 0) { i = src.length; return; }
      const head = src.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith('@media')) { block([...media, head.slice(6).trim()]); continue; }
      if (head.startsWith('@')) { skip(); continue; }
      const close = src.indexOf('}', i);
      const body = src.slice(i, close);
      i = close + 1;
      const decls = [];
      body.split(';').forEach(d => {
        const c = d.indexOf(':');
        if (c < 0) return;
        const prop = d.slice(0, c).trim().toLowerCase();
        let val = d.slice(c + 1).trim();
        const imp = /!important\s*$/.test(val);
        if (imp) val = val.replace(/!important\s*$/, '').trim();
        if (prop) decls.push({ prop, val, imp });
      });
      rules.push({ sel: head, decls, media, order: order++ });
    }
  }
  function skip() {
    let depth = 1;
    while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
  }
  block([]);
  return rules;
}

// Specificity of one simple selector: [ids, classes + attrs + pseudo-classes, types].
function specificity(sel) {
  const s = sel.replace(/::?[a-z-]+\([^)]*\)/g, m => (m.startsWith('::') ? ' e ' : ' .c ')).replace(/"[^"]*"/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 1e6 + cls * 1e3 + types;
}

// The selector with pseudo-elements and state pseudo-classes removed, so
// element.matches can take it. A selector with a state (:hover, :focus)
// never applies at rest, so it returns null.
function restSelector(sel) {
  if (/:(hover|focus|focus-visible|focus-within|active|checked|placeholder-shown|-webkit-[\w-]+)/.test(sel)) return null;
  if (/::/.test(sel)) return null;
  return sel;
}

export function styleOf(el, rules, vp) {
  const win = {};
  for (const r of rules) {
    if (!r.media.every(q => mediaMatches(q, vp))) continue;
    for (const one of r.sel.split(',')) {
      const s = restSelector(one.trim());
      if (!s) continue;
      let hit = false;
      try { hit = el.matches(s); } catch (e) { hit = false; }
      if (!hit) continue;
      const sp = specificity(s);
      for (const d of r.decls) {
        const k = [d.imp ? 1 : 0, sp, r.order];
        const cur = win[d.prop];
        if (!cur || k[0] > cur.k[0] || (k[0] === cur.k[0] && (k[1] > cur.k[1] || (k[1] === cur.k[1] && k[2] >= cur.k[2])))) win[d.prop] = { val: d.val, k };
      }
    }
  }
  const out = {};
  for (const p in win) out[p] = win[p].val;
  return out;
}

// A length in CSS px. pct is the % base (default: the viewport width).
export function px(value, vp, pct = vp.w) {
  if (value == null) return NaN;
  let s = String(value).trim().toLowerCase();
  s = s.replace(/env\(\s*[\w-]+\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (m, fb) => (fb ? fb.trim() : '0px'));
  s = s.replace(/var\([^)]*\)/g, 'NaN');
  let p = 0;
  const peek = () => s[p];
  const ws = () => { while (p < s.length && /\s/.test(s[p])) p++; };
  function num() {
    ws();
    const m = s.slice(p).match(/^(-?\d*\.?\d+(?:e-?\d+)?)(px|rem|em|vw|vh|svh|dvh|lvh|vmin|vmax|%)?/);
    if (m) {
      p += m[0].length;
      const n = parseFloat(m[1]), u = m[2] || '';
      return u === 'px' || u === '' ? n : u === 'rem' || u === 'em' ? n * 16 : u === 'vw' ? n * vp.w / 100
        : u === 'vmin' ? n * Math.min(vp.w, vp.h) / 100 : u === 'vmax' ? n * Math.max(vp.w, vp.h) / 100
        : u === '%' ? n * pct / 100 : n * vp.h / 100;
    }
    const f = s.slice(p).match(/^(min|max|clamp|calc)\(/);
    if (f) {
      p += f[0].length;
      const args = [expr()];
      ws(); while (peek() === ',') { p++; args.push(expr()); ws(); }
      if (peek() === ')') p++;
      if (f[1] === 'min') return Math.min(...args);
      if (f[1] === 'max') return Math.max(...args);
      if (f[1] === 'clamp') return Math.max(args[0], Math.min(args[1], args[2]));
      return args[0];
    }
    if (peek() === '(') { p++; const v = expr(); ws(); if (peek() === ')') p++; return v; }
    p = s.length;
    return NaN;
  }
  function term() {
    let v = num();
    for (;;) { ws(); const c = peek(); if (c === '*' || c === '/') { p++; const r = num(); v = c === '*' ? v * r : v / r; } else return v; }
  }
  function expr() {
    let v = term();
    for (;;) { ws(); const c = peek(); if ((c === '+' || c === '-') && /\s/.test(s[p + 1] || ' ')) { p++; const r = term(); v = c === '+' ? v + r : v - r; } else return v; }
  }
  const v = expr();
  ws();
  return p >= s.length ? v : NaN;
}

export function makeMatchMedia(vp) {
  return q => ({ matches: mediaMatches(q, vp), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

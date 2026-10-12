// ============================================================================
//  FLY DUEL  ·  contrast and phone rules of the title screen
//  (node tests/chooser-contrast.test.mjs)
// ----------------------------------------------------------------------------
//  Reads ui/chooser/chooser.css as text. Each text colour and its ground
//  come from the rules in the file (tokens resolve to their fall-back hex,
//  which style.css gives the same values). A translucent ground is put
//  over the layers under it, and the last layer is white: the worst case
//  of a bright 3D table behind the veil. Text needs WCAG AA: 4.5:1, or
//  3:1 for large text (24 px, or 18.7 px bold) and for a glyph.
//
//  GREP MAP
//      grep -n 'PARSE'      rules, media blocks, tokens
//      grep -n 'PAIRS'      every text / ground pair
//      grep -n 'GLYPHS'     a selected colour glyph on its ground
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const CSS = readFileSync(process.env.CHOOSER_CSS || join(ROOT, 'ui/chooser/chooser.css'), 'utf8');

// ------------------------------------------------------------ PARSE
// rules: [{ media, sels: [selector...], decl: { prop: value } }]
function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  function block(media) {
    while (i < css.length) {
      const open = css.indexOf('{', i), close = css.indexOf('}', i);
      if (close >= 0 && (open < 0 || close < open)) { i = close + 1; return; }
      if (open < 0) { i = css.length; return; }
      const head = css.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith('@')) { block(head); continue; }
      const end = css.indexOf('}', i);
      const body = css.slice(i, end);
      i = end + 1;
      const decl = {};
      for (const part of body.split(';')) {
        const k = part.indexOf(':');
        if (k > 0) decl[part.slice(0, k).trim()] = part.slice(k + 1).trim();
      }
      rules.push({ media, sels: head.split(',').map(s => s.trim().replace(/\s+/g, ' ')), decl });
    }
  }
  block('');
  return rules;
}
const RULES = parse(CSS);
// The last value of prop for a selector. media: '' = top level only,
// 'phone' = top level then the phone rules (.fdc-phone ... selectors and
// the landscape block when land is true).
function get(sel, prop, { land = false } = {}) {
  let v = null;
  for (const r of RULES) {
    if (/hover/.test(r.media)) continue;
    if (r.media && !(land && /landscape/.test(r.media))) continue;
    if (r.sels.includes(sel) && r.decl[prop] != null) v = r.decl[prop];
  }
  return v;
}
const tokenRule = RULES.find(r => r.sels.includes('.fdc') && r.decl['--c-bg']);
ok(!!tokenRule, 'parse: the .fdc token block');
function resolve(v, depth = 0) {
  if (v == null || depth > 6) return v;
  v = v.replace(/!important/, '').trim();
  const m = /^var\((--[\w-]+)(?:,(.*))?\)$/.exec(v);
  if (m) {
    const t = tokenRule.decl[m[1]];
    if (t != null) return resolve(t, depth + 1);
    return resolve(m[2], depth + 1);
  }
  return v;
}
function rgba(v) {
  v = resolve(v);
  if (!v || v === 'transparent' || v === 'none') return null;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)).concat(1); }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`colour not understood: ${v}`);
}
const bgOf = (sel, o) => rgba(get(sel, 'background', o) ?? get(sel, 'background-color', o));
const over = (top, under) => (top ? top.slice(0, 3).map((c, k) => c * top[3] + under[k] * (1 - top[3])) : under);
const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
// ground: selectors from the back (the veil) to the front
function ground(chain, o) {
  let c = [255, 255, 255];
  for (const sel of chain) c = over(bgOf(sel, o), c);
  return c;
}

// ------------------------------------------------------------ PAIRS
// [text selector, ground chain, need]; the colour comes from the text
// selector, or from colourSel when the colour is set on a parent.
const V = '.fdc-veil', VP = '.fdc-phone .fdc-veil';
const MODE_ON = '.fdc-mode[aria-checked="true"] .fdc-mt';
const PAIRS = [
  ['.fdc-title', [V], 4.5], ['.fdc-t1', [V], 4.5], ['.fdc-lede', [V], 4.5], ['.fdc-fine', [V], 4.5], ['.fdc-fine b', [V], 4.5],
  ['.fdc-lede', [VP], 4.5, { phone: true }], ['.fdc-fine', [VP], 4.5, { phone: true }],
  ['.fdc-x', [V, '.fdc-x'], 4.5], ['.fdc-back', [V, '.fdc-back'], 4.5], ['.fdc-how', [V, '.fdc-how'], 4.5],
  ['.fdc-mt b', [V, '.fdc-mode'], 3], ['.fdc-mt span', [V, '.fdc-mode'], 4.5],
  ['.fdc-mode[aria-checked="true"] .fdc-mt b', [V, '.fdc-mode', MODE_ON], 4.5], ['.fdc-mode[aria-checked="true"] .fdc-mt span', [V, '.fdc-mode', MODE_ON], 4.5],
  ['.fdc-dhead h2', [V, '.fdc-decks'], 4.5], ['.fdc-none', [V, '.fdc-decks'], 4.5], ['.fdc-note', [V, '.fdc-decks'], 4.5],
  ['.fdc-seat-n', [V, '.fdc-decks', '.fdc-seat-b'], 4.5], ['.fdc-seat-n', [V, '.fdc-decks', '.fdc-seat[data-on="true"] .fdc-seat-b'], 4.5],
  ...[['a', '--c-a'], ['b', '--c-b'], ['bot', null], ['you', '--c-parch']].map(([side]) => ['.fdc-who', [V, '.fdc-decks', '.fdc-seat-b'], 4.5, { seat: side }]),
  ['.fdc-opp b', [V, '.fdc-decks', '.fdc-opp button'], 4.5], ['.fdc-opp small', [V, '.fdc-decks', '.fdc-opp button'], 4.5],
  ['.fdc-opp button[aria-checked="true"] b', [V, '.fdc-decks', '.fdc-opp button[aria-checked="true"]'], 4.5],
  ['.fdc-opp button[aria-checked="true"] small', [V, '.fdc-decks', '.fdc-opp button[aria-checked="true"]'], 4.5],
  ['.fdc-kind button', [V, '.fdc-decks', '.fdc-kind button'], 4.5], ['.fdc-kind button[aria-checked="true"]', [V, '.fdc-decks', '.fdc-kind button[aria-checked="true"]'], 4.5],
  ['.fdc-name', [V, '.fdc-decks', '.fdc-tile'], 4.5], ['.fdc-desc', [V, '.fdc-decks', '.fdc-tile'], 4.5],
  ['.fdc-stat', [V, '.fdc-decks', '.fdc-tile'], 4.5], ['.fdc-stat small', [V, '.fdc-decks', '.fdc-tile'], 4.5],
  ['.fdc-r.a', [V, '.fdc-decks', '.fdc-tile'], 4.5], ['.fdc-r.b', [V, '.fdc-decks', '.fdc-tile'], 4.5],
  ['.fdc-desc', [V, '.fdc-decks', '.fdc-tile', '.fdc-tile[aria-pressed="true"] .fdc-tb'], 4.5], ['.fdc-stat small', [V, '.fdc-decks', '.fdc-tile', '.fdc-tile[aria-pressed="true"] .fdc-tb'], 4.5],
  ['.fdc-marks i', [V, '.fdc-marks i'], 4.5], ['.fdc-marks i.m0', [V, '.fdc-marks i.m0'], 4.5], ['.fdc-marks i.m1', [V, '.fdc-marks i.m1'], 4.5],
  ['.fdc[data-mode="play"] .fdc-marks i.m0', [V, '.fdc[data-mode="play"] .fdc-marks i.m0'], 4.5],
  ['.fdc-go', [V, '.fdc-go'], 4.5], ['.fdc-go', [VP, '.fdc-go'], 4.5, { phone: true }],
  ['.fdc-dhead h2', [VP, '.fdc-phone .fdc-decks'], 4.5, { phone: true }], ['.fdc-note', [VP, '.fdc-phone .fdc-decks'], 4.5, { phone: true }],
  ['.fdc-name', [VP, '.fdc-phone .fdc-decks', '.fdc-tile'], 4.5, { phone: true }],
];
const SEAT_VAR = { a: '--c-a', b: '--c-b', you: '--c-parch' };
for (const [sel, chain, need, o = {}] of PAIRS) {
  let fg;
  if (o.seat) {
    const sv = get(`.fdc-seat[data-side="${o.seat}"]`, '--seat');
    fg = rgba(sv);
    ok(!!fg, `pairs: seat ${o.seat} has a colour`);
  } else fg = rgba(get(sel, 'color') ?? (sel.endsWith(' b') || sel.endsWith(' small') ? null : null));
  if (!fg) {
    // a colour set by a parent rule: .fdc-fine b, .fdc-go-l under .fdc-go
    const parent = sel.replace(/ (b|small)$/, '');
    fg = rgba(get(parent, 'color'));
  }
  if (!fg) { ok(false, `pairs: ${sel} has no colour in the file`); continue; }
  const bg = ground(chain);
  const r = ratio(over(fg, bg), bg);
  ok(r >= need, `pairs: ${sel}${o.seat ? ` (${o.seat})` : ''} on ${chain[chain.length - 1]}: ${r.toFixed(2)}:1, need ${need}:1`);
}

// ------------------------------------------------------------ GLYPHS
// A selected colour glyph: each glyph colour (game/cards.js COLOURS ink)
// on the ground of a pressed filter needs 3:1.
{
  const C = await import('../game/cards.js');
  const bg = ground([V, '.fdc-decks', '.fdc-fpip[aria-pressed="true"]']);
  for (const [k, c] of Object.entries(C.COLOURS)) {
    const r = ratio(rgba(c.ink), bg);
    ok(r >= 3, `glyphs: ${k} glyph on a pressed filter: ${r.toFixed(2)}:1, need 3:1`);
  }
}

console.log(`chooser-contrast: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

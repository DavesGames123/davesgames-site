// ============================================================================
//  tools/saver-plate-check.mjs — the saver plate type sizes for each frame
// ----------------------------------------------------------------------------
//  Usage:
//    node tools/saver-plate-check.mjs          table and checks, exit 1 on a fail
//    node tools/saver-plate-check.mjs --quiet  checks only
//
//  The shell saver plate (#sn-saver-label in stella-nova/lib/screensaver.js)
//  sizes its type with CSS: clamp(), min(), max() and calc() on --fw, --fh
//  and --fs, plus media queries. A change to one formula changes every
//  frame shape, and no browser check is allowed (no headless Chrome). This
//  tool reads the CSS text from screensaver.js, applies the cascade for a
//  frame (viewport size, 9:16 column or fill, safe-area insets), and
//  computes the values that the browser computes.
//
//  It then estimates the height of the top and bottom text blocks for a
//  typical label (a two-line title, a two-line sub, two equations, three
//  parameters, two notes) and the clear band between them. The text
//  metrics are estimates (STIX glyphs about 0.5 em wide), so the band is a
//  model, not a measurement. The checks are:
//    - the clear band is 30% of the frame height or more
//    - the site mark box fits in the mark row
//    - lib/saver-clear.js bandFloor keeps 30% of the height clear
//    - no type is under its legible floor (title 18 px, mark 13 px,
//      equations 13 px, notes and values 10 px)
//
//  grep -n targets
//    CSS extract and cascade ... "function cascade"
//    value evaluator ........... "function evalCss"
//    height model .............. "function plateModel"
//    frames .................... "const FRAMES"
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../stella-nova/lib/screensaver.js', import.meta.url));
const js = readFileSync(SRC, 'utf8');
const m = js.match(/css\.textContent = `([\s\S]*?)`;/);
if (!m) { console.error('no CSS block in screensaver.js'); process.exit(2); }
const CSS = m[1].replace(/\/\*[\s\S]*?\*\//g, '');

// ── parse: a flat list of { sel, decls, media } in source order ────────────
function parse(text) {
  const out = [];
  let i = 0;
  const block = (media) => {
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length || text[i] === '}') { i++; return; }
      const open = text.indexOf('{', i);
      const head = text.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith('@media') || head.startsWith('@supports')) { block(media.concat([head])); continue; }
      const close = text.indexOf('}', i);
      const body = text.slice(i, close); i = close + 1;
      const decls = {};
      splitTop(body, ';').forEach(d => {
        const k = d.indexOf(':'); if (k < 0) return;
        decls[d.slice(0, k).trim()] = d.slice(k + 1).trim().replace(/\s*!important$/, '');
      });
      head.split(',').map(s => s.trim()).forEach(sel => out.push({ sel, decls, media }));
    }
  };
  block([]);
  return out;
}
// Split on a separator at bracket depth 0.
function splitTop(s, sep) {
  const out = []; let d = 0, start = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '(') d++; else if (c === ')') d--;
    else if (d === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) { out.push(s.slice(start, k)); start = k + 1; }
  }
  out.push(s.slice(start));
  return out.map(x => x.trim()).filter(Boolean);
}
const RULES = parse(CSS);

// ── media and selectors ────────────────────────────────────────────────────
function mediaOk(q, F) {
  if (q.startsWith('@supports')) return F.dvh !== false;   // every phone browser in use has dvh
  return q.replace(/^@media\s*/, '').split(',').some(alt => alt.split(/\band\b/).every(c => {
    const t = c.trim().replace(/^\(|\)$/g, '');
    let r;
    if ((r = t.match(/^max-width:\s*([\d.]+)px$/))) return F.w <= +r[1];
    if ((r = t.match(/^min-width:\s*([\d.]+)px$/))) return F.w >= +r[1];
    if ((r = t.match(/^max-height:\s*([\d.]+)px$/))) return F.h <= +r[1];
    if ((r = t.match(/^min-height:\s*([\d.]+)px$/))) return F.h >= +r[1];
    if ((r = t.match(/^min-aspect-ratio:\s*(\d+)\s*\/\s*(\d+)$/))) return F.w * +r[2] >= F.h * +r[1];
    if ((r = t.match(/^max-aspect-ratio:\s*(\d+)\s*\/\s*(\d+)$/))) return F.w * +r[2] <= F.h * +r[1];
    if (/^(pointer|hover)/.test(t)) return !!F.touch === /coarse|none/.test(t);
    throw new Error('media query not modelled: ' + t);
  }));
}
// The body state classes that the plate rules test, and the label element.
function bodyOk(sel, F) {
  const need = { 'sn-saver-vert': !!F.vert, 'sn-saver-pane': false, 'sn-saver-on': true, 'sn-saver-nocursor': false };
  for (const [cls, on] of Object.entries(need)) {
    if (new RegExp(`body[^ ]*:not\\(\\.${cls}\\)`).test(sel) && on) return false;
    if (new RegExp(`body[^ ]*\\.${cls}(?![-\\w])`).test(sel.replace(/:not\([^)]*\)/g, '')) && !on) return false;
  }
  return true;
}
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+|:(?!not|has)[\w-]+/g) || []).length;
  const tags = (sel.replace(/:not\([^)]*\)|:has\([^)]*\)/g, '').match(/(^|[\s>+~])[a-z]+/g) || []).length;
  return ids * 1e4 + cls * 1e2 + tags;
}
// target is '#sn-saver-label' or '#sn-saver-label .x'. The plate is on (.on).
function matches(sel, target, F) {
  if (/:has\(/.test(sel) && !F.code) return false;
  const s = sel.replace(/#sn-saver-label\.on/g, '#sn-saver-label');
  const tail = target === '#sn-saver-label' ? /#sn-saver-label$/ : new RegExp(`#sn-saver-label(?::has\\([^)]*\\))?(?: \\.slot-bot)? ${target.split(' ')[1].replace('.', '\\.')}$`);
  if (!tail.test(s)) return false;
  return bodyOk(s, F);
}
function cascade(target, F) {
  const props = {}, spec = {};
  RULES.forEach((r, order) => {
    if (!r.media.every(q => mediaOk(q, F)) || !matches(r.sel, target, F)) return;
    const sp = specificity(r.sel) * 1e4 + order;
    for (const [k, v] of Object.entries(r.decls)) {
      if (!(k in spec) || sp >= spec[k]) { props[k] = v; spec[k] = sp; }
    }
  });
  // font shorthand: style weight size/line family
  if (props.font && !props['font-size']) {
    const f = props.font.match(/(\d+(?:\.\d+)?px|clamp\([^;]*?\)\)?|clamp\([^)]*\))(?:\/[\d.]+)?\s+['A-Z]/);
    if (f) props['font-size'] = f[1];
  }
  return props;
}

// ── evaluate a CSS length in px ────────────────────────────────────────────
function evalCss(expr, F, vars, em = 16) {
  let s = expr;
  for (let guard = 0; /var\(/.test(s) && guard < 20; guard++) {
    s = s.replace(/var\((--[\w-]+)\)/g, (_, n) => { if (!(n in vars)) throw new Error('no ' + n); return `(${vars[n]})`; });
  }
  s = s.replace(/env\(safe-area-inset-(top|right|bottom|left),\s*0px\)/g, (_, k) => String((F.inset || {})[k] || 0));
  const vh = F.h / 100, vw = F.w / 100;
  s = s.replace(/([\d.]+)dvh/g, (_, n) => String(n * vh)).replace(/([\d.]+)vh/g, (_, n) => String(n * vh))
    .replace(/([\d.]+)vw/g, (_, n) => String(n * vw)).replace(/([\d.]+)em/g, (_, n) => String(n * em))
    .replace(/([\d.]+)px/g, '$1').replace(/([\d.]+)%/g, (_, n) => `(${n}/100*__PCT)`);
  s = s.replace(/clamp\(/g, '__clamp(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(').replace(/calc\(/g, '(');
  if (/[a-zA-Z]/.test(s.replace(/Math\.(min|max)|__clamp|__PCT/g, ''))) throw new Error('cannot evaluate: ' + expr + ' -> ' + s);
  return new Function('__clamp', '__PCT', `return ${s};`)((a, b, c) => Math.max(a, Math.min(b, c)), F.pct || 0);
}

// ── one frame ──────────────────────────────────────────────────────────────
const PARTS = ['.cat', '.ttl', '.rule', '.sub', '.pp', '.eqs', '.notes', '.mark', '.logo', '.code'];
export function plateSizes(F) {
  const L = cascade('#sn-saver-label', F);
  const vars = {};
  for (const [k, v] of Object.entries(L)) if (k.startsWith('--')) vars[k] = v;
  const fw = evalCss('var(--fw)', F, vars), fh = evalCss('var(--fh)', F, vars), fs = evalCss('var(--fs)', F, vars);
  const pad = splitTop(L.padding, ' ').map(p => evalCss(p, F, vars));
  if (L['padding-top']) pad[0] = evalCss(L['padding-top'], F, vars);
  const out = { fw, fh, fs, pad: { t: pad[0], r: pad[1], b: pad[2], l: pad[3] } };
  for (const part of PARTS) {
    const P = cascade('#sn-saver-label ' + part, F);
    const o = { shown: P.display !== 'none' };
    if (P['font-size']) o.px = evalCss(P['font-size'], F, vars);
    if (P['letter-spacing']) o.ls = parseFloat(P['letter-spacing']);
    if (P.width) o.width = P.width;
    out[part.slice(1)] = o;
  }
  return out;
}

// ── height model for a typical label ───────────────────────────────────────
// Margins mirror the CSS (em of each part): cat 1.1, rule .95+.85, mark 1.3,
// eqs 1, pp 1, notes .9. Line heights: title 1.04, sub 1.3, notes 1.4.
const LABEL = { title: 'Particle Collider Events', sub: 'Proton beams cross in a detector; tracks curve in the solenoid field and show charge', eqs: 2, params: 3, notes: ['Each track bends with radius p / (qB): slow tracks curl.', 'Calorimeter towers sum the deposited energy.'] };
const lines = (chars, px, width, k = 0.5) => Math.max(1, Math.ceil(chars * px * k / Math.max(1, width)));
export function plateModel(F) {
  const S = plateSizes(F);
  const cw = S.fw - S.pad.l - S.pad.r;
  let top = S.pad.t;
  if (S.cat.shown) top += S.cat.px * 2.1;
  const tw = Math.min(cw, S.ttl.px * 0.5 * 30);
  top += lines(LABEL.title.length, S.ttl.px, tw) * S.ttl.px * 1.04;
  top += S.rule.px * 1.8;
  if (S.sub.shown) top += lines(LABEL.sub.length, S.sub.px, Math.min(cw, S.sub.px * 30)) * S.sub.px * 1.3;
  // logo: 17 letters of ~0.47 em, letter-spacing, two brackets with
  // .35 em pads, the box pads (.55 + .8 em) and a 2 px border each side.
  const logoW = S.mark.px * (17 * (0.47 + S.logo.ls) + 2 * (0.33 + 0.7) + 1.35) + 4;
  const markW = cw * (parseFloat(S.mark.width) / 100 || 0.9);
  top += S.mark.px * 1.3 + S.mark.px * 2.1 + 4;
  const wide = F.w >= F.h && !F.vert;
  let bot = S.pad.b;
  const eqH = S.eqs.px * 2.2;
  bot += S.eqs.px + (wide ? eqH : 2 * eqH + S.eqs.px * 0.6);
  const ppRows = lines(LABEL.params * 9, S.pp.px, cw, 1);
  bot += S.pp.px + ppRows * S.pp.px * 2.3;
  if (S.notes.shown) bot += S.notes.px * 0.9 + LABEL.notes.reduce((a, t) => a + lines(t.length, S.notes.px, Math.min(cw, S.notes.px * (wide ? 46 : 32))), 0) * S.notes.px * 1.4;
  const H = F.vert ? F.h : F.h;
  return { S, top, bot, band: H - top - bot, frac: (H - top - bot) / H, logoW, markW };
}

// ── frames ─────────────────────────────────────────────────────────────────
// Phones have no safe-area insets in the shell: its viewport meta has no
// viewport-fit=cover, so Safari keeps the page out of the notch itself.
export const FRAMES = [
  { name: '360x640 phone', w: 360, h: 640, touch: true, phone: true },
  { name: '390x844 iPhone', w: 390, h: 844, touch: true, phone: true },
  { name: '844x390 iPhone land', w: 844, h: 390, touch: true, phone: true },
  { name: '640x360 phone land', w: 640, h: 360, touch: true, phone: true },
  { name: '390x844 9:16 col', w: 390, h: 844, vert: true, touch: true, phone: true },
  { name: '820x1180 iPad', w: 820, h: 1180, touch: true },
  { name: '1180x820 iPad land', w: 1180, h: 820, touch: true },
  { name: '1920x1080 9:16 col', w: 1920, h: 1080, vert: true },
  { name: '1920x1080 fill', w: 1920, h: 1080 },
  { name: '1280x800 fill', w: 1280, h: 800 },
];

async function main() {
  const quiet = process.argv.includes('--quiet');
  const fails = [];
  const r1 = v => (Math.round(v * 10) / 10).toString();
  if (!quiet) console.log('frame                 fs     title mark  sub   eqs   pp    notes cat   pad t/b    top  bot  band (frac)  logo/mark');
  for (const F of FRAMES) {
    const M = plateModel(F), S = M.S;
    const shown = p => (S[p].shown ? r1(S[p].px) : '-');
    if (!quiet) console.log(`${F.name.padEnd(21)} ${r1(S.fs).padEnd(6)} ${r1(S.ttl.px).padEnd(5)} ${r1(S.mark.px).padEnd(5)} ${shown('sub').padEnd(5)} ${r1(S.eqs.px).padEnd(5)} ${r1(S.pp.px).padEnd(5)} ${shown('notes').padEnd(5)} ${shown('cat').padEnd(5)} ${(r1(S.pad.t) + '/' + r1(S.pad.b)).padEnd(10)} ${String(Math.round(M.top)).padEnd(4)} ${String(Math.round(M.bot)).padEnd(4)} ${String(Math.round(M.band)).padEnd(4)} (${(M.frac * 100).toFixed(0)}%)    ${Math.round(M.logoW)}/${Math.round(M.markW)}`);
    if (M.frac < 0.3) fails.push(`${F.name}: clear band ${(M.frac * 100).toFixed(0)}% of the height (need 30%)`);
    if (M.logoW > M.markW + 0.5) fails.push(`${F.name}: site mark ${Math.round(M.logoW)} px is wider than its row ${Math.round(M.markW)} px`);
    const floor = { ttl: 18, mark: 13, eqs: 13, pp: 10 };
    if (S.notes.shown) floor.notes = 10;
    for (const [p, v] of Object.entries(floor)) if (S[p].px < v - 1e-6) fails.push(`${F.name}: ${p} ${r1(S[p].px)} px is under ${v} px`);
  }
  // plateBand floor (lib/saver-clear.js): the band is never under 30% of h,
  // and a band that is already wide does not move.
  const { bandFloor } = await import('../stella-nova/lib/saver-clear.js');
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const f1 = bandFloor(200, 180, 390), f2 = bandFloor(204, 207, 844), f3 = bandFloor(0, 0, 0);
  if (!near(390 - f1.t - f1.b, 117) || !near(f1.t / f1.b, 200 / 180)) fails.push(`bandFloor(200, 180, 390) -> ${JSON.stringify(f1)}, expected a 117 px band in the 200:180 ratio`);
  if (f2.t !== 204 || f2.b !== 207) fails.push(`bandFloor(204, 207, 844) moved a wide band: ${JSON.stringify(f2)}`);
  if (f3.t !== 0 || f3.b !== 0) fails.push(`bandFloor(0, 0, 0) -> ${JSON.stringify(f3)}`);
  if (!quiet) console.log(`\nbandFloor 844x390 with 200/180 px of text -> t ${f1.t.toFixed(1)} b ${f1.b.toFixed(1)} band ${(390 - f1.t - f1.b).toFixed(1)}`);
  // The desktop sizes of f5d64c7 must not move.
  const D = plateSizes({ w: 1920, h: 1080 });
  if (Math.abs(D.ttl.px - 53.136) > 0.01 || Math.abs(D.mark.px - 33.696) > 0.01) fails.push(`1920x1080: title ${r1(D.ttl.px)} mark ${r1(D.mark.px)}, expected 53.1 and 33.7 (f5d64c7)`);
  const V = plateSizes({ w: 1920, h: 1080, vert: true });
  if (Math.abs(V.fs - 607.5) > 0.01) fails.push(`1920x1080 9:16 column: fs ${r1(V.fs)}, expected 607.5`);
  if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log(`\nOK: ${FRAMES.length} frames, clear band 30% or more, site mark fits, type over its floor, desktop sizes unchanged`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();

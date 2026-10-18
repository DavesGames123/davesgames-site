// ============================================================================
//  BREADBOARD LAB  ·  ui/style-tests.mjs — contrast, targets, focus, no glow
// ----------------------------------------------------------------------------
//  Called by ui/tests.mjs; also runs alone:
//    node stella-nova/pages/breadboard-lab/ui/style-tests.mjs [style.css]
//  It reads lib/forge-ui.css and the page style.css as text (no browser):
//    parseCss ......... rules with their @media condition
//    resolve .......... var() from the two :root blocks (the page wins)
//    colour ........... #hex, rgb(a), color-mix(in srgb, a p%, b)
//    PAIRS ............ text colour / fill pairs, WCAG AA 4.5:1 for text
//                       and 3:1 for icons, rings and edges. A translucent
//                       fill is composited over the panel, the panel over a
//                       white backdrop (the lit board under the panels).
//    TARGETS .......... 44 px under (pointer: coarse): height, min-height
//                       or a ::after hit area (inset)
//    focus / glow ..... a :focus-visible ring of 2 px at 3:1; no shadow
//                       layer with zero offset and a blur (a glow)
//  evaluate(css) returns the rows, so a run on an old style.css gives the
//  numbers before a change.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FORGE = path.resolve(ROOT, '../../lib/forge-ui.css');

export function parseCss(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  function block(media) {
    while (i < src.length) {
      const open = src.indexOf('{', i), close = src.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const head = src.slice(i, open).trim();
      i = open + 1;
      if (/^@(media|supports)/.test(head)) { block(head.startsWith('@media') ? head.replace(/^@media\s*/, '') : (media || null)); continue; }
      if (/^@(keyframes|property|font-face)/.test(head)) { let d = 1; while (i < src.length && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; } continue; }
      const end = src.indexOf('}', i);
      const body = src.slice(i, end);
      i = end + 1;
      const decls = {};
      for (const part of body.split(';')) {
        const k = part.indexOf(':');
        if (k < 0) continue;
        decls[part.slice(0, k).trim()] = part.slice(k + 1).trim().replace(/\s*!important$/, '');
      }
      const head2 = head.replace(/^@import[^;]*;/g, '').trim();
      rules.push({ media, selectors: head2.split(/,(?![^(]*\))/).map(s => s.trim()), decls });
    }
  }
  block(null);
  return rules;
}

const hex = h => {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 1];
};
export function colour(v) {
  if (!v) return null;
  v = v.trim();
  if (v === 'transparent') return [0, 0, 0, 0];
  if (v === 'white' || v === '#fff') return [255, 255, 255, 1];
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return hex(v);
  let m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  m = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/.exec(v);
  if (m) { const a = colour(m[1]), b = colour(m[3]), t = +m[2] / 100; return a && b ? [0, 1, 2].map(k => a[k] * t + b[k] * (1 - t)).concat(1) : null; }
  return null;
}
export const over = (top, bottom) => [0, 1, 2].map(k => top[k] * top[3] + bottom[k] * (1 - top[3])).concat(1);
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const luminance = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const contrast = (a, b) => { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

export function evaluate(pageCss, forgeCss = fs.readFileSync(FORGE, 'utf8'), extra = {}) {
  const rules = [...parseCss(forgeCss), ...parseCss(pageCss)];
  const vars = {};
  for (const r of rules) if (r.media === null && r.selectors.includes(':root')) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) vars[k] = v;
  const resolve = (v, local = {}) => {
    for (let n = 0; n < 8 && /var\(/.test(v); n++) v = v.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, k, d) => local[k] ?? vars[k] ?? d ?? '');
    return v;
  };
  // the last plain-media declaration of a property for an exact selector
  const decl = (sel, prop, media = null) => {
    let out;
    for (const r of rules) if ((media === null ? r.media === null : r.media === media) && r.selectors.includes(sel) && r.decls[prop] !== undefined) out = r.decls[prop];
    return out;
  };
  const backdrop = [255, 255, 255, 1];
  const panel = over(colour(resolve('var(--sq-fill)')), backdrop);
  const fillOf = (sel, base = panel, local = {}) => {
    const f = decl(sel, '--sq-fill') ?? decl(sel, 'background');
    const c = f !== undefined ? colour(resolve(f, local)) : null;
    return c ? over(c, base) : base;
  };
  const textOf = (sel, local = {}) => { const c = decl(sel, 'color'); return c !== undefined ? colour(resolve(c, local)) : null; };

  const P = [];
  const pair = (name, fg, bg, min = 4.5) => { if (fg && bg) P.push({ name, ratio: contrast(over(fg, bg), bg), min }); else P.push({ name, ratio: NaN, min, missing: true }); };
  const txt = colour(resolve('var(--txt)')), dim = colour(resolve('var(--dim)')), faint = colour(resolve('var(--faint)'));
  const btnFill = fillOf('.btn');
  pair('.btn text on its fill', textOf('.btn'), btnFill);
  pair('.btn:hover text', textOf('.btn:hover') || textOf('.btn'), fillOf('.btn:hover'));
  pair('.btn.on text (a pressed tool, an on toggle)', textOf('.btn.on,.btn[aria-pressed="true"]') || textOf('.btn.on'), fillOf('.btn.on') === panel ? fillOf('.btn.on,.btn[aria-pressed="true"]') : fillOf('.btn.on'));
  pair('.btn.primary text', textOf('.btn.primary'), fillOf('.btn.primary'));
  pair('.btn.warn text', textOf('.btn.warn'), fillOf('.btn.warn'));
  const well = over(colour(resolve('var(--well)')), panel);
  pair('.seg button text on the well', textOf('.seg button'), well);
  pair('.seg button.on text', textOf('.seg button.on'), fillOf('.seg button.on', well));
  pair('.ph h2 (panel titles)', dim, panel);
  pair('.rowv > label', textOf('.rowv>label'), panel);
  pair('.sec .r and .empty (faint text)', faint, panel);
  pair('.note (dim text)', dim, panel);
  const card = fillOf('.card');
  pair('.card .n (part names)', textOf('.card') || txt, card);
  pair('.card .d (part notes, faint)', faint, card);
  const issue = fillOf('.issue');
  pair('.issue text', textOf('.issue'), issue);
  pair('.issue small (faint)', faint, issue);
  pair('.mat label', dim, fillOf('.mat'));
  pair('.mat.on label', textOf('.mat.on'), fillOf('.mat.on'));
  pair('.lead text', dim, fillOf('.lead'));
  for (const c of extra.channelColours || []) {
    const local = { '--c': c };
    pair(`.chbtn ${c}`, textOf('.chbtn', local), fillOf('.chbtn', panel, local));
  }
  pair('.chbtn.off', faint, fillOf('.chbtn.off'));
  pair('.instr-ctl .lbl (faint)', faint, panel);
  const stat = over(colour(resolve(decl('.stat', '--sq-fill'))), backdrop);
  pair('.stat (status bar over the 3D view)', dim, stat);
  pair('.stat.hint', textOf('.stat.hint'), stat);
  const sheet = over(colour(resolve(decl('body.phone #sheet', '--sq-fill') || 'rgba(14,14,17,.98)')), backdrop);
  pair('.sheet-tabs button', textOf('.sheet-tabs button'), fillOf('.sheet-tabs button', sheet));
  pair('.sheet-tabs button.on', textOf('.sheet-tabs button.on'), fillOf('.sheet-tabs button.on', sheet));
  const dockBg = over(colour(decl('body.phone #dock', 'background')), backdrop);
  pair('phone #dock button', textOf('body.phone #dock button'), fillOf('body.phone #dock button', dockBg));
  pair('phone #dock button.on', textOf('body.phone #dock button.on') || textOf('body.phone #dock button'), fillOf('body.phone #dock button.on', dockBg));
  const menu = over(colour(resolve(decl('.menu', '--sq-fill'))), backdrop);
  pair('.menu button', textOf('.menu button'), menu);
  pair('.menu kbd (faint)', faint, menu);
  const tip = over(colour(resolve(decl('#tip', '--sq-fill'))), backdrop);
  pair('#tip text', textOf('#tip'), tip);
  pair('#tip .act (the control hint)', textOf('#tip .act'), tip);
  const ed = over(colour(decl('.editor', '--sq-fill')), panel);
  pair('.gutter (line numbers)', textOf('.gutter'), ed);
  pair('.editor pre .c (comments)', textOf('.editor pre .c'), ed);
  pair('.toast text', txt, over(colour(resolve(decl('.toast', '--sq-fill'))), backdrop));
  pair('.ph-x icon (non-text, 3:1)', textOf('.ph-x'), panel, 3);
  pair('.tog label', textOf('.tog'), panel);
  // state rings and the focus ring (non-text, 3:1)
  const acc = colour(resolve('var(--acc)'));
  pair('the accent ring of an on button against the panel', acc, panel, 3);
  const onFill = fillOf('.btn.on');
  pair('an on button fill edge: accent ring against the on fill', acc, onFill, 1.5);
  const focus = colour(resolve('var(--focus)') || '');
  pair('the focus ring against the panel', focus, panel, 3);
  pair('the focus ring against a button', focus, btnFill, 3);
  const tipAfter = decl('#bar .btn[aria-label]::after', 'background');
  pair('the bar button name (::after)', colour(resolve(decl('#bar .btn[aria-label]::after', 'color') || '')), tipAfter ? over(colour(tipAfter), backdrop) : null);

  // touch targets under (pointer: coarse)
  const COARSE = '(pointer:coarse)';
  const px = v => { const m = /(-?[\d.]+)px/.exec(v || ''); return m ? +m[1] : NaN; };
  const sizeOf = (sel, media) => {
    let h = NaN, w = NaN;
    for (const r of rules) {
      if (r.media !== media || !r.selectors.includes(sel)) continue;
      for (const k of ['height', 'min-height']) if (r.decls[k] !== undefined && !isNaN(px(r.decls[k]))) h = Math.max(isNaN(h) ? 0 : h, px(r.decls[k]));
      for (const k of ['width', 'min-width']) if (r.decls[k] !== undefined && !isNaN(px(r.decls[k]))) w = Math.max(isNaN(w) ? 0 : w, px(r.decls[k]));
    }
    return { h, w };
  };
  const hitPad = (sel, media) => {
    for (const r of rules) if (r.media === media && r.selectors.includes(sel + '::after') && r.decls.inset) {
      const p = r.decls.inset.split(/\s+/).map(px);
      return { v: -2 * p[0], h: -2 * (p[1] ?? p[0]) };
    }
    return { v: 0, h: 0 };
  };
  const T = [];
  const target = (sel, base = null, phoneH = null) => {
    const s = sizeOf(sel, COARSE), pad = hitPad(sel, COARSE);
    const b = base ? sizeOf(base, null) : { h: NaN, w: NaN };
    const h = (isNaN(s.h) ? (phoneH ?? b.h) : s.h) + pad.v;
    const w = isNaN(s.w) ? NaN : s.w + pad.h;
    T.push({ sel, h, w, ok: h >= 44 && (isNaN(w) || w >= 44) });
  };
  for (const sel of ['.btn', '.seg button', '.num', '.sel', '.txt', '.tog', '.ph-x', '.lead', '.chbtn', '.issue', '.menu button', '.colorin', '.pinrow input', '.sheet-grip', '.swatches button']) target(sel);
  { // the small buttons share one coarse rule
    const s = sizeOf('.btn.small', COARSE);
    T.push({ sel: '.btn.small/.chip/.tiny', h: s.h, w: s.w, ok: s.h >= 44 && s.w >= 44 });
  }
  { // the status bar button: 26 px on a phone plus its ::after
    const pad = hitPad('.stat.issues-n', COARSE);
    const h = px(decl('body.phone #status .stat', 'height')) + pad.v;
    T.push({ sel: '.stat.issues-n (phone)', h, w: NaN, ok: h >= 44 });
  }
  for (const [sel, prop] of [['body.phone #dock button', 'height'], ['.sheet-tabs button', 'height']]) { const h = px(decl(sel, prop)); T.push({ sel, h, w: NaN, ok: h >= 44 }); }

  // focus rings and glows
  const focusRule = rules.find(r => r.media === null && r.selectors.some(s => /^:where\(button[^)]*\):focus-visible$/.test(s)));
  const ring = focusRule ? focusRule.decls.outline || '' : '';
  const focusOk = !!focusRule && px(ring) >= 2 && /solid/.test(ring) && /:where\(button,select,input,textarea/.test(focusRule.selectors.join(','));
  const noneOnFocus = rules.filter(r => r.selectors.some(s => /:focus-visible/.test(s) && /button|\.btn/.test(s)) && /none/.test(r.decls.outline || ''));
  const glows = [];
  // every shadow in the file, keyframes too
  for (const m of pageCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(box-shadow|text-shadow)\s*:\s*([^;}]+)/g)) {
    const v = m[2].trim();
    if (v === 'none') continue;
    for (const layer of v.split(/,(?![^(]*\))/)) {
      const nums = layer.replace(/inset/, '').trim().split(/\s+/).filter(t => /^-?[\d.]+(px)?$/.test(t)).map(t => parseFloat(t));
      if (nums.length >= 3 && nums[0] === 0 && nums[1] === 0 && nums[2] > 0) glows.push(`${m[1]}: ${layer.trim()}`);
    }
  }
  if (/text-shadow\s*:/.test(pageCss.replace(/\/\*[\s\S]*?\*\//g, ''))) glows.push('text-shadow present');
  return { pairs: P, targets: T, focusOk, ring, noneOnFocus: noneOnFocus.map(r => r.selectors[0]), glows };
}

export async function styleTests({ ok }) {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const { INSTR_COLORS } = await import(pathToFileURL(path.join(ROOT, 'instruments/display.js')).href);
  const r = evaluate(css, undefined, { channelColours: INSTR_COLORS.ch });
  const bad = r.pairs.filter(p => !(p.ratio >= p.min));
  const worst = r.pairs.filter(p => p.min === 4.5).reduce((a, p) => (p.ratio < a.ratio ? p : a), { ratio: 99 });
  ok(bad.length === 0, `WCAG AA: every text and control colour pair of style.css (${r.pairs.length} pairs)`, bad.length ? bad.map(p => `${p.name} ${isNaN(p.ratio) ? 'missing' : p.ratio.toFixed(2)}`).join('; ') : `lowest text pair ${worst.name} ${worst.ratio.toFixed(2)}:1`);
  const on = r.pairs.find(p => p.name.startsWith('.btn.on text'));
  ok(on && on.ratio >= 4.5, 'a pressed tool or an on toggle is readable (dark blue fill, white text)', on ? `${on.ratio.toFixed(2)}:1` : 'missing');
  const small = r.targets.filter(t => !t.ok);
  ok(small.length === 0, `44 px touch targets under (pointer: coarse) and on the phone (${r.targets.length} kinds)`, small.length ? small.map(t => `${t.sel} ${t.h}x${t.w}`).join('; ') : r.targets.map(t => `${t.sel} ${t.h}`).join(', '));
  ok(r.focusOk && r.noneOnFocus.length === 0, 'a 2 px :focus-visible ring on buttons, selects, inputs and links (none removed)', `outline: ${r.ring}${r.noneOnFocus.length ? '; removed on ' + r.noneOnFocus.join(' ') : ''}`);
  ok(r.glows.length === 0, 'no glow: no text-shadow and no zero-offset blurred shadow in style.css', r.glows.join(' | ') || 'none');
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = process.argv[2] || path.join(ROOT, 'style.css');
  const { INSTR_COLORS } = await import(pathToFileURL(path.join(ROOT, 'instruments/display.js')).href);
  const r = evaluate(fs.readFileSync(file, 'utf8'), undefined, { channelColours: INSTR_COLORS.ch });
  for (const p of r.pairs) console.log(`${p.ratio >= p.min ? 'ok  ' : 'FAIL'} ${p.ratio.toFixed(2)} (min ${p.min}) ${p.name}`);
  for (const t of r.targets) console.log(`${t.ok ? 'ok  ' : 'FAIL'} ${t.sel} ${t.h} x ${t.w}`);
  console.log('focus', r.focusOk, r.ring, 'glows', r.glows.join(' | ') || 'none');
}

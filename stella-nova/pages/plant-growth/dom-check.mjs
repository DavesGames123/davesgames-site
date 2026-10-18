// ============================================================================
//  PLANT GROWTH  ·  DOM and CSS checks at phone viewports (jsdom)
// ----------------------------------------------------------------------------
//  Run: NODE_PATH=<dir with jsdom>/node_modules node dom-check.mjs
//  (npm i jsdom@24.1.3 in a scratch folder). Exit 1 on a failure. With no
//  jsdom it prints "skipped" and exits 0. No browser runs.
//
//  jsdom has no layout and no media queries. This file reads index.html,
//  style.css and lib/growth-gradients.css, picks the rules whose media
//  query matches each viewport (function mediaOk), runs a small cascade
//  (specificity, order, !important, inheritance of font-size) and does
//  the CSS maths of px, vw, vh, %, env(), calc(), min() and max(). Then it
//  checks, at 360x740, 390x844, 430x932, 768x1024 and 844x390 (coarse
//  pointer) and 1440x900 (fine pointer):
//    - every id that main.js binds is in the page; the dock has its five
//      controls; the sheet has species, stand, speed, leaves, roots, wind,
//      colour by and the gradient picker;
//    - the [hidden] rule is first and wins over the page rules;
//    - no fixed overlay (dock, sheet, drawer, explainer, legend, status,
//      hint, topbar) is wider than the viewport or off its sides;
//    - the dock content fits the dock at its minimum widths;
//    - touch targets are 44 px or more and text is 11 px or more;
//    - the panel and the explainer cannot scroll sideways; the explainer
//      is a full-height sheet on a phone.
// ============================================================================
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('dom-check: skipped (no jsdom on NODE_PATH)'); process.exit(0); }

const here = p => new URL(p, import.meta.url);
const html = fs.readFileSync(here('./index.html'), 'utf8');
const pageCss = fs.readFileSync(here('./style.css'), 'utf8');
const libCss = fs.readFileSync(here('../../lib/growth-gradients.css'), 'utf8');
const mainSrc = fs.readFileSync(here('./main.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

// ------------------------------------------------------------ media queries
function featureOk(f, vp) {
  const m = f.trim().match(/^\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)$/);
  if (!m) return false;
  const [, k, v0] = m, v = (v0 || '').trim(), px = parseFloat(v);
  switch (k) {
    case 'max-width': return vp.w <= px;
    case 'min-width': return vp.w >= px;
    case 'max-height': return vp.h <= px;
    case 'min-height': return vp.h >= px;
    case 'orientation': return v === (vp.w > vp.h ? 'landscape' : 'portrait');
    case 'pointer': return v === (vp.coarse ? 'coarse' : 'fine');
    case 'hover': return v === (vp.coarse ? 'none' : 'hover');
    case 'prefers-color-scheme': return v === 'dark';
    case 'prefers-reduced-motion': return v === 'no-preference';
    default: return false;
  }
}
function mediaOk(text, vp) {
  return text.split(',').some(part => part.trim().split(/\s+and\s+/).every(f => featureOk(f, vp)));
}

// ------------------------------------------------------------ the cascade
function specificity(sel) {
  const s = sel.replace(/::?[a-z-]+\([^)]*\)/g, m => m.startsWith('::') ? '' : ':x').replace(/::[a-z-]+/g, '');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
  const c = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return a * 1e6 + b * 1e3 + c;
}
function collect(sheets, vp) {
  const out = [];
  let order = 0;
  const walk = rules => {
    for (const r of rules) {
      if (r.media && r.cssRules) { if (mediaOk(r.media.mediaText, vp)) walk(r.cssRules); continue; }
      if (!r.selectorText || !r.style) continue;
      for (const sel of r.selectorText.split(',').map(x => x.trim())) {
        if (/::/.test(sel)) continue;
        out.push({ sel, spec: specificity(sel), order: order++, style: r.style });
      }
    }
  };
  for (const s of sheets) walk(s.cssRules);
  return out;
}
function declared(el, rules, prop) {
  let best = null;
  for (const r of rules) {
    const v = r.style.getPropertyValue(prop);
    if (!v) continue;
    let m = false; try { m = el.matches(r.sel); } catch (e) { m = false; }
    if (!m) continue;
    const imp = r.style.getPropertyPriority(prop) === 'important' ? 1 : 0;
    const key = imp * 1e12 + r.spec * 1e3 + r.order / 1e6;
    if (!best || key >= best.key) best = { key, v: v.trim() };
  }
  return best ? best.v : null;
}
// CSS maths in px. base: the size % refers to. Returns NaN for auto and so on.
function px(v, vp, base, fontPx = 16) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (/^(auto|none|normal|max-content|min-content|fit-content)$/.test(s)) return NaN;
  s = s.replace(/env\([^)]*\)/g, '0px').replace(/var\(--dock-h\)/g, '64px').replace(/var\(--panel-w\)/g, '320px');
  if (/var\(/.test(s)) return NaN;
  s = s.replace(/(-?[\d.]+)(px|dvh|svh|vh|dvw|vw|%|rem|em)?/g, (m, n, u) => {
    const x = parseFloat(n);
    switch (u) {
      case 'px': case undefined: return String(x);
      case 'vw': case 'dvw': return String(x * vp.w / 100);
      case 'vh': case 'dvh': case 'svh': return String(x * vp.h / 100);
      case '%': return String(x * base / 100);
      case 'rem': return String(x * 16);
      case 'em': return String(x * fontPx);
    }
    return m;
  }).replace(/\bcalc\(/g, '(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(');
  if (!/^[\d\s.+\-*/(),Mathminx]*$/.test(s)) return NaN;
  try { return Function('return (' + s + ')')(); } catch (e) { return NaN; }
}
// split a value at top-level spaces: "8px calc(10px + env(x))" -> 2 parts
function tokens(v) {
  const out = []; let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function fontSize(el, rules, vp) {
  const chain = [];
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) chain.unshift(e);
  let f = 16;
  for (const e of chain) {
    let v = declared(e, rules, 'font-size');
    if (!v) {
      const sh = declared(e, rules, 'font');
      if (sh) { const m = sh.match(/(-?[\d.]+(?:px|rem|em|%))/); if (m) v = m[1]; }
    }
    if (v) { const n = px(v, vp, f, f); if (Number.isFinite(n)) f = n; }
  }
  return f;
}

// ------------------------------------------------------------ the page
const VPS = [
  { w: 360, h: 740, coarse: true, kind: 'sheet' },
  { w: 390, h: 844, coarse: true, kind: 'sheet' },
  { w: 430, h: 932, coarse: true, kind: 'sheet' },
  { w: 768, h: 1024, coarse: true, kind: 'sheet' },
  { w: 844, h: 390, coarse: true, kind: 'drawer' },
  { w: 1440, h: 900, coarse: false, kind: 'desktop' },
];

const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { pretendToBeVisual: false });
const doc = dom.window.document;
const sheetOf = css => { const st = doc.createElement('style'); st.textContent = css; doc.head.appendChild(st); return st.sheet; };
const sheets = [sheetOf(pageCss), sheetOf(libCss)];
// the buttons that main.js and the gradient picker build at run time
for (const [id, n, cls] of [['speciesBtns', 8, ''], ['colourBtns', 7, '']]) {
  const box = doc.getElementById(id);
  for (let i = 0; i < n; i++) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = ['Spruce', 'Willow', 'Natural', 'Resource'][i % 4]; if (cls) b.className = cls; box.appendChild(b); }
}
{
  const g = doc.getElementById('gradPick');
  g.innerHTML = '<div class="gg-picker"><div class="gg-head"><span>Choose a gradient</span><span class="gg-name">Forest</span></div><div class="gg-row">' +
    Array.from({ length: 13 }, () => '<button class="gg-sw" type="button"></button>').join('') +
    '</div><label class="gg-rev"><input type="checkbox"> reverse</label></div>';
}

// 1. every id main.js binds, and the controls of the dock and the sheet
{
  const ids = new Set([...mainSrc.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]));
  const missing = [...ids].filter(id => !doc.getElementById(id));
  ok(missing.length === 0, `every id main.js binds is in index.html (${ids.size} ids, missing: ${missing.join(' ') || 'none'})`);
  const dockKids = [...doc.getElementById('dock').children].map(e => e.id);
  ok(dockKids.join(' ') === 'dockPanel dockSpecies dockClock dockSow dockPlay', `the dock: menu, species, clock, grow again, play (${dockKids.join(' ')})`);
  ok(['dkYear', 'dkSub', 'dkFill'].every(id => doc.getElementById('dockClock')?.querySelector('#' + id)), 'the dock clock has the year, the month and season, and the year bar');
  const panel = doc.getElementById('panel');
  for (const id of ['speciesBtns', 'standBtns', 'spy', 'leavesBtn', 'rootsBtn', 'wind', 'colourBtns', 'gradPick', 'explainBtn', 'sheetGrip'])
    ok(panel.querySelector('#' + id), `the sheet has #${id}`);
}

// 2. the [hidden] rule
{
  const first = sheets[0].cssRules[0];
  ok(first.selectorText === '[hidden]' && first.style.getPropertyValue('display') === 'none' && first.style.getPropertyPriority('display') === 'important', 'style.css starts with [hidden]{display:none!important}');
}

const FIXED = ['dock', 'panel', 'explain', 'legend', 'status', 'hint', 'nogl'];
for (const vp of VPS) {
  const tag = `${vp.w}x${vp.h}`;
  const rules = collect(sheets, vp);
  const body = doc.body, panel = doc.getElementById('panel'), explain = doc.getElementById('explain');
  // the state of a phone with the sheet open, and the explainer shown
  body.classList.toggle('panel-closed', false); panel.classList.add('open');
  for (const id of ['explain', 'legend', 'nogl']) {
    const el = doc.getElementById(id);
    el.setAttribute('hidden', '');
    ok(declared(el, rules, 'display') === 'none', `${tag}: #${id}[hidden] is display none`);
    el.removeAttribute('hidden');
  }

  // 3. fixed overlays inside the viewport
  for (const sel of FIXED.map(id => '#' + id).concat(['.topbar'])) {
    const el = doc.querySelector(sel);
    if (declared(el, rules, 'display') === 'none') continue;
    const L = px(declared(el, rules, 'left'), vp, vp.w), Rr = px(declared(el, rules, 'right'), vp, vp.w);
    let W = px(declared(el, rules, 'width'), vp, vp.w);
    const maxW = px(declared(el, rules, 'max-width'), vp, vp.w);
    if (Number.isFinite(maxW) && Number.isFinite(W)) W = Math.min(W, maxW);
    let x0, x1;
    if (Number.isFinite(W)) {
      if (Number.isFinite(L)) { x0 = L; x1 = L + W; }
      else if (Number.isFinite(Rr)) { x1 = vp.w - Rr; x0 = x1 - W; }
      else { x0 = (vp.w - W) / 2; x1 = x0 + W; }
      if (sel === '#hint' && Number.isFinite(L)) { x0 = L - W / 2; x1 = L + W / 2; }  // translateX(-50%)
    } else if (Number.isFinite(L) && Number.isFinite(Rr)) { x0 = L; x1 = vp.w - Rr; }
    else continue;   // content width: checked below by its parts
    ok(x0 >= -0.5 && x1 <= vp.w + 0.5 && x1 - x0 <= vp.w + 0.5, `${tag}: ${sel} spans ${x0.toFixed(0)}..${x1.toFixed(0)} inside ${vp.w} px`);
  }
  if (vp.kind === 'desktop') {
    ok(declared(doc.getElementById('dock'), rules, 'display') === 'none', `${tag}: no dock on a desktop`);
    continue;
  }

  // 4. the dock content fits
  {
    const dock = doc.getElementById('dock');
    ok(declared(dock, rules, 'display') === 'flex', `${tag}: the dock shows`);
    const L = px(declared(dock, rules, 'left'), vp, vp.w), Rr = px(declared(dock, rules, 'right'), vp, vp.w), W = px(declared(dock, rules, 'width'), vp, vp.w);
    const dw = Number.isFinite(W) ? W : vp.w - L - Rr;
    const pad = tokens(declared(dock, rules, 'padding') || '').map(x => px(x, vp, vp.w));
    const padX = (pad[1] || 0) + (pad.length > 3 ? pad[3] : pad[1] || 0);
    const gap = px(declared(dock, rules, 'gap'), vp, vp.w) || 0;
    let need = padX + gap * (dock.children.length - 1);
    for (const k of dock.children) {
      const flex = (declared(k, rules, 'flex') || '').split(/\s+/);
      const basis = px(flex[2], vp, dw), mw = px(declared(k, rules, 'min-width'), vp, dw);
      need += Math.max(Number.isFinite(basis) && flex[1] === '0' ? basis : 0, Number.isFinite(mw) ? mw : 0);
      const h = px(declared(k, rules, 'height'), vp, 0);
      ok(h >= 44, `${tag}: dock #${k.id} is ${h} px tall`);
    }
    ok(need <= dw + 0.5, `${tag}: dock content needs ${need.toFixed(0)} px of ${dw.toFixed(0)}`);
  }

  // 5. touch targets and text sizes
  {
    const targets = [...doc.querySelectorAll('#panel button, #panel input, #explainClose, #timeline, .gg-sw')]
      .filter(el => el.type !== 'checkbox' && !(el.id === 'panelClose' && declared(el, rules, 'display') === 'none'));
    let small = [];
    for (const el of targets) {
      const h = Math.max(px(declared(el, rules, 'height'), vp, 0) || 0, px(declared(el, rules, 'min-height'), vp, 0) || 0);
      const row = el.closest('.row, .gg-rev');
      const rowH = row ? px(declared(row, rules, 'min-height'), vp, 0) || 0 : 0;
      if (Math.max(h, rowH) < 44) small.push((el.id || el.className || el.tagName) + ' ' + h);
    }
    ok(small.length === 0, `${tag}: ${targets.length} touch targets are 44 px or more${small.length ? ' (small: ' + small.slice(0, 6).join(', ') + ')' : ''}`);
    let tiny = [];
    for (const el of doc.body.querySelectorAll('*')) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      if (el.closest('.topbar, #nogl') || el.tagName === 'SUP' || el.tagName === 'SUB') continue;
      const f = fontSize(el, rules, vp);
      if (f < 11 - 1e-6) tiny.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : el.className ? '.' + el.className : ''} ${f.toFixed(1)}`);
    }
    ok(tiny.length === 0, `${tag}: all text is 11 px or more${tiny.length ? ' (' + tiny.slice(0, 6).join(', ') + ')' : ''}`);
  }

  // 6. no sideways scroll; the explainer is a full-height sheet
  {
    ok(declared(doc.documentElement, rules, 'overflow') === 'hidden' && declared(doc.body, rules, 'overflow') === 'hidden', `${tag}: the page does not scroll`);
    ok(declared(panel, rules, 'overflow-x') === 'hidden' && declared(explain, rules, 'overflow-x') === 'hidden', `${tag}: the sheet and the explainer cannot scroll sideways`);
    const T = px(declared(explain, rules, 'top'), vp, vp.h), B = px(declared(explain, rules, 'bottom'), vp, vp.h);
    ok(T === 0 && B === 0, `${tag}: the explainer runs from the top to the base (top ${T}, bottom ${B})`);
    const z = +declared(explain, rules, 'z-index'), zd = +declared(doc.getElementById('dock'), rules, 'z-index');
    if (vp.kind === 'sheet') ok(z > zd, `${tag}: the explainer sheet is above the dock (z ${z} > ${zd})`);
    const grip = doc.getElementById('sheetGrip');
    if (vp.kind === 'sheet') ok(declared(grip, rules, 'display') === 'flex' && px(declared(grip, rules, 'height'), vp, 0) >= 44, `${tag}: the sheet grip shows, 44 px tall`);
    else ok(declared(grip, rules, 'display') === 'none' && declared(doc.getElementById('panelClose'), rules, 'display') === 'block', `${tag}: the drawer has a close button and no grip`);
    // the open sheet leaves a clear area for the plant
    if (vp.kind === 'sheet') {
      const H = px(declared(panel, rules, 'height'), vp, vp.h);
      ok(Number.isFinite(H) && vp.h - 64 - H >= vp.h * 0.3, `${tag}: the half sheet (${H.toFixed(0)} px) leaves ${(vp.h - 64 - H).toFixed(0)} px clear`);
    }
  }
}

console.log(`plant-growth dom-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

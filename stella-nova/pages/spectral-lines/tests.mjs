// ============================================================================
//  SPECTRAL LINES  ·  tests.mjs — node stella-nova/pages/spectral-lines/tests.mjs
// ----------------------------------------------------------------------------
//  No DOM, no browser. Sections:
//    data      shape of data/lines.js, lines sorted by wavelength, indices
//    colour    450 / 550 / 650 nm give a blue / green / red channel first
//    boltz     weights finite, monotone in T for a fixed line
//    find      H at 656.28 nm, Na at 589.0 nm
//    layout    table cells do not overlap, the stack keeps Z order
//    levels    the term parse and the diagram columns
//    page      main.js import, head order, [hidden] rule, hidden vs display,
//              fonts, credit, 44 px targets
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as C from './core.js';
import { ELEMENTS } from '../periodic-table/data/elements.js';

const here = new URL('.', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const SP = require('./data/lines.js');
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ── data ────────────────────────────────────────────────────────────────────
{
  const E = SP.elements;
  ok(SP.version >= 1 && Array.isArray(E) && E.length > 0, 'data: SPECTRA has elements', `${E.length} elements`);
  ok(E.every((e, i) => typeof e.sym === 'string' && e.z > 0 && (i === 0 || e.z > E[i - 1].z)), 'data: elements in Z order with a symbol');
  const bad = [];
  let n = 0;
  for (const e of E) for (const ion of ['I', 'II']) {
    const s = e[ion]; if (s === null || s === undefined) continue;
    if (!['rel', 'gA'].includes(s.by) || !Array.isArray(s.lines) || !Array.isArray(s.levels)) { bad.push(`${e.sym} ${ion} shape`); continue; }
    s.lines.forEach((l, i) => {
      n++;
      if (l.length !== 7) bad.push(`${e.sym} ${ion} #${i} len`);
      if (i && l[0] < s.lines[i - 1][0]) bad.push(`${e.sym} ${ion} #${i} order`);
      if (!(l[0] >= 195 && l[0] <= 1105)) bad.push(`${e.sym} ${ion} #${i} wl ${l[0]}`);
      if (!(l[1] >= 0 && l[1] <= 1)) bad.push(`${e.sym} ${ion} #${i} s`);
      if (!(l[4] === -1 && l[5] === -1) && (!s.levels[l[4]] || !s.levels[l[5]])) bad.push(`${e.sym} ${ion} #${i} level idx`);
    });
    if (s.levels.some(v => !Number.isFinite(v[0]) || typeof v[1] !== 'string')) bad.push(`${e.sym} ${ion} level row`);
  }
  ok(!bad.length, 'data: every line has 7 fields, sorted by wl, 200-1100 nm, valid level indices', bad.length ? bad.slice(0, 5).join('; ') : `${n} lines`);
  ok(E.every(e => ELEMENTS.some(m => m.z === e.z && m.sym === e.sym)), 'data: every symbol matches the periodic-table data');
}

// ── colour ──────────────────────────────────────────────────────────────────
{
  const top = c => ['r', 'g', 'b'][c.indexOf(Math.max(...c))];
  const r = [450, 550, 650].map(nm => top(C.wlToRGB(nm)));
  ok(r.join() === 'b,g,r', 'colour: 450/550/650 nm give blue/green/red dominant channels', r.join(' '));
  const lin = [450, 550, 650].map(nm => top(C.wlToLinear(nm)));
  ok(lin.join() === 'b,g,r', 'colour: the linear sRGB of the CIE fit agrees', lin.join(' '));
  const y = C.cmf(555)[1];
  ok(Math.abs(y - 1) < 0.03, 'colour: ybar peaks near 1 at 555 nm', y.toFixed(3));
  ok(C.bandOf(300) === 'UV' && C.bandOf(900) === 'IR' && C.bandOf(500) === 'vis', 'colour: UV / IR bands');
  const na = SP.elements.find(e => e.sym === 'Na');
  if (na && na.I) {
    const L = C.lampColor(na.I, C.weights(na.I).lin);
    ok(L.rgb[0] > L.rgb[2] && L.rgb[1] > L.rgb[2], 'colour: a sodium lamp is yellow-orange', L.hex);
  }
}

// ── boltz ───────────────────────────────────────────────────────────────────
{
  const na = SP.elements.find(e => e.sym === 'Na') || SP.elements[0];
  const sp = na.I || na.II, i = sp.lines.findIndex(l => l[2] > 0);
  const Ts = [1500, 3000, 6000, 10000, 20000, 40000], w = Ts.map(T => C.boltzWeight(sp.lines[i], sp.levels, T));
  ok(w.every(Number.isFinite) && w.every((v, j) => j === 0 || v >= w[j - 1]), `boltz: weight of ${na.sym} ${sp.lines[i][0]} nm finite and monotone in T`, w.map(v => v.toExponential(2)).join(' '));
  let badW = [];
  for (const e of SP.elements) for (const ion of ['I', 'II']) {
    const s = e[ion]; if (!s) continue;
    for (const T of [1500, 6000, 40000]) { const W = C.weights(s, 'boltz', T); if (![...W.b, ...W.lin].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) badW.push(`${e.sym} ${ion} ${T}`); }
  }
  ok(!badW.length, 'boltz: all display weights finite in 0..1 at 1500, 6000, 40000 K', badW.slice(0, 5).join(' '));
}

// ── unclassified lines (U) ───────────────────────────────────────────────────
{
  const u = SP.elements.find(e => e.sym === 'U'), sp = u && (u.I || u.II);
  const un = sp ? sp.lines.map((l, i) => i).filter(i => C.unclassified(sp.lines[i])) : [];
  ok(un.length > 0, 'unclassified: U has lines with no level data', `${un.length} of ${sp ? sp.lines.length : 0}`);
  if (un.length) {
    const W = C.weights(sp, 'boltz', 3000), W2 = C.weights(sp, 'boltz', 30000);
    ok(un.every(i => W.b[i] === Math.fround(sp.lines[i][1]) && W2.b[i] === Math.fround(sp.lines[i][1])), 'unclassified: the temperature model keeps their stored strength');
    const G = C.grotrian(sp, 6.19);
    ok(![...G.lvl.keys()].some(k => k < 0) && Number.isFinite(G.Emax), 'unclassified: the level diagram skips them');
    const l = sp.lines[un.reduce((a, i) => sp.lines[i][1] > sp.lines[a][1] ? i : a, un[0])];
    ok(C.findByWavelength(SP, l[0], 0.5).some(r => r.sym === 'U'), `unclassified: find at ${l[0]} nm lists U`);
  }
}

// ── find ────────────────────────────────────────────────────────────────────
{
  const h = C.findByWavelength(SP, 656.28);
  ok(h.some(r => r.sym === 'H' && r.ion === 'I'), 'find: 656.28 nm finds H I', h.slice(0, 4).map(r => `${r.sym}${r.ion} ${r.wl}`).join(', '));
  const na = C.findByWavelength(SP, 589.0);
  ok(na.some(r => r.sym === 'Na'), 'find: 589.0 nm finds Na', na.slice(0, 4).map(r => `${r.sym}${r.ion} ${r.wl}`).join(', '));
  ok(na.every((r, i) => i === 0 || r.s <= na[i - 1].s) && na.every(r => Math.abs(r.wl - 589) <= 0.5), 'find: strongest first, all within ±0.5 nm');
}

// ── layout ──────────────────────────────────────────────────────────────────
{
  const R = C.tableRects(ELEMENTS, { x: 0, y: 0, w: 1000, h: 560 }), rs = [...R.values()];
  let over = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6) over++;
  }
  ok(R.size === 118 && over === 0 && rs.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1000 + 1e-6 && r.y + r.h <= 560 + 1e-6), 'layout: 118 table cells inside the box with no overlap', `${over} overlaps`);
  const zs = SP.elements.map(e => e.z), S = C.stackRects(zs, { x: 0, y: 0, w: 800, h: 500 });
  ok(zs.every((z, i) => i === 0 || S.get(z).y > S.get(zs[i - 1]).y), 'layout: the stack keeps Z order top to bottom');
  const m = C.lerpRect(rs[0], S.get(zs[0]), 0.5);
  ok(Object.values(m).every(Number.isFinite), 'layout: a morph rect stays finite');
}

// ── levels ──────────────────────────────────────────────────────────────────
{
  const t = C.parseTerm('2p6.3p 2P* 3/2'), u = C.parseTerm('3d2.(3F).4s.4p.(3P*) z 5G* 6');
  ok(t && t.L === 'P' && t.odd && t.mult === 2 && u && u.L === 'G' && u.mult === 5 && !C.parseTerm('2[3/2]* 2') && !C.parseTerm('40'), 'levels: the term parse (LS terms, jK and bare n give null)');
  const na = SP.elements.find(e => e.sym === 'Na'), hy = SP.elements.find(e => e.sym === 'H');
  if (na && na.I) { const G = C.grotrian(na.I, 5.139); ok(!G.single && G.cols.length >= 3 && G.cols[0].name === 'S' && G.Emax >= 5.139, 'levels: Na I has S, P, D columns and reaches its ionization limit', G.cols.map(c => c.name + (c.odd ? '*' : '')).join(' ')); }
  if (hy && hy.I) {
    const G = C.grotrian(hy.I, 13.6), used = new Set(hy.I.lines.flatMap(l => [l[4], l[5]]));
    ok([...used].every(i => G.lvl.has(i) && Number.isInteger(G.lvl.get(i).col)) && Math.abs(G.Emax - 13.6 * 1.03) < 0.05, 'levels: every H I level has a column, the scale reaches 13.6 eV', G.cols.map(c => c.name).join(' '));
  }
  const fake = { lines: [[500, 1, 1e7, 2, 0, 2, 0], [600, 1, 1e7, 2, 1, 2, 0]], levels: [[0, '1'], [1, '2'], [3, '3']] }, F = C.grotrian(fake, 0);
  ok(F.single && F.lanes.size === 2, 'levels: labels with no term give one column with a lane per lower level');
  ok(C.fmtA(6.16e7) === '6.16×10⁷ s⁻¹' && C.fmtA(0) === 'n/a', 'levels: Aki format');
  ok(C.parseQuery('?el=Na&view=stack').el === 'Na' && C.parseQuery('?view=x').view === null, 'page: ?el and ?view parse');
}

// ── page ────────────────────────────────────────────────────────────────────
{
  try { await import('./main.js'); ok(false, 'page: main.js import stops at a browser global'); }
  catch (e) { ok(e instanceof ReferenceError && /\b(window|document|navigator|matchMedia|ResizeObserver|requestAnimationFrame|performance|location|history|getComputedStyle)\b/.test(e.message), 'page: main.js imports with only a browser-global ReferenceError', `${e.constructor.name}: ${e.message}`); }
  try { await import('./draw.js'); ok(true, 'page: draw.js imports in node'); } catch (e) { ok(false, 'page: draw.js imports in node', e.message); }
  const html = readFileSync(here + 'index.html', 'utf8'), css = readFileSync(here + 'style.css', 'utf8');
  const js = ['main.js', 'core.js', 'draw.js'].map(f => readFileSync(here + f, 'utf8')).join('\n');
  const heads = [...html.matchAll(/<script src="\.\.\/\.\.\/lib\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]);
  ok(heads.slice(0, 3).join(',') === 'gpu-guard,wishlist,stats-beacon' && html.indexOf('gpu-guard') < html.indexOf('<meta'), 'page: head scripts gpu-guard, wishlist, stats-beacon first');
  ok(/name="viewport"[^>]*viewport-fit=cover/.test(html) && /<meta name="description" content="[^"]{40,}"/.test(html), 'page: viewport-fit=cover and a meta description');
  ok(/\[hidden\]\{display:none!important\}/.test(css.replace(/\s/g, '')), 'page: style.css has the [hidden] rule');
  // No element with the hidden attribute may also have a CSS display rule.
  const hid = [...html.matchAll(/<[a-z]+[^>]*\shidden[\s>][^>]*>|<[a-z]+[^>]*\shidden>/g)].map(m => m[0]);
  const ids = hid.map(t => (t.match(/id="([^"]+)"/) || [])[1]).filter(Boolean);
  const cls = hid.flatMap(t => ((t.match(/class="([^"]+)"/) || [])[1] || '').split(/\s+/)).filter(Boolean);
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const clash = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*display\s*:/.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      const last = sel.trim().split(/\s+|>/).pop() || '';
      for (const id of ids) if (new RegExp('#' + id + '(?![\\w-])').test(last)) clash.push(sel.trim());
      for (const c of cls) if (new RegExp('\\.' + c + '(?![\\w-])').test(last)) clash.push(sel.trim());
    }
  }
  ok(hid.length > 0 && !clash.length, 'page: no element has both the hidden attribute and a CSS display rule', clash.length ? clash.join(' | ') : `${hid.length} hidden: ${ids.join(' ')}`);
  ok(!/Playfair|Cormorant|JetBrains/i.test(html + css + js), 'page: no Playfair, Cormorant or JetBrains Mono');
  ok(!/katex/i.test(html + css + js) && /sci-math\.js/.test(js), 'page: math by MathJax SVG (lib/sci-math.js), no KaTeX');
  ok(html.includes('Line data: NIST Atomic Spectra Database (ver. 5.12), A. Kramida, Yu. Ralchenko, J. Reader and NIST ASD Team, https://physics.nist.gov/asd, fetched 2026-11-04. (c) U.S. Secretary of Commerce on behalf of the United States of America. All rights reserved.'), 'page: the NIST credit text is on the page');
  const pc = css.slice(css.indexOf('(pointer:coarse)'));
  ok(css.includes('(pointer:coarse)') && /min-height:\s*44px/.test(pc), 'page: 44 px targets on a coarse pointer');
  ok(/id="dock"/.test(html) && /id="sheetGrip"/.test(html) && /max-height:500px\) and \(orientation:landscape\)/.test(css), 'page: dock, sheet grip and landscape drawer');
  ok(/<script src="data\/lines\.js"><\/script>\s*<script type="module" src="main\.js"><\/script>/.test(html) && /src="saver\.js"/.test(html), 'page: lines.js before main.js, then saver.js');
  ok(/window\.snSpectral\s*=\s*\{/.test(js) && /setElement:/.test(js) && /setView:/.test(js) && /state:/.test(js), 'page: window.snSpectral has setElement, setView, state');
  ok(/snSaverActive/.test(js) && /sn-saver-exit/.test(js), 'page: the loop stops while the saver runs');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

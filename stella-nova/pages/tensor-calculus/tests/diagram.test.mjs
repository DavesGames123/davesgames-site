// DIAGRAM package tests (node, no browser). Run: node tests/diagram.test.mjs
// Layout of 40+ library expressions in three styles, transition continuity
// for every step kind, style switching through a stub DOM, legend output.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutExpr, unitBoxes, STYLES } from '../diagram/layout.js';
import { stepFrame, matchTerms, rekey } from '../diagram/transition.js';
import { toSvgString } from '../diagram/render.js';
import { legendItems, FEYNMAN_NOTE } from '../diagram/legend.js';
import { boxesOverlap } from '../diagram/geom.js';
import { parseStub, FIXTURES, fixtureSteps } from '../diagram/fixtures.js';
import { createDiagram } from '../diagram/index.js';

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; fails.push(`${name}${detail ? ': ' + detail : ''}`); }
}

// ---------------------------------------------------------------- layout
const crossTotals = {};
for (const style of STYLES) {
  crossTotals[style] = 0;
  for (const fx of FIXTURES) {
    const expr = parseStub(fx.tex);
    let sc;
    try { sc = layoutExpr(expr, { style }); } catch (e) { check(`${style}/${fx.id} layout`, false, e.stack); continue; }
    const tag = `${style}/${fx.id}`;
    // Nodes do not overlap.
    const boxes = unitBoxes(sc);
    let ov = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i], boxes[j])) ov++;
    check(`${tag} no node overlap`, ov === 0, `${ov} overlaps`);
    // Every index has exactly one leg.
    const legs = sc.items.filter(i => i.type === 'leg');
    let want = 0;
    for (const t of expr.terms) for (const f of t.factors) want += f.indices.length + (f.deriv || []).length;
    const keys = new Set(legs.map(l => l.key));
    check(`${tag} one leg per index`, legs.length === want && keys.size === legs.length, `${legs.length} legs, ${want} indices`);
    // Every dummy pair is one wire; free legs end at the boundary by variance.
    const bySide = new Map();
    for (const t of expr.terms) { if (!bySide.has(t.side)) bySide.set(t.side, []); bySide.get(t.side).push(t); }
    for (const [si, terms] of bySide) terms.forEach((t, ti) => {
      const tk = `T${si}.${ti}`;
      const cnt = new Map();
      for (const f of t.factors) for (const ix of [...f.indices, ...(f.deriv || [])]) cnt.set(ix.sym, (cnt.get(ix.sym) || 0) + 1);
      for (const [sym, n] of cnt) {
        const L = legs.filter(l => l.term === tk && l.sym === sym);
        if (n === 2) {
          const ok = L.length === 2 && L[0].strand === L[1].strand && !L[0].free && !L[1].free &&
            Math.hypot(L[0].end[0] - L[1].end[0], L[0].end[1] - L[1].end[1]) < 0.5;
          check(`${tag} ${tk} dummy ${sym} is one wire`, ok);
        } else if (n === 1) {
          const l = L[0];
          const row = sc.rows.find(r => l && l.end[1] >= r.top - 1 && l.end[1] <= r.bottom + 1);
          const ok = l && l.free && row && (l.up ? Math.abs(l.end[1] - row.top) < 0.5 && l.end[1] < l.slot[1]
                                              : Math.abs(l.end[1] - row.bottom) < 0.5 && l.end[1] > l.slot[1]);
          check(`${tag} ${tk} free ${sym} ends at the ${l && l.up ? 'top' : 'bottom'}`, !!ok);
        }
      }
    });
    check(`${tag} crossings reported`, Number.isFinite(sc.crossings) && sc.crossings >= 0);
    crossTotals[style] += sc.crossings;
    const svg = toSvgString(sc, { style });
    check(`${tag} svg balanced`, (svg.match(/<g /g) || []).length === (svg.match(/<\/g>/g) || []).length && svg.endsWith('</svg>'));
  }
}

// Phone width: rows wrap, and a row is only wider than the limit when one
// term alone is wider.
let maxPhone = 0, wrapped = 0;
for (const fx of FIXTURES) {
  const sc = layoutExpr(parseStub(fx.tex), { style: 'penrose', maxWidth: 360 });
  if (sc.rows.length > 1) wrapped++;
  maxPhone = Math.max(maxPhone, sc.width);
}
check('phone width wraps long equations', wrapped >= 8, `${wrapped} wrapped`);

// Style switching keeps the leg keys, so the morph moves every leg.
for (const fx of FIXTURES) {
  const ks = STYLES.map(s => layoutExpr(parseStub(fx.tex), { style: s }).items.filter(i => i.type === 'leg').map(i => i.key).sort().join());
  check(`${fx.id} same legs in all styles`, ks[0] === ks[1] && ks[1] === ks[2]);
}

// ---------------------------------------------------------------- transitions
const steps = fixtureSteps();
let maxJump = 0;
for (const style of STYLES) {
  for (const st of steps) {
    const tag = `${style}/${st.id}`;
    const A = layoutExpr(st.before, { style }), B = layoutExpr(st.after, { style });
    const Bk = rekey(B, matchTerms(A, B));
    const base = k => k.replace(/~[ab]$/, '');
    const vis = f => f.items.filter(i => (i.o ?? 1) > 0.01);
    // t = 0 is A, t = 1 is B.
    const f0 = stepFrame(st, A, B, 0), f1 = stepFrame(st, A, B, 1);
    const aKeys = new Set(A.items.map(i => i.key)), bKeys = new Set(Bk.items.map(i => i.key));
    const bad0 = vis(f0).filter(i => !aKeys.has(base(i.key)));
    const bad1 = vis(f1).filter(i => !i.overlay && !bKeys.has(base(i.key)));
    check(`${tag} t=0 shows only A`, bad0.length === 0, bad0.map(i => i.key).join());
    check(`${tag} t=1 shows only B`, bad1.length === 0, bad1.map(i => i.key).join());
    const amap = new Map(A.items.map(i => [i.key, i]));
    let geo0 = 0;
    for (const it of f0.items) {
      const a = amap.get(base(it.key));
      if (!a || it.type !== 'leg' || (it.o ?? 1) < 0.01) continue;
      for (let i = 0; i < a.pts.length; i++) geo0 = Math.max(geo0, Math.hypot(a.pts[i][0] - it.pts[i][0], a.pts[i][1] - it.pts[i][1]));
    }
    check(`${tag} t=0 legs equal A`, geo0 < 1e-6, `off ${geo0}`);
    const bmap = new Map(Bk.items.map(i => [i.key, i]));
    let geo1 = 0;
    for (const it of f1.items) {
      const b = bmap.get(base(it.key));
      if (!b || it.type !== 'leg' || (it.o ?? 1) < 0.01) continue;
      for (let i = 0; i < b.pts.length; i++) geo1 = Math.max(geo1, Math.hypot(b.pts[i][0] - it.pts[i][0], b.pts[i][1] - it.pts[i][1]));
    }
    check(`${tag} t=1 legs equal B`, geo1 < 1e-6, `off ${geo1}`);
    // Continuity: no point jumps far between two close times.
    const N = 240;
    let prev = null, jump = 0, ojump = 0;
    const diag = Math.hypot(Math.max(A.width, B.width), Math.max(A.height, B.height));
    for (let k = 0; k <= N; k++) {
      const f = stepFrame(st, A, B, k / N);
      const m = new Map(f.items.map(i => [i.key, i]));
      if (prev) {
        for (const [key, it] of m) {
          const p = prev.get(key);
          if (!p) { ojump = Math.max(ojump, it.o ?? 1); continue; }
          ojump = Math.max(ojump, Math.abs((it.o ?? 1) - (p.o ?? 1)));
          if (it.type === 'leg') for (let i = 0; i < it.pts.length; i++) jump = Math.max(jump, Math.hypot(it.pts[i][0] - p.pts[i][0], it.pts[i][1] - p.pts[i][1]));
          else if (it.x !== undefined && p.x !== undefined) jump = Math.max(jump, Math.hypot(it.x - p.x, it.y - p.y));
        }
        for (const [key, p] of prev) if (!m.has(key)) ojump = Math.max(ojump, p.o ?? 1);
      }
      prev = m;
    }
    maxJump = Math.max(maxJump, jump / diag);
    check(`${tag} continuous motion`, jump < 0.05 * diag, `jump ${jump.toFixed(2)} of ${diag.toFixed(0)}`);
    check(`${tag} continuous opacity`, ojump < 0.12, `opacity jump ${ojump.toFixed(3)}`);
  }
}
// Kind-specific marks.
{
  const byId = Object.fromEntries(steps.map(s => [s.id, s]));
  const at = (id, t, style = 'penrose') => { const s = byId[id]; return stepFrame(s, layoutExpr(s.before, { style }), layoutExpr(s.after, { style }), t); };
  check('raise bends over a cup mid-step', at('raise', 0.5).items.some(i => i.shape === 'cup' && i.overlay && i.o > 0.9));
  check('lower bends over a cap mid-step', at('lower', 0.5).items.some(i => i.shape === 'cap' && i.overlay && i.o > 0.9));
  check('transform wraps legs in Jacobians', at('transform', 1).items.filter(i => i.kind === 'jacobian').length === 2);
  check('symmetrize bar grows', at('symmetrize', 1).items.some(i => i.type === 'bar' && i.btype === 'sym' && i.weight === '1/2!'));
  check('antisymmetrize bar grows', at('antisymmetrize', 1).items.some(i => i.type === 'bar' && i.btype === 'antisym'));
  check('overlay bar with 1/3!', at('sym-overlay', 1).items.some(i => i.type === 'bar' && i.overlay && i.weight === '1/3!'));
  const mid = at('partial', 0.5).items.find(i => i.type === 'circle'), end = at('partial', 1).items.find(i => i.type === 'circle');
  check('derivative ring grows', mid && end && (mid.x1 - mid.x0) < (end.x1 - end.x0) * 0.9 && (mid.x1 - mid.x0) > 0);
  const ex = at('expand', 0.3).items.filter(i => i.spawn);
  check('expandSum slides new terms out', ex.length > 0);
  const cancel = at('cancel', 0.5).items.filter(i => i.term && i.term.startsWith('T0.') && i.type === 'node' && i.o < 0.9);
  check('cancelled terms fade', cancel.length === 2);
}

// ---------------------------------------------------------------- DOM stub
class El {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.parentNode = null; this.listeners = {}; this.textContent = ''; this.classList = { add() {} }; this.innerHTML = ''; this.clientWidth = 0; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { const a = this.parentNode.children; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(g => g !== f); }
}
const doc = { defaultView: null, getElementById: () => null };
doc.createElementNS = (ns, t) => new El(t, doc);
doc.createElement = t => new El(t, doc);
doc.head = new El('head', doc);
const all = el => [el, ...el.children.flatMap(all)];
{
  const host = new El('div', doc);
  const picks = [];
  const d = createDiagram(host, { onPickIndex: s => picks.push(s), maxWidth: 900 });
  const expr = parseStub(FIXTURES.find(f => f.id === 'matrix-product').tex);
  d.show(expr, { animate: false });
  const svg = host.children[0];
  const n0 = all(svg).length;
  check('createDiagram draws into an owned svg', svg.tagName === 'svg' && n0 > 10 && /^0 0 /.test(svg.attrs.viewBox));
  d.setStyle('birdtrack');
  check('birdtrack style draws arrows', d.scene() && all(svg).filter(e => e.tagName === 'path' && e.attrs.d && e.attrs.fill && e.attrs.fill !== 'none' && e.attrs.stroke === 'none').length >= 2);
  d.setStyle('network');
  check('network style draws the einsum line', all(svg).some(e => e.tagName === 'text' && /einsum\('ij,jk->ik'/.test(e.textContent)));
  check('style getter', d.style === 'network');
  d.setStyle('penrose');
  for (const st of steps) for (const t of [0, 0.25, 0.5, 1]) d.play(st, t);
  check('play runs every step kind', true);
  d.show(expr, { animate: false });
  d.pickIndex('i');
  const legsEls = all(svg).filter(e => e.attrs['stroke-linecap'] === 'round' && e.attrs.stroke && e.attrs['stroke-width'] && e.parentNode && e.parentNode.attrs['data-layer'] === 'wire');
  const op = legsEls.map(e => +e.attrs.opacity);
  check('pickIndex dims the other legs', op.some(v => v === 1) && op.some(v => v < 0.5));
  const hit = all(svg).find(e => e.attrs['data-sym'] === 'k');
  svg.listeners.click[0]({ target: hit, pointerType: 'touch' });
  check('tap on a leg picks its index', picks[picks.length - 1] === 'k');
  svg.listeners.click[0]({ target: svg, pointerType: 'touch' });
  check('tap on empty space clears it', picks[picks.length - 1] === null);
  check('svgString gives a document', d.svgString().startsWith('<svg'));
  const leg = new El('div', doc);
  d.legend(leg);
  check('legend mounts with the Feynman note', /Feynman/.test(leg.innerHTML) && /<svg/.test(leg.innerHTML));
  d.dispose();
  check('dispose removes the svg', host.children.length === 0);
}

// ---------------------------------------------------------------- legend
for (const style of STYLES) {
  const items = legendItems(style);
  check(`legend ${style} has glyphs`, items.length >= 5 && items.every(i => i.svg.startsWith('<svg') && i.text.length > 10));
}
check('Feynman note says it is a different tool', /different tool/.test(FEYNMAN_NOTE));

// ---------------------------------------------------------------- MATH parser (when it has landed)
const mathIndex = fileURLToPath(new URL('../tensor/index.js', import.meta.url));
let mathNote = 'MATH parser not present, stand-in parser only';
if (existsSync(mathIndex)) {
  try {
    const M = await import('../tensor/index.js');
    if (typeof M.parseIndexTex === 'function') {
      let ok = 0, parsed = 0;
      for (const fx of FIXTURES) {
        let e;
        try { e = M.parseIndexTex(fx.tex); parsed++; } catch { continue; }
        try { const sc = layoutExpr(e, { style: 'penrose' }); if (sc.items.length) ok++; } catch (err) { check(`MATH ${fx.id} layout`, false, err.message); }
      }
      mathNote = `MATH parseIndexTex: ${parsed}/${FIXTURES.length} parsed, ${ok} laid out`;
      check('MATH expressions lay out', ok === parsed);
    }
  } catch (e) { mathNote = `MATH import failed: ${e.message}`; }
}

console.log(`diagram: ${FIXTURES.length} expressions x ${STYLES.length} styles, ${steps.length} steps x ${STYLES.length} styles`);
console.log(`diagram: crossings penrose ${crossTotals.penrose}, birdtrack ${crossTotals.birdtrack}, network ${crossTotals.network}`);
console.log(`diagram: phone width 360 -> ${wrapped} wrapped, widest ${maxPhone.toFixed(0)}; worst step jump ${(maxJump * 100).toFixed(2)}% of diagonal`);
console.log(`diagram: ${mathNote}`);
for (const f of fails.slice(0, 40)) console.log('FAIL', f);
console.log(`diagram: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

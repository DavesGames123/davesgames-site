// ============================================================================
//  PARTICLE COLLIDER  ·  feynman-tests.mjs — node pages/particle-collider/feynman-tests.mjs
// ----------------------------------------------------------------------------
//  Checks feynman.js against the generators and the rules of the diagrams:
//    coverage ..... every beam, energy and process that available() allows
//                   gives a diagram, and every hard-process particle of the
//                   event has exactly one final-state line of its species
//    vertices ..... charge, baryon number, lepton numbers (e, mu, any) and
//                   colour flow balance at every vertex
//    arrows ....... each fermion arrow points along the fermion flow, and
//                   at each vertex the arrows in equal the arrows out
//    couplings .... each vertex has the coupling of the lines that meet
//    layout ....... vertices at least 30 units apart, labels clear of each
//                   other and of the vertices, time from left to right
//    time ......... nothing drawn before the beams come in, the incoming
//                   lines done at t = 0, everything done at t = 4 ns
//    colours ...... each final-state line has its detector track colour
//    time order ... a line leaves a vertex only after the lines into it are
//                   complete; drawState and toSVG agree
//    text ......... one sentence per process, every coupling named
//    objects ...... in 20 transported events each final-state line finds
//                   its detector object (track, jet, MET) of the same colour
//    page ......... the card markup, the phone tab, the saver rule, 44 px
//                   targets, [hidden], no horizontal scroll (text checks)
//    MathJax ...... with FEYN_MATHJAX=<dir that holds node_modules/
//                   mathjax-full>, every label and coupling typesets with
//                   no error and the typeset labels do not overlap;
//                   with jsdom in the same folder, the card itself: MathJax
//                   labels, lines that grow with time, click and focus
//  The exit code is the number of failures.
// ============================================================================
import { diagramFor, toSVG, FP, COUPLINGS, frontAt, lineFrac, colorOf, extent, drawState, couplingText, lineObjects } from './feynman.js';
import { generate, SCENARIOS, BEAMS, available } from './generators.js';
import { makeRng } from './transport.js';
import { CLASS_COLOR } from './particles.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fail++; };

// ── every event the page can make ───────────────────────────────────────────
const events = [];
for (const [beam, B] of Object.entries(BEAMS)) for (const [E] of B.E) for (const kind of Object.keys(SCENARIOS)) {
  if (available(beam, kind, E)) continue;
  const seeds = ['tt', 'jj', 'h4l', 'zmm', 'zee'].includes(kind) ? 10 : 2;
  for (let s = 1; s <= seeds; s++) {
    const g = generate(kind, { beam, sqrtS: E * 1000, pileup: 0, particle: ['e-', 'gamma', 'mu-', 'pi+', 'K0L', 'n'][s % 6] }, makeRng(1000 * s + kind.length));
    events.push({ beam, E, kind, info: g.info, d: diagramFor(g.info) });
  }
}
const keys = new Set(events.map(e => e.d.key));
const combos = new Set(events.map(e => `${e.beam}:${e.kind}`));
ok(events.every(e => e.d && e.d.lines.length > 0 && e.d.title && e.d.text), `coverage: ${events.length} events over ${combos.size} beam-process pairs give ${keys.size} distinct diagrams`);
// synthetic infos: every process with every beam, allowed or not, does not throw
let thrown = 0;
for (const beam of Object.keys(BEAMS)) for (const kind of Object.keys(SCENARIOS)) { try { diagramFor({ kind, beam, hard: [], truth: {} }); } catch (e) { thrown++; } }
ok(thrown === 0, `every beam and process pair, even ones available() forbids, maps to a diagram (${thrown} failed)`);

// hard particles <-> final-state lines
const speciesOK = (name, p) => {
  if (name === 'nu') return FP[p] && FP[p].kind === 'fermion' && !FP[p].q && (FP[p].L.e || FP[p].L.mu || FP[p].L.x);
  if (name === 'q' || name === 'b' || name === 'g') return name === 'g' ? p === 'g' : name === 'b' ? (p === 'b' || p === 'bb') : ['u', 'ub', 'd', 'db'].includes(p);
  if (p.startsWith('gun:')) return p.slice(4) === name;
  return p === name;
};
let badHard = 0, badMsg = '';
for (const e of events) {
  if (e.kind === 'mb') continue;
  const H = e.info.hard, seen = new Array(H.length).fill(0);
  for (const L of e.d.lines) if (L.ext === 'out' && L.hard != null) { seen[L.hard]++; if (!speciesOK(H[L.hard][0], L.p)) { badHard++; badMsg = `${e.d.key}: hard ${H[L.hard][0]} drawn as ${L.p}`; } }
  if (seen.some(c => c !== 1)) { badHard++; badMsg = `${e.d.key}: hard lines seen ${seen.join(',')}`; }
}
ok(badHard === 0, `every hard-process particle has one final-state line of its species (${badHard} bad${badMsg ? ': ' + badMsg : ''})`);

// ── vertices: quantum numbers and colour ────────────────────────────────────
const uniq = new Map(); for (const e of events) if (!uniq.has(e.d.key)) uniq.set(e.d.key, e.d);
const D = [...uniq.values()];
const QN = p => { const P = FP[p]; return P ? { q: P.q, B: P.B, e: P.L.e || 0, mu: P.L.mu || 0, x: P.L.x || 0 } : { q: 0, B: 0, e: 0, mu: 0, x: 0 }; };
let qBad = 0, cBad = 0, nV = 0, qMsg = '';
for (const d of D) for (const v of d.nodes.filter(v => v.cpl)) {
  nV++;
  const sum = { q: 0, B: 0, e: 0, mu: 0, x: 0 }, cols = [], antis = [];
  for (const L of d.lines) {
    const into = L.b === v.id, out = L.a === v.id;
    if (!into && !out) continue;
    const s = into ? 1 : -1, Q = QN(L.p);
    for (const k in sum) sum[k] += s * Q[k];
    // colour flow: an incoming line gives (colour, anticolour), an outgoing one the swap
    const [c, a] = into ? L.col : [L.col[1], L.col[0]];
    if (c) cols.push(c); if (a) antis.push(a);
  }
  if (Object.values(sum).some(x => x !== 0)) { qBad++; qMsg = `${d.key} at ${v.id}: ${JSON.stringify(sum)}`; }
  if (cols.sort().join() !== antis.sort().join()) { cBad++; qMsg = `${d.key} colour at ${v.id}: ${cols} / ${antis}`; }
}
ok(qBad === 0, `charge, baryon number and lepton numbers balance at all ${nV} vertices of ${D.length} diagrams${qBad ? ': ' + qMsg : ''}`);
ok(cBad === 0, `colour flows through every vertex (each colour index in once and out once)${cBad ? ': ' + qMsg : ''}`);
// colour lines: a quark carries a colour only, an antiquark an anticolour only, a gluon both, others none
let colKind = 0;
for (const d of D) for (const L of d.lines) {
  const c = FP[L.p] ? FP[L.p].col : 0, [a, b] = L.col;
  if (c === 3 ? !(a && !b) : c === -3 ? !(!a && b) : c === 8 ? !(a && b && a !== b) : (a || b)) colKind++;
}
ok(colKind === 0, `colour indices fit the line: quarks one colour, antiquarks one anticolour, gluons two, colourless lines none (${colKind} bad)`);

// ── arrows ──────────────────────────────────────────────────────────────────
let aBad = 0, fBad = 0, nA = 0;
for (const d of D) {
  const N = Object.fromEntries(d.nodes.map(x => [x.id, x]));
  for (const L of d.lines) {
    const P = FP[L.p];
    if (!P || P.kind !== 'fermion') { if (L.arrow) aBad++; continue; }
    nA++;
    const ab = [N[L.b].x - N[L.a].x, N[L.b].y - N[L.a].y], dot = L.arrow.dx * ab[0] + L.arrow.dy * ab[1];
    if (!(P.anti ? dot < 0 : dot > 0)) aBad++;
  }
  for (const v of d.nodes.filter(v => v.cpl)) {
    let inn = 0, out = 0;
    for (const L of d.lines) {
      if (!L.arrow) continue;
      const fwd = !FP[L.p].anti;
      if (L.b === v.id) fwd ? inn++ : out++;
      if (L.a === v.id) fwd ? out++ : inn++;
    }
    if (inn !== out) fBad++;
  }
}
ok(aBad === 0, `${nA} fermion arrows point along the fermion flow (antifermions backward in time); no arrow on a boson (${aBad} bad)`);
ok(fBad === 0, `fermion flow: at every vertex the arrows in equal the arrows out (${fBad} bad)`);

// ── couplings ───────────────────────────────────────────────────────────────
const want = (d, v) => {
  const ps = d.lines.filter(L => L.a === v.id || L.b === v.id).map(L => L.p), has = p => ps.includes(p);
  if (has('g')) return 'qcd';
  if (has('H')) return has('t') || has('tb') ? 'yuk' : has('Wp') || has('Wm') ? 'hww' : 'hzz';
  if (has('gZ')) return 'ew';
  if (has('Wp') || has('Wm')) return has('gamma') ? 'qed' : 'cc';
  if (has('Z') || has('Zs')) return 'nc';
  if (has('gamma')) return 'qed';
  return '?';
};
let cplBad = 0, cplMsg = '';
for (const d of D) for (const v of d.nodes.filter(v => v.cpl)) { const w = want(d, v); if (w !== v.cpl || !COUPLINGS[v.cpl]) { cplBad++; cplMsg = `${d.key} ${v.id}: ${v.cpl}, want ${w}`; } }
ok(cplBad === 0, `every vertex has the coupling of its lines (strong, electromagnetic, weak, Yukawa, Higgs) (${cplBad} bad${cplMsg ? ': ' + cplMsg : ''})`);
ok(D.every(d => d.nodes.filter(v => v.cpl).length === d.couplings.reduce((s, c) => s + c.n, 0)), 'the coupling list of each diagram counts every vertex once');

// ── line styles ─────────────────────────────────────────────────────────────
let sBad = 0;
for (const d of D) {
  const svg = toSVG(d).svg;
  for (const L of d.lines) {
    const k = L.kind, P = FP[L.p];
    const right = P ? ({ fermion: 'fermion', photon: 'photon', gluon: 'gluon', boson: 'boson', scalar: 'scalar' }[P.kind] === k) : k === 'hadron';
    if (!right) sBad++;
    if ((k === 'photon' || k === 'boson' || k === 'gluon') !== (L.pts.length > 2)) sBad++;
  }
  const nH = d.lines.filter(L => L.kind === 'scalar').length, nDash = (svg.match(/stroke-dasharray/g) || []).length;
  if (nH !== nDash) sBad++;
  if ((svg.match(/class="fy-a"/g) || []).length !== d.lines.filter(L => L.arrow).length) sBad++;
}
ok(sBad === 0, `styles: fermions straight with arrows, photons and W/Z wavy, gluons curly, the Higgs dashed (${sBad} bad)`);

// ── layout ──────────────────────────────────────────────────────────────────
let minD = Infinity, minAt = '', lBad = 0, lMsg = '', tBad = 0;
const ov = (a, b, p = 0) => a.x < b.x + b.w + p && b.x < a.x + a.w + p && a.y < b.y + b.h + p && b.y < a.y + a.h + p;
for (const d of D) {
  toSVG(d);   // places the label boxes
  for (let i = 0; i < d.nodes.length; i++) for (let j = i + 1; j < d.nodes.length; j++) {
    const a = d.nodes[i], b = d.nodes[j], r = Math.hypot(a.x - b.x, a.y - b.y);
    if (r < minD) { minD = r; minAt = `${d.key} ${a.id}-${b.id}`; }
  }
  const boxes = d.lines.filter(L => L.label).map(L => ({ L, ...L.label.box }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) if (ov(boxes[i], boxes[j])) { lBad++; lMsg = `${d.key}: ${boxes[i].L.tex} / ${boxes[j].L.tex}`; }
    for (const v of d.nodes) if (ov(boxes[i], { x: v.x - 3, y: v.y - 3, w: 6, h: 6 })) { lBad++; lMsg = `${d.key}: ${boxes[i].L.tex} on ${v.id}`; }
  }
  const N = Object.fromEntries(d.nodes.map(x => [x.id, x])), { x0 } = extent(d);
  for (const L of d.lines) {
    if (L.loop || L.spacelike) continue;
    if (!(N[L.b].x > N[L.a].x)) tBad++;
    if (L.ext === 'in' && N[L.a].x !== x0) tBad++;
  }
}
ok(minD >= 30, `no two vertices or line ends closer than 30 units (closest ${minD.toFixed(1)}, ${minAt})`);
ok(lBad === 0, `labels clear of each other and of the vertices, estimated boxes (${lBad} bad${lMsg ? ': ' + lMsg : ''})`);
ok(tBad === 0, `time runs left to right: every line but loops and the t-channel exchange moves right, all incoming lines start at the left edge (${tBad} bad)`);

// ── time ────────────────────────────────────────────────────────────────────
let mBad = 0, iBad = 0;
for (const d of D) {
  let last = -Infinity;
  for (let t = -6; t <= 8; t += 0.05) { const X = frontAt(d, t); if (X < last - 1e-9) mBad++; last = X; }
  const at = t => d.lines.map(L => lineFrac(L, frontAt(d, t)));
  if (at(-4).some(f => f > 0)) iBad++;
  const f0 = at(0);
  d.lines.forEach((L, i) => { if (L.ext === 'in' && f0[i] < 1) iBad++; if (L.ext === 'out' && !L.isr && d.key !== 'gun' && f0[i] > 0 && L.x1 > extent(d).xv + 1e-6 && d.nodes.find(v => v.id === L.a).x > extent(d).xv) iBad++; });
  if (at(4).some(f => f < 1)) iBad++;
}
ok(mBad === 0 && iBad === 0, `the drawing front only moves forward; nothing before t = -4 ns, incoming lines done at t = 0, all done at t = 4 ns (${mBad} + ${iBad} bad)`);

// ── colours ─────────────────────────────────────────────────────────────────
let colBad = 0;
const CL = { 'e-': 'e', 'e+': 'e', 'mu-': 'mu', 'mu+': 'mu', gamma: 'gamma' };
for (const d of D) for (const L of d.lines) if (L.ext === 'out' && !L.p.startsWith('gun:')) {
  const want = CL[L.p] ? CLASS_COLOR[CL[L.p]] : FP[L.p].kind === 'fermion' && !FP[L.p].q && !FP[L.p].B ? CLASS_COLOR.nu : colorOf('jet');
  if (L.color !== want) colBad++;
}
ok(colBad === 0, `final-state colours: muons ${CLASS_COLOR.mu}, electrons ${CLASS_COLOR.e}, photons ${CLASS_COLOR.gamma}, neutrinos (missing ET) ${CLASS_COLOR.nu}, quarks and gluons the jet colour (${colBad} bad)`);

// ── time order (the card draws with drawState) ─────────────────────────────
// A line leaves a vertex only after every line that comes into the vertex
// from the left is complete, and drawState gives the same picture as toSVG.
let oBad = 0, oMsg = '', sdBad = 0;
for (const d of D) {
  const N = Object.fromEntries(d.nodes.map(x => [x.id, x]));
  const left = L => N[L.a].x <= N[L.b].x ? L.a : L.b, right = L => left(L) === L.a ? L.b : L.a;
  for (let t = -4.2; t <= 4.4; t += 0.1) {
    const st = drawState(d, frontAt(d, t));
    for (const v of d.nodes.filter(v => v.cpl)) {
      const into = d.lines.filter(L => !L.loop && !L.spacelike && right(L) === v.id && N[left(L)].x < v.x - 1e-6);
      const outOf = d.lines.filter(L => !L.loop && !L.spacelike && left(L) === v.id && N[right(L)].x > v.x + 1e-6);
      if (outOf.some(L => st.lines[L.i].f > 0) && into.some(L => st.lines[L.i].f < 1)) { oBad++; oMsg = `${d.key} at ${v.id}, t = ${t.toFixed(1)}`; }
      if (!st.nodes.find(n => n.id === v.id).on && outOf.some(L => st.lines[L.i].f > 0)) { oBad++; oMsg = `${d.key}: ${v.id} hidden while its lines draw`; }
    }
  }
  for (const t of [-3, -1, 0.5, 2, 5]) {
    const X = frontAt(d, t), st = drawState(d, X), svg = toSVG(d, { front: X }).svg;
    for (const L of st.lines) {
      if (!svg.includes(`class="fy-l" data-i="${L.i}" d="${L.d}"`)) sdBad++;
      if (d.lines[L.i].arrow && !svg.includes(`class="fy-a" data-i="${L.i}" d="`) ) sdBad++;
    }
    const nA = (svg.match(/class="fy-a"[^>]*opacity="1"/g) || []).length;
    if (nA !== st.lines.filter(L => L.arrow).length) sdBad++;
  }
}
ok(oBad === 0, `time order: a line leaves a vertex only after the lines into it are complete, and the vertex shows first (${oBad} bad${oMsg ? ': ' + oMsg : ''})`);
ok(sdBad === 0, `drawState gives the same paths and arrows as toSVG at five event times (${sdBad} bad)`);

// ── the one-line description and the couplings named ───────────────────────
let tBad2 = 0, tMsg = '';
for (const d of D) {
  if (/\n/.test(d.text) || d.text.length > 260 || !/\.$/.test(d.text)) { tBad2++; tMsg = `${d.key}: text`; }
  const ct = couplingText(d);
  if (ct.length !== d.couplings.length) { tBad2++; tMsg = `${d.key}: couplings`; }
  for (const c of ct) if (!c.text.startsWith(COUPLINGS[c.key].name) || !/at (one vertex|\d+ vertices)$/.test(c.text)) { tBad2++; tMsg = `${d.key}: ${c.text}`; }
  if (d.key !== 'gun' && !ct.length) { tBad2++; tMsg = `${d.key}: no coupling`; }
}
ok(tBad2 === 0, `each diagram has a one-line description and names every coupling with its vertex count (${tBad2} bad${tMsg ? ': ' + tMsg : ''}; ${[...new Set(D.flatMap(d => d.couplings.map(c => c.name)))].join(', ')})`);

// ── detector objects: full events through the transport engine ──────────────
{
  const { createEngine } = await import('./transport.js');
  const { reconstruct } = await import('./reco.js');
  const { buildObjects } = await import('./picking.js');
  const ENG = createEngine({ maxSeg: 60000, segShowerMinE: 12 });
  const RUNS = [['pp', 13.6e6, 'zmm'], ['pp', 13.6e6, 'zee'], ['pp', 13.6e6, 'hgg'], ['pp', 13.6e6, 'h4l'], ['pp', 13.6e6, 'tt'], ['pp', 13.6e6, 'jj'], ['ee', 250000, 'hgg'], ['ee', 91190, 'zmm'], ['ee', 3e6, 'jj'], ['pp', 13.6e6, 'gun']];
  let nLines = 0, nHit = 0, cBad2 = 0, cMsg = '', kindBad = 0, kMsg = '';
  for (let r = 0; r < RUNS.length; r++) for (let s = 0; s < 2; s++) {
    const [beam, sqrtS, kind] = RUNS[r];
    const g = generate(kind, { beam, sqrtS, pileup: 0, particle: 'mu-', energy: 50000, eta: 0.3, phi: 0.6, count: 1 }, makeRng(4100 + 13 * r + s));
    const R = ENG.run(g.prims, 900 + r * 7 + s), O = reconstruct(R, g.info), objs = buildObjects(R, O, g.info);
    const d = diagramFor(g.info), keys = lineObjects(d, g.info, objs.objs);
    d.lines.forEach((L, i) => {
      if (L.ext !== 'out' || (L.hard == null && !L.isr)) { if (keys[i]) { kindBad++; kMsg = `${d.key}: inner line ${L.tex} has an object`; } return; }
      nLines++;
      const o = keys[i] && objs.byKey.get(keys[i]);
      if (!o) return;
      nHit++;
      const want = L.cls === 'jet' ? 'jet' : L.cls === 'nu' ? 'met' : 'track';
      if (o.kind !== want) { kindBad++; kMsg = `${d.key}: ${L.tex} -> ${o.kind}`; }
      const oc = o.kind === 'jet' ? colorOf('jet') : CLASS_COLOR[o.cls];
      if (oc !== L.color) { cBad2++; cMsg = `${d.key}: ${L.tex} ${L.color} vs ${o.key} ${oc}`; }
    });
    const used = keys.filter(k => k && objs.byKey.get(k).kind !== 'met');
    if (new Set(used).size !== used.length) { kindBad++; kMsg = `${d.key}: one object on two lines`; }
  }
  ok(kindBad === 0 && nHit >= 0.8 * nLines, `final-state lines find their detector objects in 20 transported events: ${nHit} of ${nLines} (leptons and photons a hard track, partons a jet, neutrinos the MET; ${kindBad} bad${kMsg ? ': ' + kMsg : ''})`);
  ok(cBad2 === 0, `each linked line has the colour of its detector object (${cBad2} bad${cMsg ? ': ' + cMsg : ''})`);
}

// ── the page: markup and phone rules (static text checks) ──────────────────
{
  const { readFileSync } = await import('fs');
  const rd = f => readFileSync(new URL(f, import.meta.url), 'utf8');
  const html = rd('./index.html'), css = rd('./style.css'), main = rd('./main.js');
  const checks = [
    ['the card is in the views', /<section class="view fy" data-v="feyn" id="feyn"/.test(html)],
    ['a phone tab for it', /<button data-v="feyn" type="button">Feynman<\/button>/.test(html)],
    ['lib/sci.css loads (STIX Two Text, Inter)', /href="\.\.\/\.\.\/lib\/sci\.css"/.test(html)],
    ['[hidden]{display:none!important}', css.includes('[hidden]{display:none!important}')],
    ['the phone list holds it', /phoneList = \(\) => [^\n]*'feyn'[^\n]*'feyn'/.test(main)],
    ['the saver hides it', /#gear,#feyn\{display:none!important\}/.test(main)],
    ['44 px fold button on touch', /\.fy-fold\{height:44px/.test(css)],
    ['the phone card has no fixed width', /#views \.view\.fy\{position:relative;top:auto;right:auto;width:auto/.test(css)],
    ['no horizontal scroll in the card', /\.fy-body\{[^}]*overflow-x:hidden/.test(css) && /\.fy-svg svg\{display:block;width:100%/.test(css)],
    ['labels through MathJax (sci-math loadMath), never KaTeX', /loadMath/.test(rd('./feynman-card.js')) && !/import[^\n]*katex|katex[^"'\s]*\.(js|css)/i.test(rd('./feynman-card.js') + html + main)],
  ];
  const miss = checks.filter(c => !c[1]).map(c => c[0]);
  ok(!miss.length, `page wiring: ${checks.length - miss.length} of ${checks.length} markup, phone and saver rules hold${miss.length ? ' (missing: ' + miss.join('; ') + ')' : ''}`);
}

// ── MathJax ─────────────────────────────────────────────────────────────────
if (process.env.FEYN_MATHJAX) {
  const { createRequire } = await import('module');
  const require = createRequire(process.env.FEYN_MATHJAX.replace(/\/?$/, '/') + 'x.js');
  const { mathjax } = require('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
  const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
  // the packages the page loads (lib/sci-math.js: base, ams and the rest of the default set, html, color)
  const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined', 'html', 'color'] }), OutputJax: new SVG({ fontCache: 'local' }) });
  const texs = new Set();
  for (const d of D) { for (const L of d.lines) if (L.label) texs.add(L.tex); for (const c of d.couplings) texs.add(c.tex); }
  const out = new Map(); let bad = [];
  for (const t of texs) {
    const s = adaptor.innerHTML(doc.convert(t, { display: false }));
    if (/merror|data-mjx-error|fill="red"/.test(s)) bad.push(t);
    out.set(t, s);
  }
  ok(bad.length === 0, `MathJax 3.2.2 typesets all ${texs.size} labels and coupling symbols with no error${bad.length ? ': ' + bad.join(' ') : ''} (${[...texs].slice(0, 14).join(' ')} ...)`);
  let mBad2 = 0, mMsg = '';
  for (const d of D) {
    toSVG(d, { tex: t => out.get(t) });
    const boxes = d.lines.filter(L => L.label).map(L => ({ L, ...L.label.box }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (ov(boxes[i], boxes[j])) { mBad2++; mMsg = `${d.key}: ${boxes[i].L.tex} / ${boxes[j].L.tex}`; }
  }
  ok(mBad2 === 0, `typeset label boxes do not overlap in any diagram (${mBad2} bad${mMsg ? ': ' + mMsg : ''})`);

  // the card itself in jsdom (when the same folder holds jsdom): MathJax
  // labels in the SVG, the lines grow with the event time, focus and pointer
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch (e) { JSDOM = null; }
  if (JSDOM) {
    const { readFileSync } = await import('fs');
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    const sec = /<section class="view fy"[\s\S]*?<\/section>/.exec(html)[0];
    const dom = new JSDOM(`<!DOCTYPE html><body>${sec}</body>`);
    globalThis.window = dom.window; globalThis.document = dom.window.document;
    // MathJax as the page has it (window.MathJax.tex2svgPromise), here from mathjax-full in node
    dom.window.MathJax = { tex2svgPromise: async t => { const c = dom.window.document.createElement('mjx-container'); c.innerHTML = adaptor.innerHTML(doc.convert(t, { display: false })); return c; } };
    const { createFeynCard } = await import('./feynman-card.js');
    const { createEngine } = await import('./transport.js');
    const { reconstruct } = await import('./reco.js');
    const { buildObjects } = await import('./picking.js');
    const root = dom.window.document.getElementById('feyn');
    root.querySelector('.fy-body').getClientRects = () => [{ width: 1 }];
    const hov = [], sel = [];
    const card = createFeynCard(root, { onHover: k => hov.push(k), onSelect: k => sel.push(k) });
    const msgs = [];
    for (const [beam, sqrtS, kind, seed] of [['pp', 13.6e6, 'zmm', 11], ['pp', 13.6e6, 'tt', 12], ['ee', 250000, 'h4l', 13]]) {
      const g = generate(kind, { beam, sqrtS, pileup: 0 }, makeRng(seed)), R = createEngine({ maxSeg: 60000, segShowerMinE: 12 }).run(g.prims, seed), O = reconstruct(R, g.info);
      const ev = { info: g.info, objs: buildObjects(R, O, g.info) };
      card.show(ev, -4);
      await new Promise(r => setTimeout(r, 30));
      const d = card.diagram, svg = root.querySelector('.fy-svg > svg');
      const nLab = d.lines.filter(L => L.label).length, nMJ = svg.querySelectorAll('g.fy-t > svg').length, nTxt = svg.querySelectorAll('text.fy-t').length;
      if (nMJ !== nLab || nTxt) msgs.push(`${d.key}: ${nMJ} MathJax labels of ${nLab}, ${nTxt} text`);
      const paths = () => [...svg.querySelectorAll('.fy-l')].map(p => p.getAttribute('d'));
      if (paths().some(x => x)) msgs.push(`${d.key}: lines drawn at t = -4`);
      card.setTime(0);
      const mid = paths().filter(x => x).length;
      card.setTime(10);
      if (paths().some(x => !x) || !(mid > 0 && mid < d.lines.length)) msgs.push(`${d.key}: drawn ${mid} at t = 0, ${paths().filter(x => x).length} at t = 10`);
      if ([...svg.querySelectorAll('.fy-a')].some(a => a.getAttribute('opacity') !== '1')) msgs.push(`${d.key}: arrows hidden at the end`);
      const cs = root.querySelectorAll('.fy-cpl .fy-sym svg').length;
      if (cs !== d.couplings.length) msgs.push(`${d.key}: ${cs} coupling symbols of ${d.couplings.length}`);
      if (!root.querySelector('.fy-text').textContent.endsWith('.')) msgs.push(`${d.key}: no description`);
      // pointer and focus on the first linked line
      const hit = svg.querySelector('.fy-hit');
      if (!hit) { msgs.push(`${d.key}: no linked line`); continue; }
      const k = card.keys[+hit.dataset.i];
      hit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      if (sel[sel.length - 1] !== k) msgs.push(`${d.key}: click gave ${sel[sel.length - 1]}`);
      card.focus(k);
      const on = svg.querySelectorAll('.fy-l.on').length;
      if (!svg.classList.contains('has-focus') || on < 1) msgs.push(`${d.key}: focus shows ${on} lines`);
      card.focus(null);
      if (svg.classList.contains('has-focus')) msgs.push(`${d.key}: focus not cleared`);
    }
    ok(!msgs.length, `the card in jsdom: MathJax SVG labels and coupling symbols, lines grow from none at -4 ns to all at 10 ns, a click selects the linked object, focus brightens its line (3 events${msgs.length ? '; ' + msgs.join('; ') : ''})`);
  } else console.log('skip the jsdom card check (no jsdom in FEYN_MATHJAX)');
} else console.log('skip MathJax checks (set FEYN_MATHJAX to a folder with node_modules/mathjax-full)');

console.log(`\n${n - fail} of ${n} checks passed`);
process.exitCode = fail;

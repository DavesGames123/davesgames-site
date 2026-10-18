// ============================================================================
//  PARTICLE COLLIDER  ·  feynman.js — the Feynman diagram of each event
// ----------------------------------------------------------------------------
//  No DOM. diagramFor(info) reads the generator info (generators.js: kind,
//  beam, hard list, truth) and gives the leading-order Feynman diagram of
//  the hard process of that event. The page (main.js) draws it with
//  toSVG() and grows the lines in time order with frontAt() and
//  partialPath(). node feynman-tests.mjs checks every diagram.
//
//  CONVENTIONS
//    time runs left to right. Fermions are straight lines with an arrow
//    along the fermion flow (an antifermion that moves forward in time
//    has its arrow backward). Photons and W and Z bosons are wavy lines,
//    gluons are curly lines, the Higgs boson is a dashed line. A gun
//    hadron is a plain thick line. Each line has a TeX label.
//
//  DIAGRAM  { key, title, text, note, nodes, lines, couplings }
//    node  { id, x, y, cpl }  cpl: a key of COUPLINGS (a vertex), or null
//          (the free end of an external line)
//    line  { a, b, p, tex, cls, color, ext ('in' | 'out' | ''), loop,
//            hard, col [colour, anticolour], kind, pts, arrow, label }
//          the particle p travels from node a to node b. hard: the index
//          of the line in info.hard (the detector object of the line).
//          cls: the display class of particles.js (the track colour);
//          'jet' for a quark or a gluon in the final state.
//
//  TOPOLOGIES (grep -n 'function top')
//    topS ....... s channel: two in, one propagator, two out (Drell-Yan,
//                 e+e- -> Z, e+e- -> q qbar), an ISR photon when the
//                 event has one
//    topTT ...... s channel to t tbar, then t -> W b and W -> two fermions
//    topGGH ..... gluon fusion through a top loop, H -> gamma gamma
//                 through a W loop or H -> Z Z* -> 4 leptons
//    topZH ...... e+e- -> Z* -> Z H (Higgsstrahlung), Z -> nu nubar
//    topT ....... t channel: one gluon exchange (dijets, soft collisions)
//    topGun ..... one particle, no vertex
//  TIME (grep -n 'export function frontAt')
//    the drawing front moves from the left edge to the first vertex as
//    the beams come in (t = -4 to 0 ns), then to the right edge by
//    t = 4 ns, near when the products reach the calorimeters.
//  SVG (grep -n 'export function toSVG')
//    explicit stroke and fill attributes (no stylesheet needed). A label
//    is a MathJax SVG string from opts.tex(tex), sized from its viewBox,
//    or a <text> fallback.
//  PAGE (grep -n 'export function drawState')  feynman-card.js reads:
//    drawState(d, X) ....... per line its path, arrow and label at front X
//    couplingText(d) ....... the couplings in words, with the vertex count
//    lineObjects(d, info, objs)  the detector object key of each
//                            final-state line (picking.js), or null
// ============================================================================
import { CLASS_COLOR, PART } from './particles.js';

export const JET_COLOR = '#ffd45c';
export const BEAM_COLOR = '#7fd6ff';
export const INNER_COLOR = '#a7b0c6';

// q: charge in thirds of e. B: baryon number in thirds. L: lepton numbers.
// col: 3 a quark, -3 an antiquark, 8 a gluon. kind: the line style.
const F = (tex, uni, kind, o = {}) => ({ tex, uni, kind, q: 0, B: 0, L: {}, col: 0, anti: false, ...o });
export const FP = {
  u: F('u', 'u', 'fermion', { q: 2, B: 1, col: 3 }),
  ub: F('\\bar{u}', 'ū', 'fermion', { q: -2, B: -1, col: -3, anti: true }),
  d: F('d', 'd', 'fermion', { q: -1, B: 1, col: 3 }),
  db: F('\\bar{d}', 'd̄', 'fermion', { q: 1, B: -1, col: -3, anti: true }),
  b: F('b', 'b', 'fermion', { q: -1, B: 1, col: 3 }),
  bb: F('\\bar{b}', 'b̄', 'fermion', { q: 1, B: -1, col: -3, anti: true }),
  t: F('t', 't', 'fermion', { q: 2, B: 1, col: 3 }),
  tb: F('\\bar{t}', 't̄', 'fermion', { q: -2, B: -1, col: -3, anti: true }),
  g: F('g', 'g', 'gluon', { col: 8 }),
  gamma: F('\\gamma', 'γ', 'photon'),
  Z: F('Z', 'Z', 'boson'),
  Zs: F('Z^{*}', 'Z*', 'boson'),
  gZ: F('\\gamma^{*}/Z', 'γ*/Z', 'boson'),
  Wp: F('W^{+}', 'W⁺', 'boson', { q: 3 }),
  Wm: F('W^{-}', 'W⁻', 'boson', { q: -3 }),
  H: F('H', 'H', 'scalar'),
  'e-': F('e^{-}', 'e⁻', 'fermion', { q: -3, L: { e: 1 } }),
  'e+': F('e^{+}', 'e⁺', 'fermion', { q: 3, L: { e: -1 }, anti: true }),
  'mu-': F('\\mu^{-}', 'μ⁻', 'fermion', { q: -3, L: { mu: 1 } }),
  'mu+': F('\\mu^{+}', 'μ⁺', 'fermion', { q: 3, L: { mu: -1 }, anti: true }),
  ne: F('\\nu_{e}', 'νe', 'fermion', { L: { e: 1 } }),
  neb: F('\\bar{\\nu}_{e}', 'ν̄e', 'fermion', { L: { e: -1 }, anti: true }),
  nm: F('\\nu_{\\mu}', 'νμ', 'fermion', { L: { mu: 1 } }),
  nmb: F('\\bar{\\nu}_{\\mu}', 'ν̄μ', 'fermion', { L: { mu: -1 }, anti: true }),
  // Z -> nu nubar: any of the three flavours, one flavour per pair
  nx: F('\\nu', 'ν', 'fermion', { L: { x: 1 } }),
  nxb: F('\\bar{\\nu}', 'ν̄', 'fermion', { L: { x: -1 }, anti: true }),
};
// gun particles (hadrons are composite: a plain line, no arrow)
const GUN_TEX = { 'pi+': '\\pi^{+}', 'pi-': '\\pi^{-}', 'K+': 'K^{+}', 'K-': 'K^{-}', p: 'p', n: 'n', K0S: 'K^{0}_{S}', K0L: 'K^{0}_{L}', B: 'B^{0}' };

// vertex couplings: TeX symbol and plain name
export const COUPLINGS = {
  qcd: { tex: 'g_{s}', name: 'strong' },
  qed: { tex: 'e', name: 'electromagnetic' },
  ew: { tex: 'e,\\ g_{Z}', name: 'photon or Z' },
  nc: { tex: 'g_{Z}', name: 'weak neutral current' },
  cc: { tex: 'g_{W}', name: 'weak charged current' },
  yuk: { tex: 'y_{t}', name: 'top Yukawa' },
  hww: { tex: 'g\\,m_{W}', name: 'Higgs and W' },
  hzz: { tex: 'g_{Z}\\,m_{Z}', name: 'Higgs and Z' },
};

// the display class (track colour) of a final-state particle
function clsOf(p, gunName) {
  if (gunName) return (PART[gunName] && PART[gunName].cls) || 'had';
  if (p === 'e-' || p === 'e+') return 'e';
  if (p === 'mu-' || p === 'mu+') return 'mu';
  if (p === 'gamma') return 'gamma';
  if (p[0] === 'n' && FP[p] && FP[p].kind === 'fermion') return 'nu';
  return 'jet';
}
export const colorOf = cls => cls === 'jet' ? JET_COLOR : cls === 'beam' ? BEAM_COLOR : cls === 'inner' ? INNER_COLOR : (CLASS_COLOR[cls] || INNER_COLOR);

// ── a small builder ──────────────────────────────────────────────────────────
function builder() {
  const nodes = [], lines = [];
  const N = {};
  const node = (id, x, y, cpl = null) => { const n = { id, x, y, cpl }; nodes.push(n); N[id] = n; return n; };
  // o: { tex, col, loop, hard, side, label (false: no label), gun }
  const line = (a, b, p, o = {}) => { const L = { a, b, p, ...o }; lines.push(L); return L; };
  return { nodes, lines, N, node, line };
}
const ANTI = { u: 'ub', ub: 'u', d: 'db', db: 'd', b: 'bb', bb: 'b', t: 'tb', tb: 't', 'e-': 'e+', 'e+': 'e-', 'mu-': 'mu+', 'mu+': 'mu-' };
const beamLeptons = beam => beam === 'mumu' ? ['mu-', 'mu+'] : ['e-', 'e+'];
const flavOf = name => name === 'g' ? 'g' : name === 'b' ? 'b' : 'u';

// ── topologies ───────────────────────────────────────────────────────────────
// s channel: in1 in2 -> prop -> out1 out2. inn = [p, p] (in2 is the
// antiparticle), out = [p, p, hard index, hard index]. cpl1, cpl2: the
// vertex couplings. isr: an ISR photon off the upper incoming line.
function topS(B, inn, prop, out, cpl1, cpl2, o = {}) {
  const { node, line } = B;
  node('i1', 0, 10); node('i2', 0, 190); node('v1', 95, 100, cpl1); node('v2', 205, 100, cpl2); node('o1', 300, 10); node('o2', 300, 190);
  const ci = o.colIn || [[0, 0], [0, 0]], co = o.colOut || [[0, 0], [0, 0]];
  if (o.isr) {
    node('vi', 43, 51, 'qed').isr = true; node('oi', 128, 0);
    line('i1', 'vi', inn[0], { col: ci[0], tex: QTEX[inn[0]] }); line('vi', 'v1', inn[0], { col: ci[0], label: false, cls: 'beam' });
    line('vi', 'oi', 'gamma', { hard: null, isr: true });
  } else line('i1', 'v1', inn[0], { col: ci[0], tex: QTEX[inn[0]] });
  line('i2', 'v1', inn[1], { col: ci[1], tex: QTEX[inn[1]] });
  line('v1', 'v2', prop, { col: o.colProp || [0, 0], side: -1 });
  line('v2', 'o1', out[0], { hard: out[2], col: co[0] });
  line('v2', 'o2', out[1], { hard: out[3], col: co[1] });
}

// t tbar. prod: 'gg' | 'qq' | 'll' (beam leptons). W decays from the hard
// list: per top, the hard entries b, then (lepton, nu) or (q, q).
function topTT(B, prod, info) {
  const { node, line } = B, hard = info.hard;
  const vcpl = prod === 'll' ? 'ew' : 'qcd';
  node('i1', 0, 20); node('i2', 0, 220); node('v1', 85, 120, vcpl); node('v2', 165, 120, prod === 'll' ? 'ew' : 'qcd');
  let colT = [1, 0], colTb = [0, 1];
  if (prod === 'gg') {
    line('i1', 'v1', 'g', { col: [1, 2] }); line('i2', 'v1', 'g', { col: [2, 3] });
    line('v1', 'v2', 'g', { col: [1, 3], side: -1 }); colTb = [0, 3];
  } else if (prod === 'qq') {
    line('i1', 'v1', 'u', { col: [1, 0], tex: 'q' }); line('i2', 'v1', 'ub', { col: [0, 2], tex: '\\bar{q}' });
    line('v1', 'v2', 'g', { col: [1, 2], side: -1 }); colTb = [0, 2];
  } else {
    const [lm, lp] = beamLeptons(info.beam);
    line('i1', 'v1', lm); line('i2', 'v1', lp);
    line('v1', 'v2', 'gZ', { side: -1 });
  }
  node('ta', 240, 60, 'cc'); node('tb', 240, 180, 'cc');
  line('v2', 'ta', 't', { col: colT }); line('v2', 'tb', 'tb', { col: colTb, side: 1 });
  // the hard list: [b, f, f] for the top, then [b, f, f] for the antitop
  const tops = [];
  for (let i = 0; i + 2 < hard.length; i += 3) tops.push([i, hard[i + 1][0], hard[i + 2][0]]);
  while (tops.length < 2) tops.push([null, 'q', 'q']);
  const ys = [[5, 52, 99], [235, 141, 188]], next = { c: 4 };
  [['ta', 'Wp', 'b', colT, 'wa', 76], ['tb', 'Wm', 'bb', colTb, 'wb', 164]].forEach(([vt, W, bq, cb, vw, yw], k) => {
    const [h, f1, f2] = tops[k], Y = ys[k];
    node('ob' + k, 420, Y[0]); line(vt, 'ob' + k, bq, { col: cb, hard: h });
    node(vw, 325, yw, 'cc'); line(vt, vw, W, { side: k ? -1 : 1 });
    node('of' + k, 420, Y[k ? 2 : 1]); node('og' + k, 420, Y[k ? 1 : 2]);
    // W+ -> l+ nu or u dbar; W- -> l- nubar or d ubar
    let a, b;
    if (f1 === 'q') { a = W === 'Wp' ? 'u' : 'd'; b = W === 'Wp' ? 'db' : 'ub'; }
    else { a = W === 'Wp' ? (f1 === 'e+' ? 'ne' : 'nm') : f1; b = W === 'Wp' ? f1 : (f1 === 'e-' ? 'neb' : 'nmb'); }
    const c = next.c++;
    const isQ = f1 === 'q';
    // hard index: the lepton is hard[h+1], the neutrino hard[h+2]; quarks in order
    const ha = h == null ? null : (isQ ? h + 1 : (FP[a].L.e || FP[a].L.mu) && !['e-', 'e+', 'mu-', 'mu+'].includes(a) ? h + 2 : h + 1);
    const hb = h == null ? null : (isQ ? h + 2 : ['e-', 'e+', 'mu-', 'mu+'].includes(b) ? h + 1 : h + 2);
    line(vw, 'of' + k, a, { hard: ha, col: isQ ? [c, 0] : [0, 0], tex: isQ ? (W === 'Wp' ? 'q' : "q'") : undefined });
    line(vw, 'og' + k, b, { hard: hb, col: isQ ? [0, c] : [0, 0], tex: isQ ? (W === 'Wp' ? "\\bar{q}'" : '\\bar{q}') : undefined });
  });
  return tops;
}

// gluon fusion through a top loop; the Higgs at node 'hd' (x = 200)
function topGGH(B) {
  const { node, line } = B;
  node('i1', 0, 15); node('i2', 0, 205);
  node('ta', 70, 55, 'qcd'); node('tb', 70, 165, 'qcd'); node('tc', 125, 110, 'yuk');
  line('i1', 'ta', 'g', { col: [1, 2] }); line('i2', 'tb', 'g', { col: [2, 1] });
  line('tb', 'ta', 't', { col: [2, 0], loop: true, label: false });
  line('ta', 'tc', 't', { col: [1, 0], loop: true, side: -1 });
  line('tc', 'tb', 't', { col: [1, 0], loop: true, label: false });
}
// H -> gamma gamma through a W loop, from node h at (x, y)
function hGG(B, h, x, y, hard, sc = 1) {
  const { node, line } = B;
  const wa = h + 'a', wb = h + 'b';
  node(wa, x + 55 * sc, y - 50 * sc, 'qed'); node(wb, x + 55 * sc, y + 50 * sc, 'qed');
  line(h, wa, 'Wp', { loop: true, side: -1, tex: 'W' }); line(wa, wb, 'Wp', { loop: true, label: false }); line(wb, h, 'Wp', { loop: true, label: false });
  node(h + 'o1', x + 140 * sc, y - 95 * sc); node(h + 'o2', x + 140 * sc, y + 95 * sc);
  line(wa, h + 'o1', 'gamma', { hard: hard[0] }); line(wb, h + 'o2', 'gamma', { hard: hard[1] });
}
// H -> Z Z* -> four leptons, from node h at (x, y); names from the hard list
function hZZ(B, h, x, y, names, hard, dy = [40, 25]) {
  const { node, line } = B;
  node(h + 'z1', x + 70, y - 50, 'nc'); node(h + 'z2', x + 70, y + 50, 'nc');
  line(h, h + 'z1', 'Z', { side: -1 }); line(h, h + 'z2', 'Zs', { side: 1 });
  const ys = [y - 50 - dy[0], y - 50 + dy[1], y + 50 - dy[1], y + 50 + dy[0]];
  for (let k = 0; k < 4; k++) {
    node(h + 'l' + k, x + 150, ys[k]);
    line(h + (k < 2 ? 'z1' : 'z2'), h + 'l' + k, names[k], { hard: hard[k] });
  }
}
// e+e- -> Z* -> Z H, Z -> nu nubar; the Higgs at 'hd' (225, 65)
function topZH(B, beam) {
  const { node, line } = B, [lm, lp] = beamLeptons(beam);
  node('i1', 0, 20); node('i2', 0, 220); node('v1', 75, 120, 'nc'); node('v2', 160, 120, 'hzz');
  line('i1', 'v1', lm); line('i2', 'v1', lp); line('v1', 'v2', 'Zs', { side: -1 });
  node('hd', 225, 65, null); line('v2', 'hd', 'H', { side: -1 });
  node('zd', 225, 185, 'nc'); line('v2', 'zd', 'Z', { side: 1 });
}
// t channel: one gluon exchanged between p1 -> p3 (top) and p2 -> p4 (bottom)
function topT(B, f1, f2, hard = [null, null]) {
  const { node, line } = B;
  node('i1', 0, 10); node('i2', 0, 190); node('va', 110, 45, 'qcd'); node('vb', 110, 155, 'qcd'); node('o1', 220, 10); node('o2', 220, 190);
  // colour flow: a quark line keeps its colour index through a gluon vertex
  // only when the exchange carries it away and back (the indices swap)
  const top = f1 === 'g' ? { in: [1, 2], out: [3, 2], ex: [1, 3] } : { in: [1, 0], out: [2, 0], ex: [1, 2] };
  const ex = top.ex;
  // bottom: in carries (x, y), out (x', y') with ex = (c, a) flowing in
  let bin, bout;
  if (f2 === 'g') { bin = [4, ex[0]]; bout = [4, ex[1]]; }
  else { bin = [ex[1], 0]; bout = [ex[0], 0]; }
  const P = f => f === 'g' ? 'g' : f === 'b' ? 'b' : 'u';
  const q2 = f2 === 'g' ? 'g' : f2 === 'b' ? 'b' : 'd';
  line('i1', 'va', P(f1), { col: top.in, tex: f1 === 'q' ? 'q' : undefined });
  line('va', 'o1', P(f1), { col: top.out, hard: hard[0], tex: f1 === 'q' ? 'q' : undefined });
  line('va', 'vb', 'g', { col: ex, side: 1, spacelike: true });
  line('i2', 'vb', q2, { col: bin, tex: f2 === 'q' ? "q'" : undefined });
  line('vb', 'o2', q2, { col: bout, hard: hard[1], tex: f2 === 'q' ? "q'" : undefined });
}
function topGun(B, name, hard) {
  const { node, line } = B;
  node('src', 0, 60); node('o1', 220, 60);
  const p = FP[name] ? name : 'gun:' + name;
  line('src', 'o1', p, { hard, gun: FP[name] ? null : name, tex: FP[name] ? undefined : (GUN_TEX[name] || name) });
}

// ── the diagram of one event ────────────────────────────────────────────────
const QQBAR_IN = [['u', 'ub'], [[1, 0], [0, 1]]];
const QTEX = { u: 'q', ub: '\\bar{q}' };
const LEP_TEXT = { 'mu-': 'a muon and an antimuon', 'e-': 'an electron and a positron' };
export function diagramFor(info = {}) {
  const kind = info.kind || 'gun', beam = info.beam || 'pp', hard = info.hard || [], tr = info.truth || {};
  const lepBeam = beam === 'ee' || beam === 'mumu', ion = beam === 'PbPb';
  const B = builder();
  const beamWord = beam === 'mumu' ? 'muon and antimuon' : 'electron and positron';
  const hn = i => hard[i] && hard[i][0];
  const L4 = ['mu-', 'mu+', 'e-', 'e+'], l4 = [0, 1, 2, 3].map(i => hn(i) || L4[i]);
  let key, title, text, note = '';
  if (ion || (kind === 'mb' && !lepBeam) || (kind === 'mb')) {
    topT(B, 'g', 'g');
    key = ion ? 'PbPb-soft' : 'soft'; title = 'gg → gg (a soft collision)';
    text = ion
      ? 'Many nucleon pairs of the two lead nuclei collide at once; each pair trades gluons at low momentum transfer.'
      : 'A soft collision: the protons trade a gluon at low momentum transfer and break up into many soft hadrons.';
    note = 'At this low momentum transfer the coupling is large, so one diagram is only a sketch of the process.';
  } else if (kind === 'gun') {
    const name = hn(0) || (tr.particle) || 'e-';
    topGun(B, name, hard.length ? 0 : null);
    key = 'gun'; title = 'One particle, no collision';
    text = 'A particle gun fires one particle from the origin. There is no collision, so the diagram has no vertex.';
  } else if (kind === 'zmm' || kind === 'zee') {
    const fl = kind === 'zmm' ? ['mu-', 'mu+'] : ['e-', 'e+'];
    if (lepBeam) {
      const [lm, lp] = beamLeptons(beam), isr = !!tr.isr;
      topS(B, [lm, lp], 'Z', [fl[0], fl[1], 0, 1], 'nc', 'nc', { isr });
      key = `${beam}-z-${kind}${isr ? '-isr' : ''}`; title = `${FP[lm].uni}${FP[lp].uni} → Z → ${FP[fl[0]].uni}${FP[fl[1]].uni}`;
      text = `The ${beamWord} annihilate into a Z boson, which decays to ${LEP_TEXT[fl[0]]}.` + (isr ? ' The beam particle first radiates a photon, so the pair forms below the beam energy.' : '');
      if (kind === 'zee' && beam === 'ee') note = 'Photon exchange in the t channel (Bhabha scattering) also makes e⁺e⁻; the generator makes the Z only.';
    } else {
      topS(B, QQBAR_IN[0], 'Z', [fl[0], fl[1], 0, 1], 'nc', 'nc', { colIn: QQBAR_IN[1] });
      key = `dy-${kind}`; title = `q q̄ → Z → ${FP[fl[0]].uni}${FP[fl[1]].uni}`;
      text = `A quark and an antiquark from the two ${beam === 'ppbar' ? 'beams' : 'protons'} annihilate into a Z boson, which decays to ${LEP_TEXT[fl[0]]} (Drell-Yan).`;
      note = 'A virtual photon in place of the Z gives the same final state; near the Z mass the Z dominates.';
    }
  } else if ((kind === 'hgg' || kind === 'h4l') && lepBeam) {
    topZH(B, beam);
    const nu = hard.length - 2;
    B.node('zn1', 370, 195); B.node('zn2', 370, 245);
    B.line('zd', 'zn1', 'nx', { hard: nu }); B.line('zd', 'zn2', 'nxb', { hard: nu + 1 });
    if (kind === 'hgg') { B.N.hd.cpl = 'hww'; hGG(B, 'hd', 225, 65, [0, 1], 0.95); }
    else { B.N.hd.cpl = 'hzz'; hZZ(B, 'hd', 225, 65, l4, [0, 1, 2, 3], [40, 18]); }
    key = `${beam}-zh-${kind}`; title = kind === 'hgg' ? 'Z H, Z → νν̄, H → γγ' : 'Z H, Z → νν̄, H → Z Z* → 4ℓ';
    text = `The ${beamWord} make a virtual Z that radiates a Higgs boson. The Z decays to two neutrinos (missing energy), the Higgs ${kind === 'hgg' ? 'to two photons through a W loop' : 'to a Z and a virtual Z, and these to four leptons'}.`;
  } else if (kind === 'hgg' || kind === 'h4l') {
    topGGH(B);
    B.node('hd', 200, 110, kind === 'hgg' ? 'hww' : 'hzz'); B.line('tc', 'hd', 'H', { side: -1 });
    if (kind === 'hgg') hGG(B, 'hd', 200, 110, [0, 1]);
    else hZZ(B, 'hd', 200, 110, l4, [0, 1, 2, 3]);
    key = `ggf-${kind}`; title = kind === 'hgg' ? 'gg → H → γγ' : 'gg → H → Z Z* → 4ℓ';
    text = `Two gluons fuse through a top-quark loop into a Higgs boson, which decays ${kind === 'hgg' ? 'to two photons through a W-boson loop' : `to a Z and a virtual Z, and these to four leptons (${tr.channel || '4ℓ'})`}.`;
    if (kind === 'hgg') note = 'A top-quark loop also gives H → γγ; the W loop is the larger part.';
  } else if (kind === 'tt') {
    const prod = lepBeam ? 'll' : beam === 'ppbar' ? 'qq' : 'gg';
    topTT(B, prod, info);
    const ch = tr.channel || '';
    key = `tt-${prod === 'll' ? beam : prod}-${ch.replace(/\W+/g, '')}`; title = `${prod === 'gg' ? 'gg' : prod === 'qq' ? 'q q̄' : (beam === 'mumu' ? 'μ⁻μ⁺' : 'e⁻e⁺')} → t t̄ → W⁺b W⁻b̄`;
    const from = prod === 'gg' ? 'Two gluons fuse into a virtual gluon' : prod === 'qq' ? 'A quark and an antiquark annihilate into a virtual gluon' : `The ${beamWord} annihilate into a virtual photon or Z`;
    text = `${from} that makes a top and an antitop quark. Each top decays to a W boson and a b quark${ch ? `; here the W bosons give the ${ch} channel` : ''}.`;
    if (prod === 'gg') note = 'Two more diagrams swap a top quark between the two gluons (t and u channels).';
  } else {
    // kind 'jj' (and any other hard process): two partons
    const f1 = hn(0) || 'g', f2 = hn(1) || 'g';
    if (lepBeam) {
      const [lm, lp] = beamLeptons(beam), q = f1 === 'b' ? 'b' : 'u';
      topS(B, [lm, lp], 'gZ', [q, ANTI[q], 0, 1], 'ew', 'ew', { colOut: [[1, 0], [0, 1]] });
      if (q === 'u') { B.lines[B.lines.length - 2].tex = 'q'; B.lines[B.lines.length - 1].tex = '\\bar{q}'; }
      key = `${beam}-qq-${q}`; title = `${beam === 'mumu' ? 'μ⁻μ⁺' : 'e⁻e⁺'} → γ*/Z → ${q === 'b' ? 'b b̄' : 'q q̄'}`;
      text = `The ${beamWord} annihilate into a virtual photon or Z, which makes a ${q === 'b' ? 'b quark' : 'quark'} and its antiquark; each becomes a jet.`;
    } else {
      topT(B, flavOf(f1) === 'u' ? 'q' : flavOf(f1), flavOf(f2) === 'u' ? 'q' : flavOf(f2), [0, 1]);
      const w = f => f === 'g' ? 'g' : f === 'b' ? 'b' : 'q';
      key = `jj-${w(f1)}${w(f2)}`; title = `${w(f1)}${w(f2) === 'q' && w(f1) === 'q' ? "q'" : w(f2)} → ${w(f1)}${w(f2) === 'q' && w(f1) === 'q' ? "q'" : w(f2)} (one gluon exchanged)`;
      const nm = f => f === 'g' ? 'a gluon' : f === 'b' ? 'a b quark' : 'a quark';
      text = `${nm(f1)[0].toUpperCase()}${nm(f1).slice(1)} and ${nm(f2)} from the two protons scatter by the exchange of a gluon; each outgoing parton becomes a jet.`;
      note = 'The t-channel exchange is the largest of the leading-order diagrams for dijets.';
    }
  }
  for (const L of B.lines) if (L.hard != null && !(L.hard >= 0 && L.hard < hard.length)) L.hard = null;
  return finish(B, { key, title, text, note, kind, beam });
}

// ── geometry, labels, couplings ─────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
function wavy(A, Bp, amp = 4.2, wl = 11) {
  const d = sub(Bp, A), L = len(d), u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
  const k = Math.max(2, Math.round(L / wl)), M = k * 12, pts = [];
  for (let i = 0; i <= M; i++) { const s = i / M, o = amp * Math.sin(2 * Math.PI * k * s); pts.push([A[0] + d[0] * s + n[0] * o, A[1] + d[1] * s + n[1] * o]); }
  return pts;
}
function curly(A, Bp) {
  const d = sub(Bp, A), L = len(d), u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
  const N = Math.max(3, Math.round(L / 8.5)), c = L / (2 * Math.PI * N), r = 3.1, pts = [];
  // a prolate cycloid about the line: r > c gives the loops
  const M = N * 16;
  for (let i = 0; i <= M; i++) {
    const th = 2 * Math.PI * N * i / M, al = c * th - r * Math.sin(th) * (i === 0 || i === M ? 0 : 1), pe = r * (1 - Math.cos(th)) - r;
    const w = Math.min(1, i / 8, (M - i) / 8);   // ease the ends onto the line
    pts.push([A[0] + u[0] * al + n[0] * pe * w, A[1] + u[1] * al + n[1] * pe * w]);
  }
  return pts;
}
export function lineKind(p) { return p.startsWith('gun:') ? 'hadron' : FP[p].kind; }
// approximate label box (the page measures MathJax; the tests use this)
export function labelBox(tex, fontPx = 15) {
  const plain = tex.replace(/\\(bar|nu|mu|gamma|pi|ell)/g, (m, w) => w === 'bar' ? '' : 'x').replace(/\\[a-z]+/g, '').replace(/[{}^_\\,]/g, '').replace(/\s+/g, '');
  const scripts = (tex.match(/[\^_]/g) || []).length;
  return { w: fontPx * (0.62 * Math.max(1, plain.length - scripts) + 0.45 * scripts) + 2, h: fontPx * 1.15 };
}
function finish(B, meta) {
  const { nodes, lines, N } = B;
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length, cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  lines.forEach((L, i) => {
    L.i = i;
    const A = N[L.a], Bn = N[L.b];
    L.ext = A.cpl === null && L.a !== 'hd' ? 'in' : Bn.cpl === null ? 'out' : '';
    if (L.a === 'src') L.ext = 'out';
    L.kind = lineKind(L.p);
    const P = FP[L.p];
    if (L.tex === undefined) L.tex = P ? P.tex : L.p;
    L.uni = P ? P.uni : L.tex;
    L.cls = L.cls || (L.ext === 'out' ? clsOf(L.p, L.gun) : L.ext === 'in' ? 'beam' : 'inner');
    L.color = colorOf(L.cls);
    if (L.col === undefined) L.col = [0, 0];
    if (L.hard === undefined) L.hard = null;
    // draw from the left end (time runs left to right)
    const left = A.x < Bn.x - 1e-6 || (Math.abs(A.x - Bn.x) < 1e-6 && A.y <= Bn.y);
    const P0 = left ? [A.x, A.y] : [Bn.x, Bn.y], P1 = left ? [Bn.x, Bn.y] : [A.x, A.y];
    L.pts = L.kind === 'photon' || L.kind === 'boson' ? wavy(P0, P1, L.kind === 'boson' ? 4.6 : 4.0, L.kind === 'boson' ? 13 : 10) : L.kind === 'gluon' ? curly(P0, P1) : [P0, P1];
    L.x0 = Math.min(A.x, Bn.x); L.x1 = Math.max(A.x, Bn.x);
    // the arrow: at the middle, along the fermion flow
    const d = sub([Bn.x, Bn.y], [A.x, A.y]), dl = len(d), u = [d[0] / dl, d[1] / dl];
    if (L.kind === 'fermion') {
      const s = P && P.anti ? -1 : 1, m = [(A.x + Bn.x) / 2, (A.y + Bn.y) / 2];
      L.arrow = { x: m[0], y: m[1], dx: u[0] * s, dy: u[1] * s };
    } else L.arrow = null;
    // the label: past the free end of an external line, else beside the middle
    if (L.label === false) L.label = null;
    else {
      const bx = labelBox(L.tex), gap = 8;
      let x, y;
      if (L.ext === 'in') { x = A.x - gap - bx.w / 2; y = A.y; }
      else if (L.ext === 'out') { x = Bn.x + gap + bx.w / 2; y = Bn.y; }
      else {
        // n: the unit normal on the upper side (the left side of a vertical line)
        let n = [-u[1], u[0]];
        if (n[1] > 1e-6 || (Math.abs(n[1]) < 1e-6 && n[0] > 0)) n = [-n[0], -n[1]];
        const m = [(A.x + Bn.x) / 2, (A.y + Bn.y) / 2];
        // side -1: the upper (or left) side; no side: away from the centre
        const side = L.side || ((n[0] * (m[0] - cx) + n[1] * (m[1] - cy)) >= 0 ? -1 : 1);
        const off = (L.kind === 'gluon' || L.kind === 'boson' || L.kind === 'photon' ? 10 : 6) + Math.abs(n[0]) * bx.w / 2 + Math.abs(n[1]) * bx.h / 2;
        const sg = side < 0 ? 1 : -1;
        x = m[0] + n[0] * off * sg; y = m[1] + n[1] * off * sg;
      }
      L.label = { x, y, w: bx.w, h: bx.h };
    }
  });
  // couplings: per vertex, counted
  const count = {};
  for (const n of nodes) if (n.cpl) count[n.cpl] = (count[n.cpl] || 0) + 1;
  const couplings = Object.keys(COUPLINGS).filter(k => count[k]).map(k => ({ key: k, n: count[k], ...COUPLINGS[k] }));
  return { ...meta, nodes, lines, couplings };
}

// ── time ─────────────────────────────────────────────────────────────────────
export const T_IN = 4, T_OUT = 4;   // ns: beams in (t < 0), products out
export function extent(d) {
  const xs = d.nodes.map(n => n.x), xv = d.nodes.filter(n => n.cpl && !n.isr).map(n => n.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  return { x0, x1, xv: xv.length ? Math.min(...xv) : x0 };
}
// the drawing front (diagram x) at event time t (ns). xv: the first vertex
// of the hard process (an ISR vertex comes before it, at t < 0)
export function frontAt(d, t) {
  const { x0, x1, xv } = extent(d);
  if (!isFinite(t)) return t > 0 ? x1 + 1 : x0 - 1;
  if (t < 0) return x0 + (xv - x0) * Math.max(0, (t + T_IN) / T_IN) - (t <= -T_IN ? 1 : 0);
  return xv + (x1 + 1 - xv) * Math.min(1, t / T_OUT);
}
export function lineFrac(L, X) {
  if (L.x1 - L.x0 < 1e-6) return X >= L.x0 ? 1 : 0;
  return Math.max(0, Math.min(1, (X - L.x0) / (L.x1 - L.x0)));
}
const f1 = v => (Math.round(v * 10) / 10).toString();
// the path of the first fraction f of a line (by length)
export function partialPath(L, f = 1) {
  const P = L.pts;
  if (f <= 0) return '';
  if (f >= 1) return 'M' + P.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L');
  let tot = 0; const seg = [];
  for (let i = 1; i < P.length; i++) { const s = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); seg.push(s); tot += s; }
  let want = tot * f, out = [P[0]];
  for (let i = 1; i < P.length; i++) {
    if (want >= seg[i - 1]) { out.push(P[i]); want -= seg[i - 1]; continue; }
    const k = want / seg[i - 1]; out.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k]); break;
  }
  return 'M' + out.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L');
}
export function arrowPath(a, s = 4.6) {
  const n = [-a.dy, a.dx], tip = [a.x + a.dx * s, a.y + a.dy * s], b0 = [a.x - a.dx * s + n[0] * s * 0.82, a.y - a.dy * s + n[1] * s * 0.82], b1 = [a.x - a.dx * s - n[0] * s * 0.82, a.y - a.dy * s - n[1] * s * 0.82];
  return `M${f1(tip[0])} ${f1(tip[1])}L${f1(b0[0])} ${f1(b0[1])}L${f1(b1[0])} ${f1(b1[1])}Z`;
}

// ── SVG ──────────────────────────────────────────────────────────────────────
// A MathJax SVG string sized to fontPx and centred on (x, y).
export function placeTexSVG(svg, x, y, fontPx = 15) {
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  if (!m) return null;
  const [, , vw, vh] = m.slice(1).map(Number), k = fontPx / 1000, w = vw * k, h = vh * k;
  const top = y - h / 2;
  const open = /^<svg\b[^>]*>/.exec(svg)[0];
  const attrs = open.replace(/\s(width|height|style|x|y)="[^"]*"/g, '').replace(/^<svg/, `<svg x="${f1(x - w / 2)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" overflow="visible"`);
  return { svg: attrs + svg.slice(open.length), w, h, box: { x: x - w / 2, y: top, w, h } };
}
// opts: tex(texString) -> MathJax SVG string or null; fontPx; front (diagram
// x, Infinity: all drawn); pad. Returns { svg, w, h, vb: [x, y, w, h] }.
export function toSVG(d, opts = {}) {
  const fontPx = opts.fontPx || 15, X = opts.front ?? Infinity, pad = opts.pad ?? 6;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const n of d.nodes) grow(n.x, n.y);
  for (const L of d.lines) { for (const p of L.pts) grow(p[0], p[1]); }
  const labs = d.lines.map(L => {
    if (!L.label) return '';
    const t = opts.tex && opts.tex(L.tex);
    const op = lineFrac(L, X) >= LABEL_AT ? 1 : 0;
    const placed = t ? placeTexSVG(t, L.label.x, L.label.y, fontPx) : null;
    if (placed) {
      const b = placed.box; L.label.box = b; grow(b.x, b.y); grow(b.x + b.w, b.y + b.h);
      return `<g class="fy-t" data-i="${L.i}" fill="${L.color}" color="${L.color}" style="color:${L.color}" opacity="${op}">${placed.svg}</g>`;
    }
    const b = { x: L.label.x - L.label.w / 2, y: L.label.y - L.label.h / 2, w: L.label.w, h: L.label.h }; L.label.box = b;
    grow(b.x, b.y); grow(b.x + b.w, b.y + b.h);
    return `<text class="fy-t" data-i="${L.i}" x="${f1(L.label.x)}" y="${f1(L.label.y)}" text-anchor="middle" dominant-baseline="central" font-family="STIX Two Text, Times New Roman, serif" font-style="italic" font-size="${fontPx}" fill="${L.color}" opacity="${op}">${esc(L.uni)}</text>`;
  });
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const minH = opts.minH ?? 120;
  if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
  const W = x1 - x0, H = y1 - y0;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(x0)} ${f1(y0)} ${f1(W)} ${f1(H)}" width="${f1(W)}" height="${f1(H)}" class="fy-dia">`;
  if (opts.background) s += `<rect x="${f1(x0)}" y="${f1(y0)}" width="${f1(W)}" height="${f1(H)}" fill="${opts.background}"/>`;
  s += '<g fill="none" stroke-linecap="round" stroke-linejoin="round">';
  for (const L of d.lines) {
    const f = lineFrac(L, X), w = L.kind === 'hadron' ? 3 : L.kind === 'gluon' ? 1.5 : 1.8;
    s += `<path class="fy-l" data-i="${L.i}" d="${partialPath(L, f)}" stroke="${L.color}" stroke-width="${w}"${L.kind === 'scalar' ? ' stroke-dasharray="6 4.5"' : ''}/>`;
  }
  s += '</g>';
  for (const L of d.lines) if (L.arrow) s += `<path class="fy-a" data-i="${L.i}" d="${arrowPath(L.arrow)}" fill="${L.color}" opacity="${lineFrac(L, X) >= ARROW_AT ? 1 : 0}"/>`;
  for (const n of d.nodes) if (n.cpl) s += `<circle class="fy-v" data-n="${n.id}" cx="${f1(n.x)}" cy="${f1(n.y)}" r="2.7" fill="#eef2fb" opacity="${X >= n.x ? 1 : 0}"/>`;
    else if (n.id === 'src') s += `<circle cx="${f1(n.x)}" cy="${f1(n.y)}" r="3.4" fill="none" stroke="#eef2fb" stroke-width="1.4"/>`;
  // wide clear strokes over the final-state lines: the pointer targets
  for (const L of d.lines) if (L.ext === 'out' && L.hard != null) s += `<path class="fy-hit" data-i="${L.i}" d="${partialPath(L, 1)}" stroke="transparent" stroke-width="16" fill="none"/>`;
  s += labs.join('') + '</svg>';
  return { svg: s, w: W, h: H, vb: [x0, y0, W, H] };
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// every process the generators can make, as synthetic infos (the tests use
// it with real events as well): [beam, kind, variant info]
export const PROCESS_KEYS = [
  'gun', 'pp:zmm', 'pp:zee', 'pp:hgg', 'pp:h4l', 'pp:tt', 'pp:jj', 'pp:mb', 'ppbar:tt', 'ppbar:zmm',
  'ee:zmm', 'ee:zee', 'ee:hgg', 'ee:h4l', 'ee:tt', 'ee:jj', 'mumu:tt', 'mumu:jj', 'PbPb:mb',
];

// ── the page: per-frame state, the detector object of each line ────────────
// The drawing at front X as plain data, so the page can change the path
// data and opacities in place each frame (no new SVG): per line its path,
// whether its arrow and label show; per vertex whether it shows. toSVG
// uses the same thresholds.
export const ARROW_AT = 0.55, LABEL_AT = 0.8;
export function drawState(d, X) {
  return {
    lines: d.lines.map(L => { const f = lineFrac(L, X); return { i: L.i, f, d: partialPath(L, f), arrow: !!L.arrow && f >= ARROW_AT, label: !!L.label && f >= LABEL_AT }; }),
    nodes: d.nodes.filter(n => n.cpl).map(n => ({ id: n.id, on: X >= n.x })),
  };
}

// The couplings named in plain words, for the line under the diagram:
// "strong (g_s) at 2 vertices, ...". tex: the symbols as TeX for MathJax.
export function couplingText(d) {
  return d.couplings.map(c => ({ key: c.key, tex: c.tex, text: `${c.name} at ${c.n === 1 ? 'one vertex' : c.n + ' vertices'}` }));
}

// The detector object of each line (picking.js buildObjects keys), or
// null. A lepton or a photon: the primary 'hard' track of that name along
// the hard momentum (cos > 0.999); a quark or a gluon: the nearest jet
// within dR 0.5; a neutrino: the MET arrow; the ISR photon: the 'isr'
// track; a gun particle: its primary track. The same rules as the
// lineage of physinfo.js.
export function lineObjects(d, info, objs) {
  const tracks = objs.filter(o => o.kind === 'track' && o.T);
  const jets = objs.filter(o => o.kind === 'jet');
  const met = objs.find(o => o.kind === 'met');
  const hard = info.hard || [];
  const used = new Set();
  const dphi = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return d.lines.map(L => {
    if (L.ext !== 'out') return null;
    if (L.isr) { const o = tracks.find(o => o.T.primary === 'isr'); return o ? o.key : null; }
    if (L.hard == null || !hard[L.hard]) return null;
    const [name, p] = hard[L.hard];
    if (name === 'nu') return met ? met.key : null;
    const pt = Math.hypot(p[1], p[2]), pm = Math.hypot(p[1], p[2], p[3]) || 1;
    if (name === 'q' || name === 'g' || name === 'b') {
      if (!pt) return null;
      const eta = Math.asinh(p[3] / pt), phi = Math.atan2(p[2], p[1]);
      let best = null, bd = 0.5;
      for (const j of jets) { const r = Math.hypot(j.eta - eta, dphi(j.phi, phi)); if (r < bd && !used.has(j.key)) { bd = r; best = j; } }
      if (best) used.add(best.key);
      return best ? best.key : null;
    }
    let best = null, bc = 0.999;
    for (const o of tracks) {
      if (o.name !== name || o.T.primary !== 'hard' || used.has(o.key)) continue;
      const u = o.T.u0, c = (p[1] * u[0] + p[2] * u[1] + p[3] * u[2]) / pm;
      if (c > bc) { bc = c; best = o; }
    }
    if (best) used.add(best.key);
    return best ? best.key : null;
  });
}

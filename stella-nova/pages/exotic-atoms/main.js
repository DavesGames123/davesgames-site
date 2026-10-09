// ============================================================================
//  EXOTIC ATOMS  ·  page logic (module)
// ----------------------------------------------------------------------------
//  Binds index.html. Physics in physics.js, the samplers in states.js, the
//  field of the probability current in bfield.js, the climb and the
//  readout text in climb.js, one frame in scene.js. One rAF loop draws
//  only when something changed or moves. saver.js installs window.snSaver;
//  the loop pauses while window.__eaSaver is true.
//
//  GREP MAP
//      grep -n 'const st ='            the page state
//      grep -n 'function rebuild'      sample the cloud of the state
//      grep -n 'function startField'   the field job (axisymmetric / packet)
//      grep -n 'function readout'      the readouts and the ket
//      grep -n 'function equations'    the TeX of the family
//      grep -n 'function frame'        draw one frame
//      grep -n 'function bindUI'       controls
//      grep -n 'function bindPointer'  drag, wheel, pinch
//      grep -n 'function sheets'       phone dock and sheets
// ============================================================================
import * as Ph from './physics.js';
import * as St from './states.js';
import * as Bf from './bfield.js';
import * as K from './climb.js';
import { makeScene } from './scene.js';
import { drawScaleBar, drawRuler, drawAxis } from './draw.js';
import * as CM from '../ct-lab/colormaps/maps.js';
import { createPicker } from '../ct-lab/colormaps/picker.js';
import { typeset, typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mq = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };
const PHONE = mq('(max-width: 860px)') || mq('(pointer: coarse)');
const REDUCED = mq('(prefers-reduced-motion: reduce)');
const QUAL = { low: [PHONE ? 10000 : 22000, 5e5], med: [PHONE ? 16000 : 42000, PHONE ? 7e5 : 1.1e6], high: [PHONE ? 26000 : 80000, PHONE ? 1e6 : 1.8e6] };
const SUP = s => String(s).replace(/-?\d/g, d => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(d)]);
const DEBYE = 2.541746;   // debye per e a0

export const st = {
  sp: 'H', fam: 'nlm', n: 30, l: 29, m: 29, k: 0, circ: true, cmp: false, colour: 'density', packet: false, bohr: false, spin: !REDUCED,
  yaw: 0.5, pitch: 1.05, zoom: 1, t: 0, tp: 0,
  bOn: false, spinLayer: false, lines: true, arrows: false, mag: true,
  extB: false, B: 0.1, extE: false, F: 0.1,
  mol: 'trilobite', molR: 1, sb: 5,
  cmap: { id: 'magma', reverse: false, gamma: 1 }, fmap: 'mako', exposure: 1, floor: 0, cut: { mode: 0, axis: 1, pos: 0 },
  q: 'med', sig: 1.6, speed: 0.6, nLines: 8, ruler: false,
};
const S = { cloud: null, cmpCloud: null, ext: 1, zc: 0, key: '', cmpKey: '', F: null, lines: null, fkey: '', job: null, pk: null, pkT: -1, lutKey: '', lut: null, flut: null, dirty: true, tri: null, sbState: null, larmor: 0 };
const scene = makeScene((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
const scene2 = makeScene((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
const cv = $('cv');
const sp = () => Ph.SPECIES[st.sp];

// ---------------------------------------------------------------- state
const isCirc = () => st.fam === 'nlm' && st.l === st.n - 1 && Math.abs(st.m) === st.l && st.n > 1;
const hydLike = () => sp().kind !== 'qd';
function familySpecies() {
  if (st.fam === 'mol' && st.sp !== 'Rb' && st.sp !== 'Cs') st.sp = 'Rb';
  if (st.fam === 'strongB' && st.sp !== 'H' && st.sp !== 'antiH') st.sp = 'H';
}
function nRange() {
  const s = sp();
  if (st.fam === 'mol') return [12, 70];
  if (st.packet && st.fam === 'nlm') return [Math.max(6, s.nMin), Math.min(140, s.nMax)];
  return [st.fam === 'para' ? 1 : s.nMin, s.nMax];
}
// clamp n, l, m, k to the family and write the sliders
function syncQN() {
  familySpecies();
  const [n0, n1] = nRange(), nIn = $('nIn'), lIn = $('lIn'), mIn = $('mIn');
  nIn.min = n0; nIn.max = n1; st.n = clamp(st.n, n0, n1); nIn.value = st.n;
  if (st.fam === 'nlm') {
    if (st.circ) { st.l = st.n - 1; st.m = st.n - 1; }
    st.l = clamp(st.l, 0, st.n - 1); st.m = clamp(st.m, -st.l, st.l);
    if (st.packet && !isCirc()) st.m = 0;
    lIn.min = 0; lIn.max = st.n - 1; lIn.step = 1; lIn.value = st.l;
    mIn.min = -st.l; mIn.max = st.l; mIn.value = st.m;
    $('lSym').textContent = 'l'; $('lOut').textContent = st.l;
  } else if (st.fam === 'para') {
    st.m = clamp(st.m, -(st.n - 1), st.n - 1);
    const kmax = st.n - Math.abs(st.m) - 1;
    if (st.circ) st.k = kmax;
    st.k = clamp(st.k, -kmax, kmax); if ((st.k + kmax) % 2) st.k -= 1;
    lIn.min = -kmax; lIn.max = kmax; lIn.step = 2; lIn.value = st.k;
    mIn.min = -(st.n - 1); mIn.max = st.n - 1; mIn.value = st.m;
    $('lSym').textContent = 'k'; $('lOut').textContent = st.k;
  }
  $('nOut').textContent = st.n; $('mOut').textContent = st.m;
  $('lRow').hidden = $('mRow').hidden = st.fam === 'mol' || st.fam === 'strongB';
  $('qnCtrls').querySelector('label').hidden = st.fam === 'strongB';
  $('bRow').hidden = st.fam !== 'strongB';
  $('rRow').hidden = $('molSeg').hidden = st.fam !== 'mol';
  $('circBtn').hidden = $('cmpBtn').hidden = !(st.fam === 'nlm' || st.fam === 'para');
  $('circBtn').textContent = st.fam === 'para' ? 'Elliptical (k = n − |m| − 1)' : 'Circular (l = m = n − 1)';
  $('packBtn').hidden = st.fam !== 'nlm';
  $('bohrBtn').hidden = st.fam === 'mol' || st.fam === 'strongB';
  $('spChips').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st.sp));
  $('famSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st.fam));
  $('circBtn').classList.toggle('on', st.circ); $('packBtn').classList.toggle('on', st.packet);
  $('spNote').textContent = sp().note;
  $('qpBig').textContent = sp().sym;
}

// ---------------------------------------------------------------- cloud
function stateKey() {
  const N = QUAL[st.q][0];
  if (st.fam === 'nlm') return st.packet ? `pk|${st.n}|${st.l}|${isCirc()}|${st.sig}|${N}` : `nlm|${st.n}|${st.l}|${st.m}|${N}`;
  if (st.fam === 'para') return `para|${st.n}|${st.k}|${st.m}|${N}`;
  if (st.fam === 'mol') return `mol|${st.sp}|${st.n}|${st.mol}|${st.molR}|${N}`;
  return `sb|${st.sb}|${N}`;
}
export function rebuild() {
  const key = stateKey(); if (key === S.key) return;
  S.key = key; S.pk = null; S.zc = 0;
  const N = QUAL[st.q][0], n = st.n;
  if (st.fam === 'nlm' && st.packet) {
    S.pk = St.packet(isCirc() ? 'circular' : 'radial', n, st.sig, N, 7, isCirc() ? n - 1 : Math.min(st.l, n - 1) || 1);
    S.cloud = { pts: S.pk.pts, dens: S.pk.dens, weights: S.pk.w }; S.ext = S.pk.ext; st.tp = 0;
  } else if (st.fam === 'nlm') {
    S.cloud = St.sampleNLM(n, st.l, st.m, N, 7); S.ext = S.cloud.ext;
  } else if (st.fam === 'para') {
    const am = Math.abs(st.m), kmax = n - am - 1, n1 = (kmax + st.k) / 2, n2 = (kmax - st.k) / 2;
    S.cloud = St.sampleParabolic(n1, n2, st.m, N, 7); S.zc = 1.5 * n * st.k; S.ext = n * n * 1.5 + 3 * n - Math.abs(S.zc) * 0.4;
  } else if (st.fam === 'mol') {
    const lmin = st.sp === 'Cs' ? 4 : 3, R = St.outerWell(n, lmin) * st.molR;
    S.tri = St.trilobite(n, R, { kind: st.mol, lmin });
    S.cloud = S.tri.sample(N, 7, 0.5); S.ext = R * 0.85; S.zc = R * 0.42;
  } else {
    S.sbState = Ph.strongB(Math.pow(10, st.sb) / Ph.C.B0);
    S.cloud = St.strongBState(S.sbState, N, 7); S.ext = 2.6 * Math.max(S.sbState.zRms, S.sbState.rhoRms);
  }
  S.cmpKey = ''; S.fkey = ''; S.F = null; S.lines = null;
  S.dirty = true;
}
function rebuildCompare() {
  if (!st.cmp || !(st.fam === 'nlm' || st.fam === 'para')) { S.cmpCloud = null; return; }
  const key = `${st.fam}|${st.n}|${QUAL[st.q][0]}`; if (key === S.cmpKey) return;
  S.cmpKey = key;
  S.cmpCloud = st.fam === 'nlm' ? St.sampleNLM(st.n, 0, 0, QUAL[st.q][0], 11) : St.sampleParabolic((st.n - 1) >> 1, (st.n - 1) - ((st.n - 1) >> 1), 0, QUAL[st.q][0], 11);
}

// ---------------------------------------------------------------- field
const gOf = () => { const g = Ph.orbitalG(sp()); return Number.isFinite(g) ? g : 0; };
function spinMoment() {
  const s = sp(); if (!st.spinLayer || s.kind === 'exc' || s.id === 'Ps') return 0;
  const q = s.orb[1], v = q * Ph.C.gs * 0.5 / 2;            // q g_s m_s mu_B, m_s = +1/2, mu_B = 1/2
  return s.id === 'muH' ? v / Ph.C.mmu : v;
}
function rhozOf() {
  if (st.fam === 'nlm') return St.densityNLM(st.n, st.l, st.m);
  if (st.fam === 'para') { const kmax = st.n - Math.abs(st.m) - 1; return St.densityParabolic((kmax + st.k) / 2, (kmax - st.k) / 2, st.m); }
  if (st.fam === 'mol') return S.tri.rhoz;
  return St.densityStrongB(S.sbState);
}
export function startField() {
  if (!st.bOn) { if (S.job) S.job.cancel(); S.job = null; status(''); return; }
  if (S.pk) return;                        // packets: the point solver in frame()
  const key = `${S.key}|${st.spinLayer}|${st.sp}|${st.nLines}`;
  if (key === S.fkey) return;
  S.fkey = key; if (S.job) S.job.cancel();
  const rz = rhozOf(), E = (S.ext + Math.abs(S.zc)) * 1.18, sym = st.fam === 'nlm' || st.fam === 'strongB';
  const res = (st.q === 'high' ? 64 : st.q === 'low' ? 36 : 48);
  status('computing the field …');
  S.job = Bf.solveAxisym(rz, { g: gOf(), spin: spinMoment(), ext: E, sext: Math.max(E, rz.ext * 0.9), ns: res, nt: Math.round(res * 0.8), symmetric: sym, budget: 12,
    onDone: F => { S.F = F; S.lines = Bf.fieldLines(F, { lines: st.nLines }); S.dirty = true; status(''); readout(); } });
}
let statusT = 0;
function status(t) { const el = $('status'); el.hidden = !t; el.textContent = t; }
function packetField(t) {
  const E = S.ext * 1.15, src = Bf.packetSources(S.pk, t, gOf(), PHONE ? 500 : 900);
  const F = Bf.solvePoints(src.src, E, PHONE ? 11 : 13);
  const seeds = [];
  const R = Ph.meanR(st.n, st.n - 1);
  for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * Math.PI; seeds.push([R * 0.55 * Math.cos(a), R * 0.55 * Math.sin(a), 0]); seeds.push([R * 1.25 * Math.cos(a), R * 1.25 * Math.sin(a), R * 0.15]); }
  S.lines = Bf.trace3D(F, seeds); S.F = null; S.pkMoment = src.moment;
}

// ---------------------------------------------------------------- readout
const fmtEV = K.fmtEV, fmtLen = K.fmtLen, fmtHz = K.fmtHz, fmtTime = K.fmtTime;
const evHz = e => Math.abs(e) / Ph.C.hartreeEV * Ph.C.hartreeHz;
function ketText() {
  const s = sp();
  if (st.fam === 'nlm') {
    if (st.packet) return isCirc() ? `Σ c_n |n C⟩, n̄ = ${st.n}` : `Σ c_n |n, ${st.l}, 0⟩, n̄ = ${st.n}`;
    return isCirc() ? `|${st.n}C⟩` : `|${st.n}, ${st.l}, ${st.m}⟩`;
  }
  if (st.fam === 'para') { const kmax = st.n - Math.abs(st.m) - 1; return `|${st.n}; ${(kmax + st.k) / 2}, ${(kmax - st.k) / 2}, ${st.m}⟩`; }
  if (st.fam === 'mol') return `${s.sym}(${st.n}) + ${s.sym}, ${st.mol}`;
  return `H 1s in ${fmtB(Math.pow(10, st.sb))}`;
}
const fmtB = b => b >= 1e4 ? `10${SUP(Math.round(Math.log10(b) * 10) / 10)} T` : `${b.toPrecision(3)} T`;
export function readout() {
  const s = sp(), u = Ph.units(s), rows = [];
  let note = '';
  const ket = ketText();
  $('qpKet').textContent = ket; $('ketMain').textContent = ket;
  if (st.fam === 'strongB') {
    const r = S.sbState; if (!r) return;
    rows.push(['field', `${fmtB(Math.pow(10, st.sb))} (β = ${r.beta.toPrecision(3)})`]);
    rows.push(['binding (variational)', fmtEV(r.binding * Ph.C.hartreeEV)]);
    const ex = Ph.STRONG_B_EXACT[Math.round(r.beta)]; if (ex && Math.abs(r.beta - Math.round(r.beta)) < 1e-6) rows.push(['exact (Kravchenko 1996)', fmtEV(ex * Ph.C.hartreeEV)]);
    rows.push(['size across B', fmtLen(2 * r.rhoRms * Ph.C.a0)]);
    rows.push(['size along B', fmtLen(2 * r.zRms * Ph.C.a0)]);
    rows.push(['squeeze (along / across)', `${r.aspect.toFixed(2)}×`]);
    rows.push(['Landau length √(ħ/eB)', fmtLen(Math.min(1e3, r.landau) * Ph.C.a0)]);
    rows.push(['Rydberg n squeezed at this B', `n ≳ ${Math.max(1, Math.pow(1 / r.beta, 1 / 3)).toFixed(1)}`]);
    note = 'Variational ground state: an upper bound on the energy (0.1 % to 2.5 % from the exact values). Magnetic white dwarfs have 10² to 10⁵ T; neutron stars 10⁸ T.';
    $('ketSub').textContent = 'hydrogen in a white-dwarf field (approximate)';
  } else if (st.fam === 'mol') {
    const tri = S.tri; if (!tri) return;
    const Rm = tri.R * u.a, dD = Math.abs(tri.dipole) * DEBYE * u.a / Ph.C.a0;
    let U = 0; for (let l = tri.lmin; l < st.n; l++) U += (2 * l + 1) / (4 * Math.PI) * Ph.Rnl(st.n, l, tri.R) ** 2;
    U *= 2 * Math.PI * -16.1;
    rows.push(['Rydberg level', `n = ${st.n}, l ≥ ${tri.lmin} manifold`]);
    rows.push(['bond length R', `${fmtLen(Rm)} (${Math.round(tri.R)} a₀)`]);
    rows.push(['R / n²', (tri.R / st.n / st.n).toFixed(2)]);
    rows.push(['permanent dipole', `${dD.toPrecision(3)} D`]);
    rows.push(['well depth U(R), a_s = −16.1 a₀', fmtHz(Math.abs(U) * Ph.C.hartreeHz).replace(/^/, '−')]);
    rows.push(['wells in U(R)', `about n − ${tri.lmin} = ${st.n - tri.lmin}`]);
    note = 'First-order Fermi-pseudopotential model in the degenerate hydrogenic manifold (low-l states left out). Brightness ∝ |ψ| (drawn from |ψ|, not |ψ|²) so the ridges show.';
    $('ketSub').textContent = `${st.mol === 'trilobite' ? 'trilobite' : 'butterfly'} ultralong-range molecule`;
  } else {
    const n = st.n, l = st.fam === 'nlm' ? st.l : 0, m = st.m, exc = s.kind === 'exc';
    const E = Ph.energyEV(s, n, l), b = Ph.bindingEV(s, n, l);
    rows.push([exc ? 'energy above the crystal' : 'energy', fmtEV(E)]);
    rows.push(['binding / h', fmtHz(evHz(b))]);
    if (s.kind === 'qd') { const d = Ph.quantumDefect(s, n, l); rows.push(['quantum defect δ', `${d.toPrecision(4)} (n* = ${(n - d).toFixed(3)})`]); }
    const r = st.fam === 'para' ? Ph.meanR(n, 0) : Ph.meanR(Ph.nStar(s, n, l), Math.min(l, Ph.nStar(s, n, l) - 0.5));
    rows.push(['⟨r⟩', fmtLen(r * u.a)]);
    rows.push(['diameter 2⟨r⟩', `${fmtLen(2 * r * u.a)} · ${K.scaleLabel(2 * r * u.a)}`]);
    if (n < s.nMax) { const tr = Ph.transition(s, n, l, n + 1, Math.min(l + 1, n)); rows.push([`photon to n = ${n + 1}`, `${fmtHz(tr.hz)} · ${fmtLen(tr.lam)} (${tr.band})`]); }
    const lt = st.fam === 'nlm' ? Ph.lifetime(s, n, l, 300) : null;
    if (lt) rows.push(['lifetime at 300 K', Number.isFinite(lt.s) ? `${fmtTime(lt.s)}${lt.cap ? ' (' + lt.cap + ')' : ''}` : lt.basis]);
    if (st.fam === 'nlm') {
      const g = Ph.orbitalG(s);
      rows.push(['orbital moment μ_z', Number.isFinite(g) ? `${(g * m).toFixed(3)} μ_B` : '— (effective masses)']);
      if (hydLike() || l >= 3) { const a = Ph.polarizability(n, 0, m); rows.push(['polarizability (k = 0)', `${(0.5 * a * u.Eh / Ph.C.hartreeEV * Ph.C.hartreeHz / (u.F * u.F) / 1e6).toPrecision(3)} MHz/(V/cm)²`]); }
      else rows.push(['polarizability', '∝ n*⁷ (low l, not computed)']);
    }
    if (st.fam === 'para') {
      const kd = Ph.starkDipole(n, st.k) * u.a / Ph.C.a0 * DEBYE;
      rows.push(['electric dipole', `${kd.toPrecision(3)} D`]);
      rows.push(['Inglis–Teller field', K.fmtVcm(Ph.inglisTeller(s, n))]);
      rows.push(['ionizing field', K.fmtVcm(Ph.ionField(s, n, 0))]);
    }
    if (st.extE) {
      const kk = st.fam === 'para' ? st.k : 0, dE = Ph.starkEV(s, n, kk, m, st.F) - Ph.starkEV(s, n, kk, m, 0);
      rows.push([`Stark shift at ${K.fmtVcm(st.F)}`, `${fmtHz(evHz(dE))} ${dE < 0 ? 'down' : 'up'}`]);
      if (st.F > Ph.inglisTeller(s, n)) note += ` At ${K.fmtVcm(st.F)} the n = ${n} and n = ${n + 1} manifolds overlap (Inglis–Teller).`;
      if (st.F > Ph.ionField(s, n, 0)) note += ' This field ionizes the state.';
    }
    if (st.extB && !exc) {
      const z = Ph.zeemanEV(s, m, 0.5, st.B) - Ph.zeemanEV(s, 0, 0.5, 0);
      rows.push([`Zeeman shift at ${fmtB(st.B)}`, `${fmtHz(evHz(z))} (m_s = +½)`]);
      rows.push(['Larmor frequency', s.id === 'Ps' ? '0 (no orbital moment)' : fmtHz(Ph.larmor(s, st.B) / (2 * Math.PI))]);
      rows.push(['diamagnetic regime', `B ≳ ${fmtB(Ph.C.B0 / Math.pow(n, 3) * (u.mu ** 2))}`]);
    }
    if (st.packet && S.pk) { rows.push(['Kepler period T_K', fmtTime(S.pk.TK * Ph.C.tAU / u.mu)]); rows.push(['revival T_rev', fmtTime(S.pk.Trev * Ph.C.tAU / u.mu)]); }
    $('ketSub').textContent = `${s.name}${st.fam === 'para' ? ', Stark state' : isCirc() ? ', circular state' : ''}`;
    if (s.id === 'Ps' && st.bOn) note += ' Positronium: equal masses with opposite charges cancel the orbital moment, so there is no orbital field.';
    if (exc && st.bOn) note += ' Exciton: the field is not computed (it depends on the effective masses).';
    if (s.kind === 'qd' && l < 4) note += ` The cloud is drawn as hydrogen at n = ${n}, l = ${l}; the core changes it inside a few a₀.`;
  }
  if (st.bOn && S.F) {
    const scale = Ph.C.B0 * Math.pow(Ph.C.a0 / u.a, 3), b0 = Math.hypot(...Bf.fieldAt(S.F, 0, 0)) * scale;
    rows.push(['B at the nucleus', b0 > 0 ? `${b0.toPrecision(3)} T` : '0']);
    rows.push(['moment in the field', `${(S.F.moment * 2).toFixed(3)} μ_B`]);
  } else if (st.bOn && S.pkMoment) rows.push(['packet moment μ_z', `${(S.pkMoment[2] * 2).toFixed(2)} μ_B`]);
  $('read').innerHTML = rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('');
  $('readNote').textContent = note.trim();
}

// ---------------------------------------------------------------- equations
const EQ = {
  nlm: ['Hydrogen-like eigenstate and its current', ['\\psi_{n\\ell m}=R_{n\\ell}(r)\\,Y_\\ell^m(\\theta,\\varphi),\\quad E=-\\frac{\\mathrm{Ry}}{(n-\\delta_\\ell)^2}', '\\mathbf j=\\frac{\\hbar}{m}\\,\\mathrm{Im}(\\psi^*\\nabla\\psi)=\\frac{\\hbar m_\\ell}{m\\rho}|\\psi|^2\\hat{\\boldsymbol\\varphi}', '\\mathbf B=\\frac{\\mu_0}{4\\pi}\\int\\frac{q\\,\\mathbf j\\times(\\mathbf r-\\mathbf r\')}{|\\mathbf r-\\mathbf r\'|^3}d^3r\'']],
  pk: ['A coherent wave packet', ['\\Psi(t)=\\sum_n c_n\\,\\psi_n\\,e^{-iE_nt/\\hbar}', 'T_K=2\\pi n_0^3\\,\\hbar/E_h,\\qquad T_{\\mathrm{rev}}=\\tfrac{2n_0}{3}T_K']],
  para: ['Parabolic (Stark) state', ['\\psi\\propto e^{im\\varphi}f_{n_1}(\\xi)f_{n_2}(\\eta),\\quad \\xi=r+z,\\ \\eta=r-z', 'E=-\\frac{1}{2n^2}+\\frac32Fn(n_1-n_2)-\\frac{F^2n^4}{16}(17n^2-3k^2-9m^2+19)', 'F_{\\mathrm{IT}}=\\frac{1}{3n^5}']],
  mol: ['Ultralong-range Rydberg molecule', ['\\psi_{\\mathrm{tri}}\\propto\\sum_{\\ell\\ge3}R_{n\\ell}(R)R_{n\\ell}(r)\\frac{2\\ell+1}{4\\pi}P_\\ell(\\cos\\theta)', 'U(R)=2\\pi a_s\\sum_{\\ell\\ge3}\\frac{2\\ell+1}{4\\pi}R_{n\\ell}(R)^2']],
  strongB: ['Hydrogen in a strong magnetic field', ['H=-\\tfrac12\\nabla^2-\\frac1r+\\frac\\beta2(L_z+2S_z)+\\frac{\\beta^2}{8}\\rho^2,\\quad\\beta=\\frac{B}{2.35\\times10^5\\,\\mathrm T}', '\\psi=e^{-\\rho^2/4s^2-\\sqrt{\\rho^2/a^2+z^2/b^2}}']],
};
let eqKey = '';
function equations() {
  const key = st.fam === 'nlm' && st.packet ? 'pk' : st.fam;
  if (key === eqKey) return; eqKey = key;
  const [lbl, list] = EQ[key];
  $('eqLbl').textContent = lbl;
  const rows = $('eqRows'); rows.innerHTML = '';
  for (const t of list) { const d = document.createElement('div'); d.className = 'sci-eq'; rows.appendChild(d); typeset(d, t).catch(() => {}); }
}
export { EQ };

// ---------------------------------------------------------------- frame
let W = 0, H = 0, dpr = 1;
function fit() {
  const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, Math.round(r.width || innerWidth)); H = Math.max(1, Math.round(r.height || innerHeight));
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
}
// the clear area: right of the quick panel (desktop), above a sheet (phone)
function clearArea() {
  let x0 = 0, x1 = W, y0 = 0, y1 = H;
  const qp = $('qp'), adv = $('adv');
  if (!PHONE || innerWidth > 860) {
    if (!qp.classList.contains('collapsed')) x0 = qp.getBoundingClientRect().right || 0;
    if (adv.classList.contains('open')) x1 = adv.getBoundingClientRect().left || W;
  } else {
    const open = [qp, adv].find(e => e.classList.contains('open'));
    y1 = open ? open.getBoundingClientRect().top || H : (($('dock').getBoundingClientRect().top) || H);
    const eq = $('eq'); if (!eq.classList.contains('collapsed')) y0 = Math.min(H * 0.3, eq.getBoundingClientRect().bottom || 0);
  }
  if (x1 - x0 < 200) { x0 = 0; x1 = W; }
  return { x0, x1, y0, y1 };
}
function lutNow() {
  const key = JSON.stringify(st.cmap) + st.fmap;
  if (key !== S.lutKey) { S.lutKey = key; S.lut = CM.variant(st.cmap.id, { reverse: st.cmap.reverse, gamma: st.cmap.gamma }); S.flut = CM.variant(st.fmap, {}); }
}
let lastField = 0;
function frame(dt) {
  fit(); lutNow();
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#05050a'; g.fillRect(0, 0, cv.width, cv.height);
  if (!S.cloud) return;
  st.t += dt;
  if (st.spin && !drag) st.yaw += dt * 0.22;
  // packet time: st.speed Kepler periods per second
  if (S.pk) { st.tp += dt * st.speed * S.pk.TK; S.pk.update(st.tp); if (st.bOn && performance.now() - lastField > 220) { lastField = performance.now(); packetField(st.tp); } }
  const A = clearArea(), panes = S.cmpCloud ? 2 : 1, pw = (A.x1 - A.x0) / panes, ph = A.y1 - A.y0;
  const pose = st.extB ? { tilt: 0.85, prec: st.t * 0.6 * (Ph.orbitalG(sp()) > 0 ? -1 : 1) * (sp().id === 'Ps' ? 0 : 1) } : null;
  const ext = S.ext + Math.abs(S.zc) * 0.25;
  const scale = Math.min(pw, ph) * 0.44 / ext * st.zoom;
  const cyOff = S.zc * scale * Math.cos(st.pitch);
  const base = {
    dpr, budget: QUAL[st.q][1] / panes, yaw: st.yaw, pitch: st.pitch, scale, pose, lut: S.lut, flut: S.flut,
    colour: st.colour, exposure: st.exposure, floor: st.floor, cut: Object.assign({ ext }, st.cut), nucleus: true,
    m: S.pk ? 1 : st.m, cycles: S.pk ? 1 : Math.sign(st.m) * Math.min(Math.abs(st.m), 8), phase: S.pk ? 0 : st.t * 1.6,
  };
  const field = st.bOn ? { field: S.F, lines: S.lines, showLines: st.lines, showMag: st.mag && !!S.F, showArrows: st.arrows && !!S.F, planes: PHONE ? 4 : 6 } : {};
  const ringR = st.bohr && (st.fam === 'nlm' || st.fam === 'para') ? st.n * st.n : 0;
  const axes = [];
  if (st.extB) axes.push({ dir: [0, 0, 1], len: ext * 0.9, col: '#9fd0ff', label: `B = ${fmtB(st.B)}`, pose: null });
  if (st.extE) axes.push({ dir: [0, 0, 1], len: ext * 0.75, col: '#ffd666', label: `F = ${K.fmtVcm(st.F)}`, pose: null });
  scene.draw(g, Object.assign({}, base, field, { x: A.x0, y: A.y0, w: pw, h: ph, cx: pw / 2, cy: ph / 2 + cyOff, cloud: S.cloud, ring: ringR, axes }));
  if (S.cmpCloud) {
    scene2.draw(g, Object.assign({}, base, { x: A.x0 + pw, y: A.y0, w: pw, h: ph, cx: pw / 2, cy: ph / 2, cloud: S.cmpCloud, m: 0, cycles: 0, ring: ringR }));
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = 'rgba(232,234,240,0.8)'; g.font = '500 13px Inter, system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(st.fam === 'nlm' ? ketText() : `k = ${st.k}`, A.x0 + 14, A.y0 + 22); g.fillText(st.fam === 'nlm' ? 'l = 0' : 'k = 0', A.x0 + pw + 14, A.y0 + 22);
    g.strokeStyle = 'rgba(255,190,150,0.15)'; g.beginPath(); g.moveTo(A.x0 + pw, A.y0 + 10); g.lineTo(A.x0 + pw, A.y1 - 10); g.stroke();
  }
  g.setTransform(dpr, 0, 0, dpr, A.x0 * dpr, A.y0 * dpr);
  drawScaleBar(g, A.x1 - A.x0, ph, { scale }, Ph.units(sp()).a, { right: 18, bottom: 22 });
  if (S.pk) {
    g.fillStyle = 'rgba(232,234,240,0.75)'; g.font = '12px Inter, system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(`t = ${(st.tp / S.pk.TK).toFixed(2)} T_K   (revival at ${(S.pk.Trev / S.pk.TK).toFixed(1)} T_K)`, 16, ph - 22);
  }
}

// ---------------------------------------------------------------- loop
let lastT = 0, raf = 0, running = true;
const live = () => st.spin || !!S.pk || st.colour === 'phase' || st.extB || drag;
function loop(now) {
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
  if (!window.__eaSaver && !document.hidden && (S.dirty || live())) { S.dirty = false; try { frame(dt); } catch (e) { console.error(e); } }
  if (running) raf = requestAnimationFrame(loop);
}
export function refresh(heavy = true) {
  syncQN();
  if (heavy) { rebuild(); rebuildCompare(); }
  startField(); readout(); equations(); S.dirty = true;
  if (st.ruler) drawRulerNow();
}
let pend = 0;
const soon = () => { if (pend) return; pend = requestAnimationFrame(() => { pend = 0; refresh(true); }); };

// ---------------------------------------------------------------- ruler
function drawRulerNow() {
  const c = $('rulerCv'), r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  const s = sp(), u = Ph.units(s);
  let size = 2 * S.ext * u.a * 0.8;
  if (st.fam === 'nlm' || st.fam === 'para') size = 2 * Ph.meanR(Ph.nStar(s, st.n, st.fam === 'nlm' ? st.l : 0), 0) * u.a;
  const marks = [{ name: `this state (${fmtLen(size)})`, m: size, col: '#ffb36b', hi: true },
    { name: 'H, n = 100', m: 2 * Ph.meanR(100, 0) * Ph.C.a0, col: 'rgba(255,200,150,0.8)' },
    { name: 'exciton, n = 25', m: 2 * Ph.meanR(25, 1) * 1.11e-9, col: 'rgba(255,200,150,0.8)' },
    { name: 'positronium 1s', m: 3 * 2 * Ph.C.a0, col: 'rgba(255,200,150,0.8)' }];
  drawRuler(g, r.width, r.height, marks);
}

// ---------------------------------------------------------------- UI
function seg(id, f) {
  $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); f(b.dataset.v); });
}
function tgl(id, f) { $(id).addEventListener('click', () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); f(on); }); }
function bindUI() {
  $('spChips').innerHTML = Object.values(Ph.SPECIES).map(s => `<button data-v="${s.id}" title="${esc(s.name)}">${esc(s.name)}</button>`).join('');
  $('spChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.sp = b.dataset.v;
    if (st.fam === 'mol' && st.sp !== 'Rb' && st.sp !== 'Cs') st.fam = 'nlm';
    if (st.fam === 'strongB' && st.sp !== 'H' && st.sp !== 'antiH') st.fam = 'nlm';
    if (st.sp === 'X') st.n = Math.min(st.n, 25);
    refresh(); });
  seg('famSeg', v => {
    st.fam = v; st.packet = false; st.cut = { mode: 0, axis: 1, pos: 0 };
    if (v === 'mol') { st.n = clamp(st.n, 20, 40); st.pitch = 0.04; st.yaw = 0; st.spin = false; st.cut = { mode: 2, axis: 1, pos: 0 }; }
    else if (v === 'para') { st.pitch = 0.3; st.circ = true; }
    else if (v === 'strongB') { st.pitch = 0.12; }
    else { st.pitch = 1.05; }
    $('spinBtn').classList.toggle('on', st.spin); syncCut(); refresh();
  });
  $('nIn').addEventListener('input', () => { st.n = +$('nIn').value; $('nOut').textContent = st.n; soon(); });
  $('lIn').addEventListener('input', () => { st.circ = false; if (st.fam === 'para') st.k = +$('lIn').value; else st.l = +$('lIn').value; soon(); });
  $('mIn').addEventListener('input', () => { st.circ = false; st.m = +$('mIn').value; soon(); });
  $('sbIn').addEventListener('input', () => { st.sb = +$('sbIn').value; $('sbOut').textContent = fmtB(Math.pow(10, st.sb)); soon(); });
  $('molR').addEventListener('input', () => { st.molR = +$('molR').value; $('molROut').textContent = `${st.molR.toFixed(2)} × well`; soon(); });
  $('molROut').textContent = '1.00 × well'; $('sbOut').textContent = fmtB(Math.pow(10, st.sb));
  seg('molSeg', v => { st.mol = v; refresh(); });
  tgl('circBtn', on => { st.circ = on; refresh(); });
  tgl('cmpBtn', on => { st.cmp = on; refresh(); });
  seg('colSeg', v => { st.colour = v; S.dirty = true; });
  tgl('packBtn', on => { st.packet = on; if (on && st.n > 140) st.n = 60; refresh(); });
  tgl('bohrBtn', on => { st.bohr = on; S.dirty = true; });
  tgl('spinBtn', on => { st.spin = on; });
  tgl('bBtn', on => { st.bOn = on; if (on && st.pitch > 0.8 && st.fam === 'nlm') st.pitch = 0.45; refresh(false); });
  tgl('spinLayerBtn', on => { st.spinLayer = on; refresh(false); });
  tgl('linesBtn', on => { st.lines = on; S.dirty = true; });
  tgl('arrowsBtn', on => { st.arrows = on; S.dirty = true; });
  tgl('magBtn', on => { st.mag = on; S.dirty = true; });
  tgl('extBBtn', on => { st.extB = on; $('extBRow').hidden = !on; refresh(false); });
  tgl('extEBtn', on => { st.extE = on; $('extERow').hidden = !on; if (on && st.fam === 'nlm') { st.fam = 'para'; st.circ = true; st.pitch = 0.3; } refresh(); });
  $('extBIn').addEventListener('input', () => { st.B = Math.pow(10, +$('extBIn').value); $('extBOut').textContent = fmtB(st.B); refresh(false); });
  $('extEIn').addEventListener('input', () => { st.F = Math.pow(10, +$('extEIn').value); $('extEOut').textContent = K.fmtVcm(st.F); refresh(false); });
  // drawer
  const picker = createPicker($('pickerHost'), { value: 'magma', compact: true });
  try { $('pickerHost').querySelector('.cmp').classList.add('cmp-dark'); } catch (e) { /* older picker */ }
  picker.set({ id: 'magma' }, { silent: true });
  picker.addEventListener('change', e => { const d = e.detail; st.cmap = { id: d.id, reverse: !!d.reverse, gamma: d.gamma || 1 }; S.dirty = true; });
  $('fmapSel').innerHTML = CM.list().filter(m => m.kind === 'sequential').map(m => `<option value="${m.id}"${m.id === st.fmap ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  $('fmapSel').addEventListener('change', () => { st.fmap = $('fmapSel').value; S.dirty = true; });
  $('expIn').addEventListener('input', () => { st.exposure = Math.pow(2, +$('expIn').value); $('expOut').textContent = `${st.exposure.toFixed(2)}×`; S.dirty = true; });
  $('floorIn').addEventListener('input', () => { st.floor = +$('floorIn').value; $('floorOut').textContent = st.floor.toFixed(2); S.dirty = true; });
  seg('cutSeg', v => { st.cut.mode = +v; S.dirty = true; });
  seg('axisSeg', v => { st.cut.axis = +v; S.dirty = true; });
  $('cutIn').addEventListener('input', () => { st.cut.pos = +$('cutIn').value; $('cutOut').textContent = st.cut.pos.toFixed(2); S.dirty = true; });
  $('sigIn').addEventListener('input', () => { st.sig = +$('sigIn').value; $('sigOut').textContent = st.sig.toFixed(1); soon(); });
  $('spdIn').addEventListener('input', () => { st.speed = +$('spdIn').value; $('spdOut').textContent = `${st.speed.toFixed(2)} T_K/s`; });
  seg('qSeg', v => { st.q = v; refresh(); });
  $('nLinesIn').addEventListener('input', () => { st.nLines = +$('nLinesIn').value; $('nLinesOut').textContent = st.nLines; if (S.F) { S.lines = Bf.fieldLines(S.F, { lines: st.nLines }); S.dirty = true; } });
  // panels
  $('qpCollapse').addEventListener('click', () => { $('qp').classList.toggle('collapsed'); S.dirty = true; });
  $('advBtn').addEventListener('click', () => { $('adv').classList.toggle('open'); S.dirty = true; });
  $('advClose').addEventListener('click', () => { $('adv').classList.remove('open'); S.dirty = true; });
  $('eqCollapse').addEventListener('click', () => { $('eq').classList.toggle('collapsed'); S.dirty = true; });
  $('guideBtn').addEventListener('click', () => openGuide(true));
  $('guideClose').addEventListener('click', () => openGuide(false));
  $('rulerBtn').addEventListener('click', () => toggleRuler());
  // sources
  $('srcList').innerHTML = Object.entries(Ph.SOURCES).map(([id, s]) => `<li id="ref-${id}">${esc(s.cite)} <a href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a></li>`).join('');
  const ids = Object.keys(Ph.SOURCES);
  $('doc').querySelectorAll('p, li').forEach(p => { p.innerHTML = p.innerHTML.replace(/\[([a-z0-9]+(?:, [a-z0-9]+)*)\]/g, (m0, list) => list.split(', ').map(k => ids.includes(k) ? `<a class="cite" href="#ref-${k}">[${ids.indexOf(k) + 1}]</a>` : m0).join(' ')); });
}
function syncCut() {
  $('cutSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === st.cut.mode));
  $('axisSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === st.cut.axis));
}
let typeset0 = false;
function openGuide(on) {
  $('guide').hidden = !on;
  if (on && !typeset0) { typeset0 = true; typesetAll($('doc')).catch(() => {}); }
  setTab(on ? 'guide' : null);
}
function toggleRuler(on = !st.ruler) { st.ruler = on; $('ruler').hidden = !on; $('rulerBtn').classList.toggle('on', on); if (on) drawRulerNow(); setTab(null); }

// ---------------------------------------------------------------- sheets
let tab = null;
function setTab(t) {
  tab = t;
  document.querySelectorAll('#dock button').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (b.dataset.tab === 'ruler' && st.ruler)));
  document.body.classList.toggle('sheet', !!t && t !== 'guide');
  S.dirty = true;
}
function sheets() {
  $('dock').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const t = b.dataset.tab, same = tab === t;
    $('qp').classList.remove('open'); $('adv').classList.remove('open'); $('guide').hidden = true;
    if (t === 'ruler') { toggleRuler(); return; }
    if (same) { setTab(null); return; }
    if (t === 'state' || t === 'fields') { $('qp').dataset.tab = t; $('qp').classList.add('open'); }
    else if (t === 'view') $('adv').classList.add('open');
    else if (t === 'guide') { openGuide(true); return; }
    setTab(t);
  });
  if (PHONE && innerWidth <= 860) $('eq').classList.add('collapsed');
}

// ---------------------------------------------------------------- pointer
let drag = false;
function bindPointer() {
  const ptrs = new Map(); let pinch0 = 0, zoom0 = 1;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture && cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); drag = true; cv.classList.add('drag'); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = st.zoom; } });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; st.zoom = clamp(zoom0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinch0), 0.3, 8); S.dirty = true; return; }
    st.yaw += (e.clientX - p[0]) * 0.008; st.pitch = clamp(st.pitch + (e.clientY - p[1]) * 0.008, -Math.PI / 2, Math.PI / 2 + 0.6); S.dirty = true;
  });
  const up = e => { ptrs.delete(e.pointerId); if (!ptrs.size) { drag = false; cv.classList.remove('drag'); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); st.zoom = clamp(st.zoom * Math.exp(-e.deltaY * 0.0012), 0.3, 8); S.dirty = true; }, { passive: false });
}

function boot() {
  try { bindUI(); } catch (e) { console.error('bindUI', e); }
  try { sheets(); bindPointer(); } catch (e) { console.error('sheets', e); }
  addEventListener('resize', () => { S.dirty = true; if (st.ruler) drawRulerNow(); });
  addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); if (S.job) S.job.cancel(); });
  addEventListener('pageshow', e => { if (!running) { running = true; lastT = 0; raf = requestAnimationFrame(loop); } });
  refresh();
  raf = requestAnimationFrame(loop);
  window.__ea = { st, S, refresh, readout, frame: () => frame(0.016) };
}
boot();

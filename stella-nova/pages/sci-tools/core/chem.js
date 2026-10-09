// ============================================================================
//  SCIENCE TOOLKIT  ·  core/chem.js  ·  formulas, balancing, pH, gases
// ----------------------------------------------------------------------------
//  Element data comes from the Periodic Table page of this site
//  (pages/periodic-table/data/elements.js). Its masses are the IUPAC
//  standard atomic weights (conventional values for H, C, N, O and the
//  other interval elements). An element with no standard atomic weight
//  (Tc, Pm, Po, ... ) carries the mass of its longest-lived isotope, and
//  molarMass() flags it.
//
//  formula()   "Ca3(PO4)2", "CuSO4·5H2O", "K4[Fe(CN)6]", "SO4^2-", "e-"
//              -> { counts: {El: n}, charge }
//  balance()   integer coefficients from the null space of the element
//              (and charge) matrix, in exact rational arithmetic (BigInt)
//  acidBase()  pH from the full charge balance of one acid system with
//              any number of pKa values, plus strong acid and strong base
//              (Brent on pH), with no activity correction
//  GASES       critical constants (NIST reference equations of state), and
//              van der Waals a, b from them
//
//  GREP MAP
//    grep -n "export function formula"
//    grep -n "export function molarMass"
//    grep -n "export function parseEquation"
//    grep -n "export function balance"
//    grep -n "export function acidBase"
//    grep -n "export const GASES"
// ============================================================================
import { ELEMENTS } from '../../periodic-table/data/elements.js';
import { brent } from './numeric.js';

export const EL = Object.fromEntries(ELEMENTS.map(e => [e.sym, e]));

// Formula text to atom counts and charge.
export function formula(text) {
  let s = String(text).trim().replace(/\s+/g, '').replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080));
  if (!s) throw new Error('The formula is empty.');
  // Charge: "^2-", "^+", "{3+}", or a trailing + or - (one unit).
  let charge = 0;
  let m = /\^\{?(\d*)([+-])\}?$/.exec(s) || /\{(\d*)([+-])\}$/.exec(s);
  if (m) { charge = (m[2] === '+' ? 1 : -1) * (m[1] ? Number(m[1]) : 1); s = s.slice(0, m.index); }
  else if ((m = /([+-]+)$/.exec(s))) { charge = (m[1][0] === '+' ? 1 : -1) * m[1].length; s = s.slice(0, m.index); }
  if (s === 'e') return { counts: {}, charge: charge || -1, electron: true };
  const parts = s.split(/[·•.*]/);
  const counts = {};
  parts.forEach((part, k) => {
    let mult = 1;
    const c = /^(\d+)(?=[A-Z([])/.exec(part);
    if (c && k > 0) { mult = Number(c[1]); part = part.slice(c[1].length); }
    else if (c && k === 0) throw new Error(`"${text}": a formula cannot start with a number (write the coefficient in the equation).`);
    const sub = group(part, 0, text);
    if (sub.i !== part.length) throw new Error(`"${text}": unexpected "${part[sub.i]}".`);
    for (const [el, n] of Object.entries(sub.counts)) counts[el] = (counts[el] || 0) + n * mult;
  });
  if (!Object.keys(counts).length) throw new Error(`"${text}" has no elements.`);
  return { counts, charge };
}

function group(s, i, text) {
  const counts = {};
  const add = (el, n) => { counts[el] = (counts[el] || 0) + n; };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(' || ch === '[') {
      const close = ch === '(' ? ')' : ']';
      const r = group(s, i + 1, text);
      if (s[r.i] !== close) throw new Error(`"${text}": "${ch}" has no matching "${close}".`);
      i = r.i + 1;
      const n = /^\d+/.exec(s.slice(i));
      const k = n ? Number(n[0]) : 1;
      if (n) i += n[0].length;
      for (const [el, c] of Object.entries(r.counts)) add(el, c * k);
    } else if (ch === ')' || ch === ']') break;
    else {
      const m = /^([A-Z][a-z]?)(\d*)/.exec(s.slice(i));
      if (!m) throw new Error(`"${text}": unexpected "${ch}". Element symbols start with a capital letter.`);
      let sym = m[1], len = m[0].length, num = m[2];
      if (!EL[sym] && sym.length === 2 && EL[sym[0]]) { sym = sym[0]; len = 1; num = ''; const d = /^\d+/.exec(s.slice(i + 1)); if (d) { num = d[0]; len += num.length; } }
      if (!EL[sym]) throw new Error(`"${text}": "${m[1]}" is not an element.`);
      add(sym, num ? Number(num) : 1);
      i += len;
    }
  }
  return { counts, i };
}

// Molar mass (g/mol) and composition.
export function molarMass(text) {
  const f = typeof text === 'string' ? formula(text) : text;
  let M = 0;
  const parts = [], noStd = [];
  for (const [el, n] of Object.entries(f.counts)) {
    const e = EL[el];
    if (e.massNum != null) noStd.push(el);
    M += n * e.mass;
    parts.push({ el, n, mass: e.mass, name: e.name, sub: n * e.mass });
  }
  parts.forEach(p => { p.frac = p.sub / M; });
  return { M, parts, charge: f.charge, noStd };
}

// "2H2 + O2 -> 2H2O" to { left: [{ coef, f, text }], right: [...] }.
export function parseEquation(text) {
  const sides = String(text).split(/\s*(?:<=>|<->|⇌|→|->|=>|=)\s*/);
  if (sides.length !== 2) throw new Error('Write the equation as "reactants -> products".');
  const side = (s) => s.split(/\s+\+\s+/).map(t => t.trim()).filter(Boolean).map(t => {
    const m = /^(\d+(?:\.\d+)?)\s*(.+)$/.exec(t);
    const coef = m ? Number(m[1]) : null, sp = m ? m[2] : t;
    return { coef, text: sp, f: formula(sp) };
  });
  const left = side(sides[0]), right = side(sides[1]);
  if (!left.length || !right.length) throw new Error('Each side needs at least one species.');
  return { left, right };
}

// ── exact rational null space ───────────────────────────────────────────────
const babs = (a) => a < 0n ? -a : a;
const bgcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
function frac(n, d = 1n) { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; return [n / g, d / g]; }
const fsub = (a, b) => frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const fmul = (a, b) => frac(a[0] * b[0], a[1] * b[1]);
const fdiv = (a, b) => frac(a[0] * b[1], a[1] * b[0]);

export function nullSpace(M) {
  const rows = M.length, cols = M[0].length;
  const A = M.map(r => r.map(v => frac(BigInt(v))));
  const piv = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let p = -1;
    for (let i = r; i < rows; i++) if (A[i][c][0] !== 0n) { p = i; break; }
    if (p < 0) continue;
    [A[p], A[r]] = [A[r], A[p]];
    const pv = A[r][c];
    A[r] = A[r].map(v => fdiv(v, pv));
    for (let i = 0; i < rows; i++) if (i !== r && A[i][c][0] !== 0n) {
      const f = A[i][c];
      A[i] = A[i].map((v, j) => fsub(v, fmul(f, A[r][j])));
    }
    piv.push(c); r++;
  }
  const free = [...Array(cols).keys()].filter(c => !piv.includes(c));
  return free.map(fc => {
    const v = Array.from({ length: cols }, () => frac(0n));
    v[fc] = frac(1n);
    piv.forEach((pc, i) => { v[pc] = frac(-A[i][fc][0], A[i][fc][1]); });
    // Scale to integers.
    let l = 1n;
    for (const [, d] of v) l = l / bgcd(l, d) * d;
    let ints = v.map(([n, d]) => n * (l / d));
    const g = ints.reduce((a, b) => bgcd(a, b), 0n) || 1n;
    ints = ints.map(x => x / g);
    return ints;
  });
}

// Balance an equation. Returns integer coefficients for left then right.
export function balance(eq) {
  const species = [...eq.left, ...eq.right];
  const els = [...new Set(species.flatMap(s => Object.keys(s.f.counts)))];
  const rows = els.map(el => species.map((s, j) => (j < eq.left.length ? 1 : -1) * (s.f.counts[el] || 0)));
  if (species.some(s => s.f.charge)) rows.push(species.map((s, j) => (j < eq.left.length ? 1 : -1) * s.f.charge));
  const ns = nullSpace(rows);
  if (ns.length === 0) throw new Error('This equation cannot be balanced: the elements on the two sides do not match.');
  if (ns.length > 1) throw new Error(`This equation has ${ns.length} independent balanced forms (it mixes reactions). Split it into separate reactions.`);
  let v = ns[0];
  if (v.every(x => x <= 0n)) v = v.map(x => -x);
  if (v.some(x => x <= 0n)) throw new Error('No balance has every coefficient positive: a species is on the wrong side or does not take part.');
  return v.map(Number);
}

export function equationText(eq, coefs) {
  const side = (list, off) => list.map((s, i) => `${coefs[off + i] === 1 ? '' : coefs[off + i] + ' '}${s.text}`).join(' + ');
  return `${side(eq.left, 0)} → ${side(eq.right, eq.left.length)}`;
}

// ── acid–base equilibrium ───────────────────────────────────────────────────
// Fractions of the species H(n-j)A, j = 0..n, at [H+] = h.
export function alphas(h, Ka) {
  const n = Ka.length, terms = [];
  let prod = 1;
  for (let j = 0; j <= n; j++) {
    terms.push(h ** (n - j) * prod);
    if (j < n) prod *= Ka[j];
  }
  const s = terms.reduce((a, b) => a + b, 0);
  return terms.map(t => t / s);
}

// System: { C (total of the acid system), pKa: [..], z0 (charge of the
// fully protonated form: 0 for HA, +1 for BH+), Cb (strong base cation),
// Ca (strong acid anion), Kw }.
export function acidBase({ C = 0, pKa = [], z0 = 0, Cb = 0, Ca = 0, Kw = 1e-14 }) {
  const Ka = pKa.map(p => 10 ** -p);
  const f = (pH) => {
    const h = 10 ** -pH, oh = Kw / h;
    let net = h - oh + Cb - Ca;
    if (C > 0 && Ka.length) {
      const a = alphas(h, Ka);
      a.forEach((x, j) => { net += (z0 - j) * C * x; });
    } else if (C > 0) net += z0 * C;
    return net;
  };
  const r = brent(f, -3, 17, 1e-14);
  const h = 10 ** -r.x;
  return { pH: r.x, h, oh: Kw / h, pOH: -Math.log10(Kw) - r.x, alpha: Ka.length ? alphas(h, Ka) : [] };
}

// ── gases ───────────────────────────────────────────────────────────────────
// Critical temperature (K) and pressure (MPa), from the NIST Chemistry
// WebBook (reference equations of state: Span–Wagner CO2, IAPWS-95 water,
// Span N2, Schmidt–Wagner O2, Tegeler Ar, Setzmann–Wagner CH4, and so on).
export const GASES = {
  He: ['helium', 5.1953, 0.22746], Ne: ['neon', 44.4918, 2.6786], Ar: ['argon', 150.687, 4.863], Kr: ['krypton', 209.48, 5.525], Xe: ['xenon', 289.733, 5.842],
  H2: ['hydrogen', 33.145, 1.2964], N2: ['nitrogen', 126.192, 3.3958], O2: ['oxygen', 154.581, 5.043], CO: ['carbon monoxide', 132.86, 3.494],
  CO2: ['carbon dioxide', 304.1282, 7.3773], H2O: ['water', 647.096, 22.064], NH3: ['ammonia', 405.4, 11.333], CH4: ['methane', 190.564, 4.5992],
  C2H6: ['ethane', 305.322, 4.8722], Cl2: ['chlorine', 416.9, 7.991],
};
// van der Waals a (Pa m^6 mol^-2) and b (m^3 mol^-1) from Tc, Pc.
export function vdwConst(sym, R = 8.31446261815324) {
  const g = GASES[sym];
  if (!g) throw new Error('Unknown gas.');
  const Tc = g[1], Pc = g[2] * 1e6;
  return { a: 27 * R * R * Tc * Tc / (64 * Pc), b: R * Tc / (8 * Pc), Tc, Pc, name: g[0] };
}

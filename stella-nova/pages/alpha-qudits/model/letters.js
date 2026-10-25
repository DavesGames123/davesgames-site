// ============================================================================
//  ALPHA QUDITS  ·  model/letters.js  ·  letters, reads and their phases (MODEL)
// ----------------------------------------------------------------------------
//  A letter is a basis element of the traceless observables of one end:
//  the 3 Pauli matrices at a qubit, the 8 Gell-Mann matrices at a qutrit.
//  A read at an end of prime dimension d is one of the d + 1 mutually
//  unbiased bases (MUBs) of the clock and shift operators (Wootters and
//  Fields 1989). The Weyl phase of clock and shift is the phase lambda in
//  Z X = lambda X Z. It is -1 at a qubit and a cube root of unity at a
//  qutrit. Only a sign lets the order of two reads label a record, so
//  commutator records exist only at ends of even dimension.
//
//  grep -n targets:  export function pauli | gellMann | letters |
//  letterInfo | clockShift | weylPhase | anticommutingReads | mubs |
//  mubTracelessRank | commutatorLetter
// ============================================================================
import { fromRows, zeros, mul, scale, sub, commutator, anticommutator,
  isZero, expand, identity } from './complex.js';

const I = (v) => [0, v];

// sigma_x, sigma_y, sigma_z.
export function pauli() {
  return [
    fromRows([[0, 1], [1, 0]]),
    fromRows([[0, I(-1)], [I(1), 0]]),
    fromRows([[1, 0], [0, -1]]),
  ];
}

// lambda_1 .. lambda_8 (Gell-Mann 1962), standard normalisation tr = 2.
export function gellMann() {
  const s3 = 1 / Math.sqrt(3);
  return [
    fromRows([[0, 1, 0], [1, 0, 0], [0, 0, 0]]),
    fromRows([[0, I(-1), 0], [I(1), 0, 0], [0, 0, 0]]),
    fromRows([[1, 0, 0], [0, -1, 0], [0, 0, 0]]),
    fromRows([[0, 0, 1], [0, 0, 0], [1, 0, 0]]),
    fromRows([[0, 0, I(-1)], [0, 0, 0], [I(1), 0, 0]]),
    fromRows([[0, 0, 0], [0, 0, 1], [0, 1, 0]]),
    fromRows([[0, 0, 0], [0, 0, I(-1)], [0, I(1), 0]]),
    fromRows([[s3, 0, 0], [0, s3, 0], [0, 0, -2 * s3]]),
  ];
}

// The letters of an end of dimension d (2 or 3).
export function letters(d) {
  if (d === 2) return pauli();
  if (d === 3) return gellMann();
  throw new Error('letters: d must be 2 or 3, got ' + d);
}

const PAULI_INFO = [
  { name: 'σx', tex: '\\sigma_x', kind: 'sym', at: [0, 1] },
  { name: 'σy', tex: '\\sigma_y', kind: 'anti', at: [0, 1] },
  { name: 'σz', tex: '\\sigma_z', kind: 'diag', diag: [1, -1] },
];
const GM_INFO = [
  { name: 'λ1', tex: '\\lambda_1', kind: 'sym', at: [0, 1] },
  { name: 'λ2', tex: '\\lambda_2', kind: 'anti', at: [0, 1] },
  { name: 'λ3', tex: '\\lambda_3', kind: 'diag', diag: [1, -1, 0] },
  { name: 'λ4', tex: '\\lambda_4', kind: 'sym', at: [0, 2] },
  { name: 'λ5', tex: '\\lambda_5', kind: 'anti', at: [0, 2] },
  { name: 'λ6', tex: '\\lambda_6', kind: 'sym', at: [1, 2] },
  { name: 'λ7', tex: '\\lambda_7', kind: 'anti', at: [1, 2] },
  { name: 'λ8', tex: '\\lambda_8', kind: 'diag', diag: [1, 1, -2] },
];

// Drawing data for letter i at an end of dimension d. kind is 'sym'
// (a straight line between basis dots `at`), 'anti' (a curved line) or
// 'diag' (filled and hollow dots, signs in `diag`). symmetric is true for
// real symmetric letters (5 at a qutrit, 2 at a qubit).
export function letterInfo(d, i) {
  const t = d === 2 ? PAULI_INFO : d === 3 ? GM_INFO : null;
  if (!t || !t[i]) throw new Error(`letterInfo: no letter ${i} at d=${d}`);
  return { ...t[i], index: i, d, symmetric: t[i].kind !== 'anti' };
}

// Clock Z = diag(omega^j) and shift X|j> = |j+1>, omega = exp(2 pi i / d).
export function clockShift(d) {
  const Z = zeros(d), X = zeros(d);
  for (let j = 0; j < d; j++) {
    Z.re[j][j] = Math.cos(2 * Math.PI * j / d); Z.im[j][j] = Math.sin(2 * Math.PI * j / d);
    X.re[(j + 1) % d][j] = 1;
  }
  return { Z, X };
}

// lambda with Z X = lambda X Z, found from the matrices, not from a formula.
export function weylPhase(d) {
  const { Z, X } = clockShift(d);
  const zx = mul(Z, X), xz = mul(X, Z);
  // Find a non-zero entry of xz and divide.
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    const ar = xz.re[i][j], ai = xz.im[i][j], m = ar * ar + ai * ai;
    if (m > 1e-12) {
      const br = zx.re[i][j], bi = zx.im[i][j];
      const re = (br * ar + bi * ai) / m, im = (bi * ar - br * ai) / m;
      return { re: clean(re), im: clean(im), isSign: Math.abs(im) < 1e-12 && Math.abs(Math.abs(re) - 1) < 1e-12 };
    }
  }
  throw new Error('weylPhase: zero matrix');
}
function clean(x) { return Math.abs(x) < 1e-13 ? 0 : x; }

// True when two reads at an end of dimension d can anticommute: the Weyl
// phase must equal its own inverse (a sign), and lambda^d = 1 then forces
// d even (Corollary S4).
export function anticommutingReads(d) {
  const w = weylPhase(d);
  return w.isSign && w.re === -1;
}

// The d + 1 MUBs at d = 2 or 3. Each basis is an array of d vectors
// { re: number[], im: number[] }. Basis 0 is the eigenbasis of Z.
export function mubs(d) {
  const r = 1 / Math.sqrt(d), out = [];
  const comp = [];
  for (let m = 0; m < d; m++) { const re = new Array(d).fill(0); re[m] = 1; comp.push({ re, im: new Array(d).fill(0) }); }
  out.push(comp);
  if (d === 2) {
    out.push([{ re: [r, r], im: [0, 0] }, { re: [r, -r], im: [0, 0] }]);
    out.push([{ re: [r, 0], im: [0, r] }, { re: [r, 0], im: [0, -r] }]);
    return out;
  }
  if (d === 3) {
    // Odd prime d: components omega^(k j^2 + m j) / sqrt(d), k, m = 0 .. d-1.
    for (let k = 0; k < d; k++) {
      const basis = [];
      for (let m = 0; m < d; m++) {
        const re = [], im = [];
        for (let j = 0; j < d; j++) {
          const ph = 2 * Math.PI * ((k * j * j + m * j) % d) / d;
          re.push(r * Math.cos(ph)); im.push(r * Math.sin(ph));
        }
        basis.push({ re, im });
      }
      out.push(basis);
    }
    return out;
  }
  throw new Error('mubs: d must be 2 or 3');
}

// Projector |v><v| as a matrix.
export function projector(v) {
  const d = v.re.length, p = zeros(d);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    p.re[i][j] = v.re[i] * v.re[j] + v.im[i] * v.im[j];
    p.im[i][j] = v.im[i] * v.re[j] - v.re[i] * v.im[j];
  }
  return p;
}

// Traceless parts P - 1/d of every MUB projector, as real vectors on the
// letter basis. Returns { parts: [{basis, element, coeffs}], rank }.
// The rank is d^2 - 1: the reads span every traceless observable.
export function mubTracelessRank(d) {
  const L = letters(d), parts = [];
  mubs(d).forEach((basis, b) => basis.forEach((v, e) => {
    const t = sub(projector(v), scale(identity(d), 1 / d));
    parts.push({ basis: b, element: e, coeffs: expand(t, L).map(c => c.re) });
  }));
  return { parts, rank: realRank(parts.map(p => p.coeffs)) };
}

function realRank(rows) {
  const m = rows.map(r => r.slice());
  let rank = 0; const cols = m[0].length;
  for (let c = 0; c < cols && rank < m.length; c++) {
    let p = rank;
    for (let i = rank + 1; i < m.length; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;
    if (Math.abs(m[p][c]) < 1e-9) continue;
    [m[rank], m[p]] = [m[p], m[rank]];
    for (let i = 0; i < m.length; i++) if (i !== rank) {
      const f = m[i][c] / m[rank][c];
      for (let j = c; j < cols; j++) m[i][j] -= f * m[rank][j];
    }
    rank++;
  }
  return rank;
}

// The commutator [L_mu, L_nu] of two letters at an end of dimension d,
// expanded on the letters. Returns { single, letter, coeff } where single
// is true when the commutator is one letter times a constant.
export function commutatorLetter(d, mu, nu) {
  const L = letters(d);
  const c = commutator(L[mu], L[nu]);
  const co = expand(c, L);
  const nz = co.map((z, k) => ({ k, z })).filter(o => Math.hypot(o.z.re, o.z.im) > 1e-12);
  return nz.length === 1
    ? { single: true, letter: nz[0].k, coeff: { re: clean(nz[0].z.re), im: clean(nz[0].z.im) } }
    : { single: false, terms: nz.map(o => ({ letter: o.k, coeff: o.z })) };
}

// Do letters mu and nu anticommute as matrices?
export function lettersAnticommute(d, mu, nu) {
  const L = letters(d);
  return isZero(anticommutator(L[mu], L[nu]));
}


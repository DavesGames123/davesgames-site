// ============================================================================
//  ALPHA QUDITS  ·  ends/linalg.js  ·  the exact numbers behind the ENDS figures
// ----------------------------------------------------------------------------
//  DOM-free. Every number that an ENDS figure shows comes from this file, so
//  ends/tests.mjs can check it in node. Nothing here is copied from the
//  paper's tables: the figures compute the transpose identity, the bases,
//  the letters, the Choi map test and the block algebra on the fly.
//
//  A complex matrix is { n, m, re, im } with row-major Float64Array data.
//
//  GREP MAP   (grep -n "<anchor>" linalg.js)
//    export function cm ............. new n x m complex matrix
//    export function mul / add / kron / adj / transpose / conj / trace
//    export function pauli .......... the 3 Pauli letters
//    export function gellMann ....... the 8 Gell-Mann letters, with kind
//    export function mubs ........... d + 1 mutually unbiased bases, d = 2, 3
//    export function readLetters .... traceless parts of the read projectors
//    export function blochOf ........ Bloch vector of a qubit ket
//    export function rot2 / rotU .... real turns and complex matchings
//    export function coeffMatrix .... the pair ket as its d x d coefficients
//    export function weylPhase ...... clock-shift phase, lambda with ZX = lambda XZ
//    export function signPossible ... lambda^2 = 1 and lambda^d = 1 test
//    export function eigSym ......... Jacobi eigenvalues of a real symmetric
//    export function hermEig ........ eigenvalues of a Hermitian matrix
//    export function choiMap ........ Choi's positive map on M3
//    export function choiMatrix ..... the Choi-Jamiolkowski matrix of a map
//    export function horodeckiState . the 3 x 3 state sigma_alpha (PPT family)
//    export function partialT ....... partial transpose on the second factor
//    export function applySecond .... (1 (x) Phi) on a d x d bipartite matrix
//    export function readCapLocal ... d1 d2 <= 6 with the reason for each cell
//    export function idBasis ........ the 12 generators e1..e12 on C2 (+) C3
//    export function linkAction ..... (xi1 (x) 1 + 1 (x) xi2) on a link ket
//    export function actionRank ..... rank of the 12 generators on the pair ket
//    export function nullSpace ...... null space of a real matrix
// ============================================================================

export function cm(n, m = n) { return { n, m, re: new Float64Array(n * m), im: new Float64Array(n * m) }; }
export function fromRows(re, im) {
  const n = re.length, m = re[0].length, A = cm(n, m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { A.re[i * m + j] = re[i][j]; A.im[i * m + j] = im ? im[i][j] : 0; }
  return A;
}
export function eye(n) { const A = cm(n); for (let i = 0; i < n; i++) A.re[i * n + i] = 1; return A; }
export function mul(A, B) {
  const C = cm(A.n, B.m);
  for (let i = 0; i < A.n; i++) for (let k = 0; k < A.m; k++) {
    const ar = A.re[i * A.m + k], ai = A.im[i * A.m + k];
    if (ar === 0 && ai === 0) continue;
    for (let j = 0; j < B.m; j++) {
      const br = B.re[k * B.m + j], bi = B.im[k * B.m + j];
      C.re[i * C.m + j] += ar * br - ai * bi; C.im[i * C.m + j] += ar * bi + ai * br;
    }
  }
  return C;
}
export function add(A, B, s = 1) { const C = cm(A.n, A.m); for (let i = 0; i < A.re.length; i++) { C.re[i] = A.re[i] + s * B.re[i]; C.im[i] = A.im[i] + s * B.im[i]; } return C; }
export function scale(A, sr, si = 0) { const C = cm(A.n, A.m); for (let i = 0; i < A.re.length; i++) { C.re[i] = A.re[i] * sr - A.im[i] * si; C.im[i] = A.re[i] * si + A.im[i] * sr; } return C; }
export function transpose(A) { const C = cm(A.m, A.n); for (let i = 0; i < A.n; i++) for (let j = 0; j < A.m; j++) { C.re[j * A.n + i] = A.re[i * A.m + j]; C.im[j * A.n + i] = A.im[i * A.m + j]; } return C; }
export function conj(A) { const C = cm(A.n, A.m); C.re.set(A.re); for (let i = 0; i < A.im.length; i++) C.im[i] = -A.im[i]; return C; }
export function adj(A) { return conj(transpose(A)); }
export function trace(A) { let r = 0, i = 0; for (let k = 0; k < A.n; k++) { r += A.re[k * A.m + k]; i += A.im[k * A.m + k]; } return [r, i]; }
export function kron(A, B) {
  const C = cm(A.n * B.n, A.m * B.m);
  for (let i = 0; i < A.n; i++) for (let j = 0; j < A.m; j++) {
    const ar = A.re[i * A.m + j], ai = A.im[i * A.m + j];
    for (let k = 0; k < B.n; k++) for (let l = 0; l < B.m; l++) {
      const br = B.re[k * B.m + l], bi = B.im[k * B.m + l], idx = (i * B.n + k) * C.m + j * B.m + l;
      C.re[idx] = ar * br - ai * bi; C.im[idx] = ar * bi + ai * br;
    }
  }
  return C;
}
export function maxAbsDiff(A, B) { let d = 0; for (let i = 0; i < A.re.length; i++) d = Math.max(d, Math.hypot(A.re[i] - B.re[i], A.im[i] - B.im[i])); return d; }
// (A, B) -> tr(A^dagger B), the trace pairing
export function hs(A, B) { return trace(mul(adj(A), B)); }

// ---------------------------------------------------------------- letters
// The Pauli matrices: the 3 traceless observables of a qubit end.
export function pauli() {
  return [
    fromRows([[0, 1], [1, 0]]),
    fromRows([[0, 0], [0, 0]], [[0, -1], [1, 0]]),
    fromRows([[1, 0], [0, -1]]),
  ];
}
// The Gell-Mann matrices: the 8 traceless observables of a qutrit end.
// kind 'sym' (real symmetric, 5 of them) or 'anti' (imaginary antisymmetric, 3).
export function gellMann() {
  const s3 = 1 / Math.sqrt(3), Z = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const L = [
    { name: 'λ1', kind: 'sym', re: [[0, 1, 0], [1, 0, 0], [0, 0, 0]], im: Z },
    { name: 'λ2', kind: 'anti', re: Z, im: [[0, -1, 0], [1, 0, 0], [0, 0, 0]] },
    { name: 'λ3', kind: 'sym', re: [[1, 0, 0], [0, -1, 0], [0, 0, 0]], im: Z },
    { name: 'λ4', kind: 'sym', re: [[0, 0, 1], [0, 0, 0], [1, 0, 0]], im: Z },
    { name: 'λ5', kind: 'anti', re: Z, im: [[0, 0, -1], [0, 0, 0], [1, 0, 0]] },
    { name: 'λ6', kind: 'sym', re: [[0, 0, 0], [0, 0, 1], [0, 1, 0]], im: Z },
    { name: 'λ7', kind: 'anti', re: Z, im: [[0, 0, 0], [0, 0, -1], [0, 1, 0]] },
    { name: 'λ8', kind: 'sym', re: [[s3, 0, 0], [0, s3, 0], [0, 0, -2 * s3]], im: Z },
  ];
  return L.map(l => Object.assign(fromRows(l.re, l.im), { name: l.name, kind: l.kind }));
}

// ---------------------------------------------------------------- bases
// A ket is { re: number[], im: number[] }.
const ket = (re, im) => ({ re, im: im || re.map(() => 0) });
export function inner(a, b) { // <a|b>
  let r = 0, i = 0;
  for (let k = 0; k < a.re.length; k++) { r += a.re[k] * b.re[k] + a.im[k] * b.im[k]; i += a.re[k] * b.im[k] - a.im[k] * b.re[k]; }
  return [r, i];
}
export function projector(v) {
  const d = v.re.length, P = cm(d);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    P.re[i * d + j] = v.re[i] * v.re[j] + v.im[i] * v.im[j];
    P.im[i * d + j] = v.im[i] * v.re[j] - v.re[i] * v.im[j];
  }
  return P;
}
// d + 1 mutually unbiased bases of the clock and shift operators
// (Wootters and Fields 1989): the standard basis, then for d = 3 the bases
// v[k][j]_n = w^(j n + k n^2) / sqrt 3, and for d = 2 the x and y bases.
// Each basis: { name, axis, vecs: [ket...] }.
export function mubs(d) {
  if (d === 2) {
    const h = Math.SQRT1_2;
    return [
      { name: 'z', vecs: [ket([1, 0]), ket([0, 1])] },
      { name: 'x', vecs: [ket([h, h]), ket([h, -h])] },
      { name: 'y', vecs: [ket([h, 0], [0, h]), ket([h, 0], [0, -h])] },
    ];
  }
  if (d === 3) {
    const out = [{ name: 'Z', vecs: [ket([1, 0, 0]), ket([0, 1, 0]), ket([0, 0, 1])] }];
    const s = 1 / Math.sqrt(3);
    for (let k = 0; k < 3; k++) {
      const vecs = [];
      for (let j = 0; j < 3; j++) {
        const re = [], im = [];
        for (let n = 0; n < 3; n++) { const p = 2 * Math.PI * ((j * n + k * n * n) % 3) / 3; re.push(s * Math.cos(p)); im.push(s * Math.sin(p)); }
        vecs.push(ket(re, im));
      }
      out.push({ name: k === 0 ? 'X' : k === 1 ? 'XZ' : 'XZ²', vecs });
    }
    return out;
  }
  throw new Error('mubs: d must be 2 or 3');
}
// The traceless parts P - 1/d of the read projectors: d - 1 independent per
// basis, (d + 1)(d - 1) = d^2 - 1 in all. Returns [{ basis, j, A }].
export function readLetters(d) {
  const out = [];
  mubs(d).forEach((B, b) => B.vecs.forEach((v, j) => { out.push({ basis: b, j, A: add(projector(v), scale(eye(d), 1 / d), -1) }); }));
  return out;
}
// Rank of a list of complex matrices as real vectors (Gram-Schmidt).
export function spanRank(mats, tol = 1e-9) {
  const basis = [];
  for (const M of mats) {
    let v = Array.from(M.re).concat(Array.from(M.im));
    for (const b of basis) { const p = v.reduce((s, x, i) => s + x * b[i], 0); v = v.map((x, i) => x - p * b[i]); }
    const nrm = Math.hypot(...v);
    if (nrm > tol) basis.push(v.map(x => x / nrm));
  }
  return basis.length;
}
// Bloch vector (x, y, z) of a qubit ket.
export function blochOf(v) {
  const [a, b] = [[v.re[0], v.im[0]], [v.re[1], v.im[1]]];
  // rho01 = a * conj(b)
  const r01 = a[0] * b[0] + a[1] * b[1], i01 = a[1] * b[0] - a[0] * b[1];
  return [2 * r01, -2 * i01, (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1])];
}

// ---------------------------------------------------------------- turns
// A real turn by t radians in the plane of directions (p, q) of C^d.
export function rot2(d, t, p = 0, q = 1) {
  const R = eye(d), c = Math.cos(t), s = Math.sin(t);
  R.re[p * d + p] = c; R.re[q * d + q] = c; R.re[p * d + q] = -s; R.re[q * d + p] = s;
  return R;
}
// A complex matching: a real turn t times the phases diag(e^{i f_k}).
export function rotU(d, t, phases) {
  const D = cm(d);
  for (let k = 0; k < d; k++) { const f = phases ? phases[k] || 0 : 0; D.re[k * d + k] = Math.cos(f); D.im[k * d + k] = Math.sin(f); }
  return mul(rot2(d, t), D);
}
// The pair ket sum_i |i>|i>/sqrt(m) as its coefficient matrix C, with
// |psi> = sum C_ij |i>|j>. (A (x) B)|psi> has coefficients A C B^T.
export function coeffMatrix(m) { return scale(eye(m), 1 / Math.sqrt(m)); }
export function actPair(C, A, B) { return mul(mul(A || eye(C.n), C), transpose(B || eye(C.m))); }

// ---------------------------------------------------------------- Weyl phase
// The clock Z and shift X at dimension d, and lambda with Z X = lambda X Z.
export function clockShift(d) {
  const Z = cm(d), X = cm(d);
  for (let k = 0; k < d; k++) {
    const p = 2 * Math.PI * k / d; Z.re[k * d + k] = Math.cos(p); Z.im[k * d + k] = Math.sin(p);
    X.re[((k + 1) % d) * d + k] = 1;
  }
  return { Z, X };
}
export function weylPhase(d) {
  const { Z, X } = clockShift(d), ZX = mul(Z, X), XZ = mul(X, Z);
  // ZX = lambda XZ: read lambda off the first non-zero entry
  for (let i = 0; i < d * d; i++) {
    const br = XZ.re[i], bi = XZ.im[i], n2 = br * br + bi * bi;
    if (n2 > 1e-12) { const ar = ZX.re[i], ai = ZX.im[i]; return [(ar * br + ai * bi) / n2, (ai * br - ar * bi) / n2]; }
  }
  return [NaN, NaN];
}
// Which d-th roots of unity can be an order sign: lambda^d = 1 and lambda = 1/lambda.
export function signPossible(d) {
  const out = [];
  for (let k = 0; k < d; k++) { const p = 2 * Math.PI * k / d, re = Math.cos(p), im = Math.sin(p); out.push({ k, re, im, sign: Math.abs(im) < 1e-12 }); }
  return out;
}

// ---------------------------------------------------------------- eigen
// Jacobi eigenvalues of a real symmetric n x n (array of rows or flat).
export function eigSym(M, n) {
  const a = M instanceof Float64Array ? Float64Array.from(M) : Float64Array.from(M.flat());
  n = n || Math.round(Math.sqrt(a.length));
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-26) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
      const th = (a[q * n + q] - a[p * n + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k * n + p], akq = a[k * n + q]; a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p * n + k], aqk = a[q * n + k]; a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk; }
    }
  }
  const ev = []; for (let i = 0; i < n; i++) ev.push(a[i * n + i]);
  return ev.sort((x, y) => x - y);
}
// Eigenvalues of a Hermitian complex matrix: the real 2n form [[A, -B], [B, A]]
// has each eigenvalue twice.
export function hermEig(H) {
  const n = H.n, N = 2 * n, R = new Float64Array(N * N);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const re = H.re[i * n + j], im = H.im[i * n + j];
    R[i * N + j] = re; R[(i + n) * N + j + n] = re; R[i * N + j + n] = -im; R[(i + n) * N + j] = im;
  }
  const ev = eigSym(R, N), out = [];
  for (let i = 0; i < N; i += 2) out.push((ev[i] + ev[i + 1]) / 2);
  return out;
}

// ---------------------------------------------------------------- the dark key
// Choi's map on M3 (Choi 1975): Phi(X)_ii = x_ii + x_(i+2)(i+2) (indices mod 3),
// Phi(X)_ij = -x_ij off the diagonal. It is positive, not completely
// positive, and not decomposable.
export function choiMap(X) {
  const Y = scale(X, -1);
  for (let i = 0; i < 3; i++) {
    const k = (i + 2) % 3;
    Y.re[i * 3 + i] = X.re[i * 3 + i] + X.re[k * 3 + k];
    Y.im[i * 3 + i] = X.im[i * 3 + i] + X.im[k * 3 + k];
  }
  return Y;
}
export function transposeMap(X) { return transpose(X); }
// Choi-Jamiolkowski matrix sum_ij E_ij (x) Phi(E_ij), dimension d * d'.
export function choiMatrix(phi, d) {
  const blocks = [];
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) { const E = cm(d); E.re[i * d + j] = 1; blocks.push(phi(E)); }
  const e = blocks[0].n, C = cm(d * e);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    const B = blocks[i * d + j];
    for (let a = 0; a < e; a++) for (let b = 0; b < e; b++) { const idx = (i * e + a) * (d * e) + j * e + b; C.re[idx] = B.re[a * e + b]; C.im[idx] = B.im[a * e + b]; }
  }
  return C;
}
// The PPT family of P., M. and R. Horodecki (Phys. Rev. Lett. 82, 1056, 1999):
// sigma_a = 2/7 P+ + a/7 sigma_+ + (5 - a)/7 sigma_-, on C3 (x) C3.
// Separable for 2 <= a <= 3, entangled with a positive partial transpose for
// 3 < a <= 4, not PPT for 4 < a <= 5.
export function horodeckiState(a) {
  const S = cm(9), idx = (i, j) => i * 3 + j;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S.re[idx(i, i) * 9 + idx(j, j)] += (2 / 7) / 3;
  for (let i = 0; i < 3; i++) {
    const p = idx(i, (i + 1) % 3), m = idx((i + 1) % 3, i);
    S.re[p * 9 + p] += a / 7 / 3;       // sigma_+ = (1/3) sum |i, i+1><i, i+1|
    S.re[m * 9 + m] += (5 - a) / 7 / 3; // sigma_- = (1/3) sum |i+1, i><i+1, i|
  }
  return S;
}
// (X)^{T_B}: transpose of the second factor of a (dA dB) x (dA dB) matrix.
export function partialT(S, dA, dB) {
  const N = dA * dB, T = cm(N);
  for (let i = 0; i < dA; i++) for (let a = 0; a < dB; a++) for (let j = 0; j < dA; j++) for (let b = 0; b < dB; b++) {
    const from = (i * dB + a) * N + j * dB + b, to = (i * dB + b) * N + j * dB + a;
    T.re[to] = S.re[from]; T.im[to] = S.im[from];
  }
  return T;
}
// (1 (x) Phi)(S) for a map Phi on the second factor of dimension dB.
export function applySecond(S, dA, dB, phi) {
  const N = dA * dB, T = cm(N);
  for (let i = 0; i < dA; i++) for (let j = 0; j < dA; j++) {
    const B = cm(dB);
    for (let a = 0; a < dB; a++) for (let b = 0; b < dB; b++) { B.re[a * dB + b] = S.re[(i * dB + a) * N + j * dB + b]; B.im[a * dB + b] = S.im[(i * dB + a) * N + j * dB + b]; }
    const P = phi(B);
    for (let a = 0; a < dB; a++) for (let b = 0; b < dB; b++) { T.re[(i * dB + a) * N + j * dB + b] = P.re[a * dB + b]; T.im[(i * dB + a) * N + j * dB + b] = P.im[a * dB + b]; }
  }
  return T;
}
// A random unit ket of dimension d from a seeded generator rnd() in [0, 1).
export function randomKet(d, rnd) {
  const re = [], im = [];
  for (let k = 0; k < d; k++) { const u = Math.max(1e-12, rnd()), v = rnd(), r = Math.sqrt(-2 * Math.log(u)); re.push(r * Math.cos(2 * Math.PI * v)); const u2 = Math.max(1e-12, rnd()), v2 = rnd(); im.push(Math.sqrt(-2 * Math.log(u2)) * Math.cos(2 * Math.PI * v2)); }
  const n = Math.hypot(...re, ...im);
  return ket(re.map(x => x / n), im.map(x => x / n));
}
export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The read cap per cell, with the reason the paper gives for it.
// state: 'open' (every positive map decomposable), 'dark' (a key no read cuts).
export function readCapLocal(d1, d2) {
  const lo = Math.min(d1, d2), hi = Math.max(d1, d2), p = d1 * d2;
  if (lo === 2 && hi === 2) return { p, open: true, src: 'Størmer 1963' };
  if (lo === 2 && hi === 3) return { p, open: true, src: 'Woronowicz 1976' };
  if (lo === 2 && hi === 4) return { p, open: false, src: 'Woronowicz 1976', origin: true };
  if (lo === 3 && hi === 3) return { p, open: false, src: 'Choi 1975', origin: true };
  return { p, open: false, src: lo === 2 ? 'from (2, 4)' : 'from (3, 3)', from: lo === 2 ? [2, 4] : [3, 3] };
}
export function centralChargeLocal(d1, d2) { return d2 - d1; } // Q acts as i (d2 - d1)

// ---------------------------------------------------------------- the block algebra
// The 12 generators of Sec. S10 on C2 (+) C3: indices 0, 1 qubit; 2, 3, 4 qutrit.
export function idBasis() {
  const E = (pairs) => { const A = cm(5); for (const [a, b, re, im] of pairs) { A.re[a * 5 + b] += re; A.im[a * 5 + b] += im; } return A; };
  const anti = (a, b) => E([[a, b, 1, 0], [b, a, -1, 0]]);
  const symI = (a, b) => E([[a, b, 0, 1], [b, a, 0, 1]]);
  const diagI = (a, b) => E([[a, a, 0, 1], [b, b, 0, -1]]);
  const Q = E([[0, 0, 0, 3], [1, 1, 0, 3], [2, 2, 0, -2], [3, 3, 0, -2], [4, 4, 0, -2]]);
  const list = [anti(0, 1), symI(0, 1), diagI(0, 1), anti(2, 3), anti(2, 4), anti(3, 4), symI(2, 3), symI(2, 4), symI(3, 4), diagI(2, 3), diagI(3, 4), Q];
  const part = ['su(2)', 'su(2)', 'su(2)', 'su(3)', 'su(3)', 'su(3)', 'su(3)', 'su(3)', 'su(3)', 'su(3)', 'su(3)', 'u(1)'];
  return list.map((A, k) => Object.assign(A, { name: k === 11 ? 'Q' : 'e' + (k + 1), part: part[k] }));
}
export function hypercharge() { return [0.5, 0.5, -1 / 3, -1 / 3, -1 / 3]; }        // Y, with Q = 6 i Y
export function unbroken() { return [1, 1, -1, -1, 0]; }                              // U / i
// The pair ket of a (2, 3) link on C2 (x) C3, index qubit * 3 + qutrit.
export function pairKet23() { const h = Math.SQRT1_2; return { re: [h, 0, 0, 0, h, 0], im: [0, 0, 0, 0, 0, 0] }; }
// (xi1 (x) 1 + 1 (x) xi2) psi for xi = xi1 (+) xi2 a 5 x 5 block matrix.
export function linkAction(xi, psi) {
  const re = new Array(6).fill(0), im = new Array(6).fill(0);
  for (let q = 0; q < 2; q++) for (let Qd = 0; Qd < 3; Qd++) {
    const out = q * 3 + Qd;
    for (let q2 = 0; q2 < 2; q2++) { // qubit block, rows/cols 0..1
      const ar = xi.re[q * 5 + q2], ai = xi.im[q * 5 + q2], br = psi.re[q2 * 3 + Qd], bi = psi.im[q2 * 3 + Qd];
      re[out] += ar * br - ai * bi; im[out] += ar * bi + ai * br;
    }
    for (let Q2 = 0; Q2 < 3; Q2++) { // qutrit block, rows/cols 2..4
      const ar = xi.re[(2 + Qd) * 5 + 2 + Q2], ai = xi.im[(2 + Qd) * 5 + 2 + Q2], br = psi.re[q * 3 + Q2], bi = psi.im[q * 3 + Q2];
      re[out] += ar * br - ai * bi; im[out] += ar * bi + ai * br;
    }
  }
  return { re, im };
}
// Rank of a real matrix given as rows, by Gaussian elimination.
export function rank(rows, tol = 1e-9) {
  const A = rows.map(r => r.slice()); let rk = 0; const n = A.length, m = A[0].length;
  for (let c = 0; c < m && rk < n; c++) {
    let p = rk; for (let i = rk + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (Math.abs(A[p][c]) < tol) continue;
    [A[rk], A[p]] = [A[p], A[rk]];
    for (let i = 0; i < n; i++) if (i !== rk) { const f = A[i][c] / A[rk][c]; for (let j = c; j < m; j++) A[i][j] -= f * A[rk][j]; }
    rk++;
  }
  return rk;
}
// The action of the 12 generators on the pair ket, as a 12 x 12 real matrix:
// column k = generator k, rows = re and im of the 6 entries.
export function actionMatrix() {
  const psi = pairKet23(), cols = idBasis().map(x => { const v = linkAction(x, psi); return v.re.concat(v.im); });
  return cols[0].map((_, r) => cols.map(c => c[r]));
}
export function actionRank() { return rank(actionMatrix()); }
// Null space of a real matrix (rows), as a list of column vectors.
export function nullSpace(rows, tol = 1e-9) {
  const A = rows.map(r => r.slice()), n = A.length, m = A[0].length, piv = []; let rk = 0;
  for (let c = 0; c < m && rk < n; c++) {
    let p = rk; for (let i = rk + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (Math.abs(A[p][c]) < tol) continue;
    [A[rk], A[p]] = [A[p], A[rk]];
    const f0 = A[rk][c]; for (let j = 0; j < m; j++) A[rk][j] /= f0;
    for (let i = 0; i < n; i++) if (i !== rk) { const f = A[i][c]; for (let j = 0; j < m; j++) A[i][j] -= f * A[rk][j]; }
    piv.push(c); rk++;
  }
  const free = []; for (let c = 0; c < m; c++) if (!piv.includes(c)) free.push(c);
  return free.map(fc => { const v = new Array(m).fill(0); v[fc] = 1; piv.forEach((pc, r) => { v[pc] = -A[r][fc]; }); return v; });
}
// The Lie bracket [A, B] of two 5 x 5 matrices.
export function bracket(A, B) { return add(mul(A, B), mul(B, A), -1); }
export function combo(coeffs, mats) { let S = cm(mats[0].n); coeffs.forEach((c, k) => { if (c) S = add(S, mats[k], c); }); return S; }

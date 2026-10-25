// ============================================================================
//  STRANDS · quantum.js — the small exact state algebra behind the threads
// ----------------------------------------------------------------------------
//  DOM-free. The drawings of strands/ show amplitudes. This module computes
//  them from state vectors, so that each number on a thread comes from a
//  contraction and not from a typed constant. tests.mjs checks each result
//  against the paper (Eq. (1), Eq. (S1), Corollary S3(iii), Eq. (S2)).
//
//  Vectors are { re: Float64Array, im: Float64Array, dims: [..] }. The index
//  of a product state is row-major over dims (the first factor is slowest).
//  The common support of a (d1, d2) pair is the first m = min(d1, d2)
//  directions of each end.
//
//  EXPORTS   (jump with grep -n "<anchor>" quantum.js)
//    vec / tensor ........ "export function vec"  "export function tensor"
//    pairKet ............. "export function pairKet"     |ω_m⟩ of a (d1, d2) link
//    amplitudeOf ......... "export function amplitudeOf" one term of a vector
//    terms ............... "export function terms"       nonzero terms
//    mubs ................ "export function mubs"        clock-and-shift MUBs, d = 2, 3
//    farStates ........... "export function farStates"   ⟨e|ω⟩ for each basis element
//    farStatesByContraction "export function farStatesByContraction"
//    swapContraction ..... "export function swapContraction" Eq. (S1)
//    objectState ......... "export function objectState" Eq. (S2), the 12 terms
//    pathAmplitudes ...... "export function pathAmplitudes" q1 -> q2 paths
//    fmt ................. "export function fmt"         short number text
// ============================================================================

export function vec(dims) {
  const n = dims.reduce((a, b) => a * b, 1);
  return { re: new Float64Array(n), im: new Float64Array(n), dims: dims.slice() };
}

export function tensor(a, b) {
  const out = vec([...a.dims, ...b.dims]);
  const nb = b.re.length;
  for (let i = 0; i < a.re.length; i++) {
    const ar = a.re[i], ai = a.im[i];
    if (ar === 0 && ai === 0) continue;
    for (let j = 0; j < nb; j++) {
      out.re[i * nb + j] = ar * b.re[j] - ai * b.im[j];
      out.im[i * nb + j] = ar * b.im[j] + ai * b.re[j];
    }
  }
  return out;
}

/** |ω_m⟩ of Eq. (1) on C^d1 ⊗ C^d2, m = min(d1, d2). */
export function pairKet(d1, d2 = d1) {
  const v = vec([d1, d2]), m = Math.min(d1, d2), a = 1 / Math.sqrt(m);
  for (let i = 0; i < m; i++) v.re[i * d2 + i] = a;
  return v;
}

function strides(dims) {
  const s = new Array(dims.length);
  let k = 1;
  for (let i = dims.length - 1; i >= 0; i--) { s[i] = k; k *= dims[i]; }
  return s;
}

export function indexOf(dims, idx) {
  const s = strides(dims);
  let n = 0;
  for (let i = 0; i < dims.length; i++) n += idx[i] * s[i];
  return n;
}

export function digitsOf(dims, n) {
  const out = new Array(dims.length);
  for (let i = dims.length - 1; i >= 0; i--) { out[i] = n % dims[i]; n = Math.floor(n / dims[i]); }
  return out;
}

export function amplitudeOf(v, idx) {
  const n = indexOf(v.dims, idx);
  return [v.re[n], v.im[n]];
}

/** Nonzero terms: [{ idx: [..], re, im, abs }], in index order. */
export function terms(v, eps = 1e-12) {
  const out = [];
  for (let n = 0; n < v.re.length; n++) {
    const re = v.re[n], im = v.im[n];
    if (Math.abs(re) > eps || Math.abs(im) > eps) out.push({ idx: digitsOf(v.dims, n), re, im, abs: Math.hypot(re, im) });
  }
  return out;
}

export function norm(v) {
  let s = 0;
  for (let n = 0; n < v.re.length; n++) s += v.re[n] * v.re[n] + v.im[n] * v.im[n];
  return Math.sqrt(s);
}

// Contract factor positions p and q of v with the bra ⟨ω_m| on those two
// factors (dims of p and q may differ; support is the first m). Returns
// the vector on the remaining factors, in their order.
export function contractPair(v, p, q) {
  const dims = v.dims, dp = dims[p], dq = dims[q], m = Math.min(dp, dq), a = 1 / Math.sqrt(m);
  const rest = dims.filter((_, i) => i !== p && i !== q);
  const out = vec(rest.length ? rest : [1]);
  for (let n = 0; n < v.re.length; n++) {
    const re = v.re[n], im = v.im[n];
    if (re === 0 && im === 0) continue;
    const d = digitsOf(dims, n);
    if (d[p] !== d[q] || d[p] >= m) continue;
    const r = d.filter((_, i) => i !== p && i !== q);
    const k = rest.length ? indexOf(rest, r) : 0;
    out.re[k] += a * re; out.im[k] += a * im;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutually unbiased bases of the clock and shift operators (Corollary S3(i)).
// d = 2: the eigenbases of Z, X, Y. d = 3: the computational basis and the
// three bases (1/√3) Σ_j ω^(b j² + k j) |j⟩, ω = e^(2πi/3). Each basis is a
// list of d vectors, each [[re, im], ...].
// ---------------------------------------------------------------------------
export function mubs(d) {
  const s = Math.SQRT1_2;
  if (d === 2) {
    return [
      { name: 'Z', basis: [[[1, 0], [0, 0]], [[0, 0], [1, 0]]] },
      { name: 'X', basis: [[[s, 0], [s, 0]], [[s, 0], [-s, 0]]] },
      { name: 'Y', basis: [[[s, 0], [0, s]], [[s, 0], [0, -s]]] },
    ];
  }
  if (d === 3) {
    const out = [{ name: 'computational', basis: [0, 1, 2].map(k => [0, 1, 2].map(j => [j === k ? 1 : 0, 0])) }];
    const a = 1 / Math.sqrt(3);
    for (let b = 0; b < 3; b++) {
      out.push({
        name: 'b' + b,
        basis: [0, 1, 2].map(k => [0, 1, 2].map(j => {
          const ph = 2 * Math.PI * ((b * j * j + k * j) % 3) / 3;
          return [a * Math.cos(ph), a * Math.sin(ph)];
        })),
      });
    }
    return out;
  }
  throw new Error('mubs: reads are taken at qubits and qutrits only (d = 2 or 3)');
}

/**
 * A read on a (dr, df) link taken at the end of dimension dr, in basis B.
 * For each element e, the far end is left at ⟨e|ω_m⟩ = (1/√m) Σ_{i<m} conj(e_i)|i⟩
 * (Corollary S3(iii)): the conjugate of the part of e on the support.
 * Returns [{ re: [..df], im: [..df], norm }].
 */
export function farStates(dr, df, basis) {
  const m = Math.min(dr, df), a = 1 / Math.sqrt(m);
  return basis.map(e => {
    const re = new Array(df).fill(0), im = new Array(df).fill(0);
    for (let i = 0; i < m; i++) { re[i] = a * e[i][0]; im[i] = -a * e[i][1]; }
    let n = 0;
    for (let i = 0; i < df; i++) n += re[i] * re[i] + im[i] * im[i];
    return { re, im, norm: Math.sqrt(n) };
  });
}

/** The same far states, from the explicit contraction (⟨e| ⊗ 1)|ω_m⟩. */
export function farStatesByContraction(dr, df, basis) {
  const w = pairKet(dr, df);
  return basis.map(e => {
    const re = new Array(df).fill(0), im = new Array(df).fill(0);
    for (let i = 0; i < dr; i++) {
      const cr = e[i][0], ci = -e[i][1]; // conj(e_i)
      for (let j = 0; j < df; j++) {
        const n = i * df + j, wr = w.re[n], wi = w.im[n];
        re[j] += cr * wr - ci * wi; im[j] += cr * wi + ci * wr;
      }
    }
    let n = 0;
    for (let j = 0; j < df; j++) n += re[j] * re[j] + im[j] * im[j];
    return { re, im, norm: Math.sqrt(n) };
  });
}

/**
 * Eq. (S1): ⟨ω_d|_23 |ω_d⟩_12 |ω_d⟩_34 = (1/d)|ω_d⟩_14.
 * Returns { out (vector on 1,4), ratio (out / |ω⟩_14 on the diagonal),
 *           termAmp (each term), residual (max deviation from ratio·|ω⟩) }.
 */
export function swapContraction(d) {
  const v = tensor(pairKet(d), pairKet(d)); // factors 1, 2, 3, 4
  const out = contractPair(v, 1, 2);        // on 1, 4
  const w = pairKet(d);
  const ratio = out.re[0] / w.re[0];
  let residual = 0;
  for (let n = 0; n < out.re.length; n++) residual = Math.max(residual, Math.abs(out.re[n] - ratio * w.re[n]), Math.abs(out.im[n]));
  return { out, ratio, termAmp: out.re[0], residual };
}

/**
 * Eq. (S2): |Ω⟩ = √6 (P3)_{Q1Q2} |ω2⟩_{Q1q1} |ω2⟩_{Q2q2} |ω2⟩_{Q3f}.
 * Factor order of the result: [Q1, Q2, q1, q2, Q3, f] with dims [3,3,2,2,3,2].
 * P3 = |ω3⟩⟨ω3| on the two read copies. Returns { state, terms, norm,
 * joinOverlap } where joinOverlap is the vector ⟨ω3|_{Q1Q2}(...) on q1, q2
 * before the factor √6 (it is |ω2⟩_{q1q2}/√6).
 */
export function objectState() {
  // |ω2⟩_{Q1q1} ⊗ |ω2⟩_{Q2q2}, factors [Q1, q1, Q2, q2]
  const reads = tensor(pairKet(3, 2), pairKet(3, 2));
  const joined = contractPair(reads, 0, 2); // ⟨ω3| on Q1, Q2 -> [q1, q2]
  // (P3 ⊗ 1)(...) = |ω3⟩_{Q1Q2} ⊗ joined, then ⊗ the unread link
  const s6 = Math.sqrt(6);
  const scaled = vec(joined.dims);
  for (let n = 0; n < joined.re.length; n++) { scaled.re[n] = s6 * joined.re[n]; scaled.im[n] = s6 * joined.im[n]; }
  const state = tensor(tensor(pairKet(3, 3), scaled), pairKet(3, 2));
  return { state, terms: terms(state), norm: norm(state), joinOverlap: joined };
}

/**
 * Paths from q1 to q2 in the strand picture (Fig. S1(b) in our drawing):
 * a strand of the first read link, one of the join |ω3⟩, one of the second
 * read link. A path exists for each direction i of the common support.
 */
export function pathAmplitudes() {
  const r = 1 / Math.sqrt(2), j = 1 / Math.sqrt(3);
  const out = [];
  for (let i = 0; i < 2; i++) out.push({ dir: i, factors: [r, j, r], amp: r * j * r });
  return out;
}

/** Short number text: 0.288675 style, or '0' near zero. */
export function fmt(x, digits = 4) {
  if (Math.abs(x) < 1e-12) return '0';
  return (+x.toFixed(digits)).toString();
}

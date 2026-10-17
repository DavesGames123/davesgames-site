// ============================================================================
//  tensor/tensor.js  ·  numeric tensor components with variance (DOM-free)
// ----------------------------------------------------------------------------
//  A Tensor is a Components object of the contract:
//      { shape: [n, ...], variance: ['u'|'d', ...], data: Float64Array }
//  plus methods. The data is row-major: the last slot changes fastest.
//  'u' is an upper (contravariant) slot, 'd' a lower (covariant) slot.
//
//  Transformation convention (transform):
//      J[a][b] = d x'^a / d x^b   (new coordinates by old coordinates)
//      upper slot:  T'^a = J^a_b T^b
//      lower slot:  T'_a = (J^-1)^b_a T_b   (the inverse, transposed)
//  So a vector and a covector change in opposite ways, and the
//  contraction T^a S_a has the same value in both frames.
//
//  ANCHORS   (grep -n "<anchor>" tensor.js)
//      class Tensor ............ "export class Tensor"
//      product ................. "export function product"
//      contract ................ "export function contract"
//      raise / lower ........... "export function raise", "export function lower"
//      transpose ............... "export function transpose"
//      symmetrize .............. "export function symmetrize"
//      antisymmetrize .......... "export function antisymmetrize"
//      trace ................... "export function trace"
//      einsum .................. "export function einsum"
//      transform ............... "export function transform"
//      leviCivita / delta ...... "export function leviCivita", "export function kroneckerDelta"
//      matrix helpers .......... "export function matInverse", "export function matDet"
// ============================================================================

export class TensorError extends Error {
  constructor(msg) { super(msg); this.name = 'TensorError'; }
}

const strides = shape => {
  const s = new Array(shape.length);
  let k = 1;
  for (let i = shape.length - 1; i >= 0; i--) { s[i] = k; k *= shape[i]; }
  return s;
};
const sizeOf = shape => shape.reduce((a, b) => a * b, 1);

export class Tensor {
  // new Tensor([3, 3], ['u', 'd']) gives zeros. data may be any array-like.
  constructor(shape, variance, data) {
    this.shape = shape.slice();
    if (variance == null) variance = shape.map(() => 'u');
    if (typeof variance === 'string') variance = variance.split('');
    if (variance.length !== shape.length) throw new TensorError(`variance has ${variance.length} slots but the shape has ${shape.length}`);
    for (const v of variance) if (v !== 'u' && v !== 'd') throw new TensorError(`variance must be 'u' or 'd', not '${v}'`);
    this.variance = variance.slice();
    const n = sizeOf(shape);
    if (data == null) this.data = new Float64Array(n);
    else {
      if (data.length !== n) throw new TensorError(`data has ${data.length} numbers but the shape needs ${n}`);
      this.data = Float64Array.from(data);
    }
    this.strides = strides(this.shape);
  }
  get rank() { return this.shape.length; }
  get size() { return this.data.length; }
  offset(idx) { let o = 0; for (let i = 0; i < idx.length; i++) o += idx[i] * this.strides[i]; return o; }
  get(...idx) { if (idx.length === 1 && Array.isArray(idx[0])) idx = idx[0]; return this.data[this.offset(idx)]; }
  set(value, ...idx) { if (idx.length === 1 && Array.isArray(idx[0])) idx = idx[0]; this.data[this.offset(idx)] = value; return this; }
  clone() { return new Tensor(this.shape, this.variance, this.data); }
  map(f) { const t = this.clone(); for (let i = 0; i < t.data.length; i++) t.data[i] = f(t.data[i], i); return t; }
  scale(k) { return this.map(x => x * k); }
  add(o, k = 1) { sameShape(this, o, 'add'); const t = this.clone(); for (let i = 0; i < t.data.length; i++) t.data[i] += k * o.data[i]; return t; }
  sub(o) { return this.add(o, -1); }
  maxAbs() { let m = 0; for (const x of this.data) m = Math.max(m, Math.abs(x)); return m; }
  // Index tuples in row-major order.
  *indices() { yield* indexTuples(this.shape); }
  toNested() {
    const rec = (d, off) => d === this.rank ? this.data[off]
      : Array.from({ length: this.shape[d] }, (_, i) => rec(d + 1, off + i * this.strides[d]));
    return rec(0, 0);
  }
  toComponents() { return { shape: this.shape.slice(), variance: this.variance.slice(), data: Float64Array.from(this.data) }; }
  // Accepts a Tensor, a Components object, a nested array or a number.
  static from(x, variance) {
    if (x instanceof Tensor) return x;
    if (typeof x === 'number') return new Tensor([], [], [x]);
    if (x && x.shape && x.data) return new Tensor(x.shape, x.variance, x.data);
    if (Array.isArray(x)) return Tensor.fromNested(x, variance);
    throw new TensorError('cannot make a tensor from this value');
  }
  static fromNested(arr, variance) {
    const shape = [];
    let a = arr;
    while (Array.isArray(a)) { shape.push(a.length); a = a[0]; }
    const flat = [];
    const rec = (x, d) => {
      if (d === shape.length) { flat.push(+x); return; }
      if (!Array.isArray(x) || x.length !== shape[d]) throw new TensorError('nested array is not rectangular');
      for (const y of x) rec(y, d + 1);
    };
    rec(arr, 0);
    return new Tensor(shape, variance ?? shape.map(() => 'u'), flat);
  }
  static scalar(v) { return new Tensor([], [], [v]); }
}

export function* indexTuples(shape) {
  const r = shape.length, idx = new Array(r).fill(0), n = sizeOf(shape);
  for (let k = 0; k < n; k++) {
    yield idx.slice();
    for (let d = r - 1; d >= 0; d--) { if (++idx[d] < shape[d]) break; idx[d] = 0; }
  }
}

function sameShape(a, b, what) {
  if (a.shape.length !== b.shape.length || a.shape.some((n, i) => n !== b.shape[i]))
    throw new TensorError(`${what}: shapes [${a.shape}] and [${b.shape}] differ`);
}
const T = x => Tensor.from(x);
const slotName = v => v === 'u' ? 'upper' : 'lower';

// Outer (tensor) product: shape and variance concatenate.
export function product(a, b) {
  a = T(a); b = T(b);
  const out = new Tensor(a.shape.concat(b.shape), a.variance.concat(b.variance));
  const nb = b.data.length;
  for (let i = 0; i < a.data.length; i++) for (let j = 0; j < nb; j++) out.data[i * nb + j] = a.data[i] * b.data[j];
  return out;
}

// Contract slot i with slot j (one upper, one lower). opts.force allows
// two slots of the same variance (Euclidean, orthonormal frame only).
export function contract(t, i, j, opts = {}) {
  t = T(t);
  if (i === j) throw new TensorError('contract needs two different slots');
  if (i < 0 || j < 0 || i >= t.rank || j >= t.rank) throw new TensorError(`slots ${i} and ${j} are not both in a rank ${t.rank} tensor`);
  if (t.shape[i] !== t.shape[j]) throw new TensorError(`slots ${i} and ${j} have different ranges (${t.shape[i]} and ${t.shape[j]})`);
  if (t.variance[i] === t.variance[j] && !opts.force)
    throw new TensorError(`slots ${i} and ${j} are both ${slotName(t.variance[i])}. A contraction pairs one upper and one lower index; lower or raise one first with the metric`);
  const keep = [];
  for (let k = 0; k < t.rank; k++) if (k !== i && k !== j) keep.push(k);
  const out = new Tensor(keep.map(k => t.shape[k]), keep.map(k => t.variance[k]));
  const n = t.shape[i], full = new Array(t.rank);
  for (const idx of indexTuples(out.shape)) {
    keep.forEach((k, q) => { full[k] = idx[q]; });
    let s = 0;
    for (let m = 0; m < n; m++) { full[i] = m; full[j] = m; s += t.data[t.offset(full)]; }
    out.data[out.offset(idx)] = s;
  }
  return out;
}

// Move slot `slot` with a rank-2 matrix M: out[..a..] = sum_b M[a][b] t[..b..].
function applyMatrixToSlot(t, slot, M, newVar) {
  const m = T(M), n = t.shape[slot];
  if (m.rank !== 2 || m.shape[0] !== n || m.shape[1] !== n) throw new TensorError(`slot ${slot} has range ${n} but the matrix is [${m.shape}]`);
  const out = new Tensor(t.shape, t.variance.map((v, k) => k === slot ? newVar : v));
  const idx2 = new Array(t.rank);
  for (const idx of indexTuples(t.shape)) {
    let s = 0;
    for (let k = 0; k < t.rank; k++) idx2[k] = idx[k];
    for (let b = 0; b < n; b++) { idx2[slot] = b; s += m.data[idx[slot] * n + b] * t.data[t.offset(idx2)]; }
    out.data[out.offset(idx)] = s;
  }
  return out;
}

// raise(t, slot, gInv): T^a = g^{ab} T_b.  lower(t, slot, g): T_a = g_{ab} T^b.
export function raise(t, slot, gInv) {
  t = T(t);
  if (t.variance[slot] !== 'd') throw new TensorError(`slot ${slot} is already upper`);
  return applyMatrixToSlot(t, slot, gInv, 'u');
}
export function lower(t, slot, g) {
  t = T(t);
  if (t.variance[slot] !== 'u') throw new TensorError(`slot ${slot} is already lower`);
  return applyMatrixToSlot(t, slot, g, 'd');
}

// transpose(t, perm): out slot k is input slot perm[k]. transpose(t, i, j) swaps two slots.
export function transpose(t, perm, j) {
  t = T(t);
  if (typeof perm === 'number') {
    const i = perm; perm = t.shape.map((_, k) => k);
    if (j == null) j = i + 1;
    perm[i] = j; perm[j] = i;
  }
  if (perm == null) perm = t.shape.map((_, k) => t.rank - 1 - k);
  if (perm.length !== t.rank || new Set(perm).size !== t.rank) throw new TensorError('transpose needs a permutation of all slots');
  const out = new Tensor(perm.map(p => t.shape[p]), perm.map(p => t.variance[p]));
  const src = new Array(t.rank);
  for (const idx of indexTuples(out.shape)) {
    for (let k = 0; k < t.rank; k++) src[perm[k]] = idx[k];
    out.data[out.offset(idx)] = t.data[t.offset(src)];
  }
  return out;
}

export function permutations(arr) {
  if (arr.length <= 1) return [{ p: arr.slice(), sign: 1 }];
  const out = [];
  arr.forEach((x, i) => {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const q of permutations(rest)) out.push({ p: [x].concat(q.p), sign: (i % 2 ? -1 : 1) * q.sign });
  });
  return out;
}

function symCore(t, slots, anti) {
  t = T(t);
  if (slots == null) slots = t.shape.map((_, k) => k);
  if (slots.length < 2) return t.clone();
  const v0 = t.variance[slots[0]];
  for (const s of slots) {
    if (t.variance[s] !== v0) throw new TensorError(`(anti)symmetrization mixes an upper and a lower slot; slots ${slots.join(', ')} must have one variance`);
    if (t.shape[s] !== t.shape[slots[0]]) throw new TensorError('(anti)symmetrized slots must have one range');
  }
  const perms = permutations(slots);
  const out = new Tensor(t.shape, t.variance);
  for (const { p, sign } of perms) {
    const perm = t.shape.map((_, k) => k);
    slots.forEach((s, q) => { perm[s] = p[q]; });
    const tp = transpose(t, perm);
    const k = (anti ? sign : 1) / perms.length;
    for (let i = 0; i < out.data.length; i++) out.data[i] += k * tp.data[i];
  }
  return out;
}
// T_{(ab)} = (1/k!) sum over permutations.  T_{[ab]} with the sign of each permutation.
export function symmetrize(t, slots) { return symCore(t, slots, false); }
export function antisymmetrize(t, slots) { return symCore(t, slots, true); }

// trace(t) of a mixed rank-2 tensor. trace(t, i, j, metric) uses the metric
// (g for two upper slots, gInv for two lower slots) when the variances match.
export function trace(t, i = 0, j = 1, metric) {
  t = T(t);
  if (t.variance[i] !== t.variance[j]) return contract(t, i, j);
  if (!metric) throw new TensorError(`slots ${i} and ${j} are both ${slotName(t.variance[i])}; give the metric to take the trace`);
  const u = t.variance[j] === 'd' ? raise(t, j, metric) : lower(t, j, metric);
  return contract(u, i, j);
}

// einsum('ij,jk->ik', A, B). Letters name slots; a repeated letter is
// summed. Without '->' the output is the letters that appear once, in
// alphabetical order (numpy rule). The output variance of each letter
// comes from the input slot with that letter. Repeated letters with the
// same variance are summed too (numpy has no variance); opts.strict
// refuses them.
export function einsum(spec, ...args) {
  let opts = {};
  if (args.length && args[args.length - 1] && args[args.length - 1].strict !== undefined && !args[args.length - 1].shape && !Array.isArray(args[args.length - 1])) opts = args.pop();
  const ts = args.map(a => T(a));
  spec = spec.replace(/\s+/g, '');
  let [lhs, rhs] = spec.split('->');
  const ins = lhs.split(',');
  if (ins.length !== ts.length) throw new TensorError(`einsum spec names ${ins.length} inputs but ${ts.length} were given`);
  const range = {}, vari = {}, count = {};
  ins.forEach((s, q) => {
    if (s.length !== ts[q].rank) throw new TensorError(`input ${q + 1} has rank ${ts[q].rank} but '${s}' has ${s.length} letters`);
    [...s].forEach((c, k) => {
      const n = ts[q].shape[k];
      if (range[c] != null && range[c] !== n) throw new TensorError(`letter '${c}' has range ${range[c]} and ${n}`);
      range[c] = n;
      count[c] = (count[c] || 0) + 1;
      (vari[c] ||= []).push(ts[q].variance[k]);
    });
  });
  if (rhs == null) rhs = Object.keys(count).filter(c => count[c] === 1).sort().join('');
  if (opts.strict) for (const c of Object.keys(count)) if (!rhs.includes(c) && (count[c] !== 2 || vari[c][0] === vari[c][1]))
    throw new TensorError(`index '${c}' is summed but it is not one upper and one lower`);
  const outL = [...rhs], sumL = Object.keys(range).filter(c => !outL.includes(c));
  for (const c of outL) if (range[c] == null) throw new TensorError(`output letter '${c}' is not in an input`);
  const out = new Tensor(outL.map(c => range[c]), outL.map(c => vari[c][0]));
  const letters = outL.concat(sumL), pos = {};
  letters.forEach((c, k) => { pos[c] = k; });
  const maps = ins.map((s, q) => [...s].map((c, k) => [pos[c], ts[q].strides[k]]));
  const sumShape = sumL.map(c => range[c]);
  const val = new Array(letters.length).fill(0);
  for (const oi of indexTuples(out.shape)) {
    for (let k = 0; k < outL.length; k++) val[k] = oi[k];
    let s = 0;
    for (const si of indexTuples(sumShape)) {
      for (let k = 0; k < sumL.length; k++) val[outL.length + k] = si[k];
      let p = 1;
      for (let q = 0; q < ts.length && p !== 0; q++) {
        let o = 0;
        for (const [l, st] of maps[q]) o += val[l] * st;
        p *= ts[q].data[o];
      }
      s += p;
    }
    out.data[out.offset(oi)] = s;
  }
  return out;
}

// Transform every slot. J[a][b] = dx'^a/dx^b. Upper slots use J, lower
// slots use (J^-1) transposed. Jinv is optional (computed when absent).
export function transform(t, J, Jinv) {
  t = T(t);
  const j = T(J);
  const ji = Jinv ? T(Jinv) : Tensor.fromNested(matInverse(j.toNested()));
  const jiT = transpose(ji, [1, 0]);
  let out = t;
  for (let s = 0; s < t.rank; s++) out = applyMatrixToSlot(out, s, t.variance[s] === 'u' ? j : jiT, t.variance[s]);
  return out;
}

// Levi-Civita symbol: +1 for even permutations of 0..n-1, -1 odd, else 0.
export function leviCivita(n, variance) {
  const out = new Tensor(new Array(n).fill(n), variance ?? new Array(n).fill('d'));
  for (const { p, sign } of permutations([...Array(n).keys()])) out.data[out.offset(p)] = sign;
  return out;
}
export function kroneckerDelta(n, variance = ['u', 'd']) {
  const out = new Tensor([n, n], variance);
  for (let i = 0; i < n; i++) out.data[i * n + i] = 1;
  return out;
}

// ---- small dense matrix helpers (nested arrays) ---------------------------
export function matInverse(A) {
  const n = A.length, M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => +(i === j))));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new TensorError('the matrix is singular (no inverse); at a coordinate singularity the metric has no inverse');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c && M[r][c] !== 0) {
      const f = M[r][c];
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map(r => r.slice(n));
}
export function matDet(A) {
  const n = A.length, M = A.map(r => r.slice());
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[c], M[p]] = [M[p], M[c]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; }
  }
  return d;
}
export function matMul(A, B) {
  return A.map(r => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
}

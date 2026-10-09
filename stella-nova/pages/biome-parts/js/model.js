// ============================================================================
//  BIOME PARTS  ·  model.js — the Taiga-S1 forward pass in plain JavaScript
// ----------------------------------------------------------------------------
//  PURE. No DOM, no GPU. Reads the released weights (taiga-s1/model.safetensors,
//  unchanged from Biome-S1 release/hf) and runs S1Model.modular_forward from
//  freecad_s1/model/net.py for one state at a time. The worker, the saver, the
//  node tests and the eval script all call score().
//
//  THE NETWORK (config.json: width 128, 4 heads, 3 encoder and 2 decoder
//  layers, ff 384, modular, pointer "done", index_eval "identity")
//    tokens --embed--> x = a + b + seg + pos + num_proj[seg] + cat + ord
//    StateEncoder: LN, 3 pre-norm transformer layers with the modular mask
//      (state tokens see state tokens; a goal token sees the state + itself),
//      LN -> context C (L x 128)
//    done head: intent_score(C) per goal token; the active item is the first
//      goal token with a logit < 0 (the END sentinel when all are built)
//    ActionEncoder: id + cat + scope + mean(words) + vec, then x + MLP(x),
//      plus intent_proj(C[active])
//    decoder: 2 pre-norm layers (self-attention over the options, cross
//      attention to the state tokens and the active item only, FFN)
//    score head -> one logit per option; softmax(logit / T) gives the
//      calibrated probabilities (T = 2.554 from config.json)
//
//  Dropout layers are identity at eval time and are left out.
//
//  GREP MAP
//    parseSafetensors ...... header + F32 tensors
//    loadModel ............. weights + config -> model object
//    erf / gelu / layerNorm / linear / mha ..... the kernels
//    forward ............... tokens + actions -> { logits, done, active }
//    softmaxT .............. calibrated probabilities
// ============================================================================
import { A_OFFSETS, A_VOCAB, NUM_DIM, N_SEGMENTS, SEG_GOAL, SEG_NODE, SEG_RECENT, SEG_SEL, MAX_POS, MAX_ORD, MAX_WORDS } from './featurize.js';
import { NODE_TYPES, ACTION_IDS, CATEGORIES, CATALOGUE } from './vocab.js';

export function parseSafetensors(buf) {
  const dv = new DataView(buf);
  const n = Number(dv.getBigUint64(0, true));
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const base = 8 + n, out = {};
  for (const [k, v] of Object.entries(head)) {
    if (k === '__metadata__') continue;
    if (v.dtype !== 'F32') throw new Error('unexpected dtype ' + v.dtype + ' for ' + k);
    const [s, e] = v.data_offsets;
    out[k] = { shape: v.shape, data: new Float32Array(buf.slice(base + s, base + e)) };
  }
  return out;
}

// Functional category of each object type (net.NODE_CATEGORY), for the
// factorized type embedding.
const NODE_CATEGORY = {
  'PartDesign::Body': 'body', 'Sketcher::SketchObject': 'sketch',
  'PartDesign::Pad': 'additive', 'PartDesign::Revolution': 'additive',
  'PartDesign::Pocket': 'subtractive', 'PartDesign::Groove': 'subtractive', 'PartDesign::Hole': 'subtractive',
  'PartDesign::Fillet': 'dressup', 'PartDesign::Chamfer': 'dressup', 'PartDesign::Draft': 'dressup',
  'PartDesign::Thickness': 'dressup', 'PartDesign::Mirrored': 'pattern', 'PartDesign::LinearPattern': 'pattern',
  'PartDesign::PolarPattern': 'pattern', 'Part::Box': 'part_primitive', 'Part::Cylinder': 'part_primitive',
};
function categoryTables(bVocab) {
  const cat = new Map(CATEGORIES.map((c, i) => [c, i]));
  const aCat = new Int32Array(A_VOCAB), bCat = new Int32Array(bVocab);
  NODE_TYPES.forEach((t, i) => { const c = cat.get(NODE_CATEGORY[t] || '') || 0; aCat[A_OFFSETS[SEG_NODE] + i] = c; bCat[i] = c; });
  ACTION_IDS.forEach((a, i) => { const s = CATALOGUE.get(a); aCat[A_OFFSETS[SEG_RECENT] + i] = s ? cat.get(s.category) || 0 : 0; });
  return { aCat, bCat };
}

export function loadModel(buf, config) {
  const W = parseSafetensors(buf);
  const cfg = config.config || config;
  const g = k => { const t = W[k]; if (!t) throw new Error('missing tensor ' + k); return t.data; };
  const d = cfg.width, ff = cfg.ff, heads = cfg.heads;
  const ln = p => ({ w: g(p + '.weight'), b: g(p + '.bias') });
  const lin = p => ({ w: g(p + '.weight'), b: g(p + '.bias'), out: W[p + '.weight'].shape[0], inp: W[p + '.weight'].shape[1] });
  const mhaP = p => ({ inW: g(p + '.in_proj_weight'), inB: g(p + '.in_proj_bias'), out: lin(p + '.out_proj') });
  const enc = [], dec = [];
  for (let i = 0; i < cfg.enc_layers; i++) {
    const p = `state_encoder.encoder.layers.${i}`;
    enc.push({ sa: mhaP(p + '.self_attn'), l1: lin(p + '.linear1'), l2: lin(p + '.linear2'), n1: ln(p + '.norm1'), n2: ln(p + '.norm2') });
  }
  for (let i = 0; i < cfg.dec_layers; i++) {
    const p = `decoder.layers.${i}`;
    dec.push({ sa: mhaP(p + '.self_attn'), ca: mhaP(p + '.multihead_attn'), l1: lin(p + '.linear1'), l2: lin(p + '.linear2'),
      n1: ln(p + '.norm1'), n2: ln(p + '.norm2'), n3: ln(p + '.norm3') });
  }
  const bVocab = W['state_encoder.b.weight'].shape[0];
  const params = Object.values(W).reduce((s, t) => s + t.data.length, 0);
  return {
    cfg, d, ff, heads, params, ...categoryTables(bVocab),
    se: { a: g('state_encoder.a.weight'), b: g('state_encoder.b.weight'), seg: g('state_encoder.seg.weight'),
      pos: g('state_encoder.pos.weight'), ord: g('state_encoder.ord.weight'), cat: g('state_encoder.cat.weight'),
      numW: g('state_encoder.num_w'), numB: g('state_encoder.num_b'), inNorm: ln('state_encoder.in_norm'), outNorm: ln('state_encoder.out_norm') },
    ae: { id: g('action_encoder.id.weight'), cat: g('action_encoder.cat.weight'), scope: g('action_encoder.scope.weight'),
      words: g('action_encoder.words.weight'), vec: lin('action_encoder.vec'), mlpN: ln('action_encoder.mlp.0'),
      mlp1: lin('action_encoder.mlp.1'), mlp2: lin('action_encoder.mlp.3') },
    enc, dec,
    score: { n: ln('score.0'), l1: lin('score.1'), l2: lin('score.3') },
    intentScore: { n: ln('intent_score.0'), l1: lin('intent_score.1'), l2: lin('intent_score.3') },
    intentProj: { n: ln('intent_proj.0'), l1: lin('intent_proj.1') },
  };
}

// ── kernels (rows are Float32Array slices of length d) ─────────────────────
// erf after W. J. Cody's rational approximations (|error| < 1e-15 in double).
export function erf(x) {
  const ax = Math.abs(x);
  if (ax < 0.5) {
    const t = x * x;
    const p = [3.16112374387056560e00, 1.13864154151050156e02, 3.77485237685302021e02, 3.20937758913846947e03, 1.85777706184603153e-1];
    const q = [2.36012909523441209e01, 2.44024637934444173e02, 1.28261652607737228e03, 2.84423683343917062e03];
    let num = p[4] * t, den = t;
    for (let i = 0; i < 3; i++) { num = (num + p[i]) * t; den = (den + q[i]) * t; }
    return x * (num + p[3]) / (den + q[3]);
  }
  let r;
  if (ax < 4) {
    const c = [5.64188496988670089e-1, 8.88314979438837594e00, 6.61191906371416295e01, 2.98635138197400131e02, 8.81952221241769090e02, 1.71204761263407058e03, 2.05107837782607147e03, 1.23033935479799725e03, 2.15311535474403846e-8];
    const dd = [1.57449261107098347e01, 1.17693950891312499e02, 5.37181101862009858e02, 1.62138957456669019e03, 3.29079923573345963e03, 4.36261909014324716e03, 3.43936767414372164e03, 1.23033935480374942e03];
    let num = c[8] * ax, den = ax;
    for (let i = 0; i < 7; i++) { num = (num + c[i]) * ax; den = (den + dd[i]) * ax; }
    r = (num + c[7]) / (den + dd[7]);
  } else {
    const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
    const q = [2.56852019228982242e00, 1.87295284992346725e00, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
    const z = 1 / (ax * ax);
    let num = p[5] * z, den = z;
    for (let i = 0; i < 4; i++) { num = (num + p[i]) * z; den = (den + q[i]) * z; }
    r = z * (num + p[4]) / (den + q[4]);
    r = (0.564189583547756287 - r) / ax;
  }
  const xsq = Math.trunc(ax * 16) / 16, del = (ax - xsq) * (ax + xsq);
  const erfc = Math.exp(-xsq * xsq) * Math.exp(-del) * r;
  return x < 0 ? erfc - 1 : 1 - erfc;
}
const gelu = x => 0.5 * x * (1 + erf(x / Math.SQRT2));

function layerNorm(X, n, d, P, out = new Float32Array(n * d)) {
  for (let i = 0; i < n; i++) {
    const o = i * d;
    let m = 0; for (let k = 0; k < d; k++) m += X[o + k];
    m /= d;
    let v = 0; for (let k = 0; k < d; k++) { const t = X[o + k] - m; v += t * t; }
    const inv = 1 / Math.sqrt(v / d + 1e-5);
    for (let k = 0; k < d; k++) out[o + k] = (X[o + k] - m) * inv * P.w[k] + P.b[k];
  }
  return out;
}
// Y = X W^T + b, W is (out x inp) row-major as torch stores it. The inner
// product is unrolled by 4 (inp is 128 or 384 here).
function linear(X, n, L, act = null) {
  const { w, b, out: m, inp } = L, Y = new Float32Array(n * m);
  for (let i = 0; i < n; i++) {
    const xo = i * inp;
    for (let j = 0; j < m; j++) {
      const wo = j * inp;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, k = 0;
      for (; k + 3 < inp; k += 4) {
        s0 += X[xo + k] * w[wo + k]; s1 += X[xo + k + 1] * w[wo + k + 1];
        s2 += X[xo + k + 2] * w[wo + k + 2]; s3 += X[xo + k + 3] * w[wo + k + 3];
      }
      for (; k < inp; k++) s0 += X[xo + k] * w[wo + k];
      const s = b[j] + s0 + s1 + s2 + s3;
      Y[i * m + j] = act ? act(s) : s;
    }
  }
  return Y;
}
function proj(X, n, d, W, B, part) {
  return linear(X, n, { w: W.subarray(part * d * d, (part + 1) * d * d), b: B.subarray(part * d, (part + 1) * d), out: d, inp: d });
}
// Multi-head attention. mask[q * nk + k] = 1 when query q may see key k
// (null: all keys).
function mha(Xq, nq, Xk, nk, d, heads, P, mask) {
  const Q = proj(Xq, nq, d, P.inW, P.inB, 0), K = proj(Xk, nk, d, P.inW, P.inB, 1), V = proj(Xk, nk, d, P.inW, P.inB, 2);
  const hd = d / heads, sc = 1 / Math.sqrt(hd), O = new Float32Array(nq * d), w = new Float64Array(nk);
  for (let h = 0; h < heads; h++) {
    const ho = h * hd;
    for (let i = 0; i < nq; i++) {
      let mx = -Infinity;
      const qo = i * d + ho;
      for (let j = 0; j < nk; j++) {
        if (mask && !mask[i * nk + j]) { w[j] = -Infinity; continue; }
        const ko = j * d + ho;
        let s = 0; for (let k = 0; k < hd; k++) s += Q[qo + k] * K[ko + k];
        s *= sc; w[j] = s; if (s > mx) mx = s;
      }
      let z = 0;
      for (let j = 0; j < nk; j++) { const e = w[j] === -Infinity ? 0 : Math.exp(w[j] - mx); w[j] = e; z += e; }
      const inv = 1 / z;
      for (let j = 0; j < nk; j++) {
        const e = w[j] * inv; if (!e) continue;
        const vo = j * d + ho;
        for (let k = 0; k < hd; k++) O[qo + k] += e * V[vo + k];
      }
    }
  }
  return linear(O, nq, P.out);
}
const addInto = (A, B) => { for (let i = 0; i < A.length; i++) A[i] += B[i]; return A; };
function ffn(X, n, l1, l2) { return linear(linear(X, n, l1, gelu), n, l2); }

// ── the forward pass ───────────────────────────────────────────────────────
// T: encodeState tokens; acts: encodeActions rows. Returns float logits per
// option, the done logit per goal token and the active goal index.
export function forward(M, T, acts) {
  const { d, heads, se } = M, n = T.n;
  const x = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    const s = T.seg[i], o = i * d;
    const pos = Math.min(T.pos[i], MAX_POS - 1), ord = Math.min(T.ord[i], MAX_ORD - 1);
    const catId = s === SEG_SEL ? M.bCat[T.b[i]] : M.aCat[T.a[i]];
    for (let k = 0; k < d; k++) {
      let v = se.a[T.a[i] * d + k] + se.b[T.b[i] * d + k] + se.seg[s * d + k] + se.pos[pos * d + k] + se.numB[s * d + k] + se.cat[catId * d + k] + se.ord[ord * d + k];
      for (let c = 0; c < NUM_DIM; c++) { const nv = T.num[i * NUM_DIM + c]; if (nv) v += nv * se.numW[(s * NUM_DIM + c) * d + k]; }
      x[o + k] = v;
    }
  }
  const isGoal = i => T.seg[i] === SEG_GOAL;
  const encMask = new Uint8Array(n * n);
  for (let q = 0; q < n; q++) for (let k = 0; k < n; k++) encMask[q * n + k] = !isGoal(k) || q === k ? 1 : 0;
  let h = layerNorm(x, n, d, se.inNorm);
  for (const L of M.enc) {
    const a1 = layerNorm(h, n, d, L.n1);
    addInto(h, mha(a1, n, a1, n, d, heads, L.sa, encMask));
    addInto(h, ffn(layerNorm(h, n, d, L.n2), n, L.l1, L.l2));
  }
  const C = layerNorm(h, n, d, se.outNorm);

  // done head: the first goal token whose "built?" logit is negative
  const goalIdx = []; for (let i = 0; i < n; i++) if (isGoal(i)) goalIdx.push(i);
  const done = [];
  let chosen = -1;
  for (const gi of goalIdx) {
    const row = C.subarray(gi * d, gi * d + d);
    const z = linear(linear(layerNorm(row, 1, d, M.intentScore.n), 1, M.intentScore.l1, gelu), 1, M.intentScore.l2)[0];
    done.push(z);
    if (chosen < 0 && z < 0) chosen = gi;
  }
  if (chosen < 0) chosen = goalIdx[goalIdx.length - 1];
  const intent = linear(layerNorm(C.subarray(chosen * d, chosen * d + d), 1, d, M.intentProj.n), 1, M.intentProj.l1);

  // options
  const N = acts.length, ae = M.ae, O = new Float32Array(N * d);
  for (let j = 0; j < N; j++) {
    const a = acts[j], o = j * d;
    const ws = a.words.filter(w => w !== 0);
    for (let k = 0; k < d; k++) {
      let v = ae.id[a.id * d + k] + ae.cat[a.cat * d + k] + ae.scope[a.scope * d + k] + ae.vec.b[k];
      for (let c = 0; c < 6; c++) v += a.vec[c] * ae.vec.w[k * 6 + c];
      let wsum = 0; for (const w of ws) wsum += ae.words[w * d + k];
      v += wsum / Math.max(ws.length, 1);
      O[o + k] = v;
    }
  }
  const mlp = linear(linear(layerNorm(O, N, d, ae.mlpN), N, ae.mlp1, gelu), N, ae.mlp2);
  addInto(O, mlp);
  for (let j = 0; j < N; j++) for (let k = 0; k < d; k++) O[j * d + k] += intent[k];

  const memMask = new Uint8Array(N * n);
  for (let q = 0; q < N; q++) for (let k = 0; k < n; k++) memMask[q * n + k] = !isGoal(k) || k === chosen ? 1 : 0;
  let y = O;
  for (const L of M.dec) {
    const a1 = layerNorm(y, N, d, L.n1);
    addInto(y, mha(a1, N, a1, N, d, heads, L.sa, null));
    addInto(y, mha(layerNorm(y, N, d, L.n2), N, C, n, d, heads, L.ca, memMask));
    addInto(y, ffn(layerNorm(y, N, d, L.n3), N, L.l1, L.l2));
  }
  const logits = linear(linear(layerNorm(y, N, d, M.score.n), N, M.score.l1, gelu), N, M.score.l2);
  return { logits: Array.from(logits), done, active: goalIdx.indexOf(chosen), nGoal: goalIdx.length - 1 };
}

export function softmaxT(logits, T = 1) {
  const m = Math.max(...logits.map(l => l / T));
  const e = logits.map(l => Math.exp(l / T - m)), z = e.reduce((s, v) => s + v, 0);
  return e.map(v => v / z);
}

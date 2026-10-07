// ============================================================================
//  MODEL I/O  ·  market-forecast/model-io.js — Chronos pre- and post-processing
// ----------------------------------------------------------------------------
//  The ONNX files in models/ hold only the core network of each model. This
//  module does the steps that the chronos-forecasting pipelines do around
//  the network, in the same order, so the page output agrees with the
//  PyTorch pipelines (checked in tests.mjs against values from Python):
//
//    1. truncate each series to the model context length (the last values)
//    2. left-pad the batch rows to one length with NaN (missing values)
//    3. scale each row: loc = mean, scale = RMS about loc, both over the
//       values that are not NaN; scale 0 becomes 1e-5. Chronos-2 then
//       applies arcsinh to the scaled values
//    4. left-pad to a multiple of 16 with NaN, cut into patches of 16,
//       and set a mask of 1 where a value is present (0 where NaN)
//    5. Chronos-2 only: a time encoding per value, (index - n) / 8192 for
//       the context and index / 8192 for the future patches
//    6. after the network: Chronos-2 applies sinh, then both models do
//       value * scale + loc
//  Chronos-Bolt gives 64 steps per call. For a longer horizon the pipeline
//  appends each of its 9 quantiles to the context, runs the 9 paths, and
//  takes the 9 quantiles of the 81 values (linear interpolation, as
//  torch.quantile). forecastBolt does the same.
//
//  The module has no DOM and no runtime import. A caller gives a run
//  function that takes the input tensors (flat Float32Array + dims) and
//  returns the output tensor; worker.js gives onnxruntime-web.
//
//  grep -n targets
//    model catalog ......... "export const MODELS"
//    scaling ............... "export function scaleRow"
//    patching .............. "export function patchRows"
//    Bolt inputs ........... "export function boltFeeds"
//    Chronos-2 inputs ...... "export function c2Feeds"
//    Bolt horizon unroll ... "export async function forecastBolt"
//    Chronos-2 forecast .... "export async function forecastC2"
//    torch.quantile twin ... "export function quantileLinear"
// ============================================================================

export const PATCH = 16;
export const BOLT_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
export const C2_LEVELS = [0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99];

// The models the page can run. "local" files are in models/ (committed).
// "hf" graphs are in models/ too, but their weights are the official
// model.safetensors on Hugging Face, fetched at run time at a pinned
// revision and checked against the sha256 below (see worker.js).
export const MODELS = {
  'bolt-tiny': {
    id: 'bolt-tiny', label: 'Chronos-Bolt Tiny', kind: 'bolt', params: '9M',
    graph: 'models/chronos-bolt-tiny.fp16w.onnx', bytes: 17555246, weights: null,
    note: 'bundled, weights stored as fp16, computed in fp32',
    levels: BOLT_LEVELS, ctxLen: 2048, step: 64,
  },
  'bolt-mini': {
    id: 'bolt-mini', label: 'Chronos-Bolt Mini', kind: 'bolt', params: '21M',
    graph: 'models/chronos-bolt-mini.hf.onnx', bytes: 266117,
    weights: { repo: 'amazon/chronos-bolt-mini', revision: '251268337516a88e253628c43e1d26ec577b376b',
      bytes: 84956096, sha256: '1a1a4297f132b808c5c7da24e3cce549d519c01ff5c2661fcad404baba018f24' },
    note: 'fp32 weights from Hugging Face (85 MB, cached after the first load)',
    levels: BOLT_LEVELS, ctxLen: 2048, step: 64,
  },
  'c2-small': {
    id: 'c2-small', label: 'Chronos-2 Small', kind: 'c2', params: '28M',
    graph: 'models/chronos-2-small.hf.onnx', bytes: 323178,
    weights: { repo: 'autogluon/chronos-2-small', revision: 'ddec01313e50b6bc58ebaa92ede81bc24a3d9f9a',
      bytes: 111749048, sha256: '492290ae82bb89f9769e3479ce90b3179de1f33e600c34daa0352531538b23cd' },
    note: 'fp32 weights from Hugging Face (112 MB, cached after the first load); joint (multivariate) mode',
    levels: C2_LEVELS, ctxLen: 8192, step: 1024,
  },
};

export function hfUrl(w) {
  return `https://huggingface.co/${w.repo}/resolve/${w.revision}/model.safetensors`;
}

// Step 3. x: array of numbers, NaN for a missing value.
export function scaleRow(x, arcsinh = false) {
  let n = 0, s = 0;
  for (let i = 0; i < x.length; i++) if (x[i] === x[i]) { s += x[i]; n++; }
  const loc = n ? s / n : 0;
  let v = 0;
  for (let i = 0; i < x.length; i++) if (x[i] === x[i]) v += (x[i] - loc) * (x[i] - loc);
  let scale = n ? Math.sqrt(v / n) : 1;
  if (scale === 0) scale = 1e-5;
  // float32 like the pipeline: the scaled context goes to the model as float32
  const z = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const u = (x[i] - loc) / scale;
    z[i] = arcsinh ? Math.asinh(u) : u;
  }
  return { z, loc, scale };
}

// Steps 1 and 2: the last ctxLen values of each row, left-padded with NaN.
export function alignRows(rows, ctxLen) {
  let L = 0;
  for (const r of rows) L = Math.max(L, Math.min(r.length, ctxLen));
  return rows.map(r => {
    const out = new Float64Array(L).fill(NaN);
    const k = Math.min(r.length, L);
    for (let i = 0; i < k; i++) out[L - k + i] = r[r.length - k + i];
    return out;
  });
}

// Step 4. zs: scaled rows of one length. Returns flat patches (B,N,P),
// masks (B,N,P) and the attention mask (B,N): 1 if a patch has a value.
export function patchRows(zs) {
  const B = zs.length, L = zs[0].length, pad = (PATCH - (L % PATCH)) % PATCH;
  const N = (L + pad) / PATCH;
  const vals = new Float32Array(B * N * PATCH), mask = new Float32Array(B * N * PATCH), attn = new Float32Array(B * N);
  for (let b = 0; b < B; b++) {
    const z = zs[b];
    for (let j = 0; j < N * PATCH; j++) {
      const src = j - pad, x = src >= 0 ? z[src] : NaN, k = b * N * PATCH + j;
      if (x === x) { vals[k] = x; mask[k] = 1; attn[b * N + ((j / PATCH) | 0)] = 1; }
    }
  }
  return { B, N, vals, mask, attn };
}

// Chronos-Bolt core inputs: patched (B,N,32) = [16 values, 16 mask], attn (B,N).
export function boltFeeds(rows, ctxLen = 2048) {
  const al = alignRows(rows, ctxLen);
  const sc = al.map(r => scaleRow(r, false));
  const p = patchRows(sc.map(s => s.z));
  const patched = new Float32Array(p.B * p.N * 2 * PATCH);
  for (let bn = 0; bn < p.B * p.N; bn++) {
    patched.set(p.vals.subarray(bn * PATCH, bn * PATCH + PATCH), bn * 2 * PATCH);
    patched.set(p.mask.subarray(bn * PATCH, bn * PATCH + PATCH), bn * 2 * PATCH + PATCH);
  }
  return {
    feeds: { patched: { data: patched, dims: [p.B, p.N, 2 * PATCH] }, attn: { data: p.attn, dims: [p.B, p.N] } },
    loc: sc.map(s => s.loc), scale: sc.map(s => s.scale), B: p.B, N: p.N,
  };
}

// Chronos-2 core inputs: ctx (B,Nc,48) = [time enc, values, mask],
// ctx_mask (B,Nc), fut (B,Nf,48) = [time enc, 0, 0], group_ids (B).
export function c2Feeds(rows, H, groups, ctxLen = 8192, maxPatches = 64) {
  const al = alignRows(rows, ctxLen);
  const sc = al.map(r => scaleRow(r, true));
  const p = patchRows(sc.map(s => s.z));
  const { B, N } = p, F = 3 * PATCH;
  const Nf = Math.min(Math.ceil(H / PATCH), maxPatches);
  const ctx = new Float32Array(B * N * F), fut = new Float32Array(B * Nf * F);
  for (let b = 0; b < B; b++) for (let n = 0; n < N; n++) {
    const o = (b * N + n) * F, s = (b * N + n) * PATCH;
    for (let k = 0; k < PATCH; k++) ctx[o + k] = Math.fround((n * PATCH + k - N * PATCH) / 8192);
    ctx.set(p.vals.subarray(s, s + PATCH), o + PATCH);
    ctx.set(p.mask.subarray(s, s + PATCH), o + 2 * PATCH);
  }
  for (let b = 0; b < B; b++) for (let n = 0; n < Nf; n++) {
    const o = (b * Nf + n) * F;
    for (let k = 0; k < PATCH; k++) fut[o + k] = Math.fround((n * PATCH + k) / 8192);
  }
  const g = groups || rows.map((_, i) => i);
  return {
    feeds: {
      ctx: { data: ctx, dims: [B, N, F] }, ctx_mask: { data: p.attn, dims: [B, N] },
      fut: { data: fut, dims: [B, Nf, F] }, group_ids: { data: BigInt64Array.from(g.map(v => BigInt(v))), dims: [B], type: 'int64' },
    },
    loc: sc.map(s => s.loc), scale: sc.map(s => s.scale), B, N, Nf,
  };
}

// Step 6. q: flat (B,Q,Hn) scaled output. Returns rows[b][qi] = Float64Array(H).
export function unscale(q, B, Q, Hn, H, loc, scale, sinh = false) {
  const out = [];
  for (let b = 0; b < B; b++) {
    const row = [];
    for (let j = 0; j < Q; j++) {
      const a = new Float64Array(H), o = (b * Q + j) * Hn;
      for (let h = 0; h < H; h++) { const v = q[o + h]; a[h] = (sinh ? Math.sinh(v) : v) * scale[b] + loc[b]; }
      row.push(a);
    }
    out.push(row);
  }
  return out;
}

// torch.quantile / numpy 'linear': sorted v, position p*(n-1).
export function quantileLinear(sorted, p) {
  const pos = p * (sorted.length - 1), i = Math.floor(pos), f = pos - i;
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * f : sorted[i];
}

// Chronos-Bolt forecast for H steps, with the pipeline's unroll past 64.
// run(feeds) -> Promise<Float32Array> of shape (B, 9, 64).
// Returns per row: levels x Float64Array(H).
export async function forecastBolt(run, rows, H, { ctxLen = 2048, step = 64, levels = BOLT_LEVELS } = {}) {
  const Q = levels.length;
  const call = async ctxRows => {
    const f = boltFeeds(ctxRows, ctxLen);
    const q = await run(f.feeds);
    return unscale(q, f.B, Q, step, step, f.loc, f.scale, false);
  };
  let pred = await call(rows);            // [b][q] Float64Array(step)
  const parts = [pred];
  let rem = H - step;
  if (rem > 0) {
    // the 9 paths per row: context + quantile path j
    let ctx = [];
    for (const r of rows) for (let j = 0; j < Q; j++) ctx.push(Float64Array.from(r));
    while (rem > 0) {
      const ext = [];
      for (let b = 0; b < rows.length; b++) for (let j = 0; j < Q; j++) {
        const c = ctx[b * Q + j], p = pred[b][j];
        const joined = new Float64Array(c.length + p.length); joined.set(c); joined.set(p, c.length);
        ext.push(joined.length > ctxLen ? joined.subarray(joined.length - ctxLen) : joined);
      }
      ctx = ext;
      const sub = await call(ctx);         // [(b*Q + j)][q](step)
      const next = [];
      for (let b = 0; b < rows.length; b++) {
        const row = levels.map(() => new Float64Array(step));
        const buf = new Float64Array(Q * Q);
        for (let h = 0; h < step; h++) {
          for (let j = 0; j < Q; j++) for (let k = 0; k < Q; k++) buf[j * Q + k] = sub[b * Q + j][k][h];
          buf.sort();
          for (let k = 0; k < Q; k++) row[k][h] = quantileLinear(buf, levels[k]);
        }
        next.push(row);
      }
      pred = next; parts.push(pred); rem -= step;
    }
  }
  return rows.map((_, b) => levels.map((_, k) => {
    const a = new Float64Array(H);
    let o = 0;
    for (const part of parts) { const s = part[b][k]; for (let h = 0; h < s.length && o < H; h++) a[o++] = s[h]; }
    return a;
  }));
}

// Chronos-2 forecast, H <= 1024. groups: one id per row; rows with the same
// id are forecast jointly (group attention), others independently.
// run(feeds) -> Promise<Float32Array> of shape (B, 13, Nf*16).
export async function forecastC2(run, rows, H, groups, { ctxLen = 8192, levels = C2_LEVELS } = {}) {
  if (H > 1024) throw new Error('Chronos-2 horizon is limited to 1024 steps here');
  const f = c2Feeds(rows, H, groups, ctxLen);
  const q = await run(f.feeds);
  return unscale(q, f.B, levels.length, f.Nf * PATCH, H, f.loc, f.scale, true);
}

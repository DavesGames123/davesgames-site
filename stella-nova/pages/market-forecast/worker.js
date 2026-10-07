// ============================================================================
//  INFERENCE WORKER  ·  market-forecast/worker.js — Chronos in onnxruntime-web
// ----------------------------------------------------------------------------
//  A module worker. engine.js starts it and sends it requests. It loads
//  onnxruntime-web from stella-nova/vendor (no CDN), makes one session per
//  model, and runs the forecasts with the steps in model-io.js.
//
//  Execution provider: "webgpu" when the worker has navigator.gpu and an
//  adapter, else "wasm". If the WebGPU session fails to build, the worker
//  uses wasm for that model and says so in the reply.
//
//  Weights. The bundled model (Bolt Tiny) is one ONNX file in models/. The
//  other graphs in models/ name "model.safetensors" as external data: the
//  official file on Hugging Face, at a pinned revision. The worker streams
//  it into Cache Storage ("mf-weights-v1"), checks its sha256, and gives
//  the bytes to the session. It joins the chunks at their real size and
//  uses the expected size only for progress: GitHub Pages and the HF CDN
//  can send a compressed content-length.
//
//  Messages in:  { id, op: 'init', ep: 'auto' | 'webgpu' | 'wasm' }
//                { id, op: 'load', model }
//                { id, op: 'forecast', model, rows: Float64Array[], H, groups? }
//  Messages out: { id, ok: true, result } or { id, ok: false, error }
//                { op: 'progress', model, phase, loaded, total }
//  The worker runs one request at a time (a session cannot run two).
//
//  grep -n targets
//    runtime start ....... "async function init"
//    weights fetch ....... "async function weightsFor"
//    session build ....... "async function sessionFor"
//    forecast ............ "async function forecast"
// ============================================================================
import { MODELS, hfUrl, forecastBolt, forecastC2 } from './model-io.js';

const ORT_DIR = new URL('../../vendor/onnxruntime-web@1.30.0/dist/', import.meta.url).href;
let ort = null, want = 'auto', gpuOk = false;
const sessions = new Map();   // model id -> { s, ep, createMs }

async function init(ep) {
  want = ep || 'auto';
  if (!ort) {
    ort = await import(ORT_DIR + 'ort.min.mjs');
    ort.env.wasm.wasmPaths = ORT_DIR;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.logLevel = 'error';
  }
  gpuOk = false;
  if (want !== 'wasm' && self.navigator && navigator.gpu) {
    try { gpuOk = !!(await navigator.gpu.requestAdapter()); } catch (e) { gpuOk = false; }
  }
  return { gpu: gpuOk, ep: gpuOk ? 'webgpu' : 'wasm', threads: ort.env.wasm.numThreads, isolated: !!self.crossOriginIsolated };
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function weightsFor(m) {
  const w = m.weights, url = hfUrl(w);
  let cache = null;
  try { cache = await caches.open('mf-weights-v1'); } catch (e) { cache = null; }
  let res = cache ? await cache.match(url) : null;
  const fromCache = !!res;
  if (!res) {
    res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Hugging Face answered ${res.status} for ${w.repo}`);
  }
  const reader = res.body.getReader(), parts = [];
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.byteLength;
    const now = performance.now();
    if (now - last > 120) { last = now; postMessage({ op: 'progress', model: m.id, phase: fromCache ? 'cache' : 'download', loaded: got, total: w.bytes }); }
  }
  const bytes = new Uint8Array(got);
  let o = 0; for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
  postMessage({ op: 'progress', model: m.id, phase: 'verify', loaded: got, total: w.bytes });
  const sum = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (sum !== w.sha256) {
    if (cache) await cache.delete(url).catch(() => {});
    throw new Error(`weights for ${w.repo} failed the sha256 check (${got} bytes)`);
  }
  if (cache && !fromCache) {
    try { await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* quota: run without the cache */ }
  }
  return { bytes, fromCache };
}

async function sessionFor(id) {
  if (sessions.has(id)) return sessions.get(id);
  const m = MODELS[id];
  if (!m) throw new Error('unknown model ' + id);
  const t0 = performance.now();
  const graphUrl = new URL(m.graph, new URL('./', import.meta.url)).href;
  const opts = { graphOptimizationLevel: 'all', logSeverityLevel: 3 };
  let weights = null;
  if (m.weights) {
    weights = await weightsFor(m);
    opts.externalData = [{ path: 'model.safetensors', data: weights.bytes }];
  }
  const tw = performance.now();
  postMessage({ op: 'progress', model: id, phase: 'session', loaded: 1, total: 1 });
  let s = null, ep = gpuOk && want !== 'wasm' ? 'webgpu' : 'wasm', fallback = null;
  try {
    s = await ort.InferenceSession.create(graphUrl, { ...opts, executionProviders: [ep] });
  } catch (e) {
    if (ep !== 'webgpu') throw e;
    fallback = String(e && e.message || e).slice(0, 200);
    ep = 'wasm';
    s = await ort.InferenceSession.create(graphUrl, { ...opts, executionProviders: ['wasm'] });
  }
  const rec = { s, ep, fallback, weightsMs: Math.round(tw - t0), createMs: Math.round(performance.now() - tw), fromCache: weights ? weights.fromCache : null, runs: 0 };
  sessions.set(id, rec);
  return rec;
}

async function forecast(id, rows, H, groups) {
  const m = MODELS[id], rec = await sessionFor(id);
  let calls = 0, runMs = 0;
  const run = async feeds => {
    const t = {};
    for (const [k, v] of Object.entries(feeds)) t[k] = new ort.Tensor(v.type || 'float32', v.data, v.dims);
    const t0 = performance.now();
    const out = await rec.s.run(t);
    runMs += performance.now() - t0; calls++;
    return out.quantiles.data;
  };
  const t0 = performance.now();
  const q = m.kind === 'bolt'
    ? await forecastBolt(run, rows, H, { ctxLen: m.ctxLen, step: m.step, levels: m.levels })
    : await forecastC2(run, rows, H, groups, { ctxLen: Math.min(m.ctxLen, 4096), levels: m.levels });
  rec.runs++;
  return {
    q, levels: m.levels, model: id, ep: rec.ep, fallback: rec.fallback,
    timings: { totalMs: Math.round(performance.now() - t0), runMs: Math.round(runMs), calls, createMs: rec.createMs, weightsMs: rec.weightsMs, firstRun: rec.runs === 1, fromCache: rec.fromCache },
  };
}

let chain = Promise.resolve();
self.onmessage = e => {
  const { id, op } = e.data;
  chain = chain.then(async () => {
    try {
      let result;
      if (op === 'init') result = await init(e.data.ep);
      else if (op === 'load') { const r = await sessionFor(e.data.model); result = { ep: r.ep, createMs: r.createMs, weightsMs: r.weightsMs, fallback: r.fallback, fromCache: r.fromCache }; }
      else if (op === 'forecast') result = await forecast(e.data.model, e.data.rows, e.data.H, e.data.groups);
      else throw new Error('unknown op ' + op);
      postMessage({ id, ok: true, result });
    } catch (err) {
      postMessage({ id, ok: false, error: String(err && err.message || err) });
    }
  });
};

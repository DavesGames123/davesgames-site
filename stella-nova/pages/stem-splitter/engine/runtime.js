// ============================================================================
//  RUNTIME  ·  stem-splitter/engine/runtime.js — the worker's request logic
// ----------------------------------------------------------------------------
//  createRuntime() holds the onnxruntime-web module, one session (the model
//  in use) and the cancel flag, and answers the requests of CONTRACT 5.3.
//  worker.js connects it to the worker's onmessage. It is a separate module
//  so that node tests can drive it with a fake ORT, fake model bytes and a
//  post() that records the replies and the transfer lists.
//
//  Execution provider (CONTRACT 2.4): "webgpu" when navigator.gpu gives an
//  adapter, else "wasm". When the WebGPU session fails to build, or its
//  first run throws, the runtime builds a wasm session, repeats the segment
//  and reports `fallback` (the first 200 characters of the error).
//  A run error that is not a cancel releases the session, so the next
//  load builds a new one (the device can be lost in the middle of a song).
//  Threads: min(4, cores) when cross-origin isolated, else 1.
//  Only one session lives at a time: load() of another model releases the
//  old one first (each holds 110-168 MB of float32 weights).
//
//  Replies: { id, ok: true, result } | { id, ok: false, error, code },
//  code in 'cancelled' | 'oom' | 'net' | 'hash' | 'session' | 'run'.
//  Events: { op: 'progress', phase, model, ... } (no id).
//
//  GREP MAP
//    factory / deps ........ "export function createRuntime"
//    error codes ........... "function codeOf"
//    init .................. "async function init"
//    load + fallback ....... "async function load", "async function makeSession"
//    one core run .......... "async function runCore"
//    separate .............. "async function separateOp"
//    request queue ......... "function handle"
// ============================================================================
import { separate } from './segment.js';
import { getModelBytes, cachedModels, evictModel, modelUrl } from './weights.js';

export const QUALITY = { standard: { shifts: 0, overlap: 0.25 }, best: { shifts: 2, overlap: 0.25 } };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const OOM = /out of memory|memory access out of bounds|allocation fail|failed to allocate|array buffer allocation|cannot allocate|bad_alloc|oom\b|webassembly\.memory/i;

function codeOf(err, fallbackCode) {
  if (err && err.code && typeof err.code === 'string' && /^(cancelled|oom|net|hash|session|run)$/.test(err.code)) return err.code;
  const msg = String(err && err.message || err);
  if (err instanceof RangeError || OOM.test(msg)) return 'oom';
  return fallbackCode;
}
const coded = (err, code) => Object.assign(err instanceof Error ? err : new Error(String(err)), { code: codeOf(err, code) });

// deps:
//   loadOrt()      -> Promise<ort module>         (worker: dynamic import of the vendor file)
//   ortDir         the vendor dist URL for env.wasm.wasmPaths
//   models         MODELS of models.js
//   post(msg, transfer)
//   getBytes(url, { bytes, sha256 }, onProgress) -> { data, fromCache }   (default: getModelBytes)
//   cached(models) / evict(model)                 (default: weights.js)
//   gpuAdapter()   -> Promise<boolean>            (default: navigator.gpu.requestAdapter)
//   env            { isolated, cores }            (default: self / navigator)
//   base           page folder URL for model files (default: weights.js)
export function createRuntime(deps) {
  const {
    loadOrt, ortDir, models, post,
    getBytes = (url, meta, onp) => getModelBytes(url, meta, onp),
    cached = m => cachedModels(m), evict = m => evictModel(m),
  } = deps;
  const env = deps.env || {
    isolated: typeof self !== 'undefined' && !!self.crossOriginIsolated,
    cores: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1,
  };
  const gpuAdapter = deps.gpuAdapter || (async () => {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return !!(await navigator.gpu.requestAdapter()); } catch (e) { return false; }
  });

  let ort = null, want = 'auto', gpu = false, threads = 1;
  let current = null;           // { id, session, ep, fallback, fromCache, downloadMs, createMs, bytes }
  let cancelFlag = false;

  async function init(ep = 'auto') {
    want = ep;
    if (!ort) {
      ort = await loadOrt();
      if (ortDir) ort.env.wasm.wasmPaths = ortDir;
      ort.env.logLevel = 'error';
    }
    threads = env.isolated ? Math.max(1, Math.min(4, env.cores || 1)) : 1;
    ort.env.wasm.numThreads = threads;
    gpu = want === 'wasm' ? false : await gpuAdapter();
    return { ep: gpu ? 'webgpu' : 'wasm', gpu, threads, isolated: !!env.isolated };
  }

  async function makeSession(m, bytes, ep) {
    return ort.InferenceSession.create(bytes.graph, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
      externalData: [{ path: m.weights.name, data: bytes.weights }],
    });
  }

  async function release() {
    if (!current) return;
    const s = current.session;
    current = null;
    try { if (s && s.release) await s.release(); } catch (e) { /* already gone */ }
  }

  async function load(id) {
    if (!ort) await init(want);
    const m = models[id];
    if (!m) throw Object.assign(new Error('unknown model ' + id), { code: 'session' });
    if (current && current.id === id) {
      const c = current;
      return { model: id, ep: c.ep, fallback: c.fallback, fromCache: c.fromCache, downloadMs: 0, createMs: 0 };
    }
    await release();
    const t0 = now();
    const total = m.graph.bytes + m.weights.bytes;
    let fromCache = true, before = 0;
    const fetchOne = async f => {
      const r = await getBytes(modelUrl(f.file, deps.base), { bytes: f.bytes, sha256: f.sha256 }, p => {
        if (p.phase === 'download') post({ op: 'progress', phase: 'download', model: id, loaded: before + p.loaded, total });
        else if (p.phase === 'verify') post({ op: 'progress', phase: 'verify', model: id });
      });
      fromCache = fromCache && r.fromCache;
      before += f.bytes;
      return r.data;
    };
    let bytes;
    try {
      bytes = { graph: await fetchOne(m.graph), weights: await fetchOne(m.weights) };
    } catch (e) { throw coded(e, 'net'); }
    const t1 = now();
    post({ op: 'progress', phase: 'session', model: id });
    let ep = gpu && want !== 'wasm' ? 'webgpu' : 'wasm', fallback = null, session;
    try {
      session = await makeSession(m, bytes, ep);
    } catch (e) {
      if (ep !== 'webgpu') throw coded(e, 'session');
      fallback = String(e && e.message || e).slice(0, 200);
      ep = 'wasm';
      try { session = await makeSession(m, bytes, ep); } catch (e2) { throw coded(e2, 'session'); }
    }
    // The bytes stay referenced only while a WebGPU first run may need a
    // wasm rebuild; runCore drops them after the first good run.
    current = { id, session, ep, fallback, fromCache, bytes, runs: 0,
      downloadMs: Math.round(t1 - t0), createMs: Math.round(now() - t1) };
    return { model: id, ep, fallback, fromCache, downloadMs: current.downloadMs, createMs: current.createMs };
  }

  async function runCore(m, mag, mix) {
    const c = current;
    const S = m.stems.length;
    const feeds = () => ({
      mag: new ort.Tensor('float32', mag, m.inputs.mag),
      mix: new ort.Tensor('float32', mix, m.inputs.mix),
    });
    let out;
    try {
      out = await c.session.run(feeds());
    } catch (e) {
      if (c.ep !== 'webgpu' || c.runs > 0 || !c.bytes) throw coded(e, 'run');
      // First WebGPU run failed: rebuild on wasm and repeat this segment.
      c.fallback = String(e && e.message || e).slice(0, 200);
      try { if (c.session.release) await c.session.release(); } catch (e2) { /* ignore */ }
      try { c.session = await makeSession(m, c.bytes, 'wasm'); } catch (e2) { throw coded(e2, 'session'); }
      c.ep = 'wasm';
      try { out = await c.session.run(feeds()); } catch (e2) { throw coded(e2, 'run'); }
    }
    c.runs++;
    c.bytes = null;
    const spec = out.spec_out, wave = out.wave_out;
    if (!spec || !wave) throw Object.assign(new Error('the graph did not give spec_out and wave_out'), { code: 'run' });
    const res = { spec_out: await spec.getData(), wave_out: await wave.getData() };
    if (res.spec_out.length !== S * mag.length) throw Object.assign(new Error('spec_out size ' + res.spec_out.length), { code: 'run' });
    for (const t of [spec, wave]) { try { if (t.dispose) t.dispose(); } catch (e) { /* ignore */ } }
    return res;
  }

  async function separateOp(msg) {
    const { model: id, left, right, quality = 'standard', shiftOffsets } = msg;
    const q = QUALITY[quality];
    if (!q) throw Object.assign(new Error('unknown quality ' + quality), { code: 'run' });
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length || !left.length) {
      throw Object.assign(new Error('left and right must be Float32Array of the same length'), { code: 'run' });
    }
    if (!current || current.id !== id) await load(id);
    const m = models[id];
    const t0 = now();
    let segments = 0;
    let out;
    try {
      out = await separate(left, right, {
        sources: m.stems.length, overlap: q.overlap, shifts: q.shifts, shiftOffsets,
        runCore: (mag, mix) => runCore(m, mag, mix),
        isCancelled: () => cancelFlag,
        onProgress: p => { segments = p.total; post({ op: 'progress', phase: 'separate', model: id, ...p }); },
      });
    } catch (e) {
      // A session that failed a run (for example, a lost GPU device) can
      // fail every later run. Release it, so the next load builds it again.
      if (codeOf(e, 'run') !== 'cancelled') await release();
      throw e;
    }
    const stems = {}, transfer = [];
    m.stems.forEach((name, s) => { stems[name] = out[s]; transfer.push(out[s][0].buffer, out[s][1].buffer); });
    return { result: { model: id, stems, ms: Math.round(now() - t0), ep: current ? current.ep : null, fallback: current ? current.fallback : null, segments }, transfer };
  }

  // One request at a time; cancel is answered at once.
  let chain = Promise.resolve();
  function handle(msg) {
    const { id, op } = msg || {};
    if (op === 'cancel') {
      cancelFlag = true;
      post({ id, ok: true, result: { cancelled: true } });
      return Promise.resolve();
    }
    chain = chain.then(async () => {
      let code = 'run';
      try {
        let result, transfer = [];
        if (op === 'init') result = await init(msg.ep || 'auto');
        else if (op === 'load') { code = 'net'; result = await load(msg.model); }
        else if (op === 'separate') {
          cancelFlag = false;
          ({ result, transfer } = await separateOp(msg));
        }
        else if (op === 'cached') result = await cached(models);
        else if (op === 'evict') {
          if (current && current.id === msg.model) await release();
          if (!models[msg.model]) throw new Error('unknown model ' + msg.model);
          await evict(models[msg.model]); result = { model: msg.model };
        }
        else if (op === 'dispose') { await release(); result = {}; }
        else throw new Error('unknown op ' + op);
        post({ id, ok: true, result }, transfer);
      } catch (err) {
        post({ id, ok: false, error: String(err && err.message || err), code: codeOf(err, code) });
      }
    });
    return chain;
  }

  return { handle, get state() { return { ort: !!ort, model: current && current.id, ep: current && current.ep, cancel: cancelFlag }; } };
}

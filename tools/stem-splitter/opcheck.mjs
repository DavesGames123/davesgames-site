#!/usr/bin/env node
// ============================================================================
//  OP CHECK  ·  tools/stem-splitter/opcheck.mjs — Stem Splitter graph ops
// ----------------------------------------------------------------------------
//  Lists the op types of each Stem Splitter graph (models/<id>.onnx) and
//  checks each one against the WebGPU (JSEP) kernels that the vendored
//  onnxruntime-web 1.30.0 names in ort.min.mjs. An op with no JS kernel
//  runs on the CPU side of the wasm build (ORT inserts copies), which is
//  slow on the GPU path. Shape-only ops (Reshape, Squeeze, Unsqueeze and so
//  on) are native JSEP kernels with no JS compute, so they are fine.
//
//  It also counts the initializers: each parameter must be EXTERNAL float16
//  in the official .th file, at a byte range inside it.
//
//  --run [--threads N] [--input DIR]: build a session with the vendored
//  runtime in node, wasm EP, with externalData = models/<file>.th, run one
//  segment and print the times and the node RSS. With --input DIR (made by
//  python tools/stem-splitter/parity.py --dump DIR) it uses the torch input
//  and compares the full outputs with torch (SDR). No browser.
//
//  Usage (repo root):
//    node tools/stem-splitter/opcheck.mjs [id ...]
//    node tools/stem-splitter/opcheck.mjs htdemucs --run --threads 4 --input <dir>
//  Exit 1 when an op other than a shape op has no WebGPU kernel, when a
//  parameter is not external float16, or when a --run SDR is under 60 dB.
//
//  grep -n targets
//    protobuf reader ........ "function fields"
//    graph summary .......... "function readGraph"
//    kernel list ............ "function jsepKernels"
//    session run ............ "async function runOne"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PAGE = path.join(ROOT, 'stella-nova', 'pages', 'stem-splitter');
const DIST = path.join(ROOT, 'stella-nova', 'vendor', 'onnxruntime-web@1.30.0', 'dist');
const LOCK = JSON.parse(fs.readFileSync(path.join(HERE, 'fetch.lock.json'), 'utf8'));
// JSEP kernels with no JS compute (views and shape data) + Constant (made an initializer).
const SHAPE_OPS = new Set(['Reshape', 'Squeeze', 'Unsqueeze', 'Flatten', 'Identity', 'Shape', 'Constant']);

// ---- minimal protobuf reader ------------------------------------------------
function varint(b, p) {
  let v = 0, s = 1;
  for (;;) { const c = b[p++]; v += (c & 127) * s; if (c < 128) return [v, p]; s *= 128; }
}
function* fields(b, start = 0, end = b.length) {
  let p = start;
  while (p < end) {
    let key; [key, p] = varint(b, p);
    const f = Math.floor(key / 8), w = key & 7;
    if (w === 0) { let v; [v, p] = varint(b, p); yield [f, w, v]; }
    else if (w === 2) { let n; [n, p] = varint(b, p); yield [f, w, [p, p + n]]; p += n; }
    else if (w === 1) { yield [f, w, null]; p += 8; }
    else if (w === 5) { yield [f, w, null]; p += 4; }
    else throw new Error(`wire type ${w} at ${p}`);
  }
}
const str = (b, [s, e]) => Buffer.from(b.subarray(s, e)).toString('utf8');

function readGraph(file) {
  const b = fs.readFileSync(file);
  const ops = new Map(), inits = { external: 0, f16: 0, inline: 0, inlineBytes: 0, ranges: [] };
  let graph = null;
  for (const [f, , v] of fields(b)) if (f === 7) graph = v;          // ModelProto.graph
  for (const [f, , v] of fields(b, ...graph)) {
    if (f === 1) {                                                   // GraphProto.node
      for (const [nf, , nv] of fields(b, ...v)) if (nf === 4) { const op = str(b, nv); ops.set(op, (ops.get(op) || 0) + 1); }
    } else if (f === 5) {                                            // GraphProto.initializer
      let ext = false, type = 0, size = 0; const kv = {};
      for (const [tf, , tv] of fields(b, ...v)) {
        if (tf === 2) type = tv;                                     // data_type
        else if (tf === 14) ext = tv === 1;                          // data_location
        else if (tf === 13) {                                        // external_data
          let k = '', val = '';
          for (const [ef, , ev] of fields(b, ...tv)) { if (ef === 1) k = str(b, ev); if (ef === 2) val = str(b, ev); }
          kv[k] = val;
        } else if ([4, 5, 7, 9, 10, 11].includes(tf) && Array.isArray(tv)) size += tv[1] - tv[0];   // data fields
      }
      if (ext) { inits.external++; if (type === 10) inits.f16++; inits.ranges.push(kv); }
      else { inits.inline++; inits.inlineBytes += size; }
    }
  }
  return { bytes: b.length, ops, inits };
}

function jsepKernels() {
  const s = fs.readFileSync(path.join(DIST, 'ort.min.mjs'), 'utf8');
  const i = s.indexOf('=new Map([["Abs",');
  if (i < 0) throw new Error('JSEP kernel map not found in ort.min.mjs');
  let d = 0, j = i + 9;
  for (; j < s.length; j++) { if (s[j] === '[') d++; else if (s[j] === ']' && --d === 0) break; }
  return new Set([...s.slice(i + 9, j + 1).matchAll(/\["([A-Za-z]+)",\[/g)].map(m => m[1]));
}

function sdr(ref, est) {
  let num = 0, den = 0;
  for (let k = 0; k < ref.length; k++) { const r = ref[k], e = r - est[k]; num += r * r; den += e * e; }
  return 10 * Math.log10(num / den);
}
const readF32 = p => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

async function runOne(id, threads, inputDir) {
  const ort = await import(path.join(DIST, 'ort.min.mjs'));
  ort.env.wasm.wasmPaths = DIST + '/';
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  const lock = LOCK.files[id];
  const thFile = path.join(ROOT, LOCK.dir, lock.file);
  if (!fs.existsSync(thFile)) { console.log(`  run: SKIP (weights absent: node tools/stem-splitter/fetch.mjs)`); return true; }
  const graph = fs.readFileSync(path.join(PAGE, 'models', id + '.onnx'));
  const th = new Uint8Array(fs.readFileSync(thFile));
  let t0 = performance.now();
  const sess = await ort.InferenceSession.create(graph, {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
    externalData: [{ path: lock.file, data: th }],
  });
  const createMs = performance.now() - t0;
  const SEG = 343980, T = 336;
  let mag, mix;
  if (inputDir) { mag = readF32(path.join(inputDir, `${id}.mag.f32`)); mix = readF32(path.join(inputDir, `${id}.mix.f32`)); }
  else {
    mag = new Float32Array(4 * 2048 * T); mix = new Float32Array(2 * SEG);
    for (let i = 0; i < mix.length; i++) mix[i] = 0.1 * Math.sin(i * 0.01);
    for (let i = 0; i < mag.length; i++) mag[i] = 0.1 * Math.sin(i * 0.37);
  }
  t0 = performance.now();
  const o = await sess.run({ mag: new ort.Tensor('float32', mag, [1, 4, 2048, T]), mix: new ort.Tensor('float32', mix, [1, 2, SEG]) });
  const runMs = performance.now() - t0;
  const rss = process.memoryUsage().rss / 1048576;
  console.log(`  run: wasm EP, ${threads} thread(s): create ${(createMs / 1000).toFixed(2)} s, run ${(runMs / 1000).toFixed(2)} s, ` +
    `spec_out [${o.spec_out.dims}] wave_out [${o.wave_out.dims}], node RSS ${rss.toFixed(0)} MB`);
  let ok = true;
  if (inputDir) {
    for (const k of ['spec', 'wave']) {
      const ref = readF32(path.join(inputDir, `${id}.${k}.f32`));
      const v = sdr(ref, o[k + '_out'].data);
      ok = ok && v >= 60;
      console.log(`  run: ${k}_out vs torch Core SDR ${v.toFixed(1)} dB (>= 60) ${v >= 60 ? 'ok' : 'FAIL'}`);
    }
  }
  await sess.release();
  return ok;
}

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const optVals = new Set([opt('--threads'), opt('--input')].filter(Boolean));
const ids = args.filter(a => !a.startsWith('--') && !optVals.has(a));
const kernels = jsepKernels();
let bad = 0;
console.log(`ort.min.mjs: ${kernels.size} JSEP (WebGPU) JS kernels`);
for (const id of ids.length ? ids : Object.keys(LOCK.files)) {
  const g = readGraph(path.join(PAGE, 'models', id + '.onnx'));
  const list = [...g.ops].sort((a, b) => b[1] - a[1]);
  const missing = list.filter(([op]) => !kernels.has(op) && !SHAPE_OPS.has(op));
  const shapeOnly = list.filter(([op]) => !kernels.has(op) && SHAPE_OPS.has(op));
  const th = LOCK.files[id];
  const outside = g.inits.ranges.filter(r => r.location !== th.file || +r.offset + +r.length > th.bytes);
  console.log(`${id}: ${g.bytes} B, ${list.reduce((s, [, n]) => s + n, 0)} nodes, ${list.length} op types`);
  console.log(`  ops: ${list.map(([op, n]) => `${op}:${n}`).join(' ')}`);
  console.log(`  shape ops (native JSEP, no JS compute): ${shapeOnly.map(([op]) => op).join(' ') || 'none'}`);
  console.log(`  ops with no WebGPU kernel: ${missing.map(([op, n]) => `${op}:${n}`).join(' ') || 'none'}`);
  console.log(`  initializers: ${g.inits.external} external (${g.inits.f16} float16, ${outside.length} outside ${th.file}), ` +
    `${g.inits.inline} inline (${g.inits.inlineBytes} B)`);
  if (missing.length || outside.length || g.inits.f16 !== g.inits.external) bad++;
  if (args.includes('--run')) {
    const ok = await runOne(id, +(opt('--threads') || 1), opt('--input'));
    if (!ok) bad++;
  }
}
process.exit(bad ? 1 : 0);

// ============================================================================
//  TEST-SUBMISSIONS  ·  runs and scores every preset (node tools/test-submissions.mjs)
// ----------------------------------------------------------------------------
//  For each reference scene and each preset of SUBMISSIONS, the test runs
//  the preset code with evaluate() (the same api that the worker gives),
//  checks the world with validate(), scores it against the scene with
//  scoreWorld(), and prints one row: scene, preset, the five families,
//  overall, and the build and score times.
//
//  Checks (the script exits with code 1 if one fails):
//    1. No preset gives an error, and each world is valid.
//    2. In each scene, the custom simulation has the highest dynamics
//       (mean of dyn2d and dyn3d), and the keyframe or static preset has
//       the lowest dynamics and the lowest overall.
//    3. Preset source: at most 120 lines, no import, no scenes.js.
//    4. Errors: a throw reports its line, a syntax error reports its
//       line, and code that returns nothing gives a clear error.
//       "export function build" and a plain function body both work.
//    5. Worker path: runSubmission() in a Node worker_threads shim. A
//       preset comes back with Float32Array positions (transferred), and an
//       endless loop is stopped by the time limit.
//
//  grep -n targets: "function nodeWorkerShim", "CHECKS", "TABLE"
// ============================================================================

import { Worker as NodeWorker } from 'node:worker_threads';
import { SCENES } from '../scenes.js';
import { SUBMISSIONS, evaluate, metaFor, runSubmission } from '../sandbox.js';
import { scoreWorld } from '../score.js';
import { validate } from '../world.js';

const FAM = ['perceptual', 'dyn2d', 'geom25', 'geom3d', 'dyn3d'];
const fails = [];
const check = (ok, what) => { console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}`); if (!ok) fails.push(what); };
const pad = (s, n) => String(s).padEnd(n);
const num = (x) => x.toFixed(3);

// ------------------------------------------------------------------ TABLE ---
console.log('TABLE  scene x preset (scores 0..1, higher is better)\n');
console.log(pad('scene', 11) + pad('preset', 22) + pad('strategy', 10) + FAM.map((f) => pad(f, 11)).join('') + pad('overall', 9) + pad('build ms', 10) + 'score ms');
const results = {};
for (const sc of SCENES) {
  const ref = sc.make();
  results[sc.id] = [];
  for (const p of SUBMISSIONS[sc.id] || []) {
    const r = await evaluate(p.code, metaFor(sc));
    if (!r.ok) {
      console.log(pad(sc.id, 11) + pad(p.id, 22) + pad(p.strategy, 10) + 'ERROR ' + r.errors.join('; '));
      results[sc.id].push({ p, ok: false, errors: r.errors });
      continue;
    }
    const s = scoreWorld(ref, r.world);
    const row = { p, ok: true, s, ms: r.ms, dyn: (s.families.dyn2d + s.families.dyn3d) / 2, valid: validate(r.world).ok };
    results[sc.id].push(row);
    console.log(pad(sc.id, 11) + pad(p.id, 22) + pad(p.strategy, 10) + FAM.map((f) => pad(num(s.families[f]), 11)).join('') +
      pad(num(s.overall), 9) + pad(r.ms.toFixed(0), 10) + s.ms.toFixed(0));
  }
}

console.log('\nraw distances (chamfer m, trajectoryDTW m, emdRatio, depthRelErr, ssim, dynamicIoU)');
for (const rows of Object.values(results)) for (const r of rows) if (r.ok) {
  const w = r.s.raw;
  console.log(`  ${pad(r.p.id, 22)} chamfer ${num(w.chamfer)}  dtw ${num(w.trajectoryDTW)}  emd ${num(w.emdRatio)}  depthErr ${num(w.depthRelErr)}  ssim ${num(w.ssim)}  iou ${num(w.dynamicIoU)}`);
}

// ----------------------------------------------------------------- CHECKS ---
console.log('\nCHECKS');
for (const [id, rows] of Object.entries(results)) {
  check(rows.length === 3, `${id}: three presets`);
  check(rows.every((r) => r.ok && r.valid), `${id}: every preset runs and is valid`);
  if (!rows.every((r) => r.ok)) continue;
  const custom = rows.find((r) => r.p.strategy === 'custom');
  const low = rows.find((r) => r.p.strategy === 'static' || r.p.strategy === 'keyframe');
  const others = rows.filter((r) => r !== custom);
  check(!!custom && others.every((r) => custom.dyn > r.dyn), `${id}: custom has the highest dynamics (${num(custom.dyn)} vs ${others.map((r) => num(r.dyn)).join(', ')})`);
  check(!!low && rows.every((r) => r === low || low.dyn < r.dyn), `${id}: ${low.p.strategy} has the lowest dynamics (${num(low.dyn)})`);
  check(!!low && rows.every((r) => r === low || low.s.overall < r.s.overall), `${id}: ${low.p.strategy} has the lowest overall (${num(low.s.overall)})`);
}
for (const list of Object.values(SUBMISSIONS)) for (const p of list) {
  const n = p.code.split('\n').length;
  check(n <= 120 && !/\bimport\b|scenes\.js/.test(p.code) && p.note && p.label, `${p.id}: ${n} lines, no import, has label and note`);
}

const meta = metaFor('rigid');
{
  const r = await evaluate('const a = 1;\nconst b = 2;\n\nthrow new Error("boom");\n', meta);
  check(!r.ok && /boom \(line 4\)/.test(r.errors[0]), `throw on line 4 is reported: ${r.errors[0]}`);
}
{
  const r = await evaluate('function build(api) {\n  const s = api.box(0.1, 0.1, 0.1);\n  return api.world([api.rigid("b", s, [1, 0, 0], (f) => { if (f > 3) undefinedThing(); return {}; })]);\n}', meta);
  check(!r.ok && /undefinedThing.*\(line 3\)/.test(r.errors[0]), `error inside a pose callback is reported: ${r.errors[0]}`);
}
{
  const r = await evaluate('const a = 1;\nconst b = 2;\nconst c = (a +* b);\nreturn [];\n', meta);
  check(!r.ok && /SyntaxError.*\(line 3\)/.test(r.errors[0]), `syntax error on line 3 is reported: ${r.errors[0]}`);
}
{
  // An open block must not hide the fault: the new Function wrapper adds
  // "})", so the prefix "function build(api) {" alone also fails.
  const r = await evaluate('function build(api) {\n  return [1, 2\n}', meta);
  check(!r.ok && /SyntaxError.*\(line 3\)/.test(r.errors[0]), `syntax error inside an open block is on line 3: ${r.errors[0]}`);
}
{
  const r = await evaluate('/* a block comment\n   on two lines */\nlet x = ;', meta);
  check(!r.ok && /SyntaxError.*\(line 3\)/.test(r.errors[0]), `syntax error after a block comment is on line 3: ${r.errors[0]}`);
}
{
  const r = await evaluate('const a = 1;', meta);
  check(!r.ok && /returned nothing/.test(r.errors[0]), `no result gives a clear error: ${r.errors[0]}`);
}
{
  const r = await evaluate('export function build(api) {\n  console.log("hello", api.frames);\n  return [api.solid("box", api.box(0.1, 0.1, 0.1), [1, 1, 1], [0, 0.1, 0])];\n}', meta);
  check(r.ok && r.log[0] === 'hello 90', `"export function build" form runs and logs: ${r.log[0]}`);
}
{
  const r = await evaluate('return api.world([api.points("p", 5, 0.01, [1, 1, 1])]);', meta);
  check(r.ok && r.world.frames === 90 && r.world.objects[0].pos.length === 5 * 3 * 90, 'function body form runs');
}
{
  const r = await evaluate('return [{ name: "bad", kind: "mesh", count: 3, pos: new Float32Array(9), color: [1, 1, 1] }];', meta);
  check(!r.ok && r.errors.some((e) => /faces/.test(e)), `validate() errors come back: ${r.errors[0]}`);
}

// Worker path. Node has no Web Worker, so a small shim runs
// sandbox-worker.js in worker_threads with self, postMessage, onmessage.
function nodeWorkerShim() {
  const boot = `
    const { parentPort, workerData } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (m, t) => parentPort.postMessage(m, t);
    const q = [];
    parentPort.on('message', (d) => (self.onmessage ? self.onmessage({ data: d }) : q.push(d)));
    import(workerData.url).then(() => { for (const d of q) self.onmessage({ data: d }); });`;
  globalThis.Worker = class {
    constructor(url) {
      this.w = new NodeWorker(boot, { eval: true, workerData: { url: String(url) } });
      this.w.on('message', (d) => this.onmessage && this.onmessage({ data: d }));
      this.w.on('error', (e) => this.onerror && this.onerror({ message: e.message }));
    }
    postMessage(d, t) { this.w.postMessage(d, t); }
    terminate() { this.w.terminate(); }
  };
}
nodeWorkerShim();
{
  const p = SUBMISSIONS.codim.find((x) => x.strategy === 'custom');
  const r = await runSubmission(p.code, { scene: 'codim' });
  const o = r.ok && r.world.objects.find((x) => x.name === 'cloth');
  check(r.ok && o && o.pos instanceof Float32Array && o.pos.length === o.count * 3 * 120 && o.faces instanceof Uint32Array,
    `runSubmission in a worker returns the world (${r.ms.toFixed(0)} ms)`);
}
{
  const t0 = performance.now();
  const r = await runSubmission('while (true) {}', { scene: 'rigid', timeoutMs: 600 });
  const dt = performance.now() - t0;
  check(!r.ok && /time limit/.test(r.errors[0]) && dt < 2000, `endless loop stopped after ${dt.toFixed(0)} ms: ${r.errors[0]}`);
}
{
  const r = await runSubmission('return [];', { scene: 'nope' });
  check(!r.ok && /unknown scene/.test(r.errors[0]), `unknown scene: ${r.errors[0]}`);
}

console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);

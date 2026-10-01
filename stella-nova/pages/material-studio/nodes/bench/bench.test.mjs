// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/bench.test.mjs — behaviour pins for the bench nodes
// ────────────────────────────────────────────────────────────────────────────
//  Node test with no browser and no GPU. It imports the public module
//  ../bench.js, loads the real Composition Bench catalog from disk (a fetch
//  shim reads file: URLs), and hashes what each part of the module makes.
//  It compares the hashes to bench.golden.json.
//
//      node nodes/bench/bench.test.mjs           compare to the golden file
//      node nodes/bench/bench.test.mjs --write   write the golden file again
//      BENCH_MODULE=<file url> node ...      pin another module (default ../bench.js)
//
//  PINS  (grep -n the name to jump)
//      exports ......... the export names of ../bench.js
//      defs ............ every NodeDef (functions removed) from loadBenchNodes
//      fallback ........ fallbackWGSL of every cell in five contexts, and the
//                        error text of each cell that throws
//      graph ........... importBenchGraph / exportBenchGraph round trips
//      runner .......... the call log of BenchRunner on a mock GPUDevice:
//                        shader code, buffer writes, textures, bind groups,
//                        draws, dispatches, pool trim and teardown
// ============================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const GOLDEN = new URL('./bench.golden.json', import.meta.url);
const UPDATE = process.argv.includes('--write');

// ------------------------------------------------------------ fetch shim
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, ...rest) => {
  const url = new URL(String(u));
  if (url.protocol !== 'file:') return realFetch(u, ...rest);
  try {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  } catch (e) { return { ok: false, status: 404, text: async () => '', json: async () => null }; }
};

// ------------------------------------------------------------ WebGPU globals
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const strip = o => JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v));

// ------------------------------------------------------------ mock device
function mockDevice(log) {
  let next = 0;
  const id = p => p + (next++);
  const desc = r => (r == null ? null : r.buffer ? { buffer: r.buffer.id } : r.id || String(r));
  const pass = kind => ({
    setPipeline: p => log.push([kind, 'pipe', p.id]),
    setBindGroup: (i, g) => log.push([kind, 'bind', i, g.id]),
    draw: n => log.push([kind, 'draw', n]),
    dispatchWorkgroups: (x, y) => log.push([kind, 'dispatch', x, y]),
    end: () => log.push([kind, 'end']),
  });
  const tex = d => {
    const t = { id: id('T'), d };
    t.createView = () => ({ id: t.id + 'v' });
    t.destroy = () => log.push(['destroy', t.id, d.label]);
    log.push(['texture', t.id, d.label, d.size, d.format, d.usage]);
    return t;
  };
  return {
    limits: { maxTextureDimension2D: 8192 },
    queue: {
      writeBuffer: (b, off, data) => log.push(['write', b.id, off, sha(Buffer.from(data.buffer, data.byteOffset, data.byteLength))]),
      submit: cbs => log.push(['submit', cbs.map(c => c.id)]),
    },
    createBindGroupLayout: d => { const o = { id: id('BGL') }; log.push(['bgl', o.id, d.label, strip(d.entries)]); return o; },
    createPipelineLayout: d => { const o = { id: id('PL') }; log.push(['pl', o.id, d.bindGroupLayouts.map(x => x.id)]); return o; },
    createSampler: d => { const o = { id: id('S') }; log.push(['sampler', o.id, strip(d)]); return o; },
    createTexture: tex,
    createBuffer: d => { const o = { id: id('B'), destroy: () => log.push(['destroy', o.id, d.label]) }; log.push(['buffer', o.id, d.label, d.size, d.usage]); return o; },
    createShaderModule: d => { const o = { id: id('M'), getCompilationInfo: async () => ({ messages: [] }) }; log.push(['module', o.id, d.label, sha(d.code)]); return o; },
    createRenderPipelineAsync: async d => { const o = { id: id('RP') }; log.push(['rpipe', o.id, d.label, d.layout.id, d.vertex.module.id, d.vertex.entryPoint, d.fragment.module.id, d.fragment.entryPoint, strip(d.fragment.targets)]); return o; },
    createComputePipelineAsync: async d => { const o = { id: id('CP') }; log.push(['cpipe', o.id, d.label, d.layout.id, d.compute.module.id, d.compute.entryPoint]); return o; },
    createBindGroup: d => { const o = { id: id('G') }; log.push(['group', o.id, d.layout.id, d.entries.map(e => [e.binding, desc(e.resource)])]); return o; },
    createCommandEncoder: (d = {}) => {
      const e = { id: id('E') };
      log.push(['encoder', e.id, d.label]);
      e.beginRenderPass = p => { log.push(['rpass', strip(p.colorAttachments.map(a => ({ ...a, view: a.view.id })))]); return pass('r'); };
      e.beginComputePass = () => { log.push(['cpass']); return pass('c'); };
      e.finish = () => ({ id: e.id + 'f' });
      return e;
    },
  };
}

// ------------------------------------------------------------ pins
const B = await import(process.env.BENCH_MODULE || '../bench.js');
const out = {};

// exports
out.exports = Object.keys(B).sort().join(' ');

// defs
const defs = await B.loadBenchNodes();
out.defCount = defs.length;
out.defs = sha(defs.map(strip).join('\n'));
out.passKeys = [...new Set(defs.map(d => Object.keys(d.pass).join(',')))].join(' | ');
out.statics = sha(strip({ L: B.LIB_TRAITS, N: B.BENCH_NON_TILEABLE, C: [...B.BENCH_NON_TILEABLE_CELLS], P: B.BENCH_PERIODIC, base: String(B.BENCH_BASE), page: String(B.BENCH_PAGE), key: B.BENCH_HANDOFF_KEY }));
out.benchDef = B.benchDef('bench.noise.fbm') === defs.find(d => d.type === 'bench.noise.fbm') && B.benchDef('nope') === null;

// fallback
const C = await B.catalog();
await Promise.all(Object.keys(C.LIBS).map(k => C.ensureLib(k)));
const CTXS = [
  d => ({ values: {} }),
  d => ({ values: { edge: 0 }, res: '512', tex: Object.fromEntries(d.bench.inputs.map((p, i) => [p.name, 't_in' + i])), samp: 's_rep' }),
  d => ({ values: { tile: 'repeat', zoom: 2, rotate: 30, offset: [0.1, -0.2], value: 'max', matte: 'keep', decode: 'srgb', coordSpace: 'bench' }, res: 256,
    tex: { [d.bench.inputs[0]?.name ?? 'x']: 't_in0' }, linked: { [d.bench.inputs[0]?.name ?? 'x']: false }, samp: 's' }),
  d => ({ values: { tile: 'mirror', edge: 0.3, outSpace: 'bench', k0: 0.9, x0: 0.2, state: 'thinking', time: 7.5, ink: '#ff0000', code: '' } }),
  d => ({ values: { tile: 'seamless', coordScale: 3, value: 'alpha' }, tex: Object.fromEntries(d.bench.inputs.map((p, i) => [p.name, 't_in' + i])), linked: Object.fromEntries(d.bench.inputs.map(p => [p.name, true])), samp: 'smp2' }),
];
const fb = [];
for (const d of defs) for (const mk of CTXS) {
  let s; try { s = B.fallbackWGSL(d, mk(d)); } catch (e) { s = 'THROW ' + e.message; }
  fb.push(d.type + '\n' + s);
}
out.fallback = sha(fb.join('\n\0\n'));
out.fallbackThrows = fb.filter(s => s.includes('\nTHROW ')).length;
out.withDefaults = sha(strip(defs.slice(0, 50).map(d => B.withDefaults(d, { k0: 0.3, offset: [1, 2] }))));
out.parseStruct = strip(B.parseStruct('struct Q { a: f32, // c\n b: vec2f, c: array<vec4f, 2>, }', 'Q'));
out.uniformCtor = B.uniformCtor('struct Q { a: f32, size: vec2f, c: vec3f, d: vec4f, e: array<vec4f, 2> }', 'Q', new Float32Array(32).map((_, i) => i * 0.5), 'f32(9)');

// graph
const bg = {
  name: 'pin', palette: { ink: '#101010' },
  nodes: [
    { id: 1, kind: 'noise', fn: 'fbm', x: 10, y: 20, k: [0.1, 0.2, 0.3, 0.4], xk: [] },
    { id: 2, kind: 'warp', x: 200, y: 20, k: [0.7], op: 'zzz' },
    { id: 3, kind: 'field', fn: 'vortex', x: 30, y: 300, k: [0.5] },
    { id: 4, kind: 'blend', op: Object.keys(C.GENERIC.blend.ops || { x: 1 })[1], x: 400, y: 50, k: [], code: ' // c ' },
    { id: 5, kind: 'orb', fn: 'nope', x: 0, y: 0, state: 2, xk: C.LIBS.orb.extras.map(() => 0.25) },
    { id: 6, kind: 'unknown_kind' },
    { id: 9, kind: 'output', x: 700, y: 90 },
  ],
  links: [
    { from: 1, to: 2, input: 'img' }, { from: 3, to: 2, input: 'p' }, { from: 1, to: 4, input: 'a' },
    { from: 2, to: 4, input: 'b' }, { from: 2, to: 4, input: 'b' }, { from: 4, to: 9, input: 'img' }, { from: 6, to: 2, input: 'img' },
  ],
};
const g1 = B.importBenchGraph(JSON.stringify(bg), { wire: ['baseColor', 'height', 'normal', 'baseColor'] });
const g2 = B.importBenchGraph({ ...bg, nodes: bg.nodes.filter(n => n.kind !== 'output') }, { idPrefix: 'z', settings: { res: 256 } });
out.import = sha(strip([g1, g2]));
out.export = sha(strip([B.exportBenchGraph(g1), B.exportBenchGraph(g2), B.exportBenchGraph({ nodes: [{ id: 'q', type: 'core.nope' }], links: [] })]));
let threw = []; for (const bad of [null, '{}', { nodes: [] }]) { try { B.importBenchGraph(bad); } catch (e) { threw.push(e.message); } }
try { B.exportBenchGraph(null); } catch (e) { threw.push(e.message); }
try { B.openInBench({ nodes: [], links: [] }); } catch (e) { threw.push(e.message); }
out.graphErrors = threw.join(' | ');
const store = new Map();
globalThis.localStorage = { setItem: (k, v) => store.set(k, v) };
const hand = B.openInBench(g1, { open: false });
out.handoff = sha(strip([hand, [...store]]));

// runner
const log = [];
const dev = mockDevice(log);
const jobs = [
  ['bench.noise.fbm', { res: 64, values: { edge: 0, offset: [0.25, 0.5] } }],
  ['bench.noise.fbm', { res: 64, values: { quality: '2', tile: 'repeat', zoom: 3 } , tiling: 3 }],
  ['bench.gen.warp', { res: 64, inputs: { img: { id: 'IN0', createView() { return { id: 'IN0v' }; } }, p: null }, tiling: 4 }],
  ['bench.gen.warp', { res: 128, inputs: { img: { id: 'IN1v' }, p: { id: 'IN2v' } }, values: { coordSpace: 'bench' } }],
  ['bench.sim.life', { res: 128, values: { steps: 20, grid: '256', filter: 'nearest', tile: 'repeat', simSeed: 3 }, seed: 5, time: 2 }],
  ['bench.sim.life', { res: 128, values: { steps: 3 } }],
  ['bench.orb.' + C.LIBS.orb.cells[0].name, { res: 32, values: { state: 'error' } }],
  ['bench.field.vortex', { res: 64 }],
];
for (const [type, j] of jobs) {
  log.push(['JOB', type]);
  const r = await B.runBenchPass(B.benchDef(type), { device: dev, target: { id: 'TARGET', createView() { return { id: 'TARGETv' }; } }, ...j });
  log.push(['ms-key', Object.keys(r).join(',')]);
}
await B.prepareBenchPass(B.benchDef('bench.color.magma'), dev, { k0: 0.2 });
log.push(['RENDER']);
const t = await B.renderBenchNode(dev, 'bench.noise.fbm', { res: 16 });
log.push(['render-out', t.id]);
log.push(['TRIM']); B.trimBench(dev); B.trimBench(null);
try { await B.runBenchPass(B.benchDef('bench.noise.fbm'), { device: dev, res: 8 }); } catch (e) { log.push(['err', e.message]); }
try { await B.runBenchPass(B.benchDef('bench.noise.fbm'), { res: 8, target: {} }); } catch (e) { log.push(['err', e.message]); }
let teardown = null;
const reg = {};
await B.init({ store: {}, gpu: { device: dev, onTeardown: f => { teardown = f; } }, register: (n, a) => { reg[n] = a; }, modules: {} });
log.push(['api', Object.keys(reg.bench).join(',')]);
log.push(['stats', strip({ ...reg.bench.stats(), ms: undefined })]);
log.push(['TEARDOWN']); teardown();
await B.runBenchPass(B.benchDef('bench.noise.fbm'), { device: dev, target: { id: 'T2v' }, res: 8 });
out.runner = sha(log.map(x => JSON.stringify(x)).join('\n'));
out.runnerLines = log.length;

// ------------------------------------------------------------ compare
if (UPDATE) {
  await writeFile(GOLDEN, JSON.stringify(out, null, 2) + '\n');
  console.log('golden written:', Object.keys(out).length, 'pins');
} else {
  const want = JSON.parse(await readFile(GOLDEN, 'utf8'));
  let bad = 0;
  for (const k of new Set([...Object.keys(want), ...Object.keys(out)])) {
    const ok = JSON.stringify(want[k]) === JSON.stringify(out[k]);
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k}${ok ? '' : `\n      want ${JSON.stringify(want[k])}\n      got  ${JSON.stringify(out[k])}`}`);
  }
  console.log(bad ? `${bad} pin(s) FAILED\nTESTS RED` : `bench.test: ${Object.keys(want).length} pins, 0 mismatches\nTESTS GREEN`);
  process.exit(bad ? 1 : 0);
}

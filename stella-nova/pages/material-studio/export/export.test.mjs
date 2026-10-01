// ============================================================================
//  MATERIAL STUDIO  ·  export/export.test.mjs — golden test of export.js
// ────────────────────────────────────────────────────────────────────────────
//  The test runs the public export.js API in Node with a fake main.js
//  context, a fake bake and a fake GPU device. It hashes every output: each
//  file of each engine package, the .glb, the map PNGs, the project JSON and
//  the selfTest result. The hashes in export.golden.json came from the
//  single-file export.js before the split into export/. A hash change is a
//  change of behaviour.
//
//  The README time line and the project "saved" time are set to a fixed
//  text before the hash. The DOM parts (panel, topbar, keys) need a browser.
//  The headless boot check covers them, not this test.
//
//  RUN
//      node stella-nova/pages/material-studio/export/export.test.mjs
//      node stella-nova/pages/material-studio/export/export.test.mjs --write
//          (writes export.golden.json again: only for a wanted change)
//
//  GREP TARGETS
//      fakeCtx  fakeBake  fakeDevice  CASES  digest  GOLDEN_FILE
// ============================================================================
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { EXPORT_TARGETS, MAP_NAMES, OUTPUT_TYPE } from '../contract.js';
import { f32ToF16, readZip } from '../zip.js';

const GOLDEN_FILE = new URL('./export.golden.json', import.meta.url);
const sha = d => createHash('sha256').update(typeof d === 'string' ? d : Buffer.from(d.buffer ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : d)).digest('hex').slice(0, 16);
const norm = s => s.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/g, 'T UTC').replace(/"saved":\s*"[^"]*"/g, '"saved":"T"');

// Texel value of a slot, 0..1 (emissive to 3 for the peak scale, extra.a -1..1).
function texel(slot, i, c) {
  const k = MAP_NAMES.indexOf(slot);
  let v = ((i * 7) + (c * 13) + (k * 31)) % 97 / 96;
  if (slot === 'emissive') v *= 3;
  if (slot === 'extra' && c === 3) v = (v * 2) - 1;
  return v;
}
const halfData = (slot, res) => { const n = res * res * 4, a = new Uint16Array(n); for (let i = 0; i < n; i++) a[i] = f32ToF16(texel(slot, i >> 2, i & 3)); return a; };
const mapSet = (res, fmt) => { const m = { res, scalars: { emissiveStrength: 2 } }; for (const s of MAP_NAMES) m[s] = { width: res, height: res, format: fmt, slot: s }; return m; };

// bake.readback, bakeAt, bakeOnce as the studio bake module has them.
function fakeBake(kind) {
  const b = {};
  if (kind !== 'texture') b.readback = async (slot, { maps }) => (kind === 'f32' ? Float32Array.from(halfData(slot, maps.res), (h, i) => texel(slot, i >> 2, i & 3)) : { data: halfData(slot, maps.res) });
  if (kind === 'bakeAt') b.bakeAt = async res => ({ ...mapSet(res, 'rgba16float'), release() { log.push('release ' + res); } });
  if (kind === 'bakeOnce') b.bakeOnce = async res => { const m = mapSet(res, 'rgba16float'); delete m.res; m.destroy = () => log.push('destroy ' + res); return m; };
  return b;
}
// copyTextureToBuffer + mapAsync with rows padded to 256 bytes.
function fakeDevice() {
  return {
    createBuffer: ({ size }) => ({ size, async mapAsync() {}, getMappedRange() { return this.bytes.buffer; }, unmap() {}, destroy() {} }),
    createCommandEncoder: () => ({
      copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [w, h]) {
        const bytes = new Uint8Array(buffer.size), dv = new DataView(bytes.buffer);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
          const v = texel(texture.slot, (y * w) + x, c), o = y * bytesPerRow;
          if (texture.format === 'rgba32float') dv.setFloat32(o + (((x * 4) + c) * 4), v, true);
          else if (texture.format === 'rgba16float') dv.setUint16(o + (((x * 4) + c) * 2), f32ToF16(v), true);
          else bytes[o + (x * 4) + (/^bgra/.test(texture.format) && c < 3 ? 2 - c : c)] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        }
        buffer.bytes = bytes;
      },
      finish: () => ({}),
    }),
    queue: { submit() {} },
  };
}
globalThis.GPUBufferUsage = { COPY_DST: 8, MAP_READ: 1 };
globalThis.GPUMapMode = { READ: 1 };
const keyHandlers = [];
globalThis.window = { __studio: {}, addEventListener: (ev, fn, cap) => keyHandlers.push([ev, cap, fn]) };
globalThis.document = {
  createElement: tag => ({ tag, click() { log.push(`click ${tag} ${this.download}`); }, remove() {} }),
  body: { appendChild() {} },
};
Object.defineProperty(navigator, 'clipboard', { value: { async writeText(t) { log.push('clipboard ' + t.length); } } });

const log = [];
const handlers = {};
function fakeCtx() {
  const state = {
    maps: mapSet(8, 'rgba16float'), scalars: { ior: 1.45, transmission: 0.25, displacementScale: 0.03, alphaMode: 'mask', alphaCutoff: 0.4, doubleSided: true },
    settings: { res: 8 }, view: { uvScale: 2, mesh: 'sphere', subdiv: 8 }, env: { exposure: 1 },
    graph: { name: 'Golden', output: 'o', nodes: [{ id: 'o', type: OUTPUT_TYPE, params: { emissiveStrength: 1.5 } }, { id: 'n', type: 'x', params: { a: 1 } }] },
  };
  const store = {
    state,
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return () => { handlers[ev] = handlers[ev].filter(f => f !== fn); }; },
    toast(m, k) { log.push(`toast ${k} ${m}`); },
    setRes(r) { log.push('setRes ' + r); state.settings.res = r; if (r !== 8) queueMicrotask(() => (handlers['bake:done'] || []).forEach(f => f(mapSet(r, 'rgba16float')))); },
  };
  return { store, gpu: { ok: true, device: fakeDevice() }, modules: {}, $: () => null, register(name, api) { this.api = api; } };
}

const CASES = [
  ...EXPORT_TARGETS.map(t => [t.id, {}]),
  ['unity-urp', { fmt: 'tga', heightFmt: 'exr', normalBits: 16 }],
  ['unity-hdrp', { heightFmt: 'png8', helpers: false, readme: false, includeGraph: false }],
  ['unity-builtin', { format: 'tga', unityShaderGuid: 'abc' }],
  ['unreal', { normalBits: 16, compress: 'store', unrealDest: '/Game/X/{name}' }],
  ['godot', { godotRoot: 'res://m/{name}/' }],
  ['gltf', { fold: false, displaceMesh: true }],
  ['png', { maps: ['basecolor', 'basecolor_alpha', 'opacity', 'normal', 'normal_dx', 'ao', 'roughness', 'smoothness', 'metallic', 'orm', 'height', 'emissive', 'clearcoat', 'clearcoat_roughness', 'sheen', 'anisotropy'], template: '{target}-{name}-{map}-{res}' }],
  ['png', { res: 4, bake: 'bakeAt' }],
  ['png', { res: 4, bake: 'bakeOnce' }],
  ['png', { res: 4, bake: 'setRes' }],
  ['unity-urp', { bake: 'f32' }],
  ['unreal', { bake: 'texture', texFmt: 'rgba16float' }],
  ['godot', { bake: 'texture', texFmt: 'rgba32float' }],
  ['png', { bake: 'texture', texFmt: 'bgra8unorm' }],
  ['png', { bake: 'texture', texFmt: 'rgba8unorm', res: 0, name: 'Bad Name!*' }],
];

async function digest() {
  const M = await import('../export.js');
  const C = fakeCtx();
  await M.init(C);
  const out = { exports: Object.keys(M).sort(), api: Object.keys(C.api).sort(), options: C.api.options() };
  for (const [i, [target, { bake = 'half', texFmt, ...opts }]] of CASES.entries()) {
    window.__studio.bake = fakeBake(bake === 'half' || bake === 'setRes' ? 'half' : bake);
    if (texFmt) C.store.state.maps = mapSet(8, texFmt);
    log.length = 0;
    const steps = [];
    const blob = await M.exportPackage(target, { ...opts, onProgress: (s, f) => steps.push(`${s}@${f.toFixed(3)}`) });
    C.store.state.maps = mapSet(8, 'rgba16float');
    C.store.state.settings.res = 8;
    const files = {};
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (target === 'gltf') files[blob.fileName] = sha(bytes);
    else for (const e of await readZip(bytes)) files[e.name] = /\.(txt|json|py|tres|mat|meta)$/.test(e.name) ? sha(norm(new TextDecoder().decode(e.data))) : sha(e.data);
    out[`${i} ${target} ${JSON.stringify(opts)} ${bake}`] = { name: blob.fileName, type: blob.type, entries: blob.entries.map(e => `${e.name}:${/README|studio\.json/.test(e.name) ? '-' : e.size}`), files, steps, log: [...log] };
  }
  window.__studio.bake = fakeBake('half');
  for (const slot of MAP_NAMES) for (const bits of [8, 16]) {
    const b = await M.exportMapPNG(slot, { bits });
    out[`map ${slot} ${bits}`] = `${b.fileName} ${sha(new Uint8Array(await b.arrayBuffer()))}`;
  }
  out.mapRes4 = sha(new Uint8Array(await (await M.exportMapPNG('albedo', { res: 4 })).arrayBuffer()));
  out.project = sha(norm(JSON.stringify(await M.projectJSON({ embed: true, name: 'P' }))));
  out.projectNoName = sha(norm(JSON.stringify(await M.projectJSON({ embed: false }))));
  out.scalars = M.scalarsNow();
  out.readTexture = {};
  for (const fmt of ['rgba16float', 'rgba32float', 'rgba8unorm', 'bgra8unorm', undefined]) out.readTexture[fmt] = sha(await M.readTexture({ width: 5, height: 3, format: fmt, slot: 'orm' }));
  out.guid = [M.unityGuid('x'), M.unityGuid(''), M.unityGuid('Golden/Golden.mat')];
  out.srgb = [0, 0.001, 0.0031308, 0.2, 0.5, 1].map(v => M.linToSrgb(v).toFixed(9));
  out.plain = Object.entries(M.PLAIN_MAPS).map(([k, m]) => `${k}:${m.label}`);
  out.formats = M.FORMATS;
  log.length = 0;
  out.copy = sha(norm(await M.copyMaterialJSON()));
  out.copyLog = [...log];
  out.keyHandlers = keyHandlers.map(([ev, cap]) => `${ev} ${cap}`);
  log.length = 0;
  const key = (k, mods) => { const e = { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...mods, preventDefault() { log.push('prevent ' + k); } }; keyHandlers[0][2](e); };
  key('s', { ctrlKey: true }); key('S', { metaKey: true }); key('s', { ctrlKey: true, altKey: true }); key('s', { ctrlKey: true, shiftKey: true });
  key('s', { ctrlKey: true, defaultPrevented: true }); key('s', {}); key('e', { ctrlKey: true }); key('x', { ctrlKey: true });
  await new Promise(r => setTimeout(r, 50));
  out.keys = [...log];
  out.selfTest = await M.selfTest();
  delete out.selfTest.last.size;  // the zip size follows the README time
  C.api.setOptions({ target: 'godot' });
  out.setOptions = C.api.options().target;
  out.last = C.api.last && C.api.last.target;
  return out;
}

const got = await digest();
if (process.argv.includes('--write')) {
  writeFileSync(GOLDEN_FILE, JSON.stringify(got, null, 1) + '\n');
  console.log(`export.test: wrote ${Object.keys(got).length} keys`);
} else {
  const want = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
  let pass = 0, fail = 0;
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const a = JSON.stringify(got[k]), b = JSON.stringify(want[k]);
    if (a === b) pass++;
    else { fail++; console.log(`FAIL ${k}\n  got  ${a?.slice(0, 400)}\n  want ${b?.slice(0, 400)}`); }
  }
  console.log(`export.test: ${pass}/${pass + fail} pass`);
  process.exitCode = fail ? 1 : 0;
}
process.exit();  // download() keeps a 30 s revoke timer

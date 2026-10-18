// ============================================================================
//  DLA TERRAIN  ·  gpu/mem-tally.mjs — a GPU memory tally for Deno runs
// ----------------------------------------------------------------------------
//  Wraps GPUDevice createTexture and createBuffer (and destroy), keeps the
//  live bytes of each object, then runs tools/render-frame.mjs with the same
//  arguments. At exit it prints "MEM live <MB> MB peak <MB> MB objects <n>"
//  and the largest labels. The step eval:__memLine() prints one line at
//  that point, so a run can check for leaks across regenerations:
//
//  deno run -A stella-nova/pages/dla-terrain/gpu/mem-tally.mjs coarse=1 \
//    w=390 h=844 'steps=ready;pump10;eval:__memLine();seed:2;seed:3;...;
//    seed:11;pump30;eval:__memLine()'
//
//  Texture bytes: width x height x layers (or depth) x bytes per texel, all
//  mips. The model does not count driver padding or the swap chain.
//  grep -n targets: "function texBytes", "__memLine", "BPT"
// ============================================================================
const BPT = {
  r8uint: 1, r8unorm: 1, rg8unorm: 2, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4,
  r16float: 2, rg16float: 4, rgba16float: 8, r32float: 4, rg32float: 8, rgba32float: 16, r32uint: 4,
  depth32float: 4, depth24plus: 4, 'depth24plus-stencil8': 4, rg11b10ufloat: 4,
};
const live = new Map();
let cur = 0, peak = 0;
const made = { tex: 0, buf: 0 }, freed = { tex: 0, buf: 0 };
export function texBytes(d) {
  const s = Array.isArray(d.size) ? d.size : [d.size.width, d.size.height || 1, d.size.depthOrArrayLayers || 1];
  const w = s[0], h = s[1] || 1, z = s[2] || 1, b = BPT[d.format] ?? 4, is3 = d.dimension === '3d';
  let t = 0;
  for (let i = 0; i < (d.mipLevelCount || 1); i++) t += Math.max(1, w >> i) * Math.max(1, h >> i) * (is3 ? Math.max(1, z >> i) : z) * b;
  return t * (d.sampleCount || 1);
}
function track(o, kind, label, bytes) {
  live.set(o, { kind, label: label || '?', bytes });
  cur += bytes; peak = Math.max(peak, cur); made[kind]++;
  const od = o.destroy.bind(o);
  o.destroy = () => { const r = live.get(o); if (r) { cur -= r.bytes; live.delete(o); freed[kind]++; } return od(); };
}
const P = globalThis.GPUDevice.prototype, oT = P.createTexture, oB = P.createBuffer;
P.createTexture = function (d) { const t = oT.call(this, d); track(t, 'tex', d.label, texBytes(d)); return t; };
P.createBuffer = function (d) { const b = oB.call(this, d); track(b, 'buf', d.label, d.size); return b; };
const MB = x => (x / 1048576).toFixed(1);
globalThis.__mem = () => {
  const by = {};
  let tex = 0, buf = 0;
  for (const r of live.values()) { const k = r.label.replace(/\d+$/, '#'); by[k] = (by[k] || 0) + r.bytes; if (r.kind === 'tex') tex++; else buf++; }
  return { cur, peak, tex, buf, made, freed, by };
};
globalThis.__memLine = () => { const m = globalThis.__mem(); return `MEMAT live ${MB(m.cur)} MB peak ${MB(m.peak)} MB textures ${m.tex} buffers ${m.buf}`; };
globalThis.addEventListener('unload', () => {
  const m = globalThis.__mem();
  console.log('MEM live', MB(m.cur), 'MB peak', MB(m.peak), 'MB objects', m.tex + m.buf, 'textures', m.tex, 'buffers', m.buf);
  for (const [k, v] of Object.entries(m.by).sort((a, b) => b[1] - a[1]).slice(0, 24)) console.log('  ', MB(v).padStart(7), k);
});
await import(new URL('../tools/render-frame.mjs', import.meta.url).href);

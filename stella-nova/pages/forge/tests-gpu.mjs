// ============================================================================
//  PLANET FORGE  ·  tests-gpu.mjs — WebGPU checks of render.js (Deno)
// ----------------------------------------------------------------------------
//  Run: deno run -A stella-nova/pages/forge/tests-gpu.mjs
//  Needs navigator.gpu (Deno has it). Each check prints one line; the
//  process exits 1 if a check fails.
//    1. 100 frames create no GPU buffer, bind group or texture.
//    2. The cloud map that render() builds in row slices while the hour
//       moves equals one full dispatch at the final hour.
//    3. Limb: a pixel whose centre just misses an airless sphere but is
//       more than 30 % covered shows the surface (analytic cover on both
//       sides of the edge, no 1-px staircase), and on an Earth-like world
//       the radial limb profile has no local minimum (no dark ring).
// ============================================================================
import { createRenderer } from './render.js';
import * as PR from './presets.js';
import { generate } from './maps.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const here = new URL('.', import.meta.url);
const loadText = n => Deno.readTextFile(new URL('shaders/' + n, here));
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { console.log('skip  no WebGPU adapter'); Deno.exit(0); }
const device = await adapter.requestDevice();
let gpuErr = '';
device.addEventListener?.('uncapturederror', e => { gpuErr += e.error.message + '\n'; });
const cnt = { buf: 0, bg: 0, tex: 0 };
for (const [k, f] of [['buf', 'createBuffer'], ['bg', 'createBindGroup'], ['tex', 'createTexture']]) {
  const o = device[f].bind(device); device[f] = d => { cnt[k]++; return o(d); };
}
const W = 640, H = 400;
const tgt = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
const view = tgt.createView();
const P = PR.fromPreset('earth', 7), M = generate(P, 256);
const cam = h => ({ pos: [2.6, 0.7, 1.8], target: [0, 0, 0], up: [0, 1, 0], fov: 0.6, w: W, h: H, t: h, exposure: 0.65, sunDir: [1, 0.3, 0.6], spin: h * 0.1, steps: 24, quality: 2, hours: h, cloudsOn: true });

const readMap = async tex => {
  const bpr = Math.ceil(tex.width * 4 / 256) * 256;
  const b = device.createBuffer({ size: bpr * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: b, bytesPerRow: bpr }, [tex.width, tex.height]);
  device.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
  const d = new Uint8Array(b.getMappedRange().slice(0)); b.unmap(); b.destroy(); return d;
};

// 1. no allocation per frame
{
  const R = await createRenderer({ device, format: 'rgba8unorm', loadText });
  R.setPlanet(P, M, {});
  R.render(cam(0), view);
  const c0 = { ...cnt };
  for (let f = 1; f <= 100; f++) R.render(cam(f * 0.0017), view);
  await device.queue.onSubmittedWorkDone();
  const d = { buf: cnt.buf - c0.buf, bg: cnt.bg - c0.bg, tex: cnt.tex - c0.tex };
  ok('render: 100 frames create no buffer, bind group or texture', !d.buf && !d.bg && !d.tex, JSON.stringify(d));

  // 2. slices converge: move the hour for 30 frames, hold it, then compare
  for (let f = 0; f < 30; f++) R.render(cam(5 + f * 0.0017), view);
  const hEnd = 5 + 29 * 0.0017;
  for (let f = 0; f < 10; f++) R.render(cam(hEnd), view);
  const a = await readMap(R.cloudMap);
  const R2 = await createRenderer({ device, format: 'rgba8unorm', loadText });
  R2.setPlanet(P, M, {});
  R2.render(cam(hEnd), view);
  const b = await readMap(R2.cloudMap);
  let diff = 0; for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  ok('render: the sliced cloud map equals one full dispatch at the final hour', diff === 0, `max byte diff ${diff}`);
  R.destroy(); R2.destroy();
}
// ── 3 and 4: terminator and limb, measured in renders ─────────────────
const nrm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
async function shoot(preset, seed, c, S = 400, clouds = false) {
  const Q = PR.fromPreset(preset, seed), MQ = generate(Q, 512);
  const R = await createRenderer({ device, format: 'rgba8unorm', loadText });
  R.setPlanet(Q, MQ, {});
  const t = device.createTexture({ size: [S, S], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  R.render({ ...c, w: S, h: S, t: 1, steps: 32, quality: 2, hours: 0, cloudsOn: clouds, starGain: 0, sunGain: 0, spin: 0 }, t.createView());
  const d = await readMap(t); R.destroy(); t.destroy();
  const bpr = Math.ceil(S * 4 / 256) * 256, lum = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * bpr + x * 4; lum[y * S + x] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; }
  // per pixel: closest approach of the ray to the centre (radii), the
  // pixel size there (radii) and, on the sphere, the sun elevation (deg)
  const f = nrm(c.target.map((v, i) => v - c.pos[i])), r = nrm(crs(f, c.up)), u = crs(r, f), th = Math.tan(c.fov / 2), L = nrm(c.sunDir);
  const geo = (x, y) => {
    const nx = (x + 0.5) / S * 2 - 1, ny = 1 - (y + 0.5) / S * 2;
    const rd = nrm([0, 1, 2].map(i => f[i] + r[i] * nx * th + u[i] * ny * th));
    const tca = -dt3(c.pos, rd), q = c.pos.map((v, i) => v + rd[i] * tca), dist = Math.hypot(...q);
    let el = NaN;
    if (dist < 1) { const tH = tca - Math.sqrt(1 - dist * dist), p = c.pos.map((v, i) => v + rd[i] * tH); el = Math.asin(dt3(p, L)) * 180 / Math.PI; }
    // the sun elevation under the closest approach (limb pixels)
    const elC = Math.asin(dt3(q, L) / dist) * 180 / Math.PI;
    return { dist, px: tca * 2 * th / S, el, elC };
  };
  return { S, lum, geo };
}
const sideCam = (d, ph) => {
  const c = nrm([Math.sin(0.6), 0.2, Math.cos(0.6)]), s = nrm(crs([0, 1, 0], c));
  const a = ph * Math.PI / 180;
  return { pos: c.map(v => v * d), target: [0, 0, 0], up: [0, 1, 0], fov: 0.5, exposure: 0.65, sunDir: c.map((v, i) => v * Math.cos(a) + s[i] * Math.sin(a)) };
};
{
  // limb of an airless moon: the sun behind the camera (full disc)
  const img = await shoot('moon', 1969, sideCam(3.2, 0)), inside = [];
  let part = 0, lit = 0;
  for (let y = 0; y < img.S; y++) for (let x = 0; x < img.S; x++) {
    const g = img.geo(x, y), cov = Math.min(1, Math.max(0, (1 - g.dist) / g.px + 0.5));
    if (g.dist < 0.9) inside.push(img.lum[y * img.S + x]);
    if (g.dist > 1 && cov > 0.3) { part++; if (img.lum[y * img.S + x] > 6) lit++; }
  }
  ok('limb: an airless edge pixel > 30 % covered shows the surface', part > 20 && lit / part > 0.9, `${lit} of ${part} part-covered pixels outside the sphere are lit`);
  // Earth-like: the median radial profile across the day-side limb (in
  // pixels from the edge) has no local minimum deeper than 8 (a dark
  // ring) from 3 px inside to 3 px outside
  const E = await shoot('earth', 4127, sideCam(3.2, 20), 400, true), bins = {};
  for (let y = 0; y < E.S; y++) for (let x = 0; x < E.S; x++) {
    const g = E.geo(x, y);
    if (g.elC < 10 || g.dist < 0.95 || g.dist > 1.05) continue;
    (bins[Math.round((g.dist - 1) / g.px)] ||= []).push(E.lum[y * E.S + x]);
  }
  const med = k => { const v = (bins[k] || [0]).slice().sort((a, b) => a - b); return v[v.length >> 1]; };
  const prof = [], dips = [];
  for (let k = -6; k <= 4; k++) { prof.push(Math.round(med(k))); if (k >= -3 && k <= 3 && med(k) + 8 < med(k - 1) && med(k) + 8 < med(k + 1)) dips.push(k); }
  ok('limb: no dark ring at the Earth-like limb', dips.length === 0, `median by px from the edge (-6..4): ${prof.join(' ')}`);
}
ok('render: no GPU validation errors', !gpuErr, gpuErr.trim());
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
Deno.exit(fails ? 1 : 0);

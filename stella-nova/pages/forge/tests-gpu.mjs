// ============================================================================
//  PLANET FORGE  ·  tests-gpu.mjs — WebGPU checks of render.js (Deno)
// ----------------------------------------------------------------------------
//  Run: deno run -A stella-nova/pages/forge/tests-gpu.mjs
//  Needs navigator.gpu (Deno has it). Each check prints one line; the
//  process exits 1 if a check fails.
//    1. 100 frames create no GPU buffer, bind group or texture.
//    2. The cloud map that render() builds in row slices while the hour
//       moves equals one full dispatch at the final hour.
//    3. Terminator: on an Earth-like world (no clouds) the ground light
//       falls from 50 % to 5 % of its value at 20 deg sun over at least
//       TERM_MIN_DEG of arc, twilight is still seen 2 deg past the
//       geometric terminator, and no step between adjacent pixels in the
//       band passes TERM_STEP. An airless moon keeps a short edge.
//    4. Limb: a pixel whose centre just misses an airless sphere but is
//       more than 30 % covered shows the surface (analytic cover on both
//       sides of the edge, no 1-px staircase), and on an Earth-like world
//       the radial limb profile has no local minimum (no dark ring).
//    5. Aurorae: the toggle off renders byte-identical frames to strength
//       0, and with the aurora on the night side changes.
//    6. Giants: the high haze correlates with the map's own band cirrus
//       at a shift of (0, 0) (no second, shifted cloud field).
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
const TERM_MIN_DEG = 4, TERM_STEP = 24, CLOUD_STEP = 40;
const sideCam = (d, ph) => {
  const c = nrm([Math.sin(0.6), 0.2, Math.cos(0.6)]), s = nrm(crs([0, 1, 0], c));
  const a = ph * Math.PI / 180;
  return { pos: c.map(v => v * d), target: [0, 0, 0], up: [0, 1, 0], fov: 0.5, exposure: 0.65, sunDir: c.map((v, i) => v * Math.cos(a) + s[i] * Math.sin(a)) };
};
function termProfile(img) {
  // mean luminance by sun elevation bins of 0.5 deg (all sphere pixels)
  const bins = new Map();
  for (let y = 0; y < img.S; y++) for (let x = 0; x < img.S; x++) {
    const g = img.geo(x, y); if (!(g.dist < 0.97)) continue;
    const k = Math.round(g.el * 2) / 2, b = bins.get(k) || [0, 0]; b[0] += img.lum[y * img.S + x]; b[1]++; bins.set(k, b);
  }
  const at = e => { const b = bins.get(Math.round(e * 2) / 2); return b ? b[0] / b[1] : NaN; };
  const ref = at(20);
  let e50 = NaN, e5 = NaN;
  for (let e = 20; e >= -15; e -= 0.5) { const v = at(e); if (Number.isNaN(e50) && v < 0.5 * ref) e50 = e; if (Number.isNaN(e5) && v < 0.05 * ref) { e5 = e; break; } }
  // the largest step between adjacent pixels along rows inside the band
  let step = 0;
  for (let y = 0; y < img.S; y++) for (let x = 1; x < img.S; x++) {
    const a = img.geo(x - 1, y), b = img.geo(x, y);
    if (!(a.dist < 0.97 && b.dist < 0.97) || Math.abs(a.el) > 8) continue;
    step = Math.max(step, Math.abs(img.lum[y * img.S + x] - img.lum[y * img.S + x - 1]));
  }
  return { ref, e50, e5, width: e50 - e5, past2: at(-2), dark: at(-14), step };
}
{
  const E = termProfile(await shoot('earth', 4127, sideCam(3.2, 90)));
  ok('terminator: Earth-like light falls 50 % -> 5 % over >= ' + TERM_MIN_DEG + ' deg', E.width >= TERM_MIN_DEG, `50 % at ${E.e50} deg, 5 % at ${E.e5} deg, width ${E.width} deg`);
  ok('terminator: Earth-like twilight is seen 2 deg past the terminator', E.past2 > E.dark + 2, `lum ${E.past2.toFixed(1)} at -2 deg, ${E.dark.toFixed(1)} at -14 deg`);
  ok('terminator: no adjacent-pixel step over ' + TERM_STEP + ' in the band', E.step <= TERM_STEP, `max step ${E.step.toFixed(1)}`);
  // with clouds: the deck keeps the sun past the ground terminator and
  // loses it by a fade (it was cut at a line, white to black)
  const C = await shoot('earth', 4127, sideCam(3.2, 90), 400, true);
  let cstep = 0;
  for (let y = 0; y < C.S; y++) for (let x = 1; x < C.S; x++) {
    const a = C.geo(x - 1, y), b = C.geo(x, y);
    if (!(a.dist < 0.97 && b.dist < 0.97) || a.el > -0.5 || a.el < -8) continue;
    cstep = Math.max(cstep, Math.abs(C.lum[y * C.S + x] - C.lum[y * C.S + x - 1]));
  }
  ok('terminator: with clouds, no step over ' + CLOUD_STEP + ' from -0.5 to -8 deg', cstep <= CLOUD_STEP, `max step ${cstep.toFixed(1)}`);
  const Mo = termProfile(await shoot('moon', 1969, sideCam(3.2, 90)));
  ok('terminator: an airless moon keeps a short edge (< 4 deg past 0)', !(Mo.e5 < -4), `5 % at ${Mo.e5} deg`);
}
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
// 5. aurorae: the toggle off renders byte-identical frames to a world
// whose aurora strength is 0; on, the night side changes
{
  const Q = PR.fromPreset('earth', 4127), MQ = generate(Q, 256);
  const R = await createRenderer({ device, format: 'rgba8unorm', loadText });
  const t = device.createTexture({ size: [256, 256], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const cam = { pos: [-1.2, 2.2, -0.9], target: [0, 0.6, 0], up: [0, 1, 0], fov: 0.8, w: 256, h: 256, t: 1, exposure: 0.65, sunDir: [0.8, 0.1, 0.6], spin: 0, steps: 24, quality: 2, hours: 3, cloudsOn: true, starGain: 0, sunGain: 0 };
  const shot = async (P, c) => { R.setPlanet(P, MQ, {}); R.render(c, t.createView()); return readMap(t); };
  const a = await shot(Q, { ...cam, auroraOn: false });
  const Q0 = PR.clone(Q); Q0.aurora.strength = 0;
  const b = await shot(Q0, { ...cam, auroraOn: true });
  const c = await shot(Q, { ...cam, auroraOn: true, storm: 1 });
  let same = true, diff = 0; for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) same = false; if (a[i] !== c[i]) diff++; }
  ok('aurora: toggle off gives byte-identical frames (vs strength 0); on changes the night side', same && diff > 500, `${diff} bytes differ with the aurora on`);
  R.destroy(); t.destroy();
}
// 6. giants: the high haze is the band cirrus of the maps, not a second
// cloud field that slides over the bands. Face-on render with the clouds
// on and off: the difference D (the haze layer) is cross-correlated with
// the map's cirrus alpha E at each pixel's surface point (the expected
// haze), over shifts of -6..6 px in x and y. The peak must sit at
// (0, 0) +-1 px with r > 0.3 for every giant with visible haze.
{
  const res = [];
  for (const [id, seed] of [['jupiter', 1979], ['saturn', 1610], ['neptune', 1846], ['hotjupiter', 51]]) {
    const Q = PR.fromPreset(id, seed); Q.rings.on = 0; Q.tilt = 0;
    const MQ = generate(Q, 512), S = 200;
    const R = await createRenderer({ device, format: 'rgba8unorm', loadText });
    R.setPlanet(Q, MQ, {});
    const t = device.createTexture({ size: [S, S], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const cam = { pos: [0, 0, 3.4], target: [0, 0, 0], up: [0, 1, 0], fov: 0.7, w: S, h: S, t: 1, exposure: 0.65, sunDir: [0.3, 0.05, 1], spin: 0, steps: 24, quality: 2, hours: 2, starGain: 0, sunGain: 0, auroraOn: false };
    R.render({ ...cam, cloudsOn: true }, t.createView()); const on = await readMap(t);
    R.render({ ...cam, cloudsOn: false }, t.createView()); const off = await readMap(t);
    R.destroy(); t.destroy();
    const bpr = Math.ceil(S * 4 / 256) * 256, L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const D = new Float64Array(S * S), E = new Float64Array(S * S), inn = new Uint8Array(S * S), th = Math.tan(0.35);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = (x + 0.5) / S * 2 - 1, ny = 1 - (y + 0.5) / S * 2;
      const rd = [nx * th, ny * th, -1], l = Math.hypot(...rd); rd[0] /= l; rd[1] /= l; rd[2] /= l;
      const b = 3.4 * rd[2], c = 3.4 * 3.4 - 1, disc = b * b - c;
      if (disc <= 0) continue;
      const tt = -b - Math.sqrt(disc), p = [rd[0] * tt, rd[1] * tt, 3.4 + rd[2] * tt];
      if (p[2] < 0.55) continue;   // keep to the face (no limb, no grazing)
      const u = ((Math.atan2(p[2], -p[0]) / (2 * Math.PI)) % 1 + 1) % 1, v = Math.acos(Math.max(-1, Math.min(1, p[1]))) / Math.PI;
      const k = y * S + x, mx = Math.min(MQ.W - 1, Math.floor(u * MQ.W)), my = Math.min(MQ.H - 1, Math.floor(v * MQ.H));
      inn[k] = 1; E[k] = MQ.cloud[(my * MQ.W + mx) * 4]; D[k] = L(on, y * bpr + x * 4) - L(off, y * bpr + x * 4);
    }
    const corr = (dx, dy) => {
      let n = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
      for (let y = 8; y < S - 8; y++) for (let x = 8; x < S - 8; x++) {
        const k = y * S + x, j = (y + dy) * S + x + dx;
        if (!inn[k] || !inn[j]) continue;
        const a2 = D[k], b2 = E[j]; n++; sa += a2; sb += b2; sab += a2 * b2; saa += a2 * a2; sbb += b2 * b2;
      }
      const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
      return va > 0 && vb > 0 ? (sab - sa * sb / n) / Math.sqrt(va * vb) : 0;
    };
    let best = -2, bx = 0, by = 0;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const c = corr(dx, dy); if (c > best) { best = c; bx = dx; by = dy; } }
    let hz = 0, nIn = 0; for (let k = 0; k < S * S; k++) if (inn[k]) { hz += Math.abs(D[k]); nIn++; }
    res.push({ id, bx, by, best, hz: hz / nIn });
  }
  ok('giants: the haze is the band cirrus at its own place (2D peak at (0, 0) +- 1 px, r > 0.3)', res.every(r => r.hz < 0.05 || (Math.abs(r.bx) <= 1 && Math.abs(r.by) <= 1 && r.best > 0.3)),
    res.map(r => `${r.id} peak (${r.bx}, ${r.by}) r ${r.best.toFixed(2)}, haze ${r.hz.toFixed(2)}`).join('; '));
}
ok('render: no GPU validation errors', !gpuErr, gpuErr.trim());
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
Deno.exit(fails ? 1 : 0);

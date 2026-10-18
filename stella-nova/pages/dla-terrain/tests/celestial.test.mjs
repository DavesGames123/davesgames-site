// ============================================================================
//  DLA TERRAIN  ·  tests/celestial.test.mjs — the night sky (package
//  CELESTIAL): node only, no GPU, no browser.
//  Run: node stella-nova/pages/dla-terrain/tests/celestial.test.mjs
// ----------------------------------------------------------------------------
//  1 the split of 'random' over 10,000 seeds matches SKY_WEIGHTS
//  2 phase geometry: the lit side of each body faces the sun, and the lit
//    part of the disc (the shader's rule, integrated) is (1 - s.b) / 2
//  3 the catalogue: positions, magnitudes and colours of known stars;
//    Polaris stands at the latitude over the north point
//  4 the star PSF keeps its energy at every sub-pixel position (no flicker)
//  5 the night light list: a full Moon over a crescent, a gas giant over a
//    moon, the full Moon at about 0.25 lux, brightest first
//  6 eclipses: a gas giant world sees the sun go behind the giant near the
//    equinox, not at the solstice
//  7 assets: every file of assets/sky has a credit, a licence and a URL;
//    map sizes and GPU bytes in budget
//  8 the GPU layer on a mock device: no texture or buffer is made after
//    create, over 300 updates and 20 system changes
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
const C = await import('../world/celestial-gen.js');
const L = await import('../render/celestial.js');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   celestial: ' + name); }
  catch (e) { fail++; console.log('  FAIL celestial: ' + name + '\n       ' + (e && e.message)); }
}
const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── 1
await check('the split of Random over 10,000 seeds is 70 / 18 / 12 % (within 1.5 points)', () => {
  const n = { one: 0, several: 0, giant: 0 };
  for (let s = 1; s <= 10000; s++) n[C.systemKind(s)]++;
  for (const k of Object.keys(n)) assert.ok(Math.abs(n[k] / 10000 - C.SKY_WEIGHTS[k]) < 0.015, `${k}: ${n[k]}`);
  console.log(`       one ${n.one}, several ${n.several}, giant ${n.giant}`);
  // and the systems agree with the kind
  for (let s = 1; s <= 400; s++) {
    const sys = C.celestialSystem(s);
    const moons = sys.bodies.filter((b) => b.kind === 'moon').length, giants = sys.bodies.filter((b) => b.kind === 'giant').length;
    if (sys.kind === 'one') assert.ok(moons === 1 && giants === 0 && sys.bodies[0].map === 'moon', 'one Moon: seed ' + s);
    if (sys.kind === 'several') assert.ok(moons >= 2 && moons <= 3 && giants === 0, 'two or three moons: seed ' + s);
    if (sys.kind === 'giant') assert.ok(giants === 1 && moons <= 3, 'one giant: seed ' + s);
    assert.ok(sys.bodies.length <= C.MAX_BODIES);
  }
  assert.equal(C.systemKind(5, 'giant'), 'giant');
  assert.equal(JSON.stringify(C.celestialSystem(77)), JSON.stringify(C.celestialSystem(77)), 'a pure function of the seed');
});

// ── 2
await check('phase geometry: the lit side faces the sun; the lit part of the disc is (1 - s.b) / 2', () => {
  let n = 0;
  for (const [seed, mode] of [[3, 'one'], [4, 'several'], [16, 'giant'], [1, 'giant']]) {
    const sys = C.celestialSystem(seed, mode);
    for (let i = 0; i < 24; i++) {
      const r = C.celestialAt(sys, i / 24, 0.31, 40, 3 + i / 24);
      for (const o of r.bodies) {
        const s = r.sunDir, b = o.dir;
        // the visible hemisphere: normals n with n.(-b) > 0, weight n.(-b)
        // (projected area); the shader lights mu0 = n.s > 0
        let lit = 0, all = 0, cx = 0;
        const e1 = Math.abs(b[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = [b[1] * e1[2] - b[2] * e1[1], b[2] * e1[0] - b[0] * e1[2], b[0] * e1[1] - b[1] * e1[0]];
        const ul = Math.hypot(...u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
        const v = [b[1] * u[2] - b[2] * u[1], b[2] * u[0] - b[0] * u[2], b[0] * u[1] - b[1] * u[0]];
        for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) {
          const px = x / 40.5, py = y / 40.5, q = px * px + py * py;
          if (q >= 1) continue;
          const mu = Math.sqrt(1 - q);
          const nn = [u[0] * px + v[0] * py - b[0] * mu, u[1] * px + v[1] * py - b[1] * mu, u[2] * px + v[2] * py - b[2] * mu];
          all++;
          if (dot(nn, s) > 0) { lit++; cx += px * dot(u, s) + py * dot(v, s) > 0 ? 1 : -1; }
        }
        const k = lit / all;
        assert.ok(Math.abs(k - o.phase) < 0.02, `${o.name}: disc lit ${k.toFixed(3)} vs phase ${o.phase.toFixed(3)}`);
        // the lit part leans toward the sun on the sky (when it is not full or new)
        if (o.phase > 0.05 && o.phase < 0.95) assert.ok(cx > 0, `${o.name}: lit side away from the sun`);
        n++;
      }
    }
  }
  console.log(`       ${n} body positions`);
});

// ── 3
const cat = C.parseStars(new Uint8Array(readFileSync(join(page, 'assets/sky/stars.bin'))));
const byHR = new Map(); for (let i = 0; i < cat.n; i++) byHR.set(cat.hr[i], i);
await check('catalogue: Sirius, Vega, Betelgeuse, Rigel and Polaris at their J2000 places and magnitudes', () => {
  assert.equal(cat.n, 9096);
  const known = [
    // HR, RA deg, Dec deg, V, B-V (Yale BSC5 values)
    [2491, 101.2871, -16.7161, -1.46, 0.00],   // Sirius 06 45 08.9 -16 42 58
    [7001, 279.2346, 38.7836, 0.03, 0.00],     // Vega 18 36 56.3 +38 47 01
    [2061, 88.7929, 7.4069, 0.50, 1.85],       // Betelgeuse 05 55 10.3 +07 24 25
    [1713, 78.6346, -8.2017, 0.12, -0.03],     // Rigel 05 14 32.3 -08 12 06
    [424, 37.9529, 89.2642, 2.02, 0.60],       // Polaris 02 31 48.7 +89 15 51
  ];
  for (const [hr, ra, dec, v, bv] of known) {
    const i = byHR.get(hr);
    assert.ok(i !== undefined, 'HR ' + hr);
    const dra = ((cat.ra[i] / D2R - ra + 540) % 360) - 180;
    assert.ok(Math.abs(dra * Math.cos(dec * D2R)) < 0.01 && Math.abs(cat.dec[i] / D2R - dec) < 0.01, `HR ${hr} at ${cat.ra[i] / D2R}, ${cat.dec[i] / D2R}`);
    assert.ok(Math.abs(cat.mag[i] - v) < 0.006 && Math.abs(cat.bv[i] - bv) < 0.006, `HR ${hr} V ${cat.mag[i]} B-V ${cat.bv[i]}`);
  }
  // the brightest star is Sirius; about 5000 stars to V 6
  let b = 0; for (let i = 1; i < cat.n; i++) if (cat.mag[i] < cat.mag[b]) b = i;
  assert.equal(cat.hr[b], 2491);
  const n6 = cat.mag.filter((m) => m <= 6).length;
  assert.ok(n6 > 4500 && n6 < 5300, 'stars to V 6: ' + n6);
  // colours: Betelgeuse red, Rigel blue-white, Sirius white
  const bet = C.starColor(1.85).rgb, rig = C.starColor(-0.03).rgb, sun = C.starColor(0.65);
  assert.ok(bet[0] / bet[2] > 2.5 && rig[2] / rig[0] > 1.1, 'B-V colours');
  assert.ok(Math.abs(sun.T - 5800) < 300, 'the Sun (B-V 0.65) near 5800 K: ' + sun.T.toFixed(0));
});
await check('the sky: Polaris at the latitude over the north point, the stars turn round it', () => {
  const i = byHR.get(424), e = C.radecToEq(cat.ra[i], cat.dec[i]);
  for (const lat of [46, 20, -30]) for (const tod of [0, 0.37, 0.8]) {
    const M = C.eqToWorld(C.localSidereal(tod, 0.3), lat * D2R);
    const w = [M[0] * e[0] + M[1] * e[1] + M[2] * e[2], M[3] * e[0] + M[4] * e[1] + M[5] * e[2], M[6] * e[0] + M[7] * e[1] + M[8] * e[2]];
    const el = Math.asin(w[1]) / D2R;
    assert.ok(Math.abs(el - lat) < 0.8, `lat ${lat}: Polaris el ${el.toFixed(2)}`);
    if (lat > 0) assert.ok(w[2] < 0 && Math.abs(w[0]) < 0.02, 'north is -z');
  }
  // the sun of sky-state.js lies on the frame: its declination from M
  const sys = C.celestialSystem(3, 'one');
  const r = C.celestialAt(sys, 0.3, 0.2, 46);
  const M = r.M, s = r.sunDir;
  const eq = [M[0] * s[0] + M[3] * s[1] + M[6] * s[2], M[1] * s[0] + M[4] * s[1] + M[7] * s[2], M[2] * s[0] + M[5] * s[1] + M[8] * s[2]];
  const dec = Math.asin(eq[2]) / D2R, ra = Math.atan2(eq[1], eq[0]);
  assert.ok(Math.abs(dec - 23.44 * Math.sin(2 * Math.PI * 0.2)) < 0.3, 'sun declination ' + dec);
  assert.ok(Math.abs(((ra - C.sunRA(0.2) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.01, 'sun right ascension');
  // Orion's Betelgeuse crosses the meridian near midnight in December
  const bi = byHR.get(2061), be = C.radecToEq(cat.ra[bi], cat.dec[bi]);
  const Md = C.eqToWorld(C.localSidereal(0.02, 0.75), 46 * D2R);
  const wb = [Md[0] * be[0] + Md[1] * be[1] + Md[2] * be[2], Md[3] * be[0] + Md[4] * be[1] + Md[5] * be[2], Md[6] * be[0] + Md[7] * be[1] + Md[8] * be[2]];
  assert.ok(wb[1] > 0.6 && wb[2] > 0, 'Betelgeuse high in the south at a December midnight');
});

// ── 4
await check('star PSF: the energy is the same at every sub-pixel position (within 0.1 %)', () => {
  for (const sig of [L.STAR_SIGMA_PX, 1.5, 2.5]) {
    let lo = 9, hi = 0;
    for (let i = 0; i < 400; i++) {
      const s = L.psfSum((i * 0.618034) % 1, (i * 0.381966 * 1.7) % 1, sig);
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    assert.ok(hi / lo < 1.001 && Math.abs(hi - 1) < 0.002, `sigma ${sig}: ${lo.toFixed(5)} .. ${hi.toFixed(5)}`);
    console.log(`       sigma ${sig} px: sum ${lo.toFixed(5)} .. ${hi.toFixed(5)}`);
  }
  // the WGSL constants are the ones of the twin
  const w = readFileSync(join(page, 'shaders/celestial.wgsl'), 'utf8');
  assert.ok(/CEL_PSF_RK: f32 = 3\.4641016/.test(w) && /CEL_PSF_INT: f32 = 0\.44879895/.test(w));
  assert.ok(Math.abs(Math.sqrt(12) - 3.4641016) < 1e-7 && Math.abs(Math.PI / 7 - 0.44879895) < 1e-8);
});

// ── 5
await check('night lights: full Moon > crescent, gas giant > moon, full Moon about 0.25 lux', () => {
  const sys = C.celestialSystem(3, 'one');
  let full = null, cres = null, maxTop = 0;
  for (let d = 0; d < 40 * 48; d++) {
    const days = d / 48, tod = days % 1;
    const r = C.celestialAt(sys, tod, 0.3, 30, days);
    const o = r.bodies[0];
    maxTop = Math.max(maxTop, o.luxTop);
    if (o.elevation > 25 && r.sunDir[1] < -0.1) {
      if (o.phase > 0.97 && !full) full = o;
      if (o.phase < 0.25 && o.phase > 0.1 && !cres) cres = o;
    }
  }
  assert.ok(full && cres, 'found a high full Moon and a crescent');
  assert.ok(full.lux > 5 * cres.lux && full.irradiance > cres.irradiance, `full ${full.lux} crescent ${cres.lux}`);
  assert.ok(full.lux > 0.15 && full.lux < 0.35, 'full Moon at the ground ' + full.lux.toFixed(3));
  assert.ok(maxTop > 0.2 && maxTop < 0.36, 'full Moon over the air ' + maxTop.toFixed(3));
  // a gas giant night: far brighter than any moon
  const g = C.celestialSystem(16, 'giant');
  let gmax = 0, list = null;
  for (let i = 0; i < 96; i++) { const r = C.celestialAt(g, i / 96, 0.3, 30, i / 96); const o = r.bodies.find((b) => b.kind === 'giant'); if (o.lux > gmax) { gmax = o.lux; list = r.lights; } }
  assert.ok(gmax > 100 * full.lux, 'giant ' + gmax.toFixed(1) + ' lux');
  assert.ok(C.hdrIrradiance(gmax) > 10 * C.hdrIrradiance(full.lux) && C.hdrIrradiance(gmax) < 20, 'HDR order and under the sun');
  assert.ok(Math.abs(C.hdrIrradiance(0.25) - 0.06) < 1e-9, 'a full Moon is MOON_ILLUM');
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].lux >= list[i].lux, 'brightest first');
  for (const l of list) {
    assert.ok(Math.abs(Math.hypot(...l.dir) - 1) < 1e-6 && l.dir[1] > -0.03, 'unit and above the horizon');
    const y = 0.2126 * l.color[0] + 0.7152 * l.color[1] + 0.0722 * l.color[2];
    assert.ok(Math.abs(y - 1) < 1e-6, 'colour of luminance 1');
  }
  console.log(`       full Moon ${full.lux.toFixed(3)} lux, crescent ${cres.lux.toFixed(4)} lux, giant ${gmax.toFixed(0)} lux (HDR ${C.hdrIrradiance(gmax).toFixed(2)})`);
});

// ── 6
await check('eclipses: the giant hides the sun once a day at the equinox, never at the solstice', () => {
  assert.equal(C.discOverlap(0.01, 0.1, 0.02), 1);
  assert.equal(C.discOverlap(0.01, 0.005, 0.1), 0);
  assert.ok(Math.abs(C.discOverlap(0.01, 0.01, 0) - 1) < 1e-9);
  let tested = 0;
  for (let s = 1; s < 200 && tested < 6; s++) {
    if (C.systemKind(s) !== 'giant') continue;
    const sys = C.celestialSystem(s);
    const rho = Math.asin(sys.giant.R / sys.giant.a);
    if (rho > 20 * D2R) continue;
    let eq = 0, sol = 0, runs = 0, prev = 0;
    for (let i = 0; i < 2880; i++) {
      const t = i / 2880;
      const e = C.celestialAt(sys, t, 0.0, 35, t).eclipse;
      eq = Math.max(eq, e);
      if (e > 0.5 && prev <= 0.5) runs++;
      prev = e;
      sol = Math.max(sol, C.celestialAt(sys, t, 0.25, 35, t).eclipse);
    }
    assert.ok(eq > 0.99 && runs === 1, `seed ${s}: equinox eclipse ${eq.toFixed(2)} (${runs} a day)`);
    assert.ok(sol < 0.01, `seed ${s}: solstice ${sol}`);
    tested++;
  }
  assert.ok(tested >= 3);
});

// ── 7
await check('assets: every file has a credit with a licence and a URL; sizes in budget', () => {
  const dir = join(page, 'assets/sky');
  const credits = readFileSync(join(dir, 'CREDITS.txt'), 'utf8');
  const blocks = credits.split(/\n\s*\n/);
  for (const f of readdirSync(dir)) {
    if (f === 'CREDITS.txt' || f.startsWith('.')) continue;
    const b = blocks.find((x) => x.includes(f));
    assert.ok(b, 'credit for ' + f);
    if (f !== 'sky-maps.json') assert.ok(/Licence:/.test(b) && /URL: https?:\/\//.test(b), 'licence and URL for ' + f);
  }
  const man = JSON.parse(readFileSync(join(dir, 'sky-maps.json'), 'utf8'));
  for (const id of Object.keys(C.BODY_MAPS)) assert.ok(man.maps[id] && man.maps[id].files.d && man.maps[id].files.p, 'map ' + id);
  // webp headers: width at most 2048 (desktop), 1024 (phone); the folder small
  let total = 0;
  for (const f of readdirSync(dir)) {
    total += statSync(join(dir, f)).size;
    if (!f.endsWith('.webp')) continue;
    const w = +f.match(/_(\d+)(k?)\.webp$/).slice(1).join('').replace('k', '') * (f.includes('k.webp') ? 1024 : 1);
    assert.ok(w <= 2048, f);
  }
  assert.ok(total < 3.5e6, 'assets/sky ' + (total / 1e6).toFixed(2) + ' MB');
  const d = L.celestialBytes('desktop'), p = L.celestialBytes('phone');
  assert.ok(d < 40e6 && p < 10e6, `GPU bytes desktop ${(d / 1e6).toFixed(1)} MB, phone ${(p / 1e6).toFixed(1)} MB`);
  assert.equal(L.mapSizes('phone-min').giant[0], 1024);
  console.log(`       files ${(total / 1e6).toFixed(2)} MB; GPU desktop ${(d / 1e6).toFixed(1)} MB, phone ${(p / 1e6).toFixed(1)} MB`);
});

// ── 8
await check('GPU layer on a mock device: no new GPU objects over 300 updates and 20 new systems', async () => {
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  globalThis.GPUBufferUsage = { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
  globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = new URL(u);
    const buf = readFileSync(fileURLToPath(url));
    return { ok: true, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), blob: async () => buf };
  };
  const count = { tex: 0, buf: 0, writeTex: 0, destroyed: 0 };
  const obj = () => ({ createView: () => ({}), destroy() { count.destroyed++; } });
  const device = {
    createBuffer: () => { count.buf++; return obj(); },
    createTexture: () => { count.tex++; return obj(); },
    createSampler: () => ({}), createBindGroupLayout: () => ({}), createBindGroup: () => ({}),
    createPipelineLayout: () => ({}), createShaderModule: () => ({}), createRenderPipelineAsync: async () => ({}),
  };
  const queue = { writeBuffer() {}, writeTexture() { count.writeTex++; }, copyExternalImageToTexture() {} };
  const gpu = {
    device, queue, profileId: 'desktop', hdrFormat: 'rgba16float', depthFormat: 'depth32float', globalsLayout: {},
    celestialImageLoader: async (url, w, h) => ({ data: new Uint8Array(w * h * 4), width: w, height: h }),
  };
  try {
    const layer = await L.createCelestialLayer(gpu, { layout: {}, bindGroup: {}, loadText: async () => '' });
    await layer.loaded();
    assert.ok(layer.ready, 'ready: ' + layer.error);
    const t0 = count.tex, b0 = count.buf;
    const pass = { setBindGroup() {}, setPipeline() {}, draw() {} };
    const globals = new Float32Array(132); globals[85] = -0.5;
    for (let i = 0; i < 300; i++) {
      const sys = C.createCelestial(1 + Math.floor(i / 15), ['random', 'one', 'several', 'giant'][Math.floor(i / 15) % 4]);
      layer.update({ globals, dt: 1 / 60, celestial: sys.at((i * 0.01) % 1, 0.3, 46), nightSky: 1 });
      layer.draw(pass);
      if (i % 15 === 14) await new Promise((r) => setTimeout(r, 0));
    }
    assert.equal(count.tex - t0, 0, 'textures made after create');
    assert.equal(count.buf - b0, 0, 'buffers made after create');
    assert.equal(count.destroyed, 0);
    assert.ok(layer.stats().stars === 9096);
    layer.dispose();
    assert.ok(count.destroyed >= 6);
  } finally { globalThis.fetch = realFetch; }
});

console.log(`celestial: ${pass} ok, ${fail} failed`);
if (fail) process.exitCode = 1;

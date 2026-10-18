// ============================================================================
//  DLA TERRAIN  ·  tests/cloudterrain.test.mjs — clouds, rain and snow meet
//  the terrain; the cloud layer reaches the horizon (node, no GPU)
//  Run: node stella-nova/pages/dla-terrain/tests/cloudterrain.test.mjs
// ----------------------------------------------------------------------------
//  Why (2026-10-18, the user): "the geometry of the clouds and other
//  atmospheric objects need to interact with the terrain", "if i look
//  abouve the horizon on DLA it looks like the screen stops rendering.
//  the clouds don't render from far away enough".
//    A  clouds.wgsl cl_ground: no cloud density under the ground, a soft
//       contact over CL_CONTACT_M (JS twin), and cl_density (so also the
//       cloud shadow map and the light march) applies it
//    B  every view ray above the horizon (0.3 to 90 deg, all bearings)
//       from a valley eye gets clouds from the near march (the slab, cut
//       at half the cloud map) or from the far layer (cl_far, CL_FAR0 of
//       the map to CL_FAR_M): no gap and no direction left out (JS twin of
//       sky.wgsl sk_layerHit and sk_slab)
//    C  a cloudy preset: the weather field that render/sky.js uploads has
//       the preset cover everywhere, so the coverage at 20 to 60 km is not
//       zero; the cloud map spans 60 km each way
//    D  rain and snow: the drops under the ground are not drawn (the
//       vsPrecip rule, JS twin over a hillside), splashes sit on the ground
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   cloudterrain: ' + name); }
  catch (e) { fail++; console.log('  FAIL cloudterrain: ' + name + '\n       ' + (e && e.message)); }
}
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
const clouds = readFileSync(join(page, 'shaders/clouds.wgsl'), 'utf8');
const weatherW = readFileSync(join(page, 'shaders/weather.wgsl'), 'utf8');
const constOf = (src, name) => { const m = new RegExp('const ' + name + ': f32 = ([0-9.e+-]+);').exec(src); return m ? +m[1] : NaN; };
const ss = (a, b, x) => { const u = Math.min(Math.max((x - a) / (b - a), 0), 1); return u * u * (3 - 2 * u); };
const fnBody = (src, name) => { const m = new RegExp('fn ' + name + '\\(([\\s\\S]*?)\\n\\}').exec(src); return m ? m[0] : ''; };

// ── A
await check('A cl_ground: no cloud under the ground, a soft contact, applied in cl_density', () => {
  const CM = constOf(clouds, 'CL_CONTACT_M');
  assert.ok(CM > 0 && CM <= 200, 'CL_CONTACT_M ' + CM);
  const g = fnBody(clouds, 'cl_ground');
  assert.ok(/sk_ss\(0\.0, CL_CONTACT_M, p\.y - baseHeight\(p\.xz\)\)/.test(g) && /insideTerrain\(p\.xz\)/.test(g), g);
  const twin = (y, h) => (y > 4000 + 20 ? 1 : ss(0, CM, y - h));
  for (const [y, h] of [[900, 1000], [1000, 1000], [999.9, 1000]]) assert.equal(twin(y, h), 0, `${y} over ${h}`);
  assert.ok(twin(1030, 1000) > 0 && twin(1030, 1000) < 1 && twin(1000 + CM, 1000) === 1);
  const d = fnBody(clouds, 'cl_density');
  assert.ok(/let gk = cl_ground\(p\);/.test(d) && /if \(gk <= 0\.0\) \{ return 0\.0; \}/.test(d) && /\* gk;/.test(d), 'cl_density uses gk');
  assert.ok(/cl_density\(p0 \+ sd \*/.test(fnBody(clouds, 'csCloudShadow')), 'the cloud shadow map marches cl_density (so its shadows follow the cut)');
});
await check('A csCloudMap: orographic lift on windward slopes and caps on peaks near the base', () => {
  const m = fnBody(clouds, 'csCloudMap');
  assert.ok(/upslope/.test(m) && /terrainNormal\(xz\)/.test(m) && /let cap = sk_ss\(base - 250\.0, base \+ 150\.0, gnd\)/.test(m) && /w\.cover > 0\.02/.test(m), m.slice(0, 200));
});

// ── B
const SK_R = 6360000;
const layerH = (p) => p[1] + (p[0] * p[0] + p[2] * p[2]) / (2 * SK_R);
function layerHit(ro, rd, h) {
  const a = (rd[0] * rd[0] + rd[2] * rd[2]) / (2 * SK_R), b = rd[1] + (ro[0] * rd[0] + ro[2] * rd[2]) / SK_R, c = layerH(ro) - h;
  if (a < 1e-12) { if (Math.abs(b) < 1e-9) return [-1, -1]; const t = -c / b; return [t, t]; }
  const d = b * b - 4 * a * c; if (d < 0) return [-1, -1];
  const s = Math.sqrt(d), t0 = (-b - s) / (2 * a), t1 = (-b + s) / (2 * a);
  return [Math.min(t0, t1), Math.max(t0, t1)];
}
function slab(ro, rd, h0, h1, tMax) {
  const hr = layerH(ro), A = layerHit(ro, rd, h0), B = layerHit(ro, rd, h1);
  let t0 = 0, t1 = tMax;
  if (hr < h0) {
    if (A[1] < 0) return [1, -1];
    t0 = Math.max(A[1], 0); if (A[0] > 0) t0 = A[0];
    t1 = B[1] > t0 ? B[1] : tMax; if (B[0] > t0) t1 = B[0];
  } else if (hr > h1) {
    if (B[0] < 0 || B[1] < 0) return [1, -1];
    t0 = Math.max(B[0], 0); t1 = A[0] > t0 ? A[0] : B[1];
  } else { let e = tMax; if (A[0] > 0) e = Math.min(e, A[0]); if (B[1] > 0) e = Math.min(e, B[1]); if (B[0] > 0) e = Math.min(e, B[0]); t1 = e; }
  return [t0, Math.min(t1, tMax)];
}
const { CLOUD_MAP_M } = await import('../render/sky.js');
await check('B every ray above the horizon gets near (march) or far (cl_far) clouds, no gap', () => {
  const FAR0 = constOf(clouds, 'CL_FAR0'), FARM = constOf(clouds, 'CL_FAR_M');
  assert.ok(FAR0 > 0 && FAR0 < 0.5 && FARM >= 150000, `CL_FAR0 ${FAR0} CL_FAR_M ${FARM}`);
  assert.ok(/min\(0\.5 \* S\.cmap\.z, cl_sceneLimit/.test(clouds), 'the march ends at half the map side');
  const tMarch = 0.5 * CLOUD_MAP_M, tFar0 = FAR0 * CLOUD_MAP_M * 0.95;
  const h0 = 1150, h1 = 2600, mid = h0 + (h1 - h0) * 0.3;
  let worst = '', n = 0, reach = 0;
  for (const eye of [[3000, 800, -2000], [-9000, 300, 7000], [0, 2000, 0]]) {
    for (let e = 0.3; e <= 90; e += e < 5 ? 0.35 : 5) for (let az = 0; az < 360; az += 15) {
      const el = e * Math.PI / 180, a = az * Math.PI / 180;
      const rd = [Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)];
      const s = slab(eye, rd, h0, h1, tMarch);
      const near = s[1] > s[0];
      const hit = layerHit(eye, rd, mid);
      const tf = layerH(eye) > mid ? hit[0] : hit[1];
      const far = tf >= tFar0 && tf <= FARM;
      n++;
      if (far) reach = Math.max(reach, tf);
      if (!near && !far) worst = `eye ${eye} elevation ${e.toFixed(2)} bearing ${az}: march [${s[0].toFixed(0)}, ${s[1].toFixed(0)}], far t ${tf.toFixed(0)}`;
    }
  }
  assert.equal(worst, '', worst);
  console.log(`# ${n} rays above the horizon all reach clouds; the far layer reaches ${(reach / 1000).toFixed(0)} km`);
  assert.ok(tFar0 < tMarch, 'the far layer starts before the march ends');
});

// ── C
await check('C a cloudy preset: the uploaded weather field has the cover everywhere; the map spans 60 km', async () => {
  const writes = [];
  const obj = (extra = {}) => ({ createView: () => obj(), destroy() {}, ...extra });
  const device = {
    features: new Set(), limits: { maxTextureDimension2D: 8192 },
    createBindGroupLayout: (d) => ({ entries: d.entries }), createPipelineLayout: (d) => ({ groups: d.bindGroupLayouts }),
    createShaderModule: () => ({}), createComputePipelineAsync: async (d) => ({ label: d.label }), createRenderPipelineAsync: async (d) => ({ label: d.label }),
    createBuffer: (d) => obj({ size: d.size }), createTexture: (d) => obj({ label: d.label, size: d.size }), createSampler: () => obj(), createBindGroup: () => ({}),
  };
  const queue = { writeBuffer() {}, writeTexture(dst, data) { writes.push({ label: dst.texture.label, data }); } };
  const common = readFileSync(join(page, 'shaders/common.wgsl'), 'utf8');
  const lay = device.createBindGroupLayout({ entries: [] });
  const gpu = { device, queue, hdrFormat: 'rgba16float', depthFormat: 'depth32float', globalsLayout: lay, shadowSampleLayout: lay, quality: 1, profile: null,
    loadWGSL: async (f) => common + readFileSync(join(page, f), 'utf8'), loadRawWGSL: async (f) => readFileSync(join(page, f), 'utf8') };
  const { createSky } = await import('../render/sky.js');
  const { GLOBALS } = await import('../sky-state.js');
  const sky = await createSky(gpu);
  const g = new Float32Array(GLOBALS.floats + 4);
  g.set([0, 800, 0], GLOBALS.camPos); g.set([0.3, 0.6, 0.2, 1], GLOBALS.sunDir); g.set([640, 400, 1 / 640, 1 / 400], GLOBALS.screen);
  sky.update({ globals: g, quality: 1, dt: 1 / 60, weather: { wx: { cover: 0.58, rain: 0, snow: 0, storm: 0.05, fog: 5.5e-5, cumulus: 0.75, cirrus: 0.5, mie: 1.3 } } });
  const wx = writes.find((w) => w.label === 'weather model');
  assert.ok(wx, 'no weather model upload');
  const { f16 } = await import('../render/sky.js');
  const want = f16(0.58);
  let bad = 0, n = 0;
  for (let k = 0; k < wx.data.length / 4 / 6; k++) { n++; if (wx.data[k * 4] !== want) bad++; }
  assert.ok(n > 100 && bad === 0, `${bad} of ${n} texels without the cover`);
  assert.ok(CLOUD_MAP_M / 2 >= 60000, 'the cloud map half side ' + CLOUD_MAP_M / 2);
});

// ── D
const { rainDropPos, precipPhases } = await import('../render/weather.js');
await check('D rain and snow under the ground are not drawn; splashes sit on the ground', () => {
  const vs = fnBody(weatherW, 'vsPrecip');
  const cuts = vs.match(/if \(y < terrainHeight\(xz\)\) \{ return o; \}/g) || [];
  assert.equal(cuts.length, 2, 'the rain and the snow cut');
  assert.ok(/let y = terrainHeight\(xz\) \+ 0\.02;/.test(vs), 'splashes on the ground');
  // the twin: a camera on a hillside; the drawn drops are all over the ground
  const ground = (x, z) => 0.4 * x + 30 * Math.sin(z / 9);
  const cam = [0, ground(0, 0) + 1.7, 0];
  const st = { clock: 3.2 };
  const ph = precipPhases(st, [3, 1], 1 / 60, 32, 26);
  let drawn = 0, under = 0, cut = 0;
  for (let k = 0; k < 4000; k++) {
    const h = [((k * 0.6180339) % 1), ((k * 0.7548776) % 1), ((k * 0.5698403) % 1)];
    const p = rainDropPos(k, ph, cam, 32, h);
    const visible = !(p[1] < ground(p[0], p[2]));   // the vsPrecip rule
    if (!visible) { cut++; continue; }
    drawn++;
    if (p[1] < ground(p[0], p[2])) under++;
  }
  assert.ok(cut > 100 && drawn > 100 && under === 0, `drawn ${drawn} cut ${cut} under ${under}`);
  console.log(`# hillside rain: ${drawn} drops drawn, ${cut} under the ground cut, 0 drawn under the ground`);
});
console.log(`cloudterrain: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

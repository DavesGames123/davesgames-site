// WEATHER MAP · tests/sky.test.mjs — package SKY: render/clouds.js,
// render/fields.js, shaders/clouds.wgsl, shaders/fields.wgsl. Pure helpers
// against known answers, the cloud cover calibration on held-out points
// with the real noise, isobars on synthetic and sample fields, the WGSL
// (naga plus the Tint operator rules), and both layers driven against a
// recording mock of the WebGPU device (no browser).
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  CLOUD_SHELL, CLOUD_MAP_BOUNDS, SKY_FLOATS, GP_FLOATS, cloudMapSize, fillNaN, packGridGPU, gridSlices, midCloud,
  pcg, hash3, vnoise3, lowNoise, cirrusNoise, LOW_FREQ, LOW_WARP, LOW_OCT, HIGH_SMEAR, detailErode, detailOctaves, DETAIL_F0, DETAIL_ROT, LOW_Q, HIGH_Q, LOW_SOFT, HIGH_SOFT, coverThreshold, layerDensity,
  flowPhases, packSky, createClouds,
} from '../render/clouds.js';
import {
  FIELD_SHELL, FIELD_FLOATS, LINE_FLOATS, RADAR_BOUNDS, TEMP_STOPS, TEMP_STOPS_F, RADAR_STOPS, SNOW_STOPS, UB_RAIN, UB_SNOW,
  tempColor, fToC, radarAlpha, radarColor, precipToDbz, decodeUB, decodeTileRGBA, radarPlan, mercToEquirect,
  radarPick, upsampleBicubic, marchingSquares, joinSegments, chaikin, isobarLines, isobarLabels, findCenters,
  pressureCenters, labelMarks, lineMesh, packFields, edgeDistance, createFields,
} from '../render/fields.js';
import { unpackGrid, sampleGrid } from '../data/grid.js';
import { readSampleJSON } from '../data/net.js';
import { loadFrontsSample } from '../data/fronts.js';
import { lonLatToTile } from '../data/radar.js';

const page = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, page), 'utf8');
const near = (a, b, e) => Math.abs(a - b) <= e;
const R = Math.PI / 180;
const dir = (lat, lon) => [Math.cos(lat * R) * Math.cos(lon * R), Math.sin(lat * R), -Math.cos(lat * R) * Math.sin(lon * R)];

function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

// a synthetic grid: msl = base + bowl(s); other fields flat
function synthGrid(mslFn, spec = { lat0: 20, dLat: 2.5, nLat: 15, lon0: -130, dLon: 2.5, nLon: 28 }) {
  const n = spec.nLat * spec.nLon, msl = new Float32Array(n), flat = v => [new Float32Array(n).fill(v), new Float32Array(n).fill(v)];
  for (let i = 0; i < spec.nLat; i++) for (let j = 0; j < spec.nLon; j++) msl[i * spec.nLon + j] = mslFn(spec.lat0 + i * spec.dLat, spec.lon0 + j * spec.dLon);
  return { ...spec, times: [0, 3 * 3.6e6], fields: { msl: [msl, msl], t2m: flat(10), cloud: flat(0.5), cloudLow: flat(0.3), cloudHigh: flat(0.2), precip: flat(0), snow: flat(0), u10: flat(5), v10: flat(0) } };
}

// ── mock WebGPU: records calls and checks sizes and binding sets ──
function mockGPU(problems) {
  const calls = [];
  globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
  globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  const modules = [], layouts = [];
  const entryOK = (stage, label) => {
    if (!stage) return;
    if (!new RegExp(`fn ${stage.entryPoint}\\s*\\(`).test(stage.module.code)) problems.push(`${label}: no entry ${stage.entryPoint}`);
  };
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    createShaderModule(d) { const m = { code: d.code, label: d.label }; modules.push(m); return m; },
    createBuffer(d) { return { size: d.size, label: d.label, usage: d.usage, destroyed: false, destroy() { this.destroyed = true; } }; },
    createTexture(d) {
      const t = { ...d, destroyed: false, destroy() { this.destroyed = true; } };
      t.createView = () => ({ texture: t });
      return t;
    },
    createSampler(d) { return { ...d }; },
    createBindGroupLayout(d) { const l = { entries: d.entries, label: d.label }; layouts.push(l); return l; },
    createPipelineLayout(d) { return { ...d }; },
    createBindGroup(d) {
      const want = d.layout.entries.map(e => e.binding).sort().join(','), got = d.entries.map(e => e.binding).sort().join(',');
      if (want !== got) problems.push(`${d.label}: bind group ${got} vs layout ${want}`);
      for (const e of d.entries) {
        const le = d.layout.entries.find(x => x.binding === e.binding);
        if (!le) continue;
        if (le.buffer && !(e.resource && e.resource.buffer)) problems.push(`${d.label}: binding ${e.binding} wants a buffer`);
        if ((le.texture || le.storageTexture) && !(e.resource && e.resource.texture)) problems.push(`${d.label}: binding ${e.binding} wants a texture view`);
        if (le.buffer && le.buffer.type === 'uniform' && e.resource.buffer && !(e.resource.buffer.usage & 64)) problems.push(`${d.label}: binding ${e.binding} buffer lacks UNIFORM`);
        if (le.buffer && le.buffer.type === 'read-only-storage' && e.resource.buffer && !(e.resource.buffer.usage & 128)) problems.push(`${d.label}: binding ${e.binding} buffer lacks STORAGE`);
        if (le.storageTexture && !(e.resource.texture.usage & 8)) problems.push(`${d.label}: binding ${e.binding} texture lacks STORAGE_BINDING`);
      }
      calls.push(['bindGroup', d.label]);
      return { ...d };
    },
    createComputePipelineAsync(d) { entryOK(d.compute, d.label); return Promise.resolve({ ...d }); },
    createRenderPipelineAsync(d) { entryOK(d.vertex, d.label); entryOK(d.fragment, d.label); return Promise.resolve({ ...d }); },
    queue: {
      writeBuffer(b, off, data) {
        if (off + data.byteLength > b.size) problems.push(`writeBuffer ${b.label}: ${off + data.byteLength} > ${b.size}`);
        calls.push(['writeBuffer', b.label, data.byteLength]);
      },
      writeTexture(_dst, data, layout, size) {
        const need = layout.bytesPerRow * ((size[1] || 1) - 1) + size[0] * (layout.bytesPerRow / size[0]);
        if (data.byteLength < need) problems.push(`writeTexture: ${data.byteLength} < ${need}`);
      },
      copyExternalImageToTexture() {},
    },
  };
  const pass = () => {
    const p = { list: [] };
    for (const k of ['setPipeline', 'setBindGroup', 'draw', 'drawIndexed', 'setVertexBuffer', 'setIndexBuffer', 'dispatchWorkgroups', 'end']) p[k] = (...a) => p.list.push([k, ...a]);
    return p;
  };
  return { device, calls, modules, layouts, pass };
}

function bindDecls(code) {
  const out = new Map();
  const re = /@group\(1\)\s*@binding\((\d+)\)\s*var(<[^>]*>)?\s+(\w+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(code))) {
    const ty = m[4].trim(), q = m[2] || '';
    const kind = q.includes('uniform') ? 'uniform' : q.includes('storage') ? 'read-only-storage'
      : ty.startsWith('texture_storage') ? 'storageTexture' : ty.startsWith('texture') ? 'texture' : ty.startsWith('sampler') ? 'sampler' : '?';
    out.set(+m[1], { kind, name: m[3] });
  }
  return out;
}
function layoutKind(e) {
  if (e.buffer) return e.buffer.type;
  if (e.storageTexture) return 'storageTexture';
  if (e.texture) return 'texture';
  if (e.sampler) return 'sampler';
  return '?';
}

// Tint rejects mixed && / || and mixed ^ with other arithmetic unless
// parenthesised: flag such lines.
function tintProblems(code) {
  const bad = [];
  code.split('\n').forEach((line, i) => {
    const l = line.replace(/\/\/.*$/, '');
    if (l.includes('&&') && l.includes('||')) bad.push(`${i + 1}: && with ||`);
    for (const m of l.matchAll(/\^/g)) {
      const left = l.slice(0, m.index).trimEnd(), right = l.slice(m.index + 1).trimStart();
      const lOK = left.endsWith(')') || /\b\w+$/.test(left) && !/[*+\-/]\s*\w+$/.test(left);
      const rOK = right.startsWith('(') || /^\w+\s*[);,]/.test(right);
      if (!lOK || !rOK) bad.push(`${i + 1}: ^ needs parentheses`);
    }
  });
  return bad;
}

export default async function (ok) {
  // ── clouds: pure helpers ──
  ok('sky: cloud shell radius is the contract 1.0018', CLOUD_SHELL === 1.0018);
  ok('sky: overlay shell radius is the contract 1.0022', FIELD_SHELL === 1.0022);
  const s2 = cloudMapSize(2), s0 = cloudMapSize(0);
  ok('sky: cloud map size by quality (desktop 1024 wide, phone 512, stride 3)', s2.w === 1024 && s0.w === 512 && s0.stride === 3, JSON.stringify([s2, s0]));
  const bx = CLOUD_MAP_BOUNDS;
  ok('sky: cloud map covers CONUS, Alaska south coast and Hawaii', bx.lat0 <= 18 && bx.lat1 >= 71 && bx.lon0 <= -170 && bx.lon1 >= -60);

  const holes = Float32Array.from([1, 2, 3, NaN, NaN, 6, 7, 8, 9]);
  const filled = fillNaN(holes, 3, 3);
  ok('sky: fillNaN fills holes from valid neighbours', filled.every(Number.isFinite) && near(filled[4], (2 + 6 + 8) / 3, 0.5) && filled[0] === 1, Array.from(filled).map(v => v.toFixed(2)).join(' '));
  ok('sky: fillNaN of an all-NaN field gives the fallback', fillNaN(new Float32Array(4).fill(NaN), 2, 2, 7).every(v => v === 7));
  ok('sky: midCloud inverts random overlap', near(midCloud(1 - (1 - 0.3) * (1 - 0.4) * (1 - 0.2), 0.3, 0.2), 0.4, 1e-9));
  ok('sky: midCloud clamps (total below low)', midCloud(0.1, 0.5, 0) === 0);

  const grid = unpackGrid(await readSampleJSON('grid.json'));
  const gp = packGridGPU(grid);
  const nPts = grid.nLat * grid.nLon;
  ok('sky: packGridGPU size is times x points x 8 floats', gp.data.length === grid.times.length * nPts * GP_FLOATS, `${gp.data.length}`);
  ok('sky: packGridGPU has no NaN', gp.data.every(Number.isFinite));
  const k = 3, p = 7 * grid.nLon + 11;
  ok('sky: packGridGPU slot 0 = cloud, 6 = t2m, 4 = u10',
    near(gp.data[(k * nPts + p) * 8], grid.fields.cloud[k][p], 1e-6) && near(gp.data[(k * nPts + p) * 8 + 6], grid.fields.t2m[k][p], 1e-4) && near(gp.data[(k * nPts + p) * 8 + 4], grid.fields.u10[k][p], 1e-6));
  const tm = (grid.times[2] + grid.times[3]) / 2, sl = gridSlices(grid, tm);
  ok('sky: gridSlices halfway between steps 2 and 3', sl.k0 === 2 && sl.k1 === 3 && near(sl.u, 0.5, 1e-9) && sl.off0 === 2 * nPts && sl.off1 === 3 * nPts);
  ok('sky: gridSlices clamps past the end', gridSlices(grid, grid.times.at(-1) + 1e9).u === 0);

  // ── noise mirror ──
  ok('sky: pcg is a 32-bit permutation step (known value pcg(0) = 129708002)', pcg(0) === 129708002, String(pcg(0)));
  ok('sky: hash3 differs between neighbours', hash3(1, 2, 3) !== hash3(2, 2, 3) && hash3(-1, 0, 0) !== hash3(1, 0, 0));
  let hm = 0;
  for (let i = 0; i < 4000; i++) hm += (hash3(i, -i, i * 7) >>> 8) / 16777216;
  ok('sky: hash values are uniform (mean 0.5)', near(hm / 4000, 0.5, 0.02), (hm / 4000).toFixed(3));
  ok('sky: value noise is continuous', Math.abs(vnoise3(3.5, 1.2, 9.9) - vnoise3(3.5001, 1.2, 9.9)) < 1e-3);
  ok('sky: value noise matches the lattice hash at integer points', near(vnoise3(4, 5, 6), (hash3(4, 5, 6) >>> 8) / 16777216, 1e-12));

  // cover calibration, held out: points over Asia and a different seed
  // than the measurement over North America
  const r1 = rng(987654);
  const NS = 5000, lowN = new Float64Array(NS), highN = new Float64Array(NS);
  for (let i = 0; i < NS; i++) {
    const lat = 5 + r1() * 60, lon = 60 + r1() * 100, q = dir(lat, lon);
    lowN[i] = lowNoise(...q);
    const a = r1() * 6.283, e = [-Math.sin(lon * R), 0, -Math.cos(lon * R)], nn = [-Math.sin(lat * R) * Math.cos(lon * R), Math.cos(lat * R), Math.sin(lat * R) * Math.sin(lon * R)];
    const w = e.map((x, c) => x * Math.cos(a) + nn[c] * Math.sin(a));
    highN[i] = cirrusNoise(...q, ...w);
  }
  const share = (arr, table, soft, c) => { let s = 0; for (const v of arr) s += layerDensity(table, soft, c, v); return s / arr.length; };
  const lowErr = [0.1, 0.3, 0.5, 0.7, 0.9].map(c => share(lowN, LOW_Q, LOW_SOFT, c) - c);
  const highErr = [0.1, 0.3, 0.5, 0.7, 0.9].map(c => share(highN, HIGH_Q, HIGH_SOFT, c) - c);
  ok('sky: low-cloud share matches the model cover within 0.05 (held-out region)', lowErr.every(e => Math.abs(e) <= 0.05), lowErr.map(e => e.toFixed(3)).join(' '));
  ok('sky: cirrus share matches the model cover within 0.05 (held-out region)', highErr.every(e => Math.abs(e) <= 0.05), highErr.map(e => e.toFixed(3)).join(' '));
  ok('sky: clear sky gives no cloud, overcast gives full cloud', share(lowN, LOW_Q, LOW_SOFT, 0) < 0.002 && share(lowN, LOW_Q, LOW_SOFT, 1) > 0.995);
  ok('sky: coverThreshold falls as cover rises', LOW_Q.every((v, i) => !i || v < LOW_Q[i - 1]) && HIGH_Q.every((v, i) => !i || v < HIGH_Q[i - 1]) && coverThreshold(LOW_Q, 0.25) > coverThreshold(LOW_Q, 0.75));
  // satellite look, not a blurred field: at 50 % cover most points are
  // clearly cloud or clearly clear (sharp edges), and the cloud comes in
  // many separate cells along a transect
  let mids = 0, runs = 0, prev = 0;
  for (let i = 0; i < 2000; i++) {
    const d = layerDensity(LOW_Q, LOW_SOFT, 0.5, lowNoise(...dir(38, -110 + i * 0.02)));
    if (d > 0.1 && d < 0.9) mids++;
    const c = d > 0.5 ? 1 : 0;
    if (c && !prev) runs++;
    prev = c;
  }
  ok('sky: 50 % cover has crisp edges (under 25 % of points are half-cloud)', mids / 2000 < 0.25, `${(mids / 20).toFixed(1)} %`);
  // map-scale cells are mesoscale (about 250 km); the draw pass adds the fine texture
  ok('sky: 50 % cover breaks into separate cells along 40 deg of longitude (10 or more)', runs >= 10, `${runs} cells`);

  // draw-pass detail (detailErode, mirrored in fsCloud): nothing from far
  // away, crisp edges and an opaque body close in, cirrus left thin
  ok('sky: detail adds no octaves when a pixel is bigger than the map scale', detailOctaves(1 / DETAIL_F0) === 0 && detailErode(dir(45, -120), 0.4, 0, 0.01).op === 0.4);
  ok('sky: detail octaves grow as the pixel shrinks, capped by quality', detailOctaves(2e-4) > 3 && detailOctaves(2e-4) < 4 && detailOctaves(1e-7) === 7 && detailOctaves(1e-7, 4) === 4);
  {
    // a smooth map ramp 0..1 over 0.4 deg, seen at 0.002 deg per pixel
    let mapMid = 0, detMid = 0, thick = 1, mean0 = 0, mean1 = 0;
    const foot = 0.002 * R, N = 400;
    for (let i = 0; i < N; i++) for (let j = 0; j < 20; j++) {
      const op = i / (N - 1), n = dir(40 + j * 0.05, -100 + op * 0.4), r = detailErode(n, op, 0, foot);
      if (op > 0.1 && op < 0.9) mapMid++;
      if (r.op > 0.1 && r.op < 0.9) detMid++;
      mean0 += op; mean1 += r.op;
      if (op >= 0.95) thick = Math.min(thick, r.op);
    }
    ok('sky: detail makes a smooth map edge crisp (half-cloud share at least halved)', detMid < mapMid * 0.5, `${(100 * detMid / mapMid).toFixed(1)} % of the map's`);
    ok('sky: detail keeps thick cloud opaque (op 0.95 stays above 0.9)', thick > 0.9, thick.toFixed(3));
    ok('sky: detail keeps the mean cover of an edge within 0.05 (no swelling on zoom)', Math.abs(mean1 - mean0) / (N * 20) < 0.05, ((mean1 - mean0) / (N * 20)).toFixed(3));
    let cir = 1; for (let i = 0; i < 200; i++) cir = Math.min(cir, 0.3 - Math.abs(detailErode(dir(41, -99 + i * 0.002), 0.3, 1, foot).op - 0.3));
    ok('sky: detail leaves pure cirrus thin (op 0.3 stays within 0.3 of 0.3)', cir >= 0, cir.toFixed(3));
  }
  const cwD = read('shaders/clouds.wgsl');
  ok('sky: detail constants in WGSL match the JS mirror', cwD.includes('const CL_DETAIL_F0 = 220.0;') && DETAIL_F0 === 220
    && cwD.includes(`mat3x3f(${[0, 3, 6, 1, 4, 7, 2, 5, 8].map(i => DETAIL_ROT[i].toFixed(DETAIL_ROT[i] % 1 ? 2 : 1).replace(/0$/, '').replace(/\.$/, '.0')).join(', ')})`)
    && cwD.includes('let dc = clamp((d - 0.5) * 3.2, -1.0, 1.0);') && cwD.includes('let x = op + dc * 0.85 * k * (1.0 - 0.5 * cirrus0) * edge;') && cwD.includes('let c0 = mix(mix(0.1, 0.45, k), 0.1, cirrus0);'));

  const fp = flowPhases(0), fq = flowPhases(1), fr = flowPhases(2);
  ok('sky: flow weights sum to 1', [fp, fq, fr].every(f => near(f.w1 + f.w2, 1, 1e-12)));
  ok('sky: a flow phase restarts only at zero weight', near(fp.t1, 0, 1e-12) && near(fp.w1, 0, 1e-12) && near(fr.t2, 0, 1e-12) && near(fr.w2, 0, 1e-12), JSON.stringify([fp, fr]));
  ok('sky: flowPhases works for negative hours (past steps)', near(flowPhases(-1).w1 + flowPhases(-1).w2, 1, 1e-12) && flowPhases(-1).t1 >= 0);

  const sky = packSky({ mapB: CLOUD_MAP_BOUNDS, grid, slices: sl, flowH: 5, hasGrid: true, opacity: 0.8, w: 1024, h: 528, detail: 1, alt: 0.5, quality: 2 });
  ok('sky: packSky layout (map bounds, grid, slices, size)', sky.length === SKY_FLOATS && sky[0] === 5 && sky[4] === grid.lat0 && sky[8] === grid.nLat && sky[10] === sl.off0 && sky[12] === 0.5 && sky[16] === 1024 && near(sky[19], 1 / 528, 1e-9));

  // ── WGSL ──
  const frame = read('shaders/frame.wgsl'), cw = read('shaders/clouds.wgsl'), fw = read('shaders/fields.wgsl');
  const arr = (code, name) => { const m = code.match(new RegExp(`const ${name} = array<f32, \\d+>\\(([^)]*)\\)`)); return m ? m[1].split(',').map(Number) : null; };
  ok('sky: CL_LOW_Q in clouds.wgsl equals LOW_Q', JSON.stringify(arr(cw, 'CL_LOW_Q')) === JSON.stringify(LOW_Q));
  ok('sky: CL_HIGH_Q in clouds.wgsl equals HIGH_Q', JSON.stringify(arr(cw, 'CL_HIGH_Q')) === JSON.stringify(HIGH_Q));
  ok('sky: soft edges in WGSL equal the JS values', cw.includes(`CL_LOW_SOFT = ${LOW_SOFT};`) && cw.includes(`CL_HIGH_SOFT = ${HIGH_SOFT};`));
  ok('sky: shell radii in WGSL equal the JS values', cw.includes(`CL_SHELL = ${CLOUD_SHELL};`) && fw.includes(`FD_SHELL = ${FIELD_SHELL};`));
  ok('sky: noise constants in WGSL match the JS mirror', cw.includes('let p = q * 32.0;') && cw.includes('cl_fbm(p + w * 1.6, 4)') && cw.includes('vec3f(5.2, 1.3, 8.1)') && cw.includes('* 0.012)) * 30.0, 4') && LOW_FREQ === 32 && LOW_WARP === 1.6 && LOW_OCT === 4 && HIGH_SMEAR === 0.012 && cw.includes('747796405u') && cw.includes('73856093u'));
  const vec4s = (code, st) => { const m = code.match(new RegExp(`struct ${st} \\{([\\s\\S]*?)\\n\\}`)); if (!m) return -1; let n = 0; for (const l of m[1].split('\n')) { const a = l.match(/array<vec4f, (\d+)>/); if (a) n += +a[1]; else if (/:\s*vec4f/.test(l)) n++; } return n; };
  ok('sky: struct Sky is SKY_FLOATS / 4 vec4', vec4s(cw, 'Sky') * 4 === SKY_FLOATS, String(vec4s(cw, 'Sky')));
  ok('sky: struct Fld is FIELD_FLOATS / 4 vec4', vec4s(fw, 'Fld') * 4 === FIELD_FLOATS, String(vec4s(fw, 'Fld')));
  ok('sky: no PI or fr_ helper redefined (frame.wgsl is prepended)', !/\bconst PI\b|fn fr_/.test(cw + fw));
  const tint = [...tintProblems(cw).map(s => 'clouds ' + s), ...tintProblems(fw).map(s => 'fields ' + s)];
  ok('sky: WGSL has no Tint-rejected mixed operators', !tint.length, tint.join('; '));
  ok('sky: the Tint scan catches a bad line', tintProblems('let a = b * c ^ d;\nlet e = f && g || h;').length === 2);
  const naga = join(homedir(), '.cargo/bin/naga');
  if (existsSync(naga)) {
    const dir2 = mkdtempSync(join(tmpdir(), 'wx-sky-'));
    for (const [name, code] of [['clouds', frame + '\n' + cw], ['fields', frame + '\n' + fw]]) {
      const f = join(dir2, name + '.wgsl');
      writeFileSync(f, code);
      let out = '', pass = true;
      try { out = execFileSync(naga, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { pass = false; out = String(e.stderr || e.message).slice(0, 400); }
      ok(`sky: naga accepts frame.wgsl + ${name}.wgsl`, pass, out.trim().split('\n')[0]);
    }
  } else ok('sky: naga present (skipped)', true, 'no ~/.cargo/bin/naga');

  // ── fields: palettes ──
  ok('sky: TEMP_STOPS_F ascending in °F and fits the uniform', TEMP_STOPS_F.every((s, i) => !i || s[0] > TEMP_STOPS_F[i - 1][0]) && TEMP_STOPS_F.length <= 16);
  ok('sky: TEMP_STOPS is the same palette in °C (the ui.js legend form)', TEMP_STOPS.length === TEMP_STOPS_F.length && near(TEMP_STOPS[5][0], 0, 1e-9) && TEMP_STOPS[5][1] === TEMP_STOPS_F[5][1]);
  const c32 = tempColor(fToC(32)).map(v => Math.round(v * 255));
  ok('sky: tempColor(32 °F) is the freezing blue #5cc6f2', c32.join() === '92,198,242', c32.join());
  const c75 = tempColor(fToC(75));
  ok('sky: tempColor(75 °F) lies between yellow and orange', c75[0] > 0.95 && c75[1] > 0.6 && c75[1] < 0.84 && c75[2] < 0.3);
  ok('sky: radar ramps fit the uniform (12 rain, 8 snow)', RADAR_STOPS.length <= 12 && SNOW_STOPS.length <= 8);
  ok('sky: radar alpha: none at 5 dBZ, strong at 40 dBZ', radarAlpha(5) === 0 && radarAlpha(40) > 0.85);
  ok('sky: 35 dBZ is yellow, 52 dBZ is red', radarColor(35)[0] > 0.9 && radarColor(35)[1] > 0.85 && radarColor(52)[0] > 0.75 && radarColor(52)[1] < 0.15);
  ok('sky: Marshall-Palmer: 1 mm/h = 23 dBZ, 10 mm/h = 39 dBZ', near(precipToDbz(1), 23.01, 0.01) && near(precipToDbz(10), 39.01, 0.01));

  // ── radar decode ──
  let ubMiss = 0, ubN = 0;
  const seen = new Set();
  for (const [tab, snow] of [[UB_RAIN, false], [UB_SNOW, true]]) {
    for (let i = 0; i * 8 < tab.hex.length; i++) {
      const hx = tab.hex.slice(i * 8, i * 8 + 8), dbz = Math.min(75, tab.from + i);
      if (seen.has(hx)) continue;
      seen.add(hx);
      const v = parseInt(hx, 16) >>> 0, e = decodeUB(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      ubN++;
      if (!e || e.dbz !== dbz || e.snow !== snow) ubMiss++;
    }
  }
  ok('sky: every Universal Blue colour decodes to its dBZ and type', ubMiss === 0 && ubN > 150, `${ubN} colours, ${ubMiss} wrong`);
  const d20 = decodeUB(0x00, 0xa3, 0xe0, 255), d35 = decodeUB(0xff, 0xee, 0x00, 255), dOff = decodeUB(0x01, 0xa2, 0xe1, 254);
  ok('sky: UB #00a3e0 = 20 dBZ rain, #ffee00 = 35 dBZ', d20.dbz === 20 && !d20.snow && d35.dbz === 35);
  ok('sky: a colour one step off (canvas round trip) decodes to the nearest entry', dOff && dOff.dbz === 20);
  ok('sky: transparent pixels are no echo', decodeUB(0, 0, 0, 0) === null);
  const rgba = new Uint8Array([0x00, 0xa3, 0xe0, 255, 0, 0, 0, 0, 0x5b, 0x9b, 0xff, 255, 0x63, 0x61, 0x59, 0x14]);
  const dec = decodeTileRGBA(rgba, 4, 1);
  ok('sky: decodeTileRGBA: rain 20 dBZ -> 60, none -> 0, snow flagged, drizzle below 1 dBZ dropped',
    dec[0] === 60 && dec[1] === 0 && dec[2] === 0 && dec[5] === 255 && dec[4] > 0 && dec[6] === 0, Array.from(dec).join(','));

  const pl = radarPlan(RADAR_BOUNDS, 5);
  ok('sky: radarPlan z5 covers CONUS with 7 x 5 tiles', pl.nx === 7 && pl.ny === 5 && pl.tiles.length === 35, `${pl.nx}x${pl.ny}`);
  ok('sky: radarPlan output lon range is tile-aligned and covers the box', pl.outBounds.lon0 <= RADAR_BOUNDS.lon0 && pl.outBounds.lon1 >= RADAR_BOUNDS.lon1 && near(((pl.outBounds.lon0 + 180) / 360 * 32) % 1, 0, 1e-9));
  ok('sky: radarPlan z4 (phone, tablet) is 12 tiles or fewer', radarPlan(RADAR_BOUNDS, 4).tiles.length <= 12, String(radarPlan(RADAR_BOUNDS, 4).tiles.length));
  // a mosaic whose r byte is the source row / 4 and g the source column / 8
  const src = { z: 3, x0: 1, y0: 2, w: 512, h: 512 };
  src.data = new Uint8Array(src.w * src.h * 2);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { src.data[(y * src.w + x) * 2] = y >> 2; src.data[(y * src.w + x) * 2 + 1] = x >> 3; }
  const ob = { lat0: 20, lat1: 50, lon0: -130, lon1: -50 }, eq = mercToEquirect(src, ob, 160, 60);
  const row = 30, col = 80, lat = 50 - (row + 0.5) / 60 * 30, lon = -130 + (col + 0.5) / 160 * 80;
  const tt = lonLatToTile(lon, lat, 3);
  ok('sky: mercToEquirect takes the Mercator row of each latitude', eq[(row * 160 + col) * 2] === (Math.floor((tt.y - 2) * 256) >> 2), `${eq[(row * 160 + col) * 2]} vs ${Math.floor((tt.y - 2) * 256) >> 2}`);
  ok('sky: mercToEquirect takes the column of each longitude', eq[(row * 160 + col) * 2 + 1] === (Math.floor((tt.x - 1) * 256) >> 3));

  const frames = [0, 10, 20, 30].map(m => ({ time: 1e12 + m * 60e3, path: '/p' + m }));
  const pk1 = radarPick(frames, 1e12 + 15 * 60e3), pk2 = radarPick(frames, 1e12 + 90 * 60e3), pk3 = radarPick([], 0);
  ok('sky: radarPick between frames 1 and 2 mixes half', pk1.a === 1 && pk1.b === 2 && near(pk1.u, 0.5, 1e-9) && pk1.model === 0);
  ok('sky: radarPick 1 h past the newest frame is all futurecast', pk2.a === 3 && pk2.model === 1);
  ok('sky: radarPick with no frames is futurecast only', pk3.a === -1 && pk3.model === 1);
  ok('sky: radarPick before the first frame by 1 h is futurecast', radarPick(frames, 1e12 - 60 * 60e3).model === 1);
  const gapFrames = [frames[0], { time: 1e12 + 60 * 60e3, path: '/x' }];
  const pk4 = radarPick(gapFrames, 1e12 + 10 * 60e3);
  ok('sky: radarPick holds the nearer frame over a gap', pk4.a === 0 && pk4.b === 0);

  // ── isobars ──
  const lin = Float32Array.from({ length: 12 }, (_, i) => (i % 4) * 2 + Math.floor(i / 4));
  const up = upsampleBicubic(lin, 3, 4, 4);
  ok('sky: upsampleBicubic keeps nodes and reproduces a linear field, edges too', up.nI === 9 && up.nJ === 13 && near(up.data[4 * 13 + 4], 1 * 2 + 1, 1e-5) && near(up.data[2 * 13 + 6], 1.5 * 2 + 0.5, 1e-5) && near(up.data[1 * 13 + 1], 0.25 * 2 + 0.25, 1e-5));
  const bowlN = 21, bowl = new Float32Array(bowlN * bowlN);
  for (let i = 0; i < bowlN; i++) for (let j = 0; j < bowlN; j++) bowl[i * bowlN + j] = Math.hypot(i - 10, j - 10);
  const ms = marchingSquares(bowl, bowlN, bowlN, 6.5), loops = joinSegments(ms.segs);
  const radii = loops.length ? loops[0].keys.map(kk => { const [i, j] = ms.pts.get(kk); return Math.hypot(i - 10, j - 10); }) : [];
  ok('sky: marching squares on a bowl gives one closed loop', loops.length === 1 && loops[0].closed, JSON.stringify(loops.map(l => [l.keys.length, l.closed])));
  ok('sky: loop points sit on the level (radius 6.5 within 0.1)', radii.length > 20 && radii.every(r => near(r, 6.5, 0.1)), `${Math.min(...radii).toFixed(3)}..${Math.max(...radii).toFixed(3)}`);
  const ramp = new Float32Array(bowlN * bowlN);
  for (let i = 0; i < bowlN; i++) for (let j = 0; j < bowlN; j++) ramp[i * bowlN + j] = j + 0.3 * i;
  const rl = joinSegments(marchingSquares(ramp, bowlN, bowlN, 9.5).segs);
  ok('sky: marching squares on a ramp gives one open line edge to edge', rl.length === 1 && !rl[0].closed && rl[0].keys.length >= bowlN);
  const sad = Float32Array.from([1, 0, 0, 1]);
  const sm = marchingSquares(sad, 2, 2, 0.5);
  ok('sky: a saddle cell gives two segments', sm.segs.length === 2);
  const sq = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const ch = chaikin(sq, 2, true), co = chaikin([[0, 0], [1, 0], [1, 1]], 1, false);
  ok('sky: chaikin closed quad: 16 points after two passes; open line keeps its ends', ch.length === 16 && co.length === 6 && co[0][0] === 0 && co[5][1] === 1);

  const low = synthGrid((la, lo) => 1012 - 24 * Math.exp(-(((la - 40) / 6) ** 2 + ((lo + 95) / 8) ** 2)) + 10 * Math.exp(-(((la - 33) / 5) ** 2 + ((lo + 75) / 7) ** 2)));
  const lines = isobarLines(low, 0);
  const closedNear = lines.filter(l => l.closed && l.pts.every(([la, lo]) => Math.hypot(la - 40, (lo + 95) * 0.75) < 14));
  ok('sky: isobars every 4 hPa', lines.length > 3 && lines.every(l => l.hPa % 4 === 0), [...new Set(lines.map(l => l.hPa))].join(','));
  ok('sky: closed isobars ring a deep low', closedNear.length >= 3, `${closedNear.length} rings`);
  let worst = 0;
  for (const l of lines) for (const [la, lo] of l.pts) worst = Math.max(worst, Math.abs(sampleGrid(low, 'msl', la, lo, 0) - l.hPa));
  ok('sky: isobar points lie on their pressure (within 1.5 hPa of bilinear)', worst < 1.5, worst.toFixed(3));
  const cen = findCenters(low, low.fields.msl[0]);
  const L = cen.find(c => c.type === 'L'), H = cen.find(c => c.type === 'H');
  ok('sky: findCenters finds the low at 40 N 95 W', L && near(L.lat, 40, 1.5) && near(L.lon, -95, 1.5) && near(L.hPa, 988, 1.5), JSON.stringify(L));
  ok('sky: findCenters finds the high at 33 N 75 W', H && near(H.lat, 33, 1.5) && near(H.lon, -75, 1.5), JSON.stringify(H));
  ok('sky: findCenters gives nothing for a flat field', findCenters(low, new Float32Array(15 * 28).fill(1013)).length === 0);
  const labs = isobarLabels(lines, low);
  ok('sky: isobar labels sit 2 deg inside the grid and carry the value', labs.length >= 3 && labs.every(l => edgeDistance(low, l.lat, l.lon) >= 2 && l.text === String(l.hPa)));

  const sLines = isobarLines(grid, grid.times[2]);
  const b1 = { lat1: grid.lat0 + (grid.nLat - 1) * grid.dLat, lon1: grid.lon0 + (grid.nLon - 1) * grid.dLon };
  ok('sky: sample grid gives isobars inside the grid', sLines.length >= 4 && sLines.every(l => l.pts.every(([la, lo]) => la >= grid.lat0 - 0.01 && la <= b1.lat1 + 0.01 && lo >= grid.lon0 - 0.01 && lo <= b1.lon1 + 0.01)), `${sLines.length} lines`);
  const fronts = await loadFrontsSample();
  const pc = pressureCenters(fronts, grid, fronts.analysis.valid);
  ok('sky: pressureCenters uses the WPC highs and lows when fronts are loaded', pc.length > 0 && pc.every(c => c.source === 'wpc' && (c.type === 'H' || c.type === 'L') && Number.isFinite(c.hPa)), `${pc.length} centres`);
  const pg = pressureCenters(null, grid, grid.times[2]);
  ok('sky: pressureCenters falls back to grid extrema', pg.every(c => c.source === 'grid'), `${pg.length} centres`);

  const mesh = lineMesh([{ pts: [[30, -100], [31, -99], [32, -98]], closed: false }, { pts: [[40, -90], [41, -90], [41, -89], [40, -89]], closed: true }]);
  ok('sky: lineMesh: 2 verts per point, closed lines repeat the first point', mesh.verts.length === (3 + 5) * 2 * LINE_FLOATS && mesh.count === (2 + 4) * 6);
  ok('sky: lineMesh indices stay inside the vertex buffer', Math.max(...mesh.idx) < mesh.verts.length / LINE_FLOATS);
  ok('sky: lineMesh points sit on the overlay shell', near(Math.hypot(mesh.verts[0], mesh.verts[1], mesh.verts[2]), FIELD_SHELL, 1e-6) && mesh.verts[3] === -1 && mesh.verts[LINE_FLOATS + 3] === 1);
  const fpk = packFields({ grid, slices: sl, hasGrid: true, op: { temp: 0.6 } });
  ok('sky: packFields: header, temperature stops in °C at 32, rain at 96, snow at 144',
    fpk.length === FIELD_FLOATS && near(fpk[12], 0.6, 1e-6) && near(fpk[32 + 3], fToC(-40), 1e-5) && fpk[96 + 3] === RADAR_STOPS[0][0] && fpk[144 + 3] === SNOW_STOPS[0][0] && fpk[26] === TEMP_STOPS_F.length);

  // ── layers against the mock device ──
  const problems = [];
  const { device, modules, layouts, pass } = mockGPU(problems);
  const core = {
    device, format: 'bgra8unorm', quality: 2, frameLayout: { entries: [{ binding: 0 }] }, frameGroup: { tag: 'frame' }, frameWGSL: frame,
    loadText: p => Promise.resolve(read(p)), baseUrl: page, encoderHooks: [], layers: [], cloud: null,
    LAYER_DEPTH: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    PREMUL_BLEND: { color: {}, alpha: {} },
    addLayer(l) { if (!this.layers.includes(l)) this.layers.push(l); this.layers.sort((a, b) => a.order - b.order); return l; },
    removeLayer(l) { const i = this.layers.indexOf(l); if (i >= 0) this.layers.splice(i, 1); },
    setCloudMap(v, b) { this.cloud = v ? { v, b } : null; },
  };
  const clouds = core.addLayer(await createClouds(core));
  const fields = core.addLayer(await createFields(core));
  for (const m of modules) {
    const decl = bindDecls(m.code);
    ok(`sky: ${m.label}: group(1) declarations parsed`, decl.size >= 3, [...decl.keys()].join(','));
  }
  // every layout entry matches the WGSL declaration of the same binding
  const cm = modules.find(m => m.label === 'weather clouds'), fm = modules.find(m => m.label === 'weather fields');
  const cDecl = bindDecls(cm.code), fDecl = bindDecls(fm.code);
  const kindErr = [];
  for (const l of layouts) {
    const decl = l.label.startsWith('weather clouds') ? cDecl : l.label === 'weather fields' ? fDecl : null;
    if (!decl) continue;
    for (const e of l.entries) {
      const d = decl.get(e.binding);
      if (!d || d.kind !== layoutKind(e)) kindErr.push(`${l.label} ${e.binding}: ${layoutKind(e)} vs ${d ? d.kind : 'none'}`);
    }
  }
  ok('sky: every bind group layout entry matches its WGSL declaration', layouts.length >= 3 && !kindErr.length, kindErr.join('; '));
  ok('sky: cloud compute and draw layouts use bindings 0,1,2 and 0,3,4',
    layouts.find(l => l.label === 'weather clouds compute').entries.map(e => e.binding).join() === '0,1,2' && layouts.find(l => l.label === 'weather clouds draw').entries.map(e => e.binding).join() === '0,3,4');
  ok('sky: createFields adds the temperature layer under the clouds', core.layers.map(l => l.name).join(',') === 'fields-temp,clouds,fields', core.layers.map(l => l.name).join(','));
  ok('sky: clouds hook registered for the compute pass', core.encoderHooks.length === 1);

  const cam = { lat: 38, lon: -97, alt: 0.9, tilt: 0.3, heading: 0 };
  const fr0 = { cam, t: grid.times[2], time: 12, quality: 2 };
  const app = { t: grid.times[2] };
  clouds.update(fr0, app);
  ok('sky: no cloud map on the globe before a grid', core.cloud === null);
  clouds.setGrid(grid); fields.setGrid(grid);
  fields.setRadar({ frames: [], host: 'https://tilecache.rainviewer.com', live: false });
  fields.setFronts(fronts);
  fields.set({ isobars: true, wind: true });
  clouds.update(fr0, app);
  for (const l of core.layers) if (l.name !== 'clouds') l.update(fr0, app);
  ok('sky: setGrid gives the cloud map and its bounds to the globe', core.cloud && core.cloud.v.texture.format === 'rgba16float' && core.cloud.b.lat1 === CLOUD_MAP_BOUNDS.lat1);
  const enc = { list: [], beginComputePass() { const p2 = pass(); this.list.push(p2); return p2; } };
  core.encoderHooks[0](enc, fr0);
  const disp = enc.list[0] && enc.list[0].list.find(c => c[0] === 'dispatchWorkgroups');
  ok('sky: compute pass dispatches the map in 8 x 8 groups', disp && disp[1] === 128 && disp[2] === 66, JSON.stringify(disp));
  const rp = pass();
  for (const l of core.layers) { rp.setBindGroup(0, core.frameGroup); l.encode(rp, fr0); }
  const draws = rp.list.filter(c => c[0] === 'draw' || c[0] === 'drawIndexed');
  const pipes = rp.list.filter(c => c[0] === 'setPipeline').map(c => c[1].label);
  ok('sky: one frame draws temperature, clouds, futurecast radar, wind and isobars in that order',
    pipes.join('|') === 'weather fields fsTemp|weather clouds draw|weather fields fsRadar|weather fields fsWind|weather isobars', pipes.join('|'));
  ok('sky: isobars draw as indexed strips', draws.some(d => d[0] === 'drawIndexed' && d[1] > 100), JSON.stringify(draws.at(-1)));
  const labels = fields.labels();
  ok('sky: labels(): isobar values and WPC H / L centres as data', labels.isobars.length > 0 && labels.centers.length > 0 && labels.centers.every(c => c.source === 'wpc'), `${labels.isobars.length} values, ${labels.centers.length} centres`);
  const mk = labelMarks({ isobars: [{ lat: 40, lon: -90, hPa: 1012, text: '1012' }], centers: [{ type: 'L', lat: 41, lon: -91, hPa: 998, source: 'grid' }, { type: 'H', lat: 30, lon: -80, hPa: 1030, source: 'wpc' }] });
  ok('sky: labelMarks: isobar values plus grid H / L only (labels.js draws WPC centres)', mk.length === 2 && mk[0].kind === 'iso' && mk[1].kind === 'L' && mk[1].text === '998');
  ok('sky: marks() lists the isobar values for labels.js', fields.marks().length === labels.isobars.length && fields.marks().every(m => m.kind === 'iso'));
  ok('sky: radarState reports futurecast when there are no frames', fields.radarState().model === 1 && fields.radarState().frames === 0);
  clouds.set({ visible: false });
  clouds.update({ ...fr0, time: 13 }, app);
  ok('sky: hiding the clouds removes the map from the globe', core.cloud === null);
  const enc2 = { list: [], beginComputePass() { const p2 = pass(); this.list.push(p2); return p2; } };
  core.encoderHooks[0](enc2, fr0);
  ok('sky: hidden clouds run no compute pass', enc2.list.length === 0);
  fields.destroy(); clouds.destroy();
  ok('sky: destroy removes both field layers, the clouds and the hook', core.layers.length === 0 && core.encoderHooks.length === 0);
  ok('sky: mock device saw no size, binding or entry point problems', !problems.length, problems.slice(0, 4).join('; '));
}

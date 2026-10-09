// view3d/tests.mjs - node tests for the 3D cone-beam view.
// Run: node stella-nova/pages/ct-lab/view3d/tests.mjs [pngDir]
// Checks the DOM-free maths, the meshes, the WGSL (naga, Tint traps) and the module
// imports. When deno exists, it also runs render-deno.mjs (WebGPU renders and FDK check).
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './scene.js';
import * as WG from './wgsl.js';
import * as V from './index.js';
import { sliceOf } from './fallback.js';

const here = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (c, n, i = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${i ? '  ' + i : ''}`); };

// mat4: inverse and unproject round trip
{
  const M = S.cameraMatrices({ yaw: 0.7, pitch: 0.3, dist: 9, fov: 0.6, offset: [0.1, -0.05] }, 1.6);
  const I = S.mat4Mul(M.viewProj, M.invViewProj);
  let e = 0; for (let k = 0; k < 16; k++) e = Math.max(e, Math.abs(I[k] - (k % 5 === 0 ? 1 : 0)));
  ok(e < 1e-4, 'viewProj * inverse = identity', `max err ${e.toExponential(2)}`);
  const p = [0.2, -0.1, 0.3], s = S.projectPoint(M.viewProj, p), r = S.unproject(M.invViewProj, s[0], s[1]);
  const v = p.map((x, k) => x - r.o[k]), t = v[0] * r.d[0] + v[1] * r.d[1] + v[2] * r.d[2];
  const miss = Math.hypot(...v.map((x, k) => x - t * r.d[k]));
  ok(miss < 1e-4, 'unproject(project(p)) passes through p', `miss ${miss.toExponential(2)}`);
}

// ray-box and slice picking
{
  const half = [0.5, 0.5, 0.5];
  const h = S.rayBox([0, 0, 5], [0, 0, -1], half);
  ok(h && Math.abs(h[0] - 4.5) < 1e-9 && Math.abs(h[1] - 5.5) < 1e-9, 'rayBox enters at 4.5, leaves at 5.5');
  ok(S.rayBox([2, 0, 5], [0, 0, -1], half) === null, 'rayBox misses a ray outside the box');
  const hit = S.pickSlice([0.1, 0.1, 5], [0, 0, -1], half, { x: 0.5, y: 0.5, z: 0.5 });
  ok(hit && hit.axis === 2 && Math.abs(hit.t - 5) < 1e-9, 'pickSlice finds the z plane head-on');
  const hy = S.pickSlice([0.1, 5, 0.1], [0, -1, 0], half, { x: 0.5, y: 0.25, z: 0.5 });
  ok(hy && hy.axis === 1 && Math.abs(hy.t - 4.75) < 1e-9, 'pickSlice: y fraction 0.25 sits at y = +0.25 (canvas order)');
}

// half floats
{
  const vals = Float32Array.from([0, 1, -2.5, 0.1937, 0.5, 1e-5, 65504, 1e6, 3.14159]);
  const h = S.toHalf(vals);
  let e = 0;
  for (let i = 0; i < 7; i++) { const d = Math.abs(S.halfToFloat(h[i]) - vals[i]) / Math.max(Math.abs(vals[i]), 1e-3); e = Math.max(e, d); }
  ok(e < 1e-3, 'toHalf round trip within 0.1%', `max rel err ${e.toExponential(2)}`);
  ok(S.halfToFloat(h[7]) === 65504, 'toHalf clamps large values to 65504');
}

// smoothing keeps the mean and removes steps
{
  const n = 16, data = new Float32Array(n * n * n);
  for (let i = 0; i < data.length; i++) data[i] = (i % n) < 8 ? 1 : 0;
  const sm = S.smooth3({ nx: n, ny: n, nz: n, width: 2, data });
  let a = 0, b = 0; for (let i = 0; i < data.length; i++) { a += data[i]; b += sm.data[i]; }
  ok(Math.abs(a - b) / a < 1e-6, 'smooth3 keeps the sum', `${a} vs ${b.toFixed(3)}`);
  ok(Math.abs(sm.data[7] - 0.75) < 1e-6 && Math.abs(sm.data[8] - 0.25) < 1e-6, 'smooth3 softens a step to 0.75 / 0.25');
}

// transfer function LUT
{
  const cm = new Uint8Array(1024).fill(200);
  for (const [k, p] of Object.entries(S.TF_PRESETS)) {
    const lut = S.buildLut(p, cm);
    const aAir = lut[3], aSoft = lut[Math.round((p.soft[0] + p.soft[1]) / 2 * 255) * 4 + 3], aBone = lut[255 * 4 + 3];
    ok(lut.length === 2048 && aAir === 0 && aSoft > 0 && aSoft < 20 && aBone > 180, `TF ${k}: air clear, soft translucent, bone opaque`, `alpha ${aAir}/${aSoft}/${aBone}`);
  }
}

// meshes and lines
{
  const geom = { nu: 137, nv: 167, du: 0.576, dv: 0.578, sod: 33.9, sdd: 67.9, nAngles: 180 };
  const L = S.gantryLayout(geom, 24, 1);
  ok(L.rIn > Math.hypot(L.detDist, L.hu) && L.rIn > L.sod, 'gantry bore clears the source and the detector corners', `rIn ${L.rIn.toFixed(2)}`);
  const m = S.buildMeshes(L), g = S.buildGlass(L);
  ok(m.length % S.VERT_FLOATS === 0 && (m.length / S.VERT_FLOATS) % 3 === 0, 'mesh is whole triangles', `${m.length / S.VERT_FLOATS} vertices`);
  ok(g.length / S.VERT_FLOATS === 12, 'glass cone has 4 triangles');
  const none = S.buildMeshes(L, { gantry: false, table: false, detector: false });
  ok(none.length === 0, 'meshes can be empty (view3d skips the write)');
  const lines = [...S.staticLines(L), ...S.coneLines(L), ...S.sampleRays(L, 13, () => 0.5)];
  ok(lines.length % S.LINE_FLOATS === 0, 'line data is whole segments', `${lines.length / S.LINE_FLOATS} segments`);
}

// fallback slices: orientation
{
  const n = 8, data = new Float32Array(n * n * n);
  data[(7 * n + 0) * n + 0] = 1; // iz = 7 (top z), iy = 0 (top y), ix = 0
  const vol = { nx: n, ny: n, nz: n, width: 2, data };
  ok(sliceOf(vol, 'z', 1).data[0] === 1, 'axial slice at the top z holds the voxel');
  ok(sliceOf(vol, 'y', 0).data[0] === 1, 'coronal slice puts high z on the top row');
  ok(sliceOf(vol, 'mip').data[0] === 1, 'MIP keeps the voxel');
}

// WGSL: Tint traps and naga
{
  const srcs = { BG: WG.BG_WGSL, MESH: WG.MESH_WGSL, LINE: WG.LINE_WGSL, VOLUME: WG.VOLUME_WGSL };
  let traps = [];
  for (const [k, src] of Object.entries(srcs)) {
    for (const line of src.split('\n')) {
      // a bare "a && b || c" or "a || b && c" at one nesting level
      const flat = line.replace(/\([^()]*\)/g, 'X').replace(/\([^()]*\)/g, 'X');
      if (/&&/.test(flat) && /\|\|/.test(flat)) traps.push(`${k}: ${line.trim()}`);
    }
  }
  ok(traps.length === 0, 'no unparenthesized mixed && / ||', traps.join(' | '));
  ok(WG.FRAME_BYTES === 320 && (WG.FRAME.match(/vec4<f32>,/g) || []).length === 8, 'Frame uniform is 3 mat4 + 8 vec4 = 320 bytes');
  const naga = [join(homedir(), '.cargo/bin/naga'), '/opt/homebrew/bin/naga'].find((p) => existsSync(p));
  if (!naga) console.log('skip: naga not found');
  else {
    const dir = mkdtempSync(join(tmpdir(), 'view3d-wgsl-'));
    for (const [k, src] of Object.entries(srcs)) {
      const f = join(dir, `${k}.wgsl`); writeFileSync(f, src);
      const r = spawnSync(naga, [f], { encoding: 'utf8' });
      ok(r.status === 0, `naga validates ${k}`, (r.stdout + r.stderr).trim().split('\n').pop());
    }
  }
}

ok(typeof V.createView3D === 'function' && V.MODES.join() === 'mip,dvr,iso,slices', 'index exports createView3D and MODES');
let threw = false; try { V.createView3D(null, null); } catch { threw = true; }
ok(threw, 'createView3D throws without a device');

// Deno WebGPU render check
let deno = null;
try { deno = execFileSync('which', ['deno'], { encoding: 'utf8' }).trim(); } catch { /* no deno */ }
if (!deno) console.log('skip: deno not found (render-deno.mjs not run)');
else {
  const r = spawnSync(deno, ['run', '-A', join(here, 'render-deno.mjs'), ...(process.argv[2] ? [process.argv[2]] : [])], { encoding: 'utf8', cwd: here });
  process.stdout.write(r.stdout);
  if (r.status !== 0) { fails++; console.log('FAIL render-deno.mjs exit ' + r.status + '\n' + r.stderr.slice(-800)); }
  fails += (r.stdout.match(/^FAIL/gm) || []).length;
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);

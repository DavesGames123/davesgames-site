// tests/surface.test.mjs — GROUND surface fields (render/surface-sim.js),
// node, no GPU, no browser.
// Run alone: node stella-nova/pages/dla-terrain/tests/surface.test.mjs
//
// What it checks: the fields are deterministic per seed (a LIB terrain),
// scree settles below cliffs and not on them, the drainage lines of the
// shader twin follow the flow, dunes lie across the prevailing wind with
// the slip face downwind, snow prefers low slopes, shade and the lee, the
// D8 code fits in a byte, the WGSL twins use the same constants, and naga
// passes on the joined ground shader.

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  simulateSurface, packSurface, surfRes, windOf, dune, snowAmount, drainLine, cellJitter, DXS, DZS,
  rockFrame, jointFrame, strataParams,
} from '../render/surface-sim.js';
import { generateTerrain, PRESETS } from '../../../lib/dla-terrain.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} surface: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} surface: ${name} ${extra}`); }
}

// a synthetic Terrain: height h(x, z) on an n grid, D8 flow accumulation
function synth(n, ws, hf, opts = {}) {
  const N = n * n, tx = ws / n, o = -ws / 2;
  const height = new Float32Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) height[j * n + i] = hf(o + (i + 0.5) * tx, o + (j + 0.5) * tx);
  // D8 accumulation (km2), high to low
  const ord = [...height.keys()].sort((a, b) => height[b] - height[a]);
  const acc = new Float32Array(N).fill((tx / 1000) ** 2);
  for (const i of ord) {
    const x = i % n, z = (i / n) | 0;
    let best = 0, r = -1;
    for (let k = 0; k < 8; k++) {
      const xx = x + DXS[k], zz = z + DZS[k];
      if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
      const s = (height[i] - height[zz * n + xx]) / (k < 4 ? 1 : Math.SQRT2);
      if (s > best) { best = s; r = zz * n + xx; }
    }
    if (r >= 0) acc[r] += acc[i];
  }
  return {
    n, worldSize: ws, seaLevel: -1000, height, flow: acc,
    sediment: new Float32Array(N), water: new Float32Array(N), river: new Float32Array(N),
    moisture: new Float32Array(N).fill(0.5), temperature: new Float32Array(N).fill(-2),
    opts: { seed: 3, talus: 36, windAngle: 0, heightScale: 1000, ...opts },
  };
}

// ---- determinism per seed on a LIB terrain
{
  const opts = { ...PRESETS.alpine.opts, n: 256, seed: 7 };
  const t = await generateTerrain(opts);
  const a = await simulateSurface(t);
  const b = await simulateSurface(t);
  let same = a.data.length === b.data.length;
  for (let i = 0; same && i < a.data.length; i++) if (a.data[i] !== b.data[i]) same = false;
  ok(same && a.m === 256, `fields are byte equal on two runs (alpine n 256, ${a.data.length} bytes)`, JSON.stringify(a.stats));
  const t2 = await generateTerrain({ ...opts, seed: 8 });
  const c = await simulateSurface(t2);
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== c.data[i]) diff++;
  ok(diff > a.data.length * 0.2, `another seed gives other fields (${(100 * diff / a.data.length).toFixed(0)}% bytes differ)`);
  ok(a.stats.bedrock > 0.05 && a.stats.scree > 0.002, `alpine has bare bedrock and scree (${(a.stats.bedrock * 100).toFixed(1)}%, ${(a.stats.scree * 100).toFixed(1)}%)`);
  const big = { n: 2048 };
  ok(surfRes(big.n, 1) === 1024 && surfRes(big.n, 0.25) === 512 && surfRes(256, 1) === 256 && surfRes(2048, 1, true) === 512, 'surfRes caps the field grid at 1024 (512 on Low and phones)');
}

// ---- scree sits below cliffs: a plateau, a cliff, then a gentle foot slope
{
  const ws = 4000, n = 200;
  // along x: plateau at 600 m for x < -200, cliff (slope ~2.5) down to 100 m,
  // then a 0.12 slope down to the right
  const prof = (x) => (x < -200 ? 600 : x < 0 ? 600 - (x + 200) * 2.5 : 100 - x * 0.12);
  const t = synth(n, ws, (x, z) => prof(x) + 3 * Math.sin(z / 37));
  const s = await simulateSurface(t);
  const f = s.fields, m = s.m, tx = ws / m;
  let top = 0, cliff = 0, foot = 0, far = 0, nt = 0, nc = 0, nf = 0, nr = 0;
  for (let j = 10; j < m - 10; j++) for (let i = 0; i < m; i++) {
    const x = -ws / 2 + (i + 0.5) * tx, v = f.scree[j * m + i];
    if (x < -300) { top += v; nt++; }
    else if (x > -180 && x < -20) { cliff += v; nc++; }
    else if (x > 10 && x < 250) { foot += v; nf++; }
    else if (x > 900) { far += v; nr++; }
  }
  top /= nt; cliff /= nc; foot /= nf; far /= nr;
  ok(foot > 0.2 && foot > 4 * cliff && foot > 10 * top && foot > 4 * far,
    `scree below the cliff: foot ${foot.toFixed(3)}, cliff ${cliff.toFixed(3)}, plateau ${top.toFixed(3)}, far plain ${far.toFixed(3)}`);
  // and the regolith: bare on the cliff, soil on the plateau
  let rc = 0, rt = 0;
  for (let j = 10; j < m - 10; j++) for (let i = 0; i < m; i++) {
    const x = -ws / 2 + (i + 0.5) * tx;
    if (x > -180 && x < -20) rc += f.regolith[j * m + i] / ((m - 20) * 1);
    if (x < -400) rt += f.regolith[j * m + i];
  }
  ok(rc / 32 < 0.1, `the cliff is bare bedrock (mean regolith ${(rc / 32).toFixed(3)})`);
}

// ---- drainage lines follow the flow: a tilted, wavy valley side
{
  const ws = 3000, n = 128;
  const hf = (x, z) => 800 - 0.25 * z + 25 * Math.sin(x / 90) + 6 * Math.sin((x + 2 * z) / 41);
  const t = synth(n, ws, hf);
  const s = await simulateSurface(t);
  const m = s.m, L3 = 3 * m * m * 4;
  const get = (i, j) => (i < 0 || j < 0 || i >= m || j >= m ? null
    : { dir: Math.round(s.data[L3 + (j * m + i) * 4] / 28), chan: s.data[L3 + (j * m + i) * 4 + 1] / 255 });
  let seed = 99, good = 0, tot = 0, cosSum = 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const tx = ws / m;
  for (let k = 0; k < 6000; k++) {
    const px = 5 + rnd() * (m - 10), pz = 5 + rnd() * (m - 10);
    const L = drainLine(px, pz, get, 0.12);
    if (L.d > 0.15) continue;
    const x = -ws / 2 + px * tx, z = -ws / 2 + pz * tx, e = 2;
    const gx = (hf(x + e, z) - hf(x - e, z)) / (2 * e), gz = (hf(x, z + e) - hf(x, z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    tot++;
    const cs = (-(L.tx * gx) - (L.tz * gz)) / g;
    cosSum += cs;
    if (cs > 0.5) good++;
  }
  // D8 directions are 45 deg steps and the line ends are jittered, so a
  // line can be up to ~40 deg off the true fall line
  ok(tot > 200 && good / tot > 0.8 && cosSum / tot > 0.7, `drainage lines run downhill (${good} of ${tot} line points within 60 deg of the fall line, mean cos ${(cosSum / Math.max(tot, 1)).toFixed(2)})`);
  // the D8 code: none = 8 packs to 224 (fits a byte), the shader decodes round(r / 28)
  const f = { regolith: [0], scree: [0], alluvium: [0], wet: [0], drift: [0], cornice: [0], age: [0], playa: [0], strata: [0], glacial: [0], iceDir: [0], scar: [0], dir: [8], logA: [0], coarse: [0], erosion: [0] };
  const pk = packSurface(f, 1);
  ok(pk[12] === 224 && Math.round(pk[12] / 28) === 8, 'D8 code 8 (no receiver) packs to 224 and decodes to 8');
}

// ---- dunes across the prevailing wind, slip face downwind
{
  const wd = windOf({ windAngle: 30 }), ac = [-wd[1], wd[0]];
  let along = 0, across = 0, up = 0, down = 0;
  for (let k = 0; k < 4000; k++) {
    const x = (k % 63) * 13.1, z = Math.floor(k / 63) * 17.3;
    const [, gx, gz] = dune(x, z, wd, 160);
    const a = gx * wd[0] + gz * wd[1], c = gx * ac[0] + gz * ac[1];
    along += Math.abs(a); across += Math.abs(c);
    up = Math.max(up, a); down = Math.max(down, -a);
  }
  ok(along > 3 * across, `dune slopes lie along the wind (|along| / |across| = ${(along / across).toFixed(1)})`);
  ok(down > 2 * up, `the slip face is downwind and steeper (max lee ${down.toFixed(2)}, max stoss ${up.toFixed(2)})`);
  // gradient matches finite differences
  const e = 0.01, [h0, gx0, gz0] = dune(37, 91, wd, 160);
  const fx = (dune(37 + e, 91, wd, 160)[0] - dune(37 - e, 91, wd, 160)[0]) / (2 * e);
  ok(Math.abs(fx - gx0) < 1e-3 && h0 >= 0, 'dune gradient equals its finite difference');
}

// ---- snow prefers low slope, shade and the lee
{
  const line = 2500, y = 2480;
  const flat = snowAmount(y, line, 0.1, 0, 0.5), steep = snowAmount(y, line, 0.45, 0, 0.5);
  const shaded = snowAmount(y, line, 0.1, 1, 0.5), sunny = snowAmount(y, line, 0.1, -1, 0.5);
  const lee = snowAmount(y, line, 0.1, 0, 0.9), scoured = snowAmount(y, line, 0.1, 0, 0.1);
  ok(flat > steep * 2 && snowAmount(y, line, 0.6, 1, 1) === 0, `snow: low slope ${flat.toFixed(2)} > steep ${steep.toFixed(2)}, none on cliffs`);
  ok(shaded > sunny + 0.3, `snow: shaded face ${shaded.toFixed(2)} > sunny face ${sunny.toFixed(2)}`);
  ok(lee > scoured + 0.3, `snow: lee ${lee.toFixed(2)} > scoured ${scoured.toFixed(2)}`);
  // the drift field: a ridge across a wind toward +x; the lee (+x) side gets drift
  const ws = 3000, n = 120;
  const t = synth(n, ws, (x) => 1500 - Math.abs(x) * 0.6, { windAngle: 0 });
  const s = await simulateSurface(t);
  const m = s.m, tx = ws / m;
  let wW = 0, wL = 0, cW = 0, cL = 0;
  for (let j = 10; j < m - 10; j++) for (let i = 0; i < m; i++) {
    const x = -ws / 2 + (i + 0.5) * tx;
    if (x < -40 && x > -250) { wW += s.fields.drift[j * m + i]; cW++; }
    if (x > 40 && x < 250) { wL += s.fields.drift[j * m + i]; cL++; }
  }
  ok(wL / cL > wW / cW + 0.15, `drift: lee side ${(wL / cL).toFixed(2)} > windward side ${(wW / cW).toFixed(2)}`);
}

// ---- the joint frame follows the strata (ground.wgsl fn rockSet)
{
  const m = 96, ws = 12000;
  const sp = strataParams({ heightScale: 1300, strataLayers: 9, strata: 0.85 });
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let worst = 0, worstOrth = 0;
  for (const deg of [0, 37, 90, 151, 222, 300]) {
    // a tilted warp field: the beds dip toward the warp gradient (deg)
    const a = deg * Math.PI / 180, st = new Float32Array(m * m);
    for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) st[z * m + x] = 0.5 + 0.0012 * (x * Math.cos(a) + z * Math.sin(a)) + 0.0002 * Math.sin(x * 0.7 + z * 1.3);
    const f = rockFrame(st, m, ws, sp, 1);
    worst = Math.max(worst, Math.acos(Math.min(1, f.dir[0] * Math.cos(a) + f.dir[1] * Math.sin(a))) * 180 / Math.PI);
    // the bedding normal of that dip, and the three set normals
    const k = 6 / ((sp[2] * 2) / sp[1]), g = 0.0012 * k / (ws / m);
    const nb = [g * Math.cos(a), 1, g * Math.sin(a)], l = Math.hypot(...nb);
    const j = jointFrame(nb.map((v) => v / l), f.dir);
    worstOrth = Math.max(worstOrth, Math.abs(dot3(j.j0, j.j1)), Math.abs(dot3(j.j0, j.j2)), Math.abs(dot3(j.j1, j.j2)));
  }
  ok(worst < 1.0, `rockFrame: set 1 follows the dip direction of the strata (worst ${worst.toFixed(2)} deg over 6 azimuths)`);
  ok(worstOrth < 1e-6, `jointFrame: bedding, dip and strike joints are orthogonal (worst |cos| ${worstOrth.toExponential(1)})`);
  const flat = rockFrame(new Float32Array(m * m).fill(0.5), m, ws, sp, 7);
  ok(Math.abs(Math.hypot(...flat.dir) - 1) < 1e-6 && flat.dip === 0, 'rockFrame: flat strata give a unit seed direction and no dip');
  const thin = rockFrame(new Float32Array(m * m).fill(0.5), m, ws, strataParams({ strata: 0 }), 7);
  ok(thin.H0 < flat.H0 && thin.stepK < flat.stepK, 'rockFrame: strongly bedded rock has thicker beds and stronger stairs than massive rock');
  const lib = await generateTerrain({ ...PRESETS.canyonlands.opts, n: 64, seed: 3 });
  const s = await simulateSurface(lib, { res: 64 });
  ok(s.rock && Math.abs(Math.hypot(...s.rock.dir) - 1) < 1e-6 && s.rock.dip >= 0 && s.rock.dip < 10, `simulateSurface returns the joint frame (canyonlands: dip ${s.rock.dip.toFixed(2)} deg)`);
}

// ---- WGSL twins and naga
{
  const src = readFileSync(fileURLToPath(new URL('../shaders/ground.wgsl', import.meta.url)), 'utf8');
  ok(/73856093u/.test(src) && /19349663u/.test(src) && /0x2c1b3c6du/.test(src) && /0x297a2d39u/.test(src), 'fn cellJit uses the hash constants of cellJitter');
  const j = cellJitter(-3, 17);
  ok(Math.abs(j[0]) <= 0.25 && Math.abs(j[1]) <= 0.25, 'cellJitter stays within a quarter cell');
  ok(/smoothstep\(line - 160\.0, line \+ 80\.0/.test(src) && /\(drift - 0\.5\) \* 260\.0/.test(src) && /smoothstep\(0\.30, 0\.52, slope\)/.test(src), 'fn snowAmount has the constants of snowAmount');
  ok(/let c = 0\.72;/.test(src) && /0\.07 \* lam/.test(src), 'fn dune has the constants of dune');
  const naga = join(homedir(), '.cargo/bin/naga');
  if (existsSync(naga)) {
    const dir = join(fileURLToPath(new URL('..', import.meta.url)));
    const libDetail = join(dir, '../../lib/dla-terrain-detail.wgsl');
    const joined = readFileSync(join(dir, 'shaders/common.wgsl'), 'utf8') + '\n' + readFileSync(existsSync(libDetail) ? libDetail : join(dir, 'gpu/detail-stub.wgsl'), 'utf8') + '\n' + src;
    const p = join(mkdtempSync(join(tmpdir(), 'surface-wgsl-')), 'ground.wgsl');
    writeFileSync(p, joined);
    const r = spawnSync(naga, [p], { encoding: 'utf8' });
    ok(r.status === 0, 'naga: common + detail + ground.wgsl', ((r.stdout || '') + (r.stderr || '')).split('\n').slice(0, 4).join(' '));
  } else ok(true, 'naga not installed (skipped)');
}

console.log(`# surface: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
export default { pass, fail };

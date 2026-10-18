// ============================================================================
//  tools/marine-snow-check.mjs — node checks of lib/marine-snow.{js,wgsl}
// ----------------------------------------------------------------------------
//  Usage:  node tools/marine-snow-check.mjs
//
//  No browser. The checks:
//    glsl ....... the three.js program (marineSnowVS, MARINE_SNOW_FS)
//                 compiles as GLSL ES 3.00 with the three.js r160 prefix
//                 (glslangValidator) and as GLSL 450 (naga, through
//                 pages/coral-reef/glsl-check.mjs)
//    wgsl ....... naga validates lib/marine-snow.wgsl and its light swap;
//                 no bitwise operators, no && with || on one line (Chrome
//                 Tint rejects mixed operators without parentheses); the
//                 struct MsU has the layout of packSnowUniforms
//    atlas ...... the same seed gives the same bytes; another seed gives
//                 others; the mips keep the mean; the shapes are not
//                 radially symmetric Gaussians (anisotropy, sectors,
//                 radial residual), and a Gaussian control fails the test
//    phase ...... each Henyey-Greenstein lobe integrates to 1 over the
//                 sphere; forward > back > side; the cap holds
//    lens ....... no blur at the focus, more blur near; the light of a
//                 flake is the same before and after the blur (energy)
//    place ...... flakes stay in the world while the camera moves and the
//                 floating origin jumps; a flake wraps only where it is
//                 faded out (no pops); the near box too
//    budgets .... fewer flakes, smaller atlas and discs on phones
//    mix ........ density and floc share grow with depth; green motes in
//                 the shallows
//    three ...... createMarineSnow with the vendored three r160: every
//                 shader uniform exists, the density sets instanceCount,
//                 the streak matrix follows an origin jump
//    gpu ........ createMarineSnowGPU on a stub device: buffer sizes, the
//                 uniform pack, draw(6, n)
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'stella-nova/lib');
const M = await import(path.join(LIB, 'marine-snow.js'));
const G = await import(path.join(LIB, 'marine-snow-gpu.js'));
const THREE = await import(path.join(ROOT, 'stella-nova/vendor/three@0.160.0/build/three.module.js'));

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); }
  else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); }
}
const f3 = v => (+v).toFixed(3);

// ── glsl ────────────────────────────────────────────────────────────────────
{
  const GV = ['/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].find(p => fs.existsSync(p));
  const VP = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nuniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nin vec3 position;\nin vec3 normal;\nin vec2 uv;\n';
  const FP = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\n';
  if (!GV) ok(false, 'glsl: glslangValidator not found');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-glsl-'));
    for (const [stage, src] of [['vert', VP + M.marineSnowVS()], ['frag', FP + M.MARINE_SNOW_FS]]) {
      const f = path.join(dir, 'snow.' + stage);
      fs.writeFileSync(f, src);
      let good = true, log = '';
      try { execFileSync(GV, [f], { encoding: 'utf8' }); } catch (e) { good = false; log = String(e.stdout || '') + String(e.stderr || ''); }
      ok(good, `glsl: snow.${stage} compiles as GLSL ES 3.00 with the three.js prefix`, log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 3).join(' | '));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const { checkPrograms } = await import(path.join(ROOT, 'stella-nova/pages/coral-reef/glsl-check.mjs'));
  const r = checkPrograms([{ name: 'marine-snow', vs: M.marineSnowVS(), fs: M.MARINE_SNOW_FS }])[0];
  if (r.ok === null) console.log('glsl: naga not found, the naga check did not run');
  else ok(r.ok, 'glsl: marine snow passes naga as GLSL 450', r.log);
  const src = M.marineSnowVS() + M.MARINE_SNOW_FS;
  ok(!/smoothstep\(\s*([\w.]+)\s*,\s*\1\s*\*\s*0\./.test(src), 'glsl: smoothstep edges in order (low < high)');
}

// ── wgsl ────────────────────────────────────────────────────────────────────
{
  const NAGA = [path.join(os.homedir(), '.cargo/bin/naga'), '/opt/homebrew/bin/naga'].find(p => fs.existsSync(p));
  const code = fs.readFileSync(path.join(LIB, 'marine-snow.wgsl'), 'utf8');
  const swapped = G.snowWGSL(code, 'fn msLight(p: vec3f, V: vec3f) -> vec3f { return vec3f(msPhase(dot(vec3f(0.0, -1.0, 0.0), V))) * U.sunC.rgb; }');
  ok(swapped !== code && swapped.includes('U.sunC.rgb; }') && !swapped.includes('for (var i = 0; i < 4; i++)'), 'wgsl: snowWGSL swaps the light function');
  if (!NAGA) console.log('wgsl: naga not found, the WGSL check did not run');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-wgsl-'));
    for (const [name, text] of [['marine-snow', code], ['marine-snow-swapped', swapped]]) {
      const f = path.join(dir, name + '.wgsl');
      fs.writeFileSync(f, text);
      let good = true, log = '';
      try { execFileSync(NAGA, [f], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { good = false; log = String(e.stderr || e.stdout || '').split('\n').slice(0, 8).join(' | '); }
      ok(good, `wgsl: ${name} passes naga`, log);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const body = code.split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\/\/.*$/, ''));
  ok(!body.some(l => /[^&]&[^&]|\^|[^|]\|[^|]|<<|>>/.test(l)), 'wgsl: no bitwise operators');
  ok(!body.some(l => /&&/.test(l) && /\|\|/.test(l)), 'wgsl: no && and || on one line');
  // the layout: MsU field order and sizes = packSnowUniforms
  const struct = code.slice(code.indexOf('struct MsU {'), code.indexOf('};', code.indexOf('struct MsU {')));
  const fields = [...struct.matchAll(/^\s*(\w+):\s*(array<[^>]+>|\w+),/gm)].map(m => [m[1], m[2].trim()]);
  const size = fields.reduce((s, [, t]) => s + (t === 'mat4x4f' ? 16 : t === 'vec4f' ? 4 : t === 'array<vec4f, 4>' ? 16 : NaN), 0);
  const v4 = fields.filter(([, t]) => t === 'vec4f').map(([n]) => n);
  ok(size === G.MS_U_FLOATS && v4.join() === G.MS_U_VEC4.join() && fields.slice(0, 3).map(f => f[0]).join() === 'vp,prevVP,view' && fields.slice(-3).map(f => f[0]).join() === 'spotP,spotD,spotC', 'wgsl: struct MsU = the packSnowUniforms layout', `${size} floats, ${fields.length} fields`);
}

// ── atlas ───────────────────────────────────────────────────────────────────
{
  const t0 = performance.now();
  const A = M.makeSnowAtlas({ size: 512, seed: 1 });
  const ms512 = performance.now() - t0;
  const B = M.makeSnowAtlas({ size: 512, seed: 1 }), C = M.makeSnowAtlas({ size: 512, seed: 2 });
  const t1 = performance.now();
  const P = M.makeSnowAtlas({ size: 256, seed: 1 });
  const ms256 = performance.now() - t1;
  const same = A.levels.every((l, i) => Buffer.compare(Buffer.from(l.data), Buffer.from(B.levels[i].data)) === 0);
  let diff = 0; for (let i = 0; i < A.levels[0].data.length; i += 4) if (A.levels[0].data[i] !== C.levels[0].data[i]) diff++;
  ok(same, 'atlas: deterministic (seed 1 twice gives the same bytes, all mips)');
  ok(diff > 512 * 512 * 0.05, 'atlas: another seed gives other shapes', `${diff} texels differ`);
  ok(A.levels.length === 10 && P.levels.length === 9 && A.levels.at(-1).width === 1, 'atlas: full mip chain', `${A.levels.length} levels at 512, ${P.levels.length} at 256`);
  const mean = l => { let s = 0; for (let i = 0; i < l.data.length; i += 4) s += l.data[i]; return s / (l.data.length / 4); };
  const m0 = mean(A.levels[0]), m4 = mean(A.levels[4]), m9 = mean(A.levels[9]);
  ok(Math.abs(m4 - m0) < 1 && Math.abs(m9 - m0) < 1.5, 'atlas: the box-filter mips keep the mean', `${f3(m0)} ${f3(m4)} ${f3(m9)}`);
  ok(ms512 < 400 && ms256 < 150, 'atlas: made at load in a short time', `512: ${ms512.toFixed(0)} ms, 256: ${ms256.toFixed(0)} ms`);
  // the cell borders are empty (no mip bleed between cells)
  let edge = 0; const n = A.cell;
  for (const c of A.cells) for (let i = 0; i < n; i++) edge += c[i] + c[(n - 1) * n + i] + c[i * n] + c[i * n + n - 1];
  ok(edge === 0, 'atlas: cell borders are zero');
  // irregular shapes, and a Gaussian control that the measures reject
  const gauss = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const u = (i + 0.5) / n * 2 - 1, v = (j + 0.5) / n * 2 - 1; gauss[j * n + i] = Math.exp(-(u * u + v * v) * 8); }
  const gs = M.shapeStats(gauss, n);
  const irregular = s => s.anisotropy > 0.1 || s.angular > 0.12;
  ok(!irregular(gs) && gs.radial < 0.01, 'atlas: a radial Gaussian control fails the irregularity test', `anisotropy ${f3(gs.anisotropy)}, sectors ${f3(gs.angular)}, radial ${f3(gs.radial)}`);
  const st = A.cells.map(c => M.shapeStats(c, n));
  const rows = st.map((s, k) => `${k}:${f3(s.anisotropy)}/${f3(s.angular)}/${f3(s.radial)}`);
  ok(st.every(irregular), 'atlas: all 16 shapes are irregular (anisotropy > 0.1 or sector CV > 0.12)', rows.join(' '));
  const typeMean = (a, b, k) => st.slice(a, b).reduce((s, x) => s + x[k], 0) / (b - a);
  ok(typeMean(4, 10, 'radial') > 0.1 && typeMean(10, 13, 'anisotropy') > 0.6 && typeMean(13, 15, 'anisotropy') > 0.6, 'atlas: flocs are far from radial, strings and rod pellets are long',
    `floc radial ${f3(typeMean(4, 10, 'radial'))}, string anisotropy ${f3(typeMean(10, 13, 'anisotropy'))}, pellet anisotropy ${f3(typeMean(13, 15, 'anisotropy'))}`);
  ok(A.meanDisc > 0.02 && A.meanDisc < 0.4, 'atlas: meanDisc in range', f3(A.meanDisc));
}

// ── phase ───────────────────────────────────────────────────────────────────
{
  const integ = fn => { let s = 0; const n = 4000; for (let i = 0; i < n; i++) { const c = -1 + (i + 0.5) / n * 2; s += fn(c) * 2 * Math.PI * (2 / n); } return s; };
  const i1 = integ(c => M.hgJS(0.8, c)), i2 = integ(c => M.hgJS(-0.3, c));
  ok(Math.abs(i1 - 1) < 0.01 && Math.abs(i2 - 1) < 0.01, 'phase: each Henyey-Greenstein lobe integrates to 1', `${f3(i1)}, ${f3(i2)}`);
  const fwd = M.msPhaseJS(1), side = M.msPhaseJS(0), back = M.msPhaseJS(-1);
  ok(fwd > 10 * back && back > side, 'phase: forward (into the lamp) > back (lamp at the eye) > side', `forward ${f3(fwd)}, back ${f3(back)}, side ${f3(side)}`);
  ok(fwd <= M.MS_G[3] + 1e-9 && M.msPhaseJS(0.99) <= M.MS_G[3] + 1e-9, 'phase: the cap holds', `cap ${M.MS_G[3]}`);
  const src = M.MS_VS_DECL;
  ok(src.includes('12.566371') && src.includes('mix(msHG(uMsG.x, c), msHG(uMsG.y, c), uMsG.z)'), 'phase: the GLSL is the same two-lobe phase (4 pi, mix by the back weight)');
}

// ── lens ────────────────────────────────────────────────────────────────────
{
  const o = { pxPerM: 935, focus: 2.5, aperture: 0.006, minPx: 1.6, maxPx: 26 };
  ok(M.cocPx(2.5, 2.5, 0.006, 935) < 1e-9, 'lens: no blur at the focus distance');
  const c03 = M.cocPx(0.3, 2.5, 0.006, 935), c1 = M.cocPx(1, 2.5, 0.006, 935), c10 = M.cocPx(10, 2.5, 0.006, 935);
  ok(c03 > c1 && c1 > c10 && c10 < 2, 'lens: near flakes blur most, far ones little', `0.3 m ${f3(c03)} px, 1 m ${f3(c1)} px, 10 m ${f3(c10)} px`);
  const a = M.lensOf(0.002, 0.3, o), b = M.lensOf(0.002, 2.5, o), far = M.lensOf(0.001, 8, o);
  ok(a.bok > 0.5 && b.bok < 0.01 && a.dPx > b.dPx, 'lens: a near flake is a bokeh disc, the same flake at the focus is its shape', `bokeh ${f3(a.bok)} / ${f3(b.bok)}, disc ${f3(a.dPx)} / ${f3(b.dPx)} px`);
  // energy: the light of the flake = its shape area; the disc spreads it
  const e = l => l.cover * l.dPx * l.dPx, s = l => l.sPx * l.sPx;
  ok(Math.abs(e(a) - s(a)) / s(a) < 1e-6 && Math.abs(e(b) - s(b)) / s(b) < 1e-6, 'lens: the disc keeps the light of the flake (cover x disc area = shape area)');
  ok(far.dPx === o.minPx && far.coverS < 0.2 && far.coverS * far.dPx ** 2 - far.sPx ** 2 < 1e-9, 'lens: a far mote is a min-size quad with its light spread (small and dim)', `shape ${f3(far.sPx)} px -> quad ${far.dPx} px, coverage ${f3(far.coverS)}`);
  ok(M.lensOf(0.01, 0.05, o).dPx <= o.maxPx, 'lens: the disc size is capped (fill budget)');
}

// ── place ───────────────────────────────────────────────────────────────────
{
  const box = [24, 24, 24], nb = [8, 8, 8];
  const inst = M.snowInstances(4000, 3, 0.4);
  const fadeOf = (q, cam, b) => { const d = Math.hypot(q[0] - cam[0], q[1] - cam[1], q[2] - cam[2]), R = b[0] / 2, k = b === nb ? 0.4 : 0.62; const t = Math.min(1, Math.max(0, (d - R * k) / (R * (1 - k)))); return 1 - t * t * (3 - 2 * t); };
  // a camera path in world space (up to about 6 m/s at 30 fps, turns), an origin
  // that jumps (render space = world - origin; here every 64 m, so the
  // test has many jumps), a drift
  let prev = null, slides = 0, pops = 0, wraps = 0, checked = 0, maxSlide = 0, jumps = 0, lastO = null, popA = 0;
  let origin = [0, 0, 0];
  for (let f = 0; f < 600; f++) {
    const t = f / 30;
    const camW = [1000 + 3 * t + 10 * Math.sin(t * 0.3), -20 + 3 * Math.sin(t), 1100 + 2 * t + 5 * Math.cos(t * 0.4)];
    if (Math.abs(camW[0] - origin[0]) > 12 || Math.abs(camW[2] - origin[2]) > 12) origin = [Math.round(camW[0] / 16) * 16, 0, Math.round(camW[2] / 16) * 16];
    const camR = camW.map((v, k) => v - origin[k]);
    if (lastO && lastO.join() !== origin.join()) jumps++;
    lastO = origin.slice();
    const drift = [0.04 * t, 0, 0.02 * t];
    const cur = [];
    for (let i = 0; i < inst.n; i++) {
      const s = [inst.seed[i * 4], inst.seed[i * 4 + 1], inst.seed[i * 4 + 2]], near = inst.seed[i * 4 + 3] < 0, b = near ? nb : box;
      const q = M.snowPlace(s, camR, M.snowPhase(drift, origin, b), b);
      const w = q.map((v, k) => v + origin[k]);
      cur.push({ w, a: fadeOf(q, camR, b) });
    }
    if (prev) {
      const dd = [0.04 / 30, 0, 0.02 / 30];
      for (let i = 0; i < inst.n; i++) {
        const p = prev[i], c = cur[i];
        const moved = Math.hypot(c.w[0] - p.w[0] - dd[0], c.w[1] - p.w[1] - dd[1], c.w[2] - p.w[2] - dd[2]);
        if (moved > 1e-3) { wraps++; const a = Math.max(p.a, c.a); popA = Math.max(popA, a); if (a > 0.03) pops++; }
        else if (p.a > 0 && c.a > 0) { checked++; maxSlide = Math.max(maxSlide, moved); if (moved > 2e-4) slides++; }
      }
    }
    prev = cur;
  }
  ok(checked > 100000 && slides === 0, 'place: visible flakes stay in the world (move only with the drift) while the camera moves and the origin jumps', `${checked} flake steps, ${jumps} origin jumps, max slide ${(maxSlide * 1000).toFixed(3)} mm`);
  ok(wraps > 1000 && pops === 0, 'place: flakes wrap only where they are faded out (alpha under 3 %: no pops)', `${wraps} wraps, the largest alpha at a wrap ${f3(popA)}`);
  // the GLSL wrap is the same formula
  ok(M.MS_VS_MAIN.includes('vec3 base = cameraPosition - 0.5 * B;') && M.MS_VS_MAIN.includes('q = base + mod(q - base, B);'), 'place: the GLSL wraps with the snowPlace formula');
}

// ── budgets ─────────────────────────────────────────────────────────────────
{
  const P = M.SNOW_PROFILES, ids = ['desktop', 'laptop-low', 'phone', 'phone-min'];
  ok(ids.every((id, i) => i === 0 || P[id].count < P[ids[i - 1]].count), 'budgets: fewer flakes on each smaller profile', ids.map(id => `${id} ${P[id].count}`).join(', '));
  ok(P.phone.atlas <= 256 && P['phone-min'].atlas <= 256 && P.desktop.atlas === 512 && P.phone.maxPx < P.desktop.maxPx, 'budgets: phones get the 256 atlas and smaller discs');
  // GPU memory and per-frame work (estimates)
  for (const id of ids) {
    const p = P[id], atlasB = p.atlas * p.atlas * 4 * 4 / 3, instB = p.count * 32;
    console.log(`     budget ${id}: ${p.count} flakes, ${p.count * 4} vertices/frame, instances ${(instB / 1024).toFixed(0)} KB, atlas ${(atlasB / 1024).toFixed(0)} KB, disc cap ${p.maxPx} px`);
  }
  ok(P['phone-min'].count * 32 + 256 * 256 * 4 * 4 / 3 < 512 * 1024, 'budgets: phone-min snow under 0.5 MB of GPU memory');
}

// ── mix ─────────────────────────────────────────────────────────────────────
{
  const d = [0, 10, 30, 60, 200, 1000, 4000].map(M.snowMix);
  ok(d.every((m, i) => i === 0 || m.density >= d[i - 1].density - 1e-9) && d.every((m, i) => i === 0 || m.typeK[1] >= d[i - 1].typeK[1] - 1e-9), 'mix: density and the floc share grow with depth', d.map(m => `${m.depth} m ${f3(m.density)}/${f3(m.typeK[1])}`).join(', '));
  ok(d[0].tintA[1] > d[0].tintA[0] + 0.2 && d[0].tintA[1] > d[0].tintA[2] + 0.2 && Math.abs(d[6].tintA[0] - d[6].tintA[1]) < 0.1, 'mix: green motes (plankton) in the shallows, white in the abyss');
  ok(d[6].sizeK[1] > d[0].sizeK[1] * 1.5, 'mix: larger flocs deep', `${f3(d[0].sizeK[1])} -> ${f3(d[6].sizeK[1])}`);
}

// ── three ───────────────────────────────────────────────────────────────────
{
  const ms = M.createMarineSnow(THREE, { count: 2000, atlasSize: 256 });
  const mat = ms.material, src = mat.vertexShader + mat.fragmentShader;
  const names = [...src.matchAll(/^uniform\s+(?:\w+\s+)?\w+\s+(\w+)/gm)].map(m => m[1]);
  const missing = names.filter(n => !(n in mat.uniforms));
  ok(names.length > 20 && missing.length === 0, 'three: every shader uniform has a value', missing.join(', ') || `${names.length} uniforms`);
  ok(ms.geometry.instanceCount === 2000 && ms.texture.mipmaps.length === 9 && ms.texture.generateMipmaps === false, 'three: instances and the mip chain');
  ms.setDensity(0.5);
  const half = ms.geometry.instanceCount;
  ms.setDepth(5);
  const shallow = ms.geometry.instanceCount;
  ok(Math.abs(half - 1000) < 40 && shallow < half, 'three: density and depth set the instance count', `0.5 -> ${half}, + 5 m -> ${shallow}`);
  // the streak matrix across an origin jump: a world point projects to the
  // same last-frame place before and after the jump
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  cam.position.set(10, 0, 5); cam.lookAt(10, 0, -5); cam.updateMatrixWorld();
  ms.update(cam, 0);
  const vp0 = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  ms.setOrigin(1024, 0, 0);
  cam.position.set(10 - 1024 + 0.05, 0, 5); cam.lookAt(10 - 1024 + 0.05, 0, -5); cam.updateMatrixWorld();
  ms.update(cam, 1 / 60);
  const w = new THREE.Vector3(12, 1, -3);
  const a = w.clone().applyMatrix4(vp0);
  const b = w.clone().sub(new THREE.Vector3(1024, 0, 0)).applyMatrix4(ms.uniforms.uMsPrevVP.value);
  ok(a.distanceTo(b) < 1e-4 && ms.state.streakOK, 'three: the last-frame matrix follows the origin jump (no false streak)', `${a.distanceTo(b).toExponential(2)}`);
  cam.position.x += 50; cam.updateMatrixWorld(); ms.update(cam, 2 / 60);
  ok(!ms.state.streakOK, 'three: a camera cut turns the streak off for a frame');
  const extra = ms.makeMesh({ soft: true, post: true });
  ok(extra.material.uniforms.uMsFrag.value.x === 1 && extra.material.uniforms.uMsBox === ms.uniforms.uMsBox && extra.material.depthTest === false, 'three: a soft post mesh shares the state uniforms');
  ms.dispose();
}

// ── gpu ─────────────────────────────────────────────────────────────────────
{
  globalThis.GPUBufferUsage ??= { VERTEX: 32, UNIFORM: 64, COPY_DST: 8 };
  globalThis.GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
  const log = { buffers: [], writes: [], tex: [], draws: [] };
  const dev = {
    createTexture: d => { log.tex.push(d); return { createView: () => ({}), destroy() {} }; },
    createSampler: () => ({}),
    createBuffer: d => { log.buffers.push(d); return { size: d.size, destroy() {} }; },
    createShaderModule: d => ({ code: d.code }),
    createRenderPipeline: d => ({ desc: d, getBindGroupLayout: () => ({}) }),
    createBindGroup: d => ({ entries: d.entries }),
    queue: { writeBuffer: (b, o, data) => log.writes.push({ b, n: data.length }), writeTexture: () => {} },
  };
  const code = fs.readFileSync(path.join(LIB, 'marine-snow.wgsl'), 'utf8');
  const ms = G.createMarineSnowGPU(dev, { code, format: 'rgba16float', count: 1500, atlasSize: 256 });
  const I = (() => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; })();
  ms.update({ vp: I, view: I, eye: [0, 0, 0], fovY: 1, near: 0.1, far: 100, width: 800, height: 600, t: 0 });
  ms.setDepth(2000); ms.setDensity(0.5);
  const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw: (v, n) => log.draws.push([v, n]) };
  ms.draw(pass);
  ok(log.buffers.some(b => b.size === 1500 * 32) && log.buffers.some(b => b.size === G.MS_U_FLOATS * 4), 'gpu: instance and uniform buffers', `${log.buffers.map(b => b.size).join(', ')} bytes`);
  ok(log.writes.some(w => w.n === G.MS_U_FLOATS) && log.tex[0].mipLevelCount === 9, 'gpu: the uniform pack and the atlas mips');
  ok(log.draws[0][0] === 6 && Math.abs(log.draws[0][1] - 1500 * 0.9 * 0.5) < 30, 'gpu: draw(6, density x count)', `${log.draws[0][1]}`);
  ms.setOrigin(1024, 0, 0);
  ms.update({ vp: I, view: I, eye: [-1024, 0, 0], fovY: 1, near: 0.1, far: 100, width: 800, height: 600, t: 1 / 60 });
  ok(ms.state.prevVP[12] === 1024 && ms.state.px[3] === 1, 'gpu: the last-frame matrix follows the origin jump', `prevVP[12] ${ms.state.prevVP[12]}`);
}

console.log(`\nmarine-snow-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

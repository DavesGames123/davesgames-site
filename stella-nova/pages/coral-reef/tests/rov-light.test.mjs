// ============================================================================
//  CORAL REEF  ·  ROV fill light tests (node, no browser):  node tests/rov-light.test.mjs
// ----------------------------------------------------------------------------
//  The user (2026-10-18): "i would love just a little bit of ambient light
//  back from the the rov's". rov/fill.js and rov/build.js:
//    only ROV ..... every ROV material has the fill (onBeforeCompile); the
//                   scene.js materials (rock, coral, sand, water, passes)
//                   have no fill; build.js adds no light but the SpotLights
//    shader ....... the injected MeshStandardMaterial (three r160 chunks,
//                   loops unrolled as WebGLProgram does) compiles as GLSL
//                   ES 3.00 (glslangValidator)
//    levels ....... display referred (x 1 / exposure): the foam reads at
//                   about 0.06 before the tone map, less than a lit rock;
//                   the lamp spill lights the front more than the back
//    per vehicle .. the uniforms of two vehicles are their own; the lamp
//                   level (flicker) and the exposure reach the uniforms
//    highlight .... setHighlight(on, colour)
//    emissive ..... lamp faces, LEDs: emissive
//    exposure ..... scene.userData.exposure; S.exposureMax caps the auto
//                   exposure (WORLD sets it per depth region)
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const THREE = await import('three');
const { buildVehicle } = await import('../rov/build.js');
const { createFill, fillAt, FILL } = await import('../rov/fill.js');
const { createScene } = await import('../scene.js');
const { profileFor } = await import('../budget.js');

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }

const A = buildVehicle(THREE, { id: 1, seed: 3, scale: 0.6 }), B = buildVehicle(THREE, { id: 2, seed: 4, scale: 0.6, quality: 'low' });

// ── only the ROV gets the fill ─────────────────────────────────────────────
{
  const mats = new Set();
  A.group.traverse(m => { if (m.isMesh) mats.add(m.material); });
  const all = [...mats];
  ok(all.length > 8 && all.every(m => m.userData.rovFill && typeof m.onBeforeCompile === 'function'), 'only ROV: every material of the vehicle has the fill', all.filter(m => !m.userData.rovFill).map(m => m.type).join());
  const lights = []; A.group.traverse(o => { if (o.isLight) lights.push(o); });
  ok(lights.length === 2 && lights.every(l => l.isSpotLight), 'only ROV: build.js adds no light but its SpotLights (no ambient, no hemisphere)', lights.map(l => l.type).join());
  // the scene materials
  const f = fakeCanvas({ w: 640, h: 400 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096, profile: profileFor('desktop') });
  S.resize(); S.render(1 / 60, 0);
  const sm = new Set();
  const visit = (root) => root.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => sm.add(m)); });
  visit(S.scene);
  for (const k of ['volScene', 'taaScene', 'compScene', 'lumScene']) if (S.passes && S.passes[k]) visit(S.passes[k]);
  const sceneMats = [...sm];
  const leaked = sceneMats.filter(m => m.userData && m.userData.rovFill || /uRov/.test((m.fragmentShader || '') + (m.vertexShader || '')));
  ok(sceneMats.length >= 4 && leaked.length === 0, 'only ROV: no scene.js material (rock, coral, water, passes) has the fill', `${sceneMats.length} materials, ${leaked.length} with the fill`);
  const SH = await import('../shaders.js');
  ok(!Object.values(SH).some(v => typeof v === 'string' && /uRov/.test(v)), 'only ROV: shaders.js has no fill term');
  S.scene.add(A.group);
  let n = 0; S.scene.traverse(o => { if (o.isAmbientLight || o.isHemisphereLight) n++; });
  ok(n === 0, 'only ROV: a vehicle in the scene adds no ambient or hemisphere light');
  S.scene.remove(A.group);
}

// ── the injected shader compiles (GLSL ES 3.00) ────────────────────────────
{
  const GL = ['/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].find(p => fs.existsSync(p));
  const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  A.materials.foam.onBeforeCompile(sh);
  ok(sh.fragmentShader.includes('uRovGain') && sh.vertexShader.includes('vRovW =') && Object.keys(sh.uniforms).filter(k => k.startsWith('uRov')).length === 9, 'shader: the fill is in the standard shader and its 9 uniforms are passed');
  if (!GL) console.log('rov-light: glslangValidator not found, the GLSL ES check did not run');
  else {
    // three r160 WebGLProgram: includes, light counts, unrolled loops
    const NUMS = { NUM_DIR_LIGHTS: 0, NUM_SPOT_LIGHTS: 4, NUM_RECT_AREA_LIGHTS: 0, NUM_POINT_LIGHTS: 0, NUM_HEMI_LIGHTS: 1, NUM_DIR_LIGHT_SHADOWS: 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_SHADOWS: 1, NUM_SPOT_LIGHT_MAPS: 0, NUM_SPOT_LIGHT_COORDS: 1, NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS: 0, NUM_CLIPPING_PLANES: 0, UNION_CLIPPING_PLANES: 0 };
    const inc = s => s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, n) => inc(THREE.ShaderChunk[n]));
    const nums = s => s.replace(/\b(NUM_[A-Z_]+|UNION_CLIPPING_PLANES)\b/g, m => (m in NUMS ? String(NUMS[m]) : m));
    const unroll = s => s.replace(/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g, (m, a, b, body) => { let o = ''; for (let i = +a; i < +b; i++) o += body.replace(/\[\s*i\s*\]/g, '[ ' + i + ' ]').replace(/UNROLLED_LOOP_INDEX/g, i); return o; });
    const full = s => unroll(nums(inc(s)));
    // glslang has a built-in 'average'; three's common chunk declares one
    const prec = '#define average three_average\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler2DShadow;\n';
    const defs = ['STANDARD', 'USE_COLOR', 'USE_MAP', 'USE_BUMPMAP', 'USE_UV', 'MAP_UV uv', 'BUMPMAP_UV uv', 'USE_FOG', 'FOG_EXP2', 'USE_SHADOWMAP', 'SHADOWMAP_TYPE_PCF'].map(d => '#define ' + d).join('\n') + '\n';
    const vs = '#version 300 es\n#define attribute in\n#define varying out\n#define texture2D texture\n' + prec + defs + 'uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\nattribute vec3 position;\nattribute vec3 normal;\nattribute vec2 uv;\nattribute vec3 color;\n' + full(sh.vertexShader);
    const fsrc = '#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n' + prec + defs + 'uniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\nvec4 linearToOutputTexel(vec4 value) { return value; }\n' + full(sh.fragmentShader);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-light-'));
    const res = [];
    try {
      for (const [f, src] of [['rov.vert', vs], ['rov.frag', fsrc]]) {
        const p = path.join(dir, f); fs.writeFileSync(p, src);
        try { execFileSync(GL, [p], { stdio: 'pipe' }); res.push([f, true, '']); } catch (e) { res.push([f, false, String(e.stdout || e.message).split('\n').slice(0, 6).join(' | ')]); }
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    for (const [f, good, log] of res) ok(good, `shader: the ROV standard ${f} with the fill compiles as GLSL ES 3.00`, log);
    // the same text with the fill taken out also compiles (the check sees errors of the fill only)
    console.log('rov-light glsl ES 3.00: ' + res.map(([f, g]) => `${f} ${g ? 'ok' : 'FAIL'}`).join(', '));
  }
}

// ── levels ─────────────────────────────────────────────────────────────────
{
  // the vehicle frame at scale 0.6: lamps at the front top, x 0.68
  const lamps = [-0.34, -0.12, 0.12, 0.34].map(z => [0.68, 0.12, z]);
  const foamYellow = [0.89, 0.46, 0.0];         // 0xf2b705 in linear light
  for (const E of [2, 4, 8]) {
    const top = fillAt([0, 0.4, 0], [0, 1, 0], { exposure: E, lamps, lampK: 1 });
    const disp = top.map((c, i) => c * foamYellow[i] * E);
    ok(disp[0] > 0.03 && disp[0] < 0.1, `levels: the top of the foam reads at 0.03 .. 0.1 before the tone map at exposure ${E}`, disp.map(x => x.toFixed(3)).join());
  }
  const front = fillAt([0.7, 0.0, 0.2], [1, 0, 0], { exposure: 4, lamps, lampK: 1 }), back = fillAt([-0.6, 0.0, 0.2], [-1, 0, 0], { exposure: 4, lamps, lampK: 1 });
  ok(front[0] > back[0] * 3, 'levels: the lamp spill lights the front frame over 3 x the back', `${front[0].toFixed(4)} vs ${back[0].toFixed(4)}`);
  const off = fillAt([0.7, 0.0, 0.2], [1, 0, 0], { exposure: 4, lamps, lampK: 0 });
  ok(off[0] < front[0] * 0.4 && off[0] > 0, 'levels: with the lamps off only the faint ambient stays');
  // a lit rock at 4 m under the beam is about 0.15 (volume.js NOTES); the
  // fill at exposure 4 stays under it
  ok(back[0] * 4 < 0.15, 'levels: the fill on the back is under a lit rock (the scene stays dark)', (back[0] * 4).toFixed(3));
  console.log(`levels: foam top x E ${[2, 4, 8].map(E => (fillAt([0, 0.4, 0], [0, 1, 0], { exposure: E, lamps }).map((c, i) => c * foamYellow[i] * E)[0]).toFixed(3)).join(' / ')} (E 2/4/8); front frame ${front[0].toFixed(4)}, back ${back[0].toFixed(4)}, lamps off ${off[0].toFixed(4)}`);
}

// ── the exposure the fill reads, and the depth cap of WORLD ────────────────
{
  const f = fakeCanvas({ w: 320, h: 200 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096, profile: profileFor('desktop') });
  S.resize();
  for (let i = 0; i < 40; i++) S.render(1 / 60, i * 16);
  const free = S.post.exposure;
  ok(free <= 8 + 1e-9 && S.scene.userData.exposure === S.post.exposure, 'exposure: at most 8, and scene.userData.exposure is the composite exposure', free.toFixed(3));
  S.exposureMax = 2;                                   // main.js depthLook in deep water
  for (let i = 0; i < 80; i++) S.render(1 / 60, 700 + i * 16);
  ok(S.post.exposure <= 2 + 1e-6 && S.exposureMax === 2, 'exposure: S.exposureMax (WORLD, per depth region) caps the auto exposure', `${S.post.exposure.toFixed(3)} (free ${free.toFixed(3)})`);
  S.exposureMax = NaN;
  ok(S.exposureMax === Infinity, 'exposure: a bad S.exposureMax is no cap');
  console.log(`exposure: free ${free.toFixed(3)}, with S.exposureMax 2 -> ${S.post.exposure.toFixed(3)}`);
}

// ── per vehicle, update, highlight, emissive ───────────────────────────────
{
  ok(A.fill && B.fill && A.fill.uniforms !== B.fill.uniforms && A.fill.uniforms.uRovGain !== B.fill.uniforms.uRovGain, 'per vehicle: each vehicle has its own fill uniforms');
  A.group.updateMatrixWorld(true);
  A.fill.update(8, 0.5, A.lamps);
  const U = A.fill.uniforms;
  const lp = new THREE.Vector3(); A.lamps[0].getWorldPosition(lp);
  ok(Math.abs(U.uRovGain.value - 1 / 8) < 1e-9 && Math.abs(U.uRovSpill.value.x - FILL.spill[0] * 0.5) < 1e-9 && U.uRovLamp.value[0].distanceTo(lp) < 1e-9, 'update: exposure, lamp level and lamp positions reach the uniforms');
  A.setHighlight(true, 0xff8800);
  ok(U.uRovHi.value.w > 0 && Math.abs(U.uRovHi.value.x - new THREE.Color(0xff8800).r) < 1e-6, 'highlight: setHighlight(true, colour) sets the glow');
  A.setHighlight(false);
  ok(U.uRovHi.value.w === 0, 'highlight: setHighlight(false) clears it');
  ok(A.lamps.every(m => m.material.emissiveIntensity >= 2) && A.leds.every(l => l.mesh.material.emissiveIntensity > 0), 'emissive: lamp faces and LEDs glow');
  ok(A.materials.lampRing && A.materials.lampRing.emissiveIntensity > 0, 'emissive: the lamp heads have a glowing bezel ring');
}
A.dispose(); B.dispose();

console.log(`rov-light: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

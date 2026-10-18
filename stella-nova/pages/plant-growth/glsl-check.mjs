// ============================================================================
//  PLANT GROWTH  ·  glsl-check.mjs: compile the page shaders with glslang
// ----------------------------------------------------------------------------
//  No browser runs on this machine. This tool builds each material of
//  render.js and meadow.js in node (three.js r160 from stella-nova/vendor),
//  runs its onBeforeCompile, and assembles the program the way three.js
//  r160 does for WebGL 2: the "#version 300 es" header, the precision and
//  the GLSL 3 defines, the prefix (defines from the material, one sun with
//  a PCF soft shadow, exp2 fog, the PMREM environment, ACES tone mapping),
//  the resolved #include chunks, the light counts and the unrolled loops.
//  glslangValidator (Khronos) then compiles and links each program as GLSL
//  ES 3.00. It does not prove that ANGLE or Safari accept the code, but
//  those front ends follow the same specification.
//
//  USE   node glsl-check.mjs              (one line per program, exit 1 on a failure)
//        import { checkShaders } from './glsl-check.mjs'  -> [{ name, ok, log }] | null
//  glslangValidator: /opt/homebrew/bin, /usr/local/bin, or GLSLANG=/path.
//
//  grep -n targets
//    three.js prefix ....... "function prefixes"
//    assemble .............. "function assemble"
//    programs .............. "async function programs"
// ============================================================================
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VENDOR = new URL('../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return next(new URL('build/three.module.js', VENDOR).href, ctx);
    if (spec.startsWith('three/addons/')) return next(new URL('examples/jsm/' + spec.slice(13), VENDOR).href, ctx);
    return next(spec, ctx);
  },
});

export function findGlslang() {
  const c = [process.env.GLSLANG, '/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return null;
}

let THREE = null;
const LIGHTS = { NUM_DIR_LIGHTS: 1, NUM_DIR_LIGHT_SHADOWS: 1, NUM_SPOT_LIGHTS: 0, NUM_SPOT_LIGHT_MAPS: 0, NUM_SPOT_LIGHT_COORDS: 0, NUM_RECT_AREA_LIGHTS: 0, NUM_POINT_LIGHTS: 0, NUM_HEMI_LIGHTS: 0, NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS: 0, NUM_SPOT_LIGHT_SHADOWS: 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_CLIPPING_PLANES: 0, UNION_CLIPPING_PLANES: 0 };
const include = /^[ \t]*#include +<([\w\d./]+)>/gm;
function resolve(s) { return s.replace(include, (m, k) => { const c = THREE.ShaderChunk[k]; if (c === undefined) throw new Error('no chunk ' + k); return resolve(c); }); }
const unroll = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
// glslang knows "average" as a built-in (an AMD extension) and rejects
// three.js common.glsl "float average( const in vec3 v )"; browsers do not.
// The check renames it in the assembled text only.
function finish(s) {
  s = resolve(s).replace(/\baverage\b/g, 'pg_average');
  // longest names first, as three.js does them in an order that avoids prefixes
  for (const k of Object.keys(LIGHTS).sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(k, 'g'), String(LIGHTS[k]));
  return s.replace(unroll, (m, a, b, body) => { let o = ''; for (let i = +a; i < +b; i++) o += body.replace(/\[\s*i\s*\]/g, '[ ' + i + ' ]').replace(/UNROLLED_LOOP_INDEX/g, i); return o; });
}

// the three.js r160 prefixes for a material (WebGL 2, not raw)
function prefixes(m, o) {
  const d = [];
  for (const [k, v] of Object.entries(m.defines || {})) d.push(`#define ${k} ${v}`);
  const std = m.isMeshStandardMaterial, shader = m.isShaderMaterial;
  const fog = (std || (shader && m.fog)) && !o.noFog;
  const map = !!m.map, nmap = !!m.normalMap, env = std && !o.noEnv;
  const common = [
    ...d,
    o.instancing ? '#define USE_INSTANCING' : '',
    fog ? '#define USE_FOG' : '', fog ? '#define FOG_EXP2' : '',
    map ? '#define USE_MAP' : '', map ? '#define MAP_UV uv' : '',
    nmap ? '#define USE_NORMALMAP' : '', nmap ? '#define USE_NORMALMAP_TANGENTSPACE' : '', nmap ? '#define NORMALMAP_UV uv' : '',
    env ? '#define USE_ENVMAP' : '', env ? '#define ENVMAP_MODE_REFLECTION' : '',
    m.side === THREE.DoubleSide ? '#define DOUBLE_SIDED' : '',
    o.depth ? '' : '#define USE_SHADOWMAP', o.depth ? '' : '#define SHADOWMAP_TYPE_PCF_SOFT',
  ].filter(Boolean);
  const vs = ['#version 300 es', 'precision mediump sampler2DArray;', '#define attribute in', '#define varying out', '#define texture2D texture',
    'precision highp float;', 'precision highp int;', '#define HIGH_PRECISION',
    `#define SHADER_TYPE ${o.type}`, `#define SHADER_NAME ${o.name}`, ...common,
    'uniform mat4 modelMatrix;', 'uniform mat4 modelViewMatrix;', 'uniform mat4 projectionMatrix;', 'uniform mat4 viewMatrix;', 'uniform mat3 normalMatrix;', 'uniform vec3 cameraPosition;', 'uniform bool isOrthographic;',
    '#ifdef USE_INSTANCING', '\tattribute mat4 instanceMatrix;', '#endif', 'attribute vec3 position;', 'attribute vec3 normal;', 'attribute vec2 uv;', ''].join('\n');
  const fs = ['#version 300 es', 'precision mediump sampler2DArray;', '#define varying in', 'layout(location = 0) out highp vec4 pc_fragColor;', '#define gl_FragColor pc_fragColor',
    '#define gl_FragDepthEXT gl_FragDepth', '#define texture2D texture', '#define textureCube texture', '#define texture2DProj textureProj', '#define texture2DLodEXT textureLod',
    '#define texture2DProjLodEXT textureProjLod', '#define textureCubeLodEXT textureLod', '#define texture2DGradEXT textureGrad', '#define texture2DProjGradEXT textureProjGrad', '#define textureCubeGradEXT textureGrad',
    'precision highp float;', 'precision highp int;', '#define HIGH_PRECISION',
    `#define SHADER_TYPE ${o.type}`, `#define SHADER_NAME ${o.name}`, ...common,
    env ? '#define ENVMAP_TYPE_CUBE_UV' : '', env ? '#define ENVMAP_BLENDING_NONE' : '',
    env ? '#define CUBEUV_TEXEL_WIDTH 0.0013020833333333333' : '', env ? '#define CUBEUV_TEXEL_HEIGHT 0.0009765625' : '', env ? '#define CUBEUV_MAX_MIP 8.0' : '',
    m.alphaTest > 0 ? '#define USE_ALPHATEST' : '',
    o.depth ? '#define DEPTH_PACKING 3201' : '',
    'uniform mat4 viewMatrix;', 'uniform vec3 cameraPosition;', 'uniform bool isOrthographic;',
    '#define TONE_MAPPING', THREE.ShaderChunk.tonemapping_pars_fragment, 'vec3 toneMapping( vec3 color ) { return ACESFilmicToneMapping( color ); }',
    THREE.ShaderChunk.colorspace_pars_fragment, 'vec4 linearToOutputTexel( vec4 value ) { return sRGBTransferOETF( value ); }', ''].filter(s => s !== '').join('\n');
  return { vs, fs };
}

// m: a material. o: { name, instancing, depth }. Returns { name, vs, fs }.
function assemble(m, o) {
  let lib;
  if (m.isShaderMaterial) lib = { vertexShader: m.vertexShader, fragmentShader: m.fragmentShader };
  else if (m.isMeshDepthMaterial) lib = THREE.ShaderLib.depth;
  else lib = THREE.ShaderLib.standard;
  const sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {}, defines: m.defines };
  if (m.onBeforeCompile) m.onBeforeCompile(sh, null);
  const p = prefixes(m, { ...o, type: m.type, depth: m.isMeshDepthMaterial });
  return { name: o.name, vs: p.vs + '\n' + finish(sh.vertexShader), fs: p.fs + '\n' + finish(sh.fragmentShader) };
}

async function programs() {
  THREE = await import('three');
  const R = await import('./render.js');
  const M = await import('./meadow.js');
  const t2 = new THREE.Texture(), ta = new THREE.DataArrayTexture();
  const U = {};
  const atlas = { c: t2, a: t2, n: t2 };
  const tex5 = [t2, t2, t2, t2, t2];
  const out = [];
  // expect: [vertex tokens, fragment tokens] that the page code inserts, so a
  // replace() anchor that does not match (code left out) is a failure too
  const add = (name, m, o = {}, expect = [[], []]) => { const a = assemble(m, { name, ...o }); a.expect = expect; out.push(a); };
  const br = R.branchMaterial(U, tex5); add('branch', br, {}, [['bPos', 'windOffset'], ['uBarkC']]); add('branch depth', R.branchDepth(U, br.userData.own));
  const lf = R.leafMaterial(U, tex5, atlas); add('leaf', lf); add('leaf depth', R.leafDepth(U, lf.userData.own));
  add('sky', R.makeSky(new THREE.Vector3(0, 1, 0)).material, { noFog: true });
  add('ground', R.makeGround(U, { turf: t2, meadow: t2, soil: t2, forest: t2, litter: t2, normal: t2 }).material, {}, [['groundY(gx', 'padMask'], ['fCover(p)', 'fSward(p)', 'uGroundN', 'litC']]);
  const C = R.COMMON_GLSL;
  add('grass', M.grassMaterial(THREE, U, C), {}, [['bladeP', 'grassState(pp', 'gust(bp'], ['vGsnow']]);
  add('grass far meadow', M.grassMaterial(THREE, U, C, true), {}, [['bladeP', 'gl_InstanceID', 'procKeep'], ['vGsnow']]);
  add('stone', M.natureMaterial(THREE, U, C, 'stone', { map: t2, normal: t2 }), { instancing: true }, [['vNw ='], ['north * (1.35']]);
  add('forb', M.natureMaterial(THREE, U, C, 'forb', { map: t2, normal: t2, alpha: true }), { instancing: true }, [['forbVigour(sp', 'forbBloom(sp'], ['> vBloom']]);
  add('forb (no normal map)', M.natureMaterial(THREE, U, C, 'forb', { map: t2, alpha: true }), { instancing: true });
  add('shrub', M.natureMaterial(THREE, U, C, 'shrub', { map: t2, normal: t2, alpha: true }), { instancing: true }, [['vBare = clamp'], ['vBare * 0.85']]);
  add('stump', M.natureMaterial(THREE, U, C, 'stump', { map: t2, normal: t2 }), { instancing: true });
  add('litter', M.litterMaterial(THREE, U, C, atlas), {}, [['litP'], ['uAtlasA']]);
  add('petal', M.petalMaterial(THREE, U, C), {}, [['petP'], ['vPq']]);
  add('seedling', M.seedlingMaterial(THREE, U, C, atlas), {}, [['transformed = sP'], ['vStem']]);
  add('impostor deciduous', M.impostorMaterial(THREE, U, { tex: t2, half: [5, 6], cy: 6 }, true));
  add('impostor conifer', M.impostorMaterial(THREE, U, { tex: t2, half: [5, 6], cy: 6 }, false));
  void ta;
  return out;
}

export async function checkShaders() {
  const bin = findGlslang();
  if (!bin) return null;
  const progs = await programs();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-glsl-'));
  const res = [];
  try {
    for (const p of progs) {
      const base = path.join(dir, p.name.replace(/\W+/g, '_'));
      fs.writeFileSync(base + '.vert', p.vs); fs.writeFileSync(base + '.frag', p.fs);
      let ok = true, log = '';
      const miss = [...(p.expect?.[0] || []).filter(t => !p.vs.includes(t)), ...(p.expect?.[1] || []).filter(t => !p.fs.includes(t))];
      if (miss.length) { ok = false; log = 'code not inserted (anchor did not match): ' + miss.join(', '); }
      if (ok) try { execFileSync(bin, ['-l', base + '.vert', base + '.frag'], { stdio: 'pipe' }); }
      catch (e) { ok = false; log = (String(e.stdout || '') + String(e.stderr || '')).trim().split('\n').filter(l => /ERROR|error/.test(l)).slice(0, 12).join('\n'); }
      res.push({ name: p.name, ok, log, lines: p.vs.split('\n').length + p.fs.split('\n').length });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return res;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const res = await checkShaders();
  if (!res) { console.log('glslangValidator not found: skipped'); process.exit(0); }
  for (const r of res) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n' + r.log}`);
  console.log(`glsl-check: ${res.filter(r => r.ok).length} of ${res.length} programs compile and link as GLSL ES 3.00`);
  process.exit(res.every(r => r.ok) ? 0 : 1);
}

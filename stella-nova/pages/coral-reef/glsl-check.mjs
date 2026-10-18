// ============================================================================
//  CORAL REEF  ·  GLSL check with naga (node only, no browser)
// ----------------------------------------------------------------------------
//  three.js compiles shaders.js as GLSL ES 3.00 with its own prefix. There
//  is no browser on this machine, so this file rewrites each program as
//  Vulkan GLSL 450 (the form that naga reads) and runs naga on it:
//    - the three.js prefix (modelMatrix, viewMatrix, projectionMatrix,
//      cameraPosition, position, normal, uv, instanceMatrix,
//      linearToOutputTexel) becomes declarations
//    - free uniforms go into one uniform block, samplers get bindings
//    - in / out get locations, one name per line
//  It catches syntax and type errors (a missing uniform, a wrong vector
//  size, a bad call). It does not prove that Chrome (ANGLE / Tint) or
//  Safari accept the code: the ES 3.00 rules are close, not the same.
//
//  USE   import { checkPrograms } from './glsl-check.mjs';
//        const res = checkPrograms([{ name, vs, fs, instanced }]);  // [{ name, ok, log }]
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAGA = [path.join(os.homedir(), '.cargo/bin/naga'), '/opt/homebrew/bin/naga'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

function split(decl) {
  // "vec3 a, b[2], c" -> [[type, name], ...]
  const m = decl.trim().replace(/^(highp|mediump|lowp)\s+/, '').match(/^(\w+)\s+(.+)$/);
  if (!m) return [];
  return m[2].split(',').map(n => [m[1], n.trim()]);
}

// GLSL ES 3.00 (three.js ShaderMaterial body) -> GLSL 450.
export function toVulkan(src, stage, o = {}) {
  const lines = src.split('\n');
  const ubo = [], samplers = [], ins = [], outs = [], body = [];
  for (const ln of lines) {
    const m = ln.match(/^(uniform|in|out)\s+([^;]+);\s*(\/\/.*)?$/);
    if (m) {
      for (const [t, n] of split(m[2])) {
        if (m[1] === 'uniform') (t.startsWith('sampler') ? samplers : ubo).push([t, n]);
        else (m[1] === 'in' ? ins : outs).push([t, n]);
      }
      continue;
    }
    if (/^\s*precision\s/.test(ln)) continue;
    body.push(ln);
  }
  let head = '#version 450\n';
  head += 'layout(set = 0, binding = 0) uniform ThreeU { mat4 modelMatrix; mat4 viewMatrix; mat4 projectionMatrix; vec3 cameraPosition; float threePad; };\n';
  const seen = new Set();
  const uniq = (arr) => arr.filter(([t, n]) => { const k = n.replace(/\[.*$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  const U = uniq(ubo);
  if (U.length) head += `layout(set = 0, binding = 1) uniform UserU { ${U.map(([t, n]) => `${t} ${n};`).join(' ')} };\n`;
  // naga has no combined image samplers: a sampler2D S becomes a texture2D
  // S_t and a sampler S_s (uniforms, function parameters and arguments)
  const SU = uniq(samplers);
  const sNames = new Set(SU.map(([t, n]) => n));
  SU.forEach(([t, n], i) => { head += `layout(set = 1, binding = ${2 * i}) uniform texture2D ${n}_t;\nlayout(set = 1, binding = ${2 * i + 1}) uniform sampler ${n}_s;\n`; });
  let text = body.join('\n');
  text = text.replace(/sampler2D\s+(\w+)/g, (m, n) => { sNames.add(n); return `texture2D ${n}_t, sampler ${n}_s`; });
  for (const n of sNames) {
    text = text.replace(new RegExp(`\\b(texture|textureLod|texelFetch)\\(\\s*${n}\\s*,`, 'g'), `$1(sampler2D(${n}_t, ${n}_s),`);
    text = text.replace(new RegExp(`\\b${n}\\b(?!_[ts])`, 'g'), `${n}_t, ${n}_s`);
  }
  if (o.instanced) text = text.replace(/\binstanceMatrix\b/g, 'mat4(iM0, iM1, iM2, iM3)');
  let loc = 0;
  if (stage === 'vert' && !o.raw) {
    for (const [t, n] of [['vec3', 'position'], ['vec3', 'normal'], ['vec2', 'uv']]) head += `layout(location = ${loc++}) in ${t} ${n};\n`;
    if (o.instanced) for (let q = 0; q < 4; q++) head += `layout(location = ${loc++}) in vec4 iM${q};\n`;
  }
  ins.forEach(([t, n]) => {
    const flat = stage === 'frag' && /^(int|uint|ivec|uvec)/.test(t) ? 'flat ' : '';
    head += `layout(location = ${loc}) ${flat}in ${t} ${n};\n`; loc += t.startsWith('mat4') ? 4 : 1;
  });
  outs.forEach(([t, n], i) => { head += `layout(location = ${i}) out ${t} ${n};\n`; });
  if (stage === 'frag') head += 'vec4 linearToOutputTexel(vec4 v) { return v; }\n';
  return head + text + '\n';
}

export function checkPrograms(progs) {
  if (!NAGA) return progs.map(p => ({ name: p.name, ok: null, log: 'naga not found' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-glsl-'));
  const out = [];
  try {
    for (const p of progs) {
      const logs = [];
      let ok = true;
      for (const [stage, src] of [['vert', p.vs], ['frag', p.fs]]) {
        const f = path.join(dir, `${p.name}.${stage}`);
        fs.writeFileSync(f, toVulkan(src, stage, p));
        try { execFileSync(NAGA, ['--input-kind', 'glsl', '--shader-stage', stage, f], { stdio: 'pipe' }); }
        catch (e) { ok = false; logs.push(`${stage}: ${String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 12).join('\n')}`); }
      }
      out.push({ name: p.name, ok, log: logs.join('\n') });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}

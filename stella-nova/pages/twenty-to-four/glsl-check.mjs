// ============================================================================
//  TWENTY TO FOUR  ·  glsl-check.mjs — node stella-nova/pages/twenty-to-four/glsl-check.mjs
// ----------------------------------------------------------------------------
//  Validates every WebGL2 shader of render.js with naga, without a browser.
//  naga reads Vulkan GLSL 450, so each shader is rewritten first:
//    #version 300 es      -> #version 450, precision lines removed
//    loose uniforms       -> one uniform block; sampler2D -> texture2D + sampler
//    in / out             -> explicit layout(location = n)
//    gl_VertexID          -> gl_VertexIndex
//  The rewrite does not change any expression, so a type or name error in
//  the WebGL source is also an error here. naga is not Tint or ANGLE: a
//  shader that passes can still fail in a browser (see the commit notes).
//  NAGA defaults to ~/.cargo/bin/naga (a bare `naga` on PATH is a game).
// ============================================================================
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as R from './render.js';

const NAGA = process.env.NAGA || join(homedir(), '.cargo/bin/naga');
const pairs = [['SHEET_VS', 'vert'], ['SHEET_FS', 'frag'], ['LINE_VS', 'vert'], ['LINE_FS', 'frag'], ['HEAD_VS', 'vert'], ['HEAD_FS', 'frag'],
  ['MESH_VS', 'vert'], ['MESH_FS', 'frag'], ['SPRITE_VS', 'vert'], ['SPRITE_FS', 'frag']];

export function toVulkan(src, stage) {
  let s = src.replace('#version 300 es', '#version 450').replace(/^\s*precision\s+\w+\s+\w+\s*;\s*$/m, '');
  const block = [], samplers = [];
  let binding = 1;
  s = s.replace(/^\s*uniform\s+(\w+)\s+([^;]+);\s*$/gm, (m, type, names) => {
    if (type === 'sampler2D') return names.split(',').map(n => { n = n.trim(); samplers.push(n); return `layout(set = 0, binding = ${binding++}) uniform texture2D ${n}_t;\nlayout(set = 0, binding = ${binding++}) uniform sampler ${n}_s;`; }).join('\n');
    for (const n of names.split(',')) block.push(`  ${type} ${n.trim()};`);
    return '';
  });
  if (block.length) s = s.replace('#version 450', `#version 450\nlayout(set = 0, binding = 0) uniform U {\n${block.join('\n')}\n};`);
  let loc = { in: 0, out: 0 };
  s = s.replace(/^(\s*)(layout\(location\s*=\s*(\d+)\)\s*)?(in|out)\s+(\w+)\s+(\w+)\s*;/gm, (m, ind, lay, n, dir, type, name) => {
    if (lay) { loc[dir] = Math.max(loc[dir], +n + 1); return m; }
    const flat = /^(int|uint|ivec|uvec)/.test(type) ? 'flat ' : '';
    return `${ind}layout(location = ${loc[dir]++}) ${flat}${dir} ${type} ${name};`;
  });
  s = s.replace(/gl_VertexID/g, 'gl_VertexIndex');
  for (const n of samplers) s = s.replace(new RegExp(`texture\\(${n},`, 'g'), `texture(sampler2D(${n}_t, ${n}_s),`);
  return s;
}

const dir = mkdtempSync(join(tmpdir(), 't24-glsl-'));
let fail = 0;
try {
  for (const [name, stage] of pairs) {
    const file = join(dir, `${name}.${stage}`);
    writeFileSync(file, toVulkan(R[name], stage));
    try {
      execFileSync(NAGA, ['--input-kind', 'glsl', '--shader-stage', stage, file], { stdio: 'pipe' });
      console.log(`PASS  naga ${name}.${stage}`);
    } catch (e) {
      fail++;
      console.log(`FAIL  naga ${name}.${stage}\n${(e.stderr || e.stdout || e.message).toString().trim()}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pairs.length - fail} passed, ${fail} failed`);
if (fail) process.exit(1);

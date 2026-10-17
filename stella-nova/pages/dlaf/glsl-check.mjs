// ============================================================================
//  DLAF PAGE  ·  glsl-check.mjs — compile the WebGL2 shaders with glslang
// ----------------------------------------------------------------------------
//  No browser on this machine. glslangValidator (Khronos reference
//  compiler) reads "#version 300 es" as GLSL ES 3.00, so it checks the
//  syntax, the types, the ES precision rules and the link of each program
//  (-l: the uniforms that both stages declare must match). It does not
//  prove that ANGLE or Safari accept the code, but those front ends follow
//  the same specification.
//
//  USE   node glsl-check.mjs            (prints one line per program)
//        import { checkPrograms } from './glsl-check.mjs'   -> [{ name, ok, log }]
//  glslangValidator: /opt/homebrew/bin, PATH, or GLSLANG=/path/to/it.
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROGRAMS as SURFACE_PROGRAMS } from './surface-shaders.js';

export function findGlslang() {
  const c = [process.env.GLSLANG, '/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  try { return execFileSync('which', ['glslangValidator'], { encoding: 'utf8' }).trim() || null; } catch (e) { return null; }
}

export function checkPrograms(programs = SURFACE_PROGRAMS) {
  const bin = findGlslang();
  if (!bin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlaf-glsl-'));
  const out = [];
  try {
    for (const p of programs) {
      const vs = path.join(dir, p.name + '.vert'), fsP = path.join(dir, p.name + '.frag');
      fs.writeFileSync(vs, p.vs); fs.writeFileSync(fsP, p.fs);
      let ok = true, log = '';
      try { log = execFileSync(bin, ['-l', vs, fsP], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { ok = false; log = String(e.stdout || '') + String(e.stderr || ''); }
      out.push({ name: p.name, ok, log: log.trim() });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const res = checkPrograms();
  if (!res) { console.log('glslangValidator not found: skipped'); process.exit(0); }
  for (const r of res) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n' + r.log}`);
  process.exit(res.every(r => r.ok) ? 0 : 1);
}

// ============================================================================
//  BIOME PARTS  ·  gpu.js — the SDF lab's ray marcher, driven by the tape
// ----------------------------------------------------------------------------
//  REUSE. The renderer, the fixed WGSL frame (sphere tracing, clay and lit
//  shading, soft shadows, AO, the analytic grid, the ghost pass) and the
//  orbit camera are the SDF lab's own modules, imported unchanged:
//    ../../sdf-lab/js/render.js   createRenderer, addPane, drawPanes, destroy
//    ../../sdf-lab/js/shader.js   FRAME (fs_view, fs_slice, vs_main)
//    ../../sdf-lab/js/codegen.js  WGSL_MAT_LIB (the Sd material record)
//    ../../sdf-lab/js/camera.js   projection
//  The SDF lab compiles a new shader per document structure. Here the
//  structure never changes: WGSL_PART is an interpreter over the parameter
//  buffer, so the module compiles ONCE and every build step only writes the
//  buffer. That keeps the GPU memory flat for an all-night saver.
//
//  GREP MAP
//    SHADER ............ the one module: WGSL_PART + WGSL_MAT_LIB + FRAME
//    compileOnce ....... setStructure without a document
//    packUniform ....... one view's struct U (the SDF lab's packPane layout)
//    createPartRenderer  renderer + compiled pipelines + one P buffer
// ============================================================================
import { createRenderer, UNIFORM_FLOATS } from '../../sdf-lab/js/render.js';
import { FRAME } from '../../sdf-lab/js/shader.js';
import { WGSL_MAT_LIB } from '../../sdf-lab/js/codegen.js';
import { projection } from '../../sdf-lab/js/camera.js';
import { WGSL_PART, MAX_OPS, OP_SLOTS } from './part.js';

export const SHADER = WGSL_PART + WGSL_MAT_LIB + FRAME;
export const P_FLOATS = (1 + MAX_OPS * OP_SLOTS) * 4;
export { UNIFORM_FLOATS };

// The SDF lab's setStructure, for a module that does not come from a document.
async function compileOnce(R) {
  const dev = R.device;
  dev.pushErrorScope('validation');
  const module = dev.createShaderModule({ code: SHADER, label: 'biome-parts' });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  const scoped = await dev.popErrorScope();
  if (errs.length || scoped) throw new Error('shader: ' + (errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n') || scoped.message));
  const desc = entry => ({ layout: R.layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: entry, targets: [{ format: R.format }] }, primitive: { topology: 'triangle-list' } });
  const [view, slice] = await Promise.all([dev.createRenderPipelineAsync(desc('fs_view')), dev.createRenderPipelineAsync(desc('fs_slice'))]);
  R.pipe = { view, slice, sig: 'biome-parts', code: SHADER, ms: 0, lines: SHADER.split('\n').length };
}
export async function createPartRenderer(onLost) {
  const R = await createRenderer(onLost);
  R.ensureP(P_FLOATS / 4);
  await compileOnce(R);
  return R;
}

// o: { mode 0 clay | 1 lit, grid, axes, shadows, sel [a, b], ghost, scene [x, y, z, r], maxSteps, time }
export function packUniform(u, cam, w, h, o = {}) {
  const P = projection(cam, w, h, false);
  u.fill(0);
  u.set([w, h, 1, (o.time || 0)], 0);
  u.set([...P.eye, 0], 4);
  u.set([...P.right, P.tan], 8);
  u.set([...P.up, o.mode ?? 1], 12);
  u.set([...P.fwd, o.maxSteps || 140], 16);
  u.set([0, o.grid === false ? 0 : 1, o.axes ? 1 : 0, 0], 20);
  u.set([1, 0, 0, o.shadows === false ? 0 : 1], 24);
  const sel = o.sel || [-9, -9];
  u.set([sel[0], sel[1], -9, o.ghost ?? -1], 28);
  u.set([0.9, cam.dist * 3 + 80, o.ghost >= 0 ? 1 : 0, 1], 32);
  u.set([0, 1, 0, 0], 36); u.set([1, 0, 0, 0], 40); u.set([0, 0, 1, 0], 44); u.set([3, 0, 0, 0], 48);
  u.set(o.scene || [0, 0, 0, -1], 52);
  return u;
}

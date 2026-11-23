// surface.js: the jump flood on the ionization front (WebGL2 bake).
// Owner: row A5. Spec: nebula-spec.md 2.13.5, 2.11.3, 2.2 (Seed, Jd, Jr), 3.7 item 3.
//
// Exports (grep -n "^export"):
//   JFA_OFFSETS                         [32, 16, 8, 4, 2, 1, 1] voxels (7 jump passes)
//   jfaChunks(ctx, state, opts)         generator: Init, Jump x 7, Resolve, Curv
//
// Input: state.LA (or state.LA0), the full-resolution light texture. f = B_min - 1 (LA.x - 1).
// Output: state.Jd = (seed offset xyz px, signed distance d px), RGBA16F, linear, on the LA grid.
//         d < 0 on the ionized side. |d| is clamped to 256 px.
//         state.Jr = front curvature radius px, R16F, linear, clamped to [4, 400].
// Scratch: state.Seed0, state.Seed1 (RGBA16F, nearest). This module releases both at the end (3.7 item 3).
// Geometry: box px = state.boxPx if it is set (dev pages), else BOX_PX. The cell is box / LA dims.
// The generator yields { stage, pass, of } after each full-volume pass.

import { program } from '../gl/context.js';
import { runSlicePass } from '../gl/passes.js';
import { BOX_PX } from './radiation.js';
import { JFA_INIT_FS, JFA_JUMP_FS, JFA_RESOLVE_FS, JFA_CURV_FS } from './shaders/jfa.glsl.js';

export const JFA_OFFSETS = [32, 16, 8, 4, 2, 1, 1];

const programs = new WeakMap();   // gl -> { init, jump, resolve, curv }

function progs(gl) {
  let p = programs.get(gl);
  if (!p) {
    p = {
      init: program(gl, 'JfaInit', null, JFA_INIT_FS),
      jump: program(gl, 'JfaJump', null, JFA_JUMP_FS),
      resolve: program(gl, 'JfaResolve', null, JFA_RESOLVE_FS),
      curv: program(gl, 'JfaCurv', null, JFA_CURV_FS),
    };
    programs.set(gl, p);
  }
  return p;
}

function entry(ctx, v, label) {
  const e = typeof v === 'string' ? ctx.registry.get(v) : v;
  if (!e || !e.tex) throw new Error(`[surface] ${label} is not live`);
  return e;
}

function make(ctx, state, name, dims, fmt, filter) {
  const e = ctx.registry.tex3D(name, dims, fmt, { filter, wrapX: 'repeat' });
  state[name] = e;
  return e;
}

export function* jfaChunks(ctx, state, opts) {
  const o = opts || {};
  const P = progs(ctx.gl);
  const la = entry(ctx, state.LA || state.LA0, 'state.LA');
  const dims = [la.w, la.h, la.d];
  const box = state.boxPx || BOX_PX;
  const cell = [box[0] / dims[0], box[1] / dims[1], box[2] / dims[2]];
  const offsets = o.offsets || JFA_OFFSETS;
  const of = offsets.length + 3;
  const base = { _Dims: dims, _Cell: cell };

  const seeds = [make(ctx, state, 'Seed0', dims, 'RGBA16F', 'nearest'), make(ctx, state, 'Seed1', dims, 'RGBA16F', 'nearest')];
  try {
    runSlicePass(ctx, P.init, { targets: seeds[0], uniforms: base, textures: { _LA: la } });
    yield { stage: 'jfaInit', pass: 1, of };
    let cur = 0;
    for (let i = 0; i < offsets.length; i++) {
      runSlicePass(ctx, P.jump, {
        targets: seeds[1 - cur], uniforms: { ...base, _K: offsets[i] }, textures: { _Src: seeds[cur] },
      });
      cur = 1 - cur;
      yield { stage: 'jfaJump', pass: 2 + i, of };
    }
    const jd = make(ctx, state, 'Jd', dims, 'RGBA16F', 'linear');
    runSlicePass(ctx, P.resolve, { targets: jd, uniforms: base, textures: { _Src: seeds[cur], _LA: la } });
    yield { stage: 'jfaResolve', pass: of - 1, of };
    const jr = make(ctx, state, 'Jr', dims, 'R16F', 'linear');
    runSlicePass(ctx, P.curv, { targets: jr, uniforms: base, textures: { _Jd: jd } });
    yield { stage: 'jfaCurv', pass: of, of };
  } finally {
    ctx.registry.release('Seed0'); delete state.Seed0;
    ctx.registry.release('Seed1'); delete state.Seed1;
  }
  const diag = (state.diag = state.diag || {});
  (diag.radiation = diag.radiation || {}).jfa = { dims, offsets, cellPx: cell };
}

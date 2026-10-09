// shadergen.js - build the WGSL step program for a reaction-diffusion preset.
// DOM-free ES module. It runs in the browser, in Node, and in Deno.
//
// The preset gives a formula body in WGSL. This module puts the body inside a
// compute shader. The shader reads the current state, computes the operators
// that the body names, runs the body, and writes a forward-Euler step:
//   chem_new = chem + timestep * delta_chem
//
// Exports (grep -n "^export" shadergen.js):
//   buildStepShader(preset, opts)   full WGSL compute module, entry point `step`
//   paramSlots(preset)              ordered uniform slots [{name, value}]
//   packParams(slots, values, out)  fill a Float32Array(64) in slot order
//   usedOperators(formula)          which operators the body names
//   checkParamName(name)            null, or a reason the name is not legal
//   buildInitState(preset, w, h, seed)  Float32Array(w*h*4) from preset.init
//   RESERVED_NAMES                  names a param must not use
//
// Uniform layout (group 0, binding 0):
//   struct U { w:u32, h:u32, frame:u32, pad:u32, p: array<vec4<f32>,16> }
//   Slot i of paramSlots() is p[i / 4][i % 4]. 64 slots max.
// Binding 1 is the source texture_2d<f32> (rgba32float, not filterable).
// Binding 2 is the destination texture_storage_2d<rgba32float, write>.
//
// Body contract. In scope when the body runs:
//   a b c d                 `var` f32, the current values. The body can assign them.
//   delta_a .. delta_d      `var` f32 = 0.0. The body assigns them.
//   laplacian_*, bilaplacian_*, x_gradient_*, y_gradient_*, gradient_mag_squared_*
//                           only the ones the body names are computed.
//   x_pos, y_pos            cell center in [0,1): (i + 0.5) / w, (j + 0.5) / h
//   timestep, dx, and each param by name (a paramMap param comes from x_pos or y_pos)
//   rd_x, rd_y              i32 cell index
//   rd_ld(x, y) -> vec4<f32>  load a cell. It obeys wrap or clamp. Offsets up to +-2.
// Axes: +x = increasing column index. +y = increasing row index (down on screen).
// x_gradient, y_gradient, and the "south" neighbor rd_ld(rd_x, rd_y + 1) use these axes.
// The store writes chem + timestep * delta_chem for each used chemical, with
// the value of the chemical after the body ran. Unused chemicals keep their value.
//
// The entry point is named `step`. It hides the WGSL builtin step(), so a body
// must not call step(). Use select(0.0, 1.0, x >= edge) instead.

import { varyInit } from './vary.js';
export const MAX_PARAMS = 64;
const CHEMS = ['a', 'b', 'c', 'd'];
const COMP = ['x', 'y', 'z', 'w'];
const OPS = ['laplacian', 'bilaplacian', 'x_gradient', 'y_gradient', 'gradient_mag_squared'];

// WGSL keywords, reserved words, types, and builtin functions that a formula
// can hit. Plus the names that the generator puts in scope.
const WGSL_WORDS = `alias break case const const_assert continue continuing default diagnostic discard
else enable false fn for if let loop override requires return struct switch true var while
bool f16 f32 i32 u32 vec2 vec3 vec4 mat2x2 mat3x3 mat4x4 array atomic ptr sampler texture_2d
abs acos acosh asin asinh atan atan2 atanh ceil clamp cos cosh cross degrees determinant distance
dot exp exp2 faceForward floor fma fract frexp inverseSqrt ldexp length log log2 max min mix modf
normalize pow quantizeToF16 radians reflect refract round saturate sign sin sinh smoothstep sqrt
step tan tanh transpose trunc select all any arrayLength bitcast countOneBits dpdx dpdy fwidth
textureLoad textureStore textureSample textureDimensions workgroupBarrier storageBarrier
this self super new null nil in out inout mod as auto break_if handle target type typedef
unsafe unsigned signed static template namespace union public private protected module
precision packed uniform storage function workgroup read write read_write`.split(/\s+/);

const SCOPE_NAMES = ['a', 'b', 'c', 'd', 'x_pos', 'y_pos', 'timestep', 'dx', 'U', 'src', 'dst']
  .concat(CHEMS.map(c => 'delta_' + c))
  .concat(...OPS.map(op => CHEMS.map(c => op + '_' + c)));

export const RESERVED_NAMES = new Set(WGSL_WORDS.concat(SCOPE_NAMES));

export function checkParamName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return 'not a WGSL identifier';
  if (name.startsWith('rd_')) return 'prefix rd_ is kept for the generator';
  if (name === 'timestep' || name === 'dx') return null; // legal as a slot, see paramSlots
  if (RESERVED_NAMES.has(name)) return 'collides with a WGSL word or a name in scope';
  return null;
}

// Uniform slots in order. The preset params come first. If the preset has no
// param named `timestep` or `dx`, the module adds one from preset.timestep or
// preset.dx, so the step size and the grid spacing are always live uniforms.
export function paramSlots(preset) {
  const slots = (preset.params || []).map(p => ({ name: p.name, value: +p.value }));
  const has = n => slots.some(s => s.name === n);
  if (!has('timestep')) slots.push({ name: 'timestep', value: preset.timestep != null ? +preset.timestep : 1 });
  if (!has('dx')) slots.push({ name: 'dx', value: preset.dx != null ? +preset.dx : 1 });
  if (slots.length > MAX_PARAMS) throw new Error(`too many params: ${slots.length} > ${MAX_PARAMS}`);
  return slots;
}

// values: optional {name: number}. Missing names keep the slot default.
export function packParams(slots, values = {}, out = new Float32Array(MAX_PARAMS)) {
  slots.forEach((s, i) => { out[i] = values[s.name] != null ? +values[s.name] : s.value; });
  return out;
}

export function usedOperators(formula) {
  const used = {};
  for (const op of OPS) for (const c of CHEMS) {
    if (new RegExp('\\b' + op + '_' + c + '\\b').test(formula)) used[op + '_' + c] = true;
  }
  const any = op => CHEMS.some(c => used[op + '_' + c]);
  return {
    names: used,
    laplacian: any('laplacian'), bilaplacian: any('bilaplacian'),
    x_gradient: any('x_gradient'), y_gradient: any('y_gradient'),
    gradient_mag_squared: any('gradient_mag_squared'),
    x_pos: /\bx_pos\b/.test(formula), y_pos: /\by_pos\b/.test(formula),
  };
}

const f = v => { const s = String(+v); return /[.eE]/.test(s) ? s : s + '.0'; };

export function buildStepShader(preset, opts = {}) {
  const formula = String(preset.formula || '');
  const nchem = Math.max(1, Math.min(4, preset.chemicals | 0 || 1));
  const vertex = (preset.neighborhood || 'vertex') !== 'edge';
  const wrap = preset.wrap !== false;
  const slots = paramSlots(preset);
  for (const s of slots) {
    const why = checkParamName(s.name);
    if (why) throw new Error(`param "${s.name}": ${why}`);
  }
  const pm = opts.paramMap || null;
  const use = usedOperators(formula);
  const needCross = use.laplacian || use.bilaplacian || use.x_gradient || use.y_gradient || use.gradient_mag_squared;
  const needDiag = (use.laplacian && vertex) || use.bilaplacian;
  const needFar = use.bilaplacian;
  const needPos = use.x_pos || use.y_pos || !!pm;

  const L = [];
  L.push(`// Generated by shadergen.js. Forward-Euler reaction-diffusion step.`);
  L.push(`struct RDUniforms { w: u32, h: u32, frame: u32, pad: u32, p: array<vec4<f32>, 16> };`);
  L.push(`@group(0) @binding(0) var<uniform> U: RDUniforms;`);
  L.push(`@group(0) @binding(1) var src: texture_2d<f32>;`);
  L.push(`@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;`);
  L.push(``);
  L.push(`fn rd_ld(x: i32, y: i32) -> vec4<f32> {`);
  L.push(`  let w = i32(U.w);`);
  L.push(`  let h = i32(U.h);`);
  if (wrap) {
    // Offsets are at most 2 cells, so one add or subtract puts the index back in range.
    L.push(`  let xi = select(select(x, x - w, x >= w), x + w, x < 0);`);
    L.push(`  let yi = select(select(y, y - h, y >= h), y + h, y < 0);`);
  } else {
    L.push(`  let xi = clamp(x, 0, w - 1);`);
    L.push(`  let yi = clamp(y, 0, h - 1);`);
  }
  L.push(`  return textureLoad(src, vec2<i32>(xi, yi), 0);`);
  L.push(`}`);
  L.push(``);
  L.push(`@compute @workgroup_size(8, 8)`);
  L.push(`fn step(@builtin(global_invocation_id) rd_gid: vec3<u32>) {`);
  L.push(`  if (rd_gid.x >= U.w || rd_gid.y >= U.h) { return; }`);
  L.push(`  let rd_x = i32(rd_gid.x);`);
  L.push(`  let rd_y = i32(rd_gid.y);`);
  // Params. A paramMap param comes from the cell position, not from the uniform.
  slots.forEach((s, i) => {
    if (pm && (s.name === pm.x || s.name === pm.y)) return;
    L.push(`  let ${s.name}: f32 = U.p[${i >> 2}].${COMP[i & 3]};`);
  });
  if (needPos) {
    L.push(`  let x_pos: f32 = (f32(rd_x) + 0.5) / f32(U.w);`);
    L.push(`  let y_pos: f32 = (f32(rd_y) + 0.5) / f32(U.h);`);
  }
  if (pm) {
    if (pm.x) L.push(`  let ${pm.x}: f32 = mix(${f(pm.x0)}, ${f(pm.x1)}, x_pos);`);
    if (pm.y && pm.y !== pm.x) L.push(`  let ${pm.y}: f32 = mix(${f(pm.y0)}, ${f(pm.y1)}, y_pos);`);
  }
  L.push(`  let rd_c = rd_ld(rd_x, rd_y);`);
  if (needCross) {
    L.push(`  let rd_n = rd_ld(rd_x, rd_y - 1);`);
    L.push(`  let rd_s = rd_ld(rd_x, rd_y + 1);`);
    L.push(`  let rd_e = rd_ld(rd_x + 1, rd_y);`);
    L.push(`  let rd_w = rd_ld(rd_x - 1, rd_y);`);
    L.push(`  let rd_cross = rd_n + rd_s + rd_e + rd_w;`);
  }
  if (needDiag) {
    L.push(`  let rd_diag = rd_ld(rd_x + 1, rd_y - 1) + rd_ld(rd_x - 1, rd_y - 1) + rd_ld(rd_x + 1, rd_y + 1) + rd_ld(rd_x - 1, rd_y + 1);`);
  }
  if (needFar) {
    L.push(`  let rd_far = rd_ld(rd_x, rd_y - 2) + rd_ld(rd_x, rd_y + 2) + rd_ld(rd_x + 2, rd_y) + rd_ld(rd_x - 2, rd_y);`);
  }
  L.push(`  let rd_dx2 = dx * dx;`);
  if (use.laplacian) {
    if (vertex) L.push(`  let rd_lap = (4.0 * rd_cross + rd_diag - 20.0 * rd_c) / (6.0 * rd_dx2);`);
    else L.push(`  let rd_lap = (rd_cross - 4.0 * rd_c) / rd_dx2;`);
  }
  if (use.bilaplacian) {
    L.push(`  let rd_bilap = (20.0 * rd_c - 8.0 * rd_cross + 2.0 * rd_diag + rd_far) / (rd_dx2 * rd_dx2);`);
  }
  if (use.x_gradient || use.gradient_mag_squared) L.push(`  let rd_gx = (rd_e - rd_w) / (2.0 * dx);`);
  if (use.y_gradient || use.gradient_mag_squared) L.push(`  let rd_gy = (rd_s - rd_n) / (2.0 * dx);`);
  if (use.gradient_mag_squared) L.push(`  let rd_gm = rd_gx * rd_gx + rd_gy * rd_gy;`);
  // Chemicals are `var`: some formulas assign a chemical directly.
  CHEMS.forEach((ch, k) => {
    L.push(`  var ${ch}: f32 = rd_c.${COMP[k]};`);
  });
  const opVar = { laplacian: 'rd_lap', bilaplacian: 'rd_bilap', x_gradient: 'rd_gx', y_gradient: 'rd_gy', gradient_mag_squared: 'rd_gm' };
  for (const op of OPS) CHEMS.forEach((ch, k) => {
    if (use.names[op + '_' + ch]) L.push(`  let ${op}_${ch}: f32 = ${opVar[op]}.${COMP[k]};`);
  });
  CHEMS.forEach(ch => L.push(`  var delta_${ch}: f32 = 0.0;`));
  L.push(`  // ---- formula body ----`);
  for (const line of formula.split('\n')) L.push('  ' + line);
  L.push(`  // ---- end of formula body ----`);
  const outs = CHEMS.map((ch, k) => k < nchem ? `${ch} + timestep * delta_${ch}` : ch);
  L.push(`  textureStore(dst, vec2<i32>(rd_x, rd_y), vec4<f32>(${outs.join(', ')}));`);
  L.push(`}`);
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Initial state. The init list is applied in order on the CPU.
// Coordinates are in [0,1], x right, y down (y = row / h). `chem` is a..d.
//   {op:"fill",  chem, value, region?}                 constant
//   {op:"set",   chem, value, region}                  constant in a region
//   {op:"noise", chem, low, high, region?}             uniform random in [low,high)
//   {op:"gauss", chem, amplitude, center:[x,y], sigma, region?}   Gaussian bump
//   {op:"sine",  chem, amplitude, offset?, kx, ky, phase?, region?}
//                value = offset + amplitude * sin(2 pi (kx x + ky y) + phase)
//   {op:"linear", chem, x0, y0, x1, y1, v0, v1, region?}
//                value = v0 + (v1 - v0) * u. u is the projection of (x,y)-(x0,y0)
//                on the axis (x0,y0)->(x1,y1), divided by the axis length. No clamp.
//   {op:"copy",  chem, from, scale?=1, offset?=0, region?}   value = offset + scale * from
//   {op:"add",   chem, value, region?}                 same as fill with mode "add"
//   {op:"spots", chem, value, count, radius, seed?}    random discs (wrap aware)
// Every op except spots takes "mode": "set" (default) | "add" | "mul".
// The value combines with the old cell value: set -> v, add -> old + v, mul -> old * v.
// The legacy flag add:true is the same as mode "add".
// Regions: {rect:[x0,y0,x1,y1]} | {circle:[cx,cy,r]} | {ring:[cx,cy,r0,r1]}
//          | {halfplane:"left"|"right"|"top"|"bottom"}. No region = every cell.
// A circle or ring radius is a fraction of the grid width.
// The noise uses a seeded PRNG (mulberry32), so a seed gives the same state.
// vary.js moves, turns, scales and copies the geometry by the same seed.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function regionTest(region, w, h) {
  if (!region) return null;
  const aspect = h / w;
  if (region.rect) {
    const [x0, y0, x1, y1] = region.rect;
    return (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
  }
  if (region.circle) {
    const [cx, cy, r] = region.circle;
    return (x, y) => { const dx = x - cx, dy = (y - cy) * aspect; return dx * dx + dy * dy < r * r; };
  }
  if (region.ring) {
    const [cx, cy, r0, r1] = region.ring;
    return (x, y) => { const dx = x - cx, dy = (y - cy) * aspect, d = Math.hypot(dx, dy); return d >= r0 && d < r1; };
  }
  if (region.halfplane) {
    const hp = region.halfplane;
    return (x, y) => hp === 'left' ? x < 0.5 : hp === 'right' ? x >= 0.5 : hp === 'top' ? y < 0.5 : y >= 0.5;
  }
  throw new Error('unknown region: ' + JSON.stringify(region));
}

export function buildInitState(preset, w, h, seed = 1) {
  const data = new Float32Array(w * h * 4);
  const rand = mulberry32(seed);
  const aspect = h / w;
  // the start geometry varies with the seed (vary.js); FIXED presets keep theirs
  for (const op of varyInit(preset, seed)) {
    const k = CHEMS.indexOf(op.chem || 'a');
    if (k < 0) throw new Error('unknown chem: ' + op.chem);
    const inside = regionTest(op.region, w, h);
    const mode = op.mode || (op.add ? 'add' : op.op === 'add' ? 'add' : 'set');
    if (!['set', 'add', 'mul'].includes(mode)) throw new Error('unknown init mode: ' + mode);
    const each = fn => {
      for (let j = 0; j < h; j++) {
        const y = (j + 0.5) / h;
        for (let i = 0; i < w; i++) {
          const x = (i + 0.5) / w;
          if (inside && !inside(x, y)) continue;
          const base = (j * w + i) * 4;
          const old = data[base + k];
          const v = fn(x, y, base);
          data[base + k] = mode === 'set' ? v : mode === 'add' ? old + v : old * v;
        }
      }
    };
    switch (op.op) {
      case 'fill': case 'set': case 'add': { const v = +op.value; each(() => v); break; }
      case 'noise': {
        const lo = op.low != null ? +op.low : 0, hi = op.high != null ? +op.high : 1;
        each(() => lo + (hi - lo) * rand());
        break;
      }
      case 'gauss': {
        const [cx, cy] = op.center || [0.5, 0.5];
        const s2 = 2 * (op.sigma || 0.05) ** 2, amp = +op.amplitude;
        each((x, y) => amp * Math.exp(-((x - cx) ** 2 + ((y - cy) * aspect) ** 2) / s2));
        break;
      }
      case 'sine': {
        const amp = +op.amplitude, off = +(op.offset || 0), kx = +(op.kx || 0), ky = +(op.ky || 0), ph = +(op.phase || 0);
        each((x, y) => off + amp * Math.sin(2 * Math.PI * (kx * x + ky * y) + ph));
        break;
      }
      case 'linear': {
        const x0 = +(op.x0 || 0), y0 = +(op.y0 || 0), x1 = op.x1 != null ? +op.x1 : 1, y1 = op.y1 != null ? +op.y1 : 0;
        const v0 = +(op.v0 || 0), v1 = op.v1 != null ? +op.v1 : 1;
        const ax = x1 - x0, ay = y1 - y0, len2 = ax * ax + ay * ay || 1;
        each((x, y) => v0 + (v1 - v0) * (((x - x0) * ax + (y - y0) * ay) / len2));
        break;
      }
      case 'copy': {
        const kf = CHEMS.indexOf(op.from);
        if (kf < 0) throw new Error('unknown copy source: ' + op.from);
        const sc = op.scale != null ? +op.scale : 1, off = +(op.offset || 0);
        each((x, y, base) => off + sc * data[base + kf]);
        break;
      }
      case 'spots': {
        const r2 = (op.radius || 0.03) ** 2, n = op.count | 0, sr = op.seed != null ? mulberry32(op.seed) : rand;
        const cs = Array.from({ length: n }, () => [sr(), sr()]);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const x = (i + 0.5) / w, y = (j + 0.5) / h;
          for (const [cx, cy] of cs) {
            let dx = Math.abs(x - cx), dy = Math.abs(y - cy);
            if (preset.wrap !== false) { dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy); }
            dy *= aspect;
            if (dx * dx + dy * dy < r2) { data[(j * w + i) * 4 + k] = +op.value; break; }
          }
        }
        break;
      }
      default: throw new Error('unknown init op: ' + op.op);
    }
  }
  return data;
}

// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/frame-wgsl.js — WGSL frame pass and its uniform
// ────────────────────────────────────────────────────────────────────────────
//  The frame pass maps the cell texture onto the studio tile: zoom, rotate,
//  offset, tile mode, matte, value channel and sRGB decode. The runner
//  compiles FRAME_WGSL. The fallback inlines FRAME_FNS with tiledStatic.
//
//  GREP TARGETS  (grep -n the name to jump)
//      FRAME_STRUCT / FRAME_FNS / TILE_BODY / tiledStatic / TILED_DYNAMIC
//      FRAME_WGSL / frameUniform
// ============================================================================
import { BENCH_PALETTE, hexToRgb } from '../../../../lib/bench-wgsl.js';
import { TILE_MODES, VALUE_MODES } from './catalog.js';

// The frame pass maps the cell texture onto the studio tile. FrameU:
//   xf  = (1/zoom, cos rot, sin rot, 1/res)
//   off = (offset.x, offset.y, seam blend width, tile mode 0 none 1 seamless 2 mirror 3 repeat)
//   m   = (decode 0 raw 1 srgb, value 0 luma 1 alpha 2 red 3 max, matte 0 keep 1 ink, coord out 0 no 1 uv 2 raw)
//   ink = matte color
// FRAME_FNS needs a function bfr_src(q: vec2f) -> vec4f (the cell at cell uv q).
export const FRAME_STRUCT = `struct BenchFrameU { xf: vec4f, off: vec4f, m: vec4f, ink: vec4f }\n`;
export const FRAME_FNS = `
fn bfr_at(t: vec2f) -> vec4f {
    let c = t - vec2f(0.5);
    let r = vec2f((c.x * bfu.xf.y) + (c.y * bfu.xf.z), (c.y * bfu.xf.y) - (c.x * bfu.xf.z)) * bfu.xf.x;
    return bfr_src((r + vec2f(0.5)) - bfu.off.xy);
}
fn bfr_win(x: f32) -> f32 { return 1.0 - smoothstep(0.0, max(bfu.off.z, 0.0001), min(x, 1.0 - x)); }
fn bfr_row(t: vec2f) -> vec4f { return mix(bfr_at(t), bfr_at(vec2f(fract(t.x + 0.5), t.y)), bfr_win(t.x)); }
fn bfr_srgb(c: vec3f) -> vec3f {
    let lo = c / 12.92;
    let hi = pow((max(c, vec3f(0.0)) + vec3f(0.055)) / 1.055, vec3f(2.4));
    return select(hi, lo, c <= vec3f(0.04045));
}
fn bfr_finish(c: vec4f) -> vec4f {
    if (bfu.m.w > 0.5) {
        let q = select(c.xy, (c.xy * 0.5) + vec2f(0.5), bfu.m.w < 1.5);
        return vec4f(q, c.z, 1.0);
    }
    var rgb = c.rgb;
    if (bfu.m.z > 0.5) { rgb = rgb + (bfu.ink.rgb * (1.0 - clamp(c.a, 0.0, 1.0))); }
    let vm = i32(bfu.m.y + 0.5);
    var v = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
    if (vm == 1) { v = c.a; } else if (vm == 2) { v = rgb.r; } else if (vm == 3) { v = max(rgb.r, max(rgb.g, rgb.b)); }
    if (bfu.m.x > 0.5) { rgb = bfr_srgb(rgb); }
    return vec4f(rgb, v);
}
`;
// The tile body per mode. The runner branches on bfu.off.w at run time. The
// fallback emits one branch-free body (tiledStatic), because a cell that
// calls fwidth must stay in uniform control flow.
const TILE_BODY = [
  'return bfr_at(uv);',
  'let t = fract(uv); return mix(bfr_row(t), bfr_row(vec2f(t.x, fract(t.y + 0.5))), bfr_win(t.y));',
  'let t = vec2f(1.0) - abs((fract(uv) * 2.0) - vec2f(1.0)); return bfr_at(t);',
  'return bfr_at(fract(uv));',
];
export const tiledStatic = mode => `fn bfr_tiled(uv: vec2f) -> vec4f { ${TILE_BODY[Math.max(0, TILE_MODES.indexOf(mode))]} }\n`;
const TILED_DYNAMIC = `
fn bfr_tiled(uv: vec2f) -> vec4f {
    let mode = i32(bfu.off.w + 0.5);
    if (mode == 1) { ${TILE_BODY[1]} }
    if (mode == 2) { ${TILE_BODY[2]} }
    if (mode == 3) { ${TILE_BODY[3]} }
    ${TILE_BODY[0]}
}
`;
export const FRAME_WGSL = FRAME_STRUCT + `
@group(0) @binding(0) var<uniform> bfu: BenchFrameU;
@group(0) @binding(1) var bfr_tex: texture_2d<f32>;
@group(0) @binding(2) var bfr_smp: sampler;
fn bfr_src(q: vec2f) -> vec4f { return textureSampleLevel(bfr_tex, bfr_smp, q, 0.0); }
` + FRAME_FNS + TILED_DYNAMIC + `
@vertex fn vs_frame(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs_frame(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return bfr_finish(bfr_tiled(fract(fp.xy * bfu.xf.w)));
}
`;
/** FrameU floats for a def and values at output size res. tiling repeats
 *  the cell across the output (xf.w = tiling / res, then fract in fs_frame). */
export function frameUniform(def, v, res, tiling = 1) {
  const z = Math.max(+v.zoom || 1, 1e-3), a = (+v.rotate || 0) * Math.PI / 180, off = v.offset || [0, 0];
  const out = def.bench.out === 'coord';
  const ink = hexToRgb(v.ink || BENCH_PALETTE.ink);
  return new Float32Array([
    1 / z, Math.cos(a), Math.sin(a), tiling / res,
    +off[0] || 0, +off[1] || 0, Math.min(0.5, Math.max(0.0001, +v.edge || 0.18)), Math.max(0, TILE_MODES.indexOf(v.tile)),
    out ? 0 : (v.decode === 'srgb' ? 1 : 0), Math.max(0, VALUE_MODES.indexOf(v.value)), v.matte === 'keep' ? 0 : 1, out ? (v.outSpace === 'bench' ? 2 : 1) : 0,
    ink[0], ink[1], ink[2], 1,
  ]);
}

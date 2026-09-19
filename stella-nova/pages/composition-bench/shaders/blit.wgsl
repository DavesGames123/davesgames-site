struct GenU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    k: vec4f, x: vec4f,
}
@group(0) @binding(0) var<uniform> u: GenU;
struct BenchB { has0: f32, has1: f32, mode: f32, pad: f32 }
@group(0) @binding(1) var in0: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var in1: texture_2d<f32>;
@group(0) @binding(4) var<uniform> b: BenchB;
fn bench_p(fp: vec2f) -> vec2f { let pos = fp / u.pixelScale; return (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0) * 2.0; }

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn rail(v: f32) -> vec3f { let lo = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.62, v)); return mix(lo, u.cream.rgb, smoothstep(0.62, 1.0, v)); }
fn coord_view(q: vec2f) -> vec3f { let c = floor(q * 4.0); let ch = 0.35 + 0.3 * abs(fract((c.x + c.y) * 0.5) * 2.0 - 1.0); return mix(u.ink.rgb, u.tone.rgb, ch) + u.cream.rgb * 0.5 * (1.0 - smoothstep(0.0, 0.06, min(abs(fract(q.x * 4.0) - 0.5), abs(fract(q.y * 4.0) - 0.5)) * 2.0)); }
@fragment fn fs_blit(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = (fp.xy - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0) + 0.5;   // centre crop
    let c = textureSampleLevel(in0, smp, uv, 0.0);
    var rgb = c.rgb + u.ink.rgb * (1.0 - c.a);
    if (b.mode > 1.5) { rgb = coord_view(c.xy); } else if (b.mode > 0.5) { rgb = rail(clamp(c.r, 0.0, 1.0)); }
    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
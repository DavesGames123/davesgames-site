struct BenchB { has0: f32, has1: f32, mode: f32, pad: f32 }
@group(0) @binding(1) var in0: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var in1: texture_2d<f32>;
@group(0) @binding(4) var<uniform> b: BenchB;
fn bench_p(fp: vec2f) -> vec2f { let pos = fp / u.pixelScale; return (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0) * 2.0; }

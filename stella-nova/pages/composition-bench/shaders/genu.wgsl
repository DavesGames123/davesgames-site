struct GenU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    k: vec4f, x: vec4f,
}
@group(0) @binding(0) var<uniform> u: GenU;
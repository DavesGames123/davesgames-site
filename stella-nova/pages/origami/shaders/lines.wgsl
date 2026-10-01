// Screen-space anti-aliased line segments, one instanced quad per segment.
//
// A crease is a segment at any angle, which the axis-aligned quad pass cannot draw. This pass
// expands each segment into a quad of its width, in pixel space, and antialiases the long edges
// with one pixel of coverage. Both the flat crease pattern and the folded wireframe project to
// pixel segments on the CPU and draw through here.
//
// Web port (stella-nova/pages/origami): the one change from the native shader is
// the encode switch. screen.size.z is 1 when the canvas cannot take an sRGB view;
// the fragment then encodes linear to sRGB itself. With an sRGB view it is 0 and
// the hardware encodes, as on the native Bgra8UnormSrgb surface.

struct Screen { size: vec4<f32> };
@group(0) @binding(0) var<uniform> screen: Screen;

// Linear to sRGB, for a canvas without an sRGB view (web port).
fn encode_srgb(c: vec3<f32>) -> vec3<f32> {
    let lo = c * 12.92;
    let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, c <= vec3<f32>(0.0031308));
}

struct Inst {
    @location(0) a: vec2<f32>,
    @location(1) b: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) width: f32,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) perp: f32,
    @location(2) halfw: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, i: Inst) -> VsOut {
    let corner = vec2<f32>(
        f32(vi == 1u || vi == 2u || vi == 4u),
        f32(vi == 2u || vi == 4u || vi == 5u),
    );
    let t = corner.x;
    let s = corner.y * 2.0 - 1.0;
    let d = i.b - i.a;
    let len = max(length(d), 1e-6);
    let dir = d / len;
    let nrm = vec2<f32>(-dir.y, dir.x);
    let halfw = i.width * 0.5;
    let aa = 1.0;
    // Extend the ends by half the width for square caps, so segments meeting at a vertex close up.
    let along = mix(i.a, i.b, t) + dir * ((t * 2.0 - 1.0) * halfw);
    let pos = along + nrm * s * (halfw + aa);

    var o: VsOut;
    o.clip = vec4<f32>(
        (pos.x / screen.size.x) * 2.0 - 1.0,
        1.0 - (pos.y / screen.size.y) * 2.0,
        0.0,
        1.0,
    );
    o.color = i.color;
    o.perp = s * (halfw + aa);
    o.halfw = halfw;
    return o;
}

@fragment
fn fs(i: VsOut) -> @location(0) vec4<f32> {
    let a = clamp(i.halfw - abs(i.perp) + 0.5, 0.0, 1.0);
    if (screen.size.z > 0.5) {
        return vec4<f32>(encode_srgb(i.color.rgb), i.color.a * a);
    }
    return vec4<f32>(i.color.rgb, i.color.a * a);
}

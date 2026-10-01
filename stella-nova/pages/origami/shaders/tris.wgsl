// Flat-filled triangles in screen space, one instance per triangle.
//
// Each face of the sheet fills through here: a pastel tint in the crease pattern, a shaded pastel
// in the folded view. The three corners are projected to pixels on the CPU, so this shader only
// places them and writes the one colour. Multisampling antialiases the edges.
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
    @location(0) p0: vec2<f32>,
    @location(1) p1: vec2<f32>,
    @location(2) p2: vec2<f32>,
    @location(3) color: vec4<f32>,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, i: Inst) -> VsOut {
    var p: vec2<f32>;
    if (vi == 0u) {
        p = i.p0;
    } else if (vi == 1u) {
        p = i.p1;
    } else {
        p = i.p2;
    }
    var o: VsOut;
    o.clip = vec4<f32>((p.x / screen.size.x) * 2.0 - 1.0, 1.0 - (p.y / screen.size.y) * 2.0, 0.0, 1.0);
    o.color = i.color;
    return o;
}

@fragment
fn fs(i: VsOut) -> @location(0) vec4<f32> {
    if (screen.size.z > 0.5) {
        return vec4<f32>(encode_srgb(i.color.rgb), i.color.a);
    }
    return i.color;
}

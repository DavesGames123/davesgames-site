// composite.wgsl — the final pass to the canvas.
//
// color = RAMP(temperature) * brightness(speed) * (base glow + trail density).
// Land is black. A thin gray line follows the 0.5 coverage contour. A soft
// tone map moves the fastest water toward near-white. A soft vignette darkens
// the poster edges. A small dither stops banding.

struct CompU {
  size: vec2f,       // backing pixels
  legendF: vec2f,    // deg F at ramp 0 and ramp 1
  speedRef: f32,
  trailGain: f32,
  baseGlow: f32,
  exposure: f32,
  frame: f32,
  coast: f32,        // coast line strength
  vignette: f32,     // edge vignette strength
  brightFloor: f32,  // brightness of still water
  brightGamma: f32,  // brightness = floor + (1 - floor) * speed^gamma
  white: f32,        // how far the brightest water moves toward white
  hairWhite: f32,    // how far a dense trail moves toward white
  pastel: f32,       // how far every water color moves toward white
  speedWhite: f32,   // extra move toward white, times (speed / speedRef)^2
  fieldW: f32,       // field texture width in data pixels
  pad: f32,
};

@group(0) @binding(0) var<uniform> C: CompU;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var trail: texture_2d<f32>;
@group(0) @binding(4) var ramp: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn hash2(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / C.size;
  let f = textureSampleLevel(field, samp, uv, 0.0);
  let cov = f.w;
  // Screen-space gradient of the coverage gives the distance (in pixels) to
  // the 0.5 contour, so the coast line has the same width at all sizes.
  let g = length(vec2f(dpdx(cov), dpdy(cov)));
  let dCoast = abs(cov - 0.5) / max(g, 1e-4);
  // The gradient per data pixel tells a sharp coast (about 0.3 or more) from a
  // soft fade of the coverage (for example 1/40 at a model boundary).
  let gData = g * C.size.x / C.fieldW;
  let sharp = smoothstep(0.08, 0.2, gData);

  let spd = clamp(length(f.xy) / C.speedRef, 0.0, 1.6);
  let tF = f.z * 1.8 + 32.0;
  let tn = clamp((tF - C.legendF.x) / (C.legendF.y - C.legendF.x), 0.0, 1.0);
  let col = textureSampleLevel(ramp, samp, vec2f(tn * (255.0 / 256.0) + 0.5 / 256.0, 0.5), 0.0).rgb;

  let tr = textureLoad(trail, vec2i(fc.xy), 0).r;
  let dens = 1.0 - exp(-tr * C.trailGain);
  let bright = C.brightFloor + (1.0 - C.brightFloor) * pow(spd, C.brightGamma);
  // Pastel: move the ramp color toward white, more for fast water.
  let pc = mix(col, vec3f(1.0), clamp(C.pastel + C.speedWhite * spd * spd, 0.0, 0.85));
  let hair = mix(pc, vec3f(1.0), dens * C.hairWhite);
  var e = bright * (pc * C.baseGlow + hair * dens) * C.exposure;
  // Tone map: soft shoulder per channel, then lift bright water toward white.
  let lum = dot(e, vec3f(0.3, 0.55, 0.15));
  var c = vec3f(1.0) - exp(-e);
  c = mix(c, vec3f(1.0), smoothstep(0.9, 3.0, lum) * C.white);
  // A sharp coast gets a crisp mask. A soft coverage fade keeps its ramp.
  c *= mix(clamp(cov, 0.0, 1.0), smoothstep(0.35, 0.75, cov), sharp);

  // Faint coast line, only where the water is dark.
  let line = (1.0 - smoothstep(0.4, 1.3, dCoast)) * sharp * C.coast;
  c = max(c, vec3f(line));

  // Soft vignette at the poster edges.
  let edge = min(min(uv.x, 1.0 - uv.x) * C.size.x, min(uv.y, 1.0 - uv.y) * C.size.y) / C.size.y;
  let vig = mix(1.0, smoothstep(0.0, 0.05, edge), C.vignette);
  let rad = length((uv - 0.5) * vec2f(1.0, 0.85));
  c *= vig * (1.0 - C.vignette * 0.22 * smoothstep(0.45, 0.8, rad));

  c += (hash2(fc.xy + C.frame * 17.0) - 0.5) / 255.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}

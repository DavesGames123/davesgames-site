// ============================================================================
//  MATERIAL STUDIO  ·  shaders/viewport-bg.wgsl — background and ground
// ────────────────────────────────────────────────────────────────────────────
//  viewport.js prepends viewport-common.wgsl and the generated env chunk.
//  Both programs draw inside the main HDR pass, before the mesh.
//
//  ENTRY POINTS
//      vs_bg / fs_bg ........ full-screen triangle at the far plane:
//                             env_background (from the env chunk), solid,
//                             checker or gradient
//      vs_ground / fs_ground  a shadow catcher quad at height F.bgB.y: key
//                             light shadow, a soft contact blob, optional grid.
//                             Premultiplied output that darkens what is behind.
// ============================================================================

struct BgOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
}

@vertex
fn vs_bg(@builtin(vertex_index) i: u32) -> BgOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - vec2f(1.0);
  var o: BgOut;
  o.clip = vec4f(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}

fn view_dir(ndc: vec2f) -> vec3f {
  let w = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize((w.xyz / w.w) - F.camPos.xyz);
}

@fragment
fn fs_bg(v: BgOut) -> @location(0) vec4f {
  let mode = i32(F.bgA.w + 0.5);
  let px = v.clip.xy;
  if (mode == 1) { return vec4f(F.bgA.rgb, 1.0); }
  if (mode == 2) {
    let g = floor(px / 12.0);
    let c = f32((i32(g.x) + i32(g.y)) & 1);
    return vec4f(vec3f(mix(0.045, 0.085, c)), 1.0);
  }
  if (mode == 3) {
    let uv = px * F.viewport.zw;
    let r = length(uv - vec2f(0.5, 0.42));
    let top = mix(vec3f(0.09, 0.1, 0.12), vec3f(0.025, 0.028, 0.034), uv.y);
    return vec4f(top * (1.0 - (0.55 * r * r)), 1.0);
  }
  return vec4f(env_background(view_dir(v.ndc)), 1.0);
}

struct GroundOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
}

const GROUND_HALF: f32 = 8.0;

@vertex
fn vs_ground(@builtin(vertex_index) i: u32) -> GroundOut {
  var c = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let q = c[i] * GROUND_HALF;
  let w = vec3f(q.x, F.bgB.y, q.y);
  var o: GroundOut;
  o.clip = F.viewProj * vec4f(w, 1.0);
  o.world = w;
  return o;
}

@fragment
fn fs_ground(v: GroundOut) -> @location(0) vec4f {
  // derivatives first, in uniform control flow
  let g = v.world.xz * 4.0;
  let fw = fwidth(g);
  let above = select(0.0, 1.0, F.camPos.y > (F.bgB.y + 0.01));
  let r = length(v.world.xz);
  let fade = (1.0 - smoothstep(2.0, GROUND_HALF, r)) * above;
  var a = 0.0;
  var col = vec3f(0.0);
  if (F.bgB.z > 0.5) {
    let lit = shadow_key(v.world, vec3f(0.0, 1.0, 0.0));
    let blob = exp(-(r * r) / 0.55) * 0.45;
    a = max((1.0 - lit) * 0.7 * F.params.z, blob) * fade;
  }
  if (F.bgB.w > 0.5) {
    let line = abs(fract(g - vec2f(0.5)) - vec2f(0.5)) / max(fw, vec2f(1e-4));
    let l = 1.0 - min(min(line.x, line.y), 1.0);
    let major = abs(fract((g / 4.0) - vec2f(0.5)) - vec2f(0.5)) / max(fw / 4.0, vec2f(1e-4));
    let m = 1.0 - min(min(major.x, major.y), 1.0);
    let ga = max(l * 0.18, m * 0.4) * fade;
    col = vec3f(0.35, 0.5, 0.7) * ga * F.env.y;
    a = max(a, ga * 0.3);
  }
  return vec4f(col, a);
}

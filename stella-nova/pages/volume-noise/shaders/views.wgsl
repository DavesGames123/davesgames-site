// ============================================================================
//  VOLUME NOISE  ·  shaders/views.wgsl — slice, tiles and volume cube
// ----------------------------------------------------------------------------
//  gpu.js compiles common.wgsl + this file. Three fragment entry points,
//  one per view. Each frames its subject in the clear area u.rect, so the
//  control panel, the phone sheet or the screensaver plate never covers it.
//
//    fs_slice .... one z slice of the channel as a square
//    fs_tiles .... the same slice repeated; u.view.z tiles across (1 = one
//                  tile, 3 = the 3 x 3 grid); u.view.w draws the tile seams
//    fs_volume ... the 3D texture in a unit cube, ray-marched with emission
//                  and absorption; the camera orbits the cube
// ============================================================================

fn subject_square(px: vec2f, k: f32) -> vec3f {
  // xy = 0..1 across the square, z = the square side in px
  let side = min(u.rect.z, u.rect.w) * k;
  let c = u.rect.xy + 0.5 * u.rect.zw;
  return vec3f((px - (c - 0.5 * side)) / side, side);
}

fn frame_line(uv: vec2f, side: f32) -> f32 {
  let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * side;
  return 1.0 - smoothstep(0.0, 1.5, abs(e));
}

@fragment
fn fs_slice(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let sq = subject_square(fc.xy, 0.88);
  let uv = sq.xy;
  var col = backdrop(fc.xy);
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    col = ramp(channel(i32(u.view.x), vec3f(uv, u.view.y)));
  }
  col = mix(col, vec3f(0.59, 0.78, 1.0), 0.55 * frame_line(uv, sq.z));
  return vec4f(col * u.res.w, 1.0);
}

@fragment
fn fs_tiles(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let sq = subject_square(fc.xy, 0.92);
  let uv = sq.xy;
  var col = backdrop(fc.xy);
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    let span = u.view.z;
    let t = (uv - 0.5) * span + 0.5;
    col = ramp(channel(i32(u.view.x), vec3f(t, u.view.y)));
    // Seam lines on the integer tile borders, 1.5 px wide at any span.
    let g = abs(t - round(t)) * sq.z / span;
    let seam = 1.0 - smoothstep(0.6, 1.6, min(g.x, g.y));
    col = mix(col, vec3f(1.0, 0.78, 0.2), seam * u.view.w);
  }
  col = mix(col, vec3f(0.59, 0.78, 1.0), 0.55 * frame_line(uv, sq.z));
  return vec4f(col * u.res.w, 1.0);
}

// Entry and exit distance of a ray through the cube [-0.5, 0.5]^3.
fn box_hit(ro: vec3f, rd: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let t0 = (vec3f(-0.5) - ro) * inv;
  let t1 = (vec3f(0.5) - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2f(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// 1 on a cube edge: two of the three coordinates at the face (|p| = 0.5).
fn edge_mask(p: vec3f, w: f32) -> f32 {
  let a = smoothstep(vec3f(0.5 - w), vec3f(0.5), abs(p));
  return max(max(a.x * a.y, a.y * a.z), a.x * a.z);
}

@fragment
fn fs_volume(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ro = u.eye.xyz;
  let rd = camera_ray(fc.xy);
  var col = backdrop(fc.xy);
  let h = box_hit(ro, rd);
  if (h.y > max(h.x, 0.0)) {
    let t0 = max(h.x, 0.0);
    let n = 160;
    let dt = (h.y - t0) / f32(n);
    var t = t0 + dt * pix_hash(fc.xy);
    var T = 1.0;
    var acc = vec3f(0.0);
    let c = i32(u.view.x);
    let thr = u.vol.x;
    for (var i = 0; i < n; i++) {
      let p = ro + rd * t;
      let v = channel(c, p + 0.5);
      let d = max(v - thr, 0.0) / max(1.0 - thr, 1e-3);
      if (d > 0.0) {
        let sigma = d * u.vol.y * 9.0;
        let a = 1.0 - exp(-sigma * dt);
        var e = ramp(v);
        if (u.vol.z < 0.5) { e = mix(vec3f(0.35, 0.5, 0.75), vec3f(1.0, 0.97, 0.9), v); }
        acc += T * a * e;
        T *= 1.0 - a;
        if (T < 0.01) { break; }
      }
      t += dt;
    }
    col = col * T + acc;
    // Cube edges: front edges bright, back edges dim.
    let w = 0.0045 * length(ro);
    let front = edge_mask(ro + rd * t0, w);
    let back = edge_mask(ro + rd * h.y, w);
    col = mix(col, vec3f(0.59, 0.78, 1.0), u.misc.x * max(0.8 * front, 0.3 * back * T));
  }
  return vec4f(col * u.res.w, 1.0);
}

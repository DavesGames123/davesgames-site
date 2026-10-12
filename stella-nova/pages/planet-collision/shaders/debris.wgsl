// ============================================================================
//  PLANET COLLISION  ·  shaders/debris.wgsl — ejecta fragments, motion
//  streaks and the impact flash (after common.wgsl)
// ----------------------------------------------------------------------------
//    vs_rock + fs_rock      one instance per debris particle and fragment
//                           (instance = particle * F + f, F = U.mode.w):
//                           an octahedron with a random stretch per axis and
//                           a tumble, flat faces (the face normal comes from
//                           the three corners in the vertex shader). The
//                           first fragment is the particle; the others are
//                           smaller pieces round it. They are drawn, not
//                           simulated: the particle is the simulated mass.
//                           Colour: the body's surface map at the start
//                           position for crust pieces, rock, iron or ice
//                           inside, and the glow of fn glow at the
//                           particle temperature.
//    vs_streak + fs_streak  a line from x back to x - v * U.mode.z (the
//                           sim time of one frame: real motion blur), 1.3 px
//                           wide, additive: hot pieces trail their glow,
//                           cold ones a faint lit trail. Debris only.
//    vs_flash + fs_flash    up to 4 flashes (U.flash): a point of
//                           incandescent light where the bodies first touch
//                           (the page sets them from the stats).
//
//  grep -n targets: "fn rotQ", "fn vs_rock", "fn fs_rock", "fn vs_streak",
//  "fn fs_streak", "fn vs_flash", "fn fs_flash"
// ============================================================================

fn rotQ(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
fn randQuat(s: u32) -> vec4f {
  let u1 = hashU(s * 3u + 1u);
  let u2 = 6.2831853 * hashU(s * 3u + 2u);
  let u3 = 6.2831853 * hashU(s * 3u + 3u);
  let a = sqrt(1.0 - u1);
  let b = sqrt(u1);
  return vec4f(a * sin(u2), a * cos(u2), b * sin(u3), b * cos(u3));
}
fn axisAngle(ax: vec3f, ang: f32) -> vec4f { return vec4f(ax * sin(0.5 * ang), cos(0.5 * ang)); }
fn qmul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}

struct ROut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) nrm: vec3f,
  @location(1) @interpolate(flat) alb: vec4f,    // albedo, specular
  @location(2) @interpolate(flat) emit: vec3f,
};
fn octCorner(face: u32, k: u32) -> vec3f {
  let sx = select(1.0, -1.0, (face & 1u) != 0u);
  let sy = select(1.0, -1.0, (face & 2u) != 0u);
  let sz = select(1.0, -1.0, (face & 4u) != 0u);
  if (k == 0u) { return vec3f(sx, 0.0, 0.0); }
  if (k == 1u) { return vec3f(0.0, sy, 0.0); }
  return vec3f(0.0, 0.0, sz);
}
@vertex
fn vs_rock(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> ROut {
  var o: ROut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let F = max(u32(U0.mode.w + 0.5), 1u);
  let ii = inst / F;
  let f = inst % F;
  if (ii >= arrayLength(&pTag) || klass(ii) != K_DEBRIS) { return o; }
  let x = pPos[ii].xyz;
  if (removed(x)) { return o; }
  let s0 = spacing0(ii);
  let seed = ii * 8u + f;
  // size, stretch, place and tumble of this fragment
  var size = 0.9 * U0.surf.x * s0;
  var off = vec3f(0.0);
  if (f > 0u) {
    size = size * (0.28 + 0.3 * hashU(seed * 7u + 5u));
    let dir = normalize(vec3f(hashU(seed * 7u + 1u), hashU(seed * 7u + 2u), hashU(seed * 7u + 3u)) - 0.5 + vec3f(1e-4));
    off = dir * s0 * (0.7 + 0.9 * hashU(seed * 7u + 4u));
  }
  let stretch = vec3f(0.6, 0.6, 0.6) + 0.8 * vec3f(hashU(seed * 5u + 11u), hashU(seed * 5u + 12u), hashU(seed * 5u + 13u));
  let ax = normalize(vec3f(hashU(seed + 91u), hashU(seed + 92u), hashU(seed + 93u)) - 0.5 + vec3f(1e-4));
  let rate = 0.4 + 2.2 * hashU(seed + 94u);
  let q = qmul(axisAngle(ax, rate * U0.eye.w), randQuat(seed));
  let clusterQ = axisAngle(ax, 0.3 * rate * U0.eye.w);
  let centre = x + rotQ(clusterQ, off);
  let face = (vi / 3u) % 8u;
  let k = vi % 3u;
  let c0 = rotQ(q, octCorner(face, 0u) * stretch) * size;
  let c1 = rotQ(q, octCorner(face, 1u) * stretch) * size;
  let c2 = rotQ(q, octCorner(face, 2u) * stretch) * size;
  var cn = c0;
  if (k == 1u) { cn = c1; }
  if (k == 2u) { cn = c2; }
  var n = normalize(cross(c1 - c0, c2 - c0));
  if (dot(n, c0 + c1 + c2) < 0.0) { n = -n; }
  o.pos = U0.vp * vec4f(centre + cn, 1.0);
  o.nrm = n;
  // colour
  let mt = matOf(ii);
  let og = pOrig[ii].xyz;
  let style = i32(U0.bodies[min(bodyOf(ii), 3u)].x + 0.5);
  let fIron = select(0.0, 1.0, mt == 0u);
  let fIce = select(0.0, 1.0, mt == 3u);
  let T = pAux[ii].x;
  let mode = i32(U0.mode.x + 0.5);
  if (mode == 0) {
    let a = matAlbedo(og, fIron, fIce, style, 2.0);
    let Tm = tMelt(fIron, fIce);
    o.alb = vec4f(a.rgb * (1.0 - 0.7 * smoothstep(0.7 * Tm, Tm, T)) * (0.8 + 0.4 * hashU(seed + 17u)), 0.3 * fIron);
    // a small piece cools faster than the bulk; some carry a cold crust
    let crust = select(0.0, 1.0, hashU(seed + 29u) < crustShare());
    o.emit = glow(skinT(T, 0.25) * (1.0 - 0.55 * crust));
  } else {
    o.alb = vec4f(modeColor(mode, T, select(0.0, 1.0, bodyOf(ii) == 1u), 0.0, length(pVel[ii].xyz), fIron, fIce), 0.0);
    o.emit = vec3f(0.0);
  }
  return o;
}
@fragment
fn fs_rock(in: ROut) -> @location(0) vec4f {
  let L = U0.sun.xyz;
  let ndl = max(dot(in.nrm, L), 0.0);
  let mode = i32(U0.mode.x + 0.5);
  if (mode != 0) { return vec4f(in.alb.rgb * (0.3 + 0.7 * ndl), 1.0); }
  let col = in.alb.rgb * (U0.sun.w * ndl + U0.view.w) + in.emit + vec3f(in.alb.w * ndl * U0.sun.w * 0.3);
  return vec4f(col, 1.0);
}

// ── streaks ─────────────────────────────────────────────────────────────────
struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) col: vec3f,
  @location(1) along: f32,
  @location(2) across: f32,
};
@vertex
fn vs_streak(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (U0.mode.z <= 0.0 || ii >= arrayLength(&pTag) || klass(ii) != K_DEBRIS) { return o; }
  let x = pPos[ii].xyz;
  if (removed(x)) { return o; }
  let v = pVel[ii].xyz;
  let a = U0.vp * vec4f(x, 1.0);
  let b = U0.vp * vec4f(x - v * U0.mode.z, 1.0);
  if (a.w <= 1e-4 || b.w <= 1e-4) { return o; }
  let half = 0.5 * U0.vpSize.xy;
  let sa = a.xy / a.w * half;
  let sb = b.xy / b.w * half;
  let dv = sb - sa;
  let len = length(dv);
  if (len < 2.0) { return o; }
  let dir = dv / len;
  let nrm = vec2f(-dir.y, dir.x);
  var cs = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let c = cs[vi % 6u];
  let wpx = 0.65;
  let sp = sa + dv * c.x + nrm * c.y * wpx;
  let cw = mix(a, b, c.x);
  o.pos = vec4f(sp / half * cw.w, cw.z, cw.w);
  o.along = c.x;
  o.across = c.y;
  let T = pAux[ii].x;
  let mode = i32(U0.mode.x + 0.5);
  if (mode == 0) {
    let mt = matOf(ii);
    let fIron = select(0.0, 1.0, mt == 0u);
    let fIce = select(0.0, 1.0, mt == 3u);
    let style = i32(U0.bodies[min(bodyOf(ii), 3u)].x + 0.5);
    let alb = matAlbedo(pOrig[ii].xyz, fIron, fIce, style, 3.0).rgb;
    o.col = glow(skinT(T, 0.25)) * 0.55 + alb * U0.sun.w * 0.12;
  } else {
    o.col = 0.25 * modeColor(mode, T, select(0.0, 1.0, bodyOf(ii) == 1u), 0.0, length(v), select(0.0, 1.0, matOf(ii) == 0u), select(0.0, 1.0, matOf(ii) == 3u));
  }
  return o;
}
@fragment
fn fs_streak(in: LOut) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(0.55, 1.0, abs(in.across));
  let tail = 1.0 - in.along;
  return vec4f(in.col * edge * tail * tail, 0.0);
}

// ── impact flashes ──────────────────────────────────────────────────────────
struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec3f,
};
@vertex
fn vs_flash(@builtin(vertex_index) vi: u32, @builtin(instance_index) k: u32) -> FOut {
  var o: FOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let fl = U0.flash[k & 3u];
  if (fl.w <= 0.0) { return o; }
  let r = U0.flashR[k & 3u];
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = cs[vi % 6u];
  let toEye = normalize(U0.eye.xyz - fl.xyz);
  // in front of the surface it sits on, so the near half shows
  let w = fl.xyz + toEye * r + (c.x * U0.right.xyz + c.y * U0.up.xyz) * r;
  o.pos = U0.vp * vec4f(w, 1.0);
  o.uv = c;
  o.col = blackbody(U0.flashT[k & 3u]) * fl.w;
  return o;
}
@fragment
fn fs_flash(in: FOut) -> @location(0) vec4f {
  let d2 = dot(in.uv, in.uv);
  if (d2 >= 1.0) { discard; }
  let core = exp(-d2 * 18.0);
  let halo = 0.12 * (1.0 - d2) * (1.0 - d2);
  return vec4f(in.col * (core + halo), 0.0);
}

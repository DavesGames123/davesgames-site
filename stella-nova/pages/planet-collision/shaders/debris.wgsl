// ============================================================================
//  PLANET COLLISION  ·  shaders/debris.wgsl — ejecta fragments, motion
//  streaks and the impact flash (after common.wgsl, scene.wgsl)
// ----------------------------------------------------------------------------
//    vs_drop + fs_drop      one instance per debris particle and droplet
//                           (instance = particle * F + f, F = U.mode.w):
//                           a small sphere impostor (ray-sphere hit,
//                           frag_depth), radius 0.07-0.19 spacing, spread
//                           through the particle's volume and drawn out
//                           along its velocity. Many small dense drops,
//                           not a few big rocks; a debris clump also joins
//                           the iso surface of the volume (vol.wgsl). The
//                           drops are drawn, not simulated: the particle
//                           is the simulated mass. Colour: the body's
//                           surface map at the start position, rock, iron
//                           or ice inside, and the glow of fn glow. Lit
//                           by the sun light left at the drop (scene.wgsl
//                           fn sunAt: bodies and smoke); a drop behind the
//                           0.5 depth of the smoke shows through it.
//    vs_streak + fs_streak  a line from x back to x - v * U.mode.z (the
//                           sim time of one frame: real motion blur), 1.3 px
//                           wide, additive: hot pieces trail their glow,
//                           cold ones a faint lit trail. Debris only.
//    vs_flash + fs_flash    up to 4 flashes (U.flash): a point of
//                           incandescent light where the bodies first touch
//                           (the page sets them from the stats).
//
//  grep -n targets: "const DROP_K", "fn vs_drop", "fn fs_drop", "fn vs_streak",
//  "fn fs_streak", "fn vs_flash", "fn fs_flash"
// ============================================================================

// The droplets of one debris particle: DROPS = U.mode.w (render.js
// renderBudget frags: 10 desktop, 4 phone). Droplet radius 0.55 to
// 1.45 DROP_K (0.07 to 0.19 of the spacing), spread through the particle's volume
// (radius 0.55 of h, held to 0.6-2.5 spacings) and drawn out along the
// velocity, so a debris cloud reads as a dense spray of molten rock.
const DROP_K: f32 = 0.13;

struct ROut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) centre: vec4f,  // xyz, radius
  @location(1) @interpolate(flat) alb: vec4f,     // albedo, specular
  @location(2) @interpolate(flat) emit: vec3f,
  @location(3) @interpolate(flat) sun: f32,       // the sun light left (bodies, smoke)
};
fn dropCorner(vi: u32) -> vec2f {
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  return q[vi % 6u];
}
@vertex
fn vs_drop(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> ROut {
  var o: ROut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let F = max(u32(U0.mode.w + 0.5), 1u);
  let ii = inst / F;
  let f = inst % F;
  if (ii >= arrayLength(&pTag)) { return o; }
  if (klass(ii) != K_DEBRIS) { return o; }
  let x = pPos[ii].xyz;
  if (removed(x)) { return o; }
  let s0 = spacing0(ii);
  let seed = ii * 16u + f;
  // a point in the ball of the particle, drawn out along v
  let dir = normalize(vec3f(hashU(seed * 7u + 1u), hashU(seed * 7u + 2u), hashU(seed * 7u + 3u)) - vec3f(0.5) + vec3f(1e-4));
  let spread = 0.55 * clamp(pPos[ii].w, 0.6 * s0, 2.5 * s0);
  var off = dir * spread * pow(hashU(seed * 7u + 4u), 1.0 / 3.0);
  let v = pVel[ii].xyz;
  let sp = length(v);
  if (sp > 1e-6) { let vh = v / sp; off = off + vh * (1.2 * dot(off, vh)); }
  let c = x + off;
  let r = DROP_K * s0 * (0.55 + 0.9 * hashU(seed * 7u + 5u));
  let toEye = U0.eye.xyz - c;
  let dist = length(toEye);
  if (dot(-toEye, U0.fwd.xyz) < r) { return o; }
  let n = toEye / dist;
  let side = normalize(cross(U0.up.xyz, n));
  let upv = cross(n, side);
  let q = dropCorner(vi);
  let s = r * dist / sqrt(max(dist * dist - r * r, 1e-12));
  o.pos = U0.vp * vec4f(c + (q.x * side + q.y * upv) * s + n * r, 1.0);
  o.centre = vec4f(c, r);
  // the light left by the bodies and the smoke (scene.wgsl fn sunAt; the
  // first drop of a particle marches the body volume, the others share
  // its smoke term)
  o.sun = sunAt(c, normalize(U0.sun.xyz), select(0, 10, f == 0u));
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
    o.alb = vec4f(a.rgb * (1.0 - 0.7 * smoothstep(0.7 * Tm, Tm, T)) * (0.8 + 0.4 * hashU(seed + 17u)), 0.3 * fIron + 0.4 * smoothstep(Tm, 1.2 * Tm, T));
    // a small drop cools faster than the bulk; some carry a cold skin
    let crust = select(0.0, 1.0, hashU(seed + 29u) < crustShare());
    o.emit = glow(skinT(T, 0.25) * (1.0 - 0.55 * crust));
  } else {
    o.alb = vec4f(modeColor(mode, T, select(0.0, 1.0, bodyOf(ii) == 1u), 0.0, sp, fIron, fIce), 0.0);
    o.emit = vec3f(0.0);
  }
  return o;
}
struct DropOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment
fn fs_drop(in: ROut) -> DropOut {
  // a small drop far away: the hit from the closest approach of the ray
  // (the plain quadratic loses the radius to f32 rounding)
  let D = rayAt(in.pos.xy);
  let Dn = normalize(D);
  let e = U0.eye.xyz;
  let oc = e - in.centre.xyz;
  let b = dot(oc, Dn);
  let q = oc - b * Dn;
  let r = in.centre.w;
  let h = r * r - dot(q, q);
  if (h < 0.0) { discard; }
  let s = -b - sqrt(h);
  if (s <= 0.0) { discard; }
  let t = s * dot(Dn, U0.fwd.xyz);
  let n = normalize(q + (s + b) * Dn);
  let L = U0.sun.xyz;
  let ndl = max(dot(n, L), 0.0) * in.sun;
  var o: DropOut;
  o.depth = depthOfZ(t);
  let mode = i32(U0.mode.x + 0.5);
  if (mode != 0) { o.color = vec4f(in.alb.rgb * (0.3 + 0.7 * ndl), 1.0); return o; }
  let V = -Dn;
  let H = normalize(L + V);
  let spec = in.alb.w * pow(max(dot(n, H), 0.0), 60.0) * ndl * U0.sun.w;
  // the glow is brighter where the drop faces the eye (limb darkening)
  let mu = max(dot(n, V), 0.0);
  var col = in.alb.rgb * (U0.sun.w * ndl + U0.view.w) + in.emit * (0.55 + 0.45 * mu) + vec3f(spec);
  // a drop behind the half-opacity depth of the smoke shows through it
  let sm = smokeAt(in.pos.xy, t);
  if (t > sm.t50) { col = sm.c.rgb + col * (1.0 - sm.c.a); }
  o.color = vec4f(col, 1.0);
  return o;
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

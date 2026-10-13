// ============================================================================
//  DIAMOND LAB  ·  gem.wgsl — spectral ray tracer for a faceted stone
// ----------------------------------------------------------------------------
//  Four full-screen passes, one module:
//    fs_gem     trace each pixel into the stone. HDR out (rgba16float).
//    fs_bright  the bright part of the HDR image, at 1/4 size
//    fs_streak  a four-arm star and a soft glow from the bright part
//    fs_final   HDR + glow, exposure, ACES tone map, gamma, fade
//
//  The stone is the intersection of half-spaces dot(n, x) <= d (planes[],
//  from cuts.js). A ray from outside enters at the largest entry t and
//  leaves at the smallest exit t. Inside, the exit facet is the plane with
//  the smallest positive t.
//
//  Per wavelength sample k (u.samp[k] = index n_k, RGB weight w_k):
//    entry     Fresnel split: R to the reflection (added once, at n_d),
//              1 - R refracts in by Snell's law
//    bounce    the ray meets a facet from inside. Past the critical angle
//              (sin theta > 1 / n) all of it reflects: total internal
//              reflection. Else the part 1 - R leaves to the environment
//              and R reflects on. Beer-Lambert absorbs exp(-sigma L).
//    last      what is left after the last bounce leaves along its ray
//  The weights of all samples add to 1 per channel, so white stays white
//  and only a path that depends on the wavelength makes colour: fire.
//  traceRay() in optics.js is the same loop on the CPU (tests.mjs).
//
//  Modes (u.res.w): 0 render, 1 ASET (light by its elevation: red 45..80°,
//  green 0..45°, blue above 80° where a viewer's head would be, black from
//  below), 2 bounces (mean internal bounces of the light that leaves).
//
//  GREP MAP
//    struct U ......... the uniform block (packUniforms in main.js)
//    fn env ........... the studio light rigs (4 presets) and the sweep
//    fn look .......... env, ASET or bounce lookup for one exit ray
//    fn fs_gem ........ the tracer
//    fn fs_bright / fs_streak / fs_final ... post passes
// ============================================================================

struct U {
  res: vec4f,     // render w, h, time, mode
  eye: vec4f,     // camera position, tan(fov / 2)
  fwd: vec4f,     // forward, plane count
  right: vec4f,   // right, bounces
  up: vec4f,      // up, sample count
  ctr: vec4f,     // principal point x, y (render px), px per unit, fade
  mat: vec4f,     // n_d, gem bounding radius, 0, 0
  absorb: vec4f,  // Beer-Lambert sigma rgb, 0
  envp: vec4f,    // rig angle, preset, exposure, spark gain
  sweep: vec4f,   // sweep azimuth, sweep gain, background level, 0
  post: vec4f,    // threshold, streak gain, streak angle, glow gain
  scr: vec4f,     // canvas w, h, 0, 0
  samp: array<vec4f, 12>,   // n_k, w_k.rgb
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> planes: array<vec4f>;
@group(0) @binding(2) var srcTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(4) var glowTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

const PI = 3.14159265;

fn dirAE(az: f32, el: f32) -> vec3f { return vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az)); }

// A soft rectangle of light centred at (az, el), half sizes w, h (rad).
fn softbox(d: vec3f, az: f32, el: f32, w: f32, h: f32) -> f32 {
  let c = dirAE(az, el);
  let fc = dot(d, c);
  if (fc <= 0.0) { return 0.0; }
  let r = vec3f(cos(az), 0.0, -sin(az));
  let t = vec3f(-sin(el) * sin(az), cos(el), -sin(el) * cos(az));
  let x = abs(dot(d, r)) / fc;
  let y = abs(dot(d, t)) / fc;
  let sx = 1.0 - smoothstep(w * 0.8, w, x);
  let sy = 1.0 - smoothstep(h * 0.8, h, y);
  return sx * sy;
}
// A small round light of angular radius r.
fn spot(d: vec3f, az: f32, el: f32, r: f32) -> f32 {
  return smoothstep(cos(r), cos(r * 0.4), dot(d, dirAE(az, el)));
}

// The light rigs. rig turns every light about y. Studio: three softboxes,
// a top light and six pin lights for sparkle. Spotlights: near black with
// hard spots, for the most fire. Daylight: a bright sky and a sun. Ring: a
// ring light above the stone, the light of a gem photo booth.
fn env(dw: vec3f) -> vec3f {
  // turn the query by -rig, so the lights keep constant directions
  let rc = cos(u.envp.x);
  let rs = sin(u.envp.x);
  let d = vec3f(dw.x * rc - dw.z * rs, dw.y, dw.z * rc + dw.x * rs);
  let preset = u32(u.envp.y);
  let spark = u.envp.w;
  var c = vec3f(0.0);
  if (preset == 0u) {
    c = mix(vec3f(0.010, 0.011, 0.014), vec3f(0.07, 0.075, 0.09), smoothstep(-0.3, 0.9, d.y));
    c += vec3f(3.4) * softbox(d, 0.0, 0.70, 0.55, 0.22);
    c += vec3f(2.6, 2.3, 1.9) * softbox(d, 2.1, 0.40, 0.22, 0.55);
    c += vec3f(1.9, 2.2, 2.7) * softbox(d, 4.2, 0.55, 0.30, 0.40);
    c += vec3f(2.2) * softbox(d, 1.0, 1.42, 0.30, 0.30);
    for (var i = 0; i < 6; i = i + 1) {
      let fi = f32(i);
      c += vec3f(30.0 * spark) * spot(d, 0.5 + fi * 1.047, 0.35 + 0.17 * f32(i % 3), 0.035);
    }
  } else if (preset == 1u) {
    c = vec3f(0.003, 0.003, 0.005) + vec3f(0.012) * smoothstep(0.0, 1.0, d.y);
    for (var i = 0; i < 7; i = i + 1) {
      let fi = f32(i);
      c += vec3f(70.0 * spark) * spot(d, fi * 0.897, 0.55 + 0.11 * f32(i % 4), 0.022);
    }
    c += vec3f(0.5) * softbox(d, 3.3, 0.9, 0.5, 0.25);
  } else if (preset == 2u) {
    let sky = mix(vec3f(0.55, 0.62, 0.75), vec3f(0.95, 0.97, 1.0), clamp(d.y, 0.0, 1.0)) * 0.9;
    let ground = vec3f(0.06, 0.05, 0.04);
    c = mix(ground, sky, smoothstep(-0.05, 0.05, d.y));
    c += vec3f(110.0, 100.0, 85.0) * spark * spot(d, 0.6, 0.8, 0.02);
    c *= 1.0 - 0.85 * softbox(d, 3.6, 0.5, 0.06, 0.6);
  } else {
    c = vec3f(0.006, 0.006, 0.008) + vec3f(0.03) * smoothstep(-0.2, 1.0, d.y);
    let el = asin(clamp(d.y, -1.0, 1.0));
    c += vec3f(4.5) * (1.0 - smoothstep(0.03, 0.06, abs(el - 1.0)));
    for (var i = 0; i < 4; i = i + 1) {
      c += vec3f(26.0 * spark) * spot(d, f32(i) * 1.571 + 0.4, 0.3, 0.03);
    }
  }
  // the light sweep: a tall bright strip that moves round the stone
  c += vec3f(5.0, 4.8, 4.5) * u.sweep.y * softbox(dw, u.sweep.x, 0.5, 0.10, 1.1);
  return c;
}

// ASET: the light that reaches the eye, coloured by the elevation it came from.
fn aset(d: vec3f) -> vec3f {
  let el = asin(clamp(d.y, -1.0, 1.0)) * 180.0 / PI;
  if (el > 80.0) { return vec3f(0.15, 0.3, 1.0); }
  if (el > 45.0) { return vec3f(1.0, 0.12, 0.1); }
  if (el > 0.0) { return vec3f(0.15, 0.85, 0.2); }
  return vec3f(0.0);
}
fn look(d: vec3f, mode: u32) -> vec3f {
  if (mode == 1u) { return aset(d); }
  return env(d);
}

// Exact unpolarised Fresnel reflectance; ci, ct the cosines of the incident
// and the transmitted angles, from index n1 into n2.
fn fresnel(ci: f32, ct: f32, n1: f32, n2: f32) -> f32 {
  let rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  let rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return 0.5 * (rs * rs + rp * rp);
}

fn background(px: vec2f) -> vec3f {
  let q = (px - u.ctr.xy) / u.ctr.z;
  let r2 = dot(q, q);
  let lvl = u.sweep.z;
  let preset = u32(u.envp.y);
  var tint = vec3f(0.05, 0.055, 0.075);
  if (preset == 1u) { tint = vec3f(0.02, 0.02, 0.03); }
  if (preset == 2u) { tint = vec3f(0.11, 0.115, 0.13); }
  if (preset == 3u) { tint = vec3f(0.035, 0.035, 0.045); }
  var c = tint * lvl * (1.25 - 0.35 * min(r2, 2.5));
  // a soft pool of light on the floor of the stage, under the stone
  let fy = q.y - u.mat.y * 0.95;
  c += tint * lvl * 0.9 * exp(-(q.x * q.x * 1.6 + fy * fy * 9.0));
  return max(c, vec3f(0.0));
}

@fragment fn fs_gem(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let mode = u32(u.res.w);
  let q = (pos.xy - u.ctr.xy) / u.ctr.z;
  let th = u.eye.w;
  let ro = u.eye.xyz;
  let rd = normalize(u.fwd.xyz + u.right.xyz * (q.x * th) - u.up.xyz * (q.y * th));
  let np = u32(u.fwd.w);

  var tN = -1e9;
  var tF = 1e9;
  var nN = vec3f(0.0, 1.0, 0.0);
  var miss = false;
  for (var i = 0u; i < np; i = i + 1u) {
    let pl = planes[i];
    let den = dot(pl.xyz, rd);
    let dist = pl.w - dot(pl.xyz, ro);
    if (abs(den) < 1e-7) {
      if (dist < 0.0) { miss = true; }
      continue;
    }
    let t = dist / den;
    if (den < 0.0) {
      if (t > tN) { tN = t; nN = pl.xyz; }
    } else {
      tF = min(tF, t);
    }
  }
  if (miss || (tN > tF) || (tF < 0.0)) {
    if (mode == 0u) { return vec4f(background(pos.xy), 1.0); }
    return vec4f(vec3f(0.02), 1.0);
  }

  let p0 = ro + rd * tN;
  let ci = -dot(rd, nN);
  let nd = u.mat.x;
  let ns = u32(u.up.w);
  let nb = u32(u.right.w);
  var col = vec3f(0.0);
  var bSum = 0.0;
  var eSum = 0.0;

  // the reflection off the outside (achromatic: R at n_d)
  {
    let k = 1.0 - (1.0 - ci * ci) / (nd * nd);
    let R = fresnel(ci, sqrt(max(k, 0.0)), 1.0, nd);
    col += R * look(reflect(rd, nN), mode);
  }

  for (var s = 0u; s < ns; s = s + 1u) {
    let sm = u.samp[s];
    let n = sm.x;
    let w = sm.yzw;
    let eta = 1.0 / n;
    let kk = 1.0 - eta * eta * (1.0 - ci * ci);
    let ct = sqrt(max(kk, 0.0));
    let R = fresnel(ci, ct, 1.0, n);
    var dir = normalize(rd * eta + nN * (eta * ci - ct));
    var p = p0;
    var thr = vec3f(1.0 - R);
    var acc = vec3f(0.0);
    for (var b = 0u; b < nb; b = b + 1u) {
      // the light still inside is too dim to see: stop the path here
      if (mode != 2u && max(thr.x, max(thr.y, thr.z)) < 0.015) { break; }
      var tm = 1e9;
      var ne = vec3f(0.0, 1.0, 0.0);
      for (var i = 0u; i < np; i = i + 1u) {
        let pl = planes[i];
        let den = dot(pl.xyz, dir);
        if (den > 1e-6) {
          let t = max((pl.w - dot(pl.xyz, p)) / den, 0.0);
          if (t < tm) { tm = t; ne = pl.xyz; }
        }
      }
      if (tm > 1e8) { break; }
      p = p + dir * tm;
      thr = thr * exp(-u.absorb.xyz * tm);
      let c = dot(dir, ne);
      let rdir = dir - 2.0 * c * ne;
      let k2 = 1.0 - n * n * (1.0 - c * c);
      let last = (b + 1u == nb);
      if (k2 <= 0.0) {
        dir = rdir;
        if (last) {
          acc += thr * look(dir, mode);
          bSum += f32(b + 1u) * dot(thr, w) * 0.5;
          eSum += dot(thr, w) * 0.5;
        }
        continue;
      }
      let ctt = sqrt(k2);
      let Rf = fresnel(c, ctt, n, 1.0);
      let outd = normalize(dir * n + ne * (ctt - n * c));
      let lt = thr * (1.0 - Rf);
      acc += lt * look(outd, mode);
      bSum += f32(b + 1u) * dot(lt, w);
      eSum += dot(lt, w);
      thr = thr * Rf;
      dir = rdir;
      if (last) { acc += thr * look(dir, mode); }
    }
    col += w * acc;
  }

  if (mode == 2u) {
    let m = clamp(bSum / max(eSum, 1e-4) / 6.0, 0.0, 1.0);
    let a = vec3f(0.10, 0.25, 0.95);
    let bcol = vec3f(1.0, 0.85, 0.55);
    let ccol = vec3f(1.0, 0.18, 0.12);
    var heat = mix(a, bcol, smoothstep(0.0, 0.5, m));
    heat = mix(heat, ccol, smoothstep(0.5, 1.0, m));
    return vec4f(heat * 0.9, 1.0);
  }
  if (mode == 1u) { return vec4f(col * 0.85, 1.0); }
  return vec4f(col, 1.0);
}

// ── post ────────────────────────────────────────────────────────────────────
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// 1/4 size: four bilinear taps cover the 4x4 source block; keep what is
// above the threshold.
@fragment fn fs_bright(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let sd = vec2f(textureDimensions(srcTex));
  let uv = pos.xy * 4.0 / sd;
  let tx = 1.0 / sd;
  var c = vec3f(0.0);
  c += textureSampleLevel(srcTex, linSamp, uv + vec2f(-1.0, -1.0) * tx, 0.0).rgb;
  c += textureSampleLevel(srcTex, linSamp, uv + vec2f(1.0, -1.0) * tx, 0.0).rgb;
  c += textureSampleLevel(srcTex, linSamp, uv + vec2f(-1.0, 1.0) * tx, 0.0).rgb;
  c += textureSampleLevel(srcTex, linSamp, uv + vec2f(1.0, 1.0) * tx, 0.0).rgb;
  c *= 0.25;
  let l = lum(c);
  let k = max(l - u.post.x, 0.0) / max(l, 1e-4);
  return vec4f(min(c * k, vec3f(64.0)), 1.0);
}

// A star filter: two lines at angle a (four arms) with a falloff per tap,
// plus a small round glow.
@fragment fn fs_streak(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let sd = vec2f(textureDimensions(srcTex));
  let uv = pos.xy / sd;
  let tx = 1.0 / sd;
  let a = u.post.z;
  var star = vec3f(0.0);
  for (var arm = 0; arm < 2; arm = arm + 1) {
    let ang = a + f32(arm) * (PI * 0.5);
    let dv = vec2f(cos(ang), sin(ang)) * tx;
    for (var j = 1; j < 7; j = j + 1) {
      let fj = f32(j);
      let wgt = pow(0.55, fj);
      star += wgt * textureSampleLevel(srcTex, linSamp, uv + dv * fj, 0.0).rgb;
      star += wgt * textureSampleLevel(srcTex, linSamp, uv - dv * fj, 0.0).rgb;
    }
  }
  var glow = vec3f(0.0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let o = vec2f(f32(x), f32(y));
      glow += exp(-dot(o, o) * 0.7) * textureSampleLevel(srcTex, linSamp, uv + o * tx, 0.0).rgb;
    }
  }
  return vec4f(star * 0.05 * u.post.y + glow * 0.035 * u.post.w, 1.0);
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment fn fs_final(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.scr.xy;
  var c = textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb;
  c += textureSampleLevel(glowTex, linSamp, uv, 0.0).rgb;
  c = aces(c * u.envp.z);
  c = pow(c, vec3f(1.0 / 2.2));
  let v = uv - 0.5;
  c *= 1.0 - 0.35 * dot(v, v);
  c *= 1.0 - u.ctr.w;
  c += (hash(pos.xy + fract(u.res.z)) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}

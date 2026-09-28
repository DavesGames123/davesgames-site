// march.wgsl — the view pass: one full-screen triangle per view.
//
// main.js splits the canvas into one, two or four views. engine.js draws each
// view with its own viewport and its own View uniform, so one pipeline serves
// every pass. V.mode.x selects the pass; P holds everything else.
//
// The march follows ScreenTransmittance.compute cloudMarch:
//   - inside the cloud box, sphere-trace empty space by the SDF and take
//     fixed minimum steps inside the cloud (the step grows with distance);
//   - outside the box, take fixed fog steps, or jump to the box if fog is off;
//   - fog is a second medium: its density adds to the cloud density at each
//     sample, and the same T and lighting math uses the sum;
//   - T_light comes from the baked transmittance volume inside the box, or
//     from projection onto the volume toward the sun outside it.
//
//   T       *= exp(-sigma_t * ds)
//   L_media += T * (1 - exp(-sigma_t * ds)) * (p(theta) T_light L_sun + ambient)
//   pixel    = L_media + T * L_background
//
// grep: fn marchRay  fn shadowAt  fn skyCol  fn groundCol  fn fs  PASS_

struct View { rect: vec4f, mode: vec4f };   // rect px x y w h; mode x pass
@group(1) @binding(0) var<uniform> V : View;
@group(0) @binding(4) var lightTex : texture_3d<f32>;   // r T_light, g tau, b AO
@group(0) @binding(5) var seedTex  : texture_3d<f32>;   // JFA seeds, textureLoad only

const PASS_FINAL = 0;
const PASS_FLAT = 1;
const PASS_CLOUD = 2;
const PASS_STEPS = 3;
const PASS_STEPLEN = 4;
const PASS_SLICE = 5;
const PASS_SEEDS = 6;
const PASS_OPTICAL = 7;
const PASS_LIGHT = 8;
const PASS_EROSION = 9;
const PASS_NORMAL = 10;
const PASS_DEPTH = 11;
const PASS_SHADOW = 12;
const PASS_FOG = 13;

const FOG_FAR = 60.0;
const FAR = 400.0;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn lightAt(w: vec3f) -> f32 { return textureSampleLevel(lightTex, samp, boxUVW(w), 0.0).r; }

// Cloud shadow for a point anywhere. Inside the box, read the volume. Outside,
// project toward the sun onto the box and read the entry voxel.
fn shadowAt(w: vec3f) -> f32 {
  let L = P.sun.xyz;
  let r = boxRange(w, L);
  if (r.y <= r.x) { return 1.0; }
  let e = w + L * (r.x + 1e-3);
  if (P.misc.z > 0.5) {
    let o = 0.35;
    return (lightAt(e) * 2.0 + lightAt(e + vec3f(o, 0.0, 0.0)) + lightAt(e - vec3f(o, 0.0, 0.0))
          + lightAt(e + vec3f(0.0, 0.0, o)) + lightAt(e - vec3f(0.0, 0.0, o))) / 6.0;
  }
  return lightAt(e);
}

// Henyey-Greenstein, scaled so the isotropic value is 1.
fn hgN(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

fn skyBase(y: f32) -> vec3f {
  let sy = P.sun.y;
  let day = smoothstep(-0.12, 0.25, sy);
  let zen = mix(vec3f(0.02, 0.03, 0.07), vec3f(0.13, 0.30, 0.68), day);
  let hor = mix(vec3f(0.60, 0.34, 0.22), vec3f(0.60, 0.72, 0.88), smoothstep(0.0, 0.45, sy)) * mix(0.25, 1.0, day);
  return mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.45));
}

fn skyCol(rd: vec3f) -> vec3f {
  let mu = max(dot(rd, P.sun.xyz), 0.0);
  var c = skyBase(rd.y);
  c += P.sunCol.rgb * (pow(mu, 600.0) * 2.0 + pow(mu, 12.0) * 0.22);
  c += P.sunCol.rgb * smoothstep(0.99955, 0.9998, mu) * 30.0;
  return c;
}

fn skyAmbient() -> vec3f { return mix(skyBase(0.0), skyBase(1.0), 0.6); }

fn groundCol(p: vec3f, t: f32, shadowOnly: bool) -> vec3f {
  var sh = 1.0;
  if (P.viz.z > 0.5) { sh = mix(1.0, shadowAt(p), P.viz.w); }
  if (shadowOnly) { return vec3f(sh); }
  let g = abs(fract(p.xz) - 0.5);
  let line = 1.0 - smoothstep(0.0, 0.02 + t * 0.002, min(g.x, g.y));
  let alb = mix(vec3f(0.11, 0.13, 0.10), vec3f(0.20, 0.23, 0.20), line * exp(-t * 0.05));
  let lit = P.sunCol.rgb * P.sun.w * max(P.sun.y, 0.0) * sh + skyAmbient() * P.sunCol.w * 0.8;
  let c = alb * lit;
  return mix(c, skyBase(0.02), 1.0 - exp(-t * 0.012));
}

fn ign(p: vec2f) -> f32 {
  let q = p + 5.588238 * (P.camRight.w % 64.0);
  return fract(52.9829189 * fract(dot(q, vec2f(0.06711056, 0.00583715))));
}

struct MR {
  L: vec3f,        // cloud + fog radiance toward the eye
  T: f32,          // transmittance of the whole ray
  cloudL: vec3f,   // cloud-only radiance
  Tc: f32,         // cloud-only transmittance
  fogL: vec3f,     // fog-only radiance
  steps: f32,      // samples taken, primary + secondary
  prim: f32,       // primary samples inside the box
  travel: f32,     // summed step length inside the box
  optical: f32,    // cloud optical depth
  lightW: f32,     // sum of T_light * sigma_t ds
  eroW: f32,       // sum of erosion weight * sigma_t ds
  hitT: f32,       // distance to the first cloud density, -1 if none
};

fn marchRay(ro: vec3f, rd: vec3f, tEnd: f32, jit: f32) -> MR {
  var r: MR;
  r.T = 1.0; r.Tc = 1.0; r.hitT = -1.0;
  var Tf = 1.0;
  let hb = boxRange(ro, rd);
  let hitsBox = hb.y > hb.x;
  let fogOn = P.march2.w > 0.0;
  let fogEnd = min(tEnd, FOG_FAR);
  let fogStep = fogEnd / max(P.misc2.z, 1.0);
  let mu = dot(rd, P.sun.xyz);
  let ph = P.phase.y + P.phase.z * hgN(mu, P.phase.x);
  let phF = 0.35 + 0.65 * hgN(mu, 0.4);
  let sunL = P.sunCol.rgb * P.sun.w;
  let amb = skyAmbient() * P.sunCol.w;

  var t = 0.0;
  if (!fogOn) {
    if (!hitsBox) { return r; }
    t = hb.x;
  }
  t += jit;
  let maxS = i32(P.march.x);
  for (var i = 0; i < 4096; i++) {
    if (i >= maxS || t >= tEnd) { break; }
    let w = ro + rd * t;
    let inBox = hitsBox && t >= hb.x && t <= hb.y;
    var dt = 1e9;
    var sig = 0.0;
    var ew = 0.0;
    var pw = 1.0;
    if (inBox) {
      let s = sdfAt(w);
      let minS = P.march.y * (1.0 + t * P.march.z);
      dt = minS;
      if (P.march2.x > 0.5) {
        if (s > P.march.w) { dt = max(s - P.march.w, minS); }
        else if (P.march2.y > 0.5) { dt = max(P.march.w - s, minS); }
      }
      dt = min(dt, hb.y - t + 1e-3);
      if (s <= P.march.w) {
        let D = density(w, s, true);
        sig = D.d;
        ew = D.ew;
        if (P.phase.w > 0.5) {
          pw = mix(1.0, 1.0 - exp(-(P.march.w - s) * P.powder.x), P.powder.y);
        }
      }
      r.travel += dt;
      r.prim += 1.0;
    } else {
      let fogLeft = fogOn && t < fogEnd;
      if (hitsBox && t < hb.x) { dt = hb.x - t + 1e-3; }
      else if (!fogLeft) { break; }
      if (fogLeft) { dt = min(dt, fogStep); }
    }
    dt = min(dt, tEnd - t + 1e-3);
    var fog = 0.0;
    if (fogOn && t < fogEnd) { fog = P.march2.w * exp(-max(w.y, 0.0) * P.misc.y); }
    r.steps += 1.0;
    let ext = (sig + fog) * dt;
    if (ext > 0.0) {
      var Tl = 1.0;
      if (inBox) {
        if (P.powder.z > 0.5) {
          Tl = lightAt(w);
        } else {
          let ld = lightDepth(w, i32(P.powder.w), true);
          Tl = exp(-ld.x);
          r.steps += ld.y;
        }
      } else {
        Tl = shadowAt(w);
      }
      let hgt = mix(0.45, 1.0, clamp(boxUVW(w).y, 0.0, 1.0));
      let Sc = sunL * Tl * ph * pw + amb * hgt;
      let Sf = sunL * Tl * phF + amb * 0.5;
      let a = 1.0 - exp(-ext);
      r.L += r.T * a * (Sc * sig + Sf * fog) / (sig + fog);
      r.T *= exp(-ext);
      if (sig > 0.0) {
        if (r.hitT < 0.0) { r.hitT = t; }
        let ec = sig * dt;
        r.cloudL += r.Tc * (1.0 - exp(-ec)) * Sc;
        r.Tc *= exp(-ec);
        r.optical += ec;
        r.lightW += Tl * ec;
        r.eroW += ew * ec;
      }
      if (fog > 0.0) {
        let ef = fog * dt;
        r.fogL += Tf * (1.0 - exp(-ef)) * Sf;
        Tf *= exp(-ef);
      }
      if (r.T < 0.01) { r.T = 0.0; break; }
    }
    t += dt;
  }
  return r;
}

fn turbo(x: f32) -> vec3f {
  let t = clamp(x, 0.0, 1.0);
  let r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  let g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  let b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return clamp(vec3f(r, g, b), vec3f(0.0), vec3f(1.0));
}

fn tonemap(c: vec3f) -> vec3f {
  let x = c * P.shape3.w;
  let m = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(m, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

// Horizontal slice through the box at P.viz.x. Returns the world hit point in
// xyz and w = 1 on a hit.
fn sliceHit(ro: vec3f, rd: vec3f) -> vec4f {
  let y = mix(P.boxMin.y, P.boxMax.y, P.viz.x);
  if (abs(rd.y) < 1e-5) { return vec4f(0.0); }
  let t = (y - ro.y) / rd.y;
  if (t <= 0.0) { return vec4f(0.0); }
  let p = ro + rd * t;
  if (any(p.xz < P.boxMin.xz) || any(p.xz > P.boxMax.xz)) { return vec4f(0.0); }
  return vec4f(p, 1.0);
}

fn sliceSDF(p: vec3f, t: f32, base: vec3f) -> vec3f {
  let s = sdfAt(p) - P.march.w;
  let outside = mix(vec3f(0.30, 0.62, 1.00), vec3f(0.03, 0.07, 0.16), clamp(s / P.boxMax.w, 0.0, 1.0));
  let inside = mix(vec3f(1.00, 0.62, 0.22), vec3f(0.35, 0.04, 0.02), clamp(-s * 2.0, 0.0, 1.0));
  var c = select(inside, outside, s > 0.0);
  let lw = 0.004 + t * 0.0015;
  let band = abs(fract(s / 0.25 + 0.5) - 0.5) * 0.25;
  c = mix(c, c * 0.35, 1.0 - smoothstep(0.0, lw, band));
  c = mix(c, vec3f(1.0), 1.0 - smoothstep(0.0, lw * 2.0, abs(s)));
  return mix(base, c, 0.92);
}

fn sliceSeeds(p: vec3f) -> vec3f {
  let res = vec3i(P.volRes.xyz);
  let idx = clamp(vec3i(floor(boxUVW(p) * vec3f(res))), vec3i(0), res - 1);
  let sd = textureLoad(seedTex, idx, 0);
  if (sd.w < 0.5) { return vec3f(0.0); }
  let v = sd.xyz - vec3f(idx);
  let len = length(v);
  let dir = select(vec3f(0.0, 1.0, 0.0), v / len, len > 1e-4);
  let rings = 0.65 + 0.35 * step(0.5, fract(len / 4.0));
  return (0.5 + 0.5 * dir) * rings;
}

fn normalAt(p: vec3f) -> vec3f {
  let e = P.boxMin.w;
  let g = vec3f(sdfAt(p + vec3f(e, 0.0, 0.0)) - sdfAt(p - vec3f(e, 0.0, 0.0)),
                sdfAt(p + vec3f(0.0, e, 0.0)) - sdfAt(p - vec3f(0.0, e, 0.0)),
                sdfAt(p + vec3f(0.0, 0.0, e)) - sdfAt(p - vec3f(0.0, 0.0, e)));
  return normalize(g + vec3f(0.0, 1e-6, 0.0));
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let rect = V.rect;
  let uv = (fc.xy - rect.xy) / rect.zw;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let aspect = rect.z / rect.w;
  let ro = P.camPos.xyz;
  let rd = normalize(P.camFwd.xyz + ndc.x * P.camFwd.w * aspect * P.camRight.xyz + ndc.y * P.camFwd.w * P.camUp.xyz);
  let mode = i32(V.mode.x);

  var tG = 1e9;
  if (P.misc.w > 0.5 && rd.y < -1e-4) { tG = -ro.y / rd.y; }
  let tEnd = min(tG, FAR);
  let groundHit = tG < FAR;

  let jit = P.march2.z * P.march.y * ign(fc.xy);
  let r = marchRay(ro, rd, tEnd, jit);

  var bg: vec3f;
  if (groundHit) { bg = groundCol(ro + rd * tG, tG, false); } else { bg = skyCol(rd); }
  let comp = r.L + r.T * bg;

  var out: vec3f;
  switch mode {
    case PASS_FINAL: { out = tonemap(comp); }
    case PASS_FLAT: { out = tonemap(bg * r.Tc + vec3f(0.9) * (1.0 - r.Tc)); }
    case PASS_CLOUD: { out = tonemap(r.cloudL); }
    case PASS_STEPS: { out = turbo(r.steps / P.viz.y); }
    case PASS_STEPLEN: {
      if (r.prim < 0.5) { out = vec3f(0.0); } else {
        let m = r.travel / r.prim;
        out = turbo(log2(max(m / P.march.y, 1.0)) / max(log2(P.boxMax.w / P.march.y), 1.0));
      }
    }
    case PASS_SLICE, PASS_SEEDS: {
      let base = tonemap(comp) * 0.3;
      let h = sliceHit(ro, rd);
      if (h.w < 0.5) { out = base; }
      else if (mode == PASS_SLICE) { out = sliceSDF(h.xyz, distance(ro, h.xyz), base); }
      else { out = sliceSeeds(h.xyz); }
    }
    case PASS_OPTICAL: { out = turbo(1.0 - exp(-r.optical * 0.35)) * step(1e-4, r.optical); }
    case PASS_LIGHT: {
      var b = vec3f(0.02);
      if (groundHit) { b = groundCol(ro + rd * tG, tG, true) * 0.6; }
      let g = r.lightW / max(r.optical, 1e-5);
      out = mix(b, vec3f(1.0, 0.93, 0.8) * g, 1.0 - r.Tc);
    }
    case PASS_EROSION: {
      let e = clamp(r.eroW / max(r.optical, 1e-5) * 3.0, 0.0, 1.0);
      out = mix(vec3f(0.02), mix(vec3f(0.35), vec3f(1.0, 0.2, 0.75), e), 1.0 - r.Tc);
    }
    case PASS_NORMAL: {
      if (r.hitT < 0.0) { out = vec3f(0.02); } else { out = 0.5 + 0.5 * normalAt(ro + rd * r.hitT); }
    }
    case PASS_DEPTH: {
      if (r.hitT < 0.0) { out = vec3f(0.0); } else { out = turbo(1.0 - r.hitT / 30.0); }
    }
    case PASS_SHADOW: {
      if (groundHit) { out = groundCol(ro + rd * tG, tG, true); } else { out = vec3f(0.0); }
    }
    case PASS_FOG: { out = tonemap(r.fogL); }
    default: { out = tonemap(comp); }
  }
  return vec4f(out, 1.0);
}

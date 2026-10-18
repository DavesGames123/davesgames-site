// ============================================================================
//  PLANET COLLISION  ·  shaders/smoke.wgsl — the volumetric vapour, dust and
//  ejecta clouds (after common.wgsl)
// ----------------------------------------------------------------------------
//  A second, coarser volume round the framed matter (U.smoke0, U.smoke1;
//  render.js "_smoke"). The SPH particles that are gas or dust (fn smokeOf,
//  the rule of optics.js smokeWeights) splat their mass into it; a light
//  pass finds the optical depth to the sun per cell; a ray march at half
//  size draws it with single and multiple scattering and black-body
//  emission; a temporal pass steadies the result.
//
//  PASSES
//    cs_noise         once: noiseOut (64^3 rgba8unorm, tileable): r
//                     Perlin-Worley, g b a Worley fbm at 2, 4, 8 cells;
//                     curlOut (32^3 rgba16float): the curl of a vector
//                     potential of three tileable gradient noises
//    cs_smokeScatter  one workgroup per particle: gas and dust density
//                     (code mass per code volume), their temperatures,
//                     the mass-weighted velocity and the iron share, a
//                     kernel (1 - q^2)^3 normalised to the particle mass,
//                     fixed point 1/65536 into sAcc (8 i32 per cell)
//    cs_smokeResolve  one thread per cell: medOut (gas, dust, Tgas/1e3,
//                     Tdust/1e3), velOut (v, iron share); brick marks
//    cs_smokeLight    one thread per cell: the march to the sun through
//                     the medium (tau, no detail) and the body volume
//                     (an iso hit is a full shadow) -> lightOut (tau, body
//                     transmittance)
//    fs_smokeMarch    half size: the ray from the eye to the surface depth
//                     (the smoothed depth, sZs) through the cube; empty
//                     bricks skipped; per step the density times the
//                     detail (two octaves of the noise texture, warped by
//                     the curl texture, carried along the SPH velocity by
//                     two phases faded across); sun light: two
//                     Henyey-Greenstein lobes, three octaves of the
//                     multiple-scattering sum (Wrenninge 2015), the body
//                     shadow; the glow of the hot remnant as a second
//                     light; black-body emission of hot gas and dust;
//                     energy-conserving steps (Hillaire 2015). Targets:
//                     radiance + alpha (premultiplied), and aux (mean
//                     depth of the light, the depth where the alpha passes
//                     0.5, the stop depth)
//    fs_smokeTAA      half size: the march blended with the history
//                     reprojected through the mean depth, clamped to the
//                     3 x 3 range of the current image (no ghosts)
//  shade.wgsl fs_smokeComp puts the result over the scene (a depth-aware
//  upsample); debris.wgsl puts drops behind the 0.5 depth under it.
//
//  Ideas (no code) from: Schneider, "Real-time volumetric cloudscapes"
//  (GPU Pro 7, 2016), Hillaire, "Physically based sky, atmosphere and
//  cloud rendering in Frostbite" (SIGGRAPH 2016), Wrenninge et al.,
//  "Oz: the great and volumetric" (SIGGRAPH 2013 talk), Bridson et al.,
//  "Curl-noise for procedural fluid flow" (SIGGRAPH 2007). The site pages
//  volume-noise (MIT, Hillaire) and dla-terrain weather.wgsl use the same
//  model; this file is written for this page.
//
//  Precedence: every mix of * with ^, or of && with ||, has parentheses.
//
//  grep -n targets: "fn smokeOf", "fn cs_noise", "fn cs_smokeScatter",
//  "fn cs_smokeResolve", "fn cs_smokeLight", "fn fs_smokeMarch",
//  "fn fs_smokeTAA", "fn detailAt", "fn hgPhase", "fn tnoise", "fn worleyT"
// ============================================================================

@group(2) @binding(0) var<storage, read_write> sAcc: array<atomic<i32>>;
@group(2) @binding(1) var<storage, read_write> sBricks: array<atomic<u32>>;
@group(2) @binding(2) var medOut: texture_storage_3d<rgba16float, write>;
@group(2) @binding(3) var velOut: texture_storage_3d<rgba16float, write>;
@group(2) @binding(4) var medTex: texture_3d<f32>;
@group(2) @binding(5) var velTex: texture_3d<f32>;
@group(2) @binding(6) var lightOut: texture_storage_3d<rgba16float, write>;
@group(2) @binding(7) var lightTex: texture_3d<f32>;
@group(2) @binding(8) var noiseTex: texture_3d<f32>;
@group(2) @binding(9) var curlTex: texture_3d<f32>;
@group(2) @binding(10) var bodyVol: texture_3d<f32>;
@group(2) @binding(11) var sZs: texture_2d<f32>;
@group(2) @binding(12) var<storage, read> brickRO: array<u32>;
@group(2) @binding(13) var noiseOut: texture_storage_3d<rgba8unorm, write>;
@group(2) @binding(14) var curlOut: texture_storage_3d<rgba16float, write>;
@group(2) @binding(15) var histTex: texture_2d<f32>;
@group(2) @binding(16) var curTex: texture_2d<f32>;
@group(2) @binding(17) var curAux: texture_2d<f32>;

const SFIX: f32 = 65536.0;
const NCH: u32 = 8u;

// ── tileable noise (cs_noise) ───────────────────────────────────────────────
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + vec3u(1013904223u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rnd3(c: vec3i, P: i32, salt: u32) -> vec3f {
  let w = vec3u(((c % P) + P) % P);
  return vec3f(pcg3(w + vec3u(salt * 101u, salt * 37u, salt * 7u)) & vec3u(0xffffu)) / 65535.0;
}
// tileable gradient noise of period P (cells), about -1..1
fn tnoise(p: vec3f, P: i32, salt: u32) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var acc = array<f32, 8>();
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1u) & 1, (k >> 2u) & 1);
    let gr = normalize(rnd3(i + o, P, salt) * 2.0 - vec3f(1.0) + vec3f(1e-4));
    acc[k] = dot(gr, f - vec3f(o));
  }
  let x0 = mix(mix(acc[0], acc[1], u.x), mix(acc[2], acc[3], u.x), u.y);
  let x1 = mix(mix(acc[4], acc[5], u.x), mix(acc[6], acc[7], u.x), u.y);
  return 1.6 * mix(x0, x1, u.z);
}
// tileable Worley F1 of period P, 0 at a feature point, about 1 between
fn worleyT(p: vec3f, P: i32, salt: u32) -> f32 {
  let i = vec3i(floor(p));
  var d = 9.0;
  for (var k = 0; k < 27; k++) {
    let o = vec3i(k % 3 - 1, (k / 3) % 3 - 1, k / 9 - 1);
    let fp = vec3f(i + o) + rnd3(i + o, P, salt);
    let q = p - fp;
    d = min(d, dot(q, q));
  }
  return clamp(sqrt(d), 0.0, 1.0);
}
@compute @workgroup_size(4, 4, 4)
fn cs_noise(@builtin(global_invocation_id) gid: vec3u) {
  let NS = 64u;
  if (all(gid < vec3u(NS))) {
    let uvw = (vec3f(gid) + 0.5) / f32(NS);
    var pf = 0.0;
    var a = 0.5;
    for (var o = 0; o < 4; o++) {
      let P = 4 << u32(o);
      pf += a * tnoise(uvw * f32(P), P, 1u + u32(o));
      a *= 0.5;
    }
    let w1 = 1.0 - worleyT(uvw * 4.0, 4, 11u);
    let w2 = 1.0 - worleyT(uvw * 8.0, 8, 12u);
    let w3 = 1.0 - worleyT(uvw * 16.0, 16, 13u);
    let wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    // Perlin-Worley: the fbm lifted by the cells (billows with soft tops)
    let perlin = clamp(0.5 + 0.7 * pf, 0.0, 1.0);
    let pw = clamp((perlin - (wf - 1.0)) / (2.0 - wf) , 0.0, 1.0);
    textureStore(noiseOut, gid, vec4f(pw, w1 * 0.75 + w2 * 0.25, w2 * 0.75 + w3 * 0.25, w3));
  }
  let NC = 32u;
  if (all(gid < vec3u(NC))) {
    let p = (vec3f(gid) + 0.5) / f32(NC) * 4.0;
    let e = 0.05;
    let dx = vec3f(e, 0.0, 0.0);
    let dy = vec3f(0.0, e, 0.0);
    let dz = vec3f(0.0, 0.0, e);
    // the potential: three noises; the curl by central differences
    let ax_dy = tnoise(p + dy, 4, 21u) - tnoise(p - dy, 4, 21u);
    let ax_dz = tnoise(p + dz, 4, 21u) - tnoise(p - dz, 4, 21u);
    let ay_dx = tnoise(p + dx, 4, 22u) - tnoise(p - dx, 4, 22u);
    let ay_dz = tnoise(p + dz, 4, 22u) - tnoise(p - dz, 4, 22u);
    let az_dx = tnoise(p + dx, 4, 23u) - tnoise(p - dx, 4, 23u);
    let az_dy = tnoise(p + dy, 4, 23u) - tnoise(p - dy, 4, 23u);
    let curl = vec3f(az_dy - ay_dz, ax_dz - az_dx, ay_dx - ax_dy) / (2.0 * e);
    textureStore(curlOut, gid, vec4f(curl * 0.25, 0.0));
  }
}

// ── the smoke rule (optics.js smokeWeights) ─────────────────────────────────
// x gas share, y dust share, z drawn gas T (K), w drawn dust T (K)
fn smokeOf(i: u32) -> vec4f {
  let a = pAux[i];
  let m = matOf(i) & 3u;
  let rr = pTh[i].x / U0.mats[m].x;
  let q = U0.surf.w;
  let debris = rr * q * q * q < 1.0;
  let fromXv = smoothstep(U0.vap.y, U0.vap.z, a.w);
  let hotExp = smoothstep(U0.smoke3.x, U0.smoke3.y, a.x) * (1.0 - smoothstep(U0.smoke3.z, U0.smoke3.w, rr));
  let vap = max(fromXv, hotExp);
  let Tg = min(a.x, U0.smoke4.z);
  let cond = 1.0 - smoothstep(U0.smoke4.x, U0.smoke4.y, Tg);
  let shed = select(0.0, U0.smoke4.w, debris);
  let gas = vap * (1.0 - cond);
  let dust = min(1.0, vap * cond + shed * (1.0 - vap));
  // dust from hot drops is as hot as their skin (fast cooling: 0.25 h)
  let Td = select(Tg, skinT(a.x, 0.25), debris);
  return vec4f(gas, dust, Tg, Td);
}

fn smokeOn() -> bool { return U0.smoke0.w > 0.0; }
fn toSmoke(p: vec3f) -> vec3f { return (p - U0.smoke0.xyz) / U0.smoke0.w; }
fn sCell(c: vec3i, G: i32) -> u32 { return u32(c.x + G * (c.y + G * c.z)) * NCH; }

@compute @workgroup_size(64)
fn cs_smokeScatter(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let ii = wg.x + wg.y * 65535u;
  if (ii >= arrayLength(&pTag)) { return; }
  let m = pVel[ii].w;
  if (m <= 0.0) { return; }
  let s = smokeOf(ii);
  if (s.x + s.y < 1e-3) { return; }
  let x = pPos[ii].xyz;
  if (removed(x)) { return; }
  let G = i32(U0.smoke1.x);
  let g = toSmoke(x);
  // the kernel: 2.2 h, held to 1.8-5 cells (a vapour particle is large;
  // neighbours must overlap so the gas is one cloud, not a heap of puffs)
  let rc = clamp(2.2 * pPos[ii].w / U0.smoke0.w, 2.6, 5.5);
  let Rk = rc * U0.smoke0.w;
  let lo = max(vec3i(ceil(g - vec3f(rc))), vec3i(0));
  let hi = min(vec3i(floor(g + vec3f(rc))), vec3i(G - 1));
  if (any(hi < lo)) { return; }
  // the kernel (1 - q^2)^3 integrates to 0.6383 Rk^3 over the ball
  let norm = m / (0.6383 * Rk * Rk * Rk);
  let v = pVel[ii].xyz;
  let iron = select(0.0, 1.0, matOf(ii) == 0u);
  let ext = hi - lo + vec3i(1);
  let ex = u32(ext.x);
  let exy = u32(ext.x * ext.y);
  let tot = exy * u32(ext.z);
  let inv = 1.0 / (rc * rc);
  for (var k = li; k < tot; k = k + 64u) {
    let c = lo + vec3i(i32(k % ex), i32((k / ex) % u32(ext.y)), i32(k / exy));
    let d = vec3f(c) - g;
    let q = dot(d, d) * inv;
    if (q < 1.0) {
      let u = 1.0 - q;
      let w = u * u * u * norm;
      let o = sCell(c, G);
      let wg2 = w * s.x;
      let wd = w * s.y;
      let wt = wg2 + wd;
      atomicAdd(&sAcc[o], i32(wg2 * SFIX));
      atomicAdd(&sAcc[o + 1u], i32(wd * SFIX));
      atomicAdd(&sAcc[o + 2u], i32(wg2 * s.z * (SFIX / 1000.0)));
      atomicAdd(&sAcc[o + 3u], i32(wd * s.w * (SFIX / 1000.0)));
      atomicAdd(&sAcc[o + 4u], i32(wt * v.x * SFIX));
      atomicAdd(&sAcc[o + 5u], i32(wt * v.y * SFIX));
      atomicAdd(&sAcc[o + 6u], i32(wt * v.z * SFIX));
      atomicAdd(&sAcc[o + 7u], i32(wt * iron * SFIX));
    }
  }
}

@compute @workgroup_size(4, 4, 4)
fn cs_smokeResolve(@builtin(global_invocation_id) gid: vec3u) {
  let G = i32(U0.smoke1.x);
  let c = vec3i(gid);
  if (any(c >= vec3i(G))) { return; }
  let o = sCell(c, G);
  var a = array<f32, 8>();
  for (var k = 0u; k < NCH; k++) { a[k] = f32(atomicLoad(&sAcc[o + k])) / SFIX; }
  let gas = max(a[0], 0.0);
  let dust = max(a[1], 0.0);
  let wt = gas + dust;
  let Tg = select(0.0, 1000.0 * a[2] / gas, gas > 1e-6);
  let Td = select(0.0, 1000.0 * a[3] / dust, dust > 1e-6);
  let v = select(vec3f(0.0), vec3f(a[4], a[5], a[6]) / wt, wt > 1e-6);
  let iron = select(0.0, clamp(a[7] / wt, 0.0, 1.0), wt > 1e-6);
  textureStore(medOut, c, vec4f(gas, dust, Tg / 1000.0, Td / 1000.0));
  textureStore(velOut, c, vec4f(v, iron));
  if (wt * U0.smoke2.x * U0.smoke0.w < 1e-4) { return; }
  // the bricks of the samples that have this cell as a corner
  let NB = G / 8;
  for (var k = 0; k < 8; k++) {
    let q = c - vec3i(k & 1, (k >> 1u) & 1, (k >> 2u) & 1);
    if (any(q < vec3i(0))) { continue; }
    let b = q / 8;
    atomicMax(&sBricks[u32(b.x + NB * (b.y + NB * b.z))], 1u);
  }
}

// extinction per world unit of a medium sample (no detail)
fn sigmaOf(m: vec4f) -> f32 { return U0.smoke2.x * m.x + U0.smoke2.y * m.y; }
fn medAt(p: vec3f) -> vec4f {
  let G = U0.smoke1.x;
  return textureSampleLevel(medTex, clampSamp, (toSmoke(p) + vec3f(0.5)) / G, 0.0);
}
// the body field at p (0 outside the body volume)
fn bodyAt(p: vec3f) -> f32 {
  if (!volOn()) { return 0.0; }
  let g = toGrid(p);
  let G = U0.vol1.x;
  if (any(g < vec3f(0.0)) || any(g > vec3f(G - 1.0))) { return 0.0; }
  return textureSampleLevel(bodyVol, clampSamp, (g + vec3f(0.5)) / G, 0.0).w;
}

@compute @workgroup_size(4, 4, 4)
fn cs_smokeLight(@builtin(global_invocation_id) gid: vec3u) {
  let G = i32(U0.smoke1.x);
  let c = vec3i(gid);
  if (any(c >= vec3i(G))) { return; }
  let p0 = U0.smoke0.xyz + vec3f(c) * U0.smoke0.w;
  let L = U0.sun.xyz;
  let n = i32(U0.smoke1.z);
  var tau = 0.0;
  var body = 1.0;
  var t = 0.5 * U0.smoke0.w;
  let iso = U0.vol1.y;
  // steps grow: fine near the cell, coarse far out
  var dt = 0.75 * U0.smoke0.w;
  for (var k = 0; k < n; k++) {
    let p = p0 + L * t;
    let g = toSmoke(p);
    if (any(g < vec3f(-1.0)) || any(g > vec3f(f32(G)))) { break; }
    tau += sigmaOf(medAt(p)) * dt;
    let f = bodyAt(p);
    body = min(body, 1.0 - smoothstep(0.7 * iso, 1.2 * iso, f));
    if (body <= 0.0 || tau > 12.0) { break; }
    t += dt;
    dt *= 1.12;
  }
  textureStore(lightOut, c, vec4f(tau, body, 0.0, 0.0));
}

// ── the march ───────────────────────────────────────────────────────────────
fn hgPhase(g: f32, c: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
fn phase2(c: f32, k: f32) -> f32 {
  return U0.smoke5.z * hgPhase(U0.smoke5.x * k, c) + (1.0 - U0.smoke5.z) * hgPhase(U0.smoke5.y * k, c);
}
// The detail at p (0..1, about 0.5 mean): the noise texture in the frame
// of the smoke box, warped by the curl texture, carried along v; two
// phases of the flow, half a period apart, faded across, so the billows
// move with the gas and shear with it and never stretch out.
fn curlAt(p: vec3f) -> vec3f {
  let q = (p - U0.smoke0.xyz) * U0.smoke2.w;
  return textureSampleLevel(curlTex, linSamp3, q * 0.21 + vec3f(0.0, 0.0, 0.05 * U0.smoke5.w), 0.0).xyz;
}
fn detailAt(p: vec3f, v: vec3f, cw: vec3f, lod: f32) -> f32 {
  let sc = U0.smoke2.w;
  let q = (p - U0.smoke0.xyz) * sc;
  let ph = fract(U0.smoke5.w);
  let ph2 = fract(ph + 0.5);
  let span = 0.6 / max(sc, 1e-6);
  let qa = q - v * (ph * span * sc) + 0.45 * cw;
  let qb = q - v * (ph2 * span * sc) + 0.45 * cw + vec3f(0.37, 0.11, 0.73);
  let wa = 1.0 - abs(2.0 * ph - 1.0);
  let na = textureSampleLevel(noiseTex, linSamp3, qa * 0.25, 0.0);
  let nb = textureSampleLevel(noiseTex, linSamp3, qb * 0.25, 0.0);
  let base = mix(nb.x, na.x, wa);
  if (lod > 0.5) { return base; }
  let fa = textureSampleLevel(noiseTex, linSamp3, qa * 0.9, 0.0);
  let fb = textureSampleLevel(noiseTex, linSamp3, qb * 0.9, 0.0);
  let fine = mix(fb.y, fa.y, wa) * 0.6 + mix(fb.z, fa.z, wa) * 0.4;
  return clamp(base - 0.32 * (1.0 - fine), 0.0, 1.0);
}

struct MOut2 { @location(0) col: vec4f, @location(1) aux: vec4f };
struct MV2 { @builtin(position) pos: vec4f };
@vertex
fn vs_smokeFull(@builtin(vertex_index) vi: u32) -> MV2 {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: MV2;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}
fn ign(px: vec2f) -> f32 { return fract(52.9829189 * fract(dot(px, vec2f(0.06711056, 0.00583715)))); }

@fragment
fn fs_smokeMarch(in: MV2) -> MOut2 {
  var o: MOut2;
  o.col = vec4f(0.0);
  // the full-size pixel at the centre of this half-size one
  let fp = in.pos.xy * 2.0;
  let szs = vec2i(textureDimensions(sZs));
  let zt = textureLoad(sZs, clamp(vec2i(fp), vec2i(0), szs - vec2i(1)), 0);
  let zSurf = select(1e9, zt.x, zt.y >= 0.5 && zt.x > 0.0);
  o.aux = vec4f(0.0, 1e9, zSurf, 0.0);
  if (!smokeOn()) { return o; }
  let e = U0.eye.xyz;
  let D = rayAt(fp);           // dot(D, fwd) = 1: t is the view depth
  let dl = length(D);
  let G = U0.smoke1.x;
  let ge = toSmoke(e);
  let gd = D / U0.smoke0.w;
  let sg = select(gd, vec3f(1e-9), abs(gd) < vec3f(1e-9));
  let inv = vec3f(1.0) / sg;
  let ta = (vec3f(0.0) - ge) * inv;
  let tb = (vec3f(G - 1.0) - ge) * inv;
  let tlo = min(ta, tb);
  let thi = max(ta, tb);
  let tEnd = min(min(min(thi.x, thi.y), thi.z), zSurf);
  var t = max(max(max(tlo.x, tlo.y), tlo.z), U0.view.x);
  if (tEnd <= t) { return o; }
  let nSteps = U0.smoke1.y;
  // a step of the whole cube diagonal over the step count, at least
  // 0.6 cell (in view depth)
  let dt = max(1.732 * (G - 1.0) * U0.smoke0.w / nSteps, 0.6 * U0.smoke0.w) / dl;
  t += dt * fract(ign(in.pos.xy) + 0.618034 * U0.smoke1.w);
  let NB = i32(G) / 8;
  let L = U0.sun.xyz;
  let cth = dot(D / dl, L);
  // phase of each multiple-scattering octave (fn phase2 with g k^i)
  let ph0 = phase2(cth, 1.0);
  let ph1 = phase2(cth, 0.5);
  let ph2 = phase2(cth, 0.25);
  let sunC = vec3f(1.0, 0.96, 0.9) * U0.sun.w;
  // the glow of the hot remnant lights the smoke from below (drawn): the
  // black body at the skin cap, less the crust, falling off with distance
  let hot = select(0.0, 1.0 - 0.8 * crustShare(), coolH() >= 0.0);
  let glowC = glow(skinCap(0.6)) * (0.22 * hot);
  let rc = centres[0].xyz;
  let Rr = max(U0.bodies[0].y, 1e-3);
  let pxWorld = 1.0 / U0.fwd.w;
  var Tr = 1.0;
  var col = vec3f(0.0);
  var tw = 0.0;
  var tws = 0.0;
  var t50 = 1e9;
  for (var i = 0; i < 160; i++) {
    if (t >= tEnd || Tr < 0.01) { break; }
    let p = e + t * D;
    let g = toSmoke(p);
    let cc = clamp(vec3i(floor(g)), vec3i(0), vec3i(i32(G) - 2));
    let b = cc / 8;
    if (brickRO[u32(b.x + NB * (b.y + NB * b.z))] == 0u) {
      let b0 = (vec3f(b * 8) - ge) * inv;
      let b1 = (vec3f(b * 8 + vec3i(8)) - ge) * inv;
      let bh = max(b0, b1);
      let tn = min(min(bh.x, bh.y), bh.z);
      t = max(tn, t) + dt * (0.02 + fract(ign(in.pos.xy + vec2f(f32(i))) + 0.618034 * U0.smoke1.w));
      continue;
    }
    // the large-scale wobble: the medium is read at a point moved by the
    // curl field (about 3 cells), so the edge of a cloud is not the
    // smooth shape of the splat kernels
    let cw = curlAt(p);
    let pm = p + cw * (3.0 * U0.smoke0.w * U0.misc.z);
    let m = medAt(pm);
    let s0 = sigmaOf(m);
    if (s0 * dt * dl < 1e-5) { t += dt; continue; }
    let uvw = (toSmoke(pm) + vec3f(0.5)) / G;
    let vi = textureSampleLevel(velTex, clampSamp, uvw, 0.0);
    // detail: fewer octaves on phones (U.smoke1.y under 32 steps)
    let det = detailAt(p, vi.xyz, cw, select(0.0, 1.0, nSteps < 32.0));
    // erosion (the cloudscape model): the shape is the log of the optical
    // depth per cell, 0 at 0.003, 1 at 10, so the whole falloff of the
    // splat (a few cells) is the edge; there only the noise peaks stay,
    // and the edge breaks into billows; deep inside the cloud is whole
    let shape = clamp((log2(max(s0 * U0.smoke0.w, 1e-9)) + 8.4) / 11.7, 0.0, 1.0);
    let er = clamp((det - (1.0 - shape)) / max(shape, 0.08), 0.0, 1.0);
    let dens = mix(1.0, 1.6 * er, U0.misc.z);
    let sg2 = s0 * dens;
    if (sg2 <= 1e-6) { t += dt; continue; }
    let dustShare = clamp(U0.smoke2.y * m.y / max(s0, 1e-9), 0.0, 1.0);
    // the scattering albedo: hot gas absorbs and emits; condensate is a
    // grey-white haze; rock dust is brown; iron darkens both
    let albGas = vec3f(0.42, 0.40, 0.38);
    let albDust = mix(vec3f(0.80, 0.77, 0.73), vec3f(0.56, 0.46, 0.37), smoothstep(1.2, 2.8, m.w));
    var alb = mix(albGas, albDust, dustShare) * (1.0 - 0.45 * vi.w);
    let lt = textureSampleLevel(lightTex, clampSamp, uvw, 0.0);
    let tau = lt.x * mix(1.0, dens, 0.3);
    // the phase is per steradian; x 4 pi puts it on the scale of the
  // surfaces (render radiance = albedo x sun for a white Lambert face)
  let ms = 12.566 * (exp(-tau) * ph0 + 0.5 * exp(-0.5 * tau) * ph1 + 0.25 * exp(-0.25 * tau) * ph2);
    let dg = length(p - rc) / Rr;
    let gl = glowC / (1.0 + dg * dg) * exp(-0.35 * max(dg - 1.0, 0.0) * sigmaOf(m) * Rr * 0.2);
    let amb = vec3f(U0.view.w) * 1.5;
    let scat = alb * (sunC * ms * lt.y + gl * 0.25 + amb);
    // emission: the absorbed share radiates at the drawn temperatures
    // fine dust radiates its heat in seconds: it glows far less than the gas
    // thin hot vapour is not a black body in the visible: 0.5 of one
    let em = (1.0 - alb) * (0.5 * glow(m.z * 1000.0) * (1.0 - dustShare) + 0.3 * glow(m.w * 1000.0) * dustShare) * U0.smoke2.z;
    let S = scat + em;
    let stepL = dt * dl;
    let ex = exp(-sg2 * stepL);
    col += Tr * S * (1.0 - ex);
    let a0 = 1.0 - Tr;
    Tr *= ex;
    let da = (1.0 - Tr) - a0;
    tw += da * t;
    tws += da;
    if (t50 > 1e8 && Tr < 0.5) { t50 = t; }
    t += dt;
  }
  let a = 1.0 - Tr;
  o.col = vec4f(col, a);
  o.aux = vec4f(select(0.0, tw / tws, tws > 1e-4), t50, zSurf, 0.0);
  return o;
}

// ── temporal accumulation ───────────────────────────────────────────────────
@fragment
fn fs_smokeTAA(in: MV2) -> @location(0) vec4f {
  let p = vec2i(in.pos.xy);
  let sz = vec2i(textureDimensions(curTex));
  let cur = textureLoad(curTex, p, 0);
  if (U0.misc.x < 0.5) { return cur; }
  var lo = cur;
  var hi = cur;
  for (var k = 0; k < 9; k++) {
    let q = clamp(p + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), sz - vec2i(1));
    let c = textureLoad(curTex, q, 0);
    lo = min(lo, c);
    hi = max(hi, c);
  }
  let ax = textureLoad(curAux, p, 0);
  // the depth of the light in this pixel (or the surface, or the target)
  var z = ax.x;
  if (z <= 0.0) { z = select(U0.extra.y, ax.z, ax.z < 1e8); }
  let w = U0.eye.xyz + rayAt(in.pos.xy * 2.0) * z;
  let cp = U0.prevVP * vec4f(w, 1.0);
  if (cp.w <= 1e-4) { return cur; }
  let uv = vec2f(0.5 + 0.5 * cp.x / cp.w, 0.5 - 0.5 * cp.y / cp.w);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return cur; }
  let h = textureSampleLevel(histTex, clampSamp, uv, 0.0);
  let hc = clamp(h, lo, hi);
  return mix(hc, cur, 0.12);
}

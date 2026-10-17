// ============================================================================
//  DLA TERRAIN  ·  gpu/fallback.wgsl — a plain ground and sky (CORE)
// ----------------------------------------------------------------------------
//  gpu/fallback.js draws these only when render/ground.js or render/sky.js
//  did not load, so the page never shows an empty frame. Joined after
//  common.wgsl. The ground is a regular grid over the whole terrain; the
//  sky is a gradient with a sun disc. The real look is GROUND and SKY.
//  grep -n targets: "fn vs_ground", "fn fs_ground", "fn vs_shadow", "fn fs_sky"
// ============================================================================

struct FB { grid: vec4f };   // x vertices per side
@group(1) @binding(0) var<uniform> F: FB;

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
};
fn gridPoint(vi: u32) -> vec3f {
  let n = u32(F.grid.x);
  let i = vi % n;
  let j = vi / n;
  let uv = vec2f(f32(i), f32(j)) / f32(n - 1u);
  let xz = G.terrainOrigin.xy + uv * G.terrain.x;
  return vec3f(xz.x, terrainHeight(xz), xz.y);
}
@vertex fn vs_ground(@builtin(vertex_index) vi: u32) -> GOut {
  let p = gridPoint(vi);
  return GOut(G.viewProj * vec4f(p, 1.0), p);
}
@vertex fn vs_shadow(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return SP.viewProj * vec4f(gridPoint(vi), 1.0);
}

fn biomeColor(b: u32) -> vec3f {
  switch (b) {
    case 0u: { return vec3f(0.05, 0.12, 0.2); }    // ocean
    case 1u: { return vec3f(0.76, 0.7, 0.52); }    // beach
    case 2u: { return vec3f(0.8, 0.62, 0.4); }     // desert
    case 3u: { return vec3f(0.62, 0.58, 0.3); }    // savanna
    case 4u: { return vec3f(0.33, 0.5, 0.2); }     // grassland
    case 5u: { return vec3f(0.18, 0.36, 0.14); }   // temperate forest
    case 6u: { return vec3f(0.1, 0.32, 0.1); }     // rainforest
    case 7u: { return vec3f(0.14, 0.26, 0.17); }   // boreal forest
    case 8u: { return vec3f(0.5, 0.5, 0.4); }      // tundra
    case 9u: { return vec3f(0.42, 0.39, 0.36); }   // bare rock
    case 10u: { return vec3f(0.92, 0.94, 0.97); }  // snow
    case 11u: { return vec3f(0.24, 0.32, 0.18); }  // wetland
    case 12u: { return vec3f(0.2, 0.3, 0.32); }    // river
    case 13u: { return vec3f(0.15, 0.25, 0.3); }   // lake
    case 14u: { return vec3f(0.5, 0.48, 0.45); }   // scree
    case 15u: { return vec3f(0.4, 0.52, 0.25); }   // alpine meadow
    default: { return vec3f(0.4, 0.4, 0.35); }
  }
}

@fragment fn fs_ground(v: GOut) -> @location(0) vec4f {
  let xz = v.wp.xz;
  let n = terrainNormal(xz);
  let ao = terrainAO(xz);
  let aux = terrainAux(xz);
  let h01 = clamp((v.wp.y - G.terrain.z) / max(G.terrainOrigin.w - G.terrain.z, 1.0), 0.0, 1.0);
  var alb = mix(vec3f(0.3, 0.42, 0.2), vec3f(0.45, 0.42, 0.38), smoothstep(0.35, 0.7, h01));
  if (G.terrainOrigin.w - G.terrainOrigin.z > 1.0 && textureDimensions(tBiome).x > 1u) {
    let b = biomeColor(biomeAt(xz));
    alb = mix(alb, b, 0.75);
  }
  let slope = 1.0 - n.y;
  alb = mix(alb, vec3f(0.36, 0.33, 0.3), smoothstep(0.3, 0.55, slope));
  alb = mix(alb, vec3f(0.92, 0.94, 0.97), smoothstep(0.75, 0.85, h01) * (1.0 - smoothstep(0.3, 0.5, slope)));
  alb = mix(alb, vec3f(0.18, 0.24, 0.24), clamp(aux.g, 0.0, 1.0) * 0.7);
  if (v.wp.y < G.terrain.z) { alb = mix(alb, vec3f(0.04, 0.1, 0.16), clamp((G.terrain.z - v.wp.y) * 0.05, 0.0, 0.9)); }
  let sh = sunShadow(v.wp, n);
  let ndl = max(dot(n, G.sunDir.xyz), 0.0);
  var col = alb * (G.sunColor.rgb * ndl * sh + G.ambient.rgb * (0.4 + 0.6 * n.y) * ao);
  let dist = length(v.wp - G.camPos.xyz);
  let fog = 1.0 - exp(-dist * max(G.fog.w, 2e-5));
  col = mix(col, G.fog.rgb, fog);
  return vec4f(col, 1.0);
}

struct SOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs_sky(@builtin(vertex_index) i: u32) -> SOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return SOut(vec4f(xy * 2.0 - 1.0, 0.0, 1.0), vec2f(xy.x, 1.0 - xy.y));
}
@fragment fn fs_sky(v: SOut) -> @location(0) vec4f {
  let d = viewRay(v.uv);
  let s = G.sunDir.xyz;
  let day = smoothstep(-0.15, 0.2, s.y);
  let zen = mix(vec3f(0.004, 0.006, 0.015), vec3f(0.18, 0.36, 0.85), day);
  let hor = mix(vec3f(0.02, 0.025, 0.04), vec3f(0.7, 0.75, 0.85), day);
  let sunset = vec3f(1.0, 0.45, 0.15) * (1.0 - smoothstep(0.0, 0.35, abs(s.y))) * pow(max(dot(d, s), 0.0), 3.0);
  var c = mix(hor, zen, pow(clamp(d.y, 0.0, 1.0), 0.45)) * (2.0 + G.ambient.r * 2.0) + sunset * 3.0;
  let mu = dot(d, s);
  c += G.sunColor.rgb * 40.0 * smoothstep(0.99995, 0.99999, mu);
  c += G.sunColor.rgb * 0.15 * pow(max(mu, 0.0), 64.0);
  if (d.y < 0.0) { c = mix(c, G.fog.rgb, (1.0 - smoothstep(-0.1, 0.0, d.y))); }
  return vec4f(c, 1.0);
}

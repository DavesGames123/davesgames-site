// buildings.wgsl — the city buildings (common.wgsl in front).
//
// mesh.js builds the walls, the roofs (flat with a parapet, gable, hip, or
// tiers) and the rooftop units. One vertex is 24 bytes:
//   pos   sint16x4  x, y in 0.5 m; z above the base in 0.1 m; facade top in 0.1 m
//   bat   sint16x2  base height in 0.1 m (lowest ground under the footprint), building height in 0.1 m
//   nrm   snorm8x4  normal xyz, 0
//   attr  unorm8x4  use class / 255, random 0..1, part / 255, style / 255
//   fac   uint16x2  u along the facade run in 0.25 m, run length in 0.25 m
// part: 0 wall, 1 flat roof or ledge, 2 pitched roof, 3 rooftop unit wall,
// 4 rooftop unit top. style: material (low 3 bits) + 16 shopfront + 128
// height estimated (mesh.js styleOf).
// The base follows the terrain overlay: z = base * E + z above base. So a
// building stands on the same exaggerated surface as the ground.
// Colour: by height (G.res.w 0), by use (1), or the facade materials (2):
// glass curtain wall, concrete, brick, stone and render (matOf), tiled
// pitched roofs (roofTone), grey flat roofs and metal rooftop units.
// A wall has a plinth, a taller ground floor (a shopfront when the style
// says so) with a string course over it, floors of windows in bays, corner
// trim, and a cornice band up to the parapet. A facade run holds a whole
// number of bays, so the windows line up with its corners. Glass shows the
// sky and the sun by Fresnel. After dusk the windows are lit by a hash of
// the cell. Every edge of the pattern is box-filtered to the pixel
// (pulseBox, fstep), and the lit cells fade to their mean when a cell is
// under about 2 px, so there is no grain at a distance.
//
// grep: fn vs  fn vsShadow  fn heightColour  fn useColour  fn pulseBox  fn fstep
//       struct Mat  fn matOf  fn roofTone  fn fs

struct VIn {
  @location(0) pos: vec4i,
  @location(1) bat: vec2i,
  @location(2) nrm: vec4f,
  @location(3) attr: vec4f,
  @location(4) fac: vec2u,
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) info: vec4f,   // height m, use class, random, facade top m
  @location(3) @interpolate(flat) pk: vec4f,   // part, style, run length m, 0
  @location(4) wall: vec2f,                     // z above base m, u along the run m
};

@vertex
fn vs(v: VIn) -> VOut {
  let xy = vec2f(v.pos.xy) * 0.5;
  var zr = f32(v.pos.z) * 0.1;
  let base = f32(v.bat.x) * 0.1;
  let part = round(v.attr.z * 255.0);
  // A rooftop unit under about 2 px would only add grain: it sinks into
  // the roof (0.3 m under it) as its metre goes from 0.6 to 0.25 px.
  // The pixel size is the largest of a 1 m step along x, y and z.
  if (part > 2.5) {
    let hRoof = f32(v.bat.y) * 0.1;
    let w0 = vec3f(xy, base * exag() + hRoof);
    let c0 = G.viewProj * vec4f(w0, 1.0);
    let cx = G.viewProj * vec4f(w0 + vec3f(1.0, 0.0, 0.0), 1.0);
    let cy = G.viewProj * vec4f(w0 + vec3f(0.0, 1.0, 0.0), 1.0);
    let cz = G.viewProj * vec4f(w0 + vec3f(0.0, 0.0, 1.0), 1.0);
    let s0 = c0.xy / max(c0.w, 0.001);
    let hres = G.res.xy * 0.5;
    let ppm = max(max(length((cx.xy / max(cx.w, 0.001) - s0) * hres), length((cy.xy / max(cy.w, 0.001) - s0) * hres)), length((cz.xy / max(cz.w, 0.001) - s0) * hres));
    zr = mix(hRoof - 0.3, zr, smoothstep(0.25, 0.6, ppm));
  }
  var o: VOut;
  // A wall foot goes 6 m below the base, so a slope never shows a gap.
  let foot = select(0.0, 6.0, v.pos.z == 0 && part < 0.5);
  let z = base * exag() + zr - foot;
  o.world = vec3f(xy, z);
  o.pos = G.viewProj * vec4f(xy, z, 1.0);
  o.n = v.nrm.xyz;
  o.info = vec4f(f32(v.bat.y) * 0.1, round(v.attr.x * 255.0), v.attr.y, f32(v.pos.w) * 0.1);
  o.pk = vec4f(part, round(v.attr.w * 255.0), f32(v.fac.y) * 0.25, 0.0);
  o.wall = vec2f(zr, f32(v.fac.x) * 0.25);
  return o;
}

// The shadow pass: the same building, seen from the sun.
@vertex
fn vsShadow(v: VIn) -> @builtin(position) vec4f {
  let xy = vec2f(v.pos.xy) * 0.5;
  let z = f32(v.bat.x) * 0.1 * exag() + f32(v.pos.z) * 0.1;
  return G.lightVP * vec4f(xy, z, 1.0);
}

fn heightColour(h: f32) -> vec3f {
  let t = clamp(log2(max(h, 3.0) / 6.0) / log2(60.0), 0.0, 1.0);   // 6 m .. 360 m
  let a = vec3f(0.42, 0.45, 0.50);
  let b = vec3f(0.48, 0.58, 0.70);
  let c = vec3f(0.80, 0.74, 0.62);
  let d = vec3f(0.98, 0.84, 0.60);
  if (t < 0.4) { return mix(a, b, t / 0.4); }
  if (t < 0.75) { return mix(b, c, (t - 0.4) / 0.35); }
  return mix(c, d, (t - 0.75) / 0.25);
}

fn useColour(k: f32) -> vec3f {
  let i = u32(k) & 15u;
  switch i {
    case 1u: { return vec3f(0.82, 0.66, 0.50); }   // residential
    case 2u: { return vec3f(0.48, 0.66, 0.84); }   // commercial and office
    case 3u: { return vec3f(0.62, 0.56, 0.68); }   // industrial
    case 4u: { return vec3f(0.56, 0.78, 0.62); }   // civic, education, medical
    case 5u: { return vec3f(0.92, 0.80, 0.48); }   // religious
    case 6u: { return vec3f(0.70, 0.70, 0.74); }   // transport
    case 7u: { return vec3f(0.86, 0.56, 0.58); }   // entertainment
    default: { return vec3f(0.60, 0.61, 0.63); }   // unknown
  }
}

// Box filter of a pulse train: the share of [x - w/2, x + w/2] where
// fract(x) is in [a, b]. pulseInt is the integral of the pulse from 0.
// The caller moves x near 0 first, so the f32 difference stays exact.
fn pulseInt(x: f32, a: f32, b: f32) -> f32 {
  return floor(x) * (b - a) + clamp(fract(x), a, b) - a;
}
fn pulseBox(x: f32, w: f32, a: f32, b: f32) -> f32 {
  let ww = max(w, 0.001);
  let x0 = floor(x);
  let xl = x - x0;
  return (pulseInt(xl + 0.5 * ww, a, b) - pulseInt(xl - 0.5 * ww, a, b)) / ww;
}
// A step at e, box-filtered over w: 0 below, 1 above.
fn fstep(x: f32, e: f32, w: f32) -> f32 {
  return clamp((x - e) / max(w, 0.0001) + 0.5, 0.0, 1.0);
}

// Facade materials (mesh.js styleOf picks one per building).
//   alb   wall colour            trim  corners, cornice, floor bands
//   cell  bay m, floor m, corner trim m, glass reflection 0..1
//   pane  window in the cell: x0, x1, y0, y1
//   lit   share of the windows lit at night
// tools/facade-check.mjs reads the bay, floor and pane numbers from the
// case lines below, so keep one case on one line.
struct Mat {
  alb: vec3f,
  trim: vec3f,
  cell: vec4f,
  pane: vec4f,
  lit: f32,
};

fn matOf(m: u32, r: f32) -> Mat {
  switch m {
    case 0u: { return Mat(vec3f(0.20, 0.25, 0.30), vec3f(0.56, 0.59, 0.62), vec4f(1.5, 3.9, 0.15, 1.0), vec4f(0.06, 0.94, 0.12, 0.96), 0.5); }
    case 1u: { return Mat(vec3f(0.66, 0.65, 0.62), vec3f(0.52, 0.52, 0.50), vec4f(3.0, 3.4, 0.4, 0.55), vec4f(0.16, 0.84, 0.28, 0.86), 0.42); }
    case 2u: { return Mat(vec3f(0.56, 0.31, 0.23), vec3f(0.82, 0.78, 0.70), vec4f(2.7, 3.2, 0.5, 0.35), vec4f(0.3, 0.7, 0.24, 0.8), 0.42); }
    case 3u: { return Mat(vec3f(0.76, 0.70, 0.58), vec3f(0.64, 0.58, 0.48), vec4f(3.2, 3.8, 0.6, 0.35), vec4f(0.3, 0.7, 0.22, 0.78), 0.38); }
    default: {
      // render: a palette by the building hash (cream, ochre, white, rose)
      let k = fract(r * 7.0);
      var c = vec3f(0.86, 0.80, 0.66);
      if (k > 0.35) { c = vec3f(0.84, 0.66, 0.42); }
      if (k > 0.55) { c = vec3f(0.88, 0.87, 0.84); }
      if (k > 0.8) { c = vec3f(0.86, 0.64, 0.58); }
      return Mat(c, vec3f(0.92, 0.90, 0.86), vec4f(2.9, 3.1, 0.4, 0.3), vec4f(0.32, 0.68, 0.25, 0.78), 0.45);
    }
  }
}

fn roofTone(t: u32) -> vec3f {
  switch t {
    case 0u: { return vec3f(0.60, 0.31, 0.21); }   // terracotta
    case 1u: { return vec3f(0.30, 0.32, 0.36); }   // slate
    case 2u: { return vec3f(0.45, 0.33, 0.26); }   // brown tile
    default: { return vec3f(0.24, 0.24, 0.25); }   // dark grey
  }
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let part = u32(v.pk.x + 0.5);
  let style = u32(v.pk.y + 0.5);
  let run = v.pk.z;
  let top = v.info.w;
  let zr = v.wall.x;
  let r = v.info.z;
  let M = matOf(style & 7u, r);
  let shop = (style & 16u) != 0u;
  // Window cells: x a bay (a whole number of them in the run, so the bays
  // line up with the corners), y a floor. The ground floor is taller: 4.6 m
  // with a shopfront. fy: the ground floor is 0..1, then one per floor.
  let gH = select(M.cell.y * 1.15, 4.6, shop);
  let bays = max(1.0, round(run / M.cell.x));
  let bx = v.wall.y / max(run, 0.01) * bays;
  let fy = select(1.0 + (zr - gH) / M.cell.y, zr / gH, zr < gH);
  // The derivatives come first, in uniform control flow. fw is the pixel
  // size in cells, fu and fz in metres along and up the wall, so every
  // edge of the pattern can be filtered to the pixel.
  let fu = length(vec2f(dpdx(v.wall.y), dpdy(v.wall.y)));
  let fz = length(vec2f(dpdx(zr), dpdy(zr)));
  let fw = vec2f(fu / max(run, 0.01) * bays, fz / M.cell.y);

  let V = normalize(v.world - G.eye.xyz);
  var N = normalize(v.n);
  // no culling: the inner face of a parapet shows, lit as its own side
  let back = dot(N, V) > 0.0;
  if (back) { N = -N; }
  let L = normalize(G.sun.xyz);
  let night = G.sun.w;
  let shade = max(dot(N, L), 0.0) * shadowAt(v.world, N);
  // after dusk the city glow keeps the facades just visible
  let skyAmb = max(mix(G.skyH.rgb, G.skyZ.rgb, 0.6), vec3f(0.10, 0.11, 0.15) * night);
  let light = G.sunCol.rgb * shade + skyAmb * G.sunCol.w * (0.55 + 0.45 * N.z);
  // colour mode: 0 height, 1 use, 2 facade materials
  let facade = G.res.w > 1.5;
  let modeCol = mix(heightColour(v.info.x), useColour(v.info.y), clamp(G.res.w, 0.0, 1.0)) * (0.9 + 0.2 * r);
  let vary = 0.88 + 0.24 * fract(r * 7.31);
  let dist = distance(G.eye.xyz, v.world);

  // roofs, ledges and rooftop units
  if (part != 0u) {
    var alb = modeCol * 0.82;
    if (facade) {
      if (part == 2u) { alb = roofTone((style >> 5u) & 3u) * vary; }
      else if (part >= 3u) { alb = vec3f(0.60, 0.62, 0.63) * select(1.0, 0.86, part == 4u); }
      else { alb = mix(vec3f(0.40, 0.41, 0.41), vec3f(0.56, 0.55, 0.51), fract(r * 3.7)); }
    }
    return vec4f(fogMix(alb * light, dist, v.world.z), 1.0);
  }

  // walls: the surface with its trim, each mask box-filtered to the pixel
  let wallAlb = select(modeCol, M.alb * vary, facade);
  let trimAlb = select(modeCol * 0.72, M.trim, facade);
  let cornice = fstep(zr, top - 0.5, fz);                         // band under the top, and the parapet
  let corner = 1.0 - fstep(min(v.wall.y, run - v.wall.y), M.cell.z, fu);
  let upper = fstep(zr, gH, fz);
  let course = fstep(zr, gH - 0.35, fz) * (1.0 - upper);          // string course over the ground floor
  let slab = select(0.0, pulseBox(fy, fw.y, 0.0, 0.07) * upper, (style & 7u) < 2u);   // floor bands: glass, concrete
  let trim = max(max(cornice, corner), max(course, slab));
  var surf = mix(wallAlb, trimAlb, trim);
  surf *= mix(0.72, 1.0, fstep(zr, 0.7, fz));                     // plinth
  let ao = mix(0.6, 1.0, smoothstep(0.0, 25.0, zr));              // darker at the foot (street canyon)
  var col = surf * light * ao;

  // windows: upper floors, and the ground floor (a shopfront or punched)
  let openW = select(0.0, 1.0, !back && run > 1.5 && v.info.x > 4.0) * (1.0 - cornice) * (1.0 - corner);
  let paneUp = pulseBox(bx, fw.x, M.pane.x, M.pane.y) * pulseBox(fy, fw.y, M.pane.z, M.pane.w) * upper;
  let shopPane = pulseBox(bx, fw.x, 0.07, 0.93) * fstep(zr, 0.3, fz) * (1.0 - fstep(zr, gH - 0.6, fz));
  let homePane = pulseBox(bx, fw.x, M.pane.x, M.pane.y) * pulseBox(zr / gH, fz / gH, M.pane.z, M.pane.w) * (1.0 - upper);
  let pane = (paneUp + select(homePane, shopPane, shop)) * openW;
  // glass: the sky and the sun in it (Fresnel), over a dark interior
  let Rv = reflect(V, N);
  let skyRef = mix(G.skyH.rgb, G.skyZ.rgb, clamp(Rv.z * 1.4, 0.0, 1.0)) * (1.0 - 0.85 * night);
  let fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
  let glint = pow(max(dot(Rv, L), 0.0), 80.0) * shade * fres * 3.0;
  let glass = vec3f(0.035, 0.045, 0.055) + (skyRef * mix(0.12, 0.85, fres) + G.sunCol.rgb * glint) * M.cell.w;
  col = mix(col, glass, pane);

  // lit windows after dusk
  // lit or not: a hash of the cell, so it is stable per window. When a
  // cell is under about 2 px, one pixel would pick one random cell of
  // many: then use the mean of the hash (the lit share and mean colour).
  let seed = u32(r * 65535.0) * 7919u + u32(max(floor(fy), 0.0)) * 104729u + u32(floor(bx) + 4096.0) * 31u + u32(run * 4.0) * 13u;
  let thr = select(1.0 - M.lit - 0.2 * smoothstep(40.0, 0.0, zr), 0.25, shop && zr < gH);
  let on = step(thr, hash11(seed));
  let coolP = select(0.2, 0.7, (style & 7u) == 0u);
  let warm = vec3f(1.0, 0.74, 0.42);
  let cool = vec3f(0.85, 0.92, 1.0);
  let tint = mix(warm, cool, step(1.0 - coolP, hash11(seed + 17u)));
  let meanLit = (1.0 - thr) * mix(warm, cool, coolP);
  let farK = smoothstep(0.4, 0.7, max(fw.x, fw.y));
  col += night * pane * mix(on * tint, meanLit, farK) * 0.85;
  col = fogMix(col, dist, v.world.z);
  return vec4f(col, 1.0);
}

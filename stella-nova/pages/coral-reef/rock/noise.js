// ============================================================================
//  CORAL REEF  ·  rock/noise.js  ·  seeded noise for the rock (DOM-free)
// ----------------------------------------------------------------------------
//  makeNoise(seed) gives a set of noise functions that use one seeded
//  permutation table. All values are deterministic for a seed, in node, in
//  a worker and on the page.
//    n.g3(x, y, z)       gradient noise (improved Perlin), about -1..1
//    n.g2(x, z)          gradient noise in 2D, about -1..1
//    n.fbm2(x, z, oct)   sum of g2 octaves, about -1..1
//    n.ridged3(x, y, z)  1 - |g3|, 0..1, sharp crests at 1
//    n.worley3(x, y, z, out)  out[0] = F1, out[1] = F2 (cell size 1),
//                        out[2] = 0..1 id of the nearest cell
//  mulberry32(seed) is the seeded random source (0 <= r < 1).
//
//  grep -n targets
//    random source ....... "export function mulberry32"
//    noise set ........... "export function makeNoise"
//    worley ............... "function worley3"
// ============================================================================

export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Worley cell offsets: centre, 6 faces, 12 edges, 8 corners.
const ORDER = (() => {
  const o = [];
  for (let n = 0; n <= 3; n++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === n) o.push(dx, dy, dz);
  return new Int8Array(o);
})();

// Gradient directions: the 12 edge midpoints of a cube (Perlin 2002).
const G3 = new Float64Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

export function makeNoise(seed) {
  const rnd = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const P = new Uint8Array(512), M = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { P[i] = p[i & 255]; M[i] = P[i] % 12; }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

  function g3(x, y, z) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    const gr = (h, a, b, c) => { const o = M[h] * 3; return G3[o] * a + G3[o + 1] * b + G3[o + 2] * c; };
    const x1 = x - 1, y1 = y - 1, z1 = z - 1;
    const n000 = gr(AA, x, y, z), n100 = gr(BA, x1, y, z), n010 = gr(AB, x, y1, z), n110 = gr(BB, x1, y1, z);
    const n001 = gr(AA + 1, x, y, z1), n101 = gr(BA + 1, x1, y, z1), n011 = gr(AB + 1, x, y1, z1), n111 = gr(BB + 1, x1, y1, z1);
    const a0 = n000 + u * (n100 - n000), a1 = n010 + u * (n110 - n010);
    const b0 = n001 + u * (n101 - n001), b1 = n011 + u * (n111 - n011);
    const c0 = a0 + v * (a1 - a0), c1 = b0 + v * (b1 - b0);
    return c0 + w * (c1 - c0);
  }

  function g2(x, z) {
    const fx = Math.floor(x), fz = Math.floor(z);
    const X = fx & 255, Z = fz & 255;
    x -= fx; z -= fz;
    const u = fade(x), w = fade(z);
    const gr = (h, a, b) => { const o = M[h] * 3; return G3[o] * a + G3[o + 2] * b + G3[o + 1] * (a - b) * 0.5; };
    const n00 = gr(P[P[X] + Z], x, z), n10 = gr(P[P[X + 1] + Z], x - 1, z);
    const n01 = gr(P[P[X] + Z + 1], x, z - 1), n11 = gr(P[P[X + 1] + Z + 1], x - 1, z - 1);
    const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
    return (a + w * (b - a)) * 1.1;
  }

  function fbm2(x, z, oct = 4) {
    let s = 0, a = 1, n = 0, f = 1;
    for (let o = 0; o < oct; o++) { s += a * g2(x * f + o * 17.3, z * f - o * 9.1); n += a; a *= 0.5; f *= 2.02; }
    return s / n * 1.6;
  }

  function ridged3(x, y, z) { return 1 - Math.abs(g3(x, y, z)); }

  // Worley F1, F2 (distance to the nearest and second-nearest feature
  // point; one point per unit cell, jittered by the permutation table).
  // Cells in the order centre, faces, edges, corners; a cell is skipped
  // when its nearest possible feature point is further than F2 so far.
  function worley3(x, y, z, out) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const lx = [(fx + 0.05) * (fx + 0.05), 0, (1.05 - fx) * (1.05 - fx)];
    const ly = [(fy + 0.05) * (fy + 0.05), 0, (1.05 - fy) * (1.05 - fy)];
    const lz = [(fz + 0.05) * (fz + 0.05), 0, (1.05 - fz) * (1.05 - fz)];
    let f1 = 9, f2 = 9, id = 0;
    for (let o = 0; o < 81; o += 3) {
      const dx = ORDER[o], dy = ORDER[o + 1], dz = ORDER[o + 2];
      if (lx[dx + 1] + ly[dy + 1] + lz[dz + 1] >= f2) continue;
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const h = P[P[P[cx & 255] + (cy & 255)] + (cz & 255)];
      const h2 = P[h + 37], h3 = P[h2 + 101];
      const px = cx + h / 255 * 0.9 + 0.05 - x, py = cy + h2 / 255 * 0.9 + 0.05 - y, pz = cz + h3 / 255 * 0.9 + 0.05 - z;
      const d = px * px + py * py + pz * pz;
      if (d < f1) { f2 = f1; f1 = d; id = h3; } else if (d < f2) f2 = d;
    }
    out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = id / 255;
    return out;
  }

  return { g3, g2, fbm2, ridged3, worley3 };
}

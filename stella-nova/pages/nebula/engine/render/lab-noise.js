// lab-noise.js: lab part 5 only (not in Unity, not in the shipped artifact). The surface noise texture of
// the gas erosion and the cirrus veils (LAB-LOG part 5 round 1).
//
// Exports (grep -n "^export"):
//   LAB_NOISE_N                      edge of the cube in texels (64)
//   labNoiseData() -> Uint8Array     RGBA8, N^3, tileable in x, y and z (REPEAT wrap)
//   labNoiseTexture(gl) -> WebGLTexture   TEXTURE_3D, LINEAR, REPEAT on all axes
//
// Channels (each one is 0..1, tileable over the cube):
//   R  billow: inverted Worley F1 (1 - F1), 3 octaves of 4, 8 and 16 cells. Round crowns with sharp creases
//      between them: the cauliflower shape of a dense lit body.
//   G  wisp: gradient-free value fBm, 4 octaves of 4, 8, 16 and 32 lattice cells, then a ridge fold
//      1 - |2n - 1| on the two high octaves. Soft curling smoke for thin and ionized gas.
//   B  fine billow: inverted Worley F1 of 16 and 32 cells. The small knots on an eroding edge.
//   A  large value noise of 2 and 4 cells. The slow cover of the cirrus veils.
// The seed is fixed, so the texture is the same on each load. Cost: about 0.3 s on the CPU at N = 64.

export const LAB_NOISE_N = 64;

function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Inverted Worley F1 with P cells per tile, periodic. Output 0..1 (1 at the feature points).
function worley(N, P, seed, out, wgt) {
  const fp = new Float32Array(P * P * P * 3);
  for (let k = 0; k < P * P * P; k++) {
    fp[3 * k] = hash3(k, 1, 7, seed); fp[3 * k + 1] = hash3(k, 2, 11, seed); fp[3 * k + 2] = hash3(k, 3, 13, seed);
  }
  const cs = N / P;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5) / cs, py = (y + 0.5) / cs, pz = (z + 0.5) / cs;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let d2 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const k = ((cx + P) % P) + P * (((cy + P) % P) + P * ((cz + P) % P));
      const ex = cx + fp[3 * k] - px, ey = cy + fp[3 * k + 1] - py, ez = cz + fp[3 * k + 2] - pz;
      const e = ex * ex + ey * ey + ez * ez;
      if (e < d2) d2 = e;
    }
    out[x + N * (y + N * z)] += wgt * Math.max(0, 1 - Math.sqrt(d2) / 0.9);
  }
}

// Value noise with P lattice cells per tile, quintic fade, periodic. Output 0..1.
function value(N, P, seed, out, wgt, ridge) {
  const lat = new Float32Array(P * P * P);
  for (let k = 0; k < lat.length; k++) lat[k] = hash3(k, 5, 17, seed);
  const L = (x, y, z) => lat[(x % P) + P * ((y % P) + P * (z % P))];
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const cs = N / P;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = x / cs, py = y / cs, pz = z / cs;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const u = f(px - ix), v = f(py - iy), w = f(pz - iz);
    const a = L(ix, iy, iz) + u * (L(ix + 1, iy, iz) - L(ix, iy, iz));
    const b = L(ix, iy + 1, iz) + u * (L(ix + 1, iy + 1, iz) - L(ix, iy + 1, iz));
    const c = L(ix, iy, iz + 1) + u * (L(ix + 1, iy, iz + 1) - L(ix, iy, iz + 1));
    const d = L(ix, iy + 1, iz + 1) + u * (L(ix + 1, iy + 1, iz + 1) - L(ix, iy + 1, iz + 1));
    let n = (a + v * (b - a)) + w * ((c + v * (d - c)) - (a + v * (b - a)));
    if (ridge) n = 1 - Math.abs(2 * n - 1);
    out[x + N * (y + N * z)] += wgt * n;
  }
}

function stretch(a) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const s = 1 / Math.max(hi - lo, 1e-6);
  return a.map((v) => (v - lo) * s);
}

let cache = null;
export function labNoiseData() {
  if (cache) return cache;
  const N = LAB_NOISE_N, M = N * N * N;
  const R = new Float32Array(M), G = new Float32Array(M), B = new Float32Array(M), A = new Float32Array(M);
  worley(N, 4, 1, R, 0.625); worley(N, 8, 2, R, 0.25); worley(N, 16, 3, R, 0.125);
  value(N, 4, 4, G, 0.5, false); value(N, 8, 5, G, 0.25, false); value(N, 16, 6, G, 0.15, true); value(N, 32, 7, G, 0.1, true);
  worley(N, 16, 8, B, 0.6); worley(N, 32, 9, B, 0.4);
  value(N, 2, 10, A, 0.6, false); value(N, 4, 11, A, 0.4, false);
  const r = stretch(R), g = stretch(G), b = stretch(B), a = stretch(A);
  const out = new Uint8Array(4 * M);
  for (let i = 0; i < M; i++) {
    out[4 * i] = Math.round(255 * r[i]); out[4 * i + 1] = Math.round(255 * g[i]);
    out[4 * i + 2] = Math.round(255 * b[i]); out[4 * i + 3] = Math.round(255 * a[i]);
  }
  cache = out;
  return out;
}

export function labNoiseTexture(gl) {
  const N = LAB_NOISE_N;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, t);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, labNoiseData());
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_3D, null);
  return t;
}

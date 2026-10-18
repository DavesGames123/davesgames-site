// ============================================================================
//  CORAL REEF  ·  ROV  ·  a stub rock (DOM-free, node and browser)
// ----------------------------------------------------------------------------
//  A small analytic stand-in for the ROCK package (rock/index.js). It has
//  the same shape as the ROCK API that the ROV code reads: sdf, normal,
//  bounds, features and sampleSurface. The ROV tests use it, and
//  createROVs uses it when no rock is given. It is not a terrain to show.
//
//  The field: a rolling floor, a canyon of two walls along z, a vertical
//  arch (a torus half in the floor), a pinnacle and a ledge. Every term is
//  1-Lipschitz (or scaled to be), so sphere tracing on it is safe.
//
//  grep -n targets
//    "export function createStubRock"
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); }
function box(x, y, z, cx, cy, cz, hx, hy, hz) {
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
}

export function createStubRock({ seed = 1, radius = 30 } = {}) {
  const s = radius / 30, ph = (seed % 97) * 0.37;
  const floorY = (x, z) => -2 + 0.9 * Math.sin(0.19 * x / s + ph) * Math.cos(0.15 * z / s - ph) + 0.4 * Math.sin(0.43 * (x + z) / s);
  const arch = { c: [10 * s, 0.6 * s, -6 * s], R: 4 * s, r: 1.1 * s };
  function sdf(x, y, z) {
    let d = (y - floorY(x, z)) * 0.7;
    // canyon: two walls along z, x = +-4, 7 m tall, 22 m long
    const wall = Math.min(box(x, y, z, -4.2 * s, 1.5 * s, 0, 1.2 * s, 4 * s, 11 * s), box(x, y, z, 4.2 * s, 1.5 * s, 0, 1.2 * s, 4 * s, 11 * s));
    d = smin(d, wall, 0.8);
    // arch: a torus in the x = arch.c[0] plane (axis along x)
    const ax = x - arch.c[0], ay = y - arch.c[1], az = z - arch.c[2];
    const q = Math.hypot(ay, az) - arch.R;
    d = smin(d, Math.hypot(q, ax) - arch.r, 0.6);
    // pinnacle: a vertical capsule
    const px = x + 12 * s, pz = z - 8 * s, py = clamp(y, -2, 6 * s);
    d = smin(d, Math.hypot(px, y - py, pz) - 1.6 * s, 1.0);
    // ledge: a slab on a boulder
    d = smin(d, box(x, y, z, -10 * s, 1.2 * s, -12 * s, 3 * s, 0.4 * s, 2 * s), 0.5);
    return d;
  }
  function normal(x, y, z) {
    const e = 0.02;
    const nx = sdf(x + e, y, z) - sdf(x - e, y, z), ny = sdf(x, y + e, z) - sdf(x, y - e, z), nz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  const features = [
    { kind: 'canyon', center: [0, 1.5 * s, 0], size: [5.6 * s, 8 * s, 22 * s] },
    { kind: 'arch', center: [arch.c[0], arch.c[1] + 0.8 * s, arch.c[2]], size: arch.R * 2 },
    { kind: 'pinnacle', center: [-12 * s, 3 * s, 8 * s], size: 3.2 * s },
    { kind: 'ledge', center: [-10 * s, 2 * s, -12 * s], size: [6 * s, 1 * s, 4 * s] },
  ];
  // Seeded points on the surface: sphere-trace down from above.
  function sampleSurface(n, rand, filter) {
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 40; tries++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius * 0.9;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let y = 12 * s;
      for (let i = 0; i < 200; i++) { const d = sdf(x, y, z); if (d < 0.01) break; y -= Math.max(d, 0.01); }
      const nn = normal(x, y, z);
      const p = { p: [x, y, z], n: nn, exposure: clamp(nn[1], 0, 1), overhang: nn[1] < 0 };
      if (!filter || filter(p)) out.push(p);
    }
    return out;
  }
  return {
    stub: true, sdf, normal, features, sampleSurface,
    bounds: { min: [-radius * 1.3, -3.5, -radius * 1.3], max: [radius * 1.3, 8 * s, radius * 1.3] },
    radius,
  };
}

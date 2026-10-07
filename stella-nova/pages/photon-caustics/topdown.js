// ============================================================================
//  PHOTON CAUSTICS 2D  ·  topdown.js — the pool bottom seen from above (no DOM)
// ----------------------------------------------------------------------------
//  The "Pool bottom (top-down)" scene looks straight down through a moving
//  water surface at the floor. The physics is here; topview.js draws it.
//
//  SURFACE. h(x, y) = sum A_i sin(kx_i x + ky_i y + ph_i): a main wave
//  (amplitude A, wavelength, direction, speed), two more waves at other
//  directions, and five small random waves (a fixed seed) for the natural
//  look. Each wave goes at the deep-water speed for its k, v ~ 1/sqrt(k),
//  relative to the main wave; sx is the distance the main wave has gone.
//
//  LIGHT. Parallel sunlight from the zenith angle theta and the azimuth
//  az. At each surface point the ray refracts by Snell's law through the
//  normal (-dh/dx, -dh/dy, 1) and goes to the floor at the depth d. The
//  floor light E is the density of the refracted rays: 1 for flat water.
//    topview.js: the mesh-area method on the GPU. A grid of rays covers
//                the water; each triangle of the grid maps to a triangle
//                of floor, and E = |area on the flat floor| / |area|.
//    splatFloor: photon splatting on the CPU, for the tests: rays on a
//                grid, each adds its power to the floor bin it lands in.
//  Both give the same density; the mesh has no grain.
//
//  EXPORTS
//    topWaves(P) ........... the waves as [{ kx, ky, A, ph }]
//    heightGrad(w, x, y) ... [h, dh/dx, dh/dy]
//    sunDir(P) ............. the direction the light goes, L (unit, z < 0)
//    floorHit(w, x, y, L, n, d) -> { qx, qy, h, tx, ty, tz, Tf }
//    shift0(L, n, d) ....... the floor offset of a ray through flat water
//    splatFloor(o) ......... CPU splat into bins (see the function)
//    topEmit, topAdvance ... photons in flight for flight.js
// ============================================================================
import { fresnel, mulberry, TAU } from './optics2d.js';

const DEG = Math.PI / 180;

// [amplitude factor, k factor, direction offset (deg), sign of travel]
const MIX = [[0.42, 1.93, 40, 1], [0.2, 3.4, -65, -1]];
const RANDOM = (() => {
  const r = mulberry(20261006), out = [];
  for (let i = 0; i < 5; i++) out.push([0.07 + 0.06 * r(), 1.6 + 2.2 * r(), 360 * r(), TAU * r()]);
  return out;
})();

export function topWaves(P) {
  const A = P.amp ?? 0.02, k = TAU / (P.lam ?? 0.8), dir = (P.dir ?? 0) * DEG, sx = P.sx || 0;
  const w = [];
  const add = (a, m, ang, sgn, p0) => {
    const kk = k * m, r = sgn / Math.sqrt(m);
    w.push({ kx: kk * Math.cos(ang), ky: kk * Math.sin(ang), A: A * a, ph: p0 - kk * r * sx });
  };
  add(1, 1, dir, 1, 0);
  if (P.mix ?? 1) {
    for (const [a, m, d, s] of MIX) add(a, m, dir + d * DEG, s, 1.1 * m);
    for (const [a, m, d, p] of RANDOM) add(a, m, d * DEG, 1, p);
  }
  return w;
}

export function heightGrad(w, x, y) {
  let h = 0, gx = 0, gy = 0;
  for (const q of w) {
    const a = q.kx * x + q.ky * y + q.ph, c = q.A * Math.cos(a);
    h += q.A * Math.sin(a); gx += c * q.kx; gy += c * q.ky;
  }
  return [h, gx, gy];
}

// P.ang: the zenith angle of the sun (deg), P.az: its azimuth (deg).
export function sunDir(P) {
  const t = (P.ang ?? 0) * DEG, a = (P.az ?? 0) * DEG;
  return [-Math.sin(t) * Math.cos(a), -Math.sin(t) * Math.sin(a), -Math.cos(t)];
}

function refract3(d, n, eta) {
  const c = -(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]), k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  const s = eta * c - Math.sqrt(k);
  return [eta * d[0] + s * n[0], eta * d[1] + s * n[1], eta * d[2] + s * n[2]];
}

export function floorHit(w, x, y, L, n, d) {
  const [h, gx, gy] = heightGrad(w, x, y), l = Math.hypot(gx, gy, 1), N = [-gx / l, -gy / l, 1 / l];
  const T = refract3(L, N, 1 / n), cosi = -(L[0] * N[0] + L[1] * N[1] + L[2] * N[2]);
  const s = (d + h) / -T[2];
  return { qx: x + T[0] * s, qy: y + T[1] * s, h, tx: T[0], ty: T[1], tz: T[2], Tf: 1 - fresnel(cosi, 1, n) };
}

export function shift0(L, n, d) {
  const T = refract3(L, [0, 0, 1], 1 / n), s = d / -T[2];
  return [T[0] * s, T[1] * s];
}

// CPU photon splatting. o = { waves, L, n, d, x0, y0, w, h (the rect of
// water the rays start in), nx, ny (rays across it), bins: { x0, y0, w, h,
// nx, ny }, wrap (true: a floor point outside the bin rect wraps round, for
// a periodic surface), fresnel (true: the power of a ray is its Fresnel
// transmittance, else 1) }. Returns { img, total, power }: img the power in
// each bin, total its sum, power the sum of the ray powers.
export function splatFloor(o) {
  const b = o.bins, img = new Float64Array(b.nx * b.ny);
  let total = 0, power = 0;
  for (let j = 0; j < o.ny; j++) for (let i = 0; i < o.nx; i++) {
    const x = o.x0 + (i + 0.5) / o.nx * o.w, y = o.y0 + (j + 0.5) / o.ny * o.h;
    const f = floorHit(o.waves, x, y, o.L, o.n, o.d), p = o.fresnel ? f.Tf : 1;
    power += p;
    let u = (f.qx - b.x0) / b.w, v = (f.qy - b.y0) / b.h;
    if (o.wrap) { u -= Math.floor(u); v -= Math.floor(v); } else if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const bi = Math.min(b.nx - 1, Math.floor(u * b.nx)), bj = Math.min(b.ny - 1, Math.floor(v * b.ny));
    img[bj * b.nx + bi] += p; total += p;
  }
  return { img, total, power };
}

// ── photons in flight, seen from above ──────────────────────────────────────
// A pulse is a flat wave front at right angles to the sunlight. Each photon
// starts in the air at the height HAIR over its surface point, goes down
// the light distance to the surface, then at c/n through the water to the
// floor. The view shows x and y; the size of the head shows the height.
// scene = { waves, L, n, d, rect: { x0, y0, w, h } (the floor to land in) }
const HAIR = 0.9;
export function topEmit(scene, count, rand) {
  const { waves, L, n, d, rect } = scene, [s0x, s0y] = shift0(L, n, d), out = [];
  for (let i = 0; i < count; i++) {
    // a surface point whose light lands near the rect
    const x = rect.x0 + rand() * rect.w - s0x, y = rect.y0 + rand() * rect.h - s0y;
    const f = floorHit(waves, x, y, L, n, d), la = (HAIR - f.h) / -L[2];
    const wl = (d + f.h) / -f.tz, nm = 400 + 300 * rand();
    out.push({ x: x - L[0] * la, y: y - L[1] * la, L: 0, end: Infinity, w: f.Tf, col: [1, 1, 1], nm, trail: null,
      wait: L[0] * x + L[1] * y, sx: x, sy: y, la, wl, n, tx: f.tx, ty: f.ty, tz: f.tz, z: HAIR, size: 1 });
  }
  let m = Infinity; for (const p of out) m = Math.min(m, p.wait);
  for (const p of out) p.wait -= m;
  return out;
}
export function topAdvance(scene, ph, D) {
  if (ph.end < Infinity) { ph.L += D; return; }
  if (ph.wait > 0) { const k = Math.min(ph.wait, D); ph.wait -= k; D -= k; if (ph.wait > 0) return; }
  if (!ph.trail) { ph.trail = [ph.x, ph.y, ph.L]; ph.ax = ph.x; ph.ay = ph.y; }
  const L = scene.L, d = scene.d;
  ph.L += D;
  const s = ph.L;
  if (s < ph.la) {
    ph.x = ph.ax + L[0] * s; ph.y = ph.ay + L[1] * s; ph.z = HAIR + L[2] * s;
  } else {
    if (ph.trail.length === 3) ph.trail.push(ph.sx, ph.sy, ph.la);
    const g = Math.min(ph.wl, (s - ph.la) / ph.n);
    ph.x = ph.sx + ph.tx * g; ph.y = ph.sy + ph.ty * g; ph.z = -d * g / ph.wl;
    if (g >= ph.wl) { ph.end = ph.la + ph.wl * ph.n; ph.trail.push(ph.x, ph.y, ph.end); }
  }
  // nearer the eye (higher) shows larger; under water it takes the tint
  ph.size = 0.75 + 0.5 * (ph.z + d) / (HAIR + d);
  ph.col = ph.z < 0 ? [0.7, 0.95, 1] : [1, 0.97, 0.88];
}

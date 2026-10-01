// ============================================================================
//  SDF FORGE  ·  field.js — the same field on the CPU
// ----------------------------------------------------------------------------
//  PURE. codegen.genJS writes the node functions in the same order and with
//  the same operations as the WGSL; this module supplies the library they
//  call (H) and compiles them over the same parameter array P. Picking, the
//  SLICE probe, the tests and the marching cubes worker all read this field.
//
//  A JS number is a double and the GPU works in f32, so the two agree to
//  about 1e-5 on the sample points the CDP check reads back, not to the bit.
//
//  GREP MAP
//    H .................. the library (shapes, warps, distance modifiers, ops)
//    compileField ....... document to { L, P, mapD, mapM, ghostD, update }
//    grad / normal ...... central differences
//    march .............. a plain sphere tracer for picking
//    traceProbe ......... the SLICE probe: plain or over-relaxed (Keinert et
//                         al. 2014), every step recorded for the diagram
// ============================================================================
import { buildLayout, packParams, genJS, lipschitz } from './codegen.js';

const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max, floor = Math.floor;
const clamp = (x, a, b) => min(b, max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const boxD = (x, y, z, bx, by, bz) => {
  const qx = abs(x) - bx, qy = abs(y) - by, qz = abs(z) - bz;
  const ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0);
  return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, max(qy, qz)), 0);
};
function hash3(x, y, z) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) * (2 / 16777215) - 1;
}
export function vnoise(px, py, pz) {
  const fx = floor(px), fy = floor(py), fz = floor(pz);
  const ix = fx | 0, iy = fy | 0, iz = fz | 0;
  const tx = px - fx, ty = py - fy, tz = pz - fz;
  const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty), uz = tz * tz * (3 - 2 * tz);
  const a = mix(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux);
  const b = mix(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux);
  const c = mix(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux);
  const d = mix(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux);
  return mix(mix(a, b, uy), mix(c, d, uy), uz);
}

export const H = {
  xf(p, P, o) {
    const x = p[0] - P[o], y = p[1] - P[o + 1], z = p[2] - P[o + 2];
    return [P[o + 4] * x + P[o + 5] * y + P[o + 6] * z, P[o + 8] * x + P[o + 9] * y + P[o + 10] * z, P[o + 12] * x + P[o + 13] * y + P[o + 14] * z];
  },
  sdm: (d, P, o) => ({ d, c: [P[o], P[o + 1], P[o + 2]], r: P[o + 3], mt: P[o + 4], id: P[o + 5] }),
  sdNone: () => ({ d: 1e9, c: [0.6, 0.6, 0.6], r: 0.5, mt: 0, id: -1 }),
  sdSphere: (p, P, o) => sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - P[o],
  sdBox: (p, P, o) => boxD(p[0], p[1], p[2], P[o] * 0.5, P[o + 1] * 0.5, P[o + 2] * 0.5),
  sdRoundBox(p, P, o) {
    const r = clamp(P[o + 3], 0, min(P[o], min(P[o + 1], P[o + 2])) * 0.5);
    return boxD(p[0], p[1], p[2], P[o] * 0.5 - r, P[o + 1] * 0.5 - r, P[o + 2] * 0.5 - r) - r;
  },
  sdCylinder(p, P, o) {
    const dx = abs(sqrt(p[0] * p[0] + p[2] * p[2])) - P[o], dy = abs(p[1]) - P[o + 1] * 0.5;
    const ox = max(dx, 0), oy = max(dy, 0);
    return min(max(dx, dy), 0) + sqrt(ox * ox + oy * oy);
  },
  sdCone(p, P, o) {
    const h = P[o + 2] * 0.5, r1 = P[o], r2 = P[o + 1];
    const qx = sqrt(p[0] * p[0] + p[2] * p[2]), qy = p[1];
    const k1x = r2, k1y = h, k2x = r2 - r1, k2y = 2 * h;
    const cax = qx - min(qx, qy < 0 ? r1 : r2), cay = abs(qy) - h;
    const t = clamp(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1);
    const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t;
    const s = (cbx < 0 && cay < 0) ? -1 : 1;
    return s * sqrt(min(cax * cax + cay * cay, cbx * cbx + cby * cby));
  },
  sdTorus(p, P, o) { const a = sqrt(p[0] * p[0] + p[2] * p[2]) - P[o]; return sqrt(a * a + p[1] * p[1]) - P[o + 1]; },
  sdPlane: (p) => p[1],
  sdCapsule(p, P, o) { const h = P[o + 1] * 0.5, y = p[1] - clamp(p[1], -h, h); return sqrt(p[0] * p[0] + y * y + p[2] * p[2]) - P[o]; },
  sdOcta(p0, P, o) {
    const s = P[o], px = abs(p0[0]), py = abs(p0[1]), pz = abs(p0[2]);
    const m = px + py + pz - s;
    let qx, qy, qz;
    if (3 * px < m) { qx = px; qy = py; qz = pz; }
    else if (3 * py < m) { qx = py; qy = pz; qz = px; }
    else if (3 * pz < m) { qx = pz; qy = px; qz = py; }
    else return m * 0.57735027;
    const k = clamp(0.5 * (qz - qy + s), 0, s);
    const b = qy - s + k, c = qz - k;
    return sqrt(qx * qx + b * b + c * c);
  },
  sdLink(p, P, o) {
    const y = max(abs(p[1]) - P[o], 0);
    const a = sqrt(p[0] * p[0] + y * y) - P[o + 1];
    return sqrt(a * a + p[2] * p[2]) - P[o + 2];
  },
  sdHex(p0, P, o) {
    const kx = -0.8660254, ky = 0.5, kz = 0.57735;
    let px = abs(p0[0]), py = abs(p0[2]); const pz = abs(p0[1]);
    const t = 2 * min(kx * px + ky * py, 0);
    px -= t * kx; py -= t * ky;
    const hx = P[o];
    const ex = px - clamp(px, -kz * hx, kz * hx), ey = py - hx;
    const dx = sqrt(ex * ex + ey * ey) * Math.sign(py - hx), dy = pz - P[o + 1] * 0.5;
    const ox = max(dx, 0), oy = max(dy, 0);
    return min(max(dx, dy), 0) + sqrt(ox * ox + oy * oy);
  },
  sdEllipsoid(p, P, o) {
    const rx = P[o], ry = P[o + 1], rz = P[o + 2];
    const ax = p[0] / rx, ay = p[1] / ry, az = p[2] / rz;
    const bx = ax / rx, by = ay / ry, bz = az / rz;
    const k0 = sqrt(ax * ax + ay * ay + az * az), k1 = sqrt(bx * bx + by * by + bz * bz);
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -min(rx, min(ry, rz));
  },
  wTwist(p, P, o) { const a = P[o] * p[1], c = Math.cos(a), s = Math.sin(a); return [c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]]; },
  wBend(p, P, o) { const a = P[o] * p[0], c = Math.cos(a), s = Math.sin(a); return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; },
  wElong(p, P, o) { return [p[0] - clamp(p[0], -P[o], P[o]), p[1] - clamp(p[1], -P[o + 1], P[o + 1]), p[2] - clamp(p[2], -P[o + 2], P[o + 2])]; },
  wRepeat(p, P, o) {
    const s = P[o], out = [0, 0, 0];
    for (let j = 0; j < 3; j++) { const n = floor(P[o + 1 + j] + 0.5); out[j] = p[j] - s * clamp(floor(p[j] / s + 0.5), -n, n); }
    return out;
  },
  wMirror(p, P, o) {
    const w = P[o + 3], out = [0, 0, 0];
    for (let j = 0; j < 3; j++) out[j] = P[o + j] >= 0.5 ? abs(p[j]) - w : p[j];
    return out;
  },
  dRound: (d, p, P, o) => d - P[o],
  dOnion: (d, p, P, o) => abs(d) - P[o],
  dDisplace: (d, p, P, o) => d + P[o] * vnoise(p[0] * P[o + 1], p[1] * P[o + 1], p[2] * P[o + 1]),
  opU: min,
  opS: (a, b) => max(a, -b),
  opI: max,
  smU(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); },
  smS(a, b, k) { const h = clamp(0.5 - 0.5 * (a + b) / k, 0, 1); return mix(a, -b, h) + k * h * (1 - h); },
  smI(a, b, k) { const h = clamp(0.5 - 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) + k * h * (1 - h); },
  moU: (a, b) => (b.d < a.d ? b : a),
  moS: (a, b) => ({ ...a, d: max(a.d, -b.d) }),
  moI: (a, b) => (b.d > a.d ? b : a),
  msU(a, b, k) {
    const h = clamp(0.5 + 0.5 * (b.d - a.d) / k, 0, 1);
    return { d: mix(b.d, a.d, h) - k * h * (1 - h), c: [0, 1, 2].map(i => mix(b.c[i], a.c[i], h)), r: mix(b.r, a.r, h), mt: mix(b.mt, a.mt, h), id: h > 0.5 ? a.id : b.id };
  },
  msS(a, b, k) { const h = clamp(0.5 - 0.5 * (a.d + b.d) / k, 0, 1); return { ...a, d: mix(a.d, -b.d, h) + k * h * (1 - h) }; },
  msI(a, b, k) {
    const h = clamp(0.5 - 0.5 * (b.d - a.d) / k, 0, 1);
    return { d: mix(b.d, a.d, h) + k * h * (1 - h), c: [0, 1, 2].map(i => mix(b.c[i], a.c[i], h)), r: mix(b.r, a.r, h), mt: mix(b.mt, a.mt, h), id: h > 0.5 ? a.id : b.id };
  },
};

// Compile a document. update(doc) repacks the numbers in place; it is valid
// only while the structure (layout.sig) is unchanged.
export function compileField(doc) {
  const L = buildLayout(doc);
  const P = packParams(doc, L);
  const src = genJS(doc, L);
  const f = new Function('P', 'H', src)(P, H);
  const F = {
    L, P, src, stepK: 1 / lipschitz(doc),
    mapD: (x, y, z) => f.mapD([x, y, z]),
    mapM: (x, y, z) => f.mapM([x, y, z]),
    ghostD: (x, y, z, w) => f.ghostD([x, y, z], w),
    update(d2) { packParams(d2, L, P); F.stepK = 1 / lipschitz(d2); },
  };
  return F;
}

export function grad(F, x, y, z, e = 1e-3) {
  return [
    F.mapD(x + e, y, z) - F.mapD(x - e, y, z),
    F.mapD(x, y + e, z) - F.mapD(x, y - e, z),
    F.mapD(x, y, z + e) - F.mapD(x, y, z - e)].map(v => v / (2 * e));
}
export function normal(F, p) { const g = grad(F, p[0], p[1], p[2]); const l = Math.hypot(...g) || 1; return g.map(v => v / l); }

// A plain sphere tracer. eps grows with t so a click far away still lands.
export function march(F, o, r, opt = {}) {
  const tmax = opt.tmax ?? 200, steps = opt.steps ?? 256, k = opt.k ?? F.stepK, pix = opt.pix ?? 1e-3;
  let t = opt.t0 ?? 0;
  for (let i = 0; i < steps; i++) {
    const d = F.mapD(o[0] + r[0] * t, o[1] + r[1] * t, o[2] + r[2] * t);
    if (Math.abs(d) < Math.max(1e-4, pix * t)) return { hit: true, t, i };
    t += d * k;
    if (t > tmax) break;
  }
  return { hit: false, t, i: steps };
}

// The SLICE probe. Every step is kept for the diagram: { t, d, fail }.
// Over-relaxation steps by w d; when the new sphere does not reach back to
// the old one, the big step may have skipped a surface, so the tracer goes
// back to the last good point and steps by d with w = 1 from then on.
export const EPS = 1e-3;
export function traceProbe(F, o, r, opt = {}) {
  const maxSteps = opt.maxSteps || 128, sc = opt.stepScale ?? 1, tmax = opt.tmax ?? 40;
  let w = opt.relax ? (opt.omega || 1.6) : 1;
  let t = 0, prevR = 0, stepLen = 0, tPrev = 0;
  const steps = [];
  for (let i = 0; i < maxSteps; i++) {
    const d = F.mapD(o[0] + r[0] * t, o[1] + r[1] * t, o[2] + r[2] * t);
    const rad = Math.abs(d) * sc;
    if (w > 1 && (rad + prevR < stepLen || d < 0)) {
      steps.push({ t, d, fail: true });
      t = tPrev + prevR; w = 1; stepLen = prevR; prevR = 0;
      continue;
    }
    steps.push({ t, d, fail: false });
    if (d < EPS) return { steps, hit: true, t, n: steps.length };
    tPrev = t; prevR = rad; stepLen = w * d * sc;
    t += stepLen;
    if (t > tmax) break;
  }
  return { steps, hit: false, t, n: steps.length };
}

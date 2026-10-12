// ============================================================================
//  PLANET COLLISION  ·  build.js — bodies in hydrostatic balance, and the
//  impact geometry (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  PROFILE. profile(body) solves the structure of a layered fluid body in
//  code units (G = 1):  dm/dr = 4 pi r^2 rho,  dP/dr = -m rho / r^2.
//  Each layer is on its cold compression curve: rho(P) inverts
//  P = tillotson(rho, u_cold(rho)) (eos.js). A shooting search finds the
//  centre pressure that gives the body's real mass at P = 0. The radius is
//  an output: the model radius differs from the real one because Tillotson
//  is a simple EOS and the bodies start cold (profile().R, tests.mjs 2).
//
//  PARTICLES. bodyParticles() places n equal-mass particles in shells.
//  Each shell is one particle spacing (m / rho)^(1/3) thick, its count is
//  its mass over m, and its points are a Fibonacci sphere with a random
//  rotation. Layer edges are shell edges, so no shell mixes materials.
//  The SPH relax step (engine.js relax, sph.js relax) removes what is left
//  of the lattice noise.
//
//  IMPACT. impactGeometry() puts two bodies on the two-body (point mass)
//  orbit that meets at contact (|X2 - X1| = R1 + R2) with speed vImp and
//  impact parameter b = sin(theta), and runs it back to a start distance
//  d0. All in the frame of the centre of mass.
//
//  buildScenario(sc, N, seed) does it all: the setup that engine.js
//  upload() and sph.js CpuSPH take (CONTRACT.md "Setup").
//
//  grep -n targets: "export function profile", "export function bodyParticles",
//  "export function impactGeometry", "export function buildScenario",
//  "export function splitCount", "export function rng"
// ============================================================================
import { BODIES, MATERIALS, UNIT } from './data.js';
import { tillotson, uCold, matCode } from './eos.js';

export const ETA_H = 1.25;  // h = ETA_H (m / rho)^(1/3): about 82 neighbours in 2h (Wendland C2)

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The cold barotrope of a code-unit material as a table: eta 1..ETA_TOP.
const ETA_TOP = 8, NTAB = 4000;
const tabs = new Map();
function barotrope(m) {
  let t = tabs.get(m.id);
  if (t) return t;
  const eta = new Float64Array(NTAB), P = new Float64Array(NTAB);
  for (let k = 0; k < NTAB; k++) {
    const e = 1 + (ETA_TOP - 1) * (k / (NTAB - 1)) ** 2;
    eta[k] = e; P[k] = tillotson(m, m.rho0 * e, uCold(m, e));
  }
  t = { eta, P }; tabs.set(m.id, t);
  return t;
}
// rho from P on the cold barotrope (P <= 0: rho0)
export function rhoOfP(m, p) {
  if (p <= 0) return m.rho0;
  const { eta, P } = barotrope(m);
  if (p >= P[NTAB - 1]) return m.rho0 * eta[NTAB - 1];
  let lo = 0, hi = NTAB - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P[mid] <= p) lo = mid; else hi = mid; }
  const f = (p - P[lo]) / (P[hi] - P[lo]);
  return m.rho0 * (eta[lo] + f * (eta[hi] - eta[lo]));
}

function layersOf(body) {
  let cum = 0;
  return body.layers.map(([key, f]) => { cum += f; return { mat: matCode(MATERIALS[key]), key, top: cum }; });
}

// One integration from centre pressure Pc. Returns arrays when keep.
function integrate(M, layers, Pc, Rg, keep) {
  const nStep = 3000, dr = 2 * Rg / nStep;
  const layerAt = m => { for (let i = 0; i < layers.length; i++) if (m < layers[i].top * M) return i; return layers.length - 1; };
  let r = 1e-6 * Rg, li = 0, rho = rhoOfP(layers[0].mat, Pc), m = 4 / 3 * Math.PI * r ** 3 * rho, P = Pc;
  const out = keep ? { r: [0], m: [0], rho: [rho], P: [Pc], layer: [0] } : null;
  const f = (rr, mm, pp, L) => { const rh = rhoOfP(layers[L].mat, pp); return [4 * Math.PI * rr * rr * rh, -mm * rh / (rr * rr)]; };
  for (let s = 0; s < 4 * nStep; s++) {
    li = layerAt(m);
    const k1 = f(r, m, P, li), k2 = f(r + dr / 2, m + dr / 2 * k1[0], P + dr / 2 * k1[1], li);
    const k3 = f(r + dr / 2, m + dr / 2 * k2[0], P + dr / 2 * k2[1], li), k4 = f(r + dr, m + dr * k3[0], P + dr * k3[1], li);
    const m2 = m + dr / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const P2 = P + dr / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    if (P2 <= 0) {
      const fr = P / (P - P2), R = r + fr * dr, mR = m + fr * (m2 - m);
      if (keep) { out.r.push(R); out.m.push(mR); out.rho.push(layers[li].mat.rho0); out.P.push(0); out.layer.push(li); }
      return { R, mR, out };
    }
    r += dr; m = m2; P = P2;
    if (keep) { out.r.push(r); out.m.push(m); out.rho.push(rhoOfP(layers[li].mat, P)); out.P.push(P); out.layer.push(li); }
  }
  return { R: r, mR: m, out };
}

// body: a data.js BODIES row (or { mass, layers }), massScale optional.
// Returns code units: { M, R, Pc, r, m, rho, P, layer, layers, edges }.
const profCache = new Map();
export function profile(body, massScale = 1) {
  const key = JSON.stringify([body.mass, body.layers, massScale]);
  if (profCache.has(key)) return profCache.get(key);
  const M = body.mass * massScale / UNIT.M, layers = layersOf(body);
  let vol = 0; for (let i = 0; i < layers.length; i++) vol += (layers[i].top - (i ? layers[i - 1].top : 0)) * M / layers[i].mat.rho0;
  const Rg = Math.cbrt(3 * vol / (4 * Math.PI));
  // shoot on log Pc: mass at the surface grows with Pc
  let lo = Math.log(1e-14), hi = Math.log(10);
  for (let it = 0; it < 70; it++) {
    const mid = 0.5 * (lo + hi), res = integrate(M, layers, Math.exp(mid), Rg, false);
    if (res.mR < M) lo = mid; else hi = mid;
  }
  const Pc = Math.exp(0.5 * (lo + hi)), res = integrate(M, layers, Pc, Rg, true);
  const o = res.out, edges = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const mt = layers[i].top * M; let k = 1;
    while (k < o.m.length && o.m[k] < mt) k++;
    const f = (mt - o.m[k - 1]) / (o.m[k] - o.m[k - 1] || 1);
    edges.push(o.r[k - 1] + f * (o.r[k] - o.r[k - 1]));
  }
  // scale the mass column so it ends at M exactly (the shooting error is ~1e-12)
  const sc = M / o.m[o.m.length - 1];
  const p = { M, R: res.R, Pc, r: o.r, m: o.m.map(x => x * sc), rho: o.rho, P: o.P, layer: o.layer, layers, edges };
  profCache.set(key, p);
  return p;
}

// interpolation of a profile column at radius x
function at(p, col, x) {
  const r = p.r; if (x <= 0) return col[0]; if (x >= r[r.length - 1]) return col[col.length - 1];
  let lo = 0, hi = r.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r[mid] <= x) lo = mid; else hi = mid; }
  const f = (x - r[lo]) / (r[hi] - r[lo] || 1);
  return col[lo] + f * (col[hi] - col[lo]);
}
function radiusOfMass(p, mm) {
  const m = p.m; let lo = 0, hi = m.length - 1;
  if (mm <= 0) return 0; if (mm >= m[hi]) return p.r[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m[mid] <= mm) lo = mid; else hi = mid; }
  const f = (mm - m[lo]) / (m[hi] - m[lo] || 1);
  return p.r[lo] + f * (p.r[hi] - p.r[lo]);
}
function randRot(R) {
  // uniform random rotation (Shoemake): unit quaternion -> matrix
  const u1 = R(), u2 = R() * 2 * Math.PI, u3 = R() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  const x = a * Math.sin(u2), y = a * Math.cos(u2), z = b * Math.sin(u3), w = b * Math.cos(u3);
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

// n equal-mass particles for profile p, centred at 0. Returns
// { n, mp, pos (3n), u (n), h (n), mat (n, material id), rho (n), layer (n) }.
export function bodyParticles(p, n, R) {
  const mp = p.M / n, pos = new Float64Array(3 * n), u = new Float64Array(n), h = new Float64Array(n);
  const mat = new Uint8Array(n), rho = new Float64Array(n), layer = new Uint8Array(n);
  const stops = [...p.edges, p.R];
  let r0 = 0, placed = 0, carry = 0, li = 0;
  while (placed < n && r0 < p.R) {
    const edge = stops[li];
    let s = Math.cbrt(mp / at(p, p.rho, r0));
    s = Math.cbrt(mp / at(p, p.rho, Math.min(r0 + 0.5 * s, edge)));
    let r1 = r0 + s;
    if (r1 > edge - 0.5 * s) r1 = edge;
    const dm = at(p, p.m, r1) - at(p, p.m, r0);
    const last = r1 >= p.R - 1e-12;
    let k;
    if (last) k = n - placed;
    else { const nf = dm / mp + carry; k = Math.max(0, Math.round(nf)); carry = nf - k; k = Math.min(k, n - placed); }
    if (k > 0) {
      const m0 = at(p, p.m, r0), rm = k === 1 && r0 === 0 ? 0 : radiusOfMass(p, m0 + 0.5 * dm);
      const Rm = randRot(R), L = p.layers[li], rh = at(p, p.rho, rm);
      const eta = rh / L.mat.rho0, hh = ETA_H * Math.cbrt(mp / rh);
      for (let q = 0; q < k; q++) {
        const z = 1 - (2 * q + 1) / k, rr = Math.sqrt(Math.max(0, 1 - z * z)), ph = q * 2.399963229728653;
        const v = [rr * Math.cos(ph), rr * Math.sin(ph), z];
        const i = placed + q;
        for (let c = 0; c < 3; c++) pos[3 * i + c] = rm * (Rm[3 * c] * v[0] + Rm[3 * c + 1] * v[1] + Rm[3 * c + 2] * v[2]);
        u[i] = uCold(L.mat, eta); h[i] = hh; mat[i] = L.mat.id; rho[i] = rh; layer[i] = li;
      }
      placed += k;
    }
    r0 = r1;
    if (r0 >= edge - 1e-12 && li < stops.length - 1) li++;
  }
  return { n, mp, pos, u, h, mat, rho, layer };
}

// Two-body approach. M1, M2, R1, R2 code units; o: { vImp (code) or
// vRel (in units of the mutual escape speed), b (sin of the impact angle),
// d0 (start distance over R1 + R2) }.
export function impactGeometry(M1, M2, R1, R2, o = {}) {
  const Mt = M1 + M2, Rs = R1 + R2, vesc = Math.sqrt(2 * Mt / Rs);
  const vImp = o.vImp != null ? o.vImp : (o.vRel != null ? o.vRel : 1) * vesc;
  const b = Math.min(Math.max(o.b != null ? o.b : 0, 0), 0.999);
  const L = vImp * Rs * b;
  let d0 = (o.d0 || 1.6) * Rs, v0, vt;
  for (let it = 0; it < 60; it++) {
    v0 = Math.sqrt(Math.max(0, vImp * vImp - 2 * Mt * (1 / Rs - 1 / d0)));
    vt = L / d0;
    if (v0 >= vt * 1.0001 && v0 > 0) break;
    d0 = Rs + 0.8 * (d0 - Rs);   // a bound orbit cannot reach this far out: start closer
  }
  const vr = -Math.sqrt(Math.max(0, v0 * v0 - vt * vt));
  const r = [d0, 0, 0], v = [vr, vt, 0];
  const X1 = r.map(x => -M2 / Mt * x), X2 = r.map(x => M1 / Mt * x);
  const V1 = v.map(x => -M2 / Mt * x), V2 = v.map(x => M1 / Mt * x);
  // time to contact on the point-mass orbit (RK4, relative coordinates)
  let s = [d0, 0, vr, vt], t = 0;
  const acc = q => { const rr = Math.hypot(q[0], q[1]), k = -Mt / rr ** 3; return [q[2], q[3], k * q[0], k * q[1]]; };
  for (let it = 0; it < 200000 && Math.hypot(s[0], s[1]) > Rs; it++) {
    const rr = Math.hypot(s[0], s[1]), h = Math.min(1e-3 * rr / Math.hypot(s[2], s[3]), 0.01);
    const k1 = acc(s), k2 = acc(s.map((x, j) => x + h / 2 * k1[j])), k3 = acc(s.map((x, j) => x + h / 2 * k2[j])), k4 = acc(s.map((x, j) => x + h * k3[j]));
    s = s.map((x, j) => x + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])); t += h;
  }
  const mu = M1 * M2 / Mt;
  return {
    X: [X1, X2], V: [V1, V2], d0, vesc, vImp, b, theta: Math.asin(b) * 180 / Math.PI,
    tContact: t, Ekin: 0.5 * mu * vImp * vImp, QR: 0.5 * mu * vImp * vImp / Mt,
  };
}

// Particle counts per body: proportional to mass, with a floor share fmin
// so a small impactor keeps enough particles (the particle mass then
// differs between bodies; CONTRACT.md "Simplifications").
export function splitCount(masses, N, fmin = 0.12) {
  const Mt = masses.reduce((a, b) => a + b, 0);
  let w = masses.map(m => Math.max(m / Mt, fmin));
  const s = w.reduce((a, b) => a + b, 0); w = w.map(x => x / s);
  const n = w.map(x => Math.max(40, Math.round(x * N)));
  n[0] += N - n.reduce((a, b) => a + b, 0);
  return n;
}

// sc: { bodies: [{ key, massScale?, spinH? (hours, null = none),
//                  layers? (a composition that replaces the data.js
//                  layers: [[material, mass fraction], ...]) }, ...],
//       impact: { vRel | vKms, b, d0 }, place?: [{ X, V }] (bodies 3-4) }
// N: total particles. Returns the setup (CONTRACT.md "Setup").
export function buildScenario(sc, N, seed = 1) {
  const R = rng(seed);
  const specs = sc.bodies.map(b => Object.assign({}, b, { data: b.layers ? Object.assign({}, BODIES[b.key], { layers: b.layers }) : BODIES[b.key] }));
  const profs = specs.map(s => profile(s.data, s.massScale || 1));
  const counts = splitCount(profs.map(p => p.M), N, sc.fmin);
  const parts = profs.map((p, i) => bodyParticles(p, counts[i], R));
  const im = sc.impact || {};
  const g = impactGeometry(profs[0].M, profs[1] ? profs[1].M : 0, profs[0].R, profs[1] ? profs[1].R : 0,
    { vImp: im.vKms != null ? im.vKms * 1000 / UNIT.V : null, vRel: im.vRel, b: im.b, d0: im.d0 });
  const bodies = specs.map((s, i) => {
    const pl = i < 2 ? { X: g.X[i], V: g.V[i] } : (sc.place && sc.place[i - 2]) || { X: [0, 0, 3 * i], V: [0, 0, 0] };
    const spinH = s.spinH !== undefined ? s.spinH : null;
    const W = spinH ? [0, 0, 2 * Math.PI / (spinH * 3600 / UNIT.T)] : [0, 0, 0];
    return { key: s.key, name: s.data.name, M: profs[i].M, R: profs[i].R, Rreal: s.data.radius ? s.data.radius / UNIT.L : null,
      n: counts[i], mp: parts[i].mp, X: pl.X, V: pl.V, W, profile: profs[i] };
  });
  const n = counts.reduce((a, b) => a + b, 0);
  const pos = new Float64Array(3 * n), mass = new Float64Array(n), u = new Float64Array(n), h = new Float64Array(n);
  const mat = new Uint8Array(n), body = new Uint8Array(n);
  let o = 0;
  parts.forEach((pt, b) => {
    for (let i = 0; i < pt.n; i++, o++) {
      for (let c = 0; c < 3; c++) pos[3 * o + c] = pt.pos[3 * i + c] + bodies[b].X[c];
      mass[o] = pt.mp; u[o] = pt.u[i]; h[o] = pt.h[i]; mat[o] = pt.mat[i]; body[o] = b;
    }
  });
  return { N: n, pos, vel: new Float64Array(3 * n), mass, u, h, mat, body, bodies, impact: g, seed };
}

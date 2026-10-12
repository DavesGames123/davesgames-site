// ============================================================================
//  ANTENNA FIELDS  ·  flow.js — energy flow particles (S = E x H)
// ----------------------------------------------------------------------------
//  DOM-free. The particles move with the energy velocity v = S/u (geom.js
//  energyVelocity), from the instantaneous E and H of the probe grid
//  (field-gl.js readProbe). Far from the antenna |v| = c and the particles
//  move out with the wavefronts. Near it v changes sign twice per cycle, so
//  the particles move out and back: that is the stored (reactive) energy.
//
//  Units: grid cells. One period moves the wavefronts one wavelength, so a
//  particle at v = c moves one wavelength per period.
//
//  createFlow(n, seed) -> { field(probe, phase, axU, axV), step(dt, cyclesPerSec, cellU, cellV),
//                           draw(ctx, W, H, rgb), reset() }
//  grep -n: "function field"  "function step"  "function draw"
// ============================================================================
import { energyVelocity } from './geom.js';

export function createFlow(n = 1200, seed = 7) {
  const T = 14;                           // trail samples per particle
  const x = new Float32Array(n), y = new Float32Array(n), age = new Float32Array(n), life = new Float32Array(n);
  const tr = new Float32Array(n * T * 2), fill = new Uint8Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  let V = null, Wt = null, gw = 0, gh = 0, wref = 1, sub = 0;
  const vv = [0, 0, 0], E = [0, 0, 0], H = [0, 0, 0];

  function spawn(i) {
    x[i] = rnd() * gw; y[i] = rnd() * gh;
    age[i] = 0; life[i] = 1.6 + 2.4 * rnd(); fill[i] = 0;
  }
  function reset() { for (let i = 0; i < n; i++) { spawn(i); age[i] = rnd() * life[i]; } }

  // The in-plane v/c of every probe cell at the phase w t, and a weight
  // (the energy density times r^2 is about constant far out, so the weight
  // uses the brightness of the cell against the 85th percentile).
  function field(probe, phase, axU, axV, rw) {
    const { w, h, T: P } = probe, m = w * h, c = Math.cos(phase), sn = Math.sin(phase);
    if (!V || V.length !== m * 2) { V = new Float32Array(m * 2); Wt = new Float32Array(m); }
    if (gw !== w || gh !== h) { gw = w; gh = h; reset(); }
    const P0 = P[0], P1 = P[1], P2 = P[2], us = [];
    for (let i = 0; i < m; i++) {
      const o = i * 4;
      E[0] = P0[o] * c - P0[o + 1] * sn; E[1] = P0[o + 2] * c - P0[o + 3] * sn; E[2] = P1[o] * c - P1[o + 1] * sn;
      H[0] = P1[o + 2] * c - P1[o + 3] * sn; H[1] = P2[o] * c - P2[o + 1] * sn; H[2] = P2[o + 2] * c - P2[o + 3] * sn;
      energyVelocity(E, H, vv);
      V[2 * i] = vv[0] * axU[0] + vv[1] * axU[1] + vv[2] * axU[2];
      V[2 * i + 1] = vv[0] * axV[0] + vv[1] * axV[1] + vv[2] * axV[2];
      // amplitude (not the instantaneous value), so the weight does not blink
      const a = (P0[o] ** 2 + P0[o + 1] ** 2 + P0[o + 2] ** 2 + P0[o + 3] ** 2 + P1[o] ** 2 + P1[o + 1] ** 2) * (rw ? rw[i] : 1);
      Wt[i] = a;
      if ((i & 7) === 0) us.push(a);
    }
    us.sort((p, q) => p - q);
    wref = us.length ? us[Math.floor(us.length * 0.85)] || 1 : 1;
  }
  // Bilinear v at (gx, gy) in cell-centre coordinates, into o2.
  const o2 = [0, 0];
  function samp(gx, gy) {
    const xx = Math.min(gw - 1.001, Math.max(0, gx - 0.5)), yy = Math.min(gh - 1.001, Math.max(0, gy - 0.5));
    const i = xx | 0, j = yy | 0, fx = xx - i, fy = yy - j, a = (j * gw + i) * 2, b = a + 2, cc = a + gw * 2, d = cc + 2;
    o2[0] = (V[a] * (1 - fx) + V[b] * fx) * (1 - fy) + (V[cc] * (1 - fx) + V[d] * fx) * fy;
    o2[1] = (V[a + 1] * (1 - fx) + V[b + 1] * fx) * (1 - fy) + (V[cc + 1] * (1 - fx) + V[d + 1] * fx) * fy;
    return o2;
  }
  // dt in s; cps: wave cycles per second; cellU, cellV: wavelengths per cell.
  function step(dt, cps, cellU, cellV) {
    if (!V) return;
    const k = cps * dt;                    // wavelengths moved at v = c
    sub = (sub + 1) % 2;
    for (let i = 0; i < n; i++) {
      age[i] += dt;
      if (age[i] > life[i]) { spawn(i); continue; }
      // RK2 (midpoint) in grid units
      samp(x[i], y[i]);
      const ax = o2[0] * k / cellU, ay = o2[1] * k / cellV;
      samp(x[i] + ax / 2, y[i] + ay / 2);
      x[i] += o2[0] * k / cellU; y[i] += o2[1] * k / cellV;
      if (x[i] < 0 || y[i] < 0 || x[i] > gw || y[i] > gh) { spawn(i); continue; }
      if (sub === 0) {
        const o = i * T * 2;
        tr.copyWithin(o + 2, o, o + (T - 1) * 2);
        tr[o] = x[i]; tr[o + 1] = y[i];
        if (fill[i] < T) fill[i]++;
      } else {
        const o = i * T * 2; tr[o] = x[i]; tr[o + 1] = y[i];
        if (!fill[i]) fill[i] = 1;
      }
    }
  }
  // Trails as NB alpha buckets, one path each. rgb: "r,g,b".
  function draw(ctx, W, H, rgb, dpr = 1, alpha = 1) {
    if (!V) return;
    const sx = W / gw, sy = H / gh, NB = 6, paths = Array.from({ length: NB }, () => new Path2D());
    for (let i = 0; i < n; i++) {
      const m = fill[i];
      if (m < 2) continue;
      const gi = Math.min(gw - 1, Math.max(0, x[i] | 0)), gj = Math.min(gh - 1, Math.max(0, y[i] | 0));
      const wgt = Math.min(1, Math.sqrt(Wt[gj * gw + gi] / wref));
      const fade = Math.min(1, age[i] / 0.4, (life[i] - age[i]) / 0.5);
      const a = wgt * fade;
      if (a < 0.06) continue;
      const b = Math.min(NB - 1, Math.floor(a * NB)), o = i * T * 2, p = paths[b];
      p.moveTo(tr[o] * sx, H - tr[o + 1] * sy);
      for (let q = 1; q < m; q++) p.lineTo(tr[o + 2 * q] * sx, H - tr[o + 2 * q + 1] * sy);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 1.3 * dpr;
    paths.forEach((p, b) => { ctx.strokeStyle = `rgba(${rgb},${((b + 0.5) / NB * 0.85 * alpha).toFixed(3)})`; ctx.stroke(p); });
  }
  return { field, step, draw, reset, get n() { return n; } };
}

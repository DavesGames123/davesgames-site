// ============================================================================
//  MUSHROOM DRAW  ·  engine/ground.js — the ground patch, leaves, grass and moss
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. groundItems(C, bodies, rnd)
//  gives the groups of draw items under and around the bodies. C is
//  the shared context of buildSpecimen() in engine.js. Each group has a
//  depth z for the painter order. The ground patch has z = -Infinity.
//
//  GREP MAP
//    grep -n 'export function groundItems'   all ground groups
//    grep -n 'Leaves.'                       the leaf litter
//    grep -n 'Grass tufts.'                  the grass
//    grep -n 'Moss clumps'                   the moss at the stem bases
// ============================================================================
import { clamp, TAU, hashStr, makeNoise } from '../geom.js';
import { hsl } from './shade.js';
import { item } from './items.js';

const PI = Math.PI;

// ── groundItems ─────────────────────────────────────────────────────────────
// The ground patch (a wash and short strokes, behind everything), leaves,
// grass tufts and moss clumps, each with a depth z for the painter order.
export function groundItems(C, bodies, rnd) {
  const { P, seg, ce, colors } = C;
  const out = [];
  const gp = (x, y, z) => [x, z * seg - y * ce];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, maxH = 0, R0 = 0;
  for (const b of bodies) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z); maxH = Math.max(maxH, b.H); R0 = Math.max(R0, b.R); }
  const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
  const Rx = (x1 - x0) / 2 + R0 * 1.15 + 8, Rz = Math.max(Rx * 0.5, (z1 - z0) / 2 + R0 * 0.6);
  const ss = clamp((Rx + maxH * 0.3) / 150, 0.3, 3);
  const nzg = makeNoise(hashStr('ground') ^ (C.seed >>> 0));
  const nearBase = (x, z) => { let d = Infinity; for (const b of bodies) d = Math.min(d, Math.hypot(x - b.x, z - b.z) - b.rBot * 1.6); return d; };
  const inPatch = () => {
    for (let t = 0; t < 40; t++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd());
      const x = xc + Rx * r * Math.cos(a), z = zc + Rz * r * Math.sin(a);
      if (nearBase(x, z) > 2 * ss) return [x, z];
    }
    return [xc + Rx, zc];
  };
  if (P.ground) {
    const g = item('ground', -Infinity);
    const patch = [];
    for (let k = 0; k < 64; k++) {
      const a = k / 64 * TAU, f = 1 + 0.12 * nzg(Math.cos(a) * 2 + 3, Math.sin(a) * 2);
      patch.push(gp(xc + Rx * 1.05 * f * Math.cos(a), 0, zc + Rz * 1.05 * f * Math.sin(a)));
    }
    g.washes.push({ pts: patch, color: colors.ground });
    const n = Math.round(18 + 60 * P.hatch);
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0;
      for (let t = 0; t < 12; t++) {
        [x, z] = inPatch();
        let d = Infinity;
        for (const b of bodies) d = Math.min(d, Math.hypot(x - b.x, (z - b.z) * 1.4));
        if (rnd() < 0.3 + 0.7 * Math.exp(-(d * d) / (2 * R0 * R0 * 0.6))) break;
      }
      const l = (5 + 14 * rnd()) * ss, tilt = (rnd() - 0.5) * 0.12, p = [];
      for (let j = 0; j <= 4; j++) {
        const t = j / 4 - 0.5;
        p.push(gp(x + t * l, 0.4 * ss * nzg(x * 0.1 + j, z * 0.1), z + t * l * tilt));
      }
      g.lines.push({ pts: p, kind: 3, part: 'ground' });
    }
    out.push({ z: -Infinity, items: [g] });
  }
  // Leaves.
  const leafHues = [[22, 0.55, 0.5], [32, 0.6, 0.55], [12, 0.5, 0.42], [45, 0.5, 0.58], [70, 0.3, 0.45]];
  for (let i = 0; i < P.litter; i++) {
    const [cx, cz] = inPatch();
    const L = (16 + 22 * rnd()) * ss, Wd = L * (0.28 + 0.2 * rnd()), th = rnd() * TAU, shape = Math.floor(rnd() * 3);
    const curl = 0.05 * L * rnd();
    const lp = (t, w) => {
      const lx = (t - 0.5) * L, c = Math.cos(th), s = Math.sin(th);
      return gp(cx + lx * c - w * s, curl * (2 * t - 1) * (2 * t - 1) + Math.abs(w) / Wd * curl, cz + (lx * s + w * c) * 0.9);
    };
    const half = t => {
      let w = Wd / 2 * Math.pow(Math.sin(PI * t), shape === 1 ? 1.1 : 0.75);
      if (shape === 2) w *= 0.72 + 0.28 * Math.cos(t * PI * 9);
      return w;
    };
    const outline = [];
    for (let k = 0; k <= 20; k++) outline.push(lp(k / 20, half(k / 20)));
    for (let k = 20; k >= 0; k--) outline.push(lp(k / 20, -half(k / 20)));
    const it = item('leaf', cz);
    it.fill = outline;
    it.lines.push({ pts: outline, kind: 1, part: 'leaf' });
    it.lines.push({ pts: [lp(-0.12, 0), lp(0, 0), lp(0.5, 0), lp(0.97, 0)], kind: 1, part: 'leaf' });
    const nv = 3 + Math.floor(rnd() * 3);
    for (let v = 1; v <= nv; v++) {
      const t = v / (nv + 1) * 0.85 + 0.05;
      for (const sg of [-1, 1]) it.lines.push({ pts: [lp(t, 0), lp(t + 0.12, sg * half(t + 0.12) * 0.8)], kind: 2, part: 'leaf' });
    }
    const lh = leafHues[Math.floor(rnd() * leafHues.length)];
    it.washes.push({ pts: outline, color: hsl(lh[0] + (rnd() - 0.5) * 10, lh[1], lh[2]) });
    out.push({ z: cz, items: [it] });
  }
  // Grass tufts.
  for (let i = 0; i < P.grass; i++) {
    const [cx, cz] = inPatch();
    const it = item('grass', cz), nb = 3 + Math.floor(rnd() * 5);
    for (let k = 0; k < nb; k++) {
      const hb = (18 + 34 * rnd()) * ss, dx = (rnd() - 0.5) * hb * 0.8, x0b = cx + (rnd() - 0.5) * 4 * ss, p = [];
      for (let j = 0; j <= 6; j++) { const t = j / 6; p.push(gp(x0b + dx * t * t, hb * t, cz + (rnd() - 0.5) * 0.5)); }
      it.lines.push({ pts: p, kind: 1, part: 'grass' });
    }
    out.push({ z: cz, items: [it] });
  }
  // Moss clumps at the stem bases.
  if (P.moss > 0.02) {
    for (const b of bodies) {
      if (rnd() > 0.35 + 0.65 * P.moss) continue;
      const cx = b.x + (rnd() - 0.5) * b.rBot, cz = b.z + b.rBot * 0.9;
      const rm = clamp(b.rBot * (0.9 + 0.9 * P.moss), 3 * ss, 0.38 * b.R + 2 * ss) + 2 * ss;
      const it = item('moss', cz), top = [], fill = [];
      const base = gp(cx, 0, cz);
      for (let k = 0; k <= 32; k++) {
        const a = PI + PI * k / 32, bump = 1 + 0.18 * Math.abs(Math.sin(a * 7 + b.seed % 7)) + 0.08 * nzg(k * 0.6, b.seed % 13);
        top.push([base[0] + rm * Math.cos(a), base[1] + rm * 0.42 * Math.sin(a) * bump]);
      }
      fill.push(...top);
      for (let k = 1; k < 16; k++) { const a = PI * (1 - k / 16); fill.push([base[0] + rm * Math.cos(a), base[1] + rm * 0.28 * seg * Math.sin(a)]); }
      it.fill = fill;
      it.lines.push({ pts: top, kind: 1, part: 'moss' });
      const nst = Math.round(8 + 22 * P.moss);
      for (let k = 0; k < nst; k++) {
        const a = PI + PI * (0.1 + 0.8 * rnd()), r = rm * Math.sqrt(rnd()) * 0.8;
        const px = base[0] + r * Math.cos(a), py = base[1] + r * 0.5 * Math.sin(a), s = 0.9 * ss + rm * 0.05;
        it.lines.push({ pts: [[px - s, py], [px - s * 0.4, py - s * 0.8], [px + s * 0.4, py - s * 0.8], [px + s, py]], kind: 2, part: 'moss' });
      }
      it.washes.push({ pts: fill, color: colors.moss });
      out.push({ z: cz, items: [it] });
    }
  }
  return out;
}

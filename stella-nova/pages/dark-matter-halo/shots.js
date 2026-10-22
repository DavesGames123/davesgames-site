// ============================================================================
//  DARK MATTER HALO  ·  shots.js — screensaver logic (DOM-free)
// ----------------------------------------------------------------------------
//  saver.js draws; this module decides what and where, so node tests can
//  check it at 16:9 and at 9:16.
//
//  SHOTS
//    shear     two discs of stars launched at the measured speeds. Left
//              (or top): the pull of the visible matter only, so the outer
//              stars fly off. Right (or bottom): with the dark halo, so
//              the disc holds together.
//    map       the R-z density slice, visible left and dark right, with a
//              slow push-in.
//    profiles  the four halo families drawn from outside in: they agree at
//              the Sun and split apart toward the centre.
//    curve     the rotation curve built out from the centre: visible
//              matter first, then the halo fills the gap to the points.
//
//  THE SHEAR MODEL. Test stars in the midplane feel the radial pull of a
//  rotation-curve table: a(r) = v^2(r) / r toward the centre. Past the end
//  of the table the pull is Keplerian, from the mass the last row implies.
//  This is the spherical approximation of the disc pull; it is labelled
//  illustrative on the plate. Units: kpc, km/s; 1 kpc / (km/s) = 977.8 Myr.
//
//  grep -n targets
//    shot ids, plates ...... "export const SHOTS"
//    seeded plan ........... "export function shotPlan"
//    framing ............... "export function shotLayout"
//    shear model ........... "export function makeShear"
//    one step .............. "export function stepShear"
// ============================================================================
import { rng } from './halo.js';

export const MYR = 1 / 977.8;            // 1 Myr in kpc / (km/s)
export const SHOT_IDS = Object.freeze(['shear', 'map', 'profiles', 'curve']);

export const SHOTS = Object.freeze({
  shear: { title: 'Same speeds, with and without the halo', sub: 'stars launched at the measured orbital speeds',
    tex: ['\\frac{v^2}{r} = \\frac{G\\,M(<r)}{r^2}'], rules: [['M', 'm6']],
    lines: ['Visible matter only: the outer stars escape', 'With the dark halo: the disc holds', 'Star positions illustrative; speeds from McMillan 2017'] },
  map: { title: 'Where the dark matter is', sub: 'a slice through the Milky Way: visible matter left, dark matter right',
    tex: ['\\rho_{\\mathrm{NFW}} = \\frac{\\rho_0}{x\\,(1+x)^2},\\quad x = r / r_s'], rules: [['r_s', 'm4']],
    lines: ['McMillan 2017 mass model, log colour scale', 'Dots: the Sun, 8.21 kpc from the centre'] },
  profiles: { title: 'Four halo shapes, one local density', sub: 'they agree at the Sun and split apart toward the centre',
    tex: ['\\rho(R_\\odot) = 0.30\\text{ to }0.38\\ \\mathrm{GeV\\,cm^{-3}}'], rules: [],
    lines: ['NFW, Einasto, Burkert, cored isothermal', 'Profile families, not fits'] },
  curve: { title: 'The Milky Way spins too fast', sub: 'the visible matter cannot hold the outer stars at the speeds measured',
    tex: ['v_c^2 = v_{\\mathrm{vis}}^2 + v_{\\mathrm{halo}}^2'], rules: [['v_{\\mathrm{vis}}', 'm5'], ['v_{\\mathrm{halo}}', 'm6']],
    lines: ['Dots: Eilers et al. 2019, Jiao et al. 2023', 'Curves: McMillan 2017'] },
});

// A plan of n shots: each run of four is a seeded shuffle of all ids, and
// no id repeats across a seam. Lengths 5 to 12 s; calm makes them longer.
export function shotPlan(seed, n = 64, calm = 0.7) {
  const r = rng((seed >>> 0) || 1), out = [];
  let prev = null;
  while (out.length < n) {
    const ids = [...SHOT_IDS];
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    if (ids[0] === prev) [ids[0], ids[1]] = [ids[1], ids[0]];
    for (const id of ids) {
      const base = id === 'shear' ? 9 : 7;
      const sec = Math.max(5, Math.min(12, base + 2 * calm + (r() - 0.5) * 3));
      out.push({ id, sec });
    }
    prev = ids[ids.length - 1];
  }
  return out.slice(0, n);
}

// Boxes for a shot in a w x h frame with the clear band { t, b } (px from
// the top and from the bottom). Returns { panels: [{ x, y, w, h }], subject:
// { x, y, r } }. Charts keep an aspect between 1.6:1 and 1:1.1; the shear
// panels are square, side by side or stacked, whichever is larger.
export function shotLayout(id, w, h, band = { t: 0, b: 0 }) {
  const top = band.t, bh = Math.max(60, h - band.t - band.b), cx = w / 2, cy = top + bh / 2;
  const mx = Math.max(12, w * 0.04), my = Math.max(8, bh * 0.04);
  const aw = w - 2 * mx, ah = bh - 2 * my;
  let panels;
  if (id === 'shear') {
    // Side by side or stacked: whichever gives the larger panels.
    const gap = Math.max(10, Math.min(aw, ah) * 0.05);
    const sSide = Math.min(ah, (aw - gap) / 2), sStack = Math.min(aw, (ah - gap) / 2);
    const side = sSide >= sStack, s = Math.max(sSide, sStack);
    panels = side
      ? [{ x: cx - gap / 2 - s, y: cy - s / 2, w: s, h: s }, { x: cx + gap / 2, y: cy - s / 2, w: s, h: s }]
      : [{ x: cx - s / 2, y: cy - gap / 2 - s, w: s, h: s }, { x: cx - s / 2, y: cy + gap / 2, w: s, h: s }];
  } else {
    // Wide frames: at most 1.6:1. Tall frames: up to 1:1.1, never taller
    // than the band.
    let pw = aw, ph = ah;
    if (pw / ph > 1.6) pw = ph * 1.6;
    if (ph / pw > 1.1) ph = pw * 1.1;
    panels = [{ x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph }];
  }
  const x0 = Math.min(...panels.map(p => p.x)), x1 = Math.max(...panels.map(p => p.x + p.w));
  const y0 = Math.min(...panels.map(p => p.y)), y1 = Math.max(...panels.map(p => p.y + p.h));
  return { panels, subject: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.max(x1 - x0, y1 - y0) / 2 } };
}

// Interpolated pull v^2 / r at radius r from a table (R, v2), Keplerian
// past the end.
function pull(R, v2, r) {
  const n = R.length;
  if (r >= R[n - 1]) return Math.max(0, v2[n - 1]) * R[n - 1] / (r * r);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m] > r) hi = m; else lo = m; }
  const t = Math.max(0, (r - R[lo]) / (R[hi] - R[lo]));
  return Math.max(0, v2[lo] + t * (v2[hi] - v2[lo])) / Math.max(r, 0.05);
}

// Two sets of the same stars: 'visible' feels v2.baryons, 'halo' feels
// v2.total. Every star starts on a circle at the total (measured) speed.
// curve: model.js curve() output. Stars between rMin and rMax kpc.
export function makeShear(curve, n = 700, seed = 3, rMin = 2, rMax = 20) {
  const r = rng(seed), R = curve.R, vt = curve.v.total;
  const start = [];
  for (let i = 0; i < n; i++) {
    const rad = rMin + (rMax - rMin) * Math.sqrt(r()), ph = r() * Math.PI * 2;
    let j = 0; while (j < R.length - 1 && R[j + 1] < rad) j++;
    const v = vt[j] + (vt[Math.min(j + 1, R.length - 1)] - vt[j]) * Math.max(0, Math.min(1, (rad - R[j]) / ((R[j + 1] ?? R[j] + 1) - R[j])));
    start.push({ x: rad * Math.cos(ph), y: rad * Math.sin(ph), vx: -v * Math.sin(ph), vy: v * Math.cos(ph), r0: rad, m: 0.4 + 0.6 * r() });
  }
  const copy = () => start.map(s => ({ ...s }));
  return { R, sets: { visible: { v2: curve.v2.baryons, stars: copy() }, halo: { v2: curve.v2.total, stars: copy() } }, t: 0 };
}

// Advance both sets by dtMyr (kick-drift-kick leapfrog, substeps of at
// most 1 Myr).
export function stepShear(sim, dtMyr) {
  const nsub = Math.max(1, Math.ceil(dtMyr / 1)), h = dtMyr / nsub * MYR;
  for (const key in sim.sets) {
    const { v2, stars } = sim.sets[key];
    for (const s of stars) {
      for (let k = 0; k < nsub; k++) {
        let r = Math.hypot(s.x, s.y), a = pull(sim.R, v2, r);
        s.vx -= 0.5 * h * a * s.x / r; s.vy -= 0.5 * h * a * s.y / r;
        s.x += h * s.vx; s.y += h * s.vy;
        r = Math.hypot(s.x, s.y); a = pull(sim.R, v2, r);
        s.vx -= 0.5 * h * a * s.x / r; s.vy -= 0.5 * h * a * s.y / r;
      }
    }
  }
  sim.t += dtMyr;
}

// Share of stars more than f times as far out as they started.
export function spread(stars, f = 1.5) {
  return stars.filter(s => Math.hypot(s.x, s.y) > f * s.r0).length / stars.length;
}

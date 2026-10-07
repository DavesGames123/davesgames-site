// ============================================================================
//  PHOTON CAUSTICS 2D  ·  optics2d.js — the 2D photon tracer (no DOM)
// ----------------------------------------------------------------------------
//  A scene is a flat world of mirrors, glass and water. A light emits
//  photons, each with one wavelength. A photon goes in a straight line to
//  the nearest surface, and there it reflects or refracts:
//    mirror ...... it reflects, and keeps the mirror reflectance of its power
//    dielectric .. Fresnel gives the reflectance R for its angle and the two
//                  indices. With probability R it reflects, else it refracts
//                  by Snell's law (Monte Carlo, so the mean power is right).
//                  Past the critical angle it always reflects (TIR).
//    absorber .... it stops. A detector absorber adds its power to a bin.
//  The tracer writes each straight part of the path as one segment with a
//  colour. The renderer adds the segments into an image, so the brightness
//  of a pixel is the number of photons through it: the ray density. Rays
//  that bend toward each other make a bright envelope, the caustic.
//
//  The index of a glass changes with the wavelength (Cauchy):
//    n(lambda) = n_d + dn (1/lambda^2 - 1/589.3^2) / (1/400^2 - 1/700^2)
//  so dn is the index split from 400 nm to 700 nm.
//
//  GLASS SHAPES. A glass body is convex: the intersection of circles and
//  half-planes. Each part gives the ray an interval [t_in, t_out]; the body
//  gives [max t_in, min t_out]. One function so covers balls, lenses and
//  prisms. Water is the part below a sum of sine waves y = h(x, t).
//
//  EXPORTS   (grep -n "export")
//    SCENES .......... the scene list: { id, name, sub, defaults }; a scene
//                      with top: true (the pool bottom) is not traced
//                      here: topdown.js and topview.js draw it
//    makeScene ....... (id, P) -> scene: objects, light, view, focus
//    trace ........... (scene, count, rand, out, P) -> segment count
//    outline ......... (scene) -> polygons and lines for the overlay
//    spectrum ........ (nm) -> [r, g, b], white light averages to 1, 1, 1
//    indexAt ......... (n, dn, nm) -> n at that wavelength
//    fresnel ......... (cosi, n1, n2) -> reflectance, unpolarized
//    refract ......... (dx, dy, nx, ny, eta) -> [tx, ty] or null (TIR)
//    waterHeight ..... (water, x) -> [h, dh/dx]
//    sectionWaves .... (A, k, sx, mix) -> the waves of the pool cross-section
//    mulberry ........ (seed) -> a seeded random function
//    mediumAt ........ (scene, x, y, nm) -> index of the medium at a point
//    emitPulse ....... (scene, count, rand, P) -> photons of one pulse
//    advance ......... (scene, photon, D, rand) move a photon by the light
//                      distance D: D/n in a medium of index n
//  grep -n 'photons in flight' for the time-of-flight part.
// ============================================================================

export const TAU = Math.PI * 2;
const EPS = 1e-6;
const DEG = Math.PI / 180;

// ── spectrum ────────────────────────────────────────────────────────────────
// The CIE 1931 colour matching functions as a sum of skewed Gaussians
// (Wyman, Sloan and Shirley 2013), then XYZ to linear sRGB. Negative
// channels clip to 0. Each channel is scaled so that the mean over 400 to
// 700 nm is 1: a flat spectrum adds to white.
function lobe(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
function rgbRaw(l) {
  const X = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  const Y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  const Z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  return [
    Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    Math.max(0, 0.0557 * X - 0.2040 * Y + 1.0570 * Z),
  ];
}
const LUT = new Float32Array(301 * 3);
{
  const m = [0, 0, 0];
  for (let i = 0; i <= 300; i++) { const c = rgbRaw(400 + i); for (let k = 0; k < 3; k++) { LUT[i * 3 + k] = c[k]; m[k] += c[k] / 301; } }
  for (let i = 0; i <= 300; i++) for (let k = 0; k < 3; k++) LUT[i * 3 + k] /= m[k];
}
export function spectrum(nm) {
  const i = Math.max(0, Math.min(300, Math.round(nm - 400))) * 3;
  return [LUT[i], LUT[i + 1], LUT[i + 2]];
}

export function indexAt(n, dn, nm) {
  return n + dn * (1 / (nm * nm) - 1 / (589.3 * 589.3)) / (1 / (400 * 400) - 1 / (700 * 700));
}

// ── optics at one surface ───────────────────────────────────────────────────
// cosi: cosine of the angle between the ray and the normal (> 0).
export function fresnel(cosi, n1, n2) {
  const eta = n1 / n2, s2 = eta * eta * (1 - cosi * cosi);
  if (s2 >= 1) return 1;
  const cost = Math.sqrt(1 - s2);
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
  const rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
  return 0.5 * (rs * rs + rp * rp);
}
// (nx, ny) faces the incoming ray (d . n < 0). eta = n1 / n2.
export function refract(dx, dy, nx, ny, eta) {
  const cosi = -(dx * nx + dy * ny), s2 = eta * eta * (1 - cosi * cosi);
  if (s2 > 1) return null;
  const k = eta * cosi - Math.sqrt(1 - s2);
  return [eta * dx + k * nx, eta * dy + k * ny];
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── scenes ──────────────────────────────────────────────────────────────────
// defaults: n index, dn index split, ang light angle (deg), wave (pool),
// exp exposure. view: the world rectangle that must show. focus: the
// subject point for the saver push-ins, with the width to show there.
export const SCENES = [
  { id: 'bottom', name: 'Pool bottom (top-down)', short: 'Pool bottom', top: true, angMax: 60,
    sub: 'Looking down through moving water at the bright net of light on the pool floor',
    defaults: { n: 1.333, dn: 0.012, ang: 18, az: 35, dir: 25, wave: 1, exp: 1.0, amp: 0.017, lam: 1.0, wspd: 0.3, depth: 1.3, mix: 1, tiles: 1, floor: 0, sx: 0 } },
  { id: 'section', name: 'Pool cross-section (side)', short: 'Pool slice', sub: 'A slice of a pool: sunlight bends at the moving waves and focuses into bright spots on the floor', angMax: 60,
    defaults: { n: 1.333, dn: 0, ang: 12, wave: 1, exp: 1.6, amp: 0.04, lam: 0.9, wspd: 0.5, depth: 1.4, mix: 1, tir: 0, sx: 0 } },
  { id: 'cup', name: 'Coffee cup', sub: 'Parallel light off a round mirror folds onto a nephroid', defaults: { n: 1.5, dn: 0, ang: 0, wave: 1, exp: 1.5 } },
  { id: 'cardioid', name: 'Cardioid', sub: 'A point source on the rim of a round mirror', defaults: { n: 1.5, dn: 0, ang: 0, wave: 1, exp: 1.0 } },
  { id: 'drop', name: 'Raindrop', sub: 'A water ball: a focal caustic behind it, the rainbow ray at 138°', defaults: { n: 1.333, dn: 0.05, ang: 0, wave: 1, exp: 1.4 } },
  { id: 'lens', name: 'Lens', sub: 'Spherical aberration: the edge rays focus first, a cusp forms', defaults: { n: 1.5, dn: 0.02, ang: 0, wave: 1, exp: 1.4 } },
  { id: 'pool', name: 'Pool floor', sub: 'Sunlight through moving waves: the bright net on the floor', defaults: { n: 1.333, dn: 0.03, ang: 0, wave: 1, exp: 1.8 } },
  { id: 'prism', name: 'Prism', sub: 'Dispersion: each wavelength has its own index', defaults: { n: 1.5, dn: 0.12, ang: 0, wave: 1, exp: 6.0 } },
  { id: 'marbles', name: 'Marbles', sub: 'Glass balls in a slant beam: many caustics cross', defaults: { n: 1.5, dn: 0.04, ang: 0, wave: 1, exp: 1.4 } },
];

const circle = (cx, cy, r) => ({ type: 'circle', cx, cy, r });
// The waves of the pool cross-section, as { A, k, w, p } for
// A sin(k x + w t + p) with t = 0: the phase p = -k r sx holds the motion.
// The main wave goes +x at the speed wspd; the others go at the deep-water
// speed for their k (v ~ 1/sqrt(k)), one of them in -x.
export function sectionWaves(A, k, sx, mix) {
  const W = [[1, 1, 1, 0]];
  if (mix) W.push([0.42, 1.93, 1 / Math.sqrt(1.93), 1.1], [0.2, 3.4, -1 / Math.sqrt(3.4), 2.3]);
  return W.map(([a, m, r, p0]) => ({ A: A * a, k: k * m, w: 0, p: p0 - k * m * r * sx }));
}
// The half-plane n . p <= d, with (nx, ny) the outward unit normal.
const plane = (nx, ny, d) => ({ type: 'plane', nx, ny, d });

// P = { n, dn, ang, wave, t }. Returns a scene for one instant: animated
// scenes are made again each frame.
// The pool cross-section also takes amp (m), lam (m), depth (m), mix (0:
// one sine wave, 1: three waves), tir (1: a lamp on the floor) and sx, the
// distance the main wave has gone (main.js adds wspd dt each frame), and
// halfW, the half width of the slice (main.js fits it to the screen).
export function makeScene(id, P) {
  const a = (P.ang || 0) * DEG, t = P.t || 0;
  const s = { id, objects: [], light: null, view: null, focus: null, detector: null, bounces: 8, animated: false };
  const glass = (prims, n = P.n, dn = P.dn) => s.objects.push({ kind: 'glass', prims, n, dn });
  const mirror = (o, refl = 0.92) => s.objects.push({ kind: 'mirror', refl, ...o });
  const wall = (x0, y0, x1, y1, det) => s.objects.push({ kind: 'wall', type: 'seg', x0, y0, x1, y1, det: !!det });
  const beam = (dir, x, y, width) => { s.light = { type: 'beam', dir, x, y, width }; };
  switch (id) {
    case 'cup':
      mirror({ type: 'arc', cx: 0, cy: 0, r: 1, a0: -100 * DEG, a1: 100 * DEG });
      beam(a, 0, 0, 2);
      s.view = { cx: 0, cy: 0, w: 2.5, h: 2.3 }; s.focus = { x: 0.5 * Math.cos(a), y: 0.5 * Math.sin(a), w: 1.1 };
      s.bounces = 6;
      break;
    case 'cardioid': {
      mirror({ type: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: TAU }, 0.82);
      const p = Math.PI + a;
      s.light = { type: 'point', x: 0.995 * Math.cos(p), y: 0.995 * Math.sin(p), a0: p + Math.PI - 1.55, a1: p + Math.PI + 1.55 };
      s.view = { cx: 0, cy: 0, w: 2.3, h: 2.3 }; s.focus = { x: -0.15 * Math.cos(p), y: -0.15 * Math.sin(p), w: 1.2 };
      s.bounces = 4;
      break;
    }
    case 'drop':
      glass([circle(0, 0, 0.6)]);
      beam(a, 0, 0, 1.25);
      s.view = { cx: 0.15, cy: 0, w: 3.8, h: 2.5 }; s.focus = { x: 1.0 * Math.cos(a), y: 1.0 * Math.sin(a), w: 1.4 };
      break;
    case 'lens':
      // plano-convex, flat face first: the strong spherical aberration
      glass([plane(-1, 0, 0.15), circle(-0.5, 0, 0.75)]);
      beam(a, 0, 0, 1.3);
      s.view = { cx: 0.6, cy: 0, w: 4.0, h: 2.2 }; s.focus = { x: 1.45, y: 1.45 * Math.sin(a), w: 1.2 };
      break;
    case 'pool': {
      const A = P.wave ?? 1;
      s.animated = true;
      s.objects.push({ kind: 'water', y0: 0.35, x0: -1.9, x1: 1.9, n: P.n, dn: P.dn, waves: [
        { A: 0.034 * A, k: 4.1, w: 0.9, p: 0 }, { A: 0.022 * A, k: 7.3, w: -1.3, p: 1.3 },
        { A: 0.012 * A, k: 12.9, w: 1.8, p: 2.1 }, { A: 0.006 * A, k: 21.0, w: -2.4, p: 0.4 },
      ], t });
      wall(-1.9, -0.85, -1.9, 0.75); wall(1.9, -0.85, 1.9, 0.75); wall(-1.9, -0.85, 1.9, -0.85, true);
      beam(-Math.PI / 2 + a, 0, 0.35, 4.6);
      s.view = { cx: 0, cy: -0.1, w: 4.0, h: 1.9 }; s.focus = { x: 0.3, y: -0.7, w: 1.4 };
      break;
    }
    case 'section': {
      // still water at y = 0, the floor at y = -depth; under the floor a
      // band for the plot of the floor light (main.js draws it)
      const d = P.depth ?? 1.4, A = P.amp ?? 0.04, k = TAU / (P.lam ?? 0.9), sx = P.sx || 0, W = P.halfW ?? 2.4;
      s.animated = true;
      s.objects.push({ kind: 'water', y0: 0, x0: -W, x1: W, n: P.n, dn: P.dn, waves: sectionWaves(A, k, sx, P.mix ?? 1), t: 0 });
      wall(-W, -d, W, -d, true); wall(-W, -d, -W, 0.25); wall(W, -d, W, 0.25);
      // the deck: light beside the pool stops there
      wall(-W - 4, 0.25, -W, 0.25); wall(W, 0.25, W + 4, 0.25);
      beam(-Math.PI / 2 + a, 0, 0, 2 * W * Math.cos(a) + 0.6);
      if (P.tir) {
        // a lamp on the floor: rays steeper than the critical angle go out
        // through the surface, the rest reflect back (TIR)
        s.lamp = { type: 'point', x: -0.52 * W, y: -d + 0.06, a0: 12 * DEG, a1: 168 * DEG };
        s.lampShare = 0.3;
      }
      // P.tight: less air above, for the short band of the saver plate
      const top = P.tight ? 0.55 : 0.95, bot = -d - 0.78;
      s.view = { cx: 0, cy: (top + bot) / 2, w: 2 * W + 0.2, h: top - bot };
      s.focus = { x: 0, y: -d * 0.75, w: 2.2 };
      s.plot = { x0: -W, x1: W, y0: -d - 0.7, y1: -d - 0.12 };
      s.bounces = 6;
      break;
    }
    case 'prism': {
      const r = 0.3175;   // inradius of a triangle with side 1.1
      glass([plane(0, -1, r), plane(Math.cos(30 * DEG), Math.sin(30 * DEG), r), plane(Math.cos(150 * DEG), Math.sin(150 * DEG), r)]);
      beam(20 * DEG + a, -0.275, 0.159, 0.07);
      wall(2.1, -1.4, 2.1, 1.0, true);
      s.view = { cx: 0.35, cy: -0.2, w: 3.8, h: 2.4 }; s.focus = { x: 1.9, y: -0.4, w: 1.0 };
      s.bounces = 6;
      break;
    }
    case 'marbles': {
      s.animated = true;
      const M = [[-1.2, 0.45, 0.26], [-0.35, 0.62, 0.18], [0.5, 0.4, 0.3], [1.3, 0.62, 0.2], [-0.8, -0.05, 0.2], [0.15, -0.05, 0.16], [1.05, -0.08, 0.22]];
      M.forEach(([x, y, r], i) => glass([circle(x + 0.06 * Math.sin(0.23 * t + i * 1.7), y + 0.05 * Math.sin(0.31 * t + i * 2.3), r)]));
      wall(-2.1, -0.95, 2.1, -0.95, true);
      beam(-62 * DEG + a, 0, 0, 4.4);
      s.view = { cx: 0, cy: 0, w: 4.0, h: 2.2 }; s.focus = { x: 0.4, y: -0.8, w: 1.4 };
      break;
    }
    default: return makeScene('cup', P);
  }
  // The world box: rays end at its edge. It is larger than the view, so a
  // ray that leaves the view and comes back is not lost.
  const v = s.view;
  s.box = { x0: v.cx - v.w * 0.9, x1: v.cx + v.w * 0.9, y0: v.cy - v.h * 0.9, y1: v.cy + v.h * 0.9 };
  for (const o of s.objects) if (o.det) s.detector = o;
  return s;
}

// ── intersection ────────────────────────────────────────────────────────────
// Each function returns the nearest t > EPS below tmax, or Infinity, and
// writes the unit normal at the hit into H.
const H = { t: 0, nx: 0, ny: 0, enter: false };

function hitGlass(o, ox, oy, dx, dy) {
  let tin = -Infinity, tout = Infinity, inx = 0, iny = 0, outx = 0, outy = 0;
  for (const p of o.prims) {
    if (p.type === 'circle') {
      const fx = ox - p.cx, fy = oy - p.cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - p.r * p.r, D = b * b - c;
      if (D <= 0) return Infinity;
      const q = Math.sqrt(D), t0 = -b - q, t1 = -b + q;
      if (t0 > tin) { tin = t0; inx = (fx + t0 * dx) / p.r; iny = (fy + t0 * dy) / p.r; }
      if (t1 < tout) { tout = t1; outx = (fx + t1 * dx) / p.r; outy = (fy + t1 * dy) / p.r; }
    } else {
      const den = p.nx * dx + p.ny * dy, dist = p.d - (p.nx * ox + p.ny * oy);
      if (Math.abs(den) < 1e-12) { if (dist < 0) return Infinity; continue; }
      const tt = dist / den;
      if (den < 0) { if (tt > tin) { tin = tt; inx = p.nx; iny = p.ny; } }
      else if (tt < tout) { tout = tt; outx = p.nx; outy = p.ny; }
    }
    if (tin >= tout) return Infinity;
  }
  if (tin > EPS) { H.t = tin; H.nx = inx; H.ny = iny; H.enter = true; return tin; }
  if (tout > EPS && tout < Infinity) { H.t = tout; H.nx = outx; H.ny = outy; H.enter = false; return tout; }
  return Infinity;
}

function hitArc(o, ox, oy, dx, dy) {
  const fx = ox - o.cx, fy = oy - o.cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - o.r * o.r, D = b * b - c;
  if (D <= 0) return Infinity;
  const q = Math.sqrt(D), span = o.a1 - o.a0;
  for (const t of [-b - q, -b + q]) {
    if (t <= EPS) continue;
    const px = fx + t * dx, py = fy + t * dy;
    let u = Math.atan2(py, px) - o.a0; u -= TAU * Math.floor(u / TAU);
    if (u <= span) { H.t = t; H.nx = px / o.r; H.ny = py / o.r; return t; }
  }
  return Infinity;
}

function hitSeg(o, ox, oy, dx, dy) {
  const ex = o.x1 - o.x0, ey = o.y1 - o.y0, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const wx = o.x0 - ox, wy = o.y0 - oy;
  const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
  if (t <= EPS || u < 0 || u > 1) return Infinity;
  const L = Math.hypot(ex, ey);
  H.t = t; H.nx = -ey / L; H.ny = ex / L; H.u = u;
  return t;
}

function heightOnly(w, x) {
  let h = w.y0;
  for (const q of w.waves) h += q.A * Math.sin(q.k * x + q.w * w.t + q.p);
  return h;
}
export function waterHeight(w, x) {
  let h = w.y0, d = 0;
  for (const q of w.waves) { const ph = q.k * x + q.w * w.t + q.p; h += q.A * Math.sin(ph); d += q.A * q.k * Math.cos(ph); }
  return [h, d];
}

// The surface lies in the band y0 +- sum |A|. Clip the ray to that band and
// to x0..x1, march for a sign change of y - h(x), then bisect.
function hitWater(o, ox, oy, dx, dy, tmax) {
  let amp = 1e-4; for (const q of o.waves) amp += Math.abs(q.A);
  let s0 = EPS, s1 = tmax;
  if (Math.abs(dy) > 1e-12) {
    const ta = (o.y0 - amp - oy) / dy, tb = (o.y0 + amp - oy) / dy;
    s0 = Math.max(s0, Math.min(ta, tb)); s1 = Math.min(s1, Math.max(ta, tb));
  } else if (Math.abs(oy - o.y0) > amp) return Infinity;
  if (Math.abs(dx) > 1e-12) {
    const ta = (o.x0 - ox) / dx, tb = (o.x1 - ox) / dx;
    s0 = Math.max(s0, Math.min(ta, tb)); s1 = Math.min(s1, Math.max(ta, tb));
  } else if (ox < o.x0 || ox > o.x1) return Infinity;
  if (!(s1 > s0)) return Infinity;
  const f = s => oy + s * dy - heightOnly(o, ox + s * dx);
  const N = 12;
  let a = s0, fa = f(a);
  for (let i = 1; i <= N; i++) {
    const b = s0 + (s1 - s0) * i / N, fb = f(b);
    if ((fa > 0) !== (fb > 0)) {
      let lo = a, hi = b, flo = fa;
      for (let k = 0; k < 16; k++) { const m = 0.5 * (lo + hi), fm = f(m); if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m; }
      const t = 0.5 * (lo + hi);
      if (t <= EPS) { a = b; fa = fb; continue; }
      const [, slope] = waterHeight(o, ox + t * dx), L = Math.hypot(slope, 1);
      H.t = t; H.nx = -slope / L; H.ny = 1 / L; H.enter = dx * H.nx + dy * H.ny < 0;
      return t;
    }
    a = b; fa = fb;
  }
  return Infinity;
}

// Ray against the box from inside: the exit distance.
function boxExit(b, ox, oy, dx, dy) {
  const tx = dx > 0 ? (b.x1 - ox) / dx : dx < 0 ? (b.x0 - ox) / dx : Infinity;
  const ty = dy > 0 ? (b.y1 - oy) / dy : dy < 0 ? (b.y0 - oy) / dy : Infinity;
  return Math.max(0, Math.min(tx, ty));
}
// Ray against the box from anywhere: the entry distance, or -1 for a miss.
function boxEntry(b, ox, oy, dx, dy) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1]]) {
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return -1; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  return t1 > t0 ? t0 : -1;
}

// ── one step of a ray ───────────────────────────────────────────────────────
// nearest: the nearest surface along the ray up to tmax. It returns the
// distance (tmax for no hit) and writes the object, the normal, enter and
// the detector coordinate u into HIT (HIT.o null for no hit).
const HIT = { o: null, nx: 0, ny: 0, enter: false, u: 0 };
function nearest(scene, ox, oy, dx, dy, tmax) {
  let tmin = tmax; HIT.o = null;
  for (const o of scene.objects) {
    let t;
    if (o.kind === 'glass') t = hitGlass(o, ox, oy, dx, dy);
    else if (o.kind === 'water') t = hitWater(o, ox, oy, dx, dy, tmin);
    else if (o.type === 'arc') t = hitArc(o, ox, oy, dx, dy);
    else t = hitSeg(o, ox, oy, dx, dy);
    if (t < tmin) { tmin = t; HIT.o = o; HIT.nx = H.nx; HIT.ny = H.ny; HIT.enter = H.enter; HIT.u = H.u; }
  }
  return tmin;
}
// bounce: reflect or refract the ray (dx, dy) at the HIT surface (a mirror
// or a dielectric). It writes the new direction, the power factor w and
// the index n of the medium after the event into BOUNCE (n is 0 when the
// medium does not change: a reflection).
const BOUNCE = { dx: 0, dy: 0, w: 1, n: 0 };
function bounce(dx, dy, nm, rand) {
  const hit = HIT.o;
  let hnx = HIT.nx, hny = HIT.ny;
  // the normal faces the incoming ray
  if (dx * hnx + dy * hny > 0) { hnx = -hnx; hny = -hny; }
  const cosi = -(dx * hnx + dy * hny);
  BOUNCE.w = 1; BOUNCE.n = 0;
  if (hit.kind === 'mirror') {
    dx += 2 * cosi * hnx; dy += 2 * cosi * hny; BOUNCE.w = hit.refl;
  } else {
    const ng = indexAt(hit.n, hit.dn, nm);
    const n1 = HIT.enter ? 1 : ng, n2 = HIT.enter ? ng : 1;
    const R = fresnel(cosi, n1, n2);
    const tdir = R < 1 && rand() >= R ? refract(dx, dy, hnx, hny, n1 / n2) : null;
    if (tdir) { dx = tdir[0]; dy = tdir[1]; BOUNCE.n = n2; }
    else { dx += 2 * cosi * hnx; dy += 2 * cosi * hny; }
  }
  const l = Math.hypot(dx, dy); BOUNCE.dx = dx / l; BOUNCE.dy = dy / l;
}

// ── the tracer ──────────────────────────────────────────────────────────────
// out: Float32Array, 7 floats per segment (x0 y0 x1 y1 r g b). Returns the
// number of segments. P.mono: 0 for white light, else one wavelength in nm.
// Photons are stratified: photon i of count takes the strip i of the beam
// and a wavelength from a golden-ratio sequence, so the image is smooth.
export function trace(scene, count, rand, out, P = {}) {
  const maxSeg = Math.floor(out.length / 7), L = scene.light, box = scene.box, det = scene.detector;
  const mono = P.mono || 0, phase = rand();
  let ns = 0;
  for (let i = 0; i < count && ns < maxSeg; i++) {
    const u = (i + rand()) / count;
    const nm = mono || 400 + 300 * ((phase + i * 0.6180339887) % 1);
    const c = spectrum(nm);
    let ox, oy, dx, dy;
    if (L.type === 'beam') {
      dx = Math.cos(L.dir); dy = Math.sin(L.dir);
      const off = (u - 0.5) * L.width;
      ox = L.x - dy * off - dx * 10; oy = L.y + dx * off - dy * 10;
    } else {
      const ang = L.a0 + (L.a1 - L.a0) * u;
      dx = Math.cos(ang); dy = Math.sin(ang); ox = L.x; oy = L.y;
    }
    const te = boxEntry(box, ox, oy, dx, dy);
    if (te < 0) continue;
    ox += dx * te; oy += dy * te;
    let w = 1;
    for (let b = 0; b <= scene.bounces && ns < maxSeg; b++) {
      const tmin = nearest(scene, ox, oy, dx, dy, boxExit(box, ox, oy, dx, dy)), hit = HIT.o;
      const x1 = ox + dx * tmin, y1 = oy + dy * tmin, k = ns * 7;
      out[k] = ox; out[k + 1] = oy; out[k + 2] = x1; out[k + 3] = y1;
      out[k + 4] = c[0] * w; out[k + 5] = c[1] * w; out[k + 6] = c[2] * w;
      ns++;
      if (!hit) break;
      if (hit.kind === 'wall') {
        if (hit === det && det.bins) {
          const j = Math.min(det.bins.length - 1, Math.floor(HIT.u * det.bins.length));
          det.bins[j] += w * (c[0] + c[1] + c[2]) / 3;
        }
        break;
      }
      bounce(dx, dy, nm, rand);
      dx = BOUNCE.dx; dy = BOUNCE.dy; w *= BOUNCE.w;
      ox = x1 + dx * 1e-5; oy = y1 + dy * 1e-5;
      if (w < 0.03) break;
    }
  }
  return ns;
}

// ── outline for the overlay ─────────────────────────────────────────────────
// fills: { kind, tris } with tris a flat triangle list [x, y, ...];
// lines: { kind, pts } open polylines (kind: 'glass', 'mirror', 'wall',
// 'detector', 'water').
export function outline(scene) {
  const fills = [], lines = [];
  for (const o of scene.objects) {
    if (o.kind === 'glass') {
      // a convex body: walk rays out from a point inside it
      let cx = 0, cy = 0, n = 0;
      for (const p of o.prims) if (p.type === 'circle') { cx += p.cx; cy += p.cy; n++; }
      if (n) { cx /= n; cy /= n; }
      if (o.prims.some(p => p.type === 'plane') && n) {
        // a lens: the circle centre is outside the body; take the middle
        // of the chord on the line y = cy
        const t1 = hitGlass(o, cx - 10, cy, 1, 0), x0 = cx - 10 + t1;
        const t2 = hitGlass(o, x0 + 1e-4, cy, 1, 0); cx = x0 + 0.5 * t2;
      }
      const pts = [], tris = [];
      for (let i = 0; i < 160; i++) {
        const a = TAU * i / 160, t = hitGlass(o, cx, cy, Math.cos(a), Math.sin(a));
        if (t < Infinity) pts.push(cx + t * Math.cos(a), cy + t * Math.sin(a));
      }
      for (let i = 0; i < pts.length; i += 2) { const j = (i + 2) % pts.length; tris.push(cx, cy, pts[i], pts[i + 1], pts[j], pts[j + 1]); }
      fills.push({ kind: 'glass', tris }); lines.push({ kind: 'glass', pts: [...pts, pts[0], pts[1]] });
    } else if (o.kind === 'mirror') {
      if (o.type === 'arc') {
        const pts = [], N = Math.ceil(96 * (o.a1 - o.a0) / TAU) + 1;
        for (let i = 0; i <= N; i++) { const a = o.a0 + (o.a1 - o.a0) * i / N; pts.push(o.cx + o.r * Math.cos(a), o.cy + o.r * Math.sin(a)); }
        lines.push({ kind: 'mirror', pts });
      } else lines.push({ kind: 'mirror', pts: [o.x0, o.y0, o.x1, o.y1] });
    } else if (o.kind === 'wall') {
      lines.push({ kind: o.det ? 'detector' : 'wall', pts: [o.x0, o.y0, o.x1, o.y1] });
    } else if (o.kind === 'water') {
      const top = [], tris = [], N = 240, floor = scene.detector ? scene.detector.y0 : scene.box.y0;
      for (let i = 0; i <= N; i++) { const x = o.x0 + (o.x1 - o.x0) * i / N; top.push(x, waterHeight(o, x)[0]); }
      for (let i = 0; i < N; i++) {
        const xa = top[2 * i], ya = top[2 * i + 1], xb = top[2 * i + 2], yb = top[2 * i + 3];
        tris.push(xa, ya, xb, yb, xa, floor, xb, yb, xb, floor, xa, floor);
      }
      fills.push({ kind: 'water', tris }); lines.push({ kind: 'water', pts: top });
    }
  }
  return { fills, lines };
}

// ── photons in flight (time of flight) ──────────────────────────────────────
// The tracer above gives each photon its whole path at once: light is
// instant. Here a photon is a state that moves a short way each frame.
// In a medium of index n it goes at c/n, so in the time that light goes
// a distance D in vacuum, the photon goes D/n. The unit of the clock L is
// the light distance: L grows by c dt each frame, in each medium.
//
// photon: { x, y, dx, dy, nm, col, w, n, wait, L, end, trail }
//   n ...... the index of the medium the photon is in
//   wait ... light distance still to go before the photon shows (a beam
//            pulse is a flat wave front: photons that meet the world box
//            later wait longer)
//   L ...... the light distance gone since the emission
//   end .... the value of L when the photon stopped (Infinity: in flight)
//   trail .. corners [x, y, L, ...] of the path: emission point and each
//            reflection or refraction

// The index of the medium at a point: glass or water that holds the point,
// else air (1).
export function mediumAt(scene, x, y, nm) {
  for (const o of scene.objects) {
    if (o.kind === 'glass') {
      let inside = true;
      for (const p of o.prims) {
        if (p.type === 'circle') { if ((x - p.cx) ** 2 + (y - p.cy) ** 2 > p.r * p.r) { inside = false; break; } }
        else if (p.nx * x + p.ny * y > p.d) { inside = false; break; }
      }
      if (inside) return indexAt(o.n, o.dn, nm);
    } else if (o.kind === 'water') {
      if (x > o.x0 && x < o.x1 && y < heightOnly(o, x) && y > scene.box.y0) return indexAt(o.n, o.dn, nm);
    }
  }
  return 1;
}

// One pulse: count photons from the light (from scene.lamp too when the
// scene has one, with lampShare of the count). P.mono as for trace.
export function emitPulse(scene, count, rand, P = {}) {
  const out = [], mono = P.mono || 0, v = scene.view;
  const vbox = { x0: v.cx - v.w / 2, x1: v.cx + v.w / 2, y0: v.cy - v.h / 2, y1: v.cy + v.h / 2 };
  const lights = scene.lamp ? [[scene.light, Math.round(count * (1 - (scene.lampShare ?? 0.3)))], [scene.lamp, Math.round(count * (scene.lampShare ?? 0.3))]] : [[scene.light, count]];
  for (const [L, n] of lights) {
    const start = out.length;
    for (let i = 0; i < n; i++) {
      const u = (i + rand()) / n, nm = mono || 400 + 300 * rand();
      let ox, oy, dx, dy, te = 0;
      if (L.type === 'beam') {
        dx = Math.cos(L.dir); dy = Math.sin(L.dir);
        const off = (u - 0.5) * L.width;
        ox = L.x - dy * off - dx * 10; oy = L.y + dx * off - dy * 10;
        // start where the beam comes into the view, so the first pulse
        // shows at once (the world box is larger than the view)
        te = boxEntry(vbox, ox, oy, dx, dy);
        if (te < 0) te = boxEntry(scene.box, ox, oy, dx, dy);
        if (te < 0) continue;
        ox += dx * te; oy += dy * te;
      } else {
        const a = L.a0 + (L.a1 - L.a0) * u;
        dx = Math.cos(a); dy = Math.sin(a); ox = L.x; oy = L.y;
      }
      out.push({ x: ox, y: oy, dx, dy, nm, col: spectrum(nm), w: 1, n: mediumAt(scene, ox, oy, nm), wait: te, L: 0, end: Infinity, trail: null });
    }
    // the wave front: the first photon to meet the box shows at once
    let m = Infinity; for (let i = start; i < out.length; i++) m = Math.min(m, out[i].wait);
    for (let i = start; i < out.length; i++) out[i].wait -= m;
  }
  return out;
}

// Move a photon by the light distance D (= c dt). Inside a medium of index
// n it goes D/n. At a surface it reflects or refracts (as in trace), and
// the rest of D goes on in the new medium. A wall, the world box or a
// weak photon stops it; its clock L still runs so the trail can follow it
// into the stop point.
export function advance(scene, ph, D, rand = Math.random) {
  if (ph.end < Infinity) { ph.L += D; return; }
  if (ph.wait > 0) {
    const k = Math.min(ph.wait, D); ph.wait -= k; ph.L += k; D -= k;
    if (ph.wait > 0) return;
  }
  if (!ph.trail) ph.trail = [ph.x, ph.y, ph.L];
  // a moving surface can pass over a photon: take the medium from the
  // point, not from the last event
  if (scene.animated) ph.n = mediumAt(scene, ph.x, ph.y, ph.nm);
  for (let k = 0; k < 16 && D > 1e-9; k++) {
    const reach = D / ph.n, tbox = boxExit(scene.box, ph.x, ph.y, ph.dx, ph.dy);
    const t = nearest(scene, ph.x, ph.y, ph.dx, ph.dy, Math.min(reach, tbox)), hit = HIT.o;
    ph.x += ph.dx * t; ph.y += ph.dy * t; ph.L += t * ph.n; D -= t * ph.n;
    if (!hit) {
      if (t >= tbox && tbox < reach) { ph.end = ph.L; ph.trail.push(ph.x, ph.y, ph.L); ph.L += D; }
      return;
    }
    ph.trail.push(ph.x, ph.y, ph.L);
    if (hit.kind === 'wall') { ph.end = ph.L; ph.L += D; return; }
    bounce(ph.dx, ph.dy, ph.nm, rand);
    ph.dx = BOUNCE.dx; ph.dy = BOUNCE.dy; ph.w *= BOUNCE.w;
    if (BOUNCE.n) ph.n = BOUNCE.n;
    // the step off the surface counts in the clock too
    ph.x += ph.dx * 1e-5; ph.y += ph.dy * 1e-5; ph.L += 1e-5 * ph.n; D -= 1e-5 * ph.n;
    if (ph.w < 0.03) { ph.end = ph.L; ph.L += D; return; }
  }
}

// ============================================================================
//  CHLADNI PLATE  ·  plates.js — plate outlines, holes, braces, materials
// ----------------------------------------------------------------------------
//  No DOM and no GL. The page loads this classic script, and the solver
//  worker loads it with importScripts. It defines self.CPlates.
//
//  Units are cm. The body axis is y: y = 0 is the neck end, and y grows to
//  the tail. The plate is symmetric about x = 0. Each outline is an original
//  spline through a short list of half-width points, mirrored to the left.
//
//  grep -n targets
//    spline ............ "function splineLoop"
//    shapes ............ "const SHAPES"
//    bracing ........... "function braces"
//    materials ......... "const MATERIALS"
//    plate stiffness ... "function stiffness"
//    point in plate .... "function inside"
// ============================================================================
(function (root) {
'use strict';

// Closed centripetal Catmull-Rom spline through pts, per points per span.
// The centripetal form does not make loops or cusps at close points, so a
// violin corner stays a sharp tip and does not cross over itself.
function splineLoop(pts, per) {
  const n = pts.length, out = [];
  const P = i => pts[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-6;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + (t2 - t1) * k / per;
      const L = (a, b, ta, tb) => [
        (a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta),
        (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  return out;
}

// Right half (x >= 0) from the neck end to the tail, both ends on x = 0.
// The left half is the mirror image.
function mirror(half, sx, sy) {
  sx = sx || 1; sy = sy || 1;
  const R = half.map(p => [p[0] * sx, p[1] * sy]);
  const L = R.slice(1, -1).reverse().map(p => [-p[0], p[1]]);
  return R.concat(L);
}
function circle(cx, cy, r, n) {
  const o = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return o;
}

// The guitar half outline, 49 cm long: upper bout 28 cm, waist 24 cm,
// lower bout 37 cm. The ukulele uses the same points at a smaller scale.
const GUITAR_HALF = [
  [0, 0], [4.6, 0.35], [8.6, 1.5], [11.8, 3.7], [13.6, 6.8], [14.0, 9.9], [13.5, 13.0],
  [12.5, 16.2], [12.0, 19.0], [12.6, 22.2], [14.7, 26.2], [16.9, 30.6], [18.35, 35.5],
  [18.3, 40.4], [16.5, 44.6], [12.5, 47.6], [6.6, 48.8], [0, 49],
];
// The violin half outline, 35.6 cm long: upper bout 16.8 cm, C-bout 11.0 cm,
// lower bout 20.6 cm. The corners are close point pairs, so the spline turns
// sharply there.
const VIOLIN_HALF = [
  [0, 0], [2.7, 0.2], [5.1, 1.0], [6.95, 2.5], [8.05, 4.4], [8.4, 6.5], [8.2, 8.6],
  [7.55, 10.4], [7.05, 11.6], [7.75, 12.85], [6.7, 13.25], [5.75, 14.6], [5.5, 16.4],
  [5.8, 18.4], [6.75, 19.75], [8.1, 20.35], [7.85, 21.1], [8.8, 22.3], [9.85, 24.6],
  [10.3, 27.8], [10.0, 30.8], [8.85, 33.0], [6.6, 34.7], [3.6, 35.4], [0, 35.6],
];

// One f-hole on the right side (sign s = +1) or the left (s = -1): a slot
// along an S curve with a round eye at each end. Returns sample points of
// the stem and the two eyes; inside() tests the distance to them.
function fhole(s, k) {
  const stem = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = 14.7 + 7.7 * t;
    const x = 3.05 + 1.85 * t + 0.55 * Math.sin(Math.PI * (t * 2 - 0.5)) * (1 - t) * t * 2.2;
    stem.push([s * x * k, y * k]);
  }
  return {
    stem, w: 0.13 * k,
    eyes: [[s * 3.0 * k, 14.65 * k, 0.33 * k], [s * 4.95 * k, 22.45 * k, 0.43 * k]],
  };
}

// grain: 'y' = wood grain along the body. defaults pick the plate a
// luthier or a Chladni demonstration would use.
const SHAPES = {
  square: {
    name: 'Square plate', short: 'Square', L: 24,
    outline: () => [[-12, 0], [12, 0], [12, 24], [-12, 24]],
    holes: () => [], material: 'brass', t: 1.5, drive: [0, 12],
    note: 'A 24 cm square, the plate of Chladni’s 1787 figures.',
    bracing: { none: 'Plain' },
  },
  circle: {
    name: 'Circular plate', short: 'Circle', L: 24,
    outline: () => circle(0, 12, 12, 220),
    holes: () => [], material: 'brass', t: 1.5, drive: [4.2, 9.2],
    note: 'A 24 cm disc. Its nodes are diameters and circles.',
    bracing: { none: 'Plain' },
  },
  guitar: {
    name: 'Guitar top', short: 'Guitar', L: 49,
    outline: () => splineLoop(mirror(GUITAR_HALF), 10),
    holes: () => [{ kind: 'circle', c: [0, 13.2], r: 4.3, poly: circle(0, 13.2, 4.3, 96) }],
    material: 'spruce', t: 2.5, drive: [5.5, 34],
    note: 'A classical guitar soundboard, 49 cm, with the sound hole.',
    bracing: { none: 'No braces', fan: 'Fan braces', x: 'X braces' },
  },
  ukulele: {
    name: 'Ukulele top', short: 'Ukulele', L: 24,
    outline: () => splineLoop(mirror(GUITAR_HALF, 0.48, 24 / 49), 10),
    holes: () => [{ kind: 'circle', c: [0, 7.1], r: 2.45, poly: circle(0, 7.1, 2.45, 72) }],
    material: 'spruce', t: 2.0, drive: [2.6, 16.5],
    note: 'A soprano ukulele top, 24 cm, with the sound hole.',
    bracing: { none: 'No braces', bars: 'Two bars' },
  },
  violinTop: {
    name: 'Violin top', short: 'Violin top', L: 35.6, violin: 1,
    outline: () => splineLoop(mirror(VIOLIN_HALF), 8),
    holes: () => [fhole(1, 1), fhole(-1, 1)].map(f => ({ kind: 'f', f })),
    material: 'spruce', t: 2.9, drive: [3.2, 26], arch: 1,
    note: 'A violin belly, 35.6 cm, with the two f-holes.',
    bracing: { none: 'Free plate', bassbar: 'Bass bar' },
  },
  violinBack: {
    name: 'Violin back', short: 'Violin back', L: 35.6, violin: 1,
    outline: () => splineLoop(mirror(VIOLIN_HALF), 8),
    holes: () => [], material: 'maple', t: 3.6, drive: [3.2, 26], arch: 1,
    note: 'A violin back, 35.6 cm, of one piece of maple.',
    bracing: { none: 'Free plate' },
  },
  cello: {
    name: 'Cello top', short: 'Cello', L: 75.6, violin: 75.6 / 35.6,
    outline: () => splineLoop(mirror(VIOLIN_HALF, 75.6 / 35.6, 75.6 / 35.6), 8),
    holes: () => [fhole(1, 75.6 / 35.6), fhole(-1, 75.6 / 35.6)].map(f => ({ kind: 'f', f })),
    material: 'spruce', t: 4.6, drive: [6.8, 55], arch: 1,
    note: 'A cello belly, 75.6 cm, with the f-holes.',
    bracing: { none: 'Free plate', bassbar: 'Bass bar' },
  },
};
const ORDER = ['square', 'circle', 'guitar', 'violinTop', 'violinBack', 'cello', 'ukulele'];

// Brace strips as segments [x0, y0, x1, y1, width]. A brace is a tall
// strip glued along the plate. The solver makes the plate stiffer under it.
function braces(id, kind) {
  const S = [];
  if (id === 'guitar' && kind === 'fan') {
    S.push([-14, 6.3, 14, 6.3, 0.9], [-12.6, 19.6, 12.6, 19.6, 0.9]);
    for (let i = -3; i <= 3; i++) S.push([i * 0.75, 21.4, i * 3.5, 45.2 - Math.abs(i) * 1.3, 0.55]);
  } else if (id === 'guitar' && kind === 'x') {
    S.push([-13.8, 5.6, 13.8, 5.6, 0.9]);
    S.push([-9.9, 10.5, 15.5, 41.5, 0.8], [9.9, 10.5, -15.5, 41.5, 0.8]);
    S.push([2.2, 30.5, 9.8, 42.5, 0.55], [4.5, 27.8, 13.5, 39.0, 0.55]);
  } else if (id === 'ukulele' && kind === 'bars') {
    S.push([-6.6, 3.4, 6.6, 3.4, 0.6], [-5.6, 10.6, 5.6, 10.6, 0.6]);
  } else if ((id === 'violinTop' || id === 'cello') && kind === 'bassbar') {
    const k = SHAPES[id].violin;
    S.push([-2.05 * k, 6.6 * k, -2.35 * k, 29.6 * k, 0.5 * k]);
  }
  return S;
}

// Elastic constants. E in GPa, rho in kg/m3. Wood is orthotropic: EL along
// the grain, ER across it, G the in-plane shear modulus, nu = nu_LR.
// The values are typical handbook figures for tonewood, not one board.
const MATERIALS = {
  brass:  { name: 'Brass',     rho: 8500, E: 100, nu: 0.33, kind: 'metal' },
  alu:    { name: 'Aluminium', rho: 2700, E: 69,  nu: 0.33, kind: 'metal' },
  glass:  { name: 'Glass',     rho: 2500, E: 70,  nu: 0.22, kind: 'glass' },
  spruce: { name: 'Spruce',    rho: 420,  EL: 12.0, ER: 0.85, G: 0.75, nu: 0.37, kind: 'spruce' },
  maple:  { name: 'Maple',     rho: 650,  EL: 11.0, ER: 1.9,  G: 1.05, nu: 0.42, kind: 'maple' },
};

// The bending stiffness of a plate of thickness t (m), split into a scale
// Dref (N m) and the dimensionless weights the solver uses:
//   energy = Dref/2 * (cxx wxx^2 + 2 c12 wxx wyy + cyy wyy^2 + 4 c66 wxy^2)
// Grain runs along y, so cyy = 1 for wood.
// ARCH: the model is a flat plate, but a violin plate is arched, and the
// arch makes its middle much stiffer, most of all across the grain. Near
// the edge a violin plate has a flat channel that stays flexible. The
// solver gives each node a stiffness factor 1 + k w(d), where d is the
// distance to the outer edge and w rises from 0 at e0 to 1 at e1 (cm, at
// violin size). These factors are a fitted estimate, not shell theory.
const ARCH = { x: 2.5, y: 0.0, t: 0.6, e0: 0.4, e1: 3.0 };
function stiffness(mat, t) {
  const m = MATERIALS[mat], t3 = t * t * t;
  if (m.E) {
    const D = m.E * 1e9 * t3 / (12 * (1 - m.nu * m.nu));
    return { Dref: D, cxx: 1, cyy: 1, c12: m.nu, c66: (1 - m.nu) / 2, iso: true };
  }
  const nuRL = m.nu * m.ER / m.EL, den = 1 - m.nu * nuRL;
  const DL = m.EL * 1e9 * t3 / (12 * den), DR = m.ER * 1e9 * t3 / (12 * den);
  const D12 = m.nu * DR, D66 = m.G * 1e9 * t3 / 12;
  return { Dref: DL, cxx: DR / DL, cyy: 1, c12: D12 / DL, c66: D66 / DL, iso: false, DL, DR, D12, D66 };
}

function pointInPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy;
  let u = l ? ((x - ax) * vx + (y - ay) * vy) / l : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(x - ax - u * vx, y - ay - u * vy);
}
function inHole(x, y, holes) {
  for (const h of holes) {
    if (h.kind === 'circle') { if (Math.hypot(x - h.c[0], y - h.c[1]) < h.r) return true; }
    else if (h.kind === 'f') {
      const f = h.f;
      for (const e of f.eyes) if (Math.hypot(x - e[0], y - e[1]) < e[2]) return true;
      for (let i = 0; i + 1 < f.stem.length; i++) {
        const a = f.stem[i], b = f.stem[i + 1];
        if (segDist(x, y, a[0], a[1], b[0], b[1]) < f.w) return true;
      }
    }
  }
  return false;
}
// 0 = outside the outline, 1 = on the plate, 2 = in a hole.
function inside(geo, x, y) {
  if (!pointInPoly(x, y, geo.outline)) return 0;
  return inHole(x, y, geo.holes) ? 2 : 1;
}
function onBrace(S, x, y) {
  for (const s of S) if (segDist(x, y, s[0], s[1], s[2], s[3]) < s[4] / 2) return true;
  return false;
}

// Build the geometry of one shape once: outline polygon, holes and bbox.
const cache = {};
function geometry(id) {
  if (cache[id]) return cache[id];
  const S = SHAPES[id], outline = S.outline(), holes = S.holes();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of outline) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  let area = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) area += (outline[j][0] + outline[i][0]) * (outline[j][1] - outline[i][1]);
  return (cache[id] = { id, outline, holes, bbox: [x0, y0, x1, y1], area: Math.abs(area / 2) });
}

root.CPlates = { SHAPES, ORDER, MATERIALS, ARCH, braces, stiffness, geometry, inside, onBrace, pointInPoly, segDist };
})(typeof self !== 'undefined' ? self : globalThis);

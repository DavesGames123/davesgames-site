// ============================================================================
//  MUSHROOM DRAW  ·  engine.js — procedural mushrooms as pen lines
// ----------------------------------------------------------------------------
//  Original code (davesgames.io), in the spirit of fishdraw and
//  shan-shui-inf by Lingdong Huang: noise-wobbled polylines, hatching for
//  shade, hidden-line removal, plain polylines for a pen plotter. No code
//  of those programs is in this file. No DOM: main.js, saver.js and
//  tests.mjs import it. buildSpecimen(params, seed) is deterministic.
//
//  UNITS. One engine unit is UNIT_MM (0.5 mm) of real mushroom. x is to
//  the right, y is up, z is toward the viewer. The ground is y = 0.
//
//  CAMERA. Elevation e (params.elev). A point projects to
//      X = x,   Y = groundY(z0) - y cos e + (z - z0) sin e
//  so a circle of radius r at height h is an ellipse with semi-axes r and
//  r |sin e|. From below (e < 0) the rim is a full ellipse and the
//  underside shows. The bases sit on a ground plane seen at
//  eg = max(|e|, 0.2), so a low camera still sees the ground recede.
//
//  ANATOMY (one fruit body, function makeBody).
//    stem   a bent spine (lean, curve) with a radius profile (top, base,
//           bulb); cross sections are horizontal circles
//    cap    a surface of revolution on the stem top, tilted with the
//           spine. capShape() makes the meridian: a superellipse from the
//           apex to the rim (q, closure past the equator for an egg or a
//           puffball), plus umbo, depression (funnel), upturn, flare
//           (bell) and an inrolled curl, then the underside back to the
//           stem. Age morphs the shape: button, convex, plane, upturned.
//           A wavy margin scales the radius per angle (table A) and lifts
//           the margin (table B). The meridian is rasterised into a
//           96 x 96 bit table for a fast inside test.
//    lines  every cap line point is tested for self-occlusion by a ray
//           march toward the camera through that table (function rayHit);
//           the outline is the visible contour (n . c = 0) plus the rim
//           crease where it is not on the contour.
//
//  HIDDEN LINES. Every part is an item with lines, a fill polygon and
//  washes, in painter order (back to front). hideLines() in geom.js cuts
//  each line where a later fill covers it, so the output is visible
//  polylines only. Inside one body the order depends on e:
//      e >= 0   ring back, volva back, stem, ring front, volva front,
//               cap, marks, underside
//      e <  0   cap, marks, underside, ring back, volva back, stem
//               (its fill cut where the cap hides it), ring front, volva front
//
//  OUTPUT of buildSpecimen: { name, seed, params, xy, offs, lens, total,
//  bbox, kinds, part, order, washes, parts, stats }. xy/offs/lens are the
//  flat polylines (as fishdraw flatten); kinds: 0 outline, 1 detail,
//  2 hatch, 3 ground; part: an index into PART_NAMES; order: the draw-on
//  order (outlines first); washes: [{ xy, color, part }] back to front.
//  opts.debug adds { occs, vis }: the fills and the clipped lines (tests).
//
//  MODULES. engine.js keeps the binomen and the fruit body: capShape,
//  makeBody, capItems, morelNet, underItems and stemItems. saver.js cuts
//  code extracts of those functions from this file by name, so they stay
//  here. The rest is in engine/, and engine.js re-exports every public
//  name, so callers import from engine.js only.
//    engine/params.js    the parameter schema, sanitize, mutate, blend
//    engine/forms.js     the presets, randomParams, formParams
//    engine/shade.js     hsl, vector helpers, LIGHT, dark
//    engine/path.js      makePath, readPath (a meridian with arc length)
//    engine/items.js     PART_NAMES, item(), runs()
//    engine/place.js     placeBodies (position and size of each body)
//    engine/ground.js    groundItems (ground, leaves, grass, moss)
//    engine/flatten.js   painter order, hidden lines, flat typed arrays
//    engine/share.js     encodeShare, decodeShare
//
//  GREP MAP
//    grep -n 'export function randomName' the binomen
//    grep -n 'function capShape'          the meridian of the cap
//    grep -n 'function makeBody'          one fruit body, all its items
//    grep -n 'function capItems'          outline, rim, hatching, marks
//    grep -n 'function morelNet'          the pits and ridges of a morel
//    grep -n 'function underItems'        gills, pores, teeth, ridges
//    grep -n 'function stemItems'         stem, textures, ring, volva
//    grep -n 'export function buildSpecimen' the whole specimen
//    grep -n "from './engine/"            the modules and the re-exports
// ============================================================================
import { clamp, lerp, smoothstep, TAU, mulberry, makeNoise, makePeriodic, periodicTable, pointInPoly } from './geom.js';
import { sanitize, SHAPES, MOREL, PUFF } from './engine/params.js';
import { hsl, dot, norm, cross, LIGHT, dark } from './engine/shade.js';
import { makePath, readPath } from './engine/path.js';
import { PART_NAMES, item, runs } from './engine/items.js';
import { placeBodies } from './engine/place.js';
import { groundItems } from './engine/ground.js';
import { flatten } from './engine/flatten.js';

export { PROFILES, GROUPS, PARAMS, PARAM_BY_KEY, DEFAULTS, roundTo, sanitize, mutate, blendParams, takeGroup, applyLocks,
  diffParams } from './engine/params.js';
export { FORMS, FORM_KEYS, randomParams, formParams } from './engine/forms.js';
export { hsl } from './engine/shade.js';
export { PART_NAMES } from './engine/items.js';
export { encodeShare, decodeShare } from './engine/share.js';

export const UNIT_MM = 0.5;
const PI = Math.PI;

// ── randomName ──────────────────────────────────────────────────────────────
// A Latin-like binomen from our own syllable lists. The epithet ending
// follows the gender of the genus ending.
const G1 = ['Agar', 'Myc', 'Lepi', 'Cort', 'Russ', 'Hygr', 'Clit', 'Tric', 'Pleur', 'Volv', 'Phol', 'Ento', 'Lacc', 'Gale',
  'Strob', 'Bol', 'Suil', 'Cant', 'Hydn', 'Lyc', 'Calv', 'Melan', 'Xer', 'Omph', 'Gymn', 'Leuc', 'Chlor', 'Tephr', 'Marasm',
  'Clav', 'Ram', 'Geast', 'Scler', 'Amyl', 'Crep', 'Inoc', 'Hebel', 'Cystod', 'Rhod', 'Sparass', 'Phyll'];
const G2 = ['', '', 'o', 'i', 'a', 'e'];
const G3 = [['ella', 'f'], ['ia', 'f'], ['ula', 'f'], ['ina', 'f'], ['aria', 'f'], ['ops', 'm'], ['omyces', 'm'], ['ius', 'm'],
  ['ellus', 'm'], ['otus', 'm'], ['idium', 'n'], ['oderma', 'n'], ['ocybe', 'f'], ['ospora', 'f'], ['onia', 'f']];
const S1 = ['rubr', 'alb', 'fusc', 'flav', 'nigr', 'virid', 'lut', 'squam', 'umbon', 'pud', 'cand', 'sangu', 'fulv', 'grise',
  'argent', 'tenu', 'crass', 'eleg', 'camp', 'verruc', 'strig', 'lign', 'musc', 'silv', 'prat', 'autumn', 'hiem', 'radic',
  'lact', 'glutin', 'porphyr', 'aurant', 'cinnam', 'ochr', 'plumb', 'umbr', 'nebul', 'pell', 'vel', 'stell', 'fagi', 'querc'];
const S2 = { m: ['atus', 'osus', 'ulus', 'eus', 'ipes', 'icola', 'oides', 'escens', 'iformis', 'inus'],
  f: ['ata', 'osa', 'ula', 'ea', 'ipes', 'icola', 'oides', 'escens', 'iformis', 'ina'],
  n: ['atum', 'osum', 'ulum', 'eum', 'ipes', 'icola', 'oides', 'escens', 'iforme', 'inum'] };
export function randomName(seed) {
  const r = mulberry(((seed >>> 0) ^ 0xBB67AE85) >>> 0);
  const pick = a => a[Math.floor(r() * a.length)];
  const g1 = pick(G1), g3 = pick(G3);
  let mid = pick(G2);
  if (/[aeiou]$/.test(g1) || /^[aeiou]/.test(g3[0])) mid = '';
  const genus = g1 + mid + g3[0];
  const sp = pick(S1) + pick(S2[g3[1]]);
  return genus + ' ' + sp.toLowerCase();
}

// ── capShape ────────────────────────────────────────────────────────────────
// The meridian of one cap: top (apex to rim, then the inrolled curl),
// under (rim to the junction with the stem), and a bit table of the
// closed meridian for inside(). r, h in units, h up from the rim plane.
function capShape(P, b) {
  const prof = P.profile, S = SHAPES[prof], a = b.age;
  const special = prof >= MOREL;
  const young = special ? 0 : 1 - smoothstep(0, 0.5, a), old = special ? 0 : smoothstep(0.62, 1, a);
  const R = b.R, rs = Math.min(b.rTop, R * 0.82);
  const q = lerp(S.q, 2, young);
  const cl = lerp(S.cl, Math.max(S.cl, 0.9), young) * (1 - old);
  const Hk = lerp(P.capH, Math.max(P.capH, 0.95), young) * (1 - 0.45 * old);
  const steep = prof === 2 || prof === 3;
  const up = Math.max(0, P.margin) + old * (steep ? 0.35 : 0.6);
  const inr = special ? 0 : Math.max(0, -P.margin) * (1 - old) + young * 0.25;
  const um = S.um + P.umbo * 0.7, dp = S.dp * (1 - young), fl = S.fl * (1 + old);
  // The rim radius stays at least 1.15 x the stem top radius.
  const need = Math.min(0.97, 1.15 * rs / R);
  const thMax = Math.min(PI / 2 + cl, PI - Math.asin(Math.pow(need, q / 2)));
  const N = 64, top = [];
  for (let i = 0; i <= N; i++) {
    const th = thMax * i / N, sn = Math.sin(th), cs = Math.cos(th);
    let r = R * Math.pow(Math.abs(sn), 2 / q);
    let h = Hk * R * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / q);
    const s = Math.min(1, r / R);
    h += um * 0.2 * R * Math.exp(-(s / 0.2) * (s / 0.2));
    h -= dp * 0.3 * R * (1 - s * s) * (1 - s * s);
    if (th <= PI / 2 + 1e-9) {
      const m = smoothstep(0.45, 1, s);
      h += up * 0.32 * R * m * m;
      if (fl) { const f = smoothstep(0.55, 1, th / (PI / 2)); r *= 1 + fl * 0.16 * f * f; }
    }
    top.push([r, h]);
  }
  if (inr > 0.02) {
    const n = top.length;
    let [x, y] = top[n - 1], ang = Math.atan2(y - top[n - 2][1], x - top[n - 2][0]);
    const steps = 8, len = inr * 0.17 * R / steps, turn = inr * 2.4 / steps;
    for (let k = 0; k < steps; k++) { ang -= turn; x += Math.cos(ang) * len; y += Math.sin(ang) * len; top.push([Math.max(rs * 1.05, x), y]); }
  }
  const rim = top[top.length - 1];
  // The top height at the stem radius (on the outward part of the top).
  let topAt = top[0][1];
  for (let i = 1; i < top.length; i++) {
    if (top[i][0] >= rs) { const t = (rs - top[i - 1][0]) / ((top[i][0] - top[i - 1][0]) || 1e-9); topAt = lerp(top[i - 1][1], top[i][1], t); break; }
  }
  const ft = P.flesh * R * 0.55 + 0.03 * R;
  let hj = topAt - ft;
  if (special || cl > 0.5) hj = Math.max(Math.min(hj, rim[1] + 0.25 * (topAt - rim[1])), rim[1]);
  if (prof === MOREL || prof === PUFF) hj = rim[1];
  const under = [];
  const c1 = [lerp(rs, rim[0], 0.45), lerp(hj, rim[1], 0.8)];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    under.push([u * u * rim[0] + 2 * u * t * c1[0] + t * t * rs, u * u * rim[1] + 2 * u * t * c1[1] + t * t * hj]);
  }
  // The closed meridian and its bit table.
  const M = [[0, top[0][1]], ...top, ...under.slice(1), [0, hj]];
  let rmax = 0, hmin = Infinity, hmax = -Infinity;
  for (const [x, y] of M) { if (x > rmax) rmax = x; if (y < hmin) hmin = y; if (y > hmax) hmax = y; }
  const NB = 96, W = rmax * 1.02, Hs = (hmax - hmin) * 1.02 || 1, h0 = hmin - (hmax - hmin) * 0.01;
  const bits = new Uint8Array(NB * NB);
  for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) bits[j * NB + i] = pointInPoly(M, (i + 0.5) / NB * W, h0 + (j + 0.5) / NB * Hs) ? 1 : 0;
  const inside = (r, h) => {
    const i = Math.floor(r / W * NB), j = Math.floor((h - h0) / Hs * NB);
    return i >= 0 && i < NB && j >= 0 && j < NB && bits[j * NB + i] === 1;
  };
  return { R, rs, hj, top: makePath(top), under: makePath(under), inside, rmax, hmin, hmax, M, prof, special, rim };
}

// ── makeBody ────────────────────────────────────────────────────────────────
// All items of one fruit body, in painter order. C: the shared context.
function makeBody(C, b) {
  const { P, se, ce, seg } = C;
  const rnd = mulberry(b.seed), nz = makeNoise(b.seed ^ 0x5bd1e995);
  const baseY = b.z * seg;
  const proj = (p) => [p[0], baseY - p[1] * ce + (p[2] - b.z) * se];
  const H = b.H;
  // A low camera sees the ground from above and the cap from below: on
  // the stem the elevation blends from eg at the ground to e at half height.
  const projS = C.e >= C.eg ? proj : (p) => {
    const ee = lerp(C.eg, C.e, smoothstep(0, 0.5 * H, p[1]));
    return [p[0], baseY - p[1] * ce + (p[2] - b.z) * Math.sin(ee)];
  };
  const spine = u => [b.x + b.lean * H * u + b.curve * H * 0.22 * Math.sin(PI * u), H * u * (1 - 0.05 * Math.abs(b.curve)), b.z];
  const rho = u => {
    const base = lerp(b.rBot, b.rTop, Math.pow(clamp(u, 0, 1), 0.75));
    const bl = P.bulb * b.rBot * 0.85 * Math.exp(-((u - 0.06) / 0.12) * ((u - 0.06) / 0.12));
    return (base + bl) * (1 + 0.035 * nz(u * 5, 1.7));
  };
  const cap = capShape(P, b);
  const R = cap.R;
  // The cap frame: local x, y (y = 0 at the rim plane), z; tilted by alpha
  // about z at the junction (0, hj, 0), which sits on the spine top.
  const J = spine(1), J2 = spine(0.96);
  const alpha = Math.atan2(J[0] - J2[0], J[1] - J2[1]) * 0.85;
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const toW = p => [J[0] + p[0] * ca + (p[1] - cap.hj) * sa, J[1] - p[0] * sa + (p[1] - cap.hj) * ca, J[2] + p[2]];
  const toL = p => { const dx = p[0] - J[0], dy = p[1] - J[1]; return [dx * ca - dy * sa, dx * sa + dy * ca + cap.hj, p[2] - J[2]]; };
  const camL = [-se * sa, se * ca, ce];
  const litL = [LIGHT[0] * ca - LIGHT[1] * sa, LIGHT[0] * sa + LIGHT[1] * ca, LIGHT[2]];
  const cproj = p => proj(toW(p));

  // Wavy margin: a radial scale and a lift per angle.
  const ampA = 0.015 + 0.09 * P.wobble, ampB = 0.075 * P.wobble * R;
  const A = periodicTable(makePeriodic(rnd, 3, 9)), B = periodicTable(makePeriodic(rnd, 4, 11));
  const dA = phi => (A(phi + 0.01) - A(phi - 0.01)) / 0.02, dB = phi => (B(phi + 0.01) - B(phi - 0.01)) / 0.02;
  // A point of the cap surface on a path at (u, phi): position, unit
  // normal (outward) and unit tangent along u.
  const surf = (path, u, phi) => {
    const [r, h, dr, dh] = readPath(path, u);
    const a = 1 + ampA * A(phi), s = Math.min(1, r / R), bb = ampB * B(phi);
    const c = Math.cos(phi), sn = Math.sin(phi);
    const p = [r * a * c, h + bb * s * s * s, r * a * sn];
    const pu = [dr * a * c, dh + bb * 3 * s * s * (r < R ? dr / R : 0), dr * a * sn];
    const ap = ampA * dA(phi), bp = ampB * dB(phi);
    const pp = [r * (ap * c - a * sn), bp * s * s * s, r * (ap * sn + a * c)];
    let n = cross(pp, pu);
    const ref = [-dh * c, dr, -dh * sn];
    let nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-9) n = ref, nl = Math.hypot(ref[0], ref[1], ref[2]) || 1;
    if (dot(n, ref) < 0) nl = -nl;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    return { p, n, t: norm(pu) };
  };
  const insideL = q => {
    const rq = Math.hypot(q[0], q[2]), ph = Math.atan2(q[2], q[0]);
    const r = rq / (1 + ampA * A(ph)), s = Math.min(1, r / R);
    return cap.inside(r, q[1] - ampB * B(ph) * s * s * s);
  };
  // Ray march from a local point toward the camera through the cap.
  const hc = (cap.hmax + cap.hmin) / 2, Rb = Math.hypot(cap.rmax * (1 + ampA), (cap.hmax - cap.hmin) / 2 + ampB) * 1.02;
  const s0 = 0.03 * R, ds = 0.024 * R;
  const rayHit = p => {
    const ox = p[0], oy = p[1] - hc, oz = p[2];
    const bq = ox * camL[0] + oy * camL[1] + oz * camL[2], cq = ox * ox + oy * oy + oz * oz - Rb * Rb;
    const disc = bq * bq - cq;
    if (disc <= 0) return false;
    const t1 = -bq + Math.sqrt(disc);
    for (let t = s0; t < t1; t += ds) if (insideL([p[0] + camL[0] * t, p[1] + camL[1] * t, p[2] + camL[2] * t])) return true;
    return false;
  };
  const facing = n => dot(n, camL) > 0.0;
  // The march starts a little off the surface along the normal, so a
  // grazing ray at the contour does not hit its own surface cell.
  const lift = 0.02 * R;
  const off = sp => [sp.p[0] + sp.n[0] * lift, sp.p[1] + sp.n[1] * lift, sp.p[2] + sp.n[2] * lift];
  const visTop = sp => facing(sp.n) && !rayHit(off(sp));

  const colors = C.colors;
  const capIt = item('cap'), marks = [], underIt = item('under');
  capItems(C, { cap, surf, rayHit, off, facing, visTop, cproj, camL, litL, rnd, nz, R, capIt, marks, b });
  if (C.e < 0.22) underItems(C, { cap, surf, rayHit, cproj, rnd, R, underIt });
  if (C.e < 0 && cap.prof !== MOREL && cap.prof !== PUFF) {
    const rim = [];
    for (let k = 0; k < 96; k++) rim.push(cproj(surf(cap.top, 1, k / 96 * TAU).p));
    underIt.washes.push({ pts: rim, color: colors.gill });
  }
  const st = stemItems(C, { b, spine, rho, proj: projS, toL, rayHit, cap, rnd, nz, R, surf });
  // Marks: nearest to the camera last.
  marks.sort((x, y) => x.depth - y.depth);
  const seq = C.e >= 0
    ? [...st.back, st.stem, ...st.front, capIt, ...marks, underIt]
    : [capIt, ...marks, underIt, ...st.back, st.stem, ...st.front];
  return seq;
}

// ── capItems ────────────────────────────────────────────────────────────────
function capItems(C, K) {
  const { P, colors } = C;
  const { cap, surf, rayHit, off, facing, visTop, cproj, camL, litL, rnd, nz, R, capIt, marks } = K;
  const thr = 1.08 - 0.8 * P.shade;

  // Silhouette fill: the star hull of dense surface samples about the cap
  // centre (the projected cap is star-shaped about that point).
  const pts = [];
  // The rim and the outer top get the densest angle samples: more samples
  // than hull bins, so no bin sees only inner points.
  for (const [path, nu, nk] of [[cap.top, 40, 144], [cap.under, 14, 144]]) {
    for (let i = 0; i <= nu; i++) {
      const k1 = path === cap.top && i >= nu * 0.6 ? nk * 3 : nk;
      for (let k = 0; k < k1; k++) pts.push(cproj(surf(path, i / nu, k / k1 * TAU).p));
    }
  }
  const c2 = cproj([0, (cap.hmax + cap.hmin) / 2, 0]);
  const NBN = 240, d = new Float64Array(NBN);
  for (const [x, y] of pts) {
    const a = Math.atan2(y - c2[1], x - c2[0]), r = Math.hypot(x - c2[0], y - c2[1]);
    const k = ((Math.round((a / TAU) * NBN) % NBN) + NBN) % NBN;
    if (r > d[k]) d[k] = r;
  }
  for (let k = 0; k < NBN; k++) if (!d[k]) {
    let a = k, bk = k;
    while (!d[a]) a = (a - 1 + NBN) % NBN;
    while (!d[bk]) bk = (bk + 1) % NBN;
    d[k] = (d[a] + d[bk]) / 2;
  }
  // Fill notches: a bin lower than both neighbours (two bins out) takes
  // the lower of them.
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < NBN; k++) {
    const a = Math.min(d[(k + NBN - 1) % NBN], d[(k + 1) % NBN]), b = Math.min(d[(k + NBN - 2) % NBN], d[(k + 2) % NBN]);
    d[k] = Math.max(d[k], a, b);
  }
  const sil = [];
  for (let k = 0; k < NBN; k++) { const a = k / NBN * TAU; sil.push([c2[0] + Math.cos(a) * d[k], c2[1] + Math.sin(a) * d[k]]); }
  capIt.fill = sil;
  capIt.washes.push({ pts: sil, color: colors.cap });

  // Contour: the zero line of n . c on the top surface, found by marching
  // squares on a (phi, u) grid (it can run along u or along phi), then
  // chained, then cut where the cap hides it.
  const NPH = 200, NU = 64, lines = capIt.lines;
  const F = new Float64Array((NPH + 1) * (NU + 1));
  for (let i = 0; i <= NPH; i++) for (let j = 0; j <= NU; j++) F[i * (NU + 1) + j] = dot(surf(cap.top, j / NU, (i % NPH) / NPH * TAU).n, camL);
  const f = (i, j) => F[i * (NU + 1) + j];
  // An edge key: 'h' joins (i,j)-(i+1,j), 'v' joins (i,j)-(i,j+1).
  const ekey = (t, i, j) => t + (i % NPH) + ',' + j;
  const epts = new Map();
  const epoint = key => {
    if (epts.has(key)) return epts.get(key);
    const t = key[0], [i, j] = key.slice(1).split(',').map(Number);
    const i2 = t === 'h' ? i + 1 : i, j2 = t === 'v' ? j + 1 : j;
    const f1 = f(i, j), f2 = f(i2, j2), w = f1 / ((f1 - f2) || 1e-12);
    const sp = surf(cap.top, lerp(j, j2, w) / NU, lerp(i, i2, w) / NPH * TAU);
    const q = { pt: cproj(sp.p), vis: !rayHit(off(sp)) };
    epts.set(key, q);
    return q;
  };
  const adj = new Map();
  const link = (a, b2) => {
    (adj.get(a) || adj.set(a, []).get(a)).push(b2);
    (adj.get(b2) || adj.set(b2, []).get(b2)).push(a);
  };
  for (let i = 0; i < NPH; i++) for (let j = 0; j < NU; j++) {
    const s0 = f(i, j) > 0, s1 = f(i + 1, j) > 0, s2 = f(i + 1, j + 1) > 0, s3 = f(i, j + 1) > 0;
    const es = [];
    if (s0 !== s1) es.push(ekey('h', i, j));
    if (s1 !== s2) es.push(ekey('v', i + 1, j));
    if (s3 !== s2) es.push(ekey('h', i, j + 1));
    if (s0 !== s3) es.push(ekey('v', i, j));
    if (es.length === 2) link(es[0], es[1]);
    else if (es.length === 4) { link(es[0], es[1]); link(es[2], es[3]); }
  }
  const used = new Set();
  const walk = start => {
    const seq = [start];
    used.add(start);
    let cur = start;
    for (;;) {
      const nx = (adj.get(cur) || []).find(k => !used.has(k));
      if (!nx) break;
      used.add(nx); seq.push(nx); cur = nx;
    }
    return seq;
  };
  const starts = [...adj.keys()].sort((x, y) => (adj.get(x).length - adj.get(y).length));
  for (const k0 of starts) {
    if (used.has(k0)) continue;
    let seq = walk(k0);
    // Extend the other way from the start, when the start was mid-line.
    const back = (adj.get(k0) || []).find(k => !used.has(k));
    if (back) { const rest = walk(back); seq = rest.reverse().concat(seq); }
    const p = seq.map(k => epoint(k));
    runs(p.map(q => q.pt), p.map(q => q.vis), 0, 'cap', lines);
  }

  // The rim crease, where it is not on the contour. The contour is on the
  // rim only where n . c of the top changes sign near u = 1. Where the top
  // faces the camera and the underside does not (a camera above the
  // cap), the rim is the silhouette, and the contour does not draw it.
  {
    const p = [], v = [];
    for (let k = 0; k <= 200; k++) {
      const phi = k / 200 * TAU, a = surf(cap.top, 1, phi), a2 = surf(cap.top, 0.97, phi);
      const onContour = facing(a.n) !== facing(a2.n);
      p.push(cproj(a.p)); v.push(!onContour && !rayHit(off(a)));
    }
    runs(p, v, 0, 'cap', lines);
  }

  // Morel: a net of ribs and pits, and no plain hatching.
  if (cap.prof === MOREL) { morelNet(C, K, thr); return; }

  // Meridian hatching on the dark side, then rings where it is darker.
  const nM = Math.round(20 + 90 * P.hatch);
  for (let k = 0; k < nM; k++) {
    const phi = TAU * (k + rnd() * 0.6) / nM;
    const u0 = [0.05, 0.18, 0.3][k % 3] + rnd() * 0.06;
    const p = [], v = [];
    for (let i = 0; i <= 36; i++) {
      const u = u0 + (1 - u0) * i / 36, sp = surf(cap.top, u, phi);
      const dk = dark(sp.n, litL) + 0.12 * nz(k * 1.7, u * 4);
      p.push(cproj(sp.p)); v.push(dk > thr && visTop(sp));
    }
    runs(p, v, 2, 'cap', lines);
  }
  const nR = Math.round(5 + 20 * P.hatch);
  for (let j = 0; j < nR; j++) {
    const u = 0.1 + 0.88 * (j + 0.5) / nR, p = [], v = [];
    for (let k = 0; k <= 160; k++) {
      const phi = k / 160 * TAU, sp = surf(cap.top, u + 0.01 * nz(j * 3.3, phi * 2), phi);
      const dk = dark(sp.n, litL) + 0.1 * nz(j * 5.1 + 40, phi * 3);
      p.push(cproj(sp.p)); v.push(dk > thr + 0.24 && visTop(sp));
    }
    runs(p, v, 2, 'cap', lines);
  }

  // Margin striations.
  if (P.striate > 0.02) {
    const n = Math.round(P.gills * 1.2 + 20);
    for (let k = 0; k < n; k++) {
      const phi = TAU * (k + rnd() * 0.5) / n, u0 = 1 - (0.06 + 0.32 * P.striate) * (0.6 + 0.6 * rnd());
      const p = [], v = [];
      for (let i = 0; i <= 8; i++) { const sp = surf(cap.top, u0 + (0.995 - u0) * i / 8, phi); p.push(cproj(sp.p)); v.push(visTop(sp)); }
      runs(p, v, 1, 'cap', lines);
    }
  }

  // Cap marks.
  const M = P.marks;
  if (M === 4) {
    const nZ = Math.min(12, 3 + Math.round(P.markN / 25));
    for (let j = 0; j < nZ; j++) {
      const uj = 0.15 + 0.8 * (j + 0.5) / nZ + 0.03 * (rnd() - 0.5), p = [], v = [];
      for (let k = 0; k <= 180; k++) {
        const phi = k / 180 * TAU, sp = surf(cap.top, clamp(uj + 0.014 * nz(j * 3.1, phi * 2.2), 0, 1), phi);
        p.push(cproj(sp.p)); v.push(visTop(sp));
      }
      runs(p, v, 1, 'cap', lines);
    }
    return;
  }
  if (!M || !P.markN) return;
  // A point on the top, uniform over the area (rejection on the radius).
  const areaPick = (u0, u1) => {
    for (let t = 0; t < 30; t++) {
      const u = u0 + (u1 - u0) * rnd();
      if (rnd() < readPath(cap.top, u)[0] / R) return u;
    }
    return u0 + (u1 - u0) * rnd();
  };
  const blob = (sp, rw, lift, wob, n) => {
    const T = sp.t, Bv = cross(sp.n, T), out = [];
    for (let j = 0; j < n; j++) {
      const a = j / n * TAU, rr = rw * (1 + wob * (rnd() - 0.5)), bump = lift * (0.6 + 0.4 * Math.cos(a));
      out.push(cproj([sp.p[0] + sp.n[0] * bump + (T[0] * Math.cos(a) + Bv[0] * Math.sin(a) * 1.15) * rr,
        sp.p[1] + sp.n[1] * bump + (T[1] * Math.cos(a) + Bv[1] * Math.sin(a) * 1.15) * rr,
        sp.p[2] + sp.n[2] * bump + (T[2] * Math.cos(a) + Bv[2] * Math.sin(a) * 1.15) * rr]));
    }
    return out;
  };
  const depth = p => dot(p, camL);
  if (M === 1 || M === 2) {
    const spots = M === 2;
    for (let i = 0; i < P.markN; i++) {
      const u = areaPick(0.04, 0.93), phi = rnd() * TAU, sp = surf(cap.top, u, phi);
      const rw = P.markSize * R * (spots ? 0.07 : 0.042) * (1.15 - 0.5 * u) * (0.6 + 0.8 * rnd());
      const wob = spots ? 0.45 : 0.3;
      if (!visTop(sp)) { rnd(); continue; }
      const poly = blob(sp, rw, spots ? rw * 0.06 : rw * 0.4, wob, spots ? 11 : 9);
      const it = item('marks');
      it.depth = depth(sp.p);
      it.fill = poly;
      it.lines.push({ pts: poly.concat([poly[0]]), kind: 1, part: 'marks' });
      it.washes.push({ pts: poly, color: colors.mark });
      if (!spots && dark(sp.n, litL) > 0.35) {
        const sh = blob(sp, rw * 0.55, rw * 0.5, 0.1, 9).slice(1, 5);
        it.lines.push({ pts: sh, kind: 2, part: 'marks' });
      }
      marks.push(it);
    }
  } else if (M === 5) {
    const it = item('marks');
    it.depth = Infinity;
    for (let i = 0; i < P.markN * 1.6; i++) {
      const u = areaPick(0.02, cap.special ? 0.85 : 0.95), phi = rnd() * TAU, sp = surf(cap.top, u, phi);
      const rw = P.markSize * R * 0.016 * (0.7 + 0.6 * rnd());
      if (!visTop(sp)) continue;
      const poly = blob(sp, rw, rw * 0.5, 0.2, 5);
      it.lines.push({ pts: poly.concat([poly[0]]), kind: 1, part: 'marks' });
    }
    marks.push(it);
  } else if (M === 3) {
    // Scales: rows of flaps that hang toward the margin; a solid patch
    // at the apex.
    const nRows = clamp(Math.round(3 + P.markN / 14), 3, 14);
    const lift = 0.025 * R * P.markSize;
    for (let j = 0; j < nRows; j++) {
      const uj = 0.13 + 0.8 * Math.pow(j / nRows, 0.85), du = 0.85 / nRows * 1.35 * P.markSize;
      const rr = readPath(cap.top, uj)[0] / R;
      const cnt = Math.max(5, Math.round(P.markN / nRows * rr * 1.6));
      for (let k = 0; k < cnt; k++) {
        const phi = TAU * (k + 0.5 * (j % 2) + 0.2 * (rnd() - 0.5)) / cnt, dph = PI / cnt * 0.85 * (0.8 + 0.4 * rnd());
        const ub = Math.min(0.995, uj + du * (0.7 + 0.5 * rnd()));
        const mid = surf(cap.top, (uj + ub) / 2, phi);
        if (!visTop(mid)) continue;
        const at = (u, ph, l) => { const s = surf(cap.top, Math.min(1, u), ph); return cproj([s.p[0] + s.n[0] * l, s.p[1] + s.n[1] * l, s.p[2] + s.n[2] * l]); };
        const Lp = at(uj, phi - dph, 0), Rp = at(uj, phi + dph, 0);
        const M1 = at(uj + (ub - uj) * 0.6, phi - dph * 0.55, lift * 0.5), M2 = at(uj + (ub - uj) * 0.6, phi + dph * 0.55, lift * 0.5);
        const Tp = at(ub, phi + dph * 0.15 * (rnd() - 0.5), lift);
        const Up = at(uj - du * 0.08, phi, 0);
        const it = item('marks');
        it.depth = depth(mid.p);
        it.fill = [Lp, M1, Tp, M2, Rp, Up];
        it.lines.push({ pts: [Lp, M1, Tp, M2, Rp], kind: 1, part: 'marks' });
        it.washes.push({ pts: it.fill, color: colors.mark });
        marks.push(it);
      }
    }
    if (C.e > 0) {
      const ring = [];
      for (let k = 0; k < 48; k++) { const phi = k / 48 * TAU; ring.push(cproj(surf(cap.top, 0.11 + 0.02 * nz(k * 0.7, 9), phi).p)); }
      const it = item('marks');
      it.depth = 1e9;
      it.fill = ring;
      it.lines.push({ pts: ring.concat([ring[0]]), kind: 1, part: 'marks' });
      it.washes.push({ pts: ring, color: colors.mark });
      marks.push(it);
    }
  }
}

// Morel: wavy vertical ribs, cross ribs between them, and dark pits with
// short strokes inside.
function morelNet(C, K, thr) {
  const { P } = C;
  const { cap, surf, visTop, cproj, litL, rnd, nz, capIt } = K;
  const nRib = clamp(10 + Math.round(P.markN / 14), 8, 26), nRow = clamp(5 + Math.round(P.markN / 22), 4, 14);
  const ribPhi = (k, u) => TAU * k / nRib + 0.32 * (TAU / nRib) * nz(k * 2.3, u * 3.2);
  const lines = capIt.lines;
  for (let k = 0; k < nRib; k++) {
    const p = [], v = [];
    for (let i = 0; i <= 40; i++) { const u = 0.03 + 0.95 * i / 40, sp = surf(cap.top, u, ribPhi(k, u)); p.push(cproj(sp.p)); v.push(visTop(sp)); }
    runs(p, v, 1, 'cap', lines);
  }
  const cu = [];
  for (let k = 0; k < nRib; k++) {
    const row = [0.03];
    for (let j = 1; j < nRow; j++) row.push(j / nRow + 0.45 / nRow * (rnd() - 0.5));
    row.push(0.98);
    cu.push(row);
  }
  for (let k = 0; k < nRib; k++) {
    const k2 = (k + 1) % nRib;
    for (let j = 1; j < nRow; j++) {
      if (rnd() < 0.12) continue;
      const ua = cu[k][j], ub = cu[k][j] + 0.25 / nRow * (rnd() - 0.5), p = [], v = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, u = lerp(ua, ub, t);
        let pa = ribPhi(k, u), pb = ribPhi(k2, u);
        if (k2 === 0) pb += TAU;
        const sp = surf(cap.top, u, lerp(pa, pb, t));
        p.push(cproj(sp.p)); v.push(visTop(sp));
      }
      runs(p, v, 1, 'cap', lines);
    }
  }
  const pit = hsl(P.capHue, P.capSat, P.capLit * 0.55);
  for (let k = 0; k < nRib; k++) {
    const k2 = (k + 1) % nRib;
    for (let j = 0; j < nRow; j++) {
      const u0 = cu[k][j], u1 = cu[k][j + 1], um = (u0 + u1) / 2;
      let pa = ribPhi(k, um), pb = ribPhi(k2, um);
      if (k2 === 0) pb += TAU;
      const mid = surf(cap.top, um, (pa + pb) / 2);
      if (!visTop(mid)) continue;
      const poly = [];
      const edge = (u, f) => { let a = ribPhi(k, u), bq = ribPhi(k2, u); if (k2 === 0) bq += TAU; return cproj(surf(cap.top, u, lerp(a, bq, f)).p); };
      const ins = 0.12, uu0 = lerp(u0, u1, ins), uu1 = lerp(u0, u1, 1 - ins);
      for (let i = 0; i <= 4; i++) poly.push(edge(uu0, lerp(ins, 1 - ins, i / 4)));
      for (let i = 0; i <= 4; i++) poly.push(edge(lerp(uu0, uu1, i / 4), 1 - ins));
      for (let i = 0; i <= 4; i++) poly.push(edge(uu1, lerp(1 - ins, ins, i / 4)));
      for (let i = 0; i <= 4; i++) poly.push(edge(lerp(uu1, uu0, i / 4), ins));
      capIt.washes.push({ pts: poly, color: pit });
      const dk = dark(mid.n, litL), ns = dk > thr ? 4 : dk > thr - 0.25 ? 2 : 1;
      for (let s = 0; s < ns; s++) {
        const f = 0.25 + 0.5 * (ns > 1 ? s / (ns - 1) : 0.5) + 0.06 * (rnd() - 0.5);
        lines.push({ pts: [edge(lerp(u0, u1, 0.22), f), edge(um, f), edge(lerp(u0, u1, 0.78), f)], kind: 2, part: 'cap' });
      }
    }
  }
}

// ── underItems ──────────────────────────────────────────────────────────────
// The underside lines run on the under path (rim at u = 0, stem at u = 1),
// a little below the surface. Every point is ray-marched through the cap.
function underItems(C, K) {
  const { P } = C;
  const { cap, surf, rayHit, cproj, rnd, R, underIt } = K;
  const lines = underIt.lines, off = 0.006 * R;
  const at = (u, phi) => { const s = surf(cap.under, u, phi); return [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off, s.p[2] + s.n[2] * off]; };
  const line = (samples, kind) => {
    const p = [], v = [];
    for (const q of samples) { p.push(cproj(q)); v.push(!rayHit(q)); }
    runs(p, v, kind, 'under', lines);
  };
  const U = P.under;
  if (U === 4 || cap.prof === MOREL || cap.prof === PUFF) return;
  if (U === 0) {
    const N = P.gills, step = TAU / N;
    for (let k = 0; k < N; k++) {
      const phi = step * (k + 0.3 * (rnd() - 0.5)), s = [];
      for (let i = 0; i <= 16; i++) s.push(at(i / 16, phi));
      line(s, 1);
    }
    const len = [0.55, 0.3, 0.16];
    // At most about 220 gill lines in all, so a dense cap stays readable.
    const tiers = Math.min(P.lamellulae, Math.max(0, Math.floor(Math.log2(220 / N))));
    for (let t = 1; t <= tiers; t++) {
      const m = 1 << t;
      for (let k = 0; k < N * m; k++) {
        if (k % 2 === 0) continue;
        const phi = step * (k / m + 0.15 * (rnd() - 0.5) / m), s = [];
        const L = len[t - 1] * (0.8 + 0.4 * rnd());
        for (let i = 0; i <= 6; i++) s.push(at(L * i / 6, phi));
        line(s, 1);
      }
    }
  } else if (U === 1) {
    const sp = Math.max(0.03 * R, cap.under.L / 26);
    const rows = Math.max(6, Math.round(cap.under.L / sp));
    let budget = 1800;
    for (let j = 0; j < rows && budget > 0; j++) {
      const u = (j + 0.5) / rows * 0.94 + 0.02, r = readPath(cap.under, u)[0];
      const cnt = Math.max(6, Math.round(TAU * r / sp));
      for (let k = 0; k < cnt && budget > 0; k++, budget--) {
        const phi = TAU * (k + 0.5 * (j % 2) + 0.25 * (rnd() - 0.5)) / cnt;
        const s = surf(cap.under, u, phi), c = [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off, s.p[2] + s.n[2] * off];
        if (rayHit(c)) continue;
        const T = s.t, Bv = cross(s.n, T), rp = sp * (0.24 + 0.1 * rnd()), loop = [];
        for (let a = 0; a <= 6; a++) {
          const an = a / 6 * TAU;
          loop.push(cproj([c[0] + (T[0] * Math.cos(an) + Bv[0] * Math.sin(an)) * rp, c[1] + (T[1] * Math.cos(an) + Bv[1] * Math.sin(an)) * rp, c[2] + (T[2] * Math.cos(an) + Bv[2] * Math.sin(an)) * rp]));
        }
        lines.push({ pts: loop, kind: 1, part: 'under' });
      }
    }
  } else if (U === 2) {
    const sp = Math.max(0.045 * R, cap.under.L / 18), rows = Math.max(5, Math.round(cap.under.L / sp));
    for (let j = 0; j < rows; j++) {
      const u = (j + 0.5) / rows * 0.92, r = readPath(cap.under, u)[0];
      const cnt = Math.max(6, Math.round(TAU * r / sp));
      for (let k = 0; k < cnt; k++) {
        const phi = TAU * (k + 0.5 * (j % 2) + 0.3 * (rnd() - 0.5)) / cnt;
        const c = at(u, phi), len = 0.085 * R * (0.5 + 0.8 * rnd()) * (1 - 0.45 * u);
        const dx = (rnd() - 0.5) * len * 0.25, dz = (rnd() - 0.5) * len * 0.25;
        line([c, [c[0] + dx * 0.4, c[1] - len * 0.55, c[2] + dz * 0.4], [c[0] + dx, c[1] - len, c[2] + dz]], 1);
      }
    }
  } else if (U === 3) {
    const n = Math.round(P.gills * 0.5) + 6, step = TAU / n;
    for (let k = 0; k < n; k++) {
      const phi = step * (k + 0.3 * (rnd() - 0.5)), trunk = [];
      for (let i = 0; i <= 8; i++) { const u = 1 - 0.5 * i / 8; trunk.push(at(u, phi + 0.05 * step * Math.sin(u * 9 + k))); }
      line(trunk, 1);
      for (const sgn of [-1, 1]) {
        const br = [], split = rnd() < 0.5;
        for (let i = 0; i <= 8; i++) { const u = 0.5 - 0.5 * i / 8; br.push(at(u, phi + sgn * step * 0.27 * (1 - u / 0.5))); }
        line(br, 1);
        if (split) {
          const b2 = [], ph0 = phi + sgn * step * 0.27 * (1 - 0.22 / 0.5);
          for (let i = 0; i <= 4; i++) { const u = 0.22 - 0.22 * i / 4; b2.push(at(u, ph0 + sgn * step * 0.12 * (i / 4))); }
          line(b2, 1);
        }
      }
    }
  }
}

// ── stemItems ───────────────────────────────────────────────────────────────
// The stem, its texture, the ring and the volva. For e < 0 every stem line
// is ray-marched through the cap of the same body, and the stem fill is cut
// at the height where the cap starts to hide its front.
function stemItems(C, K) {
  const { P, colors } = C;
  const { b, spine, rho, proj, toL, rayHit, cap, rnd, nz, R } = K;
  const H = b.H, below = C.e < 0;
  const hidden = w => {
    if (!below) return false;
    const l = toL(w);
    return l[1] > cap.hmin - 0.1 * R && rayHit(l);
  };
  const at = (u, phi, k = 1) => { const c = spine(u), r = rho(u) * k; return [c[0] + r * Math.cos(phi), c[1], c[2] + r * Math.sin(phi)]; };
  const stem = item('stem'), lines = stem.lines;
  const sampled = (fn, n, kind, part, out) => {
    const p = [], v = [];
    for (let i = 0; i <= n; i++) { const w = fn(i / n); p.push(proj(w)); v.push(!hidden(w)); }
    runs(p, v, kind, part, out);
  };
  // Edges and base arc.
  const NE = 48;
  sampled(u => at(u, PI), NE, 0, 'stem', lines);
  sampled(u => at(u, 0), NE, 0, 'stem', lines);
  const arcSign = 1;
  sampled(t => at(0, arcSign * PI * t), 24, 0, 'stem', lines);
  // Fill: cut at the top visible height of each edge.
  const topOf = phi => {
    if (!below) return 1;
    for (let u = 1; u > 0; u -= 0.01) if (!hidden(at(u, phi))) return Math.min(1, u + 0.01);
    return 0;
  };
  const uL = topOf(PI), uR = topOf(0), uC = topOf(PI / 2);
  const fill = [];
  for (let i = 0; i <= 24; i++) fill.push(proj(at(uL * i / 24, PI)));
  for (let i = 1; i < 8; i++) { const t = i / 8; fill.push(proj(at(Math.min(uL, uR, uC), PI - PI * t))); }
  for (let i = 24; i >= 0; i--) fill.push(proj(at(uR * i / 24, 0)));
  for (let i = 1; i < 24; i++) fill.push(proj(at(0, arcSign * PI * i / 24)));
  stem.fill = fill;
  stem.washes.push({ pts: fill, color: colors.flesh });

  // Texture.
  const thr = 1.08 - 0.8 * P.shade;
  const sdark = phi => dark([Math.cos(phi), 0, Math.sin(phi)], LIGHT);
  const tex = P.stemTex;
  const hatchStem = (n, phiMax, kind) => {
    for (let k = 0; k < n; k++) {
      const phi = 0.04 + phiMax * Math.pow(rnd(), 1.4), u0 = rnd() * 0.25, u1 = 0.75 + rnd() * 0.25;
      const p = [], v = [];
      for (let i = 0; i <= 24; i++) {
        const u = lerp(u0, u1, i / 24), w = at(u, phi + 0.03 * nz(k, u * 6));
        p.push(proj(w)); v.push(sdark(phi) + 0.15 * nz(k * 3.7, u * 5) > thr && !hidden(w));
      }
      runs(p, v, kind, 'stem', lines);
    }
  };
  hatchStem(Math.round(4 + 14 * P.hatch), 1.2, 2);
  if (tex === 1) {
    const n = Math.round(14 + 40 * P.hatch);
    for (let k = 0; k < n; k++) {
      const phi = 0.06 + 2.9 * Math.pow(rnd(), 1.5), u0 = rnd() * 0.7, u1 = Math.min(1, u0 + 0.15 + 0.5 * rnd());
      const p = [], v = [];
      for (let i = 0; i <= 14; i++) { const u = lerp(u0, u1, i / 14), w = at(u, phi + 0.04 * nz(k * 1.3, u * 8)); p.push(proj(w)); v.push(!hidden(w) && nz(k * 7.1, u * 9) > -0.35); }
      runs(p, v, 2, 'stem', lines);
    }
  } else if (tex === 2) {
    const top = P.ring ? P.ringPos - 0.04 : 0.92;
    for (let u = 0.07; u < top; u += 0.055 + 0.02 * rnd()) {
      const p = [], v = [];
      let i = 0;
      for (let phi = 0.1; phi <= PI - 0.1; phi += 0.22, i++) {
        const w = at(u + (i % 2 ? 0.022 : -0.012) + 0.008 * (rnd() - 0.5), phi);
        p.push(proj(w)); v.push(!hidden(w));
      }
      runs(p, v, 1, 'stem', lines);
    }
  } else if (tex === 3) {
    const rows = Math.max(6, Math.round(H / (b.rTop * 0.9))), nph = 16;
    const node = (j, i) => {
      const u = clamp(0.04 + 0.9 * j / rows + 0.012 * nz(j * 2.1, i * 1.7), 0, 1);
      return [u, TAU * (i + 0.5 * (j % 2)) / nph + 0.06 * nz(i * 3.3, j * 1.1)];
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < nph; i++) {
      const a = node(j, i);
      for (const di of [0, (j % 2) ? 1 : -1]) {
        const bq = node(j + 1, i + di);
        if (Math.sin(a[1]) < -0.05 && Math.sin(bq[1]) < -0.05) continue;
        const p = [], v = [];
        for (let t = 0; t <= 3; t++) {
          const w = at(lerp(a[0], bq[0], t / 3), lerp(a[1], bq[1], t / 3), 1.01);
          p.push(proj(w)); v.push(Math.sin(lerp(a[1], bq[1], t / 3)) > 0.02 && !hidden(w));
        }
        runs(p, v, 1, 'stem', lines);
      }
    }
  } else if (tex === 4) {
    const n = Math.round(40 + 80 * P.hatch);
    for (let k = 0; k < n; k++) {
      const u = rnd() * 0.95, phi = 0.12 + rnd() * (PI - 0.24), du = 0.02 * Math.max(0.5, b.rTop / H * 6);
      const a = at(u + du, phi - 0.08), m = at(u, phi), c = at(u + du, phi + 0.08);
      if (hidden(m)) continue;
      lines.push({ pts: [proj(a), proj(m), proj(c)], kind: 1, part: 'stem' });
    }
  }
  // The cap shadow on the stem top.
  if (!below && cap.prof !== PUFF) {
    const sh = Math.min(0.35, 0.55 * R / H), n = Math.round(3 + 7 * P.hatch);
    for (let j = 0; j < n; j++) {
      const u = 1 - sh * (j + 0.5) / n, p = [];
      const end = PI * (0.25 + 0.6 * (1 - (j + 0.5) / n));
      for (let i = 0; i <= 10; i++) p.push(proj(at(u + 0.004 * (rnd() - 0.5), 0.04 + end * i / 10)));
      lines.push({ pts: p, kind: 2, part: 'stem' });
    }
  }
  // Decurrent ridges (chanterelle): the underside ridges run on down the stem.
  if (P.under === 3 && cap.prof !== MOREL && cap.prof !== PUFF) {
    const n = Math.round(P.gills * 0.5) + 6, dec = Math.min(0.35, 0.5 * R / H);
    for (let k = 0; k < n; k++) {
      const phi = TAU * k / n;
      if (Math.sin(phi) < 0.08) continue;
      sampled(t => at(1 - dec * t, phi + 0.05 * Math.sin(t * 5 + k)), 8, 1, 'stem', lines);
    }
  }

  // Ring and volva.
  const back = [], front = [];
  if (P.ring && cap.prof !== MOREL && cap.prof !== PUFF) {
    const uR = P.ringPos, rr = rho(uR), skirt = P.ring === 2;
    const rt = rr * 1.06, rb = skirt ? rr * 1.06 + 0.13 * R : rr * 1.32 + 0.03 * R, drop = skirt ? 0.17 * R : 0.05 * R + 0.04 * rr;
    const W1 = periodicTable(makePeriodic(rnd, 5, 12)), W2 = periodicTable(makePeriodic(rnd, 6, 14));
    const rp = (v, phi) => {
      const c = spine(uR - drop * v / H), rad = lerp(rt, rb, Math.pow(v, 0.6)) * (1 + 0.06 * v * W1(phi));
      return [c[0] + rad * Math.cos(phi), c[1] - 0.025 * R * v * W2(phi), c[2] + rad * Math.sin(phi)];
    };
    const ringBack = item('ring'), ringFront = item('ring');
    sampled(t => rp(1, PI + PI * t), 40, 1, 'ring', ringBack.lines);
    const bf = [];
    for (let i = 0; i <= 30; i++) bf.push(proj(rp(1, PI + PI * i / 30)));
    for (let i = 30; i >= 0; i--) bf.push(proj(rp(0, PI + PI * i / 30)));
    ringBack.fill = bf;
    ringBack.washes.push({ pts: bf, color: colors.ring });
    const ff = [];
    for (let i = 0; i <= 30; i++) ff.push(proj(rp(0, PI * i / 30)));
    for (let i = 30; i >= 0; i--) ff.push(proj(rp(1, PI * i / 30)));
    ringFront.fill = ff;
    ringFront.washes.push({ pts: ff, color: colors.ring });
    sampled(t => rp(0, PI * t), 30, 1, 'ring', ringFront.lines);
    sampled(t => rp(1, PI * t), 40, 0, 'ring', ringFront.lines);
    sampled(v => rp(v, 0.02), 8, 0, 'ring', ringFront.lines);
    sampled(v => rp(v, PI - 0.02), 8, 0, 'ring', ringFront.lines);
    const nf = Math.round(4 + 8 * P.hatch);
    for (let k = 0; k < nf; k++) {
      const phi = 0.08 + Math.pow(rnd(), 1.3) * 2.9, v0 = 0.12 + 0.3 * rnd();
      sampled(v => rp(lerp(v0, 0.97, v), phi + 0.04 * Math.sin(v * 4 + k)), 6, 2, 'ring', ringFront.lines);
    }
    back.push(ringBack); front.push(ringFront);
  }
  if (P.volva > 0.02 && cap.prof !== MOREL && cap.prof !== PUFF) {
    const r0 = rho(0), vb = r0 * 1.1 + 0.02 * R, vl = r0 * (1.25 + 0.6 * P.volva) + 0.04 * R;
    const hv = (0.12 + 0.35 * P.volva) * Math.min(H, 1.2 * R);
    const jag = periodicTable(makePeriodic(rnd, 5, 15)), W = periodicTable(makePeriodic(rnd, 3, 8));
    const vp = (v, phi) => {
      const c = spine(0), lip = hv * (1 + 0.3 * Math.abs(jag(phi)) - 0.1);
      const rad = lerp(vb, vl, Math.pow(v, 0.7)) * (1 + 0.05 * W(phi));
      return [c[0] + rad * Math.cos(phi), lip * v, c[2] + rad * Math.sin(phi)];
    };
    const vBack = item('volva'), vFront = item('volva');
    sampled(t => vp(1, PI + PI * t), 50, 1, 'volva', vBack.lines);
    const bf = [];
    for (let i = 0; i <= 30; i++) bf.push(proj(vp(1, PI + PI * i / 30)));
    for (let i = 30; i >= 0; i--) bf.push(proj(vp(0, PI + PI * i / 30)));
    vBack.fill = bf;
    vBack.washes.push({ pts: bf, color: colors.ring });
    const ff = [];
    for (let i = 0; i <= 30; i++) ff.push(proj(vp(0, PI * i / 30)));
    for (let i = 30; i >= 0; i--) ff.push(proj(vp(1, PI * i / 30)));
    vFront.fill = ff;
    vFront.washes.push({ pts: ff, color: colors.ring });
    sampled(t => vp(1, PI * t), 50, 0, 'volva', vFront.lines);
    sampled(t => vp(0, PI * t), 24, 0, 'volva', vFront.lines);
    sampled(v => vp(v, 0.02), 6, 0, 'volva', vFront.lines);
    sampled(v => vp(v, PI - 0.02), 6, 0, 'volva', vFront.lines);
    const nw = Math.round(3 + 6 * P.hatch);
    for (let k = 0; k < nw; k++) {
      const phi = 0.08 + Math.pow(rnd(), 1.4) * 2.6;
      sampled(v => vp(lerp(0.1, 0.85 * rnd() + 0.1, v), phi), 5, 2, 'volva', vFront.lines);
    }
    back.push(vBack); front.push(vFront);
  }
  return { stem, back, front };
}

// ── buildSpecimen ───────────────────────────────────────────────────────────
export function buildSpecimen(params, seed, opts = null) {
  const P = sanitize(params);
  seed = seed >>> 0;
  const rnd = mulberry((seed ^ 0xA5A5F00D) >>> 0);
  const e = P.elev, se = Math.sin(e), ce = Math.cos(e);
  const eg = Math.max(Math.abs(e), 0.2), seg = Math.sin(eg);
  const colors = {
    cap: hsl(P.capHue, P.capSat, P.capLit), mark: hsl(P.capHue, P.capSat * 0.35, P.markLit),
    gill: hsl(P.gillHue, P.gillSat, P.gillLit), flesh: hsl(P.fleshHue, P.fleshSat, P.fleshLit),
    ring: hsl(P.fleshHue, P.fleshSat * 0.7, Math.min(0.97, P.fleshLit * 1.04)),
    ground: hsl(36, 0.22, 0.66), moss: hsl(92, 0.32, 0.46),
  };
  const C = { P, e, se, ce, eg, seg, colors, seed };
  const bodies = placeBodies(P, rnd, seed);
  const groups = [];
  for (const b of bodies) groups.push({ z: b.z, items: makeBody(C, b) });
  groups.push(...groundItems(C, bodies, rnd));
  groups.sort((a, b) => a.z - b.z);

  const F = flatten(groups, P.capR, bodies.length);
  const debug = opts && opts.debug ? { occs: F.occs, vis: F.vis } : undefined;
  return { debug, name: randomName(seed), seed, params: P, xy: F.xy, offs: F.offs, lens: F.lens, total: F.total, kinds: F.kinds,
    part: F.part, order: F.order, washes: F.washes, parts: PART_NAMES, bbox: F.bbox, stats: F.stats };
}

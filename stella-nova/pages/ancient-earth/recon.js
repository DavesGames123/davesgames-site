// ============================================================================
//  ANCIENT EARTH  ·  recon.js  ·  plate reconstruction (no DOM, no THREE)
// ----------------------------------------------------------------------------
//  A port of the GPlates finite-rotation model, enough to move a present-day
//  point on a plate back to its place at an age t (Ma), and back again.
//  tests.mjs checks it against pygplates 1.0 (tests/expected.json).
//
//  The rotation file (data/rotations.json, from build/build_data.py) is a
//  list of sequences [moving, fixed, [t, lat, lon, angle, ...]]: total
//  reconstruction poles of the moving plate relative to the fixed plate.
//
//  Plate P at age t:
//    1. Find the first sequence of P whose time span holds t. At an age
//       where two sequences meet (a crossover), use the sequence that
//       pygplates picked there (the "xover" list in rotations.json).
//    2. Interpolate its two poles that bracket t: unit quaternion slerp
//       on the shorter arc, at f = (t - t1) / (t2 - t1).
//    3. A sequence with a non-zero pole at 0 Ma is corrected by the inverse
//       of that pole (pygplates 1.0 does this).
//    4. Compose with the fixed plate:  R(P) = R(fixed) * R(P rel fixed),
//       down the chain to the anchor plate 0 (identity).
//  A tree for one t is cached, so many points at one age cost one lookup.
//
//  The polygon raster (data/plateidx.bin) gives the polygon (and so the
//  plate) under a present-day point. A polygon has a begin age: before it,
//  that crust is not in the model.
//
//  grep -n targets
//    pole to quaternion ...... "function poleQuat"
//    interpolation ........... "function slerp"
//    plate rotation at t ..... "rotationAt"
//    present -> past ......... "reconstruct("
//    past -> present ......... "unreconstruct("
//    polygon lookup .......... "polyAt("
// ============================================================================

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Unit quaternion [w, x, y, z] of a rotation by `ang` degrees about the
// pole at (lat, lon) degrees.
export function poleQuat(lat, lon, ang) {
  const la = lat * D2R, lo = lon * D2R, h = ang * D2R / 2, s = Math.sin(h);
  return [Math.cos(h), s * Math.cos(la) * Math.cos(lo), s * Math.cos(la) * Math.sin(lo), s * Math.sin(la)];
}
export function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
export const qconj = q => [q[0], -q[1], -q[2], -q[3]];
export const QI = [1, 0, 0, 0];

// Spherical linear interpolation, on the shorter arc (GPlates flips the
// second quaternion when the dot product is negative).
export function slerp(a, b, f) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let s = 1;
  if (d < 0) { d = -d; s = -1; }
  if (d > 0.9999995) {
    const q = [a[0] + (s * b[0] - a[0]) * f, a[1] + (s * b[1] - a[1]) * f, a[2] + (s * b[2] - a[2]) * f, a[3] + (s * b[3] - a[3]) * f];
    const n = Math.hypot(...q); return q.map(v => v / n);
  }
  const th = Math.acos(d), st = Math.sin(th);
  const ka = Math.sin((1 - f) * th) / st, kb = s * Math.sin(f * th) / st;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}

export function rotate(q, v) {
  // v' = q v q*, for a unit quaternion.
  const [w, x, y, z] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
export function llToVec(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
export function vecToLL(v) {
  return [Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D, Math.atan2(v[1], v[0]) * R2D];
}
// Great-circle distance in km (mean radius 6371 km).
export function gcKm(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * 6371;
}
export function quatToPole(q) {
  let [w, x, y, z] = q;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const ang = 2 * Math.acos(Math.min(1, w)) * R2D, s = Math.hypot(x, y, z);
  if (s < 1e-12) return [90, 0, 0];
  return [Math.asin(z / s) * R2D, Math.atan2(y, x) * R2D, ang];
}

export class RotationModel {
  constructor(json) {
    this.anchor = json.anchor || 0;
    this.byPlate = new Map();
    const seqs = [];
    for (const [mov, fix, flat] of json.seq) {
      const n = flat.length / 4, t = new Float64Array(n), q = [];
      for (let i = 0; i < n; i++) { t[i] = flat[4 * i]; q.push(poleQuat(flat[4 * i + 1], flat[4 * i + 2], flat[4 * i + 3])); }
      if (!this.byPlate.has(mov)) this.byPlate.set(mov, []);
      const s = { fix, t, q, q0: null };
      this.byPlate.get(mov).push(s); seqs.push(s);
    }
    // Crossover picks from pygplates: "mov|age" -> the sequence to use.
    this.xover = new Map();
    for (const [mov, t, i] of json.xover || []) this.xover.set(mov + '|' + t, seqs[i]);
    // pygplates 1.0 removes a non-zero present-day pole: a sequence that
    // spans 0 Ma gives R(t) * R(0)^-1, so every plate sits at its present
    // place at 0 Ma. (PALEOMAP plate 198 has an 83.7 deg pole at 0 Ma.)
    for (const list of this.byPlate.values()) for (const s of list) {
      const n = s.t.length;
      if (n < 2 || 0 < s.t[0] || 0 > s.t[n - 1]) continue;
      const q0 = this.interp(s, 0);
      if (Math.abs(Math.abs(q0[0]) - 1) > 1e-12) s.q0 = qconj(q0);
    }
    this.cacheT = NaN; this.cache = new Map();
  }
  // Relative rotation of `mov` to its fixed plate at age t, or null.
  relative(mov, t) {
    const list = this.byPlate.get(mov);
    if (!list) return null;
    // At a crossover age (two sequences meet), use the pick pygplates made
    // (build/build_data.py records it). Elsewhere one sequence holds t.
    const x = this.xover.size ? this.xover.get(mov + '|' + t) : null;
    for (const s of x ? [x] : list) {
      const n = s.t.length;
      if (n < 2 || t < s.t[0] || t > s.t[n - 1]) continue;
      const q = this.interp(s, t);
      return { fix: s.fix, q: s.q0 ? qmul(q, s.q0) : q };
    }
    return null;
  }
  interp(s, t) {
    const n = s.t.length;
    let i = 0;
    while (i < n - 2 && t > s.t[i + 1]) i++;
    const t1 = s.t[i], t2 = s.t[i + 1];
    const f = t2 > t1 ? Math.min(1, Math.max(0, (t - t1) / (t2 - t1))) : 0;
    return slerp(s.q[i], s.q[i + 1], f);
  }
  // Absolute rotation (relative to the anchor plate) of plate `p` at t.
  // A plate with no sequence at t does not move (identity), as in GPlates.
  rotationAt(p, t) {
    if (t !== this.cacheT) { this.cacheT = t; this.cache.clear(); }
    const c = this.cache.get(p);
    if (c) return c;
    let q = QI;
    if (p !== this.anchor) {
      this.cache.set(p, QI); // a guard against cycles
      const r = this.relative(p, t);
      if (r) q = qmul(this.rotationAt(r.fix, t), r.q);
    }
    this.cache.set(p, q);
    return q;
  }
}

// Plates + polygons + raster: the reconstruction service the page uses.
export class Plates {
  constructor(rotJson, polyJson, raster, rmeta) {
    this.rot = new RotationModel(rotJson);
    this.poly = polyJson.poly;
    this.names = polyJson.names || {};
    this.raster = raster; this.rw = rmeta.w; this.rh = rmeta.h; this.rstep = rmeta.step; this.none = rmeta.none;
  }
  // Polygon index under a present-day point, or -1 (old sea floor).
  polyAt(lat, lon) {
    const j = Math.min(this.rh - 1, Math.max(0, Math.floor((lat + 90) / this.rstep)));
    const i = Math.floor((((lon + 180) % 360 + 360) % 360) / this.rstep) % this.rw;
    const k = this.raster[j * this.rw + i];
    return k === this.none ? -1 : k;
  }
  alive(k, t) { const p = this.poly[k]; return p && t <= p.b + 1e-9 && t >= p.e - 1e-9; }
  quatOfPoly(k, t) { return this.rot.rotationAt(this.poly[k].p, t); }
  // Present (lat, lon) -> { lat, lon, poly, plate } at age t, or null.
  reconstruct(lat, lon, t, k = this.polyAt(lat, lon)) {
    if (k < 0 || !this.alive(k, t)) return null;
    const v = rotate(this.quatOfPoly(k, t), llToVec(lat, lon));
    const [la, lo] = vecToLL(v);
    return { lat: la, lon: lo, poly: k, plate: this.poly[k].p, v };
  }
  // Paleo (lat, lon) at age t -> the present-day place of that crust. Tries
  // each polygon alive at t: rotate back, and keep it if the raster agrees.
  // Reconstructed polygons can overlap (a stretched margin over its craton
  // before a rift, for example Lord Howe Rise over Australia at 200 Ma).
  // Then the largest polygon wins and the rest are in `others`.
  unreconstruct(lat, lon, t) {
    const v = llToVec(lat, lon), hits = [];
    for (let k = 0; k < this.poly.length; k++) {
      if (!this.alive(k, t)) continue;
      const w = rotate(qconj(this.quatOfPoly(k, t)), v);
      const [la, lo] = vecToLL(w);
      if (this.polyAt(la, lo) === k) hits.push({ lat: la, lon: lo, poly: k, plate: this.poly[k].p });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => this.poly[b.poly].a - this.poly[a.poly].a);
    return { ...hits[0], others: hits.slice(1) };
  }
  plateName(p) { return this.names[p] || ''; }
}

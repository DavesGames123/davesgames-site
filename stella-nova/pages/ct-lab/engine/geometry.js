// geometry.js - scan geometries for the CT engine (parallel, fan, cone).
// Conventions are in CONTRACT.md. Angle b: central ray d = (-sin b, cos b),
// detector axis n = (cos b, sin b), detector coordinate u_i = (i - (nDet-1)/2)*du + offset.
//
// grep handles:
//   anglesFull, parallelGeometry, fanGeometry, coneGeometry, fitGeometry,
//   sparseAngles, limitedAngle, rayFor, rayFor3D, detCoord, angleWeights, coverage

const TAU = Math.PI * 2;

export function anglesFull(n, arc = Math.PI, start = 0) {
  const a = new Float32Array(n);
  for (let k = 0; k < n; k++) a[k] = start + (arc * k) / n;
  return a;
}

function pickAngles(o, defArc) {
  if (o.angles) return Float32Array.from(o.angles);
  return anglesFull(o.nAngles ?? 180, o.arc ?? defArc, o.start ?? 0);
}

export function parallelGeometry(o = {}) {
  const angles = pickAngles(o, Math.PI);
  return {
    type: 'parallel', angles, nAngles: angles.length,
    nDet: o.nDet ?? 256, du: o.du ?? 2 / 256, offset: o.offset ?? 0,
  };
}

export function fanGeometry(o = {}) {
  const angles = pickAngles(o, TAU);
  const sod = o.sod ?? 4, sdd = o.sdd ?? 8;
  return {
    type: 'fan', detector: o.detector === 'arc' ? 'arc' : 'flat', angles, nAngles: angles.length,
    nDet: o.nDet ?? 256, du: o.du ?? 4 / 256, offset: o.offset ?? 0, sod, sdd,
  };
}

export function coneGeometry(o = {}) {
  const angles = pickAngles(o, TAU);
  return {
    type: 'cone', angles, nAngles: angles.length,
    nu: o.nu ?? 128, nv: o.nv ?? 128, du: o.du ?? 4 / 128, dv: o.dv ?? 4 / 128,
    sod: o.sod ?? 4, sdd: o.sdd ?? 8, offset: 0,
  };
}

// Pick detector size and source distances so that the whole grid is in every view.
// kind: 'parallel' | 'fan' | 'fan-arc' | 'cone'. obj: Image2D, Volume, or dims.
export function fitGeometry(kind, obj, o = {}) {
  const nx = obj.nx, ny = obj.ny ?? obj.nx, width = obj.width ?? 2;
  const px = width / nx;
  const rSq = 0.5 * px * Math.hypot(nx, ny);         // radius of the grid corners
  const rObj = o.radius ?? rSq;                       // radius the detector must cover
  const nDet = o.nDet ?? (Math.ceil(Math.hypot(nx, ny)) | 1);
  if (kind === 'parallel') {
    return parallelGeometry({ ...o, nDet, du: o.du ?? (2 * rObj) / (nDet - 1) });
  }
  const sod = o.sod ?? 2 * rSq * (o.sodFactor ?? 1);
  const sdd = o.sdd ?? 2 * sod;
  const gMax = Math.asin(Math.min(0.999, rObj / sod));
  if (kind === 'fan' || kind === 'fan-flat' || kind === 'fan-arc') {
    const arc = kind === 'fan-arc' || o.detector === 'arc';
    const du = arc ? (sdd * 2 * gMax) / (nDet - 1) : (sdd * Math.tan(gMax) * 2) / (nDet - 1);
    return fanGeometry({ ...o, nDet, du, sod, sdd, detector: arc ? 'arc' : 'flat' });
  }
  if (kind === 'cone') {
    const nz = obj.nz ?? nx;
    const nu = o.nu ?? (Math.ceil(Math.hypot(nx, ny)) | 1);
    const du = (sdd * Math.tan(gMax) * 2) / (nu - 1);
    const zMax = 0.5 * px * nz;
    const vMax = (sdd * zMax) / (sod - rSq);
    const nv = o.nv ?? (Math.ceil((2 * vMax) / du) | 1);
    const dv = o.dv ?? (2 * vMax) / (nv - 1);
    return coneGeometry({ ...o, nu, nv, du, dv, sod, sdd });
  }
  throw new Error('fitGeometry: unknown kind ' + kind);
}

function withAngles(geom, angles) {
  return { ...geom, angles: Float32Array.from(angles), nAngles: angles.length };
}

export function sparseAngles(geom, keepEvery = 2) {
  const out = [];
  for (let k = 0; k < geom.nAngles; k += keepEvery) out.push(geom.angles[k]);
  return withAngles(geom, out);
}

export function limitedAngle(geom, arc) {
  const out = [];
  const a0 = geom.angles[0];
  for (let k = 0; k < geom.nAngles; k++) if (geom.angles[k] - a0 < arc - 1e-9) out.push(geom.angles[k]);
  return withAngles(geom, out);
}

export function detCoord(geom, i) {
  const n = geom.nDet ?? geom.nu;
  return (i - (n - 1) / 2) * geom.du + (geom.offset ?? 0);
}

// Ray for view a, detector element i: a point on the line (ox, oy) and a unit direction.
export function rayFor(geom, a, i, out = {}) {
  const b = geom.angles[a];
  const c = Math.cos(b), s = Math.sin(b);
  const dX = -s, dY = c, nX = c, nY = s;
  const u = detCoord(geom, i);
  if (geom.type === 'parallel') {
    out.ox = u * nX; out.oy = u * nY; out.dx = dX; out.dy = dY;
    return out;
  }
  const sx = -geom.sod * dX, sy = -geom.sod * dY;
  let rx, ry;
  if (geom.detector === 'arc') {
    const g = u / geom.sdd, cg = Math.cos(g), sg = Math.sin(g);
    rx = cg * dX + sg * nX; ry = cg * dY + sg * nY;
  } else {
    rx = geom.sdd * dX + u * nX; ry = geom.sdd * dY + u * nY;
    const l = Math.hypot(rx, ry); rx /= l; ry /= l;
  }
  out.ox = sx; out.oy = sy; out.dx = rx; out.dy = ry;
  return out;
}

// Cone ray for view a, detector column iu, row iv (flat detector, circular orbit).
export function rayFor3D(geom, a, iu, iv, out = {}) {
  const b = geom.angles[a];
  const c = Math.cos(b), s = Math.sin(b);
  const dX = -s, dY = c, nX = c, nY = s;
  const u = (iu - (geom.nu - 1) / 2) * geom.du;
  const v = (iv - (geom.nv - 1) / 2) * geom.dv;
  const rx = geom.sdd * dX + u * nX, ry = geom.sdd * dY + u * nY, rz = v;
  const l = Math.hypot(rx, ry, rz);
  out.ox = -geom.sod * dX; out.oy = -geom.sod * dY; out.oz = 0;
  out.dx = rx / l; out.dy = ry / l; out.dz = rz / l;
  return out;
}

// Quadrature weight per view (half the gap to each neighbour, ends use their one gap).
export function angleWeights(geom) {
  const n = geom.nAngles, A = geom.angles, w = new Float32Array(n);
  if (n === 1) { w[0] = Math.PI; return w; }
  const step = (A[n - 1] - A[0]) / (n - 1);
  for (let k = 0; k < n; k++) {
    const prev = k > 0 ? A[k] - A[k - 1] : step;
    const next = k < n - 1 ? A[k + 1] - A[k] : step;
    w[k] = 0.5 * (prev + next);
  }
  return w;
}

export function coverage(geom) {
  const w = angleWeights(geom);
  let s = 0; for (let k = 0; k < w.length; k++) s += w[k];
  return s;
}

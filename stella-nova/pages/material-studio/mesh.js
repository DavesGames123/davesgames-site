// ============================================================================
//  MATERIAL STUDIO  ·  mesh.js — procedural preview meshes and .obj import
// ────────────────────────────────────────────────────────────────────────────
//  Pure geometry: no DOM, no GPU. viewport.js uploads the result; glb.js can
//  export it. Every mesh comes out with per-vertex positions, normals, uvs and
//  vec4 tangents (xyz, w = bitangent sign), fitted into a sphere of radius 1
//  around the origin, with counter-clockwise front faces.
//
//  DATA FLOW
//      buildMesh(name, {subdiv}) -> generator -> orientTriangles -> computeTangents
//                                -> fitUnit -> MeshData
//      parseOBJ(text)            -> fan triangulation -> normals if missing
//                                -> uvs if missing -> computeTangents -> fitUnit
//
//  CONVENTIONS  (match contract.js)
//      uv origin top-left, +v goes down the image. The mesh maps the image
//      upright: v = 0 is the top of a sphere, the far edge of the plane.
//      Tangent T points along +u. The bitangent B = cross(N, T) * w points to
//      image-up (-v), so a +Y (OpenGL) normal map shades correctly. This is
//      the glTF convention, and glb.js can write TANGENT as is.
//
//  TANGENTS
//      computeTangents follows the MikkTSpace recipe: per-face tangent and
//      bitangent are normalized, weighted by the corner angle, summed per
//      vertex, then Gram-Schmidt against the normal. The sign w comes from the
//      summed bitangent. Degenerate faces add nothing; a vertex with no valid
//      face gets any vector at a right angle to its normal.
//
//  CONTENTS  (grep -n the name to jump)
//      MESH_LABELS ........ display names for contract MESHES (+ 'custom')
//      buildMesh .......... the generator switch
//      lathe .............. surface of revolution from a 2D profile (sphere,
//                           cylinder, torus, shader ball parts)
//      sphereProfile / cylinderProfile / torusProfile / shaderBallParts
//      gridPlane .......... subdivided plane in XZ
//      boxMesh ............ subdivided cube, optional rounded edges
//      merge .............. join MeshData parts
//      orientTriangles .... flip faces whose winding opposes the normals
//      computeTangents .... MikkTSpace-style tangents
//      fitUnit ............ center and scale into the unit sphere
//      parseOBJ ........... Wavefront .obj text -> MeshData
//      edgeIndices ........ unique edges as a line list (wireframe)
//      meshStats .......... vertex / triangle counts and bounds
// ============================================================================

/**
 * @typedef {{positions:Float32Array, normals:Float32Array, uvs:Float32Array,
 *            tangents:Float32Array, indices:Uint32Array, name?:string,
 *            bounds?:{min:number[], max:number[], radius:number}}} MeshData
 *   tangents are vec4 (xyz, w = bitangent sign)
 */

export const MESH_LABELS = Object.freeze({
  sphere: 'Sphere', cube: 'Cube', roundedCube: 'Rounded Cube', plane: 'Plane',
  cylinder: 'Cylinder', torus: 'Torus', shaderBall: 'Shader Ball', custom: 'Custom (.obj)',
});

const TAU = Math.PI * 2;
const clampI = (v, a, b) => Math.max(a, Math.min(b, v | 0));

/**
 * Build one preview mesh.
 * @param {string} name one of contract MESHES
 * @param {{subdiv?:number}} [opts] subdiv: segments around a sphere (16..512)
 * @returns {MeshData}
 */
export function buildMesh(name, opts = {}) {
  const sub = clampI(opts.subdiv || 128, 8, 512);
  let m;
  switch (name) {
    case 'sphere': m = lathe(sphereProfile(1, Math.max(8, sub >> 1)), sub); break;
    case 'cube': m = boxMesh(Math.max(1, sub >> 3), 0); break;
    case 'roundedCube': m = boxMesh(Math.max(6, sub >> 2), 0.18); break;
    case 'plane': m = gridPlane(Math.max(1, sub >> 1)); break;
    case 'cylinder': m = lathe(cylinderProfile(0.7, 1.0, Math.max(4, sub >> 3)), sub); break;
    case 'torus': m = lathe(torusProfile(0.68, 0.3, Math.max(12, sub >> 1)), sub, { closed: true }); break;
    case 'shaderBall': m = merge(shaderBallParts(sub)); break;
    default: throw new Error(`buildMesh: unknown mesh "${name}"`);
  }
  orientTriangles(m);
  computeTangents(m);
  fitUnit(m, name === 'plane' ? 0 : 1);
  m.name = name;
  return m;
}

// ------------------------------------------------------------ lathe
/**
 * A profile ring: r radius, y height, nr/ny the outward normal in the r-y
 * plane, s arc length. A crease point appears twice (one ring per side).
 * The profile runs top to bottom, so v = 0 is the top of the shape.
 * @typedef {{r:number, y:number, nr:number, ny:number, s:number, gap?:boolean}} Ring
 */

/** Turn a polyline {r,y,crease?}[] into rings with smooth or split normals.
 *  Each point may carry `crease:true`; the first and last are open ends. */
function ringsFromPolyline(pts, { closed = false } = {}) {
  const n = pts.length;
  const seg = [];
  for (let i = 0; i < n - 1 + (closed ? 1 : 0); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dr = b.r - a.r, dy = b.y - a.y, L = Math.hypot(dr, dy) || 1;
    // profile goes top -> bottom: outward normal = (-dy, dr)
    seg.push({ nr: -dy / L, ny: dr / L, len: Math.hypot(dr, dy) });
  }
  const rings = [];
  let s = 0;
  const count = closed ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const p = pts[i];
    const segIn = k > 0 ? seg[k - 1] : (closed ? seg[seg.length - 1] : null);
    const segOut = k < seg.length ? seg[k] : (closed ? seg[0] : null);
    if (k > 0) s += seg[k - 1].len;
    if (p.crease && segIn && segOut) {
      rings.push({ r: p.r, y: p.y, nr: segIn.nr, ny: segIn.ny, s });
      rings.push({ r: p.r, y: p.y, nr: segOut.nr, ny: segOut.ny, s, gap: true });
    } else {
      let nr = 0, ny = 0;
      if (segIn) { nr += segIn.nr; ny += segIn.ny; }
      if (segOut) { nr += segOut.nr; ny += segOut.ny; }
      const L = Math.hypot(nr, ny) || 1;
      rings.push({ r: p.r, y: p.y, nr: nr / L, ny: ny / L, s });
    }
  }
  return rings;
}

/**
 * Surface of revolution around +Y. u = angle (seam at -Z, u = 0.5 faces +Z),
 * v = arc length / total. u repeats so texels stay near square.
 * @param {{rings:Ring[], uRepeat?:number, vRange?:[number,number]}|Ring[]} prof
 * @param {number} segs segments around
 */
export function lathe(prof, segs, opts = {}) {
  const rings = Array.isArray(prof) ? prof : prof.rings;
  const total = rings[rings.length - 1].s || 1;
  let maxR = 0; for (const r of rings) maxR = Math.max(maxR, r.r);
  const uRep = prof.uRepeat || Math.max(1, Math.round((TAU * maxR) / total));
  const [v0, v1] = prof.vRange || [0, 1];
  const cols = segs + 1, R = rings.length;
  const pos = new Float32Array(R * cols * 3), nor = new Float32Array(R * cols * 3), uv = new Float32Array(R * cols * 2);
  for (let j = 0; j < R; j++) {
    const g = rings[j];
    for (let i = 0; i < cols; i++) {
      const u = i / segs, th = TAU * u - Math.PI;
      const sx = Math.sin(th), cz = Math.cos(th);
      const k = j * cols + i;
      pos[k * 3] = g.r * sx; pos[k * 3 + 1] = g.y; pos[k * 3 + 2] = g.r * cz;
      nor[k * 3] = g.nr * sx; nor[k * 3 + 1] = g.ny; nor[k * 3 + 2] = g.nr * cz;
      uv[k * 2] = u * uRep; uv[k * 2 + 1] = v0 + (v1 - v0) * (g.s / total);
    }
  }
  const idx = [];
  for (let j = 0; j < R - 1; j++) {
    if (rings[j + 1].gap) continue; // crease: the duplicated ring starts a new strip
    for (let i = 0; i < segs; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { positions: pos, normals: nor, uvs: uv, tangents: new Float32Array(R * cols * 4), indices: new Uint32Array(idx) };
}

/** Half circle from the north pole to the south pole. */
export function sphereProfile(radius, steps, cy = 0, opts = {}) {
  const pts = [];
  const a0 = opts.from ?? 0, a1 = opts.to ?? Math.PI;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push({ r: Math.abs(radius * Math.sin(a)) < 1e-7 ? 0 : radius * Math.sin(a), y: cy + radius * Math.cos(a) });
  }
  return { rings: ringsFromPolyline(pts), uRepeat: opts.uRepeat || 2 };
}

/** Closed cylinder: top cap, side, bottom cap, with a small bevel. */
export function cylinderProfile(radius, halfH, steps) {
  const b = 0.04, pts = [];
  pts.push({ r: 0, y: halfH });
  pts.push({ r: radius - b, y: halfH, crease: true });
  for (let i = 1; i < 4; i++) { const a = (i / 4) * Math.PI / 2; pts.push({ r: radius - b + b * Math.sin(a), y: halfH - b + b * Math.cos(a) }); }
  pts.push({ r: radius, y: halfH - b, crease: true });
  for (let i = 1; i < steps; i++) pts.push({ r: radius, y: halfH - b - (2 * (halfH - b)) * (i / steps) });
  pts.push({ r: radius, y: -halfH + b, crease: true });
  for (let i = 1; i < 4; i++) { const a = (i / 4) * Math.PI / 2; pts.push({ r: radius - b + b * Math.cos(a), y: -halfH + b - b * Math.sin(a) }); }
  pts.push({ r: radius - b, y: -halfH, crease: true });
  pts.push({ r: 0, y: -halfH });
  return { rings: ringsFromPolyline(pts) };
}

/** Torus tube: a closed circle profile. The seam of the tube is inside. */
export function torusProfile(R, r, steps) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU; // a = 0 at the top of the tube, then outward
    pts.push({ r: R + r * Math.sin(a), y: r * Math.cos(a) });
  }
  // ringsFromPolyline with closed=true repeats the first point at the end
  const rings = ringsFromPolyline(pts, { closed: true });
  return { rings, uRepeat: Math.max(1, Math.round(R / r)) };
}

/**
 * Original "shader ball": a sphere with a recessed band around its middle,
 * on a short neck and a low turned base. One view shows convex, concave,
 * grazing, overhang and flat areas. Two lathe parts with their own v ranges.
 * Profile units: sphere radius 0.62 at the origin, base floor at y = -1.
 */
export function shaderBallParts(segs) {
  const parts = [];
  const Rb = 0.62, inset = 0.05, steps = Math.max(24, segs >> 1);
  const deg = d => (d / 180) * Math.PI;
  const aIn0 = deg(80), aIn1 = deg(100), aEnd = deg(156);
  const ball = [];
  const arc = (a0, a1, n, r, first, last) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      ball.push({ r: r * Math.sin(a), y: r * Math.cos(a), crease: (i === 0 && first) || (i === n && last) });
    }
  };
  // upper cap down to the band, step in, the recessed band, step out
  arc(0, aIn0, Math.round(steps * (aIn0 / Math.PI)), Rb, false, true);
  ball.push({ r: (Rb - inset) * Math.sin(aIn0), y: Rb * Math.cos(aIn0), crease: true });
  const nb = Math.max(4, Math.round(steps * ((aIn1 - aIn0) / Math.PI)));
  for (let i = 1; i < nb; i++) { const a = aIn0 + (aIn1 - aIn0) * (i / nb); ball.push({ r: (Rb - inset) * Math.sin(a), y: Rb * Math.cos(a) }); }
  ball.push({ r: (Rb - inset) * Math.sin(aIn1), y: Rb * Math.cos(aIn1), crease: true });
  // lower half of the sphere, then the neck
  arc(aIn1, aEnd, Math.round(steps * ((aEnd - aIn1) / Math.PI)), Rb, true, true);
  const yEnd = Rb * Math.cos(aEnd);
  ball.push({ r: 0.15, y: yEnd - 0.05, crease: true });
  ball.push({ r: 0.15, y: -0.8, crease: true });
  for (let i = 1; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); ball.push({ r: 0.15 + 0.1 * (1 - Math.cos(a)), y: -0.8 - 0.06 * Math.sin(a) }); }
  ball[ball.length - 1].crease = false;
  ball.push({ r: 0.25, y: -0.86 });
  parts.push(lathe({ rings: ringsFromPolyline(ball), uRepeat: 3, vRange: [0, 0.82] }, segs));

  // base: top face, bevel, side wall, bevel, floor
  const base = [
    { r: 0.25, y: -0.86 }, { r: 0.5, y: -0.86, crease: true },
    { r: 0.54, y: -0.885 }, { r: 0.55, y: -0.91, crease: true },
    { r: 0.55, y: -0.975, crease: true }, { r: 0.53, y: -1.0, crease: true },
    { r: 0.0, y: -1.0 },
  ];
  parts.push(lathe({ rings: ringsFromPolyline(base), uRepeat: 3, vRange: [0.82, 1] }, segs));
  return parts;
}

// ------------------------------------------------------------ plane / box
/** Subdivided plane in XZ facing +Y, 2 x 2 units. u along +X, v along +Z. */
export function gridPlane(n) {
  const c = n + 1, pos = new Float32Array(c * c * 3), nor = new Float32Array(c * c * 3), uv = new Float32Array(c * c * 2);
  for (let j = 0; j < c; j++) for (let i = 0; i < c; i++) {
    const k = j * c + i, u = i / n, v = j / n;
    pos[k * 3] = u * 2 - 1; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = v * 2 - 1;
    nor[k * 3 + 1] = 1;
    uv[k * 2] = u; uv[k * 2 + 1] = v;
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * c + i, b = a + 1, d = a + c, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  return { positions: pos, normals: nor, uvs: uv, tangents: new Float32Array(c * c * 4), indices: new Uint32Array(idx) };
}

// Each face: normal axis, and the axes that u and v (image-down) follow.
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
];

/**
 * Cube of half size 1. radius > 0 rounds the edges: each grid point is
 * pulled onto a rounded box (clamp to the inner box, then push out by
 * radius along the offset). The grid is denser near the edges.
 */
export function boxMesh(n, radius) {
  const c = n + 1, per = c * c;
  const pos = new Float32Array(6 * per * 3), nor = new Float32Array(6 * per * 3), uv = new Float32Array(6 * per * 2);
  const idx = [];
  const inner = 1 - radius;
  // edge-dense spacing for the rounded box
  // cosine easing has zero slope at 0 and 1, so samples gather at the edges
  const warp = t => radius > 0 ? t * 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * t)) : t;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f], base = f * per;
    for (let j = 0; j < c; j++) for (let i = 0; i < c; i++) {
      const s = warp(i / n), t = warp(j / n);
      const a = s * 2 - 1, b = t * 2 - 1;
      const p = [0, 1, 2].map(k => F.n[k] + F.u[k] * a + F.v[k] * b);
      const k = base + j * c + i;
      let q = p, nn = F.n;
      if (radius > 0) {
        const cl = p.map(x => Math.max(-inner, Math.min(inner, x)));
        const d = [p[0] - cl[0], p[1] - cl[1], p[2] - cl[2]];
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        nn = d.map(x => x / L);
        q = cl.map((x, m) => x + nn[m] * radius);
      }
      pos.set(q, k * 3); nor.set(nn, k * 3);
      uv[k * 2] = s; uv[k * 2 + 1] = t;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const A = base + j * c + i, B = A + 1, D = A + c, E = D + 1;
      idx.push(A, D, B, B, D, E);
    }
  }
  return { positions: pos, normals: nor, uvs: uv, tangents: new Float32Array(6 * per * 4), indices: new Uint32Array(idx) };
}

// ------------------------------------------------------------ utilities
/** Join MeshData parts into one (tangents are recomputed later). */
export function merge(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.positions.length / 3; ni += p.indices.length; }
  const out = { positions: new Float32Array(nv * 3), normals: new Float32Array(nv * 3), uvs: new Float32Array(nv * 2), tangents: new Float32Array(nv * 4), indices: new Uint32Array(ni) };
  let ov = 0, oi = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    out.positions.set(p.positions, ov * 3); out.normals.set(p.normals, ov * 3); out.uvs.set(p.uvs, ov * 2);
    for (let i = 0; i < p.indices.length; i++) out.indices[oi + i] = p.indices[i] + ov;
    ov += n; oi += p.indices.length;
  }
  return out;
}

/** Flip each triangle whose face normal points against its vertex normals.
 *  Degenerate triangles are left alone. Returns the number of flips. */
export function orientTriangles(m) {
  const P = m.positions, N = m.normals, I = m.indices;
  let flips = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
    const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) < 1e-14) continue;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { I[t + 1] = c; I[t + 2] = b; flips++; }
  }
  return flips;
}

/**
 * MikkTSpace-style per-vertex tangents. v is flipped to "image up" so the
 * bitangent points to -v (see CONVENTIONS in the header). Writes m.tangents.
 * @param {MeshData} m
 */
export function computeTangents(m) {
  const P = m.positions, N = m.normals, U = m.uvs, I = m.indices;
  const nv = P.length / 3;
  const ts = new Float64Array(nv * 3), bs = new Float64Array(nv * 3);
  const v3 = (A, i) => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];
  for (let t = 0; t < I.length; t += 3) {
    const ids = [I[t], I[t + 1], I[t + 2]];
    const p = ids.map(i => v3(P, i));
    const w = ids.map(i => [U[i * 2], -U[i * 2 + 1]]); // v up
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const du1 = w[1][0] - w[0][0], dv1 = w[1][1] - w[0][1], du2 = w[2][0] - w[0][0], dv2 = w[2][1] - w[0][1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-14) continue;
    const r = 1 / det;
    let sd = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
    let td = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
    const sl = Math.hypot(...sd), tl = Math.hypot(...td);
    if (!(sl > 1e-20) || !(tl > 1e-20) || !isFinite(sl) || !isFinite(tl)) continue;
    sd = sd.map(x => x / sl); td = td.map(x => x / tl);
    for (let k = 0; k < 3; k++) {
      const a = p[k], b = p[(k + 1) % 3], c = p[(k + 2) % 3];
      const x1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], x2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const l1 = Math.hypot(...x1), l2 = Math.hypot(...x2);
      if (l1 < 1e-20 || l2 < 1e-20) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (x1[0] * x2[0] + x1[1] * x2[1] + x1[2] * x2[2]) / (l1 * l2))));
      const i = ids[k];
      ts[i * 3] += sd[0] * ang; ts[i * 3 + 1] += sd[1] * ang; ts[i * 3 + 2] += sd[2] * ang;
      bs[i * 3] += td[0] * ang; bs[i * 3 + 1] += td[1] * ang; bs[i * 3 + 2] += td[2] * ang;
    }
  }
  const T = m.tangents && m.tangents.length === nv * 4 ? m.tangents : (m.tangents = new Float32Array(nv * 4));
  for (let i = 0; i < nv; i++) {
    const n = v3(N, i);
    let t = [ts[i * 3], ts[i * 3 + 1], ts[i * 3 + 2]];
    const d = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
    t = [t[0] - n[0] * d, t[1] - n[1] * d, t[2] - n[2] * d];
    let L = Math.hypot(...t);
    if (!(L > 1e-8)) {
      // no valid face: any vector at a right angle to n
      t = Math.abs(n[1]) < 0.99 ? [n[2], 0, -n[0]] : [1, 0, 0];
      const dd = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
      t = [t[0] - n[0] * dd, t[1] - n[1] * dd, t[2] - n[2] * dd];
      L = Math.hypot(...t) || 1;
    }
    t = t.map(x => x / L);
    const cx = n[1] * t[2] - n[2] * t[1], cy = n[2] * t[0] - n[0] * t[2], cz = n[0] * t[1] - n[1] * t[0];
    const s = cx * bs[i * 3] + cy * bs[i * 3 + 1] + cz * bs[i * 3 + 2] < 0 ? -1 : 1;
    T[i * 4] = t[0]; T[i * 4 + 1] = t[1]; T[i * 4 + 2] = t[2]; T[i * 4 + 3] = s;
  }
  return m;
}

/** Center the bounding box on the origin and scale to radius `target`
 *  (0 keeps the scale). Writes m.bounds after the change. */
export function fitUnit(m, target = 1) {
  const P = m.positions, nv = P.length / 3;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);
  let r = 0;
  for (let i = 0; i < nv; i++) r = Math.max(r, Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]));
  const s = target > 0 && r > 0 ? target / r : 1;
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) P[i * 3 + k] = (P[i * 3 + k] - c[k]) * s;
  m.bounds = { min: mn.map((v, k) => (v - c[k]) * s), max: mx.map((v, k) => (v - c[k]) * s), radius: r * s };
  return m;
}

/**
 * Parse Wavefront .obj text. Faces with more than 3 corners become fans.
 * Negative indices work. Missing normals are made from area-weighted face
 * normals (welded by position). Missing uvs come from a box projection.
 * obj v points up, so v becomes 1 - v.
 * @param {string} text
 * @returns {MeshData}
 */
export function parseOBJ(text) {
  const vp = [], vt = [], vn = [];
  const key = new Map();
  const pos = [], uv = [], nor = [], idx = [], posIndex = [];
  let hasN = true, hasT = true;
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    while (line.endsWith('\\') && li + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++li];
    const p = line.trim().split(/\s+/);
    switch (p[0]) {
      case 'v': vp.push([+p[1], +p[2], +p[3]]); break;
      case 'vt': vt.push([+p[1], +(p[2] ?? 0)]); break;
      case 'vn': vn.push([+p[1], +p[2], +p[3]]); break;
      case 'f': {
        const corners = [];
        for (let k = 1; k < p.length; k++) {
          if (!p[k]) continue;
          const [a, b, c] = p[k].split('/');
          const ia = res(+a, vp.length), ib = b ? res(+b, vt.length) : -1, ic = c ? res(+c, vn.length) : -1;
          if (ib < 0) hasT = false;
          if (ic < 0) hasN = false;
          const k2 = ia + '/' + ib + '/' + ic;
          let id = key.get(k2);
          if (id === undefined) {
            id = pos.length / 3; key.set(k2, id);
            const P = vp[ia] || [0, 0, 0]; pos.push(P[0], P[1], P[2]); posIndex.push(ia);
            const T = vt[ib] || [0, 0]; uv.push(T[0], 1 - T[1]);
            const Nn = vn[ic] || [0, 0, 0]; nor.push(Nn[0], Nn[1], Nn[2]);
          }
          corners.push(id);
        }
        for (let k = 1; k + 1 < corners.length; k++) idx.push(corners[0], corners[k], corners[k + 1]);
        break;
      }
      default: break;
    }
  }
  if (!idx.length) throw new Error('parseOBJ: no faces');
  const m = { positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv), tangents: null, indices: new Uint32Array(idx) };
  if (!hasN) smoothNormals(m, posIndex);
  if (!hasT) boxUVs(m);
  computeTangents(m);
  fitUnit(m, 1);
  m.name = 'custom';
  return m;

  function res(i, n) { return i < 0 ? n + i : i - 1; }
}

/** Area-weighted smooth normals, welded by the source position index. */
function smoothNormals(m, posIndex) {
  const P = m.positions, I = m.indices, nv = P.length / 3;
  const acc = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1 = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) {
      const k = posIndex[v];
      const s = acc.get(k) || [0, 0, 0];
      s[0] += f[0]; s[1] += f[1]; s[2] += f[2]; acc.set(k, s);
    }
  }
  for (let i = 0; i < nv; i++) {
    const s = acc.get(posIndex[i]) || [0, 1, 0], L = Math.hypot(...s) || 1;
    m.normals[i * 3] = s[0] / L; m.normals[i * 3 + 1] = s[1] / L; m.normals[i * 3 + 2] = s[2] / L;
  }
}

/** Box projection uvs from the dominant normal axis. */
function boxUVs(m) {
  const P = m.positions, N = m.normals, nv = P.length / 3;
  for (let i = 0; i < nv; i++) {
    const ax = Math.abs(N[i * 3]), ay = Math.abs(N[i * 3 + 1]), az = Math.abs(N[i * 3 + 2]);
    let u, v;
    if (ax >= ay && ax >= az) { u = P[i * 3 + 2] * Math.sign(-N[i * 3] || 1); v = -P[i * 3 + 1]; }
    else if (ay >= az) { u = P[i * 3]; v = P[i * 3 + 2] * Math.sign(N[i * 3 + 1] || 1); }
    else { u = P[i * 3] * Math.sign(N[i * 3 + 2] || 1); v = -P[i * 3 + 1]; }
    m.uvs[i * 2] = u * 0.5 + 0.5; m.uvs[i * 2 + 1] = v * 0.5 + 0.5;
  }
}

/** Unique triangle edges as a line list, for the wireframe overlay. */
export function edgeIndices(m) {
  const I = m.indices, seen = new Set(), out = [];
  const nv = m.positions.length / 3;
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    let a = I[t + k], b = I[t + (k + 1) % 3];
    if (a === b) continue;
    if (a > b) [a, b] = [b, a];
    const key = a * nv + b;
    if (seen.has(key)) continue;
    seen.add(key); out.push(a, b);
  }
  return new Uint32Array(out);
}

/** @param {MeshData} m @returns {{vertices:number, triangles:number, bounds:any}} */
export function meshStats(m) {
  return { vertices: m.positions.length / 3, triangles: m.indices.length / 3, bounds: m.bounds };
}

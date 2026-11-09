// ============================================================================
//  CORRUPTION  ·  models.js — the stage models, the particle polyhedra and
//  the surface sampler (no DOM, no GPU: node and Deno import it)
// ----------------------------------------------------------------------------
//  A stage model is either an SDF (drawn by the ray march in the shader, id
//  sdf = the branch of fn sdModel) or a triangle mesh (drawn by the raster
//  pass). The corruption shader is the same for both: fn corruptField and
//  fn shadeCorrupt only read a world point and a normal.
//
//  Model units: the floor is y = 0, the model stands on it, about 2 m tall.
//  A mesh is { positions, normals, indices } (Float32Array xyz, Uint32Array).
//
//  GREP MAP
//    grep -n 'export const MODELS'          the model list (label, kind, bound)
//    grep -n 'export function torusKnot'    mesh: a (2,3) torus knot tube
//    grep -n 'export function hullPod'      mesh: a lathed hull module
//    grep -n 'export function bench'        mesh: a deck bench of subdivided boxes
//    grep -n 'export function fitMesh'      centre on the floor, scale to height
//    grep -n 'export function meshFromGLB'  a parseGLB scene -> one mesh
//    grep -n 'export function sampleSurface' area-weighted points + normals
//    grep -n 'export function polyhedra'    tetra, cube, octa, icosa (flat)
// ============================================================================

export const MODELS = [
  { id: 'trooper', label: 'Trooper', kind: 'sdf', sdf: 0, bound: { c: [0, 1.0, 0], r: 1.05 } },
  { id: 'reactor', label: 'Reactor', kind: 'sdf', sdf: 1, bound: { c: [0, 1.05, 0], r: 1.2 } },
  { id: 'crates', label: 'Crates', kind: 'sdf', sdf: 2, bound: { c: [0, 0.75, 0], r: 1.25 } },
  { id: 'relic', label: 'Gyroid relic', kind: 'sdf', sdf: 3, bound: { c: [0, 1.1, 0], r: 0.95 } },
  { id: 'knot', label: 'Torus knot', kind: 'mesh', mat: [0.62, 0.64, 0.68, 0.85], mat2: [0.28, 1, 0, 0] },
  { id: 'pod', label: 'Hull pod', kind: 'mesh', mat: [0.5, 0.52, 0.55, 0.6], mat2: [0.35, 1, 0, 0] },
  { id: 'bench', label: 'Bench', kind: 'mesh', mat: [0.7, 0.71, 0.72, 0.9], mat2: [0.3, 0, 0, 0] },
  { id: 'custom', label: 'Your model', kind: 'mesh', custom: true, mat: [0.6, 0.6, 0.62, 0.3], mat2: [0.45, 0, 0, 0] },
];
export const MODEL = Object.fromEntries(MODELS.map(m => [m.id, m]));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// a tube of nu x nv quads round a closed curve c(t), t in 0..1
function tube(curve, radius, nu, nv) {
  const P = [], N = [], I = [];
  let prevB = null;
  const frames = [];
  for (let i = 0; i < nu; i++) {
    const t = i / nu, e = 1e-4;
    const p = curve(t), T = norm(sub(curve(t + e), curve(t - e)));
    // parallel transport of the normal (no Frenet flips at inflections)
    let B = prevB ? norm(cross(T, cross(prevB, T))) : norm(cross(T, [0, 1, 0.3]));
    prevB = B;
    frames.push([p, T, B]);
  }
  for (let i = 0; i < nu; i++) {
    const [p, T, B] = frames[i], Nn = cross(B, T);
    for (let j = 0; j < nv; j++) {
      const a = (j / nv) * Math.PI * 2;
      const n = [Math.cos(a) * Nn[0] + Math.sin(a) * B[0], Math.cos(a) * Nn[1] + Math.sin(a) * B[1], Math.cos(a) * Nn[2] + Math.sin(a) * B[2]];
      P.push(p[0] + n[0] * radius, p[1] + n[1] * radius, p[2] + n[2] * radius);
      N.push(...n);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * nv + j, b = ((i + 1) % nu) * nv + j, c = ((i + 1) % nu) * nv + (j + 1) % nv, d = i * nv + (j + 1) % nv;
    I.push(a, b, c, a, c, d);
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I) };
}

export function torusKnot(p = 2, q = 3, nu = 520, nv = 36) {
  const R = 0.62, r = 0.26;
  const curve = t => {
    const a = t * Math.PI * 2, rr = R + r * Math.cos(q * a);
    return [rr * Math.cos(p * a), 1.12 + r * Math.sin(q * a) * 1.6, rr * Math.sin(p * a)];
  };
  return tube(curve, 0.16, nu, nv);
}

// a lathe: profile [[r, y], ...] turned round the y axis in nr steps
function lathe(profile, nr) {
  const P = [], N = [], I = [], m = profile.length;
  for (let i = 0; i < m; i++) {
    const [r, y] = profile[i];
    const a0 = profile[Math.max(0, i - 1)], a1 = profile[Math.min(m - 1, i + 1)];
    const dr = a1[0] - a0[0], dy = a1[1] - a0[1];
    const ln = Math.hypot(dr, dy) || 1, nr2 = dy / ln, ny = -dr / ln;
    for (let j = 0; j <= nr; j++) {
      const a = (j / nr) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      P.push(r * c, y, r * s); N.push(nr2 * c, ny, nr2 * s);
    }
  }
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < nr; j++) {
    const a = i * (nr + 1) + j, b = a + nr + 1;
    I.push(a, b, b + 1, a, b + 1, a + 1);
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I) };
}

export function hullPod() {
  const prof = [];
  const n = 200;
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = 0.02 + t * 2.0;
    // a capsule body, two raised ring bands and a docking collar at the top
    const body = 0.55 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.5) / 0.5, 6)));
    const ring = (c, w) => 0.05 * Math.exp(-Math.pow((t - c) / w, 8));
    const collar = t > 0.9 ? 0.22 - 0.0 : 0;
    prof.push([Math.max(0.001, Math.max(body + ring(0.3, 0.035) + ring(0.62, 0.035), collar * (t < 0.995 ? 1 : 0.2))), y]);
  }
  prof[0][0] = 0.001; prof[n][0] = 0.001;
  return lathe(prof, 96);
}

// one axis-aligned box, centre c, half size h, each face cut to cells of
// about `cell` metres so the vertex shader has points to snap and push
function box(c, h, cell, out) {
  const faces = [[0, 1, 2], [0, -1, 2], [1, 1, 0], [1, -1, 0], [2, 1, 1], [2, -1, 1]];
  for (const [ax, sg, ui] of faces) {
    const vi = 3 - ax - ui;
    const nu = Math.max(1, Math.round((2 * h[ui]) / cell)), nv = Math.max(1, Math.round((2 * h[vi]) / cell));
    const base = out.P.length / 3;
    for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) {
      const p = [0, 0, 0];
      p[ax] = c[ax] + sg * h[ax];
      p[ui] = c[ui] - h[ui] + (2 * h[ui] * a) / nu;
      p[vi] = c[vi] - h[vi] + (2 * h[vi] * b) / nv;
      out.P.push(...p);
      const n = [0, 0, 0]; n[ax] = sg; out.N.push(...n);
    }
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
      const i0 = base + a * (nv + 1) + b, i1 = i0 + nv + 1;
      // wind so the face points along +n (cross of the u and v edges)
      const flip = (sg > 0) !== (((ax + 1) % 3) === ui);
      if (flip) out.I.push(i0, i1, i1 + 1, i0, i1 + 1, i0 + 1);
      else out.I.push(i0, i1 + 1, i1, i0, i0 + 1, i1 + 1);
    }
  }
}

export function bench() {
  const o = { P: [], N: [], I: [] }, cell = 0.05;
  box([0, 0.46, 0], [0.85, 0.035, 0.24], cell, o);           // seat
  box([0, 0.86, -0.22], [0.85, 0.16, 0.025], cell, o);       // back rest
  for (const x of [-0.72, 0.72]) {
    box([x, 0.22, 0.12], [0.035, 0.22, 0.035], cell, o);     // legs
    box([x, 0.22, -0.12], [0.035, 0.22, 0.035], cell, o);
    box([x, 0.66, -0.22], [0.03, 0.2, 0.02], cell, o);       // back posts
    box([x, 0.04, 0], [0.05, 0.04, 0.22], cell, o);          // feet
  }
  box([0, 0.15, 0], [0.7, 0.02, 0.14], cell, o);             // shelf
  return { positions: new Float32Array(o.P), normals: new Float32Array(o.N), indices: new Uint32Array(o.I) };
}

export function bounds(positions) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], positions[i + k]); mx[k] = Math.max(mx[k], positions[i + k]);
  }
  return { min: mn, max: mx };
}

// centre on x and z, stand on y = 0, scale the larger of height and width to
// `size`. Returns the mesh (new arrays) and its bounding sphere.
export function fitMesh(mesh, size = 2.0) {
  const b = bounds(mesh.positions);
  const ext = Math.max(b.max[1] - b.min[1], b.max[0] - b.min[0], b.max[2] - b.min[2]) || 1;
  const s = size / ext, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const P = new Float32Array(mesh.positions.length);
  let r = 0;
  const h = (b.max[1] - b.min[1]) * s, cy = h / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (mesh.positions[i] - cx) * s;
    P[i + 1] = (mesh.positions[i + 1] - b.min[1]) * s;
    P[i + 2] = (mesh.positions[i + 2] - cz) * s;
    r = Math.max(r, Math.hypot(P[i], P[i + 1] - cy, P[i + 2]));
  }
  return { mesh: { positions: P, normals: mesh.normals, indices: mesh.indices }, bound: { c: [0, cy, 0], r } };
}

// smooth vertex normals from the triangles (for a GLB without normals)
export function vertexNormals(positions, indices) {
  const N = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const pa = [positions[a], positions[a + 1], positions[a + 2]];
    const n = cross(sub([positions[b], positions[b + 1], positions[b + 2]], pa), sub([positions[c], positions[c + 1], positions[c + 2]], pa));
    for (const v of [a, b, c]) { N[v] += n[0]; N[v + 1] += n[1]; N[v + 2] += n[2]; }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}

// a parseGLB scene (lib/glb-lite.js, baked) -> one mesh
export function meshFromGLB(scene) {
  let nv = 0, ni = 0;
  for (const m of scene.meshes) { nv += m.vertexCount; ni += m.indices.length; }
  if (!nv || !ni) throw new Error('the file has no triangles');
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of scene.meshes) {
    P.set(m.positions.subarray(0, m.vertexCount * 3), vo * 3);
    const n = m.normals || vertexNormals(m.positions, m.indices);
    N.set(n.subarray(0, m.vertexCount * 3), vo * 3);
    for (let i = 0; i < m.indices.length; i++) I[io + i] = m.indices[i] + vo;
    vo += m.vertexCount; io += m.indices.length;
  }
  return { positions: P, normals: N, indices: I };
}

// n area-weighted points on the triangles: Float32Array of n x 8
// (x, y, z, 1, nx, ny, nz, 0), the layout of the shader's samples buffer
export function sampleSurface(mesh, n, rand) {
  const { positions: P, normals: Nn, indices: I } = mesh;
  const tris = I.length / 3, cdf = new Float64Array(tris);
  let acc = 0;
  for (let t = 0; t < tris; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const cr = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    acc += Math.hypot(cr[0], cr[1], cr[2]) / 2;
    cdf[t] = acc;
  }
  const out = new Float32Array(n * 8);
  for (let s = 0; s < n; s++) {
    const x = rand() * acc;
    let lo = 0, hi = tris - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid + 1; else hi = mid; }
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v, id = [I[lo * 3] * 3, I[lo * 3 + 1] * 3, I[lo * 3 + 2] * 3];
    const nn = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out[s * 8 + k] = P[id[0] + k] * w + P[id[1] + k] * u + P[id[2] + k] * v;
      nn[k] = Nn[id[0] + k] * w + Nn[id[1] + k] * u + Nn[id[2] + k] * v;
    }
    const nl = norm(nn);
    out[s * 8 + 3] = 1; out[s * 8 + 4] = nl[0]; out[s * 8 + 5] = nl[1]; out[s * 8 + 6] = nl[2];
  }
  return out;
}

// the particle shapes, unit size, flat faces: Float32Array of xyz nxnynz per
// vertex (non-indexed), and the first vertex and count of each shape
export function polyhedra() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const shapes = {
    tetra: { v: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], f: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]] },
    cube: { v: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
            f: [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]] },
    octa: { v: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
            f: [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]] },
    icosa: { v: [[-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi], [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]],
             f: [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]] },
  };
  const data = [], ranges = [];
  for (const [name, s] of Object.entries(shapes)) {
    const vs = s.v.map(norm);
    const first = data.length / 6;
    for (const f of s.f) {
      let [a, b, c] = f.map(i => vs[i]);
      let n = norm(cross(sub(b, a), sub(c, a)));
      const mid = norm([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]);
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) { [b, c] = [c, b]; n = n.map(x => -x); }
      for (const p of [a, b, c]) data.push(...p, ...n);
    }
    ranges.push({ name, first, count: data.length / 6 - first });
  }
  return { data: new Float32Array(data), ranges };
}

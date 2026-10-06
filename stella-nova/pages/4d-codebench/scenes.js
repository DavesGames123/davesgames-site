// ============================================================================
//  SCENES  ·  four reference scenes with ground truth (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Each scene is a small 4D world in the format of world.js. Our own
//  deterministic simulators make the motion, at 30 frames per second, with
//  fixed topology. There is one scene for each matter family of the paper:
//
//    rigid ........ impulse solver for boxes and spheres. A ball rolls down
//                   a ramp into a row of dominoes. Gravity, ground contact,
//                   Coulomb friction, restitution and rolling resistance.
//    deformable ... XPBD on a tetrahedral lattice (edge and volume
//                   constraints). A jelly cube lands on the edge of a block,
//                   squashes and tips off. We output the surface mesh.
//    codim ........ XPBD cloth (stretch, shear and bend constraints). A sheet
//                   falls on a ball and drapes onto the floor.
//    flowing ...... position based fluid (density constraints, XSPH
//                   viscosity). A water column collapses in a tank.
//
//  All code here is original. It does not copy the 4DCodeBench code, which
//  has no licence. make() keeps all state local, so each call gives the
//  same output. No Math.random: a seeded generator gives the small jitter.
//
//  EXPORTS   (grep -n "<anchor>" scenes.js)
//    camera ........... "export const CAMERA"
//    floor ............ "export const GROUND"
//    scene list ....... "export const SCENES"
//    lookup ........... "export function sceneById"
//  INTERNALS
//    mesh builders .... "function boxMesh", "function icoSphere", "function gridMesh",
//                       "function wedgeMesh"
//    rigid solver ..... "function makeRigid"
//    jelly solver ..... "function makeDeformable"
//    cloth solver ..... "function makeCodim"
//    fluid solver ..... "function makeFlowing"
// ============================================================================

const FPS = 30;

export const CAMERA = { eye: [0.0, 0.66, 1.5], target: [0.0, 0.13, 0.0], fovY: 40 };
export const GROUND = { size: 2.4, y: 0 };

// Seeded generator (mulberry32). Each make() makes its own.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(frames, objects) {
  return { fps: FPS, frames, camera: { eye: CAMERA.eye.slice(), target: CAMERA.target.slice(), fovY: CAMERA.fovY }, objects };
}

// Turn each triangle so that its normal points away from the point c.
// This works for convex shapes.
function orientOut(verts, faces, c) {
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, d = faces[f + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[d] - verts[a], vy = verts[d + 1] - verts[a + 1], vz = verts[d + 2] - verts[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (verts[a] + verts[b] + verts[d]) / 3 - c[0];
    const my = (verts[a + 1] + verts[b + 1] + verts[d + 1]) / 3 - c[1];
    const mz = (verts[a + 2] + verts[b + 2] + verts[d + 2]) / 3 - c[2];
    if (nx * mx + ny * my + nz * mz < 0) { const t = faces[f + 1]; faces[f + 1] = faces[f + 2]; faces[f + 2] = t; }
  }
  return faces;
}

// ---------------------------------------------------------------- meshes ---

// Box with half extents h, centred on the origin. 24 vertices (4 for each
// side) so that each side shades flat.
function boxMesh(hx, hy, hz) {
  const v = [], f = [];
  const sides = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  const h = [hx, hy, hz];
  for (const [a, b, c] of sides) for (const s of [-1, 1]) {
    const base = v.length / 3;
    for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0];
      p[a] = s * h[a]; p[b] = u * h[b]; p[c] = w * h[c];
      v.push(p[0], p[1], p[2]);
    }
    f.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const verts = new Float32Array(v);
  return { verts, faces: orientOut(verts, new Uint32Array(f), [0, 0, 0]) };
}

// Unit icosphere scaled to radius r. sub = number of subdivisions.
function icoSphere(r, sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  v = v.map(norm);
  for (let s = 0; s < sub; s++) {
    const mid = new Map(), nf = [];
    const m = (a, b) => {
      const k = a < b ? a * 65536 + b : b * 65536 + a;
      let i = mid.get(k);
      if (i === undefined) { i = v.length; v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); mid.set(k, i); }
      return i;
    };
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const verts = new Float32Array(v.length * 3);
  v.forEach((p, i) => { verts[i * 3] = p[0] * r; verts[i * 3 + 1] = p[1] * r; verts[i * 3 + 2] = p[2] * r; });
  return { verts, faces: orientOut(verts, new Uint32Array(f.flat()), [0, 0, 0]) };
}

// Grid of n x n vertices: two triangles for each cell. Vertex (i, j) is
// index j * n + i. The caller sets the positions.
function gridMesh(n) {
  const f = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if ((i + j) & 1) f.push(a, b, d, a, d, c); else f.push(a, b, c, b, d, c);
  }
  return new Uint32Array(f);
}

// Wedge on the floor: the slope runs from (xt, yt) down to (xb, 0), the
// back side is vertical at xt, and z goes from -hz to hz. 18 vertices so
// that each side shades flat.
function wedgeMesh(xt, yt, xb, hz) {
  const T = [xt, yt], B = [xb, 0], F = [xt, 0], v = [], f = [];
  const quad = (a, b) => { const k = v.length / 3; v.push(a[0], a[1], -hz, b[0], b[1], -hz, b[0], b[1], hz, a[0], a[1], hz); f.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  quad(T, B); quad(B, F); quad(F, T);
  for (const z of [-hz, hz]) { const k = v.length / 3; v.push(T[0], T[1], z, B[0], B[1], z, F[0], F[1], z); f.push(k, k + 1, k + 2); }
  const verts = new Float32Array(v);
  return { verts, faces: orientOut(verts, new Uint32Array(f), [(xt * 2 + xb) / 3, yt / 3, 0]) };
}

// Copy a mesh, moved by (x, y, z) and turned by the 3x3 matrix R (or none).
function placed(mesh, x, y, z, R) {
  const out = new Float32Array(mesh.verts.length);
  for (let i = 0; i < out.length; i += 3) {
    let a = mesh.verts[i], b = mesh.verts[i + 1], c = mesh.verts[i + 2];
    if (R) { const p = a, q = b; a = R[0] * p + R[1] * q + R[2] * c; b = R[3] * p + R[4] * q + R[5] * c; c = R[6] * p + R[7] * q + R[8] * c; }
    out[i] = a + x; out[i + 1] = b + y; out[i + 2] = c + z;
  }
  return out;
}

// Join several meshes into one static object.
function joinMeshes(parts) {
  let nv = 0, nf = 0;
  for (const p of parts) { nv += p.verts.length; nf += p.faces.length; }
  const verts = new Float32Array(nv), faces = new Uint32Array(nf);
  let ov = 0, of = 0;
  for (const p of parts) {
    verts.set(p.verts, ov);
    for (let k = 0; k < p.faces.length; k++) faces[of + k] = p.faces[k] + ov / 3;
    ov += p.verts.length; of += p.faces.length;
  }
  return { verts, faces };
}

function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}

function staticObj(name, color, mesh) {
  return { name, kind: 'mesh', color, dynamic: false, count: mesh.verts.length / 3, faces: mesh.faces, pos: mesh.verts };
}

// ===================================================================== RIGID
// Rigid bodies: state x (centre), q (unit quaternion x, y, z, w), v, w.
// Each substep: gravity, contact search, sequential impulses with clamped
// sums (normal >= 0, friction inside the Coulomb disc), then integration.

function quatToMat(q, R) {
  const [x, y, z, w] = q;
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
  R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
  R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
}

function matToQuat(R) {
  const tr = R[0] + R[4] + R[8];
  let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
  return [x, y, z, w];
}

function rigidBody(shape, size, mass, x, R, extra) {
  const b = {
    shape, invM: mass > 0 ? 1 / mass : 0, x: x.slice(), q: matToQuat(R), v: [0, 0, 0], w: [0, 0, 0],
    R: new Float64Array(9), Iw: new Float64Array(9), Ib: [0, 0, 0], e: 0.2, mu: 0.5, ...extra,
  };
  if (shape === 'box') {
    b.h = size;
    const [a, c, d] = size;
    if (mass > 0) b.Ib = [3 / (mass * (c * c + d * d)), 3 / (mass * (a * a + d * d)), 3 / (mass * (a * a + c * c))];
    b.br = Math.hypot(a, c, d);
  } else {
    b.r = size;
    if (mass > 0) { const i = 2.5 / (mass * size * size); b.Ib = [i, i, i]; }
    b.br = size;
  }
  b.update = () => {
    quatToMat(b.q, b.R);
    const R = b.R, I = b.Ib, W = b.Iw;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) W[i * 3 + j] = R[i * 3] * I[0] * R[j * 3] + R[i * 3 + 1] * I[1] * R[j * 3 + 1] + R[i * 3 + 2] * I[2] * R[j * 3 + 2];
  };
  b.update();
  return b;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mulM = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const mulMT = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];

// Point p (world) inside box b? Gives { n, pen } with n out of b, or null.
function pointInBox(b, p) {
  const l = mulMT(b.R, [p[0] - b.x[0], p[1] - b.x[1], p[2] - b.x[2]]);
  let best = Infinity, ax = -1;
  for (let a = 0; a < 3; a++) {
    const d = b.h[a] - Math.abs(l[a]);
    if (d <= 0) return null;
    if (d < best) { best = d; ax = a; }
  }
  const nl = [0, 0, 0]; nl[ax] = l[ax] < 0 ? -1 : 1;
  return { n: mulM(b.R, nl), pen: best };
}

function boxCorners(b) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = mulM(b.R, [sx * b.h[0], sy * b.h[1], sz * b.h[2]]);
    out.push([c[0] + b.x[0], c[1] + b.x[1], c[2] + b.x[2]]);
  }
  return out;
}

function makeRigid() {
  const seconds = 3, frames = seconds * FPS, sub = 16, dt = 1 / (FPS * sub), iters = 10;
  const G = -9.81;
  const bodies = [];

  // Ramp: a static box. Its top side runs down to the floor at x = x0.
  const th = 17 * Math.PI / 180, L = 0.52, hy = 0.03, x0 = -0.1;
  const s = [Math.cos(th), -Math.sin(th), 0], n = [Math.sin(th), Math.cos(th), 0];
  const M = [x0 - s[0] * L / 2, -s[1] * L / 2, 0];
  const ramp = rigidBody('box', [L / 2, hy, 0.12], 0, [M[0] - n[0] * hy, M[1] - n[1] * hy, 0], rotZ(-th), { mu: 0.7, e: 0.2 });
  bodies.push(ramp);

  // Ball at the top of the ramp.
  // The ball centre must be higher than the domino centre, so that the hit
  // tips the domino and does not push its foot out.
  const r = 0.07;
  const top = [x0 - s[0] * L, -s[1] * L, 0];
  const ball = rigidBody('sphere', r, 0.25, [top[0] + n[0] * r + s[0] * 0.03, top[1] + n[1] * r + s[1] * 0.03 + 0.002, 0], rotZ(0), { mu: 0.7, e: 0.35 });
  bodies.push(ball);

  // Dominoes on the floor: straight, then a gentle curve.
  const dh = [0.009, 0.05, 0.032], nd = 7, dominoes = [];
  for (let i = 0; i < nd; i++) {
    const x = 0.04 + i * 0.066, u = Math.max(0, i - 2);
    const z = -0.006 * u * u, yaw = Math.atan(0.012 * u / 0.066);
    const d = rigidBody('box', dh, 0.06, [x, dh[1], z], rotY(yaw), { mu: 0.55, e: 0.1 });
    bodies.push(d); dominoes.push(d);
  }

  const dyn = bodies.filter((b) => b.invM > 0);
  const meshes = new Map();
  const ballMesh = icoSphere(r, 2), domMesh = boxMesh(dh[0], dh[1], dh[2]);
  meshes.set(ball, ballMesh); for (const d of dominoes) meshes.set(d, domMesh);
  const out = dyn.map((b) => new Float32Array(frames * meshes.get(b).verts.length));

  const record = (f) => {
    dyn.forEach((b, k) => {
      const mv = meshes.get(b).verts, o = out[k], base = f * mv.length, R = b.R;
      for (let i = 0; i < mv.length; i += 3) {
        const a = mv[i], c = mv[i + 1], d = mv[i + 2];
        o[base + i] = R[0] * a + R[1] * c + R[2] * d + b.x[0];
        o[base + i + 1] = R[3] * a + R[4] * c + R[5] * d + b.x[1];
        o[base + i + 2] = R[6] * a + R[7] * c + R[8] * d + b.x[2];
      }
    });
  };

  // Contact: A is pushed along n, B the other way. B may be null (floor).
  const contacts = [];
  const addContact = (A, B, p, nrm, pen) => {
    const rA = [p[0] - A.x[0], p[1] - A.x[1], p[2] - A.x[2]];
    const rB = B ? [p[0] - B.x[0], p[1] - B.x[1], p[2] - B.x[2]] : [0, 0, 0];
    const t1 = Math.abs(nrm[0]) < 0.9 ? cross(nrm, [1, 0, 0]) : cross(nrm, [0, 1, 0]);
    const l = Math.hypot(t1[0], t1[1], t1[2]); t1[0] /= l; t1[1] /= l; t1[2] /= l;
    const t2 = cross(nrm, t1);
    const k = (d) => {
      let m = A.invM + (B ? B.invM : 0);
      const a = cross(rA, d); m += dot(a, mulM(A.Iw, a));
      if (B && B.invM > 0) { const c = cross(rB, d); m += dot(c, mulM(B.Iw, c)); }
      return 1 / m;
    };
    const c = { A, B, n: nrm, t1, t2, rA, rB, kn: k(nrm), k1: k(t1), k2: k(t2), jn: 0, j1: 0, j2: 0, mu: Math.sqrt(A.mu * (B ? B.mu : 0.6)) };
    const vn = dot(relVel(c), nrm);
    const e = Math.max(A.e, B ? B.e : 0.3);
    c.target = Math.max(vn < -0.25 ? -e * vn : 0, Math.min(0.3, 0.25 / dt * Math.max(pen - 0.0005, 0)));
    contacts.push(c);
  };
  const relVel = (c) => {
    const { A, B } = c;
    const wa = cross(A.w, c.rA);
    let vx = A.v[0] + wa[0], vy = A.v[1] + wa[1], vz = A.v[2] + wa[2];
    if (B) { const wb = cross(B.w, c.rB); vx -= B.v[0] + wb[0]; vy -= B.v[1] + wb[1]; vz -= B.v[2] + wb[2]; }
    return [vx, vy, vz];
  };
  const apply = (c, P) => {
    const { A, B } = c;
    A.v[0] += P[0] * A.invM; A.v[1] += P[1] * A.invM; A.v[2] += P[2] * A.invM;
    const da = mulM(A.Iw, cross(c.rA, P)); A.w[0] += da[0]; A.w[1] += da[1]; A.w[2] += da[2];
    if (B && B.invM > 0) {
      B.v[0] -= P[0] * B.invM; B.v[1] -= P[1] * B.invM; B.v[2] -= P[2] * B.invM;
      const db = mulM(B.Iw, cross(c.rB, P)); B.w[0] -= db[0]; B.w[1] -= db[1]; B.w[2] -= db[2];
    }
  };

  const findContacts = () => {
    contacts.length = 0;
    for (const A of dyn) {
      if (A.shape === 'sphere') { const pen = A.r - A.x[1]; if (pen > 0) addContact(A, null, [A.x[0], 0, A.x[2]], [0, 1, 0], pen); }
      else for (const p of boxCorners(A)) if (p[1] < 0) addContact(A, null, [p[0], 0, p[2]], [0, 1, 0], -p[1]);
    }
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      let A = bodies[i], B = bodies[j];
      if (A.invM === 0 && B.invM === 0) continue;
      const dx = A.x[0] - B.x[0], dy = A.x[1] - B.x[1], dz = A.x[2] - B.x[2];
      if (dx * dx + dy * dy + dz * dz > (A.br + B.br) ** 2) continue;
      if (A.shape === 'box' && B.shape === 'sphere') { const t = A; A = B; B = t; }
      if (A.invM === 0) { const t = A; A = B; B = t; }
      if (A.shape === 'sphere' && B.shape === 'sphere') {
        const d = Math.hypot(dx, dy, dz), pen = A.r + B.r - d;
        if (pen > 0 && d > 1e-9) {
          const nn = [(A.x[0] - B.x[0]) / d, (A.x[1] - B.x[1]) / d, (A.x[2] - B.x[2]) / d];
          addContact(A, B, [B.x[0] + nn[0] * B.r, B.x[1] + nn[1] * B.r, B.x[2] + nn[2] * B.r], nn, pen);
        }
      } else if (A.shape === 'sphere') {
        // Sphere A against box B: closest point of B to the centre of A.
        const l = mulMT(B.R, [A.x[0] - B.x[0], A.x[1] - B.x[1], A.x[2] - B.x[2]]);
        const q = [Math.max(-B.h[0], Math.min(B.h[0], l[0])), Math.max(-B.h[1], Math.min(B.h[1], l[1])), Math.max(-B.h[2], Math.min(B.h[2], l[2]))];
        const d = [l[0] - q[0], l[1] - q[1], l[2] - q[2]], dl = Math.hypot(d[0], d[1], d[2]);
        if (dl > 1e-9 && dl < A.r) {
          const nn = mulM(B.R, [d[0] / dl, d[1] / dl, d[2] / dl]), qw = mulM(B.R, q);
          addContact(A, B, [qw[0] + B.x[0], qw[1] + B.x[1], qw[2] + B.x[2]], nn, A.r - dl);
        } else if (dl <= 1e-9) {
          const hit = pointInBox(B, A.x);
          if (hit) addContact(A, B, A.x.slice(), hit.n, hit.pen + A.r);
        }
      } else {
        // Box against box: corners of each inside the other.
        for (const p of boxCorners(A)) { const h = pointInBox(B, p); if (h) addContact(A, B, p, h.n, h.pen); }
        if (B.invM > 0) for (const p of boxCorners(B)) { const h = pointInBox(A, p); if (h) addContact(B, A, p, h.n, h.pen); }
      }
    }
  };

  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (const b of dyn) b.v[1] += G * dt;
      findContacts();
      for (let it = 0; it < iters; it++) for (const c of contacts) {
        const vr = relVel(c);
        const vn = dot(vr, c.n);
        let dj = (c.target - vn) * c.kn;
        const jn = Math.max(c.jn + dj, 0); dj = jn - c.jn; c.jn = jn;
        apply(c, [c.n[0] * dj, c.n[1] * dj, c.n[2] * dj]);
        const vr2 = relVel(c);
        let j1 = c.j1 - dot(vr2, c.t1) * c.k1, j2 = c.j2 - dot(vr2, c.t2) * c.k2;
        const lim = c.mu * c.jn, jt = Math.hypot(j1, j2);
        if (jt > lim) { j1 *= lim / jt; j2 *= lim / jt; }
        const d1 = j1 - c.j1, d2 = j2 - c.j2; c.j1 = j1; c.j2 = j2;
        apply(c, [c.t1[0] * d1 + c.t2[0] * d2, c.t1[1] * d1 + c.t2[1] * d2, c.t1[2] * d1 + c.t2[2] * d2]);
      }
      for (const b of dyn) {
        b.x[0] += b.v[0] * dt; b.x[1] += b.v[1] * dt; b.x[2] += b.v[2] * dt;
        const [qx, qy, qz, qw] = b.q, [wx, wy, wz] = b.w, h = 0.5 * dt;
        b.q = [qx + h * (wx * qw + wy * qz - wz * qy), qy + h * (wy * qw + wz * qx - wx * qz), qz + h * (wz * qw + wx * qy - wy * qx), qw - h * (wx * qx + wy * qy + wz * qz)];
        const ql = Math.hypot(...b.q); b.q = b.q.map((v) => v / ql);
        const damp = 1 - 0.3 * dt; b.w[0] *= damp; b.w[1] *= damp; b.w[2] *= damp;
        // Rolling resistance: a ball on the floor slowly loses speed.
        if (b.shape === 'sphere' && b.x[1] < b.r + 0.002) { const rr = 1 - 1.2 * dt; b.v[0] *= rr; b.v[2] *= rr; b.w[0] *= rr; b.w[1] *= rr; b.w[2] *= rr; }
        b.update();
      }
    }
    record(f);
  }

  // The ramp collider is a box that goes into the floor. We draw only the
  // part above the floor: a wedge with the same top side.
  const objs = [staticObj('ramp', [0.36, 0.42, 0.55], wedgeMesh(top[0], top[1], x0, ramp.h[2]))];
  objs.push({ name: 'ball', kind: 'mesh', color: [0.96, 0.47, 0.36], dynamic: true, count: ballMesh.verts.length / 3, faces: ballMesh.faces, pos: out[0] });
  const pal = [[0.98, 0.80, 0.36], [0.90, 0.85, 0.42], [0.72, 0.86, 0.48], [0.50, 0.85, 0.58], [0.38, 0.80, 0.70], [0.38, 0.72, 0.84], [0.48, 0.62, 0.92]];
  dominoes.forEach((_d, i) => objs.push({ name: `domino ${i + 1}`, kind: 'mesh', color: pal[i], dynamic: true, count: domMesh.verts.length / 3, faces: domMesh.faces, pos: out[i + 1] }));
  return world(frames, objs);
}

// ================================================================ DEFORMABLE
// XPBD with small steps: each substep predicts positions, solves every
// edge (distance) and tet (volume) constraint once, resolves contacts with
// friction, and sets v = (x - x_prev) / dt.

function makeDeformable() {
  const seconds = 4, frames = seconds * FPS, sub = 20, dt = 1 / (FPS * sub);
  const N = 7, size = 0.24, hs = size / 2, sp = size / (N - 1);
  const nn = N * N * N, id = (i, j, k) => (k * N + j) * N + i;
  const x = new Float64Array(nn * 3), p = new Float64Array(nn * 3), v = new Float64Array(nn * 3);
  const R0 = mul3(rotZ(0.18), rotX(0.12)), c0 = [0.02, 0.44, 0.0];
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = [i * sp - hs, j * sp - hs, k * sp - hs], q = mulM(R0, l), n = id(i, j, k) * 3;
    x[n] = q[0] + c0[0]; x[n + 1] = q[1] + c0[1]; x[n + 2] = q[2] + c0[2];
    v[n] = 0.1; v[n + 1] = -0.4; v[n + 2] = 0;
  }
  // Five tets for each cell, the split turns with cell parity.
  const tets = [];
  for (let k = 0; k < N - 1; k++) for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const c = (a, b, d) => id(i + a, j + b, k + d);
    const v000 = c(0, 0, 0), v100 = c(1, 0, 0), v010 = c(0, 1, 0), v110 = c(1, 1, 0), v001 = c(0, 0, 1), v101 = c(1, 0, 1), v011 = c(0, 1, 1), v111 = c(1, 1, 1);
    if ((i + j + k) % 2 === 0) tets.push([v100, v010, v001, v111], [v000, v100, v010, v001], [v110, v100, v010, v111], [v101, v100, v001, v111], [v011, v010, v001, v111]);
    else tets.push([v000, v110, v101, v011], [v100, v000, v110, v101], [v010, v000, v110, v011], [v001, v000, v101, v011], [v111, v110, v101, v011]);
  }
  const T = tets.length, tet = new Int32Array(T * 4), vol0 = new Float64Array(T);
  const tvol = (P, a, b, c, d) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const wx = P[d * 3] - P[a * 3], wy = P[d * 3 + 1] - P[a * 3 + 1], wz = P[d * 3 + 2] - P[a * 3 + 2];
    return (ux * (vy * wz - vz * wy) + uy * (vz * wx - vx * wz) + uz * (vx * wy - vy * wx)) / 6;
  };
  const edgeSet = new Map();
  tets.forEach((t, n) => {
    tet.set(t, n * 4); vol0[n] = tvol(x, t[0], t[1], t[2], t[3]);
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) { const lo = Math.min(t[a], t[b]), hi = Math.max(t[a], t[b]); edgeSet.set(lo * nn + hi, [lo, hi]); }
  });
  const edges = [...edgeSet.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const E = edges.length, ed = new Int32Array(E * 2), len0 = new Float64Array(E);
  edges.forEach(([a, b], n) => { ed[n * 2] = a; ed[n * 2 + 1] = b; len0[n] = Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]); });

  const mass = 0.35 / nn, w = 1 / mass;
  const aE = 4e-2 / (dt * dt), aV = 1e-8 / (dt * dt);   // XPBD compliance: soft edges, near-rigid volume
  // Static block: the jelly lands on its edge.
  const blk = { c: [0.15, 0.07, 0.0], h: [0.17, 0.07, 0.2] };
  const muS = 0.6, muK = 0.45;

  // Surface: the six sides of the lattice. Map lattice nodes to surface
  // vertices.
  const surfMap = new Int32Array(nn).fill(-1), surf = [], sfaces = [];
  const sv = (n) => { if (surfMap[n] < 0) { surfMap[n] = surf.length; surf.push(n); } return surfMap[n]; };
  for (let ax = 0; ax < 3; ax++) for (const side of [0, N - 1]) for (let b = 0; b < N - 1; b++) for (let a = 0; a < N - 1; a++) {
    const at = (u, w2) => { const c = [0, 0, 0]; c[ax] = side; c[(ax + 1) % 3] = u; c[(ax + 2) % 3] = w2; return id(c[0], c[1], c[2]); };
    const q00 = sv(at(a, b)), q10 = sv(at(a + 1, b)), q01 = sv(at(a, b + 1)), q11 = sv(at(a + 1, b + 1));
    sfaces.push(q00, q10, q11, q00, q11, q01);
  }
  const S = surf.length, faces = new Uint32Array(sfaces);
  { const rv = new Float32Array(S * 3); surf.forEach((n, i) => { rv[i * 3] = x[n * 3]; rv[i * 3 + 1] = x[n * 3 + 1]; rv[i * 3 + 2] = x[n * 3 + 2]; }); orientOut(rv, faces, c0); }
  const out = new Float32Array(frames * S * 3);

  const collide = (n) => {
    const k = n * 3;
    let nx = 0, ny = 0, nz = 0, pen = 0;
    if (x[k + 1] < 0) { pen = -x[k + 1]; ny = 1; x[k + 1] = 0; }
    else {
      const lx = x[k] - blk.c[0], ly = x[k + 1] - blk.c[1], lz = x[k + 2] - blk.c[2];
      const dx = blk.h[0] - Math.abs(lx), dy = blk.h[1] - Math.abs(ly), dz = blk.h[2] - Math.abs(lz);
      if (dx > 0 && dy > 0 && dz > 0) {
        if (dy <= dx && dy <= dz) { pen = dy; ny = ly < 0 ? -1 : 1; }
        else if (dx <= dz) { pen = dx; nx = lx < 0 ? -1 : 1; }
        else { pen = dz; nz = lz < 0 ? -1 : 1; }
        x[k] += nx * pen; x[k + 1] += ny * pen; x[k + 2] += nz * pen;
      }
    }
    if (pen > 0) {
      // Friction: remove the tangent part of the step, up to mu * pen.
      const dx = x[k] - p[k], dy = x[k + 1] - p[k + 1], dz = x[k + 2] - p[k + 2], dn = dx * nx + dy * ny + dz * nz;
      const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz, tl = Math.hypot(tx, ty, tz);
      const s = tl < muS * pen ? 1 : Math.min(muK * pen / (tl || 1), 1);
      x[k] -= tx * s; x[k + 1] -= ty * s; x[k + 2] -= tz * s;
    }
  };

  const record = (f) => { const b = f * S * 3; for (let i = 0; i < S; i++) { const n = surf[i] * 3; out[b + i * 3] = x[n]; out[b + i * 3 + 1] = x[n + 1]; out[b + i * 3 + 2] = x[n + 2]; } };
  const gx = new Float64Array(12);
  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (let k = 0; k < nn * 3; k += 3) {
        p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
        v[k + 1] -= 9.81 * dt;
        x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
      }
      for (let e = 0; e < E; e++) {
        const a = ed[e * 2] * 3, b = ed[e * 2 + 1] * 3;
        const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2], l = Math.hypot(dx, dy, dz);
        if (l < 1e-12) continue;
        const lam = -(l - len0[e]) / (2 * w + aE), s = lam * w / l;
        x[a] += dx * s; x[a + 1] += dy * s; x[a + 2] += dz * s;
        x[b] -= dx * s; x[b + 1] -= dy * s; x[b + 2] -= dz * s;
      }
      for (let t = 0; t < T; t++) {
        const i0 = tet[t * 4] * 3, i1 = tet[t * 4 + 1] * 3, i2 = tet[t * 4 + 2] * 3, i3 = tet[t * 4 + 3] * 3;
        const ax = x[i1] - x[i0], ay = x[i1 + 1] - x[i0 + 1], az = x[i1 + 2] - x[i0 + 2];
        const bx = x[i2] - x[i0], by = x[i2 + 1] - x[i0 + 1], bz = x[i2 + 2] - x[i0 + 2];
        const cx = x[i3] - x[i0], cy = x[i3 + 1] - x[i0 + 1], cz = x[i3 + 2] - x[i0 + 2];
        gx[3] = (by * cz - bz * cy) / 6; gx[4] = (bz * cx - bx * cz) / 6; gx[5] = (bx * cy - by * cx) / 6;
        gx[6] = (cy * az - cz * ay) / 6; gx[7] = (cz * ax - cx * az) / 6; gx[8] = (cx * ay - cy * ax) / 6;
        gx[9] = (ay * bz - az * by) / 6; gx[10] = (az * bx - ax * bz) / 6; gx[11] = (ax * by - ay * bx) / 6;
        gx[0] = -gx[3] - gx[6] - gx[9]; gx[1] = -gx[4] - gx[7] - gx[10]; gx[2] = -gx[5] - gx[8] - gx[11];
        const V = ax * gx[3] + ay * gx[4] + az * gx[5];
        let sg = 0; for (let q = 0; q < 12; q++) sg += gx[q] * gx[q];
        const lam = -(V - vol0[t]) / (w * sg + aV + 1e-30);
        const ids = [i0, i1, i2, i3];
        for (let q = 0; q < 4; q++) { const m = ids[q]; x[m] += lam * w * gx[q * 3]; x[m + 1] += lam * w * gx[q * 3 + 1]; x[m + 2] += lam * w * gx[q * 3 + 2]; }
      }
      for (let n = 0; n < nn; n++) collide(n);
      const damp = 1 - 1.5 * dt;
      for (let k = 0; k < nn * 3; k++) v[k] = (x[k] - p[k]) / dt * damp;
    }
    record(f);
  }
  const bm = boxMesh(blk.h[0], blk.h[1], blk.h[2]);
  return world(frames, [
    staticObj('block', [0.34, 0.40, 0.52], { verts: placed(bm, blk.c[0], blk.c[1], blk.c[2]), faces: bm.faces }),
    { name: 'jelly', kind: 'mesh', color: [0.93, 0.38, 0.62], dynamic: true, count: S, faces, pos: out },
  ]);
}

// ===================================================================== CODIM
// XPBD cloth: stretch and shear are stiff distance constraints, bending is
// a soft distance constraint across two cells. Contacts with the ball and
// the floor keep a small skin and use the same friction as the jelly.

function makeCodim() {
  const seconds = 4, frames = seconds * FPS, sub = 28, dt = 1 / (FPS * sub), iters = 1;
  const n = 33, size = 0.8, sp = size / (n - 1), nn = n * n;
  const x = new Float64Array(nn * 3), p = new Float64Array(nn * 3), v = new Float64Array(nn * 3);
  const R0 = mul3(rotY(0.35), rotX(0.12)), c0 = [0.06, 0.52, 0.02];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = mulM(R0, [i * sp - size / 2, 0, j * sp - size / 2]), k = (j * n + i) * 3;
    x[k] = q[0] + c0[0]; x[k + 1] = q[1] + c0[1]; x[k + 2] = q[2] + c0[2];
  }
  // Constraints: [a, b, rest, compliance]. Bend comes first and stretch
  // last in each sweep, so that the stored frame satisfies stretch. In a
  // tight fold the bend constraint pulls hard; if it came last, the frame
  // would show stretched edges.
  const cons = [];
  const BEND = 2e-3, SHEAR = 1e-6;
  const add = (a, b, c) => cons.push([a, b, Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]), c]);
  const at = (i, j) => j * n + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i + 2 < n) add(at(i, j), at(i + 2, j), BEND);
    if (j + 2 < n) add(at(i, j), at(i, j + 2), BEND);
  }
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) { add(at(i, j), at(i + 1, j + 1), SHEAR); add(at(i + 1, j), at(i, j + 1), SHEAR); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i + 1 < n) add(at(i, j), at(i + 1, j), 0);
    if (j + 1 < n) add(at(i, j), at(i, j + 1), 0);
  }
  const C = cons.length, ca = new Int32Array(C), cb = new Int32Array(C), rest = new Float64Array(C), alpha = new Float64Array(C);
  cons.forEach(([a, b, r, c], k) => { ca[k] = a * 3; cb[k] = b * 3; rest[k] = r; alpha[k] = c / (dt * dt); });
  const mass = 0.25 / nn, w = 1 / mass;
  const ballR = 0.2, ballC = [0, ballR, 0], skin = 0.006, muS = 0.7, muK = 0.5;
  const out = new Float32Array(frames * nn * 3);
  // Friction for one contact with normal n and depth pen: remove the
  // tangent part of the step from p, up to mu * pen.
  const rub = (k, nx, ny, nz, pen) => {
    const ex = x[k] - p[k], ey = x[k + 1] - p[k + 1], ez = x[k + 2] - p[k + 2], dn = ex * nx + ey * ny + ez * nz;
    const tx = ex - dn * nx, ty = ey - dn * ny, tz = ez - dn * nz, tl = Math.hypot(tx, ty, tz);
    const s = tl < muS * pen ? 1 : Math.min(muK * pen / (tl || 1), 1);
    x[k] -= tx * s; x[k + 1] -= ty * s; x[k + 2] -= tz * s;
  };
  // Each obstacle uses its own normal. Ball and floor meet in a narrow
  // wedge, so the pair runs two times.
  const contact = (k) => {
    for (let rep = 0; rep < 2; rep++) {
      const dx = x[k] - ballC[0], dy = x[k + 1] - ballC[1], dz = x[k + 2] - ballC[2], d = Math.hypot(dx, dy, dz);
      if (d < ballR + skin && d > 1e-9) {
        const pen = ballR + skin - d, nx = dx / d, ny = dy / d, nz = dz / d;
        x[k] += nx * pen; x[k + 1] += ny * pen; x[k + 2] += nz * pen;
        if (rep === 0) rub(k, nx, ny, nz, pen);
      }
      if (x[k + 1] < skin) {
        const pen = skin - x[k + 1]; x[k + 1] = skin;
        if (rep === 0) rub(k, 0, 1, 0, pen);
      }
    }
  };

  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (let k = 0; k < nn * 3; k += 3) {
        p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
        v[k + 1] -= 9.81 * dt;
        x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
      }
      // Contacts before and after the constraints, so that the stored
      // frame has no vertex inside the ball or the floor.
      for (let k = 0; k < nn * 3; k += 3) contact(k);
      for (let it = 0; it < iters; it++) for (let c = 0; c < C; c++) {
        const a = ca[c], b = cb[c];
        const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2], l = Math.hypot(dx, dy, dz);
        if (l < 1e-12) continue;
        const s = -(l - rest[c]) / (2 * w + alpha[c]) * w / l;
        x[a] += dx * s; x[a + 1] += dy * s; x[a + 2] += dz * s;
        x[b] -= dx * s; x[b + 1] -= dy * s; x[b + 2] -= dz * s;
      }
      for (let k = 0; k < nn * 3; k += 3) contact(k);
      const damp = 1 - 0.8 * dt;
      for (let k = 0; k < nn * 3; k++) v[k] = (x[k] - p[k]) / dt * damp;
    }
    out.set(x, f * nn * 3);
  }
  const bm = icoSphere(ballR, 3);
  return world(frames, [
    staticObj('ball', [0.95, 0.70, 0.36], { verts: placed(bm, ballC[0], ballC[1], ballC[2]), faces: bm.faces }),
    { name: 'cloth', kind: 'mesh', color: [0.30, 0.78, 0.74], dynamic: true, count: nn, faces: gridMesh(n), pos: out },
  ]);
}

// ================================================================== FLOWING
// Position based fluid. Each substep: predict, find neighbours on a grid
// (cell = h), then a few Jacobi passes of the density constraint
// rho_i / rho0 - 1 = 0, then XSPH viscosity. The constraint acts only on
// compression, so the surface does not clump and needs no extra pressure
// term. Each Jacobi pass applies half of its correction, because full
// passes overshoot and the column blows up. The tank walls clamp positions.

function makeFlowing() {
  const seconds = 4, frames = seconds * FPS, sub = 3, dt = 1 / (FPS * sub), iters = 5;
  const d = 0.026, h = 1.7 * d, h2 = h * h, rand = rng(4242);
  const tank = { x0: -0.44, x1: 0.44, z0: -0.17, z1: 0.17, y1: 1.4 };
  const nx = 11, ny = 16, nz = 11, N = nx * ny * nz;
  const x = new Float64Array(N * 3), p = new Float64Array(N * 3), v = new Float64Array(N * 3), dp = new Float64Array(N * 3);
  const lam = new Float64Array(N);
  let q = 0;
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    x[q] = tank.x0 + d * (i + 0.5) + (rand() - 0.5) * 1e-4 * d;
    x[q + 1] = d * (j + 0.5);
    x[q + 2] = tank.z0 + d * (k + 0.5) + (tank.z1 - tank.z0 - nz * d) / 2 + (rand() - 0.5) * 1e-4 * d;
    q += 3;
  }
  const poly = 315 / (64 * Math.PI * h ** 9), spiky = -45 / (Math.PI * h ** 6);
  const W = (r2) => { const t = h2 - r2; return t > 0 ? poly * t * t * t : 0; };
  // Rest density of a full lattice at spacing d.
  let rho0 = 0;
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) rho0 += W((a * a + b * b + c * c) * d * d);
  let S0 = 0;
  { // typical sum of squared gradients at rest, to scale the relaxation
    let gx = 0, gy = 0, gz = 0;
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) {
      const r = Math.hypot(a, b, c) * d; if (r <= 0 || r >= h) continue;
      const g = spiky * (h - r) * (h - r) / r / rho0; const t = [a * d * g, b * d * g, c * d * g];
      S0 += dot(t, t); gx += t[0]; gy += t[1]; gz += t[2];
    }
    S0 += gx * gx + gy * gy + gz * gz;
  }
  const relax = 0.3 * S0;   // soft constraint: keeps the Jacobi passes stable
  // Grid for neighbours.
  const gnx = Math.ceil((tank.x1 - tank.x0) / h) + 1, gny = Math.ceil(tank.y1 / h) + 1, gnz = Math.ceil((tank.z1 - tank.z0) / h) + 1;
  const cellStart = new Int32Array(gnx * gny * gnz + 1), cellOf = new Int32Array(N), sorted = new Int32Array(N);
  const MAXN = 48, nbr = new Int32Array(N * MAXN), nCount = new Int32Array(N);
  const cellIdx = (k) => {
    const ci = Math.min(gnx - 1, Math.max(0, Math.floor((x[k] - tank.x0) / h)));
    const cj = Math.min(gny - 1, Math.max(0, Math.floor(x[k + 1] / h)));
    const ck = Math.min(gnz - 1, Math.max(0, Math.floor((x[k + 2] - tank.z0) / h)));
    return (ck * gny + cj) * gnx + ci;
  };
  const buildNeighbours = () => {
    cellStart.fill(0);
    for (let i = 0; i < N; i++) { const c = cellIdx(i * 3); cellOf[i] = c; cellStart[c + 1]++; }
    for (let c = 0; c < gnx * gny * gnz; c++) cellStart[c + 1] += cellStart[c];
    const fill = cellStart.slice(0, -1);
    for (let i = 0; i < N; i++) sorted[fill[cellOf[i]]++] = i;
    for (let i = 0; i < N; i++) {
      const c = cellOf[i], ci = c % gnx, cj = Math.floor(c / gnx) % gny, ck = Math.floor(c / (gnx * gny));
      let cnt = 0; const k = i * 3;
      for (let a = Math.max(0, ck - 1); a <= Math.min(gnz - 1, ck + 1); a++)
        for (let b = Math.max(0, cj - 1); b <= Math.min(gny - 1, cj + 1); b++)
          for (let e = Math.max(0, ci - 1); e <= Math.min(gnx - 1, ci + 1); e++) {
            const cc = (a * gny + b) * gnx + e;
            for (let s = cellStart[cc]; s < cellStart[cc + 1]; s++) {
              const j = sorted[s]; if (j === i || cnt >= MAXN) continue;
              const m = j * 3, dx = x[k] - x[m], dy = x[k + 1] - x[m + 1], dz = x[k + 2] - x[m + 2];
              if (dx * dx + dy * dy + dz * dz < h2) nbr[i * MAXN + cnt++] = j;
            }
          }
      nCount[i] = cnt;
    }
  };
  const r0 = d * 0.5;
  const clamp = (k) => {
    if (x[k] < tank.x0 + r0) x[k] = tank.x0 + r0; else if (x[k] > tank.x1 - r0) x[k] = tank.x1 - r0;
    if (x[k + 1] < r0) x[k + 1] = r0; else if (x[k + 1] > tank.y1) x[k + 1] = tank.y1;
    if (x[k + 2] < tank.z0 + r0) x[k + 2] = tank.z0 + r0; else if (x[k + 2] > tank.z1 - r0) x[k + 2] = tank.z1 - r0;
  };
  const out = new Float32Array(frames * N * 3);
  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (let k = 0; k < N * 3; k += 3) {
        p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
        v[k + 1] -= 9.81 * dt;
        x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
        clamp(k);
      }
      buildNeighbours();
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const k = i * 3; let rho = W(0), gx = 0, gy = 0, gz = 0, sg = 0;
          for (let s = 0; s < nCount[i]; s++) {
            const m = nbr[i * MAXN + s] * 3, dx = x[k] - x[m], dy = x[k + 1] - x[m + 1], dz = x[k + 2] - x[m + 2];
            const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= h2) continue;
            rho += W(r2);
            const r = Math.sqrt(r2); if (r < 1e-9) continue;
            const g = spiky * (h - r) * (h - r) / r / rho0;
            gx += dx * g; gy += dy * g; gz += dz * g; sg += g * g * r2;
          }
          const Ci = rho / rho0 - 1;
          lam[i] = Ci > 0 ? -Ci / (sg + gx * gx + gy * gy + gz * gz + relax) : 0;
        }
        for (let i = 0; i < N; i++) {
          const k = i * 3; let ax = 0, ay = 0, az = 0;
          for (let s = 0; s < nCount[i]; s++) {
            const j = nbr[i * MAXN + s], m = j * 3, dx = x[k] - x[m], dy = x[k + 1] - x[m + 1], dz = x[k + 2] - x[m + 2];
            const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= h2) continue;
            const r = Math.sqrt(r2); if (r < 1e-9) continue;
            const g = (lam[i] + lam[j]) * spiky * (h - r) * (h - r) / r / rho0;
            ax += dx * g; ay += dy * g; az += dz * g;
          }
          dp[k] = ax; dp[k + 1] = ay; dp[k + 2] = az;
        }
        for (let k = 0; k < N * 3; k += 3) { x[k] += 0.5 * dp[k]; x[k + 1] += 0.5 * dp[k + 1]; x[k + 2] += 0.5 * dp[k + 2]; clamp(k); }
      }
      for (let k = 0; k < N * 3; k++) v[k] = (x[k] - p[k]) / dt;
      // XSPH viscosity.
      const c = 0.02;
      for (let i = 0; i < N; i++) {
        const k = i * 3; let ax = 0, ay = 0, az = 0;
        for (let s = 0; s < nCount[i]; s++) {
          const m = nbr[i * MAXN + s] * 3, dx = x[k] - x[m], dy = x[k + 1] - x[m + 1], dz = x[k + 2] - x[m + 2];
          const wv = W(dx * dx + dy * dy + dz * dz) / rho0;
          ax += (v[m] - v[k]) * wv; ay += (v[m + 1] - v[k + 1]) * wv; az += (v[m + 2] - v[k + 2]) * wv;
        }
        dp[k] = ax * c; dp[k + 1] = ay * c; dp[k + 2] = az * c;
      }
      for (let k = 0; k < N * 3; k++) v[k] += dp[k];
    }
    out.set(x, f * N * 3);
  }

  // Tank: a back wall, two end walls and a low front lip, all thin boxes.
  const t = 0.012, H = 0.34, cz = (tank.z0 + tank.z1) / 2, hzT = (tank.z1 - tank.z0) / 2 + t, hxT = (tank.x1 - tank.x0) / 2 + 2 * t;
  const part = (hx, hy, hz, px, py, pz) => { const m = boxMesh(hx, hy, hz); return { verts: placed(m, px, py, pz), faces: m.faces }; };
  const tankMesh = joinMeshes([
    part(hxT, H / 2, t / 2, 0, H / 2, tank.z0 - t / 2),
    part(t / 2, H / 2, hzT, tank.x0 - t / 2, H / 2, cz),
    part(t / 2, H / 2, hzT, tank.x1 + t / 2, H / 2, cz),
    part(hxT, 0.02, t / 2, 0, 0.02, tank.z1 + t / 2),
  ]);
  return world(frames, [
    staticObj('tank', [0.40, 0.46, 0.58], tankMesh),
    { name: 'water', kind: 'points', color: [0.32, 0.62, 1.0], dynamic: true, count: N, radius: d / 2, pos: out },
  ]);
}

// ==================================================================== LIST

export const SCENES = [
  { id: 'rigid', label: 'Ball and dominoes', family: 'rigid', seconds: 3, make: makeRigid,
    blurb: 'A ball rolls down a ramp and knocks over a row of seven dominoes that curves away at the end.' },
  { id: 'deformable', label: 'Jelly cube', family: 'deformable', seconds: 4, make: makeDeformable,
    blurb: 'A soft cube lands on the edge of a block, squashes, tips off and settles on the floor beside it.' },
  { id: 'codim', label: 'Cloth on a ball', family: 'codim', seconds: 4, make: makeCodim,
    blurb: 'A square sheet of cloth falls onto a ball and drapes down to the floor in folds.' },
  { id: 'flowing', label: 'Dam break', family: 'flowing', seconds: 4, make: makeFlowing,
    blurb: 'A column of water at one end of a tank collapses, runs across, washes up the far wall and sloshes back.' },
];

export function sceneById(id) { return SCENES.find((s) => s.id === id) || null; }

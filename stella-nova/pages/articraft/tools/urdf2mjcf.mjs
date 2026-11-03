// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  tools/urdf2mjcf.mjs — compiled URDF -> MJCF + STL
// ----------------------------------------------------------------------------
//  This tool reads tools/compiled.tsv and the harness output for each record
//  ($S/data/cache/record_materialization/<id>/model.urdf + OBJ meshes). It
//  writes data/objects/<slug>/model.xml, data/objects/<slug>/meshes/*.stl and
//  data/manifest.json. The rules are in CONTRACT.md, "model.xml rules".
//  Node only, no npm packages. The mesh simplifier is our own code.
//
//  GREP MAP
//    function parseXML ........ small XML reader for URDF
//    function parseOBJ ........ OBJ -> positions + triangles
//    function weld ............ merge equal vertices (1 um grid)
//    function decimate ........ quadric edge collapse (Garland-Heckbert)
//    function buildTree ....... URDF links/joints -> bodies; fixed joints merge
//    function fixInertia ...... make the inertia matrix valid for MuJoCo
//    function meshMassProps ... volume, centroid, inertia of a closed mesh
//    function hullMassProps ... same for the convex hull (MuJoCo), open meshes
//    function bodyInertial .... URDF inertial, else mesh volume x DENSITY
//    function emitXML ......... MJCF text from the body tree
//    function tune ............ kp, damping and armature from MuJoCo qM and bias
//    function convert ......... one record, end to end
//    BUDGET_OBJ / BUDGET_ALL .. size budgets (bytes)
//
//  Usage:  node tools/urdf2mjcf.mjs [record-id ...]   (default: all of compiled.tsv)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMuJoCo, createSim } from '../../mujoco-lab/core/engine.js';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.dirname(TOOLS);
const DATA = path.join(PAGE, 'data');
const S = process.env.S || '/private/tmp/claude-501/-Users-davidkubala-Downloads-davesgames-site/70c36212-1e83-4438-9ae1-29026f3d8fdd/scratchpad/articraft';
const BUDGET_OBJ = 190 * 1024;     // target per object; the hard limit is 400 KB
const BUDGET_ALL = 15 * 1024 * 1024;
const FREE_ERR = 0.0005;           // collapse past the target while the error is below 0.5 mm
const W0 = 10, WMAX = 20;          // servo natural frequency (rad/s): wanted, upper limit
const TOL_HINGE = 0.03, TOL_SLIDE = 0.004;   // static gravity error (rad, m)
const DENSITY = 350, MASS_RANGE = [0.02, 2000];   // kg/m^3 and kg, for links with no URDF inertial
const ZETA = 1;                    // damping ratio (critical)

// ---------------------------------------------------------------- XML reader
export function parseXML(text) {
  text = text.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = { tag: '#root', attrs: {}, children: [] }, stack = [root];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    const [, close, tag, attrText, self] = m;
    if (close) { stack.pop(); continue; }
    const attrs = {};
    attrText.replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = (a ?? b).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); });
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!self) stack.push(node);
  }
  return root.children[0];
}
const kids = (n, tag) => (n ? n.children.filter(c => c.tag === tag) : []);
const kid = (n, tag) => kids(n, tag)[0];
const nums = (s, d) => (s == null ? d : s.trim().split(/\s+/).map(Number));

// ---------------------------------------------------------------- 3D math
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mm = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const tr = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
function rpyR([r, p, y]) {
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, -sp, cp * sr, cp * cr];
}
const T = (p = [0, 0, 0], R = I3()) => ({ p, R });
const Tmul = (a, b) => T(add3(a.p, mv(a.R, b.p)), mm(a.R, b.R));
const Tapply = (a, v) => add3(a.p, mv(a.R, v));
function originT(n) { return n ? T(nums(n.attrs.xyz, [0, 0, 0]), rpyR(nums(n.attrs.rpy, [0, 0, 0]))) : T(); }
function quatOf(R) {
  const t = R[0] + R[4] + R[8]; let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
  const n = Math.hypot(w, x, y, z); return [w / n, x / n, y / n, z / n];
}
const isI = R => Math.abs(R[0] - 1) + Math.abs(R[4] - 1) + Math.abs(R[8] - 1) + Math.abs(R[1]) + Math.abs(R[2]) + Math.abs(R[3]) + Math.abs(R[5]) + Math.abs(R[6]) + Math.abs(R[7]) < 1e-12;
const f = (x, d = 6) => { const s = (+x).toFixed(d).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
const fv = (v, d) => v.map(x => f(x, d)).join(' ');

// Jacobi eigen decomposition of a symmetric 3x3 matrix (row-major).
function eigSym(A) {
  const a = A.slice(), V = I3();
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[3 * p + q]; if (Math.abs(apq) < 1e-300) continue;
      const th = (a[3 * q + q] - a[3 * p + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      const J = I3(); J[3 * p + p] = c; J[3 * q + q] = c; J[3 * p + q] = s; J[3 * q + p] = -s;
      const r = mm(mm(tr(J), a), J); for (let i = 0; i < 9; i++) a[i] = r[i];
      const v = mm(V, J); for (let i = 0; i < 9; i++) V[i] = v[i];
    }
  }
  return { val: [a[0], a[4], a[8]], vec: V };   // columns of vec are eigenvectors
}

// ---------------------------------------------------------------- OBJ + mesh
export function parseOBJ(text, scale = [1, 1, 1]) {
  const P = [], tri = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const t = line.trim().split(/\s+/); P.push(+t[1] * scale[0], +t[2] * scale[1], +t[3] * scale[2]); }
    else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map(t => { const i = parseInt(t, 10); return i < 0 ? P.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) tri.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  return { pos: Float64Array.from(P), tri: Int32Array.from(tri) };
}

// Merge vertices on a 1 um grid. Delete degenerate and repeated triangles.
export function weld({ pos, tri }) {
  const map = new Map(), P = [], remap = new Int32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = Math.round(pos[3 * i] * 1e6) + ',' + Math.round(pos[3 * i + 1] * 1e6) + ',' + Math.round(pos[3 * i + 2] * 1e6);
    let j = map.get(k); if (j === undefined) { j = P.length / 3; map.set(k, j); P.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); }
    remap[i] = j;
  }
  const seen = new Set(), out = [];
  for (let t = 0; t < tri.length; t += 3) {
    const a = remap[tri[t]], b = remap[tri[t + 1]], c = remap[tri[t + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) continue; seen.add(s); out.push(a, b, c);
  }
  return { pos: Float64Array.from(P), tri: Int32Array.from(out) };
}

// Quadric edge collapse. Collapses edges in order of error until the mesh
// has at most `target` triangles AND the next error is above `freeErr`.
// The error is the sum of squared distances (metres) to the original face
// planes, with no area weight, so it is never less than the largest one. Rejects a collapse that
// flips a triangle or breaks the link condition (keeps thin parts closed).
export function decimate(mesh, target, freeErr = FREE_ERR) {
  const nv = mesh.pos.length / 3, nf = mesh.tri.length / 3;
  const V = Float64Array.from(mesh.pos), F = Int32Array.from(mesh.tri);
  const fAlive = new Uint8Array(nf).fill(1), vAlive = new Uint8Array(nv).fill(1), stamp = new Int32Array(nv);
  const adj = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nf; t++) for (let k = 0; k < 3; k++) adj[F[3 * t + k]].push(t);
  const Q = new Float64Array(11 * nv);   // 10 quadric terms + weight
  const addQ = (v, a, b, c, d, w) => {
    const o = 11 * v;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d; Q[o + 10] += w;
  };
  const vp = i => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
  const fnorm = (a, b, c) => cross3(sub3(b, a), sub3(c, a));
  const edgeFaces = new Map();
  for (let t = 0; t < nf; t++) {
    const ia = F[3 * t], ib = F[3 * t + 1], ic = F[3 * t + 2];
    const n = fnorm(vp(ia), vp(ib), vp(ic)), L = len3(n); if (L < 1e-20) continue;
    const u = [n[0] / L, n[1] / L, n[2] / L], d = -dot3(u, vp(ia)), w = 1;
    for (const v of [ia, ib, ic]) addQ(v, u[0], u[1], u[2], d, w);
    for (const [x, y] of [[ia, ib], [ib, ic], [ic, ia]]) { const k = x < y ? x * nv + y : y * nv + x; edgeFaces.set(k, (edgeFaces.get(k) || 0) + 1); }
  }
  // boundary edges: a plane through the edge, normal to the face, heavy weight
  for (let t = 0; t < nf; t++) {
    const ids = [F[3 * t], F[3 * t + 1], F[3 * t + 2]], n = fnorm(vp(ids[0]), vp(ids[1]), vp(ids[2]));
    for (let k = 0; k < 3; k++) {
      const x = ids[k], y = ids[(k + 1) % 3], key = x < y ? x * nv + y : y * nv + x;
      if (edgeFaces.get(key) !== 1) continue;
      const e = sub3(vp(y), vp(x)), p = cross3(e, n), L = len3(p); if (L < 1e-20) continue;
      const u = [p[0] / L, p[1] / L, p[2] / L], d = -dot3(u, vp(x)), w = 4;
      addQ(x, u[0], u[1], u[2], d, w); addQ(y, u[0], u[1], u[2], d, w);
    }
  }
  const qerr = (q, x) => {
    const [X, Y, Z] = x;
    return q[0] * X * X + 2 * q[1] * X * Y + 2 * q[2] * X * Z + 2 * q[3] * X + q[4] * Y * Y + 2 * q[5] * Y * Z + 2 * q[6] * Y + q[7] * Z * Z + 2 * q[8] * Z + q[9];
  };
  const cost = (u, v) => {
    const q = new Array(11); for (let i = 0; i < 11; i++) q[i] = Q[11 * u + i] + Q[11 * v + i];
    const pu = vp(u), pv = vp(v), mid = [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2, (pu[2] + pv[2]) / 2];
    const cands = [pu, pv, mid];
    const a = q[0], b = q[1], c = q[2], d = q[4], e = q[5], g = q[7];
    const det = a * (d * g - e * e) - b * (b * g - e * c) + c * (b * e - d * c);
    const el = len3(sub3(pu, pv));
    if (Math.abs(det) > 1e-12 * Math.pow(a + d + g, 3)) {
      const r = [-q[3], -q[6], -q[8]];
      const x = [
        (r[0] * (d * g - e * e) - b * (r[1] * g - e * r[2]) + c * (r[1] * e - d * r[2])) / det,
        (a * (r[1] * g - e * r[2]) - r[0] * (b * g - e * c) + c * (b * r[2] - r[1] * c)) / det,
        (a * (d * r[2] - r[1] * e) - b * (b * r[2] - r[1] * c) + r[0] * (b * e - d * c)) / det,
      ];
      if (len3(sub3(x, mid)) < el) cands.unshift(x);
    }
    let best = null, be = Infinity;
    for (const x of cands) { const er = qerr(q, x); if (er < be - 1e-30) { be = er; best = x; } }
    return { err: Math.max(0, be), x: best };
  };
  // binary heap of [err, u, v, su, sv, x]
  const H = [];
  const push = it => { H.push(it); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return top; };
  const pushEdge = (u, v) => { const c = cost(u, v); push([c.err, u, v, stamp[u], stamp[v], c.x]); };
  for (const key of edgeFaces.keys()) pushEdge(Math.floor(key / nv), key % nv);
  const nbrs = v => { const s = new Set(); for (const t of adj[v]) if (fAlive[t]) for (let k = 0; k < 3; k++) { const w = F[3 * t + k]; if (w !== v) s.add(w); } return s; };
  let live = 0; for (let t = 0; t < nf; t++) live += fAlive[t];
  const freeE2 = freeErr * freeErr;
  while (H.length) {
    const [err, u, v, su, sv, x] = pop();
    if (!vAlive[u] || !vAlive[v] || stamp[u] !== su || stamp[v] !== sv) continue;
    if (live <= target && err > freeE2) break;
    // link condition
    const nu = nbrs(u), nvv = nbrs(v); if (!nu.has(v)) continue;
    let shared = 0; for (const w of nu) if (nvv.has(w)) shared++;
    let both = 0; for (const t of adj[u]) if (fAlive[t] && (F[3 * t] === v || F[3 * t + 1] === v || F[3 * t + 2] === v)) both++;
    if (shared !== both) continue;
    // flip test
    let bad = false;
    for (const [w0, list] of [[u, adj[u]], [v, adj[v]]]) {
      for (const t of list) {
        if (!fAlive[t]) continue;
        const ids = [F[3 * t], F[3 * t + 1], F[3 * t + 2]];
        if (ids.includes(u) && ids.includes(v)) continue;
        const P0 = ids.map(vp), P1 = ids.map(i => (i === w0 ? x : vp(i)));
        const n0 = fnorm(...P0), n1 = fnorm(...P1), l0 = len3(n0), l1 = len3(n1);
        if (l1 < 1e-14 || dot3(n0, n1) < 0.2 * l0 * l1) { bad = true; break; }
      }
      if (bad) break;
    }
    if (bad) continue;
    // collapse v into u
    V[3 * u] = x[0]; V[3 * u + 1] = x[1]; V[3 * u + 2] = x[2];
    for (let i = 0; i < 11; i++) Q[11 * u + i] += Q[11 * v + i];
    for (const t of adj[v]) {
      if (!fAlive[t]) continue;
      const o = 3 * t;
      if (F[o] === u || F[o + 1] === u || F[o + 2] === u) { fAlive[t] = 0; live--; continue; }
      for (let k = 0; k < 3; k++) if (F[o + k] === v) F[o + k] = u;
      adj[u].push(t);
    }
    vAlive[v] = 0; adj[v] = []; stamp[u]++;
    adj[u] = adj[u].filter(t => fAlive[t]);
    for (const w of nbrs(u)) pushEdge(u, w);
  }
  // compact
  const idx = new Int32Array(nv).fill(-1), P = [], out = [];
  for (let t = 0; t < nf; t++) {
    if (!fAlive[t]) continue;
    for (let k = 0; k < 3; k++) { const i = F[3 * t + k]; if (idx[i] < 0) { idx[i] = P.length / 3; P.push(V[3 * i], V[3 * i + 1], V[3 * i + 2]); } out.push(idx[i]); }
  }
  return { pos: Float64Array.from(P), tri: Int32Array.from(out) };
}

export function stlBytes(mesh) {
  const n = mesh.tri.length / 3, buf = Buffer.alloc(84 + 50 * n);
  buf.write('articraft playground binary stl', 0, 'ascii'); buf.writeUInt32LE(n, 80);
  const p = i => [mesh.pos[3 * i], mesh.pos[3 * i + 1], mesh.pos[3 * i + 2]];
  for (let t = 0; t < n; t++) {
    const a = p(mesh.tri[3 * t]), b = p(mesh.tri[3 * t + 1]), c = p(mesh.tri[3 * t + 2]);
    const nn = cross3(sub3(b, a), sub3(c, a)), L = len3(nn) || 1, o = 84 + 50 * t;
    [nn[0] / L, nn[1] / L, nn[2] / L, ...a, ...b, ...c].forEach((x, k) => buf.writeFloatLE(x, o + 4 * k));
    buf.writeUInt16LE(0, o + 48);
  }
  return buf;
}

// ---------------------------------------------------------------- inertia
// Make the inertia positive definite and make A + B >= C hold, as MuJoCo
// requires. Small values go up to a floor scaled to the mass.
export function fixInertia(I, mass) {
  const { val, vec } = eigSym(I);
  const floor = Math.max(1e-9, mass * 1e-6);
  const v = val.map(x => Math.max(x, floor));
  for (let k = 0; k < 3; k++) { const a = v[(k + 1) % 3], b = v[(k + 2) % 3]; if (v[k] > a + b) v[k] = (a + b) * 0.999; }
  const D = [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];
  return mm(mm(vec, D), tr(vec));
}

// ---------------------------------------------------------------- URDF tree
function linkInertial(link) {
  const n = kid(link, 'inertial'); if (!n) return null;
  const mass = +(kid(n, 'mass')?.attrs.value ?? 0); if (!(mass > 0)) return null;
  const o = originT(kid(n, 'origin')), a = kid(n, 'inertia')?.attrs || {};
  const g = k => +(a[k] ?? 0);
  const Iloc = [g('ixx'), g('ixy'), g('ixz'), g('ixy'), g('iyy'), g('iyz'), g('ixz'), g('iyz'), g('izz')];
  return { mass, com: o.p, I: mm(mm(o.R, Iloc), tr(o.R)) };
}

// bodies: { name, link, parent, Tparent, joint, geoms[], inert[], children[] }
export function buildTree(urdf, urdfDir) {
  const mats = {};
  for (const m of kids(urdf, 'material')) { const c = kid(m, 'color'); if (c) mats[m.attrs.name] = nums(c.attrs.rgba); }
  const links = Object.fromEntries(kids(urdf, 'link').map(l => [l.attrs.name, l]));
  const joints = kids(urdf, 'joint');
  const childOf = new Set(joints.map(j => kid(j, 'child').attrs.link));
  const roots = Object.keys(links).filter(n => !childOf.has(n));
  if (roots.length !== 1) throw new Error('URDF has ' + roots.length + ' root links');
  const byParent = {};
  for (const j of joints) (byParent[kid(j, 'parent').attrs.link] ||= []).push(j);
  const bodies = [];
  const geomsOf = (link, Tacc) => kids(link, 'visual').map(vis => {
    const Tg = Tmul(Tacc, originT(kid(vis, 'origin'))), g = kid(vis, 'geometry'), m = kid(vis, 'material');
    let rgba = [0.7, 0.7, 0.72, 1];
    if (m) { const c = kid(m, 'color'); if (c) rgba = nums(c.attrs.rgba); else if (mats[m.attrs.name]) rgba = mats[m.attrs.name]; }
    const mesh = kid(g, 'mesh'), box = kid(g, 'box'), cyl = kid(g, 'cylinder'), sph = kid(g, 'sphere');
    if (mesh) return { type: 'mesh', file: path.resolve(urdfDir, mesh.attrs.filename.replace(/^package:\/\//, '')), scale: nums(mesh.attrs.scale, [1, 1, 1]), T: Tg, rgba };
    if (box) return { type: 'box', size: nums(box.attrs.size).map(x => x / 2), T: Tg, rgba };
    if (cyl) return { type: 'cylinder', size: [+cyl.attrs.radius, +cyl.attrs.length / 2], T: Tg, rgba };
    if (sph) return { type: 'sphere', size: [+sph.attrs.radius], T: Tg, rgba };
    return null;
  }).filter(Boolean);
  const visit = (linkName, body, Tacc) => {
    const link = links[linkName];
    body.geoms.push(...geomsOf(link, Tacc).map(g => Object.assign(g, { link: linkName })));
    const ine = linkInertial(link);
    body.inert.push(ine ? { mass: ine.mass, com: Tapply(Tacc, ine.com), I: mm(mm(Tacc.R, ine.I), tr(Tacc.R)) } : { mass: 0, fallback: true, link: linkName, Tacc });
    for (const j of byParent[linkName] || []) {
      const type = j.attrs.type, child = kid(j, 'child').attrs.link, Tj = Tmul(Tacc, originT(kid(j, 'origin')));
      if (type === 'fixed' || type === 'floating' || type === 'planar') { visit(child, body, Tj); continue; }
      const lim = kid(j, 'limit')?.attrs || {}, mim = kid(j, 'mimic')?.attrs;
      let axis = nums(kid(j, 'axis')?.attrs.xyz, [1, 0, 0]); const al = len3(axis) || 1; axis = axis.map(x => x / al);
      const jt = {
        name: j.attrs.name, type: type === 'prismatic' ? 'slide' : 'hinge', axis,
        range: type === 'continuous' ? null : [+(lim.lower ?? 0), +(lim.upper ?? 0)],
        mimic: mim ? { joint: mim.joint, multiplier: +(mim.multiplier ?? 1), offset: +(mim.offset ?? 0) } : null,
      };
      if (jt.range && !(jt.range[1] > jt.range[0])) jt.range = null;   // URDF with no usable limit
      if (jt.range == null && jt.type === 'slide') jt.range = [-0.1, 0.1];
      const nb = { name: child, parent: body, Tparent: Tj, joint: jt, geoms: [], inert: [], children: [] };
      body.children.push(nb); bodies.push(nb);
      visit(child, nb, T());
    }
  };
  const root = { name: 'root', link: roots[0], parent: null, Tparent: T(), joint: null, geoms: [], inert: [], children: [] };
  bodies.unshift(root);
  visit(roots[0], root, T());
  return bodies;
}

// ---------------------------------------------------------------- convert
const sanitize = s => s.replace(/[^A-Za-z0-9_]/g, '_');

function meshPointsBody(g, meshes) {
  if (g.type === 'mesh') { const m = meshes[g.meshName]; const out = []; for (let i = 0; i < m.pos.length; i += 3) out.push(Tapply(g.T, [m.pos[i], m.pos[i + 1], m.pos[i + 2]])); return out; }
  const s = g.size, pts = [];
  if (g.type === 'box') { for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) pts.push(Tapply(g.T, [a * s[0], b * s[1], c * s[2]])); }
  else if (g.type === 'cylinder') { for (let k = 0; k < 16; k++) { const t = k * Math.PI / 8; for (const z of [-s[1], s[1]]) pts.push(Tapply(g.T, [s[0] * Math.cos(t), s[0] * Math.sin(t), z])); } }
  else { for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) pts.push(Tapply(g.T, d.map(x => x * s[0]))); }
  return pts;
}

// Mass properties of a solid, density 1, in its own frame:
// { vol, com, I (3x3 about com) }, or null when the mesh is open or vol <= 0.
export function meshMassProps(mesh) {
  const ec = new Map(), P = mesh.pos, F = mesh.tri;
  for (let t = 0; t < F.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = F[t + k], b = F[t + (k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a;
    ec.set(key, (ec.get(key) || 0) + 1);
  }
  for (const c of ec.values()) if (c !== 2) return null;
  let V = 0; const s1 = [0, 0, 0], C = new Array(9).fill(0);
  for (let t = 0; t < F.length; t += 3) {
    const v = [0, 1, 2].map(k => [P[3 * F[t + k]], P[3 * F[t + k] + 1], P[3 * F[t + k] + 2]]);
    const vol = dot3(v[0], cross3(v[1], v[2])) / 6, sm = add3(add3(v[0], v[1]), v[2]);
    V += vol; for (let k = 0; k < 3; k++) s1[k] += vol * sm[k] / 4;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      C[3 * i + j] += vol / 20 * (v[0][i] * v[0][j] + v[1][i] * v[1][j] + v[2][i] * v[2][j] + sm[i] * sm[j]);
  }
  if (!(V > 1e-12)) return null;
  const com = s1.map(x => x / V), I = new Array(9);
  for (let i = 0; i < 9; i++) C[i] -= V * com[Math.floor(i / 3)] * com[i % 3];
  const tr = C[0] + C[4] + C[8];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[3 * i + j] = (i === j ? tr : 0) - C[3 * i + j];
  return { vol: V, com, I };
}

// Convex hull mass properties, density 1, from MuJoCo (mesh inertia="convex").
function hullMassProps(mj, mesh) {
  const xml = '<mujoco><compiler meshdir="m"/><asset><mesh name="h" file="h.stl" inertia="convex"/></asset>' +
    '<worldbody><body><freejoint/><geom type="mesh" mesh="h" density="1"/></body></worldbody></mujoco>';
  let S;
  try { S = createSim(mj, { xml, files: { 'm/h.stl': new Uint8Array(stlBytes(mesh)) } }); }
  catch (e) { return null; }
  try {
    const m = S.m, vol = m.body_mass[1]; if (!(vol > 0)) return null;
    const q = [m.body_iquat[4], m.body_iquat[5], m.body_iquat[6], m.body_iquat[7]];
    const [w, x, y, z] = q, R = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    const D = [m.body_inertia[3], 0, 0, 0, m.body_inertia[4], 0, 0, 0, m.body_inertia[5]];
    return { vol, com: [m.body_ipos[3], m.body_ipos[4], m.body_ipos[5]], I: mm(mm(R, D), tr(R)) };
  } finally { S.dispose(); }
}

// Mass properties of one geom in the body frame, at DENSITY.
function geomMass(g, meshes, mj, cache) {
  let p;
  if (g.type === 'mesh') {
    if (!cache.has(g.meshName)) { const mesh = meshes[g.meshName]; cache.set(g.meshName, meshMassProps(mesh) || hullMassProps(mj, mesh)); }
    p = cache.get(g.meshName);
  } else {
    const s = g.size;
    if (g.type === 'box') { const v = 8 * s[0] * s[1] * s[2]; p = { vol: v, com: [0, 0, 0], I: [v / 3 * (s[1] ** 2 + s[2] ** 2), 0, 0, 0, v / 3 * (s[0] ** 2 + s[2] ** 2), 0, 0, 0, v / 3 * (s[0] ** 2 + s[1] ** 2)] }; }
    else if (g.type === 'cylinder') { const v = Math.PI * s[0] ** 2 * 2 * s[1], a = v * (3 * s[0] ** 2 + 4 * s[1] ** 2) / 12; p = { vol: v, com: [0, 0, 0], I: [a, 0, 0, 0, a, 0, 0, 0, v * s[0] ** 2 / 2] }; }
    else { const v = 4 / 3 * Math.PI * s[0] ** 3, a = 0.4 * v * s[0] ** 2; p = { vol: v, com: [0, 0, 0], I: [a, 0, 0, 0, a, 0, 0, 0, a] }; }
  }
  if (!p) return null;
  const R = g.T.R;
  return { mass: DENSITY * p.vol, com: Tapply(g.T, p.com), I: mm(mm(R, p.I.map(x => x * DENSITY)), tr(R)) };
}

function combine(parts) {
  const M = parts.reduce((s, p) => s + p.mass, 0);
  const C = [0, 1, 2].map(k => parts.reduce((s, p) => s + p.mass * p.com[k], 0) / M);
  const I = new Array(9).fill(0);
  for (const p of parts) {
    const d = sub3(p.com, C), dd = dot3(d, d);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[3 * i + j] += p.I[3 * i + j] + p.mass * ((i === j ? dd : 0) - d[i] * d[j]);
  }
  return { mass: M, com: C, I };
}

function bodyInertial(b, meshes, mj, cache) {
  const parts = b.inert.map(p => {
    if (!p.fallback) return p;
    // a link with no URDF inertial: mesh volume x DENSITY, clamped to MASS_RANGE
    const gm = b.geoms.filter(g => g.link === p.link).map(g => geomMass(g, meshes, mj, cache)).filter(Boolean);
    if (!gm.length) { const m0 = MASS_RANGE[0]; return { mass: m0, com: p.Tacc.p, I: [1e-6, 0, 0, 0, 1e-6, 0, 0, 0, 1e-6].map(x => x * m0 / 0.05) }; }
    const c = combine(gm), k = Math.min(MASS_RANGE[1], Math.max(MASS_RANGE[0], c.mass)) / c.mass;
    return { mass: c.mass * k, com: c.com, I: c.I.map(x => x * k) };
  });
  const M = parts.reduce((s, p) => s + p.mass, 0);
  const C = [0, 1, 2].map(k => parts.reduce((s, p) => s + p.mass * p.com[k], 0) / M);
  const I = new Array(9).fill(0);
  for (const p of parts) {
    const d = sub3(p.com, C), dd = dot3(d, d);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[3 * i + j] += p.I[3 * i + j] + p.mass * ((i === j ? dd : 0) - d[i] * d[j]);
  }
  return { mass: M, com: C, I: fixInertia(I, M) };
}

// tuning: { jointName: { kp, damping, armature } }
export function emitXML(name, bodies, meshes, shift, tuning = {}) {
  const L = [];
  L.push(`<mujoco model="${sanitize(name)}">`);
  L.push('  <compiler angle="radian" meshdir="meshes" autolimits="true"/>');
  L.push('  <option timestep="0.002" integrator="implicitfast"/>');
  L.push('  <asset>');
  for (const mn of Object.keys(meshes)) L.push(`    <mesh name="${mn}" file="${mn}.stl"/>`);
  L.push('  </asset>');
  L.push('  <worldbody>');
  const acts = [], eqs = [];
  const emitBody = (b, ind) => {
    const pad = ' '.repeat(ind);
    let tp = b.Tparent;
    if (!b.parent) tp = T(shift, I3());
    const q = quatOf(tp.R);
    L.push(`${pad}<body name="${b.mjName}" pos="${fv(tp.p)}"${isI(tp.R) ? '' : ` quat="${fv(q, 8)}"`}>`);
    const ine = b.inertial, Iv = ine.I;
    L.push(`${pad}  <inertial pos="${fv(ine.com)}" mass="${f(ine.mass, 6)}" fullinertia="${[Iv[0], Iv[4], Iv[8], Iv[1], Iv[2], Iv[5]].map(x => x.toExponential(6)).join(' ')}"/>`);
    if (b.joint) {
      const j = b.joint, tu = tuning[j.name] || { damping: 0.1, armature: 0 };
      L.push(`${pad}  <joint name="${j.mjName}" type="${j.type}" axis="${fv(j.axis, 8)}"${j.range ? ` range="${fv(j.range)}"` : ''} damping="${f(tu.damping, 6)}"${tu.armature > 0 ? ` armature="${f(tu.armature, 8)}"` : ''}/>`);
      if (j.mimic) eqs.push(`    <joint joint1="${j.mjName}" joint2="${sanitize(j.mimic.joint)}" polycoef="${f(j.mimic.offset)} ${f(j.mimic.multiplier)} 0 0 0"/>`);
      else {
        const cr = j.range || [-3.1416, 3.1416];
        acts.push(`    <position name="a_${j.mjName}" joint="${j.mjName}" kp="${f(tu.kp ?? 1, 6)}" ctrlrange="${fv(cr)}"/>`);
      }
    }
    for (const g of b.geoms) {
      const q2 = quatOf(g.T.R), rot = isI(g.T.R) ? '' : ` quat="${fv(q2, 8)}"`, col = fv(g.rgba, 4);
      const shape = g.type === 'mesh' ? `type="mesh" mesh="${g.meshName}"` : `type="${g.type}" size="${fv(g.size)}"`;
      L.push(`${pad}  <geom ${shape} pos="${fv(g.T.p)}"${rot} rgba="${col}" contype="1" conaffinity="2"/>`);
    }
    for (const c of b.children) emitBody(c, ind + 2);
    L.push(`${pad}</body>`);
  };
  emitBody(bodies[0], 4);
  L.push('  </worldbody>');
  if (eqs.length) { L.push('  <equality>'); L.push(...eqs); L.push('  </equality>'); }
  if (acts.length) { L.push('  <actuator>'); L.push(...acts); L.push('  </actuator>'); }
  L.push('</mujoco>');
  return L.join('\n') + '\n';
}

// kp from the joint-space inertia (qM diagonal) and the largest gravity
// torque over a few poses. Critical damping. Armature caps the frequency.
export function tune(mj, xml, files, joints) {
  const S = createSim(mj, { xml, files });
  try {
    const m = S.m, d = S.d, nj = m.njnt, out = {};
    const info = [];
    for (let j = 0; j < nj; j++) {
      const name = S.jointNames[j], dof = m.jnt_dofadr[j], qa = m.jnt_qposadr[j];
      const lim = m.jnt_limited[j] ? [m.jnt_range[2 * j], m.jnt_range[2 * j + 1]] : [-Math.PI, Math.PI];
      info.push({ name, dof, qa, lim, slide: m.jnt_type[j] === 2, I: 0, g: 0 });
    }
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let s = 0; s < 12; s++) {
      for (const it of info) d.qpos[it.qa] = s === 0 ? 0 : s === 1 ? (it.lim[0] + it.lim[1]) / 2 : it.lim[0] + rnd() * (it.lim[1] - it.lim[0]);
      d.qvel.fill(0); mj.mj_forward(m, d);
      for (const it of info) {
        const Ii = d.M[m.M_rowadr[it.dof] + m.M_rownnz[it.dof] - 1];   // CSR row: diagonal is last
        it.I = Math.max(it.I, Ii); it.Imin = Math.min(it.Imin ?? Infinity, Ii);
        it.g = Math.max(it.g, Math.abs(d.qfrc_bias[it.dof]));
      }
    }
    // a mimic joint loads its leader through the equality: add k^2 I and |k| g
    for (const j of joints) if (j.mimic) {
      const f = info.find(x => x.name === j.mjName), l = info.find(x => x.name === sanitize(j.mimic.joint)), k = j.mimic.multiplier;
      if (f && l) { l.I += k * k * f.I; l.Imin += k * k * f.Imin; l.g += Math.abs(k) * f.g; }
    }
    for (const it of info) {
      const span = it.lim[1] - it.lim[0], I = Math.max(it.Imin, 1e-7), tol = Math.min(it.slide ? TOL_SLIDE : TOL_HINGE, 0.05 * span);
      let kp = Math.max(I * W0 * W0, it.g / tol);
      let arm = 0;
      if (kp / I > WMAX * WMAX) arm = kp / (WMAX * WMAX) - I;
      const Ieff = I + arm, Imax = it.I + arm;
      // critical damping at the largest inertia over-damps the light poses a little; that is safe
      const damping = 2 * ZETA * Math.sqrt(kp * Math.max(Ieff, Imax * 0.5));
      out[it.name] = { kp, damping, armature: arm, I, Imax: it.I, g: it.g };
    }
    return out;
  } finally { S.dispose(); }
}

function slugify(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); }

export async function convert(mj, rec, rev, group, outRoot, title, budget = BUDGET_OBJ) {
  const dir = path.join(S, 'data', 'cache', 'record_materialization', rec);
  const urdf = parseXML(fs.readFileSync(path.join(dir, 'model.urdf'), 'utf8'));
  const bodies = buildTree(urdf, dir);
  // names: root body is "root"; no other body name may start with "root"
  const used = new Set(['root']);
  for (const b of bodies) {
    if (!b.parent) { b.mjName = 'root'; continue; }
    let n = sanitize(b.name); if (n.startsWith('root')) n = 'l_' + n;
    while (used.has(n)) n += '_'; used.add(n); b.mjName = n;
    if (b.joint) b.joint.mjName = sanitize(b.joint.name);
  }
  // meshes: load, weld; one STL per OBJ file
  const meshes = {}, byFile = {};
  for (const b of bodies) for (const g of b.geoms) {
    if (g.type !== 'mesh') continue;
    const key = g.file + '|' + g.scale.join(',');
    if (!byFile[key]) {
      let mn = sanitize(path.basename(g.file).replace(/\.obj$/i, '')); while (meshes[mn]) mn += '_';
      const raw = weld(parseOBJ(fs.readFileSync(g.file, 'utf8'), g.scale));
      meshes[mn] = raw; byFile[key] = mn;
    }
    g.meshName = byFile[key];
  }
  // drop meshes with no triangles (and their geoms)
  for (const b of bodies) b.geoms = b.geoms.filter(g => g.type !== 'mesh' || meshes[g.meshName].tri.length >= 12);
  // budget -> triangle targets, in proportion to the triangle counts
  const names = Object.keys(meshes).filter(n => meshes[n].tri.length >= 12);
  for (const n of Object.keys(meshes)) if (!names.includes(n)) delete meshes[n];
  const xmlGuess = 1500 + 400 * bodies.length + 250 * bodies.reduce((s, b) => s + b.geoms.length, 0);
  const triBudget = Math.max(200, Math.floor((budget - xmlGuess - 84 * names.length) / 50));
  const total = names.reduce((s, n) => s + meshes[n].tri.length / 3, 0);
  const before = total;
  for (const n of names) {
    const nt = meshes[n].tri.length / 3;
    const tgt = total > triBudget ? Math.max(16, Math.floor(nt * triBudget / total)) : nt;
    meshes[n] = decimate(meshes[n], tgt);
  }
  const massCache = new Map();
  for (const b of bodies) b.inertial = bodyInertial(b, meshes, mj, massCache);
  // world frame at q = 0: lowest point -> z = 0, bbox centre -> x = y = 0
  const world = new Map(); const pts = [];
  for (const b of bodies) {
    const Tw = b.parent ? Tmul(world.get(b.parent), b.Tparent) : T();
    world.set(b, Tw);
    for (const g of b.geoms) for (const p of meshPointsBody(g, meshes)) pts.push(Tapply(Tw, p));
  }
  if (!pts.length) throw new Error('no geometry');
  const lo = [0, 1, 2].map(k => pts.reduce((m, p) => Math.min(m, p[k]), Infinity)), hi = [0, 1, 2].map(k => pts.reduce((m, p) => Math.max(m, p[k]), -Infinity));
  const shift = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
  const center = [0, 0, (hi[2] - lo[2]) / 2];
  const sp = pts.map(p => add3(p, shift));
  const extent = Math.max(...sp.map(p => len3(sub3(p, center))));
  // STL + XML, then tune with MuJoCo and write the final XML
  const files = {}; for (const n of names) files['meshes/' + n + '.stl'] = new Uint8Array(stlBytes(meshes[n]));
  const xml0 = emitXML(rec, bodies, meshes, shift);
  const joints = bodies.filter(b => b.joint).map(b => b.joint);
  const tuning = tune(mj, xml0, files, joints);
  const xml = emitXML(rec, bodies, meshes, shift, tuning);
  createSim(mj, { xml, files }).dispose();   // the final XML must load
  if (xml.split('<body name="root"').length !== 2) throw new Error('<body name="root" is not unique');
  // write
  const slugDir = path.join(outRoot, title.slug);
  fs.rmSync(slugDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(slugDir, 'meshes'), { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'model.xml'), xml);
  let bytes = Buffer.byteLength(xml);
  for (const k in files) { fs.writeFileSync(path.join(slugDir, k), files[k]); bytes += files[k].length; }
  const after = names.reduce((s, n) => s + meshes[n].tri.length / 3, 0);
  return {
    joints: joints.map(j => ({ name: j.mjName, type: j.type, range: (j.range || [-3.1416, 3.1416]).map(x => +f(x, 4)), act: j.mimic ? null : 'a_' + j.mjName, ...(j.mimic ? { mimic: sanitize(j.mimic.joint) } : {}) })),
    bytes, extent: +extent.toFixed(4), center: center.map(x => +x.toFixed(4)),
    stats: { trisBefore: before, trisAfter: after, bodies: bodies.length, tuning },
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const only = process.argv.slice(2);
  const rows = fs.readFileSync(path.join(TOOLS, 'compiled.tsv'), 'utf8').trim().split('\n').map(l => l.split('\t'));
  const titles = JSON.parse(fs.readFileSync(path.join(TOOLS, 'titles.json'), 'utf8'));
  const sc = JSON.parse(fs.readFileSync(path.join(S, 'data', 'supercategories.json'), 'utf8')).supercategories;
  const recMeta = {};
  for (const line of fs.readFileSync(path.join(S, 'data', 'records_manifest.jsonl'), 'utf8').split('\n')) {
    if (!line) continue; const j = JSON.parse(line); recMeta[j.record_id] = j;
  }
  const outRoot = path.join(DATA, 'objects');
  fs.mkdirSync(outRoot, { recursive: true });
  const manPath = path.join(DATA, 'manifest.json');
  const old = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { objects: [] };
  const keep = new Map(old.objects.map(o => [o.record, o]));
  const mj = await loadMuJoCo();
  const fails = [];
  const slugs = new Set();
  for (const [group, rec, rev] of rows) {
    const t = titles[rec];
    if (!t) { fails.push([rec, 'no title in titles.json']); continue; }
    const slug = slugify(t); if (slugs.has(slug)) { fails.push([rec, 'slug clash ' + slug]); continue; } slugs.add(slug);
    if (only.length && !only.includes(rec)) continue;
    const t0 = Date.now();
    try {
      const r = await convert(mj, rec, rev, group, outRoot, { slug });
      const meta = recMeta[rec];
      const prompt = fs.readFileSync(path.join(S, 'data', 'records', rec, 'revisions', rev, 'prompt.txt'), 'utf8').replace(/\s+$/, '');
      const recJson = JSON.parse(fs.readFileSync(path.join(S, 'data', 'records', rec, 'record.json'), 'utf8'));
      keep.set(rec, {
        slug, title: t, group, category: recJson.category_title || meta.category_title, prompt, record: rec, revision: rev,
        author: recJson.author || meta.author, url: `https://github.com/mattzh72/articraft-data/tree/main/records/${rec}`,
        joints: r.joints, bytes: r.bytes, extent: r.extent, center: r.center,
      });
      const st = r.stats;
      console.log(`ok   ${slug.padEnd(34)} joints ${String(r.joints.length).padStart(2)} tris ${String(st.trisBefore).padStart(6)} -> ${String(st.trisAfter).padStart(5)}  ${(r.bytes / 1024).toFixed(0).padStart(4)} KB  ${Date.now() - t0} ms`);
    } catch (e) {
      fails.push([rec, String(e.message || e).split('\n')[0].slice(0, 160)]);
      if (process.env.DEBUG) console.log(e.stack);
      console.log(`FAIL ${rec}: ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
    }
  }
  // manifest in compiled.tsv order; only rows that have output
  const order = rows.map(r => r[1]).filter(r => keep.has(r) && fs.existsSync(path.join(outRoot, keep.get(r).slug, 'model.xml')));
  const objects = order.map(r => keep.get(r));
  const gids = new Set(objects.map(o => o.group));
  const man = {
    version: 1, generated: new Date().toISOString().slice(0, 10),
    groups: sc.filter(s => gids.has(s.slug)).map(s => ({ id: s.slug, title: s.title })),
    objects,
  };
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1) + '\n');
  // remove object folders that the manifest does not name
  for (const d of fs.readdirSync(outRoot)) if (!objects.some(o => o.slug === d)) fs.rmSync(path.join(outRoot, d), { recursive: true, force: true });
  const totalBytes = objects.reduce((s, o) => s + o.bytes, 0);
  console.log(`manifest: ${objects.length} objects, ${(totalBytes / 1048576).toFixed(2)} MB (budget ${BUDGET_ALL / 1048576} MB)`);
  if (fails.length) { console.log('failed:'); for (const [r, why] of fails) console.log(`  ${r}\t${why}`); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e); process.exit(1); });

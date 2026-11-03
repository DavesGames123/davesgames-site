#!/usr/bin/env node
// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  tools/thumb.mjs — the home thumbnail, no browser
// ----------------------------------------------------------------------------
//  node stella-nova/pages/articraft/tools/thumb.mjs [--slugs a,b,c] [--png out.png]
//       [--out pages/home/thumbs/articraft.jpg] [--manifest data/manifest.json]
//
//  The tool loads 4 to 6 objects from data/objects/<slug>/model.xml with the
//  vendored MuJoCo (../mujoco-lab/core/engine.js), sets each joint to a pose
//  in its range, and reads the posed meshes from mjModel and mjData. A z-buffer
//  software rasteriser draws them on a dark floor with a grid: a key light with
//  a shadow map, a cool fill light and a rim light. The tool writes a PNG
//  (node:zlib) at 2x size, then `magick` makes the 640 x 400 JPEG at q84.
//  No npm packages, no browser.
//
//  The objects get a common size in the picture (each one scaled to the same
//  bounding radius), because real sizes go from a few cm to 2 m.
//
//  GREP MAP
//    function pickObjects ...... the default set: many joints, mixed groups
//    function posedTriangles ... MuJoCo load, pose, mesh and primitive triangles
//    function raster ........... z-buffer, shadow map, shading, floor, grid
//    function writePNG ......... RGB PNG with node:zlib
// ============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, '..');
const SN = resolve(PAGE, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? a.concat([[x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]]) : a), []));
const OUT = resolve(SN, args.out || 'pages/home/thumbs/articraft.jpg');
const PNG = resolve(args.png || join(process.env.TMPDIR || '/tmp', 'articraft-thumb.png'));
const MAN = resolve(PAGE, args.manifest || 'data/manifest.json');
const W = 1280, H = 800;   // 2x of 640 x 400

const { loadMuJoCo, createSim } = await import(pathToFileURL(resolve(PAGE, '../mujoco-lab/core/engine.js')).href);
let poseAt = null;
try { ({ poseAt } = await import(pathToFileURL(resolve(PAGE, 'sim.js')).href)); } catch (e) { /* sim.js not there: own pose */ }

// ---- objects -------------------------------------------------------------------
const man = JSON.parse(readFileSync(MAN, 'utf8'));
const dataDir = dirname(MAN);

const DEFAULT_SET = ['wall-safe', 'hip-knee-ankle-robot-leg', 'retro-stand-mixer', 'tower-arm-with-wrist', 'stair-climbing-hand-truck', 'six-axis-robot-arm'];
function pickObjects(objs, n = 5) {
  if (args.slugs) return String(args.slugs).split(',').map(s => objs.find(o => o.slug === s)).filter(Boolean);
  // the chosen set: clear joints at a glance, mixed groups and colours
  const chosen = DEFAULT_SET.map(s => objs.find(o => o.slug === s)).filter(Boolean);
  if (chosen.length >= 4) return chosen.slice(0, n);
  // many visible joints, not too small a file (detail), one per group first
  const score = o => Math.min(o.joints.length, 6) * 2 + Math.min(1, (o.bytes || 0) / 120000);
  const sorted = objs.filter(o => o.joints && o.joints.length >= 2).sort((a, b) => score(b) - score(a));
  const out = [], groups = new Set();
  for (const o of sorted) if (out.length < n && !groups.has(o.group)) { out.push(o); groups.add(o.group); }
  for (const o of sorted) if (out.length < n && !out.includes(o)) out.push(o);
  return out;
}

// a pose in the range of each joint: away from the rest pose, not at a limit
function ownPose(entry) {
  const p = {};
  entry.joints.forEach((j, i) => {
    const [lo, hi] = j.range && j.range[0] < j.range[1] ? j.range : [-1.2, 1.2];
    const s = [0.68, 0.3, 0.6, 0.38, 0.72, 0.45][i % 6];
    p[j.name] = lo + (hi - lo) * s;
  });
  return p;
}

const mj = await loadMuJoCo();

// MuJoCo geom types
const PLANE = 0, SPHERE = 2, CAPSULE = 3, ELLIPSOID = 4, CYLINDER = 5, BOX = 6, MESH = 7;

// -> { tris: Float32Array(9 * nt) world, nrm: Float32Array(9 * nt), col: Float32Array(3 * nt), lo, hi }
function posedTriangles(entry) {
  const dir = join(dataDir, 'objects', entry.slug);
  const xml = readFileSync(join(dir, 'model.xml'), 'utf8'), files = {};
  const md = join(dir, 'meshes');
  if (existsSync(md)) for (const f of readdirSync(md)) files['meshes/' + f] = new Uint8Array(readFileSync(join(md, f)));
  const S = createSim(mj, { xml, files, name: entry.slug });
  const m = S.m, d = S.d;
  const pose = poseAt ? poseAt(entry, +(args.phase || 0.3)) : ownPose(entry);
  // Put each joint at its pose value, set the position actuators to the same
  // value, then step 1.5 s: the equality constraints move the mimic joints.
  for (const j of entry.joints) {
    const id = S.jointNames.indexOf(j.name); if (id < 0) continue;
    const t = m.jnt_type[id], a = m.jnt_qposadr[id];
    let v = pose[j.name];
    if (!Number.isFinite(v) && j.mimic) v = pose[j.mimic];
    if (!Number.isFinite(v)) continue;
    if (j.range && j.range[0] < j.range[1]) v = Math.min(j.range[1], Math.max(j.range[0], v));
    if (t === 2 || t === 3) d.qpos[a] = v;   // slide, hinge
    if (j.act) S.setCtrl(j.act, v);
  }
  S.forward();
  S.step(Math.round(1.5 / m.opt.timestep));
  const T = [], N = [], C = [];
  const gx = d.geom_xpos, gm = d.geom_xmat;
  const push = (g, a, b, c, na, nb, nc, col) => {
    const R = gm.subarray(9 * g, 9 * g + 9), p = gx.subarray(3 * g, 3 * g + 3);
    for (const [v, n] of [[a, na], [b, nb], [c, nc]]) {
      T.push(p[0] + R[0] * v[0] + R[1] * v[1] + R[2] * v[2], p[1] + R[3] * v[0] + R[4] * v[1] + R[5] * v[2], p[2] + R[6] * v[0] + R[7] * v[1] + R[8] * v[2]);
      N.push(R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]);
    }
    C.push(col[0], col[1], col[2]);
  };
  for (let g = 0; g < m.ngeom; g++) {
    if (m.geom_bodyid[g] === 0) continue;   // world geoms (none in model.xml)
    const ty = m.geom_type[g], sz = m.geom_size.subarray(3 * g, 3 * g + 3);
    if (m.geom_rgba[4 * g + 3] < 0.05) continue;
    let col = [m.geom_rgba[4 * g], m.geom_rgba[4 * g + 1], m.geom_rgba[4 * g + 2]];
    const mat = m.geom_matid[g];
    if (mat >= 0) col = [m.mat_rgba[4 * mat], m.mat_rgba[4 * mat + 1], m.mat_rgba[4 * mat + 2]];
    if (ty === MESH) {
      const mi = m.geom_dataid[g], va = m.mesh_vertadr[mi], fa = m.mesh_faceadr[mi], nf = m.mesh_facenum[mi];
      const V = m.mesh_vert, F = m.mesh_face;
      const na = m.mesh_normaladr ? m.mesh_normaladr[mi] : -1, NN = m.mesh_normal, FN = m.mesh_facenormal;
      const hasN = na >= 0 && FN && FN.length >= 3 * (fa + nf);
      for (let f = 0; f < nf; f++) {
        const vs = [0, 1, 2].map(k => { const vi = va + F[3 * (fa + f) + k]; return [V[3 * vi], V[3 * vi + 1], V[3 * vi + 2]]; });
        const u = sub(vs[1], vs[0]), w = sub(vs[2], vs[0]), fnm = norm(cross(u, w));
        let ns;
        if (hasN) {
          ns = [0, 1, 2].map(k => { const ni = na + FN[3 * (fa + f) + k]; return [NN[3 * ni], NN[3 * ni + 1], NN[3 * ni + 2]]; });
          // a vertex normal far from the face normal is a crease: use the face normal
          ns = ns.map(n => (dot(n, fnm) < 0.5 ? fnm : n));
        } else ns = [fnm, fnm, fnm];
        push(g, vs[0], vs[1], vs[2], ns[0], ns[1], ns[2], col);
      }
    } else if (ty !== PLANE) {
      for (const [a, b, c, na, nb, nc] of primitive(ty, sz)) push(g, a, b, c, na, nb, nc, col);
    }
  }
  S.dispose();
  const tris = Float32Array.from(T), nrm = Float32Array.from(N), cols = Float32Array.from(C);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]); }
  return { tris, nrm, col: cols, lo, hi, entry };
}

// tessellated primitives in the geom frame: [a, b, c, na, nb, nc]
function primitive(ty, sz) {
  const out = [], U = 24, Vn = 12;
  const quad = (p, q, r, s, np, nq, nr, ns) => { out.push([p, q, r, np, nq, nr]); out.push([p, r, s, np, nr, ns]); };
  if (ty === BOX) {
    const [x, y, z] = sz;
    const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    for (const [n, u, v] of faces) {
      const P = (a, b) => [0, 1, 2].map(k => (n[k] + a * u[k] + b * v[k]) * sz[k]);
      quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), n, n, n, n);
    }
    void x; void y; void z;
  } else if (ty === SPHERE || ty === ELLIPSOID) {
    const r = ty === SPHERE ? [sz[0], sz[0], sz[0]] : sz;
    const P = (i, j) => { const th = Math.PI * j / Vn, ph = 2 * Math.PI * i / U; return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; };
    for (let i = 0; i < U; i++) for (let j = 0; j < Vn; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1), s = v => v.map((x, k) => x * r[k]);
      quad(s(a), s(d), s(c), s(b), a, d, c, b);
    }
  } else if (ty === CYLINDER || ty === CAPSULE) {
    const r = sz[0], h = sz[1];
    for (let i = 0; i < U; i++) {
      const a0 = 2 * Math.PI * i / U, a1 = 2 * Math.PI * (i + 1) / U;
      const c0 = [Math.cos(a0), Math.sin(a0), 0], c1 = [Math.cos(a1), Math.sin(a1), 0];
      quad([r * c0[0], r * c0[1], -h], [r * c1[0], r * c1[1], -h], [r * c1[0], r * c1[1], h], [r * c0[0], r * c0[1], h], c0, c1, c1, c0);
      if (ty === CYLINDER) {
        out.push([[0, 0, h], [r * c0[0], r * c0[1], h], [r * c1[0], r * c1[1], h], [0, 0, 1], [0, 0, 1], [0, 0, 1]]);
        out.push([[0, 0, -h], [r * c1[0], r * c1[1], -h], [r * c0[0], r * c0[1], -h], [0, 0, -1], [0, 0, -1], [0, 0, -1]]);
      }
    }
    if (ty === CAPSULE) for (const sgn of [1, -1]) for (let i = 0; i < U; i++) for (let j = 0; j < Vn / 2; j++) {
      const P = (ii, jj) => { const th = Math.PI / 2 * jj / (Vn / 2), ph = 2 * Math.PI * ii / U; return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), sgn * Math.cos(th)]; };
      const s = v => [v[0] * r, v[1] * r, v[2] * r + sgn * h];
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      quad(s(a), s(b), s(c), s(d), a, b, c, d);
    }
  }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---- scene layout ----------------------------------------------------------------
const picked = pickObjects(man.objects, Math.max(4, Math.min(6, +args.n || 5)));
if (picked.length < 1) { console.error('no objects'); process.exit(1); }
const parts = picked.map(posedTriangles);
// place: each object scaled to radius RAD, on a gentle arc, the middle one at the back
const RAD = 0.5, n = parts.length;
const SP = +(args.spread || 0.8);
const slots = (n === 4 ? [[-1.3, 0.3], [-0.45, -0.35], [0.45, 0.4], [1.3, -0.25]]
  : n === 5 ? [[-1.6, 0.25], [-0.8, -0.45], [0, 0.5], [0.8, -0.45], [1.6, 0.25]]
  : [[-1.9, 0.3], [-1.15, -0.45], [-0.4, 0.5], [0.4, -0.45], [1.15, 0.5], [1.9, -0.3]]).map(([x, y]) => [x * SP, y * SP]);
let allT = 0;
for (let i = 0; i < n; i++) {
  const P = parts[i], c = [(P.lo[0] + P.hi[0]) / 2, (P.lo[1] + P.hi[1]) / 2, P.lo[2]];
  const r = Math.max(1e-3, Math.hypot(P.hi[0] - P.lo[0], P.hi[1] - P.lo[1], P.hi[2] - P.lo[2]) / 2);
  const s = RAD / r * (args.equal ? 1 : 1), [ox, oy] = slots[i];
  for (let k = 0; k < P.tris.length; k += 3) {
    P.tris[k] = (P.tris[k] - c[0]) * s + ox; P.tris[k + 1] = (P.tris[k + 1] - c[1]) * s + oy; P.tris[k + 2] = (P.tris[k + 2] - c[2]) * s;
  }
  allT += P.tris.length / 9;
  console.log(`${P.entry.slug.padEnd(36)} ${String(P.tris.length / 9).padStart(6)} tris  ${P.entry.joints.length} joints  r ${r.toFixed(3)} m  x${s.toFixed(2)}`);
}

// ---- raster ----------------------------------------------------------------------
const cam = fitCamera(parts, norm([args.dx ? +args.dx : 0.16, -1, args.dz ? +args.dz : -0.34]), 34, +(args.fill || 0.9));
const KEY = norm([-0.55, -0.35, -0.76]);   // light travel direction (from the key light)
const FILL = norm([0.7, -0.4, -0.3]), RIM = norm([0.2, 0.9, -0.35]);
const img = raster(parts, cam);
writePNG(PNG, img, W, H);
mkdirSync(dirname(OUT), { recursive: true });
execFileSync('magick', [PNG, '-filter', 'Lanczos', '-resize', '640x400!', '-strip', '-quality', '84', '-sampling-factor', '4:2:0', OUT]);
console.log(`${n} objects, ${allT} triangles -> ${PNG} -> ${OUT}`);

// Fit the camera to the posed objects: look along -dir at the centre of their
// box, then find the distance where the projected box fills `fill` of the frame.
function fitCamera(parts, dir, fov, fill) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const P of parts) for (let i = 0; i < P.tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P.tris[i + k]); hi[k] = Math.max(hi[k], P.tris[i + k]); }
  const at = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const tanH = Math.tan(fov * Math.PI / 360), asp = W / H;
  const fits = dist => {
    const eye = [at[0] - dir[0] * dist, at[1] - dir[1] * dist, at[2] - dir[2] * dist];
    const f = norm(sub(at, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
    let mx = 0, my = 0, y0 = Infinity, y1 = -Infinity;
    for (const P of parts) for (let i = 0; i < P.tris.length; i += 3) {
      const q = [P.tris[i] - eye[0], P.tris[i + 1] - eye[1], P.tris[i + 2] - eye[2]], z = dot(q, f);
      if (z < 0.05) return { ok: false };
      const x = dot(q, r) / (z * tanH * asp), y = dot(q, u) / (z * tanH);
      mx = Math.max(mx, Math.abs(x)); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    my = Math.max(Math.abs(y0), Math.abs(y1));
    return { ok: mx <= fill && my <= fill, eye, y0, y1 };
  };
  let a = 0.5, b = 60;
  for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (fits(m).ok) b = m; else a = m; }
  const res = fits(b);
  // centre the box vertically: move the look-at point along the camera up axis
  const f = norm(sub(at, res.eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  const off = (res.y0 + res.y1) / 2 * b * tanH;
  const at2 = [at[0] + u[0] * off, at[1] + u[1] * off, at[2] + u[2] * off];
  const eye2 = [res.eye[0] + u[0] * off, res.eye[1] + u[1] * off, res.eye[2] + u[2] * off];
  return { eye: eye2, at: at2, fov };
}

function raster(parts, cam) {
  const f = norm(sub(cam.at, cam.eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  const tanH = Math.tan(cam.fov * Math.PI / 360), asp = W / H;
  const zb = new Float32Array(W * H).fill(Infinity);
  const nb = new Float32Array(W * H * 3), pb = new Float32Array(W * H * 3), cb = new Float32Array(W * H * 3);
  // shadow map: orthographic along KEY
  const SM = 2048, lr = norm(cross(KEY, [0, 0, 1])), lu = cross(lr, KEY);
  const ext = 3.6, sz = new Float32Array(SM * SM).fill(Infinity);
  const toS = p => [((dot(p, lr) / ext) * 0.5 + 0.5) * SM, ((dot(p, lu) / ext) * 0.5 + 0.5) * SM, dot(p, KEY)];
  for (const P of parts) {
    const T = P.tris;
    for (let i = 0; i < T.length; i += 9) {
      const a = toS([T[i], T[i + 1], T[i + 2]]), b = toS([T[i + 3], T[i + 4], T[i + 5]]), c = toS([T[i + 6], T[i + 7], T[i + 8]]);
      tri2(a, b, c, SM, SM, (x, y, w0, w1, w2) => { const z = w0 * a[2] + w1 * b[2] + w2 * c[2], o = y * SM + x; if (z < sz[o]) sz[o] = z; });
    }
  }
  const shadow = p => {
    const s = toS(p); let lit = 0, cnt = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = Math.floor(s[0]) + dx, y = Math.floor(s[1]) + dy; cnt++;
      if (x < 0 || y < 0 || x >= SM || y >= SM) { lit++; continue; }
      if (s[2] <= sz[y * SM + x] + 0.012) lit++;
    }
    return lit / cnt;
  };
  // camera raster
  const toC = p => { const q = sub(p, cam.eye), z = dot(q, f); return [(dot(q, r) / (z * tanH * asp) * 0.5 + 0.5) * W, (0.5 - dot(q, u) / (z * tanH) * 0.5) * H, z]; };
  for (const P of parts) {
    const T = P.tris, N = P.nrm, C = P.col;
    for (let i = 0, t = 0; i < T.length; i += 9, t++) {
      const pa = [T[i], T[i + 1], T[i + 2]], pb2 = [T[i + 3], T[i + 4], T[i + 5]], pc = [T[i + 6], T[i + 7], T[i + 8]];
      const a = toC(pa), b = toC(pb2), c = toC(pc);
      if (a[2] < 0.05 || b[2] < 0.05 || c[2] < 0.05) continue;
      tri2(a, b, c, W, H, (x, y, w0, w1, w2) => {
        // perspective-correct weights
        const q0 = w0 / a[2], q1 = w1 / b[2], q2 = w2 / c[2], qs = q0 + q1 + q2;
        const z = 1 / qs, o = y * W + x;
        if (z >= zb[o]) return;
        zb[o] = z;
        const k0 = q0 / qs, k1 = q1 / qs, k2 = q2 / qs;
        for (let k = 0; k < 3; k++) {
          nb[3 * o + k] = N[i + k] * k0 + N[i + 3 + k] * k1 + N[i + 6 + k] * k2;
          pb[3 * o + k] = T[i + k] * k0 + T[i + 3 + k] * k1 + T[i + 6 + k] * k2;
          cb[3 * o + k] = C[3 * t + k];
        }
      });
    }
  }
  // shade
  const out = new Uint8Array(W * H * 3);
  const bgTop = [0.024, 0.031, 0.051], bgLow = [0.051, 0.078, 0.125];
  const lin = c => Math.pow(c, 2.2), enc = v => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
  const floorCol = [lin(0.07), lin(0.095), lin(0.16)], gridCol = [lin(0.16), lin(0.27), lin(0.5)], majCol = [lin(0.22), lin(0.42), lin(0.78)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * W + x;
    // view ray
    const sx = ((x + 0.5) / W * 2 - 1) * tanH * asp, sy = (1 - (y + 0.5) / H * 2) * tanH;
    const d = norm([f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy]);
    const gy = y / H, bg = [0, 1, 2].map(k => lin(bgTop[k] + (bgLow[k] - bgTop[k]) * gy));
    let col = bg;
    const tF = d[2] < -1e-4 ? -cam.eye[2] / d[2] : Infinity;
    const zF = tF * dot(d, f);
    if (zb[o] < zF && zb[o] < Infinity) {
      let n = [nb[3 * o], nb[3 * o + 1], nb[3 * o + 2]]; n = norm(n);
      const p = [pb[3 * o], pb[3 * o + 1], pb[3 * o + 2]];
      const v = norm(sub(cam.eye, p));
      if (dot(n, v) < 0) n = [-n[0], -n[1], -n[2]];
      const base = [lin(cb[3 * o]), lin(cb[3 * o + 1]), lin(cb[3 * o + 2])];
      const sh = shadow([p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004]);
      const kd = Math.max(0, -dot(n, KEY)) * sh, fd = Math.max(0, -dot(n, FILL)), rd = Math.pow(Math.max(0, 1 - dot(n, v)), 3) * Math.max(0, -dot(n, RIM) + 0.3);
      const hv = norm(sub(v, KEY)), spec = Math.pow(Math.max(0, dot(n, hv)), 40) * 0.35 * sh;
      const sky = 0.5 + 0.5 * n[2];
      col = [0, 1, 2].map(k => base[k] * (1.05 * kd * [1.0, 0.96, 0.9][k] + 0.32 * fd * [0.6, 0.7, 1.0][k] + (0.1 + 0.12 * sky) * [0.7, 0.8, 1.0][k]) + spec + 0.25 * rd * [0.6, 0.75, 1][k]);
    } else if (tF < Infinity) {
      const p = [cam.eye[0] + d[0] * tF, cam.eye[1] + d[1] * tF, 0];
      // grid: lines every 0.5 m, a major line every 2 m; width grows with distance
      const wpx = tF * (2 * tanH / H) / Math.max(0.15, -d[2]);
      const line = (step, wd) => {
        let a = 0;
        for (const c of [p[0], p[1]]) { const g = Math.abs(c / step - Math.round(c / step)) * step; a = Math.max(a, 1 - Math.min(1, Math.max(0, (g - wd) / Math.max(wpx, 1e-4)))); }
        return a;
      };
      const g1 = line(0.5, 0.006) * Math.min(1, 1.6 / (wpx * 900 + 0.2)), g2 = line(2, 0.012);
      const sh = shadow(p), occl = 0.35 + 0.65 * sh;
      let c = [0, 1, 2].map(k => floorCol[k] * occl);
      c = c.map((v, k) => v + (gridCol[k] - v) * g1 * 0.4 * occl);
      c = c.map((v, k) => v + (majCol[k] - v) * g2 * 0.5 * occl);
      // fade into the background with distance
      const fog = Math.min(1, Math.max(0, (tF - 4) / 9));
      col = c.map((v, k) => v + (bg[k] - v) * fog);
    }
    out[3 * o] = enc(col[0]); out[3 * o + 1] = enc(col[1]); out[3 * o + 2] = enc(col[2]);
  }
  return out;
}

// edge-function triangle fill over the pixel centres; cb(x, y, w0, w1, w2)
function tri2(a, b, c, w, h, cb) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const ia = 1 / area;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * ia;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * ia;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      cb(x, y, w0, w1, w2);
    }
  }
}

function writePNG(path, rgb, w, h) {
  const raw = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (3 * w + 1)] = 0; Buffer.from(rgb.buffer, y * 3 * w, 3 * w).copy(raw, y * (3 * w + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

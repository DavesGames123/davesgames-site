// ============================================================================
//  tools/zfight-check.mjs — find coplanar, same-facing surfaces in a page scene
// ----------------------------------------------------------------------------
//  Usage:
//    node tools/zfight-check.mjs <key> [<key> ...] [--all] [--eps K] [--min A]
//
//  The tool builds the three.js scene of a mechanism page in node (no GPU,
//  no DOM: a stub canvas makes the kit textures). It poses the scene at a
//  few angles and then looks for z-fighting: two front faces that lie in
//  the same place and face the same way. The depth buffer cannot order such
//  faces, so the GPU shows a striped mix of the two parts.
//
//  METHOD
//    1. Collect every visible mesh triangle in world space (InstancedMesh
//       too). A BackSide material flips the normal. A material with
//       polygonOffset is skipped: its page offsets it on purpose.
//    2. Put each triangle into a uniform grid, cell size R / 40.
//    3. Sample points inside each triangle. A sample "fights" when it lies
//       strictly inside another triangle, within eps of its plane, and the
//       two normals point the same way (dot > 0.95). Opposite faces of
//       touching parts are hidden inside the solids; --twosided counts them
//       too when either material is DoubleSide (section views).
//    4. Drop a sample when a ray along its normal first meets a face that
//       points away: the sample is inside a solid (--hidden keeps it).
//    5. Sum the fighting area for each pair of parts and report the pairs
//       above --min (mm^2, default 0.5).
//    eps is R * K, with K = 2e-4 (--eps): 0.04 mm for a 200 mm model. That
//    is about the depth step at the far end of the orbit range.
//
//  Limits: a fight inside a closed body is invisible but still reported.
//  Near-coincident curved surfaces with different facet counts are found
//  only where the facets cross; read the scene code for those.
//
//  GREP MAP
//    const ADAPTERS .......... how each page builds and poses its scene
//    function generic ........ template pages: UNITS / VARIANTS + build(B, id)
//    function collect ........ world triangles of a root
//    function fights ......... the grid search
// ============================================================================
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VENDOR = pathToFileURL(path.join(ROOT, 'stella-nova/vendor/three@0.160.0/')).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s === 'three') return next(${JSON.stringify(VENDOR + 'build/three.module.js')}, c);
    if (s.startsWith('three/addons/')) return next(${JSON.stringify(VENDOR + 'examples/jsm/')} + s.slice(13), c);
    return next(s, c);
  }`));

// a canvas that accepts every 2D call and draws nothing
const noop = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : noop, apply: () => noop, set: () => true });
const canvas = () => ({ width: 1, height: 1, style: {}, getContext: () => noop, addEventListener() {}, toDataURL: () => '' });
globalThis.document = { createElement: t => (t === 'canvas' ? canvas() : { style: {}, appendChild() {}, setAttribute() {} }), createElementNS: () => canvas(), body: { appendChild() {} } };
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.navigator ??= { userAgent: 'node' };
globalThis.devicePixelRatio = 1;
globalThis.performance ??= { now: () => 0 };
globalThis.ImageData ??= class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };

const THREE = await import('three');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? +argv[i + 1] : d; };
const EPSK = opt('eps', 2e-4), MINA = opt('min', 0.5), TWO = argv.includes('--twosided'), HIDDEN = argv.includes('--hidden');
const PAGES = path.join(ROOT, 'stella-nova/pages');
const imp = (key, f) => import(pathToFileURL(path.join(PAGES, key, f)).href);
const ANGLES = [0, 1.1, 2.7, 4.4];

// ── adapters: { label, root, poses: [() => void] } per unit ─────────────────
async function generic(key) {
  const kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
  let ids = [null];
  for (const f of ['mech.js', 'drive.js', 'model.js', 'box.js']) {
    try { const m = await imp(key, f); const L = m.UNITS || m.VARIANTS; if (L) { ids = L.map(u => u.id); break; } } catch {}
  }
  return ids.map(id => {
    const B = kit.createBuild(), sc = id == null ? scene.build(B) : scene.build(B, id);
    return { label: id || key, root: B.root, poses: ANGLES.map(a => () => sc.pose(a)) };
  });
}
const ADAPTERS = {
  async 'stirling-engine'(key) {
    const E = await imp(key, 'engine.js'), kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    return E.VARIANTS.map(v => { const e = E.makeEngine(v.id), B = kit.createBuild(), sc = scene.build(B, e);
      return { label: v.id, root: B.root, poses: ANGLES.map(a => () => sc.pose(e.kin(a, 0))) }; });
  },
  async 'four-stroke-engine'(key) {
    const E = await imp(key, 'engine.js'), kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    return Object.keys(E.TRAINS).map(id => { const B = kit.createBuild(), sc = scene.build(B, E.TRAINS[id]);
      return { label: id, root: B.root, poses: [0, 130, 370, 560].map(a => () => sc.pose(a)) }; });
  },
  async 'wankel-engine'(key) {
    const E = await imp(key, 'engine.js'), kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    return E.VARIANTS.map(v => { const B = kit.createBuild(), sc = scene.build(B, v);
      return { label: v.id, root: B.root, poses: ANGLES.map(a => () => sc.pose(a)) }; });
  },
  async differential(key) {
    const D = await imp(key, 'diff.js'), kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    return D.VARIANTS.map(v => { const B = kit.createBuild(), sc = scene.build(B, v.id);
      return { label: v.id, root: B.root, poses: ANGLES.map(a => () => sc.pose(D.pose(v.id, a, a * 0.3))) }; });
  },
  async 'planetary-gearbox'(key) {
    const L = await imp(key, 'layout.js'), G = await imp(key, 'gears.js'), kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    return L.VARIANTS.map(v => { const lay = L.layout(v.id, 30, 18, 3), B = kit.createBuild(), sc = scene.build(B, lay);
      const ks = lay.sets.map(T => T.Zr / T.Zs);
      return { label: v.id, root: B.root, poses: ANGLES.map(a => () => sc.pose(G.poseAngles(v.id, ks, { S: a, C: a * 0.3, C1: a * 0.3 }))) }; });
  },
  async 'manual-gearbox'(key) {
    const kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    const B = kit.createBuild(), sc = scene.build(B);
    return [{ label: 'box', root: B.root, poses: ANGLES.map((a, i) => () => sc.pose({ thIn: a, thOut: a * 0.4, sx: [{ h12: 0, h34: 0, h5: 0 }, { h12: 1, h34: 0, h5: 0 }, { h12: 0, h34: -1, h5: 0 }, { h12: 0, h34: 0, h5: 1 }][i], lever: [[0, 0], [0, 1], [1, -1], [0, 0]][i] })) }];
  },
  async 'pin-tumbler-lock'(key) {
    const M = await imp(key, 'lock.js'), kit = await imp(key, 'kit.js'), scene = await imp(key, 'scene.js');
    return M.VARIANTS.map(v => { const Lk = M.makeLock(v.id), B = kit.createBuild(), sc = scene.build(B, Lk);
      return { label: v.id, root: B.root, poses: [[0, 0], [0.5, 0], [1, 0], [1, 60]].map(([s, t]) => () => sc.pose(Lk.state('right', s, t * M.D), 0)) }; });
  },
};
const MECH = ['stirling-engine', 'four-stroke-engine', 'wankel-engine', 'differential', 'planetary-gearbox', 'manual-gearbox', 'harmonic-drive', 'geneva-cams', 'linkages', 'pin-tumbler-lock'];

// ── triangles ───────────────────────────────────────────────────────────────
function visible(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }
function collect(root) {
  root.updateMatrixWorld(true);
  const tris = [], names = [], M = new THREE.Matrix4(), IM = new THREE.Matrix4(), v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || !visible(o)) return;
    const mats = [].concat(o.material);
    if (mats.every(m => !m.visible || m.colorWrite === false || (m.transparent && m.depthWrite === false) || m.wireframe)) return;
    const g = o.geometry, pos = g.attributes.position; if (!pos) return;
    const idx = g.index, n = idx ? idx.count : pos.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    const nm = (o.userData.part || o.parent?.name || '?') + '/' + (o.name || mats[0].name || mats[0].type);
    const id = names.push(nm) - 1;
    const inst = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < inst; k++) {
      M.copy(o.matrixWorld); if (o.isInstancedMesh) { o.getMatrixAt(k, IM); M.multiply(IM); }
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0] || mats[0];
        // a polygonOffset material already wins its shared planes on purpose
        if (mat.polygonOffset) continue;
        const two = mat.side === THREE.DoubleSide, flip = mat.side === THREE.BackSide ? -1 : 1;
        for (let i = gr.start; i + 2 < Math.min(n, gr.start + gr.count); i += 3) {
          const p = [];
          for (let j = 0; j < 3; j++) { v.fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(M); p.push(v.x, v.y, v.z); }
          const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2], bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
          let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const L = Math.hypot(nx, ny, nz); if (L < 1e-9) continue;
          nx *= flip / L; ny *= flip / L; nz *= flip / L;
          tris.push({ p, n: [nx, ny, nz], area: L / 2, id, two });
        }
      }
    }
  });
  return { tris, names };
}

// strict inside test of q (on the plane of t) by barycentric signs
function inside(t, x, y, z) {
  const p = t.p, n = t.n, m = 1e-6;
  for (let e = 0; e < 3; e++) {
    const a = e * 3, b = ((e + 1) % 3) * 3;
    const ex = p[b] - p[a], ey = p[b + 1] - p[a + 1], ez = p[b + 2] - p[a + 2];
    const qx = x - p[a], qy = y - p[a + 1], qz = z - p[a + 2];
    const cx = ey * qz - ez * qy, cy = ez * qx - ex * qz, cz = ex * qy - ey * qx;
    if ((cx * n[0] + cy * n[1] + cz * n[2]) / (2 * t.area) <= m) return false;
  }
  return true;
}

// Moller-Trumbore: the distance along d to triangle p, or -1
function ray(o, d, p) {
  const e1x = p[3] - p[0], e1y = p[4] - p[1], e1z = p[5] - p[2], e2x = p[6] - p[0], e2y = p[7] - p[1], e2z = p[8] - p[2];
  const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz; if (Math.abs(a) < 1e-12) return -1;
  const f = 1 / a, sx = o[0] - p[0], sy = o[1] - p[1], sz = o[2] - p[2];
  const u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (d[0] * qx + d[1] * qy + d[2] * qz); if (v < 0 || u + v > 1) return -1;
  return f * (e2x * qx + e2y * qy + e2z * qz);
}

function fights(tris, R) {
  const eps = R * EPSK, h = R / 40, G = new Map();
  const key = (i, j, k) => i + ',' + j + ',' + k;
  tris.forEach((t, ti) => {
    const p = t.p;
    const lo = [0, 1, 2].map(a => Math.floor((Math.min(p[a], p[a + 3], p[a + 6]) - eps) / h));
    const hi = [0, 1, 2].map(a => Math.floor((Math.max(p[a], p[a + 3], p[a + 6]) + eps) / h));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const c = key(i, j, k); let l = G.get(c); if (!l) G.set(c, l = []); l.push(ti);
    }
  });
  // enclosed: the first face that a ray along n meets points away from the
  // ray, so the point is inside a solid and no camera can see it
  function enclosed(x, y, z, n, a, b) {
    const o = [x + n[0] * 3 * eps, y + n[1] * 3 * eps, z + n[2] * 3 * eps], seen = new Set();
    let best = Infinity, bestDot = 0;
    for (let t = 0; t < 2 * R && best === Infinity; t += h / 2) {
      const l = G.get(key(Math.floor((o[0] + n[0] * t) / h), Math.floor((o[1] + n[1] * t) / h), Math.floor((o[2] + n[2] * t) / h)));
      if (!l) continue;
      for (const si of l) {
        if (si === a || si === b || seen.has(si)) continue; seen.add(si);
        const d = ray(o, n, tris[si].p);
        if (d > 0 && d < best) { best = d; const m = tris[si].n; bestDot = m[0] * n[0] + m[1] * n[1] + m[2] * n[2]; }
      }
    }
    return best < Infinity && bestDot > 0;
  }
  const pair = new Map(), spacing = h / 3;
  tris.forEach((t, ti) => {
    const p = t.p;
    const edge = Math.max(Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]), Math.hypot(p[6] - p[0], p[7] - p[1], p[8] - p[2]), Math.hypot(p[6] - p[3], p[7] - p[4], p[8] - p[5]));
    const N = Math.min(16, Math.max(1, Math.ceil(edge / spacing)));
    const pts = [];
    for (let a = 0; a < N; a++) for (let b = 0; a + b < N; b++) pts.push([(a + 1 / 3) / N, (b + 1 / 3) / N]);
    const dA = t.area / pts.length;
    for (const [u, w] of pts) {
      const x = p[0] + u * (p[3] - p[0]) + w * (p[6] - p[0]), y = p[1] + u * (p[4] - p[1]) + w * (p[7] - p[1]), z = p[2] + u * (p[5] - p[2]) + w * (p[8] - p[2]);
      const l = G.get(key(Math.floor(x / h), Math.floor(y / h), Math.floor(z / h))); if (!l) continue;
      for (const si of l) {
        if (si === ti) continue;
        const s = tris[si], dot = s.n[0] * t.n[0] + s.n[1] * t.n[1] + s.n[2] * t.n[2];
        if (!(dot > 0.95 || (TWO && (s.two || t.two) && dot < -0.95))) continue;
        const d = (x - s.p[0]) * s.n[0] + (y - s.p[1]) * s.n[1] + (z - s.p[2]) * s.n[2];
        if (Math.abs(d) > eps) continue;
        if (!inside(s, x - d * s.n[0], y - d * s.n[1], z - d * s.n[2])) continue;
        if (!HIDDEN && enclosed(x, y, z, t.n, ti, si)) break;
        const k = t.id < s.id ? t.id + '|' + s.id : s.id + '|' + t.id;
        const e = pair.get(k) || { area: 0, at: [x, y, z], d: 0 };
        e.area += dA; e.d = Math.max(e.d, Math.abs(d)); pair.set(k, e);
        break;
      }
    }
  });
  return pair;
}

// ── run ─────────────────────────────────────────────────────────────────────
let keys = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (argv.includes('--all')) keys = MECH;
if (!keys.length) { console.error('usage: node tools/zfight-check.mjs <key> [...] | --all [--eps K] [--min mm2]'); process.exit(2); }
let bad = 0;
for (const key of keys) {
  let units;
  try { units = await (ADAPTERS[key] || generic)(key); }
  catch (e) { console.log(`${key}: BUILD FAILED  ${e.message.split('\n')[0]}`); bad++; continue; }
  for (const U of units) {
    const worst = new Map();
    let R = 0, ntri = 0, names = [];
    for (const pose of U.poses) {
      try { pose(); } catch (e) { console.log(`${key}/${U.label}: pose failed (${e.message.split('\n')[0]}), static build checked`); }
      const c = collect(U.root); names = c.names; ntri = c.tris.length;
      const box = new THREE.Box3().setFromObject(U.root); R = box.getSize(new THREE.Vector3()).length() / 2;
      for (const [k, e] of fights(c.tris, R)) if (!worst.has(k) || worst.get(k).area < e.area) worst.set(k, e);
    }
    const rows = [...worst].filter(([, e]) => e.area >= MINA).sort((a, b) => b[1].area - a[1].area);
    console.log(`${key}/${U.label}: R ${R.toFixed(1)}  ${ntri} tris  eps ${(R * EPSK).toFixed(3)}  ${rows.length ? rows.length + ' FIGHT PAIRS' : 'clean'}`);
    for (const [k, e] of rows) {
      const [a, b] = k.split('|').map(Number);
      console.log(`  ${e.area.toFixed(1).padStart(8)} mm2  d<=${e.d.toFixed(3)}  ${names[a]}  <->  ${names[b]}  at ${e.at.map(v => v.toFixed(1)).join(',')}`);
    }
    bad += rows.length;
  }
}
process.exit(bad ? 1 : 0);

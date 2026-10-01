// ============================================================================
//  HUMAN SKELETON  ·  layout.js — where each bone goes in each explode mode
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE. Every function returns per-bone arrays that the
//  bone-state texture takes as they are:
//    off  Float32Array n*3   translation added after the rotation
//    q    Float32Array n*4   rotation about the bone centre (x, y, z, w)
//  The vertex shader does  p' = rot(q, p - c) + c + off.
//
//  MODES
//    radial     each bone moves away from the joint with its parent, and
//               carries its children with it (the tree starts at the
//               sacrum), so a hand fans out finger by finger
//    regional   the eight body groups move apart as blocks, then the
//               bones open out inside each group
//    catalogue  every visible bone lies flat on a museum tray: one tray a
//               region (anatomical order), or one tray sorted by length
//  An amount per bone (0..1) scales radial and regional, so one region
//  can open while the rest stays assembled.
//
//  GREP MAP
//    function prep        parents, depth, explode direction and gap
//    function radial      cumulative offsets down the tree
//    function regional    group blocks, then radial inside each group
//    function catalogue   tray packing: trays, offsets, rotations, labels
//    function liftToFloor no bone below the floor after an explode
//    function delays      stagger for the transition, in seconds
//    function bounds      centre and radius of the bones as placed
// ============================================================================

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// block directions for the regional mode (x left, y up, z front)
const GROUP_DIR = {
  head: [0, 1, 0.15], spine: [0, 0.1, -1], thorax: [0, 0.25, 1], 'upper-l': [1, 0.2, 0], 'upper-r': [-1, 0.2, 0],
  pelvis: [0, -0.15, 0.6], 'lower-l': [0.8, -0.1, 0.25], 'lower-r': [-0.8, -0.1, 0.25], cartilage: [0, 0.25, 1],
};
const GAP_MUL = { skull: 1.7, teeth: 1.5, ear: 2, hyoid: 2.5, spine: 0.55, thorax: 0.9, hand: 1.35, foot: 1.3, arm: 1.1, leg: 1.0, shoulder: 1.1, pelvis: 1.2, cartilage: 0.9 };
const GROUP_GAP = { head: 0.32, spine: 0.30, thorax: 0.34, 'upper-l': 0.42, 'upper-r': 0.42, pelvis: 0.24, 'lower-l': 0.34, 'lower-r': 0.34, cartilage: 0.34 };

export function prep(manifest) {
  const bones = manifest.bones;
  const n = bones.length;
  const byId = new Map(bones.map(b => [b.id, b]));
  const parent = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n);
  const dir = new Float32Array(n * 3), gap = new Float32Array(n);
  for (const b of bones) if (b.parent) parent[b.i] = byId.get(b.parent).i;
  // depth and a parent-first order
  const order = [];
  const kids = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (parent[i] >= 0) kids[parent[i]].push(i);
  const roots = [];
  for (let i = 0; i < n; i++) if (parent[i] < 0) roots.push(i);
  const stack = roots.map(i => [i, 0]);
  while (stack.length) {
    const [i, d] = stack.pop();
    depth[i] = d; order.push(i);
    for (const k of kids[i]) stack.push([k, d + 1]);
  }
  for (const b of bones) {
    const p = parent[b.i];
    let d = [0, 0, 0];
    if (p >= 0) {
      const d2 = norm(sub(b.c, bones[p].c));
      const d1 = b.joint ? norm(sub(b.c, b.joint)) : d2;
      d = norm([d1[0] * 0.6 + d2[0] * 0.4, d1[1] * 0.6 + d2[1] * 0.4, d1[2] * 0.6 + d2[2] * 0.4]);
    }
    // the skull opens from the centre of the sphenoid, like the classic
    // exploded skull; the spine opens less, or it would grow a metre
    if ((b.region === 'skull' || b.region === 'teeth' || b.region === 'ear') && byId.has('sphenoid') && b.id !== 'sphenoid') {
      const sc = byId.get('sphenoid').c;
      const o = norm(sub(b.c, [sc[0], sc[1] - 0.01, sc[2] - 0.005]));
      d = norm([o[0] * 0.8 + d[0] * 0.2, o[1] * 0.8 + d[1] * 0.2, o[2] * 0.8 + d[2] * 0.2]);
    }
    dir.set(d, b.i * 3);
    gap[b.i] = (0.5 * b.r + 0.012) * (GAP_MUL[b.region.replace(/-[lr]$/, '')] || 1);
  }
  const groupOf = bones.map(b => b.group);
  return { bones, n, byId, parent, depth, order, kids, dir, gap, groupOf, maxDepth: Math.max(...depth) };
}

// amt: Float32Array n (0..1). scale: metres a unit of gap.
export function radial(M, amt, scale = 1, out = new Float32Array(M.n * 3)) {
  out.fill(0);
  for (const i of M.order) {
    const p = M.parent[i];
    const k = M.gap[i] * amt[i] * scale;
    for (let a = 0; a < 3; a++) out[i * 3 + a] = (p >= 0 ? out[p * 3 + a] : 0) + M.dir[i * 3 + a] * k;
  }
  return out;
}

export function regional(M, amt, scale = 1, out = new Float32Array(M.n * 3)) {
  out.fill(0);
  for (const i of M.order) {
    const g = M.groupOf[i];
    const p = M.parent[i];
    const inGroup = p >= 0 && M.groupOf[p] === g;
    const k = M.gap[i] * amt[i] * 0.75 * scale;
    if (inGroup) {
      for (let a = 0; a < 3; a++) out[i * 3 + a] = out[p * 3 + a] + M.dir[i * 3 + a] * k;
    } else {
      const gd = norm(GROUP_DIR[g] || [0, 0, 0]);
      const gk = (GROUP_GAP[g] || 0.3) * amt[i] * scale;
      for (let a = 0; a < 3; a++) out[i * 3 + a] = gd[a] * gk + M.dir[i * 3 + a] * k;
    }
  }
  return out;
}

// Lift every bone the same amount so the lowest one rests on the floor
// (y = 0). Only bones with vis[i] count.
export function liftToFloor(M, off, vis) {
  let lo = Infinity;
  for (let i = 0; i < M.n; i++) {
    if (!vis[i]) continue;
    const b = M.bones[i];
    lo = Math.min(lo, b.qmin[1] + off[i * 3 + 1]);
  }
  if (lo < 0 && isFinite(lo)) for (let i = 0; i < M.n; i++) off[i * 3 + 1] -= lo;
  return off;
}

// ── catalogue ───────────────────────────────────────────────────────────────
// Shelf packing: items fill a row left to right, then a new row starts.
function shelf(items, width) {
  let x = 0, z = 0, row = 0, w = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > width) { z += row; x = 0; row = 0; }
    it.x = x; it.z = z;
    x += it.w; row = Math.max(row, it.d); w = Math.max(w, x);
  }
  return { w, d: z + row };
}

// regions: manifest.regions (ordered). sort: 'region' | 'size'.
// aspect: width / height of the clear part of the screen.
export function catalogue(M, vis, regions, sort = 'region', aspect = 1.6) {
  const PAD = 0.014, LABEL = 0.03, MARGIN = 0.03, GAP = 0.05;
  const bones = M.bones;
  const item = b => ({ b, w: b.lay.ext[0] + PAD * 2, d: b.lay.ext[2] + PAD * 2 + LABEL });
  let trays = [];
  if (sort === 'size') {
    const its = bones.filter(b => vis[b.i]).sort((a, c) => c.len - a.len).map(item);
    trays.push({ id: 'all', label: 'All bones, by length', items: its });
  } else {
    for (const r of regions) {
      const its = bones.filter(b => vis[b.i] && b.region === r.id).map(item);
      if (its.length) trays.push({ id: r.id, label: r.label, items: its });
    }
  }
  // each tray: width from its area, at least its widest item
  for (const t of trays) {
    const area = t.items.reduce((s, it) => s + it.w * it.d, 0);
    const maxW = Math.max(...t.items.map(it => it.w));
    const want = sort === 'size' ? Math.sqrt(area * aspect * 1.1) : Math.sqrt(area * 1.5);
    const sz = shelf(t.items, Math.max(maxW, want));
    t.w = sz.w + MARGIN * 2; t.d = sz.d + MARGIN * 2 + 0.02;
  }
  // trays on the table, the same shelf packing
  const total = trays.reduce((s, t) => s + (t.w + GAP) * (t.d + GAP), 0);
  const maxT = Math.max(...trays.map(t => t.w + GAP));
  const tw = shelf(trays.map(t => Object.assign(t, { w0: t.w, d0: t.d, w: t.w + GAP, d: t.d + GAP })), Math.max(maxT, Math.sqrt(total * aspect * 1.15)));
  const cx = tw.w / 2, cz = tw.d / 2;
  const off = new Float32Array(M.n * 3), q = new Float32Array(M.n * 4), label = new Float32Array(M.n * 3);
  for (let i = 0; i < M.n; i++) q[i * 4 + 3] = 1;
  const outTrays = [];
  for (const t of trays) {
    const tx = t.x - cx, tz = t.z - cz;
    outTrays.push({ id: t.id, label: t.label, x: tx + t.w0 / 2, z: tz + t.d0 / 2, w: t.w0, d: t.d0, lx: tx + 0.012, lz: tz + 0.02 });
    for (const it of t.items) {
      const b = it.b, L = b.lay;
      const T = [tx + MARGIN + it.x + it.w / 2, L.ext[1] / 2 + 0.006, tz + MARGIN + 0.02 + it.z + PAD + L.ext[2] / 2];
      for (let a = 0; a < 3; a++) off[b.i * 3 + a] = T[a] - b.c[a] - L.c[a];
      q.set(L.q, b.i * 4);
      label.set([T[0], 0.006, T[2] + L.ext[2] / 2 + PAD * 0.4], b.i * 3);
    }
  }
  return { off, q, label, trays: outTrays, size: [tw.w, tw.d] };
}

// ── timing ──────────────────────────────────────────────────────────────────
// mode: 'radial' | 'regional' | 'catalogue'. Reverse plays the order back.
export function delays(M, mode, reverse = false, rank = null) {
  const d = new Float32Array(M.n);
  const GO = ['head', 'spine', 'thorax', 'upper-l', 'upper-r', 'pelvis', 'lower-l', 'lower-r', 'cartilage'];
  for (let i = 0; i < M.n; i++) {
    if (mode === 'catalogue') d[i] = rank ? rank[i] * (0.9 / M.n) : (i / M.n) * 0.9;
    else if (mode === 'regional') d[i] = Math.max(0, GO.indexOf(M.groupOf[i])) * 0.07 + M.depth[i] * 0.012;
    else d[i] = (M.depth[i] / (M.maxDepth || 1)) * 0.7 + (i % 5) * 0.012;
  }
  if (reverse) { const mx = Math.max(...d); for (let i = 0; i < M.n; i++) d[i] = mx - d[i]; }
  return d;
}

// centre and radius of the visible bones as placed by `off` (ignores q:
// the radius is a sphere bound, so a rotation stays inside it)
// tight: use the rest-pose boxes (right when no bone is turned)
export function bounds(M, off, vis, only = null, tight = false) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (let i = 0; i < M.n; i++) {
    if (!vis[i] || (only && !only(M.bones[i]))) continue;
    const b = M.bones[i];
    any = true;
    for (let a = 0; a < 3; a++) {
      const o = off[i * 3 + a];
      const l = tight ? b.qmin[a] + o : b.c[a] + o - b.r, h = tight ? b.qmin[a] + b.qsize[a] + o : b.c[a] + o + b.r;
      lo[a] = Math.min(lo[a], l); hi[a] = Math.max(hi[a], h);
    }
  }
  if (!any) return { c: [0, 0.9, 0], r: 1, lo: [-1, 0, -1], hi: [1, 1.8, 1] };
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  // a tighter radius than the box corner: the farthest bone sphere
  let r = 0;
  for (let i = 0; i < M.n; i++) {
    if (!vis[i] || (only && !only(M.bones[i]))) continue;
    const b = M.bones[i];
    const dx = b.c[0] + off[i * 3] - c[0], dy = b.c[1] + off[i * 3 + 1] - c[1], dz = b.c[2] + off[i * 3 + 2] - c[2];
    r = Math.max(r, Math.hypot(dx, dy, dz) + b.r * 0.85);
  }
  return { c, r, lo, hi };
}

export function slerp(a, ai, b, bi, t, out, oi) {
  let ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  let bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  let k0, k1;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; } else {
    const th = Math.acos(cos), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  out[oi] = x / l; out[oi + 1] = y / l; out[oi + 2] = z / l; out[oi + 3] = w / l;
}

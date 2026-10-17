// Procedural meshes for the kinds that have no acceptable real model
// (weeping willow, reeds with cattails, grass tufts). Only the mesh is
// ours; every texture is a real CC0 photo texture (see catalog.mjs).
// grep -n names: willow, reeds, tufts, tube, ribbon, writeGltf.
//
// Units metres, y up, base centre at the origin. A generator returns
// { name, parts: { [material]: Mesh } } with Mesh = { p, n, uv, i }
// (plain arrays). writeGltf() writes the variants as one .gltf + .bin
// with one top level node per variant and one material per part name.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mesh = () => ({ p: [], n: [], uv: [], i: [] });
const part = (parts, k) => (parts[k] ||= mesh());

// A frame perpendicular to t.
function frame(t) {
  const a = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(t, a));
  return [u, cross(u, t)];
}

// Tapered tube along pts (radii per point), `sides` around, v in metres / vScale.
export function tube(m, pts, radii, sides, vScale = 1, closeTip = true) {
  const base = m.p.length / 3;
  let len = 0;
  for (let k = 0; k < pts.length; k++) {
    const t = norm(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]));
    const [u, w] = frame(t);
    if (k > 0) len += Math.hypot(...sub(pts[k], pts[k - 1]));
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const d = add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
      m.p.push(...add(pts[k], mul(d, radii[k])));
      m.n.push(...d);
      m.uv.push(s / sides, len / vScale);
    }
  }
  const row = sides + 1;
  for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) {
    const a = base + k * row + s, b = a + row;
    m.i.push(a, b, a + 1, a + 1, b, b + 1);
  }
  if (closeTip) {
    const tip = m.p.length / 3, last = pts[pts.length - 1];
    const t = norm(sub(last, pts[pts.length - 2]));
    m.p.push(...add(last, mul(t, radii[radii.length - 1]))); m.n.push(...t); m.uv.push(0.5, len / vScale);
    const r0 = base + (pts.length - 1) * row;
    for (let s = 0; s < sides; s++) m.i.push(r0 + s, tip, r0 + s + 1);
  }
}

// Flat ribbon along pts with widths and a side vector per point; u in [u0, u1].
export function ribbon(m, pts, widths, sides, u0, u1, upBlend = 0) {
  const base = m.p.length / 3;
  let len = 0, total = 0;
  for (let k = 1; k < pts.length; k++) total += Math.hypot(...sub(pts[k], pts[k - 1]));
  for (let k = 0; k < pts.length; k++) {
    if (k > 0) len += Math.hypot(...sub(pts[k], pts[k - 1]));
    const t = norm(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]));
    let n = norm(cross(sides[k], t));
    if (upBlend) n = norm(add(mul(n, 1 - upBlend), [0, upBlend, 0]));
    for (const s of [-1, 1]) {
      m.p.push(...add(pts[k], mul(sides[k], s * widths[k] / 2)));
      m.n.push(...n);
      m.uv.push(s < 0 ? u0 : u1, 1 - len / total);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) { const a = base + k * 2; m.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
}

// One lanceolate leaf: base at o, along dir d, blade side s; 6 vertices, 4 triangles.
function leaf(m, o, d, s, len, wid, n) {
  const base = m.p.length / 3;
  const P = [[0, 0], [-0.5, 0.25], [0.5, 0.25], [-0.42, 0.65], [0.42, 0.65], [0, 1]];
  for (const [x, y] of P) {
    m.p.push(...add(o, add(mul(d, y * len), mul(s, x * wid))));
    m.n.push(...n);
    m.uv.push(0.5 + x * 0.36, 0.95 - y * 0.9);
  }
  m.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4, base + 3, base + 5, base + 4);
}

// Quadratic Bezier sampled to n + 1 points.
function bez(a, b, c, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, s = 1 - t;
    out.push(add(add(mul(a, s * s), mul(b, 2 * s * t)), mul(c, t * t)));
  }
  return out;
}

// ---- weeping willow ---------------------------------------------------------
// A short leaning trunk forks into 4 to 6 limbs that rise at 30 to 55
// degrees and arch over. Side branches arch out of the upper limbs and
// long twigs hang from them almost to the ground, with narrow leaves in
// pairs along each twig.
export function willow(seed) {
  const r = rng(seed), parts = {};
  const bark = part(parts, 'bark'), twig = part(parts, 'twig'), lf = part(parts, 'leaf');
  const H0 = 3.0 + r() * 1.2, lean = [(r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5];
  const top = [lean[0], H0, lean[2]];
  tube(bark, bez([0, -0.1, 0], [lean[0] * 0.3, H0 * 0.5, lean[2] * 0.3], top, 6), [0.42, 0.36, 0.33, 0.31, 0.3, 0.29, 0.28], 10, 1.2, false);
  const nLimbs = 4 + Math.floor(r() * 3);
  const hangFrom = [];
  for (let l = 0; l < nLimbs; l++) {
    const az = (l / nLimbs) * Math.PI * 2 + r() * 0.6;
    const el = (35 + r() * 20) * Math.PI / 180;
    const L = 5.0 + r() * 2.5;
    const dir = [Math.cos(az) * Math.sin(el), Math.cos(el), Math.sin(az) * Math.sin(el)];
    const a = add(top, [0, -0.1, 0]);
    const b = add(a, mul(dir, L * 0.6));
    const c = add(add(a, mul([dir[0], 0, dir[2]], L * 1.1)), [0, L * 0.55, 0]);
    const limb = bez(a, b, c, 8);
    tube(bark, limb, limb.map((_, k) => 0.2 * (1 - k / 9) + 0.035), 7, 1.2);
    // side branches from the upper two thirds of the limb
    const nSide = 8 + Math.floor(r() * 5);
    for (let s = 0; s < nSide; s++) {
      const t = 0.35 + 0.65 * r();
      const k = Math.min(7, Math.floor(t * 8));
      const p0 = limb[k];
      const az2 = az + (r() - 0.5) * 2.4;
      const out = [Math.cos(az2), 0, Math.sin(az2)];
      const len = 1.4 + r() * 1.6;
      const p1 = add(p0, add(mul(out, len * 0.5), [0, len * 0.45, 0]));
      const p2 = add(p0, add(mul(out, len), [0, len * 0.1, 0]));
      const br = bez(p0, p1, p2, 4);
      tube(bark, br, br.map((_, j) => 0.05 * (1 - j / 5) + 0.012), 4, 0.6);
      for (let j = 1; j <= 4; j++) hangFrom.push({ p: br[j], out });
    }
    for (let j = 5; j <= 8; j++) hangFrom.push({ p: limb[j], out: [Math.cos(az), 0, Math.sin(az)] });
  }
  // hanging twigs with leaves
  for (const h of hangFrom) {
    const count = 4 + Math.floor(r() * 4);
    for (let c = 0; c < count; c++) {
      const start = add(h.p, [(r() - 0.5) * 0.4, -0.05, (r() - 0.5) * 0.4]);
      const drop = Math.max(0.8, start[1] - (0.4 + r() * 1.4)) * (0.55 + 0.45 * r());
      const outK = 0.3 + r() * 0.5;
      const mid = add(start, add(mul(h.out, outK), [0, 0.15, 0]));
      const end = add(start, add(mul(h.out, outK * 1.2), [(r() - 0.5) * 0.3, -drop, (r() - 0.5) * 0.3]));
      const pts = bez(start, mid, end, 10);
      const sideV = norm(cross([0, 1, 0], h.out[0] || h.out[2] ? h.out : [1, 0, 0]));
      ribbon(twig, pts, pts.map(() => 0.012), pts.map(() => sideV), 0.45, 0.55);
      // leaves: pairs every ~9 cm from 15 % of the twig
      let total = 0; const seg = [];
      for (let k = 1; k < pts.length; k++) { const d = Math.hypot(...sub(pts[k], pts[k - 1])); seg.push(d); total += d; }
      for (let at = total * 0.15; at < total; at += 0.075) {
        let k = 0, acc = 0; while (k < seg.length - 1 && acc + seg[k] < at) { acc += seg[k]; k++; }
        const f = (at - acc) / seg[k];
        const o = add(pts[k], mul(sub(pts[k + 1], pts[k]), f));
        const t = norm(sub(pts[k + 1], pts[k]));
        for (const sgn of [-1, 1]) {
          const roll = r() * Math.PI * 2;
          const [u, w] = frame(t);
          const sideDir = norm(add(mul(u, Math.cos(roll)), mul(w, Math.sin(roll))));
          const d = norm(add(mul(t, 0.75), mul(sideDir, 0.45 * sgn)));
          const s = norm(cross(d, sideDir));
          const n = norm(add(cross(d, s), [0, 0.6, 0]));
          const len = 0.12 + r() * 0.05;
          leaf(lf, o, d, s, len, len * 0.2, n);
        }
      }
    }
  }
  return { parts };
}

// ---- reeds with cattails --------------------------------------------------------
// 30 to 45 strap blades (1.2 to 2.2 m) that lean out and bend over, and
// 3 to 6 stems with a brown head. Blades map a narrow strip of a leaf
// photo along its midrib.
export function reeds(seed) {
  const r = rng(seed), parts = {};
  const blade = part(parts, 'blade'), head = part(parts, 'head');
  const R = 0.18 + r() * 0.2;
  const nB = 30 + Math.floor(r() * 16);
  for (let b = 0; b < nB; b++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R;
    const o = [Math.cos(a) * rr, 0, Math.sin(a) * rr];
    const L = 1.2 + r() * 1.0;
    const outA = a + (r() - 0.5) * 1.2;
    const out = [Math.cos(outA), 0, Math.sin(outA)];
    const lean = 0.08 + r() * 0.22, bend = 0.15 + r() * 0.45;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push(add(o, add(mul(out, L * (lean * t + bend * t * t * t)), [0, L * t * (1 - 0.25 * bend * t * t), 0])));
    }
    const tw = (r() - 0.5) * 1.2;
    const sides = pts.map((_, k) => {
      const ang = outA + Math.PI / 2 + tw * (k / 8);
      return [Math.cos(ang), 0, Math.sin(ang)];
    });
    const w0 = 0.014 + r() * 0.01;
    ribbon(blade, pts, pts.map((_, k) => w0 * (1 - Math.pow(k / 8, 3) * 0.95)), sides, 0.44, 0.56, 0.35);
  }
  const nS = 3 + Math.floor(r() * 4);
  for (let s = 0; s < nS; s++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R * 0.8;
    const o = [Math.cos(a) * rr, 0, Math.sin(a) * rr];
    const L = 1.5 + r() * 0.7;
    const lean = [(r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25];
    const pts = bez(o, add(o, add(mul(lean, 0.3), [0, L * 0.5, 0])), add(o, add(lean, [0, L, 0])), 6);
    tube(blade, pts, pts.map(() => 0.005), 4, 2.0, false);
    // brown head: 70 % up the top segment, 16 to 22 cm long
    const t = norm(sub(pts[6], pts[5]));
    const hl = 0.16 + r() * 0.06;
    const h0 = sub(pts[6], mul(t, hl + 0.12));
    const hp = [0, 1, 2, 3, 4].map((k) => add(h0, mul(t, (k / 4) * hl)));
    const hr = [0.009, 0.016, 0.017, 0.016, 0.009];
    tube(head, hp, hr, 8, 0.25);
    tube(blade, [hp[4], add(hp[4], mul(t, 0.11))], [0.003, 0.0015], 3, 2.0);
  }
  return { parts };
}

// ---- grass tufts --------------------------------------------------------------
// Four crossed cards (45 degrees apart) that tilt out a little; the card
// shows a whole tuft photo with its alpha. Normals lean up so a tuft
// lights like the ground under it.
export function tufts(seed, texIndex) {
  const r = rng(seed), parts = {};
  const m = part(parts, `tuft_0${texIndex}`);
  const H = 0.45 + r() * 0.3, W = H * 1.15;
  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI + r() * 0.3;
    const s = [Math.cos(a), 0, Math.sin(a)];
    const off = mul(cross([0, 1, 0], s), (r() - 0.5) * 0.08);
    const tilt = (r() - 0.5) * 0.25;
    const topOff = mul(cross([0, 1, 0], s), tilt * H);
    const base = m.p.length / 3;
    const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (const [x, y] of corners) {
      const p = add(add(off, mul(s, (x * W) / 2)), add([0, y * H, 0], mul(topOff, y)));
      m.p.push(...p);
      m.n.push(...norm(add(mul(cross(s, [0, 1, 0]), 0.3), [0, 0.95, 0])));
      m.uv.push((x + 1) / 2, 1 - y);
    }
    m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { parts };
}

// ---- glTF writer ---------------------------------------------------------------
export function writeGltf(file, variants) {
  const chunks = []; let off = 0;
  const json = { asset: { version: '2.0', generator: 'davesgames.io proc.mjs' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const matIndex = new Map();
  const view = (arr, target) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    chunks.push(b); const pad = (4 - (b.length & 3)) & 3; if (pad) chunks.push(Buffer.alloc(pad));
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, target });
    off += b.length + pad; return json.bufferViews.length - 1;
  };
  variants.forEach((v, vi) => {
    const prims = [];
    for (const [mat, m] of Object.entries(v.parts)) {
      if (!m.i.length) continue;
      if (!matIndex.has(mat)) { matIndex.set(mat, json.materials.length); json.materials.push({ name: mat, doubleSided: true }); }
      const P = new Float32Array(m.p), N = new Float32Array(m.n), T = new Float32Array(m.uv), I = new Uint32Array(m.i);
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < P.length; k += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], P[k + c]); mx[c] = Math.max(mx[c], P[k + c]); }
      const acc = (bv, type, count, ct, extra = {}) => { json.accessors.push({ bufferView: bv, componentType: ct, count, type, ...extra }); return json.accessors.length - 1; };
      prims.push({
        attributes: { POSITION: acc(view(P, 34962), 'VEC3', P.length / 3, 5126, { min: mn, max: mx }), NORMAL: acc(view(N, 34962), 'VEC3', N.length / 3, 5126), TEXCOORD_0: acc(view(T, 34962), 'VEC2', T.length / 2, 5126) },
        indices: acc(view(I, 34963), 'SCALAR', I.length, 5125), material: matIndex.get(mat),
      });
    }
    json.meshes.push({ name: v.name, primitives: prims });
    json.nodes.push({ name: v.name, mesh: vi, translation: [vi * 30, 0, 0] });
    json.scenes[0].nodes.push(vi);
  });
  const bin = Buffer.concat(chunks);
  const binName = path.basename(file).replace(/\.gltf$/, '.bin');
  json.buffers.push({ uri: binName, byteLength: bin.length });
  writeFileSync(file, JSON.stringify(json));
  writeFileSync(path.join(path.dirname(file), binName), bin);
}

export const GENERATORS = {
  willow: (inp) => willow(inp.seed),
  reeds: (inp) => reeds(inp.seed),
  tufts: (inp) => tufts(inp.seed, inp.tex),
};

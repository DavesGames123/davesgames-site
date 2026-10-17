// Crown cards for trees whose foliage is too dense for real time.
// grep -n names: foliageIslands, kmeans, makeCards, pickTiles, bakeTiles,
// cardsPart.
//
// A Poly Haven tree has up to a million small twig or leaf cards. The
// build groups them into K clusters (k-means on the island centres,
// weighted by area). Each cluster becomes one larger card in the plane
// of its leaves. The card shows a "spray" tile: an orthographic render
// of the real leaves of a sample cluster. 16 tiles per source go into a
// 4 x 4 atlas (albedo + alpha, tangent space normal, ORM), which all
// variants and LODs of the source share. LOD0, LOD1 and LOD2 differ in K.
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { islands, writeGLB, compact } from './mesh-ops.mjs';
import { pushPull } from './textures.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// Island table over all foliage parts: centre, area, mean normal, radius.
export function foliageIslands(parts) {
  const per = parts.map((p) => islands(p));
  const n = per.reduce((s, x) => s + x.count, 0);
  const T = { n, cx: new Float32Array(n), cy: new Float32Array(n), cz: new Float32Array(n), area: new Float32Array(n),
    nx: new Float32Array(n), ny: new Float32Array(n), nz: new Float32Array(n), rad: new Float32Array(n),
    part: new Uint16Array(n), triIsland: [], offset: [] };
  let off = 0;
  parts.forEach((p, pi) => {
    const { count, triIsland } = per[pi];
    T.triIsland.push(triIsland); T.offset.push(off);
    const P = p.positions, I = p.indices;
    for (let t = 0; t < triIsland.length; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar = Math.hypot(nx, ny, nz) / 2 + 1e-12;
      const i = off + triIsland[t];
      T.area[i] += ar;
      T.cx[i] += ar * (P[a] + P[b] + P[c]) / 3; T.cy[i] += ar * (P[a + 1] + P[b + 1] + P[c + 1]) / 3; T.cz[i] += ar * (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      // Orient each normal up-ish before the sum, so two-sided cards add.
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      T.nx[i] += nx / 2; T.ny[i] += ny / 2; T.nz[i] += nz / 2;
      T.part[i] = pi;
    }
    for (let i = off; i < off + count; i++) { const a = T.area[i]; T.cx[i] /= a; T.cy[i] /= a; T.cz[i] /= a; }
    for (let t = 0; t < triIsland.length; t++) {
      const i = off + triIsland[t];
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k] * 3;
        const d = Math.hypot(P[v] - T.cx[i], P[v + 1] - T.cy[i], P[v + 2] - T.cz[i]);
        if (d > T.rad[i]) T.rad[i] = d;
      }
    }
    off += count;
  });
  return T;
}

// Weighted k-means on island centres. Fits on a sample, then assigns all.
export function kmeans(T, K, seed = 7, iters = 8, sampleN = 60000) {
  K = Math.max(1, Math.min(K, T.n));
  const r = rng(seed);
  // Area-weighted sample.
  const total = T.area.reduce((s, a) => s + a, 0);
  const sample = [];
  if (T.n <= sampleN) for (let i = 0; i < T.n; i++) sample.push(i);
  else { const step = total / sampleN; let acc = r() * step, run = 0; for (let i = 0; i < T.n; i++) { run += T.area[i]; while (run > acc && sample.length < sampleN) { sample.push(i); acc += step; } } }
  const C = new Float32Array(K * 3);
  for (let k = 0; k < K; k++) { const i = sample[Math.floor(r() * sample.length)]; C[k * 3] = T.cx[i] + (r() - 0.5) * 1e-4; C[k * 3 + 1] = T.cy[i]; C[k * 3 + 2] = T.cz[i]; }
  const assign = (idx, out) => {
    for (let q = 0; q < idx.length; q++) {
      const i = idx[q]; const x = T.cx[i], y = T.cy[i], z = T.cz[i];
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const dx = C[k * 3] - x, dy = C[k * 3 + 1] - y, dz = C[k * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = k; } }
      out[q] = best;
    }
  };
  const lab = new Uint32Array(sample.length);
  for (let it = 0; it < iters; it++) {
    assign(sample, lab);
    const S = new Float64Array(K * 4);
    for (let q = 0; q < sample.length; q++) { const i = sample[q], k = lab[q]; S[k * 4] += T.cx[i]; S[k * 4 + 1] += T.cy[i]; S[k * 4 + 2] += T.cz[i]; S[k * 4 + 3]++; }
    for (let k = 0; k < K; k++) {
      if (S[k * 4 + 3] > 0) { C[k * 3] = S[k * 4] / S[k * 4 + 3]; C[k * 3 + 1] = S[k * 4 + 1] / S[k * 4 + 3]; C[k * 3 + 2] = S[k * 4 + 2] / S[k * 4 + 3]; }
      else { const i = sample[Math.floor(r() * sample.length)]; C[k * 3] = T.cx[i]; C[k * 3 + 1] = T.cy[i]; C[k * 3 + 2] = T.cz[i]; }
    }
  }
  const all = new Uint32Array(T.n);
  const idx = new Uint32Array(T.n); for (let i = 0; i < T.n; i++) idx[i] = i;
  assign(idx, all);
  return { K, labels: all };
}

// One card per cluster: { c, u, v, n, hu, hv, members: [island ids] }.
// crownAxisY: height of the crown centre (cards orient away from it).
export function makeCards(T, km, crownAxisY, minHalf = 0.05) {
  const groups = Array.from({ length: km.K }, () => []);
  for (let i = 0; i < T.n; i++) groups[km.labels[i]].push(i);
  const cards = [];
  for (const g of groups) {
    if (!g.length) continue;
    let A = 0, c = [0, 0, 0], nsum = [0, 0, 0];
    for (const i of g) { const a = T.area[i]; A += a; c[0] += T.cx[i] * a; c[1] += T.cy[i] * a; c[2] += T.cz[i] * a; nsum[0] += T.nx[i]; nsum[1] += T.ny[i]; nsum[2] += T.nz[i]; }
    c = scale(c, 1 / A);
    const radial = norm([c[0], (c[1] - crownAxisY) * 0.5, c[2]]);
    const nlen = Math.hypot(...nsum) / A;
    let n = nlen > 0.25 ? norm(nsum) : radial;
    // Tilt a little to the outside so the crown reads as a volume.
    n = norm(add(n, scale(radial, 0.35)));
    // Major axis of the members in the plane (weighted 2D PCA).
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let a0 = norm(cross(ref, n)), b0 = cross(n, a0);
    let sxx = 0, sxy = 0, syy = 0;
    for (const i of g) { const d = [T.cx[i] - c[0], T.cy[i] - c[1], T.cz[i] - c[2]]; const x = dot(d, a0), y = dot(d, b0), w = T.area[i]; sxx += w * x * x; sxy += w * x * y; syy += w * y * y; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const v = norm(add(scale(a0, Math.cos(ang)), scale(b0, Math.sin(ang)))); // major axis
    const u = cross(v, n);
    // Extents from the 5th to 95th percentile of the member centres (so a
    // few stray leaves do not make the card mostly empty), plus a margin
    // of the median leaf radius.
    const xs = [], ys = [], rs = [];
    for (const i of g) {
      const d = [T.cx[i] - c[0], T.cy[i] - c[1], T.cz[i] - c[2]];
      xs.push(dot(d, u)); ys.push(dot(d, v)); rs.push(T.rad[i]);
    }
    xs.sort((p, q) => p - q); ys.sort((p, q) => p - q); rs.sort((p, q) => p - q);
    const pc = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    const rr = pc(rs, 0.5) * 0.9;
    const lo = [pc(xs, 0.05) - rr, pc(ys, 0.05) - rr], hi = [pc(xs, 0.95) + rr, pc(ys, 0.95) + rr];
    const cc = add(c, add(scale(u, (lo[0] + hi[0]) / 2), scale(v, (lo[1] + hi[1]) / 2)));
    const hu = Math.max(minHalf, (hi[0] - lo[0]) / 2), hv = Math.max(minHalf, (hi[1] - lo[1]) / 2);
    let depth = 0;
    for (const i of g) depth = Math.max(depth, Math.abs(dot([T.cx[i] - cc[0], T.cy[i] - cc[1], T.cz[i] - cc[2]], n)) + T.rad[i]);
    cards.push({ c: cc, u, v, n, hu, hv, depth, area: A, members: g });
  }
  return cards;
}

// 16 sample cards spread over aspect and size, for the tile renders.
export function pickTiles(cards, count = 16) {
  const s = cards.filter((c) => c.members.length >= 3).slice().sort((a, b) => (a.hu / a.hv) - (b.hu / b.hv));
  const out = [];
  for (let k = 0; k < count && s.length; k++) {
    // From each aspect slice take the fullest card (most leaf area per card area).
    const lo = Math.floor((k * s.length) / count), hi = Math.max(lo + 1, Math.floor(((k + 1) * s.length) / count));
    let best = s[lo];
    for (let j = lo; j < hi; j++) if (s[j].area / (s[j].hu * s[j].hv) > best.area / (best.hu * best.hv)) best = s[j];
    out.push(best);
  }
  return out;
}

// Geometry of one cluster: the foliage triangles of its member islands.
function clusterParts(parts, T, card) {
  const want = new Set(card.members);
  return parts.map((p, pi) => {
    const ti = T.triIsland[pi], off = T.offset[pi];
    const I = [];
    for (let t = 0; t < ti.length; t++) if (want.has(off + ti[t])) I.push(p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]);
    return I.length ? compact({ ...p, indices: Uint32Array.from(I) }) : null;
  });
}

const TILE = 256, SS = 2;

// Render the tiles and build the atlas files (PNG) in workDir.
// mats[pi] = writeGLB material for foliage part pi (uris relative to
// workDir). rawTex(uri) -> { file, w, h }. Returns { diff, alpha, normal,
// orm, tiles: [{ aspect, uv: [u0, v0, u1, v1] }] }.
export async function bakeTiles(sharp, parts, T, tileCards, mats, workDir, rendererJs, rawTex) {
  mkdirSync(workDir, { recursive: true });
  const renders = [];
  const textures = {};
  for (const m of mats) for (const u of Object.values(m.maps)) if (u) textures[u] = await rawTex(path.resolve(workDir, u));
  tileCards.forEach((card, k) => {
    const cp = clusterParts(parts, T, card);
    const ps = [], ms = [];
    cp.forEach((p, i) => { if (p) { ps.push(p); ms.push(mats[i]); } });
    const glb = path.join(workDir, `tile${k}.glb`);
    writeFileSync(glb, writeGLB(ps, ms, { id: 'tile' + k }));
    const D = card.depth * 2 + 5;
    const eye = add(card.c, scale(card.n, D));
    renders.push({
      models: [{ glb, textures, offset: [0, 0, 0] }], mode: 'impostor', size: TILE * SS,
      views: [{ eye, target: card.c, up: card.v, ortho: card.hu, orthoY: card.hv, near: Math.max(0.001, D - card.depth * 1.1), far: D + card.depth * 1.1 }],
      out: { albedo: path.join(workDir, `tile${k}_a.rgba`), normal: path.join(workDir, `tile${k}_n.rgba`) },
    });
  });
  const jf = path.join(workDir, 'job.json');
  writeFileSync(jf, JSON.stringify({ renders }));
  execFileSync('deno', ['run', '-A', rendererJs, jf], { stdio: ['ignore', 'ignore', 'inherit'] });
  const S = TILE * 4;
  const diff = Buffer.alloc(S * S * 3), alpha = Buffer.alloc(S * S), nrm = Buffer.alloc(S * S * 3), orm = Buffer.alloc(S * S * 3);
  const tiles = [];
  tileCards.forEach((card, k) => {
    const W = TILE * SS;
    const A = readFileSync(path.join(workDir, `tile${k}_a.rgba`)), N = readFileSync(path.join(workDir, `tile${k}_n.rgba`));
    // Down-sample with coverage weights; normals to card tangent space.
    const ta = new Uint8Array(TILE * TILE * 4), tn = new Uint8Array(TILE * TILE * 4);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      let w = 0; const ca = [0, 0, 0], cn = [0, 0, 0]; let dep = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * W + x * SS + dx) * 4;
        const al = A[i + 3] / 255; w += al;
        for (let c = 0; c < 3; c++) ca[c] += A[i + c] * al;
        const wn = [N[i] / 127.5 - 1, N[i + 1] / 127.5 - 1, N[i + 2] / 127.5 - 1];
        cn[0] += dot(wn, card.u) * al; cn[1] += dot(wn, card.v) * al; cn[2] += dot(wn, card.n) * al;
        dep += (N[i + 3] / 255) * al;
      }
      const o = (y * TILE + x) * 4;
      if (w > 0) {
        for (let c = 0; c < 3; c++) ta[o + c] = Math.round(ca[c] / w);
        let t = norm(cn); if (t[2] < 0) t = [t[0], t[1], -t[2]];
        tn[o] = Math.round((t[0] * 0.5 + 0.5) * 255); tn[o + 1] = Math.round((t[1] * 0.5 + 0.5) * 255); tn[o + 2] = Math.round((t[2] * 0.5 + 0.5) * 255);
        tn[o + 3] = Math.round((dep / w) * 255);
      } else { tn[o] = 128; tn[o + 1] = 128; tn[o + 2] = 255; tn[o + 3] = 0; }
      ta[o + 3] = Math.round((w / (SS * SS)) * 255);
    }
    pushPull(ta, TILE, TILE);
    const tnc = new Uint8Array(tn); for (let i = 0; i < TILE * TILE; i++) tnc[i * 4 + 3] = ta[i * 4 + 3];
    pushPull(tnc, TILE, TILE);
    const ox = (k % 4) * TILE, oy = Math.floor(k / 4) * TILE;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x, j = (oy + y) * S + ox + x;
      diff[j * 3] = ta[i * 4]; diff[j * 3 + 1] = ta[i * 4 + 1]; diff[j * 3 + 2] = ta[i * 4 + 2];
      // A one texel clear border stops bleeding between tiles.
      const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      alpha[j] = edge ? 0 : ta[i * 4 + 3];
      nrm[j * 3] = tnc[i * 4]; nrm[j * 3 + 1] = tnc[i * 4 + 1]; nrm[j * 3 + 2] = tnc[i * 4 + 2];
      const d = tn[i * 4 + 3] / 255;
      orm[j * 3] = Math.round((0.45 + 0.55 * d) * 255); orm[j * 3 + 1] = 200; orm[j * 3 + 2] = 0;
    }
    const half = 0.5 / S;
    tiles.push({ aspect: card.hu / card.hv, uv: [ox / S + half, oy / S + half, (ox + TILE) / S - half, (oy + TILE) / S - half] });
    rmSync(path.join(workDir, `tile${k}_a.rgba`)); rmSync(path.join(workDir, `tile${k}_n.rgba`)); rmSync(path.join(workDir, `tile${k}.glb`));
  });
  const f = { diff: path.join(workDir, 'crown_diff.png'), alpha: path.join(workDir, 'crown_alpha.png'), normal: path.join(workDir, 'crown_nor.png'), orm: path.join(workDir, 'crown_arm.png') };
  await sharp(diff, { raw: { width: S, height: S, channels: 3 } }).png().toFile(f.diff);
  await sharp(alpha, { raw: { width: S, height: S, channels: 1 } }).png().toFile(f.alpha);
  await sharp(nrm, { raw: { width: S, height: S, channels: 3 } }).png().toFile(f.normal);
  await sharp(orm, { raw: { width: S, height: S, channels: 3 } }).png().toFile(f.orm);
  return { ...f, tiles };
}

// The card mesh: 4 vertices and 2 triangles per card. Normals bend away
// from the crown centre (soft volume light); the normal map gives the
// detail. Each card takes a tile of near aspect, with a random pick and
// mirror for variety.
export function crossCards(cards, k = 0.8) {
  // A second card per cluster, at a right angle about the long axis v, so
  // the cluster has body from the side views too.
  const out = [];
  for (const c of cards) {
    out.push(c);
    const n2 = c.u, u2 = cross(c.v, n2);
    out.push({ ...c, u: u2, n: n2, hu: Math.max(c.hu * k, 0.05) });
  }
  return out;
}

export function cardsPart(cards, tiles, crownCentre, seed = 3) {
  const r = rng(seed);
  const n = cards.length;
  const P = new Float32Array(n * 12), N = new Float32Array(n * 12), U = new Float32Array(n * 8), I = new Uint32Array(n * 6);
  const la = tiles.map((t) => Math.log(t.aspect));
  cards.forEach((c, k) => {
    const a = Math.log(c.hu / c.hv);
    const order = la.map((x, i) => [Math.abs(x - a), i]).sort((p, q) => p[0] - q[0]);
    const t = tiles[order[Math.min(order.length - 1, Math.floor(r() * 3))][1]];
    const flip = r() < 0.5;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const out = norm(sub(c.c, crownCentre));
    corners.forEach(([sx, sy], j) => {
      const p = add(c.c, add(scale(c.u, sx * c.hu), scale(c.v, sy * c.hv)));
      P.set(p, (k * 4 + j) * 3);
      let nn = norm(add(scale(c.n, dot(c.n, out) < 0 ? -0.6 : 0.6), scale(out, 0.8)));
      // Make sure that the bent normal stays on the card's front side.
      if (dot(nn, c.n) < 0.15) nn = norm(add(nn, scale(c.n, 0.3)));
      N.set(nn, (k * 4 + j) * 3);
      const ux = (flip ? -sx : sx) * 0.5 + 0.5, vy = sy * 0.5 + 0.5;
      U[(k * 4 + j) * 2] = t.uv[0] + (t.uv[2] - t.uv[0]) * ux;
      U[(k * 4 + j) * 2 + 1] = t.uv[3] - (t.uv[3] - t.uv[1]) * vy; // image top = +v
    });
    const b = k * 4;
    I.set(flip ? [b, b + 2, b + 1, b, b + 3, b + 2] : [b, b + 1, b + 2, b, b + 2, b + 3], k * 6);
  });
  return { positions: P, normals: N, uvs: U, indices: I };
}

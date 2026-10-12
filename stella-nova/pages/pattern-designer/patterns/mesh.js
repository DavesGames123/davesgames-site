// ============================================================================
//  PATTERN DESIGNER  ·  patterns/mesh.js — the cells and meshes family
// ----------------------------------------------------------------------------
//  The board cut into pieces: a Delaunay triangle mesh with soft tone
//  bands, Voronoi cells relaxed by Lloyd steps and set in lead, a
//  recursive cut of rectangles, and a crack network where each crack
//  stops at the first crack it meets.
//  Each entry is
//    { id, name, family, blurb, heavy?, params: { key: [min, max, step,
//      def, label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so each element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  DELAUNAY. Bowyer-Watson: each new point removes the triangles whose
//  circumcircle holds it and joins the hole edges to it. O(n^2) here,
//  which is fast for the 2500 points or fewer that these patterns use.
//  VORONOI. The cell of a site is the board cut by the bisector of each
//  Delaunay neighbour (clipHalf), so the cells are exact.
//
//  grep -n "id: '" for the list of patterns in this file.
//  grep -n "export function delaunay" for the triangulation.
// ============================================================================
import { TAU, clamp, clipHalf, chaikin, inset, poisson } from '../engine.js';
import { board, inkAt } from './kit.js';

// Triangles of a flat point list, as index triples [a, b, c, ...].
export function delaunay(P) {
  const n = P.length / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[2 * i]); x1 = Math.max(x1, P[2 * i]); y0 = Math.min(y0, P[2 * i + 1]); y1 = Math.max(y1, P[2 * i + 1]); }
  const d = Math.max(x1 - x0, y1 - y0) * 20, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const X = P.concat([mx - d, my - d, mx + d, my - d, mx, my + d]);
  const circ = (a, b, c) => {
    const ax = X[2 * a], ay = X[2 * a + 1], bx = X[2 * b], by = X[2 * b + 1], cx = X[2 * c], cy = X[2 * c + 1];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    return [a, b, c, ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2];
  };
  let T = [circ(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const px = X[2 * i], py = X[2 * i + 1], keep = [], edges = new Map();
    for (const t of T) {
      if ((px - t[3]) ** 2 + (py - t[4]) ** 2 < t[5]) {
        for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = a < b ? a * 1e6 + b : b * 1e6 + a; if (edges.has(k)) edges.delete(k); else edges.set(k, [a, b]); }
      } else keep.push(t);
    }
    for (const [a, b] of edges.values()) keep.push(circ(a, b, i));
    T = keep;
  }
  const out = [];
  for (const t of T) if (t[0] < n && t[1] < n && t[2] < n) out.push(t[0], t[1], t[2]);
  return out;
}
// Sites with a spacing field, plus the board corners and edge points.
function sites(ctx, n, contrast) {
  const { W, H, S, noise } = ctx, base = Math.sqrt(W * H / n) * 0.75;
  const rFn = (x, y) => base * (1 + contrast * (0.5 + 0.5 * noise.fbm(x / S * 1.8, y / S * 1.8, 2)) * 1.6) / (1 + contrast * 0.6);
  const p = poisson(W, H, rFn, base / (1 + contrast * 0.6) * 0.9, ctx.rnd, n * 2);
  return p;
}
// Delaunay neighbours of each point.
function neighbours(tri, n) {
  const nb = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < tri.length; i += 3) { const a = tri[i], b = tri[i + 1], c = tri[i + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  return nb;
}
function voronoiCells(pts, ctx) {
  const n = pts.length / 2, nb = neighbours(delaunay(pts), n), cells = [];
  for (let i = 0; i < n; i++) {
    let c = [0, 0, ctx.W, 0, ctx.W, ctx.H, 0, ctx.H];
    const xi = pts[2 * i], yi = pts[2 * i + 1];
    for (const j of nb[i]) {
      const xj = pts[2 * j], yj = pts[2 * j + 1], a = xj - xi, b = yj - yi;
      c = clipHalf(c, a, b, (xj * xj + yj * yj - xi * xi - yi * yi) / 2);
      if (c.length < 6) break;
    }
    cells.push(c);
  }
  return cells;
}
function areaCentroid(p) {
  let a = 0, x = 0, y = 0; const m = p.length / 2;
  for (let i = 0; i < m; i++) { const j = (i + 1) % m, c = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; a += c; x += (p[2 * i] + p[2 * j]) * c; y += (p[2 * i + 1] + p[2 * j + 1]) * c; }
  return Math.abs(a) < 1e-9 ? [p[0], p[1]] : [x / (3 * a), y / (3 * a)];
}

export default [
  {
    id: 'delaunay-mesh', name: 'Delaunay Mesh', family: 'mesh', heavy: true,
    blurb: 'Points with a varied spacing, joined into the triangle mesh whose circumcircles hold no other point. A soft tone field gives each triangle its ink.',
    params: { points: [40, 2400, 10, 700, 'Points'], contrast: [0, 2, 0.01, 0.9, 'Spacing contrast'], relax: [0, 8, 1, 2, 'Smoothing'], edges: [0, 1, 1, 1, 'Edges'], fill: [0, 1, 1, 1, 'Solid triangles'], tone: [0, 2, 1, 1, 'Tone field'], inks: [1, 5, 1, 4, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), pts = sites(ctx, P.points, P.contrast), n = pts.length / 2;
      // Keep the board edge covered: corners and points along each side.
      const ring = [0, 0, ctx.W, 0, ctx.W, ctx.H, 0, ctx.H], step = Math.sqrt(ctx.W * ctx.H / P.points);
      for (let x = step; x < ctx.W - step / 2; x += step) ring.push(x, 0, x, ctx.H);
      for (let y = step; y < ctx.H - step / 2; y += step) ring.push(0, y, ctx.W, y);
      let all = pts.concat(ring);
      for (let it = 0; it < P.relax; it++) {
        const nb = neighbours(delaunay(all), all.length / 2), nx = all.slice();
        for (let i = 0; i < n; i++) { let sx = 0, sy = 0; for (const j of nb[i]) { sx += all[2 * j]; sy += all[2 * j + 1]; } const k = nb[i].size || 1; nx[2 * i] = all[2 * i] * 0.5 + sx / k * 0.5; nx[2 * i + 1] = all[2 * i + 1] * 0.5 + sy / k * 0.5; }
        all = nx;
      }
      const tri = delaunay(all), ang = ctx.rng.range(0, TAU), fx = ctx.rng.range(0.25, 0.75) * ctx.W, fy = ctx.rng.range(0.25, 0.75) * ctx.H, D = Math.hypot(ctx.W, ctx.H);
      const tone = (x, y) => P.tone === 0 ? 0.5 + ((x - ctx.cx) * Math.cos(ang) + (y - ctx.cy) * Math.sin(ang)) / D : P.tone === 1 ? 1 - Math.hypot(x - fx, y - fy) / (D * 0.6) : 0.5 + 0.6 * ctx.noise.fbm(x / ctx.S * 1.4, y / ctx.S * 1.4, 3);
      for (let i = 0; i < tri.length && !B.full(); i += 3) {
        const a = tri[i], b = tri[i + 1], c = tri[i + 2], p = [all[2 * a], all[2 * a + 1], all[2 * b], all[2 * b + 1], all[2 * c], all[2 * c + 1]];
        const gx = (p[0] + p[2] + p[4]) / 3, gy = (p[1] + p[3] + p[5]) / 3;
        const ink = clamp(Math.floor((tone(gx, gy) + (ctx.rng.next() - 0.5) * 0.18) * P.inks), 0, P.inks - 1);
        if (P.fill) B.poly(p, true, { f: ink, s: P.edges ? -2 : -1, w: 0.35 });
        else B.poly(p, true, { f: -1, s: ink, w: 0.5 });
      }
    },
  },
  {
    id: 'lead-glass', name: 'Lead Glass', family: 'mesh',
    blurb: 'Voronoi cells, moved toward their centroids a few times so they even out, then cut back and rounded and set in a dark lead frame.',
    params: { cells: [12, 900, 1, 140, 'Cells'], lloyd: [0, 8, 1, 3, 'Lloyd steps'], lead: [0.5, 12, 0.1, 4, 'Lead width'], round: [0, 3, 1, 2, 'Rounding'], contrast: [0, 2, 0.01, 0.5, 'Size contrast'], radial: [0, 1, 1, 0, 'Radial colour'], inks: [2, 5, 1, 4, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx);
      let pts = sites(ctx, P.cells, P.contrast);
      for (let it = 0; it < P.lloyd; it++) {
        const cells = voronoiCells(pts, ctx), nx = [];
        cells.forEach((c, i) => { if (c.length >= 6) nx.push(...areaCentroid(c)); else nx.push(pts[2 * i], pts[2 * i + 1]); });
        pts = nx;
      }
      B.rect(0, 0, ctx.W, ctx.H, { f: 0 });
      const cells = voronoiCells(pts, ctx), fx = ctx.rng.range(0.3, 0.7) * ctx.W, fy = ctx.rng.range(0.3, 0.7) * ctx.H, D = Math.hypot(ctx.W, ctx.H) * 0.55;
      for (const c of cells) {
        if (c.length < 6 || B.full()) continue;
        const [gx, gy] = areaCentroid(c);
        let q = inset(c, P.lead);
        if (P.round) q = chaikin(q, P.round, true);
        const k = P.radial ? clamp(Math.floor(Math.hypot(gx - fx, gy - fy) / D * (P.inks - 1) + ctx.rng.next() * 0.6), 0, P.inks - 2) : inkAt(ctx, gx, gy, P.inks - 1, 0.45);
        B.poly(q, true, { f: k + 1 });
      }
    },
  },
  {
    id: 'rect-split', name: 'Rect Split', family: 'mesh',
    blurb: 'The board cut in two again and again, across its long side, at thirds, halves or golden cuts. A few of the parts take a solid ink inside thick black rules.',
    params: { depth: [2, 12, 1, 7, 'Cuts deep'], min: [0.03, 0.3, 0.005, 0.08, 'Smallest part'], colour: [0, 1, 0.01, 0.3, 'Coloured parts'], rule: [0.5, 10, 0.1, 4, 'Rule weight'], golden: [0, 1, 0.01, 0.5, 'Golden cuts'], inks: [2, 5, 1, 4, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, minS = ctx.S * P.min, leaves = [], cuts = [];
      const split = (x, y, w, h, d) => {
        const long = w >= h, len = long ? w : h;
        if (d >= P.depth || len < 2 * minS || (d > 1 && r.chance(0.12 * d / P.depth))) { leaves.push([x, y, w, h]); return; }
        let f = r.chance(P.golden) ? (r.chance(0.5) ? 0.382 : 0.618) : r.pick([1 / 3, 0.5, 2 / 3]);
        f = clamp(f, minS / len, 1 - minS / len);
        if (long) { const c = w * f; cuts.push([x + c, y, x + c, y + h]); split(x, y, c, h, d + 1); split(x + c, y, w - c, h, d + 1); }
        else { const c = h * f; cuts.push([x, y + c, x + w, y + c]); split(x, y, w, c, d + 1); split(x, y + c, w, h - c, d + 1); }
      };
      split(0, 0, ctx.W, ctx.H, 0);
      for (const [x, y, w, h] of leaves) if (r.chance(P.colour)) B.rect(x, y, w, h, { f: 1 + r.int(0, P.inks - 2) });
      for (const [x0, y0, x1, y1] of cuts) B.line(x0, y0, x1, y1, { s: 0, w: P.rule });
      B.rect(0, 0, ctx.W, ctx.H, { f: -1, s: 0, w: P.rule * 2 });
    },
  },
  {
    id: 'crackle', name: 'Crackle', family: 'mesh',
    blurb: 'Cracks that run across a glaze and stop at the first crack they meet. Later cracks branch off older ones at near right angles and grow thinner.',
    params: { cracks: [10, 600, 1, 160, 'Cracks'], first: [1, 12, 1, 4, 'First cracks'], wiggle: [0, 1, 0.01, 0.35, 'Wiggle'], taper: [0, 1, 0.01, 0.6, 'Taper'], weight: [0.3, 5, 0.05, 1.8, 'Line weight'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, cs = 3, gw = Math.ceil(ctx.W / cs), gh = Math.ceil(ctx.H / cs), G = new Int32Array(gw * gh), L = 6;
      const lines = [], seeds = [];
      const cellAt = (x, y) => clamp(Math.floor(y / cs), 0, gh - 1) * gw + clamp(Math.floor(x / cs), 0, gw - 1);
      // Grow one crack from (x, y) along angle a; id marks its own cells.
      const grow = (x, y, a, id, gen) => {
        const p = [x, y]; let n = 0, own = [];
        for (;;) {
          a += (r.next() - 0.5) * P.wiggle * 0.5;
          const nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L;
          if (nx < 0 || ny < 0 || nx > ctx.W || ny > ctx.H) { p.push(clamp(nx, 0, ctx.W), clamp(ny, 0, ctx.H)); break; }
          let hit = false;
          for (let s = 1; s <= 3 && !hit; s++) { const qx = x + (nx - x) * s / 3, qy = y + (ny - y) * s / 3, c = G[cellAt(qx, qy)]; if (c && (c !== id || own.length > 4 && !own.slice(-4).includes(cellAt(qx, qy)))) { p.push(qx, qy); hit = true; } }
          if (hit) break;
          x = nx; y = ny; p.push(x, y);
          const c = cellAt(x, y); G[c] = id; own.push(c);
          if (++n % 3 === 0) seeds.push([x, y, a, gen]);
          if (n > 900) break;
        }
        return p;
      };
      let id = 1;
      for (let k = 0; k < P.first; k++) {
        const x = r.range(0.1, 0.9) * ctx.W, y = r.range(0.1, 0.9) * ctx.H, a = r.range(0, TAU), me = id++;
        const f = grow(x, y, a, me, 0), b = grow(x, y, a + Math.PI, me, 0);
        const pts = []; for (let i = b.length - 2; i >= 2; i -= 2) pts.push(b[i], b[i + 1]); lines.push([pts.concat(f), 0]);
      }
      for (let k = 0; k < P.cracks && seeds.length; k++) {
        const i = r.int(0, seeds.length - 1), [x, y, a, g] = seeds[i];
        const p = grow(x, y, a + r.sign() * (Math.PI / 2 + (r.next() - 0.5) * 0.5), id++, g + 1);
        if (p.length >= 4) lines.push([p, g + 1]);
      }
      for (const [p, g] of lines) {
        if (B.full()) break;
        B.poly(p, false, { s: Math.min(g, P.inks - 1), w: P.weight * Math.max(0.25, 1 - P.taper * Math.min(1, g / 4)) });
      }
    },
  },
];

// ============================================================================
//  PATTERN DESIGNER  ·  patterns/tiling.js — the tiling family
// ----------------------------------------------------------------------------
//  Tiles that fill the plane: a golden-ratio rhomb tiling made by repeated
//  splits, Truchet tiles at many scales and in mirror motifs, hex and
//  triangle tiles whose edges match, star rosettes from rays at a contact
//  angle, the Cairo pentagon tiling and herringbone bricks. All the
//  constructions are general geometry, written here from first principles.
//  Each entry is
//    { id, name, family, blurb, heavy?, params: { key: [min, max, step,
//      def, label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so every element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  grep -n "id: '" for the list of patterns in this file.
//  grep -n "const BASES" for the base tilings of the star rosettes.
// ============================================================================
import { TAU, clamp, inset } from '../engine.js';
import { board, cells, hexCells, inkAt, arcPts, segX, turn } from './kit.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const key2 = (x, y) => Math.round(x * 8) + ',' + Math.round(y * 8);

// A quarter annulus about (cx, cy) from angle a0, radii ri..ro, as a ring.
function quarterBand(cx, cy, ri, ro, a0) {
  const o = arcPts(cx, cy, ro, a0, a0 + Math.PI / 2, 4), i = arcPts(cx, cy, ri, a0 + Math.PI / 2, a0, 4);
  return o.concat(i);
}

// Base tilings for the star rosettes: polygons in one lattice cell (side
// about 1) and the two lattice vectors.
const R3 = Math.sqrt(3), OA = Math.SQRT2 - 1;
const ring = (n, r, a0) => { const p = []; for (let k = 0; k < n; k++) p.push([r * Math.cos(a0 + TAU * k / n), r * Math.sin(a0 + TAU * k / n)]); return p; };
const BASES = [
  { name: 'square', t1: [1, 0], t2: [0, 1], polys: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
  { name: 'hexagon', t1: [R3, 0], t2: [R3 / 2, 1.5], polys: [ring(6, 1, -Math.PI / 2)] },
  { name: 'octagon and square', t1: [1, 0], t2: [0, 1], polys: [
    [[0.5, OA / 2], [OA / 2, 0.5], [-OA / 2, 0.5], [-0.5, OA / 2], [-0.5, -OA / 2], [-OA / 2, -0.5], [OA / 2, -0.5], [0.5, -OA / 2]],
    [[0.5, OA / 2], [1 - OA / 2, 0.5], [0.5, 1 - OA / 2], [OA / 2, 0.5]]] },
  { name: 'hexagon and triangle', t1: [2, 0], t2: [1, R3], polys: [ring(6, 1, 0),
    [[1, 0], [1.5, R3 / 2], [0.5, R3 / 2]], [[1.5, R3 / 2], [2.5, R3 / 2], [2, R3]]] },
];

export default [
  {
    id: 'rhomb-inflation', name: 'Rhomb Inflation', family: 'tiling',
    blurb: 'A thin and a thick rhomb, made from triangles that split by the golden ratio again and again. The tiling never repeats, and arcs on the tiles join into long closed curves.',
    params: { depth: [3, 8, 1, 5, 'Splits'], zoom: [1, 3, 0.01, 1.3, 'Zoom'], gap: [0, 0.2, 0.005, 0.03, 'Joint'], fill: [0, 1, 1, 1, 'Solid tiles'], arcs: [0, 1, 1, 1, 'Arcs'], inks: [1, 5, 1, 3, 'Inks'], weight: [0.3, 5, 0.1, 1.4, 'Line weight'] },
    gen(P, ctx) {
      const B = board(ctx), R = Math.hypot(ctx.W, ctx.H) / 2 * P.zoom, rot = ctx.rng.range(0, TAU), { cx, cy } = ctx;
      let tris = [];
      for (let i = 0; i < 10; i++) {
        let b = [cx + R * Math.cos(rot + (2 * i - 1) * Math.PI / 10), cy + R * Math.sin(rot + (2 * i - 1) * Math.PI / 10)];
        let c = [cx + R * Math.cos(rot + (2 * i + 1) * Math.PI / 10), cy + R * Math.sin(rot + (2 * i + 1) * Math.PI / 10)];
        if (i % 2 === 0) [b, c] = [c, b];
        tris.push([0, cx, cy, b[0], b[1], c[0], c[1]]);
      }
      const off = t => { const m = 4; return Math.max(t[1], t[3], t[5]) < -m || Math.min(t[1], t[3], t[5]) > ctx.W + m || Math.max(t[2], t[4], t[6]) < -m || Math.min(t[2], t[4], t[6]) > ctx.H + m; };
      for (let d = 0; d < P.depth; d++) {
        const nx = [];
        for (const [k, ax, ay, bx, by, qx, qy] of tris) {
          if (k === 0) {
            const px = ax + (bx - ax) / PHI, py = ay + (by - ay) / PHI;
            nx.push([0, qx, qy, px, py, bx, by], [1, px, py, qx, qy, ax, ay]);
          } else {
            const ux = bx + (ax - bx) / PHI, uy = by + (ay - by) / PHI, vx = bx + (qx - bx) / PHI, vy = by + (qy - by) / PHI;
            nx.push([1, vx, vy, qx, qy, ax, ay], [1, ux, uy, vx, vy, bx, by], [0, vx, vy, ux, uy, ax, ay]);
          }
        }
        tris = nx.filter(t => !off(t));
      }
      // Join the two triangles on each base edge BC into one rhomb A B A' C.
      const half = new Map(), rh = [];
      for (const t of tris) {
        const kb = key2(t[3], t[4]), kc = key2(t[5], t[6]), k = kb < kc ? kb + '|' + kc : kc + '|' + kb;
        const o = half.get(k);
        if (o) { rh.push([t[0], [t[1], t[2], t[3], t[4], o[1], o[2], t[5], t[6]]]); half.delete(k); } else half.set(k, t);
      }
      for (const t of half.values()) rh.push([t[0], [t[1], t[2], t[3], t[4], t[5], t[6]]]);
      const side = R / Math.pow(PHI, P.depth);
      for (const [k, p] of rh) {
        if (B.full()) break;
        const ink = k === 0 ? 1 % P.inks : P.inks <= 2 ? 0 : [0, 2, 3, 4][inkAt(ctx, p[0], p[1], P.inks - 1, 0.15) % (P.inks - 1)];
        const q = P.gap > 0 ? inset(p, P.gap * side) : p;
        if (P.fill) B.poly(q, true, { f: ink });
        else B.poly(q, true, { f: -1, s: ink, w: P.weight * 0.6 });
        if (P.arcs && p.length === 8) {
          // An arc about each apex (A and A') through the midpoints of its two edges.
          for (const [ax, ay, bx, by, qx, qy] of [[p[0], p[1], p[2], p[3], p[6], p[7]], [p[4], p[5], p[2], p[3], p[6], p[7]]]) {
            const r = Math.hypot(bx - ax, by - ay) / 2, a0 = Math.atan2(by - ay, bx - ax);
            let a1 = Math.atan2(qy - ay, qx - ax); while (a1 - a0 > Math.PI) a1 -= TAU; while (a0 - a1 > Math.PI) a1 += TAU;
            B.poly(arcPts(ax, ay, r, a0, a1, 3), false, { s: P.fill ? -2 : 0, w: P.weight });
          }
        }
      }
    },
  },
  {
    id: 'nested-truchet', name: 'Nested Truchet', family: 'tiling',
    blurb: 'Quarter-ring tiles on a grid that splits into smaller cells. Ink and paper swap at each level, so the bands of small tiles weave over the large ones.',
    params: { cells: [2, 10, 1, 4, 'Cells'], depth: [0, 3, 1, 2, 'Levels'], split: [0, 1, 0.01, 0.5, 'Split'], band: [0.15, 0.6, 0.01, 0.34, 'Band width'], dots: [0, 1, 1, 1, 'Edge dots'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      // The split depth is cut so that cells x 2^depth stays at 40 (times
      // D at a higher density) or less: the element budget at the finest level.
      const B = board(ctx), g = cells(ctx, P.cells), depth = Math.min(P.depth, Math.floor(Math.log2(Math.min(120, 40 * Math.max(1, ctx.D || 1)) / P.cells)));
      const tile = (x, y, s, lv) => {
        const ink = P.inks === 1 ? 0 : inkAt(ctx, x + s / 2, y + s / 2, P.inks, 0.2);
        const odd = lv % 2 === 1, fg = odd ? -2 : ink, bw = s * P.band;
        if (odd) B.rect(x, y, s, s, { f: ink });
        const flip = ctx.rng.chance(0.5), cs = flip ? [[x, y, 0], [x + s, y + s, Math.PI]] : [[x + s, y, Math.PI / 2], [x, y + s, -Math.PI / 2]];
        for (const [cx, cy, a0] of cs) B.poly(quarterBand(cx, cy, s / 2 - bw / 2, s / 2 + bw / 2, a0), true, { f: fg });
        if (P.dots) for (const [dx, dy] of [[s / 2, 0], [s, s / 2], [s / 2, s], [0, s / 2]]) B.circle(x + dx, y + dy, bw / 2, { f: fg });
      };
      const cell = (x, y, s, lv) => {
        if (B.full()) return;
        if (x > ctx.W || y > ctx.H || x + s < 0 || y + s < 0) return;
        if (lv < depth && ctx.rng.chance(P.split)) { const h = s / 2; cell(x, y, h, lv + 1); cell(x + h, y, h, lv + 1); cell(x, y + h, h, lv + 1); cell(x + h, y + h, h, lv + 1); }
        else tile(x, y, s, lv);
      };
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) cell(g.x0 + i * g.s, g.y0 + j * g.s, g.s, 0);
    },
  },
  {
    id: 'mirror-truchet', name: 'Mirror Truchet', family: 'tiling',
    blurb: 'Half-square triangles in four turns. A small random motif is mirrored or turned across the board, so diamonds, crowns and steps appear.',
    params: { cells: [4, 48, 1, 16, 'Cells'], motif: [1, 6, 1, 3, 'Motif size'], mode: [0, 2, 1, 0, 'Symmetry'], hatch: [0, 1, 1, 0, 'Hatched'], lines: [2, 12, 1, 5, 'Hatch lines'], gap: [0, 0.15, 0.005, 0, 'Gap'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), g = cells(ctx, P.cells), k = P.motif, M = [];
      for (let j = 0; j < k; j++) { M.push([]); for (let i = 0; i < k; i++) M[j].push(ctx.rng.int(0, 3)); }
      // o: the corner of the solid half, 0 top left, 1 top right, 2 bottom right, 3 bottom left.
      const HX = [1, 0, 3, 2], VY = [3, 2, 1, 0];
      const orient = (i, j) => {
        const bi = Math.floor(i / k), bj = Math.floor(j / k), li = ((i % k) + k) % k, lj = ((j % k) + k) % k;
        if (P.mode === 2) return M[lj][li];
        if (P.mode === 1) {
          const q = ((bi & 1) + 2 * (bj & 1)), turns = [0, 1, 3, 2][q];
          let a = li, b = lj; for (let t = 0; t < turns; t++) [a, b] = [k - 1 - b, a];
          return (M[b][a] + turns) % 4;
        }
        let o = M[bj & 1 ? k - 1 - lj : lj][bi & 1 ? k - 1 - li : li];
        if (bi & 1) o = HX[o];
        if (bj & 1) o = VY[o];
        return o;
      };
      for (let j = 0; j < g.ny && !B.full(); j++) for (let i = 0; i < g.nx; i++) {
        const s = g.s, gp = P.gap * s, x = g.x0 + i * s + gp / 2, y = g.y0 + j * s + gp / 2, w = s - gp;
        const C = [[x, y], [x + w, y], [x + w, y + w], [x, y + w]], o = orient(i, j);
        const ink = P.inks === 1 ? 0 : inkAt(ctx, g.x0 + Math.floor(i / (2 * k)) * 2 * k * s, g.y0 + Math.floor(j / (2 * k)) * 2 * k * s, P.inks, 0.25);
        const a = C[(o + 3) % 4], b = C[o], c = C[(o + 1) % 4];
        if (!P.hatch) { B.poly([a[0], a[1], b[0], b[1], c[0], c[1]], true, { f: ink }); continue; }
        // Lines parallel to the diagonal a-c, from the corner b inward, at
        // least 5 units apart.
        const nl = Math.max(1, Math.min(P.lines, Math.floor(w / 5)));
        for (let n = 1; n <= nl; n++) {
          const t = n / (nl + 0.5);
          B.line(b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, { s: ink, w: 1 });
        }
      }
    },
  },
  {
    id: 'diagonal-paths', name: 'Diagonal Paths', family: 'tiling',
    blurb: 'Each cell holds one diagonal. The diagonals join end to end into long paths that turn at every cell, and each path takes one ink.',
    params: { cells: [6, 70, 1, 26, 'Cells'], bias: [0, 1, 0.01, 0.5, 'Slant bias'], soft: [0, 1, 1, 1, 'Soft corners'], weight: [0.4, 10, 0.1, 3, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'], long: [0, 1, 0.01, 0.6, 'Long paths'] },
    gen(P, ctx) {
      const B = board(ctx), g = cells(ctx, P.cells), vx = g.nx + 1, edges = [], at = new Map();
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
        const back = ctx.rng.chance(P.bias);
        const a = back ? j * vx + i : j * vx + i + 1, b = back ? (j + 1) * vx + i + 1 : (j + 1) * vx + i, e = edges.length;
        edges.push([a, b]);
        for (const v of [a, b]) { if (!at.has(v)) at.set(v, []); at.get(v).push(e); }
      }
      const P2 = v => [g.x0 + (v % vx) * g.s, g.y0 + Math.floor(v / vx) * g.s], used = new Uint8Array(edges.length);
      // Grow a chain from vertex v that came in along direction (dx, dy).
      const grow = (v, dx, dy, pts, front) => {
        for (;;) {
          const cand = (at.get(v) || []).filter(e => !used[e]);
          if (!cand.length) return;
          let best = cand[0], bs = -9;
          for (const e of cand) {
            const w = edges[e][0] === v ? edges[e][1] : edges[e][0], [x0, y0] = P2(v), [x1, y1] = P2(w), s = ((x1 - x0) * dx + (y1 - y0) * dy) / g.s * (ctx.rng.chance(P.long) ? 1 : -1) + ctx.rng.next() * 0.1;
            if (s > bs) { bs = s; best = e; }
          }
          used[best] = 1;
          const w = edges[best][0] === v ? edges[best][1] : edges[best][0], [x0, y0] = P2(v), [x1, y1] = P2(w);
          if (front) pts.unshift(x1, y1); else pts.push(x1, y1);
          dx = (x1 - x0) / g.s; dy = (y1 - y0) / g.s; v = w;
        }
      };
      let n = 0;
      for (let e = 0; e < edges.length && !B.full(); e++) {
        if (used[e]) continue;
        used[e] = 1;
        const [a, b] = edges[e], [ax, ay] = P2(a), [bx, by] = P2(b), pts = [ax, ay, bx, by];
        grow(b, (bx - ax) / g.s, (by - ay) / g.s, pts, false);
        grow(a, (ax - bx) / g.s, (ay - by) / g.s, pts, true);
        const ink = P.inks === 1 ? 0 : (n++ * 7 + ctx.rng.int(0, P.inks - 1)) % P.inks;
        B.poly(pts, false, { s: ink, w: P.weight, sm: P.soft ? 1 : 0 });
      }
    },
  },
  {
    id: 'hex-arcs', name: 'Hex Arcs', family: 'tiling',
    blurb: 'Hexagon tiles that link the midpoints of their six edges in pairs, with short arcs or a straight bar. Every edge meets the next tile, so the lines never stop.',
    params: { size: [4, 30, 1, 10, 'Hexes across'], bands: [1, 5, 1, 2, 'Lines per path'], straight: [0, 1, 0.01, 0.25, 'Straight tiles'], weight: [0.4, 8, 0.1, 2.4, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'], frame: [0, 1, 1, 0, 'Hex outlines'] },
    gen(P, ctx) {
      // At most one line per 7 units of radius (less at a higher density)
      // keeps a dense board in budget.
      const B = board(ctx), R = ctx.S / (P.size * Math.sqrt(3)), nb = Math.max(1, Math.min(P.bands, Math.floor(R * Math.sqrt(Math.max(1, ctx.D || 1)) / 7))), g = 0.38 * R / nb;
      hexCells(ctx, R, (cx, cy) => {
        const V = [], M = [];
        for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * Math.PI / 3; V.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
        for (let k = 0; k < 6; k++) { const a = V[k], b = V[(k + 1) % 6]; M.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
        const ink = P.inks === 1 ? 0 : inkAt(ctx, cx, cy, P.inks, 0.3);
        if (P.frame) B.poly(V.flat(), true, { f: -1, s: (ink + 1) % P.inks, w: 0.4 });
        const smallArc = k => {   // between edge k and k+1, about vertex k+1
          const v = V[(k + 1) % 6], m0 = M[k], m1 = M[(k + 1) % 6], a0 = Math.atan2(m0[1] - v[1], m0[0] - v[0]);
          let a1 = Math.atan2(m1[1] - v[1], m1[0] - v[0]); while (a1 - a0 > Math.PI) a1 -= TAU; while (a0 - a1 > Math.PI) a1 += TAU;
          for (let b = 0; b < nb; b++) B.poly(arcPts(v[0], v[1], R / 2 + (b - (nb - 1) / 2) * g, a0, a1, 3), false, { s: ink, w: P.weight });
        };
        if (ctx.rng.chance(P.straight)) {
          const k = ctx.rng.int(0, 2), m0 = M[k], m1 = M[k + 3], dx = m1[0] - m0[0], dy = m1[1] - m0[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
          for (let b = 0; b < nb; b++) { const o = (b - (nb - 1) / 2) * g; B.line(m0[0] + nx * o, m0[1] + ny * o, m1[0] + nx * o, m1[1] + ny * o, { s: ink, w: P.weight }); }
          smallArc(k + 1); smallArc((k + 4) % 6);
        } else { const k = ctx.rng.int(0, 1); smallArc(k); smallArc(k + 2); smallArc((k + 4) % 6); }
      });
    },
  },
  {
    id: 'triangle-wang', name: 'Triangle Wang', family: 'tiling',
    blurb: 'Triangle tiles with a colour on each edge. Each tile is cut into three parts, one per edge, so two tiles that share an edge make one rhomb of that colour.',
    params: { size: [3, 40, 1, 12, 'Triangles across'], inks: [2, 5, 1, 3, 'Inks'], order: [0, 1, 0.01, 0.4, 'Random edges'], gap: [0, 0.25, 0.005, 0.03, 'Gap'], holes: [0, 1, 1, 0, 'Paper edges'] },
    gen(P, ctx) {
      const B = board(ctx), a = ctx.W / P.size * 1.0001, h = a * Math.sqrt(3) / 2, col = new Map();
      const X = (u, v) => [a * (u + v / 2), h * v];
      const edgeInk = (p, q) => {
        const k = key2(p[0] + q[0], p[1] + q[1]);
        if (!col.has(k)) {
          const n = P.inks + (P.holes ? 1 : 0), c = inkAt(ctx, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, n, P.order, 0.004);
          col.set(k, P.holes && c === n - 1 ? -1 : c);
        }
        return col.get(k);
      };
      const nv = Math.ceil(ctx.H / h) + 1;
      for (let v = -1; v < nv && !B.full(); v++) for (let u = -Math.ceil(nv / 2) - 2; u < P.size + 2; u++) {
        for (const tri of [[X(u, v), X(u + 1, v), X(u, v + 1)], [X(u + 1, v), X(u + 1, v + 1), X(u, v + 1)]]) {
          const gx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, gy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          if (gx < -a || gx > ctx.W + a || gy < -a || gy > ctx.H + a) continue;
          for (let e = 0; e < 3; e++) {
            const p = tri[e], q = tri[(e + 1) % 3], ink = edgeInk(p, q);
            if (ink < 0) continue;
            let r = [gx, gy, p[0], p[1], q[0], q[1]];
            if (P.gap > 0) r = inset(r, P.gap * a * 0.5);
            B.poly(r, true, { f: ink });
          }
        }
      }
    },
  },
  {
    id: 'star-rosettes', name: 'Star Rosettes', family: 'tiling',
    blurb: 'Star patterns from a plain base tiling: two rays leave the middle of each edge at a contact angle and stop where they meet the rays of the next edge.',
    params: { base: [0, 3, 1, 2, 'Base tiling'], size: [2, 14, 1, 5, 'Tiles across'], angle: [20, 80, 1, 62, 'Contact angle'], gap: [0, 0.3, 0.005, 0, 'Ray gap'], strap: [0, 1, 1, 1, 'Straps'], fill: [0, 1, 1, 1, 'Fill stars'], inks: [1, 5, 1, 3, 'Inks'], weight: [0.5, 8, 0.1, 3, 'Line weight'] },
    gen(P, ctx) {
      const B = board(ctx), base = BASES[P.base], L = Math.hypot(...base.t1), k = ctx.W / (P.size * L), th = P.angle * Math.PI / 180;
      const ct = Math.cos(th), st = Math.sin(th), D = Math.ceil(Math.hypot(ctx.W, ctx.H) / (k * Math.min(L, Math.hypot(...base.t2) * 0.8))) + 2;
      // The seed shifts the lattice and deals the inks to the tile kinds.
      const fills = [], lines = [], sx = ctx.rng.next(), sy = ctx.rng.next(), deal = ctx.rng.shuffle([0, 1, 2, 3, 4]);
      for (let j = -D; j <= D; j++) for (let i = -D; i <= D; i++) {
        const ox = ctx.cx + k * ((i + sx) * base.t1[0] + (j + sy) * base.t2[0]), oy = ctx.cy + k * ((i + sx) * base.t1[1] + (j + sy) * base.t2[1]);
        base.polys.forEach((poly, pi) => {
          const V = poly.map(([x, y]) => [ox + k * x, oy + k * y]), n = V.length;
          let gx = 0, gy = 0; for (const v of V) { gx += v[0] / n; gy += v[1] / n; }
          if (gx < -k * 2 || gy < -k * 2 || gx > ctx.W + k * 2 || gy > ctx.H + k * 2) return;
          const E = V.map((v, e) => {
            const w = V[(e + 1) % n], dx = w[0] - v[0], dy = w[1] - v[1], l = Math.hypot(dx, dy), d = [dx / l, dy / l], mx = (v[0] + w[0]) / 2, my = (v[1] + w[1]) / 2;
            let nn = [-d[1], d[0]]; if (nn[0] * (gx - mx) + nn[1] * (gy - my) < 0) nn = [-nn[0], -nn[1]];
            return { m: [mx, my], d, n: nn, l };
          });
          const ringP = [], petals = [], rmax = Math.max(...V.map(v => Math.hypot(v[0] - gx, v[1] - gy))) * 1.6;
          for (let e = 0; e < n; e++) {
            const A = E[e], C = E[(e + 1) % n], dl = P.gap * A.l * 0.5, dl2 = P.gap * C.l * 0.5;
            const p = [A.m[0] + A.d[0] * dl, A.m[1] + A.d[1] * dl], q = [C.m[0] - C.d[0] * dl2, C.m[1] - C.d[1] * dl2];
            const X = segX(p[0], p[1], ct * A.d[0] + st * A.n[0], ct * A.d[1] + st * A.n[1], q[0], q[1], -ct * C.d[0] + st * C.n[0], -ct * C.d[1] + st * C.n[1]);
            const qa = [A.m[0] - A.d[0] * dl, A.m[1] - A.d[1] * dl];
            ringP.push(qa[0], qa[1], p[0], p[1]);
            if (!X || X[2] <= 0 || X[3] <= 0 || Math.hypot(X[0] - gx, X[1] - gy) > rmax) continue;
            ringP.push(X[0], X[1]);
            petals.push([p[0], p[1], X[0], X[1], q[0], q[1]]);
          }
          if (P.fill && ringP.length >= 6) fills.push([ringP, deal[pi + (n > 4 ? 1 : 0)] % P.inks]);
          if (P.gap > 0) for (const pt of petals) lines.push([pt, false]);
          else if (petals.length) { const r = []; for (const pt of petals) r.push(pt[0], pt[1], pt[2], pt[3]); lines.push([r, true]); }
        });
      }
      for (const [r, ink] of fills) B.poly(r, true, { f: P.inks === 1 ? -1 : ink, s: P.inks === 1 ? 0 : -1, w: 0.5 });
      for (const [r, c] of lines) B.poly(r, c, { f: -1, s: 0, w: P.weight * (P.strap ? 1.9 : 1) });
      if (P.strap) for (const [r, c] of lines) B.poly(r, c, { f: -1, s: -2, w: P.weight * 0.9 });
    },
  },
  {
    id: 'cairo-tiles', name: 'Cairo Pentagons', family: 'tiling',
    blurb: 'Pentagons that fill the plane, four around each crossing. Each one wraps an edge of a hidden square grid, bent around short bars that alternate across and down.',
    params: { size: [2, 20, 1, 7, 'Cells across'], bar: [0.05, 0.45, 0.005, 0.27, 'Bar length'], turn: [0, 90, 1, 0, 'Turn'], gap: [0, 0.2, 0.005, 0.04, 'Joint'], inks: [1, 5, 1, 4, 'Inks'], field: [0, 1, 1, 0, 'Colour by field'], outline: [0, 1, 1, 0, 'Outlines only'] },
    gen(P, ctx) {
      const B = board(ctx), a = ctx.S / P.size, rot = P.turn * Math.PI / 180, h = P.bar, D = Math.ceil(Math.hypot(ctx.W, ctx.H) / 2 / a) + 2;
      const c = Math.cos(rot), s = Math.sin(rot), sx = ctx.rng.next() * 2, sy = ctx.rng.next() * 2, deal = ctx.rng.shuffle([0, 1, 2, 3]);
      const T = (x, y) => [ctx.cx + a * ((x - sx) * c - (y - sy) * s), ctx.cy + a * ((x - sx) * s + (y - sy) * c)];
      const bar = (i, j) => { const mx = i + 0.5, my = j + 0.5; return ((i + j) & 1) === 0 ? [[mx - h, my], [mx + h, my], 0] : [[mx, my - h], [mx, my + h], 1]; };
      const pent = (e0, e1, sqA, sqB, horiz) => {
        // sqA, sqB: the squares on the two sides of the edge e0-e1.
        const [a0, a1, oa] = bar(...sqA), [b0, b1] = bar(...sqB), par = (oa === 0) === horiz;
        const quad = par ? [a0, a1] : [b0, b1], tri = par ? [b0, b1] : [a0, a1];
        quad.sort((p, q) => Math.hypot(p[0] - e0[0], p[1] - e0[1]) - Math.hypot(q[0] - e0[0], q[1] - e0[1]));
        const mx = (e0[0] + e1[0]) / 2, my = (e0[1] + e1[1]) / 2;
        const tp = Math.hypot(tri[0][0] - mx, tri[0][1] - my) < Math.hypot(tri[1][0] - mx, tri[1][1] - my) ? tri[0] : tri[1];
        return { pts: [e0, quad[0], quad[1], e1, tp], cls: (horiz ? 0 : 2) + (par ? (sqA[0] + sqA[1]) & 1 : (sqB[0] + sqB[1]) & 1) };
      };
      for (let j = -D; j <= D && !B.full(); j++) for (let i = -D; i <= D; i++) {
        for (const [e0, e1, sa, sb, hz] of [[[i, j], [i + 1, j], [i, j - 1], [i, j], true], [[i, j], [i, j + 1], [i - 1, j], [i, j], false]]) {
          const { pts, cls } = pent(e0, e1, sa, sb, hz);
          let r = []; for (const p of pts) r.push(...T(p[0], p[1]));
          let gx = 0, gy = 0; for (let q = 0; q < 10; q += 2) { gx += r[q] / 5; gy += r[q + 1] / 5; }
          if (gx < -a || gy < -a || gx > ctx.W + a || gy > ctx.H + a) continue;
          if (P.gap > 0) r = inset(r, P.gap * a * 0.5);
          const ink = P.inks === 1 ? 0 : P.field ? inkAt(ctx, gx, gy, P.inks, 0.2) : deal[cls] % P.inks;
          if (P.outline) B.poly(r, true, { f: -1, s: ink, w: 1.2 }); else B.poly(r, true, { f: ink });
        }
      }
    },
  },
  {
    id: 'herringbone', name: 'Herringbone', family: 'tiling',
    blurb: 'Bricks laid in zigzag steps, each one at a right angle to the last. A turn of 45 degrees gives the classic floor.',
    params: { rows: [4, 40, 1, 14, 'Brick widths'], ratio: [2, 5, 1, 3, 'Brick length'], gap: [0, 0.3, 0.005, 0.1, 'Joint'], turn: [0, 90, 1, 45, 'Turn'], inks: [1, 5, 1, 3, 'Inks'], dir: [0, 1, 1, 0, 'Colour by direction'], round: [0, 0.5, 0.01, 0.1, 'Corner'] },
    gen(P, ctx) {
      const B = board(ctx), w = ctx.S / P.rows, k = P.ratio, rot = P.turn * Math.PI / 180, D = Math.ceil(Math.hypot(ctx.W, ctx.H) / 2 / w) + k + 2;
      const c = Math.cos(rot), s = Math.sin(rot), T = (x, y) => [ctx.cx + w * (x * c - y * s), ctx.cy + w * (x * s + y * c)];
      const g = P.gap / 2, r = Math.min(P.round, 0.5 - g);
      const brick = (x0, y0, bw, bh) => {
        const X0 = x0 + g, Y0 = y0 + g, X1 = x0 + bw - g, Y1 = y0 + bh - g, p = [];
        if (r < 0.01) return [X0, Y0, X1, Y0, X1, Y1, X0, Y1];
        for (const [qx, qy, a0] of [[X1 - r, Y0 + r, -Math.PI / 2], [X1 - r, Y1 - r, 0], [X0 + r, Y1 - r, Math.PI / 2], [X0 + r, Y0 + r, Math.PI]])
          for (let n = 0; n <= 3; n++) { const a = a0 + Math.PI / 2 * n / 3; p.push(qx + r * Math.cos(a), qy + r * Math.sin(a)); }
        return p;
      };
      for (let m = -Math.ceil(D / k) - 2; m <= Math.ceil(D / k) + 2 && !B.full(); m++) for (let n = -D - 2; n <= D + 2; n++) {
        const ox = n + m * k, oy = n - m * k;
        if (Math.abs(ox) > D + k || Math.abs(oy) > D + k) continue;
        for (const [x0, y0, bw, bh, d] of [[ox, oy, k, 1, 0], [ox, oy + 1, 1, k, 1]]) {
          const p = brick(x0, y0, bw, bh), q = [];
          for (let i = 0; i < p.length; i += 2) q.push(...T(p[i], p[i + 1]));
          const [mx, my] = T(x0 + bw / 2, y0 + bh / 2);
          if (mx < -k * w || my < -k * w || mx > ctx.W + k * w || my > ctx.H + k * w) continue;
          const ink = P.inks === 1 ? 0 : P.dir ? (d + (P.inks > 2 ? 2 * inkAt(ctx, mx, my, Math.ceil((P.inks - d) / 2), 0.2) : 0)) % P.inks : inkAt(ctx, mx, my, P.inks, 0.35);
          B.poly(q, true, { f: ink });
        }
      }
    },
  },
];

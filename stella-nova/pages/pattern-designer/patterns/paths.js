// ============================================================================
//  PATTERN DESIGNER  ·  patterns/paths.js — the paths and mazes family
// ----------------------------------------------------------------------------
//  One long path or one tree of paths: a grid maze, a ring labyrinth, and
//  three space-filling curves (Hilbert, the 7-fold "flowsnake" of Gosper,
//  and Peano's 3-fold curve). Mazes come from a seeded depth-first walk
//  (recursive backtracker), so every cell is reached by one path only.
//  Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def,
//      label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so each element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  grep -n "id: '" for the list of patterns in this file.
//  grep -n "function hilbert" for the curve builders.
// ============================================================================
import { TAU, clamp } from '../engine.js';
import { board, arcPts } from './kit.js';

// Hilbert curve of order n on a 2^n grid: a list of [x, y] cells.
function hilbert(n) {
  const N = 1 << n, out = [];
  for (let d = 0; d < N * N; d++) {
    let x = 0, y = 0, t = d;
    for (let s = 1; s < N; s *= 2) {
      const rx = 1 & (t / 2), ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const q = x; x = y; y = q; }
      x += s * rx; y += s * ry; t = Math.floor(t / 4);
    }
    out.push([x, y]);
  }
  return out;
}
// A string L-system expanded n times.
function expand(ax, rules, n) { let s = ax; for (let i = 0; i < n; i++) { let t = ''; for (const c of s) t += rules[c] ?? c; s = t; } return s; }
// Peano curve of order n on a 3^n grid (serpentine at each level).
function peano(n) {
  if (n === 0) return [[0, 0]];
  const sub = peano(n - 1), m = Math.pow(3, n - 1), out = [];
  for (let bx = 0; bx < 3; bx++) for (let k = 0; k < 3; k++) {
    const by = bx % 2 ? 2 - k : k;
    for (const [x, y] of sub) {
      const fx = by % 2 ? m - 1 - x : x, fy = bx % 2 ? m - 1 - y : y;
      out.push([bx * m + fx, by * m + fy]);
    }
  }
  return out;
}
// A path cut into nb runs of ink, or one ink per path when nb is 1.
function bands(B, pts, nb, inks, o, sm) {
  const per = Math.ceil(pts.length / 2 / nb) * 2;
  for (let b = 0; b < nb && !B.full(); b++) {
    const s = b * per, e = Math.min(pts.length, s + per + 2);
    if (e - s >= 4) B.poly(pts.slice(s, e), false, Object.assign({}, o, { s: b % inks, sm }));
  }
}
// Map grid points (0..N-1) into a square of side L at (x0, y0), turned.
function place(cells, N, x0, y0, L, rot) {
  const c = Math.cos(rot), s = Math.sin(rot), h = L / 2, k = L / N, out = [];
  for (const [x, y] of cells) { const u = (x + 0.5) * k - h, v = (y + 0.5) * k - h; out.push(x0 + h + u * c - v * s, y0 + h + u * s + v * c); }
  return out;
}

export default [
  {
    id: 'maze-walls', name: 'Maze', family: 'paths',
    blurb: 'A grid maze from a seeded walk that backs up at dead ends. Drawn as walls, or as the paths themselves in bands of ink by their distance from the start.',
    params: { cells: [6, 80, 1, 28, 'Cells'], style: [0, 1, 1, 1, 'Draw paths'], bias: [0, 1, 0.01, 0.5, 'Run bias'], weight: [0.4, 1, 0.01, 0.55, 'Path width'], bands: [1, 12, 1, 6, 'Ink bands'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), s = ctx.S / P.cells, nx = Math.floor(ctx.W / s), ny = Math.floor(ctx.H / s), x0 = (ctx.W - nx * s) / 2, y0 = (ctx.H - ny * s) / 2, r = ctx.rng;
      const N = nx * ny, seen = new Uint8Array(N), par = new Int32Array(N).fill(-1), dist = new Int32Array(N), open = new Uint8Array(N * 2);   // open: east (2i), south (2i+1)
      const start = r.int(0, N - 1), st = [start]; seen[start] = 1;
      let lastDir = -1;
      while (st.length) {
        const c = st[st.length - 1], x = c % nx, y = Math.floor(c / nx), nb = [];
        if (x > 0 && !seen[c - 1]) nb.push([c - 1, 0]); if (x < nx - 1 && !seen[c + 1]) nb.push([c + 1, 0]);
        if (y > 0 && !seen[c - nx]) nb.push([c - nx, 1]); if (y < ny - 1 && !seen[c + nx]) nb.push([c + nx, 1]);
        if (!nb.length) { st.pop(); continue; }
        // Bias: keep the last axis (long runs) or change it (short turns).
        const same = nb.filter(q => q[1] === lastDir), pick = same.length && r.chance(P.bias) ? r.pick(same) : r.pick(nb);
        const [n, ax] = pick; lastDir = ax;
        if (ax === 0) open[2 * Math.min(c, n)] = 1; else open[2 * Math.min(c, n) + 1] = 1;
        seen[n] = 1; par[n] = c; dist[n] = dist[c] + 1; st.push(n);
      }
      const ctr = c => [x0 + (c % nx + 0.5) * s, y0 + (Math.floor(c / nx) + 0.5) * s];
      if (P.style) {
        // Paths: chains from each cell to its parent, broken where the ink band changes.
        let maxD = 1; for (let c = 0; c < N; c++) maxD = Math.max(maxD, dist[c]);
        const band = c => Math.min(P.bands - 1, Math.floor(dist[c] / (maxD + 1) * P.bands)), kids = Array.from({ length: N }, () => []);
        for (let c = 0; c < N; c++) if (par[c] >= 0) kids[par[c]].push(c);
        const stack = [[start, start]];
        while (stack.length && !B.full()) {
          let [from, c] = stack.pop(); const p = [...ctr(from)]; if (from !== c) p.push(...ctr(c));
          const bd = band(c);
          while (kids[c].length === 1 && band(kids[c][0]) === bd) { c = kids[c][0]; p.push(...ctr(c)); }
          if (p.length >= 4) B.poly(p, false, { s: bd % P.inks, w: P.weight * s / 2 });
          for (const k of kids[c]) stack.push([c, k]);
        }
        return;
      }
      // Walls: runs of closed east and south walls, plus the border.
      const o = { s: 0, w: 1.4 };
      for (let y = 0; y < ny; y++) { let run = -1; for (let x = 0; x <= nx; x++) { const shut = x < nx && (y === ny - 1 || !open[2 * (y * nx + x) + 1]); if (shut && run < 0) run = x; if (!shut && run >= 0) { B.line(x0 + run * s, y0 + (y + 1) * s, x0 + x * s, y0 + (y + 1) * s, o); run = -1; } } }
      for (let x = 0; x < nx; x++) { let run = -1; for (let y = 0; y <= ny; y++) { const shut = y < ny && (x === nx - 1 || !open[2 * (y * nx + x)]); if (shut && run < 0) run = y; if (!shut && run >= 0) { B.line(x0 + (x + 1) * s, y0 + run * s, x0 + (x + 1) * s, y0 + y * s, o); run = -1; } } }
      B.line(x0, y0, x0 + nx * s, y0, o); B.line(x0, y0, x0, y0 + ny * s, o);
    },
  },
  {
    id: 'ring-labyrinth', name: 'Ring Labyrinth', family: 'paths',
    blurb: 'A round maze: rings of cells around a centre court, with more cells in the outer rings. One seeded walk opens a single path to every cell.',
    params: { rings: [3, 40, 1, 14, 'Rings'], first: [3, 12, 1, 6, 'Cells in ring 1'], weight: [0.5, 5, 0.1, 1.6, 'Wall weight'], court: [0.05, 0.3, 0.005, 0.1, 'Centre court'], inks: [1, 4, 1, 2, 'Inks'], fill: [0, 1, 1, 0, 'Shade rings'] },
    gen(P, ctx) {
      const B = board(ctx), R = ctx.S * 0.47, r0 = R * P.court, dr = (R - r0) / P.rings, cx = ctx.cx, cy = ctx.cy, rng = ctx.rng;
      // Cells per ring: double when the cell arc gets twice as wide as dr.
      const cnt = [], base = []; let tot = 0, c = P.first;
      for (let i = 0; i < P.rings; i++) { const rad = r0 + (i + 0.5) * dr; if (TAU * rad / c > 2 * dr) c *= 2; cnt.push(c); base.push(tot); tot += c; }
      const id = (i, j) => base[i] + ((j % cnt[i]) + cnt[i]) % cnt[i], ringOf = new Int32Array(tot), idx = new Int32Array(tot);
      for (let i = 0; i < P.rings; i++) for (let j = 0; j < cnt[i]; j++) { ringOf[id(i, j)] = i; idx[id(i, j)] = j; }
      const nbs = q => {
        const i = ringOf[q], j = idx[q], o = [[id(i, j - 1), 'cw'], [id(i, j + 1), 'cw']];
        if (i > 0) { const k = cnt[i] / cnt[i - 1]; o.push([id(i - 1, Math.floor(j / k)), 'in']); }
        if (i < P.rings - 1) { const k = cnt[i + 1] / cnt[i]; for (let m = 0; m < k; m++) o.push([id(i + 1, j * k + m), 'out']); }
        return o;
      };
      const seen = new Uint8Array(tot), open = new Set(), st = [rng.int(0, tot - 1)]; seen[st[0]] = 1;
      while (st.length) {
        const q = st[st.length - 1], nb = nbs(q).filter(([n]) => !seen[n]);
        if (!nb.length) { st.pop(); continue; }
        const [n] = rng.pick(nb); seen[n] = 1; open.add(Math.min(q, n) + ':' + Math.max(q, n)); st.push(n);
      }
      const isOpen = (a, b) => open.has(Math.min(a, b) + ':' + Math.max(a, b)), o = { s: 0, w: P.weight };
      if (P.fill && P.inks > 1) for (let i = P.rings - 1; i >= 0; i -= 2) {
        B.circle(cx, cy, r0 + (i + 1) * dr, { f: (i / 2 | 0) % (P.inks - 1) + 1 });
        B.circle(cx, cy, r0 + i * dr, { f: -2 });
      }
      B.circle(cx, cy, R, { f: -1, s: 0, w: P.weight });
      const door = rng.int(0, cnt[P.rings - 1] - 1);
      for (let i = 0; i < P.rings; i++) for (let j = 0; j < cnt[i]; j++) {
        const q = id(i, j), a0 = TAU * j / cnt[i], a1 = TAU * (j + 1) / cnt[i], ri = r0 + i * dr, ro = ri + dr;
        // The radial wall at the end of the cell (to cell j + 1).
        if (!isOpen(q, id(i, j + 1))) B.line(cx + ri * Math.cos(a1), cy + ri * Math.sin(a1), cx + ro * Math.cos(a1), cy + ro * Math.sin(a1), o);
        // The inner arc (to the ring below): one arc per inner neighbour span.
        if (i === 0) B.poly(arcPts(cx, cy, ri, a0, a1, 4), false, o);
        else if (!isOpen(q, id(i - 1, Math.floor(j / (cnt[i] / cnt[i - 1]))))) B.poly(arcPts(cx, cy, ri, a0, a1, 4), false, o);
        if (i === P.rings - 1 && j === door) B.poly(arcPts(cx, cy, R, a0 + 0.02, a1 - 0.02, 3), false, { s: -2, w: P.weight * 1.6 });
      }
    },
  },
  {
    id: 'hilbert-path', name: 'Hilbert Path', family: 'paths',
    blurb: 'A Hilbert curve: one path that visits every cell of a square grid, each quarter a turned copy of the whole. Soft corners turn it into a running knot.',
    params: { order: [1, 7, 1, 5, 'Order'], blocks: [1, 3, 1, 1, 'Squares across'], soft: [0, 1, 1, 1, 'Soft corners'], bands: [1, 16, 1, 5, 'Ink bands'], weight: [0.5, 12, 0.1, 3.5, 'Line weight'], margin: [0, 0.2, 0.005, 0.06, 'Margin'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), m = ctx.S * P.margin, L = (ctx.W - 2 * m) / P.blocks, ny = Math.max(1, Math.floor((ctx.H - 2 * m) / L)), oy = (ctx.H - ny * L) / 2, N = 1 << P.order;
      const cells = hilbert(P.order), w = Math.min(P.weight, L / N * 0.4);
      for (let j = 0; j < ny; j++) for (let i = 0; i < P.blocks; i++) {
        const rot = ctx.rng.int(0, 3) * Math.PI / 2, pts = place(cells, N, m + i * L, oy + j * L, L, rot);
        bands(B, pts, P.bands, P.inks, { w, f: -1 }, P.soft ? 1 : 0);
      }
    },
  },
  {
    id: 'flowsnake', name: 'Flowsnake', family: 'paths',
    blurb: 'Gosper\'s curve: each step becomes seven smaller steps at 60 degree turns. The path fills a fringed island, and ink bands show its seven-fold nesting.',
    params: { order: [1, 5, 1, 4, 'Order'], soft: [0, 1, 1, 1, 'Soft corners'], bands: [1, 49, 1, 7, 'Ink bands'], weight: [0.5, 10, 0.1, 2.4, 'Line weight'], zoom: [0.6, 2.5, 0.01, 1, 'Zoom'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), s = expand('A', { A: 'A-B--B+A++AA+B-', B: '+A-AA--A-B++B+A' }, P.order), d = Math.PI / 3;
      let x = 0, y = 0, a = ctx.rng.range(0, TAU); const pts = [0, 0];
      for (const c of s) { if (c === 'A' || c === 'B') { x += Math.cos(a); y += Math.sin(a); pts.push(x, y); } else if (c === '+') a += d; else if (c === '-') a -= d; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      const k = Math.min(ctx.W / (x1 - x0), ctx.H / (y1 - y0)) * 0.92 * P.zoom, ox = ctx.cx - (x0 + x1) / 2 * k, oy = ctx.cy - (y0 + y1) / 2 * k;
      const q = pts.map((v, i) => i % 2 ? oy + v * k : ox + v * k);
      bands(B, q, Math.min(P.bands, Math.max(1, q.length / 4 | 0)), P.inks, { w: Math.min(P.weight, k * 0.3), f: -1 }, P.soft ? 1 : 0);
    },
  },
  {
    id: 'peano-weave', name: 'Peano Weave', family: 'paths',
    blurb: 'Peano\'s curve snakes through a 3 by 3 grid, then through each cell again. A thick ink line with a thin paper core reads as one woven ribbon.',
    params: { order: [1, 4, 1, 3, 'Order'], ribbon: [0.2, 0.9, 0.01, 0.62, 'Ribbon width'], core: [0, 0.8, 0.01, 0.35, 'Core'], soft: [0, 1, 1, 0, 'Soft corners'], bands: [1, 9, 1, 3, 'Ink bands'], inks: [1, 5, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), N = Math.pow(3, P.order), cells = peano(P.order), rows = Math.max(1, Math.round(ctx.H / ctx.W)), cols = Math.max(1, Math.round(ctx.W / ctx.H));
      // w is a line weight factor (the page multiplies it by its line weight, 2 by default).
      const side = Math.min(ctx.W / cols, ctx.H / rows) * 0.94, gw = side / N, w = gw * P.ribbon / 2;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const ox = (ctx.W - cols * side) / 2 + i * side, oy = (ctx.H - rows * side) / 2 + j * side, rot = (ctx.rng.int(0, 3)) * Math.PI / 2;
        const pts = place(cells, N, ox, oy, side, rot);
        bands(B, pts, P.bands, P.inks, { w, f: -1 }, P.soft ? 1 : 0);
        if (P.core > 0) B.poly(pts, false, { f: -1, s: -2, w: w * P.core / 0.8, sm: P.soft ? 1 : 0 });
      }
    },
  },
];

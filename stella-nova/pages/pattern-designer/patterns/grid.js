// ============================================================================
//  PATTERN DESIGNER  ·  patterns/grid.js — the grid family
// ----------------------------------------------------------------------------
//  Patterns on a regular cell grid. Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def, label] },
//      gen(P, ctx) }
//  gen writes to ctx.out (engine.js class Out) and reads randomness only
//  from ctx.rng and ctx.noise, so the result is fixed by the seed.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp } from '../engine.js';

// Cell size for n cells across the short side, and the grid that covers
// the board with whole cells centred on it.
function grid(ctx, n) {
  const s = ctx.S / n, nx = Math.ceil(ctx.W / s), ny = Math.ceil(ctx.H / s);
  return { s, nx, ny, x0: (ctx.W - nx * s) / 2, y0: (ctx.H - ny * s) / 2 };
}
// A rounded rectangle as a ring (r: the corner radius).
export function roundRect(x, y, w, h, r, seg = 4) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 0.01) return [x, y, x + w, y, x + w, y + h, x, y + h];
  const p = [], cs = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of cs) for (let k = 0; k <= seg; k++) { const a = a0 + (Math.PI / 2) * k / seg; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return p;
}
// Points on an arc about (cx, cy) from a0 to a1.
function arc(cx, cy, r, a0, a1, n = 18) {
  const p = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return p;
}
// An ink slot from a slow noise field, so colour comes in patches.
const patch = (ctx, x, y, k, sc = 0.0025) => clamp(Math.floor((0.5 + 0.5 * ctx.noise.fbm(x * sc, y * sc, 2)) * k), 0, k - 1);

export default [
  {
    id: 'arc-lattice', name: 'Arc Lattice', family: 'grid',
    blurb: 'Quarter arcs in each cell meet the arcs of the next cell, so the lines run on through the whole board.',
    params: { cells: [3, 30, 1, 9, 'Cells'], bands: [1, 6, 1, 3, 'Lines per arc'], weight: [0.4, 6, 0.1, 2.2, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'], patch: [0, 1, 0.01, 0.5, 'Colour patches'] },
    gen(P, ctx) {
      const { s, nx, ny, x0, y0 } = grid(ctx, P.cells), g = 0.36 * s / P.bands;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * s, y = y0 + j * s, flip = ctx.rng.chance(0.5);
        const ink = P.inks === 1 ? 0 : ctx.rng.chance(P.patch) ? patch(ctx, x, y, P.inks) : ctx.rng.int(0, P.inks - 1);
        const corners = flip ? [[x, y, 0], [x + s, y + s, Math.PI]] : [[x + s, y, Math.PI / 2], [x, y + s, -Math.PI / 2]];
        for (const [cx, cy, a0] of corners) for (let k = 0; k < P.bands; k++) {
          const r = s / 2 + (k - (P.bands - 1) / 2) * g;
          ctx.out.poly(arc(cx, cy, r, a0, a0 + Math.PI / 2), false, { s: ink, w: P.weight });
        }
      }
    },
  },
  {
    id: 'split-squares', name: 'Split Squares', family: 'grid',
    blurb: 'Each cell is cut on one diagonal, and one half takes an ink. Some cells hold a quarter disc instead.',
    params: { cells: [3, 40, 1, 10, 'Cells'], inks: [2, 5, 1, 3, 'Inks'], discs: [0, 1, 0.01, 0.25, 'Quarter discs'], gap: [0, 0.2, 0.005, 0.02, 'Gap'], bias: [0, 1, 0.01, 0.5, 'Field bias'] },
    gen(P, ctx) {
      const { s, nx, ny, x0, y0 } = grid(ctx, P.cells), gp = P.gap * s;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * s + gp / 2, y = y0 + j * s + gp / 2, w = s - gp;
        const field = 0.5 + 0.5 * ctx.noise.fbm(x * 0.002, y * 0.002, 2);
        const ink = ctx.rng.chance(P.bias) ? clamp(Math.floor(field * P.inks), 0, P.inks - 1) : ctx.rng.int(0, P.inks - 1);
        const q = ctx.rng.int(0, 3);
        if (ctx.rng.chance(P.discs)) {
          const c = [[x, y], [x + w, y], [x + w, y + w], [x, y + w]][q];
          const a0 = [0, Math.PI / 2, Math.PI, -Math.PI / 2][q];
          ctx.out.poly([c[0], c[1], ...arc(c[0], c[1], w, a0, a0 + Math.PI / 2, 24)], true, { f: ink });
        } else {
          const tri = [[x, y, x + w, y, x, y + w], [x, y, x + w, y, x + w, y + w], [x + w, y, x + w, y + w, x, y + w], [x, y, x + w, y + w, x, y + w]][q];
          ctx.out.poly(tri, true, { f: ink });
        }
      }
    },
  },
  {
    id: 'running-bond', name: 'Running Bond', family: 'grid',
    blurb: 'Courses of rounded bricks, each course shifted on the last. A slow field picks the ink of each brick.',
    params: { rows: [6, 70, 1, 22, 'Courses'], ratio: [1.2, 6, 0.1, 2.6, 'Brick length'], shift: [0, 1, 0.01, 0.5, 'Course shift'], gap: [0, 0.4, 0.01, 0.14, 'Joint'], round: [0, 0.5, 0.01, 0.3, 'Corner'], inks: [1, 5, 1, 3, 'Inks'], vary: [0, 0.6, 0.01, 0.15, 'Length change'] },
    gen(P, ctx) {
      const h = ctx.H / P.rows, gp = P.gap * h;
      for (let j = 0; j < P.rows; j++) {
        const y = j * h;
        let x = -((j * P.shift) % 1) * P.ratio * h;
        while (x < ctx.W) {
          const L = P.ratio * h * (1 + ctx.rng.range(-P.vary, P.vary));
          const f = 0.5 + 0.5 * ctx.noise.fbm(x * 0.0021, y * 0.0021, 3);
          const ink = clamp(Math.floor(f * P.inks + ctx.rng.range(-0.25, 0.25)), 0, P.inks - 1);
          const x1 = Math.max(x + gp / 2, -h), x2 = Math.min(x + L - gp / 2, ctx.W + h);
          if (x2 - x1 > gp) ctx.out.poly(roundRect(x1, y + gp / 2, x2 - x1, h - gp, P.round * (h - gp)), true, { f: ink });
          x += L;
        }
      }
    },
  },
  {
    id: 'dot-interference', name: 'Dot Interference', family: 'grid',
    blurb: 'A dot grid sized by circular waves from a few hidden sources. Where the waves meet, the dots swell and fade in bands.',
    params: { cells: [12, 90, 1, 42, 'Cells'], sources: [1, 5, 1, 2, 'Sources'], freq: [1, 30, 0.5, 9, 'Wave count'], min: [0, 0.5, 0.01, 0.06, 'Smallest dot'], shape: [0, 2, 1, 0, 'Shape (dot, square, diamond)'], hex: [0, 1, 1, 1, 'Hex grid'], inks: [1, 3, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S } = ctx, src = [];
      for (let k = 0; k < P.sources; k++) src.push([ctx.rng.range(0.1, 0.9) * W, ctx.rng.range(0.1, 0.9) * H, ctx.rng.range(0, TAU)]);
      const s = S / P.cells, rowH = P.hex ? s * Math.sqrt(3) / 2 : s;
      for (let j = -1; j * rowH < H + s; j++) for (let i = -1; i * s < W + s; i++) {
        const x = i * s + (P.hex && j % 2 ? s / 2 : 0), y = j * rowH;
        let v = 0;
        for (const [sx, sy, ph] of src) v += Math.cos(Math.hypot(x - sx, y - sy) / S * P.freq * TAU + ph);
        v = 0.5 + 0.5 * v / P.sources;
        const r = (P.min + (1 - P.min) * v * v) * s * 0.5;
        const ink = P.inks === 1 ? 0 : clamp(Math.floor(v * P.inks), 0, P.inks - 1);
        if (P.shape === 0) ctx.out.circle(x, y, r, { f: ink });
        else ctx.out.ngon(x, y, r * (P.shape === 1 ? Math.SQRT2 : 1.25), 4, P.shape === 1 ? Math.PI / 4 : 0, { f: ink });
      }
    },
  },
  {
    id: 'basket-weave', name: 'Basket Weave', family: 'grid',
    blurb: 'Two sets of strips pass over and under each other. A twill step moves the crossing one cell on each row.',
    params: { strips: [4, 40, 1, 14, 'Strips'], width: [0.3, 0.95, 0.01, 0.78, 'Strip width'], twill: [1, 4, 1, 1, 'Twill step'], over: [1, 3, 1, 1, 'Run length'], warpInk: [0, 4, 1, 1, 'Warp ink'], weftInk: [0, 4, 1, 2, 'Weft ink'], edge: [0, 1, 1, 1, 'Edge lines'] },
    gen(P, ctx) {
      const { s, nx, ny, x0, y0 } = grid(ctx, P.strips), w = P.width * s, m = (s - w) / 2;
      const per = P.over + 1;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * s, y = y0 + j * s, up = ((i + j * P.twill) % per + per) % per < P.over;
        const h = () => ctx.out.rect(x - 0.5, y + m, s + 1, w, { f: P.weftInk });
        const v = () => ctx.out.rect(x + m, y - 0.5, w, s + 1, { f: P.warpInk });
        if (up) { h(); v(); } else { v(); h(); }
        if (P.edge) {
          const o = { s: 0, w: 0.6 };
          if (up) { ctx.out.line(x + m, y + m, x + m, y + m + w, o); ctx.out.line(x + m + w, y + m, x + m + w, y + m + w, o); }
          else { ctx.out.line(x + m, y + m, x + m + w, y + m, o); ctx.out.line(x + m, y + m + w, x + m + w, y + m + w, o); }
        }
      }
    },
  },
  {
    id: 'module-grid', name: 'Module Grid', family: 'grid',
    blurb: 'The board splits into squares of three sizes. Each square holds one plain module: a disc, a half, a quarter, a ring or bars.',
    params: { cells: [2, 16, 1, 6, 'Base cells'], split: [0, 1, 0.01, 0.45, 'Split chance'], depth: [0, 3, 1, 2, 'Split depth'], gap: [0, 0.2, 0.005, 0.04, 'Gutter'], inks: [2, 5, 1, 4, 'Inks'], quiet: [0, 0.8, 0.01, 0.15, 'Empty cells'] },
    gen(P, ctx) {
      const { s, nx, ny, x0, y0 } = grid(ctx, P.cells);
      const cell = (x, y, w, d) => {
        if (d < P.depth && ctx.rng.chance(P.split)) { const h = w / 2; cell(x, y, h, d + 1); cell(x + h, y, h, d + 1); cell(x, y + h, h, d + 1); cell(x + h, y + h, h, d + 1); return; }
        if (ctx.rng.chance(P.quiet)) return;
        const g = P.gap * s, X = x + g / 2, Y = y + g / 2, Wd = w - g, ink = ctx.rng.int(0, P.inks - 1), alt = (ink + ctx.rng.int(1, P.inks - 1)) % P.inks;
        const q = ctx.rng.int(0, 3), a0 = q * Math.PI / 2;
        switch (ctx.rng.int(0, 6)) {
          case 0: ctx.out.circle(X + Wd / 2, Y + Wd / 2, Wd / 2, { f: ink }); break;
          case 1: { const c = [[X, Y], [X + Wd, Y], [X + Wd, Y + Wd], [X, Y + Wd]][q]; ctx.out.poly([c[0], c[1], ...arc(c[0], c[1], Wd, a0, a0 + Math.PI / 2, 28)], true, { f: ink }); break; }
          case 2: { const cx = X + Wd / 2 + Math.cos(a0) * Wd / 2, cy = Y + Wd / 2 + Math.sin(a0) * Wd / 2; ctx.out.rect(X, Y, Wd, Wd, { f: alt }); ctx.out.poly(arc(cx, cy, Wd / 2, a0 + Math.PI / 2, a0 + 1.5 * Math.PI, 28), true, { f: ink }); break; }
          case 3: ctx.out.rect(X, Y, Wd, Wd, { f: ink }); ctx.out.circle(X + Wd / 2, Y + Wd / 2, Wd * 0.28, { f: alt }); break;
          case 4: { const n = ctx.rng.int(3, 6), bw = Wd / (2 * n - 1); for (let k = 0; k < n; k++) q % 2 ? ctx.out.rect(X + 2 * k * bw, Y, bw, Wd, { f: ink }) : ctx.out.rect(X, Y + 2 * k * bw, Wd, bw, { f: ink }); break; }
          case 5: ctx.out.poly(q % 2 ? [X, Y, X + Wd, Y, X, Y + Wd] : [X + Wd, Y, X + Wd, Y + Wd, X, Y + Wd], true, { f: ink }); break;
          default: ctx.out.circle(X + Wd / 2, Y + Wd / 2, Wd * 0.42, { f: -1, s: ink, w: Wd * 0.05 }); break;
        }
      };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cell(x0 + i * s, y0 + j * s, s, 0);
    },
  },
  {
    id: 'plus-field', name: 'Plus Field', family: 'grid',
    blurb: 'A grid of plus marks. A noise field turns them and sets their size, so calm areas and busy areas form.',
    params: { cells: [6, 60, 1, 24, 'Cells'], size: [0.2, 1.2, 0.01, 0.7, 'Mark size'], thick: [0.04, 0.4, 0.01, 0.16, 'Bar width'], turn: [0, 1, 0.01, 0.6, 'Turn'], scale: [0.3, 4, 0.05, 1.2, 'Field scale'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { s, nx, ny, x0, y0 } = grid(ctx, P.cells), k = 0.0018 / P.scale;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * s, y = y0 + (j + 0.5) * s, n = ctx.noise.fbm(x * k, y * k, 3);
        const L = s * P.size * (0.55 + 0.45 * Math.abs(n) * 2.2) / 2, t = Math.max(0.6, L * 2 * P.thick) / 2, a = n * Math.PI * P.turn;
        const c = Math.cos(a), sn = Math.sin(a), pts = [];
        for (const [u, v] of [[-t, -L], [t, -L], [t, -t], [L, -t], [L, t], [t, t], [t, L], [-t, L], [-t, t], [-L, t], [-L, -t], [-t, -t]]) pts.push(x + u * c - v * sn, y + u * sn + v * c);
        ctx.out.poly(pts, true, { f: P.inks === 1 ? 0 : clamp(Math.floor((n + 0.5) * P.inks), 0, P.inks - 1) });
      }
    },
  },
];

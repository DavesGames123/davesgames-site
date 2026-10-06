// ============================================================================
//  PATTERN DESIGNER  ·  patterns/iso.js — the isometric family
// ----------------------------------------------------------------------------
//  Solids in an isometric view. A cell (i, j) of the ground grid goes to
//  the screen at x = (i - j) a, y = (i + j) b, with a = s cos 30 and
//  b = s / 2. Height z lifts a point by z s. The viewer looks from +i and
//  +j, so a cell with a larger i + j is nearer. The patterns draw cells in
//  order of i + j, and each column from the base up (painter's order), so
//  near solids cover far solids. Faces use three ink slots: top, left and
//  right. Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def, label] },
//      gen(P, ctx) }
//  gen reads randomness only from ctx.rng and ctx.noise.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { clamp } from '../engine.js';

const C30 = Math.cos(Math.PI / 6);

// The projection for cell size s, with ground cell (0, 0) at the board centre.
function iso(ctx, s) {
  const a = s * C30, b = s / 2;
  const P = (i, j, z) => [ctx.cx + (i - j) * a, ctx.cy + (i + j) * b - z * s];
  return { a, b, s, P };
}
// Calls fn(i, j) for the ground cells that can show on the board, near
// last. lift: the tallest column, in cells, so cells below the board edge
// whose columns rise into view are kept.
function cells(ctx, g, lift, fn) {
  const um = Math.ceil(ctx.W / 2 / g.a) + 2, vmin = -Math.ceil(ctx.H / 2 / g.b) - 3, vmax = Math.ceil((ctx.H / 2 + lift * g.s) / g.b) + 3;
  for (let v = vmin; v <= vmax; v++) for (let u = -um; u <= um; u++) {
    if (((u + v) & 1) !== 0) continue;
    fn((u + v) / 2, (v - u) / 2);
    if (ctx.out.full()) return;
  }
}
const flat = pts => pts.flat();
// One block on cell (i, j) from height z0 to z1: left, right, then top.
// o: { top, left, right, line } ink slots; line -1 for no outline.
function block(ctx, g, i, j, z0, z1, o) {
  const P = g.P, st = o.line ?? -1, w = o.w ?? 1;
  if (z1 - z0 > 1e-6) {
    ctx.out.poly(flat([P(i, j + 1, z0), P(i + 1, j + 1, z0), P(i + 1, j + 1, z1), P(i, j + 1, z1)]), true, { f: o.left, s: st, w });
    ctx.out.poly(flat([P(i + 1, j, z0), P(i + 1, j + 1, z0), P(i + 1, j + 1, z1), P(i + 1, j, z1)]), true, { f: o.right, s: st, w });
  }
  ctx.out.poly(flat([P(i, j, z1), P(i + 1, j, z1), P(i + 1, j + 1, z1), P(i, j + 1, z1)]), true, { f: o.top, s: st, w });
}

export default [
  {
    id: 'cube-stacks', name: 'Cube Stacks', family: 'iso',
    blurb: 'Unit cubes piled in columns on an isometric floor. A noise field sets each pile, and three inks shade the three faces.',
    params: { cells: [6, 30, 1, 16, 'Cells'], height: [0, 7, 1, 4, 'Tallest pile'], scale: [0.3, 4, 0.05, 1.2, 'Field scale'], holes: [0, 0.6, 0.01, 0.12, 'Gaps'], outline: [0, 1, 1, 1, 'Paper outline'], top: [0, 4, 1, 0, 'Top ink'], left: [0, 4, 1, 1, 'Left ink'], right: [0, 4, 1, 2, 'Right ink'] },
    gen(P, ctx) {
      const g = iso(ctx, ctx.S / P.cells), k = 0.09 / P.scale;
      const o = { top: P.top, left: P.left, right: P.right, line: P.outline ? -2 : -1, w: 0.8 };
      cells(ctx, g, P.height, (i, j) => {
        if (ctx.rng.chance(P.holes)) return;
        const n = 0.5 + 0.5 * ctx.noise.fbm(i * k, j * k, 3);
        const h = clamp(Math.round(n * P.height * 1.3 - 0.2 + ctx.rng.range(-0.4, 0.4)), 0, P.height);
        if (h === 0) { block(ctx, g, i, j, 0, 0, o); return; }
        for (let z = 0; z < h && !ctx.out.full(); z++) block(ctx, g, i, j, z, z + 1, o);
      });
    },
  },
  {
    id: 'terraces', name: 'Terraces', family: 'iso',
    blurb: 'A noise height map cut into flat steps and drawn as isometric columns. Each step level takes the next ink, like a contour map in relief.',
    params: { cells: [10, 46, 1, 34, 'Cells'], levels: [2, 10, 1, 6, 'Steps'], rise: [0.2, 1.2, 0.05, 0.85, 'Step height'], scale: [0.3, 4, 0.05, 1.1, 'Field scale'], inks: [2, 5, 1, 4, 'Inks'], side: [0, 4, 1, 0, 'Side ink'], outline: [0, 1, 1, 1, 'Paper outline'] },
    gen(P, ctx) {
      const g = iso(ctx, ctx.S / P.cells), k = 0.05 / P.scale;
      cells(ctx, g, P.levels * P.rise, (i, j) => {
        const n = clamp(0.5 + 0.75 * ctx.noise.fbm(i * k, j * k, 4), 0, 0.999);
        const L = Math.floor(n * P.levels), z = L * P.rise, ink = L % P.inks;
        block(ctx, g, i, j, 0, z, { top: ink, left: P.side, right: P.side, line: P.outline ? -2 : -1, w: 0.6 });
      });
    },
  },
  {
    id: 'iso-relief', name: 'Iso Relief', family: 'iso',
    blurb: 'A noise surface seen at an isometric angle. Each grid quad is filled and outlined, so near ridges hide the slopes behind them.',
    params: { cells: [12, 80, 1, 30, 'Mesh cells'], height: [0.5, 12, 0.1, 8, 'Relief'], scale: [0.3, 4, 0.05, 1, 'Field scale'], bands: [0, 4, 1, 3, 'Height bands'], weight: [0.3, 3, 0.05, 1, 'Line weight'], line: [0, 4, 1, 0, 'Line ink'] },
    gen(P, ctx) {
      const g = iso(ctx, ctx.S / P.cells), k = 0.06 / P.scale;
      const hz = (i, j) => P.height * clamp(0.5 + 0.85 * ctx.noise.fbm(i * k, j * k, 4), 0, 1);
      const cache = new Map(), H = (i, j) => { const key = i * 100003 + j; let v = cache.get(key); if (v == null) { v = hz(i, j); cache.set(key, v); } return v; };
      cells(ctx, g, P.height, (i, j) => {
        const a = H(i, j), b = H(i + 1, j), c = H(i + 1, j + 1), d = H(i, j + 1);
        const f = P.bands ? clamp(Math.floor((a + b + c + d) / 4 / P.height * P.bands), 0, P.bands - 1) + 1 : -2;
        ctx.out.poly(flat([g.P(i, j, a), g.P(i + 1, j, b), g.P(i + 1, j + 1, c), g.P(i, j + 1, d)]), true, { f, s: P.line, w: P.weight });
      });
    },
  },
  {
    id: 'tumbling-blocks', name: 'Tumbling Blocks', family: 'iso',
    blurb: 'Hexagons cut into three rhombi read as cubes. Some hexagons are cut the other way, so cubes turn into hollow corners.',
    params: { cells: [3, 30, 1, 9, 'Hexagons'], flip: [0, 1, 0.01, 0.3, 'Flipped'], field: [0, 1, 0.01, 0.6, 'Flip by field'], gap: [0, 0.2, 0.005, 0.03, 'Gap'], top: [0, 4, 1, 0, 'Top ink'], left: [0, 4, 1, 1, 'Left ink'], right: [0, 4, 1, 2, 'Right ink'] },
    gen(P, ctx) {
      const R = ctx.S / P.cells / Math.sqrt(3), dx = Math.sqrt(3) * R, dy = 1.5 * R, sh = 1 - P.gap;
      const shade = [P.top, P.left, P.right];
      const nx = Math.ceil(ctx.W / dx / 2) + 2, ny = Math.ceil(ctx.H / dy / 2) + 2;
      for (let r = -ny; r <= ny && !ctx.out.full(); r++) for (let q = -nx; q <= nx; q++) {
        const cx = ctx.cx + q * dx + (r & 1 ? dx / 2 : 0), cy = ctx.cy + r * dy;
        const v = []; for (let k = 0; k < 6; k++) { const an = -Math.PI / 2 + k * Math.PI / 3; v.push([cx + R * Math.cos(an), cy + R * Math.sin(an)]); }
        const n = 0.5 + 0.5 * ctx.noise.fbm(cx * 0.003, cy * 0.003, 2);
        const p = P.field * (n > 0.5 ? 1 : 0) * P.flip * 2 + (1 - P.field) * P.flip;
        const mids = ctx.rng.chance(clamp(p, 0, 1)) ? [1, 3, 5] : [0, 2, 4];
        for (const m of mids) {
          const ring = [[cx, cy], v[(m + 5) % 6], v[m], v[(m + 1) % 6]];
          const [ox, oy] = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
          ctx.out.poly(ring.flatMap(([x, y]) => [ox + (x - ox) * sh, oy + (y - oy) * sh]), true, { f: shade[m % 3] });
        }
      }
    },
  },
  {
    id: 'iso-towers', name: 'Iso Towers', family: 'iso',
    blurb: 'Towers of mixed height stand on a thin isometric floor grid. Paper lines mark the floors on each face.',
    params: { cells: [8, 40, 1, 22, 'Cells'], density: [0.02, 0.45, 0.01, 0.18, 'Towers'], height: [1, 10, 0.5, 6, 'Tallest'], floors: [0, 1, 1, 1, 'Floor lines'], grid: [0, 1, 1, 1, 'Floor grid'], top: [0, 4, 1, 0, 'Top ink'], left: [0, 4, 1, 1, 'Left ink'], right: [0, 4, 1, 2, 'Right ink'] },
    gen(P, ctx) {
      const g = iso(ctx, ctx.S / P.cells), o = { top: P.top, left: P.left, right: P.right, line: -2, w: 0.7 };
      if (P.grid) {
        const n = Math.ceil(Math.hypot(ctx.W, ctx.H) / g.s) + 2;
        for (let t = -n; t <= n; t++) {
          ctx.out.poly(flat([g.P(t, -n, 0), g.P(t, n, 0)]), false, { s: 0, w: 0.35 });
          ctx.out.poly(flat([g.P(-n, t, 0), g.P(n, t, 0)]), false, { s: 0, w: 0.35 });
        }
      }
      cells(ctx, g, P.height, (i, j) => {
        if (!ctx.rng.chance(P.density)) return;
        const n = 0.5 + 0.5 * ctx.noise.fbm(i * 0.08, j * 0.08, 2);
        const h = Math.max(0.5, Math.round(P.height * n * (0.35 + 0.65 * Math.pow(ctx.rng.next(), 1.6)) * 2) / 2);
        block(ctx, g, i, j, 0, h, o);
        if (P.floors) for (let z = 0.5; z < h - 0.01; z += 0.5) {
          ctx.out.poly(flat([g.P(i, j + 1, z), g.P(i + 1, j + 1, z), g.P(i + 1, j, z)]), false, { s: -2, w: 0.5 });
        }
      });
    },
  },
];

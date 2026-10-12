// ============================================================================
//  PATTERN DESIGNER  ·  patterns/grid.js — the grid family
// ----------------------------------------------------------------------------
//  Patterns on a regular cell grid. Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def, label] },
//      gen(P, ctx) }
//  gen writes to ctx.out (engine.js class Out) and reads randomness only
//  from ctx.rng and ctx.noise, so the result is fixed by the seed.
//
//  The last two entries (type-rhythm, greeked-columns) are type rhythms
//  with no letters: abstract pen marks and text-block bars on a page
//  grid. They draw through board(ctx) (kit.js), which clips to the board.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp } from '../engine.js';
import { board } from './kit.js';

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
  {
    id: 'type-rhythm', name: 'Type Rhythm', family: 'grid',
    blurb: 'Lines of made-up pen marks in columns: stems, arches, bowls, dots and bars set like words on a baseline. It reads like text, but holds no letters.',
    params: { rows: [6, 60, 1, 22, 'Lines'], cols: [1, 4, 1, 2, 'Columns'], xh: [0.3, 0.8, 0.01, 0.5, 'x-height'], wide: [0.4, 1.6, 0.01, 0.8, 'Mark width'], weight: [0.5, 4, 0.05, 1.6, 'Stroke'], rag: [0, 1, 1, 1, 'Ragged right'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, m = ctx.S * 0.08, gut = ctx.S * 0.05, cw = (ctx.W - 2 * m - gut * (P.cols - 1)) / P.cols, lh = (ctx.H - 2 * m) / P.rows;
      const xh = lh * P.xh * 0.62, asc = xh * 1.7, gw = xh * 0.75 * P.wide, o = { f: -1, s: 0, w: P.weight };
      // One mark with its baseline at (x, y); returns its advance.
      const mark = (x, y, ink) => {
        const k = r.weighted([4, 2, 1.2, 3, 3, 1.5, 1.2, 1]), q = Object.assign({}, o, { s: ink });
        switch (k) {
          case 0: B.line(x, y, x, y - xh, q); return gw * 0.45;
          case 1: B.line(x, y, x, y - asc, q); return gw * 0.45;
          case 2: B.line(x, y + xh * 0.7, x, y - xh, q); return gw * 0.45;
          case 3: { const p = [x, y]; for (let n = 0; n <= 10; n++) { const a = Math.PI + Math.PI * n / 10; p.push(x + gw / 2 + gw / 2 * Math.cos(a), y - xh + gw / 2 * 0.9 + gw / 2 * 0.9 * Math.sin(a)); } p.push(x + gw, y); B.poly(p, false, q); return gw * 1.45; }
          case 4: { const p = []; for (let n = 0; n < 16; n++) { const a = TAU * n / 16; p.push(x + gw / 2 + gw / 2 * Math.cos(a), y - xh / 2 + xh / 2 * Math.sin(a)); } B.poly(p, true, { f: -1, s: ink, w: P.weight }); return gw * 1.45; }
          case 5: B.line(x, y, x, y - xh, q); B.line(x, y - xh * 1.45, x, y - xh * 1.5, q); return gw * 0.45;
          case 6: B.line(x + gw * 0.3, y, x + gw * 0.3, y - asc * 0.85, q); B.line(x, y - xh, x + gw * 0.7, y - xh, q); return gw * 0.95;
          default: { const p = []; for (let n = 0; n <= 12; n++) { const t = n / 12; p.push(x + gw * t, y - xh * (0.5 + 0.5 * Math.cos(Math.PI * t * 1.5)) ); } B.poly(p, false, q); return gw * 1.3; }
        }
      };
      for (let c = 0; c < P.cols && !B.full(); c++) {
        const x0 = m + c * (cw + gut);
        let para = r.int(3, 7);
        for (let j = 0; j < P.rows; j++) {
          const y = m + (j + 0.78) * lh, head = j === 0 && P.inks > 1, ink = head ? 1 : 0;
          if (para-- <= 0) { para = r.int(3, 8); continue; }
          const end = x0 + cw * (P.rag ? (para === 0 ? r.range(0.25, 0.7) : r.range(0.82, 1)) : (para === 0 ? r.range(0.25, 0.7) : 1));
          let x = x0 + (para === r.int(2, 7) ? gw * 2 : 0);
          while (x < end - gw * 1.6 && !B.full()) {
            const n = r.int(1, 8);
            for (let g = 0; g < n && x < end - gw * 1.6; g++) x += mark(x, y, ink % P.inks) + gw * 0.35;
            x += gw * 1.4;
          }
        }
      }
    },
  },
  {
    id: 'greeked-columns', name: 'Greeked Columns', family: 'grid',
    blurb: 'A page layout with no letters: bars for words in justified lines, thick bars for headings, solid blocks for pictures, and rules between parts.',
    params: { cols: [1, 5, 1, 3, 'Columns'], lead: [6, 40, 0.5, 14, 'Leading'], bar: [0.2, 0.9, 0.01, 0.5, 'Bar height'], heads: [0, 1, 0.01, 0.35, 'Headings'], images: [0, 1, 0.01, 0.3, 'Picture blocks'], round: [0, 1, 1, 1, 'Round ends'], inks: [1, 4, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, m = ctx.S * 0.07, gut = ctx.S * 0.04, cw = (ctx.W - 2 * m - gut * (P.cols - 1)) / P.cols;
      const bar = (x, y, w, h, ink) => {
        if (w < 1 || h < 0.3) return;
        if (!P.round || w < h) { B.rect(x, y, w, h, { f: ink }); return; }
        const rr = h / 2, p = [];
        for (let n = 0; n <= 6; n++) { const a = -Math.PI / 2 + Math.PI * n / 6; p.push(x + w - rr + rr * Math.cos(a), y + rr + rr * Math.sin(a)); }
        for (let n = 0; n <= 6; n++) { const a = Math.PI / 2 + Math.PI * n / 6; p.push(x + rr + rr * Math.cos(a), y + rr + rr * Math.sin(a)); }
        B.poly(p, true, { f: ink });
      };
      const ink = k => k % P.inks;
      for (let c = 0; c < P.cols && !B.full(); c++) {
        const x0 = m + c * (cw + gut);
        let y = m;
        while (y < ctx.H - m - P.lead) {
          const roll = r.next();
          if (roll < P.heads * 0.3) {
            const n = r.int(1, 2), h = P.lead * 1.3;
            for (let k = 0; k < n && y + h < ctx.H - m; k++) { bar(x0, y, cw * r.range(0.45, 0.95), h * P.bar * 1.4, ink(1)); y += h * 1.2; }
            y += P.lead * 0.5;
          } else if (roll < P.heads * 0.3 + P.images * 0.25) {
            const h = Math.min(ctx.H - m - y, cw * r.range(0.4, 0.9));
            if (h > P.lead * 2) { B.rect(x0, y, cw, h, { f: ink(2) }); B.line(x0, y + h, x0 + cw, y, { s: -2, w: 0.6 }); }
            y += h + P.lead;
          } else {
            const n = r.int(3, 9);
            for (let k = 0; k < n && y + P.lead < ctx.H - m; k++) {
              const last = k === n - 1, end = last ? cw * r.range(0.2, 0.75) : cw;
              let x = k === 0 ? P.lead * 1.2 : 0;
              while (x < end - 2) {
                const w = Math.min(end - x, P.lead * r.range(0.8, 4.2));
                bar(x0 + x, y + P.lead * (1 - P.bar) / 2, w, P.lead * P.bar, ink(0));
                x += w + P.lead * 0.45;
              }
              y += P.lead;
            }
            if (r.chance(0.2)) { B.line(x0, y + P.lead * 0.3, x0 + cw, y + P.lead * 0.3, { s: ink(3), w: 0.5 }); y += P.lead * 0.6; }
            y += P.lead * 0.7;
          }
        }
      }
    },
  },
];

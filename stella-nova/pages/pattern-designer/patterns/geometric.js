// ============================================================================
//  PATTERN DESIGNER  ·  patterns/geometric.js — the geometric family
// ----------------------------------------------------------------------------
//  Exact curves and constructions: engine-turned guilloche bands, gear
//  curves filled by the even-odd rule, a table of Lissajous figures,
//  superformula blossoms, polygons nested by a pursuit step, and an
//  Apollonian circle packing from the Descartes circle theorem.
//  Each entry is
//    { id, name, family, blurb, heavy?, params: { key: [min, max, step,
//      def, label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so each element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  APOLLONIAN. A circle is [k, kx, ky] (curvature and curvature times the
//  centre). Four circles that touch each other obey the Descartes rule,
//  so the circle in a gap is a reflection: new = 2 (a + b + c) - old,
//  term by term. The outer circle has a negative curvature.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp } from '../engine.js';
import { board, inkAt } from './kit.js';

const gcd = (a, b) => b ? gcd(b, a % b) : a;

export default [
  {
    id: 'guilloche', name: 'Guilloche', family: 'geometric',
    blurb: 'Many closed wave curves, each one a little out of phase with the last, as cut by a rose engine on a bank note. The beat of two waves makes the lattice.',
    params: { lines: [6, 60, 1, 28, 'Lines'], lobes: [3, 40, 1, 14, 'Lobes'], beat: [0, 1, 0.01, 0.45, 'Second wave'], depth: [0.02, 0.3, 0.005, 0.11, 'Depth'], bands: [1, 3, 1, 2, 'Bands'], weight: [0.2, 3, 0.05, 0.7, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), R = ctx.S * 0.46, k2 = P.lobes + ctx.rng.pick([-3, -2, -1, 1, 2, 3]), ph0 = ctx.rng.range(0, TAU);
      for (let b = 0; b < P.bands; b++) {
        const Rb = R * (1 - b * 0.34), A = R * P.depth * (1 - b * 0.2), n = Math.max(240, Math.min(720, (P.lobes + Math.abs(k2)) * 20));
        for (let i = 0; i < P.lines && !B.full(); i++) {
          const ph = ph0 + TAU * i / P.lines, p = [];
          for (let q = 0; q < n; q++) {
            const t = TAU * q / n, r = Rb + A * (Math.sin(P.lobes * t + ph) + P.beat * Math.sin(k2 * t - ph * 2 + b));
            p.push(ctx.cx + r * Math.cos(t), ctx.cy + r * Math.sin(t));
          }
          B.poly(p, true, { f: -1, s: (b + (i % 2) * (P.inks > 2 ? 1 : 0)) % P.inks, w: P.weight });
        }
      }
    },
  },
  {
    id: 'gear-lace', name: 'Gear Lace', family: 'geometric',
    blurb: 'Curves of a pen in a small gear that rolls inside a ring. Each closed curve is filled by the even-odd rule, so its crossings make a lace of cells.',
    params: { ring: [24, 120, 1, 96, 'Ring teeth'], gear: [5, 80, 1, 36, 'Gear teeth'], pen: [0.2, 1.6, 0.01, 0.85, 'Pen offset'], layers: [1, 5, 1, 3, 'Layers'], fill: [0, 1, 1, 1, 'Even-odd fill'], weight: [0.2, 3, 0.05, 0.8, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), R0 = ctx.S * 0.47;
      for (let L = 0; L < P.layers && !B.full(); L++) {
        const Rt = P.ring, rt = Math.max(5, Math.min(Rt - 3, P.gear + (L ? ctx.rng.int(-8, 8) : 0))), g = gcd(Rt, rt), turns = rt / g;
        const scale = R0 * (1 - L * 0.16), R = 1, r = rt / Rt, d = P.pen * r, ext = R - r + d, k = scale / ext;
        const n = Math.min(6000, Math.max(400, Math.round(turns * 160))), p = [], rot = ctx.rng.range(0, TAU);
        for (let q = 0; q < n; q++) {
          const t = TAU * turns * q / n, x = (R - r) * Math.cos(t) + d * Math.cos((R - r) / r * t), y = (R - r) * Math.sin(t) - d * Math.sin((R - r) / r * t);
          p.push(ctx.cx + k * (x * Math.cos(rot) - y * Math.sin(rot)), ctx.cy + k * (x * Math.sin(rot) + y * Math.cos(rot)));
        }
        const ink = L % P.inks;
        if (P.fill) B.multi([p], { f: ink, s: -1 });
        else B.poly(p, true, { f: -1, s: ink, w: P.weight });
      }
    },
  },
  {
    id: 'lissajous-table', name: 'Lissajous Table', family: 'geometric',
    blurb: 'A table of Lissajous figures: the column sets the x frequency and the row the y frequency, so the curves grow more complex toward the far corner.',
    params: { size: [2, 10, 1, 6, 'Columns'], phase: [0, 1, 0.01, 0.25, 'Phase'], drift: [0, 1, 0.01, 0.3, 'Phase drift'], pad: [0.05, 0.4, 0.01, 0.16, 'Padding'], grid: [0, 1, 1, 1, 'Cell lines'], weight: [0.3, 5, 0.1, 1.5, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), cw = ctx.W / P.size, rows = Math.max(1, Math.round(ctx.H / cw)), ch = ctx.H / rows, rr = Math.min(cw, ch) * (0.5 - P.pad / 2), ph0 = ctx.rng.range(0, 1);
      for (let j = 0; j < rows; j++) for (let i = 0; i < P.size; i++) {
        const a = i + 1, b = j + 1, cx = (i + 0.5) * cw, cy = (j + 0.5) * ch, n = Math.min(900, 80 + 60 * (a + b)), p = [];
        const ph = TAU * (P.phase + P.drift * ph0 * (i - j) / Math.max(1, P.size));
        for (let q = 0; q < n; q++) { const t = TAU * q / n; p.push(cx + rr * Math.sin(a * t + ph), cy + rr * Math.sin(b * t)); }
        const ink = P.inks === 1 ? 0 : a === b ? 1 % P.inks : (gcd(a, b) > 1 ? 2 : 0) % P.inks;
        B.poly(p, true, { f: -1, s: ink, w: P.weight });
        if (P.grid) B.rect(i * cw + 0.01, j * ch + 0.01, cw - 0.02, ch - 0.02, { f: -1, s: (P.inks - 1) % P.inks, w: 0.4 });
      }
    },
  },
  {
    id: 'superformula', name: 'Superformula Blooms', family: 'geometric',
    blurb: 'Shapes from one formula with a symmetry number and three exponents: stars, petals, rounded squares and pinched seeds, each drawn as nested layers.',
    params: { m: [1, 16, 1, 8, 'Symmetry'], n1: [0.2, 8, 0.05, 0.6, 'Exponent 1'], n2: [0.2, 8, 0.05, 1.2, 'Exponent 2'], n3: [0.2, 8, 0.05, 1.2, 'Exponent 3'], across: [1, 8, 1, 3, 'Blooms across'], layers: [1, 8, 1, 4, 'Layers'], spin: [0, 1, 0.01, 0.15, 'Spin'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), cw = ctx.W / P.across, rows = Math.max(1, Math.round(ctx.H / cw)), ch = ctx.H / rows, n = 360;
      const sf = (t, m, n1, n2, n3) => { const a = Math.pow(Math.abs(Math.cos(m * t / 4)), n2), b = Math.pow(Math.abs(Math.sin(m * t / 4)), n3); return Math.pow(a + b, -1 / n1); };
      for (let j = 0; j < rows; j++) for (let i = 0; i < P.across; i++) {
        const cx = (i + 0.5) * cw, cy = (j + 0.5) * ch, R = Math.min(cw, ch) * 0.46, r = ctx.rng;
        const m = Math.max(1, P.m + (P.across > 1 ? r.int(-1, 1) : 0)), e1 = P.n1 * r.range(0.85, 1.15), e2 = P.n2 * r.range(0.85, 1.15), e3 = P.n3 * r.range(0.85, 1.15);
        const raw = []; let mx = 1e-9;
        for (let q = 0; q < n; q++) { const v = sf(TAU * q / n, m, e1, e2, e3); raw.push(Number.isFinite(v) ? v : 0); mx = Math.max(mx, Number.isFinite(v) ? v : 0); }
        for (let L = 0; L < P.layers; L++) {
          const s = R * (1 - L / P.layers) / mx, rot = L * P.spin * TAU / Math.max(1, m), p = [];
          for (let q = 0; q < n; q++) { const t = TAU * q / n + rot; p.push(cx + s * raw[q] * Math.cos(t), cy + s * raw[q] * Math.sin(t)); }
          B.poly(p, true, { f: (L + i + j) % P.inks });
        }
      }
    },
  },
  {
    id: 'pursuit-polygons', name: 'Pursuit Polygons', family: 'geometric',
    blurb: 'In each tile, a polygon draws the next one with its corners a short way along each edge. The corners chase each other, and turning curves appear.',
    params: { base: [0, 2, 1, 1, 'Tile shape'], size: [1, 10, 1, 4, 'Tiles across'], steps: [5, 60, 1, 26, 'Steps'], t: [0.02, 0.3, 0.005, 0.08, 'Step along edge'], alt: [0, 1, 1, 1, 'Alternate turn'], fill: [0, 1, 1, 0, 'Solid bands'], inks: [1, 5, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), a = ctx.W / P.size, tiles = [];
      if (P.base === 1) {
        for (let j = 0; j * a < ctx.H; j++) for (let i = 0; i < P.size; i++) tiles.push([[i * a, j * a], [(i + 1) * a, j * a], [(i + 1) * a, (j + 1) * a], [i * a, (j + 1) * a], (i + j) & 1]);
      } else if (P.base === 0) {
        const h = a * Math.sqrt(3) / 2;
        for (let j = 0; j * h < ctx.H; j++) for (let i = -1; i <= P.size; i++) {
          const x = i * a + (j & 1 ? a / 2 : 0), y = j * h;
          tiles.push([[x, y], [x + a, y], [x + a / 2, y + h], (i + j) & 1]);
          tiles.push([[x + a, y], [x + a * 1.5, y + h], [x + a / 2, y + h], (i + j + 1) & 1]);
        }
      } else {
        const R = a / Math.sqrt(3), w = a, hh = 1.5 * R;
        for (let j = -1; j * hh < ctx.H + R; j++) for (let i = -1; i <= P.size; i++) {
          const cx = i * w + (j & 1 ? w / 2 : 0), cy = j * hh, v = [];
          for (let k = 0; k < 6; k++) { const an = -Math.PI / 2 + k * Math.PI / 3; v.push([cx + R * Math.cos(an), cy + R * Math.sin(an)]); }
          v.push(((i + j) & 1)); tiles.push(v);
        }
      }
      const flipAll = ctx.rng.chance(0.5);
      for (const tl of tiles) {
        if (B.full()) break;
        const par = tl.pop(); let V = tl.map(p => p.slice());
        if (P.alt ? (par ^ flipAll) : flipAll) V.reverse();
        const ink0 = P.inks === 1 ? 0 : inkAt(ctx, V[0][0], V[0][1], P.inks, 0.4);
        for (let s = 0; s < P.steps; s++) {
          const ring = V.flat();
          if (P.fill) B.poly(ring, true, { f: s % 2 ? -2 : ink0 }); else B.poly(ring, true, { f: -1, s: (ink0 + (s % 2) * (P.inks > 1 ? 1 : 0)) % P.inks, w: 0.8 });
          V = V.map((p, k) => { const q = V[(k + 1) % V.length]; return [p[0] + (q[0] - p[0]) * P.t, p[1] + (q[1] - p[1]) * P.t]; });
          if (Math.hypot(V[0][0] - V[1][0], V[0][1] - V[1][1]) < 1.5) break;
        }
      }
    },
  },
  {
    id: 'apollonian', name: 'Apollonian Gasket', family: 'geometric',
    blurb: 'A disc filled with circles that each touch three others. Every gap between three circles takes the one circle that fits it, found by the Descartes circle rule.',
    params: { split: [0.15, 0.85, 0.01, 0.5, 'First split'], minR: [0.6, 20, 0.1, 1.5, 'Smallest circle'], gap: [0, 0.3, 0.01, 0.06, 'Bead gap'], fill: [0, 1, 1, 1, 'Solid circles'], rim: [0, 1, 1, 1, 'Outer ring'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), R = ctx.S * 0.47, cx = ctx.cx, cy = ctx.cy, u = ctx.rng.range(0, TAU), ux = Math.cos(u), uy = Math.sin(u);
      const C = (r, x, y) => [1 / r, x / r, y / r];
      const r1 = R * P.split, r2 = R - r1, c0 = [-1 / R, -cx / R, -cy / R];
      const c1 = C(r1, cx + (R - r1) * ux, cy + (R - r1) * uy), c2 = C(r2, cx - (R - r2) * ux, cy - (R - r2) * uy);
      // The third circle: k3 = k0 + k1 + k2 + 2 sqrt(k0 k1 + k1 k2 + k2 k0), centre by the complex rule.
      const k3 = c0[0] + c1[0] + c2[0] + 2 * Math.sqrt(Math.max(0, c0[0] * c1[0] + c1[0] * c2[0] + c2[0] * c0[0]));
      const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
      const z = c => [c[1], c[2]], S = [c0, c1, c2].map(z), sum = [S[0][0] + S[1][0] + S[2][0], S[0][1] + S[1][1] + S[2][1]];
      const pr = [mul(S[0], S[1]), mul(S[1], S[2]), mul(S[2], S[0])].reduce((a, b) => [a[0] + b[0], a[1] + b[1]]);
      const mod = Math.sqrt(Math.hypot(pr[0], pr[1])), ang = Math.atan2(pr[1], pr[0]) / 2, sq = [mod * Math.cos(ang), mod * Math.sin(ang)];
      let c3 = [k3, sum[0] + 2 * sq[0], sum[1] + 2 * sq[1]];
      // Of the two signs, keep the one whose centre is at distance R - r3 from the middle.
      const fit = c => Math.abs(Math.hypot(c[1] / c[0] - cx, c[2] / c[0] - cy) - (R - 1 / c[0]));
      const alt = [k3, sum[0] - 2 * sq[0], sum[1] - 2 * sq[1]];
      if (fit(alt) < fit(c3)) c3 = alt;
      const refl = (a, b, c, o) => [2 * (a[0] + b[0] + c[0]) - o[0], 2 * (a[1] + b[1] + c[1]) - o[1], 2 * (a[2] + b[2] + c[2]) - o[2]];
      const c4 = refl(c0, c1, c2, c3), out = [[c1, 0], [c2, 0], [c3, 1], [c4, 1]];
      const q = [[c0, c1, c3, c2, 2], [c0, c2, c3, c1, 2], [c1, c2, c3, c0, 2], [c0, c1, c4, c2, 2], [c0, c2, c4, c1, 2], [c1, c2, c4, c0, 2]];
      const MAX = Math.min(60000, 15000 * Math.max(1, (ctx.D || 1) ** 2));
      for (let h = 0; h < q.length && out.length < MAX; h++) {
        const [a, b, c, o, g] = q[h], n = refl(a, b, c, o);
        if (!(n[0] > 0) || 1 / n[0] < P.minR) continue;
        out.push([n, g]);
        q.push([a, b, n, c, g + 1], [a, c, n, b, g + 1], [b, c, n, a, g + 1]);
      }
      if (P.rim) B.circle(cx, cy, R, { f: -1, s: 0, w: 1.2 });
      for (const [c, g] of out) {
        const r = 1 / c[0], x = c[1] / c[0], y = c[2] / c[0], rr = r * (1 - P.gap);
        if (!(rr > 0.3)) continue;
        if (P.fill) B.circle(x, y, rr, { f: (g + (r > R * 0.2 ? 0 : 1)) % P.inks }); else B.circle(x, y, rr, { f: -1, s: g % P.inks, w: clamp(r / 30, 0.25, 1.5) });
      }
    },
  },
];

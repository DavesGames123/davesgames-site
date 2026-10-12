// ============================================================================
//  PATTERN DESIGNER  ·  patterns/opart.js — the op-art family
// ----------------------------------------------------------------------------
//  Patterns that make the eye see motion: line fields that beat into
//  moire, a tunnel of nested shapes whose centres drift, stripe bands
//  whose edges wave in step, and a grid of square nests that turn by a
//  field. They are general optical effects, in the spirit of 1960s op
//  art, with no copy of a known work.
//  Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def,
//      label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so each element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp } from '../engine.js';
import { board } from './kit.js';

export default [
  {
    id: 'moire-lines', name: 'Moire Lines', family: 'opart',
    blurb: 'Two or three fields of fine parallel lines at a small angle to each other. Where they beat, broad ghost bands cross the board.',
    params: { spacing: [4, 20, 0.5, 7, 'Line spacing'], angle: [0, 12, 0.1, 3, 'Angle between'], layers: [2, 3, 1, 2, 'Layers'], bend: [0, 1, 0.01, 0.3, 'Bend'], weight: [0.3, 4, 0.05, 1.2, 'Line weight'], inks: [1, 3, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), D = Math.hypot(ctx.W, ctx.H) / 2 + P.spacing, base = ctx.rng.range(0, Math.PI), wl = ctx.S * ctx.rng.range(0.35, 0.7);
      for (let L = 0; L < P.layers && !B.full(); L++) {
        const a = base + (L - (P.layers - 1) / 2) * P.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), sp = P.spacing * (1 + L * 0.015);
        const amp = L === 1 ? P.bend * sp * 3 : 0, step = amp > 0 ? 8 : 2 * D;
        for (let v = -D; v <= D; v += sp) {
          const p = [];
          for (let u = -D; u <= D + 0.1; u += step) { const o = v + amp * Math.sin(TAU * u / wl); p.push(ctx.cx + u * c - o * s, ctx.cy + u * s + o * c); }
          B.poly(p, false, { s: L % P.inks, w: P.weight });
        }
      }
    },
  },
  {
    id: 'drift-tunnel', name: 'Drift Tunnel', family: 'opart',
    blurb: 'Nested shapes in turns of ink and paper. Each ring moves its centre a step and turns a little, so the stack reads as a tunnel that bends away.',
    params: { rings: [10, 90, 1, 40, 'Rings'], sides: [0, 8, 1, 4, 'Sides (0 round)'], drift: [0, 1, 0.01, 0.4, 'Drift'], twist: [0, 0.2, 0.002, 0.03, 'Twist'], ease: [0.5, 2.5, 0.01, 1.3, 'Ring spacing'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), D = Math.hypot(ctx.W, ctx.H) * 0.62, a = ctx.rng.range(0, TAU), ex = Math.cos(a) * ctx.S * 0.35 * P.drift, ey = Math.sin(a) * ctx.S * 0.35 * P.drift;
      const sides = P.sides === 1 || P.sides === 2 ? 3 : P.sides, rot0 = ctx.rng.range(0, TAU);
      for (let k = 0; k < P.rings; k++) {
        const t = k / P.rings, r = D * Math.pow(1 - t, P.ease), cx = ctx.cx + ex * t * t, cy = ctx.cy + ey * t * t, rot = rot0 + k * P.twist * TAU;
        if (r < 1) break;
        const n = sides ? sides : Math.max(48, Math.round(r / 4)), p = [];
        for (let q = 0; q < n; q++) { const an = rot + TAU * q / n; p.push(cx + r * Math.cos(an), cy + r * Math.sin(an)); }
        B.poly(p, true, { f: k % 2 ? -2 : Math.floor(k / 2) % P.inks });
      }
    },
  },
  {
    id: 'wave-bands', name: 'Wave Bands', family: 'opart',
    blurb: 'Stripes whose edges wave together, with the wave a little later in each stripe. The bands swell and pinch, and the board seems to ripple.',
    params: { bands: [8, 80, 1, 32, 'Bands'], amp: [0, 1, 0.01, 0.7, 'Wave depth'], waves: [0.5, 8, 0.1, 2.5, 'Waves down'], step: [0, 1, 0.01, 0.18, 'Phase step'], taper: [0, 1, 0.01, 0.6, 'Taper'], across: [0, 1, 1, 0, 'Horizontal'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), hz = !!P.across, W = hz ? ctx.H : ctx.W, H = hz ? ctx.W : ctx.H, w = W / P.bands, phi = P.step * TAU;
      // Edges never cross: the amplitude stays under w / (2 sin(phi / 2)).
      const Amax = phi > 1e-6 ? w / (2 * Math.sin(phi / 2)) * 0.92 : w * 0.45, ph0 = ctx.rng.range(0, TAU), lam = H / P.waves;
      const edge = k => {
        const p = [];
        for (let y = -10; y <= H + 10; y += 6) {
          const tx = k / P.bands, A = Math.min(Amax, w * 3) * P.amp * (1 - P.taper + P.taper * Math.sin(Math.PI * clamp(y / H, 0, 1)) * (0.4 + 0.6 * tx));
          p.push(k * w + A * Math.sin(TAU * y / lam + ph0 + k * phi), y);
        }
        return p;
      };
      let prev = edge(-1);
      for (let k = 0; k <= P.bands + 1; k++) {
        const cur = edge(k);
        if (k % 2 === 1) {
          const ring = prev.slice(); for (let i = cur.length - 2; i >= 0; i -= 2) ring.push(cur[i], cur[i + 1]);
          const r2 = hz ? ring.map((v, i) => ring[i % 2 ? i - 1 : i + 1]) : ring;
          B.poly(r2, true, { f: ((k - 1) / 2) % P.inks });
        }
        prev = cur;
      }
    },
  },
  {
    id: 'turning-squares', name: 'Turning Squares', family: 'opart',
    blurb: 'A grid of nested squares in turns of ink and paper. The turn of each nest follows a slow field, so the flat grid seems to twist in depth.',
    params: { cells: [3, 24, 1, 9, 'Cells'], nests: [1, 8, 1, 4, 'Squares per cell'], twist: [0, 1, 0.01, 0.5, 'Twist'], field: [0, 2, 1, 0, 'Field'], shrink: [0.5, 0.95, 0.01, 0.78, 'Shrink'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), s = ctx.S / P.cells, nx = Math.ceil(ctx.W / s), ny = Math.ceil(ctx.H / s), x0 = (ctx.W - nx * s) / 2, y0 = (ctx.H - ny * s) / 2;
      const fx = ctx.rng.range(0.3, 0.7) * ctx.W, fy = ctx.rng.range(0.3, 0.7) * ctx.H, ang = ctx.rng.range(0, TAU), D = Math.hypot(ctx.W, ctx.H) / 2;
      const F = (x, y) => P.field === 0 ? Math.cos(Math.PI * Math.hypot(x - fx, y - fy) / D) : P.field === 1 ? ((x - ctx.cx) * Math.cos(ang) + (y - ctx.cy) * Math.sin(ang)) / D : ctx.noise.fbm(x / ctx.S * 1.6, y / ctx.S * 1.6, 2) * 1.8;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * s, cy = y0 + (j + 0.5) * s, th = P.twist * Math.PI / 4 * F(cx, cy);
        let h = s / 2;
        for (let k = 0; k < P.nests * 2; k++) {
          const a = th * k / 2 + Math.PI / 4, r = h * Math.SQRT2, p = [];
          for (let q = 0; q < 4; q++) p.push(cx + r * Math.cos(a + q * Math.PI / 2), cy + r * Math.sin(a + q * Math.PI / 2));
          B.poly(p, true, { f: k % 2 ? -2 : (Math.floor(k / 2) + (i + j) % 2) % P.inks });
          // The next square fits inside this one at its turn, a little smaller,
          // so each ring shows even where the twist is zero.
          h = h / (Math.abs(Math.cos(th / 2)) + Math.abs(Math.sin(th / 2))) * Math.sqrt(P.shrink);
          if (h < 0.8) break;
        }
      }
    },
  },
];

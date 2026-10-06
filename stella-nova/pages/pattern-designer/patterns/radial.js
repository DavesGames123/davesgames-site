// ============================================================================
//  PATTERN DESIGNER  ·  patterns/radial.js — the radial family
// ----------------------------------------------------------------------------
//  Patterns about a centre point: rings, roses, epicycles, rays, seed
//  spirals and arcs. Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def, label] },
//      gen(P, ctx) }
//  gen writes to ctx.out (engine.js class Out) and reads randomness only
//  from ctx.rng and ctx.noise, so the result is fixed by the seed.
//  The centre is the board centre plus an offset (param "shift" where
//  present). Radii scale with the board diagonal, so the pattern fills
//  the corners at every aspect.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp } from '../engine.js';

const gcd = (a, b) => b ? gcd(b, a % b) : a;
// The distance from (cx, cy) to the farthest board corner.
const reach = (ctx, cx, cy) => Math.max(Math.hypot(cx, cy), Math.hypot(ctx.W - cx, cy), Math.hypot(cx, ctx.H - cy), Math.hypot(ctx.W - cx, ctx.H - cy));
// Points on an arc about (cx, cy), about one point per 6 units of length.
function arcPts(cx, cy, r, a0, a1) {
  const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) * r / 6)), p = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return p;
}

export default [
  {
    id: 'phase-rings', name: 'Phase Rings', family: 'radial',
    blurb: 'Rings with a wave on them. The wave phase turns a little from each ring to the next, so the lobes twist into a spiral.',
    params: { rings: [6, 120, 1, 26, 'Rings'], lobes: [0, 16, 1, 7, 'Lobes'], amp: [0, 3, 0.01, 1.4, 'Wave depth'], twist: [0, 0.5, 0.005, 0.035, 'Twist'], weight: [0.3, 12, 0.1, 4, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'], shift: [0, 0.4, 0.01, 0, 'Centre shift'] },
    gen(P, ctx) {
      const a = ctx.rng.range(0, TAU), cx = ctx.cx + Math.cos(a) * P.shift * ctx.S, cy = ctx.cy + Math.sin(a) * P.shift * ctx.S;
      const R = reach(ctx, cx, cy), gap = R / P.rings, ph0 = ctx.rng.range(0, TAU);
      for (let k = 1; k <= P.rings && !ctx.out.full(); k++) {
        const r0 = k * gap, d = P.amp * gap * 0.9 * Math.min(1, k / 6), ph = ph0 + k * P.twist * TAU, n = Math.max(48, Math.round(r0 / 5)), p = [];
        for (let i = 0; i < n; i++) { const t = TAU * i / n, r = r0 + d * Math.sin(P.lobes * t + ph); p.push(cx + r * Math.cos(t), cy + r * Math.sin(t)); }
        ctx.out.poly(p, true, { f: -1, s: (k - 1) % P.inks, w: P.weight, sm: 1 });
      }
    },
  },
  {
    id: 'rose-stack', name: 'Rose Stack', family: 'radial',
    blurb: 'Rose curves r = cos(k t) laid one inside the next. Each layer takes a new petal ratio k = n / d and its own ink.',
    params: { layers: [1, 14, 1, 6, 'Layers'], n: [1, 12, 1, 5, 'Petal n'], d: [1, 9, 1, 3, 'Petal d'], step: [0, 4, 1, 1, 'n step per layer'], size: [0.2, 0.7, 0.01, 0.48, 'Size'], weight: [0.3, 8, 0.1, 2.6, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const rot = ctx.rng.range(0, TAU);
      for (let L = 0; L < P.layers && !ctx.out.full(); L++) {
        let n = P.n + L * P.step, d = P.d;
        const g = gcd(n, d); n /= g; d /= g;
        const k = n / d, turns = (n % 2 && d % 2) ? Math.PI * d : TAU * d;
        const R = ctx.S * P.size * (1 - L / (P.layers + 1) * 0.85), m = Math.min(4000, Math.ceil(turns * R / 4)), p = [];
        for (let i = 0; i < m; i++) { const t = turns * i / m, r = R * Math.cos(k * t); p.push(ctx.cx + r * Math.cos(t + rot), ctx.cy + r * Math.sin(t + rot)); }
        ctx.out.poly(p, true, { f: -1, s: L % P.inks, w: P.weight * (1 - L / (P.layers * 2)), sm: 1 });
      }
    },
  },
  {
    id: 'epicycle-loops', name: 'Epicycle Loops', family: 'radial',
    blurb: 'A pen on the end of three turning arms. Whole-number arm speeds close the curve, and a symmetry number sets its order.',
    params: { sym: [2, 13, 1, 5, 'Symmetry'], arm2: [0, 1, 0.01, 0.45, 'Arm 2'], arm3: [0, 1, 0.01, 0.22, 'Arm 3'], copies: [1, 12, 1, 5, 'Copies'], spread: [0, 1, 0.01, 0.35, 'Copy spread'], size: [0.15, 0.6, 0.01, 0.46, 'Size'], weight: [0.3, 6, 0.1, 2, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      // Speeds 1 + s*m keep the curve symmetric under a turn of TAU / s.
      const s = P.sym, f2 = 1 + s * ctx.rng.pick([-1, 1, -2, 2]) , f3 = 1 + s * ctx.rng.pick([-3, -2, 2, 3]), ph2 = ctx.rng.range(0, TAU), ph3 = ctx.rng.range(0, TAU);
      for (let c = 0; c < P.copies && !ctx.out.full(); c++) {
        const k = 1 - c / Math.max(1, P.copies) * P.spread, a1 = 1, a2 = P.arm2 * k, a3 = P.arm3 * (2 - k), tot = a1 + a2 + a3;
        const R = ctx.S * P.size * (1 - c * 0.04) / tot, m = 2400, p = [], tw = c * 0.07;
        for (let i = 0; i < m; i++) {
          const t = TAU * i / m;
          const x = a1 * Math.cos(t + tw) + a2 * Math.cos(f2 * t + ph2) + a3 * Math.cos(f3 * t + ph3);
          const y = a1 * Math.sin(t + tw) + a2 * Math.sin(f2 * t + ph2) + a3 * Math.sin(f3 * t + ph3);
          p.push(ctx.cx + R * x, ctx.cy + R * y);
        }
        ctx.out.poly(p, true, { f: -1, s: c % P.inks, w: P.weight, sm: 1 });
      }
    },
  },
  {
    id: 'ray-burst', name: 'Ray Burst', family: 'radial',
    blurb: 'Wedges from one point, in turns of ink. A wave and a little noise change each wedge width, so the burst feels drawn.',
    params: { rays: [6, 120, 1, 36, 'Rays'], wave: [0, 1, 0.01, 0.4, 'Width wave'], waves: [0, 8, 1, 2, 'Wave count'], rough: [0, 1, 0.01, 0.2, 'Roughness'], inks: [2, 5, 1, 2, 'Inks'], shiftX: [-0.5, 0.5, 0.01, 0, 'Centre x'], shiftY: [-0.5, 0.5, 0.01, 0.18, 'Centre y'], core: [0, 0.3, 0.005, 0.06, 'Core disc'] },
    gen(P, ctx) {
      const cx = ctx.cx + P.shiftX * ctx.W, cy = ctx.cy + P.shiftY * ctx.H, R = reach(ctx, cx, cy) * 1.05, n = P.rays * 2, w = [], ph = ctx.rng.range(0, TAU);
      for (let i = 0; i < n; i++) { const t = i / n * TAU; w.push(Math.max(0.15, 1 + P.wave * Math.sin(P.waves * t + ph) + P.rough * ctx.rng.range(-0.8, 0.8))); }
      const sum = w.reduce((a, b) => a + b, 0), a0 = ctx.rng.range(0, TAU);
      let a = a0;
      for (let i = 0; i < n; i++) {
        const da = w[i] / sum * TAU;
        if (i % 2 === 0) {
          const ink = P.inks === 2 ? 0 : (i / 2) % (P.inks - 1);
          ctx.out.poly([cx, cy, ...arcPts(cx, cy, R, a, a + da)], true, { f: ink });
        }
        a += da;
      }
      if (P.core > 0) ctx.out.circle(cx, cy, P.core * ctx.S, { f: P.inks - 1 });
    },
  },
  {
    id: 'seed-head', name: 'Seed Head', family: 'radial',
    blurb: 'Seeds set at the golden angle, as in a sunflower head. The seeds grow toward the rim and the spiral arms take turns of ink.',
    params: { seeds: [100, 6000, 10, 1400, 'Seeds'], angle: [137, 138.2, 0.001, 137.508, 'Angle'], grow: [0, 2, 0.01, 0.9, 'Size growth'], dot: [0.2, 1, 0.01, 0.86, 'Seed size'], arms: [0, 3, 1, 2, 'Arm colour (off, 8, 13, 21)'], inks: [1, 5, 1, 3, 'Inks'], shape: [0, 2, 1, 0, 'Shape (dot, ring, petal)'] },
    gen(P, ctx) {
      const N = P.seeds, Rm = Math.min(ctx.W, ctx.H) * 0.47, c = Rm / Math.sqrt(N), da = P.angle * Math.PI / 180, arm = [0, 8, 13, 21][P.arms];
      for (let i = 1; i <= N && !ctx.out.full(); i++) {
        const r = c * Math.sqrt(i), t = i * da, x = ctx.cx + r * Math.cos(t), y = ctx.cy + r * Math.sin(t);
        const s = c * P.dot * 0.5 * (1 + P.grow * (r / Rm - 0.5));
        const ink = P.inks === 1 ? 0 : arm ? (i % arm) % P.inks : clamp(Math.floor(r / Rm * P.inks), 0, P.inks - 1);
        if (P.shape === 0) ctx.out.circle(x, y, s, { f: ink });
        else if (P.shape === 1) ctx.out.circle(x, y, s * 0.8, { f: -1, s: ink, w: s * 0.35 });
        else {
          const p = [], u = Math.cos(t), v = Math.sin(t);
          for (let k = 0; k < 12; k++) { const q = TAU * k / 12, a = s * 1.5 * Math.cos(q), b = s * 0.7 * Math.sin(q); p.push(x + a * u - b * v, y + a * v + b * u); }
          ctx.out.poly(p, true, { f: ink, sm: 1 });
        }
      }
    },
  },
  {
    id: 'arc-rings', name: 'Arc Rings', family: 'radial',
    blurb: 'Rings broken into arcs of mixed length, like the tracks of a dial. Each arc takes a thick stroke and one ink.',
    params: { rings: [3, 60, 1, 18, 'Rings'], fill: [0.1, 1, 0.01, 0.7, 'Arc share'], parts: [1, 16, 1, 5, 'Arcs per ring'], weight: [0.1, 0.95, 0.01, 0.55, 'Arc thickness'], inks: [1, 5, 1, 4, 'Inks'], hole: [0, 0.5, 0.01, 0.12, 'Centre hole'], size: [0.2, 1, 0.01, 0.62, 'Size'] },
    gen(P, ctx) {
      const R = ctx.S * P.size * 0.75, r0 = R * P.hole, gap = (R - r0) / P.rings;
      for (let k = 0; k < P.rings && !ctx.out.full(); k++) {
        const r = r0 + (k + 0.5) * gap, n = ctx.rng.int(1, P.parts), base = ctx.rng.range(0, TAU), cuts = [];
        for (let i = 0; i < n; i++) cuts.push(ctx.rng.next());
        cuts.sort((a, b) => a - b);
        for (let i = 0; i < n; i++) {
          const s0 = cuts[i], s1 = i + 1 < n ? cuts[i + 1] : cuts[0] + 1, len = (s1 - s0) * P.fill;
          if (len * TAU * r < gap * 0.6) continue;
          const a0 = base + s0 * TAU, a1 = a0 + len * TAU;
          ctx.out.poly(arcPts(ctx.cx, ctx.cy, r, a0, a1), false, { s: ctx.rng.int(0, P.inks - 1), w: gap * P.weight / 2 });
        }
      }
    },
  },
  {
    id: 'moire-rings', name: 'Moire Rings', family: 'radial',
    blurb: 'Two or three sets of thin rings with offset centres. Where the sets cross, large ghost bands appear.',
    params: { sets: [2, 3, 1, 2, 'Sets'], gap: [3, 30, 0.5, 14, 'Ring gap'], offset: [0, 0.3, 0.005, 0.11, 'Offset'], weight: [0.3, 6, 0.1, 2.6, 'Line weight'], inks: [1, 3, 1, 2, 'Inks'], scaleB: [0.9, 1.1, 0.001, 1, 'Gap ratio'] },
    gen(P, ctx) {
      const a = ctx.rng.range(0, TAU);
      for (let s = 0; s < P.sets && !ctx.out.full(); s++) {
        const q = a + s * TAU / P.sets, d = s === 0 ? 0 : P.offset * ctx.S;
        const cx = ctx.cx + d * Math.cos(q), cy = ctx.cy + d * Math.sin(q), R = reach(ctx, cx, cy), g = P.gap * (s ? P.scaleB : 1);
        for (let r = g; r < R && !ctx.out.full(); r += g) {
          ctx.out.circle(cx, cy, r, { f: -1, s: s % P.inks, w: P.weight });
        }
      }
    },
  },
];

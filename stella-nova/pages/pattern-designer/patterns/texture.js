// ============================================================================
//  PATTERN DESIGNER  ·  patterns/texture.js — the noise family
// ----------------------------------------------------------------------------
//  Tone and grain patterns. Most of them read a soft scalar field in
//  [0, 1] (engine.js toneField) and turn the value into dot size, line
//  width, dot density or hatch layers, as a print screen does. Each entry
//  is
//    { id, name, family, blurb, params: { key: [min, max, step, def, label] },
//      gen(P, ctx) }
//  gen writes to ctx.out and reads randomness only from ctx.rng and
//  ctx.noise, so the result is fixed by the seed.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { clamp, poisson, toneField } from '../engine.js';

// The tone at (x, y) with contrast and invert applied.
function tone(f, P) {
  return (x, y) => {
    let t = f(x, y);
    if (P.invert) t = 1 - t;
    return clamp(0.5 + (t - 0.5) * P.contrast, 0, 1);
  };
}
// A rotated grid that covers the board: calls fn(x, y) for each node.
function screen(ctx, step, ang, fn) {
  const c = Math.cos(ang), s = Math.sin(ang), R = Math.hypot(ctx.W, ctx.H) / 2 + step, n = Math.ceil(R / step);
  for (let v = -n; v <= n; v++) for (let u = -n; u <= n; u++) {
    const x = ctx.cx + u * step * c - v * step * s, y = ctx.cy + u * step * s + v * step * c;
    if (x < -step || y < -step || x > ctx.W + step || y > ctx.H + step) continue;
    fn(x, y, u, v);
    if (ctx.out.full()) return;
  }
}
// One line across the board through the centre offset v, along angle ang:
// calls fn(x, y) at step intervals while the point is near the board.
function scanLine(ctx, ang, v, step) {
  const c = Math.cos(ang), s = Math.sin(ang), R = Math.hypot(ctx.W, ctx.H) / 2 + step, pts = [];
  for (let u = -R; u <= R; u += step) {
    const x = ctx.cx + u * c - v * s, y = ctx.cy + u * s + v * c;
    pts.push([x, y, x > -step && y > -step && x < ctx.W + step && y < ctx.H + step]);
  }
  return pts;
}

export default [
  {
    id: 'grain-stipple', name: 'Grain Stipple', family: 'texture', heavy: true,
    blurb: 'Dots placed with a set clear space around each one. The space shrinks where the tone is dark, so the dots build a soft image.',
    params: { grain: [3, 16, 0.5, 5, 'Smallest spacing'], spread: [1, 10, 0.1, 5, 'Tone spread'], dot: [0.15, 0.8, 0.01, 0.42, 'Dot size'], field: [0, 4, 1, 4, 'Tone source'], contrast: [0.5, 2.5, 0.05, 1.3, 'Contrast'], invert: [0, 1, 1, 0, 'Invert'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const T = tone(toneField(P.field, ctx), P);
      const rFn = (x, y) => { const d = 1 - T(x, y); return P.grain * (1 + P.spread * d * d * 1.4); };
      const pts = poisson(ctx.W, ctx.H, rFn, P.grain, ctx.rnd, 22000);
      for (let i = 0; i < pts.length && !ctx.out.full(); i += 2) {
        const x = pts[i], y = pts[i + 1], t = T(x, y);
        const ink = P.inks === 1 ? 0 : clamp(Math.floor((1 - t) * P.inks), 0, P.inks - 1);
        ctx.out.circle(x, y, P.grain * P.dot * (0.75 + 0.5 * ctx.rng.next()), { f: ink });
      }
    },
  },
  {
    id: 'screen-dots', name: 'Screen Dots', family: 'texture',
    blurb: 'A turned halftone screen. Dot area follows the tone. A second screen at another angle and ink prints over the first.',
    params: { cells: [20, 80, 1, 56, 'Screen lines'], angle: [0, 90, 1, 15, 'Angle'], layers: [1, 2, 1, 2, 'Screens'], field: [0, 4, 1, 0, 'Tone source'], gain: [0.4, 1.4, 0.01, 1, 'Dot gain'], contrast: [0.5, 2.5, 0.05, 1.2, 'Contrast'], invert: [0, 1, 1, 0, 'Invert'], square: [0, 1, 1, 0, 'Square dots'] },
    gen(P, ctx) {
      const step = ctx.S / P.cells;
      for (let L = 0; L < P.layers; L++) {
        const T = tone(toneField(L ? (P.field + 2) % 5 : P.field, ctx), P), ang = (P.angle + L * 30) * Math.PI / 180;
        screen(ctx, step, ang, (x, y) => {
          const t = T(x, y), r = step * 0.5 * Math.sqrt(t) * P.gain * 1.2;
          if (r < step * 0.04) return;
          if (P.square) ctx.out.ngon(x, y, r * 1.12, 4, ang + Math.PI / 4, { f: L });
          else ctx.out.circle(x, y, r, { f: L });
        });
      }
    },
  },
  {
    id: 'line-screen', name: 'Line Screen', family: 'texture',
    blurb: 'Parallel strips that swell and thin with the tone, as an engraved line screen does. A slow wave can bend the strips.',
    params: { lines: [12, 120, 1, 48, 'Lines'], angle: [-90, 90, 1, -20, 'Angle'], width: [0.2, 1, 0.01, 0.92, 'Widest strip'], wobble: [0, 3, 0.05, 0.8, 'Bend'], field: [0, 4, 1, 0, 'Tone source'], contrast: [0.5, 2.5, 0.05, 1.3, 'Contrast'], invert: [0, 1, 1, 0, 'Invert'], inks: [1, 3, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const T = tone(toneField(P.field, ctx), P), sp = ctx.S / P.lines, ang = P.angle * Math.PI / 180;
      const nx = -Math.sin(ang), ny = Math.cos(ang), R = Math.hypot(ctx.W, ctx.H) / 2, n = Math.ceil(R / sp), step = Math.max(3, sp / 3);
      for (let k = -n; k <= n && !ctx.out.full(); k++) {
        const line = scanLine(ctx, ang, k * sp, step);
        let top = [], bot = [];
        const flush = () => {
          if (top.length >= 4) { const ring = top.slice(); for (let i = bot.length - 2; i >= 0; i -= 2) ring.push(bot[i], bot[i + 1]); ctx.out.poly(ring, true, { f: P.inks === 1 ? 0 : ((k % P.inks) + P.inks) % P.inks }); }
          top = []; bot = [];
        };
        for (const [x0, y0, on] of line) {
          if (!on) { flush(); continue; }
          const b = P.wobble * sp * ctx.noise.n2(x0 * 0.002, y0 * 0.002);
          const x = x0 + nx * b, y = y0 + ny * b, w = sp * 0.5 * P.width * T(x, y);
          top.push(x + nx * w, y + ny * w); bot.push(x - nx * w, y - ny * w);
        }
        flush();
      }
    },
  },
  {
    id: 'drift-stack', name: 'Drift Stack', family: 'texture',
    blurb: 'Even rows of lines that drift on a folded noise field. Each row follows the same flow, so the stack bends as one cloth.',
    params: { lines: [10, 160, 1, 70, 'Lines'], amp: [0, 6, 0.05, 1.1, 'Drift'], scale: [0.3, 5, 0.05, 1.6, 'Field scale'], fold: [0, 3, 0.05, 0.7, 'Fold'], weight: [0.3, 5, 0.1, 1.4, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'], bands: [0, 1, 1, 1, 'Ink bands'], vertical: [0, 1, 1, 0, 'Vertical'] },
    gen(P, ctx) {
      const V = !!P.vertical, A = V ? ctx.H : ctx.W, B = V ? ctx.W : ctx.H, gap = B / P.lines, k = 0.0022 / P.scale, step = 9, nz = ctx.noise;
      for (let i = 0; i <= P.lines && !ctx.out.full(); i++) {
        const b0 = i * gap, pts = [];
        for (let a = -step * 2; a <= A + step * 2; a += step) {
          const qx = a * k, qy = b0 * k, w = P.fold * nz.fbm(qx * 0.7 + 3.1, qy * 0.7 - 1.7, 2);
          const d = P.amp * gap * nz.fbm(qx + w, qy + w * 0.6, 3) * 2;
          V ? pts.push(b0 + d, a) : pts.push(a, b0 + d);
        }
        const ink = P.inks === 1 ? 0 : P.bands ? clamp(Math.floor(i / (P.lines + 1) * P.inks), 0, P.inks - 1) : i % P.inks;
        ctx.out.poly(pts, false, { s: ink, w: P.weight, sm: 1 });
      }
    },
  },
  {
    id: 'tone-hatch', name: 'Tone Hatch', family: 'texture',
    blurb: 'Hatch layers in up to four directions. Each layer starts at a darker tone, so shade builds from single lines to dense cross hatch.',
    params: { spacing: [4, 30, 0.5, 11, 'Line spacing'], dirs: [1, 4, 1, 3, 'Directions'], field: [0, 4, 1, 2, 'Tone source'], contrast: [0.5, 2.5, 0.05, 1.3, 'Contrast'], invert: [0, 1, 1, 0, 'Invert'], hand: [0, 2, 0.05, 0.5, 'Hand wobble'], weight: [0.3, 4, 0.1, 1.1, 'Line weight'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const T = tone(toneField(P.field, ctx), P), angs = [45, -45, 0, 90], step = 4;
      for (let d = 0; d < P.dirs && !ctx.out.full(); d++) {
        const ang = angs[d] * Math.PI / 180, th = (d + 1) / (P.dirs + 1) * 0.92, R = Math.hypot(ctx.W, ctx.H) / 2, n = Math.ceil(R / P.spacing);
        const nx = -Math.sin(ang), ny = Math.cos(ang), ink = P.inks === 1 ? 0 : d % P.inks;
        for (let k = -n; k <= n && !ctx.out.full(); k++) {
          let run = [];
          const flush = () => { if (run.length >= 6) ctx.out.poly(run, false, { s: ink, w: P.weight }); run = []; };
          for (const [x0, y0, on] of scanLine(ctx, ang, (k + d * 0.37) * P.spacing, step)) {
            const j = 0.06 * ctx.noise.n2(x0 * 0.03, y0 * 0.03);
            if (!on || T(x0, y0) + j < th) { flush(); continue; }
            const b = P.hand * P.spacing * 0.25 * ctx.noise.n2(x0 * 0.012 + d * 7, y0 * 0.012);
            run.push(x0 + nx * b, y0 + ny * b);
          }
          flush();
        }
      }
    },
  },
  {
    id: 'signal-bars', name: 'Signal Bars', family: 'texture',
    blurb: 'Rows of bars with coded widths, like a stack of bar codes. A noise wave trims the bar heights, and a few bars take an accent ink.',
    params: { rows: [1, 14, 1, 6, 'Rows'], unit: [1.5, 12, 0.25, 4.5, 'Bar unit'], gap: [0, 0.4, 0.01, 0.12, 'Row gap'], trim: [0, 1, 0.01, 0.55, 'Height wave'], centre: [0, 1, 1, 1, 'Centred bars'], accent: [0, 0.4, 0.01, 0.08, 'Accent bars'], scale: [0.3, 4, 0.05, 1, 'Wave scale'] },
    gen(P, ctx) {
      const m = ctx.S * 0.06, rh = (ctx.H - 2 * m) / P.rows, g = rh * P.gap;
      for (let r = 0; r < P.rows && !ctx.out.full(); r++) {
        const y0 = m + r * rh + g / 2, h = rh - g;
        let x = m;
        while (x < ctx.W - m && !ctx.out.full()) {
          const w = P.unit * [1, 1, 1, 2, 2, 3, 4][ctx.rng.int(0, 6)];
          if (x + w > ctx.W - m) break;
          const n = 0.5 + 0.5 * ctx.noise.fbm(x * 0.004 / P.scale, r * 0.9, 3);
          const bh = Math.max(h * 0.06, h * (1 - P.trim * (1 - n) * 1.3));
          const y = P.centre ? y0 + (h - bh) / 2 : y0 + h - bh;
          ctx.out.rect(x, y, w, bh, { f: ctx.rng.chance(P.accent) ? 1 : 0 });
          x += w + P.unit * [1, 1, 2, 3][ctx.rng.int(0, 3)];
        }
      }
    },
  },
];

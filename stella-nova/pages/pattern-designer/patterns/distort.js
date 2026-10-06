// ============================================================================
//  PATTERN DESIGNER  ·  patterns/distort.js — the distortion family
// ----------------------------------------------------------------------------
//  Each pattern is a plain base (lines, cells, stripes, dots, shapes) that
//  goes through one warp. Straight edges are resampled before the warp, so
//  they bend. Each warp is a smooth one-to-one map at the default values,
//  so the shapes do not fold over themselves. Entry format: see grid.js.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp, resample, clipHalf } from '../engine.js';

// Apply fn(x, y) -> [x, y] to each point of a flat list.
function warp(p, fn) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) { const q = fn(p[i], p[i + 1]); out[i] = q[0]; out[i + 1] = q[1]; }
  return out;
}
// A ring of n points on a circle.
function circlePts(cx, cy, r, n = 72) {
  const p = [];
  for (let k = 0; k < n; k++) { const a = TAU * k / n; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return p;
}
// Lens map: each lens moves points away from its centre (k > 0) or toward
// it (k < 0) with a Gaussian falloff. Lenses apply one after another.
function lensMap(lenses) {
  return (x, y) => {
    for (const [cx, cy, R, k] of lenses) {
      const dx = x - cx, dy = y - cy, f = 1 + k * Math.exp(-(dx * dx + dy * dy) / (R * R));
      x = cx + dx * f; y = cy + dy * f;
    }
    return [x, y];
  };
}

export default [
  {
    id: 'lens-grid', name: 'Lens Grid', family: 'distort',
    blurb: 'A ruled grid seen through a few round lenses. Each lens swells or pinches the lines near it.',
    params: { lines: [8, 90, 1, 34, 'Lines'], lenses: [1, 6, 1, 3, 'Lenses'], strength: [-0.8, 2, 0.01, 1.1, 'Lens power'], radius: [0.08, 0.6, 0.01, 0.24, 'Lens size'], cross: [0, 1, 1, 1, 'Both directions'], weight: [0.3, 6, 0.1, 1.6, 'Line weight'], inks: [1, 3, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, lenses = [];
      for (let k = 0; k < P.lenses; k++) lenses.push([rng.range(0.18, 0.82) * W, rng.range(0.18, 0.82) * H, S * P.radius * rng.range(0.7, 1.3), P.strength * rng.range(0.65, 1)]);
      const fn = lensMap(lenses), s = S / P.lines, m = s * 4, st = Math.max(2, s / 6);
      for (let y = (H % s) / 2 - m; y <= H + m; y += s) {
        if (ctx.out.full()) return;
        ctx.out.poly(warp(resample([-m, y, W + m, y], st), fn), false, { s: 0, w: P.weight });
      }
      if (!P.cross) return;
      for (let x = (W % s) / 2 - m; x <= W + m; x += s) {
        if (ctx.out.full()) return;
        ctx.out.poly(warp(resample([x, -m, x, H + m], st), fn), false, { s: P.inks > 1 ? 1 : 0, w: P.weight });
      }
      if (P.inks > 2) for (const [cx, cy, R] of lenses) ctx.out.circle(cx, cy, Math.max(3, R * 0.06), { f: 2 });
    },
  },
  {
    id: 'twirl-checker', name: 'Twirl Checker', family: 'distort',
    blurb: 'A checkerboard turned about one or more centres. The turn fades with distance, so the squares bend into a vortex.',
    params: { cells: [4, 40, 1, 14, 'Cells'], twist: [-8, 8, 0.05, 3.2, 'Twist (rad)'], radius: [0.1, 0.9, 0.01, 0.38, 'Twist size'], twirls: [1, 4, 1, 1, 'Centres'], inks: [1, 3, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, cs = [];
      for (let k = 0; k < P.twirls; k++) cs.push(k === 0 ? [W / 2 + rng.range(-0.08, 0.08) * W, H / 2 + rng.range(-0.08, 0.08) * H, P.twist] : [rng.range(0.15, 0.85) * W, rng.range(0.15, 0.85) * H, P.twist * rng.range(-1, 1)]);
      const R = S * P.radius / Math.sqrt(P.twirls);
      const fn = (x, y) => {
        for (const [cx, cy, tw] of cs) {
          const dx = x - cx, dy = y - cy, a = tw * Math.exp(-(dx * dx + dy * dy) / (R * R)), c = Math.cos(a), s = Math.sin(a);
          x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
        }
        return [x, y];
      };
      const s = S / P.cells, nx = Math.ceil(W / s) + 4, ny = Math.ceil(H / s) + 4, x0 = (W - nx * s) / 2, y0 = (H - ny * s) / 2, st = s / 8;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (ctx.out.full()) return;
        const on = (i + j) % 2 === 0;
        if (!on && P.inks < 2) continue;
        const x = x0 + i * s, y = y0 + j * s;
        const ink = on ? (P.inks > 2 && (Math.floor(i / 2) + Math.floor(j / 2)) % 2 ? 2 : 0) : 1;
        ctx.out.poly(warp(resample([x, y, x + s, y, x + s, y + s, x, y + s], st, true), fn), true, { f: ink });
      }
    },
  },
  {
    id: 'sine-stripes', name: 'Sine Stripes', family: 'distort',
    blurb: 'Even bands pushed up and down by a sum of crossing sine waves, so the flat page seems to ripple.',
    params: { stripes: [10, 120, 1, 46, 'Stripes'], fill: [0.2, 0.8, 0.01, 0.5, 'Band width'], amp: [0, 12, 0.05, 6, 'Wave height'], waves: [1, 5, 1, 3, 'Waves'], freq: [0.5, 8, 0.05, 2.2, 'Wave count'], swell: [0, 1, 0.01, 0.65, 'Centre swell'], inks: [1, 4, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, h = S / P.stripes, wv = [];
      let gy = 0;
      for (let k = 0; k < P.waves; k++) {
        const a = rng.range(-0.55, 0.55), f = TAU * P.freq / S * rng.range(0.7, 1.4);
        wv.push([f * Math.cos(a), f * Math.sin(a) * 0.5, rng.range(0, TAU)]);
        gy += Math.abs(f * Math.sin(a) * 0.5);
      }
      const R = 0.55 * Math.max(W, H);
      // Keep d(offset)/dy below 0.8, so the bands never cross.
      const A = Math.min(P.amp * h, 0.8 / (gy / P.waves + 1.2 / R));
      const D = (x, y) => {
        let v = 0;
        for (const [fx, fy, ph] of wv) v += Math.sin(fx * x + fy * y + ph);
        const dx = x - W / 2, dy = y - H / 2, env = 1 - P.swell + P.swell * Math.exp(-(dx * dx + dy * dy) / (R * R));
        return A * env * v / P.waves;
      };
      const line = y => { const p = []; for (let x = -20; x <= W + 20; x += 6) p.push(x, y + D(x, y)); return p; };
      const m = A + h * 2;
      let k = 0;
      for (let y = -m; y < H + m; y += h, k++) {
        if (ctx.out.full()) return;
        const top = line(y), bot = line(y + h * P.fill), pts = top.slice();
        for (let i = bot.length - 2; i >= 0; i -= 2) pts.push(bot[i], bot[i + 1]);
        ctx.out.poly(pts, true, { f: k % P.inks });
      }
    },
  },
  {
    id: 'pulled-dots', name: 'Pulled Dots', family: 'distort',
    blurb: 'A dot grid drawn toward a few hidden points. Where the grid packs, the dots shrink; where it opens, they grow.',
    params: { cells: [12, 80, 1, 40, 'Cells'], attract: [1, 6, 1, 3, 'Attractors'], pull: [-1.5, 0.95, 0.01, 0.75, 'Pull'], radius: [0.08, 0.6, 0.01, 0.22, 'Reach'], size: [0.15, 0.95, 0.01, 0.62, 'Dot size'], resp: [0, 2, 0.01, 1, 'Size response'], hex: [0, 1, 1, 1, 'Hex grid'], inks: [1, 3, 1, 1, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, at = [];
      for (let k = 0; k < P.attract; k++) at.push([rng.range(0.15, 0.85) * W, rng.range(0.15, 0.85) * H, S * P.radius * rng.range(0.7, 1.3), P.pull * rng.range(0.7, 1)]);
      const fn = lensMap(at.map(([x, y, R, k]) => [x, y, R, -k]));
      const s = S / P.cells, rowH = P.hex ? s * Math.sqrt(3) / 2 : s, e = s * 0.25;
      for (let j = -3; j * rowH < H + 3 * s; j++) for (let i = -3; i * s < W + 3 * s; i++) {
        if (ctx.out.full()) return;
        const x = i * s + (P.hex && j % 2 ? s / 2 : 0), y = j * rowH;
        const [X, Y] = fn(x, y);
        if (X < -s || Y < -s || X > W + s || Y > H + s) continue;
        const [ax, ay] = fn(x + e, y), [bx, by] = fn(x, y + e);
        const J = Math.abs((ax - X) * (by - Y) - (ay - Y) * (bx - X)) / (e * e);
        const k = Math.pow(J, 0.5 * P.resp), r = Math.min(s * 0.5 * P.size * k, s * 1.4);
        const ink = P.inks === 1 ? 0 : clamp(Math.floor(clamp(Math.log(J) * 0.8 + 0.5, 0, 0.999) * P.inks), 0, P.inks - 1);
        ctx.out.circle(X, Y, r, { f: ink });
      }
    },
  },
  {
    id: 'slice-shift', name: 'Slice Shift', family: 'distort',
    blurb: 'A few bold shapes cut into thin horizontal slices, and some slices slide sideways, like a broken video frame.',
    params: { slices: [6, 120, 1, 30, 'Slices'], gap: [0, 0.6, 0.01, 0.18, 'Slice gap'], shift: [0, 1, 0.01, 0.4, 'Slide distance'], chance: [0, 1, 0.01, 0.45, 'Slide chance'], split: [0, 1, 0.01, 0.25, 'Colour split'], shapes: [2, 7, 1, 4, 'Shapes'], inks: [2, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, shapes = [];
      let ink = rng.int(0, P.inks - 1);
      const nextInk = () => (ink = (ink + rng.int(1, Math.max(1, P.inks - 1))) % P.inks);
      for (let k = 0; k < P.shapes; k++) {
        const big = k === 0, cx = (big ? rng.range(0.4, 0.6) : rng.range(0.2, 0.8)) * W, cy = (big ? rng.range(0.38, 0.55) : rng.range(0.2, 0.8)) * H, r = S * (big ? rng.range(0.3, 0.4) : rng.range(0.14, 0.3));
        switch (big ? rng.int(0, 1) : rng.int(0, 4)) {
          case 0: shapes.push({ rings: [circlePts(cx, cy, r)], ink: nextInk() }); break;
          case 1: shapes.push({ rings: [circlePts(cx, cy, r), circlePts(cx, cy, r * rng.range(0.55, 0.8))], ink: nextInk() }); break;
          case 2: { const w = r * rng.range(1.2, 2.2), h = r * rng.range(0.6, 1.8); shapes.push({ rings: [[cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2]], ink: nextInk() }); break; }
          case 3: { const a = rng.range(0, TAU), p = []; for (let i = 0; i < 3; i++) p.push(cx + r * 1.2 * Math.cos(a + TAU * i / 3), cy + r * 1.2 * Math.sin(a + TAU * i / 3)); shapes.push({ rings: [p], ink: nextInk() }); break; }
          default: {
            // A block of slanted bars.
            const n = rng.int(4, 8), w = r * 2, bw = w / (2 * n), sl = r * rng.range(0.3, 0.9), si = nextInk();
            for (let i = 0; i < n; i++) { const x = cx - r + i * 2 * bw; shapes.push({ rings: [[x, cy - r, x + bw, cy - r, x + bw + sl, cy + r, x + sl, cy + r]], ink: si }); }
          }
        }
      }
      // The slice edges: random heights about H / slices.
      const edges = [0];
      while (edges[edges.length - 1] < H) edges.push(edges[edges.length - 1] + (H / P.slices) * rng.range(0.35, 1.8));
      edges[edges.length - 1] = H;
      for (let i = 0; i + 1 < edges.length; i++) {
        const y0 = edges[i], y1 = edges[i + 1] - (edges[i + 1] - edges[i]) * P.gap;
        const dx = rng.chance(P.chance) ? rng.gauss() * P.shift * S * 0.12 : 0;
        const echo = dx !== 0 && rng.chance(P.split) ? rng.sign() * S * rng.range(0.006, 0.018) : 0;
        const emit = (sh, ox, inkOver) => {
          const rr = [];
          for (const ring of sh.rings) {
            let c = clipHalf(ring, 0, -1, -y0); if (c.length < 6) continue;
            c = clipHalf(c, 0, 1, y1); if (c.length < 6) continue;
            for (let q = 0; q < c.length; q += 2) c[q] += ox;
            rr.push(c);
          }
          if (!rr.length) return;
          const ik = inkOver ?? sh.ink;
          if (rr.length === 1) ctx.out.poly(rr[0], true, { f: ik }); else ctx.out.multi(rr, { f: ik });
        };
        if (ctx.out.full()) return;
        if (echo) for (const sh of shapes) emit(sh, dx + echo, (sh.ink + 1) % P.inks);
        for (const sh of shapes) emit(sh, dx);
      }
    },
  },
];

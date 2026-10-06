// ============================================================================
//  PATTERN DESIGNER  ·  patterns/flow.js — the flow family
// ----------------------------------------------------------------------------
//  Patterns that follow a vector field or a scalar field. The fields come
//  from ctx.noise (curl of fbm noise, fbm levels) or from a few point
//  vortices. Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def, label] },
//      gen(P, ctx) }
//  gen writes to ctx.out (engine.js class Out) and reads randomness only
//  from ctx.rng and ctx.noise, so the result is fixed by the seed.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp, contours } from '../engine.js';

// A spatial hash of points, for the "too near a line" test.
function makeHash(W, H, cs) {
  const gw = Math.ceil(W / cs) + 1, gh = Math.ceil(H / cs) + 1, cells = new Map();
  return {
    add(x, y, id) {
      const k = clamp(Math.floor(y / cs), 0, gh - 1) * gw + clamp(Math.floor(x / cs), 0, gw - 1);
      let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(x, y, id);
    },
    // True when a point (of a line other than skip) is nearer than d.
    near(x, y, d, skip = -1) {
      const gi = Math.floor(x / cs), gj = Math.floor(y / cs), r = Math.ceil(d / cs), d2 = d * d;
      for (let j = gj - r; j <= gj + r; j++) {
        if (j < 0 || j >= gh) continue;
        for (let i = gi - r; i <= gi + r; i++) {
          if (i < 0 || i >= gw) continue;
          const a = cells.get(j * gw + i); if (!a) continue;
          for (let k = 0; k < a.length; k += 3) {
            if (a[k + 2] === skip) continue;
            const dx = a[k] - x, dy = a[k + 1] - y;
            if (dx * dx + dy * dy < d2) return true;
          }
        }
      }
      return false;
    },
  };
}
// A unit direction from the curl of the noise at board point (x, y).
function curlDir(ctx, x, y, sc, oct = 2) {
  const [u, v] = ctx.noise.curl(x * sc, y * sc, oct);
  const L = Math.hypot(u, v) || 1;
  return [u / L, v / L];
}
// Trace one line both ways from (x, y) with step h. dirFn gives a unit
// direction. stop(x, y, n) ends a side. Returns a flat point list.
function trace(x, y, h, maxN, dirFn, stop) {
  const side = sgn => {
    const pts = []; let px = x, py = y;
    for (let n = 0; n < maxN; n++) {
      const [a, b] = dirFn(px, py), mx = px + sgn * a * h / 2, my = py + sgn * b * h / 2;
      const [c, d] = dirFn(mx, my), nx = px + sgn * c * h, ny = py + sgn * d * h;
      if (stop(nx, ny, n)) break;
      pts.push(nx, ny); px = nx; py = ny;
    }
    return pts;
  };
  const f = side(1), b = side(-1), out = [];
  for (let i = b.length - 2; i >= 0; i -= 2) out.push(b[i], b[i + 1]);
  out.push(x, y);
  for (let i = 0; i < f.length; i++) out.push(f[i]);
  return out;
}
// Thin a point list to every k-th point (the ends kept), for sm curves.
function thin(p, k) {
  if (k <= 1) return p;
  const out = [], m = p.length / 2;
  for (let i = 0; i < m; i += k) out.push(p[2 * i], p[2 * i + 1]);
  if ((m - 1) % k) out.push(p[2 * m - 2], p[2 * m - 1]);
  return out;
}
// Evenly spaced streamlines (Jobard and Lefer). New seeds start at a
// distance sep beside the points of lines already drawn.
function evenLines(ctx, dirFn, sep, h, minLen, maxN, onLine) {
  const { W, H } = ctx, hash = makeHash(W, H, sep), pad = sep * 0.5;
  const out = (x, y) => x < -pad || y < -pad || x > W + pad || y > H + pad;
  const queue = [];
  let id = 0;
  const tryLine = (x, y) => {
    if (out(x, y) || hash.near(x, y, sep)) return;
    const lid = id++, own = [];
    const p = trace(x, y, h, maxN, dirFn, (nx, ny, n) => {
      if (out(nx, ny)) return true;
      if (hash.near(nx, ny, sep * 0.5, lid)) return true;
      own.push(nx, ny); return false;
    });
    if (p.length / 2 < minLen) return;
    for (let i = 0; i < p.length; i += 2) hash.add(p[i], p[i + 1], lid);
    queue.push(p);
    onLine(p, lid);
  };
  // First seeds on a coarse jittered grid, in a random order.
  const seeds = [], g = sep * 6;
  for (let y = g / 2; y < H; y += g) for (let x = g / 2; x < W; x += g) seeds.push([x + ctx.rng.range(-g, g) * 0.3, y + ctx.rng.range(-g, g) * 0.3]);
  ctx.rng.shuffle(seeds);
  tryLine(seeds[0][0], seeds[0][1]);
  let si = 1;
  while (!ctx.out.full()) {
    if (queue.length) {
      const p = queue.shift();
      for (let i = 2; i < p.length - 2; i += 4) {
        const dx = p[i + 2] - p[i - 2], dy = p[i + 3] - p[i - 1], L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * sep, ny = dx / L * sep;
        tryLine(p[i] + nx, p[i + 1] + ny); tryLine(p[i] - nx, p[i + 1] - ny);
      }
    } else if (si < seeds.length) tryLine(seeds[si][0], seeds[si++][1]);
    else break;
  }
}

export default [
  {
    id: 'curl-streams', name: 'Curl Streams', family: 'flow', heavy: true,
    blurb: 'Evenly spaced lines follow a curl noise flow. A new line starts beside an old one and stops before it comes too near.',
    params: { sep: [6, 60, 1, 16, 'Line spacing'], scale: [0.3, 4, 0.05, 1.2, 'Field scale'], weight: [0.3, 6, 0.1, 1.6, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'], minLen: [2, 60, 1, 10, 'Shortest line'] },
    gen(P, ctx) {
      const sc = 0.0016 / P.scale, h = P.sep * 0.45;
      evenLines(ctx, (x, y) => curlDir(ctx, x, y, sc), P.sep, h, P.minLen, 1200, p => {
        const m = p.length / 2, x = p[(m >> 1) * 2], y = p[(m >> 1) * 2 + 1];
        const ink = P.inks === 1 ? 0 : clamp(Math.floor((0.5 + 0.6 * ctx.noise.fbm(x * 0.0012 + 40, y * 0.0012, 2)) * P.inks), 0, P.inks - 1);
        ctx.out.poly(thin(p, 2), false, { s: ink, w: P.weight, sm: 1 });
      });
    },
  },
  {
    id: 'flow-ribbons', name: 'Flow Ribbons', family: 'flow',
    blurb: 'Filled ribbons drift with the flow. Each ribbon is widest in its middle and tapers to a point at both ends.',
    params: { count: [10, 600, 1, 240, 'Ribbons'], length: [20, 600, 1, 300, 'Length'], width: [2, 60, 0.5, 16, 'Width'], scale: [0.3, 4, 0.05, 1, 'Field scale'], inks: [1, 5, 1, 4, 'Inks'], curl: [0, 1, 0.01, 0.6, 'Curl'] },
    gen(P, ctx) {
      const { W, H } = ctx, sc = 0.0014 / P.scale, h = 4;
      const dir = (x, y) => {
        const [u, v] = curlDir(ctx, x, y, sc), a = ctx.noise.fbm(x * sc * 0.5, y * sc * 0.5, 2) * Math.PI;
        const cu = Math.cos(a), cv = Math.sin(a), k = P.curl;
        const X = u * k + cu * (1 - k), Y = v * k + cv * (1 - k), L = Math.hypot(X, Y) || 1;
        return [X / L, Y / L];
      };
      for (let n = 0; n < P.count && !ctx.out.full(); n++) {
        const x0 = ctx.rng.range(-0.05, 1.05) * W, y0 = ctx.rng.range(-0.05, 1.05) * H, L = Math.round(P.length * ctx.rng.range(0.5, 1.3) / h);
        const p = trace(x0, y0, h, L >> 1, dir, () => false), m = p.length / 2;
        if (m < 4) continue;
        const wd = P.width * ctx.rng.range(0.5, 1.4), left = [], right = [];
        for (let i = 0; i < m; i++) {
          const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1), dx = p[2 * b] - p[2 * a], dy = p[2 * b + 1] - p[2 * a + 1], D = Math.hypot(dx, dy) || 1;
          const t = i / (m - 1), r = wd / 2 * Math.pow(Math.sin(Math.PI * t), 0.7);
          left.push(p[2 * i] - dy / D * r, p[2 * i + 1] + dx / D * r);
          right.push(p[2 * i] + dy / D * r, p[2 * i + 1] - dx / D * r);
        }
        const ring = left.slice();
        for (let i = m - 1; i >= 0; i--) ring.push(right[2 * i], right[2 * i + 1]);
        ctx.out.poly(thin(ring, 2), true, { f: ctx.rng.int(0, P.inks - 1), sm: 1 });
      }
    },
  },
  {
    id: 'contour-bands', name: 'Contour Bands', family: 'flow',
    blurb: 'A noise field cut into level bands, like a relief map. Each band fills the area above its level.',
    params: { levels: [3, 24, 1, 9, 'Levels'], scale: [0.3, 4, 0.05, 1.1, 'Field scale'], detail: [1, 5, 1, 3, 'Octaves'], inks: [2, 5, 1, 5, 'Inks'], lines: [0, 1, 1, 0, 'Outlines only'], weight: [0.3, 5, 0.1, 1.2, 'Line weight'] },
    gen(P, ctx) {
      const { W, H } = ctx, res = 6, gw = Math.ceil(W / res) + 3, gh = Math.ceil(H / res) + 3, f = new Float32Array(gw * gh), sc = 0.0013 / P.scale;
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const v = ctx.noise.fbm((i - 1) * res * sc, (j - 1) * res * sc, P.detail);
        f[j * gw + i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
      }
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (!i || !j || i === gw - 1 || j === gh - 1) f[j * gw + i] = lo - 1;
      const toBoard = r => r.map((v, k) => (v - 1) * res);
      // A base sheet in ink 0 under the bands.
      if (!P.lines) ctx.out.rect(0, 0, W, H, { f: 0 });
      for (let k = 1; k <= P.levels; k++) {
        const lev = lo + (hi - lo) * k / (P.levels + 1);
        const { rings } = contours(f, gw, gh, lev);
        const rr = rings.filter(r => r.length >= 8).map(toBoard);
        if (!rr.length) continue;
        if (P.lines) for (const r of rr) ctx.out.poly(r, true, { f: -1, s: k % P.inks, w: P.weight, sm: 1 });
        else ctx.out.multi(rr, { f: k % P.inks, sm: 1 });
        if (ctx.out.full()) break;
      }
    },
  },
  {
    id: 'vortex-lines', name: 'Vortex Lines', family: 'flow', heavy: true,
    blurb: 'Lines circle a few hidden vortices, some turning one way and some the other, with a slow drift across the board.',
    params: { vortices: [1, 8, 1, 4, 'Vortices'], sep: [6, 50, 1, 13, 'Line spacing'], drift: [0, 1, 0.01, 0.25, 'Drift'], weight: [0.3, 6, 0.1, 1.4, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S } = ctx, V = [], da = ctx.rng.range(0, TAU);
      for (let k = 0; k < P.vortices; k++) V.push([ctx.rng.range(0.15, 0.85) * W, ctx.rng.range(0.15, 0.85) * H, ctx.rng.sign() * ctx.rng.range(0.6, 1.4)]);
      const dir = (x, y) => {
        let u = P.drift * Math.cos(da) * 0.004, v = P.drift * Math.sin(da) * 0.004;
        for (const [vx, vy, g] of V) { const dx = x - vx, dy = y - vy, r2 = dx * dx + dy * dy + (S * 0.02) ** 2; u += -g * dy / r2; v += g * dx / r2; }
        const L = Math.hypot(u, v) || 1; return [u / L, v / L];
      };
      evenLines(ctx, dir, P.sep, P.sep * 0.4, 6, 2400, p => {
        const m = p.length / 2, x = p[(m >> 1) * 2], y = p[(m >> 1) * 2 + 1];
        let best = 0, bd = Infinity;
        V.forEach(([vx, vy], i) => { const d = Math.hypot(x - vx, y - vy); if (d < bd) { bd = d; best = i; } });
        ctx.out.poly(thin(p, 2), false, { s: P.inks === 1 ? 0 : best % P.inks, w: P.weight, sm: 1 });
      });
    },
  },
  {
    id: 'field-hairs', name: 'Field Hairs', family: 'flow',
    blurb: 'Short strokes on a loose grid, each one bent along the flow. Together they show the field like iron filings.',
    params: { cells: [20, 140, 1, 64, 'Cells'], length: [0.3, 3, 0.05, 1.3, 'Stroke length'], scale: [0.3, 4, 0.05, 1, 'Field scale'], jitter: [0, 1, 0.01, 0.7, 'Jitter'], weight: [0.3, 5, 0.1, 1.3, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S } = ctx, s = S / P.cells, sc = 0.0018 / P.scale, h = s * 0.25;
      const dir = (x, y) => curlDir(ctx, x, y, sc);
      for (let y = s / 2; y < H; y += s) for (let x = s / 2; x < W; x += s) {
        if (ctx.out.full()) return;
        const px = x + ctx.rng.range(-0.5, 0.5) * s * P.jitter, py = y + ctx.rng.range(-0.5, 0.5) * s * P.jitter;
        const n = Math.max(1, Math.round(P.length * s / h / 2 * (0.7 + 0.6 * (0.5 + 0.5 * ctx.noise.n2(px * 0.004, py * 0.004)))));
        const p = trace(px, py, h, n, dir, () => false);
        const ink = P.inks === 1 ? 0 : clamp(Math.floor((0.5 + 0.7 * ctx.noise.fbm(px * 0.0015 + 9, py * 0.0015, 2)) * P.inks), 0, P.inks - 1);
        ctx.out.poly(p, false, { s: ink, w: P.weight, sm: p.length > 6 ? 1 : 0 });
      }
    },
  },
  {
    id: 'drift-strata', name: 'Drift Strata', family: 'flow',
    blurb: 'Straight rows of points are carried a short way along the flow, so flat lines bend into folded strata.',
    params: { rows: [8, 120, 1, 46, 'Rows'], carry: [0, 400, 1, 70, 'Carry'], scale: [0.3, 4, 0.05, 1.2, 'Field scale'], weight: [0.3, 5, 0.1, 1.4, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'], vertical: [0, 1, 1, 0, 'Vertical'] },
    gen(P, ctx) {
      const { W, H } = ctx, sc = 0.0014 / P.scale, st = 6, steps = Math.round(P.carry / st);
      const along = P.vertical ? H : W, across = P.vertical ? W : H, gap = across / P.rows;
      for (let r = 0; r < P.rows && !ctx.out.full(); r++) {
        const c = (r + 0.5) * gap, pts = [];
        for (let a = -40; a <= along + 40; a += 8) {
          let x = P.vertical ? c : a, y = P.vertical ? a : c;
          for (let k = 0; k < steps; k++) { const [u, v] = ctx.noise.curl(x * sc, y * sc, 2); x += u * st * 0.5; y += v * st * 0.5; }
          pts.push(x, y);
        }
        ctx.out.poly(pts, false, { s: r % P.inks, w: P.weight, sm: 1 });
      }
    },
  },
];

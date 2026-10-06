// ============================================================================
//  PATTERN DESIGNER  ·  patterns/organic.js — the organic family
// ----------------------------------------------------------------------------
//  Patterns that grow: a curve that buckles as it gets longer, two
//  chemicals that react and spread, relaxed cells, branches that reach for
//  food, particles that stick, and soft blobs. Each entry is
//    { id, name, family, blurb, heavy?, params: { key: [min, max, step,
//      def, label] }, gen(P, ctx) }
//  gen writes to ctx.out (engine.js class Out) and reads randomness only
//  from ctx.rng and ctx.noise, so the result is fixed by the seed.
//  heavy: true marks a pattern that runs in worker.js. Each heavy pattern
//  has hard limits on its nodes and its steps.
//
//  grep -n "id: '" for the list of patterns in this file.
//  grep -n "function ringsAt" for scalar grid -> filled rings.
// ============================================================================
import { TAU, clamp, contours, poisson, chaikin, clipHalf, inset } from '../engine.js';

// Iso rings of a scalar grid in design units. field: gw * gh values at
// grid points i * cell, j * cell. A low border closes every ring at the
// board edge.
function ringsAt(field, gw, gh, cell, level) {
  const pw = gw + 2, ph = gh + 2, pad = new Float32Array(pw * ph).fill(-1e9);
  for (let j = 0; j < gh; j++) pad.set(field.subarray(j * gw, (j + 1) * gw), (j + 1) * pw + 1);
  const { rings } = contours(pad, pw, ph, level);
  return rings.filter(r => r.length >= 8).map(r => r.map(v => (v - 1) * cell));
}
// The area centroid of a ring.
function areaCentroid(p) {
  let a = 0, x = 0, y = 0; const m = p.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, c = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    a += c; x += (p[2 * i] + p[2 * j]) * c; y += (p[2 * i + 1] + p[2 * j + 1]) * c;
  }
  if (Math.abs(a) < 1e-9) return [p[0], p[1]];
  return [x / (3 * a), y / (3 * a)];
}

// Dart throwing with a radius field: a point is kept when it is at least
// the mean of the two radii from every kept point. Unlike poisson() it
// does not stop early where the radius jumps. At most 40000 throws.
function darts(W, H, rFn, rMin, rMax, rng, max) {
  const cs = Math.max(1, rMin / Math.SQRT2), gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), reach = Math.ceil(rMax / cs) + 1;
  const bins = Array.from({ length: gw * gh }, () => []), P = [], R = [];
  for (let t = 0; t < 40000 && R.length < max; t++) {
    const x = rng.next() * W, y = rng.next() * H, r = rFn(x, y), gi = Math.floor(x / cs), gj = Math.floor(y / cs);
    let ok = true;
    for (let v = Math.max(0, gj - reach); v <= Math.min(gh - 1, gj + reach) && ok; v++)
      for (let u = Math.max(0, gi - reach); u <= Math.min(gw - 1, gi + reach) && ok; u++)
        for (const k of bins[v * gw + u]) { const q = (r + R[k]) / 2; if ((P[2 * k] - x) ** 2 + (P[2 * k + 1] - y) ** 2 < q * q) { ok = false; break; } }
    if (ok) { bins[gj * gw + gi].push(R.length); P.push(x, y); R.push(r); }
  }
  return P;
}

export default [
  {
    id: 'growth-rings', name: 'Growth Rings', family: 'organic', heavy: true,
    blurb: 'A closed curve pushes on itself and adds points as it stretches, so it folds like a gut or a coral. Earlier states stay as rings inside.',
    params: { iters: [40, 600, 10, 440, 'Growth steps'], rings: [1, 8, 1, 1, 'Rings'], detail: [0.005, 0.02, 0.0005, 0.013, 'Edge length'], nodes: [400, 2500, 50, 2200, 'Point limit'], bias: [0, 1, 0.01, 0.5, 'Uneven growth'], fill: [0, 1, 1, 1, 'Solid rings'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng, noise } = ctx, L = S * P.detail, R = L * 2.4, m = S * 0.06;
      let xs = [], ys = [];
      const r0 = S * 0.07, n0 = Math.max(16, Math.round(TAU * r0 / L));
      for (let k = 0; k < n0; k++) { const a = TAU * k / n0, q = r0 * (1 + 0.08 * noise.n2(Math.cos(a) * 2, Math.sin(a) * 2)); xs.push(W / 2 + q * Math.cos(a)); ys.push(H / 2 + q * Math.sin(a)); }
      // A ring is kept each time the point count passes the next mark; the
      // growth stops 40 steps after the point limit, so the last ring relaxes.
      const snaps = [], marks = [];
      for (let k = 1; k < P.rings; k++) marks.push(n0 + (P.nodes - n0) * k / P.rings);
      let mk = 0, settle = -1;
      const gw = Math.ceil(W / R) + 1, gh = Math.ceil(H / R) + 1, head = new Int32Array(gw * gh);
      const snap = () => { const p = []; for (let i = 0; i < xs.length; i++) p.push(xs[i], ys[i]); snaps.push(p); };
      for (let it = 0; it < P.iters; it++) {
        const n = xs.length, nxt = new Int32Array(n), fx = new Float64Array(n), fy = new Float64Array(n);
        head.fill(-1);
        for (let i = 0; i < n; i++) { const c = clamp(Math.floor(ys[i] / R), 0, gh - 1) * gw + clamp(Math.floor(xs[i] / R), 0, gw - 1); nxt[i] = head[c]; head[c] = i; }
        for (let i = 0; i < n; i++) {
          const a = (i + n - 1) % n, b = (i + 1) % n;
          let ax = ((xs[a] + xs[b]) / 2 - xs[i]) * 0.6, ay = ((ys[a] + ys[b]) / 2 - ys[i]) * 0.6, rx = 0, ry = 0;
          for (const q of [a, b]) { const dx = xs[q] - xs[i], dy = ys[q] - ys[i], d = Math.hypot(dx, dy) || 1, k = (d - L) / d * 0.5; ax += dx * k; ay += dy * k; }
          const ci = clamp(Math.floor(xs[i] / R), 0, gw - 1), cj = clamp(Math.floor(ys[i] / R), 0, gh - 1);
          for (let v = Math.max(0, cj - 1); v <= Math.min(gh - 1, cj + 1); v++) for (let u = Math.max(0, ci - 1); u <= Math.min(gw - 1, ci + 1); u++) {
            for (let j = head[v * gw + u]; j >= 0; j = nxt[j]) {
              if (j === i || j === a || j === b) continue;
              const dx = xs[i] - xs[j], dy = ys[i] - ys[j], d2 = dx * dx + dy * dy;
              if (d2 < R * R && d2 > 1e-9) { const d = Math.sqrt(d2), w = (R - d) / R; rx += dx / d * w; ry += dy / d * w; }
            }
          }
          fx[i] = ax * 0.5 + rx * L * 0.6; fy[i] = ay * 0.5 + ry * L * 0.6;
        }
        for (let i = 0; i < n; i++) {
          let dx = fx[i], dy = fy[i]; const d = Math.hypot(dx, dy), mx = L * 0.45;
          if (d > mx) { dx *= mx / d; dy *= mx / d; }
          xs[i] = clamp(xs[i] + dx, m, W - m); ys[i] = clamp(ys[i] + dy, m, H - m);
        }
        // Split each long edge, and some short ones where the field allows.
        if (n < P.nodes) {
          const X = [], Y = [];
          for (let i = 0; i < n; i++) {
            X.push(xs[i]); Y.push(ys[i]);
            const j = (i + 1) % n, d = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
            const f = 0.5 + 0.5 * noise.fbm(xs[i] * 0.004, ys[i] * 0.004, 2);
            const grow = d > L * 1.6 || rng.chance(0.02 * (1 - P.bias + 2 * P.bias * f * f));
            if (grow && X.length + (n - i) < P.nodes) { X.push((xs[i] + xs[j]) / 2 + rng.range(-0.05, 0.05) * L); Y.push((ys[i] + ys[j]) / 2 + rng.range(-0.05, 0.05) * L); }
          }
          xs = X; ys = Y;
        }
        while (mk < marks.length && xs.length >= marks[mk]) { snap(); mk++; }
        if (settle < 0 && xs.length >= P.nodes - 2) settle = 40;
        if (settle >= 0 && settle-- === 0) break;
      }
      snap();
      for (let k = snaps.length - 1; k >= 0 && !ctx.out.full(); k--) {
        const ink = (snaps.length - 1 - k) % P.inks;
        if (P.fill) ctx.out.poly(snaps[k], true, { f: ink, s: -1, sm: 1 });
        else ctx.out.poly(snaps[k], true, { f: -1, s: ink, w: k === snaps.length - 1 ? 1.4 : 1, sm: 1 });
      }
    },
  },
  {
    id: 'morphogen', name: 'Morphogen', family: 'organic', heavy: true,
    blurb: 'Two chemicals feed, react and spread on a grid until spots, mazes or worms settle. The level lines of the result become solid shapes.',
    params: { kind: [0, 3, 1, 0, 'Kind (maze, spots, coral, worms)'], res: [80, 200, 5, 130, 'Grid'], iters: [400, 4000, 50, 2400, 'Steps'], seeds: [1, 60, 1, 22, 'Seeds'], drift: [0, 1, 0.01, 0.35, 'Feed drift'], bands: [1, 3, 1, 2, 'Bands'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng, noise } = ctx;
      const FK = [[0.029, 0.057], [0.0367, 0.0649], [0.0545, 0.062], [0.039, 0.058]][P.kind];
      const cell = S / P.res, gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1, N = gw * gh;
      let u = new Float32Array(N).fill(1), v = new Float32Array(N), u2 = new Float32Array(N), v2 = new Float32Array(N);
      const F = new Float32Array(N);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) F[j * gw + i] = FK[0] + P.drift * 0.005 * noise.fbm(i * cell * 0.003, j * cell * 0.003, 2);
      for (let s = 0; s < P.seeds; s++) {
        const ci = rng.int(0, gw - 1), cj = rng.int(0, gh - 1), r = rng.int(2, 4);
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
          if (di * di + dj * dj > r * r) continue;
          const k = ((cj + dj + gh) % gh) * gw + (ci + di + gw) % gw;
          u[k] = 0.5; v[k] = 0.25 + rng.range(-0.02, 0.02);
        }
      }
      const Du = 0.21, Dv = 0.105, K = FK[1];
      for (let it = 0; it < P.iters; it++) {
        for (let j = 0; j < gh; j++) {
          const r0 = j * gw, rt = ((j + gh - 1) % gh) * gw, rb = ((j + 1) % gh) * gw;
          for (let i = 0; i < gw; i++) {
            const il = i ? i - 1 : gw - 1, ir = i === gw - 1 ? 0 : i + 1, k = r0 + i;
            const U = u[k], V = v[k], uvv = U * V * V;
            const lu = u[r0 + il] + u[r0 + ir] + u[rt + i] + u[rb + i] - 4 * U;
            const lv = v[r0 + il] + v[r0 + ir] + v[rt + i] + v[rb + i] - 4 * V;
            u2[k] = U + Du * lu - uvv + F[k] * (1 - U);
            v2[k] = V + Dv * lv + uvv - (F[k] + K) * V;
          }
        }
        let t = u; u = u2; u2 = t; t = v; v = v2; v2 = t;
      }
      let mx = 0; for (let k = 0; k < N; k++) if (v[k] > mx) mx = v[k];
      if (mx < 0.05) return;
      for (let b = 0; b < P.bands && !ctx.out.full(); b++) {
        const lv = mx * (0.28 + 0.4 * b / Math.max(1, P.bands - 1 + 0.5));
        const rings = ringsAt(v, gw, gh, cell, lv);
        if (rings.length) ctx.out.multi(rings, { f: b % P.inks, sm: 1 });
      }
    },
  },
  {
    id: 'soft-cells', name: 'Soft Cells', family: 'organic', heavy: true,
    blurb: 'Seeds of uneven spacing split the board into cells. A few relax steps even them out, and each cell shrinks and rounds into a soft pebble.',
    params: { size: [0.02, 0.15, 0.002, 0.05, 'Cell size'], vary: [0, 0.8, 0.01, 0.55, 'Size change'], relax: [0, 10, 1, 2, 'Relax steps'], gap: [0, 0.4, 0.01, 0.12, 'Gap'], round: [0, 5, 1, 3, 'Rounding'], nuclei: [0, 1, 0.01, 0.3, 'Nuclei'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng, noise } = ctx, s = S * P.size;
      const rFn = (x, y) => s * (1 + P.vary * noise.fbm(x * 0.0025, y * 0.0025, 2));
      let pts = darts(W, H, rFn, s * (1 - P.vary), s * (1 + P.vary), rng, 1500);
      const n = pts.length / 2, box = [-1, -1, W + 1, -1, W + 1, H + 1, -1, H + 1];
      const cells = () => {
        const out = [], idx = [...Array(n).keys()];
        for (let i = 0; i < n; i++) {
          const px = pts[2 * i], py = pts[2 * i + 1];
          idx.sort((a, b) => ((pts[2 * a] - px) ** 2 + (pts[2 * a + 1] - py) ** 2) - ((pts[2 * b] - px) ** 2 + (pts[2 * b + 1] - py) ** 2));
          let poly = box;
          for (let q = 1; q < n && poly.length >= 6; q++) {
            const j = idx[q], qx = pts[2 * j], qy = pts[2 * j + 1], d = Math.hypot(qx - px, qy - py);
            let far = 0; for (let k = 0; k < poly.length; k += 2) far = Math.max(far, Math.hypot(poly[k] - px, poly[k + 1] - py));
            if (d > 2 * far) break;
            poly = clipHalf(poly, qx - px, qy - py, (qx * qx + qy * qy - px * px - py * py) / 2);
          }
          out.push(poly);
        }
        return out;
      };
      let cs = cells();
      for (let it = 0; it < P.relax; it++) {
        const np = [];
        for (let i = 0; i < n; i++) { const c = cs[i].length >= 6 ? areaCentroid(cs[i]) : [pts[2 * i], pts[2 * i + 1]]; np.push(clamp(c[0], 0, W), clamp(c[1], 0, H)); }
        pts = np; cs = cells();
      }
      for (let i = 0; i < n && !ctx.out.full(); i++) {
        const c = cs[i]; if (c.length < 6) continue;
        let r = 0; for (let k = 0; k < c.length; k += 2) r += Math.hypot(c[k] - pts[2 * i], c[k + 1] - pts[2 * i + 1]);
        r /= c.length / 2;
        const shell = chaikin(inset(c, r * P.gap), P.round, true);
        const f = 0.5 + 0.5 * noise.fbm(pts[2 * i] * 0.002 + 5, pts[2 * i + 1] * 0.002, 2);
        const ink = clamp(Math.floor(f * P.inks + rng.range(-0.3, 0.3)), 0, P.inks - 1);
        if (!ctx.out.poly(shell, true, { f: ink })) continue;
        if (P.inks > 1 && rng.chance(P.nuclei)) ctx.out.poly(chaikin(inset(c, r * (0.45 + 0.5 * P.gap)), P.round, true), true, { f: (ink + 1) % P.inks });
      }
    },
  },
  {
    id: 'coral-reach', name: 'Coral Reach', family: 'organic', heavy: true,
    blurb: 'Branches grow from the base toward scattered food points and eat them on contact. Each branch is as thick as the tips it carries.',
    params: { roots: [1, 6, 1, 3, 'Roots'], food: [0.012, 0.05, 0.001, 0.022, 'Food spacing'], step: [0.004, 0.016, 0.0005, 0.008, 'Step'], reach: [4, 20, 0.5, 9, 'Reach'], weight: [0.2, 4, 0.05, 1.1, 'Trunk weight'], buds: [0, 1, 1, 1, 'Buds'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng, noise } = ctx, D = S * P.step, infl = D * P.reach, kill = D * 1.8;
      const ex = W * 0.47, ey = H * 0.4, ecx = W / 2, ecy = H * 0.44;
      const food = poisson(W, H, () => S * P.food, S * P.food, rng.next, 4000);
      const ax = [], ay = [];
      for (let k = 0; k < food.length; k += 2) {
        const x = food[k], y = food[k + 1], a = Math.atan2(y - ecy, x - ecx);
        const e = Math.hypot((x - ecx) / ex, (y - ecy) / ey) / (1 + 0.22 * noise.n2(Math.cos(a) * 1.6, Math.sin(a) * 1.6));
        if (e < 1 && noise.fbm(x * 0.004, y * 0.004, 2) > -0.35) { ax.push(x); ay.push(y); }
      }
      const nx = [], ny = [], par = [], CAP = 6000;
      const gw = Math.ceil(W / infl) + 1, gh = Math.ceil(H / infl) + 1, bins = Array.from({ length: gw * gh }, () => []);
      const binOf = (x, y) => clamp(Math.floor(y / infl), 0, gh - 1) * gw + clamp(Math.floor(x / infl), 0, gw - 1);
      const addNode = (x, y, p) => { nx.push(x); ny.push(y); par.push(p); bins[binOf(x, y)].push(nx.length - 1); return nx.length - 1; };
      const tips = [];
      for (let k = 0; k < P.roots; k++) tips.push(addNode(W * (k + 0.5) / P.roots + rng.range(-0.15, 0.15) * W / P.roots, H * 0.985, -1));
      // Each trunk climbs on its own until food is in reach.
      for (let k = 0; k < tips.length; k++) {
        let t = tips[k];
        for (let st = 0; st < 400 && ny[t] > 0; st++) {
          let near = false;
          for (let a = 0; a < ax.length && !near; a++) near = (ax[a] - nx[t]) ** 2 + (ay[a] - ny[t]) ** 2 < infl * infl;
          if (near) break;
          t = addNode(nx[t] + rng.range(-0.25, 0.25) * D, ny[t] - D, t);
        }
      }
      const alive = new Uint8Array(ax.length).fill(1);
      let left = ax.length;
      for (let it = 0; it < 900 && nx.length < CAP && left > 0; it++) {
        const n = nx.length, dx = new Float64Array(n), dy = new Float64Array(n), cnt = new Int32Array(n);
        let hit = false;
        for (let a = 0; a < ax.length; a++) {
          if (!alive[a]) continue;
          const ci = clamp(Math.floor(ax[a] / infl), 0, gw - 1), cj = clamp(Math.floor(ay[a] / infl), 0, gh - 1);
          let best = -1, bd = infl * infl;
          for (let v = Math.max(0, cj - 1); v <= Math.min(gh - 1, cj + 1); v++) for (let u = Math.max(0, ci - 1); u <= Math.min(gw - 1, ci + 1); u++)
            for (const i of bins[v * gw + u]) { const d2 = (nx[i] - ax[a]) ** 2 + (ny[i] - ay[a]) ** 2; if (d2 < bd) { bd = d2; best = i; } }
          if (best < 0) continue;
          hit = true;
          const d = Math.sqrt(bd);
          if (d < kill) { alive[a] = 0; left--; continue; }
          dx[best] += (ax[a] - nx[best]) / d; dy[best] += (ay[a] - ny[best]) / d; cnt[best]++;
        }
        if (!hit) break;
        let grew = false;
        for (let i = 0; i < n && nx.length < CAP; i++) {
          if (!cnt[i]) continue;
          let gx = dx[i] / cnt[i] + rng.range(-0.15, 0.15), gy = dy[i] / cnt[i] - 0.12 + rng.range(-0.15, 0.15);
          const L = Math.hypot(gx, gy) || 1, x = nx[i] + gx / L * D, y = ny[i] + gy / L * D;
          let near = false;
          for (const j of bins[binOf(x, y)]) if ((nx[j] - x) ** 2 + (ny[j] - y) ** 2 < D * D * 0.09) { near = true; break; }
          if (!near) { addNode(x, y, i); grew = true; }
        }
        if (!grew) break;
      }
      const n = nx.length, acc = new Float64Array(n), rad = new Float64Array(n), pw = 2.4;
      for (let i = n - 1; i >= 0; i--) { rad[i] = Math.pow(Math.max(1, acc[i]), 1 / pw); if (par[i] >= 0) acc[par[i]] += Math.pow(rad[i], pw); }
      const kids = new Int32Array(n); for (let i = 0; i < n; i++) if (par[i] >= 0) kids[par[i]]++;
      for (let i = 0; i < n && !ctx.out.full(); i++) {
        const p = par[i]; if (p < 0) continue;
        const ink = P.inks > 1 && rad[i] < 1.6 ? 1 : 0;
        ctx.out.line(nx[p], ny[p], nx[i], ny[i], { s: ink, w: P.weight * (0.7 + 0.9 * Math.pow(rad[i], 0.85)) });
      }
      if (P.buds) for (let i = 0; i < n && !ctx.out.full(); i++) if (!kids[i] && par[i] >= 0) ctx.out.circle(nx[i], ny[i], D * 0.55, { f: P.inks > 2 ? 2 : P.inks - 1 });
    },
  },
  {
    id: 'frost-bloom', name: 'Frost Bloom', family: 'organic', heavy: true,
    blurb: 'Particles wander at random until they touch the cluster and stick. The cluster grows into thin fern-like arms, coloured by the order of arrival.',
    params: { count: [400, 6000, 50, 2600, 'Particles'], seed: [0, 1, 1, 0, 'Start (centre, base)'], weight: [0.3, 4, 0.05, 1.5, 'Line weight'], dots: [0, 1, 1, 0, 'Dots'], spread: [0.6, 1.4, 0.01, 1, 'Size'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, base = P.seed === 1;
      const r = (base ? 0.4 : 0.3) * S * P.spread / Math.pow(P.count, base ? 0.62 : 0.585), cs = 4 * r;
      const gw = Math.ceil(W / cs) + 2, gh = Math.ceil(H / cs) + 2, bins = new Map();
      const px = [], py = [], par = [];
      const put = (x, y, p) => { px.push(x); py.push(y); par.push(p); const k = (Math.floor(y / cs) + 1) * gw + Math.floor(x / cs) + 1; if (!bins.has(k)) bins.set(k, []); bins.get(k).push(px.length - 1); };
      const cx = W / 2, cy = H / 2;
      let Rc = 0, top = H;
      if (base) { for (let x = r; x < W; x += 2 * r) put(x, H - r, -1); top = H - r; } else put(cx, cy, -1);
      const nSeed = px.length;
      const far = (x, y) => base ? top - y : Math.hypot(x - cx, y - cy) - Rc;
      const launch = () => {
        if (base) return [rng.range(0, W), top - 6 * r];
        const a = rng.range(0, TAU), q = Rc + 6 * r; return [cx + q * Math.cos(a), cy + q * Math.sin(a)];
      };
      let budget = 5e6;
      while (px.length - nSeed < P.count && budget > 0) {
        let [x, y] = launch();
        for (let st = 0; st < 6000 && budget > 0; st++, budget--) {
          const fd = far(x, y);
          if (fd > (base ? 40 * r : Rc + 40 * r)) { [x, y] = launch(); continue; }
          let step;
          if (fd > 6 * r) step = fd - 3 * r;
          else {
            const gi = Math.floor(x / cs) + 1, gj = Math.floor(y / cs) + 1;
            let best = -1, bd = Infinity;
            for (let v = gj - 1; v <= gj + 1; v++) for (let u = gi - 1; u <= gi + 1; u++) {
              const b = bins.get(v * gw + u); if (!b) continue;
              for (const i of b) { const d2 = (px[i] - x) ** 2 + (py[i] - y) ** 2; if (d2 < bd) { bd = d2; best = i; } }
            }
            const d = Math.sqrt(bd), gap = best < 0 ? 2 * r : d - 2 * r;
            if (best >= 0 && gap < 0.3 * r) {
              const sx = px[best] + (x - px[best]) / d * 2 * r, sy = py[best] + (y - py[best]) / d * 2 * r;
              put(sx, sy, best);
              if (base) top = Math.min(top, sy); else Rc = Math.max(Rc, Math.hypot(sx - cx, sy - cy));
              break;
            }
            step = Math.max(gap, 0.3 * r);
          }
          const a = rng.range(0, TAU);
          x += step * Math.cos(a); y += step * Math.sin(a);
          if (base) { if (x < 0) x = -x; if (x > W) x = 2 * W - x; if (y > H - r) y = H - r; }
        }
        if (base ? top < H * 0.06 : Rc > 0.47 * Math.min(W, H)) break;
      }
      const n = px.length, grown = n - nSeed;
      for (let i = nSeed; i < n && !ctx.out.full(); i++) {
        const ink = Math.min(P.inks - 1, Math.floor((i - nSeed) / grown * P.inks));
        if (P.dots) ctx.out.circle(px[i], py[i], r * 0.85, { f: ink });
        else ctx.out.line(px[par[i]], py[par[i]], px[i], py[i], { s: ink, w: P.weight });
      }
    },
  },
  {
    id: 'lava-blobs', name: 'Lava Blobs', family: 'organic',
    blurb: 'Soft fields around scattered centres add up, and their level lines merge into blobs. Each level is one solid band, like a contour map of wax.',
    params: { blobs: [2, 30, 1, 9, 'Blobs'], size: [0.04, 0.3, 0.005, 0.13, 'Blob size'], levels: [1, 8, 1, 5, 'Levels'], step: [1.15, 2.5, 0.01, 1.5, 'Level step'], wobble: [0, 1, 0.01, 0.25, 'Wobble'], res: [60, 220, 5, 150, 'Grid'], inks: [1, 5, 1, 4, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng, noise } = ctx, B = [];
      for (let k = 0; k < P.blobs; k++) B.push([rng.range(0.08, 0.92) * W, rng.range(0.08, 0.92) * H, (S * P.size * rng.range(0.55, 1.35)) ** 2]);
      const cell = S / P.res, gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1, f = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const x = i * cell, y = j * cell;
        let s = 0; for (const [bx, by, r2] of B) s += r2 / ((x - bx) ** 2 + (y - by) ** 2 + r2 * 0.02);
        f[j * gw + i] = s * (1 + P.wobble * 0.35 * noise.fbm(x * 0.004, y * 0.004, 3));
      }
      for (let k = 0; k < P.levels && !ctx.out.full(); k++) {
        const rings = ringsAt(f, gw, gh, cell, 0.8 * Math.pow(P.step, k));
        if (rings.length) ctx.out.multi(rings, { f: k % P.inks, sm: 1 });
      }
    },
  },
];

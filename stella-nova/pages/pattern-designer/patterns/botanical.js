// ============================================================================
//  PATTERN DESIGNER  ·  patterns/botanical.js — the botanical family
// ----------------------------------------------------------------------------
//  Plant forms from growth rules: leaves set at a divergence angle,
//  branching plants from bracketed rewrite rules (L-systems), the veins
//  of a leaf grown toward hormone sources (space colonisation), and
//  fern fronds made of fronds. The rules are textbook botany models.
//  Each entry is
//    { id, name, family, blurb, heavy?, params: { key: [min, max, step,
//      def, label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so each element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  VENATION. Sources sit inside the leaf. In each step, each source
//  pulls its nearest vein node (within the reach). A pulled node grows
//  one step toward the mean of its pulls. A source dies when a node
//  comes within the kill distance. A vein is as thick as the count of
//  tips past it, to the power 0.45 (a pipe model).
//
//  grep -n "id: '" for the list of patterns in this file.
//  grep -n "const RULES" for the L-system rules.
// ============================================================================
import { TAU, clamp } from '../engine.js';
import { board } from './kit.js';

// Bracketed L-systems: axiom, rules, turn angle (degrees), steps.
const RULES = [
  { ax: 'F', r: { F: 'F[+F]F[-F]F' }, a: 25.7, n: 4 },
  { ax: 'F', r: { F: 'F[+F]F[-F][F]' }, a: 20, n: 4 },
  { ax: 'F', r: { F: 'FF-[-F+F+F]+[+F-F-F]' }, a: 22.5, n: 3 },
  { ax: 'X', r: { X: 'F[+X]F[-X]+X', F: 'FF' }, a: 20, n: 5 },
  { ax: 'X', r: { X: 'F[+X][-X]FX', F: 'FF' }, a: 25.7, n: 5 },
  { ax: 'X', r: { X: 'F-[[X]+X]+F[+FX]-X', F: 'FF' }, a: 22.5, n: 4 },
];
// A pointed leaf (two arcs) from (x, y) along angle a, length L, width k L.
function leaf(x, y, a, L, k, n = 8) {
  const c = Math.cos(a), s = Math.sin(a), p = [];
  for (let i = 0; i <= n; i++) { const t = i / n, w = k * L * Math.sin(Math.PI * t) * 0.5; p.push(x + c * L * t - s * w, y + s * L * t + c * w); }
  for (let i = n - 1; i > 0; i--) { const t = i / n, w = k * L * Math.sin(Math.PI * t) * 0.5; p.push(x + c * L * t + s * w, y + s * L * t - c * w); }
  return p;
}

export default [
  {
    id: 'leaf-spiral', name: 'Leaf Spiral', family: 'botanical',
    blurb: 'Pointed leaves set one by one at a divergence angle, each larger than the last, as on a rosette plant. Near 137.5 degrees the spiral arms lock into place.',
    params: { count: [30, 900, 1, 320, 'Leaves'], angle: [130, 145, 0.01, 137.51, 'Divergence'], length: [0.5, 5, 0.01, 2.6, 'Leaf length'], width: [0.15, 0.9, 0.01, 0.42, 'Leaf width'], tilt: [-0.8, 0.8, 0.01, 0.12, 'Tilt'], vein: [0, 1, 1, 1, 'Midrib'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), R = Math.hypot(ctx.W, ctx.H) * 0.5, c = R / Math.sqrt(P.count), d = P.angle * Math.PI / 180, rot = ctx.rng.range(0, TAU);
      const arms = [8, 13, 21, 34][ctx.rng.int(0, 3)];
      // From the outside in, so the young leaves lie on top.
      for (let i = P.count - 1; i >= 0 && !B.full(); i--) {
        const r = c * Math.sqrt(i + 0.5), a = rot + i * d, L = c * P.length * (0.45 + 1.1 * Math.sqrt(i / P.count)), x = ctx.cx + r * Math.cos(a), y = ctx.cy + r * Math.sin(a);
        const ink = (i % arms) % P.inks, la = a + P.tilt, bx = x - Math.cos(la) * L * 0.35, by = y - Math.sin(la) * L * 0.35;
        B.poly(leaf(bx, by, la, L, P.width), true, { f: ink, s: -2, w: 0.5 });
        if (P.vein) B.line(bx, by, bx + Math.cos(la) * L * 0.8, by + Math.sin(la) * L * 0.8, { s: -2, w: 0.5 });
      }
    },
  },
  {
    id: 'bracket-plants', name: 'Bracket Plants', family: 'botanical',
    blurb: 'Plants from rewrite rules: each step replaces every branch by a small branched copy. Brackets save and restore the pen, so side shoots grow and end.',
    params: { plants: [1, 9, 1, 5, 'Plants'], steps: [1, 6, 1, 4, 'Steps'], bend: [0, 1, 0.01, 0.25, 'Wind bend'], jitter: [0, 1, 0.01, 0.3, 'Angle jitter'], leaves: [0, 1, 1, 1, 'Leaves'], weight: [0.3, 4, 0.05, 1.2, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, ground = ctx.H * 0.94, slot = ctx.W / P.plants;
      for (let k = 0; k < P.plants && !B.full(); k++) {
        const R = r.pick(RULES), steps = Math.min(R.n + 1, Math.max(1, P.steps - (R.ax === 'X' ? 0 : 1)));
        let s = R.ax;
        for (let i = 0; i < steps && s.length < 40000; i++) { let t = ''; for (const ch of s) t += R.r[ch] || ch; s = t; }
        // Turtle walk at unit step; scale to fit afterwards.
        const segs = [], st = []; let x = 0, y = 0, a = -Math.PI / 2, depth = 0, cur = [0, 0], minX = 0, maxX = 0, minY = 0;
        const turnA = R.a * Math.PI / 180, lean = (r.next() - 0.5) * P.bend * 0.08;
        const tips = [];
        for (const ch of s) {
          if (ch === 'F') { a += lean; x += Math.cos(a); y += Math.sin(a); cur.push(x, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); }
          else if (ch === '+') a += turnA * (1 + P.jitter * 0.5 * (r.next() - 0.5));
          else if (ch === '-') a -= turnA * (1 + P.jitter * 0.5 * (r.next() - 0.5));
          else if (ch === '[') { st.push([x, y, a, depth, cur]); depth++; segs.push([cur, depth - 1]); cur = [x, y]; }
          else if (ch === ']') { if (cur.length >= 4) tips.push([x, y, a]); segs.push([cur, depth]); [x, y, a, depth, cur] = st.pop(); cur = [x, y]; }
          if (segs.length > 6000) break;
        }
        segs.push([cur, depth]);
        const h = -minY || 1, wdt = Math.max(1, maxX - minX), sc = Math.min(ground * 0.88 / h, slot * 1.25 / wdt), ox = (k + 0.5) * slot - (minX + maxX) / 2 * sc;
        const ink = k % P.inks;
        for (const [p, dp] of segs) {
          if (p.length < 4) continue;
          B.poly(p.map((v, i) => i % 2 ? ground + v * sc : ox + v * sc), false, { s: ink, w: P.weight * Math.max(0.35, 1.6 - dp * 0.3) });
        }
        if (P.leaves && P.inks > 1) for (const [tx, ty, ta] of tips) B.poly(leaf(ox + tx * sc, ground + ty * sc, ta, Math.max(3, sc * 2.2), 0.45, 5), true, { f: (ink + 1) % P.inks });
      }
      B.line(0, ground, ctx.W, ground, { s: 0, w: P.weight * 1.5 });
    },
  },
  {
    id: 'leaf-venation', name: 'Leaf Venation', family: 'botanical', heavy: true,
    blurb: 'Veins that grow from the stalk toward hormone sources inside a leaf. Each source dies when a vein reaches it, and veins thicken with the tips they feed.',
    params: { across: [1, 3, 1, 2, 'Leaves across'], sources: [80, 900, 10, 520, 'Sources'], reach: [0.05, 0.4, 0.005, 0.11, 'Reach'], step: [0.008, 0.04, 0.001, 0.016, 'Step'], shape: [0.3, 0.9, 0.01, 0.55, 'Leaf width'], outline: [0, 1, 1, 1, 'Outline'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, cw = ctx.W / P.across, rows = Math.max(1, Math.round(ctx.H / (cw * 1.25))), ch = ctx.H / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < P.across; i++) {
        const L = Math.min(cw / P.shape, ch) * 0.86, Wd = L * P.shape, bx = (i + 0.5) * cw, by = (j + 0.5) * ch + L / 2, tilt = r.range(-0.15, 0.15);
        // Leaf outline: half width w(t) = Wd/2 sin(pi t^0.8) along t from base (0) to tip (1).
        const half = t => Wd / 2 * Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.8));
        const toXY = (t, u) => { const lx = u, ly = -t * L; return [bx + lx * Math.cos(tilt) - ly * Math.sin(tilt), by + lx * Math.sin(tilt) + ly * Math.cos(tilt)]; };
        const S = [];
        for (let q = 0; q < P.sources; q++) { const t = r.next(), u = (r.next() * 2 - 1) * half(t) * 0.94; S.push(toXY(t, u)); }
        const D = L * P.step, reach = L * P.reach, kill = D * 1.6, nx = [], ny = [], par = [];
        const add = (x, y, p) => { nx.push(x); ny.push(y); par.push(p); };
        add(...toXY(-0.06, 0), -1); add(...toXY(0, 0), 0);
        const alive = new Uint8Array(S.length).fill(1);
        for (let it = 0; it < 400 && nx.length < 2600; it++) {
          const n = nx.length, ax = new Float64Array(n), ay = new Float64Array(n), cnt = new Int32Array(n);
          let any = false;
          for (let q = 0; q < S.length; q++) {
            if (!alive[q]) continue;
            let best = -1, bd = reach * reach;
            for (let m = 0; m < n; m++) { const dx = S[q][0] - nx[m], dy = S[q][1] - ny[m], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = m; } }
            if (best < 0) continue;
            if (bd < kill * kill) { alive[q] = 0; continue; }
            const d = Math.sqrt(bd); ax[best] += (S[q][0] - nx[best]) / d; ay[best] += (S[q][1] - ny[best]) / d; cnt[best]++; any = true;
          }
          if (!any) break;
          for (let m = 0; m < n; m++) if (cnt[m]) { const l = Math.hypot(ax[m], ay[m]) || 1; add(nx[m] + D * ax[m] / l, ny[m] + D * ay[m] / l, m); }
        }
        // Pipe model: tips below each node.
        const tips = new Float64Array(nx.length), kids = nx.map(() => []);
        for (let m = nx.length - 1; m > 0; m--) { if (!tips[m]) tips[m] = 1; tips[par[m]] += tips[m]; kids[par[m]].push(m); }
        const inkV = 0, tmax = Math.pow(tips[0] || 1, 0.45);
        // Chains of single children become one polyline.
        const walk = m0 => {
          const stack = [m0];
          while (stack.length && !B.full()) {
            let m = stack.pop(); const p = [nx[par[m]], ny[par[m]]], w = 0.6 + 2.6 * Math.pow(tips[m], 0.45) / tmax;
            for (;;) { p.push(nx[m], ny[m]); if (kids[m].length !== 1) break; m = kids[m][0]; }
            B.poly(p, false, { s: inkV, w });
            for (const c of kids[m]) stack.push(c);
          }
        };
        for (const c of kids[0]) walk(c);
        if (P.outline) {
          const p = [];
          for (let q = 0; q <= 40; q++) p.push(...toXY(q / 40, half(q / 40)));
          for (let q = 39; q > 0; q--) p.push(...toXY(q / 40, -half(q / 40)));
          B.poly(p, true, { f: -1, s: (P.inks > 1 ? 1 : 0), w: 1.4 });
        }
      }
    },
  },
  {
    id: 'fern-fronds', name: 'Fern Fronds', family: 'botanical',
    blurb: 'A curved stem with side leaflets, each leaflet a smaller copy with its own side leaflets, and a curl at the tip. A few fronds rise from one crown.',
    params: { fronds: [1, 9, 1, 5, 'Fronds'], pairs: [6, 40, 1, 22, 'Leaflet pairs'], depth: [1, 3, 1, 2, 'Orders'], curl: [0, 1, 0.01, 0.35, 'Curl'], spread: [0.2, 1.4, 0.01, 0.8, 'Spread'], weight: [0.3, 4, 0.05, 1, 'Line weight'], inks: [1, 5, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng;
      // Element budget: lower the orders (then the pairs) until the fronds
      // fit in about 18000 lines.
      let depth = P.depth, pairs0 = P.pairs;
      const est = (d, p) => { const p1 = Math.max(3, Math.round(p * 0.5)); let e = 1; for (let o = d; o >= 1; o--) e = 1 + 2 * (o === 1 ? p : p1) * e; return e * P.fronds; };
      while (depth > 1 && est(depth, pairs0) > 18000) depth--;
      while (pairs0 > 6 && est(depth, pairs0) > 18000) pairs0--;
      // A frond from (x, y) along angle a, length L; order o; side s (bend sign).
      const frond = (x, y, a, L, o, bend, ink) => {
        if (B.full() || L < 2) return;
        const n = Math.max(6, Math.round(L / 4)), p = [x, y]; let px = x, py = y, pa = a;
        const pts = [];
        for (let i = 1; i <= n; i++) {
          const t = i / n; pa += bend * (0.6 + P.curl * 3 * t * t) / n;
          px += Math.cos(pa) * L / n; py += Math.sin(pa) * L / n; p.push(px, py); pts.push([px, py, pa, t]);
        }
        B.poly(p, false, { s: ink, w: P.weight * (o === 0 ? 1.6 : o === 1 ? 0.9 : 0.55) });
        if (o >= depth) return;
        const pairs = o === 0 ? pairs0 : Math.max(3, Math.round(pairs0 * 0.5));
        for (let k = 1; k <= pairs; k++) {
          const t = k / (pairs + 1), q = pts[Math.min(pts.length - 1, Math.floor(t * pts.length))], env = Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - t * 0.35);
          const sl = L * 0.36 * env * (o === 0 ? 1 : 0.8);
          for (const sd of [-1, 1]) frond(q[0], q[1], q[2] + sd * (0.9 + 0.25 * r.next()) * P.spread * (o === 0 ? 1 : 0.8), sl, o + 1, -sd * 0.4, ink);
        }
      };
      const cx = ctx.cx + r.range(-0.1, 0.1) * ctx.W, cy = ctx.H * 0.98, L = ctx.H * 0.8;
      for (let f = 0; f < P.fronds; f++) {
        const t = P.fronds === 1 ? 0.5 : f / (P.fronds - 1), a = -Math.PI / 2 + (t - 0.5) * 1.6 * P.spread + r.range(-0.08, 0.08);
        frond(cx, cy, a, L * (1 - Math.abs(t - 0.5) * 0.5) * r.range(0.85, 1), 0, (t < 0.5 ? -1 : 1) * 0.8, f % P.inks);
      }
    },
  },
];

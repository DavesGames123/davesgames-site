// ============================================================================
//  PATTERN DESIGNER  ·  patterns/textile.js — the textile family
// ----------------------------------------------------------------------------
//  Cloth patterns as vector shapes: a plaid from a random mirrored sett,
//  dye bands with bled edges, bound-and-dyed rings, a twill check, a
//  zigzag stripe with a flame swell, and diamonds with an overcheck. Each
//  is a general weave or dye method; no named cloth design is copied.
//  Each entry is
//    { id, name, family, blurb, params: { key: [min, max, step, def,
//      label] }, gen(P, ctx) }
//  gen draws through board(ctx) (kit.js), so each element is clipped to
//  the board, and reads randomness only from ctx.rng and ctx.noise.
//
//  WEAVE. A 2/2 twill shows the warp thread where (i + j) mod 4 < 2 and
//  the weft thread elsewhere. sett-plaid draws the weft as solid stripes
//  and the warp as a hatch of thin parallelograms on top, so the two
//  colours mix as they do in cloth.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, clamp } from '../engine.js';
import { board, inkAt, turn } from './kit.js';

export default [
  {
    id: 'sett-plaid', name: 'Sett Plaid', family: 'textile',
    blurb: 'A random stripe order, mirrored at each end, runs both ways. The cross stripes are a twill hatch, so the two colours mix where they cross.',
    params: { stripes: [3, 9, 1, 6, 'Stripes in the sett'], scale: [0.3, 3, 0.01, 1, 'Sett size'], pitch: [2, 16, 0.5, 5, 'Twill pitch'], twill: [0, 1, 1, 1, 'Twill hatch'], fine: [0, 1, 0.01, 0.35, 'Fine lines'], inks: [2, 5, 1, 4, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, half = [];
      let prev = -1;
      for (let i = 0; i < P.stripes; i++) {
        let ink = r.int(0, P.inks - 1); if (ink === prev) ink = (ink + 1) % P.inks; prev = ink;
        half.push([ink, r.chance(P.fine) ? 2 : r.pick([4, 6, 8, 12, 16, 24, 32])]);
      }
      const sett = half.concat(half.slice(1, -1).reverse()), T = sett.reduce((a, s) => a + s[1], 0), u = ctx.S * 0.5 * P.scale / T;
      // Stripe edges along one axis, from a seeded start, over length len.
      const bands = len => {
        const out = []; let pos = -r.next() * T * u, k = 0;
        while (pos < len) { const [ink, w] = sett[k % sett.length]; out.push([pos, pos + w * u, ink]); pos += w * u; k++; }
        return out;
      };
      for (const [y0, y1, ink] of bands(ctx.H)) B.rect(0, y0, ctx.W, y1 - y0, { f: ink });
      const p = P.pitch, d = p * Math.SQRT2, t = p * 0.5 * Math.SQRT2;
      for (const [x0, x1, ink] of bands(ctx.W)) {
        if (B.full()) break;
        const rings = [];
        if (P.twill) {
          // Lines y = x - c at 45 degrees, p apart, cut to the stripe x0..x1.
          for (let c = x0 - ctx.H - d; c < x1 + d; c += d) {
            const ya = clamp(x0 - c, 0, ctx.H), yb = clamp(x1 - c, 0, ctx.H);
            if (yb - ya < 0.5) continue;
            rings.push([c + ya, ya, c + yb, yb, c + yb + t, yb, c + ya + t, ya].map((v, i) => i % 2 ? v : clamp(v, x0, x1)));
          }
        } else for (let x = x0; x < x1; x += p) rings.push([x, 0, Math.min(x1, x + p * 0.5), 0, Math.min(x1, x + p * 0.5), ctx.H, x, ctx.H]);
        if (rings.length) B.multi(rings, { f: ink });
      }
    },
  },
  {
    id: 'bled-bands', name: 'Bled Bands', family: 'textile',
    blurb: 'Bands of diamond, ring and bow motifs dyed thread by thread. Each thread shifts a little, so every edge bleeds and steps like resist-dyed yarn.',
    params: { bands: [2, 10, 1, 5, 'Bands'], motif: [0.3, 2, 0.01, 1, 'Motif length'], blur: [0, 1, 0.01, 0.5, 'Bleed'], thread: [2, 12, 0.5, 4, 'Thread'], shape: [0, 2, 1, 1, 'Motif'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), bw = ctx.W / P.bands, L = bw * 2 * P.motif, th = P.thread, n = ctx.noise, r = ctx.rng;
      for (let b = 0; b < P.bands && !B.full(); b++) {
        const cx = (b + 0.5) * bw, ph = b % 2 ? 0.5 : 0, kind = (P.shape + (b % 2)) % 3, ink = b % P.inks, in2 = (b + 1) % P.inks;
        for (let y = 0; y < ctx.H; y += th) {
          const t = ((y / L + ph) % 1 + 1) % 1, tri = 1 - Math.abs(2 * t - 1), sh = P.blur * bw * 0.08 * n.n2(y * 0.012, b * 3.1);
          const spans = [];
          if (kind === 0) spans.push([tri * 0.46, ink]);
          else if (kind === 1) { spans.push([tri * 0.46, ink]); if (tri > 0.3) spans.push([(tri - 0.3) * 0.5, in2]); }
          else spans.push([(1 - tri) * 0.46 + 0.04, ink]);
          for (const [hw, k] of spans) {
            if (hw * bw < th * 0.3) continue;
            const j0 = P.blur * th * 2.2 * r.gauss(), j1 = P.blur * th * 2.2 * r.gauss();
            const x0 = cx + sh - hw * bw + j0, x1 = cx + sh + hw * bw + j1;
            if (x1 - x0 > 0.5) B.rect(x0, y, x1 - x0, th * 0.84, { f: k });
          }
        }
      }
    },
  },
  {
    id: 'bound-rings', name: 'Bound Rings', family: 'textile',
    blurb: 'Rings of paper on a dyed ground, as where cloth is bound with thread before it goes in the dye. The rings wobble and swell, and the binding leaves dots.',
    params: { grid: [1, 8, 1, 3, 'Ties across'], rings: [2, 14, 1, 7, 'Rings'], wobble: [0, 1, 0.01, 0.45, 'Wobble'], swell: [0, 1, 0.01, 0.5, 'Swell'], dots: [0, 1, 1, 1, 'Thread dots'], ground: [0, 1, 1, 1, 'Dyed ground'] },
    gen(P, ctx) {
      const B = board(ctx), r = ctx.rng, n = ctx.noise, cw = ctx.W / P.grid, ny = Math.ceil(ctx.H / cw) + 1, gap = cw / (2 * P.rings) * 0.98;
      const ringInk = P.ground ? -2 : 0;
      if (P.ground) B.rect(0, 0, ctx.W, ctx.H, { f: 0 });
      for (let j = 0; j < ny && !B.full(); j++) for (let i = -1; i <= P.grid; i++) {
        const cx = (i + 0.5 + (j % 2) * 0.5) * cw + r.gauss() * cw * 0.04, cy = (j + 0.5) * cw * 0.9 + r.gauss() * cw * 0.04, o = r.next() * 50;
        for (let k = 1; k <= P.rings; k++) {
          const R = k * gap, m = Math.max(40, Math.round(R / 3)), outer = [], inner = [];
          for (let q = 0; q < m; q++) {
            const a = TAU * q / m, ca = Math.cos(a), sa = Math.sin(a);
            const wob = 1 + P.wobble * 0.16 * n.n2(ca * 1.3 + o, sa * 1.3 + k * 0.7) + P.wobble * 0.03 * n.n2(ca * 6 + o, sa * 6);
            const w = gap * 0.42 * (1 - P.swell * 0.6 + P.swell * 0.9 * (0.5 + 0.5 * n.n2(ca * 2 + k, sa * 2 - o)));
            outer.push(cx + (R * wob + w / 2) * ca, cy + (R * wob + w / 2) * sa);
            inner.push(cx + Math.max(0, R * wob - w / 2) * ca, cy + Math.max(0, R * wob - w / 2) * sa);
          }
          B.multi([outer, inner], { f: ringInk });
          if (P.dots && k % 2 === 0) for (let d = 0; d < 3; d++) { const a = r.next() * TAU; B.circle(cx + R * Math.cos(a), cy + R * Math.sin(a), gap * 0.18, { f: 1 }); }
        }
      }
    },
  },
  {
    id: 'twill-check', name: 'Twill Check', family: 'textile',
    blurb: 'Blocks of dark and light threads woven in a 2/2 twill. Four threads a block give the broken check with its little teeth; other counts give other teeth.',
    params: { size: [2, 16, 1, 7, 'Checks across'], threads: [2, 6, 1, 4, 'Threads per block'], turn: [0, 45, 1, 0, 'Turn'], inks: [1, 3, 1, 1, 'Inks'], overcheck: [0, 1, 1, 0, 'Overcheck'], shift: [0, 3, 1, 0, 'Twill start'] },
    gen(P, ctx) {
      const B = board(ctx), t = P.threads, p = ctx.S / (P.size * 2 * t), rot = P.turn * Math.PI / 180, R = Math.hypot(ctx.W, ctx.H) / 2;
      const n = Math.ceil(R / p) + 2, o = ctx.rng.int(0, 2 * t - 1), oy = ctx.rng.int(0, 2 * t - 1);
      // Dark thread ink, or -1 for a light thread.
      const thread = (i, b) => { const blk = ((Math.floor((i + b) / t) % 2) + 2) % 2; return blk === 0 ? (P.inks === 1 ? 0 : ((Math.floor((i + b) / (2 * t)) % P.inks) + P.inks) % P.inks) : -1; };
      for (let j = -n; j < n && !B.full(); j++) {
        const rows = new Map();
        let run = null;
        const flush = () => { if (run && run.ink >= 0) { if (!rows.has(run.ink)) rows.set(run.ink, []); rows.get(run.ink).push(turn([run.x0 * p, j * p, run.x1 * p, j * p, run.x1 * p, (j + 1) * p, run.x0 * p, (j + 1) * p].map((v, q) => v + (q % 2 ? ctx.cy : ctx.cx)), ctx.cx, ctx.cy, rot)); } run = null; };
        for (let i = -n; i < n; i++) {
          const warp = (((i + j + P.shift) % 4) + 4) % 4 < 2, ink = warp ? thread(i, o) : thread(j, oy);
          if (run && run.ink === ink) run.x1 = i + 1; else { flush(); run = { ink, x0: i, x1: i + 1 }; }
        }
        flush();
        for (const [ink, rings] of rows) B.multi(rings, { f: ink });
      }
      if (P.overcheck) {
        const step = 4 * t * p, k = Math.max(0, P.inks - 1) + 1;
        for (let v = -Math.ceil(R / step) - 1; v <= Math.ceil(R / step) + 1; v++) {
          const a = v * step + 1.5 * t * p;
          B.poly(turn([ctx.cx + a, ctx.cy - R, ctx.cx + a, ctx.cy + R], ctx.cx, ctx.cy, rot), false, { s: k, w: 0.8 });
          B.poly(turn([ctx.cx - R, ctx.cy + a, ctx.cx + R, ctx.cy + a], ctx.cx, ctx.cy, rot), false, { s: k, w: 0.8 });
        }
      }
    },
  },
  {
    id: 'flame-chevron', name: 'Flame Chevron', family: 'textile',
    blurb: 'Zigzag stripes in a mirrored run of inks. A swell along the width makes some peaks tall and some short, as in a flame stitch.',
    params: { bands: [4, 60, 1, 18, 'Bands'], peaks: [1, 24, 1, 6, 'Peaks across'], depth: [0.1, 3, 0.01, 1.2, 'Peak depth'], flame: [0, 1, 0.01, 0.35, 'Flame'], soft: [0, 1, 1, 0, 'Soft'], inks: [2, 5, 1, 4, 'Inks'], mirror: [0, 1, 1, 1, 'Mirrored order'] },
    gen(P, ctx) {
      const B = board(ctx), bh = ctx.H / P.bands, per = ctx.W / P.peaks, A = P.depth * bh, ph = ctx.rng.next() * per, sd = ctx.rng.next() * 9;
      const xs = [], zs = [];
      for (let x = -per; x <= ctx.W + per; x += per / 2) {
        const k = Math.round((x - ph) / (per / 2)), up = (k & 1) === 0;
        const amp = A * (1 + P.flame * 1.3 * ctx.noise.n2(x / (per * 2.2), sd));
        xs.push(x + ph % (per / 2)); zs.push(up ? -amp / 2 : amp / 2);
      }
      const order = []; for (let i = 0; i < P.inks; i++) order.push(i);
      if (P.mirror) for (let i = P.inks - 2; i > 0; i--) order.push(i);
      const extra = Math.ceil(A * 1.8 / bh) + 1;
      for (let b = -extra; b < P.bands + extra && !B.full(); b++) {
        const top = [], bot = [];
        for (let i = 0; i < xs.length; i++) { top.push(xs[i], b * bh + zs[i]); bot.push(xs[i], (b + 1) * bh + zs[i]); }
        const ring = top.slice(); for (let i = bot.length - 2; i >= 0; i -= 2) ring.push(bot[i], bot[i + 1]);
        const ink = order[((b % order.length) + order.length) % order.length];
        if (P.soft) {
          // A smooth band: sample the Catmull-Rom of each edge, so the clip stays exact.
          const sm = q => { const o = []; for (let i = 0; i + 2 < q.length; i += 2) { const p0 = i ? [q[i - 2], q[i - 1]] : [q[i], q[i + 1]], p1 = [q[i], q[i + 1]], p2 = [q[i + 2], q[i + 3]], p3 = i + 4 < q.length ? [q[i + 4], q[i + 5]] : p2;
            for (let s = 0; s < 8; s++) { const t = s / 8, t2 = t * t, t3 = t2 * t; for (let c = 0; c < 2; c++) o.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)); } }
            o.push(q[q.length - 2], q[q.length - 1]); return o; };
          const T = sm(top), Bt = sm(bot), rr = T.slice(); for (let i = Bt.length - 2; i >= 0; i -= 2) rr.push(Bt[i], Bt[i + 1]);
          B.poly(rr, true, { f: ink });
        } else B.poly(ring, true, { f: ink });
      }
    },
  },
  {
    id: 'diamond-overcheck', name: 'Diamond Overcheck', family: 'textile',
    blurb: 'A lattice of diamonds in two inks on a ground, crossed by thin dashed lines that run along the diamond edges through each centre.',
    params: { across: [1, 10, 1, 4, 'Diamonds across'], tall: [1, 2.5, 0.01, 1.5, 'Tallness'], line: [0, 1, 1, 1, 'Overcheck lines'], dash: [0, 1, 1, 1, 'Dashed lines'], weight: [0.5, 6, 0.1, 1.6, 'Line weight'], ground: [0, 1, 1, 1, 'Ground ink'], inks: [2, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const B = board(ctx), dw = ctx.W / P.across, dh = dw * P.tall, sh = ctx.rng.next() * dw, deal = ctx.rng.shuffle([0, 1, 2, 3, 4].slice(0, P.inks));
      const A = deal[0], Bk = deal[1 % deal.length], G = P.inks > 2 ? deal[2] : -1, Lk = P.inks > 3 ? deal[3] : A;
      const rows = Math.ceil(ctx.H / (dh / 2)) + 2;
      for (let j = -1; j < rows && !B.full(); j++) for (let i = -1; i <= P.across + 1; i++) {
        const cx = i * dw + (j & 1 ? dw / 2 : 0) + sh - dw / 2, cy = j * dh / 2, d = [cx, cy - dh / 2, cx + dw / 2, cy, cx, cy + dh / 2, cx - dw / 2, cy];
        if (j & 1) { if (P.ground && G >= 0) B.poly(d, true, { f: G }); }
        else B.poly(d, true, { f: (i & 1) ? Bk : A });
      }
      if (!P.line) return;
      // Lines along the two edge directions through the diamond centres.
      const L = Math.hypot(ctx.W, ctx.H), ux = dw / 2, uy = dh / 2, ul = Math.hypot(ux, uy), dash = P.dash ? Math.max(4, ul * 0.16) : 0;
      for (const sgn of [1, -1]) for (let k = -2 * (P.across + rows); k <= 2 * (P.across + rows); k++) {
        const ox = sh - dw / 2 + k * dw, oy = 0, dx = ux / ul * sgn, dy = uy / ul;
        const x0 = ox - dx * L, y0 = oy - dy * L;
        if (!dash) { B.line(x0, y0, ox + dx * L, oy + dy * L, { s: Lk, w: P.weight }); continue; }
        for (let s = 0; s < 2 * L; s += dash * 2) B.line(x0 + dx * s, y0 + dy * s, x0 + dx * (s + dash), y0 + dy * (s + dash), { s: Lk, w: P.weight });
        if (B.full()) return;
      }
    },
  },
];

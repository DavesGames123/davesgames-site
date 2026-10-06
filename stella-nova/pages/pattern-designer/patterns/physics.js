// ============================================================================
//  PATTERN DESIGNER  ·  patterns/physics.js — the physics family
// ----------------------------------------------------------------------------
//  Each pattern runs a small simulation with a fixed time step and draws
//  its state or its paths. The step count and the body count are fixed by
//  the params, so the result is fixed by the seed. Entry format: see
//  grid.js. heavy: true sends the pattern to worker.js.
//
//  grep -n "id: '" for the list of patterns in this file.
// ============================================================================
import { TAU, contours } from '../engine.js';

export default [
  {
    id: 'circle-pack', name: 'Circle Pack', family: 'physics', heavy: true,
    blurb: 'Discs placed from the largest down to the smallest, each one in the open space that the others leave.',
    params: { max: [0.03, 0.3, 0.005, 0.14, 'Largest disc'], min: [0.002, 0.03, 0.001, 0.006, 'Smallest disc'], gap: [0, 0.02, 0.0005, 0.004, 'Gap'], tries: [200, 6000, 50, 1800, 'Tries per size'], nest: [0, 8, 1, 3, 'Inner rings'], inks: [1, 5, 1, 3, 'Inks'], outline: [0, 1, 1, 0, 'Outline only'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, gap = P.gap * S, rMax = P.max * S, rMin = Math.min(P.min * S, rMax * 0.9);
      const cs = Math.max(rMin * 4, 6), gw = Math.ceil(W / cs), gh = Math.ceil(H / cs);
      const cells = Array.from({ length: gw * gh }, () => []), C = [], stamp = new Int32Array(4096 * 8);
      let tick = 0;
      const fits = (x, y, r) => {
        tick++;
        const i0 = Math.max(0, Math.floor((x - r - gap) / cs)), i1 = Math.min(gw - 1, Math.floor((x + r + gap) / cs));
        const j0 = Math.max(0, Math.floor((y - r - gap) / cs)), j1 = Math.min(gh - 1, Math.floor((y + r + gap) / cs));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const k of cells[j * gw + i]) {
          if (k < stamp.length) { if (stamp[k] === tick) continue; stamp[k] = tick; }
          const c = C[k], d = r + c[2] + gap, dx = c[0] - x, dy = c[1] - y;
          if (dx * dx + dy * dy < d * d) return false;
        }
        return true;
      };
      const add = (x, y, r) => {
        const k = C.length; C.push([x, y, r]);
        for (let j = Math.max(0, Math.floor((y - r) / cs)); j <= Math.min(gh - 1, Math.floor((y + r) / cs)); j++)
          for (let i = Math.max(0, Math.floor((x - r) / cs)); i <= Math.min(gw - 1, Math.floor((x + r) / cs)); i++) cells[j * gw + i].push(k);
      };
      // Sizes fall by 12% per stage; small sizes get more tries.
      for (let r = rMax; r >= rMin && C.length < 6000; r *= 0.88) {
        const n = Math.round(P.tries * Math.min(8, rMax / r));
        for (let t = 0; t < n; t++) {
          const x = rng.range(-r * 0.5, W + r * 0.5), y = rng.range(-r * 0.5, H + r * 0.5);
          if (fits(x, y, r)) add(x, y, r);
        }
      }
      for (const [x, y, r] of C) {
        if (ctx.out.full()) return;
        const ink = rng.int(0, P.inks - 1);
        const rings = Math.min(P.nest, Math.floor(r / Math.max(2.5, S * 0.008)));
        if (P.outline) {
          for (let k = 0; k <= rings; k++) ctx.out.circle(x, y, r * (1 - k / (rings + 1)), { f: -1, s: ink, w: 0.8 });
        } else {
          ctx.out.circle(x, y, r, { f: ink });
          for (let k = 1; k <= rings; k++) ctx.out.circle(x, y, r * (1 - k / (rings + 1)), { f: k % 2 ? -1 : ink, s: k % 2 ? -2 : -1, w: Math.max(0.6, r * 0.6 / (rings + 1) / 2) });
        }
      }
    },
  },
  {
    id: 'tension-mesh', name: 'Tension Mesh', family: 'physics',
    blurb: 'A net of springs fixed at its border. A few knots are pulled and turned, and the rest of the net relaxes around them.',
    params: { cells: [10, 80, 1, 30, 'Mesh cells'], pins: [1, 12, 1, 5, 'Pulled knots'], pull: [0, 0.3, 0.005, 0.15, 'Pull distance'], turn: [0, 3, 0.01, 1.4, 'Knot turn'], gather: [0, 0.9, 0.01, 0.55, 'Gather'], iters: [20, 600, 10, 260, 'Relax steps'], weight: [0.3, 5, 0.1, 1.2, 'Line weight'], knots: [0, 1, 1, 1, 'Show knots'], inks: [1, 3, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, s = S / P.cells, nx = Math.round(W / s) + 1, ny = Math.round(H / s) + 1;
      const sx = W / (nx - 1), sy = H / (ny - 1), X = new Float64Array(nx * ny), Y = new Float64Array(nx * ny), fix = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; X[k] = i * sx; Y[k] = j * sy; if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) fix[k] = 1; }
      const pins = [];
      for (let p = 0; p < P.pins; p++) {
        const ci = rng.int(2, nx - 3), cj = rng.int(2, ny - 3), a = rng.range(0, TAU), d = P.pull * S * rng.range(0.4, 1), tw = P.turn * rng.sign() * rng.range(0.5, 1);
        const cx = X[cj * nx + ci], cy = Y[cj * nx + ci], ox = d * Math.cos(a), oy = d * Math.sin(a);
        // The knot and its ring of neighbours move as one turned block.
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const k = (cj + dj) * nx + ci + di, ux = X[k] - cx, uy = Y[k] - cy, c = Math.cos(tw), sn = Math.sin(tw);
          const g = 1 - P.gather; X[k] = cx + ox + g * (ux * c - uy * sn); Y[k] = cy + oy + g * (ux * sn + uy * c); fix[k] = 1;
        }
        pins.push([cx + ox, cy + oy]);
      }
      // Gauss-Seidel relaxation: each free knot moves to the mean of its four neighbours.
      for (let it = 0; it < P.iters; it++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i; if (fix[k]) continue;
        X[k] = (X[k - 1] + X[k + 1] + X[k - nx] + X[k + nx]) / 4;
        Y[k] = (Y[k - 1] + Y[k + 1] + Y[k - nx] + Y[k + nx]) / 4;
      }
      for (let j = 0; j < ny; j++) { const p = []; for (let i = 0; i < nx; i++) p.push(X[j * nx + i], Y[j * nx + i]); ctx.out.poly(p, false, { s: 0, w: P.weight, sm: 1 }); }
      for (let i = 0; i < nx; i++) { const p = []; for (let j = 0; j < ny; j++) p.push(X[j * nx + i], Y[j * nx + i]); ctx.out.poly(p, false, { s: P.inks > 1 ? 1 : 0, w: P.weight, sm: 1 }); }
      if (P.knots) for (const [x, y] of pins) { ctx.out.circle(x, y, s * 0.55, { f: P.inks > 2 ? 2 : 0 }); }
    },
  },
  {
    id: 'orbit-trails', name: 'Orbit Trails', family: 'physics', heavy: true,
    blurb: 'Light bodies thrown around two or three heavy ones. Each path is traced with a fixed time step until it leaves or ends.',
    params: { bodies: [1, 3, 1, 2, 'Heavy bodies'], count: [4, 160, 1, 24, 'Paths'], steps: [200, 6000, 50, 1500, 'Steps'], retro: [0, 0.5, 0.01, 0, 'Reverse share'], spread: [0, 1, 0.01, 0.18, 'Launch spread'], spin: [0.4, 1.4, 0.01, 0.92, 'Launch speed'], soft: [0.01, 0.12, 0.005, 0.04, 'Softening'], weight: [0.2, 4, 0.05, 0.9, 'Line weight'], inks: [1, 5, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, B = [];
      for (let b = 0; b < P.bodies; b++) {
        const a = TAU * b / P.bodies + rng.range(-0.4, 0.4), d = P.bodies === 1 ? 0 : S * rng.range(0.12, 0.2);
        B.push([W / 2 + d * Math.cos(a), H / 2 + d * Math.sin(a), rng.range(0.6, 1.2)]);
      }
      const GM = (S * 0.25) ** 3 * 0.25, eps2 = (P.soft * S) ** 2, dt = 0.016;
      const acc = (x, y) => { let ax = 0, ay = 0; for (const [bx, by, m] of B) { const dx = bx - x, dy = by - y, r2 = dx * dx + dy * dy + eps2, f = GM * m / (r2 * Math.sqrt(r2)); ax += dx * f; ay += dy * f; } return [ax, ay]; };
      const mtot = B.reduce((a, b) => a + b[2], 0);
      for (let n = 0; n < P.count; n++) {
        if (ctx.out.full()) return;
        const a = rng.range(0, TAU), r = S * 0.3 * (1 + rng.range(-1, 1) * P.spread);
        let x = W / 2 + r * Math.cos(a), y = H / 2 + r * Math.sin(a);
        const v0 = Math.sqrt(GM * mtot / r) * P.spin * (1 + rng.range(-0.15, 0.1) * P.spread), dir = rng.chance(P.retro) ? -1 : 1;
        let vx = -Math.sin(a) * v0 * dir, vy = Math.cos(a) * v0 * dir;
        let [ax, ay] = acc(x, y);
        const pts = [x, y], every = Math.max(1, Math.round(P.steps / 900));
        for (let t = 0; t < P.steps; t++) {
          vx += ax * dt / 2; vy += ay * dt / 2; x += vx * dt; y += vy * dt;
          [ax, ay] = acc(x, y); vx += ax * dt / 2; vy += ay * dt / 2;
          if (t % every === 0) pts.push(x, y);
          if (x < -S || y < -S || x > W + S || y > H + S) break;
        }
        ctx.out.poly(pts, false, { s: n % P.inks, w: P.weight, sm: 1 });
      }
      for (const [bx, by, m] of B) ctx.out.circle(bx, by, S * 0.012 * Math.sqrt(m), { f: 0 });
    },
  },
  {
    id: 'cyclotron', name: 'Cyclotron', family: 'physics',
    blurb: 'Charged tracks from a few vertices in a magnetic field. Drag takes their speed, so each one curls into a tight spiral.',
    params: { vertices: [1, 6, 1, 3, 'Vertices'], tracks: [2, 40, 1, 12, 'Tracks per vertex'], field: [0.5, 6, 0.05, 2.2, 'Field'], drag: [0.05, 1.5, 0.01, 0.35, 'Drag'], speed: [0.1, 1, 0.01, 0.5, 'Start speed'], weight: [0.2, 4, 0.05, 1.1, 'Line weight'], inks: [1, 4, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng, noise } = ctx, dt = 0.004;
      for (let v = 0; v < P.vertices; v++) {
        const vx0 = rng.range(0.2, 0.8) * W, vy0 = rng.range(0.2, 0.8) * H, aim = rng.range(0, TAU), fan = rng.range(0.6, TAU);
        for (let n = 0; n < P.tracks; n++) {
          if (ctx.out.full()) return;
          const q = rng.sign(), a = aim + rng.range(-fan / 2, fan / 2), sp = S * P.speed * Math.exp(rng.gauss() * 0.5) * 2.2;
          let x = vx0, y = vy0, ux = Math.cos(a) * sp, uy = Math.sin(a) * sp;
          const pts = [x, y], damp = Math.exp(-P.drag * dt * rng.range(0.6, 1.5));
          for (let t = 0; t < 6000; t++) {
            // The field changes a little across the board.
            const w = q * P.field * 2 * (1 + 0.35 * noise.n2(x * 0.002, y * 0.002)) * dt, c = Math.cos(w), s = Math.sin(w);
            const nx = ux * c - uy * s, ny = ux * s + uy * c;
            ux = nx * damp; uy = ny * damp; x += ux * dt; y += uy * dt;
            if (t % 3 === 0) pts.push(x, y);
            if (Math.hypot(ux, uy) < S * 0.004 || x < -S * 0.2 || y < -S * 0.2 || x > W + S * 0.2 || y > H + S * 0.2) break;
          }
          pts.push(x, y);
          ctx.out.poly(pts, false, { s: q > 0 ? 0 : (P.inks > 1 ? 1 : 0), w: P.weight * (P.inks > 2 && n % 5 === 0 ? 1.8 : 1), sm: 1 });
        }
        if (P.inks > 2) ctx.out.circle(vx0, vy0, S * 0.007, { f: 2 });
      }
    },
  },
  {
    id: 'harmonic-trace', name: 'Harmonic Trace', family: 'physics',
    blurb: 'Two damped pendulums per axis move one pen. Near-whole frequency ratios give slow knots that fade inward.',
    params: { ratio: [1, 6, 1, 3, 'Frequency ratio'], detune: [0, 0.05, 0.0005, 0.008, 'Detune'], decay: [0.0005, 0.02, 0.0005, 0.004, 'Damping'], length: [20, 400, 1, 160, 'Swings'], traces: [1, 4, 1, 1, 'Traces'], weight: [0.2, 3, 0.05, 0.6, 'Line weight'], inks: [1, 4, 1, 2, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, R = 0.42 * Math.min(W, H);
      for (let tr = 0; tr < P.traces; tr++) {
        if (ctx.out.full()) return;
        const f1 = 1 + P.detune * rng.range(-1, 1), f2 = P.ratio / rng.pick([1, 2, 1]) + P.detune * rng.range(-1, 1);
        const f3 = f2 + P.detune * rng.range(-1, 1), f4 = 1 + P.detune * rng.range(-1, 1);
        const p = [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)];
        const A = [rng.range(0.5, 1), rng.range(0.2, 0.6), rng.range(0.5, 1), rng.range(0.2, 0.6)];
        const sx = R / (A[0] + A[1]), sy = R / (A[2] + A[3]), d = P.decay * rng.range(0.7, 1.3);
        const T = P.length * TAU, n = Math.min(60000, Math.round(P.length * 140)), pts = [];
        for (let i = 0; i <= n; i++) {
          const t = T * i / n, e = Math.exp(-d * t);
          pts.push(W / 2 + sx * e * (A[0] * Math.sin(f1 * t + p[0]) + A[1] * Math.sin(f2 * t + p[1])),
            H / 2 + sy * e * (A[2] * Math.sin(f3 * t + p[2]) + A[3] * Math.sin(f4 * t + p[3])));
        }
        ctx.out.poly(pts, false, { s: tr % P.inks, w: P.weight });
      }
    },
  },
  {
    id: 'charge-field', name: 'Charge Field', family: 'physics',
    blurb: 'Field lines of a few point charges, traced from each positive charge until they reach a negative one or leave the page.',
    params: { charges: [2, 8, 1, 4, 'Charges'], lines: [6, 60, 1, 22, 'Lines per charge'], equip: [0, 24, 1, 8, 'Equipotentials'], weight: [0.2, 4, 0.05, 1, 'Line weight'], inks: [1, 4, 1, 3, 'Inks'] },
    gen(P, ctx) {
      const { W, H, S, rng } = ctx, Q = [];
      for (let k = 0; k < P.charges; k++) Q.push([rng.range(0.18, 0.82) * W, rng.range(0.18, 0.82) * H, (k % 2 ? -1 : 1) * rng.range(0.6, 1.4)]);
      const E = (x, y) => { let ex = 0, ey = 0; for (const [qx, qy, q] of Q) { const dx = x - qx, dy = y - qy, r2 = dx * dx + dy * dy + 1, f = q / (r2 * Math.sqrt(r2)); ex += dx * f; ey += dy * f; } return [ex, ey]; };
      const st = S * 0.003, rq = S * 0.012;
      const dir = (x, y) => { const [ex, ey] = E(x, y), m = Math.hypot(ex, ey) || 1; return [ex / m, ey / m]; };
      if (P.equip) {
        const gw = Math.ceil(W / (S / 200)) + 1, gh = Math.ceil(H / (S / 200)) + 1, sc = S / 200, f = new Float32Array(gw * gh);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          let v = 0; for (const [qx, qy, q] of Q) v += q / Math.max(rq, Math.hypot(i * sc - qx, j * sc - qy));
          f[j * gw + i] = Math.sign(v) * Math.log1p(Math.abs(v) * S * 0.5);
        }
        for (let l = 1; l <= P.equip; l++) for (const sg of [-1, 1]) {
          const lv = sg * l * 3.2 / P.equip, c = contours(f, gw, gh, lv);
          for (const r of c.rings) ctx.out.poly(r.map(v => v * sc), true, { f: -1, s: P.inks > 2 ? 2 : 0, w: P.weight * 0.5, sm: 1 });
          for (const r of c.lines) ctx.out.poly(r.map(v => v * sc), false, { s: P.inks > 2 ? 2 : 0, w: P.weight * 0.5, sm: 1 });
        }
      }
      for (const [qx, qy, q] of Q) {
        if (q < 0) continue;
        const n = Math.max(4, Math.round(P.lines * q));
        for (let k = 0; k < n; k++) {
          if (ctx.out.full()) return;
          const a = TAU * (k + 0.5) / n;
          let x = qx + rq * Math.cos(a), y = qy + rq * Math.sin(a);
          const pts = [x, y];
          for (let t = 0; t < 4000; t++) {
            const [ax, ay] = dir(x, y), [bx, by] = dir(x + ax * st / 2, y + ay * st / 2);
            x += bx * st; y += by * st;
            if (t % 2 === 0) pts.push(x, y);
            if (x < -S * 0.05 || y < -S * 0.05 || x > W + S * 0.05 || y > H + S * 0.05) break;
            if (Q.some(([cx, cy, c]) => c < 0 && Math.hypot(x - cx, y - cy) < rq)) break;
          }
          pts.push(x, y);
          ctx.out.poly(pts, false, { s: 0, w: P.weight, sm: 1 });
        }
      }
      for (const [qx, qy, q] of Q) {
        ctx.out.circle(qx, qy, rq * 1.3, { f: q > 0 ? (P.inks > 1 ? 1 : 0) : 0 });
        const b = rq * 0.6, t = rq * 0.16;
        ctx.out.rect(qx - b, qy - t, 2 * b, 2 * t, { f: -2 });
        if (q > 0) ctx.out.rect(qx - t, qy - b, 2 * t, 2 * b, { f: -2 });
      }
    },
  },
];

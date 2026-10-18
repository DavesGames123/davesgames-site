// ============================================================================
//  CORAL REEF  ·  volume noise tests (node, no browser):  node tests/volnoise.test.mjs
// ----------------------------------------------------------------------------
//  The user (2026-10-18): "theres something wrong with the volumetric
//  lighting effects that doesnt play nicely with background corals and
//  kind of shimmers betwen frames looking really unclean for some reason,
//  kind of like tv static. that marine snow should also catch volumetrics
//  nicely".
//  A CPU copy of VOL_FS (one lamp, a 30-step jittered march, the jittered
//  shadow tap, thin coral branches) feeds the old history (the shader of
//  c53f59bd, in this file) and the new one (volume.js taaFrame). The
//  noise = the mean over pixels of the variance in time of (history -
//  truth), truth = a 96-step march with no jitter. Three cases:
//    static ...... the camera and the lamp stay
//    lamp ........ the lamp turns, the camera stays
//    follow ...... the camera follows the ROV: both move as one, the
//                  coral stays (the case of the screen shot)
//  And: no ghost trail when the lamp turns away, coral-edge pixels keep
//  their history, the snow in a cone vs out of all cones.
// ============================================================================
import * as V from '../volume.js';
if (process.env.VK) Object.assign(V.VOL_K, JSON.parse(process.env.VK));
const ONLY = process.env.ONLY;

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }

const W = 96, H = 60, TANY = Math.tan(25 * Math.PI / 180), ASP = W / H;
const FOGK = 0.04, VOLMAX = 40, STEPS = 30, RANGE = 42, TEX = 1 / 1024;
const COSO = Math.cos(0.44), COSI = Math.cos(0.44 * 0.45);
const BN = V.blueNoise(64);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / len(a));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

// the coral: vertical branches (x, z, radius); many are thinner than a pixel
const BR = [];
{ let s = 5; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 40; i++) BR.push([-4 + 8 * r(), 9 + 7 * r(), i % 4 ? 0.03 + 0.05 * r() : 0.2 + 0.2 * r()]); }
// a camera: eye E, yaw (turn round y). -> basis
const camAt = (E, yaw) => ({ E, R: [Math.cos(yaw), 0, -Math.sin(yaw)], U: [0, 1, 0], F: [Math.sin(yaw), 0, Math.cos(yaw)] });
const rayDir = (c, x, y) => { const u = ((x + 0.5) / W * 2 - 1) * TANY * ASP, v = ((y + 0.5) / H * 2 - 1) * TANY; return add(add(mul(c.R, u), mul(c.U, v)), c.F); };
// the view depth of pixel (x, y): the nearest branch, else 400 (open water)
function depthAt(c, x, y) {
  const d = rayDir(c, x, y), dl = Math.hypot(d[0], d[2]);
  let best = 400;
  for (const [bx, bz, br] of BR) {
    const ox = bx - c.E[0], oz = bz - c.E[2];
    const tc = (ox * d[0] + oz * d[2]) / (dl * dl), px = ox - d[0] * tc, pz = oz - d[2] * tc;
    const m2 = px * px + pz * pz;
    if (m2 < br * br && tc > 0) { const t = tc - Math.sqrt(br * br - m2) / dl; if (t > 0 && t < best) best = t; }
  }
  return best;      // d has F component 1: t = the view depth
}
// a hard shadow: the segment p..lamp passes a branch
function shadow(p, P) {
  const dx = P[0] - p[0], dz = P[2] - p[2], L2 = dx * dx + dz * dz;
  for (const [bx, bz, br] of BR) {
    const t = Math.min(1, Math.max(0, ((bx - p[0]) * dx + (bz - p[2]) * dz) / L2));
    const qx = p[0] + dx * t - bx, qz = p[2] + dz * t - bz;
    if (qx * qx + qz * qz < br * br) return 0;
  }
  return 1;
}
function spotRad(sp, p) {
  const d = sub(sp.P, p), dist = Math.max(len(d), 0.05), L = mul(d, 1 / dist), ca = -dot(L, sp.D);
  let cone = sstep(COSO, COSI, ca); cone *= 0.8 + 0.2 * sstep(COSI, 1, ca);
  return { R: 1.68 * cone / (1 + 0.06 * dist * dist) * sstep(RANGE, RANGE * 0.55, dist) * Math.exp(-dist * FOGK), L, dist };
}
// VOL_FS for one pixel; frame < 0: the truth (256 steps, no jitter)
function march(c, sp, x, y, a, frame) {
  const d = rayDir(c, x, y), rd = norm(d), tS = a * len(d), tMax = Math.min(tS, VOLMAX);
  let j = 0.5, j2 = 0.5, steps = 96;
  if (frame >= 0) {
    const g1 = 0.61803399 * frame, bx = x & 63, by = y & 63;
    j = fract(BN[by * 64 + bx] / 255 + g1); j2 = fract(BN[((by + 17) & 63) * 64 + ((bx + 32) & 63)] / 255 + g1 * 1.3247); steps = STEPS;
  }
  const dt = tMax / steps, ax0 = norm([sp.D[2], 0, -sp.D[0]]), ay0 = [0, 1, 0];
  let acc = 0;
  for (let k = 0; k < steps; k++) {
    const t = (k + j) * dt, p = add(c.E, mul(rd, t));
    const { R, L, dist } = spotRad(sp, p);
    if (R < 1e-6) continue;
    let pj = p;
    if (frame >= 0) {
      const an = 6.2831853 * fract(j2 + k * 0.7548777), rr = Math.sqrt(fract(j + k * 0.5698403)), s = rr * dist * TEX * 1.2;
      pj = add(p, add(mul(ax0, Math.cos(an) * s), mul(ay0, Math.sin(an) * s)));
    }
    acc += R * shadow(pj, sp.P) * sstep(0, V.VOL_K.nearLamp, dist) * V.beamPhase(dot(L, rd)) * Math.exp(-t * FOGK) * dt;
  }
  return acc * V.VOL_K.scatter;
}
function frameOf(c, sp, frame, wantTruth) {
  const cur = new Float32Array(W * H * 2), tru = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = depthAt(c, x, y), i = y * W + x;
    cur[i * 2] = march(c, sp, x, y, a, frame); cur[i * 2 + 1] = a;
    if (wantTruth) tru[i] = march(c, sp, x, y, a, -1);
  }
  return { cur, tru };
}
const ctxOf = (c, cPrev, sp, spPrev) => ({
  eye: c.E,
  surface: (x, y, a) => add(c.E, mul(rayDir(c, x, y), a)),
  prevUv: (p) => {
    const q = sub(p, cPrev.E), z = dot(q, cPrev.F);
    if (z <= 1e-4) return null;
    return [(dot(q, cPrev.R) / z / (TANY * ASP)) * 0.5 + 0.5, (dot(q, cPrev.U) / z / TANY) * 0.5 + 0.5, z];
  },
  spots: [{ P: sp.P, D: sp.D, cosO: COSO }], prev: [{ P: spPrev.P, D: spPrev.D }],
  lampPx: V.lampPx([sp], [spPrev], H / (2 * TANY)),
});
// the old VOL_TAA_FS (c53f59bd): bilinear history, hard depth test, the
// clip box of the raw 3 x 3, blend 1 / 10, a reset = the raw pixel
function taaOld(cur, hist, ctx) {
  const out = new Float32Array(W * H * 2), used = new Uint8Array(W * H);
  const at = (x, y) => (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 2;
  const bil = (u, v, ch) => {
    const sx = Math.min(W - 1, Math.max(0, u * W - 0.5)), sy = Math.min(H - 1, Math.max(0, v * H - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const g = (x, y) => hist[(y * W + x) * 2 + ch];
    return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y);
    let m1 = 0, m2 = 0, mn = Infinity, mx = -Infinity;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const s = cur[at(x + i, y + j)]; m1 += s; m2 += s * s; mn = Math.min(mn, s); mx = Math.max(mx, s); }
    m1 /= 9; m2 /= 9;
    const sd = Math.sqrt(Math.max(m2 - m1 * m1, 0)), lo = Math.max(mn, m1 - 1.25 * sd), hi = Math.min(mx, m1 + 1.25 * sd);
    let a = 1, h = 0;
    if (hist) {
      const u = ctx.prevUv(ctx.surface(x, y, cur[c + 1]));
      if (u && u[0] >= 0 && u[0] <= 1 && u[1] >= 0 && u[1] <= 1) {
        h = bil(u[0], u[1], 0);
        if (Math.abs(bil(u[0], u[1], 1) - u[2]) <= 0.1 * Math.max(u[2], 0.1)) { a = 0.1; used[y * W + x] = 1; }
      }
    }
    out[(y * W + x) * 2] = Math.min(hi, Math.max(lo, h)) * (1 - a) + cur[c] * a; out[(y * W + x) * 2 + 1] = cur[c + 1];
  }
  return { out, used };
}
// run a case: path(f) -> { cam, spot }. -> noise numbers and the frames
function run(path, n = 40, warm = 16) {
  let hOld = null, hNew = null, prev = null;
  const dOld = [], dNew = [], dRaw = [], wNew = [], uOld = [], tr = [];
  for (let f = 0; f < n; f++) {
    const { cam, spot } = path(f), { cur, tru } = frameOf(cam, spot, f, f >= warm);
    const ctx = prev ? ctxOf(cam, prev.cam, spot, prev.spot) : null;
    const o = taaOld(cur, hOld, ctx), nw = V.taaFrame(cur, hNew, W, H, ctx);
    hOld = o.out; hNew = nw.out; prev = { cam, spot };
    if (f >= warm) {
      const e1 = new Float32Array(W * H), e2 = new Float32Array(W * H), e3 = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) { e1[i] = o.out[i * 2] - tru[i]; e2[i] = nw.out[i * 2] - tru[i]; e3[i] = cur[i * 2] - tru[i]; }
      dOld.push(e1); dNew.push(e2); dRaw.push(e3); wNew.push(nw.w); uOld.push(o.used); tr.push({ tru, cur, out: nw.out, outOld: o.out });
    }
  }
  const tvar = (D) => {
    let s = 0;
    for (let i = 0; i < W * H; i++) { let m = 0, q = 0; for (const e of D) { m += e[i]; q += e[i] * e[i]; } m /= D.length; s += q / D.length - m * m; }
    return s / (W * H);
  };
  // the flicker: the second difference in time (a smooth move gives 0)
  const flick = (get) => {
    let s = 0, n = 0;
    for (let t = 1; t < tr.length - 1; t++) {
      const a = get(tr[t - 1]), b = get(tr[t]), c = get(tr[t + 1]);
      for (let i = 0; i < W * H; i++) { const d = b(i) - 0.5 * (a(i) + c(i)); s += d * d; n++; }
    }
    return s / n;
  };
  let peak = 0; for (const t of tr) for (const v of t.tru) peak = Math.max(peak, v);
  return {
    old: tvar(dOld), now: tvar(dNew), raw: tvar(dRaw), peak, wNew, uOld, tr,
    fOld: flick((t) => (i) => t.outOld[i * 2]), fNew: flick((t) => (i) => t.out[i * 2]), fRaw: flick((t) => (i) => t.cur[i * 2]), fTru: flick((t) => (i) => t.tru[i]),
  };
}
const lampFrom = (E, yaw, off) => {
  const c = camAt(E, yaw), P = add(add(E, mul(c.R, off[0])), add(mul(c.U, off[1]), mul(c.F, off[2])));
  return { P, D: norm(add(mul(c.F, 1), add(mul(c.R, -0.25), mul(c.U, -0.05)))) };
};
const OFF = [0.6, -0.3, 0.6];
const cases = {
  static: (f) => ({ cam: camAt([0, 0, 0], 0), spot: lampFrom([0, 0, 0], 0, OFF) }),
  lamp: (f) => ({ cam: camAt([0, 0, 0], 0), spot: lampFrom([0, 0, 0], 0.006 * f, OFF) }),
  follow: (f) => { const E = [0.03 * f, 0, 0.02 * f], yaw = 0.004 * f; return { cam: camAt(E, yaw), spot: lampFrom(E, yaw, OFF) }; },
};
const R = {};
for (const [k, p] of Object.entries(cases)) {
  if (ONLY && ONLY !== k) continue;
  const t0 = performance.now();
  R[k] = run(p, +(process.env.N || 40), +(process.env.WARM || 16));
  const r = R[k];
  console.log(`${k.padEnd(6)} flicker: raw ${r.fRaw.toExponential(2)}  old ${r.fOld.toExponential(2)}  new ${r.fNew.toExponential(2)}  old/new ${(r.fOld / r.fNew).toFixed(1)}x  (truth ${r.fTru.toExponential(2)})`);
  console.log(`${k.padEnd(6)} error variance: raw ${r.raw.toExponential(2)}  old ${r.old.toExponential(2)}  new ${r.now.toExponential(2)}  old/new ${(r.old / r.now).toFixed(1)}x  (peak ${r.peak.toFixed(3)}, ${(performance.now() - t0).toFixed(0)} ms)`);
  ok(r.fNew * 10 <= r.fOld, `${k}: the new history flickers at least 10x less than the old`, `${(r.fOld / r.fNew).toFixed(1)}x`);
  ok(r.now < r.old, `${k}: the new history is nearer to the truth in time than the old`);
}

// ── coral edges keep their history (follow case) ──────────────────────────
{
  let nE = 0, kNew = 0, kOld = 0;
  const r = R.follow;
  r.tr.forEach((t, fi) => {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, a = t.cur[i * 2 + 1];
      if (a > VOLMAX) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (t.cur[((y + dy) * W + x + dx) * 2 + 1] > a * 1.5) edge = true;
      if (!edge) continue;
      nE++; if (r.wNew[fi][i] > 0.02) kNew++; if (r.uOld[fi][i]) kOld++;
    }
  });
  // the flicker on the coral-edge pixels only
  let fo = 0, fn = 0, m = 0;
  for (let t = 1; t < r.tr.length - 1; t++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, a = r.tr[t].cur[i * 2 + 1];
    if (a > VOLMAX) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r.tr[t].cur[((y + dy) * W + x + dx) * 2 + 1] > a * 1.5) edge = true;
    if (!edge) continue;
    const d2 = (k) => r.tr[t][k][i * 2] - 0.5 * (r.tr[t - 1][k][i * 2] + r.tr[t + 1][k][i * 2]);
    fo += d2('outOld') ** 2; fn += d2('out') ** 2; m++;
  }
  console.log(`coral edges: ${nE} pixel-frames, history kept: old ${(100 * kOld / nE).toFixed(1)} %, new ${(100 * kNew / nE).toFixed(1)} %; flicker old ${(fo / m).toExponential(2)}, new ${(fn / m).toExponential(2)} (${(fo / fn).toFixed(1)}x)`);
  ok(fn * 5 <= fo, 'coral edges: the flicker on thin-branch edge pixels is 5x or more lower', `${(fo / fn).toFixed(1)}x`);
  ok(nE > 50, 'coral edges: the fixture has thin-branch edge pixels', nE);
  ok(kNew / nE >= 0.9 && kNew > kOld, 'coral edges: the new history keeps 90 % or more of the edge pixel-frames (old resets them)', `${kNew}/${nE} vs ${kOld}`);
}

// ── no ghost trail: the lamp turns away and stops ───────────────────────────
{
  const p = (f) => ({ cam: camAt([0, 0, 0], 0), spot: lampFrom([0, 0, 0], f < 12 ? 0 : Math.min(f - 12, 6) * 0.06, OFF) });
  const r = run(p, 28, 26);
  const t = r.tr[r.tr.length - 1];     // 10 frames after the stop
  let n = 0, bad = 0;
  for (let i = 0; i < W * H; i++) if (t.tru[i] < 0.02 * r.peak) { n++; if (t.out[i * 2] > 0.1 * r.peak) bad++; }
  console.log(`ghost: ${bad} of ${n} dark pixels over 10 % of the peak, 10 frames after the lamp stops`);
  ok(n > 500 && bad <= n * 0.002, 'ghost: no trail where the cone was (under 0.2 % of the dark pixels)', `${bad}/${n}`);
}

// ── the snow catches the beam ─────────────────────────────────────────────
{
  // a flake 5 m down the axis of a lamp (radiance 1.68), seen from the side;
  // a flake out of all cones; the light from above at 20 m (uDown 0.6)
  const rad = 1.68 / (1 + 0.06 * 25) * Math.exp(-5 * FOGK), sky = 0.27 * 0.6 * Math.exp(-20 * 0.03);
  const inAxis = V.snowLight({ rad, shadow: 1, dl: 5, cosV: 0, cosAx: 1, cosIn: COSI, sky, skyPhase: 0.029 });
  const inEdge = V.snowLight({ rad: rad * 0.8, shadow: 1, dl: 5, cosV: 0, cosAx: Math.cos(0.3), cosIn: COSI, sky, skyPhase: 0.029 });
  const shade = V.snowLight({ rad, shadow: 0, dl: 5, cosV: 0, cosAx: 1, cosIn: COSI, sky, skyPhase: 0.029 });
  const out = V.snowLight({ rad: 0, shadow: 1, dl: 5, cosV: 0, cosAx: 0, cosIn: COSI, sky, skyPhase: 0.029 });
  // the old SNOW_LIGHT: spot x shadow x msPhase (side 0.029), sky x 0.6
  const oldIn = rad * 0.029, oldOut = sky * 0.029 * 0.6, newOut = out / 1;
  console.log(`snow: in the cone (axis) ${inAxis.toFixed(4)}, (edge) ${inEdge.toFixed(4)}, out ${newOut.toExponential(2)}: ratio ${(inEdge / newOut).toFixed(0)} (old ${(oldIn / oldOut).toFixed(0)})`);
  ok(inEdge / newOut >= 50 && inEdge / newOut > 4 * (oldIn / oldOut), 'snow: a flake in a cone is 50x or more brighter than one out of all cones (4x the old ratio)');
  ok(inAxis > inEdge * 1.5, 'snow: the glint near the cone axis');
  ok(shade < inAxis * 0.05, 'snow: the per-ROV shadow of the beam darkens the flakes too');
  ok(Math.abs(V.beamPhase(1) - (0.08 + 0.25 * (1 - 0.3025) / Math.pow(0.45, 3))) < 1e-9, 'snow: the beam phase is the VOL_FS phase');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

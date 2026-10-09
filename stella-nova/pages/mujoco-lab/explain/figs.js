// ============================================================================
//  MUJOCO LAB  ·  explain/figs.js — live mini-figures of the explainer
// ----------------------------------------------------------------------------
//  Each figure runs the real engine (core/engine.js, the vendored MuJoCo
//  3.15.0 WASM build) on a tiny model and draws into a Canvas 2D context.
//  This file uses no DOM: a figure gets a ctx, a width and a height. The
//  page (explain/index.js) gives it a canvas; the node tests give it a
//  recording ctx or an @napi-rs/canvas ctx for PNG checks.
//
//  A figure is  F = make(mj, opts)  with
//    F.tick(dt)            advance the model by dt seconds of real time
//    F.draw(ctx, w, h, P)  draw; P is the palette (see PALETTE)
//    F.set(key, value)     change a control (see each figure's `controls`)
//    F.info()              numbers for the tests and the readouts
//    F.dispose()           free the WASM objects
//
//  GREP MAP
//    export const PALETTE ......... fallback colors (the page reads CSS tokens)
//    export function solimpCurve .. impedance d(r) of solimp, as in the docs
//    export const FIGS ............ id -> { title, controls, make }
//    function figCoords ........... double pendulum + live M(q)
//    function figChain ............ joint space vs maximal coordinates
//    function figContact .......... soft contact: solref sweep, penetration
//    function figImpedance ........ solimp curves d(r)
//    function figCones ............ pyramidal vs elliptic: diagonal push
//    function figSolvers .......... PGS / CG / Newton convergence plot
//    function figIntegrators ...... energy drift of four integrators
//    function figActuators ........ position servo, equality, rope tendon
//    function figSensors .......... touch, accelerometer, height traces
//    function figSpeed ............ live step-time benchmark
// ============================================================================

import { createSim } from '../core/engine.js';

export const PALETTE = {
  bg: '#0d1117', panel: '#151b24', text: '#e6edf3', dim: '#8b949e', line: '#30363d', accent: '#62c4ff',
  m1: '#62c4ff', m2: '#ff9a62', m3: '#86dc7c', m4: '#e889dc', m5: '#ffd666', m6: '#a8a4ff', ground: '#3a4350',
};

// ── drawing helpers ─────────────────────────────────────────────────────────
const TAU = Math.PI * 2;
function clear(ctx, w, h, P) { ctx.fillStyle = P.bg; ctx.fillRect(0, 0, w, h); }
function label(ctx, P, text, x, y, color = P.dim, align = 'left', size = 12) {
  ctx.fillStyle = color; ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
// view: world (a, b) -> canvas; a is x, b is z (side) or y (top)
function view(cx, cy, scale) { return { X: a => cx + a * scale, Y: b => cy - b * scale, s: scale }; }

// Hull of a few 2D points (gift wrap, n <= 8).
function hull(pts) {
  pts = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Draw all geoms of S (planes excepted) projected on a world plane.
// axes: 'xz' (side view, default) or 'xy' (top view).
function drawGeoms(ctx, S, V, P, { axes = 'xz', colors = null, skip = null } = {}) {
  const m = S.m, G = S.geomPoses(), types = m.geom_type, size = m.geom_size, rgba = m.geom_rgba;
  const ib = axes === 'xz' ? 2 : 1;
  for (let g = 0; g < S.ngeom; g++) {
    const t = types[g]; if (t === 0 || (skip && skip(g))) continue;   // 0 = plane
    const p = G.subarray(12 * g, 12 * g + 3), R = G.subarray(12 * g + 3, 12 * g + 12);
    const sx = size[3 * g], sy = size[3 * g + 1], sz = size[3 * g + 2];
    const col = colors ? colors(g) : `rgba(${(rgba[4 * g] * 255) | 0},${(rgba[4 * g + 1] * 255) | 0},${(rgba[4 * g + 2] * 255) | 0},${rgba[4 * g + 3]})`;
    const W = (lx, ly, lz) => [p[0] + R[0] * lx + R[1] * ly + R[2] * lz, p[ib] + R[3 * ib] * lx + R[3 * ib + 1] * ly + R[3 * ib + 2] * lz];
    ctx.fillStyle = col; ctx.strokeStyle = col;
    if (t === 2) { ctx.beginPath(); ctx.arc(V.X(p[0]), V.Y(p[ib]), Math.max(1, sx * V.s), 0, TAU); ctx.fill(); }
    else if (t === 3) {   // capsule: radius sx, half length sy along local z
      const a = W(0, 0, -sy), b = W(0, 0, sy);
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, 2 * sx * V.s);
      ctx.beginPath(); ctx.moveTo(V.X(a[0]), V.Y(a[1])); ctx.lineTo(V.X(b[0]), V.Y(b[1])); ctx.stroke();
    } else {   // box (6), cylinder (5), ellipsoid (4), mesh: a hull of the box corners
      const hx = sx, hy = t === 5 ? sx : sy, hz = t === 5 ? sy : sz;
      const pts = [];
      for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) { const q = W(i * hx, j * hy, k * hz); pts.push([V.X(q[0]), V.Y(q[1])]); }
      const H = hull(pts); ctx.beginPath(); H.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}
function ground(ctx, V, P, z = 0, w = 4000) {
  ctx.strokeStyle = P.ground; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, V.Y(z)); ctx.lineTo(w, V.Y(z)); ctx.stroke();
}

// A line plot in the box (x0, y0, w, h). series: [{ pts: [[x, y]], color, name }]
function plot(ctx, P, box, series, { xr, yr, xlabel = '', ylabel = '', yticks = null, xticks = true, legend = true }) {
  const [x0, y0, w, h] = box;
  ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
  const X = x => x0 + (x - xr[0]) / (xr[1] - xr[0]) * w;
  const Y = y => y0 + h - (y - yr[0]) / (yr[1] - yr[0]) * h;
  if (yticks) for (const [v, t] of yticks) {
    const yy = Y(v); if (yy < y0 - 0.5 || yy > y0 + h + 0.5) continue;
    ctx.strokeStyle = P.line; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + w, yy); ctx.stroke(); ctx.globalAlpha = 1;
    label(ctx, P, t, x0 - 4, yy, P.dim, 'right', 10);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.setLineDash(s.dash || []); ctx.beginPath();
    let pen = false;
    for (const [x, y] of s.pts) {
      if (!Number.isFinite(y)) { pen = false; continue; }
      const px = X(x), py = Y(Math.min(Math.max(y, yr[0] - 10 * (yr[1] - yr[0])), yr[1] + 10 * (yr[1] - yr[0])));
      pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true;
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  if (xticks !== false) for (let k = 0; k <= 4; k++) {
    const v = xr[0] + (xr[1] - xr[0]) * k / 4, t = Math.abs(xr[1] - xr[0]) >= 20 ? v.toFixed(0) : +v.toFixed(2) + '';
    label(ctx, P, t, X(v), y0 + h + 9, P.dim, k === 0 ? 'left' : k === 4 ? 'right' : 'center', 10);
  }
  label(ctx, P, xlabel, x0 + w / 2, y0 + h + (xticks !== false ? 24 : 14), P.dim, 'center', 11);
  if (ylabel) { ctx.save(); ctx.translate(x0 - (yticks ? 34 : 10), y0 + h / 2); ctx.rotate(-Math.PI / 2); label(ctx, P, ylabel, 0, 0, P.dim, 'center', 11); ctx.restore(); }
  if (legend) {
    const named = series.filter(s => s.name);
    if (named.length) { ctx.fillStyle = P.bg; ctx.globalAlpha = 0.8; ctx.fillRect(x0 + w - 116, y0 + 2, 114, 15 * named.length + 2); ctx.globalAlpha = 1; }
    let ly = y0 + 10; for (const s of series) if (s.name) { ctx.fillStyle = s.color; ctx.fillRect(x0 + w - 110, ly - 1, 12, 3); label(ctx, P, s.name, x0 + w - 94, ly, P.text, 'left', 11); ly += 15; }
  }
  return { X, Y };
}
const fmt = (v, d = 3) => (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(1) : v.toFixed(d));

// ── 1. generalized coordinates: a double pendulum and its M(q) ─────────────
const PENDULUM = (damp = 0) => `<mujoco model="explain-pendulum">
  <option timestep="0.002" integrator="RK4"/>
  <default><joint type="hinge" axis="0 1 0" damping="${damp}"/><geom type="capsule" size="0.035" density="1000"/></default>
  <worldbody>
    <geom name="pivot" type="sphere" size="0.04" pos="0 0 0" rgba=".5 .55 .6 1" contype="0" conaffinity="0"/>
    <body name="upper" pos="0 0 0"><joint name="q1"/><geom fromto="0 0 0 0 0 -0.5" rgba=".38 .77 1 1" contype="0" conaffinity="0"/>
      <body name="lower" pos="0 0 -0.5"><joint name="q2"/><geom fromto="0 0 0 0 0 -0.5" rgba="1 .6 .38 1" contype="0" conaffinity="0"/></body>
    </body>
  </worldbody>
</mujoco>`;

function figCoords(mj) {
  const S = createSim(mj, { xml: PENDULUM(), name: 'pendulum' });
  const M = new mj.DoubleBuffer(4);
  const reset = () => { S.reset(); S.qpos[0] = 2.1; S.qpos[1] = -0.9; S.forward(); };
  reset();
  const trail = [];
  const F = {
    tick(dt) { S.advance(Math.min(dt, 0.05)); const G = S.geomPoses(); trail.push([2 * G[24] - 2 * G[12], 2 * G[26] - 2 * G[14]]); if (trail.length > 160) trail.shift(); if (S.time > 60) reset(); },
    fullM() { mj.mj_fullM(S.m, S.d, M); return Array.from(M.GetView()); },
    info() { return { nq: S.nq, nv: S.nv, nbody: S.nbody - 1, M: this.fullM(), q: [S.qpos[0], S.qpos[1]], v: [S.qvel[0], S.qvel[1]] }; },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const narrow = w < 520, side = narrow ? w : w * 0.55;
      const V = view(side / 2, narrow ? h * 0.36 : h * 0.42, Math.min(side, narrow ? h * 0.62 : h) * 0.42);
      // tip trail
      const G = S.geomPoses();
      ctx.strokeStyle = P.m2; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath();
      trail.forEach(([x, z], i) => { const tip = [x, z]; i ? ctx.lineTo(V.X(tip[0]), V.Y(tip[1])) : ctx.moveTo(V.X(tip[0]), V.Y(tip[1])); }); ctx.stroke(); ctx.globalAlpha = 1;
      drawGeoms(ctx, S, V, P);
      // angle arcs: q1 from the vertical, q2 relative to the upper link
      const q1 = S.qpos[0], q2 = S.qpos[1];
      ctx.lineWidth = 2; ctx.strokeStyle = P.m1; ctx.beginPath();
      const a0 = Math.PI / 2; ctx.arc(V.X(0), V.Y(0), 0.16 * V.s, Math.min(a0, a0 - q1), Math.max(a0, a0 - q1)); ctx.stroke();
      const ex = G[12 * 1 + 0] * 2, ez = G[12 * 1 + 2] * 2;   // elbow = 2 * centre of upper capsule
      ctx.strokeStyle = P.m2; ctx.beginPath(); ctx.arc(V.X(ex), V.Y(ez), 0.13 * V.s, Math.min(a0 - q1, a0 - q1 - q2), Math.max(a0 - q1, a0 - q1 - q2)); ctx.stroke();
      label(ctx, P, 'q1', V.X(0) + 0.2 * V.s * Math.sin(q1 / 2), V.Y(0) - 0.2 * V.s * Math.cos(q1 / 2), P.m1, 'center', 13);
      label(ctx, P, 'q2', V.X(ex) + 0.18 * V.s * Math.sin(q1 + q2 / 2), V.Y(ez) - 0.18 * V.s * Math.cos(q1 + q2 / 2), P.m2, 'center', 13);
      // readout: q, v, M(q)
      const m = this.fullM();
      const x0 = narrow ? 16 : side + 10, y0 = narrow ? h * 0.74 : h * 0.18, lh = narrow ? 17 : 20;
      label(ctx, P, `q = (${fmt(q1, 2)}, ${fmt(q2, 2)}) rad    v = (${fmt(S.qvel[0], 2)}, ${fmt(S.qvel[1], 2)}) rad/s`, x0, y0, P.text, 'left', 12);
      label(ctx, P, `nq = ${S.nq}, nv = ${S.nv}: two numbers, two bodies`, x0, y0 + lh, P.dim, 'left', 12);
      label(ctx, P, 'M(q), live from mj_fullM (kg m²):', x0, y0 + 2.2 * lh, P.dim, 'left', 12);
      const cw = 70;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++)
        label(ctx, P, m[2 * r + c].toFixed(4), x0 + 14 + c * cw, y0 + (3.3 + r) * lh, r === c ? P.text : P.m5, 'left', 13);
      ctx.strokeStyle = P.dim; ctx.lineWidth = 1; ctx.beginPath();
      const bx = x0 + 6, by = y0 + 2.75 * lh, bh = 2.1 * lh;
      ctx.moveTo(bx + 5, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + 5, by + bh);
      ctx.moveTo(bx + 2 * cw + 3, by); ctx.lineTo(bx + 2 * cw + 8, by); ctx.lineTo(bx + 2 * cw + 8, by + bh); ctx.lineTo(bx + 2 * cw + 3, by + bh); ctx.stroke();
      if (!narrow) label(ctx, P, 'The off-diagonal term changes with q2: the links share inertia.', x0, y0 + 5.6 * lh, P.dim, 'left', 11);
    },
    set() {}, dispose() { M.delete && M.delete(); S.dispose(); },
  };
  return F;
}

// ── 2. joint space vs maximal coordinates: a chain of N links ──────────────
export function chainXML(n) {
  let s = `<mujoco model="explain-chain"><option timestep="0.002"/>
  <default><joint type="hinge" axis="0 1 0" damping="0.002"/><geom type="capsule" size="0.012" density="800" contype="0" conaffinity="0"/></default><worldbody>`;
  const L = 0.9 / n;
  let close = '';
  for (let i = 0; i < n; i++) {
    s += `<body name="l${i}" pos="${i ? L : 0} 0 0"><joint/><geom fromto="0 0 0 ${L} 0 0" rgba="${(0.38 + 0.6 * i / n).toFixed(2)} ${(0.77 - 0.2 * i / n).toFixed(2)} 1 1"/>`;
    close += '</body>';
  }
  return s + close + '</worldbody></mujoco>';
}
function figChain(mj, { n = 12 } = {}) {
  let S = null, N = 0;
  const build = k => { if (S) S.dispose(); N = k; S = createSim(mj, { xml: chainXML(k), name: 'chain' }); };
  build(n);
  const F = {
    controls: [{ key: 'n', label: 'links', min: 1, max: 40, step: 1, value: n }],
    set(k, v) { if (k === 'n' && (v | 0) !== N) build(Math.max(1, Math.min(40, v | 0))); },
    tick(dt) { S.advance(Math.min(dt, 0.05)); if (S.time > 30) S.reset(); },
    info() {
      const bodies = S.nbody - 1;
      return { n: N, nv: S.nv, bodies, maximal: 6 * bodies, rows: 5 * bodies };
    },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const narrow = w < 520, side = narrow ? w : w * 0.5;
      const V = view(side * 0.5, h * 0.1, Math.min(side * 0.5, h * (narrow ? 0.5 : 0.85)) / 0.9);
      drawGeoms(ctx, S, V, P);
      const I = this.info(), x0 = narrow ? 24 : side + 30, bw = (narrow ? w : w - side) - 70, y0 = narrow ? h * 0.62 : h * 0.22;
      const top = 6 * 40 + 5 * 40, sc = bw / top;
      label(ctx, P, `${I.n} hinge links`, x0, y0 - 18, P.text, 'left', 13);
      label(ctx, P, 'joint space (MuJoCo): unknowns', x0, y0 + 2, P.dim, 'left', 11);
      ctx.fillStyle = P.m1; ctx.fillRect(x0, y0 + 10, Math.max(2, I.nv * sc), 14); label(ctx, P, String(I.nv), x0 + I.nv * sc + 6, y0 + 17, P.m1, 'left', 12);
      label(ctx, P, 'maximal coordinates: unknowns + constraint rows', x0, y0 + 42, P.dim, 'left', 11);
      ctx.fillStyle = P.m2; ctx.fillRect(x0, y0 + 50, I.maximal * sc, 14);
      ctx.fillStyle = P.m4; ctx.fillRect(x0 + I.maximal * sc, y0 + 50, I.rows * sc, 14);
      label(ctx, P, `${I.maximal} + ${I.rows}`, x0 + (I.maximal + I.rows) * sc + 6, y0 + 57, P.m2, 'left', 12);
      label(ctx, P, 'Joints are exact: no constraint rows, no drift, no stabilization.', x0, y0 + 84, P.dim, 'left', 11);
    },
    dispose() { if (S) S.dispose(); S = null; },
  };
  return F;
}

// ── 3. soft contact: a ball dropped with a chosen solref ───────────────────
export const BALL = (tc, dr, solimp = '0.9 0.95 0.001 0.5 2') => `<mujoco model="explain-drop">
  <option timestep="0.0005"/>
  <worldbody><geom name="floor" type="plane" size="2 2 .1" rgba=".3 .35 .4 1"/>
    <body name="ball" pos="0 0 0.6"><freejoint/><geom type="sphere" size="0.1" mass="1" solref="${tc} ${dr}" solimp="${solimp}" rgba=".38 .77 1 1"/></body>
  </worldbody></mujoco>`;
// Simulate a drop: series of [t, z, penetration in mm]
export function dropSeries(mj, tc, dr, T = 1.6) {
  const S = createSim(mj, { xml: BALL(tc, dr), name: 'drop' });
  const out = [], every = 4;
  try {
    for (let i = 0; S.time < T; i++) { if (i % every === 0) out.push([S.time, S.qpos[2], Math.max(0, 0.1 - S.qpos[2]) * 1000]); S.step(1); }
  } finally { S.dispose(); }
  return out;
}
function figContact(mj, { tc = 0.02, dr = 1 } = {}) {
  let ser = null, t = 0; const st = { tc, dr };
  const run = () => { ser = dropSeries(mj, st.tc, st.dr); t = 0; };
  run();
  const at = tt => { let i = Math.min(ser.length - 1, Math.max(0, Math.round(tt / (ser[1][0] - ser[0][0])))); return ser[i]; };
  return {
    controls: [{ key: 'tc', label: 'solref timeconst (s)', min: 0.002, max: 0.1, step: 0.001, value: tc },
               { key: 'dr', label: 'solref dampratio', min: 0.05, max: 2, step: 0.05, value: dr }],
    set(k, v) { st[k] = +v; run(); },
    tick(dt) { t += Math.min(dt, 0.05) * 0.5; if (t > ser[ser.length - 1][0] + 0.6) t = 0; },
    info() { const pen = Math.max(...ser.map(s => s[2])), rest = ser[ser.length - 1][2]; const bounce = Math.max(...ser.filter(s => s[0] > 0.4).map(s => s[1])); return { maxPenMM: pen, restPenMM: rest, bounceZ: bounce, tc: st.tc, dr: st.dr }; },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const narrow = w < 520, aw = narrow ? w * 0.34 : w * 0.28;
      const V = view(aw / 2, h * 0.86, Math.min(aw, h) * 1.2);
      const s = at(Math.min(t, ser[ser.length - 1][0]));
      ground(ctx, V, P, 0, aw);
      ctx.fillStyle = P.m1; ctx.beginPath(); ctx.arc(V.X(0), V.Y(s[1]), 0.1 * V.s, 0, TAU); ctx.fill();
      if (s[2] > 0) { ctx.fillStyle = P.m2; ctx.fillRect(V.X(-0.1), V.Y(0), 0.2 * V.s, Math.max(1, s[2] / 1000 * V.s)); }
      label(ctx, P, `t = ${s[0].toFixed(2)} s (half speed)`, 8, 14, P.dim, 'left', 11);
      const I = this.info();
      const bx = aw + (narrow ? 36 : 56), box = [bx, 20, w - bx - 14, h - 66];
      const ymax = Math.max(2, I.maxPenMM * 1.15);
      const { X } = plot(ctx, P, box, [{ pts: ser.map(r => [r[0], r[2]]), color: P.m2, name: 'overlap (mm)' }],
        { xr: [0, ser[ser.length - 1][0]], yr: [0, ymax], xlabel: 'time (s)', ylabel: 'overlap, mm', yticks: [0, 0.5, 1].map(f => [f * ymax, (f * ymax).toFixed(1)]) });
      ctx.strokeStyle = P.dim; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(t), box[1]); ctx.lineTo(X(t), box[1] + box[3]); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, P, `peak ${I.maxPenMM.toFixed(2)} mm, at rest ${I.restPenMM.toFixed(3)} mm, rebound to ${(I.bounceZ * 100).toFixed(1)} cm`, box[0] + 6, box[1] + box[3] - 10, P.text, 'left', 11);
    },
    dispose() {},
  };
}

// ── 4. impedance d(r) from solimp (docs: Modeling, Solver parameters) ──────
export function solimpCurve(r, [d0, dw, width, mid, pw]) {
  const x = Math.abs(r) / width;
  if (x >= 1) return dw;
  if (x <= 0) return d0;
  let y;
  if (pw === 1) y = x;
  else if (x <= mid) y = Math.pow(x, pw) / Math.pow(mid, pw - 1);
  else y = 1 - Math.pow(1 - x, pw) / Math.pow(1 - mid, pw - 1);
  return d0 + y * (dw - d0);
}
function figImpedance() {
  const sets = [
    { s: [0.9, 0.95, 0.001, 0.5, 2], name: 'default (0.9 0.95 0.001 0.5 2)', c: 'm1' },
    { s: [0.5, 0.99, 0.01, 0.5, 2], name: 'soft to hard (0.5 0.99 0.01)', c: 'm3' },
    { s: [0.2, 0.9, 0.01, 0.3, 6], name: 'late, steep (power 6, mid 0.3)', c: 'm4' },
  ];
  return {
    tick() {}, set() {}, info() { return { sets: sets.map(o => o.s), d: sets.map(o => [0, 0.0005, 0.001, 0.005, 0.02].map(r => solimpCurve(r, o.s))) }; },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const box = [54, 16, w - 70, h - 60];
      const series = sets.map(o => ({ pts: Array.from({ length: 201 }, (_, i) => { const r = i / 200 * 0.015; return [r * 1000, solimpCurve(r, o.s)]; }), color: P[o.c], name: o.name }));
      plot(ctx, P, box, series, { xr: [0, 15], yr: [0, 1], xlabel: 'violation r (mm)', ylabel: 'impedance d', yticks: [[0, '0'], [0.5, '0.5'], [1, '1']], legend: false });
      let ly = box[1] + box[3] - 14 - 15 * (sets.length - 1);
      for (const o of sets) { ctx.fillStyle = P[o.c]; ctx.fillRect(box[0] + box[2] - 220, ly - 1, 12, 3); label(ctx, P, o.name, box[0] + box[2] - 204, ly, P.text, 'left', 11); ly += 15; }
    },
    dispose() {},
  };
}

// ── 5. friction cones: push a box at a turning angle ───────────────────────
export const CONE_BOX = cone => `<mujoco model="explain-cone"><option timestep="0.002" cone="${cone}" impratio="1"/>
  <worldbody><geom type="plane" size="3 3 .1" friction="0.5 0.005 0.0001" rgba=".3 .35 .4 1"/>
  <body name="box" pos="0 0 0.05"><freejoint/><geom type="box" size="0.05 0.05 0.05" mass="1" friction="0.5 0.005 0.0001"/></body></worldbody></mujoco>`;
export const PUSH = 0.42;   // push / (m g): above mu/sqrt 2 = 0.354, below mu = 0.5
function figCones(mj) {
  const sims = ['pyramidal', 'elliptic'].map(c => ({ cone: c, S: createSim(mj, { xml: CONE_BOX(c), name: 'cone-' + c }), trail: [], f: [0, 0], slide: 0 }));
  let ang = 0; const g = 9.81;
  const B = sims[0].S.bodyNames.indexOf('box');
  const settle = () => { for (const o of sims) { o.S.reset(); o.S.step(150); o.trail.length = 0; } };
  settle();
  const F = {
    angle: () => ang,
    setAngle(a) { ang = a; },
    stepFor(sec) {
      const n = Math.max(1, Math.round(sec / 0.002)), fx = PUSH * g * Math.cos(ang), fy = PUSH * g * Math.sin(ang);
      for (const o of sims) {
        o.S.applyForce(B, [fx, fy, 0], [0, 0, 0]);
        // contact force on geom2 (the box) from the floor, summed over the
        // steps: a sliding box chatters, so one step is noisy
        let tx = 0, ty = 0, tn = 0;
        for (let k = 0; k < n; k++) { o.S.step(1); for (const c of o.S.contacts()) { tx += c.force[0]; ty += c.force[1]; tn += c.force[2]; } }
        o.f = tn > 0 ? [tx / tn, ty / tn] : [0, 0];   // tangential / normal: a point of the cone section
        o.v = Math.hypot(o.S.qvel[0], o.S.qvel[1]);
        const x = o.S.qpos[0], y = o.S.qpos[1];
        o.trail.push([x, y]); if (o.trail.length > 300) o.trail.shift();
        if (Math.hypot(x, y) > 0.35) { o.S.qpos[0] = 0; o.S.qpos[1] = 0; o.S.qvel[0] = 0; o.S.qvel[1] = 0; o.S.forward(); o.trail.length = 0; }
      }
    },
    tick(dt) { ang = (ang + Math.min(dt, 0.05) * 0.35) % TAU; this.stepFor(Math.min(dt, 0.05)); },
    info() { return sims.map(o => ({ cone: o.cone, speed: o.v || 0, friction: o.f })); },
    set() {},
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const narrow = w < 520, cols = 2, cw = w / cols;
      sims.forEach((o, i) => {
        const cx = cw * i + cw / 2, R = Math.min(cw * 0.36, h * 0.27);
        label(ctx, P, o.cone === 'pyramidal' ? 'pyramidal cone (default)' : 'elliptic cone', cx, 14, P.text, 'center', 12);
        // cross-section of the cone at f_N = m g: diamond or circle, radius mu
        const cy = h * 0.36, sc = R / 0.5;
        ctx.strokeStyle = o.cone === 'pyramidal' ? P.m2 : P.m3; ctx.lineWidth = 2; ctx.beginPath();
        if (o.cone === 'pyramidal') { ctx.moveTo(cx + R, cy); ctx.lineTo(cx, cy - R); ctx.lineTo(cx - R, cy); ctx.lineTo(cx, cy + R); ctx.closePath(); }
        else ctx.arc(cx, cy, R, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - R * 1.15, cy); ctx.lineTo(cx + R * 1.15, cy); ctx.moveTo(cx, cy - R * 1.15); ctx.lineTo(cx, cy + R * 1.15); ctx.stroke();
        // push needed from friction (the applied push, reversed) and the friction the solver gave
        const px = -PUSH * Math.cos(ang), py = -PUSH * Math.sin(ang);
        ctx.strokeStyle = P.dim; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + px * sc, cy - py * sc); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = P.m5; ctx.beginPath(); ctx.arc(cx + o.f[0] * sc, cy - o.f[1] * sc, 4, 0, TAU); ctx.fill();
        // top view of the box with its trail
        const V = view(cx, h * 0.8, R * 0.3 / 0.12);
        ctx.strokeStyle = P.m1; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath();
        o.trail.forEach(([x, y], k) => k ? ctx.lineTo(V.X(x), V.Y(y)) : ctx.moveTo(V.X(x), V.Y(y))); ctx.stroke(); ctx.globalAlpha = 1;
        drawGeoms(ctx, o.S, V, P, { axes: 'xy', colors: () => (o.v > 0.02 ? P.m2 : P.m1) });
        const bx = o.S.qpos[0], by = o.S.qpos[1], al = 0.1;
        ctx.strokeStyle = P.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(V.X(bx), V.Y(by)); ctx.lineTo(V.X(bx + al * Math.cos(ang)), V.Y(by + al * Math.sin(ang))); ctx.stroke();
        label(ctx, P, o.v > 0.02 ? `slides, ${(o.v * 100).toFixed(1)} cm/s` : 'sticks', cx, h - 12, o.v > 0.02 ? P.m2 : P.m3, 'center', 12);
      });
      label(ctx, P, `push at ${(ang * 180 / Math.PI).toFixed(0)}°`, w / 2, h * 0.8, P.dim, 'center', 11);
    },
    dispose() { for (const o of sims) o.S.dispose(); },
  };
  return F;
}

// ── 6. solvers: convergence on one stacked state ───────────────────────────
export function stackXML(seed = 1, n = 5) {
  let r = seed >>> 0; const rnd = () => { r = (r + 0x6D2B79F5) >>> 0; let t = r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let s = '<mujoco model="explain-stack"><option timestep="0.002"/><worldbody><geom type="plane" size="2 2 .1" rgba=".3 .35 .4 1"/>';
  for (let i = 0; i < n; i++) {
    const hx = 0.05 + 0.03 * rnd(), x = (rnd() - 0.5) * 0.04, yaw = (rnd() - 0.5) * 0.6;
    s += `<body pos="${x.toFixed(4)} ${((rnd() - 0.5) * 0.04).toFixed(4)} ${(0.05 + 0.101 * i).toFixed(4)}" euler="0 0 ${yaw.toFixed(3)}"><freejoint/><geom type="box" size="${hx.toFixed(3)} ${(0.05 + 0.02 * rnd()).toFixed(3)} 0.05" rgba="${(0.4 + 0.5 * rnd()).toFixed(2)} ${(0.5 + 0.3 * rnd()).toFixed(2)} 0.9 1"/></body>`;
  }
  return s + '</worldbody></mujoco>';
}
// For each solver: improvement per iteration from one cold mj_forward.
export function convergence(mj, seed = 1) {
  const S = createSim(mj, { xml: stackXML(seed), name: 'stack' });
  const out = { seed, nefc: 0, runs: [] };
  try {
    S.step(60);   // falling into contact: an active, unsettled state
    const st = S.getState();
    const WS = mj.mjtDisableBit.mjDSBL_WARMSTART.value;
    S.m.opt.disableflags |= WS;
    for (const solver of ['PGS', 'CG', 'Newton']) {
      S.setState(st); S.setOptions({ solver, iterations: 200, tolerance: 1e-15 });
      const t0 = performance.now(); let reps = 0;
      do { S.setState(st); S.forward(); reps++; } while (performance.now() - t0 < 4 && reps < 50);
      const us = (performance.now() - t0) / reps * 1000;
      const n = S.d.solver_niter[0], sv = S.d.solver, imp = [];
      for (let i = 0; i < Math.min(n, 200); i++) { imp.push(sv.get(i).improvement); }
      out.runs.push({ solver, niter: n, improvement: imp, us });
      out.nefc = S.d.nefc;
    }
  } finally { S.dispose(); }
  return out;
}
function figSolvers(mj) {
  let C = convergence(mj, 1), seed = 1;
  return {
    reseed() { seed++; C = convergence(mj, seed); },
    tick() {}, set(k) { if (k === 'reseed') this.reseed(); }, info() { return C; },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const col = { PGS: P.m2, CG: P.m4, Newton: P.m3 };
      const xmax = Math.max(10, ...C.runs.map(r => r.improvement.length));
      const series = C.runs.map(r => ({ pts: r.improvement.map((v, i) => [i + 1, v > 0 ? Math.log10(v) : NaN]), color: col[r.solver], name: `${r.solver}: ${r.niter} it, ${r.us.toFixed(0)} µs` }));
      const box = [54, 16, w - 70, h - 62];
      plot(ctx, P, box, series, { xr: [1, Math.min(200, xmax)], yr: [-16, 0], xlabel: `iteration (stack seed ${C.seed}, ${C.nefc} constraint rows, cold start)`, ylabel: 'improvement (log)',
        yticks: [0, -4, -8, -12, -16].map(v => [v, '1e' + v]) });
    },
    dispose() {},
  };
}

// ── 7. integrators: energy drift on the double pendulum ────────────────────
export function energyRun(mj, integrator, dt, T = 10) {
  const S = createSim(mj, { xml: PENDULUM(), name: 'pend-' + integrator });
  try {
    S.setOptions({ integrator, timestep: dt });
    S.qpos[0] = 1.8; S.qpos[1] = 0.6; S.forward();
    const e0 = S.energy(), E0 = e0[0] + e0[1], pts = [];
    const scale = S.totalMass() * 9.81 * 0.5;   // m g l: the size of the energies (J)
    const every = Math.max(1, Math.round(0.02 / dt));
    let i = 0;
    while (S.time < T - 1e-9) { S.step(1); if (++i % every === 0) { const e = S.energy(); pts.push([S.time, Math.abs(e[0] + e[1] - E0) / scale]); } }
    return { integrator, dt, pts, final: pts[pts.length - 1][1], max: Math.max(...pts.map(p => p[1])) };
  } finally { S.dispose(); }
}
function figIntegrators(mj, { dt = 0.002 } = {}) {
  const names = ['Euler', 'implicitfast', 'implicit', 'RK4'];
  let runs = {}, st = { dt }, k = 0;
  const run = () => { runs = {}; k = 0; };
  return {
    controls: [{ key: 'dt', label: 'timestep (ms)', min: 1, max: 10, step: 1, value: dt * 1000, scale: 0.001 }],
    set(key, v) { if (key === 'dt') { st.dt = +v; run(); } },
    // one integrator per tick, so the page stays smooth
    tick() { if (k < names.length) { runs[names[k]] = energyRun(mj, names[k], st.dt); k++; } },
    done() { return k >= names.length; },
    info() { return { dt: st.dt, runs: names.filter(n => runs[n]).map(n => ({ integrator: n, final: runs[n].final, max: runs[n].max })) }; },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const col = { Euler: P.m2, implicitfast: P.m4, implicit: P.m6, RK4: P.m3 };
      const series = names.filter(n => runs[n]).map(n => ({ pts: runs[n].pts.map(([t, e]) => [t, e > 0 ? Math.log10(e) : NaN]), color: col[n], name: `${n}: ${runs[n].max.toExponential(1)}`, dash: n === 'implicit' ? [5, 3] : n === 'implicitfast' ? [2, 3] : null, width: n === 'Euler' ? 3.5 : 1.6 }));
      plot(ctx, P, [54, 16, w - 70, h - 62], series, { xr: [0, 10], yr: [-8, 1], xlabel: `time (s), timestep ${(st.dt * 1000).toFixed(0)} ms, no damping`, ylabel: '|E − E0| / (m g l)',
        yticks: [0, -2, -4, -6, -8].map(v => [v, '1e' + v]) });
      if (k < names.length) label(ctx, P, `running ${names[k]}…`, 64, 30, P.dim, 'left', 11);
    },
    dispose() {},
  };
}

// ── 8. actuators, equality, tendon ─────────────────────────────────────────
export const MECH = `<mujoco model="explain-mech"><option timestep="0.002"/>
  <default><joint type="hinge" axis="0 1 0" damping="0.05"/><geom contype="0" conaffinity="0" density="600"/></default>
  <worldbody>
    <site name="p1" pos="0.1 0 0.9" size="0.02"/><site name="p2" pos="0.4 0 0.9" size="0.02"/>
    <geom type="cylinder" pos="0.1 0 0.9" size="0.025 0.01" euler="90 0 0" rgba=".5 .55 .6 1"/>
    <geom type="cylinder" pos="0.4 0 0.9" size="0.025 0.01" euler="90 0 0" rgba=".5 .55 .6 1"/>
    <body name="armA" pos="-0.45 0 0.62"><joint name="drive" range="-86 86"/>
      <geom type="capsule" fromto="0 0 0 0.3 0 0" size="0.022" rgba=".38 .77 1 1"/><site name="tipA" pos="0.3 0 0" size="0.015"/></body>
    <body name="armB" pos="-0.45 0 0.04"><joint name="mirror"/>
      <geom type="capsule" fromto="0 0 0 0.3 0 0" size="0.022" rgba=".66 .64 1 1"/></body>
    <body name="weight" pos="0.4 0 0.3"><joint name="lift" type="slide" axis="0 0 1" range="-0.05 0.45" limited="true" damping="1"/>
      <geom type="box" size="0.04 0.04 0.04" mass="0.3" rgba="1 .84 .4 1"/><site name="hook" pos="0 0 0.04" size="0.01"/></body>
  </worldbody>
  <tendon><spatial name="rope" limited="true" range="0 1.24" width="0.004" rgba=".9 .9 .9 1"><site site="tipA"/><site site="p1"/><site site="p2"/><site site="hook"/></spatial></tendon>
  <equality><joint name="couple" joint1="mirror" joint2="drive" polycoef="0 -1 0 0 0"/></equality>
  <actuator><position name="servo" joint="drive" kp="40" kv="1" ctrlrange="-1.3 1.3"/></actuator>
  <sensor><jointpos name="angle" joint="drive"/><actuatorfrc name="torque" actuator="servo"/><tendonpos name="rope length" tendon="rope"/><jointpos name="lift" joint="lift"/></sensor>
</mujoco>`;
function figActuators(mj) {
  const S = createSim(mj, { xml: MECH, name: 'mech' });
  const sid = n => S.mj.mj_name2id(S.m, S.mj.mjtObj.mjOBJ_SITE.value, n);
  const sites = ['tipA', 'p1', 'p2', 'hook'].map(sid);
  let t = 0;
  return {
    tick(dt) { dt = Math.min(dt, 0.05); t += dt; S.setCtrl('servo', 1.2 * Math.sin(0.9 * t)); S.advance(dt); },
    info() { const s = {}; for (const x of S.sensors()) s[x.name] = x.value[0]; return { ctrl: S.d.ctrl[0], q: [S.qpos[0], S.qpos[1], S.qpos[2]], sensors: s, ten: S.d.ten_length[0] }; },
    set() {},
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const narrow = w < 520, side = narrow ? w : w * 0.6;
      const sc = Math.min(side / 1.35, h / 1.05) * 0.95, V = view(side / 2 + 0.12 * sc, h * 0.97, sc);
      const sx = S.d.site_xpos;
      // target pose of the servo, faint
      const c = S.d.ctrl[0];
      ctx.strokeStyle = P.m1; ctx.globalAlpha = 0.3; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath();
      ctx.moveTo(V.X(-0.45), V.Y(0.62)); ctx.lineTo(V.X(-0.45 + 0.3 * Math.cos(c)), V.Y(0.62 - 0.3 * Math.sin(c))); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      // rope
      ctx.strokeStyle = S.d.ten_length[0] > 1.239 ? P.m5 : P.dim; ctx.lineWidth = 1.5; ctx.beginPath();
      sites.forEach((s, i) => { const x = sx[3 * s], z = sx[3 * s + 2]; i ? ctx.lineTo(V.X(x), V.Y(z)) : ctx.moveTo(V.X(x), V.Y(z)); }); ctx.stroke();
      drawGeoms(ctx, S, V, P);
      label(ctx, P, 'servo', V.X(-0.5), V.Y(0.62), P.m1, 'right', 11);
      label(ctx, P, 'equality', V.X(-0.5), V.Y(0.04), P.m6, 'right', 11);
      label(ctx, P, 'rope tendon', V.X(0.25), V.Y(0.97), P.dim, 'center', 11);
      const I = this.info(), x0 = narrow ? 16 : side + 10, y0 = narrow ? 18 : h * 0.25, lh = 18;
      const rows = [['target', I.ctrl, 'rad'], ['angle', I.sensors.angle, 'rad'], ['torque', I.sensors.torque, 'N m'], ['rope length', I.sensors['rope length'], 'm'], ['lift', I.sensors.lift, 'm']];
      if (!narrow) rows.forEach(([n, v, u], i) => label(ctx, P, `${n}: ${(+v).toFixed(3)} ${u}`, x0, y0 + i * lh, i ? P.text : P.m1, 'left', 12));
      else label(ctx, P, `target ${I.ctrl.toFixed(2)}  angle ${I.sensors.angle.toFixed(2)}  torque ${I.sensors.torque.toFixed(2)} N m`, x0, y0, P.text, 'left', 11);
    },
    dispose() { S.dispose(); },
  };
}

// ── 9. sensors: a ball on a touch pad ──────────────────────────────────────
export const PAD = `<mujoco model="explain-sensors"><option timestep="0.001"/>
  <worldbody><geom type="plane" size="1 1 .1" rgba=".3 .35 .4 1"/>
    <body name="pad" pos="0 0 0.01"><geom type="box" size="0.12 0.12 0.01" rgba=".5 .55 .6 1"/><site name="padsite" type="box" size="0.12 0.12 0.03" pos="0 0 0.02"/></body>
    <body name="ball" pos="0 0 0.5"><freejoint/><geom type="sphere" size="0.05" mass="0.2" solref="-4000 -3" rgba=".38 .77 1 1"/><site name="imu" size="0.01"/></body>
  </worldbody>
  <sensor><touch name="touch" site="padsite"/><accelerometer name="acc" site="imu"/><framepos name="pos" objtype="site" objname="imu"/></sensor>
</mujoco>`;
function figSensors(mj) {
  const S = createSim(mj, { xml: PAD, name: 'pad' });
  const hist = []; let since = 0;
  const drop = () => { S.reset(); S.qpos[0] = (Math.random() - 0.5) * 0.08; S.forward(); since = 0; };
  return {
    tick(dt) {
      dt = Math.min(dt, 0.05); S.advance(dt); since += dt; if (since > 3.2) drop();
      const s = {}; for (const x of S.sensors()) s[x.name] = x.value;
      hist.push([S.time, s.pos[2], s.touch[0], s.acc[2]]); while (hist.length && hist[0][0] < S.time - 4) hist.shift();
    },
    info() { const s = {}; for (const x of S.sensors()) s[x.name] = Array.from(x.value); return s; },
    set() {},
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      const aw = Math.min(w * 0.3, 220), V = view(aw / 2, h * 0.86, h * 1.4);
      ground(ctx, V, P, 0, aw); drawGeoms(ctx, S, V, P);
      const t1 = hist.length ? hist[hist.length - 1][0] : 0, t0 = t1 - 4;
      const rows = [['height (m)', 1, P.m1, [0, 0.55]], ['touch (N)', 2, P.m5, [0, Math.max(10, ...hist.map(r => r[2]))]], ['accelerometer z (m/s²)', 3, P.m3, [Math.min(-5, ...hist.map(r => r[3])), Math.max(20, ...hist.map(r => r[3]))]]];
      const x0 = aw + 50, bh = (h - 30) / 3 - 14;
      rows.forEach(([name, k, c, yr], i) => {
        const box = [x0, 8 + i * (bh + 14), w - x0 - 12, bh];
        plot(ctx, P, box, [{ pts: hist.map(r => [r[0], r[k]]), color: c }], { xr: [t0, t1], yr, legend: false, xticks: false });
        label(ctx, P, `${name}: ${hist.length ? hist[hist.length - 1][k].toFixed(2) : '-'}`, box[0] + 6, box[1] + 10, c, 'left', 11);
      });
    },
    dispose() { S.dispose(); },
  };
}

// ── 10. speed: a live step-time benchmark ──────────────────────────────────
export function benchmark(mj, budgetMs = 60) {
  const cases = [
    { name: 'double pendulum, 2 dofs', xml: PENDULUM() },
    { name: 'chain of 40 links, 40 dofs', xml: chainXML(40) },
    { name: 'stack of 5 boxes, 30 dofs + contacts', xml: stackXML(3), pre: 60 },
  ];
  return cases.map(c => {
    const S = createSim(mj, { xml: c.xml, name: c.name });
    try {
      if (c.pre) S.step(c.pre);
      let n = 0; const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) { S.step(20); n += 20; }
      const ms = (performance.now() - t0) / n;
      return { name: c.name, nv: S.nv, usPerStep: ms * 1000, stepsPerSec: 1000 / ms, realtime: S.m.opt.timestep / (ms / 1000) };
    } finally { S.dispose(); }
  });
}
function figSpeed(mj) {
  let R = null;
  return {
    tick() { if (!R) R = benchmark(mj); }, set(k) { if (k === 'rerun') R = benchmark(mj); }, info() { return R; },
    draw(ctx, w, h, P) {
      clear(ctx, w, h, P);
      if (!R) { label(ctx, P, 'measuring…', 16, h / 2, P.dim); return; }
      const x0 = 16, bw = w - 32, top = Math.max(...R.map(r => Math.log10(r.stepsPerSec)));
      R.forEach((r, i) => {
        const y = 22 + i * ((h - 30) / R.length);
        label(ctx, P, r.name, x0, y, P.text, 'left', 12);
        const len = Math.max(4, bw * 0.7 * Math.log10(r.stepsPerSec) / Math.max(1, top));
        ctx.fillStyle = [P.m1, P.m4, P.m2][i]; ctx.fillRect(x0, y + 10, len, 12);
        label(ctx, P, `${Math.round(r.stepsPerSec).toLocaleString('en-US')} steps/s, ${r.usPerStep.toFixed(1)} µs, ${r.realtime.toFixed(0)}× real time`, x0 + len + 8, y + 16, P.dim, 'left', 11);
      });
    },
    dispose() {},
  };
}

// id -> figure. `height` is the canvas CSS height on a wide screen.
export const FIGS = {
  coords: { make: figCoords, height: 300, live: true, caption: 'A double pendulum in MuJoCo: two hinge angles describe it fully. The mass matrix M(q) comes live from mj_fullM.' },
  chain: { make: figChain, height: 260, live: true, caption: 'The same chain in two formulations. Move the slider: MuJoCo solves for one number for each link; a maximal-coordinate engine solves for six, plus five constraint rows that hold each joint together.' },
  contact: { make: figContact, height: 260, live: true, caption: 'A 1 kg ball dropped on the floor. solref sets the spring-damper of the contact: a short time constant is stiff, a low damping ratio bounces. The ball sinks a little into the floor: that overlap is the soft constraint.' },
  impedance: { make: figImpedance, height: 220, live: false, caption: 'solimp shapes the impedance d(r): from d₀ at zero violation to d_w at r = width, along a sigmoid set by midpoint and power. A larger d makes the constraint harder.' },
  cones: { make: figCones, height: 330, live: true, caption: 'The same push (0.42 m g, μ = 0.5) turns slowly around two boxes. The elliptic cone holds in every direction. The pyramidal cone is a square in the tangent plane, so it holds along its edges and lets go near the diagonals.' },
  solvers: { make: figSolvers, height: 260, live: false, caption: 'One cold solve of a falling stack, with no warm start: the cost improvement at each iteration. Newton takes few, expensive steps; PGS takes many cheap ones.' },
  integrators: { make: figIntegrators, height: 260, live: false, caption: 'Energy error of an undamped double pendulum over 10 s, on a log scale. RK4 keeps energy to many digits; the first-order methods drift. With no damping, implicitfast gives the same steps as Euler: it makes only the velocity-dependent forces implicit, and it leaves out the Coriolis terms. A smaller timestep helps all of them.' },
  actuators: { make: figActuators, height: 280, live: true, caption: 'A position servo drives the blue arm. An equality constraint mirrors the purple arm. A spatial tendon over two pulleys acts as a rope: it pulls only when it is at its maximum length, then it lifts the weight.' },
  sensors: { make: figSensors, height: 260, live: true, caption: 'A ball falls on a pad. The touch sensor reads the normal force in the pad site; the accelerometer reads the specific force (gravity shows as +9.81 m/s² at rest).' },
  speed: { make: figSpeed, height: 150, live: false, caption: 'Measured now, on this device, in WebAssembly on one thread.' },
};

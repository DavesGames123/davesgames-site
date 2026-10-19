// ============================================================================
//  POOL PHYSICS  ·  view/diagram.js — the 2D top-down diagram (canvas 2D)
// ----------------------------------------------------------------------------
//  A flat, Manim-like drawing of the table from above: the felt, the rails
//  with their diamonds, the pockets, the balls, then the maths on top: the
//  construction items of the current shot (lines that draw themselves,
//  angle arcs that sweep, labels that fade in), the live velocity and
//  acceleration arrows, and the components of v on the line of centres.
//  It uses only the plain canvas 2D API (no filters; the felt image is an
//  option), so a recording context in node can draw the home thumbnail.
//
//  createDiagram(T) -> D
//    D.layout(w, h, rot, pad, ox, oy, opt)  fit the table into w x h px;
//                               rot: the long axis up the screen; D.inset:
//                               the contact zoom box, fixed bottom right
//    D.X(x, y), D.Y(x, y)       table metres to px; D.toWorld(px, py)
//    D.draw(ctx, F)             one frame. F: see "function draw"
//    D.drawInset(ctx, F)        the contact zoom alone (the saver)
//    D.decal(n, q)              ball n's decal directions for orientation q
//    D.setFelt(img)             the felt scan as a pattern on the cloth
//  The balls roll: the numbers, the stripe band and the cue ball dots turn
//  with the physics orientation (core/physics.js S.q, the same decal as
//  the 3D balls). The cue (F.cue.pose, core/cue.js) casts a shadow offset
//  by its height, so a lifted butt reads as lifted.
//  Item kinds of the construction: line, arrow, circle, ring, angle, right,
//  overlap, tip, mark, dot, stroke (aimed vs observed; core/shot.js makes
//  them).
//
//  grep -n targets: "export const MC", "D.layout = ", "function table",
//  "function baseDir", "function capPath", "function ball", "function item",
//  "case 'stroke'", "function live", "function draw", "function lens"
// ============================================================================
import { diamonds, ballColor, isStripe, cushionPolys } from '../core/table.js';

export const MC = { m1: '#62c4ff', m2: '#ff9a62', m3: '#86dc7c', m4: '#e889dc', m5: '#ffd666', m6: '#a8a4ff' };
export const STYLES = {
  felt: { bg: '#0b1712', cloth: '#14603f', clothLine: 'rgba(255,255,255,0.10)', cushion: '#0f5235', rail: '#3a2416', railEdge: '#5a3a22', pocket: '#050807', ink: '#eef3ee', dim: 'rgba(238,243,238,0.55)', diamond: '#e9e2cf', string: 'rgba(255,255,255,0.22)' },
  chalk: { bg: '#101418', cloth: '#131a20', clothLine: 'rgba(255,255,255,0.18)', cushion: '#161f27', rail: '#101418', railEdge: 'rgba(255,255,255,0.28)', pocket: '#000000', ink: '#f1f4f7', dim: 'rgba(241,244,247,0.55)', diamond: 'rgba(255,255,255,0.7)', string: 'rgba(255,255,255,0.22)' },
};
const ease = p => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));   // Manim "smooth"

export function createDiagram(T) {
  const D = { T, s: 1, cx: 0, cy: 0, rot: false, w: 1, h: 1 };
  const outerX = T.hx + T.spec.cushionW + T.spec.railW, outerY = T.hy + T.spec.cushionW + T.spec.railW;
  const polys = cushionPolys(T), dia = diamonds(T);
  // The table fit, and the fixed contact inset in the bottom-right corner
  // (the user: "put the ball visualization to see overlap in the bottom
  // right corner ... and make sure it stays in one place"). The table moves
  // up (or left) to leave the inset free when that costs less than 28 % of
  // its size; else the inset sits over the bottom-right corner of the rail.
  // opt: { inset: false } for no inset; { min, max } its size range in px;
  // { insetBox: { x, y, size } } an inset outside the table region (saver).
  D.layout = (w, h, rot = false, pad = 8, ox = 0, oy = 0, opt = {}) => {
    D.w = w; D.h = h; D.rot = rot; D.x0 = ox; D.y0 = oy;
    const ex = rot ? 2 * outerY : 2 * outerX, ey = rot ? 2 * outerX : 2 * outerY;
    const fit = (W, H) => Math.max(1e-3, Math.min((W - 2 * pad) / ex, (H - 2 * pad) / ey));
    const base = fit(w, h);
    D.s = base; D.cx = ox + w / 2; D.cy = oy + h / 2; D.inset = null;
    if (opt.insetBox) { D.inset = Object.assign({ where: 'outside' }, opt.insetBox); return; }
    if (opt.inset === false) return;
    const sz = Math.round(Math.max(opt.min || 96, Math.min(opt.max || 260, Math.min(w, h) * 0.36)));
    const below = fit(w, h - sz - pad), right = fit(w - sz - pad, h);
    let where = below >= right ? 'below' : 'right', s = Math.max(below, right);
    if (s < base * 0.72) { where = 'over'; s = base; }
    D.s = s;
    if (where === 'below') D.cy = oy + (h - sz - pad) / 2;
    else if (where === 'right') D.cx = ox + (w - sz - pad) / 2;
    D.inset = { x: ox + w - sz - pad, y: oy + h - sz - pad, size: sz, where };
  };
  D.X = (x, y) => (D.rot ? D.cx - y * D.s : D.cx + x * D.s);
  D.Y = (x, y) => (D.rot ? D.cy - x * D.s : D.cy - y * D.s);
  D.toWorld = (px, py) => (D.rot ? [(D.cy - py) / D.s, (D.cx - px) / D.s] : [(px - D.cx) / D.s, (D.cy - py) / D.s]);
  D.ang = a => (D.rot ? -a - Math.PI / 2 : -a);   // a table angle to a screen angle
  D.outer = { x: outerX, y: outerY };

  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(D.X(x, y), D.Y(x, y)) : ctx.moveTo(D.X(x, y), D.Y(x, y))));
    ctx.closePath();
  }
  function rect(ctx, x0, y0, x1, y1) { poly(ctx, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); }
  let feltPat = null, feltCtx = null;
  D.setFelt = img => { D.feltImg = img; feltPat = null; };

  function table(ctx, F, st) {
    const d = F.dpr || 1;
    ctx.fillStyle = st.rail; rect(ctx, -outerX, -outerY, outerX, outerY); ctx.fill();
    ctx.strokeStyle = st.railEdge; ctx.lineWidth = 1.2 * d; ctx.stroke();
    ctx.fillStyle = st.cloth; rect(ctx, -T.hx - T.spec.cushionW, -T.hy - T.spec.cushionW, T.hx + T.spec.cushionW, T.hy + T.spec.cushionW); ctx.fill();
    // the felt scan (artwork/felt-color.jpg) over the cloth, when the page gave it
    if (F.style !== 'chalk' && D.feltImg) {
      try {
        if (!feltPat || feltCtx !== ctx) { feltPat = ctx.createPattern(D.feltImg, 'repeat'); feltCtx = ctx; }
        if (feltPat) {
          const k = 0.3 * D.s / (D.feltImg.width || 512);
          if (feltPat.setTransform && typeof DOMMatrix !== 'undefined') feltPat.setTransform(new DOMMatrix([k, 0, 0, k, D.cx, D.cy]));
          ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5; ctx.fillStyle = feltPat;
          rect(ctx, -T.hx - T.spec.cushionW, -T.hy - T.spec.cushionW, T.hx + T.spec.cushionW, T.hy + T.spec.cushionW); ctx.fill(); ctx.restore();
        }
      } catch (e) { feltPat = null; }
    }
    for (const p of T.pockets) { ctx.fillStyle = st.pocket; ctx.beginPath(); ctx.arc(D.X(p.hx, p.hy), D.Y(p.hx, p.hy), p.r * D.s, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillStyle = st.cushion;
    for (const q of polys) { poly(ctx, q); ctx.fill(); }
    // the nose lines and the jaws
    ctx.strokeStyle = st.clothLine; ctx.lineWidth = 1 * d; ctx.beginPath();
    for (const s of T.segs) { ctx.moveTo(D.X(s.ax, s.ay), D.Y(s.ax, s.ay)); ctx.lineTo(D.X(s.bx, s.by), D.Y(s.bx, s.by)); }
    ctx.stroke();
    // diamonds
    ctx.fillStyle = st.diamond;
    const k = 0.012 * D.s;
    for (const q of dia) {
      const X = D.X(q.x, q.y), Y = D.Y(q.x, q.y);
      ctx.beginPath(); ctx.moveTo(X, Y - k); ctx.lineTo(X + k * 0.6, Y); ctx.lineTo(X, Y + k); ctx.lineTo(X - k * 0.6, Y); ctx.closePath(); ctx.fill();
    }
    // head string, foot spot, the kitchen when the cue ball is in hand there
    if (F.kitchen) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; rect(ctx, -T.hx, -T.hy, T.headX, T.hy); ctx.fill(); }
    ctx.strokeStyle = st.string; ctx.lineWidth = 1 * d; ctx.setLineDash([4 * d, 5 * d]);
    ctx.beginPath(); ctx.moveTo(D.X(T.headX, -T.hy), D.Y(T.headX, -T.hy)); ctx.lineTo(D.X(T.headX, T.hy), D.Y(T.headX, T.hy)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = st.string;
    for (const x of [T.footX, T.headX]) { ctx.beginPath(); ctx.arc(D.X(x, 0), D.Y(x, 0), 2 * d, 0, 2 * Math.PI); ctx.fill(); }
  }

  // Small text stays crisp on Android: draw it large and scale it down.
  function text(ctx, s, X, Y, px, color, { italic = true, align = 'center', base = 'middle', alpha = 1 } = {}) {
    if (!s) return;
    const big = 40, k = px / big;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(X, Y); ctx.scale(k, k);
    ctx.font = `${italic ? 'italic ' : ''}${big}px 'STIX Two Text', 'Times New Roman', serif`;
    ctx.textAlign = align; ctx.textBaseline = base;
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(s, 0, 0);
    ctx.fillStyle = color; ctx.fillText(s, 0, 0);
    ctx.restore();
  }
  D.text = text;

  // ── the ball decal, turned by the ball's orientation ──────────────────────
  // The 3D decal (view/scene3d.js ballTexture) in the table frame: two
  // number spots, the stripe band round the pole axis, the red dots of the
  // cue ball. A rest orientation qBase (number up, turned by n x 2.4 rad
  // about the vertical), then the physics orientation q (core/physics.js
  // integrates w: rolling, sliding and spin all turn it). The top view drops
  // z: a point of the upper half shows at the centre + R (x, y).
  const TAU = 2 * Math.PI;
  function baseDir(n, lx, ly, lz) {
    const be = (n * 2.39996) % TAU, cb = Math.cos(be), sb = Math.sin(be);
    const x = lx, y = lz, z = -ly;                      // Rx(-90 deg)
    const X = x * cb + z * sb, Z = -x * sb + z * cb;     // Ry(be)
    return [X, -Z, y];                                   // three -> table
  }
  const sph = (u, v) => { const ph = u * TAU, th = v * Math.PI; return [-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)]; };
  const DECAL = [];
  for (let n = 0; n < 16; n++) {
    const d = { spots: [], dots: [] };
    if (n > 0) {
      // the spots at u = 0.25 and 0.75 of the decal: right is +u, up is the pole (local y)
      d.spots.push({ c: baseDir(n, 0, 0, 1), right: baseDir(n, 1, 0, 0), up: baseDir(n, 0, 1, 0) });
      d.spots.push({ c: baseDir(n, 0, 0, -1), right: baseDir(n, -1, 0, 0), up: baseDir(n, 0, 1, 0) });
    } else for (const [u, v] of [[64, 128], [192, 128], [320, 128], [448, 128], [128, 40], [384, 216], [0, 0]]) d.dots.push(baseDir(0, ...sph(u / 512, v / 256)));
    d.pole = baseDir(n, 0, 1, 0);
    DECAL.push(d);
  }
  // v rotated by the unit quaternion q = [w, x, y, z] (table frame)
  function rot(q, v) {
    if (!q) return v;
    const [w, x, y, z] = q, [a, b, c] = v;
    const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
    return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
  }
  // the decal directions of ball n with orientation q (tests: decal rotation)
  D.decal = (n, q) => {
    const d = DECAL[n];
    return { spots: d.spots.map(s => ({ c: rot(q, s.c), right: rot(q, s.right), up: rot(q, s.up) })), dots: d.dots.map(v => rot(q, v)), pole: rot(q, d.pole) };
  };
  // the visible part of the cap {p . a > s} on the upper half, as a screen polygon
  function capPath(ctx, X, Y, r, a, s, k = 36) {
    const rho = Math.sqrt(Math.max(0, 1 - s * s));
    // a basis of the plane normal to a
    const t = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1 = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]];
    const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1);
    const e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
    let vis = 0;
    const pts = [];
    for (let i = 0; i < k; i++) {
      const c = Math.cos(i / k * TAU), sn = Math.sin(i / k * TAU);
      let px = s * a[0] + rho * (c * e1[0] + sn * e2[0]), py = s * a[1] + rho * (c * e1[1] + sn * e2[1]);
      const pz = s * a[2] + rho * (c * e1[2] + sn * e2[2]);
      if (pz < 0) { const l = Math.hypot(px, py) || 1; px /= l; py /= l; } else vis++;
      pts.push([px, py]);
    }
    ctx.beginPath();
    if (!vis) {
      // the whole circle is behind: the cap covers the upper half or nothing
      if (a[2] > s) { ctx.arc(X, Y, r, 0, TAU); return true; }
      return false;
    }
    pts.forEach(([px, py], i) => { const sx = X + (D.X(px, py) - D.X(0, 0)) * r / D.s, sy = Y + (D.Y(px, py) - D.Y(0, 0)) * r / D.s; i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.closePath();
    return true;
  }
  const STRIPE_S = Math.sin(0.203 * Math.PI), SPOT_S = Math.cos(30 / 512 * TAU);
  function ball(ctx, n, x, y, F, alpha = 1, q = null) {
    const X = D.X(x, y), Y = D.Y(x, y), r = T.R * D.s, d = F.dpr || 1;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(X + r * 0.12, Y + r * 0.16, r, 0, TAU); ctx.fill();
    const col = ballColor(n), dec = D.decal(n, q);
    ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU);
    ctx.fillStyle = isStripe(n) ? col : n === 0 ? '#f4f1e8' : col; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.clip();
    if (isStripe(n)) {
      // the two white caps beyond the stripe band
      ctx.fillStyle = '#f4f1e8';
      for (const sg of [1, -1]) if (capPath(ctx, X, Y, r, dec.pole.map(v => v * sg), STRIPE_S, 30)) ctx.fill();
    }
    if (n > 0 && r > 3 * d) for (const sp of dec.spots) {
      if (sp.c[2] < -0.37) continue;
      ctx.fillStyle = '#f7f4ea';
      if (capPath(ctx, X, Y, r, sp.c, SPOT_S, 18)) ctx.fill();
      if (sp.c[2] > 0.2 && r > 5 * d) {
        // the number in the tangent plane of the spot, projected (it turns and squashes as the ball rolls)
        const g = 0.36 * r, sc = (vx, vy) => [(D.X(vx, vy) - D.X(0, 0)) / D.s * g, (D.Y(vx, vy) - D.Y(0, 0)) / D.s * g];
        const [rx, ry] = sc(sp.right[0], sp.right[1]), [ux, uy] = sc(-sp.up[0], -sp.up[1]);
        const [cx, cy] = sc(sp.c[0] / 0.36, sp.c[1] / 0.36);
        ctx.save();
        ctx.transform(rx / 20, ry / 20, ux / 20, uy / 20, X + cx, Y + cy);
        ctx.fillStyle = '#111'; ctx.font = `bold ${n > 9 ? 22 : 26}px Inter, Helvetica, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(n), 0, 1.5);
        if (n === 6 || n === 9) ctx.fillRect(-6, 14, 12, 2.2);
        ctx.restore();
      }
    }
    if (n === 0) {
      ctx.fillStyle = '#c0392b';
      for (const v of dec.dots) if (v[2] > 0) { ctx.beginPath(); ctx.arc(X + (D.X(v[0], v[1]) - D.X(0, 0)) * r / D.s, Y + (D.Y(v[0], v[1]) - D.Y(0, 0)) * r / D.s, Math.max(0.8 * d, r * 0.085 * Math.sqrt(v[2])), 0, TAU); ctx.fill(); }
    }
    // a soft highlight of the lamp
    const hg = ctx.createRadialGradient(X - r * 0.35, Y - r * 0.4, 0, X - r * 0.35, Y - r * 0.4, r * 0.9);
    hg.addColorStop(0, 'rgba(255,255,255,0.32)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg; ctx.fillRect(X - r, Y - r, 2 * r, 2 * r);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.8 * d; ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  D.ball = ball;

  function arrowHead(ctx, X1, Y1, ux, uy, size) {
    ctx.beginPath(); ctx.moveTo(X1, Y1);
    ctx.lineTo(X1 - ux * size - uy * size * 0.45, Y1 - uy * size + ux * size * 0.45);
    ctx.lineTo(X1 - ux * size + uy * size * 0.45, Y1 - uy * size - ux * size * 0.45);
    ctx.closePath(); ctx.fill();
  }
  // a line from table point a to b, partly drawn (p), with an arrow head
  function seg(ctx, a, b, p, color, { width = 2, dash = false, head = false, alpha = 1, d = 1 } = {}) {
    const X0 = D.X(a[0], a[1]), Y0 = D.Y(a[0], a[1]), X1 = D.X(b[0], b[1]), Y1 = D.Y(b[0], b[1]);
    const L = Math.hypot(X1 - X0, Y1 - Y0);
    if (L < 0.5 || p <= 0) return;
    const Xe = X0 + (X1 - X0) * p, Ye = Y0 + (Y1 - Y0) * p, ux = (X1 - X0) / L, uy = (Y1 - Y0) / L;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width * d; ctx.lineCap = 'round';
    if (dash) ctx.setLineDash([6 * d, 5 * d]);
    const hs = Math.min(11 * d, L * 0.4);
    ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(head && p > 0.85 ? Xe - ux * hs * 0.8 : Xe, head && p > 0.85 ? Ye - uy * hs * 0.8 : Ye); ctx.stroke();
    ctx.setLineDash([]);
    if (head && p > 0.85) arrowHead(ctx, Xe, Ye, ux, uy, hs);
    ctx.restore();
    return { X: Xe, Y: Ye, ux, uy };
  }
  D.seg = seg;

  // the label of an item, near its end, shifted off the line (Manim FadeIn shift)
  let fontK = 1;
  function label(ctx, s, X, Y, ux, uy, color, p, d) {
    if (!s || p < 0.55) return;
    const a = ease((p - 0.55) / 0.45), off = 13 * d * fontK;
    text(ctx, s, X - uy * off + ux * 6 * d, Y + ux * off + uy * 6 * d - (1 - a) * 6 * d, 15 * d * fontK, color, { alpha: a });
  }

  function arcBetween(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  function item(ctx, it, p, alpha, F) {
    const d = F.dpr || 1, col = MC[it.m] || '#fff';
    ctx.save();
    ctx.globalAlpha *= alpha;
    switch (it.kind) {
      case 'line': case 'arrow': {
        const k = F._k || F.kv || 0.11;
        const to = it.vec ? [it.from[0] + it.vec[0] * k, it.from[1] + it.vec[1] * k] : it.to;
        const e = seg(ctx, it.from, to, ease(p), col, { width: it.thin ? 1.5 : 2.2, dash: it.dash, head: it.kind === 'arrow', d });
        if (e && it.mid) label(ctx, it.label, (D.X(it.from[0], it.from[1]) + e.X) / 2, (D.Y(it.from[0], it.from[1]) + e.Y) / 2, e.ux, e.uy, col, p, d);
        else if (e) label(ctx, it.label, e.X, e.Y, e.ux, e.uy, col, p, d);
        break;
      }
      case 'circle': {
        const X = D.X(it.at[0], it.at[1]), Y = D.Y(it.at[0], it.at[1]), r = it.r * D.s;
        ctx.strokeStyle = col; ctx.lineWidth = 1.8 * d; if (it.dash) ctx.setLineDash([5 * d, 4 * d]);
        ctx.beginPath(); ctx.arc(X, Y, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * ease(p)); ctx.stroke(); ctx.setLineDash([]);
        if (it.label) text(ctx, it.label, X + r * 0.95, Y - r * 1.2, 15 * d, col, { alpha: ease((p - 0.5) * 2) });
        break;
      }
      case 'ring': {
        const X = D.X(it.at[0], it.at[1]), Y = D.Y(it.at[0], it.at[1]), r = it.r * D.s * (1 + 0.25 * (1 - ease(p)));
        ctx.strokeStyle = col; ctx.lineWidth = 2 * d; ctx.globalAlpha *= ease(p);
        ctx.beginPath(); ctx.arc(X, Y, r, 0, 2 * Math.PI); ctx.stroke();
        break;
      }
      case 'angle': {
        const X = D.X(it.at[0], it.at[1]), Y = D.Y(it.at[0], it.at[1]), r = (F._lens && it.rl ? it.rl : it.r) * D.s;
        const a = D.ang(it.a), sweep = arcBetween(a, D.ang(it.b));
        ctx.strokeStyle = col; ctx.lineWidth = 2 * d;
        ctx.beginPath(); ctx.arc(X, Y, r, a, a + sweep * ease(p), sweep < 0); ctx.stroke();
        const m = a + sweep / 2;
        if (it.label) text(ctx, it.label, X + Math.cos(m) * (r + 13 * d), Y + Math.sin(m) * (r + 13 * d), 15 * d, col, { alpha: ease((p - 0.4) / 0.6) });
        break;
      }
      case 'right': {
        const X = D.X(it.at[0], it.at[1]), Y = D.Y(it.at[0], it.at[1]), k = 9 * d * ease(p);
        const a = D.ang(it.a), b = D.ang(it.b);
        ctx.strokeStyle = col; ctx.lineWidth = 1.3 * d;
        ctx.beginPath(); ctx.moveTo(X + Math.cos(a) * k, Y + Math.sin(a) * k);
        ctx.lineTo(X + Math.cos(a) * k + Math.cos(b) * k, Y + Math.sin(a) * k + Math.sin(b) * k);
        ctx.lineTo(X + Math.cos(b) * k, Y + Math.sin(b) * k); ctx.stroke();
        break;
      }
      case 'overlap': {
        // the cue ball corridor along d (width 2R): the part of the object ball inside it
        const [cx, cy] = it.c, [ox, oy] = it.o, [dx, dy] = it.d, R = it.r;
        const L = Math.hypot(ox - cx, oy - cy) + 3 * R, nx = -dy, ny = dx;
        const q = [[cx + nx * R - dx * 2 * R, cy + ny * R - dy * 2 * R], [cx + nx * R + dx * L, cy + ny * R + dy * L], [cx - nx * R + dx * L, cy - ny * R + dy * L], [cx - nx * R - dx * 2 * R, cy - ny * R - dy * 2 * R]];
        ctx.save();
        poly(ctx, q); ctx.clip();
        ctx.fillStyle = col; ctx.globalAlpha *= 0.42 * ease(p);
        ctx.beginPath(); ctx.arc(D.X(ox, oy), D.Y(ox, oy), R * D.s, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = col; ctx.lineWidth = 1.1 * d; ctx.setLineDash([3 * d, 4 * d]); ctx.globalAlpha *= 0.7 * ease(p);
        ctx.beginPath(); ctx.moveTo(D.X(q[0][0], q[0][1]), D.Y(q[0][0], q[0][1])); ctx.lineTo(D.X(q[1][0], q[1][1]), D.Y(q[1][0], q[1][1]));
        ctx.moveTo(D.X(q[3][0], q[3][1]), D.Y(q[3][0], q[3][1])); ctx.lineTo(D.X(q[2][0], q[2][1]), D.Y(q[2][0], q[2][1])); ctx.stroke();
        ctx.setLineDash([]);
        if (it.label) text(ctx, it.label, D.X(ox, oy) + 1.9 * R * D.s, D.Y(ox, oy) + 1.9 * R * D.s, 13 * d, col, { alpha: ease(p), italic: false });
        break;
      }
      case 'tip': {
        // the cue ball face (shooter's view) beside the ball: where the tip hits
        const r = Math.max(14 * d, 2.2 * T.R * D.s), X = D.X(it.at[0], it.at[1]) - 3.2 * r, Y = D.Y(it.at[0], it.at[1]) - 1.6 * r;
        ctx.globalAlpha *= ease(p);
        ctx.fillStyle = 'rgba(244,241,232,0.95)'; ctx.beginPath(); ctx.arc(X, Y, r, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1 * d; ctx.setLineDash([2 * d, 3 * d]);
        ctx.beginPath(); ctx.arc(X, Y, r * 0.5, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(X - r, Y); ctx.lineTo(X + r, Y); ctx.moveTo(X, Y - r); ctx.lineTo(X, Y + r); ctx.stroke();
        ctx.fillStyle = MC.m1; ctx.beginPath(); ctx.arc(X + it.a * r, Y - it.b * r, 3.2 * d, 0, 2 * Math.PI); ctx.fill();
        text(ctx, 'tip', X, Y + r + 10 * d, 12 * d, MC.m1, { italic: false });
        break;
      }
      case 'stroke': {
        // aimed (dashed) vs observed (solid) from the cue ball, and the
        // angle delta phi between them drawn wide (x k) so it can be seen
        const [cx, cy] = it.at, X = D.X(cx, cy), Y = D.Y(cx, cy);
        seg(ctx, it.at, it.aimEnd, ease(p), MC.m1, { width: 1.6, dash: true, d, alpha: 0.9 });
        const e = seg(ctx, it.at, it.obsEnd, ease(p), col, { width: 1.8, d });
        if (e && p > 0.6) { text(ctx, 'aimed', D.X(it.aimEnd[0], it.aimEnd[1]) + 10 * d, D.Y(it.aimEnd[0], it.aimEnd[1]) - 14 * d, 12 * d, MC.m1, { italic: false, alpha: ease((p - 0.6) / 0.4) }); }
        const dp = it.obs - it.aim, k = Math.max(1, Math.min(400, Math.round(0.14 / Math.max(1e-6, Math.abs(dp)))));
        const r = 0.15 * D.s, a0 = D.ang(it.aim), a1 = D.ang(it.aim + dp * k);
        ctx.strokeStyle = col; ctx.lineWidth = 2 * d; ctx.globalAlpha *= ease(p);
        ctx.beginPath(); ctx.arc(X, Y, r, a0, a1, a1 < a0); ctx.stroke();
        ctx.setLineDash([2 * d, 3 * d]); ctx.lineWidth = 1 * d;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a1) * r * 1.15, Y + Math.sin(a1) * r * 1.15); ctx.stroke(); ctx.setLineDash([]);
        const m = (a0 + a1) / 2;
        text(ctx, `${it.label}${k > 1 ? ` (arc ×${k})` : ''}`, X + Math.cos(m) * (r + 34 * d), Y + Math.sin(m) * (r + 14 * d), 13 * d, col, { italic: false });
        break;
      }
      case 'mark': {
        const X = D.X(it.at[0], it.at[1]), Y = D.Y(it.at[0], it.at[1]), k = 5 * d * ease(p);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X, Y - k); ctx.lineTo(X + k, Y); ctx.lineTo(X, Y + k); ctx.lineTo(X - k, Y); ctx.closePath(); ctx.fill();
        if (it.label) text(ctx, it.label, X + 10 * d, Y - 10 * d, 12 * d, col, { alpha: ease(p), italic: false, align: 'left' });
        break;
      }
      case 'dot': {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(D.X(it.at[0], it.at[1]), D.Y(it.at[0], it.at[1]), 3.2 * d * ease(p), 0, 2 * Math.PI); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
  D.item = item;

  // live vectors of one ball: v, a, and v on (n, t) with theta
  function live(ctx, L, F) {
    const d = F.dpr || 1, kv = F.kv || 0.11, ka = F.ka || 0.04;
    const c = L.i === 0 ? MC.m1 : MC.m2;
    const v = Math.hypot(L.vx, L.vy);
    if (v > 0.02) {
      const tip = [L.x + L.vx * kv, L.y + L.vy * kv];
      const e = seg(ctx, [L.x, L.y], tip, 1, c, { width: 2.4, head: true, d });
      if (F.labels !== false && e) text(ctx, 'v', e.X + e.ux * 10 * d, e.Y + e.uy * 10 * d, 14 * d, c);
      if (L.frame && F.components !== false) {
        const { nx, ny, tx, ty } = L.frame, vn = L.vx * nx + L.vy * ny, vt = L.vx * tx + L.vy * ty;
        seg(ctx, [L.x, L.y], [L.x + nx * vn * kv, L.y + ny * vn * kv], 1, MC.m3, { width: 1.4, dash: true, head: true, d, alpha: 0.9 });
        seg(ctx, [L.x, L.y], [L.x + tx * vt * kv, L.y + ty * vt * kv], 1, MC.m4, { width: 1.4, dash: true, head: true, d, alpha: 0.9 });
        // the projections, thin
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1 * d; ctx.setLineDash([2 * d, 3 * d]); ctx.beginPath();
        ctx.moveTo(D.X(tip[0], tip[1]), D.Y(tip[0], tip[1])); ctx.lineTo(D.X(L.x + nx * vn * kv, L.y + ny * vn * kv), D.Y(L.x + nx * vn * kv, L.y + ny * vn * kv));
        ctx.moveTo(D.X(tip[0], tip[1]), D.Y(tip[0], tip[1])); ctx.lineTo(D.X(L.x + tx * vt * kv, L.y + ty * vt * kv), D.Y(L.x + tx * vt * kv, L.y + ty * vt * kv));
        ctx.stroke(); ctx.restore();
        if (F.labels !== false && v * kv * D.s > 30 * d) {
          const r = Math.min(0.6, v * kv) * 0.45;
          item(ctx, { kind: 'angle', at: [L.x, L.y], a: Math.atan2(ny * Math.sign(vn || 1), nx * Math.sign(vn || 1)), b: Math.atan2(L.vy, L.vx), r, m: 'm5', label: 'θ' }, 1, 0.9, F);
        }
      }
    }
    const a = Math.hypot(L.ax, L.ay);
    if (a > 0.02 && F.accel !== false) {
      const e = seg(ctx, [L.x, L.y], [L.x + L.ax * ka, L.y + L.ay * ka], 1, MC.m6, { width: 2, head: true, d });
      if (F.labels !== false && e && a * ka * D.s > 14 * d) text(ctx, 'a', e.X + e.ux * 9 * d, e.Y + e.uy * 9 * d, 13 * d, MC.m6);
    }
  }

  // F: { dpr, style, balls: [{ n, x, y, alpha }], trails: [{ n, pts }], paths:
  //   [{ n, pts, alpha }] (predicted), items: [{ it, p, alpha }], live: [...],
  //   pick: { legal: [n], sel: n, pocket: id }, kitchen, cueLine }
  function draw(ctx, F) {
    const st = STYLES[F.style] || STYLES.felt, d = F.dpr || 1;
    if (F.clear !== false) { ctx.fillStyle = st.bg; ctx.fillRect(F.x0 || 0, F.y0 || 0, D.w, D.h); }
    table(ctx, F, st);
    // trails of this shot
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const tr of F.trails || []) {
      if (tr.pts.length < 4) continue;
      ctx.strokeStyle = tr.n === 0 ? MC.m1 : ballColor(tr.n) === '#121212' ? '#9aa' : ballColor(tr.n);
      ctx.globalAlpha = 0.38 * (tr.alpha ?? 1); ctx.lineWidth = 1.6 * d;
      ctx.beginPath();
      for (let k = 0; k < tr.pts.length; k += 2) { const X = D.X(tr.pts[k], tr.pts[k + 1]), Y = D.Y(tr.pts[k], tr.pts[k + 1]); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // predicted paths (the planner and the AI's chosen shot), dashed
    for (const pa of F.paths || []) {
      if (pa.pts.length < 4) continue;
      ctx.strokeStyle = pa.n === 0 ? MC.m1 : MC.m2; ctx.globalAlpha = 0.8 * (pa.alpha ?? 1); ctx.lineWidth = 1.6 * d; ctx.setLineDash([5 * d, 5 * d]);
      ctx.beginPath();
      for (let k = 0; k < pa.pts.length; k += 3) { const X = D.X(pa.pts[k], pa.pts[k + 1]), Y = D.Y(pa.pts[k], pa.pts[k + 1]); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]);
      if (pa.end) { const X = D.X(pa.end[0], pa.end[1]), Y = D.Y(pa.end[0], pa.end[1]); ctx.beginPath(); ctx.arc(X, Y, T.R * D.s, 0, 2 * Math.PI); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // candidate lines while the AI thinks
    for (const c of F.cands || []) {
      ctx.globalAlpha = c.alpha;
      const wd = c.best ? 2 : 1.2;
      if (c.kind === 'bank') { seg(ctx, [c.ox, c.oy], [c.bank.bx, c.bank.by], 1, MC.m2, { width: wd, dash: true, d }); seg(ctx, [c.bank.bx, c.bank.by], [c.aimX, c.aimY], 1, MC.m2, { width: wd, dash: true, d }); }
      else if (c.kind === 'combo') { seg(ctx, [c.ox, c.oy], [c.combo.gBx, c.combo.gBy], 1, MC.m2, { width: wd, dash: true, d }); seg(ctx, [c.combo.bx, c.combo.by], [c.aimX, c.aimY], 1, MC.m2, { width: wd, dash: true, d }); }
      else seg(ctx, [c.ox, c.oy], [c.aimX, c.aimY], 1, MC.m2, { width: wd, dash: true, d });
      if (c.kind === 'kick') { seg(ctx, [c.cx, c.cy], [c.bank.bx, c.bank.by], 1, MC.m1, { width: wd, dash: !c.best, d }); seg(ctx, [c.bank.bx, c.bank.by], [c.gx, c.gy], 1, MC.m1, { width: wd, dash: !c.best, d }); }
      else seg(ctx, [c.cx, c.cy], [c.gx, c.gy], 1, MC.m1, { width: wd, dash: !c.best, d });
      ctx.strokeStyle = MC.m1; ctx.lineWidth = 1.2 * d; ctx.setLineDash([3 * d, 3 * d]);
      ctx.beginPath(); ctx.arc(D.X(c.gx, c.gy), D.Y(c.gx, c.gy), T.R * D.s, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      if (c.text) text(ctx, c.text, D.X(c.ox, c.oy), D.Y(c.ox, c.oy) - 2.2 * T.R * D.s, 12 * d, MC.m5, { italic: false });
    }
    ctx.globalAlpha = 1;
    // pick marks for the planner
    if (F.pick) {
      for (const n of F.pick.legal || []) { const b = (F.balls || []).find(q => q.n === n); if (!b) continue; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2 * d; ctx.beginPath(); ctx.arc(D.X(b.x, b.y), D.Y(b.x, b.y), T.R * D.s + 4 * d, 0, 2 * Math.PI); ctx.stroke(); }
      if (F.pick.pocket != null && F.pick.pocket >= 0) { const p = T.pockets[F.pick.pocket]; ctx.strokeStyle = MC.m2; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.arc(D.X(p.hx, p.hy), D.Y(p.hx, p.hy), p.r * D.s + 3 * d, 0, 2 * Math.PI); ctx.stroke(); }
    }
    for (const b of F.balls || []) ball(ctx, b.n, b.x, b.y, F, b.alpha ?? 1, b.q || null);
    if (F.pick && F.pick.sel > 0) { const b = (F.balls || []).find(q => q.n === F.pick.sel); if (b) { ctx.strokeStyle = MC.m2; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.arc(D.X(b.x, b.y), D.Y(b.x, b.y), T.R * D.s + 5 * d, 0, 2 * Math.PI); ctx.stroke(); } }
    // the cue stick (core/cue.js pose): its shadow on the cloth falls off by
    // its height, so a lifted butt reads as lifted; the bridge under it
    if (F.cue) {
      const { x, y, phi, back = 0.06, alpha = 1, pose } = F.cue, dx = Math.cos(phi), dy = Math.sin(phi);
      ctx.save(); ctx.globalAlpha = alpha;
      if (pose) {
        const L = 1.48, e = pose.elev, tip = pose.tip, u = pose.u;
        const at = s => [tip[0] + u[0] * s, tip[1] + u[1] * s, tip[2] + u[2] * s];
        const sh = s => { const p = at(s); return [p[0] + p[2] * 0.35, p[1] - p[2] * 0.5]; };
        ctx.globalAlpha = alpha * 0.28;
        seg(ctx, sh(0), sh(L), 1, '#000', { width: 6, d });
        ctx.globalAlpha = alpha;
        const a = at(0), b = at(L), j = at(0.75);
        seg(ctx, [j[0], j[1]], [b[0], b[1]], 1, '#3a2a20', { width: 7, d });
        seg(ctx, [a[0], a[1]], [j[0], j[1]], 1, '#d8c39a', { width: 5, d });
        seg(ctx, [a[0], a[1]], at(0.012).slice(0, 2), 1, '#3b6fb6', { width: 5, d });
        const B = pose.bridge;
        if (B) {
          const X = D.X(B.x, B.y), Y = D.Y(B.x, B.y);
          ctx.strokeStyle = 'rgba(230,230,230,0.8)'; ctx.lineWidth = 1.4 * d;
          ctx.beginPath(); ctx.arc(X, Y, 4.5 * d, 0, 2 * Math.PI); ctx.stroke();
        }
        if (e > 6 * Math.PI / 180) {
          const m = at(0.35);
          text(ctx, `cue lifted α = ${(e * 180 / Math.PI).toFixed(0)}°`, D.X(m[0], m[1]), D.Y(m[0], m[1]) - 12 * d, 12 * d, '#e8dcc0', { italic: false });
        }
      } else {
        const off = T.R + back;
        seg(ctx, [x - dx * off, y - dy * off], [x - dx * (off + 0.9), y - dy * (off + 0.9)], 1, '#d8c39a', { width: 5, d });
        seg(ctx, [x - dx * off, y - dy * off], [x - dx * (off + 0.02), y - dy * (off + 0.02)], 1, '#3b6fb6', { width: 5, d });
      }
      ctx.restore();
    }
    for (const x of F.items || []) if (x.it.lens !== 'only') item(ctx, x.it, x.p, x.alpha, F);
    for (const L of F.live || []) live(ctx, L, F);
    ctx.globalAlpha = 1;
    if (F.inset !== false) lens(ctx, F, st);
  }
  D.draw = draw;
  // the contact inset alone (the saver draws it outside the diagram clip)
  D.drawInset = (ctx, F) => lens(ctx, F, STYLES[F.style] || STYLES.felt);

  // The contact inset (Manim's zoomed camera): the contact geometry at about
  // 4-6x in the fixed box D.inset (bottom right), a ring on the table and a
  // line to the box. The box frame stays when there is no contact, so
  // nothing jumps. The aimed ghost ball (dashed) and the observed cue ball
  // at the contact show the stroke error at the ball.
  function lens(ctx, F, st) {
    const d = F.dpr || 1, B = D.inset;
    if (!B) return;
    const L = F.lens, a = L ? L.alpha : 0, size = B.size, bx = B.x, by = B.y;
    ctx.save();
    ctx.fillStyle = st.bg; ctx.globalAlpha = 0.92; ctx.fillRect(bx, by, size, size);
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1 * d; ctx.strokeRect(bx, by, size, size);
    text(ctx, a > 0.01 ? '' : 'contact zoom', bx + size / 2, by + size / 2, 11 * d, 'rgba(255,255,255,0.35)', { italic: false });
    ctx.restore();
    if (!L || a <= 0.01) return;
    const Xc = D.X(L.x, L.y), Yc = D.Y(L.x, L.y), ringR = 5.6 * T.R * D.s;
    const saved = [D.s, D.cx, D.cy];
    // the ring on the table and the line to the box
    ctx.save(); ctx.globalAlpha = a * 0.8; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1 * d;
    ctx.beginPath(); ctx.arc(Xc, Yc, ringR, 0, 2 * Math.PI); ctx.stroke();
    const ex = Math.max(bx, Math.min(bx + size, Xc)), ey = Math.max(by, Math.min(by + size, Yc));
    const ux = ex - Xc, uy = ey - Yc, ul = Math.hypot(ux, uy) || 1;
    if (ul > ringR) { ctx.beginPath(); ctx.moveTo(Xc + ux / ul * ringR, Yc + uy / ul * ringR); ctx.lineTo(ex, ey); ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = a;
    ctx.beginPath(); ctx.rect(bx, by, size, size); ctx.fillStyle = st.cloth; ctx.fill();
    ctx.clip();
    const s2 = size / (7 * T.R);
    D.s = s2;
    if (D.rot) { D.cx = bx + size / 2 + L.y * s2; D.cy = by + size / 2 + L.x * s2; } else { D.cx = bx + size / 2 - L.x * s2; D.cy = by + size / 2 + L.y * s2; }
    // a faint 1 cm grid, like graph paper under the construction
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1 * d; ctx.beginPath();
    for (let k = -8; k <= 8; k++) { const gx = Math.round(L.x * 100) / 100 + k * 0.01, gy = Math.round(L.y * 100) / 100 + k * 0.01;
      ctx.moveTo(D.X(gx, L.y - 0.1), D.Y(gx, L.y - 0.1)); ctx.lineTo(D.X(gx, L.y + 0.1), D.Y(gx, L.y + 0.1));
      ctx.moveTo(D.X(L.x - 0.1, gy), D.Y(L.x - 0.1, gy)); ctx.lineTo(D.X(L.x + 0.1, gy), D.Y(L.x + 0.1, gy)); }
    ctx.stroke();
    // a still of the contact: the object ball where it was hit, the cue ball at the contact, the aimed ghost
    for (const b of L.balls || []) {
      if (Math.hypot(b.x - L.x, b.y - L.y) > 9 * T.R) continue;
      if (b.aimed) {
        ctx.save(); ctx.strokeStyle = MC.m1; ctx.lineWidth = 1.4 * d; ctx.setLineDash([4 * d, 3 * d]);
        ctx.beginPath(); ctx.arc(D.X(b.x, b.y), D.Y(b.x, b.y), T.R * D.s, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
      } else ball(ctx, b.n, b.x, b.y, F, b.ghost ? 0.62 : 0.92, null);
    }
    let vmax = 0;
    for (const x of F.items || []) if (x.it.vec) vmax = Math.max(vmax, Math.hypot(x.it.vec[0], x.it.vec[1]));
    const F2 = Object.assign({}, F, { _lens: true, _k: vmax > 0 ? 2.4 * T.R / vmax : 0.05 });
    fontK = 1.2;
    for (const x of F.items || []) if (x.it.lens === 'only' || ['circle', 'angle', 'dot'].includes(x.it.kind) || (x.it.kind === 'line' && x.it.dash)) item(ctx, x.it, x.p, x.alpha, F2);
    fontK = 1;
    // the tags of the aimed and the observed cue ball
    const aimB = (L.balls || []).find(b => b.aimed), obsB = (L.balls || []).find(b => b.tag === 'observed');
    if (aimB && obsB) {
      const gap = Math.hypot(aimB.x - obsB.x, aimB.y - obsB.y);
      text(ctx, `aimed vs observed: ${(gap * 1000).toFixed(1)} mm`, bx + size / 2, by + size - 12 * d, 11 * d, MC.m1, { italic: false });
    }
    ctx.restore();
    [D.s, D.cx, D.cy] = saved;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2 * d; ctx.beginPath(); ctx.rect(bx, by, size, size); ctx.stroke();
    text(ctx, `zoom ×${(s2 / D.s).toFixed(1)} · contact`, bx + 8 * d, by + 12 * d, 11 * d, 'rgba(255,255,255,0.75)', { italic: false, align: 'left' });
    ctx.restore();
  }
  return D;
}

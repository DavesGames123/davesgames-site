// ============================================================================
//  ANTENNA FIELDS  ·  overlay.js — the 2D layer over the GPU field
// ----------------------------------------------------------------------------
//  DOM-free drawing on a CanvasRenderingContext2D. main.js calls drawOverlay
//  every frame. In the screensaver the same canvas goes to the GPU as a
//  texture (field-gl.js uploadOverlay), so one canvas holds the picture.
//
//  WHAT IT DRAWS (in this order)
//    field lines   traced from the probe grid where no flux function exists
//    energy flow   the flow.js particles (a callback)
//    zones         the reactive near-field and far-field radii (dashed)
//    flux sphere   the circle where the sphere through the observer cuts the
//                  plane, with S.n arrows: out (green) or back in (dim)
//    wires         each wire, the envelope |I(z)| of its current and the
//                  current now, Re{I e^{jwt}}, as a curve beside the wire;
//                  a wire seen end on is a disc with a dot or a cross
//    observer      the marker, the E, B and S arrows at it, and a label with
//                  the distance, the zone, the E-B phase gap, E(t) and B(t)
//                  over one period, and the flux through the sphere
//    phasor inset  the far-field phasors toward the observer, head to tail
//    scale         a scale bar in metres and wavelengths
//  Colours are the lib/sci.css symbol colours: E --m2, B --m1, S --m3,
//  current --m5.
//
//  PROBE GRID. field-gl.js readProbe() gives a small phasor grid of the view
//  (T0..T3, RGBA float, row 0 at the bottom). inPlane() and traceLines()
//  use it.
//
//  grep -n: "export function drawOverlay"  "export function traceLines"
//           "function drawWires"  "function drawObserver"  "function drawFlux"
//           "function drawPhasors"  "function drawZones"  "export const RGB"
// ============================================================================

// The symbol colours of lib/sci.css as "r,g,b".
export const RGB = { E: '255,154,98', B: '98,196,255', S: '134,220,124', I: '255,214,102', P: '232,137,220', k: '168,164,255', ink: '232,236,242' };
const SANS = 'Inter, system-ui, -apple-system, sans-serif';
const SERIF = '"STIX Two Text", "Times New Roman", serif';

// Plane <-> canvas pixels. view: { u0, v0, u1, v1 } in wavelengths.
export function mapper(view, W, H) {
  const sx = W / (view.u1 - view.u0), sy = H / (view.v1 - view.v0);
  return {
    sx, sy,
    x: u => (u - view.u0) * sx,
    y: v => H - (v - view.v0) * sy,
  };
}

// Instantaneous in-plane field (2 floats per cell) for field 'E' or 'H'.
export function inPlane(probe, which, phase, axU, axV, out) {
  const { w, h, T } = probe, c = Math.cos(phase), s = Math.sin(phase);
  const n = w * h;
  if (!out || out.length !== n * 2) out = new Float32Array(n * 2);
  const T0 = T[0], T1 = T[1], T2 = T[2];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let fx, fy, fz;
    if (which === 'E') {
      fx = T0[o] * c - T0[o + 1] * s; fy = T0[o + 2] * c - T0[o + 3] * s; fz = T1[o] * c - T1[o + 1] * s;
    } else {
      fx = T1[o + 2] * c - T1[o + 3] * s; fy = T2[o] * c - T2[o + 1] * s; fz = T2[o + 2] * c - T2[o + 3] * s;
    }
    out[i * 2] = fx * axU[0] + fy * axU[1] + fz * axU[2];
    out[i * 2 + 1] = fx * axV[0] + fy * axV[1] + fz * axV[2];
  }
  return out;
}

function sample(F, w, h, gx, gy, o) {
  // bilinear in cell-centre coordinates
  const x = Math.min(w - 1.001, Math.max(0, gx - 0.5)), y = Math.min(h - 1.001, Math.max(0, gy - 0.5));
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j;
  const a = (j * w + i) * 2, b = a + 2, c = a + w * 2, d = c + 2;
  o[0] = (F[a] * (1 - fx) + F[b] * fx) * (1 - fy) + (F[c] * (1 - fx) + F[d] * fx) * fy;
  o[1] = (F[a + 1] * (1 - fx) + F[b + 1] * fx) * (1 - fy) + (F[c + 1] * (1 - fx) + F[d + 1] * fx) * fy;
  return o;
}

// Seeds: a jittered lattice in grid units, fixed per grid size.
const seedCache = new Map();
function seeds(w, h, step) {
  const key = w + 'x' + h + ':' + step;
  if (seedCache.has(key)) return seedCache.get(key);
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) out.push([x + (rnd() - 0.5) * step * 0.8, y + (rnd() - 0.5) * step * 0.8]);
  seedCache.set(key, out);
  return out;
}

// Field lines in grid units: [{ pts: Float32Array (x, y pairs), mag }].
export function traceLines(F, w, h, opt = {}) {
  const step = opt.seedStep || 3.2, ds = opt.ds || 0.45, nmax = opt.steps || 26, ref = opt.ref || 1;
  const lines = [], o = [0, 0], m = [0, 0];
  for (const [sx, sy] of seeds(w, h, step)) {
    const pts = [];
    let mag0 = 0;
    for (const dir of [1, -1]) {
      const seg = [];
      let x = sx, y = sy;
      for (let k = 0; k < nmax; k++) {
        sample(F, w, h, x, y, o);
        const n = Math.hypot(o[0], o[1]);
        if (k === 0 && dir === 1) mag0 = n;
        if (n < ref * 1e-4) break;
        const mx = x + dir * ds * 0.5 * o[0] / n, my = y + dir * ds * 0.5 * o[1] / n;
        sample(F, w, h, mx, my, m);
        const nm = Math.hypot(m[0], m[1]) || 1;
        x += dir * ds * m[0] / nm; y += dir * ds * m[1] / nm;
        if (x < 0 || y < 0 || x > w || y > h) break;
        seg.push(x, y);
      }
      if (dir === 1) pts.push(...seg);
      else { const rev = []; for (let i = seg.length - 2; i >= 0; i -= 2) rev.push(seg[i], seg[i + 1]); pts.unshift(...rev, sx, sy); }
    }
    if (pts.length >= 8) lines.push({ pts, mag: mag0 });
  }
  return lines;
}

// ── drawing ──────────────────────────────────────────────────────────────────
// a: { W, H, dpr, view, map, wires, plane ('side'|'top'), phase, centre,
//      zones: { on, rNear, rFar, lambdaM } (wavelengths), lines: { list, gw, gh, ref, color },

// ── drawing ──────────────────────────────────────────────────────────────────
// a: { W, H, dpr, view, map, wires, plane ('side'|'top'), axU, axV, phase,
//      centre [u, v], zones: { on, rNear, rFar, lambdaM }, lines, flow (fn),
//      obs (see drawObserver), phasors (see drawPhasors), scaleBox }
export function drawOverlay(ctx, a) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, a.W, a.H);
  if (a.lines && a.lines.list) drawLines(ctx, a);
  if (a.flow) a.flow(ctx);
  if (a.zones && a.zones.on) drawZones(ctx, a);
  if (a.obs && a.obs.sphere) drawFlux(ctx, a);
  drawWires(ctx, a);
  if (a.obs) drawObserver(ctx, a);
  if (a.phasors) drawPhasors(ctx, a);
  drawScale(ctx, a);
}

function proj(a, p) {
  const u = p[0] * a.axU[0] + p[1] * a.axU[1] + p[2] * a.axU[2], v = p[0] * a.axV[0] + p[1] * a.axV[1] + p[2] * a.axV[2];
  return [a.map.x(u), a.map.y(v)];
}

function drawLines(ctx, a) {
  const L = a.lines, sx = a.W / L.gw, sy = a.H / L.gh;
  ctx.lineWidth = 1.1 * a.dpr;
  ctx.lineCap = 'round';
  // The alpha falls toward both ends of a line. Pieces go into NB alpha
  // buckets, one path per bucket, so a frame strokes NB paths.
  const NB = 8, paths = Array.from({ length: NB }, () => new Path2D());
  for (const ln of L.list) {
    const p = ln.pts, n = p.length / 2;
    const k = Math.min(1, Math.pow(ln.mag / L.ref, 0.35));
    if (k < 0.04) continue;
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1), al = (0.15 + 0.6 * k) * Math.sin(Math.PI * t);
      const b = Math.min(NB - 1, Math.floor(al / 0.75 * NB));
      paths[b].moveTo(p[2 * i - 2] * sx, a.H - p[2 * i - 1] * sy);
      paths[b].lineTo(p[2 * i] * sx, a.H - p[2 * i + 1] * sy);
    }
  }
  paths.forEach((pa, b) => { ctx.strokeStyle = L.color.replace('A', ((b + 0.5) / NB * 0.75).toFixed(3)); ctx.stroke(pa); });
}

function drawZones(ctx, a) {
  const Z = a.zones, cx = a.map.x(a.centre[0]), cy = a.map.y(a.centre[1]);
  const ring = (r, col, label) => {
    const rp = r * a.map.sx;
    if (rp < 6 * a.dpr || rp > 4 * Math.max(a.W, a.H)) return;
    const showLabel = rp > 70 * a.dpr;
    ctx.setLineDash([5 * a.dpr, 6 * a.dpr]);
    ctx.strokeStyle = col; ctx.lineWidth = 1 * a.dpr;
    ctx.beginPath(); ctx.arc(cx, cy, rp, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    if (!showLabel) return;
    const ang = -Math.PI * 0.27;
    const lx = cx + rp * Math.cos(ang), ly = cy + rp * Math.sin(ang);
    ctx.font = `${11 * a.dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = col;
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, lx + 4 * a.dpr, ly - 2 * a.dpr);
  };
  ring(Z.rNear, 'rgba(168,164,255,0.6)', 'reactive near field  r < ' + fmtM(Z.rNear * Z.lambdaM));
  if (Z.rFar > Z.rNear * 1.4) ring(Z.rFar, 'rgba(220,226,234,0.5)', 'far field  r > ' + fmtM(Z.rFar * Z.lambdaM) + '  (2D²/λ, 2D and λ)');
}
function fmtM(m) { return m >= 1 ? m.toFixed(2) + ' m' : (m * 100).toFixed(m < 0.1 ? 1 : 0) + ' cm'; }

// ── wires and their current ─────────────────────────────────────────────────
// The current along each wire as a curve beside it: the faint band is the
// envelope |I(z)| (the standing wave), the line is the current now. The
// curve sits to the right of the wire's direction when the current flows
// along it. An end-on wire is a disc: a dot when the current comes toward
// the viewer, a cross when it goes away.
function drawWires(ctx, a) {
  const c = Math.cos(a.phase), s = Math.sin(a.phase), d = a.dpr;
  const nrm = [a.axU[1] * a.axV[2] - a.axU[2] * a.axV[1], a.axU[2] * a.axV[0] - a.axU[0] * a.axV[2], a.axU[0] * a.axV[1] - a.axU[1] * a.axV[0]];
  let imax = 1e-12, span = 0;
  for (const w of a.wires) for (const I of w.I) imax = Math.max(imax, Math.hypot(I[0], I[1]));
  const P = a.wires.map(w => w.pts.map(p => proj(a, p)));
  for (const pts of P) { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); span = Math.max(span, L); }
  const amp = Math.min(34 * d, Math.max(10 * d, 0.16 * span));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  a.wires.forEach((w, wi) => {
    const pts = P[wi], n = pts.length;
    let len = 0;
    for (let k = 1; k < n; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (len < 4 * d) { endOn(ctx, a, w, pts[0], c, s, imax, nrm); return; }
    // Through-screen part of the 3D tangent at each point. A loop seen edge
    // on turns through the viewing direction: there the page draws a dot or
    // a cross, and no current curve (it would fold back on itself).
    const tn = w.pts.map((p, k) => {
      const q0 = w.pts[Math.max(0, k - 1)], q1 = w.pts[Math.min(n - 1, k + 1)];
      const t = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]], l = Math.hypot(t[0], t[1], t[2]) || 1;
      return (t[0] * nrm[0] + t[1] * nrm[1] + t[2] * nrm[2]) / l;
    });
    const edgeOn = tn.some(v => Math.abs(v) > 0.9);
    const now = w.I.map(I => (I[0] * c - I[1] * s) / imax);
    if (!edgeOn) {
      // screen normal at each point (right of the direction of travel)
      const N = pts.map((p, k) => {
        const q0 = pts[Math.max(0, k - 1)], q1 = pts[Math.min(n - 1, k + 1)];
        const tx = q1[0] - q0[0], ty = q1[1] - q0[1], l = Math.hypot(tx, ty) || 1;
        return [-ty / l, tx / l];
      });
      const env = w.I.map(I => Math.hypot(I[0], I[1]) / imax);
      // envelope band: the standing wave |I(z)|
      ctx.beginPath();
      for (let k = 0; k < n; k++) { const p = pts[k], q = N[k], e = env[k] * amp; k ? ctx.lineTo(p[0] + q[0] * e, p[1] + q[1] * e) : ctx.moveTo(p[0] + q[0] * e, p[1] + q[1] * e); }
      for (let k = n - 1; k >= 0; k--) { const p = pts[k], q = N[k], e = env[k] * amp; ctx.lineTo(p[0] - q[0] * e, p[1] - q[1] * e); }
      ctx.closePath();
      ctx.fillStyle = `rgba(${RGB.I},0.07)`; ctx.fill();
      ctx.strokeStyle = `rgba(${RGB.I},0.22)`; ctx.lineWidth = 0.8 * d; ctx.stroke();
      // the current now
      ctx.beginPath();
      for (let k = 0; k < n; k++) { const p = pts[k], q = N[k], e = now[k] * amp; k ? ctx.lineTo(p[0] + q[0] * e, p[1] + q[1] * e) : ctx.moveTo(p[0] + q[0] * e, p[1] + q[1] * e); }
      ctx.strokeStyle = `rgba(${RGB.I},0.92)`; ctx.lineWidth = 1.6 * d; ctx.stroke();
    }
    // the metal
    ctx.beginPath();
    pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = w.role === 'driven' || !w.role ? 'rgba(244,246,248,0.95)' : 'rgba(194,201,210,0.85)';
    ctx.lineWidth = 2 * d; ctx.stroke();
    if (edgeOn) {
      // one glyph per run of through-screen points, at the strongest one
      let best = -1;
      for (let k = 0; k <= n; k++) {
        const inRun = k < n && Math.abs(tn[k]) > 0.9;
        if (inRun && (best < 0 || Math.abs(tn[k]) > Math.abs(tn[best]))) best = k;
        if (!inRun && best >= 0) { glyph(ctx, pts[best], now[best] * Math.sign(tn[best]), d, 7 * d); best = -1; }
      }
    }
  });
  if (a.feed) {
    const [fx, fy] = proj(a, a.feed);
    ctx.fillStyle = `rgba(${RGB.I},1)`;
    ctx.beginPath(); ctx.arc(fx, fy, 2.6 * d, 0, 2 * Math.PI); ctx.fill();
  }
}
// A wire seen end on: the current along the viewing axis.
function endOn(ctx, a, w, p, c, s, imax, nrm) {
  const d = a.dpr, k = Math.floor(w.I.length / 2), I = w.I[k];
  const t = [0, 1, 2].map(q => w.pts[w.pts.length - 1][q] - w.pts[0][q]);
  const sg = Math.sign(t[0] * nrm[0] + t[1] * nrm[1] + t[2] * nrm[2]) || 1;
  glyph(ctx, p, sg * (I[0] * c - I[1] * s) / imax, d, 9 * d);
}
// i > 0: toward the viewer (a dot); i < 0: away (a cross). |i| sets the glow.
function glyph(ctx, p, i, d, r) {
  const m = Math.min(1, Math.abs(i));
  const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 2.2);
  g.addColorStop(0, `rgba(${RGB.I},${(0.15 + 0.55 * m).toFixed(3)})`); g.addColorStop(1, `rgba(${RGB.I},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.2, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = 'rgba(244,246,248,0.95)'; ctx.lineWidth = 1.4 * d;
  ctx.fillStyle = 'rgba(8,10,14,0.85)';
  ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.62, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = `rgba(${RGB.I},${(0.35 + 0.65 * m).toFixed(3)})`; ctx.fillStyle = ctx.strokeStyle;
  if (i >= 0) { ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.2, 0, 2 * Math.PI); ctx.fill(); }
  else { const q = r * 0.3; ctx.beginPath(); ctx.moveTo(p[0] - q, p[1] - q); ctx.lineTo(p[0] + q, p[1] + q); ctx.moveTo(p[0] + q, p[1] - q); ctx.lineTo(p[0] - q, p[1] + q); ctx.stroke(); }
}

// ── the flux sphere ──────────────────────────────────────────────────────────
// a.obs.circle: geom.circleFlux of the sphere through the observer. Each
// arrow is S.n now: outward green, inward dim. Lengths share one scale, the
// largest value over the cycle.
function drawFlux(ctx, a) {
  const o = a.obs, cf = o.circle, d = a.dpr;
  if (!cf) return;
  const cx = a.map.x(a.centre[0]), cy = a.map.y(a.centre[1]), R = cf.r * a.map.sx;
  if (R < 8 * d) return;
  ctx.setLineDash([3 * d, 5 * d]);
  ctx.strokeStyle = `rgba(${RGB.S},0.45)`; ctx.lineWidth = 1 * d;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  ctx.setLineDash([]);
  const c2 = Math.cos(2 * a.phase), s2 = Math.sin(2 * a.phase);
  let m = 1e-30;
  for (let i = 0; i < cf.n; i++) m = Math.max(m, Math.abs(cf.s[i]) + Math.hypot(cf.q[2 * i], cf.q[2 * i + 1]));
  const Lmax = Math.min(30 * d, 0.45 * R), out = new Path2D(), back = new Path2D();
  for (let i = 0; i < cf.n; i++) {
    const v = (cf.s[i] + cf.q[2 * i] * c2 - cf.q[2 * i + 1] * s2) / m, L = v * Lmax;
    if (Math.abs(L) < 1.5 * d) continue;
    const ang = 2 * Math.PI * i / cf.n, ux = Math.cos(ang), uy = -Math.sin(ang);
    const x0 = cx + ux * R, y0 = cy + uy * R, x1 = x0 + ux * L, y1 = y0 + uy * L;
    const p = L > 0 ? out : back, h = Math.min(4 * d, Math.abs(L) * 0.4);
    p.moveTo(x0, y0); p.lineTo(x1, y1);
    const sg = Math.sign(L);
    p.moveTo(x1 - sg * (ux * h - uy * h * 0.55), y1 - sg * (uy * h + ux * h * 0.55)); p.lineTo(x1, y1);
    p.lineTo(x1 - sg * (ux * h + uy * h * 0.55), y1 - sg * (uy * h - ux * h * 0.55));
  }
  ctx.lineWidth = 1.3 * d;
  ctx.strokeStyle = `rgba(${RGB.S},0.9)`; ctx.stroke(out);
  ctx.strokeStyle = 'rgba(170,190,180,0.55)'; ctx.stroke(back);
}

// ── the observer ─────────────────────────────────────────────────────────────
// a.obs: { u, v (plane), ob (geom.observer), sf (geom.sphereFlux),
//   lambdaM, zone (words), triad, label, labelSide }
function drawObserver(ctx, a) {
  const o = a.obs, d = a.dpr, x = a.map.x(o.u), y = a.map.y(o.v), ob = o.ob;
  const c = Math.cos(a.phase), s = Math.sin(a.phase);
  // marker
  ctx.fillStyle = 'rgba(8,10,14,0.55)';
  ctx.beginPath(); ctx.arc(x, y, 9 * d, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = 'rgba(244,246,248,0.95)'; ctx.lineWidth = 1.5 * d;
  ctx.beginPath(); ctx.arc(x, y, 6.5 * d, 0, 2 * Math.PI); ctx.stroke();
  if (!ob) return;
  // E, B and S now, in the plane; the part across the plane as a dot or a cross
  if (o.triad !== false) {
    const L = 30 * d;
    const vecNow = (P, i0) => [0, 1, 2].map(k => P[i0 + 2 * k] * c - P[i0 + 2 * k + 1] * s);
    const E = vecNow(ob.f, 0), H = vecNow(ob.f, 6);
    const ea = Math.hypot(ob.E.a[0], ob.E.a[1]) || 1, ha = Math.hypot(ob.H.a[0], ob.H.a[1]) || 1;
    const Sv = [E[1] * H[2] - E[2] * H[1], E[2] * H[0] - E[0] * H[2], E[0] * H[1] - E[1] * H[0]];
    const nrm = [a.axU[1] * a.axV[2] - a.axU[2] * a.axV[1], a.axU[2] * a.axV[0] - a.axU[0] * a.axV[2], a.axU[0] * a.axV[1] - a.axU[1] * a.axV[0]];
    const arrowOf = (V, scale, rgb, off) => {
      const u = (V[0] * a.axU[0] + V[1] * a.axU[1] + V[2] * a.axU[2]) / scale, v = (V[0] * a.axV[0] + V[1] * a.axV[1] + V[2] * a.axV[2]) / scale;
      const n = (V[0] * nrm[0] + V[1] * nrm[1] + V[2] * nrm[2]) / scale;
      if (Math.hypot(u, v) > 0.04) arrow(ctx, x, y, x + u * L, y - v * L, rgb, d);
      if (Math.abs(n) > 0.04) glyphSmall(ctx, x + off[0] * d, y + off[1] * d, n, rgb, d);
    };
    arrowOf(E, ea, RGB.E, [-15, -15]);
    arrowOf(H, ha, RGB.B, [15, -15]);
    arrowOf(Sv, ea * ha, RGB.S, [0, 18]);
  }
  if (o.label === false) return;
  // label
  const lines = [], fs = 12 * d;
  const dist = ob.dist * o.lambdaM;
  lines.push([['r = ', 'ink'], [fmtM(dist) + ' = ' + ob.dist.toFixed(2) + ' λ', 'ink'], ['  ·  ' + o.zone, 'dim']]);
  const g = Math.round(ob.gap);
  const gapWords = Math.abs(g) < 4 ? [['E', 'E'], [' and ', 'ink'], ['B', 'B'], [' in phase', 'ink']]
    : g < 0 ? [['E', 'E'], [' lags ', 'ink'], ['B', 'B'], [' by ' + (-g) + '°', 'ink']] : [['E', 'E'], [' leads ', 'ink'], ['B', 'B'], [' by ' + g + '°', 'ink']];
  lines.push(gapWords);
  if (o.sf) {
    const Pn = o.sf.P + o.sf.Q[0] * Math.cos(2 * a.phase) - o.sf.Q[1] * Math.sin(2 * a.phase);
    lines.push([['flux of ', 'ink'], ['S', 'S'], [' through the sphere', 'ink']]);
    lines.push([[fmtW(o.sf.P) + ' average, ', 'ink'], [(Pn >= 0 ? '+' : '−') + fmtW(Math.abs(Pn)) + ' now', Pn >= 0 ? 'S' : 'dim']]);
  }
  ctx.font = `${fs}px ${SANS}`;
  const lh = fs * 1.42, padX = 9 * d, padY = 7 * d, spark = { w: 104 * d, h: 30 * d };
  const width = Math.max(spark.w, ...lines.map(l => l.reduce((acc, [t, k]) => { ctx.font = k === 'E' || k === 'B' || k === 'S' ? `italic ${fs * 1.12}px ${SERIF}` : `${fs}px ${SANS}`; return acc + ctx.measureText(t).width; }, 0)));
  const bw = width + 2 * padX, bh = lines.length * lh + spark.h + 2 * padY + 4 * d;
  let bx = x + 22 * d, by = y - bh - 14 * d;
  const cr = o.clip || { x: 0, y: 0, w: a.W, h: a.H };
  if (bx + bw > cr.x + cr.w - 6 * d) bx = x - 22 * d - bw;
  if (by < cr.y + 6 * d) by = y + 18 * d;
  if (by + bh > cr.y + cr.h - 6 * d) by = cr.y + cr.h - 6 * d - bh;
  bx = Math.max(cr.x + 6 * d, bx);
  roundRect(ctx, bx, by, bw, bh, 7 * d);
  ctx.fillStyle = 'rgba(7,9,13,0.78)'; ctx.fill();
  ctx.strokeStyle = 'rgba(150,190,215,0.16)'; ctx.lineWidth = 1 * d; ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  let ty = by + padY + fs;
  for (const l of lines) {
    let tx = bx + padX;
    for (const [t, k] of l) {
      const sym = k === 'E' || k === 'B' || k === 'S';
      ctx.font = sym ? `italic ${fs * 1.12}px ${SERIF}` : `${fs}px ${SANS}`;
      ctx.fillStyle = sym ? `rgb(${RGB[k]})` : k === 'dim' ? 'rgba(160,172,188,0.9)' : 'rgba(226,231,238,0.95)';
      ctx.fillText(t, tx, ty);
      tx += ctx.measureText(t).width;
    }
    ty += lh;
  }
  // E(t) and B(t) over one period, with the time now
  const sx = bx + padX, sy = ty - fs * 0.6, sw = spark.w, sh = spark.h;
  ctx.strokeStyle = 'rgba(150,170,190,0.25)'; ctx.lineWidth = 1 * d;
  ctx.beginPath(); ctx.moveTo(sx, sy + sh / 2); ctx.lineTo(sx + sw, sy + sh / 2); ctx.stroke();
  const pE = Math.atan2(ob.E.a[1], ob.E.a[0]), pB = Math.atan2(ob.H.a[1], ob.H.a[0]);
  for (const [ph, rgb] of [[pB, RGB.B], [pE, RGB.E]]) {
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) { const t = i / 48 * 2 * Math.PI, yy = sy + sh / 2 - Math.cos(t + ph) * sh * 0.42; i ? ctx.lineTo(sx + sw * i / 48, yy) : ctx.moveTo(sx, yy); }
    ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = 1.4 * d; ctx.stroke();
  }
  const tn = ((a.phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI);
  ctx.strokeStyle = 'rgba(240,244,248,0.6)';
  ctx.beginPath(); ctx.moveTo(sx + sw * tn, sy); ctx.lineTo(sx + sw * tn, sy + sh); ctx.stroke();
}
function fmtW(w) { return w >= 100 ? w.toFixed(0) + ' W' : w >= 1 ? w.toFixed(1) + ' W' : w >= 0.01 ? (w * 1000).toFixed(0) + ' mW' : w.toExponential(1) + ' W'; }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function arrow(ctx, x0, y0, x1, y1, rgb, d) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
  if (l < 2 * d) return;
  const ux = dx / l, uy = dy / l, h = Math.min(7 * d, l * 0.45);
  ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.8 * d;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * h * 0.6, y1 - uy * h * 0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * h - uy * h * 0.5, y1 - uy * h + ux * h * 0.5); ctx.lineTo(x1 - ux * h + uy * h * 0.5, y1 - uy * h - ux * h * 0.5); ctx.closePath(); ctx.fill();
}
// n > 0: toward the viewer (dot), n < 0: away (cross); |n| sets the size.
function glyphSmall(ctx, x, y, n, rgb, d) {
  const r = (3 + 4 * Math.min(1, Math.abs(n))) * d;
  ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.3 * d;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
  if (n > 0) { ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, 2 * Math.PI); ctx.fill(); }
  else { const q = r * 0.5; ctx.beginPath(); ctx.moveTo(x - q, y - q); ctx.lineTo(x + q, y + q); ctx.moveTo(x + q, y - q); ctx.lineTo(x - q, y + q); ctx.stroke(); }
}

// ── the phasor sum ───────────────────────────────────────────────────────────
// a.phasors: { pt (geom.phasorTerms), rect {x, y, w, h} in device px, title }.
// The terms go head to tail from the centre and turn together at the wave
// frequency. The circle has the radius of the sum when all terms line up
// (the most the far field can be). The dot on the axis is the far field now.
function drawPhasors(ctx, a) {
  const P = a.phasors, pt = P.pt, r = P.rect, d = a.dpr;
  if (!pt || !pt.terms.length) return;
  roundRect(ctx, r.x, r.y, r.w, r.h, 8 * d);
  ctx.fillStyle = 'rgba(7,9,13,0.78)'; ctx.fill();
  ctx.strokeStyle = 'rgba(150,190,215,0.16)'; ctx.lineWidth = 1 * d; ctx.stroke();
  const fs = 11.5 * d;
  ctx.font = `${fs}px ${SANS}`; ctx.fillStyle = 'rgba(226,231,238,0.95)'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(P.title || 'Far field toward the marker', r.x + 10 * d, r.y + 8 * d + fs);
  const top = r.y + 14 * d + fs, cx = r.x + r.w / 2, cy = top + (r.h - (top - r.y) - 26 * d) / 2, R = Math.min(r.w * 0.42, (r.h - (top - r.y) - 26 * d) / 2 - 4 * d);
  if (R < 10 * d) return;
  const sc = R / Math.max(pt.mags, 1e-30), c = Math.cos(a.phase), s = Math.sin(a.phase);
  ctx.strokeStyle = 'rgba(150,170,190,0.22)'; ctx.lineWidth = 1 * d;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R - 6 * d, cy); ctx.lineTo(cx + R + 6 * d, cy); ctx.stroke();
  let x = cx, y = cy;
  const n = pt.terms.length;
  pt.terms.forEach((t, i) => {
    const re = (t[0] * c - t[1] * s) * sc, im = (t[0] * s + t[1] * c) * sc;
    const al = 0.55 + 0.45 * (i + 1) / n;
    arrowThin(ctx, x, y, x + re, y - im, `rgba(${RGB.I},${al.toFixed(3)})`, d);
    x += re; y -= im;
  });
  // the sum (the far field E) and its real part now
  arrow(ctx, cx, cy, x, y, RGB.E, d);
  ctx.setLineDash([2 * d, 3 * d]); ctx.strokeStyle = `rgba(${RGB.E},0.5)`; ctx.lineWidth = 1 * d;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = `rgb(${RGB.E})`; ctx.beginPath(); ctx.arc(x, cy, 2.6 * d, 0, 2 * Math.PI); ctx.fill();
  const frac = Math.hypot(pt.sum[0], pt.sum[1]) / Math.max(pt.mags, 1e-30), db = 20 * Math.log10(Math.max(frac, 1e-6));
  ctx.font = `${fs}px ${SANS}`; ctx.fillStyle = 'rgba(160,172,188,0.95)';
  ctx.fillText(n + ' terms add to ' + (frac * 100).toFixed(0) + ' % of their sum' + (frac > 0.003 ? ' (' + db.toFixed(1) + ' dB)' : ''), r.x + 10 * d, r.y + r.h - 9 * d);
}
function arrowThin(ctx, x0, y0, x1, y1, col, d) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
  if (l < 0.5 * d) return;
  const ux = dx / l, uy = dy / l, h = Math.min(5 * d, l * 0.4);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.4 * d;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (l > 4 * d) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * h - uy * h * 0.45, y1 - uy * h + ux * h * 0.45); ctx.lineTo(x1 - ux * h + uy * h * 0.45, y1 - uy * h - ux * h * 0.45); ctx.closePath(); ctx.fill(); }
}

function drawScale(ctx, a) {
  if (!a.scaleBox) return;
  const { x, y, lambdaM } = a.scaleBox;
  // a round length in metres near 1/6 of the view width
  const pxPerM = a.map.sx / lambdaM, target = (a.W / 6) / pxPerM;
  const p10 = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 5, 10].map(q => q * p10).find(q => q >= target * 0.7) || p10 * 10;
  const len = nice * pxPerM;
  ctx.strokeStyle = 'rgba(230,236,244,0.8)'; ctx.lineWidth = 1.2 * a.dpr;
  ctx.beginPath(); ctx.moveTo(x, y - 4 * a.dpr); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4 * a.dpr); ctx.stroke();
  ctx.font = `${11 * a.dpr}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(230,236,244,0.85)';
  ctx.textBaseline = 'bottom';
  const txt = fmtM(nice) + '  =  ' + (nice / lambdaM).toFixed(2) + ' λ';
  ctx.fillText(txt, x, y - 6 * a.dpr);
  const lab = a.plane === 'side' ? 'x →  z ↑' : 'x →  y ↑';
  ctx.fillStyle = 'rgba(200,210,222,0.55)';
  ctx.fillText(lab, x + Math.max(len, ctx.measureText(txt).width) + 16 * a.dpr, y - 6 * a.dpr);
}

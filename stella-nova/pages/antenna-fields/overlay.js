// ============================================================================
//  ANTENNA FIELDS  ·  overlay.js — the 2D layer over the GPU field
// ----------------------------------------------------------------------------
//  DOM-free drawing on a CanvasRenderingContext2D. main.js calls drawOverlay
//  every frame. In the screensaver the same canvas goes to the GPU as a
//  texture (field-gl.js uploadOverlay), so one canvas holds the picture.
//
//  PROBE GRID. field-gl.js readProbe() gives a small phasor grid of the view
//  (T0..T3, RGBA float, row 0 at the bottom). From it:
//    inPlane()    the instantaneous in-plane E or H at each cell
//    traceLines() field lines by RK2 from a fixed jittered seed set. The seeds
//                 do not move, so a line changes smoothly with the field and
//                 does not flicker. Used only where psi has no flux function.
//    arrows       the time-average Poynting vector, projected on the plane;
//                 the alpha follows the instantaneous flux, so energy pulses
//                 outward along the arrows.
//
//  grep -n: "export function drawOverlay"  "export function traceLines"
//           "function drawAntenna"  "function drawZones"  "function drawArrows"
// ============================================================================

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
//      arrows: { on, probe, ref, axU, axV, w2 }, feed: [x,y,z], scaleM (m per lambda) }
export function drawOverlay(ctx, a) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, a.W, a.H);
  if (a.lines && a.lines.list) drawLines(ctx, a);
  if (a.arrows && a.arrows.on) drawArrows(ctx, a);
  if (a.zones && a.zones.on) drawZones(ctx, a);
  drawAntenna(ctx, a);
  drawScale(ctx, a);
}

function proj(a, p) {
  return a.plane === 'side' ? [a.map.x(p[0]), a.map.y(p[2])] : [a.map.x(p[0]), a.map.y(p[1])];
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

function drawArrows(ctx, a) {
  const A = a.arrows, P = A.probe, w = P.w, h = P.h;
  const cell = 46 * a.dpr, c = Math.cos(a.phase), s = Math.sin(a.phase);
  const T = P.T, o = [0, 0, 0, 0];
  const get = (gx, gy) => {
    // nearest probe cell: time-average and instantaneous S
    const i = Math.max(0, Math.min(w - 1, gx | 0)), j = Math.max(0, Math.min(h - 1, gy | 0)), q = (j * w + i) * 4;
    const E = [[T[0][q], T[0][q + 1]], [T[0][q + 2], T[0][q + 3]], [T[1][q], T[1][q + 1]]];
    const Hh = [[T[1][q + 2], T[1][q + 3]], [T[2][q], T[2][q + 1]], [T[2][q + 2], T[2][q + 3]]];
    const crossRe = (X, Y) => [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const Er = E.map(z => z[0]), Ei = E.map(z => z[1]), Hr = Hh.map(z => z[0]), Hi = Hh.map(z => z[1]);
    const a1 = crossRe(Er, Hr), a2 = crossRe(Ei, Hi);
    const Sa = [0.5 * (a1[0] + a2[0]), 0.5 * (a1[1] + a2[1]), 0.5 * (a1[2] + a2[2])];
    const Et = Er.map((v, k) => v * c - Ei[k] * s), Ht = Hr.map((v, k) => v * c - Hi[k] * s);
    const St = crossRe(Et, Ht);
    o[0] = Sa[0] * A.axU[0] + Sa[1] * A.axU[1] + Sa[2] * A.axU[2];
    o[1] = Sa[0] * A.axV[0] + Sa[1] * A.axV[1] + Sa[2] * A.axV[2];
    o[2] = Math.hypot(...Sa); o[3] = Math.hypot(...St);
    return o;
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let y = cell / 2; y < a.H; y += cell) {
    for (let x = cell / 2; x < a.W; x += cell) {
      const gx = x / a.W * w, gy = (a.H - y) / a.H * h;
      const S = get(gx, gy);
      const u = a.view.u0 + gx / w * (a.view.u1 - a.view.u0), v = a.view.v0 + gy / h * (a.view.v1 - a.view.v0);
      const r = Math.hypot(u - a.centre[0], v - a.centre[1]);
      const wr = A.w2 ? Math.pow(Math.max(r, 0.12) / A.rref, 2) : 1;
      const m = Math.hypot(S[0], S[1]);
      if (m * wr < A.ref * 0.01) continue;
      const len = cell * 0.78 * Math.min(1, Math.pow(m * wr / A.ref, 0.4));
      const dx = S[0] / m, dy = -S[1] / m;
      const pulse = Math.min(1, S[3] / Math.max(1e-30, 2 * S[2]));
      const al = 0.22 + 0.7 * pulse;
      const x0 = x - dx * len / 2, y0 = y - dy * len / 2, x1 = x + dx * len / 2, y1 = y + dy * len / 2;
      ctx.strokeStyle = `rgba(255,214,150,${al.toFixed(3)})`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.3 * a.dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const hs = Math.min(6 * a.dpr, len * 0.4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - dx * hs - dy * hs * 0.5, y1 - dy * hs + dx * hs * 0.5);
      ctx.lineTo(x1 - dx * hs + dy * hs * 0.5, y1 - dy * hs - dx * hs * 0.5);
      ctx.closePath(); ctx.fill();
    }
  }
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
  ring(Z.rNear, 'rgba(96,224,238,0.55)', 'reactive near field  r < ' + fmtM(Z.rNear * Z.lambdaM));
  if (Z.rFar > Z.rNear * 1.4) ring(Z.rFar, 'rgba(255,180,120,0.55)', 'far field  r > ' + fmtM(Z.rFar * Z.lambdaM) + '  (2D²/λ, 2D and λ)');
}
function fmtM(m) { return m >= 1 ? m.toFixed(2) + ' m' : (m * 100).toFixed(m < 0.1 ? 1 : 0) + ' cm'; }

function drawAntenna(ctx, a) {
  const c = Math.cos(a.phase), s = Math.sin(a.phase);
  let imax = 1e-9;
  for (const w of a.wires) for (const I of w.I) imax = Math.max(imax, Math.hypot(I[0], I[1]));
  ctx.lineCap = 'round';
  for (const w of a.wires) {
    const pts = w.pts.map(p => proj(a, p));
    let ext = 0;
    for (const p of pts) ext = Math.max(ext, Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]));
    if (ext < 3 * a.dpr) {
      // seen end on (a dipole in the top view): a disc whose glow follows the current
      const I = w.I[Math.floor(w.I.length / 2)], i = (I[0] * c - I[1] * s) / imax;
      const col = i >= 0 ? '255,180,120' : '96,224,238';
      const g = ctx.createRadialGradient(pts[0][0], pts[0][1], 0, pts[0][0], pts[0][1], 12 * a.dpr);
      g.addColorStop(0, `rgba(${col},${(0.25 + 0.7 * Math.abs(i)).toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 12 * a.dpr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#eef2f6'; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 2.6 * a.dpr, 0, 2 * Math.PI); ctx.fill();
      continue;
    }
    // glow: each piece takes the colour of its instantaneous current
    for (let k = 1; k < pts.length; k++) {
      const I0 = w.I[k - 1], I1 = w.I[k];
      const i = ((I0[0] + I1[0]) * c - (I0[1] + I1[1]) * s) / (2 * imax);
      const col = i >= 0 ? '255,170,105' : '80,215,235';
      ctx.strokeStyle = `rgba(${col},${(0.18 + 0.6 * Math.abs(i)).toFixed(3)})`;
      ctx.lineWidth = (3 + 7 * Math.abs(i)) * a.dpr;
      ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
    }
    ctx.strokeStyle = w.role === 'driven' || !w.role ? '#f4f6f8' : '#c2c9d2';
    ctx.lineWidth = 1.6 * a.dpr;
    ctx.beginPath();
    pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
  }
  if (a.feed) {
    const [fx, fy] = proj(a, a.feed);
    ctx.strokeStyle = '#ffd666'; ctx.lineWidth = 1.4 * a.dpr;
    ctx.beginPath(); ctx.arc(fx, fy, 4.5 * a.dpr, 0, 2 * Math.PI); ctx.stroke();
  }
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

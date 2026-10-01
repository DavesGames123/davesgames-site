// ============================================================================
//  SDF FORGE  ·  overlay.js — the 2D layer over each pane
// ----------------------------------------------------------------------------
//  Draws what the raymarcher does not: selection brackets, the gizmo, the
//  creation preview, inline readouts ("R 1.800" next to the object while it
//  is dragged, as in Forge), the view cube, the slice plane and the probe
//  ray. Everything is in CSS pixels on a canvas the size of the pane.
//
//  GREP MAP
//    ctxFor .............. size the canvas, clear it, return the context
//    drawBox ............. eight projected corners as brackets (decision 16)
//    drawGizmo ........... handles, hover and active colours
//    drawReadout ......... the label box: key letters in blue, values in white
//    drawCube ............ the view cube and its hover cell
//    drawProbe3D / drawSliceDiagram   the sphere tracing teaching layer
// ============================================================================
import * as V from './math.js';
import { HOT } from './gizmo.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = 'Inter, system-ui, sans-serif';
export const BLUE = '#9cc3ff', CREAM = '#ffd49a', CORAL = '#ff8a6a', TONE = '#5a8dff';

export function ctxFor(cv, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

// An oriented box: local bounds through the world matrix, eight corners.
export function boxCorners(b, W) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(V.m4vec(W, [i & 1 ? b.hi[0] : b.lo[0], i & 2 ? b.hi[1] : b.lo[1], i & 4 ? b.hi[2] : b.lo[2]]));
  return out;
}
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
export function drawBox(g, P, corners, style) {
  const q = corners.map(c => P.project(c));
  if (q.some(v => !v)) return;
  g.strokeStyle = style.color; g.lineWidth = style.width || 1;
  g.beginPath();
  for (const [a, b] of EDGES) {
    const A = q[a], B = q[b];
    if (style.brackets) {
      const f = 0.22;
      g.moveTo(A[0], A[1]); g.lineTo(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f);
      g.moveTo(B[0], B[1]); g.lineTo(B[0] + (A[0] - B[0]) * f, B[1] + (A[1] - B[1]) * f);
    } else { g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); }
  }
  g.stroke();
}

export function drawGizmo(g, G, hover, active) {
  if (!G) return;
  const lit = id => id === active || id === hover;
  const order = G.handles.slice().sort((a, b) => (a.kind === 'ring' && b.kind !== 'ring' ? -1 : 0));
  for (const h of order) {
    const on = lit(h.id), col = on ? HOT : h.color;
    if (h.kind === 'axis') {
      const [a, b] = h.seg;
      g.strokeStyle = col; g.lineWidth = on ? 3 : 2;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      g.fillStyle = col;
      if (G.tool === 'scale') { const s = on ? 6 : 5; g.fillRect(b[0] - s, b[1] - s, 2 * s, 2 * s); }
      else {
        const s = (on ? 13 : 11) * G.ui;
        g.beginPath(); g.moveTo(b[0] + ux * s, b[1] + uy * s);
        g.lineTo(b[0] - uy * s * 0.42, b[1] + ux * s * 0.42); g.lineTo(b[0] + uy * s * 0.42, b[1] - ux * s * 0.42); g.closePath(); g.fill();
      }
    } else if (h.kind === 'plane') {
      g.fillStyle = on ? 'rgba(255,216,74,0.45)' : hexA(h.color, 0.22);
      g.strokeStyle = col; g.lineWidth = 1.2;
      g.beginPath(); h.quad.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); g.stroke();
    } else if (h.kind === 'center') {
      const s = h.box;
      g.strokeStyle = on ? HOT : '#e6e8ee'; g.lineWidth = on ? 2 : 1.4;
      g.fillStyle = on ? 'rgba(255,216,74,0.25)' : 'rgba(230,232,238,0.12)';
      g.fillRect(G.pc[0] - s, G.pc[1] - s, 2 * s, 2 * s); g.strokeRect(G.pc[0] - s, G.pc[1] - s, 2 * s, 2 * s);
    } else if (h.kind === 'ring') {
      for (const front of [false, true]) {
        g.strokeStyle = col; g.lineWidth = front ? (on ? 3 : 2) : 1;
        g.globalAlpha = front ? 1 : 0.28;
        g.beginPath();
        let pen = false;
        for (const p of h.pts) {
          if (!p || p[2] !== front) { pen = false; continue; }
          if (!pen) { g.moveTo(p[0], p[1]); pen = true; } else g.lineTo(p[0], p[1]);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// lines: [[key, value], ...]. Forge draws the key in blue and the value white.
export function drawReadout(g, x, y, lines, W, H) {
  g.font = `500 15px ${MONO}`;
  const lh = 20, pad = 7;
  const w = Math.max(...lines.map(([k, v]) => g.measureText(k + ' ' + v).width)) + pad * 2;
  const h = lines.length * lh + pad;
  x = Math.min(Math.max(4, x), W - w - 4); y = Math.min(Math.max(4, y), H - h - 4);
  g.fillStyle = 'rgba(8,8,10,0.88)'; g.fillRect(x, y, w, h);
  lines.forEach(([k, v], i) => {
    const yy = y + pad + 14 + i * lh;
    g.fillStyle = BLUE; g.fillText(k, x + pad, yy);
    g.fillStyle = '#f2f3f6'; g.fillText(v, x + pad + g.measureText(k + ' ').width, yy);
  });
}

export function drawCube(g, L, hover) {
  for (const f of L.faces) {
    const s = f.shade;
    const base = [24 + 22 * s, 24 + 22 * s, 28 + 26 * s];
    g.fillStyle = `rgba(${base.map(Math.round).join(',')},0.94)`;
    g.beginPath(); f.quad.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
    if (hover && hover.face.label === f.label) {
      // the hover cell
      const [cu, cv] = hover.cell;
      const span = c => c === 0 ? [-0.6, 0.6] : c < 0 ? [-1, -0.6] : [0.6, 1];
      const [u0, u1] = span(cu), [v0, v1] = span(cv);
      const P = (a, b) => [f.o[0] + f.eu[0] * a + f.ev[0] * b, f.o[1] + f.eu[1] * a + f.ev[1] * b];
      g.fillStyle = 'rgba(107,159,226,0.55)';
      g.beginPath(); [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].forEach(([a, b], i) => { const p = P(a, b); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(92,96,112,0.95)'; g.lineWidth = 1.2;
    g.beginPath(); f.quad.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
    // the label lies on the face, foreshortened with it
    const k = L.s, lu = Math.hypot(...f.eu), lv = Math.hypot(...f.ev);
    if (lu < 0.3 * k || lv < 0.3 * k) continue;
    g.save();
    g.setTransform(...matTimesDpr(g, [f.eu[0] / k, f.eu[1] / k, -f.ev[0] / k, -f.ev[1] / k, f.o[0], f.o[1]]));
    g.font = `500 ${(k * 0.36).toFixed(1)}px ${SANS}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(206,209,220,0.95)';
    g.fillText(f.label, 0, 0);
    g.restore();
  }
}
function matTimesDpr(g, m) {
  const t = g.getTransform(), d = t.a;
  return [m[0] * d, m[1] * d, m[2] * d, m[3] * d, m[4] * d, m[5] * d];
}

// The slice plane outline and the probe path, in a 3D pane.
export function drawProbe3D(g, P, S, tr) {
  const E = S.ext;
  const at = (a, b) => V.add(V.scale(S.n, S.off), V.add(V.scale(S.u, a), V.scale(S.v, b)));
  const cs = [[-E, -E], [E, -E], [E, E], [-E, E]].map(([a, b]) => P.project(at(S.cu + a * 1.4, S.cv + b)));
  if (cs.every(Boolean)) {
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(90,141,255,0.7)'; g.lineWidth = 1.2;
    g.beginPath(); cs.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke(); g.setLineDash([]);
  }
  if (!tr) return;
  const pts = tr.steps.filter(s => !s.fail).map(s => P.project(V.add(tr.o, V.scale(tr.r, s.t))));
  const end = P.project(V.add(tr.o, V.scale(tr.r, tr.t)));
  if (pts.every(Boolean) && end) {
    g.strokeStyle = CREAM; g.lineWidth = 1.6; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.lineTo(end[0], end[1]); g.stroke();
    pts.forEach((p, i) => { g.fillStyle = i ? '#fff' : CREAM; g.beginPath(); g.arc(p[0], p[1], i ? 2.2 : 4.5, 0, Math.PI * 2); g.fill(); });
    if (tr.hit) { g.strokeStyle = CORAL; g.lineWidth = 2; g.beginPath(); g.arc(end[0], end[1], 5.5, 0, Math.PI * 2); g.stroke(); }
  }
}

// The classic sphere tracing diagram on the slice: a circle of radius |d| at
// each step, the touch point where the nearest surface lies in the plane,
// over-relaxation failures dashed in coral, the origin and aim handles.
export function drawSliceDiagram(g, W, H, S, tr, touch, coarse) {
  const sc = H / (2 * S.ext);
  const X = a => W / 2 + (a - S.cu) * sc, Y = b => H / 2 - (b - S.cv) * sc;
  const o2 = S.ray.o, d2 = [Math.cos(S.ray.a), Math.sin(S.ray.a)];
  const at = t => [o2[0] + d2[0] * t, o2[1] + d2[1] * t];
  g.setLineDash([4, 5]); g.strokeStyle = 'rgba(255,212,154,0.28)'; g.lineWidth = 1;
  const far = at(60); g.beginPath(); g.moveTo(X(o2[0]), Y(o2[1])); g.lineTo(X(far[0]), Y(far[1])); g.stroke(); g.setLineDash([]);
  const n = tr.steps.length;
  const lerp = (a, b, t) => { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  tr.steps.forEach((st, i) => {
    if (i > 90) return;
    const [a, b] = at(st.t), r = Math.abs(st.d) * sc;
    const col = st.fail || st.d < 0 ? CORAL : lerp(TONE, CREAM, n > 1 ? i / (n - 1) : 0);
    if (st.fail) g.setLineDash([3, 4]);
    g.strokeStyle = col; g.globalAlpha = 0.88; g.lineWidth = i === n - 1 ? 1.6 : 1.15;
    g.beginPath(); g.arc(X(a), Y(b), Math.max(r, 0.5), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 0.07; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
  });
  for (const tp of touch) {
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(tp.from[0]), Y(tp.from[1])); g.lineTo(X(tp.to[0]), Y(tp.to[1])); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(tp.to[0]), Y(tp.to[1]), 2.4, 0, Math.PI * 2); g.fill();
  }
  const end = at(tr.t);
  g.strokeStyle = CREAM; g.lineWidth = 1.6; g.beginPath(); g.moveTo(X(o2[0]), Y(o2[1])); g.lineTo(X(end[0]), Y(end[1])); g.stroke();
  tr.steps.forEach((st, i) => {
    if (i > 90) return;
    const [a, b] = at(st.t);
    g.fillStyle = st.fail ? CORAL : '#fff'; g.beginPath(); g.arc(X(a), Y(b), st.fail ? 3.2 : 2.6, 0, Math.PI * 2); g.fill();
  });
  if (tr.hit) { g.strokeStyle = CORAL; g.lineWidth = 2; g.beginPath(); g.arc(X(end[0]), Y(end[1]), 6, 0, Math.PI * 2); g.stroke(); }
  const ox = X(o2[0]), oy = Y(o2[1]), hr = coarse ? 14 : 8;
  const ax = ox + d2[0] * (hr + 28), ay = oy - d2[1] * (hr + 28);
  g.strokeStyle = CREAM; g.lineWidth = 2; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ax, ay); g.stroke();
  const ang = Math.atan2(-d2[1], d2[0]);
  g.fillStyle = CREAM; g.beginPath(); g.moveTo(ax + Math.cos(ang) * 9, ay + Math.sin(ang) * 9);
  g.lineTo(ax + Math.cos(ang + 2.5) * 9, ay + Math.sin(ang + 2.5) * 9); g.lineTo(ax + Math.cos(ang - 2.5) * 9, ay + Math.sin(ang - 2.5) * 9); g.fill();
  g.fillStyle = '#0b0d18'; g.strokeStyle = CREAM; g.lineWidth = 2.5; g.beginPath(); g.arc(ox, oy, hr, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = CREAM; g.beginPath(); g.arc(ox, oy, hr * 0.4, 0, Math.PI * 2); g.fill();
  return { origin: [ox, oy], aim: [ax, ay], X, Y, sc };
}

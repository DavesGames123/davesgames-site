// ============================================================================
//  HOPF FIBRATION  ·  insets.js — the base sphere S2 and the 4D gauge
// ----------------------------------------------------------------------------
//  Two small 2D canvases over the 3D view.
//
//  BASE SPHERE  createBaseSphere(canvas, hooks). An orthographic view of
//  S2, north pole up. The surface shows the colour map of the page (hue
//  from longitude, lightness from height), dimmed, so it is also the colour
//  key. On it: the circles and curves of the items, one dot for each fibre
//  in the 3D view, and rings where the 4D rotation has carried a fibre (the
//  image base points, for the rotations that keep fibres).
//  Pointer: a press outside the disc, or with the Turn tool, turns the
//  sphere. Any other press on the disc goes to hooks.onPointer(type, b, e)
//  with b the unit 3-vector under the pointer (null off the disc).
//
//  GAUGE  createGauge(canvas). A tesseract (the 4-cube with corners +-1)
//  turned by the same 4x4 matrix as the fibres, put into 3D by a
//  perspective from the x4 direction, then drawn. The edge colour gives its
//  axis: x1 blue, x2 orange, x3 green, x4 pink (the .m1 to .m4 colours).
//
//  grep -n targets: "export function createBaseSphere", "function paintSurface",
//                   "export function createGauge"
// ============================================================================
import { baseColor, toSRGB } from './hopf.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// A colour table over (height, longitude), so the surface paints fast.
const LUT_Z = 64, LUT_P = 128;
let LUT = null;
function lut() {
  if (LUT) return LUT;
  LUT = new Float32Array(LUT_Z * LUT_P * 3);
  for (let i = 0; i < LUT_Z; i++) for (let j = 0; j < LUT_P; j++) {
    const z = -1 + 2 * i / (LUT_Z - 1), r = Math.sqrt(Math.max(0, 1 - z * z)), ph = -Math.PI + 2 * Math.PI * j / LUT_P;
    const c = baseColor([r * Math.cos(ph), r * Math.sin(ph), z]), k = (i * LUT_P + j) * 3;
    LUT[k] = c[0]; LUT[k + 1] = c[1]; LUT[k + 2] = c[2];
  }
  return LUT;
}
function lutColor(b) {
  const T = lut(), i = Math.round((clamp(b[2], -1, 1) + 1) / 2 * (LUT_Z - 1));
  const j = ((Math.round((Math.atan2(b[1], b[0]) + Math.PI) / (2 * Math.PI) * LUT_P) % LUT_P) + LUT_P) % LUT_P, k = (i * LUT_P + j) * 3;
  return [T[k], T[k + 1], T[k + 2]];
}

export function createBaseSphere(canvas, hooks = {}) {
  const g = canvas.getContext('2d');
  const V = { yaw: -0.55, pitch: 0.38 };
  let W = 0, Hh = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let surf = null, surfKey = '';
  let tool = 'point';

  function basis() {
    const cy_ = Math.cos(V.yaw), sy = Math.sin(V.yaw), cp = Math.cos(V.pitch), sp = Math.sin(V.pitch);
    const fwd = [cp * cy_, cp * sy, sp];          // toward the viewer
    const right = [-sy, cy_, 0];
    const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
    return { fwd, right, up };
  }
  // b -> canvas px (device), and its depth toward the viewer
  function toScreen(b) {
    const { fwd, right, up } = basis();
    const x = b[0] * right[0] + b[1] * right[1] + b[2] * right[2];
    const y = b[0] * up[0] + b[1] * up[1] + b[2] * up[2];
    const z = b[0] * fwd[0] + b[1] * fwd[1] + b[2] * fwd[2];
    return { x: cx + R * x, y: cy - R * y, z };
  }
  function fromScreen(px, py) {
    const u = (px - cx) / R, v = -(py - cy) / R, r2 = u * u + v * v;
    if (r2 > 1) return null;
    const w = Math.sqrt(1 - r2), { fwd, right, up } = basis();
    return [u * right[0] + v * up[0] + w * fwd[0], u * right[1] + v * up[1] + w * fwd[1], u * right[2] + v * up[2] + w * fwd[2]];
  }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    W = w; Hh = h; R = Math.min(W, Hh) * 0.41; cx = W / 2; cy = Hh / 2;
  }

  // The dimmed colour map on the front half, with a soft light.
  function paintSurface() {
    const key = `${W}x${Hh}|${V.yaw.toFixed(4)}|${V.pitch.toFixed(4)}`;
    if (key === surfKey && surf) return surf;
    surfKey = key;
    const img = g.createImageData(W, Hh), d = img.data, { fwd, right, up } = basis();
    const L = [-0.45, 0.55, 0.7], ll = Math.hypot(...L);
    const x0 = Math.max(0, Math.floor(cx - R - 1)), x1 = Math.min(W, Math.ceil(cx + R + 1));
    const y0 = Math.max(0, Math.floor(cy - R - 1)), y1 = Math.min(Hh, Math.ceil(cy + R + 1));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const u = (px + 0.5 - cx) / R, v = -(py + 0.5 - cy) / R, r2 = u * u + v * v;
      if (r2 > 1) continue;
      const w = Math.sqrt(1 - r2);
      const b = [u * right[0] + v * up[0] + w * fwd[0], u * right[1] + v * up[1] + w * fwd[1], u * right[2] + v * up[2] + w * fwd[2]];
      const shade = 0.55 + 0.45 * clamp((u * L[0] + v * L[1] + w * L[2]) / ll, 0, 1);
      const c = lutColor(b).map(x => (x * 0.6 + 0.08) * 0.22 * shade);
      const s = toSRGB(c), k = (py * W + px) * 4;
      const edge = clamp((1 - Math.sqrt(r2)) * R / 1.2, 0, 1);
      d[k] = s[0]; d[k + 1] = s[1]; d[k + 2] = s[2]; d[k + 3] = Math.round(255 * edge);
    }
    surf = img;
    return img;
  }

  // Draw a closed or open polyline on the sphere: front part solid, back
  // part faint.
  function strokeSphere(pts, color, width, closed) {
    const P = pts.map(toScreen);
    for (const front of [false, true]) {
      g.beginPath();
      let on = false;
      const n = closed ? P.length + 1 : P.length;
      for (let i = 0; i < n; i++) {
        const p = P[i % P.length];
        if ((p.z >= 0) === front) { if (!on) { g.moveTo(p.x, p.y); on = true; } else g.lineTo(p.x, p.y); }
        else on = false;
      }
      g.globalAlpha = front ? 1 : 0.22;
      g.strokeStyle = color; g.lineWidth = width * dpr * (front ? 1 : 0.8);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  const circlePts = (n, f) => Array.from({ length: n }, (_, i) => f(i / n * Math.PI * 2));

  // state: { curves: [{ pts, hex, closed }], dots: [{ b, hex, sel }],
  //          images: [{ b, hex }], hint }
  function draw(state) {
    size();
    g.clearRect(0, 0, W, Hh);
    // halo
    const gr = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.12);
    gr.addColorStop(0, 'rgba(120,150,210,0.10)'); gr.addColorStop(1, 'rgba(120,150,210,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    // the surface goes through a scratch canvas so it blends
    const img = paintSurface();
    if (!draw.tmp) draw.tmp = document.createElement('canvas');
    const t = draw.tmp; if (t.width !== W || t.height !== Hh) { t.width = W; t.height = Hh; draw.tmpKey = ''; }
    if (draw.tmpKey !== surfKey) { t.getContext('2d').putImageData(img, 0, 0); draw.tmpKey = surfKey; }
    g.drawImage(t, 0, 0);
    // graticule
    for (const z of [-0.5, 0, 0.5]) { const r = Math.sqrt(1 - z * z); strokeSphere(circlePts(72, a => [r * Math.cos(a), r * Math.sin(a), z]), z === 0 ? 'rgba(220,226,240,0.32)' : 'rgba(220,226,240,0.16)', 0.8, true); }
    for (let k = 0; k < 6; k++) { const ph = k * Math.PI / 6; strokeSphere(circlePts(72, a => [Math.sin(a) * Math.cos(ph), Math.sin(a) * Math.sin(ph), Math.cos(a)]), 'rgba(220,226,240,0.12)', 0.8, true); }
    // rim
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = 'rgba(220,226,240,0.35)'; g.lineWidth = 1 * dpr; g.stroke();
    // poles
    for (const [b, lab] of [[[0, 0, 1], 'N'], [[0, 0, -1], 'S']]) {
      const p = toScreen(b); if (p.z < -0.05) continue;
      g.fillStyle = 'rgba(236,238,244,0.75)'; g.font = `${11 * dpr}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(lab, p.x, p.y + (lab === 'N' ? -9 : 9) * dpr);
    }
    if (!state) return;
    for (const c of state.curves || []) strokeSphere(c.pts, c.hex, 2.2, c.closed);
    const dots = state.dots || [], many = dots.length > 60;
    const rr = (many ? 1.7 : dots.length > 16 ? 2.8 : 4.2) * dpr;
    for (const front of [false, true]) for (const d of dots) {
      const p = toScreen(d.b); if ((p.z >= 0) !== front) continue;
      g.globalAlpha = front ? 1 : 0.3;
      g.beginPath(); g.arc(p.x, p.y, d.sel ? rr * 1.6 + 1.5 * dpr : rr, 0, Math.PI * 2);
      g.fillStyle = d.hex; g.fill();
      if (!many || d.sel) { g.lineWidth = (d.sel ? 2 : 1) * dpr; g.strokeStyle = d.sel ? '#ffffff' : 'rgba(0,0,0,0.65)'; g.stroke(); }
    }
    g.globalAlpha = 1;
    for (const d of state.images || []) {
      const p = toScreen(d.b); if (p.z < 0) continue;
      g.beginPath(); g.arc(p.x, p.y, rr + 3 * dpr, 0, Math.PI * 2);
      g.strokeStyle = d.hex; g.lineWidth = 1.6 * dpr; g.stroke();
    }
  }

  // ---- pointer
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    size();
    const rc = canvas.getBoundingClientRect(), px = (e.clientX - rc.left) * dpr, py = (e.clientY - rc.top) * dpr;
    const b = fromScreen(px, py);
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    e.preventDefault();
    if (!b || tool === 'turn' || e.button === 2) { drag = { turn: true, x: e.clientX, y: e.clientY }; return; }
    drag = { turn: false };
    hooks.onPointer && hooks.onPointer('down', b, { px, py, dpr });
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.turn) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      V.yaw -= dx * 0.012; V.pitch = clamp(V.pitch + dy * 0.012, -1.45, 1.45);
      hooks.onTurn && hooks.onTurn();
      return;
    }
    const rc = canvas.getBoundingClientRect();
    hooks.onPointer && hooks.onPointer('move', fromScreen((e.clientX - rc.left) * dpr, (e.clientY - rc.top) * dpr), {});
  });
  const end = () => { if (drag && !drag.turn) hooks.onPointer && hooks.onPointer('up', null, {}); drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  return {
    draw, toScreen,
    setTool(t) { tool = t; canvas.dataset.tool = t; },
  };
}

// ------------------------------------------------------------------ gauge
const AXIS_COL = ['#62c4ff', '#ff9a62', '#86dc7c', '#e889dc'];
export function createGauge(canvas) {
  const g = canvas.getContext('2d');
  const verts = [], edges = [];
  for (let i = 0; i < 16; i++) verts.push([0, 1, 2, 3].map(k => (i >> k & 1) ? 1 : -1));
  for (let i = 0; i < 16; i++) for (let k = 0; k < 4; k++) { const j = i ^ (1 << k); if (j > i) edges.push([i, j, k]); }
  function draw(M) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    g.clearRect(0, 0, w, h);
    const S = Math.min(w, h) * 0.25, ox = w / 2, oy = h / 2;
    const ya = 0.55, pa = 0.42, cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(pa), sp = Math.sin(pa);
    const P = verts.map(v => {
      const r = [0, 1, 2, 3].map(i => M[i * 4] * v[0] + M[i * 4 + 1] * v[1] + M[i * 4 + 2] * v[2] + M[i * 4 + 3] * v[3]);
      const f = 1 / (3.2 - r[3]);
      const x = r[0] * f * 2.2, y = r[1] * f * 2.2, z = r[2] * f * 2.2;
      const x1 = cy * x + sy * y, y1 = -sy * x + cy * y;
      const zz = cp * z - sp * y1, depth = sp * z + cp * y1;
      return { x: ox + S * x1, y: oy - S * zz, d: depth };
    });
    g.lineCap = 'round';
    const order = edges.slice().sort((a, b) => (P[a[0]].d + P[a[1]].d) - (P[b[0]].d + P[b[1]].d));
    for (const [i, j, k] of order) {
      const dd = (P[i].d + P[j].d) / 2;
      g.globalAlpha = clamp(0.35 + 0.35 * dd, 0.18, 0.95);
      g.strokeStyle = AXIS_COL[k]; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.moveTo(P[i].x, P[i].y); g.lineTo(P[j].x, P[j].y); g.stroke();
    }
    g.globalAlpha = 1;
  }
  return { draw };
}

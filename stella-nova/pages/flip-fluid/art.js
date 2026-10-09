// ============================================================================
//  FLIP WATER  ·  art.js  —  how each floating object looks
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  drawBody(ctx, body, view, opt) draws one body of bodies.js on a 2D
//  context in device pixels. It sets a transform from the body's local
//  coordinates (metres, y up) to the screen, fills the true collision
//  shape (shapes.js), then adds the details of its kind: the duck's beak
//  and eye, the boat's cabin, the crate's planks, the beach ball's
//  wedges, the log's rings, the buoy's stripes, the ice highlight, the
//  bottle's label and cap, the rock's speckles. The details stay inside
//  the shape's box, so what you see is what collides.
//
//  body.colour picks one of the kind's palettes; opt.palette (a theme of
//  render.js) can tint every object. drawIcon(ctx, kind, px) draws a
//  palette button icon with the same code.
//
//  grep -n targets
//    const LOOKS        per kind: palettes and the detail painter
//    export function drawBody
//    export function drawIcon
// ============================================================================
import { KINDS } from './bodies.js';

// Shape outline in local coordinates (the same path as render.js pathShape).
function outline(ctx, sh) {
  ctx.beginPath();
  if (sh.n === 1) { ctx.arc(sh.v[0], sh.v[1], sh.r, 0, 2 * Math.PI); return; }
  if (sh.n === 2) {
    const ax = sh.v[0], ay = sh.v[1], bx = sh.v[2], by = sh.v[3];
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.arc(bx, by, sh.r, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.arc(ax, ay, sh.r, ang + Math.PI / 2, ang + 1.5 * Math.PI);
    ctx.closePath();
    return;
  }
  for (let i = 0; i < sh.n; i++) { const x = sh.v[2 * i], y = sh.v[2 * i + 1]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath();
}

// Local bounding box of the shape's vertices, grown by its radius.
function bbox(sh) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < sh.n; i++) { const x = sh.v[2 * i], y = sh.v[2 * i + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0: x0 - sh.r, y0: y0 - sh.r, x1: x1 + sh.r, y1: y1 + sh.r, w: x1 - x0 + 2 * sh.r, h: y1 - y0 + 2 * sh.r };
}

function mix(a, b, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// One random-but-fixed number per body for small variations (speckles).
function hashLook(n) { let s = (n >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const LOOKS = {
  duck: {
    pal: [['#ffd23a', '#f08a24'], ['#ff8fb8', '#e2557d'], ['#7fe08a', '#3aa357'], ['#9bc8ff', '#4a86d8'], ['#f4f4f4', '#f08a24'], ['#2b2b33', '#f2b33a']],
    paint(ctx, sh, B, P) {
      // the head is at the front (+x) and top: beak, eye, a wing line
      ctx.fillStyle = P[1];
      ctx.beginPath(); ctx.moveTo(B.x1 - 0.12 * B.w, B.y0 + 0.66 * B.h); ctx.lineTo(B.x1 + 0.1 * B.w, B.y0 + 0.6 * B.h); ctx.lineTo(B.x1 - 0.1 * B.w, B.y0 + 0.5 * B.h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(B.x1 - 0.3 * B.w, B.y0 + 0.8 * B.h, 0.05 * B.h, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(B.x1 - 0.31 * B.w, B.y0 + 0.82 * B.h, 0.018 * B.h, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = mix(P[0], '#000000', 0.3); ctx.lineWidth = 0.035 * B.h;
      ctx.beginPath(); ctx.ellipse(B.x0 + 0.38 * B.w, B.y0 + 0.36 * B.h, 0.2 * B.w, 0.13 * B.h, 0.15, 0.2, Math.PI - 0.1); ctx.stroke();
    },
    noclip: true,
  },
  boat: {
    pal: [['#e84a3c', '#f4efe6'], ['#2f6fd6', '#f4efe6'], ['#f4efe6', '#26364f'], ['#2e8b57', '#f2d27a'], ['#f2a33a', '#1d2433']],
    paint(ctx, sh, B, P) {
      // gunwale band, a cabin and a mast with a pennant above the deck
      ctx.fillStyle = P[1];
      ctx.fillRect(B.x0, B.y1 - 0.24 * B.h, B.w, 0.12 * B.h);
      ctx.fillStyle = mix(P[1], '#000000', 0.15);
      const cw = 0.32 * B.w;
      ctx.fillRect(-cw / 2 - 0.08 * B.w, B.y1, cw, 0.55 * B.h);
      ctx.fillStyle = '#9fd3ff';
      ctx.fillRect(-cw / 2 - 0.08 * B.w + 0.06 * cw, B.y1 + 0.22 * B.h, 0.3 * cw, 0.2 * B.h);
      ctx.fillRect(-0.08 * B.w + 0.05 * cw, B.y1 + 0.22 * B.h, 0.3 * cw, 0.2 * B.h);
      ctx.strokeStyle = '#d7dbe3'; ctx.lineWidth = 0.035 * B.h;
      ctx.beginPath(); ctx.moveTo(0.22 * B.w, B.y1); ctx.lineTo(0.22 * B.w, B.y1 + 1.1 * B.h); ctx.stroke();
      ctx.fillStyle = P[0];
      ctx.beginPath(); ctx.moveTo(0.22 * B.w, B.y1 + 1.1 * B.h); ctx.lineTo(0.38 * B.w, B.y1 + 0.98 * B.h); ctx.lineTo(0.22 * B.w, B.y1 + 0.86 * B.h); ctx.closePath(); ctx.fill();
    },
    // the superstructure sits above the hull: it does not collide
    above: true,
  },
  box: {
    pal: [['#b07a43', '#7a5128'], ['#c79a5b', '#8a6233'], ['#8d6a4a', '#5b412b'], ['#3f7fb8', '#25507a'], ['#c0473b', '#7f2a22']],
    paint(ctx, sh, B, P) {
      ctx.strokeStyle = P[1]; ctx.lineWidth = 0.07 * B.w;
      const m = 0.11 * B.w;
      ctx.strokeRect(B.x0 + m, B.y0 + m, B.w - 2 * m, B.h - 2 * m);
      ctx.beginPath(); ctx.moveTo(B.x0 + m, B.y0 + m); ctx.lineTo(B.x1 - m, B.y1 - m); ctx.stroke();
      ctx.lineWidth = 0.025 * B.w;
      for (const f of [0.38, 0.62]) { ctx.beginPath(); ctx.moveTo(B.x0 + m, B.y0 + f * B.h); ctx.lineTo(B.x1 - m, B.y0 + f * B.h); ctx.stroke(); }
    },
  },
  ball: {
    pal: [['#ffffff', '#e8453c', '#2f7fe0', '#ffd23a'], ['#ffffff', '#ff7ab6', '#4fd1c5', '#ffd23a'], ['#ffffff', '#3fbf5f', '#ff9b2f', '#7a5cff']],
    paint(ctx, sh, B, P) {
      const R = sh.r, cx = sh.v[0], cy = sh.v[1];
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = k % 2 ? P[0] : P[1 + (k >> 1) % 3];
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, (k * Math.PI) / 3, ((k + 1) * Math.PI) / 3); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = P[0]; ctx.beginPath(); ctx.arc(cx, cy, 0.22 * R, 0, 2 * Math.PI); ctx.fill();
    },
  },
  log: {
    pal: [['#7a5230', '#4f331c'], ['#8f6a45', '#5a4129'], ['#6b4b33', '#3d2a1b']],
    paint(ctx, sh, B, P, rnd) {
      ctx.strokeStyle = P[1]; ctx.lineWidth = 0.06 * B.h;
      for (let k = 0; k < 4; k++) {
        const y = B.y0 + (0.25 + 0.17 * k) * B.h, x0 = B.x0 + (0.15 + 0.2 * rnd()) * B.w;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + (0.25 + 0.3 * rnd()) * B.w, y); ctx.stroke();
      }
      // cut end with rings
      const ex = sh.v[2], ey = sh.v[3], R = sh.r * 0.82;
      ctx.fillStyle = '#d9b07a'; ctx.beginPath(); ctx.ellipse(ex, ey, 0.45 * R, R, 0, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = '#a77a45'; ctx.lineWidth = 0.08 * R;
      for (const f of [0.35, 0.7]) { ctx.beginPath(); ctx.ellipse(ex, ey, 0.45 * R * f, R * f, 0, 0, 2 * Math.PI); ctx.stroke(); }
    },
  },
  plank: {
    pal: [['#d8b07a', '#a8804f'], ['#c79a5b', '#8f6a3c'], ['#e6c99a', '#b0925e'], ['#9a6b45', '#6d4a2e']],
    paint(ctx, sh, B, P, rnd) {
      ctx.strokeStyle = P[1]; ctx.lineWidth = 0.1 * B.h;
      for (let k = 0; k < 3; k++) {
        const y = B.y0 + (0.3 + 0.2 * k) * B.h, x0 = B.x0 + 0.05 * B.w + 0.3 * rnd() * B.w;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.bezierCurveTo(x0 + 0.2 * B.w, y + 0.08 * B.h, x0 + 0.35 * B.w, y - 0.08 * B.h, x0 + 0.55 * B.w, y); ctx.stroke();
      }
      ctx.fillStyle = P[1];
      for (const f of [0.08, 0.92]) { ctx.beginPath(); ctx.arc(B.x0 + f * B.w, B.y0 + 0.5 * B.h, 0.12 * B.h, 0, 2 * Math.PI); ctx.fill(); }
    },
  },
  buoy: {
    pal: [['#ff4a3a', '#ffffff'], ['#ff9b2f', '#ffffff'], ['#ffd23a', '#20242c'], ['#3fbf5f', '#ffffff']],
    paint(ctx, sh, B, P) {
      const R = sh.r, cx = sh.v[0], cy = sh.v[1];
      ctx.save(); outline(ctx, sh); ctx.clip();
      ctx.fillStyle = P[1];
      for (const f of [-0.45, 0.25]) ctx.fillRect(cx - R, cy + f * R, 2 * R, 0.25 * R);
      ctx.restore();
      ctx.fillStyle = '#20242c'; ctx.fillRect(cx - 0.08 * R, cy + 0.95 * R, 0.16 * R, 0.55 * R);
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(cx, cy + 1.55 * R, 0.13 * R, 0, 2 * Math.PI); ctx.fill();
    },
    above: true,
  },
  ice: {
    pal: [['#cfeeff', '#ffffff'], ['#bfe4ff', '#f2fbff'], ['#d9f6f2', '#ffffff']],
    alpha: 0.82,
    paint(ctx, sh, B, P) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.06 * B.w;
      ctx.beginPath(); ctx.moveTo(B.x0 + 0.2 * B.w, B.y1 - 0.18 * B.h); ctx.lineTo(B.x0 + 0.55 * B.w, B.y1 - 0.18 * B.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(B.x0 + 0.2 * B.w, B.y1 - 0.18 * B.h); ctx.lineTo(B.x0 + 0.2 * B.w, B.y1 - 0.45 * B.h); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,180,220,0.5)'; ctx.lineWidth = 0.03 * B.w;
      ctx.beginPath(); ctx.moveTo(B.x0 + 0.3 * B.w, B.y0 + 0.3 * B.h); ctx.lineTo(B.x0 + 0.6 * B.w, B.y0 + 0.55 * B.h); ctx.lineTo(B.x0 + 0.75 * B.w, B.y0 + 0.4 * B.h); ctx.stroke();
    },
  },
  bottle: {
    pal: [['#3fa66b', '#f2e6c9'], ['#4a86d8', '#ffffff'], ['#9b5a2a', '#f2d27a'], ['#c9d6dc', '#e8453c']],
    alpha: 0.88,
    paint(ctx, sh, B, P) {
      ctx.fillStyle = P[1];
      ctx.fillRect(B.x0 + 0.3 * B.w, B.y0 + 0.05 * B.h, 0.3 * B.w, 0.9 * B.h);
      ctx.fillStyle = '#e8453c';
      ctx.fillRect(B.x1 - 0.06 * B.w, B.y0 + 0.3 * B.h, 0.06 * B.w, 0.4 * B.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.1 * B.h;
      ctx.beginPath(); ctx.moveTo(B.x0 + 0.1 * B.w, B.y1 - 0.25 * B.h); ctx.lineTo(B.x0 + 0.28 * B.w, B.y1 - 0.25 * B.h); ctx.stroke();
    },
  },
  rock: {
    pal: [['#7d8592', '#4f5561'], ['#8a7d6e', '#594f44'], ['#5d6470', '#3a3f48'], ['#9a8f86', '#6a625c']],
    paint(ctx, sh, B, P, rnd) {
      ctx.fillStyle = P[1];
      for (let k = 0; k < 9; k++) {
        const x = B.x0 + (0.2 + 0.6 * rnd()) * B.w, y = B.y0 + (0.2 + 0.6 * rnd()) * B.h;
        ctx.beginPath(); ctx.arc(x, y, (0.03 + 0.04 * rnd()) * B.w, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.05 * B.w;
      ctx.beginPath(); ctx.moveTo(B.x0 + 0.25 * B.w, B.y1 - 0.2 * B.h); ctx.lineTo(B.x0 + 0.55 * B.w, B.y1 - 0.12 * B.h); ctx.stroke();
    },
  },
};

// opt: { tint: [hex, amount] (a theme tint), outline: css colour, glow }
function paintLocal(ctx, b, opt, s) {
  const L = LOOKS[b.kind] || LOOKS.box, sh = b.shape, B = bbox(sh);
  const P = L.pal[(b.colour || 0) % L.pal.length].map(c => (opt.tint ? mix(c, opt.tint[0], opt.tint[1]) : c));
  const rnd = hashLook(b.look || 1);
  ctx.globalAlpha = L.alpha || 1;
  outline(ctx, sh);
  // a soft vertical shade: lighter on top
  const g = ctx.createLinearGradient(0, B.y0, 0, B.y1);
  g.addColorStop(0, mix(P[0], '#000000', 0.22)); g.addColorStop(1, mix(P[0], '#ffffff', 0.12));
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); outline(ctx, sh); if (!L.above && !L.noclip) ctx.clip();
  L.paint(ctx, sh, B, P, rnd);
  ctx.restore();
  ctx.globalAlpha = 1;
  outline(ctx, sh);
  ctx.lineWidth = Math.max(1.2 / s, 0.012 * Math.min(B.w, B.h) * 4); ctx.strokeStyle = opt.outline || 'rgba(10,14,22,0.85)'; ctx.stroke();
}

// Draw a body on the screen. view = { x, y, s, H } of render.js.
export function drawBody(ctx, b, view, opt = {}) {
  const X = view.x + b.x * view.s, Y = view.y + (view.H - b.y) * view.s;
  ctx.save();
  ctx.setTransform(view.s * Math.cos(b.a), -view.s * Math.sin(b.a), -view.s * Math.sin(b.a), -view.s * Math.cos(b.a), X, Y);
  if (b.grab || opt.hot) { ctx.shadowColor = 'rgba(255,210,122,0.9)'; ctx.shadowBlur = 14; }
  paintLocal(ctx, b, opt, view.s);
  ctx.restore();
}

// A palette icon: the kind at a size that fills px x px.
export function drawIcon(ctx, kind, px, colour = 0, shape = null) {
  const K = KINDS[kind];
  const sh = shape || K.shape(1, hashLook(7));
  const B = bbox(sh), extra = (LOOKS[kind] && LOOKS[kind].above) ? 0.9 : 0;
  const s = (0.78 * px) / Math.max(B.w, B.h * (1 + extra));
  const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1 + extra * B.h) / 2;
  ctx.save();
  ctx.transform(s, 0, 0, -s, px / 2 - cx * s, px / 2 + cy * s);
  paintLocal(ctx, { kind, shape: sh, colour, look: 7 }, {}, s);
  ctx.restore();
}

export const KIND_LOOKS = LOOKS;

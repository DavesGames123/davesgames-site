// ============================================================================
//  SPIROGRAPH  ·  rig.js — the plastic gears as canvas sprites
// ----------------------------------------------------------------------------
//  The gears look like the toy: clear tinted plastic, a thin molded edge, a
//  tooth count in the plastic, and punched pen holes. Each gear is drawn
//  once into its own canvas at device resolution. main.js draws the sprites
//  each frame with a turn, so a frame costs two drawImage calls.
//
//  The sprite of a gear is square, with the gear center at its center. k is
//  device pixels per gear unit (spiro.js has the units).
//
//  EXPORTS   (jump with grep -n "<anchor>" rig.js)
//      gearPath ...... "export function gearPath"    tooth outline as Path2D
//      drawFixed ..... "export function drawFixed"   the ring or the fixed wheel
//      fixedSprite ... "export function fixedSprite" drawFixed in a sprite
//      wheelSprite ... "export function wheelSprite" the rolling wheel
//      wheelTint ..... "export function wheelTint"   plastic color by teeth
// ============================================================================
import { TAU, ADD, DED, toothRadius, holes, ringRim } from './spiro.js';

const TINTS = ['#e0587c', '#ec9a1c', '#33a874', '#3a86dc', '#9468d6', '#d9bf2c'];
export function wheelTint(r) { return TINTS[r % TINTS.length]; }

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// The tooth outline of an N-tooth gear centered at (cx, cy), k px per unit.
export function gearPath(N, k, cx, cy, phase0, internal, path = new Path2D()) {
  const n = N * 24;          // 24 points a tooth: no flat facets in the close saver view
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU, rr = toothRadius(N, a, phase0, internal) * k;
    const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
    if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

function plastic(ctx, path, tint, night, dpr) {
  ctx.fillStyle = rgba(tint, night ? 0.2 : 0.17);
  ctx.fill(path, 'evenodd');
  // A light line just inside the edge reads as the thickness of the plastic.
  ctx.save();
  ctx.translate(-0.7 * dpr, -0.7 * dpr);
  ctx.lineWidth = 1 * dpr; ctx.strokeStyle = night ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)';
  ctx.stroke(path);
  ctx.restore();
  ctx.lineWidth = 1 * dpr; ctx.strokeStyle = night ? rgba(tint, 0.8) : rgba(tint, 0.62);
  ctx.stroke(path);
}

function engrave(ctx, text, x, y, size, tint, night) {
  ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(tint, night ? 0.5 : 0.55);
  ctx.fillText(text, x, y);
}

// The fixed gear: a ring with R inner teeth (inside mode), or a wheel with
// R outer teeth (outside mode). Teeth are centered at 2 pi k / R. drawFixed
// draws it about (0, 0) of ctx. The saver draws it as a vector each frame,
// so it stays sharp in the close view.
export function drawFixed(ctx, R, out, k, night, dpr) {
  const tint = night ? '#a9c4ff' : '#5f86b8';
  const path = new Path2D();
  if (out) {
    gearPath(R, k, 0, 0, 0, false, path);
    path.moveTo(0.06 * R * k, 0); path.arc(0, 0, 0.06 * R * k, 0, TAU);
  } else {
    const ro = (R + DED + ringRim(R)) * k;
    path.moveTo(ro, 0); path.arc(0, 0, ro, 0, TAU);
    gearPath(R, k, 0, 0, 0, true, path);
  }
  plastic(ctx, path, tint, night, dpr);
  const fs = Math.max(9 * dpr, Math.min(14 * dpr, 4.5 * k));
  if (out) engrave(ctx, String(R), 0, 0.06 * R * k + fs * 1.4, fs, tint, night);
  else engrave(ctx, String(R), 0, -(R + DED + ringRim(R) * 0.5) * k, fs, tint, night);
}
export function fixedSprite(R, out, k, night, dpr) {
  const ext = (out ? R + ADD : R + DED + ringRim(R)) + 2;
  const size = Math.ceil(2 * ext * k);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.translate(size / 2, size / 2);
  drawFixed(ctx, R, out, k, night, dpr);
  return cv;
}

// The rolling wheel with r outer teeth, centered at (j + 1/2) 2 pi / r, and
// its pen holes. sel is the index of the hole that holds the pen.
export function wheelSprite(r, k, night, dpr, sel) {
  const tint = wheelTint(r);
  const ext = r + ADD + 2, size = Math.ceil(2 * ext * k), c = size / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  plastic(ctx, gearPath(r, k, c, c, Math.PI / r, false), tint, night, dpr);
  const hs = holes(r), hr = Math.max(1.6 * dpr, 0.8 * k);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const h of hs) { ctx.beginPath(); ctx.arc(c + h.d * k * Math.cos(h.a), c + h.d * k * Math.sin(h.a), hr, 0, TAU); ctx.fill(); }
  ctx.restore();
  ctx.lineWidth = 0.9 * dpr;
  hs.forEach((h, i) => {
    ctx.strokeStyle = rgba(tint, i === sel ? 0.95 : (night ? 0.5 : 0.55));
    ctx.beginPath(); ctx.arc(c + h.d * k * Math.cos(h.a), c + h.d * k * Math.sin(h.a), hr, 0, TAU); ctx.stroke();
  });
  // the hub mark and the tooth count
  ctx.strokeStyle = rgba(tint, 0.6); ctx.lineWidth = 1 * dpr;
  const m = Math.max(3 * dpr, 1.2 * k);
  ctx.beginPath(); ctx.moveTo(c - m, c); ctx.lineTo(c + m, c); ctx.moveTo(c, c - m); ctx.lineTo(c, c + m); ctx.stroke();
  if (r >= 28) {
    const fs = Math.max(8 * dpr, Math.min(13 * dpr, 3.6 * k));
    engrave(ctx, String(r), c, c + (r - DED - 3.2) * k, fs, tint, night);
  }
  return cv;
}

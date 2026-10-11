// ============================================================================
//  MANIM LIVE  ·  engine-canvas.js  (the JS half of the cairo shim)
// ----------------------------------------------------------------------------
//  py/cairo/__init__.py records pycairo calls as one Float64Array of op codes
//  and numbers. cairoFlush() runs that list on a 2D canvas context in ONE
//  call, with the surface pixels uploaded first and read back after, so the
//  numpy array that manim gave to ImageSurface.create_for_data holds the
//  drawn pixels when the call returns.
//
//  The same function runs in the worker (OffscreenCanvas) and in the Node
//  harness (@napi-rs/canvas). Only getContext(w, h) differs.
//
//  PIXELS. cairo ARGB32 memory is premultiplied, native-endian ARGB, that is
//  the bytes B,G,R,A on wasm. A cairo colour (r, g, b) therefore lands in
//  the bytes (b, g, r). Manim knows this and passes its colours reversed
//  (Camera.set_cairo_context_color), so that the numpy array reads as R,G,B,A.
//  Canvas ImageData bytes are R,G,B,A. So the surface bytes go to the canvas
//  unchanged, and each cairo colour (r, g, b) is given to the canvas as
//  rgb(b, g, r): the bytes then match what native cairo writes.
//  Canvas ImageData is straight alpha, cairo is premultiplied. Pixels with
//  alpha < 255 are converted both ways; opaque frames skip that loop.
//
//  GREP MAP
//    grep -n 'export const OP'        op codes (same table as the Python side)
//    grep -n 'export function cairoFlush'
//    grep -n 'function premultiply'   alpha conversion
// ============================================================================

export const OP = {
  NEW_PATH: 1, MOVE_TO: 2, LINE_TO: 3, CURVE_TO: 4, CLOSE_PATH: 5,
  RGBA: 6, LINEAR: 7, RADIAL: 8, FILL: 9, STROKE: 10,
  LINE_WIDTH: 11, LINE_CAP: 12, LINE_JOIN: 13, MATRIX: 14,
  RECT: 17, ARC: 18, ARC_NEG: 19, FILL_RULE: 20, CLIP: 21, RESET_CLIP: 22,
  PAINT: 23, DASH: 24, MITER: 25, OPERATOR: 26,
};

const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];
const RULES = ['nonzero', 'evenodd'];
const OPERATORS = {
  0: 'destination-out', 1: 'copy', 2: 'source-over', 3: 'source-in', 4: 'source-out',
  5: 'source-atop', 6: 'source-over', 7: 'destination-over', 8: 'destination-in',
  9: 'destination-out', 10: 'destination-atop', 11: 'xor', 12: 'lighter', 13: 'lighter',
  14: 'multiply', 15: 'screen', 16: 'overlay', 17: 'darken', 18: 'lighten',
};
const TAU = Math.PI * 2;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function css(r, g, b, a) {
  return `rgba(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)},${clamp01(a)})`;
}

// Straight -> premultiplied (to cairo) or back (to canvas), in place.
function premultiply(data, toPremul) {
  const n = data.length;
  for (let i = 3; i < n; i += 4) {
    const a = data[i];
    if (a === 255) continue;
    if (a === 0) { data[i - 3] = data[i - 2] = data[i - 1] = 0; continue; }
    if (toPremul) {
      const f = a / 255;
      data[i - 3] = Math.round(data[i - 3] * f);
      data[i - 2] = Math.round(data[i - 2] * f);
      data[i - 1] = Math.round(data[i - 1] * f);
    } else {
      const f = 255 / a;
      data[i - 3] = Math.min(255, Math.round(data[i - 3] * f));
      data[i - 2] = Math.min(255, Math.round(data[i - 2] * f));
      data[i - 1] = Math.min(255, Math.round(data[i - 1] * f));
    }
  }
}

function hasTranslucent(px, n) {
  for (let i = 3; i < n; i += 4) if (px[i] !== 255) return true;
  return false;
}

// Upload surface bytes -> canvas, run ops, read the canvas back into px.
//   ctx     CanvasRenderingContext2D-like of size w x h
//   px      Uint8Array view of the surface memory (stride bytes per row)
//   format  0 = ARGB32, 1 = RGB24
//   ops     Float64Array from py/cairo
export function cairoFlush(ctx, w, h, stride, format, px, ops) {
  const rowBytes = w * 4;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  if (stride === rowBytes) d.set(px.subarray(0, rowBytes * h));
  else for (let y = 0; y < h; y++) d.set(px.subarray(y * stride, y * stride + rowBytes), y * rowBytes);
  if (format === 1) { for (let i = 3; i < d.length; i += 4) d[i] = 255; }
  const translucentIn = format === 0 && hasTranslucent(d, d.length);
  if (translucentIn) premultiply(d, false);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.putImageData(img, 0, 0);
  ctx.save(); // clip frame: RESET_CLIP restores to here

  let strokeOn = true; // cairo line width 0 draws nothing; canvas ignores 0
  let fillRule = 'nonzero';
  let i = 0;
  const n = ops.length;
  ctx.beginPath();
  while (i < n) {
    const op = ops[i++];
    switch (op) {
      case 1: ctx.beginPath(); break;
      case 2: ctx.moveTo(ops[i], ops[i + 1]); i += 2; break;
      case 3: ctx.lineTo(ops[i], ops[i + 1]); i += 2; break;
      case 4: ctx.bezierCurveTo(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5]); i += 6; break;
      case 5: ctx.closePath(); break;
      case 6: {
        const c = css(ops[i + 2], ops[i + 1], ops[i], ops[i + 3]); i += 4; // cairo (r,g,b) -> bytes (b,g,r)
        ctx.fillStyle = c; ctx.strokeStyle = c; break;
      }
      case 7: case 8: {
        let g;
        if (op === 7) { g = ctx.createLinearGradient(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]); i += 4; }
        else { g = ctx.createRadialGradient(ops[i], ops[i + 1], Math.max(0, ops[i + 2]), ops[i + 3], ops[i + 4], Math.max(0, ops[i + 5])); i += 6; }
        const count = ops[i++];
        for (let k = 0; k < count; k++) {
          g.addColorStop(clamp01(ops[i]), css(ops[i + 3], ops[i + 2], ops[i + 1], ops[i + 4]));
          i += 5;
        }
        if (count === 0) g.addColorStop(0, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.strokeStyle = g; break;
      }
      case 9: ctx.fill(fillRule); if (!ops[i++]) ctx.beginPath(); break;
      case 10: if (strokeOn) ctx.stroke(); if (!ops[i++]) ctx.beginPath(); break;
      case 11: { const lw = ops[i++]; strokeOn = lw > 0; if (strokeOn) ctx.lineWidth = lw; break; }
      case 12: ctx.lineCap = CAPS[ops[i++]] || 'butt'; break;
      case 13: ctx.lineJoin = JOINS[ops[i++]] || 'miter'; break;
      case 14: ctx.setTransform(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5]); i += 6; break;
      case 17: ctx.rect(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]); i += 4; break;
      case 18: case 19: {
        const xc = ops[i], yc = ops[i + 1], r = ops[i + 2], a1 = ops[i + 3];
        let a2 = ops[i + 4]; i += 5;
        if (op === 18) { while (a2 < a1) a2 += TAU; }
        else { while (a2 > a1) a2 -= TAU; }
        ctx.arc(xc, yc, Math.max(0, r), a1, a2, op === 19);
        break;
      }
      case 20: fillRule = RULES[ops[i++]] || 'nonzero'; break;
      case 21: ctx.clip(fillRule); if (!ops[i++]) ctx.beginPath(); break;
      case 22: ctx.restore(); ctx.save(); break;
      case 23: {
        const alpha = ops[i++];
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        break;
      }
      case 24: {
        const count = ops[i++]; const offset = ops[i++];
        const arr = [];
        for (let k = 0; k < count; k++) arr.push(ops[i++]);
        ctx.setLineDash(arr); ctx.lineDashOffset = offset; break;
      }
      case 25: ctx.miterLimit = ops[i++]; break;
      case 26: ctx.globalCompositeOperation = OPERATORS[ops[i++]] || 'source-over'; break;
      default:
        throw new Error('cairo shim: unknown op code ' + op + ' at ' + (i - 1));
    }
  }
  ctx.restore();
  ctx.restore();
  const out = ctx.getImageData(0, 0, w, h).data;
  if (format === 0 && (translucentIn || hasTranslucent(out, out.length))) premultiply(out, true);
  if (stride === rowBytes) px.set(out.subarray(0, rowBytes * h));
  else for (let y = 0; y < h; y++) px.set(out.subarray(y * rowBytes, (y + 1) * rowBytes), y * stride);
}

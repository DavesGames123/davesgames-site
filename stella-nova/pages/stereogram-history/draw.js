// ============================================================================
//  STEREOGRAM HISTORY  ·  draw.js — canvas drawing of the figures
// ----------------------------------------------------------------------------
//  Each function draws into a 2D context in CSS px (the caller sets the
//  transform) or writes an engine Image into a canvas. main.js and
//  saver.js use the same functions. The only DOM use is a canvas that
//  the caller gives.
//
//  grep -n targets
//    "export function putImage"     engine Image -> canvas (1:1)
//    "export function putPair"      two Images side by side
//    "export function depthImage"   DepthMap -> grey Image
//    "export function drawGeo"      01 top view of the eyes
//    "export function drawScope"    02 Wheatstone's mirror stereoscope
//    "export function drawWall"     02 Brewster's wallpaper
//    "export function drawRow"      04 one row and its links
//    "export function flowerTile"   a plain flower motif (no engine)
// ============================================================================
import * as G from './geometry.js';

export const PAL = {
  bg: '#05070c', ink: '#e8eaf0', ink2: '#c2c7d4', dim: '#8a91a5', faint: '#394155', line: 'rgba(255,255,255,0.14)',
  left: '#ff6b6b', right: '#5fd3e6', fix: '#ffd666', pt: '#e889dc', acc: '#6fe0c8', mirror: '#a8c8ff',
};
const FONT = (px, w = 400) => `${w} ${px}px Inter, system-ui, -apple-system, sans-serif`;

// An engine Image into a canvas, one image pixel per canvas pixel.
export function putImage(cv, img) {
  if (cv.width !== img.w) cv.width = img.w;
  if (cv.height !== img.h) cv.height = img.h;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
}

// Two Images side by side with a white gap.
export function putPair(cv, a, b, gap = 8) {
  const w = a.w + gap + b.w, h = Math.max(a.h, b.h);
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.putImageData(new ImageData(new Uint8ClampedArray(a.data), a.w, a.h), 0, 0);
  g.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), a.w + gap, 0);
}

// A DepthMap as a grey Image: near is light, the background is dark.
export function depthImage(d) {
  const out = new Uint8ClampedArray(d.w * d.h * 4);
  for (let i = 0; i < d.w * d.h; i++) {
    const v = d.mask && !d.mask[i] ? 18 : Math.round(30 + 225 * Math.max(0, Math.min(1, d.data[i])));
    out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = v; out[4 * i + 3] = 255;
  }
  return { w: d.w, h: d.h, data: out };
}

// ---------------------------------------------------------------- 01
// Top view. st: { I, F: {x,z}, P: {x,z}, view: { x0, x1, z1 } } in cm.
// Returns the mapping { sx, sz, inv } so that main.js can drag points.
export function drawGeo(g, w, h, st) {
  if (w < 60 || h < 60) return null; // no room (a hidden or unlaid canvas)
  const v = st.view, pad = 18;
  const s = Math.min((w - 2 * pad) / (v.x1 - v.x0), (h - 2 * pad - 30) / v.z1);
  const ox = w / 2, oz = h - pad - 22;
  const X = x => ox + x * s, Z = z => oz - z * s;
  const inv = (px, py) => ({ x: (px - ox) / s, z: (oz - py) / s });
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  // distance rules every 10 cm
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1; g.font = FONT(11); g.fillStyle = PAL.faint; g.textAlign = 'left'; g.textBaseline = 'middle';
  for (let z = 10; z <= v.z1; z += 10) { g.beginPath(); g.moveTo(pad, Z(z)); g.lineTo(w - pad, Z(z)); g.stroke(); g.fillText(`${z} cm`, pad + 2, Z(z) - 7); }
  const { I, F, P } = st;
  const vm = G.viethMuller(I, F);
  g.strokeStyle = 'rgba(255,214,102,0.5)'; g.setLineDash([5, 6]); g.lineWidth = 1.2;
  g.beginPath(); g.arc(X(vm.cx), Z(vm.cz), vm.r * s, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  const eyes = [{ x: -I / 2, c: PAL.left }, { x: I / 2, c: PAL.right }];
  const ray = (e, p, col, wid, dash) => { g.strokeStyle = col; g.lineWidth = wid; g.setLineDash(dash || []); g.beginPath(); g.moveTo(X(e.x), Z(0)); g.lineTo(X(p.x), Z(p.z)); g.stroke(); g.setLineDash([]); };
  for (const e of eyes) { ray(e, F, PAL.fix, 1.6); ray(e, P, PAL.pt, 1.3, [4, 4]); }
  // vergence arcs at the two points
  const arc = (p, col, rr) => {
    const a = Math.atan2(Z(0) - Z(p.z), X(-I / 2) - X(p.x)), b = Math.atan2(Z(0) - Z(p.z), X(I / 2) - X(p.x));
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(X(p.x), Z(p.z), rr, Math.min(a, b), Math.max(a, b)); g.stroke();
  };
  arc(F, PAL.fix, 26); arc(P, PAL.pt, 20);
  // head and eyes
  g.fillStyle = '#121725'; g.strokeStyle = PAL.line; g.lineWidth = 1;
  g.beginPath(); g.ellipse(X(0), Z(0) + 16, I * s * 0.95, 20, 0, Math.PI, 0); g.fill(); g.stroke();
  for (const e of eyes) { g.fillStyle = e.c; g.beginPath(); g.arc(X(e.x), Z(0), 6, 0, Math.PI * 2); g.fill(); }
  const dot = (p, col, lbl) => {
    g.fillStyle = col; g.beginPath(); g.arc(X(p.x), Z(p.z), 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = col; g.font = FONT(12, 500); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lbl, X(p.x) + 13, Z(p.z));
  };
  dot(F, PAL.fix, 'F, fixation'); dot(P, PAL.pt, 'P');
  g.font = FONT(11); g.fillStyle = PAL.dim; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('left eye', X(-I / 2) - 30, Z(0) + 18); g.fillText('right eye', X(I / 2) + 32, Z(0) + 18);
  return { inv, X, Z, s };
}

// ---------------------------------------------------------------- 02
// Wheatstone's stereoscope from above, after the 1838 description: two
// mirrors with their backs at 90 degrees on the midline, a picture on
// each side facing its mirror, an eye before each mirror.
export function drawScope(g, w, h, t = 0) {
  if (w < 60 || h < 60) return null; // no room (a hidden or unlaid canvas)
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  const u = Math.min(w, h) / 34, ox = w / 2, oy = h - 2.2 * u;
  const P = (x, z) => [ox + x * u, oy - z * u];
  const line = (a, b, col, wid, dash) => { g.strokeStyle = col; g.lineWidth = wid; g.setLineDash(dash || []); g.beginPath(); g.moveTo(...P(...a)); g.lineTo(...P(...b)); g.stroke(); g.setLineDash([]); };
  const vz = 14, eyeX = 3.2, panelX = 14;
  // mirrors: from the common edge (0, vz) toward the viewer at 45 degrees
  for (const sgn of [-1, 1]) {
    line([0, vz], [sgn * 6.5, vz - 6.5], PAL.mirror, 3);
    // picture board facing the mirror
    line([sgn * panelX, vz - 9], [sgn * panelX, vz - 1], PAL.ink2, 4);
    // the line of sight: eye -> mirror -> picture
    const hitZ = vz - eyeX, col = sgn < 0 ? PAL.left : PAL.right;
    line([sgn * eyeX, 0], [sgn * eyeX, hitZ], col, 1.6);
    line([sgn * eyeX, hitZ], [sgn * panelX, hitZ], col, 1.6);
    // the virtual image: behind the mirror, straight ahead of the eye
    const dist = hitZ + (panelX - eyeX);
    line([sgn * eyeX, hitZ], [sgn * eyeX, dist], col, 1, [3, 4]);
    g.fillStyle = col; g.beginPath(); g.arc(...P(sgn * eyeX, 0), u * 0.5, 0, Math.PI * 2); g.fill();
  }
  // where the two images appear: the eyes converge on the midline
  const dist = vz - eyeX + (panelX - eyeX);
  line([-eyeX, 0], [0, dist + 1.5], 'rgba(255,214,102,0.55)', 1, [2, 5]);
  line([eyeX, 0], [0, dist + 1.5], 'rgba(255,214,102,0.55)', 1, [2, 5]);
  const pulse = 0.6 + 0.4 * Math.sin(t * 2);
  g.fillStyle = `rgba(255,214,102,${pulse})`; g.beginPath(); g.arc(...P(0, dist + 1.5), u * 0.55, 0, Math.PI * 2); g.fill();
  const fs = Math.max(11, Math.round(u * 0.85));
  g.font = FONT(fs); g.textBaseline = 'middle';
  const lbl = (txt, x, z, al = 'center', col = PAL.dim) => { g.fillStyle = col; g.textAlign = al; g.fillText(txt, ...P(x, z)); };
  lbl('left picture', -panelX, vz - 10.2); lbl('right picture', panelX, vz - 10.2);
  lbl('two mirrors, backs at 90°', 0, vz + 1.2, 'center', PAL.mirror);
  lbl('both images seen here', 0, dist + 3, 'center', PAL.fix);
  lbl('left eye', -eyeX - 0.8, -1.2, 'right'); lbl('right eye', eyeX + 0.8, -1.2, 'left');
}

// Brewster's wallpaper. tile: a canvas (or image) one period wide. The
// strip between x = a and x = b (CSS px) is drawn shift px out of line.
export function drawWall(g, w, h, tile, period, shift) {
  g.fillStyle = '#f6f1e6'; g.fillRect(0, 0, w, h);
  const th = tile.height * period / tile.width;
  const paint = dx => { for (let y = 0; y < h; y += th) for (let x = -period + (dx % period); x < w + period; x += period) g.drawImage(tile, Math.round(x), Math.round(y), period, th); };
  const a = Math.round(w / 2 - 1.5 * period), b = Math.round(w / 2 + 1.5 * period);
  g.save(); g.beginPath(); g.rect(0, 0, a, h); g.rect(b, 0, w - b, h); g.clip(); paint(0); g.restore();
  g.save(); g.beginPath(); g.rect(a, 0, b - a, h); g.clip(); paint(shift); g.restore();
  return { a, b };
}

// A plain flower motif, drawn here (used when the engine has no tile).
export function flowerTile(cv, size = 80) {
  cv.width = cv.height = size;
  const g = cv.getContext('2d'), c = size / 2;
  g.fillStyle = '#f6f1e6'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#b8473f';
  for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5; g.beginPath(); g.ellipse(c + Math.cos(a) * size * 0.16, c + Math.sin(a) * size * 0.16, size * 0.13, size * 0.08, a, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#e8b33c'; g.beginPath(); g.arc(c, c, size * 0.07, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4c7a3d'; g.lineWidth = size * 0.04; g.beginPath(); g.moveTo(c, c + size * 0.2); g.quadraticCurveTo(c + size * 0.12, c + size * 0.38, c + size * 0.05, size); g.stroke();
  return cv;
}

// ---------------------------------------------------------------- 04
// One row: the depth profile on top, the dots at the bottom, and arcs
// for the links. st: { z (Float32Array), same (Int32Array), colours,
// upTo (pixels built so far), rule 'look'|'sym', sepFar, sepNear }.
export function drawRow(g, w, h, st) {
  if (w < 60 || h < 60) return null; // no room (a hidden or unlaid canvas)
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  const n = st.z.length, pad = 14, sx = (w - 2 * pad) / n, X = x => pad + (x + 0.5) * sx;
  const fs = Math.max(11, Math.round(h / 26));
  const top = pad + fs + 4, ph = h * 0.3, base = top + ph;
  // depth profile
  g.font = FONT(fs); g.fillStyle = PAL.dim; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('depth of the row (near is up)', pad, pad + fs * 0.8);
  g.strokeStyle = PAL.faint; g.beginPath(); g.moveTo(pad, base); g.lineTo(w - pad, base); g.stroke();
  g.strokeStyle = PAL.acc; g.lineWidth = 2; g.beginPath();
  for (let x = 0; x < n; x++) { const y = base - st.z[x] * ph; x ? g.lineTo(X(x), y) : g.moveTo(X(x), y); }
  g.stroke();
  // dot row
  const rowY = h - pad - Math.max(16, h * 0.08), rowH = Math.max(14, h * 0.07);
  const built = st.upTo ?? n;
  for (let x = 0; x < n; x++) {
    const done = st.rule === 'look' ? x < built : x >= n - built;
    g.fillStyle = done ? st.colours[x] : '#1b2030';
    g.fillRect(pad + x * sx, rowY, Math.ceil(sx), rowH);
  }
  // links: arcs from each linked pixel to its partner, every k-th pixel
  const k = Math.max(1, Math.round(n / 70)), lblY = base + fs + 8, arcTop = lblY + 8;
  g.fillStyle = PAL.dim; g.font = FONT(fs); g.textAlign = 'left';
  g.fillText(st.rule === 'look' ? 'each dot copies the dot one repeat to its left' : 'each surface point links two dots, evenly about it', pad, lblY);
  g.textAlign = 'right';
  g.fillText(`repeat ${st.sepNear}-${st.sepFar} px`, w - pad, lblY);
  g.lineWidth = 1;
  for (let x = 0; x < n; x += k) {
    const y = st.same[x]; if (y === x) continue;
    const done = st.rule === 'look' ? x < built : x >= n - built;
    if (!done) continue;
    const a = X(Math.min(x, y)), b = X(Math.max(x, y)), hgt = Math.max(4, rowY - arcTop);
    g.strokeStyle = `rgba(111,224,200,${0.25 + 0.5 * st.z[x]})`;
    g.beginPath(); g.moveTo(a, rowY); g.bezierCurveTo(a, rowY - hgt * 1.3, b, rowY - hgt * 1.3, b, rowY); g.stroke();
  }
}

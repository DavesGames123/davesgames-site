// ============================================================================
//  SSTV  ·  built-in pictures  (ES module, pure: node and browser)
// ----------------------------------------------------------------------------
//  Six test pictures that we draw ourselves from formulas, at any size, so
//  every mode gets a sharp picture at its own resolution and node tests
//  can use the same pixels. No photo or third-party art is in this file.
//    card    test card: grid, circle, colour bars, grey steps, gratings
//    bars    colour bars over a grey ramp
//    planet  a ringed planet, stars and a nebula
//    sunset  sea, sun and hills
//    zone    a zone plate: rings that get finer to the edge (resolution)
//    event   an orbital event card: Earth limb, a station, a frequency
//  Text uses a 5 x 7 block font (FONT) drawn as rectangles.
//
//  grep -n targets
//    "export const CARDS"     id, name, painter
//    "export function card"   render one card to RGBA
//    "export function cardFor" a card at a mode's display aspect
//    "export function fit"    resample any RGBA picture (cover crop)
//    "const FONT"             glyphs
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011111010001100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001111010000100001000011111', G: '01110100011000010111100011000101111',
  H: '10001100011111110001100011000110001', I: '01110001000010000100001000010001110', K: '10001100101110010010100101000110001',
  L: '10000100001000010000100001000011111', M: '10001110111010110001100011000110001', N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110', P: '11110100011111010000100001000010000', R: '11110100011111010100100101000110001',
  S: '01111100000111000001000011000101110', T: '11111001000010000100001000010000100', V: '10001100011000110001010100101000100',
  Z: '11111000010001000100010001000011111', '0': '01110100111010111001100011000101110', '1': '00100011000010000100001000010001110',
  '4': '00010001100101011111000100001000010', '5': '11111100001111000001000011000101110', '8': '01110100011000101110100011000101110',
  '.': '00000000000000000000000000110001100', '-': '00000000000000011111000000000000000', ' ': '0'.repeat(35),
};
// Text box test: is (x, y) (in pixels) on a glyph of str drawn at (x0, y0)
// with cell size s? Returns true or false.
function onText(str, x0, y0, s, x, y) {
  const cx = Math.floor((x - x0) / s), cy = Math.floor((y - y0) / s);
  if (cy < 0 || cy > 6 || cx < 0) return false;
  const gi = Math.floor(cx / 6), col = cx % 6;
  if (gi >= str.length || col > 4) return false;
  const g = FONT[str[gi]] || FONT[' '];
  return g[cy * 5 + col] === '1';
}
const textW = (str, s) => (str.length * 6 - 1) * s;

const BARS = [[235, 235, 235], [235, 235, 16], [16, 235, 235], [16, 235, 16], [235, 16, 235], [235, 16, 16], [16, 16, 235], [16, 16, 16]];

// Painters: (u, v, W, H) -> [r, g, b], u and v in 0..1.
function pCard(u, v, W, H) {
  const ar = W / H, x = (u - 0.5) * ar, y = v - 0.5;
  let c = [118, 118, 124];
  const gx = Math.abs(((u * 16) % 1) - 0.5) * W / 16, gy = Math.abs(((v * 12) % 1) - 0.5) * H / 12;
  if (Math.min(W / 16 / 2 - gx, H / 12 / 2 - gy) < 0.9) c = [236, 236, 236];
  const r = Math.hypot(x, y);
  if (r < 0.42) {
    if (y < -0.2) { const i = clamp(Math.floor((x + 0.42) / 0.84 * 8), 0, 7); c = BARS[i]; }
    else if (y < -0.03) { const i = clamp(Math.floor((x + 0.42) / 0.84 * 6), 0, 5); const g = 16 + i * 43.8; c = [g, g, g]; }
    else if (y < 0.16) {
      const k = clamp(Math.floor((x + 0.42) / 0.84 * 5), 0, 4), f = [3, 6, 12, 24, 48][k];
      const s = Math.sin(x * f * Math.PI * 2 * W / 320) > 0 ? 235 : 16; c = [s, s, s];
    } else {
      const t = clamp((x + 0.42) / 0.84, 0, 1);
      c = [mix(220, 30, t), mix(60, 140, Math.sin(t * Math.PI)), mix(40, 230, t)];
    }
    if (Math.abs(r - 0.42) < 1.6 / H) c = [250, 250, 250];
  }
  const s = Math.max(1, Math.floor(H / 40)), str = 'SSTV', tw = textW(str, s);
  const px = u * W, py = v * H;
  if (py > H * 0.86 - 7 * s - 2 && py < H * 0.86 + 2 && px > (W - tw) / 2 - 3 * s && px < (W + tw) / 2 + 3 * s) {
    c = [16, 16, 16];
    if (onText(str, (W - tw) / 2, H * 0.86 - 7 * s, s, px, py)) c = [240, 240, 240];
  }
  // corner markers
  if ((u < 0.06 || u > 0.94) && (v < 0.08 || v > 0.92)) c = (u < 0.5) === (v < 0.5) ? [235, 235, 235] : [16, 16, 16];
  return c;
}
function pBars(u, v) {
  if (v < 0.66) return BARS[clamp(Math.floor(u * 8), 0, 7)];
  if (v < 0.76) { const i = clamp(Math.floor(u * 8), 0, 7); return i % 2 ? [16, 16, 16] : BARS[7 - i]; }
  const g = 16 + 219 * u;
  return v < 0.88 ? [g, g, g] : (u * 11 | 0) % 2 ? [235, 235, 235] : [16, 16, 16];
}
function pPlanet(u, v, W, H) {
  const ar = W / H, x = (u - 0.5) * ar, y = v - 0.5;
  // sky: nebula + stars
  let r = 6 + 40 * smooth(0.9, 0, Math.hypot(x + 0.5, y + 0.3)), g = 8 + 14 * smooth(0.8, 0, Math.hypot(x + 0.4, y + 0.35)), b = 26 + 60 * smooth(1.0, 0, Math.hypot(x + 0.3, y + 0.25));
  r += 50 * smooth(0.5, 0, Math.hypot(x - 0.55, y + 0.3)) ; b += 30 * smooth(0.5, 0, Math.hypot(x - 0.55, y + 0.3));
  const sx = Math.floor(u * W), sy = Math.floor(v * H), h = hash(sx, sy);
  if (h > 0.985) { const k = (h - 0.985) / 0.015 * 230; r += k; g += k; b += k; }
  const cx = 0.08, cy = 0.04, R = 0.27;
  const dx = x - cx, dy = y - cy;
  // ring (tilted ellipse)
  const rx = dx * Math.cos(-0.35) - dy * Math.sin(-0.35), ry = dx * Math.sin(-0.35) + dy * Math.cos(-0.35);
  const er = Math.hypot(rx / 1.0, ry / 0.24);
  const ring = er > 0.36 && er < 0.5 ? 0.55 + 0.45 * Math.sin(er * 120) * Math.sin(er * 37) : 0;
  const d = Math.hypot(dx, dy);
  const front = ry > 0;
  if (ring && !(d < R && !front)) { const k = ring * 0.85; r = mix(r, 225, k); g = mix(g, 196, k); b = mix(b, 150, k); }
  if (d < R && !(ring && front)) {
    const z = Math.sqrt(1 - (d / R) ** 2), lit = clamp(0.25 + 0.85 * ((-dx * 0.6 - dy * 0.5) / R + z * 0.6), 0.05, 1.2);
    const band = 0.5 + 0.5 * Math.sin((dy / R) * 13 + Math.sin(dx * 9) * 0.6);
    r = (180 + 60 * band) * lit; g = (120 + 50 * band) * lit; b = (70 + 30 * band) * lit;
    // shadow of the ring on the planet
    if (Math.abs(ry + 0.02) < 0.012 && dx < 0) { r *= 0.45; g *= 0.45; b *= 0.45; }
  }
  // a moon
  const md = Math.hypot(x + 0.45, y - 0.28);
  if (md < 0.05) { const l = clamp(0.4 + 6 * (-(x + 0.45) - (y - 0.28)) , 0.15, 1); r = 200 * l; g = 205 * l; b = 215 * l; }
  return [r, g, b];
}
function pSunset(u, v, W, H) {
  const ar = W / H, x = (u - 0.5) * ar;
  const hz = 0.62;
  let c;
  if (v < hz) {
    const t = v / hz;
    c = [mix(40, 255, t ** 1.4), mix(30, 140, t ** 2), mix(90, 80, t)];
    const sd = Math.hypot(x - 0.1, v - 0.5);
    if (sd < 0.11) c = [255, 236, 170];
    else { const gl = smooth(0.45, 0.1, sd); c = [mix(c[0], 255, gl), mix(c[1], 190, gl), mix(c[2], 120, gl * 0.6)]; }
    const hill = hz - 0.07 - 0.05 * Math.sin(u * 7 + 1) - 0.03 * Math.sin(u * 19);
    if (v > hill) c = [mix(40, 25, (v - hill) * 8), 22, 48];
  } else {
    const t = (v - hz) / (1 - hz);
    c = [mix(150, 20, t), mix(70, 20, t), mix(90, 60, t)];
    const wave = Math.sin(v * 220 + Math.sin(u * 40) * 2) > 0.6;
    const glint = Math.abs(x - 0.1) < 0.03 + 0.25 * t;
    if (wave && glint) c = [255, 210, 150];
    else if (wave) c = c.map(z => z * 1.25);
  }
  return c;
}
function pZone(u, v, W, H) {
  const ar = W / H, x = (u - 0.5) * ar, y = v - 0.5;
  const k = Math.PI * W * 0.9;
  const s = 0.5 + 0.5 * Math.cos(k * (x * x + y * y));
  const g = 16 + 219 * s;
  return [g, g, g];
}
function pEvent(u, v, W, H) {
  const ar = W / H, x = (u - 0.5) * ar, y = v - 0.5;
  let c = [mix(6, 20, v), mix(14, 40, v), mix(48, 110, v)];
  const sx = Math.floor(u * W), sy = Math.floor(v * H), h = hash(sx + 7, sy + 3);
  if (h > 0.99 && v < 0.6) c = c.map(z => z + 180 * (h - 0.99) / 0.01);
  // Earth limb
  const ex = 0, ey = 1.55, R = 1.05, d = Math.hypot(x - ex, y - ey);
  if (d < R) { const t = clamp((R - d) / 0.25, 0, 1); c = [mix(60, 18, t), mix(150, 70, t), mix(230, 140, t)]; const cl = Math.sin(x * 23 + y * 7) * Math.sin(x * 9 - y * 31); if (cl > 0.55) c = c.map(z => mix(z, 245, 0.6)); }
  else if (d < R + 0.03) { const t = (d - R) / 0.03; c = [mix(150, c[0], t), mix(210, c[1], t), mix(255, c[2], t)]; }
  // station: truss, panels, modules
  const cx = 0, cy = -0.02;
  const X = x - cx, Y = y - cy;
  if (Math.abs(Y) < 0.012 && Math.abs(X) < 0.46) c = [210, 210, 214];
  for (const px of [-0.4, -0.29, 0.29, 0.4]) if (Math.abs(X - px) < 0.045 && Math.abs(Y) < 0.13 && Math.abs(Y) > 0.02) {
    const cell = (Math.floor((Y + 1) * 60) + Math.floor((X + 1) * 30)) % 2;
    c = cell ? [196, 140, 40] : [170, 116, 30];
  }
  if (Math.abs(X) < 0.11 && Math.abs(Y - 0.045) < 0.025) c = [230, 232, 236];
  if (Math.abs(X + 0.02) < 0.03 && Math.abs(Y - 0.09) < 0.04) c = [200, 204, 210];
  // text
  const t1 = 'SSTV EVENT', t2 = '145.800 MHZ';
  const s = Math.max(1, Math.min(Math.floor(H / 34), Math.floor(W * 0.8 / (t1.length * 6)))), px = u * W, py = v * H;
  if (onText(t1, (W - textW(t1, s)) / 2, H * 0.1, s, px, py)) c = [255, 255, 255];
  const s2 = Math.max(1, Math.floor(s * 0.75));
  if (onText(t2, (W - textW(t2, s2)) / 2, H * 0.1 + 10 * s, s2, px, py)) c = [255, 200, 90];
  return c;
}

export const CARDS = [
  { id: 'card', name: 'Test card', paint: pCard },
  { id: 'planet', name: 'Ringed planet', paint: pPlanet },
  { id: 'sunset', name: 'Sunset', paint: pSunset },
  { id: 'bars', name: 'Colour bars', paint: pBars },
  { id: 'zone', name: 'Zone plate', paint: pZone },
  { id: 'event', name: 'Event card', paint: pEvent },
];

// Render card id at W x H, 2 x 2 samples per pixel.
export function card(id, W, H) {
  const C = CARDS.find(c => c.id === id) || CARDS[0];
  const data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let r = 0, g = 0, b = 0;
    for (const [a, c] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const p = C.paint((i + a) / W, (j + c) / H, W, H); r += p[0]; g += p[1]; b += p[2];
    }
    const o = (j * W + i) * 4;
    data[o] = r / 4; data[o + 1] = g / 4; data[o + 2] = b / 4; data[o + 3] = 255;
  }
  return { w: W, h: H, data };
}

// Card for mode m at its display aspect: a 160-wide Martin M2 picture is
// drawn at 320 x 256 and squeezed, so circles stay round on the CRT.
export function cardFor(id, m) {
  const a = m.aspect || m.W / m.H, wd = Math.round(m.H * a);
  return wd === m.W ? card(id, m.W, m.H) : fit(card(id, wd, m.H), m.W, m.H);
}

// Box-filtered resample of src to W x H, cropped to fill (cover).
export function fit(src, W, H) {
  const sa = src.w / src.h, da = W / H;
  let cw = src.w, ch = src.h, cx = 0, cy = 0;
  if (sa > da) { cw = src.h * da; cx = (src.w - cw) / 2; } else { ch = src.w / da; cy = (src.h - ch) / 2; }
  const out = new Uint8ClampedArray(W * H * 4), sx = cw / W, sy = ch / H;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x0 = cx + i * sx, y0 = cy + j * sy, nx = Math.max(1, Math.round(sx)), ny = Math.max(1, Math.round(sy));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const X = Math.min(src.w - 1, Math.floor(x0 + (x + 0.5) * sx / nx)), Y = Math.min(src.h - 1, Math.floor(y0 + (y + 0.5) * sy / ny)), o = (Y * src.w + X) * 4;
      r += src.data[o]; g += src.data[o + 1]; b += src.data[o + 2]; n++;
    }
    const o = (j * W + i) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return { w: W, h: H, data: out };
}

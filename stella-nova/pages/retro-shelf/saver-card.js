// ============================================================================
//  RETRO SHELF  ·  saver-card.js — our own period art for the desk tour
// ----------------------------------------------------------------------------
//  2D canvas drawing only, with no game art: every picture comes from the
//  text of games.json (title, year, maker, genre, sub, licence) and a
//  seeded scene motif (games.json saver.motif). The text uses our own 5 x 7
//  bitmap font, so a picture is the same in every browser and in node.
//    drawAttract(c, g, t, st)    the attract screen on the CRT, 320 x 200:
//                                a DOS boot line (t < BOOT_S), then the
//                                title over the motif scene, a blinking
//                                PRESS ANY KEY and a scrolling line
//    drawCover(c, g, W, H, mk)   the front of the game box
//    drawSpine(c, g, W, H)       the spine of the game box (title down it)
//    drawFloppyLabel / drawCdLabel   the label of the disk or the CD
//    makeCrtAssets(mk, W, H), composeCrt(c, W, H, src, pw, assets)
//                                the CRT picture: the power curve of
//                                saver-plan.js crtPower, scanlines and the
//                                dark corners, for the screen texture
//  mk(w, h) makes a canvas (document.createElement in the page, a node
//  canvas in a render check). st is a state object that the caller keeps
//  per game (cached layers, the fire buffer).
//
//  grep -n targets
//    "const GLYPHS"  "export function drawText"  "export function drawAttract"
//    "function drawMotif"  "function fire"  "export function drawCover"
//    "export function drawSpine"  "export function composeCrt"
// ============================================================================
import { rng, licenceKind, mediaOf, clamp } from './saver-plan.js';

export const W0 = 320, H0 = 200, BOOT_S = 2.6;

// 5 x 7 glyphs, rows from the top, '#' = on.
const GLYPHS = {
  'A': '.###.#...##...#######...##...##...#', 'B': '####.#...##...#####.#...##...#####.',
  'C': '.###.#...##....#....#....#...#.###.', 'D': '####.#...##...##...##...##...#####.',
  'E': '######....#....####.#....#....#####', 'F': '######....#....####.#....#....#....',
  'G': '.###.#...##....#.####...##...#.####', 'H': '#...##...##...#######...##...##...#',
  'I': '.###...#....#....#....#....#...###.', 'J': '..###...#....#....#....#.#..#..##..',
  'K': '#...##..#.#.#..##...#.#..#..#.#...#', 'L': '#....#....#....#....#....#....#####',
  'M': '#...###.###.#.##.#.##...##...##...#', 'N': '#...##...###..##.#.##..###...##...#',
  'O': '.###.#...##...##...##...##...#.###.', 'P': '####.#...##...#####.#....#....#....',
  'Q': '.###.#...##...##...##.#.##..#..##.#', 'R': '####.#...##...#####.#.#..#..#.#...#',
  'S': '.#####....#.....###.....#....#####.', 'T': '#####..#....#....#....#....#....#..',
  'U': '#...##...##...##...##...##...#.###.', 'V': '#...##...##...##...##...#.#.#...#..',
  'W': '#...##...##...##.#.##.#.##.#.#.#.#.', 'X': '#...##...#.#.#...#...#.#.#...##...#',
  'Y': '#...##...#.#.#...#....#....#....#..', 'Z': '#####....#...#...#...#...#....#####',
  '0': '.###.#...##..###.#.###..##...#.###.', '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####', '3': '#####...#...#.....#.....##...#.###.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....##...#.###.',
  '6': '..##..#...#....####.#...##...#.###.', '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.', '9': '.###.#...##...#.####....#...#..##..',
  'Ł': '#....#....#.#..##...#....#....#####',
  ' ': '...................................', '.': '..........................##...##..',
  ',': '.....................##....#...#...', ':': '......##...##.........##...##......',
  '!': '..#....#....#....#....#.........#..', '?': '.###.#...#....#...#...#.........#..',
  '-': '...............#####...............', "'": '..#....#...#.......................',
  '/': '.........#...#...#...#...#.........', '\\': '.....#.....#.....#.....#.....#.....',
  '>': '.#.....#.....#.....#...#...#...#...', '_': '..............................#####',
  '·': '.................#.................', '(': '...#...#...#....#....#.....#.....#.',
  ')': '.#.....#.....#....#....#...#...#...', '&': '.##..#..#.#.#...#...#.#.##..#..##.#',
  '+': '.......#....#..#####..#....#.......', '=': '..........#####.....#####..........',
  '"': '.#.#..#.#..........................', '*': '.......#..#.#.#.###.#.#.#..#.......',
  '#': '.#.#..#.#.#####.#.#.#####.#.#..#.#.', '%': '##...##..#...#...#...#...#..##...##',
};
const ROWS = {};
for (const [k, s] of Object.entries(GLYPHS)) {
  const p = s.padEnd(35, '.');
  ROWS[k] = [0, 1, 2, 3, 4, 5, 6].map(r => p.slice(r * 5, r * 5 + 5));
}

/** Upper case, with the diacritics dropped (ł keeps its stroke). */
export function norm(s) {
  return String(s).replace(/ł/g, 'Ł').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-');
}
export const textW = (s, sc) => Math.max(0, norm(s).length * 6 - 1) * sc;
export function hasGlyph(ch) { return ch in ROWS; }

/** Draw text in the bitmap font. sc: pixel scale. col: a colour or (row) => colour. */
export function drawText(c, s, x, y, sc, col, opt = {}) {
  const str = norm(s);
  let x0 = Math.round(opt.align === 'center' ? x - textW(str, sc) / 2 : opt.align === 'right' ? x - textW(str, sc) : x);
  y = Math.round(y);
  const pass = (dx, dy, colour) => {
    for (let i = 0; i < str.length; i++) {
      const g = ROWS[str[i]] || ROWS['?'];
      for (let r = 0; r < 7; r++) {
        c.fillStyle = typeof colour === 'function' ? colour(r) : colour;
        const row = g[r];
        for (let q = 0; q < 5; q++) if (row[q] === '#') c.fillRect(x0 + (i * 6 + q) * sc + dx, y + r * sc + dy, sc, sc);
      }
    }
  };
  if (opt.shadow) pass(opt.sd || sc, opt.sd || sc, opt.shadow);
  pass(0, 0, col);
  return textW(str, sc);
}

/** Word wrap for the bitmap font: lines that fit maxW at scale sc. */
export function wrapText(s, sc, maxW) {
  const words = norm(s).split(' '), out = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (textW(t, sc) > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// ---------------------------------------------------------------- colour
const hex = h => { const n = parseInt(String(h).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixc = (a, b, k) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k));
const css = a => 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const seedOf = id => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** The sky ramp of a game: 6 colours from the zenith to the horizon. */
function ramp(g) {
  const a = hex(g.accent || '#5080a0');
  const deep = mixc([8, 8, 24], a, 0.25), hor = mixc(a, [255, 214, 160], 0.45);
  return [0, 1, 2, 3, 4, 5].map(i => mixc(deep, hor, i / 5));
}

/** A dithered vertical ramp into the box (x, y, w, h): 16-colour era bands. */
function ditherSky(c, x, y, w, h, cols) {
  if (!c.createImageData) { c.fillStyle = css(cols[2]); c.fillRect(x, y, w, h); return; }
  const im = c.createImageData(w, h), d = im.data, n = cols.length - 1;
  for (let j = 0; j < h; j++) {
    const v = (j / Math.max(1, h - 1)) * n, b = Math.min(n - 1, Math.floor(v)), f = v - b;
    for (let i = 0; i < w; i++) {
      const pick = f * 16 > BAYER[(j & 3) * 4 + (i & 3)] ? cols[b + 1] : cols[b];
      const o = (j * w + i) * 4;
      d[o] = pick[0]; d[o + 1] = pick[1]; d[o + 2] = pick[2]; d[o + 3] = 255;
    }
  }
  c.putImageData(im, x, y);
}

// ----------------------------------------------------------------- motifs
// Each motif draws a silhouette scene into (0, 0, w, h) of c, seeded by the
// game id. The static part goes into a cached layer; tick() draws the
// moving part (bats, a plane, lit windows, stars) each frame.
function drawMotif(c, g, w, h) {
  const r = rng(seedOf(g.id)), cols = ramp(g), motif = (g.saver && g.saver.motif) || 'hills';
  const hy = Math.round(h * 0.62);
  ditherSky(c, 0, 0, w, hy + 2, cols);
  const dark = css(mixc([6, 6, 12], hex(g.accent), 0.18)), mid = css(mixc([14, 12, 22], hex(g.accent), 0.32));
  // stars in the upper sky
  c.fillStyle = 'rgba(255,250,230,0.85)';
  for (let i = 0; i < w * 0.12; i++) c.fillRect(Math.floor(r() * w), Math.floor(r() * hy * 0.5), 1, 1);
  const moon = (mx, my, mr, col) => { c.fillStyle = col; for (let yy = -mr; yy <= mr; yy++) { const xx = Math.round(Math.sqrt(mr * mr - yy * yy)); c.fillRect(mx - xx, my + yy, xx * 2 + 1, 1); } };
  const hills = (base, amp, col, k) => { c.fillStyle = col; const ph = r() * 9; for (let x = 0; x < w; x++) { const y = base - amp * (0.5 + 0.5 * Math.sin(x * k + ph) * Math.cos(x * k * 0.37 + ph * 2)); c.fillRect(x, Math.round(y), 1, h - Math.round(y)); } };
  if (motif === 'city') {
    hills(hy + 6, 4, mid, 0.05);
    let x = 0;
    while (x < w) {
      const bw = 6 + Math.floor(r() * 16), bh = 14 + Math.floor(r() * h * 0.42);
      c.fillStyle = r() < 0.5 ? dark : mid; c.fillRect(x, hy + 8 - bh, bw, bh + h);
      if (r() < 0.25) c.fillRect(x + (bw >> 1), hy + 8 - bh - 8, 1, 8);
      x += bw + (r() < 0.3 ? 1 : 0);
    }
  } else if (motif === 'jungle') {
    moon(Math.round(w * 0.72), Math.round(hy * 0.62), Math.round(h * 0.07), 'rgb(255,226,150)');
    hills(hy + 4, h * 0.08, mid, 0.03); hills(hy + h * 0.14, h * 0.07, dark, 0.05);
    c.fillStyle = dark;
    for (let i = 0; i < 6; i++) {
      const px = Math.floor(r() * w), top = hy - h * (0.12 + r() * 0.16);
      for (let yy = Math.round(top); yy < h; yy++) c.fillRect(px + Math.round(Math.sin((yy - top) * 0.05) * 3), yy, 2, 1);
      for (let a = 0; a < 6; a++) { const ang = a / 6 * Math.PI * 2; for (let s = 0; s < 12; s++) c.fillRect(px + Math.round(Math.cos(ang) * s), Math.round(top + Math.sin(ang) * s * 0.5 + s * s * 0.04), 2, 1); }
    }
  } else if (motif === 'castle' || motif === 'bats') {
    moon(Math.round(w * (motif === 'bats' ? 0.5 : 0.26)), Math.round(hy * 0.42), Math.round(h * (motif === 'bats' ? 0.15 : 0.06)), 'rgb(250,240,214)');
    hills(hy + 2, h * 0.1, mid, 0.02);
    const cx = Math.round(w * (motif === 'bats' ? 0.62 : 0.66)), base = hy - h * 0.06;
    c.fillStyle = dark;
    c.fillRect(cx - 34, base - 22, 68, h);
    for (const [dx, tw, th] of [[-40, 12, 44], [28, 12, 40], [-8, 16, 58]]) {
      c.fillRect(cx + dx, base - th, tw, h);
      for (let k = 0; k < tw; k += 4) c.fillRect(cx + dx + k, base - th - 3, 2, 3);
      c.fillStyle = 'rgb(255,214,120)'; c.fillRect(cx + dx + (tw >> 1) - 1, base - th + 10, 2, 3); c.fillStyle = dark;
    }
    for (let k = -34; k < 34; k += 4) c.fillRect(cx + k, base - 25, 2, 3);
    hills(hy + h * 0.16, h * 0.05, dark, 0.04);
  } else if (motif === 'village') {
    moon(Math.round(w * 0.2), Math.round(hy * 0.7), Math.round(h * 0.08), 'rgb(255,236,180)');
    hills(hy + 4, h * 0.06, mid, 0.02);
    let x = 4;
    while (x < w - 10) {
      const bw = 16 + Math.floor(r() * 14), bh = 10 + Math.floor(r() * 8), by = hy + 10;
      c.fillStyle = dark; c.fillRect(x, by - bh, bw, h);
      for (let k = 0; k <= bw / 2 + 2; k++) c.fillRect(x + k - 2, by - bh - k * 0.8, bw - k * 2 + 4, 1);
      if (r() < 0.6) { c.fillStyle = 'rgb(255,206,110)'; c.fillRect(x + 4, by - bh + 4, 3, 3); }
      if (r() < 0.15) { c.fillStyle = dark; c.fillRect(x + (bw >> 1) - 1, by - bh - 30, 3, 20); c.fillRect(x + (bw >> 1) - 3, by - bh - 24, 7, 1); }
      x += bw + 6 + Math.floor(r() * 18);
    }
    hills(hy + h * 0.2, h * 0.04, dark, 0.03);
  } else if (motif === 'desert') {
    moon(Math.round(w * 0.78), Math.round(hy * 0.4), Math.round(h * 0.05), 'rgb(255,240,200)');
    for (const [px, ph, col] of [[0.3, 0.3, mid], [0.48, 0.22, mid], [0.18, 0.14, dark]]) {
      c.fillStyle = col; const x0 = Math.round(w * px), hh = Math.round(h * ph);
      for (let k = 0; k < hh; k++) c.fillRect(x0 - k, hy + 6 - hh + k, k * 2 + 1, 1);
    }
    hills(hy + 10, h * 0.04, dark, 0.02);
  } else {
    hills(hy, h * 0.1, mid, 0.03); hills(hy + h * 0.12, h * 0.08, dark, 0.05);
  }
}

function tickMotif(c, g, w, h, t) {
  const motif = (g.saver && g.saver.motif) || 'hills', r = rng(seedOf(g.id) ^ 0x9e37);
  // twinkle: a few stars blink
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h * 0.3), on = Math.sin(t * (1.5 + r() * 3) + i * 2) > 0.3;
    c.fillStyle = on ? 'rgba(255,255,240,0.95)' : 'rgba(255,255,240,0.15)'; c.fillRect(x, y, 1, 1);
  }
  if (motif === 'bats' || motif === 'castle') {
    c.fillStyle = 'rgb(10,6,14)';
    const n = motif === 'bats' ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const p = (t * (0.05 + 0.02 * i) + i * 0.23) % 1, x = Math.round(p * (w + 40) - 20), y = Math.round(h * (0.2 + 0.08 * i) + Math.sin(t * 2 + i) * 6);
      const flap = Math.sin(t * 14 + i * 3) > 0 ? -2 : 1;
      c.fillRect(x - 1, y, 3, 2); c.fillRect(x - 4, y + flap, 3, 1); c.fillRect(x + 2, y + flap, 3, 1);
    }
  } else if (motif === 'jungle') {
    const p = (t * 0.035) % 1, x = Math.round(p * (w + 60) - 30), y = Math.round(h * 0.18 + p * h * 0.25);
    c.fillStyle = 'rgba(80,70,70,0.55)';
    for (let k = 1; k < 18; k++) c.fillRect(x - k * 3, y - k * 1.2, 2, 2);
    c.fillStyle = 'rgb(20,16,20)'; c.fillRect(x - 5, y, 10, 2); c.fillRect(x - 1, y - 2, 3, 6); c.fillRect(x - 5, y - 1, 2, 1);
  } else if (motif === 'city') {
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(r() * w), y = Math.floor(h * (0.32 + r() * 0.3)), on = Math.sin(t * 0.7 + i * 1.7) > -0.2;
      if (on) { c.fillStyle = i % 5 ? 'rgb(255,214,120)' : 'rgb(140,230,255)'; c.fillRect(x, y, 1, 1); }
    }
  }
}

// ------------------------------------------------------------------- fire
// The classic spreading-fire effect (a cellular rule, our own code): each
// cell takes the heat of the cell under it, minus a random decay, with a
// random sideways drift.
const FIRE_PAL = (() => {
  const stops = [[7, 7, 7], [47, 15, 7], [103, 31, 7], [143, 39, 7], [191, 71, 7], [223, 87, 7], [223, 111, 15], [215, 135, 23], [207, 159, 31], [199, 183, 47], [191, 199, 63], [239, 239, 199]];
  const out = [];
  for (let i = 0; i < 37; i++) { const v = i / 36 * (stops.length - 1), b = Math.min(stops.length - 2, Math.floor(v)); out.push(mixc(stops[b], stops[b + 1], v - b)); }
  return out;
})();
function fire(st, fw, fh) {
  if (st.decay == null) st.decay = 0.45;
  if (!st.fire) { st.fire = new Uint8Array(fw * fh); st.fr = rng(77); for (let x = 0; x < fw; x++) st.fire[(fh - 1) * fw + x] = 36; }
  const f = st.fire, r = st.fr;
  for (let x = 0; x < fw; x++) for (let y = 1; y < fh; y++) {
    const src = y * fw + x, p = f[src];
    if (p === 0) { f[src - fw] = 0; continue; }
    const rd = Math.floor(r() * 3.99);
    const dst = src - rd + 1 - fw;
    if (dst >= 0) f[dst] = Math.max(0, p - (rd & 1) - (r() < st.decay ? 1 : 0));
  }
  return f;
}

// ---------------------------------------------------------------- attract
/** The CRT picture of game g, t s after the power-on. c: a 320 x 200 2D context. */
export function drawAttract(c, g, t, st, mk) {
  const w = W0, h = H0;
  c.imageSmoothingEnabled = false;
  if (t < BOOT_S) { bootScreen(c, g, t); return; }
  const tt = t - BOOT_S, motif = (g.saver && g.saver.motif) || 'hills';
  if (motif === 'fire') { fireScreen(c, g, tt, st, mk); return; }
  if (!st.bg && mk) { st.bg = mk(w, h); drawMotif(st.bg.getContext('2d'), g, w, h); }
  if (st.bg) c.drawImage(st.bg, 0, 0); else { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); }
  tickMotif(c, g, w, h, tt);
  // the title panel, with a bevel
  const sc = textW(g.title, 3) <= 284 || wrapText(g.title, 3, 284).length <= 2 && !g.title.includes(':') ? 3 : 2;
  const lines = wrapText(g.title, sc, 290).slice(0, 3);
  const ph = lines.length * 9 * sc + 30, py = 16, px = 12, pw = w - 24;
  const acc = hex(g.accent);
  c.fillStyle = 'rgba(6,6,14,0.84)'; c.fillRect(px, py, pw, ph);
  c.fillStyle = css(mixc(acc, [255, 255, 255], 0.5)); c.fillRect(px, py, pw, 2); c.fillRect(px, py, 2, ph);
  c.fillStyle = css(mixc(acc, [0, 0, 0], 0.5)); c.fillRect(px, py + ph - 2, pw, 2); c.fillRect(px + pw - 2, py, 2, ph);
  const top = mixc([255, 248, 220], acc, 0.15), bot = mixc(acc, [255, 220, 150], 0.35);
  const shade = r => css(mixc(top, bot, r / 6));
  lines.forEach((l, i) => drawText(c, l, w / 2, py + 9 + i * 9 * sc, sc, shade, { align: 'center', shadow: css(mixc(acc, [0, 0, 0], 0.7)) }));
  drawText(c, g.year + ' · ' + g.maker, w / 2, py + ph - 14, 1, 'rgb(230,226,210)', { align: 'center' });
  const genre = (g.saver && g.saver.genre) || '';
  if (genre) drawText(c, genre, w / 2, py + ph + 8, 1, css(mixc(acc, [255, 255, 255], 0.6)), { align: 'center', shadow: 'rgb(0,0,0)' });
  if (Math.floor(tt * 1.6) % 2 === 0) drawText(c, 'PRESS ANY KEY', w / 2, 166, 2, 'rgb(255,250,235)', { align: 'center', shadow: 'rgb(0,0,0)' });
  marquee(c, g, tt);
}

function bootScreen(c, g, t) {
  c.fillStyle = '#000'; c.fillRect(0, 0, W0, H0);
  const cd = mediaOf(g) === 'cd', drive = cd ? 'D' : 'A', dir = norm(g.id).replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const L = ['MEMORY TEST  640K OK', cd ? 'CD-ROM DRIVE D: READY' : 'DRIVE A: 3.5 IN 1.44M', '', drive + ':\\>' + dir, 'LOADING ' + norm(g.title).slice(0, 26)];
  const n = Math.min(L.length, Math.floor(t / 0.42) + 1);
  for (let i = 0; i < n; i++) drawText(c, L[i], 10, 12 + i * 11, 1, 'rgb(190,190,190)');
  if (Math.floor(t * 3) % 2 === 0) { c.fillStyle = 'rgb(190,190,190)'; c.fillRect(10 + textW(L[n - 1], 1) + 2, 12 + (n - 1) * 11 + 6, 5, 1); }
}

function marquee(c, g, tt) {
  const msg = '   ' + licenceKind(g).toUpperCase() + ' · FREE FROM ITS OWNER · ' + norm(g.sub) + ' · ' + g.year + ' · ' + norm(g.maker) + ' ·';
  c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(0, 186, W0, 11);
  const wpx = textW(msg, 1) + 6, off = (tt * 24) % wpx;
  for (let x = -off; x < W0; x += wpx) drawText(c, msg, x, 188, 1, 'rgb(255,214,120)');
}

function fireScreen(c, g, tt, st, mk) {
  c.fillStyle = '#070707'; c.fillRect(0, 0, W0, H0);
  const fw = 160, fh = 44;
  const f = fire(st, fw, fh);
  if (!st.fireCv && mk) { st.fireCv = mk(fw, fh); }
  if (st.fireCv) {
    const fc = st.fireCv.getContext('2d');
    if (fc.createImageData) {
      const im = fc.createImageData(fw, fh), d = im.data;
      for (let i = 0; i < f.length; i++) { const p = FIRE_PAL[f[i]]; d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = 255; }
      fc.putImageData(im, 0, 0);
    }
    c.drawImage(st.fireCv, 0, 0, fw, fh, 0, H0 - fh * 2 - 10, W0, fh * 2);
  }
  const sc = textW(g.title, 7) <= 300 ? 7 : 3;
  const grad = r => css(FIRE_PAL[Math.round(36 - r * 3.5)]);
  drawText(c, g.title, W0 / 2, 14, sc, grad, { align: 'center', shadow: 'rgb(60,8,4)', sd: 2 });
  const sub = String(g.sub).split(':').pop().trim();
  drawText(c, sub, W0 / 2, 14 + 7 * sc + 8, 1, 'rgb(220,200,160)', { align: 'center' });
  drawText(c, g.year + ' · ' + g.maker, W0 / 2, 14 + 7 * sc + 20, 1, 'rgb(160,150,130)', { align: 'center' });
  if (Math.floor(tt * 1.6) % 2 === 0) drawText(c, 'PRESS ANY KEY', W0 / 2, 110, 2, 'rgb(255,240,200)', { align: 'center', shadow: 'rgb(0,0,0)' });
  marquee(c, g, tt);
}

// ------------------------------------------------------------- box art
/** The front of the box: our scene, the title, year, maker, genre, licence. */
export function drawCover(c, g, W, H, mk) {
  c.imageSmoothingEnabled = false;
  const acc = hex(g.accent);
  c.fillStyle = css(mixc([10, 10, 16], acc, 0.35)); c.fillRect(0, 0, W, H);
  const aw = 160, ah = 100;
  if (mk) {
    const art = mk(aw, ah), ac = art.getContext('2d');
    if ((g.saver && g.saver.motif) === 'fire') {
      const st = {}; for (let i = 0; i < 60; i++) fire(st, aw, 40);
      ac.fillStyle = '#070707'; ac.fillRect(0, 0, aw, ah);
      if (ac.createImageData) { const im = ac.createImageData(aw, 40); for (let i = 0; i < st.fire.length; i++) { const p = FIRE_PAL[st.fire[i]]; im.data.set([p[0], p[1], p[2], 255], i * 4); } ac.putImageData(im, 0, ah - 40); }
    } else drawMotif(ac, g, aw, ah);
    c.drawImage(art, 0, 0, aw, ah, 0, H * 0.18, W, W * ah / aw);
  }
  const sc = Math.max(2, Math.min(4, Math.floor(W / 70)));
  let lines = wrapText(g.title, sc, W - 20);
  const s2 = lines.length > 3 ? sc - 1 : sc;
  lines = wrapText(g.title, s2, W - 20).slice(0, 4);
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, W, 14 + lines.length * 9 * s2);
  lines.forEach((l, i) => drawText(c, l, W / 2, 8 + i * 9 * s2, s2, 'rgb(255,248,226)', { align: 'center', shadow: css(mixc(acc, [0, 0, 0], 0.6)) }));
  const by = H * 0.18 + W * ah / aw;
  c.fillStyle = css(mixc(acc, [0, 0, 0], 0.55)); c.fillRect(0, by, W, H - by);
  c.fillStyle = css(acc); c.fillRect(0, by, W, 3);
  let s1 = Math.max(1, Math.floor(W / 128));
  if (s1 > 1 && wrapText(g.year + ' · ' + g.maker, s1, W - 16).length > 2) s1--;
  let y = by + 8;
  wrapText(g.year + ' · ' + g.maker, s1, W - 16).slice(0, 3).forEach(l => { drawText(c, l, W / 2, y, s1, 'rgb(236,232,220)', { align: 'center' }); y += 9 * s1; });
  const genre = (g.saver && g.saver.genre) || '';
  if (genre) { drawText(c, genre, W / 2, y + 2, 1, css(mixc(acc, [255, 255, 255], 0.55)), { align: 'center' }); y += 12; }
  const badge = licenceKind(g).toUpperCase(), bw = textW(badge, s1) + 10 * s1;
  y = Math.min(y + 2, H - 22 - 11 * s1);
  c.fillStyle = css(mixc(acc, [255, 255, 255], 0.25)); c.fillRect(W / 2 - bw / 2, y, bw, 11 * s1);
  drawText(c, badge, W / 2, y + 2 * s1, s1, 'rgb(20,16,20)', { align: 'center' });
  drawText(c, mediaOf(g) === 'cd' ? 'CD-ROM' : '3.5 IN DISKS', W / 2, H - 12, 1, 'rgb(200,196,186)', { align: 'center' });
}

/** The spine: the title down it, the year at the base. */
export function drawSpine(c, g, W, H) {
  c.imageSmoothingEnabled = false;
  const acc = hex(g.accent);
  c.fillStyle = css(mixc([12, 12, 18], acc, 0.45)); c.fillRect(0, 0, W, H);
  c.fillStyle = css(acc); c.fillRect(0, 0, W, Math.round(H * 0.08)); c.fillRect(0, H - Math.round(H * 0.12), W, Math.round(H * 0.12));
  const sc = Math.max(1, Math.floor(W / 14));
  const maxL = H * 0.78;
  let s = sc; while (s > 1 && textW(g.title, s) > maxL) s--;
  let title = norm(g.title); while (textW(title, s) > maxL && title.length > 4) title = title.slice(0, -1);
  if (c.save) { c.save(); c.translate(W / 2 + 3.5 * s, H * 0.1); c.rotate(Math.PI / 2); drawText(c, title, 0, 0, s, 'rgb(255,248,226)', { shadow: 'rgb(0,0,0)' }); c.restore(); }
  drawText(c, String(g.year).slice(2), W / 2, H - Math.round(H * 0.1), Math.max(1, sc - 1), 'rgb(20,16,20)', { align: 'center' });
}

/** The paper label of a 3.5 inch disk. */
export function drawFloppyLabel(c, g, W, H) {
  c.imageSmoothingEnabled = false;
  c.fillStyle = 'rgb(240,236,224)'; c.fillRect(0, 0, W, H);
  c.fillStyle = g.accent; c.fillRect(0, 0, W, Math.round(H * 0.16));
  const s = Math.max(1, Math.floor(W / 64));
  wrapText(g.title, s, W - 10).slice(0, 3).forEach((l, i) => drawText(c, l, W / 2, H * 0.26 + i * 9 * s, s, 'rgb(28,26,40)', { align: 'center' }));
  drawText(c, 'DISK 1 · ' + g.year, W / 2, H - 11, 1, 'rgb(90,86,96)', { align: 'center' });
}

/** The print side of the CD. */
export function drawCdLabel(c, g, W, H) {
  c.imageSmoothingEnabled = false;
  const acc = hex(g.accent), cx = W / 2, cy = H / 2;
  c.fillStyle = 'rgb(200,204,214)'; c.fillRect(0, 0, W, H);
  if (c.arc) {
    c.fillStyle = css(mixc(acc, [0, 0, 0], 0.3)); c.beginPath(); c.arc(cx, cy, W * 0.47, 0, Math.PI * 2); c.fill();
    c.fillStyle = css(acc); c.beginPath(); c.arc(cx, cy, W * 0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(210,214,222)'; c.beginPath(); c.arc(cx, cy, W * 0.13, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(30,30,36)'; c.beginPath(); c.arc(cx, cy, W * 0.06, 0, Math.PI * 2); c.fill();
  }
  const s = Math.max(1, Math.floor(W / 110));
  wrapText(g.title, s, W * 0.7).slice(0, 2).forEach((l, i) => drawText(c, l, cx, H * 0.17 + i * 9 * s, s, 'rgb(255,250,236)', { align: 'center', shadow: 'rgb(0,0,0)' }));
  drawText(c, 'CD-ROM · ' + g.year, cx, H * 0.78, s, 'rgb(255,250,236)', { align: 'center' });
}

// ------------------------------------------------------------- the CRT
/** Scanline and corner layers for a W x H screen texture, made once. */
export function makeCrtAssets(mk, W, H) {
  const scan = mk(W, H), sc = scan.getContext('2d');
  sc.fillStyle = '#fff'; sc.fillRect(0, 0, W, H);
  const lines = H0, step = H / lines;
  sc.fillStyle = 'rgb(120,120,120)';
  for (let i = 0; i < lines; i++) sc.fillRect(0, Math.floor(i * step + step * 0.55), W, Math.max(1, Math.round(step * 0.45)));
  // a faint aperture grille: every third column a little dimmer per channel
  for (let x = 0; x < W; x += 3) { sc.fillStyle = 'rgba(255,200,200,0.08)'; sc.fillRect(x, 0, 1, H); }
  const vig = mk(W, H), vc = vig.getContext('2d');
  const gr = vc.createRadialGradient && vc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.56);
  if (gr) {
    gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.7, 'rgb(225,225,225)'); gr.addColorStop(1, 'rgb(60,60,60)');
    vc.fillStyle = gr; vc.fillRect(0, 0, W, H);
  }
  return { scan, vig };
}

/** The screen picture: src (320 x 200) scaled by the power curve pw, scanlines, corners. */
export function composeCrt(c, W, H, src, pw, A) {
  c.imageSmoothingEnabled = false;
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  if (!pw || pw.bright <= 0.001) return;
  const ix = W * 0.055, iy = H * 0.065, iw = W - 2 * ix, ih = H - 2 * iy;
  const w = Math.max(2, iw * pw.sx), h = Math.max(2, ih * pw.sy);
  if (pw.sx < 0.05 && pw.sy < 0.05) {
    // the dot: a hot spot with a soft edge
    const r = Math.max(W, H) * 0.03 * clamp(pw.bright, 0, 2.2);
    const gr = r > 0 && c.createRadialGradient && c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
    if (gr) {
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(220,235,255,0.8)'); gr.addColorStop(1, 'rgba(120,160,255,0)');
      c.fillStyle = gr; c.fillRect(W / 2 - r, H / 2 - r, r * 2, r * 2);
    }
    return;
  }
  c.drawImage(src, 0, 0, W0, H0, W / 2 - w / 2, H / 2 - h / 2, w, h);
  if (pw.bright > 1) {
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp(pw.bright - 1, 0, 1) * 0.8;
    c.fillStyle = 'rgb(210,225,255)'; c.fillRect(W / 2 - w / 2, H / 2 - h / 2, w, h);
    c.globalAlpha = 1;
  }
  if (A) {
    c.globalCompositeOperation = 'multiply';
    c.drawImage(A.scan, 0, 0); c.drawImage(A.vig, 0, 0);
  }
  c.globalCompositeOperation = 'source-over';
  if (pw.bright < 1) { c.globalAlpha = 1 - clamp(pw.bright, 0, 1); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
}

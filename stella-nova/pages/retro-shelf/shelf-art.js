// ============================================================================
//  RETRO SHELF  ·  shelf-art.js — the wooden shelf: groups, sizes, poses, art
// ----------------------------------------------------------------------------
//  Pure helpers for the bookcase of main.js, and the two canvas painters
//  of each game box. The box art is our own: saver-card.js draws the cover
//  and the spine from the text of games.json (title, year, maker, genre,
//  licence) over a seeded motif scene, in our own 5 x 7 bitmap font. No
//  game art, logo or screenshot is used.
//
//  The bookcase has one shelf per engine (shelfGroups). shelfLayout gives
//  the box size for the width of the window; main.js writes it into CSS
//  variables (--bw --bh --bd --gap). boxPose gives each box a small seeded
//  turn, so the row does not look like a grid. coverPalette gives the five
//  colours of a box from the accent of the game. systemMedia tells the
//  bring-your-own-disc drawer to draw a disc or a cartridge.
//
//  grep -n targets
//    "export function coverPalette"  "export function shelfGroups"
//    "export function shelfLayout"   "export function boxPose"
//    "export function spineTitle"    "export function systemMedia"
//    "export function paintCover"    "export function paintSpine"
// ============================================================================
import { drawCover, drawSpine, drawText } from './saver-card.js';

const hex = h => { const n = parseInt(String(h || '#808080').replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const css = a => '#' + a.map(v => v.toString(16).padStart(2, '0')).join('');
/** WCAG relative luminance of an sRGB triple. */
export function luminance(rgb) {
  const l = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The colours of one box from the game accent: base (the cover field),
 * dark (the spine), light (the top edge and the sticker), ink (text on
 * base, at least 4.5:1) and glow (the light that the box throws on the
 * back panel).
 */
export function coverPalette(g) {
  const a = hex(g && g.accent);
  const base = mix([10, 10, 16], a, 0.55), dark = mix(a, [0, 0, 0], 0.55), light = mix(a, [255, 255, 255], 0.35);
  const white = [255, 248, 226], black = [20, 16, 20];
  const ink = contrast(base, white) >= contrast(base, black) ? white : black;
  return { accent: css(a), base: css(base), dark: css(dark), light: css(light), ink: css(ink), glow: 'rgba(' + a.join(',') + ',0.22)' };
}

const ENGINE_SHELF = {
  dos: { label: 'PC shareware', engine: 'DOSBox' },
  scummvm: { label: 'Point-and-click adventures', engine: 'ScummVM' },
};

/** One shelf per engine, in the order that the games first show it. */
export function shelfGroups(games) {
  const out = [], by = new Map();
  for (const g of games || []) {
    let s = by.get(g.engine);
    if (!s) {
      const meta = ENGINE_SHELF[g.engine] || { label: 'Games', engine: g.engine };
      s = { id: g.engine, label: meta.label, engine: meta.engine, games: [] };
      by.set(g.engine, s); out.push(s);
    }
    s.games.push(g);
  }
  return out;
}

/**
 * The box size for a window width w (CSS px). A PC big box is about 3:4.
 * mode "scroll": the shelf scrolls sideways with snap (phones);
 * mode "row": the shelf shows one row and scrolls only when it must.
 * shelfRoom(w) is the inner width of a shelf row: main is 1240 px at most
 * with 16 px gutters. The bookcase sides take 36 px, or 16 px below 560 px
 * (style.css: padding 14 px, margin -6 px).
 */
export function shelfRoom(w) {
  const v = Math.min(Math.max(0, w || 0), 1240);
  return v - 32 - (v < 560 ? 16 : 36);
}
export const LAYOUTS = [
  { name: 'phone', min: 0, bw: 112, bd: 26, gap: 22, mode: 'scroll' },
  { name: 'tablet', min: 560, bw: 124, bd: 30, gap: 24, mode: 'scroll' },
  { name: 'desk', min: 1024, bw: 124, bd: 30, gap: 24, mode: 'row' },
  { name: 'wide', min: 1280, bw: 150, bd: 34, gap: 30, mode: 'row' },
];
export function shelfLayout(w) {
  const v = Number.isFinite(w) && w > 0 ? w : 0;
  let L = LAYOUTS[0];
  for (const x of LAYOUTS) if (v >= x.min) L = x;
  return { ...L, bh: Math.round(L.bw * 4 / 3) };
}

const seedOf = id => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/**
 * The resting pose of a box on the shelf: ry (deg, the turn that shows
 * the spine, 18..30) and dz (px, a small step back, 0..8). Seeded by the
 * game id, so a box keeps its pose on each visit.
 */
export function boxPose(id) {
  const h = seedOf(id);
  return { ry: 18 + (h % 1300) / 100, dz: ((h >>> 11) % 9) };
}

/** The text on the spine: the title before a colon, so it stays legible. */
export function spineTitle(g) {
  const t = String((g && g.title) || '').split(':')[0].trim();
  return t || String((g && g.title) || '');
}

/** "disc" or "cart" for a system of the bring-your-own-disc drawer. */
export function systemMedia(s) {
  return /psx|playstation|cd|disc/i.test(String((s && s.id) || '') + ' ' + String((s && s.name) || '')) ? 'disc' : 'cart';
}

/** The platform band text at the top of the cover. */
export function platformBand(g) {
  return 'PC  ·  ' + (g.engine === 'dos' ? 'DOSBOX' : g.engine === 'scummvm' ? 'SCUMMVM' : String(g.engine || '').toUpperCase());
}

export const COVER_W = 300, COVER_H = 400, SPINE_W = 72, SPINE_H = 400;

/**
 * Paint the front of a box into a COVER_W x COVER_H canvas: a black
 * platform band (the system badge), then drawCover of saver-card.js.
 */
export function paintCover(c, g, mk) {
  const band = Math.round(COVER_H * 0.075);
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#0b0b0f'; c.fillRect(0, 0, COVER_W, band);
  c.fillStyle = coverPalette(g).accent; c.fillRect(0, band - 3, COVER_W, 3);
  drawText(c, platformBand(g), 12, Math.round((band - 3 - 14) / 2), 2, 'rgb(236,232,220)');
  c.save(); c.translate(0, band);
  drawCover(c, g, COVER_W, COVER_H - band, mk);
  c.restore();
}

/** Paint the spine into a SPINE_W x SPINE_H canvas. */
export function paintSpine(c, g) {
  drawSpine(c, { ...g, title: spineTitle(g) }, SPINE_W, SPINE_H);
}

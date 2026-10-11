// ============================================================================
//  FLY DUEL  ·  procedural card art and mana glyphs  (pure ES module)
// ----------------------------------------------------------------------------
//  Each card gets its own picture. The picture comes from the card id only,
//  so the same card always shows the same picture. The art is our own:
//  insects for creatures, plants for spells, a landscape for lands. No
//  frame, symbol or picture comes from any other card game.
//
//  Mana glyphs are our own too:
//    amber    a honeycomb cell with a drop of resin in it
//    moss     a leaf with a centre vein, on a diamond tile
//    generic  the number on a grey rounded square
//  No glyph is a disc. A coloured disc with a symbol, or a grey disc with
//  a number, is the look of the mana symbols of a published card game.
//
//  All functions give SVG text. They do not touch the DOM, so node tests
//  can call them.
//
//  GREP MAP
//      grep -n 'export function hashId'      FNV-1a hash of a string
//      grep -n 'export function rngFrom'     small seeded generator
//      grep -n 'export const PALETTE'        colours per card colour
//      grep -n 'export function manaGlyph'   one mana glyph
//      grep -n 'export function costGlyphs'  the glyph row for a cost
//      grep -n 'export function cardArt'     the picture of one card
//      grep -n 'function insect'             creature motif
//      grep -n 'function plant'              spell motif
//      grep -n 'function landscape'          land motif
// ============================================================================

// FNV-1a, 32 bit. Local copy, so this module needs no other file.
export function hashId(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// mulberry32 on the hash: gives floats in [0, 1).
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { TOKENS } from './tokens.js';

// ink is the card colour token; the other shades are art only.
export const PALETTE = {
  amber: { ink: TOKENS.amber, deep: '#7a3a08', sky0: '#3a1c06', sky1: '#a85a14', glow: '#ffd27a', body: ['#ffb347', '#e0782a', '#ffcf70', '#c9541c'] },
  moss: { ink: TOKENS.moss, deep: '#1f3d10', sky0: '#0b1f06', sky1: '#3d6a1c', glow: '#dcf3a8', body: ['#a8d65a', '#7fae3a', '#c9ea8a', '#5f8f2a'] },
  none: { ink: TOKENS.none, deep: '#2a3140', sky0: '#0d111a', sky1: '#3a4560', glow: '#dfe6f5', body: ['#a9b4c8', '#7f8aa3', '#cfd7e6', '#6b7690'] },
};
export const colourKey = c => (c === 'amber' || c === 'Amber') ? 'amber' : (c === 'moss' || c === 'Moss') ? 'moss' : 'none';

const f1 = v => (Math.round(v * 10) / 10).toString();

// One mana glyph as an inline SVG. kind: 'amber' | 'moss' | 'generic'.
export function manaGlyph(kind, n = 0, size = 16) {
  const s = `width="${size}" height="${size}" viewBox="0 0 20 20" class="mana mana-${kind}" aria-hidden="true"`;
  if (kind === 'amber') {
    return `<svg ${s}><path d="M10 1.5 17.4 5.75v8.5L10 18.5 2.6 14.25v-8.5z" fill="#2b1604" stroke="${TOKENS.amber}" stroke-width="1.6"/>`
      + `<path d="M10 5.2c2.2 3 3.3 4.9 3.3 6.4a3.3 3.3 0 0 1-6.6 0c0-1.5 1.1-3.4 3.3-6.4z" fill="${TOKENS.amber}"/>`
      + `<circle cx="8.8" cy="11.4" r="0.9" fill="#fff3d0"/></svg>`;
  }
  if (kind === 'moss') {
    return `<svg ${s}><path d="M10 1.2 18.8 10 10 18.8 1.2 10z" fill="#14260a" stroke="${TOKENS.moss}" stroke-width="1.4" stroke-linejoin="round"/>`
      + `<path d="M6.2 13.8C6.2 9.4 9.2 6.6 13.6 6.4c.2 4.4-2.7 7.3-7 7.4z" fill="${TOKENS.moss}"/>`
      + `<path d="M6.7 13.3 12.6 7.4" stroke="#14260a" stroke-width="1" stroke-linecap="round"/></svg>`;
  }
  return `<svg ${s}><rect x="2" y="2" width="16" height="16" rx="3.5" fill="${TOKENS.panel2}" stroke="${TOKENS.none}" stroke-width="1.4"/>`
    + `<text x="10" y="14" text-anchor="middle" font-size="11" font-family="ui-monospace,Menlo,monospace" font-weight="600" fill="${TOKENS.ink}">${n | 0}</text></svg>`;
}

// The glyph row for a cost { generic, amber, moss }.
export function costGlyphs(cost, size = 15) {
  if (!cost) return '';
  let out = '';
  if (cost.generic > 0) out += manaGlyph('generic', cost.generic, size);
  for (let i = 0; i < (cost.amber | 0); i++) out += manaGlyph('amber', 0, size);
  for (let i = 0; i < (cost.moss | 0); i++) out += manaGlyph('moss', 0, size);
  return out;
}

// --------------------------------------------------------------- motifs
// Each motif returns SVG elements for a 100 x 70 box.

function backdrop(r, P, id) {
  const gid = `g${id}`;
  // One 2-stop linear sky: the only gradient (DESIGN.md 3.4). No glow,
  // no grain.
  return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky1}"/><stop offset="1" stop-color="${P.sky0}"/></linearGradient></defs>`
    + `<rect width="100" height="70" fill="url(#${gid})"/>`;
}

function insect(r, P, kw) {
  const cx = 50 + (r() - 0.5) * 8, cy = 38 + (r() - 0.5) * 6;
  const ang = (r() - 0.5) * 40;
  const abL = 13 + r() * 9, abW = 7 + r() * 6, thL = 6 + r() * 4, hd = 3.5 + r() * 2.5;
  const c0 = P.body[Math.floor(r() * 4)], c1 = P.body[Math.floor(r() * 4)];
  const thick = kw.includes('thick'), wings = kw.includes('wings'), sting = kw.includes('sting'), swift = kw.includes('swift');
  let s = `<g transform="rotate(${f1(ang)} ${f1(cx)} ${f1(cy)})">`;
  // legs: three pairs, two segments each
  for (let i = 0; i < 3; i++) {
    const bx = cx - thL * 0.5 + i * thL * 0.5;
    for (const sg of [-1, 1]) {
      const kx = bx + (i - 1) * (6 + r() * 4), ky = cy + sg * (8 + r() * 4);
      const fx = kx + (i - 1) * (4 + r() * 4), fy = ky + sg * (6 + r() * 5);
      s += `<polyline points="${f1(bx)},${f1(cy)} ${f1(kx)},${f1(ky)} ${f1(fx)},${f1(fy)}" fill="none" stroke="${P.deep}" stroke-width="${thick ? 2 : 1.3}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  // wings under the body halves, translucent
  if (wings) {
    const wl = 18 + r() * 10, ww = 6 + r() * 4;
    for (const sg of [-1, 1]) {
      s += `<ellipse cx="${f1(cx + wl * 0.35)}" cy="${f1(cy + sg * (ww + 1))}" rx="${f1(wl)}" ry="${f1(ww)}" transform="rotate(${f1(sg * (12 + r() * 14))} ${f1(cx)} ${f1(cy)})" fill="${P.glow}" fill-opacity="0.22" stroke="${P.glow}" stroke-opacity="0.7" stroke-width="0.6"/>`;
      s += `<path d="M${f1(cx)} ${f1(cy)} q ${f1(wl * 0.6)} ${f1(sg * ww * 0.9)} ${f1(wl * 1.25)} ${f1(sg * ww * 0.8)}" fill="none" stroke="${P.glow}" stroke-opacity="0.5" stroke-width="0.4" transform="rotate(${f1(sg * 16)} ${f1(cx)} ${f1(cy)})"/>`;
    }
  }
  // abdomen with segment bands
  const ax = cx + thL * 0.5 + abL * 0.85;
  s += `<ellipse cx="${f1(ax)}" cy="${f1(cy)}" rx="${f1(abL)}" ry="${f1(abW)}" fill="${c0}" stroke="${P.deep}" stroke-width="${thick ? 1.6 : 0.8}"/>`;
  const bands = 3 + Math.floor(r() * 3);
  for (let i = 1; i <= bands; i++) {
    const bx = ax - abL + (2 * abL * i) / (bands + 1);
    const hh = abW * Math.sqrt(Math.max(0, 1 - ((bx - ax) / abL) ** 2));
    s += `<line x1="${f1(bx)}" y1="${f1(cy - hh)}" x2="${f1(bx)}" y2="${f1(cy + hh)}" stroke="${P.deep}" stroke-width="${thick ? 1.4 : 0.8}" opacity="0.8"/>`;
  }
  if (sting) s += `<path d="M${f1(ax + abL - 1)} ${f1(cy - 1.6)} L${f1(ax + abL + 7)} ${f1(cy)} L${f1(ax + abL - 1)} ${f1(cy + 1.6)}z" fill="#f4f0e0" stroke="${P.deep}" stroke-width="0.5"/>`;
  // thorax and head
  s += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(thL)}" ry="${f1(abW * 0.65)}" fill="${c1}" stroke="${P.deep}" stroke-width="${thick ? 1.6 : 0.8}"/>`;
  if (thick) s += `<path d="M${f1(cx - thL)} ${f1(cy)} q ${f1(thL)} ${f1(-abW * 1.1)} ${f1(thL * 2)} 0" fill="none" stroke="${P.glow}" stroke-width="1" opacity="0.7"/>`;
  const hx = cx - thL - hd * 0.8;
  s += `<circle cx="${f1(hx)}" cy="${f1(cy)}" r="${f1(hd)}" fill="${c0}" stroke="${P.deep}" stroke-width="0.8"/>`;
  // compound eyes, deep red like a fly's
  s += `<circle cx="${f1(hx - hd * 0.3)}" cy="${f1(cy - hd * 0.55)}" r="${f1(hd * 0.45)}" fill="#b0232a"/><circle cx="${f1(hx - hd * 0.3)}" cy="${f1(cy + hd * 0.55)}" r="${f1(hd * 0.45)}" fill="#b0232a"/>`;
  // antennae
  const al = 7 + r() * 8;
  for (const sg of [-1, 1]) s += `<path d="M${f1(hx - hd * 0.8)} ${f1(cy + sg * 1)} q ${f1(-al * 0.5)} ${f1(sg * al * 0.2)} ${f1(-al)} ${f1(sg * al * 0.7)}" fill="none" stroke="${P.deep}" stroke-width="0.9" stroke-linecap="round"/>`;
  s += '</g>';
  // speed lines for swift
  if (swift) for (let i = 0; i < 4; i++) { const y = 20 + r() * 34; s += `<line x1="${f1(70 + r() * 10)}" y1="${f1(y)}" x2="${f1(92 + r() * 6)}" y2="${f1(y)}" stroke="${P.glow}" stroke-width="0.8" opacity="0.6" stroke-linecap="round"/>`; }
  return s;
}

function plant(r, P, kind) {
  const bx = 50 + (r() - 0.5) * 10, by = 66;
  let s = `<path d="M0 64 Q50 ${f1(58 + r() * 4)} 100 64 V70 H0z" fill="${P.deep}"/>`;
  // a stem that bends
  const tx = bx + (r() - 0.5) * 20, ty = 22 + r() * 10;
  s += `<path d="M${f1(bx)} ${by} Q ${f1(bx + (r() - 0.5) * 30)} ${f1((by + ty) / 2)} ${f1(tx)} ${f1(ty)}" fill="none" stroke="${P.body[1]}" stroke-width="2.2" stroke-linecap="round"/>`;
  // leaves along the stem
  const nl = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nl; i++) {
    const t = 0.25 + (i / nl) * 0.6, lx = bx + (tx - bx) * t, ly = by + (ty - by) * t, sg = i % 2 ? 1 : -1;
    s += `<path d="M${f1(lx)} ${f1(ly)} q ${f1(sg * 9)} ${f1(-6)} ${f1(sg * 15)} ${f1(-2 - r() * 4)} q ${f1(-sg * 8)} ${f1(5)} ${f1(-sg * 15)} ${f1(2 + r() * 4)}z" fill="${P.body[(i + 2) % 4]}" opacity="0.9"/>`;
  }
  switch (kind) {
    case 'damage': { // thorn burst
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + r() * 0.3, l = 9 + r() * 9;
        s += `<path d="M${f1(tx + Math.cos(a + 0.12) * 3)} ${f1(ty + Math.sin(a + 0.12) * 3)} L${f1(tx + Math.cos(a) * l)} ${f1(ty + Math.sin(a) * l)} L${f1(tx + Math.cos(a - 0.12) * 3)} ${f1(ty + Math.sin(a - 0.12) * 3)}z" fill="${P.glow}"/>`; }
      s += `<circle cx="${f1(tx)}" cy="${f1(ty)}" r="4" fill="${P.ink}"/>`; break;
    }
    case 'draw': { // unfurling fern spiral
      let d = `M${f1(tx)} ${f1(ty)}`;
      for (let i = 1; i < 40; i++) { const a = i * 0.32, rr = 0.35 * i; d += ` L${f1(tx + Math.cos(a) * rr)} ${f1(ty - Math.sin(a) * rr)}`; }
      s += `<path d="${d}" fill="none" stroke="${P.glow}" stroke-width="2" stroke-linecap="round"/>`; break;
    }
    case 'pump': { // a swelling bud
      s += `<ellipse cx="${f1(tx)}" cy="${f1(ty - 6)}" rx="8" ry="11" fill="${P.ink}" stroke="${P.deep}"/><path d="M${f1(tx)} ${f1(ty - 17)} V${f1(ty + 4)}" stroke="${P.deep}" stroke-width="0.8"/>`;
      for (let i = 0; i < 3; i++) s += `<circle cx="${f1(tx + 12 + i * 3)}" cy="${f1(ty - 12 + i * 5)}" r="${f1(1.2 + i * 0.4)}" fill="${P.glow}" opacity="0.7"/>`;
      break;
    }
    case 'heal': { // an open flower
      const np = 5 + Math.floor(r() * 4);
      for (let i = 0; i < np; i++) { const a = (i / np) * 360; s += `<ellipse cx="${f1(tx)}" cy="${f1(ty - 7)}" rx="3.4" ry="7" fill="${P.glow}" transform="rotate(${f1(a)} ${f1(tx)} ${f1(ty)})" opacity="0.92"/>`; }
      s += `<circle cx="${f1(tx)}" cy="${f1(ty)}" r="3.6" fill="${P.ink}"/>`; break;
    }
    case 'destroy': { // a closing trap leaf
      s += `<path d="M${f1(tx - 12)} ${f1(ty)} q 12 -16 24 0z" fill="${P.ink}" stroke="${P.deep}"/><path d="M${f1(tx - 12)} ${f1(ty + 2)} q 12 14 24 0z" fill="${P.body[3]}" stroke="${P.deep}"/>`;
      for (let i = 0; i < 7; i++) { const x = tx - 10 + i * 3.4; s += `<line x1="${f1(x)}" y1="${f1(ty - 1)}" x2="${f1(x + 0.6)}" y2="${f1(ty - 5)}" stroke="#f4f0e0" stroke-width="0.8"/><line x1="${f1(x)}" y1="${f1(ty + 3)}" x2="${f1(x + 0.6)}" y2="${f1(ty + 7)}" stroke="#f4f0e0" stroke-width="0.8"/>`; }
      break;
    }
    case 'token': { // an egg cluster
      for (let i = 0; i < 9; i++) s += `<ellipse cx="${f1(tx + (r() - 0.5) * 16)}" cy="${f1(ty + (r() - 0.5) * 10)}" rx="2.4" ry="3.4" fill="#f4f0e0" stroke="${P.deep}" stroke-width="0.5"/>`;
      break;
    }
    default: {
      s += `<circle cx="${f1(tx)}" cy="${f1(ty)}" r="6" fill="${P.ink}"/>`;
    }
  }
  return s;
}

function landscape(r, P) {
  let s = '';
  const sunY = 14 + r() * 12;
  s += `<circle cx="${f1(20 + r() * 60)}" cy="${f1(sunY)}" r="${f1(6 + r() * 5)}" fill="${P.glow}" opacity="0.55"/>`;
  for (let k = 0; k < 3; k++) {
    const base = 40 + k * 9;
    let d = `M0 ${f1(base)}`;
    for (let x = 0; x <= 100; x += 10) d += ` L${x} ${f1(base - r() * (10 - k * 2))}`;
    d += ' L100 70 L0 70z';
    s += `<path d="${d}" fill="${P.body[(k + 1) % 4]}" opacity="${f1(0.35 + k * 0.25)}"/>`;
  }
  // tufts or resin drops in the front
  const n = 5 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const x = r() * 100, y = 58 + r() * 10;
    s += P === PALETTE.amber
      ? `<path d="M${f1(x)} ${f1(y - 4)} c 2 3 2.4 4 2.4 4.8 a2.4 2.4 0 0 1 -4.8 0 c0 -.8 .4 -1.8 2.4 -4.8z" fill="${P.glow}" opacity="0.85"/>`
      : `<path d="M${f1(x)} ${f1(y)} q -2 -5 -4 -6 M${f1(x)} ${f1(y)} q 0 -6 1 -8 M${f1(x)} ${f1(y)} q 2 -5 4 -6" stroke="${P.glow}" stroke-width="0.9" fill="none" opacity="0.85"/>`;
  }
  return s;
}

// The picture of one card as an SVG string. card = { id, colour, type,
// keywords?, effect? }. The result is the same for the same id.
export function cardArt(card, cls = 'art') {
  const id = String(card?.id ?? 'x');
  const h = hashId(id), r = rngFrom(h);
  const P = PALETTE[colourKey(card?.colour)];
  const uid = (h % 1e7).toString(36);
  let body = backdrop(r, P, uid);
  if (card?.type === 'creature') body += insect(r, P, card.keywords || []);
  else if (card?.type === 'land') body += landscape(r, P);
  else body += plant(r, P, card?.effect?.kind);
  return `<svg class="${cls}" viewBox="0 0 100 70" preserveAspectRatio="xMidYMid slice" role="img" aria-label="art for ${id.replace(/[<>"&]/g, '')}">${body}</svg>`;
}

// ============================================================================
//  CHORD CHART  ·  diagrams.js — chord diagrams as SVG strings
// ----------------------------------------------------------------------------
//  One SVG per diagram, in a fixed 200 x 240 viewBox, so every card has the
//  same stroke widths and the same dot size at any display size. No DOM:
//  each function returns markup, and main.js puts it into the page.
//  Classic script: it sets window.ChordDiagrams (module.exports in Node).
//  It reads window.ChordTheory (theory.js), which loads first.
//
//  FRETTED DIAGRAM  (guitar, ukulele: one voicing)
//      × ○         ○        row above the nut: × muted, ○ open string
//     ━━━━━━━━━━━━━━━━━━━   the nut (or a "3fr" label when the hand is up)
//      │  │  ●  │  │  │     a dot per fretted note, in its pitch colour,
//     ─┼──┼──┼──┼──┼──┼─    with the note name; the root has a white ring
//      │  ●  │  │  ●  │     a barre is a soft band across its strings
//      1  3  5  1  3  5     interval of each string (1 is the root)
//
//  TONE MAP  (bass, violin: every chord tone in the first position)
//      the same frame, a dot wherever a chord tone sits; string names below
//
//  GREP MAP
//    pitch colours ........ "const pcColor"
//    fretted diagram ...... "function frettedSVG"
//    tone map ............. "function toneMapSVG"
//    any instrument ....... "function diagramSVG"
// ============================================================================
(function (root) {
'use strict';
const T = root.ChordTheory || (typeof require !== 'undefined' ? require('./theory.js') : null);

// One hue per pitch class (30 degrees a semitone), the same as ChordLab, so a
// note has one colour in every diagram.
const pcColor = (pc, l = 64) => `hsl(${pc * 30},86%,${l}%)`;
const pcColorA = (pc, a, l = 64) => `hsla(${pc * 30},86%,${l}%,${a})`;

const W = 200, H = 240;
const FONT = "'IBM Plex Mono',ui-monospace,Menlo,monospace";
const INK_DARK = '#0b0e15';
const f1 = v => Math.round(v * 10) / 10;

// The spelled name and interval symbol of each pitch class in the chord.
function toneTable(rootPc, q) {
  const s = T.spellChord(rootPc, q), tab = {};
  for (const n of s.notes) tab[n.pc] = n;
  return tab;
}

function dot(cx, cy, r, pc, name, isRoot) {
  let o = '';
  if (isRoot) o += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r + 3.2)}" fill="none" stroke="rgba(255,255,255,.82)" stroke-width="1.4"/>`;
  o += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${pcColor(pc, 62)}"/>`;
  const fs = name.length > 1 ? 9 : 10.5;
  o += `<text x="${f1(cx)}" y="${f1(cy + fs * 0.36)}" font-size="${fs}" font-weight="600" fill="${INK_DARK}" text-anchor="middle">${name}</text>`;
  return o;
}
function openRing(cx, cy, pc, isRoot) {
  let o = `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="6" fill="none" stroke="${pcColor(pc, 66)}" stroke-width="2"/>`;
  if (isRoot) o += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="9.5" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.1"/>`;
  return o;
}
const open = (label) => `<svg class="dgm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" font-family="${FONT}">`;

// A fretted voicing (guitar or ukulele).
function frettedSVG(inst, rootPc, q, v) {
  const tun = T.TUNINGS[inst], NS = tun.midi.length, frets = v.frets;
  const tones = toneTable(rootPc, q);
  const played = frets.filter(f => f >= 0), fingered = frets.filter(f => f > 0);
  const fMax = played.length ? Math.max(...played) : 3;
  const fMin = fingered.length ? Math.min(...fingered) : 0;
  // Open position when the shape fits in 4 frets; else start at the lowest
  // fingered fret, so a high shape stays on the diagram.
  const base = fMax <= 4 ? 0 : Math.max(1, fMin);
  const nF = Math.max(5, fMax - base + (base > 0 ? 1 : 0));
  const pad = { t: 42, b: 36, l: 34, r: 18 };
  const gw = W - pad.l - pad.r, gh = H - pad.t - pad.b;
  const sx = s => pad.l + gw * s / (NS - 1), fy = f => pad.t + gh * f / nF;
  // Row centre of fret f in this window.
  const rowY = f => fy(base > 0 ? f - base + 0.5 : f - 0.5);
  const r = Math.min(11.5, (gw / (NS - 1)) * 0.4);
  let o = open(`${T.spellChord(rootPc, q).symbol} on ${inst}`);
  // frets
  for (let f = 0; f <= nF; f++) {
    const nut = f === 0 && base === 0;
    o += `<line x1="${pad.l}" y1="${f1(fy(f))}" x2="${pad.l + gw}" y2="${f1(fy(f))}" stroke="${nut ? '#e8ecf4' : 'rgba(150,200,255,.2)'}" stroke-width="${nut ? 5 : 1}" stroke-linecap="round"/>`;
  }
  // strings: low strings a little thicker
  for (let s = 0; s < NS; s++) {
    o += `<line x1="${f1(sx(s))}" y1="${pad.t}" x2="${f1(sx(s))}" y2="${pad.t + gh}" stroke="rgba(150,200,255,.34)" stroke-width="${f1(1.7 - s * (0.9 / (NS - 1)))}"/>`;
  }
  // position label
  if (base > 0) o += `<text x="${pad.l - 8}" y="${f1(rowY(base) + 4)}" font-size="11" font-weight="500" fill="#8a9bb8" text-anchor="end">${base}fr</text>`;
  // barre band across the strings held at the barre fret
  if (v.barre) {
    const held = frets.map((f, s) => (f === v.barre ? s : -1)).filter(s => s >= 0);
    if (held.length > 1) {
      const y = rowY(v.barre), x0 = sx(Math.min(...held)), x1 = sx(Math.max(...held));
      o += `<rect x="${f1(x0 - r - 2)}" y="${f1(y - r - 2)}" width="${f1(x1 - x0 + 2 * r + 4)}" height="${f1(2 * r + 4)}" rx="${f1(r + 2)}" fill="${pcColorA(rootPc, 0.2, 55)}" stroke="${pcColorA(rootPc, 0.45, 60)}" stroke-width="1"/>`;
    }
  }
  // markers, dots, interval row
  for (let s = 0; s < NS; s++) {
    const f = frets[s], X = sx(s);
    if (f < 0) {
      o += `<text x="${f1(X)}" y="${pad.t - 10}" font-size="13" fill="rgba(232,96,96,.85)" text-anchor="middle">×</text>`;
      o += `<text x="${f1(X)}" y="${H - 12}" font-size="10" fill="rgba(128,144,176,.5)" text-anchor="middle">·</text>`;
      continue;
    }
    const pc = (tun.midi[s] + f) % 12, t = tones[pc];
    if (f === 0) o += openRing(X, pad.t - 15, pc, pc === rootPc);
    else o += dot(X, rowY(f), r, pc, t ? t.name : T.pcName(pc), pc === rootPc);
    o += `<text x="${f1(X)}" y="${H - 12}" font-size="10" font-weight="500" fill="${pcColor(pc, 68)}" text-anchor="middle">${t ? t.sym : '?'}</text>`;
  }
  return o + '</svg>';
}

// Bass or violin: every chord tone in the first position.
function toneMapSVG(inst, rootPc, q) {
  const tun = T.TUNINGS[inst], tones = toneTable(rootPc, q);
  const NP = inst === 'bass' ? 5 : 7;
  // A wider left margin than the fretted diagram: the low string has dots
  // at the edge, and the position numbers must stay clear of them.
  const pad = { t: 42, b: 36, l: 46, r: 22 };
  const gw = W - pad.l - pad.r, gh = H - pad.t - pad.b;
  const sx = s => pad.l + gw * s / 3, fy = f => pad.t + gh * f / NP;
  const fretted = inst === 'bass';
  const r = Math.min(11, gw / 3 * 0.3);
  let o = open(`${T.spellChord(rootPc, q).symbol} tones on ${inst}`);
  for (let f = 0; f <= NP; f++) {
    const nut = f === 0;
    o += `<line x1="${pad.l}" y1="${f1(fy(f))}" x2="${pad.l + gw}" y2="${f1(fy(f))}" stroke="${nut ? '#e8ecf4' : fretted ? 'rgba(150,200,255,.2)' : 'rgba(150,200,255,.08)'}" stroke-width="${nut ? 5 : 1}" stroke-linecap="round"${!nut && !fretted ? ' stroke-dasharray="2 4"' : ''}/>`;
  }
  for (let s = 0; s < 4; s++) {
    o += `<line x1="${f1(sx(s))}" y1="${pad.t}" x2="${f1(sx(s))}" y2="${pad.t + gh}" stroke="rgba(150,200,255,.34)" stroke-width="${f1(2 - s * 0.35)}"/>`;
    o += `<text x="${f1(sx(s))}" y="${H - 12}" font-size="11" font-weight="500" fill="#8a9bb8" text-anchor="middle">${tun.names[s]}</text>`;
  }
  // position numbers in the left gutter
  for (let f = 1; f <= NP; f++) o += `<text x="${pad.l - 22}" y="${f1((fretted ? fy(f - 0.5) : fy(f)) + 3.5)}" font-size="9" fill="rgba(128,144,176,.6)" text-anchor="end">${f}</text>`;
  for (let s = 0; s < 4; s++) for (let f = 0; f <= NP; f++) {
    const pc = (tun.midi[s] + f) % 12, t = tones[pc];
    if (!t) continue;
    const X = sx(s);
    if (f === 0) o += openRing(X, pad.t - 15, pc, pc === rootPc);
    else o += dot(X, fretted ? fy(f - 0.5) : fy(f), r, pc, t.name, pc === rootPc);
  }
  return o + '</svg>';
}

// The diagram for any instrument. v is a voicing from ChordTheory.voicingsFor.
function diagramSVG(inst, rootPc, q, v) {
  return T.TUNINGS[inst].fretted ? frettedSVG(inst, rootPc, q, v) : toneMapSVG(inst, rootPc, q);
}

const API = { pcColor, pcColorA, diagramSVG, frettedSVG, toneMapSVG };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.ChordDiagrams = API;
})(typeof window !== 'undefined' ? window : globalThis);

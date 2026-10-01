// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  dials.js — paint a dial for a face spec
// ────────────────────────────────────────────────────────────────────────────
//  dialPainter(face, o) returns a canvas painter for B.dialFace: g is a 2D
//  context in mm, origin at the centre, y down, dial radius R. o: { sub:
//  [cy, r] | null, aperture: [cy, r] | null, line: caption, serifBrand }.
//  Every base, numeral style and track in catalog.js is painted here; all
//  sizes scale with R, so a 13 mm wristwatch dial and a 140 mm wall clock
//  dial look alike. Fonts go through g.font and g.fillText only (the kit's
//  dialFace proxy lays text out at a normal size; never use measureText).
//
//  GREP MAP
//    const BASES ............ plate colours and ink for each base
//    function background .... the plate and its finish (guilloché, clous...)
//    function track ......... the minute track and outer scales
//    function numerals ...... the hour markers
//    function OPEN_BASES / dialHoles   open-worked dials (needs wiring)
// ============================================================================
const TAU = Math.PI * 2;
const SERIF = '"STIX Two Text","Times New Roman",Georgia,serif', SANS = 'Inter,Helvetica,Arial,sans-serif';
const SANS_BOLD = '"Helvetica Neue",Inter,Helvetica,Arial,sans-serif';
const RED = '#b0302a';

// [centre, edge, ink]
const BASES = {
  enamel: ['#fbf8f0', '#ece5d6', '#1d1b22'], cream: ['#f6ead0', '#e2d0a8', '#2a2016'], black: ['#1e2026', '#0b0c10', '#e8e2d2'],
  slate: ['#4a5260', '#2c323c', '#eef0f4'], 'sunray-blue': ['#2f4a86', '#13213f', '#eef0f6'], 'sunray-green': ['#2f5c48', '#14281f', '#eef2ea'],
  salmon: ['#f1c2a6', '#d99b7a', '#2b1a14'], 'silver-guilloche': ['#e8eaee', '#bfc4cc', '#1d2026'],
  opaline: ['#efede6', '#d9d6cc', '#24242a'], sector: ['#ebe9e3', '#d2cfc6', '#202028'], 'pie-pan': ['#ece2cb', '#b9ab8c', '#1f1a14'],
  'two-tone': ['#f0e8d4', '#c7cad0', '#1e2028'], tropical: ['#8a5a34', '#3a2414', '#efdcbc'], lacquer: ['#1a171b', '#050406', '#d9b56a'],
  cartouche: ['#fbf8f0', '#ece5d6', '#17151c'], cloisonne: ['#f4ecd8', '#e2d4b4', '#1c1a20'], linen: ['#dcd7cc', '#c4beb1', '#25252b'],
  brushed: ['#dadcdf', '#aeb2b9', '#1f2228'], clous: ['#2f4268', '#15203a', '#eef0f6'], tapisserie: ['#2a3e68', '#121b33', '#eef0f6'],
  'breguet-guilloche': ['#eeeff1', '#cfd2d8', '#1d2026'],
};
// open-worked bases leave the centre open over the movement; the dial
// builder must cut dialHoles() from the plate before they can be rolled
export const OPEN_BASES = ['openworked'];
export const dialHoles = (face, R) => face.base === 'openworked' ? [[0, 0, R * 0.62]] : [];
BASES.openworked = ['#1b1c22', '#101116', '#e8e2d2'];

export const KNOWN = { bases: Object.keys(BASES), numerals: ['roman', 'arabic', 'breguet', 'baton', 'dots', 'california', 'turkish', 'railroad', 'applied', 'arrow', 'triangle', 'twentyfour'], tracks: ['railway', 'minutes', 'dots', 'none', 'chemin', 'fivemin', 'tachymeter', 'pulsometer'] };

// a fixed pseudo-random stream, so a dial paints the same every time
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const clipDisc = (g, r) => { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip(); };
const polar = (r, t) => [Math.sin(t) * r, -Math.cos(t) * r];       // t from 12, clockwise

function background(g, R, base) {
  const [a, b] = BASES[base] || BASES.enamel;
  const bg = g.createRadialGradient(-R * 0.16, -R * 0.27, R * 0.01, 0, 0, R);
  bg.addColorStop(0, a); bg.addColorStop(1, b);
  g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  g.save(); clipDisc(g, R);
  const rnd = lcg(base.length * 7919 + 17);
  if (base.startsWith('sunray')) for (let i = 0; i < 360; i++) {
    const t = i / 360 * TAU;
    g.strokeStyle = `rgba(255,255,255,${0.02 + 0.035 * Math.abs(Math.sin(t * 2))})`; g.lineWidth = R * 0.0016;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(...polar(R, t)); g.stroke();
  }
  if (base === 'silver-guilloche' || base === 'breguet-guilloche') {         // barleycorn waves
    const r1 = base === 'breguet-guilloche' ? 0.58 : 0.62;
    g.strokeStyle = 'rgba(80,88,100,0.16)'; g.lineWidth = R * 0.002;
    for (let k = 1; k < 60; k++) {
      const r0 = R * r1 * k / 60;
      g.beginPath();
      for (let i = 0; i <= 240; i++) { const t = i / 240 * TAU, r = r0 + R * 0.006 * Math.sin(t * 36 + k); g.lineTo(...polar(r, t)); }
      g.stroke();
    }
    if (base === 'breguet-guilloche') {        // a plain polished chapter ring round the guilloché
      const rg = g.createLinearGradient(-R, -R, R, R); rg.addColorStop(0, '#f6f7f9'); rg.addColorStop(0.5, '#d9dce1'); rg.addColorStop(1, '#f2f3f5');
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.arc(0, 0, R * 0.6, 0, TAU, true); g.fill();
      g.strokeStyle = 'rgba(40,44,52,0.45)'; g.lineWidth = R * 0.004;
      for (const r of [R * 0.6, R * 0.615]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    }
  }
  if (base === 'opaline') for (let i = 0; i < 2600; i++) {       // a fine grained silvering
    const [x, y] = polar(Math.sqrt(rnd()) * R, rnd() * TAU);
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '90,90,96'},${0.05 + rnd() * 0.06})`;
    g.fillRect(x, y, R * 0.004, R * 0.004);
  }
  if (base === 'sector') {                    // zones split by printed circles and hour radii
    g.fillStyle = 'rgba(0,0,0,0.05)'; g.beginPath(); g.arc(0, 0, R * 0.95, 0, TAU); g.arc(0, 0, R * 0.86, 0, TAU, true); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(0, 0, R * 0.62, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(30,30,40,0.6)'; g.lineWidth = R * 0.004;
    for (const r of [R * 0.2, R * 0.62, R * 0.86]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 12; i++) { const t = i / 12 * TAU; g.beginPath(); g.moveTo(...polar(R * 0.62, t)); g.lineTo(...polar(R * 0.86, t)); g.stroke(); }
  }
  if (base === 'pie-pan') {                   // a flat centre and twelve sloped facets
    for (let i = 0; i < 12; i++) {
      const t0 = (i - 0.5) / 12 * TAU, t1 = (i + 0.5) / 12 * TAU, sh = 0.5 + 0.5 * Math.cos(t0 + TAU / 24 - 0.9);
      g.fillStyle = `rgba(${sh > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + 0.1 * Math.abs(sh - 0.5)})`;
      g.beginPath(); g.moveTo(...polar(R * 0.6, t0)); g.lineTo(...polar(R, t0)); g.lineTo(...polar(R, t1)); g.lineTo(...polar(R * 0.6, t1)); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(60,50,30,0.3)'; g.lineWidth = R * 0.003;
    g.beginPath(); for (let i = 0; i <= 12; i++) g.lineTo(...polar(R * 0.6, (i - 0.5) / 12 * TAU)); g.stroke();
  }
  if (base === 'two-tone') {
    g.fillStyle = '#c9ccd2'; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.arc(0, 0, R * 0.7, 0, TAU, true); g.fill();
    g.strokeStyle = 'rgba(40,40,50,0.5)'; g.lineWidth = R * 0.004; g.beginPath(); g.arc(0, 0, R * 0.7, 0, TAU); g.stroke();
  }
  if (base === 'tropical') {                  // sun-faded, mottled brown
    for (let i = 0; i < 70; i++) {
      const [x, y] = polar(Math.sqrt(rnd()) * R, rnd() * TAU), r = R * (0.04 + rnd() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rnd() < 0.5 ? 'rgba(200,150,95,0.16)' : 'rgba(40,22,10,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    const ed = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R); ed.addColorStop(0, 'rgba(0,0,0,0)'); ed.addColorStop(1, 'rgba(25,12,4,0.35)');
    g.fillStyle = ed; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  }
  if (base === 'lacquer') {                   // a deep gloss with a soft reflection
    const hl = g.createLinearGradient(-R, -R, R * 0.2, R * 0.4);
    hl.addColorStop(0, 'rgba(255,255,255,0.10)'); hl.addColorStop(0.45, 'rgba(255,255,255,0.0)');
    g.fillStyle = hl; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  }
  if (base === 'cloisonne') {                 // enamel cells in gold wire, a cream chapter ring
    g.fillStyle = '#1d3a6e'; g.beginPath(); g.arc(0, 0, R * 0.6, 0, TAU); g.fill();
    const cols = ['#2f9a9a', '#c4553a', '#e0b84a', '#3a7a4a'];
    g.lineWidth = R * 0.006; g.strokeStyle = '#d8b062';
    for (let i = 0; i < 12; i++) {
      const t = i / 12 * TAU;
      g.save(); g.rotate(t);
      g.fillStyle = cols[i % 4]; g.beginPath(); g.ellipse(0, -R * 0.36, R * 0.07, R * 0.19, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = cols[(i + 2) % 4]; g.beginPath(); g.arc(0, -R * 0.55, R * 0.025, 0, TAU); g.fill(); g.stroke();
      g.restore();
    }
    g.fillStyle = '#e0b84a'; g.beginPath(); g.arc(0, 0, R * 0.09, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, 0, R * 0.6, 0, TAU); g.stroke();
  }
  if (base === 'linen') {                     // a fine woven crosshatch
    g.lineWidth = R * 0.0018;
    for (let k = -R; k <= R; k += R * 0.012) {
      g.strokeStyle = `rgba(60,55,45,${0.05 + 0.04 * rnd()})`;
      g.beginPath(); g.moveTo(k, -R); g.lineTo(k, R); g.stroke();
      g.beginPath(); g.moveTo(-R, k); g.lineTo(R, k); g.stroke();
    }
  }
  if (base === 'brushed') {                   // vertical satin brushing
    for (let i = 0; i < 700; i++) {
      const x = -R + rnd() * 2 * R;
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '40,44,50'},${0.04 + rnd() * 0.06})`; g.lineWidth = R * (0.001 + rnd() * 0.003);
      g.beginPath(); g.moveTo(x, -R); g.lineTo(x + R * 0.01 * (rnd() - 0.5), R); g.stroke();
    }
  }
  if (base === 'clous' || base === 'tapisserie') {       // hobnail pyramids or square tapestry
    const s = R * (base === 'clous' ? 0.05 : 0.065);
    for (let y = -R; y < R; y += s) for (let x = -R; x < R; x += s) {
      if (Math.hypot(x + s / 2, y + s / 2) > R + s) continue;
      if (base === 'clous') {
        const cx = x + s / 2, cy = y + s / 2;
        for (const [dx, dy, a] of [[0, -1, 0.16], [1, 0, 0.04], [0, 1, -0.14], [-1, 0, 0.06]]) {
          g.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
          g.beginPath(); g.moveTo(cx, cy);
          g.lineTo(cx + (dx - dy) * s / 2, cy + (dy + dx) * s / 2); g.lineTo(cx + (dx + dy) * s / 2, cy + (dy - dx) * s / 2); g.closePath(); g.fill();
        }
      } else {
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y, s, s * 0.08); g.fillRect(x, y, s * 0.08, s);
      }
    }
  }
  if (base === 'openworked') {                // a printed ring; the centre is cut away by the builder
    g.fillStyle = '#0b0c10'; g.beginPath(); g.arc(0, 0, R * 0.62, 0, TAU); g.fill();
  }
  g.restore();
}

// the outer scales take the rim, so the hour numerals move in
const OUTER = new Set(['fivemin', 'tachymeter', 'pulsometer']);
function ticks(g, R, r0, r1, rMaj, ink, w = 1) {
  g.strokeStyle = ink;
  for (let i = 0; i < 60; i++) {
    const t = i / 60 * TAU;
    g.lineWidth = R * (i % 5 ? 0.0045 : 0.01) * w;
    g.beginPath(); g.moveTo(...polar(i % 5 ? r0 : rMaj, t)); g.lineTo(...polar(r1, t)); g.stroke();
  }
}
function track(g, R, s, ink) {
  const tr = s.track;
  g.fillStyle = ink; g.strokeStyle = ink;
  if (tr === 'railway' || tr === 'chemin') {
    g.lineWidth = R * 0.0045;
    for (const r of [R * 0.885, R * 0.94]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    ticks(g, R, R * 0.885, R * 0.94, R * 0.885, ink);
    if (tr === 'chemin') for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(...polar(R * 0.968, i / 12 * TAU), R * 0.014, 0, TAU); g.fill(); }
  } else if (tr === 'minutes') ticks(g, R, R * 0.9, R * 0.94, R * 0.86, ink);
  else if (tr === 'dots') for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(...polar(R * 0.915, i / 60 * TAU), R * (i % 5 ? 0.006 : 0.014), 0, TAU); g.fill(); }
  else if (tr === 'fivemin') {
    ticks(g, R, R * 0.855, R * 0.89, R * 0.83, ink);
    g.font = `500 ${R * 0.05}px ${SANS}`;
    for (let i = 1; i <= 12; i++) g.fillText(String(i * 5).padStart(2, '0'), ...polar(R * 0.935, i / 12 * TAU));
  } else if (tr === 'tachymeter' || tr === 'pulsometer') {
    ticks(g, R, R * 0.84, R * 0.87, R * 0.82, ink);
    const col = tr === 'pulsometer' ? RED : ink;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = R * 0.004;
    for (const r of [R * 0.885, R * 0.985]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    // tachymeter: units per hour from the seconds elapsed (3600 / s);
    // pulsometer: beats per minute graduated for 30 pulsations (1800 / s)
    const vals = tr === 'tachymeter' ? [500, 400, 300, 250, 200, 180, 160, 140, 120, 110, 100, 90, 80, 75, 70, 65, 60] : [200, 180, 160, 140, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30];
    const k = tr === 'tachymeter' ? 3600 : 1800;
    g.font = `500 ${R * 0.042}px ${SANS}`;
    for (const v of vals) {
      const t = (k / v) / 60 * TAU;
      g.beginPath(); g.moveTo(...polar(R * 0.885, t)); g.lineTo(...polar(R * 0.91, t)); g.stroke();
      g.save(); g.translate(...polar(R * 0.945, t)); g.rotate(t); g.fillText(String(v), 0, 0); g.restore();
    }
    g.font = `600 ${R * 0.032}px ${SANS}`;
    g.save(); g.translate(...polar(R * 0.945, TAU * 0.5)); g.rotate(0); g.fillText(tr === 'tachymeter' ? 'TACHYMETRE' : 'PULSATIONS', 0, 0); g.restore();
    g.fillStyle = ink; g.strokeStyle = ink;
  }
}

const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
const TURKISH = ['١٢', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠', '١١'];
function plaque(g, R, t, cx, cy, n) {          // a cartouche: a white enamel plaque with a blue rim
  const w = R * (0.06 + 0.055 * n), h = R * 0.13;
  g.save(); g.translate(cx, cy); g.rotate(t);
  g.fillStyle = '#ffffff'; g.strokeStyle = '#3a4a8a'; g.lineWidth = R * 0.006;
  g.beginPath(); const r = h * 0.35;
  g.moveTo(-w / 2 + r, -h / 2); g.lineTo(w / 2 - r, -h / 2); g.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); g.lineTo(w / 2, h / 2 - r);
  g.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); g.lineTo(-w / 2 + r, h / 2); g.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); g.lineTo(-w / 2, -h / 2 + r);
  g.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function applied(g, R, t, r0, len, w, light) {   // a faceted applied index with a soft shadow
  g.save(); g.rotate(t);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-w / 2 + R * 0.006, -r0 + R * 0.006, w, len);
  const grd = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  if (light) { grd.addColorStop(0, '#3c3f46'); grd.addColorStop(0.5, '#9a9fa8'); grd.addColorStop(0.51, '#2a2c31'); grd.addColorStop(1, '#5a5e66'); }
  else { grd.addColorStop(0, '#9aa0ad'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(0.51, '#b8bcc6'); grd.addColorStop(1, '#8a909d'); }
  g.fillStyle = grd; g.fillRect(-w / 2, -r0, w, len);
  g.restore();
}
function numerals(g, R, s, ink, light) {
  const n = s.numerals, skip = i => i === 6 && (s.sub || s.aperture);
  const rn = OUTER.has(s.track) ? 0.68 : 0.75, k = OUTER.has(s.track) ? 0.9 : 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    if (skip(i)) continue;
    const t = i / 12 * TAU, [x, y] = polar(R * rn, t);
    g.fillStyle = ink;
    if (s.base === 'cartouche' && ['roman', 'arabic', 'breguet', 'turkish', 'california'].includes(n)) plaque(g, R, n === 'roman' || n === 'california' ? t : 0, x, y, (n === 'roman' ? RN[i] : String(i || 12)).length), g.fillStyle = '#17151c';
    const roman = () => { g.font = `500 ${R * 0.13 * k}px ${SERIF}`; g.save(); g.translate(x, y); g.rotate(t); g.scale(0.94, 1.2); g.fillText(RN[i], 0, 0); g.restore(); };
    if (n === 'roman') roman();
    else if (n === 'arabic' || n === 'breguet') {
      g.font = n === 'breguet' ? `italic ${R * 0.15 * k}px ${SERIF}` : `600 ${R * 0.14 * k}px ${SANS}`;
      g.fillText(String(i || 12), x, y);
    } else if (n === 'turkish') { g.font = `500 ${R * 0.14 * k}px ${SERIF}`; g.fillText(TURKISH[i], x, y); }
    else if (n === 'california') {
      if (i === 10 || i === 11 || i === 0 || i === 1 || i === 2) roman();
      else if (i === 3 || i === 9) { g.save(); g.translate(...polar(R * (rn + 0.05), t)); g.rotate(t); g.beginPath(); g.moveTo(-R * 0.035, -R * 0.05); g.lineTo(R * 0.035, -R * 0.05); g.lineTo(0, R * 0.05); g.closePath(); g.fill(); g.restore(); }
      else { g.font = `600 ${R * 0.14 * k}px ${SANS}`; g.fillText(String(i), x, y); }
    } else if (n === 'railroad') {
      g.font = `700 ${R * 0.16 * k}px ${SANS_BOLD}`; g.fillText(String(i || 12), ...polar(R * (rn - 0.02), t));
      if (!OUTER.has(s.track)) { g.fillStyle = RED; g.font = `600 ${R * 0.045}px ${SANS}`; g.fillText(String((i || 12) * 5), ...polar(R * 0.83, t)); }
    } else if (n === 'baton' || n === 'applied') {
      const w = R * (i % 3 ? 0.028 : 0.042), h = R * (i % 3 ? 0.12 : 0.16), r0 = R * (rn + 0.11);
      if (n === 'applied') { applied(g, R, t, r0, h, w * 1.25, light); if (i === 0) { applied(g, R, t - 0.035, r0, h, w * 1.1, light); applied(g, R, t + 0.035, r0, h, w * 1.1, light); } }
      else {
        g.save(); g.rotate(t);
        const grd = g.createLinearGradient(-w, 0, w, 0); grd.addColorStop(0, '#9aa0ad'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(1, '#8a909d');
        g.fillStyle = light ? ink : grd; g.fillRect(-w / 2, -r0, w, h); g.restore();
      }
    } else if (n === 'dots') { g.beginPath(); g.arc(x, y, R * (i % 3 ? 0.03 : 0.045), 0, TAU); g.fill(); }
    else if (n === 'arrow' || n === 'triangle') {
      const big = i % 3 === 0, r0 = R * (rn + 0.1), h = R * (big ? 0.16 : 0.12), w = R * (n === 'arrow' ? (big ? 0.05 : 0.035) : (big ? 0.09 : 0.06));
      g.save(); g.rotate(t); g.fillStyle = n === 'triangle' && i === 0 ? (light ? ink : '#e8f0d0') : ink;
      g.beginPath();
      if (n === 'arrow') { g.moveTo(-w / 2, -r0); g.lineTo(w / 2, -r0); g.lineTo(w * 0.15, -r0 + h); g.lineTo(-w * 0.15, -r0 + h); }
      else { g.moveTo(-w / 2, -r0); g.lineTo(w / 2, -r0); g.lineTo(0, -r0 + h * (i === 0 ? 1.2 : 0.8)); }
      g.closePath(); g.fill(); g.restore();
    } else if (n === 'twentyfour') {
      g.font = `600 ${R * 0.13 * k}px ${SANS}`; g.fillText(String(i || 12), x, y);
      g.fillStyle = s.accent || RED; g.font = `500 ${R * 0.055}px ${SANS}`; g.fillText(String((i || 12) + 12), ...polar(R * (rn - 0.17), t));
    }
  }
}
function subSeconds(g, cy, r, ink) {
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = r * 0.018;
  for (const rr of [r * 0.85, r]) { g.beginPath(); g.arc(0, cy, rr, 0, TAU); g.stroke(); }
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a), r0 = i % 5 ? r * 0.9 : r * 0.85;
    g.lineWidth = r * (i % 5 ? 0.013 : 0.026);
    g.beginPath(); g.moveTo(ca * r0, cy + sa * r0); g.lineTo(ca * r, cy + sa * r); g.stroke();
  }
  g.font = `${r * 0.25}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 1; i <= 6; i++) { const a = i / 6 * TAU; g.fillText(String(i * 10), Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66); }
}

export function dialPainter(f, o) {
  const s = { ...f, sub: o.sub, aperture: o.aperture };
  return (g, R) => {
    const ink = (BASES[f.base] || BASES.enamel)[2], light = !['black', 'slate', 'sunray-blue', 'sunray-green', 'tropical', 'lacquer', 'clous', 'tapisserie', 'openworked'].includes(f.base);
    background(g, R, f.base);
    track(g, R, s, ink);
    numerals(g, R, s, ink, light);
    if (s.sub) subSeconds(g, s.sub[0], s.sub[1], ink);
    if (s.aperture) { g.strokeStyle = '#b08a3e'; g.lineWidth = R * 0.02; g.beginPath(); g.arc(0, s.aperture[0], s.aperture[1] + R * 0.01, 0, TAU); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const brandY = f.numerals === 'twentyfour' ? -R * 0.3 : -R * 0.34;
    if (f.brand && f.base === 'cloisonne') {      // a cream cartouche keeps the name legible on the enamel
      const w = R * (0.1 + 0.045 * f.brand.length), h = R * 0.11;
      g.fillStyle = '#f4ecd8'; g.strokeStyle = '#d8b062'; g.lineWidth = R * 0.006;
      g.beginPath(); g.ellipse(0, brandY, w / 2, h / 2, 0, 0, TAU); g.fill(); g.stroke();
    }
    if (f.brand) { g.fillStyle = ink; g.font = `600 ${R * 0.068}px ${o.serifBrand ? SERIF : SANS}`; g.fillText(f.brand.toUpperCase(), 0, brandY); }
    if (o.line) { g.font = `500 ${R * 0.042}px ${SANS}`; g.fillStyle = f.accent || RED; g.fillText(o.line, 0, s.sub || s.aperture ? -R * 0.25 : R * 0.33); }
  };
}

// ============================================================================
//  MOLECULES  ·  draw2d.js — the skeletal formula as SVG text (no DOM)
// ────────────────────────────────────────────────────────────────────────────
//  render2D(M, opt) returns { svg, box } for a model from chem.js. The
//  drawing follows the ACS 1996 document settings, scaled to a bond length
//  BL = 30 units: line width 0.055 BL, double-bond spacing 0.18 BL, label
//  size 0.6 BL. Carbons are corners and line ends; heteroatoms carry their
//  hydrogens in the label (OH, NH2, H2N); a double bond in a ring has its
//  second line inside the ring; wedges and hashes start at the stereocentre.
//
//  opt (all optional)
//    lp, hC, hX, cL   0..1 morph controls: lone pairs, explicit H on carbon,
//                     explicit H on heteroatoms, carbon labels. All 0 is
//                     the skeletal formula; all 1 is the Lewis structure.
//    color            heteroatom labels in element colours (default true)
//    ink, paper       stroke colour, label knockout colour
//    groups           [{ atoms, color }] translucent halos under the drawing
//    hover, sel       { atoms: Set, bonds: Set } halos (hover gold, sel blue)
//    hit              true: add hit targets (data-a, data-b) for pointers
//    reveal           a number of bonds drawn so far (draw-on animation)
//    pad              margin round the drawing in BL units (default 0.7)
//    lw               line-width factor (thumbnails use about 1.6)
//    minW, minH       the least view box size in BL units (thumbnails)
//
//  grep -n targets
//    labels .......... "function labelOf"
//    clipping ........ "function clipEnd"
//    double bonds .... "function doubleSide"
//    bond drawing .... "function drawBond"
//    halos ........... "function halo"
//    lone pairs ...... "lonePairs("
// ============================================================================
import { el, placeHydrogens, lonePairs, freeDirections, ringBonds, isMetal } from './chem.js';

export const BL = 30;
const LW = 0.055 * BL, SPACE = 0.18 * BL, FS = 0.6 * BL, WEDGE = 0.2 * BL;
const INK_COLORS = { O: '#d7261e', N: '#2747c9', S: '#a88a00', P: '#d26a00', F: '#2f9e44', Cl: '#2f9e44', Br: '#9c2b2b', I: '#7a1fa2',
  B: '#c76a6a', Si: '#9a7448', Se: '#c47a00', Fe: '#b4501f', Pt: '#6b6b80', Mg: '#3d8a00', Co: '#c04f70' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const n2 = v => Math.round(v * 100) / 100;

// Approximate glyph advance in em for the label font (Arial-like).
function textW(s, fs) {
  let w = 0;
  for (const ch of s) w += /[MW]/.test(ch) ? 0.83 : /[A-Z]/.test(ch) ? 0.7 : /[il]/.test(ch) ? 0.25 : /[0-9]/.test(ch) ? 0.56 : 0.55;
  return w * fs;
}

// Does atom i need a label in the skeletal formula?
function needsLabel(M, i) {
  const z = M.z[i];
  if (z !== 6) return true;
  if (M.q[i] || (M.iso && M.iso.has(i)) || (M.rad && M.rad.has(i))) return true;
  let heavyN = 0, cN = 0;
  for (const e of M.nb[i]) { if (M.z[e.to] !== 1 || e.to < M.n) heavyN++; if (M.z[e.to] === 6) cN++; }
  if (heavyN === 0) return true;
  if (cN === 0 && heavyN <= 2 && !M.rings.some(r => r.atoms.includes(i))) return true;
  return false;
}

// The label of atom i: symbol, H count shown in the label, the side the
// H goes on, the charge text, and the box round it (atom-centred units).
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function labelOf(M, i, opt, hShownExplicit) {
  let sym = el(M.z[i]).sym;
  const mass = M.iso && M.iso.get(i);
  if (mass) sym = M.z[i] === 1 && mass === 2 ? 'D' : M.z[i] === 1 && mass === 3 ? 'T' : String(mass).split('').map(d => SUP[+d]).join('') + sym;
  if (M.rad && M.rad.get(i) === 1) sym += '•';
  const hHidden = M.hOf[i].length;
  const angs = [];
  for (const e of M.nb[i]) if (e.to < M.n) angs.push(Math.atan2(M.xy[2 * e.to + 1] - M.xy[2 * i + 1], M.xy[2 * e.to] - M.xy[2 * i]));
  // H on the side with no bonds: left when the bonds point right
  let mx = 0, my = 0; for (const a of angs) { mx += Math.cos(a); my += Math.sin(a); }
  let side = 'r';
  if (angs.length && mx > 0.3) side = 'l';
  if (angs.length === 1 && Math.abs(mx) < 0.3) side = my > 0 ? 'u' : 'd';
  if (angs.length >= 2 && Math.abs(mx) <= 0.3 && Math.abs(my) > 0.6) side = my > 0 ? 'u' : 'd';
  if (side === 'u' || side === 'd') side = 'r';
  const q = M.q[i];
  const qs = q ? (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '−') : '';
  const w0 = textW(sym, FS);
  return { sym, nH: hHidden, side, qs, w0, hShownExplicit };
}

// Clip the end of a segment that starts at a labelled atom. Returns the
// fraction t along (x0,y0)->(x1,y1) where the line leaves the label box.
function clipEnd(x0, y0, x1, y1, box) {
  if (!box) return 0;
  const dx = x1 - x0, dy = y1 - y0;
  let t = 1;
  if (Math.abs(dx) > 1e-6) t = Math.min(t, (dx > 0 ? box.r : -box.l) / Math.abs(dx));
  if (Math.abs(dy) > 1e-6) t = Math.min(t, (dy > 0 ? box.b : -box.t) / Math.abs(dy));
  return Math.max(0, Math.min(0.45, t));
}

// Which side gets the second line of a double bond: +1, -1, or 0 (centred).
function doubleSide(M, k, P, ringOf, labelled) {
  const b = M.bonds[k];
  const ax = P[2 * b.a], ay = P[2 * b.a + 1], bx = P[2 * b.b], by = P[2 * b.b + 1];
  const cross = (x, y) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const rings = ringOf.get(k);
  if (rings && rings.length) {
    // the smallest aromatic ring, else the smallest ring
    const rs = rings.map(r => M.rings[r]).sort((p, q) => (q.arom - p.arom) || (p.atoms.length - q.atoms.length));
    const r = rs[0];
    let cx = 0, cy = 0; for (const a of r.atoms) { cx += P[2 * a]; cy += P[2 * a + 1]; }
    cx /= r.atoms.length; cy /= r.atoms.length;
    return Math.sign(cross(cx, cy)) || 1;
  }
  const others = [];
  for (const e of M.nb[b.a]) if (e.to !== b.b && e.to < M.n) others.push(e.to);
  for (const e of M.nb[b.b]) if (e.to !== b.a && e.to < M.n) others.push(e.to);
  const na = M.nb[b.a].filter(e => e.to !== b.b && e.to < M.n).length, nbb = M.nb[b.b].filter(e => e.to !== b.a && e.to < M.n).length;
  if (na === 0 || nbb === 0 || (labelled[b.a] && labelled[b.b])) return 0;
  let s = 0; for (const o of others) s += Math.sign(cross(P[2 * o], P[2 * o + 1]));
  if (s === 0) return 0;
  return Math.sign(s);
}

// Bonds in draw order: a breadth-first walk from atom 0 (for reveal).
export function drawOrder(M) {
  if (M._order) return M._order;
  const seen = new Uint8Array(M.n), used = new Uint8Array(M.nShown), out = [];
  for (let s = 0; s < M.n; s++) {
    if (seen[s]) continue;
    const q = [s]; seen[s] = 1;
    while (q.length) {
      const a = q.shift();
      for (const e of M.nb[a]) {
        if (e.b >= M.nShown || used[e.b]) continue;
        used[e.b] = 1; out.push({ b: e.b, from: a });
        if (!seen[e.to]) { seen[e.to] = 1; q.push(e.to); }
      }
    }
  }
  return (M._order = out);
}

export function render2D(M, opt = {}) {
  const lp = opt.lp || 0, hC = opt.hC || 0, hX = opt.hX || 0, cL = opt.cL || 0;
  const color = opt.color !== false, ink = opt.ink || '#16181d', lwF = opt.lw || 1;
  const lw = LW * lwF;
  const n = M.n, N = M.N;
  // positions (BL units -> drawing units) for shown atoms and hydrogens
  const hp = (hC > 0 || hX > 0 || opt.allH) ? placeHydrogens(M).xy : null;
  const P = new Float32Array(2 * N);
  for (let i = 0; i < n; i++) { P[2 * i] = M.xy[2 * i] * BL; P[2 * i + 1] = M.xy[2 * i + 1] * BL; }
  const parent = new Int32Array(N).fill(-1);
  for (let i = 0; i < n; i++) for (const h of M.hOf[i]) parent[h] = i;
  const hF = i => (M.z[parent[i]] === 6 ? hC : hX); // explicit-H factor for hydrogen i
  if (hp) for (let h = n; h < N; h++) {
    const p = parent[h], f = hF(h);
    P[2 * h] = P[2 * p] + (hp[2 * h] * BL - P[2 * p]) * f;
    P[2 * h + 1] = P[2 * p + 1] + (hp[2 * h + 1] * BL - P[2 * p + 1]) * f;
  }
  // reveal: how far each bond is drawn, and which atoms are reached
  let bondP = null, atomP = null;
  if (opt.reveal != null) {
    bondP = new Float32Array(M.bonds.length); atomP = new Float32Array(N);
    const ord = drawOrder(M);
    ord.forEach((o, k) => { bondP[o.b] = Math.max(0, Math.min(1, opt.reveal - k)); });
    if (!ord.length) atomP.fill(Math.min(1, opt.reveal + 1));
    ord.forEach((o, k) => {
      const b = M.bonds[o.b], p = bondP[o.b];
      if (k === 0) atomP[o.from] = Math.min(1, opt.reveal + 1);
      const far = o.from === b.a ? b.b : b.a;
      if (p >= 1) atomP[far] = 1;
      atomP[o.from] = Math.max(atomP[o.from], p > 0 ? 1 : 0);
    });
    for (let h = n; h < N; h++) { bondP[M.nShown + h - n] = atomP[parent[h]]; atomP[h] = atomP[parent[h]]; }
  }

  // labels and boxes
  const labelled = new Array(n).fill(false), lab = new Array(N).fill(null), labA = new Float32Array(N);
  for (let i = 0; i < n; i++) {
    const need = needsLabel(M, i) || isMetal(M.z[i]);
    const a = need ? 1 : (M.z[i] === 6 ? cL : 0);
    if (a <= 0.001) continue;
    labelled[i] = need;
    const L = labelOf(M, i, opt);
    // the H in the label fades as the explicit H appear
    L.hA = M.z[i] === 6 ? 1 - hC : 1 - hX;
    lab[i] = L; labA[i] = a;
  }
  for (let h = n; h < N; h++) if (hp && hF(h) > 0.001) { lab[h] = { sym: 'H', nH: 0, side: 'r', qs: '', w0: textW('H', FS), hA: 0 }; labA[h] = hF(h); }
  for (let i = n; i < n; i++) { /* shown H atoms (H2) are in the loop above */ }
  const box = new Array(N).fill(null);
  const PADL = 0.1 * BL;
  for (let i = 0; i < N; i++) {
    const L = lab[i]; if (!L) continue;
    const s = labA[i];
    const hw = L.w0 / 2 + PADL, hh = FS * 0.36 + PADL;
    let l = -hw, r = hw;
    if (L.nH && L.hA > 0.5) {
      const hwid = textW('H', FS) + (L.nH > 1 ? textW(String(L.nH), FS * 0.7) : 0);
      if (L.side === 'l') l -= hwid; else r += hwid;
    }
    if (L.qs) r += textW(L.qs, FS * 0.7) * 0.6;
    box[i] = { l: l * s, r: r * s, t: -hh * s, b: hh * s };
  }

  const parts = { grp: [], hl: [], bonds: [], labels: [], lp: [], hit: [] };
  const ringOf = ringBonds(M);
  // bonds
  const bondsN = M.bonds.length;
  for (let k = 0; k < bondsN; k++) {
    const b = M.bonds[k];
    const isH = k >= M.nShown;
    let alpha = 1;
    if (isH) { const h = b.b; alpha = hF(h); if (!hp || alpha <= 0.001) continue; }
    if (bondP && bondP[k] <= 0) continue;
    drawBond(k, b, alpha, isH);
  }
  function drawBond(k, b, alpha, isH) {
    let ax = P[2 * b.a], ay = P[2 * b.a + 1], bx = P[2 * b.b], by = P[2 * b.b + 1];
    const t0 = clipEnd(ax, ay, bx, by, box[b.a]);
    const t1 = clipEnd(bx, by, ax, ay, box[b.b]);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    let x0 = ax + dx * t0, y0 = ay + dy * t0, x1 = bx - dx * t1, y1 = by - dy * t1;
    const prog = bondP ? bondP[k] : 1;
    if (prog < 1) { x1 = x0 + (x1 - x0) * prog; y1 = y0 + (y1 - y0) * prog; }
    const op = alpha < 1 ? ` opacity="${n2(alpha)}"` : '';
    const L = (p, q, r, s, extra = '') => `<line x1="${n2(p)}" y1="${n2(q)}" x2="${n2(r)}" y2="${n2(s)}"${extra}/>`;
    let g = '';
    const metal = b.ml;
    if (b.s === 1 && !isH) {
      const w = WEDGE / 2;
      g = `<polygon points="${n2(x0)},${n2(y0)} ${n2(x1 + nx * w)},${n2(y1 + ny * w)} ${n2(x1 - nx * w)},${n2(y1 - ny * w)}" fill="currentColor" stroke="currentColor" stroke-width="${n2(lw * 0.5)}" stroke-linejoin="round"/>`;
    } else if (b.s === 2 && !isH) {
      const L2 = Math.hypot(x1 - x0, y1 - y0), cnt = Math.max(3, Math.round(L2 / (0.13 * BL)));
      for (let j = 0; j <= cnt; j++) {
        const t = j / cnt, w = (WEDGE / 2) * (0.15 + 0.85 * t), px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        g += L(px + nx * w, py + ny * w, px - nx * w, py - ny * w);
      }
    } else if (b.s === 3 && !isH) {
      const L2 = Math.hypot(x1 - x0, y1 - y0), waves = Math.max(3, Math.round(L2 / (0.2 * BL)));
      let d = `M${n2(x0)},${n2(y0)}`;
      for (let j = 0; j < waves; j++) {
        const t = (j + 0.5) / waves, t2 = (j + 1) / waves, s = j % 2 ? -1 : 1, w = 0.12 * BL;
        d += ` Q${n2(x0 + (x1 - x0) * t + nx * w * s)},${n2(y0 + (y1 - y0) * t + ny * w * s)} ${n2(x0 + (x1 - x0) * t2)},${n2(y0 + (y1 - y0) * t2)}`;
      }
      g = `<path d="${d}" fill="none"/>`;
    } else if (b.o === 2) {
      const side = doubleSide(M, k, P, ringOf, labelled);
      if (side === 0) {
        const o = SPACE / 2;
        g = L(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o) + L(x0 - nx * o, y0 - ny * o, x1 - nx * o, y1 - ny * o);
      } else {
        const o = SPACE * side, sh = 0.13 * BL;
        const s0 = box[b.a] ? 0 : sh, s1 = box[b.b] ? 0 : sh;
        const Lx = Math.hypot(x1 - x0, y1 - y0) || 1;
        const tx = (x1 - x0) / Lx, ty = (y1 - y0) / Lx;
        g = L(x0, y0, x1, y1);
        if (Lx > s0 + s1 + 1) g += L(x0 + tx * s0 + nx * o, y0 + ty * s0 + ny * o, x1 - tx * s1 + nx * o, y1 - ty * s1 + ny * o);
      }
    } else if (b.o === 3) {
      const o = SPACE;
      g = L(x0, y0, x1, y1) + L(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o) + L(x0 - nx * o, y0 - ny * o, x1 - nx * o, y1 - ny * o);
    } else {
      g = L(x0, y0, x1, y1, metal && !isH ? ` stroke-dasharray="${n2(0.12 * BL)} ${n2(0.08 * BL)}"` : '');
    }
    parts.bonds.push(`<g data-b="${k}"${op}>${g}</g>`);
    if (opt.hit && !isH) parts.hit.push(`<line class="hb" data-b="${k}" x1="${n2(ax)}" y1="${n2(ay)}" x2="${n2(bx)}" y2="${n2(by)}"/>`);
  }

  // hydrogen bonds (a base pair): dotted, clipped at the labels
  for (const [a, b] of M.hb || []) {
    if (atomP && (atomP[a] < 1 || atomP[b] < 1)) continue;
    const ax = P[2 * a], ay = P[2 * a + 1], bx = P[2 * b], by = P[2 * b + 1];
    const t0 = clipEnd(ax, ay, bx, by, box[a]), t1 = clipEnd(bx, by, ax, ay, box[b]);
    parts.bonds.push(`<line x1="${n2(ax + (bx - ax) * t0)}" y1="${n2(ay + (by - ay) * t0)}" x2="${n2(bx - (bx - ax) * t1)}" y2="${n2(by - (by - ay) * t1)}" stroke="#7a8194" stroke-dasharray="${n2(0.06 * BL)} ${n2(0.12 * BL)}"/>`);
  }
  // labels
  for (let i = 0; i < N; i++) {
    const Lb = lab[i]; if (!Lb) continue;
    if (atomP && atomP[i] <= 0) continue;
    const a = labA[i] * (atomP ? atomP[i] : 1);
    const x = P[2 * i], y = P[2 * i + 1];
    const fill = color && INK_COLORS[Lb.sym] ? INK_COLORS[Lb.sym] : 'currentColor';
    let t = `<text x="${n2(x)}" y="${n2(y)}" text-anchor="middle" dy="0.35em" fill="${fill}">${esc(Lb.sym)}</text>`;
    if (Lb.nH && Lb.hA > 0.001) {
      const hW = textW('H', FS), sub = Lb.nH > 1 ? String(Lb.nH) : '';
      const subW = sub ? textW(sub, FS * 0.7) : 0;
      const op = Lb.hA < 1 ? ` opacity="${n2(Lb.hA)}"` : '';
      if (Lb.side === 'l') {
        const xr = x - Lb.w0 / 2;
        t += `<text x="${n2(xr - subW)}" y="${n2(y)}" text-anchor="end" dy="0.35em" fill="${fill}"${op}>H</text>`;
        if (sub) t += `<text x="${n2(xr)}" y="${n2(y + FS * 0.28)}" text-anchor="end" dy="0.35em" font-size="${n2(FS * 0.7)}" fill="${fill}"${op}>${sub}</text>`;
      } else {
        const xl = x + Lb.w0 / 2;
        t += `<text x="${n2(xl)}" y="${n2(y)}" dy="0.35em" fill="${fill}"${op}>H</text>`;
        if (sub) t += `<text x="${n2(xl + hW)}" y="${n2(y + FS * 0.28)}" dy="0.35em" font-size="${n2(FS * 0.7)}" fill="${fill}"${op}>${sub}</text>`;
      }
    }
    if (Lb.qs) {
      const xr = x + Lb.w0 / 2 + (Lb.nH && Lb.side !== 'l' && Lb.hA > 0.5 ? textW('H', FS) + (Lb.nH > 1 ? textW(String(Lb.nH), FS * 0.7) : 0) : 0);
      t += `<text x="${n2(xr + 0.5)}" y="${n2(y - FS * 0.42)}" dy="0.35em" font-size="${n2(FS * 0.7)}" fill="${fill}">${Lb.qs}</text>`;
    }
    parts.labels.push(`<g data-a="${i}"${a < 1 ? ` opacity="${n2(a)}"` : ''}>${t}</g>`);
  }
  // lone pairs
  if (lp > 0.001) {
    for (let i = 0; i < n; i++) {
      const k = lonePairs(M, i); if (!k || !lab[i]) continue;
      const extra = [];
      if (hp) for (const h of M.hOf[i]) if (hF(h) > 0.5) extra.push(Math.atan2(P[2 * h + 1] - P[2 * i + 1], P[2 * h] - P[2 * i]));
      // the H in a label counts as a direction too
      if (lab[i].nH && lab[i].hA > 0.5) extra.push(lab[i].side === 'l' ? Math.PI : 0);
      const dirs = freeDirections(M, i, k, extra);
      const r = 0.42 * BL, d = 0.07 * BL, s = 0.09 * BL;
      for (const ang of dirs) {
        const cx = P[2 * i] + Math.cos(ang) * r, cy = P[2 * i + 1] + Math.sin(ang) * r, px = -Math.sin(ang) * s, py = Math.cos(ang) * s;
        parts.lp.push(`<circle cx="${n2(cx + px)}" cy="${n2(cy + py)}" r="${n2(d)}"/><circle cx="${n2(cx - px)}" cy="${n2(cy - py)}" r="${n2(d)}"/>`);
      }
    }
  }
  // halos: groups, hover, selection
  function halo(target, atoms, bonds, col, alpha, wide) {
    const w = (wide ? 0.62 : 0.5) * BL;
    for (const k of bonds || []) {
      const b = M.bonds[k]; if (!b) continue;
      target.push(`<line x1="${n2(P[2 * b.a])}" y1="${n2(P[2 * b.a + 1])}" x2="${n2(P[2 * b.b])}" y2="${n2(P[2 * b.b + 1])}" stroke="${col}" stroke-opacity="${alpha}" stroke-width="${n2(w)}" stroke-linecap="round"/>`);
    }
    for (const a of atoms || []) target.push(`<circle cx="${n2(P[2 * a])}" cy="${n2(P[2 * a + 1])}" r="${n2(w * 0.62)}" fill="${col}" fill-opacity="${alpha}"/>`);
  }
  for (const gr of opt.groups || []) {
    const set = new Set(gr.atoms), bs = [];
    for (let k = 0; k < M.nShown; k++) if (set.has(M.bonds[k].a) && set.has(M.bonds[k].b)) bs.push(k);
    halo(parts.grp, gr.atoms, bs, gr.color, gr.alpha ?? 0.34, true);
  }
  if (opt.sel) halo(parts.hl, opt.sel.atoms, opt.sel.bonds, '#3b82f6', 0.35);
  if (opt.hover) halo(parts.hl, opt.hover.atoms, opt.hover.bonds, '#f5b301', 0.45);
  if (opt.hit) for (let i = 0; i < N; i++) {
    if (i >= n && !(lab[i] && labA[i] > 0.5)) continue;
    parts.hit.push(`<circle class="ha" data-a="${i}" cx="${n2(P[2 * i])}" cy="${n2(P[2 * i + 1])}" r="${n2(0.36 * BL)}"/>`);
  }

  // bounds
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    if (i >= n && !lab[i]) continue;
    const bx = box[i] || { l: 0, r: 0, t: 0, b: 0 };
    x0 = Math.min(x0, P[2 * i] + bx.l); x1 = Math.max(x1, P[2 * i] + bx.r);
    y0 = Math.min(y0, P[2 * i + 1] + bx.t); y1 = Math.max(y1, P[2 * i + 1] + bx.b);
  }
  if (!isFinite(x0)) { x0 = y0 = -BL; x1 = y1 = BL; }
  const pad = (opt.pad ?? 0.7) * BL;
  const vb = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  // a small molecule keeps its size in a thumbnail: a minimum view box
  if (opt.minW && vb.w < opt.minW * BL) { vb.x -= (opt.minW * BL - vb.w) / 2; vb.w = opt.minW * BL; }
  if (opt.minH && vb.h < opt.minH * BL) { vb.y -= (opt.minH * BL - vb.h) / 2; vb.h = opt.minH * BL; }
  const font = `font-family="Arial,Helvetica,'Helvetica Neue',Inter,sans-serif" font-size="${FS}"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n2(vb.x)} ${n2(vb.y)} ${n2(vb.w)} ${n2(vb.h)}"${opt.width ? ` width="${opt.width}" height="${n2(opt.width * vb.h / vb.w)}"` : ''} style="color:${ink}">`
    + (opt.background ? `<rect x="${n2(vb.x)}" y="${n2(vb.y)}" width="${n2(vb.w)}" height="${n2(vb.h)}" fill="${opt.background}"/>` : '')
    + `<g class="grp">${parts.grp.join('')}</g><g class="hl">${parts.hl.join('')}</g>`
    + `<g class="bonds" stroke="currentColor" stroke-width="${n2(lw)}" stroke-linecap="round" fill="none">${parts.bonds.join('')}</g>`
    + `<g class="labels" ${font}>${parts.labels.join('')}</g>`
    + `<g class="lp" fill="currentColor"${lp < 1 ? ` opacity="${n2(lp)}"` : ''}>${parts.lp.join('')}</g>`
    + (opt.hit ? `<g class="hit" fill="transparent" stroke="transparent" stroke-width="${n2(0.34 * BL)}">${parts.hit.join('')}</g>` : '')
    + `</svg>`;
  return { svg, box: vb, P };
}

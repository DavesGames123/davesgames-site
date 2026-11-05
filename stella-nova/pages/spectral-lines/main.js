// ============================================================================
//  SPECTRAL LINES  ·  main.js  (ES module: the page)
// ----------------------------------------------------------------------------
//  The overview (#over), the spectrum band (#band), the energy-level
//  diagram (#levels), the panel and the phone dock. core.js has the pure
//  physics and layouts, draw.js the spectrum painters.
//
//  CACHED LAYERS. Each spectrum strip of the overview is an offscreen
//  canvas, built once per setting (ion, type, model, T, range, size). The
//  whole overview is one more offscreen layer; a frame blits it and draws
//  only the overlays (hover, selection pulse, search marks, flashes). The
//  band keeps one layer of glowing lines with bloom; it is drawn again only
//  on a zoom, a pan, a resize or a setting change. The diagram keeps its
//  levels and faint transitions in a layer; the photons are drawn per frame.
//
//  ANIMATION. The cells fly between the table and the stack (staggered by
//  Z, 900 ms). A new element fills its band in from the strongest line to
//  the weakest and its levels rise from the ground state. The diagram fires
//  random transitions weighted by brightness: an electron drops, a photon
//  in the line colour leaves, and the line flashes in the band, the cell
//  and the tube. In absorption the photon comes in and the electron rises.
//
//  GREP MAP   (jump with grep -n "<anchor>" main.js)
//      state ............... "const S ="
//      line weights ........ "function getW"
//      overview strips ..... "function getStrip"
//      overview draw ....... "function drawOverview"
//      overview input ...... "function overHit"
//      band layer .......... "function renderBand"
//      band input .......... "function bandPointer"
//      line card ........... "function showTip"
//      level diagram ....... "function renderLevels"
//      photons ............. "function fire"
//      panel ............... "function syncPanel"
//      phone sheet ......... "function setOpen"
//      url and api ......... "window.snSpectral"
//      frame loop .......... "function frame"
// ============================================================================
import * as C from './core.js';
import { drawEmission, drawAbsorption, bloom, slitMask, hatch, mkCanvas } from './draw.js';
import { ELEMENTS } from '../periodic-table/data/elements.js';

const SPECTRA = window.SPECTRA || { elements: [] };
const $ = id => document.getElementById(id);
const DPR = () => Math.min(2, window.devicePixelRatio || 1);
const now = () => performance.now();

// ─── data ──────────────────────────────────────────────────────────────────
const DATA = new Map(SPECTRA.elements.map(e => [e.z, e]));
const META = new Map(ELEMENTS.map(e => [e.z, e]));
const ZS = [...DATA.keys()].sort((a, b) => a - b);
const BY_KEY = new Map();
for (const e of ELEMENTS) { BY_KEY.set(e.sym.toLowerCase(), e.z); BY_KEY.set(e.name.toLowerCase(), e.z); BY_KEY.set(String(e.z), e.z); }
const zOf = key => BY_KEY.get(String(key || '').trim().toLowerCase()) || null;
const symOf = z => (META.get(z) || DATA.get(z) || { sym: '?' }).sym;
const nameOf = z => (META.get(z) || { name: symOf(z) }).name;
const specOf = (z, ion) => { const d = DATA.get(z); return d ? d[ion] || null : null; };
const ionsOf = ion => ion === 'both' ? ['I', 'II'] : [ion];
const ROMAN = { I: 'I', II: 'II' };

// ─── state ─────────────────────────────────────────────────────────────────
const S = {
  z: ZS[0] || 1, view: 'table', ion: 'I', mode: 'emission', model: 'nist', T: 6000,
  range: 'visible', compare: [], find: null, findRes: [], paused: false, lion: 'I',
  pick: null,            // { z, ion, i } the picked line
};
{
  const q = C.parseQuery(location.search);
  const z = zOf(q.el); if (z && DATA.has(z)) S.z = z;
  if (q.view) S.view = q.view;
}

// Line weights per spectrum, cached by model and T.
const WC = new Map();
function getW(z, ion) {
  const sp = specOf(z, ion); if (!sp) return null;
  const sig = S.model === 'boltz' ? 'b' + Math.round(S.T) : 'n';
  const k = z + ion, c = WC.get(k);
  if (c && c.sig === sig) return c;
  const w = C.weights(sp, S.model, S.T); w.sig = sig;
  WC.set(k, w); return w;
}
const sigBase = () => [S.ion, S.mode, S.model === 'boltz' ? Math.round(S.T) : 'n', ...overRange()].join('|');

// ─── canvases ──────────────────────────────────────────────────────────────
const over = $('over'), band = $('band'), levels = $('levels');
const og = over.getContext('2d'), bg = band.getContext('2d'), lg = levels.getContext('2d');
const size = { over: { w: 1, h: 1 }, band: { w: 1, h: 1 }, levels: { w: 1, h: 1 } };
function fitCanvas(c, key) {
  const d = DPR(), w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
  if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const s = size[key]; const changed = s.w !== w || s.h !== h; s.w = w; s.h = h; return changed;
}
function resizeAll() {
  if (window.snSaverActive) return;
  if (fitCanvas(over, 'over')) { OV.dirty = true; OV.strips.clear(); layoutOverview(); }
  if (fitCanvas(band, 'band')) BD.dirty = true;
  if (fitCanvas(levels, 'levels')) LV.dirty = true;
}
const ro = new ResizeObserver(() => resizeAll());
[over, band, levels].forEach(c => ro.observe(c));

// ═══ OVERVIEW ══════════════════════════════════════════════════════════════
const OV = {
  dirty: true, layer: null, table: new Map(), stack: new Map(), tbox: null, sbox: null, labelW: 30, axisH: 22,
  strips: new Map(), sig: '', morph: null, hover: null, cursor: null, flash: 0, legendStrip: null,
};
function overRange() {
  if (S.range === 'full') return C.RANGES.full;
  if (S.range === 'band') return [BD.lo, BD.hi];
  return C.RANGES.visible;
}
function layoutOverview() {
  const { w, h } = size.over, p = w < 500 ? 4 : 8;
  OV.tbox = { x: p, y: p, w: w - 2 * p, h: h - 2 * p };
  OV.labelW = w < 500 ? 24 : 32;
  OV.sbox = { x: p, y: p, w: w - 2 * p, h: h - 2 * p - OV.axisH };
  OV.table = C.tableRects(ELEMENTS, OV.tbox);
  OV.stack = C.stackRects(ZS, OV.sbox, OV.labelW);
  // The empty part of the table above the d block: the legend box.
  const cw = OV.tbox.w / 18, ch = OV.tbox.h / 9.65;
  OV.legend = { x: OV.tbox.x + 2.15 * cw, y: OV.tbox.y + 0.12 * ch, w: 9.7 * cw, h: 2.75 * ch };
}
const stripRectT = r => ({ x: r.x + 1, y: r.y + r.h * 0.42, w: r.w - 2, h: r.h * 0.58 - 1 });

// Build (or reuse) the strip of element z for the table or the stack size.
function getStrip(z, kind, wcss, hcss) {
  const sig = sigBase();
  if (sig !== OV.sig) { OV.sig = sig; OV.strips.clear(); OV.legendStrip = null; }
  const key = z + kind; let s = OV.strips.get(key);
  if (s) return s;
  const d = DPR(), W = Math.max(2, Math.round(wcss * d)), H = Math.max(1, Math.round(hcss * d));
  s = mkCanvas(W, H); paintStrip(s.getContext('2d'), z, 0, 0, W, H, d, kind === 'legend');
  OV.strips.set(key, s);
  return s;
}
// Draw the spectrum (or spectra, for I+II) of z into a box in device px.
function paintStrip(g, z, x, y, W, H, d, hq) {
  const [lo, hi] = overRange(), ions = ionsOf(S.ion), n = ions.length;
  g.fillStyle = '#000'; g.fillRect(x, y, W, H);
  ions.forEach((ion, j) => {
    const sp = specOf(z, ion), y0 = y + Math.round(j * H / n), h0 = Math.round((j + 1) * H / n) - Math.round(j * H / n);
    if (!sp) { g.fillStyle = 'rgba(80,90,120,0.10)'; g.fillRect(x, y0, W, h0); return; }
    const w = getW(z, ion);
    if (S.mode === 'absorption') drawAbsorption(g, sp, w.b, lo, hi, x, y0, W, h0, { dpr: d });
    else drawEmission(g, sp, w.b, lo, hi, x, y0, W, h0, { dpr: d, halo: hq ? 1 : 0.55, hq, core: 1 });
    if (n > 1 && j > 0) { g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(x, y0, W, Math.max(1, d * 0.6)); }
  });
}

// k of each element in a morph: 0 table, 1 stack. Staggered by Z.
function morphK(z, t) {
  const m = OV.morph, target = S.view === 'stack' ? 1 : 0;
  if (!m) return target;
  const delay = (z / 118) * 320, u = Math.min(1, Math.max(0, (t - m.t0 - delay) / 760));
  const e = C.easeInOut(u);
  return m.from + (target - m.from) * e;
}
const morphDone = t => !OV.morph || t - OV.morph.t0 > 760 + 330;

// Draw every cell for the current morph state into g (CSS px transform).
function drawOverview(g, t) {
  const { w, h } = size.over;
  g.fillStyle = '#030409'; g.fillRect(0, 0, w, h);
  const kAll = morphK(60, t);
  // faint grid glow behind the table
  if (kAll < 1) drawLegend(g, 1 - kAll);
  for (const e of ELEMENTS) {
    const z = e.z, k = morphK(z, t), rT = OV.table.get(z), rS = OV.stack.get(z);
    const has = DATA.has(z);
    if (!rS && k >= 0.999) continue;
    const sT = stripRectT(rT);
    const strip = rS ? C.lerpRect(sT, rS, k) : sT;
    const cell = rS ? C.lerpRect(rT, { x: rS.x - OV.labelW, y: rS.y, w: rS.w + OV.labelW, h: rS.h }, k) : rT;
    const alpha = rS ? 1 : 1 - k;
    g.globalAlpha = alpha;
    if (k < 1) {
      g.globalAlpha = alpha * (1 - k);
      g.fillStyle = has ? '#070a13' : '#05060b'; g.fillRect(cell.x, cell.y, cell.w, cell.h);
      if (cell.w > 12) { g.strokeStyle = has ? 'rgba(150,180,255,0.16)' : 'rgba(150,180,255,0.06)'; g.lineWidth = 1; g.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1); }
      g.globalAlpha = alpha;
    }
    if (has) {
      if (k < 0.999) { g.globalAlpha = alpha * (rS ? 1 - k : 1); g.drawImage(getStrip(z, 't', sT.w, sT.h), strip.x, strip.y, strip.w, strip.h); }
      if (rS && k > 0.001) { g.globalAlpha = alpha * k; g.drawImage(getStrip(z, 's', rS.w, rS.h), strip.x, strip.y, strip.w, strip.h); }
    }
    // label
    const fsT = Math.max(7, Math.min(15, rT.h * 0.32)), fsS = rS ? Math.max(6, Math.min(11, rS.h * 0.95)) : fsT;
    const stepS = rS ? Math.max(1, Math.ceil(8 / rS.h)) : 1;
    const showS = rS && (ZS.indexOf(z) % stepS === 0 || z === S.z);
    const fs = fsT + (fsS - fsT) * k;
    g.font = `600 ${fs.toFixed(1)}px ${getComputedFontSans()}`;
    const tw = g.measureText(e.sym).width;
    const lx = rS ? (rT.x + 3) + ((rS.x - 5 - tw) - (rT.x + 3)) * k : rT.x + 3;
    const ly = rS ? (rT.y + 2 + fsT * 0.55) + ((rS.y + rS.h / 2) - (rT.y + 2 + fsT * 0.55)) * k : rT.y + 2 + fsT * 0.55;
    g.globalAlpha = alpha * (showS ? 1 : 1 - k) * (has ? 1 : 0.35);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = z === S.z ? '#ffffff' : '#cfd7ea';
    if (g.globalAlpha > 0.01) g.fillText(e.sym, lx, ly);
    if (k < 0.5 && rT.w > 46) {
      g.globalAlpha = alpha * (1 - 2 * k) * 0.6; g.font = `${Math.min(10, fsT * 0.62).toFixed(1)}px ${getComputedFontSans()}`;
      g.textAlign = 'right'; g.fillStyle = '#8a93ab'; g.fillText(String(z), rT.x + rT.w - 3, ly);
    }
  }
  g.globalAlpha = 1; g.textAlign = 'left';
  if (kAll > 0) drawStackAxis(g, kAll);
}
let fontSans = null;
function getComputedFontSans() {
  if (!fontSans) fontSans = (getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif');
  return fontSans;
}

// The legend in the empty top of the table: the element under the pointer
// (or the picked one), its spectrum large, and the wavelength scale.
function drawLegend(g, a) {
  const L = OV.legend; if (!L || L.w < 60) return;
  const z = OV.hover || S.z, [lo, hi] = overRange();
  g.globalAlpha = a;
  const fs = Math.max(9, Math.min(22, L.h * 0.22));
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = `${fs.toFixed(1)}px ${getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'serif'}`;
  g.fillStyle = '#eef2fb';
  g.fillText(`${symOf(z)}  ${nameOf(z)}`, L.x + 4, L.y + fs * 0.95);
  g.font = `${Math.max(8, fs * 0.5).toFixed(1)}px ${getComputedFontSans()}`; g.fillStyle = '#8a93ab';
  const sp = specOf(z, S.ion === 'II' ? 'II' : 'I');
  const sub = sp ? `Z ${z} · ${sp.lines.length} lines shown of ${sp.total} · ${S.ion === 'both' ? 'I (top) and II (base)' : (S.ion === 'II' ? 'singly ionized' : 'neutral')}` : `Z ${z} · no lines in the data`;
  g.fillText(sub, L.x + 4, L.y + fs * 1.75);
  const sy = L.y + fs * 2.2, sh = Math.max(8, L.h - fs * 2.2 - 16), sw = L.w - 8;
  if (DATA.has(z)) {
    let s = OV.legendStrip;
    if (!s || s.z !== z || s.sig !== OV.sig || s.w !== sw) {
      s = { z, sig: OV.sig, w: sw, c: getStripFresh(z, sw, sh) }; OV.legendStrip = s;
    }
    g.drawImage(s.c, L.x + 4, sy, sw, sh);
  }
  // the scale
  const ty = sy + sh + 3, tk = C.niceTicks(lo, hi, Math.max(3, Math.round(sw / 70)));
  g.fillStyle = '#8a93ab'; g.font = `9px ${getComputedFontSans()}`; g.textBaseline = 'top';
  for (const v of tk.major) { const x = L.x + 4 + (v - lo) / (hi - lo) * sw; g.fillRect(x, ty, 1, 3); g.textAlign = 'center'; g.fillText(String(v), x, ty + 3); }
  g.textAlign = 'right'; g.fillText('nm', L.x + 4 + sw, ty + 3);
  g.globalAlpha = 1; g.textAlign = 'left';
}
function getStripFresh(z, wcss, hcss) {
  const d = DPR(), c = mkCanvas(wcss * d, hcss * d);
  paintStrip(c.getContext('2d'), z, 0, 0, c.width, c.height, d, true);
  return c;
}
function drawStackAxis(g, a) {
  const b = OV.sbox, x0 = b.x + OV.labelW, w = b.w - OV.labelW, y = b.y + b.h + 2, [lo, hi] = overRange();
  g.globalAlpha = a;
  g.fillStyle = 'rgba(150,180,255,0.25)'; g.fillRect(x0, y, w, 1);
  const tk = C.niceTicks(lo, hi, Math.max(3, Math.round(w / 80)));
  g.fillStyle = 'rgba(150,180,255,0.18)';
  for (const v of tk.minor) g.fillRect(x0 + (v - lo) / (hi - lo) * w, y, 1, 3);
  g.fillStyle = '#8a93ab'; g.font = `10px ${getComputedFontSans()}`; g.textBaseline = 'top'; g.textAlign = 'center';
  for (const v of tk.major) { const x = x0 + (v - lo) / (hi - lo) * w; g.fillRect(x, y, 1, 5); g.fillText(String(v), x, y + 6); }
  g.textAlign = 'left'; g.fillText('nm · tap to find', b.x, y + 6);
  g.globalAlpha = 1;
}

// One frame of the overview: the cached layer (or a live morph), then overlays.
function frameOverview(t) {
  const d = DPR(), { w, h } = size.over;
  const morphing = OV.morph && !morphDone(t);
  if (OV.morph && !morphing) { OV.morph = null; OV.dirty = true; }
  if (sigBase() !== OV.sig) OV.dirty = true;
  if (morphing) {
    og.setTransform(d, 0, 0, d, 0, 0); drawOverview(og, t);
  } else {
    if (OV.dirty || !OV.layer || OV.layer.width !== over.width || OV.layer.height !== over.height) {
      if (!OV.layer || OV.layer.width !== over.width || OV.layer.height !== over.height) OV.layer = mkCanvas(over.width, over.height);
      const lg2 = OV.layer.getContext('2d'); lg2.setTransform(d, 0, 0, d, 0, 0); drawOverview(lg2, t); OV.dirty = false;
    }
    og.setTransform(1, 0, 0, 1, 0, 0); og.drawImage(OV.layer, 0, 0);
    og.setTransform(d, 0, 0, d, 0, 0);
  }
  if (morphing) return;
  const stack = S.view === 'stack', [lo, hi] = overRange();
  const rectOf = z => stack ? OV.stack.get(z) : OV.table.get(z);
  const stripOf = z => { const r = rectOf(z); return r && (stack ? r : stripRectT(r)); };
  // search marks
  if (S.find != null && S.find >= lo && S.find <= hi) {
    const fx = r => r.x + (S.find - lo) / (hi - lo) * r.w;
    og.fillStyle = 'rgba(255,210,122,0.85)';
    if (stack) { const b = OV.sbox, r = OV.stack.get(ZS[0]); if (r) { const x = fx(r); og.fillRect(x - 0.5, b.y, 1, b.h); } }
    for (const m of S.findRes) {
      const r = rectOf(m.z); if (!r) continue;
      og.strokeStyle = `rgba(255,210,122,${0.35 + 0.6 * m.s})`; og.lineWidth = 1.2;
      if (stack) og.strokeRect(r.x - OV.labelW + 1, r.y - 0.5, OV.labelW - 3, r.h + 1);
      else { og.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1); const s = stripRectT(r); og.fillRect(fx(s) - 0.5, s.y, 1, s.h); }
    }
  }
  // compare dots
  S.compare.forEach((z, i) => {
    const r = rectOf(z); if (!r) return;
    og.fillStyle = CMP_COL[i];
    if (stack) og.fillRect(r.x - OV.labelW, r.y, 2, r.h); else { og.beginPath(); og.arc(r.x + r.w - 5, r.y + r.h * 0.2, 2.5, 0, 7); og.fill(); }
  });
  // selection pulse and photon flash
  const r = rectOf(S.z);
  if (r) {
    const pulse = 0.55 + 0.45 * Math.sin(t / 420);
    og.save();
    og.strokeStyle = cssLamp(0.55 + 0.4 * pulse); og.lineWidth = 1.5; og.shadowColor = cssLamp(1); og.shadowBlur = 8 + 6 * pulse;
    if (stack) og.strokeRect(r.x - OV.labelW + 0.5, r.y - 1, r.w + OV.labelW - 1, r.h + 2); else og.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    og.restore();
    if (OV.flash > 0.01) {
      const s = stripOf(S.z), st = OV.strips.get(S.z + (stack ? 's' : 't'));
      if (st) { og.save(); og.globalCompositeOperation = 'lighter'; og.globalAlpha = OV.flash * 0.8; og.drawImage(st, s.x, s.y, s.w, s.h); og.restore(); }
    }
  }
  // hover
  if (OV.hover && OV.hover !== S.z) {
    const q = rectOf(OV.hover);
    if (q) { og.strokeStyle = 'rgba(220,235,255,0.55)'; og.lineWidth = 1; if (stack) og.strokeRect(q.x - OV.labelW + 0.5, q.y - 0.5, q.w + OV.labelW - 1, q.h + 1); else og.strokeRect(q.x - 0.5, q.y - 0.5, q.w + 1, q.h + 1); }
  }
  // the wavelength cursor in the stack
  if (stack && OV.cursor != null) {
    const b = OV.sbox, x0 = b.x + OV.labelW, x = x0 + (OV.cursor - lo) / (hi - lo) * (b.w - OV.labelW);
    og.fillStyle = 'rgba(200,225,255,0.35)'; og.fillRect(x - 0.5, b.y, 1, b.h);
    og.fillStyle = '#dfe8fa'; og.font = `10px ${getComputedFontSans()}`; og.textBaseline = 'bottom'; og.textAlign = x > w - 80 ? 'right' : 'left';
    og.fillText(OV.cursor.toFixed(1) + ' nm', x + (x > w - 80 ? -4 : 4), b.y + b.h - 2); og.textAlign = 'left';
  }
}

// Hit test in CSS px: { z } over a cell or row, { axis: nm } on the stack axis.
function overHit(x, y) {
  if (S.view === 'stack') {
    const b = OV.sbox, [lo, hi] = overRange(), x0 = b.x + OV.labelW, w = b.w - OV.labelW;
    const nm = lo + (x - x0) / w * (hi - lo);
    if (y > b.y + b.h && y < b.y + b.h + OV.axisH + 6 && x >= x0) return { axis: nm };
    if (y < b.y || y > b.y + b.h || !ZS.length) return null;
    const i = Math.min(ZS.length - 1, Math.max(0, Math.floor((y - b.y) / (b.h / ZS.length))));
    return { z: ZS[i], nm: x >= x0 ? nm : null };
  }
  for (const [z, r] of OV.table) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { z };
  return null;
}
function overPos(e) { const q = over.getBoundingClientRect(); return [e.clientX - q.left, e.clientY - q.top]; }
over.addEventListener('pointermove', e => {
  if (window.snSaverActive) return;
  const [x, y] = overPos(e), hit = overHit(x, y);
  const z = hit && hit.z || null;
  OV.cursor = hit && (hit.nm ?? hit.axis) != null ? (hit.nm ?? hit.axis) : null;
  if (z !== OV.hover) { OV.hover = z; if (S.view === 'table') OV.dirty = true; }
  $('overRead').textContent = z ? `${symOf(z)} · ${nameOf(z)} · Z ${z}${DATA.has(z) ? '' : ' · no data'}` : (hit && hit.axis ? hit.axis.toFixed(1) + ' nm' : '');
});
over.addEventListener('pointerleave', () => { if (OV.hover) { OV.hover = null; OV.dirty = true; } OV.cursor = null; });
over.addEventListener('click', e => {
  const [x, y] = overPos(e), hit = overHit(x, y);
  if (!hit) return;
  if (hit.axis != null) { doFind(hit.axis); return; }
  if (!DATA.has(hit.z)) return;
  if (e.shiftKey || e.metaKey || e.ctrlKey) toggleCompare(hit.z);
  else setElement(hit.z);
});

function setView(v) {
  if (v !== 'table' && v !== 'stack') return;
  if (v === S.view) return;
  const t = now(), from = morphK(60, t);
  S.view = v; OV.morph = { t0: t, from };
  // build the strips of both layouts before the morph starts
  for (const z of ZS) { const rT = OV.table.get(z), rS = OV.stack.get(z), sT = stripRectT(rT); getStrip(z, 't', sT.w, sT.h); if (rS) getStrip(z, 's', rS.w, rS.h); }
  syncSegs(); writeURL();
}

// ═══ BAND ══════════════════════════════════════════════════════════════════
const BD = { lo: 370, hi: 760, layer: null, dirty: true, rows: [], intro: 0, flash: [], hover: null, geom: null, ptr: new Map(), drag: null };
const BAND_PAD = { l: 58, r: 10, t: 8, axis: 30 };
function bandRows() {
  const els = S.compare.length >= 2 ? S.compare : [S.z], rows = [];
  for (const z of els) for (const ion of ionsOf(S.ion)) rows.push({ z, ion, sp: specOf(z, ion) });
  return rows;
}
function bandGeom() {
  const { w, h } = size.band, n = Math.max(1, BD.rows.length);
  const x0 = w < 500 ? 44 : BAND_PAD.l, x1 = w - BAND_PAD.r, y0 = BAND_PAD.t, y1 = h - BAND_PAD.axis, gap = n > 1 ? 4 : 0;
  const rh = (y1 - y0 - gap * (n - 1)) / n;
  return { x0, x1, y0, y1, rh, gap, row: i => y0 + i * (rh + gap) };
}
const nmAt = (x, G) => BD.lo + (x - G.x0) / (G.x1 - G.x0) * (BD.hi - BD.lo);
const xAt = (nm, G) => G.x0 + (nm - BD.lo) / (BD.hi - BD.lo) * (G.x1 - G.x0);

function renderBand(t) {
  const d = DPR();
  if (!BD.layer || BD.layer.width !== band.width || BD.layer.height !== band.height) BD.layer = mkCanvas(band.width, band.height);
  const L = BD.layer, g = L.getContext('2d'), G = BD.geom = bandGeom();
  const reveal = BD.intro ? Math.min(1, (t - BD.intro) / 900) : 1;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, L.width, L.height);
  const X0 = G.x0 * d, W = (G.x1 - G.x0) * d;
  const em = S.mode === 'emission';
  BD.rows.forEach((r, i) => {
    const Y = G.row(i) * d, H = G.rh * d;
    if (!r.sp) return;
    const w = getW(r.z, r.ion);
    if (em) {
      drawEmission(g, r.sp, w.b, BD.lo, BD.hi, X0, Y, W, H, { dpr: d, hq: true, reveal: 1 - Math.pow(1 - reveal, 2) });
      slitMask(g, X0, Y, W, H, 0.28);
    } else drawAbsorption(g, r.sp, w.b, BD.lo, BD.hi, X0, Y, W, H, { dpr: d, reveal: 1 - Math.pow(1 - reveal, 2) });
  });
  if (em) bloom(g, L, 0.9);
  g.setTransform(d, 0, 0, d, 0, 0);
  // UV and IR shading
  const uvX = xAt(C.VIS[0], G), irX = xAt(C.VIS[1], G);
  const fs = getComputedFontSans();
  BD.rows.forEach((r, i) => {
    const y = G.row(i);
    if (em) {
      if (uvX > G.x0) hatch(g, G.x0, y, Math.min(uvX, G.x1) - G.x0, G.rh, 'rgba(140,110,255,0.07)', 8);
      if (irX < G.x1) hatch(g, Math.max(irX, G.x0), y, G.x1 - Math.max(irX, G.x0), G.rh, 'rgba(255,90,90,0.06)', 8);
    }
    // row label
    g.fillStyle = '#05070d'; g.fillRect(0, y, G.x0 - 4, G.rh);
    g.fillStyle = CMP_COL[S.compare.indexOf(r.z)] || '#f2f4fa';
    g.textBaseline = 'middle'; g.textAlign = 'right';
    g.font = `${Math.min(18, Math.max(10, G.rh * 0.36)).toFixed(0)}px ${getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'serif'}`;
    g.fillText(symOf(r.z) + ' ' + ROMAN[r.ion], G.x0 - 8, y + G.rh / 2 - (G.rh > 34 ? 6 : 0));
    if (G.rh > 34) { g.font = `10px ${fs}`; g.fillStyle = '#8a93ab'; g.fillText(r.sp ? r.sp.lines.length + ' lines' : 'no data', G.x0 - 8, y + G.rh / 2 + 10); }
    if (!r.sp) { g.textAlign = 'center'; g.fillStyle = '#8a93ab'; g.font = `12px ${fs}`; g.fillText(`No ${ROMAN[r.ion]} lines in the data for ${nameOf(r.z)}`, (G.x0 + G.x1) / 2, y + G.rh / 2); }
    // labels of the strongest lines in view
    if (r.sp && reveal > 0.8 && G.rh > 26) labelLines(g, r, y, G);
  });
  // region tags
  g.textBaseline = 'top'; g.font = `600 10px ${fs}`;
  if (uvX > G.x0 + 20) { g.textAlign = 'left'; g.fillStyle = 'rgba(170,150,255,0.8)'; g.fillText('UV', G.x0 + 4, G.y1 + 16); }
  if (irX < G.x1 - 20) { g.textAlign = 'right'; g.fillStyle = 'rgba(255,120,120,0.8)'; g.fillText('IR', G.x1 - 4, G.y1 + 16); }
  // the axis
  const tk = C.niceTicks(BD.lo, BD.hi, Math.max(3, Math.round((G.x1 - G.x0) / 90)));
  g.fillStyle = 'rgba(150,180,255,0.3)'; g.fillRect(G.x0, G.y1 + 1, G.x1 - G.x0, 1);
  g.fillStyle = 'rgba(150,180,255,0.22)';
  for (const v of tk.minor) g.fillRect(xAt(v, G), G.y1 + 1, 1, 3);
  // a thin colour bar of the visible light on the axis
  for (let x = Math.max(G.x0, uvX); x < Math.min(G.x1, irX); x += 2) { const c = C.lutRGB(nmAt(x, G)); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(x, G.y1 + 2, 2, 2); }
  g.textAlign = 'center'; g.font = `10px ${fs}`; g.fillStyle = '#9aa4bd';
  const dec = tk.step < 1 ? Math.min(3, Math.ceil(-Math.log10(tk.step))) : 0;
  for (const v of tk.major) { const x = xAt(v, G); g.fillRect(x, G.y1 + 1, 1, 6); g.fillText(v.toFixed(dec), x, G.y1 + 8); }
  g.textAlign = 'left'; g.fillStyle = '#6f7891'; g.fillText('nm (air) · tap the axis to find', 6, G.y1 + 8);
  BD.dirty = reveal < 1;
}

// Labels for the strongest lines in view of one row, without overlap.
function labelLines(g, r, y, G) {
  const w = getW(r.z, r.ion), L = r.sp.lines, i0 = C.lowerBound(L, BD.lo), list = [];
  for (let i = i0; i < L.length && L[i][0] <= BD.hi; i++) list.push(i);
  list.sort((a, b) => w.b[b] - w.b[a]);
  const taken = [], maxN = Math.max(2, Math.round((G.x1 - G.x0) / 70));
  g.font = `10px ${getComputedFontSans()}`; g.textBaseline = 'top'; g.textAlign = 'center';
  const span = BD.hi - BD.lo, dec = span < 3 ? 3 : span < 30 ? 2 : 1;
  for (const i of list) {
    if (taken.length >= maxN || w.b[i] < 0.35) break;
    const x = xAt(L[i][0], G);
    if (taken.some(t => Math.abs(t - x) < 46)) continue;
    taken.push(x);
    const c = C.lutRGB(L[i][0]), txt = L[i][0].toFixed(dec);
    const tw = g.measureText(txt).width;
    g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(x - tw / 2 - 3, y + 2, tw + 6, 13);
    g.fillStyle = S.mode === 'emission' ? `rgb(${Math.min(255, c[0] + 60)},${Math.min(255, c[1] + 60)},${Math.min(255, c[2] + 60)})` : '#f4f6fb';
    g.fillText(txt, x, y + 3);
  }
}

function frameBand(t) {
  const d = DPR();
  if (BD.dirty || !BD.layer) renderBand(t);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.fillStyle = '#000'; bg.fillRect(0, 0, band.width, band.height);
  bg.drawImage(BD.layer, 0, 0);
  bg.setTransform(d, 0, 0, d, 0, 0);
  const G = BD.geom; if (!G) return;
  // photon flashes: a bright core and halo over the line
  BD.flash = BD.flash.filter(f => f.a > 0.02);
  for (const f of BD.flash) {
    const ri = BD.rows.findIndex(r => r.z === f.z && r.ion === f.ion); if (ri < 0) continue;
    const r = BD.rows[ri], wl = r.sp.lines[f.i][0]; if (wl < BD.lo || wl > BD.hi) continue;
    const x = xAt(wl, G), y = G.row(ri), c = C.lutRGB(wl);
    bg.save(); bg.globalCompositeOperation = S.mode === 'emission' ? 'lighter' : 'source-over';
    const gr = bg.createLinearGradient(x - 16, 0, x + 16, 0);
    const col = S.mode === 'emission' ? c : [255, 255, 255];
    gr.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`); gr.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},${0.55 * f.a})`); gr.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    bg.fillStyle = gr; bg.fillRect(x - 16, y, 32, G.rh);
    bg.fillStyle = `rgba(255,255,255,${0.7 * f.a})`; bg.fillRect(x - 0.75, y, 1.5, G.rh);
    bg.restore();
    f.a *= 0.94;
  }
  // the picked line: brackets above and below
  if (S.pick) {
    const ri = BD.rows.findIndex(r => r.z === S.pick.z && r.ion === S.pick.ion);
    if (ri >= 0) {
      const wl = BD.rows[ri].sp.lines[S.pick.i][0], x = xAt(wl, G), y = G.row(ri);
      bg.fillStyle = '#ffffff';
      bg.beginPath(); bg.moveTo(x - 5, y); bg.lineTo(x + 5, y); bg.lineTo(x, y + 6); bg.fill();
      bg.beginPath(); bg.moveTo(x - 5, y + G.rh); bg.lineTo(x + 5, y + G.rh); bg.lineTo(x, y + G.rh - 6); bg.fill();
    }
  }
  // hover line
  if (BD.hover && (!S.pick || BD.hover.i !== S.pick.i || BD.hover.ion !== S.pick.ion)) {
    const ri = BD.rows.findIndex(r => r.z === BD.hover.z && r.ion === BD.hover.ion);
    if (ri >= 0) { const x = xAt(BD.rows[ri].sp.lines[BD.hover.i][0], G); bg.fillStyle = 'rgba(255,255,255,0.5)'; bg.fillRect(x - 0.5, G.row(ri) - 3, 1, 3); bg.fillRect(x - 0.5, G.row(ri) + G.rh, 1, 3); }
  }
  // the search mark
  if (S.find != null && S.find >= BD.lo && S.find <= BD.hi) {
    const x = xAt(S.find, G);
    bg.fillStyle = 'rgba(255,210,122,0.16)'; bg.fillRect(xAt(S.find - 0.5, G), G.y0, Math.max(1, xAt(S.find + 0.5, G) - xAt(S.find - 0.5, G)), G.y1 - G.y0);
    bg.fillStyle = 'rgba(255,210,122,0.9)';
    for (let y = G.y0; y < G.y1; y += 8) bg.fillRect(x - 0.5, y, 1, 4);
    bg.font = `10px ${getComputedFontSans()}`; bg.textBaseline = 'bottom'; bg.textAlign = 'center'; bg.fillText(S.find.toFixed(2), x, G.y1 + 30);
    bg.textAlign = 'left';
  }
}

// Zoom and pan. The window stays in 195..1105 nm and at least 0.6 nm wide.
function setWindow(lo, hi) {
  const span = Math.max(0.6, Math.min(910, hi - lo));
  let a = (lo + hi) / 2 - span / 2;
  a = Math.max(195, Math.min(1105 - span, a));
  BD.lo = a; BD.hi = a + span; BD.dirty = true;
  if (S.range === 'band') { clearTimeout(setWindow.t); setWindow.t = setTimeout(() => { OV.dirty = true; }, 160); }
  $('bandReset').textContent = span > 800 ? 'Visible' : 'Full range';
  updateBandRead();
}
function updateBandRead() {
  $('bandRead').textContent = `${BD.lo.toFixed(BD.hi - BD.lo < 10 ? 2 : 0)}–${BD.hi.toFixed(BD.hi - BD.lo < 10 ? 2 : 0)} nm`;
}
function bandPos(e) { const q = band.getBoundingClientRect(); return [e.clientX - q.left, e.clientY - q.top]; }
band.addEventListener('wheel', e => {
  e.preventDefault();
  if (window.snSaverActive) return;
  const G = BD.geom || bandGeom(), [x] = bandPos(e), nm = nmAt(x, G);
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
    const dn = e.deltaX / (G.x1 - G.x0) * (BD.hi - BD.lo); setWindow(BD.lo + dn, BD.hi + dn); return;
  }
  const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
  setWindow(nm - (nm - BD.lo) * f, nm + (BD.hi - nm) * f);
}, { passive: false });
function bandPointer(e, type) {
  if (window.snSaverActive) return;
  const [x, y] = bandPos(e), G = BD.geom || bandGeom();
  if (type === 'down') {
    BD.ptr.set(e.pointerId, { x, y, x0: x, y0: y });
    try { band.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
    if (BD.ptr.size === 1) BD.drag = { lo: BD.lo, hi: BD.hi, moved: false, x, touch: e.pointerType !== 'mouse' };
    else if (BD.ptr.size === 2) { const [a, b] = [...BD.ptr.values()]; BD.drag = { pinch: true, d0: Math.abs(a.x - b.x) || 1, mid: nmAt((a.x + b.x) / 2, G), lo: BD.lo, hi: BD.hi, moved: true }; }
    return;
  }
  const p = BD.ptr.get(e.pointerId);
  if (type === 'move') {
    if (!p) { if (e.pointerType === 'mouse') hoverBand(x, y, G); return; }
    p.x = x; p.y = y;
    const D = BD.drag; if (!D) return;
    if (D.pinch && BD.ptr.size >= 2) {
      const [a, b] = [...BD.ptr.values()], dd = Math.abs(a.x - b.x) || 1, f = D.d0 / dd;
      const span = (D.hi - D.lo) * f, frac = ((a.x + b.x) / 2 - G.x0) / (G.x1 - G.x0);
      setWindow(D.mid - frac * span, D.mid - frac * span + span);
    } else if (!D.pinch) {
      if (Math.abs(x - D.x) > 5) D.moved = true;
      if (D.moved) { const dn = (x - D.x) / (G.x1 - G.x0) * (D.hi - D.lo); setWindow(D.lo - dn, D.hi - dn); hideTip(); }
    }
    return;
  }
  // up or cancel
  BD.ptr.delete(e.pointerId);
  const D = BD.drag;
  if (BD.ptr.size === 0) BD.drag = null;
  else if (D && D.pinch) BD.drag = { lo: BD.lo, hi: BD.hi, moved: true, x: [...BD.ptr.values()][0].x };
  if (type === 'up' && D && !D.moved && !D.pinch) tapBand(x, y, G, D.touch);
}
['down', 'move', 'up', 'cancel'].forEach(k => band.addEventListener('pointer' + k, e => bandPointer(e, k)));
band.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !BD.ptr.size) { BD.hover = null; if (!S.pick || !tipPinned) hideTip(); } });
band.addEventListener('dblclick', () => setWindow(370, 760));

function lineAt(x, y, G) {
  if (x < G.x0 || x > G.x1 || y < G.y0 || y > G.y1) return null;
  const ri = Math.min(BD.rows.length - 1, Math.max(0, Math.floor((y - G.y0) / (G.rh + G.gap))));
  const r = BD.rows[ri]; if (!r || !r.sp) return null;
  const w = getW(r.z, r.ion), i = C.nearestLine(r.sp.lines, w.b, nmAt(x, G), (G.x1 - G.x0) / (BD.hi - BD.lo), 9);
  return i >= 0 ? { z: r.z, ion: r.ion, i, ri } : null;
}
function hoverBand(x, y, G) {
  const h = lineAt(x, y, G);
  BD.hover = h;
  if (h) showTip(h, G); else if (!tipPinned) hideTip();
  band.style.cursor = y > G.y1 ? 'pointer' : h ? 'pointer' : 'crosshair';
}
function tapBand(x, y, G, touch) {
  if (y > G.y1 && x >= G.x0) { doFind(nmAt(x, G)); return; }
  const h = lineAt(x, y, G);
  if (!h) { S.pick = null; tipPinned = false; hideTip(); return; }
  S.pick = { z: h.z, ion: h.ion, i: h.i };
  tipPinned = touch;
  showTip(h, G);
  if (h.z !== S.z) setElement(h.z, { keepPick: true });
  if (h.ion !== diagIon()) { S.lion = h.ion; LV.dirty = true; syncSegs(); }
  fire(h.i, true);
}

// ─── the line card ─────────────────────────────────────────────────────────
let tipPinned = false;
const tip = $('tip'), tipIn = $('tipIn');
function showTip(h, G) {
  const sp = specOf(h.z, h.ion), l = sp.lines[h.i], w = getW(h.z, h.ion);
  const uncl = C.unclassified(l), lo = sp.levels[l[4]] || [0, '?'], up = sp.levels[l[5]] || [0, '?'];
  const c = C.lutRGB(l[0]), region = C.bandOf(l[0]);
  const ev = C.HC / l[0];
  tipIn.innerHTML =
    `<div><span class="sw" style="background:rgb(${c})"></span><span class="wl">${l[0].toFixed(3)} nm</span> <span class="k">${symOf(h.z)} ${ROMAN[h.ion]}${region !== 'vis' ? ' · ' + region : ''}${l[6] ? ' · forbidden' : ''}</span></div>` +
    `<div><span class="k">strength</span> ${(w.b[h.i]).toFixed(2)} · <span class="k">photon</span> ${ev.toFixed(3)} eV</div>` +
    `<div><span class="k">A<sub>ki</sub></span> ${C.fmtA(l[2])} · <span class="k">g<sub>k</sub></span> ${l[3]}</div>` +
    (uncl ? '<div class="tr">unclassified (no level data)</div>'
      : `<div class="tr">${esc(lo[1])} (${lo[0].toFixed(3)} eV)<br>→ ${esc(up[1])} (${up[0].toFixed(3)} eV)</div>`);
  tip.hidden = false;
  const x = xAt(l[0], G), y = G.row(h.ri), bw = band.clientWidth;
  const canvasTop = band.getBoundingClientRect().top - $('bandWrap').getBoundingClientRect().top;
  const half = 125, left = Math.max(half + 4, Math.min(bw - half - 4, x));
  const above = band.getBoundingClientRect().top + y > 150;
  tip.style.left = left + 'px';
  tip.style.top = (canvasTop + (above ? y - 4 : y + G.rh + 8)) + 'px';
  tip.style.transform = above ? 'translate(-50%,-100%)' : 'translate(-50%,0)';
}
function hideTip() { tip.hidden = true; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ═══ LEVEL DIAGRAM ═════════════════════════════════════════════════════════
const LV = { dirty: true, layer: null, geo: null, ev: [], nextAt: 0, intro: 0, key: '' };
function diagIon() {
  const want = S.lion;
  if (specOf(S.z, want)) return want;
  return specOf(S.z, 'I') ? 'I' : specOf(S.z, 'II') ? 'II' : want;
}
function levelGeom() {
  const ion = diagIon(), sp = specOf(S.z, ion); if (!sp) return null;
  const m = META.get(S.z), lim = m && m.ie ? m.ie[ion === 'I' ? 0 : 1] : null;
  const gr = C.grotrian(sp, lim);
  const { w, h } = size.levels, left = 36, right = w - 10, top = 24, bot = h - 12;
  const n = Math.max(1, gr.cols.length), cw = (right - left) / n;
  const yE = E => bot - (E / gr.Emax) * (bot - top);
  const barOf = idx => {
    const v = gr.lvl.get(idx); if (!v) return null;
    if (gr.single) return { x0: left + 4, x1: right - 4, y: yE(v.E) };
    return { x0: left + v.col * cw + cw * 0.14, x1: left + v.col * cw + cw * 0.86, y: yE(v.E) };
  };
  const ends = l => {
    const a = barOf(l[4]), b = barOf(l[5]); if (!a || !b) return null;
    if (gr.single) { const ln = gr.lanes.get(l[4]) ?? 0.5, x = left + 14 + ln * (right - left - 28); return [x, a.y, x + 3, b.y]; }
    let xa = (a.x0 + a.x1) / 2, xb = (b.x0 + b.x1) / 2;
    if (Math.abs(xa - xb) < 1) { xa -= cw * 0.18; xb += cw * 0.18; }
    return [xa, a.y, xb, b.y];
  };
  return { ion, sp, gr, lim, left, right, top, bot, cw, yE, barOf, ends };
}
function renderLevels() {
  const d = DPR();
  if (!LV.layer || LV.layer.width !== levels.width || LV.layer.height !== levels.height) LV.layer = mkCanvas(levels.width, levels.height);
  const g = LV.layer.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  const { w, h } = size.levels;
  g.clearRect(0, 0, w, h);
  const bgG = g.createLinearGradient(0, 0, 0, h); bgG.addColorStop(0, '#05060d'); bgG.addColorStop(1, '#000'); g.fillStyle = bgG; g.fillRect(0, 0, w, h);
  const Q = LV.geo = levelGeom();
  const fs = getComputedFontSans();
  if (!Q) { g.fillStyle = '#8a93ab'; g.font = `12px ${fs}`; g.textAlign = 'center'; g.fillText('No levels in the data', w / 2, h / 2); $('lvTitle').textContent = ''; LV.dirty = false; return; }
  $('lvTitle').textContent = `${symOf(S.z)} ${ROMAN[Q.ion]} · ${Q.gr.lvl.size} levels`;
  // energy axis
  const tk = C.niceTicks(0, Q.gr.Emax, 6);
  g.font = `9px ${fs}`; g.textBaseline = 'middle'; g.textAlign = 'right';
  for (const v of tk.major) { const y = Q.yE(v); g.fillStyle = 'rgba(150,180,255,0.07)'; g.fillRect(Q.left, y, Q.right - Q.left, 1); g.fillStyle = '#6f7891'; g.fillText(String(v), Q.left - 5, y); }
  g.save(); g.translate(9, (Q.top + Q.bot) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = '#6f7891'; g.fillText('energy (eV)', 0, 0); g.restore();
  // ionization limit
  if (Q.lim && Q.lim <= Q.gr.Emax) {
    const y = Q.yE(Q.lim); g.strokeStyle = 'rgba(255,210,122,0.55)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(Q.left, y); g.lineTo(Q.right, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,210,122,0.8)'; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(`ionization ${Q.lim.toFixed(2)} eV`, Q.right, y - 2);
  }
  // column names
  g.textAlign = 'center'; g.textBaseline = 'top'; g.font = `11px ${getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'serif'}`;
  if (!Q.gr.single) Q.gr.cols.forEach((c, i) => { g.fillStyle = c.odd ? '#b9a8ff' : '#9fd8ff'; g.fillText(c.name + (c.odd ? '°' : ''), Q.left + (i + 0.5) * Q.cw, 6); });
  else { g.fillStyle = '#9fd8ff'; g.fillText('levels by energy · lanes by lower level', (Q.left + Q.right) / 2, 6); }
  // faint transitions
  const W = getW(S.z, Q.ion);
  g.lineWidth = 1;
  Q.sp.lines.forEach((l, i) => {
    const e = Q.ends(l); if (!e) return;
    const c = C.lutRGB(l[0]), b = W.b[i];
    g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.05 + 0.33 * b * b})`;
    g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(e[2], e[3]); g.stroke();
  });
  // level bars
  g.fillStyle = 'rgba(225,232,250,0.62)';
  for (const idx of Q.gr.lvl.keys()) { const b = Q.barOf(idx); g.fillRect(b.x0, b.y - 0.5, b.x1 - b.x0, 1); }
  LV.dirty = false;
}

// Fire one transition i of the diagram spectrum: an event in the diagram,
// a flash in the band, the cell and the tube.
function fire(i, picked) {
  if (LV.dirty || !LV.geo || LV.geo.sp !== specOf(S.z, diagIon())) renderLevels();
  const Q = LV.geo; if (!Q) return;
  const l = Q.sp.lines[i]; if (!l) return;
  const e = Q.ends(l); if (!e) return;
  LV.ev.push({ i, t0: now(), dur: picked ? 1500 : 1100 + Math.random() * 500, e, c: C.lutRGB(l[0]), wl: l[0], z: S.z, ion: Q.ion, emitted: false, picked });
  if (LV.ev.length > 14) LV.ev.shift();
}
function randomLine() {
  const Q = LV.geo; if (!Q) return -1;
  const W = getW(S.z, Q.ion); let sum = 0;
  const L = Q.sp.lines, p = i => C.unclassified(L[i]) ? 0 : W.b[i] * W.b[i] * W.b[i];
  for (let i = 0; i < W.b.length; i++) sum += p(i);
  if (!(sum > 0)) return -1;
  let r = Math.random() * sum;
  for (let i = 0; i < W.b.length; i++) { r -= p(i); if (r <= 0 && p(i) > 0) return i; }
  return -1;
}
function frameLevels(t) {
  const d = DPR(), { w, h } = size.levels;
  if (LV.dirty || !LV.layer) { renderLevels(); }
  lg.setTransform(1, 0, 0, 1, 0, 0); lg.fillStyle = '#000'; lg.fillRect(0, 0, levels.width, levels.height);
  // the levels rise from the ground state after a change
  const k = LV.intro ? Math.min(1, (t - LV.intro) / 700) : 1, ek = 1 - Math.pow(1 - k, 3);
  if (ek < 1) { const cut = Math.round(levels.height * (1 - ek)); lg.drawImage(LV.layer, 0, cut, levels.width, levels.height - cut, 0, cut, levels.width, levels.height - cut); }
  else lg.drawImage(LV.layer, 0, 0);
  lg.setTransform(d, 0, 0, d, 0, 0);
  const Q = LV.geo; if (!Q) return;
  // the picked transition
  if (S.pick && S.pick.z === S.z && S.pick.ion === Q.ion) {
    const l = Q.sp.lines[S.pick.i], e = l && Q.ends(l);
    if (e) { const c = C.lutRGB(l[0]); lg.save(); lg.strokeStyle = `rgb(${c})`; lg.lineWidth = 2; lg.shadowColor = `rgb(${c})`; lg.shadowBlur = 10; lg.beginPath(); lg.moveTo(e[0], e[1]); lg.lineTo(e[2], e[3]); lg.stroke(); lg.restore(); }
  }
  // idle glow
  if (!S.paused && t > LV.nextAt && ek >= 1) {
    const i = randomLine(); if (i >= 0) fire(i, false);
    LV.nextAt = t + 160 + Math.random() * 320;
  }
  const abs = S.mode === 'absorption';
  lg.save(); lg.globalCompositeOperation = 'lighter';
  LV.ev = LV.ev.filter(ev => t - ev.t0 < ev.dur && ev.z === S.z && ev.ion === Q.ion);
  for (const ev of LV.ev) {
    const u = (t - ev.t0) / ev.dur, [xl, yl, xu, yu] = ev.e, c = ev.c;
    const col = a => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    // emission: the electron sits at the upper level, drops, then the photon
    // leaves. Absorption: the photon comes in, the electron rises.
    const pDrop = abs ? [0.35, 0.7] : [0.15, 0.5];
    let ex, ey, ea = 1;
    const m = Math.min(1, Math.max(0, (u - pDrop[0]) / (pDrop[1] - pDrop[0]))), mm = m * m * (3 - 2 * m);
    if (abs) { ex = xl + (xu - xl) * mm; ey = yl + (yu - yl) * mm; } else { ex = xu + (xl - xu) * mm; ey = yu + (yl - yu) * mm; }
    if (u < 0.1) ea = u / 0.1; if (u > 0.85) ea = (1 - u) / 0.15;
    if (m > 0 && m < 1) {        // trail along the transition
      lg.strokeStyle = col(0.5 * ea); lg.lineWidth = 1.6; lg.beginPath();
      if (abs) { lg.moveTo(xl, yl); } else { lg.moveTo(xu, yu); } lg.lineTo(ex, ey); lg.stroke();
    }
    const rg = lg.createRadialGradient(ex, ey, 0, ex, ey, 9);
    rg.addColorStop(0, `rgba(255,255,255,${0.95 * ea})`); rg.addColorStop(0.3, col(0.7 * ea)); rg.addColorStop(1, col(0));
    lg.fillStyle = rg; lg.beginPath(); lg.arc(ex, ey, 9, 0, 7); lg.fill();
    // the photon: a short wave packet
    const ph = abs ? Math.min(1, u / pDrop[0]) : Math.max(0, (u - pDrop[1]) / (1 - pDrop[1]));
    if (abs ? u < pDrop[0] : u > pDrop[1]) {
      const sx = abs ? Q.left - 10 : xl, sy = abs ? yl - 40 : yl, tx = abs ? xl : w + 20, ty = abs ? yl : yl - 50 - (ev.i % 5) * 8;
      const px = sx + (tx - sx) * ph, py = sy + (ty - sy) * ph;
      const ang = Math.atan2(ty - sy, tx - sx), lam = 3 + (ev.wl - 200) / 900 * 9, len = 34;
      lg.strokeStyle = col(abs ? 0.9 : 0.95 * (1 - ph * 0.6)); lg.lineWidth = 1.6; lg.beginPath();
      for (let s = 0; s <= len; s += 1) {
        const env = Math.sin(Math.PI * s / len), off = Math.sin((s / lam) * 2 * Math.PI - t / 60) * 4.5 * env;
        const qx = px - Math.cos(ang) * s - Math.sin(ang) * off, qy = py - Math.sin(ang) * s + Math.cos(ang) * off;
        if (s === 0) lg.moveTo(qx, qy); else lg.lineTo(qx, qy);
      }
      lg.stroke();
    }
    // the moment of emission (or absorption): flash the line everywhere
    if (!ev.emitted && u > (abs ? pDrop[0] : pDrop[1])) {
      ev.emitted = true;
      BD.flash.push({ z: ev.z, ion: ev.ion, i: ev.i, a: ev.picked ? 1 : 0.75 });
      OV.flash = Math.min(1, OV.flash + 0.35);
      tubeFlash();
    }
  }
  lg.restore();
}
levels.addEventListener('click', e => {
  const Q = LV.geo; if (!Q) return;
  const q = levels.getBoundingClientRect(), x = e.clientX - q.left, y = e.clientY - q.top;
  // the nearest transition to the tap (distance to its segment)
  let best = -1, bd = 12;
  Q.sp.lines.forEach((l, i) => {
    const s = Q.ends(l); if (!s) return;
    const [x1, y1, x2, y2] = s, dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
    const dd = Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy));
    if (dd < bd) { bd = dd; best = i; }
  });
  if (best >= 0) {
    S.pick = { z: S.z, ion: Q.ion, i: best }; fire(best, true);
    const wl = Q.sp.lines[best][0];
    if (wl < BD.lo || wl > BD.hi) { const span = BD.hi - BD.lo; setWindow(wl - span / 2, wl + span / 2); }
    const G = BD.geom || bandGeom(), ri = BD.rows.findIndex(r => r.z === S.z && r.ion === Q.ion);
    if (ri >= 0) { tipPinned = true; showTip({ z: S.z, ion: Q.ion, i: best, ri }, G); }
  }
});

// ═══ TUBE AND PANEL ════════════════════════════════════════════════════════
const CMP_COL = ['#7fd4ff', '#ffb36b', '#9df29a', '#f59ad8'];
let lamp = [136, 136, 136];
const cssLamp = a => `rgba(${lamp[0]},${lamp[1]},${lamp[2]},${a})`;
function updateLamp() {
  let X = null;
  // sum the lin weights of the shown ions
  const parts = ionsOf(S.ion).map(ion => ({ sp: specOf(S.z, ion), w: getW(S.z, ion) })).filter(p => p.sp);
  if (parts.length === 1) X = C.lampColor(parts[0].sp, parts[0].w.lin);
  else if (parts.length === 2) {
    const sp = { lines: parts[0].sp.lines.concat(parts[1].sp.lines) };
    const lin = new Float32Array(sp.lines.length); lin.set(parts[0].w.lin); lin.set(parts[1].w.lin, parts[0].w.lin.length);
    X = C.lampColor(sp, lin);
  } else X = C.lampColor(null, []);
  lamp = X.rgb;
  document.documentElement.style.setProperty('--lamp', X.hex);
  $('tubeHex').textContent = X.hex;
}
let tubeT = 0;
function tubeFlash() {
  const tb = $('tube'); if (now() - tubeT < 140) return; tubeT = now();
  tb.classList.add('flash'); setTimeout(() => tb.classList.remove('flash'), 90);
}

function syncPanel() {
  const z = S.z, m = META.get(z) || {}, d = DATA.get(z);
  $('elSym').textContent = symOf(z);
  $('elName').textContent = nameOf(z);
  const parts = ['I', 'II'].map(ion => { const sp = d && d[ion]; return sp ? `${symOf(z)} ${ion}: ${sp.lines.length} of ${sp.total} lines (by ${sp.by === 'rel' ? 'NIST rel. int.' : 'gA'})` : `${symOf(z)} ${ion}: no data`; });
  const sp = specOf(z, S.ion === 'II' ? 'II' : 'I');
  let strong = '';
  if (sp) { const w = getW(z, S.ion === 'II' ? 'II' : 'I'); let bi = 0; for (let i = 1; i < w.b.length; i++) if (w.b[i] > w.b[bi]) bi = i; strong = `strongest ${sp.lines[bi][0].toFixed(3)} nm`; }
  $('elSub').innerHTML = `Z ${z}${m.mass ? ' · ' + (+m.mass).toFixed(3) + ' u' : ''}<br>${parts.join('<br>')}${strong ? '<br>' + strong : ''}`;
  $('bandTitle').innerHTML = S.compare.length >= 2
    ? `Compare <span class="dimtxt">${S.compare.map(symOf).join(' · ')}</span>`
    : `${nameOf(z)} <span class="dimtxt">${S.ion === 'both' ? 'I and II' : S.ion === 'II' ? 'II · singly ionized' : 'I · neutral'} · ${S.mode}</span>`;
  $('topStat').textContent = `${ZS.length} elements · ${SPECTRA.elements.reduce((a, e) => a + (e.I ? e.I.lines.length : 0) + (e.II ? e.II.lines.length : 0), 0)} lines · NIST ASD`;
  updateLamp();
  syncSegs();
}
function syncSegs() {
  const mark = (sel, attr, val) => document.querySelectorAll(sel).forEach(b => b.classList.toggle('on', b.dataset[attr] === val));
  mark('[data-view]', 'view', S.view);
  mark('[data-ion]', 'ion', S.ion);
  mark('[data-mode]', 'mode', S.mode);
  mark('[data-range]', 'range', S.range);
  mark('[data-model]', 'model', S.model);
  mark('[data-lion]', 'lion', diagIon());
  const pb = $('playBtn'), dp = $('dockPlay');
  pb.textContent = S.paused ? 'Resume glow' : 'Pause glow';
  dp.textContent = S.paused ? '▶' : '❚❚'; dp.classList.toggle('on', S.paused);
  dp.setAttribute('aria-label', S.paused ? 'Resume the glow' : 'Pause the glow');
  $('tempV').textContent = `${Math.round(S.T).toLocaleString('en-US')} K`;
  $('modelHint').textContent = S.model === 'boltz'
    ? `Each line: gk Aki / λ · exp(−Ek / kT) at ${Math.round(S.T)} K, optically thin, LTE. Hot gas lights the high levels. I and II each scaled to their own strongest line (no Saha balance).`
    : 'NIST relative intensity (or gA when NIST gives none), on a log scale. Move the slider to switch to the Boltzmann model.';
  renderChips();
}
function renderChips() {
  const host = $('chips'); host.innerHTML = '';
  S.compare.forEach((z, i) => {
    const c = document.createElement('span'); c.className = 'chip';
    c.innerHTML = `<i style="background:${CMP_COL[i]}"></i>${symOf(z)} <button aria-label="Remove ${symOf(z)}">✕</button>`;
    c.querySelector('button').addEventListener('click', () => toggleCompare(z));
    host.appendChild(c);
  });
  $('cmpAdd').textContent = S.compare.includes(S.z) ? `Remove ${symOf(S.z)}` : `Add ${symOf(S.z)}`;
  $('cmpAdd').disabled = !S.compare.includes(S.z) && S.compare.length >= 4;
}

// ─── actions ───────────────────────────────────────────────────────────────
function setElement(key, opt = {}) {
  const z = typeof key === 'number' ? key : zOf(key);
  if (!z || !DATA.has(z)) return false;
  const changed = z !== S.z;
  S.z = z;
  if (!opt.keepPick) { S.pick = null; tipPinned = false; hideTip(); }
  if (changed) { LV.ev = []; LV.intro = now(); if (S.compare.length < 2) BD.intro = now(); }
  if (!specOf(z, S.lion)) S.lion = specOf(z, 'I') ? 'I' : 'II';
  BD.rows = bandRows(); BD.dirty = true; LV.dirty = true; OV.dirty = true;
  syncPanel(); writeURL();
  return true;
}
function toggleCompare(z) {
  const i = S.compare.indexOf(z);
  if (i >= 0) S.compare.splice(i, 1); else if (S.compare.length < 4) S.compare.push(z);
  BD.rows = bandRows(); BD.dirty = true; BD.intro = now(); OV.dirty = true;
  syncPanel();
}
function settingsChanged() {
  WC.clear(); BD.rows = bandRows(); BD.dirty = true; LV.dirty = true; OV.dirty = true; syncPanel();
}
function doFind(nm) {
  if (!Number.isFinite(nm)) return;
  S.find = Math.round(nm * 100) / 100;
  S.findRes = C.findByWavelength(SPECTRA, S.find, 0.5, ionsOf(S.ion));
  $('findIn').value = S.find.toFixed(2);
  const ol = $('findList'); ol.innerHTML = '';
  if (!S.findRes.length) { const li = document.createElement('li'); li.textContent = `No line within ±0.5 nm of ${S.find.toFixed(2)} nm`; ol.appendChild(li); }
  S.findRes.slice(0, 40).forEach(r => {
    const li = document.createElement('li'), c = C.lutRGB(r.wl);
    li.innerHTML = `<span class="sym">${r.sym} ${r.ion}</span><span class="wl">${r.wl.toFixed(3)} nm</span><span class="bar2"><span style="width:${(r.s * 100).toFixed(0)}%;background:rgb(${c})"></span></span>`;
    li.title = nameOf(r.z);
    li.addEventListener('click', () => {
      setElement(r.z);
      S.pick = { z: r.z, ion: r.ion, i: r.idx };
      if (r.wl < BD.lo || r.wl > BD.hi) { const span = Math.min(BD.hi - BD.lo, 60); setWindow(r.wl - span / 2, r.wl + span / 2); }
      if (r.ion !== diagIon()) { S.lion = r.ion; LV.dirty = true; }
      if (diagIon() === r.ion) fire(r.idx, true);
    });
    ol.appendChild(li);
  });
  OV.dirty = true;
  if (PHONE_Q.matches && !panel.classList.contains('open')) setOpen(true);
}

// ─── controls ──────────────────────────────────────────────────────────────
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-ion]').forEach(b => b.addEventListener('click', () => {
  S.ion = b.dataset.ion; if (S.ion !== 'both') S.lion = S.ion; settingsChanged();
  if (S.find != null) doFind(S.find);
}));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { S.mode = b.dataset.mode; settingsChanged(); }));
document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { S.range = b.dataset.range; OV.dirty = true; syncSegs(); }));
document.querySelectorAll('[data-model]').forEach(b => b.addEventListener('click', () => { S.model = b.dataset.model; settingsChanged(); }));
document.querySelectorAll('[data-lion]').forEach(b => b.addEventListener('click', () => { S.lion = b.dataset.lion; LV.dirty = true; LV.ev = []; LV.intro = now(); syncSegs(); }));
const tempIn = $('temp');
const tFromV = v => C.T_MIN * Math.pow(C.T_MAX / C.T_MIN, v / 1000);
tempIn.value = String(Math.round(1000 * Math.log(S.T / C.T_MIN) / Math.log(C.T_MAX / C.T_MIN)));
let tempRaf = 0;
tempIn.addEventListener('input', () => {
  S.T = tFromV(+tempIn.value); S.model = 'boltz';
  $('tempV').textContent = `${Math.round(S.T).toLocaleString('en-US')} K`;
  if (!tempRaf) tempRaf = requestAnimationFrame(() => { tempRaf = 0; settingsChanged(); });
});
const togglePause = () => { S.paused = !S.paused; syncSegs(); };
$('playBtn').addEventListener('click', togglePause);
$('dockPlay').addEventListener('click', togglePause);
$('bandReset').addEventListener('click', () => { if (BD.hi - BD.lo > 800) setWindow(370, 760); else setWindow(195, 1105); });
$('prevEl').addEventListener('click', () => stepEl(-1));
$('nextEl').addEventListener('click', () => stepEl(1));
function stepEl(dz) { const i = ZS.indexOf(S.z); setElement(ZS[(i + dz + ZS.length) % ZS.length]); }
{
  const dl = $('elList');
  for (const z of ZS) { const o = document.createElement('option'); o.value = `${symOf(z)} — ${nameOf(z)}`; dl.appendChild(o); }
  const go = () => { const v = $('elFind').value.split('—')[0].trim(); if (setElement(v)) $('elFind').value = ''; };
  $('elFind').addEventListener('change', go);
  $('elFind').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
$('cmpAdd').addEventListener('click', () => toggleCompare(S.z));
$('cmpClear').addEventListener('click', () => { S.compare = []; BD.rows = bandRows(); BD.dirty = true; OV.dirty = true; syncPanel(); });
$('findGo').addEventListener('click', () => doFind(parseFloat($('findIn').value)));
$('findIn').addEventListener('keydown', e => { if (e.key === 'Enter') doFind(parseFloat($('findIn').value)); });
window.addEventListener('keydown', e => {
  if (window.snSaverActive) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { stepEl(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { stepEl(-1); e.preventDefault(); }
  else if (e.key === 't') setView(S.view === 'table' ? 'stack' : 'table');
  else if (e.key === ' ') { togglePause(); e.preventDefault(); }
  else if (e.key === 'Escape') { S.pick = null; tipPinned = false; hideTip(); }
});

// ─── phone sheet (the pattern of pages/wave-membrane) ──────────────────────
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (orientation:landscape)');
const panel = $('panel'), dockPanel = $('dockPanel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-open', open);
  dockPanel.classList.toggle('on', open);
  dockPanel.setAttribute('aria-expanded', String(open));
}
dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
{
  // The grip: a tap switches half and full height, a drag up gives full
  // height, a drag down gives half height and then closes.
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ─── url and api ───────────────────────────────────────────────────────────
function writeURL() {
  try {
    const q = new URLSearchParams(location.search);
    q.set('el', symOf(S.z)); q.set('view', S.view);
    history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
  } catch (e) { /* sandboxed frame */ }
}
window.snSpectral = {
  setElement: sym => setElement(sym),
  setView: name => setView(name),
  set(o = {}) {
    if (o.ion) S.ion = o.ion; if (o.mode) S.mode = o.mode; if (o.model) S.model = o.model;
    if (o.T) { S.T = Math.max(C.T_MIN, Math.min(C.T_MAX, o.T)); S.model = 'boltz'; }
    if (o.window) setWindow(o.window[0], o.window[1]);
    if (o.compare) S.compare = o.compare.map(zOf).filter(z => z && DATA.has(z)).slice(0, 4);
    if (o.paused != null) S.paused = !!o.paused;
    settingsChanged();
  },
  find: nm => { doFind(nm); return S.findRes.slice(); },
  state: () => ({
    el: symOf(S.z), z: S.z, name: nameOf(S.z), view: S.view, ion: S.ion, mode: S.mode, model: S.model, T: Math.round(S.T),
    range: S.range, window: [BD.lo, BD.hi], compare: S.compare.map(symOf), find: S.find, paused: S.paused,
    pick: S.pick ? { el: symOf(S.pick.z), ion: S.pick.ion, wl: specOf(S.pick.z, S.pick.ion).lines[S.pick.i][0] } : null,
    lamp: '#' + lamp.map(v => v.toString(16).padStart(2, '0')).join(''), elements: ZS.length,
  }),
  core: C,
};

// ─── frame loop ────────────────────────────────────────────────────────────
// While the saver runs (window.snSaverActive, lane C saver.js), the loop
// stops and the input handlers do nothing. 'sn-saver-exit' starts it again.
let running = false;
const saverOn = () => !!window.snSaverActive;
let loopId = 0;                      // a new start makes the old loop stop
function start() { if (running || saverOn()) return; running = true; resizeAll(); const id = ++loopId; requestAnimationFrame(() => frame(id)); }
window.addEventListener('sn-saver-enter', () => { running = false; loopId++; hideTip(); });
window.addEventListener('sn-saver-exit', () => { OV.dirty = BD.dirty = LV.dirty = true; start(); });
function frame(id) {
  if (id !== loopId) return;
  if (saverOn()) { running = false; return; }
  const t = now();
  OV.flash *= 0.9;
  try {
    frameOverview(t);
    frameBand(t);
    frameLevels(t);
  } catch (e) { console.error(e); }
  requestAnimationFrame(() => frame(id));
}

// ─── boot ──────────────────────────────────────────────────────────────────
resizeAll();
layoutOverview();
BD.rows = bandRows();
setWindow(370, 760);
syncPanel(); writeURL();
LV.intro = now(); BD.intro = now();
start();
// MathJax for the two equations of the About panel (lib/sci-math.js).
import('../../lib/sci-math.js').then(m => setTimeout(() => m.typesetAll(document), 1200)).catch(() => { /* text stays */ });

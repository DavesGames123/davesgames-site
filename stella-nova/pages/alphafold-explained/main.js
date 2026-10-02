// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Builds every live diagram of index.html. One protein runs through all of
//  them: the AlphaFold DB model of human SUMO1 in data.js. Each init*
//  function owns one card. A card that animates registers a tick in WIDGETS;
//  the single rAF loop calls only the ticks of cards on screen.
//
//  INPUT RULE. Every diagram works by tap and by drag. A mouse hover shows
//  the same thing a tap shows. Canvases keep touch-action: pan-y, so a
//  vertical swipe scrolls the page and a horizontal drag scrubs the diagram.
//
//  REAL vs ILLUSTRATIVE. Values from the model (frames, torsions, distances,
//  FAPE, pLDDT, PAE) are computed or read, never made up. The MSA is
//  synthetic (build-data.mjs). The layer path in the structure module, the
//  recycling maps and the AF3 noise path are illustrative, and the page says
//  so on each card.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      shared helpers ... "function fitCanvas"  "function onPoint"
//      colors ........... "function plddtColor" "function rainbow"
//      minimap .......... "function initMini"
//      pipeline ......... "function initPipe"
//      01 MSA ........... "function initMsa"
//      02 embedding ..... "function initEmbed"
//      03 evoformer ..... "function initEvo"  "function initTri"
//      04 structure ..... "function initStruct" "function initIpa" "function initRama"
//      05 recycle/loss .. "function initRecycle" "function initFape"
//      06 outputs ....... "function initOutputs"
//      07 AF3 ........... "function initDiffusion"
//      08 limits ........ "function initLimits" "function initDepthChart"
//      formula fit ...... "function fitEq"
//      loop ............. "function loop"
//      screensaver ...... "window.snSaver"  one full-window 3D view, four scenes
//      saver plate ...... "function saverPlate"  opts.label: protein, atoms, scene equation
// ============================================================================
import { PROT } from './data.js';
import { encode, conservation, couplings, contacts, topPairs, weights } from './msa.js';
import * as G from './geom.js';
import { View3D } from './view3d.js';

const $ = id => document.getElementById(id);
const L = PROT.seq.length;
const SEQ = PROT.seq;
const PL = PROT.plddt;
const WIDGETS = [];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- shared helpers
// Size a 2D canvas to its CSS box at devicePixelRatio (capped at 2).
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
// Redraw a canvas when its box changes.
function watchSize(el, fn) { new ResizeObserver(() => fn()).observe(el); }

// Tap, drag and hover on one element. fn(x, y, kind) with kind 'down',
// 'move' (pointer held) or 'hover' (mouse, no button). Coordinates are CSS px
// in the element box.
function onPoint(el, fn) {
  let down = null;
  const pos = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  el.addEventListener('pointerdown', e => { down = e.pointerId; fn(...pos(e), 'down'); });
  el.addEventListener('pointermove', e => {
    if (down === e.pointerId) fn(...pos(e), 'move');
    else if (e.pointerType === 'mouse' && down === null) fn(...pos(e), 'hover');
  });
  const up = e => { if (e.pointerId === down) down = null; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function segButtons(host, items, onPick, initial) {
  host.innerHTML = '';
  const btns = items.map(([key, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.key = key;
    b.addEventListener('click', () => { set(key); onPick(key); });
    host.appendChild(b); return b;
  });
  const set = key => btns.forEach(b => b.classList.toggle('on', b.dataset.key === String(key)));
  set(initial);
  return set;
}

function register(el, tick) {
  const w = { el, tick, on: false };
  WIDGETS.push(w);
  new IntersectionObserver(es => es.forEach(e => { w.on = e.isIntersecting; }), { rootMargin: '80px' }).observe(el);
  return w;
}

const fmtBytes = b => b >= 1e12 ? (b / 1e12).toFixed(2) + ' TB' : b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' kB';

// ---------------------------------------------------------------- colors
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function plddtColor(v) { return hex(v > 90 ? '#0053d6' : v > 70 ? '#65cbf3' : v > 50 ? '#ffdb13' : '#ff7d45'); }
const RAMP = ['#3fd0c0', '#5aa7ff', '#9b84ff', '#e872c4', '#f4a64a'].map(hex);
function ramp(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1); const k = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[k], stops[k + 1], t - k);
}
function rainbow(i) { return ramp(RAMP, i / (L - 1)); }
const DIST_RAMP = ['#fff4d6', '#f4a64a', '#c2416b', '#4b2a7a', '#141a33', '#0a0c13'].map(hex);
const distColor = d => ramp(DIST_RAMP, d / 32);
const PAE_RAMP = ['#0d5c3a', '#1f9a5e', '#7fd3a3', '#d9efe2', '#f7f7f2'].map(hex);
const AA_COL = {};
for (const [s, c] of [['AILMV', '#4f7fd9'], ['FWY', '#36a6b8'], ['KRH', '#c8508e'], ['DE', '#e0813a'], ['STNQ', '#58ab6a'], ['G', '#b9a54c'], ['P', '#d4cd57'], ['C', '#e7d989']])
  for (const a of s) AA_COL[a] = hex(c);
const ELEM_COL = ['#b9bfcc', '#5b8cff', '#ff5d5d', '#ffd84a'].map(hex);

// ---------------------------------------------------------------- geometry of the model
const P3 = (arr, i) => G.at(arr, i);
const CA = Array.from({ length: L }, (_, i) => P3(PROT.CA, i));
const CB = Array.from({ length: L }, (_, i) => P3(PROT.CB, i));
const NN = Array.from({ length: L }, (_, i) => P3(PROT.N, i));
const CC = Array.from({ length: L }, (_, i) => P3(PROT.C, i));
const FRAMES = CA.map((_, i) => G.frameFrom3(NN[i], CA[i], CC[i]));
const DCA = new Float32Array(L * L), DCB = new Float32Array(L * L);
for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
  DCA[i * L + j] = G.norm(G.sub(CA[i], CA[j])); DCB[i * L + j] = G.norm(G.sub(CB[i], CB[j]));
}
const ATOMS = [];
for (let k = 0; k < PROT.atoms.length; k += 6) {
  const a = PROT.atoms;
  ATOMS.push({ p: [a[k], a[k + 1], a[k + 2]], el: a[k + 3], res: a[k + 4], ca: a[k + 5] });
}
// Each atom in the local frame of its residue: lets frames carry atoms.
ATOMS.forEach(a => { a.loc = G.applyInv(FRAMES[a.res], a.p); });
const CORE_R = Math.max(...CA.filter((_, i) => PL[i] > 70).map(p => G.norm(p)));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = R => { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * v); };

// ============================================================================
//  MINIMAP
// ============================================================================
function initMini() {
  const secs = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map($);
  const links = [...document.querySelectorAll('.mini-link')];
  const list = document.querySelector('.mini-list');
  // aim: the step of the last jump. A smooth scroll takes about a second,
  // and cur follows the scroll position, so a second press of prev or next
  // during the scroll counts from aim, not from the step it scrolls past.
  let cur = -1, aim = -1, aimT = -1e9;
  const goTo = k => { aim = k; aimT = performance.now(); secs[k].scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const stepBy = d => goTo(clamp((performance.now() - aimT < 1200 ? aim : cur) + d, 0, secs.length - 1));
  links.forEach((a, i) => a.addEventListener('click', e => { e.preventDefault(); goTo(i + 1); }));
  const update = () => {
    const y = innerHeight * 0.33;
    let k = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= y) k = i; });
    const max = document.documentElement.scrollHeight - innerHeight;
    $('miniBar').style.width = (max > 0 ? 100 * scrollY / max : 0).toFixed(1) + '%';
    if (k === cur) return;
    cur = k;
    links.forEach((a, i) => { a.classList.toggle('on', i + 1 === k); a.classList.toggle('done', i + 1 < k); });
    $('miniNum').textContent = k === 0 ? '00' : secs[k].dataset.step;
    $('miniNow').textContent = k === 0 ? 'Overview' : secs[k].dataset.name;
    const on = links[k - 1];
    if (on && list.scrollWidth > list.clientWidth + 2) {
      list.scrollTo({ left: on.offsetLeft - list.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
    }
  };
  let pend = false;
  addEventListener('scroll', () => { if (!pend) { pend = true; requestAnimationFrame(() => { pend = false; update(); }); } }, { passive: true });
  addEventListener('resize', update);
  $('miniPrev').addEventListener('click', () => stepBy(-1));
  $('miniNext').addEventListener('click', () => stepBy(1));
  update();
}

// ============================================================================
//  PIPELINE (hero)
// ============================================================================
function initPipe() {
  const svg = $('pipe');
  const NS = 'http://www.w3.org/2000/svg';
  let mode = '';
  const nodes = [
    { id: 'seq', t: 'Sequence', s: '101 aa', c: '#f4a64a', go: 's1' },
    { id: 'msa', t: 'Genetic search', s: 'MSA  Nseq×Nres', c: '#3fd0c0', go: 's1' },
    { id: 'tpl', t: 'Template search', s: '≤ 4 structures', c: '#b08cff', go: 's1' },
    { id: 'emb', t: 'Embedding', s: 'm 512×N×256 · z N×N×128', c: '#e8eaf0', go: 's2' },
    { id: 'evo', t: 'Evoformer ×48', s: 'row/col attn · triangles', c: '#f4a64a', go: 's3' },
    { id: 'sm', t: 'Structure module ×8', s: 'frames · IPA · torsions', c: '#b08cff', go: 's4' },
    { id: 'out', t: '3D + confidence', s: 'atoms · pLDDT · PAE', c: '#65cbf3', go: 's6' },
  ];
  function draw() {
    const narrow = svg.getBoundingClientRect().width < 640;
    const m = narrow ? 'n' : 'w';
    if (m === mode) return; mode = m;
    svg.innerHTML = '';
    const W = narrow ? 360 : 1200, H = narrow ? 600 : 220;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pos = narrow ? {
      seq: [130, 14, 100, 44], msa: [20, 92, 150, 50], tpl: [190, 92, 150, 50], emb: [60, 180, 240, 52],
      evo: [60, 266, 240, 56], sm: [60, 356, 240, 56], out: [60, 446, 240, 52],
    } : {
      seq: [14, 84, 104, 52], msa: [150, 34, 150, 52], tpl: [150, 134, 150, 52], emb: [334, 84, 190, 52],
      evo: [560, 84, 190, 56], sm: [786, 84, 190, 56], out: [1010, 84, 176, 52],
    };
    const el = (n, a, parent = svg) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; };
    const defs = el('defs', {});
    const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#8a91a5' }, mk);
    const c = id => { const [x, y, w, h] = pos[id]; return { l: [x, y + h / 2], r: [x + w, y + h / 2], t: [x + w / 2, y], b: [x + w / 2, y + h] }; };
    const link = (a, b, extra = {}) => el('path', Object.assign({ d: `M${a[0]},${a[1]} C${narrow ? a[0] : (a[0] + b[0]) / 2},${narrow ? (a[1] + b[1]) / 2 : a[1]} ${narrow ? b[0] : (a[0] + b[0]) / 2},${narrow ? (a[1] + b[1]) / 2 : b[1]} ${b[0]},${b[1]}`, fill: 'none', stroke: '#8a91a5', 'stroke-width': 1.4, 'marker-end': 'url(#arr)', class: 'flowline' }, extra));
    if (narrow) {
      link(c('seq').b, c('msa').t); link(c('seq').b, c('tpl').t);
      link(c('msa').b, c('emb').t); link(c('tpl').b, c('emb').t);
      link(c('emb').b, c('evo').t); link(c('evo').b, c('sm').t); link(c('sm').b, c('out').t);
      el('path', { d: `M300,${pos.out[1] + 26} C350,${pos.out[1] + 26} 350,${pos.emb[1] + 26} 302,${pos.emb[1] + 26}`, fill: 'none', stroke: '#f4a64a', 'stroke-width': 1.4, 'stroke-dasharray': '5 4', 'marker-end': 'url(#arr)', class: 'flowline' });
      const t = el('text', { x: 346, y: (pos.emb[1] + pos.out[1]) / 2 + 26, fill: '#f4a64a', 'font-size': 11, 'text-anchor': 'middle', transform: `rotate(90 346 ${(pos.emb[1] + pos.out[1]) / 2 + 26})` }); t.textContent = 'recycle ×3';
      const a3 = el('g', { class: 'node', 'data-go': 's7' });
      el('rect', { x: 20, y: 530, width: 156, height: 54, rx: 9, fill: '#0b0e16', stroke: '#3a4256', 'stroke-dasharray': '4 3' }, a3);
      const t1 = el('text', { x: 98, y: 552, fill: '#e7e9f0', 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 600 }, a3); t1.textContent = 'AlphaFold 3 →';
      const t2 = el('text', { x: 98, y: 570, fill: '#8a91a5', 'font-size': 10, 'text-anchor': 'middle' }, a3); t2.textContent = 'Pairformer · diffusion';
      const lm = el('g', { class: 'node', 'data-go': 's8' });
      el('rect', { x: 184, y: 530, width: 156, height: 54, rx: 9, fill: '#0b0e16', stroke: '#3a4256', 'stroke-dasharray': '4 3' }, lm);
      const t3 = el('text', { x: 262, y: 552, fill: '#e7e9f0', 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 600 }, lm); t3.textContent = 'Limits →';
      const t4 = el('text', { x: 262, y: 570, fill: '#8a91a5', 'font-size': 10, 'text-anchor': 'middle' }, lm); t4.textContent = 'what it does not do';
    } else {
      link(c('seq').r, c('msa').l); link(c('seq').r, c('tpl').l);
      link(c('msa').r, c('emb').l); link(c('tpl').r, c('emb').l);
      link(c('emb').r, c('evo').l); link(c('evo').r, c('sm').l); link(c('sm').r, c('out').l);
      el('path', { d: `M${pos.sm[0] + 95},${pos.sm[1] + 56} C${pos.sm[0] + 95},200 ${pos.emb[0] + 95},200 ${pos.emb[0] + 95},${pos.emb[1] + 54}`, fill: 'none', stroke: '#f4a64a', 'stroke-width': 1.4, 'stroke-dasharray': '5 4', 'marker-end': 'url(#arr)', class: 'flowline' });
      const t = el('text', { x: (pos.sm[0] + pos.emb[0]) / 2 + 95, y: 196, fill: '#f4a64a', 'font-size': 12, 'text-anchor': 'middle' }); t.textContent = 'recycle ×3 — same weights, outputs fed back in';
      const a3 = el('text', { x: 1186, y: 20, fill: '#8a91a5', 'font-size': 11, 'text-anchor': 'end', class: 'node', 'data-go': 's7' }); a3.textContent = 'AlphaFold 3: Pairformer + diffusion →';
    }
    for (const n of nodes) {
      const [x, y, w, h] = pos[n.id];
      const g = el('g', { class: 'node', 'data-go': n.go, tabindex: 0, role: 'link' });
      el('rect', { x, y, width: w, height: h, rx: 10, fill: '#0b0e16', stroke: n.c, 'stroke-width': 1.3 }, g);
      const t1 = el('text', { x: x + w / 2, y: y + h / 2 - 4, fill: '#fff', 'font-size': narrow ? 13 : 13.5, 'font-weight': 600, 'text-anchor': 'middle' }, g); t1.textContent = n.t;
      const t2 = el('text', { x: x + w / 2, y: y + h / 2 + 13, fill: n.c, 'font-size': 10.5, 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, ui-monospace, monospace' }, g); t2.textContent = n.s;
    }
    svg.querySelectorAll('.node').forEach(g => {
      const go = () => $(g.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' });
      g.addEventListener('click', go);
      g.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  }
  draw(); watchSize(svg.parentElement, draw);
  // Marching dashes on the arrows.
  let off = 0;
  register(svg, dt => {
    off -= dt * 18;
    svg.querySelectorAll('.flowline').forEach(p => { if (!p.getAttribute('stroke-dasharray')) p.setAttribute('stroke-dasharray', '6 4'); p.setAttribute('stroke-dashoffset', off.toFixed(1)); });
  });
}

// ============================================================================
//  01  MSA, conservation, co-variation
// ============================================================================
const TRUE_CONTACTS = contacts(PROT.CB, L);
function initMsa() {
  const cv = $('msaCv'), cm = $('cmapCv');
  const DEPTHS = [8, 16, 32, 64, 128, 256, 512];
  let depth = 512, rows, cons, C, top, prec5, neff, sel = 0;
  function subset(n) {
    if (n >= PROT.msa.length) return PROT.msa.slice();
    const out = [PROT.msa[0]], step = (PROT.msa.length - 1) / (n - 1);
    for (let k = 0; k < n - 1; k++) out.push(PROT.msa[1 + Math.floor(k * step)]);
    return out;
  }
  function compute() {
    rows = subset(depth);
    const enc = encode(rows);
    cons = conservation(enc); C = couplings(enc);
    neff = weights(enc).reduce((a, b) => a + b, 0);
    top = topPairs(C, L, L, TRUE_CONTACTS).top;
    prec5 = topPairs(C, L, Math.round(L / 5), TRUE_CONTACTS).precision;
    if (!sel) sel = top[0][1];
  }
  function partners(c) {
    const arr = [];
    for (let j = 0; j < L; j++) if (Math.abs(j - c) >= 6) arr.push([C[c * L + j], j]);
    arr.sort((a, b) => b[0] - a[0]);
    return arr.slice(0, 5);
  }
  function drawMsa() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    // A box with no layout yet (hidden frame, collapsed card) gives a
    // negative arc radius, and ellipse() throws. Draw nothing; the
    // ResizeObserver draws again when the box has a size.
    if (h < 40 || w < 40) return;
    const padL = 6, padR = 6, cw = (w - padL - padR) / L;
    const arcH = Math.min(70, h * 0.22), consH = 22, qH = Math.max(12, Math.min(16, cw * 1.6));
    const y0 = arcH + consH + qH + 8, areaH = h - y0 - 4;
    const n = rows.length, rh = areaH / n;
    const xc = i => padL + (i + 0.5) * cw;
    // MSA cells
    for (let s = 0; s < n; s++) {
      const r = rows[s], y = y0 + s * rh;
      for (let i = 0; i < L; i++) {
        const a = r[i]; if (a === '-') continue;
        const col = AA_COL[a] || [120, 120, 120];
        const k = i === sel ? 1 : 0.62;
        g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${k})`;
        g.fillRect(padL + i * cw, y, Math.max(1, cw - (cw > 4 ? 0.6 : 0)), Math.max(0.8, rh - (rh > 4 ? 0.6 : 0)));
        if (rh >= 11 && cw >= 8) { g.fillStyle = 'rgba(8,10,16,0.85)'; g.font = `500 ${Math.min(rh, cw) * 0.72}px IBM Plex Mono, ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a, xc(i), y + rh / 2 + 0.5); }
      }
    }
    // query row
    const qy = arcH + consH + 4;
    for (let i = 0; i < L; i++) {
      const col = AA_COL[SEQ[i]];
      g.fillStyle = css(i === sel ? [255, 255, 255] : mix(col, [255, 255, 255], 0.15));
      if (cw >= 7) { g.font = `600 ${Math.min(13, cw * 0.95)}px IBM Plex Mono, ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(SEQ[i], xc(i), qy + qH / 2); }
      else { g.fillRect(padL + i * cw, qy + 2, cw - 0.4, qH - 4); }
    }
    // conservation bars
    for (let i = 0; i < L; i++) {
      const v = cons[i], bh = v * (consH - 2);
      g.fillStyle = i === sel ? '#fff' : css(mix([58, 66, 86], [63, 208, 192], v));
      g.fillRect(padL + i * cw + 0.3, arcH + consH - bh, Math.max(1, cw - 0.6), bh);
    }
    // selected column
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
    g.strokeRect(padL + sel * cw - 0.5, arcH, cw + 1, h - arcH - 2);
    // arcs to partners
    const ps = partners(sel), smax = ps[0][0] || 1;
    for (const [s, j] of ps) {
      if (j !== sel) {
        const hit = TRUE_CONTACTS[sel * L + j];
        const a = xc(sel), b = xc(j), mid = (a + b) / 2, rx = Math.abs(b - a) / 2;
        const ry = Math.min(arcH - 6, 10 + rx * 0.55);
        g.strokeStyle = hit ? '#3ddc97' : '#ff5d6c'; g.globalAlpha = 0.35 + 0.65 * clamp(s / smax, 0, 1);
        g.lineWidth = 1 + 2.4 * clamp(s / smax, 0, 1);
        g.beginPath(); g.ellipse(mid, arcH, rx, ry, 0, Math.PI, 2 * Math.PI); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = hit ? '#3ddc97' : '#ff5d6c';
        g.fillRect(padL + j * cw, arcH - 2, cw, 3);
      }
    }
    g.fillStyle = '#8a91a5'; g.font = '10px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('co-variation partners of column ' + (sel + 1), padL, 2);
    g.textAlign = 'right'; g.fillText(`${rows.length} rows`, w - padR, 2);
  }
  function drawMap() {
    const { g, w } = fitCanvas(cm);
    const pad = 22, s = (w - pad - 6) / L;
    g.clearRect(0, 0, w, w);
    g.fillStyle = '#0a0c13'; g.fillRect(pad, pad, s * L, s * L);
    let cmax = 0; for (let k = 0; k < L * L; k++) cmax = Math.max(cmax, C[k]);
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
      if (j > i && TRUE_CONTACTS[i * L + j]) { g.fillStyle = '#8796bd'; g.fillRect(pad + j * s, pad + i * s, s + 0.3, s + 0.3); }
      if (j < i) { const v = clamp(C[i * L + j] / cmax, 0, 1); if (v > 0.08) { g.fillStyle = `rgba(160,170,200,${v * 0.55})`; g.fillRect(pad + j * s, pad + i * s, s + 0.3, s + 0.3); } }
    }
    for (const [, i, j] of top.slice(0, L)) {
      g.fillStyle = TRUE_CONTACTS[i * L + j] ? '#3ddc97' : '#ff5d6c';
      g.fillRect(pad + i * s - 0.3, pad + j * s - 0.3, s + 0.9, s + 0.9);
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(pad, pad); g.lineTo(pad + L * s, pad + L * s); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    g.strokeRect(pad + sel * s, pad, s, L * s); g.strokeRect(pad, pad + sel * s, L * s, s);
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (let t = 20; t <= L; t += 20) { g.fillText(t, pad + (t - 0.5) * s, pad - 3); g.save(); g.translate(pad - 3, pad + (t - 0.5) * s); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); }
    g.textAlign = 'right'; g.textBaseline = 'top'; g.fillStyle = '#9aa3b8'; g.font = '10px Inter, system-ui, sans-serif';
    g.fillText('true contacts', pad + L * s - 4, pad + 4);
    g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('MSA couplings', pad + 4, pad + L * s - 4);
  }
  function stats() {
    const ps = partners(sel);
    const pTxt = ps.map(([, j]) => `${j + 1}${SEQ[j]}${TRUE_CONTACTS[sel * L + j] ? '✓' : '✗'}`).join(' ');
    $('msaStats').innerHTML = `depth <b>${rows.length}</b> · N<sub>eff</sub> (80% id) <b>${neff.toFixed(0)}</b> · top-L/5 pairs that are true contacts <b>${Math.round(prec5 * 100)}%</b><br>column <b>${sel + 1}${SEQ[sel]}</b> · conservation <b>${cons[sel].toFixed(2)}</b> · partners ${pTxt}`;
  }
  const redraw = () => { drawMsa(); drawMap(); stats(); };
  compute();
  segButtons($('msaDepth'), DEPTHS.map(d => [d, String(d)]), k => { depth = +k; compute(); redraw(); }, depth);
  onPoint(cv, (x, y, kind) => {
    const w = cv.getBoundingClientRect().width, i = clamp(Math.floor((x - 6) / ((w - 12) / L)), 0, L - 1);
    if (i !== sel) { sel = i; redraw(); }
  });
  onPoint(cm, (x, y) => {
    const w = cm.getBoundingClientRect().width, s = (w - 28) / L;
    const j = Math.floor((x - 22) / s), i = Math.floor((y - 22) / s);
    const k = clamp(j >= 0 && j < L ? j : i, 0, L - 1);
    const pick = clamp(i < 0 ? j : i, 0, L - 1);
    if (pick !== sel || k !== sel) { sel = pick; redraw(); }
  });
  watchSize(cv, drawMsa); watchSize(cm, drawMap);
  redraw();
}

// ============================================================================
//  02  embedding: tensor blocks, memory, pair init
// ============================================================================
function initEmbed() {
  const svg = $('tensorSvg'), NS = 'http://www.w3.org/2000/svg';
  const range = $('cropRange');
  function box(parent, x, y, w, h, d, col, labels) {
    // front face w x h at (x, y); depth d goes up-right at 30 degrees.
    const dx = d * 0.87, dy = d * 0.5;
    const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; };
    el('path', { d: `M${x},${y} L${x + dx},${y - dy} L${x + w + dx},${y - dy} L${x + w},${y} Z`, fill: col, 'fill-opacity': 0.32, stroke: col, 'stroke-width': 1 });
    el('path', { d: `M${x + w},${y} L${x + w + dx},${y - dy} L${x + w + dx},${y + h - dy} L${x + w},${y + h} Z`, fill: col, 'fill-opacity': 0.18, stroke: col, 'stroke-width': 1 });
    el('rect', { x, y, width: w, height: h, fill: col, 'fill-opacity': 0.12, stroke: col, 'stroke-width': 1.2 });
    const grid = Math.max(3, Math.min(12, Math.round(w / 14)));
    for (let k = 1; k < grid; k++) el('line', { x1: x + w * k / grid, y1: y, x2: x + w * k / grid, y2: y + h, stroke: col, 'stroke-opacity': 0.18 });
    const t = (tx, ty, s, a = {}) => { const e = el('text', Object.assign({ x: tx, y: ty, fill: '#c3c8d6', 'font-size': 11, 'font-family': 'IBM Plex Mono, ui-monospace, monospace' }, a)); e.textContent = s; };
    t(x + w / 2, y + h + 14, labels[0], { 'text-anchor': 'middle' });
    t(x - 5, y + h / 2, labels[1], { 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    t(x + w + dx + 3, y - dy + (h) / 2, labels[2], { 'text-anchor': 'start', 'dominant-baseline': 'middle' });
    el('text', { x, y: y - dy - 8, fill: '#fff', 'font-size': 12.5, 'font-weight': 600, 'font-family': 'Inter, system-ui, sans-serif' }).textContent = labels[3];
  }
  function draw() {
    const N = +range.value;
    $('cropOut').textContent = N;
    const narrow = svg.getBoundingClientRect().width < 520;
    svg.innerHTML = '';
    const W = narrow ? 360 : 760, H = narrow ? 470 : 260;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const nr = 34 + 64 * Math.log2(N / 32) / 6;          // N_res axis length, log scale
    const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
    if (narrow) {
      box(g, 62, 82, nr * 0.8, 62, 40, '#3fd0c0', [`N_res=${N}`, '512', 'c_m 256', 'MSA m']);
      box(g, 236, 82, nr * 0.6, 92, 20, '#2a8f86', ['N_res', '5120', 'c_e 64', 'extra MSA']);
      box(g, 62, 290, nr * 0.8, nr * 0.8, 36, '#f4a64a', [`N_res=${N}`, 'N_res', 'c_z 128', 'pair z']);
      box(g, 236, 330, nr * 0.6, 14, 50, '#b08cff', ['N_res', '', 'c_s 384', 'single s']);
    } else {
      box(g, 78, 96, nr, 80, 46, '#3fd0c0', [`N_res=${N}`, 'N_clust 512', 'c_m 256', 'MSA representation m']);
      box(g, 316, 96, nr * 0.7, 110, 22, '#2a8f86', ['N_res', 'N_extra 5120', 'c_e 64', 'extra MSA']);
      box(g, 486, 92, nr * 0.95, nr * 0.95, 40, '#f4a64a', [`N_res=${N}`, 'N_res', 'c_z 128', 'pair z']);
      box(g, 640, 176, nr * 0.45, 14, 50, '#b08cff', ['N_res', '', 'c_s 384', 'single s']);
    }
    const f = 4, rows = [
      ['pair z', N * N * 128 * f, '#f4a64a'],
      ['MSA m', 512 * N * 256 * f, '#3fd0c0'],
      ['extra MSA', 5120 * N * 64 * f, '#2a8f86'],
      ['MSA row-attn logits (8 heads)', 512 * 8 * N * N * f, '#3fd0c0'],
      ['triangle-attn logits (4 heads)', 4 * N * N * N * f, '#ff5d6c'],
    ];
    const lo = Math.log10(1e6), hi = Math.log10(4e12);
    $('memBars').innerHTML = rows.map(([lab, b, col]) => `<span class="lab">${lab}</span><span class="bar"><i style="width:${(100 * clamp((Math.log10(b) - lo) / (hi - lo), 0.01, 1)).toFixed(1)}%;background:${col}"></i></span><span class="val">${fmtBytes(b)}</span>`).join('');
  }
  range.addEventListener('input', draw);
  draw(); watchSize(svg, draw);

  // Pair init: a_i + b_j, relpos, sum. One channel.
  const KD = { A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2 };
  const cv = $('pairInitCv');
  function drawInit() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const gap = 22, top = 18, side = Math.min((w - 2 * gap - 8) / 3, h - top - 6), s = side / L;
    const a = i => KD[SEQ[i]] / 4.5, b = j => -0.6 * KD[SEQ[j]] / 4.5;
    const rel = (i, j) => clamp(i - j, -32, 32) / 32;
    const div = v => v >= 0 ? mix([20, 24, 38], [244, 166, 74], clamp(v, 0, 1)) : mix([20, 24, 38], [63, 208, 192], clamp(-v, 0, 1));
    const panels = [[(i, j) => (a(i) + b(j)) / 1.6, 'a_i + b_j'], [rel, 'relpos(i−j)'], [(i, j) => ((a(i) + b(j)) / 1.6 + rel(i, j)) / 1.6, 'z_ij']];
    panels.forEach(([fn, lab], p) => {
      const x0 = 4 + p * (side + gap);
      for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) { g.fillStyle = css(div(fn(i, j))); g.fillRect(x0 + j * s, top + i * s, s + 0.4, s + 0.4); }
      g.fillStyle = '#c3c8d6'; g.font = '10.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(lab, x0, top - 4);
      if (p < 2) { g.fillStyle = '#c3c8d6'; g.font = '600 16px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p === 0 ? '+' : '=', x0 + side + gap / 2, top + side / 2); }
    });
  }
  watchSize(cv, drawInit); drawInit();
}

// ============================================================================
//  03  Evoformer block diagram and op detail
// ============================================================================
const OPS = [
  { id: 'row', name: 'MSA row attention with pair bias', track: 'MSA track', col: '#3fd0c0', eq: 'rowattn',
    dims: [['in', 'm: N_seq × N_res × 256'], ['bias', 'z → Lin → N_res × N_res × 8'], ['heads × c', '8 × 32'], ['gate', 'sigmoid, per channel']],
    text: 'Within each sequence (row), every residue attends to every other residue. The attention logits get a bias read straight from the pair tensor, so the pair track decides which residues talk. This is the pair → MSA bridge.' },
  { id: 'col', name: 'MSA column attention', track: 'MSA track', col: '#3fd0c0', eq: 'colattn',
    dims: [['in', 'm: N_seq × N_res × 256'], ['heads × c', '8 × 32'], ['over', 'sequences s, t at one position i']],
    text: 'At one position, every sequence attends to every other sequence. Information moves between homologs: what the other species have at this column.' },
  { id: 'mtr', name: 'MSA transition', track: 'MSA track', col: '#3fd0c0', eq: 'transition',
    dims: [['in', 'm: N_seq × N_res × 256'], ['hidden', '256 → 1024 → 256'], ['per', 'element, no mixing']],
    text: 'A two-layer MLP applied at each (sequence, residue) on its own.' },
  { id: 'opm', name: 'Outer product mean', track: 'MSA → pair', col: '#e8eaf0', eq: 'opm',
    dims: [['in', 'm → a, b: N_seq × N_res × 32'], ['outer', '32 × 32 = 1024 per (i, j)'], ['out', 'Lin → N_res × N_res × 128']],
    text: 'For each pair of columns i, j, take the outer product of their projections in each sequence and average over sequences. That is a learned, many-channel version of the column co-variation in 01. This is the MSA → pair bridge.' },
  { id: 'tmo', name: 'Triangle update, outgoing edges', track: 'pair track', col: '#f4a64a', eq: 'triout', tri: 'out',
    dims: [['in', 'z: N_res × N_res × 128'], ['hidden c', '128'], ['sum over', 'k: edges i→k and j→k'], ['cost', 'O(N_res³ · c)']],
    text: 'Edge i–j is updated from the two edges that leave i and j toward every third residue k. Multiplicative, gated, no softmax.' },
  { id: 'tmi', name: 'Triangle update, incoming edges', track: 'pair track', col: '#f4a64a', eq: 'triin', tri: 'in',
    dims: [['in', 'z: N_res × N_res × 128'], ['hidden c', '128'], ['sum over', 'k: edges k→i and k→j']],
    text: 'Same, with the edges that arrive at i and j. z is not symmetric, so both directions are needed.' },
  { id: 'tas', name: 'Triangle attention, starting node', track: 'pair track', col: '#f4a64a', eq: 'tristart', tri: 'start',
    dims: [['in', 'z: N_res × N_res × 128'], ['heads × c', '4 × 32'], ['attend', 'edge ij → edges ik'], ['bias', 'from edge jk']],
    text: 'Edge i–j attends over all edges that start at i. The third side of the triangle, j–k, biases the logit.' },
  { id: 'tae', name: 'Triangle attention, ending node', track: 'pair track', col: '#f4a64a', eq: 'triend', tri: 'end',
    dims: [['in', 'z: N_res × N_res × 128'], ['heads × c', '4 × 32'], ['attend', 'edge ij → edges kj'], ['bias', 'from edge ki']],
    text: 'Edge i–j attends over all edges that end at j, with bias from k–i.' },
  { id: 'ptr', name: 'pair transition', track: 'pair track', col: '#f4a64a', eq: 'transition',
    dims: [['in', 'z: N_res × N_res × 128'], ['hidden', '128 → 512 → 128']],
    text: 'A two-layer MLP at each (i, j). Then the block ends; 47 more follow with their own weights. After block 48, s_i = Lin(m_1i) — the first MSA row — goes to the structure module with z.' },
];
let selectTriMode = null;
function initEvo() {
  const svg = $('evoSvg'), NS = 'http://www.w3.org/2000/svg';
  let cur = 0, auto = true, mode = '', tAcc = 0;
  const showOp = k => {
    cur = k; const o = OPS[k];
    $('opTitle').textContent = o.name; $('opTrack').textContent = o.track;
    $('opEq').innerHTML = (window.AfEq && window.AfEq[o.eq]) || '';
    $('opDims').innerHTML = o.dims.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    $('opText').textContent = o.text;
    svg.querySelectorAll('.op').forEach((g, i) => { g.querySelector('rect').setAttribute('stroke-width', i === k ? 2.6 : 1.1); g.querySelector('rect').setAttribute('fill-opacity', i === k ? 0.32 : 0.1); });
  };
  function draw() {
    const narrow = svg.getBoundingClientRect().width < 560;
    const m = narrow ? 'n' : 'w'; if (m === mode) return; mode = m;
    svg.innerHTML = '';
    const el = (n, a, p = svg) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; };
    const defs = el('defs', {});
    const mk = el('marker', { id: 'arr2', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#8a91a5' }, mk);
    let P;
    if (!narrow) {
      svg.setAttribute('viewBox', '0 0 760 250');
      el('rect', { x: 8, y: 22, width: 744, height: 64, rx: 12, fill: '#3fd0c0', 'fill-opacity': 0.05 });
      el('rect', { x: 8, y: 150, width: 744, height: 64, rx: 12, fill: '#f4a64a', 'fill-opacity': 0.05 });
      el('text', { x: 14, y: 16, fill: '#3fd0c0', 'font-size': 11 }).textContent = 'MSA track  m  N_seq × N_res × 256';
      el('text', { x: 14, y: 236, fill: '#f4a64a', 'font-size': 11 }).textContent = 'pair track  z  N_res × N_res × 128';
      P = [[40, 34, 120, 40], [178, 34, 110, 40], [306, 34, 96, 40], [330, 98, 110, 40], [262, 162, 92, 40], [364, 162, 92, 40], [466, 162, 92, 40], [568, 162, 92, 40], [670, 162, 76, 40]];
      el('path', { d: 'M14,54 L38,54', stroke: '#3fd0c0', 'stroke-width': 1.5, 'marker-end': 'url(#arr2)' });
      el('path', { d: 'M14,182 L260,182', stroke: '#f4a64a', 'stroke-width': 1.5, 'marker-end': 'url(#arr2)' });
      el('path', { d: 'M60,182 C60,130 90,110 96,76', stroke: '#f4a64a', 'stroke-width': 1.5, fill: 'none', 'stroke-dasharray': '4 3', 'marker-end': 'url(#arr2)', class: 'flowline' });
      el('text', { x: 70, y: 128, fill: '#f4a64a', 'font-size': 10 }).textContent = 'pair bias';
      el('path', { d: 'M160,54 L176,54 M288,54 L304,54', stroke: '#8a91a5', 'stroke-width': 1.3, 'marker-end': 'url(#arr2)' });
      el('path', { d: 'M402,54 L748,54', stroke: '#3fd0c0', 'stroke-width': 1.5, 'marker-end': 'url(#arr2)' });
      el('text', { x: 700, y: 48, fill: '#3fd0c0', 'font-size': 10, 'text-anchor': 'end' }).textContent = 'to next block';
      el('path', { d: 'M380,74 L384,96', stroke: '#e8eaf0', 'stroke-width': 1.3, 'marker-end': 'url(#arr2)', class: 'flowline' });
      el('path', { d: 'M385,138 C385,150 320,150 310,160', stroke: '#e8eaf0', 'stroke-width': 1.3, fill: 'none', 'marker-end': 'url(#arr2)', class: 'flowline' });
      el('path', { d: 'M354,182 L362,182 M456,182 L464,182 M558,182 L566,182 M660,182 L668,182', stroke: '#8a91a5', 'stroke-width': 1.3, 'marker-end': 'url(#arr2)' });
    } else {
      svg.setAttribute('viewBox', '0 0 360 520');
      el('rect', { x: 6, y: 20, width: 168, height: 230, rx: 12, fill: '#3fd0c0', 'fill-opacity': 0.05 });
      el('rect', { x: 186, y: 20, width: 168, height: 492, rx: 12, fill: '#f4a64a', 'fill-opacity': 0.05 });
      el('text', { x: 10, y: 14, fill: '#3fd0c0', 'font-size': 11 }).textContent = 'MSA track m';
      el('text', { x: 190, y: 14, fill: '#f4a64a', 'font-size': 11 }).textContent = 'pair track z';
      P = [[16, 50, 148, 46], [16, 112, 148, 46], [16, 174, 148, 46], [100, 262, 160, 46], [196, 324, 148, 30], [196, 362, 148, 30], [196, 400, 148, 30], [196, 438, 148, 30], [196, 476, 148, 30]];
      el('path', { d: 'M270,34 C270,60 200,50 166,66', stroke: '#f4a64a', 'stroke-width': 1.4, fill: 'none', 'stroke-dasharray': '4 3', 'marker-end': 'url(#arr2)', class: 'flowline' });
      el('text', { x: 268, y: 60, fill: '#f4a64a', 'font-size': 10 }).textContent = 'pair bias';
      el('path', { d: 'M90,96 L90,110 M90,158 L90,172', stroke: '#8a91a5', 'stroke-width': 1.3, 'marker-end': 'url(#arr2)' });
      el('path', { d: 'M90,220 C90,240 150,240 170,260', stroke: '#e8eaf0', 'stroke-width': 1.3, fill: 'none', 'marker-end': 'url(#arr2)', class: 'flowline' });
      el('path', { d: 'M230,308 L250,322', stroke: '#e8eaf0', 'stroke-width': 1.3, 'marker-end': 'url(#arr2)', class: 'flowline' });
      el('path', { d: 'M40,220 L40,250', stroke: '#3fd0c0', 'stroke-width': 1.4, 'marker-end': 'url(#arr2)' });
      el('text', { x: 46, y: 246, fill: '#3fd0c0', 'font-size': 10 }).textContent = 'to next block';
    }
    OPS.forEach((o, k) => {
      const [x, y, w, h] = P[k];
      const g = el('g', { class: 'op', tabindex: 0, role: 'button' });
      el('rect', { x, y, width: w, height: h, rx: 8, fill: o.col, 'fill-opacity': 0.1, stroke: o.col, 'stroke-width': 1.1 }, g);
      const words = o.name.replace('MSA ', '').replace('Triangle update, ', 'tri. mult. ').replace('Triangle attention, ', 'tri. attn. ').replace(' with pair bias', ' + pair bias').replace('Outer product mean', 'outer product mean');
      const lines = (narrow && h < 40) ? [words] : words.length > 15 ? (() => { const i = words.lastIndexOf(' ', Math.ceil(words.length / 2) + 3); return [words.slice(0, i), words.slice(i + 1)]; })() : [words];
      lines.forEach((ln, q) => { const t = el('text', { x: x + w / 2, y: y + h / 2 + (q - (lines.length - 1) / 2) * 13 + 4, fill: '#fff', 'font-size': 11, 'text-anchor': 'middle' }, g); t.textContent = ln; });
      const pick = () => { auto = false; showOp(k); if (o.tri && selectTriMode) selectTriMode(o.tri); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
    });
    showOp(cur);
  }
  draw(); watchSize(svg, draw);
  let off = 0;
  register(svg, dt => {
    off -= dt * 16; svg.querySelectorAll('.flowline').forEach(p => p.setAttribute('stroke-dashoffset', off.toFixed(1)));
    if (!auto) return;
    tAcc += dt; if (tAcc > 2.6) { tAcc = 0; showOp((cur + 1) % OPS.length); }
  });
}

// ============================================================================
//  03b  triangle explorer
// ============================================================================
function initTri() {
  const cv = $('triCv'), geo = $('triGeo');
  let I = 22, J = 61, mode = 'out', k = 0, playing = true, acc = 0;
  let base = null;
  const MODES = [['out', 'mult · outgoing'], ['in', 'mult · incoming'], ['start', 'attn · starting'], ['end', 'attn · ending']];
  const EQ = { out: 'triout', in: 'triin', start: 'tristart', end: 'triend' };
  const setBtn = segButtons($('triModes'), MODES, m => { mode = m; draw(); }, mode);
  selectTriMode = m => { mode = m; setBtn(m); draw(); };
  const valid = q => q !== I && q !== J;
  // cells for each mode: [values set, bias set] as functions of k -> [row, col]
  const cells = {
    out: [q => [I, q], q => [J, q]], in: [q => [q, I], q => [q, J]],
    start: [q => [I, q], q => [J, q]], end: [q => [q, J], q => [q, I]],
  };
  function makeBase(n) {
    const off = document.createElement('canvas'); off.width = off.height = n;
    const g = off.getContext('2d'), img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = Math.floor(y * L / n), j = Math.floor(x * L / n), c = distColor(DCA[i * L + j]), o = 4 * (y * n + x);
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); return off;
  }
  function draw() {
    const { g, w } = fitCanvas(cv);
    const pad = 22, side = w - pad - 6, s = side / L;
    if (!base) base = makeBase(L * 4);
    g.clearRect(0, 0, w, w);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 0.55; g.drawImage(base, pad, pad, side, side); g.globalAlpha = 1;
    const [A, B] = cells[mode];
    const colA = mode === 'start' || mode === 'end' ? [63, 208, 192] : [244, 166, 74], colB = mode === 'start' || mode === 'end' ? [176, 140, 255] : [244, 166, 74];
    for (let q = 0; q < L; q++) if (valid(q)) {
      const [ra, ca] = A(q), [rb, cb] = B(q);
      g.fillStyle = `rgba(${colA},0.45)`; g.fillRect(pad + ca * s, pad + ra * s, s, s);
      g.fillStyle = `rgba(${colB},0.45)`; g.fillRect(pad + cb * s, pad + rb * s, s, s);
    }
    const [ra, ca] = A(k), [rb, cb] = B(k);
    g.lineWidth = 2; g.strokeStyle = '#fff';
    g.strokeRect(pad + ca * s - 1, pad + ra * s - 1, s + 2, s + 2); g.strokeRect(pad + cb * s - 1, pad + rb * s - 1, s + 2, s + 2);
    g.fillStyle = '#fff'; g.fillRect(pad + J * s - 1, pad + I * s - 1, s + 2, s + 2);
    g.strokeStyle = '#ff5d6c'; g.lineWidth = 2; g.beginPath(); g.arc(pad + (J + 0.5) * s, pad + (I + 0.5) * s, Math.max(6, s * 2.2), 0, 6.283); g.stroke();
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (let t = 20; t <= L; t += 20) { g.fillText(t, pad + (t - 0.5) * s, pad - 3); g.save(); g.translate(pad - 3, pad + (t - 0.5) * s); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); }
    g.textAlign = 'left'; g.fillStyle = '#c3c8d6'; g.textBaseline = 'top'; g.font = '10px Inter, sans-serif';
    g.fillText('j →', pad + side - 22, 4); g.save(); g.translate(4, pad + side - 4); g.rotate(-Math.PI / 2); g.fillText('i →', 0, 0); g.restore();
    drawGeo();
    $('triEq').innerHTML = (window.AfEq && window.AfEq[EQ[mode]]) || '';
  }
  function drawGeo() {
    const { g, w, h } = fitCanvas(geo);
    g.clearRect(0, 0, w, h);
    const dij = DCA[I * L + J], dik = DCA[I * L + k], djk = DCA[J * L + k];
    // triangle: i at left, j at right, k placed by the law of cosines
    const narrow = w < 480 || h > w * 0.6;
    const tw = narrow ? w - 36 : Math.min(w * 0.5, h * 1.05), x0 = 18, yb = narrow ? h * 0.5 : h * 0.62;
    const sc = Math.min((tw - 30) / Math.max(dij, dik, djk, 1), (yb - 16) / Math.max(dik, djk, 1));
    const pi = [x0, yb], pj = [x0 + dij * sc, yb];
    const cx = (dik * dik - djk * djk + dij * dij) / (2 * dij || 1), cy = Math.sqrt(Math.max(0, dik * dik - cx * cx));
    const pk = [x0 + cx * sc, yb - cy * sc];
    const edge = (a, b, c, wd, lab) => {
      g.strokeStyle = c; g.lineWidth = wd; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      g.fillStyle = c; g.font = '10.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
      let nx = dy / n, ny = -dx / n; if (ny > 0 || (ny === 0 && a[1] === b[1])) { nx = -nx; ny = -ny; }
      if (a[1] === b[1]) { nx = 0; ny = 1; }
      g.fillText(lab, mx + nx * 13, my + ny * 13);
    };
    const vc = mode === 'start' || mode === 'end' ? '#3fd0c0' : '#f4a64a', bc = mode === 'start' || mode === 'end' ? '#b08cff' : '#f4a64a';
    edge(pi, pj, '#ff5d6c', 2.4, dij.toFixed(1) + ' Å');
    edge(pi, pk, vc, 1.8, dik.toFixed(1)); edge(pj, pk, bc, 1.8, djk.toFixed(1));
    const node = (p, t) => { g.fillStyle = '#0a0c13'; g.strokeStyle = '#fff'; g.lineWidth = 1.3; g.beginPath(); g.arc(p[0], p[1], 10, 0, 6.283); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = '600 10px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, p[0], p[1] + 0.5); };
    node(pi, 'i'); node(pj, 'j'); node(pk, 'k');
    // bound bar
    let lo = 0, hi = Infinity;
    for (let q = 0; q <= k; q++) if (valid(q)) { lo = Math.max(lo, Math.abs(DCA[I * L + q] - DCA[J * L + q])); hi = Math.min(hi, DCA[I * L + q] + DCA[J * L + q]); }
    const bx = narrow ? 18 : Math.max(tw + 30, w * 0.52), bw = w - bx - 14, maxD = 50, X = d => bx + clamp(d / maxD, 0, 1) * bw;
    const by = narrow ? yb + 58 : h * 0.36;
    g.fillStyle = '#c3c8d6'; g.font = '10.5px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText('bound on d_ij from k ≤ ' + (k + 1), bx, by - 14);
    g.fillStyle = '#1a2030'; g.fillRect(bx, by - 8, bw, 16);
    if (hi < Infinity) { g.fillStyle = 'rgba(244,166,74,0.55)'; g.fillRect(X(lo), by - 8, Math.max(2, X(hi) - X(lo)), 16); }
    const l1 = Math.abs(dik - djk), h1 = dik + djk;
    if (valid(k)) { g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1; g.strokeRect(X(l1), by + 12, Math.max(1, X(h1) - X(l1)), 6); }
    g.strokeStyle = '#ff5d6c'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(dij), by - 13); g.lineTo(X(dij), by + 22); g.stroke();
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textBaseline = 'top'; g.textAlign = 'center';
    for (let d = 0; d <= maxD; d += 10) g.fillText(d, X(d), by + 26);
    g.textAlign = 'left'; g.fillStyle = '#c3c8d6';
    if (narrow) {
      g.fillText(`width ${(hi < Infinity ? hi - lo : 0).toFixed(1)} Å`, bx, by + 40);
      g.fillStyle = '#ff5d6c'; g.textAlign = 'right'; g.fillText('true ' + dij.toFixed(1) + ' Å', bx + bw, by + 40);
    } else {
      g.fillText(`width ${(hi < Infinity ? hi - lo : 0).toFixed(1)} Å`, bx, by + 42);
      g.fillStyle = '#ff5d6c'; g.fillText('true ' + dij.toFixed(1) + ' Å', bx, by + 56);
    }
    $('triRead').innerHTML = `i=<b>${I + 1}</b> j=<b>${J + 1}</b> k=<b>${k + 1}</b> · bound [${lo.toFixed(1)}, ${hi < Infinity ? hi.toFixed(1) : '∞'}] Å`;
  }
  const play = $('triPlay');
  const setPlay = p => { playing = p; play.textContent = p ? '❚❚ pause' : '▶ sweep k'; };
  play.addEventListener('click', () => { if (!playing && k >= L - 1) k = 0; setPlay(!playing); });
  onPoint(cv, (x, y, kind) => {
    const w = cv.getBoundingClientRect().width, s = (w - 28) / L;
    const j = clamp(Math.floor((x - 22) / s), 0, L - 1), i = clamp(Math.floor((y - 22) / s), 0, L - 1);
    if (i === j) return;
    if (i !== I || j !== J) { I = i; J = j; k = 0; if (kind !== 'hover') setPlay(true); draw(); }
  });
  watchSize(cv, () => { draw(); }); watchSize(geo, drawGeo);
  setPlay(true); draw();
  register(cv, dt => {
    if (!playing) return;
    acc += dt * 28;
    if (acc >= 1) { const n = Math.floor(acc); acc -= n; k = Math.min(L - 1, k + n); draw(); if (k >= L - 1) setPlay(false); }
  });
}

// ============================================================================
//  04  structure module
// ============================================================================
const FQ = FRAMES.map(F => G.quatFromR(F.R));
const R0 = rng(7);
const JIT = FRAMES.map(() => G.unit([gauss(R0), gauss(R0), gauss(R0)]));
const DELAY = FRAMES.map((_, i) => (PL[i] < 70 ? 0.18 : 0) + 0.12 * R0());
// Illustrative frame at fractional layer lam in [0, 8]. Final = real frame.
function frameAt(i, lam) {
  const s = lam / 8, p = smooth(clamp((s - DELAY[i]) / (1 - DELAY[i]), 0, 1));
  if (lam <= 0) return { R: G.I3, t: [0, 0, 0] };
  const pr = smooth(clamp(p * 1.35, 0, 1));
  const R = G.RfromQuat(G.slerp([1, 0, 0, 0], FQ[i], pr));
  const t = G.add(G.scl(FRAMES[i].t, p), G.scl(JIT[i], 5 * Math.sin(Math.PI * p) * (1 - p * 0.4)));
  return { R, t };
}
function initStruct() {
  const cv = $('smCv');
  let lam = 8, playing = false, show = { frames: true, trace: true, atoms: false };
  const view = new View3D(cv, { radius: CORE_R * 0.95, yaw: 0.9, pitch: -0.3, spin: 0.15, build(add) {
    const F = FRAMES.map((_, i) => frameAt(i, lam));
    if (show.trace) for (let i = 0; i < L - 1; i++) add.seg(F[i].t, F[i + 1].t, rainbow(i), lam < 1 ? 0.25 : 0.55);
    if (show.atoms && lam > 6.5) {
      const a = clamp((lam - 6.5) / 1.5, 0, 1);
      for (const at of ATOMS) if (!at.ca) add.dot(G.apply(F[at.res], at.loc), mix([10, 12, 19], ELEM_COL[at.el], a), 0.45);
    }
    for (let i = 0; i < L; i++) {
      add.dot(F[i].t, rainbow(i), show.frames ? 0.42 : 0.6, i);
      if (show.frames) {
        const R = F[i].R, o = F[i].t, len = 2.4;
        add.line(o, G.add(o, [R[0] * len, R[3] * len, R[6] * len]), '#ff6b6b', 1.1);
        add.line(o, G.add(o, [R[1] * len, R[4] * len, R[7] * len]), '#5be08a', 1.1);
        add.line(o, G.add(o, [R[2] * len, R[5] * len, R[8] * len]), '#6aa8ff', 1.1);
      }
    }
  } });
  const slider = $('smLayer'), out = $('smOut'), play = $('smPlay');
  const set = v => { lam = v; slider.value = v; out.textContent = v.toFixed(1); view.dirty = true; };
  slider.addEventListener('input', () => { setPlay(false); set(+slider.value); });
  const setPlay = p => { playing = p; play.textContent = p ? '❚❚ pause' : '▶ play'; };
  play.addEventListener('click', () => { if (!playing && lam >= 8) set(0); setPlay(!playing); });
  segButtons($('smToggles'), [['frames', 'frames'], ['trace', 'Cα trace'], ['atoms', 'all atoms']], k => {
    show[k] = !show[k];
    $('smToggles').querySelectorAll('button').forEach(b => b.classList.toggle('on', show[b.dataset.key]));
    view.dirty = true;
  }, null);
  $('smToggles').querySelectorAll('button').forEach(b => b.classList.toggle('on', show[b.dataset.key]));
  let hold = 0;
  register(cv, dt => {
    if (playing) {
      if (lam >= 8) { hold += dt; if (hold > 1.5) { hold = 0; set(0); } }
      else set(Math.min(8, lam + dt * 1.6));
    }
    view.tick(dt);
  });
  // Start playing the first time the card comes on screen.
  new IntersectionObserver((es, ob) => es.forEach(e => { if (e.isIntersecting) { set(0); setPlay(true); ob.disconnect(); } }), { threshold: 0.4 }).observe(cv);
}

function initIpa() {
  const cv = $('ipaCv'), strip = $('ipaStrip'), range = $('ipaRot');
  let theta = 0, I = 49;
  const axis = G.unit([1, 1, 0.3]);
  const QP = [[2, 0, 0], [0, 2, 0], [0, 0, 2], [1.5, 1.5, 0]];   // toy local points
  const KP = [[1.8, 0.4, 0], [0, 1.6, 0.6], [0.5, 0, 2], [1, 1, 1]];
  const Tg = th => ({ R: G.rotAxis(axis, th * Math.PI / 180), t: [th / 360 * 14, -th / 360 * 8, th / 360 * 5] });
  const moved = () => { const T = Tg(theta); return FRAMES.map(F => G.compose(T, F)); };
  const softmax = v => { const m = Math.max(...v), e = v.map(x => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); };
  const ipaRow = F => softmax(F.map((Fj, j) => { let d = 0; for (let p = 0; p < 4; p++) { const a = G.apply(F[I], QP[p]), b = G.apply(Fj, KP[p]); d += G.dot(G.sub(a, b), G.sub(a, b)); } return -0.004 * d; }));
  const naiveRow = F => softmax(F.map(Fj => Fj.t[0] / 7));
  let ref = null;
  const view = new View3D(cv, { radius: CORE_R * 1.3, spin: 0, yaw: 0.5, pitch: -0.2, onPick: id => { if (id != null) { I = id; ref = null; update(); } }, build(add) {
    const F = moved();
    for (let i = 0; i < L - 1; i++) add.seg(F[i].t, F[i + 1].t, i === I ? [255, 255, 255] : rainbow(i), 0.5);
    for (let i = 0; i < L; i++) add.dot(F[i].t, rainbow(i), i === I ? 1.1 : 0.45, i);
    for (const q of QP) add.line(F[I].t, G.apply(F[I], q), '#ffffff', 1.4);
  } });
  function drawStrip(a, b) {
    const { g, w, h } = fitCanvas(strip);
    g.clearRect(0, 0, w, h);
    const s = w / L, rowH = (h - 40) / 2;
    const rows = [[a, 'IPA point term  softmax_j', '#3ddc97'], [b, 'naive: softmax_j(x_j · u)', '#ff5d6c']];
    rows.forEach(([v, lab, col], r) => {
      const y0 = 14 + r * (rowH + 24), mx = Math.max(...v);
      g.fillStyle = '#c3c8d6'; g.font = '10px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(lab, 0, y0 - 1);
      g.fillStyle = '#0a0c13'; g.fillRect(0, y0, w, rowH);
      const c = hex(col);
      for (let j = 0; j < L; j++) { const t = v[j] / mx; g.fillStyle = `rgba(${c},${0.15 + 0.85 * t})`; g.fillRect(j * s, y0 + rowH * (1 - t), Math.max(1, s - 0.5), rowH * t); }
      g.fillStyle = '#fff'; g.fillRect(I * s, y0, Math.max(1, s), 2);
    });
  }
  function update() {
    const F = moved();
    const a = ipaRow(F), b = naiveRow(F);
    if (!ref) { const F0 = FRAMES; ref = [ipaRow(F0), naiveRow(F0)]; }
    let da = 0, db = 0; for (let j = 0; j < L; j++) { da = Math.max(da, Math.abs(a[j] - ref[0][j])); db = Math.max(db, Math.abs(b[j] - ref[1][j])); }
    drawStrip(a, b);
    $('ipaRes').textContent = (I + 1) + SEQ[I];
    $('ipaRead').innerHTML = `query residue <b>${I + 1}${SEQ[I]}</b> · max change vs 0°: IPA <b>${da.toExponential(1)}</b> · naive <b>${db.toFixed(3)}</b>`;
    view.dirty = true;
  }
  range.addEventListener('input', () => { theta = +range.value; $('ipaOut').textContent = theta + '°'; update(); });
  onPoint(strip, (x) => { const w = strip.getBoundingClientRect().width, j = clamp(Math.floor(x / (w / L)), 0, L - 1); if (j !== I) { I = j; ref = null; update(); } });
  watchSize(strip, update);
  update();
  register(cv, dt => view.tick(dt));
}

function initRama() {
  const cv = $('ramaCv');
  const pts = [];
  for (let i = 1; i < L - 1; i++) pts.push({ i, phi: G.dihedral(CC[i - 1], NN[i], CA[i], CC[i]), psi: G.dihedral(NN[i], CA[i], CC[i], NN[i + 1]) });
  let sel = pts.find(p => p.i === 40) || pts[0];
  function draw() {
    const { g, w } = fitCanvas(cv);
    const pad = 30, s = w - pad - 8, X = phi => pad + (phi + 180) / 360 * s, Y = psi => 6 + (180 - psi) / 360 * s;
    g.clearRect(0, 0, w, w);
    $('ramaRead').innerHTML = `residue <b>${sel.i + 1}${SEQ[sel.i]}</b> · φ <b>${sel.phi.toFixed(0)}°</b> ψ <b>${sel.psi.toFixed(0)}°</b> · pLDDT <b>${PL[sel.i].toFixed(1)}</b>`;
    if (s < 40) return;   // no layout yet: a negative basin radius makes ellipse() throw
    g.fillStyle = '#0a0c13'; g.fillRect(pad, 6, s, s);
    // approximate basins (illustrative outlines)
    const basin = (phi, psi, rx, ry, lab) => { g.fillStyle = 'rgba(176,140,255,0.10)'; g.strokeStyle = 'rgba(176,140,255,0.35)'; g.beginPath(); g.ellipse(X(phi), Y(psi), rx / 360 * s, ry / 360 * s, 0, 0, 6.283); g.fill(); g.stroke(); g.fillStyle = '#b08cff'; g.font = '11px STIX Two Text, serif'; g.textAlign = 'center'; g.fillText(lab, X(phi), Y(psi) - ry / 360 * s - 4); };
    basin(-65, -40, 50, 50, 'α helix'); basin(-115, 135, 75, 60, 'β strand'); basin(60, 45, 30, 35, 'αL');
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let a = -180; a <= 180; a += 90) { g.beginPath(); g.moveTo(X(a), 6); g.lineTo(X(a), 6 + s); g.moveTo(pad, Y(a)); g.lineTo(pad + s, Y(a)); g.stroke(); }
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    for (let a = -180; a <= 180; a += 90) g.fillText(a, X(a), 6 + s + 2);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let a = -180; a <= 180; a += 90) g.fillText(a, pad - 3, Y(a));
    g.save(); g.translate(pad + s / 2, 6 + s - 12); g.fillStyle = '#c3c8d6'; g.textAlign = 'center'; g.font = '11px STIX Two Text, serif'; g.fillText('φ', 0, 0); g.restore();
    g.save(); g.translate(pad + 10, 16); g.fillStyle = '#c3c8d6'; g.font = '11px STIX Two Text, serif'; g.fillText('ψ', 0, 0); g.restore();
    for (const p of pts) { g.fillStyle = css(plddtColor(PL[p.i])); g.beginPath(); g.arc(X(p.phi), Y(p.psi), 3.2, 0, 6.283); g.fill(); }
    g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath(); g.arc(X(sel.phi), Y(sel.psi), 7, 0, 6.283); g.stroke();
  }
  onPoint(cv, (x, y) => {
    const w = cv.getBoundingClientRect().width, pad = 30, s = w - pad - 8;
    const phi = (x - pad) / s * 360 - 180, psi = 180 - (y - 6) / s * 360;
    let best = sel, bd = Infinity;
    for (const p of pts) { const d = (p.phi - phi) ** 2 + (p.psi - psi) ** 2; if (d < bd) { bd = d; best = p; } }
    if (best !== sel) { sel = best; draw(); }
  });
  watchSize(cv, draw); draw();
}

// ============================================================================
//  05  recycling and FAPE
// ============================================================================
function initRecycle() {
  const cv = $('recCv'), range = $('recRange');
  const R = rng(99);
  const noise = new Float32Array(L * L).map(() => gauss(R));
  const blur = (src, r) => {
    if (r < 0.5) return src.slice();
    const out = new Float32Array(L * L), rr = Math.round(r);
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
      let s = 0, n = 0;
      for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < L && y < L) { s += src[x * L + y]; n++; } }
      out[i * L + j] = s / n;
    }
    return out;
  };
  const sn = blur(noise, 2);
  const maps = [[5, 5], [3, 2.6], [1.5, 1.2], [0, 0.4]].map(([r, a]) => { const b = blur(DCB, r); return b.map((v, k) => Math.max(2, v + a * sn[k] * 2)); });
  let c = 0;
  function draw() {
    const { g, w } = fitCanvas(cv);
    const pad = 22, side = w - pad - 6, s = side / L;
    const k = Math.min(2, Math.floor(c)), t = c - k, A = maps[k], B = maps[Math.min(3, k + 1)];
    let err = 0;
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
      const v = lerp(A[i * L + j], B[i * L + j], t); err += (v - DCB[i * L + j]) ** 2;
      g.fillStyle = css(distColor(v)); g.fillRect(pad + j * s, pad + i * s, s + 0.4, s + 0.4);
    }
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (let q = 20; q <= L; q += 20) g.fillText(q, pad + (q - 0.5) * s, pad - 3);
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#fff'; g.font = '600 11px Inter, sans-serif';
    g.fillText(c < 0.05 ? 'pass 1 (no recycling)' : `after recycle ${c.toFixed(1)}`, pad + 6, pad + 6);
    $('recOut').textContent = c.toFixed(1);
    return Math.sqrt(err / (L * L));
  }
  range.addEventListener('input', () => { c = +range.value; draw(); });
  watchSize(cv, draw); draw();
}

function initFape() {
  const cv = $('fapeCv');
  let mode = 'bend', theta = 30;
  const HINGE = 71;
  const truthX = CA;
  function perturbed() {
    const f = p => {
      if (mode === 'copy') return p;
      if (mode === 'move') return G.add(G.mv(G.rotAxis([0.3, 1, 0.2], 1.1), p), [9, -4, 6]);
      if (mode === 'mirror') return [-p[0], p[1], p[2]];
      return p;
    };
    let n = NN.map(f), a = CA.map(f), c = CC.map(f);
    if (mode === 'bend') {
      const piv = CA[HINGE], R = G.rotAxis(G.unit(G.sub(CA[HINGE + 1], CA[HINGE - 1])), theta * Math.PI / 180);
      const rot = (p, i) => i > HINGE ? G.add(G.mv(R, G.sub(p, piv)), piv) : p;
      n = n.map(rot); a = a.map(rot); c = c.map(rot);
    }
    return { F: a.map((_, i) => G.frameFrom3(n[i], a[i], c[i])), X: a };
  }
  let P = perturbed();
  const view = new View3D(cv, { radius: CORE_R * 1.2, spin: 0.1, yaw: 0.4, pitch: -0.2, build(add) {
    for (let i = 0; i < L - 1; i++) add.seg(truthX[i], truthX[i + 1], [95, 105, 130], 0.4);
    for (let i = 0; i < L - 1; i++) add.seg(P.X[i], P.X[i + 1], i >= HINGE && mode === 'bend' ? [255, 93, 108] : [244, 166, 74], 0.55);
  } });
  function update() {
    P = perturbed();
    const fa = G.fape(P.F, P.X, FRAMES, truthX), dr = G.drmsd(P.X, truthX);
    $('fapeRead').innerHTML = `<dt>FAPE (Cα, clamp 10 Å)</dt><dd><b>${fa.toFixed(2)} Å</b> → loss ${(fa / 10).toFixed(3)}</dd>
      <dt>distance-matrix error</dt><dd>${dr.toFixed(2)} Å</dd>
      <dt>sees the change?</dt><dd>FAPE ${fa > 0.05 ? '<b>yes</b>' : 'no'} · distances ${dr > 0.05 ? '<b>yes</b>' : 'no'}</dd>`;
    view.dirty = true;
  }
  segButtons($('fapeModes'), [['copy', 'exact copy'], ['move', 'rotate + move all'], ['mirror', 'mirror image'], ['bend', 'bend the C-term']], k => { mode = k; update(); }, mode);
  $('fapeBend').addEventListener('input', e => { theta = +e.target.value; $('fapeOut').textContent = theta + '°'; if (mode !== 'bend') { mode = 'bend'; $('fapeModes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.key === 'bend')); } update(); });
  update();
  register(cv, dt => view.tick(dt));
}

// ============================================================================
//  06  outputs: pLDDT, PAE, 3D
// ============================================================================
function initOutputs() {
  const cv = $('outCv'), bars = $('plddtCv'), pae = $('paeCv');
  const mean = PL.reduce((a, b) => a + b, 0) / L;
  $('meanPl').textContent = mean.toFixed(1);
  let color = 'plddt', selI = null, selJ = null;
  const PAE = PROT.pae;
  const resCol = i => color === 'rainbow' ? rainbow(i) : plddtColor(PL[i]);
  const view = new View3D(cv, { radius: CORE_R * 1.15, spin: 0.14, yaw: 0.8, pitch: -0.2,
    onPick: id => { if (id != null) { selI = id; selJ = null; refresh(); } },
    build(add) {
      if (color === 'atoms') {
        for (const a of ATOMS) add.dot(a.p, mix(plddtColor(PL[a.res]), ELEM_COL[a.el], a.el === 0 ? 0 : 0.35), a.ca ? 0.75 : 0.62, a.res);
      } else {
        for (let i = 0; i < L - 1; i++) add.seg(CA[i], CA[i + 1], resCol(i), 1.0, i);
      }
      for (const [r, c] of [[selI, '#ffffff'], [selJ, '#ff5d6c']]) if (r != null) add.dot(CA[r], hex(c), 1.6, r);
    } });
  segButtons($('outColor'), [['plddt', 'pLDDT'], ['rainbow', 'N → C'], ['atoms', 'all atoms']], k => { color = k; view.dirty = true; }, color);
  function drawBars() {
    const { g, w, h } = fitCanvas(bars);
    g.clearRect(0, 0, w, h);
    const padL = 26, padB = 16, s = (w - padL - 4) / L, Y = v => 4 + (1 - v / 100) * (h - padB - 4);
    for (const [lo, hi, c] of [[90, 100, '#0053d6'], [70, 90, '#65cbf3'], [50, 70, '#ffdb13'], [0, 50, '#ff7d45']]) { g.fillStyle = c; g.globalAlpha = 0.07; g.fillRect(padL, Y(hi), w - padL - 4, Y(lo) - Y(hi)); }
    g.globalAlpha = 1;
    for (let i = 0; i < L; i++) { g.fillStyle = css(plddtColor(PL[i])); g.fillRect(padL + i * s + 0.3, Y(PL[i]), Math.max(1, s - 0.6), Y(0) - Y(PL[i])); }
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of [50, 70, 90]) { g.fillText(v, padL - 4, Y(v)); g.strokeStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - 4, Y(v)); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let t = 10; t <= L; t += 10) g.fillText(t, padL + (t - 0.5) * s, h - padB + 3);
    for (const [r, c] of [[selI, '#fff'], [selJ, '#ff5d6c']]) if (r != null) { g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect(padL + r * s - 0.5, 3, s + 1, Y(0) - 2); }
  }
  let paeImg = null;
  function drawPae() {
    const { g, w } = fitCanvas(pae);
    const pad = 24, side = w - pad - 6, s = side / L;
    if (!paeImg) {
      paeImg = document.createElement('canvas'); paeImg.width = paeImg.height = L;
      const c2 = paeImg.getContext('2d'), img = c2.createImageData(L, L);
      for (let k = 0; k < L * L; k++) { const c = ramp(PAE_RAMP, PAE[k] / 31.75); img.data.set([c[0], c[1], c[2], 255], 4 * k); }
      c2.putImageData(img, 0, 0);
    }
    g.clearRect(0, 0, w, w);
    g.imageSmoothingEnabled = false; g.drawImage(paeImg, pad, pad, side, side);
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (let t = 20; t <= L; t += 20) { g.fillText(t, pad + (t - 0.5) * s, pad - 3); g.save(); g.translate(pad - 3, pad + (t - 0.5) * s); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); }
    g.font = '10px Inter, sans-serif'; g.fillStyle = '#c3c8d6'; g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillText('scored residue j →', pad + side - 2, 2);
    g.save(); g.translate(2, pad + side); g.rotate(-Math.PI / 2); g.textAlign = 'left'; g.fillText('aligned on residue i →', 0, 0); g.restore();
    if (selI != null && selJ != null) {
      g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.strokeRect(pad, pad + selI * s, side, s); g.strokeRect(pad + selJ * s, pad, s, side);
      g.strokeStyle = '#ff5d6c'; g.lineWidth = 2; g.strokeRect(pad + selJ * s - 2, pad + selI * s - 2, s + 4, s + 4);
    }
  }
  function refresh() {
    drawBars(); drawPae(); view.dirty = true;
    if (selI != null && selJ != null) {
      $('paeRead').innerHTML = `aligned on <b>${selI + 1}${SEQ[selI]}</b> (pLDDT ${PL[selI].toFixed(0)}), error at <b>${selJ + 1}${SEQ[selJ]}</b> (pLDDT ${PL[selJ].toFixed(0)}): <b>${PAE[selI * L + selJ]} Å</b> · reverse ${PAE[selJ * L + selI]} Å`;
    }
    const r = selI ?? 40;
    $('plRead').innerHTML = `residue <b>${r + 1}${SEQ[r]}</b> · pLDDT <b>${PL[r].toFixed(1)}</b> · ${PL[r] > 90 ? 'very high' : PL[r] > 70 ? 'confident' : PL[r] > 50 ? 'low' : 'very low'} · mean over chain ${mean.toFixed(1)} · residues &lt; 50: ${PL.filter(v => v < 50).length}`;
  }
  onPoint(pae, (x, y) => {
    const w = pae.getBoundingClientRect().width, s = (w - 30) / L;
    const j = Math.floor((x - 24) / s), i = Math.floor((y - 24) / s);
    if (i < 0 || j < 0 || i >= L || j >= L) return;
    if (i !== selI || j !== selJ) { selI = i; selJ = j; refresh(); }
  });
  onPoint(bars, x => {
    const w = bars.getBoundingClientRect().width, i = clamp(Math.floor((x - 26) / ((w - 30) / L)), 0, L - 1);
    if (i !== selI || selJ != null) { selI = i; selJ = null; refresh(); }
  });
  selI = 5; selJ = 60;
  watchSize(bars, drawBars); watchSize(pae, drawPae);
  refresh();
  register(cv, dt => view.tick(dt));
}

// ============================================================================
//  07  AF3 diffusion (illustrative)
// ============================================================================
function initDiffusion() {
  const cv = $('difCv'), sched = $('difSched'), range = $('difRange');
  const STEPS = 200, SMAX = 40, SMIN = 0.05, RHO = 7;
  const sigma = t => Math.pow(Math.pow(SMAX, 1 / RHO) + t / STEPS * (Math.pow(SMIN, 1 / RHO) - Math.pow(SMAX, 1 / RHO)), RHO);
  const R = rng(3);
  const EPS = ATOMS.map(() => [gauss(R), gauss(R), gauss(R)]);
  let step = STEPS, playing = false;
  const view = new View3D(cv, { radius: CORE_R * 1.1, spin: 0.12, yaw: 0.3, pitch: -0.2, build(add) {
    const sg = sigma(step);
    ATOMS.forEach((a, k) => add.dot(G.add(a.p, G.scl(EPS[k], sg)), ELEM_COL[a.el], a.ca ? 0.75 : 0.55));
  } });
  function drawSched() {
    const { g, w, h } = fitCanvas(sched);
    g.clearRect(0, 0, w, h);
    const pad = 30, X = t => pad + t / STEPS * (w - pad - 8), Y = s => 6 + (1 - (Math.log10(s) - Math.log10(SMIN)) / (Math.log10(SMAX) - Math.log10(SMIN))) * (h - 22);
    g.strokeStyle = '#b08cff'; g.lineWidth = 1.5; g.beginPath();
    for (let t = 0; t <= STEPS; t++) { const x = X(t), y = Y(sigma(t)); t ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(step), Y(sigma(step)), 4, 0, 6.283); g.fill();
    g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText('σ', pad - 18, h / 2); g.fillText(SMAX, pad - 3, Y(SMAX)); g.fillText(SMIN, pad - 3, Y(SMIN));
    g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText('step', X(STEPS / 2), h - 1);
    $('difOut').textContent = step;
  }
  const set = v => { step = v; range.value = v; drawSched(); view.dirty = true; };
  range.addEventListener('input', () => { setPlay(false); set(+range.value); });
  const play = $('difPlay');
  const setPlay = p => { playing = p; play.textContent = p ? '❚❚ pause' : '▶ sample'; };
  play.addEventListener('click', () => { if (!playing && step >= STEPS) set(0); setPlay(!playing); });
  onPoint(sched, (x, y, kind) => { if (kind === 'hover') return; const w = sched.getBoundingClientRect().width; setPlay(false); set(Math.round(clamp((x - 30) / (w - 38), 0, 1) * STEPS)); });
  watchSize(sched, drawSched); drawSched();
  let acc = 0, hold = 0;
  register(cv, dt => {
    if (playing) {
      if (step >= STEPS) { hold += dt; if (hold > 1.6) { hold = 0; set(0); } }
      else { acc += dt * 45; if (acc >= 1) { const n = Math.floor(acc); acc -= n; set(Math.min(STEPS, step + n)); } }
    }
    view.tick(dt);
  });
  new IntersectionObserver((es, ob) => es.forEach(e => { if (e.isIntersecting) { set(0); setPlay(true); ob.disconnect(); } }), { threshold: 0.4 }).observe(cv);
}

// ============================================================================
//  08  limits
// ============================================================================
function initLimits() {
  const cv = $('limMsaCv');
  function draw() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const cols = 40, rows = 22, cw = w / cols, rh = (h - 18) / rows, mut = 22;
    for (let s = 0; s < rows; s++) for (let i = 0; i < cols; i++) {
      const a = PROT.msa[s * 20][30 + i];
      if (a === '-') continue;
      const c = AA_COL[a] || [100, 100, 100];
      g.fillStyle = s === 0 && i === mut ? '#ff5d6c' : `rgba(${c},${s === 0 ? 0.95 : 0.4})`;
      g.fillRect(i * cw, 18 + s * rh, cw - 0.6, rh - 0.6);
    }
    g.strokeStyle = '#ff5d6c'; g.lineWidth = 1.5; g.strokeRect(mut * cw - 1, 17, cw + 1, rh + 1);
    g.fillStyle = '#c3c8d6'; g.font = '10px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText('query: one letter changed', 0, 2);
    g.textAlign = 'right'; g.fillText('MSA rows: unchanged', w, 2);
  }
  watchSize(cv, draw); draw();
}

// Shrink a formula that is wider than its box, down to 11 px. If it is still
// too wide, its box scrolls (CSS), never the page.
function fitEq() {
  document.querySelectorAll('.eq').forEach(box => {
    const svg = box.querySelector('svg'); if (!svg) return;
    svg.style.fontSize = '15px';
    const need = svg.getBoundingClientRect().width, have = box.clientWidth - 16;
    if (need > have && need > 0) svg.style.fontSize = Math.max(11, 15 * have / need).toFixed(2) + 'px';
  });
}
function initEqFit() {
  fitEq();
  let t = 0; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fitEq, 120); });
  // The op card swaps its formula; fit again after each swap.
  new MutationObserver(fitEq).observe($('opEq'), { childList: true });
  new MutationObserver(fitEq).observe($('triEq'), { childList: true });
}

// Contact precision against MSA depth, on the synthetic MSA. Computed once,
// when the card first comes near the screen.
function initDepthChart() {
  const cv = $('limDepthCv');
  const DEPTHS = [4, 8, 16, 32, 64, 128, 256, 512];
  let pts = null;
  function compute() {
    pts = DEPTHS.map(n => {
      const rows = [PROT.msa[0]], step = (PROT.msa.length - 1) / (n - 1);
      for (let k = 0; k < n - 1; k++) rows.push(PROT.msa[1 + Math.floor(k * step)]);
      const enc = encode(rows), C = couplings(enc);
      return [n, topPairs(C, L, Math.round(L / 5), TRUE_CONTACTS).precision, weights(enc).reduce((a, b) => a + b, 0)];
    });
  }
  function draw() {
    const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    if (!pts) return;
    const pl = 30, pr = 10, pt = 16, pb = 22;
    const X = n => pl + Math.log2(n / 4) / 7 * (w - pl - pr), Y = p => pt + (1 - p) * (h - pt - pb);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.fillStyle = '#8a91a5'; g.font = '9.5px IBM Plex Mono, ui-monospace, monospace';
    for (const p of [0, 0.5, 1]) { g.beginPath(); g.moveTo(pl, Y(p)); g.lineTo(w - pr, Y(p)); g.stroke(); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(Math.round(p * 100) + '%', pl - 4, Y(p)); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const [n] of pts) g.fillText(n, X(n), h - pb + 4);
    g.strokeStyle = '#3fd0c0'; g.lineWidth = 2; g.beginPath();
    pts.forEach(([n, p], k) => k ? g.lineTo(X(n), Y(p)) : g.moveTo(X(n), Y(p))); g.stroke();
    for (const [n, p] of pts) { g.fillStyle = '#3fd0c0'; g.beginPath(); g.arc(X(n), Y(p), 3, 0, 6.283); g.fill(); }
    g.fillStyle = '#c3c8d6'; g.font = '10px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('top-L/5 contact precision vs MSA rows (synthetic)', pl, 1);
  }
  new IntersectionObserver((es, ob) => es.forEach(e => { if (e.isIntersecting) { ob.disconnect(); setTimeout(() => { compute(); draw(); }, 30); } }), { rootMargin: '400px' }).observe(cv);
  watchSize(cv, draw); draw();
}

// ============================================================================
//  loop
// ============================================================================
let last = 0, rafId = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
  for (const w of WIDGETS) if (w.on) w.tick(dt, t);
  rafId = requestAnimationFrame(loop);
}
addEventListener('pagehide', () => cancelAnimationFrame(rafId));

const INITS = [initMini, initPipe, initMsa, initEmbed, initEvo, initTri, initStruct, initIpa, initRama, initRecycle, initFape, initOutputs, initDiffusion, initLimits, initDepthChart, initEqFit];
for (const f of INITS) { try { f(); } catch (e) { console.error(f.name, e); } }
rafId = requestAnimationFrame(loop);

// ============================================================================
//  screensaver
// ============================================================================
// Hook for the shell screensaver (lib/screensaver.js). The article has no
// single canvas, so enter() hides the page and lays one full-window canvas
// with its own View3D over it. It shows four scenes of the same SUMO1 model, one per
// seconds/4 (10 s or more), from a seeded start: the structure module fold,
// the Cα trace in pLDDT colours, the AF3 diffusion from noise, and all atoms
// in pLDDT colours. Each scene fades in and out through the backdrop
// colour, and its caption is drawn in the canvas, so the recording has it.
// The fold and the denoise use 70% and 75% of the scene time. The spin is
// 0.18 to 0.06 rad/s (calm 0 to 1). The page loop runs the tick (register).
// The screensaver plate (opts.label) for scene si at scene time p (0..1).
// Every number comes from PROT (data.js): the chain, the heavy atoms by
// element (the model has no H), the pLDDT bands of plddtColor, and the
// share of residues whose phi/psi falls in the alpha and beta basins that
// initRama draws. The equations are the ones of the matching cards, in
// Unicode. The live value is the layer of frameAt or the noise level sigma.
const SUBN = n => String(n).replace(/[0-9]/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
function saverStats() {
  const el = [0, 0, 0, 0];
  for (const a of ATOMS) el[a.el]++;
  let ha = 0, sb = 0, n = 0;
  for (let i = 1; i < L - 1; i++) {
    const phi = G.dihedral(CC[i - 1], NN[i], CA[i], CC[i]), psi = G.dihedral(NN[i], CA[i], CC[i], NN[i + 1]);
    n++;
    if (((phi + 65) / 50) ** 2 + ((psi + 40) / 50) ** 2 <= 1) ha++;
    else if (((phi + 115) / 75) ** 2 + ((psi - 135) / 60) ** 2 <= 1) sb++;
  }
  const mean = PL.reduce((a, b) => a + b, 0) / L;
  const band = [PL.filter(v => v > 90).length, PL.filter(v => v > 70 && v <= 90).length, PL.filter(v => v > 50 && v <= 70).length, PL.filter(v => v <= 50).length];
  return { el, ha: Math.round(100 * ha / n), sb: Math.round(100 * sb / n), mean, band };
}
function saverPlate(si, p, ST) {
  const uni = (PROT.id.match(/AF-([A-Z0-9]+)-/) || [])[1] || '';
  const name = PROT.name.split(' (')[0];
  const common = [
    `1 chain · ${L} residues · ${ATOMS.length} heavy atoms`,
    `C${SUBN(ST.el[0])} N${SUBN(ST.el[1])} O${SUBN(ST.el[2])} S${SUBN(ST.el[3])} (heavy atoms; the model has no H)`,
    `φ/ψ in the α basin ${ST.ha}% · in the β basin ${ST.sb}%`,
  ];
  const sub = `UniProt ${uni} · ${PROT.id}`;
  if (si === 0) {
    const lam = 8 * smooth(clamp(p / 0.7, 0, 1));
    return { title: `${name} · structure module`, sub, lines: [...common, `layer ${lam.toFixed(1)} of 8 (illustrative path to the real frames)`],
      eq: ['Tᵢ = (Rᵢ, tᵢ),  x(global) = Rᵢ x(local) + tᵢ', 'Tᵢ ← Tᵢ ∘ ((1, bᵢ, cᵢ, dᵢ) / √(1 + bᵢ² + cᵢ² + dᵢ²), tᵢ)'] };
  }
  if (si === 1) {
    return { title: `${name} · pLDDT`, sub, lines: [...common, `mean pLDDT ${ST.mean.toFixed(1)}`, `> 90: ${ST.band[0]} · 70–90: ${ST.band[1]} · 50–70: ${ST.band[2]} · ≤ 50: ${ST.band[3]} residues`],
      eq: ['pLDDTᵢ = Σ(b = 1…50) pᵢᵇ v_b', 'v_b = bin centre of lDDT-Cα ∈ [0, 100]'] };
  }
  if (si === 2) {
    const STEPS = 200, SMAX = 40, SMIN = 0.05, RHO = 7;
    const t = STEPS * smooth(clamp(p / 0.75, 0, 1));
    const sg = Math.pow(Math.pow(SMAX, 1 / RHO) + t / STEPS * (Math.pow(SMIN, 1 / RHO) - Math.pow(SMAX, 1 / RHO)), RHO);
    return { title: `${name} · AlphaFold 3 diffusion`, sub, lines: [...common, `step ${Math.round(t)} of ${STEPS} · σ = ${sg < 1 ? sg.toFixed(2) : sg.toFixed(1)} Å`],
      eq: ['x̃ = x + σ ε,  ε ~ 𝒩(0, I)', 'σ(t) = (a + (t/T)(b − a))^ρ', `a = σmax^(1/ρ), b = σmin^(1/ρ)`, `σmax = ${SMAX} Å, σmin = ${SMIN} Å, ρ = ${RHO}, T = ${STEPS}`] };
  }
  return { title: `${name} · every atom`, sub, lines: [...common, `mean pLDDT ${ST.mean.toFixed(1)} · residues ≤ 50: ${ST.band[3]}`],
    eq: ['FAPE = (1/Z) mean(i,j) min(d_clamp, eᵢⱼ)', 'eᵢⱼ = ‖Tᵢ⁻¹∘xⱼ − (Tᵢᵗʳᵘᵉ)⁻¹∘xⱼᵗʳᵘᵉ‖', 'Z = d_clamp = 10 Å'] };
}

window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const beat = Math.max(10, (+o.seconds || 60) / 4), FADE = 1.2 + calm;
    const css = document.createElement('style');
    // visibility, not display: a card that drops to zero size throws in its
    // ResizeObserver redraw (negative ellipse radii in drawMsa and basin)
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    const STEPS = 200, SMAX = 40, SMIN = 0.05, RHO = 7;   // the schedule of initDiffusion
    const sigma = t => Math.pow(Math.pow(SMAX, 1 / RHO) + t / STEPS * (Math.pow(SMIN, 1 / RHO) - Math.pow(SMAX, 1 / RHO)), RHO);
    const R = rng(3), EPS = ATOMS.map(() => [gauss(R), gauss(R), gauss(R)]);
    // frame most of the chain, the low-confidence tails too (CORE_R is the core)
    const RC = 0.72 * Math.max(...CA.map(G.norm)), RA = 0.72 * Math.max(...ATOMS.map(a => G.norm(a.p)));
    const SCENES = [
      { cap: 'Structure module · residue frames fold into place', r: RC, build(add, p) {
        const F = FRAMES.map((_, i) => frameAt(i, 8 * smooth(clamp(p / 0.7, 0, 1))));
        for (let i = 0; i < L - 1; i++) add.seg(F[i].t, F[i + 1].t, rainbow(i), 0.55);
        for (let i = 0; i < L; i++) {
          const Rm = F[i].R, q = F[i].t;
          add.dot(q, rainbow(i), 0.42);
          add.line(q, G.add(q, [Rm[0] * 2.4, Rm[3] * 2.4, Rm[6] * 2.4]), '#ff6b6b', 1.1);
          add.line(q, G.add(q, [Rm[1] * 2.4, Rm[4] * 2.4, Rm[7] * 2.4]), '#5be08a', 1.1);
          add.line(q, G.add(q, [Rm[2] * 2.4, Rm[5] * 2.4, Rm[8] * 2.4]), '#6aa8ff', 1.1);
        }
      } },
      { cap: 'The predicted model · Cα trace in pLDDT confidence colours', r: RC, build(add) {
        for (let i = 0; i < L - 1; i++) add.seg(CA[i], CA[i + 1], plddtColor(PL[i]), 1.0);
      } },
      { cap: 'AlphaFold 3 · diffusion takes noise to atoms', r: RA, build(add, p) {
        const sg = sigma(STEPS * smooth(clamp(p / 0.75, 0, 1)));
        ATOMS.forEach((a, k) => add.dot(G.add(a.p, G.scl(EPS[k], sg)), ELEM_COL[a.el], a.ca ? 0.75 : 0.55));
      } },
      { cap: 'Every atom · pLDDT confidence colours', r: RA, build(add) {
        for (const a of ATOMS) add.dot(a.p, mix(plddtColor(PL[a.res]), ELEM_COL[a.el], a.el === 0 ? 0 : 0.35), a.ca ? 0.75 : 0.62);
      } },
    ];
    let si = (o.seed >>> 0) % SCENES.length, t = 0, time = 0;
    const view = new View3D(cv, { radius: SCENES[si].r, yaw: 0.6, pitch: -0.25, spin: 0.06 + 0.12 * (1 - calm), build: add => SCENES[si].build(add, t / beat) });
    const g = view.ctx;
    const ST = saverStats();
    let plateAt = -1e9, plateSi = -1;
    const plate = () => {
      if (typeof o.label !== 'function') return;
      // a new scene at once; the live value (layer, sigma) at most once a second
      if (si === plateSi && (time - plateAt < 1 || si === 1 || si === 3)) return;
      plateAt = time; plateSi = si;
      try { o.label(saverPlate(si, t / beat, ST)); } catch (e) { /* the plate is optional */ }
    };
    register(cv, dt => {
      t += dt; time += dt;
      if (t >= beat) { t = 0; si = (si + 1) % SCENES.length; view.radius = SCENES[si].r; }
      plate();
      view.pitch = -0.25 + 0.15 * Math.sin(time * 0.05);
      view.dirty = true;
      view.tick(dt);
      // the backdrop under the scene (the recording is opaque), then the fade
      const k = smooth(clamp(Math.min(t, beat - t) / FADE, 0, 1));
      g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = 'rgb(10,12,19)'; g.fillRect(0, 0, view.w, view.h);
      g.globalCompositeOperation = 'source-over';
      if (k < 1) { g.fillStyle = `rgba(10,12,19,${1 - k})`; g.fillRect(0, 0, view.w, view.h); }
      g.globalAlpha = 0.78 * k;
      g.fillStyle = '#c3c8d6'; g.font = '500 15px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText(SCENES[si].cap, 28, view.h - 28);
      g.globalAlpha = 1;
    });
    return { canvas: cv, warmupMs: 1500 };
  },
};

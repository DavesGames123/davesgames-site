// ============================================================================
//  FRACTAL FLAMES  ·  main.js — controls, phone sheet and screensaver hook
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3 (flam3 is Copyright (C) 1992-2009
//  Spotworks LLC). This file is the page around the port: it drives the
//  flam3-genome operations (random, mutate, cross) and the renderer.
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. It is distributed WITHOUT ANY WARRANTY. See
//  the file LICENSE in this directory.
//
//  STATE. genome is the flame on screen. history holds the genomes before
//  it (Back, and the second parent of Cross). R holds the render settings
//  that the sliders set; a new genome takes them. A change to the xforms,
//  the palette or the camera clears the histogram. A render setting only
//  draws again (the histogram stays).
//
//  grep -n targets
//    palette file ......... "function loadPalettes"
//    genome commands ...... "async function generate"
//    apply a genome ....... "function show"
//    panel lists .......... "function buildXforms"  "function buildPalettes"
//    clear area ........... "function clearRect"
//    phone sheet .......... "function setOpen"
//    frame loop ........... "function frame"
//    screensaver hook ..... "SCREENSAVER"  (window.snSaver)
// ============================================================================
import * as G from './genome.js';
import { makeGenome, fitFrame, reframe } from './variations.js';
import { createEngine } from './engine.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const MOBILE = PHONE_Q.matches || matchMedia('(pointer:coarse)').matches;
const canvas = $('fl'), panel = $('panel');

// The saver hook exists at once; enter() waits for the engine.
let readyResolve;
const ready = new Promise(r => { readyResolve = r; });
window.snSaver = {
  async enter(o) { await ready; return saverEnter(o || {}); },
  exit() { saverExit(); },
  debug() { return SV ? { phase: SV.phase, held: +((performance.now() - SV.t0) / 1000).toFixed(1), hold: +(SV.hold / 1000).toFixed(1),
    next: SV.B ? SV.B.action : (SV.making ? 'making' : 'none'), count: SV.count, iters: E && E.stats.iters, spp: E && +(E.stats.samples / Math.max(1, E.stats.cam ? E.stats.cam.frameW * E.stats.cam.frameH : 1)).toFixed(1),
    view: E && E.stats.view, title: SV.title } : null; },
};

// Variation weights for the "weighted" choice (and the screensaver): the
// classic smooth variations get more, the ones that mostly give dust or
// hard edges get less. flam3 itself picks uniformly from its list.
const CLASSIC = ['linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe', 'polar', 'handkerchief', 'heart', 'disc', 'spiral',
  'hyperbolic', 'diamond', 'julia', 'bent', 'waves', 'fisheye', 'popcorn', 'exponential', 'power', 'cosine', 'rings', 'fan',
  'blob', 'pdj', 'fan2', 'rings2', 'eyefish', 'bubble', 'cylinder', 'perspective', 'julian', 'juliascope', 'curl', 'disc2',
  'wedge_julia', 'butterfly', 'polar2'];
const DUSTY = ['ex', 'tangent', 'twintrian', 'secant2', 'blade', 'arch', 'boarders', 'cell', 'stripes', 'modulus', 'oscilloscope',
  'lazysusan', 'loonie', 'scry', 'foci', 'sec', 'csc', 'cot', 'sech', 'csch', 'coth', 'tan', 'tanh', 'exp', 'log', 'cosh', 'sinh'];
const WEIGHTS = G.VAR_NAMES.map(n => (CLASSIC.includes(n) ? 4 : DUSTY.includes(n) ? 0.35 : 1));

let lib = null, E = null, genome = null, busy = false;
const history = [];
const rng = new G.Rng((Math.random() * 4294967296) >>> 0);
const R = { quality: 200, brightness: 4, gamma: 4, vibrancy: 1, highlight: -1, gamLin: 0.01, estimator: 9 };

async function loadPalettes() {
  const [meta, bin] = await Promise.all([
    fetch(new URL('palettes.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('palettes.json ' + r.status); return r.json(); }),
    // arrayBuffer() holds the decoded bytes; content-length may be the gzip size.
    fetch(new URL('palettes.bin', import.meta.url)).then(r => { if (!r.ok) throw new Error('palettes.bin ' + r.status); return r.arrayBuffer(); }),
  ]);
  const data = new Uint8Array(bin);
  if (data.length !== meta.count * 768) throw new Error(`palettes.bin: ${data.length} bytes, want ${meta.count * 768}`);
  return { count: meta.count, numbers: meta.numbers, names: meta.names, data };
}
const palName = g => (g.paletteIndex >= 0 && lib ? `${g.paletteIndex} ${lib.names[lib.numbers.indexOf(g.paletteIndex)] || ''}` : 'blended');

// ── genome commands ────────────────────────────────────────────────────────
function genOpts(kind) {
  const o = { lib, weights: $('selChoice').value === 'weighted' ? WEIGHTS : null, render: R, tries: 10, colorTries: 20 };
  if (kind === 'random') { o.width = 1000; o.height = 1000; }
  return o;
}
async function generate(kind) {
  if (busy || !E) return;
  busy = true; setBusy(true);
  setAction(kind === 'random' ? 'Making a random genome…' : kind === 'mutate' ? 'Mutating…' : 'Crossing…');
  try {
    const o = genOpts(kind);
    if (kind !== 'random') o.base = genome;
    if (kind === 'cross') {
      o.other = history.length ? history[history.length - 1] : (await makeGenome('random', rng, genOpts('random'))).genome;
    }
    const res = await makeGenome(kind, rng, o);
    show(res.genome, true);
    setAction(`${res.genome.action} · ${res.tries} ${res.tries === 1 ? 'try' : 'tries'}${res.gate && res.gate.ok ? '' : ' (best of the tries; the gate did not pass)'}`);
  } catch (e) {
    console.error(e); setAction('Error: ' + e.message);
  } finally { busy = false; setBusy(false); }
}
function setBusy(b) {
  for (const id of ['bRandom', 'bMutate', 'bCross', 'dRandom', 'dMutate', 'dCross']) $(id).disabled = b;
}
function setAction(t) { $('action').textContent = t; lastAction = t; }
let lastAction = '';

// Put g on screen. push: keep the old genome in the history.
function show(g, push) {
  if (push && genome) { history.push(genome); if (history.length > 40) history.shift(); }
  genome = g;
  E.setGenome(g, { reset: true });
  syncUI();
}
function edited() { E.setGenome(genome, { reset: true }); }
function rendered() { E.setGenome(genome, { reset: false }); E.redraw(); }

// ── panel ──────────────────────────────────────────────────────────────────
function buildPalettes() {
  const sel = $('selPalette');
  const frag = document.createDocumentFragment();
  const custom = document.createElement('option'); custom.value = '-1'; custom.textContent = 'Blended (not a library palette)';
  frag.appendChild(custom);
  lib.numbers.forEach((n, i) => { const o = document.createElement('option'); o.value = String(n); o.textContent = `${n} · ${lib.names[i]}`; frag.appendChild(o); });
  sel.appendChild(frag);
  sel.addEventListener('change', () => {
    const n = parseInt(sel.value, 10); if (n < 0) return;
    pushCopy(); G.setPalette(genome, lib, n, genome.hue || 0); edited(); syncPalette();
  });
  $('hue').addEventListener('input', () => {
    const h = +$('hue').value; $('hueV').textContent = h.toFixed(3);
    if (genome.paletteIndex >= 0) { G.setPalette(genome, lib, genome.paletteIndex, h); edited(); drawStrip(); }
    else genome.hue = h;
  });
  $('bPalRandom').addEventListener('click', () => {
    pushCopy(); const p = G.randomPalette(lib, rng, 0); genome.paletteIndex = p.index; genome.hue = 0; genome.palette = p.palette; edited(); syncPalette();
  });
}
function pushCopy() { history.push(G.copyGenome(genome)); if (history.length > 40) history.shift(); }
function drawStrip() {
  const c = $('palStrip'), x = c.getContext('2d'), im = x.createImageData(256, 1);
  for (let i = 0; i < 256; i++) { im.data[i * 4] = genome.palette[i * 3] * 255; im.data[i * 4 + 1] = genome.palette[i * 3 + 1] * 255; im.data[i * 4 + 2] = genome.palette[i * 3 + 2] * 255; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
}
function syncPalette() {
  $('selPalette').value = String(genome.paletteIndex >= 0 ? genome.paletteIndex : -1);
  $('hue').value = genome.hue || 0; $('hueV').textContent = (+genome.hue || 0).toFixed(3);
  drawStrip();
}
function buildXforms() {
  const host = $('xforms'); host.textContent = '';
  const d = G.describe(genome);
  const sym = d.filter(x => x.sym && !x.final);
  for (const x of d) {
    if (x.sym && !x.final && sym.length > 2) continue;
    const box = document.createElement('div'); box.className = 'xf';
    const h = document.createElement('div'); h.className = 'xh';
    h.innerHTML = `<b>${x.final ? 'Final xform' : 'xform ' + (x.i + 1)}</b><span>${x.final ? '' : 'weight ' + x.weight.toFixed(3)}${x.sym ? ' <span class="sym">● symmetry</span>' : ''}</span>`;
    box.appendChild(h);
    for (const [name, w, j] of x.vars) {
      const row = document.createElement('div'); row.className = 'vr';
      const lab = document.createElement('span'); lab.textContent = name;
      const val = document.createElement('span'); val.className = 'val'; val.textContent = w.toFixed(3);
      const inp = document.createElement('input'); inp.type = 'range'; inp.step = '0.005';
      inp.min = String(Math.min(-1, Math.floor(w))); inp.max = String(Math.max(1.5, Math.ceil(w))); inp.value = String(w);
      inp.setAttribute('aria-label', `xform ${x.i + 1} ${name} weight`);
      inp.addEventListener('input', () => { genome.xforms[x.i].v[j] = +inp.value; val.textContent = (+inp.value).toFixed(3); edited(); });
      row.append(lab, val, inp); box.appendChild(row);
    }
    host.appendChild(box);
  }
  if (sym.length > 2) {
    const box = document.createElement('div'); box.className = 'xf';
    box.innerHTML = `<div class="xh"><b>${sym.length} symmetry xforms</b><span class="sym">● linear 1</span></div>`;
    host.appendChild(box);
  }
}
const RENDER_KEYS = [
  ['quality', v => Math.round(Math.pow(10, v)), v => Math.log10(v), v => String(v)],
  ['brightness', v => v, v => v, v => v.toFixed(1)], ['gamma', v => v, v => v, v => v.toFixed(2)],
  ['vibrancy', v => v, v => v, v => v.toFixed(2)], ['highlight', v => v, v => v, v => v.toFixed(2)],
  ['gamLin', v => v, v => v, v => v.toFixed(3)], ['estimator', v => v, v => v, v => v.toFixed(1)],
];
function bindRender() {
  for (const [k, from, , fmt] of RENDER_KEYS) {
    const inp = $(k);
    inp.addEventListener('input', () => { const v = from(+inp.value); R[k] = v; genome[k] = v; $(k + 'V').textContent = fmt(v); rendered(); });
  }
}
function syncRender() {
  for (const [k, , to, fmt] of RENDER_KEYS) { const v = genome[k]; $(k).value = String(to(v)); $(k + 'V').textContent = fmt(v); }
}
function syncCamera() {
  $('zoom').value = genome.zoom; $('zoomV').textContent = (+genome.zoom).toFixed(2);
  $('rotate').value = genome.rotate; $('rotateV').textContent = Math.round(genome.rotate) + '°';
  const s = String(genome.symmetry || 1), sel = $('selSym');
  if (![...sel.options].some(o => o.value === s)) { const o = document.createElement('option'); o.value = s; o.textContent = 'Kind ' + s; sel.appendChild(o); }
  sel.value = s;
}
function syncUI() { syncPalette(); buildXforms(); syncRender(); syncCamera(); }

function bindPanel() {
  $('bRandom').onclick = $('dRandom').onclick = () => generate('random');
  $('bMutate').onclick = $('dMutate').onclick = () => generate('mutate');
  $('bCross').onclick = $('dCross').onclick = () => generate('cross');
  $('bBack').onclick = $('dBack').onclick = () => { if (!history.length || busy) return; genome = null; show(history.pop(), false); setAction('Back'); };
  $('selSym').addEventListener('change', () => {
    pushCopy(); G.removeSymmetry(genome);
    const k = parseInt($('selSym').value, 10);
    if (k !== 1) G.addSymmetry(genome, k, rng);
    edited(); buildXforms(); setAction('symmetry ' + (k === 1 ? 'none' : k));
  });
  $('zoom').addEventListener('input', () => { genome.zoom = +$('zoom').value; $('zoomV').textContent = genome.zoom.toFixed(2); edited(); });
  $('rotate').addEventListener('input', () => { genome.rotate = +$('rotate').value; $('rotateV').textContent = Math.round(genome.rotate) + '°'; edited(); });
  $('bFit').onclick = () => { pushCopy(); if (fitFrame(genome, rng)) { edited(); syncCamera(); } };
  $('bReframe').onclick = () => { pushCopy(); if (reframe(genome, rng)) { edited(); syncCamera(); } };
  $('bExport').onclick = () => {
    const xml = '<!-- Fractal Flames, a port of flam3 (GPL-3.0-or-later). https://github.com/scottdraves/flam3 -->\n' + G.toXML(genome);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
    a.download = `flame-${Date.now().toString(36)}.flam3`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    $('xml').value = xml; setAction('Saved the genome as flam3 XML');
  };
  $('bCopy').onclick = async () => {
    const xml = G.toXML(genome); $('xml').value = xml;
    try { await navigator.clipboard.writeText(xml); setAction('Copied the flam3 XML'); } catch (e) { setAction('The XML is in the box below (copy was blocked)'); }
  };
  const load = text => {
    let gs = [];
    try { gs = G.parseXML(text, { lib }); } catch (e) { console.error(e); }
    if (!gs.length) { setAction('No <flame> element in that text'); return; }
    const g = gs[0];
    if (G.numStd(g) > G.MAX_XF - 1) setAction('The genome has more xforms than this renderer holds (' + G.MAX_XF + ')');
    g.quality = Math.min(Math.max(10, g.quality || R.quality), 2000);
    for (const k of Object.keys(R)) R[k] = g[k];
    show(g, true);
    setAction(`Loaded “${g.name || 'flame'}”: ${G.numStd(g)} xforms${g.finalIndex >= 0 ? ' + final' : ''}`);
  };
  $('bImport').onclick = () => load($('xml').value);
  $('file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { const t = await f.text(); $('xml').value = t; load(t); } e.target.value = ''; });
  // panel open and close (the wave-membrane pattern)
  const dockPanel = $('dockPanel');
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
}
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
}

// ── framing ────────────────────────────────────────────────────────────────
// The part of the window that the panel, the sheet, the dock and the bars
// leave clear (CSS px). An overlay counts when it spans half an edge.
function clearRect() {
  const w = innerWidth, h = innerHeight, o = { l: 0, r: 0, t: 0, b: 0 };
  for (const el of [panel, $('dock'), $('status'), document.querySelector('.topbar')]) {
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  const pad = Math.min(16, 0.03 * Math.min(w, h));
  return { x: o.l + pad, y: o.t + pad, w: Math.max(40, w - o.l - o.r - 2 * pad), h: Math.max(40, h - o.t - o.b - 2 * pad) };
}
let viewCss = null;
function applyView(r) {
  viewCss = r;
  const k = canvas.width / Math.max(1, innerWidth);
  const v = { x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k) };
  E.stats.view = v;
  E.setView(v);
}
let RS = null;
function resize() {
  RS.resize();
  E.resize(canvas.width, canvas.height);
  if (SV) saverView(true); else applyView(clearRect());
}

// ── frame loop ─────────────────────────────────────────────────────────────
let lastStatus = 0, fpsN = 0, fpsT = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!E || !genome) return;
  if (SV) saverTick(now); else applyView(clearRect());
  E.frame();
  fpsN++;
  if (now - fpsT > 1000) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; }
  if (!SV && now - lastStatus > 250) {
    lastStatus = now;
    const s = E.stats, c = s.cam, px = c ? c.frameW * c.frameH : 1, spp = s.samples / Math.max(1, px);
    const done = s.samples >= s.target;
    $('stMain').textContent = `${spp < 10 ? spp.toFixed(1) : Math.round(spp)} of ${Math.round(genome.quality)} samples per pixel${done ? ' · done' : ''}`;
    $('stRight').textContent = `${G.numStd(genome)} xforms · ${palName(genome)} · ${s.iters} steps · ${Math.round(fps)} fps`;
  }
}

// ═══════════════════ SCREENSAVER ═══════════════════
// lib/screensaver.js calls snSaver.enter(opts). The hook hides the page GUI
// (html.sn-saver), switches the renderer to moving mode (the histogram
// decays, so the flame can change every frame) and runs an autopilot:
//   hold   the flame stays for 5-12 s (calm 1 gives the long end) while the
//          camera drifts (a slow turn and a zoom swell) and the palette hue
//          turns.
//   morph  flam3_interpolate from the current genome to the next over 3-6 s
//          (smoothstep), log-polar on the affine columns.
// The next genome is made during the hold: 60% a new random genome, 25% a
// mutation of the current one, 15% the current one with a new symmetry.
// Every candidate passes the gate in variations.js (a 128x128 flam3 test
// render and a 96 px framed probe for coverage and white-out).
// opts.seed seeds the generator, so each run plays a new sequence; the
// counters reset on each load. The flame frame sits in the plate's clear
// band (plateBand, lib/saver-clear.js), read 4 times a second.
let SV = null, plateBandFn = null;
const SAVER_SYMS = [2, 3, 4, 5, 6, -1, -2, -3, -4, -5];
function saverGenOpts() {
  return { lib, weights: WEIGHTS, width: 1000, height: 1000, fit: true, tries: 12, colorTries: 12,
    render: { quality: 50, brightness: 4, gamma: 4, vibrancy: 1, highlight: -1, gamLin: 0.01, estimator: MOBILE ? 5 : 9, estCurve: 0.4, estMin: 0, contrast: 1 },
    gate: { minLit: 0.12, maxWhite: 0.04, maxLit: 0.9 }, maxSym: 8 };
}
async function saverEnter(o) {
  const calm = Math.max(0, Math.min(1, o.calm == null ? 0.7 : +o.calm));
  document.documentElement.classList.add('sn-saver');
  import('../../lib/saver-clear.js').then(m => { plateBandFn = m.plateBand; }).catch(() => { plateBandFn = null; });
  const srng = new G.Rng(((o.seed >>> 0) ^ 0x5f1a3e) >>> 0);
  SV = { calm, rng: srng, label: o.labels !== false && typeof o.label === 'function' ? o.label : null,
    phase: 'hold', t0: performance.now(), hold: 0, morph: 0, A: null, B: null, making: false, count: 0, last: performance.now(),
    time: 0, hue: 0, rot: 0, rotDir: srng.bit() ? 1 : -1, band: null, bandAt: -1e9, title: '' };
  const first = await makeGenome('random', srng, saverGenOpts());
  SV.A = first.genome; SV.A.action = 'random';
  SV.hold = holdFor();
  genome = SV.A;
  E.setMoving(true, 0.9);
  E.setGenome(SV.A, { reset: true });
  saverView(true);
  saverNext();
  saverPlate();
  return { canvas, warmupMs: 1500 };
}
function saverExit() {
  if (!SV) return;
  SV = null;
  document.documentElement.classList.remove('sn-saver');
  if (E) { E.setMoving(false); E.setGenome(genome, { reset: true }); }
}
const holdFor = () => (5 + 7 * SV.calm) * 1000 * (0.85 + 0.3 * SV.rng.r01());
const morphFor = () => (3 + 3 * SV.calm) * 1000;
async function saverNext() {
  if (!SV || SV.making) return;
  const s = SV; s.making = true;
  try {
    const r = s.rng.r01(), o = saverGenOpts();
    let res;
    if (r < 0.15 || (s.count > 0 && s.count % 5 === 4)) {
      const g = G.copyGenome(s.A);
      G.removeSymmetry(g);
      G.addSymmetry(g, s.rng.pick(SAVER_SYMS), s.rng);
      fitFrame(g, s.rng);
      g.action = 'symmetry ' + g.symmetry;
      res = { genome: g };
    } else if (r < 0.4) {
      o.base = s.A; o.mode = s.rng.pick(['all_coefs', 'one_xform', 'post_xforms', 'all_vars', 'color_palette']);
      res = await makeGenome('mutate', s.rng, o);
      fitFrame(res.genome, s.rng);
    } else res = await makeGenome('random', s.rng, o);
    if (SV === s) s.B = res.genome;
  } catch (e) { console.error(e); }
  s.making = false;
}
// The clear band of the plate, as the view rect.
function saverView(force) {
  const now = performance.now();
  if (plateBandFn && (force || now - SV.bandAt > 250)) { SV.bandAt = now; SV.band = plateBandFn(innerHeight); }
  const b = SV.band, W = innerWidth, H = innerHeight;
  let r;
  if (b) {
    let t = b.t, bt = b.b; const k = (t + bt) / (0.7 * H);
    if (k > 1) { t /= k; bt /= k; }
    const w = Math.min(W, b.w || W);
    r = { x: (W - w) / 2 + 0.04 * w, y: t, w: 0.92 * w, h: Math.max(60, H - t - bt) };
  } else r = { x: 0.05 * W, y: 0.06 * H, w: 0.9 * W, h: 0.88 * H };
  applyView(r);
}
// Turn the palette hue by h (0-1) for display.
function hueShift(pal, h) {
  if (!h) return pal;
  const out = new Float32Array(768);
  for (let i = 0; i < 256; i++) {
    const v = G.rgb2hsv(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]);
    const c = G.hsv2rgb(v[0] + h * 6, v[1], v[2]);
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}
function saverTick(now) {
  const s = SV;
  if (!s.A) return;
  const dt = Math.min(0.1, (now - s.last) / 1000); s.last = now; s.time += dt;
  saverView(false);
  let cur = s.A;
  if (s.phase === 'hold') {
    if (now - s.t0 > s.hold && s.B) { s.phase = 'morph'; s.t0 = now; s.morph = morphFor(); }
  }
  let tau = 0.3;
  if (s.phase === 'morph') {
    const u = Math.min(1, (now - s.t0) / s.morph), e = u * u * (3 - 2 * u);
    cur = G.interpolate(s.A, s.B, e);
    tau = 0.16;
    if (u >= 1) {
      s.A = s.B; s.B = null; s.phase = 'hold'; s.t0 = now; s.hold = holdFor(); s.count++;
      cur = s.A; saverNext(); saverPlate();
    }
  }
  const slow = 1 - 0.6 * s.calm;
  s.hue = (s.hue + dt * 0.012 * slow) % 1;
  s.rot += dt * (2.5 + 3 * slow) * s.rotDir;
  const zoom = 0.16 * Math.sin(s.time * 2 * Math.PI / (24 + 12 * s.calm)) + 0.06;
  const g = Object.assign({}, cur, { zoom: cur.zoom + zoom, rotate: cur.rotate + s.rot, palette: hueShift(cur.palette, s.hue) });
  genome = cur;
  E.setMoving(true, Math.exp(-dt / tau));
  E.setGenome(g, { reset: false });
}
// The label plate: the leading variations of the genome, the flame map,
// and the WGSL of the leading variation (a real extract of flame.wgsl).
function wgslOf(id, name) {
  const src = E.sources.flame, key = `fn v${id}_${name}(`;
  const i = src.indexOf(key); if (i < 0) return null;
  const j = src.indexOf('\nfn ', i + 1);
  return src.slice(i, j < 0 ? undefined : j).trim();
}
function saverPlate() {
  if (!SV || !SV.label) return;
  const g = SV.A, tot = new Map();
  g.xforms.forEach((x, i) => {
    if (x.animate === 0 && x.colorSpeed === 0) return;
    const w = i === g.finalIndex ? 0.5 : x.density;
    G.VAR_NAMES.forEach((n, j) => { if (x.v[j] !== 0) tot.set(j, (tot.get(j) || 0) + Math.abs(x.v[j]) * w); });
  });
  const top = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([j, w]) => ({ j, name: G.VAR_NAMES[j], w }));
  const sum = top.reduce((a, t) => a + t.w, 0) || 1;
  const lead = top.find(t => t.name !== 'linear') || top[0];
  const ns = G.numStd(g), sym = g.symmetry;
  const title = 'Fractal flame · ' + top.slice(0, 2).map(t => t.name.replace(/_/g, ' ')).join(' + ');
  SV.title = title;
  SV.label({
    title,
    sub: `flam3 genome · ${ns} xforms${g.finalIndex >= 0 ? ' and a final' : ''}${sym ? sym > 0 ? ` · ${sym}-fold rotation` : sym === -1 ? ' · bilateral' : ` · dihedral ${-sym}` : ''}`,
    params: top.map((t, i) => ({ sym: `v_{${i + 1}}`, name: t.name.replace(/_/g, ' '), value: (t.w / sum).toFixed(2), cls: 'm' + (i + 1) })),
    tex: ['F_i(x, y) = \\sum_j v_{ij}\\, V_j\\!\\left(a_i x + b_i y + c_i,\\; d_i x + e_i y + f_i\\right)',
      '\\text{pixel} = k_1 \\log(1 + k_2\\, n)'],
    rules: [['v_{1}', 'm1'], ['v_{2}', 'm2'], ['v_{3}', 'm3'], ['v_{4}', 'm4'], ['v_{5}', 'm5']],
    eq: ['Fᵢ(x, y) = Σⱼ vᵢⱼ · Vⱼ(aᵢx + bᵢy + cᵢ, dᵢx + eᵢy + fᵢ)', 'pixel = k₁ · log(1 + k₂ · n)'],
    lines: [`flam3 palette ${palName(g)}`, `${MOBILE ? 16384 : 65536} walkers in the chaos game on the GPU`],
    code: lead ? { lang: 'wgsl', name: `flame.wgsl · v${lead.j}_${lead.name}`, text: wgslOf(lead.j, lead.name) || '' } : undefined,
    anchor: () => {
      const c = E.camera(); if (!c || !viewCss) return null;
      const k = innerWidth / Math.max(1, canvas.width);
      return { x: c.ox * k, y: c.oy * k, r: 0.5 * Math.min(c.frameW, c.frameH) * k };
    },
  });
}

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  bindPanel();
  bindRender();
  try {
    lib = await loadPalettes();
    buildPalettes();
    RS = window.RenderScale.create({ canvas, cssSize: () => [innerWidth, innerHeight], fracDesktop: 1, fracMobile: 1,
      maxPixels: MOBILE ? 7e5 : 1.6e6, maxDpr: 2 });
    RS.resize();
    E = await createEngine(canvas, { mobile: MOBILE });
    E.onLost = info => { const m = $('msg'); m.hidden = false; m.textContent = 'The GPU device was lost (' + (info && info.reason) + '). Reload the page.'; };
    E.resize(canvas.width, canvas.height);
    applyView(clearRect());
    addEventListener('resize', resize);
    const first = await makeGenome('random', rng, Object.assign(genOpts('random'), { weights: WEIGHTS }));
    show(first.genome, false);
    setAction(`random · ${first.tries} ${first.tries === 1 ? 'try' : 'tries'}`);
    requestAnimationFrame(frame);
    window.__flames = { get genome() { return genome; }, get engine() { return E; }, G, generate, history };
    readyResolve();
  } catch (e) {
    console.error(e);
    const m = $('msg'); m.hidden = false;
    m.textContent = /webgpu/i.test(e.message) ? 'This page needs WebGPU (Chrome, Edge or Safari 26 and later).' : 'The flame renderer did not start: ' + e.message;
    window.__flames = { error: e.message };
    readyResolve();
  }
}
boot();

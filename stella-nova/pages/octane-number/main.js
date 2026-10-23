// ============================================================================
//  OCTANE NUMBER  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Binds every card of index.html. data.js holds the measured values,
//  knock.js the engine model, hchem.js the C-H sites, draw.js the 2D
//  figures. The 3D molecules are molecules/view3d.js, loaded on demand
//  with three.js (the importmap in index.html), so the page text and the
//  2D figures come up first and a GPU fault does not blank the page.
//
//  State: K (the knock controls) and S (the rest). A control change marks
//  the views dirty; one rAF loop redraws the views that are on screen and
//  dirty or live (animated). The loop stops while the saver runs
//  (window.__onSaver); saver.js installs window.snSaver.
//
//  GREP MAP
//      grep -n 'function fit'           canvas size from CSS size and DPR
//      grep -n 'function initHero'      two 3D molecules, draw then lift
//      grep -n 'function initScale'     01 blend and knock meter
//      grep -n 'function initKnock'     02 cylinder, pressure, controls
//      grep -n 'function recomputeKnock' the cycle and the two sweeps
//      grep -n 'function initShape'     03 3D fuel, ladder, chain, shifts
//      grep -n 'function selectFuel'    one fuel -> 3D, info, bars, plots
//      grep -n 'function initPump'      04 RON-MON plot, pump converter
//      grep -n 'function initHistory'   05 timeline, sources
//      grep -n 'function loop'          the one rAF loop
// ============================================================================
import { FUELS, FAMILY, ISOMERS_C8, CFR, PUMPS, GASOLINES, BDE, SOURCES, HISTORY } from './data.js';
import * as K from './knock.js';
import * as Hc from './hchem.js';
import * as D from './draw.js';
import { decode } from '../molecules/chem.js';
import { typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const SRC_IDS = Object.keys(SOURCES);
const cite = ids => ids.map(id => `<a href="#ref-${id}">[${SRC_IDS.indexOf(id) + 1}]</a>`).join('');
const fsFor = w => w < 420 ? 10 : 11;
const fmt = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const RULES = [['ON', 'm5'], ['T_u', 'm2']];

// ---------------------------------------------------------------- state
const KS = K.defaults();
const S = {
  blend: 91, sample: 0, playing: !REDUCED, th: -140, hold: 0,
  fuel: 'heptane', hover: null, colourH: true, mechStep: 0, mechT: 1, pump: 'aki', pumpV: 87, t: 0,
};
const R = { cycle: null, req: null, reqCurves: [], sweep: [], ladder: [], fuels: null, models: new Map(), shiftPts: [] };

function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

// Each view: { cv, draw(), live() }; live() true means it moves now.
const views = [];
const onScreen = new Set();
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)), { rootMargin: '80px' });
function view(cv, draw, live = () => false) {
  const v = { cv, draw, live, dirty: true };
  views.push(v); io.observe(cv);
  return v;
}
const dirtyAll = () => views.forEach(v => v.dirty = true);
addEventListener('resize', dirtyAll);

// ---------------------------------------------------------------- 3D (lazy)
let V3 = null;
function load3D() {
  if (!V3) V3 = Promise.all([import('../molecules/view3d.js'), import('../molecules/drawlift.js')])
    .then(([v, d]) => ({ View3D: v.View3D, timingFor: d.timingFor, drawLiftAt: d.drawLiftAt }))
    .catch(e => { console.warn('3D view did not load', e); return null; });
  return V3;
}
const model = id => {
  if (!R.models.has(id)) { const rec = R.fuels.find(r => r.id === id); R.models.set(id, rec ? decode(rec) : null); }
  return R.models.get(id);
};
// One 3D view on a canvas; the page frames it in its rAF loop.
const views3 = [];
function make3D(L, cv, labels) {
  const v = new L.View3D(cv, { labels });
  // A vertical swipe scrolls the page; a sideways drag turns the molecule.
  cv.style.touchAction = 'pan-y';
  views3.push(v); io.observe(cv);
  return v;
}
// The Molecule Explorer intro: the skeletal formula draws, then lifts.
function drawLift(L, v, M, onDone) {
  const tok = v._liftTok = (v._liftTok || 0) + 1, D0 = L.timingFor(), t0 = performance.now();
  v.setSpin(false); v.setReveal(0); v.setInk(1); v.setMorph(0);
  const step = now => {
    if (v._liftTok !== tok) return;
    if (window.__onSaver || REDUCED) { v.setReveal(null); v.setInk(0); v.setMorph(1); onDone && onDone(); return; }
    const st = L.drawLiftAt((now - t0) / 1000, M.nShown, D0);
    v.setReveal(st.reveal); v.setInk(st.ink); v.setMorph(st.morph);
    if (st.done) { v.setReveal(null); onDone && onDone(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- hero
function initHero() {
  const ron = id => FUELS.find(f => f.id === id).ron;
  const stats = [
    ['0', 'n-heptane, by definition'],
    ['100', 'iso-octane, by definition'],
    [`${fmt(ron('octane'), 0)} to ${ron('2,3,3-trimethylpentane').toFixed(0)}`, 'four isomers of C₈H₁₈: same atoms'],
    ['≈ 6 kHz', 'the ring of knock in a car cylinder (model)'],
    [(108.6 - 89.7).toFixed(1), 'RON − MON of ethanol; iso-octane: 0'],
    ['1927', 'Graham Edgar proposes the scale'],
  ];
  $('heroStats').innerHTML = stats.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  const seen = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting)) return;
    seen.disconnect();
    const L = await load3D(); if (!L) return;
    [['heroA', 'heptane'], ['heroB', 'isooctane']].forEach(([id, key], k) => {
      const cv = $(id), M = model(key);
      const v = make3D(L, cv, null);
      v.setModel(M); v.setStyle('ball');
      if (COARSE) v.controls.enabled = false;
      setTimeout(() => drawLift(L, v, M, () => v.setSpin(!REDUCED)), 250 + k * 500);
    });
  });
  seen.observe($('heroA'));
}

// ---------------------------------------------------------------- 01
const SAMPLES = [
  { name: 'Pump regular', on: 91.5, note: 'US regular, 87 on the pump, has a RON of about 91.5.' },
  { name: 'Euro 95', on: 95, note: 'European standard grade.' },
  { name: 'n-Pentane', on: 62, note: 'A five-carbon straight chain.' },
  { name: '2-Methylhexane', on: 44, note: 'A seven-carbon chain with one branch.' },
];
const ccrCache = new Map();
const ccr = on => { const k = Math.round(on * 2) / 2; if (!ccrCache.has(k)) ccrCache.set(k, K.criticalCR({ ...K.RATING.ron, on: k })); return ccrCache.get(k); };
function initScale() {
  const inp = $('blendIn');
  const set = () => { S.blend = +inp.value; $('blendOut').textContent = `${S.blend.toFixed(S.blend % 1 ? 1 : 0)} %`; meterRead(); vMeter.dirty = true; };
  inp.addEventListener('input', set);
  const seg = $('sampleSeg');
  seg.innerHTML = SAMPLES.map((s, i) => `<button data-v="${i}"${i === S.sample ? ' class="on"' : ''}>${esc(s.name)}</button>`).join('');
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.sample = +b.dataset.v; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); meterRead(); vMeter.dirty = true; });
  const cv = $('blendCv');
  view(cv, () => { const { g, w, h } = fit(cv); D.drawBlend(g, w, h, { frac: S.blend / 100, t: S.t, fs: fsFor(w) }); }, () => !REDUCED);
  const mc = $('meterCv');
  const vMeter = view(mc, () => {
    const { g, w, h } = fit(mc), s = SAMPLES[S.sample];
    D.drawMeter(g, w, h, { sample: { name: s.name, ccr: ccr(s.on) }, blend: { on: S.blend, ccr: S.blend >= 40 ? ccr(S.blend) : null }, fs: fsFor(w) });
  });
  const T = $('cfrTable');
  T.innerHTML = '<thead><tr><th>Test</th><th>Standard</th><th>Engine speed</th><th>Mixture</th><th>Spark</th></tr></thead><tbody>' +
    Object.values(CFR).map(c => `<tr><td>${c.name}</td><td class="v">${c.std}</td><td class="v">${c.rpm} rpm</td><td>${c.intake}</td><td>${c.spark}</td></tr>`).join('') + '</tbody>';
  meterRead();
}
function meterRead() {
  const s = SAMPLES[S.sample], b = S.blend;
  let txt;
  if (b < 40) txt = `Below about 40 the test does not rate a fuel directly, and the delay fit of the model does not hold. Move the blend up.`;
  else if (Math.abs(b - s.on) < 0.75) txt = `<b>Match.</b> ${esc(s.name)} knocks like a blend of ${b.toFixed(1)} % iso-octane: its research octane number is <b>${s.on}</b>. ${esc(s.note)}`;
  else if (b < s.on) txt = `The blend knocks at a lower compression than ${esc(s.name)}. Add iso-octane.`;
  else txt = `The blend holds out longer than ${esc(s.name)}. Add heptane.`;
  $('meterRead').innerHTML = txt;
}

// ---------------------------------------------------------------- 02
const PRESETS = {
  clean: { on: 95, cr: 10.5, spark: 22, boost: 1.0, rpm: 2000 },
  knock: { on: 80, cr: 10.5, spark: 26, boost: 1.0, rpm: 2000 },
  boost: { on: 91, cr: 9.5, spark: 20, boost: 1.6, rpm: 2500 },
  lowrpm: { on: 91, cr: 10.5, spark: 22, boost: 1.0, rpm: 1100 },
};
const KEYS = ['on', 'cr', 'spark', 'boost', 'rpm'];
const kFmt = { on: v => v.toFixed(0), cr: v => `${v.toFixed(1)} : 1`, spark: v => `${v.toFixed(0)}°`, boost: v => `${v.toFixed(2)} bar`, rpm: v => `${v.toFixed(0)} rpm` };
function initKnock() {
  for (const k of KEYS) {
    const c = K.CONTROLS[k], inp = $(k + 'In');
    Object.assign(inp, { min: c.min, max: c.max, step: c.step, value: KS[k] });
    $(k + 'Out').textContent = kFmt[k](KS[k]);
    inp.addEventListener('input', () => { KS[k] = +inp.value; $(k + 'Out').textContent = kFmt[k](KS[k]); clearPreset(); scheduleKnock(); });
  }
  const seg = $('presetSeg');
  const clearPreset = () => seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    applyPreset(b.dataset.v);
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('knockPlay').addEventListener('click', () => {
    S.playing = !S.playing;
    $('knockPlay').textContent = S.playing ? 'Pause' : 'Play';
    $('knockPlay').classList.toggle('on', S.playing); $('knockPlay').setAttribute('aria-pressed', S.playing);
  });
  if (!S.playing) { $('knockPlay').textContent = 'Play'; $('knockPlay').classList.remove('on'); S.th = 20; }
  // drag on the pressure plot scrubs the crank angle
  const pc = $('presCv');
  const scrub = e => {
    const r = pc.getBoundingClientRect(), x = e.clientX - r.left;
    const l = 46, rr = r.width - 34;
    S.th = clamp(Math.round(-60 + (x - l) / (rr - l) * 150), -60, 90); S.hold = 1.5;
  };
  pc.addEventListener('pointerdown', e => { scrub(e); pc.setPointerCapture(e.pointerId); });
  pc.addEventListener('pointermove', e => { if (pc.hasPointerCapture(e.pointerId)) scrub(e); });

  const cyl = $('cylCv');
  view(cyl, () => { const { g, w, h } = fit(cyl); D.drawCylinder(g, w, h, { c: R.cycle, th: S.th, E: K.ENGINE, drop: t => K.pistonDrop(t), fs: fsFor(w) }); }, () => S.playing);
  view(pc, () => { const { g, w, h } = fit(pc); D.drawPressure(g, w, h, { c: R.cycle, th: S.th, pressureAt: K.pressureAt, fs: fsFor(w) }); }, () => S.playing);
  const rq = $('reqCv');
  view(rq, () => { const { g, w, h } = fit(rq); D.drawRequired(g, w, h, { curves: R.reqCurves, cur: { cr: KS.cr, on: R.req }, fuelOn: KS.on, fs: fsFor(w) }); });
  const sp = $('sparkCv');
  view(sp, () => { const { g, w, h } = fit(sp); D.drawSpark(g, w, h, { pts: R.sweep, cur: R.sweep.find(p => p.spark === Math.round(KS.spark)), fs: fsFor(w) }); });
  recomputeKnock();
}
function applyPreset(key) {
  Object.assign(KS, PRESETS[key]);
  for (const k of KEYS) { $(k + 'In').value = KS[k]; $(k + 'Out').textContent = kFmt[k](KS[k]); }
  S.th = -60;
  scheduleKnock();
}
let kPending = 0;
const scheduleKnock = () => { if (!kPending) kPending = requestAnimationFrame(() => { kPending = 0; recomputeKnock(); }); };
function recomputeKnock() {
  R.cycle = K.cycle(KS);
  R.req = K.requiredON(KS);
  R.reqCurves = [1000, 2000, 4000].map(rpm => ({ rpm, pts: Array.from({ length: 17 }, (_, i) => { const cr = 7 + i * 0.5; return [cr, K.requiredON({ ...KS, rpm, cr })]; }) }));
  R.sweep = Array.from({ length: 46 }, (_, s) => { const c = K.cycle({ ...KS, spark: s }); return { spark: s, imep: c.imep / 1e5, knock: !!c.knock }; });
  const c = R.cycle, kn = c.knock;
  const item = (k, v, cls = '') => `<span class="${cls}">${k} <b>${v}</b></span>`;
  $('knockRead').innerHTML = [
    kn ? item('knock', `${kn.th > 0 ? '+' : ''}${kn.th}° · ${(kn.unburned * 100).toFixed(0)} % unburned · ±${kn.intensity.toFixed(0)} bar at ${(kn.hz / 1000).toFixed(1)} kHz`, 'bad') : item('knock', 'none', 'good'),
    item('octane needed', R.req == null ? 'over 140' : R.req.toFixed(0), R.req != null && R.req <= KS.on ? 'good' : 'bad'),
    item('peak pressure', `${(c.pmax / 1e5).toFixed(0)} bar at +${c.thPmax}°`),
    item('work per cycle (IMEP)', `${(c.imep / 1e5).toFixed(1)} bar`),
    item('one crank degree', `${(c.msPerDeg * 1000).toFixed(0)} µs`),
  ].join('');
  views.forEach(v => { if (['cylCv', 'presCv', 'reqCv', 'sparkCv'].includes(v.cv.id)) v.dirty = true; });
}
// Crank angle speed in degrees per second: slow through the burn.
const degPerS = th => (th > -50 && th < 70 ? 24 : 70);

// ---------------------------------------------------------------- 03
let molView = null;
function initShape() {
  const order = [...FUELS].sort((a, b) => a.ron - b.ron);
  const seg = $('fuelSeg');
  seg.innerHTML = order.map(f => `<button data-v="${f.id}"${f.id === S.fuel ? ' class="on"' : ''}>${esc(f.name)}<i>${fmt(f.ron, f.ron % 1 ? 1 : 0)}</i></button>`).join('');
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectFuel(b.dataset.v); });
  $('hTgl').addEventListener('click', () => {
    S.colourH = !S.colourH;
    $('hTgl').classList.toggle('on', S.colourH); $('hTgl').setAttribute('aria-pressed', S.colourH);
    paintSites();
  });
  $('bdeList').innerHTML = [['primary', 'CH3'], ['secondary', 'CH2'], ['tertiary', 'CH'], ['aromatic', 'ring C-H']].map(([k, s]) =>
    `<li><span class="sw" style="background:${Hc.CLASSES[k].color}"></span>${s} <b>${BDE[k].toFixed(1)}</b></li>`).join('');
  $('famLegend').innerHTML = Object.values(FAMILY).map(f => `<span><b class="dot" style="background:${f.color}"></b>${f.name}</span>`).join('');
  // ladder
  const lc = $('ladderCv');
  view(lc, () => { const { g, w, h } = fit(lc); R.ladder = D.drawLadder(g, w, h, { fuels: FUELS, sel: S.fuel, hover: S.hover, c8: ISOMERS_C8, fs: fsFor(w) }); });
  const hit = e => { const r = lc.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 1e9; for (const b of R.ladder) { if (y < b.y0 - 6 || y > b.y1 + 6) continue; const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0; const dd = d + Math.abs(x - b.x) * 0.01; if (d < 12 && dd < bd) { bd = dd; best = b.id; } } return best; };
  lc.addEventListener('click', e => { const id = hit(e); if (id) selectFuel(id, true); });
  lc.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; const id = hit(e); if (id !== S.hover) { S.hover = id; vLadder().dirty = true; lc.style.cursor = id ? 'pointer' : 'default'; } });
  const vLadder = () => views.find(v => v.cv === lc);
  // mechanism
  const ms = $('mechSeg');
  ms.innerHTML = D.MECH_STEPS.map((s, i) => `<button data-v="${i}"${i === 0 ? ' class="on"' : ''}>${i + 1}. ${esc(s.name)}</button>`).join('');
  ms.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setMech(+b.dataset.v); });
  const mc = $('mechCv');
  view(mc, () => { const { g, w, h } = fit(mc); D.drawMech(g, w, h, { step: S.mechStep, k: S.mechT, fs: fsFor(w) }); }, () => S.mechT < 1);
  setMech(0);
  // shift count
  R.shiftPts = FUELS.filter(f => ['straight', 'branched', 'gas'].includes(f.fam)).map(f => {
    const M = model(f.id), sh = Hc.shifts(M), s = Hc.sites(M);
    const dy = { methane: -7, isobutane: 7, isooctane: 7, '2,3,3-trimethylpentane': -7 }[f.id] || 0;
    return { id: f.id, name: f.name, fam: f.fam, x: sh.easy / s.total, y: f.ron, dy };
  });
  const sc = $('shiftCv');
  view(sc, () => { const { g, w, h } = fit(sc); D.drawShift(g, w, h, { pts: R.shiftPts, sel: S.fuel, fs: fsFor(w) }); });
  // 3D
  const seen = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting)) return;
    seen.disconnect();
    const L = await load3D(); if (!L) { $('molLabels').textContent = 'The 3D view needs WebGL.'; return; }
    molView = make3D(L, $('molCv'), $('molLabels'));
    molView.setStyle('ball');
    molView._L = L;
    show3D(true);
  }, { rootMargin: '200px' });
  seen.observe($('molCv'));
  selectFuel(S.fuel);
}
function setMech(i) {
  S.mechStep = i; S.mechT = 0;
  $('mechSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v === i));
  $('mechText').textContent = D.MECH_STEPS[i].text;
  views.forEach(v => { if (v.cv.id === 'mechCv') v.dirty = true; });
}
function selectFuel(id, scroll = false) {
  S.fuel = id;
  const f = FUELS.find(x => x.id === id), M = model(id);
  $('fuelSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === id));
  const on = $('fuelSeg').querySelector('button.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  $('molName').textContent = f.name;
  const fam = FAMILY[f.fam], sens = f.mon == null ? null : f.ron - f.mon;
  const s = Hc.sites(M), run = Hc.chainRun(M);
  $('molInfo').innerHTML = `<div class="fuelhead"><span class="big">${fmt(f.ron, f.ron % 1 ? 1 : 0)}</span><span class="sub">RON<br>MON ${f.mon == null ? 'not listed' : fmt(f.mon, f.mon % 1 ? 1 : 0)}${sens == null ? '' : ` · sensitivity ${sens.toFixed(1)}`}</span><span class="fam" style="color:${fam.color}">${fam.name}</span></div>` +
    `<p class="body">${esc(M.desc)}${f.note ? ' ' + esc(f.note) : ''}</p>` +
    `<p class="body dim">${esc(M.formula)} · ${s.total} hydrogens · longest run of CH<sub>2</sub>: ${run} · <a href="../molecules/index.html#${encodeURIComponent(id)}">open in the Molecule Explorer</a></p>`;
  $('siteBars').innerHTML = Object.entries(s.count).filter(([, n]) => n > 0).map(([k, n]) =>
    `<div class="bar"><span><span class="sw" style="background:${Hc.CLASSES[k].color}"></span>${Hc.CLASSES[k].name}</span><span class="track"><i style="width:${(n / s.total * 100).toFixed(1)}%;background:${Hc.CLASSES[k].color}"></i></span><b>${n}</b></div>`).join('');
  views.forEach(v => { if (['ladderCv', 'shiftCv', 'ronMonCv'].includes(v.cv.id)) v.dirty = true; });
  if (molView) show3D(true);
  if (scroll) $('molCv').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function show3D(lift) {
  const M = model(S.fuel); if (!molView || !M) return;
  molView.setModel(M);
  paintSites();
  if (lift) drawLift(molView._L, molView, M, () => molView.setSpin(!REDUCED));
}
function paintSites() {
  if (!molView || !molView.M) return;
  molView.setHighlight({ groups: S.colourH ? Hc.sites(molView.M).groups : [] });
}

// ---------------------------------------------------------------- 04
function initPump() {
  const rc = $('ronMonCv');
  view(rc, () => { const { g, w, h } = fit(rc); D.drawRonMon(g, w, h, { fuels: FUELS, gas: GASOLINES, sel: S.fuel, fs: fsFor(w) }); });
  $('pumpTable').innerHTML = '<thead><tr><th>Where</th><th>Pump sign</th><th>Common grades</th><th>As RON</th></tr></thead><tbody>' +
    PUMPS.map(p => `<tr><td>${esc(p.where)}</td><td>${esc(p.index)}</td><td class="v">${esc(p.grades)}</td><td class="v">${esc(p.ron)}</td></tr>`).join('') + '</tbody>';
  const seg = $('pumpSeg'), inp = $('pumpIn');
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.pump = b.dataset.v; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (S.pump === 'ron') { inp.min = 90; inp.max = 102; inp.value = 95; } else { inp.min = 85; inp.max = 95; inp.value = 87; }
    pumpRead();
  });
  inp.addEventListener('input', pumpRead);
  pumpRead();
}
// Typical sensitivity of market gasoline: 8 to 10 (data.js GASOLINES).
function pumpRead() {
  const v = +$('pumpIn').value; $('pumpOut').textContent = v;
  let a, r, m;
  if (S.pump === 'aki') { a = [v, v]; r = [v + 4, v + 5]; m = [v - 5, v - 4]; }
  else { r = [v, v]; a = [v - 5, v - 4]; m = [v - 10, v - 8]; }
  const rng = x => x[0] === x[1] ? `${x[0]}` : `${x[0]}-${x[1]}`;
  $('pumpRead').innerHTML = [
    `<div>Anti-knock index (R+M)/2 <b>${rng(a)}</b></div>`,
    `<div>Research octane number <b>about ${rng(r)}</b></div>`,
    `<div>Motor octane number <b>about ${rng(m)}</b></div>`,
    `<div class="dim">For a typical gasoline with a sensitivity of 8 to 10. A fuel with more ethanol or aromatics has a bigger gap. Use the grade your engine maker asks for: an engine tuned for 87 gains nothing from 93.</div>`,
  ].join('');
}

// ---------------------------------------------------------------- 05
function initHistory() {
  $('histList').innerHTML = HISTORY.map(h => `<li><span class="d">${h.year}</span><h4>${esc(h.who)}</h4><p>${esc(h.what)}</p><span class="src">${cite(h.src)}</span></li>`).join('');
  $('srcList').innerHTML = SRC_IDS.map(id => {
    const s = SOURCES[id];
    const link = s.doi ? `<a href="https://doi.org/${s.doi}" target="_blank" rel="noopener">doi:${s.doi}</a>` : s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : '';
    return `<li id="ref-${id}">${esc(s.cite)}. ${link}</li>`;
  }).join('');
}

function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const ol = $('chips').querySelector('ol');
  let cur = null;
  const update = () => {
    let best = null;
    for (const s of secs) if (s && s.getBoundingClientRect().top < innerHeight * 0.4) best = s;
    if (best === cur) return;
    cur = best;
    links.forEach(a => {
      const on = !!best && a.dataset.target === best.id;
      a.classList.toggle('on', on);
      if (on) ol.scrollTo({ left: a.offsetLeft - ol.offsetLeft - 20, behavior: 'smooth' });
    });
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

// ---------------------------------------------------------------- loop
let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (window.__onSaver) { last = 0; return; }
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
  S.t += dt;
  if (S.playing && onScreen.has($('cylCv'))) {
    if (S.hold > 0) S.hold -= dt;
    else { S.th += dt * degPerS(S.th); if (S.th > 130) { S.th = -140; } if (S.th > 90 && S.th - dt * degPerS(S.th) <= 90) S.hold = 0.9; }
  }
  if (S.mechT < 1) S.mechT = Math.min(1, S.mechT + dt / 1.6);
  for (const v of views) {
    if (!onScreen.has(v.cv)) continue;
    if (v.dirty || v.live()) { v.dirty = false; try { v.draw(); } catch (e) { console.error(e); } }
  }
  for (const v of views3) if (onScreen.has(v.canvas)) v.frame(dt || 1 / 60);
}

// ---------------------------------------------------------------- boot
async function boot() {
  initHistory(); initChips(); initPump(); initKnock();
  typesetAll(document, RULES);
  const res = await fetch(new URL('data/fuels.json', import.meta.url));
  R.fuels = (await res.json()).m;
  initHero(); initScale(); initShape();
  requestAnimationFrame(loop);
  window.__onPage = { S, KS, R, recomputeKnock, selectFuel, applyPreset, model };
}
boot().catch(e => console.error(e));

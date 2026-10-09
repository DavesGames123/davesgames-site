// ============================================================================
//  CIRCULAR RYDBERG  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Binds every card of index.html. Physics in physics.js, facts in data.js,
//  the orbital clouds in cloud.js, the 2D figures in draw.js. One rAF loop
//  redraws only the canvases on screen that need it. saver.js installs
//  window.snSaver; the loop pauses while window.__crSaver is true.
//
//  GREP MAP
//      grep -n 'function fit'           canvas size from CSS size and DPR
//      grep -n 'function initStats'     hero numbers
//      grep -n 'function initOrbital'   01 the orbital viewer
//      grep -n 'function initScaling'   02 scaling table
//      grep -n 'function initDecay'     03 blackbody spectrum
//      grep -n 'function initPrep'      04 preparation ladder + morph
//      grep -n 'function initStable'    05 lifetimes and cascade
//      grep -n 'function initSize'      06 size scale
//      grep -n 'function initTimeline'  08 history
//      grep -n 'function initSources'   references
//      grep -n 'function initChips'     sticky section bar
//      grep -n 'function loop'          the one rAF loop
// ============================================================================
import * as P from './physics.js';
import { PAPER, MEASURED, SOURCES, TIMELINE } from './data.js';
import { createCloud, project } from './cloud.js';
import { drawSpectrum, drawLifetime, drawCascade, drawPrep, prepN, drawSizes, lifetimeCurves } from './draw.js';
import { typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE = matchMedia('(max-width: 860px)').matches || matchMedia('(pointer: coarse)').matches;
const NPTS = PHONE ? 14000 : 30000;
const SRC_IDS = Object.keys(SOURCES);

// Size a canvas to its CSS box at the device pixel ratio. Returns the 2D
// context with CSS-pixel units, plus the CSS width and height.
function fit(cv, maxPx = Infinity) {
  const r = cv.getBoundingClientRect();
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w * h * dpr * dpr > maxPx) dpr = Math.max(0.6, Math.sqrt(maxPx / (w * h)));
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h, dpr, W, H };
}

const views = [];
const onScreen = new Set();
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)), { rootMargin: '80px' });
function view(cv, draw, live = () => false) {
  const v = { cv, draw, live, dirty: true };
  views.push(v); io.observe(cv);
  return v;
}
addEventListener('resize', () => views.forEach(v => v.dirty = true));

const fmtT = s => s >= 1 ? `${s.toFixed(2)} s` : s >= 1e-3 ? `${(s * 1e3).toFixed(s >= 0.01 ? 1 : 2)} ms` : `${(s * 1e6).toFixed(0)} µs`;
const fmtLen = m => m >= 1e-6 ? `${(m * 1e6).toFixed(2)} µm` : m >= 1e-9 ? `${(m * 1e9).toFixed(m >= 1e-8 ? 0 : 1)} nm` : `${(m * 1e12).toFixed(0)} pm`;
const fmtF = hz => hz >= 1e12 ? `${(hz / 1e12).toFixed(2)} THz` : `${(hz / 1e9).toFixed(2)} GHz`;

// ---------------------------------------------------------------- hero
function initStats() {
  const items = [
    [`${PAPER.tau101Ms} ms`, `lifetime of |101C⟩ at room temperature, ±${PAPER.tau101ErrMs} ms`],
    [`${PAPER.enhancement}×`, `longer than the ${PAPER.tauFree101Us} µs it would last in free space`],
    [`n = ${PAPER.nMax}`, `the largest circular state made, an orbit ${PAPER.diameterUm} µm across`],
    [`${PAPER.trapMs} ms`, 'how long the optical tweezer holds the Rydberg atom (1/e)'],
    [`${PAPER.equivalentK} K`, 'the temperature a free atom would need for the same lifetime'],
  ];
  $('heroStats').innerHTML = items.map(([v, t]) => `<div><b>${v}</b><span>${t}</span></div>`).join('');
}

// ---------------------------------------------------------------- 01
function initOrbital() {
  const cv = $('orbCv'), nIn = $('nIn'), lIn = $('lIn'), mIn = $('mIn');
  const st = { n: 30, l: 29, m: 29, cmp: false, colour: 'density', packet: false, bohr: false, spin: !REDUCED, yaw: 0.5, pitch: 1.05, zoom: 1, t: 0 };
  const cloud = createCloud(1, 1), cloud2 = createCloud(1, 1);
  const half = document.createElement('canvas');
  let pts = null, pts0 = null, key = '', key0 = '';
  const sample = () => {
    const k = `${st.n},${st.l},${st.m}`;
    if (k !== key) { key = k; pts = P.sampleState(st.n, st.l, st.m, NPTS, 7); }
    if (st.cmp && key0 !== `${st.n}`) { key0 = `${st.n}`; pts0 = P.sampleState(st.n, 0, 0, NPTS, 11); }
  };
  const extent = (n, l) => (l === n - 1 ? P.meanR(n) + 3.2 * P.sigmaR(n) : 2 * n * n + 6 * n);
  const sync = () => {
    st.n = +nIn.value;
    lIn.max = st.n - 1; mIn.min = -(st.n - 1); mIn.max = st.n - 1;
    if ($('circBtn').classList.contains('on')) { st.l = st.n - 1; st.m = st.n - 1; lIn.value = st.l; mIn.value = st.m; }
    st.l = Math.min(+lIn.value, st.n - 1); st.m = clamp(+mIn.value, -st.l, st.l);
    lIn.value = st.l; mIn.value = st.m;
    $('nOut').textContent = st.n; $('lOut').textContent = st.l; $('mOut').textContent = st.m;
    readout(); v.dirty = true;
  };
  const readout = () => {
    const n = st.n, circ = st.l === n - 1 && Math.abs(st.m) === st.l;
    const r = (3 * n * n - st.l * (st.l + 1)) / 2 * P.AU.a0;
    const rows = [
      ['state', circ ? `|${n}C⟩ (l = m = ${n - 1})` : `n = ${n}, l = ${st.l}, m = ${st.m}`],
      ['mean radius ⟨r⟩', fmtLen(r)],
      ['binding energy', `${(13.6057 / n / n * 1e3).toFixed(n > 20 ? 2 : 0)} meV`],
      ['n → n−1 photon', n > 1 ? fmtF(P.freqHz(n, n - 1)) : '—'],
      ['orbit period', `${(2 * Math.PI * n ** 3 * P.AU.t * 1e12).toPrecision(3)} ps`],
    ];
    if (circ && n > 1) {
      rows.push(['lifetime, 0 K', fmtT(P.radiativeLifetime(n))]);
      if (n >= 20) {
        rows.push(['lifetime, 300 K, free', fmtT(P.lifetime(n, { T: 300 }))]);
        rows.push(['lifetime, 300 K, plates', fmtT(P.lifetime(n, { T: 300, cap: { d: PAPER.plateGapMm * 1e-3, R: PAPER.reflectivity } }))]);
      }
    }
    $('orbRead').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('');
    const note = st.colour === 'phase' && Math.abs(st.m) > 8 ? ` Colour shows the phase e^(imφ); it turns ${Math.abs(st.m)} times round the axis, drawn here as 8.` : '';
    $('orbCap').textContent = (circ
      ? `A ring of radius about n²a₀ = ${fmtLen(n * n * P.AU.a0)}. Its relative thickness is 1/√(2n+1) = ${(100 / Math.sqrt(2 * n + 1)).toFixed(1)} %. Drag to turn it.`
      : `l = ${st.l} < n − 1: the cloud spreads over ${n - st.l - 1} radial node${n - st.l - 1 === 1 ? '' : 's'} and ${st.l - Math.abs(st.m)} polar node${st.l - Math.abs(st.m) === 1 ? '' : 's'}. Press “Circular” for the ring.`) + note;
  };
  const v = view(cv, dt => {
    st.t += dt || 0;
    if (st.spin && !drag) st.yaw += (dt || 0) * 0.25;
    sample();
    const { g, W, H, dpr } = fit(cv, 1.6e6);
    const ext = Math.max(extent(st.n, st.l), st.cmp ? extent(st.n, 0) : 0);
    const panes = st.cmp ? 2 : 1, pw = W / panes;
    const scale = Math.min(pw, H) * 0.46 / ext * st.zoom;
    const vw = { yaw: st.yaw, pitch: st.pitch, scale, cx: pw / 2, cy: H / 2, m: st.m, cycles: Math.sign(st.m) * Math.min(Math.abs(st.m), 8), phase: st.t * 1.6, colour: st.colour,
      packet: st.packet && st.l > 0 ? { phi: st.t * 0.9 * Math.sign(st.m || 1), width: 0.32 } : null };
    half.width = Math.round(pw); half.height = H;
    const hg = half.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    const panesList = st.cmp ? [[pts0, 0, 'l = 0'], [pts, 1, st.l === st.n - 1 ? `|${st.n}C⟩` : `l = ${st.l}`]] : [[pts, 0, '']];
    for (const [arr, i, lab] of panesList) {
      const c = i ? cloud2 : cloud; c.resize(half.width, half.height);
      c.render(hg, arr, Object.assign({}, vw, i === 0 && st.cmp ? { m: 0, cycles: 0, packet: null } : {}));
      g.drawImage(half, i * pw, 0);
      if (st.bohr) {
        g.strokeStyle = 'rgba(255,214,102,0.8)'; g.lineWidth = 1.5 * dpr; g.setLineDash([5 * dpr, 4 * dpr]); g.beginPath();
        for (let k = 0; k <= 96; k++) { const a = k / 96 * 2 * Math.PI, [x, y] = project(vw, st.n * st.n * Math.cos(a), st.n * st.n * Math.sin(a), 0); k ? g.lineTo(i * pw + x, y) : g.moveTo(i * pw + x, y); }
        g.stroke(); g.setLineDash([]);
      }
      if (lab) { g.fillStyle = '#e8eaf0'; g.font = `500 ${13 * dpr}px Inter, system-ui, sans-serif`; g.textAlign = 'left'; g.fillText(lab, i * pw + 12 * dpr, 22 * dpr); }
    }
    // scale bar: a round length near a fifth of the width
    const target = pw * 0.22 / scale * P.AU.a0;
    const pow = Math.pow(10, Math.floor(Math.log10(target))), len = [1, 2, 5, 10].map(k => k * pow).filter(x => x <= target).pop() || pow;
    const px = len / P.AU.a0 * scale;
    g.strokeStyle = 'rgba(232,234,240,0.7)'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(W - 16 * dpr - px, H - 18 * dpr); g.lineTo(W - 16 * dpr, H - 18 * dpr); g.stroke();
    g.fillStyle = 'rgba(232,234,240,0.85)'; g.font = `${11 * dpr}px Inter, system-ui, sans-serif`; g.textAlign = 'right';
    g.fillText(fmtLen(len), W - 16 * dpr, H - 26 * dpr);
  }, () => st.spin || st.packet || st.colour === 'phase' || drag);
  // controls
  const tg = (id, f) => $(id).addEventListener('click', () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); f(on); v.dirty = true; });
  tg('circBtn', on => { if (on) sync(); });
  tg('cmpBtn', on => { st.cmp = on; });
  tg('packBtn', on => { st.packet = on; });
  tg('bohrBtn', on => { st.bohr = on; });
  tg('spinBtn', on => { st.spin = on; });
  $('colSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('colSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); st.colour = b.dataset.v; readout(); v.dirty = true; });
  nIn.addEventListener('input', sync);
  const manual = () => { $('circBtn').classList.remove('on'); sync(); };
  lIn.addEventListener('input', manual); mIn.addEventListener('input', manual);
  // pointer: drag turns, wheel and pinch zoom
  let drag = false; const ptrs = new Map(); let pinch0 = 0, zoom0 = 1;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); drag = true; cv.classList.add('drag'); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = st.zoom; } });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; st.zoom = clamp(zoom0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinch0), 0.4, 6); v.dirty = true; return; }
    st.yaw += (e.clientX - p[0]) * 0.008; st.pitch = clamp(st.pitch + (e.clientY - p[1]) * 0.008, 0.05, Math.PI - 0.05); v.dirty = true;
  });
  const up = e => { ptrs.delete(e.pointerId); if (!ptrs.size) { drag = false; cv.classList.remove('drag'); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); st.zoom = clamp(st.zoom * Math.exp(-e.deltaY * 0.0012), 0.4, 6); v.dirty = true; }, { passive: false });
  sync();
}

// ---------------------------------------------------------------- 02
function initScaling() {
  const inp = $('scaleN');
  const draw = () => {
    const n = +inp.value; $('scaleOut').textContent = n;
    const rows = [
      ['orbit radius ⟨r⟩', 'n²', fmtLen(P.meanR(n) * P.AU.a0), 'a giant atom: at n = 100 it is wider than a wavelength of visible light'],
      ['binding energy', 'n⁻²', `${(13.6057 / n / n * 1e3).toFixed(2)} meV`, 'easy to ionize: field ionization reads out the state'],
      ['n → n−1 frequency', 'n⁻³', fmtF(P.freqHz(n, n - 1)), 'microwave photons, right where room-temperature light is brightest'],
      ['transition dipole', 'n²', `${(P.circularDipole(n) * 8.4783536e-30 / 3.33564e-30).toFixed(0)} D`, 'strong coupling to microwaves and to other atoms'],
      ['radiative lifetime, circular', 'n⁵', fmtT(P.radiativeLifetime(n)), 'only one way down, one small step at a time'],
      ['lifetime at 300 K, circular', 'n²', fmtT(P.lifetime(n, { T: 300 })), 'blackbody photons take over: the reason for the plates'],
      ['radiative lifetime, low l', 'n³', 'about 100 µs at n ≈ 100', 'S and D states can fall straight down with optical photons'],
      ['polarizability', 'n⁷', '—', 'very sensitive to stray electric fields'],
      ['van der Waals C₆', 'n¹¹', `×${Math.round((n / 50) ** 11).toLocaleString('en-US')} vs n = 50`, 'the blockade that makes two-atom gates possible'],
    ];
    $('scaleBody').innerHTML = rows.map(([q, p, v2, w]) => `<tr><td>${q}</td><td class="p">∝ ${p}</td><td class="v">${esc(v2)}</td><td>${w}</td></tr>`).join('');
  };
  inp.addEventListener('input', draw); draw();
}

// ---------------------------------------------------------------- 03
function initDecay() {
  const cv = $('specCv'), nIn = $('specN'), tIn = $('specT');
  let cap = true;
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawSpectrum(g, w, h, { n: +nIn.value, T: +tIn.value, cap }); });
  const upd = () => { $('specNOut').textContent = nIn.value; $('specTOut').textContent = `${tIn.value} K`; v.dirty = true; };
  nIn.addEventListener('input', upd); tIn.addEventListener('input', upd);
  $('capBtn').addEventListener('click', () => { cap = !cap; $('capBtn').classList.toggle('on', cap); $('capBtn').textContent = cap ? 'Plates on' : 'Plates off'; v.dirty = true; });
  upd();
}

// ---------------------------------------------------------------- 04
function initPrep() {
  const cv = $('prepCv'), cl = $('prepCloud'), kIn = $('prepK');
  let playing = false, k = 1;
  const v = view(cv, dt => {
    if (playing) { k += (dt || 0) / 10; if (k >= 1.02) { k = 1; playing = false; $('prepPlay').classList.remove('on'); $('prepPlay').textContent = 'Play'; } kIn.value = Math.min(1, k); }
    const { g, w, h } = fit(cv); drawPrep(g, w, h, { k: Math.min(1, k) });
    vc.dirty = true;
  }, () => playing);
  // the cloud: low-l state, then morph to the ring, then grow 79 -> 103
  const cloud = createCloud(1, 1), a = P.sampleState(79, 2, 2, NPTS, 5), b = P.sampleCircular(79, NPTS, 6);
  // pair the two clouds by azimuth so the morph turns, it does not scramble
  const order = arr => [...Array(arr.length / 4).keys()].sort((i, j) => arr[i * 4 + 3] - arr[j * 4 + 3]);
  const reorder = (arr, idx) => { const o = new Float32Array(arr.length); idx.forEach((s, d) => o.set(arr.subarray(s * 4, s * 4 + 4), d * 4)); return o; };
  const A = reorder(a, order(a)), Bc = reorder(b, order(b)), G = new Float32Array(Bc.length);
  let t = 0;
  const vc = view(cl, dt => {
    t += dt || 0;
    const { g, W, H } = fit(cl, 9e5);
    const kk = Math.min(1, k), nNow = prepN(kk) || 79;
    let pts = A, mix = null;
    if (kk >= 0.28) {
      const s = clamp((kk - 0.28) / 0.12, 0, 1);
      if (s < 1) mix = { pts2: Bc, k: s };
      else { const f = P.meanR(nNow) / P.meanR(79); for (let i = 0; i < G.length; i++) G[i] = (i % 4 === 3) ? Bc[i] : Bc[i] * f; pts = G; }
    }
    const ext = P.meanR(103) + 3 * P.sigmaR(103);
    cloud.resize(W, H); g.setTransform(1, 0, 0, 1, 0, 0);
    cloud.render(g, pts, { yaw: t * 0.2, pitch: 1.0, scale: Math.min(W, H) * 0.46 / ext, cx: W / 2, cy: H / 2, mix });
  }, () => playing || !REDUCED);
  kIn.addEventListener('input', () => { k = +kIn.value; playing = false; $('prepPlay').classList.remove('on'); $('prepPlay').textContent = 'Play'; v.dirty = true; });
  $('prepPlay').addEventListener('click', () => { playing = !playing; if (playing && k >= 1) k = 0; $('prepPlay').classList.toggle('on', playing); $('prepPlay').textContent = playing ? 'Pause' : 'Play'; v.dirty = true; });
}

// ---------------------------------------------------------------- 05
function initStable() {
  const cv = $('lifeCv'), gIn = $('gapIn'), rIn = $('reflIn');
  const v = view(cv, () => {
    const d = +gIn.value * 1e-3, R = +rIn.value;
    const { g, w, h } = fit(cv); drawLifetime(g, w, h, { d, R, hi: 101 });
    const C = lifetimeCurves({ d, R, n0: 70, n1: 105 }), i = C.ns.indexOf(101);
    $('lifeRead').textContent = `At n = 101 our ideal-plate model gives ${C.cap[i].toFixed(1)} ms with d = ${(+gIn.value).toFixed(1)} mm and R = ${(R * 100).toFixed(1)} %, and ${(C.free[i] * 1e3).toFixed(0)} µs in free space. Measured: ${MEASURED.find(m => m[0] === 101)[1].toFixed(1)} ± ${MEASURED.find(m => m[0] === 101)[2].toFixed(1)} ms.`;
  });
  const upd = () => { $('gapOut').textContent = `${(+gIn.value).toFixed(1)} mm`; $('reflOut').textContent = `${(+rIn.value * 100).toFixed(1)} %`; v.dirty = true; };
  gIn.addEventListener('input', upd); rIn.addEventListener('input', upd); upd();
  // cascade
  const cc = $('cascCv'), nIn = $('cascN');
  let env = 'cap', res = null, rkey = '', t = null, playing = false;
  const vc = view(cc, dt => {
    const n0 = +nIn.value, key = `${env},${n0}`;
    if (key !== rkey) { rkey = key; res = P.cascade(n0, { T: 300, cap: env === 'cap' ? { d: PAPER.plateGapMm * 1e-3, R: PAPER.reflectivity } : null, tMax: env === 'cap' ? 0.03 : 0.003, W: 5 }); }
    const tMax = res.times[res.times.length - 1];
    if (playing) { t = (t || 0) + (dt || 0) * tMax / 6; if (t >= tMax) { t = null; playing = false; $('cascPlay').classList.remove('on'); $('cascPlay').textContent = 'Play'; } }
    const { g, w, h } = fit(cc); drawCascade(g, w, h, { res, t, label: env === 'cap' ? 'between the plates, 300 K' : 'free space, 300 K' });
  }, () => playing);
  $('cascSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('cascSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); env = b.dataset.v; t = null; vc.dirty = true; });
  nIn.addEventListener('input', () => { $('cascNOut').textContent = nIn.value; vc.dirty = true; });
  $('cascPlay').addEventListener('click', () => { playing = !playing; if (playing) t = 0; $('cascPlay').classList.toggle('on', playing); $('cascPlay').textContent = playing ? 'Pause' : 'Play'; vc.dirty = true; });
}

// ---------------------------------------------------------------- 06
function initSize() {
  const cv = $('sizeCv'), inp = $('sizeN');
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawSizes(g, w, h, { n: +inp.value }); });
  inp.addEventListener('input', () => { $('sizeOut').textContent = inp.value; v.dirty = true; });
}

// ---------------------------------------------------------------- 08
function initTimeline() {
  const cols = ['#ffd666', '#8fd3ff', '#b49bff', '#ff9a62', '#6ee7a8'];
  $('tlList').innerHTML = TIMELINE.map((e, i) => `<li style="--c:${cols[i % cols.length]}"><span class="d">${e.y}</span><h4>${esc(e.t)}</h4><p>${esc(e.d)}</p><span class="src"><a href="#ref-${e.src}">[${SRC_IDS.indexOf(e.src) + 1}]</a></span></li>`).join('');
}
function initSources() {
  $('srcList').innerHTML = SRC_IDS.map(id => {
    const s = SOURCES[id], href = s.doi ? `https://doi.org/${s.doi}` : s.url;
    return `<li id="ref-${id}">${esc(s.cite)} <a href="${esc(href)}" target="_blank" rel="noopener">${esc(s.doi ? 'doi:' + s.doi : href.replace(/^https?:\/\//, ''))}</a></li>`;
  }).join('');
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const ol = $('chips').querySelector('ol');
  let cur = null;
  const update = () => {
    let best = null;
    for (const s of secs) if (s.getBoundingClientRect().top < innerHeight * 0.4) best = s;
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

let lastT = 0;
function loop(now) {
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;
  if (!window.__crSaver && !document.hidden) {
    for (const v of views) {
      if (!onScreen.has(v.cv)) continue;
      if (v.dirty || v.live()) { v.dirty = false; try { v.draw(dt); } catch (e) { console.error(e); } }
    }
  }
  requestAnimationFrame(loop);
}

function boot() {
  const steps = [initStats, initOrbital, initScaling, initDecay, initPrep, initStable, initSize, initTimeline, initSources, initChips];
  for (const f of steps) { try { f(); } catch (e) { console.error(f.name, e); } }
  typesetAll(document.querySelector('#doc'));
  requestAnimationFrame(loop);
}
boot();

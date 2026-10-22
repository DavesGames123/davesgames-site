// ============================================================================
//  DARK MATTER HALO  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Binds every card of index.html. The mass model is model.js (McMillan
//  2017); halo.js turns the three halo controls into a halo and computes
//  the curves, grids and fractions; data.js holds the measured points and
//  the published values; draw-charts.js and draw-maps.js draw.
//
//  One state object (S) holds the controls. recompute() runs once per
//  animation frame after a control changes, and marks every view dirty.
//  One rAF loop redraws the views that are on screen and dirty, and the
//  face-on view while it plays. The loop stops while the saver runs
//  (window.__dmSaver).
//
//  GREP MAP
//      grep -n 'function fit'           canvas size from CSS size and DPR
//      grep -n 'function recompute'     halo controls -> every plot
//      grep -n 'function initStats'     hero numbers
//      grep -n 'function initControls'  #halo, dock and sheet
//      grep -n 'function initCurve'     01 rotation curve and cursor
//      grep -n 'function initMaps'      02 R-z slice and face-on view
//      grep -n 'function initModels'    03 profiles, family curves, table
//      grep -n 'function initFraction'  04 enclosed dark share
//      grep -n 'function initHow'       05 methods, history
//      grep -n 'function initSources'   references
//      grep -n 'function initChips'     sticky section bar
//      grep -n 'function loop'          the one rAF loop
// ============================================================================
import * as M from './model.js';
import * as H from './halo.js';
import { SOURCES, EILERS19, JIAO23, ESTIMATES, PLANCK18, cosmicDarkFraction, HISTORY, METHODS, VIDEO_NOTE } from './data.js';
import { chartBox, drawCurve, drawProfiles, drawFamilyCurves, drawFraction } from './draw-charts.js';
import { drawMeridional, drawFaceOn } from './draw-maps.js';
import { typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SRC_IDS = Object.keys(SOURCES);
const cite = ids => ids.map(id => `<a href="#ref-${id}">[${SRC_IDS.indexOf(id) + 1}]</a>`).join('');
const R0 = H.BASE.R0;
const sci = (v, d = 2) => { const e = Math.floor(Math.log10(Math.abs(v))); return `${(v / 10 ** e).toFixed(d)} × 10<sup>${e}</sup>`; };

// TeX colour rules: one class per quantity, as in style.css and PAL.
const RULES = [
  ['v_{\\mathrm{bulge}}', 'm2'], ['v_{\\mathrm{disc}}', 'm1'], ['v_{\\mathrm{gas}}', 'm3'], ['v_{\\mathrm{halo}}', 'm6'],
  ['M_{\\mathrm{halo}}', 'm6'], ['M_{\\mathrm{vis}}', 'm5'], ['r_s', 'm4'],
];

// ---------------------------------------------------------------- state
const S = {
  family: H.CONTROLS.family, rs: H.CONTROLS.rs.def, local: H.CONTROLS.local.def,
  visibleOnly: false, parts: true, xmax: 30, mapMode: 'split', cursor: null,
  playing: !REDUCED, t: 0,
};
// Results of recompute(): the views read only these.
const R = { base: null, mb: null, halo: null, curve: null, sum: null, fam: [], prof: [], fracs: [], gridH: null, gridB: null, col: null };
const PROF_R = Float64Array.from({ length: 160 }, (_, i) => 0.1 * Math.pow(3000, i / 159));
const MAP = { nx: 150, nz: 94, Rmax: 30, zmax: 18.8 };
const STARS = H.discStars(2600, 11);
const FACE_VIEW = 30;

// Size a canvas to its CSS box at the device pixel ratio. Returns the 2D
// context with CSS-pixel units, plus the CSS width and height.
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

// ---------------------------------------------------------------- recompute
// Halo controls -> halo -> every curve, grid and readout.
function recompute() {
  const halo = H.makeHalo(S.family, S.rs, S.local);
  R.halo = halo;
  R.curve = H.curveFor(R.base, halo);
  R.sum = H.summary(R.base, halo, R.curve, R.mb);
  R.fam = H.FAMILIES.map(f => {
    const h = f === S.family ? halo : H.makeHalo(f, S.rs, S.local);
    return { family: f, name: H.FAMILY_NAME[f], halo: h, curve: f === S.family ? R.curve : H.curveFor(R.base, h) };
  });
  R.prof = R.fam.map(x => ({ family: x.family, name: x.name, rho: Float64Array.from(PROF_R, r => M.perPc3(M.haloDensity(x.halo, r))) }));
  R.fracs = R.fam.map(x => ({ family: x.family, f: H.fractionCurve(x.halo, R.mb) }));
  R.gridH = H.densityGrid(H.withHalo(halo), 'halo', MAP.nx, MAP.nz, MAP.Rmax, MAP.zmax);
  const n = Math.ceil(FACE_VIEW * 1.5 / 0.25);
  R.col = { dR: 0.25, R: Float64Array.from({ length: n }, (_, i) => i * 0.25), sigma: Float64Array.from({ length: n }, (_, i) => H.haloColumn(halo, (i + 0.5) * 0.25)) };
  readouts();
  dirtyAll();
}
let pending = 0;
const schedule = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; recompute(); }); };

function readouts() {
  const s = R.sum;
  $('haloRead').innerHTML = [
    ['speed at the Sun', `${s.vSun.toFixed(1)} km/s`],
    ['halo mass inside 50 kpc', sci(s.m50)],
    ['virial radius', `${s.rv.toFixed(0)} kpc`],
    ['total virial mass', sci(s.Mv)],
    ['dark inside the Sun\'s orbit', `${(s.fracSun * 100).toFixed(0)} %`],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
  $('rsOut').textContent = `${S.rs.toFixed(1)} kpc`;
  $('rhoOut').textContent = `${S.local.toFixed(2)} GeV/cm³`;
  const e = H.misfit(R.curve, EILERS19.rows), j = H.misfit(R.curve, JIAO23.rows);
  $('fitOut').innerHTML = `With this halo the curve gives <b>${s.vSun.toFixed(1)} km/s</b> at the Sun (R = ${R0} kpc); visible matter alone gives <b>${s.vSunBaryons.toFixed(1)} km/s</b>. ` +
    `Root-mean-square distance from the measured points: <b>${e.rms.toFixed(1)} km/s</b> from Eilers et al. ${cite(['eilers19'])}, <b>${j.rms.toFixed(1)} km/s</b> from Jiao et al. ${cite(['jiao23'])}. ` +
    `On average the curve runs <b>${Math.abs(e.mean).toFixed(1)} km/s ${e.mean >= 0 ? 'above' : 'below'}</b> the Eilers points. The McMillan model came before both data sets, and it runs above them past the Sun: try a lower density at the Sun. ` +
    `Each paper uses its own Sun radius (${EILERS19.r0} and ${JIAO23.r0} kpc). Error bars of Eilers et al. are formal only (${EILERS19.errors}).`;
  $('fracRead').innerHTML = [
    [`Inside the Sun's orbit (${R0} kpc)`, s.fracSun],
    ['Inside 50 kpc', s.frac50],
    [`Inside the virial radius (${s.rv.toFixed(0)} kpc)`, 1 - M.baryonMass(H.BASE) / s.Mv],
  ].map(([k, f]) => `<div><b>${(f * 100).toFixed(0)} % dark</b> · ${k}</div>`).join('') +
    `<div><b>${(cosmicDarkFraction() * 100).toFixed(1)} % dark</b> · the universe as a whole: Ω<sub>c</sub>h² = ${PLANCK18.omch2.toFixed(3)} and Ω<sub>b</sub>h² = ${PLANCK18.ombh2.toFixed(4)} ${cite(['planck18'])}</div>`;
  const now = $('rangeTable').querySelectorAll('[data-now]');
  now.forEach(td => { td.innerHTML = nowValue(td.dataset.now); });
  $('dockFam').textContent = H.FAMILY_NAME[S.family];
  document.querySelectorAll('#famSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.family));
}

// The slope of the model curve between 5 and 25 kpc (least squares).
function modelSlope() {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  const c = R.curve;
  for (let i = 0; i < c.R.length; i++) { const x = c.R[i]; if (x < 5 || x > 25) continue; const y = c.v.total[i]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
function nowValue(k) {
  const s = R.sum;
  if (k === 'local') return `${s.localGeV.toFixed(2)} GeV/cm³`;
  if (k === 'vsun') return `${s.vSun.toFixed(1)} km/s`;
  if (k === 'slope') return `${modelSlope().toFixed(2)} km/s/kpc`;
  if (k === 'mass') return `${sci(s.Mv)} Msun`;
  return '';
}

// ---------------------------------------------------------------- hero
function initStats() {
  const halo = H.makeHalo('nfw', H.CONTROLS.rs.def, H.CONTROLS.local.def);
  const c = H.curveFor(R.base, halo), s = H.summary(R.base, halo, c, R.mb);
  const [eil, mcm] = ESTIMATES.localGeV;
  const items = [
    [`${s.vSun.toFixed(0)} km/s`, `speed of the Sun's orbit in the model ${cite(['mcmillan17'])}; measured ${ESTIMATES.vSun[0].v.toFixed(1)} km/s ${cite(['eilers19'])}`],
    [`${s.vSunBaryons.toFixed(0)} km/s`, 'what the visible matter alone could hold the Sun to'],
    [`${(s.fracSun * 100).toFixed(0)} %`, 'of the mass inside the Sun\'s orbit is dark'],
    [`${(s.frac50 * 100).toFixed(0)} %`, 'of the mass inside 50 kpc is dark'],
    [`${(cosmicDarkFraction() * 100).toFixed(0)} %`, `of all matter in the universe is dark ${cite(['planck18'])}`],
    [`${eil.v.toFixed(2)}–${mcm.v.toFixed(2)}`, `GeV/cm³ of dark matter near the Sun, about ${(eil.v / 0.938).toFixed(1)}–${(mcm.v / 0.938).toFixed(1)} proton masses per cm³ ${cite(['eilers19', 'mcmillan17'])}`],
  ];
  $('heroStats').innerHTML = items.map(([v, t]) => `<div><b>${v}</b><span>${t}</span></div>`).join('');
  $('videoNote').textContent = VIDEO_NOTE;
  $('yearOut').textContent = `about ${(2 * Math.PI * R0 / s.vSun * 977.8).toFixed(0)}`;
}

// ---------------------------------------------------------------- controls
function initControls() {
  const rs = $('rsIn'), rho = $('rhoIn'), sheet = $('halo'), dockHalo = $('dockHalo');
  rs.min = H.CONTROLS.rs.min; rs.max = H.CONTROLS.rs.max; rs.step = H.CONTROLS.rs.step;
  rho.min = H.CONTROLS.local.min; rho.max = H.CONTROLS.local.max; rho.step = H.CONTROLS.local.step;
  const sync = () => { rs.value = S.rs; rho.value = S.local; };
  sync();
  rs.addEventListener('input', () => { S.rs = +rs.value; schedule(); });
  rho.addEventListener('input', () => { S.local = +rho.value; schedule(); });
  $('famSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.family = b.dataset.v; schedule(); });
  $('resetBtn').addEventListener('click', () => { S.family = H.CONTROLS.family; S.rs = H.CONTROLS.rs.def; S.local = H.CONTROLS.local.def; sync(); schedule(); });
  const setOpen = open => { sheet.classList.toggle('open', open); dockHalo.setAttribute('aria-expanded', String(open)); };
  dockHalo.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
  $('sheetClose').addEventListener('click', () => setOpen(false));
  addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  $('dockFam').addEventListener('click', () => { S.family = H.FAMILIES[(H.FAMILIES.indexOf(S.family) + 1) % H.FAMILIES.length]; schedule(); });
  $('dockVis').addEventListener('click', () => setVisible(!S.visibleOnly));
}
function setVisible(on) {
  S.visibleOnly = on;
  for (const id of ['visBtn', 'dockVis']) { const b = $(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  dirtyAll();
}

// ---------------------------------------------------------------- 01
function initCurve() {
  const cv = $('curveCv');
  const v = view(cv, () => {
    const { g, w, h } = fit(cv);
    drawCurve(g, w, h, { curve: R.curve, eilers: EILERS19, jiao: JIAO23, xmax: S.xmax, visibleOnly: S.visibleOnly, parts: S.parts, cursor: S.cursor, R0 });
  });
  $('visBtn').addEventListener('click', () => setVisible(!S.visibleOnly));
  $('partsBtn').addEventListener('click', e => { S.parts = !S.parts; e.currentTarget.classList.toggle('on', S.parts); e.currentTarget.setAttribute('aria-pressed', String(S.parts)); v.dirty = true; });
  $('rangeSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.xmax = +b.dataset.v; $('rangeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); v.dirty = true;
  });
  // Cursor: hover with a mouse, tap or drag sideways with a finger.
  const toR = e => {
    const r = cv.getBoundingClientRect(), fs = r.width < 520 ? 11 : 12, box = chartBox(r.width, r.height, fs);
    return clamp((e.clientX - r.left - box.x) / box.w, 0, 1) * S.xmax;
  };
  cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) { S.cursor = toR(e); v.dirty = true; } });
  cv.addEventListener('pointerdown', e => { S.cursor = toR(e); v.dirty = true; });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { S.cursor = null; v.dirty = true; } });
}

// ---------------------------------------------------------------- 02
function initMaps() {
  const mc = $('mapCv');
  const mv = view(mc, () => { const { g, w, h } = fit(mc); drawMeridional(g, w, h, { ...MAP, gridH: R.gridH, gridB: R.gridB, mode: S.mapMode, R0 }); });
  $('mapSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.mapMode = b.dataset.v; $('mapSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); mv.dirty = true;
  });
  const fc = $('faceCv'), play = $('facePlay');
  view(fc, () => {
    const { g, w, h } = fit(fc);
    drawFaceOn(g, w, h, { stars: STARS, curve: R.curve, t: S.t, col: R.col, view: FACE_VIEW, R0, rv: R.sum.rv });
    $('faceRead').textContent = `${S.t.toFixed(0)} Myr`;
  }, () => S.playing);
  const label = () => { play.textContent = S.playing ? 'Pause' : 'Play'; play.classList.toggle('on', S.playing); };
  play.addEventListener('click', () => { S.playing = !S.playing; label(); });
  label();
}

// ---------------------------------------------------------------- 03
function initModels() {
  const rc = $('rhoCv'), fc = $('famCv');
  const [eil, mcm] = ESTIMATES.localGeV;
  const band = [eil.v / M.GEV_PER_MSUN_PC3, mcm.v / M.GEV_PER_MSUN_PC3];
  view(rc, () => { const { g, w, h } = fit(rc); drawProfiles(g, w, h, { profiles: R.prof, r: PROF_R, selected: S.family, R0, localBand: band }); });
  view(fc, () => {
    const { g, w, h } = fit(fc);
    drawFamilyCurves(g, w, h, { curves: R.fam.map(x => ({ family: x.family, v: x.curve.v.total })), R: R.curve.R, baryons: R.curve.v.baryons, eilers: EILERS19, jiao: JIAO23, selected: S.family, xmax: 100 });
  });
  $('famLegend').innerHTML = H.FAMILIES.map(f => `<span><i style="background:var(--f-${f})"></i>${H.FAMILY_NAME[f]}: ${H.FAMILY_SHAPE[f]}</span>`).join('') +
    '<span><i style="background:var(--c-sun)"></i>measured local density</span>';
  const E = ESTIMATES, row = (q, src, v, note) => `<tr><td>${q}</td><td class="v">${v}</td><td>${note} ${src ? cite([src]) : ''}</td></tr>`;
  const pm = (x, d) => x.err != null ? `${x.v.toFixed(d)} ± ${x.err.toFixed(d)}` : x.v.toFixed(d);
  const massV = x => x.lo != null ? `${sci(x.v)} <small>(+${(x.hi / 1e11).toFixed(2)} / −${(x.lo / 1e11).toFixed(2)} × 10<sup>11</sup>)</small>` : sci(x.v);
  const nowRow = (k, what) => `<tr class="now"><td>this page, now</td><td class="v" data-now="${k}"></td><td>${what}</td></tr>`;
  $('rangeTable').innerHTML = '<thead><tr><th>source</th><th>value</th><th>what it is</th></tr></thead><tbody>' +
    '<tr class="grp"><td colspan="3">Dark matter density at the Sun, GeV/cm³</td></tr>' +
    E.localGeV.map(x => row(short(x.src), x.src, pm(x, 2), x.note)).join('') + nowRow('local', 'the halo controls') +
    '<tr class="grp"><td colspan="3">Circular speed at the Sun, km/s</td></tr>' +
    E.vSun.map(x => row(short(x.src), x.src, pm(x, 1), `at R0 = ${x.r0} kpc; ${x.note}`)).join('') + nowRow('vsun', `at R0 = ${R0} kpc`) +
    '<tr class="grp"><td colspan="3">Slope of the curve, km/s per kpc</td></tr>' +
    E.slope.map(x => row(short(x.src), x.src, pm(x, 2), x.note)).join('') + nowRow('slope', 'least squares on the model curve, 5-25 kpc') +
    '<tr class="grp"><td colspan="3">Mass of the Galaxy, Msun</td></tr>' +
    E.mass.map(x => row(short(x.src), x.src, massV(x), `${x.kind}; ${x.note}`)).join('') + nowRow('mass', 'total virial mass (200 x critical density, H = 70.4)') +
    '</tbody>';
}
const short = id => ({ eilers19: 'Eilers et al. 2019', jiao23: 'Jiao et al. 2023', mcmillan17: 'McMillan 2017', planck18: 'Planck 2018' }[id] || id);

// ---------------------------------------------------------------- 04
function initFraction() {
  const cv = $('fracCv');
  view(cv, () => {
    const { g, w, h } = fit(cv);
    drawFraction(g, w, h, { r: H.FRAC_R, fracs: R.fracs, selected: S.family, cosmic: cosmicDarkFraction(), marks: [{ r: R0, label: 'the Sun\'s orbit' }, { r: 50, label: '50 kpc' }] });
  });
}

// ---------------------------------------------------------------- 05
function initHow() {
  $('methodList').innerHTML = METHODS.map(m => `<article class="card span-4 method"><h3>${esc(m.title)}</h3><span class="range">${esc(m.range)}</span><p>${esc(m.text)}</p><p class="src">${cite(m.src)}</p></article>`).join('');
  $('histList').innerHTML = HISTORY.map(h => `<li><span class="d">${h.year}</span><h4>${esc(h.who)}</h4><p>${esc(h.what)}</p><span class="src">${cite(h.src)}</span></li>`).join('');
}
function initSources() {
  $('srcList').innerHTML = SRC_IDS.map(id => {
    const s = SOURCES[id];
    const links = [s.doi ? `<a href="https://doi.org/${s.doi}" target="_blank" rel="noopener">doi:${s.doi}</a>` : '', s.arxiv ? `<a href="https://arxiv.org/abs/${s.arxiv}" target="_blank" rel="noopener">arXiv:${s.arxiv}</a>` : ''].filter(Boolean).join(' · ');
    return `<li id="ref-${id}">${esc(s.cite)}. ${links}</li>`;
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
  if (window.__dmSaver) { last = 0; return; }
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
  if (S.playing) S.t += dt * 22;    // 22 Myr per second: one solar orbit in about 10 s
  if (!R.curve) return;
  for (const v of views) {
    if (!onScreen.has(v.cv)) continue;
    if (v.dirty || v.live()) { v.dirty = false; try { v.draw(); } catch (e) { console.error(e); } }
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  initSources(); initHow(); initChips();
  typesetAll(document, RULES);
  // Let the text paint before the disc integrals (about 0.3 s).
  await new Promise(r => setTimeout(r, 30));
  R.base = H.baseOnce();
  R.mb = H.baseFractions();
  R.gridB = H.densityGrid(H.BASE, 'baryons', MAP.nx, MAP.nz, MAP.Rmax, MAP.zmax);
  initControls(); initCurve(); initMaps(); initModels(); initFraction();
  initStats();
  recompute();
  requestAnimationFrame(loop);
  window.__dmPage = { S, R, recompute };
}
boot().catch(e => console.error(e));

// ============================================================================
//  STEREOGRAM HISTORY  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Binds every card of index.html. Facts come from data.js; the closed
//  forms of the figures from geometry.js; drawing from draw.js. Every
//  stereogram is a job of jobs.js, run in worker.js through client.js.
//
//  One state object (S) holds the viewing method (wall-eyed or
//  cross-eyed) and the depth-map reveal; both apply to every stereogram.
//  A figure is a { el, render() } pair: render() runs when the figure
//  first comes near the screen, and again when S changes or the width
//  changes. Each figure keeps a token, so a late result of an old job is
//  dropped. One rAF loop plays the hero turntable, the stereoscope
//  pulse and the row build while they are on screen. saver.js installs
//  window.snSaver; the loop stops while window.__sgSaver is true.
//
//  GREP MAP
//      grep -n 'function objects'      the list of real objects (or shapes)
//      grep -n 'function figure'       lazy figure registry
//      grep -n 'function initView'     viewing method, reveal, help sheet
//      grep -n 'function initHero'     hero turntable
//      grep -n 'function initEyes'     01 top view and drag
//      grep -n 'function initScopes'   02 stereoscope, pair, wallpaper
//      grep -n 'function initJulesz'   03 random-dot stereogram
//      grep -n 'function initTyler'    04 row figure and furrows
//      grep -n 'function initWork'     05 grating, positions, papers
//      grep -n 'function initCulture'  06 names and the pattern example
//      grep -n 'function initToday'    07 gallery and the large view
//      grep -n 'function initText'     cites, quotes, timeline, sources
//      grep -n 'function loop'         the one rAF loop
// ============================================================================
import { SOURCES, SRC_IDS, srcUrl, QUOTES, TIMELINE, TYLER_POSITIONS, TYLER_WORKS, VIEW, GRATING_LIMIT_CPD } from './data.js';
import * as G from './geometry.js';
import * as D from './draw.js';
import { run } from './client.js';
import { typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cite = ids => ids.map(id => `<a href="#ref-${id}">[${SRC_IDS.indexOf(id) + 1}]</a>`).join('');
const CSS_PX_PER_IN = 96;

// ---------------------------------------------------------------- state
const S = { mode: 'wall', reveal: false, cat: { models: [], tiles: [], engine: false } };
const BASE = { dpi: 72, eyeSep: VIEW.eyeSepIn, mu: VIEW.mu };
const opts = (extra = {}) => Object.assign({}, BASE, { mode: S.mode }, extra);

// The objects that the figures use: the real models of the maker page,
// or, when the models module is not there yet, the engine's shapes.
function objects() {
  if (S.cat.models.length) return S.cat.models.map(m => ({ key: m.id, name: m.name, kind: m.kind, credit: m.credit, licence: m.licence, url: m.url, spec: (w, h, yaw) => ({ model: m.id, w, h, yaw: yaw == null ? undefined : (m.view?.yaw ?? 0) + yaw }) }));
  return ['torus', 'sphere', 'steps', 'cone', 'pyramid', 'ripple'].map(s => ({ key: s, name: `a ${s} (shape)`, kind: 'shape', credit: 'analytic shape', licence: '', url: '', spec: (w, h) => ({ sdf: s, w, h }) }));
}
const objCredit = o => o.kind === 'shape' ? 'an analytic shape (the 3D models are still loading)' : `${esc(o.name)} · ${esc(o.credit || '')}${o.licence ? ' · ' + esc(o.licence) : ''}`;
const tilesOf = fam => S.cat.tiles.filter(t => !t.slow && (!fam || t.family === fam));

// Size of a stereogram canvas in CSS px, from its box (capped).
function boxSize(cv, maxW = 960) {
  const r = cv.getBoundingClientRect();
  const w = clamp(Math.round(r.width || 640), 160, maxW);
  const h = Math.max(80, Math.round(w * (r.height && r.width ? r.height / r.width : 0.625)));
  return { w, h };
}
// The width that a canvas may use: its parent's content box.
function availW(cv) {
  const p = cv.parentElement, r = p.getBoundingClientRect(), cs = getComputedStyle(p);
  return Math.max(160, Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
}
// Show a canvas at one CSS px per canvas px (a pair must not scale up:
// that would move the two views apart).
function natural(cv) { cv.style.aspectRatio = `${cv.width} / ${cv.height}`; cv.style.width = `${cv.width}px`; cv.style.maxWidth = '100%'; cv.style.marginInline = 'auto'; }
// Vector canvas: device pixels, CSS-px drawing units.
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

// ---------------------------------------------------------------- figures
const figs = [];
const near = new Set();
const io = new IntersectionObserver(es => es.forEach(e => {
  const f = figs.find(x => x.el === e.target); if (!f) return;
  if (e.isIntersecting) { near.add(f); if (f.stale) { f.stale = false; f.render(); } } else near.delete(f);
}), { rootMargin: '300px' });
let observing = false;
function figure(el, render) {
  const f = { el, render, stale: true, token: 0, w: 0 };
  figs.push(f); if (observing) io.observe(el);
  return f;
}
function observeAll() { observing = true; figs.forEach(f => io.observe(f.el)); }
// Mark every figure for a new render; the near ones render now.
function refreshAll() { figs.forEach(f => { if (near.has(f)) f.render(); else f.stale = true; }); }
let rsT = 0, lastW = innerWidth;
addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; refreshAll(); } else figs.forEach(f => f.vector && f.render()); }, 200); });

// Run a job for a figure; the result is dropped if a newer job started.
async function job(f, op, args) {
  const t = ++f.token;
  f.el.classList.add('busy');
  try { const r = await run(op, args); return t === f.token ? r : null; }
  catch (err) { if (t === f.token) note(f.el, 'This figure needs the stereogram engine, which did not load: ' + err.message); return null; }
  finally { if (t === f.token) f.el.classList.remove('busy'); }
}
function note(el, txt) {
  let n = el.nextElementSibling;
  if (!n || !n.classList.contains('wait')) { n = document.createElement('p'); n.className = 'wait'; el.after(n); }
  n.textContent = txt;
}

// ---------------------------------------------------------------- view
function initView() {
  const setMode = m => {
    S.mode = m;
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
    $('dockMode').textContent = m === 'wall' ? 'Wall-eyed' : 'Cross-eyed';
    refreshAll();
  };
  const setReveal = on => {
    S.reveal = on;
    for (const id of ['revealBtn', 'dockReveal']) { const b = $(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    refreshAll();
  };
  $('modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.v); });
  $('dockMode').addEventListener('click', () => setMode(S.mode === 'wall' ? 'cross' : 'wall'));
  $('revealBtn').addEventListener('click', () => setReveal(!S.reveal));
  $('dockReveal').addEventListener('click', () => setReveal(!S.reveal));
  const help = $('help');
  const open = on => { help.hidden = !on; if (on) practice.render(); };
  $('helpBtn').addEventListener('click', () => open(true));
  $('dockHelp').addEventListener('click', () => open(true));
  $('helpClose').addEventListener('click', () => open(false));
  help.addEventListener('click', e => { if (e.target === help) open(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
  const cv = $('practiceCv');
  const practice = figure(cv, async () => {
    const { w, h } = boxSize(cv, 720);
    const r = await job(practice, 'stereo', { spec: { sdf: 'sphere', w, h, r: 0.6 }, tile: 'dots', opts: opts({ dpi: 64 }) });
    if (r) D.putImage(cv, r.img);
  });
}

// ---------------------------------------------------------------- hero
const hero = { frames: null, k: 0, t: 0, idx: 0, fig: null };
function initHero() {
  const cv = $('heroCv');
  hero.fig = figure(cv, async () => {
    const list = objects(), o = list[hero.idx % list.length];
    const { w, h } = boxSize(cv, 880);
    $('heroCap').innerHTML = objCredit(o);
    hero.frames = null;
    if (S.reveal) {
      const d = await job(hero.fig, 'depth', { spec: o.spec(w, h, 0) });
      if (d) D.putImage(cv, D.depthImage(d));
      return;
    }
    const n = REDUCED ? 1 : 30;
    const r = await job(hero.fig, 'turn', { spec: o.spec(w, h, 0), n, tile: 'color', opts: opts({ dpi: 64 }) });
    if (!r) return;
    hero.frames = r.frames; hero.k = 0;
    D.putImage(cv, r.frames[0]);
  });
  $('heroNext').addEventListener('click', () => { hero.idx++; hero.fig.render(); });
  const items = [
    ['1838', `Wheatstone names the stereoscope ${cite(['wheatstone1838'])}`],
    ['1960', `Julesz: random dots with a hidden shape ${cite(['julesz1960'])}`],
    ['1979', `Tyler and Clarke: one image holds both views ${cite(['tyler2014'])}`],
    ['1994', `the symmetric algorithm used today ${cite(['tiw1994'])}`],
  ];
  $('heroStats').innerHTML = items.map(([v, t]) => `<div><b>${v}</b><span>${t}</span></div>`).join('');
}

// ---------------------------------------------------------------- 01
const GEO0 = { I: 6.35, F: { x: 0, z: 40 }, P: { x: 5, z: 28 }, view: { x0: -24, x1: 24, z1: 60 } };
function initEyes() {
  const cv = $('geoCv'), st = JSON.parse(JSON.stringify(GEO0));
  let map = null, drag = null;
  const f = figure(cv, () => {
    const { g, w, h } = fit(cv);
    map = D.drawGeo(g, w, h, st) || map;
    const eta = G.disparity(st.I, st.P, st.F) * G.ARCMIN;
    const dP = Math.hypot(st.P.x, st.P.z), dF = Math.hypot(st.F.x, st.F.z);
    const approx = G.disparityApprox(st.I, dP, dF) * G.ARCMIN;
    const kind = Math.abs(eta) < 0.5 ? 'about zero: P is on the circle' : eta > 0 ? 'crossed: P looks nearer than F' : 'uncrossed: P looks farther than F';
    $('geoRead').innerHTML = `vergence at F <b>${(G.vergence(st.I, st.F.x, st.F.z) * 180 / Math.PI).toFixed(2)}°</b> · at P <b>${(G.vergence(st.I, st.P.x, st.P.z) * 180 / Math.PI).toFixed(2)}°</b> · disparity <b>${eta.toFixed(1)} arcmin</b>, ${kind} · small-angle form I&nbsp;Δd/d² gives <b>${approx.toFixed(1)}</b>`;
  });
  f.vector = true;
  const pick = e => {
    const r = cv.getBoundingClientRect(), p = map.inv(e.clientX - r.left, e.clientY - r.top);
    return p;
  };
  cv.addEventListener('pointerdown', e => {
    if (!map) return;
    const p = pick(e), dF = Math.hypot(p.x - st.F.x, p.z - st.F.z), dP = Math.hypot(p.x - st.P.x, p.z - st.P.z);
    drag = dF < dP ? 'F' : 'P';
    cv.setPointerCapture(e.pointerId); move(e);
  });
  const move = e => {
    if (!drag || !map) return;
    const p = pick(e);
    st[drag] = { x: clamp(p.x, st.view.x0 + 1, st.view.x1 - 1), z: clamp(p.z, 5, st.view.z1) };
    f.render();
  };
  cv.addEventListener('pointermove', move);
  const up = () => { drag = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  $('geoReset').addEventListener('click', () => { Object.assign(st, JSON.parse(JSON.stringify(GEO0))); f.render(); });
}

// ---------------------------------------------------------------- 02
const scope = { t: 0, fig: null };
function initScopes() {
  const sc = $('scopeCv');
  scope.fig = figure(sc, () => { const { g, w, h } = fit(sc); D.drawScope(g, w, h, scope.t); });
  scope.fig.vector = true;
  // stereo pair
  const cv = $('pairCv'), sel = $('pairModel');
  let view = 'pair';
  const f = figure(cv, async () => {
    const list = objects(), o = list.find(x => x.key === sel.value) || list[0];
    const w = availW(cv);
    // Wall-eyed pairs must sit closer than the eyes: halves near 5.5 cm.
    const half = view === 'ana' ? Math.min(w, 640) : S.mode === 'wall' ? Math.min(210, Math.floor((w - 8) / 2)) : Math.min(420, Math.floor((w - 8) / 2));
    const hh = Math.round(half * (view === 'ana' ? 0.6 : 0.85));
    const tiles = tilesOf();
    const tile = tiles.length ? tiles[(list.indexOf(o) * 7) % tiles.length].id : null;
    if (S.reveal) { const d = await job(f, 'depth', { spec: o.spec(half, hh, 0) }); if (d) { D.putImage(cv, D.depthImage(d)); natural(cv); } return; }
    const r = await job(f, 'pair', { spec: o.spec(half, hh, 0), tile, opts: { mode: S.mode, disparity: Math.round(half / 22), texSize: 48 } });
    if (!r) return;
    if (view === 'ana') D.putImage(cv, r.ana); else D.putPair(cv, r.left, r.right, 8);
    natural(cv);
  });
  sel.addEventListener('change', () => f.render());
  $('pairView').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; $('pairView').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); f.render(); });
  // Brewster's wallpaper
  const wc = $('wallCv'), win = $('wallIn');
  let tileCv = null;
  const wf = figure(wc, async () => {
    const r = wc.getBoundingClientRect(), w = clamp(Math.round(r.width || 800), 200, 1200), h = Math.round(w * (r.height && r.width ? r.height / r.width : 0.375));
    wc.width = w; wc.height = h;
    const period = Math.round(w < 600 ? 64 : 84);
    if (!tileCv) {
      tileCv = D.flowerTile(document.createElement('canvas'), 96);
      const bot = tilesOf().find(t => /botan|flor|leaf/i.test(t.family + ' ' + t.name));
      if (bot) {
        const img = await job(wf, 'tile', { id: bot.id, size: 96 });
        if (img) { tileCv.width = img.w; tileCv.height = img.h; tileCv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0); }
      }
    }
    const shift = +win.value;
    D.drawWall(wc.getContext('2d'), w, h, tileCv, period, shift);
    // Distances on a nominal screen: CSS px -> cm, viewer at 50 cm.
    const e = VIEW.eyeSepIn * 2.54, Dcm = 50, cm = px => px / CSS_PX_PER_IN * 2.54;
    const fmt = z => Number.isFinite(z) ? `${z.toFixed(0)} cm` : 'beyond any distance';
    const z0 = G.fusedDistance(cm(period), e, Dcm, S.mode), zl = G.fusedDistance(cm(period + shift), e, Dcm, S.mode), zr = G.fusedDistance(cm(period - shift), e, Dcm, S.mode);
    $('wallOut').textContent = `${shift} px`;
    note(wc, `Repeat ${period} CSS px. Fused ${S.mode === 'wall' ? 'wall-eyed' : 'cross-eyed'} from ${Dcm} cm on a screen with ${CSS_PX_PER_IN} CSS px per inch, the wall appears at about ${fmt(z0)}, the band at the left seam of the strip at about ${fmt(zl)} and the band at the right seam at about ${fmt(zr)}.`);
  });
  win.addEventListener('input', () => wf.render());
}

// ---------------------------------------------------------------- 03
function initJulesz() {
  const cv = $('rdsCv'), sel = $('rdsModel');
  let view = 'pair';
  const f = figure(cv, async () => {
    const list = objects(), o = list.find(x => x.key === sel.value) || list[1 % list.length];
    const w = availW(cv);
    const half = view === 'pair' ? (S.mode === 'wall' ? Math.min(210, Math.floor((w - 8) / 2)) : Math.min(420, Math.floor((w - 8) / 2))) : Math.min(w, 640);
    const hh = Math.round(half * (view === 'pair' ? 0.85 : 0.6));
    const r = await job(f, 'rds', { spec: o.spec(half, hh, 0), opts: { mode: S.mode, disparity: Math.max(3, Math.round(half / 28)), levels: 0 }, withDepth: S.reveal });
    if (!r) return;
    if (S.reveal && r.depth) D.putImage(cv, D.depthImage(r.depth));
    else if (view === 'ana') D.putImage(cv, r.ana);
    else if (view === 'one') D.putImage(cv, r.left);
    else D.putPair(cv, r.left, r.right, 8);
    natural(cv);
    $('rdsCap').innerHTML = (view === 'one'
      ? 'One eye\'s image alone: random dots, with no outline, shading or edge of any object. '
      : view === 'ana' ? 'The two images as a grey red-cyan anaglyph (red filter on the left eye). '
        : 'Free-fuse the two halves with the method set at the top. ') +
      `The object: ${objCredit(o)}. As in the 1960 paper, the right image is the left image with the object region shifted sideways and the gap filled with new dots. Here the shift follows the depth of every pixel of the model, not just one flat square ${cite(['julesz1960'])}.`;
  });
  sel.addEventListener('change', () => f.render());
  $('rdsView').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; $('rdsView').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); f.render(); });
}

// ---------------------------------------------------------------- 04
const row = { st: null, upTo: 0, playing: false, fig: null, depth: null, key: '' };
function initTyler() {
  const cv = $('rowCv');
  let rule = 'look';
  const E = 112, mu = BASE.mu, N = 360;
  const build = () => {
    const d = row.depth; if (!d) return;
    const z = G.depthRow(d, Math.round(+$('rowIn').value * (d.h - 1)));
    const same = rule === 'look' ? G.lookBackRow(z, E, mu) : G.symmetricRow(z, E, mu);
    const r = G.rng(7), cols = G.rowColours(same, () => r() < 0.5 ? '#111' : '#f4f4f4', rule === 'sym');
    row.st = { z, same, colours: cols, rule, sepFar: G.separation(0, mu, E), sepNear: G.separation(1, mu, E) };
    const free = same.reduce((n, v, i) => n + (v === i ? 1 : 0), 0);
    $('rowRead').innerHTML = `${rule === 'look' ? 'The look-back rule of 1979: one strip of seed dots, then copies.' : 'The symmetric rule of 1994: links placed evenly about each surface point, colours filled from the right.'} This row: ${N} pixels, repeat ${row.st.sepNear} px at the nearest point and ${row.st.sepFar} px at the background (E = ${E} px, μ = 1/3), ${free} free pixels that take new random dots. The depth is one row of the depth map of ${objCredit(objects()[hero.idx % objects().length])}.`;
  };
  row.fig = figure(cv, async () => {
    const o = objects()[hero.idx % objects().length];
    if (row.key !== o.key) {
      const d = await job(row.fig, 'depth', { spec: o.spec(N, Math.round(N * 0.62), 0) });
      if (!d) return;
      row.depth = d; row.key = o.key; build();
    }
    if (!row.st) build();
    const { g, w, h } = fit(cv);
    D.drawRow(g, w, h, Object.assign({}, row.st, { upTo: row.playing ? Math.floor(row.upTo) : N }));
  });
  row.fig.vector = true;
  $('rowIn').addEventListener('input', () => { build(); row.fig.render(); });
  $('rowRule').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; rule = b.dataset.v; $('rowRule').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); build(); row.fig.render(); });
  $('rowPlay').addEventListener('click', () => { row.playing = true; row.upTo = 0; });
  // furrows
  const fc = $('furrowCv');
  const ff = figure(fc, async () => {
    const { w, h } = boxSize(fc, 960);
    const spec = { grating: { cycles: 5, amp: 0.9 }, w, h };
    const r = await job(ff, 'stereo', { spec, tile: 'dots', opts: opts({ dpi: 64 }), withDepth: S.reveal });
    if (r) D.putImage(fc, S.reveal && r.depth ? D.depthImage(r.depth) : r.img);
  });
  $('preList').innerHTML = tlItems(TIMELINE.filter(t => +t.y.slice(0, 4) >= 1962 && +t.y.slice(0, 4) <= 1979 && !/Tyler/.test(t.t)), true);
}

// ---------------------------------------------------------------- 05
function initWork() {
  const cv = $('gratCv'), cyc = $('gratCyc'), amp = $('gratAmp');
  const f = figure(cv, async () => {
    const { w, h } = boxSize(cv, 960);
    const n = +cyc.value;
    $('gratCycOut').textContent = `${n}`;
    const hcm = h / CSS_PX_PER_IN * 2.54, cpd = G.cyclesPerDegree(n, hcm, 40);
    $('gratRead').innerHTML = `Horizontal furrows: depth that waves ${n} times from top to bottom. On a screen with ${CSS_PX_PER_IN} CSS px per inch, seen from 40 cm, that is about <b>${cpd.toFixed(2)} cycles per degree</b>. Tyler measured how fine such a corrugation can be and still be seen in depth ${cite(['tyler1974'])}; later work puts the limit near ${GRATING_LIMIT_CPD.lo}-${GRATING_LIMIT_CPD.hi} cycles per degree, many times coarser than the limit for gratings of light and dark ${cite(['allenmark2010'])}. At the top of the slider the furrows get hard to see; the dots themselves also limit this figure.`;
    const r = await job(f, 'stereo', { spec: { grating: { cycles: n, amp: +amp.value }, w, h }, tile: 'dots', opts: opts({ dpi: 64 }), withDepth: S.reveal });
    if (r) D.putImage(cv, S.reveal && r.depth ? D.depthImage(r.depth) : r.img);
  });
  cyc.addEventListener('input', () => f.render());
  amp.addEventListener('input', () => f.render());
  $('posList').innerHTML = TYLER_POSITIONS.map(p => `<li><span class="d">${esc(p.y)}</span><p>${esc(p.t)}</p></li>`).join('') + `<li><span class="d">¶</span><p class="src">${cite(['tylerCV'])}</p></li>`;
  $('workList').innerHTML = TYLER_WORKS.map(w => {
    const s = SOURCES[w.src];
    return `<li><b>${esc(s.cite.replace(/^[^"]*"([^"]+)".*$/, '$1'))}</b>${esc(w.what)}<span class="src">${esc(s.cite.split(',')[0])}${s.cite.match(/\b(19|20)\d\d\b/) ? ', ' + s.cite.match(/\b(19|20)\d\d\b/)[0] : ''} ${cite([w.src].concat(w.also || []))}</span></li>`;
  }).join('');
}

// ---------------------------------------------------------------- 06
function initCulture() {
  $('popList').innerHTML = tlItems(TIMELINE.filter(t => +t.y.slice(0, 4) >= 1983), true);
  const cv = $('popCv');
  let k = 0;
  const f = figure(cv, async () => {
    const list = objects(), o = list[(k * 5 + 3) % list.length];
    const tiles = tilesOf(), tile = tiles.length ? tiles[(k * 11 + 2) % tiles.length] : null;
    const { w, h } = boxSize(cv, 880);
    const r = await job(f, 'stereo', { spec: o.spec(w, h, 0), tile: tile ? tile.id : 'color', opts: opts({ dpi: 64 }), withDepth: S.reveal });
    if (!r) return;
    D.putImage(cv, S.reveal && r.depth ? D.depthImage(r.depth) : r.img);
    $('popCap').innerHTML = `${tile ? esc(tile.name) + ' (' + esc(tile.family) + ')' : 'coloured dots'} · ${objCredit(o)}`;
  });
  $('popNext').addEventListener('click', () => { k++; f.render(); });
}

// ---------------------------------------------------------------- 07
const big = { o: null, tile: null, tileK: 0 };
function initToday() {
  const cv = $('bigCv'), mu = $('bigMu'), yaw = $('bigYaw');
  const f = figure(cv, async () => {
    const list = objects();
    if (!big.o) big.o = list[0];
    const tiles = tilesOf();
    const tile = big.tile || (tiles.length ? tiles[big.tileK % tiles.length].id : 'dots');
    const { w, h } = boxSize(cv, 960);
    $('bigMuOut').textContent = (+mu.value).toFixed(2);
    $('bigYawOut').textContent = `${yaw.value}°`;
    const r = await job(f, 'stereo', { spec: big.o.spec(w, h, +yaw.value), tile, opts: opts({ mu: +mu.value }), withDepth: S.reveal });
    if (!r) return;
    D.putImage(cv, S.reveal && r.depth ? D.depthImage(r.depth) : r.img);
    const tl = tiles.find(t => t.id === tile);
    $('bigTitle').textContent = big.o.name;
    $('bigCap').innerHTML = `${objCredit(big.o)} · pattern: ${tl ? esc(tl.name) + ' (' + esc(tl.family) + ')' : tile === 'color' ? 'coloured dots' : 'random dots'}. Repeat ${Math.round(r.img.sepNear)}-${Math.round(r.img.sepFar)} px, μ = ${(+mu.value).toFixed(2)}${r.fallback ? ' (the model did not load; a shape stands in)' : ''}.`;
  });
  $('bigTile').addEventListener('click', () => { big.tile = null; big.tileK++; f.render(); });
  mu.addEventListener('input', () => f.render());
  yaw.addEventListener('input', () => f.render());
  // gallery: model and pattern pairs
  const grid = $('galGrid');
  const gal = figure(grid, async () => {
    const list = objects(), tiles = tilesOf(), n = Math.min(16, Math.max(6, list.length));
    grid.innerHTML = '';
    const items = [];
    for (let i = 0; i < n; i++) {
      const o = list[i % list.length], t = tiles.length ? tiles[(i * 5) % tiles.length] : null;
      const tileId = i % 4 === 3 ? 'dots' : t ? t.id : 'color';
      const b = document.createElement('button');
      b.innerHTML = `<canvas width="320" height="200"></canvas><b>${esc(o.name)}</b><span>${tileId === 'dots' ? 'random dots' : t ? esc(t.name) : 'coloured dots'}</span>`;
      b.addEventListener('click', () => { big.o = o; big.tile = tileId; grid.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); yaw.value = 0; f.render(); cv.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); });
      grid.appendChild(b);
      items.push({ o, tileId, cv: b.querySelector('canvas') });
    }
    const t = gal.token;
    for (const it of items) {
      if (t !== gal.token) return;
      const r = await run('stereo', { spec: it.o.spec(320, 200, 0), tile: it.tileId, opts: opts({ dpi: 48 }), withDepth: S.reveal }).catch(() => null);
      if (r && t === gal.token) D.putImage(it.cv, S.reveal && r.depth ? D.depthImage(r.depth) : r.img);
    }
  });
  const oldRender = gal.render;
  gal.render = () => { gal.token++; return oldRender(); };
}

// ---------------------------------------------------------------- text
function tlItems(list, mini = false) {
  return list.map(t => `<li><span class="d">${esc(t.y)}</span><h4>${esc(t.t)}</h4><p>${esc(t.d)}</p><span class="src">${cite(t.srcs)}${t.unsure ? `<span class="tag unsure" title="${esc(t.unsure)}">date unsure</span> ${mini ? '' : esc(t.unsure)}` : ''}</span></li>`).join('');
}
function initText() {
  document.querySelectorAll('.cites[data-cite]').forEach(el => { el.innerHTML = cite(el.dataset.cite.split(/\s+/)); });
  const q = (id, key) => { const Q = QUOTES[key], el = $(id); if (!el) return; el.innerHTML = el.tagName === 'BLOCKQUOTE' ? `“${esc(Q.text)}”<cite>${esc(SOURCES[Q.src].cite.split(',')[0])} ${cite([Q.src])}</cite>` : `“${esc(Q.text)}”`; };
  q('qScope', 'wheatstoneName'); q('qOutline', 'wheatstoneOutline'); q('qWall', 'brewsterWall'); q('qRelief', 'brewsterRelief'); q('qDefect', 'brewsterDefect');
  $('tlList').innerHTML = tlItems(TIMELINE);
  $('srcList').innerHTML = SRC_IDS.map(id => {
    const s = SOURCES[id], u = srcUrl(id);
    return `<li id="ref-${id}">${esc(s.cite)}. ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${s.doi ? 'doi:' + esc(s.doi) : 'link'}</a>` : ''}</li>`;
  }).join('');
}
function fillSelects() {
  const list = objects();
  for (const [id, k] of [['pairModel', 0], ['rdsModel', 1]]) {
    const sel = $(id), cur = sel.value;
    sel.innerHTML = list.map(o => `<option value="${esc(o.key)}">${esc(o.name)}</option>`).join('');
    sel.value = list.some(o => o.key === cur) ? cur : list[k % list.length].key;
  }
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
    links.forEach(a => { const on = !!best && a.dataset.target === best.id; a.classList.toggle('on', on); if (on) ol.scrollTo({ left: a.offsetLeft - ol.offsetLeft - 20, behavior: 'smooth' }); });
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

// ---------------------------------------------------------------- loop
let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (window.__sgSaver) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  if (hero.frames && hero.frames.length > 1 && near.has(hero.fig) && !S.reveal) {
    hero.t += dt;
    const k = Math.floor(hero.t * 8) % hero.frames.length;
    if (k !== hero.k) { hero.k = k; D.putImage($('heroCv'), hero.frames[k]); }
  }
  if (!REDUCED && near.has(scope.fig)) { scope.t += dt; scope.fig.render(); }
  if (row.playing && row.st && near.has(row.fig)) {
    row.upTo += dt * row.st.z.length / 4;
    if (row.upTo >= row.st.z.length) row.playing = false;
    row.fig.render();
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  initText();
  initView(); initHero(); initEyes(); initScopes(); initJulesz(); initTyler(); initWork(); initCulture(); initToday();
  initChips();
  typesetAll(document).catch(() => {});
  const timeout = new Promise(res => setTimeout(() => res(null), 8000));
  S.cat = await Promise.race([run('catalog').catch(() => null), timeout]) || { models: [], tiles: [], engine: false };
  fillSelects();
  observeAll();
  requestAnimationFrame(loop);
}
boot();

// ============================================================================
//  NONFLOWERS  ·  main.js — the mat, the controls, the summary, the herbarium
// ----------------------------------------------------------------------------
//  Our own page code around Nonflowers by Lingdong Huang (2018, MIT, see
//  LICENSE-nonflowers.txt). The engine runs in two workers (pool.js); this
//  module only shows what they return.
//
//  STATE. st.hist is the list of seeds seen, st.at the index on show. A new
//  flower uses st.next, a seed that the pool paints early, so it often
//  shows at once. The URL keeps ?seed=<token>, the upstream form.
//
//  MAT. One canvas: the tiled background paper of the seed (upstream makeBG,
//  shown on the body there) and the 600 px painting in the middle. The
//  device scale k of the painting is 2, 1, 1/2, 1/3 or 1/4 where the box
//  allows it (view.js fitScale), so each painting pixel is a whole number
//  of device pixels, or the reverse.
//
//  GREP MAP
//    grep -n 'function layout'         fit the mat in the clear area
//    grep -n 'function show'           paint a seed and show it
//    grep -n 'function newFlower'      the next seed, painted early
//    grep -n 'function drawMat'        paper tiles and the painting
//    grep -n 'function progress'       the stage line and bar
//    grep -n 'function renderSummary'  PAR as rows, swatches and curves
//    grep -n 'function openHerb'       the herbarium grid
//    grep -n 'function exportPNG'      paper + painting, with tEXt credit
//    grep -n 'function shareLink'      ?seed= link
// ============================================================================
import { createPool } from './pool.js';
import { UPSTREAM, SIZE, TILE, cleanSeed, seedToken, randomSeed, hsvToRgb } from './engine.js';
import { fitScale, layoutGrid, parseSeedFrom, pngWithText, FIELDS, GROUPS } from './view.js';
import { typeset } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const STAGES = { engine: 0, 'background paper': 0.02, 'painting paper': 0.06, woody: 0.12, herbal: 0.12, border: 0.94 };
const PAD = 40;   // the paper margin around the painting, in painting px

const pool = createPool(2);
const st = { hist: [], at: -1, plant: null, want: null, next: null, avgMs: 2600, saverOn: false, t0: 0, stage: '', fadeAt: 0, view: null, herbSeeds: [] };
const thumbs = new Map();   // seed -> { canvas, type } for the herbarium

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ── layout ─────────────────────────────────────────────────────────────────
// The clear part of #desk: the panel covers the left (desktop), the base
// (phone portrait) or the right (phone landscape) while it is open.
function layout() {
  if (st.saverOn) return;
  const desk = $('desk').getBoundingClientRect(), panel = $('panel');
  let L = desk.left, R = desk.right, T = desk.top, B = desk.bottom;
  if (panel.classList.contains('open')) {
    if (LAND_Q.matches) R = Math.min(R, innerWidth - panel.offsetWidth);
    else if (PHONE_Q.matches) { const top = desk.bottom - panel.offsetHeight; if (top - T > 170) B = top; }
    else L = Math.max(L, panel.offsetWidth);
  }
  const phone = PHONE_Q.matches, cap = phone ? 26 : 36, top = phone ? 10 : 64, m = phone ? 12 : 30;
  const aw = R - L - 2 * m, ah = B - T - top - m - cap, dpr = devicePixelRatio || 1;
  const box = Math.max(60, Math.min(aw, ah));
  // The painting scale, then the mat around it.
  const s = fitScale(SIZE, SIZE, dpr, box * SIZE / (SIZE + 2 * PAD), box * SIZE / (SIZE + 2 * PAD));
  const k = s * dpr, padDev = Math.round(PAD * k), pDev = Math.round(SIZE * k), matDev = pDev + 2 * padDev;
  const w = matDev / dpr;
  const x = Math.round((L + R) / 2 - w / 2 - desk.left), y = Math.round(T + top + (ah - w) / 2 - desk.top);
  const c = $('mat');
  c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.width = w + 'px'; c.style.height = w + 'px';
  if (c.width !== matDev) { c.width = matDev; c.height = matDev; }
  st.view = { x, y, w, k, padDev, pDev, matDev };
  const cp = $('caption'); cp.style.left = (x + w / 2) + 'px'; cp.style.top = (y + w + (phone ? 6 : 10)) + 'px';
  const pr = $('prog'); pr.style.left = (x + w / 2) + 'px'; pr.style.top = (y + w / 2 - 26) + 'px';
  drawMat();
}

// ── the mat ────────────────────────────────────────────────────────────────
// The background paper as a pattern at the painting scale, then the
// painting. alpha < 1 while a new plant fades in.
function drawMat(alpha = 1) {
  const c = $('mat'), g = c.getContext('2d'), v = st.view, p = st.plant;
  if (!v) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, c.width, c.height);
  if (!p) return;
  const pat = g.createPattern(p.bg, 'repeat');
  if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scale(v.k));
  g.fillStyle = pat || '#e9e2cf'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = v.k !== 1; g.imageSmoothingQuality = 'high';
  g.globalAlpha = alpha;
  g.drawImage(p.painting, v.padDev, v.padDev, v.pDev, v.pDev);
  g.globalAlpha = 1;
}
function fadeIn() {
  const t0 = performance.now();
  const step = now => {
    const a = Math.min(1, (now - t0) / 380);
    drawMat(a * a * (3 - 2 * a));
    if (a < 1 && !st.saverOn) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── progress ───────────────────────────────────────────────────────────────
// The stage line and a bar. The worker says when each stage starts; the
// bar moves on in between from the mean time of the plants so far.
function progress(on) {
  const el = $('prog');
  el.classList.toggle('on', on);
  if (!on) { cancelAnimationFrame(progress.raf); return; }
  const tick = () => {
    if (!st.want || st.plant && st.plant.seed === st.want) return;
    const ms = performance.now() - st.t0, floor = STAGES[st.stage] || 0;
    const frac = Math.max(floor, Math.min(0.97, ms / st.avgMs));
    $('progBar').style.width = (frac * 100).toFixed(1) + '%';
    const what = st.stage === 'woody' || st.stage === 'herbal' ? `a ${st.stage} plant` : st.stage || 'waiting for a worker';
    $('progLine').textContent = `Seed ${st.want} · ${what} · ${(ms / 1000).toFixed(1)} s`;
    progress.raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(progress.raf);
  progress.raf = requestAnimationFrame(tick);
}

// ── show a seed ────────────────────────────────────────────────────────────
function show(seed0, push = true) {
  const seed = cleanSeed(seed0);
  if (!seed) { toast('Type a seed first'); return; }
  if (push) { st.hist = st.hist.slice(0, st.at + 1); if (st.hist[st.hist.length - 1] !== seed) st.hist.push(seed); st.at = st.hist.length - 1; }
  st.want = seed; st.stage = ''; st.t0 = performance.now();
  pool.cancel('main');
  $('seed').value = seed; $('dockTitle').textContent = seed;
  syncNav();
  const hit = pool.cached(seed);
  if (!hit) progress(true);
  pool.paint(seed, { prio: 1, tag: 'main', onStage: s => { if (st.want === seed) st.stage = s; } }).then(p => {
    if (p.ms && p.where === 'worker') st.avgMs = st.avgMs * 0.6 + p.ms.total * 0.4;
    if (st.want !== seed) return;
    progress(false);
    st.plant = p;
    remember(p);
    if (hit) drawMat(); else fadeIn();
    caption(p); renderSummary(p); syncNav(); setURL(seed);
    prefetch();
  }).catch(err => {
    if (err && err.cancelled) return;
    if (st.want === seed) { progress(false); toast('This seed failed: ' + (err && err.message)); }
  });
}
function prefetch() {
  if (!st.next) st.next = randomSeed();
  pool.paint(st.next, { prio: 8, tag: 'next' }).catch(() => {});
}
function newFlower() {
  const s = st.next || randomSeed();
  st.next = null;
  show(s);
}
function back() { if (st.at > 0) { st.at--; show(st.hist[st.at], false); } }
function forward() { if (st.at < st.hist.length - 1) { st.at++; show(st.hist[st.at], false); } }
function syncNav() {
  const b = st.at <= 0, f = st.at >= st.hist.length - 1;
  $('backBtn').disabled = b; $('dockBack').disabled = b;
  $('fwdBtn').disabled = f; $('dockFwd').disabled = f;
}
function caption(p) {
  const t = p.ms ? (p.ms.total / 1000).toFixed(1) + ' s' : '';
  $('caption').innerHTML = `<i>Nonflowers</i> by Lingdong Huang · seed <span class="n">${esc(p.seed)}</span> · ${p.type}`;
  $('plantInfo').textContent = `A ${p.type} plant. Painted in ${t} (${p.where === 'main' ? 'main thread' : 'worker'}). Pixel hash ${p.hash}.`;
}
function setURL(seed) {
  try { history.replaceState(null, '', location.pathname + '?seed=' + seedToken(seed)); } catch (e) { /* a sandboxed frame */ }
}
function shareLink(seed) { return location.origin + location.pathname + '?seed=' + seedToken(seed); }

// ── summary ────────────────────────────────────────────────────────────────
function fmt(v) { return Number.isInteger(v) ? String(v) : Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1); }
const css = (h, s, v, a) => { const [r, g, b] = hsvToRgb(h, s, v); return `rgba(${r},${g},${b},${a.toFixed(3)})`; };
function curveSVG(ys) {
  let lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
  if (hi - lo < 1e-9) hi = lo + 1;
  const Y = v => (32 - (v - lo) / (hi - lo) * 30).toFixed(2);
  const pts = ys.map((v, i) => `${(i * 100 / (ys.length - 1)).toFixed(2)},${Y(v)}`).join(' ');
  return `<svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}"/><polyline points="${pts}"/></svg>`;
}
function renderSummary(p) {
  const par = p.par, off = p.type === 'woody' ? 'stem' : 'branch';
  let html = '';
  for (const g of Object.keys(GROUPS)) {
    html += `<div class="sum-g${g === off ? ' off' : ''}"><div class="sum-h">${GROUPS[g]}${g === off ? '<small>not used by this plant</small>' : ''}</div>`;
    for (const [key, name, grp] of FIELDS) {
      if (grp !== g || !par[key]) continue;
      const { kind, value } = par[key];
      if (kind === 'number') html += `<div class="sum-r"><span class="k" title="${key}">${name}</span><span class="v">${fmt(value)}</span></div>`;
      else if (kind === 'list') html += `<div class="sum-r"><span class="k" title="${key}">${name}</span><span class="v">${value[0] === 1 ? 'parallel, ' + value[1] : 'from the midrib, ' + value.slice(1).join(' / ')}</span></div>`;
      else if (kind === 'colour') {
        const a = css(...value.min), b = css(...value.max);
        html += `<div class="sum-r col"><span class="k" title="${key}: hsva ${value.min.map(fmt).join(', ')} to ${value.max.map(fmt).join(', ')}">${name}</span><span class="v">${Math.round(value.min[0])}° to ${Math.round(value.max[0])}°<i class="sw" style="background:linear-gradient(90deg,${a},${b})"></i></span></div>`;
      } else if (kind === 'curve') html += `<div class="sum-r crv"><span class="k" title="${key}, sampled at 100 points">${name}</span>${curveSVG(value)}</div>`;
    }
    html += '</div>';
  }
  $('summary').innerHTML = html;
}

// ── herbarium ──────────────────────────────────────────────────────────────
function remember(p) {
  if (thumbs.has(p.seed)) return;
  const c = document.createElement('canvas'), n = 300;
  c.width = n; c.height = n;
  const g = c.getContext('2d'), k = n / SIZE;
  const pat = g.createPattern(p.bg, 'repeat');
  if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scale(k));
  g.fillStyle = pat || '#e9e2cf'; g.fillRect(0, 0, n, n);
  g.imageSmoothingQuality = 'high';
  g.drawImage(p.painting, 0, 0, n, n);
  thumbs.set(p.seed, { canvas: c, type: p.type });
}
function openHerb() {
  $('herb').hidden = false;
  $('dockHerb').classList.add('on');
  $('herbGrid').replaceChildren();   // rebuilt in seed order; painted sheets come from thumbs
  if (!st.herbSeeds.length) addHerb(12);
  else drawHerb();
}
function closeHerb() {
  $('herb').hidden = true;
  $('dockHerb').classList.remove('on');
  pool.cancel('herb');
}
function addHerb(n) {
  for (let i = 0; i < n; i++) st.herbSeeds.push(randomSeed());
  drawHerb();
}
function drawHerb() {
  const grid = $('herbGrid'), w = grid.clientWidth || 600;
  const L = layoutGrid(w, grid.clientHeight, st.herbSeeds.length);
  grid.style.gridTemplateColumns = `repeat(${L.cols}, minmax(0, 1fr))`;
  const have = new Set([...grid.children].map(c => c.dataset.seed));
  for (const seed of st.herbSeeds) {
    if (have.has(seed)) continue;
    const card = document.createElement('button');
    card.className = 'hb-card wait'; card.dataset.seed = seed;
    card.innerHTML = `<canvas width="300" height="300"></canvas><b>${esc(seed)}</b><small>painting…</small>`;
    card.addEventListener('click', () => { closeHerb(); show(seed); });
    grid.append(card);
    const fill = t => {
      card.querySelector('canvas').getContext('2d').drawImage(t.canvas, 0, 0);
      card.querySelector('small').textContent = t.type;
      card.classList.remove('wait');
    };
    if (thumbs.has(seed)) fill(thumbs.get(seed));
    else pool.paint(seed, { prio: 6, tag: 'herb' }).then(p => { remember(p); fill(thumbs.get(seed)); }).catch(err => {
      // Closing the herbarium cancels the queued sheets: paint them again on the next open.
      if (err && err.cancelled) card.remove(); else { card.classList.remove('wait'); card.querySelector('small').textContent = 'not painted'; }
    });
  }
  [...grid.children].forEach(c => c.classList.toggle('on', st.plant && c.dataset.seed === st.plant.seed));
  $('herbCount').textContent = `${st.herbSeeds.length} sheets`;
}

// ── export ─────────────────────────────────────────────────────────────────
// As upstream makeDownload(): a 600 px canvas, the background paper in
// 512 px tiles, the painting on top. The tEXt chunks credit Lingdong Huang.
function exportPNG() {
  const p = st.plant;
  if (!p) return;
  const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  for (let i = 0; i < SIZE; i += TILE) for (let j = 0; j < SIZE; j += TILE) g.drawImage(p.bg, i, j);
  g.drawImage(p.painting, 0, 0);
  c.toBlob(b => {
    if (!b) { toast('The browser could not make this PNG'); return; }
    b.arrayBuffer().then(buf => {
      const png = pngWithText(new Uint8Array(buf), {
        Author: 'Lingdong Huang',
        Title: `Nonflowers, seed ${p.seed}`,
        Software: `Nonflowers by Lingdong Huang (MIT), ${UPSTREAM.url} commit ${UPSTREAM.commit}; page wrapper by davesgames.io`,
        Source: shareLink(p.seed),
        Comment: `seed=${p.token} type=${p.type}`,
      });
      const name = 'nonflowers-by-lingdong-huang-seed-' + (p.seed.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'x') + '.png';
      const u = URL.createObjectURL(new Blob([png], { type: 'image/png' })), a = document.createElement('a');
      a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      toast('PNG saved');
    });
  }, 'image/png');
}
async function copyLink() {
  const p = st.plant || { seed: st.want };
  if (!p.seed) return;
  const url = shareLink(p.seed), out = $('linkOut');
  out.value = url; out.hidden = false;
  try { await navigator.clipboard.writeText(url); toast('Link copied'); return; } catch (e) { /* no permission in a frame */ }
  out.focus(); out.select();
  toast('Copy the link from the field');
}

// ── panel and sheet ────────────────────────────────────────────────────────
const panel = $('panel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  layout();
}
function bindPanel() {
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  panel.addEventListener('transitionend', e => { if (e.target === panel) layout(); });
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

function bindUI() {
  $('seedForm').addEventListener('submit', e => { e.preventDefault(); $('seed').blur(); show($('seed').value); });
  for (const id of ['newBtn', 'newBtn2', 'dockName']) $(id).addEventListener('click', newFlower);
  $('backBtn').addEventListener('click', back); $('dockBack').addEventListener('click', back);
  $('fwdBtn').addEventListener('click', forward); $('dockFwd').addEventListener('click', forward);
  $('herbBtn').addEventListener('click', openHerb);
  $('dockHerb').addEventListener('click', () => ($('herb').hidden ? openHerb() : closeHerb()));
  $('herbClose').addEventListener('click', closeHerb);
  $('herbMore').addEventListener('click', () => addHerb(12));
  $('pngBtn').addEventListener('click', exportPNG);
  $('linkBtn').addEventListener('click', copyLink);
  addEventListener('keydown', e => {
    if (st.saverOn || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if (e.key === 'Escape' && !$('herb').hidden) closeHerb();
    else if (k === 'n' || k === 'r') newFlower();
    else if (e.key === 'ArrowLeft') back();
    else if (e.key === 'ArrowRight') forward();
    else if (k === 'h') ($('herb').hidden ? openHerb() : closeHerb());
    else if (k === 'd') exportPNG();
  });
  addEventListener('resize', () => { layout(); if (!$('herb').hidden) drawHerb(); });
}

// ── equations (About) ──────────────────────────────────────────────────────
function equations() {
  typeset($('eqBorder'), String.raw`r(\theta) = 0.98\,\left(\cos^{a}\theta + \sin^{a}\theta\right)^{-1/a}`, { rules: [[String.raw`\theta`, 'm1'], ['a', 'm2']] });
  typeset($('eqColour'), String.raw`c(x) = \frac{1}{1 + e^{-k\,(x + x_0 - 1/2)}}`, { rules: [['x_0', 'm4'], ['k', 'm3'], ['x', 'm1']] });
}

// ── boot ───────────────────────────────────────────────────────────────────
bindUI(); bindPanel();
if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
layout();
show(parseSeedFrom(location.search, location.hash) || randomSeed());
equations();

window.__nf = {
  st, pool, show, newFlower, back, forward, openHerb, closeHerb, exportPNG, layout, setOpen, thumbs,
  get ready() { return !!st.plant && st.plant.seed === st.want; },
};

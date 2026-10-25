// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  main.js  (CORE, module)
// ----------------------------------------------------------------------------
//  Builds the page from story/*.js and equations.js, mounts the figures,
//  and runs the one animation loop. The binding spec is CONTRACT.md; the
//  mount protocol for the packages is in NOTES.md (2026-10-24 CORE lines).
//
//  FLOW
//    1. buildChapter() writes each chapter of CHAPTERS into its <section>
//       shell (chapter 0 into #heroBody). Equations are [data-tex] boxes.
//    2. A "near" IntersectionObserver typesets a chapter's TeX with
//       ../../lib/sci-math.js and mounts its figure cards when the chapter
//       comes within about one screen.
//    3. mountHost() loads a package with a dynamic import and calls its
//       create*(host, { scene, reduced }). A failed import gives a
//       placeholder, so the page loads before a package lands.
//    4. A "vis" IntersectionObserver marks the cards on screen. loop()
//       calls play(t) only on those; t is on-screen seconds. A package
//       that has pause() and resume() gets them on visibility change.
//    5. model/index.js (dynamic import) fills the tables of c6, c8, c9.
//    6. window.alphaPage = { goto(chapter), figure(name) } for SAVER, and
//       ./saver/index.js is imported last (a failed import is ignored).
//
//  GREP MAP
//      grep -n 'function buildChapter'   one chapter from its story object
//      grep -n 'function block'          one story block -> HTML
//      grep -n 'function figureCard'     one figure card and its hosts
//      grep -n 'function mountHost'      dynamic import of a package
//      grep -n 'function setScene'       scene buttons -> show()
//      grep -n 'function placeholder'    the stand-in figure
//      grep -n 'function createScreen'   the c1 screening figure (CORE)
//      grep -n 'function buildTables'    configs, sectors, measurements
//      grep -n 'function initNav'        rail, phone menu, progress
//      grep -n 'function loop'           the one rAF loop
//      grep -n 'window.alphaPage'        the SAVER hook
// ============================================================================
import { CHAPTERS, GLOSSARY, SOURCES, CREDITS, CHAPTER_REFS, MEASURED } from './story/index.js';
import { EQ } from './equations.js';
import { typesetAll } from '../../lib/sci-math.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const SRC_IDS = Object.keys(SOURCES);

// Package entry points (NOTES.md). The c1 figure is CORE's own ('core').
const PKG = {
  strands: ['./strands/index.js', 'createStrands'],
  ends: ['./ends/index.js', 'createEnds'],
  records: ['./records/index.js', 'createRecords'],
  compare: ['./compare/index.js', 'createCompare'],
};
const TAGS = { paper: "the paper's result, our drawing", model: 'our model', analogy: 'analogy' };
// The candidate, for the tables when model/ is not loaded (CONTRACT.md).
const CAND_INV = '137.035999189566155029183744020866';
const PAPER_SECTORS = { '++': 79, '+-': 48, '-+': 42, '--': 3 };
const PAPER_N = 31104;

const modelP = import('./model/index.js').catch(e => { console.info('alpha-qudits: model/ not loaded', e && e.message); return null; });

// ---------------------------------------------------------------- build
const cards = new Map();          // figure id -> card state
const chapters = [];              // { ch, el, typeset: bool }

function block(b) {
  if (b.p) return `<p class="prose">${b.p}</p>`;
  if (b.eq) {
    const tex = EQ[b.eq];
    if (tex == null) return `<div class="eq"><p class="eq-note">Missing equation ${esc(b.eq)}</p></div>`;
    return `<div class="eq" data-eq="${esc(b.eq)}"><div class="sci-eq" data-tex="${esc(tex)}"></div>${b.note ? `<p class="eq-note">${b.note}</p>` : ''}</div>`;
  }
  if (b.list) return `<ul class="list">${b.list.map(x => `<li>${x}</li>`).join('')}</ul>`;
  if (b.quote) return `<blockquote class="quote"><p>${b.quote}</p>${b.cite ? `<cite>${b.cite}</cite>` : ''}</blockquote>`;
  if (b.aside) return `<div class="aside">${b.aside}</div>`;
  if (b.analogy) {
    const a = b.analogy;
    return `<div class="analogy" data-analogy="${esc(a.name)}"><h4>Analogy: ${esc(a.name)}</h4><div class="two"><div><h5>What it gets right</h5><p>${a.right}</p></div><div><h5>Where it breaks</h5><p>${a.breaks}</p></div></div></div>`;
  }
  if (b.more) return `<details class="more"><summary>${esc(b.more.title)}</summary><div class="more-body">${b.more.blocks.map(block).join('')}</div></details>`;
  if (b.table) return `<div class="tbl" data-table="${esc(b.table)}"></div>`;
  if (b.fig) return `<div data-fig="${esc(b.fig)}"></div>`;
  return '';
}

function refsLine(id) {
  const ids = CHAPTER_REFS[id] || [];
  if (!ids.length) return '';
  return `<p class="refs-ch">Sources: ${ids.map(s => `<a href="#ref-${s}">[${SRC_IDS.indexOf(s) + 1}]</a>`).join('')}</p>`;
}

function buildChapter(ch) {
  const el = ch.hero ? $('heroBody') : $(ch.id);
  if (!el) return null;
  const head = ch.hero ? '' : `<div class="ch-head"><span class="ch-num">${pad(ch.num)}</span><h2>${ch.title}</h2></div>`;
  el.innerHTML = head + ch.blocks.map(block).join('') + refsLine(ch.id);
  el.querySelectorAll('[data-fig]').forEach(slot => {
    const id = slot.dataset.fig, spec = ch.figures && ch.figures[id];
    if (!spec) { slot.remove(); return; }
    slot.replaceWith(figureCard(id, spec, ch));
  });
  const rec = { ch, el: ch.hero ? $(ch.id) : el, body: el, typeset: false };
  chapters.push(rec);
  return rec;
}

// ---------------------------------------------------------------- figures
function figureCard(id, spec, ch) {
  const el = document.createElement('figure');
  el.className = 'fig'; el.id = id;
  const scenes = spec.scenes || [];
  el.innerHTML = `<div class="fig-top"><h3>${spec.title}</h3><span class="tag ${esc(spec.tag)}">${esc(TAGS[spec.tag] || spec.tag)}</span></div>`
    + (scenes.length > 1 ? `<div class="scenes" role="group" aria-label="Scenes">${scenes.map(s => `<button type="button" data-scene="${esc(s.id)}">${esc(s.label)}</button>`).join('')}</div>` : '')
    + `<div class="hosts"></div><figcaption class="cap"></figcaption>`;
  const card = { id, spec, ch, el, hostsEl: el.querySelector('.hosts'), capEl: el.querySelector('.cap'), hosts: new Map(), scene: null, pkg: null, visible: false, t: 0 };
  cards.set(id, card);
  el.querySelectorAll('[data-scene]').forEach(b => b.addEventListener('click', () => setScene(card, b.dataset.scene)));
  if (scenes[0]) paintScene(card, scenes[0]);
  nearIO.observe(el); visIO.observe(el);
  return el;
}

const scenePkg = (card, s) => s.pkg || card.spec.pkg;

function paintScene(card, s) {
  card.el.querySelectorAll('[data-scene]').forEach(b => { const on = b.dataset.scene === s.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  card.capEl.innerHTML = s.cap || '';
}

// Load and mount one package in its own host of the card. Returns the host
// record { el, inst, ready }. A failure leaves a placeholder instance.
function mountHost(card, pkg, scene) {
  if (card.hosts.has(pkg)) return card.hosts.get(pkg).ready;
  const el = document.createElement('div');
  el.className = 'host'; el.dataset.pkg = pkg;
  card.hostsEl.appendChild(el);
  const h = { el, inst: null, ready: null, scene };
  card.hosts.set(pkg, h);
  h.ready = (async () => {
    let inst = null;
    try {
      if (pkg === 'core') inst = createScreen(el, { scene, reduced: REDUCED });
      else {
        const [path, name] = PKG[pkg] || [];
        if (!path) throw new Error(`no package ${pkg}`);
        const mod = await import(path);
        if (typeof mod[name] !== 'function') throw new Error(`${path} has no export ${name}`);
        inst = await mod[name](el, { scene, reduced: REDUCED, notes: false });
      }
    } catch (e) {
      console.info(`alpha-qudits: ${pkg} figure not mounted (${e && e.message})`);
      el.replaceChildren();
      inst = placeholder(el, pkg, scene);
    }
    h.inst = inst || placeholder(el, pkg, scene);
    if (typeof ResizeObserver === 'function') {
      let w = 0;
      new ResizeObserver(es => { const nw = Math.round(es[0].contentRect.width); if (nw !== w) { w = nw; try { h.inst.resize && h.inst.resize(); } catch (e) { console.warn(e); } } }).observe(el);
    }
    if (!card.visible && h.inst.pause) try { h.inst.pause(); } catch (e) { /* ignore */ }
    return h;
  })();
  return h.ready;
}

async function setScene(card, sceneId, params) {
  const s = (card.spec.scenes || []).find(x => x.id === sceneId) || card.spec.scenes[0];
  if (!s) return null;
  const pkg = scenePkg(card, s);
  paintScene(card, s);
  card.scene = s.id;
  const fresh = !card.hosts.has(pkg);
  const prev = card.pkg && card.hosts.get(card.pkg);
  card.pkg = pkg;
  for (const [p, h] of card.hosts) {
    h.el.hidden = p !== pkg;
    if (p !== pkg && h.inst && h.inst.pause) try { h.inst.pause(); } catch (e) { /* ignore */ }
  }
  const h = await mountHost(card, pkg, s.id);
  if (card.pkg !== pkg) return h.inst;            // a newer click won
  h.el.hidden = false;
  if (prev && prev !== h && prev.inst && prev.inst.pause) try { prev.inst.pause(); } catch (e) { /* ignore */ }
  if (card.visible && h.inst.resume) try { h.inst.resume(); } catch (e) { /* ignore */ }
  if ((!fresh || h.scene !== s.id || params) && h.inst.show) {
    try { await h.inst.show(s.id, params || s.params || {}); } catch (e) { console.warn(`alpha-qudits: show(${s.id})`, e); }
  }
  h.scene = s.id;
  return h.inst;
}

const activeInst = card => { const h = card.pkg && card.hosts.get(card.pkg); return h && h.inst; };

// The stand-in for a package that has not landed. Same API as a figure.
function placeholder(host, pkg, scene) {
  const wrap = document.createElement('div');
  wrap.className = 'ph';
  wrap.innerHTML = `<canvas aria-hidden="true"></canvas><p class="ph-label"><b>${esc(pkg)} · <span>${esc(scene)}</span></b><br>This figure is not loaded. The text around it still holds.</p>`;
  host.appendChild(wrap);
  const cv = wrap.querySelector('canvas'), label = wrap.querySelector('span');
  let cur = scene;
  const draw = t => {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const g = cv.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const cols = ['#62c4ff', '#ff9a62', '#86dc7c'];
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = h * 0.42 + Math.sin(x / w * Math.PI * 2 + t * 0.7 + k * 2.1) * h * 0.12 * Math.sin(x / w * Math.PI);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = cols[k]; g.globalAlpha = 0.35; g.lineWidth = 1.5; g.stroke();
    }
    g.globalAlpha = 1;
  };
  draw(0);
  return { scenes: [scene], saverShots: [], show(s) { cur = s; label.textContent = s; draw(0); }, play(t) { draw(t); }, resize() { draw(0); }, dispose() { wrap.remove(); }, placeholder: true, get scene() { return cur; } };
}

// ---------------------------------------------------------------- screening (c1)
// CORE's own figure. Left: a bare charge in a cloud of short-lived
// electron-positron pairs; the pairs inside the probe circle screen what
// the probe sees. Right: 1/alpha(Q) from the full one-loop electron term
// (spacelike Q), our model; the PDG point at the Z mass for contrast.
const ME = 0.51099895;                       // electron mass, MeV
const MZ = 91187.6;                          // Z mass, MeV
const INV0 = 137.035999177;                  // CODATA 2022
const INV_MZ = 127.95;                       // PDG 2022, all charged fermions
function invAlphaOneLoop(Q) {
  // 1/alpha(Q) = 1/alpha(0) - (2/pi) int_0^1 x(1-x) ln(1 + x(1-x) Q^2/m^2) dx
  const q2 = (Q / ME) ** 2;
  let s = 0; const n = 64;
  for (let i = 0; i <= n; i++) {
    const x = i / n, w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    s += w * x * (1 - x) * Math.log1p(x * (1 - x) * q2);
  }
  return INV0 - (2 / Math.PI) * s / (3 * n);
}

function createScreen(host, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'screen';
  wrap.innerHTML = `<canvas class="sc-cloud" aria-label="A bare charge surrounded by short-lived electron-positron pairs; a dashed probe circle marks the distance of the measurement."></canvas>
    <canvas class="sc-chart" aria-label="Chart of 1 over alpha against the momentum transfer Q, from the electron mass to the Z mass."></canvas>
    <div class="ctl"><label>Probe <input type="range" min="0" max="1000" value="560" aria-label="Momentum transfer of the probe"></label><output></output></div>`;
  host.appendChild(wrap);
  const cv = wrap.querySelector('.sc-cloud'), ch = wrap.querySelector('.sc-chart'), inp = wrap.querySelector('input'), out = wrap.querySelector('output');
  const X0 = -0.6, X1 = Math.log10(MZ) + 0.15;            // log10(Q / MeV)
  let x = X0 + (X1 - X0) * 0.56, touched = !!opts.reduced, tNow = 0;
  // Pairs: radius in units of the cloud radius, angle, phase, rate. More
  // pairs near the charge, as the polarization is strongest there.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pairs = Array.from({ length: 190 }, () => ({ r: 0.07 + 0.93 * Math.pow(rnd(), 0.75), a: rnd() * Math.PI * 2, ph: rnd() * Math.PI * 2, w: 0.6 + rnd() * 1.2 }));
  const curve = Array.from({ length: 160 }, (_, i) => { const lx = X0 + (X1 - X0) * i / 159; return [lx, invAlphaOneLoop(10 ** lx)]; });
  const fmtQ = Q => Q < 1 ? `${(Q * 1000).toFixed(0)} keV` : Q < 1000 ? `${Q.toFixed(Q < 10 ? 1 : 0)} MeV` : `${(Q / 1000).toFixed(Q < 1e4 ? 1 : 0)} GeV`;
  const probeR = () => 0.94 - 0.82 * (x - X0) / (X1 - X0);

  function fit(c) {
    const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    if (g) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); }
    return { g, w, h };
  }
  function drawCloud(t) {
    const { g, w, h } = fit(cv);
    if (!g) return;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46, rp = probeR() * R;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    grd.addColorStop(0, 'rgba(255,214,102,0.20)'); grd.addColorStop(1, 'rgba(255,214,102,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * 0.5, 0, Math.PI * 2); g.fill();
    for (const p of pairs) {
      const life = Math.max(0, Math.sin(p.ph + t * p.w));
      if (life < 0.02) continue;
      const inside = p.r * R < rp;
      const al = life ** 1.4 * (inside ? 0.95 : 0.28);
      const r = p.r * R, ux = Math.cos(p.a), uy = Math.sin(p.a), d = 3.2 + 2.5 * (1 - p.r);
      const ex = cx + ux * (r - d), ey = cy + uy * (r - d), px = cx + ux * (r + d), py = cy + uy * (r + d);
      g.globalAlpha = al * 0.6; g.strokeStyle = '#8b93a7'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(px, py); g.stroke();
      g.globalAlpha = al;
      g.fillStyle = '#62c4ff'; g.beginPath(); g.arc(ex, ey, 2.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff7a7a'; g.beginPath(); g.arc(px, py, 2.3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // The probe circle.
    g.setLineDash([5, 6]); g.strokeStyle = 'rgba(255,214,102,0.85)'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(cx, cy, rp, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    // The bare charge.
    g.fillStyle = '#ffd666'; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#06080d'; g.font = '600 12px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+', cx, cy + 0.5);
    g.font = '12px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#c4c9d6'; g.fillText('probe', cx + rp * 0.71 + 6, cy - rp * 0.71 - 4);
    g.fillStyle = '#62c4ff'; g.fillText('e⁻', 10, h - 12); g.fillStyle = '#ff7a7a'; g.fillText('e⁺', 34, h - 12);
    g.fillStyle = '#8b93a7'; g.fillText('bright: pairs between the probe and the charge', 58, h - 12);
  }
  function drawChart() {
    const { g, w, h } = fit(ch);
    const v = invAlphaOneLoop(10 ** x);
    out.textContent = `Q = ${fmtQ(10 ** x)}, 1/α ≈ ${v.toFixed(3)}`;
    if (!g) return null;
    const L = 40, Rr = 12, T = 16, B = 34, pw = w - L - Rr, ph = h - T - B;
    const Y0 = 126.8, Y1 = 137.8;
    const sx = v => L + (v - X0) / (X1 - X0) * pw, sy = v => T + (Y1 - v) / (Y1 - Y0) * ph;
    g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = '#8b93a7'; g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let v = 128; v <= 137; v += 3) { g.beginPath(); g.moveTo(L, sy(v)); g.lineTo(L + pw, sy(v)); g.stroke(); g.textAlign = 'right'; g.fillText(String(v), L - 6, sy(v) + 4); }
    const ticks = [[0, '1 MeV'], [2, '100 MeV'], [4, '10 GeV']];
    for (const [v, s] of ticks) { g.beginPath(); g.moveTo(sx(v), T); g.lineTo(sx(v), T + ph); g.stroke(); g.textAlign = 'center'; g.fillText(s, sx(v), T + ph + 15); }
    g.textAlign = 'left'; g.fillText('momentum transfer Q (log scale)', L, h - 4);
    g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('1/α', 0, 0); g.restore();
    // Electron-only one-loop curve.
    g.strokeStyle = '#ffd666'; g.lineWidth = 2; g.beginPath();
    curve.forEach(([lx, v], i) => i ? g.lineTo(sx(lx), sy(v)) : g.moveTo(sx(lx), sy(v))); g.stroke();
    // The PDG point at the Z mass.
    const zx = sx(Math.log10(MZ)), zy = sy(INV_MZ);
    g.fillStyle = '#e889dc'; g.beginPath(); g.arc(zx, zy, 4.5, 0, Math.PI * 2); g.fill();
    g.textAlign = 'right'; g.fillText('measured at the Z mass, all charged', zx - 8, zy + 4); g.fillText('particles: about 1/128', zx - 8, zy + 18);
    g.fillStyle = '#ffd666'; g.textAlign = 'left'; g.fillText('electron loop only (our model)', L + 6, sy(134.6) - 4);
    g.fillStyle = '#c4c9d6'; g.fillText('Q → 0: 1/137.036', L + 6, sy(INV0) + 14);
    // The probe point.
    g.strokeStyle = 'rgba(255,214,102,0.5)'; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(sx(x), T); g.lineTo(sx(x), T + ph); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(x), sy(v), 4.5, 0, Math.PI * 2); g.fill();
    return { sx, X0, X1, L, pw };
  }
  let geo = null;
  const setX = v => { x = Math.max(X0, Math.min(X1, v)); inp.value = Math.round((x - X0) / (X1 - X0) * 1000); };
  inp.addEventListener('input', () => { touched = true; x = X0 + (X1 - X0) * inp.value / 1000; drawCloud(tNow); geo = drawChart(); });
  const fromPointer = e => { if (!geo) return; const r = ch.getBoundingClientRect(); setX(geo.X0 + (e.clientX - r.left - geo.L) / geo.pw * (geo.X1 - geo.X0)); touched = true; drawCloud(tNow); geo = drawChart(); };
  ch.addEventListener('pointerdown', e => { ch.setPointerCapture(e.pointerId); fromPointer(e); });
  ch.addEventListener('pointermove', e => { if (ch.hasPointerCapture && ch.hasPointerCapture(e.pointerId)) fromPointer(e); });
  setX(x);
  drawCloud(0); geo = drawChart();
  return {
    scenes: ['screen'],
    saverShots: [{ scene: 'screen', seconds: 8 }],
    show() { drawCloud(tNow); geo = drawChart(); },
    play(t) {
      tNow = t;
      if (!touched) setX(X0 + (X1 - X0) * (0.5 + 0.42 * Math.sin(t * 0.25)));
      drawCloud(t); geo = drawChart();
    },
    resize() { drawCloud(tNow); geo = drawChart(); },
    dispose() { wrap.remove(); },
  };
}

// ---------------------------------------------------------------- tables
const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function factor23(n) {
  let a = 0, b = 0, m = n;
  while (m % 2 === 0) { m /= 2; a++; }
  while (m % 3 === 0) { m /= 3; b++; }
  return m === 1 ? `2<sup>${a}</sup>3<sup>${b}</sup>` : fmtInt(n);
}
function armsText(c) {
  if (typeof c.label === 'string') return c.label;
  const a = c.arms;
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(x => typeof x === 'string' ? x : `${x.far ?? x.e ?? x.d}${x.read ? 'R' : 'U'}`).join(' ');
  return '?';
}
// '137.035999189566' -> '137.035 999 189 566' (thin groups of three).
// records: a number, or MODEL's [{ far, pairs, records }] per pair of read
// arms; the distinct counts, joined.
const recordsText = r => Array.isArray(r) ? [...new Set(r.map(x => typeof x === 'number' ? x : x.records))].join(' / ') : (r ?? '');
const inv = digits => { const [i, f = ''] = String(digits).split('.'); return f ? `${i}.${f.match(/.{1,3}/g).join(' ')}` : i; };

function sigmaOf(candInv, meas) {
  // Offsets in units of u, from decimal strings (enough digits in a double
  // for a difference of 1e-8 with 1e-15 rounding).
  return (parseFloat(candInv) - parseFloat(meas.inv)) / parseFloat(meas.u);
}

async function buildTables() {
  const M = await modelP;
  const hosts = [...document.querySelectorAll('.tbl[data-table]')];
  for (const el of hosts) {
    const kind = el.dataset.table;
    try {
      if (kind === 'configs') tableConfigs(el, M);
      else if (kind === 'sectors') tableSectors(el, M);
      else if (kind === 'measurements') tableMeasurements(el, M);
      else if (kind === 'glossary') el.innerHTML = `<h4>Glossary</h4><dl class="gloss">${GLOSSARY.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`;
      else if (kind === 'sources') el.innerHTML = `<h4>Sources</h4><ol class="refs">${SRC_IDS.map(id => { const s = SOURCES[id]; const link = s.doi ? ` <a href="https://doi.org/${esc(s.doi)}" rel="noopener">doi:${esc(s.doi)}</a>` : s.url ? ` <a href="${esc(s.url)}" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))}</a>` : ''; return `<li id="ref-${id}">${esc(s.text)}${link}</li>`; }).join('')}</ol>`;
      else if (kind === 'credits') el.innerHTML = `<h4>Credits</h4><div class="credits">${CREDITS.map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
    } catch (e) {
      console.warn(`alpha-qudits: table ${kind}`, e);
      el.innerHTML = `<p class="model-note">This table could not be built (${esc(e.message)}).</p>`;
    }
  }
}

function tableConfigs(el, M) {
  const list = M && typeof M.enumerateConfigs === 'function' ? M.enumerateConfigs() : null;
  if (!list || !list.length) {
    el.innerHTML = `<h4>The 23 readable configurations</h4><p class="sub">Our model (model/) builds this table from the configuration rules. It has not loaded, so here is the paper's summary: 76 configurations, 42 under the read cap, 23 readable; the end rule removes 9, the two-point function 12 more, and the acting charge the last one but the object.</p>`;
    return;
  }
  const isReadable = c => c.readable ?? true;
  const underCap = c => c.admitted ?? c.cap ?? c.underCap ?? true;
  const readable = list.filter(isReadable);
  const nCap = list.filter(underCap).length;
  const F = [['endRule', 'End rule'], ['twoPoint', 'Two-point function'], ['charge', 'Acting charge']];
  const on = { endRule: false, twoPoint: false, charge: false };
  el.innerHTML = `<h4>From ${list.length} configurations to one</h4>
    <p class="sub">Our model enumerates every shared centre with its arms under the paper's bounds: ${list.length} configurations, ${nCap} under the read cap, ${readable.length} readable (the paper's Table S2). Switch the three filters on, one at a time. <b>R</b> marks a read arm, <b>U</b> an unread one, and each number is the dimension of the far end.</p>
    <div class="funnel">${F.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="false">${l}</button>`).join('')}<span class="count"></span></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>centre</th><th>arms</th><th>links</th><th>reads</th><th>unread</th><th>readout dim.</th><th>records</th><th></th></tr></thead><tbody></tbody></table></div>
    <p class="model-note">Computed by our model in JavaScript, not taken from the paper's table.${readable.some(c => c.center === 2 && Array.isArray(c.records) && c.records.some(r => Array.isArray(r.far) && r.far[0] === 3 && r.far[1] === 3)) ? ' One difference: at a qubit centre with two qutrit far ends the paper prints 174 records, where our slot count gives 169 products and 3 commutators, 172. The paper does not evaluate those rows.' : ''}</p>`;
  const tb = el.querySelector('tbody'), count = el.querySelector('.count');
  const rows = readable.map(c => {
    const tr = document.createElement('tr');
    const pass = F.every(([k]) => c.filters && c.filters[k]);
    if (pass) tr.classList.add('star');
    tr.innerHTML = `<td class="mono">${c.center === 3 ? 'qutrit' : c.center === 2 ? 'qubit' : esc(c.center)}${pass ? ' ★' : ''}</td><td class="mono">${esc(armsText(c))}</td><td class="n">${c.links ?? ''}</td><td class="n">${c.reads ?? ''}</td><td class="n">${c.unread ?? ''}</td><td class="n">${c.N ? factor23(c.N) : ''}</td><td class="n">${esc(recordsText(c.records))}</td><td class="why"></td>`;
    tb.appendChild(tr);
    return { c, tr, why: tr.querySelector('.why') };
  });
  const apply = () => {
    let n = 0;
    for (const r of rows) {
      const fail = F.find(([k]) => on[k] && !(r.c.filters && r.c.filters[k]));
      r.tr.classList.toggle('out', !!fail);
      r.why.textContent = fail ? `fails: ${fail[1].toLowerCase()}` : '';
      if (!fail) n++;
    }
    count.textContent = `${n} left`;
  };
  el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    on[b.dataset.f] = !on[b.dataset.f]; b.classList.toggle('on', on[b.dataset.f]); b.setAttribute('aria-pressed', on[b.dataset.f]); apply();
  }));
  apply();
}

function tableSectors(el, M) {
  let sec = null, N = null, val = null, src = 'our model';
  try {
    if (M && M.buildRecords && M.sectors) sec = M.sectors(M.buildRecords());
    if (M && M.value) { val = M.value(); N = typeof val.denominator === 'bigint' ? Number(val.denominator) : val.denominator; }
    if (M && M.readoutDimension && !N) N = M.readoutDimension();
  } catch (e) { console.warn('alpha-qudits: sectors from model', e); sec = null; }
  if (!sec) { sec = PAPER_SECTORS; src = "the paper's Table I (model/ not loaded)"; }
  if (!N || typeof N !== 'number') N = PAPER_N;
  const W = [['+-', '(+, −)', 2, 'symmetric, one letter at each end'], ['-+', '(−, +)', 3, 'symmetric, both letters at one end'], ['--', '(−, −)', 6, 'commutator records'], ['++', '(+, +)', 1, 'antisymmetric']];
  W.sort((a, b) => a[2] - b[2]);
  let sum = 0, total = 0;
  const rows = W.map(([k, lab, kk, what]) => { const n = sec[k] || 0, c = n * Math.sqrt(kk); sum += c; total += n; return { lab, kk, what, n, c }; });
  const max = Math.max(...rows.map(r => r.c));
  const digits = val && typeof val.inverseDigits === 'function' ? val.inverseDigits(18) : null;
  el.innerHTML = `<h4>The sum, sector by sector</h4><p class="sub">Counts from ${src}. Each record adds its weight √k; the weighted sum over ${fmtInt(N)} is the readout.</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>sector (X, Y)</th><th>records</th><th>k</th><th>weight</th><th>adds</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.lab} <span class="why" style="color:var(--dim)">${r.what}</span></td><td class="n">${r.n}</td><td class="n">${r.kk}</td><td class="n">${r.kk === 1 ? '1' : '√' + r.kk}</td><td class="n">${r.c.toFixed(4)}</td><td style="width:30%"><span class="bar" style="width:${(r.c / max * 100).toFixed(1)}%"></span></td></tr>`).join('')}
    <tr class="sum"><td>all</td><td class="n">${total}</td><td></td><td></td><td class="n">${sum.toFixed(4)}</td><td></td></tr>
    <tr class="sum"><td colspan="4">divided by N = ${fmtInt(N)}, then inverted</td><td class="n" colspan="2">${digits ? esc(inv(digits)) : (N / sum).toFixed(9)}</td></tr>
    </tbody></table></div>`;
}

function tableMeasurements(el, M) {
  let cand = CAND_INV, src = 'the exact form (CONTRACT.md digits)';
  try { if (M && M.value) { const d = M.value().inverseDigits(30); if (/^137\.0359991895/.test(d)) { cand = d; src = 'our model'; } } } catch (e) { /* keep the fallback */ }
  el.innerHTML = `<h4>The candidate against the measurements</h4><p class="sub">1/α<sub>cand</sub> = ${esc(inv(cand.slice(0, 22)))}… from ${src}. Offsets are (candidate − measured)/u.</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>determination</th><th>1/α(0)</th><th>offset</th></tr></thead><tbody>
    ${MEASURED.map(m => { const s = sigmaOf(cand, m); const unc = m.u.replace(/^0\.0*/, ''); return `<tr><td>${esc(m.label)}<br><span class="why" style="color:var(--dim)">${esc(m.what)} <a href="#ref-${m.src}">[${SRC_IDS.indexOf(m.src) + 1}]</a></span></td><td class="n">${esc(m.inv)}(${esc(unc)})</td><td class="n ${s >= 0 ? 'off-pos' : 'off-neg'}">${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(2)}σ</td></tr>`; }).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- nav
function initNav() {
  const rail = $('rail'), list = $('menuList'), sheet = $('menuSheet'), btn = $('menuBtn');
  const items = CHAPTERS.map(c => `<li><a href="#${c.id}" data-ch="${c.id}"><b>${pad(c.num)}</b><span>${esc(c.short)}</span></a></li>`).join('');
  rail.innerHTML = `<ol>${items}</ol><p class="rail-note">A preprint, explained. The identification with α(0) is the paper's Conjecture 1.</p>`;
  list.innerHTML = items;
  const open = v => { sheet.hidden = !v; btn.setAttribute('aria-expanded', v); if (v) { const a = list.querySelector('a.on'); if (a) a.focus({ preventScroll: true }); } };
  btn.addEventListener('click', () => open(sheet.hidden));
  $('menuClose').addEventListener('click', () => open(false));
  sheet.addEventListener('click', e => { if (e.target === sheet) open(false); });
  list.addEventListener('click', e => { if (e.target.closest('a')) open(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) { open(false); btn.focus(); } });
  const links = [...document.querySelectorAll('[data-ch]')].filter(a => a.tagName === 'A');
  const secs = CHAPTERS.map(c => $(c.id)).filter(Boolean);
  let cur = -1, pending = false;
  const update = () => {
    pending = false;
    const y = innerHeight * 0.35;
    let k = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top < y) k = i; });
    const max = document.documentElement.scrollHeight - innerHeight;
    $('progress').style.width = `${max > 0 ? Math.min(100, scrollY / max * 100) : 0}%`;
    if (k === cur) return;
    cur = k;
    const c = CHAPTERS[k];
    links.forEach(a => { const i = CHAPTERS.findIndex(x => x.id === a.dataset.ch); a.classList.toggle('on', i === k); a.classList.toggle('seen', i < k); if (i === k) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    $('menuNum').textContent = pad(c.num);
    $('menuTitle').textContent = c.short;
  };
  addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}

// ---------------------------------------------------------------- observers
// near: typeset a chapter and mount its figures about one screen ahead.
// vis: a figure card on screen gets play(t).
const nearIO = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  const t = e.target;
  nearIO.unobserve(t);
  if (t.classList.contains('fig')) { const card = cards.get(t.id); if (card && !card.scene) setScene(card, card.spec.scenes[0].id); }
  else { const rec = chapters.find(r => r.el === t); if (rec && !rec.typeset) { rec.typeset = true; typesetAll(rec.body); } }
}), { rootMargin: '900px 0px' });
const visIO = new IntersectionObserver(es => es.forEach(e => {
  const card = cards.get(e.target.id);
  if (!card) return;
  const was = card.visible;
  card.visible = e.isIntersecting;
  if (was === card.visible) return;
  const inst = activeInst(card);
  if (!inst) return;
  try { card.visible ? inst.resume && inst.resume() : inst.pause && inst.pause(); } catch (err) { /* ignore */ }
}), { rootMargin: '0px' });

// ---------------------------------------------------------------- loop
let last = 0;
function loop(now) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!document.hidden && !window.__aqSaver) {
    for (const card of cards.values()) {
      if (!card.visible) continue;
      const inst = activeInst(card);
      if (!inst || !inst.play) continue;
      if (!REDUCED) card.t += dt;
      try { inst.play(card.t); } catch (e) { console.warn(`alpha-qudits: play ${card.id}`, e); inst.play = null; }
    }
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- boot
for (const ch of CHAPTERS) {
  const rec = buildChapter(ch);
  if (rec) nearIO.observe(rec.el);
}
$('noscript').hidden = true;
initNav();
buildTables();
requestAnimationFrame(loop);

// ---------------------------------------------------------------- SAVER hook
function findCard(name) {
  if (cards.has(name)) return cards.get(name);
  for (const c of cards.values()) if (c.spec.pkg === name || (c.spec.scenes || []).some(s => s.pkg === name)) return c;
  return null;
}
window.alphaPage = {
  chapters: CHAPTERS.map(c => ({ id: c.id, num: c.num, title: c.title })),
  figures: () => [...cards.values()].map(c => ({ id: c.id, chapter: c.ch.id, pkgs: [...new Set((c.spec.scenes || []).map(s => scenePkg(c, s)))], scenes: (c.spec.scenes || []).map(s => s.id) })),
  goto(chapter) {
    const id = typeof chapter === 'number' ? `c${chapter}` : String(chapter);
    const el = $(id);
    if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    return !!el;
  },
  async figure(name, scene) {
    const card = findCard(name);
    if (!card) return null;
    const s = scene ? (card.spec.scenes.find(x => x.id === scene) || null) : (card.spec.scenes.find(x => scenePkg(card, x) === name) || card.spec.scenes[0]);
    return setScene(card, (s || card.spec.scenes[0]).id);
  },
};
import('./saver/index.js').catch(() => { /* SAVER lands in phase 2 */ });

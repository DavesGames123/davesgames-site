/* ============================================================================
   LENIA  ·  main script  (ES module)
   ----------------------------------------------------------------------------
   engine.js steps and draws the world on the GPU. This script loads the
   catalog, builds the controls, and sends each change to the engine. It does
   no simulation work itself.

   DATA PATH
     creatures.json ──> selectCreature ──> engine.setRule, engine.stamp
     rule slider    ──> engine.setRule({m | s | T})          (live uniform)
     scale slider   ──> engine.setRule({R}) and a new stamp at that scale
     pointer        ──> worldXY ──> engine.stamp(patch, x, y, 'set' | 'erase')
     frame          ──> engine.step(n) ──> engine.render()
                    ──> every 6th frame engine.stats() ──> status, follow

   WORLD SIZE. The short side of the world is the World select (96 to 384)
   times the Detail select (1 to 3). The long side follows the canvas aspect,
   so the world fills the screen at zoom 1 on a phone in portrait and on a
   wide monitor. Detail also multiplies the R of every creature and the size
   of its start cells, so a creature keeps its size on the screen and gets
   more cells. The default is 2 on desktop and 1.5 on phones.
   A creature flagged fixed in creatures.json always runs at detail 1.

   NO WEBGPU. If createEngine fails, the page keeps the catalog, the plots and
   the About text, and shows #nogpu.

   GREP MAP
     grep -n 'function boot'            load order and the first creature
     grep -n 'function selectCreature'  load a creature into the engine and UI
     grep -n 'function placeCreature'   clear the world and stamp the creature
     grep -n 'function buildRule'       the m, s, T and scale sliders
     grep -n 'function drawPlots'       the kernel and growth plots
     grep -n 'function renderEquations' the MathJax lines for the current rule
     grep -n 'const RULES'              symbol -> math color class
     grep -n 'function buildBrowser'    the grouped, searchable catalog
     grep -n 'function drawThumb'       catalog thumbnails
     grep -n 'function sizeWorld'       world size from the canvas aspect
     grep -n 'function observeSize'     canvas px ratio (budget.js renderBudget)
     grep -n 'function frame'           the render loop and follow camera
     grep -n 'function bindPointer'     tools, zoom and pan
     grep -n 'function bindKeys'        keyboard shortcuts
     grep -n 'function setOpen'         the panel, the phone sheet, the dock
     grep -n 'window.snSaver'           the shell screensaver hook
   ========================================================================== */
import { createEngine, kernelShell, GROWTH, resample, PALETTES, paletteData } from './engine.js';
import { typeset } from '../../lib/sci-math.js';
import { renderBudget } from './budget.js';

const $ = id => document.getElementById(id);
// The phone layout. This query matches the PHONE block in style.css.
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const FINE_Q = matchMedia('(pointer:fine)');
const LS_KEY = 'stella-nova.lenia.creature';
const DEFAULT_CODE = 'O2u';
const TOOLS = { stamp: '✦', draw: '✎', erase: '⌫' };

const S = {
  creatures: [], idx: -1, c: null,
  engine: null, gpu: true,
  playing: true, speed: 2, acc: 0,
  rule: { m: 0, s: 0, T: 10, scale: 1 },
  tool: 'stamp', brush: 1.5,
  view: { mode: 'world', palette: 'lenia', zoom: 1, follow: false },
  worldShort: 128, stats: null, time: 0,
  // Cells per unit of length. The world and every creature scale by it, so
  // a creature keeps its size on the screen and gets detail x more cells.
  detail: 2,
  // Centroid velocity in cells per unit of time, for the follow camera.
  vel: { x: 0, y: 0 }, statT: 0,
  maxSteps: 48, stepCap: 48,
};
// ?debug exposes the page state for the headless checks.
if (/[?&]debug\b/.test(location.search)) window.lenia = S;

// ------------------------------------------------------------------ helpers
function setText(el, s) { if (typeof el === 'string') el = $(el); if (el && el.textContent !== s) el.textContent = s; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
let toastT = 0;
function toast(msg, err = false, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}
const wrap = (a, n) => ((a % n) + n) % n;
const wrapDelta = (d, n) => wrap(d + n / 2, n) - n / 2;

// Family label: the family rank, or the next rank up when the family rank is
// empty or a note in parentheses.
function familyOf(c) {
  for (const k of [2, 1, 0]) { const r = c.rank[k]; if (r && !r.startsWith('(')) return r; }
  return 'Other';
}
const famCache = new Map();
function familyColor(f) {
  if (famCache.has(f)) return famCache.get(f);
  let h = 0;
  for (const ch of f) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const col = `hsl(${(h * 137.5) % 360} 62% 62%)`;
  famCache.set(f, col);
  return col;
}
function chipEl(f, tag = 'span') {
  const c = document.createElement(tag);
  c.className = 'chip';
  c.style.setProperty('--c', familyColor(f));
  c.textContent = f;
  return c;
}

// Start cells as a float patch, decoded once per creature.
const cellCache = new Map();
function cellsOf(c) {
  if (cellCache.has(c.id)) return cellCache.get(c.id);
  const bin = atob(c.cells);
  const data = new Float32Array(c.w * c.h);
  for (let i = 0; i < data.length; i++) data[i] = bin.charCodeAt(i) / 255;
  const p = { w: c.w, h: c.h, data };
  cellCache.set(c.id, p);
  return p;
}
function rotate(p, q) {
  let out = p;
  for (let k = 0; k < q; k++) {
    const r = { w: out.h, h: out.w, data: new Float32Array(out.data.length) };
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) r.data[x * r.w + (out.h - 1 - y)] = out.data[y * out.w + x];
    out = r;
  }
  return out;
}

// 256 rgb entries of a palette as css colors, for 2D canvas work.
const lutCache = new Map();
function lut(name) {
  if (lutCache.has(name)) return lutCache.get(name);
  const d = paletteData(name);
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(d[i * 4 + c] * 255);
  lutCache.set(name, out);
  return out;
}

// --------------------------------------------------------------------- boot
async function boot() {
  buildStatic();
  let doc;
  try {
    doc = await (await fetch('creatures.json')).json();
  } catch (e) {
    toast('The catalog did not load: ' + e.message, true, 8000);
    return;
  }
  S.creatures = doc.creatures;
  buildBrowser();

  const mobile = PHONE_Q.matches || !FINE_Q.matches;
  S.worldShort = mobile ? 96 : 128;
  S.detail = mobile ? 1.5 : 2;
  $('worldSel').value = String(S.worldShort);
  $('detailSel').value = String(S.detail);
  try {
    S.engine = await createEngine($('gl'), { mobile });
    S.engine.onLost = () => toast('The GPU device was lost. Reload the page to start again.', true, 10000);
  } catch (e) {
    console.warn('[lenia] no engine', e);
    S.gpu = false;
    document.body.classList.add('nogpu');
    $('nogpu').hidden = false;
  }
  if (S.engine) {
    observeSize();
    sizeWorld();
    bindPointer();
    pushView();
  }
  const saved = lsGet(LS_KEY);
  let i = S.creatures.findIndex(c => c.code === saved);
  if (i < 0) i = S.creatures.findIndex(c => c.code === DEFAULT_CODE);
  selectCreature(Math.max(0, i));
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------- creatures
function selectCreature(i) {
  const n = S.creatures.length;
  if (!n) return;
  i = wrap(i, n);
  const c = S.creatures[i];
  S.idx = i; S.c = c;
  S.rule = { m: c.m, s: c.s, T: c.T, scale: c.scale };
  if (!S.saver) lsSet(LS_KEY, c.code);   // the screensaver writes no storage

  const fam = familyOf(c);
  const chip = $('curFamily');
  chip.textContent = fam;
  chip.style.setProperty('--c', familyColor(fam));
  setText('curIdx', `${i + 1} / ${n}`);
  setText('curName', c.name);
  const sub = $('curSub');
  sub.textContent = '';
  const cn = document.createElement('span'); cn.className = 'cn'; cn.textContent = c.cname;
  sub.append(c.code);
  if (c.cname) sub.append(' · ', cn);
  if (c.rank[3] && !c.rank[3].startsWith('(')) sub.append(` · ${c.rank[3]}`);
  if (c.cls === 'grow') sub.append(' · grows without limit');
  if (c.fixed) sub.append(' · detail 1× only');
  setText('dockName', c.name);
  $('dockDot').style.setProperty('--c', familyColor(fam));
  markBrowser();

  buildRule();
  renderEquations();
  drawPlots();
  if (S.engine) {
    sizeWorld();
    S.engine.setRule(engineRule());
    placeCreature();
  }
}

function engineRule() {
  const c = S.c;
  return { R: c.R * S.rule.scale * det(), T: S.rule.T, m: S.rule.m, s: S.rule.s, b: c.b, kn: c.kn, gn: c.gn };
}

// Clear the world and stamp the creature in the middle at the current scale.
function placeCreature() {
  if (!S.engine || !S.c) return;
  S.engine.clear();
  const { W, H } = S.engine.info;
  S.engine.stamp(resample(cellsOf(S.c), S.rule.scale * det()), W / 2, H / 2);
  S.engine.setView({ cx: W / 2, cy: H / 2 });
  S.time = 0; S.acc = 0;
  S.stats = null; S.vel = { x: 0, y: 0 };
}

function soup() {
  if (!S.engine || !S.c) return;
  const { W, H } = S.engine.info;
  // The noise is made at detail 1 and scaled up. Cell-size white noise at a
  // high detail averages out over the larger kernel, and nothing grows.
  const R = S.c.R * S.rule.scale;
  const pw = Math.round(W * 0.7 / det()), ph = Math.round(H * 0.7 / det());
  const data = new Float32Array(pw * ph);
  const blobs = Math.max(4, Math.round(pw * ph / (R * R * 9)));
  for (let k = 0; k < blobs; k++) {
    const bx = Math.random() * pw, by = Math.random() * ph, br = R * (0.8 + Math.random() * 1.2);
    const x0 = Math.max(0, Math.floor(bx - br)), x1 = Math.min(pw - 1, Math.ceil(bx + br));
    const y0 = Math.max(0, Math.floor(by - br)), y1 = Math.min(ph - 1, Math.ceil(by + br));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - bx, y - by) < br) data[y * pw + x] = Math.random();
    }
  }
  S.engine.clear();
  S.engine.stamp(resample({ w: pw, h: ph, data }, det()), W / 2, H / 2);
  S.time = 0;
}

// ------------------------------------------------------------------- rule
const RULE_ROWS = [
  { key: 'm', sym: 'm', word: 'center', min: 0.01, max: 0.6, step: 0.001, dec: 3 },
  { key: 's', sym: 's', word: 'width', min: 0.0005, max: 0.1, step: 0.0001, dec: 4 },
  { key: 'T', sym: 'T', word: 'steps', min: 1, max: 50, step: 1, dec: 0 },
  { key: 'scale', label: 'Scale', min: 0.4, max: 2.5, step: 0.05, dec: 2 },
];
function buildRule() {
  const box = $('rule');
  box.textContent = '';
  const c = S.c;
  for (const r of RULE_ROWS) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('label'); lab.htmlFor = 'r-' + r.key; lab.title = r.word ? `${r.sym} · ${r.word}` : r.label;
    // A rule symbol shows as MathJax SVG in its equation color (RULES).
    if (r.sym) {
      const m = document.createElement('span'); m.className = 'sci-sym ' + RULE_CLASS[r.sym]; m.textContent = r.sym;
      const w = document.createElement('small'); w.textContent = r.word;
      lab.append(m, w);
      typeset(m, r.sym, { display: false, rules: RULES });
    } else lab.textContent = r.label;
    const inp = document.createElement('input'); inp.type = 'range'; inp.id = 'r-' + r.key;
    const base = r.key === 'scale' ? c.scale : c[r.key];
    inp.min = Math.min(r.min, base); inp.max = Math.max(r.max, base * 2); inp.step = r.step; inp.value = S.rule[r.key];
    const val = document.createElement('span'); val.className = 'val acc';
    const rst = document.createElement('button'); rst.className = 'rst'; rst.textContent = '↺'; rst.title = 'Back to the catalog value';
    const show = () => {
      const v = S.rule[r.key];
      val.textContent = r.key === 'scale' ? `×${v.toFixed(2)}` : v.toFixed(r.dec);
      rst.classList.toggle('same', Math.abs(v - base) < r.step / 2);
      if (r.key === 'scale') lab.textContent = `R = ${Math.round(c.R * v * det() * 10) / 10}`;
    };
    const set = (v, commit) => {
      S.rule[r.key] = v;
      show();
      if (S.engine) {
        S.engine.setRule(engineRule());
        if (r.key === 'scale' && commit) placeCreature();
      }
      drawPlots();
      renderEquations();
    };
    inp.addEventListener('input', () => set(+inp.value, false));
    // A new scale changes R, and the creature must be drawn again at that size.
    if (r.key === 'scale') inp.addEventListener('change', () => set(+inp.value, true));
    rst.addEventListener('click', () => { inp.value = base; set(base, true); });
    show();
    row.append(lab, inp, val, rst);
    box.append(row);
  }
}

// ------------------------------------------------------------------ plots
// Left: the kernel as a disc in the current palette. Right: G(u) for u from 0
// to past m + 4 s, with the growth center m marked.
function drawPlots() {
  const cv = $('plots'), c = S.c;
  if (!c) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 260, h = cv.clientHeight || 120;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  // Kernel disc.
  const side = h - 16, n = 64;
  const img = g.createImageData(n, n), L = lut(S.view.palette);
  let kmax = 0;
  const vals = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    const v = kernelShell(r, c.b, c.kn);
    vals[y * n + x] = v; kmax = Math.max(kmax, v);
  }
  for (let i = 0; i < n * n; i++) {
    const k = Math.round(vals[i] / (kmax || 1) * 255);
    img.data[i * 4] = L[k * 3]; img.data[i * 4 + 1] = L[k * 3 + 1]; img.data[i * 4 + 2] = L[k * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = n; tmp.height = n;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 8, 8, side, side);

  // Growth curve.
  const { m, s } = S.rule;
  const x0 = side + 24, x1 = w - 8, y0 = 10, y1 = h - 12;
  const umax = Math.min(1, Math.max(m * 2, m + 5 * s));
  const X = u => x0 + (u / umax) * (x1 - x0);
  const Y = v => y0 + (1 - (v + 1) / 2) * (y1 - y0);
  g.strokeStyle = 'rgba(140,200,230,0.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke();
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.stroke();
  g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(X(m), y0); g.lineTo(X(m), y1); g.stroke();
  g.setLineDash([]);
  const f = GROWTH[c.gn - 1];
  g.strokeStyle = '#7ad7f0'; g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i <= 200; i++) {
    const u = umax * i / 200, px = X(u), py = Y(f(u, m, s));
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.stroke();
  g.fillStyle = 'rgba(211,221,224,0.65)';
  g.font = '10px ui-monospace, Menlo, monospace';
  g.fillText('+1', x0 + 3, y0 + 8);
  g.fillText('−1', x0 + 3, y1 - 2);
  g.fillText('m', X(m) + 3, y1 - 2);
  g.textAlign = 'right';
  g.fillText(umax.toFixed(2), x1, y1 + 10);
  g.textAlign = 'left';
}

// ---------------------------------------------------------------- equations
// One color per quantity, in the equations, the rule labels and the About
// text: the world A, the kernel K, the growth G, the time scale T, the
// growth center m and the growth width s. The live values of m and s in
// G(u) take the color of m and s.
const RULES = [['A', 'm1'], ['K_c', 'm2'], ['K', 'm2'], ['G', 'm3'], ['T', 'm4'], ['m', 'm5'], ['s', 'm6']];
const RULE_CLASS = Object.fromEntries(RULES);
const GENERAL = String.raw`A^{t+\Delta t} = \Big[\,A^t + \tfrac{1}{T}\,G\big(K * A^t\big)\Big]_0^1`;
const CORE_TEX = [
  String.raw`K_c(r) = \big(4r(1-r)\big)^4`,
  String.raw`K_c(r) = \exp\!\Big(4 - \tfrac{1}{r(1-r)}\Big)`,
  String.raw`K_c(r) = \mathbf{1}\big[\tfrac14 \le r \le \tfrac34\big]`,
  String.raw`K_c(r) = \mathbf{1}\big[\tfrac14 \le r \le \tfrac34\big] + \tfrac12\,\mathbf{1}\big[r < \tfrac14\big]`,
];
function growthTeX(gn, m, s) {
  const M = `\\class{m5}{${m.toFixed(3)}}`, Sv = `\\class{m6}{${s.toFixed(4)}}`;
  if (gn === 1) return String.raw`G(u) = 2\Big(1 - \tfrac{(u-${M})^2}{9\cdot ${Sv}^2}\Big)_+^4 - 1`;
  if (gn === 3) return String.raw`G(u) = \pm 1,\ +1 \text{ if } |u-${M}| \le ${Sv}`;
  return String.raw`G(u) = 2\exp\!\Big(-\tfrac{(u-${M})^2}{2\cdot ${Sv}^2}\Big) - 1`;
}
// Typeset one TeX string into el as color-coded MathJax SVG.
function tex(el, src, display = true) {
  el.classList.add('sci-eq');
  return typeset(el, src, { display, rules: RULES });
}
function renderEquations() {
  const c = S.c;
  if (!c) return;
  const box = $('eqs');
  box.textContent = '';
  const add = src => { const d = document.createElement('div'); d.className = 'eq'; tex(d, src); box.append(d); };
  add(growthTeX(c.gn, S.rule.m, S.rule.s));
  add(CORE_TEX[c.kn - 1] + (c.b.length > 1 ? String.raw`,\quad \beta = (${c.b.map(v => +v.toFixed(3)).join(',\\ ')})` : ''));
}

// ------------------------------------------------------------------ browser
let famFilter = null;
function buildBrowser() {
  const fams = [];
  for (const c of S.creatures) { const f = familyOf(c); if (!fams.includes(f)) fams.push(f); }
  const chips = $('famChips');
  chips.textContent = '';
  for (const f of fams) {
    const b = chipEl(f, 'button'); b.type = 'button';
    b.addEventListener('click', () => {
      famFilter = famFilter === f ? null : f;
      for (const x of chips.children) x.classList.toggle('on', x.textContent === famFilter);
      fillList();
    });
    chips.append(b);
  }
  $('search').addEventListener('input', fillList);
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('list').querySelector('.br-item'); if (first) first.click(); }
    if (e.key === 'Escape') { e.stopPropagation(); openBrowser(false); }
  });
  fillList();
}

let thumbIO = null;
function fillList() {
  const q = $('search').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const box = $('list');
  box.textContent = '';
  if (thumbIO) thumbIO.disconnect();
  thumbIO = new IntersectionObserver(ents => {
    for (const e of ents) if (e.isIntersecting) { drawThumb(e.target); thumbIO.unobserve(e.target); }
  }, { root: box, rootMargin: '200px' });
  const groups = new Map();
  S.creatures.forEach((c, i) => {
    const f = familyOf(c);
    if (famFilter && f !== famFilter) return;
    const hay = [c.name, c.code, c.cname, ...c.rank].join(' ').toLowerCase();
    if (!words.every(w => hay.includes(w))) return;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(i);
  });
  for (const [f, list] of groups) {
    const g = document.createElement('div'); g.className = 'br-group';
    const h = document.createElement('div'); h.className = 'br-gh';
    const dot = document.createElement('span'); dot.className = 'chip-dot'; dot.style.setProperty('--c', familyColor(f));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = list.length;
    h.append(dot, f, n);
    g.append(h);
    for (const i of list) {
      const c = S.creatures[i];
      const b = document.createElement('button'); b.className = 'br-item'; b.dataset.idx = i;
      const th = document.createElement('canvas'); th.dataset.idx = i;
      const t = document.createElement('span'); t.className = 't';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      const ct = document.createElement('span'); ct.className = 'ct';
      ct.textContent = `${c.code}${c.cname ? ' · ' + c.cname : ''} · R ${Math.round(c.R * c.scale)}${c.cls === 'grow' ? ' · grows' : ''}`;
      t.append(nm, ct);
      b.append(th, t);
      g.append(b);
      thumbIO.observe(th);
      b.addEventListener('click', () => { selectCreature(i); if (PHONE_Q.matches) openBrowser(false); });
    }
    box.append(g);
  }
  if (!groups.size) { const d = document.createElement('div'); d.className = 'br-empty'; d.textContent = 'No creature matches.'; box.append(d); }
  markBrowser();
}

// The start cells, fit into the thumbnail with the aspect kept.
function drawThumb(cv) {
  const c = S.creatures[+cv.dataset.idx];
  const p = cellsOf(c), L = lut(S.view.palette);
  const img = new ImageData(p.w, p.h);
  for (let i = 0; i < p.w * p.h; i++) {
    const k = Math.round(p.data[i] * 255);
    img.data[i * 4] = L[k * 3]; img.data[i * 4 + 1] = L[k * 3 + 1]; img.data[i * 4 + 2] = L[k * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = p.w; tmp.height = p.h;
  tmp.getContext('2d').putImageData(img, 0, 0);
  const size = Math.round((cv.clientWidth || 44) * Math.min(devicePixelRatio || 1, 2));
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = `rgb(${L[0]},${L[1]},${L[2]})`;
  g.fillRect(0, 0, size, size);
  const k = size * 0.92 / Math.max(p.w, p.h);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, (size - p.w * k) / 2, (size - p.h * k) / 2, p.w * k, p.h * k);
}

function markBrowser() {
  for (const b of $('list').querySelectorAll('.br-item')) b.classList.toggle('on', +b.dataset.idx === S.idx);
}
function openBrowser(open) {
  const br = $('browser');
  if (open === undefined) open = !br.classList.contains('open');
  br.classList.toggle('open', open);
  br.setAttribute('aria-hidden', String(!open));
  $('browseBtn').classList.toggle('on', open);
  $('dockCreature').classList.toggle('on', open);
  if (open) {
    if (PHONE_Q.matches) setOpen(false);
    const cur = $('list').querySelector('.br-item.on');
    if (cur) cur.scrollIntoView({ block: 'center' });
    if (FINE_Q.matches) setTimeout(() => $('search').focus({ preventScroll: true }), 50);
  } else if (document.activeElement === $('search')) $('search').blur();
}

// ---------------------------------------------------------- panel and dock
function setOpen(open) {
  const panel = $('panel');
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  if (open && PHONE_Q.matches) openBrowser(false);
}
function setPlaying(on) {
  S.playing = on;
  $('playBtn').textContent = on ? 'Pause' : 'Play';
  $('playBtn').classList.toggle('on', !on);
  $('dockPlay').textContent = on ? '❚❚' : '▶';
  $('dockPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
}
function setTool(t) {
  S.tool = t;
  for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === t);
  $('dockTool').textContent = TOOLS[t];
  $('dockTool').setAttribute('aria-label', 'Tool: ' + t);
  const touch = !FINE_Q.matches;
  const how = {
    stamp: touch ? 'Tap the world to place a copy of the creature, turned at random.' : 'Click the world to place a copy of the creature, turned at random.',
    draw: 'Drag on the world to spray random cells. Some rules grow new creatures from them.',
    erase: 'Drag on the world to remove cells.',
  }[t];
  setText('toolHint', how + (touch ? ' Two fingers zoom and pan.' : ' The wheel zooms, a right drag pans.'));
}
function setFollow(on) {
  S.view.follow = on;
  $('followBtn').textContent = on ? 'Follow on' : 'Follow off';
  $('followBtn').classList.toggle('on', on);
}
function setZoom(z) {
  S.view.zoom = Math.max(0.5, Math.min(6, z));
  $('zoom').value = S.view.zoom;
  setText('zoomV', `×${S.view.zoom.toFixed(2)}`);
  pushView();
}
function pushView() {
  if (!S.engine) return;
  S.engine.setView({ mode: S.view.mode, zoom: S.view.zoom, palette: S.view.palette });
}

function buildStatic() {
  tex($('eq-general'), GENERAL);
  $('prevBtn').addEventListener('click', () => selectCreature(S.idx - 1));
  $('nextBtn').addEventListener('click', () => selectCreature(S.idx + 1));
  $('browseBtn').addEventListener('click', () => openBrowser());
  $('browserClose').addEventListener('click', () => openBrowser(false));

  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('stepBtn').addEventListener('click', () => { setPlaying(false); if (S.engine) { S.engine.step(1); S.time += 1 / S.rule.T; } });
  $('resetBtn').addEventListener('click', placeCreature);
  $('dockReset').addEventListener('click', placeCreature);
  $('soupBtn').addEventListener('click', soup);
  $('clearBtn').addEventListener('click', () => { if (S.engine) { S.engine.clear(); S.time = 0; } });

  const sp = $('speed');
  sp.addEventListener('input', () => { S.speed = +sp.value; setText('speedV', `${S.speed} t/s`); });
  sp.dispatchEvent(new Event('input'));
  $('worldSel').addEventListener('change', e => { S.worldShort = +e.target.value; sizeWorld(); });
  $('detailSel').addEventListener('change', e => {
    S.detail = +e.target.value;
    if (S.c) buildRule();
    sizeWorld(true);
  });

  for (const b of $('tools').children) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('dockTool').addEventListener('click', () => {
    const order = Object.keys(TOOLS);
    setTool(order[(order.indexOf(S.tool) + 1) % order.length]);
    toast('Tool: ' + S.tool, false, 900);
  });
  const br = $('brush');
  br.addEventListener('input', () => { S.brush = +br.value; setText('brushV', `${S.brush.toFixed(2)} R`); });
  br.dispatchEvent(new Event('input'));
  setTool('stamp');

  const pal = $('palettes');
  for (const name of Object.keys(PALETTES)) {
    const b = document.createElement('button'); b.dataset.pal = name;
    const bar = document.createElement('span'); bar.className = 'bar';
    bar.style.background = `linear-gradient(90deg, ${PALETTES[name].join(', ')})`;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
    b.append(bar, nm);
    b.classList.toggle('on', name === S.view.palette);
    b.addEventListener('click', () => {
      S.view.palette = name;
      for (const x of pal.children) x.classList.toggle('on', x === b);
      pushView();
      drawPlots();
      if (S.creatures.length) fillList();
    });
    pal.append(b);
  }
  for (const b of $('modes').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('zoom').addEventListener('input', e => setZoom(+e.target.value));
  setZoom(1);
  $('followBtn').addEventListener('click', () => setFollow(!S.view.follow));

  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => setOpen(!$('panel').classList.contains('open')));
  $('dockCreature').addEventListener('click', () => openBrowser());
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); openBrowser(false); });

  // The grip of the phone sheet. A tap switches half and full height. A drag
  // up gives full height. A drag down gives half height, then closes.
  const grip = $('sheetGrip'), panel = $('panel');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* none */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
  new ResizeObserver(() => drawPlots()).observe($('plots'));

  // No browser pinch zoom, no double-tap zoom, no pull to refresh.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  bindKeys();
}
function setMode(mode) {
  S.view.mode = mode;
  for (const b of $('modes').children) b.classList.toggle('on', b.dataset.mode === mode);
  pushView();
}

// -------------------------------------------------------------- world size
// The detail of the current creature. A creature flagged fixed in the
// catalog changes class at detail 2 (all Game of Life patterns, and 5
// Lenia creatures), so it always runs at detail 1.
function det() { return S.c && S.c.fixed ? 1 : S.detail; }

// The step cost per cell grows with R^2, so a higher detail gets fewer steps
// per frame. The cap keeps a slow GPU from a queue of frames.
function setMaxSteps(mobile) {
  S.maxSteps = Math.max(2, Math.round((mobile ? 16 : 48) / (det() * det())));
  S.stepCap = S.maxSteps;
}

// The short side is S.worldShort * det(). The long side follows the
// canvas aspect, clamped to 2.2 : 1, and both are multiples of 16.
function sizeWorld(force = false) {
  if (!S.engine) return;
  const cv = $('gl');
  const a = Math.min(2.2, Math.max(1 / 2.2, (cv.clientWidth || 1) / (cv.clientHeight || 1)));
  const r16 = v => Math.max(64, Math.round(v / 16) * 16);
  setMaxSteps(PHONE_Q.matches || !FINE_Q.matches);
  const n = S.worldShort * det();
  const W = r16(a >= 1 ? n * a : n);
  const H = r16(a >= 1 ? n : n / a);
  const { W: w0, H: h0 } = S.engine.info;
  if (W === w0 && H === h0 && !force) return;
  S.engine.setWorld(W, H);
  if (S.c) { S.engine.setRule(engineRule()); placeCreature(); }
}
function observeSize() {
  const cv = $('gl');
  let sizeT = 0;
  const apply = () => {
    // The pixel ratio and the bicubic start come from budget.js: a desktop
    // saver draws at the device ratio up to 2 (8.3 M px at most), a phone
    // saver at 1.5 (1.2 M px at most), and a phone takes the bilinear path
    // for cells under 6 device px.
    const cw = Math.max(1, cv.clientWidth), ch = Math.max(1, cv.clientHeight);
    const b = renderBudget({ dpr: devicePixelRatio || 1, cssW: cw, cssH: ch, saver: !!S.saver, phone: PHONE_Q.matches || !FINE_Q.matches });
    S.engine.setView({ cubicMin: b.cubicMin });
    S.engine.resize(Math.round(cw * b.dpr), Math.round(ch * b.dpr), b.dpr);
  };
  new ResizeObserver(() => {
    apply();
    // A new aspect (a phone turned, a window made narrow) gets a new world
    // after the resize settles, so a drag of the window edge does not clear
    // the world at each frame.
    clearTimeout(sizeT);
    sizeT = setTimeout(() => {
      const { W, H } = S.engine.info, a = cv.clientWidth / cv.clientHeight;
      if ((W >= H) !== (a >= 1) || Math.abs(Math.log((W / H) / a)) > 0.45) sizeWorld();
    }, 400);
  }).observe(cv);
  apply();
  S.applySize = apply;   // the screensaver calls it after the dpr cap
}

// Canvas client px -> world cell (x, y), not wrapped.
function worldXY(clientX, clientY) {
  const cv = $('gl'), r = cv.getBoundingClientRect(), v = S.engine.view, k = S.engine.cellPx();
  return { x: (clientX - r.left - r.width / 2 - v.ox) / k + v.cx, y: (clientY - r.top - r.height / 2 - v.oy) / k + v.cy };
}

// The part of the canvas that no sheet, drawer or dock covers. The view
// center goes to the middle of that part, so a creature at the center stays
// in sight when the phone sheet or the catalog opens. Returns the offset of
// that middle from the canvas center, in CSS px.
function occlusion() {
  const cv = $('gl').getBoundingClientRect();
  let l = cv.left, r = cv.right, t = cv.top, b = cv.bottom;
  const cover = el => {
    if (!el.classList.contains('open')) return;
    const e = el.getBoundingClientRect();
    if (e.width < 1 || e.height < 1 || e.right <= l || e.left >= r || e.bottom <= t || e.top >= b) return;
    // A panel along the base (phone sheet) or along a side (drawer).
    if (e.width >= (r - l) * 0.9) b = Math.min(b, e.top);
    else if (e.left <= l + 1) l = Math.max(l, e.right);
    else r = Math.min(r, e.left);
  };
  if (PHONE_Q.matches) {
    const d = $('dock').getBoundingClientRect();
    if (d.height && d.width >= (r - l) * 0.9) b = Math.min(b, d.top);
  }
  cover($('panel'));
  cover($('browser'));
  if (r - l < 80 || b - t < 80) return { x: 0, y: 0 };
  return { x: (l + r) / 2 - (cv.left + cv.right) / 2, y: (t + b) / 2 - (cv.top + cv.bottom) / 2 };
}

// -------------------------------------------------------------------- frame
// The time of the picture on the screen: the render mix (frame()) shows the
// world between one step back and now.
function shownTime() {
  const b = S.engine ? S.engine.view.blend : 1;
  return S.time - (1 - (b == null ? 1 : b)) / S.rule.T;
}
let frames = 0, lastT = 0, lastStat = 0, fps = 0, stepsWin = 0, sps = 0, statBusy = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (!S.engine) return;
  const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 60;
  lastT = now;
  if (S.playing && S.c) {
    S.acc += S.speed * S.rule.T * dt;
    // A slow frame means the GPU is behind: take fewer steps per frame, so
    // the world runs slower and the picture stays smooth.
    if (dt > 1 / 45) S.stepCap = Math.max(1, Math.floor(S.stepCap * 0.75));
    else if (dt < 1 / 55) S.stepCap = Math.min(S.maxSteps, S.stepCap + 1);
    const n = Math.min(S.stepCap, Math.floor(S.acc));
    S.acc -= n;
    if (S.acc > S.stepCap) S.acc = 0;   // do not build a backlog
    if (n > 0) { S.engine.step(n); S.time += n / S.rule.T; stepsWin += n; }
  }
  // The picture is the state one step back mixed with the current state by
  // the part of the next step that the clock has used. A step comes every
  // 3 to 5 frames at the default speed, and with no mix the creature moves
  // in jumps at each step.
  S.engine.setView({ blend: S.playing ? Math.min(1, S.acc) : 1 });
  if (S.view.follow && S.stats && S.stats.mass > 1e-3 && S.stats.focus > 0.2) {
    // The centroid is a few frames old. Move it forward by the velocity.
    const { W, H } = S.engine.info, v = S.engine.view, age = shownTime() - S.statT;
    const tx = S.stats.cx + S.vel.x * age, ty = S.stats.cy + S.vel.y * age;
    const dx = wrapDelta(tx - v.cx, W), dy = wrapDelta(ty - v.cy, H);
    S.engine.setView({ cx: wrap(v.cx + dx * 0.12, W), cy: wrap(v.cy + dy * 0.12, H) });
  }
  const occ = S.saverOcc || occlusion(), v = S.engine.view;
  if (Math.abs(occ.x - v.ox) > 0.5 || Math.abs(occ.y - v.oy) > 0.5) {
    S.engine.setView({ ox: v.ox + (occ.x - v.ox) * 0.2, oy: v.oy + (occ.y - v.oy) * 0.2 });
  }
  S.engine.render();
  frames++;
  if (frames % 6 === 0 && !statBusy) {
    statBusy = true;
    const t = S.time;
    S.engine.stats().then(st => {
      if (!st) return;
      const prev = S.stats, dt = t - S.statT;
      if (prev && dt > 1e-6) {
        const { W, H } = S.engine.info;
        const vx = wrapDelta(st.cx - prev.cx, W) / dt, vy = wrapDelta(st.cy - prev.cy, H) / dt;
        S.vel = { x: S.vel.x * 0.7 + vx * 0.3, y: S.vel.y * 0.7 + vy * 0.3 };
      }
      S.stats = st; S.statT = t;
    }).catch(() => {}).finally(() => { statBusy = false; });
  }
  if (now - lastStat > 500) {
    const span = (now - lastStat) / 1000;
    fps = lastStat ? frames / span : 0; sps = lastStat ? stepsWin / span : 0;
    frames = 0; stepsWin = 0; lastStat = now;
    const c = S.c, info = S.engine.info, st = S.stats;
    setText('stMain', c ? c.name : '');
    const R = info.R;
    const mass = st ? (st.mass / (R * R)).toFixed(2) : '–';
    setText('stRight', [
      `${info.W}×${info.H}`, `R ${Math.round(R * 10) / 10}`, `t ${S.time.toFixed(1)}`, `mass ${mass}`,
      `${Math.round(sps)} steps/s`, `${Math.round(fps)} fps`, S.playing ? '' : 'paused',
    ].filter(Boolean).join(' · '));
  }
}

// ------------------------------------------------------------------ pointer
// Mouse: the left button uses the tool, the right button (or shift + left)
// pans, the wheel zooms at the cursor. Touch and pen: one finger uses the
// tool (stamp on a tap), two fingers zoom and pan.
function bindPointer() {
  const cv = $('gl'), cursor = $('cursor');
  const ptrs = new Map();
  let mode = null, last = null, tap = null, pinch = null;

  function brushAt(p) {
    const R = S.engine.info.R, r = Math.max(1.5, S.brush * R);
    const n = Math.ceil(r) * 2 + 1, data = new Float32Array(n * n), c = (n - 1) / 2;
    // The draw noise is made at detail 1 and scaled up, as in soup().
    let noise = null;
    if (S.tool !== 'erase') {
      const k = Math.max(1, Math.ceil(n / det()));
      noise = resample({ w: k, h: k, data: new Float32Array(k * k).map(Math.random) }, n / k);
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c) / r;
      if (d >= 1) continue;
      data[y * n + x] = S.tool === 'erase' ? Math.min(1, (1 - d) * 3) : noise.data[Math.min(y, noise.h - 1) * noise.w + Math.min(x, noise.w - 1)];
    }
    S.engine.stamp({ w: n, h: n, data }, p.x, p.y, S.tool === 'erase' ? 'erase' : 'set');
  }
  function brushLine(p) {
    const R = S.engine.info.R, step = Math.max(1, S.brush * R * 0.5);
    if (last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      const n = Math.min(32, Math.floor(d / step));
      for (let k = 1; k < n; k++) brushAt({ x: last.x + (p.x - last.x) * k / n, y: last.y + (p.y - last.y) * k / n });
    }
    brushAt(p);
    last = p;
  }
  function stampAt(p) {
    const patch = rotate(resample(cellsOf(S.c), S.rule.scale * det()), Math.floor(Math.random() * 4));
    S.engine.stamp(patch, p.x, p.y, 'set');
  }
  function pan(dxPx, dyPx) {
    const { W, H } = S.engine.info, v = S.engine.view, k = S.engine.cellPx();
    S.engine.setView({ cx: wrap(v.cx - dxPx / k, W), cy: wrap(v.cy - dyPx / k, H) });
  }
  // Zoom so that the world point under (clientX, clientY) stays under it.
  function zoomAt(clientX, clientY, z) {
    const before = worldXY(clientX, clientY);
    setZoom(z);
    const after = worldXY(clientX, clientY);
    const { W, H } = S.engine.info, v = S.engine.view;
    S.engine.setView({ cx: wrap(v.cx + before.x - after.x, W), cy: wrap(v.cy + before.y - after.y, H) });
  }
  const mid = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };

  cv.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* none */ }
    e.preventDefault();
    if (ptrs.size === 2) { mode = 'pinch'; pinch = { ...mid(), zoom: S.view.zoom }; tap = null; return; }
    if (ptrs.size > 2) return;
    const p = worldXY(e.clientX, e.clientY);
    last = null;
    if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey)) { mode = 'pan'; last = { x: e.clientX, y: e.clientY }; return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (S.tool === 'stamp') {
      if (e.pointerType === 'mouse') { stampAt(p); mode = null; }
      else { mode = 'tap'; tap = { x: e.clientX, y: e.clientY, t: performance.now() }; }
    } else { mode = 'brush'; brushLine(p); }
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') {
      const d = (S.tool === 'stamp' ? S.c.R * S.rule.scale * det() : Math.max(1.5, S.brush * S.engine.info.R)) * 2 * S.engine.cellPx();
      cursor.style.width = cursor.style.height = d + 'px';
      cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px';
      cursor.classList.add('on');
    }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && ptrs.size === 2) {
      const m = mid();
      pan(m.x - pinch.x, m.y - pinch.y);
      zoomAt(m.x, m.y, pinch.zoom * m.d / Math.max(1, pinch.d));
      pinch.x = m.x; pinch.y = m.y;
    } else if (mode === 'pan') {
      pan(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    } else if (mode === 'brush') {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of (evs.length ? evs : [e])) brushLine(worldXY(c.clientX, c.clientY));
    }
  });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') cursor.classList.remove('on'); });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (x) { /* none */ }
    if (e.type === 'pointerup' && mode === 'tap' && tap && performance.now() - tap.t < 400 &&
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14) {
      if (PHONE_Q.matches && ($('panel').classList.contains('open') || $('browser').classList.contains('open'))) {
        setOpen(false); openBrowser(false);
      } else stampAt(worldXY(e.clientX, e.clientY));
    }
    if (ptrs.size === 0) { mode = null; last = null; tap = null; pinch = null; }
    else if (mode === 'pinch') mode = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, S.view.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}

// --------------------------------------------------------------------- keys
function bindKeys() {
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    const typing = tag === 'INPUT' && (t.type === 'search' || t.type === 'text') || tag === 'SELECT' || tag === 'TEXTAREA';
    if (typing) return;
    const onRange = tag === 'INPUT' && t.type === 'range';
    const k = e.key.toLowerCase();
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (tag === 'BUTTON') t.blur(); setPlaying(!S.playing); }
    else if (k === 'r') placeCreature();
    else if (k === 'n') soup();
    else if (k === 'c') { if (S.engine) { S.engine.clear(); S.time = 0; } }
    else if (k === 'f') setFollow(!S.view.follow);
    else if (k === '1') setMode('world');
    else if (k === '2') setMode('potential');
    else if (k === '3') setMode('growth');
    else if (e.key === '[' || e.key === ']') {
      const inp = $('brush');
      inp.value = Math.max(+inp.min, Math.min(+inp.max, +inp.value + (e.key === ']' ? 0.25 : -0.25)));
      inp.dispatchEvent(new Event('input'));
    }
    else if (!onRange && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); selectCreature(S.idx + 1); }
    else if (!onRange && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); selectCreature(S.idx - 1); }
    else if (e.key === 'Escape') openBrowser(false);
    else if (e.key === '/') { e.preventDefault(); openBrowser(true); $('search').focus(); }
  });
}

// -------------------------------------------------------------- screensaver
// Shell screensaver hook (lib/screensaver.js). enter() waits for the first
// creature, hides the GUI and gives #gl the full window. A 2D canvas over
// #gl takes a copy of each frame and is the canvas to record: it can fade to
// black across a scene change, which the WebGPU pass cannot.
// WORLD. The saver runs at detail 1 with a short side of 256 cells, so the
// world is about 8 creatures across and a step costs about 5x less than at
// detail 2 and 128 cells.
// SCENES. A seeded shuffle of SAVER_CODES gives one creature per scene. A
// glider scene stamps 1 to 6 copies with random turns, so the copies roam
// and meet. A grower (a chain creature that fills the world) gets one stamp.
// A creature set that dies is stamped again behind a fade. A set that fills
// the world after a collision (2.5x its start mass) ends the scene.
// SHOTS. A scene is 3 shots of 6 to 10 s with hard cuts between them (see
// SHOTS). The camera does not lock on the creature: it pushes in, lets the
// creature cross the frame, waits ahead of its path, or holds wide.
// TRACKER. engine.stats() gives one centroid for all cells, which is the
// empty space between two copies. The saver reads the world 5 times a
// second into a grid of R/2 blocks (saverGrid) and follows the centroid of
// the blocks near one creature (saverTrack).
// The subject sits in the clear band of the label plate (plateBand,
// lib/saver-clear.js) through the view offset, read in frame().
const SAVER_CODES = ['O2u', 'OG2g', 'HN+m', 'OV2u', '2S1f', 'O4t', 'PN+i', 'P4al', 'K4s', 'HN+bs'];
// Shot order per scene kind. The first shot of a scene is the first entry.
const SHOTS = {
  one: [['push', 'ahead', 'drift'], ['ahead', 'push', 'wide'], ['drift', 'push', 'ahead']],
  herd: [['wide', 'push', 'drift'], ['push', 'wide', 'ahead'], ['wide', 'drift', 'push']],
  grow: [['wide', 'pan', 'push'], ['push', 'pan', 'wide']],
};
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The world as blocks of B x B cells: mass and mass-weighted x, y per block.
function saverGrid(A, W, H, B) {
  const gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const m = new Float32Array(gw * gh), mx = new Float32Array(gw * gh), my = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const row = y * W, gy = ((y / B) | 0) * gw;
    for (let x = 0; x < W; x++) {
      const a = A[row + x];
      if (a < 0.02) continue;
      const g = gy + ((x / B) | 0);
      m[g] += a; mx[g] += a * x; my[g] += a * y;
    }
  }
  return { gw, gh, B, W, H, m, mx, my };
}
// The torus centroid of the blocks within rad cells of p, or null if empty.
function gridCentroid(g, p, rad) {
  let M = 0, X = 0, Y = 0;
  const n = Math.ceil(rad / g.B);
  const bx = Math.floor(p.x / g.B), by = Math.floor(p.y / g.B);
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const k = wrap(by + j, g.gh) * g.gw + wrap(bx + i, g.gw), mk = g.m[k];
    if (mk <= 0) continue;
    const dx = wrapDelta(g.mx[k] / mk - p.x, g.W), dy = wrapDelta(g.my[k] / mk - p.y, g.H);
    if (dx * dx + dy * dy > rad * rad) continue;
    M += mk; X += mk * dx; Y += mk * dy;
  }
  return M > 1e-3 ? { x: wrap(p.x + X / M, g.W), y: wrap(p.y + Y / M, g.H), m: M } : null;
}
// Points with mass: the blocks whose 3 x 3 sum is a local maximum above a
// quarter of the largest. One point per creature, near enough.
function gridPeaks(g) {
  const s = new Float32Array(g.m.length);
  let top = 0;
  for (let y = 0; y < g.gh; y++) for (let x = 0; x < g.gw; x++) {
    let v = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v += g.m[wrap(y + j, g.gh) * g.gw + wrap(x + i, g.gw)];
    s[y * g.gw + x] = v; top = Math.max(top, v);
  }
  const out = [];
  for (let y = 0; y < g.gh; y++) for (let x = 0; x < g.gw; x++) {
    const v = s[y * g.gw + x];
    if (v < top * 0.25) continue;
    let max = true;
    for (let j = -2; j <= 2 && max; j++) for (let i = -2; i <= 2; i++) {
      if ((i || j) && s[wrap(y + j, g.gh) * g.gw + wrap(x + i, g.gw)] > v) { max = false; break; }
    }
    if (max) out.push({ x: (x + 0.5) * g.B, y: (y + 0.5) * g.B, v });
  }
  return out;
}
// Plate text, index gn - 1 and kn - 1 (the order of growthTeX and CORE_TEX).
const SAVER_GROWTH = ['G(u) = 2(1 − (u − m)²/9s²)₊⁴ − 1', 'G(u) = 2 exp(−(u − m)²/2s²) − 1', 'G(u) = +1 if |u − m| ≤ s, else −1'];
const SAVER_CORE = ['k(r) = (4r(1 − r))⁴', 'k(r) = exp(4 − 1/(r(1 − r)))', 'k(r) = 1 if ¼ ≤ r ≤ ¾, else 0',
  'k(r) = 1 if ¼ ≤ r ≤ ¾, ½ if r < ¼, else 0'];
// The values on the plate are the live rule (S.rule), so a slider change in
// the panel shows here too. tex is the panel TeX (GENERAL, growthTeX,
// CORE_TEX) in the RULES colours. The growth line holds the values of m
// and s already, so the plate gets the symbol form.
function saverLabel(label) {
  const c = S.c;
  if (!label || !c) return;
  const R = Math.round(c.R * S.rule.scale * det() * 10) / 10;
  const params = [
    { sym: 'm', name: 'growth centre', value: S.rule.m.toFixed(3), cls: 'm5' },
    { sym: 's', name: 'growth width', value: S.rule.s.toFixed(4), cls: 'm6' },
    { sym: 'T', name: 'time resolution', value: String(S.rule.T), cls: 'm4' },
    { sym: 'R', name: 'kernel radius', value: R + ' cells' },
  ];
  if (c.b.length > 1) params.push({ sym: '\\beta', name: 'ring heights', value: '(' + c.b.map(v => +v.toFixed(3)).join(', ') + ')' });
  const growth = [String.raw`G(u) = 2\Big(1 - \tfrac{(u-m)^2}{9 s^2}\Big)_+^4 - 1`, String.raw`G(u) = 2\exp\!\Big(-\tfrac{(u-m)^2}{2 s^2}\Big) - 1`,
    String.raw`G(u) = \pm 1,\ +1 \text{ if } |u-m| \le s`][c.gn - 1] || '';
  label({
    title: c.name, sub: `Lenia · ${c.code}${c.cname ? ' · ' + c.cname : ''}`, params,
    lines: c.cls === 'grow' ? ['Grows without limit'] : [],
    tex: [GENERAL, growth, CORE_TEX[c.kn - 1] || CORE_TEX[0]].filter(Boolean), rules: RULES,
    eq: ['A(t + Δt) = clip₀¹[A(t) + (1/T)·G(K ∗ A(t))]', SAVER_GROWTH[c.gn - 1] || SAVER_GROWTH[0],
      'K(r) = β⌊Br/R⌋ · k(Br/R mod 1)', SAVER_CORE[c.kn - 1] || SAVER_CORE[0]],
    anchor: c.cls === 'grow' ? null : creatureAnchor,
  });
}
// The creature on screen, for the shell's label plate. In the saver it is
// the tracked creature (saverTrack), moved forward by its velocity. It maps
// as the render shader does: canvas centre + offset + (cell - view centre)
// x cellPx. r is the kernel radius on the screen. Null when no creature is
// tracked or it is off the canvas. Page CSS px.
function creatureAnchor() {
  const tr = S.saverTrack, E = S.engine;
  if (!E || !tr || !tr.p) return null;
  const rc = $('gl').getBoundingClientRect(), { W, H } = E.info, v = E.view, k = E.cellPx();
  const q = trackAt(tr);
  const x = rc.left + rc.width / 2 + v.ox + wrapDelta(q.x - v.cx, W) * k, y = rc.top + rc.height / 2 + v.oy + wrapDelta(q.y - v.cy, H) * k;
  if (x < rc.left || x > rc.right || y < rc.top || y > rc.bottom) return null;
  return { x, y, r: E.info.R * k, pts: [{ x, y }] };
}
// The tracked point now: the last grid centroid moved by the velocity.
function trackAt(tr) {
  const { W, H } = S.engine.info, age = shownTime() - tr.t;
  return { x: wrap(tr.p.x + tr.v.x * age, W), y: wrap(tr.p.y + tr.v.y * age, H) };
}
window.snSaver = {
  async enter(opts) {
    const calm = Math.max(0, Math.min(1, +opts.calm || 0));
    while (S.idx < 0) await new Promise(r => setTimeout(r, 50));
    S.saver = true;
    const st = document.createElement('style');
    st.textContent = 'html.saver #panel,html.saver #gear,html.saver #toast,html.saver #cursor,html.saver #dock,html.saver #status,'
      + 'html.saver #browser,html.saver #nogpu{display:none!important}'
      + 'html.saver #gl{left:0!important;width:100%!important;transition:none!important}'
      + 'html.saver #saver-cv{position:fixed;inset:0;width:100%;height:100%;z-index:30;cursor:none;background:#000}';
    document.head.appendChild(st); document.documentElement.classList.add('saver');
    setOpen(false); openBrowser(false);
    if (S.applySize) S.applySize();
    const gl = $('gl');
    if (!S.engine) return { canvas: gl, warmupMs: 0 };
    const E = S.engine;
    const cv = document.createElement('canvas'); cv.id = 'saver-cv'; document.body.appendChild(cv);
    const c2 = cv.getContext('2d', { alpha: false });
    let plateBand = null;
    import('../../lib/saver-clear.js').then(m => { plateBand = m.plateBand; }).catch(() => { /* no band: the canvas centre */ });

    const rnd = mulberry(opts.seed);
    const pick = a => a[Math.floor(rnd() * a.length)];
    // A seeded shuffle, so each run plays a new order from a new start.
    const list = SAVER_CODES.map(code => S.creatures.findIndex(c => c.code === code)).filter(i => i >= 0);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const FADE = 1.0;
    const shotLen = () => 6 + 4 * calm * 0.5 + rnd() * 3;
    let k = -1, t = 0, last = 0, dead = 0, tIn = -1e9, sceneT = 0;
    let scene = null, shot = null, si = 0, grid = null, gridBusy = false, gridF = 0, band = null, bandAt = -1e9;
    let mass0 = 0;   // the mass of the set soon after the stamp
    let simRate = 1, simT0 = 0, wall0 = 0;   // sim time units per second, measured
    const cam = { x: 0, y: 0, z: 1 };
    const track = { p: null, v: { x: 0, y: 0 }, t: 0 };
    S.saverTrack = track;
    const Rc = () => E.info.R;

    // The pixel size of a cell at zoom 1, and the clear band in CSS px.
    const px1 = () => E.cellPx() / E.view.zoom;
    const bandBox = () => {
      const w = gl.clientWidth, h = gl.clientHeight;
      const bt = band ? Math.min(band.t, h * 0.4) : 0, bb = band ? Math.min(band.b, h * 0.4) : 0;
      return { w: band && band.w ? Math.min(w, band.w) : w, h: Math.max(80, h - bt - bb), oy: (bt - bb) / 2 };
    };
    // The zoom at which the creature fills f of the short side of the clear
    // band. The size is the start patch (1.2 to 1.6 R for most gliders).
    const size = () => Math.max(S.c.w, S.c.h) * S.rule.scale * det();
    const zFor = f => { const bx = bandBox(); return Math.max(1, Math.min(7, f * Math.min(bx.w, bx.h) / (size() * px1()))); };
    // Half the clear band in cells at zoom z, along a unit direction d.
    const halfSpan = (z, d) => { const bx = bandBox(), c = px1() * z; return 0.5 * Math.min(Math.abs(d.x) > 1e-6 ? bx.w / Math.abs(d.x) : 1e9, Math.abs(d.y) > 1e-6 ? bx.h / Math.abs(d.y) : 1e9) / c; };

    // Stamp the scene: n copies of the creature at random places and turns,
    // kept 5 R apart on the torus.
    const stage = () => {
      if (scene.n <= 1) { placeCreature(); mass0 = 0; return; }
      const { W, H } = E.info, base = resample(cellsOf(S.c), S.rule.scale * det());
      const gap = 5 * Rc(), pts = [];
      for (let tries = 0; pts.length < scene.n && tries < 200; tries++) {
        const p = { x: rnd() * W, y: rnd() * H };
        if (pts.every(q => Math.hypot(wrapDelta(p.x - q.x, W), wrapDelta(p.y - q.y, H)) > gap)) pts.push(p);
      }
      E.clear();
      for (const p of pts) E.stamp(rotate(base, Math.floor(rnd() * 4)), Math.round(p.x), Math.round(p.y));
      S.time = 0; S.acc = 0; S.stats = null; S.vel = { x: 0, y: 0 }; mass0 = 0;
      track.p = { x: pts[0].x, y: pts[0].y }; track.v = { x: 0, y: 0 }; track.t = 0;
    };
    const showScene = () => {
      k = (k + 1) % list.length;
      setPlaying(true);
      S.worldShort = 256; S.detail = 1;
      selectCreature(list[k]);
      sizeWorld(true);
      setFollow(false);
      const grow = S.c.cls === 'grow';
      const { W, H } = E.info, room = Math.floor(W * H / (36 * Rc() * Rc()));
      const n = grow ? 1 : Math.max(1, Math.min(room, 4, rnd() < 0.3 ? 1 : 2 + Math.floor(rnd() * 3)));
      const kind = grow ? 'grow' : n > 1 ? 'herd' : 'one';
      scene = { n, kind, shots: pick(SHOTS[kind]) };
      track.p = { x: W / 2, y: H / 2 }; track.v = { x: 0, y: 0 }; track.t = 0;
      stage();
      grid = null;
      S.speed = 3.5 * (1 - 0.3 * calm);
      t = 0; sceneT = 0; dead = 0; tIn = -1e9; si = -1; mass0 = 0;
      saverLabel(opts.label);
      nextShot();
    };
    // Start a shot: choose its subject, then put the camera on its first
    // pose with no ease (a hard cut).
    const nextShot = () => {
      si++;
      const type = scene.shots[si % scene.shots.length], dur = shotLen();
      const { W, H } = E.info;
      // A herd or grower shot takes a new creature (or part) to look at. An
      // ahead or drift shot keeps the creature, which has a velocity.
      if (grid && si > 0 && scene.kind !== 'one' && type !== 'ahead' && type !== 'drift') {
        const pk = gridPeaks(grid);
        if (pk.length) { const p = pick(pk), c = gridCentroid(grid, p, 1.6 * Rc()) || p; track.p = { x: c.x, y: c.y }; track.v = { x: 0, y: 0 }; track.t = shownTime(); }
      }
      const P = track.p ? trackAt(track) : { x: W / 2, y: H / 2 };
      const sp = Math.hypot(track.v.x, track.v.y);
      const dir = sp > 1e-3 ? { x: track.v.x / sp, y: track.v.y / sp } : (a => ({ x: Math.cos(a), y: Math.sin(a) }))(rnd() * Math.PI * 2);
      const zc = zFor(0.75);
      shot = { type, dur, t: 0, dir, zc, fix: null, pan: null };
      // ahead: the camera waits on the path, half a shot in front of the
      // creature, at a zoom that holds the whole crossing in the clear band.
      // The band is wide and short, so a path that is mostly vertical gets
      // a drift. With no clear motion it is a push-in.
      if (shot.type === 'ahead') {
        const travel = sp * simRate * dur;
        if (travel < 1.5 * Rc()) shot.type = 'push';
        else if (Math.abs(dir.y) > 0.6) shot.type = 'drift';
        else {
          const h1 = halfSpan(1, dir), z = Math.max(1, Math.min(zc, (h1 - 0.6 * size()) / (0.55 * travel)));
          shot.fix = { x: wrap(P.x + dir.x * travel * 0.5, W), y: wrap(P.y + dir.y * travel * 0.5, H), z };
        }
      }
      // drift: the sweep is along x, where the band has room.
      if (shot.type === 'drift') shot.dir = { x: rnd() < 0.5 ? -1 : 1, y: 0 };
      if (type === 'wide') shot.fix = { x: P.x, y: P.y, z: 1 };
      if (type === 'pan') {
        const a = rnd() * Math.PI * 2, z = Math.max(1.3, zc * 0.7);
        shot.pan = { x: P.x, y: P.y, vx: Math.cos(a) * halfSpan(z, { x: 1, y: 0 }) * 0.9 / dur, vy: Math.sin(a) * halfSpan(z, { x: 0, y: 1 }) * 0.9 / dur, z };
      }
      const p0 = pose(0);
      cam.x = p0.x; cam.y = p0.y; cam.z = p0.z;
    };
    const ease = s => s * s * (3 - 2 * s);
    // The camera target at shot time ts.
    const pose = ts => {
      const s = Math.min(1, ts / shot.dur), { W, H } = E.info;
      const P = track.p ? trackAt(track) : { x: W / 2, y: H / 2 };
      switch (shot.type) {
        case 'push': return { x: P.x, y: P.y, z: Math.max(1, shot.zc * (0.45 + 0.55 * ease(s))) };
        case 'drift': {
          // The creature crosses the frame: the camera holds an offset that
          // goes from one side to the other, a creature radius inside the band.
          const z = Math.max(1, shot.zc * 0.55), o = (0.5 - s) * 2 * Math.max(0, halfSpan(z, shot.dir) - 0.6 * size() - 4);
          return { x: wrap(P.x + shot.dir.x * o, W), y: wrap(P.y + shot.dir.y * o, H), z };
        }
        case 'ahead': return shot.fix;
        case 'wide': return { x: shot.fix.x, y: shot.fix.y, z: 1 + 0.25 * s };
        case 'pan': return { x: wrap(shot.pan.x + shot.pan.vx * ts, W), y: wrap(shot.pan.y + shot.pan.vy * ts, H), z: shot.pan.z };
      }
      return { x: P.x, y: P.y, z: 1 };
    };
    // Read the world into the block grid and move the tracker to the
    // centroid near its last point. A lost creature goes to the nearest peak.
    const readGrid = () => {
      if (gridBusy) return;
      gridBusy = true;
      const ts = S.time, B = Math.max(4, Math.round(Rc() / 2)), sc = scene;
      E.readState().then(A => {
        const { W, H } = E.info;
        if (sc !== scene || A.length !== W * H) return;
        grid = saverGrid(A, W, H, B);
        const prev = track.p ? { x: wrap(track.p.x + track.v.x * (ts - track.t), W), y: wrap(track.p.y + track.v.y * (ts - track.t), H) } : { x: W / 2, y: H / 2 };
        let c = gridCentroid(grid, prev, 1.6 * Rc());
        if (!c) {
          const pk = gridPeaks(grid);
          if (!pk.length) return;
          pk.sort((a, b) => Math.hypot(wrapDelta(a.x - prev.x, W), wrapDelta(a.y - prev.y, H)) - Math.hypot(wrapDelta(b.x - prev.x, W), wrapDelta(b.y - prev.y, H)));
          c = gridCentroid(grid, pk[0], 1.6 * Rc()) || pk[0];
          track.v = { x: 0, y: 0 };
        } else if (track.p && ts - track.t > 1e-3) {
          const vx = wrapDelta(c.x - track.p.x, W) / (ts - track.t), vy = wrapDelta(c.y - track.p.y, H) / (ts - track.t);
          // A grower spreads: its centroid speed is not a motion to follow.
          const g = scene.kind === 'grow' ? 0 : 0.15;
          track.v = { x: track.v.x * (1 - g) + vx * g, y: track.v.y * (1 - g) + vy * g };
        }
        track.p = { x: c.x, y: c.y }; track.t = ts;
      }).catch(() => {}).finally(() => { gridBusy = false; });
    };

    // The state of the director, for the headless probe.
    window.snSaver.debug = () => ({ code: S.c && S.c.code, scene: scene && { n: scene.n, kind: scene.kind }, shot: shot && { type: shot.type, t: +shot.t.toFixed(1), dur: +shot.dur.toFixed(1) },
      cam: { x: Math.round(cam.x), y: Math.round(cam.y), z: +cam.z.toFixed(2) }, track: track.p && { x: Math.round(track.p.x), y: Math.round(track.p.y), vx: +track.v.x.toFixed(2), vy: +track.v.y.toFixed(2) },
      world: [E.info.W, E.info.H], simRate: +simRate.toFixed(2), band: bandBox(), steps: S.stepCap, mass: S.stats && +S.stats.mass.toFixed(1) });
    showScene();
    (function drive(now) {
      requestAnimationFrame(drive);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      t += dt; sceneT += dt; shot.t += dt;
      if (now - wall0 > 2000) { if (wall0) simRate = 0.5 * simRate + 0.5 * Math.max(0.05, (S.time - simT0) / ((now - wall0) / 1000)); wall0 = now; simT0 = S.time; }
      if (now - bandAt > 250 && plateBand) { bandAt = now; band = plateBand(innerHeight); }
      S.saverOcc = { x: 0, y: bandBox().oy };
      if (sceneT > 0.5 && ++gridF % 12 === 0) readGrid();
      if (shot.t > shot.dur) {
        if (si + 1 >= scene.shots.length) { showScene(); t = 0; } else nextShot();
      }
      // A creature set that dies leaves an empty world: stamp it again. The
      // copy goes to black across the 1 s wait and fades in on the new stamp.
      // A set that fills the world after a collision ends the scene.
      if (S.stats && !mass0 && S.time > 1) mass0 = S.stats.mass;
      const bloom = scene.kind !== 'grow' && mass0 > 0 && S.stats && S.stats.mass > 2.5 * mass0;
      if (S.stats && (S.stats.mass < 1e-3 || bloom) && S.time > 2) {
        if ((dead += dt) > 1) { if (bloom) showScene(); else { stage(); tIn = t; } dead = 0; }
      } else dead = 0;
      // Ease the camera to the pose. A fixed pose holds still.
      const p = pose(shot.t), { W, H } = E.info, a = 1 - Math.exp(-dt * 3), az = 1 - Math.exp(-dt * 2);
      cam.x = wrap(cam.x + wrapDelta(p.x - cam.x, W) * a, W); cam.y = wrap(cam.y + wrapDelta(p.y - cam.y, H) * a, H);
      cam.z += (p.z - cam.z) * az;
      E.setView({ cx: cam.x, cy: cam.y, zoom: cam.z });
      if (cv.width !== gl.width || cv.height !== gl.height) { cv.width = gl.width; cv.height = gl.height; }
      c2.drawImage(gl, 0, 0);
      const left = scene.shots.length - si - 1;
      const f = Math.max(0, 1 - t / FADE, left ? 0 : 1 - (shot.dur - shot.t) / FADE, Math.min(1, dead), 1 - (t - tIn) / FADE);
      if (f > 0) { c2.fillStyle = `rgba(0,0,0,${Math.min(1, f)})`; c2.fillRect(0, 0, cv.width, cv.height); }
    })(0);
    return { canvas: cv, warmupMs: 1500 };
  },
};

boot();

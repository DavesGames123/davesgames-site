/* ============================================================================
   REACTION–DIFFUSION  ·  main script  (ES module)
   ----------------------------------------------------------------------------
   engine.js steps and draws the grid on the GPU. This script loads the
   presets, builds the controls, and sends each change to the engine. It does
   no simulation work itself.

   DATA PATH
     presets.json ──> selectPreset ──> engine.setPreset, setView, setParam
     slider input ──> engine.setParam(name, value)            (live uniform)
     pointer drag ──> gridUV ──> engine.paint(u, v, r, chem, value | 'noise')
     frame        ──> engine.step(steps per frame) ──> engine.render()

   GRID COORDINATES. The engine shows the grid with its aspect kept. gridUV
   asks the engine for the rect it draws the grid into (in canvas CSS px). If
   the engine gives no rect, gridUV uses a centered "contain" fit. On a
   wrapped grid the engine can repeat the tile to fill the canvas, so gridUV
   wraps u and v into [0, 1).

   NO WEBGPU. If engine.js cannot get a GPU device, the page keeps the preset
   browser, the equations and the About text, and shows #nogpu.

   GREP MAP
     grep -n 'function boot'            load order and the first preset
     grep -n 'function selectPreset'    load a preset into the engine and UI
     grep -n 'function buildParams'     one slider per preset parameter
     grep -n 'function buildView'       colormap swatches, range, relief
     grep -n 'function buildBrowser'    the grouped, searchable preset list
     grep -n 'function familyColor'     the chip color for each family
     grep -n 'function gridUV'          canvas pixel -> grid (u, v)
     grep -n 'function drawAxes'        parameter-map axis labels
     grep -n 'function frame'           the render loop
     grep -n 'function bindPointer'     painting and dock taps
     grep -n 'function bindKeys'        keyboard shortcuts
     grep -n 'function setOpen'         the panel, the phone sheet, the dock
   ========================================================================== */
import { renderEquations, renderTeX, fitEquations, GENERAL } from './equations.js';

const $ = id => document.getElementById(id);
// The phone layout. This query matches the PHONE block in style.css.
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const FINE_Q = matchMedia('(pointer:fine)');
const LS_KEY = 'stella-nova.reaction-diffusion.preset';
const READY_URL = 'https://github.com/GollyGang/ready';
const READY_REV = '7814c952';
const CHEMS = ['a', 'b', 'c', 'd'];

const S = {
  presets: [], idx: -1, preset: null,
  engine: null, gpu: true, busy: false,
  playing: true, spf: 10, dirty: true,
  brush: { on: false, chem: 'b', kind: 'value', value: 1, size: 0.04 },
  view: { colormap: null, chem: 'b', low: 0, high: 1, height: false, lightAngle: 126, heightScale: 6 },
  cmaps: [],
};

// ------------------------------------------------------------------ helpers
function setText(el, s) { if (typeof el === 'string') el = $(el); if (el && el.textContent !== s) el.textContent = s; }
function decimals(step) {
  if (!step || step >= 1) return 0;
  const s = String(step);
  if (s.includes('e-')) return +s.split('e-')[1];
  return Math.min(6, (s.split('.')[1] || '').length);
}
function fmt(v, step) {
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2).replace(/\.?0+e/, 'e');
  return v.toFixed(Math.max(decimals(step), a < 1 && a > 0 ? 3 : 0)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function chemName(p, c) { const i = CHEMS.indexOf(c); return (p && p.names && p.names[i]) || c; }

let toastT = 0;
function toast(msg, err = false, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? Math.max(ms, 7000) : ms);
}

// ------------------------------------------------------------ family colors
// Known families get fixed hues. Any other family gets a hue from its name.
const FAMILY_HUE = {
  'Gray–Scott': 168, 'FitzHugh–Nagumo': 28, 'Brusselator': 280, 'Turing': 200, 'Meinhardt': 330,
  'Oregonator': 48, 'Lotka–Volterra': 105, 'Ginzburg–Landau': 250, 'Schrödinger': 225,
  'Kuramoto–Sivashinsky': 0, 'Wave': 190, 'Heat': 14,
};
const famCache = new Map();
function familyColor(f) {
  if (famCache.has(f)) return famCache.get(f);
  let h = FAMILY_HUE[f];
  if (h === undefined) { h = 0; for (const ch of String(f)) h = (h * 31 + ch.charCodeAt(0)) % 360; }
  const c = `hsl(${h} 70% 62%)`;
  famCache.set(f, c);
  return c;
}
function chipEl(f, tag = 'span') {
  const el = document.createElement(tag);
  el.className = 'chip'; el.textContent = f; el.style.setProperty('--c', familyColor(f));
  return el;
}

// ---------------------------------------------------------------- colormaps
// colormaps.js belongs to the engine. Read its exports in a tolerant way: an
// array or a map of maps, each map a list of colors or a LUT.
function toCss(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c) || ArrayBuffer.isView(c)) {
    let v = Array.from(c);
    if (v.length === 4 && v[0] <= 1 && v.slice(1).some(x => x > 1)) v = v.slice(1); // [t, r, g, b] 0..255
    else if (v.length === 4) v = v.slice(0, 3);
    const k = v.some(x => x > 1) ? 1 : 255;
    return `rgb(${v.slice(0, 3).map(x => Math.round(x * k)).join(' ')})`;
  }
  if (c && typeof c === 'object') return toCss(c.color || c.rgb || [c.r, c.g, c.b]);
  return '#888';
}
function gradientCss(stops) {
  if (!stops) return 'linear-gradient(90deg,#000,#fff)';
  let list = stops;
  if (ArrayBuffer.isView(list) && typeof list[0] === 'number') { // flat LUT, 3 or 4 values per entry
    const n = list.length % 4 === 0 ? 4 : 3, out = [];
    const count = list.length / n, step = Math.max(1, Math.floor(count / 16));
    for (let i = 0; i < count; i += step) out.push(Array.from(list.slice(i * n, i * n + 3)));
    list = out;
  } else if (Array.isArray(list) && typeof list[0] === 'number') {
    const out = []; for (let i = 0; i + 2 < list.length; i += 3) out.push(list.slice(i, i + 3)); list = out;
  }
  const n = list.length;
  const parts = list.map((c, i) => {
    const t = (c && typeof c === 'object' && !Array.isArray(c) && 't' in c) ? c.t
      : (Array.isArray(c) && c.length === 4 && c[0] <= 1 && c.slice(1).some(x => x > 1)) ? c[0] : i / Math.max(1, n - 1);
    return `${toCss(c)} ${(t * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg,${parts.join(',')})`;
}
function readColormaps(mod) {
  if (!mod) return [];
  let src = mod.COLORMAPS || mod.colormaps || mod.COLOR_MAPS || mod.default;
  if (typeof src === 'function') { try { src = src(); } catch (e) { src = null; } }
  if (!src) return [];
  const arr = Array.isArray(src) ? src
    : Object.entries(src).map(([id, v]) => (Array.isArray(v) || ArrayBuffer.isView(v)) ? { id, stops: v } : { id, ...v });
  return arr.map(c => {
    const id = c.id || c.name || c.key;
    let css = null;
    for (const fn of ['cssGradient', 'colormapCss', 'gradientCss']) {
      if (typeof mod[fn] === 'function') { try { css = mod[fn](id); break; } catch (e) { /* next */ } }
    }
    const labels = mod.COLORMAP_LABELS || {};
    return { id, label: labels[id] || c.label || c.title || c.name || id, css: css || c.css || gradientCss(c.stops || c.colors || c.lut || c.data) };
  }).filter(c => c.id);
}

// --------------------------------------------------------------------- boot
async function boot() {
  buildStatic();
  let presets = [];
  try {
    const r = await fetch(new URL('presets.json', import.meta.url), { cache: 'no-cache' });
    presets = await r.json();
  } catch (e) {
    setText('curName', 'Presets did not load');
    toast('presets.json did not load: ' + e.message, true);
    return;
  }
  S.presets = Array.isArray(presets) ? presets : (presets.presets || []);
  try { S.cmaps = readColormaps(await import('./colormaps.js')); } catch (e) { S.cmaps = []; console.warn('[rd] colormaps.js', e); }
  buildBrowser();

  try {
    const mod = await import('./engine.js');
    S.engine = await mod.createEngine($('gl'), { mobile: PHONE_Q.matches });
  } catch (e) {
    console.warn('[rd] engine', e);
    S.gpu = false;
    document.body.classList.add('nogpu');
    $('nogpu').hidden = false;
    renderTeX($('ngEq'), GENERAL);
    if (!/webgpu-unavailable/.test(String(e && e.message))) toast('The engine did not start: ' + (e && e.message), true);
  }
  if (S.engine) {
    S.engine.onLost = () => { setPlaying(false); toast('The GPU device was lost. Reload the page to start again.', true); };
    observeSize(); bindPointer();
  }

  const fromHash = decodeURIComponent(location.hash.slice(1));
  let i = S.presets.findIndex(p => p.id === fromHash);
  if (i < 0) i = S.presets.findIndex(p => p.id === lsGet(LS_KEY));
  if (i < 0) i = 0;
  await selectPreset(i);
  addEventListener('hashchange', () => {
    const j = S.presets.findIndex(p => p.id === decodeURIComponent(location.hash.slice(1)));
    if (j >= 0 && j !== S.idx) selectPreset(j);
  });
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ preset change
let selectSeq = 0, engineQ = Promise.resolve();
// A preset that does not compile leaves the old one in the engine. The page
// then stops the steps and shows the compiler message over the canvas.
function setFailed(msg) {
  S.failed = !!msg;
  $('fail').hidden = !msg;
  document.body.classList.toggle('failed', !!msg);
  if (msg) setText('failMsg', msg);
}
async function selectPreset(i) {
  const n = S.presets.length;
  if (!n) return;
  i = ((i % n) + n) % n;
  const p = S.presets[i], seq = ++selectSeq;
  S.idx = i; S.preset = p;
  const r = p.render || {};
  S.view = {
    colormap: r.colormap || (S.cmaps[0] && S.cmaps[0].id) || null,
    chem: r.chem || 'a', low: r.low ?? 0, high: r.high ?? 1,
    height: !!r.height, lightAngle: S.view.lightAngle, heightScale: S.view.heightScale,
  };
  if (S.cmaps.length && !S.cmaps.some(c => c.id === S.view.colormap)) S.view.colormap = S.cmaps[0].id;
  S.spf = Math.max(1, Math.round(p.speed || 10));

  // Text first, so the UI reacts at once even when the compile is slow.
  const fam = $('curFamily');
  fam.textContent = p.family || 'Other'; fam.style.setProperty('--c', familyColor(p.family || 'Other'));
  setText('curIdx', `${i + 1} / ${n}`);
  setText('curName', p.name || p.id);
  setText('dockName', p.name || p.id);
  $('dockDot').style.setProperty('--c', familyColor(p.family || 'Other'));
  setText('curDesc', p.description || '');
  renderEquations($('eqs'), p.equations);
  // KaTeX fonts can arrive after the first render and make a line wider.
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => fitEquations($('eqs')));
  const cite = $('curCite'); cite.textContent = '';
  if (p.citation) cite.append(p.citation);
  if (p.source) {
    const a = document.createElement('a');
    a.className = 'src'; a.target = '_blank'; a.rel = 'noopener';
    a.href = `${READY_URL}/blob/${READY_REV}/${p.source.split('/').map(encodeURIComponent).join('/')}`;
    a.textContent = 'Ready: ' + p.source;
    cite.append(a);
  }
  buildParams(p);
  buildBrushChems(p);
  buildView(p);
  $('spf').max = Math.max(100, S.spf * 4); $('spf').value = S.spf; $('spf').dispatchEvent(new Event('input'));
  markBrowser();
  const id = encodeURIComponent(p.id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  lsSet(LS_KEY, p.id);
  document.title = `${p.name} — Reaction–Diffusion — Stella Nova`;

  // One engine call at a time, in order. A call for a preset that is no
  // longer the current one is skipped, so fast key presses do not stack.
  if (S.engine) {
    S.busy = true;
    engineQ = engineQ.then(async () => {
      if (seq !== selectSeq) return;
      try {
        await S.engine.setPreset(p);
        if (seq !== selectSeq) return;
        setFailed(null);
        pushView();
        capSteps();
      } catch (e) {
        console.error('[rd] setPreset', p.id, e);
        if (seq === selectSeq) setFailed(e.message || String(e));
      } finally {
        if (seq === selectSeq) { S.busy = false; S.dirty = true; drawAxes(); }
      }
    });
    await engineQ;
  }
  S.dirty = true;
  drawAxes();
}

// The engine caps the steps per frame by the grid size (less on a phone).
// The slider stops at that cap, so it never shows steps that do not run.
function capSteps() {
  const inp = $('spf');
  const cap = S.engine && S.engine.maxStepsPerFrame ? S.engine.maxStepsPerFrame() : 100;
  inp.max = Math.max(1, Math.min(cap, Math.max(100, S.spf * 4)));
  if (S.spf > +inp.max) { inp.value = inp.max; inp.dispatchEvent(new Event('input')); }
}

function pushView() {
  if (!S.engine) return;
  // The engine takes the light angle in radians. The UI shows degrees.
  try { S.engine.setView({ ...S.view, lightAngle: S.view.lightAngle * Math.PI / 180 }); } catch (e) { console.warn('[rd] setView', e); }
  S.dirty = true;
}

// --------------------------------------------------------------- parameters
function buildParams(p) {
  const box = $('params'); box.textContent = '';
  const pm = p.paramMap;
  for (const q of p.params || []) {
    const mapped = pm && (pm.x === q.name || pm.y === q.name);
    const lo = q.min ?? Math.min(0, q.value), hi = q.max ?? (q.value > 0 ? q.value * 2 : 1);
    const step = q.step || (hi - lo) / 200;
    const row = document.createElement('div'); row.className = 'prm' + (mapped ? ' mapped' : '');
    const nm = document.createElement('div'); nm.className = 'nm';
    nm.textContent = q.label || q.name;
    if (q.label && q.label !== q.name) { const s = document.createElement('small'); s.textContent = q.name; nm.append(s); }
    nm.title = q.label || q.name;
    const val = document.createElement('div'); val.className = 'val';
    const rst = document.createElement('button'); rst.className = 'rst same'; rst.textContent = '↺';
    rst.title = 'Reset to ' + fmt(q.value, step); rst.setAttribute('aria-label', `Reset ${q.label || q.name}`);
    const inp = document.createElement('input'); inp.type = 'range';
    inp.min = lo; inp.max = hi; inp.step = step; inp.value = q.value;
    inp.setAttribute('aria-label', q.label || q.name);
    row.append(nm, val, rst, inp);
    box.append(row);
    if (mapped) {
      const ax = pm.x === q.name ? 'x' : 'y';
      val.textContent = `${fmt(pm[ax + '0'], step)}…${fmt(pm[ax + '1'], step)}`;
      inp.disabled = true; rst.disabled = true; rst.style.visibility = 'hidden';
      continue;
    }
    const show = () => {
      val.textContent = fmt(+inp.value, step);
      rst.classList.toggle('same', Math.abs(+inp.value - q.value) < step * 0.5);
    };
    inp.addEventListener('input', () => {
      show();
      if (S.engine) { try { S.engine.setParam(q.name, +inp.value); } catch (e) { console.warn(e); } }
      S.dirty = true;
    });
    rst.addEventListener('click', () => { inp.value = q.value; inp.dispatchEvent(new Event('input')); });
    show();
  }
  const hint = $('mapHint');
  if (pm) {
    hint.hidden = false;
    hint.textContent = `This is a parameter map: ${pm.x} changes from left to right, and ${pm.y} changes from top to bottom. Each part of the grid runs with different values, so one picture shows many patterns.`;
  } else hint.hidden = true;
  if (!(p.params || []).length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'This preset has no parameters.'; box.append(d); }
}

// -------------------------------------------------------------------- brush
function buildBrushChems(p) {
  const sel = $('brushChem'); sel.textContent = '';
  const nc = Math.max(1, Math.min(4, p.chemicals || (p.names || []).length || 2));
  for (let k = 0; k < nc; k++) {
    const o = document.createElement('option'); o.value = CHEMS[k]; o.textContent = chemName(p, CHEMS[k]); sel.append(o);
  }
  const r = p.render || {};
  // The default brush chemical is the one that the first region seed of the
  // start state sets (that seed starts the pattern). Else it is the one on view.
  const seed = seedOp(p);
  S.brush.chem = seed && CHEMS.slice(0, nc).includes(seed.chem) ? seed.chem
    : CHEMS.slice(0, nc).includes(r.chem) ? r.chem : CHEMS[Math.min(1, nc - 1)];
  sel.value = S.brush.chem;
  setBrushRange(p);
}
function seedOp(p) {
  for (const op of p.init || []) if (op.region && op.chem && (op.op === 'set' || op.op === 'noise')) return op;
  return null;
}
// The value slider spans the view range and more. The default is the value
// that the start state sets on that chemical, else the top of the view range.
function setBrushRange(p) {
  const r = p.render || {};
  let lo = r.low ?? 0, hi = r.high ?? 1; if (hi <= lo) hi = lo + 1;
  const span = hi - lo;
  const inp = $('brushVal');
  inp.min = Math.min(0, lo - span * 0.5); inp.max = hi + span * 0.5; inp.step = span / 200;
  let set = null, fill = null;
  for (const op of p.init || []) {
    if (op.chem !== S.brush.chem || typeof op.value !== 'number') continue;
    if (op.op === 'set') set = op.value; else if (op.op === 'fill') fill = op.value;
  }
  const sd = seedOp(p);
  const seedV = sd && sd.chem === S.brush.chem ? (typeof sd.value === 'number' ? sd.value : typeof sd.high === 'number' ? sd.high : null) : null;
  const v = seedV ?? set ?? (S.brush.chem === r.chem ? hi : (fill ?? hi));
  inp.min = Math.min(+inp.min, v); inp.max = Math.max(+inp.max, v);
  inp.value = v; S.brush.value = v; setText('brushValV', fmt(v, +inp.step));
}
function setBrushOn(on) {
  S.brush.on = on;
  const b = $('brushBtn'); b.textContent = on ? 'BRUSH · ON' : 'BRUSH · OFF'; b.classList.toggle('on', on);
  const d = $('dockBrush'); d.classList.toggle('on', on); d.setAttribute('aria-pressed', String(on));
  if (on && PHONE_Q.matches) toast('Brush on: one finger paints. Tap ✎ to stop.', false, 1800);
}

// --------------------------------------------------------------------- view
function buildView(p) {
  const box = $('cmaps'); box.textContent = '';
  for (const c of S.cmaps) {
    const b = document.createElement('button'); b.dataset.id = c.id; b.title = c.label;
    const bar = document.createElement('span'); bar.className = 'bar'; bar.style.background = c.css;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.label;
    b.append(bar, nm); box.append(b);
    b.classList.toggle('on', c.id === S.view.colormap);
    b.addEventListener('click', () => {
      S.view.colormap = c.id;
      for (const x of box.children) x.classList.toggle('on', x === b);
      pushView();
    });
  }
  if (!S.cmaps.length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'No colormaps.'; box.append(d); }
  const sel = $('viewChem'); sel.textContent = '';
  const nc = Math.max(1, Math.min(4, p.chemicals || 2));
  for (let k = 0; k < nc; k++) { const o = document.createElement('option'); o.value = CHEMS[k]; o.textContent = chemName(p, CHEMS[k]); sel.append(o); }
  sel.value = S.view.chem;
  setViewRange();
  setHeightBtn();
}
function setViewRange() {
  let lo = S.view.low, hi = S.view.high; if (hi <= lo) hi = lo + 1;
  const span = hi - lo;
  for (const id of ['viewLo', 'viewHi']) {
    const inp = $(id); inp.min = lo - span; inp.max = hi + span; inp.step = span / 500;
  }
  $('viewLo').value = S.view.low; $('viewHi').value = S.view.high;
  setText('viewLoV', fmt(S.view.low, span / 500)); setText('viewHiV', fmt(S.view.high, span / 500));
}
function setHeightBtn() {
  const b = $('heightBtn');
  b.textContent = S.view.height ? 'RELIEF SHADING · ON' : 'RELIEF SHADING · OFF';
  b.classList.toggle('on', S.view.height);
  $('lightRow').style.display = S.view.height ? '' : 'none';
  $('reliefRow').style.display = S.view.height ? '' : 'none';
}

// ---------------------------------------------------------- preset browser
let famFilter = null;
function buildBrowser() {
  const fams = [];
  for (const p of S.presets) if (!fams.includes(p.family || 'Other')) fams.push(p.family || 'Other');
  const chips = $('famChips'); chips.textContent = '';
  for (const f of fams) {
    const c = chipEl(f, 'button'); c.type = 'button';
    c.addEventListener('click', () => {
      famFilter = famFilter === f ? null : f;
      for (const x of chips.children) x.classList.toggle('on', x.textContent === famFilter);
      fillList();
    });
    chips.append(c);
  }
  $('search').addEventListener('input', fillList);
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('list').querySelector('.br-item'); if (first) first.click(); }
    if (e.key === 'Escape') { e.stopPropagation(); openBrowser(false); }
  });
  fillList();
}
function fillList() {
  const q = $('search').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const box = $('list'); box.textContent = '';
  const groups = new Map();
  S.presets.forEach((p, i) => {
    const f = p.family || 'Other';
    if (famFilter && f !== famFilter) return;
    const hay = [p.name, p.id, f, p.citation, p.description, p.source].join(' ').toLowerCase();
    if (!words.every(w => hay.includes(w))) return;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(i);
  });
  for (const [f, list] of groups) {
    const g = document.createElement('div'); g.className = 'br-group';
    const h = document.createElement('div'); h.className = 'br-gh';
    const dot = document.createElement('span'); dot.className = 'chip-dot'; dot.style.setProperty('--c', familyColor(f));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = list.length;
    h.append(dot, f, n); g.append(h);
    for (const i of list) {
      const p = S.presets[i];
      const b = document.createElement('button'); b.className = 'br-item'; b.dataset.idx = i;
      const dot2 = document.createElement('span'); dot2.className = 'chip-dot'; dot2.style.setProperty('--c', familyColor(f));
      const t = document.createElement('span'); t.className = 't';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name || p.id;
      const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = p.citation || p.source || '';
      t.append(nm, ct); b.append(dot2, t); g.append(b);
      b.addEventListener('click', () => { selectPreset(i); if (PHONE_Q.matches) openBrowser(false); });
    }
    box.append(g);
  }
  if (!groups.size) { const d = document.createElement('div'); d.className = 'br-empty'; d.textContent = 'No preset matches.'; box.append(d); }
  markBrowser();
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
  $('dockPreset').classList.toggle('on', open);
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
  $('playBtn').textContent = on ? '❚❚ PAUSE' : '▶ PLAY';
  $('playBtn').classList.toggle('on', !on);
  $('dockPlay').textContent = on ? '❚❚' : '▶';
  $('dockPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
}
function doReset(newSeed) {
  if (!S.engine || S.failed) return;
  try {
    if (newSeed) S.engine.reset((Math.random() * 0x7fffffff) >>> 0);
    else S.engine.reset();
  } catch (e) { console.warn('[rd] reset', e); }
  S.dirty = true;
}

function buildStatic() {
  renderTeX($('eq-general'), GENERAL);
  $('prevBtn').addEventListener('click', () => selectPreset(S.idx - 1));
  $('nextBtn').addEventListener('click', () => selectPreset(S.idx + 1));
  $('browseBtn').addEventListener('click', () => openBrowser());
  $('browserClose').addEventListener('click', () => openBrowser(false));
  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('stepBtn').addEventListener('click', () => { setPlaying(false); stepOnce(); });
  $('resetBtn').addEventListener('click', () => doReset(false));
  $('dockReset').addEventListener('click', () => doReset(false));
  $('seedBtn').addEventListener('click', () => doReset(true));
  const spf = $('spf');
  spf.addEventListener('input', () => { S.spf = +spf.value; setText('spfV', String(S.spf)); });

  $('brushBtn').addEventListener('click', () => setBrushOn(!S.brush.on));
  $('dockBrush').addEventListener('click', () => setBrushOn(!S.brush.on));
  $('brushChem').addEventListener('change', e => { S.brush.chem = e.target.value; if (S.preset) setBrushRange(S.preset); });
  for (const b of $('brushKind').children) b.addEventListener('click', () => {
    S.brush.kind = b.dataset.kind;
    for (const x of $('brushKind').children) x.classList.toggle('on', x === b);
    $('brushValRow').style.display = S.brush.kind === 'noise' ? 'none' : '';
  });
  $('brushVal').addEventListener('input', e => { S.brush.value = +e.target.value; setText('brushValV', fmt(S.brush.value, +e.target.step)); });
  $('brushSize').addEventListener('input', e => { S.brush.size = +e.target.value; setText('brushSizeV', S.brush.size.toFixed(3)); });
  $('brushSize').dispatchEvent(new Event('input'));
  $('brushHint').textContent = FINE_Q.matches
    ? 'With a mouse the brush is always on: drag on the grid to paint. Keys [ and ] change the size.'
    : 'Turn the brush on, then drag one finger on the grid to paint. With the brush off, a tap on the grid hides or shows the dock.';
  $('brushBtn').parentElement.style.display = FINE_Q.matches ? 'none' : '';

  $('viewChem').addEventListener('change', e => { S.view.chem = e.target.value; pushView(); });
  $('viewLo').addEventListener('input', e => { S.view.low = +e.target.value; setText('viewLoV', fmt(S.view.low, +e.target.step)); pushView(); });
  $('viewHi').addEventListener('input', e => { S.view.high = +e.target.value; setText('viewHiV', fmt(S.view.high, +e.target.step)); pushView(); });
  $('heightBtn').addEventListener('click', () => { S.view.height = !S.view.height; setHeightBtn(); pushView(); });
  $('light').addEventListener('input', e => { S.view.lightAngle = +e.target.value; setText('lightV', S.view.lightAngle + '°'); pushView(); });
  setText('lightV', S.view.lightAngle + '°');
  $('light').value = S.view.lightAngle;
  $('relief').addEventListener('input', e => { S.view.heightScale = +e.target.value; setText('reliefV', S.view.heightScale.toFixed(1)); pushView(); });
  $('relief').value = S.view.heightScale; setText('reliefV', S.view.heightScale.toFixed(1));

  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => setOpen(!$('panel').classList.contains('open')));
  $('dockPreset').addEventListener('click', () => openBrowser());
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
  // The sheet moves over the canvas, so the axis labels move with it.
  panel.addEventListener('transitionend', drawAxes);
  let eqW = 0;
  new ResizeObserver(() => { const w = $('eqs').clientWidth; if (w && Math.abs(w - eqW) > 4) { eqW = w; fitEquations($('eqs')); } }).observe($('eqs'));
  $('browser').addEventListener('transitionend', drawAxes);
  $('gl').addEventListener('transitionend', drawAxes);

  // No pinch zoom, no double-tap zoom, no pull to refresh.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  bindKeys();
}

// ------------------------------------------------------------- grid coords
// The rect (canvas CSS px) that holds one copy of the grid. The engine
// gives it as gridRect() in [0,1] canvas units. The fallback is a centered
// fit with the grid aspect kept.
function displayRect() {
  const cv = $('gl'), cw = cv.clientWidth, ch = cv.clientHeight;
  if (S.engine && typeof S.engine.gridRect === 'function') {
    const g = S.engine.gridRect();
    return { x: g.x0 * cw, y: g.y0 * ch, w: (g.x1 - g.x0) * cw, h: (g.y1 - g.y0) * ch };
  }
  const p = S.preset || {}, W = p.width || 256, H = p.height || 256;
  const s = Math.min(cw / W, ch / H);
  return { x: (cw - W * s) / 2, y: (ch - H * s) / 2, w: W * s, h: H * s };
}
// Client px -> grid (u, v), or null outside the grid. A tiled (wrapped) grid
// repeats over the whole canvas, so the engine wraps u and v into [0, 1).
function gridUV(clientX, clientY) {
  const cv = $('gl'), cr = cv.getBoundingClientRect();
  const cx = (clientX - cr.left) / cr.width, cy = (clientY - cr.top) / cr.height;
  if (S.engine && typeof S.engine.canvasToGrid === 'function') {
    const g = S.engine.canvasToGrid(cx, cy);
    return g.inside ? { u: g.u, v: g.v } : null;
  }
  const r = displayRect();
  let u = (clientX - cr.left - r.x) / r.w, v = (clientY - cr.top - r.y) / r.h;
  if (S.preset && S.preset.wrap) { u -= Math.floor(u); v -= Math.floor(v); }
  else if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

// --------------------------------------------------------- parameter axes
// Tick labels for the two mapped parameters, on the base and the left edge
// of the grid rect. The labels stay inside the clear part of the screen.
function drawAxes() {
  const box = $('axes'); box.textContent = '';
  const p = S.preset, pm = p && p.paramMap;
  if (!pm || !S.engine) return;
  const cr = $('gl').getBoundingClientRect(), r = displayRect();
  const vw = innerWidth, vh = innerHeight;
  let clearB = vh;
  for (const id of ['dock', 'status', 'panel', 'browser']) {
    const el = $(id); const q = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (cs.display === 'none' || q.height < 1 || q.top >= vh || q.width < vw * 0.5) continue;
    if (id === 'browser' && !el.classList.contains('open')) continue;
    if (id === 'panel' && !el.classList.contains('open')) continue;
    clearB = Math.min(clearB, q.top);
  }
  let clearL = cr.left;
  for (const id of ['panel', 'browser']) {
    const el = $(id), q = el.getBoundingClientRect();
    if (el.classList.contains('open') && q.left <= 1 && q.width < vw * 0.5 && q.height > vh * 0.5) clearL = Math.max(clearL, q.right);
  }
  const L = Math.max(cr.left + r.x, clearL) + 6, R = Math.min(cr.left + r.x + r.w, cr.right) - 6;
  const tb = document.querySelector('.topbar'), tbB = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().bottom : 0;
  const T = Math.max(cr.top + r.y, tbB) + 6, B = Math.min(cr.top + r.y + r.h, clearB) - 22;
  if (R - L < 120 || B - T < 120) return;
  const x0 = cr.left + r.x, y0 = cr.top + r.y;
  const nx = R - L > 420 ? 5 : 3, ny = B - T > 360 ? 5 : 3;
  const add = (cls, txt, css) => { const d = document.createElement('div'); d.className = cls; if (cls.startsWith('tk')) { const sp = document.createElement('span'); sp.textContent = txt; d.append(sp); } else d.textContent = txt; Object.assign(d.style, css); box.append(d); return d; };
  const lab = name => { const q = (p.params || []).find(t => t.name === name); return (q && q.label) || name; };
  const stepOf = name => { const q = (p.params || []).find(t => t.name === name); return (q && q.step) || 0.001; };
  // Ticks at even steps of the part of the grid that shows.
  const uL = (L - x0) / r.w, uR = (R - x0) / r.w, vT = (T - y0) / r.h, vB = (B - y0) / r.h;
  for (let k = 0; k < nx; k++) {
    const u = uL + (uR - uL) * (k + 0.5) / nx;
    const val = pm.x0 + (pm.x1 - pm.x0) * u;
    add('tk x', fmt(val, stepOf(pm.x)), { left: (x0 + u * r.w) + 'px', top: B + 'px' });
  }
  for (let k = 0; k < ny; k++) {
    const v = vT + (vB - vT) * (k + 0.5) / ny;
    const val = pm.y0 + (pm.y1 - pm.y0) * v;
    add('tk y', fmt(val, stepOf(pm.y)), { left: L + 'px', top: (y0 + v * r.h) + 'px' });
  }
  add('ttl', `${lab(pm.x)} →`, { left: ((L + R) / 2) + 'px', top: (B - 24) + 'px', transform: 'translateX(-50%)' });
  add('ttl', `${lab(pm.y)} ↓`, { left: (L + 44) + 'px', top: T + 'px' });
}

// ------------------------------------------------------------------ sizing
function observeSize() {
  const cv = $('gl');
  const apply = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    try { S.engine.resize(w, h); } catch (e) { console.warn('[rd] resize', e); }
    S.dirty = true;
    drawAxes();
  };
  new ResizeObserver(apply).observe(cv);
  apply();
}

// -------------------------------------------------------------------- frame
let frames = 0, lastStat = 0;
function stepOnce() {
  if (!S.engine || S.busy || S.failed) return;
  try { S.engine.step(S.spf); } catch (e) { console.warn(e); }
  S.dirty = true;
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!S.engine) return;
  if (S.playing && !S.busy && !S.failed) { try { S.engine.step(S.spf); } catch (e) { console.warn('[rd] step', e); setPlaying(false); } S.dirty = true; }
  if (S.dirty && !S.busy && !S.failed) { try { S.engine.render(); } catch (e) { console.warn('[rd] render', e); } S.dirty = false; }
  frames++;
  if (now - lastStat > 500) {
    lastStat = now;
    const p = S.preset, info = S.engine.info || {};
    setText('stMain', p ? `${p.name}` : '');
    const sps = info.stepsPerSecond ? `${Math.round(info.stepsPerSecond).toLocaleString()} steps/s` : '';
    const fps = info.fps ? `${Math.round(info.fps)} fps` : '';
    setText('stRight', [p ? `${p.width}×${p.height}` : '', sps, fps, S.playing ? '' : 'paused'].filter(Boolean).join(' · '));
  }
}

// ------------------------------------------------------------------ pointer
// Mouse: the left button paints. Touch and pen: one pointer paints when brush
// mode is on. Two pointers stop the paint and do nothing else. With the brush
// off, a short tap hides or shows the dock, or closes an open sheet.
function bindPointer() {
  const cv = $('gl'), cursor = $('cursor');
  const ptrs = new Map();
  let painting = false, lastUV = null, tap = null;
  const brushPx = () => S.brush.size * displayRect().w;
  function paintAt(uv) {
    if (!uv || !S.engine || S.failed || S.busy) return;
    const val = S.brush.kind === 'noise' ? 'noise' : S.brush.value;
    const r = S.brush.size;
    // Fill the gap from the last point with dabs at half-radius spacing.
    if (lastUV) {
      const du = uv.u - lastUV.u, dv = uv.v - lastUV.v, d = Math.hypot(du, dv);
      if (d < 0.5 && d > r * 0.5) {
        const n = Math.min(64, Math.ceil(d / (r * 0.5)));
        for (let k = 1; k < n; k++) { try { S.engine.paint(lastUV.u + du * k / n, lastUV.v + dv * k / n, r, S.brush.chem, val); } catch (e) { /* ignore */ } }
      }
    }
    try { S.engine.paint(uv.u, uv.v, r, S.brush.chem, val); } catch (e) { console.warn('[rd] paint', e); }
    lastUV = uv; S.dirty = true;
  }
  const canPaint = e => e.pointerType === 'mouse' ? e.button === 0 : S.brush.on;
  cv.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, e.pointerType);
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* none */ }
    if (ptrs.size > 1) { painting = false; lastUV = null; tap = null; return; }
    tap = e.pointerType !== 'mouse' ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (canPaint(e)) { painting = true; lastUV = null; paintAt(gridUV(e.clientX, e.clientY)); }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') {
      const d = brushPx() * 2;
      cursor.style.width = cursor.style.height = d + 'px';
      cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px';
      cursor.classList.add('on');
    }
    if (painting && ptrs.size === 1) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const c of (evs.length ? evs : [e])) paintAt(gridUV(c.clientX, c.clientY));
    }
  });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') cursor.classList.remove('on'); });
  const end = e => {
    const was = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (x) { /* none */ }
    if (was && e.type === 'pointerup' && tap && !S.brush.on && ptrs.size === 0 &&
        performance.now() - tap.t < 300 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12) onTap();
    if (ptrs.size === 0) { painting = false; lastUV = null; tap = null; }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => e.preventDefault(), { passive: false });
}
function onTap() {
  if (!PHONE_Q.matches) return;
  if ($('browser').classList.contains('open')) { openBrowser(false); return; }
  if ($('panel').classList.contains('open')) { setOpen(false); return; }
  document.body.classList.toggle('dock-hidden');
  setTimeout(drawAxes, 280);
}

// --------------------------------------------------------------------- keys
function bindKeys() {
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    const typing = tag === 'INPUT' && (t.type === 'search' || t.type === 'text') || tag === 'SELECT' || tag === 'TEXTAREA';
    if (typing) return;
    const onRange = tag === 'INPUT' && t.type === 'range';
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (tag === 'BUTTON') t.blur(); setPlaying(!S.playing); }
    else if (e.key === 'r' || e.key === 'R') { doReset(e.shiftKey); }
    else if (e.key === '[' || e.key === ']') {
      const inp = $('brushSize');
      const v = Math.max(+inp.min, Math.min(+inp.max, +inp.value * (e.key === ']' ? 1.25 : 0.8)));
      inp.value = v; inp.dispatchEvent(new Event('input'));
      toast(`Brush size ${(+inp.value).toFixed(3)}`, false, 900);
    }
    else if (!onRange && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); selectPreset(S.idx + 1); }
    else if (!onRange && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); selectPreset(S.idx - 1); }
    else if (e.key === 'Escape') { openBrowser(false); }
    else if (e.key === '/' ) { e.preventDefault(); openBrowser(true); $('search').focus(); }
  });
}

boot();

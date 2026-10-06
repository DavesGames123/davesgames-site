// ============================================================================
//  PATTERN DESIGNER  ·  main.js — the artboard, controls, book and exports
// ----------------------------------------------------------------------------
//  State lives in st. A change to the pattern, its params, the seed, the
//  board or the modifier stack sends a job to the worker (regen). A change
//  to the palette, the style mode or the line weight only paints again
//  (paint), because the elements name ink slots, not colours.
//
//  The worker runs one job at a time. While it is busy, new changes wait
//  as one pending job, so a slider drag never queues a backlog.
//
//  grep -n targets
//    state ................ "const st ="
//    worker client ........ "function makeRunner"
//    layout ............... "function layout"
//    jobs ................. "function regen"
//    drawing .............. "function paint"
//    pattern controls ..... "function buildParams"
//    palettes ............. "function buildPalettes"
//    modifiers ............ "function buildMods"
//    randomise ............ "function randomiseAll"
//    explorer ............. "function openExplorer"
//    exports .............. "function exportSVG"  "function exportPNG"
//    panel and sheet ...... "function setOpen"
//    saver ................ saver.js (installSaver)
// ============================================================================
import { boardSize, defaults, clampParams, makeRng } from './engine.js';
import { PATTERNS, FAMILIES, byId } from './patterns/index.js';
import { PALETTES, paletteById, BOARDS, boardById, boardDims } from './palettes.js';
import { MOD_KINDS, modDefaults, buildTextShape } from './modifiers.js';
import { applyMode, toSVG, drawItems } from './export.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const STORE = 'pd-state-v1';
const famName = id => (FAMILIES.find(f => f.id === id) || { name: id }).name;

const st = {
  pat: 'arc-lattice', P: null, seed: 1, lock: false,
  pal: 'bone', custom: null, mode: 'auto', lw: 2,
  board: 'a4', land: false, mods: [], dpi: 300,
};
const memo = {};          // params per pattern id, so a return keeps the tweaks
let cur = null;           // the last worker result
let saverOn = false;

// ── worker client ──────────────────────────────────────────────────────────
// run(job) -> Promise of the result. With no module worker (an old
// browser, or file://), the job runs on the main thread.
function makeRunner() {
  let w = null, seq = 0;
  const wait = new Map();
  const local = job => import('./worker.js').then(m => m.runJob(job));
  try {
    w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => { const q = wait.get(e.data.id); if (!q) return; wait.delete(e.data.id); e.data.error ? q.rej(new Error(e.data.error)) : q.res(e.data.res); };
    w.onerror = () => { w = null; for (const [id, q] of wait) { wait.delete(id); local(q.job).then(q.res, q.rej); } };
  } catch (e) { w = null; }
  return {
    run(job) {
      if (!w) return local(job);
      return new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej, job }); w.postMessage({ id, job }); });
    },
  };
}
const mainRunner = makeRunner(), thumbRunner = makeRunner();

// ── helpers ────────────────────────────────────────────────────────────────
const pal = () => st.custom || paletteById(st.pal);
const pat = () => byId(st.pat) || PATTERNS[0];
const dims = () => boardDims(boardById(st.board), st.land);
const size = () => boardSize(dims().aspect);
const fmt = (v, step) => step >= 1 ? String(Math.round(v)) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2);
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}
function save() {
  if (saverOn) return;
  try { localStorage.setItem(STORE, JSON.stringify({ st: Object.assign({}, st, { mods: st.mods.map(m => Object.assign({}, m, { text: undefined })) }), memo })); } catch (e) { /* storage off */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!d || !d.st) return;
    Object.assign(st, d.st); Object.assign(memo, d.memo || {});
    if (!byId(st.pat)) st.pat = PATTERNS[0].id;
    st.mods = (st.mods || []).filter(m => m && MOD_KINDS[m.type]);
  } catch (e) { /* a bad entry: the defaults */ }
}

// ── layout ─────────────────────────────────────────────────────────────────
// The clear part of #desk: the panel covers the left (desktop), the base
// (phone portrait) or the right (phone landscape) while it is open.
function layout() {
  if (saverOn) return;
  const desk = $('desk').getBoundingClientRect(), panel = $('panel');
  let L = desk.left, R = desk.right, T = desk.top, B = desk.bottom;
  if (panel.classList.contains('open')) {
    if (LAND_Q.matches) R = Math.min(R, innerWidth - panel.offsetWidth);
    else if (PHONE_Q.matches) { const top = desk.bottom - panel.offsetHeight; if (top - T > 170) B = top; }
    else L = Math.max(L, panel.offsetWidth);
  }
  const phone = PHONE_Q.matches, cap = phone ? 24 : 34, top = phone ? 12 : 64, m = phone ? 12 : 30;
  const { W, H } = size(), aw = R - L - 2 * m, ah = B - T - top - m - cap;
  const k = Math.max(0.05, Math.min(aw / W, ah / H)), w = Math.floor(W * k), h = Math.floor(H * k);
  const x = Math.round((L + R) / 2 - w / 2 - desk.left), y = Math.round(T + top + (ah - h) / 2 - desk.top);
  const c = $('board'), dpr = Math.min(3, devicePixelRatio || 1);
  c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.width = w + 'px'; c.style.height = h + 'px';
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const cp = $('caption'); cp.style.left = (x + w / 2) + 'px'; cp.style.top = (y + h + (phone ? 6 : 10)) + 'px';
  const bz = $('busy'); bz.style.left = (x + w - 34) + 'px'; bz.style.top = (y + 8) + 'px';
  paint();
}

// ── jobs ───────────────────────────────────────────────────────────────────
const textCache = new Map();
function textShape(text, W, H, margin) {
  const key = `${text}|${W}|${H}|${margin}`;
  if (!textCache.has(key)) {
    if (textCache.size > 8) textCache.clear();
    textCache.set(key, buildTextShape(text, W, H, (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, 'Inter, system-ui, sans-serif', 800, margin));
  }
  return textCache.get(key);
}
function jobNow() {
  const { W, H } = size();
  const mods = st.mods.map(m => {
    const o = Object.assign({}, m);
    if (m.shape === 'text') o.text = textShape(m.word || 'POSTER', W, H, m.margin ?? 0.08);
    return o;
  });
  return { pat: st.pat, P: st.P, seed: st.seed, W, H, mods };
}
let busy = false, pending = false;
function regen() { pending = true; pump(); save(); }
function pump() {
  if (busy || !pending) return;
  pending = false; busy = true;
  const job = jobNow();
  const t = setTimeout(() => $('busy').classList.add('on'), 160);
  mainRunner.run(job).then(res => { cur = Object.assign(res, { W: job.W, H: job.H }); paint(); })
    .catch(err => { console.warn('pattern failed', err); toast('This pattern failed: ' + err.message); })
    .finally(() => { clearTimeout(t); $('busy').classList.remove('on'); busy = false; pump(); });
}

// ── drawing ────────────────────────────────────────────────────────────────
function paint() {
  const c = $('board'), g = c.getContext('2d'), p = pal();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = p.bg; g.fillRect(0, 0, c.width, c.height);
  if (!cur) return;
  const k = c.width / cur.W;
  g.setTransform(k, 0, 0, k, 0, 0);
  drawItems(g, applyMode(cur.items, st.mode), { palette: p, lw: st.lw, clip: cur.clip, frame: cur.frame });
  caption();
}
function caption() {
  const d = dims(), n = cur ? cur.items.length : 0;
  $('caption').innerHTML = `<i>${pat().name}</i> · seed <span class="n">${st.seed}</span> · ${boardById(st.board).name} <span class="n">${d.w} × ${d.h} ${d.unit}</span> · <span class="n">${n.toLocaleString('en')}</span> shapes${cur && cur.capped ? ' (capped)' : ''}`;
}

// ── pattern controls ───────────────────────────────────────────────────────
function setPattern(id, keepParams) {
  if (st.P && st.pat) memo[st.pat] = st.P;
  st.pat = id;
  const p = pat();
  st.P = keepParams ? clampParams(p, keepParams) : clampParams(p, memo[id] || defaults(p));
  buildParams(); patternLabels(); regen();
}
function patternLabels() {
  const p = pat();
  $('patTitle').textContent = p.name; $('patFam').textContent = famName(p.family) + ' pattern';
  $('patBlurb').textContent = p.blurb || '';
  $('dockTitle').textContent = p.name;
  document.querySelectorAll('.ex-card').forEach(c => c.classList.toggle('on', c.dataset.id === p.id));
}
function stepPattern(d) {
  const i = PATTERNS.findIndex(p => p.id === st.pat);
  setPattern(PATTERNS[(i + d + PATTERNS.length) % PATTERNS.length].id);
}
// One slider (or a two-state switch for a 0..1 step-1 param).
function sliderRow(def, value, onChange) {
  const [a, b, step, , label] = def, row = document.createElement('div');
  if (step >= 1 && b - a === 1) {
    row.className = 'prm sw';
    row.innerHTML = `<div class="nm"></div><button></button>`;
    row.querySelector('.nm').textContent = label;
    const btn = row.querySelector('button'), show = v => { btn.textContent = v ? 'On' : 'Off'; btn.classList.toggle('on', !!v); };
    show(value); btn.addEventListener('click', () => { value = value ? 0 : 1; show(value); onChange(value); });
    return row;
  }
  row.className = 'prm';
  row.innerHTML = `<div class="nm"></div><span class="val"></span><input type="range">`;
  row.querySelector('.nm').textContent = label;
  const inp = row.querySelector('input'), val = row.querySelector('.val');
  Object.assign(inp, { min: a, max: b, step, value }); inp.setAttribute('aria-label', label);
  val.textContent = fmt(value, step);
  inp.addEventListener('input', () => { const v = +inp.value; val.textContent = fmt(v, step); onChange(v); });
  return row;
}
function buildParams() {
  const box = $('params'), p = pat(); box.textContent = '';
  for (const k in p.params) box.append(sliderRow(p.params[k], st.P[k], v => { st.P[k] = v; regen(); }));
}

// ── seed ───────────────────────────────────────────────────────────────────
const newSeed = () => 1 + Math.floor(Math.random() * 999998);
function setSeed(s) { st.seed = Math.max(1, Math.min(999999, Math.round(s) || 1)); $('seed').value = st.seed; regen(); }

// ── palettes ───────────────────────────────────────────────────────────────
function buildPalettes() {
  const box = $('palettes'); box.textContent = '';
  for (const p of PALETTES) {
    const b = document.createElement('button');
    b.className = 'pal'; b.dataset.id = p.id; b.title = p.name;
    b.innerHTML = `<div class="sw"><i style="background:${p.bg}"></i>${p.ink.map(c => `<i style="background:${c}"></i>`).join('')}</div><span></span>`;
    b.querySelector('span').textContent = p.name;
    b.addEventListener('click', () => { st.pal = p.id; st.custom = null; palLabels(); paint(); thumbsRepaint(); save(); });
    box.append(b);
  }
  palLabels();
}
// The colour inputs edit a copy of the palette (st.custom).
function palLabels() {
  document.querySelectorAll('.pal').forEach(b => b.classList.toggle('on', !st.custom && b.dataset.id === st.pal));
  const p = pal(), box = $('custom'); box.textContent = '';
  const add = (label, color, set) => {
    const i = document.createElement('input'); i.type = 'color'; i.value = color; i.title = label; i.setAttribute('aria-label', label);
    i.addEventListener('input', () => { if (!st.custom) st.custom = { id: 'custom', name: 'Custom', bg: p.bg, ink: p.ink.slice() }; set(i.value); document.querySelectorAll('.pal').forEach(b => b.classList.remove('on')); paint(); });
    i.addEventListener('change', () => { thumbsRepaint(); save(); });
    box.append(i);
  };
  const l = document.createElement('span'); l.className = 'lbl'; l.textContent = st.custom ? 'Custom' : 'Edit'; box.append(l);
  add('Paper', p.bg, v => { st.custom.bg = v; });
  const s = document.createElement('i'); s.className = 'sep'; box.append(s);
  p.ink.forEach((c, k) => add('Ink ' + (k + 1), c, v => { st.custom.ink[k] = v; }));
}
function stepPalette(d = 1) {
  const i = PALETTES.findIndex(p => p.id === st.pal);
  st.pal = PALETTES[(i + d + PALETTES.length) % PALETTES.length].id; st.custom = null;
  palLabels(); paint(); thumbsRepaint(); save(); toast(pal().name);
}

// ── boards ─────────────────────────────────────────────────────────────────
function buildBoards() {
  const box = $('boards'); box.textContent = '';
  for (const b of BOARDS) {
    const btn = document.createElement('button'); btn.textContent = b.name; btn.dataset.id = b.id;
    btn.addEventListener('click', () => { st.board = b.id; boardLabels(); layout(); regen(); });
    box.append(btn);
  }
  boardLabels();
}
function boardLabels() {
  document.querySelectorAll('#boards button').forEach(b => b.classList.toggle('on', b.dataset.id === st.board));
  $('landBtn').classList.toggle('on', st.land); $('landBtn').setAttribute('aria-pressed', String(st.land));
  const b = boardById(st.board), sel = $('dpi'), opts = b.mm ? [[72, '72 dpi'], [150, '150 dpi'], [300, '300 dpi']] : [[1, '1x'], [2, '2x'], [3, '3x']];
  const want = b.mm ? (st.dpi >= 10 ? st.dpi : 300) : (st.dpi < 10 ? st.dpi : 1);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}"${v === want ? ' selected' : ''}>${t}</option>`).join('');
  st.dpi = +sel.value; exportInfo();
}
function exportInfo() {
  const d = dims(), px = pngSize();
  $('exportInfo').textContent = `PNG ${px.w} × ${px.h} px${px.cut ? ' (reduced to fit the browser limit)' : ''}. SVG ${d.w} × ${d.h} ${d.unit}.`;
}

// ── modifiers ──────────────────────────────────────────────────────────────
function buildMods() {
  const box = $('mods'); box.textContent = '';
  st.mods.forEach((m, i) => {
    const K = MOD_KINDS[m.type], card = document.createElement('div');
    card.className = 'mod' + (m.off ? ' off' : '');
    const h = document.createElement('div'); h.className = 'mod-h';
    h.innerHTML = `<b></b><button data-a="on" title="On or off" class="${m.off ? '' : 'on'}">●</button><button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button><button data-a="rm" title="Remove">✕</button>`;
    h.querySelector('b').textContent = K.label;
    h.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'on') m.off = !m.off;
      if (a === 'rm') st.mods.splice(i, 1);
      if (a === 'up' && i > 0) [st.mods[i - 1], st.mods[i]] = [st.mods[i], st.mods[i - 1]];
      if (a === 'down' && i < st.mods.length - 1) [st.mods[i + 1], st.mods[i]] = [st.mods[i], st.mods[i + 1]];
      buildMods(); regen();
    });
    card.append(h);
    for (const c in K.choice || {}) {
      const seg = document.createElement('div'); seg.className = 'seg';
      for (const v of K.choice[c]) {
        const b = document.createElement('button'); b.textContent = v === 'xy' ? 'both' : v === 'x' ? 'left-right' : v === 'y' ? 'top-bottom' : v;
        b.classList.toggle('on', m[c] === v);
        b.addEventListener('click', () => { m[c] = v; buildMods(); regen(); });
        seg.append(b);
      }
      card.append(seg);
    }
    if (m.shape === 'text') {
      const t = document.createElement('input'); t.type = 'text'; t.maxLength = 24; t.value = m.word || 'POSTER'; t.setAttribute('aria-label', 'Mask text');
      t.addEventListener('input', () => { m.word = t.value || 'A'; regen(); });
      card.append(t);
    }
    for (const k in K.params) {
      if (k === 'n' && m.kind !== 'kaleido') continue;
      if ((k === 'dot') !== (m.kind === 'dots') && m.type === 'dash' && (k === 'dot' || k === 'dash')) continue;
      if (m.type === 'warp' && m.kind === 'wave' && (k === 'cx' || k === 'cy')) continue;
      card.append(sliderRow(K.params[k], m[k], v => { m[k] = v; regen(); }));
    }
    box.append(card);
  });
}
function buildModAdd() {
  const box = $('modAdd');
  for (const t in MOD_KINDS) {
    const b = document.createElement('button'); b.textContent = MOD_KINDS[t].label;
    b.addEventListener('click', () => { if (st.mods.length >= 6) { toast('Six modifiers at most'); return; } st.mods.push(modDefaults(t)); buildMods(); regen(); });
    box.append(b);
  }
}

// ── randomise ──────────────────────────────────────────────────────────────
// A tasteful pick: params near their defaults (within 35% of the range),
// palettes from the list, and at most two mild modifiers.
function tasteParams(p, rng) {
  const P = {};
  for (const k in p.params) {
    const [a, b, step, d, label] = p.params[k];
    // A slot param ("Warp ink") keeps its default, so two parts do not
    // fall on the same ink.
    if (/\bink$/i.test(label)) { P[k] = d; continue; }
    if (step >= 1 && b - a === 1) { P[k] = rng.chance(0.75) ? d : 1 - d; continue; }
    P[k] = Math.max(a, Math.min(b, d + (b - a) * 0.35 * (rng.next() * 2 - 1)));
  }
  return clampParams(p, P);
}
// Mirror and dash read well on line patterns; on solid tiles a mirror
// cuts blocks at the wedge edge, so those families do not get it.
const LINE_FAMS = ['flow', 'radial', 'physics', 'distort'];
function tasteMods(rng, p) {
  const out = [], n = rng.weighted([0.6, 0.3, 0.1]);
  const pool = LINE_FAMS.includes(p.family) ? ['warp', 'warp', 'clip', 'mask', 'mirror', 'dash', 'jitter'] : ['warp', 'warp', 'clip', 'clip', 'mask', 'jitter'];
  for (let i = 0; i < n; i++) {
    const t = rng.pick(pool); if (out.some(m => m.type === t)) continue;
    // A mask keeps solids by their centre, so large bands (flow, organic)
    // can drop whole; and a mask then dots leaves too little.
    if (t === 'mask' && (['flow', 'organic'].includes(p.family) || out.some(m => m.type === 'dash'))) continue;
    if (t === 'dash' && out.some(m => m.type === 'mask')) continue;
    const m = modDefaults(t);
    if (t === 'warp') { m.kind = rng.pick(['lens', 'twirl', 'wave', 'noise']); m.amount = rng.range(0.25, 0.8) * (m.kind === 'lens' && rng.chance(0.3) ? -0.6 : 1); m.size = rng.range(0.35, 0.7); m.cx = rng.range(0.35, 0.65); m.cy = rng.range(0.35, 0.65); }
    if (t === 'clip') { m.shape = rng.pick(['rounded', 'circle', 'arch', 'arch', 'hex']); m.margin = rng.range(0.05, 0.12); }
    if (t === 'mask') { m.shape = rng.pick(['circle', 'arch', 'diamond']); m.margin = rng.range(0.08, 0.16); m.outline = rng.chance(0.5) ? 1 : 0; }
    if (t === 'mirror') { m.kind = rng.pick(['x', 'kaleido', 'kaleido']); m.n = rng.pick([4, 6, 8, 10]); }
    if (t === 'dash') { m.kind = rng.pick(['dash', 'dots']); m.dash = rng.range(8, 30); m.gap = rng.range(5, 16); }
    if (t === 'jitter') { m.amount = rng.range(0.1, 0.35); m.turn = rng.chance(0.4) ? rng.range(0.1, 0.4) : 0; }
    out.push(m);
  }
  return out;
}
function randomiseAll() {
  if (!st.lock) st.seed = newSeed();
  const rng = makeRng(newSeed(), 'taste'), p = rng.pick(PATTERNS);
  if (st.P && st.pat) memo[st.pat] = st.P;
  st.pat = p.id; st.P = tasteParams(p, rng);
  st.pal = rng.pick(PALETTES).id; st.custom = null;
  st.mode = rng.chance(0.82) ? 'auto' : rng.pick(['stroke', 'fill', 'knock']);
  st.lw = +(rng.range(1.2, 3.2)).toFixed(2);
  st.mods = tasteMods(rng, p);
  syncAll(); regen();
}
function shakeParams() { const p = pat(); st.P = tasteParams(p, makeRng(newSeed(), 'shake')); buildParams(); regen(); }

// ── explorer ───────────────────────────────────────────────────────────────
// Each card holds a live thumbnail: the pattern at its defaults, the
// current seed and palette, at 4:5. Thumbnails render when the card
// scrolls into view, one job at a time on the second worker.
const thumbs = new Map();    // id -> { items, clip, frame, W, H, seed }
let exFam = 'all', exQ = '', thumbQueue = [], thumbBusy = false, io = null;
function buildExplorer() {
  const fam = $('exFam'); fam.textContent = '';
  for (const f of [{ id: 'all', name: 'All' }].concat(FAMILIES)) {
    const b = document.createElement('button'); b.textContent = f.name; b.dataset.f = f.id; b.title = f.text || '';
    b.classList.toggle('on', f.id === exFam);
    b.addEventListener('click', () => { exFam = f.id; fam.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); filterExplorer(); });
    fam.append(b);
  }
  const grid = $('exGrid'); grid.textContent = '';
  io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) queueThumb(e.target.dataset.id); }), { root: grid, rootMargin: '200px' }) : null;
  for (const p of PATTERNS) {
    const b = document.createElement('button'); b.className = 'ex-card'; b.dataset.id = p.id;
    b.innerHTML = `<canvas width="10" height="10"></canvas><b></b><small></small>`;
    b.querySelector('b').textContent = p.name; b.querySelector('small').textContent = famName(p.family);
    b.title = p.blurb || '';
    b.addEventListener('click', () => { setPattern(p.id); closeExplorer(); });
    grid.append(b);
    if (io) io.observe(b); else queueThumb(p.id);
  }
  const empty = document.createElement('div'); empty.className = 'ex-empty'; empty.id = 'exEmpty'; empty.textContent = 'No pattern matches.'; empty.hidden = true;
  grid.append(empty);
  filterExplorer();
}
function filterExplorer() {
  const q = exQ.trim().toLowerCase(); let n = 0;
  document.querySelectorAll('.ex-card').forEach(c => {
    const p = byId(c.dataset.id), hit = (exFam === 'all' || p.family === exFam) && (!q || (p.name + ' ' + famName(p.family) + ' ' + (p.blurb || '')).toLowerCase().includes(q));
    c.hidden = !hit; if (hit) n++;
  });
  $('exEmpty').hidden = n > 0;
  $('exCount').textContent = `${n} of ${PATTERNS.length}`;
}
function queueThumb(id) {
  const t = thumbs.get(id);
  if (t && t.seed === st.seed) { drawThumb(id); return; }
  if (!thumbQueue.includes(id)) thumbQueue.push(id);
  pumpThumbs();
}
function pumpThumbs() {
  if (thumbBusy || !thumbQueue.length || $('explorer').hidden) return;
  const id = thumbQueue.shift(), p = byId(id), seed = st.seed;
  thumbBusy = true;
  thumbRunner.run({ pat: id, P: defaults(p), seed, W: 1000, H: 1250, mods: [] })
    .then(res => { thumbs.set(id, Object.assign(res, { W: 1000, H: 1250, seed })); drawThumb(id); })
    .catch(() => {})
    .finally(() => { thumbBusy = false; pumpThumbs(); });
}
function drawThumb(id) {
  const t = thumbs.get(id), card = document.querySelector(`.ex-card[data-id="${id}"]`); if (!t || !card) return;
  const c = card.querySelector('canvas'), r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(80, Math.round(r.width * dpr)), h = Math.round(w * 1.25);
  if (c.width !== w) { c.width = w; c.height = h; }
  const g = c.getContext('2d'), p = pal();
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = p.bg; g.fillRect(0, 0, w, h);
  g.setTransform(w / t.W, 0, 0, w / t.W, 0, 0);
  drawItems(g, t.items, { palette: p, lw: 2.2 });
}
function thumbsRepaint() { if (!$('explorer').hidden) for (const id of thumbs.keys()) drawThumb(id); }
function openExplorer() {
  $('explorer').hidden = false;
  document.querySelectorAll('.ex-card').forEach(c => c.classList.toggle('on', c.dataset.id === st.pat));
  // A new seed makes every cached thumbnail old: queue the visible ones again.
  thumbQueue = [];
  if (io) document.querySelectorAll('.ex-card').forEach(c => { io.unobserve(c); io.observe(c); });
  else PATTERNS.forEach(p => queueThumb(p.id));
  if (PHONE_Q.matches) setOpen(false);
  const on = document.querySelector('.ex-card.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'center' });
}
function closeExplorer() { $('explorer').hidden = true; thumbQueue = []; }

// ── exports ────────────────────────────────────────────────────────────────
function download(blob, name) {
  const u = URL.createObjectURL(blob), l = document.createElement('a');
  l.href = u; l.download = name; document.body.append(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function fileBase() { return `${st.pat}-${st.seed}`; }
function svgText() {
  if (!cur) return '';
  const d = dims(), p = pat();
  const desc = `Pattern Designer (davesgames.io). Pattern: ${p.name} (${famName(p.family)}). Seed ${st.seed}. Params ${JSON.stringify(st.P)}. Palette: ${pal().name}. Mode: ${st.mode}. Line weight ${st.lw}. Modifiers: ${st.mods.filter(m => !m.off).map(m => m.type + (m.kind ? ':' + m.kind : m.shape ? ':' + m.shape : '')).join(', ') || 'none'}. Board ${boardById(st.board).name} ${d.w} x ${d.h} ${d.unit}.`;
  return toSVG(applyMode(cur.items, st.mode), { W: cur.W, H: cur.H, palette: pal(), lw: st.lw, title: `${p.name} · Pattern Designer`, desc, size: { w: d.w, h: d.h, unit: d.unit }, clip: cur.clip, frame: cur.frame });
}
function exportSVG() { if (!cur) return; download(new Blob([svgText()], { type: 'image/svg+xml' }), fileBase() + '.svg'); toast('SVG saved'); }
function copySVG() {
  if (!cur) return;
  const txt = svgText();
  const done = () => toast('SVG copied'), fail = () => toast('The browser did not allow the copy');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fail);
  else fail();
}
// The PNG size: mm boards at st.dpi, px boards at st.dpi times. The area
// stays under the canvas limit (16.7 Mpx on a touch device, 64 Mpx else).
function pngSize() {
  const d = dims();
  let w = d.unit === 'mm' ? d.w / 25.4 * st.dpi : d.w * st.dpi, h = d.unit === 'mm' ? d.h / 25.4 * st.dpi : d.h * st.dpi;
  const max = COARSE ? 16.7e6 : 64e6, k = Math.min(1, Math.sqrt(max / (w * h)), 16384 / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k), cut: k < 1, dpi: d.unit === 'mm' ? st.dpi * k : 72 * st.dpi * k };
}
function exportPNG() {
  if (!cur) return;
  const s = pngSize(), c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const g = c.getContext('2d'), p = pal();
  g.fillStyle = p.bg; g.fillRect(0, 0, s.w, s.h);
  g.setTransform(s.w / cur.W, 0, 0, s.w / cur.W, 0, 0);
  drawItems(g, applyMode(cur.items, st.mode), { palette: p, lw: st.lw, clip: cur.clip, frame: cur.frame });
  c.toBlob(b => {
    if (!b) { toast('The browser could not make this PNG'); return; }
    b.arrayBuffer().then(buf => { download(new Blob([withDPI(new Uint8Array(buf), s.dpi)], { type: 'image/png' }), fileBase() + '.png'); toast(`PNG ${s.w} × ${s.h} saved`); });
  }, 'image/png');
}
// Put a pHYs chunk (pixels per metre) after IHDR, so print software reads
// the DPI.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function withDPI(png, dpi) {
  const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 8 + 25, out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + 21);
  return out;
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

// ── bind ───────────────────────────────────────────────────────────────────
function syncAll() {
  const p = pat();
  st.P = clampParams(p, st.P || defaults(p));
  $('seed').value = st.seed;
  $('seedLock').classList.toggle('on', st.lock); $('seedLock').setAttribute('aria-pressed', String(st.lock));
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
  $('lw').value = st.lw; $('lwV').textContent = (+st.lw).toFixed(2);
  buildParams(); patternLabels(); palLabels(); boardLabels(); buildMods(); layout();
  thumbsRepaint();
}
function bindUI() {
  $('prevPat').addEventListener('click', () => stepPattern(-1));
  $('nextPat').addEventListener('click', () => stepPattern(1));
  $('patName').addEventListener('click', openExplorer);
  $('seed').addEventListener('change', () => setSeed(+$('seed').value));
  $('seedNew').addEventListener('click', () => setSeed(newSeed()));
  $('seedLock').addEventListener('click', () => { st.lock = !st.lock; syncAll(); save(); });
  $('paramReset').addEventListener('click', () => { st.P = defaults(pat()); buildParams(); regen(); });
  $('paramShake').addEventListener('click', shakeParams);
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.m; syncAll(); save(); }));
  $('lw').addEventListener('input', () => { st.lw = +$('lw').value; $('lwV').textContent = st.lw.toFixed(2); paint(); save(); });
  $('landBtn').addEventListener('click', () => { st.land = !st.land; boardLabels(); layout(); regen(); });
  $('dpi').addEventListener('change', () => { st.dpi = +$('dpi').value; exportInfo(); save(); });
  $('svgBtn').addEventListener('click', exportSVG);
  $('copyBtn').addEventListener('click', copySVG);
  $('pngBtn').addEventListener('click', exportPNG);
  $('exploreBtn').addEventListener('click', openExplorer);
  $('randBtn').addEventListener('click', randomiseAll);
  $('exClose').addEventListener('click', closeExplorer);
  $('exSearch').addEventListener('input', () => { exQ = $('exSearch').value; filterExplorer(); });
  $('dockBook').addEventListener('click', () => $('explorer').hidden ? openExplorer() : closeExplorer());
  $('dockName').addEventListener('click', () => stepPattern(1));
  $('dockRand').addEventListener('click', randomiseAll);
  $('dockPal').addEventListener('click', () => stepPalette(1));
  addEventListener('keydown', e => {
    if (saverOn || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape' && !$('explorer').hidden) closeExplorer();
    else if (e.key === 'r' || e.key === 'R') randomiseAll();
    else if (e.key === 'e' || e.key === 'E') $('explorer').hidden ? openExplorer() : closeExplorer();
    else if (e.key === 's' || e.key === 'S') setSeed(newSeed());
    else if (e.key === 'ArrowRight') stepPattern(1);
    else if (e.key === 'ArrowLeft') stepPattern(-1);
    else if (e.key === 'p' || e.key === 'P') stepPalette(1);
  });
}

// ── boot ───────────────────────────────────────────────────────────────────
load();
bindUI(); bindPanel(); buildPalettes(); buildBoards(); buildModAdd(); buildExplorer();
if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
syncAll();
addEventListener('resize', layout);
regen();
if (document.fonts) document.fonts.ready.then(() => { textCache.clear(); if (st.mods.some(m => m.shape === 'text')) regen(); });

// The saver tour and the test handle.
installSaver({
  runner: mainRunner,
  enter() { saverOn = true; },
  exit() { saverOn = false; layout(); regen(); },
});
window.__pd = {
  st, PATTERNS, get cur() { return cur; }, setPattern, exportSVG, exportPNG, pngSize, syncAll, randomiseAll, openExplorer, closeExplorer, svgText, regen, layout, setOpen,
  get ready() { return !!cur && !busy && !pending; },
};

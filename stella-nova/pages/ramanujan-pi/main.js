// ============================================================================
//  RAMANUJAN–SATO SERIES  ·  main.js — state, panel, views, play, hover
// ----------------------------------------------------------------------------
//  One canvas (#cv) shows one of four views. The data of each view comes
//  from worker.js (engine.js off the main thread) and is cached by its
//  key. The compute view has its own worker, so Stop can end it at once.
//
//    race      correct digits after each term, ten series     (drawRace)
//    digits    the decimals of pi fixed term by term          (drawStream)
//    anatomy   the factors of one term on a log axis          (drawAnatomy)
//    compute   pi to 1k..1M decimals by binary splitting      (drawCompute)
//
//  Play animates the view: the race lines draw in, the terms of the
//  digits view add one by one, the anatomy steps k up.
//
//  GREP MAP
//    grep -n 'function layout'        stage size and the clear area
//    grep -n 'function draw'          paint the view
//    grep -n 'function load'          ask the worker for the data
//    grep -n 'function selectSeries'  series list, formula, info
//    grep -n 'function setView'       tabs and the control groups
//    grep -n 'function hover'         tooltips and scrubbing
//    grep -n 'function compute'       the big run and its progress
//    grep -n 'function tick'          the play loop
// ============================================================================
import { SERIES, byId } from './engine.js';
import { drawRace, drawStream, drawAnatomy, drawCompute, SERIES_COLOR, fmtInt, INK } from './charts.js';
import { typeset, typesetAll } from '../../lib/sci-math.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const RS = SERIES.filter(s => s.kind === 'rs');
const NAMES = Object.fromEntries(SERIES.map(s => [s.id, s.name]));
const SHORT = Object.fromEntries(SERIES.map(s => [s.id, s.id === 'l2a' ? 'Ramanujan' : s.name.replace('Level ', '')]));
const ANAT_K = { l1a: 30, l2a: 40, l3a: 40, l4a: 60, l5a: 40, l6a: 40, l7a: 40, l10a: 40 };

const st = {
  view: 'race', sid: 'l1a', raceT: 40, digitsD: 300, k: 1, ak: 3,
  playing: false, playT0: 0, playFrom: 0, flashAt: 0,
  race: {}, stream: {}, anat: {}, comp: null, compS: 'l1a', compD: 10000, computing: false,
  hoverK: null, saver: false,
};

// ── worker jobs ──────────────────────────────────────────────────────────────
function makeRunner() {
  let w = null, seq = 0;
  const wait = new Map();
  function worker() {
    if (w) return w;
    w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => {
      const { id, res, error, progress } = e.data, j = wait.get(id);
      if (!j) return;
      if (progress) { if (j.onProgress) j.onProgress(progress); return; }
      wait.delete(id);
      if (error) j.reject(new Error(error)); else j.resolve(res);
    };
    w.onerror = e => { for (const j of wait.values()) j.reject(new Error(e.message || 'worker error')); wait.clear(); };
    return w;
  }
  return {
    run(op, args = {}, onProgress = null) {
      const id = ++seq;
      return new Promise((resolve, reject) => { wait.set(id, { resolve, reject, onProgress }); worker().postMessage({ id, op, ...args }); });
    },
    stop() { if (w) w.terminate(); w = null; for (const j of wait.values()) j.reject(new Error('stopped')); wait.clear(); },
  };
}
const runner = makeRunner(), computeRunner = makeRunner();

// ── data ─────────────────────────────────────────────────────────────────────
const keyOf = () => st.view === 'race' ? `race:${st.raceT}` : st.view === 'digits' ? `${st.sid}:${st.digitsD}` : st.view === 'anatomy' ? st.sid : '';
const data = () => st.view === 'race' ? st.race[st.raceT] : st.view === 'digits' ? st.stream[`${st.sid}:${st.digitsD}`] : st.view === 'anatomy' ? st.anat[st.sid] : st.comp;
const pending = new Map();
// The data of a view, from the cache or a new worker job. A second call
// for a job in flight gets the same promise.
export function load(view = st.view, sid = st.sid, opts = {}) {
  const T = opts.T || st.raceT, D = opts.D || st.digitsD;
  const key = view === 'race' ? `race:${T}` : view === 'digits' ? `${sid}:${D}` : view === 'anatomy' ? sid : '';
  if (!key) return Promise.resolve(null);
  const cache = view === 'race' ? st.race : view === 'digits' ? st.stream : st.anat, ck = view === 'race' ? T : key;
  if (cache[ck]) return Promise.resolve(cache[ck]);
  if (pending.has(key)) return pending.get(key);
  if (view === 'anatomy' && byId(sid).kind !== 'rs') return Promise.resolve(null);
  const job = (view === 'race' ? runner.run('race', { T, cap: 3000 })
    : view === 'digits' ? runner.run('stream', { sid, D, max: sid === 'leibniz' ? 2000 : 4000 })
    : runner.run('anatomy', { sid, K: ANAT_K[sid] || 40 }).then(r => r.rows))
    .then(res => { cache[ck] = res; return res; })
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
async function ensure() {
  const k = keyOf();
  if (!k || data()) { draw(); return; }
  draw();
  try { await load(); } catch (e) { toast('The worker failed: ' + e.message); }
  if (st.view === 'digits') { const s = data(); if (s) st.k = Math.min(st.k, s.K); }
  syncSliders();
  draw();
}

// ── layout ───────────────────────────────────────────────────────────────────
// The stage keeps clear of the panel: the left column on a desktop, the
// sheet in phone portrait (when it leaves room), the drawer in landscape.
function layout() {
  if (st.saver) return;
  const stage = $('stage'), panel = $('panel'), open = panel.classList.contains('open');
  stage.style.bottom = ''; stage.style.right = '';
  if (open && LAND_Q.matches) stage.style.right = panel.offsetWidth + 'px';
  else if (open && PHONE_Q.matches) {
    const top = panel.getBoundingClientRect().top, sTop = stage.getBoundingClientRect().top;
    if (top - sTop > 260) stage.style.bottom = (innerHeight - top) + 'px';
  }
  fitEq(); sizeCanvas(); draw();
}
// Shrink the formula bar until the formula fits its width (MathJax SVG
// sizes follow the font size).
function fitEq() {
  const el = $('eqbar'), svg = el.querySelector('svg');
  el.style.fontSize = '';
  if (!svg) return;
  const base = parseFloat(getComputedStyle(el).fontSize), w = svg.getBoundingClientRect().width, cw = el.clientWidth - 4;
  if (w > cw && cw > 0) el.style.fontSize = Math.max(8, base * cw / w) + 'px';
}
function sizeCanvas() {
  const c = $('cv'), r = $('plot').getBoundingClientRect(), dpr = Math.min(3, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w: r.width, h: r.height, dpr };
}

// ── drawing ──────────────────────────────────────────────────────────────────
let lay = null;
export function draw() {
  if (st.saver) return;
  const c = $('cv'), { w, h, dpr } = sizeCanvas(), g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = { x: 0, y: 0, w, h }, d = data(), now = performance.now();
  lay = null;
  if (!d && st.view !== 'compute') {
    const msg = st.view === 'anatomy' && byId(st.sid).kind !== 'rs' ? `${byId(st.sid).name} has no sequence s(k): pick a Ramanujan–Sato series.` : 'Summing…';
    g.font = `14px Inter, system-ui, sans-serif`; g.fillStyle = INK.dim; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(msg, w / 2, h / 2);
    caption('');
    return;
  }
  if (st.view === 'race') {
    const reveal = st.playing ? playValue() : st.raceT;
    lay = drawRace(g, r, d, { T: st.raceT, sel: st.sid, reveal, names: NAMES, short: SHORT, compact: w < 560 });
    if (st.hoverK) crosshair(g, lay, st.hoverK);
    const s = d.find(q => q.id === st.sid), n = Math.min(s.digits.length, Math.max(1, Math.floor(reveal)));
    caption(`${byId(st.sid).name}: <span class="n">${fmtInt(s.digits[n - 1])}</span> correct digits after <span class="n">${n}</span> ${n === 1 ? 'term' : 'terms'}` + (s.digits.length < st.raceT && n === s.digits.length ? ' (the chart stops at the dot)' : ''));
  } else if (st.view === 'digits') {
    const k = st.playing ? Math.floor(playValue()) : st.k;
    const flash = Math.max(0, 1 - (now - st.flashAt) / 700);
    lay = drawStream(g, r, d, { k, flash });
    const locked = lay.locked;
    caption(`After <span class="n">${k}</span> of <span class="n">${d.K}</span> terms: <span class="n">${locked}</span> of <span class="n">${d.D}</span> decimals fixed`);
  } else if (st.view === 'anatomy') {
    const S = byId(st.sid), k = st.playing ? Math.floor(playValue()) : st.ak;
    lay = drawAnatomy(g, r, d, { k, rate: S.rate, compact: w < 560 });
    const a = d[Math.min(k, d.length - 1)];
    caption(`Term <i>k</i> = <span class="n">${k}</span>: <i>s</i>(<i>k</i>) has <span class="n">${a.sLen}</span> digits, <i>C</i><sup><i>k</i></sup> has <span class="n">${a.cLen}</span>; the term is about 10<sup>${a.lt.toFixed(1)}</sup>`);
  } else {
    lay = drawCompute(g, r, st.comp, { compact: w < 620, walkN: 200000 });
    if (st.comp) {
      const c2 = st.comp, n = fmtInt(c2.D);
      caption(`π to <span class="n">${n}</span> decimals by ${byId(c2.sid).name} in <span class="n">${fmtInt(c2.ms)}</span> ms · first <span class="n">${fmtInt(c2.checked)}</span> ${c2.matches ? 'match' : 'do NOT match'} the stored reference`);
    } else caption('');
  }
}
function crosshair(g, L, k) {
  const x = Math.round(L.X(k)) + 0.5;
  g.strokeStyle = 'rgba(230,235,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, L.Tp); g.lineTo(x, L.B); g.stroke();
}
function caption(html) { const c = $('caption'); if (c.innerHTML !== html) c.innerHTML = html; }

// ── play ─────────────────────────────────────────────────────────────────────
// playValue: the race reveal (terms), the digits k, or the anatomy k.
function playSpan() {
  const d = data();
  if (st.view === 'race') return { from: 0, to: st.raceT, ms: 4500 };
  if (st.view === 'digits' && d) return { from: 0, to: d.K, ms: Math.max(3000, Math.min(12000, d.K * 260)) };
  if (st.view === 'anatomy' && d) return { from: 0, to: d.length - 1, ms: (d.length - 1) * 380 };
  return null;
}
function playValue() {
  const p = playSpan(); if (!p) return 0;
  const t = Math.min(1, (performance.now() - st.playT0) / p.ms);
  return p.from + (p.to - p.from) * t;
}
function setPlaying(on) {
  if (on && st.view === 'compute') { compute(); return; }
  // Play before the data is in: wait for it, then start.
  if (on && !playSpan() && keyOf()) { load().then(() => { if (!st.playing) setPlaying(true); }).catch(() => {}); return; }
  st.playing = on && !!playSpan();
  if (st.playing) { st.playT0 = performance.now(); st.lastK = -1; requestAnimationFrame(tick); }
  for (const b of [$('playBtn'), $('dockPlay')]) {
    b.classList.toggle('on', st.playing);
    b.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    b.querySelector('svg').innerHTML = st.playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5l11 7-11 7z"/>';
  }
  const sp = $('playBtn').querySelector('span'); if (sp) sp.textContent = st.playing ? 'Pause' : 'Play';
  if (!st.playing) draw();
}
function tick() {
  if (!st.playing || st.saver) return;
  const p = playSpan(), v = playValue();
  if (st.view === 'digits' || st.view === 'anatomy') {
    const k = Math.floor(v);
    if (k !== st.lastK) { st.lastK = k; st.flashAt = performance.now(); if (st.view === 'digits') st.k = k; else st.ak = k; syncSliders(); }
  }
  draw();
  if (!p || v >= p.to) {
    setPlaying(false);
    if (st.view === 'race') draw();
    return;
  }
  requestAnimationFrame(tick);
}

// ── series, views, controls ─────────────────────────────────────────────────────
function buildList() {
  const L = $('seriesList');
  for (const S of SERIES) {
    const b = document.createElement('button'), col = SERIES_COLOR[S.id];
    b.dataset.id = S.id; b.setAttribute('role', 'option');
    b.innerHTML = `<i class="sw${col.dash ? ' dash' : ''}" style="border-top-color:${col.c}"></i>` +
      `<span class="nm"><b>${S.name}</b>${S.level && !S.name.startsWith('Level') ? `<small>level ${S.level}</small>` : ''}</span>` +
      `<span class="rt">${S.id === 'leibniz' ? '→ 0' : S.rate.toFixed(2)}</span>`;
    b.addEventListener('click', () => selectSeries(S.id));
    L.append(b);
  }
}
export function selectSeries(id) {
  st.sid = id;
  const S = byId(id);
  document.querySelectorAll('#seriesList button').forEach(b => { b.classList.toggle('on', b.dataset.id === id); b.setAttribute('aria-selected', String(b.dataset.id === id)); });
  $('dockTitle').textContent = S.name;
  $('sWho').textContent = S.who + (S.level ? ` · level ${S.level}` : '');
  $('sNote').textContent = S.note || '';
  if (S.seqTex) typeset($('sSeq'), S.seqTex); else { $('sSeq').textContent = ''; delete $('sSeq').dataset.tex; }
  typeset($('eqbar'), S.tex).then(fitEq);
  if (st.playing && st.view !== 'race') setPlaying(false);
  if (st.view === 'digits') st.k = 1;
  syncSliders();
  ensure();
}
function setView(v) {
  if (st.playing) setPlaying(false);
  st.view = v; st.hoverK = null; tipOff();
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-selected', String(b.dataset.v === v)); });
  for (const [id, name] of [['ctlRace', 'race'], ['ctlDigits', 'digits'], ['ctlAnatomy', 'anatomy'], ['ctlCompute', 'compute']]) $(id).hidden = name !== v;
  $('ctlLabel').textContent = { race: 'Race', digits: 'Digits', anatomy: 'Anatomy of a term', compute: 'Compute' }[v];
  $('playBtn').querySelector('span').textContent = v === 'compute' ? 'Compute' : 'Play';
  syncSliders();
  ensure();
}
function syncSliders() {
  const d = st.stream[`${st.sid}:${st.digitsD}`];
  const ks = $('kSlider');
  ks.max = d ? d.K : 10; ks.value = st.k; $('kVal').textContent = d ? `${st.k} of ${d.K}` : String(st.k);
  const a = st.anat[st.sid], as = $('aSlider'), K = ANAT_K[st.sid] || 40;
  as.max = a ? a.length - 1 : K; st.ak = Math.min(st.ak, +as.max); as.value = st.ak; $('aVal').textContent = String(st.ak);
}
function seg(id, on) {
  const box = $(id);
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    on(b.dataset.v);
  }));
}

// ── compute ─────────────────────────────────────────────────────────────────
async function compute() {
  if (st.computing) return;
  st.computing = true;
  const D = st.compD, sid = st.compS, S = byId(sid);
  $('compBtn').disabled = true; $('compStop').hidden = false; $('compSave').disabled = true;
  $('compBar').style.width = '0%';
  $('compInfo').textContent = `Summing ${fmtInt(Math.ceil(D / S.rate) + 2)} terms of ${S.name} by binary splitting…`;
  const t0 = performance.now();
  try {
    const res = await computeRunner.run('compute', { sid, D }, p => {
      const f = p.stage === 'series' ? 0.75 * p.f : p.stage === 'root' ? 0.8 : 0.9;
      $('compBar').style.width = (100 * f).toFixed(1) + '%';
      if (p.stage !== 'series') $('compInfo').textContent = p.stage === 'root' ? 'Square root and the one big division…' : 'Writing the decimals…';
    });
    st.comp = res;
    $('compBar').style.width = '100%';
    $('compInfo').textContent = `${fmtInt(D)} decimals in ${fmtInt(res.ms)} ms (${fmtInt(performance.now() - t0)} ms with the copy). Last ten: ${res.digits.slice(-10)}.`;
    $('compSave').disabled = false;
  } catch (e) {
    $('compInfo').textContent = e.message === 'stopped' ? 'Stopped.' : 'Failed: ' + e.message;
    $('compBar').style.width = '0%';
  }
  st.computing = false; $('compBtn').disabled = false; $('compStop').hidden = true;
  draw();
}
function saveDigits() {
  if (!st.comp) return;
  const d = st.comp.digits, body = '3.' + d.slice(1).replace(/(.{100})/g, '$1\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body + '\n'], { type: 'text/plain' }));
  a.download = `pi-${st.comp.D}-${st.comp.sid}.txt`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── hover ───────────────────────────────────────────────────────────────────
function hover(e, scrub) {
  if (!lay) return tipOff();
  const r = $('cv').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = data();
  if (st.view === 'race' && lay.kAt) {
    if (x < lay.L - 10 || x > lay.R + 4 || y < lay.Tp - 10 || y > lay.B + 10) { st.hoverK = null; draw(); return tipOff(); }
    const k = lay.kAt(x); st.hoverK = k; draw();
    const rows = d.map(s => ({ id: s.id, v: s.digits[Math.min(k, s.digits.length) - 1], cut: k > s.digits.length })).sort((a, b) => b.v - a.v);
    tip(`<b>After ${k} ${k === 1 ? 'term' : 'terms'}</b><br>` + rows.map(q => `<i class="sw" style="background:${SERIES_COLOR[q.id].c}"></i>${NAMES[q.id]} <span class="n">${fmtInt(q.v)}${q.cut ? '+' : ''}</span>`).join('<br>'), x, y);
  } else if (st.view === 'digits' && lay.hit) {
    const p = lay.hit(x, y);
    if (p < 0) return tipOff();
    const t = d.lock[p];
    tip(`Decimal <span class="n">${p + 1}</span> = <b>${d.ref[p + 1]}</b><br>` + (t ? `fixed by term <span class="n">${t}</span>` : `not fixed after ${d.K} terms`), x, y);
  } else if (st.view === 'anatomy' && lay.kAt && y > lay.P.T - 20) {
    const k = lay.kAt(x), a = d[k];
    if (scrub) { st.ak = k; syncSliders(); draw(); }
    tip(`Term <i>k</i> = <span class="n">${k}</span><br>size <span class="n">${a.neg ? '−' : '+'}10<sup>${a.lt.toFixed(2)}</sup></span>`, x, y);
  } else tipOff();
}
function tip(html, x, y) {
  const t = $('tip'), pr = $('plot').getBoundingClientRect();
  t.innerHTML = html; t.classList.add('on');
  const tw = t.offsetWidth, th = t.offsetHeight;
  let lx = x + 16, ly = y + 14;
  if (lx + tw > pr.width - 4) lx = x - tw - 16;
  if (ly + th > pr.height - 4) ly = Math.max(4, y - th - 14);
  t.style.transform = `translate(${Math.round(Math.max(4, lx))}px,${Math.round(ly)}px)`;
}
function tipOff() { $('tip').classList.remove('on'); }

// ── panel ───────────────────────────────────────────────────────────────────
function setOpen(open) {
  const panel = $('panel');
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  layout();
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600);
}

function bind() {
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
  $('playBtn').addEventListener('click', () => setPlaying(!st.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!st.playing));
  $('dockName').addEventListener('click', () => { const i = SERIES.findIndex(s => s.id === st.sid); selectSeries(SERIES[(i + 1) % SERIES.length].id); });
  seg('raceT', v => { st.raceT = +v; if (st.playing) setPlaying(false); ensure(); });
  seg('digitsD', v => { st.digitsD = +v; st.k = 1; if (st.playing) setPlaying(false); syncSliders(); ensure(); });
  seg('compS', v => { st.compS = v; });
  seg('compD', v => { st.compD = +v; });
  $('kSlider').addEventListener('input', () => { if (st.playing) setPlaying(false); st.k = +$('kSlider').value; st.flashAt = performance.now(); syncSliders(); draw(); requestAnimationFrame(flashLoop); });
  $('aSlider').addEventListener('input', () => { if (st.playing) setPlaying(false); st.ak = +$('aSlider').value; syncSliders(); draw(); });
  $('compBtn').addEventListener('click', compute);
  $('compStop').addEventListener('click', () => computeRunner.stop());
  $('compSave').addEventListener('click', saveDigits);
  const cv = $('cv');
  let down = false;
  cv.addEventListener('pointermove', e => hover(e, down));
  cv.addEventListener('pointerdown', e => { down = true; hover(e, true); });
  addEventListener('pointerup', () => { down = false; });
  cv.addEventListener('pointerleave', () => { st.hoverK = null; tipOff(); if (st.view === 'race') draw(); });
  // panel
  const panel = $('panel'), toggle = () => setOpen(!panel.classList.contains('open'));
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
  addEventListener('resize', layout);
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, button, select, a')) return;
    if (e.key === ' ' && !e.metaKey) { e.preventDefault(); setPlaying(!st.playing); }
    else if (e.key >= '1' && e.key <= '4') setView(['race', 'digits', 'anatomy', 'compute'][+e.key - 1]);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dlt = e.key === 'ArrowRight' ? 1 : -1;
      if (st.view === 'digits') { const d = data(); if (d) { st.k = Math.max(0, Math.min(d.K, st.k + dlt)); st.flashAt = performance.now(); requestAnimationFrame(flashLoop); } }
      else if (st.view === 'anatomy') { const d = data(); if (d) st.ak = Math.max(0, Math.min(d.length - 1, st.ak + dlt)); }
      syncSliders(); draw();
    }
  });
}
// A short fade of the new block after a manual step.
function flashLoop() { if (st.playing || st.saver) return; draw(); if (performance.now() - st.flashAt < 720) requestAnimationFrame(flashLoop); }

// ── start ───────────────────────────────────────────────────────────────────
buildList();
bind();
if (PHONE_Q.matches) { $('panel').classList.remove('open'); document.body.classList.add('panel-closed'); }
typesetAll($('panel'));
selectSeries('l1a');
setView('race');
layout();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw());
// Warm the caches of the other views, one at a time.
load('race').then(() => load('digits')).then(() => load('anatomy')).catch(() => { /* drawn on demand */ });

// For the screensaver and for CDP checks.
const app = { st, runner, load, draw, layout, NAMES, SHORT, RS };
installSaver(app);
window.__rpi = { st, ready: () => !!st.race[st.raceT] && !!$('eqbar').querySelector('svg'), app };

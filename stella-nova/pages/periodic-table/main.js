// ============================================================================
//  PERIODIC TABLE  ·  main.js — the page: state, controls, pointer, cards
// ----------------------------------------------------------------------------
//  One state object S (render.js reads it) and one Table renderer on
//  canvas#table. Everything the user does changes S or starts a morph:
//    view tabs        setView(id): the elements fly to the new layout
//    colour modes     S.color, S.prop, S.cmap (ct-lab colour map picker)
//    temperature      S.temp with S.phaseOn: tiles melt, boil, flash
//    discovery year   the timeline view's year (play scrubs it)
//    scatter axes     the scatter view's X and Y properties
//    filters, find    S.match: the other elements dim
//    hover            #card next to the square, with the live atom
//    click            #inspect pins the element: everything, plus compare
//    drag, wheel      pan and zoom; on the 3D tower, drag turns it
//  The state goes into the URL hash, so a link opens the same view.
//  saver.js drives the same S and Table for the screensaver.
//
//  GREP MAP
//    grep -n "function setView"     start a morph
//    grep -n "function frame"       the draw loop
//    grep -n "function showCard"    the hover card
//    grep -n "function pin"         the inspect panel
//    grep -n "function applyMatch"  filters and find
//    grep -n "function bindPointer" hover, drag, wheel, pinch
//    grep -n "function writeHash"   the share link
//    grep -n "window.__pt"          what saver.js uses
// ============================================================================
import { ELEMENTS, CATS, BLOCKS, PROPS, PROP, BY_SYM, CAT } from './chem.js';
import { VIEWS, VIEW } from './layouts.js';
import { Table } from './render.js';
import { drawAtom } from './atom.js';
import { cardHTML, compareHTML, drawIE, drawRadius } from './card.js';
import { createPicker } from '../ct-lab/colormaps/picker.js';
import './saver.js';

const $ = id => document.getElementById(id);
const N = ELEMENTS.length;
const PHONE_Q = matchMedia('(max-width:760px), (max-height:520px) and (pointer:coarse)');
const phone = () => PHONE_Q.matches;
const now = () => performance.now() / 1000;

const S = {
  view: 'standard', color: 'cat', prop: 'en', cmap: 'magma', temp: 298, phaseOn: false,
  hover: -1, pin: -1, match: null, frame: null, leader: null, closeup: null,
  year: 2030, x: 'radius', y: 'ie1', source: 'crust',
  cats: new Set(CATS.map(c => c.id)), blocks: new Set(BLOCKS.map(b => b.id)), query: '', cmpWith: -1,
};
const T = new Table();
const canvas = $('table');
const g = canvas.getContext('2d');
let W = 1, H = 1, DPR = 1;
let saverOn = false;

// ── views ───────────────────────────────────────────────────────────────────
function viewOpts(id = S.view) {
  if (id === 'tower' || id === 'heat') return { prop: S.prop };
  if (id === 'timeline') return { year: S.year };
  if (id === 'abundance') return { source: S.source };
  if (id === 'scatter') return { x: S.x, y: S.y };
  return {};
}
function setView(id, { keepColor = false, instant = false } = {}) {
  if (!VIEW[id]) id = 'standard';
  S.view = id;
  if (!keepColor && !S.phaseOn) S.color = VIEW[id].color;
  if ((id === 'tower' || id === 'heat') && !S.phaseOn) S.color = 'prop';
  T.user.zoom = 1; T.user.px = 0; T.user.py = 0;
  T.setView(id, viewOpts(id), now(), instant);
  syncUI();
  writeHash();
}
function refreshView() { T.update(viewOpts(), now()); writeHash(); }

// ── controls ────────────────────────────────────────────────────────────────
const tabs = document.querySelector('.vtabs');
for (const v of VIEWS) {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.view = v.id; b.textContent = v.name; b.title = v.hint;
  b.onclick = () => setView(v.id);
  tabs.appendChild(b);
}
const numeric = PROPS.filter(p => p.id !== 'halflife' && p.id !== 'isotopes');
for (const sel of [$('prop'), $('axX'), $('axY')]) for (const p of numeric) {
  const o = document.createElement('option'); o.value = p.id; o.textContent = p.name + (p.unit ? ` (${p.unit})` : ''); sel.appendChild(o);
}
$('prop').onchange = () => { S.prop = $('prop').value; if (S.color !== 'prop' && !S.phaseOn) S.color = 'prop'; if (S.view === 'tower' || S.view === 'heat') refreshView(); syncUI(); writeHash(); };
$('axX').onchange = () => { S.x = $('axX').value; if (S.view === 'scatter') refreshView(); };
$('axY').onchange = () => { S.y = $('axY').value; if (S.view === 'scatter') refreshView(); };
document.querySelectorAll('#colorSeg button').forEach(b => b.onclick = () => {
  S.color = b.dataset.color; S.phaseOn = S.color === 'phase';
  syncUI(); writeHash();
});
document.querySelectorAll('#abSeg button').forEach(b => b.onclick = () => { S.source = b.dataset.source; if (S.view !== 'abundance') setView('abundance'); else refreshView(); syncUI(); });

const picker = createPicker($('cmapHost'), { value: S.cmap, compact: true, groups: ['perceptual', 'artistic', 'medical', 'grey'] });
picker.addEventListener('change', e => { S.cmap = e.detail.id; if (S.color !== 'prop' && !S.phaseOn) S.color = 'prop'; syncUI(); writeHash(); });

// Temperature: the slider is quadratic in K, so the low end (where the
// gases condense) gets room: 0..1000 -> 0..6000 K.
const tempK = v => Math.round(6000 * (v / 1000) ** 2);
const tempV = k => Math.round(1000 * Math.sqrt(Math.max(0, k) / 6000));
function setTemp(k, { phase = true } = {}) {
  S.temp = Math.max(0, Math.min(6000, k));
  if (phase) { S.phaseOn = true; S.color = 'phase'; }
  $('temp').value = tempV(S.temp);
  $('tempOut').textContent = `${Math.round(S.temp).toLocaleString('en-US')} K · ${Math.round(S.temp - 273.15).toLocaleString('en-US')} °C`;
  syncSeg();
}
$('temp').oninput = () => setTemp(tempK(+$('temp').value));
$('temp').onchange = () => writeHash();
document.querySelector('[data-temp]').onclick = () => { setTemp(298); writeHash(); };
let sweep = null;
$('tempPlay').onclick = () => { if (sweep) { sweep = null; $('tempPlay').classList.remove('on'); return; } sweep = { t0: now(), from: 0, to: 6000, dur: 14 }; $('tempPlay').classList.add('on'); };

$('year').oninput = () => { S.year = +$('year').value; $('yearOut').textContent = S.year; if (S.view !== 'timeline') setView('timeline'); else refreshView(); };

// Filters: category and block chips, and the find box.
function chip(host, id, name, color, set) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'on'; b.style.setProperty('--c', color);
  b.innerHTML = `<i></i>${name}`;
  b.onclick = () => { if (set.has(id)) set.delete(id); else set.add(id); b.classList.toggle('on', set.has(id)); applyMatch(); };
  b.ondblclick = () => { set.clear(); set.add(id); host.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); applyMatch(); };
  host.appendChild(b);
}
CATS.forEach(c => chip($('catChips'), c.id, c.name, c.color, S.cats));
BLOCKS.forEach(c => chip($('blockChips'), c.id, c.name, c.color, S.blocks));
$('clearFilter').onclick = () => {
  CATS.forEach(c => S.cats.add(c.id)); BLOCKS.forEach(b => S.blocks.add(b.id)); S.query = ''; $('q').value = '';
  document.querySelectorAll('.chips button').forEach(b => b.classList.add('on')); applyMatch();
};
function findMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;
  if (/^\d+$/.test(q)) { const z = +q; return z >= 1 && z <= N ? [z - 1] : []; }
  const exact = ELEMENTS.findIndex(e => e.sym.toLowerCase() === q);
  const hits = ELEMENTS.map((e, i) => [e, i]).filter(([e]) => e.name.toLowerCase().includes(q) || e.sym.toLowerCase().startsWith(q) || CAT[e.cat].name.toLowerCase().includes(q)).map(x => x[1]);
  if (exact >= 0 && !hits.includes(exact)) hits.unshift(exact);
  return hits;
}
function applyMatch() {
  const q = findMatches(S.query);
  const all = S.cats.size === CATS.length && S.blocks.size === BLOCKS.length && !q;
  if (all) { S.match = null; return; }
  const keep = new Set();
  ELEMENTS.forEach((e, i) => { if (S.cats.has(e.cat) && S.blocks.has(e.block) && (!q || q.includes(i))) keep.add(i); });
  S.match = keep;
}
$('q').oninput = () => { S.query = $('q').value; applyMatch(); const q = findMatches(S.query); if (q && q.length === 1) showCard(q[0]); };
$('q').onkeydown = e => {
  if (e.key === 'Enter') { const q = findMatches(S.query); if (q && q.length) pin(q[0]); }
  if (e.key === 'Escape') { $('q').value = ''; S.query = ''; applyMatch(); $('q').blur(); }
};

// Compare
for (const e of ELEMENTS) { const o = document.createElement('option'); o.value = e.z - 1; o.textContent = `${e.z} ${e.sym} · ${e.name}`; $('cmpWith').appendChild(o); }
$('cmpWith').value = '';
$('cmpWith').onchange = () => { S.cmpWith = +$('cmpWith').value; if (S.pin >= 0) renderInspect(); };
$('cmpBtn').onclick = () => {
  if (S.cmpWith >= 0) { S.cmpWith = -1; renderInspect(); return; }
  const e = ELEMENTS[S.pin];
  // a sensible first partner: the next element down the group, else the next Z
  const below = ELEMENTS.findIndex(x => x.group && x.group === e.group && x.period === e.period + 1);
  S.cmpWith = below >= 0 ? below : (S.pin + 1) % N; $('cmpWith').value = S.cmpWith; renderInspect();
};

function syncSeg() {
  document.querySelectorAll('#colorSeg button').forEach(b => b.classList.toggle('on', b.dataset.color === (S.phaseOn ? 'phase' : S.color)));
}
function syncUI() {
  document.querySelectorAll('.vtabs button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  syncSeg();
  $('prop').value = S.prop; $('axX').value = S.x; $('axY').value = S.y;
  document.querySelectorAll('#abSeg button').forEach(b => b.classList.toggle('on', b.dataset.source === S.source));
  $('yearOut').textContent = S.year; $('year').value = S.year;
  $('yearRow').hidden = S.view !== 'timeline';
  $('axesRow').hidden = S.view !== 'scatter';
  $('abSeg').hidden = S.view !== 'abundance';
  $('play').hidden = S.view !== 'timeline';
  $('vhint').textContent = VIEW[S.view].hint + (S.view === 'tower' ? '' : ' · drag to pan, wheel or pinch to zoom');
  const picked = picker.value && picker.value.id;
  if (picked !== S.cmap) picker.set({ id: S.cmap }, { silent: true });
  setTemp(S.temp, { phase: false });
}

// Timeline play: the years run 1650 -> 2030.
let yearPlay = null;
$('playRange').min = 1650; $('playRange').max = 2030;
$('playRange').oninput = () => { S.year = +$('playRange').value; refreshView(); syncUI(); };
$('playBtn').onclick = () => { if (yearPlay) { yearPlay = null; $('playBtn').textContent = '▶'; return; } if (S.year >= 2030) S.year = 1650; yearPlay = { t0: now(), y0: S.year }; $('playBtn').textContent = '❚❚'; };

// ── hover card ──────────────────────────────────────────────────────────────
const cardEl = $('card');
const atomState = { e: null, mix: 0, want: 0, cv: null, ctx: null, ie: null };
function bindCanvases(root, e, live) {
  const col = CAT[e.cat].color;
  const fit = cv => { const r = cv.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d)); const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); return [c, r.width, r.height]; };
  const ie = root.querySelector('canvas[data-ie]'); if (ie) { const [c, w, h] = fit(ie); drawIE(c, e, w, h, col); }
  const rd = root.querySelector('canvas[data-radius]'); if (rd) { const [c, w, h] = fit(rd); drawRadius(c, e, w, h, col); }
  const at = root.querySelector('canvas[data-atom]');
  if (at && live) {
    const [c, w, h] = fit(at);
    live.e = e; live.cv = at; live.ctx = c; live.w = w; live.h = h;
    const tog = root.querySelector('[data-atomtog]');
    if (tog) tog.onclick = ev => { ev.stopPropagation(); live.want = live.want ? 0 : 1; };
  }
}
function showCard(i) {
  if (i === S.hover && !cardEl.hidden) return;
  S.hover = i;
  if (i < 0 || saverOn) { cardEl.hidden = true; S.leader = null; atomState.e = null; return; }
  if (i === S.pin && !$('inspect').hidden) { cardEl.hidden = true; S.leader = null; return; }
  const e = ELEMENTS[i];
  cardEl.innerHTML = cardHTML(e);
  cardEl.hidden = false; cardEl.classList.remove('show'); void cardEl.offsetWidth; cardEl.classList.add('show');
  atomState.want = atomState.e && atomState.want ? 1 : 0; atomState.mix = atomState.want;
  bindCanvases(cardEl, e, atomState);
  placeCard();
}
function placeCard() {
  if (cardEl.hidden || S.hover < 0) return;
  const p = T.pos[S.hover];
  const st = $('stage').getBoundingClientRect();
  const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
  let x, y;
  if (phone()) { x = (st.width - cw) / 2; y = 8; }
  else {
    const right = p.sx + p.ss / 2 + 18, left = p.sx - p.ss / 2 - 18 - cw;
    const insp = $('inspect').hidden ? 0 : $('inspect').offsetWidth + 20;
    x = right + cw < st.width - insp - 8 ? right : left;
    x = Math.max(8, Math.min(st.width - insp - cw - 8, x));
    y = Math.max(8, Math.min(st.height - ch - 8, p.sy - ch * 0.35));
  }
  cardEl.style.transform = `translate(${x}px,${y}px)`;
  S.leader = phone() ? null : { x: x < p.sx ? x + cw : x, y: Math.max(y + 24, Math.min(y + ch - 24, p.sy)) };
}

// ── inspect panel (pinned) ──────────────────────────────────────────────────
const inspState = { e: null, mix: 0, want: 0 };
function pin(i) {
  S.pin = i;
  if (i < 0) { $('inspect').hidden = true; document.body.classList.remove('insp'); inspState.e = null; writeHash(); return; }
  if (phone()) closeSheet();
  renderInspect();
  $('inspect').hidden = false; document.body.classList.add('insp');
  cardEl.hidden = true; S.leader = null;
  resize();
  writeHash();
}
function renderInspect() {
  const e = ELEMENTS[S.pin];
  const cmp = S.cmpWith >= 0 && S.cmpWith !== S.pin ? `<div class="card" style="--c:${CAT[e.cat].color};margin-top:10px"><h4 class="meta">Compare</h4>${compareHTML(e, ELEMENTS[S.cmpWith])}</div>` : '';
  $('inspBody').innerHTML = cardHTML(e, { full: true }) + cmp;
  $('cmpBtn').textContent = S.cmpWith >= 0 ? 'Close compare' : 'Compare';
  bindCanvases($('inspBody'), e, inspState);
}
$('inspClose').onclick = () => pin(-1);

// ── pointer ─────────────────────────────────────────────────────────────────
function bindPointer() {
  const pts = new Map();
  let drag = null, pinch0 = 0, zoom0 = 1, moved = 0;
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e)); moved = 0;
    if (pts.size === 1) drag = { p: local(e), yaw: T.rot.yaw, pitch: T.rot.pitch, px: T.user.px, py: T.user.py };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = T.user.zoom; }
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    if (pts.has(e.pointerId)) {
      pts.set(e.pointerId, p);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); T.user.zoom = Math.max(0.6, Math.min(5, zoom0 * d / Math.max(1, pinch0))); return; }
      if (drag) {
        const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        moved = Math.max(moved, Math.hypot(dx, dy));
        if (moved > 6) {
          if (S.view === 'tower') { T.rot.yaw = drag.yaw + dx * 0.006; T.rot.pitch = Math.max(0.2, Math.min(1.35, drag.pitch - dy * 0.005)); }
          else { T.user.px = drag.px + dx; T.user.py = drag.py + dy; }
          canvas.classList.add('grab');
          return;
        }
      }
    }
    if (e.pointerType === 'mouse') { const i = T.hit(p[0], p[1]); canvas.classList.toggle('over', i >= 0); showCard(i); }
  });
  const up = e => {
    const p = local(e);
    const tap = pts.has(e.pointerId) && moved <= 6 && pts.size === 1;
    pts.delete(e.pointerId); canvas.classList.remove('grab');
    if (!pts.size) drag = null;
    if (!tap) return;
    const i = T.hit(p[0], p[1]);
    if (e.pointerType !== 'mouse') {
      // touch: the first tap shows the card, a second tap on it pins
      if (i >= 0 && i === S.hover && !cardEl.hidden) pin(i); else showCard(i);
    } else if (i >= 0) pin(i);
    else if (S.pin >= 0) pin(-1);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', e => { pts.delete(e.pointerId); drag = null; });
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') showCard(-1); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); T.user.zoom = Math.max(0.6, Math.min(5, T.user.zoom * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });
  canvas.addEventListener('dblclick', () => { T.user.zoom = 1; T.user.px = 0; T.user.py = 0; });
}

// Keys: 1-9 and 0 views, arrows step the hovered element, Enter pins,
// Esc closes, "/" finds, T sweeps the temperature.
addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || saverOn) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) { const v = VIEWS[(+k + 9) % 10]; if (v) setView(v.id); return; }
  if (k === '/') { e.preventDefault(); $('q').focus(); return; }
  if (k === 'Escape') { if (S.pin >= 0) pin(-1); else showCard(-1); return; }
  if (k === 'Enter' && S.hover >= 0) { pin(S.hover); return; }
  if (k === 't' || k === 'T') { $('tempPlay').click(); return; }
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 18, ArrowUp: -18 }[k];
  if (step) {
    e.preventDefault();
    const cur = S.hover >= 0 ? S.hover : S.pin >= 0 ? S.pin : 0;
    let i = cur;
    if (Math.abs(step) === 1) i = (cur + step + N) % N;
    else {
      // up/down: the element in the same group one period away
      const el = ELEMENTS[cur], dir = Math.sign(step);
      const j = ELEMENTS.findIndex(x => x.group && x.group === el.group && x.period === el.period + dir);
      i = j >= 0 ? j : cur;
    }
    showCard(i);
  }
});

// ── phone sheets ────────────────────────────────────────────────────────────
function closeSheet() { $('panel').classList.remove('open'); document.querySelectorAll('#dock button').forEach(b => b.classList.remove('on')); }
document.querySelectorAll('#dock button').forEach(b => b.onclick = () => {
  const want = b.dataset.sheet;
  if (want === 'find') { closeSheet(); $('q').focus(); return; }
  const open = $('panel').classList.contains('open') && b.classList.contains('on');
  closeSheet();
  if (open) return;
  document.querySelectorAll('#panel section[data-pane]').forEach(s => s.classList.toggle('on', s.dataset.pane === want || (want === 'colour' && s.dataset.pane === 'compare')));
  $('panel').classList.add('open'); b.classList.add('on');
});
$('sheetGrip').onclick = closeSheet;

// ── hash ────────────────────────────────────────────────────────────────────
let hashTimer = 0;
function writeHash() {
  if (saverOn) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams();
    q.set('v', S.view);
    if (S.phaseOn) q.set('t', Math.round(S.temp)); else if (S.color !== VIEW[S.view].color) q.set('c', S.color);
    if (S.color === 'prop' || S.view === 'tower' || S.view === 'heat') { q.set('p', S.prop); q.set('m', S.cmap); }
    if (S.view === 'timeline') q.set('y', S.year);
    if (S.view === 'scatter') { q.set('x', S.x); q.set('yy', S.y); }
    if (S.view === 'abundance') q.set('s', S.source);
    if (S.pin >= 0) q.set('el', ELEMENTS[S.pin].sym);
    try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* sandboxed */ }
  }, 250);
}
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('p') && PROP[q.get('p')]) S.prop = q.get('p');
  if (q.get('m')) S.cmap = q.get('m');
  if (q.get('y')) S.year = Math.max(1650, Math.min(2030, +q.get('y') || 2030));
  if (q.get('x') && PROP[q.get('x')]) S.x = q.get('x');
  if (q.get('yy') && PROP[q.get('yy')]) S.y = q.get('yy');
  if (q.get('s')) S.source = q.get('s');
  setView(q.get('v') || 'standard', { instant: true });
  if (q.get('c')) S.color = q.get('c');
  if (q.get('t')) setTemp(+q.get('t'));
  const el = q.get('el') && BY_SYM[q.get('el').toLowerCase()];
  if (el) pin(el.z - 1);
  syncUI();
}

// ── frame ───────────────────────────────────────────────────────────────────
function resize() {
  const r = $('stage').getBoundingClientRect();
  DPR = Math.min(2, devicePixelRatio || 1);
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
}
// The part of the stage that the panels leave clear.
function clearFrame() {
  if (saverOn && S.frame) return S.frame;
  const pad = 14;
  let x0 = pad, x1 = W - pad, y0 = 40, y1 = H - pad;
  if (!phone()) {
    x0 = $('panel').offsetWidth + 24;
    if (!$('inspect').hidden) x1 = W - $('inspect').offsetWidth - 24;
  } else y0 = 30;
  if (!$('play').hidden) y1 -= 56;
  return { x: x0, y: y0, w: Math.max(80, x1 - x0), h: Math.max(80, y1 - y0) };
}
function hud() {
  const e = S.hover >= 0 ? ELEMENTS[S.hover] : S.pin >= 0 ? ELEMENTS[S.pin] : null;
  const m = S.match ? `${S.match.size} of ${N} shown` : `${N} elements`;
  $('hud').innerHTML = `<b>${VIEW[S.view].name}</b> · ${m}${e ? ` · <b>${e.sym}</b> ${e.name}` : ''}`;
}
let lastHud = 0;
function frame() {
  requestAnimationFrame(frame);
  const t = now();
  if (sweep) {
    const u = Math.min(1, (t - sweep.t0) / sweep.dur);
    setTemp(sweep.from + (sweep.to - sweep.from) * u * u);
    if (u >= 1) { sweep = null; $('tempPlay').classList.remove('on'); writeHash(); }
  }
  if (yearPlay) {
    S.year = Math.min(2030, Math.round(yearPlay.y0 + (t - yearPlay.t0) * 18));
    $('playRange').value = S.year; $('playOut').textContent = S.year; $('yearOut').textContent = S.year; $('year').value = S.year;
    T.update(viewOpts(), t);
    if (S.year >= 2030) { yearPlay = null; $('playBtn').textContent = '▶'; }
  }
  if (!saverOn) S.frame = clearFrame();
  T.draw(g, W, H, DPR, t, S);
  if (!saverOn) placeCard();
  for (const st of [atomState, inspState]) {
    if (!st.e || !st.ctx || !st.cv.isConnected) continue;
    st.mix += (st.want - st.mix) * 0.08;
    st.ctx.clearRect(0, 0, st.w, st.h);
    drawAtom(st.ctx, st.e, { x: 0, y: 0, w: st.w, h: st.h }, t, st.mix, { scale: 1, budget: phone() ? 1400 : 2600, labels: true });
  }
  if (t - lastHud > 0.2) { lastHud = t; hud(); $('playOut').textContent = S.year; $('playRange').value = S.year; }
}

window.__pt = { S, T, setView, refreshView, setTemp, showCard, pin, viewOpts, get canvas() { return canvas; }, resize,
  set saver(v) { saverOn = v; if (v) { showCard(-1); } }, get saver() { return saverOn; } };

addEventListener('resize', resize);
PHONE_Q.addEventListener('change', resize);
new ResizeObserver(resize).observe($('stage'));
resize();
bindPointer();
readHash();
requestAnimationFrame(frame);

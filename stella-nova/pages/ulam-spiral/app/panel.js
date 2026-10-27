// ============================================================================
//  ULAM SPIRAL  ·  app/panel.js — the control panel, the dock, the sheet
// ----------------------------------------------------------------------------
//  buildUI (once, from main.js) makes the shape gallery, the mode chips,
//  the quadratic inputs and presets, the drawing swatches and sliders, the
//  navigate and sieve controls, the dock, the sheet grip and the minimap
//  drag. The sync functions mark the active buttons after a change.
//
//  GREP MAP
//    grep -n 'export function setOpen'       open or close the panel
//    grep -n 'export function buildUI'       the panel
//    grep -n 'function segBind'              segmented, range, check bindings
//    grep -n 'export function syncModeUI'    mode chips, note, dock label
//    grep -n 'function renderLegend'         the colour legend of the mode
//    grep -n 'export function syncShapeUI'   gallery, shape note, parameters
//    grep -n 'function paramControl'         one control per shape parameter
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { $, PHONE_Q, toast } from './dom.js';
import { rgb, PALETTES, BGS, MODES, QUAD_PRESETS } from './palettes.js';
import { is3D } from './camera.js';
import { stopWalk } from './motion.js';
import { startSieve } from './numbers.js';
import { computeRays } from './overlay.js';
import { updateQuad, updateStatus } from './readout.js';
import { setShape, setMode, goHome, toggleWalk, gotoNumber } from './controls.js';
import { userMoved } from './input.js';
import { THUMB, thumbCtx } from './thumbs.js';

const M = T.MODE;
const panel = $('panel');
export function setOpen(o) {
  panel.classList.toggle('open', o); document.body.classList.toggle('panel-closed', !o);
  if (!o) panel.classList.remove('full');
  S.dirty = true;
}
// A row of buttons, one per entry of a table, each with a background.
function swatches(id, table, bg, pick) {
  for (const [k, p] of Object.entries(table)) {
    const b = document.createElement('button'); b.title = p.name; b.dataset.k = k;
    b.style.background = bg(p);
    b.addEventListener('click', () => { pick(k); S.dirty = true; rt.thumbsDirty = true; rt.miniAt = 0; syncSwatches(); });
    $(id).append(b);
  }
}
export function buildUI() {
  // gallery
  const gal = $('gallery');
  for (const sh of L.SHAPES) {
    const b = document.createElement('button');
    b.dataset.key = sh.key; b.title = sh.name; b.setAttribute('role', 'option');
    const c = document.createElement('canvas'); c.width = c.height = THUMB;
    thumbCtx[sh.key] = c.getContext('2d');
    b.append(c); const sp = document.createElement('span'); sp.textContent = sh.name; b.append(sp);
    b.addEventListener('click', () => { stopWalk(); setShape(sh); if (PHONE_Q.matches) panel.classList.remove('full'); });
    gal.append(b);
  }
  // modes
  const md = $('modes');
  for (const m of MODES) {
    const b = document.createElement('button'); b.textContent = m.name; b.dataset.id = m.id;
    b.addEventListener('click', () => setMode(m.id));
    md.append(b);
  }
  // quadratic
  const qin = () => {
    S.quad.a = Math.round(+$('qa').value || 0); S.quad.b = Math.round(+$('qb').value || 0); S.quad.c = Math.round(+$('qc').value || 0);
    S.quad.on = $('quadOn').checked; S.tile.have = null; updateQuad(); S.dirty = true; rt.thumbsDirty = true;
  };
  ['qa', 'qb', 'qc'].forEach(id => $(id).addEventListener('input', qin));
  $('quadOn').addEventListener('change', qin);
  for (const [a, b, c] of QUAD_PRESETS) {
    const bt = document.createElement('button'); bt.textContent = T.quadText(a, b, c);
    bt.addEventListener('click', () => {
      $('qa').value = a; $('qb').value = b; $('qc').value = c; $('quadOn').checked = true; qin();
      if (a === 1 && b === 1 && c === 41 && S.shape.key === 'square' && S.P.start !== 41) toast('Tip: set the start to 41 and the line runs through the centre');
    });
    $('quadPresets').append(bt);
  }
  // drawing
  segBind('styleSeg', () => S.style, v => { S.style = +v; S.dirty = true; rt.thumbsDirty = true; });
  swatches('palettes', PALETTES, p => `linear-gradient(90deg,${p.stops.slice(1).join(',')})`, k => { S.pal = k; renderLegend(); });
  swatches('bgs', BGS, p => `radial-gradient(${p.c[0]},${p.c[1]})`, k => { S.bg = k; });
  rangeBind('dotR', v => { S.dotR = v; }, v => v.toFixed(2));
  rangeBind('compA', v => { S.compA = v; }, v => v.toFixed(2));
  rangeBind('bloom', v => { S.bloom = v; }, v => v.toFixed(2));
  rangeBind('walkRate', v => { S.walkRate = v; if (S.walk) S.walk.rate = v; }, v => v.toFixed(2) + '×');
  checkBind('labelsOn', v => { S.labels = v; });
  checkBind('pathOn', v => { S.path = v; });
  checkBind('diagOn', v => { S.diag = v; if (v) computeRays(); });
  checkBind('miniOn', v => { S.mini = v; $('mini').classList.toggle('off', !v); });
  checkBind('morphOn', v => { S.morphOn = v; });
  $('gotoBtn').addEventListener('click', () => gotoNumber($('gotoN').value));
  $('gotoN').addEventListener('keydown', e => { if (e.key === 'Enter') gotoNumber($('gotoN').value); });
  $('walkBtn').addEventListener('click', toggleWalk);
  $('homeBtn').addEventListener('click', goHome);
  segBind('limitSeg', () => S.wantLimit, v => { if (+v > 1e8 && PHONE_Q.matches) toast('10⁹ needs about 60 MB: it may be slow on a phone'); startSieve(+v); });
  // panel open / close, dock
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  $('dockShapes').addEventListener('click', () => { setOpen(true); $('gallery').scrollIntoView({ block: 'start' }); });
  $('dockMode').addEventListener('click', () => {
    const cyc = MODES.filter(m => m.id !== M.gauss && m.id !== M.eisen);
    const i = cyc.findIndex(m => m.id === S.mode);
    setMode(cyc[(i + 1) % cyc.length].id); toast(MODES.find(m => m.id === S.mode).name);
  });
  $('dockWalk').addEventListener('click', toggleWalk);
  $('dockHome').addEventListener('click', goHome);
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
  // minimap
  const mini = $('mini');
  const miniGo = e => {
    if (!S.miniCam || is3D(S.shape)) return;
    const r = mini.getBoundingClientRect(), mc = S.miniCam;
    const x = mc.x + ((e.clientX - r.left) / r.width - 0.5) * mc.span, y = mc.y - ((e.clientY - r.top) / r.height - 0.5) * mc.span;
    S.cam.x = x; S.cam.y = y; userMoved(); S.dirty = true;
  };
  let miniDown = false;
  mini.addEventListener('pointerdown', e => { miniDown = true; try { mini.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ } miniGo(e); });
  mini.addEventListener('pointermove', e => { if (miniDown) miniGo(e); });
  mini.addEventListener('pointerup', () => { miniDown = false; });
  syncSwatches(); syncModeUI(); syncShapeUI(S.shape); renderLegend();
  if (PHONE_Q.matches) setOpen(false);
}
function segBind(id, get, set) {
  const el = $(id);
  const sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(get()) === b.dataset.v));
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); sync(); }));
  sync(); el._sync = sync;
}
function rangeBind(id, set, f) {
  const inp = $(id), out = $(id + 'V');
  const show = () => { set(+inp.value); if (out) out.textContent = f(+inp.value); S.dirty = true; };
  inp.addEventListener('input', () => { show(); rt.thumbsDirty = true; });
  show();
}
function checkBind(id, set) { const el = $(id); el.addEventListener('change', () => { set(el.checked); S.dirty = true; S.overlayDirty = true; }); set(el.checked); }
function syncSwatches() {
  $('palettes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === S.pal));
  $('bgs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === S.bg));
}
export function syncModeUI() {
  $('modes').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.id === S.mode));
  const m = MODES.find(x => x.id === S.mode);
  $('modeNote').textContent = m ? m.note : '';
  $('dockMode').textContent = m ? m.name.split(' ')[0] : '';
  renderLegend();
}
function renderLegend() {
  const st = PALETTES[S.pal].stops, q = PALETTES[S.pal].quad, el = $('legend');
  const dot = (c, t) => `<span><i style="background:${c};color:${c}"></i>${t}</span>`;
  const m = S.mode;
  const mix = (a, t) => { const x = rgb(a); return `rgb(${x.map(v => Math.round((v + (1 - v) * t) * 255)).join(',')})`; };
  let h = '';
  if (m === M.primes || m === M.gauss || m === M.eisen) h = dot(st[3], 'prime');
  else if (m >= M.twin && m <= M.sexy) h = dot(mix(st[4], 0.15), ['', 'twin', 'cousin', 'sexy'][m]) + dot(st[1], 'other primes');
  else if (m === M.sophie) h = dot(mix(st[4], 0.15), 'Sophie Germain') + dot(st[3], 'safe') + dot('#fff8e6', 'both');
  else if (m === M.figurate) h = dot(st[3], 'square') + dot(st[2], 'triangular') + dot(mix(st[4], 0.35), 'Fibonacci') + dot('#fff', 'square & triangular');
  else {
    const lab = { [M.divisors]: ['d(n) = 1, 2', 'd(n) ≥ 64'], [M.spf]: ['2', 'prime'], [M.totient]: ['φ/n → 0', 'φ/n → 1'] }[m];
    h = `<span class="bar" style="background:linear-gradient(90deg,${st.join(',')})"></span><span class="ends"><span>${lab[0]}</span><span>${lab[1]}</span></span>`;
  }
  if (S.quad.on) h += dot(q, 'f(n)');
  el.innerHTML = h;
}
export function syncShapeUI(sh) {
  $('gallery').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.key === sh.key));
  $('shapeName').textContent = sh.name;
  $('shapeNote').textContent = sh.note;
  const box = $('shapeParams'); box.innerHTML = '';
  for (const p of sh.params) box.append(paramControl(p));
  updateStatus();
}
// One control per shape parameter. A change redraws at once (no morph).
function paramControl(key) {
  const wrap = document.createElement('div');
  const changed = () => { S.tile.have = null; computeRays(); updateQuad(); rt.thumbsDirty = true; rt.miniAt = 0; rt.piAt = -1; S.dirty = true; S.overlayDirty = true; };
  const range = (label, min, max, step, get, set, f) => {
    wrap.className = 'row';
    wrap.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
    const inp = wrap.querySelector('input'), out = wrap.querySelector('.val');
    inp.value = get(); out.textContent = f(get());
    inp.addEventListener('input', () => { set(+inp.value); out.textContent = f(+inp.value); changed(); });
  };
  const seg = (opts, get, set) => {
    wrap.className = 'seg';
    for (const [v, t] of opts) {
      const b = document.createElement('button'); b.textContent = t; b.dataset.v = v;
      b.addEventListener('click', () => { set(v); wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === String(get()))); changed(); });
      b.classList.toggle('on', String(get()) === String(v));
      wrap.append(b);
    }
  };
  switch (key) {
    case 'start': {
      wrap.className = 'row';
      wrap.innerHTML = '<label>Start number</label><input type="number" min="0" step="1">';
      const inp = wrap.querySelector('input'); inp.value = S.P.start;
      inp.addEventListener('change', () => { const v = Math.max(0, Math.floor(+inp.value || 0)); if (Number.isSafeInteger(v)) { S.P.start = v; changed(); } });
      break;
    }
    case 'cw': seg([['false', 'Counter-clockwise'], ['true', 'Clockwise']], () => String(S.P.cw), v => { S.P.cw = v === 'true'; }); break;
    case 'rot': seg([['0', 'Start →'], ['1', '↑'], ['2', '←'], ['3', '↓']], () => String(S.P.rot), v => { S.P.rot = +v; }); break;
    case 'w': range('Width w', 2, 420, 1, () => S.P.w, v => { S.P.w = v; }, v => String(v)); break;
    case 'L': range('Core length L', 1, 80, 1, () => S.P.L, v => { S.P.L = v; }, v => String(v)); break;
    case 'cut': range('Corner cut', 0, 8, 1, () => S.P.cut, v => { S.P.cut = v; }, v => `${v}/8`); break;
    case 'K': range('Turns per square', 0.25, 4, 0.05, () => S.P.K, v => { S.P.K = v; }, v => v.toFixed(2)); break;
    case 'ang': range('Angle (degrees)', 90, 180, 0.01, () => S.P.ang, v => { S.P.ang = v; }, v => v.toFixed(2) + '°'); break;
    case 'g': range('Growth per turn g', 1.1, 12, 0.05, () => S.P.g, v => { S.P.g = v; }, v => v.toFixed(2)); break;
  }
  return wrap;
}

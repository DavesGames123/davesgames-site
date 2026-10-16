// ============================================================================
//  THERMAL CONVECTION  ·  ui.js — control panel, dock, sheet, readouts
// ----------------------------------------------------------------------------
//  Two halves:
//    1. Pure helpers (no DOM at import, node-testable): number formats,
//       the slider specs, the quality pick, the URL query, the backing
//       store size, the preset split, the overlay occlusion and the cut
//       through a tap point.
//    2. createUI(app, doc) binds index.html to the app object of main.js.
//       Every control calls an app method (app.set, app.applyPreset,
//       app.setView, ...). The app calls ui.sync() after a change, so a
//       change from the saver director also shows in the panel.
//
//  EXPORTS   (grep -n "<anchor>" ui.js)
//      PHONE_Q ......... "export const PHONE_Q"      phone media query
//      VIEWS ........... "export const VIEWS"        view ids and names
//      MODES ........... "export const MODES"        heating mode notes
//      SLIDERS ......... "export const SLIDERS"      slider <-> app value
//      fmtSci .......... "export function fmtSci"    1.0 × 10⁵
//      fmtNum .......... "export function fmtNum"
//      raCrit .......... "export function raCrit"    onset Ra for a top
//      pickQuality ..... "export function pickQuality"
//      parseQuery ...... "export function parseQuery"
//      backingSize ..... "export function backingSize"
//      presetParts ..... "export function presetParts"
//      presetIds ....... "export function presetIds"
//      occlusionOf ..... "export function occlusionOf"
//      sliceThrough .... "export function sliceThrough"
//      statusText ...... "export function statusText"
//      createUI ........ "export function createUI"
// ============================================================================
import { RA_CRIT } from './explainer.js';

export const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';

export const VIEWS = [
  { id: 'split', name: 'Split' },
  { id: 'block', name: 'Block' },
  { id: 'surface', name: 'Surface' },
  { id: 'slice', name: 'Section' },
];

export const MODES = {
  plate: 'Rayleigh–Bénard: a uniform hot bottom and a cold top.',
  burner: 'A pot on a stove: a hot patch at the centre of the bottom.',
  sun: 'Heated from below, cooled at the top by a flux that grows with T: broad warm cells, narrow cold lanes.',
  pan: 'Bénard–Marangoni: a thin layer whose surface tension changes with T drives the cells.',
};

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

// 1e5 -> "1.0 × 10⁵", 3000 -> "3.0 × 10³". Not finite -> "–".
export function fmtSci(v, digits = 1) {
  if (!Number.isFinite(v)) return '–';
  if (v === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(v)));
  let m = v / 10 ** e;
  if (Math.abs(+m.toFixed(digits)) >= 10) { m /= 10; e += 1; }
  return `${m.toFixed(digits)} × 10${String(e).split('').map(c => SUP[c]).join('')}`;
}

export function fmtNum(v, digits = 2) {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e4)) return fmtSci(v, 1);
  return v.toFixed(digits);
}

// The onset Rayleigh number for a top boundary (bottom always rigid).
export function raCrit(top) { return top === 'rigid' ? RA_CRIT.rigid : RA_CRIT.free; }

// Each slider: the element id, how to read the app value, how to write it.
// get(app) -> app value, put(app, v) -> calls the app, toUI / fromUI map the
// app value to the slider position, fmt shows it.
const log10 = Math.log10;
export const SLIDERS = [
  { id: 'ra', get: a => a.params.Ra, put: (a, v) => a.set({ Ra: v }), toUI: log10, fromUI: x => 10 ** x, fmt: v => fmtSci(v) },
  { id: 'pr', get: a => a.params.Pr, put: (a, v) => a.set({ Pr: v }), toUI: log10, fromUI: x => +(10 ** x).toPrecision(3), fmt: v => fmtNum(v, 2) },
  { id: 'bpow', get: a => a.params.burner.power, put: (a, v) => a.set({ burner: { ...a.params.burner, power: v } }), fmt: v => v.toFixed(2) },
  { id: 'brad', get: a => a.params.burner.r, put: (a, v) => a.set({ burner: { ...a.params.burner, r: v } }), fmt: v => v.toFixed(2) },
  { id: 'ma', get: a => a.params.Ma, put: (a, v) => a.set({ Ma: v }), fmt: v => v.toFixed(0) },
  { id: 'cool', get: a => a.params.cool, put: (a, v) => a.set({ cool: v }), fmt: v => v.toFixed(2) },
  { id: 'speed', get: a => a.params.speed, put: (a, v) => a.set({ speed: v }), fmt: v => v.toFixed(2) + '×' },
  { id: 'zscale', get: a => a.zScale, put: (a, v) => a.setDisplay({ zScale: v }), fmt: v => v.toFixed(2) + '×' },
  { id: 'surfz', get: a => a.surfaceZ, put: (a, v) => a.setDisplay({ surfaceZ: v }), fmt: v => 'z = ' + v.toFixed(2) },
  { id: 'angle', get: a => a.slice.angle, put: (a, v) => a.setSlice({ angle: v }), toUI: r => (((r * 180 / Math.PI) % 180) + 180) % 180, fromUI: d => d * Math.PI / 180, fmt: r => Math.round((((r * 180 / Math.PI) % 180) + 180) % 180) + '°' },
  { id: 'offset', get: a => a.slice.offset, put: (a, v) => a.setSlice({ offset: v }), fmt: v => v.toFixed(2) },
  { id: 'gain', get: a => a.gain, put: (a, v) => a.setDisplay({ gain: v }), fmt: v => v.toFixed(2) + '×' },
  { id: 'bias', get: a => a.bias, put: (a, v) => a.setDisplay({ bias: v }), fmt: v => v.toFixed(2) },
];

// Quality tier 0 phone, 1 tablet, 2 desktop, from the screen size, the
// pointer and the core count. q (0|1|2) overrides.
export function pickQuality({ w, h, coarse = false, cores = 8, q = null } = {}) {
  if (q === 0 || q === 1 || q === 2) return q;
  const short = Math.min(w, h), long = Math.max(w, h);
  if (short < 560 || (coarse && long < 960)) return 0;
  if (coarse || cores <= 4 || short < 820) return 1;
  return 2;
}

// ?q=0|1|2 ?preset=id ?seed=int ?view=split|block|surface|slice
export function parseQuery(search = '') {
  const s = new URLSearchParams(search);
  const q = s.has('q') && /^[012]$/.test(s.get('q')) ? +s.get('q') : null;
  const preset = s.has('preset') && /^[a-z0-9_-]{1,32}$/i.test(s.get('preset')) ? s.get('preset') : null;
  const seed = s.has('seed') && /^\d{1,9}$/.test(s.get('seed')) ? +s.get('seed') : null;
  const view = s.has('view') && VIEWS.some(v => v.id === s.get('view')) ? s.get('view') : null;
  return { q, preset, seed, view };
}

// Backing store in device px: dpr capped at 2, the long side at 2560 and
// the short side at 1440 (either orientation). Returns { pw, ph, dpr } with
// dpr the scale that was used.
export function backingSize(cssW, cssH, dpr = 1, maxLong = 2560, maxShort = 1440) {
  const w = Math.max(1, cssW), h = Math.max(1, cssH);
  let d = Math.min(2, Math.max(0.5, dpr || 1));
  const long = Math.max(w, h), short = Math.min(w, h);
  d = Math.min(d, maxLong / long, maxShort / short);
  return { pw: Math.max(1, Math.round(w * d)), ph: Math.max(1, Math.round(h * d)), dpr: d };
}

// The preset ids in their order. PRESETS may be an object keyed by id or
// an array of { id, ... }.
export function presetIds(PRESETS) {
  if (!PRESETS) return [];
  if (Array.isArray(PRESETS)) return PRESETS.map(p => p && p.id).filter(Boolean);
  return Object.keys(PRESETS);
}

const titleCase = s => s.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());

// Split a preset into its parts: { id, name, params, palette, view, fromRest, extra }.
// A preset is either { params: {...}, palette, view } or a flat object;
// in the flat form the keys that DEFAULTS has are params. params is a full
// object (DEFAULTS, then the preset), so a preset never inherits a value
// from the one before it.
export function presetParts(PRESETS, DEFAULTS, id) {
  const p = Array.isArray(PRESETS) ? PRESETS.find(x => x && x.id === id) : PRESETS && PRESETS[id];
  if (!p) return null;
  const base = JSON.parse(JSON.stringify(DEFAULTS || {}));
  let src = p.params;
  if (!src) { src = {}; for (const k of Object.keys(p)) if (k in base) src[k] = p[k]; }
  const params = { ...base, ...src };
  if (src.burner) params.burner = { ...base.burner, ...src.burner };
  const view = typeof p.view === 'string' ? p.view : p.view && p.view.view;
  return {
    id, name: p.name || p.label || titleCase(id), params,
    palette: p.palette || null,
    view: VIEWS.some(v => v.id === view) ? view : null,
    fromRest: !!(p.fromRest || p.rest || p.reset || id === 'onset'),
    extra: p,
  };
}

// Overlay margins in CSS px from overlay boxes [{left, top, right, bottom}].
// A box wider than tall (relative to the frame) covers the top or the
// base; any other box covers a side. A box counts only when it spans half
// of that edge or more, so a small corner box does not move the views.
export function occlusionOf(boxes, w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const q of boxes) {
    if (!q) continue;
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right);
    const y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.5) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.5) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  return o;
}

// The slice with the same angle through box point p = { x, y }: offset is
// the signed distance of p from the box centre along the plane normal
// (-sin a, cos a), wrapped into [-h, h) with h the half extent of the box
// along the normal (the same wrap as render/layout.js wrapOffset).
export function sliceThrough(p, angle, Lx, Ly) {
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  const off = (p.x - Lx / 2) * nx + (p.y - Ly / 2) * ny;
  const h = 0.5 * (Lx * Math.abs(nx) + Ly * Math.abs(ny));
  if (!(h > 0)) return { angle, offset: 0 };
  let o = (off + h) % (2 * h);
  if (o < 0) o += 2 * h;
  return { angle, offset: o - h };
}

// The one-line status: Ra, Pr, Nu, max |u|, t.
export function statusText(params, stats) {
  const s = stats || {};
  return [
    `Ra ${fmtSci(params.Ra)}`,
    `Pr ${fmtNum(params.Pr, 2)}`,
    `Nu ${Number.isFinite(s.Nu) ? s.Nu.toFixed(2) : '–'}`,
    `max |u| ${Number.isFinite(s.vmax) ? s.vmax.toFixed(3) : '–'}`,
    `t = ${Number.isFinite(s.simTime) ? s.simTime.toFixed(1) : '–'} tff`,
  ].join(' · ');
}

// ── DOM ─────────────────────────────────────────────────────────────────
// createUI(app, doc) -> { sync, setStats, setPresets, setPalettes, toast,
//   showNoGPU, placeLabels, overlayBoxes, isPhone, setPanel, setPhysics }
export function createUI(app, doc = globalThis.document) {
  const $ = id => doc.getElementById(id);
  const win = doc.defaultView || globalThis;
  const mq = win.matchMedia ? win.matchMedia(PHONE_Q) : { matches: false, addEventListener() {} };
  const panel = $('panel'), physics = $('physics'), body = doc.body;
  const physHome = physics.parentNode, physNext = physics.nextSibling;
  let presetList = [], paletteList = [];

  // Panels. Wide screen: two columns. Phone: one sheet with two tabs, and
  // #physics moves into the sheet.
  function setPanel(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    body.classList.toggle('panel-open', open);
    $('dockPanel').classList.toggle('on', open);
    $('dockPanel').setAttribute('aria-expanded', String(open));
  }
  function setPhysics(open) {
    physics.classList.toggle('open', open);
    body.classList.toggle('phys-open', open && !mq.matches);
  }
  function setTab(tab) {
    panel.dataset.tab = tab;
    for (const b of doc.querySelectorAll('#sheetTabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  }
  function placePhysics() {
    if (mq.matches) { if (physics.parentNode !== panel) panel.appendChild(physics); setPhysics(true); body.classList.remove('phys-open'); }
    else {
      if (physics.parentNode !== physHome) physHome.insertBefore(physics, physNext);
      setPhysics((win.innerWidth || 1280) >= 1180);
    }
  }
  setTab('controls');
  placePhysics();
  setPanel(!mq.matches);
  mq.addEventListener && mq.addEventListener('change', () => { placePhysics(); setPanel(!mq.matches); });

  $('gear').addEventListener('click', () => setPanel(true));
  $('panelClose').addEventListener('click', () => setPanel(false));
  $('physBtn').addEventListener('click', () => setPhysics(true));
  $('physClose').addEventListener('click', () => setPhysics(false));
  $('dockPanel').addEventListener('click', () => setPanel(!panel.classList.contains('open')));
  for (const b of doc.querySelectorAll('#sheetTabs button')) b.addEventListener('click', () => { setTab(b.dataset.tab); panel.scrollTop = 0; });

  // The sheet grip: a tap switches half and full height, a drag up gives
  // full height, a drag down gives half height and then closes.
  const grip = $('sheetGrip');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setPanel(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // Sliders.
  for (const s of SLIDERS) {
    const inp = $(s.id);
    if (!inp) continue;
    inp.addEventListener('input', () => {
      const v = s.fromUI ? s.fromUI(+inp.value) : +inp.value;
      s.put(app, v);
      const out = $(s.id + 'V'); if (out) out.textContent = s.fmt(v);
    });
  }

  // Segments and toggles.
  for (const b of doc.querySelectorAll('#modeSeg button')) b.addEventListener('click', () => app.set({ mode: b.dataset.mode }));
  for (const b of doc.querySelectorAll('#topSeg button')) b.addEventListener('click', () => app.set({ top: b.dataset.top }));
  for (const b of doc.querySelectorAll('#viewSeg button')) b.addEventListener('click', () => app.setView(b.dataset.view));
  for (const b of doc.querySelectorAll('#toggles button')) b.addEventListener('click', () => app.setToggle(b.dataset.toggle, !app.toggles[b.dataset.toggle]));
  $('playBtn').addEventListener('click', () => app.setPlaying(!app.playing));
  $('dockPlay').addEventListener('click', () => app.setPlaying(!app.playing));
  $('resetBtn').addEventListener('click', () => app.reset());

  // Dock: each button steps to the next value.
  const next = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
  $('dockPreset').addEventListener('click', () => { if (presetList.length) app.applyPreset(next(presetList.map(p => p.id), app.preset)); });
  $('dockView').addEventListener('click', () => app.setView(next(VIEWS.map(v => v.id), app.view)));
  $('dockPalette').addEventListener('click', () => { if (paletteList.length) app.setPalette(next(paletteList.map(p => p.id), app.palette)); });

  // The dock saver button. saver.js (package SAVER) binds #saverBtn
  // itself; main.js sets app.saverToggle when the saver loads.
  $('dockSaver').addEventListener('click', () => { if (typeof app.saverToggle === 'function') app.saverToggle(); });

  function setPresets(list) {
    presetList = list;
    const box = $('presetChips'); box.textContent = '';
    for (const p of list) {
      const b = doc.createElement('button');
      b.type = 'button'; b.dataset.preset = p.id; b.textContent = p.name;
      b.addEventListener('click', () => app.applyPreset(p.id));
      box.appendChild(b);
    }
    sync();
  }
  // list: [{ id, name, css }] with css a linear-gradient for the swatch.
  function setPalettes(list) {
    paletteList = list;
    const box = $('paletteChips'); box.textContent = '';
    for (const p of list) {
      const b = doc.createElement('button');
      b.type = 'button'; b.dataset.palette = p.id;
      const sw = doc.createElement('span'); sw.className = 'sw'; sw.style.background = p.css;
      b.appendChild(sw); b.appendChild(doc.createTextNode(p.name));
      b.addEventListener('click', () => app.setPalette(p.id));
      box.appendChild(b);
    }
    sync();
  }

  // Put every control in step with the app.
  function sync() {
    for (const s of SLIDERS) {
      const inp = $(s.id); if (!inp) continue;
      let v; try { v = s.get(app); } catch { continue; }
      if (!Number.isFinite(v)) continue;
      if (doc.activeElement !== inp) inp.value = String(s.toUI ? s.toUI(v) : v);
      const out = $(s.id + 'V'); if (out) out.textContent = s.fmt(v);
    }
    const P = app.params;
    for (const b of doc.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === P.mode);
    for (const b of doc.querySelectorAll('#topSeg button')) b.classList.toggle('on', b.dataset.top === P.top);
    for (const b of doc.querySelectorAll('#viewSeg button')) b.classList.toggle('on', b.dataset.view === app.view);
    for (const b of doc.querySelectorAll('#toggles button')) b.setAttribute('aria-pressed', String(!!app.toggles[b.dataset.toggle]));
    for (const b of doc.querySelectorAll('#presetChips button')) b.classList.toggle('on', b.dataset.preset === app.preset);
    for (const b of doc.querySelectorAll('#paletteChips button')) b.classList.toggle('on', b.dataset.palette === app.palette);
    $('modeHint').textContent = MODES[P.mode] || '';
    $('burnerBox').hidden = P.mode !== 'burner';
    $('maBox').hidden = P.mode !== 'pan';
    $('coolBox').hidden = P.mode !== 'sun';
    $('playBtn').textContent = app.playing ? 'Pause' : 'Play';
    $('dockPlay').textContent = app.playing ? '❚❚' : '▶';
    $('dockPlay').setAttribute('aria-label', app.playing ? 'Pause' : 'Play');
    const pr = presetList.find(p => p.id === app.preset);
    $('dockPresetV').textContent = pr ? pr.name : 'Custom';
    $('dockViewV').textContent = (VIEWS.find(v => v.id === app.view) || VIEWS[0]).name;
    const pal = paletteList.find(p => p.id === app.palette);
    if (pal) $('dockSwatch').style.background = pal.css;
    $('rdRa').textContent = fmtSci(P.Ra);
    $('rdRac').textContent = P.mode === 'plate' ? (P.Ra / raCrit(P.top)).toFixed(1) : '–';
    $('rdPr').textContent = fmtNum(P.Pr, 2);
    if (app.dims) $('rdGrid').textContent = `${app.dims.nx} × ${app.dims.ny} × ${app.dims.nz}`;
  }

  // Only the cut sliders: the saver moves the cut every frame.
  function syncSlice() {
    for (const id of ['angle', 'offset']) {
      const s = SLIDERS.find(x => x.id === id), inp = $(id), v = s.get(app);
      if (doc.activeElement !== inp) inp.value = String(s.toUI ? s.toUI(v) : v);
      $(id + 'V').textContent = s.fmt(v);
    }
  }

  function setStats(s) {
    $('stMain').textContent = statusText(app.params, s);
    if (!s) return;
    $('rdNu').textContent = Number.isFinite(s.Nu) ? s.Nu.toFixed(2) : '–';
    $('rdU').textContent = Number.isFinite(s.vmax) ? s.vmax.toFixed(3) : '–';
    $('rdT').textContent = Number.isFinite(s.simTime) ? s.simTime.toFixed(1) + ' tff' : '–';
  }

  let toastT = 0;
  function toast(msg, ms = 3000) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    win.clearTimeout(toastT); toastT = win.setTimeout(() => { t.hidden = true; }, ms);
  }
  function showNoGPU() {
    $('nogpu').hidden = false;
    $('hint').hidden = true;
    if (!mq.matches) setPhysics(true); else { setPanel(true); setTab('physics'); }
  }

  // View labels at the top left of each rect (CSS px of the stage).
  const LBL = { surface: 'lblSurface', slice: 'lblSlice', block: 'lblBlock' };
  let lastKey = '';
  function placeLabels(rects, text) {
    const key = JSON.stringify(rects) + JSON.stringify(text);
    if (key === lastKey) return;
    lastKey = key;
    for (const k of Object.keys(LBL)) {
      const el = $(LBL[k]), r = rects && rects[k];
      if (!r || !text[k]) { el.hidden = true; continue; }
      el.hidden = false;
      el.innerHTML = text[k];
      el.style.left = Math.round(r.x + 8) + 'px';
      el.style.top = Math.round(r.y + 8) + 'px';
    }
  }

  // The boxes of the overlays that cover the stage, for occlusionOf.
  function overlayBoxes() {
    const els = [panel, physics.parentNode === panel ? null : physics, $('dock'), $('status'), doc.querySelector('.topbar')];
    const out = [];
    for (const el of els) {
      if (!el) continue;
      const cs = win.getComputedStyle ? win.getComputedStyle(el) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
      out.push(el.getBoundingClientRect());
    }
    return out;
  }

  return { sync, syncSlice, setStats, setPresets, setPalettes, toast, showNoGPU, placeLabels, overlayBoxes, setPanel, setPhysics, setTab, isPhone: () => mq.matches };
}

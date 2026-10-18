// ============================================================================
//  DLA TERRAIN  ·  ui.js — the panel, the dock, the map inset, the stage bar
// ----------------------------------------------------------------------------
//  DOM-free part (node tests import these):
//    PHONE_Q, GROUP_ORDER, STAGES, LAYERS, WX_SLIDERS
//    groupOptions(OPTIONS) -> [{ group, items }] in GROUP_ORDER (unknown
//        groups go last, every option exactly once)
//    fmtValue(def, v)       the text of an option value
//    todRate(v)             day speed slider -> game minutes per real second
//    biomeRGB(b)            a BIOMES colour as [r, g, b] 0..255 (hex or 0..1)
//    mapPixels(snap, size, BIOMES) -> Uint8ClampedArray RGBA size x size:
//        biome colour (or a height ramp), hillshade from the north-west,
//        water by depth, river field in blue
//    worldToMap(x, z, ws, size), mapToWorld(px, py, ws, size)
//  DOM part:
//    createUI(app, doc) -> ui = { buildOptions(lib), syncOptions(), setProgress(p),
//        progressDone(), setTerrainMap(view, BIOMES), drawMap(cam), mapCovers(),
//        mapView (map-view.js mountMapView: the inset and the large map), syncSky(),
//        syncView(), syncMix(), syncLocks(), syncHistory(), status(a, b, short),
//        notice(text), toast(text), isPhone(), setPanel(open), panelState(),
//        mapRect(), hintOnce(), overlays(), syncBuild(), buildShow(on),
//        buildSync(info) }
//    BUILD  "Watch it build": #buildBtn (Terrain tab) toggles app.buildMode;
//        #build is the bar (stage name, caption, stage cells, scrub,
//        Prev, Play/Pause, Next, speed, Close) that main.js fills from the
//        player (build-player.js info()).
//    PHONE  the dock holds five one-tap actions: controls, Randomise
//        everything, a new terrain (the next preset), the time of day and
//        the weather (each tap steps to the next one). The sheet has a grip:
//        a drag follows the finger and snaps to closed, half or full height
//        (layout.js snapSheet); a tap on the grip toggles half and full.
//        hintOnce() shows "tap to explore" one time per browser.
//        overlays() gives the bars that main.js measures for the clear rect.
//    DICE AND LOCKS  every LIB group (summary row) and every extra group of
//        world-state.js (Sky, Time, Season, Vegetation, Water, Camera: the
//        .sec-label rows with data-group) has a dice (app.randomise(group))
//        and a lock (app.toggleLock(group)). A locked group keeps its values
//        in "Randomise everything" and its dice is off.
//    app is the page state of main.js; ui calls its methods (app.setOpt,
//    app.generate, app.randomise, app.applyPreset, app.setTod, ...).
//
//  grep -n targets: "export function groupOptions", "export function mapPixels",
//  "export function createUI", "function buildOptions", "function drawMap",
//  "── SHEET", "── SKY", "── VIEW", "── MAP", "── PROGRESS", "── DICE",
//  "── MIX", "── HISTORY", "── DOCK", "── BUILD", "── HINT"
// ============================================================================
import { sheetHeights, snapSheet, DOCK_H } from './layout.js';
import { SEGMENTS, segStart } from './build.js';
import { mountMapView } from './map-view.js';

export const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
export const GROUP_ORDER = ['World', 'DLA ridges', 'Shape', 'Branched flow', 'Erosion', 'Climate', 'Detail'];
export const STAGES = [
  ['dla', 'DLA'], ['upscale', 'Upscale'], ['shape', 'Shape'], ['flow', 'Branched flow'],
  ['rivers', 'Rivers'], ['erosion', 'Erosion'], ['climate', 'Climate'], ['biomes', 'Biomes'],
];
export const LAYERS = [
  { key: 'grass', label: 'Grass' }, { key: 'trees', label: 'Trees' }, { key: 'props', label: 'Rocks' },
  { key: 'water', label: 'Water' }, { key: 'clouds', label: 'Clouds' }, { key: 'rain', label: 'Rain' },
];
// the dock text of a weather: one short word
export function wxShort(w) {
  const l = (w && (w.label || w.id)) || '';
  return /thunder/i.test(l) ? 'Storm' : l.split(' ')[0];
}
export const WX_SLIDERS = [
  { key: 'cover', label: 'Cloud cover', min: 0, max: 1, step: 0.01 },
  { key: 'rain', label: 'Rain', min: 0, max: 1, step: 0.01 },
  { key: 'snow', label: 'Snow', min: 0, max: 1, step: 0.01 },
  { key: 'fog', label: 'Fog', min: 0, max: 1, step: 0.01 },
  { key: 'wind', label: 'Wind m/s', min: 0, max: 25, step: 0.5 },
];

// the day speed slider 0..1 -> game minutes per real second (0 = still)
export function todRate(v) { return v <= 0 ? 0 : 0.5 + v * v * 240; }

export function groupOptions(OPTIONS) {
  const by = new Map();
  for (const o of OPTIONS || []) {
    if (o.key === 'seed') continue;           // the seed has its own field
    const g = o.group || 'Other';
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(o);
  }
  const out = [];
  for (const g of GROUP_ORDER) if (by.has(g)) { out.push({ group: g, items: by.get(g) }); by.delete(g); }
  for (const [g, items] of by) out.push({ group: g, items });
  return out;
}

export function fmtValue(def, v) {
  if (def.type === 'bool') return v ? 'On' : 'Off';
  if (def.type === 'select') return String(v);
  const s = def.step || 0.01;
  const d = s >= 1 ? 0 : s >= 0.1 ? 1 : s >= 0.01 ? 2 : 3;
  return (+v).toFixed(d);
}

export function biomeRGB(b) {
  const c = b && b.color;
  if (Array.isArray(c)) return c.map(x => Math.round((x <= 1 ? x * 255 : x)));
  if (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c)) {
    const h = c.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [128, 128, 128];
}

export function worldToMap(x, z, ws, size) { return [(x / ws + 0.5) * size, (z / ws + 0.5) * size]; }
export function mapToWorld(px, py, ws, size) { return [(px / size - 0.5) * ws, (py / size - 0.5) * ws]; }

// snap = { n, height, seaLevel, worldSize, biome?, river?, water? }
export function mapPixels(snap, size, BIOMES) {
  const out = new Uint8ClampedArray(size * size * 4);
  if (!snap || !snap.height) return out;
  const n = snap.n || Math.round(Math.sqrt(snap.height.length)), H = snap.height;
  const sea = snap.seaLevel ?? 0, ws = snap.worldSize || 1;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < H.length; i += 7) { lo = Math.min(lo, H[i]); hi = Math.max(hi, H[i]); }
  const span = Math.max(1, hi - Math.max(lo, sea));
  const pal = (BIOMES || []).map(biomeRGB);
  const at = (i, j) => H[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  const cell = ws / n;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = Math.min(n - 1, Math.floor((x + 0.5) * n / size)), j = Math.min(n - 1, Math.floor((y + 0.5) * n / size));
    const k = j * n + i, h = H[k];
    let c;
    if (snap.biome && pal.length) c = pal[snap.biome[k]] || [128, 128, 128];
    else {
      const t = Math.max(0, Math.min(1, (h - sea) / span));
      c = t < 0.4 ? [90 + t * 120, 130 + t * 60, 70 + t * 40] : t < 0.75 ? [140 + (t - 0.4) * 150, 140 + (t - 0.4) * 80, 110 + (t - 0.4) * 60] : [200 + (t - 0.75) * 200, 200 + (t - 0.75) * 200, 200 + (t - 0.75) * 210];
    }
    // hillshade from the north-west
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), dz = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
    const nx = -dx, nz = -dz, ny = 1, l = Math.hypot(nx, ny, nz);
    const shade = Math.max(0.25, ((nx * -0.6 + ny * 0.7 + nz * -0.4) / l) * 1.15);
    let r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
    if (h < sea) {
      const d = Math.min(1, (sea - h) / (span * 0.25));
      r = 30 + (1 - d) * 40; g = 70 + (1 - d) * 60; b = 110 + (1 - d) * 50;
    } else if (snap.river && snap.river[k] > 0.25) {
      const a = Math.min(1, (snap.river[k] - 0.25) * 2);
      r = r * (1 - a) + 60 * a; g = g * (1 - a) + 120 * a; b = b * (1 - a) + 170 * a;
    }
    const o = (y * size + x) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return out;
}

// ── DOM ─────────────────────────────────────────────────────────────────
export function createUI(app, doc = globalThis.document) {
  const $ = id => doc.getElementById(id);
  const win = doc.defaultView || globalThis;
  const mq = win.matchMedia ? win.matchMedia(PHONE_Q) : { matches: false, addEventListener() {} };
  const panel = $('panel'), body = doc.body;
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const ui = { inputs: new Map() };

  // ── SHEET ──
  function setPanel(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    panel.style.height = '';
    body.classList.toggle('panel-open', open);
    $('dockPanel').classList.toggle('on', open);
    $('dockPanel').setAttribute('aria-expanded', String(open));
    if (app.onLayout) app.onLayout();
  }
  function setTab(tab) {
    for (const b of doc.querySelectorAll('#sheetTabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const s of doc.querySelectorAll('#panel section.tab')) s.hidden = s.dataset.tab !== tab;
    panel.scrollTop = 0;
  }
  ui.setPanel = setPanel;
  ui.isPhone = () => mq.matches;
  ui.panelState = () => (!panel.classList.contains('open') ? 'closed' : panel.classList.contains('full') ? 'full' : 'half');
  // the bars that cover the view (main.js frames the terrain beside them)
  const bars = ['panel', 'dock', 'status', 'build'].map($).concat([doc.querySelector('.topbar')]).filter(Boolean);
  ui.overlays = () => bars.filter(b => (b !== panel || panel.classList.contains('open')) && !b.hidden).map(b => b.getBoundingClientRect());
  setTab('terrain');
  setPanel(!mq.matches);
  mq.addEventListener && mq.addEventListener('change', () => setPanel(!mq.matches));
  $('gear').addEventListener('click', () => setPanel(true));
  $('panelClose').addEventListener('click', () => setPanel(false));
  $('dockPanel').addEventListener('click', () => setPanel(!panel.classList.contains('open')));
  for (const b of doc.querySelectorAll('#sheetTabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
  // the grip: the sheet follows the finger, then snaps to a stop
  const grip = $('sheetGrip');
  let drag = null;
  const stops = () => {
    const dk = $('dock'), dh = dk && dk.offsetHeight ? dk.offsetHeight : DOCK_H;
    return sheetHeights(win.innerHeight, { b: Math.max(0, dh - DOCK_H) });
  };
  grip.addEventListener('pointerdown', e => {
    drag = { y: e.clientY, h0: panel.getBoundingClientRect().height || stops().half, moved: false };
    panel.classList.add('dragging');
    try { grip.setPointerCapture(e.pointerId); } catch { /* old browser */ }
  });
  grip.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 8) drag.moved = true;
    if (drag.moved) panel.style.height = Math.max(40, Math.min(stops().full, drag.h0 - dy)) + 'px';
  });
  const endDrag = (e, cancel) => {
    if (!drag) return;
    const d = drag; drag = null;
    panel.classList.remove('dragging');
    panel.style.height = '';
    if (cancel) return;
    if (!d.moved) { panel.classList.toggle('full'); if (app.onLayout) app.onLayout(); return; }
    const s = snapSheet(d.h0 - (e.clientY - d.y), stops());
    if (s === 'closed') setPanel(false);
    else { panel.classList.toggle('full', s === 'full'); if (app.onLayout) app.onLayout(); }
  };
  grip.addEventListener('pointerup', e => endDrag(e, false));
  grip.addEventListener('pointercancel', e => endDrag(e, true));

  // a range row: label, value, slider
  function rangeRow(id, label, min, max, step, value, fmt, onInput) {
    const row = el('div', 'row');
    const lb = el('label', '', label); lb.htmlFor = id;
    const inp = el('input'); inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    const val = el('span', 'val', fmt(+value));
    inp.addEventListener('input', () => { val.textContent = fmt(+inp.value); onInput(+inp.value, row); });
    row.append(lb, inp, val);
    row._set = v => { inp.value = v; val.textContent = fmt(+v); };
    return row;
  }

  // ── DICE: a dice and a lock for one group ──
  const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6"/><path class="shackle" d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7"/></svg>';
  const UNLOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6"/><path class="shackle" d="M5.2 7V5.2a2.8 2.8 0 0 1 5.5-0.8"/></svg>';
  ui.tools = new Map();
  function groupTools(group) {
    const wrap = el('span', 'gtools');
    const lock = el('button', 'lock'); lock.type = 'button';
    lock.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); app.toggleLock(group); });
    const dice = el('button', 'dice', '⚄'); dice.type = 'button';
    dice.title = 'Randomise ' + group.toLowerCase(); dice.setAttribute('aria-label', dice.title);
    dice.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); app.randomise(group); });
    wrap.append(lock, dice);
    ui.tools.set(group, { lock, dice });
    syncLock(group);
    return wrap;
  }
  function syncLock(group) {
    const t = ui.tools.get(group);
    if (!t) return;
    const on = !!(app.locks && app.locks.has(group));
    t.lock.innerHTML = on ? LOCK_SVG : UNLOCK_SVG;
    t.lock.setAttribute('aria-pressed', String(on));
    t.lock.title = on ? group + ' is locked: Randomise everything keeps it' : 'Lock ' + group.toLowerCase() + ' (keep it when you randomise everything)';
    t.lock.setAttribute('aria-label', t.lock.title);
    t.dice.disabled = on;
  }
  ui.syncLocks = () => { for (const g of ui.tools.keys()) syncLock(g); };
  // the extra groups: a .sec-label with data-group gets the tools
  for (const lab of doc.querySelectorAll('.sec-label[data-group]')) lab.append(groupTools(lab.dataset.group));

  // ── TERRAIN options (from LIB OPTIONS) ──
  function buildOptions(lib) {
    ui.lib = lib;
    const host = $('optGroups');
    host.textContent = '';
    ui.inputs.clear();
    for (const { group, items } of groupOptions(lib.OPTIONS)) {
      const det = el('details', 'group');
      if (group === 'World' || group === 'DLA ridges') det.open = true;
      const sum = el('summary');
      sum.append(el('span', '', group));
      sum.append(groupTools(group));
      det.append(sum);
      for (const d of items) {
        const id = 'opt_' + d.key;
        let row;
        const v = app.opts[d.key] ?? d.def;
        if (d.type === 'range') {
          row = rangeRow(id, d.label, d.min, d.max, d.step, v, x => fmtValue(d, x), x => app.setOpt(d.key, x));
        } else if (d.type === 'select') {
          row = el('div', 'row');
          const lb = el('label', '', d.label); lb.htmlFor = id;
          const s = el('select'); s.id = id;
          for (const c of d.choices) { const o = el('option', '', String(c)); o.value = String(c); s.append(o); }
          s.value = String(v);
          s.addEventListener('change', () => {
            const c = d.choices.find(x => String(x) === s.value);
            app.setOpt(d.key, c === undefined ? s.value : c);
          });
          row.append(lb, s);
          row._set = x => { s.value = String(x); };
        } else {
          row = el('div', 'row bool');
          const lb = el('label', '', d.label);
          const b = el('button', '', v ? 'On' : 'Off'); b.type = 'button'; b.id = id;
          b.setAttribute('aria-pressed', String(!!v));
          b.addEventListener('click', () => { const nv = !(b.getAttribute('aria-pressed') === 'true'); row._set(nv); app.setOpt(d.key, nv); });
          row.append(lb, b);
          row._set = x => { b.setAttribute('aria-pressed', String(!!x)); b.textContent = x ? 'On' : 'Off'; };
        }
        if (d.text) row.title = d.text;
        ui.inputs.set(d.key, row);
        det.append(row);
      }
      host.append(det);
    }
    // presets
    const pc = $('presetChips');
    pc.textContent = '';
    for (const [id, p] of Object.entries(lib.PRESETS || {})) {
      const b = el('button', '', p.label || id); b.type = 'button'; b.dataset.id = id;
      b.addEventListener('click', () => app.applyPreset(id));
      pc.append(b);
    }
    syncOptions();
  }
  function syncOptions() {
    for (const [k, row] of ui.inputs) if (row._set && app.opts[k] !== undefined) row._set(app.opts[k]);
    $('seedIn').value = app.opts.seed ?? '';
    for (const b of doc.querySelectorAll('#presetChips button')) b.classList.toggle('on', b.dataset.id === app.preset);
    $('dockGenV').textContent = app.preset ? (app.lib.PRESETS[app.preset] || {}).label || 'terrain' : 'terrain';
  }
  ui.buildOptions = buildOptions;
  ui.syncOptions = syncOptions;
  $('seedIn').addEventListener('change', () => { const v = Math.max(1, Math.min(999999, Math.round(+$('seedIn').value || 1))); app.setOpt('seed', v); });
  $('seedDice').addEventListener('click', () => { app.setOpt('seed', 1 + Math.floor(Math.random() * 999998)); syncOptions(); app.generate(); });
  $('genBtn').addEventListener('click', () => app.generate());
  $('randBtn').addEventListener('click', () => app.randomiseAll());
  // ── DOCK ──
  $('dockGen').addEventListener('click', () => app.nextPreset());
  $('dockDice').addEventListener('click', () => app.randomiseAll());
  $('dockWx').addEventListener('click', () => {
    const L = ui.wxList || [];
    if (!L.length) return;
    const i = L.findIndex(w => w.id === app.weatherId);
    app.setWeather(L[(i + 1) % L.length].id);
  });

  // ── HISTORY: the rolled worlds, back and forward; the link ──
  $('histBack').addEventListener('click', () => app.historyStep(-1));
  $('histFwd').addEventListener('click', () => app.historyStep(1));
  $('copyLink').addEventListener('click', () => app.copyLink());
  ui.syncHistory = () => {
    const h = app.hist;
    $('histBack').disabled = !(h && h.canBack);
    $('histFwd').disabled = !(h && h.canForward);
    $('histPos').textContent = h && h.size > 1 ? (h.index + 1) + ' / ' + h.size : '';
  };

  // ── MIX: vegetation and water look ──
  const MIX = [
    ['vegDensity', 'veg', 'density', v => v.toFixed(2) + '×'], ['vegConifer', 'veg', 'conifer', v => Math.round(v * 100) + '%'],
    ['vegFlowers', 'veg', 'flowers', v => Math.round(v * 100) + '%'], ['waterTint', 'water', 'tint', v => (v < 0.25 ? 'glacial' : v < 0.5 ? 'clear' : v < 0.75 ? 'green' : 'peaty')],
    ['waterWaves', 'water', 'waves', v => (v < 0.25 ? 'calm' : v < 0.6 ? 'breeze' : 'rough')],
  ];
  for (const [id, part, key, fmt] of MIX) {
    const inp = $(id);
    if (!inp) continue;
    inp.addEventListener('input', () => { $(id + 'V').textContent = fmt(+inp.value); app.setMix(part, key, +inp.value); });
  }
  ui.syncMix = () => {
    for (const [id, part, key, fmt] of MIX) {
      const inp = $(id), v = app[part] && app[part][key];
      if (!inp || v === undefined) continue;
      inp.value = v; $(id + 'V').textContent = fmt(+v);
    }
  };

  // ── SKY ──
  const todText = v => { const m = Math.round(v * 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const todRow = $('tod'), todV = $('todV');
  todRow.addEventListener('input', () => { app.setTod(+todRow.value); todV.textContent = todText(+todRow.value); });
  const sp = $('todSpeed');
  const spText = v => { const r = todRate(v); if (r <= 0) return 'still'; const s = 1440 / r; return s >= 90 ? (s / 60).toFixed(1) + ' min / day' : s.toFixed(0) + ' s / day'; };
  sp.addEventListener('input', () => { app.todSpeed = +sp.value; $('todSpeedV').textContent = spText(+sp.value); });
  $('todPlay').addEventListener('click', () => app.setPlaying(!app.playing));
  $('todGolden').addEventListener('click', () => (app.goldenHour ? app.goldenHour() : app.setTod(app.tod < 0.5 ? 0.275 : 0.715)));
  const seasonNames = ['spring', 'summer', 'autumn', 'winter'];
  $('season').addEventListener('input', e => { app.setSeason ? app.setSeason(+e.target.value) : (app.season = +e.target.value); $('seasonV').textContent = seasonNames[Math.floor(((+e.target.value + 0.125) % 1) * 4)]; });
  $('latitude').addEventListener('input', e => { app.latitude = +e.target.value; $('latitudeV').textContent = (+e.target.value).toFixed(0) + '°'; });
  ui.wxRows = new Map();
  function buildWeather(WEATHER) {
    ui.wxList = WEATHER.slice();
    const wc = $('wxChips'); wc.textContent = '';
    for (const w of WEATHER) {
      const b = el('button', '', w.label); b.type = 'button'; b.dataset.id = w.id;
      b.addEventListener('click', () => app.setWeather(w.id));
      wc.append(b);
    }
    const ws = $('wxSliders'); ws.textContent = '';
    for (const s of WX_SLIDERS) {
      const row = rangeRow('wx_' + s.key, s.label, s.min, s.max, s.step, 0, v => (s.key === 'wind' ? v.toFixed(1) : v.toFixed(2)), (v, r) => { app.setWxOver(s.key, v); r.classList.add('over'); });
      ui.wxRows.set(s.key, row);
      ws.append(row);
    }
  }
  ui.buildWeather = buildWeather;
  $('wxReset').addEventListener('click', () => { app.clearWxOver(); for (const r of ui.wxRows.values()) r.classList.remove('over'); });
  ui.syncSky = (wxNow) => {
    todRow.value = app.tod; todV.textContent = todText(app.tod);
    sp.value = app.todSpeed; $('todSpeedV').textContent = spText(app.todSpeed);
    $('todPlay').textContent = app.playing ? 'Pause' : 'Play';
    $('season').value = app.season; $('seasonV').textContent = seasonNames[Math.floor(((app.season + 0.125) % 1) * 4)];
    $('latitude').value = app.latitude; $('latitudeV').textContent = app.latitude.toFixed(0) + '°';
    for (const b of doc.querySelectorAll('#wxChips button')) b.classList.toggle('on', b.dataset.id === app.weatherId);
    $('dockTimeV').textContent = todText(app.tod);
    $('dockWxV').textContent = wxShort((ui.wxList || []).find(w => w.id === app.weatherId) || { id: app.weatherId });
    if (wxNow) for (const [k, row] of ui.wxRows) if (!(k in app.wxOver) && wxNow[k] !== undefined) row._set(wxNow[k]);
  };
  ui.todText = todText;

  // ── VIEW ──
  const camHints = {
    orbit: 'Drag turns round the ground point, right drag or Shift drag grabs and pans, the wheel zooms to the cursor, a double click flies there. Touch: one finger turns, two fingers pan, pinch and twist, a double tap flies there.',
    fly: 'W A S D move, E or Space up, Q or C down, Shift boosts, L turns mouse look on. Touch: a left stick moves, one finger looks.',
    drone: 'A smooth flight along the ridges and rivers. Drag to take over, R resumes the flight.',
  };
  for (const b of doc.querySelectorAll('#camSeg button')) b.addEventListener('click', () => app.setCam(b.dataset.cam));
  $('droneRidge').addEventListener('click', () => app.drone('ridge'));
  $('droneRiver').addEventListener('click', () => app.drone('river'));
  $('dockTime').addEventListener('click', () => {
    // step through dawn, morning, noon, golden hour, dusk, night
    const marks = [0.25, 0.33, 0.5, 0.7, 0.75, 0.95];
    const next = marks.find(m => m > app.tod + 0.01) ?? marks[0];
    app.setTod(next);
  });
  function buildQuality(Q) {
    const qs = $('qualSeg'); qs.textContent = '';
    Q.forEach((q, i) => { const b = el('button', '', q.label); b.type = 'button'; b.dataset.q = i; b.addEventListener('click', () => app.setQuality(i)); qs.append(b); });
    const lt = $('layerToggles'); lt.textContent = '';
    for (const l of LAYERS) {
      const b = el('button', '', l.label); b.type = 'button'; b.dataset.layer = l.key;
      b.addEventListener('click', () => app.setLayer(l.key, !app.layers[l.key]));
      lt.append(b);
    }
  }
  ui.buildQuality = buildQuality;
  const look = (id, f, fmt) => {
    const inp = $(id);
    inp.addEventListener('input', () => { f(+inp.value); $(id + 'V').textContent = fmt(+inp.value); });
    return () => { $(id + 'V').textContent = fmt(+inp.value); };
  };
  const evSync = look('ev', v => app.setLook('ev', v), v => (v > 0 ? '+' : '') + v.toFixed(2) + ' EV');
  const blSync = look('bloom', v => app.setLook('bloom', v), v => v.toFixed(3));
  const fovSync = look('fov', v => app.setLook('fov', v), v => v.toFixed(0) + '°');
  // light shafts (SKY render/weather.js shaftPlan): mode and strength
  const shaftSync = look('shaftK', v => app.setLook('shaftK', v), v => v.toFixed(2) + ' x');
  for (const b of doc.querySelectorAll('#shaftSeg button')) b.addEventListener('click', () => { app.setLook('shafts', b.dataset.shafts); ui.syncView(); });
  ui.syncView = () => {
    for (const b of doc.querySelectorAll('#camSeg button')) b.classList.toggle('on', b.dataset.cam === app.camMode);
    for (const b of doc.querySelectorAll('#qualSeg button')) b.classList.toggle('on', +b.dataset.q === app.qualityIndex);
    for (const b of doc.querySelectorAll('#layerToggles button')) b.setAttribute('aria-pressed', String(!!app.layers[b.dataset.layer]));
    $('camHint').textContent = camHints[app.camMode] || '';
    evSync(); blSync(); fovSync(); shaftSync();
    for (const b of doc.querySelectorAll('#shaftSeg button')) b.classList.toggle('on', b.dataset.shafts === ((app.look && app.look.shafts) || 'auto'));
  };

  // credits
  $('creditsBtn').addEventListener('click', () => { $('credits').hidden = false; app.loadCredits && app.loadCredits(); });
  $('creditsClose').addEventListener('click', () => { $('credits').hidden = true; });

  // ── PROGRESS ──
  const pg = $('progress'), pgStages = $('pgStages');
  for (const [id, label] of STAGES) { const li = el('li', '', label); li.dataset.id = id; pgStages.append(li); }
  ui.setProgress = p => {
    pg.hidden = false; pg.classList.remove('done'); body.classList.add('has-progress');
    $('pgLabel').textContent = p.label || p.stage || 'Generating';
    const f = Math.max(0, Math.min(1, p.frac || 0));
    $('pgPct').textContent = Math.round(f * 100) + '%';
    $('pgFill').style.width = (f * 100).toFixed(1) + '%';
    const idx = STAGES.findIndex(s => s[0] === p.stage);
    pgStages.querySelectorAll('li').forEach((li, i) => { li.classList.toggle('on', i === idx); li.classList.toggle('done', idx >= 0 && i < idx); });
    $('genBtn').disabled = false;
  };
  ui.progressDone = (text) => {
    $('pgLabel').textContent = text || 'Done';
    $('pgPct').textContent = '100%'; $('pgFill').style.width = '100%';
    pgStages.querySelectorAll('li').forEach(li => { li.classList.remove('on'); li.classList.add('done'); });
    pg.classList.add('done'); body.classList.remove('has-progress');
    setTimeout(() => { if (pg.classList.contains('done')) pg.hidden = true; }, 900);
  };

  // ── MAP ── (map-view.js: the inset at the device pixel ratio, and the
  // large map that a click, Enter or M opens)
  const mapEl = $('map');
  const mv = mountMapView({ doc, win, app, phoneQ: mq, toast: t => ui.toast && ui.toast(t) });
  ui.mapView = mv;
  ui.setTerrainMap = (snap, BIOMES, terrain) => {
    if (!snap || !snap.height) return;
    mv.setTerrain(snap, BIOMES, terrain);
    const ws = snap.worldSize || 1;
    $('mapCap').textContent = `${(ws / 1000).toFixed(0)} km · ${snap.n}² · ${snap.stage || ''}`.replace(/ · $/, '');
  };
  ui.drawMap = cam => mv.tick(cam);
  ui.mapCovers = () => mv.covers();
  $('mapToggle').addEventListener('click', () => {
    const min = mapEl.classList.toggle('min');
    $('mapToggle').textContent = min ? '+' : '–';
    $('mapToggle').setAttribute('aria-label', min ? 'Show the map' : 'Hide the map');
  });
  ui.mapRect = () => mapEl.getBoundingClientRect();

  // ── messages ──
  let toastT = 0;
  ui.toast = text => {
    const t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  };
  const notes = [];
  ui.notice = text => {
    if (notes.includes(text)) return;
    notes.push(text);
    const n = $('notice'); n.textContent = notes.join(' · '); n.hidden = false;
    setTimeout(() => { n.hidden = true; }, 12000);
  };
  ui.status = (a, b, short) => { $('stMain').textContent = short && mq.matches ? short : a; $('stRight').textContent = b || ''; };

  // ── BUILD: the "Watch it build" toggle and bar ──
  // #buildBtn (panel, Terrain tab, so the phone sheet has it too) turns the
  // mode on and off. #build is the bar: the stage name, the caption, the
  // stage bar (one cell per stage, width by its time; a tap jumps there),
  // the scrub, then Prev, Play/Pause, Next, the speed and Close. All
  // targets are 44 px; the bar fits 360 px.
  const bar = $('build'), bdStages = $('bdStages');
  for (let i = 0; i < SEGMENTS.length; i++) {
    const sg = SEGMENTS[i];
    const li = el('li');
    const b = el('button', '', sg.label);
    b.type = 'button'; b.dataset.i = String(i);
    b.setAttribute('aria-label', `Stage ${i + 1}: ${sg.name}`);
    b.title = sg.name;
    li.style.flexGrow = String(sg.dur);
    const fill = el('i');
    li.append(fill, b);
    b.addEventListener('click', () => app.build.seekSeg(i));
    bdStages.append(li);
  }
  $('bdPlay').addEventListener('click', () => app.build.play());
  $('bdPrev').addEventListener('click', () => app.build.step(-1));
  $('bdNext').addEventListener('click', () => app.build.step(1));
  $('bdSpeed').addEventListener('click', () => app.build.speed());
  $('bdClose').addEventListener('click', () => app.build.close());
  const scrub = $('bdScrub');
  scrub.addEventListener('input', () => app.build.seekFrac(+scrub.value / +scrub.max));
  $('buildBtn').addEventListener('click', () => app.setBuildMode(!app.buildMode));
  ui.syncBuild = () => {
    const b = $('buildBtn');
    b.setAttribute('aria-pressed', String(!!app.buildMode));
    b.classList.toggle('on', !!app.buildMode);
  };
  ui.buildShow = on => {
    bar.hidden = !on;
    body.classList.toggle('building', !!on);
    if (on) { $('progress').hidden = true; if (mq.matches) setPanel(false); }
    if (app.onLayout) app.onLayout();
  };
  let lastCap = '';
  ui.buildSync = info => {
    if (!info) return;
    if (bar.hidden) ui.buildShow(true);
    $('bdStage').textContent = info.held ? info.name + ' · computing' : info.name;
    if (info.caption !== lastCap) { lastCap = info.caption; $('bdCap').textContent = info.caption; }
    const m = Math.floor(info.t / 60), sec = Math.floor(info.t % 60);
    $('bdTime').textContent = `${info.i + 1}/${SEGMENTS.length} · ${m}:${String(sec).padStart(2, '0')}`;
    const play = $('bdPlay');
    const icon = info.ended ? '↻' : info.playing ? '❚❚' : '▶';
    if (play.textContent !== icon) play.textContent = icon;
    play.setAttribute('aria-label', info.ended ? 'Play the build again' : info.playing ? 'Pause' : 'Play');
    $('bdSpeed').textContent = (info.speed % 1 ? info.speed.toFixed(1) : info.speed) + '×';
    if (doc.activeElement !== scrub) scrub.value = String(Math.round(info.t / info.total * +scrub.max));
    bdStages.querySelectorAll('li').forEach((li, i) => {
      const t0 = segStart(i), d = SEGMENTS[i].dur;
      const f = Math.max(0, Math.min(1, (info.t - t0) / d));
      li.firstChild.style.width = (f * 100).toFixed(1) + '%';
      li.classList.toggle('on', i === info.i);
      li.classList.toggle('done', i < info.i || info.ended);
    });
  };
  ui.syncBuild();

  // ── HINT: "tap to explore", one time per browser, on a phone ──
  ui.hintOnce = () => {
    const h = $('hint');
    if (!mq.matches || !h) return false;
    let seen = false;
    try { seen = win.localStorage.getItem('dla-terrain-tap-hint') === '1'; } catch { /* private mode */ }
    if (seen) return false;
    try { win.localStorage.setItem('dla-terrain-tap-hint', '1'); } catch { /* private mode */ }
    h.textContent = 'Tap to explore · one finger turns · two fingers pan, pinch and twist · double tap flies there';
    h.classList.add('once'); h.classList.remove('gone');
    setTimeout(() => h.classList.add('gone'), 8000);
    return true;
  };
  return ui;
}

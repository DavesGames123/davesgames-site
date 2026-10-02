// main.js - the Game of Life page: view, tools, controls, frame loop.
//
// The engine (engine-gpu.js, or engine-cpu.js when WebGPU is missing) holds
// the world. This module keeps the view and the UI state in S, turns pointer
// input into cell edits, and calls engine.step() from the frame loop.
//
// VIEW. S.view.cx, S.view.cy is the world cell at the view center, and
// S.view.cell is CSS px per cell. The panels cover parts of the canvas, so
// occlusion() measures them and the view center moves to the center of the
// clear part (ox, oy, eased). A screen point maps to a cell with
//   x = cx + (clientX - innerWidth / 2 - ox) / cell
// render.wgsl does the same sum in device px.
//
// SPEED. The speed slider picks generations per second from SPEEDS. Each
// frame adds dt * speed to a carry and runs the whole part of it, in one
// command buffer, up to MAX_PER_FRAME. Above that cap the carry drops, so a
// slow GPU runs slower and does not fall behind.
//
// GREP MAP
//   grep -n 'function boot'          engine choice and first world
//   grep -n 'function frame'         the frame loop and the speed control
//   grep -n 'function bindPointer'   draw, stamp, pan, pinch, wheel
//   grep -n 'function stampCells'    the selected pattern after rotate and flip
//   grep -n 'function buildLibrary'  the grouped pattern list
//   grep -n 'function loadPattern'   clear, place one pattern, frame it
//   grep -n 'function setRule'       the rule picker and the custom field
//   grep -n 'function bindKeys'      keyboard shortcuts
//   grep -n 'function occlusion'     the overlay margins that frame the view
//   grep -n 'function teardown'      pagehide: stop the loop, free the GPU
//   grep -n 'window.snSaver'         the shell screensaver hook
import { createGpuEngine } from './engine-gpu.js';
import { createCpuEngine } from './engine-cpu.js';
import * as L from './life.js';
import { PATTERNS, CLASSES } from './patterns.js';
import { initLearn } from './learn.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE_Q = matchMedia('(pointer:coarse)');
const SPEEDS = [1, 2, 4, 6, 10, 15, 30, 60, 120, 250, 500, 1000, 2000, 4000, 8000];
const MAX_CELL = 48;
const PAT = Object.fromEntries(PATTERNS.map(p => [p.id, p]));
const CLS = Object.fromEntries(CLASSES.map(c => [c.id, c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const S = {
  engine: null, W: 1024, H: 1024,
  rule: L.parseRule('B3/S23'), ruleName: 'Life', wrap: true,
  running: true, speedIdx: 6, density: 0.3, seed: (Date.now() & 0xffff) || 1,
  gen: 0, carry: 0, maxPerFrame: 160,
  stats: { pop: 0, births: 0, deaths: 0 }, hist: [],
  view: { cx: 512, cy: 512, cell: 3 }, occ: { l: 0, r: 0, t: 0, b: 0 },
  tool: 'draw', pat: 'glider', rot: 0, flip: false,
  age: true, trails: true, grid: true,
  hover: null, dirty: true, ovDirty: true, countDue: false,
};

// ------------------------------------------------------------------ toast
let toastTimer = 0;
function toast(msg, err = false, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------ view math
function offset() { return [(S.occ.l - S.occ.r) / 2, (S.occ.t - S.occ.b) / 2]; }
function toCell(clientX, clientY) {
  const [ox, oy] = offset();
  return [S.view.cx + (clientX - innerWidth / 2 - ox) / S.view.cell, S.view.cy + (clientY - innerHeight / 2 - oy) / S.view.cell];
}
function clearArea() {
  return [Math.max(80, innerWidth - S.occ.l - S.occ.r), Math.max(80, innerHeight - S.occ.t - S.occ.b)];
}
function fitCell() { const [w, h] = clearArea(); return Math.min(w / S.W, h / S.H) * 0.96; }
function minCell() { return Math.min(0.5, fitCell() * 0.7); }
function clampView() {
  S.view.cell = clamp(S.view.cell, minCell(), MAX_CELL);
  S.view.cx = clamp(S.view.cx, 0, S.W);
  S.view.cy = clamp(S.view.cy, 0, S.H);
  S.dirty = S.ovDirty = true;
}
function zoomAt(clientX, clientY, factor) {
  const [wx, wy] = toCell(clientX, clientY);
  const [ox, oy] = offset();
  S.view.cell = clamp(S.view.cell * factor, minCell(), MAX_CELL);
  S.view.cx = wx - (clientX - innerWidth / 2 - ox) / S.view.cell;
  S.view.cy = wy - (clientY - innerHeight / 2 - oy) / S.view.cell;
  clampView();
}
function fitWorld() { S.view.cx = S.W / 2; S.view.cy = S.H / 2; S.view.cell = fitCell(); clampView(); }
function zoomCenter(f) { const [ox, oy] = offset(); zoomAt(innerWidth / 2 + ox, innerHeight / 2 + oy, f); }

// Overlay margins in CSS px. An overlay wider than tall (relative to the
// window) covers the top or the base. Any other overlay covers a side. It
// counts only when it spans 40% of that edge or more.
let OVERLAYS = [];
function occlusion() {
  const w = innerWidth, h = innerHeight, o = { l: 0, r: 0, t: 0, b: 0 };
  for (const el of OVERLAYS) {
    if (el.hidden) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.4) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.4) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  return o;
}

// --------------------------------------------------------------- render
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (S.engine) S.engine.resize(w, h);
  const ov = $('ov');
  if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
  S.dirty = S.ovDirty = true;
}
function render() {
  if (!S.engine) return;
  const [ox, oy] = offset();
  S.engine.render({
    cx: S.view.cx, cy: S.view.cy, cell: S.view.cell * dpr, ox: ox * dpr, oy: oy * dpr,
    mode: S.age ? 'age' : 'plain', trails: S.trails, grid: S.grid,
  });
}

// The overlay shows the stamp preview, or the cell under the mouse.
function drawOverlay() {
  const ov = $('ov'), g = ov.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, ov.width, ov.height);
  if (!S.hover) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [ox, oy] = offset(), c = S.view.cell;
  const sx = x => innerWidth / 2 + ox + (x - S.view.cx) * c, sy = y => innerHeight / 2 + oy + (y - S.view.cy) * c;
  const hx = Math.floor(S.hover[0]), hy = Math.floor(S.hover[1]);
  if (S.tool === 'stamp') {
    const { cells, w, h } = stampCells(), x0 = hx - (w >> 1), y0 = hy - (h >> 1);
    const s = Math.max(c, 1.5);
    g.fillStyle = 'rgba(255,214,110,0.78)';
    for (const [x, y] of cells) g.fillRect(sx(x0 + x), sy(y0 + y), s, s);
    g.strokeStyle = 'rgba(255,214,110,0.55)'; g.setLineDash([4, 4]); g.lineWidth = 1;
    g.strokeRect(sx(x0) - 2.5, sy(y0) - 2.5, w * c + 5, h * c + 5);
    g.setLineDash([]);
  } else if (S.tool === 'draw' && c >= 4 && S.hoverMouse) {
    g.strokeStyle = 'rgba(127,227,189,0.85)'; g.lineWidth = 1.5;
    g.strokeRect(sx(hx) + 0.75, sy(hy) + 0.75, c - 1.5, c - 1.5);
  }
}

// --------------------------------------------------------------- frame
let raf = 0, last = 0, rateGens = 0, rateT = 0, rate = 0, uiT = 0, torn = false;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (S.running && S.engine && !S.engine.lost) {
    S.carry += dt * SPEEDS[S.speedIdx];
    let n = Math.floor(S.carry);
    if (n > S.maxPerFrame) { n = S.maxPerFrame; S.carry = 0; } else S.carry -= n;
    if (n > 0) { S.engine.step(n); S.gen += n; rateGens += n; S.dirty = true; }
  }
  const o = occlusion();
  for (const k in S.occ) {
    const d = o[k] - S.occ[k];
    if (Math.abs(d) > 0.3) { S.occ[k] += d * 0.2; S.dirty = S.ovDirty = true; } else S.occ[k] = o[k];
  }
  if (S.countDue && !S.running && S.engine) { if (S.engine.count()) S.countDue = false; }
  if (S.dirty) { render(); S.dirty = false; }
  if (S.ovDirty) { drawOverlay(); S.ovDirty = false; }
  if (now - rateT > 500) { rate = rateGens / ((now - rateT) / 1000); rateGens = 0; rateT = now; }
  if (now - uiT > 100) { uiT = now; refreshReadout(); }
}
function startLoop() { if (!raf && !torn) { last = performance.now(); raf = requestAnimationFrame(frame); } }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

// ------------------------------------------------------------- readout
// A count() after an edit has no births or deaths, so it keeps the last ones.
function onStats(s) {
  S.stats = s.step ? s : { ...S.stats, pop: s.pop };
  S.hist.push(s.pop);
  if (S.hist.length > 320) S.hist.splice(0, S.hist.length - 320);
}
function setText(id, t) { const el = $(id); if (el && el.textContent !== t) el.textContent = t; }
let sparkN = -1;
function refreshReadout() {
  const st = S.stats;
  setText('rdGen', fmt(S.gen)); setText('rdPop', fmt(st.pop));
  setText('rdBirths', fmt(st.births)); setText('rdDeaths', fmt(st.deaths));
  setText('stGen', 'gen ' + fmt(S.gen)); setText('stPop', 'pop ' + fmt(st.pop));
  setText('stBD', '+' + fmt(st.births) + '  −' + fmt(st.deaths));
  const r = S.running ? (rate >= 100 ? fmt(rate) : rate.toFixed(1)) + ' gen/s' : 'paused';
  setText('rdRate', r); setText('stRate', r + ' · ' + S.W + '² ' + (S.wrap ? 'torus' : 'bounded') + (S.engine && S.engine.kind === 'cpu' ? ' · CPU' : ''));
  if (sparkN !== S.hist.length || S.hist.length >= 320) { sparkN = S.hist.length; drawSpark($('spark'), true); drawSpark($('sparkS'), false); }
}
function drawSpark(cv, labels) {
  if (!cv || !cv.clientWidth) return;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'), H = S.hist;
  g.clearRect(0, 0, w, h);
  if (H.length < 2) { if (labels) setText('sparkLo', ''); return; }
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 4) { hi += 2; lo = Math.max(0, lo - 2); }
  const pad = 3 * dpr, X = i => pad + (w - 2 * pad) * i / (H.length - 1), Y = v => h - pad - (h - 2 * pad) * (v - lo) / (hi - lo);
  g.beginPath(); g.moveTo(X(0), h);
  H.forEach((v, i) => g.lineTo(X(i), Y(v)));
  g.lineTo(X(H.length - 1), h); g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(127,227,189,0.28)'); gr.addColorStop(1, 'rgba(127,227,189,0)');
  g.fillStyle = gr; g.fill();
  g.beginPath(); H.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.strokeStyle = '#7fe3bd'; g.lineWidth = 1.25 * dpr; g.stroke();
  g.fillStyle = '#ffd66e'; g.beginPath(); g.arc(X(H.length - 1), Y(H[H.length - 1]), 2.2 * dpr, 0, 7); g.fill();
  if (labels) setText('sparkLo', fmt(lo) + ' – ' + fmt(hi));
}
function resetHistory() { S.hist = []; S.stats = { pop: 0, births: 0, deaths: 0 }; sparkN = -1; }

// ---------------------------------------------------------- world edits
function clearWorld() {
  S.engine.clear(); S.gen = 0; S.carry = 0; resetHistory(); S.dirty = true;
}
function randomFill() {
  clearWorld();
  S.engine.write(L.randomWorld(S.W, S.H, S.density, S.seed++));
  afterEdit(); S.dirty = true;
}
function afterEdit() { S.countDue = true; S.dirty = true; if (S.running) S.countDue = false; }

// cells: list of [x, y] in world cells; value 1 makes newborns, 0 erases.
function paintCells(cells, value) {
  const out = new Uint32Array(cells.length * 2);
  let n = 0;
  for (let [x, y] of cells) {
    if (x < 0 || y < 0 || x >= S.W || y >= S.H) {
      if (!S.wrap) continue;
      x = ((x % S.W) + S.W) % S.W; y = ((y % S.H) + S.H) % S.H;
    }
    out[n++] = y * S.W + x; out[n++] = value;
  }
  if (n) { S.engine.paint(out.subarray(0, n)); afterEdit(); }
}
// Every cell on the line from a to b (Bresenham).
function lineCells(a, b) {
  const out = [];
  let [x0, y0] = a; const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let k = 0; k < 4096; k++) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

// --------------------------------------------------------------- stamp
let stampCache = null;
function stampCells() {
  const k = S.pat + '|' + S.rot + '|' + S.flip;
  if (!stampCache || stampCache.k !== k) {
    const cells = L.orient(L.parseRLE(PAT[S.pat].rle), S.rot, S.flip), b = L.bounds(cells);
    stampCache = { k, cells, w: b.w, h: b.h };
  }
  return stampCache;
}
function placeStamp(cx, cy) {
  const { cells, w, h } = stampCells(), x0 = Math.floor(cx) - (w >> 1), y0 = Math.floor(cy) - (h >> 1);
  paintCells(cells.map(([x, y]) => [x0 + x, y0 + y]), 1);
}
// Clear the world, put one pattern in the middle, and frame it.
const VIEW_CELLS = { still: 18, osc: 26, ship: 70, gun: 110, meth: 220, growth: 300 };
function loadPattern(id) {
  selectPattern(id, false);
  S.rot = 0; S.flip = false; stampCache = null;
  clearWorld();
  placeStamp(S.W / 2, S.H / 2);
  const { w, h } = stampCells(), [aw, ah] = clearArea();
  const span = Math.max(VIEW_CELLS[PAT[id].cls] || 40, Math.max(w, h) + 12);
  S.view.cx = S.W / 2; S.view.cy = S.H / 2;
  S.view.cell = clamp(Math.min(aw, ah) / span, minCell(), 28);
  clampView();
  S.engine.count();
  setRunning(true);
  refreshPatCard();
}

// ---------------------------------------------------------- pattern UI
function thumb(cv, cells, fg = '#7fe3bd') {
  const b = L.bounds(cells), W = cv.width, H = cv.height, g = cv.getContext('2d');
  g.fillStyle = '#06080b'; g.fillRect(0, 0, W, H);
  const s = Math.max(0.5, Math.min((W - 6) / b.w, (H - 6) / b.h, W / 5));
  const ox = (W - b.w * s) / 2, oy = (H - b.h * s) / 2;
  g.fillStyle = fg;
  const gap = s >= 4 ? 1 : 0;
  for (const [x, y] of cells) g.fillRect(ox + x * s, oy + y * s, Math.max(1, s - gap), Math.max(1, s - gap));
}
function patSub(p) {
  const who = [p.by, p.year || ''].filter(Boolean).join(', ');
  return CLS[p.cls].name.replace(/s$/, '').replace('Guns and puffer', 'Gun or puffer') + (who ? ' · ' + who : '');
}
function refreshPatCard() {
  const p = PAT[S.pat], cv = $('patThumb');
  cv.width = cv.height = Math.round(56 * dpr);
  thumb(cv, stampCells().cells, '#ffd66e');
  setText('patName', p.name);
  $('patSub').textContent = patSub(p) + (S.rot || S.flip ? ' · turned ' + S.rot * 90 + '°' + (S.flip ? ', mirrored' : '') : '');
  setText('dockPatName', p.name);
  document.querySelectorAll('.lib-item').forEach(el => el.classList.toggle('on', el.dataset.id === S.pat));
  S.ovDirty = true;
}
function selectPattern(id, useStamp = true) {
  S.pat = id; S.rot = 0; S.flip = false; stampCache = null;
  if (useStamp) setTool('stamp');
  refreshPatCard();
}
function buildLibrary() {
  const lib = $('library');
  for (const c of CLASSES) {
    const head = document.createElement('div');
    head.className = 'lib-cls';
    const n = PATTERNS.filter(p => p.cls === c.id).length;
    head.innerHTML = `<span>${c.name}</span><small>${n}</small>`;
    head.title = c.blurb;
    lib.appendChild(head);
    for (const p of PATTERNS.filter(q => q.cls === c.id)) {
      const item = document.createElement('div');
      item.className = 'lib-item'; item.dataset.id = p.id;
      const pick = document.createElement('button');
      pick.className = 'lib-pick';
      pick.title = 'Stamp ' + p.name;
      const cv = document.createElement('canvas');
      cv.width = cv.height = Math.round(38 * Math.min(window.devicePixelRatio || 1, 2));
      thumb(cv, L.parseRLE(p.rle));
      const who = [p.by, p.year || ''].filter(Boolean).join(', ');
      const txt = document.createElement('div');
      txt.className = 'lib-txt';
      txt.innerHTML = `<div class="lib-name"></div>${who ? '<div class="lib-by"></div>' : ''}<div class="lib-desc"></div>`;
      txt.querySelector('.lib-name').textContent = p.name;
      if (who) txt.querySelector('.lib-by').textContent = who;
      txt.querySelector('.lib-desc').textContent = p.desc;
      pick.append(cv, txt);
      pick.addEventListener('click', () => {
        selectPattern(p.id, true);
        if (PHONE_Q.matches) { setPanel(false); toast('Tap the world to place the ' + p.name + '. Drag to move it first.'); }
      });
      const load = document.createElement('button');
      load.className = 'lib-load'; load.textContent = '▶';
      load.title = 'Clear the world and run ' + p.name + ' alone';
      load.setAttribute('aria-label', 'Load ' + p.name + ' alone');
      load.addEventListener('click', () => { loadPattern(p.id); if (PHONE_Q.matches) setPanel(false); });
      item.append(pick, load);
      lib.appendChild(item);
    }
  }
}

// ---------------------------------------------------------------- rules
function setRule(str, name) {
  const r = L.parseRule(str);
  if (!r) return false;
  S.rule = r;
  const preset = L.RULES.find(q => q.str === r.str);
  S.ruleName = preset ? preset.name : (name || 'Custom rule');
  if (S.engine) S.engine.setRule(r.birth, r.survive);
  setText('ruleStr', r.str); setText('ruleName', S.ruleName); setText('stRule', r.str);
  $('ruleNote').textContent = preset ? preset.note : 'Birth on ' + (r.str.split('/')[0].slice(1).split('').join(', ') || 'no count') + '. Survival on ' + (r.str.split('/')[1].slice(1).split('').join(', ') || 'no count') + '.';
  document.querySelectorAll('#rules button').forEach(b => b.classList.toggle('on', b.dataset.rule === r.str));
  $('ruleIn').classList.remove('bad');
  return true;
}
function buildRules() {
  const box = $('rules');
  for (const r of L.RULES) {
    const b = document.createElement('button');
    b.dataset.rule = r.str; b.textContent = r.name; b.title = r.str + ' · ' + r.note;
    b.addEventListener('click', () => { setRule(r.str); $('ruleIn').value = ''; });
    box.appendChild(b);
  }
  const go = () => {
    const v = $('ruleIn').value;
    if (!setRule(v)) { $('ruleIn').classList.add('bad'); toast('Write the rule as B, the birth counts, then /S and the survival counts. For example B36/S23.', true, 4500); }
    else { $('ruleIn').blur(); toast('Rule ' + S.rule.str); }
  };
  $('ruleGo').addEventListener('click', go);
  $('ruleIn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); e.stopPropagation(); });
  $('ruleIn').addEventListener('input', () => $('ruleIn').classList.remove('bad'));
}

// ---------------------------------------------------------- run controls
function setRunning(on) {
  S.running = on; S.carry = 0;
  const pb = $('playBtn'), dp = $('dockPlay');
  pb.textContent = on ? '❚❚ Pause' : '▶ Play'; pb.classList.toggle('paused', !on);
  dp.textContent = on ? '❚❚' : '▶'; dp.classList.toggle('paused', !on);
  dp.setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (!on) S.countDue = true;
}
function stepOnce() { setRunning(false); S.engine.step(1); S.gen += 1; S.dirty = true; S.countDue = false; }
const TOOL_HINT = {
  draw: 'Click or drag to draw. Start on a live cell to erase. Right drag or Shift drag pans. The wheel zooms.',
  stamp: 'The pattern follows the pointer. Click to place it. Q rotates and F mirrors. A drag pans.',
  pan: 'Drag to move the view. The wheel or a pinch zooms.',
};
const TOOL_HINT_TOUCH = {
  draw: 'One finger draws. Start on a live cell to erase. Two fingers zoom and pan.',
  stamp: 'Touch to see the pattern, drag to move it, lift to place it. Two fingers zoom and pan.',
  pan: 'One finger moves the view. Two fingers zoom.',
};
const TOOL_ICON = { draw: '✎', stamp: '◫', pan: '✥' }, TOOL_NAME = { draw: 'Draw', stamp: 'Stamp', pan: 'Pan' };
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('toolHint').textContent = (COARSE_Q.matches ? TOOL_HINT_TOUCH : TOOL_HINT)[t];
  const dt = $('dockTool');
  dt.querySelector('.ic').textContent = TOOL_ICON[t]; dt.querySelector('.lb').textContent = TOOL_NAME[t];
  dt.setAttribute('aria-label', 'Tool: ' + TOOL_NAME[t]);
  $('gl').style.cursor = t === 'pan' ? 'grab' : t === 'stamp' ? 'copy' : 'crosshair';
  if (t !== 'stamp' && !S.hoverMouse) S.hover = null;
  S.ovDirty = true;
}
function setWorldSize(n) {
  S.W = S.H = n;
  S.engine.setWorld(n, n);
  S.engine.setRule(S.rule.birth, S.rule.survive);
  S.engine.setWrap(S.wrap);
  $('sizeSel').value = String(n);
  resetHistory(); S.gen = 0;
  fitWorld();
}
function setPanel(open) {
  const p = $('panel');
  p.classList.toggle('open', open);
  if (!open) p.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  if (open && PHONE_Q.matches) setLearn(false);
}
let learnCtl = null;
function setLearn(open) {
  const l = $('learn');
  if (open) l.hidden = false;
  l.classList.toggle('open', open);
  document.body.classList.toggle('learn-open', open);
  $('learnBtn').setAttribute('aria-expanded', String(open));
  $('dockLearn').classList.toggle('on', open);
  $('dockLearn').setAttribute('aria-expanded', String(open));
  if (open && PHONE_Q.matches) setPanel(false);
  if (learnCtl) learnCtl.setVisible(open);
}

function buildUI() {
  $('playBtn').addEventListener('click', () => setRunning(!S.running));
  $('dockPlay').addEventListener('click', () => setRunning(!S.running));
  $('stepBtn').addEventListener('click', stepOnce);
  $('dockStep').addEventListener('click', stepOnce);
  $('clearBtn').addEventListener('click', () => { clearWorld(); toast('Cleared. Draw cells or stamp a pattern.'); });
  $('randomBtn').addEventListener('click', randomFill);
  const speed = $('speed');
  const showSpeed = () => { S.speedIdx = +speed.value; setText('speedV', fmt(SPEEDS[S.speedIdx]) + '/s'); };
  speed.addEventListener('input', showSpeed);
  speed.value = String(S.speedIdx); showSpeed();
  const dens = $('density');
  const showDens = () => { S.density = +dens.value; setText('densityV', Math.round(S.density * 100) + '%'); };
  dens.addEventListener('input', showDens); dens.addEventListener('change', randomFill);
  dens.value = String(S.density); showDens();
  $('sizeSel').addEventListener('change', e => { setWorldSize(+e.target.value); randomFill(); });
  $('wrapBtn').addEventListener('click', () => {
    S.wrap = !S.wrap; S.engine.setWrap(S.wrap);
    $('wrapBtn').textContent = S.wrap ? 'Wrap · on' : 'Wrap · off';
    $('wrapBtn').classList.toggle('on', S.wrap);
    $('wrapBtn').title = S.wrap ? 'Edges join, the world is a torus' : 'Cells past the edge are dead';
  });
  document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('dockTool').addEventListener('click', () => setTool({ draw: 'pan', pan: 'stamp', stamp: 'draw' }[S.tool]));
  $('rotBtn').addEventListener('click', () => { S.rot = (S.rot + 1) % 4; stampCache = null; refreshPatCard(); setTool('stamp'); });
  $('flipBtn').addEventListener('click', () => { S.flip = !S.flip; stampCache = null; refreshPatCard(); setTool('stamp'); });
  $('loadBtn').addEventListener('click', () => { loadPattern(S.pat); if (PHONE_Q.matches) setPanel(false); });
  const toggle = (id, key, onTxt) => $(id).addEventListener('click', () => {
    S[key] = !S[key]; $(id).classList.toggle('on', S[key]); S.dirty = true;
    if (key === 'age') $('ageKey').classList.toggle('off', !S.age);
  });
  toggle('ageBtn', 'age'); toggle('trailBtn', 'trails'); toggle('gridBtn', 'grid');
  $('fitBtn').addEventListener('click', fitWorld);
  $('zoomInBtn').addEventListener('click', () => zoomCenter(1.5));
  $('zoomOutBtn').addEventListener('click', () => zoomCenter(1 / 1.5));

  $('gear').addEventListener('click', () => setPanel(true));
  $('panelClose').addEventListener('click', () => setPanel(false));
  $('dockPanel').addEventListener('click', () => setPanel(!$('panel').classList.contains('open')));
  $('dockPattern').addEventListener('click', () => {
    const p = $('panel');
    if (p.classList.contains('open') && p.classList.contains('full')) { setPanel(false); return; }
    setPanel(true); p.classList.add('full');
    setTimeout(() => { p.scrollTo({ top: $('libLabel').offsetTop - 50, behavior: 'smooth' }); }, 60);
  });
  $('learnBtn').addEventListener('click', () => setLearn(true));
  $('learnClose').addEventListener('click', () => setLearn(false));
  $('dockLearn').addEventListener('click', () => setLearn(!$('learn').classList.contains('open')));
  // The Lenia link: inside the site shell, switch the tab in place.
  $('leniaLink').addEventListener('click', e => {
    try { if (window.parent !== window && typeof window.parent.switchTab === 'function') { e.preventDefault(); window.parent.switchTab('lenia'); } } catch (_) {}
  });

  // The grip of the phone sheet. A tap switches half and full height. A drag
  // up gives full height. A drag down gives half height, then closes.
  const grip = $('sheetGrip'), panel = $('panel');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (_) {} });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setPanel(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  setPanel(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => { setPanel(!e.matches); if (e.matches) setLearn(false); });
}

// ------------------------------------------------------------- pointer
function bindPointer() {
  const cv = $('gl'), ptrs = new Map();
  let gest = null;
  const cellOf = e => toCell(e.clientX, e.clientY);
  const pinchInfo = () => {
    const [a, b] = [...ptrs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  function startDraw(g, at) {
    g.pending = false;
    const c0 = [Math.floor(at[0]), Math.floor(at[1])];
    g.last = null; g.queue = [c0]; g.val = null;
    const inside = c0[0] >= 0 && c0[1] >= 0 && c0[0] < S.W && c0[1] < S.H;
    const ready = v => {
      if (g.cancel) return;
      g.val = (v & 0xff) ? 0 : 1;
      for (const c of g.queue) addDraw(g, c);
      g.queue = null;
    };
    if (!inside) { ready(0); return; }
    S.engine.readCell(c0[0], c0[1]).then(ready, () => ready(0));
  }
  function addDraw(g, c) {
    if (g.val === null) { g.queue.push(c); return; }
    const cells = g.last ? lineCells(g.last, c) : [c];
    g.last = c;
    paintCells(cells, g.val);
  }
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      if (gest && gest.kind === 'draw' && gest.pending) gest.cancel = true;
      gest = { kind: 'pinch', ...pinchInfo() };
      if (S.tool === 'stamp') { S.hover = null; S.ovDirty = true; }
      return;
    }
    if (ptrs.size > 2) return;
    const touch = e.pointerType !== 'mouse';
    if (e.button === 1 || e.button === 2 || e.shiftKey || S.tool === 'pan') {
      gest = { kind: 'pan', x: e.clientX, y: e.clientY };
      cv.style.cursor = 'grabbing';
    } else if (S.tool === 'draw') {
      gest = { kind: 'draw', pending: touch, t0: performance.now(), x0: e.clientX, y0: e.clientY, at: cellOf(e) };
      if (!touch) startDraw(gest, gest.at);
    } else {
      gest = { kind: 'stamp', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch };
      S.hover = cellOf(e); S.ovDirty = true;
    }
  });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { S.hover = cellOf(e); S.hoverMouse = true; S.ovDirty = true; }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (!gest) return;
    if (gest.kind === 'pinch' && ptrs.size === 2) {
      const q = pinchInfo();
      if (gest.d > 0 && q.d > 0) zoomAt(q.mx, q.my, q.d / gest.d);
      S.view.cx -= (q.mx - gest.mx) / S.view.cell; S.view.cy -= (q.my - gest.my) / S.view.cell;
      clampView();
      Object.assign(gest, q);
    } else if (gest.kind === 'pan') {
      S.view.cx -= (e.clientX - gest.x) / S.view.cell; S.view.cy -= (e.clientY - gest.y) / S.view.cell;
      gest.x = e.clientX; gest.y = e.clientY;
      clampView();
    } else if (gest.kind === 'draw') {
      const at = cellOf(e);
      if (gest.pending) {
        if (Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) > 6 || performance.now() - gest.t0 > 90) startDraw(gest, gest.at);
        else return;
      }
      addDraw(gest, [Math.floor(at[0]), Math.floor(at[1])]);
      if (e.pointerType === 'mouse') { S.hover = at; S.hoverMouse = true; S.ovDirty = true; }
    } else if (gest.kind === 'stamp') {
      if (!gest.touch && Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) > 6) {
        gest = { kind: 'pan', x: e.clientX, y: e.clientY };
        return;
      }
      S.hover = cellOf(e); S.ovDirty = true;
    }
  });
  const end = e => {
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!had || !gest) return;
    if (gest.kind === 'pinch') { if (ptrs.size === 0) gest = null; return; }
    if (e.type === 'pointerup') {
      if (gest.kind === 'draw' && gest.pending) startDraw(gest, gest.at);
      if (gest.kind === 'stamp') {
        const at = cellOf(e);
        placeStamp(at[0], at[1]);
        if (gest.touch) { S.hover = null; } else S.hover = at;
        S.ovDirty = true;
      }
    }
    gest = null;
    setTool(S.tool);
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { S.hover = null; S.hoverMouse = false; S.ovDirty = true; } });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const k = e.ctrlKey ? 0.01 : 0.0018;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(-dy * k));
  }, { passive: false });
  // Safari trackpad pinch.
  let gs = 1;
  cv.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
  cv.addEventListener('gesturechange', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.scale / gs); gs = e.scale; });
}

// ---------------------------------------------------------------- keys
function bindKeys() {
  addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); setRunning(!S.running); }
    else if (k === 'n' || k === 'N' || k === 'ArrowRight') { e.preventDefault(); stepOnce(); }
    else if (k === 'c' || k === 'C') clearWorld();
    else if (k === 'r' || k === 'R') randomFill();
    else if (k === '1') setTool('draw');
    else if (k === '2') setTool('stamp');
    else if (k === '3') setTool('pan');
    else if (k === 'q' || k === 'Q') $('rotBtn').click();
    else if (k === 'f' || k === 'F') $('flipBtn').click();
    else if (k === 'g' || k === 'G') $('gridBtn').click();
    else if (k === '0') fitWorld();
    else if (k === '+' || k === '=') zoomCenter(1.5);
    else if (k === '-' || k === '_') zoomCenter(1 / 1.5);
    else if (k === 'Escape') { if ($('learn').classList.contains('open')) setLearn(false); else if (S.tool !== 'draw') setTool('draw'); }
  });
}

// ------------------------------------------------------------ teardown
function teardown() {
  if (torn) return;
  torn = true; stopLoop();
  if (learnCtl) learnCtl.setVisible(false);
  try { if (S.engine) S.engine.destroy(); } catch (_) {}
}
addEventListener('pagehide', teardown);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); });

// ----------------------------------------------------------------- boot
async function boot() {
  OVERLAYS = ['panel', 'learn', 'dock', 'status'].map($).filter(Boolean);
  const phone = PHONE_Q.matches || COARSE_Q.matches;
  buildRules(); buildLibrary(); buildUI(); bindKeys();
  setRule('B3/S23'); setTool('draw');
  learnCtl = initLearn({ onTry: id => { loadPattern(id); if (PHONE_Q.matches) setLearn(false); } });
  if (!PHONE_Q.matches && innerWidth >= 1280) setLearn(true);
  S.occ = occlusion();
  let size = phone ? 512 : 1024;
  try {
    S.engine = await createGpuEngine($('gl'), { lowPower: phone });
    S.maxPerFrame = phone ? 48 : 160;
    S.engine.onLost = () => toast('The GPU device was lost. Reload the page to start again.', true, 10000);
  } catch (err) {
    if (String(err && err.message) !== 'webgpu-unavailable') console.warn('[life] WebGPU failed, using the CPU', err);
    const old = $('gl'), cv = old.cloneNode(false);
    old.replaceWith(cv);
    S.engine = createCpuEngine(cv);
    size = 256; S.maxPerFrame = 4; S.speedIdx = Math.min(S.speedIdx, 6);
    $('speed').max = '9'; $('speed').value = String(S.speedIdx); $('speed').dispatchEvent(new Event('input'));
    [...$('sizeSel').options].forEach(o => { o.disabled = +o.value > 256; });
    $('cpuNote').hidden = false;
  }
  S.engine.onStats = onStats;
  resize();
  addEventListener('resize', resize);
  bindPointer();
  setWorldSize(size);
  randomFill();
  S.view.cell = clamp(phone ? 4 : 3, minCell(), MAX_CELL);
  clampView();
  refreshPatCard();
  setRunning(true);
  startLoop();
  toast(COARSE_Q.matches ? 'One finger draws. Two fingers zoom and pan. ☰ has the patterns and rules.' : 'Draw on the world, or pick a pattern from the library to stamp it.', false, 4200);
  window.__life = { S, L, loadPattern, setRule, setTool, setRunning, stepOnce, randomFill, clearWorld, fitWorld, zoomAt, toCell, setLearn, setPanel, selectPattern };
}
// ------------------------------------------------------------ screensaver
// Shell screensaver hook (lib/screensaver.js). enter() waits for boot, hides
// every panel (occlusion() then sees no overlay, so the view centres on the
// window), and turns the grid off with age colour and trails on. opts.seed
// seeds a fresh full-frame soup at 3 or 4 px cells. calm above 0.5 runs
// 6 gens/s, else 10/s, so period-2 blinkers do not strobe. A soup lives far
// longer than one dwell, so nothing changes inside one dwell.
window.snSaver = {
  async enter(opts) {
    while (!window.__life) await new Promise(r => setTimeout(r, 50));
    const calm = clamp(+opts.calm || 0, 0, 1), st = document.createElement('style');
    st.textContent = 'html.saver #panel,html.saver #learn,html.saver #dock,html.saver #status,html.saver #toast,html.saver #gear,html.saver #learnBtn,html.saver .topbar,html.saver #cpuNote,html.saver #ov{display:none!important}html.saver #gl{cursor:none}';
    document.head.appendChild(st); document.documentElement.classList.add('saver');
    setPanel(false); setLearn(false); S.hover = null; S.occ = occlusion();
    S.grid = false; S.age = true; S.trails = true;
    S.speedIdx = calm > 0.5 ? 3 : 4;
    S.seed = (opts.seed >>> 0) || 1; randomFill();
    S.view.cell = clamp(3 + (S.seed & 1), minCell(), MAX_CELL); S.view.cx = S.W / 2; S.view.cy = S.H / 2;
    clampView(); setRunning(true);
    resize();
    return { canvas: $('gl'), warmupMs: 1500 };
  },
};

boot();

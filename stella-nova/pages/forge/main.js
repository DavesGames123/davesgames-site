// ============================================================================
//  PLANET FORGE  ·  main.js — the GUI, the camera, the frame loop, downloads
// ----------------------------------------------------------------------------
//  boot: presets + UI -> worker pool -> WebGPU (else the no-GPU note; the
//  maps still generate and download) -> first planet -> frame loop.
//
//  Families: the dice and the seed box draw a new member of the preset's
//  family (presets.js fromPreset) until a slider is moved (S.edited);
//  then they change only the noise seed and keep the edits.
//
//  Generation: any recipe change regenerates. A slider drag first makes a
//  quick preview (512 wide, or less than the chosen width), then the
//  chosen width after 700 ms of quiet. pool.js cancels stale jobs. The
//  chosen width is capped by budget.js pickWidth (phones: 2k at most).
//
//  Camera: an orbit (yaw, pitch, distance) about the planet, drag to turn,
//  wheel or pinch to zoom. Time: clock.js runs a simulated clock at S.rate
//  (simulated seconds per real second, 1 .. 4 days/s, log slider and
//  presets in the Sky tab, a cycle button in the phone dock, the rate and
//  the day count in #clock). The planet spins once per simulated day; the
//  sun goes round in a 30-day year unless "moving sun" is off; the clouds
//  evolve in simulated hours. The planet is framed in the
//  clear area beside the panel or above the sheet: the view shifts its
//  principal point (render.js cam.offX / offY), it does not resize.
//
//  window.__forge exposes the state for saver.js (window.snSaver) and for
//  debugging; adopt(P, M, W) shows a planet the saver generated ahead.
//
//  Phone layout: PHONE_Q is the same media query as the PHONE block of
//  style.css. phone() reads it live, so a tablet in split view or a turned
//  window gets the sheet logic that matches the CSS. ENV.mobile follows it;
//  ENV.coarse (any touch screen) selects the tablet budget.
//
//  grep -n targets: "async function boot", "function regenerate",
//  "function buildShape", "function buildMaps", "function frame",
//  "function clearArea", "function bindPointer", "function downloadZip",
//  "function showClock",
//  "window.__forge"
// ============================================================================
import * as PR from './presets.js';
import { MAP_INFO, mapIds, mapImage, shrinkMaps } from './maps.js';
import { encodePNG } from './png.js';
import { createPool } from './pool.js';
import { createRenderer } from './render.js';
import * as BG from './budget.js';
import * as CK from './clock.js';
import './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:760px), (max-height:520px) and (pointer:coarse)');
const phone = () => PHONE_Q.matches;
const MOBILE = phone();
const ENV = { mobile: MOBILE, coarse: matchMedia('(pointer:coarse)').matches, deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency || 4 };
const S = {
  P: PR.fromPreset('earth'), width: BG.defaultWidth(ENV), M: null, Mw: 0,
  cam: { yaw: 0.6, pitch: 0.22, dist: 3.4 }, sunAz: 50, sunEl: 12, exposure: 0.65,
  moveSun: true, spin: true, clouds: true, atmo: true, spinAngle: 0, t: 0,
  rate: CK.RATE_DEFAULT, clock: CK.createClock(),
  busy: false, tab: 'planet', saver: false, override: null,
};
let pool, device = null, ctx = null, R = null, canvas, format;
let genTimer = 0, fullTimer = 0, lastFrame = 0;

const loadText = name => fetch(new URL('shaders/' + name, import.meta.url)).then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.text(); });
const status = t => { $('status').textContent = t; };
const progress = f => { const el = $('progFill'); el.style.width = Math.round(f * 100) + '%'; el.style.opacity = f >= 1 ? '0' : '1'; };

// ── boot ────────────────────────────────────────────────────────────────
async function boot() {
  canvas = $('view');
  buildPlanetTab(); buildShape(); buildSky(); bindTabs(); bindPointer(); bindView();
  pool = createPool(Math.max(1, Math.min(MOBILE ? 3 : ENV.coarse ? 4 : 8, (navigator.hardwareConcurrency || 4) - 1)));
  try {
    if (!navigator.gpu) throw new Error('no navigator.gpu');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no adapter');
    device = await adapter.requestDevice();
    device.lost.then(i => { if (i.reason !== 'destroyed') console.warn('forge: GPU device lost: ' + i.message); });
    ctx = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    R = await createRenderer({ device, format, loadText });
  } catch (e) {
    console.warn('forge: no WebGPU view:', e.message);
    device = null; R = null; $('nogpu').hidden = false;
  }
  addEventListener('resize', resize); resize();
  PHONE_Q.addEventListener('change', () => { ENV.mobile = phone(); resize(); });
  await regenerate(true);
  requestAnimationFrame(frame);
}

addEventListener('pagehide', () => {
  try { pool && pool.terminate(); } catch (e) {}
  try { R && R.destroy(); } catch (e) {}
  try { device && device.destroy(); } catch (e) {}
});

// ── generation ──────────────────────────────────────────────────────────
async function regenerate(full, width) {
  const W = width || (full ? BG.pickWidth(S.width, ENV) : Math.min(512, BG.pickWidth(S.width, ENV)));
  const P = PR.clone(S.P), t0 = performance.now();
  S.busy = true; status(`generating ${W} × ${W / 2}…`); progress(0.02);
  let M;
  try { M = await pool.generate(P, W, progress); }
  catch (e) { if (e.message !== 'stale') { console.error(e); status('generation failed: ' + e.message); } return null; }
  S.M = M; S.Mw = W; S.Pgen = P; S.busy = false;
  if (R) R.setPlanet(P, M, ENV);
  status(`${P.name} · seed ${P.seed} · ${W} × ${W / 2} · ${Math.round(performance.now() - t0)} ms`);
  $('mapNote').textContent = `${W} × ${W / 2} equirect, ${pool.size || 1} worker${pool.size === 1 ? '' : 's'}. Heights span ${M.reliefKm.toFixed(1)} km. Normals: tangent space, OpenGL (+Y north).`;
  if (S.tab === 'maps' || !phone()) buildMaps();
  return M;
}
// Recipe changed: quick preview now, full width after a quiet moment.
function changed() {
  clearTimeout(genTimer); clearTimeout(fullTimer);
  genTimer = setTimeout(() => regenerate(false), 120);
  fullTimer = setTimeout(() => regenerate(true), 800);
}

// ── planet tab ──────────────────────────────────────────────────────────
function buildPlanetTab() {
  const kindBtns = [...$('kind').children];
  const draw = () => {
    kindBtns.forEach(b => b.classList.toggle('on', b.dataset.kind === S.P.kind));
    $('presets').innerHTML = '';
    for (const pr of PR.PRESETS.filter(p => p.kind === S.P.kind)) {
      const b = document.createElement('button');
      b.textContent = pr.name; b.classList.toggle('on', pr.id === S.P.preset);
      b.onclick = () => choosePreset(pr.id);
      $('presets').appendChild(b);
    }
    const pr = PR.presetById(S.P.preset);
    $('blurb').textContent = pr ? pr.blurb : '';
    $('seed').value = S.P.seed;
  };
  S.drawPlanetTab = draw;
  kindBtns.forEach(b => b.onclick = () => { if (b.dataset.kind !== S.P.kind) choosePreset(PR.PRESETS.find(p => p.kind === b.dataset.kind).id); });
  // a new seed draws a new member of the preset's family (presets.js
  // fromPreset); after a slider edit it changes only the noise seed
  const reseed = seed => {
    if (!S.edited && S.P.preset) { choosePreset(S.P.preset, seed); return; }
    S.P.seed = seed; $('seed').value = seed; changed();
  };
  $('seed').onchange = () => reseed(+$('seed').value >>> 0);
  const dice = () => reseed(Math.floor(Math.random() * 1e6));
  $('dice').onclick = dice; $('dockDice').onclick = dice;
  for (const w of BG.WIDTHS) {
    const o = document.createElement('option'); o.value = w; o.textContent = `${w >= 1024 ? w / 1024 + 'k' : w} (${w} × ${w / 2})`;
    if (BG.pickWidth(w, ENV) < w) { o.disabled = true; o.textContent += ' · over memory budget'; }
    $('res').appendChild(o);
  }
  $('res').value = S.width;
  $('res').onchange = () => { S.width = +$('res').value; regenerate(true); };
  $('gen').onclick = () => regenerate(true);
  $('resNote').textContent = `Budget: ${Math.round(BG.cpuBudget(ENV) / 1e6)} MB for maps; the view uploads at most ${BG.gpuWidth(4096, ENV)} wide.`;
  draw();
}
function choosePreset(id, seed) {
  S.P = PR.fromPreset(id, seed); S.edited = false;
  S.drawPlanetTab(); buildShape(); buildSky();
  regenerate(false).then(() => regenerate(true));
}

// ── shape and sky sliders (from presets.js SCHEMA) ─────────────────────
function sliders(host, rows, onInput) {
  host.innerHTML = '';
  let group = null, box = null;
  for (const [g, path, label, lo, hi, step] of rows) {
    if (g !== group) { group = g; box = document.createElement('details'); box.open = !phone() && host.children.length < 2; box.innerHTML = `<summary>${g}</summary>`; host.appendChild(box); }
    const d = document.createElement('div'); d.className = 'ctl';
    const v = PR.getPath(S.P, path);
    d.innerHTML = `<label>${label} <output></output></label><input type="range" min="${lo}" max="${hi}" step="${step}">`;
    const inp = d.querySelector('input'), out = d.querySelector('output');
    inp.value = v; out.textContent = fmt(v, step);
    inp.oninput = () => { const x = +inp.value; PR.setPath(S.P, path, x); S.edited = true; out.textContent = fmt(x, step); onInput(path); };
    box.appendChild(d);
  }
}
const fmt = (v, step) => step >= 1 ? String(Math.round(v)) : (+v).toFixed(step < 0.01 ? 3 : 2);
function buildShape() {
  sliders($('shapeCtl'), PR.SCHEMA[S.P.kind], path => {
    // rings and the view-only spin do not need new maps
    if (path === 'spin') return;
    if (path.startsWith('rings.') && S.M && R) { R.setPlanet(S.P, S.M, ENV); return; }
    changed();
  });
  $('resetShape').onclick = () => choosePreset(S.P.preset, S.P.seed);
}
function buildSky() {
  sliders($('skyCtl'), PR.SCHEMA.atmo, () => { if (R) R.setAtmo(S.P, S.M ? S.M.stats.meanAlbedo : 0.3); });
}
function bindView() {
  const bind = (id, out, key, f = v => v) => { const el = $(id); const set = () => { S[key] = f(+el.value); $(out).textContent = el.value; }; el.oninput = set; set(); };
  bind('exp', 'oExp', 'exposure'); bind('sunAz', 'oSun', 'sunAz'); bind('sunEl', 'oSunEl', 'sunEl');
  // time rate: a log slider and presets (clock.js)
  const rate = $('rate');
  const setRate = r => { S.rate = r; rate.value = CK.rateToSlider(r); showClock(); };
  rate.oninput = () => { S.rate = CK.sliderToRate(+rate.value); showClock(); };
  for (const p of CK.RATE_PRESETS) {
    const b = document.createElement('button'); b.textContent = p.label; b.onclick = () => setRate(p.rate);
    $('ratePresets').appendChild(b);
  }
  $('dockRate').onclick = () => {
    const i = CK.RATE_PRESETS.findIndex(p => p.rate > S.rate * 1.01);
    setRate(CK.RATE_PRESETS[i < 0 ? 0 : i].rate);
  };
  S.setRate = setRate; setRate(S.rate);
  $('tSun').onchange = e => S.moveSun = e.target.checked;
  $('tSpin').onchange = e => S.spin = e.target.checked;
  $('tClouds').onchange = e => S.clouds = e.target.checked;
  $('tAtmo').onchange = e => { S.atmo = e.target.checked; if (R) R.setAtmo(S.atmo ? S.P : PR.merge(S.P, { atmo: { on: 0 } }), S.M ? S.M.stats.meanAlbedo : 0.3); };
}

// ── tabs, sheet ─────────────────────────────────────────────────────────
function bindTabs() {
  const open = (tab, toggle) => {
    const panel = $('panel');
    if (phone() && toggle && S.tab === tab && panel.classList.contains('open')) { panel.classList.remove('open'); markDock(null); return; }
    S.tab = tab;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('#panel section').forEach(s => s.classList.toggle('on', s.dataset.pane === tab));
    panel.classList.add('open'); markDock(tab);
    if (tab === 'maps') buildMaps();
  };
  const markDock = tab => document.querySelectorAll('#dock button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => open(b.dataset.tab));
  document.querySelectorAll('#dock button[data-tab]').forEach(b => b.onclick = () => open(b.dataset.tab, true));
  $('sheetGrip').onclick = () => { $('panel').classList.remove('open'); markDock(null); };
}

// ── maps tab ────────────────────────────────────────────────────────────
function toRGBA(img) {
  const n = img.width * img.height, d = new Uint8ClampedArray(n * 4), s = img.data, c = img.channels;
  for (let i = 0; i < n; i++) {
    if (c === 1) { const v = img.depth === 16 ? s[i] >> 8 : s[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    else if (c === 3) { d[i * 4] = s[i * 3]; d[i * 4 + 1] = s[i * 3 + 1]; d[i * 4 + 2] = s[i * 3 + 2]; d[i * 4 + 3] = 255; }
    else { // RGBA (clouds): show alpha over dark blue so white-on-white reads
      const a = s[i * 4 + 3] / 255;
      d[i * 4] = s[i * 4] * a + 12 * (1 - a); d[i * 4 + 1] = s[i * 4 + 1] * a + 20 * (1 - a); d[i * 4 + 2] = s[i * 4 + 2] * a + 40 * (1 - a); d[i * 4 + 3] = 255;
    }
  }
  return new ImageData(d, img.width, img.height);
}
function buildMaps() {
  const grid = $('mapGrid'); if (!S.M) return;
  grid.innerHTML = '';
  const small = shrinkMaps(S.M, 256), P = S.Pgen;
  for (const id of mapIds(P)) {
    const info = MAP_INFO.find(m => m.id === id);
    const f = document.createElement('figure');
    const c = document.createElement('canvas');
    const img = mapImage(small, P, id);
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(toRGBA(img), 0, 0);
    f.appendChild(c);
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b>${info.label}</b><span>${info.note}</span>`;
    const b = document.createElement('button'); b.textContent = 'PNG'; b.title = 'Download ' + info.label;
    b.onclick = e => { e.stopPropagation(); downloadMap(id); };
    cap.appendChild(b); f.appendChild(cap);
    c.onclick = () => showMap(id);
    grid.appendChild(f);
  }
}
const fileBase = () => `${S.Pgen.preset || S.Pgen.kind}-${S.Pgen.seed}-${S.Mw}`;
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function downloadMap(id) {
  status('encoding ' + id + '…');
  const png = await encodePNG(mapImage(S.M, S.Pgen, id));
  save(new Blob([png], { type: 'image/png' }), `${fileBase()}-${id}.png`);
  status(`${id}.png saved (${(png.length / 1e6).toFixed(1)} MB)`);
}
async function downloadZip() {
  if (!window.JSZip) return status('ZIP library missing');
  const zip = new window.JSZip(), ids = mapIds(S.Pgen);
  for (let i = 0; i < ids.length; i++) {
    status(`encoding ${ids[i]} (${i + 1}/${ids.length})…`); progress(i / ids.length);
    zip.file(`${fileBase()}-${ids[i]}.png`, await encodePNG(mapImage(S.M, S.Pgen, ids[i])));
  }
  zip.file(`${fileBase()}.json`, PR.toJSON(S.Pgen, S.Mw));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  progress(1); save(blob, fileBase() + '.zip'); status('ZIP saved');
}
$('dlZip').onclick = downloadZip;
$('dlJson').onclick = () => save(new Blob([PR.toJSON(S.Pgen || S.P, S.Mw || S.width)], { type: 'application/json' }), fileBase() + '.json');
$('loadJson').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const { width, planet } = PR.fromJSON(await f.text());
    S.P = planet; S.edited = true; if (BG.WIDTHS.includes(width)) { S.width = width; $('res').value = width; }
    S.drawPlanetTab(); buildShape(); buildSky(); regenerate(true);
  } catch (err) { status('could not load: ' + err.message); }
  e.target.value = '';
};
function showMap(id) {
  const img = mapImage(S.M, S.Pgen, id), c = $('mvCanvas');
  c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(toRGBA(img), 0, 0);
  const info = MAP_INFO.find(m => m.id === id);
  $('mvTitle').textContent = info.label; $('mvNote').textContent = `${img.width} × ${img.height}, ${img.channels} ch, ${img.depth}-bit · ${info.note}`;
  $('mvSave').onclick = () => downloadMap(id);
  $('mapView').hidden = false;
}
$('mvClose').onclick = () => { $('mapView').hidden = true; };

// ── camera, view ────────────────────────────────────────────────────────
let VB = { pr: 1, w: 1, h: 1, scale: 1 };
// dynamic resolution (budget.js createResScale): a safety net under the
// view budget; the canvas shrinks only while frames stay slow
const RS = BG.createResScale();
function resize() {
  const w = innerWidth, h = innerHeight;
  VB = BG.viewBudget(w, h, devicePixelRatio || 1, ENV, RS.scale);
  VB.scale = RS.scale;
  canvas.width = VB.w; canvas.height = VB.h;
}
// The clear area of the window (CSS px): beside the panel or above the sheet.
function clearArea() {
  const w = innerWidth, h = innerHeight;
  if (S.saver) return { x0: 0, y0: S.band ? S.band.t : 0, x1: w, y1: h - (S.band ? S.band.b : 0) };
  let x0 = 0, y1 = h;
  const p = $('panel').getBoundingClientRect();
  if (!phone()) x0 = p.right;
  else if ($('panel').classList.contains('open')) { if (p.width < w * 0.7) { return { x0: 0, y0: 0, x1: p.left, y1: h - ($('dock').offsetHeight || 0) }; } y1 = p.top; }
  else y1 = h - ($('dock').offsetHeight || 0);
  return { x0, y0: 40, x1: w, y1 };
}
function bindPointer() {
  const pts = new Map(); let pinch0 = 0, dist0 = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.classList.add('drag'); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = S.cam.dist; } });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); S.cam.dist = clampDist(dist0 * pinch0 / Math.max(d, 1)); return; }
    const k = 0.005 * Math.min(1, (S.cam.dist - 1) * 0.8);
    S.cam.yaw -= (e.clientX - prev[0]) * k; S.cam.pitch = Math.max(-1.45, Math.min(1.45, S.cam.pitch + (e.clientY - prev[1]) * k));
  });
  const up = e => { pts.delete(e.pointerId); if (!pts.size) canvas.classList.remove('drag'); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.cam.dist = clampDist(1 + (S.cam.dist - 1) * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
}
const clampDist = d => Math.max(1.08, Math.min(14, d));

function camState() {
  const o = S.override;
  if (o) return o;
  const { yaw, pitch, dist } = S.cam;
  const pos = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
  return { pos, target: [0, 0, 0], up: [0, 1, 0], fov: 35 * Math.PI / 180 };
}
function sunDir() {
  const a = S.sunAz * Math.PI / 180, e = S.sunEl * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { lastFrame = 0; return; }
  if (lastFrame && R && S.M && RS.update(now - lastFrame) !== VB.scale) resize();
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000); lastFrame = now;
  S.t += dt;
  // the simulated clock (clock.js): spin, the sun's year, the cloud hours
  const ck = S.clock;
  ck.spinAngle = S.spinAngle; ck.sunAz = S.sunAz;
  ck.tick(dt, { rate: S.rate, spinOn: S.spin && !!S.P, spin: S.P ? S.P.spin : 1, sunOn: S.moveSun && !S.override });
  S.spinAngle = ck.spinAngle; S.sunAz = ck.sunAz;
  if (now - (S.hudAt || 0) > 250) { S.hudAt = now; showClock(); }
  if (!R || !S.M) return;
  const c = camState(), ca = clearArea();
  // the principal point moves to the centre of the clear area
  const offX = ((ca.x0 + ca.x1) / 2 - innerWidth / 2) * VB.pr, offY = ((ca.y0 + ca.y1) / 2 - innerHeight / 2) * VB.pr;
  // the planet should fit the clear area's narrow side
  const fitH = Math.min(1, (ca.y1 - ca.y0) / innerHeight, (ca.x1 - ca.x0) / innerWidth * innerHeight / innerWidth * 1.6);
  const fov = c.fov / Math.max(0.35, fitH);
  R.render({
    pos: c.pos, target: c.target, up: c.up, fov: Math.min(fov, 1.6), w: VB.w, h: VB.h, offX, offY,
    t: S.t, exposure: S.exposure, sunDir: c.sunDir || sunDir(), spin: S.spinAngle,
    steps: BG.viewSteps(ENV), cloudsOn: S.clouds, flowSpeed: 1,
    hours: ck.hours(), quality: ENV.mobile ? 0 : ENV.coarse ? 1 : 2,
  }, ctx.getCurrentTexture().createView());
}

// The clock line in the header: the rate and the planet's local day.
function showClock() {
  const day = S.clock.simS / CK.DAY_S * (S.P ? S.P.spin : 1);
  const txt = `${CK.rateLabel(S.rate)} · day ${day.toFixed(day < 10 ? 2 : 1)}`;
  $('clock').textContent = txt; $('oRate').textContent = CK.rateLabel(S.rate);
  $('dockRate').textContent = CK.rateLabel(S.rate).replace('/s', '');
}

// Show a planet that was generated elsewhere (the saver preloads the next).
function adopt(P, M, W) {
  S.P = P; S.Pgen = P; S.M = M; S.Mw = W;
  if (R) R.setPlanet(P, M, ENV);
}

window.__forge = { S, regenerate, choosePreset, adopt, get pool() { return pool; }, get VB() { return VB; }, get R() { return R; }, sunDir, camState, ENV, get canvas() { return canvas; }, clearArea, buildMaps };
boot();

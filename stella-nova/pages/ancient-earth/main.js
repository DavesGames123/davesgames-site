// ============================================================================
//  ANCIENT EARTH  ·  main.js  ·  the GUI, the time player, search, readouts
// ----------------------------------------------------------------------------
//  Boot: data.js loads data/ (progress bar), recon.js builds the plate
//  model, globe.js the scene, labels.js the label layer. Then one age is
//  set (the URL hash, for example #240, or 240 Ma) and the loop runs.
//
//  Everything that depends on the age goes through setAge(t): the globe
//  (frames, quaternions, climate uniforms), the top age, the time bar
//  cursor, the caption and climate card, pin readouts, the URL hash.
//
//  The player moves the age at speed Myr/s between range.from (old) and
//  range.to (young), in the chosen direction, with an optional ease near
//  the ends, loop, globe turn and follow-the-pin camera.
//
//  The globe sits in the clear area between the panels (function frameView,
//  camera.setViewOffset), as on the wave-membrane page.
//
//  window.__ae: { booted, failed, setAge, state, globe, selfTest() } for
//  headless checks; saver.js uses the same object.
//
//  grep -n targets
//    boot .................. "async function boot"
//    time bar .............. "function buildTimebar"
//    one age change ........ "function setAge"
//    player + frame ........ "function tick"
//    search ................ "function search"
//    pin readout ........... "function pinReadout"
//    where is it now ....... "function whereNow"
//    legend ................ "function drawLegend"
//    view framing .......... "function frameView"
//    phone sheet ........... "function openGroup"
//    no UI selection ....... "function noSelect"
// ============================================================================
import * as THREE from 'three';
import { loadAll, elevAt } from './data.js';
import { Plates, gcKm, llToVec } from './recon.js';
import { Globe, MODES, cmapRGB, CONTINENT_COLORS, plateColor, llToThree } from './globe.js';
import { Labels, PLATE_NAMES } from './labels.js';
import { ERAS, PERIODS, EPOCHS, EONS, EVENTS, RANGES, MAX_AGE, ageToX, xToAge, describeAge, fmtMa, fmtAge } from './timescale.js';
import { climateAt, captionAt } from './world.js';

const $ = id => document.getElementById(id);
const AE = window.__ae = { booted: false, failed: null };
const PIN_COLORS = ['#ffcf5a', '#7ee0ff', '#ff8fa3', '#a5f28a', '#c9a2ff', '#ffa65c'];
const state = {
  age: 0, playing: false, speed: 5, dir: 1, range: { from: 540, to: 0 }, loop: true, ease: true, spin: false, follow: false,
  picked: null, lastInteract: 0,
};
AE.state = state;
let G, L, P, D, phone = false;

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  const cv = $('view');
  if (!cv.getContext('webgl2')) { $('nogl').hidden = false; $('loading').classList.add('done'); AE.failed = 'no webgl2'; return; }
  try {
    D = await loadAll(import.meta.url, p => { $('lfill').style.width = (p * 100).toFixed(0) + '%'; });
  } catch (e) {
    $('ltext').textContent = 'Could not load the data: ' + e.message; AE.failed = String(e); throw e;
  }
  $('ltext').textContent = 'Building the globe…';
  await new Promise(r => setTimeout(r, 20));
  P = new Plates(D.rot, D.poly, D.raster, D.meta.raster);
  const lite = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  G = new Globe(cv, D, P, { lite, keep: new URLSearchParams(location.search).has('keep') });
  L = new Labels($('labels'), G, P, D);
  AE.globe = G; AE.plates = P; AE.labels = L;
  buildUI();
  buildTimebar();
  const h = parseFloat(location.hash.slice(1));
  setAge(isFinite(h) ? h : 240);
  onResize();
  addEventListener('resize', onResize);
  requestAnimationFrame(tick);
  $('loading').classList.add('done');
  // the screensaver hook (saver.js) loads after boot; the page works without it
  import('./saver.js').then(m => m.installSaver(AE)).catch(e => console.warn('saver.js', e));
  AE.booted = true;
}

// ── view framing ────────────────────────────────────────────────────────────
// The clear area: right of the panel, left of the info card, above the time
// bar (and the sheet on a phone). The globe centres there.
function clearRect() {
  const W = innerWidth, H = innerHeight;
  let x0 = 0, x1 = W, y0 = 0, y1 = H;
  if (document.documentElement.classList.contains('sn-saver')) return { x0, x1, y0, y1 };
  const tb = $('timebar').getBoundingClientRect();
  y1 = Math.min(y1, tb.top);
  const pn = $('panel').getBoundingClientRect(), inf = $('info').getBoundingClientRect();
  if (phone) {
    if ($('panel').classList.contains('open')) y1 = Math.min(y1, pn.top);
    y0 = Math.max(y0, inf.bottom);
  } else {
    if (pn.width && pn.right < W / 2) x0 = pn.right;
    if (inf.width && inf.left > W / 2) x1 = inf.left;
    y0 = 40;
  }
  if (y1 - y0 < 140) y0 = Math.max(0, y1 - 140);
  return { x0, x1, y0, y1 };
}
let viewFit = null;
function frameView(k = 1) {
  const W = innerWidth, H = innerHeight;
  if (AE.viewOverride) {
    // the screensaver sets the frame and the camera distance itself
    viewFit = { ...AE.viewOverride };
    G.camera.setViewOffset(W, H, -(viewFit.cx - W / 2), -(viewFit.cy - H / 2), W, H);
    G.camera.updateProjectionMatrix();
    return;
  }
  const r = clearRect();
  const goal = { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, s: Math.min(r.x1 - r.x0, r.y1 - r.y0) };
  const s0 = viewFit ? viewFit.s : 0;
  viewFit = viewFit && k < 1 ? { cx: viewFit.cx + (goal.cx - viewFit.cx) * k, cy: viewFit.cy + (goal.cy - viewFit.cy) * k, s: viewFit.s + (goal.s - viewFit.s) * k } : goal;
  // A smaller clear area (a sheet opens) moves the camera back by the same
  // ratio, so the globe keeps its share of the clear area.
  if (s0 && state.fitted && Math.abs(viewFit.s - s0) > 0.5) {
    const c = G.camera.position, d = c.length() * s0 / viewFit.s;
    c.setLength(Math.min(G.controls.maxDistance, Math.max(G.controls.minDistance, d)));
  }
  G.camera.setViewOffset(W, H, -(viewFit.cx - W / 2), -(viewFit.cy - H / 2), W, H);
  G.camera.updateProjectionMatrix();
  AE.view = viewFit;
}
// camera distance that makes the globe fill `frac` of the clear size
function fitDistance(frac = 0.82) {
  const H = innerHeight, s = viewFit ? viewFit.s : H, t = Math.tan(G.camera.fov * Math.PI / 360);
  const rpx = s * frac / 2;
  return Math.hypot(H / 2 / (t * rpx), 1);
}
function onResize() {
  phone = matchMedia('(max-width: 760px), (max-height: 520px) and (pointer: coarse)').matches;
  document.body.classList.toggle('phone', phone);
  if (!phone) $('panel').classList.add('open');
  G.resize(innerWidth, innerHeight);
  L.resize(innerWidth, innerHeight);
  frameView(1);
  if (!state.fitted) { G.camera.position.setLength(fitDistance()); state.fitted = true; }
  drawLegend();
  layoutEvents();
}

// ── time bar ────────────────────────────────────────────────────────────────
function buildTimebar() {
  const rows = $('rows');
  rows.innerHTML = '';
  for (const [cls, list] of [['r-era', ERAS], ['r-period', PERIODS], ['r-epoch', EPOCHS]]) {
    const row = document.createElement('div'); row.className = 'trow ' + cls;
    for (const [name, top, base, col] of list) {
      if (top >= MAX_AGE) continue;
      const x0 = ageToX(Math.min(base, MAX_AGE)), x1 = ageToX(top);
      const s = document.createElement('div'); s.className = 'seg';
      s.style.left = (x0 * 100) + '%'; s.style.width = ((x1 - x0) * 100) + '%'; s.style.background = col;
      s.dataset.name = name; s.title = `${name}: ${fmtMa(base)} to ${fmtMa(top)}`;
      row.appendChild(s);
    }
    rows.appendChild(row);
  }
  const ev = $('evRow'); ev.innerHTML = '';
  for (const e of EVENTS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = e.short; b.title = `${e.name} · ${fmtMa(e.age)}`;
    b.style.left = (ageToX(e.age) * 100) + '%'; b.dataset.age = e.age;
    b.addEventListener('click', ev2 => { ev2.stopPropagation(); jumpTo(e.age); });
    ev.appendChild(b);
  }
  const tr = $('track');
  let drag = false;
  const setX = cx => { const r = tr.getBoundingClientRect(); setAge(snapAge(xToAge((cx - r.left) / r.width))); };
  tr.addEventListener('pointerdown', e => { if (e.target.closest('#evRow button')) return; e.preventDefault(); drag = true; tr.setPointerCapture(e.pointerId); stopPlay(); setX(e.clientX); interacted(); });
  tr.addEventListener('pointermove', e => { if (drag) setX(e.clientX); });
  const end = () => { drag = false; };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
  tr.addEventListener('keydown', e => {
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { setAge(state.age + d); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setAge(state.age - d); e.preventDefault(); }
  });
  layoutLabels();
}
// Snap near-0 ages to 0 and keep 0.1 Myr steps in the Cenozoic.
function snapAge(t) { if (t < 0.05) return t < 0.012 ? 0 : Math.round(t * 1000) / 1000; return t < 66 ? Math.round(t * 10) / 10 : Math.round(t * 2) / 2; }
// Text in a segment only when it fits.
function layoutLabels() {
  for (const s of document.querySelectorAll('.seg')) {
    const w = s.getBoundingClientRect().width, n = s.dataset.name;
    s.textContent = w > n.length * 6.2 + 8 ? n : w > 22 ? n.slice(0, Math.max(1, Math.floor(w / 7))) : '';
  }
}
function layoutEvents() {
  const bs = [...document.querySelectorAll('#evRow button')];
  let last = -1e9;
  for (const b of bs.sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left)) {
    b.style.visibility = 'visible';
    const r = b.getBoundingClientRect();
    if (r.left < last + 4) b.style.visibility = 'hidden'; else last = r.right;
  }
  layoutLabels();
}

// ── one age change ──────────────────────────────────────────────────────────
let hashTimer = 0;
function setAge(t) {
  t = Math.max(0, Math.min(MAX_AGE, t));
  state.age = t;
  const cl = climateAt(t);
  G.setAge(t, cl);
  const u = describeAge(t);
  $('ageNum').textContent = fmtMa(t);
  $('ageUnit').textContent = (u.epoch[0].includes(u.period[0]) ? u.epoch[0] : u.epoch[0] + ' · ' + u.period[0]) + ' · ' + u.era[0];
  $('cursor').style.left = (ageToX(t) * 100) + '%';
  $('track').setAttribute('aria-valuenow', t.toFixed(1));
  $('track').setAttribute('aria-valuetext', fmtAge(t));
  for (const s of document.querySelectorAll('.seg')) {
    const unit = [...ERAS, ...PERIODS, ...EPOCHS].find(q => q[0] === s.dataset.name);
    s.classList.toggle('dim', !(t >= unit[1] && t < unit[2]) && !(t === 0 && unit[1] === 0));
  }
  $('units').innerHTML = [u.eon, u.era, u.period, u.epoch].map(q => `<span style="background:${q[3]}">${q[0]}</span>`).join('');
  const cap = captionAt(t);
  $('capTitle').textContent = cap.title;
  $('capText').textContent = cap.text;
  $('climate').innerHTML = `<span>Global mean</span><b>${cl.gmst.toFixed(1)} °C · ${cl.state}</b>` +
    `<span>Pole to equator</span><b>${(cl.teq - cl.dT).toFixed(0)} to ${cl.teq.toFixed(0)} °C at sea level</b>` +
    (Math.abs(cl.sea) >= 1 ? `<span>Sea level</span><b>${cl.sea.toFixed(0)} m</b>` : '') +
    `<span>Land plants</span><b>${cl.veg < 0.02 ? 'none: bare rock and microbial crust' : cl.tall < 0.05 ? 'low mats and mosses' : cl.grass > 0.5 ? 'forests and grasslands' : 'forests, no grasslands yet'}</b>` +
    `<span class="est">Climate and land colours are estimates for this page (see About).</span>`;
  $('boundNote').style.color = G.boundsAvailable ? '' : (G.layers.bounds ? '#ffb46b' : '');
  updateReadouts();
  updateFossilKey();
  if (G.state.tint === 1) updateTintKey();
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => { try { history.replaceState(null, '', '#' + (+t.toFixed(t < 1 ? 3 : 1))); } catch { /* sandboxed frame */ } }, 300);
}
AE.setAge = setAge;
function jumpTo(t) { stopPlay(); tweenAge(t); interacted(); }
// A short tween so a jump reads as motion.
let tween = null;
function tweenAge(t) { tween = { a: state.age, b: t, t0: performance.now(), dur: Math.min(1800, 500 + Math.abs(t - state.age) * 4) }; }
AE.tweenAge = tweenAge;

// ── player + frame ──────────────────────────────────────────────────────────
let last = performance.now(), labelT = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / tween.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    setAge(tween.a + (tween.b - tween.a) * e);
    if (k >= 1) tween = null;
  } else if (state.playing && !AE.saverOn) {
    const R = state.range, lo = Math.min(R.from, R.to), hi = Math.max(R.from, R.to), span = Math.max(1, hi - lo);
    let v = state.speed;
    if (state.ease) {
      const edge = Math.min(state.age - lo, hi - state.age) / span;
      v *= 0.12 + 0.88 * Math.min(1, Math.max(0, edge) / 0.1);
    }
    let t = state.age - state.dir * v * dt;
    if (t < lo || t > hi) {
      if (state.loop) t = state.dir > 0 ? hi : lo;
      else { t = Math.max(lo, Math.min(hi, t)); stopPlay(); }
    }
    setAge(t);
  }
  if (state.spin || (state.playing && $('tSpin').classList.contains('on'))) G.group.rotation.y += dt * 0.06;
  if (state.follow && G.pins.length) followPin(dt);
  frameView(0.15);
  G.render(now);
  // labels every frame on desktop, every other frame on a phone
  if (!phone || (labelT ^= 1)) L.draw(state.age, pinLabels());
  if (!state.hintGone && now - state.lastInteract > 0 && state.lastInteract) { $('hint').classList.add('gone'); state.hintGone = true; }
}
function followPin(dt) {
  const p = G.pins[G.pins.length - 1]; if (!p.now) return;
  const v = new THREE.Vector3(p.now.v[1], p.now.v[2], p.now.v[0]).applyQuaternion(G.group.quaternion);
  const d = G.camera.position.length();
  const goal = v.normalize().multiplyScalar(d);
  G.camera.position.lerp(goal, Math.min(1, dt * 1.6)).setLength(d);
}
function pinLabels() {
  return G.pins.filter(p => p.now).map(p => ({ lat: p.now.lat, lon: p.now.lon, text: p.name, kind: 'pin', pri: 200, color: p.color }));
}
function startPlay() {
  const R = state.range, lo = Math.min(R.from, R.to), hi = Math.max(R.from, R.to);
  if (state.age < lo || state.age > hi || (state.dir > 0 && state.age <= lo + 0.01) || (state.dir < 0 && state.age >= hi - 0.01)) setAge(state.dir > 0 ? hi : lo);
  state.playing = true; $('play').classList.add('on'); $('play').innerHTML = '<i>❚❚</i>'; $('play').setAttribute('aria-label', 'Pause');
}
function stopPlay() { state.playing = false; $('play').classList.remove('on'); $('play').innerHTML = '<i>▶</i>'; $('play').setAttribute('aria-label', 'Play'); }
AE.startPlay = startPlay; AE.stopPlay = stopPlay;
function interacted() { state.lastInteract = performance.now(); }

// ── UI ──────────────────────────────────────────────────────────────────────
const MODE_NAMES = { realistic: 'Realistic', hypsometric: 'Atlas tint', grey: 'Greyscale', magma: 'Magma', viridis: 'Viridis', inferno: 'Inferno', turbo: 'Turbo', outline: 'Outline' };
function chipGroup(host, onPick) {
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !host.contains(b)) return;
    host.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(b); interacted();
  });
}
function buildUI() {
  // surface modes
  const md = $('modes');
  MODES.forEach((m, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = MODE_NAMES[m]; b.dataset.mode = i; if (i === 0) b.classList.add('on'); md.appendChild(b); });
  chipGroup(md, b => setMode(+b.dataset.mode));
  const rng = (id, fmt, fn) => { const el = $(id), v = $(id + 'V'); const up = () => { v.textContent = fmt(+el.value); fn(+el.value); }; el.addEventListener('input', () => { up(); interacted(); }); up(); };
  rng('exag', v => v + '×', v => G.setStyle({ exag: v }));
  rng('hillAz', v => v + '°', v => G.setStyle({ hillAz: v }));
  rng('sunAz', v => v + '°', v => { G.sun.az = v; });
  rng('sunDay', v => dayName(v), v => { G.sun.day = v; });
  rng('sunHour', v => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, v => { G.sun.hour = v; });
  const tog = (id, fn) => $(id).addEventListener('click', () => { const on = $(id).classList.toggle('on'); fn(on); interacted(); });
  tog('tHill', on => G.setStyle({ hill: on ? 1 : 0 }));
  tog('tClouds', on => G.setStyle({ clouds: on ? 1 : 0 }));
  chipGroup($('sunModes'), b => { G.sun.mode = b.dataset.sun; $('sunClock').hidden = b.dataset.sun !== 'clock'; $('sunView').hidden = b.dataset.sun === 'clock'; });
  chipGroup($('tints'), b => { G.setStyle({ tint: +b.dataset.tint }); G.idxDirty = true; updateTintKey(); });
  document.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { const on = b.classList.toggle('on'); G.setLayer(b.dataset.layer, on); setAge(state.age); interacted(); }));
  document.querySelectorAll('[data-label]').forEach(b => b.addEventListener('click', () => { L.show[b.dataset.label] = b.classList.toggle('on'); interacted(); }));
  // time player
  chipGroup($('speeds'), b => { state.speed = +b.dataset.speed; $('speedBtn').textContent = b.dataset.speed + '×'; });
  chipGroup($('dirs'), b => { state.dir = +b.dataset.dir; });
  const rg = $('ranges');
  RANGES.forEach((r, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = r.name; b.dataset.i = i; if (i === 0) b.classList.add('on'); rg.appendChild(b); });
  chipGroup(rg, b => { const r = RANGES[+b.dataset.i]; setRange(r.from, r.to); });
  const rf = $('rFrom'), rt = $('rTo');
  const onR = () => { setRange(+rf.value, +rt.value, true); rg.querySelectorAll('button').forEach(x => x.classList.remove('on')); };
  rf.addEventListener('input', onR); rt.addEventListener('input', onR);
  setRange(540, 0);
  tog('tLoop', on => { state.loop = on; });
  tog('tEase', on => { state.ease = on; });
  tog('tSpin', on => { state.spin = on; });
  tog('tFollow', on => { state.follow = on; });
  const ev = $('events');
  for (const e of EVENTS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = e.name; b.title = fmtMa(e.age); b.addEventListener('click', () => jumpTo(e.age)); ev.appendChild(b); }
  $('play').addEventListener('click', () => { state.playing ? stopPlay() : startPlay(); interacted(); });
  $('speedBtn').addEventListener('click', () => {
    const sp = [1, 5, 20, 60], i = (sp.indexOf(state.speed) + 1) % sp.length;
    state.speed = sp[i]; $('speedBtn').textContent = sp[i] + '×';
    $('speeds').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.speed === sp[i]));
  });
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input')) return;
    if (e.code === 'Space') { state.playing ? stopPlay() : startPlay(); e.preventDefault(); }
  });
  // search
  const q = $('q');
  q.addEventListener('input', () => search(q.value));
  q.addEventListener('keydown', e => {
    const li = [...$('qList').children]; let i = li.findIndex(x => x.classList.contains('on'));
    if (e.key === 'ArrowDown') { i = Math.min(li.length - 1, i + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { i = Math.max(0, i - 1); e.preventDefault(); }
    else if (e.key === 'Enter') { (li[i] || li[0])?.click(); e.preventDefault(); return; }
    else if (e.key === 'Escape') { $('qList').hidden = true; return; }
    li.forEach((x, k) => x.classList.toggle('on', k === i));
  });
  q.addEventListener('blur', () => setTimeout(() => { $('qList').hidden = true; }, 200));
  const qp = $('quickPlaces');
  for (const n of ['London', 'New York', 'Sydney', 'Tokyo', 'Cape Town', 'Mumbai']) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = n;
    b.addEventListener('click', () => { const c = D.cities.rows.find(r => r[0] === n); if (c) addPlace(c[0], c[2], c[3], c[1]); });
    qp.appendChild(b);
  }
  noSelect();
  // globe clicks: where is it now
  const cv = $('view');
  let down = null;
  cv.addEventListener('pointerdown', e => { e.preventDefault(); down = { x: e.clientX, y: e.clientY, t: performance.now() }; interacted(); });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved < 6 && dt < 500) whereNow(e.clientX, e.clientY);
  });
  cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !down) hover(e.clientX, e.clientY); });
  cv.addEventListener('pointerleave', () => { $('tip').hidden = true; });
  $('pbdbLive').addEventListener('click', fetchLive);
  // phone dock + sheet
  document.querySelectorAll('#dock .tab').forEach(b => b.addEventListener('click', () => openGroup(b.dataset.grp, b)));
  $('panelClose').addEventListener('click', () => closeSheet());
  sheetGrip();
  $('infoFold').addEventListener('click', () => $('info').classList.toggle('fold'));
  if (matchMedia('(max-width: 760px)').matches) $('info').classList.add('fold');
  setMode(0);
  updateTintKey();
}
// No text selection or native drag outside .prose (the user kept
// highlighting the UI while dragging the globe and the controls). A drag
// that starts in the chrome also clears any selection it would make.
function noSelect() {
  const prose = t => { const el = t && (t.nodeType === 3 ? t.parentElement : t); return !!(el && el.closest && el.closest('.prose, input[type=search]')); };
  document.addEventListener('selectstart', e => { if (!prose(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', e => { if (!prose(e.target)) e.preventDefault(); });
  let chromeDrag = false;
  document.addEventListener('pointerdown', e => { chromeDrag = !prose(e.target); }, true);
  document.addEventListener('pointerup', () => { chromeDrag = false; }, true);
  document.addEventListener('selectionchange', () => {
    if (!chromeDrag) return;
    const s = getSelection();
    if (s && s.rangeCount && !s.isCollapsed) s.removeAllRanges();
  });
  document.querySelectorAll('img').forEach(i => { i.draggable = false; });
}
function dayName(d) { const dt = new Date(2001, 0, d); return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function setRange(from, to, fromSliders) {
  state.range = { from, to };
  if (!fromSliders) { $('rFrom').value = from; $('rTo').value = to; }
  $('rFromV').textContent = fmtMa(+$('rFrom').value); $('rToV').textContent = fmtMa(+$('rTo').value);
  const a = ageToX(Math.max(from, to)), b = ageToX(Math.min(from, to));
  $('rangeMark').style.left = (a * 100) + '%'; $('rangeMark').style.width = ((b - a) * 100) + '%';
}
AE.setRange = setRange;
function setMode(i) {
  G.setStyle({ mode: i });
  $('modes').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.mode === i));
  drawLegend();
}
AE.setMode = setMode;

// ── legend ──────────────────────────────────────────────────────────────────
// Map modes: the colour ramp on the signed square-root scale the shader
// uses (sea floor left, land right), with ticks in metres.
const sgnSqrt = z => z < 0 ? 0.5 - 0.5 * Math.sqrt(-z / 9000) : 0.5 + 0.5 * Math.sqrt(z / 6000);
function hypsoCss(z) {
  const S = [[-7000, [18, 43, 107]], [-3000, [41, 92, 168]], [-200, [92, 158, 217]], [-1, [158, 214, 240]], [0, [107, 168, 102]], [400, [186, 204, 128]], [1200, [219, 194, 133]], [2600, [171, 122, 82]], [4200, [235, 232, 230]], [6000, [240, 240, 240]]];
  for (let i = 0; i < S.length - 1; i++) if (z >= S[i][0] && z <= S[i + 1][0]) { const u = (z - S[i][0]) / (S[i + 1][0] - S[i][0]); return S[i][1].map((v, j) => Math.round(v + (S[i + 1][1][j] - v) * u)); }
  return z < 0 ? S[0][1] : S[S.length - 1][1];
}
function drawLegend() {
  const host = $('legend'), m = MODES[G.state.mode];
  if (m === 'realistic') {
    host.innerHTML = `<div id="tintKeyR" class="cap">Land colour: an estimate from latitude, height, distance from the sea and the global temperature of the age. White is ice. Turquoise water is shallow shelf sea.</div>`;
    return;
  }
  if (m === 'outline') { host.innerHTML = `<div class="cap">The paleo-coastline at sea level, land dark, sea darker.</div>`; return; }
  const zs = [];
  for (let i = 0; i < 256; i++) { const x = i / 255; zs.push(x < 0.5 ? -9000 * ((0.5 - x) / 0.5) ** 2 : 6000 * ((x - 0.5) / 0.5) ** 2); }
  const c = document.createElement('canvas'); c.width = 256; c.height = 1;
  const g = c.getContext('2d'), im = g.createImageData(256, 1);
  zs.forEach((z, i) => {
    const x = i / 255;
    const rgb = m === 'grey' ? [0, 0, 0].map(() => Math.round(255 * Math.pow(x * x * 0.9 + 0.02, 1 / 2.2))) : m === 'hypsometric' ? hypsoCss(z) : cmapRGB(m, x);
    im.data.set([...rgb, 255], i * 4);
  });
  g.putImageData(im, 0, 0);
  const ticks = [-6000, -2000, -200, 0, 500, 2000, 5000].map(z => `<span style="left:${(sgnSqrt(z) * 100).toFixed(1)}%">${z === 0 ? '0' : (z > 0 ? '+' : '−') + (Math.abs(z) >= 1000 ? Math.abs(z) / 1000 + ' km' : Math.abs(z) + ' m')}</span>`).join('');
  host.innerHTML = '';
  host.appendChild(c);
  host.insertAdjacentHTML('beforeend', `<div class="ticks">${ticks}</div><div class="cap">Height above and depth below sea level, on a square-root scale.</div>`);
}
function updateTintKey() {
  const k = $('tintKey'), t = G.state.tint;
  if (t === 2) { k.innerHTML = Object.entries(CONTINENT_COLORS).filter(([n]) => !n.startsWith('Seven') && n !== 'Ocean').map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join(''); return; }
  if (t === 1) {
    // the largest plates alive at this age
    const area = new Map();
    P.poly.forEach((p, i) => { if (P.alive(i, state.age)) area.set(p.p, (area.get(p.p) || 0) + p.a); });
    const top = [...area.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    k.innerHTML = top.map(([pid]) => `<span><i style="background:#${plateColor(G.plateRank.get(pid)).getHexString()}"></i>${PLATE_NAMES[pid] || P.plateName(pid) || pid}</span>`).join('');
    return;
  }
  k.innerHTML = '';
}
function updateFossilKey() {
  const t = state.age, cnt = {};
  for (const r of D.fossils.rows) if (t <= r[2] + 2 && t >= r[3] - 2 && r[6] !== 255) cnt[r[1]] = (cnt[r[1]] || 0) + 1;
  const keys = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  $('fossilKey').innerHTML = keys.length ? keys.map(g => `<span><i style="background:${G.fossilColors[g]}"></i>${g} ${cnt[g]}</span>`).join('') : '<span>No sites in the sample at this age.</span>';
}

// ── search ──────────────────────────────────────────────────────────────────
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let cityIndex = null;
function search(text) {
  const list = $('qList');
  const s = norm(text.trim());
  if (!s) { list.hidden = true; return; }
  const out = [];
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const la = +m[1], lo = +m[2];
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) out.push({ name: `${la.toFixed(2)}, ${lo.toFixed(2)}`, country: 'coordinates', lat: la, lon: lo });
  }
  if (!cityIndex) cityIndex = D.cities.rows.map(r => [norm(r[0]), r]);
  for (const [n, r] of cityIndex) {
    if (out.length >= 12) break;
    if (n.startsWith(s)) out.push({ name: r[0], country: r[1], lat: r[2], lon: r[3] });
  }
  if (out.length < 12) for (const [n, r] of cityIndex) {
    if (out.length >= 12) break;
    if (!n.startsWith(s) && n.includes(s)) out.push({ name: r[0], country: r[1], lat: r[2], lon: r[3] });
  }
  list.innerHTML = '';
  out.forEach((o, i) => {
    const li = document.createElement('li'); li.innerHTML = `<span>${esc(o.name)}</span><i>${esc(o.country)}</i>`;
    if (i === 0) li.classList.add('on');
    li.addEventListener('mousedown', e => e.preventDefault());
    li.addEventListener('click', () => { addPlace(o.name, o.lat, o.lon, o.country); list.hidden = true; $('q').value = ''; $('q').blur(); });
    list.appendChild(li);
  });
  list.hidden = !out.length;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function addPlace(name, lat, lon, country = '') {
  const pin = G.addPin(lat, lon, PIN_COLORS[G.pins.length % PIN_COLORS.length], name);
  pin.country = country;
  renderPins();
  updateReadouts();
  // turn the globe to the pin
  if (pin.now) flyTo(pin.now.v);
  interacted();
  if (phone) closeSheet();
  return pin;
}
AE.addPlace = addPlace;
function flyTo(v, dur = 1100) {
  const d = G.camera.position.length();
  const goal = new THREE.Vector3(v[1], v[2], v[0]).applyQuaternion(G.group.quaternion).normalize().multiplyScalar(d);
  const from = G.camera.position.clone(), t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    G.camera.position.copy(from).lerp(goal, e).setLength(d);
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}
AE.flyTo = flyTo;
function renderPins() {
  const host = $('pins');
  host.innerHTML = '';
  for (const p of G.pins) {
    const row = document.createElement('div'); row.className = 'pinrow';
    row.innerHTML = `<i class="sw" style="background:${p.color}"></i><b>${esc(p.name)}</b><button type="button" aria-label="Go to">⌖</button><button type="button" aria-label="Remove">✕</button>`;
    const [go, rm] = row.querySelectorAll('button');
    go.addEventListener('click', () => p.now && flyTo(p.now.v));
    rm.addEventListener('click', () => { G.removePin(p); renderPins(); updateReadouts(); });
    host.appendChild(row);
  }
}

// ── readouts ────────────────────────────────────────────────────────────────
function updateReadouts() {
  const out = [];
  for (const p of G.pins.slice(-3).reverse()) out.push(pinReadout(p));
  if (state.picked) out.push(pickedCard(state.picked));
  $('readout').innerHTML = out.join('');
  $('readout').querySelectorAll('[data-gws]').forEach(b => b.addEventListener('click', () => checkGws(G.pins[+b.dataset.gws], b.dataset.gws)));
  $('readout').querySelectorAll('[data-pin-pick]').forEach(b => b.addEventListener('click', () => {
    const k = state.picked; if (!k || !k.now) return;
    addPlace(k.near ? 'Near ' + k.near[0] : 'Picked point', k.now.lat, k.now.lon);
    state.picked = null; updateReadouts();
  }));
}
const fmtLat = la => `${Math.abs(la).toFixed(1)}° ${la >= 0 ? 'N' : 'S'}`;
const fmtLon = lo => `${Math.abs(lo).toFixed(1)}° ${lo >= 0 ? 'E' : 'W'}`;
function zone(la) { const a = Math.abs(la); return a < 10 ? 'equatorial' : a < 23.5 ? 'tropical' : a < 35 ? 'subtropical' : a < 55 ? 'temperate' : a < 66.5 ? 'subpolar' : 'polar'; }
function surfaceAt(lat, lon, t) {
  const z = elevAt(D.dem, D.meta.dem, t, lat, lon) - climateAt(t).sea;
  return z >= 0 ? `land, about ${Math.round(z / 50) * 50} m` : z > -200 ? `shallow sea, about ${Math.round(-z / 10) * 10} m deep` : `ocean, about ${(Math.round(-z / 100) / 10).toFixed(1)} km deep`;
}
function plateLabel(k) {
  const p = P.poly[k];
  const nm = PLATE_NAMES[p.p] || P.plateName(p.p) || 'plate ' + p.p;
  return `${nm} <span style="color:var(--dim)">(PALEOMAP ${p.p}, part of ${p.k})</span>`;
}
function pinReadout(p) {
  const t = state.age;
  let body;
  if (p.poly < 0) body = `<p class="small">This place sits on ocean floor that the continental model does not track.</p>`;
  else if (!p.now) body = `<p class="small">This crust is not in the model before ${fmtMa(P.poly[p.poly].b)}: it formed or joined later.</p>`;
  else {
    const today = llToVec(p.lat, p.lon);
    const net = gcKm(today, p.now.v);
    let path = 0;
    for (let i = 1; i < p.path.length && p.path[i][0] <= t + 1e-6; i++) path += gcKm(llToVec(p.path[i - 1][1], p.path[i - 1][2]), llToVec(p.path[i][1], p.path[i][2]));
    const a = P.reconstruct(p.lat, p.lon, Math.max(0, t - 1), p.poly), b = P.reconstruct(p.lat, p.lon, t + 1, p.poly);
    const speed = a && b ? gcKm(a.v, b.v) / 2 / 10 : null;     // km/Myr = mm/yr; /10 = cm/yr
    body = `<dl class="prose"><dt>Then</dt><dd>${fmtLat(p.now.lat)}, ${fmtLon(p.now.lon)} · ${zone(p.now.lat)}</dd>` +
      `<dt>Today</dt><dd>${fmtLat(p.lat)}, ${fmtLon(p.lon)}</dd>` +
      `<dt>Moved</dt><dd>${Math.round(net).toLocaleString('en')} km from where it is now</dd>` +
      `<dt>Road</dt><dd>${Math.round(path).toLocaleString('en')} km travelled since then</dd>` +
      (speed != null ? `<dt>Speed</dt><dd>${speed.toFixed(1)} cm per year at this time</dd>` : '') +
      `<dt>Ground</dt><dd>${surfaceAt(p.now.lat, p.now.lon, t)}</dd>` +
      `<dt>Rides</dt><dd>${plateLabel(p.poly)}</dd></dl>`;
  }
  if (p.now) body += `<button type="button" data-gws="${G.pins.indexOf(p)}">Check with the GPlates Web Service</button><p class="small" data-gws-out="${G.pins.indexOf(p)}"></p>`;
  return `<div class="card"><h3><i style="background:${p.color}"></i>${esc(p.name)}${p.country && p.country !== 'coordinates' ? `<span style="color:var(--dim);font-weight:400">· ${esc(p.country)}</span>` : ''}</h3>${body}<div class="more"></div></div>`;
}
// Optional live check: the GPlates Web Service (gws.gplates.org, CORS on)
// reconstructs the same point with the same model on its server.
async function checkGws(p, i) {
  const out = $('readout').querySelector(`[data-gws-out="${i}"]`); if (!out || !p || !p.now) return;
  const t = state.age;
  out.textContent = 'Asking gws.gplates.org…';
  try {
    const r = await fetch(`https://gws.gplates.org/reconstruct/reconstruct_points/?points=${p.lon},${p.lat}&time=${+t.toFixed(3)}&model=PALEOMAP`);
    const js = await r.json(), c = js.coordinates && js.coordinates[0];
    if (!c) throw new Error('no point');
    const d = gcKm(llToVec(c[1], c[0]), p.now.v);
    out.textContent = `GPlates Web Service: ${fmtLat(c[1])}, ${fmtLon(c[0])} at ${fmtMa(t)}, ${d < 1 ? (d * 1000).toFixed(0) + ' m' : d.toFixed(1) + ' km'} from this page's answer.`;
  } catch (e) { out.textContent = 'The web service did not answer (' + e.message + ').'; }
}
function nearestCity(lat, lon) {
  const v = llToVec(lat, lon); let best = null, bd = 1e9;
  for (const r of D.cities.rows) { if (r[4] < 50000) continue; const d = gcKm(v, llToVec(r[2], r[3])); if (d < bd) { bd = d; best = r; } }
  return best ? [best[0], best[1], bd] : null;
}
function whereNow(cx, cy) {
  const hit = G.pick(cx, cy);
  if (!hit) { state.picked = null; updateReadouts(); return; }
  const now = P.unreconstruct(hit.lat, hit.lon, state.age);
  state.picked = { paleo: hit, age: state.age, now, near: now ? nearestCity(now.lat, now.lon) : null };
  updateReadouts();
  if (phone) $('info').classList.remove('fold');
}
AE.whereNow = whereNow;
function pickedCard(k) {
  const t = k.age;
  let body = `<dl class="prose"><dt>Then</dt><dd>${fmtLat(k.paleo.lat)}, ${fmtLon(k.paleo.lon)} · ${fmtMa(t)}</dd><dt>Ground</dt><dd>${surfaceAt(k.paleo.lat, k.paleo.lon, t)}</dd>`;
  if (k.now) {
    body += `<dt>Today</dt><dd>${fmtLat(k.now.lat)}, ${fmtLon(k.now.lon)}</dd>` +
      (k.near ? `<dt>Near</dt><dd>${esc(k.near[0])}, ${esc(k.near[1])} (${Math.round(k.near[2])} km)</dd>` : '') +
      `<dt>Rides</dt><dd>${plateLabel(k.now.poly)}</dd></dl>` +
      (k.now.others && k.now.others.length ? `<p class="small">The model also puts ${k.now.others.map(o => esc(PLATE_NAMES[o.plate] || P.plateName(o.plate) || 'plate ' + o.plate)).join(', ')} here at this age (overlapping pieces); the largest is shown.</p>` : '') +
      `<button type="button" data-pin-pick>Pin this crust and follow it</button>`;
  } else body += `</dl><p class="small">No continental crust of the model is here at this age: open ocean floor, since destroyed or not tracked.</p>`;
  return `<div class="card"><h3><i style="background:#fff"></i>Where is it now?</h3>${body}</div>`;
}

// ── fossils: hover and live fetch ───────────────────────────────────────────
let hoverAt = 0;
function hover(cx, cy) {
  const now = performance.now(); if (now - hoverAt < 50) return; hoverAt = now;
  const tip = $('tip');
  if (!G.layers.fossils) { tip.hidden = true; return; }
  const r = $('view').getBoundingClientRect(), x = cx - r.left, y = cy - r.top, t = state.age;
  const hits = [];
  for (const f of D.fossils.rows) {
    if (f[6] === 255 || t > f[2] + 2 || t < f[3] - 2) continue;
    const q = P.reconstruct(f[4], f[5], t, f[6]); if (!q) continue;
    const s = G.project(new THREE.Vector3(q.v[1], q.v[2], q.v[0]).multiplyScalar(1.003));
    if (s.front < 0.1) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < 9) hits.push([d, f]);
  }
  if (!hits.length) { tip.hidden = true; return; }
  hits.sort((a, b) => a[0] - b[0]);
  const f = hits[0][1], more = hits.slice(1, 6).map(h => h[1][0]).filter((g, i, a) => g !== f[0] && a.indexOf(g) === i);
  tip.innerHTML = `<b>${esc(f[0])}</b> <i>· ${esc(f[1])}</i><br><i>${esc(f[11] || '')} · ${f[2]}–${f[3]} Ma</i><br><i>found today at ${fmtLat(f[4])}, ${fmtLon(f[5])}</i>${more.length ? `<br><i>nearby: ${more.map(esc).join(', ')}</i>` : ''}`;
  tip.style.left = (cx + 14) + 'px'; tip.style.top = (cy + 10) + 'px'; tip.hidden = false;
}
async function fetchLive() {
  const t = state.age, b = $('pbdbLive'), note = $('pbdbNote');
  b.disabled = true; note.textContent = 'Asking paleobiodb.org…';
  try {
    const lo = Math.max(0, t - 3), hi = t + 3;
    const url = `https://paleobiodb.org/data1.2/occs/list.json?base_name=Dinosauria,Mammalia,Trilobita,Pterosauria,Ammonoidea,Ichthyosauria,Plesiosauria,Tetrapoda&taxon_reso=genus&min_ma=${lo.toFixed(1)}&max_ma=${hi.toFixed(1)}&show=coords&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const js = await res.json();
    const seen = new Set(D.fossils.rows.map(r => r[0] + '|' + Math.round(r[4]) + '|' + Math.round(r[5])));
    let n = 0;
    for (const o of js.records || []) {
      const la = +o.lat, lg = +o.lng, gen = (o.tna || '').split(' ')[0];
      if (!isFinite(la) || !gen) continue;
      const key = gen + '|' + Math.round(la) + '|' + Math.round(lg); if (seen.has(key)) continue; seen.add(key);
      D.fossils.rows.push([gen, 'live: PBDB', o.eag, o.lag, la, lg, (k => k < 0 ? 255 : k)(P.polyAt(la, lg)), 0, null, null, o.cid || '', o.oei || '']);
      n++;
    }
    G.fossilColors['live: PBDB'] = '#ffffff';
    G.group.remove(G.fossils); G.buildFossils(); G.applyLayers(); G.setAge(state.age, climateAt(state.age));
    note.textContent = `Added ${n} occurrences from the Paleobiology Database (CC BY 4.0) for ${fmtMa(lo)}–${fmtMa(hi)}.`;
    updateFossilKey();
  } catch (e) {
    note.textContent = 'The live request failed (' + e.message + '). The shipped sample still shows.';
  }
  b.disabled = false;
}

// ── phone sheet ─────────────────────────────────────────────────────────────
function openGroup(grp, btn) {
  const pn = $('panel');
  const same = pn.classList.contains('open') && pn.dataset.grp === grp;
  document.querySelectorAll('#dock .tab').forEach(b => b.classList.toggle('on', b === btn && !same));
  if (same) { closeSheet(); return; }
  pn.dataset.grp = grp;
  pn.querySelectorAll('.grp').forEach(g => g.classList.toggle('show', g.dataset.grp === grp));
  pn.classList.add('open'); pn.scrollTop = 0;
}
function closeSheet() {
  if (!phone) return;
  $('panel').classList.remove('open', 'full');
  document.querySelectorAll('#dock .tab').forEach(b => b.classList.remove('on'));
}
function sheetGrip() {
  const g = $('sheetGrip'); let y0 = null;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointerup', e => {
    if (y0 == null) return; const dy = e.clientY - y0; y0 = null;
    const pn = $('panel');
    if (dy > 40) { if (pn.classList.contains('full')) pn.classList.remove('full'); else closeSheet(); }
    else if (dy < -40) pn.classList.add('full');
    else pn.classList.toggle('full');
  });
}

// ── self test (headless checks) ─────────────────────────────────────────────
AE.selfTest = () => {
  const london = P.reconstruct(51.507, -0.128, 200);
  return {
    booted: AE.booted, age: state.age, canvas: [$('view').width, $('view').height],
    london200: london && [+london.lat.toFixed(4), +london.lon.toFixed(4)],
    pins: G.pins.length, mode: MODES[G.state.mode], gl: !!G.renderer.getContext(),
  };
};
AE.D = () => D;
AE.state = state;
AE.frameView = frameView;
AE.fitDistance = fitDistance;
AE.llToThree = llToThree;
AE.EONS = EONS;

boot().catch(e => { console.error(e); AE.failed = String(e); });

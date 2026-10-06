// ============================================================================
//  CVT  ·  main.js — unit swap, run, ratio, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one CVT at a time: model.js for the geometry and the ratio,
//  scene.js for its 3D parts (kit.js), stage.js for the renderer and the
//  camera, cards.js for the part cards and labels. A copy of the
//  harmonic-drive main.js with the CVT text, the ratio control, the plot
//  and the saver steps.
//
//  MOTION
//    Two values drive everything. S.th is the input angle (rad); each frame
//    adds rpm / 60 * 2 pi * dt. S.ctl is the ratio control, 0..1 (0 = the
//    lowest gear). With S.sweep on, S.ctl follows a slow sine (a shift up
//    and down). sc.pose(S.th, S.ctl) moves every part and returns
//    { th, x, i, out, ... }; i = w_in / w_out.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function setCtl ............ the ratio control and the sweep
//    function curves / drawPlot . ratio against sheave travel or tilt, and
//                                 the belt length check
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, sweep, pose, explode, stage, cards
//    function plateAnchor ....... saver plate anchor (InstancedMesh aware)
//    window.snSaver ............. screensaver hook: a tour of each unit
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, beltState, beltLength, L0, toroState, TAU } from './model.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { partsFor, GROUP_COLOR } from './parts.js';
import { createTour } from '../../lib/mech-tour.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = 180 / Math.PI;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0, rpm: 15, lastRpm: 15, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
  ctl: 0.3, sweep: !REDUCED, sweepT: 0, sweepK: 1, section: true,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.th,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── unit swap ───────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(!!sc.section && S.section);
    S.Q = sc.pose(S.th, S.ctl);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    $('tSection').hidden = !sc.section;
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  belt: { title: 'Push-belt CVT', kind: 'Van Doorne · sliding sheaves', lede: 'Two V-pulleys and a steel belt. Each pulley is two cones; one cone of each slides along its shaft. Squeeze one pulley and the belt climbs out on it, so it must sink into the other: the belt length cannot change. The ratio moves smoothly from 2.4 : 1 to 0.42 : 1 with no steps. Most CVT cars use this belt.' },
  toroidal: { title: 'Toroidal CVT', kind: 'Full-toroidal traction drive', lede: 'Two discs face each other across a doughnut-shaped cavity. Rollers sit in the cavity and touch both discs. Tilt the rollers and they touch the input disc near its centre and the output disc near its rim, or the reverse. Power passes through a thin film of traction fluid, not through gear teeth.' },
};
const ABOUT = {
  belt: [
    ['The wedge', 'The sheave faces open at 11° each. At radius r the gap between them is s + 2r tan 11°, so for a belt 34 mm wide the belt runs at r = (34 − s) / (2 tan 11°). Close the gap s and the belt rides out.'],
    ['Fixed length', 'The belt length is 2C cos α + π(r₁ + r₂) + 2α(r₁ − r₂), with sin α = (r₁ − r₂)/C. The page sets r₁ from the control and solves r₂ so the length stays the same: the plot shows the error, zero to 10⁻¹³ mm.'],
    ['Pushing, not pulling', 'Unlike a rubber belt, the steel elements push each other round the tight side. The band packs keep them in a loop. Clamping force from the servo cylinders stops the elements from slipping on the cones.'],
    ['Misalignment', 'The movable sheaves sit on opposite sides, so both belt centre planes move the same way as the ratio changes. They do not move by exactly the same amount: up to 0.6 mm here, at the two ends of the range.'],
  ],
  toroidal: [
    ['Contact radii', 'The roller centre sits on the core circle of the torus, radius E. Tilted by γ, it touches the input disc at r_in = E − R₀ sin γ and the output disc at r_out = E + R₀ sin γ.'],
    ['Ratio', 'No slip at either contact: ω_in r_in = ω_out r_out, with the output turning the other way. The ratio r_out / r_in is the same distance from 1 : 1 on each side, in log terms: i(γ) · i(−γ) = 1.'],
    ['Traction', 'The fluid between roller and disc turns almost glassy under about 1 GPa of contact pressure, so it can pass a shear force. The discs are pressed together with an end load in proportion to the torque.'],
    ['Torque control', 'Torotrak did not set the tilt directly. Pistons push the carriers along the tangent; the rollers steer themselves to the tilt where the reaction torque balances that force.'],
  ],
};
function fillPanel() {
  const id = S.cur.id, box = $('engInfo'), I = INFO[id];
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = I.title;
    $('engKind').textContent = I.kind;
    $('engLede').textContent = I.lede;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
    $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT[id].map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    $('ctlLabel').textContent = id === 'belt' ? 'Sheaves' : 'Tilt';
    $('plotTitle').textContent = id === 'belt' ? 'Ratio and belt length' : 'Ratio and contact radii';
    fillEqs();
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = UNITS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 28, el: 28, explode: 0, k: 1, at: null },
  close: { az: -38, el: 46, explode: 0, k: 0.45, at: 'close' },
  front: { az: 0, el: 4, explode: 0, k: 0.95, at: null },
  top: { az: 12, el: 68, explode: 0, k: 0.95, at: null },
  exploded: { az: 36, el: 22, explode: 1, k: 1.55, at: null },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  const at = v.at === 'close' ? S.cur.sc.keys.close : S.cur.sc.box.c;
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k), target: new THREE.Vector3(...at), t: soft ? 1.8 : 1.4 });
  setExplode(v.explode);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) { S.explodeTarget = x; $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%'; }
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(1));
function setRpm(r) {
  r = Math.max(0, Math.min(120, r));
  if (r > 0) S.lastRpm = r;
  S.rpm = r;
  $('rpm').value = r; $('rpmV').textContent = `${r}`;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.rpm)));
$('rpm').addEventListener('input', e => setRpm(+e.target.value));
$('dockPlay').addEventListener('click', () => setRpm(S.rpm ? 0 : S.lastRpm));
$('turn').addEventListener('input', e => {
  setRpm(0);
  const want = +e.target.value / DEG, base = Math.floor(S.th / TAU) * TAU;
  S.th = base + want;
});
// the ratio control: a slider value 0..1, and the sweep (a slow shift)
function setCtl(x, fromUser) {
  S.ctl = Math.max(0, Math.min(1, x));
  if (fromUser) setSweep(false);
  $('ratio').value = S.ctl;
}
function setSweep(on) {
  S.sweep = on; $('tSweep').classList.toggle('on', on);
  // start the sine where the control is now
  if (on) S.sweepT = Math.asin(Math.max(-1, Math.min(1, (S.ctl - 0.5) / 0.45)));
}
$('ratio').addEventListener('input', e => setCtl(+e.target.value, true));
$('tSweep').addEventListener('click', () => setSweep(!S.sweep));
function setShow(what, on) {
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(!!o.sc.section && on); }
}
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
$('tSection').addEventListener('click', () => setShow('section', !S.section));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'unit';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
  plotCache = null;
}
function setAna(open) {
  S.anaOpen = open;
  const desk = !PHONE_Q.matches;
  anaPanel.classList.toggle('open', open && desk);
  $('anaOpen').hidden = !desk || open;
  document.body.classList.toggle('ana-open', open && desk);
}
$('anaClose').addEventListener('click', () => setAna(false));
$('anaOpen').addEventListener('click', () => setAna(true));
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
  plotCache = null;
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
placeAnalysis();
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); });
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'tap a part to name it · drag to orbit · pinch to zoom';
setTimeout(hideHint, 9000);

// ── analysis ────────────────────────────────────────────────────────────────
// Over the control range (x 0..1, 200 steps): the ratio on a log scale
// (1 : 1 on the mid line, top = the lowest gear) and the unit's check.
// Belt: the belt length error at a full scale of 1 um (it is near
// 1e-13 mm, so the line is flat) and the misalignment at 1 mm full scale.
// Toroidal: r_in and r_out at a full scale of E + R0.
const COL = { o: '#e2c27a', w: '#8fb0ff', a: '#e9a0a8' };
function curves() {
  const id = S.cur.id, u = unit(id), N = 200, out = { o: [], w: [], a: [] };
  for (let k = 0; k <= N; k++) {
    const x = k / N;
    if (id === 'belt') { const st = beltState(u, x); out.o.push(st.i); out.w.push((beltLength(u.C, st.r1, st.r2) - L0(u)) / 1e-3); out.a.push(st.mis); }
    else { const T = toroState(u, x); out.o.push(T.i); out.w.push(T.rIn / (u.E + u.R0)); out.a.push(T.rOut / (u.E + u.R0)); }
  }
  out.iMax = Math.max(...out.o.map(i => Math.abs(Math.log(i))));
  out.lab = id === 'belt'
    ? [['lo', 'ratio i (log)'], ['lw', 'length − L0, ±1 µm'], ['la', 'misalignment, 0–1 mm']]
    : [['lo', 'ratio i (log)'], ['lw', 'r_in'], ['la', 'r_out']];
  out.ax = id === 'belt' ? ['input sheave open', 'closed'] : [`tilt +${(u.G_MAX * DEG).toFixed(0)}°`, `−${(u.G_MAX * DEG).toFixed(0)}°`];
  return out;
}
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  if (!plotCache) {
    const C = curves(), off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), pad = 10 * dpr, bot = h - 16 * dpr, X = x => pad + (w - 2 * pad) * x, mid = (pad + bot) / 2, A = (bot - pad) / 2;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k / 4); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, bot); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    const line = (arr, f, col, dash) => {
      o.strokeStyle = col; o.lineWidth = 1.6 * dpr; o.setLineDash(dash ? [4 * dpr, 3 * dpr] : []); o.beginPath();
      arr.forEach((v, i) => { const y = f(v); i ? o.lineTo(X(i / (arr.length - 1)), y) : o.moveTo(X(0), y); });
      o.stroke(); o.setLineDash([]);
    };
    line(C.o, v => mid - Math.log(v) / C.iMax * A, COL.o);
    if (S.cur.id === 'belt') {
      line(C.w, v => mid - Math.max(-1, Math.min(1, v)) * A, COL.w, true);
      line(C.a, v => bot - Math.min(1, v) * (bot - pad), COL.a);
    } else {
      line(C.w, v => bot - v * (bot - pad), COL.w);
      line(C.a, v => bot - v * (bot - pad), COL.a);
    }
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    o.fillText(C.ax[0], X(0), h - 3 * dpr);
    const tw = o.measureText(C.ax[1]).width; o.fillText(C.ax[1], X(1) - tw, h - 3 * dpr);
    o.fillText('1 : 1', X(0) + 3 * dpr, mid - 3 * dpr);
    $('legend').innerHTML = C.lab.map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const x = plotCache.X(S.ctl);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 16 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2);
let lastNums = '';
function fillNums() {
  const id = S.cur.id, u = unit(id), Q = S.Q;
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>` + row('Input', `${S.rpm} rpm`) + row('Output', `${(S.rpm / Q.i * (id === 'belt' ? 1 : -1)).toFixed(1)} rpm`) + row('Ratio i', `${f2(Q.i)} : 1`);
  if (id === 'belt') {
    const st = Q.st;
    html += row('Belt radius r₁ / r₂', `${f1(st.r1)} / ${f1(st.r2)} mm`) + row('Sheave gap s₁ / s₂', `${f1(st.s1)} / ${f1(st.s2)} mm`) + row('Sheave travel (input)', `${f1(st.travel1)} mm`) + row('Wrap on r₁ / r₂', `${(st.wrap1 * DEG).toFixed(0)}° / ${(st.wrap2 * DEG).toFixed(0)}°`) + row('Belt length L', `${st.L.toFixed(3)} mm`) + row('L − L₀', `${(st.L - L0(u)).toExponential(1)} mm`) + row('Misalignment', `${st.mis.toFixed(2)} mm`);
    $('now').innerHTML = Q.i > 1.05 ? '<b>Low gear</b><span>The input sheaves are open: the belt runs small on the input and large on the output.</span>' : Q.i < 0.95 ? '<b>Overdrive</b><span>The input sheaves are closed: the belt runs large on the input, so the output turns faster.</span>' : '<b>Near 1 : 1</b><span>Both pulleys hold the belt at the same radius.</span>';
  } else {
    const T = Q.T;
    html += row('Roller tilt γ', `${(T.g * DEG).toFixed(1)}°`) + row('r_in / r_out', `${f1(T.rIn)} / ${f1(T.rOut)} mm`) + row('Roller speed', `${(S.rpm * T.kRoll).toFixed(1)} rpm`) + row('Oil film (drawn)', `${u.FILM} mm`);
    $('now').innerHTML = T.g > 0.02 ? '<b>Low gear</b><span>The rollers touch the input disc near its centre and the output disc near its rim.</span>' : T.g < -0.02 ? '<b>Overdrive</b><span>The rollers touch the input disc near its rim and the output disc near its centre.</span>' : '<b>1 : 1</b><span>Zero tilt: both contacts at the core radius.</span>';
  }
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const E = S.cur.id === 'belt' ? [
    ['Belt radius', 'r = (b − s) / (2 tan β)', 'the gap s + 2r tan β is the belt width b'],
    ['Belt length', 'L = 2C cos α + π(r₁ + r₂) + 2α(r₁ − r₂)', 'sin α = (r₁ − r₂) / C, L fixed'],
    ['Ratio', 'i = ω₁ / ω₂ = r₂ / r₁', '2.40 … 0.42, spread 5.8'],
  ] : [
    ['Contacts', 'r_in = E − R₀ sin γ,  r_out = E + R₀ sin γ', 'roller centre on the core circle'],
    ['Ratio', 'i = r_out / r_in', 'output turns backward'],
    ['Symmetry', 'i(γ) · i(−γ) = 1', '2.21 … 0.45, spread 4.9'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, st = Q.st, T = Q.T;
  switch (key) {
    case 'in': return ['Input', `${S.rpm} rpm`];
    case 'outw': return ['Output', `${(S.rpm / Q.i * (S.cur.id === 'belt' ? 1 : -1)).toFixed(1)} rpm`];
    case 'ratio': return ['Ratio', `${Q.i.toFixed(2)} : 1`];
    case 'r1': return ['Belt radius', st ? `${st.r1.toFixed(1)} mm` : '—'];
    case 'r2': return ['Belt radius', st ? `${st.r2.toFixed(1)} mm` : '—'];
    case 'travel': return ['Input sheave travel', st ? `${st.travel1.toFixed(1)} mm` : '—'];
    case 'len': return ['L − L₀', st ? `${(st.L - L0(unit('belt'))).toExponential(1)} mm` : '—'];
    case 'rin': return ['Contact radius', T ? `${T.rIn.toFixed(1)} mm` : '—'];
    case 'rout': return ['Contact radius', T ? `${T.rOut.toFixed(1)} mm` : '—'];
    case 'spin': return ['Roller speed', T ? `${(S.rpm * T.kRoll).toFixed(1)} rpm` : '—'];
    case 'tilt': return ['Tilt', T ? `${(T.g * DEG).toFixed(1)}°` : '—'];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q, sub = S.cur.id === 'belt' ? `r₁ ${Q.st.r1.toFixed(1)} · r₂ ${Q.st.r2.toFixed(1)} mm` : `tilt ${(Q.T.g * DEG).toFixed(1)}°`;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">i ${Q.i.toFixed(2)} : 1 · ${sub}</span>`;
  $('turnV').textContent = `${((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0)}°`;
  $('ratioV').textContent = `${Q.i.toFixed(2)}`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  S.th += S.rpm / 60 * TAU * dt;
  if (S.sweep) { S.sweepT += dt * TAU / 16 * S.sweepK; S.ctl = 0.5 + 0.45 * Math.sin(S.sweepT); if (!saverOn) $('ratio').value = S.ctl; }
  S.Q = cur.sc.pose(S.th, S.ctl);
  for (const o of S.leaving) o.sc.pose(S.th, S.ctl);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.B.applyExplode(Math.min(1, S.explode + 0.4 * kk));
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    readout();
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); }
    drawPlot();
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__cvt = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna, setCtl, setSweep };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('tSection').classList.toggle('on', S.section);
setRpm(15); setExplode(0); setCtl(S.ctl); setSweep(S.sweep);
stage.place({ az: -50, el: 25, r: 2000, target: new THREE.Vector3(0, 0, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'belt');
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
// As on the differential page: the projected centre and radius of the
// visible meshes of the subject, in page CSS px, plus key points. An
// InstancedMesh (the belt elements) uses its own instance bounds.
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs, keys = []) {
  const cv = $('view'), rc = cv.getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height || cv.style.opacity === '0') return null;
  const px = w => { PA.v.copy(w).project(cam); return PA.v.z > 1 ? null : { x: rc.left + (PA.v.x + 1) / 2 * rc.width, y: rc.top + (1 - PA.v.y) / 2 * rc.height }; };
  const ms = [];
  PA.box.makeEmpty();
  for (const ob of objs) if (ob) ob.traverseVisible(m => {
    if (!m.isMesh || (m.material && m.material.opacity === 0)) return;
    if (m.isInstancedMesh) { if (!m.boundingBox) m.computeBoundingBox(); }
    else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.isInstancedMesh ? m.boundingBox : m.geometry.boundingBox; if (!b || b.isEmpty()) return;
    ms.push([m, b]); PA.mb.copy(b).applyMatrix4(m.matrixWorld); PA.box.union(PA.mb);
  });
  if (PA.box.isEmpty()) return null;
  const C = px(PA.box.getCenter(PA.c));
  if (!C) return null;
  let r = 0;
  for (const [m, b] of ms) for (let i = 0; i < 8; i++) {
    PA.c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
    const q = px(PA.c); if (q) r = Math.max(r, Math.hypot(Math.max(rc.left, Math.min(rc.right, q.x)) - C.x, Math.max(rc.top, Math.min(rc.bottom, q.y)) - C.y));
  }
  if (C.x + r < rc.left || C.x - r > rc.right || C.y + r < rc.top || C.y - r > rc.bottom) return null;
  const pts = [];
  for (const k of keys) { const q = k && px(k); if (q && q.x >= rc.left && q.x <= rc.right && q.y >= rc.top && q.y <= rc.bottom) pts.push(q); }
  return { x: C.x, y: C.y, r, pts };
}

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and tours
// each unit while the ratio sweeps up and down: the whole unit, a close
// view of the belt in its sheaves (or a roller between the discs), the
// view face on, the view from above, the exploded unit and close-ups of 3
// parts (lib/mech-tour.js), then a fade to the next unit. The order of the
// middle steps is a seeded shuffle. Each step holds seconds/10 (at least
// 5 s). calm (1 = slowest) slows the input and the sweep, not the step
// time. opts.label names each step with the relations and live values.
// No exit(): the shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#labels,#leader,#read,.tip,#nogl,#gear{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none;transition:opacity 0.9s ease}';
    document.head.appendChild(st);
    setOpen(false); setAna(false); setShow('labels', false); setShow('section', true);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const RPM = Math.round(14 - 6 * calm);
    setRpm(RPM);
    S.sweepK = 1.2 - 0.5 * calm; setSweep(true); S.sweepT = rnd() * TAU;
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['i', 'm1'], ['r_1', 'm2'], ['r_2', 'm3'], ['r_{in}', 'm2'], ['r_{out}', 'm3'], ['\\gamma', 'm4'], ['L', 'm5'], ['s', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEXS = {
      belt: [String.raw`r = \frac{b - s}{2\tan\beta}`, String.raw`L = 2C\cos\alpha + \pi(r_1 + r_2) + 2\alpha(r_1 - r_2)`],
      toroidal: [String.raw`r_{in} = E - R_0\sin\gamma,\quad r_{out} = E + R_0\sin\gamma`, String.raw`i = \frac{r_{out}}{r_{in}},\quad i(\gamma)\,i(-\gamma) = 1`],
    };
    const EQS = { belt: ['r = (b − s) / (2 tan β)', 'L fixed: r₂ follows r₁'], toroidal: ['r_in = E − R₀ sin γ', 'i = r_out / r_in'] };
    const tex = () => TEXS[S.cur.id], eq = () => EQS[S.cur.id];
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      if (S.cur.id === 'belt') return [P('i', 'ratio', `${Q.i.toFixed(2)} : 1`, 'm1'), P('r_1', 'input radius', `${Q.st.r1.toFixed(1)} mm`, 'm2'), P('r_2', 'output radius', `${Q.st.r2.toFixed(1)} mm`, 'm3'), P('L - L_0', 'belt length', `${(Q.st.L - L0(unit('belt'))).toExponential(0)} mm`, 'm5')];
      return [P('i', 'ratio', `${Q.i.toFixed(2)} : 1`, 'm1'), P('\\gamma', 'roller tilt', `${(Q.T.g * DEG).toFixed(1)}°`, 'm4'), P('r_{in}', 'input contact', `${Q.T.rIn.toFixed(1)} mm`, 'm2'), P('r_{out}', 'output contact', `${Q.T.rOut.toFixed(1)} mm`, 'm3')];
    };
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(belt|bands|move1|shaft1|car0|roll0)$/.test(q.id)).map(q => q.holder);
    const STEPS = {
      three: { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      close: { view: 'close', lab: () => ({ title: S.cur.id === 'belt' ? 'The belt in the V' : 'Roller between the discs', sub: S.cur.id === 'belt' ? 'The sheave slides and the belt climbs' : 'Tilt moves the two contact radii', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      front: { view: 'front', lab: () => ({ title: INFO[S.cur.id].title, sub: S.cur.id === 'belt' ? 'Face on: one radius grows, the other shrinks' : 'Face on: the roller tilts in the section', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      top: { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: S.cur.id === 'belt' ? 'From above: the sheaves open and close' : 'From above: into the cavity', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      exploded: { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    };
    Object.values(STEPS).forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['roller', 'carrier', 'move', 'belt', 'band'], skip: ['base', 'frame'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS.three, ...shuffle([STEPS.close, STEPS.front, STEPS.top]), STEPS.exploded, ...tour.pick(3).map(focusStep)]; };
    const show = s => {
      // the ratio keeps sweeping in a still step: only the input stops
      setRpm(s.still ? 0 : RPM);
      if (s.focus) tour.show(s.focus);
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded' }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    const fadeSwap = async (id, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      setExplode(0); S.explode = 0;
      await swapTo(id);
      setTimeout(() => { canvas.style.opacity = '1'; then(); }, 250);
    };
    let n = 0, ord = first, stepT = 0, lastLab = '', labT = 0, now = null;
    const advance = () => {
      if (n === 0 || n >= plan.length) {
        const go = () => { makePlan(); n = 0; stepT = 0; now = plan[n++]; show(now); };
        if (now) { tour.clear(); fadeSwap(order[++ord % order.length], go); now = null; } else go();
        return;
      }
      now = plan[n++]; show(now);
    };
    window.__mechTour = tour;
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    (async () => { if (!S.cur || S.cur.id !== order[first]) await swapTo(order[first]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};

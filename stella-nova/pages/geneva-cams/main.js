// ============================================================================
//  GENEVA DRIVE & CAMS  ·  main.js — unit swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one unit at a time: mech.js for the outlines and the motion laws,
//  scene.js for its 3D parts (kit.js), stage.js for the renderer and the
//  camera, cards.js for the part cards and labels. The panel and dock code
//  follows the differential page.
//
//  MOTION
//    One angle drives everything: S.th, the input shaft angle (rad). Each
//    frame adds rpm / 60 * 2 pi * dt. sc.pose(S.th) turns every part and
//    returns the pose (Geneva: psi, omega, engaged; cam: s, v, a, press).
//    The hand slider sets S.th and pauses the drive.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function drawPlot .......... the motion plot over one input turn
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each unit
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, geneva, genevaPose, camPose, TAU } from './mech.js';
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
  cur: null, leaving: [], th: 0.3, rpm: 15, lastRpm: 15, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
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
    B.setSection(false);
    B.parts.base.holder.visible = S.base;
    S.Q = sc.pose(S.th);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  geneva4: { title: 'Geneva drive, 4 slots', kind: 'External Geneva · index table', lede: 'A crank turns at a steady speed. Once a turn its pin drops into a slot of the star wheel and turns it a quarter turn; for the other three quarters of the turn a locking disc holds the star still. The index table on the star shaft so moves in clean steps.' },
  geneva6: { title: 'Geneva drive, 6 slots', kind: 'External Geneva · index table', lede: 'With six slots the pin is in a slot for only 120° of the turn, and the star steps 60°. More slots give a shorter, gentler step and a longer dwell, at a lower peak speed.' },
  cam: { title: 'Disc cam and roller follower', kind: 'Rise · dwell · return · dwell', lede: 'The cam turns at a steady speed. Its outline pushes a roller follower out 38 mm, holds it, lets the spring bring it back, and holds it again. The cycloidal law starts and stops each move with no jerk.' },
};
const ABOUT = {
  geneva: [
    ['No shock at entry', 'The pin radius is r = a sin(π/n), so the pin enters the slot at a right angle to the line of centres. Its velocity points along the slot: the star starts from rest with no impact.'],
    ['Step and dwell', 'The pin is in a slot while the crank turns through 180° − 360°/n. That is 90° for 4 slots and 120° for 6. For the rest of the turn the star dwells, held by the locking disc in a concave arc.'],
    ['Where you find it', 'Film projectors (the film stands still while the shutter is open), index tables on machine tools and packing lines, and mechanical watches (the Geneva stop that limits winding).'],
    ['What the model leaves out', 'No inertia and no backlash. The star accelerates hardest at entry and exit: in a real drive that is where wear and noise come from.'],
  ],
  cam: [
    ['The pitch curve', 'The roller centre must follow R(θ) = Rb + Rr + s(θ). The cam outline is that curve moved in by the roller radius along its normal, so the roller touches it at every angle.'],
    ['Cycloidal motion', 's = h (x − sin 2πx / 2π) for x from 0 to 1. Speed and acceleration are zero at both ends of the rise and the return, so the dwells start and end without a jolt.'],
    ['Pressure angle', 'The cam pushes along the common normal. Its tilt from the stem, the pressure angle, makes a side load on the guide. Above about 30° a translating follower can jam; this cam stays below that.'],
    ['Where you find it', 'Engine valve trains, sewing machines, automatic lathes and packaging machines: anywhere a motion has to follow a fixed program at every turn.'],
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
    $('about').innerHTML = ABOUT[unit(id).n ? 'geneva' : 'cam'].map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
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
  three: { az: 30, el: 32, explode: 0, k: 1, at: [0, 20, 0] },
  close: { az: 70, el: 40, explode: 0, k: 0.55, at: null },
  top: { az: 0, el: 82, explode: 0, k: 0.95, at: [0, 20, 0] },
  low: { az: -20, el: 9, explode: 0, k: 0.85, at: [0, 30, 0] },
  exploded: { az: 24, el: 24, explode: 1, k: 1.35, at: [0, 70, 0] },
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
  // close in: the working pair (star and pin, or cam and roller)
  const keys = S.cur.sc.keys, at = v.at || (keys.star ? [(keys.star[0] * 0.3 + keys.driver[0] * 0.7), 30, 0] : [(keys.cam[0] + keys.roller[0]) / 2 + 30, 27, 0]);
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
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.base.holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

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

// ── motion analysis ─────────────────────────────────────────────────────────
// Over one input turn phi in [0, 360): Geneva: output angle (deg) and
// omega_out / omega_in; cam: s (mm), v and a, each scaled to its peak.
const COL = { o: '#e2c27a', w: '#8fb0ff', a: '#e9a0a8' };
function curves() {
  const u = unit(S.cur.id), N = 360, out = { o: [], w: [], a: [] };
  if (u.n) {
    const G = S.cur.sc.G, p0 = genevaPose(G, 0).psi;
    for (let i = 0; i <= N; i++) { const Q = genevaPose(G, i / N * TAU); out.o.push(-(Q.psi - p0) * DEG); out.w.push(-Q.omega); }
    out.oMax = 360 / G.n; out.wMax = Math.max(...out.w);
    out.lab = [['lo', 'output angle ψ'], ['lw', 'speed ratio ω₂/ω₁']];
  } else {
    for (let i = 0; i <= N; i++) { const P = camPose(u, i / N * TAU); out.o.push(P.s); out.w.push(P.v); out.a.push(P.a); }
    out.oMax = u.h; out.wMax = Math.max(...out.w.map(Math.abs)); out.aMax = Math.max(...out.a.map(Math.abs));
    out.lab = [['lo', 'travel s'], ['lw', 'velocity ds/dθ'], ['la', 'acceleration']];
  }
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
    const o = off.getContext('2d'), pad = 10 * dpr, X = i => pad + (w - 2 * pad) * i / 360, mid = h / 2, Hh = h / 2 - pad;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    const line = (arr, max, col, base) => {
      o.strokeStyle = col; o.lineWidth = 1.6 * dpr; o.beginPath();
      arr.forEach((v, i) => { const y = base ? h - pad - (v / max) * (h - 2 * pad) : mid - (v / max) * Hh; i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); });
      o.stroke();
    };
    line(C.o, C.oMax, COL.o, true);
    line(C.w, C.wMax, COL.w, !!unit(S.cur.id).n);
    if (C.a.length) line(C.a, C.aMax, COL.a, false);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    $('legend').innerHTML = C.lab.map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X, C };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const ph = ((S.th % TAU) + TAU) % TAU * DEG, x = plotCache.X(ph);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const u = unit(S.cur.id), Q = S.Q, w1 = S.rpm, ph = (((S.th % TAU) + TAU) % TAU) * DEG;
  let html;
  if (u.n) {
    const G = S.cur.sc.G;
    html = `<tr><th>Geneva</th><th></th></tr>` + row('Input angle θ', `${ph.toFixed(1)}°`) + row('Phase', Q.engaged ? `step, ${(Q.frac * 100).toFixed(0)}%` : 'dwell (locked)') +
      row('Star speed ω₂', `${(-Q.omega * w1).toFixed(2)} rpm`) + row('Peak ω₂ / ω₁', `${(G.r / (G.a - G.r)).toFixed(3)}`) +
      row('Step', `${(360 / G.n).toFixed(0)}°`) + row('Dwell share', `${(G.dwell * 100).toFixed(1)}%`) + row('Pin radius r', `${G.r.toFixed(1)} mm`) + row('Tip radius R₂', `${G.R2.toFixed(1)} mm`);
    $('now').innerHTML = `<b>${Q.engaged ? 'Stepping' : 'Dwell'}</b><span>${Q.engaged ? 'The pin is in a slot and turns the star.' : 'The locking disc holds the star still.'}</span>`;
  } else {
    html = `<tr><th>Cam</th><th></th></tr>` + row('Cam angle θ', `${ph.toFixed(1)}°`) + row('Segment', Q.seg) + row('Travel s', `${Q.s.toFixed(2)} mm`) +
      row('Velocity', `${(Q.v * w1 / 60 * TAU).toFixed(1)} mm/s`) + row('Pressure angle', `${(Q.press * DEG).toFixed(1)}°`) + row('Lift h', `${u.h} mm`) + row('Base circle', `${u.Rb} mm`);
    $('now').innerHTML = `<b>${Q.seg[0].toUpperCase() + Q.seg.slice(1)}</b><span>${Q.seg === 'rise' ? 'The cam pushes the follower out.' : Q.seg === 'return' ? 'The spring brings the follower back.' : 'The follower stands still.'}</span>`;
  }
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const u = unit(S.cur.id);
  const E = u.n ? [
    ['Pin radius', 'r = a sin(π/n),  R₂ = a cos(π/n)', 'the pin meets the slot at a right angle'],
    ['Output angle', 'tan ψ = λ sin α / (1 − λ cos α),  λ = r/a', 'α from the line of centres'],
    ['Speed ratio', 'ω₂/ω₁ = λ (cos α − λ) / (1 − 2λ cos α + λ²)', 'peak at α = 0: λ/(1 − λ)'],
    ['Dwell share', '1 − (n − 2)/(2n)', `${(geneva(u).dwell * 100).toFixed(1)}% for n = ${u.n}`],
  ] : [
    ['Pitch curve', 'R(θ) = R_b + R_r + s(θ)', 'roller centre'],
    ['Cycloidal rise', 's = h (x − sin 2πx / 2π),  x = θ/β', 'zero speed and acceleration at both ends'],
    ['Pressure angle', 'tan φ = (ds/dθ) / R(θ)', 'below 30° for a translating follower'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, ph = (((S.th % TAU) + TAU) % TAU) * DEG;
  switch (key) {
    case 'wIn': return ['Input', `${S.rpm} rpm`];
    case 'theta': return ['Input angle', `${ph.toFixed(1)}°`];
    case 'phase': return ['Phase', Q.engaged ? 'in a slot' : 'locked'];
    case 'psi': return ['Output angle', `${((-Q.psi * DEG) % 360).toFixed(1)}°`];
    case 'wOut': return ['Star speed', `${(-Q.omega * S.rpm).toFixed(2)} rpm`];
    case 'station': return ['Station', `${(((Q.step ?? 0) % unit(S.cur.id).n) + unit(S.cur.id).n) % unit(S.cur.id).n + 1}`];
    case 'seg': return ['Segment', Q.seg];
    case 's': return ['Travel', `${Q.s.toFixed(1)} mm`];
    case 'v': return ['Velocity', `${(Q.v * S.rpm / 60 * TAU).toFixed(1)} mm/s`];
    case 'press': return ['Pressure angle', `${(Q.press * DEG).toFixed(1)}°`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const u = unit(S.cur.id), Q = S.Q;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br>` + (u.n
    ? `<span class="lo">${Q.engaged ? 'stepping' : 'dwell'} · ψ ${((-Q.psi * DEG) % 360).toFixed(1)}°</span>`
    : `<span class="lo">${Q.seg} · s ${Q.s.toFixed(1)} mm · φ ${(Q.press * DEG).toFixed(1)}°</span>`);
  $('turnV').textContent = `${((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0)}°`;
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
  S.Q = cur.sc.pose(S.th);
  for (const o of S.leaving) o.sc.pose(S.th);
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
window.__geneva = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(15); setExplode(0);
stage.place({ az: -60, el: 30, r: 1800, target: new THREE.Vector3(0, 20, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'geneva4');
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
// As on the differential page: the projected centre and radius of the
// visible meshes of the subject, in page CSS px, plus key points.
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs, keys = []) {
  const cv = $('view'), rc = cv.getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height || cv.style.opacity === '0') return null;
  const px = w => { PA.v.copy(w).project(cam); return PA.v.z > 1 ? null : { x: rc.left + (PA.v.x + 1) / 2 * rc.width, y: rc.top + (1 - PA.v.y) / 2 * rc.height }; };
  const ms = [];
  PA.box.makeEmpty();
  for (const ob of objs) if (ob) ob.traverseVisible(m => {
    if (!m.isMesh || (m.material && m.material.opacity === 0)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox; if (!b || b.isEmpty()) return;
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
// each unit: the whole unit, a close view of the working pair, the view
// from above, the exploded unit and close-ups of 3 parts (lib/mech-tour.js),
// then a fade to the next unit. Each step holds seconds/10 (at least 5 s).
// calm (1 = slowest) slows the input, not the step time. opts.label names
// each step with the relations and live values. No exit(): the shell
// reloads the page.
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
    setOpen(false); setAna(false); setShow('labels', false);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const RPM = Math.round(20 - 10 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['\\theta', 'm1'], ['\\psi', 'm2'], ['\\omega_2', 'm3'], ['\\omega_1', 'm1'], ['s', 'm4'], ['\\varphi', 'm5'], ['n', 'm6']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const QQ = () => S.Q || {};
    const geo = () => unit(S.cur.id).n;
    const genevaTex = [String.raw`r = a\sin\frac{\pi}{n},\qquad \text{dwell} = 1-\frac{n-2}{2n}`, String.raw`\frac{\omega_2}{\omega_1} = \frac{\lambda(\cos\alpha-\lambda)}{1-2\lambda\cos\alpha+\lambda^2},\quad \lambda=\frac{r}{a}`];
    const camTex = [String.raw`s = h\left(x-\frac{\sin 2\pi x}{2\pi}\right),\quad x=\frac{\theta}{\beta}`, String.raw`\tan\varphi = \frac{ds/d\theta}{R_b+R_r+s}`];
    const params = () => {
      const Q = QQ(), ph = ((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0) + '°';
      if (geo()) return [P('\\theta', 'input angle', ph, 'm1'), P('\\psi', 'star angle', `${((-(Q.psi || 0) * DEG) % 360).toFixed(1)}°`, 'm2'), P('\\omega_2', 'star speed', `${(-(Q.omega || 0) * S.rpm).toFixed(2)} rpm`, 'm3'), P('n', 'slots', String(geo()), 'm6')];
      return [P('\\theta', 'cam angle', ph, 'm1'), P('s', 'travel', `${(Q.s || 0).toFixed(1)} mm`, 'm4'), P('\\varphi', 'pressure angle', `${((Q.press || 0) * DEG).toFixed(1)}°`, 'm5')];
    };
    const tex = () => geo() ? genevaTex : camTex;
    const eq = () => geo() ? ['r = a sin(π/n)', 'ω₂/ω₁ = λ(cos α − λ)/(1 − 2λ cos α + λ²)'] : ['s = h (x − sin 2πx / 2π)', 'tan φ = (ds/dθ) / R'];
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(star|lock|pin|cam|roller|follower)$/.test(q.id)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: geo() ? 'Pin and slot' : 'Cam and roller', sub: geo() ? 'The pin enters along the slot axis: no shock' : 'The roller rides the pitch curve', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: geo() ? 'From above: step, then dwell' : 'From above: the cam outline', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['star', 'pin', 'lock', 'cam', 'roller', 'spring'], skip: ['base', 'shaft'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS[0], STEPS[1], STEPS[2], STEPS[3], ...tour.pick(3).map(focusStep)]; };
    const show = s => {
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

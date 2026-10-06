// ============================================================================
//  MANUAL GEARBOX  ·  main.js — shifts, run, panels, speed bars, loop, saver
// ----------------------------------------------------------------------------
//  Shows one 5-speed gearbox: box.js for the gear train, scene.js for its
//  3D parts (kit.js, teeth.js), stage.js for the renderer and the camera,
//  cards.js for the part cards and labels. The panel code follows the
//  geneva-cams page; the unit picker is the gear selector here.
//
//  MOTION
//    S.thIn, the input angle, grows at the input rpm. box.angles() turns
//    every gear from it, so the free gears always turn. S.thOut is the main
//    shaft: its speed S.wOut eases to input speed / ratio of the engaged
//    gear (the synchro), and in neutral it coasts down slowly.
//
//  SHIFT (function shift / stepShift)
//    out ..... the engaged sleeve slides back to the middle (0.35 s)
//    across .. the lever moves through the gate to the new rail (0.35 s)
//    in ...... the new sleeve slides onto its dogs (0.5 s); the main shaft
//              speed is brought to the new gear speed in this phase
//
//  GREP MAP
//    const GATE ................. lever angles for each gear
//    function shift / stepShift . the three shift phases
//    function drawPlot .......... the speed bars
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, shift, pose, stage, cards, bars
//    window.snSaver ............. screensaver hook: shifts and close-ups
// ============================================================================
import * as THREE from 'three';
import { SPEC, GEARS, ratio, gearSpeed, sleeveX, TAU } from './box.js';
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
const NAMES = ['Neutral', '1st', '2nd', '3rd', '4th', '5th'];

let saverOn = false, saverTick = null, saverBand = null;
const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, thIn: 0, thOut: 0, wOut: 0, rpm: 20, lastRpm: 20, gear: 0, sx: { h12: 0, h34: 0, h5: 0 }, lever: [0, 0],
  shiftQ: null, auto: true, autoT: 0, view: 'three', explode: 0, explodeTarget: 0, section: true,
  showLabels: !PHONE_Q.matches, anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.thOut,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── build ───────────────────────────────────────────────────────────────────
const ABOUT = [
  ['Constant mesh', 'Every gear pair is in mesh all the time, and every free gear on the main shaft turns all the time. A shift does not slide gears into mesh: it only picks which free gear the main shaft is locked to.'],
  ['Synchromesh', 'Before the sleeve can lock a gear, the gear and the shaft must turn at the same speed. The blocker ring presses a cone clutch onto the gear: friction matches the speeds, then the sleeve slides over the dogs.'],
  ['Ratios', 'Every ratio is (36/24) × (N_main / N_lay). A low gear puts a small layshaft gear on a large main gear. 4th skips the layshaft: the sleeve locks the main shaft to the input gear, 1 : 1. 5th is an overdrive.'],
  ['What the model leaves out', 'No reverse idler, no clutch, no inertia of the car: the main shaft speed eases to the new gear speed while the sleeve engages.'],
];
function boot() {
  const B = createBuild(), sc = build(B);
  S.cur = { id: 'box', B, sc, PARTS: partsFor(), alpha: 0, t0: performance.now() };
  B.setAlpha(0.001); B.setSection(S.section);
  sc.pose({ thIn: 0, thOut: 0, sx: S.sx, lever: S.lever });
  stage.root.add(B.root);
  cards.reset();
  stage.setShadowExtent(sc.box.R, new THREE.Vector3(...sc.box.c));
  stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
  const seen = new Set(), P = S.cur.PARTS;
  const ids = Object.values(B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
  $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
  $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
  $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
  fillEqs();
  setView('three', true);
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 35, el: 30, explode: 0, k: 1, at: [100, -30, 0] },
  gears: { az: 20, el: 18, explode: 0, k: 0.55, at: [100, -45, 0] },
  sync: { az: 50, el: 30, explode: 0, k: 0.35, at: [108, 0, 0] },
  top: { az: 0, el: 80, explode: 0, k: 0.95, at: [100, 0, 0] },
  exploded: { az: 28, el: 22, explode: 1, k: 1.4, at: [100, 60, 0] },
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
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k), target: new THREE.Vector3(...v.at), t: soft ? 1.8 : 1.4 });
  setExplode(v.explode);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── shifting ────────────────────────────────────────────────────────────────
// lever: [tilt about z (along the gate), tilt about x (across the gate)]
const RAIL_X = { h12: -0.2, h34: 0, h5: 0.2 };
const GATE = g => { if (!g) return [0, 0]; const G = GEARS.find(q => q.g === g); return [-G.side * 0.28, RAIL_X[G.hub]]; };
function shift(to) {
  if (to === S.gear && !S.shiftQ) return;
  S.shiftQ = { from: S.shiftQ ? S.shiftQ.to : S.gear, to, phase: 'out', t: 0, lever0: S.lever.slice() };
  S.gear = 0;
  markGear(to);
}
function stepShift(dt) {
  const q = S.shiftQ; if (!q) return;
  q.t += dt;
  const span = { out: 0.35, across: 0.35, in: 0.5 }[q.phase], k = ease(Math.min(1, q.t / span));
  if (q.phase === 'out') {
    S.sx = sleeveX(q.from, 1 - k);
    S.lever = [q.lever0[0] * (1 - k), q.lever0[1]];
  } else if (q.phase === 'across') {
    S.lever = [0, q.lever0[1] + (GATE(q.to)[1] - q.lever0[1]) * k];
  } else {
    const tgt = GATE(q.to);
    S.lever = [tgt[0] * k, tgt[1]];
    S.sx = sleeveX(q.to, k);
    if (q.to) { const want = S.rpm / 60 * TAU * gearSpeed(q.to); S.wOut += (want - S.wOut) * Math.min(1, dt * 9); }
  }
  if (q.t >= span) {
    q.t = 0;
    if (q.phase === 'out') { q.phase = 'across'; q.lever0 = S.lever.slice(); }
    else if (q.phase === 'across') q.phase = 'in';
    else { S.gear = q.to; S.shiftQ = null; }
  }
}
function markGear(g) { document.querySelectorAll('#variants .mv').forEach(b => b.classList.toggle('on', +b.dataset.g === g)); }
function buildPicker() {
  $('variants').innerHTML = [0, 1, 2, 3, 4, 5].map(g => `<button class="mv" type="button" data-g="${g}"><b>${g || 'N'}</b><span>${g ? `ratio ${ratio(g).toFixed(2)}` : 'neutral'}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => { setAuto(false); shift(+b.dataset.g); }));
}
function setAuto(on) { S.auto = on; S.autoT = 0; $('tAuto').classList.toggle('on', on); }
$('tAuto').addEventListener('click', () => setAuto(!S.auto));
const AUTO = [1, 2, 3, 4, 5, 0];

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
function setShow(what, on) {
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); S.cur.B.setSection(on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tSection').addEventListener('click', () => setShow('section', !S.section));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'unit';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
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

// ── speeds (bars) ───────────────────────────────────────────────────────────
// Each bar is one shaft or gear speed as a share of the input speed. Gears
// in the power path are gilt, free gears blue, the main shaft pink.
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d'), win = S.rpm / 60 * TAU || 1;
  const rows = [['input', 1, true], ['layshaft', SPEC.input.N / SPEC.layIn.N, true], ...[1, 2, 3, 5].map(k => [`${NAMES[k]} gear`, gearSpeed(k), S.gear === k]), ['main shaft', S.rpm ? Math.abs(S.wOut) / win : 0, true]];
  const max = 1.25, pad = 8 * dpr, rh = (h - 2 * pad) / rows.length, lw = 74 * dpr;
  g.clearRect(0, 0, w, h);
  g.font = `${10 * dpr}px ui-monospace,Menlo,monospace`; g.textBaseline = 'middle';
  rows.forEach(([name, v, hot], i) => {
    const y = pad + i * rh, bw = (w - lw - 2 * pad - 30 * dpr) * Math.min(1, v / max);
    g.fillStyle = 'rgba(141,144,166,0.9)'; g.fillText(name, pad, y + rh / 2);
    g.fillStyle = name === 'main shaft' ? '#e9a0a8' : hot ? '#e2c27a' : 'rgba(143,176,255,0.55)';
    g.fillRect(lw, y + rh * 0.22, bw, rh * 0.56);
    g.fillStyle = '#dcdde6'; g.fillText(v.toFixed(2), lw + bw + 4 * dpr, y + rh / 2);
  });
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const win = S.rpm, g = S.gear, wo = S.wOut / TAU * 60;
  const html = `<tr><th>Gearbox</th><th></th></tr>` + row('Gear', S.shiftQ ? `to ${NAMES[S.shiftQ.to]}` : NAMES[g]) + row('Input', `${win} rpm`) +
    row('Layshaft', `${(win * SPEC.input.N / SPEC.layIn.N).toFixed(1)} rpm`) + row('Main shaft', `${wo.toFixed(1)} rpm`) +
    row('Ratio i', g ? ratio(g).toFixed(3) : '—') + row('Torque ×', g ? ratio(g).toFixed(2) : '0') +
    `<tr><th>Ratios</th><th></th></tr>` + [1, 2, 3, 4, 5].map(k => row(NAMES[k] + (k === g ? ' (in)' : ''), ratio(k).toFixed(3))).join('');
  const msg = S.shiftQ ? { out: 'The sleeve slides back to neutral.', across: 'The lever crosses the gate to the next rail.', in: 'The synchro matches speeds; the sleeve locks the gear.' }[S.shiftQ.phase]
    : g === 4 ? 'Direct drive: the main shaft is locked to the input gear.' : g ? 'The sleeve locks this gear to the main shaft.' : 'No gear is locked: the main shaft coasts.';
  $('now').innerHTML = `<b>${S.shiftQ ? 'Shifting' : NAMES[g]}</b><span>${msg}</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const E = [
    ['Ratio', 'i = (36/24) · (N_main / N_lay)', '4th: i = 1, direct'],
    ['Centre distance', 'C = m (N_main + N_lay) / 2 = 90 mm', 'every pair has 60 teeth'],
    ['Speed and torque', 'ω_out = ω_in / i,  T_out = i · T_in', 'no losses'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}
function liveValue(key) {
  const win = S.rpm;
  switch (key) {
    case 'win': return ['Input', `${win} rpm`];
    case 'wlay': return ['Layshaft', `${(win * SPEC.input.N / SPEC.layIn.N).toFixed(1)} rpm`];
    case 'wout': return ['Main shaft', `${(S.wOut / TAU * 60).toFixed(1)} rpm`];
    case 'gear': return ['Gear', S.shiftQ ? 'shifting' : NAMES[S.gear]];
    case 'g1': case 'g2': case 'g3': case 'g5': { const k = +key[1]; return ['Speed', `${(win * gearSpeed(k)).toFixed(1)} rpm · ${S.gear === k ? 'locked' : 'free'}`]; }
  }
  return [key, '—'];
}
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  $('read').innerHTML = `<span class="hi">${S.shiftQ ? 'Shifting to ' + NAMES[S.shiftQ.to] : NAMES[S.gear]}</span><br><span class="lo">in ${S.rpm} rpm · out ${(S.wOut / TAU * 60).toFixed(1)} rpm${S.gear ? ` · i ${ratio(S.gear).toFixed(2)}` : ''}</span>`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const win = S.rpm / 60 * TAU;
  if (S.auto && !S.shiftQ && S.rpm && (S.autoT += dt) > (saverOn ? 2.6 : 3.5)) { S.autoT = 0; shift(AUTO[(AUTO.indexOf(S.gear) + 1) % AUTO.length]); }
  stepShift(dt);
  if (S.gear) S.wOut += (win * gearSpeed(S.gear) - S.wOut) * Math.min(1, dt * 9);
  else if (!S.shiftQ || S.shiftQ.phase !== 'in') S.wOut *= Math.exp(-dt * 0.25);
  S.thIn += win * dt; S.thOut += S.wOut * dt;
  S.cur.sc.pose({ thIn: S.thIn, thOut: S.thOut, sx: S.sx, lever: S.lever });
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  S.cur.B.applyExplode(S.explode);
  const age = (now - S.cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== S.cur.alpha) { S.cur.alpha = al; S.cur.B.setAlpha(Math.max(0.001, al)); }
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) { readout(); if ((numT += dt) > 0.15) { numT = 0; fillNums(); } drawPlot(); }
  else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__gearbox = { S, stage, cards, shift, setView, setRpm, setExplode, setShow, setOpen, setAna, setAuto };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker(); markGear(0);
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('legend').innerHTML = '<span class="lo"><i></i>in the power path</span><span class="lw"><i></i>turning free</span><span class="la"><i></i>main shaft</span>';
setRpm(20); setExplode(0); setAuto(true);
stage.place({ az: -50, el: 30, r: 2200, target: new THREE.Vector3(100, -30, 0) });
boot();
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
// As on the differential page: the projected centre and radius of the
// visible meshes of the subject, in page CSS px.
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs) {
  const cv = $('view'), rc = cv.getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height) return null;
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
  return { x: C.x, y: C.y, r, pts: [] };
}

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and plays
// the gearbox through its gears (auto shift every 2.6 s) while the camera
// tours: whole box, then the gear set, the synchro, from above and exploded
// in a seeded order, then close-ups of 3 parts (lib/mech-tour.js). Each step
// holds seconds/10 (at least 5 s). No exit(): the shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#labels,#leader,#read,.tip,#nogl,#gear{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none}';
    document.head.appendChild(st);
    setOpen(false); setAna(false); setShow('labels', false);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    setRpm(Math.round(24 - 10 * calm)); setAuto(true);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const RULES = [['i', 'm1'], ['\\omega_{in}', 'm2'], ['\\omega_{out}', 'm3'], ['C', 'm5']];
    const Pp = (sym, name, value, cls) => ({ sym, name, value, cls });
    const tex = [String.raw`i = \frac{36}{24}\cdot\frac{N_{main}}{N_{lay}}`, String.raw`\omega_{out} = \frac{\omega_{in}}{i},\qquad C = \frac{m\,(N_{main}+N_{lay})}{2} = 90\ \text{mm}`];
    const eq = ['i = (36/24) · N_main/N_lay', 'ω_out = ω_in / i'];
    const params = () => [Pp('i', 'ratio', S.gear ? ratio(S.gear).toFixed(2) : '—', 'm1'), Pp('\\omega_{in}', 'input', `${S.rpm} rpm`, 'm2'), Pp('\\omega_{out}', 'main shaft', `${(S.wOut / TAU * 60).toFixed(1)} rpm`, 'm3')];
    const sub = () => S.shiftQ ? `Shifting to ${NAMES[S.shiftQ.to]}` : `In ${NAMES[S.gear].toLowerCase()}`;
    const all = () => Object.values(S.cur.B.parts).map(q => q.holder);
    const some = re => Object.values(S.cur.B.parts).filter(q => re.test(q.id)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: 'Five-speed manual gearbox', sub: sub(), params: params(), tex, eq, anchor: () => plateAnchor(all()) }) },
      { view: 'gears', lab: () => ({ title: 'Constant mesh', sub: 'Every pair is in mesh; the free gears always turn', params: params(), tex, eq, anchor: () => plateAnchor(some(/^(g\d|lay|inShaft)$/)) }) },
      { view: 'sync', lab: () => ({ title: 'Synchromesh', sub: 'The sleeve slides onto the dog teeth of its gear', params: params(), tex, eq, anchor: () => plateAnchor(some(/^(sh12|g1|g2|fh12)$/)) }) },
      { view: 'top', lab: () => ({ title: 'From above', sub: sub(), params: params(), tex, eq, anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', lab: () => ({ title: 'Exploded view', sub: 'Five-speed manual gearbox', params: params(), tex, eq, anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['sleeve', 'gear1', 'gear2', 'lay', 'fork', 'lever'], skip: ['case', 'mainShaft', 'inShaft', 'rail'] });
    const focusStep = info => ({ focus: info, lab: () => { const t = tour.plate(info, 'Five-speed manual gearbox'); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [], n = 0, stepT = 0, labT = 0, lastLab = '', now = null;
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const makePlan = () => { tour.unit(); plan = [STEPS[0], ...shuffle(STEPS.slice(1)), ...tour.pick(3).map(focusStep)]; n = 0; };
    const show = s => {
      if (s.focus) tour.show(s.focus);
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded' }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    const advance = () => { if (n >= plan.length) { tour.clear(); makePlan(); } now = plan[n++]; show(now); };
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    window.__mechTour = tour;
    makePlan(); advance();
    return { canvas: $('view'), warmupMs: 1500 };
  },
};

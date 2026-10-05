// ============================================================================
//  DIFFERENTIAL  ·  main.js — variant swap, drive scenarios, panels, loop, saver
// ────────────────────────────────────────────────────────────────────────────
//  Shows one differential at a time: diff.js for the gear chain and the
//  torque split, scene.js for its 3D parts (kit.js, gears.js), analysis.js
//  for the top view, speed trace and numbers. stage.js holds the renderer
//  and the camera; cards.js the part cards and labels.
//
//  MOTION
//    Two angles drive everything: phiC (the carrier) and delta (the right
//    side gear on the carrier). Each frame adds w0·kC·dt and
//    w0·(kR − kL)/2·dt, with kC = (kL + kR)/2, and diff.pose() turns every
//    gear from them. kL and kR ease to the scenario's targets, so a change
//    of scenario never breaks the mesh or the average.
//
//  GREP MAP
//    function swapTo ............ build a differential and cross-fade to it
//    function redrive ........... the scenario's speeds and torque split
//    const VIEWS / function setView  camera presets
//    function setOpen ........... the panel; on a phone one group per tab
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, analysis
//    window.snSaver ............. screensaver hook: a slow tour
// ============================================================================
import * as THREE from 'three';
import { pose, drive, VARIANTS, SCEN, SPEC, BEV, TAU } from './diff.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { createAnalysis } from './analysis.js';
import { partsFor, GROUP_COLOR } from './parts.js';
import { createTour } from '../../lib/mech-tour.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], phiC: 0, delta: 0, kL: 1, kR: 1, rpm: 30, lastRpm: 30,
  scen: 'corner', R: 8, dir: 1, Tin: 250, drv: null,
  explode: 0.5, explodeTarget: 0, section: true, housing: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6, kRate: 2.2,
};
const ana = createAnalysis({ top: $('top'), spd: $('spd'), split: $('split'), splitLab: $('splitLab'), nums: $('nums'), eqs: $('eqs'), now: $('now') });
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.phiC,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();
let saverOn = false, saverTick = () => {};   // the screensaver (end of file)

// ── variant swap ────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(S.section);
    sc.P.housing.holder.visible = S.housing; sc.P.nose.holder.visible = S.housing;
    sc.pose(pose(id, S.phiC, S.delta));
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    redrive();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 90; stage.controls.maxDistance = sc.box.R * 7;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) {}
    if (!saverOn) setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}

// ── the drive scenario ─────────────────────────────────────────────────────
function redrive() {
  if (!S.cur) return;
  S.drv = drive(S.cur.id, S.scen, { Tin: S.Tin, R: S.R, dir: S.dir });
  ana.set(S.cur.id, S.scen, S.drv, { Tin: S.Tin, R: S.R, dir: S.dir });
  $('rpmLab').textContent = S.scen === 'lift' ? 'Wheel' : 'Carrier';
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  open: { title: 'Open differential', kind: 'Spiral bevel final drive · bevel spiders', lede: 'The ring gear turns the carrier; two spider gears on a cross-shaft push the two side gears. In a corner the spiders turn on their pin, so the outer wheel can run faster than the inner one. The torque is always split half and half.' },
  clutch: { title: 'Clutch-type limited slip', kind: 'Bevel spiders · plate clutches · preload spring', lede: 'The same gears as the open unit, with a plate clutch behind each side gear. Steel plates turn with the case, lined plates with the wheels. When the wheels turn at different speeds the plates slip, and the friction sends torque to the slower wheel.' },
  torsen: { title: 'Torsen, helical type', kind: 'Torsen type 2 · parallel-axis helical gears', lede: 'No clutches and no spiders: helical side gears and three pairs of element gears that turn in pockets of the case. Under load the helix thrust and the pocket friction resist a speed difference, so the slower wheel can get up to three times the torque of the faster one.' },
};
const ABOUT = [
  ['Why a car needs one', 'In a turn the outer wheels run a longer path than the inner ones. A solid axle would make one tyre scrub. The differential lets the two wheels turn at different speeds while the engine drives both.'],
  ['The average is fixed', 'The carrier turns at the average of the two wheel speeds: (ωL + ωR)/2 = ωC. If one wheel slows by some amount, the other speeds up by the same amount. Put the car on a lift and turn one wheel: the other turns the other way.'],
  ['Torque goes where it is easiest', 'An open differential always gives both wheels the same torque. That is good in a corner, but on ice the slipping wheel takes very little torque, so the wheel with grip gets very little too. A limited-slip unit lets the slower wheel take more.'],
  ['Final drive', 'The ring and pinion slow the propeller shaft by 41/11 = 3.73 and multiply its torque by the same number. Spiral teeth keep more teeth in contact, so the drive runs quieter and carries more load than straight teeth.'],
  ['What the model leaves out', 'No gear losses, no inertia and no tyre slip angles. The limited-slip numbers are simple rules: a fixed preload plus a friction torque that grows with load for the clutches, and a fixed bias ratio for the Torsen.'],
];
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
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.dataset.part === 'housing' && !S.housing) setShow('housing', true); cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = VARIANTS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 38, el: 24, explode: 0, k: 1, at: [0, -10, 40] },
  gears: { az: 52, el: 40, explode: 0, k: 0.3, at: [0, 0, 6] },
  ring: { az: 78, el: 30, explode: 0, k: 0.36, at: [-24, 0, 86] },
  top: { az: 0, el: 80, explode: 0, k: 0.98, at: [0, 0, 20] },
  exploded: { az: 12, el: 20, explode: 1, k: 1.65, at: [0, 80, 150] },
  inside: { az: 14, el: 42, explode: 0, k: 0.3, at: [30, 0, 0] },
};
// the axle is about 2.5 times as wide as it is tall: a tall canvas (a phone
// in portrait) backs the camera off, the wide views most
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

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) {
  S.explodeTarget = x;
  $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%';
}
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
function setScen(id) {
  S.scen = id;
  document.querySelectorAll('#scens button').forEach(b => b.classList.toggle('on', b.dataset.scen === id));
  $('cornerBox').hidden = id !== 'corner';
  $('tinRow').classList.toggle('dim', id === 'lift');
  $('scenNote').textContent = {
    straight: 'Both wheels run the same path. The spiders ride round with the carrier and do not turn on their pin.',
    corner: 'The rear axle of a car in a turn. The inner wheel slows and the outer wheel speeds up by the same amount.',
    ice: 'The right wheel is on ice and can take only a little torque. Watch where the speed goes, and what the limited-slip units do.',
    lift: 'The car is on a lift, in gear, so the pinion and the carrier cannot turn. Turn one wheel by hand.',
  }[id];
  redrive();
}
document.querySelectorAll('#scens button').forEach(b => b.addEventListener('click', () => setScen(b.dataset.scen)));
function setR(r) { S.R = r; $('radius').value = r; $('radiusV').textContent = `${r} m`; redrive(); }
$('radius').addEventListener('input', e => setR(+e.target.value));
function setDir(d) { S.dir = d; $('dirL').classList.toggle('on', d > 0); $('dirR').classList.toggle('on', d < 0); redrive(); }
$('dirL').addEventListener('click', () => setDir(1));
$('dirR').addEventListener('click', () => setDir(-1));
function setTin(t) { S.Tin = t; $('tin').value = t; $('tinV').textContent = `${t}`; redrive(); }
$('tin').addEventListener('input', e => setTin(+e.target.value));
function setShow(what, on) {
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(on); }
  if (what === 'housing') { S.housing = on; $('tHousing').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) { o.sc.P.housing.holder.visible = on; o.sc.P.nose.holder.visible = on; } }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tSection').addEventListener('click', () => setShow('section', !S.section));
$('tHousing').addEventListener('click', () => setShow('housing', !S.housing));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'diff';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
  ana.redraw();
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
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
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

// ── live values (part cards) ────────────────────────────────────────────────
let L = null;   // this frame: { wL, wR, wC, spin, wP, v }
function liveValue(key) {
  if (!L || !S.cur) return [key, '—'];
  const d = S.drv, lift = S.scen === 'lift', rpm = v => `${(Math.abs(v) < 0.05 ? 0 : v).toFixed(1)} rpm`, nm = v => lift ? '—' : `${Math.round(v)} N·m`;
  switch (key) {
    case 'wL': return ['Left wheel', rpm(L.wL)];
    case 'wR': return ['Right wheel', rpm(L.wR)];
    case 'wC': return ['Carrier', rpm(L.wC)];
    case 'wP': return ['Pinion', rpm(L.wP)];
    case 'spin': return [S.cur.id === 'torsen' ? 'Turning in its pocket' : 'Turning on its pin', rpm(L.spin)];
    case 'TL': return ['Left torque', nm(d.TL)];
    case 'TR': return ['Right torque', nm(d.TR)];
    case 'Tc': return ['Carrier torque', nm(d.Tc)];
    case 'Tin': return ['Pinion torque', lift ? '—' : `${S.Tin} N·m`];
    case 'slipRate': return ['Plate slip', rpm(Math.abs(L.wR - L.wC))];
    case 'Tf': return ['Clutch torque', `${Math.round(SPEC.clutch.pre + SPEC.clutch.c * Math.max(0, d.Tc))} N·m`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const f = v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1);
  $('read').innerHTML = `<span class="hi">${esc(SCEN[S.scen].name)}</span> <span class="lo">· ${esc(INFO[S.cur.id].title)}</span><br>` +
    `<span class="l">ωL ${f(L.wL)}</span> <span class="lo">·</span> <span class="r">ωR ${f(L.wR)}</span> <span class="lo">·</span> <span class="c">ωC ${f(L.wC)}</span> <span class="lo">rpm</span>`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur || !S.drv) return;
  const cur = S.cur, d = S.drv;

  // ease the wheel ratios to the scenario; the carrier is their average
  const a = Math.min(1, dt * S.kRate);
  S.kL += (d.kL - S.kL) * a; S.kR += (d.kR - S.kR) * a;
  const kC = (S.kL + S.kR) / 2;
  const w0 = S.rpm / 60 * TAU;
  // no wrap: the pinion turns 41/11 of the carrier, so a wrap of phiC by
  // 1000 turns moved the pinion and its flange by 0.27 of a turn in one
  // frame. A double keeps sub-micro-radian steps for years of run time.
  S.phiC += w0 * kC * dt;
  S.delta += w0 * (S.kR - S.kL) / 2 * dt;
  const Q = pose(cur.id, S.phiC, S.delta);
  cur.sc.pose(Q);
  for (const o of S.leaving) o.sc.pose(pose(o.id, S.phiC, S.delta));
  const tz = cur.id === 'torsen', Ns = tz ? SPEC.hel.NS : SPEC.side.N, Nq = tz ? SPEC.hel.NP : SPEC.spider.N;
  L = { wL: S.kL * S.rpm, wR: S.kR * S.rpm, wC: kC * S.rpm, spin: (S.kR - S.kL) / 2 * Ns / Nq * S.rpm, wP: kC * S.rpm * BEV.ratio, v: kC * w0 * SPEC.road.tire };

  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);

  const age = (now - cur.t0) / 1000;
  const al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
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
  ana.frame(L, dt);
  readout();
  if (saverOn) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__diff = { S, stage, cards, swapTo, setView, setRpm, setExplode, setScen, setR, setDir, setTin, setShow, setOpen, setAna, pinById: id => cards.pinById(id), pick: (x, y) => cards.pick(x, y) };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(30); setTin(250); setR(8); setDir(1); setExplode(0);
stage.place({ az: -70, el: 30, r: 2200, target: new THREE.Vector3(0, 0, 40) });
const start = (location.hash || '').slice(1);
swapTo(VARIANTS.some(v => v.id === start) ? start : 'open').then(() => setScen('corner'));
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
// The shell's label plate (lib/screensaver.js, "label plate") points at the
// subject of each tour step. plateAnchor(objs, keys) projects with the page
// camera (Vector3.project) to page CSS px of the canvas rect:
//   x, y  the projected centre of the world box of the visible meshes
//   r     the largest distance from (x, y) to a projected corner of the
//         local box of a mesh, clamped to the canvas: the circle holds
//         every mesh of the subject that is on screen
//   pts   the projected key points (world Vector3) that are on screen
// It returns null when the subject is not on screen, or while the canvas
// fades out for a swap (style opacity 0).
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs, keys = []) {
  const cv = $('view'), rc = cv.getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height || cv.style.opacity === '0') return null;
  const px = w => { PA.v.copy(w).project(cam); return PA.v.z > 1 ? null : { x: rc.left + (PA.v.x + 1) / 2 * rc.width, y: rc.top + (1 - PA.v.y) / 2 * rc.height }; };
  const ms = [];
  PA.box.makeEmpty();
  for (const ob of objs) if (ob) ob.traverseVisible(m => {
    if (!m.isMesh || (m.material && m.material.opacity === 0)) return;
    let b;
    if (m.isInstancedMesh) { if (!m.boundingBox) m.computeBoundingBox(); b = m.boundingBox; }
    else { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); b = m.geometry.boundingBox; }
    if (!b || b.isEmpty()) return;
    ms.push([m, b]); PA.mb.copy(b).applyMatrix4(m.matrixWorld); PA.box.union(PA.mb);
  });
  if (PA.box.isEmpty()) return null;
  const C = px(PA.box.getCenter(PA.c));
  if (!C) return null;
  let r = 0;
  for (const [m, b] of ms) for (let i = 0; i < 8; i++) {
    PA.c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
    // A corner off the canvas counts at the canvas edge: in a close view
    // the circle holds the part of the subject that is on screen.
    const q = px(PA.c); if (q) r = Math.max(r, Math.hypot(Math.max(rc.left, Math.min(rc.right, q.x)) - C.x, Math.max(rc.top, Math.min(rc.bottom, q.y)) - C.y));
  }
  if (C.x + r < rc.left || C.x - r > rc.right || C.y + r < rc.top || C.y - r > rc.bottom) return null;
  const pts = [];
  for (const k of keys) { const q = k && px(k); if (q && q.x >= rc.left && q.x <= rc.right && q.y >= rc.top && q.y <= rc.bottom) pts.push(q); }
  return { x: C.x, y: C.y, r, pts };
}
// The world centre of the box of an object: a key point for a part whose
// origin is not at its middle.
const centreOf = ob => new THREE.Box3().setFromObject(ob).getCenter(new THREE.Vector3());

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI, draws the
// stage gradient in the scene, and tours one unit: the whole axle in a
// turn, the gear set, the ring and pinion, the exploded unit, then close-ups
// of 5 exploded parts, the ice test from above, then a fade to the next
// unit. Each step holds seconds/12 (at least 4.5 s) and the camera flies in
// 1.2 s. A close-up frames the meshes of one part (all parts with its info
// id), so that they fill about 45% of the short screen side, and the cards
// hover glow marks them. FOCUS_PREFER parts come first in a seeded order.
// lib/mech-tour.js moves the camera in each step (a seeded move that is
// never the move of the step before, near the front of the view) and
// seeds the explode spread and the close-up mode of each unit. calm (1 =
// slowest) slows the wheels and the explode, not the step time. opts.label names the subject of each step: a close-up has
// the part name, group, role and specs of parts.js. No URL hash writes
// while it plays. No exit(): the shell reloads the page.
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
    setOpen(false); setAna(false);
    setShow('labels', false); setShow('section', true); setShow('housing', true);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm; S.kRate = 1.4 - 0.8 * calm;
    const RPM = Math.round(30 - 16 * calm);
    setRpm(RPM);
    const hold = Math.max(4.5, (o.seconds || 60) / 12) * 1000;
    const order = ['open', 'clutch', 'torsen'];
    const first = Math.floor(rnd() * 3);
    const canvas = $('view');
    const name = () => INFO[S.cur.id].title;
    const f1 = v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1);
    const torqueEq = () => S.cur.id === 'open' ? 'T_L = T_R = T_C / 2' : S.cur.id === 'clutch' ? 'T_slow − T_fast ≤ T_pre + c · T_C' : 'T_slow / T_fast ≤ TBR = 3';
    // Plate fields. params and TeX share one colour map (RULES): ω_L m1,
    // ω_R m2, ω_C m3, ω_s and ω_e m4, T m5, ω_p m6. The plain eq lists stay
    // as the fallback. Anchors: plateAnchor() on the step's parts; the key
    // points are gear or wheel centres (centreOf).
    // L is null until the first frame: a label built before it reads zeros.
    const LL = () => L || { wL: 0, wR: 0, wC: 0, spin: 0, wP: 0 };
    const RULES = [['\\omega_L', 'm1'], ['\\omega_R', 'm2'], ['\\omega_C', 'm3'], ['\\omega_s', 'm4'], ['\\omega_e', 'm4'], ['T_L', 'm5'], ['T_R', 'm5'], ['T_C', 'm5'], ['\\omega_p', 'm6']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const rpm = v => `${f1(v)} rpm`;
    const torqueTex = () => S.cur.id === 'open' ? String.raw`T_L = T_R = \frac{T_C}{2}` : S.cur.id === 'clutch' ? String.raw`T_{\text{slow}} - T_{\text{fast}} \le T_{\text{pre}} + c\,T_C` : String.raw`\frac{T_{\text{slow}}}{T_{\text{fast}}} \le \text{TBR} = 3`;
    const TAVG = String.raw`\omega_C = \frac{\omega_L + \omega_R}{2}`;
    const parts = re => Object.values(S.cur.B.parts).filter(q => re.test(q.id));
    const an = (re, keys) => () => plateAnchor(parts(re).map(q => q.holder), parts(keys).map(q => centreOf(q.holder)));
    const DIFF = /^(?!wheel|axle)/, GEARS = /^(side[LR]|spider[TB]|elem.*|crossShaft)$/;
    const STEPS = [
      { view: 'three', scen: 'corner', lab: () => ({ title: name(), sub: `In a ${S.R} m ${S.dir > 0 ? 'left' : 'right'} turn`, params: [P('\\omega_L', 'left wheel', rpm(LL().wL), 'm1'), P('\\omega_R', 'right wheel', rpm(LL().wR), 'm2'), P('\\omega_C', 'carrier', rpm(LL().wC), 'm3')], lines: ['The carrier runs at the average of the two wheels.', 'The outer wheel runs the longer path.'], tex: [TAVG, torqueTex()], eq: ['ω_C = (ω_L + ω_R) / 2'], anchor: an(DIFF, /^(ring|pinion|side[LR])$/) }) },
      { view: S => S.cur.id === 'torsen' ? 'inside' : 'gears', scen: 'corner', lab: () => S.cur.id === 'torsen'
        ? ({ title: 'Helical element gears', sub: 'Three pairs in pockets of the case', params: [P('\\omega_e', 'element gears', rpm(Math.abs(LL().spin)), 'm4'), P('\\omega_L', 'left', rpm(LL().wL), 'm1'), P('\\omega_R', 'right', rpm(LL().wR), 'm2')], lines: ['Each element meshes with one side gear and its partner.', 'Pocket friction resists the speed difference.'], tex: [String.raw`\omega_e = \frac{\omega_R - \omega_L}{2}\cdot\frac{18}{9}`, torqueTex()], eq: ['ω_e = (ω_R − ω_L)/2 · 18/9'], anchor: an(GEARS, /^(side[LR]|elem.*)$/) })
        : ({ title: S.cur.id === 'clutch' ? 'Spiders and clutch packs' : 'Spider and side gears', sub: 'The differential gears', params: [P('\\omega_s', 'spiders on their pin', rpm(Math.abs(LL().spin)), 'm4'), P('\\omega_L', 'left', rpm(LL().wL), 'm1'), P('\\omega_R', 'right', rpm(LL().wR), 'm2')], lines: ['Each spider pushes both side gears equally.', S.cur.id === 'clutch' ? 'Lined plates slip against the steel plates.' : 'Straight ahead, the spiders stand still on the pin.'], tex: [String.raw`\omega_s = \frac{\omega_R - \omega_L}{2}\cdot\frac{16}{10}`, TAVG], eq: ['ω_s = (ω_R − ω_L)/2 · 16/10'], anchor: an(GEARS, /^(side[LR]|spider[TB])$/) }) },
      { view: 'ring', scen: 'straight', lab: () => ({ title: 'Ring and pinion', sub: `Spiral bevel, ${SPEC.ring.N}:${SPEC.pinion.N}`, params: [P('\\omega_p', 'pinion', rpm(LL().wP), 'm6'), P('\\omega_C', 'carrier', rpm(LL().wC), 'm3'), P('i', 'ratio, ring to pinion teeth', BEV.ratio.toFixed(3), '')], lines: ['The torque is multiplied by i at the carrier.', 'The drive turns through a right angle.'], tex: [String.raw`\omega_p = i\,\omega_C, \qquad i = \frac{N_{\text{ring}}}{N_{\text{pinion}}} = \frac{${SPEC.ring.N}}{${SPEC.pinion.N}}`], eq: [`ω_p = ${BEV.ratio.toFixed(3)} · ω_C`], anchor: an(/^(ring|pinion)$/, /^(ring|pinion)$/) }) },
      { view: 'exploded', scen: 'corner', lab: () => ({ title: 'Exploded view', sub: name(), params: [P('\\omega_C', 'carrier', rpm(LL().wC), 'm3')], lines: ['Housing lifts off; the case halves part on the axle.', 'Ring gear, side gears and half-shafts slide out on x.'], tex: [torqueTex(), TAVG], eq: [torqueEq()], anchor: an(DIFF, /^(ring|pinion)$/) }) },
      { view: 'top', scen: 'ice', lab: () => ({ title: 'One wheel on ice', sub: name(), params: [P('\\omega_R', 'ice wheel', rpm(LL().wR), 'm2'), P('\\omega_L', 'dry wheel', rpm(LL().wL), 'm1'), P('T_L', 'left torque', `${Math.round(S.drv.TL)} N·m`, 'm5'), P('T_R', 'right torque', `${Math.round(S.drv.TR)} N·m`, 'm5')], lines: [S.drv.moving ? 'The car moves off.' : 'The car is stuck: the dry wheel stands still.'], tex: [torqueTex(), TAVG], eq: [torqueEq()], anchor: an(/./, /^(wheel[LR]|ring)$/) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    // Close-ups (lib/mech-tour.js): FOCUS_PREFER parts first, in a seeded
    // order. FOCUS_SKIP parts are too large to frame as one part.
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold,
      prefer: ['spider', 'side', 'ring', 'pinion', 'frictionPlate', 'steelPlate', 'spring', 'hside', 'elemA', 'elemB', 'crossShaft'],
      skip: ['housing', 'wheelL', 'wheelR', 'axle', 'case'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, name()); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    const pickFocus = () => tour.pick(5);
    // The plan of one unit: STEPS 0-2, the exploded unit, the close-ups,
    // then STEPS 4 (the ice test, assembled).
    let plan = [];
    // A unit: a seeded spread and close-up mode (tour.unit), and in 'circle'
    // or 'mixed' mode, sometimes a pull-back on the whole exploded stack.
    const makePlan = () => {
      const u = tour.unit(), F = pickFocus().map(focusStep);
      if (u.mode !== 'flyby' && rnd() < 0.6) F.push({ ...STEPS[3], still: true, stack: true });
      plan = [STEPS[0], STEPS[1], STEPS[2], { ...STEPS[3], still: true }, ...F, STEPS[4]];
    };
    // The exploded unit and the close-ups stand still: the spiders and the
    // element gears ride in the carrier and would leave a close frame.
    const show = s => {
      setRpm(s.still ? 0 : RPM);
      // a close-up shows the whole part: no section cut
      setShow('section', !s.focus);
      if (s.focus) tour.show(s.focus);
      else {
        tour.clear();
        if (s.scen === 'corner') { setDir(rnd() < 0.5 ? 1 : -1); setR([6, 8, 10, 14][Math.floor(rnd() * 4)]); }
        setScen(s.scen);
        setView(typeof s.view === 'function' ? s.view(S) : s.view, true);
        tour.fromFly({ kind: s.stack ? 'stack' : 'view', move: s.stack ? 'pull' : null });
      }
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
    saverTick = dt => {
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 2 && now) {
        labT = 0;
        const l = now.lab(), js = JSON.stringify(l);
        if (js !== lastLab) { lastLab = js; label(l); }
      }
    };
    (async () => { if (!S.cur || S.cur.id !== order[first]) await swapTo(order[first]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};

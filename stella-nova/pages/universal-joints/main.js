// ============================================================================
//  UNIVERSAL & CV JOINTS  ·  main.js — unit swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one joint at a time: mech.js for the kinematics, scene.js for its
//  3D parts (kit.js), stage.js for the renderer and the camera, cards.js
//  for the part cards and labels. A copy of the linkages main.js with the
//  joint text, the shaft angle, the plot and the saver steps.
//
//  MOTION
//    Two numbers set the pose: S.th, the input angle (rad), and S.beta, the
//    shaft angle (rad). Each frame adds rpm / 60 * 2 pi * dt to S.th.
//    sc.pose(S.th, S.beta, S.phase) places every part and returns the
//    mech.js solve() result: out, err, mid, balls, cage, shift.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function setBeta / setPhase  shaft angle and middle fork phase
//    function curves / drawPlot . output angle error and speed ratio
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a seeded tour of each
//                                 joint, with part close-ups
// ============================================================================
import * as THREE from 'three';
import { UNITS, solve, ratio, midRatio, cardanPsi, TAU, DEG as D } from './mech.js';
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
const ph360 = th => ((((th % TAU) + TAU) % TAU) * DEG);

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0.3, rpm: 30, lastRpm: 30, Q: null, view: 'three', beta: 25 * D, phase: 0,
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
const isDouble = id => id === 'doubleZ' || id === 'doubleW';

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
    S.Q = sc.pose(S.th, S.beta, isDouble(id) ? S.phase : 0);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    $('tPhase').hidden = !isDouble(id);
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  cardan: { title: 'Cardan joint', kind: 'Hooke joint · speed ripple', lede: 'Two forks and a cross. It passes rotation between two shafts at an angle, and it is cheap and strong. But the output does not turn steadily: it runs ahead, then falls behind, twice per turn. At 25° the output speed swings by ±10 %.' },
  doubleZ: { title: 'Double Cardan · Z', kind: 'Parallel shafts · ripple cancels', lede: 'Two Cardan joints with an intermediate shaft. The input and output are parallel, offset to one side, as on a car propeller shaft. The second joint makes the opposite error to the first, so the output turns exactly with the input.' },
  doubleW: { title: 'Double Cardan · W', kind: 'Shafts meet · ripple cancels', lede: 'The same two joints, but the output bends on by another β, so the outer shafts meet at a point. With equal angles and the middle forks in phase, the ripple of the first joint is again undone by the second.' },
  rzeppa: { title: 'Rzeppa CV joint', kind: 'Constant velocity · 1926', lede: 'Six balls in curved grooves carry the torque between an outer bell and an inner race. A cage keeps every ball on the plane that bisects the shaft angle. Each ball is then the same distance from both shafts, so both turn at the same speed at every instant. Every front-drive car has them.' },
};
const ABOUT = {
  cardan: [
    ['The ripple', 'The cross keeps its arms at 90°. When the input fork lies in the plane of the shafts, the output runs fast by 1/cos β; a quarter turn later it runs slow by cos β. tan ψ = tan θ / cos β.'],
    ['Why it matters', 'The average speed is the same, but the output shaft speeds up and slows down twice per turn. That shakes the drive line and loads the bearings. At small angles (a few degrees) it is acceptable.'],
    ['History', 'Gerolamo Cardano described the gimbal; Robert Hooke built the joint in the 1670s and gave the formula for its uneven motion.'],
  ],
  doubleZ: [
    ['Two rules', 'Both joint angles must be equal, and the two forks of the intermediate shaft must be in one plane. Then the second joint is a mirror of the first.'],
    ['The middle shaft', 'The intermediate shaft still ripples between cos β and 1/cos β of the input speed. Only the output is steady, so a heavy middle shaft still shakes at high speed.'],
    ['Phase error', 'Turn the middle forks 90° (the button under the slider). The errors now add: the output error is twice that of one joint. Mechanics check this when a propeller shaft is put back together.'],
  ],
  doubleW: [
    ['Shafts that meet', 'In the W (or V) arrangement, the outer shafts meet at a point, at 2β. The ripple still cancels when the angles are equal and the middle forks are in phase.'],
    ['Double Cardan CV', 'Bring the two crosses close together with a centring device in between, and you get a compact double Cardan CV joint. Trucks and tractors use them for steered axles.'],
    ['Phase error', 'With the middle forks 90° apart, the errors add, as in the Z arrangement.'],
  ],
  rzeppa: [
    ['The bisecting plane', 'The plane through the joint centre at β/2 to each shaft is a mirror between them. A ball on that plane is the same distance from both axes, so the ball moves at one speed in both grooves.'],
    ['The cage', 'The cage holds all six balls on that plane. The groove centres are offset, so the grooves push the cage there as the angle changes. Here it tilts by β/2.'],
    ['In the windows', `The balls do not stay evenly spaced on the tilted plane: each moves a little to and fro in its cage window. The model shows up to ±1.8° at β = 40°.`],
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
  three: { az: 28, el: 26, explode: 0, k: 1, at: null },
  close: { az: 40, el: 22, explode: 0, k: 0.42, at: 'joint' },
  top: { az: 0, el: 78, explode: 0, k: 0.95, at: null },
  side: { az: 90, el: 14, explode: 0, k: 0.85, at: null },
  exploded: { az: 34, el: 30, explode: 1, k: 1.3, at: null },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.1 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  const at = v.at === 'joint' ? S.cur.sc.keys.joint : S.cur.sc.box.c;
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
function setBeta(deg) {
  deg = Math.max(0, Math.min(40, deg));
  S.beta = deg * D;
  $('beta').value = deg; $('betaV').textContent = `${deg.toFixed(1)}°`;
  plotCache = null;
}
$('beta').addEventListener('input', e => setBeta(+e.target.value));
function setPhase(p) {
  S.phase = p ? 1 : 0;
  $('tPhase').classList.toggle('on', !S.phase);
  $('tPhase').textContent = S.phase ? 'Middle forks 90° apart (wrong)' : 'Middle forks in phase';
  plotCache = null;
}
$('tPhase').addEventListener('click', () => setPhase(!S.phase));
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
// Over one input turn at the current beta: the output angle error psi - th
// (o, degrees) and the speed ratio minus 1 (w). Both share a scale with the
// single Cardan joint at the same beta (a, drawn faint), so a joint that
// cancels the ripple draws a flat line, not its rounding noise.
const COL = { o: '#e2c27a', w: '#8fb0ff', a: 'rgba(233,160,168,0.55)' };
function curves() {
  const id = S.cur.id, N = 360, ph = isDouble(id) ? S.phase : 0, out = { o: [], w: [], a: [], ar: [] };
  for (let i = 0; i <= N; i++) {
    const th = i / N * TAU;
    out.o.push(solve(id, th, S.beta, ph).err * DEG);
    out.w.push(ratio(id, th, S.beta, ph) - 1);
    out.a.push((cardanPsi(th, S.beta) - th) * DEG);
  }
  out.oMax = Math.max(0.5, ...out.o.map(Math.abs), ...out.a.map(Math.abs));
  out.wMax = Math.max(0.02, ...out.w.map(Math.abs), 1 / Math.cos(S.beta) - 1);
  out.lab = [['lo', 'output angle error ψ − θ'], ['lw', 'speed ratio ω₂/ω₁ − 1']];
  if (id !== 'cardan') out.lab.push(['la', 'one Cardan joint, for scale']);
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
    const o = off.getContext('2d'), pad = 10 * dpr, X = i => pad + (w - 2 * pad) * i / 360, mid = h / 2, Hh = h / 2 - pad - 4 * dpr;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    const line = (arr, max, col, wd = 1.6) => {
      o.strokeStyle = col; o.lineWidth = wd * dpr; o.beginPath();
      arr.forEach((v, i) => { const y = mid - (v / max) * Hh; i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); });
      o.stroke();
    };
    if (S.cur.id !== 'cardan') { o.setLineDash([4 * dpr, 4 * dpr]); line(C.a, C.oMax, COL.a, 1.2); o.setLineDash([]); }
    line(C.w, C.wMax, COL.w);
    line(C.o, C.oMax, COL.o);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    o.fillStyle = COL.o; o.fillText(`±${C.oMax.toFixed(2)}°`, pad + 3 * dpr, pad + 9 * dpr);
    o.fillStyle = COL.w; o.textAlign = 'right'; o.fillText(`±${(C.wMax * 100).toFixed(1)} %`, w - pad - 3 * dpr, pad + 9 * dpr);
    $('legend').innerHTML = C.lab.map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X, C };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const x = plotCache.X(ph360(S.th));
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
const ph = () => (isDouble(S.cur.id) ? S.phase : 0);
function fillNums() {
  const id = S.cur.id, Q = S.Q, b = S.beta * DEG, rt = ratio(id, S.th, S.beta, ph());
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>` + row('Shaft angle β', `${b.toFixed(1)}°`) + row('Input θ', `${ph360(S.th).toFixed(1)}°`) + row('Output ψ', `${ph360(Q.out).toFixed(1)}°`) + row('Error ψ − θ', `${(Q.err * DEG).toFixed(3)}°`) + row('Speed ratio ω₂/ω₁', rt.toFixed(4));
  if (id === 'cardan') {
    html += row('Range cos β .. 1/cos β', `${Math.cos(S.beta).toFixed(4)} .. ${(1 / Math.cos(S.beta)).toFixed(4)}`);
    $('now').innerHTML = rt > 1 ? '<b>Output fast</b><span>The input fork is near the plane of the shafts.</span>' : '<b>Output slow</b><span>The input fork is near 90° to the plane of the shafts.</span>';
  } else if (isDouble(id)) {
    html += row('Middle shaft ratio', midRatio(id, S.th, S.beta, ph()).toFixed(4)) + row('Middle forks', S.phase ? '90° apart' : 'in phase') + row('Output axis', id === 'doubleZ' ? 'parallel to input' : `${(2 * b).toFixed(1)}° to input`);
    $('now').innerHTML = S.phase ? '<b>Errors add</b><span>The middle forks are 90° apart: the output ripples twice as much as one joint.</span>' : '<b>Ripple cancels</b><span>The middle shaft ripples; the output turns with the input.</span>';
  } else {
    const sh = Math.max(...Q.shift.map(Math.abs)) * DEG;
    html += row('Cage tilt', `${(b / 2).toFixed(1)}° (β/2)`) + row('Ball shift in window', `±${sh.toFixed(2)}°`);
    $('now').innerHTML = '<b>Constant velocity</b><span>The balls stay on the bisecting plane.</span>';
  }
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const id = S.cur.id;
  const E = {
    cardan: [['Output angle', 'tan ψ = tan θ / cos β', 'the cross stays square'], ['Speed ratio', 'ω₂/ω₁ = cos β / (1 − sin²β cos²θ)', 'between cos β and 1/cos β'], ['Peak error', 'atan(1/√cos β) − atan(√cos β)', '4.1° at β = 30°']],
    doubleZ: [['Joint 1', 'tan φ = tan θ / cos β', 'the middle shaft ripples'], ['Joint 2', 'tan ψ = tan φ · cos β', 'the mirror of joint 1'], ['Together', 'ψ = θ', 'equal angles, forks in phase']],
    doubleW: [['Joint 1', 'tan φ = tan θ / cos β', 'the middle shaft ripples'], ['Joint 2', 'tan ψ = tan φ · cos β', 'the mirror of joint 1'], ['Together', 'ψ = θ', 'outer shafts at 2β']],
    rzeppa: [['Bisecting plane', 'n = (s₁ + s₂) / |s₁ + s₂|', 'the cage plane, at β/2'], ['Each ball', 'dist(p, axis 1) = dist(p, axis 2)', 'a mirror between the shafts'], ['So', 'ω₂ = ω₁', 'at every angle']],
  }[id];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, id = S.cur.id;
  switch (key) {
    case 'in': return ['Input', `${S.rpm} rpm · ${ph360(S.th).toFixed(0)}°`];
    case 'out': return ['Output', `${ph360(Q.out).toFixed(1)}°`];
    case 'err': return ['Error ψ − θ', `${(Q.err * DEG).toFixed(2)}°`];
    case 'ratio': return ['Speed ratio', ratio(id, S.th, S.beta, ph()).toFixed(3)];
    case 'mid': return ['Middle shaft ratio', isDouble(id) ? midRatio(id, S.th, S.beta, ph()).toFixed(3) : '—'];
    case 'tilt': return ['Cage tilt', `${(S.beta * DEG / 2).toFixed(1)}°`];
    case 'shift': return ['Ball 1 shift', Q.shift ? `${(Q.shift[0] * DEG).toFixed(2)}°` : '—'];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">β ${(S.beta * DEG).toFixed(1)}° · θ ${ph360(S.th).toFixed(0)}° · ψ − θ ${(Q.err * DEG).toFixed(2)}°</span>`;
  $('turnV').textContent = `${ph360(S.th).toFixed(0)}°`;
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
  if (saverTick && saverOn) saverBeta(dt);
  S.Q = cur.sc.pose(S.th, S.beta, ph());
  for (const o of S.leaving) o.sc.pose(S.th, S.beta, isDouble(o.id) ? S.phase : 0);
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
window.__ujoints = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna, setBeta, setPhase };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(30); setExplode(0); setBeta(25); setPhase(0);
stage.place({ az: -40, el: 30, r: 1800, target: new THREE.Vector3(0, -20, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'cardan');
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
// each joint: the whole unit, a close view of the joint, the view from
// above, the exploded unit and close-ups of 2 or 3 parts (lib/mech-tour.js),
// then a fade to the next joint. Each joint gets a seeded shaft angle, and
// the angle swings slowly by +-6 deg about it, so the ripple changes as
// the tour runs. Each step holds seconds/10 (at least 5 s). calm (1 =
// slowest) slows the input, not the step time. No exit(): the shell
// reloads the page.
let saverBeta = () => {};
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
    setOpen(false); setAna(false); setShow('labels', false); setPhase(0);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const RPM = Math.round(30 - 15 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    // the shaft angle: a seeded centre per joint, a slow swing about it
    let bC = 25, bT = 0, bW = 0.05;
    saverBeta = dt => { bT += dt; setBeta(Math.round((bC + 6 * Math.sin(bT * bW * TAU)) * 2) / 2); };
    const RULES = [['\\theta', 'm1'], ['\\psi', 'm2'], ['\\beta', 'm3'], ['\\omega', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = {
      cardan: [String.raw`\tan\psi = \frac{\tan\theta}{\cos\beta}`, String.raw`\frac{\omega_2}{\omega_1} = \frac{\cos\beta}{1-\sin^2\beta\,\cos^2\theta}`],
      doubleZ: [String.raw`\tan\varphi = \frac{\tan\theta}{\cos\beta}`, String.raw`\tan\psi = \tan\varphi\,\cos\beta \;\Rightarrow\; \psi = \theta`],
      doubleW: [String.raw`\tan\varphi = \frac{\tan\theta}{\cos\beta}`, String.raw`\tan\psi = \tan\varphi\,\cos\beta \;\Rightarrow\; \psi = \theta`],
      rzeppa: [String.raw`\hat n = \frac{\hat s_1 + \hat s_2}{|\hat s_1 + \hat s_2|}`, String.raw`\omega_2 = \omega_1`],
    };
    const EQ = { cardan: ['tan ψ = tan θ / cos β'], doubleZ: ['ψ = θ'], doubleW: ['ψ = θ'], rzeppa: ['ω₂ = ω₁'] };
    const tex = () => TEX[S.cur.id], eq = () => EQ[S.cur.id];
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      return [
        P('\\beta', 'shaft angle', `${(S.beta * DEG).toFixed(1)}°`, 'm3'),
        P('\\psi-\\theta', 'output error', `${(Q.err * DEG).toFixed(2)}°`, 'm2'),
        P('\\omega_2/\\omega_1', 'speed ratio', ratio(S.cur.id, S.th, S.beta, 0).toFixed(3), 'm4'),
      ];
    };
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(cross1|cross2|cage|ball\d|inYoke|outYoke|midShaft|midYoke2)$/.test(q.id)).map(q => q.holder);
    const SUB = { cardan: 'The cross keeps its arms square', doubleZ: 'Two joints, equal angles, forks in phase', doubleW: 'Two joints, the outer shafts meet', rzeppa: 'The cage holds the balls on the bisecting plane' };
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: S.cur.id === 'rzeppa' ? 'Balls in the cage' : 'Forks and cross', sub: SUB[S.cur.id], params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: 'From above: the shaft angle', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['cross', 'cage', 'ball', 'inYoke', 'outYoke', 'midShaft', 'bell', 'inner'], skip: ['base', 'fin'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => {
      tour.unit();
      bC = 15 + Math.round(rnd() * 20); bT = 0; bW = 0.03 + 0.04 * rnd();
      // the whole unit first; the other steps and 2-3 close-ups in a seeded order
      const rest = [STEPS[1], STEPS[2], STEPS[3]].sort(() => rnd() - 0.5);
      plan = [STEPS[0], ...rest, ...tour.pick(2 + Math.floor(rnd() * 2)).map(focusStep)];
    };
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

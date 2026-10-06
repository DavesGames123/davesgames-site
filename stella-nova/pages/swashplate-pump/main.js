// ============================================================================
//  SWASHPLATE PISTON PUMP  ·  main.js — pump swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one pump at a time: mech.js for the strokes, the flow and the
//  ports, scene.js for its 3D parts (kit.js), stage.js for the renderer and
//  the camera, cards.js for the part cards and labels. A copy of the
//  geneva-cams main.js with the pump text, plot, swash slider and saver.
//
//  MOTION
//    Two values drive everything: S.th, the barrel angle (rad), and S.b,
//    the swash angle (rad). Each frame adds rpm / 60 * 2 pi * dt to S.th.
//    sc.pose(S.th, S.b) places every part and returns the pump pose
//    (pistons, q, nDel, qMean, stroke). The hand slider sets S.th and
//    pauses the drive. The swash slider sets S.b.
//
//  GREP MAP
//    function swapTo ............ build a pump and cross-fade to it
//    const INFO / ABOUT ......... the panel text
//    const VIEWS / function setView  camera presets
//    function curves / drawPlot . strokes and flow ripple over one turn
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each pump,
//                                 the swash angle sweeps 3 .. 17 degrees
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, D, TAU, pumpPose, flowCurve, ripple, displacement, rating, stroke } from './mech.js';
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
const RATED = 1500;   // rpm for the rated flow and power

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0.3, b: 15 * D, rpm: 15, lastRpm: 15, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, cut: true, showLabels: !PHONE_Q.matches, swapping: false,
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

// ── pump swap ───────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(S.cut);
    B.parts.base.holder.visible = S.base;
    S.Q = sc.pose(S.th, S.b);
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
  p9: { title: '9-piston swashplate pump', kind: 'Odd count · 18 flow pulses a turn', lede: 'The shaft turns the cylinder barrel. Each piston slipper slides round on the tilted swashplate, so the piston goes in and out of its bore once a turn. Nine pistons give a smooth flow: the ripple is only 1.5%.' },
  p7: { title: '7-piston swashplate pump', kind: 'Odd count · 14 flow pulses a turn', lede: 'Seven pistons, the most common count in small pumps. With an odd count, the pistons that deliver alternate between 4 and 3, so the flow has 14 small pulses a turn and a ripple of 2.5%.' },
  p8: { title: '8-piston swashplate pump', kind: 'Even count · 8 flow pulses a turn', lede: 'With an even count, the pistons on opposite sides cross the bridges at the same moment. Four pistons always deliver and their half waves add in step, so the flow has only 8 pulses a turn and a ripple of 7.8%: three times that of 7 pistons.' },
};
const ABOUT = [
  ['The stroke', 'The ball centre of each piston stays at the slipper height above the tilted face. So x = (hs − Rp cos φ sin b) / cos b, and the piston goes in by Rp tan b (1 − cos φ). The stroke is 2 Rp tan b.'],
  ['Displacement control', 'The swash angle b sets the stroke, and the stroke sets the flow: V = N A 2 Rp tan b per turn. At b = 0 the pistons do not move and the pump gives no flow while the shaft turns. A servo piston tilts the plate to hold a pressure or a flow.'],
  ['Odd or even', 'Each delivering piston adds a half sine wave. With an odd count the half waves of opposite pistons are out of step, so the sum has 2N pulses a turn and a ripple of (π/2N) tan(π/4N). With an even count they line up: N pulses and (π/N) tan(π/2N), three to five times more than the odd counts next to it.'],
  ['The valve plate', 'A fixed plate with two kidney slots: suction where the pistons come out, delivery where they go in. The bridges between the kidneys sit at the ends of the stroke and are wider than a barrel port, so no cylinder connects the two sides.'],
  ['What the model leaves out', 'Leaks, the compression of the oil in the cylinder as it crosses a bridge, and the relief grooves that real valve plates use to stop the pressure spikes. These make real ripple larger than the ideal value.'],
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
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    fillEqs();
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = UNITS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
// az 0 looks from +z (the delivery side), az 90 from +x (the port block)
const VIEWS = {
  three: { az: 32, el: 26, explode: 0, k: 1, at: [20, -6, 0] },
  close: { az: 40, el: 32, explode: 0, k: 0.6, at: [12, 6, 0] },
  // kn: the k on a tall screen, where the side view is the full pump length
  side: { az: 2, el: 6, explode: 0, k: 0.82, kn: 1.12, at: [20, -6, 0] },
  // the valve plate explodes up and back: look at its barrel side
  ports: { az: -62, el: 16, explode: 1, k: 0.62, at: [224, 100, 0] },
  exploded: { az: 22, el: 24, explode: 1, k: 1.8, at: [62, -10, 0] },
};
function fitDist(k, kn) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  if (kn && a < 1.1) k = kn;
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k, v.kn), target: new THREE.Vector3(...v.at), t: soft ? 1.8 : 1.4 });
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
// the swash angle in degrees, 0 .. 18
function setSwash(deg) {
  deg = Math.max(0, Math.min(18, deg));
  const zero = (S.b === 0) !== (deg === 0);
  S.b = deg * D;
  $('swash').value = deg; $('swashV').textContent = `${deg.toFixed(1)}°`;
  document.querySelectorAll('#tilts button').forEach(b => b.classList.toggle('on', +b.dataset.b === deg));
  if (zero) plotCache = null;
  if (S.cur && !saverOn) fillEqs();
}
$('swash').addEventListener('input', e => setSwash(+e.target.value));
document.querySelectorAll('#tilts button').forEach(b => b.addEventListener('click', () => setSwash(+b.dataset.b)));
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.base.holder.visible = on; }
  if (what === 'cut') { S.cut = on; $('tCut').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tCut').addEventListener('click', () => setShow('cut', !S.cut));
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

// ── flow analysis ───────────────────────────────────────────────────────────
// Over one barrel turn th in [0, 360): the top band holds each piston's
// travel into its bore, s / stroke (0 .. 1); the bottom band holds the flow
// as a deviation from its mean, q / q_mean - 1, for this pump (solid) and
// for the pump with one piston more or less of the other parity (dashed).
// s / stroke and q / q_mean do not depend on b, so only b = 0 redraws.
const COL = { s: 'rgba(226,194,122,0.45)', s0: '#e2c27a', q: '#8fb0ff', x: '#e9a0a8' };
const other = u => (u.N % 2 ? 8 : 9);
function curves() {
  const u = unit(S.cur.id), N = 360, b = S.b > 0 ? S.b : u.b0;
  const st = Array.from({ length: u.N }, () => []), dev = [], devX = [];
  const uX = { ...u, N: other(u) };
  const qA = flowCurve(u, b, N), qB = flowCurve(uX, b, N), mA = displacement(u, b) / TAU, mB = displacement(uX, b) / TAU;
  for (let j = 0; j <= N; j++) {
    const P = pumpPose(u, TAU * j / N, b);
    for (let i = 0; i < u.N; i++) st[i].push(P.pistons[i].s / P.stroke);
    dev.push(qA[j] / mA - 1); devX.push(qB[j] / mB - 1);
  }
  const span = 1.15 * Math.max(...dev.map(Math.abs), ...devX.map(Math.abs));
  return { st, dev, devX, span, zero: S.b === 0, nX: uX.N };
}
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  if (!plotCache) {
    const C = curves(), off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), pad = 10 * dpr, X = i => pad + (w - 2 * pad) * i / 360;
    const split = h * 0.48, top0 = pad, top1 = split - 4 * dpr, mid = (split + h - pad) / 2, half = (h - pad - split) / 2 - 2 * dpr;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    o.beginPath(); o.moveTo(pad, split); o.lineTo(w - pad, split); o.stroke();
    const line = (arr, y, col, wd, dash) => {
      o.strokeStyle = col; o.lineWidth = wd * dpr; o.setLineDash(dash ? [4 * dpr, 3 * dpr] : []); o.beginPath();
      arr.forEach((v, i) => { const yy = y(v); i ? o.lineTo(X(i), yy) : o.moveTo(X(i), yy); });
      o.stroke(); o.setLineDash([]);
    };
    const yS = v => top1 - (C.zero ? 0 : v) * (top1 - top0), yQ = v => mid - (C.zero ? 0 : v / C.span) * half;
    C.st.forEach((a, i) => { if (i) line(a, yS, COL.s, 1); });
    line(C.st[0], yS, COL.s0, 1.8);
    line(C.devX, yQ, COL.x, 1.2, true);
    line(C.dev, yQ, COL.q, 1.8);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    o.fillText(C.zero ? 'b = 0: no stroke' : 'in', pad + 3 * dpr, top0 + 9 * dpr);
    o.fillText(C.zero ? 'b = 0: no flow' : `±${(C.span * 100).toFixed(1)}%`, pad + 3 * dpr, split + 12 * dpr);
    $('legend').innerHTML = [['ls', 'piston travel s / stroke'], ['lq', `flow, ${unit(S.cur.id).N} pistons`], ['lx', `flow, ${C.nX} pistons`]].map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const ph = ((S.th % TAU) + TAU) % TAU * DEG, x = plotCache.X(ph);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
const rip = {};
const rippleOf = u => rip[u.id] || (rip[u.id] = ripple(u, u.b0, 3600));
function fillNums() {
  const u = unit(S.cur.id), Q = S.Q, ph = (((S.th % TAU) + TAU) % TAU) * DEG, R = rippleOf(u), now = rating(u, S.b, S.rpm), at = rating(u, S.b, RATED);
  const html = `<tr><th>${u.N} pistons</th><th></th></tr>` + row('Barrel angle θ', `${ph.toFixed(1)}°`) + row('Swash angle b', `${(S.b * DEG).toFixed(1)}°`) +
    row('Stroke 2 Rp tan b', `${Q.stroke.toFixed(2)} mm`) + row('Displacement V', `${(at.V / 1000).toFixed(2)} cm³/rev`) +
    row(`Flow at ${S.rpm} rpm`, `${(now.Lmin).toFixed(2)} L/min`) + row(`Flow at ${RATED} rpm`, `${at.Lmin.toFixed(1)} L/min`) +
    row('Delivering now', `${Q.nDel} of ${u.N}`) + row('Ripple', `${(R.measured * 100).toFixed(2)}%`) + row('Pulses a turn', String(R.pulses)) +
    row(`Torque at ${u.p} bar`, `${at.torque.toFixed(0)} N·m`) + row(`Power at ${RATED} rpm`, `${at.kW.toFixed(1)} kW`);
  $('now').innerHTML = S.b === 0 ? '<b>No stroke</b><span>The plate is flat: the pistons do not move and the pump gives no flow.</span>'
    : `<b>${Q.nDel} of ${u.N} pistons deliver</b><span>Flow ${(Q.q / Q.qMean * 100 - 100).toFixed(2)}% from the mean.</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const u = unit(S.cur.id), R = rippleOf(u);
  const E = [
    ['Ball centre', 'x = (h_s − R_p cos φ sin b) / cos b', 'on the plane at h_s above the face'],
    ['Stroke', `s = R_p tan b (1 − cos φ),  2 R_p tan b = ${stroke(u, S.b).toFixed(2)} mm`, `at b = ${(S.b * DEG).toFixed(1)}°`],
    ['Displacement', 'V = N · A · 2 R_p tan b', `${(displacement(u, S.b) / 1000).toFixed(2)} cm³ per turn`],
    ['Ripple', u.N % 2 ? 'δ = (π / 2N) tan(π / 4N)' : 'δ = (π / N) tan(π / 2N)', `${(R.theory * 100).toFixed(2)}% for N = ${u.N}, ${R.pulses} pulses a turn`],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const u = unit(S.cur.id), Q = S.Q, ph = (((S.th % TAU) + TAU) % TAU) * DEG;
  switch (key) {
    case 'rpm': return ['Shaft', `${S.rpm} rpm`];
    case 'th': return ['Barrel angle', `${ph.toFixed(1)}°`];
    case 'torque': return [`Torque at ${u.p} bar`, `${rating(u, S.b, RATED).torque.toFixed(0)} N·m`];
    case 'beta': return ['Swash angle', `${(S.b * DEG).toFixed(1)}°`];
    case 'stroke': return ['Stroke', `${Q.stroke.toFixed(2)} mm`];
    case 'nDel': return ['Delivering', `${Q.nDel} of ${u.N}`];
    case 'flow': return [`Flow at ${RATED} rpm`, `${rating(u, S.b, RATED).Lmin.toFixed(1)} L/min`];
    case 'ripple': return ['Ripple', `${(rippleOf(u).measured * 100).toFixed(2)}%`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const u = unit(S.cur.id), Q = S.Q;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br>` +
    `<span class="lo">b ${(S.b * DEG).toFixed(1)}° · V ${(displacement(u, S.b) / 1000).toFixed(1)} cm³ · ${Q.nDel}/${u.N} delivering · ripple ${(rippleOf(u).measured * 100).toFixed(1)}%</span>`;
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
  if (saverOn && saverTick) saverTick(dt);
  S.Q = cur.sc.pose(S.th, S.b);
  for (const o of S.leaving) o.sc.pose(S.th, S.b);
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
  }
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__pump = { S, stage, cards, swapTo, setView, setRpm, setSwash, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('tCut').classList.toggle('on', S.cut);
setRpm(15); setExplode(0); setSwash(15);
stage.place({ az: -60, el: 30, r: 1800, target: new THREE.Vector3(20, -6, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'p9');
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
// each pump: the whole pump, the pistons close in, the side view of the
// tilt, the valve plate half exploded, the exploded pump and close-ups of 3
// parts (lib/mech-tour.js), then a fade to the next pump. Each step holds
// seconds/10 (at least 5 s). The swash angle sweeps between 3 and 17
// degrees on a slow sine, so the strokes grow and shrink. calm (1 =
// slowest) slows the shaft and the sweep, not the step time. opts.label
// names each step with the relations and live values. No exit(): the
// shell reloads the page.
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
    // the swash sweep: a seeded phase, a period of 40 .. 70 s
    let sw = rnd() * TAU;
    const swRate = TAU / (40 + 30 * calm);
    const RULES = [['\\theta', 'm1'], ['b', 'm2'], ['V', 'm3'], ['\\delta', 'm4'], ['N', 'm6']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const uu = () => unit(S.cur.id);
    const params = () => {
      const u = uu(), ph = ((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0) + '°';
      return [P('\\theta', 'barrel angle', ph, 'm1'), P('b', 'swash angle', `${(S.b * DEG).toFixed(1)}°`, 'm2'),
        P('V', 'displacement', `${(displacement(u, S.b) / 1000).toFixed(1)} cm³`, 'm3'), P('\\delta', 'flow ripple', `${(rippleOf(u).measured * 100).toFixed(2)}%`, 'm4'), P('N', 'pistons', String(u.N), 'm6')];
    };
    const tex = () => [String.raw`s = R_p\tan b\,(1-\cos\varphi),\qquad V = N A\,2R_p\tan b`, uu().N % 2 ? String.raw`\delta = \frac{\pi}{2N}\tan\frac{\pi}{4N}\quad(N\ \text{odd})` : String.raw`\delta = \frac{\pi}{N}\tan\frac{\pi}{2N}\quad(N\ \text{even})`];
    const eq = () => ['s = Rp tan b (1 − cos φ)', uu().N % 2 ? 'δ = (π/2N) tan(π/4N)' : 'δ = (π/N) tan(π/2N)'];
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const group = re => () => Object.values(S.cur.B.parts).filter(q => re.test(q.info)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: 'Pistons and slippers', sub: 'Each slipper slides round the tilted plate', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(group(/^(piston|slipper|retainer)$/)()) }) },
      { view: 'side', lab: () => ({ title: 'The swash angle', sub: 'The tilt sets the stroke: no tilt, no flow', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'ports', lab: () => ({ title: 'Valve plate', sub: 'Suction kidney, delivery kidney, two bridges', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(group(/^(valve|barrel|block)$/)()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['piston', 'slipper', 'swash', 'valve', 'retainer', 'barrel'], skip: ['base', 'shaft'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    // a seeded order of the four assembled views, then the exploded view
    const makePlan = () => {
      tour.unit();
      const mid = [STEPS[1], STEPS[2], STEPS[3]].sort(() => rnd() - 0.5);
      plan = [STEPS[0], ...mid, STEPS[4], ...tour.pick(3).map(focusStep)];
    };
    const show = s => {
      setRpm(s.still ? 0 : RPM);
      if (s.focus) tour.show(s.focus);
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded' || s.view === 'ports' }); }
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
      sw += swRate * dt; S.b = (10 + 7 * Math.sin(sw)) * D;
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    (async () => { if (!S.cur || S.cur.id !== order[first]) await swapTo(order[first]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};

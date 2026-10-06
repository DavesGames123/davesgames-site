// ============================================================================
//  ANTIKYTHERA MECHANISM  ·  main.js — run, jumps, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows the mechanism: mech.js for the train, scene.js for its 3D parts
//  (kit.js), stage.js for the renderer and the camera, cards.js for the
//  part cards and labels. Built from the geneva-cams / linkages main.js
//  with one model in place of the unit picker.
//
//  MOTION
//    One number drives everything: S.day, days from the setting at day 0.
//    Each frame adds S.rate (days per second) * dt; a jump eases S.day to
//    S.goal. sc.pose(S.day) turns every arbor and returns mech.js pose().
//
//  GREP MAP
//    function boot / const JUMPS  build the model, the jump buttons
//    const VIEWS / function setView  camera presets
//    function curves / drawPlot . the anomaly plot over one anomalistic month
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: front, back, the pin and
//                                 slot, exploded, part close-ups
// ============================================================================
import * as THREE from 'three';
import * as M from './mech.js';
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
const { TAU, DEG, PERIOD, YEAR } = M;
const wrap = x => ((x % TAU) + TAU) % TAU;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, day: 3.2, goal: null, rate: 4, lastRate: 4, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, frame: true, showLabels: !PHONE_Q.matches,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.Q ? S.Q.moon : 0,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── the model ───────────────────────────────────────────────────────────────
const FRAME_PARTS = ['base', 'plateF', 'plateB', 'dialF', 'dialM', 'dialS', 'dialG', 'dialX'];
function boot() {
  const B = createBuild(), sc = build(B);
  S.cur = { id: 'antikythera', B, sc, PARTS: partsFor(), alpha: 0, t0: performance.now() };
  B.setAlpha(0.001);
  B.setSection(false);
  S.Q = sc.pose(S.day);
  stage.root.add(B.root);
  cards.reset();
  fillPanel();
  stage.setShadowExtent(sc.box.R, new THREE.Vector3(...sc.box.c));
  stage.controls.minDistance = 90; stage.controls.maxDistance = sc.box.R * 8;
  setView('three', true);
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = { title: 'Antikythera mechanism', kind: 'A Greek gear computer · 2nd century BC', lede: 'A bronze box of about thirty gears, found in a shipwreck off Antikythera in 1901. Turn the crank by days and the front dial shows the Sun and the Moon in the zodiac, with the Moon\'s phase; the back dials count the 19-year Metonic cycle and the 223-month Saros eclipse cycle. A pin in a slot makes the Moon run fast and slow as the real Moon does.' };
const ABOUT = [
  ['254 in 19', 'In 19 years the Moon goes round the zodiac 254 times. The Moon train is 64/38 × 48/24 × 127/32 = 254/19, and d2 has 127 teeth, half of 254.'],
  ['Pin and slot', 'k1 and k2 turn on axes 1.1 mm apart. A pin on k1 drives a slot in k2, so k2 is fast on one side and slow on the other: a sine-like wobble of ±6.3° on the Moon pointer. This page uses the exact angle, atan2(sin M, cos M − e) − M.'],
  ['The turntable', 'The anomaly must stay tied to the Moon\'s orbit, which turns once in about 8.9 years. So k1 and k2 ride on e3, which turns at 477/4237 a year. Seen from e3, k1 turns once per anomalistic month: 27.554 days.'],
  ['Counts and geometry', 'The tooth counts here are the ones Freeth and colleagues published (2006, 2021). The positions of the arbors, the modules and the tooth shape are this page\'s own.'],
];
function fillPanel() {
  $('engTitle').textContent = INFO.title;
  $('engKind').textContent = INFO.kind;
  $('engLede').textContent = INFO.lede;
  const seen = new Set(), P = S.cur.PARTS;
  const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
  $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
  $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
  $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
  fillEqs();
}
// jumps: ease the day to a goal
const nextPhase = (target) => { const Q = M.pose(S.day), d = wrap(target - Q.phase) / TAU * PERIOD.synodic; return S.day + (d < 0.5 ? d + PERIOD.synodic : d); };
const JUMPS = [
  { id: 'new', name: 'New Moon', kind: 'next conjunction', go: () => nextPhase(0) },
  { id: 'full', name: 'Full Moon', kind: 'next opposition', go: () => nextPhase(Math.PI) },
  { id: 'peri', name: 'Perigee', kind: 'Moon fastest', go: () => { const Q = M.pose(S.day), d = wrap(-Q.M) / TAU * PERIOD.anomalistic; return S.day + (d < 0.5 ? d + PERIOD.anomalistic : d); } },
  { id: 'year', name: '+1 year', kind: '365.25 days', go: () => S.day + YEAR },
  { id: 'saros', name: '+1 Saros', kind: '223 months', go: () => S.day + PERIOD.saros },
  { id: 'meton', name: '+19 years', kind: 'Metonic cycle', go: () => S.day + PERIOD.metonic },
];
function buildJumps() {
  $('variants').innerHTML = JUMPS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => { const j = JUMPS.find(x => x.id === b.dataset.id); S.goal = { from: S.day, to: j.go(), t: 0 }; }));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 30, el: 10, explode: 0, k: 1.32, at: null },
  front: { az: 0, el: 4, explode: 0, k: 0.62, at: 'front' },
  back: { az: 180, el: 4, explode: 0, k: 1.25, at: null },
  slot: { az: 62, el: 28, explode: 0.7, k: 0.4, at: 'slot' },
  side: { az: 74, el: 10, explode: 0, k: 1.2, at: null },
  exploded: { az: 58, el: 16, explode: 1, k: 1.55, at: null },
  metonic: { az: 180, el: 4, explode: 0, k: 0.5, at: 'metonic' },
  saros: { az: 180, el: 4, explode: 0, k: 0.5, at: 'saros' },
};
const W = new THREE.Vector3();
function keyPoint(k) {
  const sc = S.cur.sc;
  if (k === 'slot') return S.cur.B.parts.k1.root.getWorldPosition(W).clone();
  if (k && sc.keys[k]) return new THREE.Vector3(...sc.keys[k]);
  return new THREE.Vector3(...sc.box.c);
}
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  setExplode(v.explode);
  // the slot key moves with the explode: aim at its exploded place
  if (v.at === 'slot') { S.cur.B.applyExplode(v.explode); S.cur.B.root.updateMatrixWorld(true); }
  const tgt = keyPoint(v.at);
  if (v.at === 'slot') S.cur.B.applyExplode(S.explode);
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k), target: tgt, t: soft ? 1.8 : 1.4 });
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) { S.explodeTarget = x; $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%'; }
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(1));
function setRate(r) {
  r = Math.max(0, Math.min(400, r));
  if (r > 0) S.lastRate = r;
  S.rate = r;
  $('rpm').value = r; $('rpmV').textContent = `${r} d/s`;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rpm)));
$('rpm').addEventListener('input', e => setRate(+e.target.value));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));
$('turn').addEventListener('input', e => {
  setRate(0); S.goal = null;
  S.day = Math.floor(S.day / YEAR) * YEAR + +e.target.value;
});
function setShow(what, on) {
  if (what === 'base') { S.frame = on; $('tBase').classList.toggle('on', on); for (const id of FRAME_PARTS) if (S.cur && S.cur.B.parts[id]) S.cur.B.parts[id].holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.frame));
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

// ── the anomaly plot ────────────────────────────────────────────────────────
// Over one anomalistic month from perigee (M = 0): the Moon pointer minus
// the mean Moon (o, degrees) and the Moon's daily motion minus the mean
// daily motion (w, degrees per day), each from mech.js pose().
const COL = { o: '#e2c27a', w: '#8fb0ff' };
function curves() {
  const Pa = PERIOD.anomalistic, Q = M.pose(S.day), t0 = S.day - wrap(Q.M) / TAU * Pa, N = 360, out = { o: [], w: [] };
  const mean = 360 / PERIOD.sidereal;
  for (let i = 0; i <= N; i++) {
    const t = t0 + Pa * i / N, a = M.pose(t), b = M.pose(t + 0.01);
    out.o.push(a.anomaly * DEG);
    let dm = (b.moon - a.moon) * DEG / 0.01;
    out.w.push(dm - mean);
  }
  out.oMax = Math.max(...out.o.map(Math.abs)); out.wMax = Math.max(...out.w.map(Math.abs));
  out.lab = [['lo', `Moon − mean Moon (peak ±${out.oMax.toFixed(2)}°)`], ['lw', `daily motion − ${mean.toFixed(2)}°/d (±${out.wMax.toFixed(2)})`]];
  out.t0 = t0;
  return out;
}
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  // a new perigee starts a new month on the plot
  if (plotCache && S.day - plotCache.C.t0 > PERIOD.anomalistic) plotCache = null;
  if (plotCache && S.day < plotCache.C.t0) plotCache = null;
  if (!plotCache) {
    const C = curves(), off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), pad = 10 * dpr, X = i => pad + (w - 2 * pad) * i / 360, mid = h / 2, Hh = h / 2 - pad;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    const line = (arr, max, col) => {
      o.strokeStyle = col; o.lineWidth = 1.6 * dpr; o.beginPath();
      arr.forEach((v, i) => { const y = mid - (v / max) * Hh; i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); });
      o.stroke();
    };
    line(C.o, C.oMax, COL.o);
    line(C.w, C.wMax, COL.w);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['perigee', '6.9 d', 'apogee', '20.7 d'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    $('legend').innerHTML = C.lab.map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X, C };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const x = plotCache.X(Math.min(360, (S.day - plotCache.C.t0) / PERIOD.anomalistic * 360));
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const ZOD = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const sign = a => { const d = wrap(a) * DEG; return `${ZOD[Math.floor(d / 30)]} ${(d % 30).toFixed(1)}°`; };
const phaseName = p => { const d = p * DEG; return d < 12 || d > 348 ? 'new' : d < 78 ? 'waxing crescent' : d < 102 ? 'first quarter' : d < 168 ? 'waxing gibbous' : d < 192 ? 'full' : d < 258 ? 'waning gibbous' : d < 282 ? 'last quarter' : 'waning crescent'; };
let lastNums = '';
function fillNums() {
  const Q = S.Q, yr = Math.floor(S.day / YEAR), doy = S.day - yr * YEAR;
  let html = `<tr><th>${INFO.title}</th><th></th></tr>` + row('Day', `${S.day.toFixed(2)} (year ${yr + 1}, day ${doy.toFixed(1)})`);
  html += row('Sun', sign(Q.sun)) + row('Moon', sign(Q.moon)) + row('Mean Moon', sign(Q.mean)) + row('Anomaly', `${(Q.anomaly * DEG >= 0 ? '+' : '')}${(Q.anomaly * DEG).toFixed(3)}°`)
    + row('M from perigee', `${(Q.M * DEG).toFixed(1)}°`) + row('Phase', `${(Q.phase * DEG).toFixed(1)}° · ${phaseName(Q.phase)}`)
    + row('Metonic', `month ${Q.metonic.month} of 235 · turn ${Math.floor(Q.metonic.turn) + 1}`) + row('Saros', `month ${Q.saros.month} of 223 · turn ${Math.floor(Q.saros.turn) + 1}`)
    + row('Games', `year ${Q.games.year} of 4`) + row('Exeligmos', `+${[0, 8, 16][Q.exeligmos.sector]} h`) + row('Crank turns', `${(S.day / PERIOD.crank).toFixed(2)}`);
  $('now').innerHTML = `<b>${phaseName(Q.phase)[0].toUpperCase() + phaseName(Q.phase).slice(1)} Moon</b><span>Moon ${(Q.anomaly * DEG >= 0 ? 'ahead of' : 'behind')} its mean place by ${Math.abs(Q.anomaly * DEG).toFixed(2)}°.</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const E = [
    ['Sidereal Moon', '64/38 · 48/24 · 127/32 = 254/19', `${PERIOD.sidereal.toFixed(4)} d`],
    ['Synodic month', '254/19 − 1 = 235/19', `${PERIOD.synodic.toFixed(4)} d`],
    ['Turntable', '64/38 · 53/96 · 27/223 = 477/4237', `apsides ${(PERIOD.apsides / YEAR).toFixed(2)} yr`],
    ['Anomalistic', '254/19 − 477/4237', `${PERIOD.anomalistic.toFixed(4)} d`],
    ['Pin and slot', 'λ = λ̄ + atan2(sin M, cos M − e) − M', `e = 1.1/10, peak ±${(Math.asin(M.ECC) * DEG).toFixed(2)}°`],
    ['Saros', '223 synodic = 239 anomalistic', `${(PERIOD.saros / YEAR).toFixed(3)} yr`],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  const Q = S.Q;
  if (!Q) return [key, '—'];
  switch (key) {
    case 'day': return ['Day', `${S.day.toFixed(1)} · ${S.rate} d/s`];
    case 'sun': return ['Sun', sign(Q.sun)];
    case 'moon': return ['Moon', sign(Q.moon)];
    case 'phase': return ['Phase', `${(Q.phase * DEG).toFixed(0)}° · ${phaseName(Q.phase)}`];
    case 'anomaly': return ['Anomaly', `${(Q.anomaly * DEG).toFixed(2)}° at M ${(Q.M * DEG).toFixed(0)}°`];
    case 'apsides': return ['Turntable', `${(wrap(Q.A.e34 * Math.sign(M.RATE.e34)) * DEG).toFixed(1)}°`];
    case 'metonic': return ['Metonic', `month ${Q.metonic.month} / 235`];
    case 'saros': return ['Saros', `month ${Q.saros.month} / 223`];
    case 'games': return ['Games', `year ${Q.games.year} / 4`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q;
  $('read').innerHTML = `<span class="hi">Day ${S.day.toFixed(1)}</span><br><span class="lo">Sun ${sign(Q.sun)} · Moon ${sign(Q.moon)} · ${phaseName(Q.phase)}</span>`;
  $('turnV').textContent = `${(S.day - Math.floor(S.day / YEAR) * YEAR).toFixed(0)} d`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  if (S.goal) {
    S.goal.t = Math.min(1, S.goal.t + dt / 2.2);
    S.day = S.goal.from + (S.goal.to - S.goal.from) * ease(S.goal.t);
    if (S.goal.t >= 1) S.goal = null;
  } else S.day += S.rate * dt;
  S.Q = cur.sc.pose(S.day);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); }
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    readout();
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); }
    drawPlot();
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__antikythera = { S, M, stage, cards, setView, setRate, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildJumps();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRate(4); setExplode(0);
stage.place({ az: -40, el: 18, r: 1600, target: new THREE.Vector3(0, -12, -20) });
boot();
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
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and runs a
// seeded tour: the whole mechanism, the front dial, the back dials or the
// Metonic dial, the Saros dial, the pin and slot (half exploded), the side, the exploded stack and close-ups of
// 3 parts (lib/mech-tour.js). The order is shuffled per run (whole view
// first). Each step holds seconds/10 (at least 5 s). calm (1 = slowest)
// slows the days per second, not the step time. A front step stays in az
// -55..55, a back step in 125..235. No exit(): the shell reloads the page.
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
    const RATE = Math.round(12 - 8 * calm);
    setRate(RATE);
    // a seeded start day, so each run shows another sky
    S.day = Math.floor(rnd() * 6940);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const canvas = $('view');
    const RULES = [['\\lambda', 'm1'], ['M', 'm2'], ['e', 'm3'], ['N', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = [String.raw`\frac{64}{38}\cdot\frac{48}{24}\cdot\frac{127}{32} = \frac{254}{19}`, String.raw`\lambda = \bar\lambda + \operatorname{atan2}(\sin M,\ \cos M - e) - M`];
    const EQ = ['64/38 · 48/24 · 127/32 = 254/19', 'λ = λ̄ + atan2(sin M, cos M − e) − M'];
    const params = () => { const Q = S.Q; if (!Q) return []; return [P('t', 'day', S.day.toFixed(1), ''), P('\\lambda', 'Moon', sign(Q.moon), 'm1'), P('M', 'from perigee', `${(Q.M * DEG).toFixed(0)}°`, 'm2'), P('\\Delta\\lambda', 'anomaly', `${(Q.anomaly * DEG).toFixed(2)}°`, 'm3')]; };
    const lab = (title, sub, objs) => () => ({ title, sub, params: params(), tex: TEX, eq: EQ, rules: RULES, anchor: () => plateAnchor(objs()) });
    const parts = re => () => Object.values(S.cur.B.parts).filter(q => re.test(q.id)).map(q => q.holder);
    const all = parts(/./);
    const FRONT = [-55, 55], BACK = [125, 235];
    const STEPS = {
      three: { view: 'three', az: FRONT, lab: lab(INFO.title, INFO.kind, all) },
      front: { view: 'front', az: FRONT, lab: lab('Sun, Moon and phase', 'The front dial: zodiac and Egyptian calendar', parts(/^(dialF|b|b3|ball)$/)) },
      back: { view: 'back', az: BACK, lab: lab('Metonic and Saros', '235 months in 5 turns · 223 months in 4', parts(/^(dialM|dialS|dialG|dialX|n|g|o|i)$/)) },
      metonic: { view: 'metonic', az: BACK, lab: lab('The Metonic dial', '19 years = 235 months, five turns of a spiral', parts(/^(dialM|dialG|n|o)$/)) },
      saros: { view: 'saros', az: BACK, lab: lab('The Saros dial', '223 months: eclipses come back in order', parts(/^(dialS|dialX|g|i)$/)) },
      slot: { view: 'slot', az: null, lab: lab('The pin and slot', 'k1 drives k2 through a pin; axes 1.1 mm apart', parts(/^(k1|k2)$/)) },
      side: { view: 'side', az: [40, 140], lab: lab('Thirty wheels in layers', INFO.title, all) },
      exploded: { view: 'exploded', still: true, az: null, lab: lab('Exploded view', INFO.title, all) },
    };
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['k1', 'k2', 'e34', 'b', 'moon', 'phase', 'd', 'metonic', 'saros'], skip: ['base', 'spindle', 'plateF', 'plateB'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO.title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS.three, ...shuf([STEPS.front, rnd() < 0.5 ? STEPS.back : STEPS.metonic, STEPS.saros, STEPS.slot, STEPS.side, STEPS.exploded]), ...tour.pick(3).map(focusStep)]; };
    // the plates stand upright: no top, graze or crane moves on the views
    const FLAT_MOVES = ['push', 'pull', 'orbit', 'truck'];
    const show = s => {
      setRate(s.still ? 0 : RATE);
      if (s.focus) { setExplode(0.8); tour.show(s.focus); }
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded', azRange: s.az, move: FLAT_MOVES[Math.floor(rnd() * FLAT_MOVES.length)] }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    let n = 0, stepT = 0, lastLab = '', labT = 0, now = null;
    const advance = () => {
      if (n >= plan.length) {
        // a new pass: fade, a new start day, a new plan
        tour.clear(); canvas.style.opacity = '0'; now = null;
        setTimeout(() => { setExplode(0); S.explode = 0; S.day = Math.floor(rnd() * 6940); makePlan(); n = 0; stepT = 0; now = plan[n++]; show(now); setTimeout(() => { canvas.style.opacity = '1'; }, 250); }, 950);
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
      if (stepT >= hold && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    makePlan(); now = plan[n++]; show(now);
    return { canvas, warmupMs: 1500 };
  },
};

// ============================================================================
//  PENDULUM CLOCK  ·  main.js — unit swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows the clock with one escapement at a time: mech.js runs the clock,
//  scene.js makes its 3D parts (kit.js), stage.js holds the renderer and
//  the camera, cards.js the part cards and labels. A copy of the
//  geneva-cams main.js with the clock text, plot and saver steps.
//
//  MOTION
//    S.sim is a running mech.js makeSim. Each frame steps it by rate * dt
//    of clock time, in steps of at most 0.2 ms, and sc.pose(S.sim) turns
//    the pendulum, the pallets, the escape wheel and the train. A swap
//    starts the new clock at its settled swing (mech.js settle).
//    S.hist keeps (t, theta, phi, phase) for the plot and the recoil.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function advance ........... step the clock, zero crossings, history
//    function phase ............. impulse / recoil / lock / drop now
//    function drawPlot .......... theta and phi over the last two periods
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each unit,
//                                 front half only (azRange -60..60)
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, makeSim, settle, CLOCK, RATIO, P_TOOTH, GRAV, DEG, wheelTorque, periodSmall, periodSeries } from './mech.js';
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
const R2D = 180 / Math.PI;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], rate: 1, lastRate: 1, M: 4, L: CLOCK.L, sim: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, plates: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
  hist: [], ups: [], amp: 0, ampRun: 0, recoil: 0,
};
let saverOn = false, saverTick = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => (S.sim ? -S.sim.phi : 0),
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── the running clock ───────────────────────────────────────────────────────
// a new clock for unit id at its settled swing (the weight and length now)
function newSim(id) {
  const u = unit(id), a = settle(u, { M: S.M, L: S.L });
  const sim = makeSim(u, { M: S.M, L: S.L, amp: isFinite(a) ? a : 3 * DEG });
  S.hist = []; S.ups = []; S.amp = isFinite(a) ? a : 0; S.ampRun = 0; S.recoil = 0;
  return sim;
}
const STEP = 2e-4;
function advance(simDt) {
  const sim = S.sim;
  if (!sim || simDt <= 0) return;
  const n = Math.ceil(simDt / STEP), dt = simDt / n;
  for (let i = 0; i < n; i++) {
    const th0 = sim.th;
    sim.step(dt);
    S.ampRun = Math.max(S.ampRun, Math.abs(sim.th));
    if (th0 < 0 && sim.th >= 0) {
      S.ups.push(sim.t - dt * sim.th / (sim.th - th0));
      if (S.ups.length > 6) S.ups.shift();
      S.amp = S.ampRun; S.ampRun = 0;
    }
  }
  S.hist.push([sim.t, sim.th, sim.phi, phase()]);
  const W = 2.2 * periodSmall(S.L);
  while (S.hist.length > 2 && S.hist[0][0] < sim.t - W) S.hist.shift();
  // recoil: the largest turn back of the wheel in the window
  let peak = -Infinity, rc = 0;
  for (const h of S.hist) { peak = Math.max(peak, h[2]); rc = Math.max(rc, peak - h[2]); }
  S.recoil = rc;
}
const period = () => (S.ups.length > 1 ? (S.ups[S.ups.length - 1] - S.ups[0]) / (S.ups.length - 1) : NaN);
const rateDay = () => { const T = period(); return isFinite(T) ? (periodSmall(S.L) / T - 1) * 86400 : NaN; };
// what the escapement does now: 0 impulse, 1 recoil, 2 lock, 3 drop
function phase() {
  const sim = S.sim;
  if (!sim) return 0;
  if (sim.mode === 'drop') return 3;
  if (Math.abs(sim.phiDot) < 1e-7) return 2;
  return sim.phiDot > 0 ? 0 : 1;
}
const PHASE = [
  ['impulse', 'Impulse', 'The tooth slides along the pallet and pushes the pendulum.'],
  ['recoil', 'Recoil', 'The pendulum swings on and pushes the wheel back.'],
  ['lock', 'Locked', 'The tooth rests on the locking face: the wheel is dead still.'],
  ['drop', 'Drop', 'A tooth has left a pallet; the wheel turns free to the other one.'],
];

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
    B.parts.plates.holder.visible = S.plates;
    if (S.cur) S.leaving.push({ ...S.cur, Q: snap(S.sim), t0: performance.now() });
    S.sim = newSim(id);
    sc.setLength(S.L * 1000);
    sc.pose(S.sim, 0);
    stage.root.add(B.root);
    S.cur = next;
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}
const snap = s => (s ? { th: s.th, phi: s.phi, j: s.j, mode: s.mode } : { th: 0, phi: 0, j: 0, mode: 'on' });

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  anchor: { title: 'Anchor escapement', kind: 'Recoil · Clement, c. 1670', lede: 'The escapement of the long-case clock. Two inclined pallets on one arbor with the pendulum let the escape wheel go one tooth per swing. Past each release the pendulum swings on and drives the wheel back: the seconds hand of an old clock shudders at each beat.' },
  deadbeat: { title: 'Deadbeat escapement', kind: 'No recoil · Graham, 1715', lede: 'George Graham gave each pallet a locking face, an arc about the pallet arbor. While the pendulum swings out, the tooth rests on that arc and the wheel stands dead still: no recoil. Precision regulators used it for two hundred years.' },
  grasshopper: { title: 'Grasshopper escapement', kind: 'Recoil, no sliding · Harrison, c. 1722', lede: 'John Harrison\'s escapement for clocks that run without oil. Two hinged arms with nibs take the teeth in turn. One nib is always on a tooth, so there is no drop, and nothing slides. It recoils: the arriving nib pushes the wheel back to free the other one.' },
};
const ABOUT = {
  anchor: [
    ['Recoil', 'A pallet face meets the tooth at a slope, so the wheel angle φ follows the pendulum angle θ with dφ/dθ ≈ ±1.1. In the supplementary arc, past the release, the pendulum turns the wheel back.'],
    ['Drop', 'When a tooth leaves a pallet tip, the wheel turns free through the drop before the next tooth lands on the other pallet. The drop costs energy: here 2 × 1.2° of every 12° tooth.'],
    ['Drive and rate', 'The recoil pushes the pendulum back toward the centre while it swings out. That adds to gravity, so the clock gains when the weight is heavier. Try 3 kg and 6 kg.'],
  ],
  deadbeat: [
    ['No recoil', 'On a locking face dφ/dθ = 0: the tooth stands still while the pallet slides under it. The wheel only moves forward, in steps.'],
    ['Lift and lock', 'Each pallet locks the tooth for 0.6° of the swing, then lifts for 1.8° on its impulse face. Impulse comes near the centre of the swing, where it changes the period least.'],
    ['Drive and rate', 'The rate moves much less with the weight than with the anchor. What is left is mostly circular error: a wider swing takes longer.'],
  ],
  grasshopper: [
    ['Push and recoil', 'A nib inside the Thales circle of the two arbors pushes the wheel forward as θ grows; a nib outside it pushes the wheel back. That is why the two nibs sit so differently.'],
    ['No drop, no sliding', 'The arriving nib takes its tooth before the other lets go. The nibs roll on the tooth faces, so the escapement passes on almost all of the weight\'s work.'],
    ['Harrison\'s trick', 'A wide swing loses time (circular error), but the recoil adds a restoring push that gains. Harrison set them against each other: from 3 to 4 kg the rate here moves by less than 1 s a day.'],
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
  three: { az: 22, el: 8, explode: 0, k: 1.1, at: null },
  close: { az: 18, el: 10, explode: 0, k: 0.22, at: 'escape' },
  train: { az: -32, el: 12, explode: 0, k: 0.26, at: 'train' },
  front: { az: 0, el: 0, explode: 0, k: 0.95, at: null },
  side: { az: 68, el: 6, explode: 0, k: 0.95, at: null },
  exploded: { az: 38, el: 14, explode: 1, k: 0.32, at: 'pallets' },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  // the clock is tall and narrow: a portrait view needs only a little more distance
  const wide = a < 1.1 ? 1 + 0.3 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  const at = v.at ? S.cur.sc.keys[v.at] : S.cur.sc.box.c;
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
function setRate(r) {
  r = Math.max(0, Math.min(1, r));
  if (r > 0) S.lastRate = r;
  S.rate = r;
  document.querySelectorAll('#rates button[data-rate]').forEach(b => b.classList.toggle('on', +b.dataset.rate === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button[data-rate]').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));
// a push on the bob: +40% of the swing speed now
$('kick').addEventListener('click', () => { if (S.sim) S.sim.w += Math.sign(S.sim.w || 1) * 0.4 * S.amp * Math.sqrt(GRAV / S.L); });
// weight and length: the clock restarts at its new settled swing
let restartT = 0;
function restartSoon() { clearTimeout(restartT); restartT = setTimeout(() => { if (!S.cur) return; S.sim = newSim(S.cur.id); }, 180); }
function setWeight(M) { S.M = M; $('weight').value = M; $('weightV').textContent = `${M.toFixed(2)} kg`; }
function setLength(mm) { S.L = mm / 1000; $('length').value = mm; $('lengthV').textContent = `${mm.toFixed(0)} mm`; if (S.cur) S.cur.sc.setLength(mm); }
$('weight').addEventListener('input', e => { setWeight(+e.target.value); restartSoon(); });
$('length').addEventListener('input', e => { setLength(+e.target.value); restartSoon(); });
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.base.holder.visible = on; }
  if (what === 'plates') { S.plates = on; $('tPlates').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.plates.holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tPlates').addEventListener('click', () => setShow('plates', !S.plates));
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

// ── motion plot ─────────────────────────────────────────────────────────────
// The last 2.2 periods of the running clock: theta (gold, about the centre
// line, scaled to the widest swing) and the escape wheel angle phi (blue,
// rising one tooth a period). Where phi runs backward (recoil) it is red.
const COL = { o: '#e2c27a', w: '#8fb0ff', a: '#e9a0a8' };
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d'), H = S.hist;
  g.clearRect(0, 0, w, h);
  if (H.length < 3) return;
  const pad = 10 * dpr, Wt = 2.2 * periodSmall(S.L), t1 = H[H.length - 1][0], t0 = t1 - Wt;
  const X = t => pad + (w - 2 * pad) * (t - t0) / Wt;
  // theta in the top 55%, phi in the lower part
  const thMax = Math.max(1e-6, ...H.map(q => Math.abs(q[1]))) * 1.08, yT = h * 0.3, hT = h * 0.26;
  let p0 = Infinity, p1 = -Infinity; for (const q of H) { p0 = Math.min(p0, q[2]); p1 = Math.max(p1, q[2]); }
  const pr = Math.max(p1 - p0, P_TOOTH * 0.5), yB = h - pad, hB = h * 0.36;
  const yP = v => yB - (v - p0) / pr * hB;
  g.strokeStyle = 'rgba(217,179,106,0.12)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad, yT); g.lineTo(w - pad, yT); g.stroke();
  // one tick per second of clock time
  for (let s = Math.ceil(t0); s <= t1; s++) { const x = X(s); g.beginPath(); g.moveTo(x, pad); g.lineTo(x, h - pad); g.stroke(); }
  g.lineWidth = 1.6 * dpr;
  g.strokeStyle = COL.o; g.beginPath();
  H.forEach((q, i) => { const x = X(q[0]), y = yT - q[1] / thMax * hT; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  for (let i = 1; i < H.length; i++) {
    const a = H[i - 1], b = H[i];
    g.strokeStyle = b[2] < a[2] - 1e-9 ? COL.a : COL.w;
    g.beginPath(); g.moveTo(X(a[0]), yP(a[2])); g.lineTo(X(b[0]), yP(b[2])); g.stroke();
  }
  g.fillStyle = 'rgba(141,144,166,0.9)'; g.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
  g.fillText(`±${(thMax / 1.08 * R2D).toFixed(2)}°`, pad + 3 * dpr, pad + 9 * dpr);
  g.fillText(`${(pr * R2D).toFixed(1)}° of wheel`, pad + 3 * dpr, h - pad - hB - 4 * dpr);
  g.fillText('1 s', X(Math.ceil(t0)) + 3 * dpr, h - pad - 3 * dpr);
}
function fillLegend() {
  $('legend').innerHTML = [['lo', 'pendulum θ'], ['lw', 'escape wheel φ'], ['la', 'recoil (φ turns back)']].map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '', lastPh = -1;
function fillNums() {
  const id = S.cur.id, u = unit(id), sim = S.sim, T = period(), T0 = periodSmall(S.L), a = S.amp;
  const f = (v, n = 3) => (isFinite(v) ? v.toFixed(n) : '—');
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>`;
  html += row('Pendulum θ', `${(sim.th * R2D).toFixed(2)}°`) + row('Swing (amplitude)', `±${(a * R2D).toFixed(2)}°`);
  html += row('T₀ = 2π√(L/g)', `${f(T0, 4)} s`) + row('With circular error', `${f(periodSeries(a, S.L), 4)} s`) + row('Period, measured', `${f(T, 4)} s`);
  const rd = rateDay();
  html += row('Rate against T₀', isFinite(rd) ? `${rd > 0 ? '+' : ''}${rd.toFixed(1)} s/day` : '—');
  html += row('Recoil', `${(S.recoil * R2D).toFixed(2)}°`) + row('Beats', String(sim.beats));
  const Tw = wheelTorque(S.M);
  html += row('Wheel torque', `${(Tw * 1000).toFixed(3)} N·mm`) + row('Weight · barrel', `${S.M} kg · ${(S.M * GRAV * CLOCK.rb).toFixed(2)} N·m`);
  html += row('Power to the wheel', `${f(Tw * P_TOOTH / (isFinite(T) ? T : T0) * 1e6, 1)} µW`);
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  const ph = phase();
  if (ph !== lastPh) { lastPh = ph; const P = PHASE[ph]; $('now').className = 'proc ph-' + P[0]; $('now').innerHTML = `<b>${P[1]}</b><span>${P[2]}</span>`; }
}
function fillEqs() {
  const id = S.cur.id;
  const E = [
    ['Period', 'T₀ = 2π √(L / g)', 'small swings'],
    ['Circular error', 'T ≈ T₀ (1 + θ₀²/16 + 11θ₀⁴/3072)', 'exact: T₀ / AGM(1, cos θ₀/2)'],
    ['Impulse', 'τ = T_w · dφ/dθ', 'virtual work, less friction'],
    { anchor: ['Anchor', 'dφ/dθ ≈ ±(p − 2δ) / (4θᵣ)', 'never zero: recoil'], deadbeat: ['Deadbeat', 'dφ/dθ = 0 on the lock', 'no recoil'], grasshopper: ['Grasshopper', 'dφ/dθ ∝ (N − A)·(N − W)', 'sign set by the Thales circle'] }[id],
    ['Train', `${RATIO} escape turns per barrel turn`, '60/8 · 64/8 · 96/8'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  const sim = S.sim;
  if (!sim || !S.cur) return [key, '—'];
  switch (key) {
    case 'pallet': return ['Pallet', `${(sim.th * R2D).toFixed(2)}° · ${sim.mode === 'drop' ? 'drop' : sim.j ? 'exit pallet' : 'entry pallet'}`];
    case 'recoil': return ['Now', PHASE[phase()][1] + ` · recoil ${(S.recoil * R2D).toFixed(2)}°`];
    case 'wheel': return ['Seconds', `${(((sim.phi * R2D / 6) % 60) + 60) % 60 | 0} s · φ ${(sim.phi * R2D).toFixed(1)}°`];
    case 'period': return ['Period', isFinite(period()) ? `${period().toFixed(4)} s` : '—'];
    case 'amp': return ['Swing', `±${(S.amp * R2D).toFixed(2)}°`];
    case 'torque': return ['Wheel torque', `${(wheelTorque(S.M) * 1000).toFixed(3)} N·mm`];
    case 'power': return ['Power', `${(wheelTorque(S.M) * P_TOOTH / periodSmall(S.L) * 1e6).toFixed(1)} µW`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const sim = S.sim, rd = rateDay();
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">θ ${(sim.th * R2D).toFixed(2)}° · swing ±${(S.amp * R2D).toFixed(2)}° · T ${isFinite(period()) ? period().toFixed(4) : '—'} s${isFinite(rd) ? ` · ${rd > 0 ? '+' : ''}${rd.toFixed(1)} s/day` : ''}</span>`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  advance(S.rate * dt);
  cur.sc.pose(S.sim, dt);
  for (const o of S.leaving) o.sc.pose(o.Q, dt);
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
window.__pendulumClock = { S, stage, cards, swapTo, setView, setRate, setExplode, setShow, setOpen, setAna, setWeight, setLength };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
fillLegend();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRate(1); setExplode(0); setWeight(S.M); setLength(S.L * 1000);
stage.place({ az: -40, el: 14, r: 4200, target: new THREE.Vector3(0, -440, -30) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'anchor');
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
// each escapement: the whole clock, the escapement close in, the going
// train, the exploded escapement and close-ups of 3 parts
// (lib/mech-tour.js), in a seeded order, then a fade to the next unit. The
// clock runs in real time (calm above 0.85: half speed). Each step holds
// seconds/10 (at least 5 s). The camera stays on the front half
// (azRange -60..60): from behind, the backboard hides the movement. No
// exit(): the shell reloads the page.
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
    const RATE = calm > 0.85 ? 0.5 : 1;
    setRate(RATE);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    // a seeded shuffle of the units
    const order = UNITS.map(u => u.id);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const canvas = $('view');
    const RULES = [['\\theta', 'm1'], ['\\theta_0', 'm2'], ['\\varphi', 'm3'], ['T', 'm4'], ['T_0', 'm4'], ['L', 'm5']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = {
      anchor: String.raw`\tau = T_w\,\frac{d\varphi}{d\theta},\quad \frac{d\varphi}{d\theta} \ne 0\ \text{(recoil)}`,
      deadbeat: String.raw`\frac{d\varphi}{d\theta} = 0\ \text{on the locking face}`,
      grasshopper: String.raw`\frac{d\varphi}{d\theta} \propto (N-A)\cdot(N-W)`,
    };
    const tex = () => [String.raw`T_0 = 2\pi\sqrt{L/g},\quad T \approx T_0\left(1+\frac{\theta_0^2}{16}\right)`, TEX[S.cur.id]];
    const eq = () => ['T₀ = 2π√(L/g)', 'T ≈ T₀ (1 + θ₀²/16)'];
    const params = () => {
      const sim = S.sim; if (!sim) return [];
      const rd = rateDay();
      return [P('\\theta', 'pendulum', `${(sim.th * R2D).toFixed(2)}°`, 'm1'), P('\\theta_0', 'swing', `±${(S.amp * R2D).toFixed(2)}°`, 'm2'),
        P('\\varphi', 'escape wheel', `${(sim.phi * R2D).toFixed(1)}° · ${PHASE[phase()][1].toLowerCase()}`, 'm3'),
        P('T', 'period', isFinite(period()) ? `${period().toFixed(4)} s${isFinite(rd) ? ` (${rd > 0 ? '+' : ''}${rd.toFixed(0)} s/day)` : ''}` : '—', 'm4')];
    };
    const parts = re => Object.values(S.cur.B.parts).filter(q => re.test(q.id)).map(q => q.holder);
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: 'Pendulum clock', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(parts(/^(escape|pallets|leg0|leg1)$/)) }) },
      { view: 'train', lab: () => ({ title: 'The going train', sub: `${RATIO} escape turns per barrel turn`, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(parts(/^(third|centre|great|escape)$/)) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(parts(/^(escape|pallets|leg0|leg1|third|centre|great)$/)) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['escape', 'pallets', 'legs', 'bob', 'barrel', 'third', 'centre'], skip: ['base', 'plates', 'pendulum', 'weight'], azRange: [-60, 60] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    // the clock faces front: view steps use flat moves only
    const FLAT_MOVES = ['push', 'pull', 'orbit', 'truck'];
    let plan = [];
    const makePlan = () => {
      tour.unit();
      // the whole clock first, then the rest in a seeded order
      const rest = [STEPS[1], STEPS[2], STEPS[3], ...tour.pick(3).map(focusStep)];
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      plan = [STEPS[0], ...rest];
    };
    const show = s => {
      setRate(s.still ? 0 : RATE);
      if (s.focus) tour.show(s.focus);
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded', move: FLAT_MOVES[Math.floor(rnd() * FLAT_MOVES.length)] }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    const fadeSwap = async (id, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      setExplode(0); S.explode = 0;
      await swapTo(id);
      setTimeout(() => { canvas.style.opacity = '1'; then(); }, 250);
    };
    let n = 0, ord = 0, stepT = 0, lastLab = '', labT = 0, now = null;
    const advanceStep = () => {
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
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advanceStep(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    (async () => { if (!S.cur || S.cur.id !== order[0]) await swapTo(order[0]); advanceStep(); })();
    return { canvas, warmupMs: 1500 };
  },
};

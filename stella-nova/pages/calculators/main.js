// ============================================================================
//  PASCALINE & CURTA  ·  main.js — machine swap, jobs, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one calculator at a time: mech.js for the plan of a job, scene.js
//  for its 3D parts (kit.js), stage.js for the renderer and the camera,
//  cards.js for the part cards and labels. A copy of the linkages main.js
//  with jobs in place of a steady input angle.
//
//  MOTION
//    A job (a + b or a × b) becomes a plan (mech.js). S.t is the time in
//    beats: one dial tenth (Pascaline) or one crank turn (Curta). Each frame
//    adds RATE[id] * S.speed * dt. sc.pose(S.t) turns every wheel and
//    returns the state Q. At the end of a plan the page holds HOLD s, then
//    (Loop on) runs the next example.
//
//  GREP MAP
//    function swapTo ............ build a machine and cross-fade to it
//    const EXAMPLES / runJob .... the jobs and their limits
//    const INFO / ABOUT ......... the panel text of each machine
//    const VIEWS / function setView  camera presets
//    function columns / drawPlot  the digit-wheel and carry table plot
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a seeded tour of each
//                                 machine with part close-ups
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, pascalJob, pascalPlan, curtaJob, curtaPlan, digitsOf, valueOf } from './mech.js';
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
// beats per second at 1x: dial tenths (Pascaline), crank turns (Curta)
const RATE = { pascaline: 4, curta: 0.7 };
const HOLD = 2.5;
const fmt = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], t: 0, speed: 1, lastSpeed: 1, Q: null, view: 'three', job: null, plan: null, endT: 0, loop: true, ex: 0,
  explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => (S.cur && S.cur.id === 'curta' && S.Q ? S.Q.drum * Math.PI * 2 : S.t * Math.PI / 5),
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── jobs ────────────────────────────────────────────────────────────────────
const EXAMPLES = {
  pascaline: [['+', 999999, 1, 'Ripple through all six'], ['+', 1642, 358, 'Pascal\'s year + 358'], ['×', 365, 24, 'Hours in a year'], ['+', 4999, 5001, 'Three carries'], ['×', 125, 8, '125 × 8']],
  curta: [['×', 4711, 23, 'One shift, five turns'], ['×', 12345679, 9, 'Nine turns to 111 111 111'], ['+', 99999999, 1, 'Ripple in one turn'], ['×', 1948, 365, 'The Curta year × 365'], ['×', 271828, 314, 'e × π, in digits']],
};
const LIMIT = {
  pascaline: { '+': [999999, 999999], '×': [999999, 999] },
  curta: { '+': [99999999, 99999999], '×': [99999999, 999999] },
};
// Pascaline +: a is already on the wheels and the stylus dials b. ×: the
// wheels start at 0 and the stylus dials a, b_k times at each place k.
function makePlan(id, op, a, b) {
  const u = unit(id);
  if (id === 'curta') return curtaPlan(curtaJob(op, a, b, u), u);
  return op === '+' ? pascalPlan(pascalJob('+', 0, b, u.N), u.N, digitsOf(a, u.N)) : pascalPlan(pascalJob(op, a, b, u.N), u.N);
}
function runJob(op, a, b) {
  if (!S.cur) return;
  const id = S.cur.id, [la, lb] = LIMIT[id][op];
  a = Math.max(0, Math.min(la, Math.floor(+a || 0))); b = Math.max(0, Math.min(lb, Math.floor(+b || 0)));
  S.job = { op, a, b };
  S.plan = makePlan(id, op, a, b);
  S.cur.sc.setPlan(S.plan);
  S.t = 0; S.endT = 0;
  $('inA').value = a; $('inB').value = b; $('inOp').value = op;
  $('jobNote').textContent = `${fmt(a)} ${op} ${fmt(b)} = ${fmt(op === '+' ? a + b : a * b)}` + (id === 'pascaline' ? ` · ${S.plan.events.filter(e => e.kind === 'dial').length} dial steps` : ` · ${S.plan.turns.length} turns`);
  plotCache = null; colCache = null;
}
function nextExample() {
  const L = EXAMPLES[S.cur.id]; S.ex = (S.ex + 1) % L.length;
  const [op, a, b] = L[S.ex]; runJob(op, a, b);
}
function fillExamples() {
  $('examples').innerHTML = EXAMPLES[S.cur.id].map(([op, a, b, t], i) => `<button type="button" data-i="${i}"><b>${fmt(a)} ${op} ${fmt(b)}</b><span>${esc(t)}</span></button>`).join('');
  $('examples').querySelectorAll('button').forEach(bt => bt.addEventListener('click', () => { S.ex = +bt.dataset.i; const [op, a, b] = EXAMPLES[S.cur.id][S.ex]; runJob(op, a, b); if (!S.speed) setSpeed(S.lastSpeed); }));
  const [la, lb] = LIMIT[S.cur.id]['×'];
  $('limits').textContent = S.cur.id === 'pascaline' ? `Six wheels: sums up to ${fmt(la)}; a carry out of the top wheel is lost. For ×, the multiplier is at most ${lb}.` : `Eight sliders, eleven result wheels, six counter wheels: a up to ${fmt(la)}, b up to ${fmt(lb)}.`;
}
$('run').addEventListener('click', () => { runJob($('inOp').value, $('inA').value, $('inB').value); if (!S.speed) setSpeed(S.lastSpeed); });

// ── machine swap ────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(false);
    caseVisible(B, S.base);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    S.ex = 0;
    const [op, a, b] = EXAMPLES[id][0];
    runJob(op, a, b);
    S.Q = sc.pose(S.t);
    stage.root.add(B.root);
    cards.reset();
    fillPanel(); fillExamples();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = sc.box.R * 0.5; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null; colCache = null;
  } finally { S.swapping = false; }
}
const caseVisible = (B, on) => { for (const k of ['base', 'cover']) if (B.parts[k]) B.parts[k].holder.visible = on; };

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  pascaline: { title: 'Pascaline', kind: 'Blaise Pascal · 1642 · falling-weight carry', lede: 'Six digit wheels, each turned with a stylus. When a wheel passes from 9 to 0, a weighted lever, the sautoir, falls and pushes the next wheel one tenth. The weight was lifted while the wheel turned, so a carry through every wheel takes no more force than one.' },
  curta: { title: 'Curta', kind: 'Curt Herzstark · 1948 · stepped drum', lede: 'A calculator that fits in one hand. Eight sliders set a number; each crank turn adds it to the result, through one stepped drum with teeth of nine lengths. Lift and turn the carriage to shift a place: multiplication is turns and shifts, and the turn counter shows the multiplier.' },
};
const ABOUT = {
  pascaline: [
    ['The sautoir', 'Earlier machines (Schickard, 1623) carried with a single tooth, so a long chain of nines had to be pushed through by the user, all at once. Pascal\'s weight is lifted a little at each step and falls at 9 to 0: the carries go one after the other.'],
    ['Only forward', 'The weight blocks the wheels from turning back. To subtract, Pascal\'s users added the nines\' complement, shown on a second row of digits.'],
    ['Multiplying', 'There is no multiplication mechanism. a × b is a added b_k times at each place k. That is many dial turns, which the step count on the Run tab shows.'],
  ],
  curta: [
    ['The stepped drum', 'Leibniz made the stepped drum in 1673. Nine teeth of lengths 1 to 9 run along it. A gear moved along the drum meets as many teeth as its slider digit, so one turn adds that digit.'],
    ['Carries in one turn', 'Each turn has an add phase and then a carry phase. The carry teeth sit on a helix, so the lowest wheel carries first; a carry that makes the next wheel go 9 to 0 is taken by the next tooth, later in the same turn.'],
    ['Herzstark', 'Curt Herzstark drew the design while a prisoner in Buchenwald. About 140 000 were made in Liechtenstein until electronic calculators replaced them in the 1970s.'],
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
  pascaline: {
    three: { az: 18, el: 16, explode: 0, k: 1.15, at: null },
    close: { az: 26, el: 9, explode: 0, k: 0.5, at: 'carry' },
    top: { az: 0, el: 62, explode: 0, k: 1.0, at: null },
    side: { az: 55, el: 14, explode: 0, k: 1.2, at: null },
    exploded: { az: 24, el: 22, explode: 1, k: 1.6, at: null },
  },
  curta: {
    three: { az: 62, el: 22, explode: 0, k: 0.95, at: null },
    close: { az: 160, el: 16, explode: 0, k: 0.8, at: 'drum' },
    top: { az: 0, el: 66, explode: 0, k: 0.8, at: 'dial' },
    side: { az: 115, el: 10, explode: 0, k: 0.95, at: null },
    exploded: { az: 40, el: 20, explode: 1, k: 1.35, at: null },
  },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[S.cur.id][name];
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
function setSpeed(r) {
  r = Math.max(0, Math.min(8, r));
  if (r > 0) S.lastSpeed = r;
  S.speed = r;
  $('speed').value = r; $('speedV').textContent = `${r}×`;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.speed === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('speed').addEventListener('input', e => setSpeed(+e.target.value));
$('dockPlay').addEventListener('click', () => setSpeed(S.speed ? 0 : S.lastSpeed));
$('scrub').addEventListener('input', e => { setSpeed(0); if (S.plan) S.t = +e.target.value / 1000 * S.plan.T; S.endT = 0; });
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) caseVisible(o.B, on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  if (what === 'loop') { S.loop = on; $('tLoop').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
$('tLoop').addEventListener('click', () => setShow('loop', !S.loop));

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

// ── the digit-wheel plot ────────────────────────────────────────────────────
// One column per dial (Pascaline) or per crank turn (Curta): the digits of
// every wheel after it, a red mark on each wheel that took a carry in it,
// and the overflow on the top line. The column of the time S.t is lit.
let colCache = null;
function columns() {
  if (colCache && colCache.plan === S.plan) return colCache;
  const P = S.plan, cols = [];
  let start;
  if (P.kind === 'pascaline') {
    const D = P.events.length ? P.events[0].before.slice() : P.digits.slice();
    start = D.slice();
    let col = null;
    for (const e of P.events) {
      if (!col || col.op !== e.op) { col = { op: e.op, t0: e.t0, carry: new Set(), over: false, lab: `w${P.dials[e.op].wheel} +${P.dials[e.op].d}` }; cols.push(col); }
      if (e.kind === 'dial') D[e.wheel] = (e.from + 1) % 10;
      if (e.kind === 'carry') { if (e.wheel < P.N) { D[e.wheel] = (e.from + 1) % 10; col.carry.add(e.wheel); } else col.over = true; }
      col.d = D.slice(); col.t1 = e.t0 + e.dur;
    }
  } else {
    start = new Array(P.U.NR).fill(0);
    for (const e of P.turns) cols.push({ op: e.turn, t0: e.t0, t1: e.t0 + 1, d: e.after.slice(), carry: new Set(e.carries.map(c => c.j)), over: e.overflow, lab: `c${e.shift}` });
  }
  colCache = { plan: P, cols, start, rows: P.kind === 'pascaline' ? P.N : P.U.NR };
  return colCache;
}
function curCol(C) {
  let k = -1;
  for (let i = 0; i < C.cols.length; i++) if (S.t >= C.cols[i].t0) k = i;
  return k;
}
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height || !S.plan) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d'), C = columns(), k = curCol(C);
  const key = `${k}|${C.cols.length}|${w}|${h}|${C.plan.T}`;
  if (plotCache === key) return;
  plotCache = key;
  g.clearRect(0, 0, w, h);
  const padL = 26 * dpr, padT = 14 * dpr, padB = 14 * dpr, rowH = (h - padT - padB) / C.rows;
  const cw = Math.max(16 * dpr, Math.min(30 * dpr, rowH * 1.4)), fit = Math.max(1, Math.floor((w - padL - 4 * dpr) / cw));
  const first = Math.max(0, Math.min(C.cols.length - fit, k - fit + 3));
  g.font = `${Math.min(11 * dpr, rowH * 0.72)}px ui-monospace,Menlo,monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  // wheel names on the left, top wheel on top
  g.fillStyle = 'rgba(141,144,166,0.9)';
  const sup = n => String(n).split('').map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+ch]).join('');
  for (let j = 0; j < C.rows; j++) g.fillText(`10${sup(j)}`, padL / 2, padT + (C.rows - 1 - j + 0.5) * rowH);
  for (let i = first; i < Math.min(C.cols.length, first + fit); i++) {
    const col = C.cols[i], x = padL + (i - first) * cw, live = i === k;
    if (live) { g.fillStyle = 'rgba(226,194,122,0.16)'; g.fillRect(x, padT - 2 * dpr, cw - 2 * dpr, h - padT - padB + 4 * dpr); }
    for (let j = 0; j < C.rows; j++) {
      const y = padT + (C.rows - 1 - j + 0.5) * rowH, carried = col.carry.has(j);
      if (carried) { g.fillStyle = 'rgba(233,120,120,0.85)'; g.beginPath(); g.arc(x + cw / 2 - dpr, y, Math.min(rowH, cw) * 0.42, 0, 7); g.fill(); }
      const prev = i ? C.cols[i - 1].d[j] : C.start[j], chg = col.d[j] !== prev;
      g.fillStyle = carried ? '#160c0c' : chg ? (live ? '#ffe2a8' : '#e2c27a') : 'rgba(170,176,200,0.42)';
      g.fillText(String(col.d[j]), x + cw / 2 - dpr, y);
    }
    if (col.over) { g.fillStyle = '#e9a0a8'; g.fillText('↑', x + cw / 2 - dpr, padT - 6 * dpr); }
    if (i % Math.max(1, Math.ceil(30 * dpr / cw)) === 0 || live) { g.fillStyle = live ? '#ffe2a8' : 'rgba(141,144,166,0.8)'; g.fillText(String(i + 1), x + cw / 2 - dpr, h - padB / 2); }
  }
  if (!C.cols.length) { g.fillStyle = 'rgba(141,144,166,0.9)'; g.fillText('nothing to dial', w / 2, h / 2); }
  $('legend').innerHTML = `<span class="lo"><i></i>digit after the ${S.cur.id === 'pascaline' ? 'dial' : 'turn'}</span><span class="la"><i></i>carry into the wheel</span>`;
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const id = S.cur.id, Q = S.Q, J = S.job, P = S.plan;
  if (!Q || !J) return;
  const want = J.op === '+' ? J.a + J.b : J.a * J.b;
  let html = `<tr><th>${fmt(J.a)} ${J.op} ${fmt(J.b)}</th><th></th></tr>` + row('Exact', fmt(want));
  if (id === 'pascaline') {
    const e = Q.ev, done = Math.min(P.carries, Q.carriesDone);
    html += row('Wheels show', Q.digits.slice().reverse().join(' ')) + row('Sautoir falls', `${done} of ${P.carries}`) + row('Overflow', P.overflow ? `${P.overflow} (lost)` : 'none') + row('Dial', `${Math.min(P.dials.length, (e ? e.op : P.dials.length - 1) + 1)} of ${P.dials.length}`);
    let now;
    if (!e) now = S.t >= P.T ? `<b>Done</b><span>The wheels show ${fmt(Q.value)}${P.overflow ? ' (the top carry fell off the end)' : ''}.</span>` : '<b>Ready</b><span>The stylus is at the first wheel.</span>';
    else if (e.kind === 'dial') now = `<b>Dial wheel ${e.wheel}</b><span>The stylus turns it from ${e.from} to ${(e.from + 1) % 10}${e.from === 9 ? ': the sautoir falls next' : ''}.</span>`;
    else if (e.kind === 'carry') now = e.wheel < P.N ? `<b>Carry ${e.src} → ${e.wheel}</b><span>The sautoir of wheel ${e.src} falls and pushes wheel ${e.wheel} from ${e.from} to ${(e.from + 1) % 10}.</span>` : `<b>Overflow</b><span>The top wheel went 9 to 0; there is no wheel to take the carry.</span>`;
    else now = `<b>Next digit</b><span>The stylus moves to wheel ${e.wheel}.</span>`;
    $('now').innerHTML = now;
  } else {
    const e = Q.ev, done = Math.min(P.carries, Q.carriesDone);
    html += row('Result', fmt(Q.value)) + row('Counter', fmt(Q.count)) + row('Setting', fmt(valueOf(Q.set.map(Math.round)))) + row('Carriage', `shift ${Math.round(Q.shift)}`) + row('Turns', `${Q.turnsDone} of ${P.turns.length}`) + row('Carries', `${done} of ${P.carries}`);
    let now;
    if (!e) now = S.t >= P.T ? `<b>Done</b><span>Result ${fmt(Q.value)}, counter ${fmt(Q.count)}.</span>` : '<b>Ready</b>';
    else if (e.kind === 'set') now = '<b>Set the sliders</b><span>Each slider moves its gear to the level of its digit.</span>';
    else if (e.kind === 'shift') now = `<b>Shift the carriage</b><span>To position ${e.to}: the next turns add ${10 ** e.to} × the setting.</span>`;
    else now = Q.phase === 'add' ? `<b>Turn ${e.turn + 1} · add</b><span>The drum teeth turn each setting gear its digit.</span>` : Q.phase === 'carry' ? `<b>Turn ${e.turn + 1} · carry</b><span>${e.carries.length ? `The carry helix passes the wheels from the lowest up: ${e.carries.length} carr${e.carries.length > 1 ? 'ies' : 'y'} in this turn.` : 'No wheel went past 9 in this turn.'}</span>` : `<b>Turn ${e.turn + 1}</b><span>Between the phases.</span>`;
    $('now').innerHTML = now;
  }
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const id = S.cur.id;
  const E = {
    pascaline: [['Dial', 'wheel k  +=  d tenths', 'stylus to the stop'], ['Carry', 'wheel j: 9 → 0  ⇒  wheel j+1  += 1', 'the sautoir falls'], ['Product', 'a × b = Σ b_k · a · 10^k', 'repeated addition']],
    curta: [['Stepped drum', 'gear at level s meets s teeth', 'one turn adds s'], ['One turn', 'R ← R + S · 10^c', 'c = carriage shift'], ['Product', 'a × b: b_k turns at shift k', 'the counter shows b']],
  }[id];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, P = S.plan;
  switch (key) {
    case 'display': return ['Shows', fmt(Q.value)];
    case 'carries': return ['Carries', `${Math.min(P.carries, Q.carriesDone)} of ${P.carries}`];
    case 'turns': return ['Turns', `${Q.turnsDone} of ${P.turns.length}`];
    case 'set': return ['Setting', Q.set.map(Math.round).slice().reverse().join('')];
    case 'shift': return ['Shift', String(Math.round(Q.shift))];
    case 'count': return ['Counter', fmt(Q.count)];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4 || !S.Q || !S.job) return;
  const Q = S.Q, J = S.job, id = S.cur.id;
  const sub = id === 'pascaline' ? `${fmt(J.a)} ${J.op} ${fmt(J.b)} · shows ${fmt(Q.value)} · falls ${Math.min(S.plan.carries, Q.carriesDone)}` : `${fmt(J.a)} ${J.op} ${fmt(J.b)} · result ${fmt(Q.value)} · counter ${fmt(Q.count)}`;
  $('read').innerHTML = `<span class="hi">${esc(INFO[id].title)}</span><br><span class="lo">${sub}</span>`;
  const T = S.plan.T || 1;
  $('scrub').value = Math.round(Math.min(1, S.t / T) * 1000);
  $('scrubV').textContent = `${Math.round(Math.min(1, S.t / T) * 100)}%`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur || !S.plan) return;
  const cur = S.cur;
  if (S.t < S.plan.T) S.t = Math.min(S.plan.T, S.t + RATE[cur.id] * S.speed * dt);
  else if (S.speed > 0 && (S.endT += dt) > HOLD && (S.loop || saverOn)) nextExample();
  S.Q = cur.sc.pose(S.t);
  for (const o of S.leaving) o.sc.pose(o.sc.plan.T);
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
window.__calculators = { S, stage, cards, swapTo, setView, setSpeed, setExplode, setShow, setOpen, setAna, runJob };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('tLoop').classList.toggle('on', S.loop);
setSpeed(1); setExplode(0);
stage.place({ az: -40, el: 20, r: 1600, target: new THREE.Vector3(0, 40, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'pascaline');
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
// each machine: the whole machine, a close view of the carry, the view from
// above, the exploded machine and close-ups of 3 parts (lib/mech-tour.js),
// then a fade to the other machine. Each step holds seconds/10 (at least
// 5 s). The examples run and loop under the tour. calm (1 = slowest) slows
// the job, not the step time. opts.label names each step with the
// relations and live values. No exit(): the shell reloads the page.
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
    const SPEED = Math.round((2.2 - 1.4 * calm) * 10) / 10;
    setSpeed(SPEED);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['a', 'm1'], ['b', 'm2'], ['R', 'm3'], ['C', 'm4'], ['k', 'm5'], ['c', 'm6']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = {
      pascaline: [String.raw`d_j: 9 \to 0 \;\Rightarrow\; d_{j+1} \mathrel{+}= 1`, String.raw`a \times b = \sum_k b_k\, a\, 10^k`],
      curta: [String.raw`R \leftarrow R + S\cdot 10^{c}`, String.raw`a \times b:\; b_k \text{ turns at shift } k`],
    };
    const EQ = { pascaline: ['9 → 0 ⇒ next wheel + 1', 'a × b = Σ b_k a 10^k'], curta: ['R ← R + S · 10^c', 'a × b: b_k turns at shift k'] };
    const tex = () => TEX[S.cur.id], eq = () => EQ[S.cur.id];
    const params = () => {
      const Q = S.Q, J = S.job; if (!Q || !J) return [];
      const out = [P('a', 'first number', fmt(J.a), 'm1'), P('b', J.op === '+' ? 'added' : 'multiplier', fmt(J.b), 'm2'), P('R', S.cur.id === 'pascaline' ? 'wheels show' : 'result', fmt(Q.value), 'm3')];
      if (S.cur.id === 'curta') out.push(P('C', 'turn counter', fmt(Q.count), 'm4'));
      out.push(P('k', 'carries', `${Math.min(S.plan.carries, Q.carriesDone)}`, 'm5'));
      return out;
    };
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(sautoir_[0-2]|axle_[0-2]|drum|gear_[0-3]|shaft_[0-3])$/.test(q.id)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: S.cur.id === 'pascaline' ? 'The falling-weight carry' : 'The stepped drum', sub: S.cur.id === 'pascaline' ? 'Each sautoir falls in turn' : 'A gear at level s meets s teeth', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: S.cur.id === 'pascaline' ? 'From above: dials and digit windows' : 'From above: result and turn counter', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['sautoir', 'wheel', 'dial', 'drum', 'setgear', 'slider', 'carriage', 'result', 'crank'], skip: ['base', 'cover', 'shaft'] });
    // the Pascaline has a back wall: keep the camera on the open front
    const azR = () => (S.cur.id === 'pascaline' ? [-65, 65] : null);
    const MOVES = ['push', 'pull', 'orbit', 'truck', 'crane'];
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS[0], STEPS[1], STEPS[2], STEPS[3], ...tour.pick(3).map(focusStep)]; };
    const show = s => {
      setSpeed(s.still ? 0 : SPEED);
      if (s.focus) tour.show(s.focus);
      else {
        tour.clear(); setView(s.view, true);
        const mv = S.cur.id === 'pascaline' ? MOVES[Math.floor(rnd() * MOVES.length)] : undefined;
        tour.fromFly({ kind: 'view', exploded: s.view === 'exploded', move: mv, azRange: azR() });
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
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    (async () => {
      if (!S.cur || S.cur.id !== order[first]) await swapTo(order[first]);
      // a seeded example to start, so two runs do not open alike
      S.ex = Math.floor(rnd() * EXAMPLES[S.cur.id].length) - 1; nextExample();
      advance();
    })();
    return { canvas, warmupMs: 1500 };
  },
};

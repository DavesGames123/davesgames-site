// ============================================================================
//  CURTA  ·  main.js — type swap, jobs, direct controls, panels, plots, saver
// ----------------------------------------------------------------------------
//  mech.js gives the plan of a job and at(plan, t); scene.js poses every part
//  from it; stage.js renders; cards.js shows the part cards and labels.
//
//  MOTION
//    S.acts (actions) from S.start (a machine state) make the plan S.P
//    (mech.js plan). S.t is in seconds at 1x; each frame adds S.speed dt,
//    and sc.pose(S.t) moves the parts. A typed job replaces the actions
//    after the current event, so a new job starts where the machine is; a
//    direct action (act) cuts the job after its current event and appends
//    itself. When the machine is idle, the plan restarts from its end
//    state (rebase), so it does not grow.
//
//  GREP MAP
//    function swapTo ............ build a type and cross-fade to it
//    function rebase / act ...... the live plan and the direct actions
//    function runJob ............ a typed job: plan, steps, note
//    const EXAMPLES ............. example jobs
//    const VIEWS / setView ...... camera presets, cutaway, follow
//    function bindDrag .......... sliders, crank, carriage, levers in 3D
//    function fillRegs .......... the register strip over the view
//    function drawTurn .......... the turn timeline plot
//    function fillLearn ......... history and the linked diagrams
//    function frame ............. step, pose, explode, follow, stage, cards
//    window.snSaver ............. the screensaver tour (lib/mech-tour.js)
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, geo, plan, at, makeJob, parseJob, turnPlan, teethMet, initState, digitsOf, valueOf, fmt, TOOTH0, TOOTH_P, RES_CARRY, CNT_CARRY, CNT_DRIVE } from './mech.js';
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
const HOLD = 3;
const D = Math.PI / 180;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel'), $('dock'), $('regs')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], t: 0, speed: 1, lastSpeed: 1, Q: null, view: 'three', job: null, steps: [], jobT0: 0, acts: [], start: null, P: null, endT: 0,
  loop: true, ex: 0, explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, follow: false, section: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6, log: [], swapping: false, cutAz: 95,
};
let saverOn = false, saverTick = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => (S.Q ? S.Q.drum * D : 0),
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
  skipTap: () => dragTook,
});
let dragTook = false;
stage.onStart = () => hideHint();
const U = () => S.cur.sc.U;

// ── the live plan ───────────────────────────────────────────────────────────
function evIndex(P, t) { const ev = P.events; let k = -1; for (let i = 0; i < ev.length; i++) if (ev[i].t0 <= t) k = i; else break; return k; }
// the state at the end of every queued action
const endState = () => (S.P ? S.P.end : initState(U()));
function replan() { S.P = plan(U(), S.acts, S.start, S.steps); S.cur.sc.setPlan(S.P); }
// the machine is idle: restart the plan from its end state
function rebase() { S.start = endState(); S.acts = []; S.t = 0; S.endT = 0; S.jobT0 = 0; replan(); }
// cut the queued actions after the event that runs now
function cutNow() {
  if (!S.P || S.t >= S.P.T) { rebase(); return; }
  const i = evIndex(S.P, S.t);
  S.acts = i < 0 ? [] : S.acts.slice(0, S.P.events[i].ai + 1);
  replan();
}
const toast = (() => { let tm = 0; return msg => { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(tm); tm = setTimeout(() => el.classList.remove('show'), 1600); }; })();
// one direct action from the operate panel or a drag in the view
function act(A, text) {
  if (!S.cur || saverOn) return;
  if (S.job) { S.job = null; S.steps = []; S.log = []; $('jobNote').textContent = 'Direct control: the typed job stopped.'; $('jobNote').classList.remove('err'); }
  cutNow();
  if (S.t >= S.P.T) rebase();
  S.log.push(text); if (S.log.length > 40) S.log.shift();
  S.acts.push({ ...A });
  replan();
  S.endT = 0;
  if (!S.speed) setSpeed(S.lastSpeed);
  fillOperate(); fillSteps(true);
}

// ── jobs ────────────────────────────────────────────────────────────────────
const EXAMPLES = [
  ['×', 4711, 23, 'Product with a carriage shift', {}],
  ['×', 4711, 9, 'Short cut: 9 = 10 − 1', { short: true }],
  ['+', 99999999, 1, 'One carry ripples through eight wheels', {}],
  ['−', 1000, 1, 'Subtraction by nines\' complement', {}],
  ['÷', 1000, 7, 'Restoring division, two places', { k: 2 }],
  ['√', 2, 0, 'Square root of 2 by odd numbers', { k: 2 }],
  ['×', 1948, 1972, 'The production years', { short: true }],
  ['−', 0, 1, 'Below zero: a row of nines', {}],
];
const exprOf = (op, a, b) => (op === '√' ? `√${fmt(a)}` : `${fmt(a)} ${op} ${fmt(b)}`);
function answerOf(job) {
  const { op, a, b } = job, k = job.k || 0, M = 10 ** U().NR;
  if (op === '+') return fmt((a + b) % M);
  if (op === '−') return a >= b ? fmt(a - b) : `−${fmt(b - a)}  (shows ${fmt(((a - b) % M + M) % M)})`;
  if (op === '×') return fmt(a * b) + (a * b >= M ? `  (shows ${fmt((a * b) % M)}: overflow)` : '');
  if (op === '÷') return `${(job.expect.q / 10 ** k).toFixed(k)} r ${fmt(job.expect.r)}${k ? ` × 10⁻${k}` : ''}`;
  if (op === '√') return (job.expect.root / 10 ** k).toFixed(k);
  return '';
}
function runJob(op, a, b, o = {}) {
  if (!S.cur) return;
  const job = makeJob(U(), op, a, b, o);
  const note = $('jobNote');
  if (job.err) { note.textContent = job.err; note.classList.add('err'); return false; }
  note.classList.remove('err');
  S.job = { ...job, k: o.k || 0 };
  // continue from the event that runs now
  cutNow();
  if (S.t >= S.P.T) rebase();
  S.jobT0 = S.P.T;
  const off = 0;
  S.steps = job.steps;
  S.acts = S.acts.map(A => ({ ...A, step: -1 })).concat(job.actions.map(A => ({ ...A, step: A.step + off })));
  replan();
  S.endT = 0;
  const turns = S.P.events.filter(e => e.a === 'turn' && e.t0 >= S.jobT0 - 1e-9).length;
  note.textContent = `${exprOf(op, a, b)} = ${answerOf(S.job)} · ${turns} turn${turns === 1 ? '' : 's'}${job.short ? ' with the short cut' : ''}`;
  $('inExpr').value = exprOf(op, a, b).replace(/ /g, '').replace(/(\d)([+−×÷])(\d)/, '$1 $2 $3');
  fillSteps(true);
  return true;
}
function nextExample() { S.ex = (S.ex + 1) % EXAMPLES.length; const [op, a, b, , o] = EXAMPLES[S.ex]; runJob(op, a, b, o); }
function fillExamples() {
  $('examples').innerHTML = EXAMPLES.map(([op, a, b, t], i) => `<button type="button" data-i="${i}"><b>${esc(exprOf(op, a, b))}</b><span>${esc(t)}</span></button>`).join('');
  $('examples').querySelectorAll('button').forEach(bt => bt.addEventListener('click', () => { S.ex = +bt.dataset.i; const [op, a, b, , o] = EXAMPLES[S.ex]; runJob(op, a, b, o); if (!S.speed) setSpeed(S.lastSpeed); if (PHONE_Q.matches) setOpen(false); }));
}
function runTyped() {
  const J = parseJob($('inExpr').value);
  if (!J) { $('jobNote').textContent = 'Type for example 4711 × 23, 1000 / 7, 12 - 5 or sqrt 2.'; $('jobNote').classList.add('err'); return; }
  if (runJob(J.op, J.a, J.b, { short: $('optShort').checked, k: +$('optK').value }) && !S.speed) setSpeed(S.lastSpeed);
}
$('run').addEventListener('click', runTyped);
$('inExpr').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runTyped(); } });

// ── type swap ───────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(S.section, S.cutAz);
    caseVisible(B, S.base);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    S.start = initState(sc.U); S.acts = []; S.t = 0; S.job = null; S.log = [];
    replan();
    if (!saverOn) { S.ex = 0; const [op, a, b, , o] = EXAMPLES[0]; runJob(op, a, b, o); }
    S.Q = sc.pose(S.t);
    stage.root.add(B.root);
    cards.reset();
    fillPanel(); fillOperate(); fillLearn();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = sc.box.R * 0.25; stage.controls.maxDistance = sc.box.R * 9;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}
const caseVisible = (B, on) => { for (const k of ['shell', 'base']) if (B.parts[k]) B.parts[k].holder.visible = on; };

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  I: { title: 'Curta Type I', kind: 'Curt Herzstark · made 1948 – 1972 · stepped drum', lede: 'A mechanical calculator that fits in one hand. Eight sliders set a number; each crank turn adds it to the 11-digit result through one central stepped drum. Pull the crank up to subtract. Lift and turn the carriage to shift a place; the 6-digit counter counts the turns.' },
  II: { title: 'Curta Type II', kind: 'Curt Herzstark · made 1954 – 1972 · stepped drum', lede: 'The larger Curta: eleven sliders, a 15-digit result and an 8-digit counter, on the same plan as the Type I: one stepped drum, a lifting crank for subtraction and a carriage that turns to shift.' },
};
function fillPanel() {
  const id = S.cur.id, box = $('engInfo'), I = INFO[id];
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = I.title; $('engKind').textContent = I.kind; $('engLede').textContent = I.lede;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
    $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = UNITS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── operate panel ───────────────────────────────────────────────────────────
function fillOperate() {
  if (!S.cur) return;
  const u = U(), E = endState(), box = $('sliders');
  box.style.setProperty('--ns', u.NS);
  if (box.childElementCount !== u.NS) {
    box.innerHTML = Array.from({ length: u.NS }, (_, i) => { const g = u.NS - 1 - i; return `<div class="sc"><button type="button" data-g="${g}" data-d="1" aria-label="Slider ${g + 1} up">▲</button><div class="sv" data-g="${g}">0</div><button type="button" data-g="${g}" data-d="-1" aria-label="Slider ${g + 1} down">▼</button><div class="sp">${g + 1}</div></div>`; }).join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const g = +b.dataset.g, cur = endState().S.slice(), d = Math.max(0, Math.min(9, cur[g] + +b.dataset.d));
      if (d === cur[g]) return; cur[g] = d; act({ a: 'set', v: cur, dur: 0.35 }, `Slider ${g + 1} to ${d}`);
    }));
  }
  box.querySelectorAll('.sv').forEach(el => { el.textContent = E.S[+el.dataset.g]; });
  $('opLift').textContent = E.up ? 'Push crank down' : 'Pull crank up'; $('opLift').classList.toggle('on', E.up);
  $('opRev').textContent = `Reversing lever: ${E.rev ? 'on' : 'off'}`; $('opRev').classList.toggle('on', E.rev);
  $('opShiftV').textContent = String(E.c + 1);
}
$('opTurn').addEventListener('click', () => act({ a: 'turn' }, endState().up ? 'Turn (subtract)' : 'Turn (add)'));
$('opLift').addEventListener('click', () => { const up = !endState().up; act({ a: 'lift', up }, up ? 'Crank up' : 'Crank down'); });
$('opShiftL').addEventListener('click', () => { const c = endState().c; if (c > 0) act({ a: 'shift', to: c - 1 }, `Shift to ${c}`); });
$('opShiftR').addEventListener('click', () => { const c = endState().c; if (c < U().NC - 1) act({ a: 'shift', to: c + 1 }, `Shift to ${c + 2}`); });
$('opClear').addEventListener('click', () => act({ a: 'clear' }, 'Clear'));
$('opRev').addEventListener('click', () => { const on = !endState().rev; act({ a: 'rev', on }, `Reversing lever ${on ? 'on' : 'off'}`); });

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 28, el: 24, k: 0.98, at: null, explode: 0, cut: false },
  top: { az: 0, el: 64, k: 0.62, at: 'top', explode: 0, cut: false },
  section: { az: 92, el: 14, k: 0.74, at: 'drum', explode: 0, cut: true },
  carry: { az: 96, el: 24, k: 0.36, at: 'carry', explode: 0, cut: true },
  sliders: { az: 6, el: 6, k: 0.62, at: 'sliders', explode: 0, cut: false },
  exploded: { az: 32, el: 16, k: 1.95, at: null, explode: 1, cut: false },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.1 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name], at0 = v.at ? S.cur.sc.keys[v.at] : S.cur.sc.box.c;
  const ex = v.explode ? [0, S.cur.sc.box.R * 0.25, 0] : [0, 0, 0];
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k), target: new THREE.Vector3(at0[0] + ex[0], at0[1] + ex[1], at0[2] + ex[2]), t: soft ? 1.8 : 1.4 });
  setExplode(v.explode);
  setSection(v.cut);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => { setView(b.dataset.view); if (PHONE_Q.matches) setOpen(false); }));
function setSection(on) {
  S.section = on; $('tSection').classList.toggle('on', on);
  for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(on, S.cutAz);
}
$('tSection').addEventListener('click', () => setSection(!S.section));
$('tFollow').addEventListener('click', () => { S.follow = !S.follow; $('tFollow').classList.toggle('on', S.follow); if (!S.follow) setView(S.view, true); });

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) { S.explodeTarget = x; $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%'; }
$('explode').addEventListener('input', e => setExplode(+e.target.value));
function setSpeed(r) {
  r = Math.max(0, Math.min(8, r));
  if (r > 0) S.lastSpeed = r;
  S.speed = r;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.speed === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('dockPlay').addEventListener('click', () => setSpeed(S.speed ? 0 : S.lastSpeed));
$('scrub').addEventListener('input', e => { setSpeed(0); if (S.P) { const T0 = S.jobT0, T = S.P.T; S.t = T0 + +e.target.value / 1000 * Math.max(0, T - T0); } S.endT = 0; });
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
  // desktop: every group shows; phone: only the chosen one
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
setTimeout(hideHint, 12000);

// ── direct manipulation in the view ─────────────────────────────────────────
// A pointer down on a slider knob, the crank, the carriage or a lever takes
// the drag from the orbit controls (capture phase on #stage).
function partOf(obj) {
  for (const id in S.cur.B.parts) { const q = S.cur.B.parts[id]; let o = obj; while (o) { if (o === q.root) return q; o = o.parent; } }
  return null;
}
const proj = new THREE.Vector3();
function screenY(p) { const r = $('view').getBoundingClientRect(); proj.set(...p).project(stage.camera); return r.top + (1 - proj.y) / 2 * r.height; }
function bindDrag() {
  const canvas = $('view');
  let drag = null;
  $('stage').addEventListener('pointerdown', e => {
    dragTook = false;
    if (e.target !== canvas || saverOn || !S.cur || e.button > 0) return;
    const hit = cards.pick(e.clientX, e.clientY); if (!hit) return;
    const q = partOf(hit.obj); if (!q) return;
    const kind = q.info === 'slider' ? 'slider' : q.info === 'crank' ? 'crank' : q.info === 'carriage' || q.info === 'result' || q.info === 'counter' ? 'carriage' : q.info === 'clearing' ? 'clear' : q.info === 'revlever' ? 'rev' : null;
    if (!kind) return;
    drag = { kind, q, x0: e.clientX, y0: e.clientY, done: 0, id: e.pointerId };
    dragTook = true;
    if (kind === 'slider') {
      const g = +q.id.split('_')[1], G = S.cur.sc.G, a = G.stationAz(g);
      const P = y => [G.Rb * Math.sin(a * D), y, G.Rb * Math.cos(a * D)];
      drag.g = g; drag.y0s = screenY(P(G.levelY(0))); drag.y9s = screenY(P(G.levelY(9)));
    }
    stage.controls.enabled = false;
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    hideHint();
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (drag.kind === 'slider') {
      const f = (e.clientY - drag.y0s) / (drag.y9s - drag.y0s), d = Math.max(0, Math.min(9, Math.round(f * 9)));
      const cur = endState().S.slice();
      if (d !== cur[drag.g]) { cur[drag.g] = d; act({ a: 'set', v: cur, dur: 0.14 }, `Slider ${drag.g + 1} to ${d}`); drag.done++; }
    } else if (drag.kind === 'crank' && !drag.done) {
      if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) { const up = dy < 0; if (up !== endState().up) act({ a: 'lift', up }, up ? 'Crank up' : 'Crank down'); toast(up ? 'Crank up: subtract' : 'Crank down: add'); drag.done = 1; }
      else if (Math.abs(dx) > 40) { act({ a: 'turn' }, endState().up ? 'Turn (subtract)' : 'Turn (add)'); drag.done = 1; }
    } else if (drag.kind === 'carriage') {
      const steps = Math.trunc(dx / 46) - drag.done;
      if (steps) { const c = Math.max(0, Math.min(U().NC - 1, endState().c + Math.sign(steps))); if (c !== endState().c) { act({ a: 'shift', to: c }, `Shift to ${c + 1}`); toast(`Carriage at ${c + 1}`); } drag.done += Math.sign(steps); }
    }
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6;
    if (!moved && e.type === 'pointerup') {
      if (drag.kind === 'crank') act({ a: 'turn' }, endState().up ? 'Turn (subtract)' : 'Turn (add)');
      if (drag.kind === 'clear') { act({ a: 'clear' }, 'Clear'); toast('Clearing lever: both registers to 0'); }
      if (drag.kind === 'rev') { const on = !endState().rev; act({ a: 'rev', on }, `Reversing lever ${on ? 'on' : 'off'}`); toast(`Reversing lever ${on ? 'on' : 'off'}`); }
    }
    drag = null;
    stage.controls.enabled = true;
    canvas.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
bindDrag();

// ── register strip ──────────────────────────────────────────────────────────
let lastRegs = '';
function fillRegs() {
  const Q = S.Q, u = U(); if (!Q) return;
  const fl = v => Math.floor(v + 1e-6) % 10;
  const mov = v => Math.abs(v - Math.round(v)) > 0.02;
  const c = Math.round(Q.car);
  const row = (lab, vals, cls, pos) => `<div class="rr"><span class="rl">${lab}</span><span class="dg ${cls}">${vals.map((v, i) => `${i && (vals.length - i) % 3 === 0 ? '<i class="gap"></i>' : ''}<i class="${[mov(v.v) ? 'mv' : '', pos === v.j ? 'c0' : '', v.off ? 'off' : ''].join(' ')}">${fl(v.v)}</i>`).join('')}</span></div>`;
  const R = Q.R.map((v, j) => ({ v, j })).reverse(), C = Q.C.map((v, j) => ({ v, j })).reverse(), Sd = Q.set.map((v, j) => ({ v: Math.round(v), j })).reverse();
  const neg = fl(Q.R[u.NR - 1]) === 9 && Q.value > 10 ** u.NR / 2;
  const html = row('Setting', Sd, 'set', -1) + row('Result', R, '', c) + row('Counter', C, '', c)
    + `<div class="meta"><span>Carriage <b>${c + 1}</b></span><span class="${Q.lift > 0.5 ? 'sub' : ''}">Crank <b>${Q.lift > 0.5 ? 'up · subtract' : 'down · add'}</b></span><span>Counter <b>${(Q.lift > 0.5) !== (Q.rev > 0.5) ? '− per turn' : '+ per turn'}</b></span></div>`
    + (neg && Q.phase !== 'turn' ? `<div class="note2">Top digits 9: read as −${fmt(10 ** u.NR - Q.value)} (tens complement)</div>` : '');
  if (html !== lastRegs) { $('regs').innerHTML = html; lastRegs = html; }
}

// ── the turn timeline plot ──────────────────────────────────────────────────
// x: crank angle 0 .. 360 deg; rows: result stations (top: high), then the
// counter stations. Amber: an add tooth turns the station a tenth; red: a
// carry; teal: the counter. The cursor is the crank angle now.
let turnCache = '';
function drawTurn() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height || !S.P || !S.Q) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; turnCache = ''; }
  const ev = S.P.events; let E = null;
  if (S.Q.ev && S.Q.ev.a === 'turn') E = S.Q.ev;
  else { for (const e of ev) { if (e.a !== 'turn') continue; if (e.t0 <= S.t) E = e; else { if (!E) E = e; break; } } }
  const th = S.Q.ev && S.Q.ev.a === 'turn' ? S.Q.th : -1;
  const key = `${E ? E.t0 : -1}|${th.toFixed(1)}|${w}|${h}`;
  if (key === turnCache) return;
  turnCache = key;
  const g = c.getContext('2d'), u = U(), NR = u.NR, NC = u.NC;
  g.clearRect(0, 0, w, h);
  const padL = 30 * dpr, padR = 8 * dpr, padT = 8 * dpr, padB = 16 * dpr, rows = NR + NC + 1, rh = (h - padT - padB) / rows, X = a => padL + a / 360 * (w - padL - padR);
  g.font = `${Math.min(9.5 * dpr, rh * 0.8)}px ui-monospace,Menlo,monospace`; g.textBaseline = 'middle'; g.textAlign = 'right';
  // grid
  g.strokeStyle = 'rgba(141,144,166,0.14)'; g.lineWidth = 1;
  for (let a = 0; a <= 360; a += 45) { g.beginPath(); g.moveTo(X(a), padT); g.lineTo(X(a), h - padB); g.stroke(); }
  g.fillStyle = 'rgba(141,144,166,0.8)'; g.textAlign = 'center';
  for (let a = 0; a <= 360; a += 90) g.fillText(`${a}°`, X(a), h - padB / 2);
  g.textAlign = 'right';
  const yR = p => padT + (NR - 1 - p + 0.5) * rh, yC = q => padT + (NR + 1 + NC - 1 - q + 0.5) * rh;
  for (let p = 0; p < NR; p++) { g.fillStyle = 'rgba(141,144,166,0.75)'; g.fillText(`R${p + 1}`, padL - 4 * dpr, yR(p)); }
  for (let q = 0; q < NC; q++) { g.fillStyle = 'rgba(110,224,192,0.7)'; g.fillText(`C${q + 1}`, padL - 4 * dpr, yC(q)); }
  if (!E) { g.textAlign = 'center'; g.fillStyle = 'rgba(141,144,166,0.9)'; g.fillText('no crank turn in this job', w / 2, h / 2); return; }
  const T = E.T;
  for (const win of T.wins) {
    const y = win.reg === 'R' ? yR(win.p) : yC(win.p), live = th >= win.t0 && th <= win.t1, past = th > win.t1;
    g.fillStyle = win.kind === 'carry' ? (win.reg === 'R' ? '#ff7a6a' : '#9ff0d6') : win.reg === 'R' ? (win.w < 0 ? 'rgba(226,194,122,0.3)' : '#e2c27a') : '#6ee0c0';
    g.globalAlpha = live ? 1 : past || th < 0 ? 0.85 : 0.45;
    g.fillRect(X(win.t0), y - rh * 0.34, Math.max(1, X(win.t1) - X(win.t0)), rh * 0.68);
  }
  g.globalAlpha = 1;
  // the ripple: link each carry to the window that armed it
  g.strokeStyle = 'rgba(255,122,106,0.6)'; g.lineWidth = 1.2 * dpr;
  for (const A of T.armR) if (A.a > 0) { const cw = T.wins.find(x => x.kind === 'carry' && x.reg === 'R' && x.p === A.p); if (cw) { g.beginPath(); g.moveTo(X(A.a), yR(A.p - 1)); g.lineTo(X(cw.t0), yR(A.p)); g.stroke(); } }
  if (th >= 0) { g.strokeStyle = '#ffe2a8'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.moveTo(X(th), padT); g.lineTo(X(th), h - padB); g.stroke(); }
}

// ── steps, numbers, now ────────────────────────────────────────────────────
let lastStep = -2, stepsKey = '';
function fillSteps(force) {
  const list = S.job ? S.steps.map(s => s.text) : S.log;
  const k = S.job ? (S.t >= S.jobT0 ? S.Q?.step ?? -1 : -1) : list.length - 1;
  const key = (S.job ? 'j' : 'm') + list.length + '|' + (S.job ? S.jobT0 : 0);
  if (force || key !== stepsKey) {
    stepsKey = key;
    $('steps').innerHTML = list.length ? list.map((t, i) => `<li data-i="${i}">${esc(t)}</li>`).join('') : '<li>Work the machine, or run a job.</li>';
    if (S.job) $('steps').querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
      const e = S.P.events.find(x => x.step === +li.dataset.i && x.t0 >= S.jobT0 - 1e-9); if (e) { S.t = e.t0; S.endT = 0; }
    }));
    lastStep = -2;
  }
  if (k !== lastStep) {
    lastStep = k;
    $('steps').querySelectorAll('li').forEach((li, i) => { li.classList.toggle('on', i === k); li.classList.toggle('done', i < k); });
    const on = $('steps').querySelector('li.on'); if (on) { const p = $('steps'); const top = on.offsetTop - p.offsetTop; if (top < p.scrollTop || top > p.scrollTop + p.clientHeight - 30) p.scrollTop = top - 40; }
  }
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '', lastNow = '';
function fillNums() {
  const Q = S.Q, P = S.P; if (!Q || !P) return;
  const done = P.events.filter(e => e.a === 'turn' && e.t0 >= S.jobT0 - 1e-9 && e.t0 + e.dur <= S.t).length, all = P.events.filter(e => e.a === 'turn' && e.t0 >= S.jobT0 - 1e-9).length;
  let html = '';
  if (S.job) html += `<tr><th>${esc(exprOf(S.job.op, S.job.a, S.job.b))}</th><th>${esc(answerOf(S.job))}</th></tr>`;
  html += row('Setting', fmt(Q.setting)) + row('Result', fmt(Q.value)) + row('Counter', fmt(Q.count)) + row('Carriage', String(Math.round(Q.car) + 1)) + row('Turns', `${done} of ${all}`) + (Q.T ? row('Carries this turn', `${Q.carriesDone} of ${Q.T.carries}`) : '');
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  const e = Q.ev; let now;
  if (!e) now = S.t >= P.T ? (S.job ? `<b>Done</b><span>${esc(exprOf(S.job.op, S.job.a, S.job.b))} = ${esc(answerOf(S.job))}. Result ${fmt(Q.value)}, counter ${fmt(Q.count)}.</span>` : '<b>Ready</b><span>Set a number, then turn the crank.</span>') : '<b>Ready</b>';
  else if (e.a === 'set') now = '<b>Set the sliders</b><span>Each slider moves its setting gear to the level of its digit on the stepped drum.</span>';
  else if (e.a === 'lift') now = e.up ? '<b>Crank up</b><span>The stepped sleeve lifts half a level: each gear now meets 9 − s teeth; the subtraction carry slide goes down.</span>' : '<b>Crank down</b><span>The sleeve drops back: the gears meet s teeth again.</span>';
  else if (e.a === 'rev') now = `<b>Reversing lever ${e.on ? 'on' : 'off'}</b><span>${e.on ? 'Subtraction turns now count up.' : 'Add turns count up, subtraction turns count down.'}</span>`;
  else if (e.a === 'shift') now = `<b>Shift to ${e.to + 1}</b><span>The carriage lifts off its dogs, turns ${Math.abs(e.to - e.from)} place${Math.abs(e.to - e.from) > 1 ? 's' : ''} and drops: each turn now adds the setting × ${fmt(10 ** e.to)}.</span>`;
  else if (e.a === 'clear') now = '<b>Clear</b><span>The carriage lifts; the clearing lever swings once round and turns each wheel forward to 0.</span>';
  else {
    const T = e.T, ph = Q.turnPhase, w = Q.win;
    now = `<b>Turn ${e.s.up ? '(subtract)' : '(add)'} · ${Math.round(Q.th)}°</b><span>${ph === 'start' ? 'The crank leaves the detent.' : ph === 'add' ? (w && w.reg === 'R' ? `Tooth row ${w.k || ''} meets station ${w.p + 1}: wheel ${w.w + 1} takes a tenth.` : 'The stepped teeth pass the setting gears, the highest station last.') : T.carries ? `Carry phase: ${Q.carriesDone} of ${T.carries} carr${T.carries > 1 ? 'ies' : 'y'} done, from the lowest wheel up.` : 'Carry phase: no wheel passed 9 in this turn.'}</span>`;
  }
  if (now !== lastNow) { $('now').innerHTML = now; lastNow = now; }
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q;
  switch (key) {
    case 'display': return ['Result', fmt(Q.value)];
    case 'carries': return ['Carries this turn', Q.T ? `${Q.carriesDone} of ${Q.T.carries}` : '—'];
    case 'set': return ['Setting', fmt(Q.setting)];
    case 'shift': return ['Place', String(Math.round(Q.car) + 1)];
    case 'count': return ['Counter', fmt(Q.count)];
    case 'mode': return ['Crank', Q.lift > 0.5 ? 'up (subtract)' : 'down (add)'];
    case 'crankAt': return ['Crank angle', `${Math.round(Q.th)}°`];
    case 'dir': return ['Counter step', (Q.lift > 0.5) !== (Q.rev > 0.5) ? '−1' : '+1'];
    case 'rev': return ['Lever', Q.rev > 0.5 ? 'on' : 'off'];
  }
  return [key, '—'];
}

// ── learn ───────────────────────────────────────────────────────────────────
const L = { s: 3, up: false };
function drumSVG() {
  // unrolled drum: columns = tooth rows 1 .. 9, rows = levels 0 .. 9 (add)
  // and the half levels below them (complement)
  const W = 300, H = 230, x0 = 46, y0 = 12, cw = (W - x0 - 10) / 9, lh = (H - y0 - 22) / 10.5;
  const Y = l => y0 + (9.5 - l) * lh;     // level l centre
  const met = new Set(teethMet(L.s, L.up));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The stepped drum unrolled: a gear at level ${L.s} meets ${met.size} teeth">`;
  for (let l = 0; l <= 9; l++) s += `<text x="${x0 - 8}" y="${Y(l) + 3}" font-size="9" fill="#8d90a6" text-anchor="end" font-family="ui-monospace,monospace">${l}</text>`;
  for (let k = 1; k <= 9; k++) {
    const x = x0 + (k - 1) * cw + cw * 0.2, w = cw * 0.6;
    for (let l = 10 - k; l <= 9; l++) { const on = !L.up && met.has(k) && l === L.s; s += `<rect x="${x}" y="${Y(l) - lh * 0.22}" width="${w}" height="${lh * 0.44}" rx="1.5" fill="${on ? '#ffd27a' : '#9aa3b2'}" opacity="${L.up ? 0.35 : 0.95}"/>`; }
    for (let l = 0; l <= k - 1; l++) { const on = L.up && met.has(k) && l === L.s; s += `<rect x="${x}" y="${Y(l - 0.5) - lh * 0.22}" width="${w}" height="${lh * 0.44}" rx="1.5" fill="${on ? '#ffd27a' : '#5b78b8'}" opacity="${L.up ? 0.95 : 0.35}"/>`; }
    s += `<text x="${x + w / 2}" y="${H - 6}" font-size="8.5" fill="#8d90a6" text-anchor="middle" font-family="ui-monospace,monospace">${k}</text>`;
  }
  const gy = L.up ? Y(L.s - 0.5) : Y(L.s);
  s += `<rect x="${x0 - 4}" y="${gy - lh * 0.32}" width="${W - x0 - 4}" height="${lh * 0.64}" fill="none" stroke="#ffe2a8" stroke-width="1.2" stroke-dasharray="3 2" rx="3"/>`;
  s += `<text x="4" y="${gy + 3}" font-size="9" fill="#ffe2a8" font-family="ui-monospace,monospace">gear</text></svg>`;
  return s;
}
function carrySVG() {
  // one turn of 99 999 999 + 1 on this type: when each station adds and carries
  const u = U(), st = initState(u); st.R = digitsOf(99999999, u.NR); st.S = digitsOf(1, u.NS);
  const T = turnPlan(st, u), W = 300, rows = 9, H = 150, x0 = 26, X = a => x0 + a / 360 * (W - x0 - 6), rh = (H - 20) / rows, Y = p => 4 + (rows - 1 - p + 0.5) * rh;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of one turn: the carry ripples up eight wheels">`;
  for (let p = 0; p < rows; p++) s += `<text x="${x0 - 4}" y="${Y(p) + 3}" font-size="8" fill="#8d90a6" text-anchor="end" font-family="ui-monospace,monospace">${p + 1}</text>`;
  for (const w of T.wins) if (w.reg === 'R' && w.p < rows) s += `<rect x="${X(w.t0)}" y="${Y(w.p) - rh * 0.3}" width="${X(w.t1) - X(w.t0)}" height="${rh * 0.6}" fill="${w.kind === 'carry' ? '#ff7a6a' : '#e2c27a'}"/>`;
  for (const A of T.armR) if (A.a > 0 && A.p < rows) { const cw = T.wins.find(x => x.kind === 'carry' && x.p === A.p); s += `<line x1="${X(A.a)}" y1="${Y(A.p - 1)}" x2="${X(cw.t0)}" y2="${Y(A.p)}" stroke="#ff7a6a" stroke-width="0.8" opacity="0.7"/>`; }
  for (let a = 0; a <= 360; a += 90) s += `<text x="${X(a)}" y="${H - 4}" font-size="8" fill="#8d90a6" text-anchor="middle" font-family="ui-monospace,monospace">${a}°</text>`;
  return s + '</svg>';
}
function compPre() {
  const u = U(), n = u.NR, R = 1000, Sv = 1, pad = v => String(v).padStart(n, '0');
  const comp = 10 ** n - 1 - Sv, sum = R + comp + 1;
  const cut = String(sum).padStart(n + 1, '0');
  return `<pre><span class="k">result      </span> ${pad(R)}
<span class="k">9s compl. of ${Sv}</span> ${pad(comp)}
<span class="k">extra carry </span> ${pad(1)}
<span class="k">sum         </span><span class="x">${cut[0]}</span><span class="h">${cut.slice(1)}</span></pre>`;
}
function fillLearn() {
  const u = U(), plainT = plan(u, makeJob(u, '×', 4711, 9).actions).turns, shortT = plan(u, makeJob(u, '×', 4711, 9, { short: true }).actions).turns;
  $('learn').innerHTML = `<div class="learn">
  <h3>Curt Herzstark and the Curta</h3>
  <p>Curt Herzstark (1902 – 1988) grew up in his father's calculating machine business in Vienna. In the late 1930s he worked on a calculator small enough to hold in one hand. Under the Nazi racial laws he was classed as half-Jewish. In 1943 he was arrested and sent to the Buchenwald concentration camp.</p>
  <p>In the camp he was set to work in a factory. The SS officers knew of his calculator and let him draw it; they meant to give it to Hitler as a gift. Herzstark finished the drawings in Buchenwald. After the camp was liberated in April 1945 he took them to a firm in Weimar, and later to Liechtenstein, where Contina AG in Mauren made the Curta from 1948 to 1972.</p>
  <p>About 140 000 were made: the Type I (8 sliders, 11-digit result, 6-digit counter) and, from 1954, the larger Type II (11, 15, 8). Engineers, surveyors and rally navigators used them until electronic calculators took over in the 1970s.</p>
  <table><tr><th></th><th>Type I</th><th>Type II</th></tr>
  <tr><td>Sliders</td><td>8</td><td>11</td></tr><tr><td>Result digits</td><td>11</td><td>15</td></tr><tr><td>Counter digits</td><td>6</td><td>8</td></tr>
  <tr><td>Diameter</td><td>53 mm</td><td>65 mm</td></tr><tr><td>Height</td><td>85 mm</td><td>90 mm</td></tr><tr><td>Mass</td><td>230 g</td><td>360 g</td></tr></table>
  <p class="fine">Sizes are the published approximate figures. The page models the mechanism in its own geometry, scaled to those sizes.</p>

  <h3>How the stepped drum adds</h3>
  <p>Leibniz's stepped drum has teeth of nine lengths. A gear that slides along it meets as many teeth as the digit set: at level <b>s</b> it meets <b>s</b> teeth, so one drum turn turns it <b>s</b> tenths. The Curta puts one drum in the middle, with a setting gear for every slider round it, so one crank turn adds the whole number.</p>
  <div class="fig" id="figDrum">${drumSVG()}</div>
  <div class="ctl"><button type="button" data-l="s-">level −</button><button type="button" data-l="s+">level +</button><button type="button" data-l="up" class="${L.up ? 'on' : ''}">${L.up ? 'crank up: complement' : 'crank down: add'}</button><button type="button" data-l="see">see it in 3D</button></div>
  <p class="fine" id="drumNote">Level ${L.s}: the gear meets ${teethMet(L.s, L.up).length} teeth (rows ${teethMet(L.s, L.up).join(', ') || 'none'}).</p>

  <h3>The tens carry</h3>
  <p>When a result wheel passes from 9 to 0, a tooth on it rocks the carry lever of the next wheel. That lever pushes down a slide, and the slide drops a carry gear into the plane of the drum's carry tooth. The carry tooth meets the stations one after the other, each after its add phase and after the carry below it, so a carry that makes the next wheel pass 9 also gets passed on in the same turn.</p>
  <div class="fig">${carrySVG()}</div>
  <p class="fine">One turn of 99 999 999 + 1: amber is the add tooth on station 1, red the carries that ripple up eight wheels.</p>
  <div class="ctl"><button type="button" data-run="2">run 99 999 999 + 1 slowly</button></div>

  <h3>Why subtraction uses nines' complement</h3>
  <p>The drum only turns one way, so the Curta subtracts by adding. Pull the crank up and the stepped sleeve lifts half a level: every gear now meets the complement teeth, <b>9 − s</b> of them, and the stations above the sliders give 9. One extra carry goes in at the lowest place. Adding the nines' complement plus one is adding 10<sup>${u.NR}</sup> − S; the 1 at the top falls off the end, and what stays is R − S.</p>
  <div class="fig">${compPre()}</div>
  <div class="ctl"><button type="button" data-run="3">run 1000 − 1</button><button type="button" data-run="7">run 0 − 1</button></div>

  <h3>Multiplying, and the short cut</h3>
  <p>A × B is repeated addition: set A, turn B<sub>0</sub> times, shift the carriage one place, turn B<sub>1</sub> times, and so on. The counter counts the turns at each place, so it shows B. Curta users save turns with subtraction: 9 is 10 − 1, so turn once up at the next place and once down here. 4711 × 9 takes ${plainT} turns the plain way and ${shortT} with the short cut, and the counter still shows 9.</p>
  <div class="ctl"><button type="button" data-run="0">run 4711 × 23</button><button type="button" data-run="1">run 4711 × 9, short cut</button></div>

  <h3>Division and square roots</h3>
  <p>Division is repeated subtraction. Put the dividend in the result, set the divisor, and turn the reversing lever on so that subtraction turns count up. At the highest place, subtract until the result goes below zero (it shows nines at the top), add one turn back, and shift down. This is the restoring method; the counter shows the quotient.</p>
  <p>For a square root, subtract the odd numbers 1, 3, 5, ... : their sum to n terms is n². For each root digit the setting is twice the root found so far, then the odd numbers at the current place. The counter builds the root.</p>
  <div class="ctl"><button type="button" data-run="4">run 1000 ÷ 7</button><button type="button" data-run="5">run √2</button></div>
  </div>`;
  const box = $('learn');
  box.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.l;
    if (k === 's-') L.s = Math.max(0, L.s - 1); else if (k === 's+') L.s = Math.min(9, L.s + 1); else if (k === 'up') L.up = !L.up;
    else { setView('section'); if (PHONE_Q.matches) setOpen(false); return; }
    $('figDrum').innerHTML = drumSVG();
    box.querySelector('[data-l="up"]').textContent = L.up ? 'crank up: complement' : 'crank down: add';
    box.querySelector('[data-l="up"]').classList.toggle('on', L.up);
    $('drumNote').textContent = `Level ${L.s}: the gear meets ${teethMet(L.s, L.up).length} teeth (rows ${teethMet(L.s, L.up).join(', ') || 'none'}).`;
  }));
  box.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.run, [op, a, bb, , o] = EXAMPLES[i]; S.ex = i;
    runJob(op, a, bb, o);
    if (i === 2) { setView('carry'); setSpeed(0.5); } else if (!S.speed) setSpeed(S.lastSpeed);
    if (PHONE_Q.matches) setOpen(false);
  }));
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0, regT = 0;
const fT = new THREE.Vector3(), fV = new THREE.Vector3();
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur || !S.P) return;
  const cur = S.cur, tf0 = performance.now();
  if (S.t < S.P.T) S.t = Math.min(S.P.T, S.t + S.speed * dt);
  else if (S.speed > 0 && (S.endT += dt) > HOLD && S.job && (S.loop || saverOn)) nextExample();
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
  // follow: the target eases to the part that moves now
  if (S.follow && !stage.dragging && !stage.fly && !saverOn) {
    const p = cur.sc.focus(S.Q);
    if (p) { fT.set(...p); fV.copy(fT).sub(stage.controls.target).multiplyScalar(1 - Math.exp(-dt * 2.5)); stage.shift(fV); }
  }
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    if ((regT += dt) > 0.05) { regT = 0; fillRegs(); }
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); fillSteps(false); if (S.P.T > S.jobT0) { const f = Math.min(1, Math.max(0, (S.t - S.jobT0) / (S.P.T - S.jobT0))); $('scrub').value = Math.round(f * 1000); $('scrubV').textContent = `${Math.round(f * 100)}%`; } fillOperate(); }
    drawTurn();
  } else if (saverTick) saverTick(dt);
  // frame time (ms, smoothed); with window.__curtaProfile the GPU work is
  // waited for, so the figure includes it
  if (window.__curtaProfile) stage.renderer.getContext().finish();
  S.ft = (S.ft || 0) * 0.9 + (performance.now() - tf0) * 0.1;
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__curta = { S, stage, cards, swapTo, setView, setSpeed, setExplode, setShow, setOpen, setAna, runJob, act, setSection, endState };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker(); fillExamples();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('tLoop').classList.toggle('on', S.loop);
setSpeed(1); setExplode(0);
stage.place({ az: -30, el: 22, r: 400, target: new THREE.Vector3(0, 44, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'I');
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs) {
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
  return { x: C.x, y: C.y, r, pts: [] };
}

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and runs a
// seeded tour of shots, each about seconds/10 (at least 6 s):
//   product .. a seeded multiplication with carriage shifts, whole machine
//   carry .... the cutaway at the carry chain, a ripple at slow speed
//   drum ..... the cutaway at the stepped drum during a subtraction turn
//   exploded . the spread machine, still turning
//   part ..... close-ups of single parts (lib/mech-tour.js), the job running
//   top ...... the registers from above while the product builds
// The order is shuffled per seed, and every few shots it changes the type.
// The plate shows the operation, the registers and a code extract of
// mech.js turnPlan. No exit(): the shell reloads the page.
const CODE = `// one crank turn: tooth windows, then carries
for (const k of teethMet(s_p, up)) {
  const m = TOOTH0 + (k - 1) * TOOTH_P + pitch * p;
  wins.push({ p, t0: m - WIN/2, t1: m + WIN/2, d: 1 });
}
// a wheel that passes 9 -> 0 drops the next carry gear;
// the carry tooth meets station p at RES_CARRY + p * pitch
if (from === 9) carryR(w + 1 - c, t1);`;
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#labels,#leader,#regs,.tip,#nogl,#gear,#toast{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none;transition:opacity 0.9s ease}';
    document.head.appendChild(st);
    setOpen(false); setAna(false); setShow('labels', false);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(256, 150, 0, 256, 150, 420);
    rg.addColorStop(0, '#171a28'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = false;
    S.ekRate = 2.0 - 0.6 * calm;
    const SPEED = Math.round((1.3 - 0.6 * calm) * 100) / 100;
    const hold = Math.max(6, (o.seconds || 60) / 10) * 1000;
    const canvas = $('view');
    // close-ups only of parts that read at saver size; shots cut (fly 0.05 s)
    // behind a short fade, so the camera never flies through the housing
    const READ = ['sleeve', 'carrygear', 'slider', 'drum'];
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, fly: 0.05, fill: 2.0, prefer: READ, skip: Object.keys(partsFor('I')).filter(k => !READ.includes(k)) });
    window.__mechTour = tour;
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      return [P('S', 'setting', fmt(Q.setting), 'm1'), P('R', 'result', fmt(Q.value), 'm3'), P('C', 'counter', fmt(Q.count), 'm4'), P('c', 'carriage place', String(Math.round(Q.car) + 1), 'm2')];
    };
    const opText = () => (S.job ? `${exprOf(S.job.op, S.job.a, S.job.b)} = ${answerOf(S.job)}` : '');
    const TEX = [String.raw`R \leftarrow R + S\cdot 10^{c}`, String.raw`R - S = R + (10^{n} - 1 - S) + 1 - 10^{n}`];
    const EQ = ['R ← R + S · 10^c', 'R − S = R + (nines’ complement of S) + 1'];
    const lab = (title, sub, anchor) => () => ({ title, sub: [sub, opText()].filter(Boolean).join(' · '), params: params(), tex: TEX, eq: EQ, code: { lang: 'js', name: 'curta/mech.js · turnPlan', text: CODE }, anchor });
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const carryParts = () => S.cur.sc.meshesOf(['sleeve', 'drum', 'cgear_0', 'cgear_1', 'cgear_2', 'slide_0', 'slide_1', 'slide_2', 'shaft_0', 'shaft_1']);
    // saver framing: (az, el, k, key, explode); k is a share of the whole-view distance
    const SV = { product: [24, 24, 0.36, 'top', 0], top: [0, 56, 0.27, 'top', 0], carry: [96, 20, 0.24, 'carry', 0], drum: [92, 10, 0.4, 'drum', 0], exploded: [30, 6, 0.72, null, 0.85] };
    const saverView = name => {
      const [az, el, k, key, ex] = SV[name], c = key ? S.cur.sc.keys[key] : S.cur.sc.box.c;
      stage.flyTo({ az, el, r: fitDist(k), target: new THREE.Vector3(c[0], c[1] + (ex ? S.cur.sc.box.R * 0.28 : 0), c[2]), t: 0.05 });
      setExplode(ex); setSection(name === 'carry' || name === 'drum');
    };
    // a new job on a machine that is already clear starts at its first set
    const runFresh = (op, a, b, oo) => { const clear = S.P && S.P.end.R.every(v => !v) && S.P.end.C.every(v => !v); runJob(op, a, b, oo); if (clear) { const e = S.P.events.find(x => x.a === 'set' && x.t0 >= S.jobT0 - 1e-9); if (e) S.t = e.t0; } };
    // seeded jobs
    const mulJob = () => { const a = 1000 + Math.floor(rnd() * 98999), b = [23, 47, 365, 1729, 314, 271, 89, 196][Math.floor(rnd() * 8)]; return ['×', a, b, { short: rnd() < 0.5 }]; };
    const ripJob = () => [['+', 99999999, 1, {}], ['+', 9999999, 1, {}], ['−', 10000000, 1, {}], ['+', 9999990, 10, {}]][Math.floor(rnd() * 4)];
    // jump t to just before the last turn of the job, so the carry shows now
    const toLastTurn = () => { const turnsE = S.P.events.filter(e => e.a === 'turn'); const e = turnsE[turnsE.length - 1]; if (e) S.t = Math.max(S.jobT0, e.t0 - 0.35); };
    const SHOTS = {
      product: { setup: () => { const [op, a, b, oo] = mulJob(); runFresh(op, a, b, oo); saverView('product'); return { speed: SPEED * 1.4 }; }, lab: () => lab('Curta · multiplication', 'Turns and carriage shifts', () => plateAnchor(all()))(), kind: 'view' },
      top: { setup: () => { if (!S.job || S.job.op !== '×' || S.t >= S.P.T) { const [op, a, b, oo] = mulJob(); runFresh(op, a, b, oo); } saverView('top'); return { speed: SPEED * 1.2 }; }, lab: () => lab('The registers', 'Result outside, turn counter inside', () => plateAnchor(S.cur.sc.meshesOf(['carriage'])))(), kind: 'view' },
      carry: { setup: () => { const [op, a, b, oo] = ripJob(); runJob(op, a, b, oo); toLastTurn(); saverView('carry'); return { speed: 0.22 + 0.12 * (1 - calm), slow: true }; }, lab: () => lab('The tens carry', 'Cutaway: carry gears drop, the carry tooth passes', () => plateAnchor(carryParts()))(), kind: 'view' },
      drum: { setup: () => { const [op, a, b, oo] = [['−', 1000 + Math.floor(rnd() * 90000), 1 + Math.floor(rnd() * 900), {}], ['×', 4711, 9, { short: true }]][Math.floor(rnd() * 2)]; runJob(op, a, b, oo); toLastTurn(); saverView('drum'); return { speed: 0.35 }; }, lab: () => lab('The stepped drum', 'Cutaway: add teeth (steel), complement teeth (blued)', () => plateAnchor(S.cur.sc.meshesOf(['sleeve', 'drum'])))(), kind: 'view' },
      exploded: { setup: () => { if (!S.job || S.t >= S.P.T) { const [op, a, b, oo] = mulJob(); runFresh(op, a, b, oo); } saverView('exploded'); return { speed: SPEED * 0.8, exploded: true }; }, lab: () => lab('Exploded view', `Curta Type ${S.cur.id}`, () => plateAnchor(all()))(), kind: 'view' },
    };
    let plan2 = [], n = 0, stepT = 0, now = null, lastLab = '', labT = 0, sinceSwap = 0;
    const makePlan = () => {
      tour.unit();
      const views = ['product', 'carry', 'exploded', 'drum', 'top'];
      for (let i = views.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [views[i], views[j]] = [views[j], views[i]]; }
      // the product first or second, so the plate opens on an operation
      if (views.indexOf('product') > 1) { views.splice(views.indexOf('product'), 1); views.splice(Math.floor(rnd() * 2), 0, 'product'); }
      const parts = tour.pick(3);
      plan2 = [];
      views.forEach((v, i) => { plan2.push({ shot: v }); if (i % 2 === 1 && parts.length) plan2.push({ focus: parts.shift() }); });
      for (const f of parts) plan2.push({ focus: f });
    };
    const show = s => {
      if (s.focus) {
        if (S.explodeTarget < 0.3) setExplode(0.55 + 0.3 * rnd());
        setSection(false);
        if (!S.job || S.t >= S.P.T) { const [op, a, b, oo] = mulJob(); runFresh(op, a, b, oo); }
        setSpeed(SPEED);
        tour.show(s.focus);
        // no glow in the saver: the gold tint reads as plastic on a close-up
        cards.C.hover = null;
        const t = tour.plate(s.focus, `Curta Type ${S.cur.id}`);
        s.lab = () => ({ ...t, sub: [t.sub, opText()].filter(Boolean).join(' · '), params: params(), tex: TEX, eq: EQ, code: { lang: 'js', name: 'curta/mech.js · turnPlan', text: CODE }, anchor: () => plateAnchor(t.meshes) });
      } else {
        tour.clear();
        const sh = SHOTS[s.shot], r = sh.setup();
        setSpeed(r.speed);
        // moves that keep the whole subject in the band (no truck or graze)
        const MV = { product: ['orbit', 'push', 'pull', 'crane'], top: ['orbit', 'push'], exploded: ['orbit', 'pull', 'push'], carry: ['push', 'orbit', 'pull'], drum: ['push', 'orbit', 'pull'] }[s.shot];
        const mv = MV[Math.floor(rnd() * MV.length)];
        tour.fromFly({ kind: 'view', exploded: !!r.exploded, move: mv, azRange: s.shot === 'carry' || s.shot === 'drum' ? [S.cutAz - 30, S.cutAz + 40] : null });
        s.lab = sh.lab;
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
    const advance = () => {
      if (n >= plan2.length) {
        sinceSwap++;
        const go = () => { makePlan(); n = 0; stepT = 0; now = plan2[n++]; show(now); };
        if (sinceSwap >= 1 && rnd() < 0.6) { tour.clear(); now = null; fadeSwap(S.cur.id === 'I' ? 'II' : 'I', go); sinceSwap = 0; }
        else go();
        return;
      }
      // a short fade hides the cut to the next shot
      const nx = plan2[n++]; now = nx;
      canvas.style.transition = 'opacity 0.28s ease'; canvas.style.opacity = '0';
      setTimeout(() => { if (now !== nx) return; show(nx); fadeIn = 3; }, 300);
    };
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    let fadeIn = 0;
    saverTick = dt => {
      // fade in after three rendered frames: the camera has its new pose
      if (fadeIn > 0 && !stage.fly && --fadeIn === 0) canvas.style.opacity = '1';
      if (bandFn && (bandT += dt) > 0.5) {
        bandT = 0;
        // keep the last band while the plate swaps its text (plateBand is null then)
        try { saverBand = bandFn($('view').clientHeight) || saverBand; } catch (e) { /* keep */ }
        // fade the view out under the plate text: the subject stays in the band
        const h = canvas.clientHeight, m = saverBand ? `linear-gradient(to bottom, transparent ${Math.max(0, saverBand.t - 26)}px, #000 ${saverBand.t + 18}px, #000 ${h - saverBand.b - 18}px, transparent ${h - saverBand.b + 26}px)` : 'none';
        if (canvas.style.maskImage !== m) { canvas.style.maskImage = m; canvas.style.webkitMaskImage = m; }
      }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 0.5 && now && now.lab) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    window.__curtaSaver = { get shot() { return now ? (now.shot || 'part:' + now.focus) : null; }, get plan() { return plan2.map(p => p.shot || 'part:' + p.focus); }, next() { stepT = hold; }, cut(k) { stepT = 0; if (SHOTS[k]) { now = { shot: k }; show(now); } else { now = { focus: k }; show(now); } } };
    (async () => {
      const first = rnd() < 0.5 ? 'I' : 'II';
      if (!S.cur || S.cur.id !== first) await swapTo(first);
      makePlan(); n = 0; now = plan2[n++]; show(now);
    })();
    return { canvas, warmupMs: 1500 };
  },
};

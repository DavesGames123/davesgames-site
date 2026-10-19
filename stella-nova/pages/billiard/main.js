// ============================================================================
//  POOL PHYSICS  ·  pages/billiard/main.js — the page director
// ----------------------------------------------------------------------------
//  The user asked for a 2D / 3D split of a regular pool table, an AI that
//  plays itself near perfectly, the maths of each shot drawn as it plays
//  (Manim style), and a way to take over and plan a shot. This file runs
//  the turns and ties the views together:
//
//    think  -> the AI planner (core/ai.js think, a generator) runs a few
//              ms per frame; the 2D view shows the candidate lines
//    aim    -> the chosen shot is predicted (core/shot.js); its maths
//              steps write themselves in, one by one; the cue strokes
//    roll   -> the shot plays (fixed 2 ms ticks, the same as the
//              prediction); steps at a sim time appear at that time;
//              live v, a and the components on n and t
//    settle -> the rules judge the shot (core/rules.js), next turn
//    plan   -> the user's shot: pick a ball and a pocket, drag to aim,
//              set the tip and the speed; the full predicted layout
//              updates live; Shoot
//  A tap or a click on either view takes over from the AI (after the balls
//  stop, if they roll). In "AI vs AI" the AI resumes after the user's shot;
//  in "You vs AI" the user keeps the left player.
//  The AI's flair (APP.flair, the panel slider) brings banks, kicks and
//  combinations; its stroke error (plan.err) splits the shot in two: the
//  aim phase shows the aimed stroke (APP.predAim, APP.ctAim), the roll
//  plays the observed one (APP.pred), and the maths step "stroke" shows
//  delta phi. The cue (core/cue.js cuePose) lifts over the rail and the
//  balls in both views. layout() sizes the canvases only when a pane
//  changes size (never from a caption), and fixes the contact inset in
//  the bottom-right corner (view/diagram.js D.inset).
//
//  grep -n targets: "const APP", "function startTurn", "function beginAim",
//  "function strikeNow", "function frame", "function draw2d", "function
//  draw3d", "function enterPlan", "function planPointer", "function
//  buildPanel", "function layout", "window.__pool", "APP.predAim"
// ============================================================================
import { buildTable } from './core/table.js';
import { beginShot, strike, tick, anyMoving, settle, ballState, accel, enableOrientation } from './core/physics.js';
import { newGame, judge, apply, legalTargets, status as gameStatus } from './core/rules.js';
import { think, SKILLS } from './core/ai.js';
import { shotGeometry, potChance } from './core/geometry.js';
import { predict, mathsOf, contactOf, lensOf } from './core/shot.js';
import { cuePose } from './core/cue.js';
import { createDiagram } from './view/diagram.js';
import { createMaths } from './view/maths.js';
import { createStrike, spinWords } from './view/strike.js';
import { createPanel, mountSheet, fillIcons } from '../../lib/sn-panel.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)');
const PHONE = PHONE_Q.matches;
const T = buildTable();
const R = T.R;

// ── state ────────────────────────────────────────────────────────────────────
const hashArgs = (() => { const o = {}; try { for (const kv of (location.hash || '').replace(/^#/, '').split('&')) { const [k, v] = kv.split('='); if (k) o[k] = decodeURIComponent(v || ''); } } catch (e) { /* none */ } return o; })();
const APP = {
  T, G: null, seed: +hashArgs.seed || ((Date.now() % 100000) + 1),
  type: hashArgs.game === '9' ? '9' : '8',
  mode: hashArgs.mode === 'you' ? 'you-ai' : 'ai-ai',
  skill: 'perfect', flair: 0.4, pace: 1, speed: 1, paused: false, stepOnce: 0, slowK: 0.3,
  phase: 'idle', phaseT: 0, ts: 0,
  it: null, cands: [], plan: null, geo: null, pred: null, predAim: null, ct: null, steps: [], shown: -1, aimStepT: 0,
  items: [], trails: [], acc: 0, prevX: new Float64Array(16), prevY: new Float64Array(16),
  drops: {}, verdict: null, msg: '', takeover: false, human: false,
  view: PHONE ? 'both' : 'both', style: 'felt', cam: 'auto',
  show: { cons: true, vel: true, acc: true, comp: true, trails: true, slow: true, paths: true },
  pl: null,           // the planner state
  saver: null,        // set by saver.js while the screensaver runs
};

// ── views ────────────────────────────────────────────────────────────────────
const c2d = $('c2d'), c3d = $('c3d');
const ctx2d = c2d.getContext('2d');
const D = createDiagram(T);
let V = null;
const maths = createMaths({ steps: $('steps'), read: $('readout'), typeset: (el, tex) => typesetter(el, tex) });
let typesetter = () => Promise.resolve(false);
import('../../lib/sci-math.js').then(m => { typesetter = (el, tex) => m.typeset(el, tex, { display: true }); }).catch(() => {});

async function boot3d() {
  try {
    const mod = await import('./view/scene3d.js');
    V = mod.createScene(c3d, T, { phone: PHONE });
  } catch (e) { V = null; console.warn('[pool] 3D off:', e && e.message); }
  if (!V) { $('fallback3d').hidden = false; return; }
  V.onUserOrbit = () => { APP.cam = 'free'; const c = panel && panel.find('cam'); if (c) c.set('free'); };
  layout();
  V.snapCamera();
}

// ── the game ─────────────────────────────────────────────────────────────────
function startGame(seed = APP.seed, type = APP.type) {
  APP.seed = seed; APP.type = type;
  APP.G = newGame({ type, seed, T, names: APP.mode === 'you-ai' ? ['You', 'AI'] : ['Left', 'Right'], kinds: APP.mode === 'you-ai' ? ['human', 'ai'] : ['ai', 'ai'] });
  enableOrientation(APP.G.S);
  APP.items = []; APP.trails = []; APP.drops = {}; APP.verdict = null; APP.msg = '';
  APP.pred = null; APP.ct = null; APP.plan = null; maths.load([]);
  snapPrev();
  try { history.replaceState(null, '', `#seed=${seed}&game=${type}${APP.mode === 'you-ai' ? '&mode=you' : ''}`); } catch (e) { /* sandboxed */ }
  startTurn();
}
function snapPrev() { const S = APP.G.S; APP.prevX.set(S.x); APP.prevY.set(S.y); APP.acc = 0; }
const setPhase = p => { APP.phase = p; APP.phaseT = APP.ts; };
const humanTurn = () => APP.takeover || (APP.mode === 'you-ai' && APP.G.turn === 0);
// the saver keeps the gaps short (the user: "the shots on the screensaver
// mode should not take long between things"): see saver.js SAVER_PACE
const pace = s => s * APP.pace * (APP.saver ? APP.saver.pace : 1);

function startTurn() {
  const G = APP.G;
  if (G.phase === 'over') { setPhase('over'); return; }
  if (humanTurn()) { enterPlan(); return; }
  APP.human = false;
  APP.it = think(G, { skill: APP.skill, flair: APP.saver ? APP.saver.flair : APP.flair });
  APP.cands = [];
  setPhase('think');
}

// run the planner for a few ms of this frame
function stepThink() {
  const t0 = performance.now(), budget = APP.saver ? 12 : 9;
  while (APP.it && performance.now() - t0 < budget) {
    const s = APP.it.next();
    if (s.done) { APP.plan = s.value; APP.it = null; break; }
    if (s.value && s.value.candidates) APP.cands = s.value.candidates;
  }
  if (!APP.it && APP.ts - APP.phaseT > pace(APP.G.phase === 'break' ? 0.6 : 1.3)) beginAim(APP.plan, false);
}

// The chosen shot: predict it, build its maths, write the aim steps in.
function beginAim(plan, fast) {
  const G = APP.G, S = G.S;
  APP.plan = plan;
  if (plan.place) { S.x[0] = plan.place.x; S.y[0] = plan.place.y; S.on[0] = 1; snapPrev(); }
  // a bank, kick or combination keeps its own geometry (core/geometry.js)
  APP.geo = plan.chosen && plan.chosen.kind && plan.chosen.kind !== 'pot' ? plan.chosen : plan.n > 0 && plan.pocket >= 0 ? shotGeometry(S, T, plan.n, T.pockets[plan.pocket]) : null;
  APP.pred = predict(S, plan);
  // the aimed stroke (no error): its paths show while the AI aims
  APP.predAim = plan.ideal && plan.err ? predict(S, Object.assign({}, plan, plan.ideal)) : APP.pred;
  APP.ct = contactOf(APP.pred);
  APP.ctAim = contactOf(APP.predAim);
  APP.lens = lensOf(APP.pred, APP.geo);
  APP.steps = mathsOf(T, S, plan, APP.pred, APP.geo);
  if (APP.saver && APP.saver.kind) APP.saver.kind(plan.kind);
  fadeItems();
  maths.load(APP.steps);
  APP.shown = -1;
  APP.aimStepT = APP.ts;
  APP.fast = !!fast;
  setPhase('aim');
  if (V) V.focus({ phase: 'aim', cx: S.x[0], cy: S.y[0], phi: plan.phi });
}

function revealStep(k) {
  APP.shown = Math.max(APP.shown, k);
  maths.reveal(k);
  const st = APP.steps[k];
  (st.draw || []).forEach((it, j) => APP.items.push({ it, k, t0: APP.ts + j * 0.14, dur: 0.75, fade: null }));
  if (APP.saver) APP.saver.onStep(st);
}
function fadeItems() { for (const x of APP.items) if (x.fade == null) x.fade = APP.ts; for (const t of APP.trails) if (t.fade == null) t.fade = APP.ts; }

function stepAim() {
  const per = APP.fast ? 0 : pace(0.62);
  // reveal the aim steps one by one
  while (APP.shown + 1 < APP.steps.length && APP.steps[APP.shown + 1].at === 'aim' && APP.ts - APP.aimStepT >= per * (APP.shown + 2)) revealStep(APP.shown + 1);
  const aimDone = !(APP.shown + 1 < APP.steps.length && APP.steps[APP.shown + 1].at === 'aim');
  if (aimDone && APP.ts - APP.aimStepT >= (APP.fast ? 0.45 : per * (APP.shown + 2) + pace(0.9))) strikeNow();
}

function strikeNow() {
  const S = APP.G.S;
  APP.trails = APP.trails.filter(t => t.fade == null || APP.ts - t.fade < 1);
  beginShot(S, { log: true });
  strike(S, 0, APP.plan);
  snapPrev();
  setPhase('roll');
  if (V) V.focus({ phase: 'roll', cx: S.x[0], cy: S.y[0], phi: APP.plan.phi });
}

function stepRoll(dt) {
  const S = APP.G.S, h = S.P.h;
  let scale = APP.speed;
  if (APP.show.slow && APP.ct && S.t > APP.ct.t - 0.1 && S.t < APP.ct.t + 0.22) scale = Math.min(scale, APP.slowK);
  APP.acc += dt * scale;
  let n = 0;
  while (APP.acc >= h && n++ < 4000) {
    APP.prevX.set(S.x); APP.prevY.set(S.y);
    const potted0 = S.potted.length;
    tick(S);
    for (let k = potted0; k < S.potted.length; k++) { const e = S.potted[k], p = T.pockets[e.pocket]; if (p) APP.drops[e.i] = { t0: APP.ts, hx: p.hx, hy: p.hy, x: S.x[e.i], y: S.y[e.i] }; }
    APP.acc -= h;
    // the steps whose moment has come
    while (APP.shown + 1 < APP.steps.length && typeof APP.steps[APP.shown + 1].at === 'number' && APP.steps[APP.shown + 1].at <= S.t + 1e-9) revealStep(APP.shown + 1);
    if (!anyMoving(S)) break;
  }
  if (!anyMoving(S)) {
    while (APP.shown + 1 < APP.steps.length) revealStep(APP.shown + 1);
    settle(S); snapPrev();
    setPhase('settle');
  }
}

function stepSettle() {
  if (APP.ts - APP.phaseT < pace(APP.fast ? 0.7 : 1.1)) return;
  const G = APP.G, S = G.S;
  const v = judge(G, { ball: APP.plan.n, pocket: APP.plan.pocket });
  const shooter = G.players[G.turn].name;
  apply(G, v);
  APP.verdict = v;
  APP.msg = v.win || v.lose ? `${G.players[G.winner].name} wins: ${v.why}` : v.foul ? `Foul by ${shooter}: ${v.why}. Ball in hand for ${G.players[G.turn].name}.` : v.keep ? `${shooter} keeps the table` : `${shooter} misses; ${G.players[G.turn].name} to shoot`;
  if (APP.human && APP.mode === 'ai-ai') { APP.takeover = false; APP.human = false; APP.msg += ' · the AI has the table again'; }
  for (const k of Object.keys(APP.drops)) if (S.on[k]) delete APP.drops[k];
  snapPrev();
  updateHud();
  startTurn();
}

// ── the planner (the user's shot) ────────────────────────────────────────────
function enterPlan() {
  const G = APP.G, S = G.S;
  APP.human = true; APP.it = null;
  const legal = legalTargets(G);
  let n = null, pocket = null, phi = 0;
  // start on the easiest pot, else at the nearest legal ball
  let best = null;
  for (const b of legal) for (const p of T.pockets) { const g = shotGeometry(S, T, b, p); if (g) { const c = potChance(g, T, 0.004); if (!best || c > best.c) best = { g, c }; } }
  if (best) { n = best.g.n; pocket = best.g.pocket; phi = best.g.phi; }
  else if (legal.length) { const b = legal[0]; phi = Math.atan2(S.y[b] - S.y[0], S.x[b] - S.x[0]); }
  if (G.phase === 'break') { n = G.type === '9' ? 1 : G.rack.find(b => b.row === 0).n; pocket = null; phi = Math.atan2(S.y[n] - S.y[0], S.x[n] - S.x[0]); }
  APP.pl = { n, pocket, phi, fine: 0, v: G.phase === 'break' ? 10 : 2.2, a: 0, b: 0, place: G.inHand ? { x: S.x[0], y: S.y[0] } : null, dirty: true, drag: null };
  fadeItems();
  setPhase('plan');
  syncPlanUI();
  if (V) V.focus({ phase: 'plan', cx: S.x[0], cy: S.y[0], phi });
  updateHud();
}

function planShot() {
  const p = APP.pl;
  return { phi: p.phi + p.fine * Math.PI / 180, v: p.v, a: p.a, b: p.b, n: p.n || -1, pocket: p.pocket ?? -1, place: p.place };
}

// recompute the predicted layout (at most once a frame)
function refreshPlan() {
  const p = APP.pl, G = APP.G, S = G.S;
  if (p && !p.dirty && !p.texDone && APP.ts >= p.texAt) { p.texDone = true; maths.load(APP.steps); maths.showAll(); }
  if (!p || !p.dirty) return;
  p.dirty = false;
  const shot = planShot();
  const cx = p.place ? p.place.x : S.x[0], cy = p.place ? p.place.y : S.y[0];
  APP.geo = p.n > 0 && p.pocket != null && p.pocket >= 0 ? shotGeometry(S, T, p.n, T.pockets[p.pocket], cx, cy) : null;
  APP.pred = predict(S, shot); APP.predAim = APP.pred;
  APP.ct = contactOf(APP.pred); APP.ctAim = APP.ct;
  APP.lens = lensOf(APP.pred, APP.geo);
  APP.plan = shot;
  APP.steps = mathsOf(T, S, shot, APP.pred, APP.geo);
  // MathJax only when the input rests (a drag rebuilds the steps each frame)
  maths.load(APP.steps, { tex: false }); maths.showAll();
  p.texAt = APP.ts + 0.3; p.texDone = false;
  APP.items = APP.steps.flatMap((st, k) => (st.draw || []).map(it => ({ it, k, t0: -1, dur: 0.01, fade: null })));
  APP.shown = APP.steps.length - 1;
  const first = APP.pred.first;
  const txt = first < 0 ? 'no ball is hit' : `first contact: the ${first}` + (APP.ct ? `, θ = ${(APP.ct.theta * 180 / Math.PI).toFixed(1)}°` : '');
  const pots = APP.pred.potted.map(e => e.i === 0 ? 'the cue ball (scratch)' : `the ${e.i}`);
  setText('planNote', `${txt}; ${pots.length ? 'falls: ' + pots.join(', ') : 'nothing falls'} · ${spinWords(p.a, p.b)}, ${p.v.toFixed(2)} m/s`);
}

function shootPlan() {
  if (APP.phase !== 'plan') return;
  refreshPlan();
  const shot = APP.plan;
  APP.pl = null;
  syncPlanUI();
  beginAim(shot, true);
}

function handBack() {
  if (APP.phase !== 'plan') { APP.takeover = false; return; }
  APP.takeover = false; APP.pl = null; APP.human = false;
  if (APP.mode === 'you-ai') { APP.mode = 'ai-ai'; const c = panel && panel.find('players'); if (c) c.set('ai-ai'); }
  syncPlanUI();
  startTurn();
}

function takeOver() {
  if (APP.saver) return;
  if (APP.phase === 'plan') return;
  APP.takeover = true;
  if (APP.phase === 'think' || APP.phase === 'aim') { fadeItems(); enterPlan(); }
  else if (APP.phase === 'over') startGame(APP.seed + 1);
  else APP.msg = 'You take the next shot when the balls stop';
  updateHud();
}

// pointer on the 2D view while planning: world point w
function planPointer(kind, w) {
  const p = APP.pl, S = APP.G.S;
  if (!p) return;
  const cx = p.place ? p.place.x : S.x[0], cy = p.place ? p.place.y : S.y[0];
  if (kind === 'down') {
    if (p.place && Math.hypot(w[0] - cx, w[1] - cy) < 1.6 * R) { p.drag = 'cue'; return; }
    let hitBall = -1;
    for (let n = 1; n < 16; n++) if (S.on[n] && Math.hypot(w[0] - S.x[n], w[1] - S.y[n]) < 1.4 * R) hitBall = n;
    if (hitBall > 0) {
      p.n = hitBall;
      let best = null;
      for (const pk of T.pockets) { const g = shotGeometry(S, T, hitBall, pk, cx, cy); if (g) { const c = potChance(g, T, 0.004); if (!best || c > best.c) best = { g, c }; } }
      if (best) { p.pocket = best.g.pocket; p.phi = best.g.phi; } else { p.pocket = null; p.phi = Math.atan2(S.y[hitBall] - cy, S.x[hitBall] - cx); }
      p.fine = 0; p.dirty = true; p.drag = null; syncPlanUI(); return;
    }
    const pk = T.pockets.find(q => Math.hypot(w[0] - q.mx, w[1] - q.my) < 0.1 || Math.hypot(w[0] - q.hx, w[1] - q.hy) < q.r + 0.02);
    if (pk) {
      p.pocket = pk.id;
      if (p.n > 0) { const g = shotGeometry(S, T, p.n, pk, cx, cy); if (g) p.phi = g.phi; }
      p.fine = 0; p.dirty = true; syncPlanUI(); return;
    }
    p.drag = 'aim';
  }
  if (kind === 'down' || kind === 'move') {
    if (p.drag === 'cue') {
      const others = []; for (let n = 1; n < 16; n++) if (S.on[n]) others.push({ x: S.x[n], y: S.y[n] });
      const x = Math.max(-T.hx + R, Math.min(APP.G.kitchen ? T.headX : T.hx - R, w[0])), y = Math.max(-T.hy + R, Math.min(T.hy - R, w[1]));
      if (!others.some(o => Math.hypot(o.x - x, o.y - y) < 2 * R + 1e-4)) { p.place = { x, y }; S.x[0] = x; S.y[0] = y; snapPrev(); p.dirty = true; }
    } else if (p.drag === 'aim') {
      if (Math.hypot(w[0] - cx, w[1] - cy) > 0.02) { p.phi = Math.atan2(w[1] - cy, w[0] - cx); p.fine = 0; p.n = null; p.pocket = null; p.dirty = true; }
    }
  }
  if (kind === 'up') { if (p.drag === 'aim') { const f = APP.pred && APP.pred.first; if (f > 0) p.n = f; } p.drag = null; syncPlanUI(); }
}

// ── frame ───────────────────────────────────────────────────────────────────
let last = 0, panel = null, lastRead = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const t = (now || 0) / 1000;
  let dt = last ? Math.min(0.1, t - last) : 1 / 60;
  last = t;
  if (APP.stepOnce) { dt = 1 / 60; APP.stepOnce--; } else if (APP.paused) dt = 0;
  APP.ts += dt;
  if (APP.G) {
    switch (APP.phase) {
      case 'think': stepThink(); break;
      case 'aim': stepAim(); break;
      case 'roll': stepRoll(dt); break;
      case 'settle': stepSettle(); break;
      case 'plan': refreshPlan(); break;
      case 'over': if (APP.mode === 'ai-ai' && APP.ts - APP.phaseT > pace(5)) startGame(APP.seed + 1); break;
    }
  }
  APP.items = APP.items.filter(x => x.fade == null || APP.ts - x.fade < 0.7);
  if (APP.saver) APP.saver.frame(dt); else { draw2d(); draw3d(dt); }
  if (APP.ts - lastRead > 0.1) { lastRead = APP.ts; readouts(); updateHud(); }
}

// interpolated ball positions for drawing
function ballList() {
  const S = APP.G.S, a = APP.phase === 'roll' ? Math.min(1, APP.acc / S.P.h) : 1, out = [];
  for (let n = 0; n < 16; n++) {
    if (S.on[n]) out.push({ n, x: APP.prevX[n] + (S.x[n] - APP.prevX[n]) * a, y: APP.prevY[n] + (S.y[n] - APP.prevY[n]) * a, q: S.q ? S.q.subarray(4 * n, 4 * n + 4) : null });
    else if (APP.drops[n]) { const d = APP.drops[n], p = (APP.ts - d.t0) / 0.45; if (p < 1) out.push({ n, x: d.x, y: d.y, q: S.q ? S.q.subarray(4 * n, 4 * n + 4) : null, drop: { p, hx: d.hx, hy: d.hy }, alpha: 1 - p }); }
  }
  return out;
}

function liveVectors(balls) {
  const S = APP.G.S, out = [];
  if (!APP.show.vel && !APP.show.acc) return out;
  const fr = APP.ct ? { nx: APP.ct.nx, ny: APP.ct.ny, tx: APP.ct.tx, ty: APP.ct.ty } : null;
  for (const b of balls) {
    if (b.drop || !S.on[b.n]) continue;
    const vx = S.vx[b.n], vy = S.vy[b.n];
    if (Math.hypot(vx, vy) < 0.02) continue;
    const A = accel(S, b.n);
    out.push({ i: b.n, x: b.x, y: b.y, vx: APP.show.vel ? vx : 0, vy: APP.show.vel ? vy : 0, ax: APP.show.acc ? A.ax : 0, ay: APP.show.acc ? A.ay : 0,
      frame: APP.show.comp && fr && (b.n === 0 || b.n === (APP.ct && APP.ct.o)) ? fr : null });
  }
  return out;
}

// the drawing state of one 2D frame (also used by the saver)
export function frame2d(dpr) {
  const S = APP.G.S, balls = ballList();
  const items = [];
  if (APP.show.cons) for (const x of APP.items) {
    const p = x.t0 < 0 ? 1 : Math.max(0, Math.min(1, (APP.ts - x.t0) / x.dur));
    if (p <= 0) continue;
    let alpha = x.fade == null ? 1 : Math.max(0, 1 - (APP.ts - x.fade) / 0.6);
    // the newest steps bright, the older ones dim (not a flood of arrows)
    if (APP.phase === 'roll' || APP.phase === 'settle') alpha *= x.k >= APP.shown - 2 ? 1 : 0.35;
    items.push({ it: x.it, p, alpha });
  }
  // the zoom lens on the contact: from the ghost ball step to a second after the contact
  let lens = null;
  if (APP.show.cons && APP.lens && APP.steps.length) {
    const ghostK = APP.steps.findIndex(s => s.id === 'ghost' || s.id === 'aimline');
    let a = 0;
    if (APP.phase === 'plan') a = 1;
    else if (APP.phase === 'aim') a = APP.shown >= ghostK ? 1 : 0;
    else if (APP.phase === 'roll' || APP.phase === 'settle') a = Math.max(0, Math.min(1, 1 - (S.t - (APP.lens.t + 1.4)) / 0.6));
    if (a > 0) lens = Object.assign({}, APP.lens, { alpha: a });
  }
  const trails = [];
  if (APP.show.trails && S.paths && (APP.phase === 'roll' || APP.phase === 'settle')) for (let n = 0; n < 16; n++) { const pts = S.paths[n]; if (pts && pts.length > 3) trails.push({ n, pts: pts.filter((_, k) => k % 3 !== 2), alpha: 1 }); }
  const paths = [];
  if (APP.show.paths && APP.pred && (APP.phase === 'plan' || APP.phase === 'aim')) {
    // while the AI aims: the aimed stroke (the error shows when it strikes)
    const pr = APP.phase === 'aim' && APP.predAim ? APP.predAim : APP.pred;
    for (let n = 0; n < 16; n++) { const pts = pr.paths && pr.paths[n]; if (pts && pts.length > 6) paths.push({ n, pts, alpha: APP.phase === 'aim' ? 0.55 : 0.9, end: pr.S.on[n] ? [pr.S.x[n], pr.S.y[n]] : null }); }
  }
  let cands = null;
  if (APP.phase === 'think') {
    const k = Math.min(1, (APP.ts - APP.phaseT) / 0.4);
    cands = APP.cands.slice(0, 4).map((c, j) => ({ ...c, alpha: (j === 0 ? 0.85 : 0.4) * k, best: j === 0, text: j === 0 ? `${c.kind && c.kind !== 'pot' ? c.kind + ' ' : ''}${Math.round(c.chance * 100)} %` : '' }));
  }
  let cue = null;
  if (APP.plan && (APP.phase === 'aim' || APP.phase === 'plan')) {
    const st = APP.phase === 'aim' ? Math.max(0, Math.sin((APP.ts - APP.phaseT) * 3.2)) : 0.5;
    const phi = APP.plan.ideal ? APP.plan.ideal.phi : APP.plan.phi;
    cue = { x: S.x[0], y: S.y[0], phi, back: 0.025 + 0.07 * st };
    cue.pose = cuePose(T, S, { x: cue.x, y: cue.y, phi, a: APP.plan.a, b: APP.plan.b, back: cue.back });
  }
  const pick = APP.phase === 'plan' && APP.pl ? { legal: legalTargets(APP.G), sel: APP.pl.n, pocket: APP.pl.pocket } : null;
  return { dpr, style: APP.style, balls, items, trails, paths, cands, cue, pick, lens, live: liveVectors(balls), kitchen: APP.G.inHand && APP.G.kitchen,
    accel: APP.show.acc, components: APP.show.comp };
}

function draw2d() {
  if (!APP.G || !ctx2d || c2d.width < 2 || APP.view === '3d') return;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  D.draw(ctx2d, frame2d(dpr2d));
}

export function scene3dState() {
  const S = APP.G.S, balls = ballList();
  let cue = null;
  if (APP.plan && (APP.phase === 'aim' || APP.phase === 'plan')) {
    const st = APP.phase === 'aim' ? Math.max(0, Math.sin((APP.ts - APP.phaseT) * 3.2)) : 0.4;
    const id = APP.plan.ideal || APP.plan;
    cue = { x: S.x[0], y: S.y[0], phi: id.phi, a: id.a, b: id.b, back: 0.02 + 0.09 * st };
  } else if (APP.phase === 'roll' && APP.ts - APP.phaseT < 0.5 && APP.plan) {
    const k = (APP.ts - APP.phaseT) / 0.5, sx = APP.pred.start.x, sy = APP.pred.start.y;
    cue = { x: sx, y: sy, phi: APP.plan.phi, a: APP.plan.a, b: APP.plan.b, back: 0.005 + 0.05 * k, alpha: 1 - k };
  }
  const ov = {};
  if (APP.show.cons && APP.plan && (APP.phase === 'aim' || APP.phase === 'plan')) {
    // the aimed contact (not the observed one: the error shows when the cue strikes)
    const ct = APP.ctAim || APP.ct, sx = APP.pred ? APP.pred.start.x : S.x[0], sy = APP.pred ? APP.pred.start.y : S.y[0];
    if (ct) { ov.aim = [[sx, sy], [ct.cx, ct.cy]]; ov.ghost = [ct.cx, ct.cy]; }
    else { const ph = (APP.plan.ideal || APP.plan).phi; ov.aim = [[sx, sy], [sx + Math.cos(ph) * 1.2, sy + Math.sin(ph) * 1.2]]; }
  }
  ov.arrows = [];
  for (const L of liveVectors(balls)) {
    if (APP.show.vel) ov.arrows.push({ from: [L.x, L.y], vec: [L.vx * 0.11, L.vy * 0.11], m: L.i === 0 ? 'm1' : 'm2' });
    if (APP.show.acc && Math.hypot(L.ax, L.ay) > 0.3) ov.arrows.push({ from: [L.x, L.y], vec: [L.ax * 0.04, L.ay * 0.04], m: 'm6' });
  }
  return { balls, cue, ov };
}

function draw3d(dt) {
  if (!V || !APP.G || APP.view === '2d') return;
  const st = scene3dState();
  V.setBalls(st.balls); V.setCue(st.cue, APP.G.S); V.setOverlay(st.ov);
  if (APP.phase === 'think' || APP.phase === 'settle' || APP.phase === 'over') V.focus({ phase: APP.phase });
  V.update(dt || 1 / 60);
  V.render();
}

function readouts() {
  if (!APP.G) return;
  const S = APP.G.S, rows = [], fr = APP.ct;
  const track = new Set();
  for (let n = 0; n < 16; n++) if (S.on[n] && (S.vx[n] || S.vy[n])) track.add(n);
  if (APP.phase !== 'roll') { track.add(0); if (fr) track.add(fr.o); }
  for (const n of [...track].sort((a, b) => a - b).slice(0, 6)) {
    if (!S.on[n]) continue;
    const vx = S.vx[n], vy = S.vy[n], v = Math.hypot(vx, vy), A = accel(S, n);
    const vn = fr ? vx * fr.nx + vy * fr.ny : NaN, vt = fr ? vx * fr.tx + vy * fr.ty : NaN;
    rows.push({ n, state: ballState(S, n), v, a: Math.hypot(A.ax, A.ay), vn, vt, theta: fr && v > 0.01 ? Math.acos(Math.max(-1, Math.min(1, vn / v))) * 180 / Math.PI : NaN });
  }
  if (APP.phase === 'roll' && !rows.length) return;
  maths.readouts(rows);
}

// ── HUD ─────────────────────────────────────────────────────────────────────
function setText(id, t) { const e = $(id); if (e && e.textContent !== t) e.textContent = t; }
function updateHud() {
  const G = APP.G;
  if (!G) return;
  for (let k = 0; k < 2; k++) {
    const p = G.players[k], el = $('p' + k);
    if (!el) continue;
    el.classList.toggle('turn', G.turn === k && G.phase !== 'over');
    const grp = G.type === '9' ? '' : p.group ? (p.group === 'solids' ? 'solids' : 'stripes') : 'open';
    setText('p' + k + 'n', `${p.name}${(APP.mode === 'you-ai' && k === 0) || (APP.human && G.turn === k) ? ' (you)' : ''}`);
    setText('p' + k + 'g', `${grp}${grp ? ' · ' : ''}${p.potted} down`);
  }
  const phaseWord = { think: 'thinking', aim: 'aiming', roll: 'balls rolling', settle: 'judging', plan: 'your shot', over: 'game over', idle: '' }[APP.phase] || '';
  setText('status', `${gameStatus(G)} · ${phaseWord}`);
  setText('msg', APP.msg || '');
  const plan = APP.phase === 'plan';
  document.body.classList.toggle('planning', plan);
  setText('bannerText', plan ? 'You have the table. Tap a ball, then a pocket, or drag to aim. Set the tip and the speed, then shoot.' : APP.takeover ? 'You take the next shot when the balls stop.' : APP.phase === 'over' ? 'Game over. A new rack starts soon. Tap to break yourself.' : 'The computer plays itself. Tap or click the table to take over.');
  const tb = $('tTake'); if (tb) tb.textContent = plan ? 'Shoot' : 'Take over';
  const db = $('dockTake'); if (db) db.lastElementChild.textContent = plan ? 'Shoot' : 'Take over';
}

// ── layout ──────────────────────────────────────────────────────────────────
let dpr2d = 1, size2d = '';
// The canvases change size only when their pane does (a resize, the view
// buttons, the panel), never while a shot plays: the caption lines and the
// maths cards have fixed boxes (style.css), so text never moves the panes.
function layout() {
  const views = $('views');
  views.dataset.view = APP.view;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r2 = $('pane2d').getBoundingClientRect(), r3 = $('pane3d').getBoundingClientRect();
  const w2 = Math.round(r2.width || $('pane2d').clientWidth || innerWidth / 2), h2 = Math.round(r2.height || $('pane2d').clientHeight || innerHeight / 2);
  dpr2d = dpr;
  const W = Math.max(2, Math.round(w2 * dpr)), H = Math.max(2, Math.round(h2 * dpr));
  // a portrait 2D pane turns the table up the screen
  const rot = h2 > w2 * 1.15, key = `${W}x${H}:${rot}`;
  if (key !== size2d) {
    size2d = key;
    if (c2d.width !== W) c2d.width = W;
    if (c2d.height !== H) c2d.height = H;
    D.layout(W, H, rot, 10 * dpr, 0, 0, { min: 92 * dpr, max: 250 * dpr });
  }
  if (V) { const w3 = Math.round(r3.width || $('pane3d').clientWidth || innerWidth / 2), h3 = Math.round(r3.height || $('pane3d').clientHeight || innerHeight / 2); V.resize(w3, h3, dpr); }
}
layout.reset = () => { size2d = ''; };

// ── input ───────────────────────────────────────────────────────────────────
function bindViews() {
  const w2 = e => { const r = c2d.getBoundingClientRect(); return D.toWorld((e.clientX - r.left) * dpr2d, (e.clientY - r.top) * dpr2d); };
  // outside the planner a tap (not a swipe: the phone column scrolls) takes over
  let tap2 = null;
  const isTap = (t, e) => t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8 && performance.now() - t.t < 450;
  c2d.addEventListener('pointerdown', e => {
    if (APP.saver) return;
    if (APP.phase !== 'plan') { tap2 = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
    try { c2d.setPointerCapture(e.pointerId); } catch (x) { /* old */ }
    planPointer('down', w2(e));
  });
  c2d.addEventListener('pointermove', e => { if (APP.phase === 'plan' && APP.pl && APP.pl.drag) planPointer('move', w2(e)); });
  c2d.addEventListener('pointerup', e => {
    if (APP.phase === 'plan') { planPointer('up', w2(e)); return; }
    if (!APP.saver && isTap(tap2, e)) takeOver();
    tap2 = null;
  });
  c2d.addEventListener('pointercancel', () => { tap2 = null; });
  // 3D: a short tap (not an orbit drag) takes over or aims
  let down = null;
  c3d.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  c3d.addEventListener('pointerup', e => {
    if (!down || APP.saver) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 400;
    down = null;
    if (!tap) return;
    if (APP.phase !== 'plan') { takeOver(); return; }
    if (!V) return;
    const r = c3d.getBoundingClientRect(), w = V.pick(e.clientX - r.left, e.clientY - r.top);
    if (w) { planPointer('down', [w.x, w.y]); planPointer('up', [w.x, w.y]); }
  });
  addEventListener('keydown', e => {
    if (APP.saver || /input|select|textarea/i.test((e.target && e.target.tagName) || '')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (APP.phase === 'plan') shootPlan(); else setPaused(!APP.paused); }
    else if (APP.phase === 'plan' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { APP.pl.fine += (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 0.5 : 0.05); APP.pl.dirty = true; const c = panel.find('fine'); if (c) c.set(APP.pl.fine); }
    else if (e.key === 't' || e.key === 'T') takeOver();
    else if (e.key === 'Escape' && APP.phase === 'plan') handBack();
  });
}

function setPaused(p) {
  APP.paused = p;
  const b = $('tPlay'); if (b) { b.setAttribute('aria-pressed', String(!p)); b.innerHTML = p ? '<i data-icon="play"></i>' : '<i data-icon="pause"></i>'; b.setAttribute('aria-label', p ? 'Play' : 'Pause'); fillIcons(b); }
  const d = $('dockPlay'); if (d) { d.firstElementChild.outerHTML = p ? '<i data-icon="play"></i>' : '<i data-icon="pause"></i>'; d.lastElementChild.textContent = p ? 'Play' : 'Pause'; fillIcons(d); }
}

function syncPlanUI() {
  const on = APP.phase === 'plan' && !!APP.pl;
  $('strikeCard').hidden = !on;
  if (on) {
    strikeA.set(APP.pl.a, APP.pl.b); strikeB.set(APP.pl.a, APP.pl.b);
    const sp = $('speedCard'); if (sp) { sp.value = String(APP.pl.v); setText('speedCardVal', `${APP.pl.v.toFixed(1)} m/s`); }
    if (panel) { const c = panel.find('speed'); if (c) c.set(APP.pl.v); const f = panel.find('fine'); if (f) f.set(APP.pl.fine); }
  }
  updateHud();
}

// ── panel ───────────────────────────────────────────────────────────────────
let strikeA = null, strikeB = null;
function buildPanel() {
  panel = createPanel($('panelBody'), { store: 'billiard' });
  const game = panel.section({ id: 'game', title: 'Game', open: true });
  game.segmented({ id: 'gtype', label: 'Game', items: [{ id: '8', label: '8-ball' }, { id: '9', label: '9-ball' }], value: APP.type, onChange: v => startGame(APP.seed + 1, v) });
  game.segmented({ id: 'players', label: 'Players', items: [{ id: 'ai-ai', label: 'AI vs AI' }, { id: 'you-ai', label: 'You vs AI' }], value: APP.mode,
    onChange: v => { APP.mode = v; APP.takeover = false; startGame(APP.seed + 1); } });
  game.select({ id: 'skill', label: 'AI skill', options: Object.entries(SKILLS).map(([id, s]) => ({ id, label: s.label })), value: APP.skill, onChange: v => { APP.skill = v; }, hint: 'The stroke error (sigma): near perfect 0.05 deg and 1 % speed, Pro 0.25 deg, Club 0.6 deg. The maths shows the aimed and the observed stroke.' });
  game.slider({ id: 'flair', label: 'Flair (banks, kicks, combos)', min: 0, max: 1, step: 0.05, value: APP.flair, format: v => `${Math.round(v * 100)} %`, onInput: v => { APP.flair = v; }, hint: 'How often the AI looks for a makeable bank, kick or combination instead of the plain pot.' });
  game.slider({ id: 'pace', label: 'Pace', min: 0.4, max: 2.5, step: 0.05, value: APP.pace, format: v => `${v.toFixed(2)}x`, onInput: v => { APP.pace = v; }, hint: 'How long the AI thinks and aims, and how long each maths step stays before the next one.' });
  game.actions([{ id: 'newRack', label: 'New rack', icon: 'regrow', onClick: () => startGame(APP.seed + 1) }, { id: 'takeBtn', label: 'Take over', icon: 'target', onClick: () => (APP.phase === 'plan' ? shootPlan() : takeOver()) }]);
  game.note({ id: 'gameNote', text: 'Tap or click the table to take over. In AI vs AI the AI resumes after your shot.' });

  const shot = panel.section({ id: 'shot', title: 'Shot', open: true });
  const host = doc.createElement('div');
  shot.slot({ id: 'strikeSlot', label: 'Cue tip on the cue ball', el: host, hint: 'Above the centre: follow (top spin). Below: draw (back spin). Left or right: side spin (english). The dashed ring is the miscue limit, half the radius.' });
  strikeA = createStrike(host, { onChange: v => { if (APP.pl) { APP.pl.a = v.a; APP.pl.b = v.b; APP.pl.dirty = true; strikeB.set(v.a, v.b); } } });
  shot.slider({ id: 'speed', label: 'Cue ball speed', min: 0.3, max: 11, step: 0.05, value: 2.2, unit: 'm/s', format: v => v.toFixed(2), onInput: v => { if (APP.pl) { APP.pl.v = v; APP.pl.dirty = true; syncSpeedCard(); } } });
  shot.slider({ id: 'fine', label: 'Fine aim', min: -1, max: 1, step: 0.01, value: 0, unit: '°', format: v => v.toFixed(2), onInput: v => { if (APP.pl) { APP.pl.fine = v; APP.pl.dirty = true; } }, hint: 'Turn the aim by up to one degree. Arrow keys: 0.05 deg, with Shift 0.5 deg.' });
  shot.actions([{ id: 'shootBtn', label: 'Shoot', kind: 'primary', onClick: () => (APP.phase === 'plan' ? shootPlan() : takeOver()) }, { id: 'backBtn', label: 'Hand back', onClick: handBack }]);
  shot.note({ id: 'planNote', live: true, text: '' });

  const m = panel.section({ id: 'maths', title: 'Maths', open: !PHONE });
  m.toggle({ id: 'tCons', label: 'Shot construction', value: true, onChange: v => { APP.show.cons = v; } });
  m.toggle({ id: 'tVel', label: 'Velocity vectors', value: true, onChange: v => { APP.show.vel = v; } });
  m.toggle({ id: 'tAcc', label: 'Acceleration vectors', value: true, onChange: v => { APP.show.acc = v; } });
  m.toggle({ id: 'tComp', label: 'Components on n and t', value: true, onChange: v => { APP.show.comp = v; } });
  m.toggle({ id: 'tPaths', label: 'Predicted paths', value: true, onChange: v => { APP.show.paths = v; } });
  m.toggle({ id: 'tTrails', label: 'Trails', value: true, onChange: v => { APP.show.trails = v; } });
  m.toggle({ id: 'tSlow', label: 'Slow down at the contact', value: true, onChange: v => { APP.show.slow = v; } });
  m.toggle({ id: 'tMaths', label: 'Equation panel', value: true, onChange: v => { document.body.classList.toggle('no-maths', !v); layoutSoon(); } });

  const view = panel.section({ id: 'view', title: 'View', open: !PHONE });
  view.segmented({ id: 'layout', label: 'Layout', items: [{ id: 'both', label: '2D + 3D' }, { id: '2d', label: '2D' }, { id: '3d', label: '3D' }], value: APP.view, onChange: v => { APP.view = v; layoutSoon(); } });
  view.segmented({ id: 'style', label: '2D look', items: [{ id: 'felt', label: 'Felt' }, { id: 'chalk', label: 'Chalkboard' }], value: APP.style, onChange: v => { APP.style = v; } });
  view.chips({ id: 'cam', label: '3D camera', items: [{ id: 'auto', label: 'Auto' }, { id: 'broadcast', label: 'Broadcast' }, { id: 'behind', label: 'Behind the cue' }, { id: 'overhead', label: 'Overhead' }, { id: 'free', label: 'Free (drag)' }], value: APP.cam, onChange: v => { APP.cam = v; if (V) V.camMode(v); } });

  const about = panel.section({ id: 'about', title: 'About', open: false });
  const ab = doc.createElement('div');
  ab.innerHTML = `<p class="snp-text">A regulation 9 ft American pool table (WPA: 100 x 50 in bed, 2.25 in balls, 4.6 in corner and 5.06 in side pockets, cushion nose at 63.5 % of the ball height). The balls slide and roll on the cloth with spin (μ<sub>s</sub> 0.2, rolling 0.01), collide with e = 0.95 and friction that throws the object ball, and rebound from a raised cushion nose. The 90° rule and the 30° rule come out of that physics; they are not drawn in.</p>
<p class="snp-text">The computer finds each pot by the ghost ball, corrects the throw with short simulations, then picks the speed and spin that leave the best next shot. Some turns it looks for a bank (the pocket mirrored in the rail), a kick or a combination, and plays it when a simulation pots it. Its stroke has a small seeded error: the maths shows the aimed and the observed stroke and the physics plays the observed one.</p>
<p class="snp-fine">Our own code: physics, rules, AI, both views. three.js r160 (MIT). MathJax 3 (Apache-2.0). Woods: CC0 scans from Poly Haven (tex/CREDITS.md). Felt and ball smudges: CC0 scans from ambientCG, Fabric 034, Fingerprints 003 and Surface Imperfections 003 (CREDITS.md). References: Leckie and Greenspan, an event-based pool physics simulator (2005); D. G. Alciatore, technical proofs (throw, rolling); Mathavan et al. (2010), cushion impact; WPA equipment specifications. This page replaced an earlier port of Ten Minute Physics #03 (Matthias Müller, MIT); none of that code is left.</p>`;
  about.slot({ id: 'aboutSlot', el: ab });
  mountSheet({ panel: $('panel'), grip: $('sheetGrip'), menu: $('dockMenu'), close: $('panelClose'), gear: $('gear'), phoneQ: PHONE_Q, onOpen: () => layoutSoon() });
}
const doc = document;
function syncSpeedCard() { const sp = $('speedCard'); if (sp && APP.pl) { sp.value = String(APP.pl.v); setText('speedCardVal', `${APP.pl.v.toFixed(1)} m/s`); } }

function bindChrome() {
  fillIcons(document);
  $('tPlay').addEventListener('click', () => setPaused(!APP.paused));
  $('tStep').addEventListener('click', () => { setPaused(true); APP.stepOnce = 1; });
  for (const b of document.querySelectorAll('#tSpeed button')) b.addEventListener('click', () => {
    APP.speed = +b.dataset.v;
    for (const o of document.querySelectorAll('#tSpeed button')) { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', String(o === b)); }
  });
  $('tTake').addEventListener('click', () => (APP.phase === 'plan' ? shootPlan() : takeOver()));
  $('tNew').addEventListener('click', () => startGame(APP.seed + 1));
  $('bShoot').addEventListener('click', shootPlan);
  $('bBack').addEventListener('click', handBack);
  $('dockPlay').addEventListener('click', () => setPaused(!APP.paused));
  $('dockTake').addEventListener('click', () => (APP.phase === 'plan' ? shootPlan() : takeOver()));
  $('dockView').addEventListener('click', () => {
    APP.view = { both: '2d', '2d': '3d', '3d': 'both' }[APP.view];
    const c = panel.find('layout'); if (c) c.set(APP.view);
    setText('dockViewText', { both: '2D + 3D', '2d': '2D', '3d': '3D' }[APP.view]);
    layoutSoon();
  });
  $('dockMaths').addEventListener('click', () => { document.body.classList.toggle('no-maths'); layoutSoon(); });
  strikeB = createStrike($('strikeHost'), { size: 92, onChange: v => { if (APP.pl) { APP.pl.a = v.a; APP.pl.b = v.b; APP.pl.dirty = true; strikeA.set(v.a, v.b); } } });
  $('speedCard').addEventListener('input', e => { if (APP.pl) { APP.pl.v = +e.target.value; APP.pl.dirty = true; syncSpeedCard(); const c = panel.find('speed'); if (c) c.set(APP.pl.v); } });
  $('cardShoot').addEventListener('click', shootPlan);
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => layoutSoon()); ro.observe($('pane2d')); ro.observe($('pane3d')); }
  addEventListener('resize', layoutSoon);
}
let layoutQ = 0;
function layoutSoon() { if (layoutQ) return; layoutQ = requestAnimationFrame(() => { layoutQ = 0; layout(); }); }

// ── boot ────────────────────────────────────────────────────────────────────
buildPanel();
bindChrome();
bindViews();
layout();
startGame(APP.seed, APP.type);
updateHud();
requestAnimationFrame(frame);
const ready = boot3d();
// the felt scan on the 2D cloth too (no image: the plain colour)
try { const img = new Image(); img.onload = () => D.setFelt(img); img.src = new URL('./artwork/felt-color.jpg', import.meta.url).href; } catch (e) { /* none */ }
addEventListener('pagehide', () => { APP.paused = true; });

window.__pool = {
  APP, T, D, maths, get V() { return V; }, ready,
  startGame, takeOver, shootPlan, handBack, enterPlan, planPointer, layout, frame2d, scene3dState, setPaused,
  planShot: () => APP.pl && planShot(),
};
installSaver(window.__pool);

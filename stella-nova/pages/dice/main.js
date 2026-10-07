// ============================================================================
//  DICE LAB  ·  main.js — state, UI, the throw loop, replay and statistics
// ----------------------------------------------------------------------------
//  THROW LOOP. A throw builds a new physics world (physics.js) and one mesh
//  per die (scene.js). Each frame the play clock moves by dt x speed. The
//  simulation steps at 240 Hz until its clock passes the play clock, and
//  every second step goes into the record (poses of all dice). The meshes
//  show the record at the play clock, interpolated (lerp and slerp), so
//  slow motion is smooth. Replay plays the same record again, from any
//  camera mode, at any speed.
//
//  SETTLE. When every die is at rest and the play clock has caught up,
//  settle() reads each die (dice.js readDie), applies the explode rule (a
//  die at its top value adds a die, dropped in with spin, and the loop
//  goes on), then scores the notation (notation.js score), puts a label
//  over each die, adds the reads to the session statistics, and runs the
//  camera check when it is on. A cocked die (more than 10 degrees from
//  flat) gets an orange label and the Re-roll button throws it again.
//
//  FRAMING. occlusion() measures the panels, the dock and the sheet; the
//  camera's view offset centres the tray in the clear part. In the saver,
//  the plate band (lib/saver-clear.js) counts the same way.
//
//  GREP MAP
//    const S ................ page state
//    function throwNow ...... a throw from the UI (button, swipe, shake)
//    function startThrow .... a throw from a plan (UI and saver)
//    function frame ......... the loop: step, record, play
//    function poseAt ........ the record at a time
//    function settle ........ read, explode, score, stats
//    function setCamMode .... orbit, top, low, follow, hand
//    function fitTray ....... the orbit distance that fits the tray
//    function occlusion ..... the overlays that cover the canvas
//    function renderStats ... faces, totals, odds
//    function runBatch ...... the batch worker
//    function runCheck ...... camera recognition
// ============================================================================
import * as THREE from 'three';
import { buildDie, DIE_TYPES, TYPE_ORDER, mulberry32, Q } from './dice.js';
import { parse, planDice, score, topValue } from './notation.js';
import { specPmf, moments, atLeast, atMost, prob, chiSquare } from './prob.js';
import { createPhysics, DT, MAX_T, TRAYS } from './physics.js';
import { createScene } from './scene.js';
import { MATERIALS, MATERIAL_ORDER } from './facetex.js';
import { createRecognizer } from './recog.js';
import { faceChart, totalsChart } from './charts.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;

const S = {
  counts: { d6: 3 }, text: '3d6', spec: parse('3d6'), finish: 'resin', style: 'numbers',
  strength: 0.55, tray: 'medium', speed: 1, cam: 'orbit', camCheck: false,
  tab: 'faces', src: 'session', faceType: 'd6', target: 10,
  faces: {}, totals: {}, check: { agree: 0, total: 0 },
  batch: { faces: {}, totals: {}, text: '', running: false },
  ready: false, throws: 0,
};
const saverState = { on: false, band: null, speed: null, cam: null, tick: null, afterRender: null };

// ── scene, physics, recogniser ──────────────────────────────────────────────
let sc;
try { sc = createScene({ canvas: $('view'), coarse: COARSE, onNoGL: () => { $('nogl').hidden = false; } }); }
catch (e) { $('nogl').hidden = false; throw e; }
const camera = sc.camera, controls = sc.controls;
if (COARSE) controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
let P = null, RAPIER = null;
const rec = createRecognizer(sc);
(async () => {
  try {
    RAPIER = (await import('../../vendor/rapier3d-compat@0.21.0/rapier.mjs')).default;
    await RAPIER.init({});
    P = createPhysics(RAPIER, { tray: S.tray });
    S.ready = true; $('loading').hidden = true;
    $('throwBtn').disabled = false; $('dockThrow').disabled = false;
    window.__dice.ready = true;
  } catch (e) {
    $('loading').textContent = 'The physics engine did not load: ' + (e && e.message || e);
    window.__dice.failed = String(e && e.message || e);
  }
})();
$('throwBtn').disabled = true; $('dockThrow').disabled = true;

// ── the throw ───────────────────────────────────────────────────────────────
let T = null;              // the current throw
const typeColour = t => DIE_TYPES[t].colour;

// plan: [{ type, term, slot, part }]; o: { seed, strength, dir, from,
// finish, style, presim }
function startThrow(spec, plan, o = {}) {
  if (!P) return null;
  sc.clearDice();
  const seed = (o.seed ?? (Math.random() * 2 ** 32)) >>> 0;
  if (o.tray && P.dims !== TRAYS[o.tray]) { P.setTray(o.tray); sc.setTray(o.tray); }
  P.throwDice(plan.map(p => p.type), { seed, strength: o.strength ?? S.strength, dir: o.dir || [1, 0], from: o.from || null, spin: o.spin ?? 1 });
  const finish = o.finish || S.finish, style = o.style || S.style;
  const meshes = P.dice.map(d => sc.addDie(d.type, Array.isArray(finish) ? finish[P.dice.indexOf(d) % finish.length] : finish, style));
  T = {
    spec, plan, seed, rnd: mulberry32(seed ^ 0x5bd1e995), dir: o.dir || [1, 0], from: o.from,
    items: plan.map((p, i) => ({ ...p, idx: i, chain: [] })),
    meshes, rec: [], simT: 0, playT: 0, n: 0, t0: 0, rest: false, live: true, replay: false, replayT: 0,
    finish, style, done: false, onSettle: o.onSettle || null, result: null,
  };
  record();
  if (o.presim) presim();
  hideLabels();
  updateStripMoving();
  return T;
}
function record() { T.rec.push({ t: T.simT, p: P.poses() }); }
// step the whole throw now (the saver: so a shot knows its length)
function presim() {
  while (!T.rest && T.simT < T.t0 + MAX_T) { T.rest = P.step(); T.simT += DT; T.n++; if (T.n % 2 === 0 || T.rest) record(); }
  if (T.rec[T.rec.length - 1].t < T.simT) record();
}

function throwNow(o = {}) {
  if (!S.ready) return;
  if (!S.spec || S.spec.error) { $('notaMsg').textContent = S.spec ? S.spec.error : 'Nothing to roll.'; return; }
  S.throws++;
  startThrow(S.spec, planDice(S.spec), { strength: o.strength, dir: o.dir, from: o.from, tray: S.tray });
  $('replayBtn').disabled = true;
  hideHint();
  if (PHONE_Q.matches && $('panel').classList.contains('open') && grp !== 'result') setOpen(false);
}

// ── the record at a time ────────────────────────────────────────────────────
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function poseAt(t) {
  const R = T.rec;
  let lo = 0, hi = R.length - 1;
  if (t <= R[0].t) hi = 0;
  else if (t >= R[hi].t) lo = hi;
  else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m].t <= t) lo = m; else hi = m; } }
  const A = R[lo], B = R[hi], k = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0;
  T.meshes.forEach((m, i) => {
    const a = i * 7;
    if (a + 7 > B.p.length) { m.visible = false; return; }
    m.visible = true;
    const pa = a + 7 <= A.p.length ? A.p : B.p;
    m.position.set(pa[a] + (B.p[a] - pa[a]) * k, pa[a + 1] + (B.p[a + 1] - pa[a + 1]) * k, pa[a + 2] + (B.p[a + 2] - pa[a + 2]) * k);
    _qa.set(pa[a + 3], pa[a + 4], pa[a + 5], pa[a + 6]); _qb.set(B.p[a + 3], B.p[a + 4], B.p[a + 5], B.p[a + 6]);
    m.quaternion.slerpQuaternions(_qa, _qb, k);
  });
}

// ── settle ──────────────────────────────────────────────────────────────────
function settle() {
  const reads = P.read();
  // explosions: a die that shows its top value adds a die
  let added = false;
  for (const it of T.items) {
    const t = T.spec.terms[it.term];
    if (!t || !t.explode) continue;
    const lastIdx = it.chain.length ? it.chain[it.chain.length - 1] : it.idx, r = reads[lastIdx];
    const v = t.sides === 10 && r.value === 0 ? 10 : r.value;
    if (!r.cocked && v === topValue(t.sides) && it.chain.length < 12) {
      const [w, d] = P.dims, rnd = T.rnd;
      const o = P.addDie(it.type, [(rnd() - 0.5) * w * 0.5, 9 + rnd() * 3, (rnd() - 0.5) * d * 0.5], Q.random(rnd));
      o.body.setLinvel({ x: (rnd() - 0.5) * 80, y: -20, z: (rnd() - 0.5) * 60 }, true);
      const wv = Q.rot(Q.random(rnd), [0, 0, 1]), sp = 15 + 20 * rnd();
      o.body.setAngvel({ x: wv[0] * sp, y: wv[1] * sp, z: wv[2] * sp }, true);
      T.meshes.push(sc.addDie(it.type, Array.isArray(T.finish) ? T.finish[0] : T.finish, T.style));
      it.chain.push(P.dice.length - 1);
      added = true;
    }
  }
  if (added) { T.rest = false; T.live = true; T.t0 = T.simT; record(); return; }
  const items = T.items.map(it => ({ ...it, read: reads[it.idx], chain: it.chain.map(j => reads[j]) }));
  const res = score(T.spec, items);
  T.result = res; T.reads = reads; T.done = true;
  // labels
  hideLabels();
  const kept = new Map();
  res.parts.forEach((p, ti) => { if (!p.dice) return; p.dice.forEach((d, slot) => kept.set(ti + ':' + slot, d.kept)); });
  T.meshes.forEach((m, i) => {
    const r = reads[i], it = T.items.find(x => x.idx === i || x.chain.includes(i));
    const k = it ? kept.get(it.term + ':' + it.slot) !== false : true;
    const s = sc.label(r.cocked ? `${r.label || '·'} ?` : (r.label || '·'), { cocked: r.cocked, kept: k });
    s.userData.die = m; s.userData.R = buildDie(m.userData.type).R;
    m.userData.label = s;
  });
  // session statistics (a cocked die does not count; a total counts only
  // when no die is cocked)
  for (const r of reads) if (!r.cocked) { (S.faces[r.type] ||= {})[r.label] = (S.faces[r.type][r.label] || 0) + 1; }
  if (!res.cocked && !saverState.on) { const H = (S.totals[T.spec.text] ||= {}); H[res.total] = (H[res.total] || 0) + 1; }
  if (!saverState.on) {
    renderResult(); renderStats();
    $('replayBtn').disabled = false;
    if (S.camCheck) setTimeout(runCheck, 50);
  }
  if (T.onSettle) T.onSettle(res);
  window.__dice.last = { total: res.total, cocked: res.cocked, labels: reads.map(r => r.label), types: reads.map(r => r.type), text: T.spec.text };
}
function reroll() {
  if (!T || !T.done) return;
  const list = P.dice.filter((d, i) => T.reads[i].cocked);
  if (!list.length) return;
  P.rethrow(list, T.rnd() * 2 ** 32 >>> 0);
  T.rest = false; T.live = true; T.done = false; T.playT = T.simT; T.t0 = T.simT;
  record(); hideLabels(); updateStripMoving();
}
function hideLabels() {
  for (const m of sc.diceGroup.children) m.userData.label = null;
  for (const s of sc.labelGroup.children.slice()) { sc.labelGroup.remove(s); s.material.map.dispose(); s.material.dispose(); }
}

// ── result card and strip ───────────────────────────────────────────────────
const fmtP = p => p >= 0.995 ? '>99%' : p < 0.0001 ? p.toExponential(1) : (p * 100).toFixed(p < 0.01 ? 2 : 1) + '%';
function renderResult() {
  const res = T.result, spec = T.spec, pmf = specPmf(spec);
  const terms = res.parts.map(p => {
    const t = p.term;
    if (t.kind === 'const') return `<div class="term"><span class="tn">${t.sign < 0 ? '−' : '+'} ${t.value}</span></div>`;
    const tn = `${t.sign < 0 ? '−' : ''}${t.count}d${t.sides === 100 ? '%' : t.sides}${t.explode ? '!' : ''}${t.keep ? t.keep.op + t.keep.arg : ''}`;
    const chips = p.dice.map(d => `<span class="dv${d.kept ? '' : ' drop'}${d.cocked ? ' ck' : ''}" style="--c:${t.type === 'd20' ? '#d9c38a' : typeColour(t.type === 'd%' ? 'd100' : t.type)}">${d.seq.length > 1 ? d.seq.join('+') : t.sides === 'F' ? (d.v > 0 ? '+' : d.v < 0 ? '−' : '0') : t.sides === 'C' ? (d.v ? 'H' : 'T') : d.v}</span>`).join('');
    return `<div class="term"><span class="tn">${tn}</span>${chips}<span>= ${p.value}</span></div>`;
  }).join('');
  const pe = prob(pmf, res.total), pg = atLeast(pmf, res.total), m = moments(pmf);
  $('result').innerHTML = `<div class="big">${res.total}</div><div class="sub">${spec.text}</div><div class="terms">${terms}</div>
    <div class="pr">P(exactly ${res.total}) = <b>${fmtP(pe)}</b> · P(≥ ${res.total}) = <b>${fmtP(pg)}</b><br>expected ${m.mean.toFixed(2)} ± ${m.sd.toFixed(2)}${moments(pmf).mass < 0.9999999 ? ' (explosions truncated)' : ''}</div>`;
  const ck = res.cocked;
  $('cockedBox').hidden = !ck;
  $('cockedTxt').textContent = ck ? `${ck} ${ck > 1 ? 'dice are' : 'die is'} cocked (resting on an edge or on another die).` : '';
  $('stripTot').textContent = ck ? `${res.total}?` : String(res.total);
  $('stripNote').textContent = `${spec.text} · P(≥ ${res.total}) ${fmtP(pg)}`;
}
function updateStripMoving() { if (!saverState.on) { $('stripTot').textContent = '…'; $('stripNote').textContent = T ? T.spec.text : ''; } }

// ── picker, notation, finishes ──────────────────────────────────────────────
const PICK = ['d4', 'd6', 'd8', 'd10', 'd100', 'd12', 'd20', 'dF', 'coin'];
const PICK_NAME = { d4: 'd4', d6: 'd6', d8: 'd8', d10: 'd10', d100: 'd%', d12: 'd12', d20: 'd20', dF: 'Fate', coin: 'coin' };
const PICK_NOTE = { d4: 'd4', d6: 'd6', d8: 'd8', d10: 'd10', d100: 'd%', d12: 'd12', d20: 'd20', dF: 'dF', coin: 'dC' };
function swatch(t) {
  const c = typeColour(t), shape = { d4: 'M15 3 L28 26 L2 26 Z', d6: 'M5 5 H25 V25 H5 Z', d8: 'M15 2 L28 15 L15 28 L2 15 Z', d10: 'M15 2 L27 13 L15 28 L3 13 Z', d100: 'M15 2 L27 13 L15 28 L3 13 Z', d12: 'M15 2 L27 11 L23 26 H7 L3 11 Z', d20: 'M15 2 L27 9 V21 L15 28 L3 21 V9 Z', dF: 'M5 5 H25 V25 H5 Z', coin: 'M15 3 A12 12 0 1 1 14.9 3 Z' }[t];
  const glyph = { d4: '4', d6: '6', d8: '8', d10: '0', d100: '%', d12: '12', d20: '20', dF: '+', coin: 'H' }[t];
  return `<svg class="sw" viewBox="0 0 30 30"><path d="${shape}" fill="${c}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/><text x="15" y="${t === 'd4' ? 22 : 19.5}" text-anchor="middle" font-size="${glyph.length > 1 ? 9 : 11}" font-family="Inter,sans-serif" font-weight="700" fill="${DIE_TYPES[t].ink}">${glyph}</text></svg>`;
}
function buildPicker() {
  $('picker').innerHTML = PICK.map(t => `<div class="pk" data-t="${t}">${swatch(t)}<span class="nm">${PICK_NAME[t]}</span><span class="ct"><button type="button" data-d="-1" aria-label="One less ${PICK_NAME[t]}">−</button><b>0</b><button type="button" data-d="1" aria-label="One more ${PICK_NAME[t]}">+</button></span></div>`).join('');
  $('picker').querySelectorAll('.pk').forEach(el => {
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const t = el.dataset.t, n = Math.max(0, Math.min(20, (S.counts[t] || 0) + +b.dataset.d));
      S.counts[t] = n; fromCounts();
    }));
  });
  syncPicker();
}
function syncPicker() {
  $('picker').querySelectorAll('.pk').forEach(el => { const n = S.counts[el.dataset.t] || 0; el.classList.toggle('on', n > 0); const b = el.querySelector('b'); b.textContent = n; b.classList.toggle('zero', !n); });
}
function fromCounts() {
  const parts = PICK.filter(t => S.counts[t] > 0).map(t => `${S.counts[t]}${PICK_NOTE[t]}`);
  setNotation(parts.join(' + ') || '', false);
}
function setNotation(text, fromInput = true) {
  S.text = text; $('nota').value = text;
  const sp = parse(text);
  S.spec = sp;
  $('notaMsg').textContent = sp.error || '';
  $('notaMsg').classList.toggle('err', !!sp.error);
  if (!sp.error && fromInput) {
    // counts follow a typed roll (plain groups only)
    S.counts = {};
    for (const t of sp.terms) if (t.kind === 'dice') { const k = t.sides === 100 ? 'd100' : t.type === 'd%' ? 'd100' : t.type; S.counts[k] = (S.counts[k] || 0) + t.count; }
  }
  syncPicker();
  if (!sp.error) {
    const types = new Set(planDice(sp).map(p => p.type));
    if (!types.has(S.faceType)) S.faceType = [...types][0];
    $('stripNote').textContent = sp.text; $('stripTot').textContent = '–';
  }
  renderStats();
}
const CHIPS = ['3d6', '4d6 drop lowest', 'advantage', 'disadvantage', '1d20+5', '2d6!', 'd%', '4dF', '3 coins', '1d4+1d6+1d8+1d10+1d12+1d20', '10d6'];
$('chips').innerHTML = CHIPS.map(c => `<button type="button">${c}</button>`).join('');
$('chips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { setNotation(b.textContent); }));
$('notaForm').addEventListener('submit', e => { e.preventDefault(); setNotation($('nota').value); if (!S.spec.error) throwNow(); });
$('nota').addEventListener('change', () => setNotation($('nota').value));
$('finishes').innerHTML = MATERIAL_ORDER.map(f => `<button type="button" data-f="${f}" class="${f === S.finish ? 'on' : ''}">${MATERIALS[f].name}</button>`).join('');
$('finishes').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  S.finish = b.dataset.f;
  $('finishes').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  restyle();
}));
$('styleSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  S.style = b.dataset.style; $('styleSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); restyle();
}));
// a new finish or style swaps the materials of the dice on the tray
function restyle() {
  if (!T) return;
  T.finish = S.finish; T.style = S.style;
  const old = T.meshes;
  sc.clearDice();
  T.meshes = old.map(m => { const n = sc.addDie(m.userData.type, S.finish, S.style); n.position.copy(m.position); n.quaternion.copy(m.quaternion); n.visible = m.visible; return n; });
  if (T.done) { const keep = { live: T.live }; T.live = false; T.done = false; settleLabelsOnly(); T.live = keep.live; }
}
function settleLabelsOnly() {
  const reads = T.reads;
  T.meshes.forEach((m, i) => { const r = reads[i]; const s = sc.label(r.cocked ? `${r.label || '·'} ?` : (r.label || '·'), { cocked: r.cocked }); s.userData.die = m; s.userData.R = buildDie(m.userData.type).R; });
  T.done = true;
}

// throw controls
const setVal = (id, v) => { $(id).textContent = v; };
$('strength').addEventListener('input', () => { S.strength = +$('strength').value; setVal('strengthV', Math.round(S.strength * 100) + '%'); });
setVal('strengthV', Math.round(S.strength * 100) + '%');
$('traySeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  S.tray = b.dataset.tray; $('traySeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  sc.setTray(S.tray); if (P) P.setTray(S.tray);
  if (T) { sc.clearDice(); hideLabels(); T = null; }
  fitTray(true);
}));
$('speedSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  S.speed = +b.dataset.speed; $('speedSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
}));
$('camSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setCamMode(b.dataset.cam)));
$('replayBtn').addEventListener('click', () => { if (T && T.done) { T.replay = true; T.replayT = 0; hideLabelsTemp(true); } });
$('rerollBtn').addEventListener('click', reroll);
$('throwBtn').addEventListener('click', () => throwNow());
$('dockThrow').addEventListener('click', () => throwNow());
function hideLabelsTemp(h) { sc.labelGroup.visible = !h; }

// shake to roll: only after a tap that grants the permission
if (COARSE && 'DeviceMotionEvent' in window) {
  $('shakeBtn').hidden = false;
  let on = false, last = 0;
  const onMotion = e => {
    const a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
    const g = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    const now = performance.now();
    if (Math.abs(g - 9.81) > 13 && now - last > 1600) { last = now; throwNow({ strength: Math.min(1, 0.45 + (Math.abs(g - 9.81) - 13) / 20) }); }
  };
  $('shakeBtn').addEventListener('click', async () => {
    if (on) { window.removeEventListener('devicemotion', onMotion); on = false; $('shakeBtn').classList.remove('on'); return; }
    try {
      const D = window.DeviceMotionEvent;
      if (D && typeof D.requestPermission === 'function') { const r = await D.requestPermission(); if (r !== 'granted') { $('shakeBtn').textContent = 'Motion not allowed'; return; } }
      window.addEventListener('devicemotion', onMotion); on = true; $('shakeBtn').classList.add('on');
    } catch (e) { $('shakeBtn').textContent = 'Motion not available'; }
  });
}

// keys: space or enter throws, r replays
addEventListener('keydown', e => {
  if (saverState.on || e.target.closest && e.target.closest('input,textarea')) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); throwNow(); }
  if (e.key === 'r' && T && T.done) { T.replay = true; T.replayT = 0; hideLabelsTemp(true); }
});

// swipe on the tray throws: the swipe gives the direction and strength
let swipe = null;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
$('view').addEventListener('pointerdown', e => {
  if (saverState.on) return;
  swipe = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType, n: 0 };
});
$('view').addEventListener('pointermove', e => { if (swipe && e.pointerId !== swipe.id) swipe.multi = true; });
$('view').addEventListener('pointerup', e => {
  if (!swipe || e.pointerId !== swipe.id || swipe.multi) { swipe = null; return; }
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, dt = performance.now() - swipe.t, L = Math.hypot(dx, dy);
  const touch = swipe.type !== 'mouse';
  const ok = touch ? (dt < 450 && L > 45) : (dt < 260 && L > 90);
  if (ok && S.ready) {
    // screen direction to the felt plane: camera right and forward on xz
    const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); r.y = 0; r.normalize();
    const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
    const d = r.multiplyScalar(dx).add(f.multiplyScalar(-dy)); d.y = 0; d.normalize();
    const rect = $('view').getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((swipe.x - rect.left) / rect.width * 2 - 1, -((swipe.y - rect.top) / rect.height) * 2 + 1), camera);
    let from = null;
    if (ray.ray.intersectPlane(plane, hit)) { const [w, dd] = P.dims; from = [Math.max(-w / 2 + 4, Math.min(w / 2 - 4, hit.x)), Math.max(-dd / 2 + 4, Math.min(dd / 2 - 4, hit.z))]; }
    const strength = Math.max(0.15, Math.min(1, 0.15 + (L / dt) * (touch ? 0.32 : 0.22)));
    throwNow({ dir: [d.x, d.z], from, strength });
  }
  swipe = null;
});

// ── camera modes ────────────────────────────────────────────────────────────
const camGoal = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
function setCamMode(m) {
  if (m === 'reset') { S.cam = 'orbit'; fitTray(true); m = 'orbit'; }
  S.cam = m;
  controls.enabled = m === 'orbit';
  $('camSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cam === m));
}
function centroid(out) {
  out.set(0, 0, 0); let n = 0;
  for (const m of sc.diceGroup.children) if (m.visible) { out.add(m.position); n++; }
  return n ? out.multiplyScalar(1 / n) : out;
}
const _c = new THREE.Vector3();
function camModeGoal() {
  const [w, d] = sc.dims, dir = T ? T.dir : [1, 0];
  const c = centroid(_c);
  switch (S.cam) {
    case 'top': camGoal.pos.set(0, Math.max(w, d) * 1.55 + 10, 0.01); camGoal.tgt.set(0, 0, 0); break;
    case 'low': {
      // 2 cm over the felt, inside the rim: from the dice toward the tray
      // centre (or the near side when the dice are at the centre)
      let ux = -c.x, uz = -c.z; const L = Math.hypot(ux, uz);
      if (L < 2) { ux = 0; uz = 1; } else { ux /= L; uz /= L; }
      const room = Math.min(ux > 1e-6 ? (w / 2 - c.x) / ux : ux < -1e-6 ? (-w / 2 - c.x) / ux : 1e9, uz > 1e-6 ? (d / 2 - c.z) / uz : uz < -1e-6 ? (-d / 2 - c.z) / uz : 1e9);
      const D = Math.max(4, Math.min(16, room - 1));
      camGoal.pos.set(c.x + ux * D, 2, c.z + uz * D); camGoal.tgt.set(c.x, 0.9, c.z); break;
    }
    case 'follow': camGoal.pos.set(c.x - dir[0] * 16, 10, c.z - dir[1] * 16 + 4); camGoal.tgt.set(c.x, 0.5, c.z); break;
    case 'hand': { const hx = -dir[0] * (w / 2 - 6), hz = -dir[1] * (d / 2 - 5); camGoal.pos.set(hx - dir[0] * 10, 14, hz - dir[1] * 10 + 2); camGoal.tgt.set(hx + dir[0] * 18, 0, hz + dir[1] * 18); break; }
  }
}

// ── framing ─────────────────────────────────────────────────────────────────
const OVERLAYS = ['panel', 'anaPanel', 'dock'].map($);
// skipSheet: leave out the phone sheet (fitTray: the sheet comes and goes,
// the camera distance should not)
function occlusion(w, h, skipSheet = false) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (saverState.on) {
    const B = saverState.band;
    if (B) { let t = B.t, b = B.b; const k = (t + b) / (0.7 * h); if (k > 1) { t /= k; b /= k; } o.t = t; o.b = b; }
    return o;
  }
  const vr = $('view').getBoundingClientRect();
  for (const el of OVERLAYS) {
    if (skipSheet && el === OVERLAYS[0] && PHONE_Q.matches) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left - vr.left), x1 = Math.min(w, q.right - vr.left), y0 = Math.max(0, q.top - vr.top), y1 = Math.min(h, q.bottom - vr.top);
    if (x1 - x0 < 1 || y1 - y0 < 1 || getComputedStyle(el).display === 'none') continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  // the result strip and the throw button: keep the tray clear of them
  if (!PHONE_Q.matches) o.b = Math.max(o.b, 70);
  o.t = Math.max(o.t, 52);
  return o;
}
const occ = { l: 0, r: 0, t: 0, b: 0 };
// fitTray: the orbit distance at which the tray (and rim) fills the clear
// part, from a 40° look-down at the front
const _tmpCam = new THREE.PerspectiveCamera();
function fitDistance(dirVec, target, w, h, o, box) {
  _tmpCam.copy(camera);
  _tmpCam.aspect = w / h; _tmpCam.setViewOffset(w, h, (o.r - o.l) / 2, (o.b - o.t) / 2, w, h);
  const cx = (w - o.l - o.r) / w, cy = (h - o.t - o.b) / h;
  let lo = 3, hi = 400;
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
  for (let it = 0; it < 30; it++) {
    const D = (lo + hi) / 2;
    _tmpCam.position.copy(target).addScaledVector(dirVec, D); _tmpCam.lookAt(target); _tmpCam.updateMatrixWorld(); _tmpCam.updateProjectionMatrix();
    let fits = true;
    for (const p of pts) { const q = p.clone().project(_tmpCam); if (Math.abs(q.x) > cx * 0.96 || Math.abs(q.y) > cy * 0.94 || q.z > 1) { fits = false; break; } }
    if (fits) hi = D; else lo = D;
  }
  return hi;
}
function fitTray(jump = false) {
  const w = $('view').clientWidth, h = $('view').clientHeight; if (!w || !h) return;
  const o = occlusion(w, h, true);
  const [tw, td] = sc.dims;
  const box = new THREE.Box3(new THREE.Vector3(-tw / 2 - 2, -0.5, -td / 2 - 2), new THREE.Vector3(tw / 2 + 2, 5, td / 2 + 2));
  // a tall frame looks along the tray (from behind the hand, at -x), so
  // the long side runs up the screen. The test uses the canvas, not the
  // clear part: the phone sheet slides away at boot and would flip it.
  const portrait = h > w * 1.15, el = (portrait ? 56 : 52) * Math.PI / 180;
  const dir = portrait ? new THREE.Vector3(-Math.cos(el), Math.sin(el), 0) : new THREE.Vector3(0, Math.sin(el), Math.cos(el));
  const D = fitDistance(dir, new THREE.Vector3(0, 0, 0), w, h, o, box);
  controls.target.set(0, 0, 0);
  camera.position.copy(dir.multiplyScalar(D));
  controls.update();
}

// ── panel, sheet, dock ──────────────────────────────────────────────────────
const panel = $('panel'), anaPanel = $('anaPanel'), tabs = [...document.querySelectorAll('#dock .tab')];
let grp = 'dice';
function placeAnalysis() {
  const phone = PHONE_Q.matches;
  for (const id of ['resultSec', 'statsSec']) { const el = $(id); if (phone) { if (el.parentNode !== panel) panel.appendChild(el); } else if (el.parentNode !== anaPanel) anaPanel.appendChild(el); }
}
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
  if (open) requestAnimationFrame(renderStats);
}
function setAna(open) { anaPanel.classList.toggle('open', open); document.body.classList.toggle('ana-closed', !open); if (open) requestAnimationFrame(renderStats); }
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
$('anaOpen').addEventListener('click', () => setAna(true));
$('anaClose').addEventListener('click', () => setAna(false));
placeAnalysis();
setOpen(!PHONE_Q.matches); setAna(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); setAna(!e.matches); });
{
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
setTimeout(hideHint, 12000);

// ── statistics ──────────────────────────────────────────────────────────────
$('tabSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  S.tab = b.dataset.tab; $('tabSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('#statsSec .tab').forEach(t => { t.hidden = t.dataset.tab !== S.tab; });
  renderStats();
}));
$('srcSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  S.src = b.dataset.src; $('srcSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderStats();
}));
$('target').addEventListener('input', () => { S.target = +$('target').value; renderStats(); });

function faceData(type, src) {
  const die = buildDie(type), labels = [...new Set(die.valued.map(f => f.label))];
  const ORDER = { '−': -1, '': 0, '+': 1, T: 0, H: 1 };
  const key = l => l in ORDER ? ORDER[l] : parseFloat(l);
  labels.sort((a, b) => key(a) - key(b));
  const shares = labels.map(l => type === 'd4' ? 1 / 4 : die.valued.filter(f => f.label === l).length / die.valued.length);
  const F = (src === 'batch' ? S.batch.faces : S.faces)[type] || {};
  return { labels, shares, counts: labels.map(l => F[l] || 0) };
}
let statsRaf = 0;
function renderStats() { if (!statsRaf) statsRaf = requestAnimationFrame(() => { statsRaf = 0; drawStats(); }); }
function drawStats() {
  if (saverState.on) return;
  const sp = S.spec && !S.spec.error ? S.spec : null;
  // face type chips: the types in the roll, then any with data
  const types = new Set(sp ? planDice(sp).map(p => p.type) : []);
  for (const t of TYPE_ORDER) if (S.faces[t] || S.batch.faces[t]) types.add(t);
  if (!types.has(S.faceType) && types.size) S.faceType = [...types][0];
  $('faceTypes').innerHTML = [...types].map(t => `<button type="button" data-t="${t}" class="${t === S.faceType ? 'on' : ''}">${PICK_NAME[t]}</button>`).join('');
  $('faceTypes').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.faceType = b.dataset.t; renderStats(); }));
  if (S.tab === 'faces' && S.faceType) {
    const fd = faceData(S.faceType, S.src);
    faceChart($('faceCv'), { ...fd, colour: S.faceType === 'd20' ? '#c9b27a' : typeColour(S.faceType) });
    const X = chiSquare(fd.counts, fd.shares), n = X.n;
    const verdict = n < 5 * fd.labels.length ? 'too few rolls for the test (want 5 per face)' : X.p < 0.01 ? '<span class="fail">unlikely for a fair die</span>' : '<span class="pass">consistent with a fair die</span>';
    $('faceTxt').innerHTML = `n = <b>${n}</b> · χ² = <b>${X.x2.toFixed(2)}</b> on ${X.df} df · p = <b>${n ? X.p.toFixed(3) : '–'}</b> · ${verdict}`;
  }
  if (S.tab === 'totals' && sp) {
    const pmf = specPmf(sp), Hs = S.totals[sp.text] || {}, Hb = S.batch.text === sp.text ? S.batch.totals : {};
    const H = {}; let n = 0;
    for (const src of [Hs, Hb]) for (const k in src) { H[k] = (H[k] || 0) + src[k]; n += src[k]; }
    totalsChart($('totCv'), { pmf, hist: H, n, colour: '#7fb2a0', mark: T && T.result && T.spec.text === sp.text ? T.result.total : null });
    const m = moments(pmf);
    let om = 0, ov = 0; for (const k in H) om += +k * H[k]; om = n ? om / n : 0; for (const k in H) ov += (+k - om) ** 2 * H[k]; ov = n > 1 ? ov / (n - 1) : 0;
    $('totTxt').innerHTML = `<table><tr><td>${sp.text}</td><td>exact</td><td>observed (n ${n})</td></tr><tr><td>mean</td><td>${m.mean.toFixed(3)}</td><td>${n ? om.toFixed(3) : '–'}</td></tr><tr><td>variance</td><td>${m.var.toFixed(3)}</td><td>${n > 1 ? ov.toFixed(3) : '–'}</td></tr><tr><td>sd</td><td>${m.sd.toFixed(3)}</td><td>${n > 1 ? Math.sqrt(ov).toFixed(3) : '–'}</td></tr></table>`;
  }
  if (S.tab === 'odds' && sp) {
    const pmf = specPmf(sp), lo = pmf.lo, hi = pmf.lo + pmf.p.length - 1;
    const tg = $('target'); tg.min = lo; tg.max = Math.min(hi, lo + 400);
    S.target = Math.max(lo, Math.min(+tg.max, S.target)); tg.value = S.target;
    setVal('targetV', S.target);
    const x = S.target, m = moments(pmf);
    $('oddsTbl').innerHTML = `<tr><td>${sp.text}: P(total ≥ ${x})</td><td>${fmtP(atLeast(pmf, x))}</td></tr><tr><td>P(total = ${x})</td><td>${fmtP(prob(pmf, x))}</td></tr><tr><td>P(total ≤ ${x})</td><td>${fmtP(atMost(pmf, x))}</td></tr><tr><td>mean ± sd</td><td>${m.mean.toFixed(2)} ± ${m.sd.toFixed(2)}</td></tr><tr><td>range</td><td>${lo} to ${hi}${m.mass < 0.9999999 ? '+' : ''}</td></tr>`;
    const dc = Math.max(1, Math.min(20, x));
    const one = specPmf(parse('1d20')), adv = specPmf(parse('2d20kh1')), dis = specPmf(parse('2d20kl1'));
    $('advTbl').innerHTML = `<tr><td>1d20 ≥ ${dc}</td><td>${fmtP(atLeast(one, dc))}</td></tr><tr><td>advantage (2d20 keep high) ≥ ${dc}</td><td>${fmtP(atLeast(adv, dc))}</td></tr><tr><td>disadvantage (2d20 keep low) ≥ ${dc}</td><td>${fmtP(atLeast(dis, dc))}</td></tr><tr><td>4d6 drop lowest ≥ ${Math.max(3, Math.min(18, x))} vs 3d6</td><td>${fmtP(atLeast(specPmf(parse('4d6dl1')), Math.max(3, Math.min(18, x))))} vs ${fmtP(atLeast(specPmf(parse('3d6')), Math.max(3, Math.min(18, x))))}</td></tr>`;
  }
}
addEventListener('resize', () => renderStats());

// ── batch (worker) ──────────────────────────────────────────────────────────
let worker = null, batchId = 0;
function getWorker() {
  if (!worker) { worker = new Worker(new URL('./batch-worker.js', import.meta.url), { type: 'module' }); }
  return worker;
}
function runBatch(throws, spec = S.spec, onDone) {
  if (!spec || spec.error) return;
  const W = getWorker(), id = ++batchId;
  S.batch.running = true; S.batch.text = spec.text;
  const plan = planDice(spec);
  let base = null, lastMsg = null;
  W.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;                 // a replaced run
    if (m.kind === 'progress') {
      lastMsg = m;
      // per-run counts; merge into the batch totals for this notation
      if (!base) base = { faces: JSON.parse(JSON.stringify(S.batch.faces)), totals: S.batch.text === spec.text ? { ...S.batch.totals } : {} };
      const F = JSON.parse(JSON.stringify(base.faces));
      for (const t in m.faces) for (const l in m.faces[t]) (F[t] ||= {})[l] = (F[t][l] || 0) + m.faces[t][l];
      const Tt = { ...base.totals }; for (const k in m.totals) Tt[k] = (Tt[k] || 0) + m.totals[k];
      S.batch.faces = F; S.batch.totals = Tt;
      $('batchOut').innerHTML = `${spec.text}: <b>${m.done.toLocaleString()}</b> / ${m.throws.toLocaleString()} physics throws · ${Math.round(m.dps).toLocaleString()} dice/s · re-thrown cocked ${m.rerolls}`;
      if (S.src !== 'batch') { S.src = 'batch'; $('srcSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.src === 'batch')); }
      renderStats();
      if (onDone && onDone.progress) onDone.progress(m);
    } else if (m.kind === 'done') { S.batch.running = false; if (onDone) (onDone.done || onDone)(lastMsg); }
    else if (m.kind === 'error') { S.batch.running = false; $('batchOut').textContent = 'Batch error: ' + m.message; }
  };
  W.postMessage({ cmd: 'start', id, spec, plan, throws, seed: (Math.random() * 2 ** 32) >>> 0, tray: 'large', strength: 0.5 });
}
$('batch1k').addEventListener('click', () => runBatch(1000));
$('batch10k').addEventListener('click', () => runBatch(10000));
// fairness sweep: 250 throws of 4 dice of each type (1000 rolls), one type
// at a time; the test uses the counts of that run only
$('fairBtn').addEventListener('click', () => {
  const list = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'dF', 'dC'];
  const rows = [];
  const next = k => {
    if (k >= list.length) return;
    const sp = parse('4' + list[k]);
    runBatch(250, sp, last => {
      const type = planDice(sp)[0].type, fd = faceData(type, 'batch'), F = (last && last.faces[type]) || {};
      const X = chiSquare(fd.labels.map(l => F[l] || 0), fd.shares);
      rows.push(`<tr><td>${PICK_NAME[type]}</td><td>n ${X.n}</td><td>χ² ${X.x2.toFixed(1)} (${X.df} df)</td><td class="${X.p < 0.01 ? 'fail' : 'pass'}">p ${X.p.toFixed(3)}</td></tr>`);
      $('batchOut').innerHTML = `<table>${rows.join('')}</table>`;
      next(k + 1);
    });
  };
  next(0);
});

// ── camera recognition ──────────────────────────────────────────────────────
$('camChk').addEventListener('click', () => { S.camCheck = !S.camCheck; $('camChk').classList.toggle('on', S.camCheck); if (S.camCheck && T && T.done) runCheck(); });
$('camNow').addEventListener('click', () => runCheck());
function runCheck() {
  if (!T || !T.done) { $('checkOut').textContent = 'Throw first.'; return null; }
  const entries = T.meshes.map((m, i) => ({ mesh: m, type: m.userData.type, finish: m.userData.finish, style: T.style, read: T.reads[i] }));
  const R = rec.run(entries);
  let ag = 0, n = 0;
  const rows = R.results.map((r, i) => {
    const ph = entries[i].read;
    // a die the camera did not find counts against the camera
    if (!r.found) { if (!ph.cocked) n++; return `<tr><td>${PICK_NAME[entries[i].type]}</td><td>physics ${ph.label}</td><td class="bad">not found</td></tr>`; }
    const same = r.label === ph.label;
    if (!ph.cocked) { n++; if (same) ag++; }
    return `<tr><td>${PICK_NAME[entries[i].type]}</td><td>physics ${ph.label || '·'}${ph.cocked ? ' (cocked)' : ''}</td><td class="${same ? 'ok' : 'bad'}">camera ${r.label || '·'} ${same ? '✓' : '✗'}</td><td>${r.score.toFixed(2)}</td></tr>`;
  });
  S.check.agree += ag; S.check.total += n;
  $('checkOut').innerHTML = '';
  const img = R.image, g = img.getContext('2d');
  g.lineWidth = 2; g.font = '600 13px Inter, sans-serif'; g.textAlign = 'center';
  R.results.forEach((r, i) => {
    if (!r.found) return;
    const ok = r.label === entries[i].read.label, rr = buildDie(entries[i].type).R * R.K / 2;
    g.strokeStyle = ok ? '#9be29b' : '#ffb070';
    g.beginPath(); g.arc(r.cx / 2, r.cy / 2, rr, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#000'; g.fillText(r.label || '·', r.cx / 2 + 1, r.cy / 2 - rr - 4 + 1);
    g.fillStyle = ok ? '#c8ffc8' : '#ffd0a0'; g.fillText(r.label || '·', r.cx / 2, r.cy / 2 - rr - 4);
  });
  $('checkOut').appendChild(img);
  const div = document.createElement('div');
  div.innerHTML = `This throw: <b>${ag}/${n}</b> agree · session <b>${S.check.agree}/${S.check.total}</b> (${S.check.total ? (100 * S.check.agree / S.check.total).toFixed(1) : '–'}%) · ${R.blobs} blobs${R.split ? `, ${R.split} split by the nearest body` : ''} · ${R.ms.toFixed(0)} ms<table>${rows.join('')}</table>`;
  $('checkOut').appendChild(div);
  window.__dice.lastCheck = { agree: ag, n, blobs: R.blobs, split: R.split, session: { ...S.check }, rows: R.results.map((r, i) => ({ cam: r.label, phys: entries[i].read.label, cocked: entries[i].read.cocked, score: r.score && +r.score.toFixed(3) })) };
  return window.__dice.lastCheck;
}

// ── the loop ────────────────────────────────────────────────────────────────
let last = performance.now(), lastW = 0, lastH = 0;
const _pos = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const w = $('view').clientWidth, h = $('view').clientHeight;
  if (w !== lastW || h !== lastH) { lastW = w; lastH = h; sc.resize(); if (!saverState.on && S.cam === 'orbit') fitTray(); }
  if (saverState.on && saverState.tick) saverState.tick(dt);
  const speed = saverState.on && saverState.speed != null ? saverState.speed : S.speed;
  if (T) {
    if (T.live) {
      T.playT += dt * speed;
      let guard = 0;
      while (T.simT < T.playT && !T.rest && guard++ < 400) {
        T.rest = P.step(); T.simT += DT; T.n++;
        if (T.n % 2 === 0 || T.rest) record();
        if (T.simT >= T.t0 + MAX_T) T.rest = true;
      }
      if (T.rest && T.playT >= T.simT) { T.live = false; T.playT = T.simT; poseAt(T.simT); settle(); }
      else poseAt(Math.min(T.playT, T.simT));
    } else if (T.replay) {
      T.replayT += dt * speed;
      const end = T.rec[T.rec.length - 1].t;
      if (T.replayT >= end) { T.replay = false; hideLabelsTemp(false); poseAt(end); }
      else poseAt(T.replayT);
    }
  }
  // labels follow their dice
  for (const s of sc.labelGroup.children) { const m = s.userData.die; if (m) { s.position.copy(m.position); s.position.y += s.userData.R * 1.05 + 0.4; s.visible = m.visible; } }
  sc.updateCaustics(saverState.causticBoost || 1);
  // camera
  const o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.2;
  camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
  if (saverState.on && saverState.cam) saverState.cam(dt);
  else if (S.cam !== 'orbit') {
    camModeGoal();
    const k = 1 - Math.exp(-dt * 3.5);
    camera.position.lerp(camGoal.pos, k);
    controls.target.lerp(camGoal.tgt, k);
    camera.lookAt(controls.target);
  } else controls.update();
  camera.updateProjectionMatrix();
  sc.render();
  if (saverState.afterRender) saverState.afterRender();
}

// ── boot ────────────────────────────────────────────────────────────────────
window.__dice = {
  ready: false, failed: null, S, get T() { return T; }, sc, rec,
  throw: (text, o = {}) => { if (text) setNotation(text); throwNow(o); return !!T; },
  check: () => runCheck(),
  settled: () => !!(T && T.done),
  setCam: setCamMode,
  occlusion: () => occlusion($('view').clientWidth, $('view').clientHeight), fit: fitTray,
};
buildPicker();
setNotation('3d6', true);
fitTray(true);
// again when the boot layout has settled (the sheet and panels slide)
const refit = () => { if (!saverState.on && S.cam === 'orbit' && !T) fitTray(true); };
setTimeout(refit, 450); setTimeout(refit, 1200);
panel.addEventListener('transitionend', e => { if (e.target === panel) refit(); });
requestAnimationFrame(frame);
addEventListener('pagehide', () => { try { if (worker) worker.terminate(); } catch (e) { /* gone */ } try { rec.dispose(); sc.dispose(); } catch (e) { /* gone */ } });

// ── screensaver ─────────────────────────────────────────────────────────────
installSaver({
  THREE, sc, $, saverState, parse, planDice, specPmf, prob, atLeast, moments,
  getP: () => P, ready: () => S.ready, startThrow, getT: () => T, presim,
  hideLabels, setCamMode, fitTray, occlusion, runBatchRaw: runBatch,
  clearThrow: () => { T = null; sc.clearDice(); hideLabels(); },
  setOpen, setAna,
});

// ============================================================================
//  RADIAL ENGINE  ·  main.js — engine swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one radial engine at a time: mech.js for the kinematics, scene.js
//  for its 3D parts (kit.js), stage.js for the renderer and the camera,
//  cards.js for the part cards and labels. A copy of the linkages main.js
//  with the engine text, the piston plot and the saver steps.
//
//  MOTION
//    One angle drives everything: S.th, the crank angle (rad). Each frame
//    adds rpm / 60 * 2 pi * dt. sc.pose(S.th) places every part and returns
//    the mech.js pose (Q): pistons, rods, valve lifts, the four-stroke
//    phase of each cylinder (Q.cyc, 0 = firing TDC, over 4 pi).
//
//  GREP MAP
//    function swapTo ............ build an engine and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each engine
//    const VIEWS / function setView  camera presets
//    function curves / drawPlot . the piston plot over one crank turn
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each engine,
//                                 front half only (azRange -70..70)
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, makeEngine, TAU } from './mech.js';
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
const PHASES = ['power', 'exhaust', 'inlet', 'compression'];
const cycDeg = th => ((th % (2 * TAU)) + 2 * TAU) % (2 * TAU) * DEG;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0.35, rpm: 20, lastRpm: 20, Q: null, view: 'three',
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

// ── engine swap ─────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(false);
    B.parts.base.holder.visible = S.base;
    S.Q = sc.pose(S.th);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 150; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  r9: { title: 'Nine-cylinder radial', kind: 'One row · master and link rods', lede: 'Nine air-cooled cylinders round one crank pin. Only cylinder 1 has a true connecting rod, the master rod. The other eight pistons hang on link rods from knuckle pins on its big end. Every other cylinder fires, so one cylinder fires every 80° of crank.' },
  r7: { title: 'Seven-cylinder radial', kind: 'One row · master and link rods', lede: 'Seven cylinders and one crank throw. With fewer cylinders the master rod rocks further, so the link pistons stray more from a true crank motion. One cylinder fires every 102.9° of crank.' },
};
const ABOUT = {
  r9: [
    ['One crank pin', 'All the rods must share one crank pin, and there is no room for nine big ends side by side. So one master rod takes the pin, and the others pin onto it.'],
    ['Not quite equal', 'The master rod rocks as it moves, so a knuckle pin does not run on a circle. Each link piston gets its own stroke, its own top dead centre and its own compression ratio. The plot shows how far each one strays.'],
    ['Odd for a reason', 'Four strokes take two turns. With an odd number of cylinders, firing every other one (1, 3, 5, 7, 9, 2, 4, 6, 8) gives an even beat and goes round the engine twice in two turns.'],
    ['The cam ring', 'Four lobes per track, turning backward at 1/8 crank speed. Each lobe opens a valve, and then the next lobe meets the next cylinder in the firing order. Wright and Pratt & Whitney nine-cylinder engines used cam rings like this.'],
  ],
  r7: [
    ['One crank pin', 'Six link rods pin onto the big end of the master rod, which alone sits on the crank pin.'],
    ['Not quite equal', 'The seven-cylinder engine has a shorter master rod for its stroke, so the rocking is larger, and the link strokes and TDC angles stray more than on the nine.'],
    ['Odd for a reason', 'The firing order is 1, 3, 5, 7, 2, 4, 6: one firing every 720/7 = 102.9° of crank.'],
    ['The cam ring', 'Three lobes per track, turning backward at 1/6 crank speed. (n − 1)/2 lobes against the crank, or (n + 1)/2 with it, both serve every other cylinder.'],
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
  three: { az: 30, el: 16, explode: 0, k: 1, at: null },
  close: { az: 38, el: 30, explode: 0, k: 0.36, at: 'crank' },
  front: { az: 0, el: 2, explode: 0, k: 0.95, at: null },
  cam: { az: -34, el: 26, explode: 0, k: 0.3, at: 'cam' },
  side: { az: 68, el: 10, explode: 0, k: 0.92, at: null },
  exploded: { az: 36, el: 20, explode: 1, k: 1.45, at: null },
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
function setRpm(r) {
  r = Math.max(0, Math.min(300, r));
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
  const want = +e.target.value / DEG, base = Math.floor(S.th / (2 * TAU)) * 2 * TAU;
  S.th = base + want;
});
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

// ── piston plot ─────────────────────────────────────────────────────────────
// Over one crank turn: the travel of every piston down from its own top
// (upper band, cylinder 1 in gold), and below it, each link piston minus
// the master piston at the same angle from its own cylinder:
// e_i(theta) = s_i(theta) - s_1(theta - phi_i), in mm. A true crank on every
// piston would make every e_i zero.
const COL = { o: '#e2c27a', w: '#8fb0ff', a: '#e9a0a8' };
function curves() {
  const E = S.cur.sc.E, N = 360, n = E.n, top = S.cur.sc.S.map(q => q.sTop);
  const trav = Array.from({ length: n }, () => []), err = Array.from({ length: n }, () => []);
  const s1 = th => E.pose(th).s[0];
  for (let k = 0; k <= N; k++) {
    const th = TAU * k / N, Q = E.pose(th);
    for (let i = 0; i < n; i++) {
      trav[i].push(top[i] - Q.s[i]);
      if (i) err[i].push(Q.s[i] - s1(th - E.phi[i]));
    }
  }
  const eMax = Math.max(...err.slice(1).flat().map(Math.abs)) || 1;
  return { trav, err, eMax, stroke: 2 * E.u.r * 1.02 };
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
    const yT0 = pad, yT1 = h * 0.58, yE = (h * 0.58 + h - pad) / 2 + 2 * dpr, eH = (h - pad - h * 0.58) / 2 - 4 * dpr;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, yE); o.lineTo(w - pad, yE); o.stroke();
    o.beginPath(); o.moveTo(pad, yT1 + 3 * dpr); o.lineTo(w - pad, yT1 + 3 * dpr); o.stroke();
    const line = (arr, col, lw, yOf) => { o.strokeStyle = col; o.lineWidth = lw * dpr; o.beginPath(); arr.forEach((v, i) => { const y = yOf(v); i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); }); o.stroke(); };
    const yTrav = v => yT0 + (v / C.stroke) * (yT1 - yT0), yErr = v => yE - v / C.eMax * eH;
    for (let i = 1; i < C.trav.length; i++) line(C.trav[i], 'rgba(143,176,255,0.55)', 1, yTrav);
    line(C.trav[0], COL.o, 2, yTrav);
    for (let i = 1; i < C.err.length; i++) line(C.err[i], 'rgba(233,160,168,0.75)', 1.2, yErr);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    o.fillText('TDC', w - pad - 26 * dpr, yT0 + 9 * dpr);
    o.fillText(`±${C.eMax.toFixed(1)} mm`, w - pad - 64 * dpr, yE - eH + 9 * dpr);
    $('legend').innerHTML = `<span class="lo"><i></i>cylinder 1 (master)</span><span class="lw"><i></i>link pistons</span><span class="la"><i></i>link − master, mm</span>`;
    plotCache = { off, X };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const ph = ((S.th % TAU) + TAU) % TAU * DEG, x = plotCache.X(ph);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}

// which cylinder fired last (Q.cyc smallest) and the phase name of each
const firing = Q => { let b = 0; Q.cyc.forEach((c, i) => { if (c < Q.cyc[b]) b = i; }); return b; };
const phaseOf = c => PHASES[Math.min(3, Math.floor(c / Math.PI))];
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const sc = S.cur.sc, E = sc.E, Q = S.Q, f = firing(Q), next = E.order[(E.order.indexOf(f + 1) + 1) % E.n];
  let html = row('Crank', `${cycDeg(S.th).toFixed(1)}° / 720°`) + row('Rod swing δ', `${(Q.delta * DEG).toFixed(2)}°`) +
    row('Cam ring', `${(((Q.cam[0] * DEG) % 360 + 360) % 360).toFixed(1)}°`) + row('Order', E.order.join('-')) +
    `<tr><th>Cyl · now</th><th>stroke · TDC · ratio</th></tr>`;
  for (const q of sc.S) html += row(`${q.i + 1} ${phaseOf(Q.cyc[q.i])}`, `${q.stroke.toFixed(2)} ${q.shift >= 0 ? '+' : '−'}${Math.abs(q.shift * DEG).toFixed(2)}° ${q.CR.toFixed(2)}`);
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  const a = Q.cyc[f] * DEG;
  $('now').innerHTML = `<b>Cylinder ${f + 1}: ${a < 60 ? 'firing' : 'power'}</b><span>${a.toFixed(0)}° after its TDC. Next: cylinder ${next} in ${(720 / E.n - a).toFixed(0)}°.</span>`;
}
function fillEqs() {
  const u = unit(S.cur.id), N = (u.n - 1) / 2;
  const E = [
    ['Master piston', 's₁ = r cos θ + √(L² − r² sin² θ)', 'a plain slider-crank'],
    ['Knuckle pin', 'Kᵢ = C + ρ R(δ + φᵢ) ŷ', 'fixed in the rocking master rod'],
    ['Link piston', '|Pᵢ − Kᵢ| = l,  Pᵢ on axis φᵢ', 'l = L − ρ'],
    ['Firing', `Δθ = 720° / ${u.n} = ${(720 / u.n).toFixed(1)}°`, 'every other cylinder'],
    ['Cam ring', `N = (n − 1)/2 = ${N},  ω = −ω_crank / ${2 * N}`, 'one lobe per cylinder, in firing order'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, E = S.cur.sc.E;
  switch (key) {
    case 'piston': return ['Piston 1 from TDC', `${(S.cur.sc.S[0].sTop - Q.s[0]).toFixed(1)} mm`];
    case 'fire': { const f = firing(Q); return ['Last to fire', `cylinder ${f + 1}, ${(Q.cyc[f] * DEG).toFixed(0)}° ago`]; }
    case 'master': return ['Rod swing δ', `${(Q.delta * DEG).toFixed(2)}°`];
    case 'crank': return ['Crank', `${S.rpm} rpm · ${cycDeg(S.th).toFixed(0)}° of 720°`];
    case 'cam': return ['Cam ring', `${(S.rpm * E.omega).toFixed(2)} rpm`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const f = firing(S.Q);
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">θ ${cycDeg(S.th).toFixed(0)}° · firing cyl ${f + 1} · δ ${(S.Q.delta * DEG).toFixed(1)}°</span>`;
  $('turnV').textContent = `${cycDeg(S.th).toFixed(0)}°`;
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
  cur.sc.showFire = S.explode < 0.05;
  S.Q = cur.sc.pose(S.th);
  for (const o of S.leaving) o.sc.pose(S.th);
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
window.__radial = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(20); setExplode(0);
stage.place({ az: -50, el: 20, r: 4200, target: new THREE.Vector3(0, -30, 40) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'r9');
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
// each engine: the whole engine, the crank and rods close in, face on (the
// firing goes round), the exploded engine and close-ups of 3 parts
// (lib/mech-tour.js), then a fade to the other engine. Each step holds
// seconds/10 (at least 5 s). calm (1 = slowest) slows the crank, not the
// step time. The camera stays on the front half (azRange -70..70): the
// cut-away windows face the front. opts.label names each step with the
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
    const RPM = Math.round(60 - 30 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['s_1', 'm1'], ['K_i', 'm2'], ['\\delta', 'm2'], ['l', 'm3'], ['L', 'm3'], ['N', 'm4'], ['\\omega', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEXS = u => [String.raw`s_1 = r\cos\theta + \sqrt{L^2 - r^2\sin^2\theta}`, String.raw`K_i = C + \rho\,R(\delta + \varphi_i)\,\hat y,\quad |P_i - K_i| = l`, String.raw`N = \frac{n-1}{2} = ${(u.n - 1) / 2},\quad \omega_{cam} = -\frac{\omega}{${u.n - 1}}`];
    const EQS = u => ['s₁ = r cos θ + √(L² − r² sin² θ)', 'Kᵢ = C + ρ R(δ + φᵢ) ŷ', `ω_cam = −ω / ${u.n - 1}`];
    const tex = () => TEXS(unit(S.cur.id)), eq = () => EQS(unit(S.cur.id));
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      const f = firing(Q);
      return [P('\\theta', 'crank', `${cycDeg(S.th).toFixed(0)}° of 720°`, 'm1'), P('\\delta', 'master rod swing', `${(Q.delta * DEG).toFixed(1)}°`, 'm2'), P('#', 'firing', `cylinder ${f + 1}`, ''), P('\\omega', 'crank', `${S.rpm} rpm`, 'm4')];
    };
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(master|link\d+|crank|piston\d+)$/.test(q.id)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: 'Master and link rods', sub: 'One crank pin, one master rod, knuckle pins for the rest', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'front', lab: () => ({ title: 'Every other cylinder', sub: `Firing order ${S.cur.sc.E.order.join('-')}`, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['master', 'piston', 'cam', 'link', 'head', 'crank'], skip: ['base', 'flame', 'case', 'tappet', 'rocker', 'pushrod'], azRange: [-70, 70] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS[0], STEPS[1], STEPS[2], STEPS[3], ...tour.pick(3).map(focusStep)]; };
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
